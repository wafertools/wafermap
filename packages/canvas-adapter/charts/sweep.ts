// Parametric sweep panel — two or more response curves over an ordered run of
// tests, with the crossing point and the separation at named levels.
//
// The question it answers is about the PAIR of curves, not either one: where a
// rising and a falling response meet, and how far apart they are at a given
// level. That is why the crossing and the separations are drawn on the plot and
// restated in the footer rather than left for the reader to eyeball — a crossing
// read off a chart by eye is exactly the measurement an engineer would otherwise
// export the data to get.
//
// Each line is the population median with a p10–p90 band, never one trace per
// die: a production lot is thousands of dies, and the per-die view of the same
// data is better served by plotting a derived scalar on the wafer map, where
// position is visible.

import { buildSweepData, sweepAppliesTo, type SweepData, type SweepSpec, type SweepPoint } from '../../stats/sweep.js';
import type { Die } from '../../core/dies.js';
import type { TestDef } from '../../renderer/buildWaferMap.js';
import { fmt } from '../../renderer/fmt.js';
import { SPACE, fontPx, FONT, CLR, ALPHA } from '../toolbar.js';
import { categorical } from './palette.js';
import {
  cardShell, observeResize, makeTooltip, positionChartTooltip, renderEmptyState,
  chartFillHeight, populationPhrase, PADDING, prepareCanvas, makeAxisFormat, VERTICAL_TICK_SPACING_PX, type SaveImageHandler,
} from './chartShell.js';
import { fitTicks } from '../../renderer/axisTicks.js';
import { escHtml } from '../../core/utils.js';
import { unmarkedLabel, derivedTestNote, DERIVED_MARK, DERIVED_KEY } from '../../renderer/testLabel.js';

/**
 * An x value as the card prints it — ticks, crossing and widths alike. With an
 * `xUnit`, SI-prefixed through `fmt` (`47.3 kΩ`), the way the y axis prints.
 * Without one, plain decimals to three significant figures (`0.0327`, `0.55`,
 * `518`), never `fmt`'s engineering notation: with no unit to carry a prefix,
 * `fmt` printed a 33 mV width as `32.7E-3`.
 */
function fmtX(v: number, xUnit?: string): string {
  // Trailing zeros dropped: a swept level of 2 kΩ is not "2.00 kΩ", which
  // claims a precision the level never had. Measured values keep theirs.
  if (xUnit) return fmt(v, xUnit).replace(/(\.\d*?)0+(?=\D|$)/, '$1').replace(/\.(?=\D|$)/, '');
  if (Number.isInteger(v)) return String(v);
  return String(Number(v.toPrecision(3)));
}

/**
 * An ordinal tick's text: the derived mark, then the test name cut to fit — the
 * name is truncated, never the mark, so a cut can never remove the one glyph that
 * says the value was not measured.
 */
function tickText(p: SweepPoint): string {
  const name = unmarkedLabel(p.label);
  const short = name.length > 9 ? `${name.slice(0, 8)}…` : name;
  return p.derived ? `${DERIVED_MARK} ${short}` : short;
}

const PLOT_H = 260;
const AXIS_W = 62;
const LABEL_H = 56;   // tick labels + the x axis title beneath them
const POINT_R = 3;

export interface SweepPanelOptions {
  /** The curve definition. Title comes from here, not from the panel. */
  spec: SweepSpec;
  /** Population to aggregate over — already scoped by the caller. Scope is not
   *  a property of the sweep: the same definition is valid for any population,
   *  which is what keeps a saved spec portable. */
  dies: Die[];
  /**
   * Who `dies` are, read straight after the count — `"selected on W03"` gives
   * "median across 12 dies selected on W03". Omit when the dies are simply the
   * view's own population (the Insights tab, which states its scope itself).
   * A sweep of a hand-picked subset looks exactly like a whole-wafer one, so
   * a drilldown must always pass this.
   */
  population?: string;
  testDefs: TestDef[] | undefined;
  onSaveImage?: SaveImageHandler;
  ownerDocument?: Document;
}

export interface SweepPanelHandle {
  card: HTMLElement;
  destroy: () => void;
  /** Re-aggregate over a new population, keeping the same curve definition. */
  setDies: (dies: Die[]) => void;
}

/** Unit of the first test of the first series — what the y axis is in. Read
 *  from the built data, where ranges are already expanded to test numbers. */
function yUnit(data: SweepData, testDefs: TestDef[] | undefined): string | undefined {
  const first = data.series[0]?.points[0]?.testNumber;
  return first === undefined ? undefined : testDefs?.find(d => d.testNumber === first)?.unit;
}

export function renderSweepPanel(options: SweepPanelOptions): SweepPanelHandle {
  const { spec, testDefs, onSaveImage, population } = options;
  let dies = options.dies;


  const { card, body } = cardShell(spec.title, onSaveImage, options.ownerDocument);
  card.style.alignSelf = 'start';
  const doc = card.ownerDocument;

  const hint = doc.createElement('div');
  Object.assign(hint.style, { color: CLR.label, fontSize: FONT.body, marginBottom: SPACE.sm } as Partial<CSSStyleDeclaration>);
  card.insertBefore(hint, body);

  const footer = doc.createElement('div');
  Object.assign(footer.style, { color: CLR.label, fontSize: FONT.body, marginTop: SPACE.sm } as Partial<CSSStyleDeclaration>);
  card.appendChild(footer);

  const tooltip = makeTooltip(card);
  let resizeHandle: { disconnect: () => void } | null = null;
  let data: SweepData | null = null;
  let unit: string | undefined;

  /** Colour for series `i` — the caller's own, else the CVD-safe categorical
   *  palette. A hardcoded hex in a shared spec would not theme, so it is a
   *  deliberate override rather than the normal case. */
  const colorOf = (i: number): string => spec.series[i]?.color ?? categorical(i);

  function rebuild(): void {
    body.innerHTML = '';
    footer.innerHTML = '';
    resizeHandle?.disconnect();
    resizeHandle = null;

    if (spec.series.length === 0) {
      hint.textContent = '';
      renderEmptyState(body, 'This sweep defines no series.');
      return;
    }

    data = buildSweepData(dies, testDefs, spec);
    unit = yUnit(data, testDefs);
    const plotted = data.series.filter(s => s.points.some(p => p.count > 0));
    if (plotted.length === 0) {
      hint.textContent = '';
      // Two different situations: tests that exist but hold no values here,
      // and a sweep naming no test of this data at all — typically one kept
      // from another test program. The second says so, rather than reading as
      // an empty measurement.
      renderEmptyState(body, sweepAppliesTo(spec, testDefs)
        ? 'No values recorded for the tests in this sweep.'
        : 'None of this sweep’s tests are in this data — it may belong to another test program.');
      writeFooter();
      return;
    }

    // Names the population and what a line is, so nobody reads the band as a
    // spec limit or the line as a single die.
    hint.textContent = `Line = median across ${populationPhrase(data.dieCount, dies.length, population)}, band = p10–p90`
      + (spec.series.length > 2 ? ' · crossing and separation measured between the first two series' : '');

    const canvas = doc.createElement('canvas');
    canvas.style.display = 'block';
    body.appendChild(canvas);

    let geom: { left: number; right: number; xLo: number; xHi: number; yOf: (v: number) => number; ax: (v: number) => number } | null = null;

    const draw = (): void => {
      const d = data;
      if (d === null) return;
      const width = Math.max(1, body.clientWidth);
      const height = Math.max(PLOT_H, chartFillHeight(card, body, canvas, PLOT_H));
      const prep = prepareCanvas(canvas, card, width, height);
      if (!prep) return;
      const { ctx, theme } = prep;

      // x in axis space: log10 on a log axis, so every position below — points,
      // bands, ticks, the crossing marker — is placed by the one mapping `xOf`.
      const ax = (v: number): number => d.xScale === 'log' ? Math.log10(v) : v;
      // Y range spans every band, so a p90 is never clipped by the range itself.
      let lo = Infinity, hi = -Infinity, xLo = Infinity, xHi = -Infinity;
      for (const s of d.series) {
        for (const p of s.points) {
          if (p.count === 0) continue;
          lo = Math.min(lo, p.p10); hi = Math.max(hi, p.p90);
          xLo = Math.min(xLo, ax(p.x)); xHi = Math.max(xHi, ax(p.x));
        }
      }
      // Separation levels are part of the question, so they must be on screen
      // even when they sit outside the measured spread.
      for (const s of d.separations) { lo = Math.min(lo, s.y); hi = Math.max(hi, s.y); }
      if (!Number.isFinite(lo) || !Number.isFinite(hi)) return;
      if (lo === hi) { lo -= 1; hi += 1; }
      const pad = (hi - lo) * 0.08;
      lo -= pad; hi += pad;
      if (xLo === xHi) { xLo -= 0.5; xHi += 0.5; }
      if (d.xScale === 'log') {
        // A little room either side, so the end points are not on the frame.
        const padX = (xHi - xLo) * 0.03;
        xLo -= padX; xHi += padX;
      }

      ctx.font = `${fontPx(-1)}px system-ui, sans-serif`;
      const plotLeft = PADDING + AXIS_W;
      const plotRight = width - PADDING - 8;
      const plotTop = PADDING;
      const plotBottom = height - LABEL_H;
      const yOf = (v: number): number => plotBottom - ((v - lo) / (hi - lo)) * (plotBottom - plotTop);
      const xOf = (v: number): number => plotLeft + ((ax(v) - xLo) / (xHi - xLo)) * (plotRight - plotLeft);
      geom = { left: plotLeft, right: plotRight, xLo, xHi, yOf, ax };

      // Axes
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
      // Round values, labelled to their step with the unit on each tick — the
      // quarter-fractions of the data range this used printed 2.54 / 2.04 /
      // 1.53 GHz, values no one would choose.
      const yTicks = fitTicks(lo, hi, plotBottom - plotTop, () => VERTICAL_TICK_SPACING_PX);
      const yAxis = makeAxisFormat(Math.max(Math.abs(lo), Math.abs(hi)), unit, yTicks.step || undefined);
      for (const v of yTicks.ticks) ctx.fillText(yAxis.tickWithUnit(v), plotLeft - 6, yOf(v));

      // Separation levels, under the data.
      for (const s of d.separations) {
        const y = yOf(s.y);
        ctx.save();
        ctx.strokeStyle = theme.limitLine;
        ctx.globalAlpha = 0.55;
        ctx.setLineDash([4, 3]);
        ctx.beginPath();
        ctx.moveTo(plotLeft, y);
        ctx.lineTo(plotRight, y);
        ctx.stroke();
        ctx.restore();
      }

      // Bands first, then lines, then points — so a band never hides a curve.
      d.series.forEach((s, si) => {
        const usable = s.points.filter(p => p.count > 0);
        if (usable.length < 2) return;
        ctx.save();
        ctx.fillStyle = colorOf(si);
        ctx.globalAlpha = 0.14;
        ctx.beginPath();
        usable.forEach((p, i) => { const x = xOf(p.x), y = yOf(p.p90); i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y); });
        for (let i = usable.length - 1; i >= 0; i--) {
          const p = usable[i]!;
          ctx.lineTo(xOf(p.x), yOf(p.p10));
        }
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      });

      d.series.forEach((s, si) => {
        ctx.strokeStyle = colorOf(si);
        ctx.lineWidth = 1.75;
        ctx.beginPath();
        let penDown = false;
        for (const p of s.points) {
          // A gap is broken, never bridged: bridging would draw a response
          // through a test that measured nothing.
          if (p.count === 0) { penDown = false; continue; }
          const x = xOf(p.x), y = yOf(p.median);
          penDown ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
          penDown = true;
        }
        ctx.stroke();

        ctx.fillStyle = colorOf(si);
        for (const p of s.points) {
          if (p.count === 0) continue;
          ctx.beginPath();
          ctx.arc(xOf(p.x), yOf(p.median), POINT_R, 0, Math.PI * 2);
          ctx.fill();
        }
      });

      // Crossing marker — a ring plus a drop line, so it reads at a glance and
      // its x is legible against the axis.
      if (d.crossing) {
        const cx = xOf(d.crossing.x), cy = yOf(d.crossing.y);
        ctx.save();
        ctx.strokeStyle = theme.text;
        ctx.globalAlpha = 0.45;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(cx, cy); ctx.lineTo(cx, plotBottom);
        ctx.stroke();
        ctx.restore();
        ctx.save();
        ctx.strokeStyle = theme.text;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(cx, cy, 5.5, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }

      // X ticks. When the caller supplied real swept values the axis IS that
      // quantity, so the ticks are numbers; otherwise the positions are ordinals
      // and the ticks must be the test labels — numbering them 0, 1, 2 would
      // assert an even spacing the test numbers never claimed.
      //
      // Ordinal ticks come from the first series only, which is correct because
      // that is also what defines the positions; physical ticks are the union of
      // every series' x values, since any of them can sit between another's.
      ctx.fillStyle = theme.text;
      ctx.textBaseline = 'top';
      ctx.textAlign = 'center';
      const ticks: Array<{ x: number; label: string }> = d.xIsPhysical
        ? [...new Set(d.series.flatMap(s => s.points.map(p => p.x)))]
            .sort((m, n) => m - n)
            // Plain integers for whole swept values: `fmt` renders 3 as
            // "3.000", which reads as precision the level does not have.
            .map(x => ({ x, label: fmtX(x, d.xUnit) }))
        : (d.series[0]?.points ?? []).map(p => ({
            x: p.x,
            label: tickText(p),
          }));
      const everyNth = Math.max(1, Math.ceil((ticks.length * 46) / Math.max(1, plotRight - plotLeft)));
      ticks.forEach((t, i) => {
        if (i % everyNth !== 0 && i !== ticks.length - 1) return;
        ctx.fillText(t.label, xOf(t.x), plotBottom + 6);
      });

      // Axis titles. Without them the reader has the numbers and not what they
      // are — the y axis in particular is otherwise just a column of voltages.
      ctx.save();
      ctx.fillStyle = theme.text;
      ctx.globalAlpha = 0.75;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillText(d.xLabel, (plotLeft + plotRight) / 2, height - 4);
      ctx.restore();
      ctx.save();
      ctx.fillStyle = theme.text;
      ctx.globalAlpha = 0.75;
      ctx.translate(12, (plotTop + plotBottom) / 2);
      ctx.rotate(-Math.PI / 2);
      ctx.textBaseline = 'top';
      ctx.fillText(d.yLabel + (unit ? ` (${unit})` : ''), 0, 0);
      ctx.restore();

      // Legend
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      let lx = plotLeft + 4;
      const ly = plotTop + 8;
      d.series.forEach((s, si) => {
        ctx.fillStyle = colorOf(si);
        ctx.fillRect(lx, ly - 4, 10, 3);
        lx += 14;
        ctx.fillStyle = theme.text;
        ctx.fillText(s.label, lx, ly);
        lx += ctx.measureText(s.label).width + 16;
      });

      // No second request of the drawn height here: chartFillHeight has asked
      // for the floor, and asking for what the card was GIVEN would stop it
      // shrinking when the expand modal is made smaller.
    };

    draw();
    resizeHandle = observeResize(body, draw);

    canvas.addEventListener('mousemove', e => {
      const d = data;
      if (d === null || geom === null) { tooltip.style.display = 'none'; return; }
      const rect = canvas.getBoundingClientRect();
      const px = e.clientX - rect.left;
      // In axis space, like the positions it is compared against below.
      const xValue = geom.xLo + ((px - geom.left) / Math.max(1, geom.right - geom.left)) * (geom.xHi - geom.xLo);
      const axOf = geom.ax;

      // Nearest measured x across every series, so hovering between two points
      // still reports a real measurement rather than an interpolated fiction.
      let best: { x: number; dist: number } | null = null;
      for (const s of d.series) {
        for (const p of s.points) {
          if (p.count === 0) continue;
          const dist = Math.abs(axOf(p.x) - xValue);
          if (best === null || dist < best.dist) best = { x: p.x, dist };
        }
      }
      if (best === null) { tooltip.style.display = 'none'; return; }

      const atX = d.series.map(s => s.points.find(q => q.x === best!.x && q.count > 0));
      const rows = d.series.map((s, si) => {
        const p = atX[si];
        if (p === undefined) return '';
        // The mark goes on the series row, because each series at this x is a
        // different test and only some of them may be derived.
        // Median on the series line, spread and n beneath it: one line held all
        // of it and ran well past the tooltip's width.
        return `<span style="color:${colorOf(si)}">■</span> ${p.derived ? `${DERIVED_MARK} ` : ''}${escHtml(s.label)}: <strong>${escHtml(fmt(p.median, unit))}</strong>`
          + `<br><span style="opacity:${ALPHA.muted}">p10 ${escHtml(fmt(p.p10, unit))} – p90 ${escHtml(fmt(p.p90, unit))} · n=${p.count.toLocaleString()}</span>`;
      }).filter(Boolean);
      if (rows.length === 0) { tooltip.style.display = 'none'; return; }

      const anyPoint = d.series.flatMap(s => s.points).find(p => p.x === best!.x && p.count > 0);
      const notes = [...new Set(atX.map(p => derivedTestNote(p)).filter((n): n is string => n !== undefined))];
      tooltip.innerHTML = `<strong>${escHtml(anyPoint?.label ?? '')}</strong><br>` + rows.join('<br>')
        + notes.map(n => `<br><em>${escHtml(n)}</em>`).join('');
      tooltip.style.display = 'block';
      positionChartTooltip(tooltip, card, e.clientX, e.clientY);
    });
    canvas.addEventListener('mouseleave', () => { tooltip.style.display = 'none'; });

    writeFooter();
  }

  /**
   * The measured answers, in words. These are the reason the panel exists, so
   * they are stated rather than left to be read off the plot — and each one says
   * what it could not measure instead of going quietly missing.
   */
  function writeFooter(): void {
    const d = data;
    if (d === null) return;
    const parts: string[] = [];

    if (d.notMeasured !== undefined) {
      parts.push(`<strong>Crossing and widths:</strong> not measured — ${escHtml(d.notMeasured)}`);
    } else if (d.crossing) {
      parts.push(`<strong>Crossing:</strong> ${escHtml(`${d.xLabel} = ${fmtX(d.crossing.x, d.xUnit)}`)} · ${escHtml(`${d.yLabel} ${fmt(d.crossing.y, unit)}`)}`
        + (d.crossing.multiple ? ' <em>(first of several — the curves cross more than once)</em>' : ''));
    } else if ((spec.crossing ?? true) && spec.series.length >= 2) {
      parts.push('<strong>Crossing:</strong> the first two series do not cross over the swept range');
    }

    for (const s of d.separations) {
      if (s.distance !== null) {
        // "Width", not "separation": when two monotonic curves cross, this is
        // the width of the V they form at that level, which is how the people
        // reading it describe it. The label is reproduced verbatim — lower-casing
        // it turned "dBm" into "dbm", which is a different unit symbol.
        // On a log axis a width is a ratio: the same shift in log x is the same
        // multiple anywhere along it, and a difference in Ω would not be.
        const width = s.ratio !== undefined && s.from !== undefined && s.to !== undefined
          ? `×${Number(s.ratio.toPrecision(3))} on the ${d.xLabel} axis (${fmtX(s.from, d.xUnit)} → ${fmtX(s.to, d.xUnit)})`
          : `${fmtX(s.distance, d.xUnit)} on the ${d.xLabel} axis`;
        parts.push(`<strong>Width at ${escHtml(fmt(s.y, unit))}:</strong> ${escHtml(width)}`);
      } else {
        const which = s.reason === 'second-series-never-reaches' ? d.series[1]?.label : d.series[0]?.label;
        parts.push(`<strong>Width at ${escHtml(fmt(s.y, unit))}:</strong> not measurable — ${escHtml(which ?? 'a series')} never reaches this level`);
      }
    }

    // The key, short: a sweep of nine derived steps would make a line naming
    // every expression longer than the chart. Each point's tooltip carries its own.
    if (d.series.some(s => s.points.some(p => p.derived))) {
      parts.push(`${DERIVED_MARK} ${escHtml(DERIVED_KEY)} — hover a point for the expression`);
    }

    for (const w of d.warnings) parts.push(`<span style="color:${CLR.errText}">${escHtml(w)}</span>`);

    footer.innerHTML = parts.join('<br>');
  }

  rebuild();

  return {
    card,
    destroy: () => { resizeHandle?.disconnect(); tooltip.remove(); card.remove(); },
    setDies: (next: Die[]) => { dies = next; rebuild(); },
  };
}
