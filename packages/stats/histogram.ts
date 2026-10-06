// Bucketed value distribution for one parametric test — generalized from
// tsmap's own charts/aggregate.ts. Pure math, no DOM.
//
// Two builders, mirroring tsmap's own split: `buildTestHistogramData` is the
// single-population view (used ungrouped, or restricted to one item), and
// `buildTestHistogramSeries` is the *faceted* view — one count-series per
// group over a shared set of bucket ranges, so the series overlay and
// compare directly on one axis. Unlike boxplot/capability, wmap's Analysis
// tab hands this one the `groups` list directly (it already computes it),
// rather than a `groupBy` callback over a flat wafer list like tsmap's
// version — same result, one fewer indirection.
//
// Deliberate exception to the "prefer StatsSummary.stats.perTestStats over
// raw Die[]" dedup pattern used elsewhere in this package (boxplot.ts,
// capability.ts's mean/stddev, binPareto.ts, summaryPanel.ts, etc.):
// bucket assignment needs every individual value (`Math.floor((v - min) /
// bucketWidth)`), which a five-number-summary/mean/stddev cannot
// reconstruct. A histogram is exactly the shape of information
// `perTestStats` intentionally does not carry, so this module always reads
// raw `Die[]` and always will.

import type { Die } from '../core/dies.js';
import { testValue } from '../core/dieTable.js';

export interface HistogramBucket {
  rangeLow: number;
  rangeHigh: number;
  count: number;
}

export interface HistogramItem {
  label?: string;
  /** The wafer this item is, when it is one (an Insights wafer index): lets a click on a bucket say which wafers its dies are on. */
  key?: number;
  dies?: Die[];
}

/** One overlaid series in a faceted histogram — per-group counts over the shared bucket ranges. */
export interface HistogramSeries {
  groupKey: string;
  /** Count per bucket, aligned to the shared `ranges` array. */
  counts: number[];
}

/** Faceted histogram: shared bucket ranges plus one count-series per group. */
export interface HistogramSeriesData {
  ranges: Array<{ rangeLow: number; rangeHigh: number }>;
  series: HistogramSeries[];
}

/**
 * Histogram of one test's values across `items`, divided into `bucketCount`
 * equal-width buckets. If `limitLow`/`limitHigh` are given, the axis range
 * is expanded to include them so limit lines always draw.
 */
/** Every finite recorded value for one test across `items`. Exported because a
 *  panel that wants to derive a robust fence needs the raw population, and
 *  re-walking dies in the chart layer would be a second copy of this loop. */
export function collectTestValues(items: HistogramItem[], testNumber: number): number[] {
  const values: number[] = [];
  for (const item of items) {
    for (const die of item.dies ?? []) {
      const v = testValue(die, testNumber);
      if (v !== undefined && Number.isFinite(v)) values.push(v);
    }
  }
  return values;
}

/**
 * Min/max of one test's values across `items`, without building an array of
 * them. Both are `NaN` when nothing was measured.
 *
 * A loop rather than `Math.min(...values)`: the spread passes every value as a
 * separate ARGUMENT, and a lot of 25 wafers × ~10k dies overflows the argument
 * limit and throws `RangeError: Maximum call stack size exceeded` — which in the
 * chart layer surfaces as the whole Insights rebuild dying, not as a bad number.
 */
export function testValueExtent(items: HistogramItem[], testNumber: number): { min: number; max: number } {
  let min = Infinity, max = -Infinity;
  for (const item of items) {
    for (const die of item.dies ?? []) {
      const v = testValue(die, testNumber);
      if (v !== undefined && Number.isFinite(v)) {
        if (v < min) min = v;
        if (v > max) max = v;
      }
    }
  }
  return min === Infinity ? { min: NaN, max: NaN } : { min, max };
}

export function buildTestHistogramData(
  items: HistogramItem[], testNumber: number, bucketCount = 16,
  limitLow?: number, limitHigh?: number,
  /**
   * Bound the bucket range and DROP values outside it. Unlike `limitLow`/
   * `limitHigh`, which only ever widen the range, this narrows it — for the
   * panel's "Clip outliers" axis control, where one wild reading otherwise
   * compresses every real bucket into the first column.
   *
   * Affects this chart only. No statistic anywhere is computed from a clipped
   * population: an out-of-spec die is a distribution outlier by construction, so
   * excluding it from yield or capability would delete real failures.
   */
  clip?: { lo: number; hi: number },
): HistogramBucket[] {
  let values = collectTestValues(items, testNumber);
  if (clip) values = values.filter(v => v >= clip.lo && v <= clip.hi);
  if (values.length === 0) return [];

  let dataMin = values[0], dataMax = values[0];
  for (let i = 1; i < values.length; i++) {
    if (values[i] < dataMin) dataMin = values[i];
    if (values[i] > dataMax) dataMax = values[i];
  }
  const min = limitLow !== undefined ? Math.min(dataMin, limitLow) : dataMin;
  const max = limitHigh !== undefined ? Math.max(dataMax, limitHigh) : dataMax;
  const span = max - min || 1;
  const width = span / bucketCount;

  const buckets: HistogramBucket[] = Array.from({ length: bucketCount }, (_, i) => ({
    rangeLow: min + i * width,
    rangeHigh: min + (i + 1) * width,
    count: 0,
  }));

  const laid = bucketWidthOf(buckets);
  for (const v of values) buckets[bucketIndexOf(v, min, laid, bucketCount)].count++;
  return buckets;
}

/**
 * The width the buckets were laid out with, read back from them. Every count AND every pick of a bucket's dies bins with
 * this one number, so the dies a click selects are exactly the bar's count: recomputing the width from the span in one
 * place and from the bucket edges in another can differ by a rounding error, which moves a die on an edge to the next bar.
 */
export function bucketWidthOf(buckets: ReadonlyArray<{ rangeLow: number; rangeHigh: number }>): number {
  const n = buckets.length;
  return (buckets[n - 1].rangeHigh - buckets[0].rangeLow) / n || 1;
}

/** The bucket a value falls in: equal widths from `min`, the last bucket closed at the top. THE binning rule. */
export function bucketIndexOf(v: number, min: number, width: number, bucketCount: number): number {
  return Math.min(bucketCount - 1, Math.floor((v - min) / width));
}

/**
 * The dies behind one bucket of a histogram built by `buildTestHistogramData` over `items`, per item: every die whose
 * value lands in it by the same rule that counted it (so the dies a click picks out are exactly the bar's `count`).
 * Values outside the buckets' range, which a clipped axis dropped, are not in any bucket.
 */
export function diesInBucket(
  items: HistogramItem[], testNumber: number, buckets: ReadonlyArray<Pick<HistogramBucket, 'rangeLow' | 'rangeHigh'>>, index: number,
  /** The clip the buckets were built with, if any: values outside it were not counted, so they are not picked. */
  clip?: { lo: number; hi: number },
): Array<{ item: HistogramItem; dies: Die[] }> {
  if (buckets.length === 0 || index < 0 || index >= buckets.length) return [];
  const min = buckets[0].rangeLow;
  const max = buckets[buckets.length - 1].rangeHigh;
  const width = bucketWidthOf(buckets);
  const out: Array<{ item: HistogramItem; dies: Die[] }> = [];
  for (const item of items) {
    const dies: Die[] = [];
    for (const die of item.dies ?? []) {
      const v = testValue(die, testNumber);
      if (v === undefined || !Number.isFinite(v) || v < min || v > max) continue;
      if (clip && (v < clip.lo || v > clip.hi)) continue;
      if (bucketIndexOf(v, min, width, buckets.length) === index) dies.push(die);
    }
    if (dies.length) out.push({ item, dies });
  }
  return out;
}

/**
 * Faceted histogram: one count-series per group over a *shared* set of
 * buckets, so the series overlay and compare directly. The bucket range
 * spans every group's dies (and the limits when given) so all series align
 * on one axis. Groups are returned in the order given; empty groups (no
 * valid values for this test) are omitted.
 */
export function buildTestHistogramSeries(
  groups: { key: string; items: HistogramItem[] }[], testNumber: number,
  bucketCount = 16, limitLow?: number, limitHigh?: number,
  /**
   * Bound the bucket range and DROP values outside it — the faceted twin of
   * `buildTestHistogramData`'s own `clip`, with the same contract: it narrows
   * where the limits only widen, it is this chart's axis control and nothing
   * else, and no statistic anywhere is computed from a clipped population.
   *
   * It exists because the panel's "Clip outliers" checkbox was rendered in the
   * grouped view too and did nothing there — the series builder had no way to
   * take a clip range, so the control silently applied to one branch only.
   */
  clip?: { lo: number; hi: number },
): HistogramSeriesData {
  const byGroup = new Map<string, number[]>();
  let dataMin = Infinity, dataMax = -Infinity;
  for (const g of groups) {
    const vals: number[] = [];
    for (const item of g.items) {
      for (const die of item.dies ?? []) {
        const v = testValue(die, testNumber);
        if (v !== undefined && Number.isFinite(v)) {
          if (clip && (v < clip.lo || v > clip.hi)) continue;
          vals.push(v);
          if (v < dataMin) dataMin = v;
          if (v > dataMax) dataMax = v;
        }
      }
    }
    byGroup.set(g.key, vals);
  }
  const nonEmpty = groups.map(g => g.key).filter(k => byGroup.get(k)!.length > 0);
  if (nonEmpty.length === 0) return { ranges: [], series: [] };

  const min = limitLow !== undefined ? Math.min(dataMin, limitLow) : dataMin;
  const max = limitHigh !== undefined ? Math.max(dataMax, limitHigh) : dataMax;
  const span = max - min || 1;
  const width = span / bucketCount;

  const ranges = Array.from({ length: bucketCount }, (_, i) => ({
    rangeLow: min + i * width,
    rangeHigh: min + (i + 1) * width,
  }));

  const laid = bucketWidthOf(ranges);
  const series = nonEmpty.map(groupKey => {
    const counts = new Array(bucketCount).fill(0);
    for (const v of byGroup.get(groupKey)!) {
      counts[bucketIndexOf(v, min, laid, bucketCount)]++;
    }
    return { groupKey, counts };
  });

  return { ranges, series };
}
