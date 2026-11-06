// What a wafer opened from an Insights chart starts in. The bug this guards: a bar on a chart that names no test opened
// the wafer in the gallery's lot-stacked mode, which has nothing to draw for one wafer, so every die was grey.

import test from 'node:test';
import assert from 'node:assert/strict';
import { waferOpenMode } from '../dist/packages/canvas-adapter/openWaferMode.js';

test('a chart that names a test leaves the mode to the host, which opens the wafer on that test', () => {
  for (const mode of [undefined, 'hardBin', 'value', 'stackedValues', 'stackedBins']) assert.equal(waferOpenMode(mode, undefined, 1000), undefined);
  assert.equal(waferOpenMode('stackedValues', undefined, 1000, 'bins'), undefined);
});

test('a yield bar opens the bins, whatever the gallery shows', () => {
  for (const mode of [undefined, 'hardBin', 'softBin', 'value', 'stackedValues', 'stackedBins', 'metadata']) assert.equal(waferOpenMode(mode, 1000, undefined, 'bins'), 'hardBin');
});

test('a lot-stacked mode opens as the same kind of measure on one wafer', () => {
  assert.equal(waferOpenMode('stackedValues', 1050, undefined), 'value', 'the gallery has a test picked');
  assert.equal(waferOpenMode('stackedValues', undefined, undefined), 'hardBin', 'no single test to show: the bins, never "Test 0"');
  assert.equal(waferOpenMode('stackedBins', undefined, undefined), 'hardBin');
  assert.equal(waferOpenMode('stackedSoftBins', undefined, undefined), 'softBin');
});

test('a gallery in a mode that describes one wafer is left as it is', () => {
  for (const mode of [undefined, 'hardBin', 'softBin', 'value', 'metadata']) assert.equal(waferOpenMode(mode, 1000, undefined), undefined);
});
