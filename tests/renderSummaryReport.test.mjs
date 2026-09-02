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

test('renderLotSummaryReportHtml — split comparison appears when a field actually splits the lot', () => {
  const items = [
    waferItem('W1', [1, 1, 2], undefined, { split: 'TT' }),
    waferItem('W2', [1, 2, 2], undefined, {}),
  ];
  const html = renderLotSummaryReportHtml({ items, testDefs: [] });
  // Was a roster listing each wafer against `metadata.split`; it compared nothing
  // and only ever recognised a key literally named `split`. Facets are now
  // discovered the same way the Insights "Group by" control discovers them.
  assert.ok(html.includes('Split Comparison'));
  assert.ok(html.includes('TT'));
  // The comparison itself: yield per arm, not just a membership list.
  assert.ok(html.includes('Yield'));
});

test('renderLotSummaryReportHtml — split comparison finds a field NOT named "split"', () => {
  const items = [
    waferItem('W1', [1, 1, 2], undefined, { processSplit: 'POR' }),
    waferItem('W2', [1, 2, 2], undefined, { processSplit: 'Hi-dose' }),
  ];
  const html = renderLotSummaryReportHtml({ items, testDefs: [] });
  assert.ok(html.includes('Split Comparison'));
  assert.ok(html.includes('POR'));
  assert.ok(html.includes('Hi-dose'));
  // And it labels the field readably rather than printing the raw key.
  assert.ok(html.includes('Process Split'), 'uncurated facet keys are prettified');
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

test('report includes a Functional Tests section with pass rates; functional tests stay out of Test Values', () => {
  const testDefs = [
    { testNumber: 1050, name: 'Idsat', unit: 'A' },
    { testNumber: 2001, name: 'scan_chain', testType: 'F' },
  ];
  const built = buildWaferMap({
    results: [
      { x: 0, y: 0, hbin: 1, testValues: { 1050: 1.0 }, testPass: { 2001: true } },
      { x: 1, y: 0, hbin: 1, testValues: { 1050: 2.0 }, testPass: { 2001: false } },
      { x: 0, y: 1, hbin: 2, testValues: { 1050: 3.0 }, testPass: { 2001: true } },
    ],
    waferConfig: { diameter: 300 },
    dieConfig: { width: 10, height: 10 },
    passBins: [1],
    testDefs,
  });
  const html = renderSummaryReportHtml({
    wafer: built.wafer,
    dies: built.dies,
    yieldSummary: built.yield,
    dataCoverage: dataCoverageOf(built),
    testDefs,
  });
  assert.match(html, /Functional Tests/);
  assert.match(html, /scan_chain/);
  assert.match(html, /66\.7%/);
  // scan_chain must not appear in the parametric Test Values table (min/mean/max).
  const testValuesSection = html.split('Functional Tests')[0];
  assert.doesNotMatch(testValuesSection.split('Test Values')[1] ?? '', /scan_chain/);
});

// ── Bin ordering is shared with the Summary panel ────────────────────────────
//
// Before `sortBinsForDisplay` existed, this ordering was implemented three times
// — the panel's bin section and both of this file's bin tables — all ascending by
// bin number, and none agreeing with `buildBinParetoData`'s count-descending
// order in the Insights bin chart. The same wafer therefore listed its bins in
// one order in the chart and another in the panel and the report.

test('renderSummaryReportHtml — bin table is pass-first then descending by count, matching the panel', () => {
  // bin 1 ×2 (pass), bin 9 ×5, bin 4 ×3. Ascending-by-number would give 1, 4, 9.
  const hbins = [1, 1, 9, 9, 9, 9, 9, 4, 4, 4];
  const built = waferItem('W1', hbins);
  const html = renderSummaryReportHtml({
    wafer: built.wafer,
    dies: built.dies,
    yieldSummary: built.yield,
    dataCoverage: dataCoverageOf(built),
    hbinDefs: [{ bin: 1, name: 'Pass' }, { bin: 4, name: 'Fail A' }, { bin: 9, name: 'Fail B' }],
    passBins: [1],
  });
  const table = html.slice(html.indexOf('Hard Bin Breakdown'));
  const order = ['Pass', 'Fail B', 'Fail A'].map(n => table.indexOf(n));
  assert.ok(order.every(i => i >= 0), `expected all three bins in the table: ${order}`);
  assert.deepEqual([...order].sort((a, b) => a - b), order,
    'pass bin first, then failing bins by descending count');
});

test('renderLotSummaryReportHtml — the pooled bin table uses the same order', () => {
  const items = [
    waferItem('W1', [1, 1, 9, 9, 9, 4]),
    waferItem('W2', [1, 9, 9, 4, 4]),
  ];
  const html = renderLotSummaryReportHtml({
    items,
    hbinDefs: [{ bin: 1, name: 'Pass' }, { bin: 4, name: 'Fail A' }, { bin: 9, name: 'Fail B' }],
    passBins: [1],
  });
  // pooled: bin 1 ×3 (pass), bin 9 ×5, bin 4 ×3
  const table = html.slice(html.indexOf('Hard Bin Breakdown (All Wafers)'));
  const order = ['Pass', 'Fail B', 'Fail A'].map(n => table.indexOf(n));
  assert.ok(order.every(i => i >= 0), `expected all three bins in the pooled table: ${order}`);
  assert.deepEqual([...order].sort((a, b) => a - b), order);
});

// ── Findings are de-duplicated, matching the panel and the findings report ──

test('the summary report does not print a merged finding and the row it absorbed', async () => {
  const { buildWaferMap } = await import('../dist/packages/renderer/buildWaferMap.js');
  const { analyzeWaferMap } = await import('../dist/packages/stats/analyzeWaferMap.js');

  // Soft bins mirroring hard bins exactly, so every bin finding has a twin over
  // the identical dies and gets merged into one labelled row.
  const R = 12;
  const results = [];
  for (let x = -R; x <= R; x++) {
    for (let y = -R; y <= R; y++) {
      if (Math.hypot(x, y) > R) continue;
      const edge = Math.hypot(x, y) > R * 0.82;
      const hbin = edge ? ((x + y) % 2 === 0 ? 2 : 3) : 1;
      results.push({ x, y, hbin, sbin: hbin });
    }
  }
  const binDefs = [{ bin: 1, name: 'Pass' }, { bin: 2, name: 'F1' }, { bin: 3, name: 'F2' }];
  const res = buildWaferMap({
    results, waferConfig: { diameter: 300, notch: { type: 'bottom' } },
    hbinDefs: binDefs, sbinDefs: binDefs, passBins: [1],
  });
  const statsSummary = analyzeWaferMap(res);
  const absorbed = new Set(statsSummary.findings.flatMap(f => f.absorbedIds ?? []));
  assert.ok(absorbed.size > 0, 'fixture must actually produce merged twins');

  const html = renderSummaryReportHtml({
    wafer: res.wafer, dies: res.dies, yieldSummary: res.yield,
    dataCoverage: { filledDies: res.dies.length, totalDies: res.dies.length, edgeExcludedDies: 0, ratio: 1 },
    hbinDefs: res.hbinDefs, sbinDefs: res.sbinDefs, statsSummary, passBins: [1],
  });

  // Each merged row's label already names the soft bin it absorbed; printing the
  // absorbed row too states the same fact twice and contradicts the merge.
  const rows = (html.match(/<tr title=/g) ?? []).length;
  assert.equal(rows, statsSummary.findings.length - absorbed.size);
});

test('the lot report carries per-wafer findings, and states how many wafers had any', async () => {
  const { buildWaferMap } = await import('../dist/packages/renderer/buildWaferMap.js');
  const { analyzeWaferMap } = await import('../dist/packages/stats/analyzeWaferMap.js');

  // Two wafers with a clean edge-yield loss, two without.
  const mk = (edgeFail) => {
    const R = 10;
    const results = [];
    for (let x = -R; x <= R; x++) {
      for (let y = -R; y <= R; y++) {
        if (Math.hypot(x, y) > R) continue;
        const edge = Math.hypot(x, y) > R * 0.8;
        results.push({ x, y, hbin: edgeFail && edge ? 2 : 1 });
      }
    }
    const r = buildWaferMap({
      results, waferConfig: { diameter: 300, notch: { type: 'bottom' } }, passBins: [1],
      hbinDefs: [{ bin: 1, name: 'Pass' }, { bin: 2, name: 'Fail' }],
    });
    return { ...r, statsSummary: analyzeWaferMap(r) };
  };
  const items = [
    { ...mk(true), label: 'W01' }, { ...mk(false), label: 'W02' },
    { ...mk(true), label: 'W03' }, { ...mk(false), label: 'W04' },
  ];

  const html = renderLotSummaryReportHtml({ items, testDefs: [], passBins: [1] });

  // This section is why the separate "Findings report" button could go away: it
  // was the only place per-wafer findings were reachable, and it existed on some
  // panel paths and not others.
  assert.ok(html.includes('Findings by Wafer'), 'per-wafer findings must be in the one report');
  // The denominator is stated — without it, the wafers absent from this section
  // read as "not analysed" rather than "clean".
  assert.match(html, /\d of 4 wafers have per-wafer findings/);
});
