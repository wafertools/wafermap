import test from 'node:test';
import assert from 'node:assert/strict';
import { buildYieldData, buildYieldDataCombined } from '../dist/packages/stats/yield.js';

function die(hbin) { return { x: 0, y: 0, hbin }; }

test('buildYieldData — one row per item, percent = pass/total using passBins', () => {
  const items = [
    { label: 'W1', dies: [die(1), die(1), die(2)] }, // 2/3 pass
    { label: 'W2', dies: [die(2), die(2)] },          // 0/2 pass
  ];
  const out = buildYieldData(items, [1], 'label');
  assert.equal(out.length, 2);
  const w1 = out.find(d => d.label === 'W1');
  assert.ok(Math.abs(w1.value - (2 / 3) * 100) < 1e-9);
  assert.equal(w1.itemCount, 1);
});

test('buildYieldData — sortBy yield orders descending by value', () => {
  const items = [
    { label: 'A', dies: [die(2)] },      // 0%
    { label: 'B', dies: [die(1)] },      // 100%
  ];
  const out = buildYieldData(items, [1], 'yield');
  assert.equal(out[0].label, 'B');
  assert.equal(out[1].label, 'A');
});

test('buildYieldDataCombined — pools group yield die-count-weighted', () => {
  const groups = [
    { key: 'G1', items: [{ dies: [die(1), die(2)] }, { dies: [die(1), die(1)] }] }, // 3/4 pass
  ];
  const out = buildYieldDataCombined(groups, [1], 'label');
  assert.equal(out.length, 1);
  assert.ok(Math.abs(out[0].value - 75) < 1e-9);
  assert.equal(out[0].itemCount, 2);
});

test('buildYieldData — dies with no hbin are excluded from the total', () => {
  const items = [{ label: 'W1', dies: [die(1), { x: 0, y: 0 }] }];
  const out = buildYieldData(items, [1], 'label');
  assert.equal(out[0].value, 100);
});

test('buildYieldData — partial/edgeExcluded dies are excluded, matching buildWaferMap\'s convention', () => {
  const items = [{
    label: 'W1',
    dies: [
      die(1), die(1),                                   // 2 eligible pass
      { x: 0, y: 0, hbin: 2, partial: true },            // excluded
      { x: 0, y: 0, hbin: 2, edgeExcluded: true },        // excluded
    ],
  }];
  const out = buildYieldData(items, [1], 'label');
  assert.equal(out[0].value, 100); // would be 50% if partial/edge dies counted
});

test('buildYieldData — a precomputed yieldPercent is used directly, ignoring dies', () => {
  const items = [{ label: 'W1', yieldPercent: 42, dies: [die(1), die(1), die(1)] }]; // dies would say 100%
  const out = buildYieldData(items, [1], 'label');
  assert.equal(out[0].value, 42);
});

test('buildYieldDataCombined — precomputed per-item yieldPercent is weighted by die count', () => {
  const groups = [{
    key: 'G1',
    items: [
      { yieldPercent: 100, dies: [die(1), die(1)] },   // 2 dies @ 100%
      { yieldPercent: 0, dies: [die(2), die(2)] },     // 2 dies @ 0%
    ],
  }];
  const out = buildYieldDataCombined(groups, [1], 'label');
  assert.equal(out[0].value, 50);
});
