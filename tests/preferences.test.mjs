// Which view options are preferences (kept between sessions) and which describe the data on screen, and the
// Insights charts' axis settings reported like any other preference.
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
const proto = dom.window.HTMLCanvasElement.prototype;
proto.getContext = () => new Proxy({}, { get: (_, p) => {
  if (p === 'measureText') return (t) => ({ width: String(t).length * 6 });
  if (p === 'createLinearGradient' || p === 'createRadialGradient') return () => ({ addColorStop: noop });
  if (p === 'getImageData') return () => ({ data: [] });
  if (p === 'canvas') return { width: 400, height: 400 };
  return noop;
} });
proto.focus = noop; proto.setPointerCapture = noop; proto.releasePointerCapture = noop;
Object.defineProperty(proto, 'clientWidth', { configurable: true, get() { return 400; } });
Object.defineProperty(proto, 'clientHeight', { configurable: true, get() { return 400; } });

const { buildWaferMap } = await import('../dist/index.js');
const { renderWaferMap, renderWaferGallery, WAFER_PREFERENCE_KEYS } = await import('../dist/packages/canvas-adapter/index.js');
const { classifyChanged } = await import('../dist/packages/canvas-adapter/renderWaferMap.js');

const map = (label) => ({
  ...buildWaferMap({
    results: [0, 1, 2, 3].map(i => ({ x: i % 2, y: Math.floor(i / 2), hbin: 1, testValues: { 1: i } })),
    waferConfig: { diameter: 60 }, dieConfig: { width: 10, height: 10 }, passBins: [1],
  }),
  label,
});

test('settings that describe the data on screen are state, not preferences', () => {
  // Orientation is relative to this data, the compact layout suits one kind of wafer, and log scale
  // follows the test: carried to another lot each would describe it wrongly.
  for (const key of ['rotation', 'flipX', 'flipY', 'compact', 'logScale']) {
    assert.ok(!WAFER_PREFERENCE_KEYS.includes(key), `${key} is not a preference`);
    assert.equal(classifyChanged([key]), 'state', key);
  }
  for (const key of ['binColorScheme', 'showRingBoundaries', 'legendPosition', 'chartClipOutliers', 'chartLimitLines']) {
    assert.ok(WAFER_PREFERENCE_KEYS.includes(key), `${key} is a preference`);
    assert.equal(classifyChanged([key]), 'preference', key);
  }
  assert.equal(classifyChanged(['binColorScheme', 'rotation']), 'mixed');
});

test('the charts\' axis settings are set like any preference, reported, and redraw no map', () => {
  const root = dom.window.document.getElementById('root');
  root.innerHTML = '';
  const seen = [];
  const ctrl = renderWaferMap(root, map('W01'), {
    viewOptions: { chartClipOutliers: true },
    onViewOptionsChange: (opts, keys, category) => seen.push({ opts, keys, category }),
  });
  assert.equal(ctrl.getOptions().chartClipOutliers, true);
  ctrl.setOptions({ chartLimitLines: 'spec' });
  assert.equal(ctrl.getOptions().chartLimitLines, 'spec');
  assert.equal(seen.length, 0, 'a setting the host made itself is not reported back to it');
  ctrl.destroy();
});

test('a gallery reports a chart setting as a preference without rebuilding its cards', () => {
  const root = dom.window.document.getElementById('root');
  root.innerHTML = '';
  const seen = [];
  const ctrl = renderWaferGallery(root, [map('W01'), map('W02')], {
    onViewOptionsChange: (opts, keys, category) => seen.push({ opts, keys, category }),
  });
  const cardsBefore = [...root.querySelectorAll('.wmap-gallery-card')];
  ctrl.setOptions({ chartAxisIncludesLimits: true });
  assert.equal(ctrl.getOptions().chartAxisIncludesLimits, true);
  const cardsAfter = [...root.querySelectorAll('.wmap-gallery-card')];
  assert.equal(cardsAfter.length, cardsBefore.length);
  assert.ok(cardsAfter.every((c, i) => c === cardsBefore[i]), 'the same card elements: nothing was rebuilt');
  ctrl.destroy();
});
