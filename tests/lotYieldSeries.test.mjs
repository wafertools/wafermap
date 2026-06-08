import test from 'node:test';
import assert from 'node:assert/strict';
import { buildWaferMap } from '../dist/packages/renderer/buildWaferMap.js';
import { analyzeWaferLot } from '../dist/packages/stats/analyzeWaferLot.js';

// Use a standard 300 mm wafer to ensure all dies are inside the boundary.
function waferInput(hbins) {
  return buildWaferMap({
    results: hbins.map((bin, i) => ({ x: i - 1, y: 0, hbin: bin })),
    waferConfig: { diameter: 300 },
    dieConfig: { width: 10, height: 10 },
    passBins: [1],
  });
}

test('lotYieldSeries — present on LotStatsSummary', () => {
  const w1 = waferInput([1, 1, 2]);  // 2/3 pass
  const w2 = waferInput([1, 2, 2]);  // 1/3 pass
  const lot = analyzeWaferLot([w1, w2]);
  assert.ok(Array.isArray(lot.lotYieldSeries));
  assert.equal(lot.lotYieldSeries.length, 2);
});

test('lotYieldSeries — ordered by waferIndex', () => {
  const w1 = waferInput([1, 1, 2]);
  const w2 = waferInput([1, 2, 2]);
  const lot = analyzeWaferLot([w1, w2]);
  assert.equal(lot.lotYieldSeries[0].waferIndex, 0);
  assert.equal(lot.lotYieldSeries[1].waferIndex, 1);
});

test('lotYieldSeries — yieldPercent values match per-wafer stats', () => {
  const w1 = waferInput([1, 1, 2]);  // 2/3 pass
  const w2 = waferInput([1, 2, 2]);  // 1/3 pass
  const lot = analyzeWaferLot([w1, w2]);
  const y0 = lot.lotYieldSeries[0].yieldPercent;
  const y1 = lot.lotYieldSeries[1].yieldPercent;
  assert.ok(y0 !== null && Math.abs(y0 - (2 / 3) * 100) < 1e-6);
  assert.ok(y1 !== null && Math.abs(y1 - (1 / 3) * 100) < 1e-6);
});

test('lotYieldSeries — null yieldPercent when wafer has no bin data', () => {
  const w1 = buildWaferMap({
    results: [{ x: 0, y: 0 }, { x: 1, y: 0 }],
    dieConfig: { width: 10, height: 10 },
  });
  const lot = analyzeWaferLot([w1]);
  assert.equal(lot.lotYieldSeries[0].yieldPercent, null);
});

test('lotYieldSeries — matches lot.perWafer[i].summary.stats.yieldPercent', () => {
  const w1 = waferInput([1, 2, 1]);
  const w2 = waferInput([2, 2, 2]);
  const lot = analyzeWaferLot([w1, w2]);
  for (const entry of lot.lotYieldSeries) {
    const pw = lot.perWafer.find(p => p.waferIndex === entry.waferIndex);
    assert.equal(entry.yieldPercent, pw?.summary.stats.yieldPercent);
  }
});
