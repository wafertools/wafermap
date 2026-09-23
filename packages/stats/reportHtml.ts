import type { StatsFinding, StatsSeverity } from './types.js';
import { fmt, plainBinTerms } from '../renderer/fmt.js';
import { buildFacetTable, prettyKey, type FacetItem } from './facets.js';
import { escHtml } from '../core/utils.js';
import { derivedTestNote, derivedKeyText, derivedFields } from '../renderer/testLabel.js';

export interface MetricItem {
  label: string;
  value: string;
  hint?: string;
}


export function renderSection(title: string, body: string, className = ''): string {
  const classes = ['report-section', className].filter(Boolean).join(' ');
  return `<section class="${classes}">
  <h2>${escHtml(title)}</h2>
  ${body}
</section>`;
}

export function renderDefinitionList(
  entries: Array<{ label: string; value: string }>,
  className = 'meta-list',
): string {
  if (!entries.length) return '';
  const items = entries
    .map((entry) => `<div class="definition-item"><dt>${escHtml(entry.label)}</dt><dd>${escHtml(entry.value)}</dd></div>`)
    .join('\n');
  return `<dl class="${className}">
${items}
</dl>`;
}

/**
 * The single source of metadata content for every report and panel surface
 * — built from `buildFacetTable` over the actual item(s), never
 * `LotStatsSummary.lot` (which itself now omits — rather than silently
 * picking a winner for — any field the population disagrees on; see its own
 * `mixedIdentityFields`) or a per-file known-key list, both of which can
 * silently drop a field that varies across the population and can drift
 * from what the live Summary panel
 * shows (`buildMetadataInfoSection` in canvas-adapter/summaryPanel.ts,
 * which calls the same `buildFacetTable`). A population of one wafer is
 * just a facet table where every field has exactly one value, so the
 * wafer- and lot-level reports render identical content for the same
 * underlying metadata — never two independently-derived renderings.
 */
export function buildMetadataRows(items: FacetItem[]): Array<{ label: string; value: string }> {
  const table = buildFacetTable(items, { facetableOnly: items.length > 1 });
  return table.map((field) => ({
    label: prettyKey(field.key),
    value: field.values.map((v) => v.value).join(', '),
  }));
}

/** `buildMetadataRows` wrapped in a titled section. Returns `''` when there's nothing to show. */
export function renderMetadataSection(items: FacetItem[]): string {
  const rows = buildMetadataRows(items);
  if (!rows.length) return '';
  return renderSection('Wafer Info', renderDefinitionList(rows));
}

export function renderMetricGrid(items: MetricItem[]): string {
  if (!items.length) return '';
  const nodes = items
    .map((item) => `<div class="metric">
  <dt>${escHtml(item.label)}</dt>
  <dd>${escHtml(item.value)}</dd>
  ${item.hint ? `<span class="metric-hint">${escHtml(item.hint)}</span>` : ''}
</div>`)
    .join('\n');
  return `<dl class="metric-grid">
${nodes}
</dl>`;
}

export function renderTable(
  headers: string[],
  rows: string[][],
  options: { className?: string; emptyMessage?: string } = {},
): string {
  if (!rows.length) {
    return `<p class="no-data">${escHtml(options.emptyMessage ?? 'No data')}</p>`;
  }
  const className = ['report-table', options.className].filter(Boolean).join(' ');
  const head = headers.map((header) => `<th>${escHtml(header)}</th>`).join('');
  const body = rows.map((row) => `<tr>${row.map((cell) => `<td>${cell}</td>`).join('')}</tr>`).join('\n');
  return `<table class="${className}">
  <thead><tr>${head}</tr></thead>
  <tbody>${body}</tbody>
</table>`;
}

export function renderSeverityBadge(severity: StatsSeverity): string {
  const label = severity.charAt(0).toUpperCase() + severity.slice(1);
  return `<span class="badge badge-${severity}">${label}</span>`;
}

export function formatFindingDelta(finding: Pick<StatsFinding, 'effect' | 'variable'>): string {
  const delta = finding.effect.absoluteDelta ?? 0;
  const sign = delta > 0 ? '+' : delta < 0 ? '−' : '';

  if (finding.variable.kind === 'yield' || finding.variable.kind === 'hardBin' || finding.variable.kind === 'softBin') {
    return `${sign}${Math.abs(delta * 100).toFixed(1)} pp`;
  }

  if (finding.variable.kind === 'test') {
    if (finding.effect.relativeDelta !== undefined && Number.isFinite(finding.effect.relativeDelta)) {
      const pct = Math.abs(finding.effect.relativeDelta * 100).toFixed(1);
      return `${sign}${pct}%`;
    }
    return `${sign}${fmt(Math.abs(delta), finding.variable.unit)}`;
  }

  return `${sign}${fmt(Math.abs(delta), finding.variable.unit)}`;
}

/**
 * A finding's hover text, for the Summary panel and both HTML reports alike —
 * the one rule for it. The sentence already carries the `†` for a finding about
 * a derived test; the tooltip adds the words for it and the expression, on a
 * line of their own.
 */
export function formatFindingTooltip(finding: StatsFinding): string {
  const note = derivedTestNote(finding.variable);
  return note ? `${finding.summary}\n${note}` : finding.summary;
}

/**
 * The `†` key under a findings table, as HTML — `''` when no finding in it is
 * about a derived test. A printed report has no hover, so unlike the on-screen
 * key this one names each derived test's expression: for a reader of the PDF
 * it is the only place to learn what a value was computed from.
 */
export function derivedFindingsKeyHtml(findings: StatsFinding[]): string {
  const text = derivedKeyText(findings.map(f => ({ label: f.variable.label, ...derivedFields(f.variable) })));
  return text ? `<p class="report-note">${escHtml(text)}</p>` : '';
}

/**
 * THE findings table, for every HTML report — the wafer and lot reports' Findings
 * sections and the findings-only report alike, with the derived-test key under
 * it when any row is about a derived test.
 *
 * It existed twice until 0.30.3, once per report module, and the copies had
 * already drifted: only the findings report translated the internal bin terms
 * ("HBin 2" → "hard bin 2"), so the wafer and lot reports printed the jargon the
 * design principles keep out of the UI.
 *
 * `totalWafers` switches the coverage column from "N (region/rest)" to a count
 * of wafers, for lot-level findings.
 */
export function findingsTableHtml(findings: StatsFinding[], totalWafers?: number): string {
  const rows = findings.length
    ? findings.map((f) => `<tr title="${escHtml(formatFindingTooltip(f))}">
      <td class="tight">${renderSeverityBadge(f.severity)}</td>
      <td class="tight">${escHtml(f.comparison.left)}</td>
      <td>${escHtml(plainBinTerms(f.variable.label))}</td>
      <td class="numeric">${escHtml(formatFindingDelta(f))}</td>
      <td class="numeric">${escHtml(formatFindingCoverage(f, totalWafers))}</td>
    </tr>`).join('\n')
    : '<tr><td colspan="5" class="no-data">No significant findings</td></tr>';
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
    ${rows}
  </tbody>
</table>${derivedFindingsKeyHtml(findings)}`;
}

export function formatFindingCoverage(
  finding: Pick<StatsFinding, 'stats'>,
  total?: number,
): string {
  if (total !== undefined) {
    return `${finding.stats.sampleSizeLeft}/${total}`;
  }
  return `${finding.stats.sampleSizeLeft}/${finding.stats.sampleSizeRight}`;
}

export function reportStyles(): string {
  return `
  :root {
    --report-font: Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    --report-text: #1f2328;
    --report-muted: #5c6570;
    --report-subtle: #7a828d;
    --report-line: #d8dee6;
    --report-line-strong: #c7ced8;
    --report-surface: #f7f8fa;
    --report-surface-alt: #fbfcfd;
    --report-severity-unusual: #8b3f35;
    --report-severity-notable: #8b6428;
    --report-severity-info: #446883;
  }

  html {
    background: #fff;
  }

  body {
    margin: 0;
    color: var(--report-text);
    background: #fff;
    font-family: var(--report-font);
    font-size: 13px;
    line-height: 1.45;
    font-variant-numeric: tabular-nums;
    -webkit-font-smoothing: antialiased;
    text-rendering: optimizeLegibility;
  }

  .report {
    max-width: 1080px;
    margin: 0 auto;
    padding: 24px 28px 32px;
  }

  .report-header {
    margin: 0 0 16px;
    padding-bottom: 12px;
    border-bottom: 1px solid var(--report-line);
  }

  h1 {
    margin: 0;
    font-size: 20px;
    font-weight: 600;
    line-height: 1.2;
    letter-spacing: -0.01em;
  }

  .report-subtitle {
    margin: 6px 0 0;
    color: var(--report-muted);
    font-size: 12px;
  }

  /* Sub-headings and notes inside a section — used by the split comparison,
     which nests one block per facet under a single section heading. */
  .report-subheading {
    margin: 14px 0 6px;
    font-size: 13px;
    font-weight: 600;
    color: var(--report-text);
  }
  h4.report-subheading {
    margin: 10px 0 4px;
    font-size: 12px;
    font-weight: 600;
    color: var(--report-muted);
  }
  .report-note {
    margin: 4px 0 0;
    font-size: 11px;
    color: var(--report-muted);
  }

  section.report-section {
    margin-top: 18px;
    break-inside: avoid;
    page-break-inside: avoid;
  }

  section.report-section + section.report-section {
    border-top: 1px solid var(--report-line);
    padding-top: 14px;
  }

  h2 {
    margin: 0 0 8px;
    color: var(--report-muted);
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.09em;
  }

  .no-data {
    margin: 0;
    color: var(--report-muted);
    font-style: italic;
  }

  .findings-narrative {
    margin: 0 0 14px;
    color: var(--report-muted);
    font-size: 13px;
    font-style: italic;
    line-height: 1.6;
  }

  .definition-item {
    display: contents;
  }

  .meta-list {
    display: grid;
    grid-template-columns: max-content minmax(0, 1fr);
    column-gap: 14px;
    row-gap: 6px;
    align-items: baseline;
  }

  .meta-list dt {
    margin: 0;
    color: var(--report-muted);
    font-size: 12px;
    white-space: nowrap;
  }

  .meta-list dd {
    margin: 0;
    min-width: 0;
  }

  .metric-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
    gap: 10px 14px;
  }

  .metric {
    padding-top: 10px;
    border-top: 1px solid var(--report-line);
  }

  .metric dt {
    margin: 0 0 3px;
    color: var(--report-muted);
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }

  .metric dd {
    margin: 0;
    font-size: 18px;
    font-weight: 600;
    line-height: 1.15;
  }

  .metric-hint {
    display: block;
    margin-top: 3px;
    color: var(--report-subtle);
    font-size: 11px;
  }

  table.report-table {
    width: 100%;
    border-collapse: collapse;
    table-layout: fixed;
    font-variant-numeric: tabular-nums;
  }

  table.report-table thead {
    display: table-header-group;
  }

  table.report-table th,
  table.report-table td {
    padding: 4px 8px;
    text-align: left;
    vertical-align: top;
    border-bottom: 1px solid var(--report-line);
  }

  table.report-table thead th {
    padding-top: 3px;
    padding-bottom: 5px;
    color: var(--report-muted);
    /* 11px, not 10px. This document prints (see @page below), where 10px is
       about 7.5pt — too small to read on paper. The report keeps its own
       document scale (20 title / 18 stat / 13 / 12 body / 11 label) rather than
       the app's denser tiers; this is a print-legibility floor, not an
       alignment to those. */
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    border-bottom: 1px solid var(--report-line-strong);
    background: transparent;
  }

  table.report-table tbody tr:last-child td {
    border-bottom: none;
  }

  table.report-table.compact th,
  table.report-table.compact td {
    padding-top: 3px;
    padding-bottom: 3px;
  }

  table.report-table .numeric {
    text-align: right;
    white-space: nowrap;
  }

  table.report-table .muted {
    color: var(--report-muted);
  }

  table.report-table .tight {
    white-space: nowrap;
  }

  table.report-table .summary {
    color: var(--report-muted);
    font-size: 12px;
  }

  .badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 58px;
    padding: 1px 6px;
    border: 1px solid transparent;
    border-radius: 999px;
    font-size: 11px;   /* print floor — see the table-header note above */
    font-weight: 600;
    line-height: 1.35;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    white-space: nowrap;
  }

  .badge-unusual {
    color: var(--report-severity-unusual);
    background: #f4eeec;
    border-color: #d9c0bb;
  }

  .badge-notable {
    color: var(--report-severity-notable);
    background: #f5f0e6;
    border-color: #ddcfb5;
  }

  .badge-info {
    color: var(--report-severity-info);
    background: #eef4f8;
    border-color: #cfdae4;
  }

  .footer {
    margin-top: 14px;
    padding-top: 10px;
    border-top: 1px solid var(--report-line);
    color: var(--report-muted);
    font-size: 11px;
  }

  @media print {
    @page {
      margin: 10mm 8mm 12mm;
    }

    body {
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }

    .report {
      max-width: none;
      padding: 0;
    }

    section.report-section,
    tr {
      break-inside: avoid;
      page-break-inside: avoid;
    }

    thead {
      display: table-header-group;
    }

    .report-header {
      padding-bottom: 8px;
      margin-bottom: 12px;
    }

    .footer {
      margin-top: 10px;
    }
  }
  `;
}
