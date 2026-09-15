// Opening Insights in a single-wafer `renderWaferMap` must hide the map view's
// own overlays, not just paint the chart suite over the canvas. A fully
// coordinate-less wafer (no x/y) shows a "No die position data" summary as a
// z-indexed overlay inside canvasWrap; the Insights element is `z-index: auto`,
// so the overlay stayed on top of the chart suite (tsmap,
// NO-WAFER-ALL-COORDLESS-01.csv). The same applied to a mixed wafer's
// unpositioned-dies footer.

import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { pretendToBeVisual: true, url: 'http://localhost/' });
for (const k of ['window', 'document', 'HTMLElement', 'HTMLCanvasElement', 'HTMLDivElement', 'HTMLButtonElement', 'Node', 'Event', 'MouseEvent', 'PointerEvent', 'KeyboardEvent', 'CustomEvent', 'Blob', 'DOMRect', 'URL']) {
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

const TEST_DEFS = [{ testNumber: 3001, name: 'vth', unit: 'mV' }];

/** Walk up from `el` to the map root. `display: none` anywhere hides it;
 *  `visibility` inherits, so the NEAREST explicit value wins (a child set
 *  `visible` shows inside a `hidden` ancestor). */
function isHidden(el, root) {
  let visibility;
  for (let n = el; n && n !== root; n = n.parentElement) {
    if (n.style.display === 'none') return true;
    if (visibility === undefined && n.style.visibility) visibility = n.style.visibility;
  }
  return visibility === 'hidden';
}

/** Same walk, ignoring `display` — for an element that is display:none only
 *  because it is collapsed, where the question is whether it WOULD show. */
function isVisibilityHidden(el, root) {
  for (let n = el; n && n !== root; n = n.parentElement) {
    if (n.style.visibility) return n.style.visibility === 'hidden';
  }
  return false;
}

function findByText(root, text) {
  return [...root.querySelectorAll('span, div')].find(n => n.childElementCount === 0 && n.textContent.includes(text));
}

async function toggleInsights(root, open) {
  const btn = root.querySelector('[data-wmap-insights-btn]');
  assert.ok(btn, 'the toolbar carries an Insights toggle');
  const isOpen = btn.ariaLabel !== 'Insights';
  if (isOpen !== open) btn.click();
  // The chart suite is a dynamic import; let it resolve.
  for (let i = 0; i < 20; i++) await new Promise(r => setTimeout(r, 0));
}

for (const [name, results, text] of [
  ['coordinate-less wafer — mapless summary overlay',
    Array.from({ length: 11 }, (_, k) => ({ hbin: k % 3 === 0 ? 2 : 1, testValues: { 3001: 10 + k * 0.25 } })),
    'No die position data'],
  ['mixed wafer — unpositioned-dies footer',
    [
      ...Array.from({ length: 16 }, (_, k) => ({ x: k % 4, y: Math.floor(k / 4), hbin: 1, testValues: { 3001: 10 } })),
      { hbin: 2, testValues: { 3001: 11 } },
    ],
    'without position data'],
]) {
  test(`Insights hides the map view's overlays: ${name}`, async () => {
    const root = dom.window.document.getElementById('root');
    root.innerHTML = '';
    const result = buildWaferMap({ results, testDefs: TEST_DEFS, passBins: [1] });
    const ctrl = renderWaferMap(root, result, { insights: { enabled: true } });

    const overlay = findByText(root, text);
    assert.ok(overlay, `rendered "${text}"`);
    assert.equal(isHidden(overlay, root), false, 'visible on the map view');

    await toggleInsights(root, true);
    assert.equal(isHidden(overlay, root), true, 'hidden while Insights is open');

    await toggleInsights(root, false);
    assert.equal(isHidden(overlay, root), false, 'visible again after leaving Insights');
    ctrl.destroy?.();
  });
}

// The identity row stays up in both views, so its details panel — mounted
// inside the hidden map view — must still be able to open in Insights. JSDOM
// has no layout, so the row always "fits inline" and cannot be expanded by a
// click here; this pins the visibility exemption that lets it show.
test('Insights keeps the identity details panel openable', async () => {
  const root = dom.window.document.getElementById('root');
  root.innerHTML = '';
  const result = buildWaferMap({
    results: Array.from({ length: 11 }, (_, k) => ({ hbin: 1, testValues: { 3001: 10 + k } })),
    waferConfig: { metadata: { lot: 'LOT1', wafer: 'W01', operator: 'x' } },
    testDefs: TEST_DEFS, passBins: [1],
  });
  const ctrl = renderWaferMap(root, result, { insights: { enabled: true } });
  const metaPanel = root.querySelector('[data-wmap-meta-panel]');
  assert.ok(metaPanel, 'identity details panel mounted');

  await toggleInsights(root, true);
  assert.equal(isHidden(findByText(root, 'No die position data'), root), true, 'map view hidden');
  assert.equal(isVisibilityHidden(metaPanel, root), false, 'details panel not hidden with the map view');
  ctrl.destroy?.();
});
