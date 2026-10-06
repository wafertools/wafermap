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
let placed = [];   // where each text was drawn: { t, x, y, align, base }
const ctxState = {};
const proto = dom.window.HTMLCanvasElement.prototype;
proto.getContext = () => new Proxy({}, { get: (_, p) => {
  if (p === 'measureText') return (t) => ({ width: String(t).length * 6 });
  if (p === 'createLinearGradient' || p === 'createRadialGradient') return () => ({ addColorStop: noop });
  if (p === 'getImageData') return () => ({ data: [] });
  if (p === 'canvas') return { width: 600, height: 400 };
  if (p === 'setLineDash') return (d) => { dashes.push(JSON.stringify(d)); };
  if (p === 'fillText') return (t, x, y) => { texts.push(String(t)); placed.push({ t: String(t), x, y, align: ctxState.textAlign ?? 'start', base: ctxState.textBaseline ?? 'alphabetic' }); };
  if (p in ctxState) return ctxState[p];
  return noop;
}, set: (_, p, v) => { ctxState[p] = v; return true; } });
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
  dashes = []; texts = []; placed = [];
  const host = document.getElementById('root');
  host.innerHTML = '';
  const chart = renderPlotChart({ waferLabel: () => 'W1' });
  host.appendChild(chart.card);
  chart.setPlot(resolvePlot(spec, items, { testDefs: DEFS, passBins: [1] }));
  chart.destroy();
  return { dashes: new Set(dashes), texts, placed: [...placed] };
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

// ── limit labels on the two axes do not land on each other ───────────────────

/** The box a drawn label covers, from how it was drawn (the fake canvas measures 6px a character, labels are ~11px tall). */
function boxOf({ t, x, y, align, base }) {
  const w = t.length * 6, h = 11;
  const x0 = align === 'right' ? x - w : align === 'center' ? x - w / 2 : x;
  const y0 = base === 'top' ? y : base === 'middle' ? y - h / 2 : y - h + 2;
  return { t, x0, x1: x0 + w, y0, y1: y0 + h };
}
const overlaps = (a, b) => a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;

test('a scatter with a high limit on Y and a low limit on X does not draw their labels on top of each other', () => {
  // Y's high limit is the top line of the plot and X's low limit is its left line: both labels want the top-left corner.
  const defs = [
    { testNumber: 2001, name: 'A', unit: 'V', limitLow: 0.0, limitHigh: 10 },
    { testNumber: 2002, name: 'B', unit: 'V', limitLow: 0, limitHigh: 0.29 },
  ];
  const built = buildWaferMap({
    results: Array.from({ length: 30 }, (_, k) => ({ x: k % 6, y: Math.floor(k / 6), hbin: 1, testValues: { 2001: k / 3, 2002: k / 100 } })),
    testDefs: defs, waferConfig: { diameter: 80 }, dieConfig: { width: 10, height: 10 }, passBins: [1],
  });
  const own = [{ label: 'W1', dies: built.dies, wafer: built.wafer, waferIndex: 0, metadata: built.wafer.metadata, passBins: [1], ringCount: 4 }];
  dashes = []; texts = []; placed = [];
  const host = document.getElementById('root'); host.innerHTML = '';
  const chart = renderPlotChart({ waferLabel: () => 'W1' });
  host.appendChild(chart.card);
  chart.setPlot(resolvePlot({ id: 's', chart: 'scatter', fields: { x: { test: 2001, name: 'A' }, y: { test: 2002, name: 'B' }, color: { none: true } } }, own, { testDefs: defs }));
  chart.destroy();
  const labels = placed.filter(p => /limit/i.test(p.t)).map(boxOf);
  assert.ok(labels.length >= 3, `the limit labels were drawn: ${labels.map(l => l.t).join(' | ')}`);
  for (let i = 0; i < labels.length; i++) for (let j = i + 1; j < labels.length; j++) {
    assert.ok(!overlaps(labels[i], labels[j]), `"${labels[i].t}" and "${labels[j].t}" overlap`);
  }
});
