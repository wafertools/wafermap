// Test-definition reconciliation is scoped to the population in view, in EVERY
// view — not just Distributions.
//
// `TestDef.testNumber` identifies a test within one test program, so a load
// spanning two programs can have one number meaning two different measurements.
// `mergeTestDefs` withholds such a number rather than picking a winner. But
// withholding is only right over the population actually being compared:
// applied to the whole load it punishes agreement, and Insights got emptier the
// more data was loaded. Narrowing to one group removes the collision, because
// within one program a test number does identify one test.
//
// This is pinned because the wrong version SHIPPED once (whole-load), and
// because the fix lives in `render()` above the view switch — a refactor that
// moved it back inside one section would restore the bug silently for the other
// two. Overview and Correlation are scoped too, and this is what keeps that true.

import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body><div id="host"></div></body></html>', { pretendToBeVisual: true });
for (const k of ['window', 'document', 'HTMLElement', 'HTMLCanvasElement', 'HTMLDivElement', 'HTMLButtonElement', 'Node', 'Event', 'MouseEvent', 'KeyboardEvent', 'CustomEvent', 'Blob', 'DOMRect']) {
  globalThis[k] = k === 'window' ? dom.window : dom.window[k];
}
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

// Test 1001 is a HARD collision: a threshold voltage in one lot, a leakage
// current in the other. 1002 agrees in both and must never be withheld.
const DEFS_A = [
  { testNumber: 1001, name: 'vth_n_mV', unit: 'mV', limitLow: 260, limitHigh: 380 },
  { testNumber: 1002, name: 'idd_mA', unit: 'mA', limitLow: 0, limitHigh: 9 },
];
const DEFS_B = [
  { testNumber: 1001, name: 'leakage_nA', unit: 'nA', limitLow: 0, limitHigh: 5 },
  { testNumber: 1002, name: 'idd_mA', unit: 'mA', limitLow: 0, limitHigh: 9 },
];

function waferIn(lot, defs, i) {
  const built = buildWaferMap({
    results: Array.from({ length: 24 }, (_, k) => ({
      x: k % 6, y: Math.floor(k / 6), hbin: k % 7 === 0 ? 2 : 1,
      testValues: { 1001: 300 + i + (k % 5), 1002: 4 + (k % 3) * 0.2 },
    })),
    waferConfig: { diameter: 80, metadata: { lot, wafer: `${lot}-W${i}` } },
    dieConfig: { width: 10, height: 10 },
    passBins: [1],
    testDefs: defs,
  });
  return { ...built, label: `${lot}-W${i}` };
}

function twoLots() {
  const items = [waferIn('LOT-A', DEFS_A, 1), waferIn('LOT-A', DEFS_A, 2),
                 waferIn('LOT-B', DEFS_B, 1), waferIn('LOT-B', DEFS_B, 2)];
  const lot = analyzeWaferLot(items, { computePerTestStats: true });
  items.forEach((it, i) => { it.statsSummary = lot.perWafer[i].summary; });
  return { items, lot };
}

function mount(view) {
  const host = dom.window.document.getElementById('host');
  host.innerHTML = '';
  const { items, lot } = twoLots();
  const tab = createInsightsTab({
    getItems: () => items, getLotStats: () => lot,
    getBinColors: () => ({ hard: new Map(), soft: new Map(), shared: { hard: [], soft: [] }, pass: { hard: new Set(), soft: new Set() } }),
    defaultView: view,
  });
  host.appendChild(tab.el);
  tab.render();
  return tab;
}

/** Drive one of the tab's own themed pickers by its label and an option's text. */
function pickFrom(tab, ariaLabel, optionText) {
  const trigger = [...tab.el.querySelectorAll('button')]
    .find(b => (b.getAttribute('aria-label') ?? '').toLowerCase() === ariaLabel.toLowerCase());
  assert.ok(trigger, `the "${ariaLabel}" control is offered`);
  trigger.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  const option = [...dom.window.document.querySelectorAll('[role="option"]')]
    .find(o => o.textContent.trim().startsWith(optionText));
  assert.ok(option, `"${optionText}" is offered under ${ariaLabel}`);
  option.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
}

const state = (tab) => {
  const note = tab.el.querySelector('[data-wmap-withheld-tests]');
  const text = tab.el.textContent.replace(/\s+/g, ' ');
  return {
    withheld: note ? Number(note.dataset.wmapWithheldTests) : 0,
    noteText: note?.textContent ?? '',
    hasA: text.includes('vth_n_mV'),
    hasB: text.includes('leakage_nA'),
    hasShared: text.includes('idd_mA'),
  };
};

const VIEWS = ['overview', 'distributions', 'correlation'];

for (const view of VIEWS) {
  test(`${view}: a colliding test number is withheld over the whole load, and said so`, () => {
    const tab = mount(view);
    const s = state(tab);
    assert.equal(s.withheld, 1, 'exactly the one colliding number');
    assert.match(s.noteText, /1001/, 'the note names it');
    assert.ok(!s.hasA && !s.hasB, 'and neither reading of it is offered under either name');
    assert.ok(s.hasShared, 'while the test both lots agree on stays — withholding is per number, not wholesale');
    tab.destroy();
  });

  test(`${view}: narrowing to one lot brings that test back, under that lot's own name`, () => {
    const tab = mount(view);
    // "Group by" makes the lots a scope; "Show" picks one. Both are tab-level.
    pickFrom(tab, 'Group by', 'Lot');
    pickFrom(tab, 'Show', 'LOT-A');
    const s = state(tab);
    assert.equal(s.withheld, 0, 'nothing is withheld within one test program');
    assert.ok(s.hasA, "LOT-A's own name for 1001 is back");
    assert.ok(!s.hasB, "and it is LOT-A's name, not the other lot's");
    tab.destroy();
  });

  test(`${view}: the other lot gets ITS name for the same number, not the first one seen`, () => {
    const tab = mount(view);
    pickFrom(tab, 'Group by', 'Lot');
    pickFrom(tab, 'Show', 'LOT-B');
    const s = state(tab);
    assert.equal(s.withheld, 0);
    assert.ok(s.hasB && !s.hasA);
    tab.destroy();
  });
}

test('the withheld note tells the reader how to get the tests back', () => {
  const tab = mount('overview');
  // Before grouping there is nothing to pick, so the advice is to load one
  // program at a time; the "Show:" route only exists once a facet is chosen.
  assert.match(state(tab).noteText, /Load one test program at a time/);
  pickFrom(tab, 'Group by', 'Lot');
  assert.match(state(tab).noteText, /Pick one Lot under "Show:"/);
  tab.destroy();
});
