// 8-connected component labelling is shared by the cluster finding and the pattern
// classifier, so a labelling fault would make a wafer report a cluster in one place
// and no pattern in the other. Both callers' tests reach it through several layers of
// further logic; these cases pin it directly.

import test from 'node:test';
import assert from 'node:assert/strict';
import { findConnectedComponents } from '../dist/packages/stats/connectedComponents.js';

const dies = (...xy) => xy.map(([x, y]) => ({ x, y }));
const sizes = (components) => components.map(c => c.length).sort((a, b) => b - a);
const keys = (component) => component.map(d => `${d.x},${d.y}`).sort();

test('no dies give no components', () => {
  assert.deepEqual(findConnectedComponents([]), []);
});

test('a single die is one component of one', () => {
  const [only, ...rest] = findConnectedComponents(dies([3, -2]));
  assert.equal(rest.length, 0);
  assert.deepEqual(keys(only), ['3,-2']);
});

test('dies that touch only at a corner are one component', () => {
  const result = findConnectedComponents(dies([0, 0], [1, 1]));
  assert.deepEqual(sizes(result), [2]);
});

test('a diagonal-only chain is one component', () => {
  const chain = Array.from({ length: 8 }, (_, i) => [i, i]);
  const result = findConnectedComponents(dies(...chain));
  assert.deepEqual(sizes(result), [8]);
});

test('two groups two dies apart stay separate, and a gap of one joins them', () => {
  assert.deepEqual(sizes(findConnectedComponents(dies([0, 0], [1, 0], [4, 0], [5, 0]))), [2, 2]);
  assert.deepEqual(sizes(findConnectedComponents(dies([0, 0], [1, 0], [3, 0], [4, 0]))), [2, 2]);
  assert.deepEqual(sizes(findConnectedComponents(dies([0, 0], [1, 0], [2, 0], [3, 0], [4, 0]))), [5]);
});

test('two groups meeting at a corner merge', () => {
  const left = [[0, 0], [1, 0], [0, 1], [1, 1]];
  const right = [[2, 2], [3, 2], [2, 3], [3, 3]];
  assert.deepEqual(sizes(findConnectedComponents(dies(...left, ...right))), [8]);
});

test('every die lands in exactly one component, whatever the input order', () => {
  const input = dies([0, 0], [9, 9], [1, 1], [5, 5], [2, 2], [9, 8], [-4, 7]);
  const forward = findConnectedComponents(input);
  const backward = findConnectedComponents([...input].reverse());
  for (const result of [forward, backward]) {
    assert.equal(result.flat().length, input.length);
    assert.equal(new Set(result.flat().map(d => `${d.x},${d.y}`)).size, input.length);
  }
  const shape = (r) => r.map(keys).map(k => k.join('|')).sort();
  assert.deepEqual(shape(forward), shape(backward));
});

test('negative coordinates and the origin are handled like any other', () => {
  const result = findConnectedComponents(dies([-1, -1], [0, 0], [1, 1], [-30, 20]));
  assert.deepEqual(sizes(result), [3, 1]);
});

test('a large contiguous region does not exhaust the stack', () => {
  const n = 400;
  const region = [];
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) region.push({ x, y });
  const result = findConnectedComponents(region);
  assert.equal(result.length, 1);
  assert.equal(result[0].length, n * n);
});

test('a long one-die-wide snake is one component', () => {
  const snake = [];
  for (let i = 0; i < 100000; i++) snake.push({ x: i, y: 0 });
  assert.equal(findConnectedComponents(snake).length, 1);
});
