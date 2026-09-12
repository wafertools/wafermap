import type { View, ViewOptions, PlotMode } from '../renderer/buildView.js';
import { buildView, buildHoverText, findTestDef, resolveTestNumber } from '../renderer/buildView.js';
import type { Die } from '../core/dies.js';
import type { Reticle } from '../core/reticle.js';
import { toCanvas, BIN_LEGEND_W, BIN_LEGEND_W_COMPACT, BIN_LEGEND_ADAPT_COMPACT, BIN_LEGEND_ADAPT_FLOATING, type ToCanvasOptions, type ViewportTransform, type BinLegendRow } from './toCanvas.js';
import { buildWaferMap, getTestPassStatus, isParametricTest } from '../renderer/buildWaferMap.js';
import type { TestDef, BinDef, MetadataFieldDef, ReticleConfig, WaferMapResult } from '../renderer/buildWaferMap.js';
import type { StatsFinding, StatsSummary } from '../stats/types.js';
import { analyzeWaferMap } from '../stats/analyzeWaferMap.js';
import { SHADOW, LEADING, wireControlHover, SPACE, EDGE_GUTTER, RADIUS, FONT, CLR, applyOverlayZ, getTooltip, hideTooltip, reparentTooltip, positionTooltip, createToolbarHelpers, buildModeMenuEl, openReparentedModal, openUserGuideWindow, makePaletteBtn, makeLogScaleBtn, makeLegendStyleBtn, makeOverlaysBtn, makeOrientationBtn, menuLayerFor, saveImageBlob, markMenuTrigger, wireMenuA11y, wireExpandToggle, nextFrame, requestedPassFailDisplay, overlayMenuRows, anyOverlayActive, logWmapVersionOnce, type ModeEntry, type SaveImageHandler, type SaveTextHandler, type CheckMenuRow, type UserGuideExtension, type OverlayHandle , buildDataModeEntries, metadataKeyHasData, metadataModeEntry} from './toolbar.js';
import type { SummaryPanelOptions, FindingsNotice } from './summaryPanel.js';
import {
  createSummaryPanelEl, wrapWithSummaryPanel, renderWaferSummaryContent } from './summaryPanel.js';
import type { FindingsFilter } from '../stats/filterFindings.js';
import { collectWarnings, buildWarningsMenuEl, severityOf, type WarningsOptions, type WaferWarning } from './warnings.js';
import { ICONS } from './icons.js';
import { metadataValueColor, NO_DATA_FILL } from '../renderer/colorMap.js';
// TYPE-ONLY. A value import here would pull the whole Insights chart suite
// (chartShell, histogram, correlation, boxplot, scatter, capability, trend,
// testPassRate, insightsTab — ~28 KB gzipped) into the initial /render chunk,
// which every consumer pays for even though `insights` is opt-in and off by
// default. It is loaded on first open instead, the same way userGuideHtml is,
// and tests/bundle-size.test.mjs pins both.
import type { InsightsOptions, InsightsTabHandle } from './insightsTab.js';
import { createIdentityHeader, collapsedLabel, type IdentityHeaderController } from './identityHeader.js';
import { getDieKey, hasPosition, isPositionedDie } from '../core/dies.js';
import { buildDieListSection, type DieListDisplayOptions } from './dieList.js';
import { buildMaplessSummary } from './maplessSummary.js';
import { resolveBinColors, binColorWarning, type BinColors } from '../renderer/binColors.js';

// ── Public types ───────────────────────────────────────────────────────────────

/**
 * Stable display preferences — worth persisting to localStorage or a user profile.
 * These describe how the user wants to view wafer maps in general.
 */
export interface WaferPreferences {
  /**
   * Bin palette for hard/soft-bin maps — a name from `listBinColorSchemes()`.
   * Default `'default'`. Independent of `valueColorScheme`: each mode keeps
   * its own choice, and switching modes never resets either.
   */
  binColorScheme?:         string;
  /**
   * Value gradient for value and stacked maps — a name from
   * `listValueColorSchemes()`. Default `'default'`.
   */
  valueColorScheme?:       string;
  /**
   * Flip the value gradient so high values take its low-end colour. Default
   * false — every built-in gradient reads low = dark, high = light. Offered in
   * the Colour scheme menu as "Reverse gradient"; applies to the dies, the
   * colorbar and the mapless summary together.
   */
  reverseValueScheme?:     boolean;
  /**
   * Honour `BinDef.color` where a bin definition supplies one. Default true.
   * The toolbar offers the toggle only when some definition carries a colour.
   */
  useDefinedBinColors?:    boolean;
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
   * Draw this map's own legend block — the categorical bin legend, the spec/
   * pass-fail legend, or the value colorbar, whichever the plot mode calls for.
   * Default true.
   *
   * Exists for the gallery, where one lot-level legend can stand in for every
   * card's, so the cards can spend that width on the wafer instead. It is a
   * view option rather than a render-time flag because the gallery toggles it
   * live via `setOptions`.
   *
   * Suppressing a legend also suppresses a *control* — legend rows are click
   * targets that toggle `highlightBin` for this map — so only turn it off where
   * an equivalent control is still reachable, and never where the map's scale
   * is its own (a data-ranged colorbar). `renderWaferGallery` owns that rule.
   */
  showLegend?:             boolean;
  /**
   * Hatch dies whose bin is not a pass bin, giving pass/fail a channel that is
   * not hue. Default false. Bin modes only — in value mode the spec markers
   * already serve this role.
   */
  markFailingDies?:        boolean;
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
   * The full, ordered list of metadata values to assign colours from in
   * `metadata` plot mode — applied only when `key` matches `activeMetadataKey`.
   * Set by a host rendering several wafers together (`renderWaferGallery` does
   * it for you) so every map indexes into ONE list; without it each map derives
   * the order from its own dies, and a wafer missing a value the others have
   * paints every later value in the next map's colour. See `ViewOptions`.
   */
  metadataValueOrder?: { key: string; values: string[] };
  /**
   * Bin colours resolved over the whole population being shown together —
   * set by `renderWaferGallery` so a bin is one colour on every card. A lone
   * map leaves it unset and resolves over its own dies. See `ViewOptions.binColors`.
   */
  binColors?: BinColors;
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

/**
 * The drawing parameters `renderWaferMap` forwards to the canvas. Declared
 * explicitly rather than inherited from `ToCanvasOptions`, which is what this
 * interface used to do.
 *
 * That inheritance leaked 16 low-level fields onto the top-level render API, and
 * five of them were **accepted and silently ignored** — `renderWaferMap` computes
 * or overrides them on every draw (`topClearance` is hardcoded to 0,
 * `minRightReserve` is derived from the legend, and `markFailingDies`/`activeBin`/
 * `hoverBin` are read from `viewOptions` and internal hover state instead). An
 * option that is typed, documented and ignored costs a caller a debugging session
 * to discover the API lied, so they are gone rather than merely undocumented.
 *
 * Listing the fields also stops future `ToCanvasOptions` additions arriving here
 * by accident: `toCanvas` is the low-level surface and is free to grow, and a
 * caller who genuinely needs that level of control should call it directly.
 *
 * These stay at the top level of `RenderOptions` rather than moving under a
 * nested `draw` key. Grouping would read better, but it would break every caller
 * of the ten options that DO work in exchange for tidiness alone, and the defect
 * here was the five that don't.
 */
type ForwardedDrawOptions = Pick<ToCanvasOptions,
  | 'padding'
  | 'background'
  | 'showColorbar'
  | 'colorbarWidth'
  | 'showAxes'
  | 'showTitle'
  | 'legendPosition'
  | 'legendOffset'
  | 'diePitchMm'
  | 'fallbackFormat'
  | 'metadataFields'>;

export interface RenderOptions extends ForwardedDrawOptions {
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
   * Show an always-visible identity header row (lot, wafer ID, product, test
   * program, temperature, etc.) above the canvas. Default true. Independent
   * of `showToolbar` and the Insights tab — this exists so basic wafer/lot
   * identity is never hidden behind a mode or toggle. A real layout row, not
   * an overlay, so it can never collide with anything the canvas draws
   * (colorbar, legend, toolbar) regardless of `legendPosition`. Carries identity
   * and nothing else — Expand lives in the toolbar with the other view
   * controls, so turning this off costs only the identity text. Collapsed by
   * default to a single identifying line; click/Enter/Space expands a panel
   * over the top of the canvas to the full field set. Renders nothing when the
   * result has no metadata/lot-stack context.
   */
  showIdentity?: boolean;
  /**
   * Inset for this map's own chrome row (identity + toolbar) and for a Summary
   * panel docked inside the map area, from the edge of the map area.
   *
   * Defaults to `EDGE_GUTTER` — correct for a standalone map, where the map
   * area IS the region and its chrome is a bounded surface against that edge.
   * Pass the smaller `MAP_CHROME_INSET` when the map is embedded in a surface
   * that already provides its own inset (this is what `renderWaferGallery`
   * passes for its cards); a second full gutter inside one stacks two, which
   * reads as a toolbar standing well off the side of the card.
   */
  chromeInset?: string;
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
   * A row at the top of the Findings section stating that a category of finding
   * is not present, and optionally offering to compute it — see
   * {@link FindingsNotice}. wmap never raises this itself: only the host knows
   * what analysis it chose to skip and what running it would cost. Replaceable
   * afterwards via the controller's `setFindingsNotice`.
   */
  findingsNotice?: FindingsNotice;
  /**
   * Display preferences for every built-in die-list surface: the
   * coordinate-less map replacement, the "+N dies without position data"
   * footer, and the "View die list" link in the Summary panel (§5.4.4) — on
   * by default whenever `summaryPanel` is set; pass `{ enabled: false }` to
   * hide just that link, leaving the other two surfaces unaffected. This
   * option carries preferences only — the wafer metadata and metadata field
   * definitions the table needs are always taken from the current build
   * result, never from this option, so a host cannot substitute the wrong
   * identity data into an export.
   */
  dieList?: DieListDisplayOptions;
  /**
   * Custom tooltip renderer. When provided, replaces the built-in tooltip content.
   * Return a string (set as innerHTML), an HTMLElement (appended directly), or null to suppress the tooltip.
   * The built-in tooltip wrapper (positioning, show/hide behaviour) is preserved.
   */
  renderTooltip?: (die: Die) => string | HTMLElement | null;
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
   * Show the expand button in the toolbar and enable the E-key shortcut.
   * Default true. Independent of `showIdentity` — expand is a view control,
   * not part of the wafer's identity. Set false when the host already renders
   * the map inside its own expanded/modal context, where wmap's built-in
   * expand modal would be redundant.
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
   * Cap the map's rendered width and height at this many CSS pixels. When
   * the container is larger, the map sits top-left aligned within it rather
   * than stretching to fill it. Number only (a fixed pixel ceiling, not a
   * responsive length like `height`). Omit for no cap (fills the container,
   * current behaviour). The expand button/E-key still opens the map at full
   * size, unaffected by this cap.
   */
  maxSize?: number;
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
  /**
   * Built-in surfacing of the library's own data warnings (see `WarningsOptions`).
   *
   * Defaults to showing them: the library raises geometry advisories that mean
   * dies may be drawn in the wrong place, and analysis advisories that mean a
   * feature silently produced nothing. It has the information, so telling the
   * user is its responsibility rather than the caller's.
   *
   * Hosts with their own notification system should pass
   * `{ display: false, onWarning }` — the library still collects, de-duplicates
   * and severity-orders, and the host owns only presentation.
   */
  warnings?: WarningsOptions;
}

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
  /**
   * Replace the Findings-section notice (see `FindingsNotice`). Pass `undefined`
   * to clear it — which is what a host does once it has run the analysis the
   * notice was offering.
   */
  setFindingsNotice(notice: FindingsNotice | undefined): void;
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
  /** Show or hide the identity header without affecting its content. */
  setIdentityVisible(visible: boolean): void;
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

// Keys that belong to WaferPreferences — used to classify onViewOptionsChange events.
const PREFERENCE_KEYS = new Set<keyof WaferViewOptions>([
  'binColorScheme', 'valueColorScheme', 'reverseValueScheme', 'useDefinedBinColors', 'rotation', 'flipX', 'flipY',
  'showDieLabels', 'showPartialDies', 'showRingBoundaries', 'showQuadrantBoundaries', 'showReticle', 'showXYIndicator',
  'ringCount', 'legendPosition', 'logScale', 'colorbarRangeMode', 'markFailingDies',
]);

/** Options that change die colours without changing what the view contains —
 *  any of them means every colour-bearing surface (panels, footer) redraws. */
export const COLOR_KEYS: readonly (keyof WaferViewOptions)[] = [
  'binColorScheme', 'valueColorScheme', 'reverseValueScheme', 'useDefinedBinColors', 'binColors',
];

export function classifyChanged(keys: (keyof WaferViewOptions)[]): 'preference' | 'state' | 'mixed' {
  const hasPref  = keys.some(k => PREFERENCE_KEYS.has(k));
  const hasState = keys.some(k => !PREFERENCE_KEYS.has(k));
  if (hasPref && hasState) return 'mixed';
  return hasPref ? 'preference' : 'state';
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * What `renderWaferMap` actually needs: a wafer and its dies, plus anything
 * else `buildWaferMap` would have produced *if* the caller went through it.
 *
 * A `WaferMapResult` satisfies this, so nothing changes for the ordinary
 * `buildWaferMap` → `renderWaferMap` path. The reason it isn't simply
 * `WaferMapResult` is `renderWaferGallery`: it renders every card through this
 * same function, but a card is a `WaferMapDisplayItem` — a hand-built or
 * gallery-synthesised shape carrying no `dataCoverage`, `viewport`,
 * `legendBox`, `binLegendRows` or `reticleConfig`. Those cards used to arrive
 * as `item as WaferMapResult`, which told the type checker the fields were
 * there when at runtime they were simply absent; reading one unguarded threw,
 * and each such read had to be found the hard way. Declaring them optional
 * hands that job back to the compiler.
 */
export type RenderableWaferMap =
  Pick<WaferMapResult, 'wafer' | 'dies'> & Partial<Omit<WaferMapResult, 'wafer' | 'dies'>>;


export function renderWaferMap(
  container: HTMLElement,
  result: RenderableWaferMap,
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
  // True for a wafer with zero positioned dies — no map is ever drawn (see
  // the coordinate-less overlay below), so the toolbar's spatial tool groups
  // (zoom/pan/select/download, orientation, overlays, legend style, log
  // scale, colorbar range) are gated off further down. Declared this early
  // (result is a plain function parameter, available immediately — no
  // ordering hazard) so both the overlay block and the toolbar-construction
  // block below can share one definition.
  // `result.dataCoverage` is populated by buildWaferMap(), but this function is
  // also called per-card by renderWaferGallery with a WaferMapDisplayItem — a
  // shape that never carries dataCoverage, which is why RenderableWaferMap
  // declares it optional. Count result.dies directly when it's absent; that
  // matches computeCoverage's own definition, where totalDies is the positioned
  // dies and unpositionedDies is the remainder.
  const unpositionedDieCount = result.dataCoverage
    ? result.dataCoverage.unpositionedDies
    : result.dies.filter((d) => !hasPosition(d)).length;
  const positionedDieCount = result.dataCoverage
    ? result.dataCoverage.totalDies
    : result.dies.length - unpositionedDieCount;
  const isMapless = positionedDieCount === 0 && unpositionedDieCount > 0;

  // outerFrame stacks the metadata header (when shown) above mapBox in normal
  // flow — a flex column, not an overlay, so the header can never collide
  // with anything mapBox draws/positions internally (colorbar, legend,
  // toolbar), regardless of legendPosition. mapBox itself is otherwise
  // unchanged: everything anchored to it (toolbar, Insights overlay) keeps
  // treating it as its own self-contained box, just with less height to work
  // with when a header is present.
  const outerFrame = ownerDocument.createElement('div');
  Object.assign(outerFrame.style, { display: 'flex', flexDirection: 'column', width: '100%', height: '100%' });
  container.appendChild(outerFrame);

  // mapBox is the actual sizing/positioning box for everything the map owns
  // (canvas, toolbar, Insights overlay) — `container` itself is host-owned and
  // may be arbitrarily large, so it can't be capped directly without fighting
  // the host's own layout. mapBox fills the remaining height in outerFrame
  // (below the header, if any) unless `maxSize` caps it. `position: relative`
  // is unconditional: toolbar and the Insights overlay are absolutely
  // positioned against their nearest positioned ancestor, which must be
  // mapBox (so they track the capped box), not container or outerFrame.
  const mapBox = ownerDocument.createElement('div');
  Object.assign(mapBox.style, { position: 'relative', width: '100%', flex: '1 1 auto', minHeight: '0' });
  if (options.maxSize != null) {
    mapBox.style.maxWidth = `${options.maxSize}px`;
    mapBox.style.maxHeight = `${options.maxSize}px`;
  }
  // Resolved here rather than in the options destructuring further down: the
  // chrome row is built immediately below, before that runs.
  const chromeInset = options.chromeInset ?? EDGE_GUTTER;

  // ── Chrome row ─────────────────────────────────────────────────────────────
  // One row above the map holding the identity (left, flexible) and the toolbar
  // (right, fixed) — the same arrangement renderWaferGallery uses, so the two
  // views frame the same Insights suite identically instead of each inventing
  // its own header.
  //
  // The toolbar used to float over the canvas (`position: absolute`, top-right).
  // That cost no layout row, but every full-bleed overlay then had to reserve a
  // 38px band so it would not render underneath — the Insights suite, the
  // mapless empty state, and a top- or right-docked summary panel each carried
  // their own copy of that reservation. A real row removes all three: nothing
  // overlaps, so nothing has to reserve. The map loses no usable area either,
  // since the identity row already existed above it; the toolbar simply joins
  // it rather than adding a row of its own.
  //
  // `alignItems: stretch` so the identity and the toolbar share one height
  // (see renderWaferGallery's chrome row for the same reasoning); the row
  // collapses to nothing when it holds neither.
  const chromeRowEl = ownerDocument.createElement('div');
  Object.assign(chromeRowEl.style, {
    display: 'flex', alignItems: 'stretch', gap: SPACE.sm,
    // The map area's background, not the host surface's. Inside a gallery card
    // this row sits directly above the canvas, and inheriting the card's white
    // left a pale band across the top of every card where the canvas below it
    // paints a light slate. Matching the canvas makes the row read as part of
    // the map area rather than as a strip of card showing through.
    background: CLR.canvasBg,
    // Breathing room between the chrome and whatever the map area puts at its
    // own top — most visibly a right-docked summary panel, which otherwise
    // began flush against the toolbar and read as joined to it. Same property
    // and value as renderWaferGallery's chrome row: this gap was a 6px padding
    // here against a 10px margin there, two mechanisms and two values for one
    // job.
    //
    // PADDING, not margin. This row paints the map area's background, and a
    // margin falls OUTSIDE that paint — inside a gallery card it showed 10px of
    // the card's white between the slate chrome row and the slate canvas, which
    // is the pale band this background was introduced to remove.
    paddingBottom: SPACE.lg,
    // Inset from the map region's edge on three sides, and the same value is
    // handed to the Insights view for its tab bar and content, so identity and
    // tab labels start on one column instead of stepping on every switch.
    // The TOP matters as much as the sides: a host that gives the map area no
    // padding of its own (tsmap's `#map-container`) had this row butting
    // straight against its own toolbar, two bordered surfaces touching.
    // The CANVAS stays full-bleed deliberately: map area is the priority and a
    // wafer is round, so its corners waste the inset anyway.
    paddingTop: chromeInset, paddingLeft: chromeInset, paddingRight: chromeInset,
    flexShrink: '0', minWidth: '0' } as Partial<CSSStyleDeclaration>);
  outerFrame.appendChild(chromeRowEl);
  outerFrame.appendChild(mapBox);

  /**
   * Hide the chrome row outright when it holds nothing visible.
   *
   * The row is built unconditionally and filled later — identity on the left,
   * toolbar on the right — and its comment says it "collapses to nothing when it
   * holds neither". It didn't: with `showToolbar: false` and no identity to show
   * it still painted `chromeInset` of padding on three sides plus
   * `paddingBottom: SPACE.lg` in the canvas background, i.e. a ~34px band of
   * empty colour above every such map. The expand-modal path already tested
   * `childElementCount > 0` before reparenting the row; the page path never did.
   *
   * Hidden CHILDREN count as absent too, since `setIdentityVisible(false)` and
   * the Insights view both hide the identity in place rather than removing it.
   */
  function syncChromeRowVisibility(): void {
    const hasVisibleChild = [...chromeRowEl.children]
      .some(child => (child as HTMLElement).style.display !== 'none');
    chromeRowEl.style.display = hasVisibleChild ? 'flex' : 'none';
  }
  const canvasWrap = ownerDocument.createElement('div');
  Object.assign(canvasWrap.style, { position: 'relative', width: '100%', height: '100%' });
  const canvas = ownerDocument.createElement('canvas');
  Object.assign(canvas.style, { width: '100%', height: '100%', display: 'block' });
  canvasWrap.appendChild(canvas);
  mapBox.appendChild(canvasWrap);

  // ── Coordinate-less dies: no wafer-shaped visual, ever ──────────────────
  // A fully coordinate-less wafer gets a compact summary *instead of* the map
  // (an opaque overlay — the canvas/toolbar/insights machinery underneath
  // still runs harmlessly on an empty draw list, this just covers it, so
  // nothing else in this function needs to branch). A mixed wafer keeps its
  // normal map and gets a small expandable footer for the unpositioned
  // subset instead. Both default to buildMaplessSummary (a bin breakdown or
  // mini histogram matching the current plot mode, reusing the map's own
  // colour scheme) rather than the dense buildDieListSection table — a
  // "View die list" toggle still reaches the table for CSV export / per-die
  // inspection. See WMAP_ISSUES.md #39.
  let refreshMaplessPanel: (() => void) | null = null;
  if (unpositionedDieCount > 0) {
    const unpositionedDies = result.dies.filter((d) => !hasPosition(d));
    let showingTable = false;

    function buildPanelContent(): HTMLElement {
      if (showingTable) {
        const table = buildDieListSection(unpositionedDies, result.testDefs, {
          ...options.dieList,
          onSaveText:     options.onSaveText,
          waferMetadata:  wafer.metadata, // live local, not result.metadata which goes stale after setResult()
          metadataFields, // live local (setResult-reassigned), not result.metadataFields which goes stale
          ownerDocument });
        if (table) return table;
      }
      // Effective log scale: same resolution buildView.ts uses internally
      // (explicit toggle, falling back to the test's own default; never on
      // for a functional/pass-fail test, which has no continuous value axis).
      const activeTestDef = findTestDef(result.testDefs, viewOpts.activeTest ?? 0);
      const effectiveLogScale = isParametricTest(activeTestDef)
        ? (viewOpts.logScale ?? activeTestDef?.logScale ?? false)
        : false;
      return buildMaplessSummary(unpositionedDies, result.testDefs, {
        plotMode: viewOpts.plotMode ?? 'hardBin',
        activeTest: viewOpts.activeTest,
        hbinDefs,
        sbinDefs,
        binColors: currentView.binColors,
        valueColorScheme: viewOpts.valueColorScheme,
        reverseValueScheme: viewOpts.reverseValueScheme,
        logScale: effectiveLogScale,
        colorbarRangeMode: viewOpts.colorbarRangeMode,
        // Full population (positioned + unpositioned), not just
        // unpositionedDies — keeps this histogram's colour range consistent
        // with whatever the wafer's own visible map is using for the same
        // test, when there is one (a mixed wafer's footer).
        valueRangeDies: result.dies });
    }

    function buildToggleBtn(onToggle: () => void): HTMLButtonElement {
      const btn = ownerDocument.createElement('button');
      btn.type = 'button';
      wireControlHover(btn);
      Object.assign(btn.style, {
        fontSize: FONT.body, padding: `${SPACE.xxs} ${SPACE.sm}`, borderRadius: RADIUS.control, flexShrink: '0',
        border: `1px solid ${CLR.menuBorder}`, background: CLR.menuBg, color: CLR.text, cursor: 'pointer' });
      btn.textContent = showingTable ? 'View chart' : 'View die list';
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        showingTable = !showingTable;
        btn.textContent = showingTable ? 'View chart' : 'View die list';
        onToggle();
      });
      return btn;
    }

    if (isMapless) {
      const overlay = ownerDocument.createElement('div');
      Object.assign(overlay.style, {
        position: 'absolute', inset: '0', background: CLR.panelBg,
        // Even padding all round: with the toolbar now in a row above mapBox
        // rather than floating over its top-right corner, this overlay has
        // nothing to clear.
        padding: SPACE.xl,
        boxSizing: 'border-box', overflow: 'hidden', display: 'flex',
        flexDirection: 'column', gap: SPACE.md, zIndex: '1' });
      const noteRow = ownerDocument.createElement('div');
      Object.assign(noteRow.style, {
        display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: SPACE.md });
      const noteText = ownerDocument.createElement('span');
      Object.assign(noteText.style, { fontSize: FONT.body, color: CLR.label, lineHeight: LEADING.base });
      noteText.textContent = 'No die position data for this wafer.';
      noteRow.appendChild(noteText);
      const contentMount = ownerDocument.createElement('div');
      // display:flex + flexDirection:column so buildPanelContent()'s own
      // root (which sets flex:1;minHeight:0 on itself) can actually stretch
      // to fill this space — without a flex parent here, a block child just
      // sizes to its own content, leaving the histogram/bin-breakdown far
      // smaller than the card actually has room for.
      Object.assign(contentMount.style, { flex: '1', minHeight: '0', overflow: 'auto', display: 'flex', flexDirection: 'column' });
      noteRow.appendChild(buildToggleBtn(() => contentMount.replaceChildren(buildPanelContent())));
      overlay.appendChild(noteRow);
      overlay.appendChild(contentMount);
      canvasWrap.appendChild(overlay);
      // Deferred, not called inline here: buildPanelContent() reads viewOpts,
      // which this block runs before (viewOpts is declared later in this
      // function). refreshMaplessPanel is invoked once after the initial
      // render() call below, once viewOpts actually exists.
      refreshMaplessPanel = () => { if (!showingTable) contentMount.replaceChildren(buildPanelContent()); };
    } else {
      const footer = ownerDocument.createElement('div');
      Object.assign(footer.style, {
        // zIndex 3, above the expanded panel's 2 below — the footer (and its
        // collapse chevron) must stay visible and clickable once expanded,
        // not buried under the panel it opened.
        position: 'absolute', left: '0', right: '0', bottom: '0', zIndex: '3',
        background: CLR.panelBg, borderTop: `1px solid ${CLR.menuBorder}`,
        fontSize: FONT.body, color: CLR.text, cursor: 'pointer', padding: `${SPACE.xs} ${SPACE.md}`,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: SPACE.md });
      // The whole footer is the click target, so it has to look like one.
      wireControlHover(footer, 'bare');
      const label = ownerDocument.createElement('span');
      label.textContent = `+${unpositionedDies.length} ${unpositionedDies.length === 1 ? 'die' : 'dies'} without position data`;
      footer.appendChild(label);
      const chevron = ownerDocument.createElement('span');
      chevron.textContent = '▾';
      Object.assign(chevron.style, { fontSize: FONT.body, lineHeight: LEADING.none, color: CLR.label, flexShrink: '0' });
      footer.appendChild(chevron);
      footer.setAttribute('aria-expanded', 'false');
      footer.setAttribute('aria-label', `${unpositionedDies.length} dies without position data. Click to view.`);

      let expanded: HTMLDivElement | null = null;
      let contentMount: HTMLDivElement | null = null;
      wireExpandToggle(footer, (open) => {
        chevron.textContent = open ? '▴' : '▾';
        footer.setAttribute('aria-expanded', String(open));
        if (open) {
          expanded = ownerDocument.createElement('div');
          // bottom: footer's own measured height (not 0) — otherwise this
          // panel draws directly over the footer strip, hiding the very
          // chevron/label the user would click to close it again. footer
          // already has real layout at this point (appended well before
          // this callback can fire), so getBoundingClientRect() is safe.
          const footerHeight = footer.getBoundingClientRect().height || 28;
          Object.assign(expanded.style, {
            position: 'absolute', left: '0', right: '0', bottom: `${footerHeight}px`, top: '20%', zIndex: '2',
            background: CLR.panelBg, borderTop: `1px solid ${CLR.menuBorder}`,
            padding: SPACE.md, boxSizing: 'border-box', display: 'flex', flexDirection: 'column', gap: SPACE.md });
          // wireExpandToggle closes on the next click anywhere in the
          // document — without this, that includes every click *inside*
          // this panel (it's a sibling of footer, not a descendant), so
          // scrolling the table or hovering a histogram bar would instantly
          // close it. Swallow clicks here; footer's own chevron and the
          // toggle button below remain the only ways to act on this panel.
          expanded.addEventListener('click', (e) => e.stopPropagation());
          const headerRow = ownerDocument.createElement('div');
          Object.assign(headerRow.style, { display: 'flex', justifyContent: 'flex-end' });
          headerRow.appendChild(buildToggleBtn(() => {
            if (contentMount) contentMount.replaceChildren(buildPanelContent());
          }));
          expanded.appendChild(headerRow);
          contentMount = ownerDocument.createElement('div');
          Object.assign(contentMount.style, { flex: '1', minHeight: '0', overflow: 'auto', display: 'flex', flexDirection: 'column' });
          contentMount.appendChild(buildPanelContent());
          expanded.appendChild(contentMount);
          canvasWrap.appendChild(expanded);
        } else if (expanded) {
          expanded.remove();
          expanded = null;
          contentMount = null;
        }
      });
      canvasWrap.appendChild(footer);
      refreshMaplessPanel = () => { if (contentMount && !showingTable) contentMount.replaceChildren(buildPanelContent()); };
    }
  }

  const {
    onHover,
    onClick,
    onSelect,
    onViewOptionsChange,
    showTooltip          = true,
    showToolbar          = true,
    showIdentity   = true,
    toolbarControls      = 'full',
    showPlotModeSelector = true,
    minZoom              = 0.4,
    maxZoom              = 20,
    summaryPanel:        summaryPanelOpts,
    renderTooltip,
    passBins             = [1],
    showHelpButton       = false,
    userGuideExtension,
    onExpand,
    showExpandButton     = true,
    zIndex,
    insights:            insightsOpts,
    warnings:            warningsOpts,
    viewOptions: initialViewOptions = {},
    ...drawOptions
  } = options;
  const insightsEnabled = insightsOpts?.enabled ?? false;

  // Warnings default to ON. The library knows the map may mislead; telling the
  // user is its job, not the caller's. Hosts with their own notification UI opt
  // out via `warnings: { display: false }` and read `onWarning` instead.
  const warningsDisplay = warningsOpts?.display ?? true;

  // Host-supplied overlay stacking (no-op when zIndex is undefined; safe high
  // default applies). Restored on destroy() via the returned disposer.
  const disposeOverlayZ = applyOverlayZ(zIndex);

  let currentFallbackFormat = drawOptions.fallbackFormat;
  let currentStatsSummary = options.statsSummary;

  // Collected once from every source the library has — geometry advisories on
  // the result AND analysis advisories on the summary. Recomputed whenever the
  // stats summary changes so the indicator, the panel banner and `onWarning`
  // can never drift apart.
  let currentWarnings: WaferWarning[] = [];
  let warningsNotified = false;
  // Set by rebuildView: whether bins on the map now on screen share a colour.
  // A property of the VIEW (plot mode, palette, bin population), not of the
  // result or the analysis, so it is carried here and joined in below.
  let binColorAdvisory: WaferWarning | null = null;
  // False until the toolbar's warning-button variables exist. rebuildView runs
  // once during setup, BEFORE they are declared, and calling
  // syncWarningButton then is a temporal-dead-zone ReferenceError that aborts
  // the whole mount — exactly on the lots with enough bins to share colours.
  // The toolbar syncs the button itself when it builds it.
  let warningUiReady = false;
  function refreshWarnings(): void {
    const next = collectWarnings({
      result, statsSummary: currentStatsSummary,
      extra: binColorAdvisory ? [binColorAdvisory] : [] });
    const changed = next.length !== currentWarnings.length
      || next.some((w, i) => w.code !== currentWarnings[i]?.code || w.message !== currentWarnings[i]?.message);
    currentWarnings = next;
    // Always fire once on mount, even with an empty list, so a host can clear
    // its own display without having to special-case "never called".
    if (changed || !warningsNotified) {
      warningsNotified = true;
      warningsOpts?.onWarning?.(next);
    }
  }
  // Before anything that reads currentWarnings — the summary panel can mount
  // ahead of the toolbar when `summaryPanel.placement` is set.
  refreshWarnings();
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
  // view.dataAxisFlip, NOT view.axisFlip: axisFlip is data XOR interactive, and this
  // value is fed straight back into buildView as `dataAxisFlip` on every rebuild —
  // reading the XOR'd form would double-count any interactive flip already applied.
  let dataAxisFlip: { x: boolean; y: boolean } | undefined = result.view?.dataAxisFlip;
  // Lot-stack context is the library's own derived truth — sourced from the result, never the
  // caller's viewOptions. Drives the stacked-mode availability and the map title's stack qualifier.
  // `?? false`: absent on a WaferMapDisplayItem that isn't a stacked card,
  // which is the common case for a gallery card.
  let resultIsLotStack: boolean        = result.isLotStack ?? false;
  let resultAggrMethod: string | undefined = result.aggrMethod;
  let resultLotSize:    number | undefined = result.lotSize;

  // ── Metadata header (opt-out) ────────────────────────────────────────────────
  // headerBar is mounted as a sibling of mapBox in outerFrame, above it in
  // flow (not gated by showToolbar) so basic wafer/lot identity is always
  // visible, including when the toolbar is hidden — this is the whole point
  // of the feature. As a real layout row rather than a corner overlay, it can
  // never be missed or collide with anything mapBox draws. setInsightsOpen
  // still hides it while Insights is open, purely because the Insights tab
  // already shows this wafer's metadata in its own strip, so showing it twice
  // would be redundant.
  // Tracks whether the *host* has asked for it hidden via
  // setIdentityVisible(false), independent of Insights toggling it —
  // so closing Insights doesn't un-hide a header the host explicitly hid.
  // Mirrors the conditions the Insights toggle button is actually built under
  // (see the toolbar block): a real toolbar, not restricted to `view-only`,
  // with Insights enabled. When true the toolbar owns the way out of Insights.
  const toolbarHasInsightsToggle = showToolbar && toolbarControls !== 'view-only' && insightsEnabled;

  let identityHeaderHostHidden = false;
  let metadataBadge: IdentityHeaderController | null = null;
  let headerBar: HTMLDivElement | null = null;
  // Assigned by the toolbar build below, not here. Expand used to live in
  // headerBar, which forced that bar to mount for a wafer with no metadata at
  // all just to give the button a home. Expand is a VIEW control ("give this
  // more room"), not an identity one, so it belongs with the other view
  // controls; headerBar is now free to mount only when there is metadata to
  // show, which is the one job it was added for.
  let btnExpand: HTMLButtonElement | null = null;
  if (showIdentity) {
    metadataBadge = createIdentityHeader(
      collapsedLabel(wafer.metadata ?? {}, lotStackBadgeContext()) ?? '',
      wafer.metadata,
      { lotStack: lotStackBadgeContext(), ownerDocument },
    );
    // metaPanel overlays the top of the canvas area (not headerBar, which
    // stays fixed height) — same contract renderWaferGallery's card headers
    // use, and canvasWrap is already `position: relative`.
    canvasWrap.appendChild(metadataBadge.metaPanel);
    if (!metadataBadge.isEmpty()) {
      headerBar = buildHeaderBar(metadataBadge.wrap);
      // First in the row — the toolbar is appended after it and pins itself
      // right, so order here is header then toolbar.
      chromeRowEl.insertBefore(headerBar, chromeRowEl.firstChild);
      syncChromeRowVisibility();
    }
  }
  // Identity only — a line of text above the map, not a card header. It carries
  // no controls and draws no bottom rule: a single map is not a gallery card,
  // and the borrowed card chrome was what made it read as one. The gallery's
  // card header has a rule because it separates a header from a card body
  // inside a bordered tile; there is no tile here to divide.
  function buildHeaderBar(identityWrap: HTMLDivElement): HTMLDivElement {
    const bar = ownerDocument.createElement('div');
    Object.assign(bar.style, {
      // Symmetric vertical padding. It was 8px top against 6px bottom, a
      // leftover from when this was a standalone header row rather than one
      // half of a row shared with the toolbar — the asymmetry pushed the
      // identity off the toolbar's midline beside it.
      display: 'flex', alignItems: 'center', padding: `${SPACE.sm} ${SPACE.lg}`,
      // Yields width to the toolbar beside it. This carried `flexShrink: '0'`
      // from when it was a full-width row in a COLUMN, where that meant "keep
      // your height"; as a row item it meant "never give up width", and the two
      // together overran their row — in a 700px expand modal a 261px identity
      // and a 472px toolbar came to 733px, so the toolbar overflowed 39px past
      // the modal's edge and was clipped, losing the Help button off-screen and
      // shifting every control beside it. The identity is the half that should
      // give: it already truncates (ellipsis, and the inline fields collapse to
      // the chevron), whereas a clipped toolbar silently loses controls.
      flex: '1 1 auto', minWidth: '0', overflow: 'hidden',
      gap: SPACE.sm } as Partial<CSSStyleDeclaration>);
    Object.assign(identityWrap.style, { flex: '1', minWidth: '0' });
    bar.appendChild(identityWrap);
    return bar;
  }
  function lotStackBadgeContext(): { lotSize: number; aggrMethod?: string } | undefined {
    return resultIsLotStack ? { lotSize: resultLotSize ?? 1, aggrMethod: resultAggrMethod } : undefined;
  }
  function refreshMetadataBadge(): void {
    if (!metadataBadge) return;
    metadataBadge.update(collapsedLabel(wafer.metadata ?? {}, lotStackBadgeContext()) ?? '', wafer.metadata, lotStackBadgeContext());
    const inDom = headerBar?.isConnected ?? false;
    const shouldMount = !metadataBadge.isEmpty();
    if (!shouldMount && inDom) { headerBar!.remove(); headerBar = null; }
    else if (shouldMount && !inDom) {
      headerBar = buildHeaderBar(metadataBadge.wrap);
      // Re-apply the visibility state this bar is under. A `setResult` that
      // introduces metadata remounts the bar, and without this it came back
      // VISIBLE — popping open over a host that had hidden it via
      // `setIdentityVisible(false)`, or over an open Insights view where
      // it has no business appearing.
      headerBar.style.display = identityHeaderHostHidden ? 'none' : '';
      // Before the toolbar, not appended — a remount after `setResult` would
      // otherwise land the identity to the RIGHT of the toolbar.
      chromeRowEl.insertBefore(headerBar, chromeRowEl.firstChild);
      syncChromeRowVisibility();
    }
  }

  const hasDefinedBinColors = [...(hbinDefs ?? []), ...(sbinDefs ?? [])].some(d => d.color);

  let viewOpts: WaferViewOptions = {
    plotMode:               'hardBin',
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
    ...initialViewOptions };

  // ── Insights tab (opt-in) ────────────────────────────────────────────────────
  // Same shared chart suite `renderWaferGallery`'s own `insights` shows for a
  // whole lot (`insightsTab.ts`), given a single-item population — no "Group
  // by" ever appears (nothing is splittable with one item), and there is no
  // click-to-open-wafer (the only wafer is already the one on screen).
  let insightsTab: InsightsTabHandle | null = null;
  let insightsOpen = false;
  /** In flight or resolved — so a double-click can't build two tabs. */
  let insightsLoad: Promise<InsightsTabHandle | null> | null = null;

  /** Load the chart suite and build the tab, once. Resolves to null when
   *  Insights is not enabled, so callers need no separate guard. */
  function ensureInsightsTab(): Promise<InsightsTabHandle | null> {
    if (!insightsEnabled) return Promise.resolve(null);
    if (insightsTab) return Promise.resolve(insightsTab);
    insightsLoad ??= import('./insightsTab.js').then(({ createInsightsTab }) => {
      insightsTab = createInsightsTab({
      getItems: () => [{
        wafer, dies: currentDies, hbinDefs, sbinDefs, testDefs,
        label: String(wafer.metadata?.waferId ?? ''),
        statsSummary: currentStatsSummary }],
      getBinColors: () => currentView.binColors,
      passBins,
      getRingCount: () => viewOpts.ringCount ?? 4,
      onSaveImage: options.onSaveImage,
      onSaveText: options.onSaveText,
      defaultView: insightsOpts?.defaultView,
      // Both of these are FALLBACKS, passed only when the toolbar cannot carry
      // them. The toolbar now stays visible while Insights is open, so its own
      // toggle and Help are permanently reachable in a fixed corner; passing
      // these unconditionally put a second way back and a second Help in the
      // tab row, which is the duplication that hiding the toolbar was meant to
      // avoid in the first place. A host with no toolbar (or a `view-only` one)
      // has no other way out of Insights, so it still gets the back tab.
      // The frame's own identity header stays visible in Insights, so the tab
      // rendering its own strip would show this wafer's metadata twice, one
      // above the other. Same contract renderWaferGallery uses.
      showMetadataStrip: false,
      // Same inset the chrome row above uses, so the tab bar and the identity
      // start on one column. The gallery passes its own (larger) region gutter.
      contentInset: chromeInset,
      backTab: toolbarHasInsightsToggle
        ? undefined
        : { label: 'Map', onBack: () => setInsightsOpen(false) },
      // Only when Help is WANTED but the toolbar cannot show it. The condition
      // was inverted: with `showHelpButton: false` it passed the guide through,
      // so a host that had deliberately switched Help off got one anyway the
      // moment Insights opened — the option silently reversed itself.
      onOpenGuide: (showHelpButton && !showToolbar) ? () => openGuideWindow() : undefined,
      // No openWafer — this map already IS the only wafer there is to open, so
      // a click-to-open would put a second map of the same wafer in a modal.
      // But a boxplot leaf click carries the selected TEST as well, and that
      // half is worth just as much here: show it on the map that is already
      // behind the tab, and leave Insights. Without this the click was inert
      // (correctly hiding its own affordances, so it read as a broken feature
      // to anyone arriving from a gallery, where the same box is clickable).
      // The round trip keeps its context: the tab is hidden, never destroyed,
      // and its sub-tab/group/test selection live above the rebuild, so the
      // Insights button lands back on this same boxplot for this same test.
      focusTest: (testNumber) => {
        applyOpts({ plotMode: 'value', activeTest: testNumber, highlightBin: undefined });
        setInsightsOpen(false);
      },
      ownerDocument });
    // Positioned sibling of canvasWrap covering the same area. Left with
    // `z-index: auto` (no explicit value), this positioned element still
    // paints above canvasWrap's own unpositioned canvas content
    // (position:static content always sits below any positioned sibling,
    // explicit z-index or not) while sitting below the toolbar (a direct
    // child of `mapBox`, not canvasWrap — see its own creation comment —
    // with its own explicit, much higher z-index via `Z_BASE`) — so it
    // visually replaces the map without ever making the toolbar
    // unreachable. Needs an opaque background since the insights grid has
    // gaps between cards that would otherwise let the covered canvas show
    // through.
    // overflowY:auto lives HERE, not on insightsTab.el itself — this
    // wrapper has a genuinely definite height (inset:0 against
    // `mapBox`, so it also respects a `maxSize` cap), so it's the right
    // place to bound/scroll long content; insightsTab.el's own root stays
    // auto-height so it also works correctly for hosts
    // (renderWaferGallery.ts) that mount it as a plain block child with no
    // such bound, where forcing an internal scroll region would just clip
    // content at an arbitrary floor height instead of letting the page grow
    // to show it.
    Object.assign(insightsTab.el.style, {
      // The MAP AREA's background, not the panel surface. It has to be opaque —
      // this covers the canvas — but `panelBg` resolves white in the default
      // theme against the canvas's light slate, so opening Insights changed the
      // page's whole background colour. `canvasBg` is the same value the canvas
      // itself paints, so the two views now sit on one ground and only their
      // content changes. It also matches renderWaferGallery, whose Insights
      // root is transparent over the same background.
      position: 'absolute', inset: '0', background: CLR.canvasBg, overflowY: 'auto',
      // No top reservation. This used to hold a 38px band so the floating
      // toolbar — an absolutely-positioned sibling on the same mapBox corner —
      // would not render over the tab's own content. The toolbar is now a row
      // above mapBox and overlaps nothing, exactly as the gallery's has always
      // been, so it needs the same reservation the gallery needed: none.
      paddingTop: '0' } as Partial<CSSStyleDeclaration>);
      // Hidden on arrival: the tab is only ever built because someone is
      // opening it, and setInsightsOpen reveals it once the load resolves.
      insightsTab.el.style.display = 'none';
      mapBox.appendChild(insightsTab.el);
      return insightsTab;
    });
    return insightsLoad;
  }

  /** Scroll offset of the Insights view as the user last left it — see setInsightsOpen. */
  let insightsScrollTop = 0;
  /** Gestures that mean the reader is scrolling this view themselves. */
  const USER_SCROLL_EVENTS = ['wheel', 'touchstart', 'pointerdown', 'keydown'] as const;

  /**
   * Put the Insights view back where the user left it after a rebuild.
   *
   * Not a single assignment. The cards size themselves from their own measured
   * content (growCardToFitContent, driven by a ResizeObserver) over the frames
   * FOLLOWING the rebuild, so the container is shorter than its final height at
   * first and the browser clamps the restore to what fits at that instant —
   * measured at 212px of a requested 300px — and the layout pass can then reset
   * it to 0 again. So it re-applies over a short window.
   *
   * The retries stop the moment the user touches the view, and that is detected
   * from their INPUT (wheel, touch, pointer, keys), not from the scroll position
   * moving. Position is not evidence of intent here: the browser's own clamping
   * and the post-rebuild reset both move it, which is why an earlier version that
   * read any change as "the user has taken over" gave up on its own first clamped
   * write and never restored anything. Reading only a position PAST the target as
   * a takeover then fixed that and broke the opposite case — scrolling UP inside
   * the window was snapped back three or four times.
   */
  function restoreInsightsScroll(el: HTMLElement, target: number): void {
    if (target <= 0) return;
    let userTookOver = false;
    const timers: number[] = [];
    const stop = () => {
      userTookOver = true;
      for (const t of timers) ownerWindow.clearTimeout(t);
      timers.length = 0;
      for (const ev of USER_SCROLL_EVENTS) el.removeEventListener(ev, stop);
    };
    const attempt = (): boolean => {
      if (userTookOver || !insightsOpen) return true;
      el.scrollTop = target;
      return el.scrollTop >= target;
    };
    if (attempt()) return;
    // Passive: these only observe, and a non-passive wheel listener on a scroll
    // container is a scroll-performance footgun.
    for (const ev of USER_SCROLL_EVENTS) el.addEventListener(ev, stop, { passive: true, once: true });
    for (const delay of [0, 50, 150, 300, 600]) {
      timers.push(ownerWindow.setTimeout(() => { attempt(); }, delay) as unknown as number);
    }
    // Whatever happens, stop listening once the window is over.
    timers.push(ownerWindow.setTimeout(() => {
      for (const ev of USER_SCROLL_EVENTS) el.removeEventListener(ev, stop);
    }, 700) as unknown as number);
  }

  function setInsightsOpen(open: boolean): void {
    if (!insightsEnabled) return;
    const wasOpen = insightsOpen;
    insightsOpen = open;
    // Chrome first, and synchronously: every toggle below acts on toolbar
    // elements that already exist, so the view responds to the click even
    // while the chart suite is still being fetched. Only revealing the tab
    // itself has to wait.
    // Remember where the user was before hiding: reopening runs `tab.render()`,
    // which empties the body, and an emptied scroll container resets to 0 — so
    // every close/reopen silently threw them back to the top of the chart page.
    //
    // Only on a real open → closed TRANSITION. `setInsightsOpen(false)` is public
    // and idempotent, so a host calling it while already closed would otherwise
    // read `scrollTop` off a `display: none` element — 0 — and wipe the position
    // it is meant to be preserving.
    if (insightsTab && !open && wasOpen) insightsScrollTop = insightsTab.el.scrollTop;
    if (insightsTab) insightsTab.el.style.display = open ? 'flex' : 'none';
    // Map-specific toolbar controls (zoom/pan/select, mode/palette/overlays/etc.)
    // have no effect on the chart suite — hide them as a group while it's open.
    // Summary is hidden too (refreshSummaryButton checks insightsOpen) since
    // its panel sits behind the Insights overlay with no visible effect.
    // Expand/Insights/Help live in sceneControlsEl (unwrapped, not part of this
    // group) and all three stay reachable while Insights is open — the band
    // itself stays, in space the Insights view was already reserving for it.
    // isMapless: this group (download/zoom/pan/select) has nothing to act on
    // with no map drawn — stays hidden regardless of Insights state.
    if (mapToolsEl) mapToolsEl.style.display = (open || isMapless) ? 'none' : 'flex';
    if (mapViewControlsEl) mapViewControlsEl.style.display = open ? 'none' : 'flex';
    // Expand stays available in Insights. It is a view-level control — "give
    // this more room" — and the chart suite is the view that most wants it,
    // since the charts on a page interact and reading them side by side in a
    // small frame is the case the modal exists for. It was hidden here only
    // because the old reparent target could not carry the Insights view; that
    // is fixed in openExpandModal (it moves mapBox, which owns both views).
    // …but not while the expand modal is already open. Toggling views inside it
    // ran this and put Expand back, offering to expand a view that is already
    // expanded — and, because it reappeared only in one of the two views, it
    // shifted the Insights toggle beside it along the bar on every switch.
    if (btnExpand) btnExpand.style.display = modalHandle ? 'none' : 'flex';
    // The toolbar STAYS. It lives in the chrome row above the map, which does
    // not belong to either view, so leaving it up costs no height at all and
    // fixes the real complaint: the way back out of Insights stopped moving
    // between the
    // toolbar's right edge and a tab at the left of the chart suite.
    if (toolbar) toolbar.style.display = 'flex';
    // The header STAYS while Insights is open, and it is load-bearing that it
    // does. It is an in-flow sibling ABOVE mapBox, and the toolbar is absolutely
    // positioned INSIDE mapBox — so hiding the header let mapBox rise by the
    // header's height and carried the toolbar up with it, out of the map and
    // into the reserved band at the top of the Insights view. The toggle
    // therefore jumped a row on every switch and landed in an otherwise empty
    // full-width strip, which is exactly the "the control moves" complaint that
    // keeping the toolbar visible was meant to fix.
    //
    // Keeping it also fixes the second half of that complaint: this wafer's
    // identity now sits in one place in both views instead of moving from a
    // header row to the chart suite's own strip. That strip is switched off for
    // this host (`showMetadataStrip: false`) so the two never both render —
    // the same arrangement renderWaferGallery already uses, for the same
    // reason: the frame owns identity, so the tab must not repeat it.
    if (headerBar) headerBar.style.display = identityHeaderHostHidden ? 'none' : '';
    syncChromeRowVisibility();
    // metaPanel is a separate sibling in canvasWrap with its own explicit
    // Z_ABOVE z-index (see its mount comment above) — it paints above
    // insightsTab.el (auto z-index) regardless of DOM order, so an expanded
    // panel must be force-collapsed here or it floats over the chart suite
    // when Insights is opened without collapsing it first.
    if (metadataBadge && open) metadataBadge.collapse();
    refreshSummaryButton();
    if (btnInsights) {
      // The icon itself signals the toggle: a bar-chart glyph means "open
      // Insights", a wafer glyph (while Insights is showing) means "back to
      // the wafer view" — clicking Insights again is otherwise not obvious
      // as the way back, since the button's position/label never move.
      btnInsights.innerHTML = open ? ICONS.wafer : ICONS.analysis;
      btnInsights.ariaLabel = open ? 'Back to wafer view' : 'Insights';
    }
    if (!open) return;
    void ensureInsightsTab().then(tab => {
      // `insightsOpen` is re-read rather than captured: the user can toggle
      // back to the map while the chunk is still downloading, and revealing
      // the tab then would override a decision they already made.
      if (!tab || !insightsOpen) return;
      tab.el.style.display = 'flex';
      tab.render();
      // After render(), not before: the content it just rebuilt is what gives
      // the container a scrollable height to restore into.
      restoreInsightsScroll(tab.el, insightsScrollTop);
    });
  }

  // Analysis-first mount: see InsightsOptions.defaultOpen. Deferred to a
  // microtask so the rest of this render finishes first — setInsightsOpen
  // touches chrome that is still being constructed above.
  if (insightsEnabled && insightsOpts?.defaultOpen) queueMicrotask(() => setInsightsOpen(true));

  let currentView:   View;
  let dieKeyIndex:    Map<string, number>;
  let fittedViewport: ViewportTransform | null = null;
  let viewport:       ViewportTransform | null = null;
  let binLegendRows:  BinLegendRow[] = [];

  /** Bin legend row currently under the pointer — canvas-drawn, so hover is a
   *  redraw rather than a CSS state. `undefined` when the pointer is off the
   *  legend. */
  let hoveredLegendBin: number | string | undefined;
  function setHoveredLegendBin(bin: number | string | undefined): void {
    if (hoveredLegendBin === bin) return;
    hoveredLegendBin = bin;
    render();
  }
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
    // The canvas draw list only ever shows positioned dies — an unpositioned
    // die is never placed on the map, only surfaced via the die-list.
    currentView = buildView(wafer, currentDies.filter(isPositionedDie), {
      plotMode:               so.plotMode,
      binColorScheme:         so.binColorScheme,
      valueColorScheme:       so.valueColorScheme,
      reverseValueScheme:     so.reverseValueScheme,
      useDefinedBinColors:    so.useDefinedBinColors,
      // Resolved over EVERY die, positioned or not — the draw list below gets
      // only positioned dies, but the mapless footer and the Insights charts
      // show the rest, and they must colour a bin exactly as the map does. A
      // gallery supplies its gallery-wide assignment instead.
      binColors: so.binColors ?? resolveBinColors(currentDies, {
        passBins, binColorScheme: so.binColorScheme, hbinDefs, sbinDefs,
        useDefinedBinColors: so.useDefinedBinColors }),
      // Sets ViewRect.binFail and picks pass vs fail colours against the
      // caller's own pass/fail definition, so neither can disagree with the
      // yield figure beside it.
      passBins,
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
      metadataValueOrder:     so.metadataValueOrder,
      logScale:               so.logScale,
      isLotStack:             resultIsLotStack,
      aggregationMethod:      resultAggrMethod ?? so.aggregationMethod,
      lotSize:                resultLotSize ?? so.lotSize,
      dataAxisFlip,
      colorbarRangeMode:      so.colorbarRangeMode,
      passFailDisplay:        so.passFailDisplay,
      fallbackFormat:         currentFallbackFormat,
      interactiveTransform: {
        rotation: so.rotation ?? 0,
        flipX:    so.flipX   ?? false,
        flipY:    so.flipY   ?? false } } satisfies ViewOptions, { hbinDefs, sbinDefs, metadataFields });
    dieKeyIndex = new Map(currentView.dies.map((d, i) => [getDieKey(d), i]));
    // Only for colours this map resolved itself. Supplied colours belong to a
    // wider population (a gallery), whose owner states the advisory once —
    // repeating it on every card would bury it, and name bins a card lacks.
    const nextBinWarning = so.binColors ? null : binColorWarning(currentView.binColors, currentView.plotMode);
    if (nextBinWarning?.message !== binColorAdvisory?.message) {
      binColorAdvisory = nextBinWarning;
      refreshWarnings();
      if (warningUiReady) syncWarningButton();
    }
  }

  rebuildView();

  // ── Summary panel ──────────────────────────────────────────────────────────
  let summaryPanelEl: HTMLDivElement | null = null;
  let summaryPanelWrapper: HTMLDivElement | null = null;
  let summaryActiveFindingId: string | null = null;
  // Host-supplied row at the top of the Findings section. Set at render time
  // via `options.findingsNotice` and replaceable through the controller, since
  // what it says (and whether it is needed) changes once the host runs the
  // analysis it is offering.
  let currentFindingsNotice: FindingsNotice | undefined = options.findingsNotice;
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
      // Same collected set the toolbar indicator shows — including the geometry
      // advisories, which no UI surfaced before.
      warnings: warningsDisplay ? currentWarnings : [],
      passBins,
      ringCount: viewOpts.ringCount ?? 4,
      binColors: currentView.binColors,
      // Drives which bin type the panel's bin breakdown opens on, so a soft-bin
      // map is never described by a hard-bin breakdown.
      plotMode: viewOpts.plotMode ?? 'hardBin',
      // The identity header already renders this wafer's metadata (its expandable
      // panel is built from the same helpers), so the panel must not print it a
      // second time. When the host suppresses that header the panel is the only
      // place the metadata appears, and the section comes back.
      metadataShownElsewhere: showIdentity,
      fallbackFormat: currentFallbackFormat,
      activeFindingId: summaryActiveFindingId,
      findingsFilter,
      findingsNotice: currentFindingsNotice,
      onFindingsFilterChange: renderSummaryPanel,
      onSaveText: options.onSaveText,
      metadataFields,
      dieListOptions: options.dieList,
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
      } });
  }

  function renderSummaryPanel(): void {
    if (summaryPanelEl) renderSummaryPanelInto(summaryPanelEl);
  }

  function renderAutoSummaryPanel(): void {
    if (autoSummaryPanelEl) renderSummaryPanelInto(autoSummaryPanelEl);
  }



  if (summaryPanelOpts?.placement) {
    const placement = summaryPanelOpts.placement;
    summaryPanelEl = createSummaryPanelEl(placement, chromeInset, ownerDocument);

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
    autoSummaryPanelEl = createSummaryPanelEl('right', chromeInset, ownerDocument);

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
  let btnHelp:          HTMLButtonElement | null = null;
  let btnInsights:   HTMLButtonElement | null = null;
  let btnWarnings:   HTMLButtonElement | null = null;
  let btnWarningsSep: HTMLDivElement | null = null;
  warningUiReady = true;

  /** Reflect `currentWarnings` onto the toolbar indicator (hidden when empty). */
  function syncWarningButton(): void {
    if (!btnWarnings || !btnWarningsSep) return;
    const count = currentWarnings.length;
    const show  = count > 0;
    btnWarnings.style.display    = show ? 'flex' : 'none';
    btnWarningsSep.style.display = show ? '' : 'none';
    if (!show) return;

    const worst = severityOf(currentWarnings[0]);
    const label = `${count} data ${count === 1 ? 'warning' : 'warnings'}`;
    // Colour carries severity, but never colour ALONE — the accessible name
    // says it too (UI_STANDARDS.md / WCAG 1.4.1 Use of Color).
    btnWarnings.style.color = worst === 'error' ? CLR.errText : CLR.warnText;
    btnWarnings.ariaLabel = worst === 'error'
      ? `${label} — the map may be positionally wrong`
      : label;
  }


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
      btnSummary.style.color = CLR.findingIndicator;
    } else if (!btnSummary.dataset.active) {
      btnSummary.style.color = CLR.icon;
    }
  }

  if (showToolbar) {
    {
      toolbar = ownerDocument.createElement('div');
      toolbar.dataset.wmapToolbar = 'single';
      Object.assign(toolbar.style, {
        // In flow, in the chrome row — not floating over the canvas. Pinned to
        // the row's trailing edge by `marginLeft: auto`, which holds even when
        // the identity beside it is absent (`showIdentity: false`) and there is
        // no flexible sibling to push it there.
        marginLeft:    'auto',
        // Never gives way: every control must stay hittable at any width, while
        // the identity text beside it degrades gracefully.
        flexShrink:    '0',
        display:       'flex',
        flexDirection: 'row',
        alignItems:    'center',
        // Wrapping rather than scrolling or hiding: every control stays visible
        // and reachable, no scrollbar appears inside a 28px-tall bar, and
        // nothing has to decide which buttons are "less important" — a call this
        // library is badly placed to make, since the warning indicator is the
        // one most worth keeping and the least used.
        // wrap-REVERSE, not wrap. The toolbar's direct children are the two
        // control groups (map tools, then view controls), so it already breaks
        // on a group boundary rather than mid-group. But plain `wrap` puts the
        // FIRST group on top, which pushes Expand — always the top-right control
        // — down to a second row. wrap-reverse stacks the lines the other way, so
        // the trailing group stays on top and Expand keeps its corner.
        //
        // Rows stay right-aligned (flex-end) to match the toolbar's own
        // trailing edge; the slack falls on the left of the lower row.
        flexWrap:       'wrap-reverse',
        justifyContent: 'flex-end',
        // Still bounded, now against the chrome row rather than the map box.
        // `flexShrink: 0` means this takes its max-content width and would run
        // straight out of a narrow container — it has always been wider than a
        // ~300px one — so the cap is what turns overflow into the wrap above.
        // It is the identity beside it that yields the space.
        maxWidth:       '100%',
        background:    CLR.menuBg,
        border:        `1px solid ${CLR.menuBorder}`,
        borderRadius:  RADIUS.control,
        boxShadow:     SHADOW.panel,
        // Full strength, always. It used to sit at 0.35 and fade in on hover —
        // right for something painted ON the wafer, where a permanently solid
        // bar would compete with the data underneath it. In its own row it
        // covers nothing, so ghosting it only made the controls hard to read
        // and hid, until hover, that they were there at all.
        pointerEvents: 'auto' });

      // ── Toolbar helpers ──────────────────────────────────────────────────
      // The toolbar uses the shared singleton tooltip — the same node die hover
      // uses when enabled, so the one-tooltip invariant holds across both.
      const tbTooltip = getTooltip(ownerDocument);
      const tbHelpers = createToolbarHelpers(tbTooltip);
      const { makeBtn, setActive, makeSep, makeMenuRow, makeMenuSection, closeOpenMenu, getOpenMenu, setOpenMenu } = tbHelpers;
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
      mapToolsEl = ownerDocument.createElement('div');
      // flexWrap here is a last resort, not the normal path: the toolbar wraps
      // between groups first. It only engages when a SINGLE group is wider than
      // the container (~230px), where splitting the group is still better than
      // spilling across neighbouring content.
      Object.assign(mapToolsEl.style, {
        display: isMapless ? 'none' : 'flex', alignItems: 'center', gap: '0', flexWrap: 'wrap', justifyContent: 'flex-end' });
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
        sceneControlsEl = ownerDocument.createElement('div');
        Object.assign(sceneControlsEl.style, { display: 'flex', alignItems: 'center', gap: '0', flexWrap: 'wrap', justifyContent: 'flex-end' });
        toolbar.appendChild(sceneControlsEl);

        // Map-view-specific controls (mode, palette, overlays, legend, orientation)
        // — wrapped so they can be hidden as a group while the Insights tab is
        // open, unlike Summary/Expand/Insights/Help below, which stay unwrapped
        // directly in sceneControlsEl (individually hidden/shown as needed —
        // see setInsightsOpen — rather than as part of this group).
        mapViewControlsEl = ownerDocument.createElement('div');
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
            applyOpts({ plotMode: entry.plotMode, activeTest: undefined, activeMetadataKey: entry.activeMetadataKey, passFailDisplay: 'off' });
          } else {
            // Switching to a bin/stacked mode — clear the pass/fail display (only valid in value mode).
            applyOpts({ plotMode: entry.plotMode, activeTest: undefined, activeMetadataKey: undefined, passFailDisplay: 'off' });
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

          // Only include modes for which data is actually present. currentDies
          // (the full, unfiltered die set), not currentView.dies — the view is
          // built from currentDies.filter(isPositionedDie) (see rebuildView), so
          // for a fully coordinate-less wafer currentView.dies is always [],
          // which silently emptied this menu entirely (no bin/value entries
          // ever appeared, even though the dies have hbin/sbin/test data —
          // exactly the non-spatial data this menu is supposed to offer modes
          // for). See WMAP_ISSUES.md #39's follow-up entries for the same
          // "positioned-only source used where the full population was
          // needed" mistake elsewhere (dataCoverage.totalDies vs
          // yieldSummary.totalDies).
          const dies     = currentDies;
          const testDefs = currentView.testDefs;
          // Value mode is available for any per-test data — numeric values or recorded
          // pass/fail verdicts (functional tests). Stacked values need numeric values.
          // Stacked modes are only valid for lot-aggregated data — the view knows via isLotStack.
          const { testEntries, binEntries, stackedEntries } =
            buildDataModeEntries(dies, testDefs, { includeStacked: currentView.isLotStack });

          // One entry per configured metadataFields[].key actually present in the
          // dies (opt-in, never auto-detected — see MetadataFieldDef).
          const metadataEntries: ModeEntry[] = (metadataFields ?? [])
            .filter(f => metadataKeyHasData(dies, f.key))
            .map(metadataModeEntry);

          const menu = buildModeMenuEl(
            btnMode.getBoundingClientRect(),
            testEntries, binEntries, stackedEntries,
            isCurrentEntry, pickEntry,
            { makeMenuRow, makeMenuSection },
            viewOpts.plotMode ?? 'hardBin',
            btnMode.ownerDocument.defaultView ?? window,
            metadataEntries,
          );
          menuLayerFor(btnMode).appendChild(menu);
          setOpenMenu(menu);
          markMenuTrigger(btnMode, true);
          wireMenuA11y(menu, btnMode, closeModeMenu);
        });
        markMenuTrigger(btnMode, false);
        const { btn: btnPalette, sync: syncPalette } = makePaletteBtn(
          tbHelpers,
          () => ({ ...viewOpts, plotMode: viewOpts.plotMode ?? 'hardBin' }),
          () => hasDefinedBinColors,
          applyOpts,
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
            return overlayMenuRows(
              viewOpts,
              hasReticleNow,
              { functionalActive, hasLimits, hasRecorded,
                binMode: (viewOpts.plotMode ?? 'hardBin') === 'hardBin'
                      || (viewOpts.plotMode ?? 'hardBin') === 'softBin' },
              patch => applyOpts(patch),
            );
          },
          () => anyOverlayActive(viewOpts),
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
        // btnPalette stays even when isMapless: it drives the bin/value colour schemes,
        // which buildMaplessSummary's bin breakdown reads too (see
        // refreshMaplessPanel's syncOpts hook) — genuinely functional here,
        // unlike the spatial-only controls skipped below (nothing to zoom,
        // pan, select, orient, overlay, or legend-position when there's no
        // map drawn at all). btnLogScale/btnColorbarRange stay too:
        // buildMaplessSummary's histogram resolves its own value→colour
        // range/log-scale the same way the canvas colorbar does (see
        // resolveValueNormalize, maplessSummary.ts), so both remain
        // functional controls here, not canvas-only ones — their own
        // sync functions (syncLogScaleBtnFn/syncColorbarRangeBtnFn) already
        // gate visibility by plot mode/limits regardless of isMapless.
        mapViewControlsEl!.appendChild(btnPalette);
        mapViewControlsEl!.appendChild(btnLogScale);
        mapViewControlsEl!.appendChild(btnColorbarRange);
        if (!isMapless) {
          mapViewControlsEl!.appendChild(makeSep());
          mapViewControlsEl!.appendChild(btnOverlays);
          mapViewControlsEl!.appendChild(makeSep());
          mapViewControlsEl!.appendChild(btnLegendStyle);
          mapViewControlsEl!.appendChild(makeSep());
          mapViewControlsEl!.appendChild(btnOrient);
        }

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

        // Warning indicator. Deliberately NOT a toast: these are persistent
        // conditions about whether the map can be trusted, and a message that
        // dismisses itself leaves the map still wrong with no way back to the
        // explanation. It is also hidden entirely when there is nothing to say,
        // so an unremarkable map carries no extra chrome.
        //
        // Created unconditionally (when enabled) and shown/hidden by
        // syncWarningButton: analysis raises its own advisories, so a
        // statsSummary arriving after mount can introduce warnings that did not
        // exist when this ran. Toggling visibility avoids rebuilding a toolbar
        // that holds a lot of live button state.
        if (warningsDisplay) {
          btnWarningsSep = makeSep();
          btnWarnings = makeBtn('warning', 'Data warnings', () => {
            const existing = getOpenMenu();
            closeOpenMenu(new MouseEvent('click'));
            if (existing) return;
            const menu = buildWarningsMenuEl(btnWarnings!.getBoundingClientRect(), currentWarnings, ownerWindow);
            menuLayerFor(mapBox).appendChild(menu);
            setOpenMenu(menu);
            wireMenuA11y(menu, btnWarnings!, () => closeOpenMenu(new MouseEvent('click')));
          });
          markMenuTrigger(btnWarnings, false);
          sceneControlsEl!.appendChild(btnWarningsSep);
          sceneControlsEl!.appendChild(btnWarnings);
          syncWarningButton();
        }

        // Order from here to the end of the bar: Insights, Expand, Help.
        // Insights sits beside Summary because the two are the same kind of
        // thing — both swap what the panel area is showing for another way of
        // reading this wafer — while Expand and Help act on the frame itself
        // rather than on the data, so they hold the outer edge.

        // Insights tab — toggles between the canvas and wmap's own chart suite.
        // Gated on the OPTION, not on `insightsTab` — the tab no longer exists
        // until first open, and a button that appears only after you have
        // already opened the thing it opens would be useless.
        if (insightsEnabled) {
          sceneControlsEl!.appendChild(makeSep());
          btnInsights = makeBtn('analysis', 'Insights', () => {
            setInsightsOpen(!insightsOpen);
            setActive(btnInsights!, insightsOpen);
          });
          // Stable identity hook — see renderWaferGallery.ts's identical
          // comment: this button's aria-label toggles between 'Insights'
          // and 'Back to wafer view', so it can't be found by aria-label
          // alone once open.
          btnInsights.dataset.wmapInsightsBtn = '1';
          sceneControlsEl!.appendChild(btnInsights);
        }

        // Expand — a view control, so it sits with the other persistent ones
        // rather than in the metadata header it was briefly moved to. It was
        // only ever put there because the header existed and could be made to
        // resemble a gallery card; nothing about the action needed it.
        if (showExpandButton) {
          sceneControlsEl!.appendChild(makeSep());
          btnExpand = makeBtn('expand', 'Expand (E)', onExpand ?? openExpandModal);
          sceneControlsEl!.appendChild(btnExpand);
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

      // Anchored to `mapBox`, not `canvasWrap` — canvasWrap shrinks to
      // share width with a docked summary panel (wrapWithSummaryPanel wraps
      // it in a flex row), and the Insights overlay covers the *full*
      chromeRowEl.appendChild(toolbar);
      syncChromeRowVisibility();

      // No hover show/hide. The bar used to sit at 0.35 opacity and fade in
      // when the pointer entered the canvas, with a 600ms linger so a click on
      // a fading bar still registered — all of which existed because the bar
      // was painted ON the wafer, where a permanently solid strip competes with
      // the data under it. In its own row it covers nothing, so the ghosting
      // bought nothing and cost plenty: controls that were hard to read, and a
      // toolbar whose existence was not apparent until the pointer happened to
      // cross the map. Deleted rather than pinned at opacity 1, so there is no
      // dormant timer or listener left to explain.
    }
  }

  // ── Expand modal ──────────────────────────────────────────────────────────
  let modalHandle: OverlayHandle | null = null;

  function openExpandModal(): void {
    if (modalHandle) { modalHandle.close(); modalHandle = null; }

    // Reparent `mapBox` — the whole view box, whichever view is showing.
    //
    // This used to reparent the canvas (or the canvas+panel wrapper) and the
    // toolbar as two separate roots, which is why Expand had to be hidden the
    // moment Insights opened: `insightsTab.el` is a sibling of canvasWrap
    // inside mapBox, so moving canvasWrap out took the map but left the chart
    // suite behind, and moving the suite instead left the modal blank as soon
    // as you switched back to the wafer view inside it. Neither half owned the
    // view. mapBox does: it already contains canvasWrap, the summary-panel
    // wrapper, the toolbar AND insightsTab.el, so moving it moves whatever is
    // currently showing and both views keep working inside the modal.
    //
    // It also removes the special-casing the old shape needed. mapBox is
    // already `position: relative`, so the toolbar's `position: absolute`
    // corner resolves against it exactly as it does outside the modal — no
    // `contentWrap.style.position` fix-up, and no pairing of two roots for the
    // shared helper's stale-reference guard to reason about.
    const reparentRoot: HTMLElement = mapBox;

    reparentRoot.style.flex      = '1';
    reparentRoot.style.minWidth  = '0';
    reparentRoot.style.minHeight = '0';
    // `maxSize` caps the map in the page; the modal is the deliberate escape
    // from that cap, and the cap lives on the very element now being moved (it
    // used to be left behind on mapBox, which is why expanding always opened
    // full size). Lifted here and restored on close.
    const cappedMaxWidth  = reparentRoot.style.maxWidth;
    const cappedMaxHeight = reparentRoot.style.maxHeight;
    reparentRoot.style.maxWidth  = 'none';
    reparentRoot.style.maxHeight = 'none';

    // toolbar lives in `mapBox` (a sibling of reparentRoot), not inside
    // reparentRoot itself, so openReparentedModal must move it in too —
    // otherwise it stays behind in the now-empty mapBox and the expanded view
    // has no toolbar at all. This also means expanding escapes any `maxSize`
    // cap entirely (the cap lives on mapBox, which the expanded content
    // physically leaves) — the modal always opens at full size. Reparented
    // alongside reparentRoot,
    // not as a separate call, so the shared helper's own stale-reference
    // guard sees both moves as one unit — see its own header comment in
    // toolbar.ts for why that matters (this pairing is exactly the case that
    // used to throw NotFoundError on close).
    //
    // The metadata header IS reparented, above mapBox. It used to be left
    // behind, on the grounds that the toolbar's absolute top-right corner
    // would collide with a header sharing its positioning context — but that
    // reasoning belonged to the old shape, where the toolbar was reparented as
    // its own root and resolved against `contentWrap`. It now travels inside
    // mapBox and resolves against mapBox, so a header sibling above it shares
    // no positioning context with it and cannot collide.
    //
    // Leaving it behind was in fact a bug, not just a missed nicety:
    // `metaPanel` is mounted inside canvasWrap, so it travelled into the modal
    // while its toggle stayed on the page under the backdrop. The control and
    // the panel it opens ended up in different places, which is why expanded
    // metadata was reachable in the map and Insights views but not in the
    // modal. Moving both keeps them together.
    //
    // ownerDocument is passed explicitly so the modal builds into the SAME
    // document as reparentRoot (e.g. a gallery card detached into its own
    // popup window) rather than silently building in whatever document
    // happened to be the bare global — that would move reparentRoot out of
    // the popup and pop the modal up on the wrong page.
    // The chrome row first, so it lands above mapBox in contentWrap exactly as
    // on the page — and as ONE root, since it now carries the identity and the
    // toolbar together. No `title`: the reparented row already states this
    // wafer's identity, and the modal's own title chrome would print the same
    // string a second line above it. The accessible name is set from the same
    // label below, so dropping the visible title costs nothing there.
    const identityLabel = collapsedLabel(wafer.metadata ?? {}, lotStackBadgeContext());
    const roots = chromeRowEl.childElementCount > 0
      ? [chromeRowEl, reparentRoot]
      : [reparentRoot];
    const handle = openReparentedModal(roots, {
      ownerDocument,
      // A wafer is circular, so the default 700px square is the right shape for
      // the map. The Insights suite is not: it lays out ~1330px wide in a normal
      // page, so opening it in that square made Expand produce a view SMALLER
      // than the one it expanded from — the charts reflowing into a narrower
      // column, which is the opposite of what the control promises. Sized wide
      // here instead, which is also the point of expanding the suite at all:
      // these charts interact, and reading them side by side is the case a
      // small frame cannot serve.
      boxSize: insightsOpen
        ? { width: 'min(96vw, 1600px)', height: 'min(92vh, 1000px)' }
        : undefined,
      onClosed: () => {
        modalHandle = null;
        reparentRoot.style.maxWidth  = cappedMaxWidth;
        reparentRoot.style.maxHeight = cappedMaxHeight;
        // Unconditional: Expand is valid in both views now that the modal can
        // carry the Insights suite, so restoring it must not depend on which
        // view happens to be showing when the modal closes.
        if (btnExpand) btnExpand.style.display = 'flex';
        // Only the canvas can take focus, and only when it is the visible
        // view — focusing it under an open Insights suite would scroll the
        // charts back to a map nobody is looking at.
        if (!insightsOpen) canvas.focus({ preventScroll: true });
        // Fit will recompute via ResizeObserver firing on reparent.
      } });
    if (!handle) return; // re-entrancy guard — shouldn't trip, modalHandle.close() above already cleared it

    // Names the dialog for assistive tech. Set here rather than via `title`
    // (which would also RENDER it) — `handle.box` is part of the returned
    // handle for exactly this kind of adjustment.
    handle.box.setAttribute('aria-label', identityLabel ?? 'Expanded wafer map');

    // contentWrap is a flex ROW by default, which is invisible while it holds a
    // single child and wrong the moment it holds two: the header has
    // `flexShrink: 0`, so as a row item it took its natural WIDTH and stretched
    // to full height — a 134px full-height column of identity text down the
    // left of the map, instead of a row above it. Column direction restores the
    // page's own stacking, header above map, with mapBox's `flex: 1` taking the
    // rest of the height.
    if (roots.length > 1) handle.contentWrap.style.flexDirection = 'column';

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
    if (partial.plotMode !== undefined && partial.plotMode !== prevMode) {
      // No fittedViewport invalidation here: a plot-mode change shifts the
      // auto-fit originX (colorbar vs bin-legend width), but so do half a dozen
      // other options, and render() now re-reads the fit on every fitted draw.
      // Nulling it here would also strand it null while zoomed.
      // No colour-scheme reset: bin and value colours are separate
      // preferences, so no mode can inherit a scheme it cannot draw.
    }
    // These only affect how the canvas is drawn, not what the scene contains, so
    // the scene rebuild can be skipped. markFailingDies qualifies because
    // ViewRect.binFail is set on every build regardless of the flag — the flag
    // only decides whether toCanvas draws the hatch.
    const onlyLegendStyle = Object.keys(partial).every(
      k => k === 'legendPosition' || k === 'showLegend' || k === 'markFailingDies');
    if (!onlyLegendStyle) rebuildView();
    syncLegendStyleBtnFn?.();
    syncPaletteBtnFn?.();
    syncLogScaleBtnFn?.();
    syncColorbarRangeBtnFn?.();
    render();
    const modeChanged = partial.plotMode !== undefined && partial.plotMode !== prevMode;
    const colorsChanged = COLOR_KEYS.some(k => k in partial);
    if (colorsChanged || modeChanged) { renderSummaryPanel(); renderAutoSummaryPanel(); }
    // logScale/colorbarRangeMode: buildMaplessSummary's histogram resolves
    // its own colour range the same way the map's colorbar does (see
    // resolveValueNormalize, maplessSummary.ts) — a change here needs the
    // same refresh as a colour-scheme or mode change, or the histogram's
    // bars silently keep whatever colours they had at the last refresh.
    if (colorsChanged || modeChanged || partial.activeTest !== undefined ||
        partial.logScale !== undefined || partial.colorbarRangeMode !== undefined) {
      refreshMaplessPanel?.();
    }
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
    const showLegend = viewOpts.showLegend ?? true;
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
      // No toolbar clearance: the toolbar no longer overlays the canvas, so the
      // wafer can use the full height. This reserved 24px at the top of every
      // map that showed a toolbar.
      topClearance:    0,
      minRightReserve: showLegend ? stableRight : 0,
      // toCanvas calls this showColorbar, but it gates the whole legend block
      // (colorbar, bin legend, spec legend) — see WaferViewOptions.showLegend.
      showColorbar:    showLegend && (drawOptions.showColorbar ?? true),
      markFailingDies: viewOpts.markFailingDies ?? false,
      legendPosition:  legendPos,
      legendOffset,
      diePitchMm,
      fallbackFormat: currentFallbackFormat,
      showAxes:  drawOptions.showAxes ?? (viewport !== null),
      viewport: vp,
      activeBin: viewOpts.plotMode === 'metadata' ? viewOpts.highlightMetadataValue : viewOpts.highlightBin,
      hoverBin: hoveredLegendBin,
      hbinDefs,
      sbinDefs,
      metadataFields });

    binLegendRows = result.binLegendRows;
    legendBoxRect = result.legendBox ?? null;

    // Track the auto-fit viewport on EVERY fitted draw, not just the first.
    // `fittedViewport` is the geometry drawSelectionOverlay, hit-testing and
    // hover all read back (`currentViewport()`), while the drawn map uses the
    // viewport toCanvas just computed. Those two must never diverge. The fit
    // origin/ppm depend on the colorbar/bin-legend reserve, legend position,
    // axis gutter and legend row count — none of which resize the canvas, so
    // the ResizeObserver cannot be relied on to invalidate this. Caching the
    // first fit forever meant any such change left the selection highlight and
    // the click target drawn tens of px away from the dies they belong to.
    // Only assign on a fitted draw: when `viewport` is set the map is zoomed
    // and `result.viewport` is that zoom, not a fit — writing it here would
    // clobber the zoom clamp's baseline (clampedPpm).
    if (viewport === null) fittedViewport = result.viewport;

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
        y: legendOffsetStart.y + (cssPy - legendDragStart.y) };
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
        snapDist };
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
    // Redraw only when the hovered ROW changes, never per mousemove: the whole
    // canvas is repainted, which on a large wafer is far too much work to do
    // for every pointer sample across a legend row.
    setHoveredLegendBin(legendRow ? legendRow.bin : undefined);
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
          tooltip.innerHTML = buildHoverText(die, currentView.plotMode, {
            testDefs,
            hbinDefs,
            sbinDefs,
            fallbackFormat: currentFallbackFormat,
            // Read aggregation context from the built View, not viewOpts: a
            // buildWaferMap({ lotStack }) result carries these on the result
            // (→ currentView.aggrMethod/lotSize), and the caller need not repeat
            // them in viewOptions. Using viewOpts here showed the wrong/missing
            // aggregation method on stacked-map tooltips.
            aggrMethod: currentView.aggrMethod,
            lotSize: currentView.lotSize,
            metadataFields,
            // Active test from the built View (authoritative, like plotMode above):
            // in value mode the tooltip leads with it; ignored in bin modes.
            activeTest: currentView.activeTest,
            reticleConfig });
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
              snapDist: vp.snapDist / actualScale };
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
            const key = getDieKey(d);
            if (selectedKeys.has(key)) selectedKeys.delete(key);
            else selectedKeys.add(key);
          }
        } else {
          selectedKeys = new Set(boxDies.map(d => getDieKey(d)));
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
      const key = getDieKey(die);
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
      if (d && selectedKeys.has(getDieKey(d))) result.push(d);
    }
    return result;
  }

  function onPointerLeave(): void {
    // Otherwise a legend row stays lit after the pointer has left the canvas —
    // the mousemove handler is the only other thing that clears it, and it
    // stops firing at the boundary.
    setHoveredLegendBin(undefined);
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
    if ((e.key === 'e' || e.key === 'E') && toolbarControls !== 'view-only' && showExpandButton) {
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
  refreshMaplessPanel?.();

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

  // Once, after every optional piece of chrome has had its chance to mount:
  // with neither a toolbar nor an identity, none of the call sites above ever
  // runs, and the row would keep its default `flex` — which is exactly the
  // empty-band case this is here to prevent.
  syncChromeRowVisibility();

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
      dataAxisFlip  = newResult.view?.dataAxisFlip;
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
      selectedKeys = new Set(dies.map(d => getDieKey(d)));
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

    setFindingsNotice(notice: FindingsNotice | undefined): void {
      currentFindingsNotice = notice;
      if (summaryPanelEl) renderSummaryPanel();
      else if (autoSummaryPanelEl) renderAutoSummaryPanel();
    },

    setStatsSummary(summary: StatsSummary | undefined): void {
      currentStatsSummary = summary;
      // Analysis raises its own advisories (e.g. the test-count cap), so a
      // summary arriving late can introduce warnings that were not present when
      // the toolbar was built. Rebuild it rather than leaving them unreachable.
      refreshWarnings();
      syncWarningButton();
      if (summaryPanelEl) {
        renderSummaryPanel();
      } else if (autoSummaryPanelEl) {
        renderAutoSummaryPanel();
      } else if (summary && !summaryPanelOpts?.placement) {
        // Late-mount: statsSummary provided after initial render with no placement option.
        const openOnMount = summaryPanelOpts?.defaultOpen ?? !showToolbar;
        autoSummaryPanelEl = createSummaryPanelEl('right', chromeInset, ownerDocument);
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

    setIdentityVisible(visible: boolean): void {
      identityHeaderHostHidden = !visible;
      // Not gated on `insightsOpen` any more: the identity stays visible in the
      // Insights view too (the chart suite no longer renders its own copy), so
      // this reflects the host's wish and nothing else.
      if (headerBar) headerBar.style.display = visible ? '' : 'none';
      syncChromeRowVisibility();
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
      // The view's resolved colours — the ones the dies are drawn in. This used
      // to hash the bin number itself, so a host building its own legend from
      // here named colours the map was not using.
      const colors = isHard ? currentView.binColors.hard : currentView.binColors.soft;
      return bins.map(bin => {
        const def = defs?.find(d => d.bin === bin);
        return { bin, name: def?.name ?? `Bin ${bin}`, color: colors.get(bin) ?? NO_DATA_FILL };
      });
    },

    destroy(): void {
      modalHandle?.close();
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
      outerFrame.remove();
    } };
}
