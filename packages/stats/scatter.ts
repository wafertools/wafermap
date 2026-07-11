// Die-level X/Y scatter points for two parametric tests — generalized from
// tsmap's own charts/aggregate.ts. Pure math, no DOM.

import type { Die } from '../core/dies.js';

export interface ScatterPoint {
  x: number;
  y: number;
  hbin: number | undefined;
  /** Facet group this point belongs to — set only by the grouped builder. */
  group?: string;
}

export interface ScatterItem {
  dies?: Die[];
}

function scatterPointsForDies(dies: Die[] | undefined, xTest: number, yTest: number, group: string | undefined, out: ScatterPoint[]): void {
  for (const die of dies ?? []) {
    const x = die.testValues?.[xTest];
    const y = die.testValues?.[yTest];
    if (x !== undefined && y !== undefined && Number.isFinite(x) && Number.isFinite(y)) {
      out.push(group === undefined ? { x, y, hbin: die.hbin } : { x, y, hbin: die.hbin, group });
    }
  }
}

/** One point per die with valid values for both tests, across `items`. */
export function buildScatterData(items: ScatterItem[], xTest: number, yTest: number): ScatterPoint[] {
  const points: ScatterPoint[] = [];
  for (const item of items) scatterPointsForDies(item.dies, xTest, yTest, undefined, points);
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
    for (const item of g.items) scatterPointsForDies(item.dies, xTest, yTest, g.key, points);
  }
  return points;
}
