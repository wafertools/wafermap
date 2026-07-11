// Pearson correlation matrix across parametric tests — generalized from
// tsmap's own charts/aggregate.ts. Pure math over dies/testValues, no
// rendering dependency, so it belongs alongside analyzeWaferMap/Lot rather
// than locked inside a host's chart layer.

import type { Die } from '../core/dies.js';
import type { TestDef } from '../renderer/buildWaferMap.js';

/** Minimal per-test identity carried on a correlation matrix's axes. */
export interface CorrelationTestInfo {
  testNumber: number;
  label: string;
  unit?: string;
}

export interface CorrelationCell {
  xIndex: number;
  yIndex: number;
  r: number | null; // null = insufficient data
}

export interface CorrelationMatrix {
  tests: CorrelationTestInfo[];
  cells: CorrelationCell[];
}

function testInfoFrom(testDefs: TestDef[]): CorrelationTestInfo[] {
  return testDefs
    .filter((d): d is TestDef & { testNumber: number } => d.testNumber !== undefined)
    .map(d => ({ testNumber: d.testNumber, label: d.name, unit: d.unit }));
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
  const sumX  = new Float64Array(pairs);
  const sumY  = new Float64Array(pairs);
  const sumXX = new Float64Array(pairs);
  const sumYY = new Float64Array(pairs);
  const sumXY = new Float64Array(pairs);

  function pairIndex(xi: number, yi: number): number {
    // xi < yi guaranteed at call sites
    return xi * n - ((xi * (xi + 1)) >> 1) + (yi - xi - 1);
  }

  for (const die of dies) {
    if (!die.testValues) continue;
    // Read all test values for this die once
    const vals = new Float64Array(n);
    const valid = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      const v = die.testValues[nums[i]];
      if (v !== undefined && Number.isFinite(v)) { vals[i] = v; valid[i] = 1; }
    }
    for (let xi = 0; xi < n; xi++) {
      if (!valid[xi]) continue;
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

  function pearsonFromAccumulators(pi: number): number | null {
    const c = cnt[pi];
    if (c < 3) return null;
    const mx = sumX[pi] / c, my = sumY[pi] / c;
    const covXY = sumXY[pi] / c - mx * my;
    const varX  = sumXX[pi] / c - mx * mx;
    const varY  = sumYY[pi] / c - my * my;
    const denom = Math.sqrt(varX * varY);
    return denom === 0 ? null : Math.max(-1, Math.min(1, covXY / denom));
  }

  const cells: CorrelationCell[] = [];
  for (let yi = 0; yi < n; yi++) {
    for (let xi = 0; xi < n; xi++) {
      if (xi === yi) { cells.push({ xIndex: xi, yIndex: yi, r: 1 }); continue; }
      const lo = Math.min(xi, yi), hi = Math.max(xi, yi);
      const r = pearsonFromAccumulators(pairIndex(lo, hi));
      cells.push({ xIndex: xi, yIndex: yi, r });
    }
  }
  return { tests, cells };
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
    .map(c => ({ xIndex: newIndexOf.get(c.xIndex)!, yIndex: newIndexOf.get(c.yIndex)!, r: c.r }));

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
