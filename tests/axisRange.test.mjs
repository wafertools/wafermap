// Shared value-axis behaviour for the distribution panels.

import test from 'node:test';
import assert from 'node:assert/strict';
import { robustFence, shouldIncludeLimitsByDefault, resolveAxisRange }
  from '../dist/packages/canvas-adapter/charts/chartShell.js';

test('the fence sits next to the data, not next to the outlier', () => {
  // 20 readings around 10, plus one of 1e6. This is why the rule is Tukey and not
  // mean ± 3σ: σ is computed FROM the data including the outlier, so the 3σ bound
  // is dragged out to ~7e5. It may technically exclude the wild point, but an axis
  // clipped to it still spans six orders of magnitude and the real data is still a
  // single pixel — the bound is useless for the job. Quartiles never move, so the
  // Tukey fence lands just above the data where a reader needs it.
  const values = [...Array(20).keys()].map(i => 10 + i * 0.1).concat([1e6]);
  const fence = robustFence(values);
  assert.ok(fence.hi < 20, `Tukey fence must land near the data, got hi=${fence.hi}`);

  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const sd = Math.sqrt(values.reduce((a, v) => a + (v - mean) ** 2, 0) / (values.length - 1));
  assert.ok(mean + 3 * sd > 1e5,
    'the 3σ bound is dragged out by the very value it is meant to fence off');
});

test('several outliers mask a 3σ fence entirely — Tukey still excludes them', () => {
  // With more than one extreme value, σ inflates enough that mean + 3σ falls BELOW
  // them and the fence stops excluding anything at all. This is the masking
  // failure proper, and it worsens as the outliers do.
  const values = [...Array(20).keys()].map(i => 10 + i * 0.1).concat([1e6, 1.1e6, 1.2e6]);
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const sd = Math.sqrt(values.reduce((a, v) => a + (v - mean) ** 2, 0) / (values.length - 1));
  const excludedBy3Sigma = values.filter(v => v > mean + 3 * sd).length;
  assert.equal(excludedBy3Sigma, 0, 'a ±3σ fence excludes none of the three outliers');

  const fence = robustFence(values);
  assert.equal(values.filter(v => v > fence.hi).length, 3, 'Tukey excludes all three');
});

test('too few values, or zero spread, gives no fence rather than a meaningless one', () => {
  assert.equal(robustFence([1, 2, 3]), null);
  assert.equal(robustFence(Array(20).fill(5)), null);
});

test('limits are included by default only when they leave the data room', () => {
  // Tight limits around the data: including them costs nothing.
  assert.equal(shouldIncludeLimitsByDefault(9, 11, 8, 12), true);
  // Generous limits — what a capable process looks like. Including them would
  // squash the distribution into a sliver, so the default is to zoom to the data.
  assert.equal(shouldIncludeLimitsByDefault(9.9, 10.1, 0, 100), false);
  // No limits at all: nothing to include.
  assert.equal(shouldIncludeLimitsByDefault(9, 11, undefined, undefined), false);
  // Zero-variance data occupies no share of any axis; the limits are all there is.
  assert.equal(shouldIncludeLimitsByDefault(5, 5, 0, 10), true);
});

test('an off-axis limit is reported so it can be marked, not silently dropped', () => {
  const r = resolveAxisRange({ dataMin: 9, dataMax: 11, limitLow: 0, limitHigh: 100, includeLimits: false });
  assert.deepEqual(r.offAxis.map(o => o.label).sort(), ['LSL', 'USL']);
  assert.equal(r.offAxis.find(o => o.label === 'LSL').side, 'lo');
  assert.equal(r.offAxis.find(o => o.label === 'USL').side, 'hi');
  // "limits exist but are off-screen" must be distinguishable from "no limits".
  const none = resolveAxisRange({ dataMin: 9, dataMax: 11, includeLimits: false });
  assert.deepEqual(none.offAxis, []);
});

test('including the limits puts them on the axis and clears the off-axis list', () => {
  const r = resolveAxisRange({ dataMin: 9, dataMax: 11, limitLow: 0, limitHigh: 100, includeLimits: true });
  assert.equal(r.lo, 0);
  assert.equal(r.hi, 100);
  assert.deepEqual(r.offAxis, []);
});

test('clipping narrows the axis and counts what fell outside', () => {
  const values = [...Array(20).keys()].map(i => 10 + i * 0.1).concat([1e6]);
  const r = resolveAxisRange({
    dataMin: Math.min(...values), dataMax: Math.max(...values),
    includeLimits: false, clipOutliers: true, values,
  });
  assert.ok(r.hi < 100, 'the axis excludes the wild value');
  assert.equal(r.clippedCount, 1, 'and says so, so the reader knows the view is partial');
});

test('clipping never widens past the data, and limits still win when included', () => {
  const values = [...Array(20).keys()].map(i => 10 + i * 0.1);
  const r = resolveAxisRange({
    dataMin: 10, dataMax: 11.9, limitLow: 0, limitHigh: 100,
    includeLimits: true, clipOutliers: true, values,
  });
  // An explicit "include limits" is a user instruction; clipping must not override it.
  assert.equal(r.lo, 0);
  assert.equal(r.hi, 100);
  assert.equal(r.clippedCount, 0);
});
