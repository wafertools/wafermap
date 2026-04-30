import type { Scene, SceneOptions, PlotMode } from '../renderer/buildScene.js';
import { buildScene } from '../renderer/buildScene.js';
import { listColorSchemes } from '../renderer/colorSchemes.js';
import type { Wafer } from '../core/wafer.js';
import type { Die } from '../core/dies.js';
import { toCanvas, type ToCanvasOptions, type ViewportTransform, type BinLegendRow } from './toCanvas.js';
import type { TestDef, BinDef } from '../renderer/buildWaferMap.js';

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
  /**
   * Which `bins[]` index to display in `hardbin` / `softbin` plot modes. Default `0`.
   */
  binIndex?:               number;
  /** Named test definitions — one per `values[]` entry. Shown in mode dropdown and tooltip. */
  testDefs?:               TestDef[];
  /** Named hard bin definitions — one per distinct `bins[0]` value. Independent number space from soft bins. */
  hbinDefs?:               BinDef[];
  /** Named soft bin definitions — one per distinct `bins[1]` value. Independent number space from hard bins. */
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
}

export interface MountOptions extends Omit<ToCanvasOptions, '_viewport'> {
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
  /**
   * 'full' (default) shows all toolbar controls.
   * 'view-only' shows only zoom, reset, box-select, and download — used by gallery cards.
   */
  toolbarControls?: 'full' | 'view-only';
  /** Minimum zoom relative to fit. Default 0.5. */
  minZoom?: number;
  /** Maximum zoom relative to fit. Default 20. */
  maxZoom?: number;
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
  resetView(): void;
  /** Update the fallback format for unitless values and re-render. */
  setFallbackFormat(format: 'si' | 'engineering'): void;
  /** Remove all event listeners and DOM elements. */
  destroy(): void;
}

// ── Icons ─────────────────────────────────────────────────────────────────────
const ICONS: Record<string, string> = {
  download:  `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M13.997 4a2 2 0 0 1 1.76 1.05l.486.9A2 2 0 0 0 18.003 7H20a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h1.997a2 2 0 0 0 1.759-1.048l.489-.904A2 2 0 0 1 10.004 4z"/><circle cx="12" cy="13" r="3"/></svg>`,
  zoomMode:  `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m13 13.5 2-2.5-2-2.5"/><path d="m21 21-4.3-4.3"/><path d="M9 8.5 7 11l2 2.5"/><circle cx="11" cy="11" r="8"/></svg>`,
  pan:       `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v20"/><path d="m15 19-3 3-3-3"/><path d="m19 9 3 3-3 3"/><path d="M2 12h20"/><path d="m5 9-3 3 3 3"/><path d="m9 5 3-3 3 3"/></svg>`,
  zoomIn:    `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" x2="16.65" y1="21" y2="16.65"/><line x1="11" x2="11" y1="8" y2="14"/><line x1="8" x2="14" y1="11" y2="11"/></svg>`,
  zoomOut:   `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" x2="16.65" y1="21" y2="16.65"/><line x1="8" x2="14" y1="11" y2="11"/></svg>`,
  reset:     `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8"/><path d="M3 10a2 2 0 0 1 .709-1.528l7-6a2 2 0 0 1 2.582 0l7 6A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>`,
  boxSelect: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 3a2 2 0 0 0-2 2"/><path d="M19 3a2 2 0 0 1 2 2"/><path d="M21 19a2 2 0 0 1-2 2"/><path d="M5 21a2 2 0 0 1-2-2"/><path d="M9 3h1"/><path d="M9 21h1"/><path d="M14 3h1"/><path d="M14 21h1"/><path d="M3 9v1"/><path d="M21 9v1"/><path d="M3 14v1"/><path d="M21 14v1"/></svg>`,
  rotateCW:  `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/></svg>`,
  flipH:     `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m3 7 5 5-5 5V7"/><path d="m21 7-5 5 5 5V7"/><path d="M12 20v2"/><path d="M12 14v2"/><path d="M12 8v2"/><path d="M12 2v2"/></svg>`,
  flipV:     `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m17 3-5 5-5-5h10"/><path d="m17 21-5-5-5 5h10"/><path d="M4 12H2"/><path d="M10 12H8"/><path d="M16 12h-2"/><path d="M22 12h-2"/></svg>`,
  labels:    `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v16"/><path d="M4 7V5a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v2"/><path d="M9 20h6"/></svg>`,
  palette:   `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m14.622 17.897-10.68-2.913"/><path d="M18.376 2.622a1 1 0 1 1 3.002 3.002L17.36 9.643a.5.5 0 0 0 0 .707l.944.944a2.41 2.41 0 0 1 0 3.408l-.944.944a.5.5 0 0 1-.707 0L8.354 7.348a.5.5 0 0 1 0-.707l.944-.944a2.41 2.41 0 0 1 3.408 0l.944.944a.5.5 0 0 0 .707 0z"/><path d="M9 8c-1.804 2.71-3.97 3.46-6.583 3.948a.507.507 0 0 0-.302.819l7.32 8.883a1 1 0 0 0 1.185.204C12.735 20.405 16 16.792 16 15"/></svg>`,
  mode:      `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83z"/><path d="M2 12a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 12"/><path d="M2 17a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 17"/></svg>`,
  // Wafer-specific — no Lucide equivalent
  rings:     `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5.5"/><circle cx="12" cy="12" r="2" fill="currentColor" stroke="none"/></svg>`,
  quadrants: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><line x1="12" y1="3" x2="12" y2="21"/><line x1="3" y1="12" x2="21" y2="12"/></svg>`,
};

// ── Toolbar colours ───────────────────────────────────────────────────────────
const CLR = {
  icon:        '#506784',
  iconHover:   '#2a3f5f',
  iconActive:  '#1a66cc',
  bgHover:     '#edf0f8',
  bgActive:    '#dce8f8',
  separator:   'rgba(0,0,0,0.12)',
  menuBg:      '#fff',
  menuBorder:  'rgba(0,0,0,0.12)',
  menuHover:   '#f0f4fc',
  menuActive:  '#dce8f8',
};

// ── Plot mode display labels ───────────────────────────────────────────────────
const MODE_LABELS: Record<PlotMode, string> = {
  value:         'Value',
  hardbin:       'Hard Bin',
  softbin:       'Soft Bin',
  stackedValues: 'Stacked Values',
  stackedBins:   'Stacked Bins',
};
const ALL_MODES: PlotMode[] = ['value', 'hardbin', 'softbin', 'stackedValues', 'stackedBins'];
const ROTATIONS: Array<0 | 90 | 180 | 270> = [0, 90, 180, 270];

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
    showTooltip     = true,
    showToolbar     = true,
    toolbarControls = 'full',
    minZoom         = 0.5,
    maxZoom         = 20,
    sceneOptions: initialSceneOptions = {},
    ...drawOptions
  } = options;

  let currentFallbackFormat = drawOptions.fallbackFormat;

  // ── Mutable state ──────────────────────────────────────────────────────────
  let currentDies     = dies;
  // Selected die keys ("i,j") — key-based so references survive scene rebuilds.
  let selectedKeys    = new Set<string>();
  let sceneOpts: WaferSceneOptions = {
    plotMode:               'hardbin',
    colorScheme:            'color',
    showText:               false,
    showRingBoundaries:     false,
    showQuadrantBoundaries: false,
    ringCount:              4,
    rotation:               0,
    flipX:                  false,
    flipY:                  false,
    ...initialSceneOptions,
  };

  let currentScene:   Scene;
  let fittedViewport: ViewportTransform | null = null;
  let viewport:       ViewportTransform | null = null;
  let binLegendRows:  BinLegendRow[] = [];
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
      ringCount:              so.ringCount,
      highlightBin:           so.highlightBin,
      testIndex:              so.testIndex,
      binIndex:               so.binIndex,
      testDefs:               so.testDefs,
      hbinDefs:               so.hbinDefs,
      sbinDefs:               so.sbinDefs,
      valueRange:             so.valueRange,
      aggrMethod:             so.aggrMethod,
      lotSize:                so.lotSize,
      fallbackFormat:         currentFallbackFormat,
      interactiveTransform: {
        rotation: so.rotation ?? 0,
        flipX:    so.flipX   ?? false,
        flipY:    so.flipY   ?? false,
      },
    } satisfies SceneOptions);
  }

  rebuildScene();

  // ── Tooltip ────────────────────────────────────────────────────────────────
  let tooltip: HTMLDivElement | null = null;
  if (showTooltip) {
    tooltip = document.createElement('div');
    Object.assign(tooltip.style, {
      position:     'fixed',
      pointerEvents:'none',
      background:   'rgba(20,20,30,0.88)',
      color:        '#f0f0f0',
      padding:      '6px 10px',
      borderRadius: '5px',
      fontSize:     '11px',
      lineHeight:   '1.5',
      maxWidth:     '220px',
      whiteSpace:   'pre-wrap',
      zIndex:       '9999',
      display:      'none',
      fontFamily:   'system-ui, sans-serif',
      boxShadow:    '0 2px 8px rgba(0,0,0,0.35)',
    });
    document.body.appendChild(tooltip);
  }

  // ── Toolbar ────────────────────────────────────────────────────────────────
  let toolbar:      HTMLDivElement    | null = null;
  let btnBoxSelect: HTMLButtonElement | null = null;
  let hideTimer: ReturnType<typeof setTimeout> | null = null;

  // Track open dropdown so we can close it when another opens.
  let openMenu: HTMLDivElement | null = null;

  const closeOpenMenu = (e: MouseEvent): void => {
    if (openMenu && !openMenu.contains(e.target as Node)) {
      openMenu.remove();
      openMenu = null;
    }
  };

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

      // ── Button factory ───────────────────────────────────────────────────
      function makeBtn(
        iconKey: string,
        title: string,
        onClick: () => void,
      ): HTMLButtonElement {
        const btn = document.createElement('button');
        btn.title     = title;
        btn.innerHTML = ICONS[iconKey];
        btn.type      = 'button';
        Object.assign(btn.style, {
          display:        'flex',
          alignItems:     'center',
          justifyContent: 'center',
          width:          '28px',
          height:         '28px',
          padding:        '0',
          border:         'none',
          borderRadius:   '3px',
          background:     'transparent',
          color:          CLR.icon,
          cursor:         'pointer',
          pointerEvents:  'auto',
          transition:     'background 0.12s, color 0.12s',
          flexShrink:     '0',
        });
        btn.addEventListener('mouseenter', () => {
          if (!btn.dataset.active) {
            btn.style.background = CLR.bgHover;
            btn.style.color      = CLR.iconHover;
          }
        });
        btn.addEventListener('mouseleave', () => {
          if (!btn.dataset.active) {
            btn.style.background = 'transparent';
            btn.style.color      = CLR.icon;
          }
        });
        btn.addEventListener('click', onClick);
        return btn;
      }

      function setActive(btn: HTMLButtonElement, active: boolean): void {
        if (active) {
          btn.dataset.active   = '1';
          btn.style.background = CLR.bgActive;
          btn.style.color      = CLR.iconActive;
        } else {
          delete btn.dataset.active;
          btn.style.background = 'transparent';
          btn.style.color      = CLR.icon;
        }
      }

      // ── Separator ────────────────────────────────────────────────────────
      function makeSep(): HTMLDivElement {
        const sep = document.createElement('div');
        Object.assign(sep.style, {
          width:      '1px',
          height:     '18px',
          background: CLR.separator,
          margin:     '0 2px',
          flexShrink: '0',
        });
        return sep;
      }

      // Single persistent listener — closes any open dropdown on outside click.
      document.addEventListener('click', closeOpenMenu, true);

      // ── Dropdown menu factory ────────────────────────────────────────────
      // Menus are appended to document.body with position:fixed so they never
      // affect document layout or cause the page to shift.
      function makeDropdown<T extends string>(
        iconKey:  string,
        title:    string,
        items:    Array<{ value: T; label: string }>,
        getCurrent: () => T,
        onPick:   (v: T) => void,
      ): HTMLButtonElement {
        const btn = makeBtn(iconKey, title, () => {
          if (openMenu) { openMenu.remove(); openMenu = null; return; }

          const menu = document.createElement('div');
          const btnRect = btn.getBoundingClientRect();
          Object.assign(menu.style, {
            position:      'fixed',
            top:           `${btnRect.bottom + 4}px`,
            left:          `${btnRect.left}px`,
            background:    CLR.menuBg,
            border:        `1px solid ${CLR.menuBorder}`,
            borderRadius:  '4px',
            boxShadow:     '0 4px 12px rgba(0,0,0,0.15)',
            zIndex:        '9998',
            minWidth:      '148px',
            padding:       '4px 0',
            pointerEvents: 'auto',
          });

          for (const item of items) {
            const row = document.createElement('div');
            row.textContent = item.label;
            const isActive = item.value === getCurrent();
            Object.assign(row.style, {
              padding:    '6px 14px',
              fontSize:   '12px',
              cursor:     'pointer',
              color:      isActive ? CLR.iconActive : '#333',
              fontWeight: isActive ? '700' : '400',
              background: isActive ? CLR.menuActive : 'transparent',
              whiteSpace: 'nowrap',
            });
            row.addEventListener('mouseenter', () => {
              if (item.value !== getCurrent()) row.style.background = CLR.menuHover;
            });
            row.addEventListener('mouseleave', () => {
              row.style.background = item.value === getCurrent() ? CLR.menuActive : 'transparent';
            });
            row.addEventListener('click', e => {
              e.stopPropagation();
              onPick(item.value);
              menu.remove();
              openMenu = null;
            });
            menu.appendChild(row);
          }

          document.body.appendChild(menu);
          openMenu = menu;
        });

        return btn;
      }

      // ── Wire up toolbar buttons ──────────────────────────────────────────

      // Interaction mode: zoom-region | pan | select — mutually exclusive
      function setInteractMode(mode: 'pan' | 'zoom' | 'select'): void {
        interactMode = mode;
        setActive(btnZoomMode, mode === 'zoom');
        setActive(btnPanMode,  mode === 'pan');
        if (btnBoxSelect) setActive(btnBoxSelect, mode === 'select');
        canvas.style.cursor = mode === 'pan' ? 'grab' : 'crosshair';
      }

      // ── Order matches Plotly modebar: camera | sep | zoom | pan | [select] | zoom+ | zoom− | reset | sep | scene controls ──

      // Camera first — leftmost, matching Plotly
      const btnDownload = makeBtn('download', 'Download PNG', downloadPng);
      toolbar.appendChild(btnDownload);
      toolbar.appendChild(makeSep());

      // Navigation mode group
      const btnZoomMode = makeBtn('zoomMode', 'Zoom (drag to zoom region)', () => setInteractMode('zoom'));
      const btnPanMode  = makeBtn('pan',      'Pan (drag to move)',          () => setInteractMode('pan'));
      toolbar.appendChild(btnZoomMode);
      toolbar.appendChild(btnPanMode);

      if (onSelect) {
        btnBoxSelect = makeBtn('boxSelect', 'Select (drag to select dies)', () => setInteractMode('select'));
        toolbar.appendChild(btnBoxSelect);
      }

      // Zoom +/− and reset
      const btnZoomIn  = makeBtn('zoomIn',  'Zoom in',                    () => zoomAt(canvas.clientWidth / 2, canvas.clientHeight / 2, 1.5));
      const btnZoomOut = makeBtn('zoomOut', 'Zoom out',                   () => zoomAt(canvas.clientWidth / 2, canvas.clientHeight / 2, 1 / 1.5));
      const btnReset   = makeBtn('reset',   'Reset view (double-click)',   () => resetView());
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
          if (e.plotMode !== (sceneOpts.plotMode ?? 'hardbin')) return false;
          if (e.plotMode === 'value') return (sceneOpts.testIndex ?? 0) === (e.testIndex ?? 0);
          return true;
        }

        const btnMode = makeBtn('mode', 'Plot mode', () => {
          if (openMenu) { openMenu.remove(); openMenu = null; return; }

          const testDefs = currentScene.testDefs;
          const entries: ModeEntry[] = testDefs?.length
            ? testDefs.map(t => ({ plotMode: 'value' as PlotMode, testIndex: t.index, label: t.unit ? `${t.name} (${t.unit})` : t.name }))
            : [{ plotMode: 'value' as PlotMode, label: MODE_LABELS.value }];
          entries.push(
            { plotMode: 'hardbin',       label: MODE_LABELS.hardbin },
            { plotMode: 'softbin',       label: MODE_LABELS.softbin },
            { plotMode: 'stackedValues', label: MODE_LABELS.stackedValues },
            { plotMode: 'stackedBins',   label: MODE_LABELS.stackedBins },
          );

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
            minWidth:      '160px',
            padding:       '4px 0',
            pointerEvents: 'auto',
          });

          for (const entry of entries) {
            const row = document.createElement('div');
            row.textContent = entry.label;
            const active = isCurrentEntry(entry);
            Object.assign(row.style, {
              padding:    '6px 14px',
              fontSize:   '12px',
              cursor:     'pointer',
              color:      active ? CLR.iconActive : '#333',
              fontWeight: active ? '700' : '400',
              background: active ? CLR.menuActive : 'transparent',
              whiteSpace: 'nowrap',
            });
            row.addEventListener('mouseenter', () => {
              if (!isCurrentEntry(entry)) row.style.background = CLR.menuHover;
            });
            row.addEventListener('mouseleave', () => {
              row.style.background = isCurrentEntry(entry) ? CLR.menuActive : 'transparent';
            });
            row.addEventListener('click', e => {
              e.stopPropagation();
              if (entry.testIndex !== undefined) {
                applyOpts({ plotMode: 'value', testIndex: entry.testIndex });
              } else {
                applyOpts({ plotMode: entry.plotMode, testIndex: undefined });
              }
              menu.remove();
              openMenu = null;
            });
            menu.appendChild(row);
          }

          document.body.appendChild(menu);
          openMenu = menu;
        });
        const btnPalette = makeDropdown(
          'palette', 'Colour scheme',
          listColorSchemes().map(s => ({ value: s.name, label: s.label })),
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

        toolbar.appendChild(btnMode);
        toolbar.appendChild(btnPalette);
        toolbar.appendChild(makeSep());
        toolbar.appendChild(btnRings);
        toolbar.appendChild(btnQuadrants);
        toolbar.appendChild(btnLabels);
        toolbar.appendChild(makeSep());
        toolbar.appendChild(btnRotate);
        toolbar.appendChild(btnFlipH);
        toolbar.appendChild(btnFlipV);

        setActive(btnRings,     !!sceneOpts.showRingBoundaries);
        setActive(btnQuadrants, !!sceneOpts.showQuadrantBoundaries);
        setActive(btnLabels,    !!sceneOpts.showText);
        setActive(btnFlipH,     !!sceneOpts.flipX);
        setActive(btnFlipV,     !!sceneOpts.flipY);
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
  function applyOpts(partial: Partial<WaferSceneOptions>): void {
    sceneOpts = { ...sceneOpts, ...partial };
    rebuildScene();
    render();
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
      diePitchMm,
      fallbackFormat: currentFallbackFormat,
      showAxes:  drawOptions.showAxes ?? (viewport !== null),
      _viewport: vp,
      _activeBin: sceneOpts.highlightBin,
    });

    binLegendRows = result.binLegendRows;

    if (!fittedViewport || !viewport) {
      fittedViewport = result.viewport;
      if (!viewport) viewport = null;
    }

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

      // Semi-transparent blue fill over the die.
      ctx.fillStyle = 'rgba(30,120,255,0.25)';
      ctx.fillRect(sx - hw, sy - hh, hw * 2, hh * 2);

      // White outer stroke for contrast on dark dies.
      ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      ctx.lineWidth   = 2.5;
      ctx.strokeRect(sx - hw, sy - hh, hw * 2, hh * 2);

      // Blue inner stroke — the selection colour.
      ctx.strokeStyle = 'rgba(30,120,255,1)';
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

  function onPointerDown(e: PointerEvent): void {
    if (e.button !== 0) return;
    if (!currentViewport()) return;
    canvas.focus({ preventScroll: true });
    canvas.setPointerCapture(e.pointerId);
    const rect = canvas.getBoundingClientRect();
    const px   = e.clientX - rect.left;
    const py   = e.clientY - rect.top;
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
        if (onSelect) onSelect(selectionAsDies());
      }
      render();
      canvas.style.cursor = 'crosshair';
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
      if (cssPy >= row.y && cssPy < row.y + row.h) {
        const next = sceneOpts.highlightBin === row.bin ? undefined : row.bin;
        applyOpts({ highlightBin: next });
        return;
      }
    }

    const vp = currentViewport();
    if (!vp) return;
    const die = hitTest((cssPx - vp.originX) / vp.ppm, (vp.originY - cssPy) / vp.ppm, vp.snapDist);

    if (die) {
      onClick?.(die, e);
      if (onSelect) {
        const key = `${die.i},${die.j}`;
        if (multi) {
          // Toggle this die.
          if (selectedKeys.has(key)) selectedKeys.delete(key);
          else selectedKeys.add(key);
        } else {
          // Replace selection with just this die.
          selectedKeys = new Set([key]);
        }
        onSelect(selectionAsDies());
        render();
      }
    } else if (!multi && onSelect) {
      // Click on empty space clears selection.
      selectedKeys = new Set();
      onSelect([]);
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
  canvas.addEventListener('dblclick',     () => resetView());
  canvas.addEventListener('keydown',      onKeyDown);

  // ── Initial render ─────────────────────────────────────────────────────────
  render();

  // ── Controller ─────────────────────────────────────────────────────────────
  function resetView(): void {
    fittedViewport = null;
    viewport = null;
    render();
  }

  return {
    setDies(newDies: Die[]): void {
      currentDies = newDies;
      rebuildScene();
      render();
    },

    setOptions(partial: Partial<WaferSceneOptions>): void {
      applyOpts(partial);
    },

    getOptions(): WaferSceneOptions {
      return { ...sceneOpts };
    },

    resetView,

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

    destroy(): void {
      if (hideTimer) clearTimeout(hideTimer);
      openMenu?.remove();
      document.removeEventListener('click', closeOpenMenu, true);
      canvas.removeEventListener('wheel',        onWheel);
      canvas.removeEventListener('pointerdown',  onPointerDown);
      canvas.removeEventListener('pointermove',  onPointerMove);
      canvas.removeEventListener('pointerup',    onPointerUp);
      canvas.removeEventListener('pointerleave', onPointerLeave);
      canvas.removeEventListener('dblclick',     resetView);
      canvas.removeEventListener('keydown',      onKeyDown);
      resizeObserver.disconnect();
      tooltip?.remove();
      toolbar?.remove();
      canvas.style.cursor = '';
    },
  };
}
