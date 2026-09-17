// The gallery's card size cap — ported from tests/renderWaferGallery.test.ts,
// which `npm test` never ran (it only runs tests/*.test.mjs) and which mocked the
// whole module graph. These run against the real gallery.
//
// Cards are capped so an ordinary wafer does not monopolise a wide screen, but a
// single fixed cap starves high-DPW wafers of the pixels their dies need, so the
// cap widens with die density (targeting 4px dies) up to a ceiling.

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
const { renderWaferGallery } = await import('../dist/packages/canvas-adapter/index.js');

/** A 300 mm wafer at the given die pitch — the pitch is what sets die density. */
function waferAtPitch(pitchMm, label) {
  const built = buildWaferMap({
    results: [{ x: 0, y: 0, hbin: 1 }, { x: 1, y: 0, hbin: 1 }],
    waferConfig: { diameter: 300 },
    dieConfig: { width: pitchMm, height: pitchMm },
  });
  return { ...built, label };
}

/** Card elements: the grid's children that carry a square max size. */
function cardCaps(root) {
  return [...root.querySelectorAll('div')]
    .filter(d => d.style.maxWidth && d.style.maxWidth === d.style.maxHeight && d.parentElement?.style.display === 'grid')
    .map(d => d.style.maxWidth);
}

function mount(items) {
  const root = dom.window.document.getElementById('root');
  root.innerHTML = '';
  const ctrl = renderWaferGallery(root, items);
  return { caps: cardCaps(root), ctrl };
}

test('an ordinary wafer is capped at 480px rather than stretched to fill the container', () => {
  const { caps, ctrl } = mount([waferAtPitch(10, 'W01')]);
  assert.deepEqual(caps, ['480px']);
  ctrl.destroy();
});

test('the cap widens for a high-DPW wafer so its dies stay readable', () => {
  // 3 mm pitch on 300 mm needs 300·(4/3) + 124 px of card chrome = 524 px for
  // 4 px dies — above the 480 floor, below the 720 ceiling.
  const { caps, ctrl } = mount([waferAtPitch(3, 'W01')]);
  assert.deepEqual(caps, ['524px']);
  ctrl.destroy();
});

test('the cap stops widening at the 720px ceiling', () => {
  // 1 mm pitch would need 1324 px; past the ceiling the dies shrink instead.
  const { caps, ctrl } = mount([waferAtPitch(1, 'W01')]);
  assert.deepEqual(caps, ['720px']);
  ctrl.destroy();
});

test('every card is sized for the densest wafer, not the first one in the lot', () => {
  const { caps, ctrl } = mount([waferAtPitch(10, 'W01'), waferAtPitch(1, 'W02')]);
  assert.deepEqual(caps, ['720px', '720px']);
  ctrl.destroy();
});

// ── Fixed column counts ───────────────────────────────────────────────────────
// The cap is auto layout's: it stops a few cards inflating across a wide
// screen when the library picks the column count. A count the user or host
// picks divides the width that many ways. Both of these regressed: a fixed
// count was still capped (2 columns left the row half empty, 0.21.1–0.30.0),
// and a `columns` option given at mount was never applied at all.

function gridTemplate(root) {
  return [...root.querySelectorAll('div')].find(d => d.style.display === 'grid')?.style.gridTemplateColumns;
}
function cardMaxWidths(root) {
  return [...root.querySelectorAll('.wmap-gallery-card')].map(c => c.style.maxWidth);
}

test('a columns option at mount is applied, and its cards are not capped', () => {
  const root = dom.window.document.getElementById('root');
  root.innerHTML = '';
  const ctrl = renderWaferGallery(root, [waferAtPitch(10, 'W01'), waferAtPitch(10, 'W02')], { columns: 2 });
  assert.match(gridTemplate(root), /^repeat\(2, minmax\(0(px)?, 1fr\)\)$/);
  assert.deepEqual(cardMaxWidths(root), ['none', 'none']);
  ctrl.destroy();
});

test('setColumns switches between a fixed count and auto, restoring the cap on auto', () => {
  const root = dom.window.document.getElementById('root');
  root.innerHTML = '';
  const ctrl = renderWaferGallery(root, [waferAtPitch(10, 'W01'), waferAtPitch(10, 'W02')]);
  assert.deepEqual(cardMaxWidths(root), ['480px', '480px']);

  ctrl.setColumns(2);
  assert.match(gridTemplate(root), /^repeat\(2, minmax\(0(px)?, 1fr\)\)$/);
  assert.deepEqual(cardMaxWidths(root), ['none', 'none']);

  ctrl.setColumns(undefined);
  assert.match(gridTemplate(root), /480px/);
  assert.deepEqual(cardMaxWidths(root), ['480px', '480px']);
  ctrl.destroy();
});

test('an invalid column count falls back to auto; a fraction rounds', () => {
  const root = dom.window.document.getElementById('root');
  root.innerHTML = '';
  const ctrl = renderWaferGallery(root, [waferAtPitch(10, 'W01'), waferAtPitch(10, 'W02')]);
  for (const bad of [0, -3, NaN, Infinity, '2']) {
    ctrl.setColumns(bad);
    assert.deepEqual(cardMaxWidths(root), ['480px', '480px'], `setColumns(${String(bad)}) should mean auto`);
  }
  ctrl.setColumns(2.4);
  assert.match(gridTemplate(root), /^repeat\(2, /);
  ctrl.destroy();
});
