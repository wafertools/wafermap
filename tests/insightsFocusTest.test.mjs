// End-to-end for WMAP_ISSUES #51: a boxplot leaf click in a SINGLE-wafer
// `renderWaferMap` has to reach the map itself — switch it to value mode on the
// clicked test and leave Insights. `insightsReview.test.mjs` pins the tab's own
// half (which host gets `focusTest`); this pins that the host actually wires it
// to the map, which is the part that was missing entirely.

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
proto.toBlob = (cb) => cb(new dom.window.Blob(['x']));
Object.defineProperty(proto, 'clientWidth', { configurable: true, get() { return 600; } });
Object.defineProperty(proto, 'clientHeight', { configurable: true, get() { return 600; } });

const { buildWaferMap } = await import('../dist/index.js');
const { analyzeWaferMap } = await import('../dist/packages/stats/index.js');
const { renderWaferMap } = await import('../dist/packages/canvas-adapter/index.js');

const TEST_DEFS = [
  { testNumber: 1050, name: 'vth_mV', unit: 'mV', limitLow: 9, limitHigh: 13 },
  { testNumber: 1051, name: 'iddq_nA', unit: 'nA', limitLow: 0, limitHigh: 5 },
];

function singleWafer() {
  const wafer = buildWaferMap({
    results: Array.from({ length: 36 }, (_, k) => ({
      x: k % 6, y: Math.floor(k / 6),
      hbin: k % 7 === 0 ? 2 : 1,
      testValues: { 1050: 10 + (k % 4) * 0.05, 1051: 1 + (k % 3) * 0.1 },
    })),
    waferConfig: { diameter: 80, metadata: { lot: 'LOT1', wafer: 'W01' } },
    dieConfig: { width: 10, height: 10 },
    passBins: [1],
    testDefs: TEST_DEFS,
  });
  return { ...wafer, label: 'W01', statsSummary: analyzeWaferMap(wafer) };
}

/** Click the boxplot's only leaf row. JSDOM has no layout, so the canvas is
 *  given a rect and the y placed inside row 0 (PADDING 12, row 24, gap 5). */
function clickBoxplotRow(root) {
  const card = root.querySelector('[data-wmap-chart-title="Test value distribution"]');
  assert.ok(card, 'the Distributions view rendered a boxplot card');
  const canvas = card.querySelector('canvas');
  canvas.getBoundingClientRect = () => ({ top: 0, left: 0, right: 600, bottom: 300, width: 600, height: 300, x: 0, y: 0, toJSON() {} });
  canvas.dispatchEvent(new dom.window.MouseEvent('click', { clientX: 300, clientY: 20, bubbles: true }));
  return card;
}

test('single-wafer boxplot click puts that test on the map and leaves Insights', async () => {
  const root = dom.window.document.getElementById('root');
  root.innerHTML = '';
  const item = singleWafer();
  const ctrl = renderWaferMap(root, item, {
    statsSummary: item.statsSummary,
    insights: { enabled: true, defaultView: 'distributions' },
  });

  assert.notEqual(ctrl.getOptions().plotMode, 'value', 'starts on the default bin mode');

  ctrl.setInsightsOpen(true);
  // The chart suite is a lazily-imported chunk; let it resolve and render.
  await new Promise(r => setTimeout(r, 50));

  // The tab's own root: the absolutely-positioned layer that covers the map.
  const insightsEl = root.querySelector('[data-wmap-chart-grid]').closest('div[style*="absolute"]');
  assert.equal(insightsEl.style.display, 'flex', 'Insights is showing before the click');
  clickBoxplotRow(root);

  const opts = ctrl.getOptions();
  assert.equal(opts.plotMode, 'value', 'the map switched to test-value mode');
  assert.equal(opts.activeTest, 1050, 'on the test the boxplot was showing');
  assert.equal(insightsEl.style.display, 'none',
    'and Insights stepped aside, so the map it just changed is what you see');
  ctrl.destroy();
});

test('the click follows the boxplot to a second test, not just the first', async () => {
  const root = dom.window.document.getElementById('root');
  root.innerHTML = '';
  const item = singleWafer();
  const ctrl = renderWaferMap(root, item, {
    statsSummary: item.statsSummary,
    insights: { enabled: true, defaultView: 'distributions' },
  });
  ctrl.setInsightsOpen(true);
  await new Promise(r => setTimeout(r, 50));

  // Drive the panel's own test selector the way the capability panel's
  // cross-panel link does, then click: the click must carry what the chart is
  // actually showing, never testDefs[0].
  const card = root.querySelector('[data-wmap-chart-title="Test value distribution"]');
  const trigger = [...card.querySelectorAll('button')].find(b => b.getAttribute('aria-label') === 'Test');
  trigger.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  const option = [...dom.window.document.querySelectorAll('[role="option"]')]
    .find(o => o.textContent.trim() === 'iddq_nA');
  assert.ok(option, 'the second test is offered in the panel\'s own picker');
  option.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));

  clickBoxplotRow(root);
  assert.equal(ctrl.getOptions().activeTest, 1051);
  ctrl.destroy();
});

// NOT tested here: the scroll-position restore across a close/reopen. JSDOM has
// no layout, so `scrollTop` is whatever was last assigned and never resets —
// a test would pass with the restore deleted (checked). Verified in the browser
// instead; see wmap's CHANGELOG entry and tsmap's WMAP_ISSUES.md #51.
