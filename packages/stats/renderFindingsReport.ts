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
    const severity = f.severity.charAt(0).toUpperCase() + f.severity.slice(1);
    const region   = escHtml(f.comparison.left);
    const variable = escHtml(f.variable.label);
    const summary  = escHtml(f.summary);
    return `<tr>
      <td style="white-space:nowrap"><span class="sev sev-${f.severity}">${severity}</span></td>
      <td style="white-space:nowrap">${region}</td>
      <td style="white-space:nowrap">${variable}</td>
      <td>${summary}</td>
    </tr>`;
  }).join('\n');
}

function metaRow(label: string, value: string): string {
  return `<tr><td>${escHtml(label)}</td><td>${escHtml(value)}</td></tr>`;
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
    metaBlock = `<table class="meta">
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
    metaBlock = `<table class="meta">
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
  body    { font-family: system-ui, sans-serif; font-size: 14px; color: #1a1a2e; margin: 32px; max-width: 900px; }
  h1      { font-size: 22px; margin: 0 0 20px; }
  table.meta { border-collapse: collapse; width: auto; min-width: 320px; margin-bottom: 16px; }
  table.meta td { padding: 5px 10px; font-size: 13px; border-bottom: 1px solid #e8eaed; }
  table.meta td:first-child { color: #506784; font-size: 12px; width: 140px; background: #f7f8fa; }
  table.meta tbody tr:nth-child(even) td { background: #f7f8fa; }
  table.meta tbody tr:nth-child(even) td:first-child { background: #eef0f4; }
  table.meta tbody tr:last-child td { border-bottom: none; }
  table.findings { border-collapse: collapse; width: 100%; }
  table.findings th { background: #f0f2f5; text-align: left; padding: 5px 10px; font-size: 11px;
    text-transform: uppercase; letter-spacing: 0.05em; color: #506784; border-bottom: 2px solid #d0d5dd; font-weight: 600; }
  table.findings td { padding: 5px 10px; border-bottom: 1px solid #e8eaed; vertical-align: top; font-size: 13px; }
  table.findings tbody tr:nth-child(even) td { background: #f7f8fa; }
  table.findings tbody tr:last-child td { border-bottom: none; }
  table.findings tr:hover td { background: #f0f4fc; }
  .sev { display: inline-block; font-size: 11px; font-weight: 600; color: #fff;
         border-radius: 3px; padding: 1px 6px; white-space: nowrap; }
  .sev-unusual { background: #c0392b; }
  .sev-notable { background: #b96a00; }
  .sev-info    { background: #2980b9; }
  @media print {
    body { margin: 16px; }
    table.findings tr:hover td { background: none; }
  }
</style>
</head>
<body>
<h1>${escHtml(title)}</h1>
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
