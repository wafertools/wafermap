// Scatter panel — die-level X/Y scatter for two parametric tests, coloured
// by hard bin with a click-to-filter legend. Returns `{ card, setXY,
// destroy }` so the correlation matrix can update X/Y in place. Ported from
// tsmap's charts/scatter.ts.
//
// Grouping is a fourth distinct pattern (verified by reading the real
// source, not assumed): unlike capability/correlation's restrict-dropdown
// or boxplot's drill-in-place, scatter never restricts — every group's
// points are always plotted together, just coloured by group instead of
// hard bin, with a click-to-filter (not click-to-emphasize) legend.
//
// Trimmed from tsmap's version for this port: legend swatches use the
// native `title` attribute instead of porting tsmap's `attachTooltip` chrome
// helper, matching histogram's same trim.

import { NO_DATA_FILL } from '../../renderer/colorMap.js';
import { maxOf, minOf } from '../../core/utils.js';
import { categorical } from './palette.js';
import { buildScatterData, buildScatterDataGrouped, type ScatterItem, type ScatterPoint } from '../../stats/scatter.js';
import { pearsonOfPairs } from '../../stats/correlation.js';
import { buildFacetTable, type FacetItem } from '../../stats/facets.js';
import type { TestDef } from '../../renderer/buildWaferMap.js';
import { SPACE, RADIUS, fontPx, FONT, CLR } from '../toolbar.js';
import { fitTicks } from '../../renderer/axisTicks.js';
import { cardShell, observeResize, makeTooltip, attachChartTip, makeTestSelect, makeWaferSelect, chartFillHeight, applyCanvasFlow, drawAxisUnit, resolveChartCanvasColors, makeAxisFormat, horizontalTickSpacing, VERTICAL_TICK_SPACING_PX, type SaveImageHandler, makeSeriesLegendItem, type SeriesLegendItem, prepareCanvas } from './chartShell.js';

const SCATTER_LEFT = 52;
const SCATTER_RIGHT = 16;
const SCATTER_TOP = 16;
const SCATTER_BOTTOM = 44;

type ScatterPanelItem = FacetItem & ScatterItem & { label?: string };

export interface ScatterPanelOptions {
  title?: string;
  items: ScatterPanelItem[];
  testDefs: TestDef[];
  xTestNumber?: number;
  yTestNumber?: number;
  /**
   * The host map's resolved hard-bin colours (`View.binColors.hard`), so a
   * point is the colour its die is on the map. Omitted ⇒ points without a
   * group colour take the no-data fill.
   */
  binColors?: ReadonlyMap<number, string>;
  onSaveImage?: SaveImageHandler;
  /**
   * When the Analysis tab's "Group by" is active, every group's points are
   * plotted together (never restricted to one group, unlike capability/
   * correlation) but coloured by group instead of hard bin, with a
   * click-to-filter legend keyed on group instead of bin. `items` above is
   * used to compute the Simpson's-paradox warning when `groups` is absent;
   * ignored for point data when `groups` is provided.
   */
  groups?: { key: string; items: ScatterPanelItem[] }[];
  /** Document to build this panel's DOM into. Default `document` — pass the
   *  host's own `ownerDocument` when the container might live in a
   *  different document (e.g. a gallery card detached into its own popup
   *  window). */
  ownerDocument?: Document;
}

export interface ScatterPanelHandle {
  card: HTMLElement;
  /** Cross-panel link (e.g. from the correlation matrix): switch X/Y in place. */
  setXY: (xTestNumber: number, yTestNumber: number) => void;
  destroy: () => void;
}

export function renderScatterPanel(options: ScatterPanelOptions): ScatterPanelHandle {
  const { title = 'Test scatter', items, testDefs, binColors, onSaveImage, groups } = options;
  const { card, body, controlsRow } = cardShell(title, onSaveImage, options.ownerDocument);

  const testOptions = testDefs.filter((d): d is TestDef & { testNumber: number } => d.testNumber !== undefined);
  const byGroup = !!(groups && groups.length > 0);
  const groupKeys = (groups ?? []).map(g => g.key);
  const groupColorIndex = new Map<string, number>(groupKeys.map((g, i) => [g, i]));

  let activeX = options.xTestNumber ?? testOptions[0]?.testNumber ?? null;
  let activeY = options.yTestNumber ?? testOptions[1]?.testNumber ?? activeX;
  // Only meaningful when ungrouped (scatter never restricts a group — see
  // the file header — so this scope control only applies to the ungrouped
  // "every wafer pooled" case, same as histogram/correlation). Narrowing to
  // one wafer also resolves the Simpson's-paradox warning below, since a
  // single wafer can't be "mixed".
  let activeWaferIndex: number | null = null;
  const currentItems = (): ScatterPanelItem[] =>
    activeWaferIndex !== null ? (items[activeWaferIndex] ? [items[activeWaferIndex]] : []) : items;

  function makeLabeledTestSelect(labelText: string, selected: number | null, onChange: (n: number) => void): { wrap: HTMLElement; select: HTMLElement & { value: string } } {
    const wrap = card.ownerDocument.createElement('label');
    Object.assign(wrap.style, { display: 'inline-flex', alignItems: 'center', gap: SPACE.xs, fontSize: FONT.body, color: CLR.label } as Partial<CSSStyleDeclaration>);
    const lbl = card.ownerDocument.createElement('span');
    lbl.textContent = labelText;
    const select = makeTestSelect(testOptions, selected, onChange, { maxWidth: '180px', emptyText: 'No tests', ownerDocument: card.ownerDocument });
    wrap.append(lbl, select);
    return { wrap, select };
  }

  const { wrap: xWrap, select: xSel } = makeLabeledTestSelect('X:', activeX, n => { activeX = n; rebuildBody(); });
  const { wrap: yWrap, select: ySel } = makeLabeledTestSelect('Y:', activeY, n => { activeY = n; rebuildBody(); });
  controlsRow.append(xWrap, yWrap);
  if (!byGroup && items.length > 1) {
    controlsRow.appendChild(makeWaferSelect(items, activeWaferIndex, i => { activeWaferIndex = i; rebuildBody(); }, { ownerDocument: card.ownerDocument }));
  }

  const warn = card.ownerDocument.createElement('div');
  Object.assign(warn.style, { color: CLR.warnText, background: CLR.warnBg, border: `1px solid ${CLR.warnBorder}`, borderRadius: RADIUS.control, padding: `${SPACE.xs} ${SPACE.md}`, fontSize: FONT.body, marginBottom: SPACE.xs, display: 'none' } as Partial<CSSStyleDeclaration>);
  card.insertBefore(warn, body);

  // Recomputed on every rebuild (not just at construction) — narrowing the
  // new "Wafer:" selector to a single wafer can resolve the mix that
  // triggered this warning, so it must not stay stuck on once shown.
  function syncMixedFieldsWarning(): void {
    const mixedFields = !byGroup ? buildFacetTable(currentItems(), { facetableOnly: true }).filter(f => f.splittable).map(f => f.label) : [];
    if (mixedFields.length > 0) {
      warn.textContent = `⚠ Mixed ${mixedFields.join(', ')} across these points — trends here may be confounded (Simpson's paradox). Use Group by, or the Wafer picker, to narrow to a like-for-like set.`;
      warn.style.display = '';
    } else {
      warn.style.display = 'none';
    }
  }
  syncMixedFieldsWarning();

  const hint = card.ownerDocument.createElement('div');
  Object.assign(hint.style, { color: CLR.label, fontSize: FONT.body, marginBottom: SPACE.xs } as Partial<CSSStyleDeclaration>);
  card.insertBefore(hint, body);

  /**
   * Strength of the displayed relationship, stated rather than left to the eye.
   * The correlation matrix quantifies every pair and clicking a cell drives this
   * panel — at which point r and n vanished, and a scatter with no coefficient
   * invites reading a trend into noise. Shares `pearsonFromSums` with the matrix,
   * so the two cards cannot disagree about the same pair.
   *
   * Computed over the points actually plotted, so filtering the legend down to
   * one group updates it — an r for a subset is a different, and usually more
   * useful, number than the pooled one (see the Simpson's-paradox warning above).
   */
  function syncHint(): void {
    const base = byGroup
      ? 'One point per die · coloured by group · click legend to filter'
      : 'One point per die across all wafers · coloured by hard bin · click legend to filter';
    // Same visibility rule the draw loop uses (an empty activeCats means "no
    // filter", not "nothing shown").
    const visible = activeCats.size === 0 ? points : points.filter(p => activeCats.has(categoryOf(p)));
    const { r, n } = pearsonOfPairs(visible);
    hint.textContent = r === null
      ? `${base} · n = ${n.toLocaleString()}`
      : `${base} · r = ${r.toFixed(3)} · n = ${n.toLocaleString()}`;
  }

  // Category '0' is "no hard-bin result" — a die without one is categorized
  // there rather than coerced into a real bin, matching the wafer map's own
  // "missing bin ≠ bin 0/any bin" rule, and drawn in the no-data fill.
  const categoryOf = (p: ScatterPoint): string => byGroup ? (p.group ?? '—') : String(p.hbin ?? 0);
  const colorOfCategory = (cat: string): string => {
    // Bin identity keeps the map's resolved colours so a bin is the same
    // colour here as on the wafer map. Facet groups have no map identity, so
    // they use the fixed CVD-safe categorical palette instead (palette.ts).
    if (byGroup) return categorical(groupColorIndex.get(cat) ?? 0);
    return cat === '0' ? NO_DATA_FILL : binColors?.get(Number(cat)) ?? NO_DATA_FILL;
  };
  const labelOfCategory = (cat: string): string => byGroup ? cat : cat === '0' ? 'No bin data' : `Bin ${cat}`;
  const activeCats = new Set<string>();

  const legend = card.ownerDocument.createElement('div');
  // Air above and below, not just between. The row previously had 4px of hint
  // margin above it and 6px below, so a band of interactive chips sat wedged
  // between the sentence it belongs to and the plot it controls.
  Object.assign(legend.style, {
    display: 'flex', flexWrap: 'wrap', gap: SPACE.sm,
    marginTop: SPACE.md, marginBottom: SPACE.xl,
  } as Partial<CSSStyleDeclaration>);
  body.appendChild(legend);

  const canvas = card.ownerDocument.createElement('canvas');
  canvas.style.display = 'block';
  canvas.style.cursor = 'crosshair';
  body.appendChild(canvas);

  const tooltip = makeTooltip(card);

  let points: ScatterPoint[] = [];
  let xLo = 0, xHi = 1, yLo = 0, yHi = 1;

  function testMeta(testNumber: number): { unit?: string; limitLow?: number; limitHigh?: number } {
    const def = testDefs.find(d => d.testNumber === testNumber);
    return { unit: def?.unit, limitLow: def?.limitLow, limitHigh: def?.limitHigh };
  }

  function dims() {
    // body's own width, not card's — canvas fills body via applyCanvasFlow,
    // so measuring from it directly stays correct even when body has its
    // own horizontal scrollbar narrowing it. body's overflow-y is 'hidden'
    // (cardShell default) so this can no longer be perturbed by a
    // vertical-scrollbar toggle feeding back into this width-derived height.
    const w = body.clientWidth;
    const gridH = Math.max(200, Math.min(400, w * 0.65));
    const h = chartFillHeight(card, body, canvas, gridH);
    return { w, h, plotW: Math.max(10, w - SCATTER_LEFT - SCATTER_RIGHT), plotH: Math.max(10, h - SCATTER_TOP - SCATTER_BOTTOM) };
  }

  /** Chip handles by category, so `updateLegend` can drive their shared state
   *  rather than re-implementing the styling it already owns. */
  const chips = new Map<string, SeriesLegendItem>();

  function updateLegend(): void {
    for (const [cat, chip] of chips) {
      // `selected` is "filtering on this one"; `dimmed` is "something else is
      // selected". With nothing selected every chip is neither — the plot shows
      // everything, so no chip should claim to be narrowing it.
      const filtering = activeCats.has(cat);
      chip.setState({ selected: filtering, dimmed: activeCats.size > 0 && !filtering });
    }
  }

  function rebuildLegend(cats: string[]): void {
    legend.innerHTML = '';
    chips.clear();
    activeCats.clear();
    for (const cat of cats) {
      // The shared chip — identical to the histogram's group legend, which is
      // the same control with a different verb (filter vs emphasize).
      const chip = makeSeriesLegendItem(labelOfCategory(cat), colorOfCategory(cat), card.ownerDocument);
      const swatch = chip.el;
      swatch.dataset.cat = cat;
      chips.set(cat, chip);
      attachChartTip(swatch, card, tooltip, `${labelOfCategory(cat)} — click to filter`);
      swatch.addEventListener('click', () => {
        if (activeCats.has(cat)) activeCats.delete(cat); else activeCats.add(cat);
        updateLegend();
        syncHint();
        draw();
      });
      legend.appendChild(swatch);
    }
    updateLegend();
  }

  function draw(): void {
    applyCanvasFlow(canvas, legend);
    const theme = resolveChartCanvasColors(card);
    const xSpan = xHi - xLo, ySpan = yHi - yLo;
    const { w, h, plotW, plotH } = dims();
    const prep = prepareCanvas(canvas, card, w, h);
    if (!prep) return;
    const { ctx } = prep;

    if (points.length === 0) {
      ctx.font = `${fontPx()}px system-ui, sans-serif`;
      ctx.fillStyle = theme.textMuted;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('No data — select two parametric tests with values.', w / 2, h / 2);
      return;
    }

    // Round values on each axis, placed by value and labelled to their step.
    ctx.font = `${fontPx(-1)}px system-ui, sans-serif`;
    const xUnit = activeX !== null ? testMeta(activeX).unit : undefined;
    const xTicks = fitTicks(xLo, xHi, plotW, horizontalTickSpacing(ctx, Math.max(Math.abs(xLo), Math.abs(xHi)), xUnit));
    const yTicks = fitTicks(yLo, yHi, plotH, () => VERTICAL_TICK_SPACING_PX);
    // One shared SI scale per axis (makeAxisFormat) — bare "861E-6" ticks
    // with a lone "(A)" in the corner become "861 · 1020 · …" with "(µA)".
    const xAxisFmt = makeAxisFormat(Math.max(Math.abs(xLo), Math.abs(xHi)), activeX !== null ? testMeta(activeX).unit : undefined, xTicks.step || undefined);
    const yAxisFmt = makeAxisFormat(Math.max(Math.abs(yLo), Math.abs(yHi)), activeY !== null ? testMeta(activeY).unit : undefined, yTicks.step || undefined);
    ctx.font = `${fontPx(-1)}px system-ui, sans-serif`;
    ctx.strokeStyle = theme.border;
    ctx.lineWidth = 0.5;
    ctx.fillStyle = theme.textMuted;

    for (const xv of xTicks.ticks) {
      const cx = SCATTER_LEFT + ((xv - xLo) / xSpan) * plotW;
      ctx.beginPath(); ctx.moveTo(cx, SCATTER_TOP); ctx.lineTo(cx, SCATTER_TOP + plotH); ctx.stroke();
      ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      ctx.fillText(xAxisFmt.tick(xv), cx, SCATTER_TOP + plotH + 4);
    }
    for (const yv of yTicks.ticks) {
      const cy = SCATTER_TOP + (1 - (yv - yLo) / ySpan) * plotH;
      ctx.beginPath(); ctx.moveTo(SCATTER_LEFT, cy); ctx.lineTo(SCATTER_LEFT + plotW, cy); ctx.stroke();
      ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
      ctx.fillText(yAxisFmt.tick(yv), SCATTER_LEFT - 4, cy);
    }

    if (xAxisFmt.unitLabel) drawAxisUnit(ctx, xAxisFmt.unitLabel, SCATTER_LEFT + plotW / 2, SCATTER_TOP + plotH + 24, theme.textMuted);
    if (yAxisFmt.unitLabel) {
      ctx.save();
      ctx.font = `${fontPx(-1)}px system-ui, sans-serif`;
      ctx.fillStyle = theme.textMuted;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.translate(6, SCATTER_TOP + plotH / 2);
      ctx.rotate(-Math.PI / 2);
      ctx.fillText(`(${yAxisFmt.unitLabel})`, 0, 0);
      ctx.restore();
    }

    const visible = activeCats.size === 0 ? points : points.filter(p => activeCats.has(categoryOf(p)));
    const step = visible.length > 5000 ? Math.ceil(visible.length / 5000) : 1;
    ctx.globalAlpha = Math.max(0.15, Math.min(0.7, 200 / (visible.length / step)));
    for (let i = 0; i < visible.length; i += step) {
      const p = visible[i];
      const cx = SCATTER_LEFT + ((p.x - xLo) / xSpan) * plotW;
      const cy = SCATTER_TOP + (1 - (p.y - yLo) / ySpan) * plotH;
      ctx.beginPath();
      ctx.arc(cx, cy, 2.5, 0, Math.PI * 2);
      ctx.fillStyle = colorOfCategory(categoryOf(p));
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    if (activeX !== null && activeY !== null) {
      const xMeta = testMeta(activeX);
      const yMeta = testMeta(activeY);
      ctx.strokeStyle = theme.textMuted;
      ctx.fillStyle = theme.textMuted;
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 3]);
      ctx.font = `${fontPx(-1)}px system-ui, sans-serif`;
      ctx.textBaseline = 'top';

      for (const [lim, label] of [[xMeta.limitLow, 'LSL'], [xMeta.limitHigh, 'USL']] as const) {
        if (lim === undefined || lim < xLo || lim > xHi) continue;
        const cx = SCATTER_LEFT + ((lim - xLo) / xSpan) * plotW;
        ctx.beginPath();
        ctx.moveTo(cx, SCATTER_TOP);
        ctx.lineTo(cx, SCATTER_TOP + plotH);
        ctx.stroke();
        ctx.textAlign = 'left';
        ctx.fillText(label, cx + 2, SCATTER_TOP + 2);
      }

      for (const [lim, label] of [[yMeta.limitLow, 'LSL'], [yMeta.limitHigh, 'USL']] as const) {
        if (lim === undefined || lim < yLo || lim > yHi) continue;
        const cy = SCATTER_TOP + (1 - (lim - yLo) / ySpan) * plotH;
        ctx.beginPath();
        ctx.moveTo(SCATTER_LEFT, cy);
        ctx.lineTo(SCATTER_LEFT + plotW, cy);
        ctx.stroke();
        // Label at the left end of the line, inside the plot — at the right
        // end it collided with the card border / scrollbar gutter.
        ctx.textAlign = 'left';
        ctx.fillText(label, SCATTER_LEFT + 3, cy + 2);
      }

      ctx.setLineDash([]);
    }

    ctx.strokeStyle = theme.border;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(SCATTER_LEFT, SCATTER_TOP); ctx.lineTo(SCATTER_LEFT, SCATTER_TOP + plotH);
    ctx.moveTo(SCATTER_LEFT, SCATTER_TOP + plotH); ctx.lineTo(SCATTER_LEFT + plotW, SCATTER_TOP + plotH);
    ctx.stroke();
  }

  function rebuildBody(): void {
    syncMixedFieldsWarning();
    if (testOptions.length < 2 || activeX === null || activeY === null) {
      points = [];
      rebuildLegend([]);
      syncHint();
      draw();
      return;
    }
    points = byGroup ? buildScatterDataGrouped(groups!, activeX, activeY) : buildScatterData(currentItems(), activeX, activeY);
    let cats: string[];
    if (byGroup) {
      const present = new Set(points.map(categoryOf));
      cats = groupKeys.filter(g => present.has(g));
    } else {
      cats = Array.from(new Set(points.map(p => p.hbin ?? 0))).sort((a, b) => a - b).map(String);
    }
    rebuildLegend(cats);
    syncHint();

    if (points.length > 0) {
      // minOf/maxOf, not a spread: `points` is one entry per die, and a spread
      // passes one argument per element — V8 throws RangeError above ~131k of
      // them, which on a large lot takes the whole Insights rebuild with it. The
      // histogram panel already hit exactly this (see its `testValueExtent`).
      const xs = points.map(p => p.x), ys = points.map(p => p.y);
      const xMin = minOf(xs), xMax = maxOf(xs);
      const yMin = minOf(ys), yMax = maxOf(ys);
      const xPad = (xMax - xMin) * 0.05 || 1, yPad = (yMax - yMin) * 0.05 || 1;
      xLo = xMin - xPad; xHi = xMax + xPad;
      yLo = yMin - yPad; yHi = yMax + yPad;
    }
    draw();
  }

  const resizeHandle = observeResize(card, () => draw());
  rebuildBody();

  function setXY(xTestNumber: number, yTestNumber: number): void {
    activeX = xTestNumber;
    activeY = yTestNumber;
    xSel.value = String(xTestNumber);
    ySel.value = String(yTestNumber);
    rebuildBody();
  }

  return { card, setXY, destroy: () => resizeHandle.disconnect() };
}
