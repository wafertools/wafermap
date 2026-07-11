import test from 'node:test';
import assert from 'node:assert/strict';
import { buildScatterData, buildScatterDataGrouped } from '../dist/packages/stats/scatter.js';

function die(x, y, hbin) { return { x: 0, y: 0, hbin, testValues: { 1: x, 2: y } }; }

test('buildScatterData — one point per die with valid values for both tests', () => {
  const items = [{ dies: [die(1, 10, 1), die(2, 20, 2)] }];
  const out = buildScatterData(items, 1, 2);
  assert.equal(out.length, 2);
  assert.deepEqual(out[0], { x: 1, y: 10, hbin: 1 });
});

test('buildScatterData — skips dies missing either test value', () => {
  const items = [{ dies: [die(1, 10, 1), { x: 0, y: 0, testValues: { 1: 5 } }] }];
  const out = buildScatterData(items, 1, 2);
  assert.equal(out.length, 1);
});

test('buildScatterDataGrouped — tags every point with its group key', () => {
  const groups = [
    { key: 'A', items: [{ dies: [die(1, 10, 1)] }] },
    { key: 'B', items: [{ dies: [die(2, 20, 2)] }] },
  ];
  const out = buildScatterDataGrouped(groups, 1, 2);
  assert.equal(out.length, 2);
  assert.equal(out[0].group, 'A');
  assert.equal(out[1].group, 'B');
});
