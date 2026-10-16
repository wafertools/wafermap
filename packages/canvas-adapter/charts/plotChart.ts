// The plot builder's chart: draws a `ResolvedPlot` (stats/plotData.ts) as a card.
//
// One card, redrawn in place as the plot changes, so the editor can show every edit as it is made. It knows
// nothing about tests or test numbers: the resolver has already turned the saved recipe into points, bins and
// axes, so this is only drawing (scatter and histogram; the other marks arrive with phase 3). What it shares
// with the Insights scatter it takes from the same helpers: the card, the tick fitting, the SI axis formatting,
// the legend chip, and the pointer (`pointInteractions.ts`: tooltip, click-to-open, drag-to-select).
//
// Every plot states its population under the title (`plotFootnote`), and says why it is empty rather than
// drawing nothing.

import { escHtml, maxOf, minOf } from '../../core/utils.js';
import { fiveNumberSummary, normalQuantile, sampleVariance } from '../../stats/math.js';
import { CONTROL_RULE_TEXT } from '../../stats/control.js';
import { fmt } from '../../renderer/fmt.js';
import { fitTicks } from '../../renderer/axisTicks.js';
import { plotFootnote, plotTestNumber, plotTitle, probabilityPosition, type PlotPoint, type ResolvedAxis, type ResolvedPlot } from '../../stats/plotData.js';
import { SPACE, RADIUS, fontPx, FONT, CLR, markNoPrint } from '../toolbar.js';
import {
  cardShell, observeResize, makeTooltip, attachChartTip, chartFillHeight, applyCanvasFlow, prepareCanvas, positionChartTooltip,
  resolveChartCanvasColors, makeAxisFormat, horizontalTickSpacing, VERTICAL_TICK_SPACING_PX, makeSeriesLegendItem,
  renderEmptyState, fillTextOnHalo, limitLines, limitExtent, stackLabelRows, placeClearOf, type LabelBox, strokeLimitLine, drawOffAxisLimits, limitLabelSide, shouldIncludeLimitsByDefault,
  type LimitLine, type SaveImageHandler, type SeriesLegendItem,
} from './chartShell.js';
import { categorical } from './palette.js';
import { resolveValueColorFn } from '../../renderer/colorSchemes.js';
import { wirePointInteractions, type DrawnPoint } from './pointInteractions.js';

const LEFT = 64;
const RIGHT = 16;
const TOP = 12;
const BOTTOM = 52;
const HISTOGRAM_BINS = 16;
const SAMPLE_LIMIT = 5000;
/** A probability curve draws at most this many points of a group, every point of its two tails among them. */
const PROBABILITY_POINTS = 1500;
const PROBABILITY_TAIL = 100;
/** The shares a normal-probability axis is labelled at, as far into the tails as the data reaches. */
const PROBABILITY_TICKS = [0.0001, 0.001, 0.01, 0.05, 0.1, 0.25, 0.5, 0.75, 0.9, 0.95, 0.99, 0.999, 0.9999];
/** "0.01%", "5%", "99.9%": a share as its percentage, with no trailing zeros. */
const percentLabel = (p: number): string => `${+(p * 100).toPrecision(4)}%`;

/**
 * @internal Where each colour group's mark sits within its category, as fractions of the category's slot. Only the
 * groups with a value in that category take a place, centred, so a category that one group fills (a ring coloured by
 * ring, a wafer coloured by its split) gets one full-width mark rather than a sliver in a row of empty places. Every
 * mark has the same width, the width the fullest category needs, so marks compare across categories.
 * `present[c]` lists the groups with a value in category c, in legend order.
 */
export function categoryLayout(present: ReadonlyArray<readonly number[]>): {
  width: number;
  /** The left edge of group g's mark in category c, or undefined when g has none there. */
  left: (c: number, g: number) => number | undefined;
  /** The group whose mark covers fraction f of category c's slot, or undefined. */
  groupAt: (c: number, f: number) => number | undefined;
} {
  const BAND = 0.8;
  const width = BAND / Math.max(1, ...present.map(p => p.length));
  const start = (c: number) => (1 - present[c].length * width) / 2;
  return {
    width,
    left: (c, g) => { const i = present[c].indexOf(g); return i < 0 ? undefined : start(c) + i * width; },
    groupAt: (c, f) => { const i = Math.floor((f - start(c)) / width); return i >= 0 && i < present[c].length ? present[c][i] : undefined; },
  };
}

/**
 * The indices of a sorted group a probability curve draws: all of them up to `PROBABILITY_POINTS`, else every one of
 * the first and last `PROBABILITY_TAIL` (the tails are what the plot is read for) and evenly spaced ones between.
 */
function probabilitySample(n: number): number[] {
  if (n <= PROBABILITY_POINTS) return Array.from({ length: n }, (_, i) => i);
  const out: number[] = [];
  for (let i = 0; i < PROBABILITY_TAIL; i++) out.push(i);
  const mid = PROBABILITY_POINTS - 2 * PROBABILITY_TAIL, span = n - 2 * PROBABILITY_TAIL;
  for (let j = 0; j < mid; j++) out.push(PROBABILITY_TAIL + Math.floor((j * span) / mid));
  for (let i = n - PROBABILITY_TAIL; i < n; i++) out.push(i);
  return out;
}

export interface PlotChartOptions {
  ownerDocument?: Document;
  onSaveImage?: SaveImageHandler;
  /** The label of the wafer an item index names, for tooltips. */
  waferLabel: (item: number) => string;
  /** Click a point: open its wafer, on `testNumber` (the plot's own measurement) when it has one. Omit where there is no wafer to open. */
  onOpenWafer?: (item: number, testNumber?: number) => void;
  /** What a click on a point does, in the reader's words. Default `open this wafer`. */
  openActionLabel?: string;
  /** Drag a rectangle over a scatter: the dies inside it, the pointer position and the canvas to anchor a menu on. */
  onSelectPoints?: (points: PlotPoint[], at: { x: number; y: number }, anchor: HTMLElement) => void;
  /**
   * @internal One panel of a faceted plot: headed by its value, smaller, and without the statement and legend, which
   * the grid above it carries for every panel. Its Save as PNG is the grid's.
   */
  panel?: { title: string };
}

export interface PlotChartHandle {
  card: HTMLElement;
  /** The row under the title, for the host's own buttons (Edit, Duplicate, Delete). */
  actions: HTMLElement;
  /** Draw `resolved`, replacing whatever was shown. */
  setPlot(resolved: ResolvedPlot): void;
  /** @internal Show only these colour groups (all when empty): a faceted plot's legend filters every panel. */
  setActiveGroups(groups: ReadonlySet<number>): void;
  destroy(): void;
}

/**
 * A value as a heatmap cell or its colour bar shows it: a count as a whole number, a value with no unit (a z-score, a
 * share) to two decimals, anything else in its unit's own scaling.
 */
function cellText(v: number, unit: string | undefined, integer: boolean | undefined): string {
  if (integer) return Math.round(v).toLocaleString('en-GB');
  // A value that rounds to zero is zero, whichever side it came from.
  if (!unit) return `${v <= -0.005 ? '−' : ''}${Math.abs(v).toFixed(2)}`;
  return fmt(v, unit);
}

/** The narrowest a panel of a faceted plot is laid out: the grid fits as many across as this allows. */
const PANEL_MIN_PX = 260;

/**
 * One image of a grid of panels, as laid out on screen: each panel's canvas at its place, its title above it. What a
 * faceted plot's Save as PNG saves, so the file shows every panel, not the first.
 */
function composePanels(grid: HTMLElement): HTMLCanvasElement | null {
  const cards = [...grid.querySelectorAll<HTMLElement>('[data-wmap-plot-panel]')];
  const first = cards[0]?.querySelector('canvas');
  if (!first) return null;
  const dpr = first.width / Math.max(1, first.getBoundingClientRect().width) || 1;
  const box = grid.getBoundingClientRect();
  const out = grid.ownerDocument.createElement('canvas');
  out.width = Math.ceil(box.width * dpr); out.height = Math.ceil(box.height * dpr);
  const ctx = out.getContext('2d');
  if (!ctx) return null;
  const style = getComputedStyle(grid);
  ctx.fillStyle = style.backgroundColor && style.backgroundColor !== 'rgba(0, 0, 0, 0)' ? style.backgroundColor : '#fff';
  ctx.fillRect(0, 0, out.width, out.height);
  for (const c of cards) {
    const cv = c.querySelector('canvas');
    const title = c.dataset.wmapChartTitle ?? '';
    const r = (cv ?? c).getBoundingClientRect();
    const cr = c.getBoundingClientRect();
    ctx.fillStyle = getComputedStyle(c).color || '#333';
    ctx.font = `600 ${Math.round(13 * dpr)}px system-ui, sans-serif`;
    ctx.textBaseline = 'top';
    ctx.fillText(title, (cr.left - box.left + 8) * dpr, (cr.top - box.top + 6) * dpr);
    if (cv) ctx.drawImage(cv, (r.left - box.left) * dpr, (r.top - box.top) * dpr, r.width * dpr, r.height * dpr);
  }
  return out;
}

interface Scale {
  lo: number;
  hi: number;
  log: boolean;
  reverse: boolean;
  /** Position along the axis, 0 at the start edge to 1 at the end edge, reversal applied. */
  frac(v: number): number;
}

/**
 * The values an axis is fitted to: its own, plus a faceted plot's range over every panel (`ResolvedAxis.extent`), so
 * each panel's axis, its limit lines included, comes out the same.
 */
const spanOf = (values: number[], axis: ResolvedAxis): number[] => (axis.extent ? [...values, ...axis.extent] : values);

function makeScale(values: readonly number[], axis: ResolvedAxis, opts: { floorAtZero?: boolean } = {}): Scale {
  const log = axis.scale === 'log';
  let lo = values.length ? minOf(values) : 0;
  let hi = values.length ? maxOf(values) : 1;
  if (log) { lo = Math.log10(Math.max(lo, Number.MIN_VALUE)); hi = Math.log10(Math.max(hi, Number.MIN_VALUE)); }
  const pad = (hi - lo) * 0.05 || (log ? 0.5 : 1);
  // Bars stand on zero: the baseline is the axis, not a point a little way above its bottom edge.
  const floored = opts.floorAtZero && !log && lo >= 0;
  lo = floored ? 0 : lo - pad;
  hi += pad;
  const set = (v: number | undefined) => (v === undefined || !Number.isFinite(v) ? undefined : log ? (v > 0 ? Math.log10(v) : undefined) : v);
  const userLo = set(axis.min), userHi = set(axis.max);
  if (userLo !== undefined) lo = userLo;
  if (userHi !== undefined) hi = userHi;
  if (!(hi > lo)) hi = lo + 1;
  const span = hi - lo;
  const reverse = !!axis.reverse;
  const frac = (v: number): number => {
    const t = ((log ? Math.log10(Math.max(v, Number.MIN_VALUE)) : v) - lo) / span;
    return reverse ? 1 - t : t;
  };
  // `lo`/`hi` are reported in data units so ticks and labels never see the transform.
  return { lo: log ? 10 ** lo : lo, hi: log ? 10 ** hi : hi, log, reverse, frac };
}

/**
 * Tick values for a log axis. Over ten times or more they are decades, with 2 and 5 between them when that is
 * still sparse. Over a narrower range decades would leave one tick or none, so the ticks are the round values of a
 * linear axis (0.9, 1.0, 1.1…), placed by the log scale: the spacing shows it is logarithmic, the labels stay readable.
 */
function logTicks(lo: number, hi: number, lengthPx: number, minSpacing: (step: number, ticks: number[]) => number): { ticks: number[]; step: number } {
  if (hi / lo < 10) return fitTicks(lo, hi, lengthPx, minSpacing);
  const first = Math.floor(Math.log10(lo)), last = Math.ceil(Math.log10(hi));
  const within = (mantissas: number[]) => {
    const out: number[] = [];
    for (let e = first; e <= last; e++) for (const m of mantissas) { const v = m * 10 ** e; if (v >= lo && v <= hi) out.push(v); }
    return out;
  };
  const decades = within([1]);
  const ticks = decades.length >= 4 ? decades : within([1, 2, 5]);
  return { ticks, step: 0 };
}

export function renderPlotChart(options: PlotChartOptions): PlotChartHandle {
  const doc = options.ownerDocument ?? document;
  const { card, heading, body, controlsRow, setPngDecor, setPngCanvas } = cardShell(options.panel?.title ?? 'Plot', options.onSaveImage, doc);
  // A panel is saved as part of its grid, so it has no PNG button of its own.
  if (options.panel) { card.querySelector('button[aria-label="Save as PNG"]')?.remove(); card.dataset.wmapPlotPanel = '1'; }
  /** A faceted plot's panels, each its own chart. */
  let panels: PlotChartHandle[] = [];
  card.dataset.wmapPlotCard = '1';
  const tooltip = makeTooltip(card);

  let resolved: ResolvedPlot | undefined;
  let canvas: HTMLCanvasElement | undefined;
  let legend: HTMLElement | undefined;
  /** Everything above the canvas (the statement of what it shows, notes, the colour key): the canvas starts below it. */
  let above: HTMLElement | undefined;
  let pointer: { destroy: () => void } | undefined;
  let chips: SeriesLegendItem[] = [];
  const active = new Set<number>();          // legend filter: group indexes, empty = all
  const selected = new Set<PlotPoint>();
  let hovered: PlotPoint | null = null;
  let hoveredBin = -1;
  let drawn: Array<DrawnPoint<PlotPoint>> = [];
  let geometry: { x: Scale; y: Scale; plotW: number; plotH: number } | undefined;
  /** `heights`: what each bar is drawn to, its count or (`histNorm: 'percent'`) its share of its colour in percent. */
  let histogram: { edges: number[]; counts: number[][]; heights: number[][]; maxCount: number;
    /** Each colour's mean and standard deviation, when the plot draws normal curves and the colour has spread. */
    normal: Array<{ mean: number; sd: number } | undefined> } | undefined;
  /** Where the cells of a box or bar plot were drawn, for hover and click. */
  let cat: { slotW: number; n: number; plotW: number; layout: ReturnType<typeof categoryLayout>;
    /** A stacked bar's segments per category, in canvas pixels, for hover and click. */
    stacks?: Array<Array<{ g: number; y0: number; y1: number }>> } | undefined;
  let hoveredCell: { g: number; c: number } | null = null;
  /** Where the points of a line plot were drawn: the x position of each distinct x, for hover. */
  let lineX: number[] = [];
  let hoveredLine = -1;
  /** A probability curve's drawn points, made once per plot: hover and selection know a point by its object. */
  let probabilityPoints = new Map<number, PlotPoint>();

  /** Where this draw's limit labels are, so a label on one axis does not land on one on the other. Reset by `drawFrame`. */
  let limitLabelBoxes: LabelBox[] = [];
  let bottomMargin = BOTTOM;
  const colorOf = (g: number): string => categorical(g);
  const groupLabel = (g: number): string => resolved?.groups[g] || '';

  function dims(): { w: number; h: number; plotW: number; plotH: number } {
    const w = body.clientWidth;
    const gridH = (options.panel ? Math.max(170, Math.min(280, w * 0.72)) : Math.max(220, Math.min(420, w * 0.62))) + (bottomMargin - BOTTOM);
    const h = chartFillHeight(card, body, canvas!, gridH);
    return { w, h, plotW: Math.max(10, w - LEFT - RIGHT), plotH: Math.max(10, h - TOP - bottomMargin) };
  }

  /** The limit lines of the test an axis measures, as the plot's `limits` setting asks for them. */
  const linesOf = (axis: ResolvedAxis | undefined): LimitLine[] => {
    const role = axis && axis === resolved?.x ? 'x' : 'y';
    // The reader's own reference lines and bands: a band is its two edges, shaded from the lower.
    const refs = (resolved?.spec.axes?.[role]?.references ?? []).flatMap((r): LimitLine[] => r.to === undefined
      ? [{ value: r.at, kind: 'ref', end: 'lo', label: r.label ?? '' }]
      : [{ value: r.at, kind: 'ref', end: 'lo', label: r.label ?? '', bandTo: r.to }, { value: r.to, kind: 'ref', end: 'hi', label: r.label ?? '' }]);
    return [...limitLines(axis?.limits, resolved?.spec.limits ?? 'both'), ...refs].filter(l => axis?.scale !== 'log' || l.value > 0);
  };

  /** `values` with the limits added when that keeps the data a third of the axis: the rule the Insights charts use. */
  const withLimits = (values: number[], lines: readonly LimitLine[]): number[] => {
    const finite = values.filter(Number.isFinite);
    if (!lines.length || finite.length === 0) return values;
    const { lo, hi } = limitExtent(lines);
    return shouldIncludeLimitsByDefault(minOf(finite), maxOf(finite), lo, hi) ? [...values, ...lines.map(l => l.value)] : values;
  };

  /**
   * The limit lines of the test on one axis, drawn under the marks: dashed, short for test limits and long for spec, each
   * labelled with its value. A limit outside the axis range gets an edge marker, so "off the plot" never reads as "no limit".
   */
  function drawLimits(ctx: CanvasRenderingContext2D, color: string, plotW: number, plotH: number,
    scale: Scale, lines: readonly LimitLine[], axis: ResolvedAxis, orient: 'x' | 'y'): void {
    if (lines.length === 0) return;
    const inside = lines.filter(l => l.value >= scale.lo && l.value <= scale.hi);
    const off = lines.filter(l => !inside.includes(l)).map(l => ({ value: l.value, label: l.label, side: (l.value < scale.lo ? 'lo' : 'hi') as 'lo' | 'hi' }));
    ctx.save();
    ctx.font = `${fontPx(-1)}px system-ui, sans-serif`;
    const text = (l: LimitLine) => `${l.label} ${fmt(l.value, axis.unit)}`.trim();
    const rowH = fontPx(-1) + 2;
    // A reference band: shaded between its edges (clipped to the plot), under the lines.
    for (const l of lines) {
      if (l.bandTo === undefined) continue;
      const a = scale.frac(Math.min(l.value, l.bandTo)), b = scale.frac(Math.max(l.value, l.bandTo));
      const f0 = Math.max(0, Math.min(a, b)), f1 = Math.min(1, Math.max(a, b));
      if (f1 <= f0) continue;
      ctx.save(); ctx.globalAlpha = 0.1; ctx.fillStyle = color;
      if (orient === 'y') ctx.fillRect(LEFT, TOP + (1 - f1) * plotH, plotW, (f1 - f0) * plotH);
      else ctx.fillRect(LEFT + f0 * plotW, TOP, (f1 - f0) * plotW, plotH);
      ctx.restore();
    }
    if (orient === 'y') {
      const placed = inside.map(l => { const y = TOP + (1 - scale.frac(l.value)) * plotH; return { l, y, start: y - 6 - rowH / 2, end: y - 6 + rowH / 2 }; });
      const rows = stackLabelRows(placed, 1);
      const colW = placed.length ? maxOf(placed.map(p => ctx.measureText(text(p.l)).width)) + 8 : 0;
      placed.forEach(({ l, y }, k) => {
        ctx.globalAlpha = 0.7;
        strokeLimitLine(ctx, l, color, LEFT, y, LEFT + plotW, y);
        ctx.globalAlpha = 1;
        ctx.fillStyle = color; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
        const tx = LEFT + 3 + rows[k] * colW;
        // The label sits above its line; if that is where an X-axis limit label already is, it goes below the line's top.
        const box = placeClearOf(limitLabelBoxes, { x0: tx, x1: tx + ctx.measureText(text(l)).width, y0: y - 4 - rowH + 2, y1: y - 4 + 2 }, rowH);
        ctx.fillText(text(l), tx, box.y1 - 2);
      });
    } else {
      const placed = inside.map(l => {
        const x = LEFT + scale.frac(l.value) * plotW;
        const w = ctx.measureText(text(l)).width;
        const side = limitLabelSide(x, w, LEFT, LEFT + plotW, l.end === 'lo');
        return { l, x, side, start: side < 0 ? x - 3 - w : x + 3, end: side < 0 ? x - 3 : x + 3 + w };
      });
      const rows = stackLabelRows(placed, 4);
      placed.forEach(({ l, x, side, start, end }, k) => {
        ctx.globalAlpha = 0.7;
        strokeLimitLine(ctx, l, color, x, TOP, x, TOP + plotH);
        ctx.globalAlpha = 1;
        ctx.fillStyle = color; ctx.textAlign = side < 0 ? 'right' : 'left'; ctx.textBaseline = 'top';
        const top = TOP + 2 + rows[k] * rowH;
        const box = placeClearOf(limitLabelBoxes, { x0: start, x1: end, y0: top, y1: top + rowH }, rowH);
        ctx.fillText(text(l), x + side * 3, box.y0);
      });
    }
    ctx.restore();
    drawOffAxisLimits(ctx, off, { left: LEFT, right: LEFT + plotW, top: TOP, bottom: TOP + plotH }, orient === 'y' ? 'vertical' : 'horizontal', color, v => fmt(v, axis.unit));
  }

  function unitFormat(axis: ResolvedAxis, lo: number, hi: number, step?: number) {
    return makeAxisFormat(Math.max(Math.abs(lo), Math.abs(hi)), axis.unit, step);
  }

  function axisTitle(axis: ResolvedAxis, unitLabel: string): string {
    return unitLabel ? `${axis.label} (${unitLabel})` : axis.label;
  }

  /**
   * The x axis of a box or bar plot: one slot per category, labelled (slanted when they would not fit flat). With nested
   * levels, `labels` are the innermost values and `nest` each category's value at every level, outer first: the outer
   * levels are drawn as rows of labels spanning their categories, above the axis title, the outermost lowest.
   */
  interface CategoryAxis { labels: string[]; rotate: boolean; nest?: string[][] }
  const NEST_ROW = 18;
  const fitText = (ctx: CanvasRenderingContext2D, text: string, room: number): string => {
    if (ctx.measureText(text).width <= room) return text;
    for (let n = text.length - 1; n > 0; n--) { const t = `${text.slice(0, n)}…`; if (ctx.measureText(t).width <= room) return t; }
    return '';
  };

  function drawFrame(ctx: CanvasRenderingContext2D, theme: ReturnType<typeof resolveChartCanvasColors>, w: number, h: number,
    plotW: number, plotH: number, x: Scale | CategoryAxis, y: Scale, xAxis: ResolvedAxis, yAxis: ResolvedAxis,
    /** Ticks placed by the caller, each at its axis position with its own label: a probability axis's shares. */
    fixedYTicks?: ReadonlyArray<{ at: number; label: string }>): void {
    limitLabelBoxes = [];   // each draw starts with no limit labels placed
    ctx.font = `${fontPx(-1)}px system-ui, sans-serif`;
    const ySpacing = () => VERTICAL_TICK_SPACING_PX;
    const yTicksFit = fixedYTicks ? { ticks: fixedYTicks.map(t => t.at), step: 0 }
      : y.log ? logTicks(y.lo, y.hi, plotH, ySpacing) : fitTicks(y.lo, y.hi, plotH, ySpacing);
    const fixedLabel = new Map(fixedYTicks?.map(t => [t.at, t.label]));
    const autoFmt = unitFormat(yAxis, y.lo, y.hi, yTicksFit.step || undefined);
    const yFmt = fixedYTicks ? { tick: (v: number) => fixedLabel.get(v) ?? '', unitLabel: '' } : autoFmt;
    ctx.strokeStyle = theme.grid;
    ctx.lineWidth = 0.5;
    ctx.fillStyle = theme.textMuted;
    let xUnitLabel = '';
    if ('labels' in x) {
      const n = x.labels.length;
      x.labels.forEach((label, i) => {
        const cx = LEFT + ((i + 0.5) / n) * plotW;
        const text = label.length > 22 ? `${label.slice(0, 21)}…` : label;
        if (x.rotate) {
          ctx.save();
          ctx.translate(cx, TOP + plotH + 6);
          ctx.rotate(-Math.PI / 4);
          ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
          ctx.fillText(text, 0, 0);
          ctx.restore();
        } else {
          ctx.textAlign = 'center'; ctx.textBaseline = 'top';
          ctx.fillText(text, cx, TOP + plotH + 4);
        }
      });
      if (x.nest) {
        // Each outer level: a label centred on each run of categories that share it, and a divider between runs, drawn
        // through the plot so a group reads as a group. The outermost level's dividers are the strongest.
        const levels = x.nest[0]?.length ?? 0;
        const slotW = plotW / n;
        for (let k = levels - 2; k >= 0; k--) {
          const rowY = h - 6 - NEST_ROW - k * NEST_ROW;   // above the axis title; the outermost (k = 0) lowest
          const runKey = (i: number) => x.nest![i].slice(0, k + 1).join('\u001f');
          let start = 0;
          for (let i = 1; i <= n; i++) {
            const same = i < n && runKey(i) === runKey(start);
            if (same) continue;
            const x0 = LEFT + start * slotW, x1 = LEFT + i * slotW;
            ctx.fillStyle = theme.text;
            ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
            ctx.fillText(fitText(ctx, x.nest[start][k], x1 - x0 - 4), (x0 + x1) / 2, rowY);
            if (i < n) {
              ctx.save();
              ctx.strokeStyle = theme.border;
              ctx.globalAlpha = k === 0 ? 0.9 : 0.45;
              ctx.lineWidth = 1;
              ctx.beginPath(); ctx.moveTo(x1, TOP); ctx.lineTo(x1, rowY - 2); ctx.stroke();
              ctx.restore();
            }
            start = i;
          }
        }
        ctx.fillStyle = theme.textMuted;
      }
    } else {
      const xSpacing = horizontalTickSpacing(ctx, Math.max(Math.abs(x.lo), Math.abs(x.hi)), xAxis.unit);
      const xTicksFit = x.log ? logTicks(x.lo, x.hi, plotW, xSpacing) : fitTicks(x.lo, x.hi, plotW, xSpacing);
      const xFmt = unitFormat(xAxis, x.lo, x.hi, xTicksFit.step || undefined);
      xUnitLabel = xFmt.unitLabel;
      for (const xv of xTicksFit.ticks) {
        const cx = LEFT + x.frac(xv) * plotW;
        ctx.beginPath(); ctx.moveTo(cx, TOP); ctx.lineTo(cx, TOP + plotH); ctx.stroke();
        ctx.textAlign = 'center'; ctx.textBaseline = 'top';
        ctx.fillText(xFmt.tick(xv), cx, TOP + plotH + 4);
      }
    }
    for (const yv of yTicksFit.ticks) {
      const cy = TOP + (1 - y.frac(yv)) * plotH;
      ctx.beginPath(); ctx.moveTo(LEFT, cy); ctx.lineTo(LEFT + plotW, cy); ctx.stroke();
      ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
      ctx.fillText(yFmt.tick(yv), LEFT - 4, cy);
    }
    // Axis titles carry the unit, scaled to the ticks ("Idsat (µA)").
    ctx.font = `${fontPx(0)}px system-ui, sans-serif`;
    ctx.fillStyle = theme.text;
    ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    ctx.fillText(axisTitle(xAxis, xUnitLabel), LEFT + plotW / 2, h - 6);
    ctx.save();
    ctx.translate(14, TOP + plotH / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textBaseline = 'top';
    ctx.fillText(axisTitle(yAxis, yFmt.unitLabel), 0, 0);
    ctx.restore();
    ctx.strokeStyle = theme.border;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(LEFT, TOP); ctx.lineTo(LEFT, TOP + plotH);
    ctx.moveTo(LEFT, TOP + plotH); ctx.lineTo(LEFT + plotW, TOP + plotH);
    ctx.stroke();
  }

  function drawScatter(): void {
    if (!resolved || !canvas || resolved.marks?.type !== 'scatter' || !resolved.x || !resolved.y) return;
    applyCanvasFlow(canvas, above ?? 0);
    const theme = resolveChartCanvasColors(card);
    const { w, h, plotW, plotH } = dims();
    const prep = prepareCanvas(canvas, card, w, h);
    if (!prep) return;
    const { ctx } = prep;
    const all = resolved.marks.points;
    const visible = active.size === 0 ? all : all.filter(p => active.has(p.group));
    const scale = resolved.colorScale;
    const gradient = resolveValueColorFn();
    const xLines = linesOf(resolved.x), yLines = linesOf(resolved.y);
    const x = makeScale(withLimits(spanOf(all.map(p => p.x), resolved.x), xLines), resolved.x);
    const y = makeScale(withLimits(spanOf(all.map(p => p.y), resolved.y), yLines), resolved.y);
    geometry = { x, y, plotW, plotH };
    drawFrame(ctx, theme, w, h, plotW, plotH, x, y, resolved.x, resolved.y);
    drawLimits(ctx, theme.limitLine, plotW, plotH, x, xLines, resolved.x, 'x');
    drawLimits(ctx, theme.limitLine, plotW, plotH, y, yLines, resolved.y, 'y');

    const step = visible.length > SAMPLE_LIMIT ? Math.ceil(visible.length / SAMPLE_LIMIT) : 1;
    ctx.globalAlpha = Math.max(0.15, Math.min(0.7, 200 / (visible.length / step)));
    drawn = [];
    const clipLeft = LEFT, clipRight = LEFT + plotW, clipTop = TOP, clipBottom = TOP + plotH;
    for (let i = 0; i < visible.length; i += step) {
      const p = visible[i];
      const cx = LEFT + x.frac(p.x) * plotW, cy = TOP + (1 - y.frac(p.y)) * plotH;
      if (cx < clipLeft || cx > clipRight || cy < clipTop || cy > clipBottom) continue;
      drawn.push({ p, cx, cy });
      ctx.beginPath();
      ctx.arc(cx, cy, 2.5, 0, Math.PI * 2);
      ctx.fillStyle = scale && p.value !== undefined ? gradient((p.value - scale.lo) / (scale.hi - scale.lo || 1)) : colorOf(p.group);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    // y = x, then each colour's fitted line, sampled along X so a log axis draws the same line as a curve.
    const sc = resolved.marks;
    if (sc.type === 'scatter' && (sc.identity || sc.fits)) {
      const pxAt = (vx: number, vy: number): [number, number] => [LEFT + x.frac(vx) * plotW, TOP + (1 - y.frac(vy)) * plotH];
      const along = (f: (v: number) => number, color: string, dash: number[]) => {
        ctx.save();
        ctx.beginPath(); ctx.rect(LEFT, TOP, plotW, plotH); ctx.clip();
        ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.setLineDash(dash);
        ctx.beginPath();
        for (let k = 0; k <= 60; k++) {
          const t = k / 60;
          const vx = x.log ? 10 ** (Math.log10(x.lo) + (Math.log10(x.hi) - Math.log10(x.lo)) * t) : x.lo + (x.hi - x.lo) * t;
          const [px, py] = pxAt(vx, f(vx));
          if (k === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
        }
        ctx.stroke();
        ctx.restore();
      };
      if (sc.identity) along(v => v, theme.textMuted, [6, 4]);
      for (const fit of sc.fits ?? []) {
        if (active.size > 0 && !active.has(fit.group) && !scale) continue;
        along(v => fit.intercept + fit.slope * v, scale ? theme.text : colorOf(fit.group), []);
      }
    }
    const hot = hovered ? drawn.find(d => d.p === hovered) : undefined;
    if (hot) {
      ctx.beginPath(); ctx.arc(hot.cx, hot.cy, 5, 0, Math.PI * 2);
      ctx.lineWidth = 2; ctx.strokeStyle = theme.text; ctx.stroke();
    }
    if (selected.size > 0) {
      ctx.lineWidth = 1.5; ctx.strokeStyle = theme.text;
      let n = 0;
      for (const p of selected) {
        if (active.size > 0 && !active.has(p.group)) continue;
        if (++n > SAMPLE_LIMIT) break;
        ctx.beginPath();
        ctx.arc(LEFT + x.frac(p.x) * plotW, TOP + (1 - y.frac(p.y)) * plotH, 4, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
  }

  function buildHistogram(): void {
    histogram = undefined;
    if (!resolved || resolved.marks?.type !== 'histogram' || !resolved.x) return;
    const values = resolved.marks.values;
    const flat = values.flat();
    if (flat.length === 0) return;
    const x = makeScale(withLimits(spanOf(flat, resolved.x), linesOf(resolved.x)), resolved.x);
    const bins = Math.max(1, resolved.spec.bins ?? HISTOGRAM_BINS);
    // Bins are equal in the axis's own space: widths in decades on a log axis, in units on a linear one.
    const tLo = x.log ? Math.log10(x.lo) : x.lo, tHi = x.log ? Math.log10(x.hi) : x.hi;
    const edges = Array.from({ length: bins + 1 }, (_, i) => { const t = tLo + ((tHi - tLo) * i) / bins; return x.log ? 10 ** t : t; });
    const counts = values.map(() => new Array<number>(bins).fill(0));
    values.forEach((vs, g) => {
      for (const v of vs) {
        const t = x.log ? (v > 0 ? Math.log10(v) : NaN) : v;
        if (!Number.isFinite(t) || t < tLo || t > tHi) continue;
        const b = Math.min(bins - 1, Math.floor(((t - tLo) / (tHi - tLo)) * bins));
        counts[g][b]++;
      }
    });
    // Shares of each colour's own values in view, so a small group's shape compares with a large one's.
    const percent = resolved.spec.histNorm === 'percent';
    const heights = percent ? counts.map(c => { const t = c.reduce((a, b) => a + b, 0); return c.map(n => (t ? (n / t) * 100 : 0)); }) : counts;
    // A normal curve can rise above the bars: the axis reaches its peak, n × bin width / (σ√2π).
    let peak = 0;
    const normal: Array<{ mean: number; sd: number } | undefined> = values.map(() => undefined);
    if (resolved.spec.normalCurve && !x.log) {
      const binW = (edges[edges.length - 1] - edges[0]) / bins;
      values.forEach((vs, g) => {
        const f = vs.filter(Number.isFinite);
        if (f.length < 2) return;
        const mean = f.reduce((a, b) => a + b, 0) / f.length;
        const sd = Math.sqrt(sampleVariance(f, mean));
        if (!(sd > 0)) return;
        normal[g] = { mean, sd };
        peak = Math.max(peak, ((percent ? 100 : counts[g].reduce((a, b) => a + b, 0)) * binW) / (sd * Math.sqrt(2 * Math.PI)));
      });
    }
    histogram = { edges, counts, heights, normal, maxCount: Math.max(percent ? 0.001 : 1, peak, ...heights.map(c => maxOf(c))) };
  }

  function drawHistogram(): void {
    if (!resolved || !canvas || !histogram || !resolved.x || !resolved.y) return;
    applyCanvasFlow(canvas, above ?? 0);
    const theme = resolveChartCanvasColors(card);
    const { w, h, plotW, plotH } = dims();
    const prep = prepareCanvas(canvas, card, w, h);
    if (!prep) return;
    const { ctx } = prep;
    const { edges, counts, heights, normal, maxCount } = histogram;
    const x = makeScale([edges[0], edges[edges.length - 1]], { ...resolved.x, min: edges[0], max: edges[edges.length - 1] });
    const y = makeScale([0, maxCount], { label: resolved.y.label, scale: 'linear', min: 0, max: maxCount * 1.05 });
    geometry = { x, y, plotW, plotH };
    drawFrame(ctx, theme, w, h, plotW, plotH, x, y, resolved.x, resolved.y);
    drawLimits(ctx, theme.limitLine, plotW, plotH, x, linesOf(resolved.x), resolved.x, 'x');
    const groups = counts.map((_, g) => g).filter(g => active.size === 0 || active.has(g));
    const overlay = groups.length > 1;
    for (const g of groups) {
      ctx.globalAlpha = overlay ? 0.55 : 0.85;
      ctx.fillStyle = colorOf(g);
      heights[g].forEach((n, b) => {
        if (n === 0) return;
        const x0 = LEFT + Math.min(x.frac(edges[b]), x.frac(edges[b + 1])) * plotW;
        const x1 = LEFT + Math.max(x.frac(edges[b]), x.frac(edges[b + 1])) * plotW;
        const top = TOP + (1 - y.frac(n)) * plotH;
        ctx.fillRect(x0, top, Math.max(1, x1 - x0 - 1), TOP + plotH - top);
      });
    }
    ctx.globalAlpha = 1;
    // Each colour's normal distribution, at its mean and standard deviation, scaled as its bars are: a count is n × bin
    // width × density, a share 100 × bin width × density.
    if (resolved.spec.normalCurve && !x.log) {
      const binW = (edges[edges.length - 1] - edges[0]) / (edges.length - 1);
      for (const g of groups) {
        const fit = normal[g];
        if (!fit) continue;
        const { mean, sd } = fit;
        const scale = (resolved.spec.histNorm === 'percent' ? 100 : counts[g].reduce((a, b) => a + b, 0)) * binW;
        ctx.save();
        ctx.beginPath(); ctx.rect(LEFT, TOP, plotW, plotH); ctx.clip();
        ctx.strokeStyle = colorOf(g); ctx.lineWidth = 2;
        ctx.beginPath();
        for (let k = 0; k <= 120; k++) {
          const v = edges[0] + ((edges[edges.length - 1] - edges[0]) * k) / 120;
          const dens = Math.exp(-0.5 * ((v - mean) / sd) ** 2) / (sd * Math.sqrt(2 * Math.PI));
          const px = LEFT + x.frac(v) * plotW, py = TOP + (1 - y.frac(scale * dens)) * plotH;
          if (k === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
        }
        ctx.stroke();
        ctx.restore();
      }
    }
    if (hoveredBin >= 0) {
      const x0 = LEFT + Math.min(x.frac(edges[hoveredBin]), x.frac(edges[hoveredBin + 1])) * plotW;
      const x1 = LEFT + Math.max(x.frac(edges[hoveredBin]), x.frac(edges[hoveredBin + 1])) * plotW;
      ctx.lineWidth = 1.5; ctx.strokeStyle = theme.text;
      ctx.strokeRect(x0, TOP, Math.max(1, x1 - x0), plotH);
    }
  }


  // ── box and bar ──
  function drawCategorical(): void {
    const m = resolved?.marks;
    if (!resolved || !canvas || !resolved.x || !resolved.y || !m || (m.type !== 'box' && m.type !== 'bar')) return;
    applyCanvasFlow(canvas, above ?? 0);
    const theme = resolveChartCanvasColors(card);
    // Slant the labels when flat ones would collide. Measured before the canvas is sized, since it sets the margin.
    // Nested categories label each slot with its innermost value; the outer values are rows of their own.
    const tickLabels = m.nest ? m.nest.parts.map(p => p[p.length - 1]) : m.categories;
    const probe = canvas.getContext('2d');
    let widest = 0;
    if (probe) {
      probe.font = `${fontPx(-1)}px system-ui, sans-serif`;
      widest = maxOf(tickLabels.map(c => probe.measureText(c.length > 22 ? `${c.slice(0, 21)}…` : c).width));
    }
    const slot = Math.max(10, body.clientWidth - LEFT - RIGHT) / Math.max(1, m.categories.length);
    const rotate = widest + 8 > slot;
    const outerRows = m.nest ? m.nest.levels.length - 1 : 0;
    bottomMargin = (rotate ? BOTTOM + Math.min(110, widest * 0.72) : BOTTOM) + outerRows * NEST_ROW;
    // A pareto line has its own axis, 0 to 100%, on the right: room for its labels comes off the plot.
    const rightPad = m.cumulative ? 40 : 0;
    const { w, h, plotW: fullW, plotH } = dims();
    const plotW = Math.max(10, fullW - rightPad);
    const prep = prepareCanvas(canvas, card, w, h);
    if (!prep) return;
    const { ctx } = prep;

    const finite = (a: number[]) => a.filter(Number.isFinite);
    const yLines = linesOf(resolved.y);
    const stacked = m.type === 'bar' && !!m.stack;
    const shownGroup = (g: number) => active.size === 0 || active.has(g);
    // A stack spans each category's total of the colours shown.
    const stackTotals = stacked ? m.categories.map((_, c) => m.values.reduce((t, row, g) => t + (shownGroup(g) && Number.isFinite(row[c]) ? row[c] : 0), 0)) : [];
    const spanned = m.type === 'bar' ? [...(stacked ? stackTotals : finite(m.values.flat())), 0] : finite(m.cells.flat(2));
    const y = makeScale(withLimits(spanOf(spanned, resolved.y), yLines), resolved.y, { floorAtZero: m.type === 'bar' });
    geometry = { x: y, y, plotW, plotH };   // only plotW/plotH are read for these marks
    drawFrame(ctx, theme, w, h, plotW, plotH, { labels: tickLabels, rotate, nest: m.nest?.parts }, y, resolved.x, resolved.y);
    drawLimits(ctx, theme.limitLine, plotW, plotH, y, yLines, resolved.y, 'y');

    const n = m.categories.length, groups = resolved.groups.length;
    const slotW = plotW / n;
    // The groups each category has a mark for, among those the legend shows.
    const has = (g: number, c: number) => (m.type === 'bar' ? Number.isFinite(m.values[g][c]) : m.cells[g][c].length > 0);
    const present = Array.from({ length: n }, (_, c) => Array.from({ length: groups }, (_, g) => g).filter(g => shownGroup(g) && has(g, c)));
    // A stack is one mark per category: every colour shares its place.
    const layout = categoryLayout(stacked ? present.map(p => (p.length ? [0] : [])) : present);
    const gw = layout.width * slotW;
    cat = { slotW, n, plotW, layout };
    const baseY = y.log ? TOP + plotH : TOP + (1 - y.frac(0)) * plotH;
    const py = (v: number) => TOP + (1 - y.frac(v)) * plotH;
    if (stacked) {
      cat.stacks = [];
      for (let c = 0; c < n; c++) {
        const left = layout.left(c, 0);
        const segs: Array<{ g: number; y0: number; y1: number }> = [];
        cat.stacks.push(segs);
        if (left === undefined) continue;
        let base = 0;
        for (let g = 0; g < groups; g++) {
          const v = m.values[g][c];
          if (!shownGroup(g) || !Number.isFinite(v) || v <= 0) continue;
          const yTop = py(base + v), yBottom = py(base);
          ctx.fillStyle = colorOf(g);
          ctx.globalAlpha = 0.9;
          ctx.fillRect(LEFT + c * slotW + left * slotW + 1, yTop, Math.max(1, gw - 2), Math.max(1, yBottom - yTop));
          ctx.globalAlpha = 1;
          segs.push({ g, y0: yTop, y1: yBottom });
          base += v;
        }
      }
    }
    for (let g = 0; g < groups && !stacked; g++) {
      if (active.size > 0 && !active.has(g)) continue;
      const color = colorOf(g);
      for (let c = 0; c < n; c++) {
        const left = layout.left(c, g);
        if (left === undefined) continue;
        const x0 = LEFT + c * slotW + left * slotW;
        if (m.type === 'bar') {
          const v = m.values[g][c];
          if (!Number.isFinite(v)) continue;
          const top = TOP + (1 - y.frac(v)) * plotH;
          ctx.fillStyle = color;
          ctx.globalAlpha = 0.9;
          ctx.fillRect(x0 + 1, Math.min(top, baseY), Math.max(1, gw - 2), Math.max(1, Math.abs(baseY - top)));
          ctx.globalAlpha = 1;
        } else {
          const cell = m.cells[g][c];
          if (cell.length === 0) continue;
          const cx = x0 + gw / 2, bw = Math.max(3, Math.min(gw * 0.7, 46));
          const q = fiveNumberSummary(Float64Array.from(cell));
          const py = (v: number) => TOP + (1 - y.frac(v)) * plotH;
          ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = 1.5;
          if (cell.length === 1) { ctx.beginPath(); ctx.arc(cx, py(q.median), 3, 0, Math.PI * 2); ctx.fill(); continue; }
          ctx.beginPath(); ctx.moveTo(cx, py(q.min)); ctx.lineTo(cx, py(q.max)); ctx.stroke();
          for (const v of [q.min, q.max]) { ctx.beginPath(); ctx.moveTo(cx - bw / 4, py(v)); ctx.lineTo(cx + bw / 4, py(v)); ctx.stroke(); }
          ctx.globalAlpha = 0.35;
          ctx.fillRect(cx - bw / 2, Math.min(py(q.q1), py(q.q3)), bw, Math.max(1, Math.abs(py(q.q1) - py(q.q3))));
          ctx.globalAlpha = 1;
          ctx.strokeRect(cx - bw / 2, Math.min(py(q.q1), py(q.q3)), bw, Math.max(1, Math.abs(py(q.q1) - py(q.q3))));
          ctx.lineWidth = 2.5;
          ctx.beginPath(); ctx.moveTo(cx - bw / 2, py(q.median)); ctx.lineTo(cx + bw / 2, py(q.median)); ctx.stroke();
        }
      }
    }
    const hotLeft = hoveredCell ? layout.left(hoveredCell.c, stacked ? 0 : hoveredCell.g) : undefined;
    if (hoveredCell && hotLeft !== undefined) {
      ctx.lineWidth = 1.5; ctx.strokeStyle = theme.text;
      const seg = stacked ? cat.stacks?.[hoveredCell.c]?.find(sg => sg.g === hoveredCell!.g) : undefined;
      if (stacked && seg) ctx.strokeRect(LEFT + hoveredCell.c * slotW + hotLeft * slotW, seg.y0, gw, seg.y1 - seg.y0);
      else if (!stacked) ctx.strokeRect(LEFT + hoveredCell.c * slotW + hotLeft * slotW, TOP, gw, plotH);
    }

    // The pareto line: each category's running share of the whole, on its own 0–100% axis at the right.
    if (m.cumulative) {
      const cy = (pct: number) => TOP + (1 - pct / 100) * plotH;
      ctx.save();
      ctx.strokeStyle = theme.text; ctx.fillStyle = theme.text; ctx.lineWidth = 1.5;
      ctx.beginPath();
      m.cumulative.forEach((pct, c) => { const x = LEFT + (c + 0.5) * slotW; if (c === 0) ctx.moveTo(x, cy(pct)); else ctx.lineTo(x, cy(pct)); });
      ctx.stroke();
      m.cumulative.forEach((pct, c) => { ctx.beginPath(); ctx.arc(LEFT + (c + 0.5) * slotW, cy(pct), 2.5, 0, Math.PI * 2); ctx.fill(); });
      ctx.strokeStyle = theme.border; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(LEFT + plotW, TOP); ctx.lineTo(LEFT + plotW, TOP + plotH); ctx.stroke();
      ctx.fillStyle = theme.textMuted;
      ctx.font = `${fontPx(-1)}px system-ui, sans-serif`;
      ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      for (const pct of [0, 25, 50, 75, 100]) ctx.fillText(`${pct}%`, LEFT + plotW + 4, cy(pct));
      ctx.restore();
    }
  }

  function cellAt(e: MouseEvent): { g: number; c: number } | null {
    if (!cat || !canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left - LEFT;
    if (mx < 0 || mx > cat.plotW) return null;
    const c = Math.min(cat.n - 1, Math.floor(mx / cat.slotW));
    const g = cat.layout.groupAt(c, (mx - c * cat.slotW) / cat.slotW);
    if (g === undefined) return null;
    if (!cat.stacks) return { g, c };
    // In a stack, the colour is the segment under the pointer.
    const my = e.clientY - rect.top;
    const seg = cat.stacks[c]?.find(sg => my >= sg.y0 && my <= sg.y1);
    return seg ? { g: seg.g, c } : null;
  }

  function cellTip(cell: { g: number; c: number }): string {
    const r = resolved!;
    const m = r.marks as Extract<NonNullable<typeof r.marks>, { type: 'box' | 'bar' }>;
    const noun = r.level === 'die' ? 'dies' : 'wafers';
    const values = m.cells[cell.g][cell.c];
    // The colour group is named unless the category already names it (a ring coloured by ring).
    const parts = m.nest ? m.nest.parts[cell.c] : [m.categories[cell.c]];
    const group = r.groups.length > 1 && !parts.includes(groupLabel(cell.g)) ? ` · ${escHtml(groupLabel(cell.g))}` : '';
    const head = `<strong>${escHtml(m.categories[cell.c])}${group}</strong><br>`;
    const unit = r.y?.unit;
    if (values.length === 0) return `${head}no ${noun}`;
    const n = `${values.length.toLocaleString('en-GB')} ${noun}`;
    const open = m.categoryItems && options.onOpenWafer ? `<br><em>click to ${escHtml(options.openActionLabel ?? 'open this wafer')}</em>` : '';
    if (m.type === 'bar') {
      const v = m.values[cell.g][cell.c];
      const cum = m.cumulative ? `<br>${escHtml(`cumulative: ${m.cumulative[cell.c].toFixed(1)}% of the whole`)}` : '';
      return `${head}${escHtml(`${r.y!.label}: ${fmt(v, unit)}`)}<br>${escHtml(n)}${cum}${open}`;
    }
    const q = fiveNumberSummary(Float64Array.from(values));
    return `${head}${(['max', 'q3', 'median', 'q1', 'min'] as const).map(k => escHtml(`${{ max: 'max', q3: 'upper quartile', median: 'median', q1: 'lower quartile', min: 'min' }[k]}: ${fmt(q[k], unit)}`)).join('<br>')}<br>${escHtml(n)}${open}`;
  }

  // ── line ──
  function drawLine(): void {
    const m = resolved?.marks;
    if (!resolved || !canvas || !resolved.x || !resolved.y || !m || m.type !== 'line') return;
    applyCanvasFlow(canvas, above ?? 0);
    const theme = resolveChartCanvasColors(card);
    const { w, h, plotW, plotH } = dims();
    const prep = prepareCanvas(canvas, card, w, h);
    if (!prep) return;
    const { ctx } = prep;
    const xLines = linesOf(resolved.x), yLines = linesOf(resolved.y);
    const x = makeScale(withLimits(spanOf(m.xs, resolved.x), xLines), resolved.x);
    const bandValues = m.band ? [...m.band.lo.flat(), ...m.band.hi.flat()] : [];
    const y = makeScale(withLimits(spanOf([...m.values.flat(), ...bandValues].filter(Number.isFinite), resolved.y), yLines), resolved.y);
    geometry = { x, y, plotW, plotH };
    drawFrame(ctx, theme, w, h, plotW, plotH, x, y, resolved.x, resolved.y);
    drawLimits(ctx, theme.limitLine, plotW, plotH, x, xLines, resolved.x, 'x');
    drawLimits(ctx, theme.limitLine, plotW, plotH, y, yLines, resolved.y, 'y');
    lineX = m.xs.map(v => LEFT + x.frac(v) * plotW);
    // Each colour's band under its line: a filled run of the X values with both ends known, broken where one is not.
    if (m.band) {
      const yPx = (v: number) => TOP + (1 - y.frac(v)) * plotH;
      m.band.lo.forEach((lo, g) => {
        if (active.size > 0 && !active.has(g)) return;
        const hi = m.band!.hi[g];
        ctx.save();
        ctx.fillStyle = colorOf(g);
        ctx.globalAlpha = 0.16;
        let run: number[] = [];
        const flush = () => {
          // A lone point has no width to fill: its band is a bar from low to high, capped.
          if (run.length === 1) {
            const i = run[0], x0 = lineX[i];
            ctx.globalAlpha = 0.55; ctx.strokeStyle = colorOf(g); ctx.lineWidth = 2;
            ctx.beginPath(); ctx.moveTo(x0, yPx(lo[i])); ctx.lineTo(x0, yPx(hi[i]));
            ctx.moveTo(x0 - 4, yPx(lo[i])); ctx.lineTo(x0 + 4, yPx(lo[i])); ctx.moveTo(x0 - 4, yPx(hi[i])); ctx.lineTo(x0 + 4, yPx(hi[i]));
            ctx.stroke();
            ctx.globalAlpha = 0.16;
          } else if (run.length) {
            ctx.beginPath();
            run.forEach((i, k) => { if (k === 0) ctx.moveTo(lineX[i], yPx(hi[i])); else ctx.lineTo(lineX[i], yPx(hi[i])); });
            for (let k = run.length - 1; k >= 0; k--) ctx.lineTo(lineX[run[k]], yPx(lo[run[k]]));
            ctx.closePath();
            ctx.fill();
          }
          run = [];
        };
        lo.forEach((v, i) => { if (Number.isFinite(v) && Number.isFinite(hi[i])) run.push(i); else flush(); });
        flush();
        ctx.restore();
      });
    }
    m.values.forEach((series, g) => {
      if (active.size > 0 && !active.has(g)) return;
      ctx.strokeStyle = colorOf(g); ctx.fillStyle = colorOf(g); ctx.lineWidth = 2;
      let pen = false;
      ctx.beginPath();
      series.forEach((v, i) => {
        if (!Number.isFinite(v)) { pen = false; return; }
        const px = lineX[i], py = TOP + (1 - y.frac(v)) * plotH;
        if (pen) ctx.lineTo(px, py); else ctx.moveTo(px, py);
        pen = true;
      });
      ctx.stroke();
      series.forEach((v, i) => {
        if (!Number.isFinite(v)) return;
        ctx.beginPath(); ctx.arc(lineX[i], TOP + (1 - y.frac(v)) * plotH, hoveredLine === i ? 4.5 : 3, 0, Math.PI * 2); ctx.fill();
      });
    });
    if (hoveredLine >= 0) {
      ctx.lineWidth = 1; ctx.strokeStyle = theme.textMuted;
      ctx.beginPath(); ctx.moveTo(lineX[hoveredLine], TOP); ctx.lineTo(lineX[hoveredLine], TOP + plotH); ctx.stroke();
    }
  }

  function lineTip(e: MouseEvent): string | null {
    const m = resolved?.marks;
    if (!m || m.type !== 'line' || !canvas || !resolved?.x || lineX.length === 0) return null;
    const mx = e.clientX - canvas.getBoundingClientRect().left;
    let best = -1, bestD = 24;
    lineX.forEach((px, i) => { const d = Math.abs(px - mx); if (d < bestD) { bestD = d; best = i; } });
    hoveredLine = best;
    if (best < 0) return null;
    const noun = resolved.level === 'die' ? 'dies' : 'wafers';
    const rows = m.values.map((series, g) => ({ g, v: series[best], n: m.counts[g][best] })).filter(r => Number.isFinite(r.v) && (active.size === 0 || active.has(r.g)));
    return `<strong>${escHtml(`${resolved.x.label}: ${fmt(m.xs[best], resolved.x.unit)}`)}</strong><br>`
      + rows.map(r => {
        const lo = m.band?.lo[r.g][best], hi = m.band?.hi[r.g][best];
        const band = lo !== undefined && hi !== undefined && Number.isFinite(lo) && Number.isFinite(hi) ? `, band ${fmt(lo, resolved!.y!.unit)} to ${fmt(hi, resolved!.y!.unit)}` : '';
        return escHtml(`${resolved!.groups.length > 1 ? `${groupLabel(r.g)}: ` : ''}${fmt(r.v, resolved!.y!.unit)}${band} (${r.n.toLocaleString('en-GB')} ${noun})`);
      }).join('<br>');
  }

  // ── probability ──
  function drawProbability(): void {
    const m = resolved?.marks;
    if (!resolved || !canvas || !resolved.x || !resolved.y || m?.type !== 'probability') return;
    applyCanvasFlow(canvas, above ?? 0);
    const theme = resolveChartCanvasColors(card);
    const { w, h, plotW, plotH } = dims();
    const prep = prepareCanvas(canvas, card, w, h);
    if (!prep) return;
    const { ctx } = prep;
    const linear = resolved.spec.probabilityAxis === 'linear';
    const shown = m.values.map((_, g) => g).filter(g => m.values[g].length > 0 && (active.size === 0 || active.has(g)));
    // The vertical axis reaches the smallest plotting position of the largest group, and at least 1% to 99%.
    const nMax = Math.max(1, ...shown.map(g => m.values[g].length));
    const pEdge = Math.min(0.01, probabilityPosition(0, nMax));
    const at = (p: number) => (linear ? p : normalQuantile(p));
    const lo = linear ? 0 : at(pEdge), hi = linear ? 1 : at(1 - pEdge);
    const pad = linear ? 0 : (hi - lo) * 0.03;
    const y = makeScale([lo - pad, hi + pad], { label: resolved.y.label, scale: 'linear', min: lo - pad, max: hi + pad });
    // Share ticks no closer than a line of text, kept outward from 50% so the middle is always labelled.
    const candidates = linear ? [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1] : PROBABILITY_TICKS.filter(p => p >= pEdge && p <= 1 - pEdge);
    const ticks: Array<{ at: number; label: string }> = [];
    const px = (v: number) => TOP + (1 - y.frac(v)) * plotH;
    const mid = candidates.indexOf(0.5);
    ticks.push({ at: at(0.5), label: percentLabel(0.5) });
    for (const side of [candidates.slice(mid + 1), candidates.slice(0, mid).reverse()]) {
      let last = px(at(0.5));
      for (const p of side) {
        const yv = px(at(p));
        if (Math.abs(yv - last) < 16) continue;
        ticks.push({ at: at(p), label: percentLabel(p) });
        last = yv;
      }
    }
    const xLines = linesOf(resolved.x);
    const x = makeScale(withLimits(spanOf(shown.flatMap(g => [m.values[g][0], m.values[g][m.values[g].length - 1]]), resolved.x), xLines), resolved.x);
    geometry = { x, y, plotW, plotH };
    drawFrame(ctx, theme, w, h, plotW, plotH, x, y, resolved.x, resolved.y, ticks);
    drawLimits(ctx, theme.limitLine, plotW, plotH, x, xLines, resolved.x, 'x');

    drawn = [];
    ctx.save();
    ctx.beginPath(); ctx.rect(LEFT, TOP, plotW, plotH); ctx.clip();
    for (const g of shown) {
      const vs = m.values[g], n = vs.length;
      const idx = probabilitySample(n);
      ctx.strokeStyle = colorOf(g); ctx.fillStyle = colorOf(g);
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      idx.forEach((k, j) => {
        const cx = LEFT + x.frac(vs[k]) * plotW, cy = px(at(probabilityPosition(k, n)));
        if (j === 0) ctx.moveTo(cx, cy); else ctx.lineTo(cx, cy);
        const key = g * 2 ** 26 + k;
        let point = probabilityPoints.get(key);
        if (!point) {
          const { item, die } = m.unit(m.units[g][k]);
          point = { x: vs[k], y: probabilityPosition(k, n), group: g, item, die };
          probabilityPoints.set(key, point);
        }
        drawn.push({ p: point, cx, cy });
      });
      ctx.stroke();
      // Small groups show each value as a point; a large one is a curve.
      if (n <= 300) for (const k of idx) { ctx.beginPath(); ctx.arc(LEFT + x.frac(vs[k]) * plotW, px(at(probabilityPosition(k, n))), 2.5, 0, Math.PI * 2); ctx.fill(); }
    }
    ctx.restore();
    const hot = hovered ? drawn.find(d => d.p === hovered) : undefined;
    if (hot) { ctx.beginPath(); ctx.arc(hot.cx, hot.cy, 5, 0, Math.PI * 2); ctx.lineWidth = 2; ctx.strokeStyle = theme.text; ctx.stroke(); }
  }

  function describeProbabilityPoint(p: PlotPoint): string {
    const r = resolved!;
    const m = r.marks as Extract<NonNullable<typeof r.marks>, { type: 'probability' }>;
    const n = m.values[p.group].length;
    const rank = Math.round(p.y * n + 0.5);
    const wafer = options.waferLabel(p.item);
    const where = p.die && p.die.x !== undefined ? `die (${p.die.x}, ${p.die.y})` : '';
    const head = [wafer, where].filter(Boolean).join(' · ');
    return (head ? `<strong>${escHtml(head)}</strong><br>` : '')
      + escHtml(`${r.x!.label}: ${fmt(p.x, r.x!.unit)}`) + '<br>'
      // The rank is the fact; the share is where (rank − ½) / n puts it on the axis, not a count at or below.
      + escHtml(`rank ${rank.toLocaleString('en-GB')} of ${n.toLocaleString('en-GB')}, plotted at ${+(p.y * 100).toPrecision(3)}%`)
      + (r.groups.length > 1 ? `<br>${escHtml(groupLabel(p.group))}` : '')
      + (options.onOpenWafer ? `<br><em>click to ${escHtml(options.openActionLabel ?? 'open this wafer')}</em>` : '');
  }

  // ── heatmap ──
  /** Where the heatmap's grid was drawn, for hover and click. */
  let heat: { left: number; cw: number; ch: number; rows: number; cols: number } | undefined;
  let hoveredHeat: { r: number; c: number } | null = null;

  function drawHeatmap(): void {
    const m = resolved?.marks;
    if (!resolved || !canvas || m?.type !== 'heatmap') return;
    applyCanvasFlow(canvas, above ?? 0);
    const theme = resolveChartCanvasColors(card);
    const probe = canvas.getContext('2d');
    let rowW = 0, colW = 0;
    if (probe) {
      probe.font = `${fontPx(-1)}px system-ui, sans-serif`;
      rowW = maxOf(m.rows.map(t => probe.measureText(t.length > 24 ? `${t.slice(0, 23)}…` : t).width));
      colW = maxOf(m.cols.map(t => probe.measureText(t.length > 22 ? `${t.slice(0, 21)}…` : t).width));
    }
    // Room for the row labels at the left; the column labels slant when flat ones would collide.
    const left = Math.min(180, Math.max(LEFT, rowW + 24));
    const slot = Math.max(8, body.clientWidth - left - RIGHT) / Math.max(1, m.cols.length);
    const rotate = colW + 8 > slot;
    bottomMargin = rotate ? BOTTOM + Math.min(110, colW * 0.72) : BOTTOM;
    const { w, h } = dims();
    const plotW = Math.max(10, w - left - RIGHT), plotH = Math.max(10, h - TOP - bottomMargin);
    const prep = prepareCanvas(canvas, card, w, h);
    if (!prep) return;
    const { ctx } = prep;
    const cw = plotW / m.cols.length, ch = plotH / m.rows.length;
    heat = { left, cw, ch, rows: m.rows.length, cols: m.cols.length };
    const scale = resolved.colorScale;
    const gradient = resolveValueColorFn();
    const span = scale ? scale.hi - scale.lo || 1 : 1;
    ctx.font = `${fontPx(-1)}px system-ui, sans-serif`;
    for (let r = 0; r < m.rows.length; r++) {
      for (let c = 0; c < m.cols.length; c++) {
        const v = m.values[r][c];
        const x0 = left + c * cw, y0 = TOP + r * ch;
        ctx.fillStyle = Number.isFinite(v) && scale ? gradient((v - scale.lo) / span) : theme.track;
        ctx.fillRect(x0 + 0.5, y0 + 0.5, Math.max(1, cw - 1), Math.max(1, ch - 1));
        // The value itself, where the cell has room for it.
        if (Number.isFinite(v) && cw >= 40 && ch >= 16) {
          ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          fillTextOnHalo(ctx, cellText(v, resolved.y?.unit, scale?.integer), x0 + cw / 2, y0 + ch / 2, 'rgba(0,0,0,0.55)');
        }
      }
    }
    if (hoveredHeat) { ctx.lineWidth = 2; ctx.strokeStyle = theme.text; ctx.strokeRect(left + hoveredHeat.c * cw, TOP + hoveredHeat.r * ch, cw, ch); }
    // Row labels at the left, column labels below, and the two axis titles.
    ctx.fillStyle = theme.textMuted; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    m.rows.forEach((t, r) => ctx.fillText(t.length > 24 ? `${t.slice(0, 23)}…` : t, left - 6, TOP + (r + 0.5) * ch));
    m.cols.forEach((t, c) => {
      const text = t.length > 22 ? `${t.slice(0, 21)}…` : t, cx = left + (c + 0.5) * cw;
      if (rotate) { ctx.save(); ctx.translate(cx, TOP + plotH + 6); ctx.rotate(-Math.PI / 4); ctx.textAlign = 'right'; ctx.textBaseline = 'middle'; ctx.fillText(text, 0, 0); ctx.restore(); }
      else { ctx.textAlign = 'center'; ctx.textBaseline = 'top'; ctx.fillText(text, cx, TOP + plotH + 4); }
    });
    ctx.font = `${fontPx(0)}px system-ui, sans-serif`; ctx.fillStyle = theme.text;
    ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    ctx.fillText(resolved.x?.label ?? '', left + plotW / 2, h - 6);
  }

  function heatAt(e: MouseEvent): { r: number; c: number } | null {
    if (!heat || !canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const c = Math.floor((e.clientX - rect.left - heat.left) / heat.cw), r = Math.floor((e.clientY - rect.top - TOP) / heat.ch);
    return r >= 0 && r < heat.rows && c >= 0 && c < heat.cols ? { r, c } : null;
  }

  function heatTip(cell: { r: number; c: number }): string {
    const r = resolved!;
    const m = r.marks as Extract<NonNullable<typeof r.marks>, { type: 'heatmap' }>;
    const v = m.values[cell.r][cell.c], n = m.cellUnits[cell.r][cell.c].length;
    const noun = r.level === 'die' ? 'dies' : 'wafers';
    return `<strong>${escHtml(`${m.rows[cell.r]} · ${m.cols[cell.c]}`)}</strong><br>`
      + (Number.isFinite(v) ? escHtml(`${r.y?.label ?? 'Count'}: ${cellText(v, r.y?.unit, r.colorScale?.integer)}`) + '<br>' : '')
      + escHtml(`${n.toLocaleString('en-GB')} ${noun}`)
      + (n && options.onSelectPoints ? '<br><em>click to chart or tabulate them</em>' : '');
  }

  // ── control chart ──
  function drawControl(): void {
    const m = resolved?.marks;
    if (!resolved || !canvas || !resolved.x || !resolved.y || m?.type !== 'control') return;
    applyCanvasFlow(canvas, above ?? 0);
    const theme = resolveChartCanvasColors(card);
    const { w, h, plotW, plotH } = dims();
    const prep = prepareCanvas(canvas, card, w, h);
    if (!prep) return;
    const { ctx } = prep;
    const L = m.limits;
    const yLines = linesOf(resolved.y);
    const x = makeScale(spanOf(m.xs, resolved.x), resolved.x);
    const y = makeScale(withLimits(spanOf([...m.values, L.ucl, L.lcl], resolved.y), yLines), resolved.y);
    geometry = { x, y, plotW, plotH };
    drawFrame(ctx, theme, w, h, plotW, plotH, x, y, resolved.x, resolved.y);
    drawLimits(ctx, theme.limitLine, plotW, plotH, y, yLines, resolved.y, 'y');
    const px = (k: number) => LEFT + x.frac(m.xs[k]) * plotW, py = (v: number) => TOP + (1 - y.frac(v)) * plotH;
    // The centre and the ±1σ, ±2σ zones faint, the ±3σ control limits dashed and labelled.
    ctx.save();
    ctx.beginPath(); ctx.rect(LEFT, TOP, plotW, plotH); ctx.clip();
    const hline = (v: number, dash: number[], alpha: number, width = 1) => {
      ctx.globalAlpha = alpha; ctx.setLineDash(dash); ctx.lineWidth = width; ctx.strokeStyle = theme.text;
      ctx.beginPath(); ctx.moveTo(LEFT, py(v)); ctx.lineTo(LEFT + plotW, py(v)); ctx.stroke();
    };
    for (const k of [-2, -1, 1, 2]) hline(L.centre + k * L.sigma, [2, 4], 0.25);
    hline(L.centre, [], 0.6, 1.5);
    hline(L.ucl, [6, 4], 0.85); hline(L.lcl, [6, 4], 0.85);
    ctx.restore();
    ctx.fillStyle = theme.textMuted; ctx.font = `${fontPx(-1)}px system-ui, sans-serif`; ctx.textAlign = 'right'; ctx.textBaseline = 'bottom';
    const fmtY = (v: number) => fmt(v, resolved!.y!.unit);
    ctx.fillText(`UCL ${fmtY(L.ucl)}`, LEFT + plotW - 4, py(L.ucl) - 2);
    ctx.textBaseline = 'top';
    ctx.fillText(`LCL ${fmtY(L.lcl)}`, LEFT + plotW - 4, py(L.lcl) + 2);
    ctx.textBaseline = 'bottom';
    ctx.fillText(`Centre ${fmtY(L.centre)}`, LEFT + plotW - 4, py(L.centre) - 2);
    // The baseline's end, when the limits come from the first points only.
    if (L.baseline < m.values.length) {
      const bx = (px(L.baseline - 1) + px(L.baseline)) / 2;
      ctx.save(); ctx.strokeStyle = theme.textMuted; ctx.setLineDash([2, 3]); ctx.beginPath(); ctx.moveTo(bx, TOP); ctx.lineTo(bx, TOP + plotH); ctx.stroke(); ctx.restore();
      ctx.textAlign = 'left'; ctx.textBaseline = 'top'; ctx.fillText('limits from here ←', LEFT + 4, TOP + 2);
    }
    // The values joined in order; a point breaking a rule in the error colour, its rule numbers above it.
    ctx.strokeStyle = colorOf(0); ctx.lineWidth = 1.5; ctx.setLineDash([]);
    ctx.beginPath(); m.values.forEach((v, k) => { if (k === 0) ctx.moveTo(px(k), py(v)); else ctx.lineTo(px(k), py(v)); }); ctx.stroke();
    const broken = new Map(m.violations.map(v => [v.index, v.rules]));
    drawn = [];
    m.values.forEach((v, k) => {
      const rules = broken.get(k);
      ctx.beginPath(); ctx.arc(px(k), py(v), rules ? 4.5 : 3, 0, Math.PI * 2);
      ctx.fillStyle = rules ? theme.alert : colorOf(0); ctx.fill();
      if (rules) { ctx.fillStyle = theme.alert; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom'; ctx.fillText(rules.join(','), px(k), py(v) - 6); }
      drawn.push({ p: { x: m.xs[k], y: v, group: 0, item: m.items[k] }, cx: px(k), cy: py(v) });
    });
    const hot = hovered ? drawn.find(d => d.p === hovered) : undefined;
    if (hot) { ctx.beginPath(); ctx.arc(hot.cx, hot.cy, 6, 0, Math.PI * 2); ctx.lineWidth = 2; ctx.strokeStyle = theme.text; ctx.stroke(); }
  }

  function describeControlPoint(p: PlotPoint): string {
    const r = resolved!;
    const m = r.marks as Extract<NonNullable<typeof r.marks>, { type: 'control' }>;
    const k = m.items.indexOf(p.item);
    const z = (p.y - m.limits.centre) / m.limits.sigma;
    const rules = m.violations.find(v => v.index === k)?.rules;
    return `<strong>${escHtml(options.waferLabel(p.item))}</strong><br>`
      + escHtml(`${r.y!.label}: ${fmt(p.y, r.y!.unit)} (${z >= 0 ? '+' : '−'}${Math.abs(z).toFixed(1)}σ)`)
      + (rules ? `<br>${escHtml(`breaks rule ${rules.map(n => `${n} (${CONTROL_RULE_TEXT[n]})`).join(', ')}`)}` : '')
      + (options.onOpenWafer ? `<br><em>click to ${escHtml(options.openActionLabel ?? 'open this wafer')}</em>` : '');
  }

  // ── goal plot ──
  function drawGoal(): void {
    const m = resolved?.marks;
    if (!resolved || !canvas || !resolved.x || !resolved.y || m?.type !== 'goal') return;
    applyCanvasFlow(canvas, above ?? 0);
    const theme = resolveChartCanvasColors(card);
    const { w, h, plotW, plotH } = dims();
    const prep = prepareCanvas(canvas, card, w, h);
    if (!prep) return;
    const { ctx } = prep;
    // Symmetric about a centred mean, from zero spread, wide enough for the Ppk 1 triangle.
    const reach = Math.max(0.5, ...m.points.map(p => Math.abs(p.x)));
    const x = makeScale([-reach, reach], { ...resolved.x, min: resolved.x.min ?? -reach * 1.05, max: resolved.x.max ?? reach * 1.05 });
    const y = makeScale([0, ...m.points.map(p => p.y), 1 / 6], { ...resolved.y, min: resolved.y.min ?? 0 }, { floorAtZero: true });
    geometry = { x, y, plotW, plotH };
    drawFrame(ctx, theme, w, h, plotW, plotH, x, y, resolved.x, resolved.y);
    const px = (v: number) => LEFT + x.frac(v) * plotW, py = (v: number) => TOP + (1 - y.frac(v)) * plotH;
    ctx.save();
    ctx.beginPath(); ctx.rect(LEFT, TOP, plotW, plotH); ctx.clip();
    ctx.font = `${fontPx(-1)}px system-ui, sans-serif`;
    const contours: Array<[number, number[]]> = [[1, [6, 4]], [1.33, []]];
    for (const [ppk, dash] of contours) {
      const apex = 1 / (6 * ppk);
      ctx.strokeStyle = theme.textMuted; ctx.lineWidth = 1; ctx.setLineDash(dash);
      ctx.beginPath(); ctx.moveTo(px(-0.5), py(0)); ctx.lineTo(px(0), py(apex)); ctx.lineTo(px(0.5), py(0)); ctx.stroke();
      ctx.fillStyle = theme.textMuted; ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
      ctx.fillText(`Ppk ${ppk}`, px(0) + 4, py(apex) - 2);
    }
    ctx.restore();
    drawn = [];
    for (const p of m.points) {
      if (active.size > 0 && !active.has(p.group)) continue;
      ctx.beginPath(); ctx.arc(px(p.x), py(p.y), 4, 0, Math.PI * 2); ctx.fillStyle = colorOf(p.group); ctx.fill();
      // The tests short of Ppk 1.33 are named: they are what the plot is read for.
      if (p.ppk < 1.33) { ctx.fillStyle = theme.text; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillText(p.label, px(p.x) + 6, py(p.y)); }
      drawn.push({ p: { x: p.x, y: p.y, group: p.group, item: -1, value: p.testNumber }, cx: px(p.x), cy: py(p.y) });
    }
    const hot = hovered ? drawn.find(d => d.p === hovered) : undefined;
    if (hot) { ctx.beginPath(); ctx.arc(hot.cx, hot.cy, 6, 0, Math.PI * 2); ctx.lineWidth = 2; ctx.strokeStyle = theme.text; ctx.stroke(); }
  }

  function describeGoalPoint(p: PlotPoint): string {
    const r = resolved!;
    const m = r.marks as Extract<NonNullable<typeof r.marks>, { type: 'goal' }>;
    const g = m.points.find(q => q.testNumber === p.value && q.group === p.group);
    if (!g) return '';
    return `<strong>${escHtml(g.label)}</strong>${r.groups.length > 1 ? ` · ${escHtml(groupLabel(g.group))}` : ''}<br>`
      + escHtml(`Ppk ${g.ppk.toFixed(2)} · ${g.n.toLocaleString('en-GB')} dies`) + '<br>'
      + escHtml(`mean ${g.x >= 0 ? '+' : '−'}${Math.abs(g.x * 100).toFixed(1)}% of the window from its centre, σ ${(g.y * 100).toFixed(1)}% of it (${g.basis === 'spec' ? 'spec' : 'test'} limits)`);
  }

  function draw(): void {
    const t = resolved?.marks?.type;
    if (t === 'scatter') drawScatter();
    else if (t === 'control') drawControl();
    else if (t === 'heatmap') drawHeatmap();
    else if (t === 'goal') drawGoal();
    else if (t === 'probability') drawProbability();
    else if (t === 'histogram') drawHistogram();
    else if (t === 'box' || t === 'bar') drawCategorical();
    else if (t === 'line') drawLine();
  }

  function describePoint(p: PlotPoint): string {
    const r = resolved!;
    const wafer = options.waferLabel(p.item);
    const where = p.die && p.die.x !== undefined ? `die (${p.die.x}, ${p.die.y})` : '';
    const head = [wafer, where].filter(Boolean).join(' · ');
    const val = (axis: ResolvedAxis, v: number) => `${axis.label}: ${fmt(v, axis.unit)}`;
    return (head ? `<strong>${escHtml(head)}</strong><br>` : '')
      + escHtml(val(r.x!, p.x)) + '<br>' + escHtml(val(r.y!, p.y))
      + (r.colorScale && p.value !== undefined ? `<br>${escHtml(`${r.colorScale.label}: ${fmt(p.value, r.colorScale.unit)}`)}` : '')
      + (r.groups.length > 1 ? `<br>${escHtml(groupLabel(p.group))}` : '')
      + (options.onOpenWafer ? `<br><em>click to ${escHtml(options.openActionLabel ?? 'open this wafer')}</em>` : '');
  }

  function histogramTip(e: MouseEvent): string | null {
    if (!histogram || !geometry || !resolved?.x) return null;
    const rect = canvas!.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const t = (mx - LEFT) / geometry.plotW;
    if (t < 0 || t > 1) return null;
    const u = geometry.x.reverse ? 1 - t : t;
    const { edges, counts } = histogram;
    const bins = edges.length - 1;
    const b = Math.min(bins - 1, Math.max(0, Math.floor(u * bins)));
    hoveredBin = b;
    const axis = resolved.x;
    const lines = counts.map((c, g) => ({ g, n: c[b] })).filter(r => r.n > 0 && (active.size === 0 || active.has(r.g)));
    return `<strong>${escHtml(`${fmt(edges[b], axis.unit)} to ${fmt(edges[b + 1], axis.unit)}`)}</strong><br>`
      + (lines.length ? lines.map(r => {
        const share = resolved!.spec.histNorm === 'percent' ? ` (${histogram!.heights[r.g][b].toFixed(1)}% of ${resolved!.groups.length > 1 ? 'its colour' : 'them'})` : '';
        return escHtml(`${resolved!.groups.length > 1 ? `${groupLabel(r.g)}: ` : ''}${r.n.toLocaleString('en-GB')} ${resolved!.level === 'die' ? 'dies' : 'wafers'}${share}`);
      }).join('<br>') : 'none');
  }

  /** The key to a continuous colour: its name, a gradient strip, and the range the strip spans. */
  function colorbar(scale: NonNullable<ResolvedPlot['colorScale']>): HTMLElement {
    const row = doc.createElement('div');
    row.dataset.wmapPlotColorbar = '1';
    Object.assign(row.style, { display: 'flex', alignItems: 'center', gap: SPACE.md, marginTop: SPACE.md, marginBottom: SPACE.xl, fontSize: FONT.body, color: CLR.label } as Partial<CSSStyleDeclaration>);
    const strip = doc.createElement('canvas');
    strip.width = 200; strip.height = 10;
    Object.assign(strip.style, { width: '200px', height: '10px', borderRadius: RADIUS.control, flex: '0 0 auto' } as Partial<CSSStyleDeclaration>);
    const g = strip.getContext('2d');
    const gradient = resolveValueColorFn();
    if (g) for (let i = 0; i < 200; i++) { g.fillStyle = gradient(i / 199); g.fillRect(i, 0, 1, 10); }
    // A heatmap's key reads as its cells do; a scatter's gradient keeps its unit's own scaling.
    const text = (v: number) => (resolved?.marks?.type === 'heatmap' ? cellText(v, scale.unit, scale.integer) : fmt(v, scale.unit));
    const lo = doc.createElement('span'); lo.textContent = text(scale.lo);
    const hi = doc.createElement('span'); hi.textContent = text(scale.hi);
    const name = doc.createElement('span'); name.textContent = scale.label;
    name.style.color = CLR.text;
    row.append(name, lo, strip, hi);
    return row;
  }

  /** The marks' units as points a selection can carry: the wafer each is on and, for a die, the die. */
  const unitPoints = (unit: (u: number) => { item: number; die?: PlotPoint['die'] }, units: readonly number[], group: number): PlotPoint[] =>
    units.map(u => { const { item, die } = unit(u); return { x: 0, y: 0, group, item, die }; });

  function rebuild(): void {
    pointer?.destroy(); pointer = undefined;
    body.innerHTML = '';
    canvas = undefined; legend = undefined; above = undefined; chips = []; hovered = null; hoveredBin = -1; drawn = []; geometry = undefined;
    cat = undefined; hoveredCell = null; heat = undefined; hoveredHeat = null; lineX = []; hoveredLine = -1; bottomMargin = BOTTOM; probabilityPoints = new Map();
    active.clear(); selected.clear();
    for (const p of panels) p.destroy();
    panels = [];
    setPngCanvas(() => card.querySelector<HTMLCanvasElement>('canvas'));
    const r = resolved;
    // A plot of panels is as tall as its grid: the card is not a flex item filled by one canvas (with no canvas to size
    // it, a zero basis collapses it to its heading), and in a grid of cards it takes the whole row, where a column
    // would squeeze the panels into one and stretch every card beside it to their height.
    const paneled = !!r?.facets && !options.panel;
    card.style.flex = paneled ? '0 0 auto' : '1 1 0px';
    card.style.gridColumn = paneled ? '1 / -1' : '';
    if (!r) return;
    heading.textContent = options.panel ? options.panel.title : plotTitle(r);
    card.dataset.wmapChartTitle = heading.textContent;

    if (r.issues.length || !r.marks) {
      for (const issue of r.issues) renderEmptyState(body, issue);
      return;
    }
    const hint = doc.createElement('div');
    Object.assign(hint.style, { color: CLR.label, fontSize: FONT.body, marginBottom: SPACE.xs } as Partial<CSSStyleDeclaration>);
    const open = options.openActionLabel ?? 'open this wafer';
    const interact = r.marks.type === 'scatter'
      ? (options.onOpenWafer ? ` · click a point to ${open}` : '') + (options.onSelectPoints ? ` · drag to select ${r.level === 'die' ? 'dies' : 'wafers'}` : '')
      : (r.marks.type === 'box' || r.marks.type === 'bar') ? (options.onOpenWafer && r.marks.categoryItems ? ` · click to ${open}` : options.onSelectPoints ? ' · click to chart or tabulate what it counts' : '')
        + (r.marks.type === 'box' ? ' · box: quartiles; whiskers: minimum and maximum' : '')
      : r.marks.type === 'histogram' && options.onSelectPoints ? ' · click a bar to chart or tabulate its dies'
      : r.marks.type === 'probability' ? (options.onOpenWafer ? ` · click a point to ${open}` : '') + (options.onSelectPoints ? ` · drag to select ${r.level === 'die' ? 'dies' : 'wafers'}` : '')
      : r.marks.type === 'line' && options.onSelectPoints ? ' · click a point to chart or tabulate what it averages'
      : '';
    // A panel says only how much of the population it holds; the grid's statement covers the rest.
    hint.textContent = options.panel
      ? `${r.population.wafers.toLocaleString('en-GB')} wafer${r.population.wafers === 1 ? '' : 's'} · ${r.population.dies.toLocaleString('en-GB')} dies`
      : plotFootnote(r) + (r.facets ? '' : interact);
    markNoPrint(hint);   // on paper the card's print block says this, without the instructions to click
    above = doc.createElement('div');
    above.style.display = 'flow-root';   // keeps the legend's margin inside, so the canvas starts below it
    body.appendChild(above);
    above.appendChild(hint);
    // Each fitted line in words: its equation, R² and n.
    for (const line of r.fitNotes ?? []) {
      const n = doc.createElement('div');
      n.dataset.wmapPlotFit = '1';
      n.textContent = line;
      Object.assign(n.style, { color: CLR.text, fontSize: FONT.body, marginBottom: SPACE.xxs, fontVariantNumeric: 'tabular-nums' } as Partial<CSSStyleDeclaration>);
      above.appendChild(n);
    }
    for (const note of r.notes) {
      const n = doc.createElement('div');
      markNoPrint(n);
      n.textContent = note;
      Object.assign(n.style, { color: CLR.warnText, fontSize: FONT.body, marginBottom: SPACE.xs } as Partial<CSSStyleDeclaration>);
      above.appendChild(n);
    }
    if (r.plotted === 0) { renderEmptyState(body, 'Nothing to plot: no mark has every value this plot needs.'); return; }

    if (r.groups.length > 1 && !options.panel) {
      legend = doc.createElement('div');
      Object.assign(legend.style, { display: 'flex', flexWrap: 'wrap', gap: SPACE.sm, marginTop: SPACE.md, marginBottom: SPACE.xl } as Partial<CSSStyleDeclaration>);
      r.groups.forEach((g, i) => {
        const chip = makeSeriesLegendItem(g || '(none)', colorOf(i), doc);
        attachChartTip(chip.el, card, tooltip, `${g || '(none)'} — click to filter`);
        chip.el.addEventListener('click', () => {
          if (active.has(i)) active.delete(i); else active.add(i);
          chips.forEach((c, k) => c.setState({ selected: active.has(k), dimmed: active.size > 0 && !active.has(k) }));
          if (panels.length) for (const p of panels) p.setActiveGroups(active); else draw();
        });
        chips.push(chip);
        legend!.appendChild(chip.el);
      });
      above.appendChild(legend);
    }

    if (r.colorScale && !options.panel) {
      legend = colorbar(r.colorScale);
      above.appendChild(legend);
    }

    // A faceted plot: a grid of panels, one chart each, sharing this card's statement, legend and Save as PNG.
    if (r.facets) {
      const grid = doc.createElement('div');
      grid.dataset.wmapPlotPanels = '1';
      Object.assign(grid.style, { display: 'grid', gridTemplateColumns: `repeat(auto-fill, minmax(${PANEL_MIN_PX}px, 1fr))`, gap: SPACE.md } as Partial<CSSStyleDeclaration>);
      body.appendChild(grid);
      for (const f of r.facets) {
        const p = renderPlotChart({ ...options, panel: { title: f.label } });
        grid.appendChild(p.card);
        p.setPlot(f.plot);
        panels.push(p);
      }
      setPngCanvas(() => composePanels(grid));
      return;
    }

    canvas = doc.createElement('canvas');
    canvas.style.display = 'block';
    canvas.style.cursor = r.marks.type === 'scatter' || r.marks.type === 'probability' ? 'crosshair' : 'default';
    body.appendChild(canvas);

    if (r.marks.type === 'scatter') {
      const sc = r.marks;
      const selectable = !!options.onSelectPoints;
      pointer = wirePointInteractions<PlotPoint>({
        card, canvas, tooltip,
        drawn: () => drawn,
        describe: describePoint,
        clickable: () => !!options.onOpenWafer,
        onOpen: p => options.onOpenWafer?.(p.item, plotTestNumber(r.spec)),
        onHover: p => { hovered = p; draw(); },
        select: selectable ? {
          pick: ({ x0, y0, x1, y1 }) => {
            if (!geometry) return [];
            const pool = active.size === 0 ? sc.points : sc.points.filter(p => active.has(p.group));
            return pool.filter(p => {
              const cx = LEFT + geometry!.x.frac(p.x) * geometry!.plotW;
              const cy = TOP + (1 - geometry!.y.frac(p.y)) * geometry!.plotH;
              return cx >= x0 && cx <= x1 && cy >= y0 && cy <= y1;
            });
          },
          onPicked: (picked, at) => {
            selected.clear();
            for (const p of picked) selected.add(p);
            draw();
            if (picked.length > 0) options.onSelectPoints!(picked, at, canvas!);
          },
          onClear: () => { selected.clear(); draw(); },
          hasSelection: () => selected.size > 0,
        } : undefined,
      });
    } else if (r.marks.type === 'control' || r.marks.type === 'goal') {
      const control = r.marks.type === 'control';
      pointer = wirePointInteractions<PlotPoint>({
        card, canvas, tooltip,
        drawn: () => drawn,
        describe: control ? describeControlPoint : describeGoalPoint,
        clickable: () => control && !!options.onOpenWafer,
        onOpen: p => { if (control) options.onOpenWafer?.(p.item, plotTestNumber(r.spec)); },
        onHover: p => { hovered = p; draw(); },
      });
    } else if (r.marks.type === 'probability') {
      const pm = r.marks;
      const linear = r.spec.probabilityAxis === 'linear';
      pointer = wirePointInteractions<PlotPoint>({
        card, canvas, tooltip,
        drawn: () => drawn,
        describe: describeProbabilityPoint,
        clickable: () => !!options.onOpenWafer,
        onOpen: p => options.onOpenWafer?.(p.item, plotTestNumber(r.spec)),
        onHover: p => { hovered = p; draw(); },
        select: options.onSelectPoints ? {
          // Every unit inside the box, not only the points drawn: a sampled curve still selects all the dies it stands for.
          pick: ({ x0, y0, x1, y1 }) => {
            if (!geometry) return [];
            const out: PlotPoint[] = [];
            pm.values.forEach((vs, g) => {
              if (active.size > 0 && !active.has(g)) return;
              vs.forEach((v, k) => {
                const share = probabilityPosition(k, vs.length);
                const cx = LEFT + geometry!.x.frac(v) * geometry!.plotW;
                const cy = TOP + (1 - geometry!.y.frac(linear ? share : normalQuantile(share))) * geometry!.plotH;
                if (cx < x0 || cx > x1 || cy < y0 || cy > y1) return;
                const { item, die } = pm.unit(pm.units[g][k]);
                out.push({ x: v, y: share, group: g, item, die });
              });
            });
            return out;
          },
          onPicked: (picked, at) => { if (picked.length > 0) options.onSelectPoints!(picked, at, canvas!); },
          onClear: () => {},
          hasSelection: () => false,
        } : undefined,
      });
    } else if (r.marks.type === 'histogram') {
      buildHistogram();
      canvas.addEventListener('mousemove', e => {
        const html = histogramTip(e);
        if (!html) { tooltip.style.display = 'none'; if (hoveredBin >= 0) { hoveredBin = -1; draw(); } return; }
        tooltip.innerHTML = html;
        tooltip.style.display = 'block';
        positionChartTooltip(tooltip, card, e.clientX, e.clientY);
        draw();
      });
      canvas.addEventListener('mouseleave', () => { tooltip.style.display = 'none'; if (hoveredBin >= 0) { hoveredBin = -1; draw(); } });
      const hm = r.marks;
      if (options.onSelectPoints) {
        canvas.style.cursor = 'pointer';
        canvas.addEventListener('click', e => {
          if (!histogram || histogramTip(e) === null) return;
          const b = hoveredBin;
          const { edges } = histogram;
          const log = geometry?.x.log;
          const tLo = log ? Math.log10(edges[0]) : edges[0], tHi = log ? Math.log10(edges[edges.length - 1]) : edges[edges.length - 1];
          const bins = edges.length - 1;
          const points: PlotPoint[] = [];
          hm.values.forEach((vs, g) => {
            if (active.size > 0 && !active.has(g)) return;
            const inBin: number[] = [];
            vs.forEach((v, k) => {
              const t = log ? (v > 0 ? Math.log10(v) : NaN) : v;
              if (!Number.isFinite(t) || t < tLo || t > tHi) return;
              if (Math.min(bins - 1, Math.floor(((t - tLo) / (tHi - tLo)) * bins)) === b) inBin.push(hm.units[g][k]);
            });
            points.push(...unitPoints(hm.unit, inBin, g));
          });
          if (points.length > 0) { tooltip.style.display = 'none'; options.onSelectPoints!(points, { x: e.clientX, y: e.clientY }, canvas!); }
        });
      }
    } else if (r.marks.type === 'heatmap') {
      const hm = r.marks;
      canvas.addEventListener('mousemove', e => {
        const cell = heatAt(e);
        canvas!.style.cursor = cell && options.onSelectPoints && hm.cellUnits[cell.r][cell.c].length ? 'pointer' : 'default';
        if (!cell) { tooltip.style.display = 'none'; if (hoveredHeat) { hoveredHeat = null; draw(); } return; }
        tooltip.innerHTML = heatTip(cell);
        tooltip.style.display = 'block';
        positionChartTooltip(tooltip, card, e.clientX, e.clientY);
        if (!hoveredHeat || hoveredHeat.r !== cell.r || hoveredHeat.c !== cell.c) { hoveredHeat = cell; draw(); }
      });
      canvas.addEventListener('mouseleave', () => { tooltip.style.display = 'none'; if (hoveredHeat) { hoveredHeat = null; draw(); } });
      canvas.addEventListener('click', e => {
        const cell = heatAt(e);
        if (!cell || !options.onSelectPoints) return;
        const units = hm.cellUnits[cell.r][cell.c];
        if (units.length) { tooltip.style.display = 'none'; options.onSelectPoints(unitPoints(hm.unit, units, 0), { x: e.clientX, y: e.clientY }, canvas!); }
      });
    } else if (r.marks.type === 'box' || r.marks.type === 'bar') {
      const cm = r.marks;
      canvas.addEventListener('mousemove', e => {
        const cell = cellAt(e);
        canvas!.style.cursor = cell && ((cm.categoryItems && options.onOpenWafer) || (options.onSelectPoints && cm.cellUnits[cell.g][cell.c].length > 0)) ? 'pointer' : 'default';
        if (!cell) { tooltip.style.display = 'none'; if (hoveredCell) { hoveredCell = null; draw(); } return; }
        tooltip.innerHTML = cellTip(cell);
        tooltip.style.display = 'block';
        positionChartTooltip(tooltip, card, e.clientX, e.clientY);
        if (!hoveredCell || hoveredCell.g !== cell.g || hoveredCell.c !== cell.c) { hoveredCell = cell; draw(); }
      });
      canvas.addEventListener('mouseleave', () => { tooltip.style.display = 'none'; if (hoveredCell) { hoveredCell = null; draw(); } });
      canvas.addEventListener('click', e => {
        const cell = cellAt(e);
        if (!cell) return;
        const item = cm.categoryItems?.[cell.c];
        // A wafer's own bar or box opens that wafer; any other cell picks out what it counts.
        if (item !== undefined && item >= 0 && options.onOpenWafer) { options.onOpenWafer(item, plotTestNumber(r.spec)); return; }
        const units = cm.cellUnits[cell.g][cell.c];
        if (units.length > 0 && options.onSelectPoints) {
          tooltip.style.display = 'none';
          options.onSelectPoints(unitPoints(cm.unit, units, cell.g), { x: e.clientX, y: e.clientY }, canvas!);
        }
      });
    } else if (r.marks.type === 'line') {
      canvas.addEventListener('mousemove', e => {
        const html = lineTip(e);
        if (!html) { tooltip.style.display = 'none'; draw(); return; }
        tooltip.innerHTML = html;
        tooltip.style.display = 'block';
        positionChartTooltip(tooltip, card, e.clientX, e.clientY);
        draw();
      });
      canvas.addEventListener('mouseleave', () => { tooltip.style.display = 'none'; if (hoveredLine >= 0) { hoveredLine = -1; draw(); } });
      const lm = r.marks;
      if (options.onSelectPoints) {
        canvas.style.cursor = 'pointer';
        canvas.addEventListener('click', e => {
          if (lineTip(e) === null || hoveredLine < 0) return;
          const points = lm.cellUnits.flatMap((perX, g) => (active.size > 0 && !active.has(g) ? [] : unitPoints(lm.unit, perX[hoveredLine] ?? [], g)));
          if (points.length > 0) { tooltip.style.display = 'none'; options.onSelectPoints!(points, { x: e.clientX, y: e.clientY }, canvas!); }
        });
      }
    }
    draw();
  }

  // A saved image carries what the card says around the canvas: the population, the colour key.
  setPngDecor(() => {
    const r = resolved;
    if (!r || !r.marks) return undefined;
    const gradient = resolveValueColorFn();
    return {
      caption: [plotFootnote(r), ...(r.fitNotes ?? []), ...r.notes],
      legend: r.groups.length > 1 ? r.groups.map((g, i) => ({ label: g || '(none)', color: colorOf(i) })) : undefined,
      colorbar: r.colorScale ? { label: r.colorScale.label, lo: fmt(r.colorScale.lo, r.colorScale.unit), hi: fmt(r.colorScale.hi, r.colorScale.unit), color: gradient } : undefined,
    };
  });

  const resizeHandle = observeResize(card, () => draw());

  return {
    card,
    actions: controlsRow,
    setPlot(next) { resolved = next; rebuild(); },
    setActiveGroups(groups) {
      active.clear();
      for (const g of groups) active.add(g);
      draw();
    },
    destroy() { resizeHandle.disconnect(); pointer?.destroy(); for (const p of panels) p.destroy(); },
  };
}
