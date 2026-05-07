import type { StatsFinding, StatsSummary, LotStatsSummary } from './types.js';

function severityColor(severity: StatsFinding['severity']): string {
  if (severity === 'unusual') return '#c0392b';
  if (severity === 'notable') return '#e67e22';
  return '#2980b9';
}

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function findingRows(findings: StatsFinding[]): string {
  if (findings.length === 0) {
    return '<tr><td colspan="4" style="color:#888;font-style:italic;text-align:center">No significant findings</td></tr>';
  }
  return findings.map(f => {
    const color = severityColor(f.severity);
    const severity = f.severity.charAt(0).toUpperCase() + f.severity.slice(1);
    const region = escHtml(f.comparison.left);
    const variable = escHtml(f.variable.label);
    const summary = escHtml(f.summary);
    return `<tr>
      <td style="border-left:3px solid ${color};padding-left:8px;white-space:nowrap">
        <span style="color:${color};font-weight:600">${severity}</span>
      </td>
      <td style="white-space:nowrap">${region}</td>
      <td style="white-space:nowrap">${variable}</td>
      <td>${summary}</td>
    </tr>`;
  }).join('\n');
}

function metaRow(label: string, value: string): string {
  return `<tr><th style="text-align:left;padding-right:24px;color:#555;font-weight:normal">${escHtml(label)}</th><td>${escHtml(value)}</td></tr>`;
}

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

function metaRowsFromWaferMetadata(meta: Record<string, unknown>): string {
  const rendered = new Set<string>();
  const rows: string[] = [];
  for (const { key, label } of KNOWN_META_KEYS) {
    if (key in meta && meta[key] != null && !rendered.has(label)) {
      rows.push(metaRow(label, String(meta[key])));
      rendered.add(label);
    }
  }
  for (const [key, val] of Object.entries(meta)) {
    if (!KNOWN_META_KEYS.some(k => k.key === key) && val != null) {
      const label = key.charAt(0).toUpperCase() + key.slice(1).replace(/([A-Z])/g, ' $1');
      rows.push(metaRow(label, String(val)));
    }
  }
  return rows.join('\n');
}

export function renderFindingsReportHtml(
  summary: StatsSummary | LotStatsSummary,
  options: { title?: string } = {},
): string {
  const isLot = summary.level === 'lot';
  const title = options.title ?? (isLot ? 'Lot Findings Report' : 'Wafer Findings Report');
  const now = new Date().toLocaleString();

  let metaBlock = '';
  if (isLot) {
    const lot = summary as LotStatsSummary;
    const lotMetaRows = lot.lot ? metaRowsFromWaferMetadata(lot.lot) : '';
    const waferIds = lot.perWafer
      .map(w => w.summary.wafer?.['wafer'] ?? w.summary.wafer?.['waferId'])
      .filter(Boolean)
      .join(', ');
    const waferIdsRow = waferIds ? metaRow('Wafers', waferIds) : '';
    metaBlock = `<table style="border-collapse:collapse;margin-bottom:20px;font-size:13px">
      ${lotMetaRows}
      ${waferIdsRow}
      ${metaRow('Wafer count', String(lot.stats.waferCount))}
      ${metaRow('Generated', now)}
    </table>`;
  } else {
    const wafer = summary as StatsSummary;
    const yld = wafer.stats.yieldPercent !== null
      ? `${wafer.stats.yieldPercent.toFixed(1)}%` : 'N/A';
    const waferMetaRows = wafer.wafer ? metaRowsFromWaferMetadata(wafer.wafer) : '';
    metaBlock = `<table style="border-collapse:collapse;margin-bottom:20px;font-size:13px">
      ${waferMetaRows}
      ${metaRow('Total dies', String(wafer.stats.totalDies))}
      ${metaRow('Analysed dies', String(wafer.stats.analyzedDies))}
      ${metaRow('Yield', yld)}
      ${metaRow('Generated', now)}
    </table>`;
  }

  const findings = summary.findings;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>${escHtml(title)}</title>
<style>
  body { font-family: system-ui, sans-serif; font-size: 14px; color: #1a1a2e; margin: 32px; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  .subtitle { color: #666; font-size: 12px; margin: 0 0 24px; }
  table.findings { border-collapse: collapse; width: 100%; }
  table.findings th { background: #f0f2f5; text-align: left; padding: 7px 12px; font-size: 12px;
    text-transform: uppercase; letter-spacing: 0.05em; color: #555; border-bottom: 2px solid #d0d5dd; }
  table.findings td { padding: 8px 12px; border-bottom: 1px solid #e8eaed; vertical-align: top; font-size: 13px; }
  table.findings tr:last-child td { border-bottom: none; }
  table.findings tr:hover td { background: #fafbfc; }
  @media print {
    body { margin: 16px; }
    table.findings tr:hover td { background: none; }
  }
</style>
</head>
<body>
<h1>${escHtml(title)}</h1>
<p class="subtitle">${isLot ? 'Lot-level statistical findings' : 'Wafer-level statistical findings'}</p>
${metaBlock}
<table class="findings">
  <thead>
    <tr>
      <th>Severity</th>
      <th>Region</th>
      <th>Variable</th>
      <th>Finding</th>
    </tr>
  </thead>
  <tbody>
    ${findingRows(findings)}
  </tbody>
</table>
</body>
</html>`;
}

export function openHtmlReport(html: string): void {
  const win = window.open('', '_blank');
  if (!win) return;
  win.document.write(html);
  win.document.close();
}
