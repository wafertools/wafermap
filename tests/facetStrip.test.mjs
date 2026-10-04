// The metadata fields strip (buildFacetSummaryChips): it fills the width it has and
// overflows behind "N more fields" only when it must. jsdom has no layout, so widths
// are stubbed: a text measures 7px a character, and the strip's width is set by the test.

import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>');
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.Node = dom.window.Node;
globalThis.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
dom.window.HTMLElement.prototype.getBoundingClientRect = function () { return { width: this.textContent.length * 7, height: 10, top: 0, left: 0, right: 0, bottom: 0 }; };

const observers = [];
globalThis.ResizeObserver = class { constructor(cb) { this.cb = cb; observers.push(this); } observe() {} disconnect() {} };

const { buildFacetSummaryChips } = await import('../dist/packages/canvas-adapter/summaryPanel.js');

const v = (...xs) => xs.map(value => ({ value }));
const TABLE = [
  { key: 'node', values: v('N1') },
  { key: 'lot', values: v('LOT-A') },
  { key: 'product', values: v('DEV-1') },
  { key: 'split', values: v('TT', 'FF', 'SS', 'FS', 'SF') },
  { key: 'tester', values: v('T1') },
];

/** A strip `px` wide. 0 is "not laid out yet". */
function strip(px, table = TABLE) {
  const before = observers.length;
  const row = buildFacetSummaryChips(table);
  Object.defineProperty(row, 'clientWidth', { configurable: true, get: () => px });
  observers.slice(before).forEach(o => o.cb());          // the observer's first delivery
  return row;
}
const chips = (row) => [...row.children].filter(c => c.tagName === 'SPAN' && c.style.visibility !== 'hidden' && c.style.position !== 'absolute');
const shown = (row) => chips(row).filter(c => c.style.display !== 'none').map(c => c.textContent);
const toggle = (row) => row.querySelector('button');
const toggleText = (row) => toggle(row).style.display === 'none' ? null : toggle(row).textContent;

test('with no width yet, the primary fields show with three values and the rest wait behind the button', () => {
  const row = strip(0);
  assert.deepEqual(shown(row), ['Lot: LOT-A', 'Product: DEV-1', 'Split (5): TT, FF, SS, …']);
  assert.equal(toggleText(row), '2 more fields');
});

test('with room for everything, every field shows and there is no button', () => {
  const row = strip(2000);
  assert.deepEqual(shown(row), ['Lot: LOT-A', 'Product: DEV-1', 'Split: TT, FF, SS, FS, SF', 'Node: N1', 'Tester: T1']);
  assert.equal(toggleText(row), null);
});

test('fields are taken in priority order: lot, product, program, split, then the rest', () => {
  const row = strip(2000);
  assert.deepEqual(shown(row).map(s => s.split(':')[0]), ['Lot', 'Product', 'Split', 'Node', 'Tester']);
});

test('a narrower strip drops the last fields first and counts them on the button', () => {
  // Lot (70px) + Product (98) + the "N more fields" button (91) fit in 270; a Split with even one value does not.
  const row = strip(270);
  assert.deepEqual(shown(row).slice(0, 2), ['Lot: LOT-A', 'Product: DEV-1']);
  const n = TABLE.length - shown(row).length;
  assert.equal(toggleText(row), `${n} more field${n === 1 ? '' : 's'}`);
  assert.ok(n >= 1);
});

test('a field lists fewer values before it gives way, and says how many there are', () => {
  // Lot (70) + Product (98) + the button (91) leave 161px: room for two of Split's five values, not three.
  const row = strip(420);
  const split = shown(row).find(s => s.startsWith('Split'));
  assert.ok(split, shown(row).join(' | '));
  assert.match(split, /^Split \(5\): .+, …$/);
  assert.equal(split, 'Split (5): TT, FF, …');
});

test('every value lists when there is room, with no count or ellipsis', () => {
  const row = strip(2000);
  assert.ok(shown(row).includes('Split: TT, FF, SS, FS, SF'));
});

test('the first field always shows, clipped if it must, rather than an empty strip', () => {
  const row = strip(30);
  assert.equal(shown(row).length, 1);
  assert.ok(shown(row)[0].startsWith('Lot'));
  assert.equal(toggleText(row), `${TABLE.length - 1} more fields`);
});

test('the button expands to every field and collapses again', () => {
  const row = strip(200);
  toggle(row).click();
  assert.equal(toggle(row).getAttribute('aria-expanded'), 'true');
  assert.equal(toggle(row).textContent, 'fewer fields');
  assert.equal(shown(row).length, TABLE.length);
  assert.equal(row.style.flexWrap, 'wrap');
  toggle(row).click();
  assert.ok(shown(row).length < TABLE.length);
  assert.equal(row.style.flexWrap, 'nowrap');
});

test('widening the strip gives fields back, and narrowing it takes them away', () => {
  const row = strip(2000);
  assert.equal(toggleText(row), null);
  Object.defineProperty(row, 'clientWidth', { configurable: true, get: () => 170 });
  observers.at(-1).cb();
  assert.ok(toggleText(row));
  Object.defineProperty(row, 'clientWidth', { configurable: true, get: () => 2000 });
  observers.at(-1).cb();
  assert.equal(toggleText(row), null);
});

test('an empty table builds no strip', () => {
  assert.equal(buildFacetSummaryChips([]), null);
});
