// The Insights test scatter: a point is a die, so a dragged rectangle is a population of dies, per wafer, for the
// drilldown menu. (Hover, click and drag on a plot's points are pointInteractions.ts, tested with the plot charts.)

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

/** Press at one point, move to another and release: a drag-select. */
function drag(el, [x0, y0], [x1, y1]) {
  el.dispatchEvent(new dom.window.MouseEvent('mousedown', { bubbles: true, button: 0, clientX: x0, clientY: y0 }));
  dom.window.document.dispatchEvent(new dom.window.MouseEvent('mousemove', { bubbles: true, clientX: x1, clientY: y1 }));
  dom.window.document.dispatchEvent(new dom.window.MouseEvent('mouseup', { bubbles: true, clientX: x1, clientY: y1 }));
}

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
  const tab = createInsightsTab({ getRingCount: () => 4,
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
