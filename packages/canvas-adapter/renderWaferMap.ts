import type { View, ViewOptions, PlotMode } from '../renderer/buildView.js';
import { buildView, buildHoverText, findTestDef, resolveTestNumber, getUniqueTestNumbers } from '../renderer/buildView.js';
import type { Die } from '../core/dies.js';
import type { Reticle } from '../core/reticle.js';
import { toCanvas, BIN_LEGEND_W, BIN_LEGEND_W_COMPACT, BIN_LEGEND_ADAPT_COMPACT, BIN_LEGEND_ADAPT_FLOATING, type ToCanvasOptions, type ViewportTransform, type BinLegendRow } from './toCanvas.js';
import { buildWaferMap, dieHasTestData, getTestPassStatus, isParametricTest } from '../renderer/buildWaferMap.js';
import type { TestDef, BinDef, MetadataFieldDef, ReticleConfig, WaferMapResult } from '../renderer/buildWaferMap.js';
import type { StatsFinding, StatsSummary } from '../stats/types.js';
import { analyzeWaferMap } from '../stats/analyzeWaferMap.js';
import { CLR, ROTATIONS, MODE_LABELS, Z_BASE, applyOverlayZ, getTooltip, hideTooltip, reparentTooltip, positionTooltip, createToolbarHelpers, buildModeMenuEl, openReparentedModal, openUserGuideWindow, makePaletteBtn, makeLogScaleBtn, makeLegendStyleBtn, makeOverlaysBtn, makeOrientationBtn, overlayRootFor, saveImageBlob, markMenuTrigger, wireMenuA11y, nextFrame, passFailMenuRows, requestedPassFailDisplay, logWmapVersionOnce, type ModeEntry, type SaveImageHandler, type SaveTextHandler, type CheckMenuRow, type UserGuideExtension, type OverlayHandle } from './toolbar.js';
import type { SummaryPanelOptions } from './summaryPanel.js';
import {
  createSummaryPanelEl, wrapWithSummaryPanel, renderWaferSummaryContent,
} from './summaryPanel.js';
import type { FindingsFilter } from '../stats/filterFindings.js';
import { prettyKey } from '../stats/facets.js';
import { ICONS } from './icons.js';
import { hardBinColor, softBinColor, metadataValueColor } from '../renderer/colorMap.js';
import { createInsightsTab, type InsightsOptions } from './insightsTab.js';
import { createMetadataBadge, type MetadataBadgeController } from './metadataBadge.js';

// ── Public types ───────────────────────────────────────────────────────────────

/**
 * Stable display preferences — worth persisting to localStorage or a user profile.
 * These describe how the user wants to view wafer maps in general.
 */
export interface WaferPreferences {
  colorScheme?:            string;
  /** Interactive rotation in degrees (0 | 90 | 180 | 270). */
  rotation?:               0 | 90 | 180 | 270;
  flipX?:                  boolean;
  flipY?:                  boolean;
  showDieLabels?:          boolean;
  showRingBoundaries?:     boolean;
  showQuadrantBoundaries?: boolean;
  showReticle?:            boolean;
  showXYIndicator?:        boolean;
  ringCount?:              number;
  /** Legend position for bin modes. Default 'default'. */
  legendPosition?:         'default' | 'compact' | 'bottom' | 'top' | 'left' | 'floating';
  /**
   * When true, apply log₁₀ scale to value normalization and the colorbar.
   * Overrides the per-test TestDef.logScale default.
   * Falls back to linear when vMin ≤ 0.
   */
  logScale?:               boolean;
  /**
   * Controls the default colorbar range when the active testDef has spec limits.
   * `'spec'` (default): colorbar spans [limitLow, limitHigh]; out-of-spec dies show fail colors.
   * `'data'`: colorbar spans actual data min/max; out-of-spec coloring still applies.
   */
  colorbarRangeMode?:      'spec' | 'data';
  /**
   * When true (default), partial (edge) dies are rendered in muted grey.
   * Set to false to hide them entirely, matching real prober behaviour where
   * positions outside the wafer circle are never tested.
   */
  showPartialDies?:        boolean;
}

/**
 * Transient display state — describes the current view session, not worth persisting.
 * Changes frequently as the user navigates tests and modes.
 */
export interface WaferDisplayState {
  plotMode?:     PlotMode;
  /**
   * Requested pass/fail display for `value` mode — `'spec'` (spec-limit judgement),
   * `'test'` (the tester's recorded verdict from `die.testPass`), or `'off'` (gradient).
   * The library resolves the effective display from the data; a functional active
   * test always renders as `'test'`. Toggled by the Overlays toolbar menu.
   */
  passFailDisplay?: 'off' | 'spec' | 'test';
  /** @deprecated Use `passFailDisplay: 'spec'` instead — alias, ignored when `passFailDisplay` is set. */
  colorBySpec?:  boolean;
  /**
   * Which test number to display in `value` plot mode. Default `0`.
   * Controlled by the mode dropdown when the result has testDefs.
   */
  activeTest?:   number;
  /**
   * Which `die.metadata` key to display in `'metadata'` plot mode. Must match
   * a `key` in the result's `metadataFields`. Controlled by the mode dropdown
   * when the result has `metadataFields`.
   */
  activeMetadataKey?: string;
  highlightBin?: number;
  /** Dim every die except this metadata value in `'metadata'` mode — the analogue of `highlightBin`. */
  highlightMetadataValue?: string;
  /**
   * Explicit value colour normalization range.
   *
   * - Tuple `[min, max]`: applied to whichever test is active (caller owns the
   *   coupling with `activeTest`).
   * - Object `{ test, range }`: applied only when `test` matches the active
   *   test; ignored (auto-scale) on mismatch, so one test's data can never be
   *   coloured against another test's range. Prefer this when the range was
   *   computed for a specific test.
   *
   * When omitted, the range is auto-computed from the die values present.
   */
  valueRange?:   [number, number] | { test: number; range: [number, number] };
  /**
   * Aggregation method for `stackedValues` mode.
   * Drives both the per-die aggregation and the hover tooltip label.
   * Accepted values: `'mean'` | `'median'` | `'stddev'` | `'min'` | `'max'` | `'count'`.
   * Defaults to `'mean'` when not set.
   */
  aggregationMethod?:   string;
  /**
   * Total number of wafers in the lot — used to compute bin occurrence percentage
   * in `stackedBins` hover tooltips.
   */
  lotSize?:      number;
}

/**
 * All scene-level options that the toolbar can control.
 * Combines stable {@link WaferPreferences} with transient {@link WaferDisplayState}.
 * The flat shape is unchanged — callers set any field directly.
 * Use the `category` hint in {@link RenderOptions.onViewOptionsChange} to decide
 * whether a change is worth persisting.
 */
export type WaferViewOptions = WaferPreferences & WaferDisplayState;

export interface RenderOptions extends Omit<ToCanvasOptions, 'viewport' | 'hbinDefs' | 'sbinDefs'> {
  /** Initial scene display options. All are overridable via the toolbar. */
  viewOptions?: WaferViewOptions;
  /** Called when the user hovers over a die. Null when leaving a die. */
  onHover?: (die: Die | null, event: MouseEvent) => void;
  /** Called when the user clicks a die. */
  onClick?: (die: Die, event: MouseEvent) => void;
  /** Called when the user completes a box-select. */
  onSelect?: (dies: Die[]) => void;
  /**
   * Called whenever the toolbar changes a scene option.
   * `changed` lists the keys that changed.
   * `category` is `'preference'` when all changed keys are {@link WaferPreferences},
   * `'state'` when all are {@link WaferDisplayState}, or `'mixed'` when both.
   * Use `category !== 'state'` to decide whether to persist the new options.
   */
  onViewOptionsChange?: (
    opts:     WaferViewOptions,
    changed:  (keyof WaferViewOptions)[],
    category: 'preference' | 'state' | 'mixed',
  ) => void;
  /** Show built-in floating tooltip on hover. Default true. */
  showTooltip?: boolean;
  /** Show the built-in toolbar. Default true. */
  showToolbar?: boolean;
  /**
   * Show a small always-visible metadata badge (lot, wafer ID, product, test
   * program, temperature, etc.) overlaid bottom-left on the canvas. Default
   * true. Independent of `showToolbar` and the Insights tab — this exists so
   * basic wafer/lot identity is never hidden behind a mode or toggle, without
   * costing any layout space (it's an overlay, not a layout element). Renders
   * nothing when the result has no metadata at all. Collapsed by default to a
   * single identifying line; click/Enter/Space expands in place to the full
   * field set.
   */
  showMetadataBadge?: boolean;
  /** Optional precomputed wafer-level stats summary. Enables the summary panel toggle button in the toolbar. */
  statsSummary?: StatsSummary;
  /**
   * Bin numbers treated as pass for yield calculation in the summary panel.
   * Defaults to `[1]`. Must match the `passBins` passed to `analyzeWaferMap` / `buildWaferMap`
   * to ensure the summary panel yield label is consistent with the rest of the display.
   */
  passBins?: number[];
  /**
   * 'full' (default) shows all toolbar controls.
   * 'view-only' shows only zoom, reset, box-select, and download — used by gallery cards.
   */
  toolbarControls?: 'full' | 'view-only';
  /**
   * Show the plot mode selector in the toolbar. Default true.
   * Set to false when the host application manages mode switching itself.
   */
  showPlotModeSelector?: boolean;
  /** Minimum zoom relative to fit. Default 0.4. */
  minZoom?: number;
  /** Maximum zoom relative to fit. Default 20. */
  maxZoom?: number;
  /** Filename for the PNG download (without extension). Default `'wafermap'`. */
  downloadFilename?: string;
  /**
   * Host hook for persisting the rendered PNG. When provided, the toolbar's save
   * action calls `onSaveImage(blob, suggestedName)` instead of triggering a
   * browser `<a download>` — letting embedded hosts (Tauri, Electron, WebView2)
   * route the image through a native save dialog. `suggestedName` includes the
   * `.png` extension and is derived from `downloadFilename`. When omitted, the
   * default browser download behaviour is unchanged.
   */
  onSaveImage?: SaveImageHandler;
  /**
   * Host hook for saving the Summary/Insights test-values table's "Export CSV"
   * button. Mirrors `onSaveImage` — when provided, called with
   * `(text, suggestedName, mimeType)` instead of triggering a browser
   * `<a download>` (a silent no-op in Tauri/Electron/WebView2). When omitted,
   * the default browser download behaviour is unchanged.
   */
  onSaveText?: SaveTextHandler;
  /**
   * Options for the always-available Summary panel — a docked panel
   * (metadata, yield, bin breakdown, ring/quadrant yield, test values, and
   * findings with severity/kind/region filters, click-to-highlight on the
   * map) toggled via the toolbar's "Summary" button whenever `statsSummary`
   * is supplied. Independent of `insights` below: this always shows/hides
   * its own toolbar button regardless of whether Insights is open, since
   * Insights has no map for a finding to highlight against.
   */
  summaryPanel?: SummaryPanelOptions;
  /**
   * Custom tooltip renderer. When provided, replaces the built-in tooltip content.
   * Return a string (set as innerHTML), an HTMLElement (appended directly), or null to suppress the tooltip.
   * The built-in tooltip wrapper (positioning, show/hide behaviour) is preserved.
   */
  renderTooltip?: (die: Die) => string | HTMLElement | null;
  /**
   * @deprecated No longer used. The die hover tooltip is now compact and mode-aware:
   * in value mode it leads with the active test then summarises the rest as "+N more
   * tests"; in bin modes it shows a "N test values recorded" count. It never lists
   * tests up to a cap, so there is nothing to limit. Kept for back-compat.
   */
  tooltipTestLimit?: number;
  /**
   * Show a help button in the toolbar that opens the built-in end-user guide in a modal.
   * Default false. Enable in applications that want to surface the guide without linking externally.
   */
  showHelpButton?: boolean;
  /**
   * Host-supplied content inserted into the built-in end-user guide window
   * (see `showHelpButton`) — e.g. a host app's own documentation, so the user
   * has one help button instead of two. See `UserGuideExtension`.
   */
  userGuideExtension?: UserGuideExtension;
  /** Override the expand action for both the expand button and the E key. Used by the gallery to route through its own modal logic. */
  onExpand?: () => void;
  /**
   * Show the toolbar expand button and enable the E-key shortcut. Default true.
   * Set false when the host already renders the map inside its own expanded/modal
   * context, where wmap's built-in expand modal would be redundant.
   */
  showExpandButton?: boolean;
  /**
   * Intrinsic height for the map. `renderWaferMap` fills its container, which
   * therefore must have a resolved height — in a plain document a bare `<div>`
   * has none and the map collapses to zero. Set this and the library sizes its
   * own wrapper instead, so the map renders with no container CSS required.
   * Accepts a number (px) or any CSS length (e.g. `'600px'`, `'70vh'`).
   * Omit it when the container already has a height (flex/grid child, absolute
   * inset, or an explicit CSS height). Width always comes from the container.
   */
  height?: number | string;
  /**
   * Base `z-index` for wmap's transient overlays — toolbar menus, the die
   * tooltip, the expand modal, and the user-guide modal. wmap layers its own
   * overlays from this value upward (tooltip and the modal box sit one or two
   * above it). Set this when embedding a map inside your own modal/overlay so
   * wmap's menus and tooltips appear above it.
   *
   * Omit it and wmap defaults overlays to a high value (above typical app modal
   * layers), so they appear on top with no configuration. The value is applied
   * for the lifetime of this render and restored on `destroy()`.
   */
  zIndex?: number;
  /**
   * Show an "Insights" tab in the toolbar (see `InsightsOptions`). Selecting
   * it replaces the canvas with wmap's own chart suite, computed over this
   * one wafer's dies (the same suite `renderWaferGallery`'s own `insights`
   * shows for a whole lot, minus grouping — a single wafer has nothing to
   * group by).
   */
  insights?: InsightsOptions;
}

/** @deprecated Use RenderOptions instead. */
export type MountOptions = RenderOptions;

export interface WaferMapController {
  /** Update the die data (e.g. after a data reload) — rebuilds scene, preserves zoom/pan. */
  setDies(dies: Die[]): void;
  /** Replace the wafer map result entirely — updates both wafer geometry and die data, preserves zoom/pan. */
  setResult(result: WaferMapResult): void;
  /** Merge scene option overrides — rebuilds scene, preserves zoom/pan. */
  setOptions(opts: Partial<WaferViewOptions>): void;
  /** Return current scene options snapshot. */
  getOptions(): WaferViewOptions;
  /** Programmatically set the selected dies (renders highlight overlay). */
  setSelection(dies: Die[]): void;
  /** Clear the current selection. */
  clearSelection(): void;
  /** Reset zoom and pan to fitted view. */
  resetZoom(): void;
  /** Update the fallback format for unitless values and re-render. */
  setFallbackFormat(format: 'si' | 'engineering'): void;
  /** Replace the current stats summary used by the built-in Summary panel. */
  setStatsSummary(summary: StatsSummary | undefined): void;
  /** Show or hide the Summary toolbar button without affecting the panel's content. */
  setSummaryVisible(visible: boolean): void;
  /** Show or hide the scene-control toolbar buttons (mode, orientation, etc). */
  setViewControlsVisible(visible: boolean): void;
  /** Show or hide the expand toolbar button. */
  setExpandVisible(visible: boolean): void;
  /** Show or hide the help toolbar button. */
  setHelpButtonVisible(visible: boolean): void;
  /** Show or hide the metadata badge without affecting its content. */
  setMetadataBadgeVisible(visible: boolean): void;
  /**
   * Opens the built-in end-user guide window — the same action the help
   * toolbar button performs, but callable directly. Works regardless of
   * `showHelpButton`/`setHelpButtonVisible`'s current value, so a host that
   * hides wmap's own help button (e.g. to fold it into its own combined help
   * menu) can still trigger the guide without a DOM query against wmap's
   * internal button markup.
   */
  openUserGuide(): void;
  /** Close the auto-mounted Summary panel if it is open. No-op if no panel exists. */
  closeSummaryPanel(): void;
  /** Programmatically open/close the Insights tab. No-op if `insights.enabled` was not set. */
  setInsightsOpen(open: boolean): void;
  /** Move the floating tooltip into a different parent (e.g. a maximized modal box). */
  setTooltipParent(parent: HTMLElement): void;
  /**
   * Returns the current legend entries in `hardBin`/`softBin`/`metadata` modes, `null` in other
   * modes. Each entry includes the bin number (or metadata value string), display name, and color.
   */
  getActiveLegend(): Array<{ bin: number | string; name: string; color: string }> | null;
  /** Remove all event listeners and DOM elements. */
  destroy(): void;
}

/** @deprecated Use WaferMapController instead. */
export type WaferCanvasController = WaferMapController;

// Keys that belong to WaferPreferences — used to classify onViewOptionsChange events.
const PREFERENCE_KEYS = new Set<keyof WaferViewOptions>([
  'colorScheme', 'rotation', 'flipX', 'flipY',
  'showDieLabels', 'showPartialDies', 'showRingBoundaries', 'showQuadrantBoundaries', 'showReticle', 'showXYIndicator',
  'ringCount', 'legendPosition', 'logScale', 'colorbarRangeMode',
]);

export function classifyChanged(keys: (keyof WaferViewOptions)[]): 'preference' | 'state' | 'mixed' {
  const hasPref  = keys.some(k => PREFERENCE_KEYS.has(k));
  const hasState = keys.some(k => !PREFERENCE_KEYS.has(k));
  if (hasPref && hasState) return 'mixed';
  return hasPref ? 'preference' : 'state';
}

// ── Main export ───────────────────────────────────────────────────────────────

export function renderWaferMap(
  container: HTMLElement,
  result: WaferMapResult,
  options: RenderOptions = {},
): WaferMapController {
  logWmapVersionOnce();
  // Derive the window/document this container actually belongs to, rather than
  // assuming the bare global `window`/`document` — needed so a container
  // mounted in a different document (e.g. a gallery card detached into its own
  // popup window) binds its blur/DPR/scheme listeners, and its tooltip, to ITS
  // OWN window/document, not whichever ones happened to be in lexical scope
  // when this module was first evaluated.
  const ownerDocument = container.ownerDocument;
  const ownerWindow = ownerDocument.defaultView ?? window;
  if (ownerWindow.getComputedStyle(container).position === 'static') container.style.position = 'relative';
  // Container height as the host laid it out, before we touch anything. A flex/grid
  // child whose ancestors never resolve a height reports 0 here — the case where the
  // fill-parent canvas can't get a height and the map silently collapses or oscillates.
  const containerHeightBefore = container.clientHeight;
  // Intrinsic height: when provided, the library sizes the container itself so
  // the fill-parent canvas has a resolved height with no host CSS required.
  if (options.height != null) {
    container.style.height = typeof options.height === 'number' ? `${options.height}px` : options.height;
  }
  const canvasWrap = document.createElement('div');
  Object.assign(canvasWrap.style, { position: 'relative', width: '100%', height: '100%' });
  const canvas = document.createElement('canvas');
  Object.assign(canvas.style, { width: '100%', height: '100%', display: 'block' });
  canvasWrap.appendChild(canvas);
  container.appendChild(canvasWrap);

  const {
    onHover,
    onClick,
    onSelect,
    onViewOptionsChange,
    showTooltip          = true,
    showToolbar          = true,
    showMetadataBadge    = true,
    toolbarControls      = 'full',
    showPlotModeSelector = true,
    minZoom              = 0.4,
    maxZoom              = 20,
    summaryPanel:        summaryPanelOpts,
    renderTooltip,
    tooltipTestLimit,
    passBins             = [1],
    showHelpButton       = false,
    userGuideExtension,
    onExpand,
    showExpandButton     = true,
    zIndex,
    insights:            insightsOpts,
    viewOptions: initialViewOptions = {},
    ...drawOptions
  } = options;
  const insightsEnabled = insightsOpts?.enabled ?? false;

  // Host-supplied overlay stacking (no-op when zIndex is undefined; safe high
  // default applies). Restored on destroy() via the returned disposer.
  const disposeOverlayZ = applyOverlayZ(zIndex);

  let currentFallbackFormat = drawOptions.fallbackFormat;
  let currentStatsSummary = options.statsSummary;
  let currentResult = result;

  // ── Mutable state ──────────────────────────────────────────────────────────
  let wafer           = result.wafer;
  let currentDies     = result.dies;
  // Selected die keys ("i,j") — key-based so references survive scene rebuilds.
  let selectedKeys    = new Set<string>();
  // Data-derived state from the result — callers no longer pass these via viewOptions.
  let hbinDefs: BinDef[]    | undefined = result.hbinDefs;
  let sbinDefs: BinDef[]    | undefined = result.sbinDefs;
  let testDefs: TestDef[]   | undefined = result.testDefs;
  let metadataFields: MetadataFieldDef[] | undefined = result.metadataFields;
  let reticles: Reticle[]   | undefined = result.reticles?.length ? result.reticles : undefined;
  let reticleConfig: ReticleConfig | undefined = result.reticleConfig;
  let dataAxisFlip: { x: boolean; y: boolean } | undefined = result.view?.axisFlip;
  // Lot-stack context is the library's own derived truth — sourced from the result, never the
  // caller's viewOptions. Drives the stacked-mode availability and the map title's stack qualifier.
  let resultIsLotStack: boolean        = result.isLotStack;
  let resultAggrMethod: string | undefined = result.aggrMethod;
  let resultLotSize:    number | undefined = result.lotSize;

  // ── Metadata badge (opt-out) ─────────────────────────────────────────────────
  // Mounted as a child of canvasWrap (not gated by showToolbar) so basic wafer/
  // lot identity is visible in every mode, including when the toolbar is
  // hidden — this is the whole point of the feature. It carries the same
  // explicit `Z_BASE` z-index the toolbar does, so — unlike ordinary
  // unpositioned canvasWrap content — it is NOT actually covered by
  // insightsTab.el's overlay; setInsightsOpen explicitly hides it while
  // Insights is open (the Insights tab shows this wafer's metadata in its
  // own strip anyway, so nothing is lost).
  // Tracks whether the *host* has asked for it hidden via
  // setMetadataBadgeVisible(false), independent of Insights toggling it —
  // so closing Insights doesn't un-hide a badge the host explicitly hid.
  let metadataBadgeHostHidden = false;
  let metadataBadge: MetadataBadgeController | null = null;
  if (showMetadataBadge) {
    metadataBadge = createMetadataBadge(wafer.metadata, { lotStack: lotStackBadgeContext() });
    if (!metadataBadge.isEmpty()) canvasWrap.appendChild(metadataBadge.el);
  }
  function lotStackBadgeContext(): { lotSize: number; aggrMethod?: string } | undefined {
    return resultIsLotStack ? { lotSize: resultLotSize ?? 1, aggrMethod: resultAggrMethod } : undefined;
  }
  function refreshMetadataBadge(): void {
    if (!metadataBadge) return;
    metadataBadge.update(wafer.metadata, lotStackBadgeContext());
    const inDom = metadataBadge.el.isConnected;
    if (metadataBadge.isEmpty() && inDom) metadataBadge.el.remove();
    else if (!metadataBadge.isEmpty() && !inDom) canvasWrap.appendChild(metadataBadge.el);
  }

  const hasCustomColors = [...(hbinDefs ?? []), ...(sbinDefs ?? [])].some(d => d.color);

  let viewOpts: WaferViewOptions = {
    plotMode:               'hardBin',
    colorScheme:            hasCustomColors ? 'custom' : 'default',
    showDieLabels:               false,
    showPartialDies:        true,
    showRingBoundaries:     false,
    showQuadrantBoundaries: false,
    showReticle:            false,
    showXYIndicator:        false,
    ringCount:              4,
    rotation:               0,
    flipX:                  false,
    flipY:                  false,
    // legendPosition can come from viewOptions or the top-level drawOptions.
    legendPosition:         drawOptions.legendPosition ?? 'default',
    ...initialViewOptions,
  };

  // ── Insights tab (opt-in) ────────────────────────────────────────────────────
  // Same shared chart suite `renderWaferGallery`'s own `insights` shows for a
  // whole lot (`insightsTab.ts`), given a single-item population — no "Group
  // by" ever appears (nothing is splittable with one item), and there is no
  // click-to-open-wafer (the only wafer is already the one on screen).
  let insightsTab: ReturnType<typeof createInsightsTab> | null = null;
  let insightsOpen = false;
  if (insightsEnabled) {
    insightsTab = createInsightsTab({
      getItems: () => [{
        wafer, dies: currentDies, hbinDefs, sbinDefs, testDefs,
        label: String(wafer.metadata?.waferId ?? ''),
        statsSummary: currentStatsSummary,
      }],
      getColorSchemeName: () => viewOpts.colorScheme ?? 'default',
      passBins,
      getRingCount: () => viewOpts.ringCount ?? 4,
      onSaveImage: options.onSaveImage,
      onSaveText: options.onSaveText,
      defaultView: insightsOpts?.defaultView,
      // Leading "‹ Map" tab in the Insights tab bar — a visible way back to
      // the wafer view, alongside the toolbar's icon toggle.
      backTab: { label: 'Map', onBack: () => setInsightsOpen(false) },
      // No openWafer — this map already IS the only wafer there is to open.
    });
    // Positioned sibling of canvasWrap covering the same area. Left with
    // `z-index: auto` (no explicit value), this positioned element still
    // paints above canvasWrap's own unpositioned canvas content
    // (position:static content always sits below any positioned sibling,
    // explicit z-index or not) while sitting below the toolbar (a direct
    // child of `container`, not canvasWrap — see its own creation comment —
    // with its own explicit, much higher z-index via `Z_BASE`) — so it
    // visually replaces the map without ever making the toolbar
    // unreachable. Needs an opaque background since the insights grid has
    // gaps between cards that would otherwise let the covered canvas show
    // through.
    // overflowY:auto lives HERE, not on insightsTab.el itself — this
    // wrapper has a genuinely definite height (inset:0 against
    // `container`), so it's the right place to bound/scroll long content;
    // insightsTab.el's own root stays auto-height so it also works
    // correctly for hosts (renderWaferGallery.ts) that mount it as a plain
    // block child with no such bound, where forcing an internal scroll
    // region would just clip content at an arbitrary floor height instead
    // of letting the page grow to show it.
    Object.assign(insightsTab.el.style, {
      position: 'absolute', inset: '0', background: CLR.panelBg, overflowY: 'auto',
      // Reserve room above the tab's own content (its metadata strip sits at
      // the very top) so the floating toolbar — an absolutely-positioned
      // sibling anchored to the same `container` corner — never renders on
      // top of it. Only needed when there's a toolbar to clear; the gallery's
      // equivalent toolbar is a real in-flow header instead, so it needs no
      // such reservation.
      paddingTop: showToolbar ? '44px' : '0',
    } as Partial<CSSStyleDeclaration>);
    container.appendChild(insightsTab.el);
  }

  function setInsightsOpen(open: boolean): void {
    if (!insightsTab) return;
    insightsOpen = open;
    insightsTab.el.style.display = open ? 'flex' : 'none';
    // Map-specific toolbar controls (zoom/pan/select, mode/palette/overlays/etc.)
    // have no effect on the chart suite — hide them as a group while it's open.
    // Summary is hidden too (refreshSummaryButton checks insightsOpen) since
    // its panel sits behind the Insights overlay with no visible effect.
    // Insights/Help live in sceneControlsEl (unwrapped, not part of this
    // group) and stay visible+reachable the whole time. Expand does NOT —
    // reparenting insightsTab.el into the modal left the original container
    // blank behind it, and switching back to the wafer view *inside* the
    // modal left that blank too (canvasWrap was never moved there — it has
    // no expand target once Insights owns the screen). Hide it entirely
    // rather than ship a control that produces two blank views.
    if (mapToolsEl) mapToolsEl.style.display = open ? 'none' : 'flex';
    if (mapViewControlsEl) mapViewControlsEl.style.display = open ? 'none' : 'flex';
    if (btnExpand) btnExpand.style.display = open ? 'none' : 'flex';
    // The metadata badge is a child of canvasWrap and (like the toolbar used
    // to be) floats at canvasWrap's own corner, not the Insights overlay's —
    // and the Insights tab already shows this wafer's metadata in its own
    // strip. Hide it rather than let it float in the wrong place on top of
    // that strip. Never un-hides a badge the host explicitly hid.
    if (metadataBadge) metadataBadge.el.style.display = (open || metadataBadgeHostHidden) ? 'none' : '';
    refreshSummaryButton();
    if (btnInsights) {
      // The icon itself signals the toggle: a bar-chart glyph means "open
      // Insights", a wafer glyph (while Insights is showing) means "back to
      // the wafer view" — clicking Insights again is otherwise not obvious
      // as the way back, since the button's position/label never move.
      btnInsights.innerHTML = open ? ICONS.wafer : ICONS.analysis;
      btnInsights.ariaLabel = open ? 'Back to wafer view' : 'Insights';
    }
    if (open) insightsTab.render();
  }

  let currentView:   View;
  let dieKeyIndex:    Map<string, number>;
  let fittedViewport: ViewportTransform | null = null;
  let viewport:       ViewportTransform | null = null;
  let binLegendRows:  BinLegendRow[] = [];
  let legendBoxRect:  { x: number; y: number; w: number; h: number } | null = null;
  let legendOffset = drawOptions.legendOffset ?? { x: 0, y: 0 };
  let draggingLegend = false;
  let legendDragPending = false;  // pointerdown inside legend box, not yet confirmed as drag
  let legendDragStart = { x: 0, y: 0 };
  let legendOffsetStart = { x: 0, y: 0 };
  let isPanning       = false;
  let isBoxSelecting  = false;
  // Interaction mode: 'pan' | 'zoom' | 'select'
  // 'pan'    — drag pans; plain scroll pans; Ctrl+scroll zooms
  // 'zoom'   — drag draws a zoom-box; plain scroll pans; Ctrl+scroll zooms
  // 'select' — drag draws a selection box (only available when onSelect provided)
  let interactMode: 'pan' | 'zoom' | 'select' = 'pan';
  let panStart        = { x: 0, y: 0 };
  let panOrigin       = { x: 0, y: 0 };
  let boxStart        = { x: 0, y: 0 };
  let boxEnd          = { x: 0, y: 0 };
  let spaceHeld       = false;
  let spacePanActive  = false;

  // ── View rebuild ──────────────────────────────────────────────────────────
  function rebuildView(): void {
    const so = viewOpts;
    currentView = buildView(wafer, currentDies, {
      plotMode:               so.plotMode,
      colorScheme:            so.colorScheme,
      showDieLabels:               so.showDieLabels,
      showPartialDies:        so.showPartialDies,
      showRingBoundaries:     so.showRingBoundaries,
      showQuadrantBoundaries: so.showQuadrantBoundaries,
      showReticle:            so.showReticle,
      showXYIndicator:        so.showXYIndicator,
      reticles,
      ringCount:              so.ringCount,
      highlightBin:           so.highlightBin,
      highlightMetadataValue: so.highlightMetadataValue,
      activeTest:              so.activeTest,
      activeMetadataKey:       so.activeMetadataKey,
      testDefs,
      valueRange:             so.valueRange,
      logScale:               so.logScale,
      isLotStack:             resultIsLotStack,
      aggregationMethod:      resultAggrMethod ?? so.aggregationMethod,
      lotSize:                resultLotSize ?? so.lotSize,
      dataAxisFlip,
      colorbarRangeMode:      so.colorbarRangeMode,
      colorBySpec:            so.colorBySpec,
      passFailDisplay:        so.passFailDisplay,
      fallbackFormat:         currentFallbackFormat,
      interactiveTransform: {
        rotation: so.rotation ?? 0,
        flipX:    so.flipX   ?? false,
        flipY:    so.flipY   ?? false,
      },
    } satisfies ViewOptions, { hbinDefs, sbinDefs, metadataFields });
    dieKeyIndex = new Map(currentView.dies.map((d, i) => [`${d.x},${d.y}`, i]));
  }

  rebuildView();

  // ── Summary panel ──────────────────────────────────────────────────────────
  let summaryPanelEl: HTMLDivElement | null = null;
  let summaryPanelWrapper: HTMLDivElement | null = null;
  let summaryActiveFindingId: string | null = null;
  let findingsFilter: FindingsFilter = {};
  // Auto-mounted panel: created when statsSummary is provided but no explicit summaryPanel option.
  let autoSummaryPanelEl: HTMLDivElement | null = null;
  let autoSummaryPanelWrapper: HTMLDivElement | null = null;

  function applyFindingHighlightFromPanel(finding: StatsFinding): void {
    const { kind, index } = finding.variable;
    if (kind === 'test') {
      applyOpts({ plotMode: 'value', activeTest: index ?? 0, highlightBin: undefined });
    } else if (kind === 'softBin') {
      applyOpts({ plotMode: 'softBin', highlightBin: undefined });
    } else {
      applyOpts({ plotMode: 'hardBin', highlightBin: undefined });
    }

    const h = finding.highlight;
    if (h.kind === 'bin') {
      selectionFromKeys(h.dieKeys);
      applyOpts({ highlightBin: h.bin });
    } else if (h.kind === 'region' || h.kind === 'dies') {
      selectionFromKeys(h.dieKeys);
    }
  }

  function renderSummaryPanelInto(el: HTMLDivElement): void {
    renderWaferSummaryContent(el, {
      wafer, dies: currentDies,
      yieldSummary: currentResult.yield,
      dataCoverage: currentResult.dataCoverage,
      hbinDefs, sbinDefs, testDefs,
      statsSummary: currentStatsSummary,
      passBins,
      ringCount: viewOpts.ringCount ?? 4,
      colorScheme: viewOpts.colorScheme,
      fallbackFormat: currentFallbackFormat,
      activeFindingId: summaryActiveFindingId,
      findingsFilter,
      onFindingsFilterChange: renderSummaryPanel,
      onSaveText: options.onSaveText,
      onFindingClick: (finding, _row) => {
        if (summaryActiveFindingId === finding.id) {
          summaryActiveFindingId = null;
          selectionFromKeys([]);
          applyOpts({ highlightBin: undefined });
        } else {
          summaryActiveFindingId = finding.id;
          applyFindingHighlightFromPanel(finding);
        }
        renderSummaryPanel();
      },
    });
  }

  function renderSummaryPanel(): void {
    if (summaryPanelEl) renderSummaryPanelInto(summaryPanelEl);
  }

  function renderAutoSummaryPanel(): void {
    if (autoSummaryPanelEl) renderSummaryPanelInto(autoSummaryPanelEl);
  }

  // The floating toolbar is an absolutely-positioned overlay anchored to the
  // container's top-right corner — a panel laid out under that corner
  // ('right' beside the map, or 'top' spanning the full width) would have its
  // header rendered underneath it. Reserve the same top clearance the
  // Insights overlay does (toolbar bottom ~36px + breathing room = 44px).
  function reserveToolbarClearance(panel: HTMLDivElement, placement: 'right' | 'left' | 'top' | 'bottom'): void {
    if (showToolbar && (placement === 'right' || placement === 'top')) {
      panel.style.paddingTop = '44px';
    }
  }

  if (summaryPanelOpts?.placement) {
    const placement = summaryPanelOpts.placement;
    summaryPanelEl = createSummaryPanelEl(placement);
    reserveToolbarClearance(summaryPanelEl, placement);
    const parent = canvasWrap.parentElement;
    const next = canvasWrap.nextSibling;
    summaryPanelWrapper = wrapWithSummaryPanel(canvasWrap, summaryPanelEl, placement);
    parent?.insertBefore(summaryPanelWrapper, next);
    renderSummaryPanel();
  } else if (currentStatsSummary) {
    // Auto-mount a persistent Summary panel when statsSummary is provided without an
    // explicit placement. Mounted independently of the toolbar so a chromeless map
    // (showToolbar: false) can still render a persistent panel beside it; the toolbar
    // only owns the toggle button. defaultOpen: true starts the panel visible.
    const openOnMount = summaryPanelOpts?.defaultOpen ?? !showToolbar;
    autoSummaryPanelEl = createSummaryPanelEl('right');
    reserveToolbarClearance(autoSummaryPanelEl, 'right');
    autoSummaryPanelEl.style.display = openOnMount ? 'block' : 'none';
    const parent = canvasWrap.parentElement;
    const next = canvasWrap.nextSibling;
    autoSummaryPanelWrapper = wrapWithSummaryPanel(canvasWrap, autoSummaryPanelEl, 'right');
    parent?.insertBefore(autoSummaryPanelWrapper, next);
    renderAutoSummaryPanel();
  }

  // ── Tooltip ────────────────────────────────────────────────────────────────
  // One shared tooltip element for the whole document (see toolbar.ts). `tooltip`
  // is the local handle used by die-hover code; null when this instance has
  // tooltips disabled, so die hover never shows one. The toolbar still uses the
  // singleton regardless.
  const tooltip: HTMLDivElement | null = showTooltip ? getTooltip(ownerDocument) : null;

  // ── Toolbar ────────────────────────────────────────────────────────────────
  let toolbar:          HTMLDivElement    | null = null;
  let sceneControlsEl:  HTMLDivElement    | null = null;
  // Map-specific controls (zoom/pan/select, mode/palette/overlays/etc.) — hidden
  // while the Insights tab is open, since none of them apply to the chart suite.
  // Insights/Help stay in sceneControlsEl directly, unwrapped, since those
  // apply to both views. Summary/Expand also live there but are hidden while
  // Insights is open instead (refreshSummaryButton / setInsightsOpen) — Summary's
  // panel has no visible effect behind the Insights overlay, and Expand has no
  // sensible target once Insights owns the whole view (see setInsightsOpen).
  let mapToolsEl:       HTMLDivElement    | null = null;
  let mapViewControlsEl: HTMLDivElement   | null = null;
  let btnBoxSelect:     HTMLButtonElement | null = null;
  let btnSummary:      HTMLButtonElement | null = null;
  let btnExpand:        HTMLButtonElement | null = null;
  let btnHelp:          HTMLButtonElement | null = null;
  let btnInsights:   HTMLButtonElement | null = null;
  // Top clearance reserved on the canvas for the toolbar overlay.
  // toolbar sits at top:4px, is ~32px tall → bottom at ~36px; excess over canvas padding = 24px.
  const TOOLBAR_CLEARANCE = 24;

  let hideTimer: ReturnType<typeof setTimeout> | null = null;

  // Set when toolbar is created — used by destroy() regardless of showToolbar.
  let tbCloseOpenMenu: ((e: MouseEvent) => void) | null = null;
  let tbGetOpenMenu:   (() => HTMLDivElement | null) | null = null;
  // Called after every option change to keep the legend style button in sync.
  let syncLegendStyleBtnFn: (() => void) | null = null;
  let syncPaletteBtnFn: (() => void) | null = null;
  // Called after every option change to keep the log scale button in sync.
  let syncLogScaleBtnFn: (() => void) | null = null;
  // Called after every option change to keep the colorbar range mode button in sync.
  let syncColorbarRangeBtnFn: (() => void) | null = null;

  function selectionFromKeys(keys: string[] | undefined): void {
    selectedKeys = new Set(keys ?? []);
    if (onSelect) onSelect(selectionAsDies());
    render();
  }

  function refreshSummaryButton(): void {
    if (!btnSummary) return;
    const hasSummary = !!(summaryPanelEl ?? autoSummaryPanelEl);
    btnSummary.style.display = (currentStatsSummary && hasSummary && !insightsOpen) ? 'flex' : 'none';
    const activePanelEl = summaryPanelEl ?? autoSummaryPanelEl;
    const panelOpen = activePanelEl ? activePanelEl.style.display !== 'none' : false;
    if (currentStatsSummary?.hasNotableFindings && !panelOpen) {
      btnSummary.style.color = '#b7551a';
    } else if (!btnSummary.dataset.active) {
      btnSummary.style.color = CLR.icon;
    }
  }

  if (showToolbar) {
    {
      toolbar = document.createElement('div');
      toolbar.dataset.wmapToolbar = 'single';
      Object.assign(toolbar.style, {
        position:      'absolute',
        top:           '4px',
        right:         '4px',
        display:       'flex',
        flexDirection: 'row',
        alignItems:    'center',
        background:    CLR.menuBg,
        border:        `1px solid ${CLR.menuBorder}`,
        borderRadius:  '4px',
        boxShadow:     '0 1px 4px rgba(0,0,0,0.12)',
        zIndex:        Z_BASE,
        opacity:       '0.35',
        transition:    'opacity 0.2s ease',
        pointerEvents: 'auto',
      });

      // ── Toolbar helpers ──────────────────────────────────────────────────
      // The toolbar uses the shared singleton tooltip — the same node die hover
      // uses when enabled, so the one-tooltip invariant holds across both.
      const tbTooltip = getTooltip(ownerDocument);
      const tbHelpers = createToolbarHelpers(tbTooltip);
      const { makeBtn, setActive, makeSep, makeMenuRow, makeMenuSection, makeDropdown, makeCheckMenuBtn, closeOpenMenu, getOpenMenu, setOpenMenu } = tbHelpers;
      tbCloseOpenMenu = closeOpenMenu;
      tbGetOpenMenu   = getOpenMenu;
      // Single persistent listener — closes any open dropdown on outside click.
      // Must be ownerDocument, not the bare global: a gallery card detached
      // into a real popup window (renderWaferGallery.ts's openWindowForCard)
      // renders this toolbar into an entirely separate document, and a
      // listener on the wrong one never sees clicks made inside the popup —
      // dropdowns opened there would never close on an outside click.
      ownerDocument.addEventListener('click', closeOpenMenu, true);

      // ── Wire up toolbar buttons ──────────────────────────────────────────

      // Interaction mode: zoom-region | pan | select — mutually exclusive
      function setInteractMode(mode: 'pan' | 'zoom' | 'select'): void {
        interactMode = mode;
        setActive(btnZoomMode, mode === 'zoom');
        setActive(btnPanMode,  mode === 'pan');
        if (btnBoxSelect) setActive(btnBoxSelect, mode === 'select');
        canvas.style.cursor = mode === 'pan' ? 'grab' : 'crosshair';
      }

      // Base map tools (camera/zoom/pan/select) — wrapped so they can be hidden
      // as a group while the Insights tab is open (see mapToolsEl declaration).
      mapToolsEl = document.createElement('div');
      Object.assign(mapToolsEl.style, { display: 'flex', alignItems: 'center', gap: '0' });
      toolbar.appendChild(mapToolsEl);

      // Camera first — leftmost
      const btnDownload = makeBtn('download', 'Download PNG', downloadPng);
      mapToolsEl.appendChild(btnDownload);
      mapToolsEl.appendChild(makeSep());

      // Zoom group: zoom-region mode + zoom in/out + reset
      const btnZoomMode = makeBtn('zoomMode', 'Zoom (drag to zoom region)', () => setInteractMode('zoom'));
      const btnZoomIn   = makeBtn('zoomIn',   'Zoom in',                    () => zoomAt(canvas.clientWidth / 2, canvas.clientHeight / 2, 1.20));
      const btnZoomOut  = makeBtn('zoomOut',  'Zoom out',                   () => zoomAt(canvas.clientWidth / 2, canvas.clientHeight / 2, 1 / 1.20));
      const btnReset    = makeBtn('reset',    'Reset zoom (double-click)',   () => resetZoom());
      mapToolsEl.appendChild(btnZoomMode);
      mapToolsEl.appendChild(btnZoomIn);
      mapToolsEl.appendChild(btnZoomOut);
      mapToolsEl.appendChild(btnReset);
      mapToolsEl.appendChild(makeSep());

      // Interaction mode group: pan | box-select
      const btnPanMode = makeBtn('pan', 'Pan (drag to move)', () => setInteractMode('pan'));
      mapToolsEl.appendChild(btnPanMode);
      btnBoxSelect = makeBtn('boxSelect', 'Select (drag to select dies)', () => setInteractMode('select'));
      mapToolsEl.appendChild(btnBoxSelect);

      // Set initial active state — pan is default
      setActive(btnPanMode, true);

      // View controls — hidden in 'view-only' mode (gallery bar owns them).
      // Wrapped in sceneControlsEl so setViewControlsVisible() can hide/show the
      // whole group at once (used when reparenting a card into the expand modal).
      if (toolbarControls !== 'view-only') {
        sceneControlsEl = document.createElement('div');
        Object.assign(sceneControlsEl.style, { display: 'flex', alignItems: 'center', gap: '0' });
        toolbar.appendChild(sceneControlsEl);

        // Map-view-specific controls (mode, palette, overlays, legend, orientation)
        // — wrapped so they can be hidden as a group while the Insights tab is
        // open, unlike Summary/Expand/Insights/Help below, which stay unwrapped
        // directly in sceneControlsEl (individually hidden/shown as needed —
        // see setInsightsOpen — rather than as part of this group).
        mapViewControlsEl = document.createElement('div');
        Object.assign(mapViewControlsEl.style, { display: 'flex', alignItems: 'center', gap: '0' });
        sceneControlsEl.appendChild(mapViewControlsEl);
        mapViewControlsEl.appendChild(makeSep());

        // Mode dropdown: when testDefs are defined, show one entry per named test
        // plus the bin modes. Selecting a named test sets plotMode:'value' + activeTest.
        // Selecting a bin mode sets plotMode to that mode and clears activeTest.
        function isCurrentEntry(e: ModeEntry): boolean {
          if (e.plotMode !== (viewOpts.plotMode ?? 'hardBin')) return false;
          if (e.plotMode === 'value') return (viewOpts.activeTest ?? 0) === (e.activeTest ?? 0);
          if (e.plotMode === 'metadata') return viewOpts.activeMetadataKey === e.activeMetadataKey;
          return true;
        }

        function pickEntry(entry: ModeEntry, menu: HTMLElement): void {
          if (entry.activeTest !== undefined) {
            // Apply test's logScale default when switching tests.
            applyOpts({ plotMode: entry.plotMode, activeTest: entry.activeTest, activeMetadataKey: undefined, logScale: entry.logScale });
          } else if (entry.activeMetadataKey !== undefined) {
            applyOpts({ plotMode: entry.plotMode, activeTest: undefined, activeMetadataKey: entry.activeMetadataKey, colorBySpec: false, passFailDisplay: 'off' });
          } else {
            // Switching to a bin/stacked mode — clear the pass/fail display (only valid in value mode).
            applyOpts({ plotMode: entry.plotMode, activeTest: undefined, activeMetadataKey: undefined, colorBySpec: false, passFailDisplay: 'off' });
          }
          menu.remove();
          setOpenMenu(null);
          markMenuTrigger(btnMode, false);
        }

        const closeModeMenu = (): void => {
          const m = getOpenMenu();
          if (m) { m.remove(); setOpenMenu(null); }
          markMenuTrigger(btnMode, false);
        };
        const btnMode = makeBtn('mode', 'Plot mode', () => {
          if (getOpenMenu()) { closeModeMenu(); return; }

          // Only include modes for which data is actually present.
          const dies     = currentView.dies;
          const testDefs = currentView.testDefs;
          // Value mode is available for any per-test data — numeric values or recorded
          // pass/fail verdicts (functional tests). Stacked values need numeric values.
          const hasTestData = dies.some(dieHasTestData);
          const hasValues = dies.some(d =>
            (d.testValues !== undefined && Object.keys(d.testValues).length > 0) ||
            (d.values?.length ?? 0) > 0
          );
          const hasHbin = dies.some(d => d.hbin != null);
          const hasSbin = dies.some(d => d.sbin != null);

          // Metadata entries: one per configured metadataFields[].key actually
          // present in the dies (opt-in, never auto-detected — see MetadataFieldDef).
          const metadataEntries: ModeEntry[] = (metadataFields ?? [])
            .filter(f => dies.some(d => d.metadata?.[f.key] !== undefined && d.metadata?.[f.key] !== null))
            .map(f => ({
              plotMode: 'metadata' as PlotMode,
              activeMetadataKey: f.key,
              label: f.label ?? prettyKey(f.key),
            }));

          const testEntries: ModeEntry[] = hasTestData
            ? (testDefs?.length
                ? testDefs.map(t => ({
                    plotMode: 'value' as PlotMode,
                    activeTest: t.testNumber ?? t.index ?? 0,
                    label: t.unit ? `${t.name} (${t.unit})` : t.name,
                    logScale: t.logScale,
                  }))
                : getUniqueTestNumbers(dies).map(tn => ({
                    plotMode: 'value' as PlotMode,
                    activeTest: tn,
                    label: `Test ${tn}`,
                  })))
            : [];
          const binEntries: ModeEntry[] = [
            ...(hasHbin ? [{ plotMode: 'hardBin' as PlotMode, label: MODE_LABELS.hardBin }] : []),
            ...(hasSbin ? [{ plotMode: 'softBin' as PlotMode, label: MODE_LABELS.softBin }] : []),
          ];
          // Stacked modes are only valid for lot-aggregated data — the scene knows this via isLotStack.
          const stackedEntries: ModeEntry[] = currentView.isLotStack ? [
            ...(hasValues ? [{ plotMode: 'stackedValues'   as PlotMode, label: MODE_LABELS.stackedValues }]   : []),
            ...(hasHbin   ? [{ plotMode: 'stackedBins'     as PlotMode, label: MODE_LABELS.stackedBins }]     : []),
            ...(hasSbin   ? [{ plotMode: 'stackedSoftBins' as PlotMode, label: MODE_LABELS.stackedSoftBins }] : []),
          ] : [];

          const menu = buildModeMenuEl(
            btnMode.getBoundingClientRect(),
            testEntries, binEntries, stackedEntries,
            isCurrentEntry, pickEntry,
            { makeMenuRow, makeMenuSection },
            viewOpts.plotMode ?? 'hardBin',
            btnMode.ownerDocument.defaultView ?? window,
            metadataEntries,
          );
          overlayRootFor(btnMode).appendChild(menu);
          setOpenMenu(menu);
          markMenuTrigger(btnMode, true);
          wireMenuA11y(menu, btnMode, closeModeMenu);
        });
        markMenuTrigger(btnMode, false);
        const { btn: btnPalette, sync: syncPalette } = makePaletteBtn(
          tbHelpers,
          () => viewOpts.plotMode ?? 'hardBin',
          () => viewOpts.colorScheme ?? 'default',
          () => hasCustomColors,
          v => applyOpts({ colorScheme: v }),
        );
        syncPaletteBtnFn = syncPalette;
        syncPaletteBtnFn();
        const btnOverlays = makeOverlaysBtn(
          tbHelpers,
          (): CheckMenuRow[] => {
            const hasReticleNow = !!currentView!.hasReticle;
            const isValueMode   = (viewOpts.plotMode ?? 'hardBin') === 'value';
            const { testNumber: resolvedTest } = resolveTestNumber(viewOpts.activeTest ?? 0, currentView.testDefs);
            const activeTestDef = findTestDef(currentView.testDefs, resolvedTest);
            const functionalActive = isValueMode && activeTestDef !== undefined && !isParametricTest(activeTestDef);
            const hasLimits     = isValueMode && !functionalActive &&
              (activeTestDef?.limitLow !== undefined || activeTestDef?.limitHigh !== undefined);
            const hasRecorded   = isValueMode && !functionalActive &&
              currentView.dies.some(d => getTestPassStatus(d, resolvedTest, activeTestDef) !== undefined);
            return [
              { label: 'Ring boundaries', active: !!viewOpts.showRingBoundaries,     onClick: () => applyOpts({ showRingBoundaries:   !viewOpts.showRingBoundaries   }) },
              { label: 'Quadrant lines',  active: !!viewOpts.showQuadrantBoundaries, onClick: () => applyOpts({ showQuadrantBoundaries: !viewOpts.showQuadrantBoundaries }) },
              { label: 'Die labels',      active: !!viewOpts.showDieLabels,          onClick: () => applyOpts({ showDieLabels:          !viewOpts.showDieLabels          }) },
              { label: 'Reticle grid',    active: !!viewOpts.showReticle,            enabled: hasReticleNow, onClick: () => applyOpts({ showReticle: !viewOpts.showReticle }) },
              { label: 'XY indicator',    active: !!viewOpts.showXYIndicator,        onClick: () => applyOpts({ showXYIndicator:        !viewOpts.showXYIndicator        }) },
              ...passFailMenuRows(
                { functionalActive, hasLimits, hasRecorded, display: requestedPassFailDisplay(viewOpts) },
                d => applyOpts({ passFailDisplay: d, colorBySpec: false }),
              ),
            ];
          },
          () => !!(viewOpts.showRingBoundaries || viewOpts.showQuadrantBoundaries ||
                   viewOpts.showDieLabels || viewOpts.showReticle || viewOpts.showXYIndicator ||
                   requestedPassFailDisplay(viewOpts) !== 'off'),
        );
        const { btn: btnLegendStyle, sync: syncLegendStyle } = makeLegendStyleBtn(
          tbHelpers,
          () => viewOpts,
          v => applyOpts({ legendPosition: v }),
        );
        syncLegendStyleBtnFn = syncLegendStyle;
        syncLegendStyleBtnFn();

        const activeTestIsFunctional = () => {
          const { testNumber: resolvedTest } = resolveTestNumber(viewOpts.activeTest ?? 0, testDefs);
          const td = findTestDef(testDefs, resolvedTest);
          return td !== undefined && !isParametricTest(td);
        };
        const { btn: btnLogScale, sync: syncLogScale } = makeLogScaleBtn(
          tbHelpers,
          () => ({ ...viewOpts, functionalActive: activeTestIsFunctional() }),
          patch => applyOpts(patch),
        );
        syncLogScaleBtnFn = syncLogScale;
        syncLogScaleBtnFn();

        const activeTestDefHasLimits = () => {
          const { testNumber: resolvedTest } = resolveTestNumber(viewOpts.activeTest ?? 0, testDefs);
          const td = findTestDef(testDefs, resolvedTest);
          return td !== undefined && (td.limitLow !== undefined || td.limitHigh !== undefined);
        };
        const btnColorbarRange = makeBtn('specRange', 'Colorbar range: spec limits', () => {
          const next = viewOpts.colorbarRangeMode === 'data' ? 'spec' : 'data';
          applyOpts({ colorbarRangeMode: next });
        });
        syncColorbarRangeBtnFn = () => {
          // No colorbar exists under a solid pass/fail display or a functional active test.
          const visible = viewOpts.plotMode === 'value' && activeTestDefHasLimits() &&
            requestedPassFailDisplay(viewOpts) === 'off' && !activeTestIsFunctional();
          btnColorbarRange.style.display = visible ? '' : 'none';
          const isSpec = (viewOpts.colorbarRangeMode ?? 'spec') === 'spec';
          setActive(btnColorbarRange, isSpec);
          btnColorbarRange.ariaLabel = isSpec
            ? 'Colorbar range: spec limits (click for data range)'
            : 'Colorbar range: data range (click for spec limits)';
        };
        syncColorbarRangeBtnFn();

        const btnOrient = makeOrientationBtn(
          tbHelpers,
          () => viewOpts,
          patch => applyOpts(patch),
        );
        if (showPlotModeSelector) mapViewControlsEl!.appendChild(btnMode);
        mapViewControlsEl!.appendChild(btnPalette);
        mapViewControlsEl!.appendChild(btnLogScale);
        mapViewControlsEl!.appendChild(btnColorbarRange);
        mapViewControlsEl!.appendChild(makeSep());
        mapViewControlsEl!.appendChild(btnOverlays);
        mapViewControlsEl!.appendChild(makeSep());
        mapViewControlsEl!.appendChild(btnLegendStyle);
        mapViewControlsEl!.appendChild(makeSep());
        mapViewControlsEl!.appendChild(btnOrient);

        // Summary button — toggles the Summary panel. Left unwrapped in
        // sceneControlsEl (not grouped with mapViewControlsEl) so it stays
        // reachable and its own open/closed state stays independent of
        // Insights — the two are separate, non-overlapping surfaces (see
        // this function's own header comment), not a coordinated pair where
        // one hides the other's control.
        // The panel itself is auto-mounted earlier, independently of the toolbar.
        if (currentStatsSummary) {
          btnSummary = makeBtn('findings', 'Summary panel', () => {
            const panelEl = summaryPanelEl ?? autoSummaryPanelEl;
            if (!panelEl) return;
            const isOpen = panelEl.style.display !== 'none';
            panelEl.style.display = isOpen ? 'none' : 'block';
            setActive(btnSummary!, !isOpen);
            refreshSummaryButton();
          });
          sceneControlsEl!.appendChild(makeSep());
          sceneControlsEl!.appendChild(btnSummary);
          // Set button active state to match initial panel visibility
          if (autoSummaryPanelEl?.style.display !== 'none') setActive(btnSummary, true);
          refreshSummaryButton();
        }

        // Expand button — reparents canvas into a modal for a larger view.
        if (showExpandButton) {
          sceneControlsEl!.appendChild(makeSep());
          btnExpand = makeBtn('expand', 'Expand (E)', onExpand ?? openExpandModal);
          sceneControlsEl!.appendChild(btnExpand);
        }

        // Insights tab — toggles between the canvas and wmap's own chart suite.
        if (insightsTab) {
          sceneControlsEl!.appendChild(makeSep());
          btnInsights = makeBtn('analysis', 'Insights', () => {
            setInsightsOpen(!insightsOpen);
            setActive(btnInsights!, insightsOpen);
          });
          sceneControlsEl!.appendChild(btnInsights);
        }

        // Help button — opens the end-user guide in a non-modal window (opt-in).
        // The button's click handler and the controller's own `openUserGuide()`
        // (below) both call this same function — a host can trigger the guide
        // programmatically (e.g. from its own combined help menu) whether or
        // not `showHelpButton` ever rendered a wmap toolbar button at all.
        if (showHelpButton) {
          sceneControlsEl!.appendChild(makeSep());
          btnHelp = makeBtn('help', 'User guide', () => openGuideWindow());
          sceneControlsEl!.appendChild(btnHelp);
        }
      }

      // Anchored to `container`, not `canvasWrap` — canvasWrap shrinks to
      // share width with a docked summary panel (wrapWithSummaryPanel wraps
      // it in a flex row), and the Insights overlay covers the *full*
      // container, not just canvasWrap's own (possibly narrower/offset) box.
      // A toolbar parented to canvasWrap would float at canvasWrap's edge —
      // the wrong spot once the panel takes up real width, and often
      // overlapping the Insights tab's own top-of-content metadata strip.
      // `container` is always position:relative (set above) and always
      // spans the true, stable render area regardless of what's docked or
      // which view (map vs. Insights) is currently showing.
      container.appendChild(toolbar);

      // ── Hover show/hide (with linger so clicks register) ─────────────────
      function showBar(): void {
        if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
        if (toolbar) {
          toolbar.style.opacity = '1';
        }
      }
      function hideBar(): void {
        hideTimer = setTimeout(() => {
          if (toolbar) {
            toolbar.style.opacity = '0.35';
          }
        }, 600);
      }

      canvas.addEventListener('mouseenter', showBar);
      canvas.addEventListener('mouseleave', hideBar);
      toolbar.addEventListener('mouseenter', showBar);
      toolbar.addEventListener('mouseleave', hideBar);
    }
  }

  // ── Expand modal ──────────────────────────────────────────────────────────
  let modalHandle: OverlayHandle | null = null;

  function openExpandModal(): void {
    if (modalHandle) { modalHandle.close(); modalHandle = null; }

    // Only reachable while Insights is closed — the button and the 'E'
    // shortcut are both hidden/disabled while insightsOpen (see
    // setInsightsOpen's own comment: reparenting insightsTab.el here used to
    // leave both the original view and the modal's own "back to wafer view"
    // blank). What to reparent: the summary-panel wrapper if one exists
    // (canvas + panel side-by-side), else just canvasWrap.
    const reparentRoot: HTMLElement = summaryPanelWrapper ?? autoSummaryPanelWrapper ?? canvasWrap;

    reparentRoot.style.flex      = '1';
    reparentRoot.style.minWidth  = '0';
    reparentRoot.style.minHeight = '0';

    // toolbar lives in `container` (a sibling of reparentRoot), not inside
    // reparentRoot itself, so openReparentedModal must move it in too —
    // otherwise it stays behind in the now-empty original container and the
    // expanded view has no toolbar at all. Reparented alongside reparentRoot,
    // not as a separate call, so the shared helper's own stale-reference
    // guard sees both moves as one unit — see its own header comment in
    // toolbar.ts for why that matters (this pairing is exactly the case that
    // used to throw NotFoundError on close).
    //
    // ownerDocument is passed explicitly so the modal builds into the SAME
    // document as reparentRoot (e.g. a gallery card detached into its own
    // popup window) rather than silently building in whatever document
    // happened to be the bare global — that would move reparentRoot out of
    // the popup and pop the modal up on the wrong page.
    const handle = openReparentedModal(toolbar ? [reparentRoot, toolbar] : [reparentRoot], {
      ownerDocument,
      onClosed: () => {
        modalHandle = null;
        if (btnExpand) btnExpand.style.display = 'flex';
        canvas.focus({ preventScroll: true });
        // Fit will recompute via ResizeObserver firing on reparent.
      },
    });
    if (!handle) return; // re-entrancy guard — shouldn't trip, modalHandle.close() above already cleared it

    // contentWrap has no `position` of its own (flex child, static); give it
    // one so toolbar's `position: absolute; top:4px; right:4px` resolves
    // against the modal's content area, the same top-right corner it
    // occupies outside the modal.
    if (toolbar) handle.contentWrap.style.position = 'relative';

    modalHandle = handle;
    if (btnExpand) btnExpand.style.display = 'none';
  }

  // ── Apply scene option changes ─────────────────────────────────────────────

  // Rebuild and redraw without firing the external callback.
  // Used by ctrl.setOptions() so programmatic updates don't re-fire the callback
  // (consistent with renderWaferGallery behaviour and documented API contract).
  function syncOpts(partial: Partial<WaferViewOptions>): void {
    const prevMode = viewOpts.plotMode;
    viewOpts = { ...viewOpts, ...partial };
    // Changing plot mode changes the colorbar/legend width, which shifts the
    // auto-fit viewport's originX. Invalidate fittedViewport so it is
    // recomputed for the new mode before drawSelectionOverlay reads it.
    if (partial.plotMode !== undefined && partial.plotMode !== prevMode) {
      fittedViewport = null;
      // Switching into a bin mode: reset to default if scheme is not bin-compatible.
      const newMode = viewOpts.plotMode;
      const isBinMode = newMode === 'hardBin' || newMode === 'softBin';
      const BIN_SCHEMES = new Set(['default', 'accessible', 'custom']);
      if (isBinMode && !BIN_SCHEMES.has(viewOpts.colorScheme ?? '')) {
        viewOpts = { ...viewOpts, colorScheme: 'default' };
      }
    }
    // legendPosition only affects canvas layout — skip the scene rebuild.
    const onlyLegendStyle = Object.keys(partial).every(k => k === 'legendPosition');
    if (!onlyLegendStyle) rebuildView();
    syncLegendStyleBtnFn?.();
    syncPaletteBtnFn?.();
    syncLogScaleBtnFn?.();
    syncColorbarRangeBtnFn?.();
    render();
    const modeChanged = partial.plotMode !== undefined && partial.plotMode !== prevMode;
    if (partial.colorScheme !== undefined || modeChanged) { renderSummaryPanel(); renderAutoSummaryPanel(); }
  }

  // Rebuild, redraw, and fire onViewOptionsChange.
  // Used by all toolbar interactions.
  function applyOpts(partial: Partial<WaferViewOptions>): void {
    syncOpts(partial);
    const changed = Object.keys(partial) as (keyof WaferViewOptions)[];
    onViewOptionsChange?.(viewOpts, changed, classifyChanged(changed));
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  let rafPending = false;

  function scheduleRender(): void {
    if (rafPending) return;
    rafPending = true;
    nextFrame(() => { rafPending = false; render(); }, ownerWindow);
  }

  function render(): void {
    const vp = viewport ?? undefined;
    // Derive die pitch from the first die so axis labels show die grid indices.
    const firstDie = currentView.dies[0];
    const diePitchMm = firstDie
      ? { x: firstDie.width, y: firstDie.height }
      : drawOptions.diePitchMm;

    // Hold the right-side reserve constant across mode switches so the wafer
    // doesn't resize when toggling between value and bin modes.
    const cssW = Math.floor(canvas.clientWidth || canvas.width);
    const hasBinData = !!(hbinDefs?.length || sbinDefs?.length ||
      currentView.dies.some(d => d.hbin != null || d.sbin != null));
    const legendPos = viewOpts.legendPosition ?? 'default';
    const isRightLegend = legendPos === 'default' || legendPos === 'compact';
    const colorbarReserve = (drawOptions.colorbarWidth ?? 16) + 28;
    const stableRight = hasBinData && isRightLegend
      ? legendPos !== 'default'
        ? Math.max(BIN_LEGEND_W, colorbarReserve)
        : cssW < BIN_LEGEND_ADAPT_FLOATING
          ? 0
          : cssW < BIN_LEGEND_ADAPT_COMPACT
            ? Math.max(BIN_LEGEND_W_COMPACT, colorbarReserve)
            : Math.max(BIN_LEGEND_W, colorbarReserve)
      : undefined;

    const result = toCanvas(canvas, currentView, {
      ...drawOptions,
      topClearance:    showToolbar ? TOOLBAR_CLEARANCE : 0,
      minRightReserve: stableRight,
      legendPosition:  legendPos,
      legendOffset,
      diePitchMm,
      fallbackFormat: currentFallbackFormat,
      showAxes:  drawOptions.showAxes ?? (viewport !== null),
      viewport: vp,
      activeBin: viewOpts.plotMode === 'metadata' ? viewOpts.highlightMetadataValue : viewOpts.highlightBin,
      hbinDefs,
      sbinDefs,
      metadataFields,
    });

    binLegendRows = result.binLegendRows;
    legendBoxRect = result.legendBox ?? null;

    if (!fittedViewport) fittedViewport = result.viewport;

    if (selectedKeys.size > 0) drawSelectionOverlay();
    if (isBoxSelecting) drawBoxOverlay();
  }

  // ── Selection highlight overlay ────────────────────────────────────────────
  function drawSelectionOverlay(): void {
    const vp = currentViewport();
    if (!vp) return;
    const ctx = canvas.getContext('2d')!;
    const pts = currentView.hoverPoints;

    const firstRect = currentView.rectangles[0];
    const dieHalfW  = firstRect ? (firstRect.width  / 2) * vp.ppm : vp.ppm * 0.5;
    const dieHalfH  = firstRect ? (firstRect.height / 2) * vp.ppm : vp.ppm * 0.5;
    // Inset slightly so the ring sits just inside the die edge.
    const inset = Math.max(1, Math.min(3, dieHalfW * 0.08));

    // Collect selected die screen rects — O(selected) via pre-built key→index map.
    const hw = dieHalfW - inset;
    const hh = dieHalfH - inset;
    type SelRect = { sx: number; sy: number };
    const selRects: SelRect[] = [];
    for (const key of selectedKeys) {
      const idx = dieKeyIndex.get(key);
      if (idx === undefined) continue;
      selRects.push({ sx: vp.originX + pts[idx].x * vp.ppm, sy: vp.originY - pts[idx].y * vp.ppm });
    }
    if (!selRects.length) return;

    ctx.save();
    ctx.setLineDash([]);

    // Neutral dark tint — one batched fill pass. A hue-based tint (the
    // previous amber wash) reads fine on cool schemes but nearly vanishes on
    // any scheme with an amber/yellow/orange region of its own (inferno,
    // plasma, traffic, jet, default/thermal's yellow midpoint, accessible's
    // orange). A neutral darkening has no hue to collide with.
    ctx.fillStyle = 'rgba(0,0,0,0.12)';
    ctx.beginPath();
    for (const { sx, sy } of selRects) ctx.rect(sx - hw, sy - hh, hw * 2, hh * 2);
    ctx.fill();

    // White halo — one batched stroke pass.
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth   = 3;
    ctx.beginPath();
    for (const { sx, sy } of selRects) ctx.rect(sx - hw, sy - hh, hw * 2, hh * 2);
    ctx.stroke();

    // Black inner stroke — one batched stroke pass. White-halo-plus-black-core
    // is the classic "marching ants" selection pattern: white and black sit at
    // opposite ends of the luminance range, so at least one of the two always
    // has strong contrast against any die fill colour, regardless of the
    // active colour scheme's hue. A single coloured stroke (the previous
    // amber) can only guarantee that for schemes that don't already use that
    // hue — this doesn't depend on hue at all.
    ctx.strokeStyle = 'rgba(0,0,0,0.9)';
    ctx.lineWidth   = 1.5;
    ctx.beginPath();
    for (const { sx, sy } of selRects) ctx.rect(sx - hw, sy - hh, hw * 2, hh * 2);
    ctx.stroke();

    ctx.restore();
  }

  // ── Box select overlay ─────────────────────────────────────────────────────
  function drawBoxOverlay(): void {
    const ctx = canvas.getContext('2d')!;
    const x   = Math.min(boxStart.x, boxEnd.x);
    const y   = Math.min(boxStart.y, boxEnd.y);
    const w   = Math.abs(boxEnd.x - boxStart.x);
    const h   = Math.abs(boxEnd.y - boxStart.y);
    ctx.save();
    // Neutral dark tint, not a hue-based one — same reasoning as
    // drawSelectionOverlay above: a fixed hue (previously blue) washes out
    // against any colour scheme sharing that hue range (viridis, jet,
    // plasma/inferno's dark end).
    ctx.fillStyle = 'rgba(0,0,0,0.08)';
    ctx.fillRect(x, y, w, h);
    // White-halo + black-core dashed "marching ants" stroke — white and black
    // sit at opposite luminance extremes, so at least one always contrasts
    // against any die fill regardless of the active colour scheme's hue.
    ctx.setLineDash([5, 3]);
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth   = 3;
    ctx.strokeRect(x, y, w, h);
    ctx.strokeStyle = 'rgba(0,0,0,0.9)';
    ctx.lineWidth   = 1.5;
    ctx.strokeRect(x, y, w, h);
    ctx.restore();
  }

  // ── Download PNG ───────────────────────────────────────────────────────────
  function downloadPng(): void {
    canvas.toBlob(blob => {
      if (!blob) return;
      saveImageBlob(blob, options.downloadFilename ?? 'wafermap', options.onSaveImage);
    });
  }

  // ── Zoom helpers ───────────────────────────────────────────────────────────
  function clampedPpm(newPpm: number): number {
    if (!fittedViewport) return newPpm;
    return Math.max(fittedViewport.ppm * minZoom, Math.min(fittedViewport.ppm * maxZoom, newPpm));
  }

  function zoomAt(cssPx: number, cssPy: number, factor: number): void {
    const vp = viewport ?? fittedViewport;
    if (!vp) return;
    const newPpm     = clampedPpm(vp.ppm * factor);
    const scale      = newPpm / vp.ppm;
    const newOriginX = cssPx - (cssPx - vp.originX) * scale;
    const newOriginY = cssPy - (cssPy - vp.originY) * scale;
    const snapDist   = (fittedViewport?.snapDist ?? 1) / (newPpm / (fittedViewport?.ppm ?? newPpm));
    viewport = { originX: newOriginX, originY: newOriginY, ppm: newPpm, snapDist };
    render();
  }

  function currentViewport(): ViewportTransform | null {
    return viewport ?? fittedViewport;
  }

  // ── Pointer events ─────────────────────────────────────────────────────────
  function onWheel(e: WheelEvent): void {
    if (e.ctrlKey || e.metaKey) {
      // Ctrl/Cmd+scroll or trackpad pinch → zoom toward cursor
      e.preventDefault();
      const rect   = canvas.getBoundingClientRect();
      const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
      zoomAt(e.clientX - rect.left, e.clientY - rect.top, factor);
    } else if (viewport !== null) {
      // Plain two-finger scroll → pan, but only when already zoomed in.
      // At fit-to-screen (viewport === null) let the event pass through so the
      // page can scroll normally.
      e.preventDefault();
      const vp = currentViewport()!;
      const snapDist = viewport.snapDist;
      viewport = { originX: vp.originX - e.deltaX, originY: vp.originY - e.deltaY, ppm: vp.ppm, snapDist };
      render();
    }
  }

  function pointInRect(px: number, py: number, rect: { x: number; y: number; w: number; h: number }): boolean {
    return px >= rect.x && px < rect.x + rect.w && py >= rect.y && py < rect.y + rect.h;
  }

  function onPointerDown(e: PointerEvent): void {
    if (e.button !== 0) return;
    if (!currentViewport()) return;
    canvas.focus({ preventScroll: true });
    canvas.setPointerCapture(e.pointerId);
    const rect = canvas.getBoundingClientRect();
    const px   = e.clientX - rect.left;
    const py   = e.clientY - rect.top;

    if (legendBoxRect && viewOpts.legendPosition === 'floating' && pointInRect(px, py, legendBoxRect)) {
      legendDragPending = true;
      legendDragStart = { x: px, y: py };
      legendOffsetStart = { ...legendOffset };
      return;
    }

    if (spaceHeld && interactMode !== 'pan') {
      spacePanActive = true;
      isPanning  = true;
      panStart   = { x: px, y: py };
      panOrigin  = { x: currentViewport()!.originX, y: currentViewport()!.originY };
      canvas.style.cursor = 'grabbing';
      return;
    }

    if (interactMode === 'zoom' || interactMode === 'select') {
      isBoxSelecting = true;
      boxStart = boxEnd = { x: px, y: py };
      return;
    }
    isPanning = true;
    panStart  = { x: px, y: py };
    panOrigin = { x: currentViewport()!.originX, y: currentViewport()!.originY };
    canvas.style.cursor = 'grabbing';
  }

  function onPointerMove(e: PointerEvent): void {
    const rect  = canvas.getBoundingClientRect();
    const cssPx = e.clientX - rect.left;
    const cssPy = e.clientY - rect.top;

    if (isBoxSelecting) {
      boxEnd = { x: cssPx, y: cssPy };
      scheduleRender();
      return;
    }

    if (legendDragPending) {
      const dx = cssPx - legendDragStart.x;
      const dy = cssPy - legendDragStart.y;
      if (dx * dx + dy * dy > 16) {
        legendDragPending = false;
        draggingLegend = true;
        canvas.style.cursor = 'grabbing';
      }
    }

    if (draggingLegend) {
      legendOffset = {
        x: legendOffsetStart.x + (cssPx - legendDragStart.x),
        y: legendOffsetStart.y + (cssPy - legendDragStart.y),
      };
      scheduleRender();
      return;
    }

    if (isPanning) {
      const vp       = currentViewport()!;
      const snapDist = viewport?.snapDist ?? fittedViewport?.snapDist ?? 1;
      viewport = {
        originX: panOrigin.x + (cssPx - panStart.x),
        originY: panOrigin.y + (cssPy - panStart.y),
        ppm:     vp.ppm,
        snapDist,
      };
      scheduleRender();
      return;
    }

    const vp = currentViewport();
    if (!vp) return;
    const mx  = (cssPx - vp.originX) / vp.ppm;
    const my  = (vp.originY - cssPy) / vp.ppm;
    const hit = hitTest(mx, my, vp.snapDist);
    const die = hit?.die ?? null;

    const legendRow = binLegendRows.find(row =>
      cssPx >= row.x && cssPx < row.x + row.w && cssPy >= row.y && cssPy < row.y + row.h,
    );
    if (legendRow) {
      canvas.style.cursor = 'pointer';
      if (tooltip) {
        tooltip.innerHTML     = legendRow.label ?? `Bin ${legendRow.bin}`;
        tooltip.style.display = 'block';
        positionTooltip(tooltip, canvas, e.clientX, e.clientY);
      }
      onHover?.(null, e);
      return;
    }

    if (interactMode === 'pan') canvas.style.cursor = die ? 'crosshair' : 'grab';

    if (tooltip) {
      if (die) {
        if (renderTooltip) {
          const content = renderTooltip(die);
          if (content === null) {
            tooltip.style.display = 'none';
          } else {
            if (typeof content === 'string') {
              tooltip.innerHTML = content;
            } else {
              tooltip.innerHTML = '';
              tooltip.appendChild(content);
            }
            tooltip.style.display = 'block';
            positionTooltip(tooltip, canvas, e.clientX, e.clientY);
          }
        } else {
          tooltip.innerHTML = buildHoverText(
            die,
            currentView.plotMode,
            testDefs,
            hbinDefs,
            sbinDefs,
            currentFallbackFormat,
            // Read aggregation context from the built View, not viewOpts: a
            // buildWaferMap({ lotStack }) result carries these on the result
            // (→ currentView.aggrMethod/lotSize), and the caller need not repeat
            // them in viewOptions. Using viewOpts here showed the wrong/missing
            // aggregation method on stacked-map tooltips.
            currentView.aggrMethod,
            currentView.lotSize,
            tooltipTestLimit,
            // wafer.metadata, not result.metadata: `result` is the original render-call
            // parameter and is never reassigned, so it goes stale after any setResult()
            // call — `wafer` is the local setResult() does keep live.
            wafer.metadata,
            // Active test from the built View (authoritative, like plotMode above):
            // in value mode the tooltip leads with it; ignored in bin modes.
            currentView.activeTest,
            reticleConfig,
          );
          tooltip.style.display = 'block';
          positionTooltip(tooltip, canvas, e.clientX, e.clientY);
        }
      } else {
        tooltip.style.display = 'none';
      }
    }

    onHover?.(die, e);
  }

  function onPointerUp(e: PointerEvent): void {
    const rect  = canvas.getBoundingClientRect();
    const cssPx = e.clientX - rect.left;
    const cssPy = e.clientY - rect.top;
    const multi = e.ctrlKey || e.metaKey;

    // pointer capture suppresses pointerleave while the button is held, so
    // hide the tooltip explicitly if the pointer was released outside the canvas.
    if (tooltip && (cssPx < 0 || cssPy < 0 || cssPx > rect.width || cssPy > rect.height)) {
      tooltip.style.display = 'none';
    }

    if (isBoxSelecting) {
      isBoxSelecting = false;
      boxEnd = { x: cssPx, y: cssPy };
      const dx = cssPx - boxStart.x;
      const dy = cssPy - boxStart.y;
      const vp = currentViewport();

      if (interactMode === 'zoom') {
        // Zoom mode drag: zoom into the drawn box region.
        if (dx * dx + dy * dy < 25) {
          // Tiny drag — treat as step zoom-in at click point.
          zoomAt(cssPx, cssPy, 2);
        } else if (vp) {
          const x1css = Math.min(boxStart.x, boxEnd.x);
          const x2css = Math.max(boxStart.x, boxEnd.x);
          const y1css = Math.min(boxStart.y, boxEnd.y);
          const y2css = Math.max(boxStart.y, boxEnd.y);
          const boxW  = x2css - x1css;
          const boxH  = y2css - y1css;
          if (boxW > 4 && boxH > 4) {
            const canvasW = canvas.clientWidth;
            const canvasH = canvas.clientHeight;
            const scaleX  = canvasW / boxW;
            const scaleY  = canvasH / boxH;
            const scale   = Math.min(scaleX, scaleY);
            const newPpm  = clampedPpm(vp.ppm * scale);
            const actualScale = newPpm / vp.ppm;
            const cx    = (x1css + x2css) / 2;
            const cy    = (y1css + y2css) / 2;
            viewport = {
              originX: canvasW / 2 - (cx - vp.originX) * actualScale,
              originY: canvasH / 2 - (cy - vp.originY) * actualScale,
              ppm:     newPpm,
              snapDist: vp.snapDist / actualScale,
            };
          }
        }
        render();
        canvas.style.cursor = 'crosshair';
        return;
      }

      // Select mode drag.
      if (dx * dx + dy * dy < 25) {
        handleClick(cssPx, cssPy, multi, e);
      } else if (vp) {
        const x1mm = (Math.min(boxStart.x, boxEnd.x) - vp.originX) / vp.ppm;
        const x2mm = (Math.max(boxStart.x, boxEnd.x) - vp.originX) / vp.ppm;
        const y1mm = (vp.originY - Math.max(boxStart.y, boxEnd.y)) / vp.ppm;
        const y2mm = (vp.originY - Math.min(boxStart.y, boxEnd.y)) / vp.ppm;
        const pts = currentView.hoverPoints;
        const boxDies: Die[] = [];
        for (let i = 0; i < pts.length; i++) {
          if (pts[i].x >= x1mm && pts[i].x <= x2mm &&
              pts[i].y >= y1mm && pts[i].y <= y2mm) {
            const d = currentView.dies[i];
            if (d) boxDies.push(d);
          }
        }
        if (multi) {
          for (const d of boxDies) {
            const key = `${d.x},${d.y}`;
            if (selectedKeys.has(key)) selectedKeys.delete(key);
            else selectedKeys.add(key);
          }
        } else {
          selectedKeys = new Set(boxDies.map(d => `${d.x},${d.y}`));
        }
        onSelect?.(selectionAsDies());
      }
      render();
      canvas.style.cursor = 'crosshair';
      return;
    }

    if (legendDragPending) {
      legendDragPending = false;
      handleClick(cssPx, cssPy, multi, e);
      return;
    }

    if (draggingLegend) {
      draggingLegend = false;
      canvas.style.cursor = 'grab';
      return;
    }

    if (!isPanning) return;
    isPanning = false;
    if (spacePanActive) {
      spacePanActive = false;
      canvas.style.cursor = spaceHeld ? 'grab' : (interactMode === 'pan' ? 'grab' : 'crosshair');
      return;
    }
    canvas.style.cursor = interactMode === 'pan' ? 'grab' : 'crosshair';
    const dx = cssPx - panStart.x;
    const dy = cssPy - panStart.y;
    if (dx * dx + dy * dy < 25) {
      handleClick(cssPx, cssPy, multi, e);
    }
  }

  function handleClick(cssPx: number, cssPy: number, multi: boolean, e: PointerEvent): void {
    // Check bin legend hit first — legend rows take priority over die clicks.
    // hardBin/softBin rows toggle the numeric highlightBin; metadata rows
    // (string key) toggle its string analogue, highlightMetadataValue.
    for (const row of binLegendRows) {
      if (cssPx >= row.x && cssPx < row.x + row.w && cssPy >= row.y && cssPy < row.y + row.h) {
        if (typeof row.bin === 'number') {
          const next = viewOpts.highlightBin === row.bin ? undefined : row.bin;
          applyOpts({ highlightBin: next });
        } else {
          const next = viewOpts.highlightMetadataValue === row.bin ? undefined : row.bin;
          applyOpts({ highlightMetadataValue: next });
        }
        return;
      }
    }

    if (legendBoxRect && pointInRect(cssPx, cssPy, legendBoxRect)) {
      return;
    }

    const vp = currentViewport();
    if (!vp) return;
    const hit = hitTest((cssPx - vp.originX) / vp.ppm, (vp.originY - cssPy) / vp.ppm, vp.snapDist);
    const die = hit?.die ?? null;

    if (die) {
      onClick?.(die, e);
      const key = `${die.x},${die.y}`;
      if (multi) {
        // Toggle this die.
        if (selectedKeys.has(key)) selectedKeys.delete(key);
        else selectedKeys.add(key);
      } else {
        // Replace selection with just this die.
        selectedKeys = new Set([key]);
      }
      onSelect?.(selectionAsDies());
      render();
    } else if (!multi) {
      // Click on empty space clears selection.
      selectedKeys = new Set();
      onSelect?.([]);
      render();
    }
  }

  function selectionAsDies(): Die[] {
    const result: Die[] = [];
    const pts = currentView.hoverPoints;
    for (let i = 0; i < pts.length; i++) {
      const d = currentView.dies[i];
      if (d && selectedKeys.has(`${d.x},${d.y}`)) result.push(d);
    }
    return result;
  }

  function onPointerLeave(): void {
    if (tooltip) hideTooltip(ownerDocument);
    onHover?.(null, new MouseEvent('mouseleave'));
    canvas.style.cursor = interactMode === 'pan' ? 'grab' : 'crosshair';
  }

  // The shared singleton tooltip (toolbar.ts) makes a frozen tooltip structurally
  // impossible across instances, but a captured pointer still needs an explicit
  // out: while a pointer is captured (set in onPointerDown) the browser suppresses
  // pointerleave, so a gesture interrupted without a pointerup — pointercancel from
  // the OS/WebView on focus loss, a context menu, a touch gesture — must also reset
  // gesture state (pan/box-select), which the tooltip singleton alone does not do.
  function onPointerCancel(): void {
    isPanning         = false;
    spacePanActive    = false;
    isBoxSelecting    = false;
    legendDragPending = false;
    draggingLegend    = false;
    if (tooltip) hideTooltip(ownerDocument);
    onHover?.(null, new MouseEvent('mouseleave'));
    canvas.style.cursor = interactMode === 'pan' ? 'grab' : 'crosshair';
    render();
  }

  // ── Hit testing ────────────────────────────────────────────────────────────
  function hitTest(mx: number, my: number, snapDist: number): { die: Die; index: number } | null {
    const pts  = currentView.hoverPoints;
    const rcts = currentView.rectangles;

    // First pass: exact rectangle containment — handles partial dies whose
    // centres lie outside the wafer and would otherwise snap to a neighbour.
    for (let i = 0; i < rcts.length; i++) {
      const r = rcts[i];
      if (Math.abs(mx - r.x) <= r.width / 2 && Math.abs(my - r.y) <= r.height / 2) {
        const die = currentView.dies[i];
        return die ? { die, index: i } : null;
      }
    }

    // Second pass: nearest-centre fallback for clicks in the kerf gap.
    let bestDie: Die | null = null;
    let bestIndex = -1;
    let bestDist = snapDist * snapDist;
    for (let i = 0; i < pts.length; i++) {
      const dx = pts[i].x - mx, dy = pts[i].y - my;
      const d2 = dx * dx + dy * dy;
      if (d2 < bestDist) { bestDist = d2; bestDie = currentView.dies[i] ?? null; bestIndex = i; }
    }
    return bestDie ? { die: bestDie, index: bestIndex } : null;
  }

  // ── ResizeObserver ─────────────────────────────────────────────────────────
  // Constructed via the OWNER window's ResizeObserver class, not the bare
  // global — same bug class as the rAF/matchMedia fixes above. A gallery card
  // detached into its own popup window has its DOM built by JS running in the
  // OPENER's realm, so an unqualified `new ResizeObserver(...)` resolves to
  // the opener's constructor — and observations made through it appear to
  // stay tied to the opener's rendering/delivery lifecycle rather than the
  // popup's, so notifications for layout changes IN the popup only get
  // delivered once something in the OPENER's document triggers a frame (e.g.
  // the user moving the mouse there). Constructing through the popup's own
  // `ownerWindow.ResizeObserver` ties delivery to the popup's own lifecycle.
  const resizeObserver = new ownerWindow.ResizeObserver(() => {
    fittedViewport = null;
    viewport = null;
    render();
  });
  resizeObserver.observe(canvas);

  // ── Unrenderable-container guard ───────────────────────────────────────────
  // The canvas fills its container, so the container must have a resolved height.
  // The acute failure is a flex/grid child whose ancestors never resolve a height:
  // the container stays 0-tall, the canvas can't get a height from it, and the map
  // is invisible or oscillates — the commonest embedding mistake. We own validity
  // here, so we warn with the fix. We only warn when the caller did NOT pass an
  // intrinsic `height` (that path is self-resolving) and the container both started
  // at zero height and is still flat after layout settles (a bare block-flow div is
  // fine — it grows to the canvas — so pre-layout zero alone is not enough).
  if (options.height == null && containerHeightBefore <= 0) {
    nextFrame(() => nextFrame(() => {
      if (container.clientHeight > 0) return; // resolved after layout — all good
      console.warn(
        '[wafermap] The map container has zero height, so the map cannot render. ' +
        'renderWaferMap fills its container — give the container a resolved height: ' +
        'an explicit CSS `height` (e.g. 600px), a height-resolved flex/grid parent, ' +
        'or `position:absolute; inset:0`. Alternatively pass `{ height: 600 }` in the ' +
        'render options and the library will size it for you.',
      );
    }));
  }

  // ── DPR change listener (browser zoom / display change) ────────────────────
  // ResizeObserver does not fire when devicePixelRatio changes without a layout
  // size change. Re-register on each change to catch successive zoom steps.
  let dprMediaQuery = ownerWindow.matchMedia(`(resolution: ${ownerWindow.devicePixelRatio}dppx)`);
  const onDprChange = () => {
    dprMediaQuery.removeEventListener('change', onDprChange);
    dprMediaQuery = ownerWindow.matchMedia(`(resolution: ${ownerWindow.devicePixelRatio}dppx)`);
    dprMediaQuery.addEventListener('change', onDprChange);
    render();
  };
  dprMediaQuery.addEventListener('change', onDprChange);

  // ── Colour-scheme change listener (OS light/dark flip) ─────────────────────
  // Canvas chrome colours are resolved from --wmap-* at draw time (canvasTheme.ts
  // / toCanvas). A host that maps those tokens to OS-driven theme variables
  // changes them on a light/dark flip, but nothing re-runs the draw — so
  // re-render to re-resolve the palette. Cheap: one redraw only when the OS
  // scheme actually changes, never per frame.
  const schemeMediaQuery = ownerWindow.matchMedia('(prefers-color-scheme: dark)');
  const onSchemeChange = () => render();
  schemeMediaQuery.addEventListener('change', onSchemeChange);

  // ── Window focus loss ──────────────────────────────────────────────────────
  // Alt-tab / app switch (notably in a Tauri WebView) moves the pointer out of
  // the window without firing pointerleave or pointercancel. The shared tooltip
  // would otherwise linger visibly until the next hover reclaims it; hide it now.
  const onWindowBlur = () => { if (tooltip) hideTooltip(ownerDocument); };
  ownerWindow.addEventListener('blur', onWindowBlur);

  // ── Wire canvas events ─────────────────────────────────────────────────────
  function onKeyDown(e: KeyboardEvent): void {
    if (e.key === 'Escape' && selectedKeys.size > 0) {
      selectedKeys = new Set();
      onSelect?.([]);
      render();
    }
    if ((e.key === 'e' || e.key === 'E') && toolbarControls !== 'view-only' && showExpandButton && !insightsOpen) {
      e.stopPropagation();
      (onExpand ?? openExpandModal)();
    }
    if (e.ctrlKey || e.metaKey) {
      if (e.key === '=' || e.key === '+') {
        e.preventDefault();
        zoomAt(canvas.clientWidth / 2, canvas.clientHeight / 2, 1.20);
      } else if (e.key === '-') {
        e.preventDefault();
        zoomAt(canvas.clientWidth / 2, canvas.clientHeight / 2, 1 / 1.20);
      } else if (e.key === '0') {
        e.preventDefault();
        resetZoom();
      }
    }
    if (!e.ctrlKey && !e.metaKey && !e.shiftKey) {
      const PAN_STEP = 20;
      const vp = currentViewport();
      if (vp) {
        const snapDist = viewport?.snapDist ?? fittedViewport?.snapDist ?? 1;
        let dx = 0, dy = 0;
        if (e.key === 'ArrowLeft')  { dx =  PAN_STEP; e.preventDefault(); }
        if (e.key === 'ArrowRight') { dx = -PAN_STEP; e.preventDefault(); }
        if (e.key === 'ArrowUp')    { dy =  PAN_STEP; e.preventDefault(); }
        if (e.key === 'ArrowDown')  { dy = -PAN_STEP; e.preventDefault(); }
        if (dx || dy) {
          viewport = { originX: vp.originX + dx, originY: vp.originY + dy, ppm: vp.ppm, snapDist };
          render();
        }
      }
      if (e.key === ' ' && !spaceHeld) {
        e.preventDefault();
        spaceHeld = true;
        if (interactMode !== 'pan') canvas.style.cursor = 'grab';
      }
    }
  }

  function onKeyUp(e: KeyboardEvent): void {
    if (e.key === ' ') {
      spaceHeld = false;
      if (spacePanActive) {
        isPanning = false;
        spacePanActive = false;
      }
      canvas.style.cursor = interactMode === 'pan' ? 'grab' : 'crosshair';
    }
  }

  canvas.style.cursor = 'grab';
  canvas.setAttribute('tabindex', '0'); // make canvas focusable for key events
  canvas.addEventListener('wheel',        onWheel,       { passive: false });
  canvas.addEventListener('pointerdown',  onPointerDown);
  canvas.addEventListener('pointermove',  onPointerMove);
  canvas.addEventListener('pointerup',    onPointerUp);
  canvas.addEventListener('pointerleave', onPointerLeave);
  canvas.addEventListener('pointercancel', onPointerCancel);
  const onDblClick = () => resetZoom();
  canvas.addEventListener('dblclick',     onDblClick);
  canvas.addEventListener('keydown',      onKeyDown);
  canvas.addEventListener('keyup',        onKeyUp);
  // Always stop propagation — prevents canvas interactions (bin legend clicks,
  // die clicks, pan gestures) from bubbling to parent containers such as a
  // gallery card's click-to-modal handler.
  const onCanvasClick = (e: MouseEvent) => { e.stopPropagation(); };
  canvas.addEventListener('click', onCanvasClick);

  // ── Initial render ─────────────────────────────────────────────────────────
  // Reading clientWidth forces a synchronous layout flush, giving us the real
  // size immediately even if the canvas was just appended. This avoids the
  // async ResizeObserver round-trip (which would delay first paint by 1+ frames).
  void canvas.clientWidth;
  render();

  // ── Controller ─────────────────────────────────────────────────────────────
  function resetZoom(): void {
    fittedViewport = null;
    viewport = null;
    render();
  }

  function openGuideWindow(): void {
    import('./userGuideHtml.js').then(m => openUserGuideWindow(
      { buildWaferMap, renderWaferMap, renderWaferGallery: undefined, analyzeWaferMap },
      m.USER_GUIDE_HTML,
      userGuideExtension,
      container,
    ));
  }

  return {
    setDies(newDies: Die[]): void {
      currentDies = newDies;
      rebuildView();
      render();
      if (summaryPanelEl) renderSummaryPanel();
    },

    setResult(newResult: WaferMapResult): void {
      currentResult = newResult;
      wafer         = newResult.wafer;
      currentDies   = newResult.dies;
      hbinDefs      = newResult.hbinDefs;
      sbinDefs      = newResult.sbinDefs;
      testDefs      = newResult.testDefs;
      metadataFields = newResult.metadataFields;
      reticles      = newResult.reticles?.length ? newResult.reticles : undefined;
      reticleConfig = newResult.reticleConfig;
      dataAxisFlip  = newResult.view?.axisFlip;
      resultIsLotStack = newResult.isLotStack;
      resultAggrMethod = newResult.aggrMethod;
      resultLotSize    = newResult.lotSize;
      refreshMetadataBadge();
      rebuildView();
      render();
      if (summaryPanelEl) renderSummaryPanel();
    },

    setOptions(partial: Partial<WaferViewOptions>): void {
      syncOpts(partial);
    },

    getOptions(): WaferViewOptions {
      return { ...viewOpts };
    },

    resetZoom,

    setSelection(dies: Die[]): void {
      selectedKeys = new Set(dies.map(d => `${d.x},${d.y}`));
      render();
    },

    clearSelection(): void {
      selectedKeys = new Set();
      onSelect?.([]);
      render();
    },

    setFallbackFormat(format: 'si' | 'engineering'): void {
      currentFallbackFormat = format;
      rebuildView();
      render();
    },

    setStatsSummary(summary: StatsSummary | undefined): void {
      currentStatsSummary = summary;
      if (summaryPanelEl) {
        renderSummaryPanel();
      } else if (autoSummaryPanelEl) {
        renderAutoSummaryPanel();
      } else if (summary && !summaryPanelOpts?.placement) {
        // Late-mount: statsSummary provided after initial render with no placement option.
        const openOnMount = summaryPanelOpts?.defaultOpen ?? !showToolbar;
        autoSummaryPanelEl = createSummaryPanelEl('right');
        autoSummaryPanelEl.style.display = openOnMount ? 'block' : 'none';
        const parent = canvasWrap.parentElement;
        const next = canvasWrap.nextSibling;
        autoSummaryPanelWrapper = wrapWithSummaryPanel(canvasWrap, autoSummaryPanelEl, 'right');
        parent?.insertBefore(autoSummaryPanelWrapper, next);
        renderAutoSummaryPanel();
      }
      refreshSummaryButton();
    },

    setSummaryVisible(visible: boolean): void {
      if (btnSummary) btnSummary.style.display = visible ? 'flex' : 'none';
    },

    setViewControlsVisible(visible: boolean): void {
      if (sceneControlsEl) sceneControlsEl.style.display = visible ? 'flex' : 'none';
    },

    setExpandVisible(visible: boolean): void {
      if (btnExpand) btnExpand.style.display = visible ? 'flex' : 'none';
    },

    setHelpButtonVisible(visible: boolean): void {
      if (btnHelp) btnHelp.style.display = visible ? 'flex' : 'none';
    },

    setMetadataBadgeVisible(visible: boolean): void {
      metadataBadgeHostHidden = !visible;
      if (metadataBadge) metadataBadge.el.style.display = (visible && !insightsOpen) ? '' : 'none';
    },

    openUserGuide: openGuideWindow,

    setInsightsOpen(open: boolean): void {
      setInsightsOpen(open);
      if (btnInsights) {
        if (open) {
          btnInsights.dataset.active   = '1';
          btnInsights.style.background = CLR.bgActive;
          btnInsights.style.color      = CLR.iconActive;
        } else {
          delete btnInsights.dataset.active;
          btnInsights.style.background = 'transparent';
          btnInsights.style.color      = CLR.icon;
        }
      }
    },

    closeSummaryPanel(): void {
      const panelEl = summaryPanelEl ?? autoSummaryPanelEl;
      if (!panelEl || panelEl.style.display === 'none') return;
      panelEl.style.display = 'none';
      if (btnSummary) {
        delete btnSummary.dataset.active;
        btnSummary.style.background = 'transparent';
        btnSummary.style.color      = CLR.icon;
      }
    },

    setTooltipParent(parent: HTMLElement): void {
      if (tooltip) reparentTooltip(parent);
    },

    getActiveLegend(): Array<{ bin: number | string; name: string; color: string }> | null {
      const mode = viewOpts.plotMode;
      if (mode === 'metadata') {
        const key = viewOpts.activeMetadataKey;
        if (!key) return null;
        const fieldDef = metadataFields?.find(f => f.key === key);
        const values = [...new Set(
          currentDies.map(d => d.metadata?.[key])
            .filter((v): v is string | number | boolean => v !== undefined && v !== null &&
              (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean'))
            .map(String),
        )].sort();
        if (!values.length) return null;
        return values.map((value, index) => {
          const valueDef = fieldDef?.values?.find(v => v.value === value);
          const color = valueDef?.color ?? metadataValueColor(index);
          return { bin: value, name: valueDef?.label ?? value, color };
        });
      }
      if (mode !== 'hardBin' && mode !== 'softBin') return null;
      const isHard = mode === 'hardBin';
      const defs = isHard ? hbinDefs : sbinDefs;
      const bins = [...new Set(currentDies.map(d => isHard ? d.hbin : d.sbin).filter((b): b is number => b !== undefined))].sort((a, b) => a - b);
      if (!bins.length) return null;
      return bins.map(bin => {
        const def = defs?.find(d => d.bin === bin);
        const color = def?.color ?? (isHard ? hardBinColor(bin) : softBinColor(bin));
        return { bin, name: def?.name ?? `Bin ${bin}`, color };
      });
    },

    destroy(): void {
      modalHandle?.close();
      if (hideTimer) clearTimeout(hideTimer);
      tbGetOpenMenu?.()?.remove();
      if (tbCloseOpenMenu) ownerDocument.removeEventListener('click', tbCloseOpenMenu, true);

      canvas.removeEventListener('wheel',        onWheel);
      canvas.removeEventListener('pointerdown',  onPointerDown);
      canvas.removeEventListener('pointermove',  onPointerMove);
      canvas.removeEventListener('pointerup',    onPointerUp);
      canvas.removeEventListener('pointerleave', onPointerLeave);
      canvas.removeEventListener('pointercancel', onPointerCancel);
      canvas.removeEventListener('dblclick',     onDblClick);
      canvas.removeEventListener('keydown',      onKeyDown);
      canvas.removeEventListener('keyup',        onKeyUp);
      canvas.removeEventListener('click',        onCanvasClick);
      resizeObserver.disconnect();
      dprMediaQuery.removeEventListener('change', onDprChange);
      schemeMediaQuery.removeEventListener('change', onSchemeChange);
      ownerWindow.removeEventListener('blur', onWindowBlur);
      disposeOverlayZ();
      // The tooltip is the shared document-level singleton — never destroy it
      // (other instances may still use it). Just hide it; if this instance had
      // moved it into a modal, openOverlay's close() already re-homed it to
      // <body> before this destroy() runs.
      if (tooltip) hideTooltip(ownerDocument);
      toolbar?.remove();
      if (summaryPanelWrapper) {
        summaryPanelWrapper.parentElement?.insertBefore(canvasWrap, summaryPanelWrapper);
        summaryPanelWrapper.remove();
      }
      if (autoSummaryPanelWrapper) {
        autoSummaryPanelWrapper.parentElement?.insertBefore(canvasWrap, autoSummaryPanelWrapper);
        autoSummaryPanelWrapper.remove();
      }
      canvasWrap.remove();
      canvas.style.cursor = '';
      insightsTab?.destroy();
      metadataBadge?.destroy();
    },
  };
}
