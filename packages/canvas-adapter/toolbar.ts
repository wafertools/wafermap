// ── Shared toolbar utilities ───────────────────────────────────────────────────
// Internal module. Do not re-export from index.ts.

import type { PlotMode } from '../renderer/buildView.js';
import { listColorSchemes } from '../renderer/colorSchemes.js';
import { ICONS } from './icons.js';

// ── Colours (themeable design tokens) ───────────────────────────────────────────
//
// Every chrome colour (toolbar + summary panel) is a `--wmap-<name>` CSS custom
// property with the current light value as its fallback default. Existing hosts
// are unaffected (the default renders identically); a host that wants dark — or
// to match its own brand — sets the `--wmap-*` variables on any ancestor of the
// render container and the DOM chrome follows. This is the colour analogue of
// `--wmap-z` (stacking): one host-settable token set, safe light defaults.
//
// NOTE: this covers DOM chrome only. The <canvas> draws its own hardcoded colours
// (axis text, grid, halos) which a stylesheet can't reach — those need a separate
// draw-time resolve pass (tracked as a follow-up; see tsmap WMAP_ISSUES #25).
//
// `WMAP_TOKEN_NAMES` is the single source of truth for which `--wmap-*` custom
// properties exist — `CLR` below, `canvasTheme.ts`'s `resolveCanvasTheme`, and
// `copyWmapThemeTokens` (further down this file) all read/write only names
// drawn from this list, so the three can't silently drift apart (e.g. a token
// renamed here but left stale in canvas-theme reads).
export const WMAP_TOKEN_NAMES = [
  'z',
  'icon', 'icon-hover', 'icon-active', 'bg-hover', 'bg-active', 'separator',
  'surface', 'border', 'menu-hover', 'menu-active',
  'panel-bg', 'text-muted', 'text',
  'warn-bg', 'warn-border', 'warn-text',
  'info-bg', 'info-text',
  'selected',
  'canvas-bg',
] as const;

export type WmapTokenName = (typeof WMAP_TOKEN_NAMES)[number];

// `t(name, fallback)` builds a `var()` reference so the token name and its light
// default live together, in one place, here. `name` is constrained to
// `WmapTokenName` so a typo'd or renamed token fails to compile instead of
// silently reading a CSS variable nothing ever sets.
const t = (name: WmapTokenName, fallback: string) => `var(--wmap-${name}, ${fallback})`;

export const CLR = {
  // Toolbar icons + hover/active affordances.
  icon:        t('icon',         '#506784'),
  iconHover:   t('icon-hover',   '#2a3f5f'),
  iconActive:  t('icon-active',  '#1a66cc'),
  bgHover:     t('bg-hover',     '#edf0f8'),
  bgActive:    t('bg-active',    '#dce8f8'),
  separator:   t('separator',    'rgba(0,0,0,0.12)'),
  // Menus / dropdowns.
  menuBg:      t('surface',      '#fff'),
  menuBorder:  t('border',       'rgba(0,0,0,0.12)'),
  menuHover:   t('menu-hover',   '#f0f4fc'),
  menuActive:  t('menu-active',  '#dce8f8'),
  // Summary-panel surfaces + text.
  panelBg:     t('panel-bg',     '#fafbfc'),
  label:       t('text-muted',   '#66788a'),
  value:       t('text',         '#1f2f43'),
  text:        t('text',         '#333'),
  // Semantic — warning banner.
  warnBg:      t('warn-bg',      '#fffbe6'),
  warnBorder:  t('warn-border',  '#f0c040'),
  warnText:    t('warn-text',    '#7a5800'),
  // Semantic — info / callout.
  infoBg:      t('info-bg',      '#dce8f8'),
  infoText:    t('info-text',    '#334155'),
  // Finding-drilldown highlight — the outline drawn round gallery cards whose
  // wafers are implicated by the summary-panel finding the user is inspecting.
  // Orange default stands out against light chrome; hosts can theme it. The CSS
  // token stays `--wmap-selected` for theme back-compat.
  findingHighlight: t('selected', '#e07a20'),
};

// ── Constants ──────────────────────────────────────────────────────────────────

export const ROTATIONS: Array<0 | 90 | 180 | 270> = [0, 90, 180, 270];

export const INLINE_TEST_LIMIT = 6;

// ── Overlay stacking ─────────────────────────────────────────────────────────
//
// Every transient overlay wmap creates (toolbar menus, die tooltip, expand
// modal, user-guide modal) is positioned `position: fixed` and reads its
// `z-index` from the `--wmap-z` custom property. The host controls stacking by
// passing `zIndex` to `renderWaferMap`/`renderWaferGallery`, which writes
// `--wmap-z` onto `document.documentElement` for the render's lifetime — body-
// escaping overlays (tooltip, modal backdrop) inherit it from there, and
// container-scoped overlays inherit it too.
//
// The default is deliberately HIGH (not the old `100`), so that with no host
// configuration overlays land above typical app modal layers instead of
// silently rendering behind them. A host that needs them lower passes an
// explicit `zIndex`.
export const DEFAULT_OVERLAY_Z = 6000;

/** `z-index` value string for a base-level overlay (menus, modal backdrop). */
export const Z_BASE = `var(--wmap-z, ${DEFAULT_OVERLAY_Z})`;
/** One above base — tooltips, submenus, the modal box above its backdrop. */
export const Z_ABOVE = `calc(var(--wmap-z, ${DEFAULT_OVERLAY_Z}) + 1)`;
/** Two above base — controls that must sit above a maximized modal box. */
export const Z_ABOVE2 = `calc(var(--wmap-z, ${DEFAULT_OVERLAY_Z}) + 2)`;

/**
 * Apply a host-supplied `zIndex` to wmap's overlays by writing `--wmap-z` onto
 * `document.documentElement`. Returns a disposer that restores the previous
 * value (called on controller `destroy`). No-op when `zIndex` is undefined, so
 * the safe high default in `Z_BASE`/`Z_ABOVE` applies.
 *
 * `--wmap-z` is set on the document root (not the render container) because
 * several overlays append to `document.body`, outside the container's subtree,
 * and must still inherit the value.
 */
export function applyOverlayZ(zIndex: number | undefined): () => void {
  if (zIndex == null) return () => {};
  const root = document.documentElement;
  const prev = root.style.getPropertyValue('--wmap-z');
  root.style.setProperty('--wmap-z', String(zIndex));
  return () => {
    if (prev) root.style.setProperty('--wmap-z', prev);
    else root.style.removeProperty('--wmap-z');
  };
}

// ── Theme token propagation across documents ────────────────────────────────
//
// Every `--wmap-*` custom property a host sets lives on ITS page's ancestor
// elements. A gallery card detached into its own popup window (see
// `openDetachWindow` below) gets a brand-new, unrelated `document` — its
// `documentElement` has none of the host's theme values, so without an
// explicit copy the popup would silently fall back to the light defaults
// baked into each token's `var(--wmap-*, fallback)`, even for a host running
// in dark mode. Uses `WMAP_TOKEN_NAMES` (defined above, next to `CLR`) so this
// copier can't drift out of sync with the tokens `CLR`/canvas-theme actually read.

/** Copy every `--wmap-*` custom property resolved on `src` onto `dest`, so an
 * element in a different document (e.g. a detached popup's `documentElement`)
 * renders with the same theme as the host page instead of silently reverting
 * to light-mode defaults. */
export function copyWmapThemeTokens(src: Element, dest: HTMLElement): void {
  const computed = getComputedStyle(src);
  for (const name of WMAP_TOKEN_NAMES) {
    const value = computed.getPropertyValue(`--wmap-${name}`).trim();
    if (value) dest.style.setProperty(`--wmap-${name}`, value);
  }
}

/**
 * Keeps a popup's copied `--wmap-*` tokens (`copyWmapThemeTokens`, above) in
 * sync with *later* host theme changes. A one-time copy at open time is a
 * snapshot, not a live link (CSS custom properties can't inherit across
 * documents) — if the host flips theme while the popup is still open (e.g. a
 * dark-mode toggle re-pointing its `--wmap-*` values), nothing would
 * otherwise re-copy them. Watches attribute changes on `themeSource` and
 * `<html>` — the two most common places a host actually changes theme (a
 * toggled class or inline style) — plus the OS light/dark preference. This
 * can't observe a change on some other ancestor further up that isn't
 * `themeSource` or `<html>` itself, but that already covers the realistic
 * cases; watching the whole ancestor chain generically is not something
 * anything else in this codebase does either. `onResync`, if given, fires
 * alongside each re-copy — e.g. to force a live map inside the popup to
 * redraw so its canvas re-resolves the same palette (CSS custom properties
 * update DOM-driven chrome automatically, but a canvas only re-resolves
 * `--wmap-*` at its next draw). Returns a disposer to call when the popup closes.
 */
export function syncWmapPopupTheme(themeSource: Element, popupDocumentElement: HTMLElement, onResync?: () => void): () => void {
  const resync = () => {
    copyWmapThemeTokens(themeSource, popupDocumentElement);
    onResync?.();
  };
  const observer = new window.MutationObserver(resync);
  observer.observe(themeSource, { attributes: true, attributeFilter: ['style', 'class'] });
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['style', 'class'] });
  const schemeMediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
  schemeMediaQuery.addEventListener('change', resync);
  return () => {
    observer.disconnect();
    schemeMediaQuery.removeEventListener('change', resync);
  };
}

// ── Gallery card detach window opener ───────────────────────────────────────
//
// A gallery card detached into its own window (see renderWaferGallery.ts's
// openWindowForCard) needs a real, OS-window-manager-controlled window — not
// an in-page `position: fixed` div — so it can be dragged outside the host
// browser/Tauri window's own bounds. `window.open()` is the default, but it is
// blocked/returns `null` silently in Tauri's WebView (confirmed in tsmap's own
// history — see WMAP_ISSUES.md and `setReportOpener` below, which solves the
// same class of problem for a different feature). Mirrors that pattern:
// a host registers a custom opener at startup; the default falls back to
// plain `window.open`.
export type DetachWindowOpener = (label: string) => Window | null;

let detachWindowOpener: DetachWindowOpener | null = null;

/** Register a custom opener for gallery card detach windows — e.g. one backed
 * by a Tauri `WebviewWindow`, for hosts where `window.open` is blocked. The
 * opener receives the card's label and must return a `Window`-like handle
 * (with a usable `.document`) to build into, or `null` to decline (treated
 * exactly like a blocked popup — the detach silently no-ops). */
export function setDetachWindowOpener(opener: DetachWindowOpener | null): void {
  detachWindowOpener = opener;
}

/** Open a blank window for a detached gallery card. Uses the registered
 * `setDetachWindowOpener` opener when present, else falls back to a plain
 * `window.open` popup.
 *
 * Known cosmetic quirk: since this never navigates away from `about:blank`,
 * Chrome's window-title algorithm shows "{title} - Chrome" in the OS window/
 * tab title instead of just the title we set (an un-navigated about:blank
 * window is treated as titleless regardless of `document.title`). Navigating
 * to a real URL would fix it but means either re-running the host page's own
 * script inside the popup (real risk of double side effects) or requiring a
 * dedicated blank same-origin asset — not worth it for a cosmetic issue. */
export function openDetachWindow(label: string): Window | null {
  if (detachWindowOpener) return detachWindowOpener(label);
  return window.open('', '_blank', 'width=560,height=600');
}

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

/**
 * Host hook for saving a text file (CSV, etc). Mirrors `SaveImageHandler` —
 * when provided, `saveTextFile` calls this instead of triggering a browser
 * `<a download>`, letting embedded hosts (Tauri, Electron, WebView2) route
 * the text through a native save dialog. Receives the raw `text`, a
 * `suggestedName` (already includes its extension), and the `mimeType`.
 */
export type SaveTextHandler = (text: string, suggestedName: string, mimeType: string) => void | Promise<void>;

/**
 * Persist a text file (e.g. a CSV export). Routes through the host
 * `onSaveText` hook when provided; otherwise falls back to a browser
 * `<a download>` click — the same `<a download>` dance `saveImageBlob` uses
 * for PNG saves, which is silently a no-op in Tauri/Electron/WebView2 (see
 * `saveImageBlob`'s own doc comment), hence the hook.
 *
 * @param text        the file contents
 * @param filename    filename including extension (e.g. `'test-values.csv'`)
 * @param mimeType    e.g. `'text/csv'`
 * @param onSaveText  optional host hook; when present, bypasses `<a download>`
 */
export function saveTextFile(text: string, filename: string, mimeType: string, onSaveText?: SaveTextHandler): void {
  if (onSaveText) {
    void onSaveText(text, filename, mimeType);
    return;
  }
  const blob = new Blob([text], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a   = document.createElement('a');
  a.href = url;
  a.download = filename;
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
 * Used to defer focus moves until the element is laid out, and to schedule
 * re-renders after a resize.
 *
 * Accepts an explicit `ownerWindow` — a bare `requestAnimationFrame` reference
 * resolves to whichever window this MODULE was first evaluated in (the host
 * page's), not necessarily the window whose layout the caller actually cares
 * about. For a gallery card detached into its own popup window, scheduling
 * against the opener's rAF loop means the callback only fires when the OPENER
 * repaints (e.g. on mouse movement there) — not when the popup itself does,
 * which reads as "the map doesn't resize until I move focus back to the main
 * window." Passing the popup's own `window` fixes this.
 */
export function nextFrame(fn: () => void, ownerWindow: Window = window): void {
  const raf = ownerWindow.requestAnimationFrame;
  if (typeof raf === 'function') raf.call(ownerWindow, fn);
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

// Menus must be appended inside the nearest overlay box (modal or floating
// window), not document.body — a maximized/high-z-index box is a fixed
// stacking context that would obscure body-level menus. The fallback is the
// ANCHOR's own document.body, not the bare global `document` — a gallery card
// detached into its own popup window (see renderWaferGallery.ts) has no
// ancestor overlay box (a real OS window needs none), so falling through to
// the wrong document would silently render its menus in the opener's page
// instead of inside the popup.
export function menuRootFor(anchor: Element): Element {
  let el: Element | null = anchor;
  while (el) {
    if (el.classList.contains('wmap-overlay-box')) return el;
    el = el.parentElement;
  }
  return anchor.ownerDocument.body;
}

// ── Tooltip ────────────────────────────────────────────────────────────────────
//
// There is exactly ONE tooltip element for the whole document, shared by every
// renderWaferMap, every renderWaferGallery, and all their toolbars. This is a
// hard invariant: only one tooltip may ever be visible at a time. Because every
// consumer points at the same node, "showing" a tooltip anywhere inherently
// hides whatever was shown elsewhere — they are the same element, it just moves
// and re-renders. This makes a stuck/frozen tooltip structurally impossible: the
// next hover anywhere reclaims and repositions the single node. (Previously each
// instance created its own body-appended element; a missed leave/cancel event on
// one left its tooltip frozen while the others kept working.)
//
// The singleton lives for the page lifetime — like a browser's native tooltip
// layer, it is reused, never destroyed. Instance teardown hides it rather than
// removing it, since other instances may still be using it.

// One tooltip PER DOCUMENT, not one for the whole process — a gallery card
// detached into its own popup window (see renderWaferGallery.ts's
// openWindowForCard) has an entirely separate `document`, and a tooltip
// created in the opener's document would render invisibly behind/outside that
// popup. Keyed by document so every render target (the host page, and any
// number of detached popup documents) gets its own single-instance tooltip,
// preserving the original "stuck tooltip is structurally impossible" guarantee
// within each document independently.
const sharedTooltips = new WeakMap<Document, HTMLDivElement>();

/** The shared tooltip element for `doc` (default: the host page's own
 * document), lazily created and appended to `doc.body`. */
export function getTooltip(doc: Document = document): HTMLDivElement {
  const existing = sharedTooltips.get(doc);
  if (existing && existing.isConnected) return existing;
  const el = existing ?? doc.createElement('div');
  if (!existing) {
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
      // Hard height cap so the tooltip can never grow into a full-viewport block —
      // a safety net (the hover content is now compact, and pointerEvents:none means
      // it can't scroll, so anything beyond the cap, e.g. abundant host metadata, is
      // clipped rather than overflowing the screen).
      maxHeight:    'min(60vh, 480px)',
      overflow:     'hidden',
      whiteSpace:   'pre-wrap',
      zIndex:       Z_ABOVE,
      display:      'none',
      fontFamily:   'system-ui, sans-serif',
      boxShadow:    '0 3px 10px rgba(0,0,0,0.45)',
    });
    sharedTooltips.set(doc, el);
  }
  doc.body.appendChild(el);
  return el;
}

/** Hide `doc`'s shared tooltip. Deliberately does NOT re-home it to `doc.body`
 * — it stays wherever `reparentTooltip()` last placed it (e.g. inside an open
 * floating window's box). A non-modal floating window can stay open for many
 * ordinary hover/unhover cycles; snapping the tooltip back to `<body>` on
 * every hide (as this used to do) meant the very first unhover after opening
 * a floating window silently evicted the tooltip from the window's stacking
 * context, and it was never reparented back in — every subsequent hover in
 * that window then rendered the tooltip at `<body>`'s z-index, BEHIND the
 * window. Callers that actually close an overlay (see `openOverlay`'s
 * `close()`) are responsible for reparenting the tooltip back to `<body>`
 * themselves once the box that owned it is really going away. */
export function hideTooltip(doc: Document = document): void {
  const el = sharedTooltips.get(doc);
  if (!el) return;
  el.style.display = 'none';
}

/**
 * Move `parent`'s document's shared tooltip into `parent` (e.g. a maximized
 * modal box that creates its own stacking/overflow context). Pass nothing to
 * re-home the host page's tooltip to `document.body`.
 */
export function reparentTooltip(parent?: HTMLElement): void {
  const doc = parent?.ownerDocument ?? document;
  const el = getTooltip(doc);
  (parent ?? doc.body).appendChild(el);
}

export function positionTooltip(tooltip: HTMLDivElement, clientX: number, clientY: number): void {
  const ownerWindow = tooltip.ownerDocument.defaultView ?? window;
  tooltip.style.left = '0';
  tooltip.style.top  = '0';
  const tw     = tooltip.offsetWidth;
  const th     = tooltip.offsetHeight;
  const margin = 8;
  let x = clientX + 14;
  let y = clientY - 8;
  if (x + tw + margin > ownerWindow.innerWidth)  x = clientX - tw - 6;
  if (y + th + margin > ownerWindow.innerHeight) y = ownerWindow.innerHeight - th - margin;
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
  ownerWindow: Window = window,
): HTMLDivElement {
  const { makeMenuRow, makeMenuSection } = helpers;

  const menu = document.createElement('div');
  const modeMinWidth = 180;
  const modeFitsRight = anchorRect.left + modeMinWidth <= (ownerWindow.innerWidth ?? Infinity);
  const modeLeft = modeFitsRight ? anchorRect.left : Math.max(4, anchorRect.right - modeMinWidth);
  Object.assign(menu.style, {
    position:      'fixed',
    top:           `${anchorRect.bottom + 4}px`,
    left:          `${modeLeft}px`,
    background:    CLR.menuBg,
    border:        `1px solid ${CLR.menuBorder}`,
    borderRadius:  '4px',
    boxShadow:     '0 4px 12px rgba(0,0,0,0.15)',
    zIndex:        Z_BASE,
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
        const subMinWidth = 160;
        const subMaxHeight = 320;
        const subFitsRight = rowRect.right + 2 + subMinWidth <= (ownerWindow.innerWidth ?? Infinity);
        const subLeft = subFitsRight ? rowRect.right + 2 : Math.max(4, rowRect.left - 2 - subMinWidth);
        const subTop = Math.min(rowRect.top - 4, Math.max(4, (ownerWindow.innerHeight ?? Infinity) - subMaxHeight - 4));
        subMenu = document.createElement('div');
        Object.assign(subMenu.style, {
          position:      'fixed',
          top:           `${subTop}px`,
          left:          `${subLeft}px`,
          background:    CLR.menuBg,
          border:        `1px solid ${CLR.menuBorder}`,
          borderRadius:  '4px',
          boxShadow:     '0 4px 12px rgba(0,0,0,0.15)',
          zIndex:        Z_ABOVE,
          minWidth:      `${subMinWidth}px`,
          maxHeight:     `${subMaxHeight}px`,
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
        // Append into the same stacking root as the parent menu so the submenu
        // is visible when the menu is inside a maximized modal box (no real
        // fullscreen element exists — see openModal's CSS maximize).
        (menu.parentElement ?? document.body).appendChild(subMenu);
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

export interface ExpandToggleHandle {
  isOpen(): boolean;
  /** Force-close without toggling — used for e.g. a data refresh that should collapse an open panel. */
  close(): void;
  destroy(): void;
}

/**
 * Shared "click/Enter/Space toggles an expand/collapse state, Escape or an
 * outside click closes it" wiring — the small interaction pattern behind both
 * the metadata badge's own expand (metadataBadge.ts) and the gallery card
 * header's metadata reveal (renderWaferGallery.ts). `trigger` gets
 * `role="button"`/`tabindex` and the event listeners; `onChange(open)` is
 * called whenever the state actually changes (never redundantly) — the
 * caller owns all the resulting DOM (aria-expanded text, panel visibility,
 * content), this only owns the open/closed boolean and its triggers.
 */
export function wireExpandToggle(trigger: HTMLElement, onChange: (open: boolean) => void): ExpandToggleHandle {
  // Derive the document from the trigger itself, not the bare global — a
  // gallery card's detached popup window is a genuinely different Document,
  // and an outside-click listener registered on the wrong one would never
  // fire (events don't cross document boundaries), leaving the panel stuck open.
  const ownerDocument = trigger.ownerDocument;
  let open = false;

  function set(next: boolean): void {
    if (open === next) return;
    open = next;
    onChange(open);
  }
  function collapse(): void { set(false); }
  function toggle(): void {
    set(!open);
    if (open) ownerDocument.addEventListener('click', collapse, { once: true });
  }

  const onClick = (e: MouseEvent): void => { e.stopPropagation(); toggle(); };
  const onKeydown = (e: KeyboardEvent): void => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); }
    else if (e.key === 'Escape') collapse();
  };

  trigger.setAttribute('role', 'button');
  if (trigger.tabIndex < 0) trigger.tabIndex = 0;
  trigger.addEventListener('click', onClick);
  trigger.addEventListener('keydown', onKeydown);

  return {
    isOpen: () => open,
    close: collapse,
    destroy() {
      trigger.removeEventListener('click', onClick);
      trigger.removeEventListener('keydown', onKeydown);
      ownerDocument.removeEventListener('click', collapse);
    },
  };
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
  ownerWindow: Window = window,
): HTMLDivElement {
  const { makeMenuRow, makeMenuSection } = helpers;
  const menu = document.createElement('div');
  const minWidth = 168;
  // Prefer left-aligned; flip to right-aligned when button is near the right edge.
  const fitsRight = anchorRect.left + minWidth <= (ownerWindow.innerWidth ?? Infinity);
  const leftPx  = fitsRight ? anchorRect.left : Math.max(4, anchorRect.right - minWidth);
  Object.assign(menu.style, {
    position:      'fixed',
    top:           `${anchorRect.bottom + 4}px`,
    left:          `${leftPx}px`,
    background:    CLR.menuBg,
    border:        `1px solid ${CLR.menuBorder}`,
    borderRadius:  '4px',
    boxShadow:     '0 4px 12px rgba(0,0,0,0.15)',
    zIndex:        Z_BASE,
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
        color:      row.active ? CLR.iconActive : CLR.text,
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
      // Read the button's current ariaLabel, not the `label` this closure was
      // created with — some callers (e.g. the colorbar-range and Insights
      // toggle buttons) update ariaLabel after creation to reflect a changed
      // state, and the tooltip must track that rather than showing stale text.
      tooltip.innerHTML     = btn.ariaLabel ?? label;
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
      color:      active ? CLR.iconActive : CLR.text,
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
      color:         CLR.label,
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
      const ownerWin = btn.ownerDocument.defaultView ?? window;
      const ddMinWidth = 148;
      const ddFitsRight = btnRect.left + ddMinWidth <= (ownerWin.innerWidth ?? Infinity);
      const ddLeft = ddFitsRight ? btnRect.left : Math.max(4, btnRect.right - ddMinWidth);
      Object.assign(menu.style, {
        position:      'fixed',
        top:           `${btnRect.bottom + 4}px`,
        left:          `${ddLeft}px`,
        background:    CLR.menuBg,
        border:        `1px solid ${CLR.menuBorder}`,
        borderRadius:  '4px',
        boxShadow:     '0 4px 12px rgba(0,0,0,0.15)',
        zIndex:        Z_BASE,
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
          color:      isActive ? CLR.iconActive : CLR.text,
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
        btn.ownerDocument.defaultView ?? window,
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

// ── Shared overlay primitive (modal dialogs and floating windows) ──────────────
//
// Two presentations share one box/header/chrome builder:
//   'modal'  — exclusive: dimmed backdrop blocks the rest of the page, scroll is
//              locked, Tab is trapped inside the box. Used where the box's content
//              was physically moved out of the page (leaving nothing sensible
//              behind to interact with) or where stale background state would be
//              actively misleading (see callers for the reasoning per case).
//   'window' — non-modal: no backdrop, no scroll lock, no focus trap — the rest of
//              the page stays fully interactive. Multiple windows may be open at
//              once, so window mode adds a per-window incrementing z-index (click-
//              to-front) and a small cascading open position, neither of which
//              modal mode needs (it's exclusive by construction).

export type OverlayMode = 'modal' | 'window';

export interface OverlayOptions {
  /** Optional title shown in the header left. */
  title?: string;
  mode: OverlayMode;
  /**
   * Called when the maximized state changes — use to reparent tooltips etc. Uses
   * a CSS maximize (the box grows to fill its backdrop/the viewport), not the
   * real Fullscreen API, for macOS WKWebView compatibility.
   */
  onMaximizeChange?: (isMaximized: boolean, box: HTMLElement) => void;
  /** Called when the overlay is closed. */
  onClose: () => void;
  /**
   * The document to build this overlay into — defaults to the bare global
   * `document`. Pass the triggering element's `ownerDocument` when the
   * caller's own container might live in a different document (e.g.
   * `renderWaferMap`'s own expand modal, whose canvas could be inside a
   * gallery card detached into its own popup window) — otherwise the overlay
   * silently builds into the WRONG document, visibly emptying the popup and
   * popping the box up on the host page instead.
   */
  ownerDocument?: Document;
}

export interface OverlayHandle {
  /** null in 'window' mode — there is no backdrop to block the page. */
  backdrop: HTMLDivElement | null;
  box: HTMLDivElement;
  /** Flex container inside the box for the canvas/content area. */
  contentWrap: HTMLDivElement;
  /** Close the overlay — removes DOM, restores scroll, removes all listeners, fires onClose. */
  close: () => void;
  /** Raise this window above other open windows. No-op in 'modal' mode. */
  bringToFront: () => void;
}

// Window mode needs its own incrementing stacking band, above the (dynamic,
// host-configurable) modal band, since a floating window must never be hidden
// behind a still-open modal — and among windows, the most recently focused one
// must be topmost. This band is a fixed constant rather than derived from
// `--wmap-z`: windows are independent floating chrome, not anchored overlays for
// a single map, so they don't need to interleave with a host's modal z-index.
const WINDOW_Z_BASE = 7000;
let windowZCounter = 0;
function nextWindowZ(): number { return WINDOW_Z_BASE + (++windowZCounter); }

// New windows cascade by a fixed offset so repeated opens don't stack exactly on
// top of each other. Wraps after a handful of opens rather than walking windows
// off-screen. No drag-to-reposition exists (native `resize: both` covers resize;
// this is a visualization library, not a windowing system).
const WINDOW_CASCADE_STEP = 32;
const WINDOW_CASCADE_MAX = 6;
let windowOpenCount = 0;
function nextCascadeOffset(): number {
  return (windowOpenCount++ % WINDOW_CASCADE_MAX) * WINDOW_CASCADE_STEP;
}

/**
 * Create and open a resizable, maximizable overlay — either an exclusive modal
 * dialog or a non-modal floating window. Mounts itself into document.body.
 * Call `handle.close()` to tear down cleanly.
 */
function openOverlay(opts: OverlayOptions): OverlayHandle {
  const isModal = opts.mode === 'modal';
  // Build into the caller-supplied document (e.g. a detached gallery card's
  // popup) rather than the bare global — otherwise the overlay silently
  // builds in the WRONG document whenever the triggering element doesn't
  // live in the host page's own document. Falls back to the bare globals for
  // backward compatibility when a caller doesn't (or can't) supply one.
  const doc = opts.ownerDocument ?? document;
  const win = doc.defaultView ?? window;
  const savedOverflow = doc.body.style.overflow;
  if (isModal) doc.body.style.overflow = 'hidden';

  let backdrop: HTMLDivElement | null = null;
  if (isModal) {
    backdrop = doc.createElement('div') as HTMLDivElement;
    backdrop.id = 'wmap-modal-backdrop';
    Object.assign(backdrop.style, {
      position:       'fixed',
      inset:          '0',
      background:     'rgba(0,0,0,0.6)',
      display:        'flex',
      alignItems:     'center',
      justifyContent: 'center',
      zIndex:         Z_ABOVE,
      backdropFilter: 'blur(3px)',
    });
  }

  // Remember what had focus so we can restore it when the overlay closes.
  const previouslyFocused = doc.activeElement as HTMLElement | null;

  const box = doc.createElement('div') as HTMLDivElement;
  box.className = isModal ? 'wmap-modal-box wmap-overlay-box' : 'wmap-window-box wmap-overlay-box';
  box.setAttribute('role', 'dialog');
  if (isModal) box.setAttribute('aria-modal', 'true');
  box.setAttribute('aria-label', opts.title ?? 'Expanded wafer map');
  box.tabIndex = -1;
  Object.assign(box.style, {
    // Baseline positioning context for the resize grip's `position: absolute`
    // (window mode overrides this to `fixed` below; modal mode keeps `relative`).
    position:      'relative',
    background:    CLR.menuBg,
    borderRadius:  '12px',
    overflow:      'hidden',
    display:       'flex',
    flexDirection: 'column',
    width:         'min(90vw, 700px)',
    height:        'min(90vh, 700px)',
    boxShadow:     '0 20px 60px rgba(0,0,0,0.4)',
    // No native CSS `resize` — its drag grip is a browser/engine-drawn
    // affordance with a small, precise hit-region that isn't reliable
    // everywhere (confirmed broken under WebKitGTK-via-VNC on Linux; visible
    // but undraggable). A hand-rolled Pointer-Events grip (added below, same
    // pattern as the header drag-to-reposition) is just an ordinary DOM
    // element with ordinary listeners, so it behaves identically everywhere.
    minWidth:      '320px',
    minHeight:     '240px',
    maxWidth:      '100vw',
    maxHeight:     '100vh',
    zIndex:        isModal ? Z_ABOVE2 : String(nextWindowZ()),
  });

  if (!isModal) {
    const offset = nextCascadeOffset();
    Object.assign(box.style, {
      position: 'fixed',
      top:      `${Math.round(win.innerHeight * 0.08) + offset}px`,
      left:     `${Math.round(win.innerWidth * 0.08) + offset}px`,
    });
  }

  const header = doc.createElement('div');
  Object.assign(header.style, {
    display:      'flex',
    alignItems:   'center',
    gap:          '6px',
    padding:      '10px 14px',
    borderBottom: `1px solid ${CLR.menuBorder}`,
    flexShrink:   '0',
  });

  // Bordered icon buttons, matching the gallery-card expand button so overlay
  // and card chrome read as one system.
  const btnStyle: Partial<CSSStyleDeclaration> = {
    border:         `1px solid ${CLR.menuBorder}`,
    borderRadius:   '4px',
    background:     CLR.panelBg,
    cursor:         'pointer',
    color:          CLR.label,
    lineHeight:     '1',
    padding:        '0',
    display:        'flex',
    alignItems:     'center',
    justifyContent: 'center',
    width:          '28px',
    height:         '28px',
  };

  if (opts.title) {
    const titleEl = doc.createElement('span');
    titleEl.textContent = opts.title;
    titleEl.title = opts.title; // native tooltip so the full text is still readable when truncated
    titleEl.dataset.wmapWindowTitle = '1';
    Object.assign(titleEl.style, {
      fontWeight: '700',
      fontSize:   '14px',
      overflow:   'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap',
      minWidth:   '0',
    });
    header.appendChild(titleEl);
  }

  const spacer = doc.createElement('div');
  spacer.style.flex = '1';
  header.appendChild(spacer);

  // Minimize collapses the box to just its header strip (title + buttons) —
  // window mode only. A modal's backdrop still blocks the rest of the page
  // even while "minimized," so minimizing one would be pointless; only a
  // non-modal floating window benefits (the page/gallery stays usable, and
  // now the window itself can be tucked out of the way without closing it).
  let minimizeBtn: HTMLButtonElement | null = null;
  if (!isModal) {
    minimizeBtn = doc.createElement('button');
    minimizeBtn.type = 'button';
    minimizeBtn.innerHTML = ICONS.windowMinimize;
    minimizeBtn.title = 'Minimize';
    minimizeBtn.setAttribute('aria-label', 'Minimize');
    Object.assign(minimizeBtn.style, btnStyle);
    minimizeBtn.addEventListener('click', () => setMinimized(!minimized));
    header.appendChild(minimizeBtn);
  }

  const maximizeBtn = doc.createElement('button');
  maximizeBtn.type = 'button';
  maximizeBtn.innerHTML = ICONS.maximize;
  maximizeBtn.title = 'Maximize (F)';
  maximizeBtn.setAttribute('aria-label', 'Maximize');
  Object.assign(maximizeBtn.style, btnStyle);
  maximizeBtn.addEventListener('click', () => setMaximized(!maximized));

  const closeBtn = doc.createElement('button');
  closeBtn.type = 'button';
  closeBtn.innerHTML = ICONS.close;
  closeBtn.title = 'Close (Esc)';
  closeBtn.setAttribute('aria-label', 'Close');
  Object.assign(closeBtn.style, btnStyle);
  closeBtn.addEventListener('click', close);

  header.appendChild(maximizeBtn);
  header.appendChild(closeBtn);

  // Maximize is a pure CSS toggle — the box grows to fill its fixed-inset
  // backdrop (modal) or the viewport (window). We deliberately avoid the real
  // Fullscreen API: macOS WKWebView (Tauri) only exposes the webkit-prefixed
  // variants and disables element fullscreen unless the host opts into private
  // API (blocks Mac App Store). The CSS toggle behaves identically on every
  // target. The close button stays visible while maximized (no OS chrome to
  // escape), and Esc always closes.
  let maximized = false;
  let preMaximizeTop = '';
  let preMaximizeLeft = '';
  function setMaximized(next: boolean): void {
    maximized = next;
    maximizeBtn.innerHTML = maximized ? ICONS.minimize : ICONS.maximize;
    maximizeBtn.title = maximized ? 'Restore (F)' : 'Maximize (F)';
    maximizeBtn.setAttribute('aria-label', maximized ? 'Restore' : 'Maximize');
    resizeGrip.style.display = maximized ? 'none' : 'block';
    if (maximized) {
      box.style.borderRadius = '0';
      box.style.width = '100vw';
      box.style.height = '100vh';
      if (!isModal) {
        preMaximizeTop = box.style.top;
        preMaximizeLeft = box.style.left;
        box.style.top = '0';
        box.style.left = '0';
      }
    } else {
      box.style.borderRadius = '12px';
      box.style.width = 'min(90vw, 700px)';
      box.style.height = 'min(90vh, 700px)';
      if (!isModal) {
        box.style.top = preMaximizeTop;
        box.style.left = preMaximizeLeft;
      }
    }
    // Keep the onMaximizeChange callback firing on the synthetic toggle so
    // tooltip-reparenting consumers (renderWaferMap / renderWaferGallery) work.
    opts.onMaximizeChange?.(maximized, box);
  }

  // Minimize collapses the box to just its header strip — window mode only
  // (see minimizeBtn setup above). Unlike maximize, this never runs render
  // logic in the collapsed state (the map is simply hidden, not resized to
  // zero), so there's no onMaximizeChange-style callback needed: nothing
  // downstream cares whether the canvas is visible, only whether its box has
  // a resolved size, which is unaffected — contentWrap is hidden, not removed.
  let minimized = false;
  let preMinimizeHeight = '';
  let preMinimizeWidth = '';
  const MINIMIZED_WIDTH = 220;
  function setMinimized(next: boolean): void {
    minimized = next;
    minimizeBtn!.innerHTML = minimized ? ICONS.windowRestore : ICONS.windowMinimize;
    minimizeBtn!.title = minimized ? 'Restore' : 'Minimize';
    minimizeBtn!.setAttribute('aria-label', minimized ? 'Restore' : 'Minimize');
    resizeGrip.style.display = minimized ? 'none' : 'block';
    if (minimized) {
      preMinimizeHeight = box.style.height;
      preMinimizeWidth = box.style.width;
      // minHeight (240px, set on the base box style) would otherwise floor
      // `height: auto` well above the header's own natural height, leaving a
      // large empty rectangle below it instead of a true collapse-to-strip.
      // minWidth (320px) is similarly overridden so the strip can shrink
      // narrower than a full-size window, down to just enough for the title
      // and header buttons — otherwise it stayed as wide as the box was
      // before minimizing, which reads as a large strip, not a small one.
      box.style.minHeight = '0';
      box.style.height = 'auto';
      box.style.minWidth = '0';
      box.style.width = `${MINIMIZED_WIDTH}px`;
      maximizeBtn.disabled = true;
      maximizeBtn.style.opacity = '0.4';
      maximizeBtn.style.cursor = 'default';
      contentWrap.style.display = 'none';
    } else {
      box.style.minHeight = '240px';
      box.style.height = preMinimizeHeight || 'min(90vh, 700px)';
      box.style.minWidth = '320px';
      box.style.width = preMinimizeWidth || 'min(90vw, 700px)';
      maximizeBtn.disabled = false;
      maximizeBtn.style.opacity = '1';
      maximizeBtn.style.cursor = 'pointer';
      contentWrap.style.display = 'flex';
    }
  }

  // Both the header drag and the resize grip below move the pointer across
  // whatever's behind/around the box on every move — without this, the
  // browser's native mousedown-drag text-selection kicks in and bleeds
  // selection highlight into page content behind the floating window.
  // `user-select: none` on doc.body for the duration of the drag (restored on
  // pointerup) suppresses that; preventDefault() alone doesn't cover it since
  // Pointer Events don't inherently block the browser's default text-selection
  // gesture the way a native `resize`/drag-and-drop start would.
  function suppressTextSelectionDuringDrag(): () => void {
    const prevUserSelect = doc.body.style.userSelect;
    doc.body.style.userSelect = 'none';
    return () => { doc.body.style.userSelect = prevUserSelect; };
  }

  // Drag-to-reposition, window mode only. There is no OS-level window manager
  // here — this is a plain `position: fixed` div inside the page (works
  // identically in a browser tab and in a Tauri WebView on every platform), so
  // moving it is something this code has to do itself. Pointer Events (not
  // mouse-specific) so it behaves the same with touch/pen input too. Dragging
  // is disabled while maximized (no meaningful position to drag to).
  if (!isModal) {
    header.style.cursor = 'move';
    header.addEventListener('pointerdown', (e) => {
      if (maximized) return;
      // Let clicks on the maximize/close buttons — or any other button-like
      // interactive element in the header, e.g. the metadata expand toggle
      // (role="button", not a real <button>) — behave normally instead of
      // starting a drag. Without this, pointerdown here calls
      // setPointerCapture()/preventDefault() before the click ever reaches
      // that element: the click is silently swallowed (no error, chevron
      // never flips) and, if the pointer then moves at all — even outside
      // the page, e.g. into devtools, since pointer capture keeps delivering
      // move events regardless of where the cursor visually is — the window
      // drags along with it.
      if ((e.target as HTMLElement).closest('button, [role="button"]')) return;
      e.preventDefault();
      const restoreUserSelect = suppressTextSelectionDuringDrag();
      const startX = e.clientX;
      const startY = e.clientY;
      const startTop = box.offsetTop;
      const startLeft = box.offsetLeft;
      // Cache everything that's constant for the duration of this drag —
      // viewport size and box/header dimensions can't change mid-drag, so
      // re-reading them on every pointermove is a wasted (and reflow-forcing)
      // layout read.
      const maxTop = win.innerHeight - header.offsetHeight;
      const maxLeft = win.innerWidth - 40; // keep a grabbable sliver on-screen
      const minLeft = 40 - box.offsetWidth;
      header.setPointerCapture(e.pointerId);
      const onMove = (e: PointerEvent) => {
        const nextTop = Math.min(Math.max(startTop + (e.clientY - startY), 0), maxTop);
        const nextLeft = Math.min(Math.max(startLeft + (e.clientX - startX), minLeft), maxLeft);
        box.style.top = `${nextTop}px`;
        box.style.left = `${nextLeft}px`;
      };
      const onUp = (e: PointerEvent) => {
        restoreUserSelect();
        header.releasePointerCapture(e.pointerId);
        header.removeEventListener('pointermove', onMove);
        header.removeEventListener('pointerup', onUp);
      };
      header.addEventListener('pointermove', onMove);
      header.addEventListener('pointerup', onUp);
    });
  }

  // Keep keyboard focus inside the dialog while it is open (a11y focus trap).
  // Modal-only: a non-modal window must let Tab leave it naturally.
  const FOCUSABLE =
    'button,[href],input,select,textarea,[tabindex]:not([tabindex="-1"]),[role="menuitem"],[role="menuitemradio"],[role="menuitemcheckbox"]';
  function trapTab(e: KeyboardEvent): void {
    const focusable = Array.from(box.querySelectorAll<HTMLElement>(FOCUSABLE))
      .filter(el => el.offsetParent !== null || el === doc.activeElement);
    if (focusable.length === 0) { e.preventDefault(); box.focus(); return; }
    const first = focusable[0];
    const last  = focusable[focusable.length - 1];
    const active = doc.activeElement as HTMLElement | null;
    if (e.shiftKey && (active === first || !box.contains(active))) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  }

  // Modal mode: one document-level listener owns Escape/E/F/Tab, correct because
  // exactly one modal can ever be open and it always holds the focus trap.
  // Window mode: attached to the box itself (capture phase below), scoped so it
  // only fires while this specific window has focus — required once the page is
  // interactive again and other maps/windows have their own shortcuts. `E` is
  // deliberately NOT a window-close shortcut (unlike modal): a global `E` would
  // be ambiguous with any other map's own "E expands this map" shortcut now that
  // the rest of the page can be interacted with.
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') { close(); return; }
    if (isModal && (e.key === 'e' || e.key === 'E')) { close(); return; }
    if (isModal && e.key === 'Tab') { trapTab(e); return; }
    if ((e.key === 'f' || e.key === 'F') && !minimized) { setMaximized(!maximized); }
  };

  function close() {
    if (isModal) doc.removeEventListener('keydown', onKeyDown);
    else box.removeEventListener('keydown', onKeyDown);
    hideTooltip(doc);
    // Restore doc's shared tooltip to doc.body before tearing down the box it
    // was re-homed into (see reparentTooltip(box) below), otherwise it would
    // be removed along with the box. hideTooltip() itself no longer does this
    // move (see its own comment) since a still-open window must keep the
    // tooltip parented inside it across ordinary hover/unhover cycles — only
    // an overlay that's actually closing should hand it back. Pass doc.body
    // explicitly rather than relying on reparentTooltip()'s no-arg default
    // (the bare global document.body) — this overlay may have built into a
    // DIFFERENT document, and the tooltip must return to THAT document's body.
    reparentTooltip(doc.body);
    if (backdrop) backdrop.remove(); else box.remove();
    if (isModal) doc.body.style.overflow = savedOverflow;
    // Return focus to whatever was focused before the overlay opened.
    previouslyFocused?.focus?.();
    opts.onClose();
  }

  function bringToFront(): void {
    if (isModal) return;
    box.style.zIndex = String(nextWindowZ());
  }

  const contentWrap = doc.createElement('div') as HTMLDivElement;
  Object.assign(contentWrap.style, {
    flex:      '1',
    minHeight: '0',
    minWidth:  '0',
    display:   'flex',
    overflow:  'hidden',
  });

  // Hand-rolled resize grip (Pointer Events, same pattern as the header
  // drag-to-reposition above) instead of native CSS `resize`. Sits as an
  // absolutely-positioned overlay in the bottom-right corner, above the
  // content, so it always receives the pointer regardless of what content
  // wmap or the host renders underneath — no dead-zone/padding needed.
  // Focusable with a keyboard fallback (arrow keys) — a pointer-only grip
  // would otherwise be a real accessibility regression versus native CSS
  // `resize`, which at least some browsers/AT exposed as an adjustable
  // affordance.
  const resizeGrip = doc.createElement('div');
  resizeGrip.tabIndex = 0;
  resizeGrip.setAttribute('role', 'separator');
  resizeGrip.setAttribute('aria-label', 'Resize window (arrow keys, or drag)');
  Object.assign(resizeGrip.style, {
    position: 'absolute',
    right:    '0',
    bottom:   '0',
    width:    '16px',
    height:   '16px',
    cursor:   'nwse-resize',
    touchAction: 'none',
  });
  // A small triangular affordance so the grip is visible, matching the look
  // of a native resize handle.
  resizeGrip.innerHTML =
    '<svg viewBox="0 0 16 16" width="16" height="16" style="display:block"><path d="M15 15 L15 9 M15 15 L9 15 M15 15 L15 3 M15 15 L3 15" stroke="currentColor" stroke-width="1" opacity="0.35" fill="none"/></svg>';
  resizeGrip.style.color = CLR.label;

  const MIN_BOX_WIDTH = 320;
  const MIN_BOX_HEIGHT = 240;
  const RESIZE_KEY_STEP = 20;
  function resizeBoxBy(dw: number, dh: number): void {
    const maxWidth = win.innerWidth - box.offsetLeft;
    const maxHeight = win.innerHeight - box.offsetTop;
    const nextWidth = Math.min(Math.max(box.offsetWidth + dw, MIN_BOX_WIDTH), maxWidth);
    const nextHeight = Math.min(Math.max(box.offsetHeight + dh, MIN_BOX_HEIGHT), maxHeight);
    box.style.width = `${nextWidth}px`;
    box.style.height = `${nextHeight}px`;
  }
  resizeGrip.addEventListener('keydown', (e) => {
    if (maximized || minimized) return;
    switch (e.key) {
      case 'ArrowRight': e.preventDefault(); resizeBoxBy(RESIZE_KEY_STEP, 0); break;
      case 'ArrowLeft':  e.preventDefault(); resizeBoxBy(-RESIZE_KEY_STEP, 0); break;
      case 'ArrowDown':  e.preventDefault(); resizeBoxBy(0, RESIZE_KEY_STEP); break;
      case 'ArrowUp':    e.preventDefault(); resizeBoxBy(0, -RESIZE_KEY_STEP); break;
    }
  });
  resizeGrip.addEventListener('pointerdown', (e) => {
    if (maximized || minimized) return;
    e.preventDefault();
    const restoreUserSelect = suppressTextSelectionDuringDrag();
    const startX = e.clientX;
    const startY = e.clientY;
    const startWidth = box.offsetWidth;
    const startHeight = box.offsetHeight;
    // Cache everything constant for the duration of this resize — viewport
    // size and the box's own left/top can't change mid-resize (only
    // width/height, which this handler itself is mutating), so re-reading
    // them on every pointermove is a wasted, reflow-forcing layout read.
    const maxWidth = win.innerWidth - box.offsetLeft;
    const maxHeight = win.innerHeight - box.offsetTop;
    resizeGrip.setPointerCapture(e.pointerId);
    const onMove = (e: PointerEvent) => {
      const nextWidth = Math.min(Math.max(startWidth + (e.clientX - startX), MIN_BOX_WIDTH), maxWidth);
      const nextHeight = Math.min(Math.max(startHeight + (e.clientY - startY), MIN_BOX_HEIGHT), maxHeight);
      box.style.width = `${nextWidth}px`;
      box.style.height = `${nextHeight}px`;
    };
    const onUp = (e: PointerEvent) => {
      restoreUserSelect();
      resizeGrip.releasePointerCapture(e.pointerId);
      resizeGrip.removeEventListener('pointermove', onMove);
      resizeGrip.removeEventListener('pointerup', onUp);
    };
    resizeGrip.addEventListener('pointermove', onMove);
    resizeGrip.addEventListener('pointerup', onUp);
  });

  box.appendChild(header);
  box.appendChild(contentWrap);
  box.appendChild(resizeGrip);
  if (backdrop) { backdrop.appendChild(box); doc.body.appendChild(backdrop); }
  else doc.body.appendChild(box);

  // Re-home the shared tooltip into the box. The tooltip's z-index (--wmap-z + 1)
  // sits below a modal box (--wmap-z + 2) and could sit below a window box too,
  // so while parented to <body> it can render *behind* an open overlay. Moving it
  // inside the box places it in the box's stacking context, above the canvas
  // content — correct whether or not the overlay is maximized. Restored to
  // <body> in close().
  reparentTooltip(box);

  if (isModal) {
    backdrop!.addEventListener('click', (e) => { if (e.target === backdrop) close(); });
    doc.addEventListener('keydown', onKeyDown);
  } else {
    box.addEventListener('keydown', onKeyDown);
    box.addEventListener('mousedown', bringToFront);
    bringToFront();
  }

  // Move focus into the dialog so the trap has somewhere to start and screen
  // readers announce the dialog. Prefer the close button (a predictable target).
  nextFrame(() => (closeBtn.isConnected ? closeBtn : box).focus(), win);

  return { backdrop, box, contentWrap, close, bringToFront };
}

/** Create and open a resizable, maximizable, exclusive expand modal — dims and
 * blocks the rest of the page. See `openFloatingWindow` for the non-modal form. */
export function openModal(opts: Omit<OverlayOptions, 'mode'>): OverlayHandle {
  return openOverlay({ ...opts, mode: 'modal' });
}

/** Create and open a resizable, maximizable, non-modal floating window — the
 * rest of the page stays fully interactive, and multiple windows may be open at
 * once. See `openModal` for the exclusive/blocking form. */
export function openFloatingWindow(opts: Omit<OverlayOptions, 'mode'>): OverlayHandle {
  return openOverlay({ ...opts, mode: 'window' });
}

// ── Shared toolbar button builders ────────────────────────────────────────────
// Each builder takes a ToolbarHelpers instance plus getter/setter callbacks so
// callers (renderWaferMap, renderWaferGallery) can wire their own state without
// any circular imports. Each returns { btn, sync } — call sync() after any
// view-options change to update button visibility/active state.

export function makePaletteBtn(
  helpers: ToolbarHelpers,
  getPlotMode: () => PlotMode,
  getColorScheme: () => string,
  hasCustomColors: () => boolean,
  setColorScheme: (v: string) => void,
): HTMLButtonElement {
  return helpers.makeDropdown(
    'palette', 'Colour scheme',
    () => {
      const isBinMode = getPlotMode() === 'hardBin' || getPlotMode() === 'softBin';
      const schemes = isBinMode
        ? listColorSchemes().filter(s => s.name === 'default' || s.name === 'accessible')
        : listColorSchemes();
      return [
        ...(hasCustomColors() ? [{ value: 'custom', label: 'Custom' }] : []),
        ...schemes.map(s => ({ value: s.name, label: s.label })),
      ];
    },
    () => getColorScheme(),
    v => setColorScheme(v),
  );
}

/** Requested pass/fail display resolved from the new option and its deprecated alias. */
export function requestedPassFailDisplay(
  opts: { passFailDisplay?: 'off' | 'spec' | 'test'; colorBySpec?: boolean },
): 'off' | 'spec' | 'test' {
  return opts.passFailDisplay ?? (opts.colorBySpec ? 'spec' : 'off');
}

/**
 * The two mutually exclusive pass/fail display entries for the overlays menu,
 * shared by renderWaferMap and renderWaferGallery. Each entry appears only when
 * valid for the active test (library-derived): "Spec pass/fail" needs limits,
 * "Test pass/fail" needs at least one recorded verdict. A functional active
 * test returns no entries at all — its value mode IS test pass/fail, there is
 * no alternative display to choose.
 */
export function passFailMenuRows(
  state: { functionalActive: boolean; hasLimits: boolean; hasRecorded: boolean; display: 'off' | 'spec' | 'test' },
  setDisplay: (d: 'off' | 'spec' | 'test') => void,
): CheckMenuRow[] {
  if (state.functionalActive) return [];
  const rows: CheckMenuRow[] = [];
  if (state.hasLimits) rows.push({
    label: 'Spec pass/fail',
    active: state.display === 'spec',
    onClick: () => setDisplay(state.display === 'spec' ? 'off' : 'spec'),
  });
  if (state.hasRecorded) rows.push({
    label: 'Test pass/fail',
    active: state.display === 'test',
    onClick: () => setDisplay(state.display === 'test' ? 'off' : 'test'),
  });
  return rows;
}

export function makeLogScaleBtn(
  helpers: ToolbarHelpers,
  getOpts: () => { plotMode?: PlotMode; logScale?: boolean; colorBySpec?: boolean; passFailDisplay?: 'off' | 'spec' | 'test'; functionalActive?: boolean },
  setOpts: (patch: { logScale: boolean }) => void,
): { btn: HTMLButtonElement; sync: () => void } {
  const btn = helpers.makeBtn('logScale', 'Toggle log scale', () => {
    setOpts({ logScale: !getOpts().logScale });
  });
  function sync(): void {
    const opts = getOpts();
    const m = opts.plotMode;
    const isValueMode = m === 'value' || m === 'stackedValues';
    // Hidden under any solid pass/fail display (no value axis to scale) and for a
    // functional active test (which never has a value axis).
    btn.style.display = (isValueMode && requestedPassFailDisplay(opts) === 'off' && !opts.functionalActive) ? '' : 'none';
    helpers.setActive(btn, !!opts.logScale);
  }
  return { btn, sync };
}

export type LegendPosition = 'default' | 'compact' | 'left' | 'top' | 'bottom' | 'floating';

export function makeLegendStyleBtn(
  helpers: ToolbarHelpers,
  getOpts: () => { plotMode?: PlotMode; legendPosition?: LegendPosition },
  setLegendPosition: (v: LegendPosition) => void,
): { btn: HTMLButtonElement; sync: () => void } {
  const btn = helpers.makeDropdown(
    'legend', 'Legend style',
    () => [
      { value: 'default'  as const, label: 'Default (right)' },
      { value: 'compact'  as const, label: 'Compact (right)' },
      { value: 'left'     as const, label: 'Left' },
      { value: 'top'      as const, label: 'Top' },
      { value: 'bottom'   as const, label: 'Bottom' },
      { value: 'floating' as const, label: 'Floating' },
    ],
    () => getOpts().legendPosition ?? 'default',
    v => setLegendPosition(v),
  );
  function sync(): void {
    const m = getOpts().plotMode;
    btn.style.display = (m === 'hardBin' || m === 'softBin') ? '' : 'none';
  }
  return { btn, sync };
}

export function makeOverlaysBtn(
  helpers: ToolbarHelpers,
  getRows: () => CheckMenuRow[],
  isAnyOn: () => boolean,
): HTMLButtonElement {
  return helpers.makeCheckMenuBtn(
    'overlays', 'Overlays',
    () => getRows(),
    (btn) => helpers.setActive(btn, isAnyOn()),
  );
}

export function makeOrientationBtn(
  helpers: ToolbarHelpers,
  getOpts: () => { rotation?: number; flipX?: boolean; flipY?: boolean },
  setOpts: (patch: { rotation?: 0 | 90 | 180 | 270; flipX?: boolean; flipY?: boolean }) => void,
): HTMLButtonElement {
  return helpers.makeCheckMenuBtn(
    'orient', 'Orientation',
    () => [
      { section: 'Rotate' },
      { label: 'Rotate 90° clockwise', active: false, onClick: () => {
        const r = (getOpts().rotation ?? 0) as 0 | 90 | 180 | 270;
        setOpts({ rotation: ROTATIONS[(ROTATIONS.indexOf(r) + 1) % 4] });
      }},
      { section: 'Flip' },
      { label: 'Flip horizontal', active: !!getOpts().flipX, onClick: () => setOpts({ flipX: !getOpts().flipX }) },
      { label: 'Flip vertical',   active: !!getOpts().flipY, onClick: () => setOpts({ flipY: !getOpts().flipY }) },
    ],
    (btn) => {
      const { rotation, flipX, flipY } = getOpts();
      helpers.setActive(btn, !!(rotation || flipX || flipY));
    },
  );
}

// ── User guide window ───────────────────────────────────────────────────────────
//
// Non-modal: the guide has no reparented content (it's freshly built HTML,
// destroyed on close) and a user plausibly wants to keep it open while trying a
// feature on the live page behind it — unlike the gallery/single-map expand,
// there's no "hole left behind" risk here. At most one guide window is allowed
// open at a time (enforced below); this keeps window.__wmapDemoApi safe as a
// single global without needing to make it instance-scoped, since the guide's
// demo widgets only ever call the library's own stateless factory functions
// (buildWaferMap/renderWaferMap/renderWaferGallery/analyzeWaferMap) — never
// host-app state — so it doesn't matter which map's help button opened it.

/** Only `.close()` is ever called on this — deliberately narrower than
 *  `OverlayHandle` so both the floating-window branch (which returns a real
 *  `OverlayHandle`, a structural superset) and the popup branch (which has
 *  no backdrop/box/contentWrap to speak of) can satisfy it without a cast. */
interface GuideHandle { close: () => void; }
let openGuideHandle: GuideHandle | null = null;

type GuideApi = { buildWaferMap: unknown; renderWaferMap: unknown; renderWaferGallery: unknown; analyzeWaferMap: unknown };

/**
 * Host-supplied content inserted into wmap's own embedded user-guide window,
 * so a host app's own documentation and wmap's reference live behind one
 * help button instead of two separate ones.
 */
export interface UserGuideExtension {
  /**
   * Host-provided HTML, inserted before wmap's own guide content. Static
   * content only — must not contain `<script>` tags. wmap re-executes
   * exactly one inline script (its own live-demo bootstrap, always the
   * last element in `html`) by finding the content div's first
   * `<script>` in document order; a `<script>` in this HTML would be
   * found instead, silently breaking wmap's own live demos.
   */
  html: string;
  /**
   * Overrides the window's title text (default `'Wafer Map — User Guide'`).
   * Use this when the host's own content should frame the whole document —
   * wmap's own `<h1>` stays as-is further down the page, so the result
   * reads as one combined guide with the host's section first, not a title
   * rewrite.
   */
  title?: string;
}

/**
 * Builds the guide's content div in `doc` (its own document — the floating
 * window shares the host's; a popup has its own) and inserts `contentHtml`.
 * Does **not** activate the inline live-demo script yet — see
 * `activateGuideScripts`, which the caller must run only after this `content`
 * element is connected to `doc`. `targetWindow.__wmapDemoApi` is set here (for
 * that script to read once it runs) and restored (not just cleared) on close —
 * guards a race where a second `openUserGuideWindow` call already overwrote it
 * with a newer api before this older instance's own close handler runs.
 */
function buildGuideContent(doc: Document, targetWindow: Window, contentHtml: string, api: GuideApi): { content: HTMLElement; restoreApi: () => void } {
  const w = targetWindow as any;
  const prevApi = w.__wmapDemoApi;
  w.__wmapDemoApi = api;
  const content = doc.createElement('div');
  content.innerHTML = contentHtml;
  return { content, restoreApi: () => { if (w.__wmapDemoApi === api) w.__wmapDemoApi = prevApi; } };
}

/**
 * Re-executes the guide's one inline live-demo script and mounts the demos.
 * `innerHTML` never runs scripts, so the inert one `content` already has (from
 * `buildGuideContent`) is found and cloned into a fresh `<script>` element,
 * which *does* execute — but only once inserted into a **connected** document;
 * a `<script>` appended to a still-detached element does not run (verified
 * directly: Chromium only performs a script element's insertion steps once it
 * becomes part of the document tree). So this must be called strictly *after*
 * `content` has been appended into `doc` (`contentWrap`/`body`) — calling it
 * before, as an earlier version of this code did, leaves
 * `window.__wmapPopulateGuideDemos` undefined at the time it's read here,
 * silently no-opping every demo mount (found via a live guide window showing
 * empty `data-wmap-demo` divs — the exact regression this split fixes).
 */
function activateGuideScripts(content: HTMLElement, targetWindow: Window): void {
  const w = targetWindow as any;
  const inert = content.querySelector('script');
  if (inert) {
    const s = content.ownerDocument.createElement('script');
    s.textContent = inert.textContent;
    content.appendChild(s);
    const guideEl = content.querySelector<HTMLElement>('.wmap-guide');
    if (guideEl) w.__wmapPopulateGuideDemos?.(guideEl);
  }
}

/** In-page fallback — unchanged from before `window.open` support was added. */
function openGuideInFloatingWindow(title: string, contentHtml: string, api: GuideApi): OverlayHandle {
  const { content, restoreApi } = buildGuideContent(document, window, contentHtml, api);
  Object.assign(content.style, { flex: '1', overflow: 'auto', minHeight: '0' });
  const handle = openFloatingWindow({
    title,
    // Maximising widens the reading measure (720px → 1000px) so the guide uses
    // the extra space without lines growing uncomfortably long. Toggled via a
    // class so the cap lives in the guide stylesheet, not inline here.
    onMaximizeChange: (isMaximized) => {
      content.querySelector('.wmap-guide')?.classList.toggle('wmap-guide--max', isMaximized);
    },
    onClose: () => {
      if (openGuideHandle === handle) openGuideHandle = null;
      restoreApi();
    },
  });
  handle.contentWrap.appendChild(content);
  activateGuideScripts(content, window);
  return handle;
}

/** Real, separate OS window — draggable outside the host window's own
 *  bounds, the same upgrade gallery card detach already has. Mirrors
 *  `renderWaferGallery.ts`'s `openWindowForCard` real-popup branch: bare
 *  DOM APIs (no `document.write`, which risks silently breaking later
 *  `ResizeObserver` callbacks in some engines), an explicit font stack
 *  (a popup never inherits the host page's own CSS reset), and a themed,
 *  synced `--wmap-*` copy (see `syncWmapPopupTheme`'s doc comment). */
function openGuideInPopup(popupWin: Window, title: string, contentHtml: string, api: GuideApi): GuideHandle {
  const doc = popupWin.document;
  doc.title = title;
  Object.assign(doc.documentElement.style, { height: '100%' });
  Object.assign(doc.body.style, {
    margin: '0', height: '100vh', overflow: 'hidden', display: 'flex', flexDirection: 'column',
    fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
  });
  // Not tied to any one render container (the guide can be opened from a
  // single map, a gallery, or programmatically via a controller's own
  // openUserGuide()) — document.documentElement is the only sensible,
  // always-available theme source here.
  copyWmapThemeTokens(document.documentElement, doc.documentElement);
  const stopThemeSync = syncWmapPopupTheme(document.documentElement, doc.documentElement);

  const { content, restoreApi } = buildGuideContent(doc, popupWin, contentHtml, api);
  Object.assign(content.style, { flex: '1', overflow: 'auto', minHeight: '0' });
  doc.body.appendChild(content);
  activateGuideScripts(content, popupWin);

  let closed = false;
  const cleanup = () => {
    if (closed) return;
    closed = true;
    clearInterval(closePollId);
    stopThemeSync();
    restoreApi();
    if (openGuideHandle === handle) openGuideHandle = null;
  };
  const closePollId = setInterval(() => { if (popupWin.closed) cleanup(); }, 400);
  popupWin.addEventListener('pagehide', cleanup);
  const handle: GuideHandle = { close: () => { if (!popupWin.closed) popupWin.close(); cleanup(); } };
  return handle;
}

/**
 * Open the embedded user-guide window and populate its live demos. Closes any
 * previously open guide window first (at most one may be open at a time).
 * `api` must contain the four library functions the guide demos call at runtime.
 * `html` is USER_GUIDE_HTML — passed in so toolbar.ts has no dependency on userGuideHtml.ts.
 * `extension`, when provided, prepends host content and/or overrides the window title — see `UserGuideExtension`.
 *
 * Opens a real, separate window when available (draggable outside the host
 * window's own bounds), falling back to the in-page floating window when
 * `window.open` is blocked/unavailable — silently returns `null` in some
 * embedded WebViews (Tauri, Electron, WebView2), same gap `openDetachWindow`
 * exists for. Unlike gallery card detach, this doesn't go through
 * `setDetachWindowOpener` — that opener's contract is scoped to per-wafer
 * detach windows a host may have built specifically for that shape of
 * content, and reusing it silently for the guide would broaden it without
 * documentation.
 */
export function openUserGuideWindow(
  api: GuideApi,
  html: string,
  extension?: UserGuideExtension,
): void {
  if (openGuideHandle) { openGuideHandle.close(); openGuideHandle = null; }

  const title = extension?.title ?? 'Wafer Map — User Guide';
  const contentHtml = (extension?.html ?? '') + html;
  const popupWin = window.open('', '_blank', 'width=800,height=820');
  openGuideHandle = popupWin
    ? openGuideInPopup(popupWin, title, contentHtml, api)
    : openGuideInFloatingWindow(title, contentHtml, api);
}
