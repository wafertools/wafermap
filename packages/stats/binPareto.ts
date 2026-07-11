// Bin distribution (pareto) and clustered-by-group bin bars — generalized
// from tsmap's own charts/aggregate.ts. Pure math, no DOM.

import type { Die } from '../core/dies.js';
import { isYieldEligibleDie } from '../core/dies.js';
import type { ChartDatum } from './yield.js';

export type BinType = 'hbin' | 'sbin';

export interface BinItem {
  dies?: Die[];
}

/**
 * One bar per bin, across all `items`, sorted by count descending. Excludes
 * partial/edge-excluded dies via `isYieldEligibleDie` — the same population
 * the adjacent Yield panel uses — so the two panels' totals reconcile for
 * the same wafer/group.
 */
export function buildBinParetoData(items: BinItem[], binType: BinType): ChartDatum[] {
  const counts = new Map<number, number>();
  let totalDies = 0;
  for (const item of items) {
    for (const die of item.dies ?? []) {
      if (!isYieldEligibleDie(die)) continue;
      const bin = binType === 'hbin' ? die.hbin : die.sbin;
      if (bin === undefined) continue;
      totalDies++;
      counts.set(bin, (counts.get(bin) ?? 0) + 1);
    }
  }
  const data: ChartDatum[] = Array.from(counts.entries()).map(([bin, count]) => ({
    label: `${binType === 'hbin' ? 'HBin' : 'SBin'} ${bin}`,
    value: count,
    percent: totalDies > 0 ? (count / totalDies) * 100 : 0,
    itemCount: 1,
    binCode: bin,
  }));
  data.sort((a, b) => b.value - a.value);
  return data;
}

/** One bin's clustered bars: a count per group (aligned to `BinClusterData.groups`). */
export interface BinCluster {
  binCode: number;
  label: string;
  /** Total dies of this bin across all groups — drives pareto ordering. */
  total: number;
  /** Per-group die counts for this bin, aligned to `BinClusterData.groups`. */
  counts: number[];
}

/** Clustered bin pareto: the group list (legend order) plus one cluster per bin. */
export interface BinClusterData {
  groups: string[];
  bins: BinCluster[];
}

/**
 * Clustered bin pareto: every group's bin counts side by side, so groups
 * compare directly bin-by-bin. Unlike the plain pareto, this is never a
 * restrict-to-one-group view — all groups are always shown at once,
 * matching tsmap's actual behavior (a wholly different panel swapped in for
 * bin pareto when grouping is active, not a variant of it).
 */
export function buildBinClusterData(groups: { key: string; items: BinItem[] }[], binType: BinType): BinClusterData {
  const groupOrder = groups.map(g => g.key);
  const bins = new Map<number, { total: number; counts: number[] }>();
  const binOrder: number[] = [];

  groups.forEach((g, gi) => {
    for (const item of g.items) {
      for (const die of item.dies ?? []) {
        if (!isYieldEligibleDie(die)) continue;
        const bin = binType === 'hbin' ? die.hbin : die.sbin;
        if (bin === undefined) continue;
        let b = bins.get(bin);
        if (!b) { b = { total: 0, counts: [] }; bins.set(bin, b); binOrder.push(bin); }
        b.total++;
        b.counts[gi] = (b.counts[gi] ?? 0) + 1;
      }
    }
  });

  const sortedBins = binOrder.slice().sort((a, b) => bins.get(b)!.total - bins.get(a)!.total);
  const clusterBins: BinCluster[] = sortedBins.map(bin => {
    const b = bins.get(bin)!;
    return {
      binCode: bin,
      label: `${binType === 'hbin' ? 'HBin' : 'SBin'} ${bin}`,
      total: b.total,
      counts: groupOrder.map((_, gi) => b.counts[gi] ?? 0),
    };
  });

  return { groups: groupOrder, bins: clusterBins };
}
