// The Insights tab's Columns control and keys 0 to 5: one preference for every chart grid in the tab, carried as CSS variables.

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
const noop = () => {};
dom.window.HTMLCanvasElement.prototype.getContext = () => new Proxy({}, { get: (_, p) => {
  if (p === 'measureText') return (t) => ({ width: String(t).length * 6 });
  if (p === 'createLinearGradient' || p === 'createRadialGradient') return () => ({ addColorStop: noop });
  if (p === 'getImageData') return () => ({ data: [] });
  return noop;
}, set: () => true });

const { buildWaferMap } = await import('../dist/index.js');
const { renderWaferGallery } = await import('../dist/packages/canvas-adapter/index.js');

const wafer = label => ({
  ...buildWaferMap({
    results: Array.from({ length: 60 }, (_, k) => ({ x: k % 10, y: Math.floor(k / 10), hbin: k % 7 === 0 ? 2 : 1, testValues: { 1: 5 + (k % 10) / 10 } })),
    waferConfig: { diameter: 30 }, dieConfig: { width: 2, height: 2 }, passBins: [1],
    testDefs: [{ testNumber: 1, name: 'Vth', unit: 'V', limitLow: 0, limitHigh: 10 }],
  }), label,
});
const waitFor = async (cond, what) => { for (let i = 0; i < 300 && !cond(); i++) await new Promise(r => setTimeout(r, 5)); assert.ok(cond(), what); };
const press = (el, key, init = {}) => el.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }));

async function openInsights() {
  const root = document.getElementById('root');
  root.innerHTML = '';
  const ctrl = renderWaferGallery(root, [wafer('W01'), wafer('W02')], { insights: { enabled: true, defaultOpen: true } });
  await waitFor(() => root.querySelector('[data-wmap-chart-grid]'), 'the Overview grid');
  const tab = root.querySelector('[data-wmap-chart-grid]').closest('div[style*="--wmap-insights"], div[style*="flex"]');
  return { root, ctrl, grid: root.querySelector('[data-wmap-chart-grid]') };
}
const cols = grid => {
  let el = grid;
  while (el) { const v = el.style?.getPropertyValue('--wmap-insights-cols'); if (v) return v; el = el.parentElement; }
  return '';
};

test('the number keys set every chart grid\'s columns in the Insights tab, and 0 returns to auto', async () => {
  const { root, ctrl, grid } = await openInsights();
  assert.equal(cols(grid), '');
  assert.match(grid.style.gridTemplateColumns, /var\(--wmap-insights-cols, auto-fit\)/);
  press(document.body, '3');
  assert.equal(cols(grid), '3');
  press(document.body, '5');
  assert.equal(cols(grid), '5');
  press(document.body, '0');
  assert.equal(cols(grid), '');
  ctrl.destroy();
});

test('the Insights column keys leave modified keys, other digits and text boxes alone', async () => {
  const { root, ctrl, grid } = await openInsights();
  press(document.body, '2', { ctrlKey: true });
  press(document.body, '2', { shiftKey: true });
  press(document.body, '7');
  const input = document.createElement('input');
  root.appendChild(input);
  press(input, '2');
  assert.equal(cols(grid), '');
  ctrl.destroy();
  press(document.body, '4');   // a destroyed tab no longer answers
  assert.equal(cols(grid), '');
});
