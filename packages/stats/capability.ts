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
import { type Chunked, drain } from '../core/utils.js';
import { isParametricTest, type TestDef } from '../renderer/buildWaferMap.js';
import { testLabel, derivedFields } from '../renderer/testLabel.js';
import { type DescriptiveStats, describeSorted, quantile } from './math.js';
import type { TestCapability } from './types.js';

export interface CapabilityDatum {
  testNumber: number;
  label: string;
  unit?: string;
  /** Computed from other tests rather than measured — see `TestCapability.derived`. */
  derived?: true;
  /** The expression a `derived` test was computed from, for display. */
  expression?: string;
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

/**
 * Roughly how many die-test values one step of the chunked die pass reads
 * before offering to yield. 250,000 measured at ~75 ms on a 2021 laptop in
 * Chrome, comfortably inside the ~500 ms a main thread may block without the
 * browser calling the page unresponsive, with room for a slower machine.
 */
const VALUES_PER_STEP = 250_000;

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
 *
 * {@link Chunked} so a lot-sized pass can be driven a slice at a time — see
 * `accumulateMoments` below for the plain synchronous entry.
 */
function* accumulateMomentsSteps(
  items: CapabilityItem[],
  defByTestNumber: Map<number, TestDef>,
  values: Map<number, number[]> | null,
): Chunked<Map<number, CapabilityMoments>> {
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
  // Yield on a VALUE budget, not a die budget: this pass costs dies x tests, so
  // "every 20,000 dies" is a short step at 5 tests and a multi-second one at
  // 100. The floor keeps a very wide program making real progress per step.
  const diesPerStep = Math.max(500, Math.floor(VALUES_PER_STEP / Math.max(1, T)));
  let sinceYield = 0;

  for (const item of items) {
    wn.fill(0); wsum.fill(0); wsumSq.fill(0);
    for (const die of item.dies ?? []) {
      // Safe to pause here: every accumulator is already written, and the
      // within-wafer roll-up below only reads `wn`/`wsum`/`wsumSq`.
      if (++sinceYield >= diesPerStep) { sinceYield = 0; yield; }
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

/** {@link accumulateMomentsSteps}, run straight through. */
function accumulateMoments(
  items: CapabilityItem[],
  defByTestNumber: Map<number, TestDef>,
  values: Map<number, number[]> | null,
): Map<number, CapabilityMoments> {
  return drain(accumulateMomentsSteps(items, defByTestNumber, values));
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
    testNumber, label: testLabel(def, testNumber), unit: def.unit,
    ...derivedFields(def),
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
  return drain(buildCapabilityDataSteps(items, testDefs));
}

/**
 * @internal {@link buildCapabilityData} as a {@link Chunked} computation, for a
 * caller rendering on the main thread — a lot-sized call walks every die of
 * every wafer once per test and then sorts every value of every test, which is
 * seconds of uninterruptible work at lot scale. Steps are one slice of the die
 * pass, or one test's sort. Same result, same order; the synchronous entry
 * above is this function drained.
 */
export function* buildCapabilityDataSteps(items: CapabilityItem[], testDefs: TestDef[]): Chunked<CapabilityDatum[]> {
  // Sliced, not handed out directly: the pooled result is memoised and shared
  // with the summary panel, so a caller that sorted or spliced the array it got
  // back would be editing the next caller's data.
  return (yield* pooledTestStatsSteps(items, testDefs)).capability.slice();
}

/** @internal Everything {@link pooledTestStatsSteps} derives from its one pass. */
export interface PooledTestStats {
  /**
   * Raw (NOT normalised) descriptive statistics per test number, over the
   * pooled eligible dies — the population every other figure here describes.
   * Only tests that are parametric, carry a `TestDef`, and have at least one
   * finite value appear.
   */
  stats: Map<number, DescriptiveStats>;
  /**
   * Per test, how many pooled values fell outside the test's own spec limits —
   * the spec-yield tally, counted off the sorted values this pass already held.
   * Only tests carrying at least one limit appear. `fail` counts `v < limitLow`
   * or `v > limitHigh`, matching the per-die judgement everywhere else.
   *
   * This is here rather than the sorted arrays themselves because the result is
   * memoised: a tally is a handful of numbers per test, whereas the values are
   * every die-test reading in the lot (~160 MB on a 200k x 100 lot, §5's
   * browser ceiling territory) and must not outlive the pass that built them.
   */
  specTally: Map<number, { n: number; fail: number }>;
  /** Capability indices plus the chart's normalised five-number summary,
   *  worst-Ppk first. */
  capability: CapabilityDatum[];
}

/**
 * The pooled population, in the only terms the cache can honestly key on: which
 * `Die[]` arrays and which `TestDef`s. Sound because a `Die` is frozen once
 * `buildWaferMap` returns it — every mutation (`attachData`, probe sequencing,
 * retest resolution, edge exclusion, which re-stamps rather than assigns) runs
 * at build time, and `edgeExclusion` is a `waferConfig` field with no runtime
 * toggle. So an array's identity determines its contents for its whole life.
 *
 * `testDefs` is matched by VALUE, not identity: the lot panel, the Insights
 * Overview and the capability chart each build their own array over the same
 * definitions, so identity would miss on every cross-surface hit — which is the
 * only hit worth having.
 */
const pooledCache = new Map<string, PooledTestStats>();
const POOLED_CACHE_ENTRIES = 4;

/** Stable ids for die arrays. A `WeakMap`, so a retained key string never
 *  retains a lot's dies — the cache can go stale but can never leak. */
const dieArrayIds = new WeakMap<readonly Die[], number>();
let nextDieArrayId = 1;

function pooledCacheKey(items: CapabilityItem[], testDefs: TestDef[]): string {
  const ids: number[] = [];
  for (const item of items) {
    const dies = item.dies;
    if (!dies) { ids.push(0); continue; }
    let id = dieArrayIds.get(dies);
    if (id === undefined) { id = nextDieArrayId++; dieArrayIds.set(dies, id); }
    ids.push(id);
  }
  // Every field the pass reads off a def, so a changed limit cannot hit a
  // cached tally computed against the old one.
  const defs = testDefs.map(d =>
    `${d.testNumber}${d.testType ?? 'P'}${d.limitLow ?? ''}${d.limitHigh ?? ''}${d.name ?? ''}${d.unit ?? ''}`);
  return `${ids.join(',')}${defs.join('')}`;
}

/** @internal Test seam — `tests/pooledTestStatsCache.test.mjs`. */
export function clearPooledTestStatsCache(): void { pooledCache.clear(); }

/** Index of the first value >= `x` in an ascending array. */
function lowerBound(sorted: ArrayLike<number>, x: number): number {
  let lo = 0, hi = sorted.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (sorted[mid] < x) lo = mid + 1; else hi = mid; }
  return lo;
}

/** Index of the first value > `x` in an ascending array. */
function upperBound(sorted: ArrayLike<number>, x: number): number {
  let lo = 0, hi = sorted.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (sorted[mid] <= x) lo = mid + 1; else hi = mid; }
  return lo;
}

/**
 * @internal Per-test descriptive statistics AND capability indices for a pooled
 * population, from **one** walk of the dies.
 *
 * The summary panel used to scan the pooled dies three times over: once per
 * test for min/σ/quartiles, once per test again to count spec failures, and a
 * third time inside `buildCapabilityData` for the Ppk column beside them — all
 * reading the same values off the same dies and all of them O(dies × tests).
 * On a 50-wafer lot of 4,000 dies × 100 tests that was 40 s of a 41 s panel
 * render. One pass collects the values, one sort per test serves the quantiles
 * of both the table and the chart, and the spec tally reads the sorted array.
 *
 * {@link Chunked}: one step per slice of the die pass, one per test thereafter.
 */
export function* pooledTestStatsSteps(
  items: CapabilityItem[],
  testDefs: TestDef[],
): Chunked<PooledTestStats> {
  const key = pooledCacheKey(items, testDefs);
  const hit = pooledCache.get(key);
  // Re-inserted so the eviction below is least-recently-USED, not oldest: the
  // lot panel and Insights read the same entry repeatedly across a session.
  if (hit) { pooledCache.delete(key); pooledCache.set(key, hit); return hit; }

  const empty: PooledTestStats = { stats: new Map(), specTally: new Map(), capability: [] };
  const { defByTestNumber, specByTest } = capabilityDefs(testDefs);
  if (defByTestNumber.size === 0) return empty;
  const values = new Map<number, number[]>();
  const accs = yield* accumulateMomentsSteps(items, defByTestNumber, values);

  const stats = new Map<number, DescriptiveStats>();
  const specTally = new Map<number, { n: number; fail: number }>();
  const out: CapabilityDatum[] = [];
  for (const def of testDefs) {
    yield;
    const testNumber = def.testNumber;
    if (testNumber === undefined) continue;
    const acc = accs.get(testNumber);
    if (!acc || acc.n === 0 || !defByTestNumber.has(testNumber)) continue;
    // Sorted as a `Float64Array`, NOT as the plain array the pass collected
    // into. This one line is the whole per-test step, and the per-test step is
    // the longest task this library runs: measured in Chrome on a 50-wafer lot
    // of 8,000 dies x 50 tests, `array.sort((a, b) => a - b)` over one test's
    // 400,000 pooled values was 486 ms of a 497 ms step and 10.9 s of a 13.3 s
    // panel. A typed array sorts numerically in the engine with no comparator
    // callback per comparison: the same 400,000 values, including the copy in,
    // are 45 ms on the same machine — 4.4x, and it is what puts the longest
    // step back under the ~500 ms at which the browser starts offering to kill
    // the page.
    //
    // The plain array is dropped from `values` as it is copied, so the extra
    // copy is one test's values (~3 MB at 400k), never the lot's.
    const raw = values.get(testNumber)!;
    values.delete(testNumber);
    const allValues = Float64Array.from(raw);
    // No comparator: `TypedArray.prototype.sort` is numeric ascending by
    // definition, which is exactly what `(a, b) => a - b` asked for. Every
    // value here passed `Number.isFinite`, so there are no NaNs to order.
    allValues.sort();
    stats.set(testNumber, describeSorted(allValues));

    // The spec-limit tally, by binary search on the array we just sorted — the
    // panel used to get this from a second full scan of every pooled die.
    if (def.limitLow !== undefined || def.limitHigh !== undefined) {
      const below = def.limitLow !== undefined ? lowerBound(allValues, def.limitLow) : 0;
      const above = def.limitHigh !== undefined ? allValues.length - upperBound(allValues, def.limitHigh) : 0;
      specTally.set(testNumber, { n: allValues.length, fail: below + above });
    }

    const spec = specByTest.get(testNumber);
    const figures = capabilityFromMoments(testNumber, def, spec, acc);

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
  const result: PooledTestStats = { stats, specTally, capability: sortCapability(out) };
  // `values` — every reading in the lot — goes out of scope here. Only the
  // per-test derivations above are cached.
  pooledCache.set(key, result);
  if (pooledCache.size > POOLED_CACHE_ENTRIES) {
    pooledCache.delete(pooledCache.keys().next().value as string);
  }
  return result;
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
