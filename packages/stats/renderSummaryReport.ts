import type { Die } from '../core/dies.js';
import type { Wafer } from '../core/wafer.js';
import { waferDisplayLabel } from '../core/waferLabel.js';
import type { WaferMetadata } from '../core/metadata.js';
import { binPassSets, binPassSetsByWafer, mergeBinDefs, resolveBinColors, resolveBinColorsByWafer, type BinColors, type BinPassGroup } from '../renderer/binColors.js';
import { commonPassBins, itemPassBins, passBinsLabel } from '../core/passBins.js';
import { itemRingCount } from '../core/ringCount.js';
import { isParametricTest, isBuiltMap, type BinDef, type TestDef, type YieldSummary, type WaferMapResult } from '../renderer/buildWaferMap.js';
import { buildRingRegions, buildQuadrantRegions, buildRegionYieldData } from './regions.js';
import type { StatsFinding, StatsSummary, LotStatsSummary, AnalyzeWaferMapOptions } from './types.js';
import { openHtmlReport } from './renderFindingsReport.js';
import { analyzeWaferLot } from './analyzeWaferLot.js';
import { computeFunctionalYield, analyzeWaferMap } from './analyzeWaferMap.js';
import { mergeTestDefs } from './mergeTestDefs.js';
import { buildFacetTable, facetValueOf, FACET_NONE_VALUE } from './facets.js';
import { visibleFindings } from './filterFindings.js';
import { buildYieldDataCombined } from './yield.js';
import { describeWaferPopulation, populationLabel } from './population.js';
import { buildTestPassRateData, hasJudgeableTests , poolFunctionalYield } from './testPassRate.js';
import { buildCapabilityData } from './capability.js';
import { buildSynthesis, type SynthesisTarget } from './synthesis.js';
import { binBreakdownRows, binBreakdownTitle, binCountsFrom, pooledBinCounts, totalOf } from './binRows.js';
import { MEAN_WAFER_YIELD_LABEL, shortfallLegend } from './presentation.js';
import { regionYieldRows, waferYieldRows } from './yieldRows.js';
import { describeValues } from './math.js';
import { fmt } from '../renderer/fmt.js';
import { getDieKey, isPositionedDie, diePassStatus } from '../core/dies.js';
import { excludedCounts, testValue } from '../core/dieTable.js';
import { limitSetName } from '../renderer/valueFilter.js';
import {
  findingsTableHtml,
  findingAnchor,
  synthesisSectionHtml,
  LIVE_FINDINGS_SCRIPT,
  barCell,
  deltaCell,
  withSectionNav,
  type TableCell,
  renderMetadataSection,
  renderMetricGrid,
  renderSection,
  renderTable,
  reportStyles,
} from './reportHtml.js';
import { escHtml } from '../core/utils.js';

export interface SummaryReportParams {
  wafer:        Wafer;
  dies:         Die[];
  yieldSummary: YieldSummary;
  dataCoverage: { filledDies: number; totalDies: number; edgeExcludedDies: number; ratio: number };
  hbinDefs?:    BinDef[];
  sbinDefs?:    BinDef[];
  testDefs?:    TestDef[];
  statsSummary?: StatsSummary;
  /** The map's own pass bins (`WaferMapResult.passBins`): required, there is no default to judge by instead. */
  passBins:     number[];
  /** The map's own ring count (`WaferMapResult.ringCount`): required, there is no default. */
  ringCount:    number;
  /** @internal The map's own bin colours, so a bar here is the colour of that bin on the map. Resolved with the default palette when omitted. */
  binColors?:   BinColors;
  /** @internal Shown inside the app: a click on a finding's row selects it on the map (see `LIVE_FINDINGS_SCRIPT`). */
  live?:        boolean;
}

function pct(n: number, d: number): string {
  return d === 0 ? '—' : `${((n / d) * 100).toFixed(1)}%`;
}

function titleFromMeta(meta?: Record<string, unknown>): string {
  if (!meta) return '';
  const lot   = meta['lot']   ?? meta['lotId'];
  const wafer = meta['wafer'] ?? meta['waferId'];
  const parts = [lot, wafer].filter(Boolean).map(String);
  return parts.length ? ` — ${parts.map(escHtml).join(' · ')}` : '';
}

// ── Section renderers ─────────────────────────────────────────────────────────


/**
 * One bin breakdown table, for a wafer or (with `passing` from every wafer's own pass bins) a lot: the
 * same rows the Summary panel draws as bars, in its order, with the map's colour behind each share.
 */
function binTable(
  counts: ReadonlyMap<number, number>,
  binDefs: BinDef[] | undefined,
  mode: 'hard' | 'soft',
  passing: ReadonlySet<number>,
  colors: ReadonlyMap<number, string> | undefined,
): string {
  if (!counts.size) return '';
  const rows = binBreakdownRows(counts, binDefs, passing).map((r): TableCell[] => {
    // Pass bins are written in grey so the fail bins, which are the point, carry the weight.
    const quiet = r.passing ? 'muted-row' : '';
    const cell = (text: string): TableCell => ({ html: escHtml(text), className: quiet });
    return [cell(String(r.bin)), cell(r.name ?? '—'), cell(String(r.count)), barCell(r.percent, `${r.percent.toFixed(1)}%`, quiet, colors?.get(r.bin))];
  });
  return renderSection(binBreakdownTitle(mode, totalOf(counts)), renderTable(['Bin', 'Name', 'Dies', 'Share'], rows, { className: 'compact' }));
}

/** Both bin types when the data has both, as the panel's Hard / Soft selector offers. */
function binSection(
  dies: Die[],
  hbinDefs: BinDef[] | undefined,
  sbinDefs: BinDef[] | undefined,
  /** Precomputed `StatsSummary.stats.{hard,soft}BinCounts`, used directly instead of re-walking `dies` when supplied. */
  precomputed: { hard?: Record<number, number>; soft?: Record<number, number> },
  passBins: number[],
  colors: BinColors,
): string {
  const passing = binPassSets(dies, passBins);
  return (['hard', 'soft'] as const).map((mode) => binTable(
    binCountsFrom(dies, mode, mode === 'hard' ? precomputed.hard : precomputed.soft),
    mode === 'hard' ? hbinDefs : sbinDefs, mode, passing[mode], colors[mode],
  )).join('\n');
}

function regionYieldSection(
  title: string,
  regions: Array<{ label: string; dieKeys: string[] }>,
  dies: Die[],
  passBins: readonly number[],
): string {
  const passSet  = new Set(passBins);
  const dieByKey = new Map(dies.map(d => [getDieKey(d), d]));
  const hasBins  = dies.some(d => d.hbin != null || d.sbin != null);
  if (!hasBins || !regions.length) return '';

  const tallies: Array<{ label: string; pass: number; total: number }> = [];
  for (const region of regions) {
    let pass = 0, total = 0;
    for (const key of region.dieKeys) {
      const d = dieByKey.get(key);
      if (!d || d.partial || d.edgeExcluded) continue;
      const verdict = diePassStatus(d, passSet);
      if (verdict === undefined) continue;
      total++;
      if (verdict) pass++;
    }
    if (!total) continue;
    tallies.push({ label: region.label, pass, total });
  }
  if (!tallies.length) return '';
  // The regions partition the wafer, so each is read against the wafer's own yield.
  const { rows: read } = regionYieldRows(tallies.map((r) => ({
    key: r.label, label: r.label, n: r.total, passDies: r.pass, yieldPercent: (r.pass / r.total) * 100,
  })));
  const rows: TableCell[][] = read.map((r) => [
    escHtml(r.label), String(r.passDies), String(r.n), barCell(r.yieldPercent, pct(r.passDies, r.n)), deltaCell(r.delta),
  ]);
  return renderSection(title, renderTable(['Region', 'Pass', 'Total', 'Yield', 'vs wafer'], rows, { className: 'compact' })
    + `<p class="report-legend">${shortfallLegend('the wafer')}</p>`);
}

/** What a Test Values row shows. The optional fields are absent where they cannot be had (a lot has no pooled quartiles). */
interface TestRowStats {
  testNumber: number;
  count: number;
  min: number;
  mean: number;
  max: number;
  q1?: number;
  median?: number;
  q3?: number;
  stddev?: number;
}

type SpecYieldRow = { testNumber: number; yieldPercent: number | null };

/** One test's statistics from the dies: the same `describeValues` the Summary panel's table uses. */
function describeTestFromDies(active: Die[], testNumber: number): TestRowStats | undefined {
  const values = new Float64Array(active.length);
  let n = 0;
  for (const d of active) {
    const v = testValue(d, testNumber);
    if (v !== undefined && Number.isFinite(v)) values[n++] = v;
  }
  if (n === 0) return undefined;
  const { count, min, mean, max, q1, median, q3, stddev } = describeValues(values.subarray(0, n));
  return { testNumber, count, min, mean, max, q1, median, q3, stddev };
}

/**
 * The Test Values table, with the columns of the Summary panel's full table that the data supports:
 * N, min, quartiles and median, mean, max, σ, and the share of dies inside the test's limits. A column
 * appears only when every row has it, so a table is never half-filled. Functional tests are not here
 * (every column is a parametric statistic) and have their own table.
 */
function testSection(
  dies: Die[],
  testDefs: TestDef[],
  /** Precomputed `StatsSummary.stats.perTestStats` (or its lot pooling); a test it lacks is described from `dies`. */
  precomputed?: readonly TestRowStats[],
  /** `StatsSummary.stats.testSpecYield`: the share of dies inside each test's limits. */
  specYield?: readonly SpecYieldRow[],
  /** Said under the table when the lot's statistics are pooled, so the missing columns are explained. */
  note?: string,
  /** The section's `id`, for the synthesis to link a test to. */
  anchorId?: string,
): string {
  if (!testDefs.length) return '';
  const active = dies.filter(d => !d.partial && !d.edgeExcluded);
  const known = new Map((precomputed ?? []).map(s => [s.testNumber, s]));
  const yields = new Map((specYield ?? []).map(y => [y.testNumber, y.yieldPercent]));

  const rows: Array<{ name: string; unit?: string; stats: TestRowStats; limitYield?: number | null }> = [];
  for (const def of testDefs.filter(isParametricTest)) {
    const stats = known.get(def.testNumber) ?? describeTestFromDies(active, def.testNumber);
    if (!stats) continue;
    rows.push({ name: def.name, unit: def.unit || undefined, stats, limitYield: yields.get(def.testNumber) });
  }
  if (!rows.length) return '';

  const all = (field: keyof TestRowStats): boolean => rows.every(r => r.stats[field] !== undefined);
  const hasQuartiles = all('q1') && all('median') && all('q3');
  const hasSigma = all('stddev');
  const hasLimitYield = rows.some(r => r.limitYield !== undefined && r.limitYield !== null);
  const value = (v: number | undefined, unit?: string): string => v === undefined ? '—' : fmt(v, unit);

  // Values the value filter took out are stated, never silent.
  const excl = excludedCounts(active);
  const exclNote = excl
    ? `${[...excl.counts.values()].reduce((x, y) => x + y, 0).toLocaleString('en-GB')} values outside the ${limitSetName(excl.by)} are excluded (not in N): `
      + [...excl.counts].map(([tn, c]) => `${testDefs.find(d => d.testNumber === tn)?.name ?? `test ${tn}`} ${c.toLocaleString('en-GB')}`).join(', ') + '. '
    : '';

  const headers = ['Test', 'N', 'Min', ...(hasQuartiles ? ['Q1', 'Median'] : []), 'Mean', ...(hasQuartiles ? ['Q3'] : []), 'Max',
    ...(hasSigma ? ['StdDev'] : []), ...(hasLimitYield ? ['Limit yield'] : [])];
  const body: TableCell[][] = rows.map(({ name, unit, stats: s, limitYield }) => [
    escHtml(name),
    { html: String(s.count), className: 'numeric' },
    value(s.min, unit),
    ...(hasQuartiles ? [value(s.q1, unit), value(s.median, unit)] : []),
    value(s.mean, unit),
    ...(hasQuartiles ? [value(s.q3, unit)] : []),
    value(s.max, unit),
    ...(hasSigma ? [value(s.stddev, unit)] : []),
    ...(hasLimitYield ? [limitYield === undefined || limitYield === null ? '—' : `${limitYield.toFixed(1)}%`] : []),
  ]);
  return renderSection('Test Values', renderTable(headers, body, { className: 'compact' })
    + `<p class="report-legend">${hasSigma ? 'StdDev is the sample standard deviation (n−1). ' : ''}${exclNote}${note ?? ''}</p>`, '', anchorId);
}

/**
 * "Functional Tests" table — pass/fail counts and pass rate for every
 * functional (`testType: 'F'`) test. `precomputed` accepts
 * `StatsSummary.stats.functionalYield` (or a lot-pooled equivalent); without
 * it the rows come from `computeFunctionalYield` over `dies`.
 */
function functionalSection(
  dies: Die[],
  testDefs: TestDef[],
  precomputed?: NonNullable<StatsSummary['stats']['functionalYield']>,
  /** The section's `id`, for the synthesis to link a test to. */
  anchorId?: string,
): string {
  const data = precomputed ?? computeFunctionalYield(dies, testDefs);
  if (!data?.length) return '';
  const rows = data.map(r => [
    escHtml(r.label),
    String(r.totalDies),
    String(r.passDies),
    String(r.failDies),
    r.passRatePercent !== null ? `${r.passRatePercent.toFixed(1)}%` : '—',
  ]);
  return renderSection('Functional Tests', renderTable(['Test', 'N', 'Pass', 'Fail', 'Pass Rate'], rows, { className: 'compact' }), '', anchorId);
}

/** Cp/Cpk/Pp/Ppk for every parametric test with recorded values — tests
 *  without both spec limits still get a row (spec/index columns show "—")
 *  since `buildCapabilityData` no longer excludes them. Empty string
 *  (section omitted, matching every other section's convention) only when
 *  there are no parametric tests with data at all. */
function capabilitySection(items: Array<{ dies?: Die[] }>, testDefs: TestDef[]): string {
  const data = buildCapabilityData(items, testDefs);
  if (!data.length) return '';
  const fmtIndex = (v: number | null) => v === null ? '—' : v.toFixed(2);
  const rows = data.map(d => [
    escHtml(d.label),
    d.hasSpec
      ? (d.limitBasis === 'spec' ? `LSL ${fmt(d.lsl!, d.unit)} – USL ${fmt(d.usl!, d.unit)}` : `Lo limit ${fmt(d.lsl!, d.unit)} – Hi limit ${fmt(d.usl!, d.unit)}`)
      : '—',
    fmt(d.mean, d.unit),
    fmtIndex(d.cp), fmtIndex(d.cpk), fmtIndex(d.pp), fmtIndex(d.ppk),
  ]);
  return renderSection('Process Capability', renderTable(
    ['Test', 'Limits', 'Mean', 'Cp', 'Cpk', 'Pp', 'Ppk'], rows, { className: 'compact' },
  ));
}

/** The findings table alone, for callers that supply their own heading — the
 *  per-wafer section renders one per wafer under a single section. */
function findingsSection(allFindings: StatsFinding[], totalWafers?: number, scope = '', live = false): string {
  // Absorbed restatements dropped, matching the Summary panel and the findings
  // report. Without this a wafer with 8 merged hard/soft twins printed 16 rows —
  // each merged row immediately followed by the bare row it had just absorbed.
  const findings = visibleFindings(allFindings);
  if (!findings.length) return '';
  return renderSection('Findings', findingsTableHtml(findings, totalWafers, scope, live));
}

/** Section ids a test can be linked to, scoped like the finding anchors. */
const testsAnchor = (scope: string): string => `report-tests-${scope}`;
const functionalAnchor = (scope: string): string => `report-functional-${scope}`;

/**
 * The synthesis, linked to its evidence on the same page: a finding to its row in the table
 * `findingsSection` anchors, a test to the Test Values or Functional Tests section it is in.
 */
function synthesisSection(
  summary: StatsSummary | LotStatsSummary, passBins: readonly number[] | undefined, scope: string,
  /** Each test's section, for the tests whose section is on the page. */
  testSections: ReadonlyMap<number, string>,
): string {
  const anchorIds = new Set(visibleFindings(summary.findings).map((f) => f.id));
  const anchorFor = (t: SynthesisTarget): string | undefined => t.kind === 'finding'
    ? (anchorIds.has(t.id) ? findingAnchor(t.id, scope) : undefined)
    : testSections.get(t.testNumber);
  return synthesisSectionHtml(buildSynthesis(summary, { passBins: passBins ? [...passBins] : undefined }), anchorFor);
}

/** Which section each test is in, given which of the two sections were rendered. */
function testSectionMap(testDefs: readonly TestDef[], scope: string, hasTests: boolean, hasFunctional: boolean): Map<number, string> {
  const out = new Map<number, string>();
  for (const d of testDefs) {
    if (isParametricTest(d) ? hasTests : hasFunctional) out.set(d.testNumber, isParametricTest(d) ? testsAnchor(scope) : functionalAnchor(scope));
  }
  return out;
}

// ── Public API ────────────────────────────────────────────────────────────────

/** Generate a full wafer summary as a standalone HTML string suitable for `openHtmlReport()`. */
export function renderSummaryReportHtml(
  params: SummaryReportParams,
  options: { title?: string } = {},
): string {
  const {
    wafer, dies, yieldSummary, dataCoverage,
    hbinDefs, sbinDefs, testDefs = [],
    statsSummary,
    passBins,
    ringCount } = params;
  // The map's own colours when the caller has them; the default palette otherwise.
  const binColorsFor = params.binColors ?? resolveBinColors(dies, { passBins, hbinDefs, sbinDefs });

  const meta   = wafer.metadata as Record<string, unknown> | undefined;
  const suffix = titleFromMeta(meta);
  const title  = options.title ?? `Wafer Summary${suffix}`;
  const now    = new Date().toLocaleString();

  // physX/physY are always set alongside x/y by construction.
  const positionedDies = dies.filter(isPositionedDie);
  const ringRegions     = buildRingRegions(positionedDies, wafer, ringCount);
  const quadrantRegions = buildQuadrantRegions(positionedDies, wafer, ringCount);

  // Pass/fail counts and fill coverage included, matching what the LOT report
  // has always shown (Good dies / Bad dies / Edge excluded / Partial). The wafer
  // report carried only Total dies and Yield — a reader could see 91.8% but not
  // how many dies failed, nor how much of the map had data at all, and the two
  // reports disagreed about what a summary is. `yieldSection` below built exactly
  // this grid and was left unreferenced when the slimmer version replaced it.
  //
  // yieldSummary.totalDies, not dataCoverage.totalDies: yield is deliberately
  // non-spatial and already includes coordinate-less dies with bin data, while
  // dataCoverage.totalDies is scoped to positioned dies only — which is the right
  // denominator for "Filled dies" and the wrong one for everything else.
  const summaryMetrics = [
    { label: 'Total dies', value: String(yieldSummary.totalDies) },
    { label: 'Filled dies', value: String(dataCoverage.filledDies), hint: `${pct(dataCoverage.filledDies, dataCoverage.totalDies)} fill` },
    { label: 'Pass dies', value: String(yieldSummary.passDies) },
    { label: 'Fail dies', value: String(yieldSummary.failDies) },
    ...(yieldSummary.partialDies > 0 ? [{ label: 'Partial', value: String(yieldSummary.partialDies) }] : []),
    ...(yieldSummary.yieldPercent !== null ? [{ label: `Yield (pass: ${passBinsLabel([passBins])})`, value: `${yieldSummary.yieldPercent.toFixed(1)}%` }] : []),
    ...(yieldSummary.edgeExcludedDies > 0 ? [{ label: 'Edge excluded (outer zone)', value: String(yieldSummary.edgeExcludedDies) }] : []),
  ];

  const testsHtml = testSection(dies, testDefs, statsSummary?.stats.perTestStats, statsSummary?.stats.testSpecYield, undefined, testsAnchor(''));
  const functionalHtml = functionalSection(dies, testDefs, statsSummary?.stats.functionalYield, functionalAnchor(''));
  const sections = [
    renderMetadataSection([{ metadata: wafer.metadata }]),
    renderSection('Summary', [
      renderMetricGrid(summaryMetrics),
    ].filter(Boolean).join('\n')),
    statsSummary ? synthesisSection(statsSummary, passBins, '', testSectionMap(testDefs, '', !!testsHtml, !!functionalHtml)) : '',
    binSection(dies, hbinDefs, sbinDefs, { hard: statsSummary?.stats.hardBinCounts, soft: statsSummary?.stats.softBinCounts }, passBins, binColorsFor),
    regionYieldSection('Ring Yield', ringRegions, dies, passBins),
    regionYieldSection('Quadrant Yield', quadrantRegions, dies, passBins),
    testsHtml,
    functionalHtml,
    capabilitySection([{ dies }], testDefs),
    statsSummary ? findingsSection(statsSummary.findings, undefined, '', params.live) : '',
  ].filter(Boolean).join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>${escHtml(title)}</title>
<style>
${reportStyles()}
</style>
</head>
<body>
<main class="report">
  <header class="report-header">
    <h1>${escHtml(title)}</h1>
    <p class="report-subtitle">Generated ${escHtml(now)}</p>
  </header>
  ${withSectionNav(sections)}
  <p class="footer">Generated ${escHtml(now)}</p>
</main>
${params.live ? LIVE_FINDINGS_SCRIPT : ''}
</body>
</html>`;
}

// ── Lot summary report ────────────────────────────────────────────────────────

export interface LotSummaryReportParams {
  /** One entry per wafer/item — grouping, per-group analysis (`analyzeWaferLot`),
   *  and rendering all happen internally; callers never pre-compute a lotSummary
   *  or pre-partition by lot identity themselves. */
  items:      Array<{
    label: string;
    wafer?: Wafer;
    dies?: Die[];
    /** This wafer's own pass bins (`WaferMapResult.passBins`). Omitted ⇒ the top-level `passBins`. */
    passBins?: number[];
    /** This wafer's own ring count (`WaferMapResult.ringCount`). Omitted ⇒ the top-level `ringCount`. */
    ringCount?: number;
    /** Reused directly as `analyzeWaferLot`'s `perWaferSummaries` — the expensive
     *  per-wafer pass (`analyzeWaferMap`) is never re-run here. */
    statsSummary?: StatsSummary;
    /**
     * @internal The built map these pieces came from, analysed in place of them.
     * The pieces alone are not an analysable map: `analyzeWaferLot` took them for
     * a fresh input with no results and analysed an EMPTY wafer, so a report for
     * wafers without a precomputed summary had no findings, no yields and lost
     * its lot title. `renderLotReportHtml` always sets it.
     */
    source?: WaferMapResult;
  }>;
  hbinDefs?:  BinDef[];
  sbinDefs?:  BinDef[];
  testDefs?:  TestDef[];
  /** For items that carry no `passBins` of their own (a hand-built map). No default: an item with neither is refused. */
  passBins?:  number[];
  /** For items that carry no `ringCount` of their own (a hand-built map); none ⇒ the first item's. No default. */
  ringCount?: number;
  /** Passthrough to the internal per-group `analyzeWaferLot` call, e.g. `{ enableTestValueAnalysis: true }`. */
  analyzeOptions?: AnalyzeWaferMapOptions;
  /** @internal The gallery's bin colours, so a bar here is the colour of that bin on the cards. Resolved per group with the default palette when omitted. */
  binColors?: BinColors;
  /** @internal Shown inside the app: a click on a finding's row selects it on the map. */
  live?: boolean;
}

function lotWaferYieldTable(lotSummary: LotStatsSummary, items: LotSummaryReportParams['items']): string {
  const yielded = lotSummary.perWafer.flatMap((pw) => {
    const y = pw.summary.stats.yieldPercent;
    return y === null ? [] : [{ waferIndex: pw.waferIndex, yieldPercent: y }];
  });
  const readBy = new Map(waferYieldRows(yielded).rows.map((r) => [r.waferIndex, r]));
  const rows = lotSummary.perWafer.map((pw): TableCell[] => {
    const label = escHtml(waferDisplayLabel(items[pw.waferIndex], pw.waferIndex));
    const r = readBy.get(pw.waferIndex);
    return r ? [r.outlier ? `${label} · ${r.outlier} outlier` : label, barCell(r.yieldPercent, `${r.yieldPercent.toFixed(1)}%`), deltaCell(r.delta)] : [label, 'N/A', ''];
  });
  return renderTable(['Wafer', 'Yield', 'vs lot median'], rows, { className: 'compact' })
    + `<p class="report-legend">${shortfallLegend('the lot median')}</p>`;
}

/** One row per item with a `wafer.metadata.split` assigned; items with no split are omitted. */
/**
 * Per-wafer findings, one block per wafer that has any.
 *
 * Distinct from `findingsSection` above, which lists the LOT-level findings —
 * cross-wafer patterns from `analyzeWaferLot`. Both belong in one report: they
 * answer different questions ("what is wrong with this lot" vs "what is wrong
 * with W07"), and until now the per-wafer half was only reachable through a
 * separate "Findings report" button that existed on some panel paths and not
 * others. Folding it in here is what let that button go away.
 */
function perWaferFindingsSection(lotSummary: LotStatsSummary): string {
  const blocks: string[] = [];
  for (const pw of lotSummary.perWafer) {
    const findings = visibleFindings(pw.summary.findings);
    if (!findings.length) continue;
    const label = waferDisplayLabel({ wafer: { metadata: pw.summary.wafer as WaferMetadata | undefined } }, pw.waferIndex);
    blocks.push(`<h3 class="report-subheading">${escHtml(label)}</h3>`
      + findingsTableHtml(findings));
  }
  if (!blocks.length) return '';
  // State the denominator: this section lists only wafers that HAVE findings, and
  // without saying so the absent ones read as "not analysed" rather than "clean".
  const withFindings = blocks.length;
  const total = lotSummary.perWafer.length;
  const note = `<p class="report-note">${withFindings} of ${total} wafer${total === 1 ? '' : 's'} have per-wafer findings; the rest had none.</p>`;
  return renderSection('Findings by Wafer', note + blocks.join('\n'));
}

/** How many splittable facets get their own comparison before the report stops.
 *  A load can carry many incidental facets (operator, tester, test date); past a
 *  few the report becomes a cross-product nobody reads. */
const MAX_SPLIT_FACETS = 3;

/**
 * Split comparison — the one thing a lot report could not express.
 *
 * This replaces a roster that listed each wafer against `metadata.split`: it
 * compared nothing, and it was hardcoded to a key literally named `split`, so any
 * other naming (`processSplit`, `implant`, `anneal`) produced no section at all.
 * Facets are now discovered with `buildFacetTable` — the same function the
 * Insights tab's "Group by" uses, so the report offers the comparisons the app
 * offers rather than a different, narrower set.
 *
 * For each splittable facet: which wafers are in which arm, the yield per arm,
 * and per-test pass rates per arm for every judgement the data supports. That is
 * what a split experiment is run to read, and until now it could be seen on
 * screen but never exported.
 */
function splitsSection(
  items: LotSummaryReportParams['items'],
  testDefs: TestDef[],
  passBins: readonly number[] | undefined,
): string {
  const facetItems = items.map(it => ({ metadata: it.wafer?.metadata }));
  const facets = buildFacetTable(facetItems, { facetableOnly: true }).filter(f => f.splittable);
  if (!facets.length) return '';

  const shown = facets.slice(0, MAX_SPLIT_FACETS);
  const blocks: string[] = [];

  for (const facet of shown) {
    const byValue = new Map<string, number[]>();
    items.forEach((it, i) => {
      const key = facetValueOf(it.wafer?.metadata, facet.key) ?? FACET_NONE_VALUE;
      (byValue.get(key) ?? byValue.set(key, []).get(key)!).push(i);
    });
    const groups = [...byValue.entries()].map(([key, idx]) => ({ key, items: idx.map(i => items[i]) }));
    if (groups.length < 2) continue;

    // Roster: which wafer sits in which arm. Kept from the old section — a
    // comparison of arms is unreadable without knowing what is in them.
    const roster = groups.map(g =>
      [escHtml(g.key), escHtml(g.items.map(it => it.label).join(', '))]);

    // Yield per arm, die-weighted within each arm (buildYieldDataCombined) — the
    // same computation the Insights yield chart uses when grouping is active.
    const yieldRows = buildYieldDataCombined(
      groups.map(g => ({ key: g.key, items: g.items.map(it => ({ label: it.label, dies: it.dies, passBins: itemPassBins(it, passBins) })) })),
    ).map(d => [escHtml(d.label), String(d.itemCount), `${d.percent.toFixed(1)}%`]);

    const tables = [
      renderTable([facet.label, 'Wafers'], roster, { className: 'compact' }),
      renderTable([facet.label, 'Wafers', 'Yield'], yieldRows, { className: 'compact' }),
    ];

    // Per-test pass rate per arm, one table per judgement the data supports. The
    // spec and tester-flag views are separate questions (see stats/testPassRate.ts)
    // and a split can look acceptable on one and marginal on the other, so
    // collapsing them here would hide the case worth exporting.
    const allDies = items.flatMap(it => it.dies ?? []);
    let disagreementDies = 0;
    for (const kind of ['spec', 'testFlag', 'functional'] as const) {
      if (!hasJudgeableTests(testDefs, kind, allDies)) continue;
      const data = buildTestPassRateData(
        groups.map(g => ({
          key: g.key,
          items: g.items.map(it => ({
            dies: it.dies,
            testSpecYield: it.statsSummary?.stats.testSpecYield,
            functionalYield: it.statsSummary?.stats.functionalYield })) })),
        testDefs, kind,
      );
      if (!data.rows.length) continue;
      const rows = data.rows.map(r => [
        escHtml(r.label),
        ...r.byGroup.map(v => v.passRatePercent === null ? '—' : `${v.passRatePercent.toFixed(1)}%`),
        r.overall.passRatePercent === null ? '—' : `${r.overall.passRatePercent.toFixed(1)}%`,
      ]);
      const heading = kind === 'spec' ? 'Pass rate · test limits'
        : kind === 'testFlag' ? 'Pass rate · tester flag'
        : 'Pass rate · functional';
      // The disagreement count is a property of the facet's population, not of
      // either table, so it is emitted once below rather than repeated under both
      // parametric views.
      if (data.disagreementDies) disagreementDies = data.disagreementDies;
      tables.push(`<h4 class="report-subheading">${escHtml(heading)}</h4>`
        // `renderTable` escapes its own headers (reportHtml.ts), so escaping
        // here too double-encodes: a split arm named "R&D" printed as "R&amp;D".
        + renderTable([...['Test'], ...data.groups, 'All'], rows, { className: 'compact' }));
    }
    if (disagreementDies) {
      tables.push(`<p class="report-note">${disagreementDies.toLocaleString()} dies judged differently by limits and tester flag.</p>`);
    }

    blocks.push(`<h3 class="report-subheading">${escHtml(facet.label)}</h3>${tables.join('\n')}`);
  }

  if (!blocks.length) return '';
  const omitted = facets.length > shown.length
    ? `<p class="report-note">${facets.length - shown.length} further splittable field(s) not shown.</p>`
    : '';
  return renderSection('Split Comparison', blocks.join('\n') + omitted);
}

/**
 * When every wafer's `StatsSummary.stats.{hard,soft}BinCounts` is available
 * (`perWaferSummaries`), sums those directly instead of re-walking `allDies`.
 */
/** The lot's bin breakdowns, hard and soft where the data has both, each wafer judged by its own pass bins. */
function lotBinSections(
  allDies: Die[],
  hbinDefs: BinDef[] | undefined,
  sbinDefs: BinDef[] | undefined,
  perWaferSummaries: StatsSummary[] | undefined,
  /** Each wafer's dies with its own pass bins — a lot can mix programs. */
  passGroups: BinPassGroup[],
  colors: BinColors,
): string {
  const passing = binPassSetsByWafer(passGroups);
  return (['hard', 'soft'] as const).map((mode) => binTable(
    pooledBinCounts(perWaferSummaries, allDies, mode),
    mode === 'hard' ? hbinDefs : sbinDefs, mode, passing[mode], colors[mode],
  )).join('\n');
}

function lotRegionYieldTable(
  title: string,
  regionFn: typeof buildRingRegions,
  diesByWafer: Die[][],
  allWafers: Wafer[],
  ringCount: number,
  /** Index-aligned with `allWafers`: each wafer's own pass bins. */
  passBinsByWafer: readonly (readonly number[])[],
): string {
  // The shared computation (stats/regions.ts), not a copy of it: this table
  // used to re-implement the same per-region pass/total tally, with its own
  // `hbin ?? sbin` verdict and one lot-wide pass-bin list.
  const data = buildRegionYieldData(diesByWafer, allWafers, ringCount, (wi) => passBinsByWafer[wi], regionFn);
  if (!data.length) return '';
  // The regions partition the lot's wafers, so each is read against the lot's own yield.
  const rows = regionYieldRows(data).rows.map((d): TableCell[] => [
    escHtml(d.label), barCell(d.yieldPercent, `${d.yieldPercent.toFixed(1)}%`), deltaCell(d.delta),
  ]);
  return renderSection(title, renderTable(['Region', 'Yield', 'vs lot'], rows, { className: 'compact' })
    + `<p class="report-legend">${shortfallLegend('the lot')}</p>`);
}

/**
 * When every wafer's `StatsSummary.stats.perTestStats` is available
 * (`perWaferSummaries`), pools mean (n-weighted)/min/max directly from those
 * instead of re-walking `allDies` — see `testSection`'s doc comment.
 */
function lotTestTable(
  allDies: Die[],
  testDefs: TestDef[],
  perWaferSummaries?: StatsSummary[],
  /** `LotStatsSummary.stats.testSpecYield`. */
  specYield?: readonly SpecYieldRow[],
  anchorId?: string,
): string {
  let pooled: TestRowStats[] | undefined;
  if (perWaferSummaries?.length && perWaferSummaries.every(s => s.stats.perTestStats !== undefined)) {
    // Count, min, max and mean combine exactly across wafers, and so does the population variance
    // (the sum of each wafer's own variance and its mean's distance from the pooled mean). Quartiles
    // do not combine from per-wafer quartiles, so a lot has none.
    const byTest = new Map<number, { n: number; sum: number; min: number; max: number; parts: Array<{ n: number; mean: number; sd?: number }> }>();
    for (const s of perWaferSummaries) {
      for (const t of s.stats.perTestStats ?? []) {
        const acc = byTest.get(t.testNumber) ?? { n: 0, sum: 0, min: Infinity, max: -Infinity, parts: [] };
        acc.n += t.count;
        acc.sum += t.mean * t.count;
        acc.min = Math.min(acc.min, t.min);
        acc.max = Math.max(acc.max, t.max);
        acc.parts.push({ n: t.count, mean: t.mean, sd: t.stddev });
        byTest.set(t.testNumber, acc);
      }
    }
    pooled = [...byTest.entries()].map(([testNumber, acc]) => {
      const mean = acc.sum / acc.n;
      const exact = acc.parts.every(p => p.sd !== undefined);
      // Exact sample variance of the pooled values from each wafer's (n, mean, sample σ).
      const variance = exact && acc.n > 1
        ? acc.parts.reduce((v, p) => v + Math.max(0, p.n - 1) * p.sd! ** 2 + p.n * (p.mean - mean) ** 2, 0) / (acc.n - 1)
        : exact ? 0 : undefined;
      return { testNumber, count: acc.n, min: acc.min, max: acc.max, mean, ...(variance !== undefined ? { stddev: Math.sqrt(variance) } : {}) };
    });
  }
  return testSection(allDies, testDefs, pooled, specYield,
    pooled ? 'Quartiles are not shown for a lot: they cannot be combined from each wafer\u2019s own.' : undefined, anchorId);
}

/**
 * Lot-pooled "Functional Tests" table: sums pass/fail/verdict counts across
 * per-wafer `StatsSummary.stats.functionalYield` when every wafer has one
 * (counts pool losslessly); otherwise recomputes from the pooled dies.
 */
function lotFunctionalTable(allDies: Die[], testDefs: TestDef[], perWaferSummaries?: StatsSummary[], anchorId?: string): string {
  const pooled = poolFunctionalYield(perWaferSummaries);
  return functionalSection(allDies, testDefs, pooled, anchorId);
}

// Identity fields that must never be silently pooled across a lot report —
// distinct from buildFacetTable's general "groupable dimension" curation
// (used by the Analysis tab's interactive "Group by", which deliberately
// includes `split`): a report explodes into one section per DISTINCT value
// of these fields, but must never explode just because wafers have
// different splits — comparing splits *within* one report is the point of
// that feature, not a reason to separate them into different documents.
const IDENTITY_FIELDS = ['lot', 'product', 'testProgram', 'temperature'] as const;

/** Partition items by whichever identity fields actually vary across them.
 *  Single group with an empty label when nothing varies — the common case,
 *  byte-identical output to a plain single-lot report. `varying` is returned
 *  alongside each group so a multi-group title can tell whether `lot` was
 *  already folded into `label` or needs adding separately (see
 *  `renderLotSummaryReportHtml` — a group split on `temperature` alone must
 *  still show its lot number, not just the bare temperature value). */
function groupByIdentity(
  items: LotSummaryReportParams['items'],
): Array<{ label: string; items: LotSummaryReportParams['items']; varying: readonly string[] }> {
  // Single pass collecting every field's distinct-value set together, rather
  // than one full pass over `items` per field — cheap either way at
  // wafer-count scale, but there's no reason to walk the list four times
  // for four independent field lookups.
  const valuesByField = new Map<string, Set<string>>(IDENTITY_FIELDS.map((f) => [f, new Set<string>()]));
  for (const item of items) {
    for (const field of IDENTITY_FIELDS) {
      const v = item.wafer?.metadata?.[field];
      if (v !== undefined && v !== null && v !== '') valuesByField.get(field)!.add(String(v));
    }
  }
  const varying = IDENTITY_FIELDS.filter((field) => valuesByField.get(field)!.size > 1);
  if (varying.length === 0) return [{ label: '', items, varying }];

  const map = new Map<string, LotSummaryReportParams['items']>();
  const order: string[] = [];
  for (const item of items) {
    const key = varying.map((f) => String(item.wafer?.metadata?.[f] ?? '(none)')).join(' · ');
    if (!map.has(key)) { map.set(key, []); order.push(key); }
    map.get(key)!.push(item);
  }
  return order.map((key) => ({ label: key, items: map.get(key)!, varying }));
}

/** Renders one identity-homogeneous group's sections (everything that goes
 *  inside a `<main class="report">` block) plus the `LotStatsSummary` it
 *  computed, so the caller can derive a title from `lotSummary.lot` for the
 *  common single-group case without a second, redundant analysis pass. */
function renderLotGroupSections(
  items: LotSummaryReportParams['items'],
  hbinDefs: BinDef[] | undefined,
  sbinDefs: BinDef[] | undefined,
  testDefs: TestDef[],
  /** For items that carry no pass bins of their own; none ⇒ such an item is refused. */
  passBins: readonly number[] | undefined,
  ringCount: number | undefined,
  analyzeOptions: AnalyzeWaferMapOptions | undefined,
  /** The map's own bin colours, when the caller has them; resolved over this group's wafers otherwise. */
  binColors: BinColors | undefined,
  /** Prefix for ids, so several groups in one document cannot share one. */
  scope = '',
  live = false,
): { lotSummary: LotStatsSummary; sections: string } {
  const lotSummary = analyzeWaferLot(items.map((it) => it.source ?? (it as unknown as WaferMapResult)), {
    // Index-aligned; analyzeWaferLot falls back to computing analyzeWaferMap
    // per-index when an entry is missing (its own `perWaferSummaries?.[i] ??
    // analyzeWaferMap(...)` logic), so a partial or absent array is safe —
    // the cast just satisfies the declared StatsSummary[] element type.
    perWaferSummaries: items.map((i) => i.statsSummary) as StatsSummary[],
    ...analyzeOptions });

  // diesByWafer keeps each wafer's dies in a parallel array — aligned by index with
  // allWafers — instead of tagging caller-owned Die objects with a hidden field.
  // Stats must be side-effect-free; mutating input dies violated that. (The old
  // tag also indexed by item position while the region table indexed by wafer
  // position, so the two diverged whenever an item had dies but no wafer.)
  const allWafers: Wafer[] = [];
  const allDies: Die[] = [];
  const diesByWafer: Die[][] = [];
  // Aligned with allWafers/diesByWafer: each wafer's own pass bins.
  const passBinsByWafer: (readonly number[])[] = [];
  for (const item of items) {
    const wDies = item.dies ?? [];
    if (item.wafer) {
      allWafers.push(item.wafer);
      diesByWafer.push(wDies);
      passBinsByWafer.push(itemPassBins(item, passBins));
    }
    // A loop, not `allDies.push(...wDies)`: the spread passes one argument per
    // die, and V8 throws RangeError above ~131k of them — so this failed on a
    // single wafer with more dies than that, while any lot of ordinary wafers
    // passed.
    for (const d of wDies) allDies.push(d);
  }
  // Every item's dies with its own pass bins, including items without a wafer.
  const passGroups: BinPassGroup[] = items.map((it) => ({ dies: it.dies ?? [], passBins: itemPassBins(it, passBins) }));
  const binColorsFor = binColors ?? resolveBinColorsByWafer(passGroups, { hbinDefs, sbinDefs }).colors;

  const hasHbin = allDies.some((die) => die.hbin != null);
  const hasSbin = allDies.some((die) => die.sbin != null);
  const hasBins = hasHbin || hasSbin;

  // Unweighted across wafers — each wafer counts equally regardless of its die
  // count. Distinct from totalYieldPercent below (die-count-weighted), which
  // is the "how many good parts did I actually get" number. Labeled "Mean
  // wafer yield" (not just "Mean yield") so the two are never confused.
  const waferYields = lotSummary.perWafer
    .map((pw) => pw.summary.stats.yieldPercent)
    .filter((y): y is number => y !== null);
  const meanWaferYield = waferYields.length
    ? waferYields.reduce((a, b) => a + b, 0) / waferYields.length
    : null;

  // Lot-wide die counts and die-count-weighted total yield — same
  // partial/edgeExcluded exclusion and hbin??sbin fallback used by
  // regionYieldSection/lotRegionYieldTable below, just walked once over every
  // die instead of per-region. Small-lot/characterization workflows need the
  // exact good/bad part counts, not just a percentage.
  // Each wafer's dies judged by that wafer's OWN pass bins, through
  // diePassStatus (the rule yield uses) — one lot-wide list would call a
  // wafer's good dies bad whenever the lot mixes test programs.
  let totalDies = 0, analyzedDies = 0, goodDies = 0, edgeExcludedDies = 0, partialDies = 0;
  for (const group of passGroups) {
    const passSet = new Set(group.passBins);
    for (const d of group.dies) {
      totalDies++;
      if (d.edgeExcluded) edgeExcludedDies++;
      if (d.partial) partialDies++;
      if (d.partial || d.edgeExcluded) continue;
      const verdict = diePassStatus(d, passSet);
      if (verdict === undefined) continue;
      analyzedDies++;
      if (verdict) goodDies++;
    }
  }
  const badDies = analyzedDies - goodDies;
  const totalYieldPercent = analyzedDies > 0 ? (goodDies / analyzedDies) * 100 : null;

  const overviewMetrics = [
    { label: 'Wafers', value: String(lotSummary.stats.waferCount) },
    { label: 'Total dies', value: String(totalDies) },
    ...(hasBins ? [
      { label: 'Good dies', value: String(goodDies) },
      { label: 'Bad dies', value: String(badDies) },
    ] : []),
    ...(edgeExcludedDies > 0 ? [{ label: 'Edge excluded', value: String(edgeExcludedDies) }] : []),
    ...(partialDies > 0 ? [{ label: 'Partial dies', value: String(partialDies) }] : []),
    ...(meanWaferYield !== null ? [{ label: MEAN_WAFER_YIELD_LABEL, value: `${meanWaferYield.toFixed(1)}%` }] : []),
    ...(totalYieldPercent !== null ? [{ label: 'Total yield', value: `${totalYieldPercent.toFixed(1)}%` }] : []),
  ];

  const population = describeWaferPopulation(lotSummary.perWafer.map((pw) => pw.summary.wafer));
  const summarySection = renderSection(population.lotId !== undefined ? 'Lot Summary' : 'Summary', renderMetricGrid(overviewMetrics));
  const metadataSection = renderMetadataSection(items.map((it) => ({ metadata: it.wafer?.metadata })));
  const waferYieldSection = renderSection('Per-Wafer Yield', lotWaferYieldTable(lotSummary, items));
  // The lot-level ring tables use one ring count: the caller's own, else the first wafer's (mixed counts are named elsewhere).
  const lotRing = ringCount ?? itemRingCount(items[0]);
  const splitsSectionHtml = splitsSection(items, testDefs, passBins);
  const perWaferSummaries = lotSummary.perWafer.map((pw) => pw.summary);
  const binSection = hasBins ? lotBinSections(allDies, hbinDefs, sbinDefs, perWaferSummaries, passGroups, binColorsFor) : '';
  const ringSection = hasBins && allWafers.length
    ? lotRegionYieldTable('Ring Yield (All Wafers)', buildRingRegions, diesByWafer, allWafers, lotRing, passBinsByWafer)
    : '';
  const quadSection = hasBins && allWafers.length
    ? lotRegionYieldTable('Quadrant Yield (All Wafers)', buildQuadrantRegions, diesByWafer, allWafers, lotRing, passBinsByWafer)
    : '';
  const testSectionHtml = testDefs.length ? lotTestTable(allDies, testDefs, perWaferSummaries, lotSummary.stats.testSpecYield, testsAnchor(scope)) : '';
  const functionalSectionHtml = testDefs.length ? lotFunctionalTable(allDies, testDefs, perWaferSummaries, functionalAnchor(scope)) : '';
  const capabilitySectionHtml = testDefs.length ? capabilitySection(items, testDefs) : '';
  const findingsSectionHtml = lotSummary.findings.length ? findingsSection(lotSummary.findings, lotSummary.stats.waferCount, scope, live) : '';
  const perWaferFindingsHtml = perWaferFindingsSection(lotSummary);

  const sections = [
    summarySection,
    synthesisSection(lotSummary, commonPassBins(passGroups.map((g) => g.passBins)), scope,
      testSectionMap(testDefs, scope, !!testSectionHtml, !!functionalSectionHtml)),
    metadataSection,
    waferYieldSection,
    splitsSectionHtml,
    binSection,
    ringSection,
    quadSection,
    testSectionHtml,
    functionalSectionHtml,
    capabilitySectionHtml,
    findingsSectionHtml,
    perWaferFindingsHtml,
  ].filter(Boolean).join('\n');

  return { lotSummary, sections };
}

function reportMain(title: string, sections: string, now: string, scope = ''): string {
  return `<main class="report">
  <header class="report-header">
    <h1>${escHtml(title)}</h1>
    <p class="report-subtitle">Generated ${escHtml(now)}</p>
  </header>
  ${withSectionNav(sections, scope)}
  <p class="footer">Generated ${escHtml(now)}</p>
</main>`;
}

/**
 * Generate a full lot summary as a standalone HTML string suitable for
 * `openHtmlReport()`. Grouping, per-group analysis, and rendering all
 * happen internally — see `groupByIdentity` — so a caller never needs to
 * pre-partition a multi-lot/multi-product/multi-temperature load itself:
 * a single call always returns one complete document, whether that's one
 * `<main>` (the common case) or several side by side with a banner
 * explaining the split.
 */
export function renderLotSummaryReportHtml(
  params: LotSummaryReportParams,
  options: { title?: string } = {},
): string {
  const {
    items,
    hbinDefs,
    sbinDefs,
    testDefs = [],
    passBins,
    ringCount,
    analyzeOptions } = params;

  const now = new Date().toLocaleString();
  const groups = groupByIdentity(items);

  if (groups.length === 1) {
    const { lotSummary, sections } = renderLotGroupSections(groups[0].items, hbinDefs, sbinDefs, testDefs, passBins, ringCount, analyzeOptions, params.binColors, '', params.live);
    // "Lot Summary — LOT123" only when every wafer records that lot; otherwise
    // the title names the wafers, so a pooled or unlabelled set never reads as
    // one lot. (`lotSummary.lot` is not enough: it keeps a key that the wafers
    // carrying it agree on, even when other wafers carry none.)
    const population = describeWaferPopulation(lotSummary.perWafer.map((pw) => pw.summary.wafer));
    const title = options.title ?? (population.lotId !== undefined
      ? `Lot Summary — ${population.lotId}`
      : `Summary — ${populationLabel(population)}`);
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>${escHtml(title)}</title>
<style>
${reportStyles()}
</style>
</head>
<body>
${reportMain(title, sections, now)}
${params.live ? LIVE_FINDINGS_SCRIPT : ''}
</body>
</html>`;
  }

  // Each group's own title (`${title} — ${label}`) already distinguishes it
  // via its own `.report-header` — no need for a second, redundant divider
  // heading. Just space consecutive groups apart with a rule.
  // Several groups: the set as a whole is not one lot, so the base title does
  // not claim to be; each group's heading names its own lot where it has one.
  const baseTitle = options.title ?? 'Summary';
  const mains = groups.map((g, gi) => {
    const scope = `g${gi + 1}-`;
    const { lotSummary, sections } = renderLotGroupSections(g.items, hbinDefs, sbinDefs, testDefs, passBins, ringCount, analyzeOptions, params.binColors, scope, params.live);
    // `label` already names every field that varies BETWEEN groups (e.g.
    // "85" when only temperature splits them) — but if `lot` itself doesn't
    // vary, it's constant across every group and would otherwise never
    // appear anywhere in a multi-group report. Add it explicitly so a
    // header is never just a bare non-lot field value with no lot number
    // visible anywhere in that group's section.
    const lotTag = !g.varying.includes('lot') ? (lotSummary.lot?.['lot'] ?? lotSummary.lot?.['lotId']) : undefined;
    const heading = lotTag ? `${g.label} · Lot ${String(lotTag)}` : g.label;
    return reportMain(`${baseTitle} — ${heading}`, sections, now, scope);
  });

  const banner = `<p style="max-width:1080px;margin:0 auto 8px;padding:8px 12px;background:var(--report-surface);border:1px solid var(--report-line);border-radius:4px;font-size:12px;color:var(--report-muted);">This load spans ${groups.length} groups by identity — shown separately below so stats are never pooled across them.</p>`;

  const sectionsHtml = mains.map((m, i) => {
    const spacer = i === 0 ? '' : '<hr style="max-width:1080px;margin:32px auto 0;border:none;border-top:3px solid var(--report-line-strong);">';
    return `${spacer}\n${m}`;
  }).join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>${escHtml(baseTitle)}</title>
<style>
${reportStyles()}
</style>
</head>
<body>
<div class="report" style="padding-top:24px;">
${banner}
</div>
${sectionsHtml}
${params.live ? LIVE_FINDINGS_SCRIPT : ''}
</body>
</html>`;
}

export { openHtmlReport };

// ── Report builders from built maps ───────────────────────────────────────────
// The supported way to produce a report without the UI — a nightly lot report,
// an archive of each wafer's, an email. They take built maps, which always carry
// their own pass bins and ring count, so a report cannot silently judge by bin 1
// or draw four rings for a map built with six. The library's own report buttons
// use these too.

/** A built map as the report builders read it. A `WaferMapResult` is one. */
export type ReportMap = Pick<WaferMapResult, 'wafer' | 'dies' | 'passBins' | 'ringCount'>
  & Partial<Pick<WaferMapResult, 'hbinDefs' | 'sbinDefs' | 'testDefs'>>
  & {
    /** The name to show for this wafer; defaults to its wafer ID. */
    label?: string;
    /** This wafer's analysis, when already run — reused, never recomputed. */
    statsSummary?: StatsSummary;
  };

/**
 * The wafer summary report for one built map, as a standalone HTML document.
 * Analyses the map with `analyzeWaferMap` when `summary` is not given and the
 * map is a built `WaferMapResult`; a map assembled from pieces is not analysable
 * (the analysis would take it for a fresh input with no results), so its report
 * has no findings section rather than findings of an empty wafer.
 */
export function renderWaferReportHtml(
  map: ReportMap & { yield: YieldSummary; dataCoverage: SummaryReportParams['dataCoverage'] },
  summary?: StatsSummary,
  options: { title?: string; /** @internal */ binColors?: BinColors; /** @internal */ live?: boolean } = {},
): string {
  return renderSummaryReportHtml({
    wafer:        map.wafer,
    dies:         map.dies,
    yieldSummary: map.yield,
    dataCoverage: map.dataCoverage,
    hbinDefs:     map.hbinDefs,
    sbinDefs:     map.sbinDefs,
    testDefs:     map.testDefs,
    statsSummary: summary ?? map.statsSummary ?? (isBuiltMap(map) ? analyzeWaferMap(map) : undefined),
    passBins:     [...map.passBins],
    ringCount:    map.ringCount,
    binColors:    options.binColors,
    live:         options.live,
  }, options);
}

/**
 * The lot summary report for several built maps, as a standalone HTML document.
 * Wafers are grouped by lot identity inside; bin and test definitions are merged
 * across the maps; each wafer is judged by its own pass bins. Lot-level ring
 * figures use the first map's ring count, as the gallery does.
 */
export function renderLotReportHtml(
  maps: readonly ReportMap[],
  options: { title?: string; analyzeOptions?: AnalyzeWaferMapOptions; /** @internal */ binColors?: BinColors; /** @internal */ live?: boolean } = {},
): string {
  const hbinDefs = mergeBinDefs(maps.map(m => m.hbinDefs));
  const sbinDefs = mergeBinDefs(maps.map(m => m.sbinDefs));
  const testDefs = maps.some(m => m.testDefs?.length) ? mergeTestDefs([...maps]).defs : undefined;
  return renderLotSummaryReportHtml({
    items: maps.map((m, i) => ({
      label:        waferDisplayLabel(m, i),
      wafer:        m.wafer,
      dies:         m.dies,
      passBins:     [...m.passBins],
      statsSummary: m.statsSummary,
      // A hand-assembled ReportMap is analysed from its pieces.
      source:       isBuiltMap(m) ? m : undefined,
    })),
    hbinDefs: hbinDefs.length ? hbinDefs : undefined,
    sbinDefs: sbinDefs.length ? sbinDefs : undefined,
    testDefs,
    ringCount: maps[0]?.ringCount,
    analyzeOptions: options.analyzeOptions,
    binColors: options.binColors,
    live: options.live,
  }, { title: options.title });
}
