// A mark that counts dies opens the same menu on a click and on a right-click, on every Insights chart type that has
// one (bars, histogram bars, heatmap cells, line points; the heatmap is checked in the browser, as jsdom draws it too small to hit); a wafer's own mark opens that wafer on a click and its menu on
// a right-click. Nothing is left to find out by trying both buttons on every card.

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
const proto = dom.window.HTMLCanvasElement.prototype;
proto.getContext = () => new Proxy({}, { get: (_, p) => {
  if (p === 'measureText') return (t) => ({ width: String(t).length * 6 });
  if (p === 'createLinearGradient' || p === 'createRadialGradient') return () => ({ addColorStop: noop });
  if (p === 'getImageData') return () => ({ data: [] });
  if (p === 'canvas') return { width: 600, height: 600 };
  return noop;
} });
proto.focus = noop;
Object.defineProperty(proto, 'clientWidth', { configurable: true, get() { return 600; } });
Object.defineProperty(proto, 'clientHeight', { configurable: true, get() { return 600; } });
Object.defineProperty(window.HTMLElement.prototype, 'clientWidth', { configurable: true, get() { return 600; } });
Object.defineProperty(window.HTMLElement.prototype, 'clientHeight', { configurable: true, get() { return 400; } });

const { buildWaferMap } = await import('../dist/index.js');
const { renderPlotChart } = await import('../dist/packages/canvas-adapter/charts/plotChart.js');
const { resolvePlot } = await import('../dist/packages/stats/plotData.js');

const wafer = (id, fail) => {
  const r = buildWaferMap({
    results: Array.from({ length: 100 }, (_, k) => ({ x: k % 10, y: Math.floor(k / 10), hbin: k < fail ? 2 : 1, testValues: { 1000: k % 17 } })),
    testDefs: [{ testNumber: 1000, name: 'T', unit: 'V' }],
    waferConfig: { diameter: 30, metadata: { waferId: id } }, dieConfig: { width: 2, height: 2 }, passBins: [1],
  });
  return { label: id, dies: r.dies, metadata: r.metadata, passBins: [1], ringCount: r.ringCount, wafer: r.wafer, waferIndex: Number(id.slice(1)) };
};
const items = [wafer('W0', 5), wafer('W1', 20), wafer('W2', 12)];

/** What a sweep of the canvas with `type` events reaches: the distinct populations handed to the selection handler, and whether the browser's menu was left alone for them. */
async function sweep(spec, type, { step, xMax, yMax }) {
  const picked = new Set();
  let prevented = 0, events = 0;
  const chart = renderPlotChart({ onSelectPoints: (points) => { picked.add(points.map(p => `${p.item}:${p.die ? p.die.x + ',' + p.die.y : ''}`).sort().join('|')); } });
  document.getElementById('root').appendChild(chart.card);
  chart.setPlot(resolvePlot(spec, items, {}));
  await new Promise(r => setTimeout(r, 60));
  const canvas = chart.card.querySelector('canvas');
  // The canvas is laid out at a fraction of its size under jsdom, so the sweep is fine-grained.
  for (let y = 0; y < yMax; y += step) for (let x = 0; x < xMax; x += step) {
    const e = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: type === 'contextmenu' ? 2 : 0 });
    canvas.dispatchEvent(e);
    events++;
    if (e.defaultPrevented) prevented++;
  }
  chart.destroy(); chart.card.remove();
  return { picked, prevented, events };
}

for (const [name, spec] of [
  ['a bar of dies by ring', { id: 'a', chart: 'bar', fields: { x: { builtin: 'ring' }, y: { builtin: 'yield' }, color: { none: true } } }],
  ['a histogram', { id: 'b', chart: 'histogram', fields: { y: { test: 1000 }, color: { none: true } } }],
]) {
  test(`${name}: a right-click opens the menu on the same dies as a click, and takes over the browser menu`, async () => {
    const grid = { step: 7, xMax: 700, yMax: 700 };
    const click = await sweep(spec, 'click', grid), right = await sweep(spec, 'contextmenu', grid);
    assert.ok(click.picked.size > 0, 'the click reaches some marks');
    assert.deepEqual([...right.picked].sort(), [...click.picked].sort());
    assert.ok(right.prevented > 0, 'the browser menu is left alone only where the library opens its own');
  });
}
