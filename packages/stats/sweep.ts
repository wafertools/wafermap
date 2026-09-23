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
import { parseTestReference } from '../renderer/derivedTests/parser.js';
import { quantile } from './math.js';
import { compileXNamePattern, readXFromName } from './sweepXFromName.js';

/** One series of a sweep — an ordered run of tests measuring the same quantity. */
export interface SweepSeriesSpec {
  /** Shown in the legend, e.g. `"Rising Response"`. */
  label: string;
  /**
   * Test numbers in sweep order. Order is the x axis and is never sorted.
   *
   * An entry may also be a range string, `"1010..1030"` — exactly the syntax of
   * a derived-test expression's `t[1010..1030]`, parsed by the same code
   * (`parseTestReference`), so the same text always names the same tests. It
   * expands to the DECLARED tests inside it, ascending: a program numbered in
   * steps of 2 needs no step syntax. Entries are expanded in the order written,
   * so `["1010..1020", 1035]` appends 1035 after the block.
   */
  tests: Array<number | string>;
  /**
   * Physical x value for each test — the actual swept quantity (power in dBm,
   * voltage, temperature). Same length as `tests` AFTER ranges are expanded.
   *
   * A length mismatch is reported naming the tests the ranges matched, and the
   * sweep is then drawn on the ordinal axis with no crossing or widths measured:
   * a missing test inside a range would otherwise shift every later x onto the
   * wrong test, which draws a plausible curve with a wrong crossing.
   *
   * Without it the x axis is the ORDINAL position in the sequence, labelled by
   * test number, because test numbers are identifiers and are not guaranteed to
   * be evenly spaced or even ascending — interpolating a crossing point along
   * them would silently assume a scale the data never claimed.
   */
  xValues?: number[];
  /**
   * Read each test's x value from its NAME instead — for programs that record
   * the swept quantity only in the test text. A placeholder pattern, not a
   * regular expression: `{x}` reads a number, `*` matches any run of
   * characters, everything else is literal. `"LRS_STATS_{x}"` reads 12,000 from
   * a test named `"Normalized_LRS= LRS_STATS_12K / …"`.
   *
   * - The pattern is found ANYWHERE in the name; no leading or trailing `*`.
   * - Literal text matches case-insensitively; the value's SI prefix does not
   *   (`m` is milli, `M` mega). `{x}` reads the prefix, and `K` is accepted as
   *   kilo. Put the prefix in the pattern instead (`"LRS_STATS_{x}K"`) to keep
   *   the numbers as the name shows them (12 rather than 12,000).
   * - Each x stays attached to its own test, so a test missing from the data
   *   loses one point instead of shifting every later x the way a positional
   *   `xValues` list does.
   *
   * A test whose name does not match, or a series giving both this and
   * `xValues`, is reported, and the crossing and widths are then not measured.
   */
  xFromName?: string;
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
  /**
   * Unit of the x values — `"Ω"`, `"V"`, `"Hz"`. With it the ticks, crossing
   * and widths print with SI prefixes (`47.3 kΩ`), the way the y axis does from
   * the tests' own unit. Give the bare unit; the prefix comes from the values.
   */
  xUnit?: string;
  /**
   * `'log'` places the x values on a logarithmic axis — for a sweep whose steps
   * grow by multiples (1k, 2k, 5k, 10k … 1M), which a linear axis squeezes into
   * one edge. The crossing is then interpolated along log x, and a width is
   * reported as a RATIO between the two series ("×1.8"), not a difference.
   * Needs every x value to be positive; otherwise the axis stays linear and the
   * card says why. Default `'linear'`.
   */
  xScale?: 'linear' | 'log';
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
  /** The point's test is derived (`TestDef.derived`); `label` then starts with `"† "`. A
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
  /** Where the first and second series reach the level, when both do. */
  from?: number;
  to?: number;
  /** On a log axis, `to / from` or its inverse, whichever is ≥ 1 — the width
   *  in the form a log axis measures it. */
  ratio?: number;
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
  /** `SweepSpec.xUnit`, when the axis is physical. */
  xUnit?: string;
  /** The axis actually drawn — `'log'` only when asked for and every x is positive. */
  xScale: 'linear' | 'log';
  /** Dies eligible for the sweep — the denominator behind every median. */
  dieCount: number;
  /** Problems with the spec itself, for the panel to show rather than silently
   *  drawing a partial sweep. */
  warnings: string[];
  /**
   * Set when crossing and widths were deliberately NOT measured, saying why —
   * `xValues` were supplied but cannot be paired with the tests. Measuring on
   * the ordinal fallback would print an ordinal position under the caller's
   * physical `xLabel`.
   */
  notMeasured?: string;
}

/** A series with `tests` expanded to plain test numbers. */
interface ResolvedSeries {
  spec: SweepSeriesSpec;
  tests: number[];
  /** Some entry was a range — the mismatch message then lists what matched. */
  usedRange: boolean;
}

/**
 * Expand a series' `tests` entries through the shared test-reference parser.
 * An entry that cannot be read is reported and contributes no tests — the
 * `xValues` length check then catches it rather than letting the x values slide.
 */
function resolveSeries(s: SweepSeriesSpec, defs: Map<number, TestDef>, warnings: string[]): ResolvedSeries {
  const tests: number[] = [];
  let usedRange = false;
  for (const entry of s.tests) {
    if (typeof entry === 'number') {
      if (Number.isInteger(entry)) tests.push(entry);
      else warnings.push(`"${s.label}": ${entry} is not a test number.`);
      continue;
    }
    const ref = parseTestReference(String(entry), defs);
    if (!ref.ok) {
      warnings.push(`"${s.label}": "${entry}" — ${ref.message}.`);
      continue;
    }
    if (ref.range) usedRange = true;
    tests.push(...ref.tests);
  }
  return { spec: s, tests, usedRange };
}

/** At most `max` numbers, then a count — a mismatch message must name what a
 *  range matched without becoming a wall of numbers. */
function listTests(tests: number[], max = 16): string {
  return tests.length <= max
    ? tests.join(', ')
    : `${tests.slice(0, max).join(', ')}, … (${tests.length - max} more)`;
}

/** X for point `i` — the physical value when the axis is physical, else the ordinal. */
function xAt(xs: number[] | undefined, i: number): number {
  const v = xs?.[i];
  return v !== undefined && Number.isFinite(v) ? v : i;
}

/**
 * The physical x value of every test in a series, from whichever source the
 * series gives — or `undefined` when it gives none, or gives one that cannot be
 * paired with its tests (reported in `warnings`). `asked` says a physical axis
 * was requested at all, which is what separates "ordinal by choice" from
 * "ordinal because the x values failed".
 */
function seriesX(r: ResolvedSeries, defs: Map<number, TestDef>, warnings: string[]): { xs?: number[]; asked: boolean } {
  const s = r.spec;
  if (s.xValues !== undefined && s.xFromName !== undefined) {
    warnings.push(`"${s.label}": gives both xValues and xFromName — use one.`);
    return { asked: true };
  }
  if (s.xValues !== undefined) {
    const n = s.xValues.length;
    if (n === r.tests.length) return { xs: s.xValues, asked: true };
    warnings.push(r.usedRange
      ? `"${s.label}": ${n} x values for ${r.tests.length} tests — the ranges matched ${listTests(r.tests)}.`
      : `"${s.label}": ${n} x values for ${r.tests.length} tests.`);
    return { asked: true };
  }
  if (s.xFromName !== undefined) {
    const pattern = compileXNamePattern(s.xFromName);
    if ('error' in pattern) {
      warnings.push(`"${s.label}": xFromName "${s.xFromName}" — ${pattern.error}.`);
      return { asked: true };
    }
    const xs: number[] = [];
    const unread: number[] = [];
    const ambiguous: string[] = [];
    for (const tn of r.tests) {
      const name = defs.get(tn)?.name;
      const x = name === undefined ? null : readXFromName(pattern, name);
      if (typeof x === 'number') xs.push(x);
      else { unread.push(tn); if (x !== null) ambiguous.push(x.ambiguous); }
    }
    if (unread.length > 0) {
      warnings.push(`"${s.label}": xFromName "${s.xFromName}" found no x value in the name of ${unread.length === 1 ? 'test' : 'tests'} ${listTests(unread)}`
        + (ambiguous.length > 0
          ? ` — "${ambiguous[0]}" is written in capitals, where M could be milli or mega; put the letter in the pattern ("…{x}M…") and the unit in xLabel.`
          : '.'));
      return { asked: true };
    }
    return { xs, asked: true };
  }
  return { asked: false };
}

/** An x value repeated within one series, as a message — a curve that revisits
 *  an x cannot be paired with another series by x, so it is not measured. */
function repeatedX(label: string, tests: number[], xs: number[]): string | null {
  const seen = new Map<number, number>();
  for (let i = 0; i < xs.length; i++) {
    const prev = seen.get(xs[i]!);
    if (prev !== undefined) return `"${label}": tests ${tests[prev]} and ${tests[i]} have the same x value (${xs[i]}) — a curve cannot be measured where it revisits an x.`;
    seen.set(xs[i]!, i);
  }
  return null;
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

  const resolved = spec.series.map(s => resolveSeries(s, defs, warnings));

  const xs = resolved.map(r => seriesX(r, defs, warnings));

  // Physical only when EVERY series carries usable x values: a mix would put
  // some points on a physical scale and others on ordinals, on one axis. When
  // any series asked for x values and the axis still cannot be physical, the
  // caller asked for a physical sweep and did not get one — say so, and measure
  // nothing, rather than report an ordinal crossing under a physical x label.
  const xIsPhysical = resolved.length > 0 && xs.every(x => x.xs !== undefined);
  const xBroken = !xIsPhysical && xs.some(x => x.asked);
  if (xBroken && xs.some(x => !x.asked)) {
    warnings.push('x values are given for some series but not all.');
  }

  // Drawn on the physical axis, but a revisited x leaves nothing to pair by.
  const repeat = xIsPhysical
    ? resolved.map((r, i) => repeatedX(r.spec.label, r.tests, xs[i]!.xs!)).find(m => m !== null) ?? null
    : null;
  if (repeat !== null) warnings.push(repeat);

  const logAsked = spec.xScale === 'log';
  const allPositive = xIsPhysical && xs.every(x => x.xs!.every(v => v > 0));
  const xScale: 'linear' | 'log' = logAsked && allPositive ? 'log' : 'linear';
  if (logAsked && !allPositive) {
    warnings.push(xIsPhysical
      ? 'A log x axis needs every x value to be positive — drawn on a linear axis.'
      : 'A log x axis needs x values (xValues or xFromName) — drawn in test order.');
  }

  const series: SweepSeriesData[] = resolved.map(({ spec: s, tests }, si) => {
    const physical = xIsPhysical ? xs[si]!.xs : undefined;

    const points = tests.map((tn, i) => {
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
        x: xAt(physical, i),
        median: values.length ? quantile(values, 0.5) : NaN,
        p10:    values.length ? quantile(values, 0.1) : NaN,
        p90:    values.length ? quantile(values, 0.9) : NaN,
        count:  values.length,
      } satisfies SweepPoint;
    });

    return { label: s.label, color: s.color, points };
  });

  const [a, b] = series;
  const measurable = a !== undefined && b !== undefined && !xBroken && repeat === null;
  const wantCrossing = spec.crossing ?? true;

  // Measured in the axis's own space: on a log axis the curve between two
  // points is the straight line drawn in log x, so that is what is interpolated.
  const toAxis = (v: number): number => xScale === 'log' ? Math.log10(v) : v;
  const fromAxis = (v: number): number => xScale === 'log' ? 10 ** v : v;
  const inAxis = (pts: SweepPoint[]): SweepPoint[] => pts.map(p => ({ ...p, x: toAxis(p.x) }));
  const aAxis = measurable ? inAxis(a.points) : [];
  const bAxis = measurable ? inAxis(b.points) : [];

  const separations: SweepSeparation[] = (xBroken || repeat !== null ? [] : spec.separationAt ?? []).map(y => {
    if (!measurable) return { y, distance: null };
    const la = xAtY(aAxis, y);
    const lb = xAtY(bAxis, y);
    if (la === null) return { y, distance: null, reason: 'first-series-never-reaches' as const };
    if (lb === null) return { y, distance: null, reason: 'second-series-never-reaches' as const };
    const from = fromAxis(la), to = fromAxis(lb);
    return {
      y, distance: Math.abs(to - from), from, to,
      ...(xScale === 'log' ? { ratio: 10 ** Math.abs(la - lb) } : {}),
    };
  });
  const axisCrossing = measurable && wantCrossing ? findCrossing(aAxis, bAxis) : null;
  const crossing = axisCrossing && { ...axisCrossing, x: fromAxis(axisCrossing.x) };

  const unitOf = (r: ResolvedSeries | undefined): string | undefined =>
    r === undefined ? undefined : defs.get(r.tests[0] ?? -1)?.unit;
  const unitA = unitOf(resolved[0]);
  const unitB = unitOf(resolved[1]);
  if (unitA !== undefined && unitB !== undefined && unitA !== unitB) {
    warnings.push(`Series measure different units (${unitA} and ${unitB}) — crossing and separation compare unlike quantities.`);
  }

  return {
    title: spec.title,
    // A broken physical axis is labelled for what it now is — the caller's
    // xLabel names the physical quantity the ordinal positions are not.
    xLabel: xBroken ? 'Test' : spec.xLabel ?? (xIsPhysical ? 'Sweep value' : 'Test'),
    yLabel: spec.yLabel ?? 'Value',
    series,
    xIsPhysical,
    ...(xIsPhysical && spec.xUnit ? { xUnit: spec.xUnit } : {}),
    xScale,
    crossing,
    separations,
    dieCount: eligible.length,
    warnings,
    ...(xBroken && spec.series.length >= 2
      ? { notMeasured: 'x values do not match the tests, so the sweep is drawn in test order and the crossing and widths are not measured' }
      : repeat !== null && spec.series.length >= 2
        ? { notMeasured: 'a series revisits an x value, so its points cannot be paired with the other series' }
        : {}),
  };
}
