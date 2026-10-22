// Enter in a long list's filter box picks the only row left showing.

import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true, url: 'http://localhost/' });
for (const k of ['window', 'document', 'HTMLElement', 'Node', 'Event', 'MouseEvent', 'KeyboardEvent']) globalThis[k] = dom.window[k];
globalThis.window = dom.window; globalThis.document = dom.window.document;
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
globalThis.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
dom.window.matchMedia = globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });

const { makeListSelect } = await import('../dist/packages/canvas-adapter/charts/chartShell.js');

const options = Array.from({ length: 12 }, (_, i) => ({ value: String(i), label: `Test ${i === 7 ? 'Vth' : 'T' + i}` }));
const open = () => {
  const picked = [];
  const sel = makeListSelect(options, '0', v => picked.push(v), { ownerDocument: document, ariaLabel: 'Test', emptyText: 'none' });
  document.body.replaceChildren(sel);
  sel.click();
  return picked;
};
const type = (input, text) => { input.value = text; input.dispatchEvent(new dom.window.Event('input', { bubbles: true })); };
const enter = input => input.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));

test('Enter picks the only row the filter leaves', () => {
  const picked = open();
  const input = document.querySelector('input[type="text"]');
  assert.ok(input, 'the filter box is shown for a long list');
  type(input, 'vth');
  enter(input);
  assert.deepEqual(picked, ['7']);
});

test('Enter with several rows left, or none, picks nothing', () => {
  const picked = open();
  const input = document.querySelector('input[type="text"]');
  type(input, 'test');
  enter(input);
  type(input, 'zzz');
  enter(input);
  assert.deepEqual(picked, []);
});
