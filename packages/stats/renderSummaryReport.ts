import type { Die } from '../core/dies.js';
import type { Wafer } from '../core/wafer.js';
import type { BinDef, TestDef, YieldSummary } from '../renderer/buildWaferMap.js';
import { buildRingRegions, buildQuadrantRegions } from './regions.js';
import type { StatsFinding, StatsSummary, LotStatsSummary } from './types.js';
import { openHtmlReport } from './renderFindingsReport.js';
import { fmt } from '../renderer/fmt.js';

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

// ── Private helpers ───────────────────────────────────────────────────────────

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function sevColor(s: StatsFinding['severity']): string {
  return s === 'unusual' ? '#c0392b' : s === 'notable' ? '#e67e22' : '#2980b9';
}

function pct(n: number, d: number): string {
  return d === 0 ? '—' : `${((n / d) * 100).toFixed(1)}%`;
}


function section(title: string, body: string): string {
  return `<section>
<h2>${esc(title)}</h2>
${body}
</section>`;
}

function table(headers: string[], rows: string[][]): string {
  if (!rows.length) return '<p style="color:#888;font-style:italic">No data</p>';
  const head = headers.map(h => `<th>${esc(h)}</th>`).join('');
  const body = rows.map(r =>
    `<tr>${r.map(c => `<td>${c}</td>`).join('')}</tr>`
  ).join('\n');
  return `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
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
  const rows: string[] = [];
  for (const { key, label } of KNOWN_META_KEYS) {
    if (key in meta && meta[key] != null && !rendered.has(label)) {
      rows.push(`<tr><td>${esc(label)}</td><td>${esc(String(meta[key]))}</td></tr>`);
      rendered.add(label);
    }
  }
  for (const [key, val] of Object.entries(meta)) {
    if (!KNOWN_META_KEYS.some(k => k.key === key) && val != null) {
      const label = key.charAt(0).toUpperCase() + key.slice(1).replace(/([A-Z])/g, ' $1').replace(/_/g, ' ');
      rows.push(`<tr><td>${esc(label)}</td><td>${esc(String(val))}</td></tr>`);
    }
  }
  return rows.length
    ? `<table class="meta">${rows.join('')}</table>`
    : '';
}

function titleFromMeta(meta?: Record<string, unknown>): string {
  if (!meta) return '';
  const lot   = meta['lot']   ?? meta['lotId'];
  const wafer = meta['wafer'] ?? meta['waferId'];
  const parts = [lot, wafer].filter(Boolean).map(String);
  return parts.length ? ` — ${parts.map(esc).join(' · ')}` : '';
}

// ── Section renderers ─────────────────────────────────────────────────────────

function yieldSection(y: YieldSummary, cov: SummaryReportParams['dataCoverage']): string {
  const rows: string[][] = [
    ['Total dies', String(cov.totalDies)],
    ['Filled dies', `${cov.filledDies} (${pct(cov.filledDies, cov.totalDies)} fill)`],
    ['Pass dies', String(y.passDies)],
    ['Fail dies', String(y.failDies)],
  ];
  if (y.edgeExcludedDies > 0) rows.push(['Edge excluded', String(y.edgeExcludedDies)]);
  if (y.partialDies > 0)      rows.push(['Partial dies', String(y.partialDies)]);
  rows.push(['Yield', y.yieldPercent !== null ? `${(y.yieldPercent * 100).toFixed(1)}%` : 'N/A']);
  return section('Yield', table(['Metric', 'Value'], rows));
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
      return [String(bin), esc(name), String(count), pct(count, total)];
    });
  const title = mode === 'hard' ? 'Hard Bin Breakdown' : 'Soft Bin Breakdown';
  return section(title, table(['Bin', 'Name', 'Count', '%'], rows));
}

function regionYieldSection(
  title: string,
  regions: Array<{ label: string; dieKeys: string[] }>,
  dies: Die[],
  passBins: number[],
): string {
  const passSet  = new Set(passBins);
  const dieByKey = new Map(dies.map(d => [`${d.i},${d.j}`, d]));
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
    rows.push([esc(region.label), String(pass), String(total), pct(pass, total)]);
  }
  return rows.length ? section(title, table(['Region', 'Pass', 'Total', 'Yield'], rows)) : '';
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
    const median = vals[Math.floor(vals.length / 2)];
    const variance = vals.reduce((a, b) => a + (b - mean) ** 2, 0) / (vals.length - 1 || 1);
    const stddev = Math.sqrt(variance);
    const unit = def.unit || undefined;

    rows.push([
      esc(def.name),
      fmt(min,    unit),
      fmt(mean,   unit),
      fmt(median, unit),
      fmt(stddev, unit),
      fmt(max,    unit),
    ]);
  }
  if (!rows.length) return '';
  return section('Test Values', table(['Test', 'Min', 'Mean', 'Median', 'Std Dev', 'Max'], rows));
}

function findingsSection(findings: StatsFinding[]): string {
  if (!findings.length) return '';
  const rows = findings.map(f => {
    const sev = f.severity.charAt(0).toUpperCase() + f.severity.slice(1);
    return `<tr>
      <td style="white-space:nowrap"><span class="sev sev-${f.severity}">${sev}</span></td>
      <td style="white-space:nowrap">${esc(f.comparison.left)}</td>
      <td style="white-space:nowrap">${esc(f.variable.label)}</td>
      <td>${esc(f.summary)}</td>
    </tr>`;
  }).join('\n');
  const body = `<table class="findings"><thead><tr>
    <th>Severity</th><th>Region</th><th>Variable</th><th>Finding</th>
  </tr></thead><tbody>${rows}</tbody></table>`;
  return section('Findings', body);
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

  const sections = [
    meta ? section('Wafer', metaRows(meta)) : '',
    yieldSection(yieldSummary, dataCoverage),
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
<title>${esc(title)}</title>
<style>
  body    { font-family: system-ui, sans-serif; font-size: 14px; color: #1a1a2e; margin: 32px; max-width: 900px; }
  h1      { font-size: 22px; margin: 0 0 20px; }
  h2      { font-size: 12px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase;
            color: #506784; margin: 0; padding-bottom: 5px; border-bottom: 2px solid #2a6fc0; display: inline-block; }
  section { margin-bottom: 20px; }
  table   { border-collapse: collapse; width: 100%; margin-top: 6px; }
  th, td  { padding: 5px 10px; text-align: left; font-size: 13px; border-bottom: 1px solid #e8eaed; }
  thead th { background: #f0f2f5; font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em;
             color: #506784; border-bottom: 2px solid #d0d5dd; font-weight: 600; }
  tbody tr:nth-child(even) td { background: #f7f8fa; }
  tbody tr:last-child td { border-bottom: none; }
  table.meta { width: auto; min-width: 320px; }
  table.meta td:first-child { color: #506784; font-size: 12px; width: 140px; background: #f7f8fa; }
  table.meta tbody tr:nth-child(even) td:first-child { background: #eef0f4; }
  table.findings td { vertical-align: top; }
  table.findings tr:hover td { background: #f0f4fc; }
  .sev { display: inline-block; font-size: 11px; font-weight: 600; color: #fff;
         border-radius: 3px; padding: 1px 6px; white-space: nowrap; }
  .sev-unusual { background: #c0392b; }
  .sev-notable { background: #b96a00; }
  .sev-info    { background: #2980b9; }
  .footer { font-size: 11px; color: #aaa; margin-top: 20px; border-top: 1px solid #e8eaed; padding-top: 6px; }
  @media print {
    body { margin: 16px; }
    table.findings tr:hover td { background: none; }
  }
</style>
</head>
<body>
<h1>${esc(title)}</h1>
${sections}
<p class="footer">Generated ${esc(now)}</p>
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
  const rows = lotSummary.perWafer.map(pw => {
    const label = items[pw.waferIndex]?.label ?? `W${pw.waferIndex + 1}`;
    const yld   = pw.summary.stats.yieldPercent;
    return [
      esc(label),
      String(pw.summary.stats.totalDies),
      yld !== null ? `${(yld * 100).toFixed(1)}%` : 'N/A',
    ];
  });
  return table(['Wafer', 'Total Dies', 'Yield'], rows);
}

function lotAggregateBinTable(allDies: Die[], binDefs: BinDef[] | undefined, mode: 'hard' | 'soft'): string {
  const counts = new Map<number, number>();
  for (const d of allDies) {
    if (d.partial || d.edgeExcluded) continue;
    const b = mode === 'hard' ? d.hbin : d.sbin;
    if (b != null) counts.set(b, (counts.get(b) ?? 0) + 1);
  }
  if (!counts.size) return '';
  const total  = [...counts.values()].reduce((a, b) => a + b, 0);
  const defMap = binDefs ? new Map(binDefs.map(d => [d.bin, d])) : null;
  const rows   = [...counts.entries()].sort((a, b) => a[0] - b[0]).map(([bin, count]) => {
    const def = defMap?.get(bin);
    return [String(bin), esc(def?.name ?? '—'), String(count), pct(count, total)];
  });
  return section(
    mode === 'hard' ? 'Hard Bin Breakdown (All Wafers)' : 'Soft Bin Breakdown (All Wafers)',
    table(['Bin', 'Name', 'Count', '%'], rows),
  );
}

function lotRegionYieldTable(
  titleStr: string,
  regionFn: typeof buildRingRegions,
  allDies: Die[],
  allWafers: Wafer[],
  ringCount: number,
  passBins: number[],
): string {
  const passSet    = new Set(passBins);
  const totals     = new Map<string, { pass: number; total: number }>();
  const order: string[] = [];

  for (let wi = 0; wi < allWafers.length; wi++) {
    const wafer    = allWafers[wi];
    const wDies    = allDies.filter(d => (d as { _waferIndex?: number })._waferIndex === wi);
    if (!wDies.length) continue;
    const regions  = regionFn(wDies, wafer, ringCount);
    const dieByKey = new Map(wDies.map(d => [`${d.i},${d.j}`, d]));
    for (const region of regions) {
      if (!order.includes(region.label)) order.push(region.label);
      const acc = totals.get(region.label) ?? { pass: 0, total: 0 };
      for (const key of region.dieKeys) {
        const d = dieByKey.get(key);
        if (!d || d.partial || d.edgeExcluded) continue;
        const b = d.hbin ?? d.sbin;
        if (b == null) continue;
        acc.total++;
        if (passSet.has(b)) acc.pass++;
      }
      totals.set(region.label, acc);
    }
  }
  if (!totals.size) return '';
  const rows = order
    .filter(l => totals.get(l)?.total)
    .map(l => {
      const acc = totals.get(l)!;
      return [esc(l), String(acc.pass), String(acc.total), pct(acc.pass, acc.total)];
    });
  return rows.length ? section(titleStr, table(['Region', 'Pass', 'Total', 'Yield'], rows)) : '';
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
    lotSummary, items,
    hbinDefs, sbinDefs, testDefs = [],
    passBins  = [1],
    ringCount = 4,
  } = params;

  // Tag dies with wafer index for region aggregation
  const allWafers: Wafer[] = [];
  const allDies:   Die[]   = [];
  for (let wi = 0; wi < items.length; wi++) {
    const item = items[wi];
    if (item.wafer) allWafers.push(item.wafer);
    if (item.dies) {
      for (const d of item.dies) {
        (d as { _waferIndex?: number })._waferIndex = wi;
        allDies.push(d);
      }
    }
  }

  const hasHbin = allDies.some(d => d.hbin != null);
  const hasSbin = allDies.some(d => d.sbin != null);
  const hasBins = hasHbin || hasSbin;

  const lotMeta = lotSummary.lot;
  const waferYields = lotSummary.perWafer
    .map(pw => pw.summary.stats.yieldPercent)
    .filter((y): y is number => y !== null);
  const meanYield = waferYields.length
    ? waferYields.reduce((a, b) => a + b, 0) / waferYields.length : null;

  const lotTitle = (() => {
    if (!lotMeta) return '';
    const lot = lotMeta['lot'] ?? lotMeta['lotId'];
    return lot ? ` — ${esc(String(lot))}` : '';
  })();
  const title = options.title ?? `Lot Summary${lotTitle}`;
  const now   = new Date().toLocaleString();

  // Lot overview table
  const overviewRows: string[][] = [
    ['Wafer count', String(lotSummary.stats.waferCount)],
  ];
  if (meanYield !== null) overviewRows.push(['Mean yield', `${(meanYield * 100).toFixed(1)}%`]);
  if (waferYields.length) {
    overviewRows.push(['Min yield', `${(Math.min(...waferYields) * 100).toFixed(1)}%`]);
    overviewRows.push(['Max yield', `${(Math.max(...waferYields) * 100).toFixed(1)}%`]);
  }

  const metaSection = lotMeta ? section('Lot', metaRows(lotMeta)) : '';
  const overviewSection = section('Overview', table(['Metric', 'Value'], overviewRows));
  const waferYieldSection = section('Per-Wafer Yield', lotWaferYieldTable(lotSummary, items));
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
  const findingsSectionHtml = lotSummary.findings.length ? findingsSection(lotSummary.findings) : '';

  const body = [
    metaSection, overviewSection, waferYieldSection,
    binSection, ringSection, quadSection,
    testSectionHtml, findingsSectionHtml,
  ].filter(Boolean).join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>${esc(title)}</title>
<style>
  body    { font-family: system-ui, sans-serif; font-size: 14px; color: #1a1a2e; margin: 32px; max-width: 900px; }
  h1      { font-size: 22px; margin: 0 0 20px; }
  h2      { font-size: 12px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase;
            color: #506784; margin: 0; padding-bottom: 5px; border-bottom: 2px solid #2a6fc0; display: inline-block; }
  section { margin-bottom: 20px; }
  table   { border-collapse: collapse; width: 100%; margin-top: 6px; }
  th, td  { padding: 5px 10px; text-align: left; font-size: 13px; border-bottom: 1px solid #e8eaed; }
  thead th { background: #f0f2f5; font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em;
             color: #506784; border-bottom: 2px solid #d0d5dd; font-weight: 600; }
  tbody tr:nth-child(even) td { background: #f7f8fa; }
  tbody tr:last-child td { border-bottom: none; }
  table.meta { width: auto; min-width: 320px; }
  table.meta td:first-child { color: #506784; font-size: 12px; width: 140px; background: #f7f8fa; }
  table.meta tbody tr:nth-child(even) td:first-child { background: #eef0f4; }
  table.findings td { vertical-align: top; }
  table.findings tr:hover td { background: #f0f4fc; }
  .sev { display: inline-block; font-size: 11px; font-weight: 600; color: #fff;
         border-radius: 3px; padding: 1px 6px; white-space: nowrap; }
  .sev-unusual { background: #c0392b; }
  .sev-notable { background: #b96a00; }
  .sev-info    { background: #2980b9; }
  .footer { font-size: 11px; color: #aaa; margin-top: 20px; border-top: 1px solid #e8eaed; padding-top: 6px; }
  @media print {
    body { margin: 16px; }
    table.findings tr:hover td { background: none; }
  }
</style>
</head>
<body>
<h1>${esc(title)}</h1>
${body}
<p class="footer">Generated ${esc(now)}</p>
</body>
</html>`;
}

export { openHtmlReport };
