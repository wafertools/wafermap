// Which tests to draw in the Tests by wafer grid: the ones whose wafers (or groups) differ most.
//
// A lot can have hundreds of tests and a grid has room for a dozen rows, so the rows are the tests where the wafer means
// spread furthest compared with the spread of every die: the share of a test's variance that lies between wafers. A test
// that is the same on every wafer says nothing in a grid of z-scores, however many there are of it.

import type { Die } from '../core/dies.js';
import { testValue } from '../core/dieTable.js';

/** At most this many dies × tests are read to rank; beyond it the first tests are taken as they come. */
export const RANK_BUDGET = 4_000_000;

/**
 * The `limit` tests (of `tests`) with the largest share of variance between wafers, most first. Tests with no spread, or
 * with values on fewer than two wafers, are left out. Past the reading budget the first `limit` tests are returned in order.
 */
export function rankTestsByWaferSpread(wafers: ReadonlyArray<{ dies: readonly Die[] }>, tests: readonly number[], limit: number): number[] {
  if (wafers.length < 2) return [];
  const dies = wafers.reduce((a, w) => a + w.dies.length, 0);
  if (dies * tests.length > RANK_BUDGET) return tests.slice(0, limit);
  const scored: Array<{ test: number; share: number }> = [];
  for (const test of tests) {
    let n = 0, sum = 0, sumSq = 0;
    const means: number[] = [], sizes: number[] = [];
    for (const w of wafers) {
      let wn = 0, ws = 0;
      for (const d of w.dies) {
        const v = testValue(d, test);
        if (v === undefined || !Number.isFinite(v)) continue;
        wn++; ws += v; sumSq += v * v;
      }
      if (wn) { means.push(ws / wn); sizes.push(wn); n += wn; sum += ws; }
    }
    if (means.length < 2 || n < 2) continue;
    const grand = sum / n;
    const total = sumSq - n * grand * grand;
    if (!(total > 0)) continue;
    let between = 0;
    means.forEach((m, i) => { between += sizes[i] * (m - grand) ** 2; });
    scored.push({ test, share: between / total });
  }
  return scored.sort((a, b) => b.share - a.share).slice(0, limit).map(s => s.test);
}
