// The Insights "Data" sub-tab: the population Insights is scoped to, as tables.
//
// Three views of the same scope, one at a time:
//   Statistics — one row per test (the test-values and functional tables).
//   Dies       — one row per die, wide (a column per test) or long (a row per die per test).
//   Wafers     — one row per wafer: yield, die counts, metadata (lot, split, …), per-test means.
//
// Why a tab rather than more buttons: Insights already owns the scope (the wafers
// in view), Group by, and the selection → chart drilldown, and reads the same
// in-memory data as the map. A table is another view of that scope.
//
// Every export goes through `exportCsv` (tableExport.ts): full-precision plain
// numbers, a Blob for a large table. What is exported is what is shown, in the
// order shown, except that the Dies view can also write long format.

import type { Die } from '../core/dies.js';
import { isYieldEligibleDie } from '../core/dies.js';
import { testValue } from '../core/dieTable.js';
import { metadataDisplayValue } from '../core/metadata.js';
import { prettyKey } from '../core/utils.js';
import { tableToTsv, type CsvCell, type CsvColumn } from '../core/tableCsv.js';
import { commonMetadata } from '../stats/facets.js';
import { buildYieldData } from '../stats/yield.js';
import { isParametricTest, type MetadataFieldDef, type TestDef } from '../renderer/buildWaferMap.js';
import { fmt as fmtValue } from '../renderer/fmt.js';
import { testLabel } from '../renderer/testLabel.js';
import { resolveDieColumns, type DieListDisplayOptions } from './dieList.js';
import { createVirtualTable, type VirtualColumn } from './virtualTable.js';
import { exportCsv } from './tableExport.js';
import { CLR, FONT, RADIUS, SPACE, controlStyle, wireControlHover, wireTooltip, type SaveTextHandler } from './toolbar.js';
import { buildTestSection, buildFunctionalTestSection } from './summaryPanel.js';
import type { InsightsItem } from './insightsTab.js';
import type { Wafer } from '../core/wafer.js';

export type DataView = 'statistics' | 'dies' | 'wafers';

/** What a table needs of a wafer. An `InsightsItem` fits; so does one wafer's share
 *  of a drilldown population, which has no `Wafer` object or stats of its own. */
export interface DataItem {
  label: string;
  dies: Die[];
  waferIndex: number;
  wafer?: Wafer;
  passBins?: readonly number[];
  statsSummary?: InsightsItem['statsSummary'];
}

export const DATA_VIEWS: ReadonlyArray<{ key: DataView; label: string }> = [
  { key: 'statistics', label: 'Statistics' },
  { key: 'dies', label: 'Dies' },
  { key: 'wafers', label: 'Wafers' },
];

/** Rows Excel can open. A file with more is still valid; the reader is told. */
export const EXCEL_ROW_LIMIT = 1_048_576;
/** Cells above which Copy is not offered: a paste that size freezes the target. */
export const COPY_CELL_LIMIT = 200_000;
/** Parametric tests given a mean column in the Wafers view. */
export const WAFER_TEST_COLUMNS = 50;

export interface DataSectionDeps {
  doc: Document;
  items: DataItem[];
  /** Parametric tests of the scope. */
  testDefs: TestDef[];
  /** Every test of the scope, functional ones included. */
  allTestDefs: TestDef[];
  /** Active grouping, when any: Statistics then shows one block per group. */
  groups?: { key: string; items: DataItem[] }[];
  groupLabelText?: string;
  ringCount: number;
  /** Lot yield per wafer index (the figure every other yield display uses). */
  yieldByWaferIndex: ReadonlyMap<number, number | null>;
  onSaveText?: SaveTextHandler;
  /** The Statistics view's tables, built by the Insights tab (they are the
   *  test-values and functional cards that used to sit in Overview). */
  buildStatistics: (items: DataItem[]) => { cards: HTMLElement[]; destroy: () => void };
  /** Which views to offer. Default all three. */
  views?: readonly DataView[];
  /** Host display choices for the Dies table (`RenderOptions.dieList`): which metadata columns to show. */
  dieListOptions?: DieListDisplayOptions;
  /** Label/order hints for die metadata columns, e.g. `WaferMapResult.metadataFields`. */
  metadataFields?: MetadataFieldDef[];
  /** Set when the tables describe part of a population (a drilldown selection): what to say after the
   *  counts ("selected on W03"), and a wafer column and file-name tag so a file says so too. */
  population?: { phrase: string; fileTag: string };
  view: DataView;
  onViewChange: (view: DataView) => void;
  /** The Dies view's Wide | Long choice. */
  diesLayout: 'wide' | 'long';
  onDiesLayoutChange: (layout: 'wide' | 'long') => void;
}

interface ViewResult {
  el: HTMLElement;
  destroy: () => void;
  /** Export / copy for views that have rows of their own (not Statistics). */
  actions?: {
    exportCsv: () => void | Promise<void>;
    /** Null when the table is too big to copy. */
    copyText: (() => string) | null;
    /** What the export will contain, and anything the reader should know about it. */
    note: () => string;
    /** The Dies view's Wide | Long choice, applied in place so the table keeps its sort and scroll. */
    setLayout?: (layout: 'wide' | 'long') => void;
  };
}

const plural = (n: number, one: string, many = one + 's') => `${n.toLocaleString()} ${n === 1 ? one : many}`;

export function renderDataSection(deps: DataSectionDeps): { card: HTMLElement; destroy: () => void } {
  const { doc } = deps;
  const outer = doc.createElement('div');
  outer.dataset.wmapDataTab = '1';
  Object.assign(outer.style, { display: 'flex', flexDirection: 'column', gap: SPACE.md, minWidth: '0' } as Partial<CSSStyleDeclaration>);

  const bar = doc.createElement('div');
  Object.assign(bar.style, { display: 'flex', alignItems: 'center', gap: SPACE.md, flexWrap: 'wrap' } as Partial<CSSStyleDeclaration>);
  outer.appendChild(bar);

  const body = doc.createElement('div');
  Object.assign(body.style, { display: 'flex', flexDirection: 'column', gap: SPACE.md, minWidth: '0' } as Partial<CSSStyleDeclaration>);
  outer.appendChild(body);

  const offered = DATA_VIEWS.filter(v => !deps.views || deps.views.includes(v.key));
  const switcher = segmented(doc, 'Table', offered, deps.view, 'wmapDataView', v => deps.onViewChange(v as DataView));
  bar.appendChild(switcher.el);

  let result: ViewResult;
  switch (deps.view) {
    case 'dies':   result = buildDiesView(deps); break;
    case 'wafers': result = buildWafersView(deps); break;
    default:       result = buildStatisticsView(deps);
  }

  let refreshNote: () => void = () => {};
  if (deps.view === 'dies') {
    const layout = segmented(doc, 'Export layout', [
      { key: 'wide', label: 'Wide' }, { key: 'long', label: 'Long' },
    ], deps.diesLayout, 'wmapDataLayout', l => {
      layout.set(l);
      deps.onDiesLayoutChange(l as 'wide' | 'long');
      result.actions?.setLayout?.(l as 'wide' | 'long');
      refreshNote();
    });
    wireTooltip(layout.el, 'Wide: a column per test. Long: a row per die per test, for tools that want tidy data. The table on screen is always wide.');
    bar.appendChild(layout.el);
  }

  if (result.actions) {
    const actions = result.actions;
    const spacer = doc.createElement('div');
    spacer.style.flex = '1';
    bar.appendChild(spacer);

    const exportBtn = actionButton(doc, 'Export CSV');
    exportBtn.dataset.wmapDataExport = '1';
    exportBtn.addEventListener('click', () => {
      if (exportBtn.disabled) return;
      const idle = exportBtn.textContent;
      const pending = actions.exportCsv();
      if (!pending) return;
      exportBtn.disabled = true;
      exportBtn.setAttribute('aria-busy', 'true');
      void pending.catch(() => { /* the host reports a failed save */ }).finally(() => {
        exportBtn.disabled = false;
        exportBtn.removeAttribute('aria-busy');
        exportBtn.textContent = idle;
      });
    });
    const copyBtn = actionButton(doc, 'Copy');
    copyBtn.dataset.wmapDataCopy = '1';
    if (actions.copyText) {
      wireTooltip(copyBtn, 'Copy the table as tab-separated text, to paste into a spreadsheet');
      copyBtn.addEventListener('click', () => {
        const text = actions.copyText!();
        const clip = doc.defaultView?.navigator?.clipboard;
        if (!clip) return;
        const idle = copyBtn.textContent;
        void clip.writeText(text).then(() => {
          copyBtn.textContent = 'Copied';
          doc.defaultView?.setTimeout(() => { copyBtn.textContent = idle; }, 1500);
        }).catch(() => { /* clipboard refused; nothing to report */ });
      });
    } else {
      copyBtn.disabled = true;
      wireTooltip(copyBtn, `Too large to copy (over ${COPY_CELL_LIMIT.toLocaleString()} cells). Use Export CSV.`);
    }
    bar.append(copyBtn, exportBtn);

    const note = doc.createElement('div');
    note.dataset.wmapDataNote = '1';
    note.textContent = actions.note();
    refreshNote = () => { note.textContent = actions.note(); };
    Object.assign(note.style, { color: CLR.label, fontSize: FONT.body } as Partial<CSSStyleDeclaration>);
    outer.insertBefore(note, body);
  }

  body.appendChild(result.el);
  return { card: outer, destroy: () => result.destroy() };
}

// ── Statistics ───────────────────────────────────────────────────────────────

function buildStatisticsView(deps: DataSectionDeps): ViewResult {
  const { doc } = deps;
  const wrap = doc.createElement('div');
  Object.assign(wrap.style, { display: 'flex', flexDirection: 'column', gap: SPACE.lg, minWidth: '0' } as Partial<CSSStyleDeclaration>);
  const destroyFns: Array<() => void> = [];

  const groups = deps.groups && deps.groups.length > 0 ? deps.groups : undefined;
  const blocks = groups ?? [{ key: '', items: deps.items }];
  for (const g of blocks) {
    if (groups) {
      const h = doc.createElement('div');
      h.textContent = `${deps.groupLabelText ?? 'Group'}: ${g.key}`;
      Object.assign(h.style, { fontWeight: '700', color: CLR.text, fontSize: FONT.body } as Partial<CSSStyleDeclaration>);
      wrap.appendChild(h);
    }
    const built = deps.buildStatistics(g.items);
    destroyFns.push(built.destroy);
    for (const c of built.cards) wrap.appendChild(c);
  }
  if (!wrap.querySelector('table') && !wrap.textContent) {
    wrap.textContent = 'No test statistics to show for these wafers.';
    Object.assign(wrap.style, { color: CLR.label, fontSize: FONT.body } as Partial<CSSStyleDeclaration>);
  }
  return { el: wrap, destroy: () => { for (const d of destroyFns) d(); } };
}

// ── Dies ─────────────────────────────────────────────────────────────────────

function buildDiesView(deps: DataSectionDeps): ViewResult {
  const { doc, items } = deps;
  const waferLabelByDie = new WeakMap<Die, string>();
  const waferByDie = new WeakMap<Die, Wafer>();
  const dies: Die[] = [];
  let anyWafer = false;
  for (const item of items) {
    if (item.wafer) anyWafer = true;
    for (const d of item.dies) {
      waferLabelByDie.set(d, item.label);
      if (item.wafer) waferByDie.set(d, item.wafer);
      dies.push(d);
    }
  }
  if (dies.length === 0) return emptyView(doc, 'No dies to show.');

  const { columns, visibleColumns } = resolveDieColumns(dies, deps.allTestDefs, {
    ...deps.dieListOptions,
    metadataFields: deps.metadataFields,
    extraColumn: items.length > 1 || deps.population ? { label: 'Wafer', get: d => waferLabelByDie.get(d) } : undefined,
    getWafer: anyWafer ? (d => waferByDie.get(d)) : undefined,
    ringCount: deps.ringCount,
    waferMetadata: items.some(it => it.wafer) ? commonMetadata(items.map(it => ({ metadata: it.wafer?.metadata }))) : undefined,
    ownerDocument: doc,
  });

  const vcols: VirtualColumn<Die>[] = visibleColumns.map(c => ({
    header: c.label,
    get: c.get,
    numeric: c.test !== undefined && isParametricTest(c.test),
    ...(c.test !== undefined && isParametricTest(c.test)
      ? { sortKey: (d: Die) => testValue(d, c.test!.testNumber) }
      : {}),
  }));
  const table = createVirtualTable<Die>({
    columns: vcols, rows: dies, ariaLabel: `Dies (${dies.length})`, ownerDocument: doc,
  });
  table.el.style.maxHeight = '70vh';
  table.el.style.minHeight = '240px';

  const tag = deps.population ? `-${deps.population.fileTag}` : '';
  const testCols = columns.filter(c => c.test !== undefined);
  const plainCols = columns.filter(c => c.test === undefined);
  const wideCells = dies.length * columns.length;
  const longRowsMax = dies.length * testCols.length;

  const wideColumns = (): CsvColumn<Die>[] => columns.map(c => ({ header: c.csvLabel ?? c.label, get: c.csvGet ?? c.get }));
  type Pair = { die: Die; test: TestDef; value: CsvCell };
  const longColumns = (): CsvColumn<Pair>[] => [
    ...plainCols.map(c => ({ header: c.csvLabel ?? c.label, get: (p: Pair) => (c.csvGet ?? c.get)(p.die) })),
    { header: 'Test', get: p => testLabel(p.test, p.test.testNumber) },
    { header: 'Test number', get: p => p.test.testNumber },
    { header: 'Unit', get: p => p.test.unit ?? '' },
    { header: 'Value', get: p => p.value },
  ];
  function* longRows(): Generator<Pair> {
    for (const die of table.orderedRows()) {
      for (const c of testCols) {
        const value = (c.csvGet ?? c.get)(die);
        if (value === '' || value === undefined || value === null) continue;   // the die did not run this test
        yield { die, test: c.test!, value };
      }
    }
  }

  let long = deps.diesLayout === 'long' && testCols.length > 0;
  const layoutNote = () => long
    ? `Long format: up to ${plural(longRowsMax, 'row')} (a die with no result for a test has no row)`
      + (longRowsMax > EXCEL_ROW_LIMIT ? ` — more than Excel opens (${EXCEL_ROW_LIMIT.toLocaleString()}).` : '.')
    : `Wide format: ${plural(dies.length, 'row')} × ${plural(columns.length, 'column')}`
      + (dies.length > EXCEL_ROW_LIMIT ? ` — more than Excel opens (${EXCEL_ROW_LIMIT.toLocaleString()} rows).` : '.');

  return {
    el: table.el,
    destroy: () => table.destroy(),
    actions: {
      note: () => `${plural(dies.length, 'die')} ${deps.population?.phrase ?? `on ${plural(items.length, 'wafer')}`}. ${layoutNote()} Export follows the order shown.`,
      setLayout: (l) => { long = l === 'long' && testCols.length > 0; },
      exportCsv: () => long
        ? exportCsv(longColumns(), longRows(), `die-list-long${tag}.csv`, deps.onSaveText, { rowCount: longRowsMax })
        : exportCsv(wideColumns(), table.orderedRows(), `die-list${tag}.csv`, deps.onSaveText, { rowCount: dies.length }),
      copyText: wideCells <= COPY_CELL_LIMIT ? () => tableToTsv(wideColumns(), table.orderedRows()) : null,
    },
  };
}

// ── Wafers ───────────────────────────────────────────────────────────────────

interface WaferRow { item: DataItem; yieldPercent: number | null }
interface WaferColumn { header: string; cell: (r: WaferRow) => CsvCell; show?: (r: WaferRow) => string; numeric?: boolean }

function buildWafersView(deps: DataSectionDeps): ViewResult {
  const { doc, items } = deps;
  if (items.length === 0) return emptyView(doc, 'No wafers to show.');

  const rows: WaferRow[] = items.map(item => {
    const pre = deps.yieldByWaferIndex.get(item.waferIndex);
    const percent = buildYieldData([{
      label: item.label, dies: item.dies, passBins: item.passBins, yieldPercent: pre, key: item.waferIndex,
    }], item.passBins ?? [1])[0]?.percent;
    return { item, yieldPercent: item.dies.length ? (percent ?? null) : null };
  });

  // Metadata keys in order of first appearance, text values only.
  const keys: string[] = [];
  for (const { item } of rows) {
    for (const k of Object.keys(item.wafer?.metadata ?? {})) {
      if (!keys.includes(k) && metadataDisplayValue((item.wafer?.metadata as Record<string, unknown>)[k]) !== undefined) keys.push(k);
    }
  }

  const tests = deps.testDefs.slice(0, WAFER_TEST_COLUMNS);
  const meanOf = (row: WaferRow, td: TestDef): number | undefined => {
    const stat = row.item.statsSummary?.stats.perTestStats?.find(s => s.testNumber === td.testNumber);
    if (stat) return stat.mean;
    let n = 0, sum = 0;
    for (const d of row.item.dies) {
      if (!isYieldEligibleDie(d)) continue;
      const v = testValue(d, td.testNumber);
      if (v !== undefined && Number.isFinite(v)) { n++; sum += v; }
    }
    return n ? sum / n : undefined;
  };

  const cols: WaferColumn[] = [
    { header: 'Wafer', cell: r => r.item.label },
    ...keys.map((k): WaferColumn => ({
      header: prettyKey(k),
      cell: r => metadataDisplayValue((r.item.wafer?.metadata as Record<string, unknown> | undefined)?.[k]) ?? '',
    })),
    { header: 'Dies', cell: r => r.item.dies.length, numeric: true },
    { header: 'Yield-eligible dies', cell: r => r.item.dies.filter(d => isYieldEligibleDie(d)).length, numeric: true },
    { header: 'Yield %', cell: r => r.yieldPercent === null ? '' : r.yieldPercent,
      show: r => r.yieldPercent === null ? '' : r.yieldPercent.toFixed(1), numeric: true },
    ...tests.map((td): WaferColumn => ({
      header: `${testLabel(td, td.testNumber)}${td.unit ? ` (${td.unit})` : ''} mean`,
      cell: r => meanOf(r, td),
      show: r => { const m = meanOf(r, td); return m === undefined ? '' : fmtValue(m, td.unit); },
      numeric: true,
    })),
  ];

  const vcols: VirtualColumn<WaferRow>[] = cols.map(c => ({
    header: c.header,
    get: r => c.show ? c.show(r) : String(c.cell(r) ?? ''),
    numeric: c.numeric,
    ...(c.numeric ? { sortKey: (r: WaferRow) => { const v = c.cell(r); return typeof v === 'number' ? v : undefined; } } : {}),
  }));
  const table = createVirtualTable<WaferRow>({
    columns: vcols, rows, ariaLabel: `Wafers (${rows.length})`, ownerDocument: doc,
  });
  table.el.style.maxHeight = '70vh';
  table.el.style.minHeight = '120px';

  const csvCols = (): CsvColumn<WaferRow>[] => cols.map(c => ({ header: c.header, get: c.cell }));
  const cutNote = deps.testDefs.length > tests.length
    ? ` Mean columns cover the first ${tests.length} of ${deps.testDefs.length} tests.` : '';
  return {
    el: table.el,
    destroy: () => table.destroy(),
    actions: {
      note: () => `${plural(rows.length, 'wafer')}.${cutNote} Export follows the order shown.`,
      exportCsv: () => exportCsv(csvCols(), table.orderedRows(), 'wafers.csv', deps.onSaveText, { rowCount: rows.length }),
      copyText: rows.length * cols.length <= COPY_CELL_LIMIT ? () => tableToTsv(csvCols(), table.orderedRows()) : null,
    },
  };
}

// ── Small pieces ─────────────────────────────────────────────────────────────

function emptyView(doc: Document, text: string): ViewResult {
  const el = doc.createElement('div');
  el.textContent = text;
  Object.assign(el.style, { color: CLR.label, fontSize: FONT.body, padding: SPACE.md } as Partial<CSSStyleDeclaration>);
  return { el, destroy: () => {} };
}

function actionButton(doc: Document, text: string): HTMLButtonElement {
  const b = doc.createElement('button');
  b.type = 'button';
  b.textContent = text;
  Object.assign(b.style, {
    fontSize: FONT.body, padding: '3px 10px', borderRadius: RADIUS.control,
    ...controlStyle('outlined'), background: CLR.menuBg,
  } as Partial<CSSStyleDeclaration>);
  wireControlHover(b);
  return b;
}

/** A labelled radio-style group: one choice at a time, arrow keys move and choose. */
function segmented(
  doc: Document,
  label: string,
  options: ReadonlyArray<{ key: string; label: string }>,
  current: string,
  dataAttr: string,
  onChange: (key: string) => void,
): { el: HTMLElement; set: (key: string) => void } {
  const el = doc.createElement('div');
  el.setAttribute('role', 'radiogroup');
  el.setAttribute('aria-label', label);
  Object.assign(el.style, {
    display: 'inline-flex', background: CLR.menuBg, border: `1px solid ${CLR.menuBorder}`,
    borderRadius: RADIUS.control, overflow: 'hidden',
  } as Partial<CSSStyleDeclaration>);
  const buttons: HTMLButtonElement[] = [];
  let selected = current;
  const paint = (): void => {
    for (const b of buttons) {
      const on = b.dataset[dataAttr] === selected;
      b.setAttribute('aria-checked', String(on));
      b.tabIndex = on ? 0 : -1;
      Object.assign(b.style, {
        background: on ? CLR.bgActive : 'transparent', color: on ? CLR.iconActive : CLR.label, fontWeight: on ? '600' : '400',
      } as Partial<CSSStyleDeclaration>);
    }
  };
  for (const o of options) {
    const b = doc.createElement('button');
    b.type = 'button';
    b.textContent = o.label;
    b.dataset[dataAttr] = o.key;
    b.setAttribute('role', 'radio');
    Object.assign(b.style, {
      border: 'none', cursor: 'pointer', fontSize: FONT.body, padding: `${SPACE.xs} ${SPACE.md}`, whiteSpace: 'nowrap',
    } as Partial<CSSStyleDeclaration>);
    wireControlHover(b, 'bare');
    b.addEventListener('click', () => { if (selected !== o.key) onChange(o.key); });
    buttons.push(b);
    el.appendChild(b);
  }
  paint();
  el.addEventListener('keydown', e => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const i = buttons.indexOf(doc.activeElement as HTMLButtonElement);
    if (i < 0) return;
    e.preventDefault();
    const next = buttons[(i + (e.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length];
    next.click();
    next.focus();
  });
  return { el, set: key => { selected = key; paint(); } };
}

// ── The tables in a modal ────────────────────────────────────────────────────

export interface DataTablesInput {
  doc: Document;
  /** One entry per wafer. `wafer` gives ring/quadrant and the lot/product columns; `passBins` and
   *  `statsSummary` give the Wafers view its yield and means. */
  items: ReadonlyArray<{ label: string; dies: Die[]; waferIndex?: number; wafer?: Wafer; passBins?: readonly number[]; statsSummary?: DataItem['statsSummary'] }>;
  testDefs: TestDef[] | undefined;
  /** Set when the tables describe part of a population — a drilldown selection: who the dies are, in
   *  words ("selected on W03"). A saved file then says so in its name and a Wafer column. Omit for a whole wafer or lot. */
  population?: string;
  view: DataView;
  /** Which views to offer. Default Dies and Statistics, plus Wafers when there is more than one wafer. */
  views?: readonly DataView[];
  ringCount?: number;
  metadataFields?: MetadataFieldDef[];
  dieListOptions?: DieListDisplayOptions;
  onSaveText?: SaveTextHandler;
}

/**
 * The Data tab's tables for a population, in the same controls, for a modal —
 * a drilldown selection, or a wafer or lot opened from the Summary panel. It does
 * not need Insights to be enabled: it is built from the dies it is given.
 * Statistics is the Test Values and Functional Tests tables over just those dies,
 * stamped with their identity so a saved file says what it covers.
 */
export function renderDataTables(input: DataTablesInput): { el: HTMLElement; destroy: () => void } {
  const { doc } = input;
  const host = doc.createElement('div');
  Object.assign(host.style, { display: 'flex', flexDirection: 'column', minWidth: '0', minHeight: '0', flex: '1', padding: SPACE.md } as Partial<CSSStyleDeclaration>);
  const items: DataItem[] = input.items.map((it, i) => ({ ...it, waferIndex: it.waferIndex ?? i }));
  const allDies = items.flatMap(it => it.dies);
  const allDefs = input.testDefs ?? [];
  const parametric = allDefs.filter(isParametricTest);
  const views = input.views ?? (items.length > 1 ? ['statistics', 'dies', 'wafers'] as const : ['statistics', 'dies'] as const);

  // Identity for the Test Values CSV: the population in words for a selection, else the wafer
  // (or the wafers pooled), exactly as the panels' own tables stamp theirs.
  const csvContext = input.population
    ? { populationLabel: `${plural(allDies.length, 'die')} ${input.population}` }
    : items.length > 1
      ? { perWaferMetadata: items.map(it => it.wafer?.metadata ?? {}), populationLabel: `${plural(items.length, 'wafer')} pooled` }
      : { waferMetadata: items[0]?.wafer?.metadata };

  let view: DataView = views.includes(input.view) ? input.view : views[0];
  let layout: 'wide' | 'long' = 'wide';
  let current: { card: HTMLElement; destroy: () => void } | null = null;
  const draw = (): void => {
    current?.destroy();
    current = renderDataSection({
      doc, items, testDefs: parametric, allTestDefs: allDefs, ringCount: input.ringCount ?? 4,
      yieldByWaferIndex: new Map(), onSaveText: input.onSaveText,
      views, view, dieListOptions: input.dieListOptions, metadataFields: input.metadataFields,
      population: input.population ? { phrase: input.population, fileTag: 'selection' } : undefined,
      buildStatistics: its => {
        const dies = its.flatMap(it => it.dies);
        const cards: HTMLElement[] = [];
        const values = buildTestSection(dies, parametric, undefined, undefined, input.onSaveText, csvContext, its.map(it => ({ dies: it.dies })), undefined, 'full');
        if (values) cards.push(values);
        const functional = buildFunctionalTestSection(dies, allDefs, undefined, input.onSaveText, csvContext);
        if (functional) cards.push(functional);
        return { cards, destroy: () => {} };
      },
      onViewChange: v => { view = v; draw(); },
      diesLayout: layout, onDiesLayoutChange: l => { layout = l; },
    });
    host.replaceChildren(current.card);
  };
  draw();
  return { el: host, destroy: () => current?.destroy() };
}

/** A drilldown population as tables: Dies and Statistics, named for who the dies are. */
export function renderSelectionTables(input: {
  doc: Document;
  items: DataTablesInput['items'];
  testDefs: TestDef[] | undefined;
  population: string;
  view: 'dies' | 'statistics';
  onSaveText?: SaveTextHandler;
}): { el: HTMLElement; destroy: () => void } {
  return renderDataTables({ ...input, views: ['statistics', 'dies'] });
}
