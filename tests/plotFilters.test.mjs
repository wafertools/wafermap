// A test's pass rate as values, a plot's die filter (`where`) and spread bands on lines (stats/plotData.ts).

import test from 'node:test';
import assert from 'node:assert/strict';
import { buildWaferMap } from '../dist/index.js';
import { resolvePlot, plotFootnote, fieldCatalogue, fieldValues } from '../dist/packages/stats/plotData.js';
import { readPlotsFile, writePlotsFile, PLOTS_FORMAT, PLOTS_VERSION } from '../dist/packages/stats/plotSpec.js';
import { tQuantileTwoSided } from '../dist/packages/stats/math.js';

const DEFS = [
  { testNumber: 1, name: 'Vth', unit: 'V', limitLow: 0.2, limitHigh: 0.8 },
  { testNumber: 2, name: 'Free', unit: 'V' },
  { testNumber: 3, name: 'Scan', testType: 'F' },
];
/** A wafer of 50 dies: Vth k/50 (dies 10–40 pass its 0.2–0.8 limits), Scan passing on even dies, bin 1 for k < `pass`. */
function wafer(label, { pass = 40, shift = 0, meta = {} } = {}) {
  const r = buildWaferMap({
    results: Array.from({ length: 50 }, (_, k) => ({
      x: k % 10, y: Math.floor(k / 10), hbin: k < pass ? 1 : 2,
      testValues: { 1: k / 50 + shift, 2: k }, testPass: { 3: k % 2 === 0 },
    })),
    waferConfig: { diameter: 30, metadata: meta }, dieConfig: { width: 2, height: 2 }, passBins: [1], testDefs: DEFS,
  });
  return { label, dies: r.dies, metadata: r.metadata, passBins: [1], ringCount: r.ringCount, wafer: r.wafer };
}
const lot = () => [wafer('W1', { meta: { split: 'A' } }), wafer('W2', { shift: 0.1, meta: { split: 'B' } }), wafer('W3', { meta: { split: 'A' } })];
const ctx = { testDefs: DEFS };
const plot = (chart, fields, over = {}) => ({ id: 'p', chart, fields, ...over });

test('pass rates: offered for tests with limits and functional tests, only as values', () => {
  const cat = fieldCatalogue(lot(), ctx);
  const rates = cat.filter(f => f.group === 'Pass rates').map(f => f.name);
  assert.deepEqual(rates, ['Vth pass rate', 'Scan pass rate'], 'not Free, which has no limits');
});

test('a bar of a pass rate per wafer: the share of judged dies passing, by the test limits or the verdict', () => {
  const r = resolvePlot(plot('bar', { x: { builtin: 'wafer' }, y: { passRate: 1, name: 'Vth' }, color: { none: true } }), lot(), ctx);
  assert.deepEqual(r.issues, []);
  // W1: values 0, 0.02 … 0.98: within 0.2–0.8 are k = 10 … 40, 31 of 50. W2 shifted by 0.1: k = 5 … 35, 31 of 50.
  assert.ok(Math.abs(r.marks.values[0][0] - 62) < 1e-9);
  assert.equal(r.y.label, 'Vth pass rate');
  assert.equal(r.y.unit, '%');
  const scan = resolvePlot(plot('bar', { x: { builtin: 'wafer' }, y: { passRate: 3 }, color: { none: true } }), lot(), ctx);
  assert.ok(Math.abs(scan.marks.values[0][0] - 50) < 1e-9, 'a functional test by its verdicts');
});

test('a pass rate as single dies is refused; one mark per wafer makes it each wafer’s rate', () => {
  assert.match(resolvePlot(plot('box', { x: { meta: 'split' }, y: { passRate: 1 } }), lot(), ctx).issues.join(), /share of dies/);
  const perWafer = resolvePlot(plot('box', { x: { meta: 'split' }, y: { passRate: 1 }, color: { none: true } }, { level: 'wafer' }), lot(), ctx);
  assert.deepEqual(perWafer.issues, []);
  assert.match(resolvePlot(plot('bar', { y: { passRate: 2 } }), lot(), ctx).issues.join(), /no test limits/);
});

test('only dies where: a die field keeps those dies, and the statement says so', () => {
  const items = lot();
  const r = resolvePlot(plot('histogram', { y: { test: 1 }, color: { none: true } }, { where: { field: { builtin: 'hbin' }, values: ['Bin 2'] } }), items, ctx);
  assert.deepEqual(r.issues, []);
  assert.equal(r.population.dies, 30, 'ten bin-2 dies on each of three wafers');
  assert.match(plotFootnote(r), /only dies with Hard bin Bin 2/);
  const u = r.marks.units[0][0];
  assert.ok(items[r.marks.unit(u).item].dies.includes(r.marks.unit(u).die), 'units name the population’s wafers');
});

test('only wafers where: a wafer field keeps whole wafers, and a click on a wafer opens the right one', () => {
  const r = resolvePlot(plot('bar', { x: { builtin: 'wafer' }, y: { test: 1 }, color: { none: true } }, { where: { field: { meta: 'split' }, values: ['B'] } }), lot(), ctx);
  assert.deepEqual(r.marks.categories, ['W2']);
  assert.deepEqual(r.marks.categoryItems, [1]);
  assert.match(plotFootnote(r), /only wafers with Split B/);
  assert.match(resolvePlot(plot('bar', { x: { builtin: 'wafer' } }, { where: { field: { meta: 'split' }, values: ['C'] } }), lot(), ctx).issues.join(), /No wafer has Split C/);
  assert.deepEqual(fieldValues({ builtin: 'hbin' }, lot(), ctx), ['Bin 1', 'Bin 2']);
});

test('a filter goes before the panels', () => {
  const r = resolvePlot(plot('histogram', { y: { test: 1 }, facet: { meta: 'split' } }, { where: { field: { builtin: 'hbin' }, values: ['Bin 1'] } }), lot(), ctx);
  assert.deepEqual(r.facets.map(f => [f.label, f.plot.population.dies]), [['A', 80], ['B', 40]]);
});

test('bands: ±1 SD, the t interval of the mean, quartiles and range at each X', () => {
  const base = plot('line', { x: { builtin: 'waferOrder' }, y: { test: 2 }, color: { none: true } }, { aggregate: 'mean' });
  const values = Array.from({ length: 50 }, (_, k) => k);
  const mean = 24.5, sd = Math.sqrt(values.reduce((a, v) => a + (v - mean) ** 2, 0) / 49);
  const sdBand = resolvePlot({ ...base, spread: 'sd' }, lot(), ctx).marks.band;
  assert.ok(Math.abs(sdBand.hi[0][0] - (mean + sd)) < 1e-9);
  const ci = resolvePlot({ ...base, spread: 'ci95' }, lot(), ctx);
  assert.ok(Math.abs(ci.marks.band.hi[0][0] - (mean + tQuantileTwoSided(0.05, 49) * sd / Math.sqrt(50))) < 1e-9);
  assert.match(plotFootnote(ci), /band: the mean's 95% confidence interval \(Student's t, n = dies\)/);
  const range = resolvePlot({ ...base, spread: 'minmax' }, lot(), ctx).marks.band;
  assert.deepEqual([range.lo[0][0], range.hi[0][0]], [0, 49]);
  assert.ok(Math.abs(tQuantileTwoSided(0.05, 4) - 2.776445) < 1e-5);
});

test('a band round a pass rate or a maximum is refused with the reason', () => {
  assert.match(resolvePlot(plot('line', { x: { builtin: 'waferOrder' }, y: { passRate: 1 } }, { spread: 'sd' }), lot(), ctx).issues.join(), /leave the band off/);
  assert.match(resolvePlot(plot('line', { x: { builtin: 'waferOrder' }, y: { test: 1 } }, { spread: 'sd', aggregate: 'max' }), lot(), ctx).issues.join(), /not a maximum/);
});

test('pass rates, filters and bands read and write back', () => {
  const plots = [plot('line', { x: { builtin: 'waferOrder' }, y: { passRate: 1, name: 'Vth' } }, { where: { field: { builtin: 'ring' }, values: ['Ring 4'] } }),
    plot('line', { x: { builtin: 'waferOrder' }, y: { test: 1 } }, { id: 'q', spread: 'iqr' })];
  const back = readPlotsFile(writePlotsFile(readPlotsFile(JSON.stringify({ format: PLOTS_FORMAT, version: PLOTS_VERSION, plots })).plots));
  assert.deepEqual(back.plots, plots);
  const bad = readPlotsFile(JSON.stringify({ format: PLOTS_FORMAT, version: PLOTS_VERSION, plots: [plot('line', { x: { builtin: 'waferOrder' }, y: { test: 1 } }, { spread: 'wide', where: { field: { builtin: 'hbin' }, values: [] } })] }));
  assert.equal('spread' in bad.plots[0], false);
  assert.equal('where' in bad.plots[0], false);
});
