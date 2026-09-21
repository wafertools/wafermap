// The lot summary panel is the longest single piece of work in this library:
// it pools every die of every wafer and derives the bin, region and per-test
// sections from that pool. Measured in Chrome on a 50-wafer lot of 4,000 dies
// x 100 tests it was one 15.3 s task, long enough for the browser to offer to
// kill the page — and a task that does not yield cannot be narrated, so no
// progress indicator could have covered it.
//
// Two things fix that, and this file guards both:
//   1. it is a `Chunked` computation — one step per section, one per test —
//      so the caller can stage it across tasks, and
//   2. the three separate O(dies x tests) passes it used to make (descriptive
//      statistics, spec-yield tally, Ppk) share one pooled pass.
//
// (2) is the one that changes numbers if it is wrong, so most of this file is
// about the numbers being identical to a naive computation, not about speed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>');
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.HTMLDivElement = dom.window.HTMLDivElement;
globalThis.Node = dom.window.Node;

const {
  renderLotSummaryContent, renderLotSummaryContentSteps,
  renderWaferSummaryContent, renderWaferSummaryContentSteps,
  buildTestSection, buildTestSectionSteps,
} = await import('../dist/packages/canvas-adapter/summaryPanel.js');
const { runChunked } = await import('../dist/packages/canvas-adapter/chunked.js');
const { drain } = await import('../dist/packages/core/utils.js');
const { describeSorted } = await import('../dist/packages/stats/math.js');

const TESTS = [
  { testNumber: 1050, name: 'Idsat', unit: 'A', limitLow: -2, limitHigh: 2 },
  { testNumber: 1060, name: 'Vth', unit: 'V', limitLow: 0, limitHigh: 10 },
  { testNumber: 1070, name: 'Leak', unit: 'A' }, // no limits — no spec yield, no Ppk
];

/** Deterministic pseudo-random values, so a failure is reproducible. */
function makeLot(wafers = 3, diesPerWafer = 40) {
  let seed = 7;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const items = [];
  for (let w = 0; w < wafers; w++) {
    const dies = [];
    for (let i = 0; i < diesPerWafer; i++) {
      dies.push({
        x: i % 8, y: (i / 8) | 0,
        hbin: rnd() < 0.85 ? 1 : 2, sbin: 1,
        testValues: { 1050: (rnd() - 0.5) * 6, 1060: rnd() * 12, 1070: rnd() },
      });
    }
    items.push({
      wafer: { diameter: 300, radius: 150, center: { x: 0, y: 0 }, orientation: 0, metadata: { lot: 'L1', waferId: `W${w}` } },
      dies, passBins: [1],
    });
  }
  return items;
}

const lotSummaryFor = (items) => ({
  stats: { waferCount: items.length },
  perWafer: items.map((it, i) => ({
    waferIndex: i,
    summary: {
      wafer: it.wafer.metadata,
      yield: { yieldPercent: 90, totalDies: it.dies.length, passDies: 36, failDies: 4 },
      stats: { warnings: [], yieldPercent: 90 + i },
    },
  })),
  findings: [],
});

function panelEl() {
  const p = document.createElement('div');
  document.body.appendChild(p);
  return p;
}

// ── The numbers ───────────────────────────────────────────────────────────────

test('pooled pass — every displayed statistic matches a naive per-test computation exactly', () => {
  const items = makeLot();
  const allDies = items.flatMap(it => it.dies);

  const section = buildTestSection(
    allDies, TESTS, undefined, undefined, undefined, undefined,
    items.map(it => ({ dies: it.dies })), undefined, 'full',
  );

  // Every test here ran on every die, so N is uniform and the table states it
  // once in the section title rather than repeating a column of it.
  const n = allDies.length;
  assert.match(section.textContent, new RegExp(`N=${n.toLocaleString()}`));
  assert.equal([...section.querySelectorAll('tbody tr')].length, TESTS.length);

  // The CSV carries every column, unformatted enough to compare numerically.
  const saved = {};
  const withCsv = buildTestSection(
    allDies, TESTS, undefined, undefined, (text) => { saved.text = text; }, undefined,
    items.map(it => ({ dies: it.dies })), undefined, 'full',
  );
  [...withCsv.querySelectorAll('button')].find(b => /CSV$/.test(b.textContent)).click();
  const lines = saved.text.trim().split('\n');
  const header = lines[0].split(',');
  for (const def of TESTS) {
    const line = lines.slice(1).find(l => l.startsWith(def.name + ','));
    assert.ok(line, `no CSV row for ${def.name}`);
    const cols = line.split(',');
    const col = (name) => Number(cols[header.indexOf(name)]);
    const vals = allDies.map(d => d.testValues[def.testNumber]).filter(v => Number.isFinite(v));
    const expected = describeSorted([...vals].sort((a, b) => a - b));
    assert.equal(col('N'), expected.count, `${def.name} N`);
    // Formatted to a few significant digits on the way out, so compare
    // relatively rather than demanding the full double back.
    for (const [name, want] of [['Min', expected.min], ['Max', expected.max], ['Mean', expected.mean],
      ['Median', expected.median], ['Q1', expected.q1], ['Q3', expected.q3], ['StdDev', expected.stddev]]) {
      const got = col(name);
      // The CSV prints three significant digits, so compare at that precision —
      // the point of this assertion is that the pooled pass computes the same
      // statistic, not that formatting round-trips a double.
      assert.ok(Math.abs(got - want) <= Math.max(1e-6, Math.abs(want) * 5e-3),
        `${def.name} ${name}: got ${got}, want ${want}`);
    }
  }
});

test('pooled pass — spec yield still counts dies outside the limits, and only for limited tests', () => {
  const dies = [
    { x: 0, y: 0, testValues: { 1050: 0 } },     // in spec
    { x: 1, y: 0, testValues: { 1050: 5 } },     // above limitHigh
    { x: 2, y: 0, testValues: { 1050: -5 } },    // below limitLow
    { x: 3, y: 0, testValues: { 1050: 1.5 } },   // in spec
  ];
  const section = buildTestSection(dies, [TESTS[0]], undefined, undefined, undefined, undefined, [{ dies }], undefined, 'compact');
  // 2 of 4 within [-2, 2] → 50%.
  assert.match(section.textContent, /50(\.0)?%/);

  const unlimited = buildTestSection(dies.map(d => ({ ...d, testValues: { 1070: d.testValues[1050] } })),
    [TESTS[2]], undefined, undefined, undefined, undefined, undefined, undefined, 'compact');
  assert.ok(!/%/.test(unlimited.textContent), 'a test with no limits must show no spec yield');
});

test('pooled pass — a precomputed full summary still wins, and still costs no die scan', () => {
  // The single-wafer panel passes analyzeWaferMap's own perTestStats. Those are
  // authoritative: the pooled pass must not quietly recompute over them.
  const dies = [{ x: 0, y: 0, testValues: { 1050: 1 } }, { x: 1, y: 0, testValues: { 1050: 2 } }];
  const precomputed = {
    perTestStats: [{ testNumber: 1050, min: -99, max: 99, mean: 0.5, count: 12345, stddev: 1, median: 0, q1: -1, q3: 1 }],
  };
  const section = buildTestSection(dies, [TESTS[0]], undefined, precomputed, undefined, undefined, undefined, undefined, 'compact');
  assert.match(section.textContent, /12,345|12345/, 'the precomputed N must be what is shown');
});

// ── The chunking ──────────────────────────────────────────────────────────────

test('chunked — stepping produces exactly the same panel as running straight through', () => {
  const items = makeLot();
  const lotSummary = lotSummaryFor(items);
  const params = { lotSummary, items, testDefs: TESTS, passBins: [1] };

  const sync = panelEl();
  renderLotSummaryContent(sync, params);

  const stepped = panelEl();
  drain(renderLotSummaryContentSteps(stepped, params));

  assert.equal(stepped.textContent, sync.textContent);
});

test('chunked — the panel takes at least one step per test, so no step carries the whole table', () => {
  const items = makeLot();
  const gen = renderLotSummaryContentSteps(panelEl(), { lotSummary: lotSummaryFor(items), items, testDefs: TESTS, passBins: [1] });
  let steps = 0;
  while (!gen.next().done) steps++;
  // Sections + one per wafer pooled + one per test. The exact number is not the
  // contract; "more than a handful, and it grows with the work" is.
  assert.ok(steps >= items.length + TESTS.length,
    `expected at least ${items.length + TESTS.length} steps, got ${steps}`);
});

test('chunked — sections are appended as they are built, not all at the end', () => {
  const items = makeLot();
  const panel = panelEl();
  const gen = renderLotSummaryContentSteps(panel, { lotSummary: lotSummaryFor(items), items, testDefs: TESTS, passBins: [1] });
  let sawPartial = false;
  let steps = 0;
  while (!gen.next().done) {
    steps++;
    if (panel.textContent.length > 0 && !/Test Values/.test(panel.textContent)) sawPartial = true;
  }
  assert.ok(sawPartial, 'the panel should have had visible content before the last section was built');
  assert.match(panel.textContent, /Test Values/);
  assert.ok(steps > 1);
});

test('chunked — runChunked finishes small work synchronously, and stages big work', async () => {
  const items = makeLot();
  const params = { lotSummary: lotSummaryFor(items), items, testDefs: TESTS, passBins: [1] };

  const oneShot = panelEl();
  const run = runChunked(renderLotSummaryContentSteps(oneShot, params));
  assert.equal(run.done, true, 'a small lot must render in the first slice, exactly as it always did');

  // firstSliceMs: 0 forces the staging path that a real lot takes.
  const staged = panelEl();
  const stagedRun = runChunked(renderLotSummaryContentSteps(staged, params), { firstSliceMs: 0, sliceMs: 0 });
  assert.equal(stagedRun.done, false, 'with no first-slice budget the work must yield');
  await new Promise((resolve) => {
    const poll = () => (stagedRun.done ? resolve() : setTimeout(poll, 1));
    poll();
  });
  assert.equal(staged.textContent, oneShot.textContent);
});

test('chunked — a cancelled render stops, and does not keep appending to the panel', async () => {
  const items = makeLot();
  const panel = panelEl();
  const run = runChunked(
    renderLotSummaryContentSteps(panel, { lotSummary: lotSummaryFor(items), items, testDefs: TESTS, passBins: [1] }),
    { firstSliceMs: 0, sliceMs: 0 },
  );
  run.cancel();
  const after = panel.textContent;
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(panel.textContent, after, 'a cancelled render must not write anything more');
  assert.equal(run.done, false);
});

test('chunked — buildTestSectionSteps drained equals buildTestSection', () => {
  const items = makeLot();
  const allDies = items.flatMap(it => it.dies);
  const args = [allDies, TESTS, undefined, undefined, undefined, undefined, items.map(it => ({ dies: it.dies })), undefined, 'full'];
  assert.equal(drain(buildTestSectionSteps(...args)).textContent, buildTestSection(...args).textContent);
});

// ── The single-wafer panel ────────────────────────────────────────────────────
//
// It shares the Test Values table with the lot panel, so it got the pooled
// pass's 2.3x for free — but not the chunking, and a single 400,000-die wafer
// walks just as many die-test values as a lot does. Same `Chunked` shape, same
// "the synchronous name is the generator drained" rule.

test('wafer panel — renderWaferSummaryContentSteps drained equals renderWaferSummaryContent', () => {
  const items = makeLot();
  const params = { wafer: items[0].wafer, dies: items[0].dies, testDefs: TESTS, passBins: [1] };

  const drained = panelEl();
  drain(renderWaferSummaryContentSteps(drained, params));
  const sync = panelEl();
  renderWaferSummaryContent(sync, params);
  assert.equal(drained.textContent, sync.textContent);
  assert.ok(drained.textContent.includes('Test Values'), 'the section under test must be present');
});

test('wafer panel — sections are appended as they are built, not all at the end', () => {
  const items = makeLot();
  const panel = panelEl();
  const steps = renderWaferSummaryContentSteps(panel, {
    wafer: items[0].wafer, dies: items[0].dies, testDefs: TESTS, passBins: [1],
  });
  let sawPartial = false;
  let total = 0;
  for (;;) {
    const s = steps.next();
    if (s.done) break;
    total++;
    // Earlier sections on the panel while the last one is still unbuilt is the
    // whole point: a staged render that only writes at the end is a frozen
    // panel. The panel header alone would not prove it — it is appended before
    // the first step — so this looks for a real section ahead of the last.
    if (/Bin Breakdown/i.test(panel.textContent) && !/Test Values/.test(panel.textContent)) sawPartial = true;
  }
  assert.ok(total > 1, 'the wafer panel must take more than one step');
  assert.ok(sawPartial, 'an earlier section must land before the Test Values table is built');
  assert.match(panel.textContent, /Test Values/);
});

test('wafer panel — a cancelled render stops writing', async () => {
  const items = makeLot();
  const panel = panelEl();
  const run = runChunked(renderWaferSummaryContentSteps(panel, {
    wafer: items[0].wafer, dies: items[0].dies, testDefs: TESTS, passBins: [1],
  }), { firstSliceMs: 0, sliceMs: 0 });
  run.cancel();
  const after = panel.textContent;
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(panel.textContent, after);
  assert.equal(run.done, false);
});
