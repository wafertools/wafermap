// Escape closes a window, but not when something inside it has already used the
// key. A menu opened from a plot editor closes itself on Escape; the editor sits
// in a modal whose document-level listener also closes on Escape, so one keypress
// used to dismiss the menu and the whole editor, losing what had been entered.
import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

import { openModal } from '../dist/packages/canvas-adapter/toolbar.js';

function setup() {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true, url: 'http://localhost/' });
  const { window } = dom;
  window.matchMedia ??= () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
  return { window, doc: window.document, cleanup: () => window.close() };
}

const escape = (window, target) =>
  target.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));

test('Escape handled by a menu inside a modal closes the menu only', () => {
  const { window, doc, cleanup } = setup();
  try {
    let closed = 0;
    const handle = openModal({ title: 'Plot', onClose() { closed += 1; }, ownerDocument: doc });
    const item = doc.createElement('button');
    handle.contentWrap.appendChild(item);
    // What the menus do: close themselves and mark the key as used.
    item.addEventListener('keydown', e => { if (e.key === 'Escape') e.preventDefault(); });

    escape(window, item);
    assert.equal(closed, 0, 'the modal stays open');

    // Nothing handled it this time, so Escape closes the modal as before.
    const bare = doc.createElement('div');
    handle.contentWrap.appendChild(bare);
    escape(window, bare);
    assert.equal(closed, 1, 'an unhandled Escape still closes the modal');
  } finally {
    cleanup();
  }
});
