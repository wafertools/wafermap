import test from 'node:test';
import assert from 'node:assert/strict';
import { buildWaferMap } from '../dist/packages/renderer/buildWaferMap.js';
import { analyzeWaferMap } from '../dist/packages/stats/analyzeWaferMap.js';
import { renderLotSummaryReportHtml, renderSummaryReportHtml } from '../dist/packages/stats/renderSummaryReport.js';

function waferItem(label, hbins, testValues, metadata) {
  const results = hbins.map((bin, i) => ({ x: i, y: 0, hbin: bin, testValues: testValues ? { 1: testValues[i] } : undefined }));
  const built = buildWaferMap({
    results,
    waferConfig: { diameter: 300, metadata },
    dieConfig: { width: 10, height: 10 },
    passBins: [1],
  });
  const statsSummary = analyzeWaferMap(built);
  return { ...built, label, statsSummary };
}

function dataCoverageOf(built) {
  return { filledDies: built.dies.length, totalDies: built.dies.length, edgeExcludedDies: built.yield.edgeExcludedDies, ratio: 1 };
}

const testDefsWithLimits = [{ testNumber: 1, name: 'Vt', unit: 'mV', limitLow: 0, limitHigh: 10 }];
const testDefsNoLimits = [{ testNumber: 1, name: 'Vt', unit: 'mV' }];

test('renderLotSummaryReportHtml — Process Capability section appears when a test has both limits', () => {
  const items = [waferItem('W1', [1, 1, 2], [3, 5, 7])];
  const html = renderLotSummaryReportHtml({ items, testDefs: testDefsWithLimits });
  assert.ok(html.includes('Process Capability'));
  assert.ok(html.includes('Cpk'));
});

test('renderLotSummaryReportHtml — Process Capability section still appears (with "—" spec) when no test has both limits', () => {
  const items = [waferItem('W1', [1, 1, 2], [3, 5, 7])];
  const html = renderLotSummaryReportHtml({ items, testDefs: testDefsNoLimits });
  assert.ok(html.includes('Process Capability'));
  assert.ok(html.includes('Vt'));
});

test('renderLotSummaryReportHtml — Process Capability section absent when no parametric test has any recorded values', () => {
  const items = [waferItem('W1', [1, 1, 2])];
  const html = renderLotSummaryReportHtml({ items, testDefs: testDefsNoLimits });
  assert.ok(!html.includes('Process Capability'));
});

test('renderLotSummaryReportHtml — Splits section appears when an item has a split assigned', () => {
  const items = [
    waferItem('W1', [1, 1, 2], undefined, { split: 'TT' }),
    waferItem('W2', [1, 2, 2], undefined, {}),
  ];
  const html = renderLotSummaryReportHtml({ items, testDefs: [] });
  assert.ok(html.includes('Splits'));
  assert.ok(html.includes('TT'));
});

test('renderLotSummaryReportHtml — Splits section absent when no item has a split', () => {
  const items = [waferItem('W1', [1, 1, 2])];
  const html = renderLotSummaryReportHtml({ items, testDefs: [] });
  assert.ok(!html.includes('>Splits<'));
});

test('renderLotSummaryReportHtml — uniform lot produces a single <main> and no group banner', () => {
  const items = [
    waferItem('W1', [1, 1, 2], undefined, { lot: 'LOT-A' }),
    waferItem('W2', [1, 2, 2], undefined, { lot: 'LOT-A' }),
  ];
  const html = renderLotSummaryReportHtml({ items, testDefs: [] }, { title: 'My Report' });
  assert.equal((html.match(/<main class="report">/g) ?? []).length, 1);
  assert.ok(!html.includes('spans'));
  assert.ok(html.includes('My Report'));
});

test('renderLotSummaryReportHtml — heterogeneous lot ids produce N <main> blocks with a banner', () => {
  const items = [
    waferItem('W1', [1, 1, 2], undefined, { lot: 'LOT-A' }),
    waferItem('W2', [1, 2, 2], undefined, { lot: 'LOT-B' }),
  ];
  const html = renderLotSummaryReportHtml({ items, testDefs: [] }, { title: 'Lot Report' });
  assert.equal((html.match(/<main class="report">/g) ?? []).length, 2);
  assert.ok(html.includes('spans 2 groups'));
  assert.ok(html.includes('Lot Report — LOT-A'));
  assert.ok(html.includes('Lot Report — LOT-B'));
  // Only one shared <style> block, not duplicated per group.
  assert.equal((html.match(/<style>/g) ?? []).length, 1);
});

test('renderLotSummaryReportHtml — heterogeneous product (not just lot) also triggers grouping', () => {
  const items = [
    waferItem('W1', [1, 1, 2], undefined, { product: 'PROD-X' }),
    waferItem('W2', [1, 2, 2], undefined, { product: 'PROD-Y' }),
  ];
  const html = renderLotSummaryReportHtml({ items, testDefs: [] });
  assert.equal((html.match(/<main class="report">/g) ?? []).length, 2);
});

test('renderLotSummaryReportHtml — split varying alone does NOT trigger grouping (compared within one report)', () => {
  const items = [
    waferItem('W1', [1, 1, 2], undefined, { split: 'TT' }),
    waferItem('W2', [1, 2, 2], undefined, { split: 'FF' }),
  ];
  const html = renderLotSummaryReportHtml({ items, testDefs: [] });
  assert.equal((html.match(/<main class="report">/g) ?? []).length, 1);
  assert.ok(!html.includes('spans'));
});

test('renderLotSummaryReportHtml — each group only shows its own capability/splits data, not leaked across groups', () => {
  const items = [
    waferItem('W1', [1, 1, 2], [3, 5, 7], { lot: 'LOT-A', split: 'TT' }),
    waferItem('W2', [1, 2, 2], [4, 6, 8], { lot: 'LOT-B' }),
  ];
  const html = renderLotSummaryReportHtml({ items, testDefs: testDefsWithLimits });
  const aIndex = html.indexOf('LOT-A');
  const bIndex = html.indexOf('LOT-B');
  const groupA = html.slice(aIndex, bIndex);
  const groupB = html.slice(bIndex);
  assert.ok(groupA.includes('TT'));
  assert.ok(!groupB.includes('TT'));
});

test('renderSummaryReportHtml (single-wafer) — gets a Process Capability section but never a Splits section', () => {
  const built = buildWaferMap({
    results: [1, 1, 2].map((bin, i) => ({ x: i, y: 0, hbin: bin, testValues: { 1: [3, 5, 7][i] } })),
    waferConfig: { diameter: 300, metadata: { split: 'TT' } },
    dieConfig: { width: 10, height: 10 },
    passBins: [1],
  });
  const html = renderSummaryReportHtml({
    wafer: built.wafer,
    dies: built.dies,
    yieldSummary: built.yield,
    dataCoverage: dataCoverageOf(built),
    testDefs: testDefsWithLimits,
  });
  assert.ok(html.includes('Process Capability'));
  assert.ok(!html.includes('>Splits<'));
});
