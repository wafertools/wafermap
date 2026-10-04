// The two small pure steps between a population and a plot, kept apart from the chart and the editor so the
// drilldown menu can use them without downloading either.

import type { Die } from '../core/dies.js';
import type { Wafer } from '../core/wafer.js';
import type { TestDef } from '../renderer/buildWaferMap.js';
import type { PlotItem, PlotPoint } from '../stats/plotData.js';
import type { DrilldownSource } from './chartPopulation.js';

/** What a population hands over for each wafer: a drilldown source's items, or the Insights tab's. */
export interface WaferShare {
  label: string;
  dies: Die[];
  waferIndex?: number;
  wafer?: Wafer;
  passBins?: readonly number[];
}

export function toPlotItems(items: readonly WaferShare[]): PlotItem[] {
  return items.map(it => ({
    label: it.label, dies: it.dies, waferIndex: it.waferIndex, wafer: it.wafer, passBins: it.passBins,
    metadata: it.wafer?.metadata,
  }));
}

/**
 * The dies a drag on a plot picked out, per wafer, as a drilldown population: charts and tables of just these.
 * `null` when the drag caught no die (a wafer-level plot has none to pick).
 */
export function sourceFromPoints(
  points: readonly PlotPoint[], items: readonly PlotItem[], testDefs: readonly TestDef[] | undefined,
): DrilldownSource | null {
  // A mark that is one die picks that die; a mark that is a wafer (one point per wafer, a bar of wafers) picks the wafer's
  // dies. Either way the population is dies, per wafer, so the same charts and tables open on it.
  const byWafer = new Map<number, Die[] | 'all'>();
  for (const p of points) {
    const have = byWafer.get(p.item);
    if (!p.die) { byWafer.set(p.item, 'all'); continue; }
    if (have === 'all') continue;
    if (have) have.push(p.die); else byWafer.set(p.item, [p.die]);
  }
  const picked = [...byWafer].map(([i, dies]) => ({ label: items[i].label, dies: dies === 'all' ? [...items[i].dies] : dies, waferIndex: items[i].waferIndex, wafer: items[i].wafer, passBins: items[i].passBins }));
  if (picked.length === 0) return null;
  const population = picked.length === 1 ? `selected on ${picked[0].label} in the plot` : `selected in the plot, across ${picked.length} wafers`;
  return { items: picked, population, testDefs: testDefs ? [...testDefs] : undefined };
}
