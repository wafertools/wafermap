import type { Scene } from '../renderer/buildScene.js';
import type { Die } from '../core/dies.js';
import { getColorScheme } from '../renderer/colorSchemes.js';
import { fmt, fmtColorbarAxis } from '../renderer/fmt.js';
import { svgPathToCanvas } from './svgPathToCanvas.js';

export interface ToCanvasOptions {
  /** Padding in CSS pixels inside the canvas edge. Default 16. */
  padding?: number;
  /** Draw a continuous colorbar (value modes) or bin legend (bin modes). Default true. */
  showColorbar?: boolean;
  /** Width in CSS pixels of the colorbar strip. Default 16. */
  colorbarWidth?: number;
  /** Canvas background colour. Default '#f5f5f5'. */
  background?: string;
  /**
   * Draw axis tick marks and labels. Default false.
   * When true, labels show die grid indices if `diePitchMm` is provided,
   * otherwise mm values.
   */
  showAxes?: boolean;
  /** Die pitch in mm — used to convert mm axis values to die-index labels. */
  diePitchMm?: { x: number; y: number };
  /**
   * Override the viewport transform. When provided, `originX`, `originY`,
   * and `ppm` replace the auto-fitted values — used by mountWaferCanvas for
   * zoom/pan. Also accepts a zoom-adjusted `snapDist` for hit testing.
   */
  _viewport?: ViewportTransform;
  /** Currently highlighted bin — drawn with an active indicator in the bin legend. */
  _activeBin?: number;
  /**
   * Format to use for unitless values outside the normal display range [0.1, 9999].
   * `'engineering'` (default): multiples-of-3 exponent notation (e.g. `12E-6`).
   * `'si'`: SI prefix with no unit suffix (e.g. `12 µ`).
   * Values with a unit always use SI prefix regardless of this setting.
   */
  fallbackFormat?: 'si' | 'engineering';
}

/** Internal viewport state shared between toCanvas and mountWaferCanvas. */
export interface ViewportTransform {
  originX:  number;
  originY:  number;
  ppm:      number;   // pixels per mm
  snapDist: number;   // mm radius for getDieAtPoint proximity test
}

export interface CanvasHitTarget {
  /** Given a CSS-pixel position on the canvas, return the die at that point or null. */
  getDieAtPoint(x: number, y: number): Die | null;
}

/** A hit-testable row in the bin legend — one entry per unique bin. */
export interface BinLegendRow {
  bin: number;
  /** Top CSS-pixel of the row (relative to canvas). */
  y:   number;
  /** Height in CSS pixels of the row. */
  h:   number;
}

export interface ToCanvasResult {
  hitTarget:      CanvasHitTarget;
  /** The fitted viewport — useful as initial state for mountWaferCanvas. */
  viewport:       ViewportTransform;
  /** Non-empty only when a bin legend was drawn (hardbin / softbin modes). */
  binLegendRows:  BinLegendRow[];
}

const COLORBAR_MODES   = new Set(['value', 'stackedValues', 'stackedBins', 'stackedSoftBins']);
const BIN_LEGEND_MODES = new Set(['hardbin', 'softbin']);
const COLORBAR_LABEL_FONT = '10px system-ui, sans-serif';
const COLORBAR_STEPS = 128;
const AXIS_TICK_FONT  = '10px system-ui, sans-serif';
const AXIS_TICK_LEN   = 4;  // px
const BIN_ROW_H       = 17; // px per legend row
const BIN_SWATCH_SIZE = 11; // px
const BIN_LEGEND_W    = 110; // px total right-side reserve for bin legend
const BIN_COUNT_W     = 28;  // px reserved on the right of the legend for the die count
const BIN_LABEL_GAP   = 5;   // px gap between swatch and label

export function toCanvas(
  canvas: HTMLCanvasElement,
  scene: Scene,
  options: ToCanvasOptions = {},
): ToCanvasResult {
  const {
    padding       = 16,
    showColorbar  = true,
    colorbarWidth = 16,
    background    = '#f5f5f5',
    showAxes      = false,
    diePitchMm,
    _viewport,
    _activeBin,
    fallbackFormat,
  } = options;

  const drawColorbar   = showColorbar && COLORBAR_MODES.has(scene.plotMode);
  const drawBinLegend  = showColorbar && BIN_LEGEND_MODES.has(scene.plotMode);

  // ── HiDPI setup ────────────────────────────────────────────────────────────
  const dpr     = window.devicePixelRatio ?? 1;
  const cssW    = Math.floor(canvas.clientWidth  || canvas.width);
  const cssH    = Math.floor(canvas.clientHeight || canvas.height);

  // Canvas not yet laid out — bail without touching canvas dimensions so that
  // the ResizeObserver fires when layout is resolved and triggers a real render.
  if (cssW <= 0 || cssH <= 0) {
    const vp: ViewportTransform = { originX: 0, originY: 0, ppm: 1, snapDist: 1 };
    return { hitTarget: { getDieAtPoint: () => null }, viewport: vp, binLegendRows: [] };
  }

  canvas.width  = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);

  const ctx = canvas.getContext('2d')!;
  ctx.scale(dpr, dpr);

  // ── Background ─────────────────────────────────────────────────────────────
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, cssW, cssH);

  // ── Compute data bounding box ───────────────────────────────────────────────
  const pts = scene.hoverPoints;
  if (!pts.length) {
    const vp: ViewportTransform = { originX: 0, originY: 0, ppm: 1, snapDist: 1 };
    return { hitTarget: { getDieAtPoint: () => null }, viewport: vp, binLegendRows: [] };
  }

  const firstRect = scene.rectangles[0];
  const halfW = firstRect ? firstRect.width  / 2 : 0;
  const halfH = firstRect ? firstRect.height / 2 : 0;

  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of pts) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  minX -= halfW; maxX += halfW;
  minY -= halfH; maxY += halfH;

  const dataW = maxX - minX;
  const dataH = maxY - minY;

  // ── Viewport transform ─────────────────────────────────────────────────────
  const colorbarReserve = drawColorbar ? colorbarWidth + 28 : drawBinLegend ? BIN_LEGEND_W : 0;
  const axisReserve     = showAxes ? 32 : 0;
  const axisLeftReserve = showAxes ? 36 : 0;
  const drawW = cssW - 2 * padding - colorbarReserve - axisLeftReserve;
  const drawH = cssH - 2 * padding - axisReserve;

  let originX: number, originY: number, ppm: number;

  if (_viewport) {
    ({ originX, originY, ppm } = _viewport);
  } else {
    ppm     = Math.min(drawW / dataW, drawH / dataH);
    originX = padding + axisLeftReserve + (drawW - dataW * ppm) / 2 - minX * ppm;
    originY = padding + (drawH - dataH * ppm) / 2 + maxY * ppm;
  }

  const snapDist = _viewport?.snapDist ?? Math.max(halfW, halfH, 1) * 1.5;

  // ── Draw rectangles ────────────────────────────────────────────────────────
  ctx.save();
  ctx.setTransform(ppm * dpr, 0, 0, -ppm * dpr, originX * dpr, originY * dpr);

  for (const rect of scene.rectangles) {
    ctx.beginPath();
    svgPathToCanvas(ctx, rect.path);
    ctx.fillStyle = String(rect.fill);
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.18)';
    ctx.lineWidth = 0.5 / (ppm * dpr);
    ctx.stroke();
  }

  // ── Draw overlays ──────────────────────────────────────────────────────────
  for (const overlay of scene.overlays) {
    ctx.beginPath();
    svgPathToCanvas(ctx, overlay.path);
    if (overlay.fill && !overlay.fill.startsWith('rgba(0,0,0,0)')) {
      ctx.fillStyle = overlay.fill;
      ctx.fill();
    }
    ctx.strokeStyle = overlay.lineColor;
    ctx.lineWidth = overlay.lineWidth / (ppm * dpr);
    ctx.stroke();
  }

  ctx.restore();

  // ── Draw text labels (screen coords to avoid Y-flip distortion) ────────────
  ctx.save();
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'middle';
  for (const text of scene.texts) {
    const sx = originX + text.x * ppm;
    const sy = originY - text.y * ppm;
    ctx.font      = `${text.fontSize}px system-ui, sans-serif`;
    ctx.fillStyle = text.color;
    ctx.fillText(text.text, sx, sy);
  }
  ctx.restore();

  // ── Draw axis ticks ────────────────────────────────────────────────────────
  if (showAxes) {
    drawAxisTicks(ctx, cssW, cssH, originX, originY, ppm, padding, axisReserve, axisLeftReserve, diePitchMm, scene.axisFlip, scene.rotation);
  }

  // ── Draw colorbar ──────────────────────────────────────────────────────────
  if (drawColorbar) {
    const scheme    = getColorScheme(scene.colorScheme);
    const labelGap  = 20;
    // Match Plotly: bar occupies ~75% of canvas height, centred vertically.
    const cbH       = Math.round((cssH - 2 * padding) * 0.75);
    const cbY       = padding + Math.round((cssH - 2 * padding - cbH) / 2);
    const cbX       = cssW - padding - colorbarWidth - labelGap;
    const [vMin, vMax] = scene.valueRange;
    const vRange    = vMax - vMin;

    // Gradient strip.
    for (let i = 0; i < COLORBAR_STEPS; i++) {
      const t  = 1 - i / (COLORBAR_STEPS - 1);
      const sy = cbY + (i / COLORBAR_STEPS) * cbH;
      const sh = cbH / COLORBAR_STEPS + 1;
      ctx.fillStyle = scheme.forValue(t);
      ctx.fillRect(cbX, sy, colorbarWidth, sh);
    }

    ctx.strokeStyle = 'rgba(0,0,0,0.25)';
    ctx.lineWidth   = 0.5;
    ctx.strokeRect(cbX, cbY, colorbarWidth, cbH);

    // Ticks + labels.
    ctx.fillStyle   = '#333';
    ctx.font        = COLORBAR_LABEL_FONT;
    ctx.textAlign   = 'left';
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.lineWidth   = 0.5;

    const tickLen    = 3;
    const minPixels  = 36;  // minimum px between tick centres
    const step       = vRange > 0 ? niceStep(vRange * minPixels / cbH) : 0;

    // Exclude intermediates within this many px of either endpoint — enough
    // that a 10px 'middle'-baseline label never overlaps the endpoint label.
    const endpointGuard = 14;
    const ticks: number[] = [];
    if (step > 0) {
      const first = Math.ceil(vMin / step) * step;
      for (let v = first; v <= vMax + step * 1e-6; v += step) {
        const py = (1 - (v - vMin) / vRange) * cbH;
        if (py > endpointGuard && py < cbH - endpointGuard) ticks.push(v);
      }
    }

    const testDef = scene.testDefs?.find(t => t.index === scene.testIndex);
    const isCountMode = scene.plotMode === 'stackedBins' || scene.plotMode === 'stackedSoftBins';
    const cbName  = isCountMode ? 'Count' : testDef?.name;
    const cbUnit  = isCountMode ? undefined : testDef?.unit;
    const { tickFmt, axisLabel } = fmtColorbarAxis(
      vMax, cbName, cbUnit, fallbackFormat,
    );

    // Draw intermediate ticks with middle baseline.
    ctx.textBaseline = 'middle';
    for (const v of ticks) {
      const sy = cbY + (1 - (v - vMin) / vRange) * cbH;
      ctx.beginPath();
      ctx.moveTo(cbX + colorbarWidth, sy);
      ctx.lineTo(cbX + colorbarWidth + tickLen, sy);
      ctx.stroke();
      ctx.fillText(tickFmt(v), cbX + colorbarWidth + tickLen + 2, sy);
    }

    // Always draw exact min/max at the bar edges.
    ctx.beginPath();
    ctx.moveTo(cbX + colorbarWidth, cbY);
    ctx.lineTo(cbX + colorbarWidth + tickLen, cbY);
    ctx.stroke();
    ctx.textBaseline = 'top';
    ctx.fillText(tickFmt(vMax), cbX + colorbarWidth + tickLen + 2, cbY);

    ctx.beginPath();
    ctx.moveTo(cbX + colorbarWidth, cbY + cbH);
    ctx.lineTo(cbX + colorbarWidth + tickLen, cbY + cbH);
    ctx.stroke();
    ctx.textBaseline = 'bottom';
    ctx.fillText(tickFmt(vMin), cbX + colorbarWidth + tickLen + 2, cbY + cbH);

    // Axis label above the bar, right-aligned to the tick column — e.g. "Idsat (mA)".
    const cbLabel = axisLabel || null;
    if (cbLabel) {
      ctx.save();
      ctx.fillStyle    = '#555';
      ctx.font         = COLORBAR_LABEL_FONT;
      ctx.textAlign    = 'right';
      ctx.textBaseline = 'top';
      ctx.fillText(cbLabel, cssW - padding, padding);
      ctx.restore();
    }
  }

  // ── Draw bin legend ────────────────────────────────────────────────────────
  const binLegendRows: BinLegendRow[] = [];

  if (drawBinLegend) {
    const scheme = getColorScheme(scene.colorScheme);

    // Collect unique bins from dies — use only the slot that matches the active mode.
    // Hard bins are bins[0], soft bins are bins[1]; independent number spaces (STDF V4).
    const binIndex  = scene.plotMode === 'softbin' ? 1 : 0;
    const binCounts = new Map<number, number>();
    for (const die of scene.dies) {
      if (die.partial) continue;
      const bin = die.bins?.[binIndex];
      if (bin == null) continue;
      binCounts.set(bin, (binCounts.get(bin) ?? 0) + 1);
    }
    const entries = [...binCounts.entries()].sort(([a], [b]) => a - b);

    const legendX    = cssW - padding - BIN_LEGEND_W + 4;
    const swatchX    = legendX;
    const labelX     = legendX + BIN_SWATCH_SIZE + BIN_LABEL_GAP;
    const countX     = cssW - padding + 2;
    // Available width for the label text: total legend minus swatch, gap, and count column.
    const maxLabelW  = BIN_LEGEND_W - BIN_SWATCH_SIZE - BIN_LABEL_GAP - BIN_COUNT_W;
    const maxRows    = Math.floor((cssH - 2 * padding) / BIN_ROW_H);
    const overflow   = entries.length > maxRows ? entries.length - (maxRows - 1) : 0;
    const visible    = overflow > 0 ? entries.slice(0, maxRows - 1) : entries;
    let rowY         = padding + Math.round((cssH - 2 * padding - Math.min(entries.length, maxRows) * BIN_ROW_H) / 2);

    ctx.save();
    ctx.font = COLORBAR_LABEL_FONT;

    // Hard and soft bins have independent number spaces — pick the correct def array for the mode.
    const activeDefs = scene.plotMode === 'softbin' ? scene.sbinDefs : scene.hbinDefs;
    const binDefMap  = activeDefs ? new Map(activeDefs.map(d => [d.bin, d])) : null;

    // Truncate text to fit maxLabelW pixels, appending ellipsis if needed.
    function truncate(text: string, maxW: number): string {
      if (ctx.measureText(text).width <= maxW) return text;
      let lo = 0, hi = text.length;
      const ellipsis = '…';
      const ellW = ctx.measureText(ellipsis).width;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (ctx.measureText(text.slice(0, mid)).width + ellW <= maxW) lo = mid;
        else hi = mid - 1;
      }
      return lo === 0 ? ellipsis : text.slice(0, lo) + ellipsis;
    }

    for (const [bin, count] of visible) {
      const isActive  = _activeBin === bin;
      const swatchY   = rowY + Math.round((BIN_ROW_H - BIN_SWATCH_SIZE) / 2);
      const binDef    = binDefMap?.get(bin);
      const midY      = rowY + BIN_ROW_H / 2;

      // Swatch fill — use BinDef color override if present.
      ctx.fillStyle = binDef?.color ?? scheme.forBin(bin);
      ctx.fillRect(swatchX, swatchY, BIN_SWATCH_SIZE, BIN_SWATCH_SIZE);

      // Swatch border — thicker + blue when active.
      ctx.strokeStyle = isActive ? '#1a66cc' : 'rgba(0,0,0,0.25)';
      ctx.lineWidth   = isActive ? 2 : 0.75;
      ctx.strokeRect(swatchX, swatchY, BIN_SWATCH_SIZE, BIN_SWATCH_SIZE);

      // Label — truncated to fit within the label column.
      const rawLabel   = binDef?.name ? `${bin} · ${binDef.name}` : `Bin ${bin}`;
      ctx.fillStyle    = isActive ? '#1a66cc' : '#333';
      ctx.font         = isActive ? 'bold 10px system-ui, sans-serif' : COLORBAR_LABEL_FONT;
      ctx.textAlign    = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(truncate(rawLabel, maxLabelW), labelX, midY);

      // Die count — right-aligned, inside the legend reserve.
      ctx.fillStyle    = '#999';
      ctx.font         = COLORBAR_LABEL_FONT;
      ctx.textAlign    = 'right';
      ctx.fillText(String(count), countX, midY);

      binLegendRows.push({ bin, y: rowY, h: BIN_ROW_H });
      rowY += BIN_ROW_H;
    }

    // Overflow indicator.
    if (overflow > 0) {
      ctx.fillStyle    = '#aaa';
      ctx.font         = COLORBAR_LABEL_FONT;
      ctx.textAlign    = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(`+ ${overflow} more`, labelX, rowY + BIN_ROW_H / 2);
    }

    ctx.restore();
  }

  // ── Build viewport and hit target ──────────────────────────────────────────
  const viewport: ViewportTransform = { originX, originY, ppm, snapDist };

  const hitTarget: CanvasHitTarget = {
    getDieAtPoint(px: number, py: number): Die | null {
      const mx = (px - originX) / ppm;
      const my = (originY - py) / ppm;

      let bestDie: Die | null = null;
      let bestDist = snapDist * snapDist;

      for (let i = 0; i < pts.length; i++) {
        const dx = pts[i].x - mx;
        const dy = pts[i].y - my;
        const d2 = dx * dx + dy * dy;
        if (d2 < bestDist) {
          bestDist = d2;
          bestDie  = scene.dies[i] ?? null;
        }
      }
      return bestDie;
    },
  };

  return { hitTarget, viewport, binLegendRows };
}

// ── Axis tick rendering ────────────────────────────────────────────────────────

function drawAxisTicks(
  ctx: CanvasRenderingContext2D,
  cssW: number,
  cssH: number,
  originX: number,
  originY: number,
  ppm: number,
  padding: number,
  axisReserve: number,
  axisLeftReserve: number,
  diePitchMm?: { x: number; y: number },
  axisFlip?: { x: boolean; y: boolean },
  rotation = 0,
): void {
  ctx.save();
  ctx.font        = AXIS_TICK_FONT;
  ctx.fillStyle   = '#555';
  ctx.strokeStyle = '#bbb';
  ctx.lineWidth   = 0.5;

  const axisY = cssH - axisReserve + 4;
  const axisX = padding + axisLeftReserve - 4;

  // Target ~one tick per 50px. Same step for both axes (square die grid).
  const tickStepMm = niceStep(50 / ppm);

  // Convert a display-space mm position to the die grid index for axis labels.
  //
  // CCW rotation R maps die coords to display coords as:
  //   display_x =  cos(R)*die_x - sin(R)*die_y
  //   display_y =  sin(R)*die_x + cos(R)*die_y
  // Inverting for the 4 cardinal cases (before any flip):
  //   R=0:   die_x =  display_x/px,  die_y =  display_y/py
  //   R=90:  die_x =  display_y/px,  die_y = -display_x/py
  //   R=180: die_x = -display_x/px,  die_y = -display_y/py
  //   R=270: die_x = -display_y/px,  die_y =  display_x/py
  //
  // axisFlip (XOR of data-pipeline and interactive flips) negates the display coordinate
  // before the rotation inverse, so flip sign is applied to the mm value first.
  const r = ((rotation % 360) + 360) % 360;
  const fx = axisFlip?.x ? -1 : 1;  // flip applied to display-X before inversion
  const fy = axisFlip?.y ? -1 : 1;  // flip applied to display-Y before inversion

  function dieIndexForDisplayX(mm: number): number {
    if (!diePitchMm) return mm;
    const ux = fx * mm; // unflipped display-X
    if (r === 0)   return Math.round( ux / diePitchMm.x);
    if (r === 90)  return Math.round(-ux / diePitchMm.y);
    if (r === 180) return Math.round(-ux / diePitchMm.x);
    /* 270 */      return Math.round( ux / diePitchMm.y);
  }

  function dieIndexForDisplayY(mm: number): number {
    if (!diePitchMm) return mm;
    const uy = fy * mm; // unflipped display-Y
    if (r === 0)   return Math.round( uy / diePitchMm.y);
    if (r === 90)  return Math.round( uy / diePitchMm.x);
    if (r === 180) return Math.round(-uy / diePitchMm.y);
    /* 270 */      return Math.round(-uy / diePitchMm.x);
  }

  // X axis (bottom)
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'top';
  const xStartMm = Math.ceil(((padding - originX) / ppm) / tickStepMm) * tickStepMm;
  const xEndMm   = (cssW - padding - originX) / ppm;
  for (let mm = xStartMm; mm <= xEndMm; mm += tickStepMm) {
    const sx = originX + mm * ppm;
    if (sx < padding || sx > cssW - padding) continue;
    ctx.beginPath();
    ctx.moveTo(sx, axisY - AXIS_TICK_LEN);
    ctx.lineTo(sx, axisY);
    ctx.stroke();
    const label = diePitchMm ? String(dieIndexForDisplayX(mm)) : fmt(mm);
    ctx.fillText(label, sx, axisY + 2);
  }

  // Y axis (left) — remember Y is flipped: screen y = originY - mm * ppm
  ctx.textAlign    = 'right';
  ctx.textBaseline = 'middle';
  const yStartMm = Math.ceil(((originY - (cssH - padding)) / ppm) / tickStepMm) * tickStepMm;
  const yEndMm   = (originY - padding) / ppm;
  for (let mm = yStartMm; mm <= yEndMm; mm += tickStepMm) {
    const sy = originY - mm * ppm;
    if (sy < padding || sy > cssH - padding) continue;
    ctx.beginPath();
    ctx.moveTo(axisX, sy);
    ctx.lineTo(axisX + AXIS_TICK_LEN, sy);
    ctx.stroke();
    const label = diePitchMm ? String(dieIndexForDisplayY(mm)) : fmt(mm);
    ctx.fillText(label, axisX - 2, sy);
  }

  ctx.restore();
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function niceStep(rawMm: number): number {
  const magnitude = Math.pow(10, Math.floor(Math.log10(rawMm)));
  const f = rawMm / magnitude;
  return (f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10) * magnitude;
}

export { fmt, fmtColorbarAxis } from '../renderer/fmt.js';
