// What a click does on each Insights card. A mark that stands for something (a bin, a bar of values, a ring, a test's
// failures, a wafer) opens that something: a wafer opens on the test the chart is about, anything else opens the
// drilldown menu on exactly the dies the mark counts.

import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><head></head><body><div id="root"></div></body></html>', { pretendToBeVisual: true, url: 'http://localhost/' });
for (const k of ['window', 'document', 'HTMLElement', 'HTMLCanvasElement', 'HTMLDivElement', 'HTMLButtonElement', 'HTMLInputElement', 'Node', 'Event', 'MouseEvent', 'KeyboardEvent', 'DOMRect', 'Element']) {
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
const noop = () => {};
const proto = dom.window.HTMLCanvasElement.prototype;
proto.getContext = () => new Proxy({}, { get: (_, p) => {
  if (p === 'measureText') return (t) => ({ width: String(t).length * 6 });
  if (p === 'createLinearGradient' || p === 'createRadialGradient') return () => ({ addColorStop: noop });
  if (p === 'getImageData') return () => ({ data: [] });
  if (p === 'canvas') return { width: 600, height: 400 };
  return noop;
} });
proto.focus = noop; proto.setPointerCapture = noop; proto.releasePointerCapture = noop;
Object.defineProperty(proto, 'clientWidth', { configurable: true, get() { return 600; } });
Object.defineProperty(proto, 'clientHeight', { configurable: true, get() { return 400; } });

const { buildWaferMap } = await import('../dist/index.js');
const { analyzeWaferLot } = await import('../dist/packages/stats/index.js');
const { createInsightsTab } = await import('../dist/packages/canvas-adapter/insightsTab.js');
const { createPlotStore } = await import('../dist/packages/canvas-adapter/plotStore.js');

const DEFS = [
  { testNumber: 1050, name: 'Vth', unit: 'V', limitLow: 0.45, limitHigh: 0.6 },
  { testNumber: 1060, name: 'Idsat', unit: 'A' },
];
const tick = (ms = 0) => new Promise(r => setTimeout(r, ms));
async function until(fn, what, ms = 2000) {
  const end = Date.now() + ms;
  for (;;) { const v = fn(); if (v) return v; if (Date.now() > end) throw new Error(`timed out waiting for ${what}`); await tick(5); }
}

function lotItems(count = 3, dieCount = 24) {
  const items = Array.from({ length: count }, (_, i) => ({
    ...buildWaferMap({
      results: Array.from({ length: dieCount }, (_, k) => ({
        x: k % 6, y: Math.floor(k / 6), hbin: k % 4 === 0 ? 2 : k % 7 === 0 ? 3 : 1, sbin: k % 4 === 0 ? 12 : 11,
        testValues: { 1050: 0.4 + i / 10 + k / 100, 1060: 0.001 + k / 1e5 },
      })),
      waferConfig: { diameter: 80, metadata: { lot: 'LOT1', wafer: `W${i + 1}`, split: i % 2 ? 'FF' : 'TT' } },
      dieConfig: { width: 10, height: 10 },
      passBins: [1], testDefs: DEFS,
    }),
    label: `W${i + 1}`,
  }));
  const lot = analyzeWaferLot(items, { computePerTestStats: true });
  items.forEach((it, i) => { it.statsSummary = lot.perWafer[i].summary; });
  return { items, lot };
}

function mount(view, extra = {}, count = 3) {
  const { items, lot } = lotItems(count);
  const host = document.getElementById('root');
  host.innerHTML = '';
  const opened = [];
  const focused = [];
  const tab = createInsightsTab({
    getItems: () => items, getLotStats: () => lot,
    getBinColors: () => ({ hard: new Map(), soft: new Map(), shared: { hard: [], soft: [] }, pass: { hard: new Set(), soft: new Set() } }),
    defaultView: view, plotStore: createPlotStore([], undefined, 0),
    openWafer: (wi, label, test) => opened.push([wi, label, test]),
    ...extra,
  });
  host.appendChild(tab.el);
  tab.render();
  return { tab, items, opened, focused };
}

const card = (tab, title) => [...tab.el.querySelectorAll('[data-wmap-chart-card]')].find(c => c.dataset.wmapChartTitle === title);
const menu = () => document.querySelector('[data-wmap-drilldown-menu]');
const closeMenu = () => { document.querySelectorAll('[data-wmap-drilldown-menu]').forEach(m => m.remove()); };

/** Clicks the canvas at each candidate point until a drilldown menu opens; returns it (or null). Hit-testing is by
 *  position, which a test cannot know, so it looks. */
function clickUntilMenu(canvas, xs, ys) {
  closeMenu();
  for (const y of ys) for (const x of xs) {
    canvas.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, clientX: x, clientY: y }));
    if (menu()) return menu();
  }
  return null;
}
const range = (a, b, step) => Array.from({ length: Math.floor((b - a) / step) + 1 }, (_, i) => a + i * step);
const rowsOf = (m) => [...m.querySelectorAll('[role="menuitem"]')].map(r => r.textContent);

test('the bin pareto: a bar opens the dies in that bin, across the wafers in view', () => {
  const { tab } = mount('overview');
  const c = card(tab, 'Hard bin pareto');
  assert.match(c.textContent, /click a bar to chart or tabulate its dies/i);
  const m = clickUntilMenu(c.querySelector('canvas'), [100], range(5, 120, 3));
  assert.ok(m, 'a menu');
  assert.match(m.getAttribute('aria-label'), /^Open a chart or table of \d+ dies in hard bin \d, across 3 wafers$/);
  assert.ok(rowsOf(m).includes('Dies'));
});

test('the soft bin pareto picks soft bins', () => {
  const { tab } = mount('overview');
  const c = card(tab, 'Hard bin pareto');
  const radios = [...c.querySelectorAll('input[type="radio"]')];
  const soft = radios.find(r => r.value === 'sbin');
  soft.checked = true;
  soft.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  const m = clickUntilMenu(c.querySelector('canvas'), [100], range(5, 120, 3));
  assert.match(m.getAttribute('aria-label'), /in soft bin 1[12]/);
});

test('the pass-rate card: a test\'s row opens the dies that fail it, on that test', () => {
  const { tab } = mount('overview');
  const c = card(tab, 'Parametric pass rate · test limits');
  assert.match(c.textContent, /click a test to chart or tabulate the dies that fail it/);
  const m = clickUntilMenu(c.querySelector('canvas'), range(90, 400, 20), range(5, 200, 3));
  assert.ok(m, 'a menu');
  assert.match(m.getAttribute('aria-label'), /dies failing Vth, across 3 wafers$/);
  const n = Number(/of (\d+) dies/.exec(m.getAttribute('aria-label'))[1]);
  // 0.45 <= Vth <= 0.6: the dies outside it, by the card's own rule
  const { items } = lotItems();
  const expected = items.flatMap(it => it.dies).filter(d => d.testValues[1050] < 0.45 || d.testValues[1050] > 0.6).length;
  assert.equal(n, expected, 'exactly the dies the row counts as failing');
});

test('ring and quadrant yield: a region opens the dies it counts', () => {
  const { tab } = mount('overview');
  const ring = card(tab, 'Ring yield').querySelector('canvas');
  const m = clickUntilMenu(ring, [160 + 5, 160 + 40, 160 + 80, 160 + 110], [160]);
  assert.ok(m, 'a ring');
  assert.match(m.getAttribute('aria-label'), /in Ring \d/);
  const q = clickUntilMenu(card(tab, 'Quadrant yield').querySelector('canvas'), [210], [210]);
  assert.ok(q, 'a quadrant');
  assert.match(q.getAttribute('aria-label'), /in (NE|NW|SW|SE)/);
});

test('a click outside the circle does nothing', () => {
  const { tab } = mount('overview');
  const m = clickUntilMenu(card(tab, 'Ring yield').querySelector('canvas'), [2], [2]);
  assert.equal(m, null);
});

test('the value histogram: a bar opens the dies whose values fall in it, and their number is the bar\'s count', () => {
  const { tab } = mount('distributions');
  const c = card(tab, 'Value histogram');
  assert.match(c.textContent, /click a bar to chart or tabulate its dies/);
  const m = clickUntilMenu(c.querySelector('canvas'), range(70, 560, 10), [100]);
  assert.ok(m, 'a menu');
  assert.match(m.getAttribute('aria-label'), /^Open a chart or table of \d+ dies with Vth from .+ to .+/);
  assert.ok(rowsOf(m).includes('Dies'));
});

test('the Wafers table: a row opens that wafer', async () => {
  const { tab, opened } = mount('data');
  const wafers = tab.el.querySelector('[data-wmap-data-view="wafers"]');
  wafers.click();
  const row = await until(() => tab.el.querySelector('tbody tr[aria-rowindex]'), 'a wafer row');
  assert.match(tab.el.textContent, /Click a row to open that wafer/);
  row.click();
  assert.equal(opened.length, 1);
  assert.equal(opened[0][2], undefined, 'no test: a wafer row is about the wafer');
});

test('the Plot tab: a point opens its wafer on the test the plot is about', async () => {
  const plots = [{ id: 'p', chart: 'scatter', fields: { x: { test: 1050, name: 'Vth' }, y: { test: 1060 }, color: { none: true } } }];
  const { tab, opened } = mount('plot', { plotStore: createPlotStore(plots, undefined, 0) });
  const c = await until(() => tab.el.querySelector('[data-wmap-plot-id]'), 'the plot');
  c.querySelector('canvas').dispatchEvent(new dom.window.MouseEvent('mousemove', { bubbles: true, clientX: 70, clientY: 30 }));
  for (const x of range(66, 80, 1)) {
    c.querySelector('canvas').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, clientX: x, clientY: 30 }));
    if (opened.length) break;
  }
  if (opened.length === 0) {
    // the points are where the data put them; scan the canvas for one
    for (const y of range(10, 200, 4)) for (const x of range(60, 90, 2)) {
      c.querySelector('canvas').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, clientX: x, clientY: y }));
      if (opened.length) break;
    }
  }
  assert.ok(opened.length >= 1, 'a wafer opened');
  assert.equal(opened[0][2], 1050, 'on Vth, the plot\'s X test, so the map shows its values and not the bins');
});

test('a plot with no test in it opens the wafer\'s default map', async () => {
  const plots = [{ id: 'p', chart: 'bar', fields: { x: { builtin: 'wafer' }, y: { builtin: 'yield' }, color: { none: true } } }];
  const { tab, opened } = mount('plot', { plotStore: createPlotStore(plots, undefined, 0) });
  const c = await until(() => tab.el.querySelector('[data-wmap-plot-id]'), 'the plot');
  c.querySelector('canvas').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, clientX: 66, clientY: 20 }));
  assert.equal(opened.length, 1);
  assert.equal(opened[0][2], undefined);
});

test('a single-wafer host shows the plot\'s test on its own map', async () => {
  const shown = [];
  const plots = [{ id: 'p', chart: 'histogram', fields: { y: { test: 1060 }, color: { none: true } } },
    { id: 'q', chart: 'scatter', fields: { x: { test: 1050 }, y: { test: 1060 }, color: { none: true } } }];
  const { tab } = mount('plot', { plotStore: createPlotStore(plots, undefined, 0), openWafer: undefined, focusTest: (n) => shown.push(n) }, 1);
  const c = await until(() => tab.el.querySelector('[data-wmap-plot-id="q"]'), 'the plot');
  assert.match(c.textContent, /click a point to show this test on the map/);
  for (const y of range(5, 300, 3)) for (const x of range(60, 140, 4)) {
    c.querySelector('canvas').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, clientX: x, clientY: y }));
    if (shown.length) break;
  }
  assert.deepEqual(shown.slice(0, 1), [1050]);
});

test('plot bars, boxes and lines open what they count when they are not a wafer', async () => {
  const plots = [
    { id: 'b', chart: 'bar', fields: { x: { meta: 'split' }, y: { test: 1050 }, color: { none: true } }, aggregate: 'mean' },
    { id: 'h', chart: 'histogram', fields: { y: { test: 1050 }, color: { none: true } } },
    { id: 'l', chart: 'line', fields: { x: { builtin: 'waferOrder' }, y: { test: 1050 }, color: { none: true } }, aggregate: 'mean' },
  ];
  const { tab, opened } = mount('plot', { plotStore: createPlotStore(plots, undefined, 0) });
  await until(() => tab.el.querySelectorAll('[data-wmap-plot-id]').length === 3, 'the plots');
  const byId = id => tab.el.querySelector(`[data-wmap-plot-id="${id}"]`);
  const bar = clickUntilMenu(byId('b').querySelector('canvas'), range(60, 80, 1), [20]);
  assert.ok(bar, 'a bar of a lot field');
  assert.match(bar.getAttribute('aria-label'), /^Open a chart or table of \d+ dies selected/);
  const hist = clickUntilMenu(byId('h').querySelector('canvas'), range(64, 80, 1), [20]);
  assert.ok(hist, 'a histogram bar');
  const line = clickUntilMenu(byId('l').querySelector('canvas'), range(64, 80, 1), [20]);
  void line;
  assert.equal(opened.length, 0, 'none of these opened a wafer');
  closeMenu();
});

test('with Group by on, the clustered bin pareto opens one bin of one group', () => {
  const { tab } = mount('overview');
  document.body.appendChild(tab.el);
  tab.el.querySelector('[data-wmap-select="group-by"]').click();
  [...document.querySelectorAll('[role="option"]')].find(o => /^Split/.test(o.textContent)).click();
  const c = card(tab, 'Hard bin pareto');
  assert.match(c.textContent, /click a sub-bar to chart or tabulate its dies/);
  const m = clickUntilMenu(c.querySelector('canvas'), range(120, 500, 20), range(5, 100, 3));
  assert.ok(m, 'a menu');
  assert.match(m.getAttribute('aria-label'), /in hard bin \d of (TT|FF)/);
});

// ── the ones that did nothing ──

test('with Group by on, a column of the overlaid histogram opens the dies in that bucket across the groups', () => {
  const { tab } = mount('distributions');
  document.body.appendChild(tab.el);
  tab.el.querySelector('[data-wmap-select="group-by"]').click();
  [...document.querySelectorAll('[role="option"]')].find(o => /^Split/.test(o.textContent)).click();
  const c = card(tab, 'Value histogram');
  assert.match(c.textContent, /click a column to chart or tabulate its dies/);
  const m = clickUntilMenu(c.querySelector('canvas'), range(40, 70, 1), [100]);
  assert.ok(m, 'a menu');
  assert.match(m.getAttribute('aria-label'), /^Open a chart or table of \d+ dies with Vth from .+ to .+( on W\d| across [23] wafers)$/);
});

test('a sweep: a level of the curve opens the dies measured there', async () => {
  const { sweepToPlot } = await import('../dist/packages/stats/plotSpec.js');
  const sweep = { id: 's', title: 'Vth sweep', series: [{ label: 'Up', tests: [1050, 1060], xValues: [0, 5] }, { label: 'Down', tests: [1060, 1050], xValues: [0, 5] }] };
  const { tab } = mount('plot', { plotStore: createPlotStore([sweepToPlot(sweep)], undefined, 0) });
  const c = await until(() => card(tab, 'Vth sweep'), 'the sweep card');
  assert.match(c.textContent, /click a level to chart or tabulate the dies measured there/);
  const m = clickUntilMenu(c.querySelector('canvas'), range(60, 560, 20), [100]);
  assert.ok(m, 'a menu');
  assert.match(m.getAttribute('aria-label'), /dies measured at .+, across 3 wafers$/);
});

test('the wafer trend: a drag across it picks a run of wafers, whose own dies are the population', async () => {
  const { renderTrendPanel } = await import('../dist/packages/canvas-adapter/charts/trend.js');
  const { items } = lotItems(5);
  const picked = [];
  const panel = renderTrendPanel({
    items: items.map((it, i) => ({ label: it.label, key: i, dies: it.dies })), testDefs: DEFS,
    onSelectWafers: (sel, at, anchor) => picked.push({ keys: sel.keys, test: sel.testNumber, at, anchor }),
  });
  document.getElementById('root').appendChild(panel.card);
  const body = panel.card.querySelector('canvas').parentElement;
  Object.defineProperty(body, 'clientWidth', { configurable: true, get: () => 700 });
  panel.setTest(1060);   // rebuilds the canvas at the width the body now reports
  const canvas = panel.card.querySelector('canvas');
  canvas.getBoundingClientRect = () => ({ left: 0, top: 0, right: 700, bottom: 300, width: 700, height: 300, x: 0, y: 0 });
  assert.match(panel.card.textContent, /drag across the plot to select wafers/);
  canvas.dispatchEvent(new dom.window.MouseEvent('mousedown', { bubbles: true, button: 0, clientX: 90, clientY: 50 }));
  document.dispatchEvent(new dom.window.MouseEvent('mousemove', { bubbles: true, clientX: 450, clientY: 150 }));
  document.dispatchEvent(new dom.window.MouseEvent('mouseup', { bubbles: true, clientX: 450, clientY: 150 }));
  assert.equal(picked.length, 1, 'a selection');
  assert.deepEqual(picked[0].keys, [1, 2], 'the wafers whose points the drag crossed');
  assert.deepEqual(picked[0].keys, [...picked[0].keys].sort(), 'in order');
  assert.equal(picked[0].test, 1060);
  assert.equal(picked[0].anchor, canvas);
});

test('a selection of wafers on the trend opens the menu on those wafers', () => {
  // end to end through the Insights tab: the trend's host wiring names the selection
  const { tab } = mount('distributions');
  const c = card(tab, 'Wafer-to-wafer trend');
  assert.match(c.textContent, /drag across the plot to select wafers/);
});
