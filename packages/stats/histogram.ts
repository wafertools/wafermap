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
// version — same result, one fewer indirection (see WMAP_ISSUES.md).

import type { Die } from '../core/dies.js';

export interface HistogramBucket {
  rangeLow: number;
  rangeHigh: number;
  count: number;
}

export interface HistogramItem {
  label?: string;
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
export function buildTestHistogramData(
  items: HistogramItem[], testNumber: number, bucketCount = 16,
  limitLow?: number, limitHigh?: number,
): HistogramBucket[] {
  const values: number[] = [];
  for (const item of items) {
    for (const die of item.dies ?? []) {
      const v = die.testValues?.[testNumber];
      if (v !== undefined && Number.isFinite(v)) values.push(v);
    }
  }
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

  for (const v of values) {
    const index = Math.min(bucketCount - 1, Math.floor((v - min) / width));
    buckets[index].count++;
  }
  return buckets;
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
): HistogramSeriesData {
  const byGroup = new Map<string, number[]>();
  let dataMin = Infinity, dataMax = -Infinity;
  for (const g of groups) {
    const vals: number[] = [];
    for (const item of g.items) {
      for (const die of item.dies ?? []) {
        const v = die.testValues?.[testNumber];
        if (v !== undefined && Number.isFinite(v)) {
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

  const series = nonEmpty.map(groupKey => {
    const counts = new Array(bucketCount).fill(0);
    for (const v of byGroup.get(groupKey)!) {
      const index = Math.min(bucketCount - 1, Math.floor((v - min) / width));
      counts[index]++;
    }
    return { groupKey, counts };
  });

  return { ranges, series };
}
