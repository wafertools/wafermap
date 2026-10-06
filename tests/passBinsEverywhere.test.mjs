// A user's pass bins reach every surface that states a yield.
//
// `[1]` is the default when the input names no pass bins, and that default lives in `buildWaferMap`
// alone. The other direction is the dangerous one: a user who states pass bins "3, 5" has made bin 1 a
// FAIL bin, and any surface that falls back to `[1]` reports a wrong yield with nothing to say so.
//
// Every test here builds with passBins [3, 5] and puts bin 1 on a third of the dies, so a fallback to
// [1] gives a visibly different number. The yield each surface must state is worked out here from the
// bins, not read back from the library: with [3, 5] passing it is 12 of 24 (50%); with [1] it would be
// 8 of 24 (33.3%). `passBins.test.mjs` guards the older surfaces (analysis, bin colours, the gallery
// strip); this file guards the ones that open charts and tables on a population.

import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { pretendToBeVisual: true, url: 'http://localhost/' });
for (const k of ['window', 'document', 'HTMLElement', 'HTMLCanvasElement', 'HTMLDivElement', 'HTMLButtonElement', 'Node', 'Event', 'MouseEvent', 'KeyboardEvent', 'CustomEvent', 'DOMRect']) {
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
dom.window.devicePixelRatio = 1;
const noop = () => {};
const proto = dom.window.HTMLCanvasElement.prototype;
proto.getContext = () => new Proxy({}, { get: (_, p) => {
  if (p === 'measureText') return (t) => ({ width: String(t).length * 6 });
  if (p === 'createLinearGradient' || p === 'createRadialGradient') return () => ({ addColorStop: noop });
  if (p === 'getImageData') return () => ({ data: [] });
  if (p === 'canvas') return { width: 600, height: 600 };
  return noop;
} });
proto.focus = noop; proto.setPointerCapture = noop; proto.releasePointerCapture = noop;
Object.defineProperty(proto, 'clientWidth', { configurable: true, get() { return 600; } });
Object.defineProperty(proto, 'clientHeight', { configurable: true, get() { return 600; } });

const { buildWaferMap } = await import('../dist/index.js');
const { renderWaferMap, renderWaferGallery } = await import('../dist/packages/canvas-adapter/index.js');
const { createPlotStore } = await import('../dist/packages/canvas-adapter/plotStore.js');

const PASS = [3, 5];
// 24 dies: bin 1 ×8, bin 2 ×4, bin 3 ×8, bin 5 ×4. Passing under [3, 5]: 12 → 50%. Under [1]: 8 → 33.3%.
const HBINS = [...Array(8).fill(1), ...Array(4).fill(2), ...Array(8).fill(3), ...Array(4).fill(5)];
const RIGHT = '50.0';
const WRONG = '33.3';
const DEFS = [{ testNumber: 1000, name: 'Vth', unit: 'V' }];

function wafer(id = 'W01') {
  return buildWaferMap({
    results: HBINS.map((hbin, k) => ({ x: k % 6, y: Math.floor(k / 6), hbin, testValues: { 1000: k } })),
    testDefs: DEFS,
    waferConfig: { diameter: 80, metadata: { waferId: id } },
    dieConfig: { width: 10, height: 10 },
    passBins: PASS,
  });
}

const tick = () => new Promise(r => setTimeout(r, 0));
const waitFor = async (cond, what) => { for (let i = 0; i < 100 && !cond(); i++) await tick(); assert.ok(cond(), what); };
const menuRows = () => [...document.querySelectorAll('[data-wmap-drilldown-menu] [role="menuitem"]')];
const rightClick = (target) => target.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 1, clientY: 1, button: 2 }));
const tip = (card) => [...card.querySelectorAll('div')].find(d => d.style.display === 'block' && /rgba\(30, 32, 40/.test(d.style.background));
const hover = (card, x, y = 20) => card.querySelector('canvas').dispatchEvent(new dom.window.MouseEvent('mousemove', { bubbles: true, clientX: x, clientY: y }));
/** Sweep the pointer over the canvas until a tooltip shows (jsdom lays nothing out, so where a bar is is not known). */
function hoverAnywhere(card) {
  for (let y = 10; y < 400; y += 6) for (let x = 40; x < 140; x += 2) { hover(card, x, y); if (tip(card)) return tip(card); }
  return undefined;
}

/** One bar: the pooled yield of every die on the wafer. */
const YIELD_BAR = { id: 'y', title: 'Wafer yield', chart: 'bar', fields: { x: { builtin: 'wafer' }, y: { builtin: 'yield' }, color: { none: true } } };
/** The same yield, split by a die-level field (hard bin), which takes the verdict per die. */
const YIELD_BY_BIN = { id: 'r', title: 'Yield by bin', chart: 'bar', fields: { x: { builtin: 'hbin' }, y: { builtin: 'yield' }, color: { none: true } } };

function closeOverlays() {
  for (const b of document.querySelectorAll('.wmap-overlay-box button[aria-label^="Close"]')) b.click();
  document.getElementById('root').innerHTML = '';
}

afterEach(() => { closeOverlays(); document.querySelectorAll('[data-wmap-drilldown-menu]').forEach(m => m.remove()); });

/** Open the saved plot `title` from the drilldown menu that is showing, and return the chart card in its window. */
async function openSavedPlot(title) {
  await waitFor(() => menuRows().length > 0, 'the drilldown menu opened');
  const row = menuRows().find(r => r.textContent === title);
  assert.ok(row, `"${title}" is a row of the menu: ${menuRows().map(r => r.textContent)}`);
  assert.equal(row.getAttribute('aria-disabled'), null, `"${title}" is available`);
  row.click();
  await waitFor(() => document.querySelector('[data-wmap-plot-window] [data-wmap-plot-card]'), 'the plot window opened');
  return document.querySelector('[data-wmap-plot-window] [data-wmap-plot-card]');
}

/** The pooled yield a bar's tooltip states, as text. */
function barYield(card) {
  const t = hoverAnywhere(card);
  assert.ok(t, `hovering the bar shows a tooltip; the card says: ${card.textContent.slice(0, 300)}`);
  const m = /Pooled yield: ([\d.]+)/.exec(t.textContent);
  assert.ok(m, `the tooltip states a pooled yield: ${t.textContent}`);
  return m[1];
}

// ── A single map ─────────────────────────────────────────────────────────────

test('a single map: a saved yield plot opened by right-click uses the map\'s pass bins', async () => {
  const host = document.getElementById('root');
  const div = document.createElement('div'); div.style.height = '600px'; host.appendChild(div);
  const ctrl = renderWaferMap(div, wafer(), { insights: { enabled: false, plots: [YIELD_BAR] } });
  rightClick(div.querySelector('canvas'));
  const card = await openSavedPlot('Wafer yield');
  const y = barYield(card);
  assert.notEqual(y, WRONG, 'bin 1 counted as a pass: [1] was used although the map states [3, 5]');
  assert.equal(y.slice(0, 4), RIGHT);
  closeOverlays(); ctrl.destroy();
});

test('a single map: a yield split by hard bin (the per-die path) judges each bin by the map\'s pass bins', async () => {
  const host = document.getElementById('root');
  const div = document.createElement('div'); div.style.height = '600px'; host.appendChild(div);
  const ctrl = renderWaferMap(div, wafer(), { insights: { enabled: false, plots: [YIELD_BY_BIN] } });
  rightClick(div.querySelector('canvas'));
  const card = await openSavedPlot('Yield by bin');
  // Every bar reachable: a bin passes when it is in [3, 5], so its pooled yield is 100 or 0 and nothing between.
  const seen = new Map();
  for (let y = 10; y < 400; y += 6) for (let x = 40; x < 140; x += 2) {
    hover(card, x, y);
    const t = tip(card);
    const m = t && /^(Bin \d+)[\s\S]*Pooled yield: ([\d.]+)/.exec(t.textContent);
    if (m) seen.set(m[1], Number(m[2]));
  }
  assert.ok(seen.size > 0, `at least one bin's bar can be read; card: ${card.textContent.slice(0, 200)}`);
  for (const [name, pooled] of seen) {
    const bin = Number(name.slice(4));
    assert.equal(pooled, PASS.includes(bin) ? 100 : 0, `${name} is ${PASS.includes(bin) ? 'a pass' : 'a fail'} bin under [${PASS}]`);
  }
  closeOverlays(); ctrl.destroy();
});

// ── A gallery card ───────────────────────────────────────────────────────────

test('a gallery card: a saved yield plot opened by right-click uses that wafer\'s pass bins', async () => {
  const host = document.getElementById('root');
  const div = document.createElement('div'); host.appendChild(div);
  const items = [{ ...wafer('W01'), label: 'W01' }, { ...wafer('W02'), label: 'W02' }];
  const gallery = renderWaferGallery(div, items, { insights: { enabled: false, plots: [YIELD_BAR] } });
  await tick(); await tick();
  const card = div.querySelector('.wmap-gallery-card');
  assert.ok(card, 'a card');
  rightClick(card.querySelector('canvas') ?? card);
  const chart = await openSavedPlot('Wafer yield');
  const y = barYield(chart);
  assert.notEqual(y, WRONG, 'bin 1 counted as a pass: [1] was used although the wafer states [3, 5]');
  assert.equal(y.slice(0, 4), RIGHT);
  closeOverlays(); gallery.destroy();
});
