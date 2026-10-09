// The plot mode a Summary-panel finding is shown in, shared by the single map and the gallery. A finding
// that is not about one bin keeps the map's bin mode, and never switches it to a bin type the data lacks:
// a soft-bin-only lot switched to hard bins draws every die as no data.

import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>');
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.HTMLElement = dom.window.HTMLElement;
const { findingPlotMode } = await import('../dist/packages/canvas-adapter/renderWaferMap.js');

const finding = (kind) => ({ variable: { kind, ...(kind.endsWith('Bin') ? { bin: 3 } : {}) } });

test('a bin finding takes its own bin type', () => {
  assert.equal(findingPlotMode(finding('softBin'), 'hardBin', true), 'softBin');
  assert.equal(findingPlotMode(finding('hardBin'), 'softBin', true), 'hardBin');
});

test('a pattern or yield finding keeps the bin mode the map is in', () => {
  assert.equal(findingPlotMode(finding('spatialPattern'), 'softBin', true), 'softBin');
  assert.equal(findingPlotMode(finding('yield'), 'hardBin', true), 'hardBin');
});

test('from another mode it takes a bin type the dies carry', () => {
  assert.equal(findingPlotMode(finding('spatialPattern'), 'value', false), 'softBin', 'soft bins only: never hard');
  assert.equal(findingPlotMode(finding('yield'), 'stackedValues', true), 'hardBin');
});
