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

test('median and mean: written, read back and kept in a plots file', () => {
  const refs = parseReferences('median, mean Lot mean, 0.4').value;
  assert.deepEqual(refs, [{ stat: 'median' }, { stat: 'mean', label: 'Lot mean' }, { at: 0.4 }]);
  assert.equal(formatReferences(refs), 'median, mean Lot mean, 0.4');
  const plot = { id: 'p', chart: 'bar', fields: {}, axes: { y: { references: [...refs, { stat: 'mode' }] } } };
  const back = readPlotsFile(writePlotsFile([plot]));
  assert.deepEqual(back.plots[0].axes.y.references, refs);
  assert.match(back.warnings.join(' '), /or median or mean, left out/);
});

test('a median or mean line is worked out over what the plot draws, the same on every panel', async () => {
  const { resolvePlot } = await import('../dist/packages/stats/plotData.js');
  const { buildWaferMap } = await import('../dist/index.js');
  const item = (label, shift, split) => {
    const r = buildWaferMap({ results: Array.from({ length: 20 }, (_, k) => ({ x: k % 5, y: Math.floor(k / 5), hbin: 1, testValues: { 1: k + shift } })),
      waferConfig: { diameter: 30, metadata: { split } }, dieConfig: { width: 2, height: 2 }, passBins: [1], testDefs: [{ testNumber: 1, name: 'V' }] });
    return { label, dies: r.dies, metadata: r.metadata, passBins: [1], ringCount: r.ringCount, wafer: r.wafer };
  };
  const items = [item('W1', 0, 'A'), item('W2', 10, 'A'), item('W3', 40, 'B')];
  const bar = { id: 'p', chart: 'bar', fields: { x: { builtin: 'wafer' }, y: { test: 1 }, color: { none: true } }, axes: { y: { references: [{ stat: 'median' }, { stat: 'mean', label: 'avg' }, { at: 5 }] } } };
  const r = resolvePlot(bar, items, { testDefs: [{ testNumber: 1, name: 'V' }] });
  // Wafer means 9.5, 19.5, 49.5: median 19.5, mean 26.17.
  assert.deepEqual(r.y.references.map(x => [x.label, +x.at.toFixed(2)]), [['median', 19.5], ['avg', 26.17], [undefined, 5]]);
  const faceted = resolvePlot({ ...bar, fields: { ...bar.fields, facet: { meta: 'split' } } }, items, { testDefs: [{ testNumber: 1, name: 'V' }] });
  for (const f of faceted.facets) assert.equal(f.plot.y.references[0].at, 19.5, 'the whole plot\'s median on each panel');
});

test('bar value labels are a plot setting that survives a round trip', () => {
  const back = readPlotsFile(writePlotsFile([{ id: 'p', chart: 'bar', fields: {}, valueLabels: true }, { id: 'q', chart: 'bar', fields: {}, valueLabels: 'yes' }]));
  assert.equal(back.plots[0].valueLabels, true);
  assert.equal(back.plots[1].valueLabels, undefined);
});

test('orientation is a box or bar setting that survives a round trip', () => {
  const back = readPlotsFile(writePlotsFile([{ id: 'p', chart: 'bar', fields: {}, orientation: 'horizontal' }, { id: 'q', chart: 'box', fields: {}, orientation: 'sideways' }]));
  assert.equal(back.plots[0].orientation, 'horizontal');
  assert.equal(back.plots[1].orientation, undefined);
  assert.match(back.warnings.join(' '), /orientation: "sideways" is not vertical or horizontal/);
});

test('a clipped axis draws the robust range over the whole plot, counts what lies outside, and keeps every value in the statistics', async () => {
  const { resolvePlot } = await import('../dist/packages/stats/plotData.js');
  const { buildWaferMap } = await import('../dist/index.js');
  const values = Array.from({ length: 40 }, (_, k) => (k === 39 ? 1000 : 10 + (k % 10) * 0.1));
  const r0 = buildWaferMap({ results: values.map((v, k) => ({ x: k % 8, y: Math.floor(k / 8), hbin: 1, testValues: { 1: v } })),
    waferConfig: { diameter: 40 }, dieConfig: { width: 2, height: 2 }, passBins: [1], testDefs: [{ testNumber: 1, name: 'V' }] });
  const items = [{ label: 'W1', dies: r0.dies, passBins: [1], ringCount: r0.ringCount, wafer: r0.wafer }];
  const spec = { id: 'h', chart: 'histogram', fields: { y: { test: 1 }, color: { none: true } }, axes: { x: { clip: true } } };
  const r = resolvePlot(spec, items, { testDefs: [{ testNumber: 1, name: 'V' }] });
  assert.ok(r.x.clip && r.x.clip.hi < 1000 && r.x.clip.lo >= 10, JSON.stringify(r.x.clip));
  assert.equal(r.x.clip.outside, 1);
  assert.match(r.notes.join(' '), /1 value outside it, still counted/);
  const plain = resolvePlot({ ...spec, axes: undefined }, items, { testDefs: [{ testNumber: 1, name: 'V' }] });
  assert.equal(plain.x.clip, undefined);
  const back = readPlotsFile(writePlotsFile([{ ...spec, axes: { x: { clip: true, includeLimits: false } } }, { ...spec, axes: { x: { clip: 'yes' } } }]));
  assert.deepEqual(back.plots[0].axes.x, { clip: true, includeLimits: false });
  assert.equal(back.plots[1].axes.x.clip, undefined);
});
