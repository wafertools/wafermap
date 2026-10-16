// Reference lines and bands the reader puts on a value axis (stats/plotReferences.ts, plotSpec.ts).

import test from 'node:test';
import assert from 'node:assert/strict';
import { parseReferences, formatReferences } from '../dist/packages/stats/plotReferences.js';
import { readPlotsFile, writePlotsFile, PLOTS_FORMAT, PLOTS_VERSION, PLOT_REFERENCES_MAX } from '../dist/packages/stats/plotSpec.js';

test('a number is a line, lo..hi a band, words after it a name; either order of a band is accepted', () => {
  assert.deepEqual(parseReferences('0.45 Target, 0.5..0.3 Window; -2e-3').value, [
    { at: 0.45, label: 'Target' }, { at: 0.3, to: 0.5, label: 'Window' }, { at: -0.002 },
  ]);
  assert.deepEqual(parseReferences('').value, []);
});

test('text that is not a reference is refused with the entry named', () => {
  assert.match(parseReferences('target 0.4').error, /"target 0.4"/);
  assert.match(parseReferences('0.4..0.4').error, /two different values/);
  assert.match(parseReferences(Array.from({ length: PLOT_REFERENCES_MAX + 1 }, (_, i) => i).join(',')).error, /At most 8/);
});

test('formatting is the inverse of parsing', () => {
  const refs = [{ at: 0.45, label: 'Target' }, { at: 0.3, to: 0.5, label: 'Window' }, { at: 12 }];
  assert.equal(formatReferences(refs), '0.45 Target, 0.3..0.5 Window, 12');
  assert.deepEqual(parseReferences(formatReferences(refs)).value, refs);
});

test('references round-trip through a plots file; a bad entry is dropped with a reason and the file version stays', () => {
  const plot = { id: 'p', chart: 'scatter', fields: { x: { test: 1 }, y: { test: 2 } }, axes: { y: { references: [{ at: 1, label: 'Target' }, { at: 2, to: 3 }] } } };
  const back = readPlotsFile(writePlotsFile([plot]));
  assert.deepEqual(back.warnings, []);
  assert.deepEqual(back.plots[0].axes.y.references, plot.axes.y.references);
  const bad = readPlotsFile(JSON.stringify({ format: PLOTS_FORMAT, version: PLOTS_VERSION, plots: [{ ...plot, axes: { y: { references: [{ at: 'x' }, { at: 1, to: 1 }, { at: 5 }] } } }] }));
  assert.deepEqual(bad.plots[0].axes.y.references, [{ at: 5 }]);
  assert.equal(bad.warnings.length, 2);
  assert.equal(PLOTS_VERSION, 1);
});
