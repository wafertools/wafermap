// A continuous field cut into ranges (`{ binned }`): the X of a box or bar, a colour, the panels (stats/plotData.ts).

import test from 'node:test';
import assert from 'node:assert/strict';
import { buildWaferMap } from '../dist/index.js';
import { resolvePlot, binEdges } from '../dist/packages/stats/plotData.js';
import { readPlotsFile, writePlotsFile, PLOTS_FORMAT, PLOTS_VERSION } from '../dist/packages/stats/plotSpec.js';

const DEFS = [{ testNumber: 1, name: 'Vth', unit: 'V' }, { testNumber: 2, name: 'Idsat', unit: 'A' }];
/** 40 dies: Vth k, Idsat 100 − k, so a bin of Idsat is a mirrored bin of Vth. */
function wafer(label, shift = 0) {
  const r = buildWaferMap({
    results: Array.from({ length: 40 }, (_, k) => ({ x: k % 8, y: Math.floor(k / 8), hbin: 1, testValues: { 1: k + shift, 2: 100 - k } })),
    waferConfig: { diameter: 30 }, dieConfig: { width: 2, height: 2 }, passBins: [1], testDefs: DEFS,
  });
  return { label, dies: r.dies, metadata: r.metadata, passBins: [1], ringCount: r.ringCount, wafer: r.wafer };
}
const ctx = { testDefs: DEFS };
const plot = (chart, fields, over = {}) => ({ id: 'p', chart, fields, ...over });
const binned = (field, bins, by) => ({ binned: field, ...(bins ? { bins } : {}), ...(by ? { by } : {}) });

test('equal-count edges split the values into ranges of about equal size, equal-width ones into equal spans', () => {
  const v = Array.from({ length: 100 }, (_, k) => k);
  assert.equal(binEdges(v, 4, 'count').length, 3);
  assert.deepEqual(binEdges(v, 4, 'width').map(e => Math.round(e)), [25, 50, 74]);
  assert.deepEqual(binEdges([5, 5, 5, 5], 4, 'count'), [], 'all alike: one range, not four empty ones');
});

test('a box of a test by a binned test: one box per range, lowest first, equal counts', () => {
  const r = resolvePlot(plot('box', { x: binned({ test: 2 }, 4), y: { test: 1 }, color: { none: true } }), [wafer('W1')], ctx);
  assert.deepEqual(r.issues, []);
  assert.equal(r.marks.categories.length, 4);
  const first = parseFloat(r.marks.categories[0]);
  assert.ok(r.marks.categories.every((c, i, a) => i === 0 || parseFloat(c) > parseFloat(a[i - 1])), 'ranges in ascending order');
  assert.equal(first, 61, 'the lowest Idsat is 61');
  assert.ok(r.marks.cells[0].every(c => c.length === 10), '40 dies in 4 ranges of 10');
  assert.match(r.x.label, /Idsat/);
});

test('a binned field is one series with its unbinned field, and round-trips through the plots file', () => {
  const spec = plot('bar', { x: binned({ builtin: 'radius' }, 6, 'width'), y: { test: 1 } });
  const back = readPlotsFile(writePlotsFile([spec]));
  assert.deepEqual(back.warnings, []);
  assert.deepEqual(back.plots[0].fields.x, spec.fields.x);
  assert.equal(PLOTS_VERSION, 1, 'no version bump');
  const bad = readPlotsFile(JSON.stringify({ format: PLOTS_FORMAT, version: PLOTS_VERSION, plots: [plot('bar', { x: { binned: { binned: { test: 1 } } }, y: { test: 1 } })] }));
  assert.ok(bad.warnings.some(w => /only one test or value/.test(w)));
  assert.equal(bad.plots[0].fields.x, undefined);
});

test('a category cannot be put into ranges', () => {
  const r = resolvePlot(plot('bar', { x: binned({ builtin: 'ring' }), y: { test: 1 } }), [wafer('W1')], ctx);
  assert.match(r.issues.join(), /already a category/);
});

test('panels and colours share the ranges cut over the whole population', () => {
  const items = [wafer('W1'), wafer('W2', 100)];
  const r = resolvePlot(plot('bar', { x: { builtin: 'wafer' }, y: { test: 1 }, color: binned({ test: 1 }, 2) }, { aggregate: 'count' }), items, ctx);
  assert.deepEqual(r.issues, []);
  assert.equal(r.groups.length, 2);
  const panels = resolvePlot(plot('box', { x: binned({ test: 2 }, 3), y: { test: 1 }, facet: { builtin: 'wafer' }, color: { none: true } }), items, ctx);
  assert.deepEqual(panels.issues, []);
  const names = panels.facets.map(f => f.plot.marks.categories.join('|'));
  assert.equal(new Set(names).size, 1, 'the same three ranges in each panel');
});

test('range labels are rounded to what tells the ranges apart, not printed as 17-digit floats', () => {
  const values = Array.from({ length: 50 }, (_, k) => 0.1 + k * 0.0173);
  const items = [wafer('W1')];
  const r = resolvePlot(plot('box', { x: binned({ test: 1 }, 4, 'width'), y: { test: 2 }, color: { none: true } }), items, ctx);
  assert.deepEqual(r.issues, []);
  assert.ok(r.marks.categories.every(c => c.split(' to ').every(t => t.length <= 8)), r.marks.categories.join(' | '));
  assert.ok(binEdges(values, 4, 'count').some(e => String(e).length > 12), 'the raw edges do carry float noise');
  const w = resolvePlot(plot('bar', { x: binned({ test: 1 }, 5), y: { test: 2 }, color: { none: true } }), items, ctx);
  assert.equal(new Set(w.marks.categories).size, w.marks.categories.length, 'every range has its own name');
});

test('range names carry the unit with its SI prefix, and sort as ranges, not as text', () => {
  const DEFS_A = [{ testNumber: 1, name: 'Vth', unit: 'V' }, { testNumber: 2, name: 'Ioff', unit: 'A' }];
  const r = buildWaferMap({
    results: Array.from({ length: 60 }, (_, k) => ({ x: k % 8, y: Math.floor(k / 8), hbin: 1, testValues: { 1: 0.5 + k / 1000, 2: 1e-12 * 10 ** (k / 20) } })),
    waferConfig: { diameter: 30 }, dieConfig: { width: 2, height: 2 }, passBins: [1], testDefs: DEFS_A,
  });
  const items = [{ label: 'W', dies: r.dies, metadata: r.metadata, passBins: [1], ringCount: r.ringCount, wafer: r.wafer }];
  const out = resolvePlot(plot('box', { x: binned({ test: 2 }, 4, 'width'), y: { test: 1 }, color: { none: true } }), items, { testDefs: DEFS_A });
  assert.deepEqual(out.issues, []);
  const cats = out.marks.categories;
  assert.ok(cats.every(c => /^[\d.]+ [pnµm]?A to [\d.]+ [pnµm]?A$/.test(c)), cats.join(' | '));
  assert.equal(out.x.label, 'Ioff', 'the unit is in the names, not repeated in the title');
  // Ascending by value although "9.8 pA" sorts after "1.2 nA" as text.
  const units = { p: 1e-12, n: 1e-9, 'µ': 1e-6, m: 1e-3 };
  const low = cats.map(c => { const [v, u] = c.split(' to ')[0].split(' '); return parseFloat(v) * (units[u[0]] ?? 1); });
  assert.deepEqual([...low].sort((a, b) => a - b), low);
});
