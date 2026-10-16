// Panels (stats/plotData.ts `fields.facet`): one plot per value of a field, on the whole plot's colours and axis ranges,
// with every unit naming a wafer of the population, and rescaling measured over the whole population.

import test from 'node:test';
import assert from 'node:assert/strict';
import { buildWaferMap } from '../dist/index.js';
import { resolvePlot, plotFootnote, plotTitle } from '../dist/packages/stats/plotData.js';
import { readPlotsFile, writePlotsFile, PLOTS_FORMAT, PLOTS_VERSION } from '../dist/packages/stats/plotSpec.js';

const DEFS = [
  { testNumber: 1050, name: 'Vth', unit: 'V' },
  { testNumber: 1060, name: 'Idsat', unit: 'A' },
];
function wafer(label, { n = 36, vth0 = 0.4, meta = {} } = {}) {
  const r = buildWaferMap({
    results: Array.from({ length: n }, (_, k) => ({ x: k % 6, y: Math.floor(k / 6), hbin: 1, testValues: { 1050: vth0 + k / 100, 1060: k + 1 } })),
    waferConfig: { diameter: 10, metadata: meta }, dieConfig: { width: 1, height: 1 }, passBins: [1], testDefs: DEFS,
  });
  return { label, dies: r.dies, metadata: r.metadata, passBins: [1], ringCount: r.ringCount, wafer: r.wafer };
}
const lot = () => [
  wafer('W1', { vth0: 0.40, meta: { split: 'TT' } }),
  wafer('W2', { vth0: 0.45, meta: { split: 'FF' } }),
  wafer('W3', { vth0: 0.50, meta: { split: 'TT' } }),
];
const ctx = { testDefs: DEFS };
const spec = (chart, fields, over = {}) => ({ id: 'p', chart, fields, ...over });

test('panels by a wafer field: whole wafers per panel, units naming the population’s wafers, colours shared', () => {
  const items = lot();
  const r = resolvePlot(spec('box', { x: { builtin: 'wafer' }, y: { test: 1050 }, facet: { meta: 'split' } }), items, ctx);
  assert.deepEqual(r.issues, []);
  assert.deepEqual(r.facets.map(f => f.label), ['FF', 'TT']);
  const [ff, tt] = r.facets.map(f => f.plot);
  assert.deepEqual(ff.marks.categories, ['W2']);
  assert.deepEqual(tt.marks.categories, ['W1', 'W3']);
  assert.deepEqual(ff.groups, r.groups, 'every panel on the whole plot’s colours');
  assert.deepEqual(ff.marks.categoryItems, [1], 'W2 is wafer 1 of the population, not wafer 0 of its panel');
  const u = ff.marks.cellUnits.flat(2)[0];
  assert.equal(ff.marks.unit(u).item, 1);
  assert.ok(items[1].dies.includes(ff.marks.unit(u).die));
  assert.deepEqual(ff.y.extent, tt.y.extent, 'one value range for every panel');
  assert.equal(ff.population.wafers, 1);
  assert.equal(plotTitle(r), 'Vth by Wafer · panels by Split');
  assert.match(plotFootnote(r), /3 wafers · 108 dies.*2 panels by split, on shared axes/);
});

test('panels by a die field: each panel the dies in that region, together every die once', () => {
  const r = resolvePlot(spec('histogram', { y: { test: 1050 }, color: { none: true }, facet: { builtin: 'ring' } }), lot(), ctx);
  assert.deepEqual(r.issues, []);
  assert.ok(r.facets.length >= 2);
  assert.deepEqual(r.facets.map(f => f.label), [...r.facets.map(f => f.label)].sort());
  const total = r.facets.reduce((n, f) => n + f.plot.population.dies, 0);
  assert.equal(total, 108);
  assert.ok(r.facets.every(f => f.plot.x.extent[0] === r.facets[0].plot.x.extent[0]));
  assert.match(resolvePlot(spec('bar', { x: { meta: 'split' }, y: { test: 1050 }, facet: { builtin: 'ring' } }, { level: 'wafer' }), lot(), ctx).issues.join(),
    /Ring is per die, so it cannot divide a plot with one mark per wafer into panels/);
});

test('Test panels: one panel per test of a set, rescaled over the whole population', () => {
  const r = resolvePlot(spec('box', { x: { meta: 'split' }, y: { tests: [1050, 1060] }, facet: { builtin: 'test' } }, { normalize: 'zscore' }), lot(), ctx);
  assert.deepEqual(r.issues, []);
  assert.deepEqual(r.facets.map(f => f.label), ['Vth', 'Idsat']);
  assert.match(r.facets[0].plot.y.label, /Vth \(z-score\)/);
  assert.match(resolvePlot(spec('box', { y: { test: 1050 }, facet: { builtin: 'test' } }), lot(), ctx).issues.join(), /Test panels need several tests/);
});

test('rescaling in panels is the whole plot’s: a split’s panel is not re-centred on itself', () => {
  const r = resolvePlot(spec('histogram', { y: { test: 1050 }, color: { none: true }, facet: { meta: 'split' } }, { normalize: 'zscore' }), lot(), ctx);
  const ff = r.facets.find(f => f.label === 'FF').plot.marks.values.flat();
  const mean = ff.reduce((a, b) => a + b, 0) / ff.length;
  assert.ok(Math.abs(mean) < 0.2, 'FF sits in the middle of the lot');
  const tt = r.facets.find(f => f.label === 'TT').plot.marks.values.flat();
  assert.ok(Math.abs(tt.reduce((a, b) => a + b, 0) / tt.length) < 0.2);
  // W1 (low) and W3 (high) make TT wide; on its own scale it would have SD 1, on the lot's it is wider than FF.
  const sd = v => Math.sqrt(v.reduce((a, b) => a + b * b, 0) / v.length);
  assert.ok(sd(tt) > sd(ff));
});

test('a facet field already on X or the colour, or with too many values, is refused with the reason', () => {
  assert.match(resolvePlot(spec('box', { x: { meta: 'split' }, y: { test: 1050 }, facet: { meta: 'split' } }), lot(), ctx).issues.join(), /Split divides the panels/);
  const many = Array.from({ length: 25 }, (_, i) => wafer(`W${i}`));
  assert.match(resolvePlot(spec('histogram', { y: { test: 1050 }, facet: { builtin: 'wafer' } }), many, ctx).issues.join(), /Wafer has 25 values, and a plot draws at most 24 panels/);
});

test('a wafer with no value for the facet field is in no panel, and said to be', () => {
  const items = lot();
  items.push(wafer('W4', { meta: {} }));
  const r = resolvePlot(spec('histogram', { y: { test: 1050 }, facet: { meta: 'split' } }), items, ctx);
  assert.match(r.notes.join(), /1 wafers with no Split value are in no panel/);
});

test('the facet field reads and writes back', () => {
  const plots = [spec('scatter', { x: { test: 1050 }, y: { test: 1060 }, facet: { builtin: 'ring' } })];
  const back = readPlotsFile(writePlotsFile(readPlotsFile(JSON.stringify({ format: PLOTS_FORMAT, version: PLOTS_VERSION, plots })).plots));
  assert.deepEqual(back.plots, plots);
});
