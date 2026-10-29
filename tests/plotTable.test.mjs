// Resolving a saved plot over a population of wafers (stats/plotData.ts): the data each mark draws, the level
// rules, pooled yield, and the reasons a plot cannot be drawn.

import test from 'node:test';
import assert from 'node:assert/strict';
import { buildWaferMap } from '../dist/index.js';
import { resolvePlot, plotFootnote, plotTitle, combine, combinationIssue, fieldCatalogue, fieldsForRole, defaultPlot, fieldKey, titleDrift, describeTitleDrift, examplePlots } from '../dist/packages/stats/plotData.js';
import { plotTable, fileStem } from '../dist/packages/stats/plotTable.js';
import { yieldCounts } from '../dist/packages/stats/yield.js';

const DEFS = [
  { testNumber: 1050, name: 'Vth', unit: 'V' },
  { testNumber: 1060, name: 'Idsat', unit: 'A' },
];

/** A wafer of `n` dies, the first `pass` in bin 1 and the rest in bin 2. Vth is `vth0 + k/100`; Idsat is absent for the first `noIdsat` dies. */
function wafer(label, { n = 10, pass = 9, vth0 = 0.4, idsat = 1, noIdsat = 0, meta = {} } = {}) {
  const r = buildWaferMap({
    results: Array.from({ length: n }, (_, k) => ({
      x: k % 6, y: Math.floor(k / 6), hbin: k < pass ? 1 : 2,
      testValues: k < noIdsat ? { 1050: vth0 + k / 100 } : { 1050: vth0 + k / 100, 1060: idsat * (k + 1) },
    })),
    waferConfig: { diameter: 80, metadata: meta },
    dieConfig: { width: 1, height: 1 },
    passBins: [1], testDefs: DEFS,
  });
  return { label, dies: r.dies, metadata: r.metadata, passBins: [1], ringCount: r.ringCount, wafer: r.wafer };
}

const lot = () => [
  wafer('W1', { n: 10, pass: 9, vth0: 0.40, meta: { split: 'TT', temperature: 25 } }),
  wafer('W2', { n: 20, pass: 10, vth0: 0.45, noIdsat: 4, meta: { split: 'FF', temperature: 25 } }),
  wafer('W3', { n: 10, pass: 5, vth0: 0.50, meta: { split: 'TT', temperature: 85 } }),
];
const ctx = { testDefs: DEFS, passBins: [1] };
const spec = (chart, fields, over = {}) => ({ id: 'p', chart, fields, ...over });
const T = (n, name) => ({ test: n, name });
const labels = ['W1', 'W2', 'W3'];
const table = (plot) => plotTable(resolvePlot(plot, lot(), ctx), i => labels[i]);
const headers = t => t.columns.map(c => c.header);
const cell = (t, row, header) => t.columns.find(c => c.header === header).get(t.rows[row]);

test('a scatter is its points: the wafer, the die, both values and the group', () => {
  const t = table(spec('scatter', { x: T(1050, 'Vth'), y: T(1060, 'Idsat'), color: { meta: 'split' } }));
  assert.deepEqual(headers(t), ['Wafer', 'Die X', 'Die Y', 'Vth (V)', 'Idsat (A)', 'Split']);
  assert.equal(t.rows.length, 36, 'every point drawn (the dies without an Idsat value are not)');
  assert.ok(['W1', 'W2', 'W3'].includes(cell(t, 0, 'Wafer')));
  assert.ok(['TT', 'FF'].includes(cell(t, 0, 'Split')));
  assert.equal(typeof cell(t, 0, 'Vth (V)'), 'number');
});

test('a histogram and a probability plot are their values, the probability plot with its cumulative share', () => {
  const h = table(spec('histogram', { y: T(1050, 'Vth'), color: { none: true } }));
  assert.deepEqual(headers(h), ['Wafer', 'Die X', 'Die Y', 'Vth (V)']);
  assert.equal(h.rows.length, 40);
  const p = table(spec('probability', { y: T(1050, 'Vth'), color: { none: true } }));
  assert.deepEqual(headers(p).slice(-2), ['Vth (V)', 'Cumulative share (%)']);
  const shares = p.rows.map(r => r[r.length - 1]);
  assert.ok(Math.min(...shares) > 0 && Math.max(...shares) < 100, 'shares sit inside 0 and 100');
});

test('a box is its five-number summary per category and colour; a bar is its value and its count', () => {
  const b = table(spec('box', { x: { builtin: 'wafer' }, y: T(1050, 'Vth'), color: { none: true } }));
  assert.deepEqual(headers(b), ['Wafer', 'N', 'Min', 'Q1', 'Median', 'Q3', 'Max']);
  assert.equal(b.rows.length, 3);
  assert.equal(cell(b, 0, 'N'), 10);
  assert.ok(cell(b, 0, 'Min') <= cell(b, 0, 'Q1') && cell(b, 0, 'Q1') <= cell(b, 0, 'Median') && cell(b, 0, 'Median') <= cell(b, 0, 'Q3') && cell(b, 0, 'Q3') <= cell(b, 0, 'Max'));
  const bar = table(spec('bar', { x: { builtin: 'wafer' }, y: { builtin: 'yield' }, color: { none: true } }, { level: 'wafer' }));
  assert.equal(headers(bar)[0], 'Wafer');
  assert.equal(headers(bar).at(-1), 'N');
  assert.equal(bar.rows.length, 3);
  assert.equal(cell(bar, 0, headers(bar)[1]), 90);
});

test('nested categories are one column per level', () => {
  const t = table(spec('box', { x: [{ meta: 'split' }, { builtin: 'wafer' }], y: T(1050, 'Vth'), color: { none: true } }));
  assert.deepEqual(headers(t).slice(0, 2), ['Split', 'Wafer']);
  assert.equal(t.rows.length, 3);
});

test('a line, a control chart, a heatmap and a goal plot each give their own columns', () => {
  const line = table(spec('line', { x: { builtin: 'waferOrder' }, y: T(1050, 'Vth'), color: { none: true } }, { aggregate: 'mean', spread: 'sd' }));
  assert.deepEqual(headers(line).slice(-3), ['N', 'Band low', 'Band high']);
  const control = table(spec('control', { x: { builtin: 'waferOrder' }, y: T(1050, 'Vth'), color: { none: true } }, { aggregate: 'mean' }));
  assert.deepEqual(headers(control).slice(-4), ['Centre', 'Lower limit', 'Upper limit', 'Rules broken']);
  assert.equal(control.rows.length, 3);
  const heat = table(spec('heatmap', { x: { meta: 'split' }, y: { tests: [1050, 1060] } }, { level: 'wafer', aggregate: 'mean', normalize: 'zscore' }));
  assert.equal(headers(heat)[3], 'N');
  assert.ok(heat.rows.length >= 3 && heat.rows.every(r => typeof r[2] === 'number'));
});

test('a plot of panels gives each panel\'s rows under a Panel column; nothing drawn gives no table', () => {
  const t = table(spec('histogram', { y: T(1050, 'Vth'), color: { none: true }, facet: { meta: 'split' } }));
  assert.equal(headers(t)[0], 'Split');
  assert.deepEqual([...new Set(t.rows.map(r => r[0]))].sort(), ['FF', 'TT']);
  assert.equal(t.rows.length, 40, 'every value once, in its panel');
  assert.equal(plotTable(resolvePlot(spec('histogram', { y: T(9999, 'Nope'), color: { none: true } }), lot(), ctx), i => labels[i]), undefined);
});

test('a file name stem is letters, numbers and single dashes', () => {
  assert.equal(fileStem('Vth by Wafer · by Process Split (copy)'), 'Vth-by-Wafer-by-Process-Split-copy');
  assert.equal(fileStem('  ***  '), 'plot');
  assert.equal(fileStem('Idsat (µA) — a/b'), 'Idsat-μA-a-b', 'compatibility forms are folded (the micro sign becomes the Greek letter)');
  assert.equal(fileStem('Rendement par tranche é'), 'Rendement-par-tranche-e', 'accents are dropped');
});
