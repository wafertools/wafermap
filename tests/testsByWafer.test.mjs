// Which tests the Distributions grid draws (stats/testsByWafer.ts): the ones whose wafers differ most.

import test from 'node:test';
import assert from 'node:assert/strict';
import { rankTestsByWaferSpread, RANK_BUDGET } from '../dist/packages/stats/testsByWafer.js';

/** A wafer of 20 dies: test 1 is `a` on every die plus noise, test 2 the same on every wafer, test 3 only `b`. */
const wafer = (a, b) => ({ dies: Array.from({ length: 20 }, (_, k) => ({ x: k, y: 0, hbin: 1, testValues: { 1: a + (k % 5) / 100, 2: 5 + (k % 5) / 100, 3: b + (k % 5) / 100 } })) });
const lot = [wafer(1, 0), wafer(1.5, 0.01), wafer(2, 0.02)];

test('the tests whose wafers differ most come first, a test that is the same on every wafer is left out of the lead', () => {
  const ranked = rankTestsByWaferSpread(lot, [1, 2, 3], 3);
  assert.equal(ranked[0], 1, 'test 1 moves from wafer to wafer by far the most relative to its spread');
  assert.equal(ranked.at(-1), 2, 'test 2 is the same on every wafer');
});

test('only the limit is returned, and fewer than two wafers ranks nothing', () => {
  assert.equal(rankTestsByWaferSpread(lot, [1, 2, 3], 1).length, 1);
  assert.deepEqual(rankTestsByWaferSpread([lot[0]], [1, 2, 3], 3), []);
});

test('a test with no spread at all, or on one wafer only, is not ranked', () => {
  const flat = [{ dies: [{ x: 0, y: 0, hbin: 1, testValues: { 9: 1 } }, { x: 1, y: 0, hbin: 1, testValues: { 9: 1 } }] }, { dies: [{ x: 0, y: 0, hbin: 1, testValues: { 9: 1 } }] }];
  assert.deepEqual(rankTestsByWaferSpread(flat, [9], 3), []);
  const one = [{ dies: [{ x: 0, y: 0, hbin: 1, testValues: { 8: 1 } }, { x: 1, y: 0, hbin: 1, testValues: { 8: 2 } }] }, { dies: [{ x: 0, y: 0, hbin: 1 }] }];
  assert.deepEqual(rankTestsByWaferSpread(one, [8], 3), []);
});

test('past the reading budget the first tests are taken as they come', () => {
  const big = Array.from({ length: 2 }, () => ({ dies: new Array(RANK_BUDGET) }));
  assert.deepEqual(rankTestsByWaferSpread(big, [5, 6, 7], 2), [5, 6]);
});
