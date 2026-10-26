// The map's right-click menu offers Invert selection while dies are selected: the selection becomes the dies it did not hold.

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
const { renderWaferGallery, renderWaferMap } = await import('../dist/packages/canvas-adapter/index.js');

const tick = () => new Promise(r => setTimeout(r, 0));
const waitFor = async (cond, what) => { for (let i = 0; i < 200 && !cond(); i++) await new Promise(r => setTimeout(r, 5)); assert.ok(cond(), what); };
const menus = () => [...document.querySelectorAll('[data-wmap-drilldown-menu]')];

function wafer() {
  return buildWaferMap({
    results: Array.from({ length: 36 }, (_, k) => ({ x: k % 6, y: Math.floor(k / 6), hbin: k % 6 === 0 ? 2 : 1 })),
    waferConfig: { diameter: 80, metadata: { lot: 'L1', waferId: 'W1' } },
    dieConfig: { width: 10, height: 10 }, passBins: [1],
  });
}

test('Invert selection swaps the selection for the dies it did not hold, and is offered only with a selection', async () => {
  const host = document.getElementById('root');
  host.innerHTML = '';
  const w = wafer();
  const ctrl = renderWaferMap(host, w, { insights: { enabled: false } });
  await tick(); await tick();
  const canvas = host.querySelector('canvas');
  const total = w.dies.length;
  const rightClick = () => canvas.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 1, clientY: 1, button: 2 }));
  const items = () => [...menus()[0].querySelectorAll('[role="menuitem"]')];
  const closeMenu = () => menus().forEach(m => m.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));

  rightClick();
  await waitFor(() => menus().length > 0, 'the menu opened with no selection');
  assert.ok(!items().some(i => /Invert selection/.test(i.textContent)), 'nothing selected: nothing to invert');
  closeMenu();
  await waitFor(() => menus().length === 0, 'the menu closed');

  const chosen = w.dies.filter(d => d.hbin === 2);
  ctrl.setSelection(chosen);
  rightClick();
  await waitFor(() => menus().length > 0, 'the menu opened with a selection');
  const row = items().find(i => /Invert selection/.test(i.textContent));
  assert.ok(row, 'Invert selection is offered');
  row.click();
  await waitFor(() => ctrl.getSelectedDies().length !== chosen.length, 'the selection changed');
  const now = ctrl.getSelectedDies();
  assert.equal(now.length, total - chosen.length);
  assert.ok(now.every(d => d.hbin === 1), 'exactly the dies that were not selected');
  ctrl.destroy();
});
