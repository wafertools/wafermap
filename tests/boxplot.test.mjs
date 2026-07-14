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

test('buildTestBoxplotData — excludes partial/edgeExcluded dies from the raw-scan fallback', () => {
  // Regression test: earlier versions of buildTestBoxplotData did not apply
  // the partial/edgeExcluded eligibility filter every other per-test
  // computation in this package uses (analyzeWaferMap's computePerTestStats,
  // capability.ts, binPareto.ts, summaryPanel.ts) — a die that never counted
  // toward this wafer's yield or any other stat could still skew its boxplot.
  const items = [{
    label: 'W1',
    dies: [
      die(1), die(3), die(5),
      { ...die(999), partial: true },
      { ...die(999), edgeExcluded: true },
    ],
  }];
  const out = buildTestBoxplotData(items, 1);
  assert.equal(out[0].count, 3);
  assert.equal(out[0].max, 5);
});

test('buildTestBoxplotData — uses precomputed testStats directly, skipping the raw scan, when present', () => {
  const precomputed = { testNumber: 1, min: 100, q1: 110, median: 120, q3: 130, max: 140, count: 42 };
  // Deliberately wrong/mismatched raw dies — proves the precomputed path is
  // actually used instead of silently falling back to a raw scan.
  const items = [{ label: 'W1', dies: [die(1), die(2)], testStats: [precomputed] }];
  const out = buildTestBoxplotData(items, 1);
  assert.deepEqual(out[0], { label: 'W1', min: 100, q1: 110, median: 120, q3: 130, max: 140, count: 42 });
});

test('buildTestBoxplotData — falls back to the raw scan when testStats is present but lacks this testNumber', () => {
  const items = [{ label: 'W1', dies: [1, 3, 5].map(die), testStats: [{ testNumber: 2, min: 0, q1: 0, median: 0, q3: 0, max: 0, count: 1 }] }];
  const out = buildTestBoxplotData(items, 1);
  assert.equal(out[0].count, 3);
  assert.equal(out[0].median, 3);
});
