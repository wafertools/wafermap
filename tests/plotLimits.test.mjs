// The plot chart draws a measured test's limits as dashed lines on the axis that measures it: short dashes for test
// limits, long for spec limits; a limit outside the axis gets an edge marker; `limits: 'none'` draws none.

import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { pretendToBeVisual: true, url: 'http://localhost/' });
for (const k of ['window', 'document', 'HTMLElement', 'HTMLCanvasElement', 'HTMLDivElement', 'HTMLButtonElement', 'Node', 'Event', 'MouseEvent', 'KeyboardEvent', 'CustomEvent', 'Blob', 'DOMRect', 'URL']) {
  if (dom.window[k]) globalThis[k] = dom.window[k];
}
globalThis.window = dom.window;
globalThis.document = dom.window.document;
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
globalThis.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
const mm = () => ({ matches: false, media: '', addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false });
dom.window.matchMedia = mm; globalThis.matchMedia = mm;
class FakeResizeObserver { observe() {} unobserve() {} disconnect() {} }
dom.window.ResizeObserver = FakeResizeObserver; globalThis.ResizeObserver = FakeResizeObserver;
const noop = () => {};
let dashes = [];
let texts = [];
const proto = dom.window.HTMLCanvasElement.prototype;
proto.getContext = () => new Proxy({}, { get: (_, p) => {
  if (p === 'measureText') return (t) => ({ width: String(t).length * 6 });
  if (p === 'createLinearGradient' || p === 'createRadialGradient') return () => ({ addColorStop: noop });
  if (p === 'getImageData') return () => ({ data: [] });
  if (p === 'canvas') return { width: 600, height: 400 };
  if (p === 'setLineDash') return (d) => { dashes.push(JSON.stringify(d)); };
  if (p === 'fillText') return (t) => { texts.push(String(t)); };
  return noop;
}, set: () => true });
proto.focus = noop; proto.setPointerCapture = noop; proto.releasePointerCapture = noop;
Object.defineProperty(proto, 'clientWidth', { configurable: true, get() { return 600; } });
Object.defineProperty(proto, 'clientHeight', { configurable: true, get() { return 400; } });

const { buildWaferMap } = await import('../dist/index.js');
const { resolvePlot } = await import('../dist/packages/stats/plotData.js');
const { renderPlotChart } = await import('../dist/packages/canvas-adapter/charts/plotChart.js');

const DEFS = [
  { testNumber: 1050, name: 'Vth', unit: 'V', limitLow: 0.45, limitHigh: 0.6, specLow: 0.4, specHigh: 0.65 },
  { testNumber: 1060, name: 'Idsat', unit: 'A' },
];
const wafer = buildWaferMap({
  results: Array.from({ length: 30 }, (_, k) => ({ x: k % 6, y: Math.floor(k / 6), hbin: 1, testValues: { 1050: 0.45 + k / 150, 1060: k + 1 } })),
  testDefs: DEFS, waferConfig: { diameter: 80 }, dieConfig: { width: 10, height: 10 }, passBins: [1],
});
const items = [{ label: 'W1', dies: wafer.dies, wafer: wafer.wafer, waferIndex: 0, metadata: wafer.wafer.metadata, passBins: [1], ringCount: 4 }];

function draw(spec) {
  dashes = []; texts = [];
  const host = document.getElementById('root');
  host.innerHTML = '';
  const chart = renderPlotChart({ waferLabel: () => 'W1' });
  host.appendChild(chart.card);
  chart.setPlot(resolvePlot(spec, items, { testDefs: DEFS, passBins: [1] }));
  chart.destroy();
  return { dashes: new Set(dashes), texts };
}

test('a histogram of a limited test draws its test limits (short dashes) and spec limits (long), labelled with their values', () => {
  const r = draw({ id: 'h', chart: 'histogram', fields: { y: { test: 1050, name: 'Vth' }, color: { none: true } } });
  assert.ok(r.dashes.has('[3,3]'), 'test limits are short dashes');
  assert.ok(r.dashes.has('[10,4]'), 'spec limits are long dashes');
  assert.ok(r.texts.some(t => /^LL\b|^Lo\b|LSL|USL|LTL|HTL/i.test(t)), `a limit label: ${r.texts.slice(0, 12).join(' | ')}`);
});

test('a scatter draws limits on the axis of the test that has them, and none for a test without', () => {
  const none = draw({ id: 's', chart: 'scatter', fields: { x: { test: 1060, name: 'Idsat' }, y: { test: 1060, name: 'Idsat' }, color: { none: true } } });
  assert.equal(none.dashes.size, 0, 'no limits, no dashed lines');
  const some = draw({ id: 's', chart: 'scatter', fields: { x: { test: 1060, name: 'Idsat' }, y: { test: 1050, name: 'Vth' }, color: { none: true } } });
  assert.ok(some.dashes.has('[3,3]'));
});

test('"limits" chooses which kind is drawn, and none draws nothing', () => {
  const base = { id: 'h', chart: 'histogram', fields: { y: { test: 1050, name: 'Vth' }, color: { none: true } } };
  const testOnly = draw({ ...base, limits: 'test' });
  assert.deepEqual([...testOnly.dashes], ['[3,3]']);
  const specOnly = draw({ ...base, limits: 'spec' });
  assert.deepEqual([...specOnly.dashes], ['[10,4]']);
  assert.equal(draw({ ...base, limits: 'none' }).dashes.size, 0);
});

test('a box and a bar of a mean draw them on the value axis; a bar of yield draws none', () => {
  assert.ok(draw({ id: 'b', chart: 'box', fields: { x: { builtin: 'wafer' }, y: { test: 1050, name: 'Vth' }, color: { none: true } } }).dashes.size > 0);
  assert.ok(draw({ id: 'b', chart: 'bar', fields: { x: { builtin: 'quadrant' }, y: { test: 1050, name: 'Vth' }, color: { none: true } } }).dashes.size > 0);
  assert.equal(draw({ id: 'b', chart: 'bar', fields: { x: { builtin: 'quadrant' }, y: { builtin: 'yield' }, color: { none: true } } }).dashes.size, 0);
});
