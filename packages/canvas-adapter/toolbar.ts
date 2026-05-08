// ── Shared toolbar utilities ───────────────────────────────────────────────────
// Internal module. Do not re-export from index.ts.

import type { PlotMode } from '../renderer/buildScene.js';
import { ICONS } from './icons.js';

// ── Colours ────────────────────────────────────────────────────────────────────

export const CLR = {
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

// ── Constants ──────────────────────────────────────────────────────────────────

export const ROTATIONS: Array<0 | 90 | 180 | 270> = [0, 90, 180, 270];

export const INLINE_TEST_LIMIT = 6;

export const MODE_LABELS: Record<PlotMode, string> = {
  value:           'Test Value',
  hardBin:         'Hard Bin',
  softBin:         'Soft Bin',
  stackedValues:   'Stacked Test Values',
  stackedBins:     'Stacked Hard Bins',
  stackedSoftBins: 'Stacked Soft Bins',
};

export const BIN_LEGEND_MODES = new Set<PlotMode>(['hardBin', 'softBin']);
export const STACKED_MODES    = new Set<PlotMode>(['stackedValues', 'stackedBins', 'stackedSoftBins']);

// ── Tooltip ────────────────────────────────────────────────────────────────────

export function createTooltip(): HTMLDivElement {
  const el = document.createElement('div');
  Object.assign(el.style, {
    position:     'fixed',
    pointerEvents:'none',
    background:   'rgba(45, 45, 55, 0.88)',
    color:        '#f7f7f7',
    padding:      '6px 10px',
    borderRadius: '5px',
    fontSize:     '12px',
    lineHeight:   '1.5',
    maxWidth:     '220px',
    marginTop:    '4px',
    whiteSpace:   'pre-wrap',
    zIndex:       '9999',
    display:      'none',
    fontFamily:   'system-ui, sans-serif',
    boxShadow:    '0 2px 8px rgba(0,0,0,0.35)',
  });
  document.body.appendChild(el);
  return el;
}

// ── Toolbar factory ────────────────────────────────────────────────────────────
// Returns all helpers closed over shared openMenu state and the tooltip element.

export interface ToolbarHelpers {
  makeBtn(iconKey: string, label: string, onClick: () => void): HTMLButtonElement;
  setActive(btn: HTMLButtonElement, active: boolean): void;
  makeSep(): HTMLDivElement;
  makeMenuRow(label: string, active: boolean, indent: boolean, onClick: (e: MouseEvent) => void): HTMLDivElement;
  makeMenuSection(label: string): HTMLDivElement;
  makeDropdown<T extends string>(
    iconKey: string,
    title: string,
    getItems: () => Array<{ value: T; label: string }>,
    getCurrent: () => T,
    onPick: (v: T) => void,
  ): HTMLButtonElement;
  closeOpenMenu(e: MouseEvent): void;
  /** Read/write the shared open-menu slot — used by custom menus that can't go through makeDropdown. */
  getOpenMenu(): HTMLDivElement | null;
  setOpenMenu(menu: HTMLDivElement | null): void;
}

export function createToolbarHelpers(tooltip: HTMLDivElement): ToolbarHelpers {
  let openMenu: HTMLDivElement | null = null;

  function makeBtn(iconKey: string, label: string, onClick: () => void): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.innerHTML    = ICONS[iconKey];
    btn.type         = 'button';
    btn.ariaLabel    = label;
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
    function positionTooltip(clientX: number, clientY: number): void {
      tooltip.style.left = '0';
      tooltip.style.top  = '0';
      const tw = tooltip.offsetWidth;
      const th = tooltip.offsetHeight;
      const margin = 8;
      let x = clientX + 14;
      let y = clientY - 8;
      if (x + tw + margin > window.innerWidth)  x = clientX - tw - 6;
      if (y + th + margin > window.innerHeight) y = window.innerHeight - th - margin;
      if (y < margin) y = margin;
      tooltip.style.left = `${x}px`;
      tooltip.style.top  = `${y}px`;
    }
    btn.addEventListener('mouseenter', (e) => {
      if (!btn.dataset.active) {
        btn.style.background = CLR.bgHover;
        btn.style.color      = CLR.iconHover;
      }
      tooltip.innerHTML     = label;
      tooltip.style.display = 'block';
      positionTooltip(e.clientX, e.clientY);
    });
    btn.addEventListener('mousemove', (e) => {
      if (tooltip.style.display === 'block') positionTooltip(e.clientX, e.clientY);
    });
    btn.addEventListener('mouseleave', () => {
      if (!btn.dataset.active) {
        btn.style.background = 'transparent';
        btn.style.color      = CLR.icon;
      }
      tooltip.style.display = 'none';
    });
    btn.addEventListener('click', () => {
      tooltip.style.display = 'none';
      onClick();
    });
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

  function makeMenuRow(label: string, active: boolean, indent: boolean, onClick: (e: MouseEvent) => void): HTMLDivElement {
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

  function makeDropdown<T extends string>(
    iconKey: string,
    title: string,
    getItems: () => Array<{ value: T; label: string }>,
    getCurrent: () => T,
    onPick: (v: T) => void,
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
      for (const item of getItems()) {
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

  function closeOpenMenu(e: MouseEvent): void {
    if (openMenu && !openMenu.contains(e.target as Node)) {
      openMenu.remove();
      openMenu = null;
    }
  }

  return {
    makeBtn, setActive, makeSep, makeMenuRow, makeMenuSection, makeDropdown, closeOpenMenu,
    getOpenMenu: () => openMenu,
    setOpenMenu: (m) => { openMenu = m; },
  };
}
