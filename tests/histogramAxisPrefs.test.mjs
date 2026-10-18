// The histogram's two render paths must resolve an UNSET "axis includes limits"
// preference the same way.
//
// Faceted (Group by active) treated unset as OFF; non-faceted derived it from
// the data via shouldIncludeLimitsByDefault. So the same test, with the user
// having expressed no preference, included the spec limits in the axis ungrouped
// and dropped them grouped — the axis range moved under the reader while the
// toggle beside it stayed put.

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

const { buildWaferMap } = await import('../dist/index.js');
const { analyzeWaferLot } = await import('../dist/packages/stats/index.js');
const { createInsightsTab } = await import('../dist/packages/canvas-adapter/insightsTab.js');

// Data span 10 (10→20) inside a limit span of 30 (0→30) — a third of the axis,
// exactly the share at which shouldIncludeLimitsByDefault says yes.
const TEST_DEFS = [{ testNumber: 1, name: 'vth', unit: 'mV', limitLow: 0, limitHigh: 30 }];
const wafer = (values, split, i) => ({
  ...buildWaferMap({
    results: values.map((v, k) => ({ x: k, y: 0, hbin: 1, testValues: { 1: v } })),
    waferConfig: { diameter: 200, metadata: { split, wafer: `W${i}` } }, dieConfig: { width: 10, height: 10 }, passBins: [1], testDefs: TEST_DEFS,
  }),
  label: `W${i}`,
});

/** The Value histogram card's "Axis includes limits" toggle, on the Distributions tab, grouped by split or not. */
function limitsToggleState({ grouped = false, axisPrefs } = {}) {
  const host = dom.window.document.getElementById('root');
  host.innerHTML = '';
  const items = [wafer([10, 12, 14], 'A', 1), wafer([16, 18, 20], 'B', 2)];
  const lot = analyzeWaferLot(items, { computePerTestStats: true });
  items.forEach((it, i) => { it.statsSummary = lot.perWafer[i].summary; });
  const tab = createInsightsTab({ getRingCount: () => 4, getItems: () => items, getLotStats: () => lot, defaultView: 'distributions',
    getBinColors: () => ({ hard: new Map(), soft: new Map(), shared: { hard: [], soft: [] }, pass: { hard: new Set(), soft: new Set() } }),
    ...(axisPrefs ? { initialAxisPrefs: axisPrefs } : {}) });
  host.appendChild(tab.el);
  tab.render();
  if (grouped) {
    tab.el.querySelector('[data-wmap-select="group-by"]').click();
    [...dom.window.document.querySelectorAll('[role="option"]')].find(o => /^Split/.test(o.textContent)).click();
  }
  const card = tab.el.querySelector('[data-wmap-chart-title="Value histogram"]');
  const label = [...card.querySelectorAll('label')].find(l => l.textContent.includes('Axis includes limits'));
  assert.ok(label, 'the toggle is offered in both');
  const state = label.querySelector('input[type="checkbox"]').checked;
  tab.destroy();
  return state;
}

test('grouped and ungrouped resolve an unset preference identically', () => {
  const ungrouped = limitsToggleState({});
  const grouped   = limitsToggleState({ grouped: true });
  assert.equal(grouped, ungrouped,
    'the same data and no preference must not include the limits in one view and not the other');
  // And the shared rule says yes for this data, so this is not two branches
  // agreeing on the wrong answer.
  assert.equal(ungrouped, true);
});

test('an explicit preference still wins in both', () => {
  for (const includeLimits of [true, false]) {
    assert.equal(limitsToggleState({ axisPrefs: { includeLimits, clipOutliers: false } }), includeLimits);
    assert.equal(limitsToggleState({ grouped: true, axisPrefs: { includeLimits, clipOutliers: false } }), includeLimits);
  }
});
