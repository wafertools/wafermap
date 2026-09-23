// Pearson correlation matrix across parametric tests — generalized from
// tsmap's own charts/aggregate.ts. Pure math over dies/testValues, no
// rendering dependency, so it belongs alongside analyzeWaferMap/Lot rather
// than locked inside a host's chart layer.
//
// Deliberate exception to the "prefer StatsSummary.stats.perTestStats over
// raw Die[]" dedup pattern used elsewhere in this package: correlation needs
// each die's *paired* values across two tests (test A and test B on the same
// die), not each test's marginal distribution independently. `perTestStats`
// only carries per-test summaries — it cannot reconstruct which die
// contributed which pair — so this module always reads raw `Die[]`.

import type { Die } from '../core/dies.js';
import { isParametricTest, type TestDef } from '../renderer/buildWaferMap.js';
import { markedTestLabel, derivedFields } from '../renderer/testLabel.js';

/** Minimal per-test identity carried on a correlation matrix's axes. */
export interface CorrelationTestInfo {
  testNumber: number;
  /** Display name; a derived test's starts with `"† "` (`markedTestLabel`). */
  label: string;
  unit?: string;
  derived?: true;
  expression?: string;
}

export interface CorrelationCell {
  xIndex: number;
  yIndex: number;
  r: number | null; // null = insufficient data
  /**
   * Dies contributing to this pair — i.e. those carrying a finite value for BOTH
   * tests, which is not the same as the population size when tests have different
   * coverage. An `r` without its `n` is not interpretable: |r| = 0.8 over 6 dies
   * and over 6,000 are very different claims, and the panel's "strong pair" count
   * thresholds on |r| alone.
   */
  n: number;
}

/**
 * Pearson r from running sums. The single implementation of the formula —
 * `buildCorrelationMatrix`'s per-pair accumulators and `pearsonOfPairs` (used by
 * the scatter panel to report r for the pair it is displaying) both go through
 * here, so the matrix cell and the scatter card can never disagree about the
 * same pair. Returns null below 3 points or with zero variance in either axis.
 */
export function pearsonFromSums(
  c: number, sumX: number, sumY: number, sumXX: number, sumYY: number, sumXY: number,
): number | null {
  if (c < 3) return null;
  const mx = sumX / c, my = sumY / c;
  const covXY = sumXY / c - mx * my;
  const varX  = sumXX / c - mx * mx;
  const varY  = sumYY / c - my * my;
  const denom = Math.sqrt(varX * varY);
  return denom === 0 ? null : Math.max(-1, Math.min(1, covXY / denom));
}

/** Pearson r and n for an explicit list of XY pairs — the scatter panel's own
 *  displayed points, after any legend filtering. Shares `pearsonFromSums` with
 *  the matrix. */
export function pearsonOfPairs(pairs: ArrayLike<{ x: number; y: number }>): { r: number | null; n: number } {
  let c = 0, sumX = 0, sumY = 0, sumXX = 0, sumYY = 0, sumXY = 0;
  for (let i = 0; i < pairs.length; i++) {
    const { x, y } = pairs[i];
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    c++; sumX += x; sumY += y; sumXX += x * x; sumYY += y * y; sumXY += x * y;
  }
  return { r: pearsonFromSums(c, sumX, sumY, sumXX, sumYY, sumXY), n: c };
}

export interface CorrelationMatrix {
  tests: CorrelationTestInfo[];
  cells: CorrelationCell[];
  /**
   * Present only when the matrix was computed from a sample of the dies rather
   * than all of them — see `CORRELATION_DIE_BUDGET`. `of` is the population that
   * carried test values, `used` how many were read.
   *
   * **Any surface showing this matrix must say so.** An `r` from a sample is a
   * perfectly good estimate, but an unlabelled one is a number the reader will
   * take for the whole population — the exact class of quietly-wrong figure this
   * library exists to prevent. `correlationSampleNote()` is the wording.
   */
  sample?: { of: number; used: number };
}

/**
 * Dies read before `buildCorrelationMatrix` starts sampling.
 *
 * Correlation is the only computation here that is quadratic in tests *and*
 * linear in dies: a 400k-die, 50-test lot is 1,225 pairs per die — 490 million
 * pair updates, each touching six accumulators — which in a browser presents as
 * a panel that never renders (tsmap WMAP_ISSUES #61).
 *
 * 25,000 is far past the point where more dies change a Pearson coefficient: the
 * standard error of r is about `(1 - r²)/sqrt(n)`, so at n = 25,000 it is under
 * 0.007 even for r = 0. Sixteen times more dies would halve an error that is
 * already invisible at two decimal places.
 */
export const CORRELATION_DIE_BUDGET = 25_000;

/**
 * Evenly spread `budget` indices across `length` — every stride-th die, not the
 * first N.
 *
 * Taking a prefix would be a biased sample of a wafer map, not a cheap one: dies
 * arrive grouped by wafer and ordered within it, so the first 25,000 of a 400k-die
 * lot are the first few wafers, and a correlation computed from them describes
 * those wafers rather than the lot. Striding covers every wafer and every region
 * of each.
 */
function strideIndices(length: number, budget: number): number[] {
  const out: number[] = [];
  // Float step, floored per index: distributes the remainder instead of letting
  // an integer stride run out before the end of the array.
  const step = length / budget;
  for (let k = 0; k < budget; k++) out.push(Math.floor(k * step));
  return out;
}

/** The sentence a panel puts next to a sampled matrix. */
export function correlationSampleNote(sample: CorrelationMatrix['sample']): string | undefined {
  if (!sample) return undefined;
  return `From a ${sample.used.toLocaleString()}-die sample of ${sample.of.toLocaleString()}, `
    + `spread evenly across the lot`;
}

function testInfoFrom(testDefs: TestDef[]): CorrelationTestInfo[] {
  return testDefs
    .filter((d): d is TestDef & { testNumber: number } => d.testNumber !== undefined && isParametricTest(d))
    .map(d => ({ testNumber: d.testNumber, label: markedTestLabel(d, d.testNumber), unit: d.unit, ...derivedFields(d) }));
}

/**
 * Pearson correlation matrix for every test in `testDefs` across every die
 * in `dies`.
 *
 * Running-accumulator algorithm: one die-walk, 6 Float64 accumulators per
 * upper-triangle pair (count, sumX, sumY, sumXX, sumYY, sumXY). No pair
 * arrays stored — O(N²) memory, O(N×D + N²) time.
 */
export function buildCorrelationMatrix(dies: Die[], testDefs: TestDef[]): CorrelationMatrix {
  const tests = testInfoFrom(testDefs);
  if (tests.length < 2) return { tests, cells: [] };

  const n = tests.length;
  const nums = tests.map(t => t.testNumber);
  const pairs = (n * (n - 1)) / 2;

  // Flat typed arrays: 6 accumulators per upper-triangle pair, indexed by pairIndex(xi,yi).
  // pairIndex(xi, yi) for xi < yi: xi*n - xi*(xi+1)/2 + (yi - xi - 1)
  const cnt   = new Float64Array(pairs);
  // Per-TEST count, for the diagonal. The diagonal is a test against itself, not
  // a pair, so it has no entry in the pair arrays — `pairIndex(xi, xi)` violates
  // that function's own `xi < yi` precondition and returns either -1 (xi = 0) or
  // the index of an unrelated pair, e.g. pairIndex(1,1) === pairIndex(0,4).
  const selfCnt = new Float64Array(n);
  const sumX  = new Float64Array(pairs);
  const sumY  = new Float64Array(pairs);
  const sumXX = new Float64Array(pairs);
  const sumYY = new Float64Array(pairs);
  const sumXY = new Float64Array(pairs);

  function pairIndex(xi: number, yi: number): number {
    // xi < yi guaranteed at call sites
    return xi * n - ((xi * (xi + 1)) >> 1) + (yi - xi - 1);
  }

  // With test values, and in a stable order, so the sample can stride across the
  // whole population rather than over dies that may carry nothing.
  const withValues = dies.filter(
    (d): d is Die & { testValues: NonNullable<Die['testValues']> } => d.testValues !== undefined,
  );
  const sampling = withValues.length > CORRELATION_DIE_BUDGET;
  const read = sampling
    ? strideIndices(withValues.length, CORRELATION_DIE_BUDGET).map(i => withValues[i])
    : withValues;

  // Hoisted out of the die loop: these were allocated per die, which is two
  // allocations per die (800k on a 400k-die lot) for scratch that is fully
  // overwritten each time.
  const vals = new Float64Array(n);
  const valid = new Uint8Array(n);

  for (const die of read) {
    valid.fill(0);
    for (let i = 0; i < n; i++) {
      const v = die.testValues[nums[i]];
      if (v !== undefined && Number.isFinite(v)) { vals[i] = v; valid[i] = 1; }
    }
    for (let xi = 0; xi < n; xi++) {
      if (!valid[xi]) continue;
      selfCnt[xi]++;
      const x = vals[xi];
      for (let yi = xi + 1; yi < n; yi++) {
        if (!valid[yi]) continue;
        const y = vals[yi];
        const pi = pairIndex(xi, yi);
        cnt[pi]++;
        sumX[pi]  += x;
        sumY[pi]  += y;
        sumXX[pi] += x * x;
        sumYY[pi] += y * y;
        sumXY[pi] += x * y;
      }
    }
  }

  const pearsonFromAccumulators = (pi: number): number | null =>
    pearsonFromSums(cnt[pi], sumX[pi], sumY[pi], sumXX[pi], sumYY[pi], sumXY[pi]);

  const cells: CorrelationCell[] = [];
  for (let yi = 0; yi < n; yi++) {
    for (let xi = 0; xi < n; xi++) {
      if (xi === yi) {
        cells.push({ xIndex: xi, yIndex: yi, r: 1, n: selfCnt[xi] });
        continue;
      }
      const lo = Math.min(xi, yi), hi = Math.max(xi, yi);
      const pi = pairIndex(lo, hi);
      cells.push({ xIndex: xi, yIndex: yi, r: pearsonFromAccumulators(pi), n: cnt[pi] });
    }
  }
  return sampling
    ? { tests, cells, sample: { of: withValues.length, used: read.length } }
    : { tests, cells };
}

export interface CorrelationSummary {
  /** Filtered matrix — tests trimmed to [minTests, maxTests] by significance. */
  matrix: CorrelationMatrix;
  /** Upper-triangle pairs with |r| ≥ 0.7 (across the full input matrix). */
  strongPairs: number;
  /** Upper-triangle pairs with 0.4 ≤ |r| < 0.7 (across the full input matrix). */
  moderatePairs: number;
  /** Upper-triangle pairs with |r| < threshold that were excluded from display. */
  hiddenWeakPairs: number;
  /** Strongest pair by |r|, or null if no non-null off-diagonal cells exist. */
  strongestPair: { xLabel: string; yLabel: string; r: number } | null;
}

/**
 * Filter a correlation matrix to tests involved in significant pairs, clamped to
 * [minTests, maxTests]. Pairs are ranked by |r|; the threshold gates which pairs
 * count as "significant" for display selection, but all pair counts are computed
 * over the full input matrix for the summary line. Original test-number order is
 * preserved so matrix axes stay sorted.
 */
export function filterCorrelationMatrix(
  matrix: CorrelationMatrix,
  { threshold = 0.3, minTests = 6, maxTests = 20 }: { threshold?: number; minTests?: number; maxTests?: number } = {},
): CorrelationSummary {
  // Collect upper-triangle pairs with their |r|
  type Pair = { xi: number; yi: number; absR: number };
  const allPairs: Pair[] = [];
  let strongPairs = 0, moderatePairs = 0;
  let strongestPair: CorrelationSummary['strongestPair'] = null;

  for (const cell of matrix.cells) {
    if (cell.xIndex >= cell.yIndex || cell.r === null) continue;
    const absR = Math.abs(cell.r);
    allPairs.push({ xi: cell.xIndex, yi: cell.yIndex, absR });
    if (strongestPair === null || absR > Math.abs(strongestPair.r)) {
      strongestPair = { xLabel: matrix.tests[cell.xIndex].label, yLabel: matrix.tests[cell.yIndex].label, r: cell.r };
    }
  }

  // Sort pairs by |r| descending to pick the most significant for display
  allPairs.sort((a, b) => b.absR - a.absR);

  // Grow the display test set by adding tests from pairs, most significant first,
  // until we reach maxTests or exhaust significant pairs (|r| ≥ threshold).
  // Then pad with the next-best pairs until minTests is reached.
  const displayTestIndices = new Set<number>();

  for (const { xi, yi, absR } of allPairs) {
    const belowThreshold = absR < threshold;
    if (displayTestIndices.size >= maxTests) continue;
    if (belowThreshold && displayTestIndices.size >= minTests) continue;
    displayTestIndices.add(xi);
    if (displayTestIndices.size < maxTests) displayTestIndices.add(yi);
  }

  // Fallback: when too few pairs have a computable r (e.g. a single low-variance
  // group restricted from a multi-lot load — within-lot spread can be ~0, so
  // Pearson is undefined), still show the first tests so the matrix renders with
  // explicit blank cells rather than collapsing to nothing. Without this a group
  // with no significant pairs shows an empty grid that reads as "broken".
  if (displayTestIndices.size < Math.min(minTests, matrix.tests.length)) {
    for (let i = 0; i < matrix.tests.length && displayTestIndices.size < Math.min(maxTests, minTests, matrix.tests.length); i++) {
      displayTestIndices.add(i);
    }
  }

  // Sort display tests by mean |r| descending so the most correlated tests cluster top-left
  const sortedIndices = (() => {
    const indices = Array.from(displayTestIndices);
    const sumR = new Map<number, number>();
    const cnt  = new Map<number, number>();
    for (const { xi, yi, absR } of allPairs) {
      if (!displayTestIndices.has(xi) || !displayTestIndices.has(yi)) continue;
      sumR.set(xi, (sumR.get(xi) ?? 0) + absR);
      sumR.set(yi, (sumR.get(yi) ?? 0) + absR);
      cnt.set(xi,  (cnt.get(xi)  ?? 0) + 1);
      cnt.set(yi,  (cnt.get(yi)  ?? 0) + 1);
    }
    const meanR = (i: number) => (cnt.get(i) ?? 0) > 0 ? sumR.get(i)! / cnt.get(i)! : 0;
    return indices.sort((a, b) => meanR(b) - meanR(a));
  })();
  const displayTests = sortedIndices.map(i => matrix.tests[i]);

  // Remap cells to new indices
  const newIndexOf = new Map(sortedIndices.map((origI, newI) => [origI, newI]));
  const displayTestNums = new Set(displayTests.map(t => t.testNumber));
  const trimmedCells = matrix.cells
    .filter(c => displayTestNums.has(matrix.tests[c.xIndex].testNumber) &&
                 displayTestNums.has(matrix.tests[c.yIndex].testNumber))
    .map(c => ({ xIndex: newIndexOf.get(c.xIndex)!, yIndex: newIndexOf.get(c.yIndex)!, r: c.r, n: c.n }));

  // Count pair strengths across displayed tests only, so the summary is coherent with what's shown
  let hiddenWeakPairs = 0;
  for (const { xi, yi, absR } of allPairs) {
    const inDisplay = displayTestIndices.has(xi) && displayTestIndices.has(yi);
    if (inDisplay) {
      if (absR >= 0.7) strongPairs++;
      else if (absR >= 0.4) moderatePairs++;
    } else if (absR < threshold) {
      hiddenWeakPairs++;
    }
  }

  return {
    matrix: { tests: displayTests, cells: trimmedCells },
    strongPairs,
    moderatePairs,
    hiddenWeakPairs,
    strongestPair,
  };
}
