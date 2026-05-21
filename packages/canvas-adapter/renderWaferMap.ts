import type { Scene, SceneOptions, PlotMode } from '../renderer/buildScene.js';
import { buildScene } from '../renderer/buildScene.js';
import { listColorSchemes } from '../renderer/colorSchemes.js';
import type { Wafer } from '../core/wafer.js';
import type { Die } from '../core/dies.js';
import type { Reticle } from '../core/reticle.js';
import { toCanvas, BIN_LEGEND_W, BIN_LEGEND_W_COMPACT, BIN_LEGEND_ADAPT_COMPACT, BIN_LEGEND_ADAPT_FLOATING, type ToCanvasOptions, type ViewportTransform, type BinLegendRow } from './toCanvas.js';
import type { TestDef, BinDef } from '../renderer/buildWaferMap.js';
import type { StatsFinding, StatsSummary } from '../stats/types.js';
import { CLR, ROTATIONS, MODE_LABELS, createTooltip, createToolbarHelpers, buildModeMenuEl, type ModeEntry } from './toolbar.js';
import type { SummaryPanelOptions } from './summaryPanel.js';
import {
  createSummaryPanelEl, wrapWithSummaryPanel, renderWaferSummaryContent,
} from './summaryPanel.js';
import { hardBinColor, softBinColor } from '../renderer/colorMap.js';

// ── Public types ───────────────────────────────────────────────────────────────

/**
 * All scene-level options that the toolbar can control.
 * These map directly to SceneOptions — toolbar state IS the scene config.
 */
export interface WaferSceneOptions {
  plotMode?:               PlotMode;
  colorScheme?:            string;
  showText?:               boolean;
  showRingBoundaries?:     boolean;
  showQuadrantBoundaries?: boolean;
  showReticle?:            boolean;
  showXYIndicator?:        boolean;
  /** Reticle geometry to overlay — pass `result.reticles` from `buildWaferMap`. */
  reticles?:               Reticle[];
  ringCount?:              number;
  highlightBin?:           number;
  /** Interactive rotation in degrees (0 | 90 | 180 | 270). */
  rotation?:               0 | 90 | 180 | 270;
  flipX?:                  boolean;
  flipY?:                  boolean;
  /**
   * Which `values[]` index to display in `value` plot mode. Default `0`.
   * Controlled by the mode dropdown when `testDefs` are defined.
   */
  activeTest?:              number;
  /** Named test definitions — one per `values[]` entry. Shown in mode dropdown and tooltip. */
  testDefs?:               TestDef[];
  /** Named hard bin definitions — one per distinct `die.hbin` value. Independent number space from soft bins. */
  hbinDefs?:               BinDef[];
  /** Named soft bin definitions — one per distinct `die.sbin` value. Independent number space from hard bins. */
  sbinDefs?:               BinDef[];
  /**
   * Explicit [min, max] for value colour normalization. When omitted the range
   * is auto-computed from the die values present in the scene.
   */
  valueRange?:             [number, number];
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
   * Aggregation method for `stackedValues` mode.
   * Drives both the per-die aggregation and the hover tooltip label.
   * Accepted values: `'mean'` | `'median'` | `'stddev'` | `'min'` | `'max'` | `'count'`.
   * Defaults to `'mean'` when not set.
   */
  aggrMethod?:             string;
  /**
   * Total number of wafers in the lot — used to compute bin occurrence percentage
   * in `stackedBins` hover tooltips.
   */
  lotSize?:                number;
  /**
   * Axis flip baked in by the data pipeline (LL/LR/UL/UR origins or explicit
   * `xAxisDirection`/`yAxisDirection`). Passed through to axis tick label computation.
   */
  dataAxisFlip?:           { x: boolean; y: boolean };
  /** Legend position for bin modes. Default 'default'. */
  legendPosition?:         'default' | 'compact' | 'bottom' | 'top' | 'left' | 'floating';
}

export interface MountOptions extends Omit<ToCanvasOptions, 'viewport'> {
  /** Initial scene display options. All are overridable via the toolbar. */
  sceneOptions?: WaferSceneOptions;
  /** Called when the user hovers over a die. Null when leaving a die. */
  onHover?: (die: Die | null, event: MouseEvent) => void;
  /** Called when the user clicks a die. */
  onClick?: (die: Die, event: MouseEvent) => void;
  /** Called when the user completes a box-select. */
  onSelect?: (dies: Die[]) => void;
  /** Called whenever the toolbar changes a scene option. */
  onSceneOptionsChange?: (opts: WaferSceneOptions) => void;
  /** Show built-in floating tooltip on hover. Default true. */
  showTooltip?: boolean;
  /** Show the built-in toolbar. Default true. */
  showToolbar?: boolean;
  /** Optional precomputed wafer-level stats summary. Enables the summary panel toggle button in the toolbar. */
  statsSummary?: StatsSummary;
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
  /** Minimum zoom relative to fit. Default 0.5. */
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
   * Precomputed WaferMapResult — used by the summary panel to display yield and
   * coverage data. When omitted, only stats-derived sections are shown.
   */
  waferResult?: {
    yield:        import('../renderer/buildWaferMap.js').YieldSummary;
    dataCoverage: { filledDies: number; totalDies: number; edgeExcludedDies: number; ratio: number };
  };
  /**
   * Custom tooltip renderer. When provided, replaces the built-in tooltip content.
   * Return a string (set as innerHTML), an HTMLElement (appended directly), or null to suppress the tooltip.
   * The built-in tooltip wrapper (positioning, show/hide behaviour) is preserved.
   */
  renderTooltip?: (die: Die) => string | HTMLElement | null;
}

export interface WaferCanvasController {
  /** Update the die data (e.g. after a data reload) — rebuilds scene, preserves zoom/pan. */
  setDies(dies: Die[]): void;
  /** Merge scene option overrides — rebuilds scene, preserves zoom/pan. */
  setOptions(opts: Partial<WaferSceneOptions>): void;
  /** Return current scene options snapshot. */
  getOptions(): WaferSceneOptions;
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
  /**
   * Returns the current bin legend entries in `hardBin`/`softBin` modes, `null` in other modes.
   * Each entry includes the bin number, display name, and color.
   */
  getActiveLegend(): Array<{ bin: number; name: string; color: string }> | null;
  /** Remove all event listeners and DOM elements. */
  destroy(): void;
}



// ── Main export ───────────────────────────────────────────────────────────────

export function renderWaferMap(
  container: HTMLElement,
  wafer: Wafer,
  dies: Die[],
  options: MountOptions = {},
): WaferCanvasController {
  // Accept a bare <canvas> for backward compatibility — wrap it in a div so the
  // expand modal can reparent it cleanly. For all new call sites pass a <div>.
  let canvas: HTMLCanvasElement;
  let canvasWrap: HTMLDivElement;
  if (container instanceof HTMLCanvasElement) {
    canvas = container;
    canvasWrap = document.createElement('div');
    Object.assign(canvasWrap.style, { position: 'relative', width: '100%', height: '100%' });
    canvas.parentElement?.insertBefore(canvasWrap, canvas);
    canvasWrap.appendChild(canvas);
  } else {
    if (getComputedStyle(container).position === 'static') container.style.position = 'relative';
    canvasWrap = document.createElement('div');
    Object.assign(canvasWrap.style, { position: 'relative', width: '100%', height: '100%' });
    canvas = document.createElement('canvas');
    Object.assign(canvas.style, { width: '100%', height: '100%', display: 'block' });
    canvasWrap.appendChild(canvas);
    container.appendChild(canvasWrap);
  }
  const {
    onHover,
    onClick,
    onSelect,
    onSceneOptionsChange,
    showTooltip          = true,
    showToolbar          = true,
    toolbarControls      = 'full',
    showPlotModeSelector = true,
    minZoom              = 0.5,
    maxZoom              = 20,
    summaryPanel:        summaryPanelOpts,
    waferResult,
    renderTooltip,
    sceneOptions: initialSceneOptions = {},
    ...drawOptions
  } = options;

  let currentFallbackFormat = drawOptions.fallbackFormat;
  let currentStatsSummary = options.statsSummary;

  // ── Mutable state ──────────────────────────────────────────────────────────
  let currentDies     = dies;
  // Selected die keys ("i,j") — key-based so references survive scene rebuilds.
  let selectedKeys    = new Set<string>();
  let sceneOpts: WaferSceneOptions = {
    plotMode:               'hardBin',
    colorScheme:            'default',
    showText:               false,
    showRingBoundaries:     false,
    showQuadrantBoundaries: false,
    showReticle:            false,
    showXYIndicator:        false,
    ringCount:              4,
    rotation:               0,
    flipX:                  false,
    flipY:                  false,
    // legendPosition can come from sceneOptions or the top-level drawOptions.
    legendPosition:            drawOptions.legendPosition ?? 'default',
    ...initialSceneOptions,
  };

  let currentScene:   Scene;
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

  // ── Scene rebuild ──────────────────────────────────────────────────────────
  function rebuildScene(): void {
    const so = sceneOpts;
    currentScene = buildScene(wafer, currentDies, {
      plotMode:               so.plotMode,
      colorScheme:            so.colorScheme,
      showText:               so.showText,
      showRingBoundaries:     so.showRingBoundaries,
      showQuadrantBoundaries: so.showQuadrantBoundaries,
      showReticle:            so.showReticle,
      showXYIndicator:        so.showXYIndicator,
      reticles:               so.reticles,
      ringCount:              so.ringCount,
      highlightBin:           so.highlightBin,
      activeTest:              so.activeTest,
      testDefs:               so.testDefs,
      hbinDefs:               so.hbinDefs,
      sbinDefs:               so.sbinDefs,
      valueRange:             so.valueRange,
      logScale:               so.logScale,
      aggrMethod:             so.aggrMethod,
      lotSize:                so.lotSize,
      dataAxisFlip:           so.dataAxisFlip,
      colorbarRangeMode:      so.colorbarRangeMode,
      fallbackFormat:         currentFallbackFormat,
      interactiveTransform: {
        rotation: so.rotation ?? 0,
        flipX:    so.flipX   ?? false,
        flipY:    so.flipY   ?? false,
      },
    } satisfies SceneOptions);
    dieKeyIndex = new Map(currentScene.dies.map((d, i) => [`${d.x},${d.y}`, i]));
  }

  rebuildScene();

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
      yieldSummary: waferResult?.yield ?? {
        passDies: 0, failDies: 0, edgeExcludedDies: 0, partialDies: 0,
        totalDies: currentDies.filter(d => !d.partial && !d.edgeExcluded).length,
        yieldPercent: null,
        yieldPercentGross: null,
      },
      dataCoverage: waferResult?.dataCoverage ?? {
        filledDies: currentDies.filter(d => !d.partial).length,
        totalDies:  currentDies.length,
        edgeExcludedDies: 0,
        ratio: 1,
      },
      hbinDefs:        sceneOpts.hbinDefs,
      sbinDefs:        sceneOpts.sbinDefs,
      testDefs:        sceneOpts.testDefs,
      statsSummary:    currentStatsSummary,
      passBins:        [1],
      ringCount:       sceneOpts.ringCount ?? 4,
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
  let toolbar:      HTMLDivElement    | null = null;
  let btnBoxSelect: HTMLButtonElement | null = null;
  let btnFindings: HTMLButtonElement | null = null;
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
      toolbar.dataset.wmapToolbar = '1';
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
        opacity:       '0',
        transition:    'opacity 0.2s ease',
        pointerEvents: 'none',
      });

      // ── Toolbar helpers ──────────────────────────────────────────────────
      // Use shared tooltip if available, otherwise create one for the toolbar.
      const tbTooltip = tooltip ?? createTooltip();
      const { makeBtn, setActive, makeSep, makeMenuRow, makeMenuSection, makeDropdown, closeOpenMenu, getOpenMenu, setOpenMenu } = createToolbarHelpers(tbTooltip);
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

      // Camera first, then interaction mode group, then zoom-level group, then scene controls.

      // Camera first — leftmost
      const btnDownload = makeBtn('download', 'Download PNG', downloadPng);
      toolbar.appendChild(btnDownload);
      toolbar.appendChild(makeSep());

      // Interaction mode group: zoom-region | pan | box-select
      const btnZoomMode = makeBtn('zoomMode', 'Zoom (drag to zoom region)', () => setInteractMode('zoom'));
      const btnPanMode  = makeBtn('pan',      'Pan (drag to move)',          () => setInteractMode('pan'));
      toolbar.appendChild(btnZoomMode);
      toolbar.appendChild(btnPanMode);

      btnBoxSelect = makeBtn('boxSelect', 'Select (drag to select dies)', () => setInteractMode('select'));
      toolbar.appendChild(btnBoxSelect);
      toolbar.appendChild(makeSep());

      // Zoom level group: zoom in | zoom out | reset
      const btnZoomIn  = makeBtn('zoomIn',  'Zoom in',                    () => zoomAt(canvas.clientWidth / 2, canvas.clientHeight / 2, 1.5));
      const btnZoomOut = makeBtn('zoomOut', 'Zoom out',                   () => zoomAt(canvas.clientWidth / 2, canvas.clientHeight / 2, 1 / 1.5));
      const btnReset   = makeBtn('reset',   'Reset zoom (double-click)',   () => resetZoom());
      toolbar.appendChild(btnZoomIn);
      toolbar.appendChild(btnZoomOut);
      toolbar.appendChild(btnReset);

      // Set initial active state — pan is default
      setActive(btnPanMode, true);

      // Scene controls — hidden in 'view-only' mode (gallery bar owns them)
      if (toolbarControls !== 'view-only') {
        toolbar.appendChild(makeSep());

        // Mode dropdown: when testDefs are defined, show one entry per named test
        // plus the bin modes. Selecting a named test sets plotMode:'value' + activeTest.
        // Selecting a bin mode sets plotMode to that mode and clears activeTest.
        function isCurrentEntry(e: ModeEntry): boolean {
          if (e.plotMode !== (sceneOpts.plotMode ?? 'hardBin')) return false;
          if (e.plotMode === 'value') return (sceneOpts.activeTest ?? 0) === (e.activeTest ?? 0);
          return true;
        }

        function pickEntry(entry: ModeEntry, menu: HTMLElement): void {
          if (entry.activeTest !== undefined) {
            // Apply test's logScale default when switching tests.
            applyOpts({ plotMode: 'value', activeTest: entry.activeTest, logScale: entry.logScale });
          } else {
            applyOpts({ plotMode: entry.plotMode, activeTest: undefined });
          }
          menu.remove();
          setOpenMenu(null);
        }

        const btnMode = makeBtn('mode', 'Plot mode', () => {
          const openMenu = getOpenMenu();
          if (openMenu) { openMenu.remove(); setOpenMenu(null); return; }

          // Only include modes for which data is actually present.
          const dies     = currentScene.dies;
          const testDefs = currentScene.testDefs;
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
                : [...new Set(dies.flatMap(d =>
                    d.testValues ? Object.keys(d.testValues).map(Number) : []
                  ))].sort((a, b) => a - b).map(tn => ({
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
          const stackedEntries: ModeEntry[] = currentScene.isLotStack ? [
            ...(hasValues ? [{ plotMode: 'stackedValues'   as PlotMode, label: MODE_LABELS.stackedValues }]   : []),
            ...(hasHbin   ? [{ plotMode: 'stackedBins'     as PlotMode, label: MODE_LABELS.stackedBins }]     : []),
            ...(hasSbin   ? [{ plotMode: 'stackedSoftBins' as PlotMode, label: MODE_LABELS.stackedSoftBins }] : []),
          ] : [];

          const menu = buildModeMenuEl(
            btnMode.getBoundingClientRect(),
            testEntries, binEntries, stackedEntries,
            isCurrentEntry, pickEntry,
            { makeMenuRow, makeMenuSection },
            sceneOpts.plotMode ?? 'hardBin',
          );
          document.body.appendChild(menu);
          setOpenMenu(menu);
        });
        const btnPalette = makeDropdown(
          'palette', 'Colour scheme',
          () => listColorSchemes().map(s => ({ value: s.name, label: s.label })),
          () => sceneOpts.colorScheme ?? 'default',
          v => applyOpts({ colorScheme: v }),
        );
        const btnRings = makeBtn('rings', 'Toggle ring boundaries', () => {
          applyOpts({ showRingBoundaries: !sceneOpts.showRingBoundaries });
          setActive(btnRings, !!sceneOpts.showRingBoundaries);
        });
        const btnQuadrants = makeBtn('quadrants', 'Toggle quadrant boundaries', () => {
          applyOpts({ showQuadrantBoundaries: !sceneOpts.showQuadrantBoundaries });
          setActive(btnQuadrants, !!sceneOpts.showQuadrantBoundaries);
        });
        const btnLabels = makeBtn('labels', 'Toggle die labels', () => {
          applyOpts({ showText: !sceneOpts.showText });
          setActive(btnLabels, !!sceneOpts.showText);
        });
        const btnReticle = makeBtn('reticle', 'Toggle reticle overlay', () => {
          applyOpts({ showReticle: !sceneOpts.showReticle });
          setActive(btnReticle, !!sceneOpts.showReticle);
        });
        const btnXY = makeBtn('xyIndicator', 'Toggle XY axis indicator', () => {
          applyOpts({ showXYIndicator: !sceneOpts.showXYIndicator });
          setActive(btnXY, !!sceneOpts.showXYIndicator);
        });
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
          () => sceneOpts.legendPosition ?? 'default',
          (v) => applyOpts({ legendPosition: v }),
        );
        syncLegendStyleBtnFn = () => {
          const isBinMode = sceneOpts.plotMode === 'hardBin' || sceneOpts.plotMode === 'softBin';
          btnLegendStyle.style.display = isBinMode ? '' : 'none';
        };
        syncLegendStyleBtnFn();

        const btnLogScale = makeBtn('logScale', 'Toggle log scale', () => {
          applyOpts({ logScale: !sceneOpts.logScale });
        });
        syncLogScaleBtnFn = () => {
          const isValueMode = sceneOpts.plotMode === 'value' || sceneOpts.plotMode === 'stackedValues';
          btnLogScale.style.display = isValueMode ? '' : 'none';
          setActive(btnLogScale, !!sceneOpts.logScale);
        };
        syncLogScaleBtnFn();

        const activeTestDefHasLimits = () => {
          const td = sceneOpts.testDefs?.find(t => (t.index ?? t.testNumber) === sceneOpts.activeTest);
          return td !== undefined && (td.limitLow !== undefined || td.limitHigh !== undefined);
        };
        const btnColorbarRange = makeBtn('specRange', 'Colorbar range: spec limits', () => {
          const next = sceneOpts.colorbarRangeMode === 'data' ? 'spec' : 'data';
          applyOpts({ colorbarRangeMode: next });
        });
        syncColorbarRangeBtnFn = () => {
          const visible = sceneOpts.plotMode === 'value' && activeTestDefHasLimits();
          btnColorbarRange.style.display = visible ? '' : 'none';
          const isSpec = (sceneOpts.colorbarRangeMode ?? 'spec') === 'spec';
          setActive(btnColorbarRange, isSpec);
          btnColorbarRange.ariaLabel = isSpec
            ? 'Colorbar range: spec limits (click for data range)'
            : 'Colorbar range: data range (click for spec limits)';
        };
        syncColorbarRangeBtnFn();

        const btnRotate = makeBtn('rotateCW', 'Rotate 90° clockwise', () => {
          const r = sceneOpts.rotation ?? 0;
          // Positive rotation is CCW in standard math convention, so decrement to rotate CW.
          applyOpts({ rotation: ROTATIONS[(ROTATIONS.indexOf(r) + 3) % 4] });
        });
        const btnFlipH = makeBtn('flipH', 'Flip horizontal', () => {
          applyOpts({ flipX: !sceneOpts.flipX });
          setActive(btnFlipH, !!sceneOpts.flipX);
        });
        const btnFlipV = makeBtn('flipV', 'Flip vertical', () => {
          applyOpts({ flipY: !sceneOpts.flipY });
          setActive(btnFlipV, !!sceneOpts.flipY);
        });

        if (showPlotModeSelector) toolbar.appendChild(btnMode);
        toolbar.appendChild(btnPalette);
        toolbar.appendChild(btnLogScale);
        toolbar.appendChild(btnColorbarRange);
        toolbar.appendChild(makeSep());
        toolbar.appendChild(btnRings);
        toolbar.appendChild(btnQuadrants);
        toolbar.appendChild(btnLabels);
        if (currentScene!.hasReticle) toolbar.appendChild(btnReticle);
        toolbar.appendChild(btnXY);
        toolbar.appendChild(makeSep());
        toolbar.appendChild(btnLegendStyle);
        toolbar.appendChild(makeSep());
        toolbar.appendChild(btnRotate);
        toolbar.appendChild(btnFlipH);
        toolbar.appendChild(btnFlipV);

        setActive(btnRings,     !!sceneOpts.showRingBoundaries);
        setActive(btnQuadrants, !!sceneOpts.showQuadrantBoundaries);
        setActive(btnLabels,    !!sceneOpts.showText);
        setActive(btnReticle,   !!sceneOpts.showReticle);
        setActive(btnXY,        !!sceneOpts.showXYIndicator);
        setActive(btnFlipH,     !!sceneOpts.flipX);
        setActive(btnFlipV,     !!sceneOpts.flipY);

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
          toolbar.appendChild(makeSep());
          toolbar.appendChild(btnFindings);
          // Set button active state to match initial panel visibility
          if (autoSummaryPanelEl?.style.display !== 'none') setActive(btnFindings, true);
          refreshFindingsButton();
        }

        // Expand button — reparents canvas into a modal for a larger view.
        toolbar.appendChild(makeSep());
        const btnExpand = makeBtn('expand', 'Expand (E)', openExpandModal);
        toolbar.appendChild(btnExpand);
      }

      canvasWrap.appendChild(toolbar);

      // ── Hover show/hide (with linger so clicks register) ─────────────────
      function showBar(): void {
        if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
        if (toolbar) {
          toolbar.style.opacity      = '1';
          toolbar.style.pointerEvents = 'auto';
        }
      }
      function hideBar(): void {
        hideTimer = setTimeout(() => {
          if (toolbar) {
            toolbar.style.opacity      = '0';
            toolbar.style.pointerEvents = 'none';
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
  let modalBackdrop: HTMLDivElement | null = null;
  let modalOriginalParent: HTMLElement | null = null;
  let modalFullscreenListener: (() => void) | null = null;

  function closeExpandModal(): void {
    if (!modalBackdrop) return;
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {/* ignore */});
    }
    if (modalFullscreenListener) {
      document.removeEventListener('fullscreenchange', modalFullscreenListener);
      modalFullscreenListener = null;
    }
    document.removeEventListener('keydown', onModalKeyDown);
    // Reparent canvas back to its original container.
    if (modalOriginalParent) {
      modalOriginalParent.appendChild(canvasWrap);
      modalOriginalParent = null;
    }
    modalBackdrop.remove();
    modalBackdrop = null;
    document.body.style.overflow = savedBodyOverflow;
    // Fit will recompute via ResizeObserver firing on reparent.
  }

  let savedBodyOverflow = '';

  function onModalKeyDown(e: KeyboardEvent): void {
    if (e.key === 'Escape' && !document.fullscreenElement) closeExpandModal();
    if (e.key === 'f' || e.key === 'F') {
      if (!document.fullscreenElement) {
        (modalBackdrop?.querySelector('.wmap-modal-box') as HTMLElement | null)
          ?.requestFullscreen().catch(() => {/* not supported */});
      } else {
        document.exitFullscreen();
      }
    }
  }

  function openExpandModal(): void {
    if (modalBackdrop) closeExpandModal();

    savedBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const backdrop = document.createElement('div');
    backdrop.id = 'wmap-modal-backdrop';
    Object.assign(backdrop.style, {
      position:       'fixed',
      inset:          '0',
      background:     'rgba(0,0,0,0.6)',
      display:        'flex',
      alignItems:     'center',
      justifyContent: 'center',
      zIndex:         '9000',
      backdropFilter: 'blur(3px)',
    });

    const box = document.createElement('div');
    box.className = 'wmap-modal-box';
    Object.assign(box.style, {
      background:    '#fff',
      borderRadius:  '12px',
      overflow:      'hidden',
      display:       'flex',
      flexDirection: 'column',
      width:         'min(90vw, 700px)',
      height:        'min(90vh, 700px)',
      boxShadow:     '0 20px 60px rgba(0,0,0,0.4)',
      resize:        'both',
      minWidth:      '320px',
      minHeight:     '240px',
      maxWidth:      '100vw',
      maxHeight:     '100vh',
    });

    const modalHeader = document.createElement('div');
    Object.assign(modalHeader.style, {
      display:      'flex',
      alignItems:   'center',
      padding:      '10px 14px',
      borderBottom: '1px solid #e2e5ea',
      flexShrink:   '0',
    });
    const spacer = document.createElement('div');
    spacer.style.flex = '1';
    const btnStyle = {
      border:     'none',
      background: 'transparent',
      cursor:     'pointer',
      color:      '#888',
      lineHeight: '1',
      padding:    '0 4px',
      fontSize:   '15px',
      display:    'flex',
      alignItems: 'center',
    };

    const fullscreenBtn = document.createElement('button');
    fullscreenBtn.innerHTML = '&#x26F6;';
    fullscreenBtn.title = 'Fullscreen (F)';
    Object.assign(fullscreenBtn.style, { ...btnStyle, fontSize: '18px' });
    fullscreenBtn.addEventListener('click', () => {
      if (!document.fullscreenElement) {
        box.requestFullscreen().catch(() => {/* not supported */});
      } else {
        document.exitFullscreen();
      }
    });

    const closeBtn = document.createElement('button');
    closeBtn.textContent = '\xD7';
    closeBtn.title = 'Close (Esc)';
    Object.assign(closeBtn.style, { ...btnStyle, fontSize: '20px', padding: '0 2px' });
    closeBtn.addEventListener('click', closeExpandModal);

    const onFullscreenChange = () => {
      const isFs = document.fullscreenElement === box;
      fullscreenBtn.innerHTML = isFs ? '&#x2922;' : '&#x26F6;';
      fullscreenBtn.title = isFs ? 'Exit fullscreen (F or Esc)' : 'Fullscreen (F)';
      closeBtn.style.display = isFs ? 'none' : '';
      if (isFs) {
        box.style.borderRadius = '0';
        box.style.resize = 'none';
        box.style.width = '100%';
        box.style.height = '100%';
      } else {
        box.style.borderRadius = '12px';
        box.style.resize = 'both';
        box.style.width = 'min(90vw, 700px)';
        box.style.height = 'min(90vh, 700px)';
      }
    };

    modalHeader.appendChild(spacer);
    modalHeader.appendChild(fullscreenBtn);
    modalHeader.appendChild(closeBtn);

    const modalCanvasWrap = document.createElement('div');
    Object.assign(modalCanvasWrap.style, { flex: '1', minHeight: '0', position: 'relative', overflow: 'hidden' });

    // Reparent — move the live canvasWrap (canvas + toolbar) into the modal.
    modalOriginalParent = canvasWrap.parentElement as HTMLElement;
    modalCanvasWrap.appendChild(canvasWrap);

    box.appendChild(modalHeader);
    box.appendChild(modalCanvasWrap);
    backdrop.appendChild(box);
    document.body.appendChild(backdrop);

    backdrop.addEventListener('click', (e) => { if (e.target === backdrop) closeExpandModal(); });
    document.addEventListener('keydown', onModalKeyDown);
    modalFullscreenListener = onFullscreenChange;
    document.addEventListener('fullscreenchange', onFullscreenChange);

    modalBackdrop = backdrop;
    // ResizeObserver fires on reparent → render() recomputes fit automatically.
  }

  // ── Apply scene option changes ─────────────────────────────────────────────

  // Rebuild and redraw without firing the external callback.
  // Used by ctrl.setOptions() so programmatic updates don't re-fire the callback
  // (consistent with renderWaferGallery behaviour and documented API contract).
  function syncOpts(partial: Partial<WaferSceneOptions>): void {
    const prevMode = sceneOpts.plotMode;
    sceneOpts = { ...sceneOpts, ...partial };
    // Changing plot mode changes the colorbar/legend width, which shifts the
    // auto-fit viewport's originX. Invalidate fittedViewport so it is
    // recomputed for the new mode before drawSelectionOverlay reads it.
    if (partial.plotMode !== undefined && partial.plotMode !== prevMode) {
      fittedViewport = null;
    }
    // legendPosition only affects canvas layout — skip the scene rebuild.
    const onlyLegendStyle = Object.keys(partial).every(k => k === 'legendPosition');
    if (!onlyLegendStyle) rebuildScene();
    syncLegendStyleBtnFn?.();
    syncLogScaleBtnFn?.();
    syncColorbarRangeBtnFn?.();
    render();
  }

  // Rebuild, redraw, and fire onSceneOptionsChange.
  // Used by all toolbar interactions.
  function applyOpts(partial: Partial<WaferSceneOptions>): void {
    syncOpts(partial);
    onSceneOptionsChange?.(sceneOpts);
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
    const firstDie = currentScene.dies[0];
    const diePitchMm = firstDie
      ? { x: firstDie.width, y: firstDie.height }
      : drawOptions.diePitchMm;

    // Hold the right-side reserve constant across mode switches so the wafer
    // doesn't resize when toggling between value and bin modes.
    const cssW = Math.floor(canvas.clientWidth || canvas.width);
    const hasBinData = !!(currentScene.hbinDefs?.length || currentScene.sbinDefs?.length ||
      currentScene.dies.some(d => d.hbin != null || d.sbin != null));
    const legendPos = sceneOpts.legendPosition ?? 'default';
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

    const result = toCanvas(canvas, currentScene, {
      ...drawOptions,
      topClearance:    showToolbar ? TOOLBAR_CLEARANCE : 0,
      minRightReserve: stableRight,
      legendPosition:  legendPos,
      legendOffset,
      diePitchMm,
      fallbackFormat: currentFallbackFormat,
      showAxes:  drawOptions.showAxes ?? (viewport !== null),
      viewport: vp,
      activeBin: sceneOpts.highlightBin,
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
    const pts = currentScene.hoverPoints;

    const firstRect = currentScene.rectangles[0];
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

    if (legendBoxRect && sceneOpts.legendPosition === 'floating' && pointInRect(px, py, legendBoxRect)) {
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
        tooltip.style.display = 'block';
        tooltip.style.left = `${e.clientX + 14}px`;
        tooltip.style.top = `${e.clientY - 8}px`;
        tooltip.innerHTML = legendRow.label ?? `Bin ${legendRow.bin}`;
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
            tooltip.style.display = 'block';
            tooltip.style.left    = `${e.clientX + 14}px`;
            tooltip.style.top     = `${e.clientY - 8}px`;
            if (typeof content === 'string') {
              tooltip.innerHTML = content;
            } else {
              tooltip.innerHTML = '';
              tooltip.appendChild(content);
            }
          }
        } else {
          const hp = currentScene.hoverPoints[hit!.index];
          tooltip.style.display = 'block';
          tooltip.style.left    = `${e.clientX + 14}px`;
          tooltip.style.top     = `${e.clientY - 8}px`;
          tooltip.innerHTML     = hp?.text ?? `Die (${die.x}, ${die.y})`;
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
        const pts = currentScene.hoverPoints;
        const boxDies: Die[] = [];
        for (let i = 0; i < pts.length; i++) {
          if (pts[i].x >= x1mm && pts[i].x <= x2mm &&
              pts[i].y >= y1mm && pts[i].y <= y2mm) {
            const d = currentScene.dies[i];
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
        const next = sceneOpts.highlightBin === row.bin ? undefined : row.bin;
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
    const pts = currentScene.hoverPoints;
    for (let i = 0; i < pts.length; i++) {
      const d = currentScene.dies[i];
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
    const pts  = currentScene.hoverPoints;
    const rcts = currentScene.rectangles;

    // First pass: exact rectangle containment — handles partial dies whose
    // centres lie outside the wafer and would otherwise snap to a neighbour.
    for (let i = 0; i < rcts.length; i++) {
      const r = rcts[i];
      if (Math.abs(mx - r.x) <= r.width / 2 && Math.abs(my - r.y) <= r.height / 2) {
        const die = currentScene.dies[i];
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
      if (d2 < bestDist) { bestDist = d2; bestDie = currentScene.dies[i] ?? null; bestIndex = i; }
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
      rebuildScene();
      render();
      if (summaryPanelEl) renderSummaryPanel();
    },

    setOptions(partial: Partial<WaferSceneOptions>): void {
      syncOpts(partial);
    },

    getOptions(): WaferSceneOptions {
      return { ...sceneOpts };
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
      rebuildScene();
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

    getActiveLegend(): Array<{ bin: number; name: string; color: string }> | null {
      const mode = sceneOpts.plotMode;
      if (mode !== 'hardBin' && mode !== 'softBin') return null;
      const isHard = mode === 'hardBin';
      const defs = isHard ? sceneOpts.hbinDefs : sceneOpts.sbinDefs;
      const bins = [...new Set(currentDies.map(d => isHard ? d.hbin : d.sbin).filter((b): b is number => b !== undefined))].sort((a, b) => a - b);
      if (!bins.length) return null;
      return bins.map(bin => {
        const def = defs?.find(d => d.bin === bin);
        const color = def?.color ?? (isHard ? hardBinColor(bin) : softBinColor(bin));
        return { bin, name: def?.name ?? `Bin ${bin}`, color };
      });
    },

    destroy(): void {
      closeExpandModal();
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
