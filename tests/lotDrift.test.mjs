// Drift across a lot: a trend in yield, or in a test's mean, wafer after wafer. Nothing else in the
// analysis can see it (no region, bin or wafer stands out), and it is said in "input order" because
// the wafers' order is only physical when the host says so.

import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { analyzeWaferLot, analyzeWaferMap, buildWaferMap } from '../dist/index.js';
import { mannKendall } from '../dist/packages/stats/math.js';
import { buildDriftFindings, DRIFT_MIN_WAFERS } from '../dist/packages/stats/lotDrift.js';
import { buildSynthesis, synthesisText } from '../dist/packages/stats/synthesis.js';
import { renderLotReportHtml } from '../dist/packages/stats/renderSummaryReport.js';

const dom = new JSDOM('<!doctype html><html><body></body></html>');
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.HTMLDivElement = dom.window.HTMLDivElement;
globalThis.Node = dom.window.Node;
const { buildSynthesisSection } = await import('../dist/packages/canvas-adapter/summaryPanel.js');

// ── The test itself ───────────────────────────────────────────────────────────

test('a perfect run of five is significant, and the Theil–Sen line is the run', () => {
  const mk = mannKendall([10, 9, 8, 7, 6]);
  assert.equal(mk.s, -10);
  assert.ok(mk.pValue < 0.05 && mk.pValue > 0.01, `p ${mk.pValue}`);
  assert.equal(mk.slope, -1);
  assert.equal(mk.intercept, 10);
});

test('no trend, too few points, or a constant series give none', () => {
  assert.equal(mannKendall([1, 2]), null);
  assert.equal(mannKendall([5, 5, 5, 5, 5]), null);
  assert.ok(mannKendall([3, 1, 4, 1, 5, 9, 2, 6]).pValue > 0.1, 'a mild tendency is not a trend');
});

test('one wild point cannot make or break a trend', () => {
  const clean = mannKendall([10, 9, 8, 7, 6, 5]);
  const wild = mannKendall([10, 9, 80, 7, 6, 5]);
  assert.ok(wild.pValue < 0.1, 'still a decline');
  assert.equal(wild.slope, clean.slope);
});

test('ties are corrected for, and the sign follows the direction', () => {
  const up = mannKendall([1, 1, 2, 2, 3, 3]);
  assert.ok(up.z > 0 && up.slope > 0);
  assert.ok(mannKendall([3, 3, 2, 2, 1, 1]).z < 0);
});

// ── The findings, on fabricated lots ──────────────────────────────────────────

const lotOf = (yields, tests = []) => yields.map((y, waferIndex) => ({
  waferIndex,
  summary: { stats: { yieldPercent: y, perTestStats: tests.map(t => t(waferIndex)) } },
}));
const perTest = (testNumber, label, means, sd = 1, count = 100) => (i) => ({ testNumber, label, count, mean: means[i], stddev: sd, min: 0, max: 0, median: 0, q1: 0, q3: 0 });

test('a steady fall in yield is a finding, said in input order', () => {
  const [f] = buildDriftFindings(lotOf([84.6, 82.7, 80.5, 78.8, 77.7, 74.0]), 0.05);
  assert.equal(f.id, 'drift:yield');
  assert.equal(f.level, 'inter-wafer');
  assert.equal(f.effect.direction, 'lower');
  assert.ok(f.effect.absoluteDelta > -0.12 && f.effect.absoluteDelta < -0.09, 'a fraction, about −10 points');
  assert.equal(f.summary, 'Yield falls on successive wafers: 84.6% → 74.0% over 6 wafers (input order)');
  assert.equal(f.severity, 'unusual');
  assert.deepEqual(f.highlight.waferIndices, [0, 1, 2, 3, 4, 5]);
});

test('a rise is called a rise', () => {
  const [f] = buildDriftFindings(lotOf([70, 74, 78, 82, 86, 90]), 0.05);
  assert.match(f.summary, /^Yield rises on successive wafers/);
  assert.equal(f.effect.direction, 'higher');
});

test('no finding for noise, for fewer than five wafers, or for a trend too small to matter', () => {
  assert.deepEqual(buildDriftFindings(lotOf([90, 88, 91, 89, 92, 87]), 0.05), []);
  assert.deepEqual(buildDriftFindings(lotOf([90, 89, 88, 87]), 0.05), [], `under ${DRIFT_MIN_WAFERS} wafers`);
  // a perfectly monotonic fall of a tenth of a point a wafer is significant and not worth saying
  assert.deepEqual(buildDriftFindings(lotOf([90, 89.9, 89.8, 89.7, 89.6, 89.5]), 0.05), []);
});

test('a test whose mean drifts is a finding in its own units, judged against its own spread', () => {
  const means = [100, 101, 102, 103, 104, 105];
  const found = buildDriftFindings(lotOf([90, 90, 90, 90, 90, 90], [perTest(7, 'VTH', means, 4)]), 0.05);
  assert.equal(found.length, 1);
  assert.equal(found[0].id, 'drift:test:7');
  assert.equal(found[0].variable.kind, 'test');
  assert.match(found[0].summary, /^VTH rises across the wafers: .* over 6 wafers \(input order\)$/);
  // 5 over a within-wafer σ of 4 is 1.25σ
  assert.ok(Math.abs(found[0].effect.effectSize - 1.25) < 1e-9);
  assert.equal(found[0].severity, 'unusual');
});

test('a drift of a test that is small beside its own spread is not reported', () => {
  const means = [100, 100.1, 100.2, 100.3, 100.4, 100.5];
  assert.deepEqual(buildDriftFindings(lotOf([90, 90, 90, 90, 90, 90], [perTest(7, 'VTH', means, 4)]), 0.05), []);
});

test('the tests are corrected together: many noisy tests do not manufacture a drift', () => {
  // 40 tests of noise in a fixed pseudo-random order, none of them trending
  const noise = (seed) => Array.from({ length: 6 }, (_, i) => ((seed * 9301 + i * 49297 + 233) % 233280) / 233280 * 10);
  const tests = Array.from({ length: 40 }, (_, k) => perTest(k, `T${k}`, noise(k + 1), 1));
  const found = buildDriftFindings(lotOf([90, 90, 90, 90, 90, 90], tests), 0.05);
  assert.deepEqual(found, []);
});

test('analyzeWaferLot carries the drift findings beside its others', () => {
  const R = 8;
  const wafer = (k) => {
    const results = [];
    for (let x = -R; x <= R; x++) for (let y = -R; y <= R; y++) {
      if (Math.hypot(x, y) > R) continue;
      results.push({ x, y, hbin: ((x + 9) * 7 + (y + 9) * 13) % 100 < 6 + k * 4 ? 2 : 1 });
    }
    return buildWaferMap({ results, waferConfig: { diameter: 300, notch: { type: 'bottom' }, metadata: { lot: 'L1', waferId: `W${k}` } }, passBins: [1], ringCount: 4 });
  };
  const lot = analyzeWaferLot([0, 1, 2, 3, 4, 5].map(wafer));
  const drift = lot.findings.find(f => f.id === 'drift:yield');
  assert.ok(drift, 'a lot whose yield falls every wafer says so');
  assert.equal(drift.level, 'inter-wafer');
  assert.ok(!lot.findings.some(f => f.id.startsWith('inter-wafer:')), 'a steady fall is a trend, not an outlier wafer');
});

// ── The Watch tier ────────────────────────────────────────────────────────────

const driftFinding = (extra = {}) => buildDriftFindings(lotOf([84.6, 82.7, 80.5, 78.8, 77.7, 74.0]), 0.05)[0] && { ...buildDriftFindings(lotOf([84.6, 82.7, 80.5, 78.8, 77.7, 74.0]), 0.05)[0], ...extra };

const lotSummary = (over = {}) => ({
  level: 'lot', hasNotableFindings: false, findings: [],
  lotYieldSeries: [90, 90, 90, 90, 90, 90].map((y, waferIndex) => ({ waferIndex, yieldPercent: y })),
  stats: { waferCount: 6 },
  perWafer: [0, 1, 2, 3, 4, 5].map(waferIndex => ({ waferIndex, summary: { stats: { analyzedDies: 1000, totalDies: 1000, testsConsidered: [], hardBinsConsidered: [] } } })),
  ...over,
});

test('a trend goes in Watch, linked, and is not an item or an outlier wafer', () => {
  const f = driftFinding();
  const s = buildSynthesis(lotSummary({ findings: [f] }));
  assert.equal(s.items.length, 0, 'a trend costs no dies of its own');
  assert.match(s.nothing, /Nothing stands out/);
  assert.equal(s.watch.length, 1);
  assert.equal(s.watch[0].parts[0].target.id, 'drift:yield');
  assert.match(synthesisText(s), /Watch: Yield falls on successive wafers: 84\.6% → 74\.0% over 6 wafers \(input order\)/);
  assert.match(s.checked, /no outlier wafers/, 'the trend is not counted as an outlier wafer');
  assert.match(s.checked, /the yield trend across the wafers \(input order\)/);
});

test('a test with Ppk under 1.0 is watched, worst first, unless it already costs dies', () => {
  const capability = [
    { testNumber: 1, label: 'A', hasSpec: true, ppk: 0.9 },
    { testNumber: 2, label: 'B', hasSpec: true, ppk: 0.4 },
    { testNumber: 3, label: 'C', hasSpec: true, ppk: 1.6 },
    { testNumber: 4, label: 'D', hasSpec: false, ppk: null },
  ];
  const w = buildSynthesis(lotSummary({ stats: { waferCount: 6, capability } })).watch.map(x => x.parts.map(p => p.text).join(''));
  assert.deepEqual(w, ['B has Ppk 0.40 against its limits (below 1.0)', 'A has Ppk 0.90 against its limits (below 1.0)']);

  const spec = [{ testNumber: 2, label: 'B', failLowDies: 300, failHighDies: 0, totalDies: 6000, passDies: 5700, yieldPercent: 95 }];
  const again = buildSynthesis(lotSummary({ stats: { waferCount: 6, capability, testSpecYield: spec } }));
  assert.ok(!again.watch.some(x => x.parts[0].text.startsWith('B ')), 'B is an item already');
  assert.equal(again.items.length, 1);
});

test('Watch holds at most two, a trend first', () => {
  const capability = [1, 2, 3].map(i => ({ testNumber: i, label: `T${i}`, hasSpec: true, ppk: 0.5 + i / 10 }));
  const s = buildSynthesis(lotSummary({ findings: [driftFinding()], stats: { waferCount: 6, capability } }));
  assert.equal(s.watch.length, 2);
  assert.match(s.watch[0].parts.map(p => p.text).join(''), /^Yield falls/);
  assert.match(s.watch[1].parts.map(p => p.text).join(''), /^T1 has Ppk 0\.60/);
});

test('a wafer summary has no trend, but its tests can be watched', () => {
  const w = {
    level: 'wafer', hasNotableFindings: false, findings: [],
    stats: { totalDies: 1000, analyzedDies: 1000, yieldPercent: 90, testsConsidered: [], hardBinsConsidered: [], capability: [{ testNumber: 1, label: 'A', hasSpec: true, ppk: 0.7 }] },
  };
  assert.equal(buildSynthesis(w, { passBins: [1] }).watch.length, 1);
});

test('the panel and the report both show it', () => {
  const l = lotSummary({ findings: [driftFinding()] });
  const section = buildSynthesisSection(l, [1], () => {}, null);
  assert.match(section.textContent, /Watch.*Yield falls on successive wafers/i);
  const link = section.querySelector('button[data-wmap-finding="drift:yield"]');
  assert.ok(link, 'the subject links to the finding');

  const R = 8;
  const wafer = (k) => {
    const results = [];
    for (let x = -R; x <= R; x++) for (let y = -R; y <= R; y++) {
      if (Math.hypot(x, y) > R) continue;
      results.push({ x, y, hbin: ((x + 9) * 7 + (y + 9) * 13) % 100 < 6 + k * 4 ? 2 : 1 });
    }
    return buildWaferMap({ results, waferConfig: { diameter: 300, notch: { type: 'bottom' }, metadata: { lot: 'L1', waferId: `W${k}` } }, passBins: [1], ringCount: 4 });
  };
  const html = renderLotReportHtml([0, 1, 2, 3, 4, 5].map(wafer));
  assert.match(html, /<li><strong>Watch<\/strong> <a href="#finding-[^"]+">Yield<\/a> falls on successive wafers/);
  const id = /href="#(finding-[^"]+)">Yield</.exec(html)[1];
  assert.ok(html.includes(`id="${id}"`), 'the link lands on its row in the Findings table');
});
