// Histogram panel — bucket distribution for one parametric test on one item
// (typically a wafer) or all items, with spec-limit lines. Ported from
// tsmap's charts/histogram.ts.
//
// Grouping is a third distinct pattern from capability's restrict-dropdown
// and boxplot's drill-in-place (verified by reading tsmap's actual source,
// not assumed — see WMAP_ISSUES.md on why that check matters here):
// **overlaid multi-series** — every group drawn as a separate coloured
// series on one shared-bucket chart, with a legend to click-emphasize one
// series at a time (dimming the rest). The per-item "which wafer" selector
// is meaningless once grouped (a group pools all its items), so it's hidden
// in that mode, matching tsmap exactly.
//
// Trimmed from tsmap's version for this port: legend items use the native
// `title` attribute instead of porting tsmap's `attachTooltip` chrome
// helper (that's tsmap app chrome, not chart-panel logic).

import { buildTestHistogramData, buildTestHistogramSeries, type HistogramBucket, type HistogramItem, type HistogramSeriesData } from '../../stats/histogram.js';
import type { TestDef } from '../../renderer/buildWaferMap.js';
import { CLR } from '../toolbar.js';
import { fmt } from '../../renderer/fmt.js';
import { QUANTITY, categorical } from './palette.js';
import { cardShell, observeResize, makeTooltip, positionChartTooltip, makeTestSelect, makeWaferSelect, makeToggle, renderEmptyState, chartFillHeight, applyCanvasFlow, resolveChartCanvasColors, makeAxisFormat, PADDING, type SaveImageHandler } from './chartShell.js';
// `colorScheme` (HistogramPanelOptions) is deliberately no longer read —
// quantity/series colours are fixed (palette.ts); the option stays for API
// compatibility with existing callers.

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
  const rawStep = Math.max(1, maxCount / targetTicks);
  const mag = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const norm = rawStep / mag;
  const niceStep = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * mag;
  const plotH = plotBottom - plotTop;

  ctx.save();
  ctx.font = '10px system-ui, sans-serif';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for (let v = 0; v <= maxCount + 1e-9; v += niceStep) {
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
  title?: string;
  items: HistogramItem[];
  testDefs: TestDef[];
  selectedTestNumber?: number;
  colorScheme?: string;
  onSaveImage?: SaveImageHandler;
  /**
   * When the Analysis tab's "Group by" is active, this panel switches to an
   * overlaid multi-series view (one coloured series per group over shared
   * buckets, with a click-to-emphasize legend) instead of the single-item
   * view. `items` above is ignored when `groups` is provided. Absent ⇒
   * today's plain per-item view with a wafer selector.
   */
  groups?: { key: string; items: HistogramItem[] }[];
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
  destroy: () => void;
}

export function renderHistogramPanel(options: HistogramPanelOptions): HistogramPanelHandle {
  const { title = 'Test value distribution', items, testDefs, onSaveImage, groups } = options;
  const { card, body, controlsRow } = cardShell(title, onSaveImage, options.ownerDocument);

  const testOptions = testDefs.filter((d): d is TestDef & { testNumber: number } => d.testNumber !== undefined);
  let activeTest = options.selectedTestNumber ?? testOptions[0]?.testNumber ?? null;
  let activeItem: number | null = null; // index into `items`; null = all
  let axisIncludesLimits = false;

  const testSelect = makeTestSelect(testOptions, activeTest, n => { activeTest = n; rebuildBody(); }, { maxWidth: '200px', ownerDocument: card.ownerDocument });
  controlsRow.appendChild(testSelect);

  const itemSelect = makeWaferSelect(items, activeItem, i => { activeItem = i; rebuildBody(); }, { ownerDocument: card.ownerDocument });
  controlsRow.appendChild(itemSelect);

  controlsRow.appendChild(makeToggle('Axis includes limits', axisIncludesLimits, v => { axisIncludesLimits = v; rebuildBody(); }, card.ownerDocument));

  const tooltip = makeTooltip(card);
  let resizeHandle: { disconnect: () => void } | null = null;

  // Z-order / emphasis state for the faceted legend (group key clicked →
  // brought to front and fully opaque, others dimmed). Persists across
  // redraws; reset implicitly on a full card rebuild.
  let emphasizedGroup: string | null = null;

  function testMeta(testNumber: number): { unit?: string; limitLow?: number; limitHigh?: number } {
    const def = testDefs.find(d => d.testNumber === testNumber);
    return { unit: def?.unit, limitLow: def?.limitLow, limitHigh: def?.limitHigh };
  }

  function rebuildBody(): void {
    resizeHandle?.disconnect();
    resizeHandle = null;
    body.innerHTML = '';
    if (activeTest === null) {
      renderEmptyState(body, 'No parametric test data available for a histogram.');
      return;
    }

    // Faceted (grouped) view: overlaid series + legend. The item selector is
    // meaningless here (groups pool all their items), so hide it.
    const faceted = groups && groups.length > 0
      ? buildTestHistogramSeries(groups, activeTest, 16, axisIncludesLimits ? testMeta(activeTest).limitLow : undefined, axisIncludesLimits ? testMeta(activeTest).limitHigh : undefined)
      : null;
    itemSelect.style.display = faceted ? 'none' : '';
    if (faceted) {
      if (faceted.series.length === 0) {
        renderEmptyState(body, 'No parametric test data available for a histogram.');
        return;
      }
      renderFacetedSeries(faceted);
      return;
    }

    const scopedItems = activeItem !== null ? [items[activeItem]] : items;
    const { unit, limitLow, limitHigh } = testMeta(activeTest);
    const buckets = buildTestHistogramData(scopedItems, activeTest, 16, axisIncludesLimits ? limitLow : undefined, axisIncludesLimits ? limitHigh : undefined);

    if (buckets.length === 0) {
      renderEmptyState(body, 'No parametric test data available for a histogram.');
      return;
    }

    const maxCount = Math.max(...buckets.map(b => b.count), 1);

    const statsLabel = card.ownerDocument.createElement('div');
    Object.assign(statsLabel.style, { fontSize: '12px', color: CLR.label, marginBottom: '2px' } as Partial<CSSStyleDeclaration>);
    statsLabel.textContent = `max ${maxCount} dies/bucket`;
    body.appendChild(statsLabel);

    const canvas = card.ownerDocument.createElement('canvas');
    canvas.style.display = 'block';
    canvas.style.cursor = 'default';
    body.appendChild(canvas);

    let hovered = -1;
    const dpr = window.devicePixelRatio || 1;
    const bucketMin = buckets[0].rangeLow;
    const bucketMax = buckets[buckets.length - 1].rangeHigh;
    const bucketSpan = bucketMax - bucketMin || 1;
    const axis = makeAxisFormat(Math.max(Math.abs(bucketMin), Math.abs(bucketMax)), unit);

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
      applyCanvasFlow(canvas, statsLabel.offsetHeight);
      // body's own width, not card's — canvas fills body via applyCanvasFlow,
      // so measuring from it directly stays correct even when body has its
      // own vertical scrollbar narrowing it.
      const width = body.clientWidth;
      const height = chartFillHeight(card, body, canvas, HIST_HEIGHT);
      canvas.width = Math.max(1, Math.floor(width * dpr));
      canvas.height = Math.max(1, Math.floor(height * dpr));
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;

      const ctx = canvas.getContext('2d')!;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);
      ctx.font = '11px system-ui, sans-serif';

      const theme = resolveChartCanvasColors(card);
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
      ctx.font = '10px system-ui, sans-serif';
      for (const [limit, label] of [[limitLow, 'LSL'], [limitHigh, 'USL']] as const) {
        if (limit === undefined) continue;
        const x = xForVal(limit);
        ctx.strokeStyle = theme.warnBorder;
        ctx.setLineDash([3, 3]);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x, plotTop); ctx.lineTo(x, plotBottom);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = theme.warnBorder;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.fillText(label, x, plotTop - 2);
      }
      ctx.font = '11px system-ui, sans-serif';

      ctx.strokeStyle = theme.border;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(plotX, plotBottom); ctx.lineTo(plotX + plotMaxWidth, plotBottom);
      ctx.stroke();

      ctx.fillStyle = theme.textMuted;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      const minLabelPx = 44;
      const maxLabels = Math.max(2, Math.floor(plotMaxWidth / minLabelPx));
      const rawStep = Math.ceil(buckets.length / maxLabels);
      const labelStep = Math.max(1, rawStep);
      for (let i = 0; i <= buckets.length; i += labelStep) {
        const value = i < buckets.length ? buckets[i].rangeLow : buckets[buckets.length - 1].rangeHigh;
        const x = plotX + i * barWidth;
        ctx.beginPath();
        ctx.moveTo(x, plotBottom); ctx.lineTo(x, plotBottom + 4);
        ctx.stroke();
        ctx.fillText(axis.tick(value), x, plotBottom + 6);
      }
      if (axis.unitLabel) {
        ctx.save();
        ctx.font = '10px system-ui, sans-serif';
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
        tooltip.innerHTML = `<strong>${fmt(b.rangeLow, unit, 'engineering')} – ${fmt(b.rangeHigh, unit, 'engineering')}</strong><br>${b.count} dies`;
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

    if (emphasizedGroup && !series.some(s => s.groupKey === emphasizedGroup)) emphasizedGroup = null;

    const maxCount = Math.max(1, ...series.flatMap(s => s.counts));

    const statsLabel = card.ownerDocument.createElement('div');
    Object.assign(statsLabel.style, { fontSize: '12px', color: CLR.label, marginBottom: '2px' } as Partial<CSSStyleDeclaration>);
    statsLabel.textContent = `${series.length} groups · max ${maxCount} dies/bucket`;
    body.appendChild(statsLabel);

    const legend = card.ownerDocument.createElement('div');
    Object.assign(legend.style, { display: 'flex', flexWrap: 'wrap', gap: '4px 12px', marginBottom: '4px' } as Partial<CSSStyleDeclaration>);
    series.forEach((s, i) => {
      const item = card.ownerDocument.createElement('button');
      item.type = 'button';
      item.title = `${s.groupKey} — click to emphasize (dim the rest)`;
      Object.assign(item.style, { display: 'inline-flex', alignItems: 'center', gap: '5px', fontSize: '11px', padding: '1px 4px', border: 'none', background: 'none', cursor: 'pointer', color: CLR.text, borderRadius: '3px' } as Partial<CSSStyleDeclaration>);
      const sw = card.ownerDocument.createElement('span');
      Object.assign(sw.style, { width: '10px', height: '10px', borderRadius: '2px', background: colorOf(i), flex: '0 0 auto' } as Partial<CSSStyleDeclaration>);
      const txt = card.ownerDocument.createElement('span');
      txt.textContent = s.groupKey;
      item.append(sw, txt);
      const dim = emphasizedGroup !== null && emphasizedGroup !== s.groupKey;
      item.style.opacity = dim ? '0.45' : '1';
      if (emphasizedGroup === s.groupKey) item.style.background = CLR.bgHover;
      // Which group is emphasized was only conveyed by opacity/background —
      // aria-pressed exposes the same on/off state to a screen reader.
      item.setAttribute('aria-pressed', emphasizedGroup === s.groupKey ? 'true' : 'false');
      item.addEventListener('click', () => { emphasizedGroup = emphasizedGroup === s.groupKey ? null : s.groupKey; rebuildBody(); });
      legend.appendChild(item);
    });
    body.appendChild(legend);

    const canvas = card.ownerDocument.createElement('canvas');
    canvas.style.display = 'block';
    canvas.style.cursor = 'default';
    body.appendChild(canvas);

    const dpr = window.devicePixelRatio || 1;
    const bucketMin = ranges[0].rangeLow;
    const bucketMax = ranges[ranges.length - 1].rangeHigh;
    const bucketSpan = bucketMax - bucketMin || 1;
    const axis = makeAxisFormat(Math.max(Math.abs(bucketMin), Math.abs(bucketMax)), unit);
    const siblingH = () => statsLabel.offsetHeight + legend.offsetHeight;

    let hoveredBucket = -1;
    let facetGeom = { plotX: PADDING + 36, plotMaxWidth: 10, barWidth: 10 };

    function draw() {
      applyCanvasFlow(canvas, siblingH());
      // body's own width, not card's — canvas fills body via applyCanvasFlow,
      // so measuring from it directly stays correct even when body has its
      // own vertical scrollbar narrowing it.
      const width = body.clientWidth;
      const height = chartFillHeight(card, body, canvas, HIST_HEIGHT);
      canvas.width = Math.max(1, Math.floor(width * dpr));
      canvas.height = Math.max(1, Math.floor(height * dpr));
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;

      const ctx = canvas.getContext('2d')!;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);
      ctx.font = '11px system-ui, sans-serif';

      const theme = resolveChartCanvasColors(card);
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
      ctx.font = '10px system-ui, sans-serif';
      for (const [limit, label] of [[limitLow, 'LSL'], [limitHigh, 'USL']] as const) {
        if (limit === undefined) continue;
        const x = xForVal(limit);
        ctx.strokeStyle = theme.warnBorder;
        ctx.setLineDash([3, 3]);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x, plotTop); ctx.lineTo(x, plotBottom);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = theme.warnBorder;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.fillText(label, x, plotTop - 2);
      }
      ctx.font = '11px system-ui, sans-serif';

      ctx.strokeStyle = theme.border;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(plotX, plotBottom); ctx.lineTo(plotX + plotMaxWidth, plotBottom);
      ctx.stroke();

      ctx.fillStyle = theme.textMuted;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      const minLabelPx = 44;
      const maxLabels = Math.max(2, Math.floor(plotMaxWidth / minLabelPx));
      const labelStep = Math.max(1, Math.ceil(ranges.length / maxLabels));
      for (let b = 0; b <= ranges.length; b += labelStep) {
        const value = b < ranges.length ? ranges[b].rangeLow : ranges[ranges.length - 1].rangeHigh;
        const x = plotX + b * barWidth;
        ctx.beginPath();
        ctx.moveTo(x, plotBottom); ctx.lineTo(x, plotBottom + 4);
        ctx.stroke();
        ctx.fillText(axis.tick(value), x, plotBottom + 6);
      }
      if (axis.unitLabel) {
        ctx.save();
        ctx.font = '10px system-ui, sans-serif';
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
          `<span style="display:inline-block;width:9px;height:9px;border-radius:2px;background:${colorOf(i)};margin-right:5px;"></span>${s.groupKey}: ${s.counts[b]}`
        ).join('<br>');
        tooltip.innerHTML = `<strong>${fmt(r.rangeLow, unit, 'engineering')} – ${fmt(r.rangeHigh, unit, 'engineering')}</strong><br>${rows}`;
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
    if (!testOptions.some(t => t.testNumber === testNumber) || testNumber === activeTest) return;
    activeTest = testNumber;
    testSelect.value = String(testNumber);
    rebuildBody();
  }

  return { card, setTest, destroy: () => resizeHandle?.disconnect() };
}
