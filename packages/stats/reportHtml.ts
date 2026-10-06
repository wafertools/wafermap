import type { StatsFinding, StatsSeverity } from './types.js';
import { SYNTHESIS_SMALLER_HEADING, synthesisRowShare, type Synthesis } from './synthesis.js';
import { formatFindingTooltip } from './findingText.js';
import { arrangeFindings } from './filterFindings.js';
import { SEVERITY_MARK, METER_DOTS, filledDots, impactWord, impactShortWord, shortfallColor, shortfallStep, formatPoints, barPercent, type MeterTier } from './presentation.js';

export type { MeterTier };
import { fmt, plainBinTerms } from '../renderer/fmt.js';
import { buildFacetTable, attributeLabel, type FacetItem } from './facets.js';
import { escHtml } from '../core/utils.js';
import { derivedKeyText, derivedFields } from '../renderer/testLabel.js';

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
    label: attributeLabel(field.key),
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

/** A table cell: raw HTML (the caller escapes), or HTML with a class for the `<td>`. */
export type TableCell = string | { html: string; className?: string };

export function renderTable(
  headers: string[],
  rows: TableCell[][],
  options: { className?: string; emptyMessage?: string } = {},
): string {
  if (!rows.length) {
    return `<p class="no-data">${escHtml(options.emptyMessage ?? 'No data')}</p>`;
  }
  const className = ['report-table', options.className].filter(Boolean).join(' ');
  const head = headers.map((header) => `<th>${escHtml(header)}</th>`).join('');
  const td = (cell: TableCell): string =>
    typeof cell === 'string' ? `<td>${cell}</td>` : `<td${cell.className ? ` class="${cell.className}"` : ''}>${cell.html}</td>`;
  const body = rows.map((row) => `<tr>${row.map(td).join('')}</tr>`).join('\n');
  return `<table class="${className}">
  <thead><tr>${head}</tr></thead>
  <tbody>${body}</tbody>
</table>`;
}

/**
 * Three dots filled by level, with the word beneath. Colour only reinforces it: the dots and the
 * word survive a black-and-white print and colour-blind reading (WCAG 1.4.1), which a bare coloured
 * badge did not. The dots are decoration, hidden from a screen reader that reads the word.
 */
export function renderMeter(tier: MeterTier, word: string): string {
  const filled = filledDots(tier);
  return `<span class="meter"><span class="meter-dots" aria-hidden="true">${'●'.repeat(filled)}${'○'.repeat(METER_DOTS - filled)}</span><span class="meter-word">${escHtml(word)}</span></span>`;
}

export function renderSeverityMeter(severity: StatsSeverity): string {
  const { tier, word } = SEVERITY_MARK[severity];
  return renderMeter(tier, word);
}

export const severityTier = (severity: StatsSeverity): MeterTier => SEVERITY_MARK[severity].tier;

/**
 * A value with a bar behind it, for scanning a column of yields or shares. The figure is always
 * printed; the bar is a second way to read it, scaled 0–100 (so a yield bar is never stretched
 * to its own column's range).
 */
export function barCell(percent: number, text: string, className = '', color?: string): TableCell {
  const fill = color ? `;background:${escHtml(color)}` : '';
  return { html: `<span class="cellbar"><i style="width:${barPercent(percent).toFixed(1)}%${fill}"></i><span>${escHtml(text)}</span></span>`, className: ['barcell', className].filter(Boolean).join(' ') };
}

/** A signed difference in yield points, tinted by `shortfallStep` (only a shortfall of a point or more). */
export function deltaCell(points: number): TableCell {
  const step = shortfallStep(points);
  return { html: escHtml(formatPoints(points)), className: ['numeric', step ? `low-${step}` : ''].filter(Boolean).join(' ') };
}

/**
 * Section ids and a contents line for a report body. Every section is produced by `renderSection`,
 * so its `<h2>` is the title; the ids carry `scope` so several reports in one document cannot clash.
 * Under four sections there is nothing to navigate and the body is returned unchanged.
 */
export function withSectionNav(sectionsHtml: string, scope = ''): string {
  const titles: Array<{ id: string; title: string }> = [];
  let n = 0;
  const body = sectionsHtml.replace(/<section class="(report-section[^"]*)">(\s*<h2>)(.*?)(<\/h2>)/g, (_m, cls, mid, title, end) => {
    const id = `sec-${scope}${++n}`;
    titles.push({ id, title });
    return `<section class="${cls}" id="${id}">${mid}${title}${end}`;
  });
  if (titles.length < 4) return sectionsHtml;
  const links = titles.map((s) => `<a href="#${s.id}">${s.title}</a>`).join('');
  return `<nav class="report-toc" aria-label="Sections">${links}</nav>\n${body}`;
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
/**
 * The anchor a finding's table row carries when the table is the page's one table for that
 * summary. Injective (every character outside A–Z a–z 0–9 becomes `_` and its hex code), so two
 * finding ids can never share an anchor, and valid in an `id` attribute whatever the id holds.
 */
export function findingAnchor(id: string, scope = ''): string {
  return `finding-${scope}` + id.replace(/[^A-Za-z0-9]/g, (c) => `_${c.charCodeAt(0).toString(16)}_`);
}

/**
 * `anchorScope`: give each row an `id` so the synthesis can link to it, prefixed so two summaries in
 * one document cannot share one. Only for the page's one table per summary — a per-wafer table
 * repeats ids that another wafer's table also carries — so it is left out there.
 */
export function findingsTableHtml(findings: StatsFinding[], totalWafers?: number, anchorScope?: string, live = false): string {
  // The panel's arrangement: each pattern with the findings it explains beneath it, then the rest
  // by region, most severe first. The same finding sits in the same place on both surfaces.
  const arranged = arrangeFindings(findings);
  const ordered: Array<{ f: StatsFinding; nested: boolean }> = [
    ...arranged.patterns.flatMap((p) => [{ f: p.finding, nested: false }, ...p.children.map((f) => ({ f, nested: true }))]),
    ...arranged.groups.flatMap((g) => g.findings.map((f) => ({ f, nested: false }))),
  ];
  const rows = ordered.length
    ? ordered.map(({ f, nested }) => `<tr class="tier-${severityTier(f.severity)}${nested ? ' nested' : ''}${live ? ' live' : ''}"${anchorScope !== undefined ? ` id="${findingAnchor(f.id, anchorScope)}"` : ''}${live ? ` data-finding="${escHtml(f.id)}"` : ''} title="${escHtml(formatFindingTooltip(f))}${live ? '\nClick to show it on the map' : ''}">
      <td class="tight">${renderSeverityMeter(f.severity)}</td>
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

/**
 * The synthesis as a section: the headline, the loss items each linked to the finding rows that
 * carry their figures, and what was compared. A part links only when its row is on the page
 * (`anchorIds`), so a sentence never points at nothing.
 */
export function synthesisSectionHtml(synthesis: Synthesis, anchorIds: ReadonlySet<string>, scope = ''): string {
  const run = (parts: Synthesis['headline']): string => parts.map((p) =>
    p.target && anchorIds.has(p.target.id)
      ? `<a href="#${findingAnchor(p.target.id, scope)}">${escHtml(p.text)}</a>`
      : escHtml(p.text)).join('');
  const [lead, ...others] = synthesis.items;
  // The top item gets the full sentence in a tinted box; everything else is a compact row (marker, the
  // item in a few words, its share of the dies) so three equal boxes never compete for the eye.
  const smaller = [...others, ...(synthesis.also?.items ?? [])];
  const more = synthesis.also?.more ?? 0;
  const items = lead
    ? `<ol class="synthesis-items">\n<li class="tier-${lead.impact}">${renderMeter(lead.impact, impactWord(lead.impact))}<span>${run(lead.parts)}</span></li>\n</ol>`
    : `<p class="synthesis-none">${escHtml(synthesis.nothing ?? 'Nothing stands out.')}</p>`;
  const rows = smaller.length
    ? `<p class="synthesis-smaller">${escHtml(SYNTHESIS_SMALLER_HEADING)}</p>
  <ul class="synthesis-more">
${smaller.map((it) => `<li>${renderMeter(it.impact, impactShortWord(it.impact))}<span>${run([it.brief])}</span><span class="synthesis-share">${escHtml(synthesisRowShare(it))}</span></li>`).join('\n')}${more ? `\n<li class="synthesis-rest"><span></span><span>and ${more} more</span><span></span></li>` : ''}
  </ul>`
    : '';
  return renderSection('What stands out', `<p class="synthesis-headline">${run(synthesis.headline)}</p>
  ${items}
  ${rows}
  ${synthesis.watch ? `<ul class="synthesis-watch">${synthesis.watch.map((w) => `<li><strong>Watch</strong> ${run(w.parts)}</li>`).join('')}</ul>` : ''}
  <p class="synthesis-checked">${escHtml(synthesis.checked)}</p>`, 'synthesis');
}

/**
 * For a report shown inside the app (the panel's modal): a click on a finding's row tells the page that
 * holds the report, which selects that finding on the map. Inert when the report is opened on its own
 * (no parent window) or where scripts are blocked, and the rows stay a plain table either way.
 */
export const LIVE_FINDINGS_SCRIPT = `<script>
document.addEventListener('click', function (e) {
  var row = e.target.closest && e.target.closest('[data-finding]');
  if (row && window.parent !== window) window.parent.postMessage({ wmapFinding: row.getAttribute('data-finding') }, '*');
});
</script>`;

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
    /* A tint says "look here"; the dots and the word say what. Text on a tint is always full ink:
       the muted grey is 3.3:1 on the strongest pastel, below AA. */
    --report-tier-high-bg: #fbe4e2;
    --report-tier-high-edge: #b4372f;
    --report-tier-medium-bg: #fdf0d5;
    --report-tier-medium-edge: #a8741a;
    --report-tier-low-bg: #edf2f7;
    --report-tier-low-edge: #5f7f9f;
    --report-low-1: ${shortfallColor(1)};
    --report-low-2: ${shortfallColor(2)};
    --report-low-3: ${shortfallColor(3)};
    --report-bar: #9db8d3;
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
  .synthesis-headline { font-weight: 600; margin: 0 0 8px; }
  .synthesis-items { list-style: none; margin: 0 0 8px; padding: 0; }
  .synthesis-items li {
    display: grid;
    grid-template-columns: 96px 1fr;
    gap: 10px;
    align-items: start;
    margin: 0 0 8px;
    padding: 9px 12px;
    border-left: 4px solid var(--report-tier-low-edge);
    border-radius: 0 4px 4px 0;
    background: var(--report-tier-low-bg);
    line-height: 1.45;
  }
  .synthesis-items li.tier-high { border-color: var(--report-tier-high-edge); background: var(--report-tier-high-bg); }
  .synthesis-items li.tier-medium { border-color: var(--report-tier-medium-edge); background: var(--report-tier-medium-bg); }
  .synthesis-smaller { margin: 0 0 4px; color: var(--report-muted); }
  .synthesis-more { list-style: none; margin: 0 0 8px; padding: 0; }
  .synthesis-more li { display: grid; grid-template-columns: 96px 1fr auto; gap: 10px; align-items: baseline; margin: 0 0 3px; }
  .synthesis-share { font-variant-numeric: tabular-nums; color: var(--report-muted); }
  .synthesis-watch { list-style: none; margin: 0 0 6px; padding: 0; }
  .synthesis-watch li { margin: 0 0 3px; }
  .synthesis-watch strong { margin-right: 6px; font-size: 11px; letter-spacing: 0.06em; text-transform: uppercase; color: var(--report-muted); }
  .synthesis-checked, .synthesis-none { color: var(--report-muted); margin: 0; }
  .synthesis a { color: inherit; text-decoration: underline dotted; }

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

  /* Tiles for the key figures, so they read as a row of facts and not a line of the list. */
  .metric-grid .metric {
    padding: 10px 12px;
    background: var(--report-surface);
    border: 1px solid var(--report-line);
    border-radius: 6px;
  }

  .report-toc {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 16px;
    margin: 0 0 18px;
    padding: 8px 0;
    border-top: 1px solid var(--report-line);
    border-bottom: 1px solid var(--report-line);
    font-size: 12px;
  }

  .report-toc a { color: var(--report-muted); text-decoration: none; }
  .report-toc a:hover { color: var(--report-text); text-decoration: underline; }

  /* The value is always printed; the bar behind it is for scanning a column. */
  table.report-table td.barcell { min-width: 150px; }
  .cellbar { position: relative; display: block; }
  .cellbar i {
    position: absolute;
    left: 0;
    top: 50%;
    height: 12px;
    transform: translateY(-50%);
    background: var(--report-bar);
    border-radius: 0 2px 2px 0;
  }
  .cellbar span { position: relative; padding-left: 4px; }

  /* Shortfall below the reference, light to strong. Full ink on every tint (see the tier tokens). */
  table.report-table td.low-1 { background: var(--report-low-1); }
  table.report-table td.low-2 { background: var(--report-low-2); }
  table.report-table td.low-3 { background: var(--report-low-3); }
  table.report-table td.muted-row, table.report-table td.muted-row .cellbar { color: var(--report-muted); }
  .report-legend { margin: 6px 0 0; color: var(--report-muted); font-size: 11px; }

  .meter {
    display: inline-flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 1px;
    line-height: 1.2;
    white-space: nowrap;
  }

  .meter-dots {
    font-size: 12px;
    letter-spacing: 2px;
  }

  .meter-word {
    color: var(--report-text);
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.04em;
  }

  /* In the app, a row shows its finding on the map. */
  table.findings-table tr.live { cursor: pointer; }
  table.findings-table tr.live:hover td { box-shadow: inset 0 0 0 9999px rgba(0, 0, 0, 0.04); }

  /* A finding a pattern explains sits beneath it, indented. */
  table.findings-table tr.nested td:first-child { padding-left: 22px; }
  table.findings-table tr.nested td { font-size: 12px; }

  /* Findings table: the row carries the tier as a tint and a left edge; the meter carries it in words. */
  table.findings-table tr.tier-high td { background: var(--report-tier-high-bg); }
  table.findings-table tr.tier-medium td { background: var(--report-tier-medium-bg); }
  table.findings-table tr.tier-high td:first-child { box-shadow: inset 4px 0 0 var(--report-tier-high-edge); }
  table.findings-table tr.tier-medium td:first-child { box-shadow: inset 4px 0 0 var(--report-tier-medium-edge); }

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

    .report-toc { display: none; }

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
