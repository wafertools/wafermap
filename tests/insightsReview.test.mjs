// Insights review follow-ups: the Overview's headline population, the yield
// chart's reference line, correlation's sample size, and scatter's coefficient.

import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { buildCorrelationMatrix, pearsonOfPairs, pearsonFromSums } from '../dist/packages/stats/correlation.js';

// Canvas is stubbed with a permissive proxy: these tests assert on the DOM chrome
// the panels build (titles, tiles, hints), never on pixels.
const dom = new JSDOM('<!doctype html><html><body><div id="host"></div></body></html>', { pretendToBeVisual: true });
for (const k of ['window', 'document', 'HTMLElement', 'HTMLCanvasElement', 'HTMLDivElement', 'HTMLButtonElement', 'Node', 'Event', 'MouseEvent', 'KeyboardEvent', 'CustomEvent', 'Blob', 'DOMRect']) {
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
const { renderTestPassRatePanel } = await import('../dist/packages/canvas-adapter/charts/testPassRate.js');

const TEST_DEFS = [{ testNumber: 1050, name: 'vth_mV', unit: 'mV', limitLow: 9, limitHigh: 13 }];

function lotItems(count) {
  const mk = (i) => buildWaferMap({
    results: Array.from({ length: 24 }, (_, k) => ({
      x: k % 6, y: Math.floor(k / 6),
      hbin: k % 7 === 0 ? 2 : 1,
      testValues: { 1050: 10 + i * 0.15 + (k % 4) * 0.05 },
    })),
    waferConfig: { diameter: 80, metadata: { lot: 'LOT1', wafer: `W${String(i + 1).padStart(2, '0')}` } },
    dieConfig: { width: 10, height: 10 },
    passBins: [1],
    testDefs: TEST_DEFS,
    hbinDefs: [{ bin: 1, name: 'Pass' }, { bin: 2, name: 'Fail' }],
  });
  const items = Array.from({ length: count }, (_, i) => ({ ...mk(i), label: `W${String(i + 1).padStart(2, '0')}` }));
  const lot = analyzeWaferLot(items, { computePerTestStats: true });
  items.forEach((it, i) => { it.statsSummary = lot.perWafer[i].summary; });
  return { items, lot };
}

function mountInsights(items, lot, defaultView) {
  const host = dom.window.document.getElementById('host');
  host.innerHTML = '';
  const tab = createInsightsTab({
    getItems: () => items,
    getLotStats: () => lot,
    getBinColors: () => ({ hard: new Map(), soft: new Map(), shared: { hard: [], soft: [] }, pass: { hard: new Set(), soft: new Set() } }),
    defaultView,
  });
  host.appendChild(tab.el);
  tab.render();
  return tab;
}

const cardTitles = (tab) => [...tab.el.querySelectorAll('[data-wmap-chart-title]')].map(t => t.textContent);
const text = (tab) => tab.el.textContent.replace(/\s+/g, ' ');

const die = (vals) => ({ x: 0, y: 0, testValues: vals });

test('correlation cells carry the pairwise n, not just r', () => {
  const defs = [
    { testNumber: 1, name: 'A' },
    { testNumber: 2, name: 'B' },
  ];
  // Six dies have both values; two more carry only A, so the PAIR count is 6
  // even though test A was measured on 8 dies. An r without its own n cannot be
  // interpreted, and the two are not the same number.
  const dies = [
    die({ 1: 1, 2: 2 }), die({ 1: 2, 2: 4 }), die({ 1: 3, 2: 6 }),
    die({ 1: 4, 2: 8 }), die({ 1: 5, 2: 10 }), die({ 1: 6, 2: 12 }),
    die({ 1: 7 }), die({ 1: 8 }),
  ];
  const m = buildCorrelationMatrix(dies, defs);
  const cell = m.cells.find(c => c.xIndex === 0 && c.yIndex === 1);
  assert.equal(cell.n, 6);
  assert.ok(Math.abs(cell.r - 1) < 1e-9, 'a perfect linear relation gives r = 1');
});

test('pearsonOfPairs and the matrix share one formula, so they cannot disagree', () => {
  const defs = [{ testNumber: 1, name: 'A' }, { testNumber: 2, name: 'B' }];
  const pairs = [
    { x: 1, y: 2.1 }, { x: 2, y: 3.9 }, { x: 3, y: 6.2 },
    { x: 4, y: 7.8 }, { x: 5, y: 10.1 }, { x: 6, y: 11.9 },
  ];
  const dies = pairs.map(p => die({ 1: p.x, 2: p.y }));
  const cell = buildCorrelationMatrix(dies, defs).cells.find(c => c.xIndex === 0 && c.yIndex === 1);
  const direct = pearsonOfPairs(pairs);
  assert.equal(direct.n, 6);
  // The scatter card reports this number for the pair the matrix cell links to.
  assert.ok(Math.abs(direct.r - cell.r) < 1e-12, `${direct.r} vs ${cell.r}`);
});

test('pearson is null below three points or with zero variance', () => {
  assert.equal(pearsonOfPairs([{ x: 1, y: 1 }, { x: 2, y: 2 }]).r, null);
  assert.equal(pearsonOfPairs([{ x: 1, y: 5 }, { x: 1, y: 5 }, { x: 1, y: 5 }]).r, null);
  assert.equal(pearsonFromSums(2, 0, 0, 0, 0, 0), null);
});

test('non-finite pairs are skipped rather than poisoning the coefficient', () => {
  const { r, n } = pearsonOfPairs([
    { x: 1, y: 2 }, { x: 2, y: 4 }, { x: NaN, y: 6 }, { x: 3, y: 6 }, { x: 4, y: Infinity },
  ]);
  assert.equal(n, 3);
  assert.ok(r !== null && Math.abs(r - 1) < 1e-9);
});


// ── Overview headline population ─────────────────────────────────────────────

test("a lot's Overview states its population, not just charts", () => {
  const { items, lot } = lotItems(6);
  const tab = mountInsights(items, lot, 'overview');
  const body = text(tab);
  // Previously the lot path opened straight into the yield chart: no wafer count,
  // no die count, nothing naming the population every chart below is computed over.
  assert.match(body, /6\s*Wafers/);
  assert.match(body, /Dies analysed/);
  // The mean must name its aggregation, exactly as the Summary panel's does — it
  // is not the die-weighted lot yield, and the two differ on an uneven lot.
  // The name itself now carries that ("per-wafer"); the die-weighted figure is
  // shown beside it only when the two actually differ, so this even lot shows
  // just the one number.
  assert.match(body, /Mean per-wafer yield/);
  tab.destroy();
});

test('a single wafer keeps its own tiles rather than gaining lot ones', () => {
  const { items, lot } = lotItems(1);
  const tab = mountInsights(items, lot, 'overview');
  const body = text(tab);
  assert.match(body, /Total dies/);
  assert.doesNotMatch(body, /Mean per-wafer yield/, 'one wafer has no across-wafer mean to report');
  tab.destroy();
});

// ── Wafer-to-wafer trend ────────────────────────────────────────────────────

test('Distributions carries a wafer-to-wafer trend card, explained', () => {
  const { items, lot } = lotItems(6);
  const tab = mountInsights(items, lot, 'distributions');
  assert.ok(cardTitles(tab).some(t => /Wafer-to-wafer trend/.test(t)), cardTitles(tab).join(' | '));
  const body = text(tab);
  // Every mark on the chart is named, and slot order is stated — it is the whole
  // premise, and a reader who assumes the x axis is sorted reads drift backwards.
  assert.match(body, /Point = wafer mean/);
  assert.match(body, /whisker = ±1σ/);
  assert.match(body, /dashed = lot mean/);
  assert.match(body, /wafers in slot order/);
  tab.destroy();
});

test('the trend card declines to draw a trend through one wafer', () => {
  const { items, lot } = lotItems(1);
  const tab = mountInsights(items, lot, 'distributions');
  assert.match(text(tab), /at least two wafers/);
  tab.destroy();
});


// ── Per-test pass rate by group ─────────────────────────────────────────────
//
// The suite could answer "which BIN is failing" (bin pareto) and "which group
// yields worse" (yield chart), but not "which TEST is failing, and does it fail
// more in one split than another" — the question a split experiment is usually
// run to answer.

const PF_DEFS = [
  { testNumber: 1, name: 'vth', limitLow: 0, limitHigh: 10 },
  { testNumber: 2, name: 'ioff', limitLow: 0, limitHigh: 10 },
  { testNumber: 90, name: 'scan_chain', testType: 'F' },
];
const pfDie = (testValues, testPass) => ({ x: 0, y: 0, testValues, testPass });

function mountPassRate(groups, testDefs = PF_DEFS) {
  const host = dom.window.document.getElementById('host');
  host.innerHTML = '';
  const handle = renderTestPassRatePanel({ groups, testDefs, ownerDocument: dom.window.document });
  host.appendChild(handle.card);
  return handle;
}

const seg = (handle) => [...handle.card.querySelectorAll('input[type=radio]')].map(r => r.value);

test('the card offers only the modes the data can answer', () => {
  // Limits + a functional verdict, but no recorded PARAMETRIC verdict: no
  // "Tester flag" mode, since it would render empty.
  const noFlags = [pfDie({ 1: 5 }, { 90: true })];
  const a = mountPassRate([{ key: '', items: [{ dies: noFlags }] }]);
  assert.deepEqual(seg(a), ['spec', 'functional']);
  a.destroy();

  // Add a recorded parametric verdict and the third mode appears.
  const withFlags = [pfDie({ 1: 5 }, { 1: true, 90: true })];
  const b = mountPassRate([{ key: '', items: [{ dies: withFlags }] }]);
  assert.deepEqual(seg(b), ['spec', 'testFlag', 'functional']);
  b.destroy();

  // A single mode is not worth a toggle.
  const c = mountPassRate([{ key: '', items: [{ dies: noFlags }] }], [PF_DEFS[0]]);
  assert.deepEqual(seg(c), []);
  assert.match(c.card.textContent, /spec limits/);
  c.destroy();
});

test('each mode names how it judged, so a screenshot is never ambiguous', () => {
  const dies = [pfDie({ 1: 5 }, { 1: true, 90: true })];
  const handle = mountPassRate([{ key: '', items: [{ dies }] }]);
  assert.match(handle.card.textContent, /Parametric pass rate · spec limits/);

  const pick = (v) => {
    const r = [...handle.card.querySelectorAll('input[type=radio]')].find(x => x.value === v);
    r.checked = true;
    r.dispatchEvent(new dom.window.Event('change'));
  };
  pick('testFlag');
  assert.match(handle.card.textContent, /Parametric pass rate · tester flag/);
  pick('functional');
  assert.match(handle.card.textContent, /Functional test pass rate/);
  handle.destroy();
});

test('a spec/tester disagreement is reported on the card, not silently resolved', () => {
  // Inside the limits, but the tester failed it — a guard band, a dynamic limit,
  // or a limits/data mismatch. Preferring either source would hide it.
  const dies = [
    pfDie({ 1: 5 }, { 1: true }),
    pfDie({ 1: 9.9 }, { 1: false }),
  ];
  const handle = mountPassRate([{ key: '', items: [{ dies }] }], [PF_DEFS[0]]);
  assert.match(handle.card.textContent, /1 die judged differently by limits and tester flag/);
  handle.destroy();
});

test('no disagreement note when the two sources agree', () => {
  const dies = [pfDie({ 1: 5 }, { 1: true })];
  const handle = mountPassRate([{ key: '', items: [{ dies }] }], [PF_DEFS[0]]);
  assert.doesNotMatch(handle.card.textContent, /judged differently/);
  handle.destroy();
});

test('grouping draws a legend naming each split', () => {
  const good = [pfDie({ 1: 5 }, { 90: true })];
  const bad = [pfDie({ 1: 99 }, { 90: false })];
  const handle = mountPassRate([
    { key: 'split A', items: [{ dies: good }] },
    { key: 'split B', items: [{ dies: bad }] },
  ]);
  assert.match(handle.card.textContent, /split A/);
  assert.match(handle.card.textContent, /split B/);
  assert.match(handle.card.textContent, /one bar per group/);
  handle.destroy();
});

test('a dataset with nothing judgeable says why, rather than drawing an empty chart', () => {
  // A parametric test with no limits cannot be judged, and there are no
  // functional tests — so there is no pass/fail to report at all.
  const handle = mountPassRate(
    [{ key: '', items: [{ dies: [pfDie({ 7: 1 }, undefined)] }] }],
    [{ testNumber: 7, name: 'unbounded' }],
  );
  assert.match(handle.card.textContent, /parametric tests need spec limits/);
  handle.destroy();
});

test('the Overview mounts the pass-rate card alongside the bin pareto', () => {
  const { items, lot } = lotItems(4);
  const tab = mountInsights(items, lot, 'overview');
  const titles = cardTitles(tab).join(' | ');
  assert.match(titles, /pass rate/i, titles);
  tab.destroy();
});

// ── Hover highlight must not paint over the row label ───────────────────────
//
// The highlight spans the full row width (x = 0 … width), so drawing it after the
// label covers the test name with it. Least visible when grouped (the label is
// centred across a multi-row cluster) and total when ungrouped, where the single
// sub-bar's highlight always overlaps it. `binCluster.ts` had the same ordering
// and this chart inherited it; both now paint the highlight first.

test('the hover highlight is drawn before the row label, not over it', async () => {
  const ops = [];
  const noop = () => {};
  dom.window.HTMLCanvasElement.prototype.getContext = () => new Proxy({}, {
    get: (_t, p) => {
      if (p === 'measureText') return () => ({ width: 40 });
      if (p === 'canvas') return { width: 600, height: 300 };
      if (p === 'fillRect') return (_x, y) => ops.push({ op: 'fillRect', y: Math.round(y) });
      if (p === 'fillText') return (t) => ops.push({ op: 'fillText', text: String(t) });
      return noop;
    },
    set: () => true,
  });
  dom.window.HTMLCanvasElement.prototype.getBoundingClientRect =
    () => ({ left: 0, top: 0, width: 600, height: 300 });

  const dies = [pfDie({ 1: 5, 2: 5 }, { 90: true })];
  const handle = mountPassRate([{ key: '', items: [{ dies }] }], [PF_DEFS[0], PF_DEFS[1]]);
  const canvas = handle.card.querySelector('canvas');

  ops.length = 0;
  // Inside the first row's bar: PADDING(12) + CLUSTER_LABEL_WIDTH(100) is the bar
  // origin, and jsdom reports clientWidth 0 so barMaxWidth floors at 10.
  canvas.dispatchEvent(new dom.window.MouseEvent('mousemove', { clientX: 115, clientY: 18 }));

  const firstRect = ops.findIndex(o => o.op === 'fillRect');
  const firstText = ops.findIndex(o => o.op === 'fillText');
  assert.ok(firstRect >= 0 && firstText >= 0, `expected a hovered draw: ${JSON.stringify(ops.slice(0, 6))}`);
  assert.ok(firstRect < firstText,
    `the highlight must precede the label, got ${JSON.stringify(ops.slice(0, 4))}`);
  handle.destroy();
});

// ── Correlation CSV ─────────────────────────────────────────────────────────
//
// The only Insights panel that gets its own CSV. Boxplot and trend would
// re-export per-wafer mean/σ/quartiles, which the Overview's test-values CSV
// already carries; the matrix is computed in the panel, is matrix-shaped, and is
// deliberately absent from the summary report.

test('correlation exports one row per pair, carrying r AND its own n', async () => {
  const { renderCorrelationPanel } = await import('../dist/packages/canvas-adapter/charts/correlation.js');
  const defs = [
    { testNumber: 1, name: 'vth' },
    { testNumber: 2, name: 'ioff' },
    { testNumber: 3, name: 'idsat' },
  ];
  const dies = Array.from({ length: 30 }, (_, i) => ({
    x: i, y: 0, testValues: { 1: i, 2: i * 2, 3: 30 - i },
  }));

  let saved = null;
  const host = dom.window.document.getElementById('host');
  host.innerHTML = '';
  const handle = renderCorrelationPanel({
    title: 'Test correlation matrix',
    items: [{ dies }], testDefs: defs,
    onSaveText: (text, filename) => { saved = { text, filename }; },
    ownerDocument: dom.window.document,
  });
  host.appendChild(handle.card);

  const btn = [...handle.card.querySelectorAll('button')].find(b => /CSV$/.test(b.textContent));
  assert.ok(btn, 'an onSaveText host gets an export button');
  btn.click();

  assert.equal(saved.filename, 'test-correlation.csv');
  const [header, ...rows] = saved.text.split('\n');
  assert.equal(header, 'Test X,Test X number,Test Y,Test Y number,r,n');
  // Long form: one row per unordered pair. A square grid would repeat every
  // value twice and make the reader work out which half is which.
  assert.equal(rows.length, 3, `3 tests → 3 pairs, got ${rows.length}`);
  for (const row of rows) {
    const n = row.split(',').pop();
    assert.equal(n, '30', 'n rides along per row — it varies when coverage differs');
  }
  // vth vs ioff is a perfect positive relation in this fixture.
  const perfect = rows.find(r => r.startsWith('ioff,2,vth,1') || r.startsWith('vth,1,ioff,2'));
  assert.ok(perfect && /,1\.000000,/.test(perfect), `expected r = 1 for the linear pair: ${perfect}`);
  handle.destroy();
});

test('no export button without a host save hook', async () => {
  const { renderCorrelationPanel } = await import('../dist/packages/canvas-adapter/charts/correlation.js');
  const host = dom.window.document.getElementById('host');
  host.innerHTML = '';
  const handle = renderCorrelationPanel({
    title: 'Test correlation matrix',
    items: [{ dies: [] }], testDefs: [{ testNumber: 1, name: 'vth' }],
    ownerDocument: dom.window.document,
  });
  host.appendChild(handle.card);
  assert.ok(![...handle.card.querySelectorAll('button')].some(b => /CSV$/.test(b.textContent)));
  handle.destroy();
});

test('every CSV button names what it exports', async () => {
  // Three buttons all read "Export CSV" — correlation, test values, functional —
  // and two of them sit on adjacent cards in the Insights Overview, where the
  // label was the only thing distinguishing them and distinguished nothing.
  const { items, lot } = lotItems(3);
  const tab = mountInsights(items, lot, 'overview');
  const overviewCsv = [...tab.el.querySelectorAll('button')]
    .map(b => b.textContent).filter(t => /CSV$/.test(t ?? ''));
  assert.ok(overviewCsv.length >= 1, 'Overview has at least the test-values export');
  assert.ok(!overviewCsv.includes('Export CSV'), `bare "Export CSV" is ambiguous: ${overviewCsv}`);
  for (const label of overviewCsv) {
    assert.match(label, /^(Test values|Functional) CSV$/, label);
  }
  tab.destroy();
});

// ── Single-wafer leaf clicks: focusTest (WMAP_ISSUES #51) ────────────────────
//
// `renderWaferMap` passes no `openWafer` — opening the only wafer on screen in
// a modal is two maps of one wafer. That left the boxplot's leaf row inert,
// throwing away the OTHER half of the click: the selected test. `focusTest` is
// that half, and these pin which host gets which.

function mountInsightsWith(items, lot, deps) {
  const host = dom.window.document.getElementById('host');
  host.innerHTML = '';
  const tab = createInsightsTab({
    getItems: () => items,
    getLotStats: () => lot,
    getBinColors: () => ({ hard: new Map(), soft: new Map(), shared: { hard: [], soft: [] }, pass: { hard: new Set(), soft: new Set() } }),
    defaultView: 'distributions',
    ...deps,
  });
  host.appendChild(tab.el);
  tab.render();
  return tab;
}

const boxplotCard = (tab) => tab.el.querySelector('[data-wmap-chart-title="Test value distribution"]');

/** Click the first leaf row of the boxplot canvas. JSDOM has no layout, so the
 *  canvas is given a rect and the y is placed inside row 0's band
 *  (PADDING 12, row height 24, gap 5 — see boxplot.ts). */
function clickFirstBoxplotRow(tab) {
  const canvas = boxplotCard(tab).querySelector('canvas');
  canvas.getBoundingClientRect = () => ({ top: 0, left: 0, right: 600, bottom: 300, width: 600, height: 300, x: 0, y: 0 });
  canvas.dispatchEvent(new dom.window.MouseEvent('click', { clientX: 300, clientY: 20, bubbles: true }));
  return canvas;
}

test('single-wafer boxplot leaf click focuses the test on the host map', () => {
  const { items, lot } = lotItems(1);
  const focused = [];
  const tab = mountInsightsWith(items, lot, { focusTest: (n) => focused.push(n) });
  clickFirstBoxplotRow(tab);
  assert.deepEqual(focused, [1050], 'the boxplot passes its own selected test, not testDefs[0] by luck');
  tab.destroy();
});

test('single-wafer boxplot says what its click does, in its own words', () => {
  const { items, lot } = lotItems(1);
  const tab = mountInsightsWith(items, lot, { focusTest: () => {} });
  const hint = boxplotCard(tab).textContent.replace(/\s+/g, ' ');
  assert.match(hint, /click a box to show this test on the map/i);
  assert.doesNotMatch(hint, /open that wafer/i, 'there is no other wafer to open');
  tab.destroy();
});

test('no leaf action at all means no click affordance is claimed', () => {
  const { items, lot } = lotItems(1);
  const tab = mountInsightsWith(items, lot, {});
  const hint = boxplotCard(tab).textContent.replace(/\s+/g, ' ');
  assert.doesNotMatch(hint, /click a box to/i);
  tab.destroy();
});

test('openWafer wins over focusTest — a gallery opens the wafer, already on that test', () => {
  const { items, lot } = lotItems(4);
  const opened = [];
  const focused = [];
  const tab = mountInsightsWith(items, lot, {
    openWafer: (i, label, testNumber) => opened.push([i, testNumber]),
    focusTest: (n) => focused.push(n),
  });
  clickFirstBoxplotRow(tab);
  assert.equal(opened.length, 1);
  assert.equal(opened[0][1], 1050, 'the wafer opens in value mode on the boxplot test');
  assert.deepEqual(focused, [], 'focusTest is not a second, parallel wiring');
  tab.destroy();
});

test('focusTest is ignored with more than one wafer — the clicked row is not the map', () => {
  const { items, lot } = lotItems(3);
  const focused = [];
  const tab = mountInsightsWith(items, lot, { focusTest: (n) => focused.push(n) });
  clickFirstBoxplotRow(tab);
  assert.deepEqual(focused, [], 'showing "this test" on a single map would show the wrong wafer');
  assert.doesNotMatch(boxplotCard(tab).textContent, /click a box to/i);
  tab.destroy();
});

// ── State that must survive render() (the Insights close/reopen round trip) ──
//
// A host closing Insights only hides it; reopening calls render(), which
// rebuilds every panel. Anything held inside a section is therefore silently
// reset by a gesture the user reads as "go back and look again".

function clipOutliersToggle(tab) {
  const label = [...boxplotCard(tab).querySelectorAll('label')]
    .find(l => l.textContent.includes('Clip outliers'));
  return label.querySelector('input[type="checkbox"]');
}

test('shared axis toggles survive a re-render, as the selected test already does', () => {
  const { items, lot } = lotItems(3);
  const tab = mountInsightsWith(items, lot, {});
  const box = clipOutliersToggle(tab);
  assert.equal(box.checked, false);
  box.checked = true;
  box.dispatchEvent(new dom.window.Event('change', { bubbles: true }));

  tab.render();
  assert.equal(clipOutliersToggle(tab).checked, true,
    'reopening Insights used to hand back the default, discarding the choice');
  tab.destroy();
});

// ── Tab switching reuses an already-built view ────────────────────────────────

test('insights — returning to a tab reuses its section instead of rebuilding it', () => {
  // Rebuilding cost seconds on a large lot: leaving Distributions and coming
  // back re-ran capability, boxplot, histogram and trend from scratch for a
  // panel that was already built and unchanged. Identity of the section element
  // is the observable proxy for "was it rebuilt".
  const { items, lot } = lotItems(4);
  const tab = mountInsights(items, lot, 'distributions');
  const sectionOf = (t) => t.el.querySelector('[data-wmap-chart-title]')?.closest('div');

  const first = sectionOf(tab);
  assert.ok(first, 'a section is built for the default view');

  const tabButton = (label) =>
    [...tab.el.querySelectorAll('button')].find(b => b.textContent === label);

  tabButton('Correlation')?.click();
  tabButton('Distributions')?.click();

  const again = sectionOf(tab);
  assert.ok(again, 'the section is back after switching away and returning');
  assert.equal(again, first, 'the SAME element is reused — a rebuild would produce a new one');
});

test('insights — a data or grouping change still rebuilds, cache or not', () => {
  // The cache must never outlive the thing it was built from. Only a tab switch
  // reuses; an explicit render() (new data, Group by, axis prefs) invalidates.
  const { items, lot } = lotItems(4);
  const tab = mountInsights(items, lot, 'distributions');
  const sectionOf = (t) => t.el.querySelector('[data-wmap-chart-title]')?.closest('div');

  const first = sectionOf(tab);
  tab.render();
  const afterRender = sectionOf(tab);
  assert.ok(afterRender, 'a section exists after an explicit render');
  assert.notEqual(afterRender, first, 'an explicit render rebuilds rather than reusing a stale section');
});

// ── The Sweeps sub-tab ────────────────────────────────────────────────────────
// Sweeps get their own tab, present exactly when any are defined: not an option,
// and not a count threshold that would move a sweep between tabs as others are
// added. They are not in Distributions, which is driven by one selected test.

function mountWithSweeps(items, lot, defaultView, sweeps) {
  const host = dom.window.document.getElementById('host');
  host.innerHTML = '';
  const tab = createInsightsTab({
    getItems: () => items,
    getLotStats: () => lot,
    getBinColors: () => ({ hard: new Map(), soft: new Map(), shared: { hard: [], soft: [] }, pass: { hard: new Set(), soft: new Set() } }),
    defaultView,
    sweeps,
  });
  host.appendChild(tab.el);
  tab.render();
  return tab;
}

const SWEEP = {
  id: 's1', title: 'Vth sweep card',
  series: [{ label: 'A', tests: [1050] }, { label: 'B', tests: [1050] }],
};
// The title is the attribute's VALUE — the card's text also holds its body.
const chartTitleAttrs = (tab) => [...tab.el.querySelectorAll('[data-wmap-chart-title]')].map(c => c.dataset.wmapChartTitle);
const tabLabels = (tab) => [...tab.el.querySelectorAll('button[role="tab"]')].map(b => b.textContent);
const selectedTab = (tab) => tab.el.querySelector('button[role="tab"][aria-selected="true"]')?.textContent;

test('the Sweeps tab exists only when sweeps are defined', () => {
  const { items, lot } = lotItems(2);
  assert.deepEqual(tabLabels(mountWithSweeps(items, lot, undefined, undefined)), ['Overview', 'Distributions', 'Correlation']);
  assert.deepEqual(tabLabels(mountWithSweeps(items, lot, undefined, [])), ['Overview', 'Distributions', 'Correlation']);
  assert.deepEqual(tabLabels(mountWithSweeps(items, lot, undefined, [SWEEP])), ['Overview', 'Distributions', 'Correlation', 'Sweeps']);
});

test('sweep cards are in the Sweeps tab, not in Distributions', () => {
  const { items, lot } = lotItems(2);
  const sweepsTab = mountWithSweeps(items, lot, 'sweeps', [SWEEP]);
  assert.equal(selectedTab(sweepsTab), 'Sweeps');
  assert.ok(chartTitleAttrs(sweepsTab).includes('Vth sweep card'), chartTitleAttrs(sweepsTab).join(' | '));

  const distTab = mountWithSweeps(items, lot, 'distributions', [SWEEP]);
  assert.ok(!chartTitleAttrs(distTab).includes('Vth sweep card'), 'no sweep card in Distributions');
});

test("defaultView 'sweeps' with no sweeps opens Overview — there is no such tab", () => {
  const { items, lot } = lotItems(2);
  assert.equal(selectedTab(mountWithSweeps(items, lot, 'sweeps', undefined)), 'Overview');
});
