// The two small pure steps between a population and a plot, kept apart from the chart and the editor so the
// drilldown menu can use them without downloading either.

import type { Die } from '../core/dies.js';
import type { Wafer } from '../core/wafer.js';
import type { TestDef } from '../renderer/buildWaferMap.js';
import type { PlotItem, PlotPoint } from '../stats/plotData.js';
import { LOT_STACK_REASON, type DrilldownSource } from './chartPopulation.js';

/** What a population hands over for each wafer: a drilldown source's items, or the Insights tab's. */
export interface WaferShare {
  label: string;
  dies: readonly Die[];
  waferIndex?: number;
  wafer?: Wafer;
  passBins: readonly number[];
  ringCount: number;
}

export function toPlotItems(items: readonly WaferShare[]): PlotItem[] {
  return items.map(it => ({
    label: it.label, dies: it.dies, waferIndex: it.waferIndex, wafer: it.wafer, passBins: it.passBins, ringCount: it.ringCount,
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
  const picked = [...byWafer].map(([i, dies]) => ({ label: items[i].label, dies: dies === 'all' ? [...items[i].dies] : dies, waferIndex: items[i].waferIndex, wafer: items[i].wafer, passBins: items[i].passBins, ringCount: items[i].ringCount }));
  if (picked.length === 0) return null;
  const population = picked.length === 1 ? `selected on ${picked[0].label} in the plot` : `selected in the plot, across ${picked.length} wafers`;
  return { items: picked, population, testDefs: testDefs ? [...testDefs] : undefined };
}

/**
 * The dies of each wafer that satisfy `keep`, as a drilldown population worded "`what` on W03" or "`what`, across N
 * wafers". `null` when none does. Per wafer, so the tables name each die's wafer and a chart opened on it is of
 * exactly those dies.
 */
export function sourceFromDies(
  shares: readonly WaferShare[], what: string, keep: (d: Die) => boolean,
  testDefs: readonly TestDef[] | undefined, activeTest?: number,
): DrilldownSource | null {
  const picked = shares
    .map(it => ({ it, dies: it.dies.filter(keep) }))
    .filter(x => x.dies.length > 0)
    .map(({ it, dies }) => ({ label: it.label, dies, waferIndex: it.waferIndex, wafer: it.wafer, passBins: it.passBins, ringCount: it.ringCount }));
  if (picked.length === 0) return null;
  const population = picked.length === 1 ? `${what} on ${picked[0].label}` : `${what}, across ${picked.length} wafers`;
  return { items: picked, population, testDefs: testDefs ? [...testDefs] : undefined, activeTest };
}

/**
 * The dies in `bins` (hard or soft), per wafer, for a legend entry's right-click: the same population a bin pareto bar
 * opens. `null` when no die is in them. A stack of a lot holds aggregates, not dies, so it is named as not measured.
 */
export function sourceFromBins(
  shares: readonly WaferShare[], kind: 'hard' | 'soft', bins: readonly number[],
  testDefs: readonly TestDef[] | undefined, activeTest?: number, stacked = false,
): DrilldownSource | null {
  const wanted = new Set(bins);
  const what = `in ${kind} bin${bins.length === 1 ? '' : 's'} ${bins.join(', ')}`;
  const source = sourceFromDies(shares, what, d => { const b = kind === 'hard' ? d.hbin : d.sbin; return b !== undefined && wanted.has(b); }, testDefs, activeTest);
  if (source && stacked) source.notMeasuredReason = LOT_STACK_REASON;
  return source;
}
