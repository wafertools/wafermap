// Parametric sweep: two or more ordered runs of tests, each read as a curve
// rather than as independent tests. Pure math, no DOM.
//
// The case this exists for, and the shape to keep in mind: a test program
// measures the same quantity at a series of power levels and records it as a
// block of consecutive test numbers — one block sweeping up, another sweeping
// down. Read as separate tests that is two dozen unrelated distributions; read
// as sequences it is a pair of response curves, and the questions an engineer
// asks are about the PAIR — where the rising and falling curves cross, and how
// far apart they are at a given level.
//
// A single series is therefore the degenerate case, not the normal one:
// `crossing` and `separationAt` are measured between the first two series, and
// any further series are drawn for context but not measured.
//
// Distinct from trend.ts, which walks ONE test across wafers. This walks MANY
// tests across one population, so the x axis is the sweep, not the lot.
//
// Each line is an aggregate across dies with a spread band, never one trace per
// die: a sweep over a production lot is thousands of dies, and the per-die view
// of the same data is better served by plotting a derived scalar (the crossing
// point, the separation) on the wafer map, where position is visible.

import type { Die } from '../core/dies.js';
import { isYieldEligibleDie } from '../core/dies.js';
import { isParametricTest, type TestDef } from '../renderer/buildWaferMap.js';
import { markedTestLabel, derivedFields } from '../renderer/testLabel.js';
import { quantile } from './math.js';

/** One series of a sweep — an ordered run of tests measuring the same quantity. */
export interface SweepSeriesSpec {
  /** Shown in the legend, e.g. `"Rising Response"`. */
  label: string;
  /** Test numbers in sweep order. Order is the x axis and is never sorted. */
  tests: number[];
  /**
   * Physical x value for each entry of `tests` — the actual swept quantity
   * (power in dBm, voltage, temperature). Same length as `tests`.
   *
   * Without it the x axis is the ORDINAL position in the sequence, labelled by
   * test number, because test numbers are identifiers and are not guaranteed to
   * be evenly spaced or even ascending — interpolating a crossing point along
   * them would silently assume a scale the data never claimed.
   */
  xValues?: number[];
  /** Optional explicit colour. Omit to take one from the chart's palette. */
  color?: string;
}

export interface SweepSpec {
  /** Stable identity, so a host can persist which sweep was selected. */
  id: string;
  /** Panel title, e.g. `"Power Sweep"`. */
  title: string;
  /** Two or more series. Crossing and separation are measured between the
   *  FIRST TWO; further series are drawn but not measured. */
  series: SweepSeriesSpec[];
  xLabel?: string;
  yLabel?: string;
  /** Report where the first two series cross. Default true when there are two. */
  crossing?: boolean;
  /** Y levels at which to report the horizontal distance between the first two
   *  series, in test-value units. */
  separationAt?: number[];
}

export interface SweepPoint {
  /** Test number this point came from. */
  testNumber: number;
  /** The point's test is derived (`TestDef.derived`); `label` then ends in `" †"`. A
   *  sweep over derived tests is how a curve on a log scale is drawn: sweep
   *  `log10(t[n])` per step. */
  derived?: true;
  /** The expression a `derived` point's test was computed from, for display. */
  expression?: string;
  /** Tick label — the test's name when defined, else `"Test 1010"`. */
  label: string;
  /** Position on the x axis: `xValues[i]` when supplied, else the ordinal index. */
  x: number;
  /** Median across the population. `NaN` when `count` is 0. */
  median: number;
  /** Spread band. Equal to `median` when `count` is 1. */
  p10: number;
  p90: number;
  /** Dies contributing a finite value at this point. */
  count: number;
}

export interface SweepSeriesData {
  label: string;
  color?: string;
  points: SweepPoint[];
}

export interface SweepCrossing {
  x: number;
  y: number;
  /** True when the curves cross more than once — the reported point is the
   *  first. A single number cannot describe a multiple crossing, so the panel
   *  says so rather than implying precision it does not have. */
  multiple: boolean;
}

export interface SweepSeparation {
  /** The y level asked about. */
  y: number;
  /** Horizontal distance between the two series at that level, or `null` when
   *  either series never reaches it within the swept range. */
  distance: number | null;
  /** Why it is null, for the panel to show instead of an empty cell. */
  reason?: 'first-series-never-reaches' | 'second-series-never-reaches';
}

export interface SweepData {
  title: string;
  xLabel: string;
  yLabel: string;
  series: SweepSeriesData[];
  crossing?: SweepCrossing | null;
  separations: SweepSeparation[];
  /**
   * True when the caller supplied real `xValues`, so `SweepPoint.x` is a
   * physical quantity and the axis should be labelled with NUMBERS. When false
   * the x positions are ordinals and the ticks must be the test labels — an
   * axis showing "0, 1, 2" for test identifiers would be a scale the data never
   * claimed.
   */
  xIsPhysical: boolean;
  /** Dies eligible for the sweep — the denominator behind every median. */
  dieCount: number;
  /** Problems with the spec itself, for the panel to show rather than silently
   *  drawing a partial sweep. */
  warnings: string[];
}

/** X for point `i` of a series — the supplied physical value, else the ordinal. */
function xAt(spec: SweepSeriesSpec, i: number): number {
  const v = spec.xValues?.[i];
  return v !== undefined && Number.isFinite(v) ? v : i;
}

/**
 * Linear interpolation of the x at which a polyline first crosses `y`.
 * Returns `null` when the polyline never reaches `y` within its span.
 */
function xAtY(points: SweepPoint[], y: number): number | null {
  const usable = points.filter(p => p.count > 0);
  for (let i = 1; i < usable.length; i++) {
    const a = usable[i - 1]!, b = usable[i]!;
    const lo = Math.min(a.median, b.median), hi = Math.max(a.median, b.median);
    if (y < lo || y > hi) continue;
    if (a.median === b.median) return a.x;
    const t = (y - a.median) / (b.median - a.median);
    return a.x + t * (b.x - a.x);
  }
  return null;
}

/**
 * First crossing of two median polylines, by sign change of their difference.
 *
 * Both series are read at their own x positions, so this only compares points
 * that share an x. That is the honest reading: two series swept over different
 * x values have no defined crossing without assuming an interpolation the data
 * does not support.
 */
function findCrossing(a: SweepPoint[], b: SweepPoint[]): SweepCrossing | null {
  const byX = new Map(b.filter(p => p.count > 0).map(p => [p.x, p]));
  const pairs: Array<{ x: number; d: number; y: number }> = [];
  for (const p of a) {
    if (p.count === 0) continue;
    const q = byX.get(p.x);
    if (q === undefined) continue;
    pairs.push({ x: p.x, d: p.median - q.median, y: p.median });
  }
  if (pairs.length < 2) return null;

  // Crossings are counted as EVENTS, so a curve that meets the other exactly on
  // a measured point produces one event, not two. Counting a sign change into a
  // zero and then the zero itself reported every clean crossing as `multiple`.
  const events: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < pairs.length; i++) {
    const p = pairs[i]!;
    if (p.d === 0) { events.push({ x: p.x, y: p.y }); continue; }
    if (i === 0) continue;
    const prev = pairs[i - 1]!;
    // Strictly opposite signs only — a segment touching zero at either end is
    // already covered by that endpoint's own event.
    if (prev.d === 0 || (prev.d < 0) === (p.d < 0)) continue;
    const t = prev.d / (prev.d - p.d);          // fraction along the segment to d = 0
    events.push({ x: prev.x + t * (p.x - prev.x), y: prev.y + t * (p.y - prev.y) });
  }

  const first = events[0];
  if (first === undefined) return null;
  return { x: first.x, y: first.y, multiple: events.length > 1 };
}

/**
 * Build the plottable data for one sweep over a die population.
 *
 * Dies are filtered by `isYieldEligibleDie` — the same population convention as
 * every other chart, so partial and edge-excluded dies do not quietly shift a
 * median. A test that is missing, functional, or has no finite values anywhere
 * still produces a point, with `count: 0`, so the gap stays visible in the
 * sequence rather than closing up and misreporting the curve's shape.
 */
export function buildSweepData(
  dies: Die[],
  testDefs: TestDef[] | undefined,
  spec: SweepSpec,
): SweepData {
  const warnings: string[] = [];
  const defs = new Map((testDefs ?? []).map(d => [d.testNumber, d]));
  const eligible = dies.filter(d => isYieldEligibleDie(d));

  const series: SweepSeriesData[] = spec.series.map(s => {
    if (s.xValues !== undefined && s.xValues.length !== s.tests.length) {
      warnings.push(`"${s.label}": ${s.xValues.length} x values for ${s.tests.length} tests — falling back to sequence position.`);
    }
    const usableX = s.xValues?.length === s.tests.length ? s : { ...s, xValues: undefined };

    const points = s.tests.map((tn, i) => {
      const def = defs.get(tn);
      if (def === undefined) {
        warnings.push(`"${s.label}": test ${tn} is not in this program's test definitions.`);
      } else if (!isParametricTest(def)) {
        warnings.push(`"${s.label}": test ${tn} is functional and has no measured value.`);
      }

      const values: number[] = [];
      if (def !== undefined && isParametricTest(def)) {
        for (const die of eligible) {
          const v = die.testValues?.[tn];
          if (v !== undefined && Number.isFinite(v)) values.push(v);
        }
      }
      values.sort((p, q) => p - q);

      return {
        testNumber: tn,
        label: markedTestLabel(def, tn),
        ...derivedFields(def),
        x: xAt(usableX, i),
        median: values.length ? quantile(values, 0.5) : NaN,
        p10:    values.length ? quantile(values, 0.1) : NaN,
        p90:    values.length ? quantile(values, 0.9) : NaN,
        count:  values.length,
      } satisfies SweepPoint;
    });

    return { label: s.label, color: s.color, points };
  });

  const [a, b] = series;
  const measurable = a !== undefined && b !== undefined;
  const wantCrossing = spec.crossing ?? true;

  const separations: SweepSeparation[] = (spec.separationAt ?? []).map(y => {
    if (!measurable) return { y, distance: null };
    const xa = xAtY(a.points, y);
    const xb = xAtY(b.points, y);
    if (xa === null) return { y, distance: null, reason: 'first-series-never-reaches' as const };
    if (xb === null) return { y, distance: null, reason: 'second-series-never-reaches' as const };
    return { y, distance: Math.abs(xa - xb) };
  });

  // Only when EVERY series carries usable x values: a mix would put some points
  // on a physical scale and others on ordinals, on one axis.
  const xIsPhysical = spec.series.length > 0
    && spec.series.every(sr => sr.xValues?.length === sr.tests.length);

  const unitOf = (s: SweepSeriesSpec | undefined): string | undefined =>
    s === undefined ? undefined : defs.get(s.tests[0] ?? -1)?.unit;
  const unitA = unitOf(spec.series[0]);
  const unitB = unitOf(spec.series[1]);
  if (unitA !== undefined && unitB !== undefined && unitA !== unitB) {
    warnings.push(`Series measure different units (${unitA} and ${unitB}) — crossing and separation compare unlike quantities.`);
  }

  return {
    title: spec.title,
    xLabel: spec.xLabel ?? (xIsPhysical ? 'Sweep value' : 'Test'),
    yLabel: spec.yLabel ?? 'Value',
    series,
    xIsPhysical,
    crossing: measurable && wantCrossing ? findCrossing(a.points, b.points) : null,
    separations,
    dieCount: eligible.length,
    warnings,
  };
}
