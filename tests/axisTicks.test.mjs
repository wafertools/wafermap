// Tick positions and tick-label precision — one rule for every numeric axis.
//
// The rules under test:
//  - ticks sit on round multiples of a 1-2-5 step, inside the data range
//  - a tick label carries exactly the decimals its step needs: a coarse axis
//    gets none ("2 4 6 8"), a fine one gets enough to tell ticks apart
//  - an axis-end data value gets one more decimal, so it never rounds past the data
//  - formatting with no step (a lone value, e.g. a die label) is unchanged

import test from 'node:test';
import assert from 'node:assert/strict';
import { niceStep, fitTicks, stepDecimals } from '../dist/packages/renderer/axisTicks.js';
import { fmtColorbarAxis } from '../dist/packages/renderer/fmt.js';

test('niceStep rounds to the nearest 1, 2 or 5 × 10ⁿ', () => {
  assert.equal(niceStep(1.2), 1);
  assert.equal(niceStep(2.9), 2);
  assert.equal(niceStep(6), 5);
  assert.equal(niceStep(8), 10);
  assert.equal(niceStep(0.0023), 0.002);
  assert.equal(niceStep(0), 0, 'a zero span has no step');
});

test('stepDecimals shows every multiple of the step exactly', () => {
  assert.equal(stepDecimals(2), 0);
  assert.equal(stepDecimals(20), 0);
  assert.equal(stepDecimals(0.5), 1);
  assert.equal(stepDecimals(0.25), 2);
  assert.equal(stepDecimals(0.002), 3);
  assert.equal(stepDecimals(0.1 + 0.2 - 0.2), 1, 'floating noise does not add digits');
});

test('fitTicks puts round values inside the range, never beyond it', () => {
  const { ticks, step } = fitTicks(1.03, 9.87, 400, () => 90);
  assert.equal(step, 2);
  assert.deepEqual(ticks, [2, 4, 6, 8]);
  const fine = fitTicks(0.1, 0.7, 600, () => 60);
  assert.deepEqual(fine.ticks, [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7], 'accumulated float error is snapped back onto the grid');
});

test('tick density comes from the space, not a fixed count', () => {
  // The regression: a fixed target of four ticks on a 200 px box plot rounded
  // the step up to 0.2 and left 1.0 / 1.2 / 1.4 on data spanning 0.863–1.56 —
  // fewer ticks than the unrounded five it replaced. A "1.0"-wide label (~16 px)
  // with the 8 px gap needs ~24 px, so 200 px holds a 0.1 step.
  const { ticks, step } = fitTicks(0.863, 1.56, 200, () => 24);
  assert.equal(step, 0.1);
  assert.deepEqual(ticks, [0.9, 1.0, 1.1, 1.2, 1.3, 1.4, 1.5]);
  assert.ok(ticks.length >= 5, 'at least the density of the axis it replaced');
});

test('the step is the finest whose labels fit, and coarsens only when they do not', () => {
  const wide = fitTicks(0, 100, 800, () => 40);
  const narrow = fitTicks(0, 100, 120, () => 40);
  assert.ok(wide.step < narrow.step);
  assert.ok((wide.step / 100) * 800 >= 40 && (narrow.step / 100) * 120 >= 40, 'both respect the spacing');
  // The finest fitting step: one rung finer would not fit.
  assert.equal(wide.step, 5);
});

test('a 1–10 axis needs no decimals', () => {
  const { tickFmt } = fmtColorbarAxis(10, 'T', 'V', 'engineering', 2);
  assert.deepEqual([2, 4, 6, 8].map(tickFmt), ['2', '4', '6', '8']);
});

test('a bandgap-scale axis gets enough decimals to tell its ticks apart', () => {
  // Before: every label read "1.20", which draws a sloped curve as a flat line.
  const { tickFmt, axisLabel } = fmtColorbarAxis(1.205, 'Vbg', 'V', 'engineering', 0.002);
  const labels = [1.196, 1.198, 1.200, 1.202, 1.204].map(tickFmt);
  assert.deepEqual(labels, ['1.196', '1.198', '1.200', '1.202', '1.204']);
  assert.equal(new Set(labels).size, labels.length, 'every tick distinct');
  assert.equal(axisLabel, 'Vbg (V)');
});

test('the step is read in the axis scale, not the base unit', () => {
  // 0–500 mV in 100 mV steps: the scale is milli, so the step is 100 → no decimals.
  const { tickFmt, axisLabel } = fmtColorbarAxis(0.5, null, 'V', 'engineering', 0.1);
  assert.deepEqual([0.1, 0.2, 0.3].map(tickFmt), ['100', '200', '300']);
  assert.equal(axisLabel, 'mV');
});

test('an axis-end data value never rounds past the data', () => {
  const { tickFmt, edgeFmt } = fmtColorbarAxis(10, 'T', 'V', 'engineering', 2);
  assert.equal(tickFmt(9.87), '10', 'the tick precision alone would overstate the maximum');
  assert.equal(edgeFmt(9.87), '9.9');
  assert.equal(edgeFmt(8), '8', 'a trailing zero is dropped again');
});

test('without a step, formatting is unchanged — the rule for a lone value', () => {
  const { tickFmt } = fmtColorbarAxis(0.001, 'Idsat', 'A');
  assert.equal(tickFmt(0.00123), '1.23');
  const unitless = fmtColorbarAxis(5, 'x', undefined);
  assert.equal(unitless.tickFmt(1.198), '1.198');
});
