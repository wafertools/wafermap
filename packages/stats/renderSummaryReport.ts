import type { Die } from '../core/dies.js';
import type { Wafer } from '../core/wafer.js';
import type { BinDef, TestDef, YieldSummary } from '../renderer/buildWaferMap.js';
import { buildRingRegions, buildQuadrantRegions } from './regions.js';
import type { StatsFinding, StatsSummary, LotStatsSummary } from './types.js';
import { openHtmlReport } from './renderFindingsReport.js';
import { fmt } from '../renderer/fmt.js';
import {
  formatFindingDelta,
  formatFindingCoverage,
  formatFindingTooltip,
  escHtml,
  renderDefinitionList,
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

const KNOWN_META_KEYS: Array<{ key: string; label: string }> = [
  { key: 'lot',       label: 'Lot' },
  { key: 'lotId',     label: 'Lot' },
  { key: 'wafer',     label: 'Wafer' },
  { key: 'waferId',   label: 'Wafer' },
  { key: 'testDate',  label: 'Test date' },
  { key: 'date',      label: 'Date' },
  { key: 'temp',      label: 'Temperature' },
  { key: 'operator',  label: 'Operator' },
  { key: 'product',   label: 'Product' },
  { key: 'device',    label: 'Device' },
];

function metaRows(meta: Record<string, unknown>): string {
  const rendered = new Set<string>();
  const rows: Array<{ label: string; value: string }> = [];
  for (const { key, label } of KNOWN_META_KEYS) {
    if (key in meta && meta[key] != null && !rendered.has(label)) {
      rows.push({ label, value: String(meta[key]) });
      rendered.add(label);
    }
  }
  for (const [key, val] of Object.entries(meta)) {
    if (!KNOWN_META_KEYS.some(k => k.key === key) && val != null) {
      const label = key.charAt(0).toUpperCase() + key.slice(1).replace(/([A-Z])/g, ' $1').replace(/_/g, ' ');
      rows.push({ label, value: String(val) });
    }
  }
  return renderDefinitionList(rows);
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

function binSection(dies: Die[], binDefs: BinDef[] | undefined, mode: 'hard' | 'soft'): string {
  const counts = new Map<number, number>();
  for (const d of dies) {
    if (d.partial || d.edgeExcluded) continue;
    const b = mode === 'hard' ? d.hbin : d.sbin;
    if (b != null) counts.set(b, (counts.get(b) ?? 0) + 1);
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
  const dieByKey = new Map(dies.map(d => [`${d.x},${d.y}`, d]));
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

function testSection(dies: Die[], testDefs: TestDef[]): string {
  if (!testDefs.length) return '';
  const active = dies.filter(d => !d.partial && !d.edgeExcluded);
  const rows: string[][] = [];

  for (const def of testDefs) {
    const tn = def.testNumber ?? def.index;
    if (tn === undefined) continue;
    const vals = active
      .map(d => d.testValues?.[tn] ?? d.values?.[def.index ?? tn])
      .filter((v): v is number => v !== undefined && isFinite(v));
    if (!vals.length) continue;

    vals.sort((a, b) => a - b);
    const min    = vals[0];
    const max    = vals[vals.length - 1];
    const mean   = vals.reduce((a, b) => a + b, 0) / vals.length;
    const unit = def.unit || undefined;

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
    meta ? renderSection('Wafer Info', metaRows(meta)) : '',
    renderSection('Summary', [
      renderMetricGrid(summaryMetrics),
    ].filter(Boolean).join('\n')),
    hasHbin ? binSection(dies, hbinDefs, 'hard') : hasSbin ? binSection(dies, sbinDefs, 'soft') : '',
    regionYieldSection('Ring Yield', ringRegions, dies, passBins),
    regionYieldSection('Quadrant Yield', quadrantRegions, dies, passBins),
    testSection(dies, testDefs),
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
  lotSummary: LotStatsSummary;
  items:      Array<{ label: string; wafer?: Wafer; dies?: Die[] }>;
  hbinDefs?:  BinDef[];
  sbinDefs?:  BinDef[];
  testDefs?:  TestDef[];
  passBins?:  number[];
  ringCount?: number;
}

function lotWaferYieldTable(lotSummary: LotStatsSummary, items: LotSummaryReportParams['items']): string {
  const rows = lotSummary.perWafer.map((pw) => {
    const label = items[pw.waferIndex]?.label ?? `W${pw.waferIndex + 1}`;
    const yld = pw.summary.stats.yieldPercent;
    return [label, yld !== null ? `${yld.toFixed(1)}%` : 'N/A'];
  });
  return renderTable(['Wafer', 'Yield'], rows, { className: 'compact' });
}

function lotAggregateBinTable(allDies: Die[], binDefs: BinDef[] | undefined, mode: 'hard' | 'soft'): string {
  const counts = new Map<number, number>();
  for (const d of allDies) {
    if (d.partial || d.edgeExcluded) continue;
    const bin = mode === 'hard' ? d.hbin : d.sbin;
    if (bin != null) counts.set(bin, (counts.get(bin) ?? 0) + 1);
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
  allDies: Die[],
  allWafers: Wafer[],
  ringCount: number,
  passBins: number[],
): string {
  const passSet = new Set(passBins);
  const totals = new Map<string, { pass: number; total: number }>();
  const order: string[] = [];

  for (let wi = 0; wi < allWafers.length; wi++) {
    const wafer = allWafers[wi];
    const wDies = allDies.filter((die) => (die as { _waferIndex?: number })._waferIndex === wi);
    if (!wDies.length) continue;
    const regions = regionFn(wDies, wafer, ringCount);
    const dieByKey = new Map(wDies.map((die) => [`${die.x},${die.y}`, die]));

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

function lotTestTable(allDies: Die[], testDefs: TestDef[]): string {
  return testSection(allDies, testDefs);
}

/** Generate a full lot summary as a standalone HTML string suitable for `openHtmlReport()`. */
export function renderLotSummaryReportHtml(
  params: LotSummaryReportParams,
  options: { title?: string } = {},
): string {
  const {
    lotSummary,
    items,
    hbinDefs,
    sbinDefs,
    testDefs = [],
    passBins = [1],
    ringCount = 4,
  } = params;

  const allWafers: Wafer[] = [];
  const allDies: Die[] = [];
  for (let wi = 0; wi < items.length; wi++) {
    const item = items[wi];
    if (item.wafer) allWafers.push(item.wafer);
    if (item.dies) {
      for (const die of item.dies) {
        (die as { _waferIndex?: number })._waferIndex = wi;
        allDies.push(die);
      }
    }
  }

  const hasHbin = allDies.some((die) => die.hbin != null);
  const hasSbin = allDies.some((die) => die.sbin != null);
  const hasBins = hasHbin || hasSbin;

  const lotMeta = lotSummary.lot;
  const waferYields = lotSummary.perWafer
    .map((pw) => pw.summary.stats.yieldPercent)
    .filter((y): y is number => y !== null);
  const meanYield = waferYields.length
    ? waferYields.reduce((a, b) => a + b, 0) / waferYields.length
    : null;

  const lotTitle = (() => {
    if (!lotMeta) return '';
    const lot = lotMeta['lot'] ?? lotMeta['lotId'];
    return lot ? ` — ${escHtml(String(lot))}` : '';
  })();
  const title = options.title ?? `Lot Summary${lotTitle}`;
  const now = new Date().toLocaleString();

  const overviewMetrics = [
    { label: 'Wafers', value: String(lotSummary.stats.waferCount) },
    ...(meanYield !== null ? [{ label: 'Mean yield', value: `${meanYield.toFixed(1)}%` }] : []),
  ];

  const summaryBody = [
    lotMeta ? metaRows(lotMeta) : '',
    renderMetricGrid(overviewMetrics),
  ].filter(Boolean).join('\n');

  const summarySection = renderSection('Lot Summary', summaryBody);
  const waferYieldSection = renderSection('Per-Wafer Yield', lotWaferYieldTable(lotSummary, items));
  const binSection = hasBins
    ? (hasHbin
        ? lotAggregateBinTable(allDies, hbinDefs, 'hard')
        : lotAggregateBinTable(allDies, sbinDefs, 'soft'))
    : '';
  const ringSection = hasBins && allWafers.length
    ? lotRegionYieldTable('Ring Yield (All Wafers)', buildRingRegions, allDies, allWafers, ringCount, passBins)
    : '';
  const quadSection = hasBins && allWafers.length
    ? lotRegionYieldTable('Quadrant Yield (All Wafers)', buildQuadrantRegions, allDies, allWafers, ringCount, passBins)
    : '';
  const testSectionHtml = testDefs.length ? lotTestTable(allDies, testDefs) : '';
  const findingsSectionHtml = lotSummary.findings.length ? findingsSection(lotSummary.findings, lotSummary.stats.waferCount) : '';

  const body = [
    summarySection,
    waferYieldSection,
    binSection,
    ringSection,
    quadSection,
    testSectionHtml,
    findingsSectionHtml,
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
  ${body}
  <p class="footer">Generated ${escHtml(now)}</p>
</main>
</body>
</html>`;
}

export { openHtmlReport };
