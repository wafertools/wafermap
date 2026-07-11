// Per-item (typically per-wafer) five-number summary for one parametric test
// — generalized from tsmap's own charts/aggregate.ts. Pure math, no DOM.
//
// Unlike tsmap's original version, there is no separate "combined" variant
// that pools multiple wafers into one row per group: wmap's Analysis tab
// handles grouping by rendering one independent panel instance per group
// (see canvas-adapter/renderWaferGallery.ts), so a single boxplot builder
// that takes "whatever population of items the tab currently has selected"
// covers both the ungrouped and grouped cases without a second code path.

import type { Die } from '../core/dies.js';
import { quantile } from './math.js';

export interface BoxplotDatum {
  label: string;
  min: number;
  q1: number;
  median: number;
  q3: number;
  max: number;
  count: number;
}

export interface BoxplotItem {
  label?: string;
  dies?: Die[];
}

/** One row per item, for `testNumber`. Items with no valid values for that test get `count: 0`. */
export function buildTestBoxplotData(items: BoxplotItem[], testNumber: number): BoxplotDatum[] {
  return items.map((item, i) => {
    const values = (item.dies ?? [])
      .map(d => d.testValues?.[testNumber])
      .filter((v): v is number => v !== undefined && Number.isFinite(v))
      .sort((a, b) => a - b);
    const label = item.label ?? `#${i}`;
    if (values.length === 0) {
      return { label, min: NaN, q1: NaN, median: NaN, q3: NaN, max: NaN, count: 0 };
    }
    return {
      label,
      min: values[0],
      q1: quantile(values, 0.25),
      median: quantile(values, 0.5),
      q3: quantile(values, 0.75),
      max: values[values.length - 1],
      count: values.length,
    };
  });
}
