// Which tests fail on the same dies: the share of the dies that fail either of two tests that fail both.
//
// The correlation matrix compares values; this compares failures. Two tests whose values barely correlate can still fail on
// the same dies (one defect, two symptoms), and two that correlate can fail on different ones. A pair's figure is the
// Jaccard index of its failing dies, from 0 (never together) to 1 (always together), judged by the test limits as the
// pass-rate card judges them. The result has the correlation matrix's shape, so the same card draws it.

import type { Die } from '../core/dies.js';
import { isParametricTest, type TestDef } from '../renderer/buildWaferMap.js';
import { markedTestLabel, derivedFields } from '../renderer/testLabel.js';
import { dieFailsTest } from './testPassRate.js';
import type { CorrelationMatrix, CorrelationCell } from './correlation.js';

/** At most this many tests, the ones that fail on most dies, enter the matrix. */
export const CO_FAILURE_TESTS = 100;

/** A test with limits can fail; one without cannot, and is not in the matrix. */
const hasLimits = (d: TestDef): boolean => d.limitLow !== undefined || d.limitHigh !== undefined;

/**
 * The failing dies of every test with limits that fails on two dies or more, compared pair by pair. A pair's `r` is the share
 * of dies failing either that fail both (null when neither fails anywhere) and its `n` is the dies failing either.
 */
export function buildCoFailureMatrix(dies: readonly Die[], testDefs: readonly TestDef[]): CorrelationMatrix {
  const defs = testDefs.filter((d): d is TestDef & { testNumber: number } => d.testNumber !== undefined && isParametricTest(d) && hasLimits(d));
  if (defs.length < 2) return { tests: [], cells: [] };
  // Each die's failing tests, as indexes into `defs`: sparse, so the pair pass walks only what failed.
  const failures = new Map<number, number>();
  const failing: number[][] = [];
  for (const die of dies) {
    let list: number[] | undefined;
    for (let t = 0; t < defs.length; t++) {
      if (dieFailsTest(die, defs[t], 'spec') !== true) continue;
      (list ??= []).push(t);
      failures.set(t, (failures.get(t) ?? 0) + 1);
    }
    if (list) failing.push(list);
  }
  const chosen = [...failures.entries()].filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1]).slice(0, CO_FAILURE_TESTS).map(([t]) => t).sort((a, b) => a - b);
  if (chosen.length < 2) return { tests: [], cells: [] };
  const slot = new Map(chosen.map((t, i) => [t, i]));
  const both = new Float64Array(chosen.length * chosen.length);
  for (const list of failing) {
    const here = list.filter(t => slot.has(t)).map(t => slot.get(t)!);
    for (let a = 0; a < here.length; a++) for (let b = a + 1; b < here.length; b++) both[here[a] * chosen.length + here[b]]++;
  }
  const tests = chosen.map(t => ({ testNumber: defs[t].testNumber, label: markedTestLabel(defs[t], defs[t].testNumber), unit: defs[t].unit, ...derivedFields(defs[t]) }));
  const cells: CorrelationCell[] = [];
  for (let yi = 0; yi < chosen.length; yi++) {
    for (let xi = 0; xi < chosen.length; xi++) {
      if (xi === yi) { cells.push({ xIndex: xi, yIndex: yi, r: 1, n: failures.get(chosen[xi]) ?? 0 }); continue; }
      const lo = Math.min(xi, yi), hi = Math.max(xi, yi);
      const together = both[lo * chosen.length + hi];
      const union = (failures.get(chosen[xi]) ?? 0) + (failures.get(chosen[yi]) ?? 0) - together;
      cells.push({ xIndex: xi, yIndex: yi, r: union > 0 ? together / union : null, n: union });
    }
  }
  return { tests, cells };
}
