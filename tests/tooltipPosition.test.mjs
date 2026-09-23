// The shared hover tooltip steps around a small ANCHOR (a toolbar button must
// not be covered by its own tip) — but a map canvas is not something to step
// around: the pointer is on the die the tip describes. Stepping clear of the
// whole canvas threw the tip hundreds of pixels below a gallery card, and below
// any map under 40% of the window tall.

import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
Object.defineProperty(dom.window, 'innerWidth', { value: 1400 });
Object.defineProperty(dom.window, 'innerHeight', { value: 1000 });

const { getTooltip, positionTooltip } = await import('../dist/packages/canvas-adapter/toolbar.js');

/** An anchor 368px tall — a gallery card's canvas in a 1000px window. */
function anchor() {
  const el = document.createElement('canvas');
  document.body.appendChild(el);
  el.getBoundingClientRect = () => ({ left: 20, right: 420, top: 500, bottom: 868, width: 400, height: 368 });
  return el;
}

const tip = () => {
  const t = getTooltip(document);
  Object.defineProperty(t, 'offsetWidth', { value: 200, configurable: true });
  Object.defineProperty(t, 'offsetHeight', { value: 70, configurable: true });
  return t;
};

test('a map tooltip follows the pointer, whatever the canvas size', () => {
  const t = tip();
  positionTooltip(t, anchor(), 200, 620, { followPointer: true });
  assert.equal(t.style.left, '214px');
  assert.equal(t.style.top, '612px');
});

test('a control tooltip still steps clear of a small anchor', () => {
  const t = tip();
  positionTooltip(t, anchor(), 200, 620);
  assert.equal(t.style.top, `${868 + 8}px`, 'moved below the anchor');
});

test('the tooltip is placed in the menu layer, above the menus in it', async () => {
  const { menuLayerFor } = await import('../dist/packages/canvas-adapter/toolbar.js');
  const row = document.createElement('div');
  const layer = menuLayerFor(document.body);
  layer.appendChild(row);          // a menu row, as a disabled row's hint anchors on
  const t = tip();
  positionTooltip(t, row, 100, 100);
  assert.equal(t.parentElement, layer, 'beside the layer, the layer drew the menu over its own tip');
  assert.match(t.style.zIndex, /\+ 3\)$/, 'Z_ABOVE2 — above every menu in the layer (Z_BASE, cascade Z_ABOVE)');
});
