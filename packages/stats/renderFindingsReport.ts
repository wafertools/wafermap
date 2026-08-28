import type { StatsFinding, StatsSummary, LotStatsSummary } from './types.js';
import {
  formatFindingDelta,
  formatFindingCoverage,
  formatFindingTooltip,
  escHtml,
  buildMetadataRows,
  renderDefinitionList,
  renderSection,
  renderSeverityBadge,
  reportStyles,
} from './reportHtml.js';
import { buildFindingsNarrative } from './findingsNarrative.js';
import { plainBinTerms } from '../renderer/fmt.js';

/** Metadata rows use `buildMetadataRows` (`buildFacetTable` over every
 *  item's own metadata) — never `LotStatsSummary.lot` directly, which
 *  itself now omits (rather than silently picking a winner for) any field
 *  the lot disagrees on, and either way is a coarser view that can drift
 *  from what the live Summary panel/`renderSummaryReportHtml` show for the
 *  same data. See `reportHtml.ts`'s doc comment. */
function summaryMetaBlock(summary: StatsSummary | LotStatsSummary, generatedAt: string): string {
  if (summary.level === 'lot') {
    const lot = summary as LotStatsSummary;
    const waferIds = lot.perWafer
      .map((entry) => entry.summary.wafer?.wafer ?? entry.summary.wafer?.waferId)
      .filter((value): value is string | number => value !== undefined && value !== null)
      .map(String)
      .join(', ');

    return renderDefinitionList([
      ...buildMetadataRows(lot.perWafer.map((entry) => ({ metadata: entry.summary.wafer }))),
      ...(waferIds ? [{ label: 'Wafers', value: waferIds }] : []),
      { label: 'Wafer count', value: String(lot.stats.waferCount) },
      { label: 'Generated', value: generatedAt },
    ]);
  }

  const wafer = summary as StatsSummary;
  const yld = wafer.stats.yieldPercent !== null ? `${wafer.stats.yieldPercent.toFixed(1)}%` : 'N/A';
  return renderDefinitionList([
    ...buildMetadataRows([{ metadata: wafer.wafer }]),
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
      <td>${escHtml(plainBinTerms(finding.variable.label))}</td>
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
  // Drop findings another finding has claimed as an exact restatement of itself
  // (a soft-bin twin covering the same dies, the single pass bin's row against
  // the yield row). The claimer's label names what it absorbed, so listing both
  // would print the same fact twice — once merged, once not. Matches what the
  // Summary panel shows; the full list is still on `summary.findings` for any
  // host that wants it.
  const claimedIds = new Set(summary.findings.flatMap(f => f.absorbedIds ?? []));
  const findings = summary.findings.filter(f => !claimedIds.has(f.id));
  const totalWafers = summary.level === 'lot' ? summary.stats.waferCount : undefined;
  const narrativeText = plainBinTerms(buildFindingsNarrative(findings) ?? '');
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
  if (typeof (window as any).__openHtmlReport === 'function') {
    (window as any).__openHtmlReport(html);
    return;
  }
  // A blob: URL passed directly to window.open, not window.open('', ...)
  // followed by document.write — that blank-window-then-write sequence is
  // the exact pattern many browsers/extensions specifically fingerprint as
  // a popup ad (it's how they worked for a decade) and block even from a
  // direct, synchronous click. Opening a real URL is treated far more
  // leniently. document.write is also blocked outright in some sandboxed/
  // CSP contexts regardless of popup settings, which this also sidesteps.
  const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
  const win = window.open(url, '_blank');
  // Revoke once the new tab/window has had time to actually load the blob —
  // revoking immediately can race the navigation in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 30000);
  if (!win) {
    // Still possible (aggressive blocker, or an environment with no real
    // window.open at all — e.g. Tauri's WebView) — was previously a fully
    // silent no-op. A host here must call setReportOpener() to supply its
    // own opener (native window, in-app modal, etc.); this at least says so.
    console.warn(
      'wmap: window.open() returned null, so the report could not be shown. ' +
      'If this host cannot use window.open (e.g. Tauri, or popups are blocked), ' +
      'call setReportOpener() to supply your own opener.'
    );
  }
}

export function setReportOpener(opener: (html: string) => void): void {
  (window as any).__openHtmlReport = opener;
}
