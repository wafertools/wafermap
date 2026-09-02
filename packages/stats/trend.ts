// Per-item (typically per-wafer) mean of one parametric test, in item order —
// the lot's drift view. Pure math, no DOM.
//
// Distinct from boxplot.ts, which answers "how is this test distributed within
// each wafer": a boxplot's rows are read individually, and its own panel sorts
// and drills them. This answers "is the test moving across the lot", which only
// reads correctly in the population's own order (slot order) with a stable
// reference to judge the movement against. The two are different questions over
// the same values, which is why this is a second builder rather than a mode of
// the first.
//
// Follows the same precomputed-first pattern as boxplot.ts: `analyzeWaferMap`
// already computed mean/stddev/count per test per wafer, so a raw die scan is
// the fallback, not the default.

import type { Die } from '../core/dies.js';
import { isYieldEligibleDie } from '../core/dies.js';

export interface TrendDatum {
  label: string;
  /** Mean of this item's values for the test. NaN when `count` is 0. */
  mean: number;
  /** Sample stddev (ddof=1). 0 when fewer than 2 values. */
  stddev: number;
  count: number;
  /** Caller-supplied identity (e.g. `waferIndex`), for click-to-open. */
  key?: number;
}

export interface TrendItem {
  label?: string;
  key?: number;
  dies?: Die[];
  /** See `BoxplotItem.testStats` — `StatsSummary.stats.perTestStats`. */
  testStats?: Array<{ testNumber: number; mean: number; stddev: number; count: number }>;
}

/**
 * One point per item, in the order given — never sorted. Slot order is the whole
 * point: a drift or a bad cassette position is only visible when the x axis is
 * the physical sequence, and sorting by value destroys exactly the signal this
 * chart exists to show.
 *
 * Items with no values for the test get `count: 0` and are kept in place rather
 * than dropped, so the gap in the sequence stays visible.
 */
export function buildTestTrendData(items: TrendItem[], testNumber: number): TrendDatum[] {
  return items.map((item, i) => {
    const label = item.label ?? `#${i}`;
    const precomputed = item.testStats?.find(t => t.testNumber === testNumber);
    if (precomputed) {
      const { mean, stddev, count } = precomputed;
      return { label, mean, stddev, count, key: item.key };
    }

    const values = (item.dies ?? [])
      .filter(d => isYieldEligibleDie(d))
      .map(d => d.testValues?.[testNumber])
      .filter((v): v is number => v !== undefined && Number.isFinite(v));
    if (values.length === 0) return { label, mean: NaN, stddev: 0, count: 0, key: item.key };

    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const variance = values.length > 1
      ? values.reduce((a, v) => a + (v - mean) ** 2, 0) / (values.length - 1)
      : 0;
    return { label, mean, stddev: Math.sqrt(variance), count: values.length, key: item.key };
  });
}

/**
 * Population mean across every item that has data — n-weighted, so it is the
 * mean of the pooled dies rather than a mean of per-wafer means. Used as the
 * chart's centre line; returns null when nothing has data.
 */
export function trendCentre(data: TrendDatum[]): number | null {
  let n = 0, sum = 0;
  for (const d of data) {
    if (!d.count || !Number.isFinite(d.mean)) continue;
    n += d.count;
    sum += d.mean * d.count;
  }
  return n === 0 ? null : sum / n;
}
