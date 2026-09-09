// The histogram's two render paths must resolve an UNSET "axis includes limits"
// preference the same way.
//
// Faceted (Group by active) treated unset as OFF; non-faceted derived it from
// the data via shouldIncludeLimitsByDefault. So the same test, with the user
// having expressed no preference, included the spec limits in the axis ungrouped
// and dropped them grouped — the axis range moved under the reader while the
// toggle beside it stayed put. See TODO.md "Histogram resolves includeLimits two
// different ways".

import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { pretendToBeVisual: true });
for (const k of ['window', 'document', 'HTMLElement', 'HTMLCanvasElement', 'HTMLDivElement', 'HTMLButtonElement', 'Node', 'Event', 'MouseEvent', 'KeyboardEvent', 'CustomEvent', 'Blob', 'DOMRect']) {
  if (dom.window[k]) globalThis[k] = dom.window[k];
}
globalThis.window = dom.window;
globalThis.document = dom.window.document;
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
globalThis.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
dom.window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
class FakeResizeObserver { observe() {} unobserve() {} disconnect() {} }
dom.window.ResizeObserver = FakeResizeObserver; globalThis.ResizeObserver = FakeResizeObserver;
const noop = () => {};
dom.window.HTMLCanvasElement.prototype.getContext = () => new Proxy({}, { get: (_, p) => {
  if (p === 'measureText') return (t) => ({ width: String(t).length * 6 });
  if (p === 'createLinearGradient' || p === 'createRadialGradient') return () => ({ addColorStop: noop });
  if (p === 'getImageData') return () => ({ data: [] });
  if (p === 'canvas') return { width: 600, height: 300 };
  return noop;
} });

const { renderHistogramPanel } = await import('../dist/packages/canvas-adapter/charts/histogram.js');

// Data span 10 (10→20) inside a limit span of 30 (0→30) — a third of the axis,
// exactly the share at which shouldIncludeLimitsByDefault says yes.
const TEST_DEFS = [{ testNumber: 1, name: 'vth', unit: 'mV', limitLow: 0, limitHigh: 30 }];
const die = (v) => ({ x: 0, y: 0, testValues: { 1: v } });
const ITEMS = [
  { label: 'W1', dies: [10, 12, 14].map(die) },
  { label: 'W2', dies: [16, 18, 20].map(die) },
];
const GROUPS = [
  { key: 'A', items: [ITEMS[0]] },
  { key: 'B', items: [ITEMS[1]] },
];

function limitsToggleState(opts) {
  const host = dom.window.document.getElementById('root');
  host.innerHTML = '';
  const panel = renderHistogramPanel({ items: ITEMS, testDefs: TEST_DEFS, ownerDocument: dom.window.document, ...opts });
  host.appendChild(panel.card);
  const label = [...panel.card.querySelectorAll('label')].find(l => l.textContent.includes('Axis includes limits'));
  assert.ok(label, 'the toggle is offered in both branches');
  const state = label.querySelector('input[type="checkbox"]').checked;
  panel.destroy();
  return state;
}

test('grouped and ungrouped resolve an unset preference identically', () => {
  const ungrouped = limitsToggleState({});
  const grouped   = limitsToggleState({ groups: GROUPS, groupLabelText: 'lot' });
  assert.equal(grouped, ungrouped,
    'the same data and no preference must not include the limits in one view and not the other');
  // And the shared rule says yes for this data, so this is not two branches
  // agreeing on the wrong answer.
  assert.equal(ungrouped, true);
});

test('an explicit preference still wins in both', () => {
  for (const includeLimits of [true, false]) {
    assert.equal(limitsToggleState({ axisPrefs: { includeLimits, clipOutliers: false } }), includeLimits);
    assert.equal(limitsToggleState({ groups: GROUPS, axisPrefs: { includeLimits, clipOutliers: false } }), includeLimits);
  }
});
