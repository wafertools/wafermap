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
import type { Die } from '../core/dies.js';
import { waferDisplayLabel } from '../core/waferLabel.js';
import { itemPassBins, passBinsLabel } from '../core/passBins.js';
import { isParametricTest, type BinDef, type TestDef, type YieldSummary, type MetadataFieldDef } from '../renderer/buildWaferMap.js';
import { testLabel, markedTestLabel, unmarkedLabel, derivedFields, derivedKeyText, derivedCsvCell, isDerivedTest, DERIVED_CSV_HEADER } from '../renderer/testLabel.js';
import type { StatsFinding, StatsSummary, LotStatsSummary, StatsSeverity, StatsVariableKind, StatsComparisonFamily } from '../stats/types.js';
import { buildRingRegions, buildQuadrantRegions, buildRegionYieldData } from '../stats/regions.js';
import { computeFunctionalYield } from '../stats/analyzeWaferMap.js';
import { renderWaferReportHtml, renderLotReportHtml, type ReportMap } from '../stats/renderSummaryReport.js';
import { buildFindingsNarrative } from '../stats/findingsNarrative.js';
import { formatFindingTooltip } from '../stats/reportHtml.js';
import { filterFindings, type FindingsFilter } from '../stats/filterFindings.js';
import { buildFacetTable, prettyKey, type FacetItem } from '../stats/facets.js';
import { commonMetadata } from '../stats/facets.js';
import { resolveMetadataColumns, type MetadataColumn } from '../stats/metadataColumns.js';
import { resolveBinColors, resolveBinColorsByWafer, type BinColors } from '../renderer/binColors.js';
import { NO_DATA_FILL } from '../renderer/colorMap.js';
import { describeWaferPopulation, populationLabel } from '../stats/population.js';
import { buildWarningsBanner, collectWarnings, type WaferWarning } from './warnings.js';
export { buildWarningsBanner };
import { fmt as fmtValue, fmtAggregationMethod, plainBinTerms } from '../renderer/fmt.js';
import type { PlotMode } from '../renderer/buildView.js';
import { getUniqueTestNumbers } from '../renderer/buildView.js';
import { describeSorted, quantile } from '../stats/math.js';
import { pooledTestStatsSteps, type CapabilityItem } from '../stats/capability.js';
import { sortBinsForDisplay } from '../stats/binPareto.js';
import { poolFunctionalYield } from '../stats/testPassRate.js';
import { makeLabeledSelect, makeSegmented } from './charts/chartShell.js';
import { SHADOW, MOTION, LEADING, TRACKING, wireControlHover, controlStyle, SPACE, RADIUS, FONT, CLR, sevColor, openModal, openReportModal, saveTextFile, wireTooltip, type SaveTextHandler } from './toolbar.js';
import { buildDieListSection, type DieListDisplayOptions } from './dieList.js';
// Re-exported from its original home so existing importers keep working; the
// implementation now lives in core/utils.ts (see its comment).
export { csvField } from '../core/utils.js';
import { type Chunked, csvField, drain, maxOf, medianOfSorted, minOf } from '../core/utils.js';
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
    letterSpacing: TRACKING,
    textTransform: 'uppercase',
    color:         LABEL_COLOR,
    marginBottom: SPACE.sm,
  }, label);
  return d;
}

/**
 * Per-panel UI state that must survive a re-render. Both `renderWaferSummaryContent`
 * and `renderLotSummaryContent` start with `panel.innerHTML = ''`, so anything held
 * only in the DOM (which section is collapsed, which bin type the bin section is
 * showing) is destroyed on every stats/plot-mode update. Keyed on the panel element
 * so a detached window's panel keeps its own state, and weakly so a torn-down panel
 * doesn't leak.
 */
interface PanelUiState {
  /** Section keys the user has explicitly collapsed. */
  collapsed: Set<string>;
  /** Bin-section override. `undefined` = follow the map's plot mode. */
  binMode?: 'hard' | 'soft';
  regionMode: 'ring' | 'quadrant';
  waferSort: 'slot' | 'yield';
}

const PANEL_UI = new WeakMap<HTMLElement, PanelUiState>();

/**
 * Sections that start collapsed.
 *
 * Every section used to open expanded, which put seven of them in a 300px
 * column and pushed the ones people actually act on — findings, and the bin
 * breakdown that explains the colours on screen — below the fold behind two
 * dense tables. Collapsing the three reference sections lifts the rest without
 * REORDERING anything, which matters: the alternative considered was ordering
 * sections by plot mode, and having sections move between renders is
 * disorienting in a way a shorter panel is not.
 *
 * The three chosen are the ones read deliberately rather than scanned: regional
 * yield answers a question you have to already be asking, and the two test
 * tables are reference data that also exist in the CSV export, the summary
 * report and the Insights panels. What stays open is the population headline,
 * findings, per-wafer yield (a lot's own headline) and the bin breakdown.
 *
 * This is screen space, not work: content is still built and hidden with
 * `display: none`, so a collapsed section costs the same to render. Deferring
 * the build too would be a separate change — not every section goes through
 * `opts.render`, so there is no single place to hang it.
 */
const DEFAULT_COLLAPSED_SECTIONS = ['regionYield', 'testValues', 'functionalTests'] as const;

function panelUiState(panel: HTMLElement | undefined): PanelUiState {
  // No panel element means no persistence — the caller gets a throwaway state,
  // so seed it the same way or a detached render would disagree with a docked
  // one about what starts open.
  if (!panel) return { collapsed: new Set(DEFAULT_COLLAPSED_SECTIONS), regionMode: 'ring', waferSort: 'slot' };
  let s = PANEL_UI.get(panel);
  if (!s) {
    // Seeded once per panel element. Because the set records what is COLLAPSED,
    // seeding it is all "default collapsed" needs — and a user who opens one of
    // these removes it from the set, so their choice sticks across re-renders
    // exactly like a user-collapsed section already did, in both directions.
    s = { collapsed: new Set(DEFAULT_COLLAPSED_SECTIONS), regionMode: 'ring', waferSort: 'slot' };
    PANEL_UI.set(panel, s);
  }
  return s;
}

/** Collapsible section wrapper. Returns the outer container and the content div.
 *
 *  `opts.control` is a header-right slot for a section-scoped selector (the bin
 *  section's hard/soft, region's ring/quadrant, wafer yield's sort order). It is
 *  handed a `rerender` callback that rebuilds just this section's content, so a
 *  selector never needs a whole-panel re-render — which matters because the panel
 *  render functions are driven by the host's data, not by panel-local UI state.
 *
 *  `opts.stateKey` + `opts.panel` persist the collapsed flag across the
 *  `innerHTML = ''` that begins every re-render. */
function collapsibleSection(
  label: string,
  defaultOpen = true,
  badge?: string,
  opts?: {
    stateKey?: string;
    panel?: HTMLElement;
    control?: (rerender: () => void) => HTMLElement | null;
    /** Fills the content div. Required when `control` is used, so the control can rebuild it. */
    render?: (content: HTMLElement) => void;
  },
): { outer: HTMLDivElement; content: HTMLDivElement } {
  const outer = el('div');
  const ui = panelUiState(opts?.panel);
  if (opts?.stateKey && opts.panel) {
    defaultOpen = !ui.collapsed.has(opts.stateKey);
  }

  const toggle = document.createElement('button');
  toggle.type = 'button';
  Object.assign(toggle.style, {
    display:        'flex',
    alignItems:     'center',
    gap: SPACE.xs,
    width:          '100%',
    background:     'none',
    border:         'none',
    cursor:         'pointer',
    padding:        '0 0 6px',
    textAlign:      'left',
  });

  const arrow = el('span', {
    fontSize:    FONT.meta,   // ornament exemption (UI_STANDARDS.md type scale)
    color:       LABEL_COLOR,
    transition:  `transform ${MOTION.base}`,
    transform:   defaultOpen ? 'rotate(90deg)' : 'rotate(0deg)',
    display:     'inline-block',
    lineHeight:  LEADING.none,
    marginRight: '1px',
  }, '▶');

  const titleEl = el('span', {
    fontSize:      TITLE_SIZE,
    fontWeight:    '700',
    letterSpacing: TRACKING,
    textTransform: 'uppercase',
    color:         LABEL_COLOR,
    flex:          '1',
  }, label);

  // A section header is clickable, so it must react to being pointed at —
  // it had `cursor: pointer` and no hover of any kind. 'bare' keeps its
  // transparent resting background and only lifts it on hover.
  wireControlHover(toggle, 'bare');
  toggle.setAttribute('aria-expanded', defaultOpen ? 'true' : 'false');
  toggle.appendChild(arrow);
  toggle.appendChild(titleEl);

  if (badge) {
    const badgeEl = el('span', {
      fontSize:     FONT.meta,   // ornament exemption (UI_STANDARDS.md type scale)
      fontWeight:   '700',
      background:   CLR.warnBg,
      color:        CLR.warnText,
      borderRadius: RADIUS.pill,
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
    if (opts?.stateKey && opts.panel) {
      if (open) ui.collapsed.delete(opts.stateKey);
      else ui.collapsed.add(opts.stateKey);
    }
  });

  // The control cannot live inside `toggle` — it is a <button>, and neither a
  // nested button nor a radio input is operable (or valid) inside one. Header
  // becomes a flex row: the toggle button takes the space, the control sits
  // beside it and swallows its own clicks so picking an option doesn't also
  // collapse the section.
  if (opts?.control) {
    const header = el('div', { display: 'flex', alignItems: 'center', gap: SPACE.sm });
    toggle.style.width = 'auto';
    toggle.style.flex  = '1';
    header.appendChild(toggle);
    const rerender = () => {
      content.innerHTML = '';
      opts.render?.(content);
    };
    const controlEl = opts.control(rerender);
    if (controlEl) {
      controlEl.style.marginBottom = '6px';
      controlEl.addEventListener('click', e => e.stopPropagation());
      header.appendChild(controlEl);
    }
    outer.appendChild(header);
  } else {
    outer.appendChild(toggle);
  }

  outer.appendChild(content);
  opts?.render?.(content);
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
 *
 *  Deliberately has NO colour-coded "below median" variant. It used to mute the
 *  fill for any wafer under the lot median, which (a) was a colour-only encoding
 *  with nothing on screen explaining it — WCAG 1.4.1, and the panel's own rule
 *  that every displayed element must be unambiguous — and (b) split a tight lot
 *  into two colours at an arbitrary midpoint, implying a difference that isn't
 *  there. Outliers are called out in the row's own label text instead (see
 *  `buildPerWaferYieldSection`), which survives greyscale, and the median is
 *  shown as a marker that is actually visible against the fill. */
function progressRow(
  label: string,
  value: number,
  color = CLR.barFill,
  fillPct?: number,
  medianLinePct?: number,
): HTMLDivElement {
  const row = el('div', { marginBottom: '5px' });

  const top = el('div', {
    display:        'flex',
    justifyContent: 'space-between',
    fontSize:       FONT.body,
    color:          VALUE_COLOR,
    marginBottom: SPACE.xxs,
  });
  // Muted label against a strong figure: at 12px, giving both the full value
  // colour made every row read as emphasised, so a column of bars became a wall
  // of bold. The number is the thing being compared; the label just names it.
  const lbl = el('span', { color: LABEL_COLOR }, label);
  const pct = el('span', { fontWeight: '600' }, `${value.toFixed(1)}%`);
  top.appendChild(lbl);
  top.appendChild(pct);

  const barWidth  = fillPct !== undefined ? fillPct : Math.min(100, Math.max(0, value));
  const fillColor = color;
  const track = el('div', {
    position:     'relative',
    height:       '9px',
    background:   CLR.bgActive,
    borderRadius: RADIUS.control,
    overflow:     'hidden',
  });
  const fill = el('div', {
    height:       '100%',
    width:        `${barWidth}%`,
    background:   fillColor,
    borderRadius: RADIUS.control,
    transition:   `width ${MOTION.base}`,
  });
  track.appendChild(fill);
  if (medianLinePct !== undefined) {
    // 2px of `CLR.value` at 0.8, not 1px of `CLR.infoText` at 0.5: the marker
    // sits ON the fill for every above-median row, and a faint mid-tone hairline
    // on saturated `barFill` was invisible in practice — the muted "below median"
    // fill was the only thing left hinting the median existed, and it said so
    // without a key. This reads against both the fill and the empty track.
    const line = el('div', {
      position:   'absolute',
      top:        '0',
      bottom:     '0',
      left:       `${medianLinePct}%`,
      width:      '2px',
      marginLeft: '-1px',
      background: CLR.value,
      opacity:    '0.8',
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
/** Row of `statCard`s. Drops the divider after the last one — a rule belongs
 *  between items, and a trailing one reads as an unfinished row. Call
 *  `finish()` once every card has been appended. */
function statCardRow(): HTMLDivElement & { finish(): void } {
  const row = el('div', { display: 'flex', gap: SPACE.sm, marginBottom: SPACE.md }) as HTMLDivElement & { finish(): void };
  row.finish = () => {
    const last = row.lastElementChild as HTMLElement | null;
    if (last) Object.assign(last.style, { borderRight: 'none', paddingRight: '0' });
  };
  return row;
}

function statCard(value: string, label: string, sublabel?: string): HTMLDivElement {
  // A readout, not a boxed card — matching the Insights population line. These
  // were bordered boxes on a surface that already has its own border and
  // background, so each one drew a second frame inside a frame and paid for it
  // in vertical space, in the narrowest column in the app. The rule between
  // them does the separating; `statCardRow` removes the trailing one.
  const card = el('div', {
    padding: `${SPACE.xxs} ${SPACE.md} ${SPACE.xxs} 0`,
    borderRight: BORDER,
    textAlign:   'center',
    flex:        '1',
  });
  const v = el('div', {
    // Heading tier, matching the Insights population line. The same readout
    // rendered at two sizes in two places is the drift this work exists to stop.
    fontSize:   FONT.heading,
    fontWeight: '700',
    color:      VALUE_COLOR,
    lineHeight: LEADING.tight,
  }, value);
  const lbl = el('div', {
    fontSize:   FONT.body,
    color:      LABEL_COLOR,
    marginTop: SPACE.xxs,
  }, label);
  card.appendChild(v);
  card.appendChild(lbl);
  if (sublabel) {
    card.appendChild(el('div', {
      fontSize: FONT.body,
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
    fontSize:       FONT.body,
    gap: SPACE.md,
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
    fontSize:     FONT.body,
    gap: SPACE.sm,
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
/**
 * Fields worth reading at a glance, in the order an engineer scans them:
 * which lot, which device, which program, which split arm. Everything else a
 * load carries — tester provenance (node, tester type, job rev) and the raw
 * WCR geometry fields (wafer size, die dimensions, units, flat, centre and
 * axis directions) — is reference material, not identity, and pushed behind
 * the disclosure. A strip that lists all sixteen is not a summary.
 *
 * Matching is on the normalised key, so `testProgram`/`test_program`/`TEST
 * PROGRAM` all resolve to the same field.
 */
const STRIP_PRIMARY_FIELDS = ['lot', 'product', 'testprogram', 'split'];

const stripFieldRank = (key: string): number => {
  const i = STRIP_PRIMARY_FIELDS.indexOf(key.toLowerCase().replace(/[^a-z]/g, ''));
  return i === -1 ? Number.MAX_SAFE_INTEGER : i;
};

export function buildFacetSummaryChips(
  table: Array<{ key: string; values: Array<{ value: string }> }>,
  maxValuesPerField = 3,
): HTMLDivElement | null {
  if (!table.length) return null;

  const row = el('div', {
    // No `fontSize`: it INHERITS from whatever mounts the strip, so the host
    // decides the tier. It used to pin `FONT.body` here, two levels below the
    // caller, which silently overrode the size the mounting surface had set —
    // raising the gallery's identity strip appeared to do nothing at all until
    // this was found. There is one caller (`buildMetadataStripRow`), so the
    // size has no business being decided here.
    display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: `${SPACE.xs} ${SPACE.lg}`,
  });
  // Primary fields first, in the order above; everything else keeps its
  // existing relative order behind them.
  const ordered = [...table].sort((a, b) => stripFieldRank(a.key) - stripFieldRank(b.key));
  const primary = ordered.filter(f => stripFieldRank(f.key) !== Number.MAX_SAFE_INTEGER);
  const secondary = ordered.filter(f => stripFieldRank(f.key) === Number.MAX_SAFE_INTEGER);

  const makeChip = (field: { key: string; values: Array<{ value: string }> }) => {
    const chip = el('span', { whiteSpace: 'nowrap' });
    const label = el('span', { color: LABEL_COLOR }, `${prettyKey(field.key)}: `);
    chip.appendChild(label);
    const shown = field.values.slice(0, maxValuesPerField);
    const remaining = field.values.length - shown.length;
    let text = shown.map(v => v.value).join(', ');
    if (remaining > 0) text += ` +${remaining} more`;
    chip.appendChild(document.createTextNode(text));
    return chip;
  };

  for (const field of primary) row.appendChild(makeChip(field));

  if (secondary.length) {
    // The rest stay in the DOM, hidden — so the strip stays one line by default
    // and nothing is lost. A disclosure, not a truncation.
    const rest = el('span', { display: 'none', flexWrap: 'wrap', alignItems: 'baseline', gap: `${SPACE.xs} ${SPACE.lg}` });
    for (const field of secondary) rest.appendChild(makeChip(field));

    const toggle = el('button', {
      background: 'none', border: 'none', padding: '0', cursor: 'pointer',
      color: CLR.iconActive, fontSize: FONT.body, whiteSpace: 'nowrap',
    }) as HTMLButtonElement;
    toggle.type = 'button';
    wireControlHover(toggle, 'bare');
    const sync = (open: boolean) => {
      rest.style.display = open ? 'contents' : 'none';
      toggle.textContent = open ? 'less' : `+${secondary.length} more`;
      toggle.setAttribute('aria-expanded', String(open));
    };
    sync(false);
    toggle.addEventListener('click', () => sync(toggle.getAttribute('aria-expanded') !== 'true'));
    row.appendChild(rest);
    row.appendChild(toggle);
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
  gap: SPACE.sm,
  background:    CLR.menuBg,
  border:        `1px solid ${CLR.menuBorder}`,
  borderRadius:  RADIUS.container,
  padding: `${SPACE.sm} ${SPACE.lg}`,
  boxShadow:     SHADOW.panel,
  fontSize:      FONT.body,
  lineHeight:    LEADING.none,
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

  const cards = statCardRow();
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
    const binLabel = passBinsLabel([passBins]);
    cards.appendChild(statCard(`${yieldSummary.yieldPercent.toFixed(1)}%`, 'Yield', `pass: ${binLabel}`));
  }
  cards.finish();
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
  /**
   * The map's resolved bin colours (`View.binColors`) — colours AND pass
   * verdicts, so bars match die fills and pass rows sit where the map's legend
   * puts them. Omitted ⇒ resolved here from `dies` — never a second rule.
   */
  binColors?: BinColors,
  /**
   * Precomputed counts (e.g. `StatsSummary.stats.hardBinCounts`/`.softBinCounts`,
   * already scoped to the yield-eligible population) — used directly instead
   * of re-walking `dies` when supplied.
   */
  precomputedCounts?: Record<number, number>,
  /** Used only to resolve colours and verdicts when `binColors` is omitted. */
  passBins?: readonly number[],
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

  // The map's own resolution when given; otherwise the same resolver the map
  // uses, so a caller with no map beside it still gets one rule for both.
  const resolved = binColors ?? resolveBinColors(dies, {
    passBins, ...(mode === 'hard' ? { hbinDefs: binDefs } : { sbinDefs: binDefs }) });
  const wrap = el('div');
  wrap.appendChild(sectionTitle(binSectionTitle(mode, [...binCounts.values()].reduce((a, b) => a + b, 0))));
  for (const row of binRows(binCounts, binDefs, resolved[mode], resolved.pass[mode])) wrap.appendChild(row);
  return wrap;
}

/** Section title carrying the population, so the percentages below are never a
 *  bare number an engineer has to guess the denominator for — these are % of
 *  *dies*, distinct from the lot panel's "Mean wafer yield" (an unweighted mean
 *  of per-wafer yields). The two legitimately differ on a lot with uneven die
 *  counts, and previously both rendered as an unqualified percentage. */
function binSectionTitle(mode: 'hard' | 'soft', total: number): string {
  return `${mode === 'hard' ? 'Hard' : 'Soft'} Bin Breakdown — % of dies (N=${total})`;
}

/** Bin bars in the shared display order — see `sortBinsForDisplay` (stats/binPareto.ts),
 *  which the summary report's two bin tables use too. */
function binRows(
  binCounts: Map<number, number>,
  binDefs: BinDef[] | undefined,
  colors: ReadonlyMap<number, string>,
  /** Bins of THIS type that pass — `BinColors.pass.hard`/`.soft`, never `passBins` for soft bins. */
  passing: Iterable<number>,
): HTMLDivElement[] {
  const total  = [...binCounts.values()].reduce((a, b) => a + b, 0);
  const defMap = binDefs ? new Map(binDefs.map(d => [d.bin, d])) : null;
  const sorted = sortBinsForDisplay(binCounts.entries(), passing);

  return sorted.map(([bin, count]) => {
    const def   = defMap?.get(bin);
    const label = def?.name ? `Bin ${bin} · ${def.name}` : `Bin ${bin}`;
    const pct   = (count / total) * 100;
    const color = colors.get(bin) ?? NO_DATA_FILL;
    return progressRow(`${label}  (${count})`, pct, color);
  });
}

/**
 * The panels' bin section: identical bars to `buildBinSection`, wrapped in a
 * collapsible shell with a Hard/Soft selector.
 *
 * Which bin type it opens on is derived from the map's own plot mode, not from
 * which bin data happens to exist. The old rule (`hasHbin ? 'hard' : 'soft'`) meant
 * a soft-bin map always sat beside a hard-bin breakdown whenever both bin types
 * were present — the panel silently describing a different population from the one
 * on screen. `maplessSummary.ts` already derived this correctly from `plotMode`;
 * this makes all three call sites agree.
 *
 * The selector only appears when both bin types actually have data — a one-option
 * toggle is noise.
 */
export function buildBinBreakdownSection(params: {
  dies: Die[];
  hbinDefs?: BinDef[];
  sbinDefs?: BinDef[];
  /** The map's resolved bin colours (`View.binColors`). Omitted ⇒ resolved from `dies`. */
  binColors?: BinColors;
  hardCounts?: Record<number, number>;
  softCounts?: Record<number, number>;
  /** The map's active plot mode. `hardBin`/`softBin` pick the matching bin type. */
  plotMode?: PlotMode;
  passBins?: number[];
  panel?: HTMLElement;
}): HTMLDivElement | null {
  const { dies, hbinDefs, sbinDefs, hardCounts, softCounts, plotMode, passBins = [1], panel } = params;
  const binColors = params.binColors ?? resolveBinColors(dies, { passBins, hbinDefs, sbinDefs });

  const countsFor = (mode: 'hard' | 'soft'): Map<number, number> => {
    const pre = mode === 'hard' ? hardCounts : softCounts;
    const m = new Map<number, number>();
    if (pre) {
      for (const [binStr, count] of Object.entries(pre)) m.set(Number(binStr), count);
      return m;
    }
    for (const d of dies) {
      if (d.partial || d.edgeExcluded) continue;
      const b = mode === 'hard' ? d.hbin : d.sbin;
      if (b != null) m.set(b, (m.get(b) ?? 0) + 1);
    }
    return m;
  };

  const hardMap = countsFor('hard');
  const softMap = countsFor('soft');
  const hasHard = hardMap.size > 0;
  const hasSoft = softMap.size > 0;
  if (!hasHard && !hasSoft) return null;

  const ui = panelUiState(panel);
  // Precedence: an explicit user override, then the plot mode, then whichever
  // bin type has data at all.
  const fromPlotMode = plotMode === 'softBin' || plotMode === 'stackedSoftBins' ? 'soft'
                     : plotMode === 'hardBin' || plotMode === 'stackedBins'     ? 'hard'
                     : undefined;
  let mode: 'hard' | 'soft' = ui.binMode ?? fromPlotMode ?? (hasHard ? 'hard' : 'soft');
  if (mode === 'hard' && !hasHard) mode = 'soft';
  if (mode === 'soft' && !hasSoft) mode = 'hard';

  const counts  = mode === 'hard' ? hardMap : softMap;
  const binDefs = mode === 'hard' ? hbinDefs : sbinDefs;
  const total   = [...counts.values()].reduce((a, b) => a + b, 0);

  const { outer } = collapsibleSection(
    binSectionTitle(mode, total),
    true,
    undefined,
    {
      stateKey: 'bins',
      panel,
      render: content => {
        const colors = mode === 'hard' ? binColors.hard : binColors.soft;
        for (const row of binRows(counts, binDefs, colors, binColors.pass[mode])) content.appendChild(row);
      },
      control: (hasHard && hasSoft && panel)
        ? () => makeSegmented(
            [['hard', 'Hard'], ['soft', 'Soft']],
            mode,
            v => {
              ui.binMode = v as 'hard' | 'soft';
              // Rebuilds the whole section, not just its content: the title
              // carries the bin type and its own N, both of which change here.
              const replacement = buildBinBreakdownSection(params);
              if (replacement) outer.replaceWith(replacement);
            },
            panel.ownerDocument,
            true,
          )
        : undefined,
    },
  );
  return outer;
}

/** Aggregate bin counts across all wafers in the lot — no lot-pooled
 *  precomputed bin counts exist (`hardBinCounts`/`softBinCounts` are
 *  per-wafer only), so this scans the pooled `Die[]` directly, same as
 *  `buildBinSection` does when it has no `precomputedCounts`. */
export function buildLotBinSection(
  allDies: Die[],
  binDefs: BinDef[] | undefined,
  mode: 'hard' | 'soft',
  binColors?: BinColors,
): HTMLDivElement | null {
  return buildBinSection(allDies, binDefs, mode, binColors);
}

/**
 * Region yield as ONE section with a Ring/Quadrant selector, replacing the two
 * always-on stacked sections (`Ring Yield` + `Quadrant Yield`) this used to render.
 *
 * Ring is the default and quadrant is opt-in because they are not equally
 * informative. Ring yield tracks the edge roll-off that dominates real wafer maps
 * (85% core → 70% edge is routine, and is what the edge-local findings are about).
 * Quadrant yield averages over half the wafer twice and lands within a point or two
 * of the wafer mean on almost every lot — and in the case where a quadrant really
 * is asymmetric, the findings engine already reports it with a significance test
 * behind it, which four bare bars do not have. Between them they were consuming
 * eight rows of a 260px column to say one thing.
 *
 * Works uniformly for a single wafer (`diesByWafer: [dies]`, `allWafers: [wafer]`)
 * or a whole lot.
 */
export function buildRegionYieldPanelSection(params: {
  diesByWafer: Die[][];
  allWafers: Wafer[];
  ringCount: number;
  /** One set for every wafer, or a lookup by index into `allWafers` — see `buildRegionYieldData`. */
  passBins: readonly number[] | ((waferIndex: number) => readonly number[]);
  panel?: HTMLElement;
}): HTMLDivElement | null {
  const { diesByWafer, allWafers, ringCount, passBins, panel } = params;
  const ui = panelUiState(panel);

  const build = (family: 'ring' | 'quadrant') => buildRegionYieldData(
    diesByWafer, allWafers, ringCount, passBins,
    family === 'ring' ? buildRingRegions : buildQuadrantRegions,
  );

  // Nothing to show at all if neither family resolves (no positioned dies).
  if (!build('ring').length && !build('quadrant').length) return null;

  const family = ui.regionMode;
  const { outer } = collapsibleSection(
    family === 'ring' ? 'Ring Yield' : 'Quadrant Yield',
    true,
    undefined,
    {
      stateKey: 'regionYield',
      panel,
      render: content => {
        const data = build(family);
        if (!data.length) {
          content.appendChild(el('div', { fontSize: FONT.body, color: LABEL_COLOR }, 'No positioned dies for this breakdown.'));
          return;
        }
        for (const { label, n, yieldPercent } of data) {
          content.appendChild(progressRow(`${label} (N=${n})`, yieldPercent));
        }
      },
      control: panel
        ? () => makeSegmented(
            [['ring', 'Ring'], ['quadrant', 'Quadrant']],
            family,
            v => {
              ui.regionMode = v as 'ring' | 'quadrant';
              // Whole-section rebuild: the title names the family.
              const replacement = buildRegionYieldPanelSection(params);
              if (replacement) outer.replaceWith(replacement);
            },
            panel.ownerDocument,
            true,
          )
        : undefined,
    },
  );
  return outer;
}

/** Lot overview — wafer count and mean (unweighted arithmetic mean of each
 *  wafer's own yield%, not a die-weighted lot yield — see CLAUDE.md on
 *  correctly labelling aggregation methods) wafer yield. Metadata is a
 *  separate section (`buildMetadataInfoSection`) built from the lot's own
 *  items, not from `lotSummary.lot` — see that function's doc comment. */
export function buildLotOverviewSection(
  lotSummary: LotStatsSummary,
  /** Per-wafer summaries, for the analysed/excluded die tally below. */
  perWaferSummaries: StatsSummary[] = [],
): HTMLDivElement {
  const wrap = el('div');
  const population = describeWaferPopulation(lotSummary.perWafer.map(pw => pw.summary.wafer));
  wrap.appendChild(sectionTitle(population.lotId !== undefined ? 'Lot Summary' : 'Summary'));

  const cards = statCardRow();
  cards.appendChild(statCard(String(lotSummary.stats.waferCount), 'Wafers'));

  const waferYields = lotSummary.perWafer
    .map(pw => pw.summary.stats.yieldPercent)
    .filter((y): y is number => y !== null);

  if (waferYields.length) {
    const mean = waferYields.reduce((a, b) => a + b, 0) / waferYields.length;
    // Two different yield statistics live in this panel: this one weights every
    // WAFER equally; the bin breakdown below weights every DIE equally and says
    // so in its own title ("% of dies (N=…)"). They agree only when die counts
    // are even across the lot.
    //
    // The label carries the distinction rather than a sublabel: "unweighted,
    // per wafer" was a qualifier with nothing beside it to contrast against, so
    // on a normal lot it read as noise. "Mean per-wafer yield" says the same
    // thing in the name itself, and the die-weighted figure is already on
    // screen further down.
    //
    // NOT computed here: a die-weighted figure would need `yieldEligibleDieCount`
    // as its weight (see buildYieldDataCombined) — weighting by raw totalDies
    // lets a wafer's excluded dies skew it. This function only receives
    // StatsSummary, not dies, so it cannot do that correctly. The Insights
    // population line, which does have the dies, shows it there.
    cards.appendChild(statCard(`${mean.toFixed(1)}%`, 'Mean per-wafer yield'));
  }
  cards.finish();
  wrap.appendChild(cards);

  // The lot panel's population, which it previously never stated at all — it
  // showed a wafer count and a percentage over an unnamed set of dies. The rule
  // in CLAUDE.md is that an aggregated or filtered population must be identified.
  if (perWaferSummaries.length) {
    const analysed = perWaferSummaries.reduce((a, s) => a + s.stats.analyzedDies, 0);
    const excluded = perWaferSummaries.reduce((a, s) => a + s.stats.excludedDies, 0);
    if (analysed || excluded) {
      wrap.appendChild(kvRow(
        'Dies analysed',
        excluded ? `${analysed.toLocaleString()} (${excluded.toLocaleString()} excluded)` : analysed.toLocaleString(),
      ));
    }
  }

  return wrap;
}

/** Per-wafer yield bars, absolute 0–100% scale, with a visible median marker and
 *  low outliers named in the row label — lets an engineer spot outlier wafers
 *  within the lot at a glance.
 *
 *  "Outlier" is the Tukey rule (below `Q1 − 1.5 × IQR`), not "below the median".
 *  The median splits every lot in half by construction, so half the bars always
 *  got flagged — including on a lot where every wafer is within a point of every
 *  other. The Tukey fence flags nothing on a tight lot, which is the correct
 *  answer, and it is stated in text rather than encoded only in a colour.
 *
 *  Slot order is the default and must stay so: wafer-number order is what makes a
 *  slot-correlated pattern (a bad cassette position, a chuck issue) visible at all,
 *  and sorting by yield destroys it. Yield order is opt-in via the header control. */
export function buildPerWaferYieldSection(
  lotSummary: LotStatsSummary,
  items: Array<{ label?: string } | null>,
  onWaferClick?: (waferIndex: number) => void,
  /** Panel element owning the sort/collapse state. Omit for a stateless render (reports). */
  panel?: HTMLElement,
  /**
   * Per-wafer findings tally, badged onto each row.
   *
   * This is what let the gallery's separate "Findings" tab go away. That tab was
   * a second per-wafer list — a SUBSET (only wafers that have findings), with the
   * same row idiom as this one but a different click action, and no findings text
   * on it at all. Folding the count in here gives one list instead of two, and
   * shows the case the subset list structurally could not: a low-yielding wafer
   * with no findings, sitting next to the flagged ones.
   */
  findingsFor?: (waferIndex: number) => { total: number; unusual: number; notable: number } | undefined,
): HTMLDivElement | null {
  const waferData = lotSummary.perWafer
    .map(pw => ({
      waferIndex: pw.waferIndex,
      label: waferDisplayLabel(items[pw.waferIndex], pw.waferIndex)
        .replace(/\s*·\s*\d+(\.\d+)?%$/, ''),
      yieldPct: pw.summary.stats.yieldPercent,
    }))
    .filter(w => w.yieldPct !== null) as Array<{ waferIndex: number; label: string; yieldPct: number }>;

  if (!waferData.length) return null;

  const minY = minOf(waferData.map(w => w.yieldPct));
  const maxY = maxOf(waferData.map(w => w.yieldPct));
  const rangeNote = minY === maxY ? '' : ` (${minY.toFixed(1)}–${maxY.toFixed(1)}%)`;

  const sortedYields = [...waferData.map(w => w.yieldPct)].sort((a, b) => a - b);
  const med = medianOfSorted(sortedYields);
  // Tukey lower fence. Only meaningful with enough wafers to have quartiles at
  // all — on 3 wafers Q1/Q3 are barely distinguishable from min/max and the
  // fence degenerates into flagging the lowest wafer of every lot.
  const q1  = quantile(sortedYields, 0.25);
  const q3  = quantile(sortedYields, 0.75);
  const lowFence = waferData.length >= 5 ? q1 - 1.5 * (q3 - q1) : -Infinity;

  const ui = panelUiState(panel);

  const renderRows = (content: HTMLElement) => {
    const rows = ui.waferSort === 'yield'
      ? [...waferData].sort((a, b) => a.yieldPct - b.yieldPct)
      : waferData;
    for (const { waferIndex, label, yieldPct } of rows) {
      const isOutlier = yieldPct < lowFence;
      // Stated in the label, not only in a colour — this is the whole reason the
      // muted-fill encoding was removed.
      const rowLabel = isOutlier ? `${label} · low outlier` : label;
      const row = progressRow(rowLabel, yieldPct, undefined, undefined, med);
      const f = findingsFor?.(waferIndex);
      if (f?.total) appendFindingsBadge(row, f);
      wireWaferRow(row, waferIndex, label, yieldPct, f);
      content.appendChild(row);
    }
  };

  const medNote = ` · median ${med.toFixed(1)}%`;
  const { outer } = collapsibleSection(
    'Wafer Yield' + rangeNote + medNote,
    true,
    undefined,
    {
      stateKey: 'waferYield',
      panel,
      render: renderRows,
      control: panel
        ? rerender => makeSegmented(
            [['slot', 'Slot'], ['yield', 'Yield']],
            ui.waferSort,
            v => { ui.waferSort = v as 'slot' | 'yield'; rerender(); },
            panel.ownerDocument,
            true,
          )
        : undefined,
    },
  );
  return outer;

  /** Severity-coloured count, appended to the row's label line. The bare number
   *  the old per-wafer index used said nothing about what it counted, so the text
   *  spells it out and the colour is decoration on top, never the only signal. */
  function appendFindingsBadge(row: HTMLDivElement, f: { total: number; unusual: number; notable: number }) {
    const top: StatsSeverity = f.unusual ? 'unusual' : f.notable ? 'notable' : 'info';
    const badge = el('span', {
      marginLeft: SPACE.sm,
      flexShrink:   '0',
      background:   sevColor(top),
      color:        '#fff',
      borderRadius: RADIUS.container,
      padding:      '0 5px',
      fontSize:     FONT.body,
      fontWeight:   '600',
    }, `${f.total}`);
    // aria-hidden: the row's own accessible name already spells this count out,
    // so announcing the bare number again would just be noise. The tooltip is the
    // sighted-hover equivalent of that same text.
    badge.setAttribute('aria-hidden', 'true');
    wireTooltip(badge, `${f.total} finding${f.total === 1 ? '' : 's'}`
      + (f.unusual ? `, ${f.unusual} unusual` : '')
      + (f.notable ? `, ${f.notable} notable` : ''));
    // Appended INSIDE the label span, not as a sibling of it: progressRow's label
    // line is `justify-content: space-between` with exactly two children (label,
    // percent), so a third sibling floats to the centre of the row instead of
    // sitting with the label it belongs to.
    row.firstElementChild?.firstElementChild?.appendChild(badge);
  }

  function wireWaferRow(
    row: HTMLDivElement, waferIndex: number, label: string, yieldPct: number,
    f?: { total: number; unusual: number; notable: number },
  ) {
    if (onWaferClick) {
      row.style.cursor = 'pointer';
      row.style.borderRadius = '4px';
      row.style.padding = '2px 3px';
      row.style.marginLeft = '-3px';
      row.style.marginRight = '-3px';
      row.setAttribute('role', 'button');
      // Must describe what the click ACTUALLY does. In the gallery this used to
      // say "view wafer" while the handler only highlighted the card in the grid
      // — the row now opens the wafer, so the two finally agree.
      row.setAttribute('aria-label',
        `${label}, ${yieldPct.toFixed(1)}% yield`
        + (f?.total ? `, ${f.total} finding${f.total === 1 ? '' : 's'}${f.unusual ? `, ${f.unusual} unusual` : ''}` : '')
        + ' — open wafer');
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
  }
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
  return describeSorted([...vals].sort((a, b) => a - b));
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
    // 'identity', not the default 'auto'. These are IDENTITY columns — the point
    // is that a file which has left the app still says which wafer(s) it
    // describes. A host mapping an STDF header into wafer metadata also carries
    // WCR geometry (Center X/Y, Die Ht/Wid, Pos X/Y, Wafr Siz, Wf Flat, Wf Units,
    // Job Rev), and 'auto' stamped every one of them as a constant leading column
    // on every row — fifteen columns before the first statistic, none of which
    // identified anything. The die list keeps 'auto': it is a raw-dies dump where
    // the full context is the point.
    waferMetadata, waferKeys: 'identity', waferPlacement: 'csv', reservedLabels,
  }).columns;
}

/** Population column value, when the export describes a pooled set. Documented on
 *  `CsvExportContext.populationLabel` from the start but never actually emitted —
 *  so a pooled file (every test showing one big N) carried nothing saying it was
 *  pooled rather than one wafer's. */
function csvPopulationColumn(csv: CsvExportContext | undefined): MetadataColumn[] {
  if (!csv?.populationLabel) return [];
  return [{
    key: 'population', label: 'Population', scope: 'wafer',
    constant: csv.populationLabel,
    // These exports have no die rows — every value is the column's constant.
    get: () => csv.populationLabel!,
    csvOnly: true,
  }];
}

/**
 * {@link buildTestSectionSteps}, run straight through — the entry for every
 * caller that is not staging its render across tasks.
 */
export function buildTestSection(...args: Parameters<typeof buildTestSectionSteps>): HTMLDivElement | null {
  return drain(buildTestSectionSteps(...args));
}

/**
 * @internal The Test Values table as a {@link Chunked} computation: one step per
 * test for the descriptive statistics, plus the steps of the capability pass it
 * delegates to. This is the single largest piece of work in either summary
 * panel — at lot scale it scans the pooled dies once per test and sorts every
 * test's values — so it is the one that has to be interruptible for the panel
 * not to block the main thread for seconds at a time.
 */
export function* buildTestSectionSteps(
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
  /**
   * Population for the Ppk column — one item per wafer (see `stats/capability.ts`).
   * Passing `[{ dies }]` for a single wafer is correct. Omit to drop the column.
   */
  capabilityItems?: CapabilityItem[],
  /** Panel element owning the collapsed state. Omit for a stateless render. */
  panel?: HTMLElement,
  /**
   * On-screen column set.
   *
   * `'compact'` (Test / N / Mean / Ppk / Spec yield) exists for the docked Summary
   * panel's 260px column, where the full set meant four visible columns and a
   * horizontal scrollbar nested inside a vertical one. `'full'` adds the
   * descriptive statistics back and is the DEFAULT, because every other consumer
   * — the Insights Overview card above all — has the width to show them, and
   * silently trimming a full-width table to a narrow surface's budget loses real
   * information for no benefit. The CSV export always carries every column
   * regardless.
   */
  columns: 'compact' | 'full' = 'full',
): Chunked<HTMLDivElement | null> {
  const activeDies = dies.filter(d => !d.partial && !d.edgeExcluded);
  const perTestStatsByNumber = new Map((precomputedTestStats?.perTestStats ?? []).map(s => [s.testNumber, s]));
  const specYieldByNumber = new Map((precomputedTestStats?.testSpecYield ?? []).map(s => [s.testNumber, s]));

  // Build a unified list of { testNumber, name, unit } from testDefs when present,
  // or from the testNumber keys found in die.testValues when absent.
  type TestEntry = { testNumber: number; name: string; unit?: string; limitLow?: number; limitHigh?: number; derived?: true; expression?: string };
  let entries: TestEntry[];

  if (testDefs?.length) {
    // Functional (pass/fail) tests are excluded — every column in this table
    // (mean/σ/median/quartiles) is a parametric statistic.
    entries = testDefs
      .filter(isParametricTest)
      // `derived`/`expression` travel with the entry: this table prints a mean
      // and a sigma per test, and a derived quantity must not read as a
      // measured one here any more than it may in the capability grid.
      .map(def => ({
        testNumber: def.testNumber, name: def.name, unit: def.unit,
        limitLow: def.limitLow, limitHigh: def.limitHigh,
        ...derivedFields(def),
      }));
  } else {
    const testNumbers = getUniqueTestNumbers(activeDies);
    entries = testNumbers.map(tn => ({ testNumber: tn, name: testLabel(undefined, tn) }));
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

  const hasFullStats = (p?: { stddev?: number; median?: number; q1?: number; q3?: number }): boolean =>
    !!p && p.stddev !== undefined && p.median !== undefined && p.q1 !== undefined && p.q3 !== undefined;
  const hasLimit = (e: TestEntry): boolean => e.limitLow !== undefined || e.limitHigh !== undefined;

  // ── One pooled pass over the dies, for everything below that needs them ──
  //
  // The Ppk column, the descriptive statistics and the spec-yield tally all
  // read the same values off the same dies, and each used to walk them
  // separately — three O(dies x tests) passes, which on a 50-wafer lot of
  // 4,000 dies x 100 tests was the whole of a 41 s panel render. They now
  // share `pooledTestStatsSteps`, which collects each test's values once,
  // sorts them once, and derives all three.
  //
  // Skipped entirely when nothing actually needs the dies: a single wafer whose
  // `analyzeWaferMap` summary already carries full per-test statistics and spec
  // yields, with no Ppk column asked for, must not pay for a pass. Without
  // `testDefs` there is nothing for it to key on either (the entries came from
  // the dies' own keys), and those tests keep the raw scan below.
  const wantsPpk = !!(capabilityItems?.length && testDefs?.length);
  const needsPooledDies = wantsPpk || entriesWithData.some(e =>
    !hasFullStats(perTestStatsByNumber.get(e.testNumber))
    || (hasLimit(e) && !specYieldByNumber.has(e.testNumber)));
  const pooled = (needsPooledDies && testDefs?.length)
    ? yield* pooledTestStatsSteps(capabilityItems ?? [{ dies }], testDefs)
    : undefined;

  for (const entry of entriesWithData) {
    yield;
    const precomputed = perTestStatsByNumber.get(entry.testNumber);
    // The pooled pass counted these; `undefined` for a test it did not cover.
    const pooledSpec = pooled?.specTally.get(entry.testNumber);
    const pooledStats = pooled?.stats.get(entry.testNumber);
    // One scan of the dies for this test — the last resort, for a test no
    // precomputed summary and no pooled pass covered.
    const scanValues = (): number[] => activeDies
      .map(d => d.testValues?.[entry.testNumber])
      .filter((v): v is number => v !== undefined && isFinite(v));

    let stats: TestStatRow;
    if (hasFullStats(precomputed)) {
      const p = precomputed!;
      stats = {
        testNumber: entry.testNumber, min: p.min, max: p.max, mean: p.mean, count: p.count,
        stddev: p.stddev!, median: p.median!, q1: p.q1!, q3: p.q3!,
      };
    } else if (pooledStats) {
      stats = { testNumber: entry.testNumber, ...pooledStats };
    } else {
      const vals = scanValues();
      if (!vals.length) continue;
      stats = { testNumber: entry.testNumber, ...computeDescriptive(vals) };
    }

    let specYieldPct: number | null = null;
    let specN = 0;
    if (hasLimit(entry)) {
      const specYieldEntry = specYieldByNumber.get(entry.testNumber);
      if (specYieldEntry) {
        ({ yieldPercent: specYieldPct, totalDies: specN } = specYieldEntry);
      } else if (pooledSpec) {
        specN = pooledSpec.n;
        specYieldPct = specN > 0 ? ((specN - pooledSpec.fail) / specN) * 100 : null;
      } else {
        // No precomputed summary and no pooled pass for this test — the last
        // resort, one scan of the dies for this test alone.
        const vals = scanValues();
        let specFail = 0;
        for (const v of vals) {
          if ((entry.limitLow !== undefined && v < entry.limitLow)
            || (entry.limitHigh !== undefined && v > entry.limitHigh)) specFail++;
        }
        specN = vals.length;
        specYieldPct = vals.length > 0 ? ((vals.length - specFail) / vals.length) * 100 : null;
      }
    }

    rows.push({ entry, stats, specYieldPct, specN });
  }
  if (!rows.length) return null;

  // Ppk per test, out of the pooled pass above — the same
  // `pooledTestStatsSteps` computation behind `buildCapabilityData`, which the
  // Insights capability panel and the summary report use, not a local mean/σ
  // division, so the three surfaces cannot disagree.
  //
  // Ppk, not Cpk, and deliberately. Cp/Cpk use the pooled WITHIN-wafer stddev;
  // on the single-wafer panel there is exactly one subgroup, so `stdWithin` and
  // `stdOverall` are the same sample variance and `cpk === ppk` identically —
  // labelling that column "Cpk" would name a short-term index that the data does
  // not contain. On the lot panel the two genuinely differ, and Ppk is the honest
  // one: Cpk excludes wafer-to-wafer shift, which at wafer test is often the
  // dominant variance component, so it flatters exactly the failure mode most
  // worth seeing. It also matches `buildCapabilityData`'s own worst-Ppk-first
  // ordering, which the Insights capability panel renders. The Cpk/Ppk pair is a
  // real drift diagnostic, but it needs two columns and lives in the summary
  // report (`renderSummaryReport.ts`'s capability section prints all four).
  //
  // Needs BOTH limits (`hasSpec`); single-sided tests get no index and render '—'.
  //
  // `wantsPpk` gates it HERE, not in the pooled pass: the pass always derives
  // capability (it is a few quantile lookups on an array it has already sorted)
  // so that one memoised result serves the panel, the Insights capability chart
  // and the summary report alike. Whether this table shows a Ppk column is this
  // table's decision — it needs the lot as its population, which is exactly
  // what `capabilityItems` supplies.
  const ppkByTest = new Map<number, number | null>();
  for (const d of (wantsPpk ? pooled?.capability : undefined) ?? []) {
    if (d.hasSpec) ppkByTest.set(d.testNumber, d.ppk);
  }
  const hasPpk = ppkByTest.size > 0;

  // N in the section title when every test shares it, which is the common case
  // (all tests run on all dies) — a whole column repeating "2873" 6 times inside a
  // 260px panel. Kept as a column only when counts actually differ, which is
  // itself the interesting case and was previously invisible among identical values.
  const counts = new Set(rows.map(r => r.stats.count));
  const uniformN = counts.size === 1 ? rows[0].stats.count : null;

  const outer = el('div');

  const headerRow = el('div', { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: SPACE.sm });
  const nNote = uniformN !== null ? ` · N=${uniformN.toLocaleString()}` : '';
  const titleText = csv?.populationLabel
    ? `Test Values  (${rows.length}) — ${csv.populationLabel}${nNote}`
    : `Test Values  (${rows.length})${nNote}`;
  const title = sectionTitle(titleText);
  title.style.marginBottom = '0';
  headerRow.appendChild(title);

  const exportBtn = document.createElement('button');
  exportBtn.type = 'button';
  exportBtn.textContent = 'Test values CSV';
  Object.assign(exportBtn.style, {
    ...controlStyle('outlined'),
  } as Partial<CSSStyleDeclaration>);
  wireControlHover(exportBtn);
  exportBtn.addEventListener('click', () => {
    // wmap's own unitless "engineering" notation (fmt's fallbackFormat:
    // 'engineering' — fixed decimal in [0.1, 9999], otherwise E±N in
    // multiples of 3) — not raw floats, which print with misleading
    // trailing-digit precision the underlying measurement never actually
    // had (e.g. `0.001151199649817308`). Units are per-test (see the "Unit"
    // column) rather than baked into each value, so every value column uses
    // one consistent notation regardless of the test's own unit/magnitude.
    const cols = ['Test', 'Unit', 'N', 'Min', 'Q1', 'Median', 'Mean', 'Q3', 'Max', 'StdDev'];
    if (hasPpk) cols.push('Ppk');
    // `Spec Yield N` only when it can actually differ from the row's own `N` —
    // otherwise it repeated the same number in two adjacent columns on every row.
    // It CAN differ: a die with a value but no verdict counts toward N and not
    // toward the spec population, so the column is kept whenever that happens.
    const specNDiffers = rows.some(r => r.specYieldPct !== null && r.specN !== r.stats.count);
    if (hasAnyLimit) {
      cols.push('LSL', 'USL', 'Spec Yield %');
      if (specNDiffers) cols.push('Spec Yield N');
    }
    // Derived tests are stated as data, not a glyph: a CSV has no key, and it
    // goes to tools that will otherwise treat the value as measured. Only when
    // some row is derived, so a measured-only export keeps its columns.
    const anyDerived = rows.some(r => isDerivedTest(r.entry));
    if (anyDerived) cols.push(DERIVED_CSV_HEADER);
    const idCols = [...resolveCsvIdentityColumns(csv, cols), ...csvPopulationColumn(csv)];
    const allCols = [...idCols.map(c => c.label), ...cols];
    const lines = [allCols.map(csvField).join(',')];
    const f = (n: number) => fmtValue(n, undefined, 'engineering');
    for (const { entry, stats, specYieldPct, specN } of rows) {
      const fields = [
        ...idCols.map(c => c.constant ?? ''),
        entry.name, entry.unit ?? '', String(stats.count), f(stats.min), f(stats.q1), f(stats.median),
        f(stats.mean), f(stats.q3), f(stats.max), f(stats.stddev),
      ];
      if (hasPpk) {
        const ppk = ppkByTest.get(entry.testNumber);
        fields.push(ppk === undefined || ppk === null ? '' : ppk.toFixed(3));
      }
      if (hasAnyLimit) {
        fields.push(
          entry.limitLow !== undefined ? f(entry.limitLow) : '',
          entry.limitHigh !== undefined ? f(entry.limitHigh) : '',
          specYieldPct !== null ? specYieldPct.toFixed(1) : '',
        );
        if (specNDiffers) {
          fields.push((entry.limitLow !== undefined || entry.limitHigh !== undefined) ? String(specN) : '');
        }
      }
      if (anyDerived) fields.push(derivedCsvCell(entry));
      lines.push(fields.map(csvField).join(','));
    }
    saveTextFile(lines.join('\n'), 'test-values.csv', 'text/csv', onSaveText);
  });
  headerRow.appendChild(exportBtn);
  outer.appendChild(headerRow);

  const table = el('table', {
    width:         '100%',
    borderCollapse: 'collapse',
    fontSize:      FONT.body,
  });
  const thead = document.createElement('thead');
  const headRow = document.createElement('tr');
  // Deliberately NOT the CSV's twelve columns. Twelve columns in a 260px panel
  // meant four were visible and the rest sat behind a horizontal scrollbar nested
  // inside a vertical one — unreadable, and duplicated in three places that do
  // have the width (the summary report, the CSV export, and the Insights
  // boxplot/capability panels). What survives is what drives a decision: the
  // centre of the distribution, how capable the process is against its spec, and
  // what fraction of dies made it. The full table is one click away in the report.
  const headers = ['Test'];
  if (uniformN === null) headers.push('N');
  if (columns === 'full') headers.push('Min', 'Q1', 'Median');
  headers.push('Mean');
  if (columns === 'full') headers.push('Q3', 'Max', 'StdDev');
  if (hasPpk) headers.push('Ppk');
  if (columns === 'full' && hasAnyLimit) headers.push('LSL', 'USL');
  if (hasAnyLimit) headers.push('Spec yield');
  for (const h of headers) {
    const th = el('th', {
      textAlign:    h === 'Test' ? 'left' : 'right',
      // Meta tier: an uppercase, letter-spaced micro-label is 11px/600 by the
      // type scale, not 12px/700. At body size and 700 it out-shouted the data
      // underneath it — the header is a signpost, the numbers are the content.
      fontWeight:   '600',
      fontSize:     FONT.meta,
      letterSpacing: TRACKING,
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
        padding: `${SPACE.xs} ${SPACE.md}`,
        borderBottom: `1px solid ${CLR.menuBorder}`,
        // CLR.text, not VALUE_COLOR. `value` is the deliberately darker emphasis
        // shade for headings and big stat figures; applying it to every cell of
        // a table makes the whole table read as emphasised, which is the same as
        // none of it being emphasised.
        color:       CLR.text,
        whiteSpace:  'nowrap',
      }, text);
      row.appendChild(td);
    };
    cell(markedTestLabel(entry, entry.testNumber), 'left');
    if (uniformN === null) cell(`${stats.count}`);
    if (columns === 'full') { cell(f(stats.min)); cell(f(stats.q1)); cell(f(stats.median)); }
    cell(f(stats.mean));
    if (columns === 'full') { cell(f(stats.q3)); cell(f(stats.max)); cell(f(stats.stddev)); }
    if (hasPpk) {
      const ppk = ppkByTest.get(entry.testNumber);
      cell(ppk === undefined || ppk === null ? '—' : ppk.toFixed(2));
    }
    if (columns === 'full' && hasAnyLimit) {
      cell(entry.limitLow  !== undefined ? f(entry.limitLow)  : '—');
      cell(entry.limitHigh !== undefined ? f(entry.limitHigh) : '—');
    }
    if (hasAnyLimit) {
      // The per-test spec N is dropped from the cell when it equals the section's
      // own N — same reasoning as the N column above.
      cell(specYieldPct !== null
        ? (uniformN !== null && specN === uniformN ? `${specYieldPct.toFixed(1)}%` : `${specYieldPct.toFixed(1)}% (N=${specN})`)
        : '—');
    }

    tbody.appendChild(row);
  }
  table.appendChild(tbody);

  const scroll = el('div', { overflowX: 'auto' });
  scroll.appendChild(table);
  const tableBlock = withDerivedKey(scroll, rows.map(r => ({ label: r.entry.name, ...derivedFields(r.entry) })));

  // Collapsible only when a panel owns the state; the report and any other
  // stateless consumer keep the flat title + table they had.
  if (!panel) {
    outer.appendChild(tableBlock);
    return outer;
  }
  // Reuse the section shell rather than the local header row: the title becomes
  // the shell's label (so collapsing hides the table, not the title) and Export
  // CSV becomes its header control.
  headerRow.remove();
  const { outer: shell } = collapsibleSection(titleText, true, undefined, {
    stateKey: 'testValues',
    panel,
    render: content => content.appendChild(tableBlock),
    control: () => exportBtn,
  });
  return shell;
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
  /** Panel element owning the collapsed state. Omit for a stateless render. */
  panel?: HTMLElement,
): HTMLDivElement | null {
  const rows = precomputed ?? computeFunctionalYield(dies, testDefs);
  if (!rows?.length) return null;

  // Same N treatment as the parametric table: hoisted to the title when every
  // functional test shares it. The pass-rate cell also used to re-print it as
  // "(N=2873)" beside an N column already showing 2873 — the same number three
  // times across one row. Computed before the title because the title carries it,
  // on the stateless path too: dropping the column without hoisting the value
  // would lose the population outright.
  const fnCounts = new Set(rows.map(r => r.totalDies));
  const fnUniformN = fnCounts.size === 1 ? rows[0].totalDies : null;
  const fnNote = fnUniformN !== null ? ` · N=${fnUniformN.toLocaleString()}` : '';

  const outer = el('div');

  const headerRow = el('div', { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: SPACE.sm });
  const titleText = csv?.populationLabel
    ? `Functional Tests  (${rows.length}) — ${csv.populationLabel}${fnNote}`
    : `Functional Tests  (${rows.length})${fnNote}`;
  const title = sectionTitle(titleText);
  title.style.marginBottom = '0';
  headerRow.appendChild(title);

  const exportBtn = document.createElement('button');
  exportBtn.type = 'button';
  exportBtn.textContent = 'Functional CSV';
  Object.assign(exportBtn.style, {
    ...controlStyle('outlined'),
  } as Partial<CSSStyleDeclaration>);
  wireControlHover(exportBtn);
  exportBtn.addEventListener('click', () => {
    const cols = ['Test', 'N', 'Pass', 'Fail', 'Pass Rate %'];
    // As the parametric export: plain names, and the derivation as a column.
    const anyDerived = rows.some(r => isDerivedTest(r));
    if (anyDerived) cols.push(DERIVED_CSV_HEADER);
    const idCols = [...resolveCsvIdentityColumns(csv, cols), ...csvPopulationColumn(csv)];
    const lines = [[...idCols.map(c => c.label), ...cols].map(csvField).join(',')];
    for (const r of rows) {
      lines.push([
        ...idCols.map(c => c.constant ?? ''),
        unmarkedLabel(r.label), String(r.totalDies), String(r.passDies), String(r.failDies),
        r.passRatePercent !== null ? r.passRatePercent.toFixed(1) : '',
        ...(anyDerived ? [derivedCsvCell(r)] : []),
      ].map(csvField).join(','));
    }
    saveTextFile(lines.join('\n'), 'functional-tests.csv', 'text/csv', onSaveText);
  });
  headerRow.appendChild(exportBtn);
  outer.appendChild(headerRow);

  const table = el('table', {
    width:          '100%',
    borderCollapse: 'collapse',
    fontSize:       FONT.body,
  });
  const thead = document.createElement('thead');
  const headRow = document.createElement('tr');
  const fnHeaders = fnUniformN === null ? ['Test', 'N', 'Pass', 'Fail', 'Pass rate'] : ['Test', 'Pass', 'Fail', 'Pass rate'];
  for (const h of fnHeaders) {
    headRow.appendChild(el('th', {
      textAlign:     h === 'Test' ? 'left' : 'right',
      fontWeight:    '700',
      fontSize:      FONT.body,
      letterSpacing: TRACKING,
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
        padding: `${SPACE.xs} ${SPACE.md}`,
        borderBottom: `1px solid ${CLR.menuBorder}`,
        color:        VALUE_COLOR,
        whiteSpace:   'nowrap',
      }, text));
    };
    cell(r.label, 'left');
    if (fnUniformN === null) cell(String(r.totalDies));
    cell(String(r.passDies));
    cell(String(r.failDies));
    cell(r.passRatePercent !== null ? `${r.passRatePercent.toFixed(1)}%` : '—');
    tbody.appendChild(row);
  }
  table.appendChild(tbody);

  const scroll = el('div', { overflowX: 'auto' });
  scroll.appendChild(table);

  // Labels are marked at the source (`computeFunctionalYield`); this is the key for them.
  const fnBlock = withDerivedKey(scroll, rows);
  if (!panel) {
    outer.appendChild(fnBlock);
    return outer;
  }
  headerRow.remove();
  const { outer: shell } = collapsibleSection(
    titleText, true, undefined,
    { stateKey: 'functionalTests', panel, render: content => content.appendChild(fnBlock), control: () => exportBtn },
  );
  return shell;
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
  /** Panel element owning the collapsed state. Omit for a stateless render. */
  panel?: HTMLElement,
): HTMLDivElement | null {
  const csv: CsvExportContext | undefined = perWaferSummaries?.length ? {
    perWaferMetadata: perWaferSummaries.map(s => s.wafer ?? {}),
    populationLabel: `${perWaferSummaries.length} wafer${perWaferSummaries.length === 1 ? '' : 's'} pooled`,
  } : undefined;
  const pooled = poolFunctionalYield(perWaferSummaries);
  if (pooled) {
    return buildFunctionalTestSection(allDies, testDefs, pooled, onSaveText, csv, panel);
  }

  return buildFunctionalTestSection(allDies, testDefs, undefined, onSaveText, csv, panel);
}

// ── Findings display vocabulary ──────────────────────────────────────────────
// Severity is encoded exactly once per element: a small dot on group headers,
// a thin left border on rows. Coloured all-caps headings on top of both made
// an ordinary findings list read like an incident page.

const severityRank: Record<StatsFinding['severity'], number> = { unusual: 0, notable: 1, info: 2 };
function sevDot(s: StatsFinding['severity']): HTMLSpanElement {
  return el('span', {
    display: 'inline-block', width: '7px', height: '7px', borderRadius: RADIUS.pill,
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
    // "has" or "have": a merged region is plural (`regionHas` in analyzeWaferMap).
    const verb = [' has ', ' have '].find(v => text.startsWith(`${groupLeft}${v}`));
    if (verb) text = text.slice(groupLeft.length + verb.length);
    else if (text.startsWith(`${groupLeft} `)) text = text.slice(groupLeft.length + 1);
  }
  text = plainBinTerms(text);
  return text.length ? text[0].toUpperCase() + text.slice(1) : text;
}

/**
 * The `†` key for a findings list, or `null` when none of the shown findings
 * is about a derived test. The glyph sits inside the finding sentences, and a
 * glyph on screen without its words reads as a rendering artefact.
 */
function derivedFindingsKey(shown: StatsFinding[]): HTMLElement | null {
  return derivedKeyLine(shown.map(f => ({ label: f.variable.label, ...derivedFields(f.variable) })));
}

/** {@link derivedKeyText} as a panel line, or `null` when nothing shown is derived. */
function derivedKeyLine(entries: Parameters<typeof derivedKeyText>[0]): HTMLElement | null {
  const text = derivedKeyText(entries);
  return text ? el('div', { fontSize: FONT.body, color: LABEL_COLOR, marginTop: SPACE.sm, lineHeight: LEADING.base }, text) : null;
}

/**
 * A table's scroller with the `†` key under it — outside the scroller, so a wide
 * table scrolling sideways never carries the key out of view. Returns the
 * scroller alone when no row is derived.
 */
function withDerivedKey(scroll: HTMLElement, entries: Parameters<typeof derivedKeyText>[0]): HTMLElement {
  const key = derivedKeyLine(entries);
  if (!key) return scroll;
  const block = el('div', {});
  block.append(scroll, key);
  return block;
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
   *
   * NOTE — the `false` path has no in-repo caller today, and it is the only
   * collapsible section in this panel that does NOT persist its collapsed
   * state: `collapsibleSection` needs both a `stateKey` and the owning `panel`
   * to do that, and this function is not given a `panel`. Every section that
   * actually renders (bins, regionYield, waferYield, testValues,
   * functionalTests, findings) does persist, so the panel is consistent as
   * shipped. If you revive this path — or call it from outside the library —
   * thread a `panel` through and give it a `stateKey`, or it will be the one
   * section that forgets whether the reader collapsed it.
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
  // Every finding this section actually shows — the grouped rows, and the
  // related findings nested under each spatial pattern — so the `†` key
  // appears exactly when a marked finding is on screen.
  const shownFindings = (): StatsFinding[] => [
    ...groups.flatMap(g => g.findings),
    ...patternFindings.flatMap(pf => findings.filter(f => pf.relatedIds?.includes(f.id))),
  ];

  // Helper: build a clickable finding row button. `groupLeft` is the group
  // header's own subject — passed so the row can drop that redundant prefix.
  function makeFindingRow(finding: StatsFinding, isChild = false, groupLeft?: string): HTMLButtonElement {
    const isActive = activeFindingId === finding.id;
    const row = document.createElement('button');
    row.type = 'button';
    row.dataset.wmapFinding = finding.id;
    row.textContent = findingRowText(finding, groupLeft);
    wireTooltip(row, formatFindingTooltip(finding));
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
      borderRadius: RADIUS.container,
      padding:      isChild ? '6px 10px' : '8px 10px',
      textAlign:    'left',
      fontSize:     isChild ? '10px' : '11px',
      fontWeight:   isActive ? '600' : '400',
      color:        CLR.text,
      cursor:       'pointer',
      width:        '100%',
      marginBottom: SPACE.xs,
    });
    wireControlHover(row, 'bare');
    row.addEventListener('click', () => onFindingClick(finding, row));
    return row;
  }

  // Narrative block — elevated styling with a "Detail ▸" expand button
  const narrativeText = plainBinTerms(buildFindingsNarrative(findings) ?? '');
  if (narrativeText) {
    const narrativeBlock = el('div', {
      background:    CLR.bgActive,
      borderRadius:  RADIUS.container,
      padding: `${SPACE.md} ${SPACE.lg}`,
      marginBottom: SPACE.md,
      display:       'flex',
      gap: SPACE.md,
      alignItems:    'flex-start',
    });

    const narrativeText2 = el('span', {
      flex:       '1',
      fontSize:   FONT.body,
      lineHeight: LEADING.base,
      color:      CLR.text,
    }, narrativeText);
    narrativeBlock.appendChild(narrativeText2);

    const detailBtn = el('button', {
      flexShrink: '0',
      border:     'none',
      background: 'none',
      fontSize:   FONT.body,
      color:      CLR.icon,
      cursor:     'pointer',
      padding:    '0',
      lineHeight: LEADING.base,
      whiteSpace: 'nowrap',
    }, 'Detail ▸');
    (detailBtn as HTMLButtonElement).type = 'button';
    wireControlHover(detailBtn, 'bare');
    detailBtn.addEventListener('click', () => {
      const handle = openModal({ title: 'Findings Summary', onClose: () => {}, anchor: detailBtn });

      // Narrative paragraph
      const narPara = el('p', {
        fontSize:     '16px',
        lineHeight:   LEADING.base,
        color:        CLR.text,
        padding:      `${SPACE.xxl} ${SPACE.xxxl} ${SPACE.xxl}`,
        margin:       '0',
        borderBottom: `1px solid ${CLR.menuBorder}`,
        flexShrink:   '0',
      }, narrativeText);
      handle.contentWrap.appendChild(narPara);

      // Scrollable findings list — pattern parents first, then standalone groups
      const listWrap = el('div', {
        overflowY: 'auto',
        padding: `${SPACE.xxl} ${SPACE.xxxl}`,
        flex:      '1',
      });

      const modalGroupHeader = (severity: StatsFinding['severity'], text: string) => {
        const h = el('div', {
          display: 'flex', alignItems: 'center', gap: '7px',
          fontSize: FONT.sub, fontWeight: '600', color: VALUE_COLOR,
          marginTop: SPACE.lg, marginBottom: SPACE.xs,
        });
        h.appendChild(sevDot(severity));
        h.appendChild(el('span', {}, text));
        return h;
      };

      for (const pf of patternFindings) {
        listWrap.appendChild(modalGroupHeader(pf.severity, pf.comparison.left));
        listWrap.appendChild(el('div', {
          fontSize:    FONT.body,
          color:       CLR.text,
          padding:     '4px 0 4px 15px',   // optical: 15px indents the text under the finding's severity dot
          marginBottom: SPACE.xxs,
        }, plainBinTerms(pf.summary)));
        const children = findings.filter(f => pf.relatedIds?.includes(f.id));
        for (const cf of children) {
          listWrap.appendChild(el('div', {
            fontSize:    FONT.body,
            color:       LABEL_COLOR,
            padding:     '2px 0 2px 23px',   // optical: aligns a child finding under its parent's label, not the dot
            marginBottom: SPACE.xxs,
          }, plainBinTerms(cf.summary)));
        }
      }

      for (const group of groups) {
        const [fam, left] = group.key.split('\0');
        listWrap.appendChild(modalGroupHeader(group.worst, groupLabel(fam, left)));
        for (const f of group.findings) {
          listWrap.appendChild(el('div', {
            fontSize:    FONT.body,
            color:       CLR.text,
            padding:     '4px 0 4px 15px',   // optical: 15px indents under the severity dot, as above
            marginBottom: SPACE.xxs,
          }, findingRowText(f, left)));
        }
      }
      const modalKey = derivedFindingsKey(shownFindings());
      if (modalKey) listWrap.appendChild(modalKey);
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
      borderRadius: RADIUS.container,
      padding:      '8px 32px 8px 10px', // optical: 32px right clears the absolutely-positioned chevron
      textAlign:    'left',
      fontSize:     FONT.body,
      fontWeight:   isActive ? '600' : '500',
      color:        CLR.text,
      cursor:       'pointer',
      width:        '100%',
    });
    parentRow.textContent = plainBinTerms(pf.summary);
    wireTooltip(parentRow, pf.summary);
    // See makeFindingRow's identical comment — isActive already drives the
    // visual highlight, this exposes the same state to a screen reader.
    parentRow.setAttribute('aria-current', isActive ? 'true' : 'false');
    wireControlHover(parentRow, 'bare');
    parentRow.addEventListener('click', () => onFindingClick(pf, parentRow));
    parentWrap.appendChild(parentRow);

    if (hasChildren) {
      // Child container — initially collapsed
      const childWrap = el('div', {
        display:     'none',
        paddingLeft: '12px',
        marginBottom: SPACE.xs,
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
        fontSize:   FONT.body,
        color:      CLR.icon,
        cursor:     'pointer',
        padding: `${SPACE.xxs} ${SPACE.xs}`,
        lineHeight: LEADING.none,
      }, '▸') as HTMLButtonElement;
      wireControlHover(chevron, 'bare');
      chevron.type = 'button';
      // No text argument — the tooltip live-reads `aria-label`, which the click
      // handler below already keeps in step with the expanded state.
      wireTooltip(chevron);
      // The glyph alone (▸/▾) carries no name a screen reader will read, and the
      // tooltip is a hover-only hint a keyboard/AT user never sees —
      // aria-label is the one that actually reaches them, and aria-expanded
      // exposes the open/closed state `childWrap`'s visibility otherwise only
      // conveys visually.
      // (No second `wireControlHover` here — it was called twice, and the second
      // call snapshotted the FIRST one's hover colours as the resting state, so
      // the chevron stayed painted as hovered from the first hover onwards.)
      chevron.setAttribute('aria-label', 'Show supporting findings');
      chevron.setAttribute('aria-expanded', 'false');
      chevron.addEventListener('click', (e) => {
        e.stopPropagation();
        expanded = !expanded;
        childWrap.style.display = expanded ? 'block' : 'none';
        chevron.textContent = expanded ? '▾' : '▸';
        const label = expanded ? 'Hide supporting findings' : 'Show supporting findings';
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
      display: 'flex', alignItems: 'center', gap: SPACE.sm,
      fontSize: FONT.body, fontWeight: '600', color: VALUE_COLOR,
      margin: '2px 0 4px',
    });
    header.appendChild(sevDot(group.worst));
    header.appendChild(el('span', {}, groupLabel(family, left)));
    content.appendChild(header);

    for (const finding of group.findings) {
      content.appendChild(makeFindingRow(finding, false, left));
    }
  }

  const key = derivedFindingsKey(shownFindings());
  if (key) content.appendChild(key);

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
    display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: SPACE.lg,
    marginBottom: SPACE.lg, paddingBottom: '10px', borderBottom: `1px solid ${CLR.separator}`,
  });

  const counts: Record<StatsSeverity, number> = { unusual: 0, notable: 0, info: 0 };
  for (const f of allFindings) counts[f.severity]++;
  const present = FINDINGS_SEVERITIES.filter(s => counts[s] > 0);

  // `filter.severity === undefined` means "no severity filter" — every chip lit.
  const enabled = new Set<StatsSeverity>(
    filter.severity === undefined ? present
      : Array.isArray(filter.severity) ? filter.severity : [filter.severity],
  );

  const severityWrap = el('div', { display: 'flex', gap: SPACE.xs, flexWrap: 'wrap' });
  for (const s of present) {
    const chip = document.createElement('button');
    chip.type = 'button';
    const paint = () => {
      const on = enabled.has(s);
      chip.setAttribute('aria-pressed', on ? 'true' : 'false');
      Object.assign(chip.style, {
        display: 'inline-flex', alignItems: 'center', gap: '5px',
        border: `1px solid ${CLR.menuBorder}`, borderRadius: RADIUS.pill,
        background: on ? CLR.bgActive : 'none',
        opacity: on ? '1' : '0.5',
        color: CLR.text, fontSize: FONT.body, padding: `${SPACE.xxs} ${SPACE.md}`, cursor: 'pointer',
      } as Partial<CSSStyleDeclaration>);
      // `wireControlHover` skips an element with data-on="true", which is how an
      // active chip keeps its own background instead of being flattened to the
      // shared hover colour — on and off would otherwise look identical under
      // the pointer. Set here, in paint(), so it tracks every toggle.
      chip.dataset.on = on ? 'true' : 'false';
    };
    chip.appendChild(sevDot(s));
    chip.appendChild(el('span', {}, `${FINDINGS_SEVERITY_LABEL[s]} ${counts[s]}`));
    // Getter, not a fixed string: the hint flips as the chip is toggled.
    wireTooltip(chip, () => enabled.has(s) ? 'Click to hide these findings' : 'Click to show these findings');
    paint();
    // 'bare' + the `data-on` guard `wireControlHover` already honours: a chip
    // that is ON keeps its active background instead of being repainted by
    // hover, which would make on and off indistinguishable under the pointer.
    wireControlHover(chip, 'bare');
    chip.addEventListener('click', () => {
      if (enabled.has(s)) enabled.delete(s); else enabled.add(s);
      filter.severity = enabled.size === present.length ? undefined : [...enabled];
      onChange();
    });
    severityWrap.appendChild(chip);
  }
  row.appendChild(severityWrap);

  // The Kind/Region dropdowns cost two full rows of a 260px column. Below the
  // threshold the whole findings list is shorter than the controls for filtering
  // it, and the severity chips above already subset it — so they only appear once
  // there are enough findings to be worth narrowing. They stay mounted whenever a
  // filter is actually active, so a user who filtered down to two findings can
  // still see and clear the filter that got them there.
  const filterActive = filter.kind !== undefined || filter.family !== undefined;
  if (allFindings.length >= FINDINGS_FILTER_THRESHOLD || filterActive) {
    row.appendChild(makeLabeledSelect('Kind:', FINDINGS_KIND_OPTIONS, (filter.kind as string) ?? '', (v) => {
      filter.kind = v ? (v as StatsVariableKind) : undefined;
      onChange();
    }, { maxWidth: '130px' }));

    row.appendChild(makeLabeledSelect('Region:', FINDINGS_FAMILY_OPTIONS, (filter.family as string) ?? '', (v) => {
      filter.family = v ? (v as StatsComparisonFamily) : undefined;
      onChange();
    }, { maxWidth: '150px' }));
  }

  return row;
}

/** Findings count at or above which the Kind/Region dropdowns are worth their
 *  vertical space in the panel. */
const FINDINGS_FILTER_THRESHOLD = 8;

/**
 * Findings section with severity/kind/region filter controls — the
 * panel-level entry point (wraps `buildFindingsSection(..., standalone:
 * true)` in its own collapsible "Findings" header + filter row). Returns
 * `null` when the source has no findings at all (nothing to filter).
 */
/**
 * A host-supplied row at the top of the Findings section, for stating that a
 * category of finding is NOT present and offering to compute it.
 *
 * This exists because the absence of a finding category is invisible: a reader
 * looking at a Findings list has no way to tell that a whole class of analysis
 * was skipped. Advertising the *control* elsewhere (a menu item) does not fix
 * that — the reader has no reason to go looking. The notice belongs where the
 * gap is.
 *
 * wmap does not decide when to show this. The host knows what it did and did
 * not compute, and what recomputing would cost; it passes a notice or it does
 * not. Keep `detail` honest about that cost — an unpriced "Analyse" button on a
 * lot where the answer takes half a minute is worse than no button.
 */
export interface FindingsNotice {
  /** What is missing, stated plainly. Not a question, not an exhortation. */
  message: string;
  /** Supporting detail — normally the size of the job and its expected cost. */
  detail?: string;
  /** Action label. Omit (with `onAction`) for a message-only notice. */
  actionLabel?: string;
  onAction?: () => void;
}

/**
 * Builds the notice row. Deliberately quiet: this is an offer, not a warning —
 * `buildWarningsBanner` owns the loud treatment, and a notice competing with it
 * for alarm would misrepresent "some analysis is optional" as "something is
 * wrong".
 */
function buildFindingsNoticeRow(notice: FindingsNotice, ownerDocument: Document): HTMLDivElement {
  const row = el('div', {
    display: 'flex', flexDirection: 'column', gap: SPACE.xs,
    padding: SPACE.md, marginBottom: SPACE.md,
    background: CLR.bgHover, borderRadius: RADIUS.control,
  }, undefined, ownerDocument);
  row.appendChild(el('div', {
    fontSize: FONT.body, color: CLR.value }, notice.message, ownerDocument));
  if (notice.detail) {
    row.appendChild(el('div', {
      fontSize: FONT.meta, color: LABEL_COLOR }, notice.detail, ownerDocument));
  }
  if (notice.actionLabel && notice.onAction) {
    const btn = el('button', controlStyle('outlined') as Record<string, string>,
      notice.actionLabel, ownerDocument);
    btn.type = 'button';
    btn.style.alignSelf = 'flex-start';
    btn.style.marginTop = SPACE.xs;
    wireControlHover(btn);
    btn.addEventListener('click', notice.onAction);
    row.appendChild(btn);
  }
  return row;
}

export function buildFindingsSectionWithFilter(
  source: StatsSummary | LotStatsSummary,
  onFindingClick: (finding: StatsFinding, row: HTMLButtonElement) => void,
  activeFindingId: string | null,
  filter: FindingsFilter,
  onFilterChange: () => void,
  /** Panel element owning the collapsed state. Omit for a stateless render. */
  panel?: HTMLElement,
  /** See {@link FindingsNotice}. Rendered above the filter row. */
  notice?: FindingsNotice,
): HTMLDivElement | null {
  // A notice is itself a reason to render the section: the case it exists for
  // is a lot whose only findings would have come from the analysis that was
  // skipped, where returning null here would hide the very offer to run it.
  if (!source.findings.length && !notice) return null;

  const hasNotable = source.findings.some(f => f.severity === 'unusual' || f.severity === 'notable');
  const badge = hasNotable
    ? source.findings.filter(f => f.severity !== 'info').length.toString()
    : undefined;

  const ownerDocument = panel?.ownerDocument ?? document;
  const { outer, content } = collapsibleSection(
    `Findings (${source.findings.length})`, hasNotable || !!notice, badge,
    { stateKey: 'findings', panel },
  );
  if (notice) content.appendChild(buildFindingsNoticeRow(notice, ownerDocument));
  if (!source.findings.length) return outer;
  content.appendChild(buildFindingsFilterRow(source.findings, filter, onFilterChange));

  const filtered = filterFindings(source, filter);
  if (!filtered.length) {
    content.appendChild(el('div', {
      color: LABEL_COLOR, fontSize: FONT.body, textAlign: 'center', padding: `${SPACE.xxl} ${SPACE.md}`,
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
/** {@link buildLotTestSectionSteps}, run straight through. */
export function buildLotTestSection(...args: Parameters<typeof buildLotTestSectionSteps>): HTMLDivElement | null {
  return drain(buildLotTestSectionSteps(...args));
}

/** @internal {@link buildLotTestSection} as a {@link Chunked} computation —
 *  see {@link buildTestSectionSteps}, which does the work. */
export function* buildLotTestSectionSteps(
  allDies: Die[],
  testDefs: TestDef[] | undefined,
  fallbackFormat?: 'si' | 'engineering',
  perWaferSummaries?: StatsSummary[],
  /** Optional host hook for the "Export CSV" button — see `saveTextFile` (toolbar.ts). */
  onSaveText?: SaveTextHandler,
  /**
   * One item per wafer for the Ppk column — the lot is the population Ppk is
   * meant to describe, so every wafer must be passed, not the pooled die array.
   */
  capabilityItems?: CapabilityItem[],
  /** Panel element owning the collapsed state. Omit for a stateless render. */
  panel?: HTMLElement,
  /** See `buildTestSection`'s `columns`. Defaults to the full set. */
  columns: 'compact' | 'full' = 'full',
): Chunked<HTMLDivElement | null> {
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

  return yield* buildTestSectionSteps(allDies, testDefs, fallbackFormat, pooled, onSaveText, csv, capabilityItems, panel, columns);
}



// ── Panel container ───────────────────────────────────────────────────────────

export function createSummaryPanelEl(
  placement: 'right' | 'left' | 'top' | 'bottom',
  /**
   * Inset from the edge this panel docks against — stated by the caller,
   * because only the caller knows what that edge IS.
   *
   * `renderWaferMap` docks it inside `mapBox` and passes `EDGE_GUTTER`, the
   * same inset its chrome row uses, so the panel lines up with the toolbar
   * above it. It used to pass a smaller inset so the panel would align with a
   * toolbar FLOATING in the map's own corner; that toolbar now sits in a row
   * above the map, and the small inset aligned with nothing.
   * `renderWaferGallery` docks it at the edge of the gallery region itself,
   * where it is a bounded surface against the window and takes `EDGE_GUTTER`
   * like every other card there.
   *
   * Internal (not exported from the package), so this is a positional
   * parameter rather than an options bag. It has NO default on purpose: a
   * default is a guess about context, and guessing wrong is what put a 4px
   * gutter on the gallery's panel where 12 belonged, and 12px inside a map card
   * where 4 belonged.
   */
  edgeInset: string,
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
    // Set the inherited text colour explicitly. Without it the panel's own
    // unstyled text took whatever the HOST page happened to set — which looked
    // right embedded in tsmap and fell back to browser-default black
    // standalone, so `CLR.text` never actually reached six of the panel's text
    // elements. Also collapses two apparent text styles into one real role.
    color:       CLR.text,
    // Digits share one advance width, so figures line up down a column instead
    // of jittering — this panel is read by scanning columns of percentages and
    // counts. system-ui supports it; the exported HTML report already set it
    // (reportHtml.ts) while the live UI did not, so the two disagreed.
    fontVariantNumeric: 'tabular-nums',
    border:      BORDER,
    borderRadius:RADIUS.container,
    padding: SPACE.xl,
    // Both axes scroll for a 'top'/'bottom' panel. `overflowY: hidden` there
    // silently CLIPPED: those placements take a fixed 180px band (below), which
    // most wafers' content exceeds — Summary plus one collapsed section already
    // approaches it — so the last visible row was cut mid-line with nothing
    // saying more existed. Scrolling is the same answer 'right'/'left' already
    // use via `maxHeight: 100%`.
    //
    // This fixes the silent loss only. Whether this content should be shown in
    // a wide-short band AT ALL is a separate, open question (the stat tiles,
    // per-test tables and findings list were designed for a narrow-tall panel);
    // see TODO.md "Summary panel content clips silently in 'top'/'bottom'
    // placement", which holds the full `placement` review, up to and including
    // dropping those two values.
    overflowY:   'auto',
    overflowX:   isVertical ? 'auto'   : 'hidden',
    flexShrink:  '0',
    boxSizing:   'border-box',
    fontFamily:  FONT.family,
    // `sub`, matching the chrome, tab labels and card titles around it. At
    // `body` this panel was the smallest text on screen while holding the
    // densest content — yield figures, findings prose and per-test tables —
    // and it became the sole outlier once the identity strip was raised.
    // Descendants that set their own size (the die-list table, the muted
    // labels) are unaffected; this is the panel's inherited baseline.
    fontSize:    FONT.sub,
    boxShadow:   SHADOW.panel,
  }, undefined, ownerDocument);

  // Inset from the map area's edge, stated by the caller. This panel is
  // styled as a CARD —
  // border on all four sides, `RADIUS.container`, its own shadow — not as
  // docked IDE-style chrome, which would carry a single divider border and be
  // correct flush to the edge. Pressed against the window its rounded corners
  // read as clipped and the shadow has nowhere to fall. Applied only to the
  // edge it docks AGAINST; the opposite side is bounded by the map, not the
  // window, and spacing there is the layout's business.
  //
  // 'top' is deliberately absent. It used to rely on `reserveToolbarClearance`
  // in renderWaferMap giving that placement its own `paddingTop`, because the
  // toolbar floated over whatever was at the top of the map area. The toolbar
  // is no longer a floating overlay — it lives in the chrome row above the map
  // area, which already provides its own gap (`chromeInset`) before the map
  // area starts. A 'top'-docked panel sits right at the top of that already-
  // separated space, so it needs no margin of its own.
  if (placement === 'right')  panel.style.marginRight  = edgeInset;
  if (placement === 'left')   panel.style.marginLeft   = edgeInset;
  if (placement === 'bottom') panel.style.marginBottom = edgeInset;

  if (!isVertical) {
    // 300px, up from 260 (and 220 before that) — at 260 the findings narrative
    // wrapped every two or three words and stat-tile labels broke
    // mid-parenthetical; the 12px control/body tier (UI_STANDARDS.md type
    // scale) then pushed the per-test table's last column past the edge.
    panel.style.width    = '300px';
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
    gap: SPACE.md,
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
    fontSize:      FONT.heading,
    fontWeight:    '600',
    color:         VALUE_COLOR,
    marginBottom: SPACE.lg,
  }, text);
}

function reportButton(label: string, onClick: () => void): HTMLButtonElement {
  // "Summary report" / "View die list". These restated the outlined-button
  // shape by hand and wired no hover, so they read as labels — the shape's
  // own definition (controlStyle) plus wireControlHover is the whole point of
  // having it.
  const btn = el('button', controlStyle('outlined') as Record<string, string>, label);
  btn.type = 'button';
  wireControlHover(btn);
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
  const row = el('div', { display: 'flex', flexWrap: 'wrap', gap: SPACE.sm, marginBottom: SPACE.lg });
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
  /** Per-die wafer for Ring/Quadrant classification — a constant lookup for a
   *  single-wafer die list, or a per-die WeakMap read for the lot-pooled one
   *  (a die carries no wafer identity of its own; see `renderLotSummaryContent`). */
  getWafer?: (die: Die) => Wafer | undefined,
  ringCount?: number,
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
    getWafer,
    ringCount,
    ownerDocument,
  });
  if (section) handle.contentWrap.appendChild(section);
}

/**
 * {@link renderWaferSummaryContentSteps}, run straight through — the entry for a
 * caller that does not stage its render.
 */
export function renderWaferSummaryContent(...args: Parameters<typeof renderWaferSummaryContentSteps>): void {
  drain(renderWaferSummaryContentSteps(...args));
}

/**
 * @internal Render all wafer-level sections into a panel element, as a
 * {@link Chunked} computation. Clears existing content.
 *
 * Chunked for the same reason the lot panel is: the Test Values table walks
 * every die once per test, which on a single 400,000-die wafer is seconds of
 * uninterruptible work on the main thread. Sections are appended as they are
 * built, so the panel fills in. The synchronous entry above is this drained —
 * one implementation, not a second progressive copy.
 */
export function* renderWaferSummaryContentSteps(
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
    /** The map's resolved bin colours (`View.binColors`), so bars match die fills. */
    binColors?:   BinColors;
    /**
     * The map's active plot mode. Selects which bin type the bin breakdown opens
     * on, so the panel describes the population actually on screen — see
     * `buildBinBreakdownSection`. Omitting it falls back to whichever bin type
     * has data, which is the old (wrong-for-soft-bin-maps) behaviour.
     */
    plotMode?:    PlotMode;
    fallbackFormat?: 'si' | 'engineering';
    onFindingClick?: (finding: StatsFinding, row: HTMLButtonElement) => void;
    activeFindingId?: string | null;
    findingsFilter?: FindingsFilter;
    onFindingsFilterChange?: () => void;
    /** See {@link FindingsNotice} — a host row at the top of the Findings section. */
    findingsNotice?: FindingsNotice;
    onSaveText?: SaveTextHandler;
    /** Label/order hints for die metadata columns, e.g. `WaferMapResult.metadataFields`. */
    metadataFields?: MetadataFieldDef[];
    /** See `RenderOptions.dieList` — gates the "View die list" link below. */
    dieListOptions?: DieListDisplayOptions;
    /**
     * Suppress the "Wafer Info" metadata section because the caller already
     * renders this metadata elsewhere — `renderWaferMap` passes true whenever its
     * identity header is mounted (`showIdentity`, the default), since that
     * header's expandable panel is built from the very same
     * `metadataEntries`/`buildCompactMetadataRows` helpers.
     *
     * This mirrors a decision the lot panel already makes for itself: it omits
     * the section unconditionally because the gallery's top strip covers it (see
     * `renderLotSummaryContent`). Two copies of the same fields in a 260px column,
     * authoritative in neither place, is the thing being avoided in both cases.
     */
    metadataShownElsewhere?: boolean;
  },
): Chunked<void> {
  const savedScroll = panel.scrollTop;
  panel.innerHTML = '';
  const {
    wafer, dies, yieldSummary, dataCoverage,
    hbinDefs, sbinDefs, testDefs,
    statsSummary, passBins = [1], ringCount = 4,
    binColors, plotMode, fallbackFormat,
    onFindingClick, activeFindingId = null,
    findingsFilter, onFindingsFilterChange,
    findingsNotice,
    onSaveText, metadataFields, dieListOptions, metadataShownElsewhere,
  } = params;

  panel.appendChild(panelHeader('Wafer Summary'));

  const warnings = params.warnings ?? collectWarnings({ statsSummary });
  if (warnings.length) panel.appendChild(buildWarningsBanner(warnings, panel.ownerDocument));

  const summaryReportBtn = (yieldSummary && dataCoverage)
    ? reportButton('Summary report', () => {
        openReportModal(renderWaferReportHtml({
          wafer, dies, yield: yieldSummary, dataCoverage,
          hbinDefs, sbinDefs, testDefs,
          passBins,
          ringCount,
        }, statsSummary), { anchor: panel });
      })
    : null;

  const dieListBtn = ((dieListOptions?.enabled ?? true) && dies.length)
    ? reportButton('View die list', () => {
        openDieListModal(
          panel, dies, testDefs, `Die list — ${dies.length} dies`,
          wafer.metadata, metadataFields, dieListOptions, onSaveText,
          undefined, () => wafer, ringCount,
        );
      })
    : null;

  const reportRow = reportButtonRow(summaryReportBtn, dieListBtn);
  if (reportRow) panel.appendChild(reportRow);

  // Appended as they are built, not collected and appended at the end — see
  // the lot panel's identical `append`: the point of stepping is that the panel
  // fills in while the work runs.
  let first = true;
  const append = (section: HTMLDivElement | null): void => {
    if (!section) return;
    if (!first) panel.appendChild(separator());
    first = false;
    panel.appendChild(section);
  };

  const lotStackStats = statsSummary?.stats.isLotStack ? statsSummary.stats : undefined;
  const stacked = lotStackStats?.lotSize !== undefined
    ? { lotSize: lotStackStats.lotSize, aggrMethod: fmtAggregationMethod(lotStackStats.aggregationMethod) }
    : undefined;
  if (!metadataShownElsewhere) {
    append(buildMetadataInfoSection([{ metadata: wafer.metadata ?? undefined }], stacked));
  }

  if (yieldSummary && dataCoverage) append(buildYieldSection(yieldSummary, dataCoverage, passBins));
  yield;

  // Findings sit directly under the headline stats, not at the bottom of the
  // panel. They are the only actionable section, the only one with a badge
  // count, and they used to be reachable only after scrolling past two full
  // test tables — the panel's most important content behind its densest.
  if (statsSummary && onFindingClick && findingsFilter && onFindingsFilterChange) {
    append(buildFindingsSectionWithFilter(
      statsSummary, onFindingClick, activeFindingId, findingsFilter, onFindingsFilterChange, panel, findingsNotice,
    ));
    yield;
  }

  append(buildBinBreakdownSection({
    dies, hbinDefs, sbinDefs, binColors,
    hardCounts: statsSummary?.stats.hardBinCounts,
    softCounts: statsSummary?.stats.softBinCounts,
    plotMode, passBins, panel,
  }));
  yield;

  append(buildRegionYieldPanelSection({
    diesByWafer: [dies], allWafers: [wafer], ringCount, passBins, panel,
  }));
  yield;

  const csvIdentity: CsvExportContext | undefined = wafer.metadata ? { waferMetadata: wafer.metadata } : undefined;
  append(yield* buildTestSectionSteps(dies, testDefs, fallbackFormat, statsSummary?.stats, onSaveText, csvIdentity, [{ dies }], panel, 'compact'));
  yield;
  append(buildFunctionalTestSection(dies, testDefs, statsSummary?.stats.functionalYield, onSaveText, csvIdentity, panel));

  // Browsers ignore padding-bottom on scrollable containers. A bottom spacer
  // ensures the last finding card is not clipped when scrolled to the end.
  panel.appendChild(el('div', { height: '12px', flexShrink: '0' }));

  panel.scrollTop = savedScroll;
}

/** Render lot-level content into the panel. Clears existing content. */
/** A gallery item as the lot report reads it — every field optional, since a slot may not have loaded. */
type ReportItem = {
  label?: string; wafer?: Wafer; dies?: Die[]; passBins?: readonly number[]; ringCount?: number;
  hbinDefs?: BinDef[]; sbinDefs?: BinDef[]; testDefs?: TestDef[]; statsSummary?: StatsSummary;
};

/**
 * @internal Gallery items as report maps — the one conversion for the gallery's
 * and the lot panel's report buttons. A slot not yet loaded is skipped, but each
 * wafer keeps the label its position gives it, so a report names wafers exactly
 * as the cards do. `passBins`/`ringCount` fill in only for an item built without them.
 */
export function reportMapsFromItems(
  items: ReadonlyArray<ReportItem | null | undefined>,
  passBins: readonly number[],
  ringCount: number,
): ReportMap[] {
  const maps: ReportMap[] = [];
  items.forEach((item, i) => {
    if (!item?.wafer || !item.dies) return;
    maps.push({
      ...item,
      wafer: item.wafer,
      dies: item.dies,
      label: waferDisplayLabel(item, i),
      passBins: [...itemPassBins(item, passBins)],
      ringCount: item.ringCount ?? ringCount,
    });
  });
  return maps;
}

/**
 * {@link renderLotSummaryContentSteps}, run straight through — the entry for a
 * caller that is not staging the render across tasks.
 */
export function renderLotSummaryContent(...args: Parameters<typeof renderLotSummaryContentSteps>): void {
  drain(renderLotSummaryContentSteps(...args));
}

/**
 * @internal The lot summary panel as a {@link Chunked} computation: it pools
 * every die of every wafer and derives bin, region and per-test sections from
 * that pool, which at lot scale is the longest single piece of work anywhere in
 * this library — 15.3 s on a 50-wafer lot of 4,000 dies x 100 tests, enough for
 * the browser to offer to kill the page. Each step is one section, or one test
 * within the Test Values table, and each section is appended as it is built, so
 * the panel fills in rather than arriving at once.
 */
export function* renderLotSummaryContentSteps(
  panel: HTMLDivElement,
  params: {
    lotSummary:       LotStatsSummary;
    /** `passBins` on an item is that wafer's own (`WaferMapResult.passBins`) and wins over the top-level fallback. */
    items:            Array<ReportItem & { metadataFields?: MetadataFieldDef[] } | null>;
    hbinDefs?:        BinDef[];
    sbinDefs?:        BinDef[];
    testDefs?:        TestDef[];
    passBins?:        number[];
    ringCount?:       number;
    /** The gallery-wide bin colours, so bars match every card. */
    binColors?:       BinColors;
    /** The gallery's active plot mode — see the wafer panel's `plotMode`. */
    plotMode?:        PlotMode;
    fallbackFormat?:  'si' | 'engineering';
    onFindingClick?:  (finding: StatsFinding, row: HTMLButtonElement) => void;
    activeFindingId?: string | null;
    onWaferClick?:    (waferIndex: number) => void;
    findingsFilter?: FindingsFilter;
    onFindingsFilterChange?: () => void;
    /** See {@link FindingsNotice} — a host row at the top of the Findings section. */
    findingsNotice?: FindingsNotice;
    onSaveText?: SaveTextHandler;
    /** See the wafer panel's `warnings` — collected by the renderer so every surface agrees. */
    warnings?: WaferWarning[];
    /** See `RenderOptions.dieList` — gates the "View die list" link below. */
    dieListOptions?: DieListDisplayOptions;
    /** Per-wafer findings tally badged onto the Wafer Yield rows — see
     *  `buildPerWaferYieldSection`. */
    findingsFor?: (waferIndex: number) => { total: number; unusual: number; notable: number } | undefined;

  },
): Chunked<void> {
  const savedScroll = panel.scrollTop;
  panel.innerHTML = '';
  const {
    lotSummary, items,
    hbinDefs, sbinDefs, testDefs,
    passBins = [1], ringCount = 4,
    binColors, plotMode, fallbackFormat,
    onFindingClick, activeFindingId = null,
    onWaferClick,
    findingsFilter, onFindingsFilterChange,
    findingsNotice,
    onSaveText, dieListOptions, findingsFor,
  } = params;

  // Names the population, not an assumed lot: "Lot LOT123 · 13 wafers" only
  // when every wafer records that lot, else "26 wafers from 2 lots" / "13 wafers".
  panel.appendChild(panelHeader(`Summary — ${populationLabel(describeWaferPopulation(lotSummary.perWafer.map(pw => pw.summary.wafer)))}`));

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
    openReportModal(renderLotReportHtml(reportMapsFromItems(items, passBins, ringCount)), { anchor: panel });
  });

  const allWafers: Wafer[] = [];
  const diesByWafer: Die[][] = [];
  const allDies: Die[] = [];
  // Index-aligned with allWafers (which skips items without a wafer), for region
  // yield: each wafer's dies and that wafer's own pass bins.
  const regionDies: Die[][] = [];
  const regionPassBins: (readonly number[])[] = [];
  // Per-die wafer attribution for the lot-wide die list below — the one
  // thing only this lot-pooled context can supply, since a single die
  // carries no wafer identity of its own. waferByDie feeds Ring/Quadrant
  // classification the same way waferLabelByDie feeds the "Wafer" column.
  const waferLabelByDie = new WeakMap<Die, string>();
  const waferByDie = new WeakMap<Die, Wafer>();
  for (let i = 0; i < items.length; i++) {
    // One wafer per step: pooling is only ~100 ms for a 200,000-die lot, but it
    // is the first thing to run and a step boundary here costs nothing.
    yield;
    const item = items[i];
    if (!item) { diesByWafer.push([]); continue; }
    if (item.wafer) {
      allWafers.push(item.wafer);
      regionDies.push(item.dies ?? []);
      regionPassBins.push(itemPassBins(item, passBins));
    }
    const wd = item.dies ?? [];
    const label = waferDisplayLabel(item, i);
    for (const d of wd) {
      waferLabelByDie.set(d, label);
      if (item.wafer) waferByDie.set(d, item.wafer);
    }
    diesByWafer.push(wd);
    // A loop, not `allDies.push(...wd)`: the spread passes one argument per
    // die, and V8 throws RangeError above ~131k of them — so this failed on a
    // single wafer with more dies than that, while any lot of ordinary wafers
    // passed.
    for (const d of wd) allDies.push(d);
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
          (d) => waferByDie.get(d), ringCount,
        );
      })
    : null;

  // No separate "Findings report" button: the summary report now carries both the
  // lot-level findings and a per-wafer "Findings by Wafer" section, so a second
  // button would offer a subset of the same document. It was also asymmetric —
  // present only when some wafer had findings, and on the no-lot-stats fallback
  // path it was the ONLY report available.
  const reportRow = reportButtonRow(summaryReportBtn, dieListBtn);
  if (reportRow) panel.appendChild(reportRow);


  const perWaferSummaries = items.map(i => i?.statsSummary).filter((s): s is StatsSummary => !!s);

  // Appended as they are built, not collected and appended at the end: the
  // whole point of stepping is that the panel fills in while the work runs.
  let first = true;
  const append = (section: HTMLDivElement | null): void => {
    if (!section) return;
    if (!first) panel.appendChild(separator());
    first = false;
    panel.appendChild(section);
  };

  append(buildLotOverviewSection(lotSummary, perWaferSummaries));
  // No buildMetadataInfoSection here, unlike the single-wafer summary panel
  // (below, line ~1979) which is its OWN sole source for this. On the lot
  // path the gallery's top strip (renderWaferGallery.ts's legendEl, built
  // from the identical buildMetadataStripRow/items pair) already renders
  // this exact facet table above the grid — confirmed byte-identical
  // against a live 13-wafer lot, not assumed. A second copy here cost a
  // third of the sidebar's width for zero new information.
  yield;

  // Same reasoning as the wafer panel: findings directly under the headline
  // stats, ahead of the bin/region/test detail.
  if (onFindingClick && findingsFilter && onFindingsFilterChange) {
    append(buildFindingsSectionWithFilter(
      lotSummary, onFindingClick, activeFindingId, findingsFilter, onFindingsFilterChange, panel, findingsNotice,
    ));
    yield;
  }

  append(buildPerWaferYieldSection(lotSummary, items, onWaferClick, panel, findingsFor));
  yield;

  append(buildBinBreakdownSection({
    dies: allDies, hbinDefs, sbinDefs, plotMode, passBins, panel,
    // The gallery-wide colours when given; otherwise resolved wafer by wafer,
    // so a lot mixing test programs is judged per wafer here too.
    binColors: binColors ?? resolveBinColorsByWafer(
      items.flatMap((it) => it ? [{ dies: it.dies ?? [], passBins: itemPassBins(it, passBins) }] : []),
      { hbinDefs, sbinDefs }).colors,
  }));
  yield;

  // regionDies, not diesByWafer: diesByWafer also holds an entry for items with
  // no wafer, so its indices drift from allWafers'.
  append(buildRegionYieldPanelSection({ diesByWafer: regionDies, allWafers, ringCount, passBins: (wi) => regionPassBins[wi], panel }));
  yield;

  if (testDefs?.length) {
    append(yield* buildLotTestSectionSteps(allDies, testDefs, fallbackFormat, perWaferSummaries, onSaveText, diesByWafer.map(d => ({ dies: d })), panel, 'compact'));
    yield;
    append(buildLotFunctionalSection(allDies, testDefs, perWaferSummaries, onSaveText, panel));
  }

  panel.appendChild(el('div', { height: '12px', flexShrink: '0' }));

  panel.scrollTop = savedScroll;
}

