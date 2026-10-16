// Scatter fits and y = x, histogram shares and normal curves, and what-if limits (stats/plotData.ts).

import test from 'node:test';
import assert from 'node:assert/strict';
import { buildWaferMap } from '../dist/index.js';
import { resolvePlot, plotFootnote, fitLine } from '../dist/packages/stats/plotData.js';
import { readPlotsFile, writePlotsFile, PLOTS_FORMAT, PLOTS_VERSION } from '../dist/packages/stats/plotSpec.js';

const near = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), `${a} ≉ ${b}`);

test('least squares recovers an exact line; orthogonal regression a symmetric one', () => {
  const xs = Array.from({ length: 20 }, (_, i) => i), ys = xs.map(x => 2 * x + 1);
  const f = fitLine(xs, ys, 'linear');
  near(f.slope, 2); near(f.intercept, 1); near(f.r2, 1);
  const o = fitLine(xs, ys, 'orthogonal');
  near(o.slope, 2); near(o.intercept, 1);
  assert.equal(fitLine([1, 2], [1, 2], 'linear'), undefined, 'fewer than three points');
  assert.equal(fitLine([1, 1, 1], [1, 2, 3], 'linear'), undefined, 'no spread in X');
});

test('with noise in X as well as Y, least squares tilts towards flat and orthogonal regression does not', () => {
  // Points on y = x, each with a mirror image across it: scattered as much along X as along Y.
  const xs = [], ys = [];
  for (let t = -20; t <= 20; t++) for (const e of [3, -3]) { xs.push(t + e); ys.push(t - e); }
  const ols = fitLine(xs, ys, 'linear'), orth = fitLine(xs, ys, 'orthogonal');
  assert.ok(ols.slope < 0.95, `least squares ${ols.slope}`);
  near(orth.slope, 1, 1e-9);
});

const DEFS = [
  { testNumber: 1, name: 'Vth', unit: 'V', limitLow: 0.2, limitHigh: 0.8 },
  { testNumber: 2, name: 'Vref', unit: 'V' },
  { testNumber: 3, name: 'Idsat', unit: 'A' },
];
function wafer(label, meta = {}, shift = 0) {
  const r = buildWaferMap({
    results: Array.from({ length: 50 }, (_, k) => ({ x: k % 10, y: Math.floor(k / 10), hbin: 1, testValues: { 1: k / 50 + shift, 2: 2 * (k / 50 + shift) + 0.1, 3: k } })),
    waferConfig: { diameter: 30, metadata: meta }, dieConfig: { width: 2, height: 2 }, passBins: [1], testDefs: DEFS,
  });
  return { label, dies: r.dies, metadata: r.metadata, passBins: [1], ringCount: r.ringCount, wafer: r.wafer };
}
const lot = () => [wafer('W1', { split: 'A' }), wafer('W2', { split: 'B' }, 0.1)];
const ctx = { testDefs: DEFS };
const plot = (chart, fields, over = {}) => ({ id: 'p', chart, fields, ...over });

test('a scatter fit per colour, stated as an equation with R² and n; y = x where the units agree', () => {
  const r = resolvePlot(plot('scatter', { x: { test: 1 }, y: { test: 2 }, color: { meta: 'split' } }, { fit: 'linear', identity: true }), lot(), ctx);
  assert.deepEqual(r.issues, []);
  assert.equal(r.marks.fits.length, 2);
  near(r.marks.fits[0].slope, 2); near(r.marks.fits[0].intercept, 0.1);
  assert.equal(r.fitNotes[0], 'A: y = 2 x + 100.0 mV, R² 1.000, n 50');
  assert.equal(r.marks.identity, true);
  assert.match(plotFootnote(r), /least-squares fit of Y on X per colour/);
  const mixed = resolvePlot(plot('scatter', { x: { test: 1 }, y: { test: 3 }, color: { none: true } }, { fit: 'orthogonal', identity: true }), lot(), ctx);
  assert.equal(mixed.marks.identity, undefined);
  assert.match(mixed.notes.join(), /y = x is left off: Vth and Idsat are in different units/);
  assert.match(mixed.fitNotes[0], /^y = −?[\d.]+ A\/V x/, 'a slope across units carries them');
  // A falling line: Vref = 1 − Vth on a wafer of its own.
  const defs = [{ testNumber: 1, name: 'Vth', unit: 'V' }, { testNumber: 2, name: 'Vref', unit: 'V' }];
  const down = buildWaferMap({ results: Array.from({ length: 20 }, (_, k) => ({ x: k % 5, y: Math.floor(k / 5), hbin: 1, testValues: { 1: k / 20, 2: 1 - k / 20 } })),
    waferConfig: { diameter: 30 }, dieConfig: { width: 2, height: 2 }, passBins: [1], testDefs: defs });
  const falling = resolvePlot(plot('scatter', { x: { test: 1 }, y: { test: 2 }, color: { none: true } }, { fit: 'linear' }),
    [{ label: 'W', dies: down.dies, passBins: [1], ringCount: down.ringCount, wafer: down.wafer }], { testDefs: defs });
  assert.equal(falling.fitNotes[0], 'y = −1 x + 1.00 V, R² 1.000, n 20', 'a minus sign, not a hyphen');
});

test('histogram shares and a normal curve: the axis and the statement say what is drawn', () => {
  const r = resolvePlot(plot('histogram', { y: { test: 1 }, color: { meta: 'split' } }, { histNorm: 'percent', normalCurve: true }), lot(), ctx);
  assert.equal(r.y.label, "Share of each colour's dies");
  assert.equal(r.y.unit, '%');
  assert.match(plotFootnote(r), /curve: the normal distribution with each colour's mean and standard deviation/);
  const log = resolvePlot(plot('histogram', { y: { test: 3 } }, { normalCurve: true, axes: { x: { scale: 'log' } } }), [wafer('W1')].map(w => ({ ...w, dies: w.dies.filter(d => d.testValues[3] > 0) })), ctx);
  assert.match(log.notes.join(), /normal curve is left off a log axis/);
});

test('what-if limits: the test’s pass rate now and with the proposed limits, and the dies that change', () => {
  const r = resolvePlot(plot('histogram', { y: { test: 1 } }, { whatIf: { lo: 0.3 } }), [wafer('W1')], ctx);
  assert.deepEqual(r.issues, []);
  // Values k/50: 0.2–0.8 passes k = 10…40 (31 dies); 0.3–0.8 passes k = 15…40 (26 dies).
  assert.equal(r.whatIf.judged, 50);
  assert.equal(r.whatIf.passNow, 31);
  assert.equal(r.whatIf.passThen, 26);
  assert.equal(r.whatIf.lo, 0.3);
  assert.equal(r.whatIf.hi, 0.8, 'an end not proposed keeps the test limit');
  assert.match(plotFootnote(r), /what-if: Vth passes 62\.0% of 50 dies by its test limits, 52\.0% from 300 mV to 800 mV \(−5 dies\)/);
  assert.equal(r.x.limits.whatIfLow, 0.3);
  assert.match(resolvePlot(plot('scatter', { x: { test: 1 }, y: { test: 2 } }, { whatIf: { lo: 0.3 } }), lot(), ctx).issues.join(), /histogram or a probability plot/);
  assert.match(resolvePlot(plot('histogram', { y: { test: 1 } }, { whatIf: { lo: 0.3 }, normalize: 'zscore' }), lot(), ctx).issues.join(), /turn rescaling off/);
});

test('the new settings read and write back; wrong ones are dropped with a reason', () => {
  const plots = [plot('scatter', { x: { test: 1 }, y: { test: 2 } }, { fit: 'orthogonal', identity: true }),
    plot('histogram', { y: { test: 1 } }, { id: 'h', histNorm: 'percent', normalCurve: true, whatIf: { lo: 0.3, hi: 0.7 } })];
  const back = readPlotsFile(writePlotsFile(readPlotsFile(JSON.stringify({ format: PLOTS_FORMAT, version: PLOTS_VERSION, plots })).plots));
  assert.deepEqual(back.plots, plots);
  const bad = readPlotsFile(JSON.stringify({ format: PLOTS_FORMAT, version: PLOTS_VERSION, plots: [plot('histogram', { y: { test: 1 } }, { fit: 'cubic', identity: 'y', histNorm: 'density', normalCurve: 1, whatIf: {} })] }));
  for (const k of ['fit', 'identity', 'histNorm', 'normalCurve', 'whatIf']) assert.equal(k in bad.plots[0], false, k);
  assert.equal(bad.warnings.length, 5);
});
