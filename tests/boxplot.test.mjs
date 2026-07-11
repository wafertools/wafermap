import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTestBoxplotData } from '../dist/packages/stats/boxplot.js';

function die(v) { return { x: 0, y: 0, testValues: { 1: v } }; }

test('buildTestBoxplotData — one row per item with a five-number summary', () => {
  const items = [
    { label: 'W1', dies: [1, 3, 5].map(die) },
    { label: 'W2', dies: [10, 20].map(die) },
  ];
  const out = buildTestBoxplotData(items, 1);
  assert.equal(out.length, 2);
  assert.equal(out[0].label, 'W1');
  assert.equal(out[0].min, 1);
  assert.equal(out[0].median, 3);
  assert.equal(out[0].max, 5);
  assert.equal(out[0].count, 3);
});

test('buildTestBoxplotData — item with no valid values for the test gets count:0', () => {
  const items = [{ label: 'W1', dies: [{ x: 0, y: 0, testValues: { 2: 5 } }] }];
  const out = buildTestBoxplotData(items, 1);
  assert.equal(out[0].count, 0);
  assert.ok(Number.isNaN(out[0].median));
});

test('buildTestBoxplotData — falls back to an index label when none is given', () => {
  const items = [{ dies: [die(1)] }];
  const out = buildTestBoxplotData(items, 1);
  assert.equal(out[0].label, '#0');
});

test('buildTestBoxplotData — ignores non-finite/undefined test values', () => {
  const items = [{ label: 'W1', dies: [die(1), die(NaN), { x: 0, y: 0, testValues: {} }, die(3)] }];
  const out = buildTestBoxplotData(items, 1);
  assert.equal(out[0].count, 2);
});
