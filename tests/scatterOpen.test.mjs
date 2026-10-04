// Scatter: a point is a die, so it names its wafer and die on hover and opens that
// wafer on a click (the same (waferIndex, testNumber) the boxplot and trend use).
// Canvas calls are recorded to find where the points were drawn.

import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body><div id="host"></div></body></html>', { pretendToBeVisual: true });
for (const k of ['window', 'document', 'HTMLElement', 'HTMLCanvasElement', 'HTMLDivElement', 'HTMLButtonElement', 'Node', 'Event', 'MouseEvent', 'KeyboardEvent', 'CustomEvent', 'DOMRect']) {
  globalThis[k] = k === 'window' ? dom.window : dom.window[k];
}
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
globalThis.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
dom.window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
dom.window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
globalThis.ResizeObserver = dom.window.ResizeObserver;
// A body 600px wide, so the plot has real geometry.
Object.defineProperty(dom.window.HTMLElement.prototype, 'clientWidth', { configurable: true, get() { return 600; } });
Object.defineProperty(dom.window.HTMLElement.prototype, 'clientHeight', { configurable: true, get() { return 400; } });
dom.window.HTMLCanvasElement.prototype.getBoundingClientRect = () => ({ left: 0, top: 0, right: 600, bottom: 400, width: 600, height: 400 });

let arcs = [];
const noop = () => {};
dom.window.HTMLCanvasElement.prototype.getContext = () => new Proxy({}, { get: (_, p) => {
  if (p === 'arc') return (cx, cy, r) => arcs.push({ cx, cy, r });
  if (p === 'measureText') return () => ({ width: 10 });
  if (p === 'createLinearGradient' || p === 'createRadialGradient') return () => ({ addColorStop: noop });
  if (p === 'getImageData') return () => ({ data: [] });
  if (p === 'canvas') return { width: 600, height: 400 };
  return noop;
} });

const { buildScatterData, buildScatterDataGrouped } = await import('../dist/packages/stats/scatter.js');
const { renderScatterPanel } = await import('../dist/packages/canvas-adapter/charts/scatter.js');

const DEFS = [{ testNumber: 1, name: 'vth', unit: 'V' }, { testNumber: 2, name: 'idsat', unit: 'A' }];
const die = (x, y, a, b, hbin = 1) => ({ x, y, hbin, testValues: { 1: a, 2: b } });
// Two wafers, two dies each, well apart in both axes.
const ITEMS = [
  { label: 'W01', waferIndex: 0, dies: [die(0, 0, 0.1, 0.001), die(1, 0, 0.9, 0.009, 2)] },
  { label: 'W02', waferIndex: 1, dies: [die(5, 5, 0.5, 0.005), die(6, 5, 0.3, 0.007)] },
];

const click = (el, x, y) => el.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, clientX: x, clientY: y }));
const move = (el, x, y) => el.dispatchEvent(new dom.window.MouseEvent('mousemove', { bubbles: true, clientX: x, clientY: y }));

function mount(opts = {}) {
  const host = dom.window.document.getElementById('host');
  host.innerHTML = '';
  arcs = [];
  const panel = renderScatterPanel({ items: ITEMS, testDefs: DEFS, xTestNumber: 1, yTestNumber: 2, ownerDocument: dom.window.document, ...opts });
  host.appendChild(panel.card);
  panel.setXY(1, 2);                      // redraw now that it is mounted
  const canvas = panel.card.querySelector('canvas');
  const dots = () => arcs.filter(a => a.r === 2.5);
  // The chart's own hover tip is the one that gets text; the card carries other, empty ones.
  const tip = () => [...panel.card.querySelectorAll('div')].filter(d => d.style.pointerEvents === 'none' && d.style.zIndex === '50').find(d => d.innerHTML !== '') ?? panel.card.querySelector('div[style*="z-index: 50"]');
  return { panel, canvas, dots, tip };
}

test('scatter points carry the die and the wafer index of their item', () => {
  const pts = buildScatterData(ITEMS, 1, 2);
  assert.equal(pts.length, 4);
  assert.deepEqual(pts.map(p => p.waferIndex), [0, 0, 1, 1]);
  assert.equal(pts[2].die, ITEMS[1].dies[0]);
  const grouped = buildScatterDataGrouped([{ key: 'A', items: [ITEMS[1]] }], 1, 2);
  assert.deepEqual(grouped.map(p => [p.group, p.waferIndex]), [['A', 1], ['A', 1]]);
});

test('an item with no waferIndex gives points with none, so they are not clickable', () => {
  const pts = buildScatterData([{ dies: [die(0, 0, 1, 2)] }], 1, 2);
  assert.equal(pts[0].waferIndex, undefined);
  assert.ok(!('waferIndex' in pts[0]));
});

test('hovering a point names its wafer, die and values, and says a click opens it', () => {
  const { canvas, dots, tip } = mount({ onOpen: () => {} });
  const d = dots()[2];                     // W02, die (5,5)
  move(canvas, d.cx, d.cy);
  assert.equal(tip().style.display, 'block');
  assert.match(tip().textContent, /W02/);
  assert.match(tip().textContent, /die \(5, 5\)/);
  assert.match(tip().textContent, /vth/);
  assert.match(tip().textContent, /idsat/);
  assert.match(tip().textContent, /click to open this wafer/);
  assert.equal(canvas.style.cursor, 'pointer');
});

test('clicking a point opens its wafer on the X test', () => {
  const calls = [];
  const { canvas, dots } = mount({ onOpen: (w, t) => calls.push([w, t]) });
  const a = dots()[0], b = dots()[3];
  click(canvas, a.cx, a.cy);
  click(canvas, b.cx + 2, b.cy - 2);       // near, not on, the centre
  assert.deepEqual(calls, [[0, 1], [1, 1]]);
});

test('the X test is the one handed over, wherever it was changed to', () => {
  const calls = [];
  const { panel, canvas, dots } = mount({ onOpen: (w, t) => calls.push([w, t]) });
  panel.setXY(2, 1);
  const d = dots();
  click(canvas, d[0].cx, d[0].cy);
  assert.deepEqual(calls, [[0, 2]]);
});

test('a click away from every point does nothing', () => {
  const calls = [];
  const { canvas } = mount({ onOpen: (w, t) => calls.push([w, t]) });
  click(canvas, 2, 2);
  assert.deepEqual(calls, []);
});

test('without onOpen the tooltip does not promise a click, and the cursor stays a crosshair', () => {
  const { canvas, dots, tip, panel } = mount();
  const d = dots()[1];
  move(canvas, d.cx, d.cy);
  assert.equal(tip().style.display, 'block');
  assert.doesNotMatch(tip().textContent, /click to/);
  assert.equal(canvas.style.cursor, 'crosshair');
  assert.doesNotMatch(panel.card.textContent, /click a point/);
});

test('a point with no wafer index shows its tooltip but is not clickable', () => {
  const calls = [];
  const { canvas, dots, tip } = mount({ items: [{ label: 'X', dies: ITEMS[0].dies }], onOpen: (w, t) => calls.push([w, t]) });
  const d = dots()[0];
  move(canvas, d.cx, d.cy);
  assert.doesNotMatch(tip().textContent, /click to/);
  click(canvas, d.cx, d.cy);
  assert.deepEqual(calls, []);
});

test('a point filtered out by the legend can no longer be hit', () => {
  const calls = [];
  const { panel, canvas, dots } = mount({ onOpen: (w, t) => calls.push([w, t]) });
  const hidden = dots()[1];               // W01's second die is hard bin 2
  const chip = [...panel.card.querySelectorAll('[data-cat]')].find(c => c.dataset.cat === '1');
  click(chip, 0, 0);                      // keep only bin 1
  click(canvas, hidden.cx, hidden.cy);
  assert.deepEqual(calls, []);
});

test('the hint says what a click does, and in the host\'s words when it is not "open this wafer"', () => {
  const a = mount({ onOpen: () => {} });
  assert.match(a.panel.card.textContent, /click a point to open this wafer/);
  const b = mount({ onOpen: () => {}, openActionLabel: 'show this test on the map' });
  assert.match(b.panel.card.textContent, /click a point to show this test on the map/);
});

test('the hovered point is ringed, and the ring goes when the mouse leaves', () => {
  const { canvas, dots } = mount({ onOpen: () => {} });
  const d = dots()[0];
  arcs = [];
  move(canvas, d.cx, d.cy);
  assert.ok(arcs.some(a => a.r === 5), 'a ring was drawn');
  arcs = [];
  canvas.dispatchEvent(new dom.window.MouseEvent('mouseleave', { bubbles: true }));
  assert.ok(!arcs.some(a => a.r === 5), 'and not after leaving');
});

// ── Drag to select ───────────────────────────────────────────────────────────

const mouse = (el, type, x, y) => el.dispatchEvent(new dom.window.MouseEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0 }));
/** Press on the canvas, drag across the document, release. */
function drag(canvas, from, to) {
  mouse(canvas, 'mousedown', from[0], from[1]);
  mouse(dom.window.document, 'mousemove', (from[0] + to[0]) / 2, (from[1] + to[1]) / 2);
  mouse(dom.window.document, 'mousemove', to[0], to[1]);
  mouse(dom.window.document, 'mouseup', to[0], to[1]);
}

test('dragging a rectangle selects the dies in it, across wafers, and hands them to the host', () => {
  const got = [];
  const { canvas, dots, panel } = mount({ onSelect: (pts, at, anchor, x) => got.push({ pts, at, anchor, x }) });
  const d = dots();
  // From above-left of W01's high die (top right) to below-left of W02's two: three of the four points.
  drag(canvas, [d[3].cx - 20, d[1].cy - 20], [d[1].cx + 20, d[2].cy + 20]);
  assert.equal(got.length, 1);
  assert.equal(got[0].x, 1, 'with the X test it was drawn for');
  assert.equal(got[0].anchor, canvas);
  const waferIdx = got[0].pts.map(p => p.waferIndex).sort();
  assert.deepEqual(waferIdx, [0, 1, 1]);
  assert.match(panel.card.textContent, /3 selected/);
});

test('a drag of a few pixels is a click, not a selection', () => {
  const sel = [], opened = [];
  const { canvas, dots } = mount({ onSelect: p => sel.push(p), onOpen: (w, t) => opened.push([w, t]) });
  const d = dots()[0];
  mouse(canvas, 'mousedown', d.cx, d.cy);
  mouse(dom.window.document, 'mousemove', d.cx + 1, d.cy + 1);
  mouse(dom.window.document, 'mouseup', d.cx + 1, d.cy + 1);
  click(canvas, d.cx + 1, d.cy + 1);
  assert.deepEqual(sel, []);
  assert.deepEqual(opened, [[0, 1]]);
});

test('the click that follows a drag does not also open a wafer', () => {
  const opened = [];
  const { canvas, dots } = mount({ onSelect: () => {}, onOpen: (w, t) => opened.push([w, t]) });
  const d = dots();
  drag(canvas, [d[0].cx - 30, d[0].cy + 30], [d[0].cx + 30, d[0].cy - 30]);
  click(canvas, d[0].cx, d[0].cy);                   // the browser's click after mouseup
  assert.deepEqual(opened, []);
});

test('selected points are ringed, and a click on empty space clears the selection', () => {
  const { canvas, dots, panel } = mount({ onSelect: () => {} });
  const d = dots();
  arcs = [];
  drag(canvas, [d[1].cx - 30, d[1].cy - 30], [d[1].cx + 30, d[1].cy + 30]);
  assert.ok(arcs.some(a => a.r === 4), 'the selected point has a ring');
  assert.match(panel.card.textContent, /1 selected/);
  click(canvas, d[1].cx, d[1].cy);                   // the browser's click after the drag: swallowed
  assert.match(panel.card.textContent, /1 selected/);
  arcs = [];
  click(canvas, 2, 2);
  assert.doesNotMatch(panel.card.textContent, /selected/);
  assert.ok(!arcs.some(a => a.r === 4));
  assert.match(panel.card.textContent, /drag to select dies/);
});

test('changing the X or Y test drops the selection', () => {
  const { canvas, dots, panel } = mount({ onSelect: () => {} });
  const d = dots()[0];
  drag(canvas, [d.cx - 20, d.cy + 20], [d.cx + 20, d.cy - 20]);
  assert.match(panel.card.textContent, /selected/);
  panel.setXY(2, 1);
  assert.doesNotMatch(panel.card.textContent, /\d selected/);
});

test('a point the legend has filtered out is not selected by a rectangle over it', () => {
  const got = [];
  const { panel, canvas, dots } = mount({ onSelect: pts => got.push(pts) });
  const d = dots();
  const chip = [...panel.card.querySelectorAll('[data-cat]')].find(c => c.dataset.cat === '1');
  click(chip, 0, 0);                                  // keep only hard bin 1
  drag(canvas, [d[1].cx - 30, d[1].cy - 30], [d[1].cx + 30, d[1].cy + 30]);   // W01's bin-2 die
  assert.deepEqual(got, []);
});

test('no rectangle is offered without onSelect', () => {
  const { canvas, dots, panel } = mount();
  const d = dots();
  drag(canvas, [d[0].cx - 30, d[0].cy + 30], [d[0].cx + 30, d[0].cy - 30]);
  assert.doesNotMatch(panel.card.textContent, /selected|drag to select/);
});

// ── In Insights: a dragged selection is a drilldown population ───────────────

test('in Insights, dragging over the scatter opens the drilldown menu for those dies, with a Wafers table across wafers', async () => {
  const { buildWaferMap } = await import('../dist/index.js');
  const { analyzeWaferLot } = await import('../dist/packages/stats/index.js');
  const { createInsightsTab } = await import('../dist/packages/canvas-adapter/insightsTab.js');
  const mk = (i) => ({
    ...buildWaferMap({
      results: Array.from({ length: 12 }, (_, k) => ({ x: k % 4, y: Math.floor(k / 4), hbin: 1, testValues: { 1050: 0.4 + k / 100 + i / 10, 1060: 0.001 + k / 1e4 + i / 1e3 } })),
      waferConfig: { diameter: 80, metadata: { lot: 'L1', wafer: `W${i + 1}` } }, dieConfig: { width: 10, height: 10 }, passBins: [1],
      testDefs: [{ testNumber: 1050, name: 'vth' }, { testNumber: 1060, name: 'idsat' }],
    }), label: `W${i + 1}`,
  });
  const items = [mk(0), mk(1)];
  const lot = analyzeWaferLot(items, { computePerTestStats: true });
  items.forEach((it, i) => { it.statsSummary = lot.perWafer[i].summary; });
  const host = dom.window.document.getElementById('host');
  host.innerHTML = '';
  arcs = [];
  const tab = createInsightsTab({
    getItems: () => items, getLotStats: () => lot, defaultView: 'correlation',
    getBinColors: () => ({ hard: new Map(), soft: new Map(), shared: { hard: [], soft: [] }, pass: { hard: new Set(), soft: new Set() } }),
  });
  host.appendChild(tab.el);
  tab.render();
  const canvas = tab.el.querySelector('[data-wmap-chart-title="Test scatter"] canvas');
  assert.ok(canvas, 'the scatter is there');
  drag(canvas, [0, 0], [600, 400]);

  const menu = dom.window.document.querySelector('[data-wmap-drilldown-menu]');
  assert.ok(menu, 'the drilldown menu opened');
  assert.match(menu.getAttribute('aria-label'), /24 dies selected in the scatter, across 2 wafers/);
  const labels = [...menu.querySelectorAll('[role="menuitem"]')].map(i => i.textContent);
  assert.ok(labels.includes('Dies') && labels.includes('Test statistics') && labels.includes('Wafers'), labels.join(' | '));

  [...menu.querySelectorAll('[role="menuitem"]')].find(i => i.textContent === 'Wafers').click();
  for (let i = 0; i < 200 && !dom.window.document.querySelector('.wmap-overlay-box [data-wmap-data-view="wafers"]'); i++) await new Promise(r => setTimeout(r, 5));
  const box = dom.window.document.querySelector('.wmap-overlay-box');
  assert.ok(box, 'the table opened');
  assert.equal(box.querySelector('[data-wmap-data-view="wafers"]').getAttribute('aria-checked'), 'true');
  assert.equal(box.querySelectorAll('tbody tr[aria-rowindex]').length, 2, 'one row per wafer');
  assert.match(box.textContent, /24 dies selected in the scatter, across 2 wafers/);
  box.querySelector('button[aria-label^="Close"]')?.click();
  tab.destroy();
});
