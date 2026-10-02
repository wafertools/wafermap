// Drift across a lot: does the yield, or a test's mean, climb or fall wafer after wafer? A lot whose
// yield slides from 85% to 74% over six wafers has no region, bin or wafer that "stands out", and the
// spatial analysis cannot see it. This is the one place that says so.
//
// The wafers are taken in the order they were given. That is not the order they were tested unless the
// host says so (a slot number, a test time), so every sentence says "input order" and never "over time":
// a trend only means something if the order is a physical one.

import type { StatsFinding, StatsSeverity, StatsSummary } from './types.js';
import { benjaminiHochberg, mannKendall, type MannKendall } from './math.js';
import { fmt } from '../renderer/fmt.js';

/** A trend needs this many wafers: with fewer, even a perfect run of steps cannot clear the significance level. */
export const DRIFT_MIN_WAFERS = 5;
/** A significant trend in yield is reported only when the fitted line moves by at least this many points end to end. */
const DRIFT_MIN_YIELD_POINTS = 2;
/** A significant trend in a test's mean, when it moves by at least this multiple of the test's own within-wafer σ. */
const DRIFT_MIN_SIGMA = 0.5;
/** Strong when the fitted line moves this far: 5 yield points, or one σ. */
const STRONG_YIELD_POINTS = 5;
const STRONG_SIGMA = 1;

type PerWafer = ReadonlyArray<{ waferIndex: number; summary: StatsSummary }>;

interface Candidate {
  kind: 'yield' | 'test';
  testNumber?: number;
  label: string;
  /** The series, in input order. */
  values: number[];
  waferIndices: number[];
  /** Within-wafer σ pooled over the wafers, for a test (the yardstick for "how far is far"). */
  sigma?: number;
  mk: MannKendall;
}

function candidates(perWafer: PerWafer): Candidate[] {
  const out: Candidate[] = [];

  const yields = perWafer
    .map((w) => ({ waferIndex: w.waferIndex, y: w.summary.stats.yieldPercent }))
    .filter((w): w is { waferIndex: number; y: number } => w.y !== null && w.y !== undefined);
  if (yields.length >= DRIFT_MIN_WAFERS) {
    const mk = mannKendall(yields.map((w) => w.y));
    if (mk) out.push({ kind: 'yield', label: 'Yield', values: yields.map((w) => w.y), waferIndices: yields.map((w) => w.waferIndex), mk });
  }

  // A test's mean per wafer, over the wafers that have it. Needs the per-test statistics, which exist
  // only when the analysis was asked for them; without them there is simply no test trend to report.
  const byTest = new Map<number, { label: string; rows: Array<{ waferIndex: number; mean: number; n: number; sd: number }> }>();
  for (const { waferIndex, summary } of perWafer) {
    for (const t of summary.stats.perTestStats ?? []) {
      if (!Number.isFinite(t.mean) || !(t.count > 0)) continue;
      const entry = byTest.get(t.testNumber) ?? { label: t.label, rows: [] };
      entry.rows.push({ waferIndex, mean: t.mean, n: t.count, sd: t.stddev });
      byTest.set(t.testNumber, entry);
    }
  }
  for (const [testNumber, { label, rows }] of byTest) {
    if (rows.length < DRIFT_MIN_WAFERS) continue;
    const mk = mannKendall(rows.map((r) => r.mean));
    if (!mk) continue;
    const dies = rows.reduce((n, r) => n + r.n, 0);
    const sigma = Math.sqrt(rows.reduce((v, r) => v + r.n * r.sd ** 2, 0) / dies);
    out.push({ kind: 'test', testNumber, label, values: rows.map((r) => r.mean), waferIndices: rows.map((r) => r.waferIndex), sigma, mk });
  }
  return out;
}

/**
 * Trend findings for a lot: yield across the wafers, and each test's mean across them. The p-values go
 * through one Benjamini–Hochberg correction together (the tests are many), then a finding must also move
 * far enough to matter (a point or two of yield, half a σ of a test): a long run of tiny steps is
 * significant and not worth saying.
 */
export function buildDriftFindings(perWafer: PerWafer, significanceLevel: number): StatsFinding[] {
  const all = candidates(perWafer);
  if (!all.length) return [];
  const adjusted = benjaminiHochberg(all.map((c) => c.mk.pValue));

  const findings: StatsFinding[] = [];
  all.forEach((c, i) => {
    if (adjusted[i] > significanceLevel) return;
    const { slope, intercept, n } = c.mk;
    const first = intercept;
    const last = intercept + slope * (n - 1);
    const change = last - first;
    const rising = change > 0;

    const sigmas = c.kind === 'test' && c.sigma && c.sigma > 0 ? Math.abs(change) / c.sigma : undefined;
    if (c.kind === 'yield' ? Math.abs(change) < DRIFT_MIN_YIELD_POINTS : sigmas === undefined || sigmas < DRIFT_MIN_SIGMA) return;

    const strong = c.kind === 'yield' ? Math.abs(change) >= STRONG_YIELD_POINTS : (sigmas ?? 0) >= STRONG_SIGMA;
    const severity: StatsSeverity = strong && adjusted[i] <= 0.01 ? 'unusual' : 'notable';

    const verb = rising ? 'rises' : 'falls';
    // The wafers' own first and last values, which a reader can find in the table; the fitted line only sizes the trend.
    const seen = { first: c.values[0], last: c.values[c.values.length - 1] };
    const range = c.kind === 'yield' ? `${seen.first.toFixed(1)}% → ${seen.last.toFixed(1)}%` : `${fmt(seen.first)} → ${fmt(seen.last)}`;
    const through = c.kind === 'yield' ? 'on successive wafers' : 'across the wafers';

    findings.push({
      id: c.kind === 'yield' ? 'drift:yield' : `drift:test:${c.testNumber}`,
      level: 'inter-wafer',
      severity,
      variable: c.kind === 'yield'
        ? { kind: 'yield', label: 'Yield' }
        : { kind: 'test', index: c.testNumber, label: c.label },
      comparison: { family: 'wafer', left: 'Wafers in input order', right: 'a constant level' },
      effect: {
        direction: rising ? 'higher' : 'lower',
        // A fraction for yield, like every yield finding; in the test's own units for a test.
        absoluteDelta: c.kind === 'yield' ? change / 100 : change,
        ...(c.kind === 'yield' ? {} : { relativeDelta: first !== 0 ? change / Math.abs(first) : undefined }),
        effectSize: c.kind === 'yield' ? change / 100 : change / (c.sigma || 1),
      },
      stats: {
        method: 'mann-kendall',
        pValue: c.mk.pValue,
        adjustedPValue: adjusted[i],
        sampleSizeLeft: n,
        sampleSizeRight: 0,
      },
      summary: `${c.label} ${verb} ${through}: ${range} over ${n} wafers (input order)`,
      highlight: { kind: 'wafer', waferIndices: c.waferIndices },
    });
  });
  return findings;
}
