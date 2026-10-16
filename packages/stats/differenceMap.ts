// A wafer-to-wafer difference map: at each die position, group A's mean minus group B's (two splits, two lots, two
// tools, or two single wafers), as a map of the differences. Where on the wafer one process differs from another is
// what an edge-ring or centre problem shows as, and a difference of two stacked maps shows it directly.
//
// Each group's value at a position is its stacked map's value there: the mean over the group's wafers of the test's
// value, or of the die's pass verdict (100 or 0) for yield, by `aggregateValues`, the function the stacked maps use.
// A position takes a difference only where both groups have a value; everywhere else it is no data.
//
// Pure, no DOM.

import type { Die } from '../core/dies.js';
import { diePassStatus, hasPosition, isYieldEligibleDie, positionKey } from '../core/dies.js';
import { copyDie, testValue } from '../core/dieTable.js';
import { aggregateValues } from '../core/aggregates.js';

/** A wafer of a group: its dies, and its own pass bins (for a yield difference). */
export interface DifferenceWafer { dies: readonly Die[]; passBins: readonly number[] }

/** What is compared at each position: a measured test, or the yield (the share of the group's wafers passing there). */
export type DifferenceMeasure = { test: number } | { yield: true };

export interface DifferenceResult {
  /** One die per position either group has, `testValues[0]` the difference where both have a value. */
  dies: Die[];
  /** Positions with a difference, and the largest difference either way (for a colour range centred on zero). */
  compared: number;
  maxAbs: number;
}

/** A group's wafers as dies carrying the measured value at `testValues[0]`, positioned dies only. */
function asValues(wafers: readonly DifferenceWafer[], m: DifferenceMeasure): Array<Array<Die & { x: number; y: number }>> {
  return wafers.map(w => {
    const pass = new Set(w.passBins);
    return w.dies.filter(hasPosition).map(d => {
      let v: number | undefined;
      if ('test' in m) v = testValue(d, m.test);
      else if (isYieldEligibleDie(d)) { const p = diePassStatus(d, pass); v = p === undefined ? undefined : p ? 100 : 0; }
      return copyDie(d, { testValues: v === undefined || !Number.isFinite(v) ? undefined : { 0: v }, testPass: undefined });
    });
  });
}

/** Group A's mean minus group B's at every position; see the module comment for the rule. */
export function differenceMap(a: readonly DifferenceWafer[], b: readonly DifferenceWafer[], m: DifferenceMeasure): DifferenceResult {
  const meanA = aggregateValues(asValues(a, m), 'mean', 0) as Die[];
  const diesB = aggregateValues(asValues(b, m), 'mean', 0) as Die[];
  const meanB = new Map(diesB.map(d => [positionKey(d), testValue(d, 0)]));
  let compared = 0, maxAbs = 0;
  const seen = new Set<number | string>();
  const dies: Die[] = meanA.map(d => {
    const k = positionKey(d);
    seen.add(k);
    const va = testValue(d, 0), vb = meanB.get(k);
    if (va === undefined || vb === undefined) return copyDie(d, { testValues: undefined });
    const diff = va - vb;
    compared++;
    maxAbs = Math.max(maxAbs, Math.abs(diff));
    return copyDie(d, { testValues: { 0: diff } });
  });
  // Positions only B has: on the map, as no data.
  for (const d of diesB) if (!seen.has(positionKey(d))) dies.push(copyDie(d, { testValues: undefined }));
  return { dies, compared, maxAbs };
}
