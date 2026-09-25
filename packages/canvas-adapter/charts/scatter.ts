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
import { cardShell, observeResize, makeTooltip, attachChartTip, makeTestSelect, makeWaferSelect, chartFillHeight, applyCanvasFlow, drawAxisUnit, resolveChartCanvasColors, makeAxisFormat, horizontalTickSpacing, VERTICAL_TICK_SPACING_PX, type SaveImageHandler, makeSeriesLegendItem, type SeriesLegendItem, prepareCanvas, drawOffAxisLimits, limitLines, hasBothLimitKinds, makeLimitsSelect, stackLabelRows, strokeLimitLine, fillTextOnHalo, type AxisPrefs } from './chartShell.js';

const SCATTER_LEFT = 52;
const SCATTER_RIGHT = 16;
const SCATTER_TOP = 16;
const SCATTER_BOTTOM = 44;

type ScatterPanelItem = FacetItem & ScatterItem & { label?: string };

// Not a number, so it can never collide with a real bin — bin 0 is legal.
export const NO_BIN_CATEGORY = 'none';

export function binCategoryOf(hbin: number | undefined): string {
  return hbin === undefined ? NO_BIN_CATEGORY : String(hbin);
}

/** Legend order: bins ascending, then "No bin data" last. */
export function binCategories(points: readonly Pick<ScatterPoint, 'hbin'>[]): string[] {
  const bins = new Set<number>();
  let noBin = false;
  for (const p of points) {
    if (p.hbin === undefined) noBin = true;
    else bins.add(p.hbin);
  }
  const cats = Array.from(bins).sort((a, b) => a - b).map(String);
  if (noBin) cats.push(NO_BIN_CATEGORY);
  return cats;
}

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
  /**
   * The Insights tab's shared axis preferences. Scatter reads only `limits`
   * (which limit lines to draw), and offers the "Limits:" choice when either
   * axis's test has both test and spec limits.
   */
  axisPrefs?: AxisPrefs;
  /** Called when the user changes the "Limits:" choice here. */
  onAxisPrefsChange?: (prefs: AxisPrefs) => void;
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
  /** Adopt axis preferences chosen in another panel (only `limits` applies). */
  setAxisPrefs: (prefs: AxisPrefs) => void;
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
  let axisPrefs: AxisPrefs = options.axisPrefs ?? { clipOutliers: false };
  // Refilled on each rebuild: the choice is offered only when a plotted test has both kinds.
  const limitsSlot = card.ownerDocument.createElement('span');
  controlsRow.appendChild(limitsSlot);
  function syncLimitsControl(): void {
    const defs = [activeX, activeY].map(n => testDefs.find(d => d.testNumber === n));
    limitsSlot.replaceChildren(...(defs.some(hasBothLimitKinds)
      ? [makeLimitsSelect(axisPrefs.limits ?? 'both', v => {
          axisPrefs = { ...axisPrefs, limits: v };
          options.onAxisPrefsChange?.(axisPrefs);
          draw();
        }, card.ownerDocument)]
      : []));
  }
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

  const categoryOf = (p: ScatterPoint): string => byGroup ? (p.group ?? '—') : binCategoryOf(p.hbin);
  const colorOfCategory = (cat: string): string => {
    // Bin identity keeps the map's resolved colours so a bin is the same
    // colour here as on the wafer map. Facet groups have no map identity, so
    // they use the fixed CVD-safe categorical palette instead (palette.ts).
    if (byGroup) return categorical(groupColorIndex.get(cat) ?? 0);
    return cat === NO_BIN_CATEGORY ? NO_DATA_FILL : binColors?.get(Number(cat)) ?? NO_DATA_FILL;
  };
  const labelOfCategory = (cat: string): string => byGroup ? cat : cat === NO_BIN_CATEGORY ? 'No bin data' : `Bin ${cat}`;
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

  function testMeta(testNumber: number): { unit?: string; lines: ReturnType<typeof limitLines> } {
    const def = testDefs.find(d => d.testNumber === testNumber);
    return { unit: def?.unit, lines: limitLines(def, axisPrefs.limits) };
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
    ctx.strokeStyle = theme.grid;
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
      // The same colour every other chart draws its limits in (`limitLine`),
      // not the muted text grey, which sat on the grid at nearly its colour.
      ctx.strokeStyle = theme.limitLine;
      ctx.fillStyle = theme.limitLine;
      ctx.lineWidth = 1;
      ctx.font = `${fontPx(-1)}px system-ui, sans-serif`;
      ctx.textBaseline = 'top';

      const rowH = fontPx(-1) + 2;
      // X limits: vertical lines, labels along the top; a label that would
      // overlap another moves down a row (`stackLabelRows`).
      const xPlaced = xMeta.lines.filter(l => l.value >= xLo && l.value <= xHi).map(l => {
        const cx = SCATTER_LEFT + ((l.value - xLo) / xSpan) * plotW;
        return { l, cx, start: cx + 2, end: cx + 2 + ctx.measureText(l.label).width };
      });
      const xRows = stackLabelRows(xPlaced);
      xPlaced.forEach(({ l, cx }, k) => {
        strokeLimitLine(ctx, l, theme.limitLine, cx, SCATTER_TOP, cx, SCATTER_TOP + plotH);
        ctx.textAlign = 'left';
        fillTextOnHalo(ctx, l.label, cx + 2, SCATTER_TOP + 2 + xRows[k] * rowH, theme.bg);
      });

      // Y limits: horizontal lines, labels at the left end, inside the plot —
      // at the right end they collided with the card border / scrollbar gutter.
      // Overlapping labels move one column right.
      const yPlaced = yMeta.lines.filter(l => l.value >= yLo && l.value <= yHi).map(l => {
        const cy = SCATTER_TOP + (1 - (l.value - yLo) / ySpan) * plotH;
        return { l, cy, start: cy + 2, end: cy + 2 + fontPx(-1) };
      });
      const yRows = stackLabelRows(yPlaced, 1);
      const colW = maxOf(yPlaced.map(p => ctx.measureText(p.l.label).width)) + 8;
      yPlaced.forEach(({ l, cy }, k) => {
        strokeLimitLine(ctx, l, theme.limitLine, SCATTER_LEFT, cy, SCATTER_LEFT + plotW, cy);
        ctx.textAlign = 'left';
        fillTextOnHalo(ctx, l.label, SCATTER_LEFT + 3 + yRows[k] * colW, cy + 2, theme.bg);
      });

      // A limit outside the plotted range gets an edge marker, as in the other
      // charts — otherwise "off-screen" reads as "this test has no limits".
      const offAxis = (lines: typeof xMeta.lines, lo: number, hi: number) => lines
        .filter(l => l.value < lo || l.value > hi)
        .map(l => ({ value: l.value, label: l.label, side: (l.value < lo ? 'lo' : 'hi') as 'lo' | 'hi' }));
      // Everything along the top shares one strip, so each group starts below
      // the last: the in-range X labels, then the off-axis X markers, then the
      // off-axis Y markers that sit at the top-left.
      const plotBox = { left: SCATTER_LEFT, right: SCATTER_LEFT + plotW, top: SCATTER_TOP, bottom: SCATTER_TOP + plotH };
      const xOff = offAxis(xMeta.lines, xLo, xHi);
      const xOffTop = SCATTER_TOP + (xPlaced.length ? (maxOf(xRows) + 1) * rowH : 0);
      const xOffRows = Math.max(xOff.filter(o => o.side === 'lo').length, xOff.filter(o => o.side === 'hi').length);
      drawOffAxisLimits(ctx, xOff, { ...plotBox, top: xOffTop }, 'horizontal', theme.limitLine,
        v => makeAxisFormat(Math.abs(v), xMeta.unit).tick(v), theme.bg);
      drawOffAxisLimits(ctx, offAxis(yMeta.lines, yLo, yHi), { ...plotBox, top: xOffTop + xOffRows * rowH }, 'vertical', theme.limitLine,
        v => makeAxisFormat(Math.abs(v), yMeta.unit).tick(v), theme.bg);

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
    syncLimitsControl();
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
      cats = binCategories(points);
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

  function setAxisPrefs(prefs: AxisPrefs): void {
    if ((prefs.limits ?? 'both') === (axisPrefs.limits ?? 'both')) { axisPrefs = prefs; return; }
    axisPrefs = prefs;
    syncLimitsControl();
    draw();
  }

  return { card, setXY, setAxisPrefs, destroy: () => resizeHandle.disconnect() };
}
