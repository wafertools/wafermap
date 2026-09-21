// Shared statistical math primitives. Single home for functions that were
// previously duplicated across analyzeWaferMap.ts and clusterDetection.ts.

/**
 * Abramowitz & Stegun 7.1.26 rational approximation of the error function.
 * Max absolute error ~1.5e-7 — ample for p-value gating.
 */
export function errorFunction(value: number): number {
  const sign = value < 0 ? -1 : 1;
  const x = Math.abs(value);
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;
  const t = 1 / (1 + p * x);
  const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
  return sign * y;
}

/** Standard normal cumulative distribution function Φ(value). */
export function normalCdf(value: number): number {
  return 0.5 * (1 + errorFunction(value / Math.sqrt(2)));
}

/** Linear-interpolation quantile of a pre-sorted array (`q` in [0, 1]).
 *
 *  `ArrayLike<number>`, not `number[]`, so a caller holding its values in a
 *  `Float64Array` does not have to copy them back into a plain array to be
 *  read — see `pooledTestStatsSteps`, which sorts in one. */
export function quantile(sorted: ArrayLike<number>, q: number): number {
  if (sorted.length === 0) return NaN;
  const pos = q * (sorted.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/** Descriptive statistics of one population of values — see {@link describeSorted}. */
export interface DescriptiveStats {
  min: number;
  max: number;
  mean: number;
  count: number;
  /** Population standard deviation (divide by n) — see {@link describeSorted}. */
  stddev: number;
  median: number;
  q1: number;
  q3: number;
}

/** Min/max/mean/count/σ and the quartiles of a pre-sorted array — the one copy
 *  of the descriptive-statistics formulas behind the Test Values table.
 *
 *  σ is the POPULATION standard deviation (divide by n), which is what this
 *  table has always shown; the capability indices next to it deliberately use
 *  the sample form (n−1) and say so. Two-pass, not `Σx² − n·x̄²`: the moments
 *  form loses most of its significant digits when the variance is small beside
 *  the mean, which is the normal shape of a passing parametric test. */
export function describeSorted(sorted: ArrayLike<number>): DescriptiveStats {
  const n = sorted.length;
  let sum = 0;
  for (let i = 0; i < n; i++) sum += sorted[i];
  const mean = sum / n;
  let sqDiff = 0;
  for (let i = 0; i < n; i++) sqDiff += (sorted[i] - mean) ** 2;
  return {
    min: sorted[0], max: sorted[n - 1], mean, count: n,
    stddev: Math.sqrt(sqDiff / n),
    median: quantile(sorted, 0.5), q1: quantile(sorted, 0.25), q3: quantile(sorted, 0.75),
  };
}
