// Part average testing (PAT): per wafer and test, limits far tighter than the test's own, set by the wafer's own
// population, so a die that passes every limit but sits far from its siblings is found. The rule is dynamic PAT as
// AEC-Q001 describes it:
//
//   robust mean   = the median of the wafer's passing values
//   robust sigma  = (Q3 − Q1) / 1.35, the standard deviation a normal distribution with that interquartile range has
//   PAT limits    = robust mean ± 6 robust sigma, never wider than the test's own limits
//
// "Passing values" are the test's values on dies the wafer's pass bins pass, inside the test's limits: a failing die
// would widen the limits it is meant to be judged by. The test's limits are its spec limits when it has both, else its
// test limits (the rule capability uses). A test with fewer than `PAT_MIN_DIES` passing values, or no spread between
// its quartiles, gets no PAT limits on that wafer and does not judge its dies there.
//
// A die's verdict, over every test with PAT limits on its wafer: Fails when its bin fails or any of its values is outside
// the test's own limits (PAT screens dies that pass; counting a failing die as a PAT outlier would overstate what PAT
// rejects); else PAT outlier when any value is outside its PAT limits; else Within PAT limits. A die with no value for
// any such test has no verdict.
//
// Pure, no DOM.

import type { Die } from '../core/dies.js';
import { diePassStatus } from '../core/dies.js';
import { testValuesReader } from '../core/dieTable.js';
import { isParametricTest, type TestDef } from '../renderer/buildWaferMap.js';
import { fiveNumberSummary } from './math.js';
import { capabilityLimits } from './capability.js';

/** Robust sigmas each side of the median. */
export const PAT_K = 6;
/** The interquartile range of a normal distribution in standard deviations. */
export const PAT_IQR_SIGMA = 1.35;
/** Passing values a wafer needs on a test before its PAT limits mean anything. */
export const PAT_MIN_DIES = 30;
/**
 * Quartile skewness, (Q3 + Q1 − 2 × median) / (Q3 − Q1), from which a test's values count as lopsided: 0 for a symmetric
 * distribution, ±1 at the extreme. Symmetric limits fit such a test badly (about 0.17 for a log-normal of shape 0.5,
 * 0.33 for shape 1).
 */
export const PAT_SKEW_WARN = 0.2;

export interface PatLimit {
  testNumber: number;
  lo: number;
  hi: number;
  median: number;
  robustSigma: number;
  /** Passing values the limits were set from. */
  n: number;
  /** Which of the test's limits bound them: spec limits when it has both, else test limits. */
  basis: 'spec' | 'test';
  /** The ±6σ band reached past the test's own limit at that end, so the PAT limit is the test's limit there. */
  clippedLo: boolean;
  clippedHi: boolean;
  /** Quartile skewness of the values the limits were set from (see `PAT_SKEW_WARN`). */
  skew: number;
}

export interface WaferPat {
  /** PAT limits by test number, for the tests that have them on this wafer. */
  limits: Map<number, PatLimit>;
  /** Tests with limits that got no PAT limits on this wafer, and why. */
  skipped: Array<{ testNumber: number; reason: 'few-values' | 'no-spread' }>;
}

export type PatVerdict = 'within' | 'outlier' | 'fails';

/** A die's verdict and the tests behind it (the outlying ones, or the ones outside their limits; empty otherwise). */
export interface DiePat { verdict?: PatVerdict; tests: number[] }

/** The reader's words for each verdict, in the order they are listed. */
export const PAT_VERDICT_LABEL: Readonly<Record<PatVerdict, string>> = {
  within: 'Within PAT limits', outlier: 'PAT outlier', fails: 'Fails (bin or limits)',
};
export const PAT_VERDICT_ORDER: readonly string[] = [PAT_VERDICT_LABEL.within, PAT_VERDICT_LABEL.outlier, PAT_VERDICT_LABEL.fails];

/** The tests PAT judges: parametric, with both limits. */
export function patTests(testDefs: readonly TestDef[]): TestDef[] {
  return testDefs.filter(d => isParametricTest(d) && capabilityLimits(d) !== undefined);
}

const cache = new WeakMap<readonly Die[], { defs: readonly TestDef[]; passKey: string; pat: WaferPat; verdicts: DiePat[] }>();

function compute(dies: readonly Die[], testDefs: readonly TestDef[], passBins: readonly number[]): { pat: WaferPat; verdicts: DiePat[] } {
  const passKey = [...passBins].sort((a, b) => a - b).join(',');
  const hit = cache.get(dies);
  if (hit && hit.defs === testDefs && hit.passKey === passKey) return hit;
  const tests = patTests(testDefs);
  const bounds = tests.map(t => capabilityLimits(t)!);
  const read = testValuesReader(tests.map(t => t.testNumber));
  const pass = new Set(passBins);
  const buf = new Float64Array(tests.length);
  // Two reads of the dies rather than a copy of every value: the first gathers each test's passing values.
  const passingValues: number[][] = tests.map(() => []);
  for (const d of dies) {
    if (diePassStatus(d, pass) !== true) continue;
    read(d, buf);
    for (let k = 0; k < tests.length; k++) { const v = buf[k]; if (Number.isFinite(v) && v >= bounds[k].lsl && v <= bounds[k].usl) passingValues[k].push(v); }
  }

  const limits = new Map<number, PatLimit>();
  const skipped: WaferPat['skipped'] = [];
  tests.forEach((t, k) => {
    const { lsl, usl, basis } = bounds[k];
    const vs = passingValues[k];
    if (vs.length < PAT_MIN_DIES) { skipped.push({ testNumber: t.testNumber, reason: 'few-values' }); return; }
    const q = fiveNumberSummary(Float64Array.from(vs));
    const robustSigma = (q.q3 - q.q1) / PAT_IQR_SIGMA;
    if (!(robustSigma > 0)) { skipped.push({ testNumber: t.testNumber, reason: 'no-spread' }); return; }
    const rawLo = q.median - PAT_K * robustSigma, rawHi = q.median + PAT_K * robustSigma;
    limits.set(t.testNumber, {
      testNumber: t.testNumber, lo: Math.max(rawLo, lsl), hi: Math.min(rawHi, usl), median: q.median, robustSigma, n: vs.length,
      basis, clippedLo: rawLo < lsl, clippedHi: rawHi > usl, skew: (q.q3 + q.q1 - 2 * q.median) / (q.q3 - q.q1),
    });
  });

  // The second read judges each die against the limits.
  const lims = tests.map(t => limits.get(t.testNumber));
  const verdicts: DiePat[] = dies.map(d => {
    const binFails = diePassStatus(d, pass) === false;
    const row = read(d, buf);
    let assessed = false;
    const outside: number[] = [], outlier: number[] = [];
    tests.forEach((t, k) => {
      const lim = lims[k];
      const v = row[k];
      if (!lim || !Number.isFinite(v)) return;
      assessed = true;
      if (v < bounds[k].lsl || v > bounds[k].usl) outside.push(t.testNumber);
      else if (v < lim.lo || v > lim.hi) outlier.push(t.testNumber);
    });
    if (!assessed) return binFails ? { verdict: 'fails', tests: [] } : { tests: [] };
    if (outside.length || binFails) return { verdict: 'fails', tests: outside };
    return outlier.length ? { verdict: 'outlier', tests: outlier } : { verdict: 'within', tests: [] };
  });
  const out = { defs: testDefs, passKey, pat: { limits, skipped }, verdicts };
  cache.set(dies, out);
  return out;
}

/**
 * The PAT limits of one wafer, set from its own dies (all of them: pass the wafer's full die list, not a selection,
 * since a part of a wafer is not the population the limits describe). Cached per die list.
 */
export function waferPatLimits(dies: readonly Die[], testDefs: readonly TestDef[], passBins: readonly number[]): WaferPat {
  return compute(dies, testDefs, passBins).pat;
}

/** Each die's PAT verdict on its wafer, index-aligned with `dies`. Cached with the limits. */
export function waferPatVerdicts(dies: readonly Die[], testDefs: readonly TestDef[], passBins: readonly number[]): DiePat[] {
  return compute(dies, testDefs, passBins).verdicts;
}
