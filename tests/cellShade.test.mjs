// The shades behind table cells (canvas-adapter/cellShade.ts): four rules, translucent so a table can be light or dark.

import test from 'node:test';
import assert from 'node:assert/strict';
import { signedShade, shadesAmong, shortfallShade, capabilityShade, outOfLimitsShade } from '../dist/packages/canvas-adapter/cellShade.js';

test('a value among its peers is blue below, warm above, stronger the further it is, and nothing at the average', () => {
  assert.equal(signedShade(0), undefined);
  assert.equal(signedShade(0.03), undefined, 'too close to the average to say anything');
  assert.equal(signedShade(NaN), undefined);
  assert.equal(signedShade(-1), 'rgba(0, 114, 178, 0.42)', 'Okabe-Ito blue at full strength');
  assert.equal(signedShade(1), 'rgba(213, 94, 0, 0.42)', 'Okabe-Ito vermillion');
  assert.equal(signedShade(0.5), 'rgba(213, 94, 0, 0.21)', 'half as far, half as strong');
  assert.equal(signedShade(9), signedShade(1), 'held at the ends');
});

test('the shades among a set are measured from its mean, over its largest deviation', () => {
  assert.deepEqual(shadesAmong([1, 2, 3]), ['rgba(0, 114, 178, 0.42)', undefined, 'rgba(213, 94, 0, 0.42)']);
  assert.deepEqual(shadesAmong([5]), [undefined], 'one value has no peers');
  assert.deepEqual(shadesAmong([4, 4, 4]), [undefined, undefined, undefined], 'equal values say nothing');
  assert.deepEqual(shadesAmong([1, NaN, 3]), ['rgba(0, 114, 178, 0.42)', undefined, 'rgba(213, 94, 0, 0.42)'], 'a missing value is left out and left unshaded');
});

test('a yield is tinted only when it falls short of its reference, by the summary report\'s rule', () => {
  assert.equal(shortfallShade(0), undefined, 'at the reference: nothing');
  assert.equal(shortfallShade(3), undefined, 'above it: nothing, so a lot with nothing wrong has no tint');
  assert.equal(shortfallShade(-0.5), undefined, 'under a point short: nothing');
  assert.equal(shortfallShade(-1), 'rgba(190, 60, 60, 0.1)', 'a point short: light');
  assert.equal(shortfallShade(-2), 'rgba(190, 60, 60, 0.2)', 'two points: medium');
  assert.equal(shortfallShade(-4), 'rgba(190, 60, 60, 0.32)', 'four points: strong');
  assert.equal(shortfallShade(-30), shortfallShade(-4), 'and no stronger');
  assert.equal(shortfallShade(null), undefined);
  assert.equal(shortfallShade(undefined), undefined);
});

test('a Ppk is capable, marginal or poor in the capability chart\'s colours; limits breached are warm', () => {
  assert.equal(capabilityShade(1.5), 'rgba(0, 158, 115, 0.30)');
  assert.equal(capabilityShade(1.1), 'rgba(230, 159, 0, 0.30)');
  assert.equal(capabilityShade(0.5), 'rgba(213, 94, 0, 0.30)');
  assert.equal(capabilityShade(null), undefined);
  assert.equal(outOfLimitsShade(), 'rgba(213, 94, 0, 0.30)');
});

test('values the table prints the same are not told apart by colour', () => {
  const show = v => v.toFixed(2);
  assert.deepEqual(shadesAmong([1.8001, 1.8004, 1.8002], show), [undefined, undefined, undefined]);
  assert.equal(shadesAmong([1.8, 1.9, 2.0], show)[0], 'rgba(0, 114, 178, 0.42)', 'values that print differently are shaded as before');
});

test('a spread of under 1% of the mean is not coloured, even where the numbers print differently', () => {
  assert.deepEqual(shadesAmong([1.80, 1.81, 1.805]), [undefined, undefined, undefined]);
  assert.equal(shadesAmong([1.8, 1.9, 2.0])[0], 'rgba(0, 114, 178, 0.42)');
});
