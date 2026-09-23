// Wafer-to-wafer trend for one parametric test — mean per wafer in slot order,
// with ±1σ whiskers, the pooled population mean as a centre line, and spec
// limits when the test has them.
//
// The Insights suite had no trend view at all. Boxplot comes closest but answers
// a different question: it shows how a test is distributed WITHIN each wafer, its
// rows are read individually, and it sorts and drills them. Drift across a lot —
// a tool warming up, a chamber degrading, a bad cassette position — is only
// visible when the x axis is the physical sequence and there is a stable
// reference to judge movement against. That is this chart.
//
// Deliberately has no sort control. Slot order IS the chart; offering to destroy
// it would be offering to remove the only signal it carries.

import { buildTestTrendData, trendCentre, type TrendDatum, type TrendItem } from '../../stats/trend.js';
import { isParametricTest, type TestDef } from '../../renderer/buildWaferMap.js';
import { fmt } from '../../renderer/fmt.js';
import { SPACE, fontPx, FONT, CLR } from '../toolbar.js';
import { QUANTITY } from './palette.js';
import { cardShell, observeResize, makeTooltip, positionChartTooltip, makeLinkedTestSelect, makeLinkedAxisPrefs, renderEmptyState, chartFillHeight, PADDING, resolveAxisRange, shouldIncludeLimitsByDefault, drawOffAxisLimits, makeAxisFormat, VERTICAL_TICK_SPACING_PX, type AxisPrefs, type SaveImageHandler, type WaferContextMenuHandler, WAFER_MENU_HINT, prepareCanvas } from './chartShell.js';
import { fitTicks } from '../../renderer/axisTicks.js';
import { escHtml } from '../../core/utils.js';

const PLOT_H = 220;
const AXIS_W = 56;
const LABEL_H = 34;
const POINT_R = 3.5;

export interface TrendPanelOptions {
  title?: string;
  items: TrendItem[];
  testDefs: TestDef[];
  selectedTestNumber?: number;
  onSaveImage?: SaveImageHandler;
  /** Click a point to open that wafer's map on this test. */
  onOpen?: (key: number, testNumber: number) => void;
  /** Right-click on a wafer's point — see `WaferContextMenuHandler`. */
  onWaferContextMenu?: WaferContextMenuHandler;
  /**
   * What the dashed reference line is, as a noun phrase — "lot mean" when the
   * items are one lot, else "mean of all wafers" (see stats/population.ts).
   * The panel sees no wafer metadata, so the host names it. Default
   * "mean of all wafers", which is true of any set.
   */
  centreLabel?: string;
  /** Initial axis toggles, shared with the sibling distribution panels. */
  axisPrefs?: AxisPrefs;
  /** Fired when the user changes an axis toggle here, so siblings can follow. */
  onAxisPrefsChange?: (prefs: AxisPrefs) => void;
  /** Fired when the USER picks a test here, so siblings can follow. Not fired
   *  by `setTest`, which is how a broadcast avoids bouncing back. */
  onTestChange?: (testNumber: number) => void;
  ownerDocument?: Document;
}

export interface TrendPanelHandle {
  card: HTMLElement;
  destroy: () => void;
  /** Cross-panel link — switch the displayed test in place. */
  setTest: (testNumber: number) => void;
  /** Adopt the shared axis toggles (see `AxisPrefs`). */
  setAxisPrefs: (prefs: AxisPrefs) => void;
}

export function renderTrendPanel(options: TrendPanelOptions): TrendPanelHandle {
  const { items, testDefs, onSaveImage, onOpen, centreLabel = 'mean of all wafers' } = options;
  const title = options.title ?? 'Wafer-to-wafer trend';
  const { card, body, controlsRow } = cardShell(title, onSaveImage, options.ownerDocument);
  // Same reason as boxplot's: opt out of grid stretch so growCardToFitContent's
  // measured overhead stays stable across redraws.
  card.style.alignSelf = 'start';

  const testOptions = testDefs.filter((d): d is TestDef & { testNumber: number } =>
    d.testNumber !== undefined && isParametricTest(d));
  let activeTest = options.selectedTestNumber ?? testOptions[0]?.testNumber ?? null;
  let lastClippedCount = 0;

  const testSel = makeLinkedTestSelect(testOptions, activeTest, n => {
    activeTest = n;
    rebuild();
    options.onTestChange?.(n);
  }, { maxWidth: '240px', emptyText: 'No parametric tests', ownerDocument: card.ownerDocument });
  controlsRow.appendChild(testSel.el);
  const axisTogglesRow = card.ownerDocument.createElement('span');
  Object.assign(axisTogglesRow.style, { display: 'inline-flex', gap: SPACE.lg, alignItems: 'center' } as Partial<CSSStyleDeclaration>);
  controlsRow.appendChild(axisTogglesRow);
  // The toggles, their state, and the notify — one shared control instead of
  // a copy in each of the three panels that offers them.
  const axisCtl = makeLinkedAxisPrefs(axisTogglesRow, options.axisPrefs, prefs => {
    options.onAxisPrefsChange?.(prefs);
    rebuild();
  }, card.ownerDocument);


  const hint = card.ownerDocument.createElement('div');
  Object.assign(hint.style, { color: CLR.label, fontSize: FONT.body, marginBottom: SPACE.sm } as Partial<CSSStyleDeclaration>);
  card.insertBefore(hint, body);

  const tooltip = makeTooltip(card);
  let resizeHandle: { disconnect: () => void } | null = null;
  let data: TrendDatum[] = [];

  function defOf(testNumber: number): TestDef | undefined {
    return testOptions.find(d => d.testNumber === testNumber);
  }

  function rebuild(): void {
    // Read once per rebuild from the shared control, which owns this state.
    const { includeLimits: axisIncludesLimits, clipOutliers } = axisCtl.get();
    body.innerHTML = '';
    resizeHandle?.disconnect();
    resizeHandle = null;

    if (testOptions.length === 0 || activeTest === null) {
      hint.textContent = '';
      renderEmptyState(body, 'No parametric test data available for a trend.');
      return;
    }
    if (items.length < 2) {
      hint.textContent = '';
      // One wafer is not a trend, and drawing a single point implies a sequence
      // that does not exist.
      renderEmptyState(body, 'A wafer-to-wafer trend needs at least two wafers.');
      return;
    }

    data = buildTestTrendData(items, activeTest);
    if (!data.some(d => d.count > 0)) {
      hint.textContent = '';
      renderEmptyState(body, 'No values recorded for this test.');
      return;
    }

    const def = defOf(activeTest);
    const centre = trendCentre(data);
    // The clipped count is only known once `draw` has resolved the axis range,
    // so writing it here read the PREVIOUS render's value — the note was one
    // interaction stale, and absent entirely the first time "Clip outliers" was
    // ticked. `draw` calls this after assigning `lastClippedCount`.
    const syncHint = () => {
      hint.textContent = `Point = wafer mean, whisker = ±1σ, dashed = ${centreLabel} · wafers in slot order`
        + (onOpen ? ' · click a point to open that wafer' : '')
        + (lastClippedCount ? ` · axis clipped, ${lastClippedCount} outside` : '');
    };
    syncHint();

    const canvas = card.ownerDocument.createElement('canvas');
    canvas.style.display = 'block';
    body.appendChild(canvas);

    // Geometry as last DRAWN — never re-derived. Declared above `draw`, which
    // assigns it, so no temporal-dead-zone hazard if the call order changes.
    let plotGeom: { left: number; step: number } | null = null;

    const draw = () => {
      const width = Math.max(1, body.clientWidth);
      // Fill the space the card actually has (the expand modal gives it a lot),
      // falling back to PLOT_H as a floor. This chart previously drew a fixed
      // 220px plot no matter how much room it was given, so expanding it added
      // whitespace rather than resolution — exactly what an expand is for.
      const height = Math.max(PLOT_H, chartFillHeight(card, body, canvas, PLOT_H));
      const prep = prepareCanvas(canvas, card, width, height);
      if (!prep) return;
      const { ctx, theme } = prep;

      // Range covers every mean ± its own σ, so a whisker is never clipped by the
      // range itself.
      let dataLo = Infinity, dataHi = -Infinity;
      const extremes: number[] = [];
      for (const d of data) {
        if (!d.count || !Number.isFinite(d.mean)) continue;
        dataLo = Math.min(dataLo, d.mean - d.stddev);
        dataHi = Math.max(dataHi, d.mean + d.stddev);
        extremes.push(d.mean - d.stddev, d.mean + d.stddev);
      }
      if (!Number.isFinite(dataLo) || !Number.isFinite(dataHi)) return;

      const resolvedIncludeLimits = axisIncludesLimits
        ?? shouldIncludeLimitsByDefault(dataLo, dataHi, def?.limitLow, def?.limitHigh);
      axisCtl.sync(resolvedIncludeLimits, def?.limitLow !== undefined || def?.limitHigh !== undefined);

      const range = resolveAxisRange({
        dataMin: dataLo, dataMax: dataHi,
        limitLow: def?.limitLow, limitHigh: def?.limitHigh,
        includeLimits: resolvedIncludeLimits,
        clipOutliers,
        values: extremes,
      });
      lastClippedCount = range.clippedCount;
      syncHint();   // now that the axis range is resolved
      let lo = range.lo, hi = range.hi;
      const pad = (hi - lo) * 0.08;
      lo -= pad; hi += pad;

      const plotLeft = PADDING + AXIS_W;
      // Reserve half the widest end-label so the first and last labels, which
      // are CENTRED on their points, don't overflow the canvas. The last point
      // sits exactly on plotRight, so without this half its label is clipped.
      ctx.font = `${fontPx(-1)}px system-ui, sans-serif`;
      const shortLabel = (l: string) => (l.length > 8 ? `${l.slice(0, 7)}…` : l);
      const endLabelHalf = data.length
        ? Math.ceil(Math.max(
            ctx.measureText(shortLabel(data[0].label)).width,
            ctx.measureText(shortLabel(data[data.length - 1].label)).width,
          ) / 2)
        : 0;
      const plotRight = width - PADDING - endLabelHalf;
      const plotTop = PADDING;
      const plotBottom = height - LABEL_H;
      const yOf = (v: number) => plotBottom - ((v - lo) / (hi - lo)) * (plotBottom - plotTop);
      const step = data.length > 1 ? (plotRight - plotLeft) / (data.length - 1) : 0;
      // Publish what was actually drawn. Hit-testing used to re-derive this
      // from the same formula, which silently diverged the moment `draw`
      // began reserving `endLabelHalf` on the right — every click then
      // resolved to a neighbouring point and opened the wrong wafer.
      plotGeom = { left: plotLeft, step };
      const xOf = (i: number) => data.length > 1 ? plotLeft + i * step : (plotLeft + plotRight) / 2;

      // Axis
      ctx.strokeStyle = theme.border;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(plotLeft, plotTop);
      ctx.lineTo(plotLeft, plotBottom);
      ctx.lineTo(plotRight, plotBottom);
      ctx.stroke();

      ctx.fillStyle = theme.text;
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      // Round values, labelled to their step with the unit on each tick.
      const yTicks = fitTicks(lo, hi, plotBottom - plotTop, () => VERTICAL_TICK_SPACING_PX);
      const yAxis = makeAxisFormat(Math.max(Math.abs(lo), Math.abs(hi)), def?.unit, yTicks.step || undefined);
      for (const v of yTicks.ticks) ctx.fillText(yAxis.tickWithUnit(v), plotLeft - 6, yOf(v));

      // A limit outside the plotted range gets an edge marker rather than being
      // silently absent — otherwise "off-screen" reads as "this test has no limits".
      drawOffAxisLimits(ctx, range.offAxis,
        { left: plotLeft, right: plotRight, top: plotTop, bottom: plotBottom },
        'vertical', theme.limitLine, v => fmt(v, def?.unit));

      // Spec limits first, so data draws over them.
      for (const [limit, label] of [[def?.limitLow, 'LSL'], [def?.limitHigh, 'USL']] as const) {
        if (limit === undefined || limit < lo || limit > hi) continue;
        const y = yOf(limit);
        ctx.save();
        // theme.limitLine, not CLR.errText — `CLR.*` are `var(--wmap-…)` strings
        // for CSS and canvas cannot resolve a custom property, so the assignment
        // is silently ignored and the line keeps the previous colour. This is also
        // the colour histogram and boxplot already draw their LSL/USL lines in.
        ctx.strokeStyle = theme.limitLine;
        ctx.globalAlpha = 0.7;
        ctx.setLineDash([4, 3]);
        ctx.beginPath();
        ctx.moveTo(plotLeft, y);
        ctx.lineTo(plotRight, y);
        ctx.stroke();
        ctx.restore();
        ctx.save();
        ctx.fillStyle = theme.limitLine;
        ctx.textAlign = 'left';
        ctx.fillText(label, plotLeft + 3, y - 6);
        ctx.restore();
      }

      // Lot mean.
      if (centre !== null && centre >= lo && centre <= hi) {
        const y = yOf(centre);
        ctx.save();
        ctx.strokeStyle = theme.text;
        ctx.globalAlpha = 0.5;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(plotLeft, y);
        ctx.lineTo(plotRight, y);
        ctx.stroke();
        ctx.restore();
      }

      // Connecting line across wafers that have data. Broken across a gap
      // rather than bridged — bridging would draw a trend through a wafer that
      // contributed nothing.
      ctx.strokeStyle = QUANTITY;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      let penDown = false;
      data.forEach((d, i) => {
        if (!d.count || !Number.isFinite(d.mean)) { penDown = false; return; }
        const x = xOf(i), y = yOf(d.mean);
        if (penDown) ctx.lineTo(x, y); else ctx.moveTo(x, y);
        penDown = true;
      });
      ctx.stroke();

      // Whiskers + points.
      data.forEach((d, i) => {
        if (!d.count || !Number.isFinite(d.mean)) return;
        const x = xOf(i);
        if (d.stddev > 0) {
          ctx.save();
          ctx.strokeStyle = QUANTITY;
          ctx.globalAlpha = 0.55;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(x, yOf(d.mean - d.stddev));
          ctx.lineTo(x, yOf(d.mean + d.stddev));
          ctx.stroke();
          ctx.restore();
        }
        ctx.fillStyle = QUANTITY;
        ctx.beginPath();
        ctx.arc(x, yOf(d.mean), POINT_R, 0, Math.PI * 2);
        ctx.fill();
      });

      // X labels — thinned so they never overlap, since a 25-wafer lot cannot
      // fit 25 labels at this width.
      ctx.fillStyle = theme.text;
      ctx.textBaseline = 'top';
      ctx.textAlign = 'center';
      const everyNth = Math.max(1, Math.ceil((data.length * 42) / Math.max(1, plotRight - plotLeft)));
      data.forEach((d, i) => {
        if (i % everyNth !== 0 && i !== data.length - 1) return;
        const label = d.label.length > 8 ? `${d.label.slice(0, 7)}…` : d.label;
        ctx.fillText(label, xOf(i), plotBottom + 6);
      });

      // No second request of the drawn height here: chartFillHeight has asked
      // for the floor, and asking for what the card was GIVEN would stop it
      // shrinking when the expand modal is made smaller.
    };

    const indexAt = (e: MouseEvent): number => {
      if (!plotGeom || plotGeom.step <= 0) return -1;
      const rect = canvas.getBoundingClientRect();
      const i = Math.round((e.clientX - rect.left - plotGeom.left) / plotGeom.step);
      return i >= 0 && i < data.length && data[i].count > 0 ? i : -1;
    };

    canvas.addEventListener('mousemove', e => {
      const i = indexAt(e);
      if (i < 0) { tooltip.style.display = 'none'; canvas.style.cursor = 'default'; return; }
      const d = data[i];
      canvas.style.cursor = onOpen && d.key !== undefined ? 'pointer' : 'default';
      tooltip.innerHTML = `<strong>${escHtml(d.label)}</strong><br>`
        + escHtml(`mean ${fmt(d.mean, def?.unit)} · σ ${fmt(d.stddev, def?.unit)}`) + '<br>'
        + `n = ${d.count.toLocaleString()}`
        + (centre !== null ? '<br>' + escHtml(`Δ vs ${centreLabel} ${d.mean - centre >= 0 ? '+' : ''}${fmt(d.mean - centre, def?.unit)}`) : '')
        + (onOpen && d.key !== undefined ? '<br><em>click to open this wafer</em>' : '')
        + (options.onWaferContextMenu && d.key !== undefined ? WAFER_MENU_HINT : '');
      tooltip.style.display = 'block';
      positionChartTooltip(tooltip, card, e.clientX, e.clientY);
    });
    canvas.addEventListener('mouseleave', () => { tooltip.style.display = 'none'; });
    canvas.addEventListener('click', e => {
      const i = indexAt(e);
      if (i < 0 || !onOpen) return;
      const d = data[i];
      if (d.key !== undefined && activeTest !== null) onOpen(d.key, activeTest);
    });
    canvas.addEventListener('contextmenu', e => {
      const i = indexAt(e);
      const key = i < 0 ? undefined : data[i].key;
      if (key === undefined || !options.onWaferContextMenu) return;
      tooltip.style.display = 'none';
      options.onWaferContextMenu(key, activeTest ?? undefined, e);
    });

    draw();
    resizeHandle = observeResize(body, draw);
  }

  rebuild();

  return {
    card,
    destroy: () => { resizeHandle?.disconnect(); tooltip.remove(); card.remove(); },
    // Through the shared selector, so the CONTROL follows too. This used to
    // assign `activeTest` and rebuild, leaving the selector showing the test
    // the panel had stopped displaying.
    setTest: (testNumber: number) => {
      if (!testSel.set(testNumber)) return;
      activeTest = testNumber;
      rebuild();
    },
    setAxisPrefs: (prefs: AxisPrefs) => {
      if (!axisCtl.set(prefs)) return;
      rebuild();
    },
  };
}
