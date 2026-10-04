// Hover, click and drag-to-select on a canvas of points: the one implementation behind the Insights scatter and
// the plot builder's scatter, so the two behave identically (a tooltip that names the point, a click that opens
// it, a rectangle that selects what is inside) and a fix to one is a fix to both.
//
// The chart keeps what it owns: where each point was drawn, what a tooltip says, which points are selected, and
// how to redraw. This module owns the pointer.

import { CLR } from '../toolbar.js';
import { positionChartTooltip } from './chartShell.js';

/** A point as drawn, with its pixel position inside the canvas. */
export interface DrawnPoint<P> { p: P; cx: number; cy: number }

export interface PointInteractionOptions<P> {
  card: HTMLElement;
  canvas: HTMLCanvasElement;
  tooltip: HTMLElement;
  /** The points as last drawn. Only these can be hit: a chart that samples a large population hides the rest. */
  drawn: () => ReadonlyArray<DrawnPoint<P>>;
  /** Tooltip HTML for a point (already escaped). */
  describe: (p: P) => string;
  /** Whether a click on this point does anything. */
  clickable: (p: P) => boolean;
  onOpen?: (p: P) => void;
  /** The point under the pointer changed (null when it left all points): redraw. */
  onHover: (p: P | null) => void;
  /** Present to enable drag-to-select. */
  select?: {
    /** The points inside a rectangle given in canvas pixels. */
    pick: (rect: { x0: number; y0: number; x1: number; y1: number }) => P[];
    /** A drag finished: the chart records the selection, redraws and tells its host. `at` is the pointer in the viewport. */
    onPicked: (picked: P[], at: { x: number; y: number }) => void;
    /** A click on empty space while a selection stands. */
    onClear: () => void;
    hasSelection: () => boolean;
  };
}

const HIT_RADIUS = 7;
const DRAG_PX = 4;

export function wirePointInteractions<P>(o: PointInteractionOptions<P>): { destroy: () => void } {
  const { card, canvas, tooltip } = o;
  let hovered: P | null = null;

  const pointAt = (e: MouseEvent): P | null => {
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    let best: P | null = null;
    let bestD = HIT_RADIUS * HIT_RADIUS;
    for (const d of o.drawn()) {
      const dx = d.cx - mx, dy = d.cy - my;
      const dist = dx * dx + dy * dy;
      if (dist <= bestD) { bestD = dist; best = d.p; }
    }
    return best;
  };

  canvas.addEventListener('mousemove', e => {
    const p = pointAt(e);
    canvas.style.cursor = p && o.clickable(p) ? 'pointer' : 'crosshair';
    if (!p) {
      tooltip.style.display = 'none';
      if (hovered) { hovered = null; o.onHover(null); }
      return;
    }
    tooltip.innerHTML = o.describe(p);
    tooltip.style.display = 'block';
    positionChartTooltip(tooltip, card, e.clientX, e.clientY);
    if (hovered !== p) { hovered = p; o.onHover(p); }
  });
  canvas.addEventListener('mouseleave', () => {
    tooltip.style.display = 'none';
    if (hovered) { hovered = null; o.onHover(null); }
  });

  // A drag selects; a press that barely moves is a click. After a drag the browser still sends a click, which
  // must not also open a point.
  let suppressClick = false;
  const rubber = card.ownerDocument.createElement('div');
  Object.assign(rubber.style, {
    position: 'absolute', display: 'none', pointerEvents: 'none', zIndex: '40', boxSizing: 'border-box',
    border: `1px dashed ${CLR.iconActive}`, background: 'rgba(120,150,200,0.15)',
  } as Partial<CSSStyleDeclaration>);
  card.appendChild(rubber);

  const select = o.select;
  if (select) {
    canvas.addEventListener('mousedown', down => {
      if (down.button !== 0) return;
      suppressClick = false;
      const rect = canvas.getBoundingClientRect();
      const x0 = down.clientX - rect.left, y0 = down.clientY - rect.top;
      let dragging = false;
      let x1 = x0, y1 = y0;
      const doc = card.ownerDocument;
      const onMove = (e: MouseEvent): void => {
        x1 = Math.min(Math.max(e.clientX - rect.left, 0), rect.width);
        y1 = Math.min(Math.max(e.clientY - rect.top, 0), rect.height);
        if (!dragging && Math.hypot(x1 - x0, y1 - y0) < DRAG_PX) return;
        dragging = true;
        tooltip.style.display = 'none';
        const cardRect = card.getBoundingClientRect();
        Object.assign(rubber.style, {
          display: 'block',
          left: `${rect.left - cardRect.left + Math.min(x0, x1)}px`, top: `${rect.top - cardRect.top + Math.min(y0, y1)}px`,
          width: `${Math.abs(x1 - x0)}px`, height: `${Math.abs(y1 - y0)}px`,
        } as Partial<CSSStyleDeclaration>);
      };
      const onUp = (e: MouseEvent): void => {
        doc.removeEventListener('mousemove', onMove);
        doc.removeEventListener('mouseup', onUp);
        rubber.style.display = 'none';
        if (!dragging) return;
        suppressClick = true;
        select.onPicked(select.pick({ x0: Math.min(x0, x1), y0: Math.min(y0, y1), x1: Math.max(x0, x1), y1: Math.max(y0, y1) }), { x: e.clientX, y: e.clientY });
      };
      doc.addEventListener('mousemove', onMove);
      doc.addEventListener('mouseup', onUp);
    });
  }

  canvas.addEventListener('click', e => {
    if (suppressClick) { suppressClick = false; return; }
    const p = pointAt(e);
    if (!p) {
      // A click on empty space clears a selection.
      if (select?.hasSelection()) select.onClear();
      return;
    }
    if (!o.clickable(p)) return;
    o.onOpen?.(p);
  });

  return { destroy: () => rubber.remove() };
}
