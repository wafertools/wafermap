// Drilldown: right-click (or the toolbar button) opens a menu of charts drawn
// from a population — the dies selected on a map, a whole wafer (empty map
// space, a gallery card, a wafer's bar/box/point in an Insights chart). What
// must hold:
//
// - the menu names its population, and every chart it opens does too — a
//   histogram of 12 hand-picked dies looks exactly like a whole-wafer one;
// - a chart that cannot be drawn stays listed, disabled, with the reason (the
//   library decides validity, never the caller) — including a lot stack, whose
//   dies are per-position aggregates rather than measured dies;
// - right-click is taken over only when some chart could exist: a bins-only map
//   with no sweeps leaves the browser's (or host's) own menu alone.

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
const { openDrilldownMenu } = await import('../dist/packages/canvas-adapter/drilldown.js');
const { selectionPopulation, waferPopulation } = await import('../dist/packages/canvas-adapter/chartPopulation.js');
const { renderBarPanel } = await import('../dist/packages/canvas-adapter/charts/barPanel.js');

const TEST_DEFS = [
  { testNumber: 1000, name: 'Step 0' },
  { testNumber: 1001, name: 'Step 1' },
  { testNumber: 2000, name: 'Other' },
];
const SWEEP = { id: 's', title: 'Drive sweep', series: [{ label: 'Up', tests: [1000, 1001] }] };
const ABSENT = { id: 'a', title: 'Absent sweep', series: [{ label: 'Up', tests: [3000, 3001] }] };

function wafer(extra = {}) {
  return buildWaferMap({
    results: Array.from({ length: 24 }, (_, k) => ({
      x: k % 6, y: Math.floor(k / 6), hbin: 1, testValues: { 1000: k, 1001: k + 1, 2000: 5 },
    })),
    testDefs: TEST_DEFS,
    waferConfig: { diameter: 80, metadata: { waferId: 'W07' } },
    dieConfig: { width: 10, height: 10 },
    passBins: [1],
    ...extra,
  });
}

/** Bins only — nothing a drilldown chart could draw. */
function binsOnlyWafer() {
  return buildWaferMap({
    results: Array.from({ length: 24 }, (_, k) => ({ x: k % 6, y: Math.floor(k / 6), hbin: 1 })),
    waferConfig: { diameter: 80, metadata: { waferId: 'W08' } },
    dieConfig: { width: 10, height: 10 },
    passBins: [1],
  });
}

const menus = () => [...document.querySelectorAll('[data-wmap-drilldown-menu]')];
const rows = () => [...menus()[0].querySelectorAll('[role="menuitem"]')];
const tick = () => new Promise(r => setTimeout(r, 0));
const facts = { waferLabel: 'W07', testDefs: TEST_DEFS };

function anchor() {
  const el = document.createElement('button');
  document.getElementById('root').appendChild(el);
  return el;
}

function closeModal() {
  document.querySelector('.wmap-overlay-box button[aria-label^="Close"]')?.click();
}

test('the menu names its population and lists the distribution charts and each sweep', () => {
  const src = selectionPopulation(wafer().dies.slice(0, 5), facts);
  const close = openDrilldownMenu({ x: 10, y: 10 }, anchor(), src, { sweeps: [SWEEP] });
  assert.equal(menus()[0].getAttribute('aria-label'), 'Open a chart or table of 5 dies selected on W07');
  assert.deepEqual(rows().map(i => i.textContent), ['Value histogram', 'Process capability', 'Drive sweep', 'Dies', 'Test statistics']);
  assert.ok(rows().every(i => i.getAttribute('aria-disabled') === null));
  close();
  assert.equal(menus().length, 0);
});

test('a whole wafer is named as one', () => {
  const close = openDrilldownMenu({ x: 10, y: 10 }, anchor(), waferPopulation(wafer().dies, facts), {});
  assert.equal(menus()[0].getAttribute('aria-label'), 'Open a chart or table of 24 dies on W07');
  close();
});

test('a sweep with no values in the population stays listed, disabled', () => {
  const src = selectionPopulation(wafer().dies.slice(0, 3), facts);
  const close = openDrilldownMenu({ x: 10, y: 10 }, anchor(), src, { sweeps: [SWEEP, ABSENT] });
  const byLabel = Object.fromEntries(rows().map(i => [i.textContent, i.getAttribute('aria-disabled')]));
  assert.equal(byLabel['Drive sweep'], null);
  assert.equal(byLabel['Absent sweep'], 'true');
  close();
});

test('capability needs two dies with values; one die leaves it listed but disabled', () => {
  const close = openDrilldownMenu({ x: 10, y: 10 }, anchor(), selectionPopulation(wafer().dies.slice(0, 1), facts), {});
  const byLabel = Object.fromEntries(rows().map(i => [i.textContent, i.getAttribute('aria-disabled')]));
  assert.equal(byLabel['Value histogram'], null);
  assert.equal(byLabel['Process capability'], 'true');
  close();
});

test('aggregated (lot-stack) dies make every chart unavailable', () => {
  const src = selectionPopulation(wafer().dies.slice(0, 3), { ...facts, isLotStack: true });
  const close = openDrilldownMenu({ x: 10, y: 10 }, anchor(), src, { sweeps: [SWEEP] });
  assert.ok(rows().every(i => i.getAttribute('aria-disabled') === 'true'));
  close();
});

test('opening a second menu closes the first; Escape returns focus to the anchor', () => {
  const src = selectionPopulation(wafer().dies.slice(0, 2), facts);
  openDrilldownMenu({ x: 10, y: 10 }, anchor(), src, {});
  const a2 = anchor();
  openDrilldownMenu({ x: 20, y: 20 }, a2, src, {});
  assert.equal(menus().length, 1);
  menus()[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.equal(menus().length, 0);
  assert.equal(document.activeElement, a2);
});

test('a sweep opens with the population in the title and on the chart', () => {
  openDrilldownMenu({ x: 10, y: 10 }, anchor(), selectionPopulation(wafer().dies.slice(0, 4), facts), { sweeps: [SWEEP] });
  rows().find(r => r.textContent === 'Drive sweep').click();
  const box = document.querySelector('.wmap-overlay-box');
  assert.match(box.textContent, /Drive sweep — 4 dies selected on W07/);
  assert.match(box.textContent, /median across 4 dies selected on W07/);
  // Already in its own modal: it must not offer to expand again.
  assert.equal(box.querySelector('[data-wmap-chart-expand]').style.display, 'none');
  closeModal();
});

test('a histogram opens on the test that was on screen, with its population stated', () => {
  openDrilldownMenu({ x: 10, y: 10 }, anchor(), waferPopulation(wafer().dies, { ...facts, activeTest: 2000 }), {});
  rows().find(r => r.textContent === 'Value histogram').click();
  const box = document.querySelector('.wmap-overlay-box');
  assert.match(box.textContent, /Value histogram — 24 dies on W07/);
  assert.equal(box.querySelector('[data-wmap-population]').textContent, 'Population: 24 dies on W07');
  assert.match(box.textContent, /Other/);
  closeModal();
});

test('capability on a small population says its Ppk is a rough estimate', () => {
  openDrilldownMenu({ x: 10, y: 10 }, anchor(), selectionPopulation(wafer().dies.slice(0, 5), facts), {});
  rows().find(r => r.textContent === 'Process capability').click();
  const line = document.querySelector('.wmap-overlay-box [data-wmap-population]').textContent;
  assert.match(line, /^Population: 5 dies selected on W07 · fewer than 30 dies, so each Ppk is a rough estimate$/);
  closeModal();
});

// ── Tables ───────────────────────────────────────────────────────────────────

const waitFor = async (cond, what) => { for (let i = 0; i < 100 && !cond(); i++) await tick(); assert.ok(cond(), what); };

test('Dies opens the selected dies as a table, in a modal that names the population', async () => {
  const dies = wafer().dies.slice(0, 5);
  let saved;
  openDrilldownMenu({ x: 10, y: 10 }, anchor(), selectionPopulation(dies, facts), { onSaveText: (c, n) => { saved = { c, n }; } });
  rows().find(r => r.textContent === 'Dies').click();
  await waitFor(() => document.querySelector('.wmap-overlay-box [data-wmap-data-tab]'), 'the table opened');
  const box = document.querySelector('.wmap-overlay-box');
  assert.match(box.textContent, /Dies — 5 dies selected on W07/);
  assert.match(box.querySelector('[data-wmap-data-note]').textContent, /^5 dies selected on W07\./);
  // Only Dies and Statistics are offered for a selection: there is no lot to tabulate by wafer.
  assert.deepEqual([...box.querySelectorAll('[data-wmap-data-view]')].map(b => b.dataset.wmapDataView), ['statistics', 'dies']);
  assert.equal(box.querySelectorAll('tbody tr[aria-rowindex]').length, 5);
  // The wafer column and the file name both say it is a selection.
  assert.ok([...box.querySelectorAll('th')].some(th => th.textContent === 'Wafer'));
  box.querySelector('[data-wmap-data-export]').click();
  assert.equal(saved.n, 'die-list-selection.csv');
  assert.equal(saved.c.split('\n').length, 6, 'a header and the five selected dies, no others');
  closeModal();
});

test('Dies carries ring and quadrant when the gesture knew the wafer', async () => {
  const w = wafer();
  openDrilldownMenu({ x: 10, y: 10 }, anchor(), selectionPopulation(w.dies.slice(0, 5), { ...facts, wafer: w.wafer }), {});
  rows().find(r => r.textContent === 'Dies').click();
  await waitFor(() => document.querySelector('.wmap-overlay-box [data-wmap-data-tab]'), 'the table opened');
  const heads = [...document.querySelectorAll('.wmap-overlay-box th')].map(th => th.textContent);
  assert.ok(heads.includes('Ring') && heads.includes('Quadrant'), heads.join(' | '));
  closeModal();
});

test('Test statistics opens the Test Values table over just the selection, stamped with it', async () => {
  const dies = wafer().dies.slice(0, 6);
  let saved;
  openDrilldownMenu({ x: 10, y: 10 }, anchor(), selectionPopulation(dies, facts), { onSaveText: (c, n) => { saved = { c, n }; } });
  rows().find(r => r.textContent === 'Test statistics').click();
  await waitFor(() => document.querySelector('.wmap-overlay-box [data-wmap-data-tab]'), 'the table opened');
  const box = document.querySelector('.wmap-overlay-box');
  assert.match(box.textContent, /Test Values/);
  assert.match(box.textContent, /N=6/);
  [...box.querySelectorAll('button')].find(b => /Test values CSV$/i.test(b.textContent)).click();
  const [header, first] = saved.c.split('\n');
  assert.match(header, /Population/);
  assert.match(first, /6 dies selected on W07/);
  closeModal();
});

test('Test statistics is unavailable, with the reason, where the dies carry no test values', () => {
  const src = selectionPopulation(binsOnlyWafer().dies.slice(0, 5), { waferLabel: 'W08', testDefs: undefined });
  const close = openDrilldownMenu({ x: 10, y: 10 }, anchor(), src, {});
  const byLabel = Object.fromEntries(rows().map(i => [i.textContent, i.getAttribute('aria-disabled')]));
  assert.equal(byLabel['Dies'], null, 'the dies can always be listed');
  assert.equal(byLabel['Test statistics'], 'true');
  close();
});

function mount(options = {}) {
  const host = document.getElementById('root');
  host.innerHTML = '';
  const div = document.createElement('div');
  div.style.height = '600px';
  host.appendChild(div);
  return renderWaferMap(div, options.result ?? wafer(), options);
}

function rightClick(target) {
  const e = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 1, clientY: 1, button: 2 });
  target.dispatchEvent(e);
  return e.defaultPrevented;
}

test('a bins-only map still offers its dies as a table, and not the charts it cannot draw', async () => {
  const ctrl = mount({ result: binsOnlyWafer() });
  assert.equal(rightClick(document.querySelector('#root canvas')), true);
  await tick(); await tick();
  const byLabel = Object.fromEntries(rows().map(i => [i.textContent, i.getAttribute('aria-disabled')]));
  assert.equal(byLabel['Dies'], null, 'the dies can be listed');
  assert.equal(byLabel['Test statistics'], 'true', 'but there are no test values to summarise');
  assert.equal(byLabel['Value histogram'], 'true');
  const btn = document.querySelector('button[aria-label*="tables"]');
  assert.notEqual(btn.style.display, 'none', 'the toolbar button is there too');
  ctrl.destroy();
});

test('right-click on empty map space with nothing selected charts the whole wafer', async () => {
  const ctrl = mount();
  assert.equal(rightClick(document.querySelector('#root canvas')), true);
  await tick(); await tick();
  assert.equal(menus()[0].getAttribute('aria-label'), 'Open a chart or table of 24 dies on W07');
  ctrl.destroy();
  assert.equal(menus().length, 0, 'destroy closes an open menu');
});

test('right-click with a selection charts the selection, keeping it', async () => {
  const result = wafer();
  let selected = null;
  const ctrl = mount({ result, onSelect: d => { selected = d; } });
  ctrl.setSelection(result.dies.slice(0, 3));
  selected = null;
  assert.equal(rightClick(document.querySelector('#root canvas')), true);
  assert.equal(selected, null, 'right-click on empty space must not change the selection');
  await tick(); await tick();
  assert.equal(menus()[0].getAttribute('aria-label'), 'Open a chart or table of 3 dies selected on W07');
  ctrl.destroy();
});

test('the toolbar button charts the selection when there is one, else the wafer', () => {
  const result = wafer();
  const ctrl = mount({ result });
  const btn = document.querySelector('button[aria-label^="Charts and tables"]');
  assert.equal(btn.style.display, 'flex');
  assert.match(btn.getAttribute('aria-label'), /^Charts and tables for this wafer/);
  ctrl.setSelection(result.dies.slice(0, 2));
  assert.match(btn.getAttribute('aria-label'), /^Charts and tables for the selected dies/);
  ctrl.setSelection([]);
  assert.match(btn.getAttribute('aria-label'), /^Charts and tables for this wafer/);
  ctrl.destroy();
});

test('right-click on a gallery card outside the map charts that wafer', async () => {
  const host = document.getElementById('root');
  host.innerHTML = '';
  const w2 = buildWaferMap({
    results: Array.from({ length: 12 }, (_, k) => ({ x: k % 4, y: Math.floor(k / 4), hbin: 1, testValues: { 1000: k } })),
    testDefs: TEST_DEFS, waferConfig: { diameter: 80, metadata: { waferId: 'W09' } }, dieConfig: { width: 10, height: 10 },
  });
  const gallery = renderWaferGallery(host, [wafer(), w2]);
  const header = host.querySelectorAll('[data-wmap-expand-btn]')[1].parentElement;
  assert.equal(rightClick(header), true);
  await tick(); await tick();
  assert.equal(menus()[0].getAttribute('aria-label'), 'Open a chart or table of 12 dies on W09');
  menus()[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  gallery.destroy();
});

test("a gallery's saved plots are in the right-click menu on each card's own map, not only on the header", async () => {
  const host = document.getElementById('root');
  host.innerHTML = '';
  const plot = { id: 'p', title: 'Step 0 vs Step 1', mark: 'scatter', encoding: { x: { test: 1000 }, y: { test: 1001 }, color: { none: true } } };
  const gallery = renderWaferGallery(host, [wafer(), wafer()], { insights: { enabled: true, plots: [plot] } });
  assert.equal(rightClick(host.querySelector('canvas')), true);
  await tick(); await tick();
  assert.ok(rows().some(r => r.textContent === 'Step 0 vs Step 1'), rows().map(r => r.textContent).join(' | '));
  assert.ok(rows().some(r => r.textContent === 'New plot…'));
  menus()[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  gallery.destroy();
});

test("a chart's wafer row hands its wafer to the right-click handler; a group row does not", () => {
  const calls = [];
  const panel = renderBarPanel({
    title: 'Yield by wafer',
    data: [
      { label: 'W01', value: 80, percent: 80, itemCount: 1, key: 4 },
      { label: 'Lot A', value: 70, percent: 70, itemCount: 3 },
    ],
    onWaferContextMenu: (waferIndex, testNumber, e) => { calls.push(waferIndex); e.preventDefault(); },
  });
  document.getElementById('root').appendChild(panel.card);
  const canvas = panel.card.querySelector('canvas');
  const at = (row) => new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 50, clientY: 12 + row * 29 + 5 });
  const e0 = at(0); canvas.dispatchEvent(e0);
  const e1 = at(1); canvas.dispatchEvent(e1);
  assert.deepEqual(calls, [4]);
  assert.equal(e0.defaultPrevented, true);
  assert.equal(e1.defaultPrevented, false, 'a group row leaves the browser menu alone');
  panel.destroy();
});

test("a sweep's title states the dies it plots, not the dies it was given", () => {
  const picked = wafer().dies.slice(0, 4).map((d, i) => i === 0 ? { ...d, edgeExcluded: true } : d);
  openDrilldownMenu({ x: 10, y: 10 }, anchor(), selectionPopulation(picked, facts), { sweeps: [SWEEP] });
  rows().find(r => r.textContent === 'Drive sweep').click();
  const title = document.querySelector('.wmap-overlay-box').textContent;
  assert.match(title, /Drive sweep — 3 of 4 dies selected on W07 \(partial and edge-excluded dies left out\)/);
  closeModal();
});

test('a map known only by its host label is named by it, never by a positional stand-in', async () => {
  const unnamed = buildWaferMap({
    results: Array.from({ length: 12 }, (_, k) => ({ x: k % 4, y: Math.floor(k / 4), hbin: 1, testValues: { 1000: k } })),
    testDefs: TEST_DEFS, waferConfig: { diameter: 80 }, dieConfig: { width: 10, height: 10 },
  });
  const ctrl = mount({ result: { ...unnamed, label: 'Lot7-W12' } });
  rightClick(document.querySelector('#root canvas'));
  await tick(); await tick();
  assert.equal(menus()[0].getAttribute('aria-label'), 'Open a chart or table of 12 dies on Lot7-W12');
  ctrl.destroy();
  // No label and no wafer ID: "this wafer", not "Wafer 1 (no ID)".
  const ctrl2 = mount({ result: unnamed });
  rightClick(document.querySelector('#root canvas'));
  await tick(); await tick();
  assert.equal(menus()[0].getAttribute('aria-label'), 'Open a chart or table of 12 dies on this wafer');
  ctrl2.destroy();
});

test("the map's right-click never reaches a surrounding handler", () => {
  const ctrl = mount({ result: binsOnlyWafer() });
  let reached = false;
  document.getElementById('root').addEventListener('contextmenu', () => { reached = true; }, { once: true });
  rightClick(document.querySelector('#root canvas'));
  assert.equal(reached, false, 'a gallery card would open its whole-wafer menu on a declined right-click');
  ctrl.destroy();
});
