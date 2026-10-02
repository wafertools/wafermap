// Yield rows read against their reference: each wafer against the lot's median, each region against
// the yield of the wafer or lot it divides. One place computes the reference and the shortfall, so
// the report's tables and the Summary panel's rows cannot disagree about which wafer is a point
// low, or about what "the lot" was when it was measured.

import { medianOfSorted } from '../core/utils.js';
import type { RegionYieldDatum } from './regions.js';
import { shortfallStep } from './presentation.js';
import { outlierWafers } from './analyzeWaferLot.js';

/** A row with its signed difference from the reference, in yield points, and how strongly to tint it. */
export type ReadAgainst<T> = T & { delta: number; step: 0 | 1 | 2 | 3 };

/** A wafer row also says whether the lot's outlier rule calls it one, and on which side. */
export type WaferRead<T> = ReadAgainst<T> & { outlier?: 'low' | 'high' };

/**
 * Wafers against the median of the wafers' own yields; `median` is that reference. A wafer is an
 * outlier by `outlierWafers`, the rule the lot's findings use, so a wafer a table calls an outlier is
 * one the findings name, and the other way round. It is said in words ("low outlier"), never by tint
 * alone: the tint follows the size of the shortfall, the word follows the statistics.
 */
export function waferYieldRows<T extends { yieldPercent: number }>(wafers: readonly T[]): { rows: WaferRead<T>[]; median: number } {
  const yields = wafers.map((w) => w.yieldPercent);
  const sorted = [...yields].sort((a, b) => a - b);
  const median = sorted.length === 0 ? 0 : medianOfSorted(sorted);
  const outliers = new Set(outlierWafers(yields)?.outliers.map((o) => o.index));
  return {
    median,
    rows: wafers.map((w, i) => ({
      ...w,
      delta: w.yieldPercent - median,
      step: shortfallStep(w.yieldPercent - median),
      ...(outliers.has(i) ? { outlier: w.yieldPercent < median ? 'low' as const : 'high' as const } : {}),
    })),
  };
}

/**
 * Regions against the yield of everything they divide. Rings, or quadrants, partition the wafer (or
 * the lot's wafers), so their dies sum to it and `overall` is its yield, die-weighted.
 */
export function regionYieldRows(data: readonly RegionYieldDatum[]): { rows: ReadAgainst<RegionYieldDatum>[]; overall: number } {
  const total = data.reduce((n, d) => n + d.n, 0);
  const overall = total === 0 ? 0 : (data.reduce((n, d) => n + d.passDies, 0) / total) * 100;
  return {
    overall,
    rows: data.map((d) => ({ ...d, delta: d.yieldPercent - overall, step: shortfallStep(d.yieldPercent - overall) })),
  };
}
