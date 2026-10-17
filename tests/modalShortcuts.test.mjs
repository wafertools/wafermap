// E closes a modal and F maximises a window, but a letter typed into a text box is text, not a shortcut.

import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { pretendToBeVisual: true, url: 'http://localhost/' });
for (const k of ['window', 'document', 'HTMLElement', 'HTMLInputElement', 'Node', 'Event', 'MouseEvent', 'KeyboardEvent', 'Blob', 'URL']) if (dom.window[k]) globalThis[k] = dom.window[k];
globalThis.window = dom.window; globalThis.document = dom.window.document;
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
globalThis.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
const mm = () => ({ matches: false, media: '', addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false });
dom.window.matchMedia = mm; globalThis.matchMedia = mm;
class FakeResizeObserver { observe() {} unobserve() {} disconnect() {} }
dom.window.ResizeObserver = FakeResizeObserver; globalThis.ResizeObserver = FakeResizeObserver;

const { openModal, isTextEntry } = await import('../dist/packages/canvas-adapter/toolbar.js');

const press = (target, key) => target.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));

test('a letter typed into a text box in a modal does not close it, but E elsewhere in it does', () => {
  const anchor = document.createElement('button');
  document.getElementById('root').appendChild(anchor);
  let closed = 0;
  const handle = openModal({ title: 'Edit plot', anchor, ownerDocument: document, onClose: () => { closed++; } });
  const input = document.createElement('input');
  input.type = 'text';
  handle.contentWrap.appendChild(input);
  press(input, 'e'); press(input, 'E');
  assert.equal(closed, 0, 'typing e in a text box is typing');
  const area = document.createElement('textarea');
  handle.contentWrap.appendChild(area);
  press(area, 'e');
  assert.equal(closed, 0);
  press(handle.contentWrap, 'e');
  assert.equal(closed, 1, 'E with focus anywhere else closes the modal, as before');
});

test('which targets take typed text', () => {
  const make = (tag, type) => { const el = document.createElement(tag); if (type) el.type = type; return el; };
  assert.equal(isTextEntry(make('input', 'text')), true);
  assert.equal(isTextEntry(make('input')), true);
  assert.equal(isTextEntry(make('textarea')), true);
  assert.equal(isTextEntry(make('select')), true);
  assert.equal(isTextEntry(make('input', 'checkbox')), false, 'a checkbox takes no text');
  assert.equal(isTextEntry(make('button')), false);
  assert.equal(isTextEntry(null), false);
});
