// The PAT verdict maps open in a window as a gallery with one card per wafer.

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
// One recorder per canvas: a drawing context whose `lineWidth` assignments are logged. The located-die
// ring is the only thing drawn with a 6px halo, so a "lw6" is the ring.
const logs = new WeakMap();
const ctxs = new WeakMap();
proto.getContext = function () {
  if (ctxs.has(this)) return ctxs.get(this);
  const log = [];
  logs.set(this, log);
  const store = {};
  const ctx = new Proxy(store, {
    get: (t, p) => {
      if (p in t) return t[p];
      if (p === 'measureText') return (s) => ({ width: String(s).length * 6 });
      if (p === 'createLinearGradient' || p === 'createRadialGradient') return () => ({ addColorStop: noop });
      if (p === 'getImageData') return () => ({ data: [] });
      if (p === 'canvas') return { width: 600, height: 600 };
      return noop;
    },
    set: (t, p, v) => { t[p] = v; if (p === 'lineWidth') log.push('lw' + v); return true; },
  });
  ctxs.set(this, ctx);
  return ctx;
};
proto.focus = noop; proto.setPointerCapture = noop; proto.releasePointerCapture = noop;
Object.defineProperty(proto, 'clientWidth', { configurable: true, get() { return 600; } });
Object.defineProperty(proto, 'clientHeight', { configurable: true, get() { return 600; } });
dom.window.HTMLElement.prototype.scrollIntoView = function () { (globalThis.__scrolled ??= []).push(this); };


const { buildWaferMap } = await import('../dist/index.js');
const { openPatMaps } = await import('../dist/packages/canvas-adapter/patMaps.js');

const waitFor = async (cond, what) => { for (let i = 0; i < 300 && !cond(); i++) await new Promise(r => setTimeout(r, 5)); assert.ok(cond(), what); };
const DEFS = [{ testNumber: 1, name: 'Vth', unit: 'V', limitLow: 0, limitHigh: 10 }];
const mk = () => {
  const results = Array.from({ length: 100 }, (_, k) => ({ x: k % 10, y: Math.floor(k / 10), hbin: 1, testValues: { 1: k === 90 ? 5.9 : 5 + ((k % 10) - 4.5) / 50 } }));
  return buildWaferMap({ results, waferConfig: { diameter: 30 }, dieConfig: { width: 2, height: 2 }, passBins: [1], testDefs: DEFS });
};

test('the verdict maps open as a gallery of one card per wafer, and close cleanly', async () => {
  const anchor = document.createElement('button');
  document.getElementById('root').appendChild(anchor);
  const a = mk(), b = mk();
  openPatMaps({ anchor, testDefs: DEFS, items: [{ label: 'W1', dies: a.dies, passBins: [1], source: a }, { label: 'W2', dies: b.dies, passBins: [1], source: b }] });
  await waitFor(() => document.querySelectorAll('canvas').length >= 2, 'the cards');
  assert.match(document.body.textContent, /PAT verdicts by wafer/);
  assert.match(document.body.textContent, /PAT outlier/, 'the legend names the verdicts');
  assert.doesNotMatch(document.body.textContent, /hard bin/i, 'nothing calls a verdict a hard bin');
});
