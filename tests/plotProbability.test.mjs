// The probability plot (stats/plotData.ts, charts/plotChart.ts): each group's values in order at (rank − ½) / n, on a
// normal-probability axis by default, with the same values a histogram reads (one test, a set, rescaled or not).

import test from 'node:test';
import assert from 'node:assert/strict';
import { buildWaferMap } from '../dist/index.js';
import { resolvePlot, plotFootnote, plotTitle, probabilityPosition, fieldCatalogue, examplePlots, plotTestNumber } from '../dist/packages/stats/plotData.js';
import { readPlotsFile, writePlotsFile, plotIssue, PLOTS_FORMAT, PLOTS_VERSION } from '../dist/packages/stats/plotSpec.js';
import { normalQuantile, normalUpperTail } from '../dist/packages/stats/math.js';

const DEFS = [
  { testNumber: 1050, name: 'Vth', unit: 'V', limitLow: 0.3, limitHigh: 0.7 },
  { testNumber: 1060, name: 'Idsat', unit: 'A' },
];

function wafer(label, { n = 10, vth0 = 0.4, noIdsat = 0, meta = {} } = {}) {
  const r = buildWaferMap({
    results: Array.from({ length: n }, (_, k) => {
      // Vth descends with k, so the sort is the resolver's and not the input order.
      const testValues = { 1050: vth0 + (n - k) / 100 };
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
];
const ctx = { testDefs: DEFS };
const spec = (fields, over = {}) => ({ id: 'p', chart: 'probability', fields, ...over });

test('the normal quantile inverts the normal tail, deep into both tails', () => {
  for (const p of [1e-9, 1e-6, 0.001, 0.0243, 0.1, 0.5, 0.8, 0.98, 0.999999]) {
    const z = normalQuantile(p);
    const back = 1 - normalUpperTail(z);
    const lower = normalUpperTail(-z);
    assert.ok(Math.abs((p < 0.5 ? lower : back) - p) / Math.min(p, 1 - p) < 1e-9, `p = ${p}: Φ(${z})`);
  }
  assert.equal(normalQuantile(0.5), 0);
  assert.ok(Math.abs(normalQuantile(0.975) - 1.959963984540054) < 1e-12);
  assert.equal(normalQuantile(0), -Infinity);
  assert.equal(normalQuantile(1), Infinity);
  assert.ok(Number.isNaN(normalQuantile(1.5)));
});

test('plotting positions are (k + ½) / n: inside (0, 1), the median of an odd count at 50%', () => {
  assert.equal(probabilityPosition(0, 10), 0.05);
  assert.equal(probabilityPosition(9, 10), 0.95);
  assert.equal(probabilityPosition(2, 5), 0.5);
});

test('one curve per wafer by default, each in ascending order with the die behind every value', () => {
  const items = lot();
  const r = resolvePlot(spec({ y: { test: 1050, name: 'Vth' } }), items, ctx);
  assert.deepEqual(r.issues, []);
  assert.equal(r.marks.type, 'probability');
  assert.deepEqual(r.groups, ['W1', 'W2']);
  assert.deepEqual(r.marks.values.map(v => v.length), [10, 20]);
  for (const [g, vs] of r.marks.values.entries()) {
    assert.deepEqual(vs, [...vs].sort((a, b) => a - b), 'ascending');
    vs.forEach((v, k) => {
      const { item, die } = r.marks.unit(r.marks.units[g][k]);
      assert.equal(item, g);
      assert.ok(Math.abs(die.testValues[1050] - v) < 1e-12, 'the unit is the die with that value');
    });
  }
  assert.equal(r.x.label, 'Vth');
  assert.equal(r.x.unit, 'V');
  assert.deepEqual(r.x.limits, { limitLow: 0.3, limitHigh: 0.7 }, 'the limits are drawn on the values axis');
  assert.equal(r.y.label, 'Cumulative share');
  assert.equal(plotTitle(r), 'Vth, cumulative · by Wafer');
  assert.match(plotFootnote(r), /each die at \(rank − ½\) \/ n of its group, on a normal-probability scale/);
});

test('a linear share axis is said to be one; a single colour is one curve over the population', () => {
  const r = resolvePlot(spec({ y: { test: 1050 }, color: { none: true } }, { probabilityAxis: 'linear' }), lot(), ctx);
  assert.deepEqual(r.marks.values.map(v => v.length), [30]);
  assert.match(plotFootnote(r), /of its population · how to read this: User guide, section 10.4$/);
});

test('missing values are counted, and a category cannot be the values', () => {
  const r = resolvePlot(spec({ y: { test: 1060 }, color: { none: true } }), lot(), ctx);
  assert.deepEqual(r.omitted, [{ field: 'Idsat', count: 4 }]);
  assert.match(resolvePlot(spec({ y: { builtin: 'hbin' } }), lot(), ctx).issues.join(), /cannot be the values of a probability plot/);
  assert.match(resolvePlot(spec({}), lot(), ctx).issues.join(), /Choose the values to plot/);
});

test('a set of tests, rescaled, is one curve per test', () => {
  const r = resolvePlot(spec({ y: { tests: [1050, 1060] } }, { normalize: 'zscore' }), lot(), ctx);
  assert.deepEqual(r.issues, []);
  assert.deepEqual(r.groups, ['Vth', 'Idsat']);
  assert.match(r.x.label, /z-score/);
});

test('one mark per wafer: a curve of wafer means', () => {
  const r = resolvePlot(spec({ y: { test: 1050 }, color: { none: true } }, { level: 'wafer' }), lot(), ctx);
  assert.deepEqual(r.marks.values.map(v => v.length), [2]);
  assert.match(plotFootnote(r), /mean of Vth per wafer; each wafer at/);
});

test('the file keeps the chart and its share axis; an unknown share axis is dropped with a reason', () => {
  const plots = [spec({ y: { test: 1050 } }, { probabilityAxis: 'linear' })];
  const back = readPlotsFile(writePlotsFile(readPlotsFile(JSON.stringify({ format: PLOTS_FORMAT, version: PLOTS_VERSION, plots })).plots));
  assert.deepEqual(back.plots, plots);
  assert.equal(plotIssue(back.plots[0]), undefined);
  const bad = readPlotsFile(JSON.stringify({ format: PLOTS_FORMAT, version: PLOTS_VERSION, plots: [spec({ y: { test: 1050 } }, { probabilityAxis: 'weibull' })] }));
  assert.equal(bad.plots[0].probabilityAxis, undefined);
  assert.match(bad.warnings.join(), /probabilityAxis: "weibull" is not normal or linear/);
});

test('examples include a probability plot of the first test, and a click opens the wafer on it', () => {
  const ex = examplePlots(fieldCatalogue(lot(), ctx), 2, () => 'e');
  const p = ex.find(e => e.chart === 'probability');
  assert.deepEqual(p.fields, { y: { test: 1050, name: 'Vth' } });
  assert.equal(plotTestNumber(p), 1050);
});
