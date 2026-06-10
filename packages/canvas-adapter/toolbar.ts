// ── Shared toolbar utilities ───────────────────────────────────────────────────
// Internal module. Do not re-export from index.ts.

import type { PlotMode } from '../renderer/buildView.js';
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

// ── Image save ───────────────────────────────────────────────────────────────

/**
 * Host hook for persisting a rendered PNG. When supplied, the toolbar calls this
 * instead of triggering a browser `<a download>`, letting embedded hosts (Tauri,
 * Electron, WebView2) route the blob through a native save dialog or upload.
 * Receives the PNG `blob` and a `suggestedName` (already includes `.png`).
 */
export type SaveImageHandler = (blob: Blob, suggestedName: string) => void | Promise<void>;

/**
 * Persist a rendered PNG blob. Routes through the host `onSaveImage` hook when
 * provided; otherwise falls back to a browser `<a download>` click. Single
 * source of truth for the save action across `renderWaferMap` and
 * `renderWaferGallery` — neither should reimplement the `<a download>` dance.
 *
 * @param blob          the PNG blob (e.g. from `canvas.toBlob`)
 * @param filename      filename without extension (e.g. `'wafermap'`)
 * @param onSaveImage   optional host hook; when present, bypasses `<a download>`
 */
export function saveImageBlob(blob: Blob, filename: string, onSaveImage?: SaveImageHandler): void {
  const suggestedName = `${filename}.png`;
  if (onSaveImage) {
    void onSaveImage(blob, suggestedName);
    return;
  }
  const url = URL.createObjectURL(blob);
  const a   = document.createElement('a');
  a.href = url;
  a.download = suggestedName;
  a.click();
  URL.revokeObjectURL(url);
}

// ── Accessibility ──────────────────────────────────────────────────────────────
//
// Toolbar buttons already carry `ariaLabel` (see makeBtn). Deliberately NO `title`
// attribute on toolbar buttons — it duplicates the custom hover tooltip. The
// helpers below add the menu/menuitem semantics and keyboard navigation that
// `aria-label` alone cannot provide, without rendering any native tooltip.

/** Selector matching every focusable menu item within a menu container. */
const MENU_ITEM_SELECTOR = '[role="menuitem"],[role="menuitemradio"],[role="menuitemcheckbox"]';

/**
 * Run `fn` on the next animation frame, falling back to a macrotask in
 * environments without `requestAnimationFrame` (e.g. JSDOM under tests).
 * Used to defer focus moves until the element is laid out.
 */
function nextFrame(fn: () => void): void {
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(fn);
  else setTimeout(fn, 0);
}

/**
 * Tag a menu container and its rows with ARIA roles and make rows keyboard
 * focusable. `roleForRow` returns the per-row role; rows are skipped (left as
 * presentational section headers) when it returns `null`.
 */
function applyMenuRoles(
  menu: HTMLElement,
  label: string,
  roleForRow: (row: HTMLElement) => 'menuitemradio' | 'menuitemcheckbox' | 'menuitem' | null,
): void {
  menu.setAttribute('role', 'menu');
  menu.setAttribute('aria-label', label);
  for (const child of Array.from(menu.children) as HTMLElement[]) {
    const role = roleForRow(child);
    if (!role) continue;
    child.setAttribute('role', role);
    child.tabIndex = -1;
  }
}

/**
 * Wire roving-focus keyboard navigation onto an already-roled menu:
 * ArrowUp/Down move between items, Home/End jump to ends, Enter/Space activate
 * the focused item, Escape (or Tab) closes the menu and returns focus to the
 * trigger. `close` should remove the menu and clear any open-menu bookkeeping.
 * Focus moves to the first item on open. Returns nothing; the listener lives on
 * the menu element and dies with it.
 */
function wireMenuKeyboard(menu: HTMLElement, trigger: HTMLElement | null, close: () => void): void {
  const items = (): HTMLElement[] => Array.from(menu.querySelectorAll<HTMLElement>(MENU_ITEM_SELECTOR));

  menu.addEventListener('keydown', (e: KeyboardEvent) => {
    const list = items();
    if (list.length === 0) return;
    const current = document.activeElement as HTMLElement | null;
    const idx = current ? list.indexOf(current) : -1;

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        list[idx < 0 || idx === list.length - 1 ? 0 : idx + 1].focus();
        break;
      case 'ArrowUp':
        e.preventDefault();
        list[idx <= 0 ? list.length - 1 : idx - 1].focus();
        break;
      case 'Home':
        e.preventDefault();
        list[0].focus();
        break;
      case 'End':
        e.preventDefault();
        list[list.length - 1].focus();
        break;
      case 'Enter':
      case ' ':
        if (idx >= 0) { e.preventDefault(); list[idx].click(); }
        break;
      case 'Escape':
      case 'Tab':
        e.preventDefault();
        close();
        trigger?.focus();
        break;
    }
  });

  // Move focus into the menu so arrow keys work immediately on open.
  const first = items()[0];
  if (first) nextFrame(() => first.focus());
}

// Menus must be appended inside the fullscreen element or the nearest modal box,
// not document.body — both create stacking contexts that would obscure body-level menus.
export function menuRootFor(anchor: Element): Element {
  if (document.fullscreenElement) return document.fullscreenElement;
  let el: Element | null = anchor;
  while (el) {
    if (el.classList.contains('wmap-modal-box')) return el;
    el = el.parentElement;
  }
  return document.body;
}

// ── Tooltip ────────────────────────────────────────────────────────────────────

export function createTooltip(): HTMLDivElement {
  const el = document.createElement('div');
  Object.assign(el.style, {
    position:     'fixed',
    pointerEvents:'none',
    background:   'rgba(30, 32, 40, 0.93)',
    color:        '#f0f0f2',
    border:       '1px solid rgba(255,255,255,0.10)',
    padding:      '7px 11px',
    borderRadius: '5px',
    fontSize:     '13px',
    lineHeight:   '1.55',
    maxWidth:     '280px',
    whiteSpace:   'pre-wrap',
    zIndex:       'calc(var(--wmap-z, 100) + 1)',
    display:      'none',
    fontFamily:   'system-ui, sans-serif',
    boxShadow:    '0 3px 10px rgba(0,0,0,0.45)',
  });
  document.body.appendChild(el);
  return el;
}

export function positionTooltip(tooltip: HTMLDivElement, clientX: number, clientY: number): void {
  tooltip.style.left = '0';
  tooltip.style.top  = '0';
  const tw     = tooltip.offsetWidth;
  const th     = tooltip.offsetHeight;
  const margin = 8;
  let x = clientX + 14;
  let y = clientY - 8;
  if (x + tw + margin > window.innerWidth)  x = clientX - tw - 6;
  if (y + th + margin > window.innerHeight) y = window.innerHeight - th - margin;
  if (y < margin) y = margin;
  tooltip.style.left = `${x}px`;
  tooltip.style.top  = `${y}px`;
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
  /**
   * Create a button that opens a persistent checkbox-style dropdown menu.
   * `getRows` is called fresh on each open/replace so active state is always current.
   * `onSync` is called after each row click to update the button's active highlight.
   */
  makeCheckMenuBtn(
    iconKey: string,
    label: string,
    getRows: () => CheckMenuRow[],
    onSync: (btn: HTMLButtonElement) => void,
  ): HTMLButtonElement;
  closeOpenMenu(e: MouseEvent): void;
  /** Read/write the shared open-menu slot — used by custom menus that can't go through makeDropdown. */
  getOpenMenu(): HTMLDivElement | null;
  setOpenMenu(menu: HTMLDivElement | null): void;
}

export type ModeEntry = { plotMode: PlotMode; activeTest?: number; label: string; logScale?: boolean };

/**
 * Build the plot-mode dropdown menu element.
 * Shared between renderWaferMap and renderWaferGallery.
 * The caller provides data-derived entry arrays and pick/active callbacks.
 */
export function buildModeMenuEl(
  anchorRect: DOMRect,
  testEntries: ModeEntry[],
  binEntries: ModeEntry[],
  stackedEntries: ModeEntry[],
  isCurrentEntry: (e: ModeEntry) => boolean,
  pickEntry: (entry: ModeEntry, menu: HTMLElement) => void,
  helpers: Pick<ToolbarHelpers, 'makeMenuRow' | 'makeMenuSection'>,
  currentMode: PlotMode,
): HTMLDivElement {
  const { makeMenuRow, makeMenuSection } = helpers;

  const menu = document.createElement('div');
  const modeMinWidth = 180;
  const modeFitsRight = anchorRect.left + modeMinWidth <= (window.innerWidth ?? Infinity);
  const modeLeft = modeFitsRight ? anchorRect.left : Math.max(4, anchorRect.right - modeMinWidth);
  Object.assign(menu.style, {
    position:      'fixed',
    top:           `${anchorRect.bottom + 4}px`,
    left:          `${modeLeft}px`,
    background:    CLR.menuBg,
    border:        `1px solid ${CLR.menuBorder}`,
    borderRadius:  '4px',
    boxShadow:     '0 4px 12px rgba(0,0,0,0.15)',
    zIndex:        'var(--wmap-z, 100)',
    minWidth:      `${modeMinWidth}px`,
    padding:       '4px 0',
    pointerEvents: 'auto',
  });

  // ── Test Value section ──────────────────────────────────────────────────────
  if (testEntries.length) {
    menu.appendChild(makeMenuSection('Test Value'));
    if (testEntries.length <= INLINE_TEST_LIMIT) {
      for (const entry of testEntries) {
        menu.appendChild(makeMenuRow(entry.label, isCurrentEntry(entry), true, e => {
          e.stopPropagation();
          pickEntry(entry, menu);
        }));
      }
    } else {
      const cascadeActive = currentMode === 'value';
      const cascadeRow = makeMenuRow(MODE_LABELS.value + ' ▶', cascadeActive, false, () => {});
      cascadeRow.style.display        = 'flex';
      cascadeRow.style.justifyContent = 'space-between';
      cascadeRow.style.alignItems     = 'center';
      let subMenu: HTMLDivElement | null = null;
      const closeSub = () => { subMenu?.remove(); subMenu = null; };
      const openSub = () => {
        if (subMenu) return;
        const rowRect = cascadeRow.getBoundingClientRect();
        subMenu = document.createElement('div');
        Object.assign(subMenu.style, {
          position:      'fixed',
          top:           `${rowRect.top - 4}px`,
          left:          `${rowRect.right + 2}px`,
          background:    CLR.menuBg,
          border:        `1px solid ${CLR.menuBorder}`,
          borderRadius:  '4px',
          boxShadow:     '0 4px 12px rgba(0,0,0,0.15)',
          zIndex:        'calc(var(--wmap-z, 100) + 1)',
          minWidth:      '160px',
          maxHeight:     '320px',
          overflowY:     'auto',
          padding:       '4px 0',
          pointerEvents: 'auto',
        });
        for (const entry of testEntries) {
          subMenu.appendChild(makeMenuRow(entry.label, isCurrentEntry(entry), false, e => {
            e.stopPropagation();
            subMenu?.remove(); subMenu = null;
            pickEntry(entry, menu);
          }));
        }
        (document.fullscreenElement ?? document.body).appendChild(subMenu);
        document.addEventListener('click', closeSub, { once: true });
      };
      cascadeRow.addEventListener('mouseenter', openSub);
      cascadeRow.addEventListener('mouseleave', e => {
        if (subMenu && subMenu.contains(e.relatedTarget as Node)) return;
        closeSub();
      });
      menu.appendChild(cascadeRow);
    }
  }

  // ── Bins section ────────────────────────────────────────────────────────────
  if (binEntries.length) {
    menu.appendChild(makeMenuSection('Bins'));
    for (const entry of binEntries) {
      menu.appendChild(makeMenuRow(entry.label, isCurrentEntry(entry), false, e => {
        e.stopPropagation();
        pickEntry(entry, menu);
      }));
    }
  }

  // ── Stacked (lot aggregation) section ───────────────────────────────────────
  if (stackedEntries.length) {
    menu.appendChild(makeMenuSection('Lot Aggregation'));
    for (const entry of stackedEntries) {
      menu.appendChild(makeMenuRow(entry.label, isCurrentEntry(entry), false, e => {
        e.stopPropagation();
        pickEntry(entry, menu);
      }));
    }
  }

  menu.setAttribute('role', 'menu');
  menu.setAttribute('aria-label', 'Plot mode');
  return menu;
}

/**
 * Mark a button as a menu trigger and reflect its open/closed state. Call with
 * `expanded` on open/close so assistive tech announces the popup state. Public
 * so the adapters can apply it to mode-menu triggers they mount themselves.
 */
export function markMenuTrigger(btn: HTMLElement, expanded: boolean): void {
  btn.setAttribute('aria-haspopup', 'menu');
  btn.setAttribute('aria-expanded', expanded ? 'true' : 'false');
}

/**
 * Public re-export of the internal roving-focus keyboard wiring, for menus the
 * adapters mount directly (the plot-mode menu). See `wireMenuKeyboard`.
 */
export function wireMenuA11y(menu: HTMLElement, trigger: HTMLElement | null, close: () => void): void {
  wireMenuKeyboard(menu, trigger, close);
}

export type CheckMenuRow =
  | { section: string }
  | { label: string; active: boolean; enabled?: boolean; onClick: (e: MouseEvent) => void };

/**
 * Build a checkbox-style dropdown menu (for overlays/orientation groups).
 * Each row with an `onClick` is a toggleable item; rows with `section` are headers.
 * Stays open after each click so the user can toggle multiple items.
 */
export function buildCheckMenuEl(
  anchorRect: DOMRect,
  rows: CheckMenuRow[],
  helpers: Pick<ToolbarHelpers, 'makeMenuRow' | 'makeMenuSection'>,
): HTMLDivElement {
  const { makeMenuRow, makeMenuSection } = helpers;
  const menu = document.createElement('div');
  const minWidth = 168;
  // Prefer left-aligned; flip to right-aligned when button is near the right edge.
  const fitsRight = anchorRect.left + minWidth <= (window.innerWidth ?? Infinity);
  const leftPx  = fitsRight ? anchorRect.left : Math.max(4, anchorRect.right - minWidth);
  Object.assign(menu.style, {
    position:      'fixed',
    top:           `${anchorRect.bottom + 4}px`,
    left:          `${leftPx}px`,
    background:    CLR.menuBg,
    border:        `1px solid ${CLR.menuBorder}`,
    borderRadius:  '4px',
    boxShadow:     '0 4px 12px rgba(0,0,0,0.15)',
    zIndex:        'var(--wmap-z, 100)',
    minWidth:      `${minWidth}px`,
    padding:       '4px 0',
    pointerEvents: 'auto',
  });
  for (const row of rows) {
    if ('section' in row) {
      menu.appendChild(makeMenuSection(row.section));
    } else {
      const enabled = row.enabled !== false;
      if (!enabled) continue;
      const el = document.createElement('div');
      el.setAttribute('role', 'menuitemcheckbox');
      el.setAttribute('aria-checked', row.active ? 'true' : 'false');
      el.tabIndex = -1;
      Object.assign(el.style, {
        display:    'flex',
        alignItems: 'center',
        gap:        '6px',
        padding:    '6px 14px',
        fontSize:   '12px',
        cursor:     'pointer',
        color:      row.active ? CLR.iconActive : '#333',
        fontWeight: row.active ? '700' : '400',
        background: row.active ? CLR.menuActive : 'transparent',
        whiteSpace: 'nowrap',
        outline:    'none',
      });
      const tick = document.createElement('span');
      Object.assign(tick.style, {
        width:      '12px',
        flexShrink: '0',
        color:      CLR.iconActive,
        visibility: row.active ? 'visible' : 'hidden',
      });
      tick.textContent = '✓';
      tick.setAttribute('aria-hidden', 'true');
      const lbl = document.createElement('span');
      lbl.textContent = row.label;
      el.appendChild(tick);
      el.appendChild(lbl);
      el.addEventListener('mouseenter', () => { if (!row.active) el.style.background = CLR.menuHover; });
      el.addEventListener('mouseleave', () => { el.style.background = row.active ? CLR.menuActive : 'transparent'; });
      el.addEventListener('focus', () => { if (!row.active) el.style.background = CLR.menuHover; });
      el.addEventListener('blur',  () => { el.style.background = row.active ? CLR.menuActive : 'transparent'; });
      el.addEventListener('click', (e) => { e.stopPropagation(); row.onClick(e); });
      menu.appendChild(el);
    }
  }
  return menu;
}

export function createToolbarHelpers(tooltip: HTMLDivElement): ToolbarHelpers {
  let openMenu: HTMLDivElement | null = null;
  const menuRoot = (anchor: Element): Element => menuRootFor(anchor);

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
    btn.addEventListener('mouseenter', (e) => {
      if (!btn.dataset.active) {
        btn.style.background = CLR.bgHover;
        btn.style.color      = CLR.iconHover;
      }
      tooltip.innerHTML     = label;
      tooltip.style.display = 'block';
      positionTooltip(tooltip, e.clientX, e.clientY);
    });
    btn.addEventListener('mousemove', (e) => {
      if (tooltip.style.display === 'block') positionTooltip(tooltip, e.clientX, e.clientY);
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
    // Single-select menu semantics; container role/keyboard nav added when the
    // menu is mounted (applyMenuRoles / wireMenuKeyboard).
    row.setAttribute('role', 'menuitemradio');
    row.setAttribute('aria-checked', active ? 'true' : 'false');
    row.tabIndex = -1;
    Object.assign(row.style, {
      padding:    `6px 14px 6px ${indent ? '26px' : '14px'}`,
      fontSize:   '12px',
      cursor:     'pointer',
      color:      active ? CLR.iconActive : '#333',
      fontWeight: active ? '700' : '400',
      background: active ? CLR.menuActive : 'transparent',
      whiteSpace: 'nowrap',
      outline:    'none',
    });
    row.addEventListener('mouseenter', () => { if (!active) row.style.background = CLR.menuHover; });
    row.addEventListener('mouseleave', () => { row.style.background = active ? CLR.menuActive : 'transparent'; });
    // Keyboard focus highlight mirrors hover so the roving focus is visible.
    row.addEventListener('focus', () => { if (!active) row.style.background = CLR.menuHover; });
    row.addEventListener('blur',  () => { row.style.background = active ? CLR.menuActive : 'transparent'; });
    row.addEventListener('click', onClick);
    return row;
  }

  function makeMenuSection(label: string): HTMLDivElement {
    const el = document.createElement('div');
    el.textContent = label;
    el.setAttribute('role', 'presentation');
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
    const closeMenu = (): void => {
      if (openMenu) { openMenu.remove(); openMenu = null; }
      btn.setAttribute('aria-expanded', 'false');
    };
    const btn = makeBtn(iconKey, title, () => {
      if (openMenu) { closeMenu(); return; }
      const menu = document.createElement('div');
      const btnRect = btn.getBoundingClientRect();
      const ddMinWidth = 148;
      const ddFitsRight = btnRect.left + ddMinWidth <= (window.innerWidth ?? Infinity);
      const ddLeft = ddFitsRight ? btnRect.left : Math.max(4, btnRect.right - ddMinWidth);
      Object.assign(menu.style, {
        position:      'fixed',
        top:           `${btnRect.bottom + 4}px`,
        left:          `${ddLeft}px`,
        background:    CLR.menuBg,
        border:        `1px solid ${CLR.menuBorder}`,
        borderRadius:  '4px',
        boxShadow:     '0 4px 12px rgba(0,0,0,0.15)',
        zIndex:        'var(--wmap-z, 100)',
        minWidth:      `${ddMinWidth}px`,
        padding:       '4px 0',
        pointerEvents: 'auto',
      });
      for (const item of getItems()) {
        const row = document.createElement('div');
        row.textContent = item.label;
        row.dataset.wmapDropdownValue = item.value;
        const isActive = item.value === getCurrent();
        row.setAttribute('role', 'menuitemradio');
        row.setAttribute('aria-checked', isActive ? 'true' : 'false');
        row.tabIndex = -1;
        Object.assign(row.style, {
          padding:    '6px 14px',
          fontSize:   '12px',
          cursor:     'pointer',
          color:      isActive ? CLR.iconActive : '#333',
          fontWeight: isActive ? '700' : '400',
          background: isActive ? CLR.menuActive : 'transparent',
          whiteSpace: 'nowrap',
          outline:    'none',
        });
        const highlightOn  = (): void => { if (item.value !== getCurrent()) row.style.background = CLR.menuHover; };
        const highlightOff = (): void => { row.style.background = item.value === getCurrent() ? CLR.menuActive : 'transparent'; };
        row.addEventListener('mouseenter', highlightOn);
        row.addEventListener('mouseleave', highlightOff);
        row.addEventListener('focus', highlightOn);
        row.addEventListener('blur',  highlightOff);
        row.addEventListener('click', e => {
          e.stopPropagation();
          onPick(item.value);
          closeMenu();
        });
        menu.appendChild(row);
      }
      menu.setAttribute('role', 'menu');
      menu.setAttribute('aria-label', title);
      menuRoot(btn).appendChild(menu);
      openMenu = menu;
      btn.setAttribute('aria-expanded', 'true');
      wireMenuKeyboard(menu, btn, closeMenu);
    });
    btn.setAttribute('aria-haspopup', 'menu');
    btn.setAttribute('aria-expanded', 'false');
    return btn;
  }

  function makeCheckMenuBtn(
    iconKey: string,
    label: string,
    getRows: () => CheckMenuRow[],
    onSync: (btn: HTMLButtonElement) => void,
  ): HTMLButtonElement {
    function buildMenu(): HTMLDivElement {
      return buildCheckMenuEl(
        btn.getBoundingClientRect(),
        getRows().map(row => {
          if ('section' in row) return row;
          return {
            ...row,
            onClick: (e: MouseEvent) => {
              row.onClick(e);
              onSync(btn);
              const current = openMenu;
              if (!current) return;
              const updated = buildMenu();
              updated.setAttribute('role', 'menu');
              updated.setAttribute('aria-label', label);
              current.replaceWith(updated);
              openMenu = updated;
              wireMenuKeyboard(updated, btn, closeMenu);
            },
          };
        }),
        { makeMenuRow, makeMenuSection },
      );
    }
    const closeMenu = (): void => {
      if (openMenu) { openMenu.remove(); openMenu = null; }
      btn.setAttribute('aria-expanded', 'false');
    };
    const btn = makeBtn(iconKey, label, () => {
      if (openMenu) { closeMenu(); return; }
      const menu = buildMenu();
      menu.setAttribute('role', 'menu');
      menu.setAttribute('aria-label', label);
      menuRoot(btn).appendChild(menu);
      openMenu = menu;
      btn.setAttribute('aria-expanded', 'true');
      wireMenuKeyboard(menu, btn, closeMenu);
    });
    btn.setAttribute('aria-haspopup', 'menu');
    btn.setAttribute('aria-expanded', 'false');
    onSync(btn);
    return btn;
  }

  function closeOpenMenu(e: MouseEvent): void {
    if (openMenu && !openMenu.contains(e.target as Node)) {
      openMenu.remove();
      openMenu = null;
      // Keep menu-trigger aria in sync: a trigger button that re-opens the menu
      // on the same click will set itself back to 'true' afterwards, so resetting
      // here cannot leave a stale 'true' on a button whose menu is closed.
      const target = e.target as Element | null;
      if (!(target?.getAttribute?.('aria-haspopup') === 'menu')) {
        for (const el of document.querySelectorAll('[aria-haspopup="menu"][aria-expanded="true"]')) {
          el.setAttribute('aria-expanded', 'false');
        }
      }
    }
  }

  return {
    makeBtn, setActive, makeSep, makeMenuRow, makeMenuSection, makeDropdown,
    makeCheckMenuBtn, closeOpenMenu,
    getOpenMenu: () => openMenu,
    setOpenMenu: (m) => { openMenu = m; },
  };
}

// ── Shared expand modal ────────────────────────────────────────────────────────

export interface ModalOptions {
  /** Optional title shown in the header left. */
  title?: string;
  /** Called when fullscreen state changes — use to reparent tooltips etc. */
  onFullscreenChange?: (isFs: boolean, box: HTMLElement) => void;
  /** Called when the modal is closed. */
  onClose: () => void;
}

export interface ModalHandle {
  backdrop: HTMLDivElement;
  box: HTMLDivElement;
  /** Flex container inside the box for the canvas/content area. */
  contentWrap: HTMLDivElement;
  /** Close the modal — removes DOM, restores scroll, removes all listeners, fires onClose. */
  close: () => void;
}

/**
 * Create and open a resizable, fullscreen-capable expand modal.
 * Mounts itself into document.body. Call `handle.close()` to tear down cleanly.
 */
export function openModal(opts: ModalOptions): ModalHandle {
  const savedOverflow = document.body.style.overflow;
  document.body.style.overflow = 'hidden';

  const backdrop = document.createElement('div') as HTMLDivElement;
  backdrop.id = 'wmap-modal-backdrop';
  Object.assign(backdrop.style, {
    position:       'fixed',
    inset:          '0',
    background:     'rgba(0,0,0,0.6)',
    display:        'flex',
    alignItems:     'center',
    justifyContent: 'center',
    zIndex:         'calc(var(--wmap-z, 100) + 1)',
    backdropFilter: 'blur(3px)',
  });

  // Remember what had focus so we can restore it when the modal closes.
  const previouslyFocused = document.activeElement as HTMLElement | null;

  const box = document.createElement('div') as HTMLDivElement;
  box.className = 'wmap-modal-box';
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-modal', 'true');
  box.setAttribute('aria-label', opts.title ?? 'Expanded wafer map');
  box.tabIndex = -1;
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
    zIndex:        'calc(var(--wmap-z, 100) + 2)',
  });

  const header = document.createElement('div');
  Object.assign(header.style, {
    display:      'flex',
    alignItems:   'center',
    padding:      '10px 14px',
    borderBottom: '1px solid #e2e5ea',
    flexShrink:   '0',
  });

  const btnStyle: Partial<CSSStyleDeclaration> = {
    border:      'none',
    background:  'transparent',
    cursor:      'pointer',
    color:       '#888',
    lineHeight:  '1',
    padding:     '0 4px',
    fontSize:    '15px',
    display:     'flex',
    alignItems:  'center',
  };

  if (opts.title) {
    const titleEl = document.createElement('span');
    titleEl.textContent = opts.title;
    Object.assign(titleEl.style, { fontWeight: '700', fontSize: '14px' });
    header.appendChild(titleEl);
  }

  const spacer = document.createElement('div');
  spacer.style.flex = '1';
  header.appendChild(spacer);

  const fullscreenBtn = document.createElement('button');
  fullscreenBtn.type = 'button';
  fullscreenBtn.innerHTML = '&#x26F6;';
  fullscreenBtn.title = 'Fullscreen (F)';
  fullscreenBtn.setAttribute('aria-label', 'Fullscreen');
  Object.assign(fullscreenBtn.style, { ...btnStyle, fontSize: '18px' });
  fullscreenBtn.addEventListener('click', () => {
    if (!document.fullscreenElement) box.requestFullscreen().catch(() => {});
    else document.exitFullscreen();
  });

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.textContent = '\xD7';
  closeBtn.title = 'Close (Esc)';
  closeBtn.setAttribute('aria-label', 'Close');
  Object.assign(closeBtn.style, { ...btnStyle, fontSize: '20px', padding: '0 2px' });
  closeBtn.addEventListener('click', close);

  header.appendChild(fullscreenBtn);
  header.appendChild(closeBtn);

  const onFsChange = () => {
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
    opts.onFullscreenChange?.(isFs, box);
  };

  // Keep keyboard focus inside the dialog while it is open (a11y focus trap).
  const FOCUSABLE =
    'button,[href],input,select,textarea,[tabindex]:not([tabindex="-1"]),[role="menuitem"],[role="menuitemradio"],[role="menuitemcheckbox"]';
  function trapTab(e: KeyboardEvent): void {
    const focusable = Array.from(box.querySelectorAll<HTMLElement>(FOCUSABLE))
      .filter(el => el.offsetParent !== null || el === document.activeElement);
    if (focusable.length === 0) { e.preventDefault(); box.focus(); return; }
    const first = focusable[0];
    const last  = focusable[focusable.length - 1];
    const active = document.activeElement as HTMLElement | null;
    if (e.shiftKey && (active === first || !box.contains(active))) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  }

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && !document.fullscreenElement) { close(); return; }
    if (e.key === 'Tab') { trapTab(e); return; }
    if (e.key === 'f' || e.key === 'F') {
      if (!document.fullscreenElement) box.requestFullscreen().catch(() => {});
      else document.exitFullscreen();
    }
  };

  function close() {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    document.removeEventListener('keydown', onKeyDown);
    document.removeEventListener('fullscreenchange', onFsChange);
    backdrop.remove();
    document.body.style.overflow = savedOverflow;
    // Return focus to whatever was focused before the modal opened.
    previouslyFocused?.focus?.();
    opts.onClose();
  }

  const contentWrap = document.createElement('div') as HTMLDivElement;
  Object.assign(contentWrap.style, {
    flex:      '1',
    minHeight: '0',
    minWidth:  '0',
    display:   'flex',
    overflow:  'hidden',
  });

  box.appendChild(header);
  box.appendChild(contentWrap);
  backdrop.appendChild(box);
  document.body.appendChild(backdrop);

  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });
  document.addEventListener('keydown', onKeyDown);
  document.addEventListener('fullscreenchange', onFsChange);

  // Move focus into the dialog so the trap has somewhere to start and screen
  // readers announce the dialog. Prefer the close button (a predictable target).
  nextFrame(() => (closeBtn.isConnected ? closeBtn : box).focus());

  return { backdrop, box, contentWrap, close };
}
