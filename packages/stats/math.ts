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
 *  read. */
export function quantile(sorted: ArrayLike<number>, q: number): number {
  if (sorted.length === 0) return NaN;
  const pos = q * (sorted.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/** Descriptive statistics of one population of values — see {@link describeValues}. */
export interface DescriptiveStats {
  min: number;
  max: number;
  mean: number;
  count: number;
  /** Population standard deviation (divide by n) — see {@link describeValues}. */
  stddev: number;
  median: number;
  q1: number;
  q3: number;
}

/** Min/max/mean/count/σ and the quartiles of `values` — the one copy of the
 *  descriptive-statistics formulas behind the Test Values table.
 *
 *  **Reorders `values`** (a partial sort, in place): the quartiles are found by
 *  selection, not by sorting every value. They are the same order statistics a
 *  sort would give, interpolated as {@link quantile} does, so the figures are
 *  identical; a full sort was ~24 ms per test at 266k values in Chrome and made
 *  up almost all of a large lot panel's time. The mean and σ sum in whatever
 *  order `values` arrives in.
 *
 *  σ is the POPULATION standard deviation (divide by n), which is what this
 *  table has always shown; the capability indices next to it deliberately use
 *  the sample form (n−1) and say so. Two-pass, not `Σx² − n·x̄²`: the moments
 *  form loses most of its significant digits when the variance is small beside
 *  the mean, which is the normal shape of a passing parametric test. */
export function describeValues(values: Float64Array): DescriptiveStats {
  const n = values.length;
  let sum = 0;
  for (let i = 0; i < n; i++) sum += values[i];
  const mean = sum / n;
  let sqDiff = 0;
  for (let i = 0; i < n; i++) sqDiff += (values[i] - mean) ** 2;
  const { min, q1, median, q3, max } = fiveNumberSummary(values);
  return { min, max, mean, count: n, stddev: Math.sqrt(sqDiff / n), median, q1, q3 };
}

/** Min, quartiles and max of `values` — what sorting them and reading the
 *  ends and {@link quantile}s would give — by selection. **Reorders `values`.** */
export function fiveNumberSummary(values: Float64Array): { min: number; q1: number; median: number; q3: number; max: number } {
  let min = Infinity, max = -Infinity;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (v < min) min = v;
    if (v > max) max = v;
  }
  if (values.length === 0) { min = NaN; max = NaN; }
  const { q1, median, q3 } = quartilesBySelection(values);
  return { min, q1, median, q3, max };
}

/**
 * The three quartiles of `a`, as {@link quantile} would give them on the sorted
 * array, by selection: the median first, then each outer quartile inside its own
 * half. Each interpolated quartile needs the next order statistic too, which is
 * the smallest value to its right within that part. Reorders `a`.
 */
function quartilesBySelection(a: Float64Array): { q1: number; median: number; q3: number } {
  const n = a.length;
  if (n === 0) return { q1: NaN, median: NaN, q3: NaN };
  const last = n - 1;
  // Quantile `q` from the part [lo, hi], which holds exactly the order
  // statistics lo..hi of the whole array.
  const at = (q: number, lo: number, hi: number): number => {
    const pos = q * last;
    const k = Math.floor(pos);
    const v = selectKth(a, k, lo, hi);
    if (pos === k) return v;
    let next = Infinity;
    for (let i = k + 1; i <= hi; i++) if (a[i] < next) next = a[i];
    return v + (next - v) * (pos - k);
  };
  const km = Math.floor(0.5 * last);
  const median = at(0.5, 0, last);
  // After the median's selection, [0, km) holds the order statistics below km,
  // a[km] is order statistic km and (km, last] holds those above. Each outer
  // quartile is then selected inside its own part, which keeps that true.
  const k1 = Math.floor(0.25 * last);
  const q1 = k1 === km ? at(0.25, km, last) : belowMedian(0.25, k1, km);
  const k3 = Math.floor(0.75 * last);
  const q3 = k3 === km ? at(0.75, km, last) : at(0.75, km + 1, last);
  return { q1, median, q3 };

  // A quartile below the median's index: selected within [0, km - 1]; its
  // neighbour (order statistic k + 1) may be a[km] itself.
  function belowMedian(q: number, k: number, kMedian: number): number {
    const pos = q * last;
    const v = selectKth(a, k, 0, kMedian - 1);
    if (pos === k) return v;
    let next = a[kMedian];
    for (let i = k + 1; i < kMedian; i++) if (a[i] < next) next = a[i];
    return v + (next - v) * (pos - k);
  }
}

/** The k-th smallest value of a[lo..hi], moving it to index k (Hoare quickselect,
 *  median-of-three pivot). Afterwards a[lo..k-1] ≤ a[k] ≤ a[k+1..hi]. */
function selectKth(a: Float64Array, k: number, lo: number, hi: number): number {
  while (lo < hi) {
    const x = a[lo], y = a[(lo + hi) >>> 1], z = a[hi];
    const pivot = x < y ? (y < z ? y : (x < z ? z : x)) : (x < z ? x : (y < z ? z : y));
    let i = lo, j = hi;
    while (i <= j) {
      while (a[i] < pivot) i++;
      while (a[j] > pivot) j--;
      if (i <= j) { const t = a[i]; a[i] = a[j]; a[j] = t; i++; j--; }
    }
    if (k <= j) hi = j;
    else if (k >= i) lo = i;
    else break;
  }
  return a[k];
}
