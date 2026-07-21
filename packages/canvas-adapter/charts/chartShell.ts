// Shared chrome for wmap's own chart panels (Analysis tab). Ported from
// tsmap's charts/chartShell.ts — the first host to build this layer — trimmed
// to what the first panel (capability) needs: a card shell, canvas
// fill-height helpers for a full-height tab layout, and PNG save. Uses
// wmap's own `--wmap-*` theme tokens (`CLR`, canvas-adapter/toolbar.ts) so
// panels match the surrounding chrome for free, in any host's theme.

import { CLR, saveImageBlob, openReparentedModal, type SaveImageHandler } from '../toolbar.js';
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
  const ro = new ResizeObserver(onResize);
  ro.observe(el);
  return { disconnect: () => ro.disconnect() };
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
  card.style.minHeight = `${overhead + contentHeight}px`;
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
  ctx.font = '10px system-ui, sans-serif';
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
  const flat = document.createElement('canvas');
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

export function cardShell(title: string, onSaveImage?: SaveImageHandler): CardShell {
  const card = document.createElement('div');
  Object.assign(card.style, {
    display: 'flex', flexDirection: 'column',
    background: CLR.menuBg, border: `1px solid ${CLR.menuBorder}`, borderRadius: '6px',
    padding: '12px', minWidth: '0', minHeight: '0', flex: '1 1 0', position: 'relative',
  } as Partial<CSSStyleDeclaration>);

  const headingRow = document.createElement('div');
  Object.assign(headingRow.style, { display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px' } as Partial<CSSStyleDeclaration>);
  const heading = document.createElement('div');
  heading.textContent = title;
  Object.assign(heading.style, { color: CLR.value, fontSize: '13px', fontWeight: '600', flex: '1' } as Partial<CSSStyleDeclaration>);
  headingRow.appendChild(heading);

  const saveBtn = document.createElement('button');
  saveBtn.type = 'button';
  saveBtn.title = 'Save as PNG';
  saveBtn.innerHTML = ICONS.download;
  Object.assign(saveBtn.style, {
    border: `1px solid ${CLR.menuBorder}`, borderRadius: '4px', background: 'none',
    color: CLR.label, cursor: 'pointer', width: '22px', height: '22px', lineHeight: '1', flexShrink: '0',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  } as Partial<CSSStyleDeclaration>);
  saveBtn.addEventListener('click', () => {
    const canvas = card.querySelector<HTMLCanvasElement>('canvas');
    if (canvas) saveCanvasPng(canvas, title, onSaveImage);
  });
  headingRow.appendChild(saveBtn);

  const expandBtn = document.createElement('button');
  expandBtn.type = 'button';
  expandBtn.title = 'Expand';
  expandBtn.innerHTML = ICONS.expand;
  Object.assign(expandBtn.style, {
    border: `1px solid ${CLR.menuBorder}`, borderRadius: '4px', background: 'none',
    color: CLR.label, cursor: 'pointer', width: '22px', height: '22px', lineHeight: '1', flexShrink: '0',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  } as Partial<CSSStyleDeclaration>);
  expandBtn.addEventListener('click', () => openChartExpandModal(card, heading.textContent ?? title, expandBtn));
  headingRow.appendChild(expandBtn);
  card.appendChild(headingRow);

  const controlsRow = document.createElement('div');
  Object.assign(controlsRow.style, { display: 'flex', gap: '6px', marginBottom: '6px', flexWrap: 'wrap', alignItems: 'center' } as Partial<CSSStyleDeclaration>);
  card.appendChild(controlsRow);

  const body = document.createElement('div');
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
): HTMLElement {
  const group = document.createElement('div');
  group.setAttribute('role', 'radiogroup');
  Object.assign(group.style, { display: 'inline-flex', border: `1px solid ${CLR.menuBorder}`, borderRadius: '4px', overflow: 'hidden' } as Partial<CSSStyleDeclaration>);
  const name = `seg-${Math.random().toString(36).slice(2, 9)}`;
  const paints: Array<() => void> = [];

  options.forEach(([value, text], i) => {
    const label = document.createElement('label');
    Object.assign(label.style, {
      display: 'inline-flex', alignItems: 'center', fontSize: '12px', padding: '3px 10px', cursor: 'pointer', userSelect: 'none',
      borderLeft: i > 0 ? `1px solid ${CLR.menuBorder}` : 'none',
    } as Partial<CSSStyleDeclaration>);

    const radio = document.createElement('input');
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

    label.append(radio, document.createTextNode(text));
    group.appendChild(label);
  });

  return group;
}

// ── Drill-down back button ──────────────────────────────────────────────────
// Shared by any panel that drills in place (e.g. boxplot's grouped-overview →
// per-item rows) rather than restricting via a dropdown — ported from
// tsmap's charts/chartShell.ts.

export function makeBackButton(onBack: () => void): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.textContent = '← Back';
  Object.assign(btn.style, {
    fontSize: '12px', padding: '3px 10px', border: `1px solid ${CLR.menuBorder}`,
    borderRadius: '4px', background: CLR.menuBg, color: CLR.label, cursor: 'pointer',
  } as Partial<CSSStyleDeclaration>);
  btn.addEventListener('click', onBack);
  return btn;
}

// ── Empty state ──────────────────────────────────────────────────────────────
// Every panel's "nothing to draw" message (no test selected, no data for the
// current selection, ...) used this exact div/style shape independently —
// factored out once every panel needed one.

export function renderEmptyState(body: HTMLElement, message: string, styleOverrides?: Partial<CSSStyleDeclaration>): void {
  const empty = document.createElement('div');
  empty.textContent = message;
  Object.assign(empty.style, { color: CLR.label, fontSize: '12px', padding: '8px 0' } as Partial<CSSStyleDeclaration>);
  if (styleOverrides) Object.assign(empty.style, styleOverrides);
  body.appendChild(empty);
}

// ── Test picker ──────────────────────────────────────────────────────────────
// The "which parametric test" `<select>` (boxplot, histogram, scatter) —
// same styling, same "no tests" disabled fallback, same option-population
// loop in every panel that needed one.

export interface TestSelectItem {
  testNumber: number;
  name?: string;
}

export function makeTestSelect(
  testOptions: readonly TestSelectItem[],
  selected: number | null,
  onChange: (testNumber: number) => void,
  opts: { maxWidth?: string; emptyText?: string } = {},
): HTMLSelectElement {
  const { maxWidth = '200px', emptyText = 'No parametric tests' } = opts;
  const select = document.createElement('select');
  Object.assign(select.style, { fontSize: '12px', padding: '2px 6px', background: CLR.menuBg, color: CLR.text, border: `1px solid ${CLR.menuBorder}`, borderRadius: '4px', maxWidth } as Partial<CSSStyleDeclaration>);
  if (testOptions.length === 0) {
    select.disabled = true;
    const opt = document.createElement('option');
    opt.textContent = emptyText;
    select.appendChild(opt);
  } else {
    for (const t of testOptions) {
      const opt = document.createElement('option');
      opt.value = String(t.testNumber);
      opt.textContent = t.name || `Test ${t.testNumber}`;
      if (t.testNumber === selected) opt.selected = true;
      select.appendChild(opt);
    }
    select.addEventListener('change', () => onChange(Number(select.value)));
  }
  return select;
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
  opts: { maxWidth?: string; allLabel?: string } = {},
): HTMLSelectElement {
  const { maxWidth = '160px', allLabel = 'All wafers' } = opts;
  const ALL = '\0all';
  const select = document.createElement('select');
  Object.assign(select.style, { fontSize: '12px', padding: '2px 6px', background: CLR.menuBg, color: CLR.text, border: `1px solid ${CLR.menuBorder}`, borderRadius: '4px', maxWidth } as Partial<CSSStyleDeclaration>);
  const allOpt = document.createElement('option');
  allOpt.value = ALL;
  allOpt.textContent = allLabel;
  if (selectedIndex === null) allOpt.selected = true;
  select.appendChild(allOpt);
  items.forEach((it, i) => {
    const opt = document.createElement('option');
    opt.value = String(i);
    opt.textContent = it.label ?? `#${i}`;
    if (selectedIndex === i) opt.selected = true;
    select.appendChild(opt);
  });
  select.addEventListener('change', () => onChange(select.value === ALL ? null : Number(select.value)));
  return select;
}

// ── Toggle checkbox ──────────────────────────────────────────────────────────
// A labelled checkbox (boxplot's "Log scale"/"Axis includes limits",
// histogram's "Axis includes limits") — same markup/styling in every panel
// that needed one. Callers are responsible for redrawing on change (via
// `onChange`), matching each panel's own rebuild contract.

export function makeToggle(labelText: string, checked: boolean, onChange: (v: boolean) => void): HTMLLabelElement {
  const label = document.createElement('label');
  Object.assign(label.style, { display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '11px', color: CLR.label, cursor: 'pointer', userSelect: 'none' } as Partial<CSSStyleDeclaration>);
  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.checked = checked;
  checkbox.style.cssText = 'margin:0;cursor:pointer;';
  checkbox.addEventListener('change', () => onChange(checkbox.checked));
  label.append(checkbox, document.createTextNode(labelText));
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
  opts: { maxWidth?: string } = {},
): HTMLLabelElement {
  const { maxWidth = '160px' } = opts;
  const label = document.createElement('label');
  label.textContent = labelText;
  Object.assign(label.style, { color: CLR.label, fontSize: '12px', display: 'flex', alignItems: 'center', gap: '4px' } as Partial<CSSStyleDeclaration>);
  const select = document.createElement('select');
  Object.assign(select.style, { fontSize: '12px', padding: '2px 6px', background: CLR.menuBg, color: CLR.text, border: `1px solid ${CLR.menuBorder}`, borderRadius: '4px', maxWidth } as Partial<CSSStyleDeclaration>);
  for (const o of options) {
    const opt = document.createElement('option');
    opt.value = o.value;
    opt.textContent = o.label;
    if (o.value === selected) opt.selected = true;
    select.appendChild(opt);
  }
  select.addEventListener('change', () => onChange(select.value));
  label.appendChild(select);
  return label;
}

// ── Chart grid wrapper ───────────────────────────────────────────────────────
// The Analysis tab's per-section responsive card grid (yield/bins,
// distributions, correlation) — same wrapper style built independently in
// each section.

export function makeChartGridWrap(): HTMLDivElement {
  const wrap = document.createElement('div');
  Object.assign(wrap.style, { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))', gap: '10px', flex: '0 0 auto' } as Partial<CSSStyleDeclaration>);
  return wrap;
}

/** Small positioned hover tooltip, matching the pattern each ported panel builds for itself. */
export function makeTooltip(card: HTMLElement): HTMLElement {
  const tooltip = document.createElement('div');
  Object.assign(tooltip.style, {
    position: 'absolute', display: 'none', pointerEvents: 'none', zIndex: '50',
    background: CLR.menuBg, border: `1px solid ${CLR.menuBorder}`, borderRadius: '4px',
    padding: '4px 8px', fontSize: '11px', fontFamily: 'system-ui, sans-serif',
    color: CLR.text, whiteSpace: 'nowrap', boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
  } as Partial<CSSStyleDeclaration>);
  card.appendChild(tooltip);
  return tooltip;
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
