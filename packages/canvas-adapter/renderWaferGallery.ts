import type { PlotMode } from '../renderer/buildView.js';
import { getUniqueTestNumbers, resolveTestNumber, findTestDef, collectMetadataValues } from '../renderer/buildView.js';
import { metadataCategoricalValue } from '../core/metadata.js';
import { resolveBinColorsByWafer, binColorWarning, mixedPassBinsWarning, type BinColors } from '../renderer/binColors.js';
import { itemPassBins } from '../core/passBins.js';
import { NO_DATA_FILL } from '../renderer/colorMap.js';
import { metadataValueColor } from '../renderer/colorMap.js';
import { resolveCanvasTheme } from './canvasTheme.js';
import { ICONS } from './icons.js';
import { SHADOW, LEADING, TRACKING, controlStyle, wireControlHover, SPACE, EDGE_GUTTER, MAP_CHROME_INSET, RADIUS, FONT, CLR, sevColor, MODE_LABELS, BIN_LEGEND_MODES, STACKED_MODES, Z_ABOVE, applyOverlayZ, getTooltip, hideTooltip, createToolbarHelpers, buildModeMenuEl, openDetachWindow, openFloatingWindow, openModal, openReportModal, copyWmapThemeTokens, syncWmapPopupTheme, openUserGuideWindow, makePaletteBtn, makeLogScaleBtn, makeLegendStyleBtn, makeOverlaysBtn, makeOrientationBtn, menuLayerFor, saveImageBlob, markMenuTrigger, wireMenuA11y, wireExpandToggle, wireTooltip, requestedPassFailDisplay, overlayMenuRows, anyOverlayActive, logWmapVersionOnce, type ModeEntry, type SaveImageHandler, type SaveTextHandler, type CheckMenuRow, type UserGuideExtension, type OverlayHandle , buildDataModeEntries, metadataKeyHasData, metadataModeEntry} from './toolbar.js';
import { waferDisplayLabel } from '../core/waferLabel.js';
import { sortBinsForDisplay } from '../stats/binPareto.js';
import { diePassStatus, type Die } from '../core/dies.js';
import { aggregateValues, aggregateBinCounts } from '../core/aggregates.js';
import type { AggregationMethod } from '../core/aggregates.js';
import { renderWaferMap, renderWaferMapCard, toPublicViewOptions } from './renderWaferMap.js';
import type { WaferViewOptions, WaferMapController, CardViewOptions, CardController } from './renderWaferMap.js';
import { classifyChanged, COLOR_KEYS } from './renderWaferMap.js';
import type { RenderableWaferMap } from './renderWaferMap.js';
import type { BinDef } from '../renderer/buildWaferMap.js';
import { buildWaferMap, getTestPassStatus, isParametricTest, getDieTestValue } from '../renderer/buildWaferMap.js';
import type { LotStatsSummary, StatsFinding, StatsSummary } from '../stats/types.js';
import { analyzeWaferMap } from '../stats/analyzeWaferMap.js';
import { collectWarnings, buildWarningsMenuEl, severityOf, type WarningsOptions, type WaferWarning } from './warnings.js';
import { compareNatural } from '../core/utils.js';
import type { SummaryPanelOptions, FindingsNotice } from './summaryPanel.js';
import { createSummaryPanelEl, buildMetadataStripRow, buildCompactMetadataRows, metadataEntries, renderLotSummaryContent } from './summaryPanel.js';
import { renderLotSummaryReportHtml } from '../stats/renderSummaryReport.js';
import type { FindingsFilter } from '../stats/filterFindings.js';
import { prettyKey } from '../stats/facets.js';
import type { TestDef } from '../renderer/buildWaferMap.js';
import { mergeTestDefs } from '../stats/mergeTestDefs.js';
import type { MergedTestDefs } from '../stats/mergeTestDefs.js';
// TYPE-ONLY — see renderWaferMap.ts's identical import for why. The chart
// suite is fetched on first open, not shipped in the initial /render chunk.
import type { InsightsOptions, InsightsTabHandle } from './insightsTab.js';
import type { DieListDisplayOptions } from './dieList.js';
import { getDieKey, hasPosition } from '../core/dies.js';

// ── Public types ───────────────────────────────────────────────────────────────

/**
 * The data and display overrides for a single gallery card.
 *
 * `WaferMapResult` satisfies this interface structurally, so you can pass
 * `buildWaferMap(...)` results directly. Spread in display overrides as needed:
 *
 * ```ts
 * renderWaferGallery(container, [
 *   result1,
 *   { ...result2, label: 'W02', statsSummary: summary2 },
 * ]);
 * ```
 */
export interface WaferMapDisplayItem extends RenderableWaferMap {
  // Everything above the per-card overrides below comes from RenderableWaferMap:
  // `wafer` and `dies` required, and every other WaferMapResult field optional —
  // hbinDefs/sbinDefs/testDefs/metadataFields/reticles, the geometry `warnings`
  // the gallery collects into the lot bar's indicator, and the isLotStack/
  // aggrMethod/lotSize stack context that drives the map title's
  // "(N wafers · method)" qualifier.
  //
  // This used to restate a hand-picked subset of those fields. The two lists
  // drifted — renderWaferMap reads `dataCoverage`, `viewport`, `legendBox`,
  // `binLegendRows` and `reticleConfig` off the item, none of which were
  // declared here, and the gallery bridged the gap with `item as WaferMapResult`.
  // Extending the render function's own input type means a card is, by
  // construction, something renderWaferMap can accept.

  // Per-card display overrides.
  label?:        string;
  /** Merged on top of the shared gallery options for this card only. */
  viewOptions?:  Partial<WaferViewOptions>;
  /** Shown in the findings panel when this card is opened in its own window. */
  statsSummary?: import('../stats/types.js').StatsSummary;
  onClick?:      (die: Die, event: MouseEvent) => void;
  onSelect?:     (dies: Die[]) => void;

}

/**
 * A factory function that builds a WaferMapDisplayItem on demand.
 * The gallery calls each factory in a deferred task (`setTimeout(0)`) so the
 * browser stays responsive while large item sets are built progressively.
 */
export type WaferMapDisplayItemFactory = () => WaferMapDisplayItem;

export interface GalleryOptions {
  /** Initial shared scene options applied to all cards. */
  viewOptions?:         WaferViewOptions;
  /** Called whenever a shared gallery option changes. */
  onViewOptionsChange?: (
    opts:     WaferViewOptions,
    changed:  (keyof WaferViewOptions)[],
    category: 'preference' | 'state' | 'mixed',
  ) => void;
  /**
   * Draw a legend on every card as well as the lot-level one. Default false.
   *
   * The lot legend already names every bin and is interactive, so per-card
   * legends are off by default and the cards spend that width on the wafer.
   * Turn this on when per-card bin highlighting matters more than card size.
   *
   * Ignored — cards always keep their own — when the plot mode is `value` with
   * `colorbarRangeMode: 'data'`, where each card is scaled to its own range and
   * a shared legend could not describe it. The toolbar shows the toggle
   * disabled with that reason rather than appearing to do nothing.
   */
  perCardLegend?:        boolean;
  /** Filename stem for the composite gallery PNG. Default 'wafer-gallery'. */
  downloadFilename?:     string;
  /**
   * Host hook for persisting the composite gallery PNG. When provided, the save
   * action calls `onSaveImage(blob, suggestedName)` instead of triggering a
   * browser `<a download>` — letting embedded hosts (Tauri, Electron, WebView2)
   * route the image through a native save dialog. `suggestedName` includes the
   * `.png` extension and is derived from `downloadFilename`. When omitted, the
   * default browser download behaviour is unchanged.
   */
  onSaveImage?:          SaveImageHandler;
  /**
   * Host hook for saving the Summary/Insights test-values table's "Export CSV"
   * button. Mirrors `onSaveImage` — when provided, called with
   * `(text, suggestedName, mimeType)` instead of triggering a browser
   * `<a download>` (a silent no-op in Tauri/Electron/WebView2). When omitted,
   * the default browser download behaviour is unchanged.
   */
  onSaveText?:           SaveTextHandler;
  /** Precomputed lot-level stats summary. Enables the summary panel toggle button in the control bar. */
  lotStatsSummary?:        LotStatsSummary;
  /**
   * Options for the always-available Summary panel alongside the gallery
   * grid — a "Lot" tab with full lot-level stats (metadata, yield, bin
   * breakdown, ring/quadrant yield, test values, findings) and a combined
   * Report button, plus a "Findings" tab listing every wafer that has its own
   * per-wafer findings (click a row to open that wafer). Independent of
   * `insights` below: this always shows/hides its own toolbar button
   * regardless of whether Insights is open, since Insights has no per-wafer
   * map for a finding to highlight against.
   */
  summaryPanel?:           SummaryPanelOptions;
  /**
   * A row at the top of the Findings section stating that a category of finding
   * is not present, and optionally offering to compute it — see
   * {@link FindingsNotice}. wmap never raises this itself: only the host knows
   * what analysis it chose to skip and what running it would cost. Replaceable
   * afterwards via the controller's `setFindingsNotice`.
   */
  findingsNotice?: FindingsNotice;
  /**
   * Display preferences for the lot-wide "View die list" link inside the
   * Summary panel — every die across every wafer, pooled, with a Wafer
   * column and CSV export. **On by default** whenever `summaryPanel` is
   * reachable at all, since that panel is the link's only home; pass
   * `{ enabled: false }` to hide it. See `DieListDisplayOptions` and wmap's
   * own coordinate-less die-list table, which this reuses.
   */
  dieList?:                DieListDisplayOptions;
  /**
   * Fix the number of columns in the gallery grid. When set, overrides the
   * auto-computed minimum card width and the toolbar columns control.
   * Omit (default) to let the gallery auto-size cards based on die pitch.
   */
  columns?:                number;
  /**
   * Show a help button in the gallery control bar that opens the built-in end-user guide in a modal.
   * Default false. Enable in applications that want to surface the guide without linking externally.
   */
  showHelpButton?:         boolean;
  /**
   * Host-supplied content inserted into the built-in end-user guide window
   * (see `showHelpButton`) — e.g. a host app's own documentation, so the user
   * has one help button instead of two. See `UserGuideExtension`.
   */
  userGuideExtension?:     UserGuideExtension;
  /**
   * Base `z-index` for wmap's transient overlays — toolbar menus, the die
   * tooltip, the expand modal, and the user-guide modal. wmap layers its own
   * overlays from this value upward. Set this when embedding the gallery inside
   * your own modal/overlay so wmap's menus and tooltips appear above it.
   *
   * Omit it and wmap defaults overlays to a high value (above typical app modal
   * layers). Applied for the lifetime of this render and restored on `destroy()`.
   */
  zIndex?:                 number;
  /**
   * Show an "Insights" tab in the control bar (see `InsightsOptions`).
   * Selecting it replaces the gallery grid with wmap's own chart suite
   * across Overview/Distributions/Correlation sub-tabs. The tab computes
   * its own "Group by" facets from each item's `wafer.metadata`
   * (`stats/facets.ts`) and, when `lotStatsSummary` is also provided,
   * reuses its precomputed per-wafer yield directly rather than
   * recomputing it — no other host wiring beyond this option.
   */
  insights?:               InsightsOptions;
  /**
   * Built-in surfacing of the library's own data warnings (see `WarningsOptions`).
   * Defaults on. The gallery collects across every item and de-duplicates, so a
   * geometry advisory affecting the whole lot is stated once, not per card.
   */
  warnings?:               WarningsOptions;
}

export interface GalleryController {
  /** Replace all items — destroys existing cards and rebuilds the grid. Accepts pre-built items, factory functions, or a mix. */
  setItems(items: Array<WaferMapDisplayItem | WaferMapDisplayItemFactory>): void;
  /** Merge shared scene option overrides across all cards. */
  setOptions(opts: Partial<WaferViewOptions>): void;
  /** Return the current shared scene options. */
  getOptions(): WaferViewOptions;
  /** Replace the lot-level stats summary used by the built-in Summary panel. */
  setLotStatsSummary(summary: LotStatsSummary | undefined): void;
  /**
   * Replace the lot Findings-section notice (see `FindingsNotice`). Pass
   * `undefined` to clear it once the offered analysis has been run.
   */
  setFindingsNotice(notice: FindingsNotice | undefined): void;
  /**
   * Opens the built-in end-user guide window — the same action the help
   * toolbar button performs, but callable directly. Works regardless of
   * `showHelpButton`'s current value, so a host that hides wmap's own help
   * button (e.g. to fold it into its own combined help menu) can still
   * trigger the guide without a DOM query against wmap's internal button
   * markup.
   */
  openUserGuide(): void;
  /** Remove all DOM and event listeners. */
  destroy(): void;
}


// ── Helpers ───────────────────────────────────────────────────────────────────

function deduplicateDefs(defs: BinDef[]): BinDef[] {
  const seen = new Set<number>();
  return defs.filter(d => seen.has(d.bin) ? false : (seen.add(d.bin), true));
}

/**
 * A single stacked proportional bar — the population split at a glance.
 *
 * Chosen over one bar per bin because this legend is a horizontal strip: per-bin
 * bars would cost a row each and turn a two-line strip into a small chart, which
 * is the Insights bin pareto's job. One bar adds a single row and answers the
 * only question the strip is missing — "how is the population divided" — while
 * leaving the swatch order alone.
 *
 * Segments are ordered by descending count, so the bar reads as a pareto even
 * though the swatches above stay in bin order. Every segment gets a themed
 * tooltip; a segment too thin to see still carries its own, so a rare bin is
 * findable rather than merely present.
 */
/** Segments drawn individually before the tail is rolled into "Other". Past a
 *  dozen the bar stops being readable — every extra segment is a sliver — and
 *  the rolled-up tail says more than a row of invisible slices. Every bin still
 *  appears with its own count in the swatch rows above, so nothing is hidden. */
const SHARE_BAR_MAX_SEGMENTS = 12;

function buildShareBar(
  doc: Document,
  allSegments: Array<{ color: string; count: number; label: string }>,
  total: number,
): HTMLElement {
  // Caller sorts descending, so the tail is genuinely the smallest.
  let segments = allSegments;
  if (allSegments.length > SHARE_BAR_MAX_SEGMENTS) {
    const head = allSegments.slice(0, SHARE_BAR_MAX_SEGMENTS - 1);
    const tail = allSegments.slice(SHARE_BAR_MAX_SEGMENTS - 1);
    const tailCount = tail.reduce((sum, sg) => sum + sg.count, 0);
    segments = [...head, {
      // Neutral, so it can't be mistaken for a bin colour on the map.
      color: CLR.label,
      count: tailCount,
      label: `Other (${tail.length} bins)`,
    }];
  }
  const bar = doc.createElement('div');
  Object.assign(bar.style, {
    // A 1px gap marks where each segment ends. Segments sit in die-count order,
    // not palette order, so any two palette colours can end up side by side, and
    // at 8px tall the dark ones (black, indigo #332288, teal #225555, brown
    // #663333) run together without a divider, as do the pass greens. The
    // gap is transparent rather than a token-coloured border, so it is always
    // the strip's own ground in either theme. It adds to the 2px segment floor
    // below rather than eating into it, so a sliver bin stays visible.
    display: 'flex', columnGap: '1px', width: '100%', height: '8px', borderRadius: RADIUS.control,
    overflow: 'hidden', border: `1px solid ${CLR.menuBorder}`, boxSizing: 'border-box',
    marginTop: SPACE.xs, flexShrink: '0' } as Partial<CSSStyleDeclaration>);
  bar.setAttribute('role', 'img');
  bar.setAttribute('aria-label',
    `Population split: ${segments.map(sg => `${sg.label} ${fmtLegendPercent((sg.count / total) * 100)}`).join(', ')}`);

  for (const seg of segments) {
    const pct = (seg.count / total) * 100;
    const cell = doc.createElement('div');
    Object.assign(cell.style, {
      // Proportional grow, NOT `flex: 0 0 <pct>%`. With a fixed percentage
      // basis the min-width below is additive on top of a basis already summing
      // to 100%, so a long tail of tiny segments overflows the bar and
      // `overflow: hidden` silently clips the rarest bins — the exact ones
      // worth seeing. Growing from a zero basis lets flexbox honour every
      // min-width and take the difference out of the largest segment instead.
      flex: `${pct} 1 0`,
      // A floor so a sub-pixel share stays visible and hoverable: a bin holding
      // three dies out of 200k is what someone scans a yield strip to find.
      minWidth: pct > 0 ? '2px' : '0',
      background: seg.color } as Partial<CSSStyleDeclaration>);
    wireTooltip(cell, `${seg.label} · ${seg.count.toLocaleString()} dies · ${fmtLegendPercent(pct)}`);
    bar.appendChild(cell);
  }
  return bar;
}

/**
 * Percentage for a legend row. Two decimals below 0.01% would be noise, but a
 * bin holding a handful of dies out of 100k must not read as "0.0%" — a rare
 * failure mode is exactly what someone scans this strip for — so anything
 * non-zero that would round to zero is shown as "<0.1%".
 */
function fmtLegendPercent(pct: number): string {
  if (pct > 0 && pct < 0.1) return '<0.1%';
  return `${pct.toFixed(1)}%`;
}

/**
 * Tally dies per legend category across the visible cards.
 *
 * The population rule is NOT a local choice: `partial` and `edgeExcluded` dies
 * are painted as no-data/excluded grey rather than their bin colour
 * (buildView.ts's `EDGE_EXCLUDED_FILL`), so counting them would make this strip
 * disagree both with what is on the map and with the Summary panel, which
 * scopes bin counts to `isYieldEligibleDie`. It is the same rule buildView
 * already applies to its own per-card legend tallies, stated in one place there
 * and matched here.
 *
 * Deliberately recomputed from the visible items rather than read from
 * `lotStatsSummary`: the gallery can be showing a filtered subset of the
 * analysed lot, and a pooled precomputed total would then describe a
 * population that isn't on screen.
 */
function countLegendPopulation<K>(
  items: readonly WaferMapDisplayItem[],
  keyOf: (die: Die) => K | undefined,
  /**
   * When given, also counts the dies in this population that pass, each judged
   * by its OWN item's pass bins (`diePassStatus`, the rule yield uses) — so the
   * strip's yield shares the swatches' exact denominator.
   */
  passBinsOf?: (item: WaferMapDisplayItem) => readonly number[],
): { counts: Map<K, number>; total: number; pass: number } {
  const counts = new Map<K, number>();
  let total = 0, pass = 0;
  for (const item of items) {
    const passSet = passBinsOf ? new Set(passBinsOf(item)) : undefined;
    for (const die of item.dies) {
      if (die.partial || die.edgeExcluded) continue;
      const k = keyOf(die);
      if (k === undefined) continue;
      counts.set(k, (counts.get(k) ?? 0) + 1);
      total++;
      if (passSet && diePassStatus(die, passSet)) pass++;
    }
  }
  return { counts, total, pass };
}

/**
 * One clickable swatch+label row in the gallery's DOM legend strip — shared by the bin
 * (hardBin/softBin) and metadata legend branches in `rebuildLegend()` so the two can never
 * drift apart in markup/styling.
 */
function renderLegendSwatchRow(
  container: HTMLElement,
  opts: {
    color: string; label: string; isActive: boolean; onClick: () => void;
    /** Dies in this category, over the same population the map paints — see
     *  `countLegendPopulation`. Omitted only when there is genuinely nothing to
     *  count. */
    count?: number;
    /** Share of the legend population, 0–100. Shown beside the count. */
    percent?: number;
  },
): void {
  const entry = container.ownerDocument.createElement('div');
  Object.assign(entry.style, {
    display: 'flex', alignItems: 'center', gap: '5px', cursor: 'pointer',
    userSelect: 'none', padding: `${SPACE.xxs} ${SPACE.xs}`, borderRadius: RADIUS.control });

  const swatch = container.ownerDocument.createElement('span');
  Object.assign(swatch.style, {
    display: 'inline-block', width: '13px', height: '13px', flexShrink: '0',
    background: opts.color,
    border: opts.isActive ? `2px solid ${CLR.iconActive}` : `1px solid ${CLR.menuBorder}`,
    borderRadius: RADIUS.control, boxSizing: 'border-box' });

  const lbl = container.ownerDocument.createElement('span');
  lbl.textContent = opts.label;
  Object.assign(lbl.style, {
    fontWeight: opts.isActive ? '700' : '400',
    color:      opts.isActive ? CLR.iconActive : CLR.text,
    whiteSpace: 'nowrap' });

  entry.appendChild(swatch);
  entry.appendChild(lbl);

  // Count and share. A per-card canvas legend already prints a count
  // (toCanvas.ts's LegendSwatch); this strip printed neither, so a gallery
  // shown without a Summary panel and without Insights — both optional, and
  // the panel only auto-mounts when the host supplies lotStatsSummary or a
  // wafer has findings — had NO surface anywhere stating the population split.
  // The share is this strip's own addition: a card legend identifies colours on
  // one wafer, where a percentage means little, while the lot strip's job is
  // precisely "how is the population divided".
  if (opts.count !== undefined) {
    const countEl = container.ownerDocument.createElement('span');
    countEl.textContent = opts.count.toLocaleString();
    Object.assign(countEl.style, {
      color: opts.isActive ? CLR.iconActive : CLR.text,
      fontWeight: opts.isActive ? '700' : '400',
      whiteSpace: 'nowrap' } as Partial<CSSStyleDeclaration>);
    entry.appendChild(countEl);

    if (opts.percent !== undefined) {
      const pctEl = container.ownerDocument.createElement('span');
      pctEl.textContent = fmtLegendPercent(opts.percent);
      Object.assign(pctEl.style, { color: CLR.label, whiteSpace: 'nowrap' } as Partial<CSSStyleDeclaration>);
      entry.appendChild(pctEl);
    }
  }

  entry.setAttribute('role', 'button');
  entry.setAttribute('aria-pressed', opts.isActive ? 'true' : 'false');
  entry.tabIndex = 0;
  entry.addEventListener('mouseenter', () => { entry.style.background = CLR.bgHover; });
  entry.addEventListener('mouseleave', () => { entry.style.background = 'transparent'; });
  entry.addEventListener('focus', () => { entry.style.background = CLR.bgHover; });
  entry.addEventListener('blur',  () => { entry.style.background = 'transparent'; });
  entry.addEventListener('click', opts.onClick);
  entry.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); opts.onClick(); }
  });

  container.appendChild(entry);
}

// ── Main export ───────────────────────────────────────────────────────────────

export function renderWaferGallery(
  container: HTMLElement,
  items: Array<WaferMapDisplayItem | WaferMapDisplayItemFactory>,
  options: GalleryOptions = {},
): GalleryController {
  logWmapVersionOnce();
  const cardPadding          = 6;   // CSS px inside each card canvas
  const downloadFilename     = options.downloadFilename     ?? 'wafer-gallery';
  let currentColumns         = options.columns;
  const showHelpButton       = options.showHelpButton       ?? false;
  const userGuideExtension   = options.userGuideExtension;
  const insightsEnabled      = options.insights?.enabled ?? false;
  // Host-supplied overlay stacking (no-op when undefined; safe high default
  // applies). Restored on destroy() via the returned disposer.
  const disposeOverlayZ      = applyOverlayZ(options.zIndex);
  const summaryPanelOpts      = options.summaryPanel;
  // Each wafer is judged by its own pass bins, carried on the item
  // (`WaferMapResult.passBins`). There is no gallery-level option: one list for
  // the whole gallery is wrong the moment it holds wafers from two programs.
  const passBinsOf = (item: WaferMapDisplayItem | null | undefined): number[] => [...itemPassBins(item)];
  // Ring count likewise lives on each item (`WaferMapResult.ringCount`): every card
  // and every wafer's own analysis uses its own. Lot-level ring figures (Summary
  // panel, report, Insights) need one, and take the first wafer's; wafers built
  // with different ring counts are named by `ring-count-mixed` rather than pooled
  // silently under one wafer's definition of "Ring 2".
  const itemRingCounts = (): number[] => originalItems.flatMap(it => it ? [it.ringCount ?? 4] : []);
  const lotRingCount = (): number => itemRingCounts()[0] ?? 4;
  function mixedRingCountWarning(counts: number[]): WaferWarning | null {
    const distinct = [...new Set(counts)].sort((a, b) => a - b);
    if (distinct.length < 2) return null;
    return {
      code: 'ring-count-mixed',
      severity: 'warning',
      message: `These wafers were built with different ring counts (${distinct.join(', ')}). Each card and each `
        + `wafer's findings use their own; the lot's ring yield in the Summary panel, report and Insights uses `
        + `${counts[0]} rings.` };
  }
  let currentLotStats        = options.lotStatsSummary;
  let currentLegendStyle     = options.viewOptions?.legendPosition ?? 'default' as 'default' | 'compact' | 'bottom' | 'top' | 'left' | 'floating';

  // Whether each card draws its own legend. Off by default: the lot legend
  // below the toolbar shows the same bins and is itself interactive — clicking
  // a row highlights that bin across every card — so a per-card copy costs
  // roughly a third of each card's width to duplicate a control the user
  // already has. Turning this on restores per-card legends, whose distinct
  // value is highlighting a bin on one card independently of the rest.
  //
  // See perCardLegendBlockedReason for the case where this cannot apply.
  let perCardLegend = options.perCardLegend ?? false;

  /**
   * Why the per-card-legend toggle cannot take effect right now, or null.
   *
   * A data-ranged colorbar is normalised to each card's *own* min/max, so the
   * cards are not on a common scale and no lot-level bar can describe them.
   * Suppressing them would leave thirteen differently-scaled maps with one
   * legend that matches none of them — actively misleading rather than merely
   * terse. A spec-ranged colorbar comes from the test's limits, which are the
   * same for every card, so it has no such problem.
   */
  function perCardLegendBlockedReason(): string | null {
    const mode = sharedOpts.plotMode ?? 'hardBin';
    // The lot-level strip (legendEl/rebuildLegend) only ever draws bin
    // swatches — hardBin/softBin/metadata. Value mode's legend is a colorbar,
    // which that strip has no equivalent for at all, spec-ranged or not: this
    // used to check colorbarRangeMode === 'data' specifically (true when each
    // card is scaled to its own range, so no shared bar could describe them),
    // but a SPEC-ranged value gallery has an identical range on every card and
    // was still wrongly let through — suppressing every card's colorbar with
    // nothing standing in for it, gallery-wide. The real dividing line is
    // simply whether BIN_LEGEND_MODES has a lot-level row for this mode.
    if (!BIN_LEGEND_MODES.has(mode)) {
      return sharedOpts.colorbarRangeMode === 'data'
        ? 'Each map has its own value range, so it keeps its own colour bar'
        : 'These wafers have no shared colour bar for value mode, so each map keeps its own';
    }
    return null;
  }

  /** Push the effective per-card legend state to every card. */
  function applyPerCardLegend(): void {
    const showLegend = perCardLegend || perCardLegendBlockedReason() !== null;
    for (const ctrl of cardControllers) if (ctrl) ctrl.setOptions({ showLegend });
  }

  let sharedOpts: CardViewOptions = {
    plotMode:               'hardBin',
    showDieLabels:               false,
    showRingBoundaries:     false,
    showQuadrantBoundaries: false,
    rotation:               0,
    flipX:                  false,
    flipY:                  false,
    ...options.viewOptions };

  let cardControllers: (CardController | null)[] = [];
  let cardContainers: HTMLDivElement[] = [];      // canvasWrapper per card
  let cardExpandBtns: HTMLButtonElement[] = [];   // per-card header button — toggles expand/reattach
  let currentItems:  WaferMapDisplayItem[] = [];
  // Per-wafer source items; null = factory not yet resolved. Populated from `items`
  // immediately (not lazily before buildCards) so findings-gated UI decided during
  // this function's own setup — e.g. the Lot Summary button/panel's "any item
  // carries per-wafer findings" check below — sees real data for plain (non-factory)
  // items instead of an empty array that hasn't been filled in yet.
  let originalItems: (WaferMapDisplayItem | null)[] =
    items.map(it => (typeof it === 'function' ? null : it) as WaferMapDisplayItem);

  /**
   * The population's ONE test namespace — see `stats/mergeTestDefs.ts`.
   *
   * Every site below used to write `originalItems.find(it => it?.testDefs?.length)`,
   * i.e. borrow one arbitrary wafer's list and apply its names, units and limits
   * to every other wafer's values. `TestDef.testNumber` identifies a test within
   * a test program, so across a multi-program load that pooled unrelated
   * measurements under one number and normalised them against the wrong limits.
   *
   * Deliberately recomputed on each call rather than cached: `originalItems` is
   * filled in lazily by card factories, so any cache key cheap enough to be worth
   * keeping would be stale exactly when a late-arriving wafer introduces the
   * collision. The merge is a linear pass over defs the caller already holds.
   */
  function mergedTestDefs(): MergedTestDefs {
    return mergeTestDefs(originalItems);
  }

  /**
   * The reconciled lot-wide test list, or `undefined` when NO item supplied any
   * test definitions at all.
   *
   * The distinction matters and used to be lost. Returning `undefined` for an
   * empty list conflated "nobody described any tests" with "every test was
   * withheld because the files disagree" — and the two consumers that fall back
   * to discovering raw test numbers from the dies (`buildDataModeEntries` and
   * the stacked-value builder) then did exactly that in the second case,
   * reintroducing every withheld number as "Test 1001" and pooling one lot's
   * nanoamps with another's millivolts under it. The withholding was undone by
   * its own success. An empty array now means "reconciled to nothing", which no
   * fallback may override.
   */
  function lotTestDefs(): TestDef[] | undefined {
    if (!originalItems.some(it => it?.testDefs?.length)) return undefined;
    return mergedTestDefs().defs;
  }
  let buildGeneration = 0;  // incremented on each buildCards call; stale factory callbacks check this
  // Tracked separately from `cardControllers` containing nulls, since a detached
  // card's controller is ALSO null (its live view is in a popup window instead)
  // — conflating the two would make updateShared() think a factory is still
  // resolving whenever any card is merely detached, silently skipping the
  // immediate stacked-mode rebuild it should otherwise take.
  let pendingFactoryCount = 0;

  // A card can be detached into its own real OS window (via window.open, or a
  // host-registered opener — see setDetachWindowOpener) rather than an in-page
  // div, so it can be dragged outside the host browser/Tauri window's own
  // bounds. Several may be open at once, so state is keyed by a generated
  // window id rather than by card index (indices shift whenever buildCards()
  // rebuilds the grid, e.g. on a stacked-mode transition). The popup's
  // controller is a FRESH renderWaferMap() instance (not the grid card's
  // original one) — the grid slot's own controller is destroyed at detach time
  // and only rebuilt on reattach, so exactly one live controller ever exists
  // for a given wafer at a time.
  interface DetachedWindow {
    id: number;
    ctrl: CardController;      // live controller rendered inside the detached document
    close: () => void;            // tears down the window/floating box and calls handlePopupClosed
    closePollId: ReturnType<typeof setInterval> | null; // real popup only — null for the in-page fallback
    setTitle: (text: string) => void; // updates whatever "title" this detach target has (OS title, or an in-page header)
    // null once buildCards() can no longer place this window's card in the
    // rebuilt grid ("unlinked") — this is the single source of truth for that
    // state; there is deliberately no separate boolean flag, since one would
    // only ever duplicate what cardIndex's null-ness already says.
    cardIndex: number | null;
    label: string;
    // Real popup only (separate document, one-time theme-token copy) — tears
    // down the observer/listener that keep it in sync with later host theme
    // changes. Undefined for the in-page floating-window fallback, which
    // shares the host's own document and so inherits --wmap-* changes live.
    stopThemeSync?: () => void;
  }
  const detachedWindows = new Map<number, DetachedWindow>();
  let nextWindowId = 0;


  let btnLotSummary: HTMLButtonElement | null = null;
  let activeLotFindingId: string | null = null;
  // Finding-highlight state: indices of cards implicated by the summary-panel
  // finding the user is currently inspecting (outlined until they clear it).
  let findingHighlightIndices = new Set<number>();

  // Findings sidebar state
  let gallerySummaryPanelEl: HTMLDivElement | null = null;
  // 'lot' = lot-level findings (requires currentLotStats)
  // 'wafers' = per-wafer findings index (requires items with statsSummary)
  let lotFindingsFilter: FindingsFilter = {};

  // ── Per-wafer summary helpers ─────────────────────────────────────────────

  // Resolve the per-wafer StatsSummary for a given item index.
  // Falls back to lotStatsSummary.perWafer so a single analyzeWaferLot call
  // is sufficient — no separate analyzeWaferMap per item required.
  function perWaferSummary(index: number): StatsSummary | undefined {
    return originalItems[index]?.statsSummary
      ?? currentLotStats?.perWafer.find(pw => pw.waferIndex === index)?.summary;
  }

  // True when any wafer has per-wafer findings, either on the item or in the lot summary.
  function hasAnyPerWaferFindings(): boolean {
    if (originalItems.some(it => it?.statsSummary?.findings.length)) return true;
    if (currentLotStats?.perWafer.some(pw => pw.summary.findings.length)) return true;
    return false;
  }

  // ── Toolbar helpers ────────────────────────────────────────────────────────

  // Shared document-level singleton tooltip (toolbar.ts) — the same node every
  // card's renderWaferMap uses, so only one tooltip is ever visible at a time.
  const tooltip = getTooltip();
  const tbHelpers = createToolbarHelpers(tooltip);
  const { makeBtn, setActive, makeSep, makeMenuRow, makeMenuSection, makeDropdown, closeOpenMenu, getOpenMenu, setOpenMenu } = tbHelpers;
  // container.ownerDocument, not the bare global — matches renderWaferMap.ts's
  // own fix for the same gap (see its comment): a host could in principle
  // mount the gallery into a container that belongs to a different document.
  container.ownerDocument.addEventListener('click', closeOpenMenu, true);
  // Window focus loss (alt-tab / app switch, notably in a Tauri WebView) does
  // not fire mouseleave, which would leave a toolbar tooltip lingering visible.
  const onWindowBlur = () => hideTooltip();
  window.addEventListener('blur', onWindowBlur);

  // Host-supplied row at the top of the lot Findings section — see FindingsNotice.
  let currentFindingsNotice: FindingsNotice | undefined = options.findingsNotice;

  function applyFindingHighlight(indices: number[]): void {
    findingHighlightIndices = new Set(indices);
    const cards = [...gridEl.querySelectorAll<HTMLElement>('.wmap-gallery-card')];
    let firstHighlighted: HTMLElement | undefined;
    cards.forEach((card, i) => {
      const active = findingHighlightIndices.has(i);
      card.style.outline       = active ? `3px solid ${CLR.findingHighlight}` : '';
      card.style.outlineOffset = active ? '-3px' : '';
      if (active && firstHighlighted === undefined) firstHighlighted = card;
    });
    firstHighlighted?.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' });
  }

  function clearFindingHighlight(): void {
    applyFindingHighlight([]);
  }

  function clearDieZoneHighlight(): void {
    for (const ctrl of cardControllers) if (ctrl) ctrl.clearSelection();
  }

  function applyDieZoneHighlight(dieKeys: string[], cardIndices?: number[]): void {
    const keySet = new Set(dieKeys);
    const targets = cardIndices ?? cardControllers.map((_, i) => i);
    for (const ci of targets) {
      const item = currentItems[ci];
      const ctrl = cardControllers[ci];
      if (!item || !ctrl) continue;
      const matched = item.dies.filter(d => keySet.has(getDieKey(d)));
      ctrl.setSelection(matched);
    }
  }

  // ── Gallery summary panel ──────────────────────────────────────────────────

  // Per-wafer findings index — the panel's ENTIRE content in the one case the
  // lot panel cannot cover: no `lotStatsSummary`, so there is no `perWafer`
  // series for the Wafer Yield section to list and no lot stats to show. When lot
  // stats DO exist this is not rendered at all; the findings counts appear as
  // badges on the Wafer Yield rows instead (see `buildPerWaferYieldSection`),
  // which is one list rather than two and includes the wafers that have no
  // findings — the ones this subset list structurally cannot show.
  /** Wafers that have at least one per-wafer finding, with their severity tallies. */
  function wafersWithFindings(): Array<{ index: number; item: WaferMapDisplayItem; unusualCount: number; notableCount: number; totalCount: number }> {
    const out: Array<{ index: number; item: WaferMapDisplayItem; unusualCount: number; notableCount: number; totalCount: number }> = [];
    for (let i = 0; i < originalItems.length; i++) {
      const item = originalItems[i];
      if (!item) continue;
      const findings = perWaferSummary(i)?.findings ?? [];
      if (!findings.length) continue;
      out.push({
        index: i,
        item,
        unusualCount: findings.filter(f => f.severity === 'unusual').length,
        notableCount: findings.filter(f => f.severity === 'notable').length,
        totalCount:   findings.length });
    }
    return out;
  }

  /** Open a wafer by index — the Wafer Yield rows only know the index, while
   *  `openWindowForCard` wants the item too. */
  function openWindowForCardIndex(cardIndex: number): void {
    const item = currentItems[cardIndex] ?? originalItems[cardIndex];
    if (item) openWindowForCard(cardIndex, item);
  }

  /** Per-wafer findings tally for one wafer, for the Wafer Yield rows' badges. */
  function findingsTallyFor(index: number): { total: number; unusual: number; notable: number } | undefined {
    const findings = perWaferSummary(index)?.findings ?? [];
    if (!findings.length) return undefined;
    return {
      total:   findings.length,
      unusual: findings.filter(f => f.severity === 'unusual').length,
      notable: findings.filter(f => f.severity === 'notable').length };
  }

  /** The full lot summary report — stats, split comparison, lot findings AND a
   *  per-wafer findings section. Reached from the no-lot-stats fallback list
   *  below; the lot panel builds its own via `renderLotSummaryContent`. */
  function openLotSummaryReport(): void {
    const lotHbinDefs = deduplicateDefs(originalItems.flatMap(it => it?.hbinDefs ?? []));
    const lotSbinDefs = deduplicateDefs(originalItems.flatMap(it => it?.sbinDefs ?? []));
    openReportModal(renderLotSummaryReportHtml({
      items: originalItems.map((item, i) => ({
        label:        waferDisplayLabel(item, i),
        wafer:        item?.wafer,
        dies:         item?.dies,
        passBins:     passBinsOf(item),
        statsSummary: item?.statsSummary })),
      hbinDefs: lotHbinDefs.length ? lotHbinDefs : undefined,
      sbinDefs: lotSbinDefs.length ? lotSbinDefs : undefined,
      testDefs: lotTestDefs(),
      ringCount: lotRingCount() }), { anchor: container });
  }

  function renderPerWaferIndexFallback(): void {
    if (!gallerySummaryPanelEl) return;
    gallerySummaryPanelEl.innerHTML = '';

    const wafers = wafersWithFindings();

    // State the denominator. The list is a subset by design; saying so is what
    // stops it reading as the full wafer list.
    if (originalItems.length > 0) {
      const heading = container.ownerDocument.createElement('div');
      const withCount = wafers.length;
      const total = originalItems.filter(Boolean).length;
      heading.textContent = withCount === 0
        ? `No findings on any of the ${total} wafers`
        : `${withCount} of ${total} wafer${total === 1 ? '' : 's'} with findings`;
      Object.assign(heading.style, {
        fontSize: FONT.body, color: CLR.label, marginBottom: SPACE.md } as Partial<CSSStyleDeclaration>);
      gallerySummaryPanelEl.appendChild(heading);
    }

    if (wafers.length > 0) {
      const reportBtn = container.ownerDocument.createElement('button');
      reportBtn.type = 'button';
      // The same report the lot panel offers, not a findings-only variant. This
      // path runs when the host passed no `lotStatsSummary`, and it used to be the
      // one place a "Findings report" existed at all — so the panel offered a
      // different export depending on whether lot stats happened to be supplied.
      // `renderLotSummaryReportHtml` computes `analyzeWaferLot` itself, so it needs
      // no precomputed lot stats; the work stays lazy, on click, which is why a
      // host that deliberately skipped lot analysis is not charged for it here.
      reportBtn.textContent = 'Summary report';
      Object.assign(reportBtn.style, {
        ...controlStyle('outlined'),
        marginBottom: SPACE.lg,
        display:      'block',
        width:        '100%',
        textAlign:    'left' });
      wireControlHover(reportBtn);
      reportBtn.addEventListener('click', openLotSummaryReport);
      gallerySummaryPanelEl.appendChild(reportBtn);
    }

    // Wafer rows
    if (wafers.length === 0) {
      const empty = container.ownerDocument.createElement('div');
      Object.assign(empty.style, { color: CLR.icon, fontSize: FONT.body, padding: '4px 0' });
      empty.textContent = 'No findings on any wafer.';
      gallerySummaryPanelEl.appendChild(empty);
    } else {
      for (const { index, item, unusualCount, notableCount, totalCount } of wafers) {
        const topSeverity: 'unusual' | 'notable' | 'info' =
          unusualCount ? 'unusual' : notableCount ? 'notable' : 'info';
        // Badge shows notable+unusual count if any exist, otherwise total findings count
        const badgeCount = (unusualCount + notableCount) || totalCount;

        const row = container.ownerDocument.createElement('button');
        row.type = 'button';
        Object.assign(row.style, {
          display:        'flex',
          alignItems:     'center',
          justifyContent: 'space-between',
          width:          '100%',
          padding:        '5px 8px',
          marginBottom: SPACE.xs,
          border:         'none',
          borderLeft:     `3px solid ${sevColor(topSeverity)}`,
          borderRadius:   RADIUS.control,
          background:     CLR.bgHover,
          cursor:         'pointer',
          fontSize:       FONT.body,
          textAlign:      'left',
          boxSizing:      'border-box' });
        row.addEventListener('mouseover', () => { row.style.background = CLR.bgActive; });
        row.addEventListener('mouseout',  () => { row.style.background = CLR.bgHover; });

        const labelSpan = container.ownerDocument.createElement('span');
        labelSpan.textContent = waferDisplayLabel(item, index);
        Object.assign(labelSpan.style, {
          color:         CLR.iconHover,
          overflow:      'hidden',
          textOverflow:  'ellipsis',
          whiteSpace:    'nowrap' });

        const badge = container.ownerDocument.createElement('span');
        badge.textContent = String(badgeCount);
        // The bare number said nothing about what it counted. The row is a
        // button, so its accessible name is what a screen reader announces —
        // spell the whole thing out there rather than leaving "W08, 8".
        row.setAttribute('aria-label',
          `${waferDisplayLabel(item, index)} — ${badgeCount} finding${badgeCount === 1 ? '' : 's'}`
          + `${unusualCount ? `, ${unusualCount} unusual` : ''} — view wafer`);
        Object.assign(badge.style, {
          marginLeft: SPACE.sm,
          flexShrink:   '0',
          background:   sevColor(topSeverity),
          color:        '#fff',
          borderRadius: RADIUS.container,
          padding:      '1px 5px',
          fontSize:     FONT.body,
          fontWeight:   '600' });

        row.appendChild(labelSpan);
        row.appendChild(badge);
        // Open this wafer in its own window — openWindowForCard already calls setSummaryVisible(true)
        row.addEventListener('click', () => openWindowForCard(index, item));
        gallerySummaryPanelEl.appendChild(row);
      }
    }

    // Bottom spacer so last row isn't clipped when scrolled
    const spacer = container.ownerDocument.createElement('div');
    spacer.style.height = '12px';
    gallerySummaryPanelEl.appendChild(spacer);
  }

  function renderGallerySummaryPanel(): void {
    if (!gallerySummaryPanelEl) return;

    // One panel, no tabs. The old Lot/Findings tab pair put a findings list in
    // BOTH tabs (lot-level in "Lot", none at all in "Findings" — which listed
    // wafers) and gave two identical-looking per-wafer lists two different click
    // actions. The per-wafer list now lives inside the lot panel as badges on the
    // Wafer Yield rows.
    if (currentLotStats) {
      // Lot-level view — full stats (metadata/yield/bin/ring/quadrant/test
      // values) plus findings and a combined Report button. Bin/ring/
      // quadrant/test numbers here and in the Insights tab's Overview
      // sub-tab intentionally read the same shared computation
      // (`buildRegionYieldData`, `StatsSummary.stats.*` — see
      // summaryPanel.ts's header comment), so the two surfaces can overlap
      // without ever disagreeing.
      const lotHbinDefs = deduplicateDefs(originalItems.flatMap(it => it?.hbinDefs ?? []));
      const lotSbinDefs = deduplicateDefs(originalItems.flatMap(it => it?.sbinDefs ?? []));
      renderLotSummaryContent(gallerySummaryPanelEl, {
        lotSummary: currentLotStats,
        items:      originalItems,
        hbinDefs:   lotHbinDefs.length ? lotHbinDefs : undefined,
        sbinDefs:   lotSbinDefs.length ? lotSbinDefs : undefined,
        testDefs:   lotTestDefs(),
        ringCount:      lotRingCount(),
        binColors:      sharedOpts.binColors,
        // See renderWaferMap's equivalent — the lot bin breakdown follows the
        // gallery's active plot mode.
        plotMode:       sharedOpts.plotMode ?? 'hardBin',
        fallbackFormat: sharedOpts.fallbackFormat,
        activeFindingId: activeLotFindingId,
        warnings: (options.warnings?.display ?? true) ? currentWarnings : [],
        findingsFilter: lotFindingsFilter,
        findingsNotice: currentFindingsNotice,
        onFindingsFilterChange: renderGallerySummaryPanel,
        onSaveText: options.onSaveText,
        onFindingClick: (finding, row) => {
          if (activeLotFindingId === finding.id) {
            clearLotFindingHighlight();
          } else {
            applyLotFindingHighlight(finding, row);
          }
          renderGallerySummaryPanel();
        },
        // Opens the wafer, which is what the row's own accessible name has always
        // claimed. It previously only highlighted the card in the grid — a weak
        // payoff for a click, and a promise the label did not keep.
        onWaferClick: openWindowForCardIndex,
        findingsFor: findingsTallyFor,
        dieListOptions: options.dieList });
    } else {
      renderPerWaferIndexFallback();
    }
  }

  /** The cards a finding is about, or `null` when it does not name any (in
   *  which case there is no honest subset to scope a withheld test to). */
  function findingWaferIndices(finding: StatsFinding): number[] | null {
    const h = finding.highlight as { kind?: string; waferIndices?: number[] };
    return h?.kind === 'wafer' && h.waferIndices?.length ? h.waferIndices : null;
  }

  function findingFingerprint(f: StatsFinding): string {
    return [
      f.variable.kind,
      f.variable.index ?? '',
      f.variable.bin ?? '',
      f.comparison.family,
      f.comparison.left,
      f.effect.direction,
    ].join('|');
  }

  /** Cards a finding put into value mode on a WITHHELD test, so it can be
   *  taken back off it. See `applyLotFindingHighlight`. */
  let findingScopedCards: number[] = [];

  /** Return any finding-scoped cards to whatever the gallery as a whole is
   *  showing. Reads `sharedOpts` rather than a saved snapshot: the shared mode
   *  is what every other card is on, so this can never leave one card behind. */
  function restoreFindingScopedCards(): void {
    if (findingScopedCards.length === 0) return;
    for (const i of findingScopedCards) {
      cardControllers[i]?.setOptions({
        plotMode: sharedOpts.plotMode, activeTest: sharedOpts.activeTest,
      });
    }
    findingScopedCards = [];
  }

  function clearLotFindingHighlight(): void {
    activeLotFindingId = null;
    clearFindingHighlight();
    clearDieZoneHighlight();
    restoreFindingScopedCards();
    updateShared({ highlightBin: undefined }, { fireCallback: false });
  }

  function applyLotFindingHighlight(finding: StatsFinding, row: HTMLButtonElement): void {
    // Toggle off if already active.
    if (activeLotFindingId === finding.id) {
      clearLotFindingHighlight();
      return;
    }

    activeLotFindingId   = finding.id;
    row.style.background = CLR.bgActive;
    row.style.fontWeight = '600';

    // Switch to the mode that makes this finding's data visible.
    // Don't set highlightBin — the die zone selection overlay already shows the affected
    // dies, and highlightBin dims everything else making the map look empty.
    restoreFindingScopedCards();
    const { kind, index } = finding.variable;
    if (kind === 'test') {
      const testNumber = index ?? 0;
      // A finding comes from PER-WAFER analysis, which reads that wafer's own
      // testDefs — so its test number is meaningful for the wafers it names and
      // not necessarily for any other. Switching the whole gallery to it was an
      // unguarded write of `activeTest` that bypassed every reconciliation the
      // merged list performs: click a `leakage` finding raised on one lot's
      // wafers and every card plots its own `testValues[1001]`, which in a lot
      // that calls 1001 `vth_n_mV` is a different physical quantity in
      // different units, laid out as though it were one comparison.
      //
      // So: switch the whole gallery only when the population actually agrees
      // about this test (it survived `mergeTestDefs`). Otherwise switch only the
      // wafers the finding is about — they come from files that do agree, so the
      // test is unambiguous for them — and leave everything else alone.
      // `lotTestDefs()` (not `mergedTestDefs()`) so "nobody supplied any test
      // definitions" reads as agreement, not disagreement: with nothing to
      // reconcile there is nothing to contradict, and treating that as a
      // collision would silently downgrade every finding click to per-card
      // scoping for the many hosts that pass no `testDefs` at all.
      const reconciled = lotTestDefs();
      const agreed = reconciled === undefined || reconciled.some(d => d.testNumber === testNumber);
      if (agreed) {
        updateShared({ plotMode: 'value', activeTest: testNumber, highlightBin: undefined }, { fireCallback: false });
      } else {
        updateShared({ highlightBin: undefined }, { fireCallback: false });
        // A withheld test with no wafer list has no honest target at all, so
        // the plot mode is left exactly as it was rather than defaulting to the
        // lot-wide switch — that default is the whole bug.
        //
        // Nor is there one in a stacked mode: the cards are then aggregates over
        // the whole lot, not wafers, so a finding's `waferIndices` do not index
        // them and poking `cardControllers[i]` would put a STACK into value mode
        // on the very test the lot cannot agree about — aggregating one lot's
        // nanoamps with another's millivolts per die position.
        const stacked = STACKED_MODES.has(sharedOpts.plotMode ?? 'hardBin');
        const scopeTo = stacked ? null : findingWaferIndices(finding);
        if (scopeTo) {
          for (const i of scopeTo) {
            cardControllers[i]?.setOptions({ plotMode: 'value', activeTest: testNumber });
          }
          findingScopedCards = [...scopeTo];
        }
      }
    } else if (kind === 'softBin') {
      updateShared({ plotMode: 'softBin', highlightBin: undefined }, { fireCallback: false });
    } else {
      updateShared({ plotMode: 'hardBin', highlightBin: undefined }, { fireCallback: false });
    }

    // Clear all card outlines and die zone selections before applying new ones.
    clearFindingHighlight();
    clearDieZoneHighlight();

    const h = finding.highlight;
    if (h.kind === 'wafer') {
      applyFindingHighlight(h.waferIndices);
      // For repeated-pattern findings, highlight the actual die zones on the
      // affected cards using each card's matching per-wafer finding's dieKeys.
      const fp = findingFingerprint(finding);
      for (const ci of h.waferIndices) {
        const item = currentItems[ci];
        const perWaferFinding = item?.statsSummary?.findings.find(
          f => findingFingerprint(f) === fp,
        );
        const dieKeys = (perWaferFinding?.highlight as { dieKeys?: string[] } | undefined)?.dieKeys;
        if (dieKeys?.length) applyDieZoneHighlight(dieKeys, [ci]);
      }
    } else if (h.kind === 'bin') {
      if (h.dieKeys?.length) applyDieZoneHighlight(h.dieKeys);
    } else if (h.kind === 'region' || h.kind === 'dies') {
      if (h.dieKeys?.length) applyDieZoneHighlight(h.dieKeys);
    }
  }

  function refreshLotSummaryButton(): void {
    if (!btnLotSummary) return;
    const hasSummaryPanel = !!gallerySummaryPanelEl;
    btnLotSummary.style.display = ((currentLotStats || hasAnyPerWaferFindings()) && hasSummaryPanel && !insightsOpen) ? 'flex' : 'none';
    const panelOpen = gallerySummaryPanelEl
      ? gallerySummaryPanelEl.style.display !== 'none'
      : false;
    const hasNotable = currentLotStats?.hasNotableFindings
      || originalItems.some(it => it?.statsSummary?.hasNotableFindings);
    if (hasNotable && !panelOpen) {
      btnLotSummary.style.color = CLR.findingIndicator;
    } else if (!btnLotSummary.dataset.active) {
      btnLotSummary.style.color = CLR.icon;
    }
  }

  // ── Gallery control bar ────────────────────────────────────────────────────

  const barEl = container.ownerDocument.createElement('div');
  barEl.dataset.wmapToolbar = 'gallery';
  Object.assign(barEl.style, {
    // Last item in `chromeRowEl`, after the identity pill — which, being
    // `flex: 1`, pushes this to the trailing edge. That placement is what stops
    // the Insights toggle moving: the bar is shrink-to-fit, so when the
    // grid-specific controls hide on entering Insights it collapses from ~330px
    // to ~80px, and while it was left-anchored that dragged every button at its
    // right end ~250px leftward. Anchored to the trailing edge it shrinks away
    // from that edge instead of toward it, and the controls that survive into
    // Insights do not move at all.
    //
    // `flexShrink: 0` gives the toolbar priority over the identity text when
    // the row runs short: every control here must stay hittable at any width,
    // while the identity degrades gracefully via its own "+N more".
    //
    // It also aligns the two views' chrome, which is the point: the Insights
    // suite is the same content in both, differing only in how many wafers fed
    // it, so its surrounding frame should not be arranged differently depending
    // on which view opened it.
    flexShrink:    '0',
    // Holds the trailing edge even when the identity pill is hidden — a lot
    // with no metadata at all renders no pill, and without this the toolbar
    // would fall back to the left of the row and sit in a different place than
    // in every other gallery. With the pill present this is a no-op, since a
    // `flex: 1` sibling already absorbs the free space.
    marginLeft:    'auto',
    display:       'inline-flex',
    flexDirection: 'row',
    alignItems:    'center',
    gap:           '0',
    background:    CLR.menuBg,
    border:        `1px solid ${CLR.menuBorder}`,
    // `RADIUS.control` and no padding — the same toolbar renderWaferMap and each
    // gallery card already render. This one was a container-radius, 36px-tall
    // variant of a 30px control-radius bar, so the identical cluster of icon
    // buttons had two sizes and two corner depths depending on which renderer
    // mounted it.
    borderRadius:  RADIUS.control,
    padding:       '0',
    boxShadow:     SHADOW.panel,
    flexWrap:      'wrap',
    minWidth:      '0',
    overflowX:     'auto' });

  const closeModeMenu = (): void => {
    const m = getOpenMenu();
    if (m) { m.remove(); setOpenMenu(null); }
    markMenuTrigger(btnMode, false);
  };
  const btnMode = makeBtn('mode', 'Plot mode', () => {
    if (getOpenMenu()) { closeModeMenu(); return; }

    // Use originalItems (per-wafer source) — currentItems may be aggregated cards
    // in stacked modes, which don't accurately reflect the full data availability.
    const dies      = originalItems.flatMap(it => it?.dies ?? []);
    const testDefs  = lotTestDefs();
    // Value mode is available for any per-test data — numeric values or recorded
    // pass/fail verdicts (functional tests). Stacked values need numeric values.
    // Gallery aggregates across its own items, so stacked modes are always offered.
    const { testEntries: rawTestEntries, binEntries, stackedEntries } =
      buildDataModeEntries(dies, testDefs, { includeStacked: true });

    // Say how many wafers actually carry each test.
    //
    // A gallery's active test is lot-wide, but a test is not: across a mixed
    // load a test number can exist in one lot and nowhere else, and picking it
    // then renders every other card empty with no explanation. That is honest —
    // empty means no data — but it reads as a broken grid, and it is at its
    // most confusing exactly when reconciliation has withheld the numbers the
    // lots SHARE, leaving the menu offering the ones unique to a single lot.
    // Naming the coverage turns "why is everything blank" into a fact stated
    // before the click rather than a puzzle after it.
    const waferCount = originalItems.filter(Boolean).length;
    const coverageOf = (testNumber: number | undefined): number => {
      if (testNumber === undefined) return waferCount;
      let n = 0;
      for (const it of originalItems) {
        if (it?.dies?.some(d => getTestPassStatus(d, testNumber) !== undefined || d.testValues?.[testNumber] !== undefined)) n++;
      }
      return n;
    };
    const testEntries: ModeEntry[] = waferCount < 2 ? rawTestEntries : rawTestEntries.map(e => {
      const covered = coverageOf(e.activeTest);
      return covered === waferCount ? e : { ...e, label: `${e.label} — ${covered} of ${waferCount} wafers` };
    });

    const currentMode    = sharedOpts.plotMode ?? 'hardBin';
    const currentTestIdx = sharedOpts.activeTest ?? 0;

    function isCurrentEntry(e: ModeEntry): boolean {
      if (e.plotMode !== currentMode) return false;
      if (e.plotMode === 'value') return currentTestIdx === (e.activeTest ?? 0);
      if (e.plotMode === 'metadata') return sharedOpts.activeMetadataKey === e.activeMetadataKey;
      return true;
    }

    function pickEntry(entry: ModeEntry, menu: HTMLElement): void {
      if (entry.activeTest !== undefined) {
        updateShared({ plotMode: 'value', activeTest: entry.activeTest, activeMetadataKey: undefined, logScale: entry.logScale });
      } else if (entry.activeMetadataKey !== undefined) {
        updateShared({ plotMode: entry.plotMode, activeTest: undefined, activeMetadataKey: entry.activeMetadataKey, passFailDisplay: 'off' });
      } else {
        // Leaving value mode → clear spec pass/fail (only valid in value mode), matching single-map.
        updateShared({ plotMode: entry.plotMode, activeTest: undefined, activeMetadataKey: undefined, passFailDisplay: 'off' });
      }
      menu.remove();
      setOpenMenu(null);
      markMenuTrigger(btnMode, false);
    }

    // One entry per configured metadataFields[].key actually present across the
    // lot (opt-in, never auto-detected — see MetadataFieldDef). Deduplicated by
    // key, first item's def wins, mirroring the hbinDefs/sbinDefs dedup pattern
    // used elsewhere in this file (e.g. itemsHaveCustomColors's neighbours).
    const seenMetadataKeys = new Set<string>();
    const metadataModeEntries: ModeEntry[] = originalItems
      .flatMap(it => it?.metadataFields ?? [])
      .filter(f => !seenMetadataKeys.has(f.key) && seenMetadataKeys.add(f.key))
      .filter(f => metadataKeyHasData(dies, f.key))
      .map(metadataModeEntry);

    const menu = buildModeMenuEl(
      btnMode.getBoundingClientRect(),
      testEntries, binEntries, stackedEntries,
      isCurrentEntry, pickEntry,
      { makeMenuRow, makeMenuSection },
      currentMode,
      btnMode.ownerDocument.defaultView ?? window,
      metadataModeEntries,
    );
    menuLayerFor(btnMode).appendChild(menu);
    setOpenMenu(menu);
    markMenuTrigger(btnMode, true);
    wireMenuA11y(menu, btnMode, closeModeMenu);
  });
  markMenuTrigger(btnMode, false);

  const itemsHaveDefinedBinColors = (): boolean =>
    currentItems.flatMap(it => it ? [...(it.hbinDefs ?? []), ...(it.sbinDefs ?? [])] : []).some(d => d.color);

  const { btn: btnPalette, sync: syncPaletteBtn } = makePaletteBtn(
    tbHelpers,
    () => ({ ...sharedOpts, plotMode: sharedOpts.plotMode ?? 'hardBin' }),
    itemsHaveDefinedBinColors,
    partial => updateShared(partial),
  );
  syncPaletteBtn();

  const hasReticleInItems = items.some(it => typeof it !== 'function' && ((it as WaferMapDisplayItem).reticles?.length ?? 0) > 0);

  // Resolve the shared active test's def (the one all value cards show) — gates the
  // pass/fail display entries, the "Colorbar range" button, and the log-scale button,
  // mirroring single-map.
  function activeTestDefShared(): { testNumber: number; td: import('../renderer/buildWaferMap.js').TestDef | undefined } {
    const testDefs = lotTestDefs();
    const { testNumber } = resolveTestNumber(sharedOpts.activeTest ?? 0, testDefs);
    return { testNumber, td: findTestDef(testDefs, testNumber) };
  }
  function activeTestHasLimits(): boolean {
    if ((sharedOpts.plotMode ?? 'hardBin') !== 'value') return false;
    const { td } = activeTestDefShared();
    return td !== undefined && (td.limitLow !== undefined || td.limitHigh !== undefined);
  }
  function activeTestIsFunctional(): boolean {
    if ((sharedOpts.plotMode ?? 'hardBin') !== 'value') return false;
    const { td } = activeTestDefShared();
    return td !== undefined && !isParametricTest(td);
  }
  function activeTestHasRecordedStatus(): boolean {
    if ((sharedOpts.plotMode ?? 'hardBin') !== 'value') return false;
    const { testNumber, td } = activeTestDefShared();
    return originalItems.some(it => it?.dies?.some(d => getTestPassStatus(d, testNumber, td) !== undefined));
  }

  /**
   * Lot-wide min/max for the active test's 'data' colour range in plain `value`
   * mode — every card must be compared on one shared scale, not each auto-scaled
   * to only its own dies (see TODO.md, "Gallery value-mode colour range...").
   *
   * Returns undefined when a spec-anchored range applies instead: the active
   * test's limits are identical for every card already, so buildView's own
   * per-card spec-range handling is already consistent lot-wide and needs no
   * override here. Also undefined for a functional test (no scalar to range).
   */
  function sharedDataValueRange(testNumber: number, td: import('../renderer/buildWaferMap.js').TestDef | undefined): [number, number] | undefined {
    if (!td || !isParametricTest(td)) return undefined;
    const hasLimits = td.limitLow !== undefined || td.limitHigh !== undefined;
    const effectiveSpecDisplay = requestedPassFailDisplay(sharedOpts) === 'spec' && hasLimits;
    const colorbarRangeMode = effectiveSpecDisplay ? 'spec' : (sharedOpts.colorbarRangeMode ?? 'spec');
    if (colorbarRangeMode === 'spec' && hasLimits) return undefined;
    let lo = Infinity, hi = -Infinity;
    for (const item of originalItems) {
      if (!item) continue;
      for (const die of item.dies) {
        const v = getDieTestValue(die, testNumber);
        if (v !== undefined) {
          if (v < lo) lo = v;
          if (v > hi) hi = v;
        }
      }
    }
    if (!isFinite(lo)) return undefined;
    return lo === hi ? [lo, lo + 1] : [lo, hi];
  }

  /**
   * The lot-wide metadata value order for the active metadata key, or undefined
   * outside `metadata` mode. Every card colours from this ONE list, so a wafer
   * that happens not to carry one of the values still paints the others in the
   * colours the shared legend names — see `ViewOptions.metadataValueOrder`.
   */
  function sharedMetadataValueOrder(): CardViewOptions['metadataValueOrder'] {
    if ((sharedOpts.plotMode ?? 'hardBin') !== 'metadata') return undefined;
    const key = sharedOpts.activeMetadataKey;
    if (!key) return undefined;
    const distinct = new Set<string>();
    for (const item of originalItems) {
      if (!item) continue;
      for (const value of collectMetadataValues(item.dies, key)) distinct.add(value);
    }
    // Re-sorted after the union: each item's list is ordered within itself, but
    // concatenating ordered lists does not give an ordered list.
    return { key, values: [...distinct].sort(compareNatural) };
  }

  /** Recomputes that order and pushes it to every live card. Paired with
   *  `syncSharedValueRange` — same trigger points, same shape, including its
   *  early return: outside `metadata` mode there is nothing to push, and
   *  pushing `undefined` anyway costs a full `rebuildView()` + re-render on
   *  every card, on every toolbar change and every resolved item. The one case
   *  that must still write is LEAVING metadata mode, where the stale order has
   *  to be cleared — hence "already undefined", not "not in metadata mode". */
  function syncSharedMetadataOrder(): void {
    const next = sharedMetadataValueOrder();
    if (next === undefined && sharedOpts.metadataValueOrder === undefined) return;
    sharedOpts = { ...sharedOpts, metadataValueOrder: next };
    for (const ctrl of cardControllers) if (ctrl) ctrl.setOptions({ metadataValueOrder: next });
  }

  /**
   * Recomputes the shared value-mode range and pushes it to every live card.
   * Called whenever the active test, colour-range mode, pass/fail display, or
   * the underlying item data (new/resolved items) changes. A no-op outside
   * plain `value` mode — stacked modes own `sharedOpts.valueRange` themselves
   * via `stackedSharedOpts`, and bin/metadata modes don't read it at all.
   */
  function syncSharedValueRange(): void {
    if ((sharedOpts.plotMode ?? 'hardBin') !== 'value') return;
    const { testNumber, td } = activeTestDefShared();
    const range = sharedDataValueRange(testNumber, td);
    const next: WaferViewOptions['valueRange'] = range ? { test: testNumber, range } : undefined;
    sharedOpts = { ...sharedOpts, valueRange: next };
    for (const ctrl of cardControllers) if (ctrl) ctrl.setOptions({ valueRange: next });
  }

  // Coalesced variant for the incremental-load path. Each resolving factory used
  // to call `syncSharedValueRange` directly, and that rescans every die of every
  // wafer AND re-renders every card — so a gallery loading n wafers did O(n²)
  // work, all of it discarded except the last pass. Factories typically resolve
  // in bursts within a frame, so one sync per frame gives the same result.
  let sharedRangeSyncPending = false;
  function scheduleSharedValueRangeSync(): void {
    if (sharedRangeSyncPending) return;
    sharedRangeSyncPending = true;
    const raf = container.ownerDocument.defaultView?.requestAnimationFrame
      ?? ((cb: FrameRequestCallback) => setTimeout(() => cb(0), 0) as unknown as number);
    raf(() => { sharedRangeSyncPending = false; syncSharedValueRange(); syncSharedMetadataOrder(); syncSharedBinColors(); });
  }

  /**
   * Bin colours resolved ONCE over every wafer in the gallery — the bin
   * counterpart of `sharedMetadataValueOrder`. Palette colours are keyed by bin
   * number, so they would agree per card anyway; what per-card resolution would
   * lose is the rest of the population: a `BinDef.color` supplied by one item
   * would colour that bin on its own card only, and `shared` (the colour-clash
   * warning) would describe one wafer rather than the gallery on screen. The
   * original items are the population even in a stacked mode: stacked maps are
   * value maps and draw no bin colours.
   *
   * Each wafer's dies are judged by that wafer's OWN pass bins. Hard bins that
   * pass on one wafer and fail on another are recorded in `lotMixedPassBins` for
   * the `pass-bins-mixed` warning — one colour cannot be right for both.
   */
  let lotMixedPassBins: number[] = [];
  function lotBinColors(): BinColors {
    const lotHbinDefs = deduplicateDefs(originalItems.flatMap(it => it?.hbinDefs ?? []));
    const lotSbinDefs = deduplicateDefs(originalItems.flatMap(it => it?.sbinDefs ?? []));
    const { colors, mixedHardBins } = resolveBinColorsByWafer(
      originalItems.flatMap(it => it ? [{ dies: it.dies, passBins: passBinsOf(it) }] : []),
      {
        binColorScheme: sharedOpts.binColorScheme,
        useDefinedBinColors: sharedOpts.useDefinedBinColors,
        hbinDefs: lotHbinDefs,
        sbinDefs: lotSbinDefs });
    lotMixedPassBins = mixedHardBins;
    return colors;
  }

  /** Re-resolve the gallery-wide bin colours and push them to every live card —
   *  on every change to the item set, same trigger points as the value range. */
  function syncSharedBinColors(): void {
    const next = lotBinColors();
    sharedOpts = { ...sharedOpts, binColors: next };
    for (const ctrl of cardControllers) if (ctrl) ctrl.setOptions({ binColors: next });
    // lotBinColors() just re-derived which bins are mixed-pass across the loaded
    // wafers; the warning must follow it, not wait for an unrelated refresh.
    // Only ever reached from a frame callback, after the warning UI exists.
    refreshGalleryWarnings();
  }

  const btnOverlays = makeOverlaysBtn(
    tbHelpers,
    (): CheckMenuRow[] => overlayMenuRows(
      sharedOpts,
      hasReticleInItems,
      {
        functionalActive: activeTestIsFunctional(),
        hasLimits: activeTestHasLimits() && !activeTestIsFunctional(),
        hasRecorded: activeTestHasRecordedStatus() && !activeTestIsFunctional(),
        binMode: (sharedOpts.plotMode ?? 'hardBin') === 'hardBin'
              || (sharedOpts.plotMode ?? 'hardBin') === 'softBin',
      },
      patch => updateShared(patch),
    ),
    () => anyOverlayActive(sharedOpts),
  );

  const { btn: btnLegendStyle, sync: syncLegendStyleBtn } = makeLegendStyleBtn(
    tbHelpers,
    () => ({ plotMode: sharedOpts.plotMode, legendPosition: currentLegendStyle }),
    (v) => {
      currentLegendStyle = v;
      for (const ctrl of cardControllers) if (ctrl) ctrl.setOptions({ legendPosition: currentLegendStyle });
    },
    {
      get: () => perCardLegend,
      set: (v) => { perCardLegend = v; applyPerCardLegend(); },
      blockedReason: perCardLegendBlockedReason },
  );
  syncLegendStyleBtn();

  const AGGR_METHOD_ITEMS: Array<{ value: string; label: string }> = [
    { value: 'mean',   label: 'Mean' },
    { value: 'median', label: 'Median' },
    { value: 'stddev', label: 'Std Dev' },
    { value: 'min',    label: 'Min' },
    { value: 'max',    label: 'Max' },
    { value: 'count',  label: 'Count' },
  ];

  const btnAggrMethod = makeDropdown(
    'aggr', 'Aggregation method',
    () => AGGR_METHOD_ITEMS,
    () => sharedOpts.aggregationMethod ?? 'mean',
    v => updateShared({ aggregationMethod: v }),
  );
  function syncAggrMethodBtn(): void {
    const isStackedValues = sharedOpts.plotMode === 'stackedValues';
    btnAggrMethod.style.display = isStackedValues ? '' : 'none';
  }
  syncAggrMethodBtn();

  const { btn: btnLogScale, sync: syncLogScaleBtn } = makeLogScaleBtn(
    tbHelpers,
    () => ({ ...sharedOpts, functionalActive: activeTestIsFunctional() }),
    patch => updateShared(patch),
  );
  syncLogScaleBtn();

  // Colorbar range (spec limits ↔ data extents) — value mode only, when the active test has limits
  // and we are not colouring by spec pass/fail (where the bar is irrelevant). Mirrors single-map.
  const btnColorbarRange = makeBtn('specRange', 'Colorbar range: spec limits', () => {
    const next = sharedOpts.colorbarRangeMode === 'data' ? 'spec' : 'data';
    updateShared({ colorbarRangeMode: next });
  });
  function syncColorbarRangeBtn(): void {
    // No colorbar exists under a solid pass/fail display or a functional active test.
    const visible = (sharedOpts.plotMode ?? 'hardBin') === 'value' && activeTestHasLimits() &&
      requestedPassFailDisplay(sharedOpts) === 'off' && !activeTestIsFunctional();
    btnColorbarRange.style.display = visible ? '' : 'none';
    const isSpec = (sharedOpts.colorbarRangeMode ?? 'spec') === 'spec';
    setActive(btnColorbarRange, isSpec);
    btnColorbarRange.ariaLabel = isSpec
      ? 'Colorbar range: spec limits (click for data range)'
      : 'Colorbar range: data range (click for spec limits)';
  }
  syncColorbarRangeBtn();

  const btnOrient = makeOrientationBtn(
    tbHelpers,
    () => sharedOpts,
    patch => updateShared(patch),
  );
  const btnDownloadAll = makeBtn('downloadAll', 'Download gallery PNG', downloadGalleryPng);

  type ColsValue = '1' | '2' | '3' | '4' | '5' | 'auto';
  const btnColumns = makeDropdown(
    'columns', 'Columns',
    () => [
      { value: 'auto' as ColsValue, label: 'Auto' },
      { value: '1'    as ColsValue, label: '1 column' },
      { value: '2'    as ColsValue, label: '2 columns' },
      { value: '3'    as ColsValue, label: '3 columns' },
      { value: '4'    as ColsValue, label: '4 columns' },
      { value: '5'    as ColsValue, label: '5 columns' },
    ],
    () => (currentColumns != null ? String(currentColumns) as ColsValue : 'auto'),
    (v) => setColumnsState(v === 'auto' ? undefined : Number(v)),
  );

  // Grid-view-specific controls (mode, palette, overlays, columns, download,
  // etc.) — wrapped so they can be hidden as a group while the Insights tab
  // is open, since none of them apply to (or, for download, would silently
  // capture the wrong thing from) the chart suite. Summary/Insights/Help
  // below stay unwrapped directly in barEl since those apply to both views.
  const galleryViewControlsEl = container.ownerDocument.createElement('div');
  Object.assign(galleryViewControlsEl.style, { display: 'inline-flex', alignItems: 'center', gap: '0' });
  barEl.appendChild(galleryViewControlsEl);

  galleryViewControlsEl.appendChild(btnMode);
  galleryViewControlsEl.appendChild(btnPalette);
  galleryViewControlsEl.appendChild(btnAggrMethod);
  galleryViewControlsEl.appendChild(btnLogScale);
  galleryViewControlsEl.appendChild(btnColorbarRange);
  galleryViewControlsEl.appendChild(makeSep());
  galleryViewControlsEl.appendChild(btnOverlays);
  galleryViewControlsEl.appendChild(makeSep());
  galleryViewControlsEl.appendChild(btnLegendStyle);
  galleryViewControlsEl.appendChild(makeSep());
  galleryViewControlsEl.appendChild(btnOrient);
  galleryViewControlsEl.appendChild(makeSep());
  galleryViewControlsEl.appendChild(btnColumns);
  galleryViewControlsEl.appendChild(makeSep());
  galleryViewControlsEl.appendChild(btnDownloadAll);

  // Summary button — toggles the gallery Summary panel. Left unwrapped
  // in barEl (not grouped with galleryViewControlsEl), but still hidden
  // while Insights is open (refreshLotSummaryButton checks insightsOpen) —
  // its panel sits behind the Insights grid with no visible effect there,
  // matching every other view-specific control.
  // Shown when lotStatsSummary is provided, or when any item carries per-wafer findings.
  {
    if (currentLotStats || hasAnyPerWaferFindings()) {
      btnLotSummary = makeBtn('findings', 'Summary panel', () => {
        if (!gallerySummaryPanelEl) return;
        const isOpen = gallerySummaryPanelEl.style.display !== 'none';
        if (!isOpen) renderGallerySummaryPanel();
        gallerySummaryPanelEl.style.display = isOpen ? 'none' : 'flex';
        setActive(btnLotSummary!, !isOpen);
        refreshLotSummaryButton();
      });
      barEl.appendChild(makeSep());
      barEl.appendChild(btnLotSummary);
    }
  }

  // Warning indicator — one per gallery, not one per card. The same geometry
  // advisory legitimately fires on every wafer of a lot; twenty identical
  // badges would bury the one that differs, so collectWarnings de-duplicates
  // and the lot bar states each distinct problem once.
  let btnWarnings: HTMLButtonElement | null = null;
  let btnWarningsSep: HTMLDivElement | null = null;
  let currentWarnings: WaferWarning[] = [];
  let warningsNotified = false;

  function refreshGalleryWarnings(): void {
    const next = collectWarnings({
      lotStatsSummary: currentLotStats,
      // Per-item geometry advisories live on the items themselves — each card is
      // a built WaferMapResult, so `warnings` is already on it.
      // Test-def collisions are a property of the POPULATION, not of any one
      // wafer, so they have no per-item `warnings` array to live on — they join
      // here, and collectWarnings de-duplicates and severity-orders them with
      // the geometry advisories exactly as it does everything else.
      result: { warnings: [
        ...originalItems.flatMap(it => it?.warnings ?? []),
        ...mergedTestDefs().warnings,
      ] },
      // Stated once for the whole gallery, from the same assignment every card draws.
      extra: [
        sharedOpts.binColors && binColorWarning(sharedOpts.binColors, sharedOpts.plotMode),
        mixedPassBinsWarning(lotMixedPassBins),
        mixedRingCountWarning(itemRingCounts()),
      ].filter((w): w is WaferWarning => !!w) });
    const changed = next.length !== currentWarnings.length
      || next.some((w, i) => w.code !== currentWarnings[i]?.code || w.message !== currentWarnings[i]?.message);
    currentWarnings = next;
    if (changed || !warningsNotified) {
      warningsNotified = true;
      options.warnings?.onWarning?.(next);
    }
    syncWarningButton();
  }

  function syncWarningButton(): void {
    if (!btnWarnings || !btnWarningsSep) return;
    const count = currentWarnings.length;
    const show  = count > 0;
    btnWarnings.style.display    = show ? 'flex' : 'none';
    btnWarningsSep.style.display = show ? '' : 'none';
    if (!show) return;
    const worst = severityOf(currentWarnings[0]);
    const label = `${count} data ${count === 1 ? 'warning' : 'warnings'}`;
    btnWarnings.style.color = worst === 'error' ? CLR.errText : CLR.warnText;
    btnWarnings.ariaLabel = worst === 'error'
      ? `${label} — some wafers may be positionally wrong`
      : label;
  }

  if (options.warnings?.display ?? true) {
    btnWarningsSep = makeSep();
    btnWarnings = makeBtn('warning', 'Data warnings', () => {
      const existing = getOpenMenu();
      closeOpenMenu(new MouseEvent('click'));
      if (existing) return;
      const menu = buildWarningsMenuEl(
        btnWarnings!.getBoundingClientRect(), currentWarnings,
        btnWarnings!.ownerDocument.defaultView ?? window,
      );
      menuLayerFor(container).appendChild(menu);
      setOpenMenu(menu);
      wireMenuA11y(menu, btnWarnings!, () => closeOpenMenu(new MouseEvent('click')));
    });
    markMenuTrigger(btnWarnings, false);
    barEl.appendChild(btnWarningsSep);
    barEl.appendChild(btnWarnings);
  }
  refreshGalleryWarnings();

  // Insights tab — toggles between the gallery grid and wmap's own chart
  // suite. Mutually exclusive with the grid view (not just an overlay),
  // since the suite wants the full body's room, not a side panel.
  let btnInsights: HTMLButtonElement | null = null;
  if (insightsEnabled) {
    btnInsights = makeBtn('analysis', 'Insights', () => {
      // `insightsOpen`, NOT insightsEl's display: the element does not exist
      // until the suite has been loaded once, and `null?.style.display !==
      // 'none'` evaluates to true — so reading the DOM here would report a
      // never-opened tab as already open and the first click would do nothing.
      setInsightsOpen(!insightsOpen);
    });
    // Stable identity hook — this button's aria-label is TOGGLED ('Insights'
    // vs 'Back to gallery view' below), so button[aria-label="Insights"]
    // only matches while closed and can't be used to close it or assert
    // open state. dataset.active (set by setActive() below) already carries
    // open/closed; this just makes the button findable regardless of state.
    btnInsights.dataset.wmapInsightsBtn = '1';
    barEl.appendChild(makeSep());
    barEl.appendChild(btnInsights);
  }

  // Help button — opens the end-user guide in a non-modal window (opt-in).
  // The button's click handler and the controller's own `openUserGuide()`
  // (below) both call this same function — a host can trigger the guide
  // programmatically (e.g. from its own combined help menu) whether or not
  // `showHelpButton` ever rendered a wmap toolbar button at all.
  function openGuideWindow(): void {
    import('./userGuideHtml.js').then(m => openUserGuideWindow(
      { buildWaferMap, renderWaferMap, renderWaferGallery, analyzeWaferMap },
      m.USER_GUIDE_HTML,
      userGuideExtension,
      container,
    ));
  }
  if (showHelpButton) {
    barEl.appendChild(makeSep());
    barEl.appendChild(makeBtn('help', 'User guide', () => openGuideWindow()));
  }

  // ── Bin legend strip ───────────────────────────────────────────────────────

  // Two independent pieces of content stack as separate lines (metadata, then
  // bin swatches) rather than sharing one wrapped flex row — metadata summaries
  // can themselves be long (several distinct-value lists), and mixing them with
  // bin swatches in one wrap made the whole strip read as a single jumbled line.
  // The metadata pill — lot identity, on the same row as the toolbar.
  //
  // It used to be the first line inside `legendEl`, on its own row below the
  // toolbar. That row was 14px of content in a ~46px strip while the toolbar
  // beside it stood 36px tall with the whole left half of its row empty, so the
  // two together spent two rows saying what fits in one. Measured on the docs
  // gallery the identity content is ~297px and the toolbar ~330px: they share a
  // 700px viewport comfortably, and the pill carries the strip's existing
  // "+N more" collapsing, so it shrinks to whatever width is left rather than
  // forcing the row to wrap.
  const metaPillEl = container.ownerDocument.createElement('div');
  metaPillEl.dataset.wmapGalleryMeta = '1';
  Object.assign(metaPillEl.style, {
    // flex:1 with minWidth:0 — takes the space the toolbar does not need, and
    // is the element that gives way when the row runs short. minWidth:0 is what
    // lets it shrink below its content at all (a flex item's automatic minimum
    // size is its content, which would otherwise push the toolbar off-row).
    flex:          '1',
    minWidth:      '0',
    overflow:      'hidden',
    display:       'flex',
    alignItems:    'center',
    // Borderless — identity is text on the page, not a control surface. This
    // also matches renderWaferMap's identity header, which has never had a
    // border, so the two views state the same thing the same way instead of
    // one of them wrapping it in a box. The toolbar beside it keeps its border
    // because it IS a control surface.
    //
    // Horizontal padding is kept (not zeroed to the gutter) so the text lines
    // up with the bordered bin strip directly below, whose own content is inset
    // by its border plus the same padding — a 1px difference, where aligning to
    // the gutter instead would leave a visible 13px step between two lines of
    // header text.
    padding: `${SPACE.sm} ${SPACE.lg}`,
    // `sub`, not `body` — one tier up, and the size the chips actually render
    // at since `buildMetadataStripRow` sets no size of its own and inherits
    // from here. This is the view's primary identity (which lot, which product,
    // which split), read at a glance, and it was a tier BELOW the wafer labels
    // on the cards beneath it. It now matches renderWaferMap's identity label,
    // so the same fact is the same size in both views.
    fontSize:      FONT.sub,
    lineHeight:    LEADING.none,
    boxSizing:     'border-box' } as Partial<CSSStyleDeclaration>);

  // One row: identity pill (flexible) then toolbar (fixed). The toolbar has
  // priority — it never shrinks, because every control in it must stay hittable
  // at any width, whereas the identity text degrades gracefully to "+N more".
  const chromeRowEl = container.ownerDocument.createElement('div');
  Object.assign(chromeRowEl.style, {
    // The map area's own background, the same rule renderWaferMap's chrome row
    // uses. Left transparent this inherited the host page, which is identical
    // here (both slate) but diverges on a host whose page is white — the two
    // views would then sit on different grounds for no reason anyone could see
    // in this repo's own demos.
    background: CLR.canvasBg,
    display: 'flex',
    // `stretch`, not `center`: two bordered surfaces sitting side by side on one
    // row read as mismatched unless their boxes are the same height, and with
    // `center` the pill took its content height (27px) against the toolbar's
    // 36px. Stretch makes the pill adopt the row's height — derived from the
    // toolbar rather than hardcoded, so it still matches if the toolbar's own
    // padding or icon size ever changes, or if it wraps to a second line. The
    // pill centres its own text inside that taller box (`alignItems: center` on
    // the pill itself), so the identity still sits on the toolbar's midline.
    alignItems: 'stretch',
    gap: SPACE.lg,
    // Padding, not margin — see renderWaferMap's chrome row: the row paints a
    // background, and a margin would fall outside it.
    paddingBottom: SPACE.lg, minWidth: '0' } as Partial<CSSStyleDeclaration>);

  const legendEl = container.ownerDocument.createElement('div');
  // Stable hook for tests/tooling — same convention as barEl's
  // data-wmap-toolbar, added when this element stopped being container's
  // direct, position-fixed child (it moved inside stickyHeaderEl below), which
  // broke every `container.children[1]` lookup that assumed it.
  legendEl.dataset.wmapGalleryLegend = '1';
  Object.assign(legendEl.style, {
    display:       'flex',
    flexDirection: 'column',
    gap: SPACE.sm,
    background:    CLR.menuBg,
    border:        `1px solid ${CLR.menuBorder}`,
    borderRadius:  RADIUS.container,
    padding: `${SPACE.sm} ${SPACE.lg}`,
    marginBottom: SPACE.lg,
    boxShadow:     SHADOW.panel,
    fontSize:      FONT.body,
    lineHeight:    LEADING.none,
    boxSizing:     'border-box',
    width:         '100%',
    minWidth:      '0' });

  // ── Body row (grid + side drawer) ──────────────────────────────────────────

  const bodyEl = container.ownerDocument.createElement('div');
  Object.assign(bodyEl.style, {
    display:   'flex',
    flexDirection: 'row',
    // NO `gap` — deliberately. `gridEl` below carries `EDGE_GUTTER` on BOTH of
    // its horizontal sides, and the summary panel docks directly against one of
    // them, so a gap here would ADD to that padding and open a 24px trench
    // between the cards and the panel while every other edge in the view used
    // 12. Letting the grid's own padding do both jobs — gutter against the
    // window on its free side, separation from the panel on the docked side —
    // is what makes those two cases the same number without a rule that has to
    // know which side the panel is on, or whether it is open at all.
    alignItems: 'flex-start' });

  // ── Insights tab (opt-in) ────────────────────────────────────────────────────
  // Takes over the full body when active — swaps out the grid/summary panel
  // rather than sitting alongside them, since the chart suite wants the room.
  // First slice: a single Process capability panel plus a shared "Group by"
  // control (computed from each item's wafer.metadata — see stats/facets.ts).
  // More panels land incrementally; see tsmap's WMAP_ISSUES.md for the tracked
  // migration this is part of.
  //
  // Built only when `insightsEnabled` — mirrors `renderWaferMap.ts`'s own
  // gating, so a gallery with the feature off (the default) doesn't pay for
  // the chart suite's DOM/closures or keep a hidden host in the container.
  let insightsTab: InsightsTabHandle | null = null;
  let insightsEl: HTMLElement | null = null;
  /** In flight or resolved — so a double-click can't build two tabs. */
  let insightsLoad: Promise<InsightsTabHandle | null> | null = null;

  /** Load the chart suite and build the tab, once. Resolves to null when
   *  Insights is not enabled, so callers need no separate guard. */
  function ensureInsightsTab(): Promise<InsightsTabHandle | null> {
    if (!insightsEnabled) return Promise.resolve(null);
    if (insightsTab) return Promise.resolve(insightsTab);
    insightsLoad ??= import('./insightsTab.js').then(({ createInsightsTab }) => {
      insightsTab = createInsightsTab({
      getItems: () => originalItems,
      getLotStats: () => currentLotStats,
      getBinColors: () => sharedOpts.binColors ?? lotBinColors(),
      getRingCount: lotRingCount,
      defaultView: options.insights?.defaultView,
      // No back tab. The bar now stays visible in Insights and carries the
      // toggle, and unlike renderWaferMap's toolbar this one is unconditional —
      // there is no option to suppress it, and `btnInsights` exists whenever
      // `insightsEnabled` is true, which is the only way this tab is ever
      // reachable. So a "‹ Gallery" tab could only ever be a second control
      // doing what the bar's toggle already does, two inches to the left.
      // Never. The bar stays visible in Insights and carries Help whenever the
      // host asked for it, so the tab row has nothing to fall back for. The
      // condition here was inverted — it passed the guide through precisely
      // when `showHelpButton` was FALSE, so a host that had switched Help off
      // (tsmap does) got an unwanted Help button the moment Insights opened.
      onOpenGuide: undefined,
      // The gallery's own legend strip (rebuildLegend/legendEl) already shows
      // this metadata, via the same `buildMetadataStripRow` this tab's own
      // strip would use, and stays mounted above the grid/Insights body in
      // both views — this tab's own strip would just be a second, redundant
      // copy of identical content.
      showMetadataStrip: false,
      onSaveImage: options.onSaveImage,
      onSaveText: options.onSaveText,
      ownerDocument: container.ownerDocument,
      // Opens one wafer's full map in a modal, from a chart panel bar/row
      // click (yield's leaf rows, boxplot's leaf rows). Reuses
      // `buildDetachedController` (the same per-item render used for a card
      // detached into its own window) rather than a third way to turn a
      // `WaferMapDisplayItem` into a live map, and `openModal` (the same
      // primitive `openChartExpandModal` already uses for chart panels) for
      // the shell — no new overlay mechanism, just composing two that
      // already exist.
      // `testNumber` (from a boxplot leaf-row click) opens the map straight
      // into value mode on that same test, instead of always landing on
      // whatever plot mode the gallery currently shares — see
      // `buildDetachedController`'s own doc comment.
      openWafer: (waferIndex, title, testNumber) => {
        const item = originalItems[waferIndex];
        if (!item) return;
        let ctrl: WaferMapController | null = null;
        const handle = openModal({ title, onClose: () => ctrl?.destroy(), anchor: container });
        augmentOverlayTitleWithMetadata(handle, title, item.wafer.metadata ?? undefined);
        ctrl = buildDetachedController(handle.contentWrap, item, testNumber);
      } });
      insightsEl = insightsTab.el;
      // Hidden on arrival; setInsightsOpen reveals it once the load resolves.
      insightsEl.style.display = 'none';
      container.appendChild(insightsEl);
      return insightsTab;
    });
    return insightsLoad;
  }

  // Whether the Insights tab is currently showing — read by `rebuildLegend()`
  // so the shared metadata strip (`legendEl`) stays mounted in the same place
  // across both views instead of being a second, independent strip inside
  // Insights; only the bin-legend row (meaningless once the grid of cards is
  // replaced by the chart suite) is dropped when Insights is open.
  let insightsOpen = false;

  function setInsightsOpen(open: boolean): void {
    if (!insightsEnabled) return;
    insightsOpen = open;
    // Chrome first, synchronously, so the view responds to the click while the
    // chart suite is still being fetched; only revealing the tab has to wait.
    if (insightsEl) insightsEl.style.display = open ? 'flex' : 'none';
    bodyEl.style.display = open ? 'none' : 'flex';
    galleryViewControlsEl.style.display = open ? 'none' : 'inline-flex';
    // The bar STAYS while Insights is showing, holding the Insights toggle and
    // Help once the grid-specific controls above have gone.
    //
    // Hiding it did reclaim real space here — unlike `renderWaferMap`, whose
    // Insights view reserves the toolbar's band whether or not a toolbar is in
    // it, so hiding there saved nothing at all. Measured on the docs gallery,
    // hiding this bar lifts the content by 58px. That is a genuine cost, and it
    // buys back a worse problem: with the bar gone the toggle did not merely
    // move, it CHANGED — from an icon button on the right of the bar into a
    // "‹ Gallery" text tab at the far left of the chart suite. The one control
    // a lost user reaches for swapped shape, position and side at the moment
    // they needed it, and the identity strip jumped 58px up at the same time,
    // so nothing on screen stayed still to anchor the change.
    //
    // 46px of a scrolling chart page is a smaller price than that, and it is
    // the same 46px the grid view already pays, so neither view is the odd one.
    //
    // 'inline-flex', matching how barEl was created — not 'flex'. The bar is a
    // shrink-to-fit pill; restoring it as a block-level flex container stretched
    // it to the full gallery width, so closing Insights left a full-width
    // bordered box where a compact toolbar had been.
    barEl.style.display = 'inline-flex';
    if (btnInsights) {
      setActive(btnInsights, open);
      // The icon itself signals the toggle: a bar-chart glyph means "open
      // Insights", a wafer glyph (while Insights is showing) means "back to
      // the gallery grid" — clicking Insights again is otherwise not
      // obvious as the way back, since the button's position never moves.
      btnInsights.innerHTML = open ? ICONS.wafer : ICONS.analysis;
      btnInsights.ariaLabel = open ? 'Back to gallery view' : 'Insights';
    }
    refreshLotSummaryButton();
    rebuildLegend();
    if (!open) return;
    void ensureInsightsTab().then(tab => {
      // Re-read rather than captured: the user can toggle back to the grid
      // while the chunk is downloading.
      if (!tab || !insightsOpen) return;
      tab.el.style.display = 'flex';
      tab.render();
    });
  }

  // Analysis-first mount: see InsightsOptions.defaultOpen. Deferred to a
  // microtask so the rest of this render finishes first — setInsightsOpen
  // touches chrome that is still being constructed above.
  if (insightsEnabled && options.insights?.defaultOpen) queueMicrotask(() => setInsightsOpen(true));

  // ── Grid container ─────────────────────────────────────────────────────────

  const TARGET_DIE_PX = 4;   // minimum readable die pixel size at gallery scale
  const MIN_CARD_PX   = 240; // absolute floor
  // Bounds for the card size cap. The cap is derived from die pitch rather than fixed, because a single
  // number can't serve both ends of the DPW range: 480px keeps an ordinary
  // wafer compact instead of monopolising a wide screen, but at high DPW it
  // silently starves the TARGET_DIE_PX readability target (a 3mm pitch / ~7.8k
  // DPW wafer needs 524px for 4px dies; 2mm / ~17.7k needs 724px). So the cap
  // grows with density up to the ceiling, then dies shrink rather than the card
  // growing without bound — past this point the map is a density overview and
  // reading individual dies is the expand/zoom view's job.
  const CARD_CAP_FLOOR_PX   = 480;
  const CARD_CAP_CEILING_PX = 720;
  // A card at the bare MIN floor is legible but cramped. When the container is
  // wide enough, auto packs more columns rather than inflating a few cards past
  // this comfortable width — using the available width instead of wasting it.
  const COMFORTABLE_CARD_FACTOR = 1.25;

  // Derived per-density in refreshCardSizeCap().
  let currentMaxCardPx = CARD_CAP_FLOOR_PX;

  /**
   * Card width (px) at which each die renders at TARGET_DIE_PX, before any
   * clamping — the single source of truth for both the readability floor
   * (computeMinCardPx) and the density-derived cap (refreshCardSizeCap).
   * Returns null when no item has die data to measure.
   *
   * Measures the *densest* wafer, not the first one carrying dies: every card
   * is sized alike, so sizing off an arbitrary item would silently starve a
   * finer-pitch wafer elsewhere in the lot. Lots are usually uniform, but
   * "usually" is not something the library can lean on.
   */
  function cardPxForTargetDieSize(its: (WaferMapDisplayItem | null)[]): number | null {
    // card chrome: cardPadding on each side + bin legend reserve + 2px border
    const chrome = cardPadding * 2 + 110 + 2;
    let needed: number | null = null;
    for (const it of its) {
      if (it == null || !it.dies?.length) continue;
      const diePitchMm = it.dies[0].width;
      if (!(diePitchMm > 0)) continue; // nothing to measure against — never divide by zero
      const minCanvasPx = it.wafer.radius * 2 * (TARGET_DIE_PX / diePitchMm);
      const px = Math.ceil(minCanvasPx + chrome);
      if (needed == null || px > needed) needed = px;
    }
    return needed;
  }

  // Compute the minimum card width (px) so that each die is at least TARGET_DIE_PX wide.
  function computeMinCardPx(its: (WaferMapDisplayItem | null)[]): number {
    const needed = cardPxForTargetDieSize(its);
    if (needed == null) return MIN_CARD_PX;
    return Math.min(currentMaxCardPx, Math.max(MIN_CARD_PX, needed));
  }

  /**
   * Widen the default cap toward what this item's die density needs. Grow-only,
   * mirroring currentMinCardPx: items arrive incrementally (factories resolve
   * one at a time), so the cap must settle on the densest wafer seen rather
   * than whatever resolved last.
   * Returns true when the cap changed, so callers can re-apply it to live cards.
   */
  function refreshCardSizeCap(its: (WaferMapDisplayItem | null)[]): boolean {
    const needed = cardPxForTargetDieSize(its);
    if (needed == null) return false;
    const next = Math.min(CARD_CAP_CEILING_PX, Math.max(CARD_CAP_FLOOR_PX, needed));
    if (next <= currentMaxCardPx) return false;
    currentMaxCardPx = next;
    return true;
  }

  /** Re-apply the current cap to every card already in the grid. */
  function applyCardSizeCap(): void {
    for (const card of Array.from(gridEl.children) as HTMLElement[]) {
      if (!card.classList.contains('wmap-gallery-card')) continue; // skip factory placeholders
      card.style.maxWidth  = `${currentMaxCardPx}px`;
      card.style.maxHeight = `${currentMaxCardPx}px`;
    }
  }

  let currentMinCardPx = MIN_CARD_PX;
  let currentItemCount = 0;

  function applyGridColumns(its: (WaferMapDisplayItem | null)[]): void {
    // The size cap is derived from die density alone, so it is refreshed even
    // under a fixed column count (which only overrides the auto column maths
    // below) — and before computeMinCardPx, which clamps to the current cap.
    const capChanged = refreshCardSizeCap(its);
    if (capChanged) applyCardSizeCap();
    if (currentColumns != null) {
      if (capChanged) applyGridTemplate(); // tracks are sized by the cap
      return;
    }
    const newMin = computeMinCardPx(its);
    if (newMin > currentMinCardPx) currentMinCardPx = newMin;
    applyGridTemplate();
  }

  function setColumnsState(cols: number | undefined): void {
    currentColumns = cols;
    applyGridTemplate();
  }

  // Tracks are capped at the current card cap rather than `1fr`: a `1fr` track always
  // takes an equal share of the full container width, so a card clamped by its
  // own max-size sits at the left edge of an oversized track and the leftover
  // shows up as whitespace bands between columns. minmax(0, cap) lets a track
  // shrink below the cap when the container is narrow (grid grows tracks
  // equally until the space runs out) but never exceed it, so columns stay
  // adjacent and the grid packs left via justify-content: start.
  function trackTemplate(cols: number): string {
    return `repeat(${cols}, minmax(0, ${currentMaxCardPx}px))`;
  }

  /**
   * Write the grid template only when it actually changes. This runs from a
   * ResizeObserver on `gridEl` itself and rewrites that same element's
   * `grid-template-columns`, so an unconditional write re-invalidates the
   * observed element and the browser reports "ResizeObserver loop completed
   * with undelivered notifications" — changing the column count reflows the
   * rows, which changes `gridEl`'s height, which notifies again.
   */
  function setGridTemplate(value: string): void {
    if (gridEl.style.gridTemplateColumns !== value) gridEl.style.gridTemplateColumns = value;
  }

  function applyGridTemplate(): void {
    if (currentColumns != null) {
      setGridTemplate(trackTemplate(currentColumns));
      return;
    }
    const N = Math.max(1, currentItemCount);
    const gap = 12;
    const containerW = gridEl.clientWidth || 0;

    // Pack in as many columns as the container can hold at a *comfortable* card
    // size, falling back to the hard readability floor only when it cannot
    // manage even one column at that size.
    //
    // This used to enforce the hard floor first and treat "comfortable" as a
    // bonus pass that could only ADD columns. That maximised column count
    // subject to the hard floor, which by construction makes cards as small as
    // the floor allows — and produced a genuinely confusing result: widening
    // the window could SHRINK the cards. Measured on a 13-wafer lot, a 900px
    // window gave a 299px canvas (2 columns) and a 1171px window gave 285px
    // (3 columns), so 271px of extra width bought a smaller wafer.
    //
    // Integer column counts mean card width can never be strictly monotonic in
    // container width — crossing into another column always costs some size.
    // What can be guaranteed is the size never drops below `comfortablePx`,
    // which is the guarantee worth having, and it is a far better floor than
    // the bare readability minimum.
    const cardWidthAt = (c: number) => (containerW - gap * (c - 1)) / c;
    let cols = Math.max(1, Math.ceil(Math.sqrt(N)));
    if (containerW > 0) {
      const comfortablePx = Math.min(currentMaxCardPx, currentMinCardPx * COMFORTABLE_CARD_FACTOR);
      const largestColsAtLeast = (px: number): number => {
        let c = 0;
        while (c < N && cardWidthAt(c + 1) >= px) c++;
        return c;
      };
      // Comfortable if it fits at all; otherwise the most columns that still
      // clear the hard floor; otherwise a single column, which the card's own
      // max-size and the container's scrolling handle from there.
      cols = largestColsAtLeast(comfortablePx) || largestColsAtLeast(currentMinCardPx) || 1;
    }
    setGridTemplate(trackTemplate(cols));
  }

  const gridEl = container.ownerDocument.createElement('div');
  Object.assign(gridEl.style, {
    flex:                    '1 1 0',
    minWidth:                '0',
    display:                 'grid',
    gridTemplateColumns:     trackTemplate(1),
    gap: SPACE.xl,
    // Cards were flush against the window edge on both sides — `gap` spaces
    // them from EACH OTHER but says nothing about the container edge. Padding
    // here rather than a margin on the cards: a margin would add to `gap`
    // between neighbours (gap + two margins) while giving only one margin at
    // the outside, making the middle worse to fix the edge. `stickyHeaderEl`
    // is a sibling and stays full-bleed, so the bar still spans the width.
    paddingLeft: EDGE_GUTTER, paddingRight: EDGE_GUTTER,
    justifyContent:          'start',
    alignContent:            'start',
    // `isolation: isolate` — NOT decorative, load-bearing. Each card's own
    // toolbar (renderWaferMap.ts) sets an explicit `zIndex: Z_BASE` on an
    // element whose positioned ancestors (canvasWrap: position:relative, no
    // z-index) never establish a stacking context of their own — per the CSS
    // spec, position:relative WITHOUT an explicit z-index does not isolate
    // anything, so that Z_BASE value bubbles all the way up past gridEl,
    // bodyEl and container to compete as a PEER of stickyHeaderEl below, at
    // whatever the nearest real stacking-context root actually is. Without
    // this line, no zIndex on stickyHeaderEl can ever be simultaneously
    // "above a scrolled-under card" and "below that same bar's own popped-out
    // dropdown menu", because both the card's toolbar AND this bar's menu use
    // the identical Z_BASE value — there is no number that is both greater
    // and less than the same number. Isolating the grid contains every
    // card's Z_BASE locally, so it can no longer leak out and be compared
    // against anything outside gridEl at all.
    isolation:               'isolate' });

  // Build gallery summary panel.
  // Explicit placement: always visible persistent panel.
  // Auto-mount (lotStatsSummary or per-wafer findings, no placement): toggled via toolbar button.
  // defaultOpen: true starts the auto-mounted panel visible.
  {
    if (summaryPanelOpts?.placement) {
      const placement = summaryPanelOpts.placement;
      gallerySummaryPanelEl = createSummaryPanelEl(placement, EDGE_GUTTER, container.ownerDocument);
      gallerySummaryPanelEl.style.maxHeight = 'calc(100vh - 80px)';
      gallerySummaryPanelEl.style.position  = 'sticky';
      gallerySummaryPanelEl.style.top       = '8px';
      gallerySummaryPanelEl.style.display   = 'flex';
      gallerySummaryPanelEl.style.flexDirection = 'column';
    } else if (currentLotStats || hasAnyPerWaferFindings()) {
      const openOnMount = !!summaryPanelOpts?.defaultOpen;
      gallerySummaryPanelEl = createSummaryPanelEl('right', EDGE_GUTTER, container.ownerDocument);
      gallerySummaryPanelEl.style.maxHeight = 'calc(100vh - 80px)';
      gallerySummaryPanelEl.style.position  = 'sticky';
      gallerySummaryPanelEl.style.top       = '8px';
      gallerySummaryPanelEl.style.flexDirection = 'column';
      gallerySummaryPanelEl.style.display   = openOnMount ? 'flex' : 'none';
      renderGallerySummaryPanel();
    }
  }

  refreshLotSummaryButton();
  // Sync toolbar button active state with initial panel visibility
  if (gallerySummaryPanelEl?.style.display !== 'none' && btnLotSummary) {
    setActive(btnLotSummary, true);
  }

  const placement = summaryPanelOpts?.placement ?? 'right';
  if (placement === 'left') {
    if (gallerySummaryPanelEl) bodyEl.appendChild(gallerySummaryPanelEl);
    bodyEl.appendChild(gridEl);
  } else {
    bodyEl.appendChild(gridEl);
    if (gallerySummaryPanelEl) bodyEl.appendChild(gallerySummaryPanelEl);
  }

  // Toolbar + legend stick to the top of whatever scrolls this gallery. Both
  // used to scroll away with the grid (position: static, the default) — on
  // any lot long enough to scroll, scrolling down lost the plot-mode control
  // and the bin legend at the exact moment there was more map on screen to
  // make sense of. Wrapped together, rather than each given its own `sticky`,
  // because the toolbar can wrap onto a second line at narrow widths and its
  // height isn't fixed — two independently-stickied siblings would need the
  // second one's `top` computed from the first's live height, which is
  // exactly the kind of thing that quietly breaks on the next toolbar change.
  // One wrapper has one height, whatever it is.
  //
  // `position: sticky` needs a scrolling ancestor to stick within, which this
  // component doesn't itself create (WMAP_ISSUES.md — the gallery never sets
  // overflow on `container`) — it works because tsmap gives `#map-container`
  // `overflow-y: auto` when showing a gallery, and sticky finds that ancestor
  // regardless of which element owns the scrollbar.
  const stickyHeaderEl = container.ownerDocument.createElement('div');
  Object.assign(stickyHeaderEl.style, {
    position:   'sticky',
    top:        '0',
    // Column flex: the chrome row (identity pill + toolbar) above the bin
    // legend, both stretched to the full width.
    display:       'flex',
    flexDirection: 'column',
    // Gutter goes on this wrapper, not on `barEl`/`legendEl` themselves: both
    // are bordered, radiused surfaces (same card language as the wafer cards
    // below) and both were flush against the window while the cards under them
    // were inset by EDGE_GUTTER — the mismatch was plainly visible as soon as
    // the cards moved in. Padding the wrapper insets both in one place AND
    // keeps its own background full-bleed, which is what actually hides
    // content scrolling underneath a sticky bar.
    paddingLeft:  EDGE_GUTTER,
    paddingRight: EDGE_GUTTER,
    // Top gutter too: this bar is the first thing in the view, so in a host
    // that gives the map area no padding of its own (tsmap's `#map-container`)
    // it butted straight against the host's own toolbar with nothing between
    // two bordered surfaces. Sticky sits at `top: 0`, so this padding is also
    // what keeps a 12px band of this element's own background above the bar
    // once content scrolls under it, rather than cards touching it directly.
    paddingTop:   EDGE_GUTTER,
    // A small EXPLICIT value, deliberately far below Z_BASE — this is not
    // "not high enough yet", raising it is the wrong move if this header ever
    // again looks buried. What actually keeps this above a scrolled-under
    // card is gridEl's `isolation: isolate` above, which contains every
    // card's own Z_BASE toolbar so it can never be compared against this
    // element at all. Once contained, ANY explicit z-index here beats gridEl
    // (unpositioned, stacks as a plain in-flow layer below anything with a
    // real z-index) — see the CSS stacking-context tiers in gridEl's comment.
    //
    // It must stay LOW: this bar's own dropdown menus (Plot mode, Colour
    // scheme, ...) render via `makeDropdown`/`buildCheckMenuEl`, which append
    // to `document.body` at `Z_BASE` — the exact tier gridEl now contains.
    // Using Z_BASE or Z_ABOVE here previously "fixed" cards floating over the
    // header by instead putting the header ABOVE its own popped-out menus,
    // obscuring them. That was the wrong fix for the right symptom: it raised
    // this element's tier instead of containing the one that was leaking.
    zIndex:     '1',
    background: CLR.menuBg } as Partial<CSSStyleDeclaration>);
  chromeRowEl.appendChild(metaPillEl);
  chromeRowEl.appendChild(barEl);
  stickyHeaderEl.appendChild(chromeRowEl);
  stickyHeaderEl.appendChild(legendEl);
  container.appendChild(stickyHeaderEl);
  container.appendChild(bodyEl);

  // ── Bin legend ─────────────────────────────────────────────────────────────

  function rebuildLegend(): void {
    legendEl.innerHTML = '';
    const mode = sharedOpts.plotMode ?? 'hardBin';
    // Bin swatches key off the plot mode shown on the grid of cards — with
    // Insights open the grid is replaced by the chart suite, so the bin
    // legend row has nothing left to key against and is dropped; the
    // metadata row above it stays, so the strip never moves or disappears
    // when switching between gallery and Insights.
    const hasBinLegendMode = !insightsOpen && BIN_LEGEND_MODES.has(mode);

    // Lot-level metadata — recomputed on every call since the item set can
    // change (e.g. gallery filtered to a subset of a mixed lot). Uses
    // `buildFacetTable`, never `analyzeWaferLot`'s first-wafer-wins
    // `lotIdentity`: a field that varies across wafers must show every
    // distinct value it takes, not just the first wafer's, and never be
    // silently dropped just because it isn't common to every visible wafer.
    const resolvedItems = currentItems.filter((it): it is WaferMapDisplayItem => it != null);
    const stackedItem = resolvedItems.find(it => it.isLotStack);
    const metaRow = buildMetadataStripRow(
      resolvedItems.map(it => ({ metadata: it.wafer.metadata ?? undefined })),
      stackedItem
        ? { lotSize: stackedItem.lotSize ?? resolvedItems.length, aggrMethod: stackedItem.aggrMethod }
        : undefined,
    );

    const isMetadataMode = mode === 'metadata';
    const activeMetadataKey = sharedOpts.activeMetadataKey;

    // Collect bins AND their die counts — one pass, since the strip now states
    // the population split rather than only naming colours.
    const binTally = hasBinLegendMode && !isMetadataMode
      ? countLegendPopulation(resolvedItems, die => (mode === 'softBin' ? die.sbin : die.hbin) ?? undefined, passBinsOf)
      : { counts: new Map<number, number>(), total: 0, pass: 0 };
    // Pass bins first, then failing bins by die count — `sortBinsForDisplay`, the
    // one order every bin list uses (per-card canvas legend, Summary panel,
    // report, Insights pareto). This strip used to sort by number to keep a
    // swatch still under the pointer, but a program with dozens of bins is read
    // for its biggest failures first, and a number-ordered strip beside
    // count-ordered panels showed one lot two ways.
    // Pass status comes from the resolved colours, never `passBins`: those are
    // HARD bin numbers, and a soft bin passes when every die carrying it does.
    const lotColors = hasBinLegendMode && !isMetadataMode ? (sharedOpts.binColors ?? lotBinColors()) : undefined;
    const passingBins: ReadonlySet<number> = lotColors
      ? (mode === 'softBin' ? lotColors.pass.soft : lotColors.pass.hard)
      : new Set<number>();
    const bins = sortBinsForDisplay(binTally.counts.entries(), passingBins).map(([bin]) => bin);

    // 'metadata' mode's own values — string-keyed, collected across every visible
    // card the same way bin counts are, sorted alphabetically (same determinism
    // as buildView.ts's color assignment).
    // `metadataCategoricalValue`, not `String(raw)` — the same derivation the
    // maps themselves use (buildView's `collectMetadataValues`). The two used to
    // differ: this strip stringified raw values while the cards formatted them,
    // so a numeric metadata field could be counted under one label here and
    // coloured under another there.
    const metaTally = hasBinLegendMode && isMetadataMode && activeMetadataKey
      ? countLegendPopulation(resolvedItems, die => metadataCategoricalValue(die.metadata?.[activeMetadataKey]))
      : { counts: new Map<string, number>(), total: 0, pass: 0 };
    // The SAME ordered list the cards colour from, not a second natural sort of
    // this strip's own tally. A comment used to ask the two orderings to stay in
    // step and nothing made them — they agreed only while every wafer happened
    // to carry every value. Values seen only by an unresolved card can't appear
    // in the tally, so anything the order lists but this strip has no count for
    // is dropped rather than shown as an empty swatch.
    const sharedOrder = isMetadataMode ? sharedMetadataValueOrder()?.values : undefined;
    const metadataValues = hasBinLegendMode && isMetadataMode
      ? (sharedOrder ?? [...metaTally.counts.keys()].sort(compareNatural)).filter(v => metaTally.counts.has(v))
      : [];

    // Identity goes in the chrome row's pill, beside the toolbar — not into
    // legendEl. The two are now independent: a lot with metadata but no bin
    // legend (Insights open) shows the pill and no strip at all, which is where
    // the row of vertical space is saved.
    metaPillEl.innerHTML = '';
    if (metaRow) metaPillEl.appendChild(metaRow);
    metaPillEl.style.display = metaRow ? 'flex' : 'none';

    if (!bins.length && !metadataValues.length) {
      legendEl.style.display = 'none';
      return;
    }
    legendEl.style.display = 'flex';

    const binsRow = container.ownerDocument.createElement('div');
    Object.assign(binsRow.style, {
      display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: `${SPACE.sm} ${SPACE.xl}`,
      // A lot can carry dozens of bins, and each entry is now wider than a bare
      // swatch+label was — so an unbounded wrapped strip would push the cards
      // off screen on exactly the lots where the legend matters most. Bounded
      // to roughly three rows and scrolled past that; the share bar sits below
      // and stays visible, so the population split never scrolls away.
      maxHeight: '86px', overflowY: 'auto', overflowX: 'hidden' } as Partial<CSSStyleDeclaration>);
    legendEl.appendChild(binsRow);

    const activeBin = sharedOpts.highlightBin;
    const activeMetadataFieldDef = currentItems.flatMap(it => it?.metadataFields ?? []).find(f => f.key === activeMetadataKey);

    // What this row of swatches is keyed on. Hard and soft bins are INDEPENDENT
    // number spaces — "Bin 3" means two different things depending on the mode —
    // so an unlabelled row of bin swatches is genuinely ambiguous, which is the
    // same defect the panel's "Hard Bin Breakdown" title exists to avoid.
    //
    // It matters most here of anywhere: a card draws its own legend with a
    // "Hard Bin"/"Soft Bin" title from `buildMapTitle`, but that legend is
    // suppressed below BIN_LEGEND_MIN_CANVAS_W/H (toCanvas.ts) — at gallery card
    // sizes this shared strip is frequently the ONLY legend on screen.
    //
    // Metadata mode names the field, resolved exactly as `buildMapTitle` resolves
    // it for a card title (field label, else prettyKey of the key), so the strip
    // and any card title that IS drawn cannot disagree.
    const legendCaption = isMetadataMode
      ? (activeMetadataFieldDef?.label ?? (activeMetadataKey ? prettyKey(activeMetadataKey) : 'Metadata'))
      : MODE_LABELS[mode];
    const captionEl = container.ownerDocument.createElement('span');
    captionEl.textContent = legendCaption;
    Object.assign(captionEl.style, {
      fontSize:      FONT.body,
      fontWeight:    '700',
      letterSpacing: TRACKING,
      textTransform: 'uppercase',
      color:         CLR.label,
      flexShrink:    '0' } as Partial<CSSStyleDeclaration>);
    binsRow.appendChild(captionEl);

    // Yield, in bin modes only. Deliberately not shown for metadata mode: a
    // metadata field has no pass/fail notion, and a yield figure printed beside
    // one would be describing a different question from the swatches under it.
    //
    // It needs no separate computation and cannot disagree with the Summary
    // panel: the legend population is already exactly the yield-eligible one
    // (partial and edge-excluded dies excluded, above), and every die in it is
    // judged by its OWN wafer's pass bins (diePassStatus, the rule yield uses),
    // counted in the same pass as the swatches. Summing a pass-bin list over the
    // bin tally was wrong twice over: in soft-bin mode it applied hard-bin
    // numbers to soft bins (~0% for most programs), and a gallery of wafers built
    // with different pass bins has no single list to sum.
    if (!isMetadataMode && binTally.total > 0) {
      const passCount = binTally.pass;
      const yieldPct  = (passCount / binTally.total) * 100;
      const yieldEl = container.ownerDocument.createElement('span');
      yieldEl.textContent = `Yield ${fmtLegendPercent(yieldPct)}`;
      Object.assign(yieldEl.style, {
        fontSize: FONT.body, fontWeight: '700', color: CLR.value,
        whiteSpace: 'nowrap', flexShrink: '0' } as Partial<CSSStyleDeclaration>);
      // The denominator, stated rather than implied — the whole point of the
      // numbers on this strip is that the population is named, not guessed at.
      const ofEl = container.ownerDocument.createElement('span');
      ofEl.textContent = `${passCount.toLocaleString()} / ${binTally.total.toLocaleString()} dies`;
      Object.assign(ofEl.style, {
        fontSize: FONT.body, color: CLR.label, whiteSpace: 'nowrap', flexShrink: '0' } as Partial<CSSStyleDeclaration>);
      binsRow.appendChild(yieldEl);
      binsRow.appendChild(ofEl);
    }

    if (isMetadataMode) {
      const activeMetadataValue = sharedOpts.highlightMetadataValue;
      metadataValues.forEach((value, index) => {
        const isActive = activeMetadataValue === value;
        const valueDef = activeMetadataFieldDef?.values?.find(v => v.value === value);
        const color = valueDef?.color ?? metadataValueColor(index);
        const count = metaTally.counts.get(value) ?? 0;
        renderLegendSwatchRow(binsRow, {
          color, isActive, label: valueDef?.label ?? value,
          count,
          percent: metaTally.total > 0 ? (count / metaTally.total) * 100 : undefined,
          onClick: () => {
            const next = sharedOpts.highlightMetadataValue === value ? undefined : value;
            updateShared({ highlightMetadataValue: next });
          } });
      });
      return;
    }

    // Hard and soft bins have independent number spaces — pick the correct defs for the active mode.
    // Collect from items (defs now live on WaferMapResult, not on sharedOpts).
    const itemDefs = mode === 'softBin'
      ? currentItems.flatMap(it => it?.sbinDefs ?? [])
      : currentItems.flatMap(it => it?.hbinDefs ?? []);
    // Deduplicate by bin number, first occurrence wins.
    const seenBins = new Set<number>();
    const activeDefs: BinDef[] = [];
    for (const d of itemDefs) {
      if (!seenBins.has(d.bin)) { seenBins.add(d.bin); activeDefs.push(d); }
    }
    const binDefMap = activeDefs.length > 0 ? new Map(activeDefs.map(d => [d.bin, d])) : null;

    // The same gallery-wide assignment every card was given, so each swatch names
    // the colour the dies actually carry on every card.
    const resolvedColors = lotColors ?? sharedOpts.binColors ?? lotBinColors();
    const activeColors = mode === 'softBin' ? resolvedColors.soft : resolvedColors.hard;
    const binColorFor = (bin: number): string => activeColors.get(bin) ?? NO_DATA_FILL;

    for (const bin of bins) {
      const isActive = activeBin === bin;
      const binDef   = binDefMap?.get(bin);
      const count    = binTally.counts.get(bin) ?? 0;
      renderLegendSwatchRow(binsRow, {
        color: binColorFor(bin), isActive,
        label: binDef?.name ? `${bin} · ${binDef.name}` : `Bin ${bin}`,
        count,
        percent: binTally.total > 0 ? (count / binTally.total) * 100 : undefined,
        onClick: () => {
          const next = sharedOpts.highlightBin === bin ? undefined : bin;
          updateShared({ highlightBin: next });
        } });
    }

    // One stacked proportional bar, segments in DESCENDING count — the pareto
    // reading, without reordering the swatches above it. A strip of per-bin
    // bars would need a row each and would not fit a horizontal legend; one bar
    // shows the same split in a single row, and reads at a glance in a way a
    // column of percentages does not.
    if (binTally.total > 0 && bins.length > 1) {
      legendEl.appendChild(buildShareBar(
        container.ownerDocument,
        [...binTally.counts.entries()]
          .sort(([, a], [, b]) => b - a)
          .map(([bin, count]) => ({
            color: binColorFor(bin),
            count,
            label: binDefMap?.get(bin)?.name ? `${bin} · ${binDefMap.get(bin)!.name}` : `Bin ${bin}`,
          })),
        binTally.total,
      ));
    }
  }

  // ── Stacked-mode aggregation helpers ──────────────────────────────────────

  // Build lot-aggregated WaferMapDisplayItems from originalItems for a stacked mode.
  // One card per bin (stackedBins/stackedSoftBins) or per test parameter (stackedValues).
  function buildStackedItems(mode: PlotMode): WaferMapDisplayItem[] {
    const resolvedItems = originalItems.filter((it): it is WaferMapDisplayItem => it !== null);
    if (!resolvedItems.length) return [];
    // Stacking combines wafers' values at "the same physical die" — a
    // position-only concept. Unpositioned dies have no cross-wafer position
    // identity to stack by, so they're excluded from these cards.
    const allDies   = resolvedItems.map(item => item.dies.filter(hasPosition));
    const baseWafer = resolvedItems[0].wafer;
    const lotSize   = resolvedItems.length;

    // Wafer object for stacked analysis: strip the per-wafer 'wafer' identity field
    // (e.g. 'W01') so the summary panel doesn't claim this is a single wafer's data.
    // Lot-level fields (lot, product, etc.) are preserved for context.
    const stackedWafer = baseWafer.metadata
      ? { ...baseWafer, metadata: (({ wafer: _w, waferId: _id, ...rest }) => rest)(baseWafer.metadata as Record<string, unknown>) as typeof baseWafer.metadata }
      : baseWafer;

    // Patch isLotStack / aggregationMethod / lotSize onto a summary produced from
    // aggregated dies — analyzeWaferMap can't infer these from the die data alone.
    function asLotStackSummary(
      summary: import('../stats/types.js').StatsSummary,
      aggregationMethod: string,
    ): import('../stats/types.js').StatsSummary {
      return {
        ...summary,
        stats: { ...summary.stats, isLotStack: true, aggregationMethod, lotSize } };
    }

    if (mode === 'stackedValues') {
      // Collect testDefs from items (now on WaferMapResult, not sharedOpts).
      // Functional tests are excluded: mean/median/σ of a pass/fail outcome is
      // meaningless. (A dedicated stacked functional representation — per-position
      // fail count across the lot, countBin-style — is a deferred enhancement.)
      const itemDefs = lotTestDefs();
      let defs = itemDefs?.filter(isParametricTest);
      // `undefined` (nobody supplied defs) may fall through to discovery below;
      // an empty ARRAY means reconciliation withheld everything, and stacking
      // discovered numbers would pool the very measurements it withheld.
      if (itemDefs !== undefined && defs?.length === 0) return [];

      // If no testDefs on items at all, discover unique test numbers from the actual
      // data (untyped keys default to parametric). Never falls back when defs exist
      // but are all functional — that would resurrect legacy 0/1-encoded functional
      // values as parametric stacks.
      if (!itemDefs?.length) {
        const uniqueNums = getUniqueTestNumbers(resolvedItems.flatMap(it => it.dies));

        defs = uniqueNums.map(tn => ({ testNumber: tn, name: `Test ${tn}` }));
      }
      if (!defs?.length) return [];

      const method = (sharedOpts.aggregationMethod ?? 'mean') as AggregationMethod;
      return defs.map(def => {
        const dies = aggregateValues(allDies, method, def.testNumber) as Die[];
        const cardTestDef = { testNumber: 0, name: def.name, unit: def.unit };
        return {
          wafer: stackedWafer,
          dies,
          testDefs: [cardTestDef],
          label: `${def.name} · ${method}`,
          isLotStack: true,
          aggrMethod: method,
          lotSize,
          statsSummary: asLotStackSummary(
            analyzeWaferMap({ wafer: stackedWafer, dies, testDefs: [cardTestDef] }, { testNumbers: [0] }),
            method,
          ) };
      });
    }

    if (mode === 'stackedBins') {
      let defs = deduplicateDefs(resolvedItems.flatMap(it => it.hbinDefs ?? []));
      if (!defs || defs.length === 0) {
        const uniqueBins = [...new Set(resolvedItems.flatMap(it =>
          it.dies.map(d => d.hbin).filter((b): b is number => b != null)
        ))].sort((a, b) => a - b);
        defs = uniqueBins.map(b => ({ bin: b, name: `Bin ${b}` }));
      }

      return defs.map(def => {
        const dies = aggregateBinCounts(allDies, def.bin, 'hard') as Die[];
        const itemHbinDefs = [{ bin: def.bin, name: def.name }];
        return {
          wafer: stackedWafer,
          dies,
          hbinDefs: itemHbinDefs,
          label: `${def.bin} · ${def.name}`,
          isLotStack: true,
          aggrMethod: 'countBin',
          lotSize,
          statsSummary: asLotStackSummary(
            analyzeWaferMap({ wafer: stackedWafer, dies, hbinDefs: itemHbinDefs }),
            'countBin',
          ) };
      });
    }

    if (mode === 'stackedSoftBins') {
      let defs = deduplicateDefs(resolvedItems.flatMap(it => it.sbinDefs ?? []));
      if (!defs || defs.length === 0) {
        const uniqueBins = [...new Set(resolvedItems.flatMap(it =>
          it.dies.map(d => d.sbin).filter((b): b is number => b != null)
        ))].sort((a, b) => a - b);
        defs = uniqueBins.map(b => ({ bin: b, name: `Bin ${b}` }));
      }

      return defs.map(def => {
        const dies = aggregateBinCounts(allDies, def.bin, 'soft') as Die[];
        const itemSbinDefs = [{ bin: def.bin, name: def.name }];
        return {
          wafer: stackedWafer,
          dies,
          sbinDefs: itemSbinDefs,
          label: `${def.bin} · ${def.name}`,
          isLotStack: true,
          aggrMethod: 'countBin',
          lotSize,
          statsSummary: asLotStackSummary(
            analyzeWaferMap({ wafer: stackedWafer, dies, sbinDefs: itemSbinDefs }),
            'countBin',
          ) };
      });
    }

    return resolvedItems;
  }

  // Extra shared options required for stacked modes (colour scale / lot size metadata).
  function stackedSharedOpts(mode: PlotMode): Partial<CardViewOptions> {
    const lotSize = originalItems.length;
    if (mode === 'stackedBins' || mode === 'stackedSoftBins')
      return { valueRange: [0, lotSize] as [number, number], lotSize };
    if (mode === 'stackedValues')
      return { aggregationMethod: (sharedOpts.aggregationMethod ?? 'mean') as AggregationMethod, valueRange: undefined, lotSize: undefined };
    return {};
  }

  // ── Shared option sync ─────────────────────────────────────────────────────

  // Called from toolbar interactions — updates state, handles stacked-mode card rebuilds,
  // propagates to cards, fires callback.
  // fireCallback=true (default) fires onViewOptionsChange — used for toolbar interactions.
  // fireCallback=false is used by the public setOptions API to avoid re-entrant callbacks.
  function updateShared(partial: Partial<CardViewOptions>, { fireCallback = true } = {}): void {
    // What the caller asked to change — reported to onViewOptionsChange as-is,
    // before `partial` gains the derived `binColors` below.
    const requested = Object.keys(partial) as (keyof WaferViewOptions)[];
    const prevMode = sharedOpts.plotMode;
    const prevLegendBlocked = perCardLegendBlockedReason() !== null;
    sharedOpts = { ...sharedOpts, ...partial };
    const newMode    = sharedOpts.plotMode!;
    const nowStacked = STACKED_MODES.has(newMode);
    const wasStacked = prevMode !== undefined && STACKED_MODES.has(prevMode);
    const hasPendingFactories = pendingFactoryCount > 0;

    // No colour-scheme reset on a mode switch: bin and value colours are
    // separate preferences. A change to the bin palette or the defined-colour
    // toggle re-resolves the gallery-wide assignment here and rides along in the
    // same partial, so each card rebuilds once rather than twice.
    if ('binColorScheme' in partial || 'useDefinedBinColors' in partial) {
      const binColors = lotBinColors();
      sharedOpts = { ...sharedOpts, binColors };
      partial = { ...partial, binColors };
    }

    if (partial.plotMode !== undefined) {
      if (nowStacked) {
        // Switching into a stacked mode — aggregate immediately unless some
        // factory-backed cards are still resolving, in which case keep the raw
        // gallery alive and let the final factory resolve promote it.
        const extra = stackedSharedOpts(newMode);
        sharedOpts = { ...sharedOpts, ...extra };
        if (hasPendingFactories) {
          for (const ctrl of cardControllers) if (ctrl) ctrl.setOptions(partial);
        } else {
          buildCards(buildStackedItems(newMode));
        }
      } else if (wasStacked) {
        // Clear stacked-specific options when leaving stacked mode
        const { valueRange, lotSize, aggregationMethod, ...cleanOpts } = sharedOpts;
        sharedOpts = cleanOpts;
        if (hasPendingFactories) {
          for (const ctrl of cardControllers) if (ctrl) ctrl.setOptions(partial);
        } else {
          buildCards(originalItems.filter((it): it is WaferMapDisplayItem => it !== null));
        }
      } else {
        for (const ctrl of cardControllers) if (ctrl) ctrl.setOptions(partial);
      }
    } else if (partial.aggregationMethod !== undefined && newMode === 'stackedValues') {
      // Aggregation method changed while in stackedValues — re-aggregate.
      if (hasPendingFactories) {
        for (const ctrl of cardControllers) if (ctrl) ctrl.setOptions(partial);
      } else {
        buildCards(buildStackedItems('stackedValues'));
      }
    } else {
      for (const ctrl of cardControllers) if (ctrl) ctrl.setOptions(partial);
    }

    // Whether the per-card-legend toggle can apply is derived from plot mode
    // and colorbar range, so a change to either can silently invert the
    // effective state. Re-push it when the block flips rather than leaving the
    // cards showing what the previous mode implied.
    if ((perCardLegendBlockedReason() !== null) !== prevLegendBlocked) applyPerCardLegend();

    rebuildLegend();
    syncAggrMethodBtn();
    syncLegendStyleBtn();
    syncPaletteBtn();
    const modeChanged = partial.plotMode !== undefined && partial.plotMode !== prevMode;
    if (COLOR_KEYS.some(k => k in partial) || modeChanged) renderGallerySummaryPanel();
    // The shared-colour advisory depends on the plot mode and the palette.
    refreshGalleryWarnings();
    syncLogScaleBtn();
    syncColorbarRangeBtn();
    // Recompute after everything above has settled sharedOpts (entering/leaving
    // a stacked mode sets/clears its own valueRange) — refreshes the lot-wide
    // 'value'-mode range for whatever just changed (active test, colour-range
    // mode, pass/fail display, or a plotMode switch into 'value').
    syncSharedValueRange();
    syncSharedMetadataOrder();
    if (fireCallback) {
      options.onViewOptionsChange?.(toPublicViewOptions(sharedOpts), requested, classifyChanged(requested));
    }
  }

  // ── Card building ──────────────────────────────────────────────────────────

  /**
   * A wafer's own label already covers identity (typically lot · waferId) —
   * the rest of its metadata (product, testProgram, operator, temperature,
   * etc.) is otherwise only visible via the die hover tooltip. Rather than a
   * floating badge duplicating the label text, the identity label itself
   * becomes the expand affordance: a chevron reveals the full field set as
   * an overlay, only when there's anything to show. Shared by the grid
   * card's own header and the detached-window paths (real popup and in-page
   * floating-window fallback) so all three read identically — `doc` is
   * accepted explicitly since a real popup is a *different* document than
   * the one this function is otherwise called from.
   */
  function buildIdentityHeaderRow(
    doc: Document,
    label: string,
    metadata: import('../core/metadata.js').WaferMetadata | undefined,
  ): { wrap: HTMLDivElement; metaPanel: HTMLDivElement | null } {
    const wrap = doc.createElement('div');
    Object.assign(wrap.style, { display: 'flex', alignItems: 'center', gap: SPACE.xs, flex: '1', minWidth: '0' });
    const labelEl = doc.createElement('span');
    labelEl.textContent = label;
    Object.assign(labelEl.style, {
      fontWeight: '700', fontSize: FONT.sub, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' });
    wrap.appendChild(labelEl);

    const entries = metadataEntries(metadata ?? {});
    let metaPanel: HTMLDivElement | null = null;
    if (entries.length > 0) {
      const chevron = doc.createElement('span');
      Object.assign(chevron.style, { fontSize: FONT.body, lineHeight: LEADING.none, color: CLR.label, flexShrink: '0' });
      chevron.textContent = '▾';
      wrap.appendChild(chevron);
      Object.assign(wrap.style, { cursor: 'pointer', borderRadius: RADIUS.control });
      // A clickable header that never reacts reads as a static caption.
      wrap.addEventListener('mouseenter', () => { wrap.style.background = CLR.bgHover; });
      wrap.addEventListener('mouseleave', () => { wrap.style.background = 'none'; });

      metaPanel = doc.createElement('div');
      metaPanel.dataset.wmapCardMetaPanel = '1';
      Object.assign(metaPanel.style, {
        position:     'absolute',
        top:          '0', left: '0', right: '0',
        zIndex:       Z_ABOVE,
        background:   CLR.menuBg,
        borderBottom: `1px solid ${CLR.menuBorder}`,
        boxShadow:    SHADOW.menu,
        padding: `${SPACE.md} ${SPACE.lg}`,
        fontSize:     FONT.body,
        display:      'none' } as Partial<CSSStyleDeclaration>);
      const rows = buildCompactMetadataRows(metadata ?? {});
      if (rows) metaPanel.appendChild(rows);

      wrap.setAttribute('aria-expanded', 'false');
      wrap.setAttribute('aria-label', `Wafer info for ${label || 'this card'}. Click to expand.`);
      wireExpandToggle(wrap, (open) => {
        chevron.textContent = open ? '▴' : '▾';
        wrap.setAttribute('aria-expanded', String(open));
        if (metaPanel) metaPanel.style.display = open ? 'block' : 'none';
      });
    }
    return { wrap, metaPanel };
  }

  /**
   * For a wafer opened into a wmap-owned overlay (`openModal`/`openFloatingWindow`,
   * both built on `openOverlay` in toolbar.ts) — that overlay chrome already has
   * its own always-visible title element (`data-wmap-window-title`); augment it
   * in place with the same chevron/expand-panel affordance every other wafer
   * view uses, rather than mounting a second competing header via
   * `buildIdentityHeaderRow`. toolbar.ts's overlay stays wafer-metadata-agnostic
   * (it has no idea what `WaferMetadata` is) — this wiring lives here instead.
   * Shared by the gallery's in-page floating-window detach fallback and the
   * Insights tab's "open this wafer" modal — both are `OverlayHandle`s with an
   * identical title/content-wrap shape, so one function covers both call sites.
   * No-ops if the overlay wasn't given a title, or the wafer has no metadata.
   */
  function augmentOverlayTitleWithMetadata(
    handle: OverlayHandle,
    label: string,
    metadata: import('../core/metadata.js').WaferMetadata | undefined,
  ): void {
    const titleEl = handle.box.querySelector<HTMLElement>('[data-wmap-window-title]');
    const entries = metadataEntries(metadata ?? {});
    if (!titleEl || entries.length === 0) return;

    const titleParent = titleEl.parentElement;
    const titleWrap = container.ownerDocument.createElement('div');
    Object.assign(titleWrap.style, {
      display: 'flex', alignItems: 'center', gap: SPACE.xs, flex: '1', minWidth: '0', cursor: 'pointer' });
    wireControlHover(titleWrap, 'bare');
    titleParent?.insertBefore(titleWrap, titleEl);
    titleWrap.appendChild(titleEl);
    const chevron = container.ownerDocument.createElement('span');
    Object.assign(chevron.style, { fontSize: FONT.body, lineHeight: LEADING.none, color: CLR.label, flexShrink: '0' });
    chevron.textContent = '▾';
    titleWrap.appendChild(chevron);

    const metaPanel = container.ownerDocument.createElement('div');
    metaPanel.dataset.wmapCardMetaPanel = '1';
    Object.assign(metaPanel.style, {
      position: 'absolute', top: '0', left: '0', right: '0', zIndex: Z_ABOVE,
      background: CLR.menuBg, borderBottom: `1px solid ${CLR.menuBorder}`,
      boxShadow: SHADOW.menu, padding: `${SPACE.md} ${SPACE.lg}`, fontSize: FONT.body, display: 'none' } as Partial<CSSStyleDeclaration>);
    const rows = buildCompactMetadataRows(metadata ?? {});
    if (rows) metaPanel.appendChild(rows);
    handle.contentWrap.style.position = 'relative';
    handle.contentWrap.appendChild(metaPanel);

    titleWrap.setAttribute('aria-expanded', 'false');
    titleWrap.setAttribute('aria-label', `Wafer info for ${label}. Click to expand.`);
    wireExpandToggle(titleWrap, (open) => {
      chevron.textContent = open ? '▴' : '▾';
      titleWrap.setAttribute('aria-expanded', String(open));
      metaPanel.style.display = open ? 'block' : 'none';
    });
  }

  function buildCard(item: WaferMapDisplayItem, cardIndex: number, _totalItems: number): { card: HTMLDivElement; ctrl: CardController; canvasWrapper: HTMLDivElement; expandBtn: HTMLButtonElement } {
    const card = container.ownerDocument.createElement('div');
    card.className = 'wmap-gallery-card';
    Object.assign(card.style, {
      background:    CLR.menuBg,
      border:        `1px solid ${CLR.menuBorder}`,
      borderRadius:  RADIUS.container,
      // Cards were the ONLY bounded surface in either view without elevation —
      // the toolbar, the bin legend, the Insights tab band and the summary
      // panel all carry it, so a grid of flat cards read as a different class
      // of object from the bands directly above them.
      boxShadow:     SHADOW.panel,
      overflow:      'hidden',
      display:       'flex',
      flexDirection: 'column',
      position:      'relative',
      aspectRatio:   '1',
      // Grid items default to `stretch`; a max-size smaller than the track
      // clamps the card there and falls back to start (top-left) alignment
      // for the leftover cell space — no justify-items/-self override needed.
      maxWidth:      `${currentMaxCardPx}px`,
      maxHeight:     `${currentMaxCardPx}px` });

    const header = container.ownerDocument.createElement('div');
    Object.assign(header.style, {
      display:        'flex',
      alignItems:     'center',
      padding: `${SPACE.md} ${SPACE.lg} ${SPACE.sm}`,
      borderBottom:   `1px solid ${CLR.menuBorder}`,
      flexShrink:     '0',
      gap: SPACE.sm });
    const { wrap: identityWrap, metaPanel } = buildIdentityHeaderRow(document, waferDisplayLabel(item, cardIndex), item.wafer.metadata ?? undefined);
    header.appendChild(identityWrap);

    // Expand button — toggles between "detach into its own window" and, once
    // detached, "reattach to this grid slot" (see updateExpandBtn).
    const expandBtn = container.ownerDocument.createElement('button');
    expandBtn.dataset.wmapExpandBtn = '1';
    expandBtn.setAttribute('aria-label', 'Open full view');
    // Tooltip reads `aria-label` live, so updateExpandBtn's expand ⇄ reattach
    // relabel below is picked up without re-wiring.
    wireTooltip(expandBtn);
    expandBtn.innerHTML = ICONS.expand; // unified expand icon (was an inline polyline SVG)
    Object.assign(expandBtn.style, {
      display:         'flex',
      alignItems:      'center',
      justifyContent:  'center',
      border:          `1px solid ${CLR.menuBorder}`,
      borderRadius:    RADIUS.control,
      background:      CLR.panelBg,
      color:           CLR.label,
      padding: SPACE.xxs,
      cursor:          'pointer',
      flexShrink:      '0',
      width:           '22px',
      height:          '22px' });
    wireControlHover(expandBtn);
    header.appendChild(expandBtn);
    card.appendChild(header);

    // Container div for renderWaferMap — the function creates the canvas inside it.
    const canvasWrapper = container.ownerDocument.createElement('div');
    Object.assign(canvasWrapper.style, {
      position:      'relative',
      flex:          '1',
      minHeight:     '0',
      overflow:      'hidden',
      display:       'flex',
      flexDirection: 'column' });
    card.appendChild(canvasWrapper);
    // metaPanel overlays the top of the canvas area (not the header, which
    // stays fixed-height) — an absolute overlay rather than in-flow growth,
    // so expanding it never shrinks canvasWrapper (flex:1) and therefore
    // never shrinks the map, matching the standalone badge's own contract.
    if (metaPanel) canvasWrapper.appendChild(metaPanel);

    // Append to DOM before renderWaferMap so the canvas has a resolved CSS
    // layout size when the initial render() fires — avoids a zero-size first
    // render that the ResizeObserver would otherwise need to correct.
    gridEl.appendChild(card);

    // Grid cards take the current per-card-legend state at mount, so a card
    // rendered lazily (or after a re-layout) matches the ones already on screen
    // instead of flashing a legend until the next applyPerCardLegend.
    const cardShowLegend = perCardLegend || perCardLegendBlockedReason() !== null;
    const cardBaseOptions = item.viewOptions ? { ...sharedOpts, ...item.viewOptions } : sharedOpts;
    const ctrl = renderWaferMapCard(canvasWrapper, item, {
      viewOptions:    { ...cardBaseOptions, showLegend: cardShowLegend, legendPosition: currentLegendStyle },
      showTooltip:     true,
      padding:         cardPadding,
      statsSummary:    item.statsSummary,
      onSaveImage:     options.onSaveImage,
      onSaveText:      options.onSaveText,
      onClick:         item.onClick,
      onSelect:        item.onSelect,
      onExpand:        () => openWindowForCard(cardIndex, item),
      // The card's own header already shows item.label (wafer identity), and
      // the gallery's shared legend strip already shows lot-level metadata —
      // the per-map badge would be pure duplication here (worse: on a small
      // card it visually competes with the toolbar for the same corner-ish
      // space). Only the standalone renderWaferMap use case needs the badge.
      showIdentity: false,
      // The CARD already supplies the outer inset, so this map's chrome takes
      // the small one — a second full gutter inside the card stacks two, which
      // is a toolbar standing well off the card's side. The detached-window
      // path below deliberately keeps the default: there the map IS the region.
      chromeInset: MAP_CHROME_INSET });
    // In-gallery: hide scene controls (gallery bar owns them) and summary button.
    ctrl.setViewControlsVisible(false);
    ctrl.setSummaryVisible(false);
    expandBtn.onclick = () => openWindowForCard(cardIndex, item);

    return { card, ctrl, canvasWrapper, expandBtn };
  }

  /** Sync a card's header button to reflect whether its canvas is currently
   * detached into its own window — "expand" when attached, "reattach" when a
   * still-linked window exists for it. A card whose window has been unlinked
   * (see unlinkAllDetachedWindows) has no grid slot to sync, so this is only
   * called for indices that are still live in the current cardControllers array. */
  function updateExpandBtn(cardIndex: number): void {
    const btn = cardExpandBtns[cardIndex];
    if (!btn) return;
    const win = [...detachedWindows.values()].find(w => w.cardIndex === cardIndex);
    if (win) {
      btn.innerHTML = ICONS.minimize;
      btn.setAttribute('aria-label', 'Reattach to gallery');
      btn.onclick = () => reattachOrDiscard(win.id);
    } else {
      btn.innerHTML = ICONS.expand;
      btn.setAttribute('aria-label', 'Open full view');
      btn.onclick = () => openWindowForCard(cardIndex, currentItems[cardIndex]);
    }
  }

  function buildCards(newItems: Array<WaferMapDisplayItem | WaferMapDisplayItemFactory>): void {
    // Any card currently detached into its own window can't be assumed to exist
    // at the same index (or at all) once the grid is rebuilt — e.g. a stacked-mode
    // transition can collapse many per-wafer cards into fewer aggregate ones, and
    // WaferMapDisplayItem carries no stable id to remap by. Unlink rather than
    // close: the window's own controller/canvas/toolbar keep working exactly as
    // before, it just loses its "reattachable to a grid slot" relationship.
    unlinkAllDetachedWindows();

    getOpenMenu()?.remove(); setOpenMenu(null);
    clearLotFindingHighlight();
    currentItems = [];
    // Detached cards' grid-slot controller is already null (destroyed at detach
    // time — its popup window has its own independent controller instead), so
    // this loop only ever destroys controllers that are actually still live in
    // the grid.
    for (const ctrl of cardControllers) if (ctrl) ctrl.destroy();
    cardControllers = [];
    cardContainers = [];
    cardExpandBtns = [];
    pendingFactoryCount = 0;
    gridEl.innerHTML = '';

    currentItemCount = newItems.length;
    // Size columns from pre-built items; factories will update after resolution.
    applyGridColumns(newItems.map(it => (typeof it === 'function' ? null : it)));

    // Separate pre-built items from factories.
    const factories: Array<{ index: number; factory: WaferMapDisplayItemFactory; placeholder: HTMLDivElement }> = [];

    for (let i = 0; i < newItems.length; i++) {
      const entry = newItems[i];
      if (typeof entry === 'function') {
        // Insert a sized placeholder so the grid layout doesn't collapse.
        const placeholder = container.ownerDocument.createElement('div');
        placeholder.className = 'wmap-gallery-card';
        Object.assign(placeholder.style, {
          background:    CLR.menuBg,
          border:        `1px solid ${CLR.menuBorder}`,
          borderRadius:  RADIUS.container,
          aspectRatio:   '1',
          display:       'flex',
          alignItems:    'center',
          justifyContent:'center' });
        const spinner = container.ownerDocument.createElement('span');
        spinner.textContent = '…';
        Object.assign(spinner.style, { color: CLR.label, fontSize: '18px' });
        placeholder.appendChild(spinner);
        gridEl.appendChild(placeholder);
        currentItems.push(null as unknown as WaferMapDisplayItem); // slot reserved
        cardControllers.push(null as unknown as CardController);
        cardContainers.push(null as unknown as HTMLDivElement);
        cardExpandBtns.push(null as unknown as HTMLButtonElement);
        factories.push({ index: i, factory: entry, placeholder });
        pendingFactoryCount++;
      } else {
        const { ctrl, canvasWrapper, expandBtn } = buildCard(entry, i, newItems.length);
        currentItems.push(entry);
        cardControllers.push(ctrl);
        cardContainers.push(canvasWrapper);
        cardExpandBtns.push(expandBtn);
      }
    }

    // Bin definition colours need no switch here: they are a layer every
    // palette honours (`useDefinedBinColors`), not a scheme to select.
    syncSharedBinColors();

    // All sync items are now in currentItems — legend can be built from them.
    rebuildLegend();
    // Refresh the lot-wide 'value'-mode range now that the item set has changed
    // (buildCards may have just replaced originalItems' dies entirely).
    syncSharedValueRange();
    syncSharedMetadataOrder();

    // Resolve factories one per task to keep the main thread responsive.
    // Capture the generation at the time buildCards was called — if buildCards runs
    // again (mode switch, destroy) the generation increments and stale callbacks bail out.
    const generation = ++buildGeneration;
    let fi = 0;
    function resolveNext(): void {
      if (generation !== buildGeneration) return; // stale — gallery was rebuilt or destroyed
      if (fi >= factories.length) {
        if (STACKED_MODES.has(sharedOpts.plotMode!)) {
          const mode = sharedOpts.plotMode!;
          buildCards(buildStackedItems(mode));
        }
        return;
      }
      const { index, factory, placeholder } = factories[fi++];
      const item = factory();
      currentItems[index] = item;
      originalItems[index] = item;
      applyGridColumns([item]);
      const { card, ctrl, canvasWrapper, expandBtn } = buildCard(item, index, newItems.length);
      cardControllers[index] = ctrl;
      cardContainers[index] = canvasWrapper;
      cardExpandBtns[index] = expandBtn;
      pendingFactoryCount--;
      placeholder.replaceWith(card);
      rebuildLegend();
      // This factory's dies just joined originalItems — refresh the lot-wide
      // 'value'-mode range so cards already on screen widen to include it too.
      // Coalesced: a burst of factories resolving together does one pass.
      scheduleSharedValueRangeSync();
      // If this item introduced per-wafer findings and no panel exists yet, create it now.
      if (!gallerySummaryPanelEl && !summaryPanelOpts?.placement && item.statsSummary?.findings.length) {
        gallerySummaryPanelEl = createSummaryPanelEl('right', EDGE_GUTTER, container.ownerDocument);
        gallerySummaryPanelEl.style.maxHeight = 'calc(100vh - 80px)';
        gallerySummaryPanelEl.style.position  = 'sticky';
        gallerySummaryPanelEl.style.top       = '8px';
        gallerySummaryPanelEl.style.flexDirection = 'column';
        gallerySummaryPanelEl.style.display   = 'none';
        const placement = summaryPanelOpts?.placement ?? 'right';
        if (placement === 'left') {
          bodyEl.insertBefore(gallerySummaryPanelEl, gridEl);
        } else {
          bodyEl.appendChild(gallerySummaryPanelEl);
        }
        // Initial render into the hidden panel so content is ready when opened.
        renderGallerySummaryPanel();
        // Create the toolbar button if not already present.
        if (!btnLotSummary) {
          btnLotSummary = makeBtn('findings', 'Summary panel', () => {
            if (!gallerySummaryPanelEl) return;
            const isOpen = gallerySummaryPanelEl.style.display !== 'none';
            // Re-render on open so the index reflects all items resolved so far.
            if (!isOpen) renderGallerySummaryPanel();
            gallerySummaryPanelEl.style.display = isOpen ? 'none' : 'flex';
            setActive(btnLotSummary!, !isOpen);
            refreshLotSummaryButton();
          });
          barEl.appendChild(makeSep());
          barEl.appendChild(btnLotSummary);
        }
        refreshLotSummaryButton();
      } else if (gallerySummaryPanelEl && gallerySummaryPanelEl.style.display !== 'none') {
        // Panel is open — refresh the index to show newly resolved items.
        renderGallerySummaryPanel();
      }
      refreshLotSummaryButton();
      setTimeout(resolveNext, 0);
    }
    if (factories.length > 0) setTimeout(resolveNext, 0);
  }

  // originalItems is already populated (see its declaration) — factories fill their
  // slots in as they resolve via resolveNext.
  // If the initial plotMode is already a stacked mode, aggregate immediately.
  if (STACKED_MODES.has(sharedOpts.plotMode!) && originalItems.length > 0) {
    const extra = stackedSharedOpts(sharedOpts.plotMode!);
    sharedOpts = { ...sharedOpts, ...extra };
    buildCards(buildStackedItems(sharedOpts.plotMode!));
  } else {
    buildCards(items);
  }
  // The first refreshGalleryWarnings ran before buildCards resolved the
  // gallery-wide bin colours, so it could not yet know whether bins share one.
  refreshGalleryWarnings();

  // Recompute column count when the gallery body width changes (window resize,
  // summary panel open/close, etc.). Only active in auto mode (currentColumns == null).
  // Deferred to the next frame for the same reason chartShell's observeResize
  // is (see its comment): the callback writes layout back onto the observed
  // element, which during delivery is what drops notifications.
  let gridResizeQueued = 0;
  const gridResizeObserver = new (container.ownerDocument.defaultView ?? window).ResizeObserver(() => {
    if (gridResizeQueued) return;
    const win = container.ownerDocument.defaultView ?? window;
    gridResizeQueued = win.requestAnimationFrame(() => {
      gridResizeQueued = 0;
      if (currentColumns == null) applyGridTemplate();
    });
  });
  gridResizeObserver.observe(gridEl);

  // Initial gallery summary panel render
  if (gallerySummaryPanelEl) renderGallerySummaryPanel();

  // ── Detached windows ─────────────────────────────────────────────────────────
  // Non-modal: the gallery grid stays fully interactive while any number of
  // cards are detached into their own floating windows (an engineer comparing
  // several wafers at once). See DetachedWindow above and buildCards()'s
  // unlinkAllDetachedWindows() call for what happens when the grid rebuilds.

  /** Replace a grid card's live canvas with a small "detached" placeholder —
   * the card's own controller was destroyed at detach time (its popup window
   * has the only live view of that wafer while detached), so the grid slot
   * needs *something* occupying its layout space until reattach. */
  /**
   * `inOwnWindow` says which path actually ran. The copy used to be the fixed
   * string "Detached — open in its own window", which is accurate for a real
   * popup and wrong for the in-page fallback: with popups blocked the wafer
   * opens in a floating window inside this same page, and the vacated card
   * still described an outcome that had not happened. The caller knows which
   * it got, so it passes that in rather than the card guessing.
   *
   * "Detached" also went — it is implementation vocabulary. The user's model
   * is that the wafer was opened somewhere, not that it was reparented.
   */
  function showDetachedPlaceholder(cardIndex: number, inOwnWindow: boolean): void {
    const wrapper = cardContainers[cardIndex];
    if (!wrapper) return;
    wrapper.innerHTML = '';
    Object.assign(wrapper.style, { alignItems: 'center', justifyContent: 'center' });
    const note = container.ownerDocument.createElement('span');
    note.textContent = inOwnWindow
      ? 'Opened in its own window'
      : 'Opened in the wafer viewer';
    Object.assign(note.style, { color: CLR.label, fontSize: FONT.body, textAlign: 'center', padding: '0 12px' });
    wrapper.appendChild(note);
  }

  function openWindowForCard(cardIndex: number, item: WaferMapDisplayItem): void {
    // This intentionally looks different from renderWaferMap's own "Expand"
    // (a modal with wmap's own drawn chrome) — a real popup's OS/browser
    // title bar can't be suppressed or restyled, only sized. See
    // `openDetachWindow`'s own doc comment (toolbar.ts) for the full
    // rationale and the possible future change (forcing the
    // `openFloatingWindow` fallback branch everywhere) that was deliberately
    // not taken, and why.
    //
    // Guard re-entrancy — other callers (e.g. the findings-index row) could
    // race a double-open on the same card.
    for (const w of detachedWindows.values()) if (w.cardIndex === cardIndex) return;

    const label = waferDisplayLabel(item, cardIndex);
    const id = nextWindowId++;
    // The grid card's own current view state (plot mode, active test, etc.)
    // — read before it's destroyed below, so the detached window opens
    // showing the same thing the card was, not the gallery's shared default.
    const liveOptions = cardControllers[cardIndex]?.getOptions();

    const popupWin = openDetachWindow(label);
    // A real popup: full OS-window behaviour, can be dragged outside the host
    // window's own bounds. Falls back below when unavailable (a blocked
    // popup — e.g. Tauri's WebView, where window.open() silently returns null
    // — and no custom setDetachWindowOpener is registered).
    if (popupWin) {
      const doc = popupWin.document;
      // A window.open('', ...) popup already has a valid, empty document (with
      // <html><head></head><body></body></html>) — document.write() is
      // unnecessary here and, in at least some engines, appears to leave the
      // document in a state where later ResizeObserver callbacks silently stop
      // firing. Building directly via DOM APIs avoids that risk entirely.
      doc.title = label;
      Object.assign(doc.documentElement.style, { height: '100%' });
      // A popup starts as a bare, unstyled document — it never gets the host
      // page's own font/CSS reset, so set the library's own font stack
      // explicitly rather than silently falling back to the browser default.
      Object.assign(doc.body.style, {
        margin: '0', height: '100vh', overflow: 'hidden', display: 'flex', flexDirection: 'column',
        fontFamily: FONT.family });
      // The popup's documentElement has none of the host page's --wmap-* theme
      // values (it's an unrelated document) — copy them across, and keep them
      // synced with later host theme changes (see syncWmapPopupTheme's own doc
      // comment). Read from the gallery's own render container, not
      // document.documentElement — getComputedStyle resolves the full cascade
      // *down to* that element, so this also picks up a --wmap-* override set
      // on some nearer ancestor of the container rather than on <html> itself
      // (a host that only themes its own widget wrapper, not the whole page).
      // Reading from documentElement would silently miss that and copy the
      // fallback defaults instead.
      copyWmapThemeTokens(container, doc.documentElement);
      const stopThemeSync = syncWmapPopupTheme(container, doc.documentElement, () => ctrl.setOptions({}));

      // In-content banner: the OS window/tab title is the only "title bar" a real
      // popup has, and some hosts (e.g. a decoration-less Tauri window) may not
      // show it at all — this guarantees the unlinked notice (see
      // unlinkAllDetachedWindows) is visible regardless of OS chrome.
      const banner = doc.createElement('div');
      banner.dataset.wmapWindowBanner = '1';
      banner.textContent = label;
      Object.assign(banner.style, {
        display: 'none', padding: `${SPACE.sm} ${SPACE.xl}`, fontSize: FONT.body, fontWeight: '700',
        background: CLR.warnBg, color: CLR.warnText, borderBottom: `1px solid ${CLR.warnBorder}`, flexShrink: '0' });
      doc.body.appendChild(banner);

      const popupBody = doc.createElement('div');
      Object.assign(popupBody.style, { flex: '1', minHeight: '0', display: 'flex', flexDirection: 'column' });
      doc.body.appendChild(popupBody);

      // Persistent identity header — unlike the (conditional, warning-styled)
      // unlink banner above, this is always visible: a real popup otherwise
      // relies solely on the OS window title bar for identity, which some
      // embedded hosts (a decoration-less Tauri window) don't show at all.
      // Same header+chevron pattern as the grid card, in this doc's own
      // document (a popup is a different Document than the page it opened
      // from — every element here must be created via `doc`, not the bare
      // global, or it silently belongs to the wrong document).
      const { wrap: identityWrap, metaPanel } = buildIdentityHeaderRow(doc, label, item.wafer.metadata ?? undefined);
      const headerRow = doc.createElement('div');
      Object.assign(headerRow.style, {
        display: 'flex', alignItems: 'center', padding: `${SPACE.md} ${SPACE.lg} ${SPACE.sm}`,
        borderBottom: `1px solid ${CLR.menuBorder}`, flexShrink: '0', gap: SPACE.sm });
      headerRow.appendChild(identityWrap);
      popupBody.appendChild(headerRow);

      const mapContainer = doc.createElement('div');
      Object.assign(mapContainer.style, {
        position: 'relative', flex: '1', minHeight: '0', overflow: 'hidden', display: 'flex', flexDirection: 'column' });
      if (metaPanel) mapContainer.appendChild(metaPanel);
      popupBody.appendChild(mapContainer);

      const ctrl = buildDetachedController(mapContainer, item, undefined, liveOptions);

      const closePollId = setInterval(() => { if (popupWin.closed) handlePopupClosed(id); }, 400);
      popupWin.addEventListener('pagehide', () => handlePopupClosed(id));

      detachedWindows.set(id, {
        id, ctrl, cardIndex, label, closePollId, stopThemeSync,
        close: () => { if (!popupWin.closed) popupWin.close(); },
        setTitle: (text) => {
          doc.title = text;
          banner.textContent = text;
          banner.style.display = 'block';
        } });
    } else {
      // Fallback: window.open() is unavailable (blocked popup, or an embedded
      // host like Tauri where it silently returns null) and no host opener is
      // registered. Rather than silently doing nothing, fall back to the
      // in-page non-modal floating window (openFloatingWindow) — the same
      // primitive the user-guide window uses. It can't be dragged outside the
      // host window's own bounds, but the detach feature stays usable instead
      // of being dead in every embedded host with no window.open() support.
      const handle = openFloatingWindow({
        title: label,
        onClose: () => handlePopupClosed(id),
        anchor: container });
      handle.contentWrap.style.flexDirection = 'column';
      augmentOverlayTitleWithMetadata(handle, label, item.wafer.metadata ?? undefined);
      const ctrl = buildDetachedController(handle.contentWrap, item, undefined, liveOptions);

      detachedWindows.set(id, {
        id, ctrl, cardIndex, label, closePollId: null,
        close: () => handle.close(),
        setTitle: (text) => {
          const titleEl = handle.box.querySelector<HTMLElement>('[data-wmap-window-title]');
          // Native `title` deliberately, and one of the few places it belongs:
          // this heading is `text-overflow: ellipsis`, and the browser showing the
          // full untruncated string on hover is precisely the wanted behaviour —
          // not a themed hint. Mirrors openOverlay's own `titleEl.title`.
          if (titleEl) { titleEl.textContent = text; titleEl.title = text; }
        } });
    }

    // Destroy the grid slot's own controller — the detached window is now the
    // only live view of this wafer. cardContainers[cardIndex] is left in
    // place (it's the card's layout box) but its content becomes a placeholder.
    cardControllers[cardIndex]?.destroy();
    cardControllers[cardIndex] = null;
    showDetachedPlaceholder(cardIndex, popupWin !== null);
    updateExpandBtn(cardIndex);
  }

  /**
   * Build the fresh renderWaferMap instance shared by the real-popup and
   * in-page-fallback detach paths, and the Insights tab's "open this wafer"
   * click. `testNumber`, when given (only from the Insights tab's boxplot
   * leaf-row click), opens straight into value mode on that test — matching
   * what the user was already looking at — instead of the gallery's shared
   * plot mode; omitted (the detach-window paths) leaves plot mode untouched.
   */
  function buildDetachedController(
    container: HTMLElement, item: WaferMapDisplayItem, testNumber?: number,
    /**
     * The source grid card's own live `getOptions()` snapshot — passed by
     * `openWindowForCard` so a card the user had switched to e.g. value mode
     * individually (different from the gallery's shared default) opens its
     * detached window in that same mode, rather than always reverting to
     * `sharedOpts`. Omitted by `openWafer` (findings/boxplot drilldown),
     * which opens an arbitrary lot wafer that may not have a live grid card
     * at all — see its own doc comment for why that one intentionally always
     * uses the gallery's shared mode instead.
     */
    liveOptions?: Partial<CardViewOptions>,
  ): CardController {
    const baseViewOptions = item.viewOptions ? { ...sharedOpts, ...item.viewOptions } : sharedOpts;
    const withLive = liveOptions ? { ...baseViewOptions, ...liveOptions } : baseViewOptions;
    const withMode = testNumber !== undefined
      ? { ...withLive, plotMode: 'value' as const, activeTest: testNumber }
      : withLive;
    // An expanded wafer ALWAYS carries its own legend, whatever the gallery is
    // doing. It is a window or a modal — the lot legend either does not exist
    // there or sits behind a backdrop — so there is nothing to inherit the key
    // from and nothing else offering the bin-highlight control. This overrides
    // `liveOptions`, which is a snapshot of the source card and would otherwise
    // carry the gallery's suppressed state straight into the detached view.
    const viewOptions = { ...withMode, showLegend: true, legendPosition: currentLegendStyle };
    const ctrl = renderWaferMapCard(container, item, {
      viewOptions,
      showTooltip:     true,
      padding:         cardPadding,
      statsSummary:    item.statsSummary,
      onSaveImage:     options.onSaveImage,
      onSaveText:      options.onSaveText,
      onClick:         item.onClick,
      onSelect:        item.onSelect,
      // This view is already detached into its own window (a real popup or
      // the in-page fallback) — there is nowhere sensible for it to "expand"
      // to, so suppress both the toolbar button and the `E` key entirely
      // rather than relying only on the runtime setExpandVisible(false)
      // below, which hides the button but does not gate the keyboard
      // shortcut (see renderWaferMap.ts's onKeyDown — it checks
      // showExpandButton, not the button's current visibility).
      showExpandButton: false,
      // Both callers (the real-popup path and the in-page floating-window
      // fallback, see openWindowForCard) now build their own persistent
      // expandable identity header before calling this function — the
      // standalone corner badge would just duplicate it.
      showIdentity: false });
    ctrl.setViewControlsVisible(true);
    ctrl.setSummaryVisible(true);
    ctrl.setExpandVisible(false);
    return ctrl;
  }

  /** Cleanup shared by both the popup's own OS-level close and the card's
   * reattach-button click. If still linked to a live grid slot, rebuilds that
   * slot's card fresh, first reading back the detached window's own live view
   * options (rotation, colour scheme, log scale, etc. — anything the user
   * changed from the popup's own full toolbar) so a rebuild doesn't silently
   * discard them; only options genuinely un-settable from that toolbar fall
   * back to the gallery's current shared options. If unlinked, there is no
   * slot to rebuild and the popup's controller is simply released. */
  function handlePopupClosed(id: number): void {
    const win = detachedWindows.get(id);
    if (!win) return; // already handled — poll/pagehide race, or reattach-button already ran this
    detachedWindows.delete(id);
    if (win.closePollId != null) clearInterval(win.closePollId);
    win.stopThemeSync?.();
    const liveOptions = win.ctrl.getOptions();
    win.ctrl.destroy();

    if (win.cardIndex === null) return; // unlinked — no grid slot to rebuild

    const cardIndex = win.cardIndex;
    const item = currentItems[cardIndex];
    if (!item) return; // defensive — shouldn't happen while linked
    const rebuiltItem: WaferMapDisplayItem = { ...item, viewOptions: liveOptions };
    currentItems[cardIndex] = rebuiltItem;
    const { card, ctrl, canvasWrapper, expandBtn } = buildCard(rebuiltItem, cardIndex, currentItems.length);
    cardContainers[cardIndex]?.parentElement?.replaceWith(card);
    cardControllers[cardIndex] = ctrl;
    cardContainers[cardIndex] = canvasWrapper;
    cardExpandBtns[cardIndex] = expandBtn;
  }

  /** Reattach-button click: close the detached window/box (which re-enters
   * this module via `handlePopupClosed` through the poll/pagehide/onClose
   * path — but we drive it here directly for an immediate response instead of
   * waiting on the poll, for the real-popup case). */
  function reattachOrDiscard(id: number): void {
    const win = detachedWindows.get(id);
    if (!win) return;
    win.close();
    handlePopupClosed(id);
  }

  /** Mark every currently open window as no longer tied to a grid slot, ahead of
   * a buildCards() rebuild. The window's own canvas/controller/toolbar keep
   * working exactly as before — only its "reattachable" relationship is lost,
   * since the rebuilt grid may no longer have an equivalent slot for it (e.g. a
   * stacked-mode transition collapsing many per-wafer cards into fewer aggregate
   * ones). The title/banner are updated so the user understands why the
   * reattach affordance is gone; the window can still be closed manually. */
  function unlinkAllDetachedWindows(): void {
    for (const win of detachedWindows.values()) {
      if (win.cardIndex === null) continue; // already unlinked
      win.cardIndex = null;
      win.setTitle(`${win.label} — unlinked from gallery`);
    }
  }

  // ── Gallery PNG download ───────────────────────────────────────────────────

  function downloadGalleryPng(): void {
    const canvases = [...gridEl.querySelectorAll<HTMLCanvasElement>('canvas')];
    if (!canvases.length) return;
    const N      = canvases.length;
    const cols   = Math.ceil(Math.sqrt(N));
    const rows   = Math.ceil(N / cols);
    const cellW  = canvases[0].width;
    const cellH  = canvases[0].height;
    const gap    = 8;
    // The CONTAINER's view, not the opener's: this composite export runs for a
    // gallery that may be living in a detached popup on another display, and
    // the opener's ratio would size the sheet for the wrong screen.
    const dpr    = (container.ownerDocument.defaultView ?? window).devicePixelRatio || 1;
    const headerH = Math.round(26 * dpr);
    const fontSize = Math.round(12 * dpr);
    const off   = container.ownerDocument.createElement('canvas');
    off.width   = cols * cellW + (cols - 1) * gap;
    off.height  = rows * (cellH + headerH) + (rows - 1) * gap;
    const ctx   = off.getContext('2d')!;
    // Composite export follows the on-screen theme (resolve once from the grid).
    const gTheme = resolveCanvasTheme(gridEl);
    ctx.fillStyle = gTheme.background;
    ctx.fillRect(0, 0, off.width, off.height);
    canvases.forEach((c, i) => {
      const col   = i % cols;
      const row   = Math.floor(i / cols);
      const x     = col * (cellW + gap);
      const y     = row * (cellH + headerH + gap);
      const label = c.closest('.wmap-gallery-card')?.querySelector<HTMLElement>('span')?.textContent ?? '';
      ctx.fillStyle = gTheme.surface;
      ctx.fillRect(x, y, cellW, headerH);
      ctx.fillStyle = gTheme.text;
      ctx.font      = `700 ${fontSize}px system-ui, sans-serif`;
      ctx.textAlign    = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, x + Math.round(10 * dpr), y + headerH / 2, cellW - Math.round(20 * dpr));
      ctx.drawImage(c, x, y + headerH);
    });
    off.toBlob(blob => {
      if (!blob) return;
      saveImageBlob(blob, downloadFilename, options.onSaveImage);
    });
  }

  // ── Controller ─────────────────────────────────────────────────────────────

  return {
    setItems(newItems: Array<WaferMapDisplayItem | WaferMapDisplayItemFactory>): void {
      originalItems = newItems.map(it => (typeof it === 'function' ? null : it) as WaferMapDisplayItem);
      const mode = sharedOpts.plotMode!;
      if (STACKED_MODES.has(mode)) {
        // If factories are still pending, keep the raw gallery build alive and let
        // the final factory resolution promote the gallery into stacked mode.
        const hasPendingFactories = newItems.some(it => typeof it === 'function');
        if (hasPendingFactories) {
          buildCards(newItems);
        } else {
          // Refresh lotSize and valueRange in case the wafer count changed.
          const extra = stackedSharedOpts(mode);
          sharedOpts = { ...sharedOpts, ...extra };
          buildCards(buildStackedItems(mode));
        }
      } else {
        buildCards(newItems);
      }
    },

    setOptions(partial: Partial<WaferViewOptions>): void {
      updateShared(partial, { fireCallback: false });
    },

    getOptions(): WaferViewOptions {
      return toPublicViewOptions(sharedOpts);
    },

    setFindingsNotice(notice: FindingsNotice | undefined): void {
      currentFindingsNotice = notice;
      renderGallerySummaryPanel();
    },

    setLotStatsSummary(summary: LotStatsSummary | undefined): void {
      currentLotStats = summary;
      // Lot analysis raises its own advisories (the test-count cap among them),
      // so a summary arriving late can introduce warnings the bar has not shown.
      refreshGalleryWarnings();
      if (gallerySummaryPanelEl) renderGallerySummaryPanel();
      refreshLotSummaryButton();
    },

    openUserGuide: openGuideWindow,

    destroy(): void {
      buildGeneration++; // cancel any pending factory resolvers
      // Close every open popup (linked or already-unlinked) and release its
      // controller — unlike a linked grid card, a detached card's own controller
      // was already destroyed at detach time, so there's no grid-side destroy
      // loop that would otherwise reach it.
      for (const win of [...detachedWindows.values()]) {
        if (win.closePollId != null) clearInterval(win.closePollId);
        win.close();
        win.ctrl.destroy();
      }
      detachedWindows.clear();
      for (const ctrl of cardControllers) if (ctrl) ctrl.destroy();
      cardControllers = [];
      getOpenMenu()?.remove();
      gridResizeObserver.disconnect();
      // Cancel any frame still queued by that observer, or it fires against a
      // torn-down gallery after destroy().
      if (gridResizeQueued) {
        (container.ownerDocument.defaultView ?? window).cancelAnimationFrame(gridResizeQueued);
        gridResizeQueued = 0;
      }
      container.ownerDocument.removeEventListener('click', closeOpenMenu, true);
      window.removeEventListener('blur', onWindowBlur);
      disposeOverlayZ();
      // Shared singleton — hide, never destroy (other instances may use it).
      hideTooltip();
      // Removes stickyHeaderEl and everything under it — the chrome row (identity
      // pill + toolbar) and the bin legend — so no empty node is left behind in
      // `container`.
      stickyHeaderEl.remove();
      bodyEl.remove();
      gallerySummaryPanelEl?.remove();
      insightsTab?.destroy();
    } };
}
