// Pinned tests lead every test picker, under a "Pinned" heading, and the reader's pin reaches the host.

import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { pretendToBeVisual: true, url: 'http://localhost/' });
for (const k of ['window', 'document', 'HTMLElement', 'HTMLButtonElement', 'HTMLDivElement', 'Node', 'Event', 'MouseEvent', 'KeyboardEvent', 'DOMRect']) {
  if (dom.window[k]) globalThis[k] = dom.window[k];
}
globalThis.window = dom.window;
globalThis.document = dom.window.document;
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
globalThis.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
dom.window.matchMedia = globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });

const { makeTestSelect } = await import('../dist/packages/canvas-adapter/charts/chartShell.js');
const { getPinnedTests, setPinnedTests, onPinnedTestsChange } = await import('../dist/packages/canvas-adapter/index.js');

const tests = [10, 20, 30, 40].map((n) => ({ testNumber: n, name: `t${n}` }));
const rows = () => [...document.querySelectorAll('[role="option"]')];
const rowText = (r) => r.firstChild.textContent;
const open = (sel) => sel.click();
const close = () => document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

test('with nothing pinned the list is plain, and every row offers a pin', () => {
  setPinnedTests([]);
  const sel = makeTestSelect(tests, 10, () => {});
  document.body.appendChild(sel);
  open(sel);
  assert.deepEqual(rows().map(rowText), ['t10', 't20', 't30', 't40']);
  assert.ok(rows().every((r) => r.querySelector('[data-wmap-pin="unpinned"]')), 'every row offers a pin');
  assert.deepEqual(rows().map((r) => r.textContent), ['t10', 't20', 't30', 't40'], 'the row text is the test name alone');
  sel.remove();
  document.querySelectorAll('[role="listbox"]').forEach((m) => m.remove());
});

test('pinned tests lead under their own heading', () => {
  setPinnedTests([30, 20]);
  const sel = makeTestSelect(tests, 10, () => {});
  document.body.appendChild(sel);
  open(sel);
  assert.deepEqual(rows().map(rowText), ['t20', 't30', 't10', 't40']);
  assert.ok(rows().slice(0, 2).every((r) => r.querySelector('[data-wmap-pin="pinned"]')));
  const headings = [...document.querySelectorAll('[role="listbox"] [role="presentation"]')].map((h) => h.textContent);
  assert.deepEqual(headings, ['Pinned', 'All tests']);
  sel.remove();
  document.querySelectorAll('[role="listbox"]').forEach((m) => m.remove());
});

test('the reader\'s pin is reported to the host and the list reopens reordered; loading a saved set is not reported', () => {
  setPinnedTests([]);
  const seen = [];
  const stop = onPinnedTestsChange((all) => seen.push(all));
  setPinnedTests([40]);
  assert.deepEqual(seen, [], 'adopting a saved set does not write back');
  const sel = makeTestSelect(tests, 10, () => {});
  document.body.appendChild(sel);
  open(sel);
  const row20 = rows().find((r) => rowText(r) === 't20');
  row20.querySelector('[data-wmap-pin]').click();
  assert.deepEqual(seen, [[40, 20]]);
  assert.deepEqual(getPinnedTests(), [40, 20]);
  assert.deepEqual(rows().map(rowText), ['t20', 't40', 't10', 't30'], 'reopened with both pins first, in list order');
  stop();
  sel.remove();
  document.querySelectorAll('[role="listbox"]').forEach((m) => m.remove());
});
