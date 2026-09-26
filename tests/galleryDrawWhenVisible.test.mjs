// Gallery cards draw only while on (or near) the screen: on a 25-wafer lot most
// cards sit below the fold, and drawing them made up most of a mode switch.
// A card that skipped drawing must still be drawn for anything that captures
// the canvases — printing (`beforeprint`) and the gallery PNG — and when it
// scrolls into view. A standalone map is never deferred.

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
dom.window.devicePixelRatio = 1;

// An IntersectionObserver the test drives: nothing is reported until `show`.
const observers = [];
class FakeIntersectionObserver {
  constructor(cb) { this.cb = cb; this.els = []; observers.push(this); }
  observe(el) { this.els.push(el); }
  unobserve() {}
  disconnect() { this.els = []; }
}
dom.window.IntersectionObserver = FakeIntersectionObserver;
const show = (el) => { for (const o of observers) if (o.els.includes(el)) o.cb([{ target: el, isIntersecting: true }]); };

// Canvas stub counting die fills per canvas.
const fills = new WeakMap();
const noop = () => {};
const proto = dom.window.HTMLCanvasElement.prototype;
proto.getContext = function () {
  const canvas = this;
  return new Proxy({}, { get: (_, p) => {
    if (p === 'fill') return () => fills.set(canvas, (fills.get(canvas) ?? 0) + 1);
    if (p === 'measureText') return (t) => ({ width: String(t).length * 6 });
    if (p === 'createLinearGradient' || p === 'createRadialGradient') return () => ({ addColorStop: noop });
    if (p === 'getImageData') return () => ({ data: [] });
    if (p === 'canvas') return canvas;
    return noop;
  } });
};
proto.toBlob = noop;
proto.focus = noop; proto.setPointerCapture = noop; proto.releasePointerCapture = noop;
Object.defineProperty(proto, 'clientWidth', { configurable: true, get() { return 400; } });
Object.defineProperty(proto, 'clientHeight', { configurable: true, get() { return 400; } });

const { buildWaferMap } = await import('../dist/index.js');
const { renderWaferGallery, renderWaferMap } = await import('../dist/packages/canvas-adapter/index.js');

function wafer(label) {
  const results = [];
  for (let x = -3; x <= 3; x++) for (let y = -3; y <= 3; y++) results.push({ x, y, hbin: (x + y) & 1 ? 1 : 2 });
  return { ...buildWaferMap({ results, waferConfig: { diameter: 100 }, dieConfig: { width: 10, height: 10 } }), label };
}

const root = () => dom.window.document.getElementById('root');
const cardCanvases = () => [...root().querySelectorAll('.wmap-gallery-card canvas')];
const drawn = (c) => (fills.get(c) ?? 0) > 0;

test('a gallery card is not drawn until it is on screen, and is drawn when it is', () => {
  root().innerHTML = '';
  const ctrl = renderWaferGallery(root(), [wafer('W1'), wafer('W2'), wafer('W3')]);
  const cards = cardCanvases();
  assert.equal(cards.length, 3);
  assert.deepEqual(cards.map(drawn), [false, false, false], 'nothing is on screen yet');
  show(cards[1]);
  assert.deepEqual(cards.map(drawn), [false, true, false], 'only the card reported on screen is drawn');
  ctrl.destroy();
});

test('printing draws every card, on screen or not', () => {
  root().innerHTML = '';
  const ctrl = renderWaferGallery(root(), [wafer('W1'), wafer('W2'), wafer('W3')]);
  const cards = cardCanvases();
  assert.ok(cards.every(c => !drawn(c)));
  dom.window.dispatchEvent(new dom.window.Event('beforeprint'));
  assert.ok(cards.every(drawn), 'beforeprint must leave no card blank');
  ctrl.destroy();
});

test('the gallery PNG draws every card before composing them', () => {
  root().innerHTML = '';
  const ctrl = renderWaferGallery(root(), [wafer('W1'), wafer('W2'), wafer('W3')], { onSaveImage: () => {} });
  const cards = cardCanvases();
  assert.ok(cards.every(c => !drawn(c)));
  const btn = [...root().querySelectorAll('button')].find(b => (b.getAttribute('aria-label') ?? b.title ?? '').includes('Download gallery PNG'));
  assert.ok(btn, 'the gallery PNG button exists');
  btn.click();
  assert.ok(cards.every(drawn), 'no card may be composed blank');
  ctrl.destroy();
});

test('a standalone map draws at once, with no visibility report', () => {
  root().innerHTML = '';
  const el = dom.window.document.createElement('div');
  root().appendChild(el);
  const ctrl = renderWaferMap(el, wafer('W1'));
  assert.ok(drawn(el.querySelector('canvas')), 'a single map is never deferred');
  ctrl.destroy();
});
