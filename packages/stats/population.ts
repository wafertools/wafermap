// How to name a set of wafers shown or analysed together.
//
// "Lot" is a physical fact — a batch of wafers processed together, identified by
// a lot ID — but a gallery or an `analyzeWaferLot` call is just "the wafers you
// passed", which can span several lots or carry no lot ID at all. Labels that
// said "Lot Summary" or "lower than the lot median" over such a set told an
// engineer they were looking at one lot when they were not: exactly the
// population misreading CLAUDE.md's display rules forbid.
//
// The rule, in one place: say "lot" only when EVERY wafer records the same lot
// ID. Otherwise name the wafers, and how many lots they came from when known.

export interface WaferPopulation {
  waferCount: number;
  /** The lot ID every wafer records, when they all record the same one. */
  lotId?: string;
  /** Distinct lot IDs recorded across the wafers — 0 when none records one. */
  lotCount: number;
}

type Metadata = Record<string, unknown> | null | undefined;

/** A wafer's lot ID, read the way every report reads it (`lot`, else `lotId`). */
function lotIdOf(meta: Metadata): string | undefined {
  const v = meta?.['lot'] ?? meta?.['lotId'];
  return v === undefined || v === null || v === '' ? undefined : String(v);
}

/** One entry per wafer — its `wafer.metadata` (or a summary's `wafer` identity). */
export function describeWaferPopulation(metadatas: readonly Metadata[]): WaferPopulation {
  const ids = metadatas.map(lotIdOf);
  const distinct = new Set(ids.filter((id): id is string => id !== undefined));
  // A wafer with no lot ID is not evidence it shares the others' lot.
  const oneLot = distinct.size === 1 && ids.every(id => id !== undefined);
  return {
    waferCount: metadatas.length,
    lotCount: distinct.size,
    ...(oneLot ? { lotId: [...distinct][0] } : {}),
  };
}

const wafersText = (n: number) => `${n} wafer${n === 1 ? '' : 's'}`;

/**
 * What the set is, for a title: "Lot LOT123 · 13 wafers", "26 wafers from
 * 2 lots", or "13 wafers" (no lot ID recorded).
 */
export function populationLabel(p: WaferPopulation): string {
  if (p.lotId !== undefined) return `Lot ${p.lotId} · ${wafersText(p.waferCount)}`;
  return p.lotCount > 1 ? `${wafersText(p.waferCount)} from ${p.lotCount} lots` : wafersText(p.waferCount);
}

/**
 * A statistic taken across the set, as a noun phrase: "lot median" for one
 * lot, otherwise "median of all wafers". Reads correctly after "the" and
 * "vs".
 */
export function populationStat(p: WaferPopulation, stat: 'mean' | 'median'): string {
  return p.lotId !== undefined ? `lot ${stat}` : `${stat} of all wafers`;
}
