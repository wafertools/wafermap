// Comparing groups of wafers (the splits of a split lot) on a measured test, with the wafer as the unit.
//
// Dies on one wafer share its processing, so they are not independent samples of a split: a test over dies counts
// every die as evidence and calls a difference of one wafer's worth "certain". Here each wafer is one value (the
// mean of its dies), and the number of samples is the number of wafers. That makes the tests honest and, with the
// three or four wafers a split usually has, often inconclusive, which is the truth about such a lot.
//
// What is computed, for groups of wafer values:
//   - Welch's ANOVA (Welch's t for two groups): are the group means different, without assuming equal spreads;
//   - Kruskal–Wallis: the same question on ranks, which a single odd wafer cannot drive;
//   - each group against a control group: Welch's t, Holm-adjusted over the comparisons;
//   - the size of each difference: in the test's unit, in wafer-to-wafer standard deviations, and as a share of the
//     limit window when the test has both limits.
// Across many tests, the overall p-values are Benjamini–Hochberg adjusted and the tests ranked by them.
//
// Pure, no DOM.

import type { Die } from '../core/dies.js';
import { testValuesReader } from '../core/dieTable.js';
import { isParametricTest, type TestDef } from '../renderer/buildWaferMap.js';
import { benjaminiHochberg, chiSquareUpperTail, fUpperTail, holm, sampleVariance, tTwoSided } from './math.js';
import { capabilityLimits } from './capability.js';
import { compareNatural, maxOf, median, minOf } from '../core/utils.js';

/** One group's wafer values, summarised. */
export interface GroupSummary {
  key: string;
  /** Wafers with a value. */
  n: number;
  mean: number;
  /** Sample standard deviation of the wafer values; NaN with fewer than two. */
  sd: number;
  median: number;
}

/** A group set against the control group. */
export interface ControlContrast {
  key: string;
  /** Group mean minus control mean, in the test's unit. */
  delta: number;
  /** `delta` over the pooled wafer-to-wafer standard deviation of the two groups. */
  deltaSd: number;
  t: number;
  df: number;
  p: number;
  /** Holm-adjusted over every group's comparison with the control. */
  pAdjusted: number;
}

export interface GroupComparison {
  groups: GroupSummary[];
  /** Groups left out of the tests, each with fewer than two wafers. */
  tooSmall: string[];
  /** Welch's ANOVA, or Welch's t for two groups. Absent when it cannot be computed (see `issue`). */
  welch?: { method: 'welch-t' | 'welch-anova'; statistic: number; df1: number; df2: number; p: number };
  /** Kruskal–Wallis on the wafer values. `approximate` when a group has fewer than five wafers: its chi-square p is then rough. */
  kruskal?: { h: number; df: number; p: number; approximate: boolean };
  control?: string;
  contrasts?: ControlContrast[];
  /** Why a test could not be computed, in the reader's words. */
  issue?: string;
}

/** Fewer wafers than this in a group, and Kruskal–Wallis's chi-square approximation is rough. */
const KRUSKAL_SMALL = 5;

const summarise = (key: string, values: readonly number[]): GroupSummary => {
  const n = values.length;
  const mean = n ? values.reduce((a, b) => a + b, 0) / n : NaN;
  return { key, n, mean, sd: n >= 2 ? Math.sqrt(sampleVariance(values, mean)) : NaN, median: n ? median([...values]) : NaN };
};

/** Welch's ANOVA of groups with at least two values each and some spread in every one. */
function welchAnova(groups: readonly GroupSummary[]): GroupComparison['welch'] {
  const k = groups.length;
  if (groups.some(g => !(g.sd > 0))) return undefined;
  if (k === 2) {
    const [a, b] = groups;
    const va = a.sd ** 2 / a.n, vb = b.sd ** 2 / b.n;
    const t = (a.mean - b.mean) / Math.sqrt(va + vb);
    const df = (va + vb) ** 2 / (va ** 2 / (a.n - 1) + vb ** 2 / (b.n - 1));
    return { method: 'welch-t', statistic: t, df1: 1, df2: df, p: tTwoSided(t, df) };
  }
  const w = groups.map(g => g.n / g.sd ** 2);
  const W = w.reduce((s, x) => s + x, 0);
  const grand = groups.reduce((s, g, i) => s + w[i] * g.mean, 0) / W;
  const between = groups.reduce((s, g, i) => s + w[i] * (g.mean - grand) ** 2, 0) / (k - 1);
  const lambda = groups.reduce((s, g, i) => s + (1 - w[i] / W) ** 2 / (g.n - 1), 0);
  const f = between / (1 + (2 * (k - 2) * lambda) / (k * k - 1));
  const df2 = (k * k - 1) / (3 * lambda);
  return { method: 'welch-anova', statistic: f, df1: k - 1, df2, p: fUpperTail(f, k - 1, df2) };
}

/** Kruskal–Wallis H with the tie correction, on the pooled ranks of every value. */
function kruskalWallis(groups: ReadonlyArray<readonly number[]>): GroupComparison['kruskal'] {
  const all = groups.flatMap((vs, g) => vs.map(v => ({ v, g })));
  const n = all.length;
  if (groups.length < 2 || n < 3) return undefined;
  all.sort((a, b) => a.v - b.v);
  const rankSum = new Array<number>(groups.length).fill(0);
  let ties = 0;
  for (let i = 0; i < n;) {
    let j = i;
    while (j + 1 < n && all[j + 1].v === all[i].v) j++;
    const rank = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) rankSum[all[k].g] += rank;
    const t = j - i + 1;
    ties += t ** 3 - t;
    i = j + 1;
  }
  const correction = 1 - ties / (n ** 3 - n);
  if (!(correction > 0)) return undefined;   // every value the same: no ranks to compare
  const h = ((12 / (n * (n + 1))) * groups.reduce((s, vs, g) => s + rankSum[g] ** 2 / vs.length, 0) - 3 * (n + 1)) / correction;
  const df = groups.length - 1;
  return { h, df, p: chiSquareUpperTail(h, df), approximate: groups.some(vs => vs.length < KRUSKAL_SMALL) };
}

/**
 * Compares groups of wafer values. Groups keep the order given (the caller's legend order). A group with fewer than
 * two wafers is summarised but left out of the tests, and named in `tooSmall`; `control`, when it names a group that
 * is tested, gets each other group set against it.
 */
export function compareGroups(groups: ReadonlyArray<{ key: string; values: readonly number[] }>, control?: string): GroupComparison {
  const clean = groups.map(g => ({ key: g.key, values: g.values.filter(Number.isFinite) }));
  const summaries = clean.map(g => summarise(g.key, g.values));
  const tested = clean.filter(g => g.values.length >= 2);
  const tooSmall = clean.filter(g => g.values.length < 2).map(g => g.key);
  const out: GroupComparison = { groups: summaries, tooSmall };
  if (tested.length < 2) {
    out.issue = 'Needs at least two groups with two or more wafers each';
    return out;
  }
  const testedSummaries = summaries.filter(s => tested.some(g => g.key === s.key));
  out.welch = welchAnova(testedSummaries);
  out.kruskal = kruskalWallis(tested.map(g => g.values));
  if (!out.welch && !out.kruskal) out.issue = 'The wafer values do not vary, so there is nothing to compare';
  else if (!out.welch) out.issue = 'A group’s wafers all have the same value, so Welch’s test cannot be computed; the rank test stands';

  const ctrl = control !== undefined ? testedSummaries.find(s => s.key === control) : undefined;
  if (ctrl) {
    const raw = testedSummaries.filter(s => s.key !== ctrl.key).map(s => {
      const va = s.sd ** 2 / s.n, vc = ctrl.sd ** 2 / ctrl.n;
      const se = Math.sqrt(va + vc);
      const delta = s.mean - ctrl.mean;
      const t = se > 0 ? delta / se : NaN;
      const df = se > 0 ? (va + vc) ** 2 / ((va ** 2) / (s.n - 1) + (vc ** 2) / (ctrl.n - 1)) : NaN;
      const pooled = Math.sqrt(((s.n - 1) * s.sd ** 2 + (ctrl.n - 1) * ctrl.sd ** 2) / (s.n + ctrl.n - 2));
      return { key: s.key, delta, deltaSd: pooled > 0 ? delta / pooled : NaN, t, df, p: Number.isFinite(t) ? tTwoSided(t, df) : NaN };
    });
    const finite = raw.filter(c => Number.isFinite(c.p));
    const adj = holm(finite.map(c => c.p));
    out.control = ctrl.key;
    out.contrasts = raw.map(c => ({ ...c, pAdjusted: Number.isFinite(c.p) ? adj[finite.indexOf(c)] : NaN }));
  }
  return out;
}

/** The p-value a comparison is read and ranked by: Welch's when it could be computed, else Kruskal–Wallis's. */
export const comparisonP = (c: GroupComparison): number => c.welch?.p ?? c.kruskal?.p ?? NaN;

// ── many tests ──────────────────────────────────────────────────────────────────────────────────────────────

/** A wafer of the comparison: its dies, and the group it is in (undefined: in no group, left out). */
export interface CompareWafer { dies: readonly Die[]; group: string | undefined }

/** One test's comparison, for the ranked table. */
export interface TestComparison {
  test: TestDef;
  comparison: GroupComparison;
  /** Benjamini–Hochberg-adjusted `comparisonP` over the tests compared. */
  pAdjusted: number;
  /** The largest group-mean difference from the control (or between groups, without one), in wafer-to-wafer SDs. */
  effect: number;
  /** The largest difference as a share of the limit window, when the test has both limits (spec first). */
  windowShare?: number;
}

/** The group keys in order: natural order, as the legend sorts them. */
export function groupKeys(wafers: readonly CompareWafer[]): string[] {
  return [...new Set(wafers.map(w => w.group).filter((g): g is string => g !== undefined))].sort(compareNatural);
}

/**
 * Every parametric test of `testDefs` compared across the groups of `wafers`, each wafer reduced to the mean of its
 * dies' values, ranked: by adjusted p, then by effect. Tests no wafer has a value for are left out; a test whose
 * comparison could not be computed ranks after those that could. One pass over the dies reads every test.
 */
export function compareTestsByGroup(wafers: readonly CompareWafer[], testDefs: readonly TestDef[], control?: string): TestComparison[] {
  const tests = testDefs.filter(isParametricTest);
  if (tests.length === 0) return [];
  const numbers = tests.map(t => t.testNumber);
  const read = testValuesReader(numbers);
  const buf = new Float64Array(numbers.length);
  const keys = groupKeys(wafers);
  // Per test, per group: the wafer means.
  const values: number[][][] = tests.map(() => keys.map(() => []));
  const sum = new Float64Array(numbers.length), count = new Uint32Array(numbers.length);
  for (const w of wafers) {
    if (w.group === undefined) continue;
    const g = keys.indexOf(w.group);
    sum.fill(0); count.fill(0);
    for (const d of w.dies) {
      read(d, buf);
      for (let k = 0; k < buf.length; k++) { const v = buf[k]; if (Number.isFinite(v)) { sum[k] += v; count[k]++; } }
    }
    for (let k = 0; k < numbers.length; k++) if (count[k] > 0) values[k][g].push(sum[k] / count[k]);
  }
  const rows = tests.map((test, k) => {
    if (values[k].every(vs => vs.length === 0)) return undefined;
    const comparison = compareGroups(keys.map((key, g) => ({ key, values: values[k][g] })), control);
    const lim = capabilityLimits(test);
    const window = lim ? lim.usl - lim.lsl : undefined;
    const tested = comparison.groups.filter(s => !comparison.tooSmall.includes(s.key));
    let effect = NaN, delta = NaN;
    if (comparison.contrasts?.length) {
      const top = comparison.contrasts.reduce((a, b) => (Math.abs(b.deltaSd) > Math.abs(a.deltaSd) ? b : a));
      effect = top.deltaSd; delta = top.delta;
    } else if (tested.length >= 2) {
      const means = tested.map(s => s.mean);
      delta = maxOf(means) - minOf(means);
      const pooledVar = tested.reduce((a, s) => a + (s.n - 1) * s.sd ** 2, 0) / tested.reduce((a, s) => a + s.n - 1, 0);
      effect = pooledVar > 0 ? delta / Math.sqrt(pooledVar) : NaN;
    }
    return { test, comparison, pAdjusted: NaN, effect, ...(window && Number.isFinite(delta) ? { windowShare: delta / window } : {}) };
  }).filter((r): r is TestComparison => r !== undefined);

  const withP = rows.filter(r => Number.isFinite(comparisonP(r.comparison)));
  const adj = benjaminiHochberg(withP.map(r => comparisonP(r.comparison)));
  withP.forEach((r, i) => { r.pAdjusted = adj[i]; });
  const rank = (r: TestComparison) => (Number.isFinite(r.pAdjusted) ? r.pAdjusted : Infinity);
  return rows.sort((a, b) => rank(a) - rank(b) || (Math.abs(b.effect) || 0) - (Math.abs(a.effect) || 0));
}

/** A p-value as a reader is shown one: three decimals, "< 0.001" below that, "—" when there is none. */
export function formatP(p: number): string {
  if (!Number.isFinite(p)) return '—';
  return p < 0.001 ? '< 0.001' : p.toFixed(3);
}
