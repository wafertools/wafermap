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
  const r = resolvePlot(plot('histogram', { y: { test: 1 }, color: { none: true } }, { where: { conditions: [{ field: { builtin: 'hbin' }, values: ['Bin 2'] }] } }), items, ctx);
  assert.deepEqual(r.issues, []);
  assert.equal(r.population.dies, 30, 'ten bin-2 dies on each of three wafers');
  assert.match(plotFootnote(r), /only dies where Hard bin is Bin 2/);
  const u = r.marks.units[0][0];
  assert.ok(items[r.marks.unit(u).item].dies.includes(r.marks.unit(u).die), 'units name the population’s wafers');
});

test('only wafers where: a wafer field keeps whole wafers, and a click on a wafer opens the right one', () => {
  const r = resolvePlot(plot('bar', { x: { builtin: 'wafer' }, y: { test: 1 }, color: { none: true } }, { where: { conditions: [{ field: { meta: 'split' }, values: ['B'] }] } }), lot(), ctx);
  assert.deepEqual(r.marks.categories, ['W2']);
  assert.deepEqual(r.marks.categoryItems, [1]);
  assert.match(plotFootnote(r), /only wafers where Split is B/);
  assert.match(resolvePlot(plot('bar', { x: { builtin: 'wafer' } }, { where: { conditions: [{ field: { meta: 'split' }, values: ['C'] }] } }), lot(), ctx).issues.join(), /Nothing is left: no wafers where Split is C/);
  assert.deepEqual(fieldValues({ builtin: 'hbin' }, lot(), ctx), ['Bin 1', 'Bin 2']);
});

test('a filter goes before the panels', () => {
  const r = resolvePlot(plot('histogram', { y: { test: 1 }, facet: { meta: 'split' } }, { where: { conditions: [{ field: { builtin: 'hbin' }, values: ['Bin 1'] }] } }), lot(), ctx);
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
  // A single condition written without the list is read as a list of one.
  assert.deepEqual(back.plots, [{ ...plots[0], where: { conditions: [{ field: { builtin: 'ring' }, values: ['Ring 4'] }] } }, plots[1]]);
  const bad = readPlotsFile(JSON.stringify({ format: PLOTS_FORMAT, version: PLOTS_VERSION, plots: [plot('line', { x: { builtin: 'waferOrder' }, y: { test: 1 } }, { spread: 'wide', where: { field: { builtin: 'hbin' }, values: [] } })] }));
  assert.equal('spread' in bad.plots[0], false);
  assert.equal('where' in bad.plots[0], false);
});

test('plots leave out edge-excluded dies, as the Insights cards do, and the footnote counts them', () => {
  const results = [];
  for (let x = -7; x <= 7; x++) for (let y = -7; y <= 7; y++) if (x * x + y * y <= 49) results.push({ x, y, hbin: (x + y) % 3 === 0 ? 2 : 1, testValues: { 1: x } });
  const r = buildWaferMap({ results, waferConfig: { diameter: 32, edgeExclusion: 3 }, dieConfig: { width: 2, height: 2 }, passBins: [1], testDefs: DEFS });
  const edge = r.dies.filter(d => d.edgeExcluded).length;
  assert.ok(edge > 0, 'the fixture has edge-excluded dies');
  const it = { label: 'W1', dies: r.dies, metadata: r.metadata, passBins: [1], ringCount: r.ringCount, wafer: r.wafer };
  const p = resolvePlot(plot('bar', { x: { builtin: 'hbin' }, color: { none: true } }, { sort: 'value' }), [it], ctx);
  const judged = r.dies.filter(d => !d.edgeExcluded && !d.partial);
  const counts = [1, 2].map(b => judged.filter(d => d.hbin === b).length).sort((a, b) => b - a);
  assert.deepEqual(p.marks.values[0], counts, 'counts of the judged dies only');
  assert.equal(p.population.dies, r.dies.length - edge);
  assert.match(plotFootnote(p), new RegExp(`${edge} edge-excluded dies left out`));
  const plain = buildWaferMap({ results, waferConfig: { diameter: 32 }, dieConfig: { width: 2, height: 2 }, passBins: [1], testDefs: DEFS });
  const none = resolvePlot(plot('bar', { x: { builtin: 'hbin' }, color: { none: true } }), [{ ...it, dies: plain.dies }], ctx);
  assert.doesNotMatch(plotFootnote(none), /left out/, 'nothing said when nothing is left out');
});

test('bars as each colour\'s share of its own total: groups of different sizes compare', () => {
  // Split A is two wafers, B one: counts differ two to one, shares do not.
  const spec = plot('bar', { x: { builtin: 'hbin' }, color: { meta: 'split' } }, { barNorm: 'percent' });
  const r = resolvePlot(spec, lot(), ctx);
  assert.deepEqual(r.issues, []);
  for (const row of r.marks.values) assert.ok(Math.abs(row.reduce((a, v) => a + (Number.isFinite(v) ? v : 0), 0) - 100) < 1e-9, 'each colour sums to 100');
  assert.equal(r.y.unit, '%');
  assert.match(r.y.label, /Share of each split's dies/);
  assert.match(resolvePlot({ ...spec, stack: 'stack' }, lot(), ctx).issues[0], /not both/);
  assert.match(resolvePlot({ ...spec, fields: { ...spec.fields, y: { test: 1 } }, aggregate: 'mean' }, lot(), ctx).issues[0], /count or a sum/);
  const back = readPlotsFile(writePlotsFile([spec, { ...spec, barNorm: 'share' }]));
  assert.equal(back.plots[0].barNorm, 'percent');
  assert.equal(back.plots[1].barNorm, undefined);
});

test('a set of tests as pass rates: one bar per test, judged as the pass-rate card judges, worst first', () => {
  const spec = plot('bar', { x: { builtin: 'test' }, y: { tests: [1, 3], passRate: true }, color: { none: true } }, { sort: 'ascending' });
  const r = resolvePlot(spec, lot(), ctx);
  assert.deepEqual(r.issues, []);
  // Vth by its limits: 31 of 50 per wafer, 62%. Scan by its verdict: even dies pass, 50%. Worst first.
  assert.deepEqual(r.marks.categories, ['Scan', 'Vth']);
  assert.deepEqual(r.marks.values[0].map(v => +v.toFixed(3)), [50, 62]);
  assert.equal(r.y.unit, '%');
  assert.match(r.y.label, /^Pass rate/);
  // A test with no limits cannot be judged by them: named, left out.
  const free = resolvePlot({ ...spec, fields: { ...spec.fields, y: { tests: [1, 2], passRate: true } } }, lot(), ctx);
  assert.match(free.notes.join(' '), /Free \(no test limits\)/);
  assert.match(resolvePlot({ ...spec, normalize: 'zscore' }, lot(), ctx).issues[0], /cannot be rescaled/);
});

test('judged by the tester flag, a parametric test reads its recorded verdict', () => {
  const defs = [{ testNumber: 1, name: 'Vth', unit: 'V', limitLow: 0.2, limitHigh: 0.8 }];
  const r0 = buildWaferMap({
    results: Array.from({ length: 10 }, (_, k) => ({ x: k, y: 0, hbin: 1, testValues: { 1: 0.5 }, testPass: { 1: k < 3 } })),
    waferConfig: { diameter: 40 }, dieConfig: { width: 2, height: 2 }, passBins: [1], testDefs: defs,
  });
  const items = [{ label: 'W1', dies: r0.dies, passBins: [1], ringCount: r0.ringCount, wafer: r0.wafer }];
  const by = (judge) => resolvePlot(plot('bar', { x: { builtin: 'wafer' }, y: { passRate: 1, ...(judge ? { judge } : {}) }, color: { none: true } }), items, { testDefs: defs }).marks.values[0][0];
  assert.equal(by(), 100, 'every value is inside its limits');
  assert.equal(by('flag'), 30, 'the tester passed three of ten');
  const back = readPlotsFile(writePlotsFile([plot('bar', { y: { passRate: 1, judge: 'flag' } }), plot('bar', { y: { passRate: 1, judge: 'eyeball' } })]));
  assert.equal(back.plots[0].fields.y.judge, 'flag');
  assert.equal(back.plots[1].fields.y.judge, undefined);
  assert.match(back.warnings.join(' '), /judge: "eyeball" is not limits or flag/);
});

test('sorting smallest first orders by the whole category, every colour pooled', () => {
  const r = resolvePlot(plot('bar', { x: { builtin: 'wafer' }, y: { passRate: 1 }, color: { meta: 'split' } }, { sort: 'ascending' }), lot(), ctx);
  const pooled = r.marks.categories.map((_, c) => r.marks.values.map(row => row[c]).find(Number.isFinite));
  assert.deepEqual([...pooled].sort((a, b) => a - b), pooled);
});
