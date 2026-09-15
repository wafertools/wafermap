// The chrome row above the map holds the identity (left) and the toolbar
// (right). Its own comment says it "collapses to nothing when it holds
// neither" — it did not. The row is built unconditionally and filled later, so
// with `showToolbar: false` and nothing to identify it still painted
// `chromeInset` on three sides plus `paddingBottom` in the CANVAS background:
// an empty ~34px band of colour above every such map. The expand-modal path
// already tested `childElementCount > 0` before reparenting the row; the page
// path never did. (Code-review finding, 2026-09-09.)

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
proto.focus = noop; proto.setPointerCapture = noop; proto.releasePointerCapture = noop;
Object.defineProperty(proto, 'clientWidth', { configurable: true, get() { return 600; } });
Object.defineProperty(proto, 'clientHeight', { configurable: true, get() { return 600; } });

const { buildWaferMap } = await import('../dist/index.js');
const { renderWaferMap } = await import('../dist/packages/canvas-adapter/index.js');

function wafer(metadata) {
  return buildWaferMap({
    results: Array.from({ length: 24 }, (_, k) => ({ x: k % 6, y: Math.floor(k / 6), hbin: k % 7 === 0 ? 2 : 1 })),
    waferConfig: { diameter: 80, ...(metadata ? { metadata } : {}) },
    dieConfig: { width: 10, height: 10 },
    passBins: [1],
  });
}

/** The chrome row: the one flex row above the map carrying the inset padding. */
function chromeRow(host) {
  const row = [...host.querySelectorAll('div')]
    .find(d => d.style.alignItems === 'stretch' && d.style.paddingBottom && d.style.display !== '');
  return row ?? [...host.querySelectorAll('div')]
    .find(d => d.style.alignItems === 'stretch' && d.style.paddingBottom);
}

function render(options, metadata) {
  const host = dom.window.document.getElementById('root');
  host.innerHTML = '';
  const ctrl = renderWaferMap(host, wafer(metadata), options);
  return { host, ctrl, row: chromeRow(host) };
}

test('nothing to show: the row is display:none, not a band of canvas background', () => {
  const { ctrl, row } = render({ showToolbar: false, showIdentity: false });
  assert.ok(row, 'the row exists in the DOM');
  assert.equal(row.style.display, 'none');
  ctrl.destroy();
});

test('a toolbar alone earns the row', () => {
  const { ctrl, row } = render({ showToolbar: true, showIdentity: false });
  assert.equal(row.style.display, 'flex');
  ctrl.destroy();
});

test('an identity alone earns the row', () => {
  const { ctrl, row } = render({ showToolbar: false, showIdentity: true }, { lot: 'LOT-A', wafer: 'W01' });
  assert.equal(row.style.display, 'flex');
  ctrl.destroy();
});

