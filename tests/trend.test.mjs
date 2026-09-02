// Wafer-to-wafer trend builder — the Insights suite's drift view.
//
// The distinguishing property versus boxplot: items are returned in the order
// given, never sorted. Slot order IS the signal (a bad cassette position, a tool
// warming up); sorting by value destroys exactly what the chart exists to show.

import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTestTrendData, trendCentre } from '../dist/packages/stats/trend.js';

const die = (v) => ({ x: 0, y: 0, testValues: v === null ? {} : { 1050: v } });

test('one point per item, in the order given — never sorted', () => {
  const items = [
    { label: 'W03', dies: [die(9), die(9)] },
    { label: 'W01', dies: [die(1), die(1)] },
    { label: 'W02', dies: [die(5), die(5)] },
  ];
  const data = buildTestTrendData(items, 1050);
  assert.deepEqual(data.map(d => d.label), ['W03', 'W01', 'W02'],
    'input order is preserved — sorting would destroy the slot sequence');
  assert.deepEqual(data.map(d => d.mean), [9, 1, 5]);
});

test('mean, sample stddev (ddof=1) and count per item', () => {
  const data = buildTestTrendData([{ label: 'W1', dies: [die(2), die(4), die(6)] }], 1050);
  assert.equal(data[0].mean, 4);
  assert.equal(data[0].count, 3);
  // ddof=1: sqrt(((2-4)²+(4-4)²+(6-4)²)/2) = sqrt(4) = 2
  assert.equal(data[0].stddev, 2);
});

test('a single value gives stddev 0, not NaN', () => {
  const data = buildTestTrendData([{ label: 'W1', dies: [die(7)] }], 1050);
  assert.equal(data[0].mean, 7);
  assert.equal(data[0].stddev, 0);
  assert.equal(data[0].count, 1);
});

test('an item with no values keeps its place in the sequence', () => {
  const items = [
    { label: 'W1', dies: [die(1)] },
    { label: 'W2', dies: [die(null)] },
    { label: 'W3', dies: [die(3)] },
  ];
  const data = buildTestTrendData(items, 1050);
  assert.equal(data.length, 3, 'dropping it would silently close the gap');
  assert.equal(data[1].count, 0);
  assert.ok(Number.isNaN(data[1].mean));
});

test('precomputed perTestStats are used instead of rescanning dies', () => {
  const data = buildTestTrendData([{
    label: 'W1',
    dies: [die(1), die(1)],
    testStats: [{ testNumber: 1050, mean: 99, stddev: 3, count: 500 }],
  }], 1050);
  assert.equal(data[0].mean, 99, 'the precomputed value wins, proving the fast path');
  assert.equal(data[0].count, 500);
});

test('partial and edge-excluded dies are excluded, matching every other per-test stat', () => {
  const items = [{
    label: 'W1',
    dies: [die(10), { ...die(1000), partial: true }, { ...die(1000), edgeExcluded: true }],
  }];
  const data = buildTestTrendData(items, 1050);
  assert.equal(data[0].count, 1);
  assert.equal(data[0].mean, 10);
});

test('trendCentre is die-weighted, not a mean of per-wafer means', () => {
  const data = [
    { label: 'W1', mean: 10, stddev: 0, count: 90 },
    { label: 'W2', mean: 20, stddev: 0, count: 10 },
  ];
  // Mean-of-means would be 15; the pooled mean is (10×90 + 20×10)/100 = 11.
  assert.equal(trendCentre(data), 11);
});

test('trendCentre ignores items with no data, and is null when nothing has any', () => {
  assert.equal(trendCentre([
    { label: 'W1', mean: 4, stddev: 0, count: 2 },
    { label: 'W2', mean: NaN, stddev: 0, count: 0 },
  ]), 4);
  assert.equal(trendCentre([{ label: 'W1', mean: NaN, stddev: 0, count: 0 }]), null);
});

test('the key is carried through for click-to-open', () => {
  const data = buildTestTrendData([{ label: 'W1', key: 7, dies: [die(1)] }], 1050);
  assert.equal(data[0].key, 7);
});
