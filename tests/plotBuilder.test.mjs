// The plot builder's UI: the store the host is told about, the editor, the Plot tab (new, duplicate, delete and
// undo, import and export, a plot the lot cannot draw), and saved plots as drilldown targets. The data and the
// file format have their own tests (plotData, plotSpec); this is the DOM.

import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { pretendToBeVisual: true, url: 'http://localhost/' });
for (const k of ['window', 'document', 'HTMLElement', 'HTMLCanvasElement', 'HTMLDivElement', 'HTMLButtonElement', 'HTMLInputElement', 'Node', 'Event', 'MouseEvent', 'KeyboardEvent', 'CustomEvent', 'Element', 'SVGElement', 'DOMRect']) {
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
const { createPlotStore, copyTitle } = await import('../dist/packages/canvas-adapter/plotStore.js');
const { createPlotEditor } = await import('../dist/packages/canvas-adapter/plotEditor.js');
const { createSweepEditor } = await import('../dist/packages/canvas-adapter/sweepEditor.js');
const { fieldCatalogue } = await import('../dist/packages/stats/plotData.js');
const { readPlotsFile, writePlotsFile } = await import('../dist/packages/stats/plotSpec.js');
const { openDrilldownMenu } = await import('../dist/packages/canvas-adapter/drilldown.js');
const { selectionPopulation } = await import('./fixtures/populationStated.mjs');

const DEFS = [
  { testNumber: 1050, name: 'Vth', unit: 'V' },
  { testNumber: 1060, name: 'Idsat', unit: 'A' },
];
const tick = (ms = 0) => new Promise(r => setTimeout(r, ms));
const click = (el) => el.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
async function until(fn, what, ms = 2000) {
  const end = Date.now() + ms;
  for (;;) {
    const v = fn();
    if (v) return v;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await tick(5);
  }
}

function lotItems(count = 3, dieCount = 24) {
  const items = Array.from({ length: count }, (_, i) => ({
    ...buildWaferMap({
      results: Array.from({ length: dieCount }, (_, k) => ({
        x: k % 6, y: Math.floor(k / 6), hbin: k % 7 === 0 ? 2 : 1,
        testValues: { 1050: 0.4 + i / 10 + k / 1000, 1060: 0.001 + k / 1e5 },
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

const SCATTER = { id: 'p1', title: 'Vth vs Idsat', chart: 'scatter', fields: { x: { test: 1050, name: 'Vth' }, y: { test: 1060, name: 'Idsat' }, color: { none: true } } };
const HIST = { id: 'p2', chart: 'histogram', fields: { y: { test: 1050 }, color: { none: true } } };
const MISSING = { id: 'p3', title: 'Leak', chart: 'scatter', fields: { x: { test: 3001, name: 'Leak' }, y: { test: 1060 } } };

function mountPlot(extra = {}) {
  const { items, lot } = lotItems();
  const host = document.getElementById('root');
  host.innerHTML = '';
  const changes = [];
  const store = createPlotStore(extra.plots ?? [], p => changes.push(p), 1);
  const tab = createInsightsTab({ getRingCount: () => 4,
    getItems: () => items, getLotStats: () => lot,
    getBinColors: () => ({ hard: new Map(), soft: new Map(), shared: { hard: [], soft: [] }, pass: { hard: new Set(), soft: new Set() } }),
    defaultView: 'plot', plotStore: store, ...extra.deps,
  });
  host.appendChild(tab.el);
  tab.render();
  return { tab, store, changes, items };
}
const section = (tab) => until(() => tab.el.querySelector('[data-wmap-plot-tab]'), 'the Plot tab');
const cards = (tab) => [...tab.el.querySelectorAll('[data-wmap-plot-id]')];
const button = (root, hook) => root.querySelector(`[data-${hook}]`);

// ── the store ────────────────────────────────────────────────────────────────

test('the store keeps order, copies, and tells the host once per burst', async () => {
  const sent = [];
  const store = createPlotStore([SCATTER], p => sent.push(p.map(x => x.id)), 5);
  assert.deepEqual(sent, []);
  store.upsert({ ...HIST });
  store.upsert({ ...HIST, title: 'H' });
  store.upsert({ ...HIST, title: 'Hi' });
  assert.deepEqual(store.get().map(p => p.id), ['p1', 'p2']);
  await tick(15);
  assert.equal(sent.length, 1, 'one call for the burst');
  const copy = store.duplicate('p1');
  assert.deepEqual(store.get().map(p => p.id), ['p1', copy.id, 'p2']);
  assert.equal(copy.title, 'Vth vs Idsat (copy)');
  const gone = store.remove('p1');
  assert.deepEqual(gone, { plot: SCATTER, index: 0 });
  store.insertAt(gone.index, gone.plot);
  assert.deepEqual(store.get().map(p => p.id), ['p1', copy.id, 'p2']);
  store.flush();
  assert.equal(sent.length, 2, 'flush sends a change that is waiting');
  store.flush();
  assert.equal(sent.length, 2, 'and only once');
});

test('copying a copy does not pile up marks; a second copy is numbered', () => {
  assert.equal(copyTitle('Vth', []), 'Vth (copy)');
  assert.equal(copyTitle('Vth (copy)', ['Vth', 'Vth (copy)']), 'Vth (copy 2)');
  assert.equal(copyTitle('Vth (copy 2)', ['Vth', 'Vth (copy)', 'Vth (copy 2)']), 'Vth (copy 3)');
  assert.equal(copyTitle('Vth (copy) (copy) (copy)', ['Vth']), 'Vth (copy)', 'marks already piled up are tidied');
  assert.equal(copyTitle('(copy)', []), '(copy) (copy)', 'a title that is only the mark is left alone');
  const store = createPlotStore([SCATTER], undefined, 0);
  const a = store.duplicate('p1');
  const b = store.duplicate(a.id);
  const c = store.duplicate(b.id);
  const d = store.duplicate('p1');
  assert.deepEqual([a, b, c, d].map(p => p.title), ['Vth vs Idsat (copy)', 'Vth vs Idsat (copy 2)', 'Vth vs Idsat (copy 3)', 'Vth vs Idsat (copy 4)']);
});

test('the store does not share objects with the list it was given or the host it tells', () => {
  const initial = [{ ...SCATTER }];
  let told;
  const store = createPlotStore(initial, p => { told = p; }, 0);
  store.get()[0].title = 'changed';
  assert.equal(initial[0].title, 'Vth vs Idsat');
  store.upsert({ ...SCATTER, title: 'x' });
  store.flush();
  told[0].title = 'mutated by the host';
  assert.equal(store.get()[0].title, 'x');
});

test('subscribers hear every change and can stop listening', () => {
  const store = createPlotStore([]);
  let n = 0;
  const off = store.subscribe(() => { n++; });
  store.upsert(SCATTER); store.remove('p1');
  assert.equal(n, 2);
  off();
  store.upsert(SCATTER);
  assert.equal(n, 2);
});

// ── the editor ───────────────────────────────────────────────────────────────

function editor(plot) {
  const { items } = lotItems();
  const plotItems = items.map((it, i) => ({ label: it.label, dies: it.dies, waferIndex: i, wafer: it.wafer, metadata: it.wafer.metadata }));
  const catalogue = fieldCatalogue(plotItems, { testDefs: DEFS });
  const emitted = [];
  const e = createPlotEditor({
    doc: document, plot, catalogue, followLabel: () => 'Split',
    autoText: () => ({ title: 'Idsat vs Vth', x: 'Vth', y: 'Idsat' }),
    onChange: next => emitted.push(next),
  });
  document.getElementById('root').replaceChildren(e.el);
  return { e, emitted };
}
const pick = (root, hook, label) => {
  click(root.querySelector(`[data-wmap-select="${hook}"]`));
  const row = [...document.querySelectorAll('[role="option"]')].find(r => r.textContent === label);
  assert.ok(row, `an option "${label}" in the ${hook} list: ${[...document.querySelectorAll('[role="option"]')].map(r => r.textContent).join(' | ')}`);
  click(row);
};
const tabButton = (root, text) => [...root.querySelectorAll('[role="tab"]')].find(b => b.textContent === text);

const chooseMark = (e, mark) => {
  const r = [...e.el.querySelectorAll('input[type="radio"]')].find(x => x.value === mark && x.name.startsWith('seg-') && x.closest('[role="radiogroup"]').textContent.includes('Scatter'));
  r.checked = true;
  r.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
};

test('every chart type is offered, and a histogram keeps the fields it does not use', () => {
  const { e, emitted } = editor(SCATTER);
  const marks = [...e.el.querySelectorAll('[role="radiogroup"]')][0];
  assert.deepEqual([...marks.querySelectorAll('input')].map(r => r.value), ['scatter', 'histogram', 'box', 'bar', 'line']);
  chooseMark(e, 'histogram');
  const last = emitted.at(-1);
  assert.equal(last.chart, 'histogram');
  assert.deepEqual(last.fields.x, SCATTER.fields.x, 'the X field is kept for when the type changes back');
  assert.ok(e.el.querySelector('[data-wmap-select="plot-y"]'), 'Values');
  assert.ok(!e.el.querySelector('[data-wmap-select="plot-x"]'), 'a histogram has no X field');
});

test('switching to a bar swaps a continuous X for wafer, and switching back restores it', () => {
  const { e, emitted } = editor(SCATTER);
  chooseMark(e, 'bar');
  assert.equal(emitted.at(-1).chart, 'bar');
  assert.deepEqual(emitted.at(-1).fields.x, { builtin: 'wafer' }, 'a bar groups by a category');
  assert.deepEqual(emitted.at(-1).fields.y, SCATTER.fields.y, 'the value field is still usable and stays');
  chooseMark(e, 'scatter');
  assert.deepEqual(emitted.at(-1).fields.x, SCATTER.fields.x, 'Vth comes back, not a default');
});

test('a bar can count what it stands for; box and line have the fields their type needs', () => {
  const { e, emitted } = editor({ ...SCATTER, chart: 'bar', fields: { x: { builtin: 'wafer' }, color: { none: true } } });
  assert.match(e.el.querySelector('[data-wmap-select="plot-y"]').textContent, /Count of dies/);
  chooseMark(e, 'box');
  assert.ok(emitted.at(-1).fields.y, 'a box needs values, so one is chosen');
  chooseMark(e, 'line');
  const x = emitted.at(-1).fields.x;
  assert.ok(x && !('builtin' in x && x.builtin === 'wafer'), 'a line needs a continuous X, not a category');
});

test('combine values by appears for bar and line, with pooled yield only for the yield field', () => {
  const { e, emitted } = editor({ ...SCATTER, chart: 'bar', fields: { x: { meta: 'split' }, y: { builtin: 'yield' }, color: { none: true } } });
  assert.ok(e.el.querySelector('[data-wmap-select="plot-aggregate"]'));
  click(e.el.querySelector('[data-wmap-select="plot-aggregate"]'));
  const labels = [...document.querySelectorAll('[role="option"]')].map(r => r.textContent);
  assert.ok(labels.includes('Pooled yield (passing over judged dies)') && labels.includes('Median'));
  click([...document.querySelectorAll('[role="option"]')].find(r => r.textContent === 'Median'));
  assert.equal(emitted.at(-1).aggregate, 'median');
  pick(e.el, 'plot-aggregate', 'Automatic');
  assert.equal('aggregate' in emitted.at(-1), false);
  const scatter = editor(SCATTER);
  assert.ok(!scatter.e.el.querySelector('[data-wmap-select="plot-aggregate"]'), 'not shown where it cannot matter');
});

test('"One mark per" sets the level, and wafer level shows how values are combined', () => {
  const { e, emitted } = editor(SCATTER);
  const level = [...e.el.querySelectorAll('[role="radiogroup"]')].find(g => g.textContent.includes('Automatic'));
  const wafer = [...level.querySelectorAll('input')].find(r => r.value === 'wafer');
  wafer.checked = true;
  wafer.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  assert.equal(emitted.at(-1).level, 'wafer');
  assert.ok(e.el.querySelector('[data-wmap-select="plot-aggregate"]'));
});

test('a category axis has a title but no limits or scale', () => {
  const { e } = editor({ ...SCATTER, chart: 'box', fields: { x: { builtin: 'wafer' }, y: SCATTER.fields.y, color: { none: true } } });
  click(tabButton(e.el, 'Customise'));
  assert.ok(e.el.querySelector('input[aria-label="Categories axis title"]'));
  assert.ok(!e.el.querySelector('input[aria-label="Categories axis minimum"]'));
  assert.ok(e.el.querySelector('input[aria-label="Values axis minimum"]'));
});

test('a field list is grouped, filterable by number, and offers only numeric fields for a value role', () => {
  const { e } = editor(SCATTER);
  click(e.el.querySelector('[data-wmap-select="plot-x"]'));
  const text = [...document.querySelectorAll('[role="option"]')].map(r => r.textContent);
  assert.ok(text.includes('Vth · 1050') && text.includes('Idsat · 1060'));
  assert.ok(text.includes('Yield') && text.includes('Die X'));
  assert.ok(!text.includes('Wafer'), 'a category is not an X value');
  assert.ok(!text.includes('Split'), 'a text lot field is not an X value');
  const heads = [...document.querySelectorAll('[role="presentation"]')].map(h => h.textContent);
  assert.ok(heads.includes('Tests') && heads.includes('Die') && heads.includes('Wafer'));
  document.body.click();
});

test('picking a field edits only that role', () => {
  const { e, emitted } = editor(SCATTER);
  pick(e.el, 'plot-y', 'Vth · 1050');
  assert.deepEqual(emitted.at(-1).fields.y, { test: 1050, name: 'Vth' });
  assert.deepEqual(emitted.at(-1).fields.x, SCATTER.fields.x);
});

test('colour: follow Group by, none, or a category', () => {
  const { e, emitted } = editor(SCATTER);
  pick(e.el, 'plot-color', 'Follow Group by (Split)');
  assert.equal(emitted.at(-1).fields.color, undefined);
  pick(e.el, 'plot-color', 'Split');
  assert.deepEqual(emitted.at(-1).fields.color, { meta: 'split' });
  pick(e.el, 'plot-color', 'None');
  assert.deepEqual(emitted.at(-1).fields.color, { none: true });
});

test('titles are automatic until typed in, and clearing brings the automatic one back', () => {
  const { e, emitted } = editor({ ...SCATTER, title: undefined });
  click(tabButton(e.el, 'Customise'));
  const title = e.el.querySelector('[data-wmap-plot-title]');
  assert.equal(title.placeholder, 'Idsat vs Vth');
  title.value = 'My plot';
  title.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  assert.equal(emitted.at(-1).title, 'My plot');
  title.value = '  ';
  title.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  assert.equal('title' in emitted.at(-1), false);
});

test('axis settings are written only when set, and removed when cleared', () => {
  const { e, emitted } = editor(SCATTER);
  click(tabButton(e.el, 'Customise'));
  const box = (label) => e.el.querySelector(`input[aria-label="${label}"]`);
  const set = (el, v) => { el.value = v; el.dispatchEvent(new dom.window.Event('change', { bubbles: true })); };
  set(box('X axis minimum'), '0.3');
  assert.deepEqual(emitted.at(-1).axes, { x: { min: 0.3 } });
  set(box('X axis maximum'), 'high');
  assert.deepEqual(emitted.at(-1).axes, { x: { min: 0.3 }}, 'text is not a number and is ignored');
  click([...e.el.querySelectorAll('input[type="radio"]')].find(r => r.value === 'log'));
  e.el.querySelectorAll('input[type="radio"]').forEach(r => { if (r.value === 'log') { r.checked = true; r.dispatchEvent(new dom.window.Event('change', { bubbles: true })); } });
  assert.equal(emitted.at(-1).axes.x.scale, 'log');
  set(box('X axis minimum'), '');
  const x = emitted.at(-1).axes.x;
  assert.equal(x.min, undefined);
  assert.equal(x.scale, 'log');
});

test('a saved field the lot lacks stays selectable, marked, so the plot can still be read', () => {
  const { e } = editor(MISSING);
  assert.match(e.el.querySelector('[data-wmap-select="plot-x"]').textContent, /Leak \(not in this lot\)/);
});

// ── the Plot tab ─────────────────────────────────────────────────────────────

test('with no plots the tab says what a plot is, and offers New plot', async () => {
  const { tab } = mountPlot();
  const s = await section(tab);
  assert.match(s.textContent, /No plots yet/);
  assert.ok(button(s, 'wmap-plot-new'));
  assert.equal(cards(tab).length, 0);
});

test('saved plots are drawn as cards in their saved order, with the population stated', async () => {
  const { tab } = mountPlot({ plots: [HIST, SCATTER] });
  await section(tab);
  assert.deepEqual(cards(tab).map(c => c.dataset.wmapPlotId), ['p2', 'p1']);
  assert.match(tab.el.textContent, /3 wafers · 72 dies/);
  assert.equal(cards(tab)[1].dataset.wmapChartTitle, 'Vth vs Idsat');
  assert.equal(cards(tab)[0].dataset.wmapChartTitle, 'Vth', 'a plot without a title shows the automatic one');
});

test('New plot adds a first plot from the lot and opens its editor; the host is told', async () => {
  const { tab, store, changes } = mountPlot();
  const s = await section(tab);
  click(button(s, 'wmap-plot-new'));
  assert.equal(store.get().length, 1);
  const p = store.get()[0];
  assert.equal(p.chart, 'scatter');
  assert.deepEqual([p.fields.x.test, p.fields.y.test], [1050, 1060]);
  assert.ok(document.querySelector('[data-wmap-plot-window]'), 'the editor window opened');
  assert.match(document.querySelector('[data-wmap-plot-window]').textContent, /Changes are saved to/);
  await tick(10);
  assert.equal(changes.length, 1);
  assert.equal(cards(tab).length, 1);
  document.querySelector('.wmap-overlay-box button[aria-label^="Close"]')?.click();
});

test('editing in the window edits the saved plot and the card follows', async () => {
  const { tab, store } = mountPlot({ plots: [SCATTER] });
  const s = await section(tab);
  click(button(s, 'wmap-plot-edit'));
  const win = document.querySelector('[data-wmap-plot-window]');
  assert.ok(win);
  pick(win, 'plot-y', 'Vth · 1050');
  assert.deepEqual(store.get()[0].fields.y, { test: 1050, name: 'Vth' });
  assert.equal(cards(tab)[0].dataset.wmapChartTitle, 'Vth vs Idsat', 'a typed title stays');
  document.querySelector('.wmap-overlay-box button[aria-label^="Close"]')?.click();
});

test('Duplicate places a copy after the plot', async () => {
  const { tab, store } = mountPlot({ plots: [SCATTER, HIST] });
  const s = await section(tab);
  click(button(cards(tab)[0], 'wmap-plot-duplicate'));
  assert.equal(store.get().length, 3);
  assert.equal(store.get()[1].title, 'Vth vs Idsat (copy)');
  assert.deepEqual(cards(tab).map(c => c.dataset.wmapPlotId), [store.get()[0].id, store.get()[1].id, 'p2']);
  click(button(cards(tab)[2], 'wmap-plot-duplicate'));
  assert.equal('title' in store.get()[3], false, 'an untitled plot stays untitled, so its title keeps following its fields');
  void s;
});

test('an automatic title follows the fields: in the card, in the editor window, and in a copy', async () => {
  const { tab, store } = mountPlot({ plots: [{ id: 'u', chart: 'scatter', fields: { x: { test: 1050, name: 'Vth' }, y: { test: 1060, name: 'Idsat' }, color: { none: true } } }] });
  const s = await section(tab);
  assert.equal(cards(tab)[0].dataset.wmapChartTitle, 'Idsat vs Vth');
  click(button(cards(tab)[0], 'wmap-plot-duplicate'));
  click(button(cards(tab)[0], 'wmap-plot-edit'));
  const win = document.querySelector('[data-wmap-plot-window]');
  pick(win, 'plot-y', 'Vth · 1050');
  pick(win, 'plot-x', 'Idsat · 1060');
  const heading = (root) => root.querySelector('[data-wmap-chart-title]').dataset.wmapChartTitle;
  assert.equal(heading(win), 'Vth vs Idsat', 'the window\'s chart');
  assert.equal(cards(tab)[0].dataset.wmapChartTitle, 'Vth vs Idsat', 'the card behind it');
  assert.equal(cards(tab)[1].dataset.wmapChartTitle, 'Idsat vs Vth', 'the untouched copy keeps its own fields\' name');
  assert.equal('title' in store.get()[0], false);
  document.querySelector('.wmap-overlay-box button[aria-label^="Close"]')?.click();
  void s;
});

test('a title the reader typed stays as typed when the fields change', async () => {
  const { tab, store } = mountPlot({ plots: [SCATTER] });
  await section(tab);
  click(button(cards(tab)[0], 'wmap-plot-edit'));
  const win = document.querySelector('[data-wmap-plot-window]');
  pick(win, 'plot-y', 'Vth · 1050');
  assert.equal(store.get()[0].title, 'Vth vs Idsat');
  assert.equal(cards(tab)[0].dataset.wmapChartTitle, 'Vth vs Idsat');
  document.querySelector('.wmap-overlay-box button[aria-label^="Close"]')?.click();
});

test('Delete removes a plot at once and Undo puts it back where it was', async () => {
  const { tab, store } = mountPlot({ plots: [SCATTER, HIST] });
  const s = await section(tab);
  click(button(cards(tab)[0], 'wmap-plot-delete'));
  assert.deepEqual(store.get().map(p => p.id), ['p2']);
  assert.equal(cards(tab).length, 1);
  assert.match(s.textContent, /Deleted “Vth vs Idsat”/);
  click(button(s, 'wmap-plot-notice-action'));
  assert.deepEqual(store.get().map(p => p.id), ['p1', 'p2']);
  assert.deepEqual(cards(tab).map(c => c.dataset.wmapPlotId), ['p1', 'p2']);
});

// ── Delete all plots ─────────────────────────────────────────────────────────

const confirmBox = () => document.querySelector('[data-wmap-confirm]');
const closeConfirm = () => document.querySelectorAll('.wmap-overlay-box button[aria-label^="Close"]').forEach(b => b.click());

test('Delete all plots is offered, and is disabled while there is nothing to delete', async () => {
  const { tab, store } = mountPlot({ plots: [] });
  const s = await section(tab);
  const btn = button(s, 'wmap-plot-delete-all');
  assert.ok(btn, 'the button is on the toolbar');
  assert.equal(btn.textContent, 'Delete all plots…', 'the ellipsis says a question follows');
  assert.equal(btn.disabled, true, 'nothing to delete');
  store.upsert(SCATTER);
  assert.equal(btn.disabled, false, 'enabled as soon as there is a plot');
  store.remove('p1');
  assert.equal(btn.disabled, true);
});

test('Delete all plots asks first, says how many, and Cancel, Escape and the close button keep every plot', async () => {
  const { tab, store, changes } = mountPlot({ plots: [SCATTER, HIST, MISSING] });
  const s = await section(tab);
  for (const answer of ['cancel', 'escape', 'close']) {
    click(button(s, 'wmap-plot-delete-all'));
    await until(confirmBox, 'the confirmation opened');
    await tick(60);   // the overlay moves focus a frame after opening: Cancel must still be where it lands
    const box = confirmBox();
    assert.equal(box.getAttribute('role'), 'dialog');
    assert.equal(box.getAttribute('aria-modal'), 'true');
    assert.match(box.textContent, /Delete all 3 saved plots, sweeps included\? They are kept .* so they will not be there for the next file either\./, 'it says how many, with "they" throughout');
    assert.ok(!/\bit\b/i.test(box.querySelector('p').textContent.replace(/Export plots…[^.]*/, '')), 'no singular pronoun for several plots');
    assert.match(box.textContent, /Export plots… first to keep a copy/, 'and how to keep them');
    assert.equal(box.querySelector('[data-wmap-confirm-cancel]'), document.activeElement, 'focus starts on Cancel, not on the destructive button');
    assert.match(box.querySelector('[data-wmap-confirm-ok]').textContent, /^Delete 3 plots$/, 'the button names the action');
    assert.equal(store.get().length, 3, 'still there while the question is open');
    if (answer === 'cancel') click(box.querySelector('[data-wmap-confirm-cancel]'));
    else if (answer === 'escape') document.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    else closeConfirm();
    await until(() => !confirmBox(), `${answer} closed it`);
    assert.deepEqual(store.get().map(p => p.id), ['p1', 'p2', 'p3'], `${answer} deletes nothing`);
  }
  await tick(10);
  assert.equal(changes.length, 0, 'and the host is told nothing');
  assert.equal(cards(tab).length, 3);
});

test('the dialog has no Maximize button, and F does not maximize it', async () => {
  const { tab } = mountPlot({ plots: [SCATTER] });
  const s = await section(tab);
  click(button(s, 'wmap-plot-delete-all'));
  await until(confirmBox, 'opened');
  assert.match(confirmBox().textContent, /Delete your 1 saved plot\? It is kept .* so it will not be there for the next file either\./, 'one plot is said as one, with "it" throughout');
  assert.match(confirmBox().querySelector('[data-wmap-confirm-ok]').textContent, /^Delete 1 plot$/);
  assert.equal(confirmBox().querySelector('button[aria-label^="Maximize"]'), null);
  document.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'f', bubbles: true }));
  assert.ok(!/maximized/i.test(confirmBox().className), 'F leaves it alone');
  closeConfirm();
});

test('confirming deletes every plot at once, tells the host, and Undo puts the whole list back in order', async () => {
  const { tab, store, changes } = mountPlot({ plots: [SCATTER, HIST, MISSING] });
  const s = await section(tab);
  click(button(s, 'wmap-plot-delete-all'));
  await until(confirmBox, 'the confirmation opened');
  click(confirmBox().querySelector('[data-wmap-confirm-ok]'));
  await until(() => store.get().length === 0, 'every plot deleted');
  assert.equal(cards(tab).length, 0, 'the cards are gone');
  assert.match(s.textContent, /Deleted all 3 plots/);
  assert.match(s.textContent, /No plots yet/, 'the empty state is back');
  await tick(10);
  assert.deepEqual(changes.at(-1), [], 'the host is told the list is empty');
  click(button(s, 'wmap-plot-notice-action'));
  assert.deepEqual(store.get().map(p => p.id), ['p1', 'p2', 'p3'], 'Undo restores all of them, in order');
  assert.deepEqual(cards(tab).map(c => c.dataset.wmapPlotId), ['p1', 'p2', 'p3']);
  await tick(10);
  assert.deepEqual(changes.at(-1).map(p => p.id), ['p1', 'p2', 'p3'], 'and tells the host so');
});

test('plots added while the question was open are deleted too, and Undo brings back exactly what was deleted', async () => {
  const { tab, store } = mountPlot({ plots: [SCATTER] });
  const s = await section(tab);
  click(button(s, 'wmap-plot-delete-all'));
  await until(confirmBox, 'opened');
  store.upsert(HIST);
  click(confirmBox().querySelector('[data-wmap-confirm-ok]'));
  await until(() => store.get().length === 0, 'both deleted');
  click(button(s, 'wmap-plot-notice-action'));
  assert.deepEqual(store.get().map(p => p.id), ['p1', 'p2']);
});

test('a plot the lot cannot draw is kept, greyed, and says why', async () => {
  const { tab, store } = mountPlot({ plots: [MISSING, SCATTER] });
  await section(tab);
  const card = cards(tab).find(c => c.dataset.wmapPlotId === 'p3');
  assert.match(card.textContent, /Needs test 3001 \(Leak\), which is not in these dies/);
  assert.equal(card.style.opacity, '0.7');
  assert.equal(cards(tab).find(c => c.dataset.wmapPlotId === 'p1').style.opacity, '1');
  assert.equal(store.get().length, 2, 'it is still in the list');
});

test('Export writes the plots file through the host hook; with nothing to export it says so', async () => {
  const saved = [];
  const { tab } = mountPlot({ plots: [SCATTER], deps: { onSaveText: (text, name, mime) => saved.push({ text, name, mime }) } });
  const s = await section(tab);
  click(button(s, 'wmap-plot-export'));
  assert.equal(saved.length, 1);
  assert.equal(saved[0].name, 'wafermap-plots.json');
  assert.equal(saved[0].mime, 'application/json');
  assert.deepEqual(readPlotsFile(saved[0].text).plots, [SCATTER]);
  const empty = mountPlot({ deps: { onSaveText: () => assert.fail('nothing to save') } });
  click(button(await section(empty.tab), 'wmap-plot-export'));
  assert.match(empty.tab.el.textContent, /no plots to export/);
});

test('Import adds the file\'s plots, keeps copies for an id already used, and names what it could not read', async () => {
  const file = writePlotsFile([SCATTER, { ...HIST, id: 'p9' }]).replace('"chart": "histogram"', '"chart": "histogram", "level": "galaxy"');
  const { tab, store } = mountPlot({ plots: [SCATTER], deps: { onPickPlotsFile: async () => file } });
  const s = await section(tab);
  click(button(s, 'wmap-plot-import'));
  await until(() => store.get().length === 3, 'the import');
  assert.equal(new Set(store.get().map(p => p.id)).size, 3);
  assert.equal(store.get()[0].id, 'p1', 'the existing plot is untouched');
  assert.match(s.textContent, /Imported 2 plots/);
  assert.match(s.textContent, /Kept as copies/);
  assert.match(s.textContent, /level/);
});

test('Import refuses a file that is not a plots file, and changes nothing', async () => {
  const { tab, store } = mountPlot({ plots: [SCATTER], deps: { onPickPlotsFile: async () => '{"wafers": []}' } });
  const s = await section(tab);
  click(button(s, 'wmap-plot-import'));
  await until(() => /Could not import/.test(s.textContent), 'the refusal');
  assert.equal(store.get().length, 1);
});

// ── saved plots as drilldown targets ─────────────────────────────────────────

function anchor() {
  const el = document.createElement('button');
  document.getElementById('root').appendChild(el);
  return el;
}
const menuRows = () => [...document.querySelector('[data-wmap-drilldown-menu]').querySelectorAll('[role="menuitem"]')];

test('each saved plot is a row of the drilldown menu, with "New plot…", between the charts and the tables', () => {
  const { items } = lotItems(1);
  const src = selectionPopulation(items[0].dies.slice(0, 8), { waferLabel: 'W1', testDefs: DEFS });
  const store = createPlotStore([SCATTER, MISSING], undefined, 0);
  const close = openDrilldownMenu({ x: 1, y: 1 }, anchor(), src, { plots: store });
  assert.deepEqual(menuRows().map(r => r.textContent), ['Value histogram', 'Process capability', 'Vth vs Idsat', 'Leak', 'New plot…', 'New sweep…', 'Dies', 'Test statistics']);
  const state = Object.fromEntries(menuRows().map(r => [r.textContent, r.getAttribute('aria-disabled')]));
  assert.equal(state['Vth vs Idsat'], null);
  assert.equal(state['Leak'], 'true', 'a plot the dies cannot draw is listed, disabled');
  close();
});

test('without a store there are no plot rows', () => {
  const { items } = lotItems(1);
  const src = selectionPopulation(items[0].dies.slice(0, 8), { waferLabel: 'W1', testDefs: DEFS });
  const close = openDrilldownMenu({ x: 1, y: 1 }, anchor(), src, {});
  assert.ok(!menuRows().some(r => /New plot/.test(r.textContent)));
  close();
});

test('a saved plot opens in the editor window over the selection, naming it', async () => {
  const { items } = lotItems(1);
  const src = selectionPopulation(items[0].dies.slice(0, 8), { waferLabel: 'W1', testDefs: DEFS });
  const store = createPlotStore([SCATTER], undefined, 0);
  openDrilldownMenu({ x: 1, y: 1 }, anchor(), src, { plots: store });
  click(menuRows().find(r => r.textContent === 'Vth vs Idsat'));
  const win = await until(() => document.querySelector('[data-wmap-plot-window]'), 'the plot window');
  assert.match(win.textContent, /Population: 8 dies selected on W1/);
  assert.match(win.textContent, /8 dies|1 wafer · 8 dies/);
  assert.match(win.textContent, /Changes are saved to “Vth vs Idsat”/);
  document.querySelector('.wmap-overlay-box button[aria-label^="Close"]')?.click();
});

test('a plot opened from the menu keeps an accurate heading as its fields change', async () => {
  const { items } = lotItems(1);
  const src = selectionPopulation(items[0].dies.slice(0, 8), { waferLabel: 'W1', testDefs: DEFS });
  const untitled = { id: 'u', chart: 'scatter', fields: { x: { test: 1050 }, y: { test: 1060 }, color: { none: true } } };
  const store = createPlotStore([untitled], undefined, 0);
  openDrilldownMenu({ x: 1, y: 1 }, anchor(), src, { plots: store });
  click(menuRows().find(r => r.textContent === 'Idsat vs Vth'));
  const win = await until(() => document.querySelector('[data-wmap-plot-window]'), 'the plot window');
  const windowTitle = () => win.closest('.wmap-overlay-box').firstElementChild.textContent;
  assert.match(windowTitle(), /^Plot — 8 dies selected on W1/);
  pick(win, 'plot-y', 'Vth · 1050');
  assert.equal(win.querySelector('[data-wmap-chart-title]').dataset.wmapChartTitle, 'Vth vs Vth');
  assert.doesNotMatch(windowTitle(), /Idsat|Vth/, 'the window heading does not name fields that may since have changed');
  assert.match(win.textContent, /Changes are saved to “Vth vs Vth”/);
  document.querySelector('.wmap-overlay-box button[aria-label^="Close"]')?.click();
});

test('"New plot…" opens a draft that is kept only when added', async () => {
  const { items } = lotItems(1);
  const src = selectionPopulation(items[0].dies.slice(0, 8), { waferLabel: 'W1', testDefs: DEFS });
  const store = createPlotStore([], undefined, 0);
  openDrilldownMenu({ x: 1, y: 1 }, anchor(), src, { plots: store });
  click(menuRows().find(r => r.textContent === 'New plot…'));
  const win = await until(() => document.querySelector('[data-wmap-plot-window]'), 'the draft window');
  assert.match(win.textContent, /This is a draft/);
  assert.equal(store.get().length, 0, 'not saved yet');
  pick(win, 'plot-y', 'Vth · 1050');
  assert.equal(store.get().length, 0, 'editing a draft does not save it');
  click(win.querySelector('[data-wmap-plot-add]'));
  assert.equal(store.get().length, 1);
  assert.deepEqual(store.get()[0].fields.y, { test: 1050, name: 'Vth' }, 'the edits made as a draft are what was added');
  assert.match(win.textContent, /Changes are saved to/);
  document.querySelector('.wmap-overlay-box button[aria-label^="Close"]')?.click();
});

test('"New sweep…" opens a sweep draft on the first tests of the selection, kept only when added', async () => {
  const { items } = lotItems(1);
  const src = selectionPopulation(items[0].dies.slice(0, 8), { waferLabel: 'W1', testDefs: DEFS });
  const store = createPlotStore([], undefined, 0);
  openDrilldownMenu({ x: 1, y: 1 }, anchor(), src, { plots: store });
  click(menuRows().find(r => r.textContent === 'New sweep…'));
  const win = await until(() => document.querySelector('[data-wmap-plot-window]'), 'the draft window');
  assert.ok(win.querySelector('[data-wmap-sweep-editor]'), 'the sweep editor, not the plot editor');
  assert.match(win.textContent, /This is a draft/);
  assert.equal(store.get().length, 0, 'not saved yet');
  click(win.querySelector('[data-wmap-plot-add]'));
  assert.equal(store.get().length, 1);
  assert.equal(store.get()[0].chart, 'sweep');
  assert.ok(store.get()[0].sweep.series[0].tests.length >= 1);
  document.querySelector('.wmap-overlay-box button[aria-label^="Close"]')?.click();
});

test('closing a draft without adding it leaves the saved list alone', async () => {
  const { items } = lotItems(1);
  const src = selectionPopulation(items[0].dies.slice(0, 8), { waferLabel: 'W1', testDefs: DEFS });
  const store = createPlotStore([], undefined, 0);
  openDrilldownMenu({ x: 1, y: 1 }, anchor(), src, { plots: store });
  click(menuRows().find(r => r.textContent === 'New plot…'));
  await until(() => document.querySelector('[data-wmap-plot-window]'), 'the draft window');
  document.querySelector('.wmap-overlay-box button[aria-label^="Close"]')?.click();
  assert.equal(store.get().length, 0);
});

test('"New plot…" is unavailable for dies with no parametric values', () => {
  const bins = buildWaferMap({
    results: Array.from({ length: 10 }, (_, k) => ({ x: k, y: 0, hbin: 1 })),
    waferConfig: { diameter: 80 }, dieConfig: { width: 10, height: 10 }, passBins: [1],
  });
  const src = selectionPopulation(bins.dies.slice(0, 5), { waferLabel: 'B' });
  const close = openDrilldownMenu({ x: 1, y: 1 }, anchor(), src, { plots: createPlotStore([SCATTER], undefined, 0) });
  const state = Object.fromEntries(menuRows().map(r => [r.textContent, r.getAttribute('aria-disabled')]));
  assert.equal(state['New plot…'], 'true');
  assert.equal(state['New sweep…'], 'true');
  assert.equal(state['Vth vs Idsat'], 'true');
  close();
});

// ── box, bar and line ────────────────────────────────────────────────────────

const BOX = { id: 'b1', chart: 'box', fields: { y: { test: 1050, name: 'Vth' }, color: { none: true } } };
const BAR = { id: 'b2', chart: 'bar', fields: { x: { meta: 'split' }, y: { builtin: 'yield' }, color: { none: true } } };
const LINE = { id: 'b3', chart: 'line', fields: { x: { builtin: 'waferOrder' }, y: { builtin: 'yield' }, color: { none: true } }, aggregate: 'mean' };
const tip = (card) => [...card.querySelectorAll('div')].find(d => d.style.display === 'block' && /rgba\(30, 32, 40/.test(d.style.background));
const hover = (card, x) => card.querySelector('canvas').dispatchEvent(new dom.window.MouseEvent('mousemove', { bubbles: true, clientX: x, clientY: 20 }));

test('box, bar and line plots draw with their population stated and no issue shown', async () => {
  const { tab } = mountPlot({ plots: [BOX, BAR, LINE] });
  await section(tab);
  const [box, bar, line] = cards(tab);
  for (const c of [box, bar, line]) assert.ok(c.querySelector('canvas'), `${c.dataset.wmapChartTitle} has a canvas`);
  assert.deepEqual(cards(tab).map(c => c.dataset.wmapChartTitle), ['Vth by Wafer', 'Yield by Split', 'Yield over Wafer order']);
  assert.match(box.textContent, /3 wafers · 72 dies/);
  assert.match(box.textContent, /box: quartiles; whiskers: minimum and maximum/, 'a box says what its whiskers are');
  assert.match(bar.textContent, /passing dies over judged dies, pooled per split/);
});

test('hovering a bar names the category, the value and how many it stands for', async () => {
  const { tab } = mountPlot({ plots: [BAR] });
  await section(tab);
  const card = cards(tab)[0];
  hover(card, 66);
  const t = tip(card);
  assert.ok(t, 'a tooltip');
  assert.match(t.textContent, /^FF|^TT/);
  assert.match(t.textContent, /Pooled yield: /);
  assert.match(t.textContent, /wafers?$/);
});

test('hovering a box gives its five numbers and the count', async () => {
  const { tab } = mountPlot({ plots: [BOX] });
  await section(tab);
  const card = cards(tab)[0];
  hover(card, 66);
  const t = tip(card);
  assert.ok(t);
  for (const word of ['max', 'upper quartile', 'median', 'lower quartile', 'min', 'dies']) assert.ok(t.textContent.includes(word), word);
});

test('clicking a wafer\'s box opens that wafer; a lot-field bar has nothing to open', async () => {
  const opened = [];
  const { tab } = mountPlot({ plots: [BOX, BAR], deps: { openWafer: (i, label) => opened.push([i, label]) } });
  await section(tab);
  const [box, bar] = cards(tab);
  box.querySelector('canvas').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, clientX: 66, clientY: 20 }));
  assert.deepEqual(opened, [[0, 'W1']]);
  bar.querySelector('canvas').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, clientX: 66, clientY: 20 }));
  assert.equal(opened.length, 1);
});

test('hovering a line names the x and each series\' value there', async () => {
  const { tab } = mountPlot({ plots: [LINE] });
  await section(tab);
  const card = cards(tab)[0];
  hover(card, 70);
  const t = tip(card);
  assert.ok(t);
  assert.match(t.textContent, /^Wafer order: /);
  assert.match(t.textContent, /\(1 wafers\)/);
});

test('a plot that cannot be drawn still has a name in its heading', async () => {
  const bad = { id: 'x', chart: 'box', fields: { x: { builtin: 'hbin' }, y: { builtin: 'yield' }, color: { none: true } } };
  const { tab } = mountPlot({ plots: [bad] });
  await section(tab);
  const card = cards(tab)[0];
  assert.equal(card.dataset.wmapChartTitle, 'Yield by Hard bin');
  assert.match(card.textContent, /Yield is one figure per wafer, and Hard bin belongs to dies, so a box of it cannot be split by Hard bin/);
});

test('a scatter coloured by a measured value shows a colourbar instead of a legend', async () => {
  const { tab } = mountPlot({ plots: [{ ...SCATTER, fields: { ...SCATTER.fields, color: { test: 1050, name: 'Vth' } } }] });
  await section(tab);
  const card = cards(tab)[0];
  const bar = card.querySelector('[data-wmap-plot-colorbar]');
  assert.ok(bar, 'a colourbar');
  assert.match(bar.textContent, /^Vth/);
  assert.ok(!card.querySelector('button[aria-pressed]'), 'no legend chips');
  hover(card, 70);
});

// ── titles that drift, and examples ──

test('a typed title that no longer matches its plot is flagged on the card, with a way back to the automatic one', async () => {
  const stale = { ...SCATTER, fields: { ...SCATTER.fields, y: { test: 1050, name: 'Vth' } } };   // title still says Idsat
  const { tab, store } = mountPlot({ plots: [stale, HIST] });
  await section(tab);
  const [card, other] = cards(tab);
  const note = card.querySelector('[data-wmap-plot-title-drift]');
  assert.equal(note.style.display, 'flex');
  assert.match(note.textContent, /The title names Idsat, which this plot does not show/);
  assert.equal(other.querySelector('[data-wmap-plot-title-drift]').style.display, 'none');
  click(button(card, 'wmap-plot-auto-title'));
  assert.equal('title' in store.get()[0], false);
  assert.equal(cards(tab)[0].dataset.wmapChartTitle, 'Vth vs Vth');
  assert.equal(cards(tab)[0].querySelector('[data-wmap-plot-title-drift]').style.display, 'none');
});

test('the editor says so under the title box, live', () => {
  const { e, emitted } = editor({ ...SCATTER, title: 'Vth vs Idsat' });
  click(tabButton(e.el, 'Customise'));
  const note = e.el.querySelector('[data-wmap-plot-title-drift]');
  assert.equal(note.style.display, 'none', 'the title is right');
  const title = e.el.querySelector('[data-wmap-plot-title]');
  title.value = 'Leakage by die';
  title.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  assert.equal(note.style.display, 'none', 'free text is left alone');
  title.value = 'Idsat only';
  title.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  assert.equal(note.style.display, 'flex');
  assert.match(note.textContent, /does not name Vth/);
  click(note.querySelector('[data-wmap-plot-auto-title]'));
  assert.equal('title' in emitted.at(-1), false);
});

test('Add examples draws one of each type from the lot, and does not add them twice', async () => {
  const { tab, store, changes } = mountPlot();
  const s = await section(tab);
  click(button(s, 'wmap-plot-examples'));
  assert.deepEqual(store.get().map(p => p.chart), ['scatter', 'histogram', 'box', 'bar', 'line', 'sweep']);
  assert.equal(cards(tab).length, 6);
  for (const c of cards(tab)) assert.ok(c.querySelector('canvas'), c.dataset.wmapChartTitle);
  assert.match(s.textContent, /Added 6 example plots: scatter, histogram, box, bar, line, sweep/);
  click(button(s, 'wmap-plot-examples'));
  assert.equal(store.get().length, 6, 'a second click adds nothing');
  assert.match(s.textContent, /already in your plots/);
  await tick(10);
  assert.ok(changes.length >= 1, 'the host is told');
});

test('Add examples keeps what the reader already has and adds only what is missing', async () => {
  const { tab, store } = mountPlot();
  const s = await section(tab);
  click(button(s, 'wmap-plot-examples'));
  const second = store.get()[1];
  store.remove(second.id);
  click(button(s, 'wmap-plot-examples'));
  assert.equal(store.get().length, 6);
  assert.equal(store.get().at(-1).chart, 'histogram');
});

// ── saving and printing ──

test('the Plot tab\'s controls are left off a printed page, and the chart keeps its key', async () => {
  const { tab } = mountPlot({ plots: [SCATTER] });
  const s = await section(tab);
  const noprint = (el) => el.hasAttribute('data-wmap-noprint');
  assert.ok(noprint(button(s, 'wmap-plot-new').parentElement), 'the toolbar: New, Examples, Import, Export');
  assert.ok(noprint(button(cards(tab)[0], 'wmap-plot-edit').parentElement), 'Edit, Duplicate, Delete');
  assert.ok(noprint(cards(tab)[0].querySelector('button[aria-label="Save as PNG"]')));
  assert.ok(noprint(cards(tab)[0].querySelector('button[aria-label="Expand"]')));
  click(button(cards(tab)[0], 'wmap-plot-delete'));
  assert.ok(noprint(s.querySelector('[role="status"]')), 'and the undo notice');
});

test('a plot saved as a PNG carries its title, its population and its colour key', async () => {
  const flats = [];
  dom.window.HTMLCanvasElement.prototype.toBlob = function toBlob(cb) { flats.push(this); cb(new dom.window.Blob(['x'])); };
  const saved = [];
  const colored = { ...SCATTER, title: undefined, fields: { ...SCATTER.fields, color: { meta: 'split' } } };
  const { tab } = mountPlot({ plots: [colored], deps: { onSaveImage: (blob, name) => saved.push(name) } });
  await section(tab);
  cards(tab)[0].querySelector('button[aria-label="Save as PNG"]').click();
  assert.deepEqual(saved, ['Idsat vs Vth · by Split.png']);
  assert.equal(flats.length, 1);
});

// ── sweeps as plots ──────────────────────────────────────────────────────────

const SWEEP = { id: 'sw1', title: 'Two-test sweep', chart: 'sweep', sweep: { series: [{ label: 'Run', tests: [1050, 1060] }] } };
const FOREIGN_SWEEP = { id: 'sw2', title: 'Other program', chart: 'sweep', sweep: { series: [{ label: 'Run', tests: [9001, 9002] }] } };
const SWEEP_TEXT = (win, hook, i) => win.querySelector(`[data-${hook}="${i}"]`);
const type = (input, text) => { input.value = text; input.dispatchEvent(new dom.window.Event('input', { bubbles: true })); };

test('a sweep is a card on the Plot tab, drawn by the sweep panel, with the same buttons as any plot', async () => {
  const { tab } = mountPlot({ plots: [SWEEP, SCATTER] });
  await section(tab);
  const card = cards(tab).find(c => c.dataset.wmapPlotId === 'sw1');
  assert.ok(card.dataset.wmapSweepPlot);
  assert.equal(card.dataset.wmapChartTitle, 'Two-test sweep');
  for (const hook of ['wmap-plot-edit', 'wmap-plot-duplicate', 'wmap-plot-delete']) assert.ok(button(card, hook), hook);
  assert.match(card.textContent, /median across 72 dies/);
  assert.deepEqual(cards(tab).map(c => c.dataset.wmapPlotId), ['sw1', 'p1'], 'plots and sweeps share one list and order');
});

test('a sweep whose tests are not in the lot is kept, greyed, and says so', async () => {
  const { tab, store } = mountPlot({ plots: [FOREIGN_SWEEP] });
  await section(tab);
  const card = cards(tab)[0];
  assert.match(card.textContent, /None of this sweep’s tests are in this data/);
  assert.equal(card.style.opacity, '0.7');
  assert.equal(store.get().length, 1);
});

test('there is no Sweeps tab: the Plot tab holds them, and the old default view opens it', async () => {
  const { tab } = mountPlot({ plots: [SWEEP], deps: { defaultView: 'sweeps' } });
  await section(tab);
  const labels = [...tab.el.querySelectorAll('[role="tab"]')].map(t => t.textContent);
  assert.ok(!labels.includes('Sweeps'), labels.join(','));
  assert.ok(labels.includes('Plot'));
  assert.equal(cards(tab).length, 1);
});

test('New sweep adds one on the lot\'s tests and opens the sweep editor', async () => {
  const { tab, store, changes } = mountPlot();
  const s = await section(tab);
  click(button(s, 'wmap-plot-new-sweep'));
  assert.equal(store.get().length, 1);
  assert.equal(store.get()[0].chart, 'sweep');
  assert.deepEqual(store.get()[0].sweep.series[0].tests, [1050, 1060]);
  assert.ok(document.querySelector('[data-wmap-sweep-editor]'), 'the sweep editor, not the plot editor');
  assert.ok(!document.querySelector('[data-wmap-plot-editor]'));
  await tick(10);
  assert.equal(changes.at(-1)[0].chart, 'sweep', 'the host is told, as for any plot');
  document.querySelector('.wmap-overlay-box button[aria-label^="Close"]')?.click();
});

test('typing the tests of a series edits the saved sweep; text that is not a test is flagged and not applied', async () => {
  const { tab, store } = mountPlot({ plots: [SWEEP] });
  const s = await section(tab);
  click(button(s, 'wmap-plot-edit'));
  const win = document.querySelector('[data-wmap-plot-window]');
  const box = SWEEP_TEXT(win, 'wmap-sweep-tests', 0);
  type(box, '1060, 1050');
  assert.deepEqual(store.get()[0].sweep.series[0].tests, [1060, 1050], 'order is the X axis and is kept as typed');
  type(box, '1060, oops');
  assert.deepEqual(store.get()[0].sweep.series[0].tests, [1060, 1050], 'a bad entry changes nothing');
  assert.equal(box.getAttribute('aria-invalid'), 'true');
  assert.match(win.textContent, /"oops" is not a test number/);
  type(box, '1050..1060');
  assert.deepEqual(store.get()[0].sweep.series[0].tests, ['1050..1060']);
  assert.equal(box.getAttribute('aria-invalid'), 'false');
  document.querySelector('.wmap-overlay-box button[aria-label^="Close"]')?.click();
});

test('the title, series and axis settings of a sweep are edited in place and removed when cleared', async () => {
  const { tab, store } = mountPlot({ plots: [SWEEP] });
  const s = await section(tab);
  click(button(s, 'wmap-plot-edit'));
  const win = document.querySelector('[data-wmap-plot-window]');
  type(win.querySelector('[data-wmap-sweep-title]'), 'Renamed');
  assert.equal(store.get()[0].title, 'Renamed');
  assert.equal(cards(tab)[0].dataset.wmapChartTitle, 'Renamed', 'the card follows');
  type(win.querySelector('[data-wmap-sweep-title]'), '');
  assert.ok(!('title' in store.get()[0]));
  click(win.querySelector('[data-wmap-sweep-add-series]'));
  assert.equal(store.get()[0].sweep.series.length, 2);
  assert.equal(store.get()[0].sweep.series[1].label, 'Series 2');
  click(win.querySelector('[data-wmap-sweep-remove-series]'));
  assert.equal(store.get()[0].sweep.series.length, 1);
  assert.ok(!win.querySelector('[data-wmap-sweep-remove-series]'), 'the last series cannot be removed');
  document.querySelector('.wmap-overlay-box button[aria-label^="Close"]')?.click();
});

test('the X values of a series are one of: test order, typed values, or read from the test names', async () => {
  const { tab, store } = mountPlot({ plots: [SWEEP] });
  const s = await section(tab);
  click(button(s, 'wmap-plot-edit'));
  const win = document.querySelector('[data-wmap-plot-window]');
  const radio = (label) => [...win.querySelectorAll('[role="radio"], input[type="radio"]')].find(r => (r.closest('label')?.textContent ?? r.textContent) === label);
  click(radio('Values'));
  assert.deepEqual(store.get()[0].sweep.series[0].xValues, []);
  type(win.querySelector('[aria-label="Series 1 X values"]'), '0, 5');
  assert.deepEqual(store.get()[0].sweep.series[0].xValues, [0, 5]);
  click(radio('From test name'));
  assert.ok(!('xValues' in store.get()[0].sweep.series[0]), 'one source at a time: the values are not kept alongside a pattern');
  assert.equal(store.get()[0].sweep.series[0].xFromName, '');
  click(radio('Test order'));
  assert.ok(!('xFromName' in store.get()[0].sweep.series[0]));
  document.querySelector('.wmap-overlay-box button[aria-label^="Close"]')?.click();
});

test('crossing and widths are offered only with two series', async () => {
  const { tab } = mountPlot({ plots: [SWEEP] });
  const s = await section(tab);
  click(button(s, 'wmap-plot-edit'));
  const win = document.querySelector('[data-wmap-plot-window]');
  assert.ok(!/Mark where the first two series cross/.test(win.textContent));
  click(win.querySelector('[data-wmap-sweep-add-series]'));
  assert.match(win.textContent, /Mark where the first two series cross/);
  document.querySelector('.wmap-overlay-box button[aria-label^="Close"]')?.click();
});

test('Duplicate and Delete work on a sweep like any plot', async () => {
  const { tab, store } = mountPlot({ plots: [SWEEP] });
  const s = await section(tab);
  click(button(cards(tab)[0], 'wmap-plot-duplicate'));
  assert.deepEqual(store.get().map(p => p.title), ['Two-test sweep', 'Two-test sweep (copy)']);
  assert.notEqual(store.get()[0].id, store.get()[1].id);
  click(button(cards(tab)[0], 'wmap-plot-delete'));
  assert.equal(store.get().length, 1);
  click([...s.querySelectorAll('[data-wmap-plot-notice-action]')].find(b => b.textContent === 'Undo'));
  assert.equal(store.get().length, 2);
});

test('a sweep is a row of the drilldown menu under Plots, and unavailable when the dies lack its tests', () => {
  const { items } = lotItems(1);
  const src = selectionPopulation(items[0].dies.slice(0, 8), { waferLabel: 'W1', testDefs: DEFS });
  const store = createPlotStore([SWEEP, FOREIGN_SWEEP, SCATTER], undefined, 0);
  const close = openDrilldownMenu({ x: 1, y: 1 }, anchor(), src, { plots: store });
  assert.deepEqual(menuRows().map(r => r.textContent), ['Value histogram', 'Process capability', 'Two-test sweep', 'Other program', 'Vth vs Idsat', 'New plot…', 'New sweep…', 'Dies', 'Test statistics']);
  const state = Object.fromEntries(menuRows().map(r => [r.textContent, r.getAttribute('aria-disabled')]));
  assert.equal(state['Two-test sweep'], null);
  assert.equal(state['Other program'], 'true');
  close();
});

test('the old sweeps option still draws: each entry is a sweep plot under its own id, and a saved plot of that id wins', () => {
  const legacy = { id: 'sw1', title: 'From the host', series: [{ label: 'Run', tests: [1050] }] };
  const other = { id: 'sw9', title: 'Only legacy', series: [{ label: 'Run', tests: [1060] }] };
  const store = createPlotStore([{ ...SWEEP, title: 'Edited by the reader' }], undefined, 0, { sweeps: [legacy, other] });
  assert.deepEqual(store.get().map(p => [p.id, p.title, p.chart]), [['sw1', 'Edited by the reader', 'sweep'], ['sw9', 'Only legacy', 'sweep']]);
});

test('deleting a sweep the host supplies tells the host, so its next render does not bring it back', () => {
  const removed = [];
  const store = createPlotStore([SCATTER], undefined, 0, { sweeps: [{ id: 'sw9', title: 'Legacy', series: [{ label: 'Run', tests: [1060] }] }], onRemove: ids => removed.push(...ids) });
  store.remove('p1');
  assert.deepEqual(removed, [], 'a plot that was never a host sweep is not reported');
  store.remove('sw9');
  assert.deepEqual(removed, ['sw9']);
});

// ── Reset and Cancel ─────────────────────────────────────────────────────────

const closeWindow = () => document.querySelector('.wmap-overlay-box button[aria-label^="Close"]')?.click();

test('Reset puts a plot back as it was when the window opened, and is disabled until something changed', async () => {
  const { tab, store } = mountPlot({ plots: [SCATTER] });
  const s = await section(tab);
  click(button(s, 'wmap-plot-edit'));
  const win = document.querySelector('[data-wmap-plot-window]');
  const reset = button(win, 'wmap-plot-reset');
  assert.ok(reset.disabled, 'nothing to reset yet');
  pick(win, 'plot-y', 'Vth · 1050');
  assert.deepEqual(store.get()[0].fields.y, { test: 1050, name: 'Vth' });
  assert.ok(!reset.disabled);
  click(reset);
  assert.deepEqual(store.get()[0], SCATTER, 'the saved plot is as it was');
  assert.ok(reset.disabled);
  assert.ok(document.querySelector('[data-wmap-plot-window]'), 'the window stays open');
  closeWindow();
});

test('Cancel reverts the edits and closes; the window\'s own close button keeps them', async () => {
  const { tab, store } = mountPlot({ plots: [SCATTER] });
  const s = await section(tab);
  click(button(s, 'wmap-plot-edit'));
  pick(document.querySelector('[data-wmap-plot-window]'), 'plot-y', 'Vth · 1050');
  click(button(document, 'wmap-plot-cancel'));
  assert.ok(!document.querySelector('[data-wmap-plot-window]'), 'closed');
  assert.deepEqual(store.get()[0], SCATTER);

  click(button(s, 'wmap-plot-edit'));
  pick(document.querySelector('[data-wmap-plot-window]'), 'plot-y', 'Vth · 1050');
  closeWindow();
  assert.deepEqual(store.get()[0].fields.y, { test: 1050, name: 'Vth' }, 'closing keeps what was changed');
});

test('Reset and Cancel work on a sweep, and Reset brings back the editor\'s own fields', async () => {
  const { tab, store } = mountPlot({ plots: [SWEEP] });
  const s = await section(tab);
  click(button(s, 'wmap-plot-edit'));
  const win = document.querySelector('[data-wmap-plot-window]');
  type(SWEEP_TEXT(win, 'wmap-sweep-tests', 0), '1060');
  type(win.querySelector('[data-wmap-sweep-title]'), 'Mistake');
  assert.equal(store.get()[0].title, 'Mistake');
  click(button(win, 'wmap-plot-reset'));
  assert.deepEqual(store.get()[0], SWEEP);
  assert.equal(win.querySelector('[data-wmap-sweep-title]').value, 'Two-test sweep', 'the editor shows the restored value');
  assert.equal(SWEEP_TEXT(win, 'wmap-sweep-tests', 0).value, '1050, 1060');
  type(win.querySelector('[data-wmap-sweep-title]'), 'Again');
  click(button(win, 'wmap-plot-cancel'));
  assert.deepEqual(store.get()[0], SWEEP);
  assert.ok(!document.querySelector('[data-wmap-plot-window]'));
});

test('cancelling a draft leaves the saved list alone', async () => {
  const { items } = lotItems(1);
  const src = selectionPopulation(items[0].dies.slice(0, 8), { waferLabel: 'W1', testDefs: DEFS });
  const store = createPlotStore([], undefined, 0);
  openDrilldownMenu({ x: 1, y: 1 }, anchor(), src, { plots: store });
  click(menuRows().find(r => r.textContent === 'New plot…'));
  const win = await until(() => document.querySelector('[data-wmap-plot-window]'), 'the draft window');
  click(button(win, 'wmap-plot-cancel'));
  assert.ok(!document.querySelector('[data-wmap-plot-window]'));
  assert.equal(store.get().length, 0);
});

test('the chart in the editor window takes its column\'s width, so an expanded view that is restored cannot cover the settings', async () => {
  const { tab } = mountPlot({ plots: [SWEEP, SCATTER] });
  const s = await section(tab);
  for (const id of ['sw1', 'p1']) {
    click(button(cards(tab).find(c => c.dataset.wmapPlotId === id), 'wmap-plot-edit'));
    const win = document.querySelector('[data-wmap-plot-window]');
    assert.equal(win.querySelector('[data-wmap-chart-card]').style.alignSelf, 'stretch', id);
    closeWindow();
  }
});

test('a series read from test names shows those names while the pattern is written, and what it reads from each', () => {
  const defs = [{ testNumber: 10, name: 'Fmax @ 0.55 V' }, { testNumber: 11, name: 'Fmax @ 0.60 V' }, { testNumber: 12, name: 'Fmax @ 0.65 V' }, { testNumber: 13, name: 'Fmax @ 0.70 V' }, { testNumber: 14, name: 'Fmax @ 0.75 V' }];
  const plot = { id: 's', chart: 'sweep', sweep: { series: [{ label: 'Up', tests: ['10..14'], xFromName: '' }] } };
  const emitted = [];
  const e = createSweepEditor({ doc: document, plot, testDefs: defs, onChange: p => emitted.push(p) });
  document.body.appendChild(e.el);
  const names = () => e.el.querySelector('[data-wmap-sweep-names="0"]');
  assert.match(names().textContent, /write a pattern with \{x\}/);
  assert.match(names().textContent, /10 {2}“Fmax @ 0\.55 V”/);
  assert.match(names().textContent, /… and 1 more/, 'four are shown, the rest counted');
  const box = e.el.querySelector('[aria-label="Series 1 name pattern"]');
  type(box, '@ {x}');
  assert.match(names().textContent, /What the pattern reads/);
  assert.match(names().textContent, /10 {2}“Fmax @ 0\.55 V” {2}→ 0\.55/);
  type(box, 'LRS_{x}');
  assert.match(names().textContent, /→ no match/);
  assert.equal(emitted.at(-1).sweep.series[0].xFromName, 'LRS_{x}');
  type(e.el.querySelector('[data-wmap-sweep-tests="0"]'), '10, 11');
  assert.ok(!/and \d+ more/.test(names().textContent), 'the list follows the tests');
  e.el.remove();
});

test('without the lot\'s tests the editor has no name preview, and a series not read from names has none', () => {
  const plot = { id: 's', chart: 'sweep', sweep: { series: [{ label: 'Up', tests: [10], xFromName: '@ {x}' }, { label: 'B', tests: [10] }] } };
  const none = createSweepEditor({ doc: document, plot, onChange() {} });
  assert.ok(!none.el.querySelector('[data-wmap-sweep-names]'));
  const withDefs = createSweepEditor({ doc: document, plot, testDefs: [{ testNumber: 10, name: 'x 1' }], onChange() {} });
  assert.ok(withDefs.el.querySelector('[data-wmap-sweep-names="0"]'));
  assert.ok(!withDefs.el.querySelector('[data-wmap-sweep-names="1"]'));
});

test('the sweep editor offers worked pattern examples for a series read from names, folded away until wanted', () => {
  const plot = { id: 's', chart: 'sweep', sweep: { series: [{ label: 'Up', tests: [10], xFromName: '' }, { label: 'B', tests: [10] }] } };
  const e = createSweepEditor({ doc: document, plot, onChange() {} });
  const ex = e.el.querySelectorAll('[data-wmap-sweep-examples]');
  assert.equal(ex.length, 1, 'only the series that is read from names');
  assert.equal(ex[0].open, false);
  assert.match(ex[0].textContent, /“1234-5” with -\{x\} reads 5/);
  assert.match(ex[0].textContent, /“Fmax @ 0\.55 V” with @ \{x\} reads 0\.55/);
  assert.match(ex[0].textContent, /cannot take part of a number/, 'what a pattern cannot do is said beside the examples');
});

// ── a field that would break the plot is greyed, with the reason ───────────────────────────────────────────

const optionRows = () => [...document.querySelectorAll('[role="option"]')];

test('with Yield as Y in a box, the X list greys the fields that belong to dies, with why; a bar leaves them all open', () => {
  const box = editor({ id: 'b', chart: 'box', fields: { x: { builtin: 'wafer' }, y: { builtin: 'yield' }, color: { none: true } } });
  click(box.e.el.querySelector('[data-wmap-select="plot-x"]'));
  const ring = optionRows().find(r => r.textContent.startsWith('Ring'));
  assert.ok(ring, 'Ring is in the list');
  assert.equal(ring.getAttribute('aria-disabled'), 'true');
  assert.match(ring.textContent, /Ring — Yield is per wafer: use a bar or line chart/);
  const wafer = optionRows().find(r => r.textContent === 'Wafer');
  assert.ok(wafer && wafer.getAttribute('aria-disabled') !== 'true', 'a wafer-level X is still fine');
  click(ring);                                                  // a greyed row does nothing
  assert.equal(box.emitted.length, 0);
  document.body.click();

  const bar = editor({ id: 'b', chart: 'bar', fields: { x: { builtin: 'wafer' }, y: { builtin: 'yield' }, color: { none: true } } });
  click(bar.e.el.querySelector('[data-wmap-select="plot-x"]'));
  assert.ok(!optionRows().some(r => r.getAttribute('aria-disabled') === 'true'), 'a bar of yield can be split by anything');
  document.body.click();
});

test('the Y list greys Yield when the X is per die, and the colour list greys a per-die field on a per-wafer plot', () => {
  const { e } = editor({ id: 'b', chart: 'box', fields: { x: { builtin: 'ring' }, y: { test: 1050, name: 'Vth' }, color: { none: true } } });
  click(e.el.querySelector('[data-wmap-select="plot-y"]'));
  const y = optionRows().find(r => r.textContent.startsWith('Yield'));
  assert.equal(y?.getAttribute('aria-disabled'), 'true');
  assert.match(y.textContent, /^Yield — Yield is per wafer: use a bar or line chart/);
  document.body.click();
});

test('replacing the list tells the host which sweeps it still supplies were dropped, as removing one does', () => {
  const sweepSpec = (id) => ({ id, title: `Sweep ${id}`, series: [{ label: 'Up', tests: [1000, 1001] }] });
  const removed = [];
  const store = createPlotStore([], undefined, 0, { sweeps: [sweepSpec('s1'), sweepSpec('s2')], onRemove: ids => removed.push(...ids) });
  assert.deepEqual(store.get().map(p => p.id), ['s1', 's2']);
  // An import that keeps s2 and adds a plot of its own drops s1.
  store.replaceAll([store.get()[1], SCATTER]);
  assert.deepEqual(removed, ['s1'], 'only the supplied sweep that is gone');
  // Replacing again with the same ids reports nothing new.
  store.replaceAll([SCATTER]);
  assert.deepEqual(removed, ['s1', 's2']);
  store.replaceAll([SCATTER]);
  assert.deepEqual(removed, ['s1', 's2'], 'each reported once');
});
