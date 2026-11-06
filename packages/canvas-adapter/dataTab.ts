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

import { maxOf } from '../core/utils.js';
import type { Die } from '../core/dies.js';
import { isYieldEligibleDie } from '../core/dies.js';
import { testValue } from '../core/dieTable.js';
import { metadataDisplayValue } from '../core/metadata.js';
import { attributeLabel, type FacetCuration } from '../stats/facets.js';
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
import { pooledTestStatsSteps, type PooledTestStats } from '../stats/capability.js';
import { runChunked, type ChunkedRun } from './chunked.js';
import { capabilityShade, outOfLimitsShade, shadesAmong, shortfallShade } from './cellShade.js';
import type { InsightsItem } from './insightsTab.js';
import type { Wafer } from '../core/wafer.js';
import { patTests, waferPatVerdicts, PAT_VERDICT_LABEL, type DiePat } from '../stats/pat.js';

export type DataView = 'statistics' | 'dies' | 'wafers';

/** What a table needs of a wafer. An `InsightsItem` fits; so does one wafer's share
 *  of a drilldown population, which has no `Wafer` object or stats of its own. */
export interface DataItem {
  label: string;
  dies: Die[];
  waferIndex: number;
  wafer?: Wafer;
  /** Every die of the wafer, when `dies` is a part of it: PAT limits are set from the whole wafer. Absent = `dies` is the wafer. */
  allDies?: Die[];
  /** The wafer's own pass bins: the Wafers view's yield judges by them. */
  passBins: readonly number[];
  statsSummary?: InsightsItem['statsSummary'];
}

export const DATA_VIEWS: ReadonlyArray<{ key: DataView; label: string; hint: string }> = [
  { key: 'statistics', label: 'Statistics', hint: 'One row per test: count, spread, limits and limit yield' },
  { key: 'wafers', label: 'Wafers', hint: 'One row per wafer: its attributes, die counts, yield and test means' },
  { key: 'dies', label: 'Dies', hint: 'One row per die, with its position, bins and every test' },
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
  /** The host's own wafer attributes (`attributes` on the render options): the Wafers table names its columns by them. */
  attributes?: Record<string, FacetCuration>;
  /**
   * A die row was clicked: show that die on its wafer's map, on the test whose column was clicked (none for another
   * column). When set, Dies rows are clickable and say so.
   */
  onLocateDie?: (die: Die, waferIndex: number | undefined, testNumber?: number) => void;
  /**
   * A wafer row was clicked: open that wafer, on the test whose mean column was clicked, or on its bins for its yield.
   * When set, Wafers rows are clickable and say so.
   */
  onOpenWafer?: (waferIndex: number, label: string, testNumber?: number, view?: 'bins') => void;
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
    const layout = segmented(doc, 'Export format', [
      { key: 'wide', label: 'Wide', hint: 'A column for each test' }, { key: 'long', label: 'Long', hint: 'A row for each die and test, the shape statistics tools prefer' },
    ], deps.diesLayout, 'wmapDataLayout', l => {
      layout.set(l);
      deps.onDiesLayoutChange(l as 'wide' | 'long');
      result.actions?.setLayout?.(l as 'wide' | 'long');
      refreshNote();
    });
    wireTooltip(layout.el, 'Wide: a column per test. Long: a row per die per test, for tools that want tidy data. The table on screen is always wide.');
    // Named, so it is clear this changes the file and Copy, not the table on screen.
    const group = doc.createElement('span');
    Object.assign(group.style, { display: 'inline-flex', alignItems: 'center', gap: SPACE.sm } as Partial<CSSStyleDeclaration>);
    const caption = doc.createElement('span');
    caption.textContent = 'Export format:';
    Object.assign(caption.style, { color: CLR.label, fontSize: FONT.body } as Partial<CSSStyleDeclaration>);
    group.append(caption, layout.el);
    bar.appendChild(group);
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
  // With groups, every test's statistics for every group in one table, a test's groups side by side, above each group's own.
  if (groups && groups.length > 1) {
    const compared = buildGroupStatsTable(deps, groups);
    if (compared) { wrap.appendChild(compared.el); destroyFns.push(compared.destroy); }
  }
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

/** One test's statistics for one group, as a row of the comparison table. */
interface GroupStatsRow {
  def: TestDef;
  group: string;
  count: number; min: number; q1: number; median: number; mean: number; q3: number; max: number; stddev: number;
  ppk: number | null;
  /** The mean's shade among the same test's other groups. */
  meanShade?: string;
  /** The share inside limits, tinted when it falls short of the best group's. */
  yieldShade?: string;
  /** The share of dies inside the test's spec limits, in percent, when it has limits. */
  limitYield: number | undefined;
}

/**
 * Every parametric test's statistics for every group in one table: a row per test and group, a test's groups next to
 * each other so they can be read across, with the Ppk and the share inside limits. Built in slices, as each group's own
 * statistics card is, so a large lot does not hold the page while it works.
 */
function buildGroupStatsTable(deps: DataSectionDeps, groups: ReadonlyArray<{ key: string; items: DataItem[] }>): { el: HTMLElement; destroy: () => void } | null {
  const { doc } = deps;
  const defs = deps.testDefs.filter((d): d is TestDef & { testNumber: number } => d.testNumber !== undefined && isParametricTest(d));
  if (defs.length === 0) return null;
  const groupLabel = deps.groupLabelText ?? 'Group';

  const wrap = doc.createElement('div');
  wrap.dataset.wmapGroupStats = '1';
  Object.assign(wrap.style, { display: 'flex', flexDirection: 'column', gap: SPACE.sm, minWidth: '0' } as Partial<CSSStyleDeclaration>);
  const head = doc.createElement('div');
  Object.assign(head.style, { display: 'flex', alignItems: 'center', gap: SPACE.md, flexWrap: 'wrap' } as Partial<CSSStyleDeclaration>);
  const title = doc.createElement('div');
  title.textContent = `Compared across ${groupLabel}`;
  Object.assign(title.style, { fontWeight: '700', color: CLR.text, fontSize: FONT.body } as Partial<CSSStyleDeclaration>);
  head.appendChild(title);
  const body = doc.createElement('div');
  body.textContent = 'Computing test statistics…';
  Object.assign(body.style, { color: CLR.label, fontSize: FONT.body } as Partial<CSSStyleDeclaration>);
  wrap.append(head, body);

  const pooled = new Map<string, PooledTestStats>();
  let pending = groups.length;
  let table: { destroy: () => void } | undefined;
  let destroyed = false;
  const finish = (): void => {
    if (destroyed) return;
    const rows: GroupStatsRow[] = [];
    for (const def of defs) {
      for (const g of groups) {
        const p = pooled.get(g.key);
        const stat = p?.stats.get(def.testNumber);
        if (!p || !stat) continue;
        const tally = p.specTally.get(def.testNumber);
        rows.push({
          def, group: g.key, count: stat.count, min: stat.min, q1: stat.q1, median: stat.median, mean: stat.mean, q3: stat.q3, max: stat.max, stddev: stat.stddev,
          ppk: p.capability.find(c => c.testNumber === def.testNumber)?.ppk ?? null,
          limitYield: tally && tally.n > 0 ? 100 * (1 - tally.fail / tally.n) : undefined,
        });
      }
    }
    if (rows.length === 0) { wrap.remove(); return; }
    // Each test's group means among each other: where one group sits away from the rest.
    const byTest = new Map<number, GroupStatsRow[]>();
    for (const r of rows) { const l = byTest.get(r.def.testNumber!); if (l) l.push(r); else byTest.set(r.def.testNumber!, [r]); }
    for (const list of byTest.values()) {
      const among = shadesAmong(list.map(r => r.mean), v => fmtValue(v, list[0].def.unit));
      // The share inside limits is short when it falls a point or more below the best group's, by the report's rule.
      const best = maxOf(list.map(r => r.limitYield ?? -Infinity));
      list.forEach((r, i) => { r.meanShade = among[i]; r.yieldShade = r.limitYield === undefined || !Number.isFinite(best) ? undefined : shortfallShade(r.limitYield - best); });
    }
    const value = (pick: (r: GroupStatsRow) => number): Pick<VirtualColumn<GroupStatsRow>, 'get' | 'numeric' | 'sortKey'> => ({
      get: r => fmtValue(pick(r), r.def.unit), numeric: true, sortKey: pick,
    });
    const plain = (pick: (r: GroupStatsRow) => number | undefined, text: (v: number) => string): Pick<VirtualColumn<GroupStatsRow>, 'get' | 'numeric' | 'sortKey'> => ({
      get: r => { const v = pick(r); return v === undefined || !Number.isFinite(v) ? '' : text(v); }, numeric: true, sortKey: r => { const v = pick(r); return v === undefined || !Number.isFinite(v) ? undefined : v; },
    });
    const cols: VirtualColumn<GroupStatsRow>[] = [
      { header: 'Test', get: r => `${testLabel(r.def, r.def.testNumber)}${r.def.unit ? ` (${r.def.unit})` : ''}` },
      { header: groupLabel, get: r => r.group },
      { header: 'N', ...plain(r => r.count, v => String(v)) },
      { header: 'Min', ...value(r => r.min) },
      { header: 'Q1', ...value(r => r.q1) },
      { header: 'Median', ...value(r => r.median) },
      { header: 'Mean', ...value(r => r.mean), shade: r => r.meanShade },
      { header: 'Q3', ...value(r => r.q3) },
      { header: 'Max', ...value(r => r.max) },
      { header: 'Std dev', ...value(r => r.stddev) },
      { header: 'Ppk', ...plain(r => r.ppk ?? undefined, v => v.toFixed(2)), shade: r => capabilityShade(r.ppk) },
      { header: 'Limit yield %', ...plain(r => r.limitYield, v => v.toFixed(1)), shade: r => r.yieldShade },
    ];
    const vt = createVirtualTable<GroupStatsRow>({ columns: cols, rows, ariaLabel: `Statistics by ${groupLabel} (${rows.length})`, ownerDocument: doc });
    vt.el.style.maxHeight = '50vh';
    vt.el.style.minHeight = '120px';
    table = vt;
    const csvCols = (): CsvColumn<GroupStatsRow>[] => [
      { header: 'Test number', get: r => r.def.testNumber ?? null },
      { header: 'Test', get: r => testLabel(r.def, r.def.testNumber) },
      { header: 'Unit', get: r => r.def.unit ?? '' },
      { header: groupLabel, get: r => r.group },
      { header: 'N', get: r => r.count }, { header: 'Min', get: r => r.min }, { header: 'Q1', get: r => r.q1 }, { header: 'Median', get: r => r.median },
      { header: 'Mean', get: r => r.mean }, { header: 'Q3', get: r => r.q3 }, { header: 'Max', get: r => r.max }, { header: 'Std dev', get: r => r.stddev },
      { header: 'Ppk', get: r => r.ppk }, { header: 'Limit yield %', get: r => r.limitYield ?? null },
    ];
    const csv = actionButton(doc, 'Statistics CSV');
    csv.dataset.wmapGroupStatsCsv = '1';
    csv.addEventListener('click', () => { void exportCsv(csvCols(), vt.orderedRows(), `statistics-by-${groupLabel.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.csv`, deps.onSaveText, { rowCount: rows.length }); });
    head.appendChild(csv);
    body.replaceWith(vt.el);
  };

  const runs: ChunkedRun[] = [];
  for (const g of groups) {
    runs.push(runChunked(pooledTestStatsSteps(g.items.map(it => ({ dies: it.dies })), defs), {
      onDone: p => { pooled.set(g.key, p); if (--pending === 0) finish(); },
    }));
  }
  return { el: wrap, destroy: () => { destroyed = true; for (const r of runs) r.cancel(); table?.destroy(); } };
}

// ── Dies ─────────────────────────────────────────────────────────────────────

/**
 * The PAT columns of a Dies table: each die's verdict on its own wafer, and the tests that put an outlier outside. Only
 * wafers whose dies are all there (a part of a wafer is not the population its limits describe, so a selection without
 * the whole wafer behind it gets none), and only when the lot has tests PAT can judge.
 */
function diePatColumns(items: readonly DataItem[], defs: TestDef[], isPart: boolean): NonNullable<Parameters<typeof resolveDieColumns>[2]>['patColumns'] {
  if (patTests(defs).length === 0) return undefined;
  const byDie = new Map<Die, DiePat>();
  for (const it of items) {
    const whole = it.allDies ?? (isPart ? undefined : it.dies);
    if (!whole) continue;
    const verdicts = waferPatVerdicts(whole, defs, it.passBins);
    whole.forEach((d, i) => byDie.set(d, verdicts[i]));
  }
  if (byDie.size === 0) return undefined;
  const name = (tn: number) => { const d = defs.find(x => x.testNumber === tn); return d ? testLabel(d, tn) : `Test ${tn}`; };
  let anyOutlier = false;
  for (const v of byDie.values()) if (v.verdict === 'outlier') { anyOutlier = true; break; }
  return {
    verdict: d => { const v = byDie.get(d)?.verdict; return v ? PAT_VERDICT_LABEL[v] : undefined; },
    tests: d => { const v = byDie.get(d); return v?.verdict === 'outlier' ? v.tests.map(name).join('; ') : ''; },
    anyOutlier,
  };
}

function buildDiesView(deps: DataSectionDeps): ViewResult {
  const { doc, items } = deps;
  const waferLabelByDie = new WeakMap<Die, string>();
  const waferByDie = new WeakMap<Die, Wafer>();
  const waferIndexByDie = new WeakMap<Die, number>();
  const dies: Die[] = [];
  let anyWafer = false;
  for (const item of items) {
    if (item.wafer) anyWafer = true;
    for (const d of item.dies) {
      waferLabelByDie.set(d, item.label);
      waferIndexByDie.set(d, item.waferIndex);
      if (item.wafer) waferByDie.set(d, item.wafer);
      dies.push(d);
    }
  }
  if (dies.length === 0) return emptyView(doc, 'No dies to show.');

  const patColumns = diePatColumns(items, deps.allTestDefs, !!deps.population);
  const { columns, visibleColumns } = resolveDieColumns(dies, deps.allTestDefs, {
    ...deps.dieListOptions,
    ...(patColumns ? { patColumns } : {}),
    metadataFields: deps.metadataFields,
    extraColumn: items.length > 1 || deps.population ? { label: 'Wafer', get: d => waferLabelByDie.get(d) } : undefined,
    getWafer: anyWafer ? (d => waferByDie.get(d)) : undefined,
    ringCount: deps.ringCount,
    waferMetadata: items.some(it => it.wafer) ? commonMetadata(items.map(it => ({ metadata: it.wafer?.metadata }))) : undefined,
    attributes: deps.attributes,
    ownerDocument: doc,
  });

  const vcols: VirtualColumn<Die>[] = visibleColumns.map(c => ({
    header: c.label,
    get: c.get,
    numeric: c.test !== undefined && isParametricTest(c.test),
    ...(c.test !== undefined && isParametricTest(c.test)
      ? {
        sortKey: (d: Die) => testValue(d, c.test!.testNumber),
        // A reading outside the test's limits is tinted: the dies that fail it stand out down the column.
        shade: (d: Die) => {
          const t = c.test!, v = testValue(d, t.testNumber);
          return v !== undefined && Number.isFinite(v) && ((t.limitLow !== undefined && v < t.limitLow) || (t.limitHigh !== undefined && v > t.limitHigh)) ? outOfLimitsShade() : undefined;
        },
      }
      : {}),
  }));
  const table = createVirtualTable<Die>({
    columns: vcols, rows: dies, ariaLabel: `Dies (${dies.length})`, ownerDocument: doc,
    onRowClick: deps.onLocateDie ? (die, _row, col) => deps.onLocateDie!(die, waferIndexByDie.get(die), visibleColumns[col]?.test?.testNumber) : undefined,
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
      note: () => `${plural(dies.length, 'die')} ${deps.population?.phrase ?? `on ${plural(items.length, 'wafer')}`}. ${layoutNote()} Export follows the order shown.${deps.onLocateDie ? ' Click a row to see that die ringed on the map of its wafer, on the test whose column you click.' : ''}`,
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
interface WaferColumn {
  header: string; cell: (r: WaferRow) => CsvCell; show?: (r: WaferRow) => string; numeric?: boolean; shade?: (r: WaferRow) => string | undefined;
  /** What a click in this column opens the wafer on: its test, or its bins (a yield). */
  opens?: { testNumber: number } | 'bins';
}

function buildWafersView(deps: DataSectionDeps): ViewResult {
  const { doc, items } = deps;
  if (items.length === 0) return emptyView(doc, 'No wafers to show.');

  const rows: WaferRow[] = items.map(item => {
    const pre = deps.yieldByWaferIndex.get(item.waferIndex);
    const percent = buildYieldData([{
      label: item.label, dies: item.dies, passBins: item.passBins, yieldPercent: pre, key: item.waferIndex,
    }])[0]?.percent;
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

  // The numbers a reader came for come first: the wafer, the field Group by divides it by, then dies, yield and the test
  // means; the other attributes follow, those that differ between wafers before those that are the same on every wafer.
  // Attributes the same on every wafer (lot, part type, tester…) are named in a line above the table instead of repeating
  // down a column; they stay in the export.
  const metaOf = (r: WaferRow, k: string): string => metadataDisplayValue((r.item.wafer?.metadata as Record<string, unknown> | undefined)?.[k]) ?? '';
  const metaCol = (k: string): WaferColumn => ({ header: attributeLabel(k, deps.attributes), cell: r => metaOf(r, k) });
  const sameEverywhere = (k: string): boolean => rows.length > 1 && rows.every(r => metaOf(r, k) === metaOf(rows[0], k));
  const constantKeys = keys.filter(sameEverywhere);
  const varyingKeys = keys.filter(k => !constantKeys.includes(k));
  const groupKey = deps.groupLabelText ? varyingKeys.find(k => attributeLabel(k, deps.attributes) === deps.groupLabelText) : undefined;
  const waferYields = rows.map(r => r.yieldPercent).filter((v): v is number => v !== null && Number.isFinite(v));
  const lotYield = waferYields.length ? waferYields.reduce((a, b) => a + b, 0) / waferYields.length : undefined;
  const numberCols: WaferColumn[] = [
    { header: 'Dies', cell: r => r.item.dies.length, numeric: true },
    { header: 'Yield-eligible dies', cell: r => r.item.dies.filter(d => isYieldEligibleDie(d)).length, numeric: true },
    { header: 'Yield %', cell: r => r.yieldPercent === null ? '' : r.yieldPercent,
      show: r => r.yieldPercent === null ? '' : r.yieldPercent.toFixed(1), numeric: true,
      // A wafer short of the lot's figure (the mean per-wafer yield, as the panel and the reports state it) is tinted, as there.
      shade: r => (r.yieldPercent === null || lotYield === undefined ? undefined : shortfallShade(r.yieldPercent - lotYield)),
      opens: 'bins' },
    // A wafer's mean among the wafers' means: blue below the lot's average, warm above.
    ...tests.map((td): WaferColumn => {
      const shades = new Map<WaferRow, string | undefined>();
      const among = shadesAmong(rows.map(r => meanOf(r, td) ?? NaN), v => fmtValue(v, td.unit));
      rows.forEach((r, i) => shades.set(r, among[i]));
      return {
        header: `${testLabel(td, td.testNumber)}${td.unit ? ` (${td.unit})` : ''} mean`,
        cell: r => meanOf(r, td),
        show: r => { const m = meanOf(r, td); return m === undefined ? '' : fmtValue(m, td.unit); },
        numeric: true,
        shade: r => shades.get(r),
        opens: { testNumber: td.testNumber },
      };
    }),
  ];
  const shown: WaferColumn[] = [
    { header: 'Wafer', cell: r => r.item.label },
    ...(groupKey ? [metaCol(groupKey)] : []),
    ...numberCols,
    ...varyingKeys.filter(k => k !== groupKey).map(metaCol),
  ];
  // The export keeps every attribute, the constant ones last.
  const cols: WaferColumn[] = [...shown, ...constantKeys.map(metaCol)];

  const vcols: VirtualColumn<WaferRow>[] = shown.map(c => ({
    header: c.header,
    get: r => c.show ? c.show(r) : String(c.cell(r) ?? ''),
    numeric: c.numeric,
    ...(c.shade ? { shade: c.shade } : {}),
    ...(c.numeric ? { sortKey: (r: WaferRow) => { const v = c.cell(r); return typeof v === 'number' ? v : undefined; } } : {}),
  }));
  const table = createVirtualTable<WaferRow>({
    columns: vcols, rows, ariaLabel: `Wafers (${rows.length})`, ownerDocument: doc,
    onRowClick: deps.onOpenWafer ? (row, _i, col) => {
      const opens = shown[col]?.opens;
      deps.onOpenWafer!(row.item.waferIndex, row.item.label, typeof opens === 'object' ? opens.testNumber : undefined, opens === 'bins' ? 'bins' : undefined);
    } : undefined,
  });
  table.el.style.maxHeight = '70vh';
  table.el.style.minHeight = '120px';

  const csvCols = (): CsvColumn<WaferRow>[] => cols.map(c => ({ header: c.header, get: c.cell }));
  const cutNote = deps.testDefs.length > tests.length
    ? ` Mean columns cover the first ${tests.length} of ${deps.testDefs.length} tests.` : '';
  // What is the same on every wafer is said once, above the table.
  let el: HTMLElement = table.el;
  if (constantKeys.length) {
    const same = doc.createElement('div');
    same.dataset.wmapWafersSame = '1';
    same.textContent = `Same on every wafer: ${constantKeys.map(k => `${attributeLabel(k, deps.attributes)} ${metaOf(rows[0], k)}`).join(' · ')}`;
    Object.assign(same.style, { color: CLR.label, fontSize: FONT.body, lineHeight: '1.5', marginBottom: SPACE.sm } as Partial<CSSStyleDeclaration>);
    el = doc.createElement('div');
    el.append(same, table.el);
  }
  return {
    el,
    destroy: () => table.destroy(),
    actions: {
      note: () => `${plural(rows.length, 'wafer')}.${cutNote}${deps.onOpenWafer ? ' Click a row to open that wafer, on the test whose mean you click, or on its bins for its yield.' : ''} Export follows the order shown.`,
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
  options: ReadonlyArray<{ key: string; label: string; hint?: string }>,
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
    if (o.hint) wireTooltip(b, o.hint);
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
  items: ReadonlyArray<{ label: string; dies: Die[]; allDies?: Die[]; waferIndex?: number; wafer?: Wafer; passBins: readonly number[]; statsSummary?: DataItem['statsSummary'] }>;
  testDefs: TestDef[] | undefined;
  /** Set when the tables describe part of a population — a drilldown selection: who the dies are, in
   *  words ("selected on W03"). A saved file then says so in its name and a Wafer column. Omit for a whole wafer or lot. */
  population?: string;
  view: DataView;
  /** Which views to offer. Default Dies and Statistics, plus Wafers when there is more than one wafer. */
  views?: readonly DataView[];
  /** The wafers' ring count (`WaferMapResult.ringCount`): ring and quadrant columns use it. Required, never defaulted. */
  ringCount: number;
  metadataFields?: MetadataFieldDef[];
  /** The host's own wafer attributes, for the Wafers table's column names. */
  attributes?: Record<string, FacetCuration>;
  /** A die row clicked: show that die on its map, on the test whose column was clicked. The caller closes the table around it. */
  onLocateDie?: (die: Die, waferIndex: number | undefined, testNumber?: number) => void;
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
  const views = input.views ?? (items.length > 1 ? ['statistics', 'wafers', 'dies'] as const : ['statistics', 'dies'] as const);

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
      doc, items, testDefs: parametric, allTestDefs: allDefs, ringCount: input.ringCount,
      yieldByWaferIndex: new Map(), onSaveText: input.onSaveText,
      views, view, dieListOptions: input.dieListOptions, metadataFields: input.metadataFields, attributes: input.attributes, onLocateDie: input.onLocateDie,
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
  /** The wafers' ring count (from their built results): ring and quadrant columns use it. */
  ringCount: number;
  items: DataTablesInput['items'];
  testDefs: TestDef[] | undefined;
  population: string;
  view: DataView;
  onSaveText?: SaveTextHandler;
  onLocateDie?: DataTablesInput['onLocateDie'];
}): { el: HTMLElement; destroy: () => void } {
  // One row per wafer only means something when the population spans more than one.
  return renderDataTables({ ...input, views: input.items.length > 1 ? ['statistics', 'wafers', 'dies'] : ['statistics', 'dies'] });
}
