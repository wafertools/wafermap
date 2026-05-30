import type { View, ViewRect } from '../renderer/buildView.js';
import { findTestDef } from '../renderer/buildView.js';
import type { Die } from '../core/dies.js';
import { getColorScheme } from '../renderer/colorSchemes.js';
import { fmt, fmtColorbarAxis } from '../renderer/fmt.js';

export interface ToCanvasOptions {
  /** Padding in CSS pixels inside the canvas edge. Default 16. */
  padding?: number;
  /** Draw a continuous colorbar (value modes) or bin legend (bin modes). Default true. */
  showColorbar?: boolean;
  /** Width in CSS pixels of the colorbar strip. Default 16. */
  colorbarWidth?: number;
  /** Canvas background colour. Default '#f5f5f5'. */
  background?: string;
  /** Legend position for bin modes. Default 'default'. */
  legendPosition?: 'default' | 'compact' | 'bottom' | 'top' | 'left' | 'floating';
  /** Floating legend offset in CSS pixels. Used when `legendPosition === 'floating'`. */
  legendOffset?: { x: number; y: number };
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
  viewport?: ViewportTransform;
  /** Currently highlighted bin — drawn with an active indicator in the bin legend. */
  activeBin?: number;
  /**
   * Format to use for unitless values outside the normal display range [0.1, 9999].
   * `'engineering'` (default): multiples-of-3 exponent notation (e.g. `12E-6`).
   * `'si'`: SI prefix with no unit suffix (e.g. `12 µ`).
   * Values with a unit always use SI prefix regardless of this setting.
   */
  fallbackFormat?: 'si' | 'engineering';
  /** Extra space reserved at the top of the canvas in CSS pixels. Default 0. Used by renderWaferMap to prevent the floating toolbar from obscuring the wafer. */
  topClearance?: number;
  /** Minimum right-side reserve in CSS pixels. Ensures the wafer draw width stays stable across plot mode switches. */
  minRightReserve?: number;
  /** Named hard bin definitions — used to label the bin legend. */
  hbinDefs?: import('../renderer/buildWaferMap.js').BinDef[];
  /** Named soft bin definitions — used to label the bin legend. */
  sbinDefs?: import('../renderer/buildWaferMap.js').BinDef[];
}

/** Internal viewport state shared between toCanvas and mountWaferCanvas. */
export interface ViewportTransform {
  originX:  number;
  originY:  number;
  ppm:      number;   // pixels per mm
  snapDist: number;   // mm radius for getDieAtPoint proximity test
}

export interface HitTarget {
  /** Given a CSS-pixel position on the canvas, return the die at that point or null. */
  getDieAtPoint(x: number, y: number): Die | null;
}

/** @deprecated Use HitTarget instead. */
export type CanvasHitTarget = HitTarget;

/** A hit-testable row in the bin legend — one entry per unique bin. */
export interface BinLegendRow {
  bin: number;
  x: number;
  /** Top CSS-pixel of the row (relative to canvas). */
  y: number;
  /** Width in CSS pixels of the row. */
  w: number;
  /** Height in CSS pixels of the row. */
  h: number;
  /** Optional full label text for tooltips. */
  label?: string;
}

export interface ToCanvasResult {
  hitTarget:      HitTarget;
  /** The fitted viewport — useful as initial state for mountWaferCanvas. */
  viewport:       ViewportTransform;
  /** Non-empty only when a bin legend was drawn (hardbin / softbin modes). */
  binLegendRows:  BinLegendRow[];
  /** Floating legend box bounds, when rendered. */
  legendBox?:     { x: number; y: number; w: number; h: number };
}

const COLORBAR_MODES   = new Set(['value', 'stackedValues', 'stackedBins', 'stackedSoftBins']);
const BIN_LEGEND_MODES = new Set(['hardBin', 'softBin']);
const COLORBAR_LABEL_FONT = '10px system-ui, sans-serif';
const COLORBAR_STEPS = 128;
const AXIS_TICK_FONT  = '10px system-ui, sans-serif';
const AXIS_TICK_LEN   = 4;  // px
const BIN_ROW_H       = 17; // px per legend row
const BIN_SWATCH_SIZE = 11; // px
export const BIN_LEGEND_W               = 110; // px total right-side reserve for bin legend
export const BIN_LEGEND_W_COMPACT       =  64; // px right-side reserve for compact legend
export const BIN_LEGEND_ADAPT_COMPACT   = 280; // px canvas width — below this, auto-switch to compact
export const BIN_LEGEND_ADAPT_FLOATING  = 180; // px canvas width — below this, auto-switch to floating
const BIN_COUNT_W          = 28;  // px reserved on the right of the legend for the die count
const BIN_LABEL_GAP        =  5;  // px gap between swatch and label
const BIN_FLOATING_PADDING =  8;  // px padding around floating legend box

export function toCanvas(
  canvas: HTMLCanvasElement,
  view: View,
  options: ToCanvasOptions = {},
): ToCanvasResult {
  const {
    padding       = 16,
    showColorbar  = true,
    colorbarWidth = 16,
    background    = '#f5f5f5',
    legendPosition   = 'default',
    legendOffset,
    showAxes      = false,
    diePitchMm,
    viewport: viewportOverride,
    activeBin,
    fallbackFormat,
    topClearance  = 0,
    minRightReserve,
    hbinDefs,
    sbinDefs,
  } = options;

  const drawColorbar   = showColorbar && COLORBAR_MODES.has(view.plotMode) && !view.colorBySpec;
  const drawBinLegend  = showColorbar && BIN_LEGEND_MODES.has(view.plotMode);

  const binLegendEntries: Array<[number, number]> = drawBinLegend && view.binCounts
    ? [...view.binCounts.entries()].sort(([a], [b]) => a - b)
    : [];

  const dpr     = window.devicePixelRatio ?? 1;
  const cssW    = Math.floor(canvas.clientWidth  || canvas.width);
  const cssH    = Math.floor(canvas.clientHeight || canvas.height);

  // Canvas not yet laid out — bail without touching canvas dimensions so that
  // the ResizeObserver fires when layout is resolved and triggers a real render.
  if (cssW <= 0 || cssH <= 0) {
    const vp: ViewportTransform = { originX: 0, originY: 0, ppm: 1, snapDist: 1 };
    return { hitTarget: { getDieAtPoint: () => null }, viewport: vp, binLegendRows: [] };
  }

  // When the caller leaves legendPosition at 'default', auto-adapt for small canvases
  // so gallery cards use proportionally less side space for the legend.
  const effectiveLegendPosition: typeof legendPosition =
    legendPosition !== 'default' ? legendPosition
    : cssW < BIN_LEGEND_ADAPT_FLOATING ? 'floating'
    : cssW < BIN_LEGEND_ADAPT_COMPACT  ? 'compact'
    : 'default';

  const legendIsRight    = effectiveLegendPosition === 'default' || effectiveLegendPosition === 'compact';
  const legendIsLeft     = effectiveLegendPosition === 'left';
  const legendIsBottom   = effectiveLegendPosition === 'bottom';
  const legendIsTop      = effectiveLegendPosition === 'top';
  const legendIsFloating = effectiveLegendPosition === 'floating';
  const legendWidth = effectiveLegendPosition === 'compact' || effectiveLegendPosition === 'floating' ? BIN_LEGEND_W_COMPACT : BIN_LEGEND_W;

  const maxLegendRows  = Math.floor((cssH - 2 * padding) / BIN_ROW_H);
  const legendRowCount = binLegendEntries.length > maxLegendRows ? maxLegendRows - 1 : binLegendEntries.length;
  const bottomLegendReserve = drawBinLegend && legendIsBottom ? legendRowCount * BIN_ROW_H : 0;
  const topLegendReserve    = drawBinLegend && legendIsTop    ? legendRowCount * BIN_ROW_H : 0;
  const rightReserve    = drawColorbar ? colorbarWidth + 28 : drawBinLegend && legendIsRight ? legendWidth : 0;
  const leftLegendReserve   = drawBinLegend && legendIsLeft   ? legendWidth : 0;
  const axisReserve     = showAxes ? 32 : 0;
  const axisLeftReserve = showAxes ? 36 : 0;
  // When the caller specifies a minimum right reserve, use it so the wafer size
  // stays constant when switching between value and bin plot modes.
  const effectiveRightReserve = minRightReserve != null
    ? Math.max(rightReserve, minRightReserve)
    : rightReserve;
  const drawW = cssW - 2 * padding - effectiveRightReserve - axisLeftReserve - leftLegendReserve;
  const drawH = cssH - 2 * padding - axisReserve - bottomLegendReserve - topLegendReserve;

  canvas.width  = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);

  const ctx = canvas.getContext('2d')!;
  ctx.scale(dpr, dpr);

  // ── Background ─────────────────────────────────────────────────────────────
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, cssW, cssH);

  // ── Compute data bounding box ───────────────────────────────────────────────
  const pts = view.hoverPoints;
  if (!pts.length) {
    const vp: ViewportTransform = { originX: 0, originY: 0, ppm: 1, snapDist: 1 };
    return { hitTarget: { getDieAtPoint: () => null }, viewport: vp, binLegendRows: [] };
  }

  const firstRect = view.rectangles[0];
  const halfW = firstRect ? firstRect.width  / 2 : 0;
  const halfH = firstRect ? firstRect.height / 2 : 0;

  const bounds = view.dieBounds;
  const minX = (bounds?.minX ?? 0) - halfW;
  const maxX = (bounds?.maxX ?? 0) + halfW;
  const minY = (bounds?.minY ?? 0) - halfH;
  const maxY = (bounds?.maxY ?? 0) + halfH;

  const dataW = maxX - minX;
  const dataH = maxY - minY;

  let originX: number, originY: number, ppm: number;
  if (viewportOverride) {
    ({ originX, originY, ppm } = viewportOverride);
  } else {
    // Fit within the drawable area minus the top clearance so the wafer doesn't
    // clip into the bottom padding after being shifted down by topClearance.
    const fitH = drawH - topClearance;
    ppm     = Math.min(drawW / dataW, fitH / dataH);
    originX = padding + axisLeftReserve + leftLegendReserve + (drawW - dataW * ppm) / 2 - minX * ppm;
    originY = padding + topClearance + topLegendReserve + (fitH - dataH * ppm) / 2 + maxY * ppm;
  }

  const snapDist = viewportOverride?.snapDist ?? Math.max(halfW, halfH, 1) * 1.5;

  // ── Draw rectangles ────────────────────────────────────────────────────────
  ctx.save();
  ctx.setTransform(ppm * dpr, 0, 0, -ppm * dpr, originX * dpr, originY * dpr);

  // Batch rectangles by fill color — one beginPath/fill per unique color instead of per die.
  // Uses ctx.rect() on pre-parsed ViewRect coords, eliminating svgPathToCanvas string parsing.
  if (view.rectangles.length > 0) {
    const byColor = new Map<string, ViewRect[]>();
    for (const rect of view.rectangles) {
      const fill = String(rect.fill);
      let group = byColor.get(fill);
      if (!group) { group = []; byColor.set(fill, group); }
      group.push(rect);
    }
    for (const [fill, group] of byColor) {
      ctx.beginPath();
      for (const r of group) ctx.rect(r.x - r.width / 2, r.y - r.height / 2, r.width, r.height);
      ctx.fillStyle = fill;
      ctx.fill();
    }
    // Single stroke pass over all rects (constant color and width for all dies).
    ctx.strokeStyle = 'rgba(0,0,0,0.18)';
    ctx.lineWidth = 0.5 / (ppm * dpr);
    ctx.beginPath();
    for (const r of view.rectangles) ctx.rect(r.x - r.width / 2, r.y - r.height / 2, r.width, r.height);
    ctx.stroke();
  }

  // ── Draw overlays ──────────────────────────────────────────────────────────
  for (const overlay of view.overlays) {
    ctx.beginPath();
    for (const polyline of overlay.points) {
      for (let i = 0; i < polyline.length; i++) {
        if (i === 0) ctx.moveTo(polyline[i].x, polyline[i].y);
        else ctx.lineTo(polyline[i].x, polyline[i].y);
      }
      if (overlay.closed) ctx.closePath();
    }
    if (overlay.fill && !overlay.fill.startsWith('rgba(0,0,0,0)')) {
      ctx.fillStyle = overlay.fill;
      ctx.fill();
    }
    ctx.strokeStyle = overlay.lineColor;
    ctx.lineWidth = overlay.lineWidth / (ppm * dpr);
    ctx.stroke();
  }

  ctx.restore();

  // ── Draw notch orientation arrow (fixed px, screen space) ─────────────────
  // Arrow points inward toward the wafer. Clipped to the wafer draw area so it
  // never overlaps the toolbar, legend, or canvas edge.
  if (view.notchDir) {
    const cx = originX + view.waferCenter.x * ppm;
    const cy = originY - view.waferCenter.y * ppm;
    const nx =  view.notchDir.x;
    const ny = -view.notchDir.y;  // canvas Y is inverted relative to data Y
    const r_px = view.waferRadius * ppm;
    const OFFSET = 4;   // px gap between wafer edge and arrow tip
    const ARROW_L = 9;  // px arrow length (tip to base)
    const ARROW_W = 5;  // px half-width at base
    // Tip points inward (toward the wafer), base is further out
    const tipX  = cx + nx * (r_px + OFFSET);
    const tipY  = cy + ny * (r_px + OFFSET);
    const baseX = tipX + nx * ARROW_L;
    const baseY = tipY + ny * ARROW_L;
    const perp = { x: -ny, y: nx };
    // Safe drawing area — avoids toolbar (top), legend/colorbar (right), and canvas edges
    const safeX1 = padding + axisLeftReserve + leftLegendReserve;
    const safeX2 = cssW - padding - rightReserve;
    const safeY1 = padding + topClearance + topLegendReserve;
    const safeY2 = cssH - padding - bottomLegendReserve - axisReserve;
    ctx.save();
    ctx.beginPath();
    ctx.rect(safeX1, safeY1, safeX2 - safeX1, safeY2 - safeY1);
    ctx.clip();
    ctx.beginPath();
    ctx.moveTo(tipX, tipY);
    ctx.lineTo(baseX + perp.x * ARROW_W, baseY + perp.y * ARROW_W);
    ctx.lineTo(baseX - perp.x * ARROW_W, baseY - perp.y * ARROW_W);
    ctx.closePath();
    ctx.fillStyle = '#555';
    ctx.fill();
    ctx.restore();
  }

  // ── Draw text labels (screen coords to avoid Y-flip distortion) ────────────
  ctx.save();
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'middle';
  for (const text of view.texts) {
    const sx = originX + text.x * ppm;
    const sy = originY - text.y * ppm;
    ctx.font      = `${text.fontSize}px system-ui, sans-serif`;
    ctx.fillStyle = text.color;
    ctx.fillText(text.text, sx, sy);
  }
  ctx.restore();

  // ── Draw axis ticks ────────────────────────────────────────────────────────
  if (showAxes) {
    drawAxisTicks(ctx, cssW, cssH, originX, originY, ppm, padding, axisReserve, axisLeftReserve, diePitchMm, view.axisFlip, view.rotation);
  }

  // ── Draw colorbar ──────────────────────────────────────────────────────────
  if (drawColorbar) {
    const scheme    = getColorScheme(view.colorScheme);
    const labelGap  = 20;
    // Bar occupies ~75% of the usable height below the top clearance, centred in that area.
    const cbUsableH = drawH - topClearance;
    const cbH       = Math.round(cbUsableH * 0.75);
    const cbY       = padding + topClearance + Math.round((cbUsableH - cbH) / 2);
    const cbX       = cssW - padding - colorbarWidth - labelGap;
    const [vMin, vMax] = view.valueRange;
    const vRange    = vMax - vMin;

    // Pre-compute log constants (only valid when view.logScale is true).
    const logMin   = view.logScale && vMin > 0 ? Math.log10(vMin) : 0;
    const logRange = view.logScale && vMax > 0 ? Math.log10(vMax) - logMin : 1;

    // Pixel position of a value along the colorbar (0 = top, cbH = bottom).
    const tickPy = (v: number): number =>
      view.logScale
        ? (1 - (Math.log10(v) - logMin) / logRange) * cbH
        : (1 - (v - vMin) / vRange) * cbH;

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

    const tickLen       = 3;
    const minPixels     = 36;  // minimum px between tick centres
    const endpointGuard = 14;

    const ticks: number[] = view.logScale && logRange > 0
      ? logTicks(vMin, vMax, cbH, minPixels, endpointGuard, logMin, logRange)
      : (() => {
          const step  = vRange > 0 ? niceStep(vRange * minPixels / cbH) : 0;
          const ts: number[] = [];
          if (step > 0) {
            const first = Math.ceil(vMin / step) * step;
            for (let v = first; v <= vMax + step * 1e-6; v += step) {
              const py = (1 - (v - vMin) / vRange) * cbH;
              if (py > endpointGuard && py < cbH - endpointGuard) ts.push(v);
            }
          }
          return ts;
        })();

    const testDef = findTestDef(view.testDefs, view.activeTest!);
    const isCountMode = view.plotMode === 'stackedBins' || view.plotMode === 'stackedSoftBins';
    const cbName  = isCountMode ? 'Count' : (testDef?.name ?? (view.activeTest != null ? `Test ${view.activeTest}` : undefined));
    const cbUnit  = isCountMode ? undefined : testDef?.unit;
    const { tickFmt, axisLabel } = fmtColorbarAxis(
      vMax, cbName, cbUnit, fallbackFormat,
    );

    // Draw intermediate ticks with middle baseline.
    ctx.textBaseline = 'middle';
    for (const v of ticks) {
      const sy = cbY + tickPy(v);
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

    // Axis label below the bar, right-aligned — e.g. "Idsat (mA)" or "Idsat (mA) · mean".
    const aggrSuffix = view.plotMode === 'stackedValues' && view.aggrMethod ? ` · ${view.aggrMethod}` : '';
    const cbLabel = axisLabel ? axisLabel + aggrSuffix : null;
    if (cbLabel) {
      ctx.save();
      ctx.fillStyle    = '#555';
      ctx.font         = COLORBAR_LABEL_FONT;
      ctx.textAlign    = 'right';
      ctx.textBaseline = 'top';
      ctx.fillText(cbLabel, cssW - padding, cbY + cbH + 4);
      ctx.restore();
    }

    // Log scale annotation below the axis label.
    if (view.logScale) {
      ctx.save();
      ctx.fillStyle    = '#555';
      ctx.font         = '9px system-ui, sans-serif';
      ctx.textAlign    = 'right';
      ctx.textBaseline = 'top';
      ctx.fillText('log₁₀', cssW - padding, cbY + cbH + 16);
      ctx.restore();
    }
  }

  // ── Draw bin legend ────────────────────────────────────────────────────────
  const binLegendRows: BinLegendRow[] = [];
  let legendBox: { x: number; y: number; w: number; h: number } | undefined;

  if (drawBinLegend) {
    const scheme = getColorScheme(view.colorScheme);

    const entries = binLegendEntries;

    const activeDefs = view.plotMode === 'softBin' ? sbinDefs : hbinDefs;
    const binDefMap  = activeDefs ? new Map(activeDefs.map(d => [d.bin, d])) : null;
    const binColor = (bin: number): string => {
      const def = binDefMap?.get(bin);
      return (view.colorScheme === 'custom' ? def?.color : undefined) ?? scheme.forBin(bin);
    };

    type LegendEntry = {
      bin: number;
      count: number;
      label: string;
      tooltipLabel: string;
      labelWidth: number;
      countWidth: number;
      totalWidth: number;
      binDef?: { name?: string; color?: string };
    };

    const legendEntries: LegendEntry[] = entries.map(([bin, count]) => {
      const binDef = binDefMap?.get(bin);
      const fullLabel = binDef?.name ? `${bin} · ${binDef.name}` : `Bin ${bin}`;
      const label = effectiveLegendPosition === 'compact' ? String(bin) : fullLabel;
      const tooltipLabel = `${fullLabel} · ${count} dies`;
      const labelWidth = ctx.measureText(label).width;
      const countStr = String(count);
      const countWidth = effectiveLegendPosition === 'compact' ? 0 : ctx.measureText(countStr).width;
      const totalWidth = BIN_SWATCH_SIZE + BIN_LABEL_GAP + labelWidth + (countWidth ? BIN_COUNT_W : 0);
      return { bin, count, label, tooltipLabel, labelWidth, countWidth, totalWidth, binDef };
    });

    const availableWidth = cssW - padding * 2;

    if (legendEntries.length > 0) {
    const maxRows = Math.max(1, Math.floor((cssH - 2 * padding) / BIN_ROW_H));
    let legendRows = legendEntries.length;
    let legendCols = 1;
    let legendHeight = legendRows * BIN_ROW_H;
    let columnWidths: number[] = [];
    let rowsPerCol = legendRows;
    let overflow = 0;

    const isHorizontal = legendIsBottom || legendIsTop;
    if (isHorizontal) {
      const minColWidth = Math.max(...legendEntries.map(e => e.totalWidth));
      const maxCols = Math.max(1, Math.min(legendEntries.length, Math.floor((availableWidth + 8) / (minColWidth + 8))));
      for (let cols = maxCols; cols >= 1; cols--) {
        const rows = Math.ceil(legendEntries.length / cols);
        if (rows > maxRows) continue;
        const widths = new Array(cols).fill(0);
        for (let i = 0; i < legendEntries.length; i++) {
          const col = i % cols;
          widths[col] = Math.max(widths[col], legendEntries[i].totalWidth);
        }
        const total = widths.reduce((sum, w) => sum + w, 0) + (cols - 1) * 8;
        if (total <= availableWidth || cols === 1) {
          legendCols = cols;
          columnWidths = widths;
          rowsPerCol = rows;
          legendRows = rows;
          legendHeight = rows * BIN_ROW_H;
          break;
        }
      }
    } else {
      legendRows = Math.min(legendEntries.length, maxRows);
      legendHeight = legendRows * BIN_ROW_H;
      if (legendEntries.length > maxRows) {
        overflow = legendEntries.length - (maxRows - 1);
      }
      columnWidths = [legendWidth];
    }

    let originXLegend: number;
    let originYLegend: number;
    if (legendIsFloating) {
      // Measure full labels (not compact) so the floating box fits all content.
      const floatingEntryWidth = Math.max(...legendEntries.map(e => {
        const fullLabel = e.binDef?.name ? `${e.bin} · ${e.binDef.name}` : `Bin ${e.bin}`;
        return BIN_SWATCH_SIZE + BIN_LABEL_GAP + ctx.measureText(fullLabel).width + BIN_COUNT_W;
      }));
      const floatingWidth = Math.ceil(floatingEntryWidth);
      columnWidths = [floatingWidth];
      const boxW = floatingWidth + BIN_FLOATING_PADDING * 2;
      const boxH = legendHeight + BIN_FLOATING_PADDING * 2;
      const offsetX = legendOffset?.x ?? 0;
      const offsetY = legendOffset?.y ?? 0;
      originXLegend = Math.min(Math.max(cssW - padding - boxW + offsetX, padding), cssW - padding - boxW);
      originYLegend = Math.min(Math.max(cssH - padding - boxH + offsetY, padding), cssH - padding - boxH);
      legendBox = { x: originXLegend, y: originYLegend, w: boxW, h: boxH };
      ctx.save();
      ctx.fillStyle = 'rgba(255,255,255,0.92)';
      ctx.strokeStyle = 'rgba(0,0,0,0.1)';
      ctx.lineWidth = 1;
      ctx.fillRect(originXLegend, originYLegend, boxW, boxH);
      ctx.strokeRect(originXLegend, originYLegend, boxW, boxH);
      ctx.restore();
      originXLegend += BIN_FLOATING_PADDING;
      originYLegend += BIN_FLOATING_PADDING;
    } else if (legendIsBottom) {
      originXLegend = padding;
      originYLegend = cssH - padding - legendHeight;
    } else if (legendIsTop) {
      originXLegend = padding;
      originYLegend = padding;
    } else if (legendIsLeft) {
      originXLegend = padding + 4;
      originYLegend = padding + Math.round((cssH - 2 * padding - legendHeight) / 2);
    } else {
      // right (default / compact)
      originXLegend = cssW - padding - legendWidth + 4;
      originYLegend = padding + Math.round((cssH - 2 * padding - legendHeight) / 2);
    }

    ctx.save();
    ctx.font = COLORBAR_LABEL_FONT;
    const columnGap = isHorizontal ? 8 : 0;

    const truncate = (text: string, maxW: number): string => {
      if (ctx.measureText(text).width <= maxW) return text;
      let lo = 0;
      let hi = text.length;
      const ellipsis = '…';
      const ellW = ctx.measureText(ellipsis).width;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (ctx.measureText(text.slice(0, mid)).width + ellW <= maxW) lo = mid;
        else hi = mid - 1;
      }
      return lo === 0 ? ellipsis : text.slice(0, lo) + ellipsis;
    };

    if (isHorizontal) {
      let idx = 0;
      for (let row = 0; row < legendRows; row++) {
        let x = originXLegend;
        for (let col = 0; col < legendCols; col++) {
          const entry = legendEntries[idx++];
          if (!entry) break;
          const isActive = entry.bin === activeBin;
          const swatchX = x;
          const labelX = x + BIN_SWATCH_SIZE + BIN_LABEL_GAP;
          const midY = originYLegend + row * BIN_ROW_H + BIN_ROW_H / 2;
          const swatchY = originYLegend + row * BIN_ROW_H + Math.round((BIN_ROW_H - BIN_SWATCH_SIZE) / 2);
          const labelMaxW = columnWidths[col] - BIN_SWATCH_SIZE - BIN_LABEL_GAP - BIN_COUNT_W;
          ctx.fillStyle = binColor(entry.bin);
          ctx.fillRect(swatchX, swatchY, BIN_SWATCH_SIZE, BIN_SWATCH_SIZE);
          ctx.strokeStyle = isActive ? '#1a66cc' : 'rgba(0,0,0,0.25)';
          ctx.lineWidth = isActive ? 2 : 0.75;
          ctx.strokeRect(swatchX, swatchY, BIN_SWATCH_SIZE, BIN_SWATCH_SIZE);
          ctx.fillStyle = isActive ? '#1a66cc' : '#333';
          ctx.font = isActive ? `bold ${COLORBAR_LABEL_FONT}` : COLORBAR_LABEL_FONT;
          ctx.textAlign = 'left';
          ctx.textBaseline = 'middle';
          ctx.fillText(truncate(entry.label, labelMaxW), labelX, midY);
          ctx.fillStyle = '#999';
          ctx.font = COLORBAR_LABEL_FONT;
          ctx.textAlign = 'right';
          ctx.fillText(String(entry.count), x + columnWidths[col] - 2, midY);
          binLegendRows.push({
            bin: entry.bin,
            x,
            y: originYLegend + row * BIN_ROW_H,
            w: columnWidths[col],
            h: BIN_ROW_H,
            label: entry.tooltipLabel,
          });
          x += columnWidths[col] + columnGap;
        }
      }
    } else {
      const colW = columnWidths[0];
      const showCount = effectiveLegendPosition !== 'compact';
      const maxLabelW = colW - BIN_SWATCH_SIZE - BIN_LABEL_GAP - (showCount ? BIN_COUNT_W : 0);
      const countX = originXLegend + colW - 2;
      let visibleEntries = legendEntries;
      if (overflow > 0) visibleEntries = legendEntries.slice(0, maxRows - 1);
      let rowY = originYLegend;
      for (const entry of visibleEntries) {
        const isActive = entry.bin === activeBin;
        const swatchX = originXLegend;
        const labelX = originXLegend + BIN_SWATCH_SIZE + BIN_LABEL_GAP;
        const midY = rowY + BIN_ROW_H / 2;
        const swatchY = rowY + Math.round((BIN_ROW_H - BIN_SWATCH_SIZE) / 2);
        // Floating always shows full labels and counts, regardless of legendPosition.
        const displayLabel = legendIsFloating
          ? (entry.binDef?.name ? `${entry.bin} · ${entry.binDef.name}` : `Bin ${entry.bin}`)
          : entry.label;
        ctx.fillStyle = binColor(entry.bin);
        ctx.fillRect(swatchX, swatchY, BIN_SWATCH_SIZE, BIN_SWATCH_SIZE);
        ctx.strokeStyle = isActive ? '#1a66cc' : 'rgba(0,0,0,0.25)';
        ctx.lineWidth = isActive ? 2 : 0.75;
        ctx.strokeRect(swatchX, swatchY, BIN_SWATCH_SIZE, BIN_SWATCH_SIZE);
        ctx.fillStyle = isActive ? '#1a66cc' : '#333';
        ctx.font = isActive ? `bold ${COLORBAR_LABEL_FONT}` : COLORBAR_LABEL_FONT;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(truncate(displayLabel, maxLabelW), labelX, midY);
        if (showCount || legendIsFloating) {
          ctx.fillStyle = '#999';
          ctx.font = COLORBAR_LABEL_FONT;
          ctx.textAlign = 'right';
          ctx.fillText(String(entry.count), countX, midY);
        }
        binLegendRows.push({
          bin: entry.bin,
          x: originXLegend,
          y: rowY,
          w: colW,
          h: BIN_ROW_H,
          label: entry.tooltipLabel,
        });
        rowY += BIN_ROW_H;
      }
      if (overflow > 0) {
        ctx.fillStyle = '#aaa';
        ctx.font = COLORBAR_LABEL_FONT;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(`+ ${overflow} more`, originXLegend + BIN_SWATCH_SIZE + BIN_LABEL_GAP, rowY + BIN_ROW_H / 2);
      }
    }
  }

  if (legendEntries.length > 0) ctx.restore();
}

  // ── Build viewport and hit target ──────────────────────────────────────────
  const viewport: ViewportTransform = { originX, originY, ppm, snapDist };

  const hitTarget: HitTarget = {
    getDieAtPoint(px: number, py: number): Die | null {
      const mx = (px - originX) / ppm;
      const my = (originY - py) / ppm;

      // First pass: exact rectangle containment.
      for (let i = 0; i < view.rectangles.length; i++) {
        const r = view.rectangles[i];
        if (Math.abs(mx - r.x) <= r.width / 2 && Math.abs(my - r.y) <= r.height / 2) {
          return view.dies[i] ?? null;
        }
      }

      // Second pass: nearest-centre fallback for clicks in the kerf gap.
      let bestDie: Die | null = null;
      let bestDist = snapDist * snapDist;

      for (let i = 0; i < pts.length; i++) {
        const dx = pts[i].x - mx;
        const dy = pts[i].y - my;
        const d2 = dx * dx + dy * dy;
        if (d2 < bestDist) {
          bestDist = d2;
          bestDie  = view.dies[i] ?? null;
        }
      }
      return bestDie;
    },
  };

  return { hitTarget, viewport, binLegendRows, legendBox };
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

  // When displaying die indices, snap ticks to whole-die boundaries and pick
  // a step size (in mm) that gives ~one tick per 50px for each axis independently.
  // For mm display, use a single nice step targeting 50px.
  function tickStep(pitchMm: number | undefined): number {
    if (!pitchMm) return niceStep(50 / ppm);
    const diesPer50px = 50 / (pitchMm * ppm);
    const dieStep = Math.max(1, Math.round(diesPer50px));
    return dieStep * pitchMm;
  }

  // Which pitch drives each screen axis depends on current rotation.
  const xPitchMm = diePitchMm
    ? (r === 0 || r === 180 ? diePitchMm.x : diePitchMm.y)
    : undefined;
  const yPitchMm = diePitchMm
    ? (r === 0 || r === 180 ? diePitchMm.y : diePitchMm.x)
    : undefined;

  const tickStepX = tickStep(xPitchMm);
  const tickStepY = tickStep(yPitchMm);

  // X axis (bottom)
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'top';
  const xStartMm = Math.ceil(((padding - originX) / ppm) / tickStepX) * tickStepX;
  const xEndMm   = (cssW - padding - originX) / ppm;
  for (let mm = xStartMm; mm <= xEndMm; mm += tickStepX) {
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
  const yStartMm = Math.ceil(((originY - (cssH - padding)) / ppm) / tickStepY) * tickStepY;
  const yEndMm   = (originY - padding) / ppm;
  for (let mm = yStartMm; mm <= yEndMm; mm += tickStepY) {
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

function logTicks(
  vMin: number, vMax: number,
  cbH: number, minPixels: number, endpointGuard: number,
  logMin: number, logRange: number,
): number[] {
  const ticks: number[] = [];
  const decades = logRange;

  if (decades < 1) {
    // Narrow range (< 1 decade): linear niceStep on actual values, log-positioned.
    const step = niceStep((vMax - vMin) * minPixels / cbH);
    if (step > 0) {
      const first = Math.ceil(vMin / step) * step;
      for (let v = first; v <= vMax + step * 1e-6; v += step) {
        if (v <= vMin || v >= vMax) continue;
        const py = (1 - (Math.log10(v) - logMin) / logRange) * cbH;
        if (py > endpointGuard && py < cbH - endpointGuard) ticks.push(v);
      }
    }
    return ticks;
  }

  // 1–3 decades: 1×, 2×, 5× multiples per decade. >3 decades: decade ticks only.
  const mults     = decades < 3 ? [1, 2, 5] : [1];
  const floorDec  = Math.floor(Math.log10(vMin));
  const ceilDec   = Math.ceil(Math.log10(vMax));

  for (let exp = floorDec; exp <= ceilDec; exp++) {
    for (const m of mults) {
      const v  = m * Math.pow(10, exp);
      if (v <= vMin || v >= vMax) continue;
      const py = (1 - (Math.log10(v) - logMin) / logRange) * cbH;
      if (py > endpointGuard && py < cbH - endpointGuard) ticks.push(v);
    }
  }
  return ticks;
}

export { fmt, fmtColorbarAxis } from '../renderer/fmt.js';
