// Heatmaps (`chart: 'heatmap'`, the nested bar laid out as a grid) and the wafer-to-wafer difference map
// (stats/differenceMap.ts and its Insights card).

import test from 'node:test';
import assert from 'node:assert/strict';
import { buildWaferMap } from '../dist/index.js';
import { resolvePlot, plotFootnote } from '../dist/packages/stats/plotData.js';
import { differenceMap } from '../dist/packages/stats/differenceMap.js';

const DEFS = [{ testNumber: 1, name: 'Vth', unit: 'V' }, { testNumber: 2, name: 'Idsat', unit: 'A' }];
/** A 6×6 wafer: Vth `base + x/100`, Idsat `x + y`; the first `fails` dies in bin 2. */
function wafer(label, { base = 0.5, fails = 6, meta = {}, skip = -1 } = {}) {
  const results = [];
  for (let k = 0; k < 36; k++) {
    if (k === skip) continue;
    const x = k % 6, y = Math.floor(k / 6);
    results.push({ x, y, hbin: k < fails ? 2 : 1, testValues: { 1: base + x / 100, 2: x + y } });
  }
  const r = buildWaferMap({ results, waferConfig: { diameter: 20, metadata: meta }, dieConfig: { width: 2, height: 2 }, passBins: [1], testDefs: DEFS });
  return { label, dies: r.dies, metadata: r.metadata, passBins: [1], ringCount: r.ringCount, wafer: r.wafer };
}
const ctx = { testDefs: DEFS };

test('a heatmap of bins by wafer counts the dies in each cell', () => {
  const items = [wafer('W1', { fails: 6 }), wafer('W2', { fails: 12 })];
  const r = resolvePlot({ id: 'h', chart: 'heatmap', fields: { x: { builtin: 'wafer' }, rows: { builtin: 'hbin' } } }, items, ctx);
  assert.deepEqual(r.issues, []);
  assert.equal(r.marks.type, 'heatmap');
  assert.deepEqual(r.marks.rows, ['Bin 1', 'Bin 2']);
  assert.deepEqual(r.marks.cols, ['W1', 'W2']);
  assert.deepEqual(r.marks.values, [[30, 24], [6, 12]]);
  assert.deepEqual(r.colorScale && [r.colorScale.lo, r.colorScale.hi], [6, 30]);
  const u = r.marks.cellUnits[1][1][0];
  assert.equal(r.marks.unit(u).item, 1, 'a cell’s units are its wafer’s dies');
});

test('tests by wafer: a set of tests has a row per test, rescaled per test', () => {
  const items = [wafer('W1', { base: 0.5 }), wafer('W2', { base: 0.6 })];
  const r = resolvePlot({ id: 'h', chart: 'heatmap', fields: { x: { builtin: 'wafer' }, y: { tests: [1, 2] } }, normalize: 'zscore' }, items, ctx);
  assert.deepEqual(r.issues, []);
  assert.deepEqual(r.marks.rows, ['Vth', 'Idsat']);
  assert.ok(r.marks.values[0][1] > r.marks.values[0][0], 'W2’s Vth is higher');
  assert.ok(Math.abs(r.marks.values[1][0] - r.marks.values[1][1]) < 1e-9, 'Idsat is the same on both');
  assert.match(plotFootnote(r), /rescaled per test/);
});

test('a heatmap needs rows, and rows and columns that differ', () => {
  const items = [wafer('W1')];
  assert.match(resolvePlot({ id: 'h', chart: 'heatmap', fields: { x: { builtin: 'wafer' }, y: { test: 1 } } }, items, ctx).issues.join(), /Choose a field for the rows/);
  assert.match(resolvePlot({ id: 'h', chart: 'heatmap', fields: { x: { builtin: 'hbin' }, rows: { builtin: 'hbin' } } }, items, ctx).issues.join(), /two different fields/);
});

test('a difference map: group A’s mean minus group B’s at each position, no data where one has none', () => {
  const a = [wafer('A1', { base: 0.6 }), wafer('A2', { base: 0.7 })];
  const b = [wafer('B1', { base: 0.5, skip: 0 })];
  const r = differenceMap(a, b, { test: 1 });
  assert.equal(r.compared, 35, 'B has no die at (0, 0)');
  const at = (x, y) => r.dies.find(d => d.x === x && d.y === y).testValues?.[0];
  assert.ok(Math.abs(at(3, 2) - 0.15) < 1e-9, 'A’s mean 0.65 + x/100 minus B’s 0.5 + x/100');
  assert.equal(at(0, 0), undefined);
  assert.ok(Math.abs(r.maxAbs - 0.15) < 1e-9);
});

test('a yield difference compares the share of each group’s wafers passing at a position', () => {
  const a = [wafer('A1', { fails: 6 }), wafer('A2', { fails: 0 })];   // first row: half of A's wafers pass
  const b = [wafer('B1', { fails: 0 })];
  const r = differenceMap(a, b, { yield: true });
  const at = (x, y) => r.dies.find(d => d.x === x && d.y === y).testValues?.[0];
  assert.equal(at(2, 0), -50);
  assert.equal(at(2, 3), 0);
});

test('the Insights card draws the difference as a map, with what was subtracted stated', async () => {
  const { JSDOM } = await import('jsdom');
  const dom = new JSDOM('<!doctype html><body><div id="root"></div></body>', { pretendToBeVisual: true });
  for (const k of ['window', 'document', 'HTMLElement', 'HTMLCanvasElement', 'Node', 'Event', 'MouseEvent', 'KeyboardEvent', 'Element']) globalThis[k] = dom.window[k];
  globalThis.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
  Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
  const mm = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
  dom.window.matchMedia = mm; globalThis.matchMedia = mm;
  class RO { observe() {} unobserve() {} disconnect() {} }
  dom.window.ResizeObserver = RO; globalThis.ResizeObserver = RO;
  dom.window.HTMLCanvasElement.prototype.getContext = () => new Proxy({}, { get: (_, p) => (p === 'measureText' ? t => ({ width: String(t).length * 6 }) : p === 'canvas' ? { width: 1, height: 1 } : () => ({ addColorStop() {} })) });
  const { renderDifferenceMapPanel } = await import('../dist/packages/canvas-adapter/differenceMapPanel.js');
  const src = w => ({ ...w, source: { wafer: w.wafer, dies: w.dies, passBins: w.passBins, ringCount: w.ringCount, testDefs: DEFS } });
  const groups = [{ key: 'A', items: [src(wafer('A1', { base: 0.6 }))] }, { key: 'B', items: [src(wafer('B1', { base: 0.5 }))] }];
  const p = renderDifferenceMapPanel({ groups, testDefs: DEFS, groupLabelText: 'Split', selectedTestNumber: 1, ownerDocument: dom.window.document });
  dom.window.document.getElementById('root').appendChild(p.card);
  assert.match(p.card.textContent, /Vth: A \(1 wafer\) minus B \(1\), each the mean over its wafers at the position\. 36 positions compared/);
  assert.ok(p.card.querySelector('canvas'), 'drawn as a map');
  p.setTest(2);
  assert.match(p.card.textContent, /Idsat: A/, 'it follows the section’s test');
  p.destroy();
});
