// The bin breakdown as rows: how many dies carry each bin, in the shared display order, with the
// name, share and pass verdict a surface needs. The Summary panel draws these as bars in the map's
// bin colours and the reports as table rows; the counting, the order, the label and the title are
// decided here once, so the two cannot count a different population or order the bins differently.

import type { Die } from '../core/dies.js';
import type { BinDef } from '../renderer/buildWaferMap.js';
import { sortBinsForDisplay } from './binPareto.js';

export type BinMode = 'hard' | 'soft';

type Counts = Readonly<Record<number, number>>;

/**
 * Dies per bin. `precomputed` (`StatsSummary.stats.hardBinCounts`/`softBinCounts`, already scoped to the
 * yield-eligible population) is used directly when supplied; otherwise the dies are walked, skipping
 * partial and edge-excluded ones, the same population the yield uses.
 */
export function binCountsFrom(dies: Iterable<Die>, mode: BinMode, precomputed?: Counts): Map<number, number> {
  const counts = new Map<number, number>();
  if (precomputed) {
    for (const [bin, count] of Object.entries(precomputed)) counts.set(Number(bin), count);
    return counts;
  }
  for (const d of dies) {
    if (d.partial || d.edgeExcluded) continue;
    const bin = mode === 'hard' ? d.hbin : d.sbin;
    if (bin != null) counts.set(bin, (counts.get(bin) ?? 0) + 1);
  }
  return counts;
}

/** The same for several wafers: each wafer's own counts summed when every one has them, the pooled dies walked otherwise. */
export function pooledBinCounts(
  summaries: ReadonlyArray<{ stats: { hardBinCounts?: Counts; softBinCounts?: Counts } }> | undefined,
  dies: Iterable<Die>,
  mode: BinMode,
): Map<number, number> {
  const field = mode === 'hard' ? 'hardBinCounts' as const : 'softBinCounts' as const;
  if (summaries?.length && summaries.every((s) => s.stats[field] !== undefined)) {
    const counts = new Map<number, number>();
    for (const s of summaries) {
      for (const [bin, count] of Object.entries(s.stats[field]!)) counts.set(Number(bin), (counts.get(Number(bin)) ?? 0) + count);
    }
    return counts;
  }
  return binCountsFrom(dies, mode);
}

export interface BinRow {
  bin: number;
  /** The definition's name, when there is one. */
  name?: string;
  /** `Bin 5 · IDDQ`, or `Bin 5` without a name. */
  label: string;
  count: number;
  /** Share of the dies counted, 0–100. */
  percent: number;
  /** Whether this bin passes: pass bins come first, in grey. */
  passing: boolean;
}

/** One row per bin in the shared display order: pass bins first, then fail bins by descending count. */
export function binBreakdownRows(
  counts: ReadonlyMap<number, number>,
  defs: readonly BinDef[] | undefined,
  /** Bins of THIS type that pass — `BinColors.pass.hard`/`.soft`, never `passBins` for soft bins. */
  passing: Iterable<number>,
): BinRow[] {
  const passSet = new Set(passing);
  const total = [...counts.values()].reduce((a, b) => a + b, 0);
  const names = defs ? new Map(defs.map((d) => [d.bin, d.name])) : undefined;
  return sortBinsForDisplay(counts.entries(), passSet).map(([bin, count]) => {
    const name = names?.get(bin);
    return { bin, ...(name ? { name } : {}), label: name ? `Bin ${bin} · ${name}` : `Bin ${bin}`, count, percent: total ? (count / total) * 100 : 0, passing: passSet.has(bin) };
  });
}

/** The title carries the population, so the percentages below are never a bare number: they are % of dies, not a mean of wafers. */
export const binBreakdownTitle = (mode: BinMode, total: number): string =>
  `${mode === 'hard' ? 'Hard' : 'Soft'} Bin Breakdown — % of dies (N=${total.toLocaleString('en-GB')})`;

export const totalOf = (counts: ReadonlyMap<number, number>): number => [...counts.values()].reduce((a, b) => a + b, 0);
