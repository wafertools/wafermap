// Process capability (Cp/Cpk/Pp/Ppk) — generalized from tsmap's own
// charts/aggregate.ts, since this is standard statistics computed from
// ingredients this package already produces (StatsSummary's
// testSpecYield/perTestStats), not anything host-specific.
//
// Cp/Cpk ("potential"/short-term capability) use the pooled *within-wafer*
// stddev (ANOVA-style pooling: Σ(n_i-1)s_i² / Σ(n_i-1)), treating each wafer
// as the natural short-term subgroup. Pp/Ppk ("performance"/long-term
// capability) use the plain overall stddev across every die. Cp/Cpk are null
// when fewer than one wafer contributes ≥2 values (no within-subgroup
// variance is computable); Pp/Ppk are null when the pooled data has zero
// variance (division by zero).

import type { Die } from '../core/dies.js';
import { isYieldEligibleDie } from '../core/dies.js';
import type { TestDef } from '../renderer/buildWaferMap.js';
import { quantile } from './math.js';

export interface CapabilityDatum {
  testNumber: number;
  label: string;
  unit?: string;
  lsl: number;
  usl: number;
  mean: number;
  /** Sample stddev, ddof=1, pooled across every die across all items. */
  stdOverall: number;
  /** Pooled within-wafer sample stddev. NaN if no item contributed ≥2 values. */
  stdWithin: number;
  n: number;
  /** Cp/Cpk use `stdWithin`; null when stdWithin is NaN or 0. */
  cp: number | null;
  cpk: number | null;
  /** Pp/Ppk use `stdOverall`; null when stdOverall is 0. */
  pp: number | null;
  ppk: number | null;
  /** Five-number summary of all values, normalized: (v - lsl) / (usl - lsl). */
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
 * Process-capability data for every test in `testDefs` that has BOTH
 * `limitLow` and `limitHigh` defined — a test with only one limit, or none,
 * has no bounded [0,1] axis to normalize onto and is dropped. Sorted
 * worst-Ppk-first so a ranked view surfaces problem tests first.
 */
export function buildCapabilityData(items: CapabilityItem[], testDefs: TestDef[]): CapabilityDatum[] {
  const specByTest = new Map<number, { lsl: number; usl: number }>();
  for (const def of testDefs) {
    const testNumber = def.testNumber;
    if (testNumber === undefined) continue;
    const lsl = def.limitLow;
    const usl = def.limitHigh;
    if (lsl === undefined || usl === undefined || !(usl > lsl)) continue;
    specByTest.set(testNumber, { lsl, usl });
  }
  if (specByTest.size === 0) return [];

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
        if (!specByTest.has(testNumber)) continue;
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
    const spec = specByTest.get(testNumber);
    if (!spec) continue;
    const acc = accs.get(testNumber);
    if (!acc || acc.n === 0) continue;
    const { lsl, usl } = spec;
    const { n, sum, sumSq, withinNumerator, withinDenominator, allValues } = acc;

    allValues.sort((a, b) => a - b);
    const mean = sum / n;
    const varOverall = n >= 2 ? Math.max(0, (sumSq - n * mean * mean) / (n - 1)) : 0;
    const stdOverall = Math.sqrt(varOverall);
    const stdWithin = withinDenominator > 0 ? Math.sqrt(withinNumerator / withinDenominator) : NaN;

    const span = usl - lsl;
    const pp  = stdOverall > 0 ? span / (6 * stdOverall) : null;
    const ppk = stdOverall > 0 ? Math.min((usl - mean) / (3 * stdOverall), (mean - lsl) / (3 * stdOverall)) : null;
    const cp  = Number.isFinite(stdWithin) && stdWithin > 0 ? span / (6 * stdWithin) : null;
    const cpk = Number.isFinite(stdWithin) && stdWithin > 0 ? Math.min((usl - mean) / (3 * stdWithin), (mean - lsl) / (3 * stdWithin)) : null;

    const norm = (v: number) => (v - lsl) / span;
    out.push({
      testNumber, label: def.name ?? `Test ${testNumber}`, unit: def.unit,
      lsl, usl, mean, stdOverall, stdWithin, n,
      cp, cpk, pp, ppk,
      min: norm(allValues[0]),
      q1: norm(quantile(allValues, 0.25)),
      median: norm(quantile(allValues, 0.5)),
      q3: norm(quantile(allValues, 0.75)),
      max: norm(allValues[allValues.length - 1]),
    });
  }

  // Worst (lowest) Ppk first; null Ppk (zero variance — every value
  // identical) means "as good as it gets," so sort those last, alongside
  // each other.
  out.sort((a, b) => {
    if (a.ppk === null && b.ppk === null) return 0;
    if (a.ppk === null) return 1;
    if (b.ppk === null) return -1;
    return a.ppk - b.ppk;
  });
  return out;
}
