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
import { fiveNumberSummary } from '../../stats/math.js';
import { fmt } from '../../renderer/fmt.js';
import { fitTicks } from '../../renderer/axisTicks.js';
import { plotFootnote, plotTestNumber, plotTitle, type PlotPoint, type ResolvedAxis, type ResolvedPlot } from '../../stats/plotData.js';
import { SPACE, fontPx, FONT, CLR, markNoPrint } from '../toolbar.js';
import {
  cardShell, observeResize, makeTooltip, attachChartTip, chartFillHeight, applyCanvasFlow, prepareCanvas, positionChartTooltip,
  resolveChartCanvasColors, makeAxisFormat, horizontalTickSpacing, VERTICAL_TICK_SPACING_PX, makeSeriesLegendItem,
  renderEmptyState, type SaveImageHandler, type SeriesLegendItem,
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
}

export interface PlotChartHandle {
  card: HTMLElement;
  /** The row under the title, for the host's own buttons (Edit, Duplicate, Delete). */
  actions: HTMLElement;
  /** Draw `resolved`, replacing whatever was shown. */
  setPlot(resolved: ResolvedPlot): void;
  destroy(): void;
}

interface Scale {
  lo: number;
  hi: number;
  log: boolean;
  reverse: boolean;
  /** Position along the axis, 0 at the start edge to 1 at the end edge, reversal applied. */
  frac(v: number): number;
}

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
  const { card, heading, body, controlsRow, setPngDecor } = cardShell('Plot', options.onSaveImage, doc);
  card.dataset.wmapPlotCard = '1';
  const tooltip = makeTooltip(card);

  let resolved: ResolvedPlot | undefined;
  let canvas: HTMLCanvasElement | undefined;
  let legend: HTMLElement | undefined;
  let pointer: { destroy: () => void } | undefined;
  let chips: SeriesLegendItem[] = [];
  const active = new Set<number>();          // legend filter: group indexes, empty = all
  const selected = new Set<PlotPoint>();
  let hovered: PlotPoint | null = null;
  let hoveredBin = -1;
  let drawn: Array<DrawnPoint<PlotPoint>> = [];
  let geometry: { x: Scale; y: Scale; plotW: number; plotH: number } | undefined;
  let histogram: { edges: number[]; counts: number[][]; maxCount: number } | undefined;
  /** Where the cells of a box or bar plot were drawn, for hover and click. */
  let cat: { slotW: number; gw: number; n: number; groups: number; plotW: number } | undefined;
  let hoveredCell: { g: number; c: number } | null = null;
  /** Where the points of a line plot were drawn: the x position of each distinct x, for hover. */
  let lineX: number[] = [];
  let hoveredLine = -1;

  let bottomMargin = BOTTOM;
  const colorOf = (g: number): string => categorical(g);
  const groupLabel = (g: number): string => resolved?.groups[g] || '';

  function dims(): { w: number; h: number; plotW: number; plotH: number } {
    const w = body.clientWidth;
    const gridH = Math.max(220, Math.min(420, w * 0.62)) + (bottomMargin - BOTTOM);
    const h = chartFillHeight(card, body, canvas!, gridH);
    return { w, h, plotW: Math.max(10, w - LEFT - RIGHT), plotH: Math.max(10, h - TOP - bottomMargin) };
  }

  function unitFormat(axis: ResolvedAxis, lo: number, hi: number, step?: number) {
    return makeAxisFormat(Math.max(Math.abs(lo), Math.abs(hi)), axis.unit, step);
  }

  function axisTitle(axis: ResolvedAxis, unitLabel: string): string {
    return unitLabel ? `${axis.label} (${unitLabel})` : axis.label;
  }

  /** The x axis of a box or bar plot: one slot per category, labelled (slanted when they would not fit flat). */
  interface CategoryAxis { labels: string[]; rotate: boolean }

  function drawFrame(ctx: CanvasRenderingContext2D, theme: ReturnType<typeof resolveChartCanvasColors>, w: number, h: number,
    plotW: number, plotH: number, x: Scale | CategoryAxis, y: Scale, xAxis: ResolvedAxis, yAxis: ResolvedAxis): void {
    ctx.font = `${fontPx(-1)}px system-ui, sans-serif`;
    const ySpacing = () => VERTICAL_TICK_SPACING_PX;
    const yTicksFit = y.log ? logTicks(y.lo, y.hi, plotH, ySpacing) : fitTicks(y.lo, y.hi, plotH, ySpacing);
    const yFmt = unitFormat(yAxis, y.lo, y.hi, yTicksFit.step || undefined);
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
    applyCanvasFlow(canvas, legend ?? 0);
    const theme = resolveChartCanvasColors(card);
    const { w, h, plotW, plotH } = dims();
    const prep = prepareCanvas(canvas, card, w, h);
    if (!prep) return;
    const { ctx } = prep;
    const all = resolved.marks.points;
    const visible = active.size === 0 ? all : all.filter(p => active.has(p.group));
    const scale = resolved.colorScale;
    const gradient = resolveValueColorFn();
    const x = makeScale(all.map(p => p.x), resolved.x);
    const y = makeScale(all.map(p => p.y), resolved.y);
    geometry = { x, y, plotW, plotH };
    drawFrame(ctx, theme, w, h, plotW, plotH, x, y, resolved.x, resolved.y);

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
    const x = makeScale(flat, resolved.x);
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
    histogram = { edges, counts, maxCount: Math.max(1, ...counts.map(c => maxOf(c))) };
  }

  function drawHistogram(): void {
    if (!resolved || !canvas || !histogram || !resolved.x || !resolved.y) return;
    applyCanvasFlow(canvas, legend ?? 0);
    const theme = resolveChartCanvasColors(card);
    const { w, h, plotW, plotH } = dims();
    const prep = prepareCanvas(canvas, card, w, h);
    if (!prep) return;
    const { ctx } = prep;
    const { edges, counts, maxCount } = histogram;
    const x = makeScale([edges[0], edges[edges.length - 1]], { ...resolved.x, min: edges[0], max: edges[edges.length - 1] });
    const y = makeScale([0, maxCount], { label: resolved.y.label, scale: 'linear', min: 0, max: maxCount * 1.05 });
    geometry = { x, y, plotW, plotH };
    drawFrame(ctx, theme, w, h, plotW, plotH, x, y, resolved.x, resolved.y);
    const groups = counts.map((_, g) => g).filter(g => active.size === 0 || active.has(g));
    const overlay = groups.length > 1;
    for (const g of groups) {
      ctx.globalAlpha = overlay ? 0.55 : 0.85;
      ctx.fillStyle = colorOf(g);
      counts[g].forEach((n, b) => {
        if (n === 0) return;
        const x0 = LEFT + Math.min(x.frac(edges[b]), x.frac(edges[b + 1])) * plotW;
        const x1 = LEFT + Math.max(x.frac(edges[b]), x.frac(edges[b + 1])) * plotW;
        const top = TOP + (1 - y.frac(n)) * plotH;
        ctx.fillRect(x0, top, Math.max(1, x1 - x0 - 1), TOP + plotH - top);
      });
    }
    ctx.globalAlpha = 1;
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
    applyCanvasFlow(canvas, legend ?? 0);
    const theme = resolveChartCanvasColors(card);
    // Slant the labels when flat ones would collide. Measured before the canvas is sized, since it sets the margin.
    const probe = canvas.getContext('2d');
    let widest = 0;
    if (probe) {
      probe.font = `${fontPx(-1)}px system-ui, sans-serif`;
      widest = maxOf(m.categories.map(c => probe.measureText(c.length > 22 ? `${c.slice(0, 21)}…` : c).width));
    }
    const slot = Math.max(10, body.clientWidth - LEFT - RIGHT) / Math.max(1, m.categories.length);
    const rotate = widest + 8 > slot;
    bottomMargin = rotate ? BOTTOM + Math.min(110, widest * 0.72) : BOTTOM;
    const { w, h, plotW, plotH } = dims();
    const prep = prepareCanvas(canvas, card, w, h);
    if (!prep) return;
    const { ctx } = prep;

    const finite = (a: number[]) => a.filter(Number.isFinite);
    const y = makeScale(m.type === 'bar' ? [...finite(m.values.flat()), 0] : finite(m.cells.flat(2)), resolved.y, { floorAtZero: m.type === 'bar' });
    geometry = { x: y, y, plotW, plotH };   // only plotW/plotH are read for these marks
    drawFrame(ctx, theme, w, h, plotW, plotH, { labels: m.categories, rotate }, y, resolved.x, resolved.y);

    const n = m.categories.length, groups = resolved.groups.length;
    const slotW = plotW / n, gw = (slotW * 0.8) / groups;
    cat = { slotW, gw, n, groups, plotW };
    const baseY = y.log ? TOP + plotH : TOP + (1 - y.frac(0)) * plotH;
    for (let g = 0; g < groups; g++) {
      if (active.size > 0 && !active.has(g)) continue;
      const color = colorOf(g);
      for (let c = 0; c < n; c++) {
        const x0 = LEFT + c * slotW + slotW * 0.1 + g * gw;
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
    if (hoveredCell) {
      const x0 = LEFT + hoveredCell.c * slotW + slotW * 0.1 + hoveredCell.g * gw;
      ctx.lineWidth = 1.5; ctx.strokeStyle = theme.text;
      ctx.strokeRect(x0, TOP, gw, plotH);
    }
  }

  function cellAt(e: MouseEvent): { g: number; c: number } | null {
    if (!cat || !canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left - LEFT;
    if (mx < 0 || mx > cat.plotW) return null;
    const c = Math.min(cat.n - 1, Math.floor(mx / cat.slotW));
    const g = Math.floor((mx - c * cat.slotW - cat.slotW * 0.1) / cat.gw);
    if (g < 0 || g >= cat.groups) return null;
    return { g, c };
  }

  function cellTip(cell: { g: number; c: number }): string {
    const r = resolved!;
    const m = r.marks as Extract<NonNullable<typeof r.marks>, { type: 'box' | 'bar' }>;
    const noun = r.level === 'die' ? 'dies' : 'wafers';
    const values = m.cells[cell.g][cell.c];
    const head = `<strong>${escHtml(m.categories[cell.c])}${r.groups.length > 1 ? ` · ${escHtml(groupLabel(cell.g))}` : ''}</strong><br>`;
    const unit = r.y?.unit;
    if (values.length === 0) return `${head}no ${noun}`;
    const n = `${values.length.toLocaleString('en-GB')} ${noun}`;
    const open = m.categoryItems && options.onOpenWafer ? `<br><em>click to ${escHtml(options.openActionLabel ?? 'open this wafer')}</em>` : '';
    if (m.type === 'bar') {
      const v = m.values[cell.g][cell.c];
      return `${head}${escHtml(`${r.y!.label}: ${fmt(v, unit)}`)}<br>${escHtml(n)}${open}`;
    }
    const q = fiveNumberSummary(Float64Array.from(values));
    return `${head}${(['max', 'q3', 'median', 'q1', 'min'] as const).map(k => escHtml(`${{ max: 'max', q3: 'upper quartile', median: 'median', q1: 'lower quartile', min: 'min' }[k]}: ${fmt(q[k], unit)}`)).join('<br>')}<br>${escHtml(n)}${open}`;
  }

  // ── line ──
  function drawLine(): void {
    const m = resolved?.marks;
    if (!resolved || !canvas || !resolved.x || !resolved.y || !m || m.type !== 'line') return;
    applyCanvasFlow(canvas, legend ?? 0);
    const theme = resolveChartCanvasColors(card);
    const { w, h, plotW, plotH } = dims();
    const prep = prepareCanvas(canvas, card, w, h);
    if (!prep) return;
    const { ctx } = prep;
    const x = makeScale(m.xs, resolved.x);
    const y = makeScale(m.values.flat().filter(Number.isFinite), resolved.y);
    geometry = { x, y, plotW, plotH };
    drawFrame(ctx, theme, w, h, plotW, plotH, x, y, resolved.x, resolved.y);
    lineX = m.xs.map(v => LEFT + x.frac(v) * plotW);
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
      + rows.map(r => escHtml(`${resolved!.groups.length > 1 ? `${groupLabel(r.g)}: ` : ''}${fmt(r.v, resolved!.y!.unit)} (${r.n.toLocaleString('en-GB')} ${noun})`)).join('<br>');
  }

  function draw(): void {
    const t = resolved?.marks?.type;
    if (t === 'scatter') drawScatter();
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
      + (lines.length ? lines.map(r => escHtml(`${resolved!.groups.length > 1 ? `${groupLabel(r.g)}: ` : ''}${r.n.toLocaleString('en-GB')} ${resolved!.level === 'die' ? 'dies' : 'wafers'}`)).join('<br>') : 'none');
  }

  /** The key to a continuous colour: its name, a gradient strip, and the range the strip spans. */
  function colorbar(scale: NonNullable<ResolvedPlot['colorScale']>): HTMLElement {
    const row = doc.createElement('div');
    row.dataset.wmapPlotColorbar = '1';
    Object.assign(row.style, { display: 'flex', alignItems: 'center', gap: SPACE.md, marginTop: SPACE.md, marginBottom: SPACE.xl, fontSize: FONT.body, color: CLR.label } as Partial<CSSStyleDeclaration>);
    const strip = doc.createElement('canvas');
    strip.width = 200; strip.height = 10;
    Object.assign(strip.style, { width: '200px', height: '10px', borderRadius: '2px', flex: '0 0 auto' } as Partial<CSSStyleDeclaration>);
    const g = strip.getContext('2d');
    const gradient = resolveValueColorFn();
    if (g) for (let i = 0; i < 200; i++) { g.fillStyle = gradient(i / 199); g.fillRect(i, 0, 1, 10); }
    const lo = doc.createElement('span'); lo.textContent = fmt(scale.lo, scale.unit);
    const hi = doc.createElement('span'); hi.textContent = fmt(scale.hi, scale.unit);
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
    canvas = undefined; legend = undefined; chips = []; hovered = null; hoveredBin = -1; drawn = []; geometry = undefined;
    cat = undefined; hoveredCell = null; lineX = []; hoveredLine = -1; bottomMargin = BOTTOM;
    active.clear(); selected.clear();
    const r = resolved;
    if (!r) return;
    heading.textContent = plotTitle(r);
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
      : r.marks.type === 'line' && options.onSelectPoints ? ' · click a point to chart or tabulate what it averages'
      : '';
    hint.textContent = plotFootnote(r) + interact;
    markNoPrint(hint);   // on paper the card's print block says this, without the instructions to click
    body.appendChild(hint);
    for (const note of r.notes) {
      const n = doc.createElement('div');
      markNoPrint(n);
      n.textContent = note;
      Object.assign(n.style, { color: CLR.warnText, fontSize: FONT.body, marginBottom: SPACE.xs } as Partial<CSSStyleDeclaration>);
      body.appendChild(n);
    }
    if (r.plotted === 0) { renderEmptyState(body, 'Nothing to plot: no mark has every value this plot needs.'); return; }

    if (r.groups.length > 1) {
      legend = doc.createElement('div');
      Object.assign(legend.style, { display: 'flex', flexWrap: 'wrap', gap: SPACE.sm, marginTop: SPACE.md, marginBottom: SPACE.xl } as Partial<CSSStyleDeclaration>);
      r.groups.forEach((g, i) => {
        const chip = makeSeriesLegendItem(g || '(none)', colorOf(i), doc);
        attachChartTip(chip.el, card, tooltip, `${g || '(none)'} — click to filter`);
        chip.el.addEventListener('click', () => {
          if (active.has(i)) active.delete(i); else active.add(i);
          chips.forEach((c, k) => c.setState({ selected: active.has(k), dimmed: active.size > 0 && !active.has(k) }));
          draw();
        });
        chips.push(chip);
        legend!.appendChild(chip.el);
      });
      body.appendChild(legend);
    }

    if (r.colorScale) {
      legend = colorbar(r.colorScale);
      body.appendChild(legend);
    }

    canvas = doc.createElement('canvas');
    canvas.style.display = 'block';
    canvas.style.cursor = r.marks.type === 'scatter' ? 'crosshair' : 'default';
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
      caption: [plotFootnote(r), ...r.notes],
      legend: r.groups.length > 1 ? r.groups.map((g, i) => ({ label: g || '(none)', color: colorOf(i) })) : undefined,
      colorbar: r.colorScale ? { label: r.colorScale.label, lo: fmt(r.colorScale.lo, r.colorScale.unit), hi: fmt(r.colorScale.hi, r.colorScale.unit), color: gradient } : undefined,
    };
  });

  const resizeHandle = observeResize(card, () => draw());

  return {
    card,
    actions: controlsRow,
    setPlot(next) { resolved = next; rebuild(); },
    destroy() { resizeHandle.disconnect(); pointer?.destroy(); },
  };
}
