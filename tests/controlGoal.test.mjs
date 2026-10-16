// Control charts (stats/control.ts, `chart: 'control'`) and the capability goal plot (`chart: 'goal'`).

import test from 'node:test';
import assert from 'node:assert/strict';
import { buildWaferMap } from '../dist/index.js';
import { individualsLimits, westernElectric, MR_D2 } from '../dist/packages/stats/control.js';
import { resolvePlot, plotFootnote } from '../dist/packages/stats/plotData.js';
import { readPlotsFile, writePlotsFile, PLOTS_FORMAT, PLOTS_VERSION } from '../dist/packages/stats/plotSpec.js';

const near = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), `${a} ≉ ${b}`);

test('I-chart limits: centre the mean, σ the average moving range over 1.128', () => {
  const L = individualsLimits([10, 12, 11, 13, 12]);
  near(L.centre, 11.6);
  near(L.sigma, 1.5 / MR_D2);
  near(L.ucl, 11.6 + 3 * 1.5 / MR_D2);
  assert.equal(L.baseline, 5);
  const b = individualsLimits([10, 12, 11, 30, 40], 3);
  near(b.centre, 11);
  assert.equal(b.baseline, 3, 'limits from the first three only');
  assert.equal(individualsLimits([1, 2]), undefined);
});

test('each Western Electric rule is flagged at the point that completes it', () => {
  const L = { centre: 0, sigma: 1, ucl: 3, lcl: -3, baseline: 20 };
  const rules = vs => westernElectric(vs, L).map(v => [v.index, v.rules]);
  assert.deepEqual(rules([0, 0.2, 3.5, 0]), [[2, [1]]], 'one point beyond 3σ');
  assert.deepEqual(rules([0, 2.5, 0.1, 2.4]), [[3, [2]]], 'two of three beyond 2σ on one side');
  assert.deepEqual(rules([0, 2.5, -2.4, 0]), [], 'not on opposite sides');
  assert.deepEqual(rules([1.5, 1.2, 0.2, 1.4, 1.1]), [[4, [3]]], 'four of five beyond 1σ');
  assert.deepEqual(rules([0.1, 0.2, 0.1, 0.3, 0.2, 0.1, 0.4, 0.2]).at(-1), [7, [4]], 'eight in a row on one side');
});

const DEFS = [
  { testNumber: 1, name: 'Vth', unit: 'V', limitLow: 0, limitHigh: 1 },
  { testNumber: 2, name: 'Wide', unit: 'V', limitLow: 0.4, limitHigh: 0.6 },
  { testNumber: 3, name: 'Free', unit: 'V' },
];
/** A wafer of 40 dies: Vth centred on `vth` with ±0.05 spread, Wide on 0.5 ± 0.09, Free unlimited. */
function wafer(label, vth, meta = {}) {
  const r = buildWaferMap({
    results: Array.from({ length: 40 }, (_, k) => ({ x: k % 8, y: Math.floor(k / 8), hbin: 1, testValues: { 1: vth + ((k % 11) - 5) / 100, 2: 0.5 + ((k % 7) - 3) * 0.03, 3: k } })),
    waferConfig: { diameter: 30, metadata: meta }, dieConfig: { width: 2, height: 2 }, passBins: [1], testDefs: DEFS,
  });
  return { label, dies: r.dies, metadata: r.metadata, passBins: [1], ringCount: r.ringCount, wafer: r.wafer };
}
const ctx = { testDefs: DEFS };

test('a control chart of wafer means in wafer order flags the wafer that jumped', () => {
  const means = [0.50, 0.51, 0.49, 0.50, 0.52, 0.50, 0.49, 0.51, 0.75, 0.50];
  const items = means.map((m, i) => wafer(`W${i + 1}`, m, { split: i % 2 ? 'A' : 'B' }));
  const r = resolvePlot({ id: 'c', chart: 'control', fields: { y: { test: 1, name: 'Vth' } }, baseline: 8 }, items, ctx);
  assert.deepEqual(r.issues, []);
  assert.equal(r.marks.type, 'control');
  assert.deepEqual(r.marks.xs, means.map((_, i) => i + 1));
  // Each wafer's mean is its centre plus the same small offset its die pattern averages to.
  const offset = Array.from({ length: 40 }, (_, k) => ((k % 11) - 5) / 100).reduce((a, b) => a + b, 0) / 40;
  means.forEach((m, i) => near(r.marks.values[i], m + offset, 1e-9));
  assert.equal(r.marks.limits.baseline, 8);
  assert.deepEqual(r.marks.violations.find(v => v.index === 8)?.rules, [1], 'W9 is beyond 3σ');
  assert.equal(r.marks.items[8], 8, 'the point names its wafer');
  assert.equal(r.y.label, 'Mean Vth');
  assert.match(plotFootnote(r), /individuals chart: centre the mean of the first 8 wafers, limits ±3σ with σ the average moving range \/ 1\.128; 1 point breaks a Western Electric rule \(1: beyond 3σ\)/);
});

test('a control chart needs a numbered wafer field along X, a number for Y and three wafers', () => {
  const items = [wafer('W1', 0.5), wafer('W2', 0.5), wafer('W3', 0.5)];
  assert.match(resolvePlot({ id: 'c', chart: 'control', fields: { x: { builtin: 'ring' }, y: { test: 1 } } }, items, ctx).issues.join(), /wafer field with a number per wafer/);
  assert.match(resolvePlot({ id: 'c', chart: 'control', fields: { y: { builtin: 'hbin' } } }, items, ctx).issues.join(), /category/);
  assert.match(resolvePlot({ id: 'c', chart: 'control', fields: { y: { test: 1 } } }, items.slice(0, 2), ctx).issues.join(), /at least three wafers/);
  const yieldChart = resolvePlot({ id: 'c', chart: 'control', fields: { y: { builtin: 'yield' } } }, items, ctx);
  assert.deepEqual(yieldChart.issues, []);
  assert.equal(yieldChart.y.label, 'Yield');
});

test('a goal plot places each test by its offset and spread as shares of its window, with Ppk to match', () => {
  const r = resolvePlot({ id: 'g', chart: 'goal', fields: {} }, [wafer('W1', 0.7)], ctx);
  assert.deepEqual(r.issues, []);
  assert.deepEqual(r.marks.points.map(p => p.label).sort(), ['Vth', 'Wide'], 'the tests with both limits; Free has none');
  for (const p of r.marks.points) near(p.ppk, (0.5 - Math.abs(p.x)) / (3 * p.y), 1e-9);
  const vth = r.marks.points.find(p => p.label === 'Vth');
  near(vth.x, 0.2, 0.05);
  assert.match(plotFootnote(r), /triangles: Ppk 1 and 1\.33/);
});

test('a goal plot coloured by split has a point per test and split', () => {
  const items = [wafer('W1', 0.5, { split: 'A' }), wafer('W2', 0.6, { split: 'B' })];
  const r = resolvePlot({ id: 'g', chart: 'goal', fields: { color: { meta: 'split' } } }, items, ctx);
  assert.deepEqual(r.groups, ['A', 'B']);
  const vth = r.marks.points.filter(p => p.label === 'Vth');
  assert.equal(vth.length, 2);
  assert.ok(vth[1].x > vth[0].x, 'B sits further off centre');
  assert.match(resolvePlot({ id: 'g', chart: 'goal', fields: { y: { test: 3 } } }, items, ctx).issues.join(), /No test here has both a low and a high limit/);
});

test('control and goal plots read and write back', () => {
  const plots = [{ id: 'c', chart: 'control', fields: { x: { builtin: 'waferOrder' }, y: { test: 1 } }, baseline: 5 }, { id: 'g', chart: 'goal', fields: {} }];
  const back = readPlotsFile(writePlotsFile(readPlotsFile(JSON.stringify({ format: PLOTS_FORMAT, version: PLOTS_VERSION, plots })).plots));
  assert.deepEqual(back.plots, plots);
  const bad = readPlotsFile(JSON.stringify({ format: PLOTS_FORMAT, version: PLOTS_VERSION, plots: [{ id: 'c', chart: 'control', fields: {}, baseline: 2 }] }));
  assert.equal('baseline' in bad.plots[0], false);
});
