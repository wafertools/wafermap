// Lot-stack aggregation edge cases — ported from tests/aggregates.test.ts, which
// `npm test` never ran (it only runs tests/*.test.mjs). public-api.test.mjs
// already checks each aggregation method once over identical die sets; these are
// the behaviours it does not reach, and the ones real lots hit: an even number of
// wafers, a single wafer, and wafers that do not share the same die set.

import test from 'node:test';
import assert from 'node:assert/strict';
import { aggregateValues, aggregateBinCounts } from '../dist/packages/core/aggregates.js';

const die = (x, y, extra) => ({ id: `${x}_${y}`, x, y, width: 10, height: 10, physX: x * 10, physY: y * 10, ...extra });

const W1 = [die(0, 0, { testValues: { 0: 10 }, hbin: 1, sbin: 10 }), die(1, 0, { testValues: { 0: 20 }, hbin: 2, sbin: 20 })];
const W2 = [die(0, 0, { testValues: { 0: 30 }, hbin: 1, sbin: 11 }), die(1, 0, { testValues: { 0: 40 }, hbin: 3, sbin: 20 })];
const at = (dies, x, y) => dies.find(d => d.x === x && d.y === y);

test('aggregateValues median — even count averages the middle pair, odd count takes the middle', () => {
  assert.equal(at(aggregateValues([W1, W2], 'median'), 0, 0).testValues[0], 20, '[10, 30] → 20');
  const W3 = [die(0, 0, { testValues: { 0: 50 } })];
  assert.equal(at(aggregateValues([W1, W2, W3], 'median'), 0, 0).testValues[0], 30, '[10, 30, 50] → 30');
});

test('aggregateValues stddev — sample standard deviation, and 0 for a single wafer', () => {
  const two = at(aggregateValues([W1, W2], 'stddev'), 0, 0).testValues[0];
  assert.ok(Math.abs(two - Math.sqrt(200)) < 1e-9, `[10, 30] → √200, got ${two}`);
  assert.equal(aggregateValues([W1], 'stddev')[0].testValues[0], 0, 'one value has no spread, not NaN');
});

test('aggregateValues — wafers with different die sets contribute the union of positions', () => {
  const sparse = [die(9, 9, { testValues: { 0: 99 } })];
  const out = aggregateValues([W1, sparse], 'count');
  assert.equal(at(out, 0, 0).testValues[0], 1, '(0,0) exists only on the first wafer');
  assert.equal(at(out, 9, 9).testValues[0], 1, '(9,9) exists only on the second wafer');
});

test('aggregateValues — die geometry comes from the first wafer when wafers disagree', () => {
  const large = [{ ...die(0, 0, { testValues: { 0: 100 } }), width: 50, height: 50, physX: 25, physY: 25 }];
  const small = [{ ...die(0, 0, { testValues: { 0: 200 } }), width: 10, height: 10, physX: 5, physY: 5 }];
  const [out] = aggregateValues([large, small], 'mean');
  assert.equal(out.testValues[0], 150);
  assert.equal(out.width, 50, 'width from the first wafer');
  assert.equal(out.physX, 25, 'position from the first wafer');
});

test('aggregateBinCounts — counts a target soft bin, independently of hard bins', () => {
  const out = aggregateBinCounts([W1, W2], 20, 'soft');
  assert.equal(at(out, 1, 0).testValues[0], 2, 'soft bin 20 at (1,0) on both wafers');
  assert.equal(at(out, 0, 0).testValues[0], 0, 'soft bins 10 and 11 at (0,0) are not 20');
});

test('aggregateBinCounts — the first wafer defines the output grid', () => {
  const full = [die(0, 0, { hbin: 1 })];
  assert.equal(aggregateBinCounts([[], full], 1).length, 0, 'an empty first wafer gives an empty stack');
  assert.equal(aggregateBinCounts([full, []], 1).length, 1, 'a populated first wafer defines the positions');
});
