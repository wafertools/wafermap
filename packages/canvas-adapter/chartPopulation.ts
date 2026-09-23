// The populations a drilldown chart can be opened on — built in ONE place, so
// the map, the gallery card and the Insights charts describe "this wafer" and
// "these selected dies" identically.
//
// Deliberately not in drilldown.ts: that module is loaded on first use (it
// carries chart panels), while these are built at the moment of the gesture —
// a snapshot, before the lazy import resolves and the selection can change.

import type { Die } from '../core/dies.js';
import { isParametricTest, type TestDef } from '../renderer/buildWaferMap.js';
import type { SweepSpec } from '../stats/sweep.js';

/** One wafer's share of a population. */
export interface DrilldownItem {
  /** The wafer's display label. */
  label: string;
  dies: Die[];
  waferIndex?: number;
}

/** A population a chart can be opened on. */
export interface DrilldownSource {
  /** One entry per wafer the population spans. A snapshot: the chart keeps
   *  these dies whatever happens to the selection afterwards. */
  items: DrilldownItem[];
  /** Who the dies are, read after a count — `"selected on W03"`, `"on W03"`. */
  population: string;
  testDefs: TestDef[] | undefined;
  /** The test on screen where the gesture happened — a chart that shows one
   *  test at a time opens on it. */
  activeTest?: number;
  /** Set when the dies are not measured dies (a lot stack's per-position
   *  aggregates): every chart is then unavailable, with this as the reason. */
  notMeasuredReason?: string;
}

/**
 * Whether any drilldown chart could exist for this data — decides whether a
 * right-click is taken over at all, without loading the drilldown chunk. The
 * distribution charts need a parametric test, a sweep needs to be defined;
 * with neither (a bins-only map) right-click stays the browser's or host's.
 * `targetsFor` in drilldown.ts is the list this summarises.
 */
export function hasDrilldownTargets(testDefs: readonly TestDef[] | undefined, sweeps: readonly SweepSpec[] | undefined): boolean {
  return (sweeps?.length ?? 0) > 0 || (testDefs ?? []).some(isParametricTest);
}

const LOT_STACK_REASON = 'This map stacks a lot: its dies are per-position aggregates, not measured dies';

interface WaferFacts {
  /** The wafer's real identity, if it has one — never a positional stand-in,
   *  which would read as an ID ("Wafer 3 (no ID)") in a chart title. */
  waferLabel: string | undefined;
  testDefs: TestDef[] | undefined;
  isLotStack?: boolean;
  activeTest?: number;
  waferIndex?: number;
}

function make(dies: Die[], population: string, f: WaferFacts): DrilldownSource {
  return {
    items: [{ label: f.waferLabel ?? 'this wafer', dies, waferIndex: f.waferIndex }],
    population,
    testDefs: f.testDefs,
    activeTest: f.activeTest,
    notMeasuredReason: f.isLotStack ? LOT_STACK_REASON : undefined,
  };
}

/** Dies the user selected on one wafer's map. */
export function selectionPopulation(selected: Die[], f: WaferFacts): DrilldownSource {
  return make(selected, f.waferLabel ? `selected on ${f.waferLabel}` : 'selected', f);
}

/** Every die of one wafer. */
export function waferPopulation(dies: Die[], f: WaferFacts): DrilldownSource {
  return make(dies, f.waferLabel ? `on ${f.waferLabel}` : 'on this wafer', f);
}
