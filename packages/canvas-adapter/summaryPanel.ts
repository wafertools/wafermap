// ── Summary panel ───────────────────────────────────────────────────────────
// Always-available docked panel (toggled via the toolbar) showing metadata,
// yield, bin breakdown, ring/quadrant yield, test values, and findings for a
// single wafer or a lot — plus one combined "Report" button
// (`renderSummaryReportHtml`/`renderLotSummaryReportHtml`, which already
// embed findings). Imported by renderWaferMap and renderWaferGallery.
//
// Bin/ring/quadrant/test/yield numbers here and in the opt-in Insights tab
// (insightsTab.ts) intentionally read the same shared computation —
// `StatsSummary.stats.hardBinCounts`/`.perTestStats`/`.testSpecYield`
// (analyzeWaferMap) and `buildRegionYieldData` (stats/regions.ts) — so the
// two surfaces can show overlapping numbers (compact text here, charts
// there) without ever being able to drift apart.

import type { Wafer } from '../core/wafer.js';
import type { Die, PositionedDie } from '../core/dies.js';
import { isParametricTest, type BinDef, type TestDef, type YieldSummary, type MetadataFieldDef } from '../renderer/buildWaferMap.js';
import type { StatsFinding, StatsSummary, LotStatsSummary, StatsSeverity, StatsVariableKind, StatsComparisonFamily } from '../stats/types.js';
import { buildRingRegions, buildQuadrantRegions, buildRegionYieldData, type StatsRegion } from '../stats/regions.js';
import { computeFunctionalYield } from '../stats/analyzeWaferMap.js';
import { openHtmlReport } from '../stats/renderFindingsReport.js';
import { renderSummaryReportHtml, renderLotSummaryReportHtml } from '../stats/renderSummaryReport.js';
import { buildFindingsNarrative } from '../stats/findingsNarrative.js';
import { filterFindings, type FindingsFilter } from '../stats/filterFindings.js';
import { buildFacetTable, prettyKey, type FacetItem } from '../stats/facets.js';
import { commonMetadata } from '../stats/facets.js';
import { resolveMetadataColumns, type MetadataColumn } from '../stats/metadataColumns.js';
import { getColorScheme } from '../renderer/colorSchemes.js';
import { buildWarningsBanner, collectWarnings, type WaferWarning } from './warnings.js';
export { buildWarningsBanner };
import { fmt as fmtValue, fmtAggregationMethod, plainBinTerms } from '../renderer/fmt.js';
import { getUniqueTestNumbers } from '../renderer/buildView.js';
import { quantile } from '../stats/math.js';
import { makeLabeledSelect } from './charts/chartShell.js';
import { CLR, sevColor, openModal, saveTextFile, type SaveTextHandler } from './toolbar.js';
import { buildDieListSection, type DieListDisplayOptions } from './dieList.js';
import { medianOfSorted } from '../core/utils.js';
import { metadataDisplayValue } from '../core/metadata.js';
import type { WaferMetadata } from '../core/metadata.js';

// ── Panel option type ─────────────────────────────────────────────────────────

export interface SummaryPanelOptions {
  /** Which side of the content area to place the panel. Default 'right'. */
  placement?: 'right' | 'left' | 'top' | 'bottom';
  /** Open the panel immediately on render without requiring the user to click the toolbar button. Default false. */
  defaultOpen?: boolean;
}

// ── Styles ────────────────────────────────────────────────────────────────────

const PANEL_BG    = CLR.panelBg;
const BORDER      = `1px solid ${CLR.menuBorder}`;
const SECTION_GAP = '12px';
const LABEL_COLOR = CLR.label;
const VALUE_COLOR = CLR.value;
const TITLE_SIZE  = '10px';

// ── Helpers ───────────────────────────────────────────────────────────────────

// `ownerDocument` defaults to the bare global so every existing call site
// (hundreds, throughout this file) stays valid unchanged — only the entry
// points reachable from a gallery card detached into its own popup window
// (createSummaryPanelEl, below) actually thread a real one through. Content
// built inside that panel via a bare-`document` `el()` call still renders
// correctly there (the DOM allows adopting a node created in one document
// into another document's tree on `appendChild`); what a wrong document
// would break is anything doc-level — `<style>` injection (this file injects
// none) or reading `document.activeElement`/listeners (not done via `el()`
// here) — so this is the low-risk half of the fix, not a full rewrite.
function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  styles?: Partial<CSSStyleDeclaration>,
  text?: string,
  ownerDocument: Document = document,
): HTMLElementTagNameMap[K] {
  const e = ownerDocument.createElement(tag);
  if (styles) Object.assign(e.style, styles);
  if (text !== undefined) e.textContent = text;
  return e;
}

function sectionTitle(label: string): HTMLDivElement {
  const d = el('div', {
    fontSize:      TITLE_SIZE,
    fontWeight:    '700',
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
    color:         LABEL_COLOR,
    marginBottom:  '6px',
  }, label);
  return d;
}

/** Collapsible section wrapper. Returns the outer container and the content div. */
function collapsibleSection(
  label: string,
  defaultOpen = true,
  badge?: string,
): { outer: HTMLDivElement; content: HTMLDivElement } {
  const outer = el('div');

  const toggle = document.createElement('button');
  toggle.type = 'button';
  Object.assign(toggle.style, {
    display:        'flex',
    alignItems:     'center',
    gap:            '4px',
    width:          '100%',
    background:     'none',
    border:         'none',
    cursor:         'pointer',
    padding:        '0 0 6px',
    textAlign:      'left',
  });

  const arrow = el('span', {
    fontSize:    '9px',
    color:       LABEL_COLOR,
    transition:  'transform 0.15s',
    transform:   defaultOpen ? 'rotate(90deg)' : 'rotate(0deg)',
    display:     'inline-block',
    lineHeight:  '1',
    marginRight: '1px',
  }, '▶');

  const titleEl = el('span', {
    fontSize:      TITLE_SIZE,
    fontWeight:    '700',
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
    color:         LABEL_COLOR,
    flex:          '1',
  }, label);

  toggle.setAttribute('aria-expanded', defaultOpen ? 'true' : 'false');
  toggle.appendChild(arrow);
  toggle.appendChild(titleEl);

  if (badge) {
    const badgeEl = el('span', {
      fontSize:     '9px',
      fontWeight:   '700',
      background:   CLR.warnBg,
      color:        CLR.warnText,
      borderRadius: '10px',
      padding:      '1px 5px',
    }, badge);
    toggle.appendChild(badgeEl);
  }

  const content = el('div');
  content.style.display = defaultOpen ? 'block' : 'none';

  let open = defaultOpen;
  toggle.addEventListener('click', () => {
    open = !open;
    content.style.display = open ? 'block' : 'none';
    arrow.style.transform = open ? 'rotate(90deg)' : 'rotate(0deg)';
    toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
  });

  outer.appendChild(toggle);
  outer.appendChild(content);
  return { outer, content };
}

function separator(): HTMLDivElement {
  return el('div', {
    height:     '1px',
    background: CLR.separator,
    margin:     `${SECTION_GAP} 0`,
    flexShrink: '0',
  });
}

/** Render a progress bar row: label left, bar + percent right.
 *  `fillPct` overrides bar width independently of the displayed value — use for
 *  range-normalised bars where the fill encodes relative spread, not absolute yield.
 *  `medianLinePct` draws a vertical rule at that fill % position (lot median marker).
 *  `belowMedian` renders the fill in a muted colour. */
function progressRow(
  label: string,
  value: number,
  color = CLR.barFill,
  fillPct?: number,
  medianLinePct?: number,
  belowMedian?: boolean,
): HTMLDivElement {
  const row = el('div', { marginBottom: '5px' });

  const top = el('div', {
    display:        'flex',
    justifyContent: 'space-between',
    fontSize:       '11px',
    color:          VALUE_COLOR,
    marginBottom:   '2px',
  });
  const lbl = el('span', {}, label);
  const pct = el('span', { fontWeight: '600' }, `${value.toFixed(1)}%`);
  top.appendChild(lbl);
  top.appendChild(pct);

  const barWidth  = fillPct !== undefined ? fillPct : Math.min(100, Math.max(0, value));
  const fillColor = belowMedian ? CLR.barFillMuted : color;
  const track = el('div', {
    position:     'relative',
    height:       '9px',
    background:   CLR.bgActive,
    borderRadius: '4px',
    overflow:     'hidden',
  });
  const fill = el('div', {
    height:       '100%',
    width:        `${barWidth}%`,
    background:   fillColor,
    borderRadius: '4px',
    transition:   'width 0.3s ease',
  });
  track.appendChild(fill);
  if (medianLinePct !== undefined) {
    const line = el('div', {
      position:   'absolute',
      top:        '0',
      bottom:     '0',
      left:       `${medianLinePct}%`,
      width:      '1px',
      background: CLR.infoText,
      opacity:    '0.5',
    });
    track.appendChild(line);
  }
  row.appendChild(top);
  row.appendChild(track);
  return row;
}

/** Big stat card — used for yield % and total dies. `sublabel` renders as
 *  its own smaller line under the label, so qualifying context ("pass:
 *  bin 1") wraps as a deliberate second line instead of breaking a
 *  parenthetical mid-word at narrow panel widths. */
function statCard(value: string, label: string, sublabel?: string): HTMLDivElement {
  const card = el('div', {
    background:   CLR.menuBg,
    border:       BORDER,
    borderRadius: '6px',
    padding:      '8px 10px',
    textAlign:    'center',
    flex:         '1',
  });
  const v = el('div', {
    fontSize:   '20px',
    fontWeight: '700',
    color:      VALUE_COLOR,
    lineHeight: '1.2',
  }, value);
  const lbl = el('div', {
    fontSize:   '10px',
    color:      LABEL_COLOR,
    marginTop:  '2px',
  }, label);
  card.appendChild(v);
  card.appendChild(lbl);
  if (sublabel) {
    card.appendChild(el('div', {
      fontSize: '9px',
      color:    LABEL_COLOR,
      opacity:  '0.85',
    }, sublabel));
  }
  return card;
}

/** Key-value row for metadata. */
function kvRow(key: string, value: string): HTMLDivElement {
  const row = el('div', {
    display:        'flex',
    justifyContent: 'space-between',
    fontSize:       '11px',
    gap:            '8px',
    marginBottom:   '3px',
  });
  const k = el('span', { color: LABEL_COLOR, flexShrink: '0' }, key);
  const v = el('span', { color: VALUE_COLOR, textAlign: 'right', fontWeight: '500', wordBreak: 'break-all' }, value);
  row.appendChild(k);
  row.appendChild(v);
  return row;
}


// ── Section builders ──────────────────────────────────────────────────────────

/** Label immediately followed by its value, left-aligned — unlike `kvRow`
 *  (label/value pinned to opposite ends of the row via `space-between`),
 *  which reads fine in a narrow sidebar column but pushes the value far
 *  from its label once the row spans a full-width card, as the metadata
 *  card does. */
function metaRow(key: string, value: string): HTMLDivElement {
  const row = el('div', {
    display:      'flex',
    fontSize:     '11px',
    gap:          '6px',
    marginBottom: '3px',
  });
  const k = el('span', { color: LABEL_COLOR, flexShrink: '0' }, `${key}:`);
  const v = el('span', { color: VALUE_COLOR, fontWeight: '500', wordBreak: 'break-all' }, value);
  row.appendChild(k);
  row.appendChild(v);
  return row;
}

/** Order-preserving [key, value] pairs from a metadata-like record, with
 *  null/undefined/empty-string entries dropped. The single source of truth
 *  for "what counts as a displayable metadata field" — shared by the map
 *  metadata badge and `buildMetadataStripRow`/`buildFacetSummaryChips` so
 *  they can't drift on what they consider "no metadata". */
export function metadataEntries(meta: Record<string, unknown>): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (const [k, v] of Object.entries(meta)) {
    const str = metadataDisplayValue(v);
    if (str !== undefined) out.push([k, str]);
  }
  return out;
}

/** Single-line, wrap-when-needed "Label: value1, value2 [+N more]" chips —
 *  the gallery's top-of-grid strip summary over a whole (possibly multi-lot)
 *  population, one chip per `FacetField` from `stats/facets.ts`'s
 *  `buildFacetTable`. Shows every distinct value a field takes
 *  across the population — so a mixed-lot gallery still surfaces "Lot:
 *  LOT123, LOT456" instead of silently dropping a field the moment it
 *  varies. `field.values` is already sorted by coverage (`buildFacetTable`),
 *  so the values shown inline are the most common ones. Labels use
 *  `prettyKey(field.key)`, not `field.label` — `DEFAULT_FACET_CURATION`'s own
 *  labels (e.g. "Program") differ from the `prettyKey` convention every other
 *  metadata surface in this library uses ("Test Program"), and this strip
 *  must read as the same field as those surfaces, not a differently-named one.
 *  Returns `null` for an empty table. */
export function buildFacetSummaryChips(
  table: Array<{ key: string; values: Array<{ value: string }> }>,
  maxValuesPerField = 3,
): HTMLDivElement | null {
  if (!table.length) return null;

  const row = el('div', {
    display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: '4px 10px', fontSize: '11px',
  });
  for (const field of table) {
    const chip = el('span', { whiteSpace: 'nowrap' });
    const label = el('span', { color: LABEL_COLOR }, `${prettyKey(field.key)}: `);
    chip.appendChild(label);
    const shown = field.values.slice(0, maxValuesPerField);
    const remaining = field.values.length - shown.length;
    let text = shown.map(v => v.value).join(', ');
    if (remaining > 0) text += ` +${remaining} more`;
    chip.appendChild(document.createTextNode(text));
    row.appendChild(chip);
  }
  return row;
}

export interface MetadataStripStacked {
  lotSize: number;
  aggrMethod?: string;
}

/** The single correct way to summarize a population's identity as an
 *  always-visible strip: computed via `buildFacetTable`/`buildFacetSummaryChips`
 *  over every item's own metadata, so a field that varies across items (e.g. a
 *  lot with mixed `split` values) shows every distinct value it takes — never
 *  silently collapsed to one item's value (e.g. `analyzeWaferLot`'s
 *  first-wafer-wins `lot` field), which misrepresents the population (see
 *  CLAUDE.md: aggregated/filtered populations must be identified). Shared by
 *  the gallery legend strip and the Insights header strip so the two surfaces
 *  can't drift on content or field order again. Returns `null` when there's
 *  nothing to show. */
export function buildMetadataStripRow(
  items: Array<{ metadata?: Record<string, unknown> }>,
  stacked?: MetadataStripStacked,
  // `facetableOnly` (default true, matching `buildFacetTable`) drops
  // `waferId` — right for a multi-item population, where every distinct
  // wafer ID would otherwise clutter the strip with something each card
  // already shows as its own title. A single-item caller (a lone wafer's own
  // Insights strip) has no such clutter risk and no other on-screen identity
  // once Insights covers the badge, so it passes `false` to keep `waferId` visible.
  options?: { facetableOnly?: boolean },
): HTMLDivElement | null {
  const facetTable = buildFacetTable(items as FacetItem[], options);
  const chips = buildFacetSummaryChips(facetTable);
  if (!chips && !stacked) return null;

  const row = el('div', { display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: '4px 14px' });
  if (stacked) {
    const span = el('span', { fontWeight: '500', whiteSpace: 'nowrap' },
      stacked.aggrMethod ? `${stacked.lotSize} wafers stacked · ${stacked.aggrMethod}` : `${stacked.lotSize} wafers stacked`);
    row.appendChild(span);
  }
  if (chips) row.appendChild(chips);
  return row;
}

const STRIP_BOX_STYLE: Partial<CSSStyleDeclaration> = {
  display:       'flex',
  flexDirection: 'column',
  gap:           '6px',
  background:    CLR.menuBg,
  border:        `1px solid ${CLR.menuBorder}`,
  borderRadius:  '6px',
  padding:       '6px 10px',
  boxShadow:     '0 1px 4px rgba(0,0,0,0.10)',
  fontSize:      '12px',
  lineHeight:    '1',
  boxSizing:     'border-box',
  width:         '100%',
  minWidth:      '0',
};

/** `buildMetadataStripRow` wrapped in the boxed-strip chrome every
 *  standalone, always-visible metadata strip uses (border/background/shadow
 *  — the same look as the gallery legend strip). Not used by the gallery
 *  legend itself, which stacks a bin-swatch row inside the same box below
 *  the metadata row and so builds its own box around both rather than two
 *  nested boxes — that caller uses `buildMetadataStripRow` directly. */
export function buildMetadataStripBox(
  items: Array<{ metadata?: Record<string, unknown> }>,
  stacked?: MetadataStripStacked,
  options?: { facetableOnly?: boolean },
): HTMLDivElement | null {
  const row = buildMetadataStripRow(items, stacked, options);
  if (!row) return null;
  const box = el('div', STRIP_BOX_STYLE);
  box.appendChild(row);
  return box;
}

/** Same row visual language as `metaRow`/`prettyKey`, one field per line —
 *  for the metadata badge's expand-on-click popover, where each field
 *  reading on its own line is more legible than wrapped inline chips and the
 *  cost is only paid while the popover is open, not by default.
 *  Returns `null` for empty input. */
export function buildCompactMetadataRows(meta: Record<string, unknown>): HTMLDivElement | null {
  const entries = metadataEntries(meta);
  if (!entries.length) return null;

  const wrap = el('div');
  for (const [k, v] of entries) {
    wrap.appendChild(metaRow(prettyKey(k), v));
  }
  return wrap;
}

/**
 * The single source of metadata display in the Summary panel — used by both
 * the single-wafer and lot paths, always built via `buildMetadataStripRow`/
 * `buildFacetTable` (the same function the gallery legend strip and Insights
 * header strip use) rather than reading `wafer.metadata` directly (drifts
 * from the strip's truncation/formatting) or `LotStatsSummary.lot`
 * (`analyzeWaferLot`'s first-wafer-wins field, which silently collapses any
 * field that varies across the lot to one wafer's value — see CLAUDE.md on
 * identifying aggregated populations). A population of one wafer is just a
 * facet table where every field has exactly one value, so the single-wafer
 * and lot panels can never render different content for the same
 * underlying metadata.
 */
export function buildMetadataInfoSection(
  items: Array<{ metadata?: Record<string, unknown> }>,
  stacked?: MetadataStripStacked,
): HTMLDivElement | null {
  const row = buildMetadataStripRow(items, stacked, { facetableOnly: items.length > 1 });
  if (!row) return null;
  const wrap = el('div');
  wrap.appendChild(sectionTitle('Wafer Info'));
  wrap.appendChild(row);
  return wrap;
}

export function buildYieldSection(
  yieldSummary: YieldSummary,
  dataCoverage: { filledDies: number; totalDies: number; edgeExcludedDies: number; ratio: number },
  passBins: number[] = [1],
): HTMLDivElement {
  const wrap = el('div');
  wrap.appendChild(sectionTitle('Summary'));

  const cards = el('div', { display: 'flex', gap: '6px', marginBottom: '8px' });
  // yieldSummary.totalDies, not dataCoverage.totalDies: yield is deliberately
  // non-spatial (isYieldEligibleDie never checks position), so it already
  // includes coordinate-less dies with bin data — dataCoverage.totalDies is
  // scoped to positioned dies only (it's the map's fill-coverage denominator)
  // and would read misleadingly as "0" for a coordinate-less wafer sitting
  // right next to a non-zero Yield card.
  cards.appendChild(statCard(String(yieldSummary.totalDies), 'Total dies'));
  if (yieldSummary.partialDies > 0) {
    cards.appendChild(statCard(String(yieldSummary.partialDies), 'Partial'));
  }
  if (yieldSummary.yieldPercent !== null) {
    const binLabel = passBins.length === 1 ? `bin ${passBins[0]}` : `bins ${passBins.join(', ')}`;
    cards.appendChild(statCard(`${yieldSummary.yieldPercent.toFixed(1)}%`, 'Yield', `pass: ${binLabel}`));
  }
  wrap.appendChild(cards);

  if (yieldSummary.edgeExcludedDies > 0) {
    wrap.appendChild(kvRow('Edge excluded (outer zone)', String(yieldSummary.edgeExcludedDies)));
  }

  return wrap;
}

export function buildBinSection(
  dies: Die[],
  binDefs: BinDef[] | undefined,
  mode: 'hard' | 'soft',
  colorScheme?: string,
  /**
   * Precomputed counts (e.g. `StatsSummary.stats.hardBinCounts`/`.softBinCounts`,
   * already scoped to the yield-eligible population) — used directly instead
   * of re-walking `dies` when supplied.
   */
  precomputedCounts?: Record<number, number>,
): HTMLDivElement | null {
  const binCounts = new Map<number, number>();
  if (precomputedCounts) {
    for (const [binStr, count] of Object.entries(precomputedCounts)) binCounts.set(Number(binStr), count);
  } else {
    for (const d of dies) {
      if (d.partial || d.edgeExcluded) continue;
      const b = mode === 'hard' ? d.hbin : d.sbin;
      if (b != null) binCounts.set(b, (binCounts.get(b) ?? 0) + 1);
    }
  }
  if (!binCounts.size) return null;

  const total = [...binCounts.values()].reduce((a, b) => a + b, 0);
  const defMap = binDefs ? new Map(binDefs.map(d => [d.bin, d])) : null;
  const sorted = [...binCounts.entries()].sort((a, b) => a[0] - b[0]);

  const wrap = el('div');
  wrap.appendChild(sectionTitle(mode === 'hard' ? 'Hard Bin Breakdown' : 'Soft Bin Breakdown'));
  for (const [bin, count] of sorted) {
    const def   = defMap?.get(bin);
    const label = def?.name ? `Bin ${bin} · ${def.name}` : `Bin ${bin}`;
    const pct   = (count / total) * 100;
    const scheme = getColorScheme(colorScheme);
    const color  = (colorScheme === 'custom' ? def?.color : undefined) ?? scheme.forBin(bin);
    wrap.appendChild(progressRow(`${label}  (${count})`, pct, color));
  }
  return wrap;
}

/** Aggregate bin counts across all wafers in the lot — no lot-pooled
 *  precomputed bin counts exist (`hardBinCounts`/`softBinCounts` are
 *  per-wafer only), so this scans the pooled `Die[]` directly, same as
 *  `buildBinSection` does when it has no `precomputedCounts`. */
export function buildLotBinSection(
  allDies: Die[],
  binDefs: BinDef[] | undefined,
  mode: 'hard' | 'soft',
  colorScheme?: string,
): HTMLDivElement | null {
  return buildBinSection(allDies, binDefs, mode, colorScheme);
}

/**
 * Ring/quadrant yield section — single source of truth for the pass/total
 * tally is `buildRegionYieldData` (`stats/regions.ts`), the same function
 * the Insights Overview tab's region-yield diagram consumes. Rendered here
 * as compact progress rows on an absolute 0–100% scale (not rescaled to the
 * rows' local min/max — a real spread reads as tight, not exaggerated).
 * Works uniformly for a single wafer (`diesByWafer: [dies]`,
 * `allWafers: [wafer]`) or a whole lot.
 */
function buildRegionYieldSection(
  diesByWafer: Die[][],
  allWafers: Wafer[],
  ringCount: number,
  passBins: number[],
  regionBuilder: (dies: PositionedDie[], wafer: Wafer, ringCount: number) => StatsRegion[],
  title: string,
): HTMLDivElement | null {
  const data = buildRegionYieldData(diesByWafer, allWafers, ringCount, passBins, regionBuilder);
  if (!data.length) return null;

  const wrap = el('div');
  wrap.appendChild(sectionTitle(title));
  for (const { label, n, yieldPercent } of data) {
    wrap.appendChild(progressRow(`${label} (N=${n})`, yieldPercent));
  }
  return wrap;
}

export function buildRingSection(
  dies: Die[],
  wafer: Wafer,
  ringCount: number,
  passBins: number[],
): HTMLDivElement | null {
  return buildRegionYieldSection([dies], [wafer], ringCount, passBins, buildRingRegions, 'Ring Yield');
}

export function buildQuadrantSection(
  dies: Die[],
  wafer: Wafer,
  ringCount: number,
  passBins: number[],
): HTMLDivElement | null {
  return buildRegionYieldSection([dies], [wafer], ringCount, passBins, buildQuadrantRegions, 'Quadrant Yield');
}

/** Aggregate ring yield across all wafers in the lot. */
export function buildLotRingSection(
  diesByWafer: Die[][],
  allWafers: Wafer[],
  ringCount: number,
  passBins: number[],
): HTMLDivElement | null {
  return buildRegionYieldSection(diesByWafer, allWafers, ringCount, passBins, buildRingRegions, 'Ring Yield');
}

/** Aggregate quadrant yield across all wafers in the lot. */
export function buildLotQuadrantSection(
  diesByWafer: Die[][],
  allWafers: Wafer[],
  ringCount: number,
  passBins: number[],
): HTMLDivElement | null {
  return buildRegionYieldSection(diesByWafer, allWafers, ringCount, passBins, buildQuadrantRegions, 'Quadrant Yield');
}

/** Lot overview — wafer count and mean (unweighted arithmetic mean of each
 *  wafer's own yield%, not a die-weighted lot yield — see CLAUDE.md on
 *  correctly labelling aggregation methods) wafer yield. Metadata is a
 *  separate section (`buildMetadataInfoSection`) built from the lot's own
 *  items, not from `lotSummary.lot` — see that function's doc comment. */
export function buildLotOverviewSection(lotSummary: LotStatsSummary): HTMLDivElement {
  const wrap = el('div');
  wrap.appendChild(sectionTitle('Lot Summary'));

  const cards = el('div', { display: 'flex', gap: '6px', marginBottom: '8px' });
  cards.appendChild(statCard(String(lotSummary.stats.waferCount), 'Wafers'));

  const waferYields = lotSummary.perWafer
    .map(pw => pw.summary.stats.yieldPercent)
    .filter((y): y is number => y !== null);

  if (waferYields.length) {
    const mean = waferYields.reduce((a, b) => a + b, 0) / waferYields.length;
    cards.appendChild(statCard(`${mean.toFixed(1)}%`, 'Mean wafer yield'));
  }
  wrap.appendChild(cards);

  return wrap;
}

/** Per-wafer yield bars, absolute 0–100% scale, with a median marker line and
 *  below-median wafers muted — lets an engineer spot outlier wafers within
 *  the lot at a glance. */
export function buildPerWaferYieldSection(
  lotSummary: LotStatsSummary,
  items: Array<{ label?: string } | null>,
  onWaferClick?: (waferIndex: number) => void,
): HTMLDivElement | null {
  const waferData = lotSummary.perWafer
    .map(pw => ({
      waferIndex: pw.waferIndex,
      label: (items[pw.waferIndex]?.label ?? `W${pw.waferIndex + 1}`)
        .replace(/\s*·\s*\d+(\.\d+)?%$/, ''),
      yieldPct: pw.summary.stats.yieldPercent,
    }))
    .filter(w => w.yieldPct !== null) as Array<{ waferIndex: number; label: string; yieldPct: number }>;

  if (!waferData.length) return null;

  const minY = Math.min(...waferData.map(w => w.yieldPct));
  const maxY = Math.max(...waferData.map(w => w.yieldPct));
  const rangeNote = minY === maxY ? '' : ` (${minY.toFixed(1)}–${maxY.toFixed(1)}%)`;

  const med = medianOfSorted([...waferData.map(w => w.yieldPct)].sort((a, b) => a - b));

  const wrap = el('div');
  wrap.appendChild(sectionTitle('Wafer Yield' + rangeNote));
  for (const { waferIndex, label, yieldPct } of waferData) {
    const row = progressRow(label, yieldPct, undefined, undefined, med, yieldPct < med);
    if (onWaferClick) {
      row.style.cursor = 'pointer';
      row.style.borderRadius = '4px';
      row.style.padding = '2px 3px';
      row.style.marginLeft = '-3px';
      row.style.marginRight = '-3px';
      row.setAttribute('role', 'button');
      row.setAttribute('aria-label', `${label}, ${yieldPct.toFixed(1)}% yield — view wafer`);
      row.tabIndex = 0;
      row.addEventListener('mouseenter', () => { row.style.background = CLR.bgHover; });
      row.addEventListener('mouseleave', () => { row.style.background = ''; });
      row.addEventListener('focus', () => { row.style.background = CLR.bgHover; });
      row.addEventListener('blur',  () => { row.style.background = ''; });
      row.addEventListener('click', () => onWaferClick(waferIndex));
      row.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onWaferClick(waferIndex); }
      });
    }
    wrap.appendChild(row);
  }
  return wrap;
}

/** Full descriptive-stats row used by the Test Values table. */
interface TestStatRow {
  testNumber: number;
  min: number;
  max: number;
  mean: number;
  count: number;
  stddev: number;
  median: number;
  q1: number;
  q3: number;
}

function computeDescriptive(vals: number[]): Omit<TestStatRow, 'testNumber'> {
  const sorted = [...vals].sort((a, b) => a - b);
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
  const variance = vals.reduce((a, v) => a + (v - mean) ** 2, 0) / vals.length;
  return {
    min: sorted[0], max: sorted[sorted.length - 1], mean, count: vals.length,
    stddev: Math.sqrt(variance),
    median: quantile(sorted, 0.5), q1: quantile(sorted, 0.25), q3: quantile(sorted, 0.75),
  };
}

/**
 * Identity context stamped onto a per-test CSV export, so a file that has
 * left the app still says which wafer(s) it describes. Die-level metadata is
 * deliberately absent from these two exports: a row here aggregates over many
 * dies, so no single die-level value exists, and printing one would be a
 * false claim about the data.
 */
export interface CsvExportContext {
  /** Single-wafer export: one constant leading column per field. */
  waferMetadata?: WaferMetadata;
  /**
   * Pooled (lot) export: only fields identical across every wafer are
   * emitted, via `commonMetadata` — so a mixed-lot pool prints no false
   * "Lot" column.
   */
  perWaferMetadata?: WaferMetadata[];
  /** Plain-language population size, e.g. "12 wafers pooled". Appended to the
   *  section title and emitted as a `Population` CSV column. */
  populationLabel?: string;
}

/** Resolve `CsvExportContext` into leading identity columns for a per-test
 *  CSV — wafer-scoped only, `dies: []` so no die column is ever produced.
 *  `reservedLabels` are the export's own column names (Test, Unit, N, …). */
function resolveCsvIdentityColumns(csv: CsvExportContext | undefined, reservedLabels: string[]): MetadataColumn[] {
  if (!csv) return [];
  const waferMetadata = csv.waferMetadata
    ?? (csv.perWaferMetadata ? commonMetadata(csv.perWaferMetadata.map(m => ({ metadata: m }))) : undefined);
  if (!waferMetadata || !Object.keys(waferMetadata).length) return [];
  return resolveMetadataColumns({
    waferMetadata, waferPlacement: 'csv', reservedLabels,
  }).columns;
}

/** CSV field escaper — exported so `dieList.ts` shares it rather than a second copy. */
export function csvField(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function buildTestSection(
  dies: Die[],
  testDefs: TestDef[] | undefined,
  fallbackFormat?: 'si' | 'engineering',
  /**
   * When supplied, each test's descriptive stats and spec-yield are read from
   * `.perTestStats`/`.testSpecYield` (already computed once by
   * `analyzeWaferMap`, or pooled across a lot by `buildLotTestSection`)
   * instead of re-scanning `dies`. A test falls back to a raw-die scan when
   * it's missing from `perTestStats` entirely, or when `stddev`/`median`/
   * `q1`/`q3` weren't included (e.g. lot pooling, which can reconstruct
   * min/max/mean/count exactly across wafers but not quantiles — see
   * `buildLotTestSection`'s doc comment). Structurally a subset of
   * `StatsSummary['stats']`, so a real `StatsSummary` can be passed directly.
   */
  precomputedTestStats?: {
    perTestStats?: Array<{
      testNumber: number; min: number; max: number; mean: number; count: number;
      stddev?: number; median?: number; q1?: number; q3?: number;
    }>;
    testSpecYield?: Array<{ testNumber: number; totalDies: number; yieldPercent: number | null }>;
  },
  /** Optional host hook for the "Export CSV" button — see `saveTextFile` (toolbar.ts). */
  onSaveText?: SaveTextHandler,
  /** Wafer identity to stamp on the CSV export. See {@link CsvExportContext}. */
  csv?: CsvExportContext,
): HTMLDivElement | null {
  const activeDies = dies.filter(d => !d.partial && !d.edgeExcluded);
  const perTestStatsByNumber = new Map((precomputedTestStats?.perTestStats ?? []).map(s => [s.testNumber, s]));
  const specYieldByNumber = new Map((precomputedTestStats?.testSpecYield ?? []).map(s => [s.testNumber, s]));

  // Build a unified list of { testNumber, name, unit } from testDefs when present,
  // or from the testNumber keys found in die.testValues when absent.
  type TestEntry = { testNumber: number; name: string; unit?: string; limitLow?: number; limitHigh?: number };
  let entries: TestEntry[];

  if (testDefs?.length) {
    // Functional (pass/fail) tests are excluded — every column in this table
    // (mean/σ/median/quartiles) is a parametric statistic.
    entries = testDefs
      .filter(isParametricTest)
      .map(def => ({ testNumber: def.testNumber, name: def.name, unit: def.unit, limitLow: def.limitLow, limitHigh: def.limitHigh }));
  } else {
    const testNumbers = getUniqueTestNumbers(activeDies);
    entries = testNumbers.map(tn => ({ testNumber: tn, name: `Test ${tn}` }));
  }

  if (!entries.length) return null;

  const entriesWithData = entries.filter(e =>
    activeDies.some(d => {
      const v = d.testValues?.[e.testNumber];
      return v !== undefined && isFinite(v);
    })
  );
  if (!entriesWithData.length) return null;

  const hasAnyLimit = entriesWithData.some(e => e.limitLow !== undefined || e.limitHigh !== undefined);

  // One resolved row per test — computed once, shared by both the on-screen
  // table and the CSV export so the two can never drift apart.
  type ResolvedRow = {
    entry: TestEntry;
    stats: TestStatRow;
    specYieldPct: number | null;
    specN: number;
  };
  const rows: ResolvedRow[] = [];

  for (const entry of entriesWithData) {
    const precomputed = perTestStatsByNumber.get(entry.testNumber);
    const hasFullPrecomputed = precomputed
      && precomputed.stddev !== undefined && precomputed.median !== undefined
      && precomputed.q1 !== undefined && precomputed.q3 !== undefined;

    let stats: TestStatRow;
    if (hasFullPrecomputed) {
      const p = precomputed!;
      stats = {
        testNumber: entry.testNumber, min: p.min, max: p.max, mean: p.mean, count: p.count,
        stddev: p.stddev!, median: p.median!, q1: p.q1!, q3: p.q3!,
      };
    } else {
      const vals = activeDies
        .map(d => d.testValues?.[entry.testNumber])
        .filter((v): v is number => v !== undefined && isFinite(v));
      if (!vals.length) continue;
      stats = { testNumber: entry.testNumber, ...computeDescriptive(vals) };
    }

    let specYieldPct: number | null = null;
    let specN = 0;
    if (entry.limitLow !== undefined || entry.limitHigh !== undefined) {
      const specYieldEntry = specYieldByNumber.get(entry.testNumber);
      if (specYieldEntry) {
        ({ yieldPercent: specYieldPct, totalDies: specN } = specYieldEntry);
      } else {
        const vals = activeDies
          .map(d => d.testValues?.[entry.testNumber])
          .filter((v): v is number => v !== undefined && isFinite(v));
        const specFail = vals.filter(v =>
          (entry.limitLow !== undefined && v < entry.limitLow) ||
          (entry.limitHigh !== undefined && v > entry.limitHigh),
        ).length;
        specN = vals.length;
        specYieldPct = vals.length > 0 ? ((vals.length - specFail) / vals.length) * 100 : null;
      }
    }

    rows.push({ entry, stats, specYieldPct, specN });
  }
  if (!rows.length) return null;

  const outer = el('div');

  const headerRow = el('div', { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' });
  const title = sectionTitle(
    csv?.populationLabel ? `Test Values  (${rows.length}) — ${csv.populationLabel}` : `Test Values  (${rows.length})`,
  );
  title.style.marginBottom = '0';
  headerRow.appendChild(title);

  const exportBtn = document.createElement('button');
  exportBtn.type = 'button';
  exportBtn.textContent = 'Export CSV';
  Object.assign(exportBtn.style, {
    background:   'none',
    border:       BORDER,
    borderRadius: '4px',
    cursor:       'pointer',
    fontSize:     '10px',
    color:        CLR.iconHover,
    padding:      '2px 7px',
  } as Partial<CSSStyleDeclaration>);
  exportBtn.addEventListener('click', () => {
    // wmap's own unitless "engineering" notation (fmt's fallbackFormat:
    // 'engineering' — fixed decimal in [0.1, 9999], otherwise E±N in
    // multiples of 3) — not raw floats, which print with misleading
    // trailing-digit precision the underlying measurement never actually
    // had (e.g. `0.001151199649817308`). Units are per-test (see the "Unit"
    // column) rather than baked into each value, so every value column uses
    // one consistent notation regardless of the test's own unit/magnitude.
    const cols = ['Test', 'Unit', 'N', 'Min', 'Q1', 'Median', 'Mean', 'Q3', 'Max', 'StdDev'];
    if (hasAnyLimit) cols.push('LSL', 'USL', 'Spec Yield %', 'Spec Yield N');
    const idCols = resolveCsvIdentityColumns(csv, cols);
    const allCols = [...idCols.map(c => c.label), ...cols];
    const lines = [allCols.map(csvField).join(',')];
    const f = (n: number) => fmtValue(n, undefined, 'engineering');
    for (const { entry, stats, specYieldPct, specN } of rows) {
      const fields = [
        ...idCols.map(c => c.constant ?? ''),
        entry.name, entry.unit ?? '', String(stats.count), f(stats.min), f(stats.q1), f(stats.median),
        f(stats.mean), f(stats.q3), f(stats.max), f(stats.stddev),
      ];
      if (hasAnyLimit) {
        fields.push(
          entry.limitLow !== undefined ? f(entry.limitLow) : '',
          entry.limitHigh !== undefined ? f(entry.limitHigh) : '',
          specYieldPct !== null ? specYieldPct.toFixed(1) : '',
          (entry.limitLow !== undefined || entry.limitHigh !== undefined) ? String(specN) : '',
        );
      }
      lines.push(fields.map(csvField).join(','));
    }
    saveTextFile(lines.join('\n'), 'test-values.csv', 'text/csv', onSaveText);
  });
  headerRow.appendChild(exportBtn);
  outer.appendChild(headerRow);

  const table = el('table', {
    width:         '100%',
    borderCollapse: 'collapse',
    fontSize:      '11px',
  });
  const thead = document.createElement('thead');
  const headRow = document.createElement('tr');
  const headers = ['Test', 'N', 'Min', 'Q1', 'Median', 'Mean', 'Q3', 'Max', 'StdDev'];
  if (hasAnyLimit) headers.push('LSL', 'USL', 'Spec yield');
  for (const h of headers) {
    const th = el('th', {
      textAlign:    h === 'Test' ? 'left' : 'right',
      fontWeight:   '700',
      fontSize:     '10px',
      letterSpacing: '0.03em',
      textTransform: 'uppercase',
      color:        LABEL_COLOR,
      padding:      '3px 8px 5px',
      borderBottom: `1px solid ${CLR.menuBorder}`,
      whiteSpace:   'nowrap',
    }, h);
    headRow.appendChild(th);
  }
  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');

  for (const { entry, stats, specYieldPct, specN } of rows) {
    const f = (n: number) => fmtValue(n, entry.unit, fallbackFormat);

    const row = document.createElement('tr');
    const cell = (text: string, align: 'left' | 'right' = 'right') => {
      const td = el('td', {
        textAlign:   align,
        padding:     '4px 8px',
        borderBottom: `1px solid ${CLR.menuBorder}`,
        color:       VALUE_COLOR,
        whiteSpace:  'nowrap',
      }, text);
      row.appendChild(td);
    };
    cell(entry.name, 'left');
    cell(`${stats.count}`);
    cell(f(stats.min));
    cell(f(stats.q1));
    cell(f(stats.median));
    cell(f(stats.mean));
    cell(f(stats.q3));
    cell(f(stats.max));
    cell(f(stats.stddev));

    if (hasAnyLimit) {
      cell(entry.limitLow !== undefined ? f(entry.limitLow) : '—');
      cell(entry.limitHigh !== undefined ? f(entry.limitHigh) : '—');
      cell(specYieldPct !== null ? `${specYieldPct.toFixed(1)}% (N=${specN})` : '—');
    }

    tbody.appendChild(row);
  }
  table.appendChild(tbody);

  const scroll = el('div', { overflowX: 'auto' });
  scroll.appendChild(table);
  outer.appendChild(scroll);
  return outer;
}

/**
 * "Functional Tests" section — one row per functional (`testType: 'F'`) test
 * with pass/fail counts and pass rate. The functional counterpart of
 * `buildTestSection`, which shows parametric statistics functional tests are
 * excluded from. Shared by the Summary panel, the Insights Overview tab, and
 * the pooled lot variant (`buildLotFunctionalSection`).
 *
 * `precomputed` takes `StatsSummary.stats.functionalYield` (already computed
 * by `analyzeWaferMap`, or pooled by `buildLotFunctionalSection`); without it
 * the rows are computed from `dies` via `computeFunctionalYield`, so both
 * paths share one computation.
 */
export function buildFunctionalTestSection(
  dies: Die[],
  testDefs: TestDef[] | undefined,
  precomputed?: NonNullable<StatsSummary['stats']['functionalYield']>,
  /** Optional host hook for the "Export CSV" button — see `saveTextFile` (toolbar.ts). */
  onSaveText?: SaveTextHandler,
  /** Wafer identity to stamp on the CSV export. See {@link CsvExportContext}. */
  csv?: CsvExportContext,
): HTMLDivElement | null {
  const rows = precomputed ?? computeFunctionalYield(dies, testDefs);
  if (!rows?.length) return null;

  const outer = el('div');

  const headerRow = el('div', { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' });
  const title = sectionTitle(
    csv?.populationLabel ? `Functional Tests  (${rows.length}) — ${csv.populationLabel}` : `Functional Tests  (${rows.length})`,
  );
  title.style.marginBottom = '0';
  headerRow.appendChild(title);

  const exportBtn = document.createElement('button');
  exportBtn.type = 'button';
  exportBtn.textContent = 'Export CSV';
  Object.assign(exportBtn.style, {
    background:   'none',
    border:       BORDER,
    borderRadius: '4px',
    cursor:       'pointer',
    fontSize:     '10px',
    color:        CLR.iconHover,
    padding:      '2px 7px',
  } as Partial<CSSStyleDeclaration>);
  exportBtn.addEventListener('click', () => {
    const cols = ['Test', 'N', 'Pass', 'Fail', 'Pass Rate %'];
    const idCols = resolveCsvIdentityColumns(csv, cols);
    const lines = [[...idCols.map(c => c.label), ...cols].map(csvField).join(',')];
    for (const r of rows) {
      lines.push([
        ...idCols.map(c => c.constant ?? ''),
        r.label, String(r.totalDies), String(r.passDies), String(r.failDies),
        r.passRatePercent !== null ? r.passRatePercent.toFixed(1) : '',
      ].map(csvField).join(','));
    }
    saveTextFile(lines.join('\n'), 'functional-tests.csv', 'text/csv', onSaveText);
  });
  headerRow.appendChild(exportBtn);
  outer.appendChild(headerRow);

  const table = el('table', {
    width:          '100%',
    borderCollapse: 'collapse',
    fontSize:       '11px',
  });
  const thead = document.createElement('thead');
  const headRow = document.createElement('tr');
  for (const h of ['Test', 'N', 'Pass', 'Fail', 'Pass rate']) {
    headRow.appendChild(el('th', {
      textAlign:     h === 'Test' ? 'left' : 'right',
      fontWeight:    '700',
      fontSize:      '10px',
      letterSpacing: '0.03em',
      textTransform: 'uppercase',
      color:         LABEL_COLOR,
      padding:       '3px 8px 5px',
      borderBottom:  `1px solid ${CLR.menuBorder}`,
      whiteSpace:    'nowrap',
    }, h));
  }
  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  for (const r of rows) {
    const row = document.createElement('tr');
    const cell = (text: string, align: 'left' | 'right' = 'right') => {
      row.appendChild(el('td', {
        textAlign:    align,
        padding:      '4px 8px',
        borderBottom: `1px solid ${CLR.menuBorder}`,
        color:        VALUE_COLOR,
        whiteSpace:   'nowrap',
      }, text));
    };
    cell(r.label, 'left');
    cell(String(r.totalDies));
    cell(String(r.passDies));
    cell(String(r.failDies));
    cell(r.passRatePercent !== null ? `${r.passRatePercent.toFixed(1)}% (N=${r.totalDies})` : '—');
    tbody.appendChild(row);
  }
  table.appendChild(tbody);

  const scroll = el('div', { overflowX: 'auto' });
  scroll.appendChild(table);
  outer.appendChild(scroll);
  return outer;
}

/**
 * Lot-pooled "Functional Tests" section: when every wafer's
 * `StatsSummary.stats.functionalYield` is available, sums pass/fail/total
 * counts across wafers (exact — counts pool losslessly, unlike quantiles);
 * otherwise recomputes from the pooled dies.
 */
export function buildLotFunctionalSection(
  allDies: Die[],
  testDefs: TestDef[] | undefined,
  perWaferSummaries?: StatsSummary[],
  onSaveText?: SaveTextHandler,
): HTMLDivElement | null {
  const csv: CsvExportContext | undefined = perWaferSummaries?.length ? {
    perWaferMetadata: perWaferSummaries.map(s => s.wafer ?? {}),
    populationLabel: `${perWaferSummaries.length} wafer${perWaferSummaries.length === 1 ? '' : 's'} pooled`,
  } : undefined;
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
    const pooled = [...byTest.entries()].map(([testNumber, acc]) => ({
      testNumber,
      ...acc,
      passRatePercent: acc.totalDies > 0 ? (acc.passDies / acc.totalDies) * 100 : null,
    }));
    if (pooled.length) return buildFunctionalTestSection(allDies, testDefs, pooled, onSaveText, csv);
  }
  return buildFunctionalTestSection(allDies, testDefs, undefined, onSaveText, csv);
}

// ── Findings display vocabulary ──────────────────────────────────────────────
// Severity is encoded exactly once per element: a small dot on group headers,
// a thin left border on rows. Coloured all-caps headings on top of both made
// an ordinary findings list read like an incident page.

const severityRank: Record<StatsFinding['severity'], number> = { unusual: 0, notable: 1, info: 2 };
function sevDot(s: StatsFinding['severity']): HTMLSpanElement {
  return el('span', {
    display: 'inline-block', width: '7px', height: '7px', borderRadius: '50%',
    background: sevColor(s), flexShrink: '0',
  });
}


/** Row text for a finding shown under a group header that already names the
 *  region/wafer: drop the redundant leading context the header carries
 *  ("Ring 4 (edge) has HBin 2 …" × 6 rows was a wall of near-identical
 *  prose), map bin terms to plain language, and re-capitalize. */
function findingRowText(finding: StatsFinding, groupLeft?: string): string {
  let text = finding.summary;
  if (groupLeft) {
    if (text.startsWith(`${groupLeft} has `)) text = text.slice(groupLeft.length + 5);
    else if (text.startsWith(`${groupLeft} `)) text = text.slice(groupLeft.length + 1);
  }
  text = plainBinTerms(text);
  return text.length ? text[0].toUpperCase() + text.slice(1) : text;
}

export function buildFindingsSection(
  findings: StatsFinding[],
  statsSummary: StatsSummary | LotStatsSummary,
  onFindingClick: (finding: StatsFinding, row: HTMLButtonElement) => void,
  activeFindingId: string | null,
  /**
   * When true, skips the collapsible "Findings" header/badge and renders
   * content directly — used by `buildFindingsSectionWithFilter`, which
   * builds its own collapsible wrapper (header + filter row) around this.
   * Default false (collapsible-section behavior, used when this is one
   * section among several, e.g. inside the Insights Overview tab's legacy
   * embedding).
   */
  standalone = false,
): HTMLDivElement | null {
  if (!findings.length) return null;

  const hasNotable = findings.some(f => f.severity === 'unusual' || f.severity === 'notable');
  const badge = hasNotable
    ? findings.filter(f => f.severity !== 'info').length.toString()
    : undefined;

  const { outer, content } = standalone
    ? (() => { const wrap = el('div'); return { outer: wrap, content: wrap }; })()
    : collapsibleSection(`Findings (${findings.length})`, hasNotable, badge);

  function worstSeverity(fs: StatsFinding[]): StatsFinding['severity'] {
    return fs.reduce<StatsFinding['severity']>(
      (best, f) => severityRank[f.severity] < severityRank[best] ? f.severity : best,
      'info',
    );
  }
  function buildGroups(fs: StatsFinding[]) {
    const groupMap = new Map<string, StatsFinding[]>();
    for (const f of fs) {
      const key = `${f.comparison.family}\0${f.comparison.left}`;
      const bucket = groupMap.get(key) ?? [];
      bucket.push(f);
      groupMap.set(key, bucket);
    }
    const result = [...groupMap.entries()].map(([key, members]) => {
      const sorted = [...members].sort((a, b) => severityRank[a.severity] - severityRank[b.severity]);
      return { key, findings: sorted, worst: worstSeverity(sorted) };
    });
    result.sort((a, b) => severityRank[a.worst] - severityRank[b.worst]);
    return result;
  }
  function groupLabel(family: string, left: string): string {
    const familyMap: Record<string, string> = {
      ring: 'Ring', quadrant: 'Quadrant', sector: 'Sector',
      'reticle-position': 'Reticle', 'test-site': 'Test site',
      cluster: 'Cluster', 'edge-arc': 'Edge arc', wafer: 'Wafer',
    };
    const fam = familyMap[family] ?? family;
    // "Edge arc ~NNW" already names its own family — prefixing it again
    // produced headers like "Edge arc: Edge arc ~NNW".
    return left.toLowerCase().startsWith(fam.toLowerCase()) ? left : `${fam}: ${left}`;
  }

  // Separate spatial-pattern (parent) findings from the rest
  const patternFindings = findings.filter(f => f.comparison.family === 'spatial-pattern');
  // Hidden from this list if a spatial pattern claims it as supporting detail,
  // OR if another finding absorbed it as an exact restatement (a soft-bin twin
  // over the same dies; the single pass bin against the yield row that says the
  // same thing). Without the second, one edge failure reports itself up to three
  // times per region. Both sets are still in `summary.findings` for any host
  // reading them programmatically — only this list hides them.
  //
  // Deliberately NOT every finding's relatedIds: a run-merge records the
  // constituents it replaced there, and those are already gone.
  const relatedIdSet = new Set([
    ...patternFindings.flatMap(f => f.relatedIds ?? []),
    ...findings.flatMap(f => f.absorbedIds ?? []),
  ]);
  const standaloneFindings = findings.filter(
    f => f.comparison.family !== 'spatial-pattern' && !relatedIdSet.has(f.id),
  );
  const groups = buildGroups(standaloneFindings);

  // Helper: build a clickable finding row button. `groupLeft` is the group
  // header's own subject — passed so the row can drop that redundant prefix.
  function makeFindingRow(finding: StatsFinding, isChild = false, groupLeft?: string): HTMLButtonElement {
    const isActive = activeFindingId === finding.id;
    const row = document.createElement('button');
    row.type = 'button';
    row.dataset.wmapFinding = finding.id;
    row.textContent = findingRowText(finding, groupLeft);
    row.title = finding.summary;
    // isActive already drives the row's highlighted background/font-weight
    // visually; aria-current carries the same "this is the one currently
    // shown on the map" state to a screen reader, which colour/weight alone
    // doesn't reach. Rebuilt fresh with each render (same as the style props
    // above), so no separate sync path is needed when the selection changes.
    row.setAttribute('aria-current', isActive ? 'true' : 'false');
    Object.assign(row.style, {
      border:       `1px solid ${CLR.menuBorder}`,
      borderLeft:   `3px solid ${sevColor(finding.severity)}`,
      background:   isActive ? CLR.bgActive : CLR.menuBg,
      borderRadius: '6px',
      padding:      isChild ? '6px 10px' : '8px 10px',
      textAlign:    'left',
      fontSize:     isChild ? '10px' : '11px',
      fontWeight:   isActive ? '600' : '400',
      color:        CLR.iconHover,
      cursor:       'pointer',
      width:        '100%',
      marginBottom: '4px',
    });
    row.addEventListener('click', () => onFindingClick(finding, row));
    return row;
  }

  // Narrative block — elevated styling with a "Detail ▸" expand button
  const narrativeText = plainBinTerms(buildFindingsNarrative(findings) ?? '');
  if (narrativeText) {
    const narrativeBlock = el('div', {
      background:    CLR.bgActive,
      borderRadius:  '6px',
      padding:       '8px 10px',
      marginBottom:  '8px',
      display:       'flex',
      gap:           '8px',
      alignItems:    'flex-start',
    });

    const narrativeText2 = el('span', {
      flex:       '1',
      fontSize:   '12px',
      lineHeight: '1.5',
      color:      CLR.iconHover,
    }, narrativeText);
    narrativeBlock.appendChild(narrativeText2);

    const detailBtn = el('button', {
      flexShrink: '0',
      border:     'none',
      background: 'none',
      fontSize:   '10px',
      color:      CLR.icon,
      cursor:     'pointer',
      padding:    '0',
      lineHeight: '1.5',
      whiteSpace: 'nowrap',
    }, 'Detail ▸');
    (detailBtn as HTMLButtonElement).type = 'button';
    detailBtn.addEventListener('click', () => {
      const handle = openModal({ title: 'Findings Summary', onClose: () => {}, anchor: detailBtn });

      // Narrative paragraph
      const narPara = el('p', {
        fontSize:     '16px',
        lineHeight:   '1.6',
        color:        CLR.iconHover,
        padding:      '20px 24px 16px',
        margin:       '0',
        borderBottom: `1px solid ${CLR.menuBorder}`,
        flexShrink:   '0',
      }, narrativeText);
      handle.contentWrap.appendChild(narPara);

      // Scrollable findings list — pattern parents first, then standalone groups
      const listWrap = el('div', {
        overflowY: 'auto',
        padding:   '16px 24px',
        flex:      '1',
      });

      const modalGroupHeader = (severity: StatsFinding['severity'], text: string) => {
        const h = el('div', {
          display: 'flex', alignItems: 'center', gap: '7px',
          fontSize: '13px', fontWeight: '600', color: VALUE_COLOR,
          marginTop: '10px', marginBottom: '4px',
        });
        h.appendChild(sevDot(severity));
        h.appendChild(el('span', {}, text));
        return h;
      };

      for (const pf of patternFindings) {
        listWrap.appendChild(modalGroupHeader(pf.severity, pf.comparison.left));
        listWrap.appendChild(el('div', {
          fontSize:    '13px',
          color:       CLR.iconHover,
          padding:     '3px 0 3px 15px',
          marginBottom: '2px',
        }, plainBinTerms(pf.summary)));
        const children = findings.filter(f => pf.relatedIds?.includes(f.id));
        for (const cf of children) {
          listWrap.appendChild(el('div', {
            fontSize:    '12px',
            color:       CLR.icon,
            padding:     '2px 0 2px 23px',
            marginBottom: '2px',
          }, plainBinTerms(cf.summary)));
        }
      }

      for (const group of groups) {
        const [fam, left] = group.key.split('\0');
        listWrap.appendChild(modalGroupHeader(group.worst, groupLabel(fam, left)));
        for (const f of group.findings) {
          listWrap.appendChild(el('div', {
            fontSize:    '13px',
            color:       CLR.iconHover,
            padding:     '3px 0 3px 15px',
            marginBottom: '2px',
          }, findingRowText(f, left)));
        }
      }
      handle.contentWrap.appendChild(listWrap);
      Object.assign(handle.contentWrap.style, { flexDirection: 'column', overflow: 'hidden' });
    });

    narrativeBlock.appendChild(detailBtn);
    content.appendChild(narrativeBlock);
  }

  let firstItem = true;

  // Render spatial-pattern findings as collapsible parents
  for (const pf of patternFindings) {
    if (!firstItem) content.appendChild(el('div', { height: '1px', background: CLR.separator, margin: '4px 0' }));
    firstItem = false;

    const children = findings.filter(f => pf.relatedIds?.includes(f.id));
    const hasChildren = children.length > 0;

    // Parent row wrapper (flex row: clickable text area + chevron toggle)
    const parentWrap = el('div', { position: 'relative', marginBottom: hasChildren ? '2px' : '4px' });

    const isActive = activeFindingId === pf.id;
    const parentRow = document.createElement('button');
    parentRow.type = 'button';
    parentRow.dataset.wmapFinding = pf.id;
    Object.assign(parentRow.style, {
      border:       `1px solid ${CLR.menuBorder}`,
      borderLeft:   `3px solid ${sevColor(pf.severity)}`,
      background:   isActive ? CLR.bgActive : CLR.menuBg,
      borderRadius: '6px',
      padding:      '8px 32px 8px 10px', // right padding for chevron
      textAlign:    'left',
      fontSize:     '11px',
      fontWeight:   isActive ? '600' : '500',
      color:        CLR.iconHover,
      cursor:       'pointer',
      width:        '100%',
    });
    parentRow.textContent = plainBinTerms(pf.summary);
    parentRow.title = pf.summary;
    // See makeFindingRow's identical comment — isActive already drives the
    // visual highlight, this exposes the same state to a screen reader.
    parentRow.setAttribute('aria-current', isActive ? 'true' : 'false');
    parentRow.addEventListener('click', () => onFindingClick(pf, parentRow));
    parentWrap.appendChild(parentRow);

    if (hasChildren) {
      // Child container — initially collapsed
      const childWrap = el('div', {
        display:     'none',
        paddingLeft: '12px',
        marginBottom: '4px',
      });
      for (const cf of children) {
        childWrap.appendChild(makeFindingRow(cf, true));
      }
      parentWrap.appendChild(childWrap);

      // Chevron toggle button (absolutely positioned in top-right of parentRow)
      let expanded = false;
      const chevron = el('button', {
        position:   'absolute',
        top:        '50%',
        right:      '8px',
        transform:  'translateY(-50%)',
        border:     'none',
        background: 'none',
        fontSize:   '10px',
        color:      CLR.icon,
        cursor:     'pointer',
        padding:    '2px 4px',
        lineHeight: '1',
      }, '▸') as HTMLButtonElement;
      chevron.type = 'button';
      chevron.title = 'Show supporting findings';
      // The glyph alone (▸/▾) carries no name a screen reader will read, and
      // `title` is a hover-only hint a keyboard/AT user never sees —
      // aria-label is the one that actually reaches them, and aria-expanded
      // exposes the open/closed state `childWrap`'s visibility otherwise only
      // conveys visually.
      chevron.setAttribute('aria-label', 'Show supporting findings');
      chevron.setAttribute('aria-expanded', 'false');
      chevron.addEventListener('click', (e) => {
        e.stopPropagation();
        expanded = !expanded;
        childWrap.style.display = expanded ? 'block' : 'none';
        chevron.textContent = expanded ? '▾' : '▸';
        const label = expanded ? 'Hide supporting findings' : 'Show supporting findings';
        chevron.title = label;
        chevron.setAttribute('aria-label', label);
        chevron.setAttribute('aria-expanded', String(expanded));
      });
      parentWrap.appendChild(chevron);
    }

    content.appendChild(parentWrap);
  }

  // Render remaining standalone findings in existing flat-group style
  for (const group of groups) {
    if (!firstItem) content.appendChild(el('div', { height: '1px', background: CLR.separator, margin: '4px 0' }));
    firstItem = false;

    const [family, left] = group.key.split('\0');
    // Sentence-case neutral header; severity carried by the dot alone (the
    // rows below keep their thin left border as their own single encoding).
    const header = el('div', {
      display: 'flex', alignItems: 'center', gap: '6px',
      fontSize: '11px', fontWeight: '600', color: VALUE_COLOR,
      margin: '2px 0 4px',
    });
    header.appendChild(sevDot(group.worst));
    header.appendChild(el('span', {}, groupLabel(family, left)));
    content.appendChild(header);

    for (const finding of group.findings) {
      content.appendChild(makeFindingRow(finding, false, left));
    }
  }

  return outer;
}

// ── Findings filter row ───────────────────────────────────────────────────────

const FINDINGS_KIND_OPTIONS: Array<{ value: string; label: string }> = [
  { value: '',               label: 'All kinds' },
  { value: 'yield',          label: 'Yield' },
  { value: 'hardBin',        label: 'Hard bin' },
  { value: 'softBin',        label: 'Soft bin' },
  { value: 'test',           label: 'Test value' },
  { value: 'functionalTest', label: 'Functional test' },
  { value: 'spatialPattern', label: 'Spatial pattern' },
];

const FINDINGS_FAMILY_OPTIONS: Array<{ value: string; label: string }> = [
  { value: '',                label: 'All regions' },
  { value: 'ring',             label: 'Ring' },
  { value: 'quadrant',         label: 'Quadrant' },
  { value: 'reticle-position', label: 'Reticle position' },
  { value: 'test-site',        label: 'Test site' },
  { value: 'wafer',            label: 'Wafer' },
  { value: 'sector',           label: 'Sector' },
  { value: 'cluster',          label: 'Cluster' },
  { value: 'edge-arc',         label: 'Edge arc' },
  { value: 'spatial-pattern',  label: 'Spatial pattern' },
];

const FINDINGS_SEVERITIES: StatsSeverity[] = ['unusual', 'notable', 'info'];
const FINDINGS_SEVERITY_LABEL: Record<StatsSeverity, string> = { unusual: 'Unusual', notable: 'Notable', info: 'Info' };

/** Severity/kind/region filter controls, wired to `stats/filterFindings.ts`.
 *  Mutates `filter` in place and calls `onChange` after every control
 *  change — the caller re-renders the findings list below with the updated
 *  filter.
 *
 *  Severity is a row of toggle *chips* with counts ("Unusual 2"), all lit by
 *  default — the previous three unchecked checkboxes meant "no filter", which
 *  read as "nothing selected" while everything showed. A chip that is
 *  visibly on and shows how many findings it covers has no such ambiguity. */
function buildFindingsFilterRow(allFindings: StatsFinding[], filter: FindingsFilter, onChange: () => void): HTMLDivElement {
  const row = el('div', {
    display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '10px',
    marginBottom: '10px', paddingBottom: '10px', borderBottom: `1px solid ${CLR.separator}`,
  });

  const counts: Record<StatsSeverity, number> = { unusual: 0, notable: 0, info: 0 };
  for (const f of allFindings) counts[f.severity]++;
  const present = FINDINGS_SEVERITIES.filter(s => counts[s] > 0);

  // `filter.severity === undefined` means "no severity filter" — every chip lit.
  const enabled = new Set<StatsSeverity>(
    filter.severity === undefined ? present
      : Array.isArray(filter.severity) ? filter.severity : [filter.severity],
  );

  const severityWrap = el('div', { display: 'flex', gap: '4px', flexWrap: 'wrap' });
  for (const s of present) {
    const chip = document.createElement('button');
    chip.type = 'button';
    const paint = () => {
      const on = enabled.has(s);
      chip.setAttribute('aria-pressed', on ? 'true' : 'false');
      Object.assign(chip.style, {
        display: 'inline-flex', alignItems: 'center', gap: '5px',
        border: `1px solid ${CLR.menuBorder}`, borderRadius: '10px',
        background: on ? CLR.bgActive : 'none',
        opacity: on ? '1' : '0.5',
        color: CLR.text, fontSize: '11px', padding: '2px 8px', cursor: 'pointer',
      } as Partial<CSSStyleDeclaration>);
    };
    chip.appendChild(sevDot(s));
    chip.appendChild(el('span', {}, `${FINDINGS_SEVERITY_LABEL[s]} ${counts[s]}`));
    chip.title = enabled.has(s) ? 'Click to hide these findings' : 'Click to show these findings';
    paint();
    chip.addEventListener('click', () => {
      if (enabled.has(s)) enabled.delete(s); else enabled.add(s);
      filter.severity = enabled.size === present.length ? undefined : [...enabled];
      onChange();
    });
    severityWrap.appendChild(chip);
  }
  row.appendChild(severityWrap);

  row.appendChild(makeLabeledSelect('Kind:', FINDINGS_KIND_OPTIONS, (filter.kind as string) ?? '', (v) => {
    filter.kind = v ? (v as StatsVariableKind) : undefined;
    onChange();
  }, { maxWidth: '130px' }));

  row.appendChild(makeLabeledSelect('Region:', FINDINGS_FAMILY_OPTIONS, (filter.family as string) ?? '', (v) => {
    filter.family = v ? (v as StatsComparisonFamily) : undefined;
    onChange();
  }, { maxWidth: '150px' }));

  return row;
}

/**
 * Findings section with severity/kind/region filter controls — the
 * panel-level entry point (wraps `buildFindingsSection(..., standalone:
 * true)` in its own collapsible "Findings" header + filter row). Returns
 * `null` when the source has no findings at all (nothing to filter).
 */
export function buildFindingsSectionWithFilter(
  source: StatsSummary | LotStatsSummary,
  onFindingClick: (finding: StatsFinding, row: HTMLButtonElement) => void,
  activeFindingId: string | null,
  filter: FindingsFilter,
  onFilterChange: () => void,
): HTMLDivElement | null {
  if (!source.findings.length) return null;

  const hasNotable = source.findings.some(f => f.severity === 'unusual' || f.severity === 'notable');
  const badge = hasNotable
    ? source.findings.filter(f => f.severity !== 'info').length.toString()
    : undefined;

  const { outer, content } = collapsibleSection(`Findings (${source.findings.length})`, hasNotable, badge);
  content.appendChild(buildFindingsFilterRow(source.findings, filter, onFilterChange));

  const filtered = filterFindings(source, filter);
  if (!filtered.length) {
    content.appendChild(el('div', {
      color: LABEL_COLOR, fontSize: '11px', textAlign: 'center', padding: '16px 8px',
    }, 'No findings match the current filter.'));
    return outer;
  }

  const section = buildFindingsSection(filtered, source, onFindingClick, activeFindingId, true);
  if (section) content.appendChild(section);
  return outer;
}

// ── Lot-level section builders ────────────────────────────────────────────────

/**
 * Aggregate test value stats across all wafers in the lot. When every
 * wafer's `StatsSummary.stats.perTestStats`/`.testSpecYield` is available
 * (`perWaferSummaries`), pools mean (n-weighted)/min/max and sums spec
 * pass/fail counts directly from those instead of re-scanning `allDies` —
 * exact, since these are the same per-wafer aggregates `analyzeWaferMap`
 * already computed once each. (Quartiles/median aren't pooled this way —
 * they aren't reconstructable from per-wafer quartiles alone — but
 * `buildTestSection`'s display doesn't need them.)
 */
export function buildLotTestSection(
  allDies: Die[],
  testDefs: TestDef[] | undefined,
  fallbackFormat?: 'si' | 'engineering',
  perWaferSummaries?: StatsSummary[],
  /** Optional host hook for the "Export CSV" button — see `saveTextFile` (toolbar.ts). */
  onSaveText?: SaveTextHandler,
): HTMLDivElement | null {
  const csv: CsvExportContext | undefined = perWaferSummaries?.length ? {
    perWaferMetadata: perWaferSummaries.map(s => s.wafer ?? {}),
    populationLabel: `${perWaferSummaries.length} wafer${perWaferSummaries.length === 1 ? '' : 's'} pooled`,
  } : undefined;

  let pooled: {
    perTestStats?: Array<{ testNumber: number; min: number; max: number; mean: number; count: number }>;
    testSpecYield?: Array<{ testNumber: number; totalDies: number; yieldPercent: number | null }>;
  } | undefined;

  if (perWaferSummaries?.length && perWaferSummaries.every(s => s.stats.perTestStats !== undefined)) {
    const byTest = new Map<number, { n: number; sum: number; min: number; max: number }>();
    for (const s of perWaferSummaries) {
      for (const t of s.stats.perTestStats ?? []) {
        const acc = byTest.get(t.testNumber);
        if (!acc) {
          byTest.set(t.testNumber, { n: t.count, sum: t.mean * t.count, min: t.min, max: t.max });
        } else {
          acc.n += t.count;
          acc.sum += t.mean * t.count;
          acc.min = Math.min(acc.min, t.min);
          acc.max = Math.max(acc.max, t.max);
        }
      }
    }
    pooled = {
      perTestStats: [...byTest.entries()].map(([testNumber, acc]) => ({
        testNumber, count: acc.n, min: acc.min, max: acc.max, mean: acc.sum / acc.n,
      })),
    };
  }

  if (perWaferSummaries?.length && perWaferSummaries.every(s => s.stats.testSpecYield !== undefined)) {
    const byTest = new Map<number, { passDies: number; totalDies: number }>();
    for (const s of perWaferSummaries) {
      for (const t of s.stats.testSpecYield ?? []) {
        const acc = byTest.get(t.testNumber);
        if (!acc) byTest.set(t.testNumber, { passDies: t.passDies, totalDies: t.totalDies });
        else { acc.passDies += t.passDies; acc.totalDies += t.totalDies; }
      }
    }
    pooled = {
      ...pooled,
      testSpecYield: [...byTest.entries()].map(([testNumber, acc]) => ({
        testNumber, totalDies: acc.totalDies,
        yieldPercent: acc.totalDies > 0 ? (acc.passDies / acc.totalDies) * 100 : null,
      })),
    };
  }

  return buildTestSection(allDies, testDefs, fallbackFormat, pooled, onSaveText, csv);
}



// ── Panel container ───────────────────────────────────────────────────────────

export function createSummaryPanelEl(
  placement: 'right' | 'left' | 'top' | 'bottom',
  // Pass the render's own ownerDocument — this panel is the auto-mounted
  // Summary panel, reachable from a wafer detached into its own popup window
  // (buildDetachedController passes statsSummary through); without this the
  // panel root builds into the bare global document while everything else
  // in that render correctly follows the popup's own document.
  ownerDocument: Document = document,
): HTMLDivElement {
  const isVertical = placement === 'top' || placement === 'bottom';
  const panel = el('div', {
    background:  PANEL_BG,
    border:      BORDER,
    borderRadius:'6px',
    padding:     '12px',
    overflowY:   isVertical ? 'hidden' : 'auto',
    overflowX:   isVertical ? 'auto'   : 'hidden',
    flexShrink:  '0',
    boxSizing:   'border-box',
    fontFamily:  'system-ui, sans-serif',
    fontSize:    '12px',
    boxShadow:   '0 1px 4px rgba(0,0,0,0.08)',
  }, undefined, ownerDocument);

  if (!isVertical) {
    // 260px, up from 220 — at 220 the findings narrative wrapped every two
    // or three words and stat-tile labels broke mid-parenthetical.
    panel.style.width    = '260px';
    // Bound the panel by its container (the flex row), not the viewport. A
    // viewport-relative cap (e.g. 100vh) overflows a container shorter than the
    // viewport, stretching the row and clipping the wafer. With the wrapper
    // pinned to the container height, `100%` keeps the panel inside it and lets
    // overflowY:auto scroll the panel internally.
    panel.style.maxHeight = '100%';
  } else {
    panel.style.height = '180px';
    panel.style.width  = '100%';
  }

  return panel;
}

/** Wrap the canvas + panel in a flex container according to placement. */
export function wrapWithSummaryPanel(
  content: HTMLElement,
  panel: HTMLDivElement,
  placement: 'right' | 'left' | 'top' | 'bottom',
): HTMLDivElement {
  const isVertical = placement === 'top' || placement === 'bottom';
  const wrapper = el('div', {
    display:       'flex',
    flexDirection: isVertical ? 'column' : 'row',
    gap:           '8px',
    width:         '100%',
    // Fill the container's height so the whole subtree is bounded by it. The
    // container (a plain block in the common embedding) gives no height to a
    // `flex:1` child, so the row would otherwise size to its tallest child (the
    // panel) and overflow — dragging the canvas past the container and clipping
    // the wafer. `height:100%` + a min-height floor pins it to the container.
    height:        '100%',
    flex:          '1 1 0',
    minHeight:     '0',
    boxSizing:     'border-box',
    // Stretch children to the row height (horizontal layout) so the canvas and
    // panel both track the container, not their own content.
    alignItems:    isVertical ? 'flex-start' : 'stretch',
  });

  // Content takes all remaining space
  content.style.flex     = '1 1 0';
  content.style.minWidth = '0';
  content.style.minHeight = '0';

  if (placement === 'right' || placement === 'bottom') {
    wrapper.appendChild(content);
    wrapper.appendChild(panel);
  } else {
    wrapper.appendChild(panel);
    wrapper.appendChild(content);
  }

  return wrapper;
}

function panelHeader(text: string): HTMLDivElement {
  return el('div', {
    fontSize:      '13px',
    fontWeight:    '700',
    color:         VALUE_COLOR,
    marginBottom:  '10px',
  }, text);
}

function reportButton(label: string, onClick: () => void): HTMLButtonElement {
  const btn = el('button', {
    background:   'none',
    border:       BORDER,
    borderRadius: '4px',
    cursor:       'pointer',
    fontSize:     '10px',
    color:        CLR.iconHover,
    padding:      '2px 7px',
  }, label);
  btn.type = 'button';
  btn.addEventListener('click', onClick);
  return btn;
}

/**
 * Lays one or more `reportButton`s ("Summary report", "View die list") on a
 * single row, wrapping if the panel is too narrow, rather than each claiming
 * its own line — these are small, related actions, not a list. Returns
 * `null` for an empty/all-`null` input so a caller can conditionally append
 * without an extra `if`.
 */
function reportButtonRow(...buttons: Array<HTMLButtonElement | null>): HTMLDivElement | null {
  const present = buttons.filter((b): b is HTMLButtonElement => !!b);
  if (!present.length) return null;
  const row = el('div', { display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '10px' });
  for (const b of present) row.appendChild(b);
  return row;
}

/**
 * Opens the raw die-data table (`buildDieListSection`) in wmap's own modal —
 * the summary panel's "View die list" link, single-wafer and lot alike. No
 * dedicated toolbar button: reached only from an already-open summary panel,
 * the same way "Summary report" opens the HTML report without one either.
 * The modal's own chrome title stays generic; the section's own header
 * carries the specific die/wafer counts and the Export CSV button.
 */
function openDieListModal(
  anchor: Element,
  dies: Die[],
  testDefs: TestDef[] | undefined,
  sectionTitle: string,
  waferMetadata: WaferMetadata | undefined,
  metadataFields: MetadataFieldDef[] | undefined,
  dieListOptions: DieListDisplayOptions | undefined,
  onSaveText: SaveTextHandler | undefined,
  extraColumn?: { label: string; get: (d: Die) => string | undefined },
): void {
  // `anchor` (a live element from this render, e.g. the panel itself) is
  // required, not optional — without it `openOverlay` builds the modal onto
  // bare `doc.body`, which sits BEHIND a host's own native <dialog> (shown
  // via .showModal(), promoted to the browser's top layer) regardless of
  // z-index. Every other openModal call site in this codebase passes one
  // (see "Findings Summary" above, and renderWaferGallery.ts's detach
  // window); this one originally didn't, and reopened exactly that
  // already-solved bug for any host embedding wmap inside its own modal.
  // ownerDocument passed explicitly for the same reason renderWaferMap.ts's
  // expand modal does: `anchor` may live in a gallery card's own detached
  // popup window, and without this the modal (and buildDieListSection's
  // injected styles) build into the bare global `document` — the OPENER's
  // page — while the modal box itself still visually lands inside the popup
  // via `openModal`'s own anchor-based root resolution. The table then has
  // no matching `.wmap-dielist-table` rule in the popup's own <head> and
  // falls back to the browser's default (larger) table font.
  const ownerDocument = anchor.ownerDocument;
  const handle = openModal({ title: 'Die list', onClose: () => {}, anchor, ownerDocument });
  // openOverlay's contentWrap carries no padding of its own (by design —
  // other buildDieListSection callers sit inside a parent that already pads,
  // e.g. renderWaferMap.ts's mapless panel), so this modal is the one place
  // that must add it, or the heading and table sit flush against the box edge.
  handle.contentWrap.style.padding = '14px 16px';
  const section = buildDieListSection(dies, testDefs, {
    ...dieListOptions,
    title: sectionTitle,
    onSaveText,
    waferMetadata,
    metadataFields,
    extraColumn,
    ownerDocument,
  });
  if (section) handle.contentWrap.appendChild(section);
}

/** Render all wafer-level sections into a panel element. Clears existing content. */
export function renderWaferSummaryContent(
  panel: HTMLDivElement,
  params: {
    wafer:        Wafer;
    dies:         Die[];
    yieldSummary?: YieldSummary;
    dataCoverage?: { filledDies: number; totalDies: number; edgeExcludedDies: number; ratio: number };
    hbinDefs?:    BinDef[];
    sbinDefs?:    BinDef[];
    testDefs?:    TestDef[];
    statsSummary?: StatsSummary;
    /**
     * Warnings to show above the panel. Collected by the renderer via
     * `collectWarnings` so this banner, the toolbar indicator and `onWarning`
     * all show the same set. Falls back to the summary's own analysis warnings
     * when omitted, which is the only set a bare panel could know about.
     */
    warnings?: WaferWarning[];
    passBins?:    number[];
    ringCount?:   number;
    colorScheme?: string;
    fallbackFormat?: 'si' | 'engineering';
    onFindingClick?: (finding: StatsFinding, row: HTMLButtonElement) => void;
    activeFindingId?: string | null;
    findingsFilter?: FindingsFilter;
    onFindingsFilterChange?: () => void;
    onSaveText?: SaveTextHandler;
    /** Label/order hints for die metadata columns, e.g. `WaferMapResult.metadataFields`. */
    metadataFields?: MetadataFieldDef[];
    /** See `RenderOptions.dieList` — gates the "View die list" link below. */
    dieListOptions?: DieListDisplayOptions;
  },
): void {
  const savedScroll = panel.scrollTop;
  panel.innerHTML = '';
  const {
    wafer, dies, yieldSummary, dataCoverage,
    hbinDefs, sbinDefs, testDefs,
    statsSummary, passBins = [1], ringCount = 4,
    colorScheme, fallbackFormat,
    onFindingClick, activeFindingId = null,
    findingsFilter, onFindingsFilterChange,
    onSaveText, metadataFields, dieListOptions,
  } = params;

  panel.appendChild(panelHeader('Wafer Summary'));

  const warnings = params.warnings ?? collectWarnings({ statsSummary });
  if (warnings.length) panel.appendChild(buildWarningsBanner(warnings, panel.ownerDocument));

  const summaryReportBtn = (yieldSummary && dataCoverage)
    ? reportButton('Summary report', () => {
        openHtmlReport(renderSummaryReportHtml({
          wafer, dies, yieldSummary, dataCoverage,
          hbinDefs, sbinDefs, testDefs,
          statsSummary,
          passBins,
          ringCount,
        }));
      })
    : null;

  const dieListBtn = ((dieListOptions?.enabled ?? true) && dies.length)
    ? reportButton('View die list', () => {
        openDieListModal(
          panel, dies, testDefs, `Die list — ${dies.length} dies`,
          wafer.metadata, metadataFields, dieListOptions, onSaveText,
        );
      })
    : null;

  const reportRow = reportButtonRow(summaryReportBtn, dieListBtn);
  if (reportRow) panel.appendChild(reportRow);

  const sections: (HTMLDivElement | null)[] = [];

  const lotStackStats = statsSummary?.stats.isLotStack ? statsSummary.stats : undefined;
  const stacked = lotStackStats?.lotSize !== undefined
    ? { lotSize: lotStackStats.lotSize, aggrMethod: fmtAggregationMethod(lotStackStats.aggregationMethod) }
    : undefined;
  sections.push(buildMetadataInfoSection([{ metadata: wafer.metadata ?? undefined }], stacked));

  if (yieldSummary && dataCoverage) sections.push(buildYieldSection(yieldSummary, dataCoverage, passBins));

  // Use hard bin mode as the primary bin display; fall back to soft if only soft present
  const hasHbin = dies.some(d => d.hbin != null);
  const hasSbin = dies.some(d => d.sbin != null);
  if (hasHbin) sections.push(buildBinSection(dies, hbinDefs, 'hard', colorScheme, statsSummary?.stats.hardBinCounts));
  else if (hasSbin) sections.push(buildBinSection(dies, sbinDefs, 'soft', colorScheme, statsSummary?.stats.softBinCounts));

  sections.push(buildRingSection(dies, wafer, ringCount, passBins));
  sections.push(buildQuadrantSection(dies, wafer, ringCount, passBins));

  const csvIdentity: CsvExportContext | undefined = wafer.metadata ? { waferMetadata: wafer.metadata } : undefined;
  sections.push(buildTestSection(dies, testDefs, fallbackFormat, statsSummary?.stats, onSaveText, csvIdentity));
  sections.push(buildFunctionalTestSection(dies, testDefs, statsSummary?.stats.functionalYield, onSaveText, csvIdentity));

  if (statsSummary && onFindingClick && findingsFilter && onFindingsFilterChange) {
    sections.push(buildFindingsSectionWithFilter(
      statsSummary, onFindingClick, activeFindingId, findingsFilter, onFindingsFilterChange,
    ));
  }

  let first = true;
  for (const s of sections) {
    if (!s) continue;
    if (!first) panel.appendChild(separator());
    first = false;
    panel.appendChild(s);
  }

  // Browsers ignore padding-bottom on scrollable containers. A bottom spacer
  // ensures the last finding card is not clipped when scrolled to the end.
  panel.appendChild(el('div', { height: '12px', flexShrink: '0' }));

  panel.scrollTop = savedScroll;
}

/** Render lot-level content into the panel. Clears existing content. */
export function renderLotSummaryContent(
  panel: HTMLDivElement,
  params: {
    lotSummary:       LotStatsSummary;
    items:            Array<{ label?: string; wafer?: Wafer; dies?: Die[]; statsSummary?: StatsSummary; metadataFields?: MetadataFieldDef[] } | null>;
    hbinDefs?:        BinDef[];
    sbinDefs?:        BinDef[];
    testDefs?:        TestDef[];
    passBins?:        number[];
    ringCount?:       number;
    colorScheme?:     string;
    fallbackFormat?:  'si' | 'engineering';
    onFindingClick?:  (finding: StatsFinding, row: HTMLButtonElement) => void;
    activeFindingId?: string | null;
    onWaferClick?:    (waferIndex: number) => void;
    findingsFilter?: FindingsFilter;
    onFindingsFilterChange?: () => void;
    onSaveText?: SaveTextHandler;
    /** See the wafer panel's `warnings` — collected by the renderer so every surface agrees. */
    warnings?: WaferWarning[];
    /** See `RenderOptions.dieList` — gates the "View die list" link below. */
    dieListOptions?: DieListDisplayOptions;
  },
): void {
  const savedScroll = panel.scrollTop;
  panel.innerHTML = '';
  const {
    lotSummary, items,
    hbinDefs, sbinDefs, testDefs,
    passBins = [1], ringCount = 4,
    colorScheme, fallbackFormat,
    onFindingClick, activeFindingId = null,
    onWaferClick,
    findingsFilter, onFindingsFilterChange,
    onSaveText, dieListOptions,
  } = params;

  panel.appendChild(panelHeader(`Lot Summary — ${lotSummary.stats.waferCount} wafer${lotSummary.stats.waferCount === 1 ? '' : 's'}`));

  // collectWarnings de-duplicates on code+message: the same geometry advisory
  // legitimately fires on many wafers of a lot, and listing it once per wafer
  // would bury the one that differs.
  const allWarnings = params.warnings ?? collectWarnings({ lotStatsSummary: lotSummary });
  if (allWarnings.length) panel.appendChild(buildWarningsBanner(allWarnings, panel.ownerDocument));

  // Not appended yet — sits in the same row as "View die list" below, once
  // the dies that button needs have been pooled.
  const summaryReportBtn = reportButton('Summary report', () => {
    // No `lotSummary` here — grouping, per-group analysis, and rendering
    // all happen inside renderLotSummaryReportHtml now (see its own doc
    // comment). The on-screen panel above still uses the pooled `lotSummary`
    // param for its own display, which is a separate, unaffected concern.
    openHtmlReport(renderLotSummaryReportHtml({
      items: items.map((item, i) => ({
        label:        item?.label ?? `W${i + 1}`,
        wafer:        item?.wafer,
        dies:         item?.dies,
        statsSummary: item?.statsSummary,
      })),
      hbinDefs, sbinDefs, testDefs,
      passBins,
      ringCount,
    }));
  });

  const allWafers: Wafer[] = [];
  const diesByWafer: Die[][] = [];
  const allDies: Die[] = [];
  // Per-die wafer attribution for the lot-wide die list below — the one
  // thing only this lot-pooled context can supply, since a single die
  // carries no wafer identity of its own.
  const waferLabelByDie = new WeakMap<Die, string>();
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (!item) { diesByWafer.push([]); continue; }
    if (item.wafer) allWafers.push(item.wafer);
    const wd = item.dies ?? [];
    const label = item.label ?? `W${i + 1}`;
    for (const d of wd) waferLabelByDie.set(d, label);
    diesByWafer.push(wd);
    allDies.push(...wd);
  }

  const dieListBtn = (dieListOptions?.enabled ?? true)
    ? reportButton('View die list', () => {
        if (!allDies.length) return;
        openDieListModal(
          panel, allDies, testDefs,
          `Die list — ${allDies.length} dies across ${items.length} wafer${items.length === 1 ? '' : 's'}`,
          commonMetadata(items.filter((it): it is NonNullable<typeof it> => !!it).map(it => ({ metadata: it.wafer?.metadata }))),
          items.find(it => it?.metadataFields?.length)?.metadataFields,
          dieListOptions, onSaveText,
          { label: 'Wafer', get: (d) => waferLabelByDie.get(d) },
        );
      })
    : null;

  const reportRow = reportButtonRow(summaryReportBtn, dieListBtn);
  if (reportRow) panel.appendChild(reportRow);


  const hasHbin = allDies.some(d => d.hbin != null);
  const hasSbin = allDies.some(d => d.sbin != null);
  const perWaferSummaries = items.map(i => i?.statsSummary).filter((s): s is StatsSummary => !!s);

  const sections: (HTMLDivElement | null)[] = [
    buildLotOverviewSection(lotSummary),
    // No buildMetadataInfoSection here, unlike the single-wafer summary panel
    // (below, line ~1979) which is its OWN sole source for this. On the lot
    // path the gallery's top strip (renderWaferGallery.ts's legendEl, built
    // from the identical buildMetadataStripRow/items pair) already renders
    // this exact facet table above the grid — confirmed byte-identical
    // against a live 13-wafer lot, not assumed. A second copy here cost a
    // third of the sidebar's width for zero new information.
    buildPerWaferYieldSection(lotSummary, items, onWaferClick),
    hasHbin ? buildLotBinSection(allDies, hbinDefs, 'hard', colorScheme)
            : hasSbin ? buildLotBinSection(allDies, sbinDefs, 'soft', colorScheme) : null,
    buildLotRingSection(diesByWafer, allWafers, ringCount, passBins),
    buildLotQuadrantSection(diesByWafer, allWafers, ringCount, passBins),
    testDefs?.length ? buildLotTestSection(allDies, testDefs, fallbackFormat, perWaferSummaries, onSaveText) : null,
    testDefs?.length ? buildLotFunctionalSection(allDies, testDefs, perWaferSummaries, onSaveText) : null,
  ];

  if (onFindingClick && findingsFilter && onFindingsFilterChange) {
    sections.push(buildFindingsSectionWithFilter(
      lotSummary, onFindingClick, activeFindingId, findingsFilter, onFindingsFilterChange,
    ));
  }

  let first = true;
  for (const s of sections) {
    if (!s) continue;
    if (!first) panel.appendChild(separator());
    first = false;
    panel.appendChild(s);
  }

  panel.appendChild(el('div', { height: '12px', flexShrink: '0' }));

  panel.scrollTop = savedScroll;
}

