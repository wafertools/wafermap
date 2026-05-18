import test from 'node:test';
import assert from 'node:assert/strict';
import { getUniqueBins } from '../dist/packages/core/aggregates.js';

function die(id, hbin, sbin) {
  return { id, x: 0, y: 0, physX: 0, physY: 0, width: 1, height: 1, hbin, sbin };
}

test('getUniqueBins — empty input returns empty array', () => {
  assert.deepEqual(getUniqueBins([]), []);
});

test('getUniqueBins — sorted unique hard bins', () => {
  const dies = [die('a', 3), die('b', 1), die('c', 1), die('d', 2)];
  assert.deepEqual(getUniqueBins(dies, 'hard'), [1, 2, 3]);
});

test('getUniqueBins — sorted unique soft bins', () => {
  const dies = [die('a', 1, 20), die('b', 1, 10), die('c', 1, 10)];
  assert.deepEqual(getUniqueBins(dies, 'soft'), [10, 20]);
});

test('getUniqueBins — defaults to hard bins', () => {
  const dies = [die('a', 5), die('b', 2)];
  assert.deepEqual(getUniqueBins(dies), [2, 5]);
});

test('getUniqueBins — ignores dies with undefined hbin', () => {
  const dies = [die('a', undefined), die('b', 1), die('c', 2)];
  assert.deepEqual(getUniqueBins(dies, 'hard'), [1, 2]);
});

test('getUniqueBins — ignores dies with undefined sbin', () => {
  const dies = [die('a', 1, undefined), die('b', 1, 5)];
  assert.deepEqual(getUniqueBins(dies, 'soft'), [5]);
});

test('getUniqueBins — all undefined bins returns empty array', () => {
  const dies = [die('a', undefined), die('b', undefined)];
  assert.deepEqual(getUniqueBins(dies, 'hard'), []);
});

test('getUniqueBins — deduplicates across many dies', () => {
  const dies = Array.from({ length: 50 }, (_, i) => die(`d${i}`, i % 3));
  assert.deepEqual(getUniqueBins(dies, 'hard'), [0, 1, 2]);
});

test('getUniqueBins — sorts numerically not lexicographically', () => {
  const dies = [die('a', 10), die('b', 9), die('c', 2)];
  assert.deepEqual(getUniqueBins(dies, 'hard'), [2, 9, 10]);
});
