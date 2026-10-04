// A die row clicked in a table shows that die on the map: the table (a modal that covers the
// map) steps aside, and the die is ringed on the map it belongs to. Canvas work is recorded per
// canvas, so a ring on one card can be told from a ring on another.

import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { pretendToBeVisual: true, url: 'http://localhost/' });
for (const k of ['window', 'document', 'HTMLElement', 'HTMLCanvasElement', 'HTMLDivElement', 'HTMLButtonElement', 'Node', 'Event', 'MouseEvent', 'KeyboardEvent', 'CustomEvent', 'Blob', 'DOMRect', 'URL']) {
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
// One recorder per canvas: a drawing context whose `lineWidth` assignments are logged. The located-die
// ring is the only thing drawn with a 6px halo, so a "lw6" is the ring.
const logs = new WeakMap();
const ctxs = new WeakMap();
proto.getContext = function () {
  if (ctxs.has(this)) return ctxs.get(this);
  const log = [];
  logs.set(this, log);
  const store = {};
  const ctx = new Proxy(store, {
    get: (t, p) => {
      if (p in t) return t[p];
      if (p === 'measureText') return (s) => ({ width: String(s).length * 6 });
      if (p === 'createLinearGradient' || p === 'createRadialGradient') return () => ({ addColorStop: noop });
      if (p === 'getImageData') return () => ({ data: [] });
      if (p === 'canvas') return { width: 600, height: 600 };
      return noop;
    },
    set: (t, p, v) => { t[p] = v; if (p === 'lineWidth') log.push('lw' + v); return true; },
  });
  ctxs.set(this, ctx);
  return ctx;
};
proto.focus = noop; proto.setPointerCapture = noop; proto.releasePointerCapture = noop;
Object.defineProperty(proto, 'clientWidth', { configurable: true, get() { return 600; } });
Object.defineProperty(proto, 'clientHeight', { configurable: true, get() { return 600; } });
dom.window.HTMLElement.prototype.scrollIntoView = function () { (globalThis.__scrolled ??= []).push(this); };

const { buildWaferMap } = await import('../dist/index.js');
const { renderWaferMap, renderWaferGallery } = await import('../dist/packages/canvas-adapter/index.js');

const tick = () => new Promise(r => setTimeout(r, 0));
const waitFor = async (cond, what) => { for (let i = 0; i < 300 && !cond(); i++) await new Promise(r => setTimeout(r, 5)); assert.ok(cond(), what); };
const rings = (canvas) => (logs.get(canvas) ?? []).filter(l => l === 'lw6').length;

function wafer(id) {
  return {
    ...buildWaferMap({
      results: Array.from({ length: 24 }, (_, k) => ({ x: k % 6, y: Math.floor(k / 6), hbin: 1, testValues: { 1000: k + id.length } })),
      testDefs: [{ testNumber: 1000, name: 'Idsat' }],
      waferConfig: { diameter: 80, metadata: { lot: 'L1', waferId: id } },
      dieConfig: { width: 10, height: 10 }, passBins: [1],
    }),
    label: id,
  };
}
const pointer = (canvas, type, x, y) => {
  const e = new MouseEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0 });
  Object.defineProperty(e, 'pointerId', { value: 1 });
  canvas.dispatchEvent(e);
};
const rightClick = (target) => {
  const e = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 1, clientY: 1, button: 2 });
  target.dispatchEvent(e);
  return e.defaultPrevented;
};
const menus = () => [...document.querySelectorAll('[data-wmap-drilldown-menu]')];
const modal = () => document.querySelector('.wmap-overlay-box');
const dieRows = () => [...document.querySelectorAll('.wmap-overlay-box tbody tr[aria-rowindex]')];
const click = (el) => el.dispatchEvent(new MouseEvent('click', { bubbles: true }));

// ── From a drilldown table on a single map ───────────────────────────────────

async function openSelectionTable() {
  const host = document.getElementById('root');
  host.innerHTML = '';
  const result = wafer('W7');
  const ctrl = renderWaferMap(host, result, { insights: { enabled: false } });
  ctrl.setSelection(result.dies.slice(0, 5));
  const canvas = host.querySelector('canvas');
  rightClick(canvas);
  await waitFor(() => menus().length > 0, 'the menu opened');
  [...menus()[0].querySelectorAll('[role="menuitem"]')].find(i => i.textContent === 'Dies').click();
  await waitFor(() => dieRows().length > 0, 'the table opened');
  return { ctrl, canvas, host };
}

test('a selection table says its rows can be clicked, and a click rings that die and closes the table', async () => {
  const { ctrl, canvas } = await openSelectionTable();
  assert.match(modal().querySelector('[data-wmap-data-note]').textContent, /Click a row to show that die on the map/);
  const before = rings(canvas);
  click(dieRows()[2]);
  assert.equal(modal(), null, 'the table stepped aside');
  assert.ok(rings(canvas) > before, 'the die is ringed on the map');
  ctrl.destroy();
});

/** Draw once more, then report whether that draw added a ring. */
function ringsDrawnBy(canvas, trigger) {
  const before = rings(canvas);
  trigger();
  return rings(canvas) - before;
}

test('the ring goes with the next click on the map', async () => {
  const { ctrl, canvas } = await openSelectionTable();
  click(dieRows()[0]);
  assert.ok(ringsDrawnBy(canvas, () => ctrl.setOptions({ showTooltip: false })) > 0, 'while located, every draw rings it');
  pointer(canvas, 'pointerdown', 2, 2);
  pointer(canvas, 'pointerup', 2, 2);
  assert.equal(ringsDrawnBy(canvas, () => ctrl.setOptions({ showTooltip: true })), 0, 'after a click, no ring');
  ctrl.destroy();
});

test('and with Esc', async () => {
  const { ctrl, canvas } = await openSelectionTable();
  click(dieRows()[0]);
  assert.ok(ringsDrawnBy(canvas, () => ctrl.setOptions({ showTooltip: false })) > 0);
  canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.equal(ringsDrawnBy(canvas, () => ctrl.setOptions({ showTooltip: true })), 0, 'after Esc, no ring');
  ctrl.destroy();
});

// ── Gallery: the lot's Data tables, from the Summary panel ───────────────────

test('in a gallery, a die row rings that die on its own card only, and brings the card into view', async () => {
  const host = document.getElementById('root');
  host.innerHTML = '';
  globalThis.__scrolled = [];
  const items = ['W1', 'W2', 'W3'].map(wafer);
  const lot = { level: 'lot', hasNotableFindings: false, findings: [], lotYieldSeries: [], stats: { waferCount: 3 }, perWafer: [] };
  const gallery = renderWaferGallery(host, items, { lotStatsSummary: lot, summaryPanel: { defaultOpen: true } });
  await tick(); await tick();
  const canvases = [...host.querySelectorAll('.wmap-gallery-card canvas')];
  assert.equal(canvases.length, 3);
  const open = [...host.querySelectorAll('button')].find(b => b.textContent === 'Data tables');
  assert.ok(open, 'the lot Summary panel has Data tables');
  click(open);
  await waitFor(() => dieRows().length > 0, 'the table opened');
  // Pick a W2 die (the Wafer column leads).
  const row = dieRows().find(r => r.querySelector('td').textContent === 'W2');
  assert.ok(row);
  const before = canvases.map(rings);
  click(row);
  assert.equal(modal(), null);
  const after = canvases.map(rings);
  assert.ok(after[1] > before[1], 'W2 is ringed');
  assert.equal(after[0], before[0], 'W1 is not');
  assert.equal(after[2], before[2], 'W3 is not');
  assert.ok(globalThis.__scrolled.some(el => el.classList.contains('wmap-gallery-card')), 'the card was scrolled into view');
  gallery.destroy();
});

// ── Insights: leave it for the map ───────────────────────────────────────────

test('in Insights, a Data tab row goes back to the map and rings the die', async () => {
  const host = document.getElementById('root');
  host.innerHTML = '';
  const result = wafer('W9');
  const ctrl = renderWaferMap(host, result, { insights: { enabled: true } });
  const canvas = host.querySelector('canvas');
  ctrl.setInsightsOpen(true);
  await waitFor(() => host.querySelector('button[data-wmap-insights-tab="data"]'), 'Insights loaded');
  click(host.querySelector('button[data-wmap-insights-tab="data"]'));
  await waitFor(() => host.querySelector('[data-wmap-data-view="dies"]'), 'the Data tab opened');
  click(host.querySelector('[data-wmap-data-view="dies"]'));
  const rows = () => [...host.querySelectorAll('[data-wmap-data-tab] tbody tr[aria-rowindex]')];
  await waitFor(() => rows().length > 0, 'the Dies table opened');
  assert.match(host.querySelector('[data-wmap-data-note]').textContent, /Click a row to show that die on the map/);
  const before = rings(canvas);
  click(rows()[1]);
  assert.equal(ctrl.isInsightsOpen?.() ?? false, false, 'Insights closed');
  assert.ok(rings(canvas) > before, 'and the die is ringed on the map');
  ctrl.destroy();
});

// ── Without a map to go to ───────────────────────────────────────────────────

test('where the host gives no way to show a die, rows are not offered as clickable', async () => {
  const { renderDataTables } = await import('../dist/packages/canvas-adapter/dataTab.js');
  const w = wafer('W1');
  const { el } = renderDataTables({ doc: document, items: [{ label: 'W1', dies: w.dies, wafer: w.wafer }], testDefs: w.testDefs, view: 'dies' });
  document.getElementById('root').replaceChildren(el);
  assert.doesNotMatch(el.querySelector('[data-wmap-data-note]').textContent, /Click a row/);
  assert.equal(el.querySelector('tbody tr[aria-rowindex]').style.cursor, '');
});
