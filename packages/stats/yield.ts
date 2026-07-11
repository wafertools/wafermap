// Per-wafer / per-group yield bars — generalized from tsmap's own
// charts/aggregate.ts. Pure math, no DOM.
//
// Yield is preferentially read from a precomputed `yieldPercent` on each
// item — e.g. `analyzeWaferLot`'s `lotYieldSeries`, which a host (tsmap)
// commonly already has, computed through the exact same `buildWaferMap`
// pipeline this package's own yield summary uses. Reusing it, rather than
// recomputing from `dies`, guarantees this panel is byte-identical to
// whatever else in the app already reports yield for the same wafer — not
// just "close" from an independently-written second implementation (a real
// mismatch of up to ~1.3 percentage points was found this way: the earlier
// version of this file recomputed yield from `dies` without excluding
// partial/edge-excluded dies, disagreeing with `buildWaferMap`'s own
// convention). Falls back to computing from `dies` (via the same
// `isYieldEligibleDie` rule `buildWaferMap`/`analyzeWaferMap` use) only
// when no precomputed value is supplied.

import type { Die } from '../core/dies.js';
import { isYieldEligibleDie } from '../core/dies.js';

/** Shared row shape for every bar-chart panel (yield, bin pareto, ...). */
export interface ChartDatum {
  label: string;
  value: number;
  percent: number;
  /** Number of items (wafers) pooled into this row — >1 marks a drillable group row. */
  itemCount: number;
  /** Bin code this datum represents — only set for bin-pareto data. */
  binCode?: number;
}

export interface YieldItem {
  label?: string;
  dies?: Die[];
  /**
   * Precomputed yield percent for this item (e.g. from `analyzeWaferLot`'s
   * `lotYieldSeries[waferIndex].yieldPercent`) — used directly when present.
   * Omit to have it computed from `dies` instead.
   */
  yieldPercent?: number | null;
}

export type YieldSortBy = 'yield' | 'label';

/** Fallback only — used when an item doesn't carry a precomputed `yieldPercent`. */
function yieldPercentFromDies(dies: Die[], passBins: number[]): number {
  let pass = 0, total = 0;
  for (const d of dies) {
    if (!isYieldEligibleDie(d)) continue;
    const bin = d.hbin ?? d.sbin;
    if (bin === undefined) continue;
    total++;
    if (passBins.includes(bin)) pass++;
  }
  return total > 0 ? (pass / total) * 100 : 0;
}

function resolveYieldPercent(item: YieldItem, passBins: number[]): number {
  if (item.yieldPercent !== undefined) return item.yieldPercent ?? 0;
  return yieldPercentFromDies(item.dies ?? [], passBins);
}

function sortYieldData(data: ChartDatum[], sortBy: YieldSortBy): void {
  if (sortBy === 'yield') data.sort((a, b) => b.value - a.value);
  else data.sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));
}

/** One bar per item. */
export function buildYieldData(items: YieldItem[], passBins: number[] = [1], sortBy: YieldSortBy = 'label'): ChartDatum[] {
  const data = items.map((it, i) => {
    const pct = resolveYieldPercent(it, passBins);
    return { label: it.label ?? `#${i}`, value: pct, percent: pct, itemCount: 1 };
  });
  sortYieldData(data, sortBy);
  return data;
}

/**
 * Combined yield: one bar per group, pooling the group's items. The pooled
 * yield is the die-count-weighted mean of per-item yields — exact for the
 * standard pass/total definition (Σ pass / Σ total = Σ(yield·dies)/Σ dies).
 * Weighting uses each item's raw die count (`dies.length`), matching
 * tsmap's own `buildYieldDataCombined` — an item's precomputed
 * `yieldPercent` (if supplied) is used as the per-item rate being weighted.
 */
export function buildYieldDataCombined(groups: { key: string; items: YieldItem[] }[], passBins: number[] = [1], sortBy: YieldSortBy = 'label'): ChartDatum[] {
  const data = groups.map(g => {
    let weighted = 0, dieCount = 0;
    for (const it of g.items) {
      const dies = it.dies?.length ?? 0;
      weighted += resolveYieldPercent(it, passBins) * dies;
      dieCount += dies;
    }
    const pct = dieCount > 0 ? weighted / dieCount : 0;
    return { label: g.key, value: pct, percent: pct, itemCount: g.items.length };
  });
  sortYieldData(data, sortBy);
  return data;
}
