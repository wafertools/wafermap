// Shared statistical math primitives. Single home for functions that were
// previously duplicated across analyzeWaferMap.ts and clusterDetection.ts.

/**
 * The complementary error function erfc(x) = 1 − erf(x), accurate to about 1e-15 relative across the whole
 * range, the far tail included: W. J. Cody's rational approximations (Math. Comp. 23, 1969; the CALERF
 * routine). A small p-value is read from the tail, where 1 − erf(x) computed by subtraction is noise below
 * about 1e-7 and becomes 0.
 */
export function complementaryErrorFunction(value: number): number {
  const y = Math.abs(value);
  let result: number;
  if (y <= 0.46875) {
    // erf(x) = x·P(x²)/Q(x²)
    const ysq = y > 1.11e-16 ? y * y : 0;
    let num = ERF_A[4] * ysq, den = ysq;
    for (let i = 0; i < 3; i++) { num = (num + ERF_A[i]) * ysq; den = (den + ERF_B[i]) * ysq; }
    const erf = value * (num + ERF_A[3]) / (den + ERF_B[3]);
    return 1 - erf;
  }
  if (y <= 4) {
    // erfc(x) = exp(−x²)·P(x)/Q(x)
    let num = ERFC_C[8] * y, den = y;
    for (let i = 0; i < 7; i++) { num = (num + ERFC_C[i]) * y; den = (den + ERFC_D[i]) * y; }
    result = (num + ERFC_C[7]) / (den + ERFC_D[7]);
  } else {
    // erfc(x) = exp(−x²)/x·(1/√π + 1/x²·P(1/x²)/Q(1/x²))
    if (y >= 26.543) return value > 0 ? 0 : 2;   // below the smallest normal double (Cody's XBIG)
    const ysq = 1 / (y * y);
    let num = ERFC_P[5] * ysq, den = ysq;
    for (let i = 0; i < 4; i++) { num = (num + ERFC_P[i]) * ysq; den = (den + ERFC_Q[i]) * ysq; }
    result = (1 / Math.sqrt(Math.PI) - ysq * (num + ERFC_P[4]) / (den + ERFC_Q[4])) / y;
  }
  // exp(−y²) split into two factors, so the rounding of y² does not cost the tail its precision.
  const ysqHi = Math.trunc(y * 16) / 16;
  const del = (y - ysqHi) * (y + ysqHi);
  result *= Math.exp(-ysqHi * ysqHi) * Math.exp(-del);
  return value < 0 ? 2 - result : result;
}

const ERF_A = [3.16112374387056560e00, 1.13864154151050156e02, 3.77485237685302021e02, 3.20937758913846947e03, 1.85777706184603153e-1];
const ERF_B = [2.36012909523441209e01, 2.44024637934444173e02, 1.28261652607737228e03, 2.84423683343917062e03];
const ERFC_C = [
  5.64188496988670089e-1, 8.88314979438837594e00, 6.61191906371416295e01, 2.98635138197400131e02,
  8.81952221241769090e02, 1.71204761263407058e03, 2.05107837782607147e03, 1.23033935479799725e03, 2.15311535474403846e-8,
];
const ERFC_D = [
  1.57449261107098347e01, 1.17693950891312499e02, 5.37181101862009858e02, 1.62138957456669019e03,
  3.29079923573345963e03, 4.36261909014324716e03, 3.43936767414372164e03, 1.23033935480374942e03,
];
const ERFC_P = [3.05326634961232344e-1, 3.60344899949804439e-1, 1.25781726111229246e-1, 1.60837851487422766e-2, 6.58749161529837803e-4, 1.63153871373020978e-2];
const ERFC_Q = [2.56852019228982242e00, 1.87295284992346725e00, 5.27905102951428412e-1, 6.05183413124413191e-2, 2.33520497626869185e-3];

/** The standard normal upper tail 1 − Φ(value), accurate where it is small. */
export function normalUpperTail(value: number): number {
  return 0.5 * complementaryErrorFunction(value / Math.SQRT2);
}

/**
 * The standard normal quantile Φ⁻¹(p) for 0 < p < 1 (±Infinity at 0 and 1, NaN outside): Acklam's rational
 * approximation, then one Halley step against `normalUpperTail`, which brings it to near machine precision in the
 * tails a probability plot reads.
 */
export function normalQuantile(p: number): number {
  if (!(p >= 0 && p <= 1)) return NaN;
  if (p === 0) return -Infinity;
  if (p === 1) return Infinity;
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.383577518672690e2, -3.066479806614716e1, 2.506628277459239];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
  const lowTail = 0.02425;
  let x: number;
  if (p < lowTail || p > 1 - lowTail) {
    const q = Math.sqrt(-2 * Math.log(p < lowTail ? p : 1 - p));
    x = (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
    if (p > 1 - lowTail) x = -x;
  } else {
    const q = p - 0.5, r = q * q;
    x = (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  }
  // One Halley step on e = Φ(x) − p, with Φ read from whichever tail p is in (Φ(x) = Q(−x)), so it stays exact where p
  // or 1 − p is small.
  const e = p < 0.5 ? normalUpperTail(-x) - p : (1 - p) - normalUpperTail(x);
  const u = e * Math.sqrt(2 * Math.PI) * Math.exp((x * x) / 2);
  return x - u / (1 + (x * u) / 2);
}

/** Two-sided p-value of a z statistic: the one rule every z-based test in the library reads its p from. */
export function zPValue(z: number): number {
  return Math.min(1, 2 * normalUpperTail(Math.abs(z)));
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

/** ln Γ(x) for x > 0, by the Lanczos approximation (g = 7, 9 terms): relative error near 1e-15. */
export function logGamma(x: number): number {
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - logGamma(1 - x);
  const c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
    -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
  const z = x - 1;
  let a = c[0];
  for (let i = 1; i < 9; i++) a += c[i] / (z + i);
  const t = z + 7.5;
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(a);
}

/**
 * Two-sided Fisher exact p-value of the 2×2 table [[a, b], [c, d]]: the probability, with the margins fixed,
 * of a table no more likely than the one observed. For rates whose expected counts are too small for a
 * normal approximation, which there reports differences far more significant than they are. The table's
 * probabilities are walked by their ratio, so the cost is the span of the first cell, not the dies.
 */
export function fisherExact(a: number, b: number, c: number, d: number): number {
  const row1 = a + b, row2 = c + d, col1 = a + c, n = row1 + row2;
  const lo = Math.max(0, col1 - row2), hi = Math.min(row1, col1);
  if (hi <= lo) return 1;
  const logP = (x: number): number =>
    logGamma(row1 + 1) + logGamma(row2 + 1) + logGamma(col1 + 1) + logGamma(n - col1 + 1) - logGamma(n + 1)
    - logGamma(x + 1) - logGamma(row1 - x + 1) - logGamma(col1 - x + 1) - logGamma(row2 - col1 + x + 1);
  const observed = Math.exp(logP(a));
  // P(x + 1) / P(x) = (row1 − x)(col1 − x) / ((x + 1)(row2 − col1 + x + 1)).
  let p = Math.exp(logP(lo));
  let total = 0;
  const tolerance = observed * (1 + 1e-7);
  for (let x = lo; x <= hi; x++) {
    if (p <= tolerance) total += p;
    p *= ((row1 - x) * (col1 - x)) / ((x + 1) * (row2 - col1 + x + 1));
  }
  return Math.min(1, total);
}

/**
 * A seeded uniform generator on [0, 1) (mulberry32). For resampling that must give the same answer on
 * every run (a permutation test's p-value), never for anything that should look random to a user.
 */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
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

/**
 * Holm's step-down adjustment of a family of p-values: the family-wise error rule for a few comparisons against one
 * control, where every one of them is read as a claim (BH, above, is for ranking many). Order of the input is kept.
 */
export function holm(pValues: readonly number[]): number[] {
  const m = pValues.length;
  const order = pValues.map((_, i) => i).sort((a, b) => pValues[a] - pValues[b]);
  const adjusted = new Array<number>(m);
  let runningMax = 0;
  order.forEach((i, rank) => {
    runningMax = Math.max(runningMax, Math.min(1, (m - rank) * pValues[i]));
    adjusted[i] = runningMax;
  });
  return adjusted;
}

/**
 * The regularised incomplete beta function I_x(a, b), by Lentz's continued fraction on whichever side of the mean it
 * converges fast. The one source of the t and F tails below.
 */
export function incompleteBeta(x: number, a: number, b: number): number {
  if (!(x > 0)) return 0;
  if (!(x < 1)) return 1;
  const front = Math.exp(logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log1p(-x));
  if (x > (a + 1) / (a + b + 2)) return 1 - incompleteBeta(1 - x, b, a);
  const TINY = 1e-300;
  let c = 1, d = 1 - ((a + b) * x) / (a + 1);
  if (Math.abs(d) < TINY) d = TINY;
  d = 1 / d;
  let f = d;
  for (let m = 1; m <= 300; m++) {
    for (const even of [true, false]) {
      const num = even
        ? (m * (b - m) * x) / ((a + 2 * m - 1) * (a + 2 * m))
        : -((a + m) * (a + b + m) * x) / ((a + 2 * m) * (a + 2 * m + 1));
      d = 1 + num * d; if (Math.abs(d) < TINY) d = TINY; d = 1 / d;
      c = 1 + num / c; if (Math.abs(c) < TINY) c = TINY;
      f *= c * d;
    }
    if (Math.abs(c * d - 1) < 1e-15) break;
  }
  return (front * f) / a;
}

/**
 * The regularised upper incomplete gamma Q(a, x) = Γ(a, x) / Γ(a): a series below a + 1, a continued fraction above.
 * The chi-square tail below reads it.
 */
export function upperIncompleteGamma(a: number, x: number): number {
  if (!(x > 0)) return 1;
  const lead = -x + a * Math.log(x) - logGamma(a);
  if (x < a + 1) {
    let sum = 1 / a, term = sum;
    for (let n = 1; n < 500; n++) { term *= x / (a + n); sum += term; if (Math.abs(term) < Math.abs(sum) * 1e-16) break; }
    return Math.max(0, 1 - sum * Math.exp(lead));
  }
  const TINY = 1e-300;
  let b = x + 1 - a, c = 1 / TINY, d = 1 / b, h = d;
  for (let i = 1; i < 500; i++) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b; if (Math.abs(d) < TINY) d = TINY;
    c = b + an / c; if (Math.abs(c) < TINY) c = TINY;
    d = 1 / d;
    const step = d * c;
    h *= step;
    if (Math.abs(step - 1) < 1e-16) break;
  }
  return Math.exp(lead) * h;
}

/** Two-sided p-value of Student's t with `df` degrees of freedom (fractional, as Welch's are, is fine). */
export function tTwoSided(t: number, df: number): number {
  if (!Number.isFinite(t)) return Number.isNaN(t) ? NaN : 0;
  return incompleteBeta(df / (df + t * t), df / 2, 0.5);
}

/** Upper tail P(F ≥ f) of the F distribution with (df1, df2) degrees of freedom. */
export function fUpperTail(f: number, df1: number, df2: number): number {
  if (!(f > 0)) return 1;
  return incompleteBeta(df2 / (df2 + df1 * f), df2 / 2, df1 / 2);
}

/** Upper tail P(X ≥ x) of the chi-square distribution with `df` degrees of freedom. */
export function chiSquareUpperTail(x: number, df: number): number {
  return upperIncompleteGamma(df / 2, x / 2);
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
  const pValue = zPValue(z);
  slopes.sort((a, b) => a - b);
  const mid = slopes.length >> 1;
  const slope = slopes.length % 2 ? slopes[mid] : (slopes[mid - 1] + slopes[mid]) / 2;
  const offsets = values.map((v, i) => v - slope * i).sort((a, b) => a - b);
  const m = offsets.length >> 1;
  const intercept = offsets.length % 2 ? offsets[m] : (offsets[m - 1] + offsets[m]) / 2;
  return { n, s, z, pValue, slope, intercept };
}
