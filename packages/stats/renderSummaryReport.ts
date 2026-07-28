import type { Die } from '../core/dies.js';
import type { Wafer } from '../core/wafer.js';
import { isParametricTest, type BinDef, type TestDef, type YieldSummary } from '../renderer/buildWaferMap.js';
import { buildRingRegions, buildQuadrantRegions } from './regions.js';
import type { StatsFinding, StatsSummary, LotStatsSummary, AnalyzeWaferMapOptions } from './types.js';
import { openHtmlReport } from './renderFindingsReport.js';
import { analyzeWaferLot } from './analyzeWaferLot.js';
import { computeFunctionalYield } from './analyzeWaferMap.js';
import { buildCapabilityData } from './capability.js';
import { fmt } from '../renderer/fmt.js';
import { getDieKey } from '../core/dies.js';
import {
  formatFindingDelta,
  formatFindingCoverage,
  formatFindingTooltip,
  escHtml,
  renderMetadataSection,
  renderMetricGrid,
  renderSection,
  renderSeverityBadge,
  renderTable,
  reportStyles,
} from './reportHtml.js';

export interface SummaryReportParams {
  wafer:        Wafer;
  dies:         Die[];
  yieldSummary: YieldSummary;
  dataCoverage: { filledDies: number; totalDies: number; edgeExcludedDies: number; ratio: number };
  hbinDefs?:    BinDef[];
  sbinDefs?:    BinDef[];
  testDefs?:    TestDef[];
  statsSummary?: StatsSummary;
  passBins?:    number[];
  ringCount?:   number;
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

function yieldSection(y: YieldSummary, cov: SummaryReportParams['dataCoverage']): string {
  const metrics = [
    { label: 'Total dies', value: String(cov.totalDies) },
    { label: 'Filled dies', value: String(cov.filledDies), hint: `${pct(cov.filledDies, cov.totalDies)} fill` },
    { label: 'Pass dies', value: String(y.passDies) },
    { label: 'Fail dies', value: String(y.failDies) },
    ...(y.edgeExcludedDies > 0 ? [{ label: 'Edge excluded', value: String(y.edgeExcludedDies) }] : []),
    ...(y.partialDies > 0 ? [{ label: 'Partial dies', value: String(y.partialDies) }] : []),
    { label: 'Yield', value: y.yieldPercent !== null ? `${y.yieldPercent.toFixed(1)}%` : 'N/A' },
  ];
  return renderSection('Yield', renderMetricGrid(metrics));
}

function binSection(
  dies: Die[],
  binDefs: BinDef[] | undefined,
  mode: 'hard' | 'soft',
  /** Precomputed `StatsSummary.stats.{hard,soft}BinCounts`, used directly instead of re-walking `dies` when supplied. */
  precomputedCounts?: Record<number, number>,
): string {
  const counts = new Map<number, number>();
  if (precomputedCounts) {
    for (const [binStr, count] of Object.entries(precomputedCounts)) counts.set(Number(binStr), count);
  } else {
    for (const d of dies) {
      if (d.partial || d.edgeExcluded) continue;
      const b = mode === 'hard' ? d.hbin : d.sbin;
      if (b != null) counts.set(b, (counts.get(b) ?? 0) + 1);
    }
  }
  if (!counts.size) return '';
  const total = [...counts.values()].reduce((a, b) => a + b, 0);
  const defMap = binDefs ? new Map(binDefs.map(d => [d.bin, d])) : null;
  const rows = [...counts.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([bin, count]) => {
      const def  = defMap?.get(bin);
      const name = def?.name ?? '—';
      return [String(bin), name, String(count), pct(count, total)];
    });
  const title = mode === 'hard' ? 'Hard Bin Breakdown' : 'Soft Bin Breakdown';
  return renderSection(title, renderTable(['Bin', 'Name', 'Count', '%'], rows, { className: 'compact' }));
}

function regionYieldSection(
  title: string,
  regions: Array<{ label: string; dieKeys: string[] }>,
  dies: Die[],
  passBins: number[],
): string {
  const passSet  = new Set(passBins);
  const dieByKey = new Map(dies.map(d => [getDieKey(d), d]));
  const hasBins  = dies.some(d => d.hbin != null || d.sbin != null);
  if (!hasBins || !regions.length) return '';

  const rows: string[][] = [];
  for (const region of regions) {
    let pass = 0, total = 0;
    for (const key of region.dieKeys) {
      const d = dieByKey.get(key);
      if (!d || d.partial || d.edgeExcluded) continue;
      const b = d.hbin ?? d.sbin;
      if (b == null) continue;
      total++;
      if (passSet.has(b)) pass++;
    }
    if (!total) continue;
    rows.push([region.label, String(pass), String(total), pct(pass, total)]);
  }
  return rows.length ? renderSection(title, renderTable(['Region', 'Pass', 'Total', 'Yield'], rows, { className: 'compact' })) : '';
}

function testSection(
  dies: Die[],
  testDefs: TestDef[],
  /** Precomputed `StatsSummary.stats.perTestStats`, used directly instead of re-walking `dies` per-test when a test is present. */
  precomputedPerTestStats?: Array<{ testNumber: number; min: number; max: number; mean: number }>,
): string {
  if (!testDefs.length) return '';
  const active = dies.filter(d => !d.partial && !d.edgeExcluded);
  const precomputedByNumber = new Map((precomputedPerTestStats ?? []).map(s => [s.testNumber, s]));
  const rows: string[][] = [];

  // Min/mean/max are parametric statistics — functional (pass/fail) tests are excluded.
  for (const def of testDefs.filter(isParametricTest)) {
    const tn = def.testNumber ?? def.index;
    if (tn === undefined) continue;
    const unit = def.unit || undefined;

    const precomputed = precomputedByNumber.get(tn);
    let min: number, max: number, mean: number;
    if (precomputed) {
      ({ min, max, mean } = precomputed);
    } else {
      const vals = active
        .map(d => d.testValues?.[tn] ?? d.values?.[def.index ?? tn])
        .filter((v): v is number => v !== undefined && isFinite(v));
      if (!vals.length) continue;
      vals.sort((a, b) => a - b);
      min = vals[0];
      max = vals[vals.length - 1];
      mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    }

    rows.push([
      escHtml(def.name),
      fmt(min,    unit),
      fmt(mean,   unit),
      fmt(max,    unit),
    ]);
  }
  if (!rows.length) return '';
  return renderSection('Test Values', renderTable(['Test', 'Min', 'Mean', 'Max'], rows, { className: 'compact' }));
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
  return renderSection('Functional Tests', renderTable(['Test', 'N', 'Pass', 'Fail', 'Pass Rate'], rows, { className: 'compact' }));
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
    d.hasSpec ? `${fmt(d.lsl!, d.unit)} – ${fmt(d.usl!, d.unit)}` : '—',
    fmt(d.mean, d.unit),
    fmtIndex(d.cp), fmtIndex(d.cpk), fmtIndex(d.pp), fmtIndex(d.ppk),
  ]);
  return renderSection('Process Capability', renderTable(
    ['Test', 'Spec (LSL–USL)', 'Mean', 'Cp', 'Cpk', 'Pp', 'Ppk'], rows, { className: 'compact' },
  ));
}

function findingsSection(findings: StatsFinding[], totalWafers?: number): string {
  if (!findings.length) return '';
  const rows = findings.map((f) => {
    const tooltip = escHtml(formatFindingTooltip(f));
    return `<tr title="${tooltip}">
      <td class="tight">${renderSeverityBadge(f.severity)}</td>
      <td class="tight">${escHtml(f.comparison.left)}</td>
      <td>${escHtml(f.variable.label)}</td>
      <td class="numeric">${escHtml(formatFindingDelta(f))}</td>
      <td class="numeric">${escHtml(formatFindingCoverage(f, totalWafers))}</td>
    </tr>`;
  }).join('\n');
  const coverageHeader = totalWafers !== undefined ? 'Wafers' : 'N (region/rest)';
  const body = `<table class="report-table findings-table compact"><thead><tr>
    <th>Severity</th><th>Region</th><th>Metric</th><th class="numeric">Delta</th><th class="numeric">${coverageHeader}</th>
  </tr></thead><tbody>${rows}</tbody></table>`;
  return renderSection('Findings', body);
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
    passBins  = [1],
    ringCount = 4,
  } = params;

  const meta   = wafer.metadata as Record<string, unknown> | undefined;
  const suffix = titleFromMeta(meta);
  const title  = options.title ?? `Wafer Summary${suffix}`;
  const now    = new Date().toLocaleString();

  const hasHbin = dies.some(d => d.hbin != null);
  const hasSbin = dies.some(d => d.sbin != null);

  const ringRegions     = buildRingRegions(dies, wafer, ringCount);
  const quadrantRegions = buildQuadrantRegions(dies, wafer, ringCount);

  const summaryMetrics = [
    { label: 'Total dies', value: String(dataCoverage.totalDies) },
    ...(yieldSummary.partialDies > 0 ? [{ label: 'Partial', value: String(yieldSummary.partialDies) }] : []),
    ...(yieldSummary.yieldPercent !== null ? [{ label: `Yield (pass: ${passBins.length === 1 ? `bin ${passBins[0]}` : `bins ${passBins.join(', ')}`})`, value: `${yieldSummary.yieldPercent.toFixed(1)}%` }] : []),
    ...(yieldSummary.edgeExcludedDies > 0 ? [{ label: 'Edge excluded (outer zone)', value: String(yieldSummary.edgeExcludedDies) }] : []),
  ];

  const sections = [
    renderMetadataSection([{ metadata: wafer.metadata }]),
    renderSection('Summary', [
      renderMetricGrid(summaryMetrics),
    ].filter(Boolean).join('\n')),
    hasHbin ? binSection(dies, hbinDefs, 'hard', statsSummary?.stats.hardBinCounts)
            : hasSbin ? binSection(dies, sbinDefs, 'soft', statsSummary?.stats.softBinCounts) : '',
    regionYieldSection('Ring Yield', ringRegions, dies, passBins),
    regionYieldSection('Quadrant Yield', quadrantRegions, dies, passBins),
    testSection(dies, testDefs, statsSummary?.stats.perTestStats),
    functionalSection(dies, testDefs, statsSummary?.stats.functionalYield),
    capabilitySection([{ dies }], testDefs),
    statsSummary ? findingsSection(statsSummary.findings) : '',
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
  ${sections}
  <p class="footer">Generated ${escHtml(now)}</p>
</main>
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
    /** Reused directly as `analyzeWaferLot`'s `perWaferSummaries` — the expensive
     *  per-wafer pass (`analyzeWaferMap`) is never re-run here. */
    statsSummary?: StatsSummary;
  }>;
  hbinDefs?:  BinDef[];
  sbinDefs?:  BinDef[];
  testDefs?:  TestDef[];
  passBins?:  number[];
  ringCount?: number;
  /** Passthrough to the internal per-group `analyzeWaferLot` call, e.g. `{ enableTestValueAnalysis: true }`. */
  analyzeOptions?: AnalyzeWaferMapOptions;
}

function lotWaferYieldTable(lotSummary: LotStatsSummary, items: LotSummaryReportParams['items']): string {
  const rows = lotSummary.perWafer.map((pw) => {
    const label = items[pw.waferIndex]?.label ?? `W${pw.waferIndex + 1}`;
    const yld = pw.summary.stats.yieldPercent;
    return [label, yld !== null ? `${yld.toFixed(1)}%` : 'N/A'];
  });
  return renderTable(['Wafer', 'Yield'], rows, { className: 'compact' });
}

/** One row per item with a `wafer.metadata.split` assigned; items with no split are omitted. */
function splitsSection(items: LotSummaryReportParams['items']): string {
  const rows = items
    .map(item => [item.label, item.wafer?.metadata?.split] as [string, string | undefined])
    .filter((r): r is [string, string] => !!r[1])
    .map(([label, split]) => [escHtml(label), escHtml(split)]);
  if (!rows.length) return '';
  return renderSection('Splits', renderTable(['Wafer', 'Split'], rows, { className: 'compact' }));
}

/**
 * When every wafer's `StatsSummary.stats.{hard,soft}BinCounts` is available
 * (`perWaferSummaries`), sums those directly instead of re-walking `allDies`.
 */
function lotAggregateBinTable(
  allDies: Die[],
  binDefs: BinDef[] | undefined,
  mode: 'hard' | 'soft',
  perWaferSummaries?: StatsSummary[],
): string {
  const counts = new Map<number, number>();
  const field = mode === 'hard' ? 'hardBinCounts' as const : 'softBinCounts' as const;
  if (perWaferSummaries?.length && perWaferSummaries.every(s => s.stats[field] !== undefined)) {
    for (const s of perWaferSummaries) {
      for (const [binStr, count] of Object.entries(s.stats[field]!)) {
        const bin = Number(binStr);
        counts.set(bin, (counts.get(bin) ?? 0) + count);
      }
    }
  } else {
    for (const d of allDies) {
      if (d.partial || d.edgeExcluded) continue;
      const bin = mode === 'hard' ? d.hbin : d.sbin;
      if (bin != null) counts.set(bin, (counts.get(bin) ?? 0) + 1);
    }
  }
  if (!counts.size) return '';

  const total = [...counts.values()].reduce((a, b) => a + b, 0);
  const defs = binDefs ? new Map(binDefs.map((d) => [d.bin, d])) : null;
  const rows = [...counts.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([bin, count]) => {
      const def = defs?.get(bin);
      const label = def?.name ? `Bin ${bin} · ${def.name} (${count})` : `Bin ${bin} (${count})`;
      return [label, pct(count, total)];
    });

  return renderSection(
    mode === 'hard' ? 'Hard Bin Breakdown (All Wafers)' : 'Soft Bin Breakdown (All Wafers)',
    renderTable(['Bin', 'Yield'], rows, { className: 'compact' }),
  );
}

function lotRegionYieldTable(
  title: string,
  regionFn: typeof buildRingRegions,
  diesByWafer: Die[][],
  allWafers: Wafer[],
  ringCount: number,
  passBins: number[],
): string {
  const passSet = new Set(passBins);
  const totals = new Map<string, { pass: number; total: number }>();
  const order: string[] = [];

  for (let wi = 0; wi < allWafers.length; wi++) {
    const wafer = allWafers[wi];
    const wDies = diesByWafer[wi] ?? [];
    if (!wDies.length) continue;
    const regions = regionFn(wDies, wafer, ringCount);
    const dieByKey = new Map(wDies.map((die) => [getDieKey(die), die]));

    for (const region of regions) {
      if (!order.includes(region.label)) order.push(region.label);
      const acc = totals.get(region.label) ?? { pass: 0, total: 0 };
      for (const key of region.dieKeys) {
        const die = dieByKey.get(key);
        if (!die || die.partial || die.edgeExcluded) continue;
        const bin = die.hbin ?? die.sbin;
        if (bin == null) continue;
        acc.total++;
        if (passSet.has(bin)) acc.pass++;
      }
      totals.set(region.label, acc);
    }
  }

  if (!totals.size) return '';
  const rows = order
    .filter((label) => totals.get(label)?.total)
    .map((label) => {
      const acc = totals.get(label)!;
      return [label, pct(acc.pass, acc.total)];
    });
  return rows.length ? renderSection(title, renderTable(['Region', 'Yield'], rows, { className: 'compact' })) : '';
}

/**
 * When every wafer's `StatsSummary.stats.perTestStats` is available
 * (`perWaferSummaries`), pools mean (n-weighted)/min/max directly from those
 * instead of re-walking `allDies` — see `testSection`'s doc comment.
 */
function lotTestTable(allDies: Die[], testDefs: TestDef[], perWaferSummaries?: StatsSummary[]): string {
  let pooled: Array<{ testNumber: number; min: number; max: number; mean: number }> | undefined;
  if (perWaferSummaries?.length && perWaferSummaries.every(s => s.stats.perTestStats !== undefined)) {
    const byTest = new Map<number, { n: number; sum: number; min: number; max: number }>();
    for (const s of perWaferSummaries) {
      for (const t of s.stats.perTestStats ?? []) {
        const acc = byTest.get(t.testNumber);
        if (!acc) byTest.set(t.testNumber, { n: t.count, sum: t.mean * t.count, min: t.min, max: t.max });
        else {
          acc.n += t.count;
          acc.sum += t.mean * t.count;
          acc.min = Math.min(acc.min, t.min);
          acc.max = Math.max(acc.max, t.max);
        }
      }
    }
    pooled = [...byTest.entries()].map(([testNumber, acc]) => ({
      testNumber, min: acc.min, max: acc.max, mean: acc.sum / acc.n,
    }));
  }
  return testSection(allDies, testDefs, pooled);
}

/**
 * Lot-pooled "Functional Tests" table: sums pass/fail/verdict counts across
 * per-wafer `StatsSummary.stats.functionalYield` when every wafer has one
 * (counts pool losslessly); otherwise recomputes from the pooled dies.
 */
function lotFunctionalTable(allDies: Die[], testDefs: TestDef[], perWaferSummaries?: StatsSummary[]): string {
  let pooled: NonNullable<StatsSummary['stats']['functionalYield']> | undefined;
  if (perWaferSummaries?.length && perWaferSummaries.every(s => s.stats.functionalYield !== undefined)) {
    const byTest = new Map<number, { label: string; passDies: number; failDies: number; totalDies: number }>();
    for (const s of perWaferSummaries) {
      for (const t of s.stats.functionalYield ?? []) {
        const acc = byTest.get(t.testNumber) ?? { label: t.label, passDies: 0, failDies: 0, totalDies: 0 };
        acc.passDies += t.passDies;
        acc.failDies += t.failDies;
        acc.totalDies += t.totalDies;
        byTest.set(t.testNumber, acc);
      }
    }
    pooled = [...byTest.entries()].map(([testNumber, acc]) => ({
      testNumber,
      ...acc,
      passRatePercent: acc.totalDies > 0 ? (acc.passDies / acc.totalDies) * 100 : null,
    }));
  }
  return functionalSection(allDies, testDefs, pooled?.length ? pooled : undefined);
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
  passBins: number[],
  ringCount: number,
  analyzeOptions: AnalyzeWaferMapOptions | undefined,
): { lotSummary: LotStatsSummary; sections: string } {
  const lotSummary = analyzeWaferLot(items, {
    // Index-aligned; analyzeWaferLot falls back to computing analyzeWaferMap
    // per-index when an entry is missing (its own `perWaferSummaries?.[i] ??
    // analyzeWaferMap(...)` logic), so a partial or absent array is safe —
    // the cast just satisfies the declared StatsSummary[] element type.
    perWaferSummaries: items.map((i) => i.statsSummary) as StatsSummary[],
    ...analyzeOptions,
  });

  // diesByWafer keeps each wafer's dies in a parallel array — aligned by index with
  // allWafers — instead of tagging caller-owned Die objects with a hidden field.
  // Stats must be side-effect-free; mutating input dies violated that. (The old
  // tag also indexed by item position while the region table indexed by wafer
  // position, so the two diverged whenever an item had dies but no wafer.)
  const allWafers: Wafer[] = [];
  const allDies: Die[] = [];
  const diesByWafer: Die[][] = [];
  for (const item of items) {
    const wDies = item.dies ?? [];
    if (item.wafer) {
      allWafers.push(item.wafer);
      diesByWafer.push(wDies);
    }
    if (wDies.length) allDies.push(...wDies);
  }

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
  const passSet = new Set(passBins);
  let totalDies = 0, analyzedDies = 0, goodDies = 0, edgeExcludedDies = 0, partialDies = 0;
  for (const d of allDies) {
    totalDies++;
    if (d.edgeExcluded) edgeExcludedDies++;
    if (d.partial) partialDies++;
    if (d.partial || d.edgeExcluded) continue;
    const b = d.hbin ?? d.sbin;
    if (b == null) continue;
    analyzedDies++;
    if (passSet.has(b)) goodDies++;
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
    ...(meanWaferYield !== null ? [{ label: 'Mean wafer yield', value: `${meanWaferYield.toFixed(1)}%` }] : []),
    ...(totalYieldPercent !== null ? [{ label: 'Total yield', value: `${totalYieldPercent.toFixed(1)}%` }] : []),
  ];

  const summarySection = renderSection('Lot Summary', renderMetricGrid(overviewMetrics));
  const metadataSection = renderMetadataSection(items.map((it) => ({ metadata: it.wafer?.metadata })));
  const waferYieldSection = renderSection('Per-Wafer Yield', lotWaferYieldTable(lotSummary, items));
  const splitsSectionHtml = splitsSection(items);
  const perWaferSummaries = lotSummary.perWafer.map((pw) => pw.summary);
  const binSection = hasBins
    ? (hasHbin
        ? lotAggregateBinTable(allDies, hbinDefs, 'hard', perWaferSummaries)
        : lotAggregateBinTable(allDies, sbinDefs, 'soft', perWaferSummaries))
    : '';
  const ringSection = hasBins && allWafers.length
    ? lotRegionYieldTable('Ring Yield (All Wafers)', buildRingRegions, diesByWafer, allWafers, ringCount, passBins)
    : '';
  const quadSection = hasBins && allWafers.length
    ? lotRegionYieldTable('Quadrant Yield (All Wafers)', buildQuadrantRegions, diesByWafer, allWafers, ringCount, passBins)
    : '';
  const testSectionHtml = testDefs.length ? lotTestTable(allDies, testDefs, perWaferSummaries) : '';
  const functionalSectionHtml = testDefs.length ? lotFunctionalTable(allDies, testDefs, perWaferSummaries) : '';
  const capabilitySectionHtml = testDefs.length ? capabilitySection(items, testDefs) : '';
  const findingsSectionHtml = lotSummary.findings.length ? findingsSection(lotSummary.findings, lotSummary.stats.waferCount) : '';

  const sections = [
    summarySection,
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
  ].filter(Boolean).join('\n');

  return { lotSummary, sections };
}

function reportMain(title: string, sections: string, now: string): string {
  return `<main class="report">
  <header class="report-header">
    <h1>${escHtml(title)}</h1>
    <p class="report-subtitle">Generated ${escHtml(now)}</p>
  </header>
  ${sections}
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
    passBins = [1],
    ringCount = 4,
    analyzeOptions,
  } = params;

  const now = new Date().toLocaleString();
  const groups = groupByIdentity(items);

  if (groups.length === 1) {
    const { lotSummary, sections } = renderLotGroupSections(groups[0].items, hbinDefs, sbinDefs, testDefs, passBins, ringCount, analyzeOptions);
    const lotTitle = (() => {
      const lot = lotSummary.lot;
      if (!lot) return '';
      const v = lot['lot'] ?? lot['lotId'];
      return v ? ` — ${escHtml(String(v))}` : '';
    })();
    const title = options.title ?? `Lot Summary${lotTitle}`;
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
</body>
</html>`;
  }

  // Each group's own title (`${title} — ${label}`) already distinguishes it
  // via its own `.report-header` — no need for a second, redundant divider
  // heading. Just space consecutive groups apart with a rule.
  const baseTitle = options.title ?? 'Lot Summary';
  const mains = groups.map((g) => {
    const { lotSummary, sections } = renderLotGroupSections(g.items, hbinDefs, sbinDefs, testDefs, passBins, ringCount, analyzeOptions);
    // `label` already names every field that varies BETWEEN groups (e.g.
    // "85" when only temperature splits them) — but if `lot` itself doesn't
    // vary, it's constant across every group and would otherwise never
    // appear anywhere in a multi-group report. Add it explicitly so a
    // header is never just a bare non-lot field value with no lot number
    // visible anywhere in that group's section.
    const lotTag = !g.varying.includes('lot') ? (lotSummary.lot?.['lot'] ?? lotSummary.lot?.['lotId']) : undefined;
    const heading = lotTag ? `${g.label} · Lot ${String(lotTag)}` : g.label;
    return reportMain(`${baseTitle} — ${heading}`, sections, now);
  });

  const banner = `<p style="max-width:1080px;margin:0 auto 8px;padding:8px 12px;background:var(--report-surface,#f7f8fa);border:1px solid var(--report-line,#d8dee6);border-radius:4px;font-size:12px;color:var(--report-muted,#5c6570);">This load spans ${groups.length} groups by identity — shown separately below so stats are never pooled across them.</p>`;

  const sectionsHtml = mains.map((m, i) => {
    const spacer = i === 0 ? '' : '<hr style="max-width:1080px;margin:32px auto 0;border:none;border-top:3px solid var(--report-line-strong,#c7ced8);">';
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
</body>
</html>`;
}

export { openHtmlReport };
