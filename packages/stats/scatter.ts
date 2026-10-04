// Die-level X/Y scatter points for two parametric tests — generalized from
// tsmap's own charts/aggregate.ts. Pure math, no DOM.
//
// Deliberate exception to the "prefer StatsSummary.stats.perTestStats over
// raw Die[]" dedup pattern used elsewhere in this package (same reasoning as
// correlation.ts): a scatter point is one die's paired (x, y) values across
// two tests, which per-test marginal summaries cannot provide. Always reads
// raw `Die[]`.

import type { Die } from '../core/dies.js';
import { testValue } from '../core/dieTable.js';

export interface ScatterPoint {
  x: number;
  y: number;
  hbin: number | undefined;
  /** Facet group this point belongs to — set only by the grouped builder. */
  group?: string;
  /** The die this point is, so a point can name it and its wafer. */
  die?: Die;
  /** The wafer the die is on — the item's `waferIndex`, when it has one. */
  waferIndex?: number;
}

export interface ScatterItem {
  dies?: Die[];
  /** Carried onto each point, so a click on a point can open its wafer. */
  waferIndex?: number;
}

function scatterPointsForDies(item: ScatterItem, xTest: number, yTest: number, group: string | undefined, out: ScatterPoint[]): void {
  const waferIndex = item.waferIndex;
  for (const die of item.dies ?? []) {
    const x = testValue(die, xTest);
    const y = testValue(die, yTest);
    if (x !== undefined && y !== undefined && Number.isFinite(x) && Number.isFinite(y)) {
      const point: ScatterPoint = { x, y, hbin: die.hbin, die };
      if (waferIndex !== undefined) point.waferIndex = waferIndex;
      if (group !== undefined) point.group = group;
      out.push(point);
    }
  }
}

/** One point per die with valid values for both tests, across `items`. */
export function buildScatterData(items: ScatterItem[], xTest: number, yTest: number): ScatterPoint[] {
  const points: ScatterPoint[] = [];
  for (const item of items) scatterPointsForDies(item, xTest, yTest, undefined, points);
  return points;
}

/**
 * Scatter points tagged with their facet group, for colour-by-group scatter
 * (group replaces hard-bin colour). Unlike capability/boxplot's `groups`
 * (which restrict to one group at a time), every group's points are
 * returned together here — scatter never restricts, it colours.
 */
export function buildScatterDataGrouped(groups: { key: string; items: ScatterItem[] }[], xTest: number, yTest: number): ScatterPoint[] {
  const points: ScatterPoint[] = [];
  for (const g of groups) {
    for (const item of g.items) scatterPointsForDies(item, xTest, yTest, g.key, points);
  }
  return points;
}
