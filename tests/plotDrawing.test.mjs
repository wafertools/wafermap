// What the plot chart puts on the canvas: a goal plot names the tests it can without writing one name over another.

import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { pretendToBeVisual: true, url: 'http://localhost/' });
for (const k of ['window', 'document', 'HTMLElement', 'HTMLCanvasElement', 'HTMLDivElement', 'HTMLButtonElement', 'Node', 'Event', 'MouseEvent', 'KeyboardEvent', 'CustomEvent', 'Blob', 'DOMRect', 'URL']) {
  if (dom.window[k]) globalThis[k] = dom.window[k];
}
globalThis.window = dom.window; globalThis.document = dom.window.document;
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
globalThis.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
const mm = () => ({ matches: false, media: '', addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false });
dom.window.matchMedia = mm; globalThis.matchMedia = mm;
class FakeResizeObserver { observe() {} unobserve() {} disconnect() {} }
dom.window.ResizeObserver = FakeResizeObserver; globalThis.ResizeObserver = FakeResizeObserver;
const noop = () => {};
let fills = [];     // the fillStyle of each fill() call, in order
let placed = [];    // each fillText: { t, x, y, align }
const state = {};
const proto = dom.window.HTMLCanvasElement.prototype;
proto.getContext = () => new Proxy({}, { get: (_, p) => {
  if (p === 'measureText') return (t) => ({ width: String(t).length * 6 });
  if (p === 'createLinearGradient' || p === 'createRadialGradient') return () => ({ addColorStop: noop });
  if (p === 'getImageData') return () => ({ data: [] });
  if (p === 'canvas') return { width: 600, height: 400 };
  if (p === 'fill') return () => { fills.push(state.fillStyle); };
  if (p === 'fillText') return (t, x, y) => { placed.push({ t: String(t), x, y, align: state.textAlign ?? 'start' }); };
  if (p in state) return state[p];
  return noop;
}, set: (_, p, v) => { state[p] = v; return true; } });
proto.focus = noop; proto.setPointerCapture = noop; proto.releasePointerCapture = noop;
Object.defineProperty(proto, 'clientWidth', { configurable: true, get() { return 600; } });
Object.defineProperty(proto, 'clientHeight', { configurable: true, get() { return 400; } });
// A card body has a width to lay the plot out in.
Object.defineProperty(dom.window.HTMLElement.prototype, 'clientWidth', { configurable: true, get() { return 600; } });

const { buildWaferMap } = await import('../dist/index.js');
const { resolvePlot } = await import('../dist/packages/stats/plotData.js');
const { renderPlotChart } = await import('../dist/packages/canvas-adapter/charts/plotChart.js');

function draw(spec, items, defs) {
  fills = []; placed = [];
  const host = document.getElementById('root');
  host.innerHTML = '';
  const chart = renderPlotChart({ waferLabel: () => 'W' });
  host.appendChild(chart.card);
  chart.setPlot(resolvePlot(spec, items, { testDefs: defs, passBins: [1] }));
  chart.destroy();
}

test('a goal plot names tests without writing one name over another', () => {
  const defs = Array.from({ length: 8 }, (_, i) => ({ testNumber: i + 1, name: `Test${i + 1}`, limitLow: 0, limitHigh: 1 }));
  const r = buildWaferMap({
    results: Array.from({ length: 40 }, (_, k) => ({ x: k % 8, y: Math.floor(k / 8), hbin: 1, testValues: Object.fromEntries(defs.map(d => [d.testNumber, 0.1 + 0.8 * ((k % 10) / 9)])) })),
    waferConfig: { diameter: 80 }, dieConfig: { width: 10, height: 10 }, passBins: [1], testDefs: defs,
  });
  const items = [{ label: 'W1', dies: r.dies, wafer: r.wafer, waferIndex: 0, metadata: r.metadata, passBins: [1], ringCount: 4 }];
  draw({ id: 'g', chart: 'goal', fields: {} }, items, defs);
  const names = placed.filter(p => /^Test\d$/.test(p.t));
  assert.ok(names.length >= 1, 'the crowded tests are not all dropped');
  assert.ok(names.length < 8, 'identical points cannot all be named');
  const box = (p) => { const w = p.t.length * 6, x0 = p.align === 'left' ? p.x : p.align === 'right' ? p.x - w : p.x - w / 2; return { x0, x1: x0 + w, y0: p.y - 6, y1: p.y + 6 }; };
  for (let i = 0; i < names.length; i++) for (let j = i + 1; j < names.length; j++) {
    const a = box(names[i]), b = box(names[j]);
    assert.ok(!(a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0), `${names[i].t} and ${names[j].t} overlap`);
  }
});
