// The Summary panel and the HTML reports show the same things the same way: one count of dies per bin
// in one order, one findings arrangement, the same statistics columns where the data supports them,
// the same labels. Each of these was two implementations that had drifted.

import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { buildWaferMap, analyzeWaferMap, analyzeWaferLot } from '../dist/index.js';
import { binCountsFrom, pooledBinCounts, binBreakdownRows, binBreakdownTitle } from '../dist/packages/stats/binRows.js';
import { arrangeFindings } from '../dist/packages/stats/filterFindings.js';
import { findingsTableHtml } from '../dist/packages/stats/reportHtml.js';
import { renderWaferReportHtml, renderLotReportHtml } from '../dist/packages/stats/renderSummaryReport.js';
import { MEAN_WAFER_YIELD_LABEL } from '../dist/packages/stats/presentation.js';

const dom = new JSDOM('<!doctype html><html><body></body></html>');
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.HTMLDivElement = dom.window.HTMLDivElement;
globalThis.Node = dom.window.Node;
const { buildBinBreakdownSection } = await import('../dist/packages/canvas-adapter/summaryPanel.js');

const die = (o) => ({ x: 0, y: 0, testValues: {}, ...o });

// ── Bins ──────────────────────────────────────────────────────────────────────

test('bin counts skip partial and edge-excluded dies, and use precomputed counts when given', () => {
  const dies = [die({ hbin: 1 }), die({ hbin: 1 }), die({ hbin: 2 }), die({ hbin: 2, partial: true }), die({ hbin: 3, edgeExcluded: true }), die({})];
  assert.deepEqual([...binCountsFrom(dies, 'hard')], [[1, 2], [2, 1]]);
  assert.deepEqual([...binCountsFrom(dies, 'hard', { 7: 5 })], [[7, 5]]);
  assert.deepEqual([...binCountsFrom(dies, 'soft')], [], 'no soft bins, no counts');
});

test('pooled counts add each wafer\'s own, and walk the dies when a wafer has none', () => {
  const sums = [{ stats: { hardBinCounts: { 1: 3, 2: 1 } } }, { stats: { hardBinCounts: { 1: 2, 9: 4 } } }];
  assert.deepEqual([...pooledBinCounts(sums, [], 'hard')].sort(), [[1, 5], [2, 1], [9, 4]]);
  const walked = pooledBinCounts([{ stats: {} }], [die({ hbin: 5 })], 'hard');
  assert.deepEqual([...walked], [[5, 1]]);
});

test('bin rows put pass bins first and then fail bins by count, with a name and share', () => {
  const rows = binBreakdownRows(new Map([[4, 30], [1, 50], [9, 20]]), [{ bin: 1, name: 'Pass' }, { bin: 9, name: 'Vmin' }], [1]);
  assert.deepEqual(rows.map(r => r.bin), [1, 4, 9]);
  assert.deepEqual(rows.map(r => r.label), ['Bin 1 · Pass', 'Bin 4', 'Bin 9 · Vmin']);
  assert.deepEqual(rows.map(r => r.percent), [50, 30, 20]);
  assert.deepEqual(rows.map(r => r.passing), [true, false, false]);
});

test('the title carries the population, on every surface', () => {
  assert.equal(binBreakdownTitle('hard', 7444), 'Hard Bin Breakdown — % of dies (N=7,444)');
  const panel = buildBinBreakdownSection({ dies: [die({ hbin: 1 }), die({ hbin: 2 })], passBins: [1] });
  assert.match(panel.textContent, /Hard Bin Breakdown — % of dies \(N=2\)/);
});

const BIN_DEFS = [{ bin: 1, name: 'Pass' }, { bin: 2, name: 'Leakage' }];
const wafer = (tag, withSoft = true) => {
  const results = [];
  for (let x = -9; x <= 9; x++) for (let y = -9; y <= 9; y++) {
    if (Math.hypot(x, y) > 9) continue;
    const hbin = (x * 3 + y * 5 + tag) % 7 === 0 ? 2 : 1;
    results.push({ x, y, hbin, ...(withSoft ? { sbin: hbin * 10 + ((x + y) & 1) } : {}), testValues: { 1: 100 + x * 2 + (tag % 3), 2: 50 + y } });
  }
  return buildWaferMap({
    results, waferConfig: { diameter: 300, notch: { type: 'bottom' }, metadata: { lot: 'L1', waferId: `W${tag}` } },
    hbinDefs: BIN_DEFS, passBins: [1], ringCount: 4,
    testDefs: [{ testNumber: 1, name: 'VTH', unit: 'mV', limitLow: 60, limitHigh: 130 }, { testNumber: 2, name: 'IDS', unit: 'uA' }],
  });
};

test('the reports show hard and soft breakdowns when both exist, as the panel\'s selector offers', () => {
  const html = renderWaferReportHtml(wafer(1), analyzeWaferMap(wafer(1), { enableTestValueAnalysis: true }));
  assert.match(html, /Hard Bin Breakdown — % of dies \(N=\d+\)/);
  assert.match(html, /Soft Bin Breakdown — % of dies \(N=\d+\)/);
  const lot = renderLotReportHtml([1, 2, 3].map(t => wafer(t)));
  assert.match(lot, /Hard Bin Breakdown — % of dies/);
  assert.match(lot, /Soft Bin Breakdown — % of dies/);
  assert.match(lot, /<th>Bin<\/th><th>Name<\/th><th>Dies<\/th><th>Share<\/th>/, 'one set of columns, wafer and lot');
});

// ── Labels ────────────────────────────────────────────────────────────────────

test('the lot reports and the panel name the unweighted mean the same way', () => {
  assert.equal(MEAN_WAFER_YIELD_LABEL, 'Mean per-wafer yield');
  assert.match(renderLotReportHtml([1, 2, 3].map(t => wafer(t))), /Mean per-wafer yield/);
});

// ── Test values ───────────────────────────────────────────────────────────────

test('the wafer report\'s Test Values carries the panel\'s full columns, and limit yield for a limited test', () => {
  const m = wafer(1);
  const html = renderWaferReportHtml(m, analyzeWaferMap(m, { enableTestValueAnalysis: true }));
  const heads = /<h2>Test Values<\/h2>[\s\S]*?<thead><tr>(.*?)<\/tr><\/thead>/.exec(html)[1];
  const cols = [...heads.matchAll(/<th>(.*?)<\/th>/g)].map(x => x[1]);
  assert.deepEqual(cols, ['Test', 'N', 'Min', 'Q1', 'Median', 'Mean', 'Q3', 'Max', 'StdDev', 'Limit yield']);
});

test('the same columns appear when the report has no precomputed analysis: described from the dies', () => {
  const m = wafer(1);
  const html = renderWaferReportHtml(m, undefined);
  assert.match(html, /<th>Q1<\/th><th>Median<\/th>/);
});

test('a lot\'s Test Values has N, StdDev and limit yield, and says why it has no quartiles', () => {
  const maps = [1, 2, 3].map(t => wafer(t));
  const html = renderLotReportHtml(maps, { analyzeOptions: { enableTestValueAnalysis: true } });
  const heads = /<h2>Test Values<\/h2>[\s\S]*?<thead><tr>(.*?)<\/tr><\/thead>/.exec(html)[1];
  const cols = [...heads.matchAll(/<th>(.*?)<\/th>/g)].map(x => x[1]);
  assert.deepEqual(cols, ['Test', 'N', 'Min', 'Mean', 'Max', 'StdDev', 'Limit yield']);
  assert.match(html, /Quartiles are not shown for a lot/);
});

test('a lot\'s pooled StdDev equals the one computed over every die', () => {
  const maps = [1, 2, 3].map(t => wafer(t));
  const html = renderLotReportHtml(maps, { analyzeOptions: { enableTestValueAnalysis: true } });
  const values = maps.flatMap(m => m.dies.map(d => d.testValues[1])).filter(v => v !== undefined);
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const sd = Math.sqrt(values.reduce((a, v) => a + (v - mean) ** 2, 0) / values.length);
  const row = /<td>VTH<\/td>(.*?)<\/tr>/.exec(html)[1];
  const cells = [...row.matchAll(/<td[^>]*>(.*?)<\/td>/g)].map(x => x[1]);
  // N, Min, Mean, Max, StdDev  — the figure is formatted with its unit, so compare the number
  assert.equal(Number(cells[0]), values.length);
  const printed = parseFloat(cells[4].replace(/[^\d.\-]/g, ''));
  assert.ok(Math.abs(printed - sd) < Math.max(0.05, sd * 0.01), `pooled σ ${printed} vs ${sd}`);
});

// ── Findings arrangement ──────────────────────────────────────────────────────

const finding = (id, family, left, severity, extra = {}) => ({
  id, level: 'wafer', severity, variable: { kind: 'yield', label: 'Yield' },
  comparison: { family, left, right: 'rest' }, effect: { direction: 'lower', absoluteDelta: -0.1 },
  stats: { method: 'x', sampleSizeLeft: 10, sampleSizeRight: 90 }, summary: id, highlight: { kind: 'region', regionFamily: 'ring', regionKeys: [] }, ...extra,
});

test('a pattern leads with the findings it explains beneath it, then groups by region, most severe first', () => {
  const list = [
    finding('a', 'quadrant', 'NE', 'info'),
    finding('b', 'ring', 'Ring 4', 'notable'),
    finding('p', 'spatial-pattern', 'Edge-ring', 'unusual', { relatedIds: ['b', 'gone'] }),
    finding('c', 'quadrant', 'NE', 'unusual'),
    finding('d', 'sector', 'N', 'notable', { absorbedIds: ['e'] }),
    finding('e', 'sector', 'N', 'info'),
  ];
  const arranged = arrangeFindings(list);
  assert.deepEqual(arranged.patterns.map(p => [p.finding.id, p.children.map(c => c.id)]), [['p', ['b']]]);
  assert.deepEqual(arranged.groups.map(g => [g.left, g.worst, g.findings.map(f => f.id)]), [
    ['NE', 'unusual', ['c', 'a']],      // worst group first; within it, most severe first
    ['N', 'notable', ['d']],            // 'e' is absorbed by 'd' and not repeated
  ]);
});

test('the report table nests what a pattern explains and keeps the panel\'s order', () => {
  const list = [
    finding('a', 'quadrant', 'NE', 'info'),
    finding('b', 'ring', 'Ring 4', 'notable'),
    finding('p', 'spatial-pattern', 'Edge-ring', 'unusual', { relatedIds: ['b'] }),
    finding('c', 'quadrant', 'NE', 'unusual'),
  ];
  const html = findingsTableHtml(list, undefined, '');
  const ids = [...html.matchAll(/<tr class="tier-\w+( nested)?" id="finding-([^"]+)"/g)].map(m => [m[2], !!m[1]]);
  assert.deepEqual(ids, [['p', false], ['b', true], ['c', false], ['a', false]]);
});
