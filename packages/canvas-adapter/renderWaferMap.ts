import type { View, ViewOptions, PlotMode } from '../renderer/buildView.js';
import { buildView, buildHoverText, findTestDef, resolveTestNumber, getUniqueTestNumbers } from '../renderer/buildView.js';
import { listColorSchemes } from '../renderer/colorSchemes.js';
import type { Die } from '../core/dies.js';
import type { Reticle } from '../core/reticle.js';
import { toCanvas, BIN_LEGEND_W, BIN_LEGEND_W_COMPACT, BIN_LEGEND_ADAPT_COMPACT, BIN_LEGEND_ADAPT_FLOATING, type ToCanvasOptions, type ViewportTransform, type BinLegendRow } from './toCanvas.js';
import type { TestDef, BinDef, WaferMapResult } from '../renderer/buildWaferMap.js';
import type { StatsFinding, StatsSummary } from '../stats/types.js';
import { CLR, ROTATIONS, MODE_LABELS, createTooltip, positionTooltip, createToolbarHelpers, buildModeMenuEl, openModal, type ModeEntry } from './toolbar.js';
import type { SummaryPanelOptions } from './summaryPanel.js';
import {
  createSummaryPanelEl, wrapWithSummaryPanel, renderWaferSummaryContent,
} from './summaryPanel.js';
import { hardBinColor, softBinColor } from '../renderer/colorMap.js';

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
   * When true and `plotMode` is `'value'`, colours in-spec dies with a fixed pass colour
   * instead of the continuous gradient. Out-of-spec dies (blue/red) are unaffected.
   * Only meaningful when the active test has `limitLow` or `limitHigh` defined.
   * Toggled by the Overlays toolbar menu when the active test has limits.
   */
  colorBySpec?:  boolean;
  /**
   * Which test number to display in `value` plot mode. Default `0`.
   * Controlled by the mode dropdown when the result has testDefs.
   */
  activeTest?:   number;
  highlightBin?: number;
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
  /**
   * When provided, renders a persistent summary panel alongside the canvas.
   * The panel shows metadata, yield, bins, rings, quadrants, test values, and findings.
   * The toolbar findings button is hidden when this option is active.
   */
  summaryPanel?: SummaryPanelOptions;
  /**
   * Custom tooltip renderer. When provided, replaces the built-in tooltip content.
   * Return a string (set as innerHTML), an HTMLElement (appended directly), or null to suppress the tooltip.
   * The built-in tooltip wrapper (positioning, show/hide behaviour) is preserved.
   */
  renderTooltip?: (die: Die) => string | HTMLElement | null;
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
  /** Replace the current stats summary used by the built-in findings panel. */
  setStatsSummary(summary: StatsSummary | undefined): void;
  /** Show or hide the findings toolbar button without affecting the summary. */
  setFindingsVisible(visible: boolean): void;
  /** Show or hide the scene-control toolbar buttons (mode, orientation, etc). */
  setViewControlsVisible(visible: boolean): void;
  /** Show or hide the expand toolbar button. */
  setExpandVisible(visible: boolean): void;
  /** Move the floating tooltip into a different parent (e.g. a fullscreen element). */
  setTooltipParent(parent: HTMLElement): void;
  /**
   * Returns the current bin legend entries in `hardBin`/`softBin` modes, `null` in other modes.
   * Each entry includes the bin number, display name, and color.
   */
  getActiveLegend(): Array<{ bin: number; name: string; color: string }> | null;
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
  if (getComputedStyle(container).position === 'static') container.style.position = 'relative';
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
    toolbarControls      = 'full',
    showPlotModeSelector = true,
    minZoom              = 0.4,
    maxZoom              = 20,
    summaryPanel:        summaryPanelOpts,
    renderTooltip,
    passBins             = [1],
    viewOptions: initialViewOptions = {},
    ...drawOptions
  } = options;

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
  let reticles: Reticle[]   | undefined = result.reticles?.length ? result.reticles : undefined;
  let dataAxisFlip: { x: boolean; y: boolean } | undefined = result.view?.axisFlip;

  let viewOpts: WaferViewOptions = {
    plotMode:               'hardBin',
    colorScheme:            'default',
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
  // 'pan'    — drag pans; scroll wheel is disabled (prevents accidental zoom)
  // 'zoom'   — drag draws a zoom-box; scroll wheel zooms
  // 'select' — drag draws a selection box (only available when onSelect provided)
  let interactMode: 'pan' | 'zoom' | 'select' = 'pan';
  let panStart        = { x: 0, y: 0 };
  let panOrigin       = { x: 0, y: 0 };
  let boxStart        = { x: 0, y: 0 };
  let boxEnd          = { x: 0, y: 0 };

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
      activeTest:              so.activeTest,
      testDefs,
      valueRange:             so.valueRange,
      logScale:               so.logScale,
      aggregationMethod:      so.aggregationMethod,
      lotSize:                so.lotSize,
      dataAxisFlip,
      colorbarRangeMode:      so.colorbarRangeMode,
      colorBySpec:            so.colorBySpec,
      fallbackFormat:         currentFallbackFormat,
      interactiveTransform: {
        rotation: so.rotation ?? 0,
        flipX:    so.flipX   ?? false,
        flipY:    so.flipY   ?? false,
      },
    } satisfies ViewOptions, { hbinDefs, sbinDefs });
    dieKeyIndex = new Map(currentView.dies.map((d, i) => [`${d.x},${d.y}`, i]));
  }

  rebuildView();

  // ── Summary panel ──────────────────────────────────────────────────────────
  let summaryPanelEl: HTMLDivElement | null = null;
  let summaryPanelWrapper: HTMLDivElement | null = null;
  let summaryActiveFindingId: string | null = null;
  // Auto-mounted panel: created when statsSummary is provided but no explicit summaryPanel option.
  let autoSummaryPanelEl: HTMLDivElement | null = null;
  let autoSummaryPanelWrapper: HTMLDivElement | null = null;

  function renderSummaryPanelInto(el: HTMLDivElement, rerender: () => void): void {
    renderWaferSummaryContent(el, {
      wafer,
      dies:         currentDies,
      yieldSummary: currentResult.yield,
      dataCoverage: currentResult.dataCoverage,
      hbinDefs,
      sbinDefs,
      testDefs,
      statsSummary:    currentStatsSummary,
      passBins,
      ringCount:       viewOpts.ringCount ?? 4,
      fallbackFormat:  currentFallbackFormat,
      activeFindingId: summaryActiveFindingId,
      onFindingClick: (finding, _row) => {
        if (summaryActiveFindingId === finding.id) {
          summaryActiveFindingId = null;
          selectionFromKeys([]);
          applyOpts({ highlightBin: undefined });
        } else {
          summaryActiveFindingId = finding.id;
          applyFindingHighlightFromPanel(finding);
        }
        rerender();
      },
    });
  }

  function renderSummaryPanel(): void {
    if (summaryPanelEl) renderSummaryPanelInto(summaryPanelEl, renderSummaryPanel);
  }

  function renderAutoSummaryPanel(): void {
    if (autoSummaryPanelEl) renderSummaryPanelInto(autoSummaryPanelEl, renderAutoSummaryPanel);
  }


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

  // Extra top clearance beyond the canvas padding (16px) needed to clear the
  // toolbar: toolbar sits at top:4px, is ~32px tall → bottom at ~36px.
  // Excess over padding: 36 - 16 = 20px, rounded up to 24px for a small gap.
  const TOOLBAR_CLEARANCE = 24;

  if (summaryPanelOpts?.placement) {
    const placement = summaryPanelOpts.placement;
    const clearance = showToolbar ? TOOLBAR_CLEARANCE : 0;
    summaryPanelEl = createSummaryPanelEl(placement, clearance);
    const parent = canvasWrap.parentElement;
    const next = canvasWrap.nextSibling;
    summaryPanelWrapper = wrapWithSummaryPanel(canvasWrap, summaryPanelEl, placement);
    parent?.insertBefore(summaryPanelWrapper, next);
    renderSummaryPanel();
  }

  // ── Tooltip ────────────────────────────────────────────────────────────────
  let tooltip: HTMLDivElement | null = null;
  if (showTooltip) {
    tooltip = createTooltip();
  }

  // ── Toolbar ────────────────────────────────────────────────────────────────
  let toolbar:          HTMLDivElement    | null = null;
  let sceneControlsEl:  HTMLDivElement    | null = null;
  let btnBoxSelect:     HTMLButtonElement | null = null;
  let btnFindings:      HTMLButtonElement | null = null;
  let btnExpand:        HTMLButtonElement | null = null;
  let hideTimer: ReturnType<typeof setTimeout> | null = null;

  // Set when toolbar is created — used by destroy() regardless of showToolbar.
  let tbCloseOpenMenu: ((e: MouseEvent) => void) | null = null;
  let tbGetOpenMenu:   (() => HTMLDivElement | null) | null = null;
  // Called after every option change to keep the legend style button in sync.
  let syncLegendStyleBtnFn: (() => void) | null = null;
  // Called after every option change to keep the log scale button in sync.
  let syncLogScaleBtnFn: (() => void) | null = null;
  // Called after every option change to keep the colorbar range mode button in sync.
  let syncColorbarRangeBtnFn: (() => void) | null = null;

  function selectionFromKeys(keys: string[] | undefined): void {
    selectedKeys = new Set(keys ?? []);
    if (onSelect) onSelect(selectionAsDies());
    render();
  }

  function refreshFindingsButton(): void {
    if (!btnFindings) return;
    const hasSummary = !!(summaryPanelEl ?? autoSummaryPanelEl);
    btnFindings.style.display = (currentStatsSummary && hasSummary) ? 'flex' : 'none';
    const panelOpen = autoSummaryPanelEl
      ? autoSummaryPanelEl.style.display !== 'none'
      : false;
    if (currentStatsSummary?.hasNotableFindings && !panelOpen) {
      btnFindings.style.color = '#b7551a';
    } else if (!btnFindings.dataset.active) {
      btnFindings.style.color = CLR.icon;
    }
  }

  if (showToolbar) {
    const parent = canvasWrap;
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
        background:    '#fff',
        border:        `1px solid ${CLR.menuBorder}`,
        borderRadius:  '4px',
        boxShadow:     '0 1px 4px rgba(0,0,0,0.12)',
        zIndex:        '1001',
        opacity:       '0.35',
        transition:    'opacity 0.2s ease',
        pointerEvents: 'auto',
      });

      // ── Toolbar helpers ──────────────────────────────────────────────────
      // Use shared tooltip if available, otherwise create one for the toolbar.
      const tbTooltip = tooltip ?? createTooltip();
      const { makeBtn, setActive, makeSep, makeMenuRow, makeMenuSection, makeDropdown, makeCheckMenuBtn, closeOpenMenu, getOpenMenu, setOpenMenu } = createToolbarHelpers(tbTooltip);
      tbCloseOpenMenu = closeOpenMenu;
      tbGetOpenMenu   = getOpenMenu;
      // Single persistent listener — closes any open dropdown on outside click.
      document.addEventListener('click', closeOpenMenu, true);

      // ── Wire up toolbar buttons ──────────────────────────────────────────

      // Interaction mode: zoom-region | pan | select — mutually exclusive
      function setInteractMode(mode: 'pan' | 'zoom' | 'select'): void {
        interactMode = mode;
        setActive(btnZoomMode, mode === 'zoom');
        setActive(btnPanMode,  mode === 'pan');
        if (btnBoxSelect) setActive(btnBoxSelect, mode === 'select');
        canvas.style.cursor = mode === 'pan' ? 'grab' : 'crosshair';
      }

      // Camera first — leftmost
      const btnDownload = makeBtn('download', 'Download PNG', downloadPng);
      toolbar.appendChild(btnDownload);
      toolbar.appendChild(makeSep());

      // Zoom group: zoom-region mode + zoom in/out + reset
      const btnZoomMode = makeBtn('zoomMode', 'Zoom (drag to zoom region)', () => setInteractMode('zoom'));
      const btnZoomIn   = makeBtn('zoomIn',   'Zoom in',                    () => zoomAt(canvas.clientWidth / 2, canvas.clientHeight / 2, 1.20));
      const btnZoomOut  = makeBtn('zoomOut',  'Zoom out',                   () => zoomAt(canvas.clientWidth / 2, canvas.clientHeight / 2, 1 / 1.20));
      const btnReset    = makeBtn('reset',    'Reset zoom (double-click)',   () => resetZoom());
      toolbar.appendChild(btnZoomMode);
      toolbar.appendChild(btnZoomIn);
      toolbar.appendChild(btnZoomOut);
      toolbar.appendChild(btnReset);
      toolbar.appendChild(makeSep());

      // Interaction mode group: pan | box-select
      const btnPanMode = makeBtn('pan', 'Pan (drag to move)', () => setInteractMode('pan'));
      toolbar.appendChild(btnPanMode);
      btnBoxSelect = makeBtn('boxSelect', 'Select (drag to select dies)', () => setInteractMode('select'));
      toolbar.appendChild(btnBoxSelect);

      // Set initial active state — pan is default
      setActive(btnPanMode, true);

      // View controls — hidden in 'view-only' mode (gallery bar owns them).
      // Wrapped in sceneControlsEl so setViewControlsVisible() can hide/show the
      // whole group at once (used when reparenting a card into the expand modal).
      if (toolbarControls !== 'view-only') {
        sceneControlsEl = document.createElement('div');
        Object.assign(sceneControlsEl.style, { display: 'flex', alignItems: 'center', gap: '0' });
        toolbar.appendChild(sceneControlsEl);
        sceneControlsEl.appendChild(makeSep());

        // Mode dropdown: when testDefs are defined, show one entry per named test
        // plus the bin modes. Selecting a named test sets plotMode:'value' + activeTest.
        // Selecting a bin mode sets plotMode to that mode and clears activeTest.
        function isCurrentEntry(e: ModeEntry): boolean {
          if (e.plotMode !== (viewOpts.plotMode ?? 'hardBin')) return false;
          if (e.plotMode === 'value') return (viewOpts.activeTest ?? 0) === (e.activeTest ?? 0);
          return true;
        }

        function pickEntry(entry: ModeEntry, menu: HTMLElement): void {
          if (entry.activeTest !== undefined) {
            // Apply test's logScale default when switching tests.
            applyOpts({ plotMode: entry.plotMode, activeTest: entry.activeTest, logScale: entry.logScale });
          } else {
            // Switching to a bin/stacked mode — clear colorBySpec (only valid in value mode).
            applyOpts({ plotMode: entry.plotMode, activeTest: undefined, colorBySpec: false });
          }
          menu.remove();
          setOpenMenu(null);
        }

        const btnMode = makeBtn('mode', 'Plot mode', () => {
          const openMenu = getOpenMenu();
          if (openMenu) { openMenu.remove(); setOpenMenu(null); return; }

          // Only include modes for which data is actually present.
          const dies     = currentView.dies;
          const testDefs = currentView.testDefs;
          const hasValues = dies.some(d =>
            (d.testValues !== undefined && Object.keys(d.testValues).length > 0) ||
            (d.values?.length ?? 0) > 0
          );
          const hasHbin = dies.some(d => d.hbin != null);
          const hasSbin = dies.some(d => d.sbin != null);

          const testEntries: ModeEntry[] = hasValues
            ? (testDefs?.length
                ? testDefs.map(t => ({
                    plotMode: 'value' as PlotMode,
                    activeTest: t.index ?? t.testNumber ?? 0,
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
          );
          document.body.appendChild(menu);
          setOpenMenu(menu);
        });
        const btnPalette = makeDropdown(
          'palette', 'Colour scheme',
          () => listColorSchemes().map(s => ({ value: s.name, label: s.label })),
          () => viewOpts.colorScheme ?? 'default',
          v => applyOpts({ colorScheme: v }),
        );
        const btnOverlays = makeCheckMenuBtn(
          'overlays', 'Overlays',
          () => {
            const hasReticleNow = !!currentView!.hasReticle;
            const isValueMode   = (viewOpts.plotMode ?? 'hardBin') === 'value';
            const { testNumber: resolvedTest } = resolveTestNumber(viewOpts.activeTest ?? 0, currentView.testDefs);
            const activeTestDef = findTestDef(currentView.testDefs, resolvedTest);
            const hasLimits     = isValueMode && (activeTestDef?.limitLow !== undefined || activeTestDef?.limitHigh !== undefined);
            return [
              { label: 'Ring boundaries', active: !!viewOpts.showRingBoundaries,     onClick: () => applyOpts({ showRingBoundaries:   !viewOpts.showRingBoundaries   }) },
              { label: 'Quadrant lines',  active: !!viewOpts.showQuadrantBoundaries, onClick: () => applyOpts({ showQuadrantBoundaries: !viewOpts.showQuadrantBoundaries }) },
              { label: 'Die labels',      active: !!viewOpts.showDieLabels,               onClick: () => applyOpts({ showDieLabels:              !viewOpts.showDieLabels              }) },
              { label: 'Reticle grid',    active: !!viewOpts.showReticle,            enabled: hasReticleNow, onClick: () => applyOpts({ showReticle: !viewOpts.showReticle }) },
              { label: 'XY indicator',    active: !!viewOpts.showXYIndicator,        onClick: () => applyOpts({ showXYIndicator:      !viewOpts.showXYIndicator      }) },
              { label: 'Spec pass/fail',  active: !!viewOpts.colorBySpec,            enabled: hasLimits,    onClick: () => applyOpts({ colorBySpec: !viewOpts.colorBySpec }) },
            ];
          },
          (btn) => {
            const anyOn = !!(viewOpts.showRingBoundaries || viewOpts.showQuadrantBoundaries ||
                             viewOpts.showDieLabels || viewOpts.showReticle || viewOpts.showXYIndicator);
            setActive(btn, anyOn);
          },
        );
        const btnLegendStyle = makeDropdown(
          'legend', 'Legend style',
          () => [
            { value: 'default'  as const, label: 'Default (right)' },
            { value: 'compact'  as const, label: 'Compact (right)' },
            { value: 'left'     as const, label: 'Left' },
            { value: 'top'      as const, label: 'Top' },
            { value: 'bottom'   as const, label: 'Bottom' },
            { value: 'floating' as const, label: 'Floating' },
          ],
          () => viewOpts.legendPosition ?? 'default',
          (v) => applyOpts({ legendPosition: v }),
        );
        syncLegendStyleBtnFn = () => {
          const isBinMode = viewOpts.plotMode === 'hardBin' || viewOpts.plotMode === 'softBin';
          btnLegendStyle.style.display = isBinMode ? '' : 'none';
        };
        syncLegendStyleBtnFn();

        const btnLogScale = makeBtn('logScale', 'Toggle log scale', () => {
          applyOpts({ logScale: !viewOpts.logScale });
        });
        syncLogScaleBtnFn = () => {
          const isValueMode = viewOpts.plotMode === 'value' || viewOpts.plotMode === 'stackedValues';
          btnLogScale.style.display = isValueMode ? '' : 'none';
          setActive(btnLogScale, !!viewOpts.logScale);
        };
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
          const visible = viewOpts.plotMode === 'value' && activeTestDefHasLimits() && !viewOpts.colorBySpec;
          btnColorbarRange.style.display = visible ? '' : 'none';
          const isSpec = (viewOpts.colorbarRangeMode ?? 'spec') === 'spec';
          setActive(btnColorbarRange, isSpec);
          btnColorbarRange.ariaLabel = isSpec
            ? 'Colorbar range: spec limits (click for data range)'
            : 'Colorbar range: data range (click for spec limits)';
        };
        syncColorbarRangeBtnFn();

        const btnOrient = makeCheckMenuBtn(
          'orient', 'Orientation',
          () => [
            { section: 'Rotate' },
            { label: 'Rotate 90° clockwise', active: false, onClick: () => { const r = viewOpts.rotation ?? 0; applyOpts({ rotation: ROTATIONS[(ROTATIONS.indexOf(r) + 3) % 4] }); } },
            { section: 'Flip' },
            { label: 'Flip horizontal', active: !!viewOpts.flipX, onClick: () => applyOpts({ flipX: !viewOpts.flipX }) },
            { label: 'Flip vertical',   active: !!viewOpts.flipY, onClick: () => applyOpts({ flipY: !viewOpts.flipY }) },
          ],
          (btn) => {
            const nonDefault = !!(viewOpts.rotation || viewOpts.flipX || viewOpts.flipY);
            setActive(btn, nonDefault);
          },
        );
        if (showPlotModeSelector) sceneControlsEl!.appendChild(btnMode);
        sceneControlsEl!.appendChild(btnPalette);
        sceneControlsEl!.appendChild(btnLogScale);
        sceneControlsEl!.appendChild(btnColorbarRange);
        sceneControlsEl!.appendChild(makeSep());
        sceneControlsEl!.appendChild(btnOverlays);
        sceneControlsEl!.appendChild(makeSep());
        sceneControlsEl!.appendChild(btnLegendStyle);
        sceneControlsEl!.appendChild(makeSep());
        sceneControlsEl!.appendChild(btnOrient);

        // Findings button — toggles the summary panel.
        // Auto-mount when statsSummary is provided without an explicit placement (persistent panel).
        // defaultOpen: true starts the panel visible; otherwise hidden until the user clicks.
        const autoMount = currentStatsSummary && !summaryPanelOpts?.placement;
        if (autoMount) {
          const clearance = TOOLBAR_CLEARANCE;
          const openOnMount = !!summaryPanelOpts?.defaultOpen;
          autoSummaryPanelEl = createSummaryPanelEl('right', clearance);
          autoSummaryPanelEl.style.display = openOnMount ? 'block' : 'none';
          const parent = canvasWrap.parentElement;
          const next = canvasWrap.nextSibling;
          autoSummaryPanelWrapper = wrapWithSummaryPanel(canvasWrap, autoSummaryPanelEl, 'right');
          parent?.insertBefore(autoSummaryPanelWrapper, next);
          renderAutoSummaryPanel();
        }
        if (currentStatsSummary) {
          btnFindings = makeBtn('findings', 'Summary panel', () => {
            const panelEl = summaryPanelEl ?? autoSummaryPanelEl;
            if (!panelEl) return;
            const isOpen = panelEl.style.display !== 'none';
            panelEl.style.display = isOpen ? 'none' : 'block';
            setActive(btnFindings!, !isOpen);
            refreshFindingsButton();
          });
          sceneControlsEl!.appendChild(makeSep());
          sceneControlsEl!.appendChild(btnFindings);
          // Set button active state to match initial panel visibility
          if (autoSummaryPanelEl?.style.display !== 'none') setActive(btnFindings, true);
          refreshFindingsButton();
        }

        // Expand button — reparents canvas into a modal for a larger view.
        sceneControlsEl!.appendChild(makeSep());
        btnExpand = makeBtn('expand', 'Expand (E)', openExpandModal);
        sceneControlsEl!.appendChild(btnExpand);
      }

      canvasWrap.appendChild(toolbar);

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
  let modalHandle: ReturnType<typeof openModal> | null = null;
  // The element that was reparented into the modal and must be returned on close.
  let modalReparentedEl: HTMLElement | null = null;
  let modalOriginalParent: HTMLElement | null = null;
  let modalOriginalNext: ChildNode | null = null;

  function openExpandModal(): void {
    if (modalHandle) { modalHandle.close(); modalHandle = null; }

    // Determine what to reparent. If a summary-panel wrapper exists, reparent the
    // whole wrapper (canvas + panel side-by-side). Otherwise reparent just canvasWrap.
    const reparentRoot: HTMLElement =
      summaryPanelWrapper ?? autoSummaryPanelWrapper ?? canvasWrap;

    modalReparentedEl   = reparentRoot;
    modalOriginalParent = reparentRoot.parentElement as HTMLElement;
    modalOriginalNext   = reparentRoot.nextSibling;

    const handle = openModal({
      onFullscreenChange: (isFs, box) => {
        if (tooltip) {
          if (isFs) box.appendChild(tooltip);
          else document.body.appendChild(tooltip);
        }
      },
      onClose: () => {
        if (modalReparentedEl && modalOriginalParent) {
          modalOriginalParent.insertBefore(modalReparentedEl, modalOriginalNext);
          modalReparentedEl   = null;
          modalOriginalParent = null;
          modalOriginalNext   = null;
        }
        modalHandle = null;
        if (btnExpand) btnExpand.style.display = 'flex';
        // Fit will recompute via ResizeObserver firing on reparent.
      },
    });

    reparentRoot.style.flex      = '1';
    reparentRoot.style.minWidth  = '0';
    reparentRoot.style.minHeight = '0';
    handle.contentWrap.appendChild(reparentRoot);

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
    }
    // legendPosition only affects canvas layout — skip the scene rebuild.
    const onlyLegendStyle = Object.keys(partial).every(k => k === 'legendPosition');
    if (!onlyLegendStyle) rebuildView();
    syncLegendStyleBtnFn?.();
    syncLogScaleBtnFn?.();
    syncColorbarRangeBtnFn?.();
    render();
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
    requestAnimationFrame(() => { rafPending = false; render(); });
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
      activeBin: viewOpts.highlightBin,
      hbinDefs,
      sbinDefs,
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

    // Amber tint — one batched fill pass.
    ctx.fillStyle = 'rgba(255,210,0,0.18)';
    ctx.beginPath();
    for (const { sx, sy } of selRects) ctx.rect(sx - hw, sy - hh, hw * 2, hh * 2);
    ctx.fill();

    // White halo — one batched stroke pass.
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth   = 3;
    ctx.beginPath();
    for (const { sx, sy } of selRects) ctx.rect(sx - hw, sy - hh, hw * 2, hh * 2);
    ctx.stroke();

    // Amber inner stroke — one batched stroke pass.
    ctx.strokeStyle = 'rgba(245,185,0,1)';
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
    ctx.strokeStyle = 'rgba(30,100,200,0.85)';
    ctx.lineWidth   = 1.5;
    ctx.setLineDash([5, 3]);
    ctx.strokeRect(x, y, w, h);
    ctx.fillStyle = 'rgba(30,100,200,0.08)';
    ctx.fillRect(x, y, w, h);
    ctx.restore();
  }

  // ── Download PNG ───────────────────────────────────────────────────────────
  function downloadPng(): void {
    canvas.toBlob(blob => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a   = document.createElement('a');
      a.href = url; a.download = 'wafermap.png'; a.click();
      URL.revokeObjectURL(url);
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
    // Scroll-wheel zoom only active in zoom mode — prevents accidental zoom while panning.
    if (interactMode !== 'zoom') return;
    e.preventDefault();
    const rect   = canvas.getBoundingClientRect();
    const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
    zoomAt(e.clientX - rect.left, e.clientY - rect.top, factor);
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
        positionTooltip(tooltip, e.clientX, e.clientY);
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
            positionTooltip(tooltip, e.clientX, e.clientY);
          }
        } else {
          tooltip.innerHTML = buildHoverText(
            die,
            viewOpts.plotMode ?? 'value',
            testDefs,
            hbinDefs,
            sbinDefs,
            currentFallbackFormat,
            viewOpts.aggregationMethod,
            viewOpts.lotSize,
          );
          tooltip.style.display = 'block';
          positionTooltip(tooltip, e.clientX, e.clientY);
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
    canvas.style.cursor = interactMode === 'pan' ? 'grab' : 'crosshair';
    const dx = cssPx - panStart.x;
    const dy = cssPy - panStart.y;
    if (dx * dx + dy * dy < 25) {
      handleClick(cssPx, cssPy, multi, e);
    }
  }

  function handleClick(cssPx: number, cssPy: number, multi: boolean, e: PointerEvent): void {
    // Check bin legend hit first — legend rows take priority over die clicks.
    for (const row of binLegendRows) {
      if (cssPx >= row.x && cssPx < row.x + row.w && cssPy >= row.y && cssPy < row.y + row.h) {
        const next = viewOpts.highlightBin === row.bin ? undefined : row.bin;
        applyOpts({ highlightBin: next });
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
    if (tooltip) tooltip.style.display = 'none';
    onHover?.(null, new MouseEvent('mouseleave'));
    canvas.style.cursor = interactMode === 'pan' ? 'grab' : 'crosshair';
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
  const resizeObserver = new ResizeObserver(() => {
    fittedViewport = null;
    viewport = null;
    render();
  });
  resizeObserver.observe(canvas);

  // ── DPR change listener (browser zoom / display change) ────────────────────
  // ResizeObserver does not fire when devicePixelRatio changes without a layout
  // size change. Re-register on each change to catch successive zoom steps.
  let dprMediaQuery = matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
  const onDprChange = () => {
    dprMediaQuery.removeEventListener('change', onDprChange);
    dprMediaQuery = matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
    dprMediaQuery.addEventListener('change', onDprChange);
    render();
  };
  dprMediaQuery.addEventListener('change', onDprChange);

  // ── Wire canvas events ─────────────────────────────────────────────────────
  function onKeyDown(e: KeyboardEvent): void {
    if (e.key === 'Escape' && selectedKeys.size > 0) {
      selectedKeys = new Set();
      onSelect?.([]);
      render();
    }
    if ((e.key === 'e' || e.key === 'E') && toolbarControls !== 'view-only') {
      openExpandModal();
    }
  }

  canvas.style.cursor = 'grab';
  canvas.setAttribute('tabindex', '0'); // make canvas focusable for key events
  canvas.addEventListener('wheel',        onWheel,       { passive: false });
  canvas.addEventListener('pointerdown',  onPointerDown);
  canvas.addEventListener('pointermove',  onPointerMove);
  canvas.addEventListener('pointerup',    onPointerUp);
  canvas.addEventListener('pointerleave', onPointerLeave);
  const onDblClick = () => resetZoom();
  canvas.addEventListener('dblclick',     onDblClick);
  canvas.addEventListener('keydown',      onKeyDown);
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
      reticles      = newResult.reticles?.length ? newResult.reticles : undefined;
      dataAxisFlip  = newResult.view?.axisFlip;
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
      }
      refreshFindingsButton();
    },

    setFindingsVisible(visible: boolean): void {
      if (btnFindings) btnFindings.style.display = visible ? 'flex' : 'none';
    },

    setViewControlsVisible(visible: boolean): void {
      if (sceneControlsEl) sceneControlsEl.style.display = visible ? 'flex' : 'none';
    },

    setExpandVisible(visible: boolean): void {
      if (btnExpand) btnExpand.style.display = visible ? 'flex' : 'none';
    },

    setTooltipParent(parent: HTMLElement): void {
      if (tooltip) parent.appendChild(tooltip);
    },

    getActiveLegend(): Array<{ bin: number; name: string; color: string }> | null {
      const mode = viewOpts.plotMode;
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
      if (tbCloseOpenMenu) document.removeEventListener('click', tbCloseOpenMenu, true);

      canvas.removeEventListener('wheel',        onWheel);
      canvas.removeEventListener('pointerdown',  onPointerDown);
      canvas.removeEventListener('pointermove',  onPointerMove);
      canvas.removeEventListener('pointerup',    onPointerUp);
      canvas.removeEventListener('pointerleave', onPointerLeave);
      canvas.removeEventListener('dblclick',     onDblClick);
      canvas.removeEventListener('keydown',      onKeyDown);
      canvas.removeEventListener('click',        onCanvasClick);
      resizeObserver.disconnect();
      dprMediaQuery.removeEventListener('change', onDprChange);
      tooltip?.remove();
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
    },
  };
}
