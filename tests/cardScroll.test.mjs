// A card in the Insights grid is the size it asks for, whatever the data: what grows with the data scrolls inside it.
// Rows of a horizontal plot, columns of the capability chart, a long colour legend and a table listed in full all scroll,
// so a lot with thousands of tests never makes a card (and every card beside it in its row) as tall as all of them.
import test from 'node:test';
import assert from 'node:assert/strict';
import { setupDom, makeCanvasContext } from './fixtures/domHarness.mjs';

const texts = [];
setupDom({
  canvasSize: { width: 600, height: 400 },
  context: () => ({ ...makeCanvasContext(), fillText: t => { texts.push(String(t)); } }),
});
// jsdom lays nothing out: give every element the width of a grid card.
Object.defineProperty(window.HTMLElement.prototype, 'clientWidth', { configurable: true, get() { return 600; } });

const { buildWaferMap } = await import('../dist/index.js');
const { resolvePlot } = await import('../dist/packages/stats/plotData.js');
const { renderPlotChart } = await import('../dist/packages/canvas-adapter/charts/plotChart.js');
const { renderCapabilityPanel } = await import('../dist/packages/canvas-adapter/charts/capability.js');
const { firstRowsToggle } = await import('../dist/packages/canvas-adapter/charts/chartShell.js');

const TESTS = 300;
const DEFS = Array.from({ length: TESTS }, (_, i) => ({ testNumber: 1000 + i, name: `t${String(i).padStart(3, '0')}`, unit: 'V', limitLow: 0.2, limitHigh: 0.8 }));
const wafer = (i) => {
  const r = buildWaferMap({
    results: Array.from({ length: 24 }, (_, k) => ({ x: k % 6, y: Math.floor(k / 6), hbin: 1,
      testValues: Object.fromEntries(DEFS.map((d, j) => [d.testNumber, ((k * 7 + j * 3 + i) % 20) / 20])) })),
    waferConfig: { diameter: 80, metadata: { lot: 'L', wafer: `W${i + 1}` } }, dieConfig: { width: 10, height: 10 }, passBins: [1], testDefs: DEFS,
  });
  return { label: `W${i + 1}`, dies: r.dies, waferIndex: i, wafer: r.wafer, passBins: [1], ringCount: 4, metadata: r.metadata, testDefs: DEFS };
};
const root = () => document.getElementById('root');
const px = (v) => parseFloat(v) || 0;

test('a horizontal plot of hundreds of tests asks for a card of the usual size, and scrolls its rows', () => {
  const items = [wafer(0)];
  const r = resolvePlot({ id: 'p', chart: 'bar', orientation: 'horizontal', fields: { x: { builtin: 'test' }, y: { tests: DEFS.map(d => d.testNumber), passRate: true }, color: { none: true } } }, items, { testDefs: DEFS });
  assert.deepEqual(r.issues, []);
  const chart = renderPlotChart({ ownerDocument: document, waferLabel: () => 'W1' });
  root().replaceChildren(chart.card);
  texts.length = 0;
  chart.setPlot(r);
  assert.ok(px(chart.card.style.minHeight) < 800, `asks for ${chart.card.style.minHeight}, not the ${TESTS * 22}px of every row`);
  const bar = chart.card.querySelector('[data-wmap-row-scroll]');
  assert.equal(bar.style.display, 'block', 'a scrollbar beside the rows');
  assert.equal(px(bar.firstElementChild.style.height), TESTS * 22, 'whose track is as long as every row');
  assert.match(bar.getAttribute('aria-label'), /300 rows/);
  assert.ok(texts.includes('t000') && !texts.includes(`t${TESTS - 1}`), 'only the rows in view are labelled');

  // Scrolled to the end, the last rows are drawn in place of the first.
  let top = 0;
  Object.defineProperty(bar, 'scrollTop', { configurable: true, get: () => top, set: v => { top = v; } });
  top = TESTS * 22;
  texts.length = 0;
  bar.dispatchEvent(new window.Event('scroll'));
  assert.ok(texts.includes(`t${TESTS - 1}`) && !texts.includes('t000'), 'scrolled, the last rows are drawn');
  chart.destroy();
});

test('a horizontal plot with few rows has no scrollbar', () => {
  const few = DEFS.slice(0, 4);
  const r = resolvePlot({ id: 'p', chart: 'bar', orientation: 'horizontal', fields: { x: { builtin: 'test' }, y: { tests: few.map(d => d.testNumber), passRate: true }, color: { none: true } } }, [wafer(0)], { testDefs: DEFS });
  const chart = renderPlotChart({ ownerDocument: document, waferLabel: () => 'W1' });
  root().replaceChildren(chart.card);
  chart.setPlot(r);
  assert.equal(chart.card.querySelector('[data-wmap-row-scroll]').style.display, 'none');
  chart.destroy();
});

test('a legend of many colours scrolls after a few lines in the grid', () => {
  const items = Array.from({ length: 40 }, (_, i) => wafer(i));
  const r = resolvePlot({ id: 'p', chart: 'scatter', fields: { x: { test: 1000 }, y: { test: 1001 }, color: { builtin: 'wafer' } } }, items, { testDefs: DEFS });
  const chart = renderPlotChart({ ownerDocument: document, waferLabel: i => `W${i + 1}` });
  root().replaceChildren(chart.card);
  chart.setPlot(r);
  const legend = chart.card.querySelector('[data-wmap-plot-legend]');
  assert.equal(legend.children.length, 40);
  assert.equal(legend.style.maxHeight, '92px');
  assert.equal(legend.style.overflowY, 'auto');
  chart.destroy();
});

test('the capability chart of hundreds of tests draws only the width of its card, and scrolls its columns', () => {
  const panel = renderCapabilityPanel({ items: [wafer(0)], testDefs: DEFS });
  root().replaceChildren(panel.card);
  const canvas = panel.card.querySelector('canvas');
  assert.ok(canvas.width <= 600 * 2, `a canvas ${canvas.width}px wide, not one column of 30px for each of ${TESTS} tests`);
  const bar = panel.card.querySelector('[data-wmap-col-scroll]');
  assert.equal(bar.style.display, 'block');
  assert.ok(px(bar.firstElementChild.style.width) >= TESTS * 30, 'a scrollbar whose track is as wide as every column');
  panel.destroy?.();
});

test('a table listed in full scrolls inside its card, and the button goes back to the first rows', () => {
  const scroller = document.createElement('div');
  const shown = [];
  const more = firstRowsToggle(document, { total: 100, first: 8, noun: 'wafers', scroller, fill: all => shown.push(all) });
  assert.equal(more.textContent, 'Show all 100 wafers');
  assert.equal(scroller.style.maxHeight, '');
  more.click();
  assert.equal(scroller.style.maxHeight, '360px');
  assert.equal(scroller.style.overflowY, 'auto');
  assert.equal(more.textContent, 'Show the first wafers');
  more.click();
  assert.deepEqual(shown, [false, true, false]);
  assert.equal(firstRowsToggle(document, { total: 5, first: 8, noun: 'rows', scroller, fill: () => {} }).style.display, 'none', 'nothing to show more of');
});
