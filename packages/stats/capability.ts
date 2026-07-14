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
import type { TestDef } from '../renderer/buildWaferMap.js';
import { quantile } from './math.js';

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

interface CapabilityAcc {
  n: number; sum: number; sumSq: number;
  withinNumerator: number; withinDenominator: number;
  allValues: number[];
}

/**
 * Process-capability data for every test in `testDefs` that has at least one
 * recorded value. Tests with both `limitLow` and `limitHigh` defined get the
 * full Cp/Cpk/Pp/Ppk treatment, normalized onto [0,1] via their spec (see
 * `CapabilityDatum.hasSpec`); tests with only one limit or none still appear
 * (`hasSpec: false`), normalized onto their own observed range instead, so a
 * lot where most tests lack full limits doesn't render as an empty chart.
 * Sorted spec'd-first (worst-Ppk-first within that tier), then unspec'd
 * (most-variable-first within that tier) — see the sort at the bottom.
 */
export function buildCapabilityData(items: CapabilityItem[], testDefs: TestDef[]): CapabilityDatum[] {
  const specByTest = new Map<number, { lsl: number; usl: number }>();
  const defByTestNumber = new Map<number, TestDef>();
  for (const def of testDefs) {
    const testNumber = def.testNumber;
    if (testNumber === undefined) continue;
    defByTestNumber.set(testNumber, def);
    const lsl = def.limitLow;
    const usl = def.limitHigh;
    if (lsl !== undefined && usl !== undefined && usl > lsl) {
      specByTest.set(testNumber, { lsl, usl });
    }
  }
  if (defByTestNumber.size === 0) return [];

  // One pass over every die (not one pass over every die per test) —
  // walking each die's own recorded `testValues` keys is cheaper than the
  // previous test-outer/die-inner nesting once a lot has many spec-limited
  // tests, and is never worse when a die carries values for all of them.
  const accs = new Map<number, CapabilityAcc>();
  const accFor = (testNumber: number): CapabilityAcc => {
    let acc = accs.get(testNumber);
    if (!acc) { acc = { n: 0, sum: 0, sumSq: 0, withinNumerator: 0, withinDenominator: 0, allValues: [] }; accs.set(testNumber, acc); }
    return acc;
  };

  for (const item of items) {
    const itemAcc = new Map<number, { wn: number; wsum: number; wsumSq: number }>();
    for (const die of item.dies ?? []) {
      if (!isYieldEligibleDie(die)) continue;
      const values = die.testValues;
      if (!values) continue;
      for (const key of Object.keys(values)) {
        const testNumber = Number(key);
        if (!defByTestNumber.has(testNumber)) continue;
        const v = values[testNumber];
        if (v === undefined || !Number.isFinite(v)) continue;

        const acc = accFor(testNumber);
        acc.n++; acc.sum += v; acc.sumSq += v * v;
        acc.allValues.push(v);

        let ia = itemAcc.get(testNumber);
        if (!ia) { ia = { wn: 0, wsum: 0, wsumSq: 0 }; itemAcc.set(testNumber, ia); }
        ia.wn++; ia.wsum += v; ia.wsumSq += v * v;
      }
    }
    for (const [testNumber, ia] of itemAcc) {
      if (ia.wn < 2) continue;
      const acc = accFor(testNumber);
      const wMean = ia.wsum / ia.wn;
      const wVar = (ia.wsumSq - ia.wn * wMean * wMean) / (ia.wn - 1);
      acc.withinNumerator += (ia.wn - 1) * Math.max(0, wVar);
      acc.withinDenominator += ia.wn - 1;
    }
  }

  const out: CapabilityDatum[] = [];
  for (const def of testDefs) {
    const testNumber = def.testNumber;
    if (testNumber === undefined) continue;
    const acc = accs.get(testNumber);
    if (!acc || acc.n === 0) continue;
    const { n, sum, sumSq, withinNumerator, withinDenominator, allValues } = acc;

    allValues.sort((a, b) => a - b);
    const mean = sum / n;
    const varOverall = n >= 2 ? Math.max(0, (sumSq - n * mean * mean) / (n - 1)) : 0;
    const stdOverall = Math.sqrt(varOverall);
    const stdWithin = withinDenominator > 0 ? Math.sqrt(withinNumerator / withinDenominator) : NaN;

    const spec = specByTest.get(testNumber);
    const hasSpec = spec !== undefined;

    let lsl: number | undefined, usl: number | undefined;
    let cp: number | null = null, cpk: number | null = null, pp: number | null = null, ppk: number | null = null;
    let norm: (v: number) => number;

    if (hasSpec) {
      ({ lsl, usl } = spec);
      const span = usl - lsl;
      pp  = stdOverall > 0 ? span / (6 * stdOverall) : null;
      ppk = stdOverall > 0 ? Math.min((usl - mean) / (3 * stdOverall), (mean - lsl) / (3 * stdOverall)) : null;
      cp  = Number.isFinite(stdWithin) && stdWithin > 0 ? span / (6 * stdWithin) : null;
      cpk = Number.isFinite(stdWithin) && stdWithin > 0 ? Math.min((usl - mean) / (3 * stdWithin), (mean - lsl) / (3 * stdWithin)) : null;
      norm = (v: number) => (v - lsl!) / span;
    } else {
      const dataMin = allValues[0];
      const dataMax = allValues[allValues.length - 1];
      const dataSpan = dataMax - dataMin;
      norm = dataSpan > 0 ? (v: number) => (v - dataMin) / dataSpan : () => 0.5;
    }

    out.push({
      testNumber, label: def.name ?? `Test ${testNumber}`, unit: def.unit,
      hasSpec, lsl, usl, mean, stdOverall, stdWithin, n,
      cp, cpk, pp, ppk,
      min: norm(allValues[0]),
      q1: norm(quantile(allValues, 0.25)),
      median: norm(quantile(allValues, 0.5)),
      q3: norm(quantile(allValues, 0.75)),
      max: norm(allValues[allValues.length - 1]),
    });
  }

  // Two-tier sort: spec'd tests (hasSpec) always rank ahead of unspec'd ones
  // — Ppk is a stronger, spec-relative signal than raw spread. Within the
  // spec'd tier, worst (lowest) Ppk first; null Ppk (zero variance — every
  // value identical) means "as good as it gets," so those sort last within
  // the tier. Within the unspec'd tier (no Ppk to rank by at all), most
  // variable (highest stdOverall) first, since that's the closest available
  // proxy for "needs attention."
  out.sort((a, b) => {
    if (a.hasSpec !== b.hasSpec) return a.hasSpec ? -1 : 1;
    if (!a.hasSpec) return b.stdOverall - a.stdOverall;
    if (a.ppk === null && b.ppk === null) return 0;
    if (a.ppk === null) return 1;
    if (b.ppk === null) return -1;
    return a.ppk - b.ppk;
  });
  return out;
}
