import type { PlotMode } from '../renderer/buildScene.js';
import { listColorSchemes, getColorScheme } from '../renderer/colorSchemes.js';
import type { Wafer } from '../core/wafer.js';
import type { Die } from '../core/dies.js';
import { renderWaferMap } from './renderWaferMap.js';
import type { WaferSceneOptions, WaferCanvasController } from './renderWaferMap.js';
import type { BinDef } from '../renderer/buildWaferMap.js';

// ── Public types ───────────────────────────────────────────────────────────────

export interface GalleryItem {
  wafer:     Wafer;
  dies:      Die[];
  label?:    string;
  onClick?:  (die: Die, event: MouseEvent) => void;
  onSelect?: (dies: Die[]) => void;
}

export interface GalleryOptions {
  /** Initial shared scene options applied to all cards. */
  sceneOptions?:         WaferSceneOptions;
  /** Called whenever a shared gallery option changes. */
  onSceneOptionsChange?: (opts: WaferSceneOptions) => void;
  /** Padding inside each card canvas in CSS pixels. Default 6. */
  cardPadding?:          number;
  /** Filename stem for the composite gallery PNG. Default 'wafer-gallery'. */
  downloadFilename?:     string;
  /**
   * Format to use for unitless values outside the normal display range [0.1, 9999].
   * `'engineering'` (default): multiples-of-3 exponent notation (e.g. `12E-6`).
   * `'si'`: SI prefix with no unit suffix (e.g. `12 µ`).
   * Values with a unit always use SI prefix regardless of this setting.
   */
  fallbackFormat?:         'si' | 'engineering';
}

export interface GalleryController {
  /** Replace all items — destroys existing cards and rebuilds the grid. */
  setItems(items: GalleryItem[]): void;
  /** Merge shared scene option overrides across all cards. */
  setOptions(opts: Partial<WaferSceneOptions>): void;
  /** Return the current shared scene options. */
  getOptions(): WaferSceneOptions;
  /** Update the fallback format for unitless values across all cards. */
  setFallbackFormat(format: 'si' | 'engineering'): void;
  /** Remove all DOM and event listeners. */
  destroy(): void;
}

// ── Icon set — Lucide-sourced SVG strings (same as renderWaferMap) ─────────────
const ICONS: Record<string, string> = {
  rotateCW:    `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/></svg>`,
  flipH:       `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m3 7 5 5-5 5V7"/><path d="m21 7-5 5 5 5V7"/><path d="M12 20v2"/><path d="M12 14v2"/><path d="M12 8v2"/><path d="M12 2v2"/></svg>`,
  flipV:       `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m17 3-5 5-5-5h10"/><path d="m17 21-5-5-5 5h10"/><path d="M4 12H2"/><path d="M10 12H8"/><path d="M16 12h-2"/><path d="M22 12h-2"/></svg>`,
  labels:      `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v16"/><path d="M4 7V5a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v2"/><path d="M9 20h6"/></svg>`,
  palette:     `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m14.622 17.897-10.68-2.913"/><path d="M18.376 2.622a1 1 0 1 1 3.002 3.002L17.36 9.643a.5.5 0 0 0 0 .707l.944.944a2.41 2.41 0 0 1 0 3.408l-.944.944a.5.5 0 0 1-.707 0L8.354 7.348a.5.5 0 0 1 0-.707l.944-.944a2.41 2.41 0 0 1 3.408 0l.944.944a.5.5 0 0 0 .707 0z"/><path d="M9 8c-1.804 2.71-3.97 3.46-6.583 3.948a.507.507 0 0 0-.302.819l7.32 8.883a1 1 0 0 0 1.185.204C12.735 20.405 16 16.792 16 15"/></svg>`,
  mode:        `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83z"/><path d="M2 12a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 12"/><path d="M2 17a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 17"/></svg>`,
  // Wafer-specific — no Lucide equivalent
  rings:       `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5.5"/><circle cx="12" cy="12" r="2" fill="currentColor" stroke="none"/></svg>`,
  quadrants:   `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><line x1="12" y1="3" x2="12" y2="21"/><line x1="3" y1="12" x2="21" y2="12"/></svg>`,
  // Gallery download: Lucide Camera + small grid indicator (gallery-specific)
  downloadAll: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M13.997 4a2 2 0 0 1 1.76 1.05l.486.9A2 2 0 0 0 18.003 7H20a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h1.997a2 2 0 0 0 1.759-1.048l.489-.904A2 2 0 0 1 10.004 4z"/><circle cx="12" cy="13" r="3"/><circle cx="5.5" cy="4.5" r="0.8" fill="currentColor" stroke="none"/><circle cx="8" cy="4.5" r="0.8" fill="currentColor" stroke="none"/><circle cx="5.5" cy="7" r="0.8" fill="currentColor" stroke="none"/><circle cx="8" cy="7" r="0.8" fill="currentColor" stroke="none"/></svg>`,
};

const CLR = {
  icon:       '#506784',
  iconHover:  '#2a3f5f',
  iconActive: '#1a66cc',
  bgHover:    '#edf0f8',
  bgActive:   '#dce8f8',
  separator:  'rgba(0,0,0,0.12)',
  menuBg:     '#fff',
  menuBorder: 'rgba(0,0,0,0.12)',
  menuHover:  '#f0f4fc',
  menuActive: '#dce8f8',
};

const BIN_LEGEND_MODES = new Set<PlotMode>(['hardbin', 'softbin']);

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

export function renderWaferGallery(
  container: HTMLElement,
  items: GalleryItem[],
  options: GalleryOptions = {},
): GalleryController {
  const cardPadding      = options.cardPadding      ?? 6;
  const downloadFilename = options.downloadFilename ?? 'wafer-gallery';
  let currentFallbackFormat = options.fallbackFormat;

  let sharedOpts: WaferSceneOptions = {
    plotMode:               'hardbin',
    colorScheme:            'color',
    showText:               false,
    showRingBoundaries:     false,
    showQuadrantBoundaries: false,
    ringCount:              4,
    rotation:               0,
    flipX:                  false,
    flipY:                  false,
    ...options.sceneOptions,
  };

  let cardControllers: WaferCanvasController[] = [];
  let currentItems: GalleryItem[] = [];
  let openMenu: HTMLDivElement | null = null;
  let modalController: WaferCanvasController | null = null;
  let savedBodyOverflow = '';

  // ── Toolbar helpers ────────────────────────────────────────────────────────

  const closeOpenMenu = (e: MouseEvent): void => {
    if (openMenu && !openMenu.contains(e.target as Node)) {
      openMenu.remove();
      openMenu = null;
    }
  };
  document.addEventListener('click', closeOpenMenu, true);

  function makeBtn(iconKey: string, title: string, onClick: () => void): HTMLButtonElement {
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
      transition:     'background 0.12s, color 0.12s',
      flexShrink:     '0',
    });
    btn.addEventListener('mouseenter', () => {
      if (!btn.dataset.active) { btn.style.background = CLR.bgHover; btn.style.color = CLR.iconHover; }
    });
    btn.addEventListener('mouseleave', () => {
      if (!btn.dataset.active) { btn.style.background = 'transparent'; btn.style.color = CLR.icon; }
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

  function makeDropdown<T extends string>(
    iconKey:    string,
    title:      string,
    items:      Array<{ value: T; label: string }>,
    getCurrent: () => T,
    onPick:     (v: T) => void,
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

  // ── Gallery control bar ────────────────────────────────────────────────────

  const barEl = document.createElement('div');
  Object.assign(barEl.style, {
    display:       'flex',
    flexDirection: 'row',
    alignItems:    'center',
    gap:           '0',
    background:    '#fff',
    border:        `1px solid ${CLR.menuBorder}`,
    borderRadius:  '6px',
    padding:       '3px 4px',
    marginBottom:  '10px',
    boxShadow:     '0 1px 4px rgba(0,0,0,0.10)',
    flexWrap:      'wrap',
    minWidth:      '0',
    overflowX:     'auto',
  });

  const btnMode = makeDropdown(
    'mode', 'Plot mode',
    ALL_MODES.map(m => ({ value: m, label: MODE_LABELS[m] })),
    () => sharedOpts.plotMode ?? 'hardbin',
    v => applyShared({ plotMode: v }),
  );

  const btnPalette = makeDropdown(
    'palette', 'Colour scheme',
    listColorSchemes().map(s => ({ value: s.name, label: s.label })),
    () => sharedOpts.colorScheme ?? 'color',
    v => applyShared({ colorScheme: v }),
  );

  const btnRings = makeBtn('rings', 'Toggle ring boundaries', () => {
    applyShared({ showRingBoundaries: !sharedOpts.showRingBoundaries });
    setActive(btnRings, !!sharedOpts.showRingBoundaries);
  });

  const btnQuadrants = makeBtn('quadrants', 'Toggle quadrant boundaries', () => {
    applyShared({ showQuadrantBoundaries: !sharedOpts.showQuadrantBoundaries });
    setActive(btnQuadrants, !!sharedOpts.showQuadrantBoundaries);
  });

  const btnLabels = makeBtn('labels', 'Toggle die labels', () => {
    applyShared({ showText: !sharedOpts.showText });
    setActive(btnLabels, !!sharedOpts.showText);
  });

  const btnRotate = makeBtn('rotateCW', 'Rotate all 90\xB0 clockwise', () => {
    const r = sharedOpts.rotation ?? 0;
    applyShared({ rotation: ROTATIONS[(ROTATIONS.indexOf(r) + 3) % 4] });
  });

  const btnFlipH = makeBtn('flipH', 'Flip all horizontal', () => {
    applyShared({ flipX: !sharedOpts.flipX });
    setActive(btnFlipH, !!sharedOpts.flipX);
  });

  const btnFlipV = makeBtn('flipV', 'Flip all vertical', () => {
    applyShared({ flipY: !sharedOpts.flipY });
    setActive(btnFlipV, !!sharedOpts.flipY);
  });

  const btnDownloadAll = makeBtn('downloadAll', 'Download gallery PNG', downloadGalleryPng);

  barEl.appendChild(btnMode);
  barEl.appendChild(btnPalette);
  barEl.appendChild(makeSep());
  barEl.appendChild(btnRings);
  barEl.appendChild(btnQuadrants);
  barEl.appendChild(btnLabels);
  barEl.appendChild(makeSep());
  barEl.appendChild(btnRotate);
  barEl.appendChild(btnFlipH);
  barEl.appendChild(btnFlipV);
  barEl.appendChild(makeSep());
  barEl.appendChild(btnDownloadAll);

  // Sync initial toggle states.
  setActive(btnRings,     !!sharedOpts.showRingBoundaries);
  setActive(btnQuadrants, !!sharedOpts.showQuadrantBoundaries);
  setActive(btnLabels,    !!sharedOpts.showText);
  setActive(btnFlipH,     !!sharedOpts.flipX);
  setActive(btnFlipV,     !!sharedOpts.flipY);

  // ── Bin legend strip ───────────────────────────────────────────────────────

  const legendEl = document.createElement('div');
  Object.assign(legendEl.style, {
    display:       'flex',
    flexWrap:      'wrap',
    gap:           '6px 14px',
    background:    '#fff',
    border:        `1px solid rgba(0,0,0,0.12)`,
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

  // ── Grid container ─────────────────────────────────────────────────────────

  const gridEl = document.createElement('div');
  Object.assign(gridEl.style, {
    display:                 'grid',
    gridTemplateColumns:     'repeat(auto-fill, minmax(240px, 1fr))',
    gap:                     '12px',
  });

  container.appendChild(barEl);
  container.appendChild(legendEl);
  container.appendChild(gridEl);

  // ── Bin legend ─────────────────────────────────────────────────────────────

  function rebuildLegend(): void {
    legendEl.innerHTML = '';
    const mode = sharedOpts.plotMode ?? 'hardbin';

    if (!BIN_LEGEND_MODES.has(mode)) {
      legendEl.style.display = 'none';
      return;
    }

    // Collect unique bins across all gallery items.
    const binSet = new Set<number>();
    for (const item of currentItems) {
      for (const die of item.dies) {
        if (die.partial) continue;
        if (mode === 'stackedBins') {
          for (const b of die.bins ?? []) binSet.add(b);
        } else {
          const b = die.bins?.[0];
          if (b != null) binSet.add(b);
        }
      }
    }

    const bins = [...binSet].sort((a, b) => a - b);
    if (!bins.length) {
      legendEl.style.display = 'none';
      return;
    }

    legendEl.style.display = 'flex';
    const scheme    = getColorScheme(sharedOpts.colorScheme);
    const activeBin = sharedOpts.highlightBin;
    // Hard and soft bins have independent number spaces — pick the correct defs for the active mode.
    const activeDefs = mode === 'softbin' ? sharedOpts.sbinDefs : sharedOpts.hbinDefs;
    const binDefMap  = activeDefs ? new Map((activeDefs as BinDef[]).map(d => [d.bin, d])) : null;

    for (const bin of bins) {
      const isActive = activeBin === bin;
      const binDef   = binDefMap?.get(bin);
      const entry = document.createElement('div');
      Object.assign(entry.style, {
        display:     'flex',
        alignItems:  'center',
        gap:         '5px',
        cursor:      'pointer',
        userSelect:  'none',
        padding:     '2px 4px',
        borderRadius: '3px',
      });

      const swatch = document.createElement('span');
      Object.assign(swatch.style, {
        display:      'inline-block',
        width:        '13px',
        height:       '13px',
        flexShrink:   '0',
        background:   binDef?.color ?? scheme.forBin(bin),
        border:       isActive ? '2px solid #1a66cc' : '1px solid #ccc',
        borderRadius: '2px',
        boxSizing:    'border-box',
      });

      const lbl = document.createElement('span');
      lbl.textContent = binDef?.name ? `${bin} · ${binDef.name}` : `Bin ${bin}`;
      Object.assign(lbl.style, {
        fontWeight: isActive ? '700' : '400',
        color:      isActive ? CLR.iconActive : '#444',
        whiteSpace: 'nowrap',
      });

      entry.appendChild(swatch);
      entry.appendChild(lbl);

      entry.addEventListener('mouseenter', () => {
        entry.style.background = CLR.bgHover;
      });
      entry.addEventListener('mouseleave', () => {
        entry.style.background = 'transparent';
      });
      entry.addEventListener('click', () => {
        const next = sharedOpts.highlightBin === bin ? undefined : bin;
        applyShared({ highlightBin: next });
      });

      legendEl.appendChild(entry);
    }
  }

  // ── Shared option sync ─────────────────────────────────────────────────────

  // Called from toolbar interactions — updates state, propagates to cards, fires callback.
  function applyShared(partial: Partial<WaferSceneOptions>): void {
    syncShared(partial);
    options.onSceneOptionsChange?.(sharedOpts);
  }

  // Called from the public setOptions API — updates state and cards, does NOT fire callback.
  function syncShared(partial: Partial<WaferSceneOptions>): void {
    sharedOpts = { ...sharedOpts, ...partial };
    for (const ctrl of cardControllers) ctrl.setOptions(partial);
    rebuildLegend();
  }

  // ── Card building ──────────────────────────────────────────────────────────

  function buildCards(newItems: GalleryItem[]): void {
    currentItems = newItems;
    for (const ctrl of cardControllers) ctrl.destroy();
    cardControllers = [];
    gridEl.innerHTML = '';
    rebuildLegend();

    for (const item of newItems) {
      const card = document.createElement('div');
      card.className = 'wmap-gallery-card';
      Object.assign(card.style, {
        background:    '#fff',
        border:        `1px solid #e2e5ea`,
        borderRadius:  '10px',
        overflow:      'hidden',
        display:       'flex',
        flexDirection: 'column',
        position:      'relative',
        cursor:        'pointer',
      });

      const header = document.createElement('div');
      Object.assign(header.style, {
        display:        'flex',
        alignItems:     'center',
        padding:        '8px 10px 6px',
        borderBottom:   '1px solid #e2e5ea',
        flexShrink:     '0',
      });
      const label = document.createElement('span');
      label.textContent = item.label ?? '';
      Object.assign(label.style, { fontWeight: '700', fontSize: '13px' });
      header.appendChild(label);
      card.appendChild(header);

      const canvas = document.createElement('canvas');
      Object.assign(canvas.style, {
        aspectRatio: '1',
        width:       '100%',
        display:     'block',
      });
      card.appendChild(canvas);

      // Append to DOM before renderWaferMap so the canvas has a resolved CSS
      // layout size when the initial render() fires — avoids a zero-size first
      // render that the ResizeObserver would otherwise need to correct.
      gridEl.appendChild(card);

      const ctrl = renderWaferMap(canvas, item.wafer, item.dies, {
        sceneOptions:    sharedOpts,
        toolbarControls: 'view-only',
        showTooltip:     true,
        padding:         cardPadding,
        fallbackFormat:  currentFallbackFormat,
        onClick:         item.onClick,
        onSelect:        item.onSelect,
      });
      cardControllers.push(ctrl);

      // Click on card (but not toolbar) → open modal.
      card.addEventListener('click', (e) => {
        if ((e.target as Element).closest('[data-wmap-toolbar]')) return;
        openModal(item);
      });
    }
  }

  buildCards(items);

  // ── Modal ──────────────────────────────────────────────────────────────────

  function openModal(item: GalleryItem): void {
    if (modalController) closeModal();

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
    Object.assign(box.style, {
      background:    '#fff',
      borderRadius:  '12px',
      overflow:      'hidden',
      display:       'flex',
      flexDirection: 'column',
      width:         'min(90vw, 700px)',
      height:        'min(90vh, 700px)',
      boxShadow:     '0 20px 60px rgba(0,0,0,0.4)',
    });

    const modalHeader = document.createElement('div');
    Object.assign(modalHeader.style, {
      display:       'flex',
      alignItems:    'center',
      padding:       '10px 14px',
      borderBottom:  '1px solid #e2e5ea',
      flexShrink:    '0',
    });
    const modalTitle = document.createElement('span');
    modalTitle.textContent = item.label ?? '';
    Object.assign(modalTitle.style, { fontWeight: '700', fontSize: '14px' });
    const spacer = document.createElement('div');
    spacer.style.flex = '1';
    const closeBtn = document.createElement('button');
    closeBtn.textContent = '\xD7';
    closeBtn.title = 'Close (Esc)';
    Object.assign(closeBtn.style, {
      border:       'none',
      background:   'transparent',
      fontSize:     '20px',
      cursor:       'pointer',
      color:        '#888',
      lineHeight:   '1',
      padding:      '0 2px',
    });
    closeBtn.addEventListener('click', closeModal);
    modalHeader.appendChild(modalTitle);
    modalHeader.appendChild(spacer);
    modalHeader.appendChild(closeBtn);

    const modalCanvasWrap = document.createElement('div');
    Object.assign(modalCanvasWrap.style, {
      flex:     '1',
      minHeight: '0',
      position: 'relative',
    });

    const modalCanvas = document.createElement('canvas');
    Object.assign(modalCanvas.style, {
      width:   '100%',
      height:  '100%',
      display: 'block',
    });

    modalCanvasWrap.appendChild(modalCanvas);
    box.appendChild(modalHeader);
    box.appendChild(modalCanvasWrap);
    backdrop.appendChild(box);
    document.body.appendChild(backdrop);

    modalController = renderWaferMap(modalCanvas, item.wafer, item.dies, {
      sceneOptions:    sharedOpts,
      toolbarControls: 'full',
      showTooltip:     true,
      fallbackFormat:  options.fallbackFormat,
      onClick:         item.onClick,
      onSelect:        item.onSelect,
    });

    // Close on backdrop click (not box).
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) closeModal();
    });

    document.addEventListener('keydown', onModalKeyDown);
  }

  function onModalKeyDown(e: KeyboardEvent): void {
    if (e.key === 'Escape') closeModal();
  }

  function closeModal(): void {
    if (!modalController) return;
    modalController.destroy();
    modalController = null;
    document.getElementById('wmap-modal-backdrop')?.remove();
    document.body.style.overflow = savedBodyOverflow;
    document.removeEventListener('keydown', onModalKeyDown);
  }

  // ── Gallery PNG download ───────────────────────────────────────────────────

  function downloadGalleryPng(): void {
    const canvases = [...gridEl.querySelectorAll<HTMLCanvasElement>('canvas')];
    if (!canvases.length) return;
    const N     = canvases.length;
    const cols  = Math.ceil(Math.sqrt(N));
    const rows  = Math.ceil(N / cols);
    const cellW = canvases[0].width;
    const cellH = canvases[0].height;
    const gap   = 8;
    const off   = document.createElement('canvas');
    off.width   = cols * cellW + (cols - 1) * gap;
    off.height  = rows * cellH + (rows - 1) * gap;
    const ctx   = off.getContext('2d')!;
    ctx.fillStyle = '#f0f2f5';
    ctx.fillRect(0, 0, off.width, off.height);
    canvases.forEach((c, i) => {
      ctx.drawImage(c, (i % cols) * (cellW + gap), Math.floor(i / cols) * (cellH + gap));
    });
    off.toBlob(blob => {
      if (!blob) return;
      const a = Object.assign(document.createElement('a'), {
        href:     URL.createObjectURL(blob),
        download: `${downloadFilename}.png`,
      });
      a.click();
      URL.revokeObjectURL(a.href);
    });
  }

  // ── Controller ─────────────────────────────────────────────────────────────

  return {
    setItems(newItems: GalleryItem[]): void {
      buildCards(newItems);
    },

    setOptions(partial: Partial<WaferSceneOptions>): void {
      syncShared(partial);
    },

    getOptions(): WaferSceneOptions {
      return { ...sharedOpts };
    },

    setFallbackFormat(format: 'si' | 'engineering'): void {
      currentFallbackFormat = format;
      for (const ctrl of cardControllers) ctrl.setFallbackFormat(format);
    },

    destroy(): void {
      closeModal();
      for (const ctrl of cardControllers) ctrl.destroy();
      cardControllers = [];
      openMenu?.remove();
      document.removeEventListener('click', closeOpenMenu, true);
      barEl.remove();
      legendEl.remove();
      gridEl.remove();
    },
  };
}
