import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTestHistogramData, buildTestHistogramSeries, testValueExtent } from '../dist/packages/stats/histogram.js';

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

// ── Clip outliers, faceted (code-review finding, 2026-09-09) ─────────────────
// The panel rendered a "Clip outliers" checkbox in the grouped view and the
// series builder had no way to take a clip range, so the control silently
// applied to the ungrouped branch only — in exactly the view where one wild
// reading does the most damage, compressing every group's real buckets at once.

test('buildTestHistogramSeries — clip narrows the shared range and drops outliers', () => {
  const groups = [
    { key: 'A', items: [{ label: 'W1', dies: [10, 11, 12].map(die) }] },
    { key: 'B', items: [{ label: 'W2', dies: [13, 14, 100000].map(die) }] },
  ];
  const unclipped = buildTestHistogramSeries(groups, 1, 4);
  assert.equal(unclipped.ranges[0].rangeLow, 10);
  assert.ok(unclipped.ranges[3].rangeHigh >= 100000, 'the outlier owns the axis');

  const clipped = buildTestHistogramSeries(groups, 1, 4, undefined, undefined, { lo: 10, hi: 20 });
  assert.equal(clipped.ranges[0].rangeLow, 10);
  assert.equal(clipped.ranges[3].rangeHigh, 14, 'the axis spans only the kept values');
  const total = clipped.series.reduce((n, s) => n + s.counts.reduce((a, b) => a + b, 0), 0);
  assert.equal(total, 5, 'the outlier is dropped, the other five are kept');
});

test('buildTestHistogramSeries — a group left empty by clipping is omitted, not blank', () => {
  const groups = [
    { key: 'A', items: [{ label: 'W1', dies: [10, 11].map(die) }] },
    { key: 'outliers-only', items: [{ label: 'W2', dies: [500, 900].map(die) }] },
  ];
  const clipped = buildTestHistogramSeries(groups, 1, 4, undefined, undefined, { lo: 0, hi: 20 });
  assert.deepEqual(clipped.series.map(s => s.groupKey), ['A']);
});

// ── Extent without a spread ─────────────────────────────────────────────────

test('testValueExtent — matches Math.min/max, and survives a population that would overflow a spread', () => {
  const items = [{ label: 'W1', dies: [5, 1, 9, 3].map(die) }];
  assert.deepEqual(testValueExtent(items, 1), { min: 1, max: 9 });
  assert.ok(Number.isNaN(testValueExtent(items, 999).min), 'no values measured → NaN, not Infinity');

  // 300k values: `Math.min(...values)` throws RangeError here (checked), which
  // is what killed the Insights rebuild on a real 25-wafer lot.
  const many = Array.from({ length: 300_000 }, (_, i) => die(i === 123 ? -7 : i % 1000));
  const big = [{ label: 'big', dies: many }];
  assert.throws(() => Math.min(...many.map(d => d.testValues[1])), RangeError);
  assert.deepEqual(testValueExtent(big, 1), { min: -7, max: 999 });
});
