// Which tests fail on the same dies (stats/coFailure.ts): the share of the dies failing either of two tests that fail both.

import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCoFailureMatrix } from '../dist/packages/stats/coFailure.js';

const DEFS = [1, 2, 3, 4].map(n => ({ testNumber: n, name: `T${n}`, unit: 'V', limitLow: 0, limitHigh: 10 }));
/** A die with a value for each test: 20 (outside the limits) where `fail` lists the test. */
const die = (k, fail) => ({ x: k, y: 0, hbin: 1, testValues: { 1: fail.includes(1) ? 20 : 5, 2: fail.includes(2) ? 20 : 5, 3: fail.includes(3) ? 20 : 5, 4: fail.includes(4) ? 20 : 5 } });
// Tests 1 and 2 always fail together (dies 0 to 3); test 3 fails on dies 2 to 5 (two of them with 1 and 2); test 4 fails once.
const dies = [die(0, [1, 2]), die(1, [1, 2]), die(2, [1, 2, 3]), die(3, [1, 2, 3]), die(4, [3]), die(5, [3]), die(6, [4]), die(7, [])];
const at = (m, a, b) => m.cells.find(c => m.tests[c.xIndex].testNumber === a && m.tests[c.yIndex].testNumber === b);

test('a pair that always fails together scores 1, one that fails on different dies less', () => {
  const m = buildCoFailureMatrix(dies, DEFS);
  assert.deepEqual(m.tests.map(t => t.testNumber), [1, 2, 3], 'test 4 fails once, so it has no one to fail with and is left out');
  assert.equal(at(m, 1, 2).r, 1);
  assert.equal(at(m, 1, 2).n, 4, 'the dies failing either');
  assert.ok(Math.abs(at(m, 1, 3).r - 2 / 6) < 1e-9, 'two of the six dies failing either test fail both');
  assert.equal(at(m, 3, 1).r, at(m, 1, 3).r, 'symmetric');
});

test('without two tests that have limits and fail twice, there is nothing to compare', () => {
  assert.deepEqual(buildCoFailureMatrix(dies, [{ testNumber: 1, name: 'T1', limitLow: 0, limitHigh: 10 }]), { tests: [], cells: [] });
  assert.deepEqual(buildCoFailureMatrix(dies, DEFS.map(({ limitLow, limitHigh, ...d }) => d)), { tests: [], cells: [] });
  assert.deepEqual(buildCoFailureMatrix([die(0, []), die(1, [])], DEFS), { tests: [], cells: [] });
});
