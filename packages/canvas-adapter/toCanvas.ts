import type { View, ViewRect } from '../renderer/buildView.js';
import { findTestDef, buildMapTitle } from '../renderer/buildView.js';
import type { Die } from '../core/dies.js';
import { getColorScheme } from '../renderer/colorSchemes.js';
import { SPEC_PASS_FILL, SPEC_FAIL_LOW, SPEC_FAIL_HIGH, contrastTextColor } from '../renderer/colorMap.js';
import { fmt, fmtColorbarAxis } from '../renderer/fmt.js';
import { resolveCanvasTheme, type CanvasTheme } from './canvasTheme.js';

/**
 * Append an isosceles triangle to the current path, centred on (cx, cy).
 * `dir` = +1 points the apex up (canvas y-up transform), -1 points it down.
 * `tri` is the half-size (apex distance from centre). Used for out-of-spec die
 * glyphs and their colorbar key, so the shape is defined in exactly one place.
 */
function triPath(ctx: CanvasRenderingContext2D, cx: number, cy: number, tri: number, dir: number): void {
  ctx.moveTo(cx, cy + dir * tri);
  ctx.lineTo(cx - tri * 0.9, cy - dir * tri * 0.6);
  ctx.lineTo(cx + tri * 0.9, cy - dir * tri * 0.6);
  ctx.closePath();
}

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
  /** Currently highlighted bin (or metadata value) — drawn with an active indicator in the bin legend. */
  activeBin?: number | string;
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
  /** Named metadata-field definitions — used to label/color the metadata legend. */
  metadataFields?: import('../renderer/buildWaferMap.js').MetadataFieldDef[];
  /**
   * Draw the map title (test name / mode + stack context) above the colorbar or bin legend.
   * Default true. The title is placed in empty space adjacent to the legend/colorbar and does NOT
   * shrink the map. Set false to suppress (e.g. when a host renders its own heading).
   */
  showTitle?: boolean;
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

/** A hit-testable row in the bin legend — one entry per unique bin (or metadata value). */
export interface BinLegendRow {
  bin: number | string;
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
const BIN_LEGEND_MODES = new Set(['hardBin', 'softBin', 'metadata']);
const COLORBAR_LABEL_FONT = '10px system-ui, sans-serif';
const MAP_TITLE_FONT      = '600 12px system-ui, sans-serif';  // primary identifier, above scale
const MAP_SUBTITLE_FONT   = '11px system-ui, sans-serif';      // secondary context, below scale
const SCALE_NOTE_FONT     = '600 11px system-ui, sans-serif';  // log/linear scale note, below scale
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
  // Resolve the canvas chrome palette ONCE per draw from the container's
  // --wmap-* variables (see canvasTheme.ts). ~µs cost; never read per-primitive.
  const theme = resolveCanvasTheme(canvas.parentElement ?? canvas);

  const {
    padding       = 16,
    showColorbar  = true,
    colorbarWidth = 16,
    // Default the background to the resolved theme (was hardcoded '#f5f5f5');
    // an explicit `background` option still wins.
    background    = theme.background,
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
    metadataFields,
    showTitle     = true,
  } = options;

  // Any solid pass/fail display (spec-limit judgement or recorded test verdict)
  // replaces the colorbar with a categorical legend.
  const drawColorbar   = showColorbar && COLORBAR_MODES.has(view.plotMode) && view.passFailDisplay === 'off';
  const drawBinLegend  = showColorbar && BIN_LEGEND_MODES.has(view.plotMode);
  const drawSpecLegend = showColorbar && view.plotMode === 'value' && (
    (view.passFailDisplay === 'spec' && view.specCounts !== undefined) ||
    (view.passFailDisplay === 'test' && view.passFailCounts !== undefined));
  // The bin and pass/fail legends share the same layout/rendering machinery.
  const drawLegend     = drawBinLegend || drawSpecLegend;

  const binLegendEntries: Array<[number, number]> = drawBinLegend && view.plotMode !== 'metadata' && view.binCounts
    ? [...view.binCounts.entries()].sort(([a], [b]) => a - b)
    : [];
  // 'metadata' mode's own entries — string-keyed, sorted alphabetically (same
  // determinism as the color assignment in buildView.ts).
  const metadataLegendEntries: Array<[string, number]> = drawBinLegend && view.plotMode === 'metadata' && view.metadataCounts
    ? [...view.metadataCounts.entries()].sort(([a], [b]) => a.localeCompare(b))
    : [];

  // Unified legend entries: a swatch colour + label + count, sourced from bin counts (bin modes)
  // or spec categories (spec mode). `key` stays a number so the existing activeBin highlight and
  // hit-row plumbing work unchanged; spec entries use negative sentinel keys that never match a bin.
  type LegendSwatch = { key: number; color: string; label: string; compactLabel: string; count: number; tooltip: string };
  const specSwatches: LegendSwatch[] = [];
  if (drawSpecLegend && view.passFailDisplay === 'test') {
    // Recorded test verdict: a single undirected fail category.
    const pc = view.passFailCounts!;
    specSwatches.push({ key: -1, color: SPEC_PASS_FILL, label: 'Pass', compactLabel: 'Pass', count: pc.pass, tooltip: `Pass · ${pc.pass} dies` });
    specSwatches.push({ key: -2, color: SPEC_FAIL_HIGH, label: 'Fail', compactLabel: 'Fail', count: pc.fail, tooltip: `Fail · ${pc.fail} dies` });
  } else if (drawSpecLegend) {
    const sc = view.specCounts!;
    const td = findTestDef(view.testDefs, view.activeTest);
    specSwatches.push({ key: -1, color: SPEC_PASS_FILL, label: 'Pass', compactLabel: 'Pass', count: sc.pass, tooltip: `Pass · ${sc.pass} dies` });
    if (td?.limitHigh !== undefined)
      specSwatches.push({ key: -2, color: SPEC_FAIL_HIGH, label: 'Fail high', compactLabel: 'Fail hi', count: sc.failHigh, tooltip: `Fail high · ${sc.failHigh} dies` });
    if (td?.limitLow !== undefined)
      specSwatches.push({ key: -3, color: SPEC_FAIL_LOW, label: 'Fail low', compactLabel: 'Fail lo', count: sc.failLow, tooltip: `Fail low · ${sc.failLow} dies` });
  }
  // Row count used for layout reserves applies to whichever legend is active.
  const legendEntryCount = drawSpecLegend ? specSwatches.length
    : view.plotMode === 'metadata' ? metadataLegendEntries.length
    : binLegendEntries.length;

  // Derive DPR from the canvas's own window, not the bare global — a canvas
  // rendered inside a gallery card detached into its own popup window must use
  // THAT window's device pixel ratio (it may be on a different display), not
  // whichever window happened to be in lexical scope when this module loaded.
  const dpr     = (canvas.ownerDocument.defaultView ?? window).devicePixelRatio ?? 1;
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
  const legendRowCount = legendEntryCount > maxLegendRows ? maxLegendRows - 1 : legendEntryCount;
  const bottomLegendReserve = drawLegend && legendIsBottom ? legendRowCount * BIN_ROW_H : 0;
  const topLegendReserve    = drawLegend && legendIsTop    ? legendRowCount * BIN_ROW_H : 0;
  const rightReserve    = drawColorbar ? colorbarWidth + 28 : drawLegend && legendIsRight ? legendWidth : 0;
  const leftLegendReserve   = drawLegend && legendIsLeft   ? legendWidth : 0;
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
    // The notch arrow is drawn in screen space at OFFSET+ARROW_L px beyond the
    // wafer edge. Reserve that footprint on the notch side before fitting so it
    // is never clipped by the container.
    const ARROW_FOOTPRINT = 4 + 9; // OFFSET + ARROW_L (must match draw constants below)
    const nd = view.notchDir;
    const arrowTop    = nd && nd.y >  0.1 ? ARROW_FOOTPRINT : 0;
    const arrowBottom = nd && nd.y < -0.1 ? ARROW_FOOTPRINT : 0;
    const arrowLeft   = nd && nd.x < -0.1 ? ARROW_FOOTPRINT : 0;
    const arrowRight  = nd && nd.x >  0.1 ? ARROW_FOOTPRINT : 0;

    const fitW = drawW - arrowLeft - arrowRight;
    const fitH = drawH - topClearance - arrowTop - arrowBottom;
    ppm     = Math.min(fitW / dataW, fitH / dataH);
    originX = padding + axisLeftReserve + leftLegendReserve + arrowLeft + (fitW - dataW * ppm) / 2 - minX * ppm;
    originY = padding + topClearance + topLegendReserve + arrowTop + (fitH - dataH * ppm) / 2 + maxY * ppm;
  }

  const snapDist = viewportOverride?.snapDist ?? Math.max(halfW, halfH, 1) * 1.5;

  // Wafer circle in screen space — used to keep the map title clear of the map.
  const waferCx   = originX + view.waferCenter.x * ppm;
  const waferCy   = originY - view.waferCenter.y * ppm;
  const waferRpx  = view.waferRadius * ppm;

  // Half-width of the wafer circle at a given screen y (0 outside the circle's vertical span).
  // Used to find the free horizontal gap beside the wafer at the title's baseline.
  const waferHalfChordAt = (y: number): number => {
    const dy = Math.abs(y - waferCy);
    return dy >= waferRpx ? 0 : Math.sqrt(waferRpx * waferRpx - dy * dy);
  };

  // Draw the map title, truncated with an ellipsis so it never overlaps the wafer circle.
  // `align` controls which edge `anchorX` pins to; `limitX` is the boundary the text must not
  // cross toward the wafer (left boundary for right-aligned, right boundary for left-aligned).
  const drawTitleFitted = (
    title: string, anchorX: number, y: number,
    align: 'left' | 'right', baseline: 'top' | 'bottom', limitX: number,
    font: string = MAP_TITLE_FONT, color: string = '#333',
  ): void => {
    if (!title) return;
    ctx.save();
    ctx.fillStyle = color;
    ctx.font = font;
    ctx.textAlign = align;
    ctx.textBaseline = baseline;
    const maxW = align === 'right' ? anchorX - limitX : limitX - anchorX;
    let text = title;
    if (maxW > 8 && ctx.measureText(text).width > maxW) {
      while (text.length > 1 && ctx.measureText(text + '…').width > maxW) text = text.slice(0, -1);
      text = text + '…';
    }
    if (maxW > 8) ctx.fillText(text, anchorX, y);
    ctx.restore();
  };

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

    // Out-of-spec markers (value mode, 'data' colorbar range): the die keeps its
    // gradient fill, so flag out-of-spec dies with a triangle glyph — down = below
    // low limit (fail-low), up = above high limit (fail-high). Shape (not colour)
    // carries the meaning, so it survives greyscale and colour-vision deficiency.
    // The glyph colour is chosen per die for maximum contrast against that die's
    // own gradient fill (black or white), with an opposite-colour halo so it reads
    // on any scheme. Sizes are in data units divided by (ppm * dpr) so they hold a
    // constant on-screen size at any zoom.
    const marked = view.rectangles.filter(r => r.specMark);
    if (marked.length > 0) {
      // Bucket by (shape, glyph colour). contrastTextColor yields only black or
      // white, so there are at most 4 buckets → ≤8 draw calls regardless of die
      // count, matching the previous marker's efficiency class. ViewRect is never
      // mutated — the glyph colour lives only in these transient buckets.
      const buckets = new Map<string, ViewRect[]>();
      for (const r of marked) {
        const g = contrastTextColor(String(r.fill));
        const key = `${r.specMark}|${g}`;
        let group = buckets.get(key);
        if (!group) { group = []; buckets.set(key, group); }
        group.push(r);
      }
      const haloW = 2.5 / (ppm * dpr);
      ctx.lineJoin = 'round';
      for (const [key, group] of buckets) {
        const [mark, glyph] = key.split('|');
        const halo = glyph === '#000000' ? '#ffffff' : '#000000';
        const dir = mark === 'failHigh' ? 1 : -1; // up for fail-high, down for fail-low
        // Triangle half-size: proportional to die, floored so it stays visible zoomed out.
        const minDie = Math.min(group[0].width, group[0].height);
        const tri = Math.max(2.5 / (ppm * dpr), minDie * 0.30);
        // Halo pass (opposite colour), then fill pass — both over one batched path.
        ctx.beginPath();
        for (const r of group) triPath(ctx, r.x, r.y, tri, dir);
        ctx.strokeStyle = halo;
        ctx.lineWidth   = haloW;
        ctx.stroke();
        ctx.fillStyle = glyph;
        ctx.fill();
      }
    }
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
    // Ring, quadrant, and reticle overlays use dual-stroke (dark halo + light
    // core) so they read on any die colour or gap — a single flat colour
    // (even white) disappears against a same-toned fill or the canvas
    // background. This ignores overlay.lineColor/lineWidth entirely for these
    // three kinds; those fields only apply to the plain single-stroke overlays
    // in the else branch (wafer boundary, probe path).
    if (overlay.kind === 'ring-boundary' || overlay.kind === 'quadrant-boundary' || overlay.kind === 'reticle') {
      ctx.strokeStyle = 'rgba(0,0,0,0.45)';
      ctx.lineWidth   = 3 / (ppm * dpr);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,0.8)';
      ctx.lineWidth   = 1 / (ppm * dpr);
      ctx.stroke();
    } else {
      ctx.strokeStyle = overlay.lineColor;
      ctx.lineWidth   = overlay.lineWidth / (ppm * dpr);
      ctx.stroke();
    }
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
    ctx.fillStyle = theme.text;
    ctx.fill();
    ctx.restore();
  }

  // ── Draw text labels (screen coords to avoid Y-flip distortion) ────────────
  ctx.save();
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'middle';

  // Die labels share one uniform size per render, sized to fit the *longest*
  // label currently present (not each die's own text length) and recomputed
  // here — at draw time, with the live ppm — because buildView doesn't know the
  // interactive zoom level (pan/zoom re-renders via toCanvas without rebuilding
  // the view). All dies share one pitch/gap/rotation, so view.rectangles[0]'s
  // width/height stands in for "the" die box size.
  let dieLabelFontSize = 0;
  if (view.rectangles.length > 0) {
    let maxLen = 1;
    for (const t of view.texts) {
      if (t.role === 'indicator') continue;
      if (t.text.length > maxLen) maxLen = t.text.length;
    }
    const boxW = view.rectangles[0].width  * ppm;
    const boxH = view.rectangles[0].height * ppm;
    const minSidePx     = Math.min(boxW, boxH);
    const widthBudgetPx = boxW / maxLen;
    dieLabelFontSize = Math.max(8, Math.min(64, Math.round(Math.min(minSidePx * 0.55, widthBudgetPx * 1.8))));
  }

  for (const text of view.texts) {
    const sx = originX + text.x * ppm;
    const sy = originY - text.y * ppm;
    ctx.font      = `${text.role === 'indicator' ? text.fontSize : dieLabelFontSize}px system-ui, sans-serif`;
    ctx.fillStyle = text.color;
    ctx.fillText(text.text, sx, sy);
  }
  ctx.restore();

  // ── Draw axis ticks ────────────────────────────────────────────────────────
  if (showAxes) {
    drawAxisTicks(ctx, cssW, cssH, originX, originY, ppm, padding, axisReserve, axisLeftReserve, diePitchMm, view.axisFlip, view.rotation, theme);
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

    // Primary title just ABOVE the bar, right-aligned and truncated so it never overlaps the wafer.
    // Clamped to sit at or below the toolbar clearance line so the floating toolbar never covers it.
    // Supporting context (secondary) and the scale note go BELOW the bar, stacked via `belowCursor`
    // in the roomy lower-right area beneath the colorbar.
    const cbBinDefs = view.plotMode === 'stackedSoftBins' ? sbinDefs : hbinDefs;
    const { primary: titlePrimary, secondary: titleSecondary } = showTitle
      ? buildMapTitle(view, fallbackFormat, cbBinDefs)
      : { primary: '', secondary: '' };
    if (showTitle) {
      const aboveY = Math.max(cbY - 6, padding + topClearance + 11);
      const aboveLimit = waferCx + Math.max(waferHalfChordAt(aboveY), waferHalfChordAt(aboveY - 12)) + 8;
      drawTitleFitted(titlePrimary, cssW - padding, aboveY, 'right', 'bottom', aboveLimit);
    }
    let belowCursor = cbY + cbH + 4;
    const belowLimitAt = (y: number) =>
      waferCx + Math.max(waferHalfChordAt(y), waferHalfChordAt(y + 12)) + 8;

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
    ctx.fillStyle   = theme.text;
    ctx.font        = COLORBAR_LABEL_FONT;
    ctx.textAlign   = 'left';
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.lineWidth   = 0.5;

    const tickLen       = 3;
    const minPixels     = 36;  // minimum px between tick centres
    const endpointGuard = 14;

    const ticks: number[] = view.logScale && logRange > 0
      ? logTicks(vMin, vMax, cbH, minPixels, endpointGuard, logMin, logRange)
      : view.allIntegerValues
      ? (() => {
          // Integer-valued data: snap ticks to whole numbers with sensible spacing.
          const intStep = Math.max(1, niceStep(vRange * minPixels / cbH));
          const ts: number[] = [];
          const first = Math.ceil(vMin / intStep) * intStep;
          for (let v = first; v <= vMax + intStep * 1e-6; v += intStep) {
            const py = (1 - (v - vMin) / vRange) * cbH;
            if (py > endpointGuard && py < cbH - endpointGuard) ts.push(Math.round(v));
          }
          return ts;
        })()
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
    const { tickFmt: baseFmt } = fmtColorbarAxis(
      vMax, cbName, cbUnit, fallbackFormat,
    );
    const tickFmt = view.allIntegerValues ? (v: number) => String(Math.round(v)) : baseFmt;

    // Draw intermediate ticks.
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

    // Spec limit markers — left-side labels + dual-stroke line (white halo + dark rule).
    // In spec mode: limits sit at the bar endpoints, so draw left-side labels there.
    // In data mode: limits may fall anywhere within the bar, draw inline markers.
    if (!isCountMode && testDef && (testDef.limitLow !== undefined || testDef.limitHigh !== undefined)) {
      type LimitMarker = { value: number; label: string; py: number };
      const limitMarkers: LimitMarker[] = [];
      const isSpecMode = view.colorbarRangeMode === 'spec';

      for (const [value, label] of [
        [testDef.limitLow,  'LSL'] as const,
        [testDef.limitHigh, 'USL'] as const,
      ]) {
        if (value === undefined) continue;
        if (view.logScale && value <= 0) continue;
        const py = tickPy(value);
        // In spec mode the limit is at an endpoint (py ≈ 0 or cbH) — always include it.
        // In data mode skip limits that fall outside the bar.
        if (!isSpecMode && (py < -endpointGuard || py > cbH + endpointGuard)) continue;
        limitMarkers.push({ value, label, py: Math.max(0, Math.min(cbH, py)) });
      }

      if (limitMarkers.length > 0) {
        ctx.save();
        ctx.font         = COLORBAR_LABEL_FONT;
        ctx.textAlign    = 'right';
        ctx.textBaseline = 'middle';

        for (const { py, label } of limitMarkers) {
          const sy = cbY + py;
          // In data mode: dual-stroke line across the bar so it reads on any gradient colour.
          if (!isSpecMode) {
            ctx.strokeStyle = 'rgba(255,255,255,0.85)';
            ctx.lineWidth   = 3;
            ctx.beginPath();
            ctx.moveTo(cbX, sy);
            ctx.lineTo(cbX + colorbarWidth, sy);
            ctx.stroke();
            ctx.strokeStyle = 'rgba(0,0,0,0.7)';
            ctx.lineWidth   = 1;
            ctx.beginPath();
            ctx.moveTo(cbX, sy);
            ctx.lineTo(cbX + colorbarWidth, sy);
            ctx.stroke();
          }
          // Left-side label in both modes.
          ctx.fillStyle = theme.text;
          ctx.fillText(label, cbX - 3, sy);

          // Key: a tiny triangle to the left of the label tying the out-of-spec die
          // marker shape to its limit (▽ below LSL, △ above USL). Shown in both
          // colorbar ranges, since the ▽/△ die markers now appear in both.
          // Screen space here: y increases downward, so apex-up needs dir=-1.
          const dir = label === 'USL' ? -1 : 1; // up for USL (fail-high), down for LSL
          const keyTri = 4;
          const kx = cbX - 3 - ctx.measureText(label).width - keyTri - 4;
          ctx.beginPath();
          triPath(ctx, kx, sy, keyTri, dir);
          ctx.strokeStyle = '#fff';
          ctx.lineWidth   = 2;
          ctx.lineJoin    = 'round';
          ctx.stroke();
          ctx.fillStyle = theme.text;
          ctx.fill();
        }

        ctx.restore();
      }
    }

    // Scale annotation directly below the bar — truthful per map:
    //  - log applied            → "log₁₀"
    //  - log requested but the data range included ≤ 0 → "linear — log n/a"
    // Drawn only for continuous value modes (count-stacked bins have no log option).
    if (!isCountMode) {
      const scaleNote = view.logScale
        ? 'log₁₀'
        : view.logScaleRequested
        ? 'linear — log n/a'
        : null;
      if (scaleNote) {
        ctx.save();
        ctx.fillStyle    = theme.text;
        ctx.font         = SCALE_NOTE_FONT;
        ctx.textAlign    = 'right';
        ctx.textBaseline = 'top';
        ctx.fillText(scaleNote, cssW - padding, belowCursor);
        ctx.restore();
        belowCursor += 15;
      }
    }

    // Supporting context (e.g. "stacked (6 wafers)") beneath the scale note, in the roomy
    // lower-right area below the colorbar.
    if (showTitle && titleSecondary) {
      drawTitleFitted(titleSecondary, cssW - padding, belowCursor, 'right', 'top',
        belowLimitAt(belowCursor), MAP_SUBTITLE_FONT, theme.text);
    }
  }

  // ── Draw bin legend ────────────────────────────────────────────────────────
  const binLegendRows: BinLegendRow[] = [];
  let legendBox: { x: number; y: number; w: number; h: number } | undefined;

  if (drawLegend) {
    const scheme = getColorScheme(view.colorScheme);
    const isCompact = effectiveLegendPosition === 'compact';

    const activeDefs = view.plotMode === 'softBin' ? sbinDefs : hbinDefs;
    const binDefMap  = activeDefs ? new Map(activeDefs.map(d => [d.bin, d])) : null;
    const binColor = (bin: number): string => {
      const def = binDefMap?.get(bin);
      return (view.colorScheme === 'custom' ? def?.color : undefined) ?? scheme.forBin(bin);
    };

    type LegendEntry = {
      key: number | string;  // bin number, negative sentinel for spec categories, or a metadata value string
      color: string;
      count: number;
      label: string;
      tooltipLabel: string;
      labelWidth: number;
      countWidth: number;
      totalWidth: number;
    };

    const measure = (label: string, count: number): { labelWidth: number; countWidth: number; totalWidth: number } => {
      const labelWidth = ctx.measureText(label).width;
      const countWidth = isCompact ? 0 : ctx.measureText(String(count)).width;
      const totalWidth = BIN_SWATCH_SIZE + BIN_LABEL_GAP + labelWidth + (countWidth ? BIN_COUNT_W : 0);
      return { labelWidth, countWidth, totalWidth };
    };

    const activeMetadataFieldDef = metadataFields?.find(f => f.key === view.activeMetadataKey);

    const legendEntries: LegendEntry[] = drawSpecLegend
      ? specSwatches.map(s => {
          const label = isCompact ? s.compactLabel : s.label;
          return { key: s.key, color: s.color, count: s.count, label, tooltipLabel: s.tooltip, ...measure(label, s.count) };
        })
      : view.plotMode === 'metadata'
      ? metadataLegendEntries.map(([value, count]) => {
          const valueDef = activeMetadataFieldDef?.values?.find(v => v.value === value);
          const fullLabel = valueDef?.label ?? value;
          const label = isCompact ? value : fullLabel;
          // Read the resolved colour straight off the view — built by buildView from the same
          // filtered die population as metadataLegendEntries, so this can never diverge from
          // the colour dies are actually filled with. See View.metadataColorMap.
          const color = view.metadataColorMap?.get(value) ?? '#d6d9dd';
          return { key: value, color, count, label, tooltipLabel: `${fullLabel} · ${count} dies`, ...measure(label, count) };
        })
      : binLegendEntries.map(([bin, count]) => {
          const binDef = binDefMap?.get(bin);
          const fullLabel = binDef?.name ? `${bin} · ${binDef.name}` : `Bin ${bin}`;
          const label = isCompact ? String(bin) : fullLabel;
          return { key: bin, color: binColor(bin), count, label, tooltipLabel: `${fullLabel} · ${count} dies`, ...measure(label, count) };
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
      // Measure full labels (floating is never compact) so the box fits all content.
      const floatingEntryWidth = Math.max(...legendEntries.map(e =>
        BIN_SWATCH_SIZE + BIN_LABEL_GAP + ctx.measureText(e.label).width + BIN_COUNT_W));
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
      // Start below the toolbar clearance so the floating toolbar never covers the top legend.
      originYLegend = padding + topClearance;
    } else if (legendIsLeft) {
      originXLegend = padding + 4;
      originYLegend = padding + Math.round((cssH - 2 * padding - legendHeight) / 2);
    } else {
      // right (default / compact)
      originXLegend = cssW - padding - legendWidth + 4;
      originYLegend = padding + Math.round((cssH - 2 * padding - legendHeight) / 2);
    }

    // Legend title. Primary identifier sits directly ABOVE the legend block (aligned to its leading
    // edge) so it reads as the legend's heading and is never near the toolbar. Bin modes have no
    // secondary; the spec legend adds a "Spec pass/fail" secondary line BELOW the legend.
    // (Stacked-bin modes use the colorbar branch above, not this legend.)
    if (showTitle) {
      const activeBinDefs = view.plotMode === 'softBin' ? sbinDefs : hbinDefs;
      const { primary, secondary } = buildMapTitle(view, fallbackFormat, activeBinDefs);
      const GAP = 6;
      // Wafer-clearance limit for a left-aligned title at screen y (right boundary it must not cross).
      const leftAlignLimit = (y: number) =>
        waferCx - Math.max(waferHalfChordAt(y), waferHalfChordAt(y - 12)) - 8;
      const sideLimit = (y: number) => legendIsRight ? cssW - padding : leftAlignLimit(y);
      const legendBottom = legendIsFloating ? legendBox!.y + legendBox!.h : originYLegend + legendHeight;
      if (legendIsTop) {
        // Legend hugs the top → primary just below it, secondary below that.
        const y = legendBottom + GAP;
        drawTitleFitted(primary, originXLegend, y, 'left', 'top',
          waferCx - Math.max(waferHalfChordAt(y), waferHalfChordAt(y + 12)) - 8);
        if (secondary) drawTitleFitted(secondary, originXLegend, y + 16, 'left', 'top',
          leftAlignLimit(y + 16), MAP_SUBTITLE_FONT, theme.text);
      } else if (legendIsFloating) {
        // Floating box → primary above the box, secondary below it.
        drawTitleFitted(primary, legendBox!.x, legendBox!.y - GAP, 'left', 'bottom', legendBox!.x + legendBox!.w);
        if (secondary) drawTitleFitted(secondary, legendBox!.x, legendBottom + GAP, 'left', 'top',
          legendBox!.x + legendBox!.w, MAP_SUBTITLE_FONT, theme.text);
      } else {
        // right / default / compact / left / bottom → primary just above the legend's first row,
        // left-aligned to the swatch column, clamped below the toolbar clearance. Secondary below.
        const yAbove = Math.max(originYLegend - GAP, padding + topClearance + 12);
        drawTitleFitted(primary, originXLegend, yAbove, 'left', 'bottom', sideLimit(yAbove));
        if (secondary) {
          const yBelow = legendBottom + GAP;
          drawTitleFitted(secondary, originXLegend, yBelow, 'left', 'top', sideLimit(yBelow), MAP_SUBTITLE_FONT, theme.text);
        }
      }
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
          const isActive = entry.key === activeBin;
          const swatchX = x;
          const labelX = x + BIN_SWATCH_SIZE + BIN_LABEL_GAP;
          const midY = originYLegend + row * BIN_ROW_H + BIN_ROW_H / 2;
          const swatchY = originYLegend + row * BIN_ROW_H + Math.round((BIN_ROW_H - BIN_SWATCH_SIZE) / 2);
          const labelMaxW = columnWidths[col] - BIN_SWATCH_SIZE - BIN_LABEL_GAP - BIN_COUNT_W;
          ctx.fillStyle = entry.color;
          ctx.fillRect(swatchX, swatchY, BIN_SWATCH_SIZE, BIN_SWATCH_SIZE);
          ctx.strokeStyle = isActive ? theme.accent : 'rgba(0,0,0,0.25)';
          ctx.lineWidth = isActive ? 2 : 0.75;
          ctx.strokeRect(swatchX, swatchY, BIN_SWATCH_SIZE, BIN_SWATCH_SIZE);
          ctx.fillStyle = isActive ? theme.accent : theme.text;
          ctx.font = isActive ? `bold ${COLORBAR_LABEL_FONT}` : COLORBAR_LABEL_FONT;
          ctx.textAlign = 'left';
          ctx.textBaseline = 'middle';
          ctx.fillText(truncate(entry.label, labelMaxW), labelX, midY);
          ctx.fillStyle = theme.textMuted;
          ctx.font = COLORBAR_LABEL_FONT;
          ctx.textAlign = 'right';
          ctx.fillText(String(entry.count), x + columnWidths[col] - 2, midY);
          binLegendRows.push({
            bin: entry.key,
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
        const isActive = entry.key === activeBin;
        const swatchX = originXLegend;
        const labelX = originXLegend + BIN_SWATCH_SIZE + BIN_LABEL_GAP;
        const midY = rowY + BIN_ROW_H / 2;
        const swatchY = rowY + Math.round((BIN_ROW_H - BIN_SWATCH_SIZE) / 2);
        // Floating always shows full labels (entry.label is already full when not compact).
        const displayLabel = entry.label;
        ctx.fillStyle = entry.color;
        ctx.fillRect(swatchX, swatchY, BIN_SWATCH_SIZE, BIN_SWATCH_SIZE);
        ctx.strokeStyle = isActive ? theme.accent : 'rgba(0,0,0,0.25)';
        ctx.lineWidth = isActive ? 2 : 0.75;
        ctx.strokeRect(swatchX, swatchY, BIN_SWATCH_SIZE, BIN_SWATCH_SIZE);
        ctx.fillStyle = isActive ? theme.accent : theme.text;
        ctx.font = isActive ? `bold ${COLORBAR_LABEL_FONT}` : COLORBAR_LABEL_FONT;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(truncate(displayLabel, maxLabelW), labelX, midY);
        if (showCount || legendIsFloating) {
          ctx.fillStyle = theme.textMuted;
          ctx.font = COLORBAR_LABEL_FONT;
          ctx.textAlign = 'right';
          ctx.fillText(String(entry.count), countX, midY);
        }
        binLegendRows.push({
          bin: entry.key,
          x: originXLegend,
          y: rowY,
          w: colW,
          h: BIN_ROW_H,
          label: entry.tooltipLabel,
        });
        rowY += BIN_ROW_H;
      }
      if (overflow > 0) {
        ctx.fillStyle = theme.textMuted;
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

  // Uniform-grid spatial index over hoverPoints for O(1) hit-testing.
  // Each cell holds the indices of dies whose centre falls in that cell.
  // Cell size = typical die pitch so most queries touch only 1–4 cells.
  const rectW = view.rectangles[0]?.width  ?? 1;
  const rectH = view.rectangles[0]?.height ?? 1;
  const cellW = rectW * 1.5;
  const cellH = rectH * 1.5;
  const dieBounds = view.dieBounds;
  const idxMinX = dieBounds ? dieBounds.minX : (pts.length ? Math.min(...pts.map(p => p.x)) : 0);
  const idxMinY = dieBounds ? dieBounds.minY : (pts.length ? Math.min(...pts.map(p => p.y)) : 0);
  const idxMaxX = dieBounds ? dieBounds.maxX : (pts.length ? Math.max(...pts.map(p => p.x)) : 1);
  const idxMaxY = dieBounds ? dieBounds.maxY : (pts.length ? Math.max(...pts.map(p => p.y)) : 1);
  const nCols = Math.max(1, Math.ceil((idxMaxX - idxMinX) / cellW) + 1);
  const nRows = Math.max(1, Math.ceil((idxMaxY - idxMinY) / cellH) + 1);
  const gridCells: number[][] = Array.from({ length: nCols * nRows }, () => []);
  for (let i = 0; i < pts.length; i++) {
    const col = Math.floor((pts[i].x - idxMinX) / cellW);
    const row = Math.floor((pts[i].y - idxMinY) / cellH);
    const ci = Math.max(0, Math.min(nCols - 1, col));
    const ri = Math.max(0, Math.min(nRows - 1, row));
    gridCells[ri * nCols + ci].push(i);
  }
  function cellsForRadius(mx: number, my: number, r: number): number[] {
    const c0 = Math.max(0, Math.floor((mx - r - idxMinX) / cellW));
    const c1 = Math.min(nCols - 1, Math.floor((mx + r - idxMinX) / cellW));
    const r0 = Math.max(0, Math.floor((my - r - idxMinY) / cellH));
    const r1 = Math.min(nRows - 1, Math.floor((my + r - idxMinY) / cellH));
    const out: number[] = [];
    for (let rr = r0; rr <= r1; rr++)
      for (let cc = c0; cc <= c1; cc++)
        for (const idx of gridCells[rr * nCols + cc]) out.push(idx);
    return out;
  }

  const hitTarget: HitTarget = {
    getDieAtPoint(px: number, py: number): Die | null {
      const mx = (px - originX) / ppm;
      const my = (originY - py) / ppm;

      // Exact rectangle containment using the spatial index.
      const exactRadius = Math.max(rectW, rectH);
      for (const i of cellsForRadius(mx, my, exactRadius)) {
        const r = view.rectangles[i];
        if (r && Math.abs(mx - r.x) <= r.width / 2 && Math.abs(my - r.y) <= r.height / 2) {
          return view.dies[i] ?? null;
        }
      }

      // Nearest-centre fallback for clicks in the kerf gap.
      let bestDie: Die | null = null;
      let bestDist = snapDist * snapDist;
      for (const i of cellsForRadius(mx, my, snapDist)) {
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
  diePitchMm: { x: number; y: number } | undefined,
  axisFlip: { x: boolean; y: boolean } | undefined,
  rotation: number,
  theme: CanvasTheme,
): void {
  ctx.save();
  ctx.font        = AXIS_TICK_FONT;
  ctx.fillStyle   = theme.text;
  ctx.strokeStyle = theme.axisLine;
  ctx.lineWidth   = 0.5;

  const axisY = cssH - axisReserve + 4;
  const axisX = padding + axisLeftReserve - 4;

  // Convert a display-space mm position to the die grid index for axis labels.
  //
  // CW rotation R maps die coords to display coords as:
  //   display_x =  cos(R)*die_x + sin(R)*die_y
  //   display_y = -sin(R)*die_x + cos(R)*die_y
  // Inverting for the 4 cardinal cases (before any flip):
  //   R=0:   die_x =  display_x/px,  die_y =  display_y/py
  //   R=90:  die_x =  display_y/px,  die_y =  display_x/py
  //   R=180: die_x = -display_x/px,  die_y = -display_y/py
  //   R=270: die_x = -display_y/px,  die_y = -display_x/py
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
    if (r === 90)  return Math.round( ux / diePitchMm.y);
    if (r === 180) return Math.round(-ux / diePitchMm.x);
    /* 270 */      return Math.round(-ux / diePitchMm.y);
  }

  function dieIndexForDisplayY(mm: number): number {
    if (!diePitchMm) return mm;
    const uy = fy * mm; // unflipped display-Y
    if (r === 0)   return Math.round( uy / diePitchMm.y);
    if (r === 90)  return Math.round(-uy / diePitchMm.x);
    if (r === 180) return Math.round(-uy / diePitchMm.y);
    /* 270 */      return Math.round( uy / diePitchMm.x);
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
