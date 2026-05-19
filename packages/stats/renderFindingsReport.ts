import type { StatsFinding, StatsSummary, LotStatsSummary } from './types.js';
import {
  formatFindingDelta,
  formatFindingCoverage,
  formatFindingTooltip,
  escHtml,
  renderDefinitionList,
  renderSection,
  renderSeverityBadge,
  reportStyles,
} from './reportHtml.js';
import { buildFindingsNarrative } from './findingsNarrative.js';

const KNOWN_META_KEYS: Array<{ key: string; label: string }> = [
  { key: 'lot',      label: 'Lot' },
  { key: 'lotId',    label: 'Lot' },
  { key: 'wafer',    label: 'Wafer' },
  { key: 'waferId',  label: 'Wafer' },
  { key: 'testDate', label: 'Test date' },
  { key: 'date',     label: 'Date' },
  { key: 'temp',     label: 'Temperature' },
  { key: 'operator', label: 'Operator' },
  { key: 'product',  label: 'Product' },
  { key: 'device',   label: 'Device' },
];

function metaRowsFromMetadata(meta: Record<string, unknown>): Array<{ label: string; value: string }> {
  const rendered = new Set<string>();
  const rows: Array<{ label: string; value: string }> = [];

  for (const { key, label } of KNOWN_META_KEYS) {
    if (key in meta && meta[key] != null && !rendered.has(label)) {
      rows.push({ label, value: String(meta[key]) });
      rendered.add(label);
    }
  }

  for (const [key, value] of Object.entries(meta)) {
    if (KNOWN_META_KEYS.some((entry) => entry.key === key) || value == null) continue;
    const label = key.charAt(0).toUpperCase() + key.slice(1).replace(/([A-Z])/g, ' $1').replace(/_/g, ' ');
    rows.push({ label, value: String(value) });
  }

  return rows;
}

function summaryMetaBlock(summary: StatsSummary | LotStatsSummary, generatedAt: string): string {
  if (summary.level === 'lot') {
    const lot = summary as LotStatsSummary;
    const waferIds = lot.perWafer
      .map((entry) => entry.summary.wafer?.wafer ?? entry.summary.wafer?.waferId)
      .filter((value): value is string | number => value !== undefined && value !== null)
      .map(String)
      .join(', ');

    return renderDefinitionList([
      ...(lot.lot ? metaRowsFromMetadata(lot.lot) : []),
      ...(waferIds ? [{ label: 'Wafers', value: waferIds }] : []),
      { label: 'Wafer count', value: String(lot.stats.waferCount) },
      { label: 'Generated', value: generatedAt },
    ]);
  }

  const wafer = summary as StatsSummary;
  const yld = wafer.stats.yieldPercent !== null ? `${wafer.stats.yieldPercent.toFixed(1)}%` : 'N/A';
  return renderDefinitionList([
    ...(wafer.wafer ? metaRowsFromMetadata(wafer.wafer) : []),
    { label: 'Total dies', value: String(wafer.stats.totalDies) },
    { label: 'Analysed dies', value: String(wafer.stats.analyzedDies) },
    { label: 'Yield', value: yld },
    { label: 'Generated', value: generatedAt },
  ]);
}

function findingsRows(findings: StatsFinding[], totalWafers?: number): string {
  if (!findings.length) {
    return '<tr><td colspan="5" class="no-data">No significant findings</td></tr>';
  }

  return findings.map((finding) => {
    const tooltip = escHtml(formatFindingTooltip(finding));
    return `<tr title="${tooltip}">
      <td class="tight">${renderSeverityBadge(finding.severity)}</td>
      <td class="tight">${escHtml(finding.comparison.left)}</td>
      <td>${escHtml(finding.variable.label)}</td>
      <td class="numeric">${escHtml(formatFindingDelta(finding))}</td>
      <td class="numeric">${escHtml(formatFindingCoverage(finding, totalWafers))}</td>
    </tr>`;
  }).join('\n');
}

function findingsTable(findings: StatsFinding[], totalWafers?: number): string {
  const coverageHeader = totalWafers !== undefined ? 'Wafers' : 'N (region/rest)';
  return `<table class="report-table findings-table compact">
  <thead>
    <tr>
      <th>Severity</th>
      <th>Region</th>
      <th>Metric</th>
      <th class="numeric">Delta</th>
      <th class="numeric">${coverageHeader}</th>
    </tr>
  </thead>
  <tbody>
    ${findingsRows(findings, totalWafers)}
  </tbody>
</table>`;
}

export function renderFindingsReportHtml(
  summary: StatsSummary | LotStatsSummary,
  options: { title?: string } = {},
): string {
  const isLot = summary.level === 'lot';
  const title = options.title ?? (isLot ? 'Lot Findings Report' : 'Wafer Findings Report');
  const generatedAt = new Date().toLocaleString();
  const findings = summary.findings;
  const totalWafers = summary.level === 'lot' ? summary.stats.waferCount : undefined;
  const narrativeText = buildFindingsNarrative(findings);
  const narrativeParagraph = narrativeText
    ? `<p class="findings-narrative">${escHtml(narrativeText)}</p>\n` : '';
  const body = [
    renderSection('Summary', summaryMetaBlock(summary, generatedAt)),
    renderSection('Findings', narrativeParagraph + findingsTable(findings, totalWafers)),
  ].join('\n');

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
    <p class="report-subtitle">Generated ${escHtml(generatedAt)}</p>
  </header>
  ${body}
</main>
</body>
</html>`;
}

export function openHtmlReport(html: string): void {
  const win = window.open('', '_blank');
  if (!win) return;
  win.document.write(html);
  win.document.close();
}
