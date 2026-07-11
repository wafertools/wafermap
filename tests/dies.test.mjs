import test from 'node:test';
import assert from 'node:assert/strict';
import { isYieldEligibleDie } from '../dist/packages/core/dies.js';

test('isYieldEligibleDie — excludes partial and edge-excluded dies by default', () => {
  assert.equal(isYieldEligibleDie({ x: 0, y: 0 }), true);
  assert.equal(isYieldEligibleDie({ x: 0, y: 0, partial: true }), false);
  assert.equal(isYieldEligibleDie({ x: 0, y: 0, edgeExcluded: true }), false);
});

test('isYieldEligibleDie — options can opt back in', () => {
  assert.equal(isYieldEligibleDie({ x: 0, y: 0, partial: true }, { includePartial: true }), true);
  assert.equal(isYieldEligibleDie({ x: 0, y: 0, edgeExcluded: true }, { includeEdgeExcluded: true }), true);
});
