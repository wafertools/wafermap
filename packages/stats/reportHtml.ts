import type { StatsFinding, StatsSeverity } from './types.js';
import { fmt } from '../renderer/fmt.js';

export interface MetricItem {
  label: string;
  value: string;
  hint?: string;
}

export function escHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
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

export function formatFindingTooltip(finding: StatsFinding): string {
  return finding.summary;
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
    font-size: 10px;
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
    font-size: 10px;
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
