// The page filter: one set of conditions that narrows the maps, the gallery and every Insights tab.
//
// The state lives in a controller so the views share it: whichever view the reader edits it from, the others follow, and
// the host hears one `onFilterChange`. The controller also holds the one way of applying it (`applyConditions`), the band
// that states it above each view, and the editor window. A view asks for either result: `keep` drops the wafers and dies
// that fail (Insights draws only what is kept), `mark` keeps every wafer and die in place and flags the dies that fail
// (`Die.filteredOut`) so a map can draw them dimmed. Loaded on demand, as the plot machinery it uses is not small.

import type { Die } from '../core/dies.js';
import type { Wafer } from '../core/wafer.js';
import type { TestDef } from '../renderer/buildWaferMap.js';
import type { StatsSummary } from '../stats/types.js';
import { mergeTestDefs } from '../stats/mergeTestDefs.js';
import { DEFAULT_FACET_CURATION, type FacetCuration } from '../stats/facets.js';
import { conditionText } from '../stats/plotData.js';
import { readFilter, type PlotFilter } from '../stats/plotSpec.js';
import { addSavedFilters, readSavedFilters, readFiltersFile, writeFiltersFile, type SavedFilter } from '../stats/filterFile.js';
import { newFilterId } from '../stats/plotId.js';
import { applyConditions, fieldCatalogue, fieldExtent, fieldValues, type ConditionsApplied, type PlotContext, type PlotItem } from '../stats/plotData.js';
import { toPlotItems } from './plotItems.js';
import { buildFilterEditor, buildFilterStrip } from './filterEditor.js';
import { CLR, FONT, RADIUS, SPACE, openModal, saveTextFile, wireTooltip, type SaveTextHandler } from './toolbar.js';
import { inputStyle } from './charts/chartShell.js';
import { bandButton } from './filterButton.js';

/** What the filter reads of a wafer. Insights' items and the gallery's cards both have this shape. */
export interface FilterSource {
  dies: Die[];
  wafer: Wafer;
  /** Shown in a plot's title; the wafer's identity when it has one. */
  label: string;
  identity?: string;
  waferIndex: number;
  passBins: readonly number[];
  testDefs?: TestDef[];
  statsSummary?: StatsSummary;
}

export interface PageFilterOptions {
  /** The filter to start with, as the host stored it (read like a plots file, so a stale one is tolerated). */
  initial?: unknown;
  /** Called with the filter after the reader applies, switches or removes it. */
  onChange?: (filter: PlotFilter | undefined) => void;
  attributes?: Record<string, FacetCuration>;
  getRingCount: () => number;
  doc: Document;
  /** The host's saved filters to start with, read as a filters file's are: one it cannot read is left out and logged. */
  savedFilters?: readonly unknown[];
  /** Called with the whole list after the reader saves, deletes or imports a filter. */
  onSavedFiltersChange?: (filters: SavedFilter[]) => void;
  /** Choose a filters file to import, resolving to its text, or `null` when cancelled. Without it the browser's own file input is used. */
  pickFiltersFile?: () => Promise<string | null>;
  onSaveText?: SaveTextHandler;
}

export interface PageFilterBand {
  el: HTMLElement;
  /** Show the filter and what it kept; hides the band when there is no filter. */
  refresh(result: ConditionsApplied | undefined, sources: readonly FilterSource[]): void;
}

export interface PageFilterController {
  get(): PlotFilter | undefined;
  /** Set (or with `undefined` remove) the filter: the host is told and every subscribed view re-renders. */
  set(filter: PlotFilter | undefined): void;
  /** Called after every change; returns the unsubscribe. */
  subscribe(fn: () => void): () => void;
  /** The wafers and dies the filter keeps; the rest are gone. `result` is undefined with no filter in force. */
  keep<T extends FilterSource>(sources: readonly T[]): { items: T[]; result?: ConditionsApplied; narrowing: boolean };
  /**
   * Every wafer, in place: dies the filter drops are copies flagged `filteredOut`, a narrowed wafer loses its summary
   * (it describes every die), and `hidden` holds the positions of wafers dropped whole.
   */
  mark<T extends FilterSource>(sources: readonly T[]): { items: T[]; hidden: Set<number>; result?: ConditionsApplied; narrowing: boolean };
  createBand(sources: () => readonly FilterSource[], inset?: { marginLeft: string; marginRight: string; marginBottom: string }): PageFilterBand;
  /** The saved filters, in the order they were kept. */
  saved(): readonly SavedFilter[];
  /** Replace the list (the host is told). */
  setSaved(filters: readonly SavedFilter[]): void;
  /** The editor window, over the population given. */
  openEditor(anchor: HTMLElement, sources: readonly FilterSource[]): void;
}

/**
 * A filter as the host gave it, read by the plots file's own reader: a host restores it from storage, where it may be
 * malformed or written by another version. A condition that cannot be read is left out and the problem logged; the band
 * then states the filter that is applied, so nothing is filtered unseen.
 */
export function readFilterOption(raw: unknown): PlotFilter | undefined {
  if (raw === undefined || raw === null) return undefined;
  const warnings: string[] = [];
  const isObj = typeof raw === 'object' && !Array.isArray(raw);
  const filter = isObj ? readFilter(JSON.parse(JSON.stringify(raw)) as Record<string, unknown>, 'insights.filter', warnings) : undefined;
  if (!filter) warnings.push('insights.filter: needs at least one condition, so no filter is applied');
  if (warnings.length) console.warn(`[wafermap] ${warnings.join('; ')}`);
  return filter;
}

const clone = (f: PlotFilter): PlotFilter => JSON.parse(JSON.stringify(f)) as PlotFilter;

export function createPageFilter(o: PageFilterOptions): PageFilterController {
  const { doc } = o;
  const curation: Record<string, FacetCuration> = { ...DEFAULT_FACET_CURATION, ...o.attributes };
  let filter = readFilterOption(o.initial);
  const listeners = new Set<() => void>();
  let saved: SavedFilter[] = (() => {
    if (!o.savedFilters) return [];
    const read = readSavedFilters(o.savedFilters, 'insights.savedFilters');
    if (read.warnings.length) console.warn(`[wafermap] ${read.warnings.join('; ')}`);
    return read.filters;
  })();

  const population = (sources: readonly FilterSource[]): { items: PlotItem[]; ctx: PlotContext } => ({
    items: toPlotItems(sources.map(it => ({ label: it.identity ?? it.label, dies: it.dies, waferIndex: it.waferIndex, wafer: it.wafer, passBins: it.passBins, ringCount: o.getRingCount() }))),
    ctx: { testDefs: mergeTestDefs([...sources]).defs, curation },
  });

  const apply = (sources: readonly FilterSource[]): ConditionsApplied | undefined => {
    if (!filter || filter.off) return undefined;
    const pop = population(sources);
    return applyConditions(filter.conditions, pop.items, pop.ctx);
  };

  const self: PageFilterController = {
    get: () => filter,
    set(next) {
      filter = next;
      o.onChange?.(next ? clone(next) : undefined);
      for (const fn of [...listeners]) fn();
    },
    subscribe(fn) { listeners.add(fn); return () => { listeners.delete(fn); }; },
    saved: () => saved,
    setSaved(next) {
      saved = next.map(f => JSON.parse(JSON.stringify(f)) as SavedFilter);
      o.onSavedFiltersChange?.(saved.map(f => JSON.parse(JSON.stringify(f)) as SavedFilter));
    },

    keep(sources) {
      const result = apply(sources);
      if (!result || result.issue) return { items: sources as never, result, narrowing: false };
      const items = result.index.map((i, k) => {
        const it = sources[i], dies = result.items[k].dies as Die[];
        return dies.length === it.dies.length ? it : { ...it, dies, statsSummary: undefined };
      });
      return { items, result, narrowing: items.length !== sources.length || items.some((it, k) => it !== sources[result.index[k]]) };
    },

    mark(sources) {
      const hidden = new Set<number>();
      const result = apply(sources);
      if (!result || result.issue) return { items: sources as never, hidden, result, narrowing: false };
      const keptAt = new Map<number, Die[]>(result.index.map((i, k) => [i, result.items[k].dies as Die[]]));
      let narrowing = false;
      const items = sources.map((it, i) => {
        const kept = keptAt.get(i);
        if (kept === undefined) { hidden.add(i); narrowing = true; }
        if (kept && kept.length === it.dies.length) return it;
        narrowing = true;
        const keep = kept ? new Set(kept) : undefined;
        const dies = it.dies.map(d => (keep?.has(d) ? d : { ...d, filteredOut: true }));
        return { ...it, dies, statsSummary: undefined };
      });
      return { items, hidden, result, narrowing };
    },

    createBand(sources, inset) {
      const el = doc.createElement('div');
      el.dataset.wmapInsightsFilter = '1';
      Object.assign(el.style, { display: 'none', ...inset } as Partial<CSSStyleDeclaration>);
      const button = (text: string, hook: string, hint: string, onClick: () => void) => bandButton(doc, text, hook, hint, onClick);
      const refresh: PageFilterBand['refresh'] = (result, src) => {
        el.replaceChildren();
        el.style.display = filter ? '' : 'none';
        if (!filter) return;
        const actions = [
          button('Edit…', 'wmapInsightsFilterEdit', 'Change the conditions', () => self.openEditor(el, src)),
          button('Remove', 'wmapInsightsFilterRemove', 'Delete the filter: every wafer and die is shown again', () => self.set(undefined)),
        ];
        if (result?.issue) {
          const warn = doc.createElement('div');
          warn.dataset.wmapInsightsFilterIssue = '1';
          warn.setAttribute('role', 'status');
          Object.assign(warn.style, {
            display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: SPACE.md, padding: `${SPACE.xs} ${SPACE.md}`,
            background: CLR.warnBg, border: `1px solid ${CLR.warnBorder}`, borderRadius: RADIUS.control, color: CLR.warnText, fontSize: FONT.body,
          } as Partial<CSSStyleDeclaration>);
          const t = doc.createElement('span');
          t.textContent = `The filter cannot be applied to these wafers (${result.issue}), so nothing is filtered.`;
          const end = doc.createElement('span');
          Object.assign(end.style, { display: 'inline-flex', gap: SPACE.sm, marginLeft: 'auto' } as Partial<CSSStyleDeclaration>);
          end.append(...actions);
          warn.append(t, end);
          el.appendChild(warn);
          return;
        }
        const n = (v: number) => v.toLocaleString('en-GB');
        const kept = result
          ? `${n(result.wafers.kept)} of ${n(result.wafers.total)} wafer${result.wafers.total === 1 ? '' : 's'} · ${n(result.dies.kept)} of ${n(result.dies.total)} dies`
          : undefined;
        el.appendChild(buildFilterStrip({
          doc, filter, testDefs: mergeTestDefs([...src]).defs, attributes: curation, label: 'Filter', kept, actions,
          onToggle: on => {
            if (!filter) return;
            const next: PlotFilter = { ...filter };
            if (on) delete next.off; else next.off = true;
            self.set(next);
          },
        }));
      };
      return { el, refresh };
    },

    openEditor(anchor, sources) {
      const pop = population(sources);
      let draft: PlotFilter | undefined = filter ? clone(filter) : undefined;
      let apply: HTMLButtonElement | undefined;
      const handle = openModal({
        title: 'Filter', anchor, ownerDocument: doc,
        // An editor's height, not its content's: a field list opens inside the window and needs room to show its choices.
        boxSize: { width: 'min(92vw, 640px)', height: 'min(85vh, 640px)' }, maximizable: false,
        // With nothing to apply yet, start where the reader begins: adding a condition.
        initialFocus: () => (draft ? apply : editor.el.querySelector<HTMLButtonElement>('[data-wmap-filter-add]') ?? apply),
        onClose: () => {},
      });
      handle.box.dataset.wmapInsightsFilterModal = '1';
      const body = doc.createElement('div');
      Object.assign(body.style, { display: 'flex', flexDirection: 'column', gap: SPACE.lg, padding: SPACE.xl, color: CLR.text, fontSize: FONT.body, overflowY: 'auto', flex: '1 1 auto', minHeight: '0' } as Partial<CSSStyleDeclaration>);
      const intro = doc.createElement('p');
      intro.style.margin = '0';
      intro.textContent = 'The maps, the gallery and every Insights tab show only the wafers and dies that meet every condition. A condition on a wafer '
        + 'field (split, yield) keeps whole wafers; one on a die field (bin, ring, a test) keeps those dies inside them, and a map draws the others dimmed. '
        + 'The filter is shown above each view for as long as it exists, and can be switched off there without losing it.';
      const preview = doc.createElement('div');
      preview.dataset.wmapInsightsFilterPreview = '1';
      preview.setAttribute('aria-live', 'polite');
      Object.assign(preview.style, { fontWeight: '600', color: CLR.value } as Partial<CSSStyleDeclaration>);
      const showPreview = () => {
        if (!draft || draft.off) { preview.textContent = draft ? 'Off: every wafer and die is shown.' : 'No conditions: every wafer and die is shown.'; return; }
        const r = applyConditions(draft.conditions, pop.items, pop.ctx);
        preview.textContent = r.issue ? `Cannot be applied: ${r.issue}`
          : `Keeps ${r.wafers.kept.toLocaleString('en-GB')} of ${r.wafers.total.toLocaleString('en-GB')} wafers · ${r.dies.kept.toLocaleString('en-GB')} of ${r.dies.total.toLocaleString('en-GB')} dies`;
      };
      const editor = buildFilterEditor({
        doc, catalogue: fieldCatalogue(pop.items, pop.ctx), filter: draft, testDefs: pop.ctx.testDefs, attributes: curation, switchLabel: 'Filter',
        valuesOf: f => fieldValues(f, pop.items, pop.ctx), extentOf: f => fieldExtent(f, pop.items, pop.ctx),
        onChange: f => { draft = f; showPreview(); },
      });
      showPreview();
      // Cancel and Apply stay at the foot of the window, below what scrolls.
      const row = doc.createElement('div');
      Object.assign(row.style, { display: 'flex', justifyContent: 'flex-end', gap: SPACE.md, flexWrap: 'wrap', flexShrink: '0',
        padding: `${SPACE.md} ${SPACE.xl}`, borderTop: `1px solid ${CLR.menuBorder}` } as Partial<CSSStyleDeclaration>);
      const cancel = bandButton(doc, 'Cancel', 'wmapInsightsFilterCancel', 'Close without changing the filter', () => handle.close());
      apply = bandButton(doc, 'Apply', 'wmapInsightsFilterApply', 'Filter the maps, the gallery and Insights by these conditions', () => { handle.close(); self.set(draft); });
      for (const b of [cancel, apply]) b.style.padding = `${SPACE.sm} ${SPACE.lg}`;
      row.append(cancel, apply);
      body.append(intro, editor.el, preview, buildSavedSection({
        doc, popItems: pop, getDraft: () => draft,
        load: f => { draft = { conditions: JSON.parse(JSON.stringify(f.conditions)) as PlotFilter['conditions'] }; editor.set(draft); showPreview(); },
        saved: () => self.saved(), setSaved: l => self.setSaved(l), onSaveText: o.onSaveText, pickFile: o.pickFiltersFile,
        attributes: curation,
      }));
      handle.contentWrap.style.flexDirection = 'column';
      handle.contentWrap.append(body, row);
    },
  };
  return self;
}

interface SavedSectionOptions {
  doc: Document;
  popItems: { items: PlotItem[]; ctx: PlotContext };
  getDraft: () => PlotFilter | undefined;
  /** Put a saved filter's conditions in the draft (nothing is applied until Apply). */
  load: (f: SavedFilter) => void;
  saved: () => readonly SavedFilter[];
  setSaved: (list: readonly SavedFilter[]) => void;
  onSaveText?: SaveTextHandler;
  pickFile?: () => Promise<string | null>;
  attributes: Record<string, FacetCuration>;
}

/**
 * The editor's saved filters: a name and Save for the draft, each saved filter with Load and Delete, and Import / Export of
 * the list as a `wafermap-filters` file. Loading only fills the draft, so what it keeps is stated before Apply; a saved
 * filter naming a field this lot lacks says so beside its name and can still be loaded.
 */
function buildSavedSection(o: SavedSectionOptions): HTMLElement {
  const { doc } = o;
  const section = doc.createElement('div');
  section.dataset.wmapSavedFilters = '1';
  Object.assign(section.style, { display: 'flex', flexDirection: 'column', gap: SPACE.md, borderTop: `1px solid ${CLR.menuBorder}`, paddingTop: SPACE.lg } as Partial<CSSStyleDeclaration>);
  const heading = doc.createElement('div');
  heading.textContent = 'Saved filters';
  Object.assign(heading.style, { fontWeight: '600', color: CLR.value } as Partial<CSSStyleDeclaration>);
  const status = doc.createElement('div');
  status.dataset.wmapSavedFiltersStatus = '1';
  status.setAttribute('role', 'status');
  Object.assign(status.style, { color: CLR.label, whiteSpace: 'pre-line' } as Partial<CSSStyleDeclaration>);
  const say = (text: string, lines: string[] = []): void => { status.textContent = [text, ...lines].filter(Boolean).join('\n'); };

  // Save the draft under a name: an existing name takes the new conditions, so a filter is refined by saving it again.
  const nameRow = doc.createElement('div');
  Object.assign(nameRow.style, { display: 'flex', gap: SPACE.sm, flexWrap: 'wrap', alignItems: 'center' } as Partial<CSSStyleDeclaration>);
  const name = doc.createElement('input');
  name.type = 'text';
  name.placeholder = 'Name for the conditions above';
  name.setAttribute('aria-label', 'Name for the saved filter');
  name.dataset.wmapSavedFilterName = '1';
  Object.assign(name.style, { ...inputStyle(), flex: '1 1 12em' } as Partial<CSSStyleDeclaration>);
  const save = bandButton(doc, 'Save', 'wmapSavedFilterSave', 'Keep the conditions above under this name', () => {
    const draft = o.getDraft();
    const nm = name.value.trim();
    if (!draft || draft.conditions.length === 0) { say('Add a condition first: there is nothing to save.'); return; }
    if (!nm) { say('Give the filter a name.'); name.focus(); return; }
    const conditions = JSON.parse(JSON.stringify(draft.conditions)) as SavedFilter['conditions'];
    const list = o.saved();
    const at = list.findIndex(f => f.name === nm);
    o.setSaved(at < 0 ? [...list, { id: newFilterId(), name: nm, conditions }] : list.map((f, i) => (i === at ? { ...f, conditions } : f)));
    name.value = '';
    say(at < 0 ? `Saved “${nm}”.` : `Updated “${nm}”.`);
    draw();
  });
  nameRow.append(name, save);

  const list = doc.createElement('div');
  list.dataset.wmapSavedFilterList = '1';
  Object.assign(list.style, { display: 'flex', flexDirection: 'column', gap: SPACE.xs } as Partial<CSSStyleDeclaration>);

  function draw(): void {
    list.replaceChildren();
    const have = o.saved();
    if (have.length === 0) {
      const none = doc.createElement('div');
      none.textContent = 'None yet. Set conditions above and save them under a name to use them again.';
      none.style.color = CLR.label;
      list.appendChild(none);
      return;
    }
    for (const f of have) {
      const row = doc.createElement('div');
      row.dataset.wmapSavedFilter = f.id;
      Object.assign(row.style, { display: 'flex', gap: SPACE.sm, alignItems: 'center', flexWrap: 'wrap' } as Partial<CSSStyleDeclaration>);
      const text = doc.createElement('span');
      Object.assign(text.style, { flex: '1 1 14em', minWidth: '0' } as Partial<CSSStyleDeclaration>);
      const title = doc.createElement('strong');
      title.textContent = f.name;
      const words = doc.createElement('span');
      words.style.color = CLR.label;
      words.textContent = ` — ${f.conditions.map(c => conditionText(c, o.popItems.ctx.testDefs, o.attributes)).join(' · ')}`;
      text.append(title, words);
      // Whether this lot can be filtered by it: a field it lacks is said, not hidden.
      const issue = applyConditions(f.conditions, o.popItems.items, o.popItems.ctx).issue;
      if (issue) {
        const warn = doc.createElement('div');
        warn.dataset.wmapSavedFilterIssue = '1';
        warn.textContent = `Cannot be applied to these wafers: ${issue}`;
        Object.assign(warn.style, { color: CLR.warnText, fontSize: FONT.body } as Partial<CSSStyleDeclaration>);
        text.appendChild(warn);
      }
      const load = bandButton(doc, 'Load', 'wmapSavedFilterLoad', 'Put these conditions in the editor, replacing the ones there', () => { o.load(f); say(`Loaded “${f.name}”. Press Apply to filter by it.`); });
      const del = bandButton(doc, 'Delete', 'wmapSavedFilterDelete', 'Remove this saved filter', () => {
        const before = o.saved();
        o.setSaved(before.filter(x => x.id !== f.id));
        say(`Deleted “${f.name}”.`);
        draw();
      });
      row.append(text, load, del);
      list.appendChild(row);
    }
  }

  const files = doc.createElement('div');
  Object.assign(files.style, { display: 'flex', gap: SPACE.sm, flexWrap: 'wrap' } as Partial<CSSStyleDeclaration>);
  const exportBtn = bandButton(doc, 'Export…', 'wmapSavedFilterExport', 'Save all your saved filters to a file, to share or to keep a copy', () => {
    if (o.saved().length === 0) { say('There are no saved filters to export yet.'); return; }
    saveTextFile(writeFiltersFile(o.saved()), 'wafermap-filters.json', 'application/json', o.onSaveText);
  });
  const importBtn = bandButton(doc, 'Import…', 'wmapSavedFilterImport', 'Add the filters from a file written by Export…', () => {
    void (async () => {
      const text = await chooseFile(doc, o.pickFile);
      if (text === null) return;
      const read = readFiltersFile(text);
      if (read.error) { say(`Could not import: ${read.error}`); return; }
      const { filters, copies } = addSavedFilters(o.saved(), read.filters);
      o.setSaved(filters);
      draw();
      say(`Imported ${read.filters.length} filter${read.filters.length === 1 ? '' : 's'}.`,
        [...read.warnings, ...(copies.length ? [`Kept as copies, since a filter with the same id already existed: ${copies.join(', ')}`] : [])]);
    })();
  });
  for (const b of [save, exportBtn, importBtn]) b.style.padding = `${SPACE.sm} ${SPACE.lg}`;
  files.append(importBtn, exportBtn);
  wireTooltip(name, 'The name the filter is listed under; saving under a name already used updates that filter');
  draw();
  section.append(heading, nameRow, list, files, status);
  return section;
}

async function chooseFile(doc: Document, pick?: () => Promise<string | null>): Promise<string | null> {
  if (pick) return pick();
  return new Promise(resolveText => {
    const input = doc.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.addEventListener('change', () => {
      const f = input.files?.[0];
      if (!f) { resolveText(null); return; }
      void f.text().then(resolveText, () => resolveText(null));
    });
    input.addEventListener('cancel', () => resolveText(null));
    input.click();
  });
}
