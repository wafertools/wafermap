// The correlation within groups (stats/correlation.ts demeanWithinGroups): each group's mean taken off every test.

import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCorrelationMatrix, demeanWithinGroups } from '../dist/packages/stats/correlation.js';

const DEFS = [{ testNumber: 1, name: 'A', unit: 'V' }, { testNumber: 2, name: 'B', unit: 'V' }];
/** A group centred on (ca, cb): the two tests are independent noise around it (a fixed, uncorrelated pattern). */
const group = (ca, cb) => Array.from({ length: 24 }, (_, k) => ({ x: k, y: 0, hbin: 1, testValues: { 1: ca + (k % 4) / 10, 2: cb + (Math.floor(k / 4) % 6) / 10 } }));
const slow = group(0, 0), fast = group(5, 5);
const r = m => m.cells.find(c => c.xIndex !== c.yIndex)?.r;

test('two groups that differ on both tests correlate when pooled and not within the groups', () => {
  assert.ok(r(buildCorrelationMatrix([...slow, ...fast], DEFS)) > 0.9, 'pooled: the difference between groups reads as a relationship');
  const within = demeanWithinGroups([slow, fast], DEFS);
  assert.equal(within.length, 48);
  assert.ok(Math.abs(r(buildCorrelationMatrix(within, DEFS))) < 0.1, 'within: nothing is left of it');
});

test('each group\'s mean is taken off, so every group is centred on zero', () => {
  const within = demeanWithinGroups([slow, fast], DEFS);
  for (const part of [within.slice(0, 24), within.slice(24)]) {
    const mean = part.reduce((a, d) => a + d.testValues[1], 0) / part.length;
    assert.ok(Math.abs(mean) < 1e-9);
  }
});
