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

/**
 * Exact one-sided binomial tail P(X ≥ k) for X ~ Binomial(n, p). Exact rather
 * than a normal approximation because it is asked about small n — how many of a
 * lot's few wafers fail at one die position — where the approximation is poor.
 */
export function binomialUpperTail(k: number, n: number, p: number): number {
  if (k <= 0) return 1;
  if (k > n) return 0;
  if (p <= 0) return 0;
  if (p >= 1) return 1;
  let logPmf = k * Math.log(p) + (n - k) * Math.log1p(-p);
  for (let i = 0; i < k; i++) logPmf += Math.log(n - i) - Math.log(i + 1);
  let pmf = Math.exp(logPmf);
  let tail = 0;
  const odds = p / (1 - p);
  for (let i = k; i <= n; i++) {
    tail += pmf;
    pmf *= ((n - i) / (i + 1)) * odds;
  }
  return Math.min(1, tail);
}

/**
 * Benjamini–Hochberg adjusted p-values, in the order given. The one
 * false-discovery-rate rule in the library: findings (`adjustPValues`) and the
 * die positions a lot's failures recur at (`findLotPattern`) both go through it.
 */
export function benjaminiHochberg(pValues: readonly number[]): number[] {
  const m = pValues.length;
  const order = pValues.map((_, i) => i).sort((a, b) => pValues[a] - pValues[b]);
  const adjusted = new Array<number>(m);
  let runningMin = 1;
  for (let rank = m - 1; rank >= 0; rank--) {
    const i = order[rank];
    runningMin = Math.min(runningMin, (pValues[i] * m) / (rank + 1), 1);
    adjusted[i] = runningMin;
  }
  return adjusted;
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

/** Robust outlier fence over a value list: Tukey's `Q1 − k·IQR … Q3 + k·IQR`.
 *
 *  Deliberately NOT mean ± 3σ. σ is computed FROM the data including the
 *  outlier, so a single reading of 1e30 inflates σ far enough that the fence no
 *  longer excludes it — the classic masking failure, and it fails hardest exactly
 *  when the outlier is worst. Quartiles are unmoved by the extreme tail.
 *
 *  The one outlier rule in the library: the histogram's outlier clip (per-die
 *  values) and outlier wafers (per-wafer yields — `waferYieldFences` in
 *  analyzeWaferLot.ts, read by the lot findings and the Summary panel's yield
 *  bars) both go through it.
 *
 *  Returns null when there are fewer than `minCount` values — too few for
 *  quartiles to mean anything — or when the IQR is zero. */
export function robustFence(values: ArrayLike<number>, k = 1.5, minCount = 8): { lo: number; hi: number } | null {
  // Quartiles by selection (`fiveNumberSummary`), not a sort: the histogram's
  // outlier clip passes every value of the active test, one per die.
  const finite = Float64Array.from(Array.from(values).filter(v => Number.isFinite(v)));
  if (finite.length < minCount) return null;
  const { q1, q3 } = fiveNumberSummary(finite);
  const iqr = q3 - q1;
  if (iqr === 0) return null;
  return { lo: q1 - k * iqr, hi: q3 + k * iqr };
}

/** The one variance rule: the sample variance, Σ(x − mean)² / (n − 1); 0 for fewer than two values.
 *  `mean` is the values' mean when the caller already has it. Two-pass, not `Σx² − n·x̄²`: the moments
 *  form loses most of its significant digits when the variance is small beside the mean, which is the
 *  normal shape of a passing parametric test. */
export function sampleVariance(values: ArrayLike<number>, mean?: number): number {
  const n = values.length;
  if (n < 2) return 0;
  if (mean === undefined) {
    let sum = 0;
    for (let i = 0; i < n; i++) sum += values[i];
    mean = sum / n;
  }
  let sqDiff = 0;
  for (let i = 0; i < n; i++) sqDiff += (values[i] - mean) ** 2;
  return sqDiff / (n - 1);
}

/** Descriptive statistics of one population of values — see {@link describeValues}. */
export interface DescriptiveStats {
  min: number;
  max: number;
  mean: number;
  count: number;
  /** Sample standard deviation (divide by n−1; 0 for fewer than two values) — see {@link sampleVariance}. */
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
 *  σ is the sample standard deviation (divide by n−1), the same rule as the
 *  capability indices and every other σ in the library — see
 *  {@link sampleVariance}. */
export function describeValues(values: Float64Array): DescriptiveStats {
  const n = values.length;
  let sum = 0;
  for (let i = 0; i < n; i++) sum += values[i];
  const mean = sum / n;
  const stddev = Math.sqrt(sampleVariance(values, mean));
  const { min, q1, median, q3, max } = fiveNumberSummary(values);
  return { min, max, mean, count: n, stddev, median, q1, q3 };
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

// ── Trend across an ordered series ────────────────────────────────────────────

export interface MannKendall {
  /** Points in the series. */
  n: number;
  /** The Mann–Kendall statistic: concordant minus discordant pairs. */
  s: number;
  /** S with continuity correction over its tie-corrected standard deviation. */
  z: number;
  /** Two-sided p-value of `z` against no monotonic trend (normal approximation). */
  pValue: number;
  /** The Theil–Sen slope: the median of every pair's slope, per step. Robust to a few wild points. */
  slope: number;
  /** The Theil–Sen line's value at the first point, so `intercept + slope × i` is the fitted series. */
  intercept: number;
}

/**
 * The Mann–Kendall test for a monotonic trend, with the Theil–Sen slope that sizes it. Rank-based, so
 * a trend need not be linear and one wild point cannot make or break it. The normal approximation is
 * conservative at small n (n = 5, a perfect trend, p ≈ 0.028 where the exact value is ≈ 0.017), which is
 * the right side to err on. `null` below three points or when every value is the same.
 */
export function mannKendall(values: readonly number[]): MannKendall | null {
  const n = values.length;
  if (n < 3) return null;
  let s = 0;
  const slopes: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    for (let j = i + 1; j < n; j++) {
      const d = values[j] - values[i];
      s += d > 0 ? 1 : d < 0 ? -1 : 0;
      slopes.push(d / (j - i));
    }
  }
  const ties = new Map<number, number>();
  for (const v of values) ties.set(v, (ties.get(v) ?? 0) + 1);
  let variance = (n * (n - 1) * (2 * n + 5)) / 18;
  for (const t of ties.values()) if (t > 1) variance -= (t * (t - 1) * (2 * t + 5)) / 18;
  if (variance <= 0) return null;
  const z = s === 0 ? 0 : (s - Math.sign(s)) / Math.sqrt(variance);
  const pValue = Math.min(1, 2 * (1 - normalCdf(Math.abs(z))));
  slopes.sort((a, b) => a - b);
  const mid = slopes.length >> 1;
  const slope = slopes.length % 2 ? slopes[mid] : (slopes[mid - 1] + slopes[mid]) / 2;
  const offsets = values.map((v, i) => v - slope * i).sort((a, b) => a - b);
  const m = offsets.length >> 1;
  const intercept = offsets.length % 2 ? offsets[m] : (offsets[m - 1] + offsets[m]) / 2;
  return { n, s, z, pValue, slope, intercept };
}
