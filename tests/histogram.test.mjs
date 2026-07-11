import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTestHistogramData, buildTestHistogramSeries } from '../dist/packages/stats/histogram.js';

function die(v) { return { x: 0, y: 0, testValues: { 1: v } }; }

test('buildTestHistogramData — buckets values into equal-width ranges covering the data span', () => {
  const items = [{ label: 'W1', dies: [0, 10, 20, 30].map(die) }];
  const out = buildTestHistogramData(items, 1, 4);
  assert.equal(out.length, 4);
  assert.equal(out[0].rangeLow, 0);
  assert.equal(out[3].rangeHigh, 30);
  assert.equal(out.reduce((s, b) => s + b.count, 0), 4);
});

test('buildTestHistogramData — no valid values returns an empty bucket list', () => {
  const items = [{ label: 'W1', dies: [{ x: 0, y: 0, testValues: {} }] }];
  assert.deepEqual(buildTestHistogramData(items, 1), []);
});

test('buildTestHistogramData — limits expand the axis range when provided', () => {
  const items = [{ label: 'W1', dies: [10, 20].map(die) }];
  const withoutLimits = buildTestHistogramData(items, 1, 2);
  assert.equal(withoutLimits[0].rangeLow, 10);
  const withLimits = buildTestHistogramData(items, 1, 2, 0, 30);
  assert.equal(withLimits[0].rangeLow, 0);
  assert.equal(withLimits[withLimits.length - 1].rangeHigh, 30);
});

test('buildTestHistogramSeries — one series per group over shared bucket ranges', () => {
  const groups = [
    { key: 'A', items: [{ label: 'W1', dies: [0, 10].map(die) }] },
    { key: 'B', items: [{ label: 'W2', dies: [20, 30].map(die) }] },
  ];
  const out = buildTestHistogramSeries(groups, 1, 4);
  assert.equal(out.ranges.length, 4);
  assert.equal(out.series.length, 2);
  assert.equal(out.series[0].groupKey, 'A');
  assert.equal(out.series[0].counts.length, 4);
  // Shared bucket range spans every group's dies: 0..30.
  assert.equal(out.ranges[0].rangeLow, 0);
  assert.equal(out.ranges[3].rangeHigh, 30);
});

test('buildTestHistogramSeries — groups with no valid values are omitted', () => {
  const groups = [
    { key: 'A', items: [{ label: 'W1', dies: [0, 10].map(die) }] },
    { key: 'B', items: [{ label: 'W2', dies: [{ x: 0, y: 0, testValues: {} }] }] },
  ];
  const out = buildTestHistogramSeries(groups, 1, 4);
  assert.equal(out.series.length, 1);
  assert.equal(out.series[0].groupKey, 'A');
});

test('buildTestHistogramSeries — every group empty returns empty ranges/series', () => {
  const groups = [{ key: 'A', items: [{ label: 'W1', dies: [{ x: 0, y: 0, testValues: {} }] }] }];
  const out = buildTestHistogramSeries(groups, 1, 4);
  assert.deepEqual(out, { ranges: [], series: [] });
});
