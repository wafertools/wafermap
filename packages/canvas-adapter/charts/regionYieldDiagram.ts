// Ring/quadrant yield diagram — a wafer-shaped circle divided into the same
// regions the ring/quadrant boundary overlays draw on the main map (equal-
// radius bands for rings, a centre cross for quadrants — see
// buildRingOverlays/buildQuadrantOverlays in renderer/buildView.ts), each
// region filled by the registered colour scheme's continuous value ramp
// (the same `forValue` mapping the yield-by-wafer bar chart uses) and
// labelled with its own yield % directly in the region — not just on
// hover, so the number is always visible, matching every other stat this
// library shows (a semiconductor engineer reading a report must be able to
// understand what's shown without hovering — see CLAUDE.md's display-
// clarity rule).
//
// Region geometry mirrors core/classify.ts's classifyDie exactly: ring k
// spans normalized radius [(k-1)/ringCount, k/ringCount]; quadrants are
// standard NE/NW/SW/SE quarter-circles split at the wafer centre. Canvas
// angle 0 = East, increasing clockwise (canvas Y is down), so:
//   [0, 90°) = SE, [90°, 180°) = SW, [180°, 270°) = NW, [270°, 360°) = NE.

import type { RegionYieldDatum } from '../../stats/regions.js';
import { parseRegionKey } from '../../stats/regions.js';
import { getColorScheme } from '../../renderer/colorSchemes.js';
import {
  cardShell, resolveChartCanvasColors, observeResize, growCardToFitContent,
  renderEmptyState, type SaveImageHandler, type ChartCanvasColors,
} from './chartShell.js';

export type RegionYieldMode = 'ring' | 'quadrant';

export interface RegionYieldDiagramOptions {
  title?: string;
  mode: RegionYieldMode;
  /** Ring mode: ordered ring 1 (core) → ring N (edge), matching `buildRegionYieldData`'s output for `buildRingRegions`. Quadrant mode: any order — each row's quadrant is read from its `key` (`quadrant:NE` etc.), not position. */
  rows: RegionYieldDatum[];
  colorScheme?: string;
  onSaveImage?: SaveImageHandler;
}

export interface RegionYieldDiagramHandle {
  card: HTMLElement;
  hasData: boolean;
  destroy: () => void;
}

const DIAGRAM_SIZE = 320;
const MIN_SIZE = 220;

// Canvas angle ranges (radians) per quadrant — see header comment for the mapping.
const QUADRANT_ANGLES: Record<string, [number, number]> = {
  SE: [0, Math.PI / 2],
  SW: [Math.PI / 2, Math.PI],
  NW: [Math.PI, 1.5 * Math.PI],
  NE: [1.5 * Math.PI, 2 * Math.PI],
};

function roundRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** A small opaque label chip (region name + yield %) — opaque background
 *  guarantees the text stays readable regardless of the yield-colour fill
 *  underneath, without needing to compute contrast against an arbitrary
 *  registered colour scheme's output. */
function drawLabelChip(
  ctx: CanvasRenderingContext2D, x: number, y: number,
  line1: string, line2: string, theme: ChartCanvasColors,
): void {
  ctx.font = '10px system-ui, sans-serif';
  const w1 = ctx.measureText(line1).width;
  ctx.font = '700 11px system-ui, sans-serif';
  const w2 = ctx.measureText(line2).width;
  const w = Math.max(w1, w2) + 12;
  const h = 30;

  ctx.fillStyle = theme.bg;
  roundRectPath(ctx, x - w / 2, y - h / 2, w, h, 4);
  ctx.fill();
  ctx.strokeStyle = theme.border;
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = theme.textMuted;
  ctx.font = '10px system-ui, sans-serif';
  ctx.fillText(line1, x, y - 7);
  ctx.fillStyle = theme.text;
  ctx.font = '700 11px system-ui, sans-serif';
  ctx.fillText(line2, x, y + 7);
}

export function renderRegionYieldDiagram(options: RegionYieldDiagramOptions): RegionYieldDiagramHandle {
  const { mode, rows, colorScheme = 'default', onSaveImage } = options;
  const title = options.title ?? (mode === 'ring' ? 'Ring yield' : 'Quadrant yield');
  const { card, body } = cardShell(title, onSaveImage);

  const hasData = rows.length > 0;
  if (!hasData) {
    renderEmptyState(body, 'No bin data available for regional yield.');
    return { card, hasData, destroy: () => {} };
  }

  Object.assign(body.style, { display: 'flex', justifyContent: 'center', alignItems: 'center' } as Partial<CSSStyleDeclaration>);

  const canvas = document.createElement('canvas');
  // Pinned to its own intrinsic size, not stretched by `body`'s flex layout
  // (a flex row's default free-space distribution would otherwise grow the
  // canvas to fill the card's full width, turning the circle into an
  // ellipse) — this diagram wants a fixed square regardless of how wide the
  // surrounding grid card happens to be.
  Object.assign(canvas.style, { display: 'block', flex: 'none' } as Partial<CSSStyleDeclaration>);
  body.appendChild(canvas);

  const dpr = window.devicePixelRatio || 1;

  function draw(): void {
    const size = Math.max(MIN_SIZE, Math.min(body.clientWidth || DIAGRAM_SIZE, DIAGRAM_SIZE));
    growCardToFitContent(card, body, size);

    canvas.width  = Math.max(1, Math.floor(size * dpr));
    canvas.height = Math.max(1, Math.floor(size * dpr));
    canvas.style.width  = `${size}px`;
    canvas.style.height = `${size}px`;

    const ctx = canvas.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size, size);

    const theme = resolveChartCanvasColors(card);
    const { forValue } = getColorScheme(colorScheme);
    const fillFor = (yieldPercent: number) => forValue(Math.max(0, Math.min(1, yieldPercent / 100)));

    const cx = size / 2, cy = size / 2;
    const margin = 34; // room for label chips near the outer edge
    const R = size / 2 - margin;

    if (mode === 'ring') {
      const n = rows.length;
      for (let i = 0; i < n; i++) {
        const rInner = (i / n) * R;
        const rOuter = ((i + 1) / n) * R;
        ctx.beginPath();
        ctx.arc(cx, cy, rOuter, 0, 2 * Math.PI);
        ctx.arc(cx, cy, rInner, 0, 2 * Math.PI, true);
        ctx.closePath();
        ctx.fillStyle = fillFor(rows[i].yieldPercent);
        ctx.fill();
        ctx.strokeStyle = theme.border;
        ctx.lineWidth = 1;
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.arc(cx, cy, R, 0, 2 * Math.PI);
      ctx.strokeStyle = theme.text;
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // One label per ring, spread around a different angle per ring
      // (starting at 12 o'clock, going clockwise) as well as each band's own
      // mid-radius — stacking every label straight up from centre crowded
      // them into an illegible pile for any ringCount above 2, since
      // adjacent bands are typically closer together than one label chip is
      // tall. Distributing by angle too keeps them apart regardless of
      // ringCount.
      for (let i = 0; i < n; i++) {
        const rMid = ((i + 0.5) / n) * R;
        const angle = -Math.PI / 2 + (i / n) * 2 * Math.PI;
        const lx = cx + Math.cos(angle) * rMid;
        const ly = cy + Math.sin(angle) * rMid;
        drawLabelChip(ctx, lx, ly, rows[i].label, `${rows[i].yieldPercent.toFixed(1)}%`, theme);
      }
    } else {
      for (const row of rows) {
        const quad = parseRegionKey(row.key).quadrant;
        const angles = quad ? QUADRANT_ANGLES[quad] : undefined;
        if (!angles) continue;
        const [a0, a1] = angles;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.arc(cx, cy, R, a0, a1);
        ctx.closePath();
        ctx.fillStyle = fillFor(row.yieldPercent);
        ctx.fill();
        ctx.strokeStyle = theme.border;
        ctx.lineWidth = 1;
        ctx.stroke();

        const mid = (a0 + a1) / 2;
        const labelX = cx + Math.cos(mid) * R * 0.6;
        const labelY = cy + Math.sin(mid) * R * 0.6;
        drawLabelChip(ctx, labelX, labelY, row.label, `${row.yieldPercent.toFixed(1)}%`, theme);
      }
      ctx.beginPath();
      ctx.arc(cx, cy, R, 0, 2 * Math.PI);
      ctx.strokeStyle = theme.text;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  }

  const resizeHandle = observeResize(card, () => draw());
  draw();
  return { card, hasData, destroy: () => resizeHandle.disconnect() };
}
