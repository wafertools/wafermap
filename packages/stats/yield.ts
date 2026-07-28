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
import { compareNatural } from '../core/utils.js';

/** Shared row shape for every bar-chart panel (yield, bin pareto, ...). */
export interface ChartDatum {
  label: string;
  value: number;
  percent: number;
  /** Number of items (wafers) pooled into this row — >1 marks a drillable group row. */
  itemCount: number;
  /** Bin code this datum represents — only set for bin-pareto data. */
  binCode?: number;
  /**
   * Stable identity for a leaf row (`itemCount === 1`), independent of
   * `label` — a caller with an `onOpen` callback should resolve back to its
   * own item by `key`, not by re-searching for `label`. Labels are only
   * guaranteed unique when the caller supplies one per item; an item with no
   * `label` falls back to a shared default elsewhere (e.g. `analysisTab.ts`
   * falls back to `''` when both `label` and `wafer.metadata.waferId` are
   * absent), so two rows can carry an identical, ambiguous label — matching
   * on it would silently resolve to the wrong item. Absent on group rows
   * (`itemCount > 1`), which are drilled into rather than opened directly.
   */
  key?: string | number;
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
  /** Carried through to the resulting `ChartDatum.key` unchanged — see its doc comment. */
  key?: string | number;
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

/** Count of dies a yield percentage was actually computed over — excludes
 *  partial/edge-excluded dies, matching `isYieldEligibleDie` (the same rule
 *  `buildWaferMap`/`yieldPercentFromDies` use). Using raw `dies.length`
 *  instead would weight a wafer by dies that never counted toward its own
 *  yield (e.g. a heavily edge-excluded wafer), skewing a combined/grouped
 *  average even though those dies are invisible everywhere else. */
function yieldEligibleDieCount(dies: Die[]): number {
  let n = 0;
  for (const d of dies) if (isYieldEligibleDie(d)) n++;
  return n;
}

function sortYieldData(data: ChartDatum[], sortBy: YieldSortBy): void {
  if (sortBy === 'yield') data.sort((a, b) => b.value - a.value);
  else data.sort((a, b) => compareNatural(a.label, b.label));
}

/** One bar per item. */
export function buildYieldData(items: YieldItem[], passBins: number[] = [1], sortBy: YieldSortBy = 'label'): ChartDatum[] {
  const data = items.map((it, i) => {
    const pct = resolveYieldPercent(it, passBins);
    return { label: it.label ?? `#${i}`, value: pct, percent: pct, itemCount: 1, key: it.key };
  });
  sortYieldData(data, sortBy);
  return data;
}

/**
 * Combined yield: one bar per group, pooling the group's items. The pooled
 * yield is the yield-eligible-die-count-weighted mean of per-item yields —
 * exact for the standard pass/total definition (Σ pass / Σ total =
 * Σ(yield·dies)/Σ dies), *provided* `dies` is the same population the rate
 * was computed over. Weighting uses `yieldEligibleDieCount` (excludes
 * partial/edge-excluded dies), not raw `dies.length` — a per-item
 * `yieldPercent` (own or precomputed, e.g. from `analyzeWaferLot`) already
 * excludes those dies from its own numerator/denominator (`resolveYieldPercent`
 * → `isYieldEligibleDie`), so weighting by the raw count would let a wafer's
 * excluded dies (which count toward yield nowhere else) still skew this
 * combined bar.
 */
export function buildYieldDataCombined(groups: { key: string; items: YieldItem[] }[], passBins: number[] = [1], sortBy: YieldSortBy = 'label'): ChartDatum[] {
  const data = groups.map(g => {
    let weighted = 0, dieCount = 0;
    for (const it of g.items) {
      const dies = yieldEligibleDieCount(it.dies ?? []);
      weighted += resolveYieldPercent(it, passBins) * dies;
      dieCount += dies;
    }
    const pct = dieCount > 0 ? weighted / dieCount : 0;
    return { label: g.key, value: pct, percent: pct, itemCount: g.items.length };
  });
  sortYieldData(data, sortBy);
  return data;
}
