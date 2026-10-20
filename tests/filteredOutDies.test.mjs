// A die the page filter drops (`Die.filteredOut`) is drawn dimmed and is in no count: not the legend's, not the yield's.

import test from 'node:test';
import assert from 'node:assert/strict';
import { buildWaferMap } from '../dist/index.js';
import { isYieldEligibleDie } from '../dist/packages/core/dies.js';
import { computeYield } from '../dist/packages/renderer/buildWaferMap.js';
import { buildView } from './fixtures/buildViewStated.mjs';

function built() {
  return buildWaferMap({
    results: Array.from({ length: 16 }, (_, k) => ({ x: k % 4, y: Math.floor(k / 4), hbin: k < 4 ? 2 : 1 })),
    waferConfig: { diameter: 60 }, dieConfig: { width: 10, height: 10 }, passBins: [1],
  });
}

test('a filtered-out die is not yield-eligible, so yield counts only the kept dies', () => {
  const r = built();
  const dropFails = r.dies.map(d => (d.hbin === 2 ? { ...d, filteredOut: true } : d));
  assert.equal(isYieldEligibleDie(dropFails.find(d => d.filteredOut)), false);
  assert.equal(computeYield(r.dies, [1]).yieldPercent, 75);
  assert.equal(computeYield(dropFails, [1]).yieldPercent, 100, 'only the passing dies remain');
});

test('a filtered-out die is drawn dimmed and left out of the bin legend counts', () => {
  const r = built();
  const dies = r.dies.map(d => (d.hbin === 2 ? { ...d, filteredOut: true } : d));
  const plain = buildView(r.wafer, r.dies, { plotMode: 'hardBin', ringCount: r.ringCount });
  const dimmed = buildView(r.wafer, dies, { plotMode: 'hardBin', ringCount: r.ringCount });
  const fills = v => v.rectangles.map(x => x.fill);
  assert.notDeepEqual(fills(dimmed), fills(plain));
  assert.equal(plain.binCounts.get(2), 4);
  assert.equal(dimmed.binCounts.get(2), undefined, 'the dropped bin-2 dies are in no legend count');
  assert.equal(dimmed.binCounts.get(1), 12);
});
