// Shared value-axis behaviour for the distribution panels.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  robustFence, shouldIncludeLimitsByDefault, resolveAxisRange, limitLabelSide,
  limitLines, limitExtent, hasBothLimitKinds, stackLabelRows,
} from '../dist/packages/canvas-adapter/charts/chartShell.js';

/** A test's test limits, as the limit lines a chart draws. */
const testLimits = (lo, hi) => limitLines({ limitLow: lo, limitHigh: hi }, 'test');

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
  const r = resolveAxisRange({ dataMin: 9, dataMax: 11, limits: testLimits(0, 100), includeLimits: false });
  assert.deepEqual(r.offAxis.map(o => o.label).sort(), ['Hi limit', 'Lo limit']);
  assert.equal(r.offAxis.find(o => o.label === 'Lo limit').side, 'lo');
  assert.equal(r.offAxis.find(o => o.label === 'Hi limit').side, 'hi');
  // "limits exist but are off-screen" must be distinguishable from "no limits".
  const none = resolveAxisRange({ dataMin: 9, dataMax: 11, includeLimits: false });
  assert.deepEqual(none.offAxis, []);
});

test('including the limits puts them on the axis and clears the off-axis list', () => {
  const r = resolveAxisRange({ dataMin: 9, dataMax: 11, limits: testLimits(0, 100), includeLimits: true });
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
    dataMin: 10, dataMax: 11.9, limits: testLimits(0, 100),
    includeLimits: true, clipOutliers: true, values,
  });
  // An explicit "include limits" is a user instruction; clipping must not override it.
  assert.equal(r.lo, 0);
  assert.equal(r.hi, 100);
  assert.equal(r.clippedCount, 0);
});

// ── limitLabelSide ───────────────────────────────────────────────────────────
//
// Which side of its own dashed rule a spec-limit label sits on. Reported by a
// user as reading wrong: the label was placed INWARD (LSL right of its line,
// USL left) purely so it could not fall off the plot, and that put each label
// in the in-spec region — reading as a label for the data rather than for the
// boundary it marks. Semantics now win, and the edge case is handled by a flip
// rather than by giving up the meaning.
test('limitLabelSide — LSL sits left of its line, USL right, when there is room', () => {
  // Limits mid-plot: both have space on their meaningful side.
  assert.equal(limitLabelSide(500, 24, 100, 900, true), -1, 'LSL → left');
  assert.equal(limitLabelSide(500, 24, 100, 900, false), 1, 'USL → right');
});

test('limitLabelSide — flips only when the label would not fit on its own side', () => {
  // LSL 10px from the left edge cannot take a 24px label to its left.
  assert.equal(limitLabelSide(110, 24, 100, 900, true), 1, 'LSL flips inward at the edge');
  // USL 10px from the right edge, likewise.
  assert.equal(limitLabelSide(890, 24, 100, 900, false), -1, 'USL flips inward at the edge');
});

test('limitLabelSide — a label that exactly fits is not flipped', () => {
  // x - pad - textWidth === plotLeft is a fit, not an overflow: an off-by-one
  // here would flip labels that had room, which is the defect being fixed.
  assert.equal(limitLabelSide(127, 24, 100, 900, true), -1);
  assert.equal(limitLabelSide(873, 24, 100, 900, false), 1);
});

// ── Limit lines: test and spec limits ───────────────────────────────────────

const both = { limitLow: 1, limitHigh: 9, specLow: 0, specHigh: 10 };

test('limitLines — both kinds by default, each labelled as its own kind', () => {
  assert.deepEqual(limitLines(both).map(l => `${l.kind}:${l.end}:${l.label}:${l.value}`), [
    'test:lo:Lo limit:1', 'test:hi:Hi limit:9', 'spec:lo:LSL:0', 'spec:hi:USL:10',
  ]);
  assert.deepEqual(limitLines(both, 'test').map(l => l.label), ['Lo limit', 'Hi limit']);
  assert.deepEqual(limitLines(both, 'spec').map(l => l.label), ['LSL', 'USL']);
  assert.deepEqual(limitLines(both, 'none'), []);
});

test('limitLines — a test without the chosen kind still shows the kind it has', () => {
  // Choosing spec limits for one test must not make another test look unlimited.
  assert.deepEqual(limitLines({ limitLow: 1, limitHigh: 9 }, 'spec').map(l => l.label), ['Lo limit', 'Hi limit']);
  assert.deepEqual(limitLines({ specLow: 0 }, 'test').map(l => l.label), ['LSL']);
  assert.deepEqual(limitLines(undefined), []);
});

test('hasBothLimitKinds — true only when a test has at least one limit of each kind', () => {
  assert.equal(hasBothLimitKinds(both), true);
  assert.equal(hasBothLimitKinds({ limitHigh: 9, specLow: 0 }), true);
  assert.equal(hasBothLimitKinds({ limitLow: 1, limitHigh: 9 }), false);
  assert.equal(hasBothLimitKinds(undefined), false);
});

test('limitExtent and the axis cover every line drawn, of either kind', () => {
  assert.deepEqual(limitExtent(limitLines(both)), { lo: 0, hi: 10 });
  const r = resolveAxisRange({ dataMin: 4, dataMax: 6, limits: limitLines(both), includeLimits: true });
  assert.equal(r.lo, 0);
  assert.equal(r.hi, 10);
  const off = resolveAxisRange({ dataMin: 4, dataMax: 6, limits: limitLines(both), includeLimits: false });
  assert.deepEqual(off.offAxis.map(o => `${o.label}:${o.side}`).sort(), ['Hi limit:hi', 'LSL:lo', 'Lo limit:lo', 'USL:hi']);
});

test('stackLabelRows — labels that do not overlap stay on row 0; overlapping ones stack', () => {
  assert.deepEqual(stackLabelRows([{ start: 0, end: 10 }, { start: 20, end: 30 }]), [0, 0]);
  assert.deepEqual(stackLabelRows([{ start: 0, end: 10 }, { start: 5, end: 15 }, { start: 8, end: 18 }]), [0, 1, 2]);
  // Input order is preserved in the result, whatever order the spans arrive in.
  assert.deepEqual(stackLabelRows([{ start: 5, end: 15 }, { start: 0, end: 10 }]), [1, 0]);
  // A freed row is reused rather than always opening a new one.
  assert.deepEqual(stackLabelRows([{ start: 0, end: 10 }, { start: 5, end: 15 }, { start: 20, end: 30 }]), [0, 1, 0]);
});

// ── Gridline colour ─────────────────────────────────────────────────────────

test('withAlpha — scales the opacity of every colour form a computed token holds', async () => {
  const { withAlpha } = await import('../dist/packages/canvas-adapter/charts/chartShell.js');
  assert.equal(withAlpha('#808080', 0.4), 'rgba(128, 128, 128, 0.4)');
  assert.equal(withAlpha('#fff', 0.5), 'rgba(255, 255, 255, 0.5)');
  assert.equal(withAlpha('#00000080', 0.5), 'rgba(0, 0, 0, 0.251)');
  assert.equal(withAlpha('rgb(10, 20, 30)', 0.4), 'rgba(10, 20, 30, 0.4)');
  assert.equal(withAlpha('rgba(0, 0, 0, 0.12)', 0.5), 'rgba(0, 0, 0, 0.06)');
  assert.equal(withAlpha('rgb(10 20 30 / 50%)', 0.5), 'rgba(10, 20, 30, 0.25)');
  // Anything else is returned unchanged rather than guessed at.
  assert.equal(withAlpha('var(--x)', 0.4), 'var(--x)');
});
