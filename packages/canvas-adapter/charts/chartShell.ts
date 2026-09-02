// Shared chrome for wmap's own chart panels (Analysis tab). Ported from
// tsmap's charts/chartShell.ts — the first host to build this layer — trimmed
// to what the first panel (capability) needs: a card shell, canvas
// fill-height helpers for a full-height tab layout, and PNG save. Uses
// wmap's own `--wmap-*` theme tokens (`CLR`, canvas-adapter/toolbar.ts) so
// panels match the surrounding chrome for free, in any host's theme.

import { SHADOW, LEADING, wireControlHover, controlStyle, SPACE, RADIUS, fontPx, FONT, CLR, Z_BASE, menuLayerFor, MENU_SEARCH_THRESHOLD, makeMenuSearchBox, markMenuTrigger, saveImageBlob, openReparentedModal, type SaveImageHandler } from '../toolbar.js';
import { ICONS } from '../icons.js';
import { fmt, fmtColorbarAxis } from '../../renderer/fmt.js';

export type { SaveImageHandler };

// ── Expand modal ─────────────────────────────────────────────────────────────
// Reuses wmap's own `openReparentedModal` (canvas-adapter/toolbar.ts) — the
// same reparent-into-a-modal-and-restore helper renderWaferMap.ts's own
// expand button uses, not something specific to chart cards or wafer-map
// canvases — rather than building a second, parallel version of the same
// dance (and its same two easy-to-get-wrong edge cases; see that helper's
// own header comment). A chart card gets resize/maximize/Esc/focus-trap for
// free this way too, matching the wafer-map popups' own feature set.

/**
 * `triggerBtn`, when given, is hidden for the modal's duration and shown
 * again on close — a card already sitting inside its own expand modal must
 * not offer a second "expand" of itself: clicking it would reparent the same
 * card into a *second*, nested modal, leaving the first one open but empty
 * (found via exactly that — every card kept its expand icon once expanded).
 */
export function openChartExpandModal(card: HTMLElement, title: string, triggerBtn?: HTMLButtonElement): void {
  // The card is about to be reparented into the modal. Any hover tip currently
  // showing would travel with it and never be dismissed — the control it
  // belongs to is hidden while expanded, so no mouseleave can fire.
  for (const tip of card.querySelectorAll<HTMLElement>('div[style*="position: absolute"]')) {
    if (tip.style.display === 'block' && tip.style.pointerEvents === 'none') tip.style.display = 'none';
  }
  const savedStyle = card.getAttribute('style') ?? '';
  Object.assign(card.style, { flex: '1', minHeight: '0', border: 'none', borderRadius: '0' } as Partial<CSSStyleDeclaration>);

  const handle = openReparentedModal([card], {
    title,
    onClosed: () => {
      card.setAttribute('style', savedStyle);
      if (triggerBtn) triggerBtn.style.display = 'flex';
    },
  });
  if (!handle) { card.setAttribute('style', savedStyle); return; } // already expanded — re-entrancy guard

  if (triggerBtn) triggerBtn.style.display = 'none';
}

// ── Canvas-safe theme colors ─────────────────────────────────────────────────
// `CLR`'s values are `var(--wmap-…, fallback)` strings — correct for DOM
// element `.style` assignments (CSSOM resolves `var()` fine there), but
// canvas 2D contexts do NOT understand `var()` syntax in `fillStyle`/
// `strokeStyle` at all. An invalid value there is silently ignored, leaving
// whatever color was last validly set — which made a hover highlight render
// as a solid block in the previous draw call's leftover fill color instead
// of a subtle tint (found via a real user report). Canvas drawing must use
// *resolved* concrete color strings instead, read from the live computed
// style the same way `canvas-adapter/canvasTheme.ts`'s `resolveCanvasTheme`
// already does for the map canvas — this is that same fix, for chart panels.
export interface ChartCanvasColors {
  text: string;
  textMuted: string;
  border: string;
  bg: string;
  bgHover: string;
  /** Subtle bar/row "track" background (full-extent backdrop behind a value bar) — deliberately much softer than `border`, which reads as a visible grey line/fill, not a backdrop. */
  track: string;
  warnBorder: string;
}

const CHART_COLOR_FALLBACKS: Record<keyof ChartCanvasColors, string> = {
  text: '#333',
  textMuted: '#66788a',
  border: 'rgba(0,0,0,0.12)',
  bg: '#fff',
  bgHover: '#edf0f8',
  track: '#fafbfc',
  warnBorder: '#f0c040',
};

const CHART_COLOR_TOKEN: Record<keyof ChartCanvasColors, string> = {
  text: 'text',
  textMuted: 'text-muted',
  border: 'border',
  bg: 'surface',
  bgHover: 'bg-hover',
  track: 'panel-bg',
  warnBorder: 'warn-border',
};

/** Resolve `--wmap-*` custom properties to concrete color strings for canvas
 *  drawing. Call once per draw (not cached) so a live theme change is picked
 *  up on the next redraw, matching `resolveCanvasTheme`'s own contract. */
export function resolveChartCanvasColors(el: HTMLElement): ChartCanvasColors {
  const cs = getComputedStyle(el);
  const out = {} as ChartCanvasColors;
  for (const key of Object.keys(CHART_COLOR_TOKEN) as Array<keyof ChartCanvasColors>) {
    const v = cs.getPropertyValue(`--wmap-${CHART_COLOR_TOKEN[key]}`).trim();
    out[key] = v || CHART_COLOR_FALLBACKS[key];
  }
  return out;
}

// ── Shared layout constants ─────────────────────────────────────────────────
// Row-based panels (boxplot, histogram, ...) share these so spacing stays
// consistent across panels instead of each redefining its own copy.

export const PADDING = 12;
export const VALUE_WIDTH = 100;

// ── ResizeObserver lifecycle ───────────────────────────────────────────────────
// Per-panel, not a module-global registry: a library component can have many
// concurrent instances on one page (multiple `renderWaferGallery` calls), so
// a shared registry would let one instance's teardown silently disconnect
// another's observers. Each panel owns and disconnects its own.

export function observeResize(el: HTMLElement, onResize: () => void): { disconnect: () => void } {
  // Coalesced onto the next frame rather than run during delivery. Panel
  // redraws write layout (canvas sizing, and `card.style.minHeight` via
  // growCardToFitContent) back onto the element being observed, which inside
  // the callback is what produces the browser's "ResizeObserver loop
  // completed with undelivered notifications" error and drops notifications.
  // Deferring puts the write in the next frame, where it is an ordinary
  // layout change; several notifications arriving in one frame collapse into
  // a single redraw, which is also what a drag-resize actually wants.
  //
  // Constructed through the element's OWN window: a chart card can live in a
  // detached popup whose DOM was built by JS running in the opener's realm,
  // and an observer from the wrong realm has its delivery tied to the wrong
  // document's frame lifecycle (same bug class as the note in
  // renderWaferMap.ts's own observer).
  const win = el.ownerDocument.defaultView ?? window;
  let queued = 0;
  const ro = new win.ResizeObserver(() => {
    if (queued) return;
    queued = win.requestAnimationFrame(() => { queued = 0; onResize(); });
  });
  ro.observe(el);
  return {
    disconnect: () => {
      if (queued) win.cancelAnimationFrame(queued);
      queued = 0;
      ro.disconnect();
    },
  };
}

// ── Fill-height canvas (tab takes over the full container) ─────────────────────
// The Analysis tab always gives its content the full container height (unlike
// tsmap's original grid-vs-modal duality), so a fill-canvas here just reads
// the card's actual flex-allocated height every draw.

/**
 * Sets `card`'s own min-height so `body` can actually display
 * `contentHeight` px of content without `body`'s own `overflow-y: auto`
 * (see `cardShell`) silently turning any shortfall into a scrollbar.
 * Computed from `card`'s *live* chrome overhead (heading row, hint text,
 * padding) — not a guessed constant passed in from elsewhere, so it can
 * never drift out of sync with what the panel actually needs (a fixed
 * `card.style.minHeight` guessed once by the composer, as `analysisTab.ts`
 * used to do, drifts the moment hint text length or content height changes).
 *
 * Always *sets* the value fresh, never just grows it — `card`'s container
 * isn't always monotonically growing. The chart-expand modal
 * (`openChartExpandModal`) reparents this same card into a *resizable* box
 * (drag-resize, maximize/restore); a "only grow, never shrink" policy would
 * leave a stale, too-large min-height stuck from a bigger prior size after
 * the modal shrinks, forcing the exact overflow this function exists to
 * prevent. Recomputing from `card`'s current live overhead every call is
 * self-correcting in both directions and converges in one extra resize-
 * observer pass (chrome overhead doesn't change with `card`'s own height,
 * so the fixed point is reached immediately, not oscillating).
 *
 * The Analysis tab composes several of these cards into one CSS Grid row
 * per section (`makeChartGridWrap`); nothing about that grid's own row
 * auto-sizing knows a card needs more room unless the card itself asks for
 * it via `min-height` — a `position: absolute` canvas (`applyCanvasFlow`) is
 * out of normal flow and invisible to it, and even an in-flow one won't ask
 * on its own before this runs.
 *
 * Shared by two different content-sizing patterns:
 * - `chartFillHeight` below: canvas fills whatever's left in `body`.
 * - Panels with a fixed row cap and their own deliberate inner scroll area
 *   for the rest (`barPanel.ts`, `boxplot.ts`, `binCluster.ts`) call this
 *   directly with their visible-rows height.
 */
export function growCardToFitContent(card: HTMLElement, body: HTMLElement, contentHeight: number): void {
  const overhead = card.offsetHeight - body.clientHeight;
  const next = `${overhead + contentHeight}px`;
  // Every panel observes `card` and calls this from inside that callback, so an
  // unconditional write re-invalidates the very element being observed and the
  // browser reports "ResizeObserver loop completed with undelivered
  // notifications". Writing only on an actual change lets the loop terminate:
  // the corrective pass this function is designed around still happens, but the
  // pass after it is a no-op instead of another notification.
  if (card.style.minHeight !== next) card.style.minHeight = next;
}

/**
 * Canvas height for a "fill the body" chart: siblings already in `body`
 * above the canvas (a stats label, a legend, ...) get their own natural
 * height, and the canvas gets whatever's left — floored at `minHeight` so
 * it never renders squashed below its own readable minimum. See
 * `growCardToFitContent` above for how `card` is kept large enough to
 * actually deliver that floor.
 */
export function chartFillHeight(card: HTMLElement, body: HTMLElement, canvas: HTMLCanvasElement, minHeight: number): number {
  let siblingHeight = 0;
  for (const child of Array.from(body.children)) {
    if (child !== canvas) siblingHeight += (child as HTMLElement).offsetHeight;
  }
  growCardToFitContent(card, body, siblingHeight + minHeight);
  // Re-read after the resize above so a card that just changed size reports
  // its now-correct body height in the same pass, not next redraw.
  return Math.max(minHeight, body.clientHeight - siblingHeight);
}

export function applyCanvasFlow(canvas: HTMLCanvasElement, topOffset = 0): void {
  canvas.style.position = 'absolute';
  canvas.style.left = '0';
  canvas.style.right = '0';
  canvas.style.top = `${topOffset}px`;
  canvas.style.bottom = '0';
}

// ── Formatting ───────────────────────────────────────────────────────────────

/**
 * Format a bare numeric value (no unit) for chart labels/tooltips —
 * callers append their own unit string separately when they have one. Uses
 * `fmt`'s engineering-notation fallback (fixed decimal for [0.1, 9999],
 * `NEexp` outside that range) rather than a plain `.toFixed(2)`, which
 * silently collapsed small-scale measurements (e.g. a 33.3 pA mean, as
 * `3.33e-11`) to a misleading "0.00".
 */
export function formatValue(v: number): string {
  if (!Number.isFinite(v)) return '—';
  return Number.isInteger(v) ? `${v}` : fmt(v, undefined, 'engineering');
}

/**
 * Shared axis formatter for a numeric chart axis: one SI scale chosen from
 * the largest-magnitude endpoint, applied to every tick, with the scaled
 * unit returned once as the axis label (e.g. ticks "861 · 1040 · 1220"
 * with label "(µA)") — the same `fmtColorbarAxis` contract the map's
 * colorbar uses, so axes never show raw exponent soup like "861E-6" next
 * to a tooltip that says "861 µA". Falls back to `formatValue` ticks and
 * no label when the test has no unit.
 */
export function makeAxisFormat(vRef: number, unit: string | undefined): { tick: (v: number) => string; unitLabel: string } {
  if (!unit) return { tick: formatValue, unitLabel: '' };
  const { tickFmt, axisLabel } = fmtColorbarAxis(vRef, null, unit);
  return { tick: tickFmt, unitLabel: axisLabel };
}

/** Draw a small "(unit)" label at (x, y), restoring the context's text state afterward. */
export function drawAxisUnit(ctx: CanvasRenderingContext2D, unit: string, x: number, y: number, color: string): void {
  const prev = { textAlign: ctx.textAlign, textBaseline: ctx.textBaseline, fillStyle: ctx.fillStyle, font: ctx.font };
  ctx.font = `${fontPx(-1)}px system-ui, sans-serif`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = color;
  ctx.fillText(`(${unit})`, x, y);
  Object.assign(ctx, prev);
}

// ── PNG save ─────────────────────────────────────────────────────────────────
// Reuses toolbar.ts's saveImageBlob — the same save-hook dance renderWaferMap
// and renderWaferGallery already use — rather than a third parallel copy.

export function saveCanvasPng(canvas: HTMLCanvasElement, filenameStem: string, onSaveImage?: SaveImageHandler): void {
  const flat = canvas.ownerDocument.createElement('canvas');
  flat.width = canvas.width;
  flat.height = canvas.height;
  const ctx = flat.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, flat.width, flat.height);
  ctx.drawImage(canvas, 0, 0);
  flat.toBlob(blob => {
    if (blob) saveImageBlob(blob, filenameStem, onSaveImage);
  }, 'image/png');
}

// ── Card shell ───────────────────────────────────────────────────────────────

export interface CardShell {
  card: HTMLElement;
  heading: HTMLElement;
  controlsRow: HTMLElement;
  body: HTMLElement;
}

/**
 * The card frame — background, border, radius, padding, numeral alignment.
 * Shared so a card is a card wherever it is built: `cardShell` (chart panels)
 * and `insightsTab`'s `plainCard` (the test-value and functional tables) both
 * take it from here. They previously restated these values independently and
 * drifted apart.
 */
export function cardFrameStyle(): Partial<CSSStyleDeclaration> {
  return {
    background: CLR.menuBg,
    border: `1px solid ${CLR.menuBorder}`,
    borderRadius: RADIUS.container,
    padding: SPACE.xl,
    fontVariantNumeric: 'tabular-nums',
  };
}

export function cardShell(title: string, onSaveImage?: SaveImageHandler, ownerDocument: Document = document): CardShell {
  const card = ownerDocument.createElement('div');
  // Stable test/tooling hooks — this card carries no other id/class, and
  // its heading is a bare div matched today only by user-visible text (see
  // tsmap's WMAP_ISSUES.md #36). Follows the existing data-wmap-* convention
  // (data-wmap-toolbar, data-wmap-finding, …) — not for styling.
  card.dataset.wmapChartCard = '1';
  card.dataset.wmapChartTitle = title;
  Object.assign(card.style, {
    display: 'flex', flexDirection: 'column',
    ...cardFrameStyle(),
    minWidth: '0', minHeight: '0', flex: '1 1 0', position: 'relative',
  } as Partial<CSSStyleDeclaration>);

  const headingRow = card.ownerDocument.createElement('div');
  Object.assign(headingRow.style, { display: 'flex', alignItems: 'center', gap: SPACE.sm,
    paddingBottom: '6px', marginBottom: SPACE.md, borderBottom: `1px solid ${CLR.menuBorder}` } as Partial<CSSStyleDeclaration>);
  const heading = card.ownerDocument.createElement('div');
  heading.textContent = title;
  Object.assign(heading.style, { color: CLR.value, fontSize: FONT.heading, fontWeight: '600', flex: '1' } as Partial<CSSStyleDeclaration>);
  headingRow.appendChild(heading);

  // One themed tooltip for this card's own header controls, replacing the
  // native `title` they used to carry — see attachChartTip and the policy note
  // in toolbar.ts. Panels still make their own tooltip for hover DATA; this one
  // only serves the header, so the two never fight over the same element.
  const headerTip = makeTooltip(card);

  const saveBtn = card.ownerDocument.createElement('button');
  saveBtn.type = 'button';
  saveBtn.setAttribute('aria-label', 'Save as PNG');
  saveBtn.innerHTML = ICONS.download;
  Object.assign(saveBtn.style, {
    ...controlStyle('outlined'),
    color: CLR.label, padding: '0', width: '22px', height: '22px', lineHeight: LEADING.none, flexShrink: '0',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  } as Partial<CSSStyleDeclaration>);
  wireControlHover(saveBtn);
  attachChartTip(saveBtn, card, headerTip, 'Save as PNG');
  saveBtn.addEventListener('click', () => {
    const canvas = card.querySelector<HTMLCanvasElement>('canvas');
    if (canvas) saveCanvasPng(canvas, title, onSaveImage);
  });
  headingRow.appendChild(saveBtn);

  const expandBtn = card.ownerDocument.createElement('button');
  expandBtn.type = 'button';
  expandBtn.setAttribute('aria-label', 'Expand');
  expandBtn.innerHTML = ICONS.expand;
  Object.assign(expandBtn.style, {
    ...controlStyle('outlined'),
    color: CLR.label, padding: '0', width: '22px', height: '22px', lineHeight: LEADING.none, flexShrink: '0',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  } as Partial<CSSStyleDeclaration>);
  wireControlHover(expandBtn);
  attachChartTip(expandBtn, card, headerTip, 'Expand');
  expandBtn.addEventListener('click', () => openChartExpandModal(card, heading.textContent ?? title, expandBtn));
  headingRow.appendChild(expandBtn);
  card.appendChild(headingRow);

  const controlsRow = card.ownerDocument.createElement('div');
  Object.assign(controlsRow.style, {
    display: 'flex', gap: SPACE.sm, marginBottom: SPACE.md, flexWrap: 'wrap', alignItems: 'center',
  } as Partial<CSSStyleDeclaration>);
  card.appendChild(controlsRow);

  const body = card.ownerDocument.createElement('div');
  // No overflow-y by default. `growCardToFitContent`'s whole contract is
  // "card grows to make body exactly big enough for its content" — a
  // panel that trusts that contract should never need to scroll body at
  // all. Letting body scroll "just in case" is actively harmful: a
  // scrollbar toggling on/off changes body's own width, which can change
  // wrapped content's height (e.g. a flex-wrap legend), which changes the
  // size growCardToFitContent computes next, which can re-toggle the
  // scrollbar — an unbounded resize loop with no natural fixed point.
  // Panels whose content can genuinely outgrow their cap (boxplot's body
  // directly, or barPanel/binCluster's own inner scrollArea) opt back
  // into overflow-y themselves, deliberately, at the one place that needs
  // it — matching toCanvas.ts's own read-only sizing pattern, where a
  // canvas never has any way to influence the size of what's sizing it.
  //
  // overflowX is 'hidden' too, not left at its 'visible' default: per the
  // CSS overflow spec, pairing 'visible' on one axis with a non-'visible'
  // value on the other forces the 'visible' one to compute as 'auto'
  // instead — so leaving x unset here would silently turn it into a real
  // scrollbar axis, defeating the point of hiding y. Panels with
  // deliberate horizontal scroll (capability/correlation, many test
  // columns) override this explicitly, same as the overflow-y opt-ins.
  Object.assign(body.style, { overflowX: 'hidden', overflowY: 'hidden', minHeight: '0', flex: '1', position: 'relative' } as Partial<CSSStyleDeclaration>);
  card.appendChild(body);

  return { card, heading, controlsRow, body };
}

// ── Segmented control ────────────────────────────────────────────────────────
// A self-contained radio group (e.g. yield sort, hard/soft bin toggle) —
// ported from tsmap's charts/chartShell.ts.

export function makeSegmented(
  options: Array<[value: string, label: string]>,
  current: string,
  onChange: (value: string) => void,
  ownerDocument: Document = document,
  /** Smaller type/padding for the summary panel's 260px column, where the
   *  chart-card sizing overflows a section header. Charts keep the default. */
  compact = false,
): HTMLElement {
  const group = ownerDocument.createElement('div');
  group.setAttribute('role', 'radiogroup');
  Object.assign(group.style, { display: 'inline-flex', border: `1px solid ${CLR.menuBorder}`, borderRadius: RADIUS.control, overflow: 'hidden' } as Partial<CSSStyleDeclaration>);
  const name = `seg-${Math.random().toString(36).slice(2, 9)}`;
  const paints: Array<() => void> = [];

  options.forEach(([value, text], i) => {
    const label = ownerDocument.createElement('label');
    Object.assign(label.style, {
      display: 'inline-flex', alignItems: 'center',
      fontSize: FONT.body,
      padding:  compact ? '1px 6px' : '3px 10px',
      cursor: 'pointer', userSelect: 'none',
      borderLeft: i > 0 ? `1px solid ${CLR.menuBorder}` : 'none',
    } as Partial<CSSStyleDeclaration>);

    const radio = ownerDocument.createElement('input');
    radio.type = 'radio';
    radio.name = name;
    radio.value = value;
    radio.checked = value === current;
    Object.assign(radio.style, { position: 'absolute', opacity: '0', width: '0', height: '0' } as Partial<CSSStyleDeclaration>);

    const paint = () => {
      label.style.background = radio.checked ? CLR.bgActive : CLR.menuBg;
      label.style.color = radio.checked ? CLR.iconActive : CLR.text;
    };
    paints.push(paint);
    paint();

    radio.addEventListener('change', () => {
      if (!radio.checked) return;
      for (const p of paints) p();
      onChange(value);
    });

    label.append(radio, ownerDocument.createTextNode(text));
    group.appendChild(label);
  });

  return group;
}

// ── Drill-down back button ──────────────────────────────────────────────────
// Shared by any panel that drills in place (e.g. boxplot's grouped-overview →
// per-item rows) rather than restricting via a dropdown — ported from
// tsmap's charts/chartShell.ts.

export function makeBackButton(onBack: () => void, ownerDocument: Document = document): HTMLButtonElement {
  const btn = ownerDocument.createElement('button');
  btn.type = 'button';
  btn.textContent = '← Back';
  Object.assign(btn.style, {
    ...controlStyle('outlined'), background: CLR.menuBg, color: CLR.label,
  } as Partial<CSSStyleDeclaration>);
  wireControlHover(btn);
  btn.addEventListener('click', onBack);
  return btn;
}

// ── Empty state ──────────────────────────────────────────────────────────────
// Every panel's "nothing to draw" message (no test selected, no data for the
// current selection, ...) used this exact div/style shape independently —
// factored out once every panel needed one.

export function renderEmptyState(body: HTMLElement, message: string, styleOverrides?: Partial<CSSStyleDeclaration>): void {
  const empty = body.ownerDocument.createElement('div');
  empty.textContent = message;
  Object.assign(empty.style, { color: CLR.label, fontSize: FONT.body, padding: '8px 0' } as Partial<CSSStyleDeclaration>);
  if (styleOverrides) Object.assign(empty.style, styleOverrides);
  body.appendChild(empty);
}

// ── Themed option list ───────────────────────────────────────────────────────
// One picker behind every "choose a value" control in the Insights tab (test,
// wafer, Group by, findings filters).
//
// A native `<select>` is deliberately NOT used. WebKitGTK — the Linux Tauri
// WebView a host like tsmap runs in — paints the closed box with native GTK
// chrome regardless of `CLR.*`, and the OPEN option list is OS-drawn in EVERY
// engine, so no CSS reaches it anywhere. `appearance: none` used to be applied
// here to win back the closed box, but it could never touch the popup, which
// left these pickers as the one part of an embedded map that couldn't follow
// its host's theme (tsmap has sixteen).
//
// Behaviour and styling follow "Option lists and menus: one visual contract"
// in UI_STANDARDS.md, the copy shared with tsmap: `listbox`/`option` roles
// (these are values, not commands), rows on roving `tabIndex = -1` so the
// BROWSER draws the focus ring, and exactly three visual states — selected
// (persistent `CLR.menuActive` tint), hover (transient `CLR.menuHover`), and
// focus (the ring; never hand-drawn here). A host page's own `:focus-visible`
// rule therefore styles these rows too, which is how an embedded map ends up
// matching the host's own controls for free.

export interface ListSelectOption { value: string; label: string }

/**
 * A themed single-select picker: a trigger button plus an on-demand popup
 * listbox. Past `MENU_SEARCH_THRESHOLD` options a filter box is added (sharing
 * `makeMenuSearchBox` with toolbar.ts's plot-mode cascade, so every long list
 * in the library filters the same way).
 *
 * Exposes a settable `.value` matching `<select>.value` semantics — assigning
 * it moves the selection WITHOUT firing `onChange`, which callers rely on to
 * sync from an external click-through (the correlation matrix picking a cell)
 * without re-entering their own change handler.
 */
export function makeListSelect(
  options: readonly ListSelectOption[],
  selected: string,
  onChange: (value: string) => void,
  opts: {
    maxWidth?: string;
    ownerDocument?: Document;
    ariaLabel?: string;
    emptyText?: string;
    searchPlaceholder?: string;
    hook?: string;
  } = {},
): HTMLElement & { value: string } {
  const {
    maxWidth = '200px', ownerDocument = document, ariaLabel,
    emptyText, searchPlaceholder = 'Filter…', hook,
  } = opts;

  let current = selected;
  const labelFor = (v: string): string => options.find(o => o.value === v)?.label ?? '';

  const btn = ownerDocument.createElement('button');
  btn.type = 'button';
  // Stable hook for hosts driving this in automation. It stays on the trigger
  // (it used to sit on the `<select>` itself) so `[data-wmap-select="…"]`
  // keeps resolving to the one element you click to open the list.
  if (hook) btn.dataset.wmapSelect = hook;
  if (ariaLabel) btn.setAttribute('aria-label', ariaLabel);
  Object.assign(btn.style, {
    fontSize: FONT.body, padding: `${SPACE.xxs} ${SPACE.sm}`, background: CLR.menuBg, color: CLR.text,
    border: `1px solid ${CLR.menuBorder}`, borderRadius: RADIUS.control, maxWidth, textAlign: 'left',
    cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: SPACE.sm,
    justifyContent: 'space-between',
  } as Partial<CSSStyleDeclaration>);
  wireControlHover(btn);
  markMenuTrigger(btn, false);

  const labelSpan = ownerDocument.createElement('span');
  Object.assign(labelSpan.style, { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } as Partial<CSSStyleDeclaration>);
  const caret = ownerDocument.createElement('span');
  caret.textContent = '▾';
  caret.style.flex = '0 0 auto';
  btn.append(labelSpan, caret);

  const syncLabel = (): void => {
    labelSpan.textContent = options.length === 0 ? (emptyText ?? '(none)') : (labelFor(current) || emptyText || '(none)');
  };
  syncLabel();

  // An empty list is inert rather than opening an empty popup — same end state
  // as the `<select>.disabled` + single placeholder option this replaced.
  if (options.length === 0) {
    btn.disabled = true;
    btn.style.opacity = '0.6';
    btn.style.cursor = 'default';
    return Object.defineProperty(btn, 'value', {
      get: () => current,
      set: (v: string) => { current = v; syncLabel(); },
    }) as HTMLButtonElement & { value: string };
  }

  let menu: HTMLDivElement | null = null;
  const closeMenu = (): void => {
    if (!menu) return;
    menu.remove();
    menu = null;
    markMenuTrigger(btn, false);
  };
  // Escape and picking an option both mean "I'm done, give focus back"; a
  // generic outside click does not (whatever was clicked should keep focus),
  // so the outside-click path below deliberately doesn't refocus.
  const closeMenuAndRefocus = (): void => { closeMenu(); btn.focus(); };

  function openMenu(): void {
    const rect = btn.getBoundingClientRect();
    const win = ownerDocument.defaultView ?? window;
    const menuMinWidth = Math.max(rect.width, 220);
    const left = Math.min(rect.left, Math.max(4, (win.innerWidth ?? Infinity) - menuMinWidth - 4));
    menu = ownerDocument.createElement('div');
    menu.setAttribute('role', 'listbox');
    menu.setAttribute('aria-label', ariaLabel ?? 'Options');
    Object.assign(menu.style, {
      position: 'fixed', top: `${rect.bottom + 4}px`, left: `${left}px`,
      background: CLR.menuBg, border: `1px solid ${CLR.menuBorder}`, borderRadius: RADIUS.control,
      boxShadow: SHADOW.menu, zIndex: Z_BASE, minWidth: `${menuMinWidth}px`,
      maxHeight: '320px', overflowY: 'auto', padding: '4px 0', pointerEvents: 'auto',
    } as Partial<CSSStyleDeclaration>);

    const rows: { row: HTMLDivElement; label: string }[] = [];
    const visibleRows = (): HTMLDivElement[] => rows.filter(r => r.row.style.display !== 'none').map(r => r.row);

    if (options.length > MENU_SEARCH_THRESHOLD) {
      // `makeMenuSearchBox` stops all keydown propagation on the input itself
      // (so typing doesn't reach a host menu's key handling), which is why
      // arrow-key row navigation is wired explicitly below rather than relying
      // on bubbling into the delegated listener that mouse/focus events use.
      const searchBox = makeMenuSearchBox(query => {
        for (const r of rows) r.row.style.display = r.label.includes(query) ? '' : 'none';
      }, searchPlaceholder, ownerDocument);
      // Contained: this z-index only has to beat its own siblings (the option
      // rows, which set none) INSIDE `menu`, and `menu` itself lives in
      // `menuLayerFor`'s shared elevated layer, so nothing outside this one
      // dropdown is ever compared against this literal. See UI_STANDARDS.md's
      // "position: sticky or fixed" entry before copying this elsewhere.
      Object.assign(searchBox.style, { position: 'sticky', top: '0', zIndex: '1', background: CLR.menuBg } as Partial<CSSStyleDeclaration>);
      searchBox.addEventListener('keydown', e => {
        if (e.key === 'Escape') { closeMenuAndRefocus(); return; }
        if (e.key === 'ArrowDown') { e.preventDefault(); visibleRows()[0]?.focus(); }
      });
      menu.appendChild(searchBox);
    }

    for (const o of options) {
      const isSelected = o.value === current;
      const row = ownerDocument.createElement('div');
      row.textContent = o.label;
      row.setAttribute('role', 'option');
      row.setAttribute('aria-selected', isSelected ? 'true' : 'false');
      row.tabIndex = -1;   // roving tabindex — the ring comes from the browser
      Object.assign(row.style, {
        padding: '6px 14px', fontSize: FONT.body, cursor: 'pointer',
        color: isSelected ? CLR.iconActive : CLR.text, fontWeight: isSelected ? '700' : '400',
        background: isSelected ? CLR.menuActive : 'transparent', whiteSpace: 'nowrap',
      } as Partial<CSSStyleDeclaration>);
      // Hover only — NOT focus. Focus is the browser's ring; repainting the
      // background on focus too would make the two states indistinguishable
      // and re-invent the hand-drawn indicator the shared contract removes.
      // (`outline: none` used to be set here, which suppressed the ring
      // outright and forced exactly that.)
      row.addEventListener('mouseenter', () => { if (!isSelected) row.style.background = CLR.menuHover; });
      row.addEventListener('mouseleave', () => { if (!isSelected) row.style.background = 'transparent'; });
      row.addEventListener('click', e => {
        e.stopPropagation();
        current = o.value;
        syncLabel();
        closeMenuAndRefocus();
        onChange(o.value);
      });
      menu.appendChild(row);
      rows.push({ row, label: o.label.toLowerCase() });
    }

    // Row-to-row keyboard nav — deliberately not `wireMenuA11y`, which
    // auto-focuses its first item on mount and would steal focus straight back
    // off the search box's own autofocus.
    menu.addEventListener('keydown', e => {
      const list = visibleRows();
      if (list.length === 0) return;
      const idx = list.indexOf(ownerDocument.activeElement as HTMLDivElement);
      switch (e.key) {
        case 'ArrowDown': e.preventDefault(); list[idx < 0 || idx === list.length - 1 ? 0 : idx + 1].focus(); break;
        case 'ArrowUp':   e.preventDefault(); list[idx <= 0 ? list.length - 1 : idx - 1].focus(); break;
        case 'Home':      e.preventDefault(); list[0].focus(); break;
        case 'End':       e.preventDefault(); list[list.length - 1].focus(); break;
        case 'Enter':
        case ' ':         if (idx >= 0) { e.preventDefault(); list[idx].click(); } break;
        case 'Escape':
        case 'Tab':       e.preventDefault(); closeMenuAndRefocus(); break;
      }
    });

    // Shared menu layer (toolbar.ts), not straight to body — see menuLayerFor's
    // own doc comment: an Insights card is exactly the "persistent chrome"
    // shape that a bare Z_BASE menu could someday lose a stacking fight
    // against, the way the gallery's sticky header did to its own menus.
    menuLayerFor(btn).appendChild(menu);
    markMenuTrigger(btn, true);
    // Start keyboard navigation on the current selection, as a native select does.
    if (options.length <= MENU_SEARCH_THRESHOLD) {
      const selIdx = options.findIndex(o => o.value === current);
      visibleRows()[selIdx >= 0 ? selIdx : 0]?.focus();
    }
  }

  btn.addEventListener('click', e => {
    e.stopPropagation();
    if (menu) { closeMenu(); return; }
    openMenu();
  });
  // Registered once (not per-open) and harmless while closed (menu is null).
  // Self-unregisters the first time it fires after `btn` has left the document
  // (panel destroyed/rebuilt), rather than holding a live reference to a dead
  // widget for the lifetime of the whole document.
  const onDocClick = (e: MouseEvent): void => {
    if (!btn.isConnected) { ownerDocument.removeEventListener('click', onDocClick); return; }
    if (menu && !menu.contains(e.target as Node) && !btn.contains(e.target as Node)) closeMenu();
  };
  ownerDocument.addEventListener('click', onDocClick);

  return Object.defineProperty(btn, 'value', {
    get: () => current,
    set: (v: string) => { current = v; syncLabel(); },
  }) as HTMLButtonElement & { value: string };
}

// ── Test picker ──────────────────────────────────────────────────────────────
// The "which parametric test" `<select>` (boxplot, histogram, scatter) —
// same styling, same "no tests" disabled fallback, same option-population
// loop in every panel that needed one.

export interface TestSelectItem {
  testNumber: number;
  name?: string;
}

/**
 * Below `MENU_SEARCH_THRESHOLD` tests this is a plain native `<select>`. Past
 * it, a long native dropdown becomes hard to scan, so it's replaced by a
 * button + filterable popup list (`makeSearchableTestCombo` below) — sharing
 * `makeMenuSearchBox` with the plot-mode test-value cascade submenu
 * (toolbar.ts's `buildModeMenuEl`) so both long test lists get the same
 * filter-as-you-type box instead of two independent implementations. Either
 * shape exposes a settable `.value` (string of the testNumber, same as a real
 * `<select>`) so callers (boxplot/histogram/scatter, syncing from an external
 * click-through) don't need to know which one they got.
 */
export function makeTestSelect(
  testOptions: readonly TestSelectItem[],
  selected: number | null,
  onChange: (testNumber: number) => void,
  opts: { maxWidth?: string; emptyText?: string; ownerDocument?: Document } = {},
): HTMLElement & { value: string } {
  const { maxWidth = '200px', emptyText = 'No parametric tests', ownerDocument = document } = opts;

  return makeListSelect(
    testOptions.map(t => ({ value: String(t.testNumber), label: t.name || `Test ${t.testNumber}` })),
    selected !== null ? String(selected) : '',
    v => onChange(Number(v)),
    { maxWidth, ownerDocument, ariaLabel: 'Test', emptyText, searchPlaceholder: 'Filter tests…' },
  );
}

// ── Wafer picker ─────────────────────────────────────────────────────────────
// "Wafer: [All wafers ▾]" — the ungrouped-scope selector for any panel that
// draws one pooled visual (histogram, correlation matrix, scatter) and so
// can't show every wafer at once the way a bar/box panel can. Defaults to
// pooling every wafer; picking one narrows to just that wafer's dies. Hidden
// by the panel itself (not here) when the Analysis tab's "Group by" is
// active — grouping and single-wafer narrowing are mutually exclusive scope
// controls, only one applies at a time.

export interface WaferSelectItem {
  label?: string;
}

export function makeWaferSelect(
  items: readonly WaferSelectItem[],
  selectedIndex: number | null,
  onChange: (index: number | null) => void,
  opts: { maxWidth?: string; allLabel?: string; ownerDocument?: Document } = {},
): HTMLElement & { value: string } {
  const { maxWidth = '160px', allLabel = 'All wafers', ownerDocument = document } = opts;
  const ALL = '\0all';
  return makeListSelect(
    [{ value: ALL, label: allLabel }, ...items.map((it, i) => ({ value: String(i), label: it.label ?? `#${i}` }))],
    selectedIndex === null ? ALL : String(selectedIndex),
    v => onChange(v === ALL ? null : Number(v)),
    { maxWidth, ownerDocument, ariaLabel: allLabel, searchPlaceholder: 'Filter wafers…' },
  );
}

// ── Toggle checkbox ──────────────────────────────────────────────────────────
// A labelled checkbox (boxplot's "Log scale"/"Axis includes limits",
// histogram's "Axis includes limits") — same markup/styling in every panel
// that needed one. Callers are responsible for redrawing on change (via
// `onChange`), matching each panel's own rebuild contract.

export function makeToggle(labelText: string, checked: boolean, onChange: (v: boolean) => void, ownerDocument: Document = document): HTMLLabelElement {
  const label = ownerDocument.createElement('label');
  Object.assign(label.style, { display: 'inline-flex', alignItems: 'center', gap: SPACE.xs, fontSize: FONT.body, color: CLR.label, cursor: 'pointer', userSelect: 'none' } as Partial<CSSStyleDeclaration>);
  const checkbox = ownerDocument.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.checked = checked;
  checkbox.style.cssText = 'margin:0;cursor:pointer;';
  checkbox.addEventListener('change', () => onChange(checkbox.checked));
  label.append(checkbox, ownerDocument.createTextNode(labelText));
  return label;
}

// ── Labelled dropdown ────────────────────────────────────────────────────────
// A "<label>: <select>" control — capability's and correlation's "Group:
// <value> ▾" restrict-to-one-group dropdown, and the Analysis tab's own
// "Group by:" field selector, all built this same shape independently.

export function makeLabeledSelect(
  labelText: string,
  options: readonly { value: string; label: string }[],
  selected: string,
  onChange: (value: string) => void,
  opts: { maxWidth?: string; hook?: string; ownerDocument?: Document } = {},
): HTMLLabelElement {
  const { maxWidth = '160px', hook, ownerDocument = document } = opts;
  const label = ownerDocument.createElement('label');
  label.textContent = labelText;
  Object.assign(label.style, { color: CLR.label, fontSize: FONT.body, display: 'flex', alignItems: 'center', gap: SPACE.xs } as Partial<CSSStyleDeclaration>);
  // This same helper builds the Analysis tab's "Group by:" field selector
  // AND every per-panel "Group: <value> ▾" restrict-to-one-group dropdown
  // AND the histogram wafer picker, so a bare trigger is ambiguous page-wide —
  // callers that need a stable hook pass one (e.g. 'group-by').
  const select = makeListSelect(options, selected, onChange, {
    maxWidth, ownerDocument, hook, ariaLabel: labelText.replace(/:\s*$/, ''),
  });
  label.appendChild(select);
  return label;
}

// ── Chart grid wrapper ───────────────────────────────────────────────────────
// The Analysis tab's per-section responsive card grid (yield/bins,
// distributions, correlation) — same wrapper style built independently in
// each section.

export function makeChartGridWrap(ownerDocument: Document = document): HTMLDivElement {
  const wrap = ownerDocument.createElement('div');
  wrap.dataset.wmapChartGrid = '1';
  Object.assign(wrap.style, { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))', gap: SPACE.lg, flex: '0 0 auto' } as Partial<CSSStyleDeclaration>);
  return wrap;
}

/** Small positioned hover tooltip, matching the pattern each ported panel builds for itself. */
export function makeTooltip(card: HTMLElement): HTMLElement {
  const tooltip = card.ownerDocument.createElement('div');
  Object.assign(tooltip.style, {
    position: 'absolute', display: 'none', pointerEvents: 'none', zIndex: '50',
    // Deliberately the same values as toolbar.ts's `getTooltip`, NOT the CLR
    // surface tokens: a hover tip is a floating label over arbitrary content,
    // and it reads as one at any theme only if it stays dark. The library used
    // to have two tooltip looks — this light one on chart-card controls and the
    // dark one on the toolbar — so the same gesture produced a different tip
    // depending on which control you were over. tsmap's own `tooltip.ts`
    // already mirrors the dark one; this makes all three agree.
    background: 'rgba(30, 32, 40, 0.93)', color: '#f0f0f2',
    border: '1px solid rgba(255,255,255,0.10)', borderRadius: RADIUS.control,
    padding: '7px 11px', fontSize: FONT.sub, fontFamily: FONT.family,
    maxWidth: '280px', whiteSpace: 'nowrap', boxShadow: SHADOW.menu,
  } as Partial<CSSStyleDeclaration>);
  card.appendChild(tooltip);
  return tooltip;
}

/**
 * Give a chart-card control the library's themed hover tooltip instead of a
 * native `title`.
 *
 * toolbar.ts states the policy for the map toolbar — `ariaLabel` plus the
 * custom tooltip, deliberately no `title`, because a native tooltip is slow,
 * unthemeable, invisible on touch and unreachable by keyboard. The chart layer
 * never adopted it and kept setting `title` directly, so hints that make an
 * interaction discoverable ("click to filter") were reachable only by hovering
 * with a mouse and knowing to hover in the first place.
 *
 * `ariaLabel` is set only when the element has no text of its own — on a
 * labelled element it would override the visible name for screen readers,
 * which is worse than the tooltip it replaces.
 */
export function attachChartTip(el: HTMLElement, card: HTMLElement, tooltip: HTMLElement, text: string): void {
  el.removeAttribute('title');
  if (!el.textContent?.trim()) el.ariaLabel = text;
  el.addEventListener('mouseenter', (e) => {
    tooltip.textContent   = text;
    tooltip.style.display = 'block';
    positionChartTooltip(tooltip, card, (e as MouseEvent).clientX, (e as MouseEvent).clientY);
  });
  el.addEventListener('mousemove', (e) => {
    if (tooltip.style.display === 'block') positionChartTooltip(tooltip, card, (e as MouseEvent).clientX, (e as MouseEvent).clientY);
  });
  el.addEventListener('mouseleave', () => { tooltip.style.display = 'none'; });
  // A control that hides itself (the expand button, which is display:none'd
  // while its card is in the modal) never fires mouseleave, so without this the
  // tip stays on screen with nothing under it.
  el.addEventListener('click', () => { tooltip.style.display = 'none'; });
  // Keyboard users get the same hint — the native `title` never gave them one.
  el.addEventListener('focus', () => {
    tooltip.textContent = text;
    tooltip.style.display = 'block';
    const r = el.getBoundingClientRect();
    positionChartTooltip(tooltip, card, r.left + r.width / 2, r.bottom);
  });
  el.addEventListener('blur', () => { tooltip.style.display = 'none'; });
}

/**
 * Position a `makeTooltip` element from a mousemove event, flipping to the
 * opposite side of the cursor when the default placement would overflow
 * `card`'s own bounds (the tooltip is an absolutely-positioned child of
 * `card`, so staying within its rect keeps it on-screen without needing the
 * window's own bounds).
 */
export function positionChartTooltip(tooltip: HTMLElement, card: HTMLElement, clientX: number, clientY: number): void {
  const cardRect = card.getBoundingClientRect();
  const offset = 14;
  const margin = 4;
  tooltip.style.left = '0';
  tooltip.style.top  = '0';
  const tw = tooltip.offsetWidth;
  const th = tooltip.offsetHeight;
  let x = clientX - cardRect.left + offset;
  let y = clientY - cardRect.top + offset;
  if (x + tw + margin > cardRect.width)  x = clientX - cardRect.left - offset - tw;
  if (y + th + margin > cardRect.height) y = clientY - cardRect.top - offset - th;
  x = Math.max(margin, x);
  y = Math.max(margin, y);
  tooltip.style.left = `${x}px`;
  tooltip.style.top  = `${y}px`;
}

/**
 * The two axis toggles, shared across the distribution panels.
 *
 * They were per-panel state, so the same preference had to be set three times
 * (histogram, boxplot, trend) for one test. The panels now exchange this through
 * `insightsTab`, the same way they already share the selected test.
 *
 * `includeLimits: undefined` means "derive from the data" — see
 * `shouldIncludeLimitsByDefault`. A boolean is an explicit user choice and sticks.
 */
export interface AxisPrefs {
  includeLimits?: boolean;
  clipOutliers: boolean;
}

// ── Value-axis range ────────────────────────────────────────────────────────
//
// Shared by the distribution panels (histogram, boxplot, trend) so their axis
// behaviour — whether spec limits are in view, and whether a wild reading is
// allowed to flatten the plot — is decided in one place rather than three.

/** Robust outlier fence over a value list: Tukey's `Q1 − k·IQR … Q3 + k·IQR`.
 *
 *  Deliberately NOT mean ± 3σ. σ is computed FROM the data including the
 *  outlier, so a single reading of 1e30 inflates σ far enough that the fence no
 *  longer excludes it — the classic masking failure, and it fails hardest exactly
 *  when the outlier is worst. Quartiles are unmoved by the extreme tail.
 *
 *  Returns null when there are too few values for quartiles to mean anything. */
export function robustFence(values: number[], k = 1.5): { lo: number; hi: number } | null {
  const finite = values.filter(v => Number.isFinite(v)).sort((a, b) => a - b);
  if (finite.length < 8) return null;
  const q = (p: number) => {
    const idx = (finite.length - 1) * p;
    const lo = Math.floor(idx), hi = Math.ceil(idx);
    return lo === hi ? finite[lo] : finite[lo] + (finite[hi] - finite[lo]) * (idx - lo);
  };
  const q1 = q(0.25), q3 = q(0.75), iqr = q3 - q1;
  if (iqr === 0) return null;
  return { lo: q1 - k * iqr, hi: q3 + k * iqr };
}

/**
 * Whether a panel should include the spec limits in its axis BY DEFAULT.
 *
 * Neither fixed answer is right. Always-off hides how close a distribution runs
 * to its limit, which is the main thing a spec'd test is read for. Always-on
 * squashes the data into a sliver whenever the limits are generous — and generous
 * limits are what a capable process looks like (Ppk 2.0 means the data occupies
 * about a third of the window), so the "good" case would render worst.
 *
 * So it is derived from the data, as this library derives other defaults: include
 * the limits when doing so leaves the data at least `minDataShare` of the axis.
 */
export function shouldIncludeLimitsByDefault(
  dataMin: number, dataMax: number,
  limitLow: number | undefined, limitHigh: number | undefined,
  minDataShare = 1 / 3,
): boolean {
  if (limitLow === undefined && limitHigh === undefined) return false;
  if (!Number.isFinite(dataMin) || !Number.isFinite(dataMax)) return false;
  const lo = Math.min(dataMin, limitLow ?? dataMin);
  const hi = Math.max(dataMax, limitHigh ?? dataMax);
  const withSpan = hi - lo;
  if (withSpan <= 0) return true;
  const dataSpan = dataMax - dataMin;
  // Zero-variance data occupies no share of any axis; including the limits is
  // then strictly better than an axis with nothing on it.
  if (dataSpan === 0) return true;
  return dataSpan / withSpan >= minDataShare;
}

export interface AxisRange {
  lo: number;
  hi: number;
  /** Limits that fall OUTSIDE [lo, hi] and so cannot be drawn in place — the
   *  caller should mark them at the axis edge instead. Without this a limit that
   *  is merely off-screen is indistinguishable from a test having no limit. */
  offAxis: Array<{ value: number; label: 'LSL' | 'USL'; side: 'lo' | 'hi' }>;
  /** Values excluded by the robust fence, when clipping is on. */
  clippedCount: number;
}

/**
 * Resolve a value axis from the data, the limits, and the two user toggles.
 *
 * `clipOutliers` clips the AXIS only. No caller may use it to drop values from a
 * statistic: an out-of-spec die is a distribution outlier by construction, so
 * excluding it would delete real spec failures from yield, and capability exists
 * precisely to describe the tails. The count is returned so the panel can say how
 * many points sit outside the view.
 */
export function resolveAxisRange(opts: {
  dataMin: number;
  dataMax: number;
  limitLow?: number;
  limitHigh?: number;
  includeLimits: boolean;
  clipOutliers?: boolean;
  /** Raw values, needed only when `clipOutliers` is set. */
  values?: number[];
}): AxisRange {
  const { dataMin, dataMax, limitLow, limitHigh, includeLimits, clipOutliers, values } = opts;

  let lo = dataMin;
  let hi = dataMax;
  let clippedCount = 0;

  if (clipOutliers && values?.length) {
    const fence = robustFence(values);
    if (fence) {
      const flo = Math.max(lo, fence.lo);
      const fhi = Math.min(hi, fence.hi);
      if (fhi > flo) {
        clippedCount = values.filter(v => Number.isFinite(v) && (v < flo || v > fhi)).length;
        lo = flo;
        hi = fhi;
      }
    }
  }

  if (includeLimits) {
    if (limitLow  !== undefined) lo = Math.min(lo, limitLow);
    if (limitHigh !== undefined) hi = Math.max(hi, limitHigh);
  }
  if (lo === hi) { lo -= 1; hi += 1; }

  const offAxis: AxisRange['offAxis'] = [];
  if (limitLow  !== undefined && limitLow  < lo) offAxis.push({ value: limitLow,  label: 'LSL', side: 'lo' });
  if (limitLow  !== undefined && limitLow  > hi) offAxis.push({ value: limitLow,  label: 'LSL', side: 'hi' });
  if (limitHigh !== undefined && limitHigh > hi) offAxis.push({ value: limitHigh, label: 'USL', side: 'hi' });
  if (limitHigh !== undefined && limitHigh < lo) offAxis.push({ value: limitHigh, label: 'USL', side: 'lo' });

  return { lo, hi, offAxis, clippedCount };
}


/**
 * Draw an edge marker for each limit that falls outside the plotted range.
 *
 * Without this a limit that is merely off-screen renders as nothing at all, so a
 * test whose limits sit beyond the axis is indistinguishable from a test with no
 * limits — the reader cannot tell "comfortably inside spec" from "unspecced".
 *
 * `axis` is the plot rectangle in CSS px; `orient` says which way the value axis
 * runs, so the same helper serves the horizontal-value panels (histogram,
 * boxplot) and the vertical-value one (trend).
 */
export function drawOffAxisLimits(
  ctx: CanvasRenderingContext2D,
  offAxis: AxisRange['offAxis'],
  axis: { left: number; right: number; top: number; bottom: number },
  orient: 'horizontal' | 'vertical',
  color: string,
  format: (v: number) => string,
): void {
  if (!offAxis.length) return;
  ctx.save();
  ctx.fillStyle = color;
  ctx.font = `${fontPx(-1)}px system-ui, sans-serif`;
  for (const { value, label, side } of offAxis) {
    // The arrow points OUT of the plot, toward where the limit actually lies.
    const arrow = orient === 'horizontal' ? (side === 'lo' ? '←' : '→') : (side === 'lo' ? '↓' : '↑');
    const text = side === 'lo' ? `${arrow} ${label} ${format(value)}` : `${label} ${format(value)} ${arrow}`;
    if (orient === 'horizontal') {
      ctx.textBaseline = 'top';
      ctx.textAlign = side === 'lo' ? 'left' : 'right';
      ctx.fillText(text, side === 'lo' ? axis.left + 2 : axis.right - 2, axis.top + 2);
    } else {
      ctx.textBaseline = side === 'lo' ? 'bottom' : 'top';
      ctx.textAlign = 'left';
      ctx.fillText(text, axis.left + 4, side === 'lo' ? axis.bottom - 2 : axis.top + 2);
    }
  }
  ctx.restore();
}
