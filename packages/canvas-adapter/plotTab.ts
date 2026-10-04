// The Insights "Plot" sub-tab: the reader's own plots, one card each, over the population Insights is scoped to.
//
// A plot is a saved recipe (`PlotSpec`), so this tab is mostly a list: New plot, then per card Edit, Duplicate and
// Delete, with Import and Export for taking the list somewhere else. Editing happens in a window beside a large
// copy of the chart (plotModal.ts). The list itself lives in the shared `PlotStore`, which the host is told about,
// so a plot built here is there tomorrow and on the next lot.
//
// A plot that needs something this lot does not have (a test it lacks) is kept and greyed with the reason, never
// dropped: the plots are the reader's, not the lot's.

import type { Die } from '../core/dies.js';
import type { TestDef } from '../renderer/buildWaferMap.js';
import { defaultPlot, describeTitleDrift, examplePlots, fieldCatalogue, resolvePlot, titleDrift, type PlotContext, type PlotPoint } from '../stats/plotData.js';
import { addPlots, newPlotId, readPlotsFile, writePlotsFile, type PlotSpec } from '../stats/plotSpec.js';
import type { SweepSpec } from '../stats/sweep.js';
import { renderPlotChart, type PlotChartHandle } from './charts/plotChart.js';
import { makeChartGridWrap } from './charts/chartShell.js';
import { openDrilldownMenu } from './drilldown.js';
import { openPlotEditor } from './plotModal.js';
import { sourceFromPoints, toPlotItems } from './plotItems.js';
import type { PlotStore } from './plotStore.js';
import type { InsightsItem } from './insightsTab.js';
import { CLR, FONT, RADIUS, SPACE, controlStyle, markNoPrint, saveTextFile, wireControlHover, type SaveImageHandler, type SaveTextHandler } from './toolbar.js';

export interface PlotSectionDeps {
  doc: Document;
  store: PlotStore;
  items: InsightsItem[];
  /** The population's reconciled test list. */
  testDefs: TestDef[];
  ringCount: number;
  /** The tab's Group by key and its label, which "follow Group by" resolves to. */
  groupBy?: string;
  groupLabel?: string;
  onSaveImage?: SaveImageHandler;
  onSaveText?: SaveTextHandler;
  /** Click a point: open its wafer, on a test's values when the plot is about one. */
  openWafer?: (waferIndex: number, label: string, testNumber?: number) => void;
  /** A single-wafer host's version of the same: show the test on the map that is already there. */
  focusTest?: (testNumber: number) => void;
  locateDie?: (die: Die, waferIndex: number | undefined) => void;
  sweeps?: SweepSpec[];
  /** The host's own way to choose a plots file (a native dialog). Without it a file input is used. */
  pickPlotsFile?: () => Promise<string | null>;
}

const UNDO_MS = 10_000;

export function createPlotSection(d: PlotSectionDeps): { card: HTMLElement; destroy: () => void } {
  const { doc, store } = d;
  const items = toPlotItems(d.items.map(it => ({ label: it.identity ?? it.label, dies: it.dies, waferIndex: it.waferIndex, wafer: it.wafer, passBins: it.passBins })));
  const ctx: PlotContext = { testDefs: d.testDefs, passBins: [1], groupBy: d.groupBy, ringCount: d.ringCount };
  const resolve = (p: PlotSpec) => resolvePlot(p, items, ctx);
  const catalogue = fieldCatalogue(items, ctx);

  const root = doc.createElement('div');
  root.dataset.wmapPlotTab = '1';
  Object.assign(root.style, { display: 'flex', flexDirection: 'column', gap: SPACE.lg, width: '100%' } as Partial<CSSStyleDeclaration>);

  // ── toolbar ──
  const bar = doc.createElement('div');
  Object.assign(bar.style, { display: 'flex', flexWrap: 'wrap', gap: SPACE.md, alignItems: 'center' } as Partial<CSSStyleDeclaration>);
  const button = (text: string, hook: string, onClick: () => void): HTMLButtonElement => {
    const b = doc.createElement('button');
    b.type = 'button';
    b.textContent = text;
    b.dataset[hook] = '1';
    Object.assign(b.style, { ...controlStyle('outlined'), fontSize: FONT.body } as Partial<CSSStyleDeclaration>);
    wireControlHover(b);
    b.addEventListener('click', onClick);
    return b;
  };
  bar.append(
    button('+ New plot', 'wmapPlotNew', () => newPlot()),
    button('Add examples', 'wmapPlotExamples', () => addExamples()),
    button('Import plots…', 'wmapPlotImport', () => { void importPlots(); }),
    button('Export plots…', 'wmapPlotExport', () => exportPlots()),
  );
  markNoPrint(bar);   // New, Import and Export mean nothing on paper
  root.appendChild(bar);

  // ── notices (undo, import results) ──
  const notice = doc.createElement('div');
  notice.setAttribute('role', 'status');
  Object.assign(notice.style, { display: 'none', flexWrap: 'wrap', gap: SPACE.md, alignItems: 'center', padding: `${SPACE.sm} ${SPACE.md}`,
    background: CLR.menuBg, border: `1px solid ${CLR.menuBorder}`, borderRadius: RADIUS.container, color: CLR.text, fontSize: FONT.body } as Partial<CSSStyleDeclaration>);
  markNoPrint(notice);
  root.appendChild(notice);
  let noticeTimer: ReturnType<typeof setTimeout> | undefined;
  function say(text: string, action?: { label: string; run: () => void }, lines: string[] = []): void {
    if (noticeTimer !== undefined) clearTimeout(noticeTimer);
    notice.replaceChildren();
    const t = doc.createElement('span');
    t.textContent = text;
    notice.appendChild(t);
    if (action) {
      const b = button(action.label, 'wmapPlotNoticeAction', () => { action.run(); hideNotice(); });
      notice.appendChild(b);
    }
    for (const l of lines) {
      const li = doc.createElement('div');
      li.textContent = l;
      Object.assign(li.style, { flexBasis: '100%', color: CLR.label } as Partial<CSSStyleDeclaration>);
      notice.appendChild(li);
    }
    notice.style.display = 'flex';
    noticeTimer = setTimeout(hideNotice, action ? UNDO_MS : UNDO_MS * 2);
  }
  function hideNotice(): void {
    if (noticeTimer !== undefined) { clearTimeout(noticeTimer); noticeTimer = undefined; }
    notice.style.display = 'none';
    notice.replaceChildren();
  }

  // ── the list ──
  const empty = doc.createElement('div');
  empty.textContent = 'No plots yet. A plot is any measured value against another, or a distribution, that you choose: New plot starts one, and it is kept for the next lot. Add examples draws one of each chart type from this lot to start from.';
  Object.assign(empty.style, { color: CLR.label, fontSize: FONT.body, padding: `${SPACE.lg} 0` } as Partial<CSSStyleDeclaration>);
  const grid = makeChartGridWrap(doc);
  root.append(empty, grid);

  interface Entry { chart: PlotChartHandle; json: string; driftNote: HTMLElement }
  const entries = new Map<string, Entry>();

  const chartHooks = () => ({
    onSaveImage: d.onSaveImage,
    // The wafer opens on the plot's own test, so its map shows the values the plot is about and not the bins. A
    // single-wafer host has no wafer to open: it shows the test on its own map.
    onOpenWafer: d.openWafer
      ? (i: number, testNumber?: number) => d.openWafer!(items[i].waferIndex ?? i, items[i].label, testNumber)
      : d.focusTest && items.length === 1
        ? (_i: number, testNumber?: number) => { if (testNumber !== undefined) d.focusTest!(testNumber); }
        : undefined,
    openActionLabel: !d.openWafer && d.focusTest && items.length === 1 ? 'show this test on the map' : undefined,
    onSelectPoints: (points: PlotPoint[], at: { x: number; y: number }, anchor: HTMLElement) => selectPoints(points, at, anchor),
  });

  function selectPoints(points: PlotPoint[], at: { x: number; y: number }, anchor: HTMLElement): void {
    const source = sourceFromPoints(points, items, d.testDefs);
    if (!source) return;
    openDrilldownMenu(at, anchor, source,
      { sweeps: d.sweeps, plots: store, onSaveImage: d.onSaveImage, onSaveText: d.onSaveText, onLocateDie: d.locateDie });
  }

  function edit(plot: PlotSpec, draft = false): void {
    openPlotEditor({ doc, anchor: root, store, plot, draft, items, ctx, groupLabel: d.groupLabel, chart: chartHooks() });
  }
  function newPlot(): void {
    const plot = defaultPlot(catalogue, newPlotId());
    store.upsert(plot);
    edit(plot);
  }

  /** One example of each chart type the lot can show, skipping any the reader already has. */
  function addExamples(): void {
    const key = (p: PlotSpec) => JSON.stringify([p.mark, p.encoding, p.aggregate ?? null]);
    const have = new Set(store.get().map(key));
    const fresh = examplePlots(catalogue, items.length, newPlotId).filter(p => !have.has(key(p)));
    if (fresh.length === 0) {
      say(catalogue.some(f => f.group === 'Tests') ? 'The examples for this lot are already in your plots.' : 'There are no measured values in this lot to draw examples from.');
      return;
    }
    for (const p of fresh) store.upsert(p);
    say(`Added ${fresh.length} example plot${fresh.length === 1 ? '' : 's'}: ${fresh.map(p => p.mark).join(', ')}. Edit one to make it yours, or Delete what you do not need.`);
  }

  function makeEntry(plot: PlotSpec): Entry {
    const chart = renderPlotChart({ ownerDocument: doc, waferLabel: i => items[i]?.label ?? '', ...chartHooks() });
    chart.card.dataset.wmapPlotId = plot.id;
    markNoPrint(chart.actions);   // Edit, Duplicate, Delete and the title warning are for the screen
    const act = (text: string, hook: string, run: () => void) => chart.actions.appendChild(button(text, hook, run));
    act('Edit', 'wmapPlotEdit', () => { const p = store.get().find(x => x.id === plot.id); if (p) edit(p); });
    act('Duplicate', 'wmapPlotDuplicate', () => { store.duplicate(plot.id); });
    act('Delete', 'wmapPlotDelete', () => {
      const gone = store.remove(plot.id);
      if (gone) say(`Deleted “${gone.plot.title ?? 'plot'}”.`, { label: 'Undo', run: () => store.insertAt(gone.index, gone.plot) });
    });
    const driftNote = doc.createElement('div');
    driftNote.dataset.wmapPlotTitleDrift = '1';
    Object.assign(driftNote.style, { display: 'none', flexWrap: 'wrap', gap: SPACE.md, alignItems: 'center', flexBasis: '100%', padding: `${SPACE.xs} ${SPACE.md}`,
      background: CLR.warnBg, border: `1px solid ${CLR.warnBorder}`, borderRadius: RADIUS.control, color: CLR.warnText, fontSize: FONT.body } as Partial<CSSStyleDeclaration>);
    chart.actions.appendChild(driftNote);
    const entry: Entry = { chart, json: '', driftNote };
    entries.set(plot.id, entry);
    return entry;
  }

  /** A title the reader typed that no longer describes its plot: say so on the card, and offer the automatic one. */
  function showDrift(el: HTMLElement, plot: PlotSpec): void {
    const text = describeTitleDrift(titleDrift(plot, catalogue));
    el.replaceChildren();
    el.style.display = text ? 'flex' : 'none';
    if (!text) return;
    const t = doc.createElement('span');
    t.textContent = text;
    el.append(t, button('Use the automatic title', 'wmapPlotAutoTitle', () => {
      const cur = store.get().find(x => x.id === plot.id);
      if (!cur) return;
      const next = { ...cur };
      delete next.title;
      store.upsert(next);
    }));
  }

  function sync(): void {
    const plots = store.get();
    for (const [id, e] of entries) {
      if (plots.some(p => p.id === id)) continue;
      e.chart.destroy(); e.chart.card.remove(); entries.delete(id);
    }
    plots.forEach((p, i) => {
      const e = entries.get(p.id) ?? makeEntry(p);
      const json = JSON.stringify(p);
      if (e.json !== json) {
        e.json = json;
        const r = resolve(p);
        e.chart.setPlot(r);
        // A plot this lot cannot draw is kept, and looks it.
        e.chart.card.style.opacity = r.issues.length ? '0.7' : '1';
        showDrift(e.driftNote, p);
      }
      if (grid.children[i] !== e.chart.card) grid.insertBefore(e.chart.card, grid.children[i] ?? null);
    });
    empty.style.display = plots.length === 0 ? '' : 'none';
  }
  const unsubscribe = store.subscribe(sync);
  sync();

  // ── files ──
  function exportPlots(): void {
    const plots = store.get();
    if (plots.length === 0) { say('There are no plots to export yet.'); return; }
    saveTextFile(writePlotsFile(plots), 'wafermap-plots.json', 'application/json', d.onSaveText);
  }

  async function chooseFile(): Promise<string | null> {
    if (d.pickPlotsFile) return d.pickPlotsFile();
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

  async function importPlots(): Promise<void> {
    const text = await chooseFile();
    if (text === null) return;
    const read = readPlotsFile(text);
    if (read.error) { say(`Could not import: ${read.error}`); return; }
    const { plots, copies } = addPlots(store.get(), read.plots);
    store.replaceAll(plots);
    const lines = [...read.warnings, ...(copies.length ? [`Kept as copies, since a plot with the same id already existed: ${copies.join(', ')}`] : [])];
    say(`Imported ${read.plots.length} plot${read.plots.length === 1 ? '' : 's'}.`, undefined, lines);
  }

  return {
    card: root,
    destroy: () => {
      unsubscribe();
      if (noticeTimer !== undefined) clearTimeout(noticeTimer);
      for (const e of entries.values()) e.chart.destroy();
      entries.clear();
      store.flush();
    },
  };
}
