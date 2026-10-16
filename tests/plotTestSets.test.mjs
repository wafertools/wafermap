// Several tests in one plot, and rescaled values (stats/plotData.ts, stats/plotSpec.ts): a set of tests on Y is divided
// by the Test field, each test is rescaled on its own, and a set that cannot be read on one axis is refused with a reason.

import test from 'node:test';
import assert from 'node:assert/strict';
import { buildWaferMap } from '../dist/index.js';
import { resolvePlot, plotFootnote, plotTitle, fieldCatalogue, defaultPlot, examplePlots, expandTestSet, withTestSetNames, plotTestNumber } from '../dist/packages/stats/plotData.js';
import { readPlotsFile, writePlotsFile, sameField, isTestSet, PLOTS_FORMAT, PLOTS_VERSION } from '../dist/packages/stats/plotSpec.js';

const DEFS = [
  { testNumber: 1050, name: 'Vth', unit: 'V', limitLow: 0.3, limitHigh: 0.7 },
  { testNumber: 1055, name: 'Vth2', unit: 'V', specLow: 0.2, specHigh: 0.8 },
  { testNumber: 1060, name: 'Idsat', unit: 'A', limitLow: 0, limitHigh: 40 },
  { testNumber: 1070, name: 'Ioff', unit: 'A' },
];

/** A wafer of `n` dies. Vth is `vth0 + k/100`, Vth2 twice that, Idsat `k + 1` (absent for the first `noIdsat` dies), Ioff `k`. */
function wafer(label, { n = 10, vth0 = 0.4, noIdsat = 0, meta = {} } = {}) {
  const r = buildWaferMap({
    results: Array.from({ length: n }, (_, k) => {
      const testValues = { 1050: vth0 + k / 100, 1055: 2 * (vth0 + k / 100), 1070: k };
      if (k >= noIdsat) testValues[1060] = k + 1;
      return { x: k % 6, y: Math.floor(k / 6), hbin: 1, testValues };
    }),
    waferConfig: { diameter: 80, metadata: meta },
    dieConfig: { width: 1, height: 1 },
    passBins: [1], testDefs: DEFS,
  });
  return { label, dies: r.dies, metadata: r.metadata, passBins: [1], ringCount: r.ringCount, wafer: r.wafer };
}

const lot = () => [
  wafer('W1', { n: 10, vth0: 0.40, meta: { split: 'TT' } }),
  wafer('W2', { n: 20, vth0: 0.45, noIdsat: 4, meta: { split: 'FF' } }),
  wafer('W3', { n: 10, vth0: 0.50, meta: { split: 'TT' } }),
];
const ctx = { testDefs: DEFS };
const spec = (chart, fields, over = {}) => ({ id: 'p', chart, fields, ...over });
const set = (...tests) => ({ tests });
const allValues = cells => cells.flat(2);
const meanOf = v => v.reduce((a, b) => a + b, 0) / v.length;
const sdOf = v => { const m = meanOf(v); return Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / (v.length - 1)); };

test('a box of a set: one box per test along X, in the order the set names them', () => {
  const r = resolvePlot(spec('box', { y: set(1055, 1050), color: { none: true } }), lot(), ctx);
  assert.deepEqual(r.issues, []);
  assert.equal(r.marks.type, 'box');
  assert.deepEqual(r.marks.categories, ['Vth2', 'Vth']);
  assert.equal(r.marks.cells[0][0].length, 40, 'every die of the lot is in each test’s box');
  assert.equal(r.y.unit, 'V', 'tests in one unit keep it');
  assert.equal(r.y.label, 'Vth2 and Vth');
  assert.deepEqual(r.population, { wafers: 3, dies: 40 }, 'the population is the wafers, not the wafers once per test');
  assert.equal(plotTitle(r), 'Vth2 and Vth');
});

test('tests in different units are refused until they are rescaled', () => {
  const raw = resolvePlot(spec('box', { y: set(1050, 1060) }), lot(), ctx);
  assert.match(raw.issues.join(), /different units \(V, A\).*rescale/);
  const z = resolvePlot(spec('box', { y: set(1050, 1060), color: { none: true } }, { normalize: 'zscore' }), lot(), ctx);
  assert.deepEqual(z.issues, []);
  assert.equal(z.y.unit, undefined, 'a rescaled value has no unit');
  assert.equal(z.y.label, 'Vth and Idsat (z-score)');
  for (const cell of [z.marks.cells[0][0], z.marks.cells[0][1]]) {
    assert.ok(Math.abs(meanOf(cell)) < 1e-9, 'each test is centred on its own mean');
    assert.ok(Math.abs(sdOf(cell) - 1) < 1e-9, 'and scaled by its own spread');
  }
  assert.match(plotFootnote(z), /standard deviations from the mean/);
});

test('rescaled to limits: each test by its own limits, spec limits first, and one pair of limit lines for all', () => {
  const r = resolvePlot(spec('box', { y: set(1050, 1055), color: { none: true } }, { normalize: 'limits' }), lot(), ctx);
  assert.deepEqual(r.issues, []);
  const vth = r.marks.cells[0][0], vth2 = r.marks.cells[0][1];
  // Vth 0.40 on test limits 0.3..0.7 is 0.25; Vth2 0.80 on spec limits 0.2..0.8 is 1.
  assert.ok(vth.some(v => Math.abs(v - 0.25) < 1e-9));
  assert.ok(vth2.some(v => Math.abs(v - 1) < 1e-9));
  // The tests are placed by different kinds of limit, so no one kind lands at the same place for both: no lines.
  assert.equal(r.y.limits, undefined);
  assert.match(plotFootnote(r), /spec limits, or test limits where a test has no spec: 0 is the low limit, 1 the high/);

  const same = resolvePlot(spec('box', { y: set(1050, 1060), color: { none: true } }, { normalize: 'limits' }), lot(), ctx);
  assert.deepEqual(same.y.limits, { limitLow: 0, limitHigh: 1 }, 'tests placed by test limits share the lines at 0 and 1');
});

test('a test that cannot be rescaled is left out and said to be; when none can, the plot says why', () => {
  const r = resolvePlot(spec('box', { y: set(1050, 1070), color: { none: true } }, { normalize: 'limits' }), lot(), ctx);
  assert.deepEqual(r.marks.categories, ['Vth']);
  assert.match(r.notes.join(), /Ioff has no low and high limit/);
  const none = resolvePlot(spec('box', { y: set(1070) }, { normalize: 'limits' }), lot(), ctx);
  assert.match(none.issues.join(), /Ioff has no low and high limit/);
});

test('a bar of a set by wafer is coloured by test, one mean per wafer and test', () => {
  const r = resolvePlot(spec('bar', { x: { builtin: 'wafer' }, y: set(1050, 1055) }), lot(), { ...ctx, groupBy: 'split' });
  assert.deepEqual(r.issues, []);
  assert.deepEqual(r.groups, ['Vth', 'Vth2'], 'the set is divided by test, which a followed colour gives way to');
  assert.deepEqual(r.marks.categories, ['W1', 'W2', 'W3']);
  assert.ok(Math.abs(r.marks.values[0][0] - 0.445) < 1e-9, 'W1 Vth mean');
  assert.ok(Math.abs(r.marks.values[1][0] - 0.89) < 1e-9, 'W1 Vth2 mean');
  assert.deepEqual(r.marks.categoryItems, [0, 1, 2], 'a wafer category opens the wafer itself');
});

test('a set divided by neither X nor colour is refused', () => {
  const r = resolvePlot(spec('box', { x: { builtin: 'wafer' }, y: set(1050, 1055), color: { none: true } }), lot(), ctx);
  assert.match(r.issues.join(), /Put Test on the X axis or the colour/);
});

test('a missing value is counted against its own test', () => {
  const r = resolvePlot(spec('box', { y: set(1060, 1070), color: { none: true } }), lot(), ctx);
  assert.deepEqual(r.omitted, [{ field: 'Idsat', count: 4 }]);
  assert.match(plotFootnote(r), /4 dies without Idsat not plotted/);
});

test('every unit of a set plot names a real wafer of the population', () => {
  const items = lot();
  const r = resolvePlot(spec('box', { y: set(1050, 1055), color: { none: true } }), items, ctx);
  for (const units of r.marks.cellUnits.flat()) {
    for (const u of units) {
      const { item, die } = r.marks.unit(u);
      assert.ok(item >= 0 && item < items.length);
      assert.ok(items[item].dies.includes(die));
    }
  }
});

test('a line over wafer order coloured by test, at wafer level', () => {
  const r = resolvePlot(spec('line', { x: { builtin: 'waferOrder' }, y: set(1050, 1055) }, { aggregate: 'mean' }), lot(), ctx);
  assert.deepEqual(r.issues, []);
  assert.deepEqual(r.marks.xs, [1, 2, 3], 'wafer order is the wafer’s, not its place in the set');
  assert.deepEqual(r.groups, ['Vth', 'Vth2']);
});

test('a histogram of a set overlays its tests', () => {
  const r = resolvePlot(spec('histogram', { y: set(1050, 1055) }, { normalize: 'robust' }), lot(), ctx);
  assert.deepEqual(r.issues, []);
  assert.deepEqual(r.groups, ['Vth', 'Vth2']);
  assert.equal(r.marks.values[0].length, 40);
  assert.match(r.x.label, /robust z-score/);
});

test('ranges expand to the declared tests between their ends', () => {
  assert.deepEqual(expandTestSet({ tests: ['1050..1060', 1070, 1050] }, DEFS).tests, [1050, 1055, 1060, 1070]);
  const r = resolvePlot(spec('box', { y: set('1050..1055'), color: { none: true } }), lot(), ctx);
  assert.deepEqual(r.marks.categories, ['Vth', 'Vth2']);
});

test('a set made against other tests is reported, not drawn against the wrong measurement', () => {
  const r = resolvePlot(spec('box', { y: { tests: [1050], names: { 1050: 'Leak' } } }), lot(), ctx);
  assert.match(r.issues.join(), /Test 1050 is "Leak" in this plot and "Vth" here/);
  assert.deepEqual(withTestSetNames({ tests: ['1050..1055'] }, DEFS), { tests: ['1050..1055'], names: { 1050: 'Vth', 1055: 'Vth2' } });
});

test('a test the dies do not hold is left out with a note', () => {
  const r = resolvePlot(spec('box', { y: set(1050, 9999), color: { none: true } }), lot(), ctx);
  assert.deepEqual(r.marks.categories, ['Vth']);
  assert.match(r.notes.join(), /Left out, with no values here: test 9999/);
});

test('a scatter takes neither a set nor rescaling; Test means nothing without a set', () => {
  assert.match(resolvePlot(spec('scatter', { x: { test: 1050 }, y: set(1050, 1055) }), lot(), ctx).issues.join(), /A scatter plots one value against another/);
  assert.match(resolvePlot(spec('scatter', { x: { test: 1050 }, y: { test: 1055 } }, { normalize: 'zscore' }), lot(), ctx).issues.join(), /not to a scatter/);
  assert.match(resolvePlot(spec('box', { x: { builtin: 'test' }, y: { test: 1050 } }), lot(), ctx).issues.join(), /Test divides a set of tests/);
  assert.match(resolvePlot(spec('box', { x: set(1050, 1055), y: { test: 1050 } }), lot(), ctx).issues.join(), /only be the values/);
});

test('one test rescaled: its limits move with it', () => {
  const r = resolvePlot(spec('box', { x: { builtin: 'wafer' }, y: { test: 1050, name: 'Vth' }, color: { none: true } }, { normalize: 'limits' }), lot(), ctx);
  assert.deepEqual(r.issues, []);
  assert.deepEqual(r.y.limits, { limitLow: 0, limitHigh: 1 });
  assert.equal(r.y.label, 'Vth (position in limits)');
  assert.match(resolvePlot(spec('box', { y: { builtin: 'dieCount' } }, { normalize: 'zscore' }), lot(), ctx).issues.join(), /Rescaling applies to a measured test/);
});

test('the catalogue offers Test when the lot has tests to make a set of, and nothing else mistakes it for a test', () => {
  const cat = fieldCatalogue(lot(), ctx);
  assert.ok(cat.some(f => sameField(f.field, { builtin: 'test' })));
  assert.deepEqual(defaultPlot(cat, 'd').fields, { x: { test: 1050, name: 'Vth' }, y: { test: 1055, name: 'Vth2' } });
  for (const p of examplePlots(cat, 3, () => 'e')) for (const f of Object.values(p.fields ?? {})) assert.ok(!sameField(f, { builtin: 'test' }) || 'tests' in p.fields.y, 'Test only where the values are a set');
  assert.equal(plotTestNumber(spec('box', { y: set('1055..1060') })), 1055);
});

test('a plot of a set reads and writes back, and a bad setting is dropped with a reason', () => {
  const plots = [spec('box', { x: { builtin: 'test' }, y: { tests: [1050, '1055..1060'], names: { 1050: 'Vth' } } }, { normalize: 'robust' })];
  const text = JSON.stringify({ format: PLOTS_FORMAT, version: PLOTS_VERSION, plots });
  const back = readPlotsFile(writePlotsFile(readPlotsFile(text).plots));
  assert.deepEqual(back.plots, plots);
  assert.deepEqual(back.warnings, []);
  assert.ok(isTestSet(back.plots[0].fields.y));

  const bad = readPlotsFile(JSON.stringify({ format: PLOTS_FORMAT, version: PLOTS_VERSION, plots: [
    spec('box', { y: { tests: ['10..x'] } }, { normalize: 'sideways', id: 'b' }),
  ] }));
  assert.equal(bad.plots[0].normalize, undefined);
  assert.equal(bad.plots[0].fields.y, undefined);
  assert.match(bad.warnings.join('\n'), /normalize: "sideways" is not known/);
  assert.match(bad.warnings.join('\n'), /fields\.y: its tests must be test numbers or ranges/);
});

// ── nested categories ─────────────────────────────────────────────────────────────────────────────────────────────

test('nested X: one box per test and ring, tests the outer groups in the set’s order, rings natural within each', () => {
  const r = resolvePlot(spec('box', { x: [{ builtin: 'test' }, { builtin: 'ring' }], y: set(1055, 1050), color: { none: true } }), lot(), ctx);
  assert.deepEqual(r.issues, []);
  const { levels, parts } = r.marks.nest;
  assert.deepEqual(levels, ['Test', 'Ring']);
  assert.deepEqual([...new Set(parts.map(p => p[0]))], ['Vth2', 'Vth'], 'outer level in the set’s order, each run contiguous');
  const rings = parts.filter(p => p[0] === 'Vth2').map(p => p[1]);
  assert.deepEqual(rings, [...rings].sort(), 'rings in order within a test');
  assert.equal(r.marks.categories[0], `${parts[0][0]} · ${parts[0][1]}`);
  assert.equal(r.x.label, 'Test › Ring');
  const total = r.marks.cells[0].reduce((n, c) => n + c.length, 0);
  assert.equal(total, 80, 'every die once per test');
  assert.equal(plotTitle(r), 'Vth2 and Vth by Ring');
});

test('the order of the levels is the nesting: rings outside, tests inside', () => {
  const r = resolvePlot(spec('box', { x: [{ builtin: 'ring' }, { builtin: 'test' }], y: set(1055, 1050), color: { none: true } }), lot(), ctx);
  assert.deepEqual(r.issues, []);
  assert.deepEqual(r.marks.nest.levels, ['Ring', 'Test']);
  assert.deepEqual(r.marks.nest.parts.slice(0, 2).map(p => p[1]), ['Vth2', 'Vth'], 'tests repeat inside each ring');
});

test('nested wafer fields: a bar of mean Vth per split and wafer, wafers in population order', () => {
  const r = resolvePlot(spec('bar', { x: [{ meta: 'split' }, { builtin: 'wafer' }], y: { test: 1050, name: 'Vth' }, color: { none: true } }), lot(), ctx);
  assert.deepEqual(r.issues, []);
  assert.deepEqual(r.marks.nest.parts, [['FF', 'W2'], ['TT', 'W1'], ['TT', 'W3']]);
  assert.equal(r.marks.categoryItems, undefined, 'a wafer inside a split is not opened by a click on the group');
  assert.match(r.aggregation, /per split and wafer/);
  assert.equal(plotTitle(r), 'Vth by Split and Wafer');
});

test('a unit missing a level’s value is counted against that level', () => {
  const items = lot();
  items[2] = wafer('W3', { n: 10, vth0: 0.5, meta: {} });
  const r = resolvePlot(spec('box', { x: [{ meta: 'split' }, { builtin: 'wafer' }], y: { test: 1050 }, color: { none: true } }), items, ctx);
  assert.deepEqual(r.omitted, [{ field: 'Split', count: 10 }]);
});

test('nesting is for a box or bar, at most three levels, each field once', () => {
  assert.match(resolvePlot(spec('line', { x: [{ builtin: 'waferOrder' }, { builtin: 'ring' }], y: { test: 1050 } }), lot(), ctx).issues.join(), /Nested categories need a box or bar chart/);
  assert.match(resolvePlot(spec('box', { x: [{ builtin: 'ring' }, { builtin: 'ring' }], y: { test: 1050 } }), lot(), ctx).issues.join(), /only one level/);
  assert.match(resolvePlot(spec('box', { x: [{ builtin: 'ring' }, { builtin: 'wafer' }, { meta: 'split' }, { builtin: 'quadrant' }], y: { test: 1050 } }), lot(), ctx).issues.join(), /At most 3/);
  assert.match(resolvePlot(spec('box', { x: [{ builtin: 'wafer' }, { test: 1060 }], y: { test: 1050 } }), lot(), ctx).issues.join(), /Idsat is continuous/);
});

test('nested X reads and writes back; a level that cannot be read is dropped and named; an unknown one needs a newer version', async () => {
  const { plotIssue } = await import('../dist/packages/stats/plotSpec.js');
  const plots = [spec('box', { x: [{ meta: 'split' }, { builtin: 'ring' }], y: { test: 1050 } })];
  const back = readPlotsFile(writePlotsFile(readPlotsFile(JSON.stringify({ format: PLOTS_FORMAT, version: PLOTS_VERSION, plots })).plots));
  assert.deepEqual(back.plots, plots);
  const bad = readPlotsFile(JSON.stringify({ format: PLOTS_FORMAT, version: PLOTS_VERSION, plots: [spec('box', { x: [{ meta: '' }, { builtin: 'ring' }], y: { test: 1050 } })] }));
  assert.deepEqual(bad.plots[0].fields.x, [{ builtin: 'ring' }]);
  assert.match(bad.warnings.join(), /fields\.x 1: metadata key is empty/);
  assert.match(plotIssue(spec('box', { x: [{ builtin: 'ring' }, { builtin: 'reticleRow' }], y: { test: 1050 } })), /newer version/);
});
