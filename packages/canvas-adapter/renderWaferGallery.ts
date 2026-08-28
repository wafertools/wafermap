import type { PlotMode } from '../renderer/buildView.js';
import { getUniqueTestNumbers, resolveTestNumber, findTestDef } from '../renderer/buildView.js';
import { getColorScheme } from '../renderer/colorSchemes.js';
import { metadataValueColor } from '../renderer/colorMap.js';
import { resolveCanvasTheme } from './canvasTheme.js';
import { ICONS } from './icons.js';
import { CLR, sevColor, ROTATIONS, MODE_LABELS, BIN_LEGEND_MODES, STACKED_MODES, Z_ABOVE, applyOverlayZ, getTooltip, hideTooltip, createToolbarHelpers, buildModeMenuEl, openDetachWindow, openFloatingWindow, openModal, openReportModal, copyWmapThemeTokens, syncWmapPopupTheme, openUserGuideWindow, makePaletteBtn, makeLogScaleBtn, makeLegendStyleBtn, makeOverlaysBtn, makeOrientationBtn, overlayRootFor, menuLayerFor, saveImageBlob, markMenuTrigger, wireMenuA11y, wireExpandToggle, passFailMenuRows, requestedPassFailDisplay, logWmapVersionOnce, type ModeEntry, type SaveImageHandler, type SaveTextHandler, type CheckMenuRow, type UserGuideExtension, type OverlayHandle , buildDataModeEntries, metadataKeyHasData, metadataModeEntry} from './toolbar.js';
import type { Die } from '../core/dies.js';
import { aggregateValues, aggregateBinCounts } from '../core/aggregates.js';
import type { AggregationMethod } from '../core/aggregates.js';
import { renderWaferMap } from './renderWaferMap.js';
import type { WaferViewOptions, WaferMapController } from './renderWaferMap.js';
import { classifyChanged } from './renderWaferMap.js';
import type { RenderableWaferMap } from './renderWaferMap.js';
import type { BinDef } from '../renderer/buildWaferMap.js';
import { buildWaferMap, dieHasTestData, getTestPassStatus, isParametricTest } from '../renderer/buildWaferMap.js';
import type { LotStatsSummary, StatsFinding, StatsSummary } from '../stats/types.js';
import { analyzeWaferMap } from '../stats/analyzeWaferMap.js';
import { collectWarnings, buildWarningsMenuEl, severityOf, type WarningsOptions, type WaferWarning } from './warnings.js';
import { compareNatural } from '../core/utils.js';
import type { SummaryPanelOptions } from './summaryPanel.js';
import { createSummaryPanelEl, buildMetadataStripRow, buildCompactMetadataRows, metadataEntries, renderLotSummaryContent } from './summaryPanel.js';
import type { FindingsFilter } from '../stats/filterFindings.js';
import { prettyKey } from '../stats/facets.js';
import { escHtml, renderSection, renderSeverityBadge, reportStyles } from '../stats/reportHtml.js';
import { createInsightsTab, type InsightsOptions } from './insightsTab.js';
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
  /** Legend position for bin modes. Default 'default'. */
  legendPosition?:       'default' | 'compact' | 'bottom' | 'top' | 'left' | 'floating';
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
  /** Padding inside each card canvas in CSS pixels. Default 6. */
  cardPadding?:          number;
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
  /**
   * Format to use for unitless values outside the normal display range [0.1, 9999].
   * `'engineering'` (default): multiples-of-3 exponent notation (e.g. `12E-6`).
   * `'si'`: SI prefix with no unit suffix (e.g. `12 µ`).
   * Values with a unit always use SI prefix regardless of this setting.
   */
  fallbackFormat?:         'si' | 'engineering';
  /**
   * Show the plot mode selector in the gallery control bar. Default true.
   * Set to false when the host application manages mode switching itself.
   */
  showPlotModeSelector?:   boolean;
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
   * Display preferences for the lot-wide "View die list" link inside the
   * Summary panel — every die across every wafer, pooled, with a Wafer
   * column and CSV export. **On by default** whenever `summaryPanel` is
   * reachable at all, since that panel is the link's only home; pass
   * `{ enabled: false }` to hide it. See `DieListDisplayOptions` and wmap's
   * own coordinate-less die-list table, which this reuses.
   */
  dieList?:                DieListDisplayOptions;
  /**
   * Bin numbers treated as pass for yield calculation in the summary panel.
   * Defaults to `[1]`. Must match the `passBins` passed to `analyzeWaferLot` / `buildWaferMap`
   * to ensure the summary panel yield label is consistent with the rest of the display.
   */
  passBins?:               number[];
  /**
   * Fix the number of columns in the gallery grid. When set, overrides the
   * auto-computed minimum card width and the toolbar columns control.
   * Omit (default) to let the gallery auto-size cards based on die pitch.
   */
  columns?:                number;
  /**
   * Cap each gallery card's rendered width and height at this many CSS pixels.
   * Cards pack from the left rather than stretching to fill the grid width.
   *
   * Omit it and the cap is derived from die density: 480px for an ordinary
   * wafer, widening (to at most 720px) for high-DPW wafers that need the room
   * to keep dies readable. Set it to take hard control instead — an explicit
   * value is never widened, so you own the readability trade-off at high DPW.
   */
  maxSize?:                number;
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
  /** Update the fallback format for unitless values across all cards. */
  setFallbackFormat(format: 'si' | 'engineering'): void;
  /** Replace the lot-level stats summary used by the built-in Summary panel. */
  setLotStatsSummary(summary: LotStatsSummary | undefined): void;
  /**
   * Set the number of columns in the gallery grid. Pass `undefined` to restore
   * the auto-computed layout based on die pitch.
   */
  setColumns(columns: number | undefined): void;
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
 * One clickable swatch+label row in the gallery's DOM legend strip — shared by the bin
 * (hardBin/softBin) and metadata legend branches in `rebuildLegend()` so the two can never
 * drift apart in markup/styling.
 */
function renderLegendSwatchRow(
  container: HTMLElement,
  opts: { color: string; label: string; isActive: boolean; onClick: () => void },
): void {
  const entry = container.ownerDocument.createElement('div');
  Object.assign(entry.style, {
    display: 'flex', alignItems: 'center', gap: '5px', cursor: 'pointer',
    userSelect: 'none', padding: '2px 4px', borderRadius: '3px',
  });

  const swatch = container.ownerDocument.createElement('span');
  Object.assign(swatch.style, {
    display: 'inline-block', width: '13px', height: '13px', flexShrink: '0',
    background: opts.color,
    border: opts.isActive ? `2px solid ${CLR.iconActive}` : `1px solid ${CLR.menuBorder}`,
    borderRadius: '2px', boxSizing: 'border-box',
  });

  const lbl = container.ownerDocument.createElement('span');
  lbl.textContent = opts.label;
  Object.assign(lbl.style, {
    fontWeight: opts.isActive ? '700' : '400',
    color:      opts.isActive ? CLR.iconActive : CLR.text,
    whiteSpace: 'nowrap',
  });

  entry.appendChild(swatch);
  entry.appendChild(lbl);

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
  const cardPadding          = options.cardPadding          ?? 6;
  const downloadFilename     = options.downloadFilename     ?? 'wafer-gallery';
  let currentColumns         = options.columns;
  const showPlotModeSelector = options.showPlotModeSelector ?? true;
  const showHelpButton       = options.showHelpButton       ?? false;
  const userGuideExtension   = options.userGuideExtension;
  const insightsEnabled      = options.insights?.enabled ?? false;
  // Host-supplied overlay stacking (no-op when undefined; safe high default
  // applies). Restored on destroy() via the returned disposer.
  const disposeOverlayZ      = applyOverlayZ(options.zIndex);
  const summaryPanelOpts      = options.summaryPanel;
  const passBins             = options.passBins             ?? [1];
  let currentFallbackFormat  = options.fallbackFormat;
  let currentLotStats        = options.lotStatsSummary;
  let currentLegendStyle     = options.legendPosition ?? 'default' as 'default' | 'compact' | 'bottom' | 'top' | 'left' | 'floating';

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
        : 'This lot has no shared colour bar for value mode, so each map keeps its own';
    }
    return null;
  }

  /** Push the effective per-card legend state to every card. */
  function applyPerCardLegend(): void {
    const showLegend = perCardLegend || perCardLegendBlockedReason() !== null;
    for (const ctrl of cardControllers) if (ctrl) ctrl.setOptions({ showLegend });
  }

  let sharedOpts: WaferViewOptions = {
    plotMode:               'hardBin',
    colorScheme:            'default',
    showDieLabels:               false,
    showRingBoundaries:     false,
    showQuadrantBoundaries: false,
    ringCount:              4,
    rotation:               0,
    flipX:                  false,
    flipY:                  false,
    ...options.viewOptions,
  };

  let cardControllers: (WaferMapController | null)[] = [];
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
    ctrl: WaferMapController;      // live controller rendered inside the detached document
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
  let gallerySummaryTab: 'lot' | 'wafers' = 'lot';
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
  const { makeBtn, setActive, makeSep, makeMenuRow, makeMenuSection, makeDropdown, makeCheckMenuBtn, closeOpenMenu, getOpenMenu, setOpenMenu } = tbHelpers;
  // container.ownerDocument, not the bare global — matches renderWaferMap.ts's
  // own fix for the same gap (see its comment): a host could in principle
  // mount the gallery into a container that belongs to a different document.
  container.ownerDocument.addEventListener('click', closeOpenMenu, true);
  // Window focus loss (alt-tab / app switch, notably in a Tauri WebView) does
  // not fire mouseleave, which would leave a toolbar tooltip lingering visible.
  const onWindowBlur = () => hideTooltip();
  window.addEventListener('blur', onWindowBlur);

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

  // Tab row shown when both lot stats and per-wafer findings are present.
  function buildPanelTabRow(): HTMLDivElement {
    const row = container.ownerDocument.createElement('div');
    Object.assign(row.style, {
      display:       'flex',
      gap:           '4px',
      marginBottom:  '10px',
      borderBottom:  `1px solid ${CLR.menuBorder}`,
      paddingBottom: '8px',
    });
    for (const tab of (['lot', 'wafers'] as const)) {
      const btn = container.ownerDocument.createElement('button');
      btn.type = 'button';
      // "Wafers" was a lie by omission: this tab lists only wafers that HAVE
      // findings, so a 13-wafer lot showed 8 rows — and the two lowest-yielding
      // wafers, having no findings, were among the five missing. A user
      // scanning for problem wafers read the absence as "these are fine".
      btn.textContent = tab === 'lot' ? 'Lot' : 'Findings';
      const active = gallerySummaryTab === tab;
      Object.assign(btn.style, {
        border:       'none',
        borderRadius: '4px',
        padding:      '2px 8px',
        fontSize:     '11px',
        cursor:       'pointer',
        fontWeight:   active ? '600' : '400',
        background:   active ? CLR.bgActive : 'transparent',
        color:        active ? CLR.iconHover : CLR.icon,
      });
      btn.addEventListener('click', () => {
        gallerySummaryTab = tab;
        clearFindingHighlight();
        clearDieZoneHighlight();
        renderGallerySummaryPanel();
      });
      row.appendChild(btn);
    }
    return row;
  }

  // Per-wafer findings index — list of wafers with findings; clicking opens the modal.
  function renderPerWaferIndex(): void {
    if (!gallerySummaryPanelEl) return;
    gallerySummaryPanelEl.innerHTML = '';

    // Tab row only when lot findings also exist
    if (currentLotStats) {
      gallerySummaryPanelEl.appendChild(buildPanelTabRow());
    }

    // Collect wafers that have findings — from item.statsSummary or lotStats.perWafer
    const wafersWithFindings: Array<{ index: number; item: WaferMapDisplayItem; unusualCount: number; notableCount: number; totalCount: number }> = [];
    for (let i = 0; i < originalItems.length; i++) {
      const item = originalItems[i];
      if (!item) continue;
      const findings = perWaferSummary(i)?.findings ?? [];
      if (!findings.length) continue;
      const unusualCount = findings.filter(f => f.severity === 'unusual').length;
      const notableCount = findings.filter(f => f.severity === 'notable').length;
      wafersWithFindings.push({ index: i, item, unusualCount, notableCount, totalCount: findings.length });
    }

    // State the denominator. The list is a subset by design; saying so is what
    // stops it reading as the full wafer list.
    if (originalItems.length > 0) {
      const heading = container.ownerDocument.createElement('div');
      const withCount = wafersWithFindings.length;
      const total = originalItems.filter(Boolean).length;
      heading.textContent = withCount === 0
        ? `No findings on any of the ${total} wafers`
        : `${withCount} of ${total} wafer${total === 1 ? '' : 's'} with findings`;
      Object.assign(heading.style, {
        fontSize: '11px', color: CLR.label, marginBottom: '8px',
      } as Partial<CSSStyleDeclaration>);
      gallerySummaryPanelEl.appendChild(heading);
    }

    // "Report all wafers" button
    if (wafersWithFindings.length > 0) {
      const reportBtn = container.ownerDocument.createElement('button');
      reportBtn.type = 'button';
      reportBtn.textContent = 'Findings report';
      Object.assign(reportBtn.style, {
        border:       `1px solid ${CLR.menuBorder}`,
        borderRadius: '4px',
        padding:      '3px 8px',
        marginBottom: '10px',
        fontSize:     '10px',
        color:        CLR.iconHover,
        background:   'none',
        cursor:       'pointer',
        display:      'block',
        width:        '100%',
        textAlign:    'left',
      });
      reportBtn.addEventListener('click', () => {
        const title = `Findings report — ${wafersWithFindings.length} wafer${wafersWithFindings.length > 1 ? 's' : ''}`;
        const generatedAt = new Date().toLocaleString();
        const sections = wafersWithFindings
          .map(({ item, index }) => {
            const summary = perWaferSummary(index)!;
            const label = item.label ?? `W${index + 1}`;
            const rows = summary.findings.map(f =>
              `<li>${renderSeverityBadge(f.severity)} ${escHtml(f.summary)}</li>`,
            ).join('');
            return renderSection(escHtml(label), `<ul style="margin:0;padding-left:18px;list-style:none">${rows}</ul>`);
          }).join('\n');
        const html = `<!DOCTYPE html>
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
  ${sections}
</main>
</body>
</html>`;
        openReportModal(html, { anchor: container });
      });
      gallerySummaryPanelEl.appendChild(reportBtn);
    }

    // Wafer rows
    if (wafersWithFindings.length === 0) {
      const empty = container.ownerDocument.createElement('div');
      Object.assign(empty.style, { color: CLR.icon, fontSize: '11px', padding: '4px 0' });
      empty.textContent = 'No findings on any wafer.';
      gallerySummaryPanelEl.appendChild(empty);
    } else {
      for (const { index, item, unusualCount, notableCount, totalCount } of wafersWithFindings) {
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
          marginBottom:   '4px',
          border:         'none',
          borderLeft:     `3px solid ${sevColor(topSeverity)}`,
          borderRadius:   '3px',
          background:     CLR.bgHover,
          cursor:         'pointer',
          fontSize:       '11px',
          textAlign:      'left',
          boxSizing:      'border-box',
        });
        row.addEventListener('mouseover', () => { row.style.background = CLR.bgActive; });
        row.addEventListener('mouseout',  () => { row.style.background = CLR.bgHover; });

        const labelSpan = container.ownerDocument.createElement('span');
        labelSpan.textContent = item.label ?? `W${index + 1}`;
        Object.assign(labelSpan.style, {
          color:         CLR.iconHover,
          overflow:      'hidden',
          textOverflow:  'ellipsis',
          whiteSpace:    'nowrap',
        });

        const badge = container.ownerDocument.createElement('span');
        badge.textContent = String(badgeCount);
        // The bare number said nothing about what it counted. The row is a
        // button, so its accessible name is what a screen reader announces —
        // spell the whole thing out there rather than leaving "W08, 8".
        row.setAttribute('aria-label',
          `${item.label ?? `W${index + 1}`} — ${badgeCount} finding${badgeCount === 1 ? '' : 's'}`
          + `${unusualCount ? `, ${unusualCount} unusual` : ''} — view wafer`);
        Object.assign(badge.style, {
          marginLeft:   '6px',
          flexShrink:   '0',
          background:   sevColor(topSeverity),
          color:        '#fff',
          borderRadius: '8px',
          padding:      '1px 5px',
          fontSize:     '10px',
          fontWeight:   '600',
        });

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

    if (gallerySummaryTab === 'lot' && currentLotStats) {
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
        testDefs:   originalItems.find(it => it?.testDefs?.length)?.testDefs,
        passBins,
        ringCount:      sharedOpts.ringCount,
        colorScheme:    sharedOpts.colorScheme,
        fallbackFormat: currentFallbackFormat,
        activeFindingId: activeLotFindingId,
        warnings: (options.warnings?.display ?? true) ? currentWarnings : [],
        findingsFilter: lotFindingsFilter,
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
        onWaferClick: (waferIndex) => {
          applyFindingHighlight([waferIndex]);
        },
        dieListOptions: options.dieList,
      });
      // Prepend tab row if per-wafer findings also exist
      if (hasAnyPerWaferFindings()) {
        gallerySummaryPanelEl.insertBefore(buildPanelTabRow(), gallerySummaryPanelEl.firstChild);
      }
    } else {
      renderPerWaferIndex();
    }
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

  function clearLotFindingHighlight(): void {
    activeLotFindingId = null;
    clearFindingHighlight();
    clearDieZoneHighlight();
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
    const { kind, index } = finding.variable;
    if (kind === 'test') {
      updateShared({ plotMode: 'value', activeTest: index ?? 0, highlightBin: undefined }, { fireCallback: false });
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
    display:       'inline-flex',
    flexDirection: 'row',
    alignItems:    'center',
    gap:           '0',
    background:    CLR.menuBg,
    border:        `1px solid ${CLR.menuBorder}`,
    borderRadius:  '6px',
    padding:       '3px 4px',
    marginBottom:  '10px',
    boxShadow:     '0 1px 4px rgba(0,0,0,0.10)',
    flexWrap:      'wrap',
    minWidth:      '0',
    overflowX:     'auto',
  });

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
    const testDefs  = originalItems.find(it => it?.testDefs?.length)?.testDefs;
    // Value mode is available for any per-test data — numeric values or recorded
    // pass/fail verdicts (functional tests). Stacked values need numeric values.
    // Gallery aggregates across its own items, so stacked modes are always offered.
    const { testEntries, binEntries, stackedEntries } =
      buildDataModeEntries(dies, testDefs, { includeStacked: true });

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

  const itemsHaveCustomColors = (): boolean =>
    currentItems.flatMap(it => it ? [...(it.hbinDefs ?? []), ...(it.sbinDefs ?? [])] : []).some(d => d.color);

  const { btn: btnPalette, sync: syncPaletteBtn } = makePaletteBtn(
    tbHelpers,
    () => sharedOpts.plotMode ?? 'hardBin',
    () => sharedOpts.colorScheme ?? 'default',
    itemsHaveCustomColors,
    v => updateShared({ colorScheme: v }),
    {
      get: () => sharedOpts.markFailingDies ?? false,
      set: (v) => updateShared({ markFailingDies: v }),
    },
  );
  syncPaletteBtn();

  const hasReticleInItems = items.some(it => typeof it !== 'function' && ((it as WaferMapDisplayItem).reticles?.length ?? 0) > 0);

  // Resolve the shared active test's def (the one all value cards show) — gates the
  // pass/fail display entries, the "Colorbar range" button, and the log-scale button,
  // mirroring single-map.
  function activeTestDefShared(): { testNumber: number; td: import('../renderer/buildWaferMap.js').TestDef | undefined } {
    const testDefs = originalItems.find(it => it?.testDefs?.length)?.testDefs;
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

  const btnOverlays = makeOverlaysBtn(
    tbHelpers,
    (): CheckMenuRow[] => [
      { label: 'Ring boundaries', active: !!sharedOpts.showRingBoundaries,     onClick: () => updateShared({ showRingBoundaries:   !sharedOpts.showRingBoundaries   }) },
      { label: 'Quadrant lines',  active: !!sharedOpts.showQuadrantBoundaries, onClick: () => updateShared({ showQuadrantBoundaries: !sharedOpts.showQuadrantBoundaries }) },
      { label: 'Die labels',      active: !!sharedOpts.showDieLabels,          onClick: () => updateShared({ showDieLabels:          !sharedOpts.showDieLabels          }) },
      { label: 'Reticle grid',    active: !!sharedOpts.showReticle,            enabled: hasReticleInItems, onClick: () => updateShared({ showReticle: !sharedOpts.showReticle }) },
      { label: 'XY indicator',    active: !!sharedOpts.showXYIndicator,        onClick: () => updateShared({ showXYIndicator:        !sharedOpts.showXYIndicator        }) },
      ...passFailMenuRows(
        {
          functionalActive: activeTestIsFunctional(),
          hasLimits: activeTestHasLimits() && !activeTestIsFunctional(),
          hasRecorded: activeTestHasRecordedStatus() && !activeTestIsFunctional(),
          display: requestedPassFailDisplay(sharedOpts),
        },
        d => updateShared({ passFailDisplay: d }),
      ),
    ],
    () => !!(sharedOpts.showRingBoundaries || sharedOpts.showQuadrantBoundaries ||
             sharedOpts.showDieLabels || sharedOpts.showReticle || sharedOpts.showXYIndicator ||
             requestedPassFailDisplay(sharedOpts) !== 'off'),
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
      blockedReason: perCardLegendBlockedReason,
    },
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

  if (showPlotModeSelector) galleryViewControlsEl.appendChild(btnMode);
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
      result: { warnings: originalItems.flatMap(it => it?.warnings ?? []) },
    });
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
      ? `${label} — wafers in this lot may be positionally wrong`
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
      const isOpen = insightsEl?.style.display !== 'none';
      setInsightsOpen(!isOpen);
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
  const legendEl = container.ownerDocument.createElement('div');
  // Stable hook for tests/tooling — same convention as barEl's
  // data-wmap-toolbar, added when this element stopped being container's
  // direct, position-fixed child (it moved inside stickyHeaderEl below), which
  // broke every `container.children[1]` lookup that assumed it.
  legendEl.dataset.wmapGalleryLegend = '1';
  Object.assign(legendEl.style, {
    display:       'flex',
    flexDirection: 'column',
    gap:           '6px',
    background:    CLR.menuBg,
    border:        `1px solid ${CLR.menuBorder}`,
    borderRadius:  '6px',
    padding:       '6px 10px',
    marginBottom:  '10px',
    boxShadow:     '0 1px 4px rgba(0,0,0,0.10)',
    fontSize:      '12px',
    lineHeight:    '1',
    boxSizing:     'border-box',
    width:         '100%',
    minWidth:      '0',
  });

  // ── Body row (grid + side drawer) ──────────────────────────────────────────

  const bodyEl = container.ownerDocument.createElement('div');
  Object.assign(bodyEl.style, {
    display:   'flex',
    flexDirection: 'row',
    gap:       '12px',
    alignItems: 'flex-start',
  });

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
  let insightsTab: ReturnType<typeof createInsightsTab> | null = null;
  let insightsEl: HTMLElement | null = null;
  if (insightsEnabled) {
    insightsTab = createInsightsTab({
      getItems: () => originalItems,
      getLotStats: () => currentLotStats,
      getColorSchemeName: () => sharedOpts.colorScheme ?? 'default',
      passBins,
      getRingCount: () => sharedOpts.ringCount ?? 4,
      defaultView: options.insights?.defaultView,
      // Leading "‹ Gallery" tab in the Insights tab bar — a visible way back
      // to the card grid, alongside the toolbar's icon toggle.
      backTab: { label: 'Gallery', onBack: () => setInsightsOpen(false) },
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
      },
    });
    insightsEl = insightsTab.el;
  }

  // Whether the Insights tab is currently showing — read by `rebuildLegend()`
  // so the shared metadata strip (`legendEl`) stays mounted in the same place
  // across both views instead of being a second, independent strip inside
  // Insights; only the bin-legend row (meaningless once the grid of cards is
  // replaced by the chart suite) is dropped when Insights is open.
  let insightsOpen = false;

  function setInsightsOpen(open: boolean): void {
    if (!insightsTab || !insightsEl) return;
    insightsOpen = open;
    insightsEl.style.display = open ? 'flex' : 'none';
    bodyEl.style.display = open ? 'none' : 'flex';
    galleryViewControlsEl.style.display = open ? 'none' : 'inline-flex';
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
    if (open) insightsTab.render();
  }

  // ── Grid container ─────────────────────────────────────────────────────────

  const TARGET_DIE_PX = 4;   // minimum readable die pixel size at gallery scale
  const MIN_CARD_PX   = 240; // absolute floor
  // Bounds for the *default* card size cap (used when `options.maxSize` is not
  // set). The cap is derived from die pitch rather than fixed, because a single
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

  // An explicit `maxSize` is a hard cap and is never widened for density — the
  // caller asked for a specific ceiling and owns the readability trade-off.
  // Otherwise the cap is derived per-density in refreshCardSizeCap().
  const explicitMaxSize = options.maxSize;
  let currentMaxCardPx = explicitMaxSize ?? CARD_CAP_FLOOR_PX;

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
   * than whatever resolved last. No-op when the caller set an explicit maxSize.
   * Returns true when the cap changed, so callers can re-apply it to live cards.
   */
  function refreshCardSizeCap(its: (WaferMapDisplayItem | null)[]): boolean {
    if (explicitMaxSize != null) return false;
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
    gap:                     '12px',
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
    isolation:               'isolate',
  });

  // Build gallery summary panel.
  // Explicit placement: always visible persistent panel.
  // Auto-mount (lotStatsSummary or per-wafer findings, no placement): toggled via toolbar button.
  // defaultOpen: true starts the auto-mounted panel visible.
  {
    // Set initial tab: 'lot' if lot stats present (preserves existing behaviour), else 'wafers'.
    gallerySummaryTab = currentLotStats ? 'lot' : 'wafers';

    if (summaryPanelOpts?.placement) {
      const placement = summaryPanelOpts.placement;
      gallerySummaryPanelEl = createSummaryPanelEl(placement, container.ownerDocument);
      gallerySummaryPanelEl.style.maxHeight = 'calc(100vh - 80px)';
      gallerySummaryPanelEl.style.position  = 'sticky';
      gallerySummaryPanelEl.style.top       = '8px';
      gallerySummaryPanelEl.style.display   = 'flex';
      gallerySummaryPanelEl.style.flexDirection = 'column';
    } else if (currentLotStats || hasAnyPerWaferFindings()) {
      const openOnMount = !!summaryPanelOpts?.defaultOpen;
      gallerySummaryPanelEl = createSummaryPanelEl('right', container.ownerDocument);
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
    background: CLR.menuBg,
  } as Partial<CSSStyleDeclaration>);
  stickyHeaderEl.appendChild(barEl);
  stickyHeaderEl.appendChild(legendEl);
  container.appendChild(stickyHeaderEl);
  container.appendChild(bodyEl);
  if (insightsEl) container.appendChild(insightsEl);

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

    // Collect unique bins — use hbin or sbin depending on active mode.
    const binSet = new Set<number>();
    if (hasBinLegendMode && !isMetadataMode) {
      for (const item of resolvedItems) {
        for (const die of item.dies) {
          if (die.partial) continue;
          const b = mode === 'softBin' ? die.sbin : die.hbin;
          if (b != null) binSet.add(b);
        }
      }
    }
    const bins = hasBinLegendMode && !isMetadataMode ? [...binSet].sort((a, b) => a - b) : [];

    // 'metadata' mode's own values — string-keyed, collected across every visible
    // card the same way bin counts are, sorted alphabetically (same determinism
    // as buildView.ts's color assignment).
    const metadataValueSet = new Set<string>();
    if (hasBinLegendMode && isMetadataMode && activeMetadataKey) {
      for (const item of resolvedItems) {
        for (const die of item.dies) {
          if (die.partial) continue;
          const raw = die.metadata?.[activeMetadataKey];
          if (raw !== undefined && raw !== null &&
              (typeof raw === 'string' || typeof raw === 'number' || typeof raw === 'boolean')) {
            metadataValueSet.add(String(raw));
          }
        }
      }
    }
    // Natural order — must match buildView's colour-assignment order, or this
    // lot-level strip would list values in a different order to the per-card legends.
    const metadataValues = hasBinLegendMode && isMetadataMode ? [...metadataValueSet].sort(compareNatural) : [];

    if (!metaRow && !bins.length && !metadataValues.length) {
      legendEl.style.display = 'none';
      return;
    }
    legendEl.style.display = 'flex';

    if (metaRow) legendEl.appendChild(metaRow);

    if (!bins.length && !metadataValues.length) return;

    const binsRow = container.ownerDocument.createElement('div');
    Object.assign(binsRow.style, { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px 14px' });
    if (metaRow) Object.assign(binsRow.style, { borderTop: `1px solid ${CLR.separator}`, paddingTop: '6px' });
    legendEl.appendChild(binsRow);

    const scheme    = getColorScheme(sharedOpts.colorScheme);
    const activeBin = sharedOpts.highlightBin;

    if (isMetadataMode) {
      const activeMetadataValue = sharedOpts.highlightMetadataValue;
      const activeMetadataFieldDef = currentItems.flatMap(it => it?.metadataFields ?? []).find(f => f.key === activeMetadataKey);
      metadataValues.forEach((value, index) => {
        const isActive = activeMetadataValue === value;
        const valueDef = activeMetadataFieldDef?.values?.find(v => v.value === value);
        const color = valueDef?.color ?? metadataValueColor(index);
        renderLegendSwatchRow(binsRow, {
          color, isActive, label: valueDef?.label ?? value,
          onClick: () => {
            const next = sharedOpts.highlightMetadataValue === value ? undefined : value;
            updateShared({ highlightMetadataValue: next });
          },
        });
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

    for (const bin of bins) {
      const isActive = activeBin === bin;
      const binDef   = binDefMap?.get(bin);
      const color = (sharedOpts.colorScheme === 'custom' ? binDef?.color : undefined) ?? scheme.forBin(bin);
      renderLegendSwatchRow(binsRow, {
        color, isActive, label: binDef?.name ? `${bin} · ${binDef.name}` : `Bin ${bin}`,
        onClick: () => {
          const next = sharedOpts.highlightBin === bin ? undefined : bin;
          updateShared({ highlightBin: next });
        },
      });
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
        stats: { ...summary.stats, isLotStack: true, aggregationMethod, lotSize },
      };
    }

    if (mode === 'stackedValues') {
      // Collect testDefs from items (now on WaferMapResult, not sharedOpts).
      // Functional tests are excluded: mean/median/σ of a pass/fail outcome is
      // meaningless. (A dedicated stacked functional representation — per-position
      // fail count across the lot, countBin-style — is a deferred enhancement.)
      const itemDefs = resolvedItems.find(it => it.testDefs?.length)?.testDefs;
      let defs = itemDefs?.filter(isParametricTest);

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
          ),
        };
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
          ),
        };
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
          ),
        };
      });
    }

    return resolvedItems;
  }

  // Extra shared options required for stacked modes (colour scale / lot size metadata).
  function stackedSharedOpts(mode: PlotMode): Partial<WaferViewOptions> {
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
  const BIN_SCHEMES = new Set(['default', 'accessible', 'custom']);

  function updateShared(partial: Partial<WaferViewOptions>, { fireCallback = true } = {}): void {
    const prevMode = sharedOpts.plotMode;
    const prevLegendBlocked = perCardLegendBlockedReason() !== null;
    sharedOpts = { ...sharedOpts, ...partial };
    const newMode    = sharedOpts.plotMode!;
    const nowStacked = STACKED_MODES.has(newMode);
    const wasStacked = prevMode !== undefined && STACKED_MODES.has(prevMode);
    const hasPendingFactories = pendingFactoryCount > 0;

    // Switching into a bin mode: reset to default if scheme is not bin-compatible.
    if (partial.plotMode !== undefined && partial.plotMode !== prevMode) {
      const isBinMode = newMode === 'hardBin' || newMode === 'softBin';
      if (isBinMode && !BIN_SCHEMES.has(sharedOpts.colorScheme ?? '')) {
        sharedOpts = { ...sharedOpts, colorScheme: 'default' };
      }
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
    if (partial.colorScheme !== undefined || modeChanged) renderGallerySummaryPanel();
    syncLogScaleBtn();
    syncColorbarRangeBtn();
    if (fireCallback) {
      const changed = Object.keys(partial) as (keyof WaferViewOptions)[];
      options.onViewOptionsChange?.(sharedOpts, changed, classifyChanged(changed));
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
    Object.assign(wrap.style, { display: 'flex', alignItems: 'center', gap: '4px', flex: '1', minWidth: '0' });
    const labelEl = doc.createElement('span');
    labelEl.textContent = label;
    Object.assign(labelEl.style, {
      fontWeight: '700', fontSize: '13px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
    });
    wrap.appendChild(labelEl);

    const entries = metadataEntries(metadata ?? {});
    let metaPanel: HTMLDivElement | null = null;
    if (entries.length > 0) {
      const chevron = doc.createElement('span');
      Object.assign(chevron.style, { fontSize: '12px', lineHeight: '1', color: CLR.label, flexShrink: '0' });
      chevron.textContent = '▾';
      wrap.appendChild(chevron);
      Object.assign(wrap.style, { cursor: 'pointer' });

      metaPanel = doc.createElement('div');
      metaPanel.dataset.wmapCardMetaPanel = '1';
      Object.assign(metaPanel.style, {
        position:     'absolute',
        top:          '0', left: '0', right: '0',
        zIndex:       Z_ABOVE,
        background:   CLR.menuBg,
        borderBottom: `1px solid ${CLR.menuBorder}`,
        boxShadow:    '0 2px 6px rgba(0,0,0,0.15)',
        padding:      '8px 10px',
        fontSize:     '11px',
        display:      'none',
      } as Partial<CSSStyleDeclaration>);
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
      display: 'flex', alignItems: 'center', gap: '4px', flex: '1', minWidth: '0', cursor: 'pointer',
    });
    titleParent?.insertBefore(titleWrap, titleEl);
    titleWrap.appendChild(titleEl);
    const chevron = container.ownerDocument.createElement('span');
    Object.assign(chevron.style, { fontSize: '12px', lineHeight: '1', color: CLR.label, flexShrink: '0' });
    chevron.textContent = '▾';
    titleWrap.appendChild(chevron);

    const metaPanel = container.ownerDocument.createElement('div');
    metaPanel.dataset.wmapCardMetaPanel = '1';
    Object.assign(metaPanel.style, {
      position: 'absolute', top: '0', left: '0', right: '0', zIndex: Z_ABOVE,
      background: CLR.menuBg, borderBottom: `1px solid ${CLR.menuBorder}`,
      boxShadow: '0 2px 6px rgba(0,0,0,0.15)', padding: '8px 10px', fontSize: '11px', display: 'none',
    } as Partial<CSSStyleDeclaration>);
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

  function buildCard(item: WaferMapDisplayItem, cardIndex: number, _totalItems: number): { card: HTMLDivElement; ctrl: WaferMapController; canvasWrapper: HTMLDivElement; expandBtn: HTMLButtonElement } {
    const card = container.ownerDocument.createElement('div');
    card.className = 'wmap-gallery-card';
    Object.assign(card.style, {
      background:    CLR.menuBg,
      border:        `1px solid ${CLR.menuBorder}`,
      borderRadius:  '10px',
      overflow:      'hidden',
      display:       'flex',
      flexDirection: 'column',
      position:      'relative',
      aspectRatio:   '1',
      // Grid items default to `stretch`; a max-size smaller than the track
      // clamps the card there and falls back to start (top-left) alignment
      // for the leftover cell space — no justify-items/-self override needed.
      maxWidth:      `${currentMaxCardPx}px`,
      maxHeight:     `${currentMaxCardPx}px`,
    });

    const header = container.ownerDocument.createElement('div');
    Object.assign(header.style, {
      display:        'flex',
      alignItems:     'center',
      padding:        '8px 10px 6px',
      borderBottom:   `1px solid ${CLR.menuBorder}`,
      flexShrink:     '0',
      gap:            '6px',
    });
    const { wrap: identityWrap, metaPanel } = buildIdentityHeaderRow(document, item.label ?? '', item.wafer.metadata ?? undefined);
    header.appendChild(identityWrap);

    // Expand button — toggles between "detach into its own window" and, once
    // detached, "reattach to this grid slot" (see updateExpandBtn).
    const expandBtn = container.ownerDocument.createElement('button');
    expandBtn.dataset.wmapExpandBtn = '1';
    expandBtn.title = 'Open full view';
    expandBtn.innerHTML = ICONS.expand; // unified expand icon (was an inline polyline SVG)
    Object.assign(expandBtn.style, {
      display:         'flex',
      alignItems:      'center',
      justifyContent:  'center',
      border:          `1px solid ${CLR.menuBorder}`,
      borderRadius:    '4px',
      background:      CLR.panelBg,
      color:           CLR.label,
      padding:         '2px',
      cursor:          'pointer',
      flexShrink:      '0',
      width:           '22px',
      height:          '22px',
    });
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
      flexDirection: 'column',
    });
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
    const ctrl = renderWaferMap(canvasWrapper, item, {
      viewOptions:    { ...cardBaseOptions, showLegend: cardShowLegend },
      toolbarControls: 'full',
      showTooltip:     true,
      padding:         cardPadding,
      legendPosition:  currentLegendStyle,
      fallbackFormat:  currentFallbackFormat,
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
      showMetadataBadge: false,
    });
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
      btn.title = 'Reattach to gallery';
      btn.setAttribute('aria-label', 'Reattach to gallery');
      btn.onclick = () => reattachOrDiscard(win.id);
    } else {
      btn.innerHTML = ICONS.expand;
      btn.title = 'Open full view';
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
          borderRadius:  '10px',
          aspectRatio:   '1',
          display:       'flex',
          alignItems:    'center',
          justifyContent:'center',
        });
        const spinner = container.ownerDocument.createElement('span');
        spinner.textContent = '…';
        Object.assign(spinner.style, { color: CLR.label, fontSize: '18px' });
        placeholder.appendChild(spinner);
        gridEl.appendChild(placeholder);
        currentItems.push(null as unknown as WaferMapDisplayItem); // slot reserved
        cardControllers.push(null as unknown as WaferMapController);
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

    // Set 'custom' scheme if items have bin def colours and no explicit scheme was passed.
    const allDefs = currentItems.flatMap(it => it ? [...(it.hbinDefs ?? []), ...(it.sbinDefs ?? [])] : []);
    if (allDefs.some(d => d.color) && !options.viewOptions?.colorScheme) {
      sharedOpts = { ...sharedOpts, colorScheme: 'custom' };
    }

    // All sync items are now in currentItems — legend can be built from them.
    rebuildLegend();

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
      // If this item introduced per-wafer findings and no panel exists yet, create it now.
      if (!gallerySummaryPanelEl && !summaryPanelOpts?.placement && item.statsSummary?.findings.length) {
        if (!currentLotStats) gallerySummaryTab = 'wafers';
        gallerySummaryPanelEl = createSummaryPanelEl('right', container.ownerDocument);
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
    Object.assign(note.style, { color: CLR.label, fontSize: '12px', textAlign: 'center', padding: '0 12px' });
    wrapper.appendChild(note);
  }

  function openWindowForCard(cardIndex: number, item: WaferMapDisplayItem): void {
    // Guard re-entrancy — other callers (e.g. the findings-index row) could
    // race a double-open on the same card.
    for (const w of detachedWindows.values()) if (w.cardIndex === cardIndex) return;

    const label = item.label ?? 'Wafer map';
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
        fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
      });
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
        display: 'none', padding: '6px 12px', fontSize: '12px', fontWeight: '700',
        background: CLR.warnBg, color: CLR.warnText, borderBottom: `1px solid ${CLR.warnBorder}`, flexShrink: '0',
      });
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
        display: 'flex', alignItems: 'center', padding: '8px 10px 6px',
        borderBottom: `1px solid ${CLR.menuBorder}`, flexShrink: '0', gap: '6px',
      });
      headerRow.appendChild(identityWrap);
      popupBody.appendChild(headerRow);

      const mapContainer = doc.createElement('div');
      Object.assign(mapContainer.style, {
        position: 'relative', flex: '1', minHeight: '0', overflow: 'hidden', display: 'flex', flexDirection: 'column',
      });
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
        },
      });
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
        anchor: container,
      });
      handle.contentWrap.style.flexDirection = 'column';
      augmentOverlayTitleWithMetadata(handle, label, item.wafer.metadata ?? undefined);
      const ctrl = buildDetachedController(handle.contentWrap, item, undefined, liveOptions);

      detachedWindows.set(id, {
        id, ctrl, cardIndex, label, closePollId: null,
        close: () => handle.close(),
        setTitle: (text) => {
          const titleEl = handle.box.querySelector<HTMLElement>('[data-wmap-window-title]');
          if (titleEl) { titleEl.textContent = text; titleEl.title = text; }
        },
      });
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
    liveOptions?: Partial<WaferViewOptions>,
  ): WaferMapController {
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
    const viewOptions = { ...withMode, showLegend: true };
    const ctrl = renderWaferMap(container, item, {
      viewOptions,
      toolbarControls: 'full',
      showTooltip:     true,
      padding:         cardPadding,
      legendPosition:  currentLegendStyle,
      fallbackFormat:  currentFallbackFormat,
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
      showMetadataBadge: false,
    });
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
    const dpr    = window.devicePixelRatio || 1;
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
      return { ...sharedOpts };
    },

    setFallbackFormat(format: 'si' | 'engineering'): void {
      currentFallbackFormat = format;
      for (const ctrl of cardControllers) if (ctrl) ctrl.setFallbackFormat(format);
    },

    setLotStatsSummary(summary: LotStatsSummary | undefined): void {
      currentLotStats = summary;
      // Lot analysis raises its own advisories (the test-count cap among them),
      // so a summary arriving late can introduce warnings the bar has not shown.
      refreshGalleryWarnings();
      if (gallerySummaryPanelEl) renderGallerySummaryPanel();
      refreshLotSummaryButton();
    },

    setColumns(cols: number | undefined): void {
      setColumnsState(cols);
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
      // Removes stickyHeaderEl too — barEl and legendEl are its only children,
      // so once both are gone it's an empty node left behind in `container`.
      stickyHeaderEl.remove();
      bodyEl.remove();
      gallerySummaryPanelEl?.remove();
      insightsTab?.destroy();
    },
  };
}
