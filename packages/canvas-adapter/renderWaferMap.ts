import type { Scene, SceneOptions, PlotMode } from '../renderer/buildScene.js';
import { buildScene } from '../renderer/buildScene.js';
import { listColorSchemes } from '../renderer/colorSchemes.js';
import type { Wafer } from '../core/wafer.js';
import type { Die } from '../core/dies.js';
import type { Reticle } from '../core/reticle.js';
import { toCanvas, type ToCanvasOptions, type ViewportTransform, type BinLegendRow } from './toCanvas.js';
import type { TestDef, BinDef } from '../renderer/buildWaferMap.js';
import type { StatsFinding, StatsSummary } from '../stats/types.js';
import { CLR, ROTATIONS, INLINE_TEST_LIMIT, MODE_LABELS, createTooltip, createToolbarHelpers } from './toolbar.js';
import type { SummaryPanelOptions } from './summaryPanel.js';
import {
  createSummaryPanelEl, wrapWithSummaryPanel, renderWaferSummaryContent,
} from './summaryPanel.js';

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
  testIndex?:              number;
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
   * Aggregation method label shown in hover tooltips for `stackedValues` mode.
   * E.g. `'mean'`, `'median'`, `'stddev'`, `'min'`, `'max'`.
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
  /** Remove all event listeners and DOM elements. */
  destroy(): void;
}



// ── Main export ───────────────────────────────────────────────────────────────

export function renderWaferMap(
  canvas: HTMLCanvasElement,
  wafer: Wafer,
  dies: Die[],
  options: MountOptions = {},
): WaferCanvasController {
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
    colorScheme:            'color',
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
      testIndex:              so.testIndex,
      testDefs:               so.testDefs,
      hbinDefs:               so.hbinDefs,
      sbinDefs:               so.sbinDefs,
      valueRange:             so.valueRange,
      aggrMethod:             so.aggrMethod,
      lotSize:                so.lotSize,
      dataAxisFlip:           so.dataAxisFlip,
      fallbackFormat:         currentFallbackFormat,
      interactiveTransform: {
        rotation: so.rotation ?? 0,
        flipX:    so.flipX   ?? false,
        flipY:    so.flipY   ?? false,
      },
    } satisfies SceneOptions);
  }

  rebuildScene();

  // ── Summary panel ──────────────────────────────────────────────────────────
  let summaryPanelEl: HTMLDivElement | null = null;
  let summaryPanelWrapper: HTMLDivElement | null = null;
  let summaryActiveFindingId: string | null = null;
  // Auto-mounted panel: created when statsSummary is provided but no explicit summaryPanel option.
  let autoSummaryPanelEl: HTMLDivElement | null = null;
  let autoSummaryPanelWrapper: HTMLDivElement | null = null;

  function renderSummaryPanel(): void {
    if (!summaryPanelEl) return;
    renderWaferSummaryContent(summaryPanelEl, {
      wafer,
      dies:         currentDies,
      yieldSummary: waferResult?.yield ?? {
        passDies: 0, failDies: 0, edgeExcludedDies: 0, partialDies: 0,
        totalDies: currentDies.filter(d => !d.partial && !d.edgeExcluded).length,
        yieldPercent: null,
      },
      dataCoverage: waferResult?.dataCoverage ?? {
        filledDies: currentDies.filter(d => !d.partial).length,
        totalDies:  currentDies.length,
        edgeExcludedDies: 0,
        ratio: 1,
      },
      hbinDefs:       sceneOpts.hbinDefs,
      sbinDefs:       sceneOpts.sbinDefs,
      testDefs:       sceneOpts.testDefs,
      statsSummary:   currentStatsSummary,
      passBins:       [1],
      ringCount:      sceneOpts.ringCount ?? 4,
      fallbackFormat: currentFallbackFormat,
      activeFindingId: summaryActiveFindingId,
      onFindingClick: (finding, row) => {
        if (summaryActiveFindingId === finding.id) {
          summaryActiveFindingId = null;
          selectionFromKeys([]);
          applyOpts({ highlightBin: undefined });
        } else {
          summaryActiveFindingId = finding.id;
          applyFindingHighlightFromPanel(finding);
        }
        renderSummaryPanel();
        void row;
      },
    });
  }

  function renderAutoSummaryPanel(): void {
    if (!autoSummaryPanelEl) return;
    renderWaferSummaryContent(autoSummaryPanelEl, {
      wafer,
      dies:         currentDies,
      yieldSummary: waferResult?.yield ?? {
        passDies: 0, failDies: 0, edgeExcludedDies: 0, partialDies: 0,
        totalDies: currentDies.filter(d => !d.partial && !d.edgeExcluded).length,
        yieldPercent: null,
      },
      dataCoverage: waferResult?.dataCoverage ?? {
        filledDies: currentDies.filter(d => !d.partial).length,
        totalDies:  currentDies.length,
        edgeExcludedDies: 0,
        ratio: 1,
      },
      hbinDefs:       sceneOpts.hbinDefs,
      sbinDefs:       sceneOpts.sbinDefs,
      testDefs:       sceneOpts.testDefs,
      statsSummary:   currentStatsSummary,
      passBins:       [1],
      ringCount:      sceneOpts.ringCount ?? 4,
      fallbackFormat: currentFallbackFormat,
      activeFindingId: summaryActiveFindingId,
      onFindingClick: (finding, row) => {
        if (summaryActiveFindingId === finding.id) {
          summaryActiveFindingId = null;
          selectionFromKeys([]);
          applyOpts({ highlightBin: undefined });
        } else {
          summaryActiveFindingId = finding.id;
          applyFindingHighlightFromPanel(finding);
        }
        renderAutoSummaryPanel();
        void row;
      },
    });
  }

  function applyFindingHighlightFromPanel(finding: StatsFinding): void {
    const { kind, index } = finding.variable;
    if (kind === 'test') {
      applyOpts({ plotMode: 'value', testIndex: index ?? 0, highlightBin: undefined });
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

  if (summaryPanelOpts) {
    const placement = summaryPanelOpts.placement ?? 'right';
    // Add clearance to prevent the summary panel content from being obscured by the
    // floating toolbar (position:absolute, top:4px, height ~32px → ~44px total).
    const clearance = showToolbar ? 44 : 0;
    summaryPanelEl = createSummaryPanelEl(placement, clearance);
    const parent = canvas.parentElement;
    if (parent) {
      const next = canvas.nextSibling;
      summaryPanelWrapper = wrapWithSummaryPanel(canvas, summaryPanelEl, placement);
      parent.insertBefore(summaryPanelWrapper, next);
    }
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
    const parent = canvas.parentElement;
    if (parent) {
      if (getComputedStyle(parent).position === 'static') {
        parent.style.position = 'relative';
      }

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
        // plus the bin modes. Selecting a named test sets plotMode:'value' + testIndex.
        // Selecting a bin mode sets plotMode to that mode and clears testIndex.
        type ModeEntry = { plotMode: PlotMode; testIndex?: number; label: string };

        function isCurrentEntry(e: ModeEntry): boolean {
          if (e.plotMode !== (sceneOpts.plotMode ?? 'hardBin')) return false;
          if (e.plotMode === 'value') return (sceneOpts.testIndex ?? 0) === (e.testIndex ?? 0);
          return true;
        }

        // Build a menu row and wire hover/click.
        function makeMenuRow(
          label: string,
          active: boolean,
          indent: boolean,
          onClick: (e: MouseEvent) => void,
        ): HTMLDivElement {
          const row = document.createElement('div');
          row.textContent = label;
          Object.assign(row.style, {
            padding:    `6px 14px 6px ${indent ? '26px' : '14px'}`,
            fontSize:   '12px',
            cursor:     'pointer',
            color:      active ? CLR.iconActive : '#333',
            fontWeight: active ? '700' : '400',
            background: active ? CLR.menuActive : 'transparent',
            whiteSpace: 'nowrap',
          });
          row.addEventListener('mouseenter', () => { if (!active) row.style.background = CLR.menuHover; });
          row.addEventListener('mouseleave', () => { row.style.background = active ? CLR.menuActive : 'transparent'; });
          row.addEventListener('click', onClick);
          return row;
        }

        // Non-clickable section divider with label.
        function makeMenuSection(label: string): HTMLDivElement {
          const el = document.createElement('div');
          el.textContent = label;
          Object.assign(el.style, {
            padding:       '5px 14px 2px',
            fontSize:      '10px',
            fontWeight:    '600',
            letterSpacing: '0.05em',
            color:         '#888',
            textTransform: 'uppercase',
            pointerEvents: 'none',
            userSelect:    'none',
          });
          return el;
        }

        function pickEntry(entry: ModeEntry, menu: HTMLElement): void {
          if (entry.testIndex !== undefined) {
            applyOpts({ plotMode: 'value', testIndex: entry.testIndex });
          } else {
            applyOpts({ plotMode: entry.plotMode, testIndex: undefined });
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
          const hasHbin   = dies.some(d => d.hbin != null);
          const hasSbin   = dies.some(d => d.sbin != null);

          const testEntries: ModeEntry[] = hasValues
            ? (testDefs?.length
                ? testDefs.map(t => ({
                    plotMode: 'value' as PlotMode,
                    testIndex: t.index ?? t.testNumber ?? 0,
                    label: t.unit ? `${t.name} (${t.unit})` : t.name,
                  }))
                : [{ plotMode: 'value' as PlotMode, label: MODE_LABELS.value }])
            : [];
          const binEntries: ModeEntry[] = [
            ...(hasHbin ? [{ plotMode: 'hardBin'  as PlotMode, label: MODE_LABELS.hardBin }] : []),
            ...(hasSbin ? [{ plotMode: 'softBin'  as PlotMode, label: MODE_LABELS.softBin }] : []),
          ];
          // Stacked modes are only valid for lot-aggregated data — the scene knows this via isLotStack.
          const stackedEntries: ModeEntry[] = currentScene.isLotStack ? [
            ...(hasValues ? [{ plotMode: 'stackedValues'   as PlotMode, label: MODE_LABELS.stackedValues }]   : []),
            ...(hasHbin   ? [{ plotMode: 'stackedBins'     as PlotMode, label: MODE_LABELS.stackedBins }]     : []),
            ...(hasSbin   ? [{ plotMode: 'stackedSoftBins' as PlotMode, label: MODE_LABELS.stackedSoftBins }] : []),
          ] : [];

          const menu = document.createElement('div');
          const btnRect = btnMode.getBoundingClientRect();
          Object.assign(menu.style, {
            position:      'fixed',
            top:           `${btnRect.bottom + 4}px`,
            left:          `${btnRect.left}px`,
            background:    CLR.menuBg,
            border:        `1px solid ${CLR.menuBorder}`,
            borderRadius:  '4px',
            boxShadow:     '0 4px 12px rgba(0,0,0,0.15)',
            zIndex:        '9998',
            minWidth:      '180px',
            padding:       '4px 0',
            pointerEvents: 'auto',
          });

          // ── Test Value section ────────────────────────────────────────────
          if (testEntries.length) {
            menu.appendChild(makeMenuSection('Test Value'));

            if (testEntries.length <= INLINE_TEST_LIMIT) {
              // Inline: one row per test, indented.
              for (const entry of testEntries) {
                const active = isCurrentEntry(entry);
                menu.appendChild(makeMenuRow(entry.label, active, true, e => {
                  e.stopPropagation();
                  pickEntry(entry, menu);
                }));
              }
            } else {
              // Cascade: single "Test Value ▶" row that opens a submenu.
              const cascadeActive = (sceneOpts.plotMode ?? 'hardBin') === 'value';
              const cascadeRow = makeMenuRow(MODE_LABELS.value + ' ▶', cascadeActive, false, () => {});
              // Remove default pointer cursor on the cascade row itself — submenu handles selection.
              cascadeRow.style.display       = 'flex';
              cascadeRow.style.justifyContent = 'space-between';
              cascadeRow.style.alignItems    = 'center';

              let subMenu: HTMLDivElement | null = null;

              const openSub = () => {
                if (subMenu) return;
                const rowRect = cascadeRow.getBoundingClientRect();
                subMenu = document.createElement('div');
                Object.assign(subMenu.style, {
                  position:  'fixed',
                  top:       `${rowRect.top - 4}px`,
                  left:      `${rowRect.right + 2}px`,
                  background: CLR.menuBg,
                  border:    `1px solid ${CLR.menuBorder}`,
                  borderRadius: '4px',
                  boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
                  zIndex:    '9999',
                  minWidth:  '160px',
                  maxHeight: '320px',
                  overflowY: 'auto',
                  padding:   '4px 0',
                  pointerEvents: 'auto',
                });
                for (const entry of testEntries) {
                  const active = isCurrentEntry(entry);
                  subMenu.appendChild(makeMenuRow(entry.label, active, false, e => {
                    e.stopPropagation();
                    subMenu?.remove(); subMenu = null;
                    pickEntry(entry, menu);
                  }));
                }
                document.body.appendChild(subMenu);
                document.addEventListener('click', closeSub, { once: true });
              };

              const closeSub = () => { subMenu?.remove(); subMenu = null; };

              cascadeRow.addEventListener('mouseenter', openSub);
              cascadeRow.addEventListener('mouseleave', (e) => {
                // Keep open if moving into the submenu.
                if (subMenu && subMenu.contains(e.relatedTarget as Node)) return;
                closeSub();
              });

              menu.appendChild(cascadeRow);
            }
          }

          // ── Bins section ─────────────────────────────────────────────────
          if (binEntries.length) {
            menu.appendChild(makeMenuSection('Bins'));
            for (const entry of binEntries) {
              const active = isCurrentEntry(entry);
              menu.appendChild(makeMenuRow(entry.label, active, false, e => {
                e.stopPropagation();
                pickEntry(entry, menu);
              }));
            }
          }

          // ── Stacked (lot aggregation) section ─────────────────────────────
          if (stackedEntries.length) {
            menu.appendChild(makeMenuSection('Lot Aggregation'));
            for (const entry of stackedEntries) {
              const active = isCurrentEntry(entry);
              menu.appendChild(makeMenuRow(entry.label, active, false, e => {
                e.stopPropagation();
                pickEntry(entry, menu);
              }));
            }
          }

          document.body.appendChild(menu);
          setOpenMenu(menu);
        });
        const btnPalette = makeDropdown(
          'palette', 'Colour scheme',
          () => listColorSchemes().map(s => ({ value: s.name, label: s.label })),
          () => sceneOpts.colorScheme ?? 'color',
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
        // Disable legend style button when not in a bin mode (it only affects bin legends).
        syncLegendStyleBtnFn = () => {
          const isBinMode = sceneOpts.plotMode === 'hardBin' || sceneOpts.plotMode === 'softBin';
          btnLegendStyle.style.opacity       = isBinMode ? '' : '0.35';
          btnLegendStyle.style.pointerEvents = isBinMode ? '' : 'none';
        };
        syncLegendStyleBtnFn();
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
        // When statsSummary is provided with no explicit summaryPanel option, auto-mount a hidden panel.
        if (currentStatsSummary && !summaryPanelOpts) {
          const clearance = 44;
          autoSummaryPanelEl = createSummaryPanelEl('right', clearance);
          autoSummaryPanelEl.style.display = 'none';
          const next = canvas.nextSibling;
          autoSummaryPanelWrapper = wrapWithSummaryPanel(canvas, autoSummaryPanelEl, 'right');
          parent.insertBefore(autoSummaryPanelWrapper, next);
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
          refreshFindingsButton();
        }
      }

      canvas.insertAdjacentElement('afterend', toolbar);

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
    render();
  }

  // Rebuild, redraw, and fire onSceneOptionsChange.
  // Used by all toolbar interactions.
  function applyOpts(partial: Partial<WaferSceneOptions>): void {
    syncOpts(partial);
    onSceneOptionsChange?.(sceneOpts);
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  function render(): void {
    const vp = viewport ?? undefined;
    // Derive die pitch from the first die so axis labels show die grid indices.
    const firstDie = currentScene.dies[0];
    const diePitchMm = firstDie
      ? { x: firstDie.width, y: firstDie.height }
      : drawOptions.diePitchMm;

    const result = toCanvas(canvas, currentScene, {
      ...drawOptions,
      legendPosition: sceneOpts.legendPosition ?? 'default',
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
    const dpr = window.devicePixelRatio ?? 1;
    const pts = currentScene.hoverPoints;

    const firstRect = currentScene.rectangles[0];
    const dieHalfW  = firstRect ? (firstRect.width  / 2) * vp.ppm : vp.ppm * 0.5;
    const dieHalfH  = firstRect ? (firstRect.height / 2) * vp.ppm : vp.ppm * 0.5;
    // Inset slightly so the ring sits just inside the die edge.
    const inset = Math.max(1, Math.min(3, dieHalfW * 0.08));

    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.setLineDash([]);

    for (let i = 0; i < pts.length; i++) {
      const die = currentScene.dies[i];
      if (!die) continue;
      const key = `${die.i},${die.j}`;
      if (!selectedKeys.has(key)) continue;

      const sx = vp.originX + pts[i].x * vp.ppm;
      const sy = vp.originY - pts[i].y * vp.ppm;
      const hw = dieHalfW - inset;
      const hh = dieHalfH - inset;

      // Subtle amber tint — colour-neutral enough to work over any die colour.
      ctx.fillStyle = 'rgba(255,210,0,0.18)';
      ctx.fillRect(sx - hw, sy - hh, hw * 2, hh * 2);

      // White halo separates the outline from any background colour.
      ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      ctx.lineWidth   = 3;
      ctx.strokeRect(sx - hw, sy - hh, hw * 2, hh * 2);

      // Amber inner stroke — visible against blue, green, purple, grey, and light fills.
      ctx.strokeStyle = 'rgba(245,185,0,1)';
      ctx.lineWidth   = 1.5;
      ctx.strokeRect(sx - hw, sy - hh, hw * 2, hh * 2);
    }

    ctx.restore();
  }

  // ── Box select overlay ─────────────────────────────────────────────────────
  function drawBoxOverlay(): void {
    const ctx = canvas.getContext('2d')!;
    const dpr = window.devicePixelRatio ?? 1;
    const x   = Math.min(boxStart.x, boxEnd.x);
    const y   = Math.min(boxStart.y, boxEnd.y);
    const w   = Math.abs(boxEnd.x - boxStart.x);
    const h   = Math.abs(boxEnd.y - boxStart.y);
    ctx.save();
    ctx.scale(dpr, dpr);
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
      render();
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
      render();
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
      render();
      return;
    }

    const vp = currentViewport();
    if (!vp) return;
    const mx  = (cssPx - vp.originX) / vp.ppm;
    const my  = (vp.originY - cssPy) / vp.ppm;
    const die = hitTest(mx, my, vp.snapDist);

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
        const hp = currentScene.hoverPoints[currentScene.dies.indexOf(die)];
        tooltip.style.display = 'block';
        tooltip.style.left    = `${e.clientX + 14}px`;
        tooltip.style.top     = `${e.clientY - 8}px`;
        tooltip.innerHTML     = hp?.text ?? `Die (${die.i}, ${die.j})`;
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
            const key = `${d.i},${d.j}`;
            if (selectedKeys.has(key)) selectedKeys.delete(key);
            else selectedKeys.add(key);
          }
        } else {
          selectedKeys = new Set(boxDies.map(d => `${d.i},${d.j}`));
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
    const die = hitTest((cssPx - vp.originX) / vp.ppm, (vp.originY - cssPy) / vp.ppm, vp.snapDist);

    if (die) {
      onClick?.(die, e);
      const key = `${die.i},${die.j}`;
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
      if (d && selectedKeys.has(`${d.i},${d.j}`)) result.push(d);
    }
    return result;
  }

  function onPointerLeave(): void {
    if (tooltip) tooltip.style.display = 'none';
    onHover?.(null, new MouseEvent('mouseleave'));
    canvas.style.cursor = interactMode === 'pan' ? 'grab' : 'crosshair';
  }

  // ── Hit testing ────────────────────────────────────────────────────────────
  function hitTest(mx: number, my: number, snapDist: number): Die | null {
    const pts = currentScene.hoverPoints;
    let bestDie: Die | null = null;
    let bestDist = snapDist * snapDist;
    for (let i = 0; i < pts.length; i++) {
      const dx = pts[i].x - mx, dy = pts[i].y - my;
      const d2 = dx * dx + dy * dy;
      if (d2 < bestDist) { bestDist = d2; bestDie = currentScene.dies[i] ?? null; }
    }
    return bestDie;
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
      selectedKeys = new Set(dies.map(d => `${d.i},${d.j}`));
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

    destroy(): void {
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
      summaryPanelWrapper?.remove();
      autoSummaryPanelWrapper?.remove();
      canvas.style.cursor = '';
    },
  };
}
