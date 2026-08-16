import test from 'node:test';
import assert from 'node:assert/strict';
import { isYieldEligibleDie, hasPosition, getDieKey } from '../dist/packages/core/dies.js';

test('isYieldEligibleDie — excludes partial and edge-excluded dies by default', () => {
  assert.equal(isYieldEligibleDie({ x: 0, y: 0 }), true);
  assert.equal(isYieldEligibleDie({ x: 0, y: 0, partial: true }), false);
  assert.equal(isYieldEligibleDie({ x: 0, y: 0, edgeExcluded: true }), false);
});

test('isYieldEligibleDie — options can opt back in', () => {
  assert.equal(isYieldEligibleDie({ x: 0, y: 0, partial: true }, { includePartial: true }), true);
  assert.equal(isYieldEligibleDie({ x: 0, y: 0, edgeExcluded: true }, { includeEdgeExcluded: true }), true);
});

test('hasPosition — true only when both x and y are present', () => {
  assert.equal(hasPosition({ x: 0, y: 0 }), true);
  assert.equal(hasPosition({ x: 3, y: -2 }), true);
  assert.equal(hasPosition({}), false);
  assert.equal(hasPosition({ x: undefined, y: undefined }), false);
  assert.equal(hasPosition({ x: null, y: null }), false);
});

test('getDieKey — "x,y" for a positioned die', () => {
  assert.equal(getDieKey({ x: 3, y: -2 }), '3,-2');
});

test('getDieKey — falls back to "id:<id>" for an unpositioned die, never colliding across different ids', () => {
  const a = getDieKey({ id: 'unpositioned_0' });
  const b = getDieKey({ id: 'unpositioned_1' });
  assert.equal(a, 'id:unpositioned_0');
  assert.equal(b, 'id:unpositioned_1');
  assert.notEqual(a, b);
});
