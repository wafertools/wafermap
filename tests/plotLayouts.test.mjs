// Radial position, stacked and 100% bars, sorting by value, the first N categories and the pareto line
// (stats/plotData.ts): the data each draws, and the combinations refused with a reason.

import test from 'node:test';
import assert from 'node:assert/strict';
import { buildWaferMap } from '../dist/index.js';
import { resolvePlot, fieldCatalogue } from '../dist/packages/stats/plotData.js';
import { readPlotsFile, writePlotsFile, PLOTS_FORMAT, PLOTS_VERSION } from '../dist/packages/stats/plotSpec.js';

const DEFS = [{ testNumber: 1, name: 'Vth', unit: 'V' }];
/** A wafer of 10×10 dies; bins by position: 2 for the first `b2`, 3 for the next `b3`, 4 for one more, the rest 1. */
function wafer(label, b2, b3, meta = {}) {
  const r = buildWaferMap({
    results: Array.from({ length: 100 }, (_, k) => ({ x: k % 10, y: Math.floor(k / 10), hbin: k < b2 ? 2 : k < b2 + b3 ? 3 : k === b2 + b3 ? 4 : 1, testValues: { 1: k / 100 } })),
    waferConfig: { diameter: 30, metadata: meta }, dieConfig: { width: 1.6, height: 1.6 }, passBins: [1], testDefs: DEFS,
  });
  return { label, dies: r.dies, metadata: r.metadata, passBins: [1], ringCount: r.ringCount, wafer: r.wafer };
}
const lot = () => [wafer('W1', 10, 5, { split: 'A' }), wafer('W2', 20, 2, { split: 'B' }), wafer('W3', 6, 8, { split: 'A' })];
const ctx = { testDefs: DEFS };
const bar = (fields, over = {}) => ({ id: 'b', chart: 'bar', fields, ...over });

test('radial position: 0 at the centre to 100 at the edge, the measure the rings are bands of', () => {
  const items = lot();
  assert.ok(fieldCatalogue(items, ctx).some(f => 'builtin' in f.field && f.field.builtin === 'radius'));
  const r = resolvePlot({ id: 's', chart: 'scatter', fields: { x: { builtin: 'radius' }, y: { test: 1 }, color: { builtin: 'ring' } } }, items, ctx);
  assert.deepEqual(r.issues, []);
  assert.equal(r.x.unit, '%');
  const ringCount = items[0].ringCount;
  for (const p of r.marks.points) {
    assert.ok(p.x >= 0 && p.x <= 100.0001, `${p.x}`);
    const ring = Math.min(ringCount, Math.floor((p.x / 100) * ringCount) + 1);
    assert.equal(r.groups[p.group], `Ring ${ring}`, 'the ring a die is in is the band its radial position falls in');
  }
});

test('a stacked bar of counts: one bar per wafer, its colours one on another; 100% makes them shares', () => {
  const s = resolvePlot(bar({ x: { builtin: 'wafer' }, color: { builtin: 'hbin' } }, { stack: 'stack' }), lot(), ctx);
  assert.deepEqual(s.issues, []);
  assert.equal(s.marks.stack, 'stack');
  assert.equal(s.marks.values.reduce((t, row) => t + (Number.isFinite(row[0]) ? row[0] : 0), 0), 100, 'W1’s colours add to its 100 dies');
  const p = resolvePlot(bar({ x: { builtin: 'wafer' }, color: { builtin: 'hbin' } }, { stack: 'percent' }), lot(), ctx);
  for (let c = 0; c < 3; c++) {
    const total = p.marks.values.reduce((t, row) => t + (Number.isFinite(row[c]) ? row[c] : 0), 0);
    assert.ok(Math.abs(total - 100) < 1e-9);
  }
  assert.equal(p.y.unit, '%');
  assert.match(p.y.label, /Share of each wafer's dies/);
});

test('stacking a mean is refused, with the reason', () => {
  const r = resolvePlot(bar({ x: { builtin: 'wafer' }, y: { test: 1 }, color: { builtin: 'hbin' } }, { stack: 'stack', aggregate: 'mean' }), lot(), ctx);
  assert.match(r.issues.join(), /Stacking adds the colours' values.*not a mean/);
  assert.match(resolvePlot({ id: 'x', chart: 'box', fields: { y: { test: 1 } }, stack: 'stack' }, lot(), ctx).issues.join(), /Only a bar chart stacks/);
});

test('a pareto: bins by count largest first, the first two kept, a cumulative share of the whole', () => {
  const r = resolvePlot(bar({ x: { builtin: 'hbin' }, color: { none: true } }, { sort: 'value', top: 2, cumulative: true }), lot(), ctx);
  assert.deepEqual(r.issues, []);
  // Bin 1: 300 − (36 + 15) − 3 = 246; bin 2: 36; bin 3: 15; bin 4: 3.
  assert.deepEqual(r.marks.categories, ['Bin 1', 'Bin 2']);
  assert.deepEqual(r.marks.values[0], [246, 36]);
  assert.ok(Math.abs(r.marks.cumulative[0] - 82) < 1e-9);
  assert.ok(Math.abs(r.marks.cumulative[1] - 94) < 1e-9, 'of all 300, not only the two shown');
  assert.match(r.notes.join(), /Showing the first 2 of 4 hard bin values, largest first/);
});

test('a box sorts by median; a cumulative line needs a sorted bar of counts; nested categories do not sort', () => {
  const b = resolvePlot({ id: 'x', chart: 'box', fields: { x: { meta: 'split' }, y: { test: 1 }, color: { none: true } }, sort: 'value' }, [wafer('W1', 0, 0, { split: 'A' }), wafer('W2', 0, 0, { split: 'B' })], ctx);
  assert.deepEqual(b.issues, []);
  assert.match(resolvePlot(bar({ x: { builtin: 'hbin' } }, { cumulative: true }), lot(), ctx).issues.join(), /cumulative line needs/);
  assert.match(resolvePlot(bar({ x: [{ meta: 'split' }, { builtin: 'hbin' }] }, { sort: 'value' }), lot(), ctx).issues.join(), /need one category field/);
});

test('the layout settings read and write back; a wrong one is dropped with a reason', () => {
  const plots = [bar({ x: { builtin: 'hbin' } }, { sort: 'value', top: 3, cumulative: true }), bar({ x: { builtin: 'wafer' }, color: { builtin: 'hbin' } }, { id: 'c', stack: 'percent' })];
  const back = readPlotsFile(writePlotsFile(readPlotsFile(JSON.stringify({ format: PLOTS_FORMAT, version: PLOTS_VERSION, plots })).plots));
  assert.deepEqual(back.plots, plots);
  const bad = readPlotsFile(JSON.stringify({ format: PLOTS_FORMAT, version: PLOTS_VERSION, plots: [bar({ x: { builtin: 'hbin' } }, { stack: 'sideways', top: 0, sort: 'name', cumulative: 'yes' })] }));
  for (const k of ['stack', 'top', 'sort', 'cumulative']) assert.equal(k in bad.plots[0], false, k);
  assert.equal(bad.warnings.length, 4);
});
