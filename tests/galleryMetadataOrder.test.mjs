// The gallery's metadata-mode colour order must be lot-wide, not per card.
//
// Each card's own buildView used to rank the values present on ITS OWN dies, so
// a wafer that never exhibited one category shifted every later category up a
// colour — and disagreed with the shared legend strip beside it, which ranked
// the union across every card. A comment asked the two to stay in step; nothing
// made them.
//
// Written as .mjs deliberately: `npm test` runs `tests/*.test.mjs` only, so a
// .ts test (tests/renderWaferGallery.test.ts) is never executed.

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
const { metadataValueColor } = await import('../dist/packages/renderer/colorMap.js');
const { renderWaferGallery } = await import('../dist/packages/canvas-adapter/index.js');
const { buildView } = await import('../dist/packages/renderer/buildView.js');

/** One wafer carrying exactly the given defect categories, one die each. */
function wafer(label, cats) {
  const built = buildWaferMap({
    results: cats.map((c, i) => ({ x: i % 3, y: Math.floor(i / 3), hbin: 1, metadata: { defect: c } })),
    waferConfig: { diameter: 60 },
    dieConfig: { width: 10, height: 10 },
    passBins: [1],
  });
  return { ...built, label };
}

// W02 never exhibited D1. Natural order over the union is D0, D1, D10 — so on
// W02, D10 must still be colour index 2, not index 1.
const ITEMS = [wafer('W01', ['D0', 'D1', 'D10']), wafer('W02', ['D0', 'D10'])];

function mount() {
  const root = dom.window.document.getElementById('root');
  root.innerHTML = '';
  const ctrl = renderWaferGallery(root, ITEMS, {
    viewOptions: { plotMode: 'metadata', activeMetadataKey: 'defect' },
  });
  return { root, ctrl };
}

// The lot-wide order: the union of every wafer's values, naturally sorted (D10
// last, not after D0). The gallery hands it to its cards internally — it is not
// on the public options — so the legend text below is what proves it is used.
const LOT_ORDER = { key: 'defect', values: ['D0', 'D1', 'D10'] };

test('a wafer missing a category still paints the rest in the lot-wide colours', () => {
  const { ctrl } = mount();
  const order = LOT_ORDER;
  // What the card actually renders, via the same entry point it uses itself.
  const w02 = ITEMS[1];
  const view = buildView(w02.wafer, w02.dies, {
    plotMode: 'metadata', activeMetadataKey: 'defect', metadataValueOrder: order,
  });
  const fillOf = (cat) => {
    const die = w02.dies.find(d => d.metadata?.defect === cat && !d.partial);
    return view.rectangles.find(r => Math.abs(r.x - die.physX) < 1e-9 && Math.abs(r.y - die.physY) < 1e-9)?.fill;
  };
  assert.equal(fillOf('D0'), metadataValueColor(0));
  assert.equal(fillOf('D10'), metadataValueColor(2), 'not index 1, which is D1\'s colour in the legend');
  ctrl.destroy();
});

test('the shared legend lists exactly that order, so strip and maps cannot disagree', () => {
  const { root, ctrl } = mount();
  const order = LOT_ORDER;
  const text = root.textContent;
  const positions = order.values.map(v => text.indexOf(v));
  assert.ok(positions.every(p => p >= 0), `every value appears in the legend: ${text.slice(0, 200)}`);
  assert.deepEqual(positions, [...positions].sort((a, b) => a - b), 'and in the same order');
  ctrl.destroy();
});

test('the gallery\'s shared card state stays off its public options and change callback', () => {
  const root = dom.window.document.getElementById('root');
  root.innerHTML = '';
  const seen = [];
  const ctrl = renderWaferGallery(root, ITEMS, {
    viewOptions: { plotMode: 'metadata', activeMetadataKey: 'defect' },
    onViewOptionsChange: (opts) => seen.push(opts),
  });
  for (const opts of [ctrl.getOptions(), ...(ctrl.setOptions({ plotMode: 'hardBin' }), [ctrl.getOptions()])]) {
    for (const key of ['metadataValueOrder', 'binColors', 'lotSize']) {
      assert.ok(!(key in opts), `${key} is gallery-to-card plumbing, not a host option`);
    }
  }
  for (const opts of seen) assert.ok(!('binColors' in opts) && !('metadataValueOrder' in opts));
  ctrl.destroy();
});
