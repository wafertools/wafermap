// Histogram panel — bucket distribution for one parametric test on one item
// (typically a wafer) or all items, with spec-limit lines. Ported from
// tsmap's charts/histogram.ts.
//
// Grouping is a third distinct pattern from capability's restrict-dropdown
// and boxplot's drill-in-place (verified by reading tsmap's actual source):
// **overlaid multi-series** — every group drawn as a separate coloured
// series on one shared-bucket chart, with a legend to click-emphasize one
// series at a time (dimming the rest). The per-item "which wafer" selector
// is meaningless once grouped (a group pools all its items), so it's hidden
// in that mode, matching tsmap exactly.
//
// Trimmed from tsmap's version for this port: legend items use the native
// `title` attribute instead of porting tsmap's `attachTooltip` chrome
// helper (that's tsmap app chrome, not chart-panel logic).

import { buildTestHistogramData, collectTestValues, buildTestHistogramSeries, testValueExtent, type HistogramItem, type HistogramSeriesData } from '../../stats/histogram.js';
import type { TestDef } from '../../renderer/buildWaferMap.js';
import { SPACE, fontPx, FONT, CLR } from '../toolbar.js';
import { fmt } from '../../renderer/fmt.js';
import { niceStep, fitTicks } from '../../renderer/axisTicks.js';
import { QUANTITY, categorical } from './palette.js';
import { cardShell, observeResize, makeTooltip, attachChartTip, positionChartTooltip, makeLinkedTestSelect, makeWaferSelect, makeLinkedAxisPrefs, renderEmptyState, chartFillHeight, applyCanvasFlow, makeAxisFormat, horizontalTickSpacing, PADDING, type SaveImageHandler, robustFence, shouldIncludeLimitsByDefault, drawOffAxisLimits, resolveAxisRange, type AxisPrefs, chartSwatchCss, makeSeriesLegendItem, prepareCanvas } from './chartShell.js';
import { escHtml, maxOf } from '../../core/utils.js';
// Quantity/series colours are fixed (palette.ts), not the map's colours.

const HIST_HEIGHT = 230;
const HIST_AXIS_HEIGHT = 36;
const HIST_TOP_MARGIN = 18;

/** Draw a numbered count axis (Y) at the left of the plot, with ~`targetTicks` "nice" gridlines from 0 to maxCount. */
function drawCountAxis(
  ctx: CanvasRenderingContext2D,
  plotX: number, plotTop: number, plotBottom: number, plotMaxWidth: number,
  maxCount: number, colors: { text: string; axis: string; grid: string },
  targetTicks = 4,
): void {
  // Counts are whole, so never a step below 1; otherwise the shared rule.
  const countStep = Math.max(1, niceStep(maxCount / targetTicks));
  const plotH = plotBottom - plotTop;

  ctx.save();
  ctx.font = `${fontPx(-1)}px system-ui, sans-serif`;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for (let v = 0; v <= maxCount + 1e-9; v += countStep) {
    const y = plotBottom - (v / (maxCount || 1)) * plotH;
    ctx.strokeStyle = colors.grid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(plotX, y); ctx.lineTo(plotX + plotMaxWidth, y);
    ctx.stroke();
    ctx.fillStyle = colors.text;
    ctx.fillText(String(Math.round(v)), plotX - 4, y);
  }
  ctx.strokeStyle = colors.axis;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(plotX, plotTop); ctx.lineTo(plotX, plotBottom);
  ctx.stroke();
  ctx.restore();
}

export interface HistogramPanelOptions {
  /** Initial axis toggles, shared with the sibling distribution panels. */
  axisPrefs?: AxisPrefs;
  /** Fired when the user changes an axis toggle here, so siblings can follow. */
  onAxisPrefsChange?: (prefs: AxisPrefs) => void;
  /** Fired when the USER picks a test here, so siblings can follow. */
  onTestChange?: (testNumber: number) => void;
  title?: string;
  items: HistogramItem[];
  testDefs: TestDef[];
  selectedTestNumber?: number;
  onSaveImage?: SaveImageHandler;
  /**
   * When the Analysis tab's "Group by" is active, this panel switches to an
   * overlaid multi-series view (one coloured series per group over shared
   * buckets, with a click-to-emphasize legend) instead of the single-item
   * view. `items` above is ignored when `groups` is provided. Absent ⇒
   * today's plain per-item view with a wafer selector.
   */
  groups?: { key: string; items: HistogramItem[] }[];
  /** Fired when the user narrows to one group by clicking it in the legend.
   *  The Insights tab owns the scope; this panel only reports the gesture. */
  onGroupChange?: (key: string | null) => void;
  /** Document to build this panel's DOM into. Default `document` — pass the
   *  host's own `ownerDocument` when the container might live in a
   *  different document (e.g. a gallery card detached into its own popup
   *  window). */
  ownerDocument?: Document;
}

export interface HistogramPanelHandle {
  card: HTMLElement;
  /** Cross-panel link (e.g. from the capability panel): switch to `testNumber` in place. */
  setTest: (testNumber: number) => void;
  /** Adopt the shared axis toggles (see `AxisPrefs`). */
  setAxisPrefs: (prefs: AxisPrefs) => void;
  destroy: () => void;
}

export function renderHistogramPanel(options: HistogramPanelOptions): HistogramPanelHandle {
  const { title = 'Test value distribution', items, testDefs, onSaveImage, groups } = options;
  const { card, body, controlsRow } = cardShell(title, onSaveImage, options.ownerDocument);

  const testOptions = testDefs.filter((d): d is TestDef & { testNumber: number } => d.testNumber !== undefined);
  let activeTest = options.selectedTestNumber ?? testOptions[0]?.testNumber ?? null;
  let activeItem: number | null = null; // index into `items`; null = all
  // undefined = derive from the data each rebuild (shouldIncludeLimitsByDefault).
  let lastClippedCount = 0;

  const testSel = makeLinkedTestSelect(testOptions, activeTest, n => {
    activeTest = n;
    rebuildBody();
    options.onTestChange?.(n);
  }, { maxWidth: '200px', ownerDocument: card.ownerDocument });
  const testSelect = testSel.el;
  controlsRow.appendChild(testSelect);

  // Only with a choice to make — the same rule scatter and correlation apply.
  // With one wafer it offered "All wafers" over a population of one, which a
  // drilldown of a single wafer (or a single-map Insights tab) always is.
  const itemSelect = items.length > 1
    ? makeWaferSelect(items, activeItem, i => { activeItem = i; rebuildBody(); }, { ownerDocument: card.ownerDocument })
    : null;
  if (itemSelect) controlsRow.appendChild(itemSelect);

  /** Apply a group scope locally. Never broadcasts — callers representing a
   *  USER action fire `onGroupChange` themselves. */
  function setEmphasis(key: string | null): boolean {
    if (emphasizedGroup === key) return false;
    if (key !== null && !(groups ?? []).some(g => g.key === key)) return false;
    emphasizedGroup = key;
    rebuildBody();
    return true;
  }


  const axisTogglesRow = card.ownerDocument.createElement('span');
  Object.assign(axisTogglesRow.style, { display: 'inline-flex', gap: SPACE.lg, alignItems: 'center' } as Partial<CSSStyleDeclaration>);
  controlsRow.appendChild(axisTogglesRow);
  // The toggles, their state, and the notify — one shared control instead of
  // a copy in each of the three panels that offers them.
  const axisCtl = makeLinkedAxisPrefs(axisTogglesRow, options.axisPrefs, prefs => {
    options.onAxisPrefsChange?.(prefs);
    rebuildBody();
  }, card.ownerDocument);

  // Rebuilt each draw so the checkbox shows the RESOLVED state — with a
  // data-derived default, an unchecked box beside an axis that plainly does
  // include the limits would be a lie.

  const tooltip = makeTooltip(card);
  let resizeHandle: { disconnect: () => void } | null = null;

  // Z-order / emphasis state for the faceted legend (group key clicked →
  // brought to front and fully opaque, others dimmed). Persists across
  // redraws; reset implicitly on a full card rebuild.
  // The section's shared group scope, mirrored here.
  //
  // Emphasis rather than a filter, unlike its two neighbours, and deliberately:
  // an overlaid comparison of every group IS this panel's job, and narrowing to
  // one leaves a single curve that the boxplot already shows better. The
  // desync this control exists to fix was never that the three panels drew
  // different things — it is that they drew different POPULATIONS with nothing
  // saying so. Emphasising the selected group keeps the comparison while making
  // the shared selection unambiguous on this card too.
  let emphasizedGroup: string | null = null;

  function testMeta(testNumber: number): { unit?: string; limitLow?: number; limitHigh?: number } {
    const def = testDefs.find(d => d.testNumber === testNumber);
    return { unit: def?.unit, limitLow: def?.limitLow, limitHigh: def?.limitHigh };
  }

  function rebuildBody(): void {
    // Read once per rebuild from the shared control, which owns this state.
    const { includeLimits: axisIncludesLimits, clipOutliers } = axisCtl.get();
    resizeHandle?.disconnect();
    resizeHandle = null;
    body.innerHTML = '';
    if (activeTest === null) {
      renderEmptyState(body, 'No parametric test data available for a histogram.');
      return;
    }

    // Faceted (grouped) view: overlaid series + legend. The item selector is
    // meaningless here (groups pool all their items), so hide it.
    //
    // An UNSET preference is resolved the same way in both branches — from the
    // data, via shouldIncludeLimitsByDefault, over whatever population the
    // branch is about to draw. It used to mean "off" here and "derive from the
    // data" below, so the same test with no explicit preference could include
    // the limits in the axis ungrouped and exclude them grouped: the axis range
    // moved under the reader while the toggle stayed where it was.
    const isFaceted = !!groups && groups.length > 0;
    let facetedIncludeLimits = false;
    let facetedClip: { lo: number; hi: number } | undefined;
    if (isFaceted) {
      const { limitLow: fLow, limitHigh: fHigh } = testMeta(activeTest);
      const pooled = groups.flatMap(g => g.items);
      const { min: fMin, max: fMax } = testValueExtent(pooled, activeTest);
      facetedIncludeLimits = axisIncludesLimits ?? shouldIncludeLimitsByDefault(fMin, fMax, fLow, fHigh);
      // "Clip outliers" applies here too. It was rendered in this branch and did
      // nothing — the series builder took no clip range — so the checkbox lied
      // in exactly the view where a single wild reading does the most damage,
      // compressing every group's real buckets into one column at once. Same
      // fence, same pooled population the buckets span.
      if (clipOutliers) {
        const values = collectTestValues(pooled, activeTest);
        const fence = robustFence(values);
        if (fence) {
          facetedClip = { lo: Math.max(fMin, fence.lo), hi: Math.min(fMax, fence.hi) };
          lastClippedCount = values.reduce((n, v) => n + (v < facetedClip!.lo || v > facetedClip!.hi ? 1 : 0), 0);
        }
      }
      if (!facetedClip) lastClippedCount = 0;
    }
    const faceted = isFaceted
      ? buildTestHistogramSeries(groups, activeTest, 16,
          facetedIncludeLimits ? testMeta(activeTest).limitLow : undefined,
          facetedIncludeLimits ? testMeta(activeTest).limitHigh : undefined,
          facetedClip)
      : null;
    if (itemSelect) itemSelect.style.display = faceted ? 'none' : '';
    if (faceted) {
      // The axis toggles apply to the faceted view too, and now genuinely do:
      // `axisIncludesLimits` and `clipOutliers` are both honoured above, when
      // building the series. This branch returned before syncAxisToggles, so
      // with "Group by" active the card lost BOTH checkboxes: the reader could
      // not see the current setting, could not change it, and the derived
      // include-limits default silently applied with nothing saying so.
      const { limitLow: fLow, limitHigh: fHigh } = testMeta(activeTest);
      // The state actually in force, which is now the same rule the non-faceted
      // branch uses (see `facetedIncludeLimits` above) rather than this branch's
      // old "unset means off".
      axisCtl.sync(facetedIncludeLimits, fLow !== undefined || fHigh !== undefined);
      if (faceted.series.length === 0) {
        renderEmptyState(body, 'No parametric test data available for a histogram.');
        return;
      }
      renderFacetedSeries(faceted);
      return;
    }

    const scopedItems = activeItem !== null ? [items[activeItem]] : items;
    const { unit, limitLow, limitHigh } = testMeta(activeTest);
    const allValues = collectTestValues(scopedItems, activeTest);
    // Not `Math.min(...allValues)`: the spread passes every die value as its own
    // argument and overflows on a real lot (25 × ~10k dies), taking the whole
    // Insights rebuild with it. See `testValueExtent`.
    const { min: dataMin, max: dataMax } = testValueExtent(scopedItems, activeTest);
    const resolvedIncludeLimits = axisIncludesLimits
      ?? shouldIncludeLimitsByDefault(dataMin, dataMax, limitLow, limitHigh);
    axisCtl.sync(resolvedIncludeLimits, limitLow !== undefined || limitHigh !== undefined);

    const fence = clipOutliers ? robustFence(allValues) : null;
    const clip = fence ? { lo: Math.max(dataMin, fence.lo), hi: Math.min(dataMax, fence.hi) } : undefined;
    lastClippedCount = clip ? allValues.filter(v => v < clip.lo || v > clip.hi).length : 0;

    const buckets = buildTestHistogramData(
      scopedItems, activeTest, 16,
      resolvedIncludeLimits ? limitLow : undefined,
      resolvedIncludeLimits ? limitHigh : undefined,
      clip,
    );

    if (buckets.length === 0) {
      renderEmptyState(body, 'No parametric test data available for a histogram.');
      return;
    }

    // Bounded spread: one entry per bucket (16), not per die.
    const maxCount = Math.max(maxOf(buckets.map(b => b.count)), 1);

    const statsLabel = card.ownerDocument.createElement('div');
    Object.assign(statsLabel.style, { fontSize: FONT.body, color: CLR.label, marginBottom: SPACE.xxs } as Partial<CSSStyleDeclaration>);
    // The clipped count is stated, never silent: these values exist and are still
    // in every statistic — only this chart's range excludes them.
    statsLabel.textContent = `max ${maxCount} dies/bucket`
      + (lastClippedCount ? ` · ${lastClippedCount} value${lastClippedCount === 1 ? '' : 's'} outside clipped range` : '');
    body.appendChild(statsLabel);

    const canvas = card.ownerDocument.createElement('canvas');
    canvas.style.display = 'block';
    canvas.style.cursor = 'default';
    body.appendChild(canvas);

    let hovered = -1;
    const bucketMin = buckets[0].rangeLow;
    const bucketMax = buckets[buckets.length - 1].rangeHigh;
    const bucketSpan = bucketMax - bucketMin || 1;
    // The scale reference; the formatter itself is built per draw, once the
    // tick step for the current width is known.
    const axisRef = Math.max(Math.abs(bucketMin), Math.abs(bucketMax));

    function plotRect(height: number) {
      const plotX = PADDING + 36;
      const plotMaxWidth = canvas.clientWidth - plotX - PADDING;
      const plotMaxHeight = height - HIST_AXIS_HEIGHT - HIST_TOP_MARGIN;
      return { plotX, plotMaxWidth: Math.max(10, plotMaxWidth), plotMaxHeight, plotTop: HIST_TOP_MARGIN };
    }

    function barAt(offsetX: number): number {
      const { plotX, plotMaxWidth } = plotRect(HIST_HEIGHT);
      if (offsetX < plotX || offsetX > plotX + plotMaxWidth) return -1;
      const index = Math.floor(((offsetX - plotX) / plotMaxWidth) * buckets.length);
      return index >= 0 && index < buckets.length ? index : -1;
    }

    function draw() {
      applyCanvasFlow(canvas, statsLabel);
      // body's own width, not card's — canvas fills body via applyCanvasFlow,
      // so measuring from it directly stays correct even when body has its
      // own vertical scrollbar narrowing it.
      const width = body.clientWidth;
      const height = chartFillHeight(card, body, canvas, HIST_HEIGHT);
      const prep = prepareCanvas(canvas, card, width, height);
      if (!prep) return;
      const { ctx, theme } = prep;
      const { plotX, plotMaxWidth, plotMaxHeight, plotTop } = plotRect(height);
      const plotBottom = plotTop + plotMaxHeight;
      const barWidth = plotMaxWidth / buckets.length;

      drawCountAxis(ctx, plotX, plotTop, plotBottom, plotMaxWidth, maxCount,
        { text: theme.textMuted, axis: theme.border, grid: theme.border });

      buckets.forEach((bucket, i) => {
        const barHeight = (bucket.count / maxCount) * plotMaxHeight;
        const x = plotX + i * barWidth;
        const y = plotBottom - barHeight;

        // One neutral fill for all bars — the x position already says where a
        // bucket sits; colouring bars by that same position (as the map value
        // ramp used to) adds no information, just noise (see palette.ts).
        ctx.fillStyle = i === hovered ? theme.text : QUANTITY;
        ctx.globalAlpha = i === hovered ? 1 : 0.7;
        ctx.fillRect(x + 1, y, Math.max(1, barWidth - 2), barHeight);
        ctx.globalAlpha = 1;

        if (i === hovered) {
          ctx.fillStyle = theme.text;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'bottom';
          ctx.fillText(`${bucket.count}`, x + barWidth / 2, y - 2);
        }
      });

      const xForVal = (v: number) => plotX + ((v - bucketMin) / bucketSpan) * plotMaxWidth;
      ctx.font = `${fontPx(-1)}px system-ui, sans-serif`;
      // A limit outside the bucket range gets an edge marker rather than a line
      // drawn off the plot — without it, "limits are off-screen" and "this test
      // has no limits" render identically. The bucket range IS this chart's axis,
      // so it is what the limits are tested against.
      const { offAxis } = resolveAxisRange({
        dataMin: bucketMin, dataMax: bucketMax, limitLow, limitHigh, includeLimits: false });
      drawOffAxisLimits(ctx, offAxis,
        { left: plotX, right: plotX + plotMaxWidth, top: plotTop, bottom: plotBottom },
        // A limit is a data value, not a grid value: size-based decimals, as before.
        'horizontal', theme.limitLine, makeAxisFormat(axisRef, unit).tick);
      const offAxisValues = new Set(offAxis.map(o => o.value));
      for (const [limit, label] of [[limitLow, 'LSL'], [limitHigh, 'USL']] as const) {
        if (limit === undefined || offAxisValues.has(limit)) continue;
        const x = xForVal(limit);
        ctx.strokeStyle = theme.limitLine;
        ctx.setLineDash([3, 3]);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x, plotTop); ctx.lineTo(x, plotBottom);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = theme.limitLine;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.fillText(label, x, plotTop - 2);
      }
      ctx.font = `${fontPx(-1)}px system-ui, sans-serif`;

      ctx.strokeStyle = theme.border;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(plotX, plotBottom); ctx.lineTo(plotX + plotMaxWidth, plotBottom);
      ctx.stroke();

      ctx.fillStyle = theme.textMuted;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      // Round values, placed by value — not the bucket edges, which sit wherever
      // the binning put them and labelled the axis "1.0342 1.0517 …".
      // As many round values as the measured labels allow in the plot's width.
      const { ticks: valueTicks, step: valueStep } = fitTicks(bucketMin, bucketMax, plotMaxWidth, horizontalTickSpacing(ctx, axisRef, unit));
      const axis = makeAxisFormat(axisRef, unit, valueStep || undefined);
      for (const value of valueTicks) {
        const x = plotX + ((value - bucketMin) / bucketSpan) * plotMaxWidth;
        ctx.beginPath();
        ctx.moveTo(x, plotBottom); ctx.lineTo(x, plotBottom + 4);
        ctx.stroke();
        ctx.fillText(axis.tick(value), x, plotBottom + 6);
      }
      if (axis.unitLabel) {
        ctx.save();
        ctx.font = `${fontPx(-1)}px system-ui, sans-serif`;
        ctx.fillStyle = theme.textMuted;
        ctx.textAlign = 'right';
        ctx.textBaseline = 'top';
        ctx.fillText(`(${axis.unitLabel})`, plotX + plotMaxWidth, plotBottom + 20);
        ctx.restore();
      }
    }

    canvas.addEventListener('mousemove', e => {
      const rect = canvas.getBoundingClientRect();
      const bar = barAt(e.clientX - rect.left);
      if (bar !== hovered) { hovered = bar; draw(); }
      if (bar >= 0) {
        const b = buckets[bar];
        tooltip.innerHTML = `<strong>${escHtml(`${fmt(b.rangeLow, unit, 'engineering')} – ${fmt(b.rangeHigh, unit, 'engineering')}`)}</strong><br>${b.count} dies`;
        tooltip.style.display = 'block';
        positionChartTooltip(tooltip, card, e.clientX, e.clientY);
      } else { tooltip.style.display = 'none'; }
    });
    canvas.addEventListener('mouseleave', () => { if (hovered !== -1) { hovered = -1; draw(); } tooltip.style.display = 'none'; });

    resizeHandle = observeResize(card, () => draw());
    draw();
  }

  // ── Faceted overlay: one coloured series per group + clickable legend ─────
  function renderFacetedSeries(facet: HistogramSeriesData): void {
    const { unit, limitLow, limitHigh } = testMeta(activeTest!);
    const ranges = facet.ranges;
    const series = facet.series;

    // Group identity → the CVD-safe categorical palette (see palette.ts) —
    // facet groups have no wafer-map identity, so unlike bin colours there
    // is nothing to keep in sync with the map's registered scheme.
    const colorOf = categorical;

    // A group can vanish from `series` when the active test has no values in it.
    // Clear the local emphasis AND the control, so the card never claims a
    // scope it isn't drawing. Deliberately not broadcast: the section's scope is
    // still valid for the panels that can honour it.
    if (emphasizedGroup && !series.some(s => s.groupKey === emphasizedGroup)) {
      emphasizedGroup = null;
    }

    // Bounded spread: groups × buckets, not per die.
    const maxCount = Math.max(1, ...series.flatMap(s => s.counts));

    const statsLabel = card.ownerDocument.createElement('div');
    Object.assign(statsLabel.style, { fontSize: FONT.body, color: CLR.label, marginBottom: SPACE.xxs } as Partial<CSSStyleDeclaration>);
    statsLabel.textContent = `${series.length} groups · max ${maxCount} dies/bucket`;
    body.appendChild(statsLabel);

    const legend = card.ownerDocument.createElement('div');
    // Same row metrics as the scatter's legend — the chips are now one
    // component, so the row around them should not differ either.
    Object.assign(legend.style, {
      display: 'flex', flexWrap: 'wrap', gap: SPACE.sm,
      marginTop: SPACE.md, marginBottom: SPACE.xl,
    } as Partial<CSSStyleDeclaration>);
    series.forEach((s, i) => {
      // The shared chip — this legend and the scatter's were the same control
      // built twice. See `makeSeriesLegendItem`.
      const chip = makeSeriesLegendItem(s.groupKey, colorOf(i), card.ownerDocument);
      const item = chip.el;
      attachChartTip(item, card, tooltip, `${s.groupKey} — click to emphasize (dim the rest)`);
      chip.setState({
        selected: emphasizedGroup === s.groupKey,
        dimmed: emphasizedGroup !== null && emphasizedGroup !== s.groupKey,
      });
      item.addEventListener('click', () => {
        const key = emphasizedGroup === s.groupKey ? null : s.groupKey;
        setEmphasis(key);
        options.onGroupChange?.(key);
      });
      legend.appendChild(item);
    });
    body.appendChild(legend);

    const canvas = card.ownerDocument.createElement('canvas');
    canvas.style.display = 'block';
    canvas.style.cursor = 'default';
    body.appendChild(canvas);

    const bucketMin = ranges[0].rangeLow;
    const bucketMax = ranges[ranges.length - 1].rangeHigh;
    const bucketSpan = bucketMax - bucketMin || 1;
    const axisRef = Math.max(Math.abs(bucketMin), Math.abs(bucketMax));
    // Outer height, margins included: `offsetHeight` alone put the canvas over
    // the legend's bottom margin — the same overlap `applyCanvasFlow` was fixed
    // for on the scatter.
    const outerH = (el: HTMLElement) => {
      const cs = (el.ownerDocument.defaultView ?? window).getComputedStyle(el);
      return el.offsetHeight + (parseFloat(cs.marginTop) || 0) + (parseFloat(cs.marginBottom) || 0);
    };
    const siblingH = () => outerH(statsLabel) + outerH(legend);

    let hoveredBucket = -1;
    let facetGeom = { plotX: PADDING + 36, plotMaxWidth: 10, barWidth: 10 };

    function draw() {
      applyCanvasFlow(canvas, siblingH());
      // body's own width, not card's — canvas fills body via applyCanvasFlow,
      // so measuring from it directly stays correct even when body has its
      // own vertical scrollbar narrowing it.
      const width = body.clientWidth;
      const height = chartFillHeight(card, body, canvas, HIST_HEIGHT);
      const prep = prepareCanvas(canvas, card, width, height);
      if (!prep) return;
      const { ctx, theme } = prep;
      const plotX = PADDING + 36;
      const plotMaxWidth = Math.max(10, width - plotX - PADDING);
      const plotTop = HIST_TOP_MARGIN;
      const plotMaxHeight = height - HIST_AXIS_HEIGHT - HIST_TOP_MARGIN;
      const plotBottom = plotTop + plotMaxHeight;
      const barWidth = plotMaxWidth / ranges.length;
      facetGeom = { plotX, plotMaxWidth, barWidth };

      drawCountAxis(ctx, plotX, plotTop, plotBottom, plotMaxWidth, maxCount,
        { text: theme.textMuted, axis: theme.border, grid: theme.border });

      if (hoveredBucket >= 0) {
        ctx.fillStyle = theme.bgHover;
        ctx.globalAlpha = 0.5;
        ctx.fillRect(plotX + hoveredBucket * barWidth, plotTop, barWidth, plotMaxHeight);
        ctx.globalAlpha = 1;
      }

      const drawOrder = series
        .map((s, i) => ({ s, i }))
        .sort((a, b) => (a.s.groupKey === emphasizedGroup ? 1 : 0) - (b.s.groupKey === emphasizedGroup ? 1 : 0));

      for (const { s, i } of drawOrder) {
        const emphasised = emphasizedGroup === s.groupKey;
        const dim = emphasizedGroup !== null && !emphasised;
        const color = colorOf(i);
        ctx.strokeStyle = color;
        ctx.fillStyle = color;
        ctx.lineWidth = emphasised ? 2 : 1;
        ctx.globalAlpha = dim ? 0.12 : (emphasizedGroup ? 0.32 : 0.22);
        ctx.beginPath();
        ctx.moveTo(plotX, plotBottom);
        s.counts.forEach((c, b) => {
          const x = plotX + b * barWidth;
          const y = plotBottom - (c / maxCount) * plotMaxHeight;
          ctx.lineTo(x, y);
          ctx.lineTo(x + barWidth, y);
        });
        ctx.lineTo(plotX + plotMaxWidth, plotBottom);
        ctx.closePath();
        ctx.fill();
        ctx.globalAlpha = dim ? 0.3 : 1;
        ctx.beginPath();
        s.counts.forEach((c, b) => {
          const x = plotX + b * barWidth;
          const y = plotBottom - (c / maxCount) * plotMaxHeight;
          if (b === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
          ctx.lineTo(x + barWidth, y);
        });
        ctx.stroke();
      }
      ctx.globalAlpha = 1;

      const xForVal = (v: number) => plotX + ((v - bucketMin) / bucketSpan) * plotMaxWidth;
      ctx.font = `${fontPx(-1)}px system-ui, sans-serif`;
      for (const [limit, label] of [[limitLow, 'LSL'], [limitHigh, 'USL']] as const) {
        if (limit === undefined) continue;
        const x = xForVal(limit);
        ctx.strokeStyle = theme.limitLine;
        ctx.setLineDash([3, 3]);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x, plotTop); ctx.lineTo(x, plotBottom);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = theme.limitLine;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.fillText(label, x, plotTop - 2);
      }
      ctx.font = `${fontPx(-1)}px system-ui, sans-serif`;

      ctx.strokeStyle = theme.border;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(plotX, plotBottom); ctx.lineTo(plotX + plotMaxWidth, plotBottom);
      ctx.stroke();

      ctx.fillStyle = theme.textMuted;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      // As many round values as the measured labels allow in the plot's width.
      const { ticks: valueTicks, step: valueStep } = fitTicks(bucketMin, bucketMax, plotMaxWidth, horizontalTickSpacing(ctx, axisRef, unit));
      const axis = makeAxisFormat(axisRef, unit, valueStep || undefined);
      for (const value of valueTicks) {
        const x = plotX + ((value - bucketMin) / bucketSpan) * plotMaxWidth;
        ctx.beginPath();
        ctx.moveTo(x, plotBottom); ctx.lineTo(x, plotBottom + 4);
        ctx.stroke();
        ctx.fillText(axis.tick(value), x, plotBottom + 6);
      }
      if (axis.unitLabel) {
        ctx.save();
        ctx.font = `${fontPx(-1)}px system-ui, sans-serif`;
        ctx.fillStyle = theme.textMuted;
        ctx.textAlign = 'right';
        ctx.textBaseline = 'top';
        ctx.fillText(`(${axis.unitLabel})`, plotX + plotMaxWidth, plotBottom + 20);
        ctx.restore();
      }
    }

    function bucketAt(offsetX: number): number {
      const { plotX, plotMaxWidth, barWidth } = facetGeom;
      if (offsetX < plotX || offsetX > plotX + plotMaxWidth) return -1;
      const b = Math.floor((offsetX - plotX) / barWidth);
      return b >= 0 && b < ranges.length ? b : -1;
    }

    canvas.addEventListener('mousemove', e => {
      const rect = canvas.getBoundingClientRect();
      const b = bucketAt(e.clientX - rect.left);
      if (b !== hoveredBucket) { hoveredBucket = b; draw(); }
      if (b >= 0) {
        const r = ranges[b];
        const rows = series.map((s, i) =>
          `<span style="${chartSwatchCss(colorOf(i))};margin-right:4px"></span>${escHtml(`${s.groupKey}: ${s.counts[b]}`)}`
        ).join('<br>');
        tooltip.innerHTML = `<strong>${escHtml(`${fmt(r.rangeLow, unit, 'engineering')} – ${fmt(r.rangeHigh, unit, 'engineering')}`)}</strong><br>${rows}`;
        tooltip.style.display = 'block';
        positionChartTooltip(tooltip, card, e.clientX, e.clientY);
      } else {
        tooltip.style.display = 'none';
      }
    });
    canvas.addEventListener('mouseleave', () => { if (hoveredBucket !== -1) { hoveredBucket = -1; draw(); } tooltip.style.display = 'none'; });

    resizeHandle = observeResize(card, () => draw());
    draw();
  }

  rebuildBody();

  function setTest(testNumber: number): void {
    // The guard and the control sync both live in `makeLinkedTestSelect` now.
    if (!testSel.set(testNumber)) return;
    activeTest = testNumber;
    rebuildBody();
  }

  /** Adopt a sibling panel's axis toggles without re-firing the change back. */
  function setAxisPrefs(prefs: AxisPrefs): void {
    // Guard and state both live in the control now.
    if (!axisCtl.set(prefs)) return;
    rebuildBody();
  }

  return { card, setTest, setAxisPrefs, destroy: () => resizeHandle?.disconnect() };
}
