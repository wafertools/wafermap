// Filters: conditions that must all hold, for a plot (`PlotSpec.where`) and for the whole of Insights (`insights.filter`).
// One rule applies both (`applyConditions`, stats/plotData.ts); one editor and one visible line show both (filterEditor.ts).

import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body><div id="host"></div></body></html>', { pretendToBeVisual: true });
for (const k of ['window', 'document', 'HTMLElement', 'HTMLCanvasElement', 'HTMLDivElement', 'HTMLButtonElement', 'HTMLInputElement', 'Node', 'Event', 'MouseEvent', 'KeyboardEvent', 'CustomEvent', 'Blob', 'DOMRect']) {
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
const { resolvePlot, plotFootnote, applyConditions, conditionText } = await import('../dist/packages/stats/plotData.js');
const { readPlotsFile, writePlotsFile, readFilter, PLOTS_FORMAT, PLOTS_VERSION } = await import('../dist/packages/stats/plotSpec.js');
const { createInsightsTab } = await import('../dist/packages/canvas-adapter/insightsTab.js');

const DEFS = [{ testNumber: 1, name: 'Vth', unit: 'V', limitLow: 0.2, limitHigh: 0.8 }];
/** 50 dies: Vth k/50 (+ shift), bin 1 for k < `pass`, bin 2 above; `noBin` dies from the end carry no bin. */
function wafer(label, { pass = 40, shift = 0, meta = {}, noBin = 0 } = {}) {
  const r = buildWaferMap({
    results: Array.from({ length: 50 }, (_, k) => ({
      x: k % 10, y: Math.floor(k / 10), ...(k >= 50 - noBin ? {} : { hbin: k < pass ? 1 : 2 }), testValues: { 1: k / 50 + shift },
    })),
    waferConfig: { diameter: 30, metadata: meta }, dieConfig: { width: 2, height: 2 }, passBins: [1], testDefs: DEFS,
  });
  return { label, dies: r.dies, metadata: r.metadata, passBins: [1], ringCount: r.ringCount, wafer: r.wafer };
}
const lot = () => [wafer('W1', { meta: { split: 'A' } }), wafer('W2', { shift: 0.1, meta: { split: 'B' } }), wafer('W3', { meta: { split: 'A' } })];
const ctx = { testDefs: DEFS };
const histogram = where => ({ id: 'p', chart: 'histogram', fields: { y: { test: 1 }, color: { none: true } }, where });
const BIN1 = { field: { builtin: 'hbin' }, values: ['Bin 1'] };
const SPLIT_A = { field: { meta: 'split' }, values: ['A'] };

// ── the rule ──────────────────────────────────────────────────────────────────────────────────────────────

test('every condition must hold: bin 1 on the split A wafers', () => {
  const r = resolvePlot(histogram({ conditions: [BIN1, SPLIT_A] }), lot(), ctx);
  assert.deepEqual(r.issues, []);
  assert.equal(r.population.dies, 80, '40 bin-1 dies on each of the two split A wafers');
  assert.match(plotFootnote(r), /only wafers where Split is A; only dies where Hard bin is Bin 1/);
});

test('a number keeps a range, either end open, and "not" keeps what is outside it', () => {
  const range = applyConditions([{ field: { test: 1 }, min: 0.21, max: 0.39 }], lot(), ctx);
  assert.equal(range.dies.kept, 27, 'nine dies of each wafer lie between 0.21 V and 0.39 V');
  assert.equal(applyConditions([{ field: { test: 1 }, min: 0.9 }], lot(), ctx).dies.kept, 20, 'from 0.9 V: five dies on W1 and W3, ten on W2 (shifted 0.1 V)');
  const outside = applyConditions([{ field: { test: 1 }, min: 0.21, max: 0.39, not: true }], lot(), ctx);
  assert.equal(outside.dies.kept, 150 - 27);
});

test('"not" on a category keeps every other value', () => {
  assert.equal(applyConditions([{ ...BIN1, not: true }], lot(), ctx).dies.kept, 30, 'ten bin-2 dies a wafer');
});

test('a die with no value for a condition meets no condition, negated or not', () => {
  const items = [wafer('W1', { noBin: 5 })];
  assert.equal(applyConditions([BIN1], items, ctx).dies.kept, 40);
  assert.equal(applyConditions([{ ...BIN1, not: true }], items, ctx).dies.kept, 5, 'the five binless dies are in neither');
});

test('a wafer condition reads the whole wafer, before the die conditions narrow it', () => {
  const items = [wafer('Good', { pass: 45 }), wafer('Poor', { pass: 30 })];
  // On its bin-1 dies alone every wafer yields 100%: judged after the die condition, the yield condition would keep none.
  const r = applyConditions([BIN1, { field: { builtin: 'yield' }, max: 70 }], items, ctx);
  assert.deepEqual(r.index, [1], 'Poor (60%) is kept, Good (90%) is not');
  assert.equal(r.dies.kept, 30);
  assert.deepEqual(r.wafers, { kept: 1, total: 2 });
});

test('a filter that is off keeps its conditions and filters nothing', () => {
  const r = resolvePlot(histogram({ conditions: [BIN1], off: true }), lot(), ctx);
  assert.equal(r.population.dies, 150);
  assert.doesNotMatch(plotFootnote(r), /only/);
});

test('a range on a category, or values of a number, is a reason, not a guess', () => {
  assert.match(applyConditions([{ field: { builtin: 'hbin' }, min: 1 }], lot(), ctx).issue, /category: keep some of its values/);
  assert.match(applyConditions([{ field: { test: 1 }, values: ['0.2'] }], lot(), ctx).issue, /number: keep a range/);
});

test('conditions are stated in words', () => {
  assert.equal(conditionText({ field: { builtin: 'ring' }, values: ['Ring 3', 'Ring 4'] }), 'Ring is Ring 3 or Ring 4');
  assert.equal(conditionText({ ...BIN1, not: true }), 'Hard bin is not Bin 1');
  assert.match(conditionText({ field: { test: 1 }, min: 0.4, max: 0.6 }, DEFS), /^Vth from 400 mV to 600 mV$/);
  assert.match(conditionText({ field: { test: 1 }, min: 0.4 }, DEFS), /^Vth at least 400 mV$/);
  assert.match(conditionText({ field: { builtin: 'yield' }, max: 90, not: true }), /^Yield above 90%$/);
});

// ── the file ──────────────────────────────────────────────────────────────────────────────────────────────

test('a filter round-trips through a plots file, switch included', () => {
  const plot = histogram({ conditions: [SPLIT_A, { field: { test: 1, name: 'Vth' }, min: 0.3 }], off: true });
  const back = readPlotsFile(writePlotsFile([plot]));
  assert.deepEqual(back.warnings, []);
  assert.deepEqual(back.plots[0].where, plot.where);
});

test('a condition that cannot be read is named and left out; a filter with none left is no filter', () => {
  const w = [];
  const f = readFilter({ conditions: [BIN1, { field: { test: 1 }, min: 5, max: 1 }, { field: { builtin: 'ring' } }], off: 'yes' }, 'p.where', w);
  assert.deepEqual(f, { conditions: [BIN1] });
  assert.equal(w.length, 4, 'min above max, then no range left, no values or range, and off not a switch');
  const file = readPlotsFile(JSON.stringify({ format: PLOTS_FORMAT, version: PLOTS_VERSION, plots: [histogram({ conditions: [{ field: { builtin: 'hbin' } }] })] }));
  assert.equal('where' in file.plots[0], false);
});

// ── Insights ──────────────────────────────────────────────────────────────────────────────────────────────

function insightsLot() {
  return Array.from({ length: 3 }, (_, i) => ({
    ...buildWaferMap({
      results: Array.from({ length: 24 }, (_, k) => ({ x: k % 6, y: Math.floor(k / 6), hbin: k % 7 === 0 ? 2 : 1, testValues: { 1: 0.3 + i * 0.1 + k * 0.01 } })),
      waferConfig: { diameter: 80, metadata: { lot: 'LOT1', wafer: `W0${i + 1}`, split: i === 1 ? 'B' : 'A' } },
      dieConfig: { width: 10, height: 10 }, passBins: [1], testDefs: DEFS,
    }),
    label: `W0${i + 1}`,
  }));
}

function mount({ filter, plots, defaultView } = {}) {
  const host = dom.window.document.getElementById('host');
  host.innerHTML = '';
  const changes = [], plotChanges = [];
  const tab = createInsightsTab({
    getRingCount: () => 4, getItems: () => insightsLot(),
    getBinColors: () => ({ hard: new Map(), soft: new Map(), shared: { hard: [], soft: [] }, pass: { hard: new Set(), soft: new Set() } }),
    filter, onFilterChange: f => changes.push(f), plots, onPlotsChange: p => plotChanges.push(p), defaultView,
  });
  host.appendChild(tab.el);
  tab.el.style.display = 'flex';
  tab.render();
  return { tab, changes, plotChanges };
}
const band = tab => tab.el.querySelector('[data-wmap-insights-filter]');
const bandText = tab => band(tab).textContent.replace(/\s+/g, ' ');
/** My plots is a lazily loaded chunk: wait until it has drawn what the test looks for. */
async function until(find) {
  for (let i = 0; i < 100; i++) { const el = find(); if (el) return el; await new Promise(r => setTimeout(r, 10)); }
  return null;
}
const flip = input => { input.checked = !input.checked; input.dispatchEvent(new dom.window.Event('change', { bubbles: true })); };

test('the Insights filter is stated above every tab, with what it keeps', () => {
  const { tab } = mount({ filter: { conditions: [SPLIT_A] } });
  assert.notEqual(band(tab).style.display, 'none');
  assert.match(bandText(tab), /Filter on:.*Split is A.*2 of 3 wafers · 48 of 72 dies/);
  for (const view of ['distributions', 'data', 'plot']) {
    tab.el.querySelector(`[data-wmap-insights-tab="${view}"]`).click();
    assert.match(bandText(tab), /2 of 3 wafers/, `still stated on ${view}`);
  }
});

test('switched off, the band stays, says so, and the host is told; Remove deletes it', () => {
  const { tab, changes } = mount({ filter: { conditions: [SPLIT_A] } });
  flip(band(tab).querySelector('[data-wmap-filter-strip-switch] input'));
  assert.deepEqual(changes.at(-1), { conditions: [SPLIT_A], off: true });
  assert.equal(band(tab).querySelector('[data-wmap-filter-strip]').dataset.wmapFilterStrip, 'off');
  assert.match(bandText(tab), /Filter off.*would keep only: Split is A/);
  band(tab).querySelector('[data-wmap-insights-filter-remove]').click();
  assert.equal(changes.at(-1), undefined);
  assert.equal(band(tab).style.display, 'none');
});

test('with no filter there is no band, and the Filter button opens the editor', () => {
  const { tab } = mount();
  assert.equal(band(tab).style.display, 'none');
  tab.el.querySelector('[data-wmap-insights-filter-open]').click();
  const modal = dom.window.document.querySelector('[data-wmap-insights-filter-modal]');
  assert.ok(modal, 'the modal opened');
  assert.match(modal.textContent, /No conditions: every wafer and die is shown/);
  modal.querySelector('[data-wmap-insights-filter-cancel]').click();
});

test('the editor is a draft: Cancel changes nothing, Apply filters every tab', () => {
  const { tab, changes } = mount({ filter: { conditions: [{ field: { meta: 'split' }, values: ['A', 'B'] }] } });
  assert.match(bandText(tab), /3 of 3 wafers/);
  const open = () => { band(tab).querySelector('[data-wmap-insights-filter-edit]').click(); return dom.window.document.querySelector('[data-wmap-insights-filter-modal]'); };
  let modal = open();
  flip(modal.querySelector('[data-wmap-filter-value="B"] input'));
  assert.match(modal.querySelector('[data-wmap-insights-filter-preview]').textContent, /Keeps 2 of 3 wafers/);
  modal.querySelector('[data-wmap-insights-filter-cancel]').click();
  assert.equal(changes.length, 0);
  assert.match(bandText(tab), /3 of 3 wafers/);
  modal = open();
  flip(modal.querySelector('[data-wmap-filter-value="B"] input'));
  modal.querySelector('[data-wmap-insights-filter-apply]').click();
  assert.deepEqual(changes.at(-1), { conditions: [SPLIT_A] });
  assert.match(bandText(tab), /2 of 3 wafers/);
});

test('a filter these wafers cannot meet says so, and filters nothing rather than everything', () => {
  const { tab } = mount({ filter: { conditions: [{ field: { meta: 'tool' }, values: ['T1'] }] } });
  assert.ok(band(tab).querySelector('[data-wmap-insights-filter-issue]'));
  assert.match(bandText(tab), /cannot be applied to these wafers .*so nothing is filtered/);
  assert.equal(tab.el.querySelector('[data-wmap-insights-filter-empty]'), null);
});

test('a filter the host restores is read as a plots file is: a bad condition is left out and logged', () => {
  const logged = [];
  const warn = console.warn;
  console.warn = m => logged.push(String(m));
  try {
    const { tab } = mount({ filter: { conditions: [SPLIT_A, { field: { builtin: 'ring' } }, 'junk'] } });
    assert.match(bandText(tab), /Split is A\s*— 2 of 3 wafers/);
    assert.equal(logged.length, 1);
    assert.match(logged[0], /^\[wafermap\] insights\.filter\.conditions\[1\]: needs values or a range.*conditions\[2\]: not a condition/);
    logged.length = 0;
    const none = mount({ filter: { conditions: 'all' } }).tab;
    assert.equal(band(none).style.display, 'none', 'nothing readable: no filter');
    assert.match(logged[0], /no filter is applied/);
  } finally { console.warn = warn; }
});

test('a filter that keeps nothing says so where the charts would be', () => {
  const { tab } = mount({ filter: { conditions: [{ field: { test: 1 }, min: 5 }] } });
  assert.match(bandText(tab), /0 of 3 wafers · 0 of 72 dies/);
  assert.ok(tab.el.querySelector('[data-wmap-insights-filter-empty]'));
});

// ── a plot's own filter, on its card ──────────────────────────────────────────────────────────────────────

test('a plot card states its filter, and its switch turns the filter off without losing it', async () => {
  const plot = { id: 'f', chart: 'histogram', fields: { y: { test: 1, name: 'Vth' }, color: { none: true } }, where: { conditions: [SPLIT_A] } };
  const { tab, plotChanges } = mount({ plots: [plot], defaultView: 'plot' });
  const card = await until(() => tab.el.querySelector('[data-wmap-plot-id="f"]'));
  const strip = card.querySelector('[data-wmap-filter-strip]');
  assert.equal(strip.dataset.wmapFilterStrip, 'on');
  assert.match(strip.textContent, /Filter on:.*Split is A/);
  flip(strip.querySelector('[data-wmap-filter-strip-switch] input'));
  const saved = (await until(() => plotChanges.at(-1))).find(p => p.id === 'f');
  assert.deepEqual(saved.where, { conditions: [SPLIT_A], off: true });
  assert.equal(card.querySelector('[data-wmap-filter-strip]').dataset.wmapFilterStrip, 'off');
});

test('a plot with no filter has no filter line', async () => {
  const plot = { id: 'g', chart: 'histogram', fields: { y: { test: 1 }, color: { none: true } } };
  const { tab } = mount({ plots: [plot], defaultView: 'plot' });
  const card = await until(() => tab.el.querySelector('[data-wmap-plot-id="g"]'));
  assert.ok(card);
  assert.equal(card.querySelector('[data-wmap-filter-strip]'), null);
});
