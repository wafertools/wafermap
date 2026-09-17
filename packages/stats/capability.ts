// Process capability (Cp/Cpk/Pp/Ppk) — generalized from tsmap's own
// charts/aggregate.ts, since this is standard statistics, not anything
// host-specific.
//
// Deliberate exception to the "prefer StatsSummary.stats.perTestStats over
// raw Die[]" dedup pattern used elsewhere in this package (boxplot.ts,
// binPareto.ts, summaryPanel.ts, etc.): this module needs the five-number
// summary (min/q1/median/q3/max) of every wafer's values *pooled together*
// into one combined, exactly-sorted array — quantiles of a pooled
// population cannot be reconstructed from each wafer's own quartiles
// (`perTestStats`/`perWaferTestStats`) without either raw values or an
// accuracy-losing approximation, and this library's correctness rules out
// silently approximating a displayed capability box. `mean`/`stdOverall`/
// `stdWithin`/`n` *could* in principle be derived exactly from per-wafer
// (count, mean, stddev) triples without touching raw dies again, but since
// this module already has to walk every die once for the quantiles, doing
// so here — using the same `isYieldEligibleDie` eligibility every other
// per-test computation in this package uses — costs nothing extra and keeps
// the whole five-number-summary-plus-indices computation in one consistent
// pass rather than splitting it across two disagreeing code paths.
//
// Cp/Cpk ("potential"/short-term capability) use the pooled *within-wafer*
// stddev (ANOVA-style pooling: Σ(n_i-1)s_i² / Σ(n_i-1)), treating each wafer
// as the natural short-term subgroup. Pp/Ppk ("performance"/long-term
// capability) use the plain overall stddev across every die. Cp/Cpk are null
// when fewer than one wafer contributes ≥2 values (no within-subgroup
// variance is computable); Pp/Ppk are null when the pooled data has zero
// variance (division by zero).
//
// Tests missing one or both spec limits get no capability indices (there is
// no LSL/USL to measure against) but are NOT dropped from the result — a
// dataset where most tests lack full limits would otherwise render an
// all-but-empty chart. Those rows (`hasSpec: false`) instead normalize their
// box onto their own observed [min, max] range and sort by raw variability
// (`stdOverall`, worst/most-variable first) since Ppk isn't available as a
// ranking signal. See `buildCapabilityData`'s sort comment for the two-tier
// ordering this produces.

import type { Die } from '../core/dies.js';
import { isYieldEligibleDie } from '../core/dies.js';
import { isParametricTest, type TestDef } from '../renderer/buildWaferMap.js';
import { quantile } from './math.js';
import type { TestCapability } from './types.js';

export interface CapabilityDatum {
  testNumber: number;
  label: string;
  unit?: string;
  /**
   * Whether this test has both `limitLow` and `limitHigh` defined. When
   * false, `lsl`/`usl`/`cp`/`cpk`/`pp`/`ppk` are all absent/null — there is
   * no spec to measure capability against — and the five-number summary
   * below is normalized onto the test's own observed [min, max] instead of
   * [lsl, usl].
   */
  hasSpec: boolean;
  lsl?: number;
  usl?: number;
  mean: number;
  /** Sample stddev, ddof=1, pooled across every die across all items. */
  stdOverall: number;
  /** Pooled within-wafer sample stddev. NaN if no item contributed ≥2 values. */
  stdWithin: number;
  n: number;
  /** Cp/Cpk use `stdWithin`; null when stdWithin is NaN or 0, or when `hasSpec` is false. */
  cp: number | null;
  cpk: number | null;
  /** Pp/Ppk use `stdOverall`; null when stdOverall is 0, or when `hasSpec` is false. */
  pp: number | null;
  ppk: number | null;
  /**
   * Five-number summary of all values, normalized: `(v - lsl) / (usl - lsl)`
   * when `hasSpec`, otherwise `(v - dataMin) / (dataMax - dataMin)` (0.5 for
   * every value when the test has zero variance).
   */
  min: number;
  q1: number;
  median: number;
  q3: number;
  max: number;
}

export interface CapabilityItem {
  /** One item's dies — typically one wafer, the natural short-term subgroup for Cp/Cpk. */
  dies?: Die[];
}

/** Running moments for one test: overall, plus the pooled within-subgroup variance. */
interface CapabilityMoments {
  n: number; sum: number; sumSq: number;
  withinNumerator: number; withinDenominator: number;
}

interface CapabilityDefs {
  defByTestNumber: Map<number, TestDef>;
  specByTest: Map<number, { lsl: number; usl: number }>;
}

/** Parametric defs by test number, and the full spec (both limits, usl > lsl) where one exists. */
function capabilityDefs(testDefs: TestDef[]): CapabilityDefs {
  const specByTest = new Map<number, { lsl: number; usl: number }>();
  const defByTestNumber = new Map<number, TestDef>();
  for (const def of testDefs) {
    const testNumber = def.testNumber;
    if (testNumber === undefined || !isParametricTest(def)) continue;
    defByTestNumber.set(testNumber, def);
    const lsl = def.limitLow;
    const usl = def.limitHigh;
    if (lsl !== undefined && usl !== undefined && usl > lsl) {
      specByTest.set(testNumber, { lsl, usl });
    }
  }
  return { defByTestNumber, specByTest };
}

/**
 * One pass over every die (not one pass over every die per test) — walking
 * each die's own recorded `testValues` keys is cheaper than test-outer/die-inner
 * nesting once a lot has many spec-limited tests. `values` collects every value
 * per test only when a caller needs quantiles (the chart); the analysis output
 * does not, and skipping the collection and sort is most of its cost.
 */
function accumulateMoments(
  items: CapabilityItem[],
  defByTestNumber: Map<number, TestDef>,
  values: Map<number, number[]> | null,
): Map<number, CapabilityMoments> {
  // Flat arrays indexed by test slot, not a Map entry per test: this pass runs
  // once per die per test, and per-entry lookups and allocations dominated it.
  const slotOf = new Map<number, number>();
  const testNumbers: number[] = [];
  for (const tn of defByTestNumber.keys()) { slotOf.set(tn, testNumbers.length); testNumbers.push(tn); }
  const T = testNumbers.length;
  const n = new Float64Array(T), sum = new Float64Array(T), sumSq = new Float64Array(T);
  const withinNum = new Float64Array(T), withinDen = new Float64Array(T);
  const wn = new Float64Array(T), wsum = new Float64Array(T), wsumSq = new Float64Array(T);
  const lists: (number[] | undefined)[] = values ? new Array(T) : [];
  // Reading each test off every die beats walking every die's keys until the
  // test list is wide enough that most reads would miss.
  const directRead = T <= 64;

  for (const item of items) {
    wn.fill(0); wsum.fill(0); wsumSq.fill(0);
    for (const die of item.dies ?? []) {
      if (!isYieldEligibleDie(die)) continue;
      const dieValues = die.testValues;
      if (!dieValues) continue;
      if (directRead) {
        // Few tests: read each one straight off the die.
        for (let slot = 0; slot < T; slot++) {
          const v = dieValues[testNumbers[slot]];
          if (v === undefined || !Number.isFinite(v)) continue;
          n[slot]++; sum[slot] += v; sumSq[slot] += v * v;
          wn[slot]++; wsum[slot] += v; wsumSq[slot] += v * v;
          if (values) (lists[slot] ??= []).push(v);
        }
        continue;
      }
      // Many tests: walk the die's own keys, so a die carrying few of them costs little.
      for (const key in dieValues) {
        const slot = slotOf.get(+key);
        if (slot === undefined) continue;
        const v = dieValues[+key];
        if (v === undefined || !Number.isFinite(v)) continue;
        n[slot]++; sum[slot] += v; sumSq[slot] += v * v;
        wn[slot]++; wsum[slot] += v; wsumSq[slot] += v * v;
        if (values) (lists[slot] ??= []).push(v);
      }
    }
    for (let slot = 0; slot < T; slot++) {
      const c = wn[slot];
      if (c < 2) continue;
      const wMean = wsum[slot] / c;
      const wVar = (wsumSq[slot] - c * wMean * wMean) / (c - 1);
      withinNum[slot] += (c - 1) * Math.max(0, wVar);
      withinDen[slot] += c - 1;
    }
  }

  const accs = new Map<number, CapabilityMoments>();
  for (let slot = 0; slot < T; slot++) {
    if (n[slot] === 0) continue;
    const tn = testNumbers[slot];
    accs.set(tn, { n: n[slot], sum: sum[slot], sumSq: sumSq[slot], withinNumerator: withinNum[slot], withinDenominator: withinDen[slot] });
    if (values && lists[slot]) values.set(tn, lists[slot]!);
  }
  return accs;
}

/** The capability indices for one test from its moments — the one copy of the Cp/Cpk/Pp/Ppk formulas. */
function capabilityFromMoments(
  testNumber: number,
  def: TestDef,
  spec: { lsl: number; usl: number } | undefined,
  m: CapabilityMoments,
): TestCapability {
  const { n, sum, sumSq, withinNumerator, withinDenominator } = m;
  const mean = sum / n;
  const varOverall = n >= 2 ? Math.max(0, (sumSq - n * mean * mean) / (n - 1)) : 0;
  const stdOverall = Math.sqrt(varOverall);
  const stdWithin = withinDenominator > 0 ? Math.sqrt(withinNumerator / withinDenominator) : NaN;
  let cp: number | null = null, cpk: number | null = null, pp: number | null = null, ppk: number | null = null;
  if (spec) {
    const { lsl, usl } = spec;
    const span = usl - lsl;
    pp  = stdOverall > 0 ? span / (6 * stdOverall) : null;
    ppk = stdOverall > 0 ? Math.min((usl - mean) / (3 * stdOverall), (mean - lsl) / (3 * stdOverall)) : null;
    cp  = Number.isFinite(stdWithin) && stdWithin > 0 ? span / (6 * stdWithin) : null;
    cpk = Number.isFinite(stdWithin) && stdWithin > 0 ? Math.min((usl - mean) / (3 * stdWithin), (mean - lsl) / (3 * stdWithin)) : null;
  }
  return {
    testNumber, label: def.name ?? `Test ${testNumber}`, unit: def.unit,
    hasSpec: spec !== undefined, lsl: spec?.lsl, usl: spec?.usl,
    mean, stdOverall, stdWithin, n, cp, cpk, pp, ppk,
  };
}

/**
 * Two-tier sort: spec'd tests (hasSpec) always rank ahead of unspec'd ones —
 * Ppk is a stronger, spec-relative signal than raw spread. Within the spec'd
 * tier, worst (lowest) Ppk first; null Ppk (zero variance — every value
 * identical) means "as good as it gets," so those sort last within the tier.
 * Within the unspec'd tier (no Ppk to rank by at all), most variable (highest
 * stdOverall) first, since that's the closest available proxy for "needs attention."
 */
function sortCapability<T extends { hasSpec: boolean; stdOverall: number; ppk: number | null }>(rows: T[]): T[] {
  return rows.sort((a, b) => {
    if (a.hasSpec !== b.hasSpec) return a.hasSpec ? -1 : 1;
    if (!a.hasSpec) return b.stdOverall - a.stdOverall;
    if (a.ppk === null && b.ppk === null) return 0;
    if (a.ppk === null) return 1;
    if (b.ppk === null) return -1;
    return a.ppk - b.ppk;
  });
}

/**
 * Process-capability data for every test in `testDefs` that has at least one
 * recorded value. Tests with both `limitLow` and `limitHigh` defined get the
 * full Cp/Cpk/Pp/Ppk treatment, normalized onto [0,1] via their spec (see
 * `CapabilityDatum.hasSpec`); tests with only one limit or none still appear
 * (`hasSpec: false`), normalized onto their own observed range instead, so a
 * lot where most tests lack full limits doesn't render as an empty chart.
 * Sorted spec'd-first (worst-Ppk-first within that tier), then unspec'd
 * (most-variable-first within that tier).
 */
export function buildCapabilityData(items: CapabilityItem[], testDefs: TestDef[]): CapabilityDatum[] {
  const { defByTestNumber, specByTest } = capabilityDefs(testDefs);
  if (defByTestNumber.size === 0) return [];
  const values = new Map<number, number[]>();
  const accs = accumulateMoments(items, defByTestNumber, values);

  const out: CapabilityDatum[] = [];
  for (const def of testDefs) {
    const testNumber = def.testNumber;
    if (testNumber === undefined) continue;
    const acc = accs.get(testNumber);
    if (!acc || acc.n === 0 || !defByTestNumber.has(testNumber)) continue;
    const spec = specByTest.get(testNumber);
    const figures = capabilityFromMoments(testNumber, def, spec, acc);
    const allValues = values.get(testNumber)!.sort((a, b) => a - b);

    let norm: (v: number) => number;
    if (spec) {
      const span = spec.usl - spec.lsl;
      norm = (v: number) => (v - spec.lsl) / span;
    } else {
      const dataMin = allValues[0];
      const dataSpan = allValues[allValues.length - 1] - dataMin;
      norm = dataSpan > 0 ? (v: number) => (v - dataMin) / dataSpan : () => 0.5;
    }
    out.push({
      ...figures,
      min: norm(allValues[0]),
      q1: norm(quantile(allValues, 0.25)),
      median: norm(quantile(allValues, 0.5)),
      q3: norm(quantile(allValues, 0.75)),
      max: norm(allValues[allValues.length - 1]),
    });
  }
  return sortCapability(out);
}

/**
 * @internal Capability indices without the chart's normalised quantiles — what
 * `stats.capability` carries. Same moments, formulas and order as
 * `buildCapabilityData`, without collecting and sorting every value.
 */
export function buildCapabilityFigures(items: CapabilityItem[], testDefs: TestDef[]): TestCapability[] {
  const { defByTestNumber, specByTest } = capabilityDefs(testDefs);
  if (defByTestNumber.size === 0) return [];
  const accs = accumulateMoments(items, defByTestNumber, null);
  const out: TestCapability[] = [];
  for (const [testNumber, acc] of accs) {
    if (acc.n === 0) continue;
    out.push(capabilityFromMoments(testNumber, defByTestNumber.get(testNumber)!, specByTest.get(testNumber), acc));
  }
  return sortCapability(out);
}

/**
 * @internal Lot capability pooled exactly from each wafer's own capability
 * figures, without revisiting a die: a wafer's (n, mean, stdOverall) give its
 * sum and sum of squares, and — one wafer being one subgroup — its within-wafer
 * variance. So a lot analysis given `perWaferSummaries` stays cheap. Specs come
 * from the lot's merged `testDefs`, as they would for a direct computation.
 */
export function poolCapabilityFigures(perWafer: readonly TestCapability[][], testDefs: TestDef[]): TestCapability[] {
  const { defByTestNumber, specByTest } = capabilityDefs(testDefs);
  const accs = new Map<number, CapabilityMoments>();
  for (const rows of perWafer) for (const r of rows) {
    if (!defByTestNumber.has(r.testNumber) || r.n === 0) continue;
    let acc = accs.get(r.testNumber);
    if (!acc) { acc = { n: 0, sum: 0, sumSq: 0, withinNumerator: 0, withinDenominator: 0 }; accs.set(r.testNumber, acc); }
    const variance = r.stdOverall * r.stdOverall;
    acc.n += r.n;
    acc.sum += r.n * r.mean;
    acc.sumSq += (r.n - 1) * variance + r.n * r.mean * r.mean;
    if (r.n >= 2) {
      acc.withinNumerator += (r.n - 1) * variance;
      acc.withinDenominator += r.n - 1;
    }
  }
  const out: TestCapability[] = [];
  for (const [testNumber, acc] of accs) {
    out.push(capabilityFromMoments(testNumber, defByTestNumber.get(testNumber)!, specByTest.get(testNumber), acc));
  }
  return sortCapability(out);
}
