// Yield rows read against their reference, shared by the HTML reports and the Summary panel: one
// computation of the median, each wafer's difference from it, the shortfall tint and the outlier
// words, so the two surfaces cannot disagree about the same wafer.

import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { waferYieldRows, regionYieldRows } from '../dist/packages/stats/yieldRows.js';
import { shortfallStep, formatPoints, filledDots, SEVERITY_MARK, impactWord, shortfallColor } from '../dist/packages/stats/presentation.js';
import { renderLotReportHtml } from '../dist/packages/stats/renderSummaryReport.js';
import { buildWaferMap } from '../dist/index.js';

const dom = new JSDOM('<!doctype html><html><body></body></html>');
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.HTMLDivElement = dom.window.HTMLDivElement;
globalThis.Node = dom.window.Node;
const { buildPerWaferYieldSection, buildRegionYieldPanelSection } = await import('../dist/packages/canvas-adapter/summaryPanel.js');

test('shortfall steps: tinted from one point below, never above', () => {
  assert.deepEqual([0.5, 0, -0.9, -1, -1.9, -2, -3.9, -4, -20, 5].map(shortfallStep), [0, 0, 0, 1, 1, 2, 2, 3, 3, 0]);
});

test('points are signed with a true minus sign', () => {
  assert.equal(formatPoints(1.234), '+1.2');
  assert.equal(formatPoints(-1.234), '−1.2');
  assert.equal(formatPoints(0), '0.0');
});

test('severity and impact are marked the same way on every surface', () => {
  assert.deepEqual([3, 2, 1], ['high', 'medium', 'low'].map(filledDots));
  assert.deepEqual(Object.values(SEVERITY_MARK).map(m => m.word), ['Unusual', 'Notable', 'Minor']);
  assert.deepEqual(['high', 'medium', 'low'].map(impactWord), ['High impact', 'Moderate impact', 'Low impact']);
});

test('wafers are read against the median, with the lot rule naming the outliers', () => {
  const { rows, median } = waferYieldRows([92, 93, 92.5, 94, 93.5, 92.8, 20].map(y => ({ yieldPercent: y })));
  assert.equal(median, 92.8);
  const low = rows.find(r => r.yieldPercent === 20);
  assert.equal(low.outlier, 'low');
  assert.equal(low.step, 3);
  assert.equal(rows.filter(r => r.outlier).length, 1, 'only the clear outlier is named');
  assert.equal(rows.find(r => r.yieldPercent === 94).step, 0, 'a wafer above the median is never tinted');
});

test('a tint follows the size of the shortfall and the word follows the statistics, so they can differ', () => {
  // tight lot: the lowest wafer is 1.2 points under the median (tinted) but not a statistical outlier
  const { rows } = waferYieldRows([93, 93.2, 93.1, 93.3, 91.9].map(y => ({ yieldPercent: y })));
  const lowest = rows.find(r => r.yieldPercent === 91.9);
  assert.equal(lowest.step, 1);
  assert.equal(lowest.outlier, undefined);
});

test('regions are read against the die-weighted yield of everything they divide', () => {
  const data = [
    { key: 'a', label: 'A', n: 100, passDies: 50, yieldPercent: 50 },
    { key: 'b', label: 'B', n: 300, passDies: 270, yieldPercent: 90 },
  ];
  const { rows, overall } = regionYieldRows(data);
  assert.equal(overall, 80);                       // 320 / 400, not the mean of 50 and 90
  assert.deepEqual(rows.map(r => r.delta), [-30, 10]);
  assert.deepEqual(rows.map(r => r.step), [3, 0]);
});

// ── The panel reads the same rows ───────────────────────────────────────────

const waferWith = (tag, failEdge, extra = {}, bad = false) => {
  const results = [];
  for (let x = -9; x <= 9; x++) for (let y = -9; y <= 9; y++) {
    const r = Math.hypot(x, y);
    if (r > 9) continue;
    results.push({ x, y, hbin: bad && (x * 3 + y * 5 + tag) % 10 < 5 ? 2 : failEdge && r > 7.4 ? 2 : (x * 7 + y * 13 + tag) % 41 === 0 ? 3 : 1 });
  }
  return buildWaferMap({ results, waferConfig: { diameter: 300, notch: { type: 'bottom' }, metadata: { lot: 'L1', wafer: `W${tag}` } }, passBins: [1], ringCount: 4, ...extra });
};


const lotOf = (yields) => ({
  level: 'lot', hasNotableFindings: false, findings: [],
  lotYieldSeries: yields.map((y, i) => ({ waferIndex: i, yieldPercent: y })),
  stats: { waferCount: yields.length },
  perWafer: yields.map((y, i) => ({ waferIndex: i, summary: { stats: { yieldPercent: y, totalDies: 100, analyzedDies: 100, testsConsidered: [], hardBinsConsidered: [] } } })),
});

test('the panel prints each wafer\'s difference from the median and tints a shortfall', () => {
  const yields = [92, 93, 92.5, 94, 93.5, 92.8, 20];
  const section = buildPerWaferYieldSection(lotOf(yields), yields.map((_, i) => ({ label: `W${i + 1}` })));
  const text = section.textContent;
  assert.match(text, /20\.0%−72\.8/, 'the outlier row shows its figure and its difference');
  assert.match(text, /94\.0%\+1\.2/);
  assert.match(text, /W7 · low outlier/);
  const tinted = [...section.querySelectorAll('div')].filter(d => d.style.background.includes(shortfallColor(3)));
  assert.equal(tinted.length, 1, 'exactly the one outlier is tinted at the strongest step');
});

test('the panel reads regions against the wafer, as the report does', () => {
  const map = waferWith(1, true);
  const section = buildRegionYieldPanelSection({
    diesByWafer: [map.dies], allWafers: [map.wafer], ringCount: 4, passBins: [1],
  });
  // Ring 4 (the failing edge) is far below the wafer, so it carries a negative difference and a tint
  assert.match(section.textContent, /Ring 4 \(edge\) \(N=\d+\)\d+\.\d%−\d+\.\d/);
  const tinted = [...section.querySelectorAll('div')].filter(d => d.style.background.includes('rgba(190, 60, 60'));
  assert.ok(tinted.length >= 1, 'the shortfall ring is tinted');
});

// ── The report says the same, and draws bins in the map's colours ────────────

test('the lot report says "low outlier" in words, as the panel does', () => {
  const maps = [1, 2, 3, 4, 5].map(t => waferWith(t, false));
  maps.push(waferWith(9, false, {}, true));
  const html = renderLotReportHtml(maps);
  assert.match(html, /Wafer 6[^<]* · low outlier/);
  assert.equal((html.match(/low outlier/g) ?? []).length, 1, 'only the one wafer');
  assert.match(html, /<td class="numeric low-3">−\d+\.\d<\/td>/, 'and its shortfall is tinted at the strongest step');
});

test('report bin bars are drawn in the colour the map gives that bin', () => {
  const maps = [1, 2, 3].map(t => waferWith(t, true));
  const colors = { hard: new Map([[1, '#123456'], [2, '#abcdef'], [3, '#fedcba']]), soft: new Map(), shared: { hard: [], soft: [] }, pass: { hard: new Set([1]), soft: new Set() } };
  const html = renderLotReportHtml(maps, { binColors: colors });
  assert.match(html, /background:#abcdef/, 'bin 2 is its map colour');
  assert.match(html, /background:#123456/, 'bin 1 is its map colour');
});

test('without live colours the report resolves the default palette for each bin', () => {
  const html = renderLotReportHtml([1, 2, 3].map(t => waferWith(t, true)));
  assert.match(html, /<i style="width:[\d.]+%;background:[^"]+"><\/i>/);
});
