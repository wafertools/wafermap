// The Insights Data tab (canvas-adapter/dataTab.ts) and the virtual table under
// its Dies and Wafers views. DOM chrome and exported text, never pixels.

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
const noop = () => {};
dom.window.HTMLCanvasElement.prototype.getContext = () => new Proxy({}, { get: (_, p) => {
  if (p === 'measureText') return () => ({ width: 10 });
  if (p === 'createLinearGradient' || p === 'createRadialGradient') return () => ({ addColorStop: noop });
  if (p === 'getImageData') return () => ({ data: [] });
  if (p === 'canvas') return { width: 600, height: 300 };
  return noop;
} });

const { buildWaferMap } = await import('../dist/index.js');
const { analyzeWaferLot } = await import('../dist/packages/stats/index.js');
const { createInsightsTab } = await import('../dist/packages/canvas-adapter/insightsTab.js');
const { createVirtualTable } = await import('../dist/packages/canvas-adapter/virtualTable.js');

const DEFS = [
  { testNumber: 1050, name: 'vth', unit: 'V', limitLow: 0.4, limitHigh: 0.6 },
  { testNumber: 1060, name: 'idsat', unit: 'A' },
];

function lotItems(count, dieCount = 24) {
  const mk = (i) => buildWaferMap({
    results: Array.from({ length: dieCount }, (_, k) => ({
      x: k % 6, y: Math.floor(k / 6), hbin: k % 7 === 0 ? 2 : 1,
      // Die 3 of every wafer has no idsat result: the long layout must skip it.
      testValues: k === 3 ? { 1050: 0.5 + k / 1000 } : { 1050: 0.5 + (i * 24 + k) / 1000, 1060: 0.001 + k / 1e5 },
    })),
    waferConfig: { diameter: 80, metadata: { lot: 'LOT1', wafer: `W${i + 1}`, split: i % 2 ? 'FF' : 'TT' } },
    dieConfig: { width: 10, height: 10 },
    passBins: [1], testDefs: DEFS,
  });
  const items = Array.from({ length: count }, (_, i) => ({ ...mk(i), label: `W${i + 1}` }));
  const lot = analyzeWaferLot(items, { computePerTestStats: true });
  items.forEach((it, i) => { it.statsSummary = lot.perWafer[i].summary; });
  return { items, lot };
}

function mount(items, lot, view = 'data', extra = {}) {
  const host = dom.window.document.getElementById('host');
  host.innerHTML = '';
  const tab = createInsightsTab({
    getItems: () => items, getLotStats: () => lot,
    getBinColors: () => ({ hard: new Map(), soft: new Map(), shared: { hard: [], soft: [] }, pass: { hard: new Set(), soft: new Set() } }),
    defaultView: view, ...extra,
  });
  host.appendChild(tab.el);
  tab.render();
  return tab;
}

const click = (el) => el.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
const dataRoot = (tab) => tab.el.querySelector('[data-wmap-data-tab]');
const choose = (tab, view) => click(tab.el.querySelector(`[data-wmap-data-view="${view}"]`));
const drawnRows = (tab) => [...dataRoot(tab).querySelectorAll('tbody tr[aria-rowindex]')];

// ── Tab structure ────────────────────────────────────────────────────────────

test('Data is the last tab, after Sweeps when there are sweeps', () => {
  const { items, lot } = lotItems(2);
  const tab = mount(items, lot, 'overview');
  const labels = [...tab.el.querySelectorAll('[role="tab"]')].map(b => b.textContent);
  assert.deepEqual(labels, ['Overview', 'Distributions', 'Correlation', 'Data']);
  const withSweeps = mount(items, lot, 'overview', { sweeps: [{ id: 's', title: 'S', series: [{ label: 'A', tests: [1050] }] }] });
  assert.equal([...withSweeps.el.querySelectorAll('[role="tab"]')].at(-1).textContent, 'Data');
});

test('the Overview no longer carries the test tables, and points at the Data tab', () => {
  const { items, lot } = lotItems(2);
  const tab = mount(items, lot, 'overview');
  assert.ok(![...tab.el.querySelectorAll('button')].some(b => /CSV$/.test(b.textContent)), 'no CSV buttons on the Overview');
  const link = tab.el.querySelector('[data-wmap-open-data-tab]');
  assert.ok(link, 'a link to the Data tab');
  click(link);
  assert.ok(dataRoot(tab), 'the Data tab opened');
});

test('Statistics is the default view, and keeps the test-values table and its export', () => {
  const { items, lot } = lotItems(3);
  const tab = mount(items, lot);
  assert.equal(tab.el.querySelector('[data-wmap-data-view="statistics"]').getAttribute('aria-checked'), 'true');
  assert.ok([...dataRoot(tab).querySelectorAll('button')].some(b => b.textContent === 'Test values CSV'));
  assert.match(dataRoot(tab).textContent, /vth/);
});

test('with Group by, Statistics shows one block per group', () => {
  const { items, lot } = lotItems(4);
  const tab = mount(items, lot);
  const trigger = [...tab.el.querySelectorAll('button')].find(b => (b.getAttribute('aria-label') ?? '').toLowerCase() === 'group by');
  click(trigger);
  const option = [...dom.window.document.querySelectorAll('[role="option"]')].find(o => o.textContent.trim().startsWith('Split'));
  assert.ok(option, 'the split field is offered');
  click(option);
  const headings = [...dataRoot(tab).children[1].querySelectorAll(':scope > div > div')]
    .map(d => d.textContent).filter(t => /: (TT|FF)$/.test(t));
  assert.equal(headings.length, 2, headings.join(' | '));
});

// ── Dies ─────────────────────────────────────────────────────────────────────

test('Dies: only the rows in view are drawn, and every die is counted', () => {
  const { items, lot } = lotItems(2, 600);
  const tab = mount(items, lot);
  choose(tab, 'dies');
  const total = items.reduce((n, it) => n + it.dies.length, 0);
  assert.ok(drawnRows(tab).length > 0 && drawnRows(tab).length < 100, `drawn ${drawnRows(tab).length}`);
  assert.equal(dataRoot(tab).querySelector('table').getAttribute('aria-rowcount'), String(total + 1));
  assert.match(dataRoot(tab).querySelector('[data-wmap-data-note]').textContent, new RegExp(`${total.toLocaleString()} dies on 2 wafers`));
});

test('Dies: wide export is the table in the order shown, a column per test, plain numbers', async () => {
  const { items, lot } = lotItems(2, 24);
  let saved;
  const tab = mount(items, lot, 'data', { onSaveText: (c, n, m) => { saved = { c, n, m }; } });
  choose(tab, 'dies');
  // Sort by Vth, descending (two clicks).
  const th = [...dataRoot(tab).querySelectorAll('th')].find(t => t.textContent.startsWith('vth'));
  click(th); click(th);
  click(dataRoot(tab).querySelector('[data-wmap-data-export]'));
  assert.equal(saved.n, 'die-list.csv');
  assert.equal(typeof saved.c, 'string');
  const lines = saved.c.split('\n');
  const header = lines[0].split(',');
  assert.ok(header.includes('vth (V)') && header.includes('idsat (A)'), lines[0]);
  const vth = lines.slice(1).map(l => Number(l.split(',')[header.indexOf('vth (V)')]));
  assert.equal(vth.length, 48);
  assert.deepEqual(vth, [...vth].sort((a, b) => b - a), 'rows follow the sort on screen');
  assert.ok(vth.every(Number.isFinite), 'values are plain numbers, not "534 mV"');
});

test('Dies: switching to Long keeps the sort, writes a row per die per test, and skips a missing result', async () => {
  const { items, lot } = lotItems(2, 24);
  let saved;
  const tab = mount(items, lot, 'data', { onSaveText: (c, n) => { saved = { c, n }; } });
  choose(tab, 'dies');
  const th = [...dataRoot(tab).querySelectorAll('th')].find(t => t.textContent.startsWith('vth'));
  click(th); click(th);
  click(tab.el.querySelector('[data-wmap-data-layout="long"]'));
  assert.equal(drawnRows(tab).length > 0, true, 'the table is still there');
  assert.equal(th.getAttribute('aria-sort'), 'descending', 'and still sorted');
  click(dataRoot(tab).querySelector('[data-wmap-data-export]'));
  assert.equal(saved.n, 'die-list-long.csv');
  const text = typeof saved.c === 'string' ? saved.c : await saved.c.text();
  const lines = text.split('\n');
  const header = lines[0].split(',');
  for (const h of ['Test', 'Test number', 'Unit', 'Value']) assert.ok(header.includes(h), h);
  const rows = lines.slice(1);
  // 48 dies × 2 tests, less the 2 dies (one per wafer) with no idsat result.
  assert.equal(rows.length, 48 * 2 - 2);
  assert.ok(rows.every(r => r.split(',')[header.indexOf('Value')] !== ''));
  assert.match(dataRoot(tab).querySelector('[data-wmap-data-note]').textContent, /Long format/);
});

test('Dies: Copy is offered for a small table and puts tab-separated text on the clipboard', async () => {
  const { items, lot } = lotItems(2, 24);
  let copied;
  Object.defineProperty(dom.window.navigator, 'clipboard', { value: { writeText: async (t) => { copied = t; } }, configurable: true });
  const tab = mount(items, lot);
  choose(tab, 'dies');
  const btn = dataRoot(tab).querySelector('[data-wmap-data-copy]');
  assert.equal(btn.disabled, false);
  click(btn);
  await new Promise(r => setTimeout(r, 10));
  assert.ok(copied.split('\n')[0].includes('\t'));
  assert.equal(copied.split('\n').length, 49);
});

test('Dies: Copy is refused, with the reason, for a table too big to paste', () => {
  const { items, lot } = lotItems(1, 24);
  items[0] = { ...items[0], dies: Array.from({ length: 20000 }, (_, i) => ({ x: i % 200, y: Math.floor(i / 200), hbin: 1, testValues: { 1050: 0.5, 1060: 0.001 } })) };
  const tab = mount(items, lot);
  choose(tab, 'dies');
  assert.equal(dataRoot(tab).querySelector('[data-wmap-data-copy]').disabled, true);
});

// ── Wafers ───────────────────────────────────────────────────────────────────

test('Wafers: a row per wafer with the lot yield figure, metadata and per-test means', () => {
  const { items, lot } = lotItems(3);
  let saved;
  const tab = mount(items, lot, 'data', { onSaveText: (c, n) => { saved = { c, n }; } });
  choose(tab, 'wafers');
  assert.equal(drawnRows(tab).length, 3);
  const heads = [...dataRoot(tab).querySelectorAll('th')].map(t => t.textContent);
  for (const h of ['Wafer', 'Lot', 'Split', 'Dies', 'Yield %', 'vth (V) mean']) assert.ok(heads.includes(h), `${h} in ${heads}`);
  click(dataRoot(tab).querySelector('[data-wmap-data-export]'));
  assert.equal(saved.n, 'wafers.csv');
  const lines = saved.c.split('\n');
  const header = lines[0].split(',');
  assert.equal(lines.length, 4);
  const yieldCol = header.indexOf('Yield %');
  lines.slice(1).forEach((l, i) => {
    // Written to 15 significant digits, so equal to the lot's figure to far beyond display.
    assert.ok(Math.abs(Number(l.split(',')[yieldCol]) - lot.lotYieldSeries[i].yieldPercent) < 1e-9, 'the same yield every other panel reports');
  });
  assert.deepEqual(lines.slice(1).map(l => l.split(',')[header.indexOf('Split')]), ['TT', 'FF', 'TT']);
});

// ── The virtual table ────────────────────────────────────────────────────────

function table(n, extra = {}) {
  const rows = Array.from({ length: n }, (_, i) => ({ id: i, v: (i * 7919) % 1000, s: `r${i}` }));
  const t = createVirtualTable({
    columns: [
      { header: 'id', get: r => String(r.id), numeric: true, sortKey: r => r.id },
      { header: 'v', get: r => `${r.v} units`, numeric: true, sortKey: r => r.v },
      { header: 's', get: r => r.s },
    ],
    rows, ariaLabel: 'test', ownerDocument: dom.window.document, ...extra,
  });
  dom.window.document.getElementById('host').replaceChildren(t.el);
  return { t, rows };
}

test('virtual table: a window of rows plus spacers, never all of them', () => {
  const { t } = table(10000);
  const { first, last } = t.drawnRange();
  assert.equal(first, 0);
  assert.ok(last < 100);
  const trs = t.el.querySelectorAll('tbody tr');
  assert.equal(trs.length, last - first + 1 + 2, 'rows plus the two spacers');
  assert.equal(t.el.querySelector('table').getAttribute('aria-rowcount'), '10001');
});

test('virtual table: scrolling moves the window and the spacers keep the height', () => {
  const { t } = table(10000);
  t.el.scrollTop = 5000 * 24;
  t.el.dispatchEvent(new dom.window.Event('scroll'));
  return new Promise(resolve => dom.window.requestAnimationFrame(() => {
    const { first, last } = t.drawnRange();
    assert.ok(first > 4900 && last < 5200, `${first}..${last}`);
    const spacers = [...t.el.querySelectorAll('tbody tr[aria-hidden]')].map(tr => parseInt(tr.firstElementChild.style.height, 10));
    assert.equal(spacers[0] + (last - first + 1) * 24 + spacers[1], 10000 * 24);
    resolve();
  }));
});

test('virtual table: sorting orders by key, numbers by value, and orderedRows follows it', () => {
  const { t, rows } = table(200);
  const th = t.el.querySelectorAll('th')[1];
  click(th);
  const asc = [...t.orderedRows()].map(r => r.v);
  assert.deepEqual(asc, rows.map(r => r.v).sort((a, b) => a - b));
  click(th);
  assert.deepEqual([...t.orderedRows()].map(r => r.v), asc.slice().reverse());
  assert.equal(th.getAttribute('aria-sort'), 'descending');
  assert.equal([...t.el.querySelectorAll('th')].filter(h => h.getAttribute('aria-sort') !== 'none').length, 1);
});

test('virtual table: setRows keeps the sort', () => {
  const { t } = table(50);
  click(t.el.querySelectorAll('th')[0]);
  click(t.el.querySelectorAll('th')[0]);                       // id descending
  t.setRows(Array.from({ length: 5 }, (_, i) => ({ id: i, v: 0, s: '' })));
  assert.deepEqual([...t.orderedRows()].map(r => r.id), [4, 3, 2, 1, 0]);
});

test('virtual table: rows with no value sort last in either direction', () => {
  const rows = [{ k: 3 }, { k: undefined }, { k: 1 }, { k: 2 }];
  const t = createVirtualTable({
    columns: [{ header: 'k', get: r => String(r.k ?? ''), sortKey: r => r.k }],
    rows, ariaLabel: 't', ownerDocument: dom.window.document,
  });
  const th = t.el.querySelector('th');
  click(th);
  assert.deepEqual([...t.orderedRows()].map(r => r.k), [1, 2, 3, undefined]);
  click(th);
  assert.deepEqual([...t.orderedRows()].map(r => r.k), [3, 2, 1, undefined]);
});

test('virtual table: a header is operable from the keyboard', () => {
  const { t } = table(20);
  const th = t.el.querySelectorAll('th')[1];
  assert.equal(th.tabIndex, 0);
  th.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  assert.equal(th.getAttribute('aria-sort'), 'ascending');
});
