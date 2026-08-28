import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>');
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.HTMLDivElement = dom.window.HTMLDivElement;
globalThis.Node = dom.window.Node;

const { buildBinSection, buildTestSection, buildLotTestSection, buildCompactMetadataRows, buildMetadataStripRow, buildMetadataStripBox, metadataEntries, renderWaferSummaryContent, renderLotSummaryContent } =
  await import('../dist/packages/canvas-adapter/summaryPanel.js');

function die(overrides) {
  return { x: 0, y: 0, testValues: {}, ...overrides };
}

function wafer(overrides) {
  return { diameter: 300, radius: 150, center: { x: 0, y: 0 }, orientation: 0, ...overrides };
}

test('buildBinSection — precomputed counts produce the same text as the raw-scan fallback', () => {
  const dies = [
    die({ hbin: 1 }), die({ hbin: 1 }), die({ hbin: 2 }),
    die({ hbin: 1, partial: true }), // excluded from both paths
  ];
  const fallback = buildBinSection(dies, undefined, 'hard');
  const precomputed = buildBinSection(dies, undefined, 'hard', { 1: 2, 2: 1 });
  assert.equal(fallback.textContent, precomputed.textContent);
});

test('buildBinSection — precomputed counts are used even when they disagree with dies (proves the fast path is taken)', () => {
  const dies = [die({ hbin: 1 })];
  const section = buildBinSection(dies, undefined, 'hard', undefined, { 1: 999 });
  assert.match(section.textContent, /999/);
});

test('buildTestSection — precomputed perTestStats/testSpecYield produce the same text as the raw-scan fallback', () => {
  const dies = [
    die({ testValues: { 1050: 1 } }),
    die({ testValues: { 1050: 3 } }),
    die({ testValues: { 1050: 5 } }),
  ];
  const testDefs = [{ testNumber: 1050, name: 'Idsat', unit: 'A', limitLow: 0, limitHigh: 10 }];
  const fallback = buildTestSection(dies, testDefs);
  const precomputed = buildTestSection(dies, testDefs, undefined, {
    perTestStats: [{ testNumber: 1050, min: 1, max: 5, mean: 3, count: 3 }],
    testSpecYield: [{ testNumber: 1050, totalDies: 3, yieldPercent: 100 }],
  });
  assert.equal(fallback.textContent, precomputed.textContent);
});

test('buildTestSection — falls back per-test when a test is missing from precomputed data', () => {
  const dies = [die({ testValues: { 1050: 1 } }), die({ testValues: { 1060: 2 } })];
  const testDefs = [
    { testNumber: 1050, name: 'Idsat' },
    { testNumber: 1060, name: 'Vth' },
  ];
  // Only 1050 is precomputed — 1060 must still render via the raw scan.
  const section = buildTestSection(dies, testDefs, undefined, {
    perTestStats: [{ testNumber: 1050, min: 1, max: 1, mean: 1, count: 1 }],
  });
  assert.match(section.textContent, /Idsat/);
  assert.match(section.textContent, /Vth/);
});

test('metadataEntries — drops null/undefined/empty-string values, keeps everything else stringified', () => {
  const entries = metadataEntries({ lot: 'LOT123', waferId: 5, temperature: undefined, split: null, note: '' });
  assert.deepEqual(entries, [['lot', 'LOT123'], ['waferId', '5']]);
});

test('metadataEntries — empty input returns an empty array', () => {
  assert.deepEqual(metadataEntries({}), []);
});

test('buildCompactMetadataRows — returns null for a metadata object with nothing displayable', () => {
  assert.equal(buildCompactMetadataRows({ note: '', temperature: undefined }), null);
});

test('buildCompactMetadataRows — one field per line', () => {
  const meta = { lot: 'LOT123', waferId: 'W01' };
  const compact = buildCompactMetadataRows(meta);
  assert.equal(compact.children.length, 2, 'one row per field');
  assert.match(compact.textContent, /LOT123/);
  assert.match(compact.textContent, /W01/);
});

test('buildMetadataStripRow — returns null for no items and no stacked context', () => {
  assert.equal(buildMetadataStripRow([]), null);
  assert.equal(buildMetadataStripRow([{ metadata: {} }]), null);
});

test('buildMetadataStripRow — a field that varies across items shows every distinct value, not just the first item\'s (the gallery-vs-Insights metadata bug)', () => {
  const items = [
    { metadata: { lot: 'LOT123', split: 'TT' } },
    { metadata: { lot: 'LOT123', split: 'FF' } },
    { metadata: { lot: 'LOT123', split: 'FS' } },
  ];
  const row = buildMetadataStripRow(items);
  assert.match(row.textContent, /Lot: LOT123/);
  // `split` is curated first (DEFAULT_FACET_CURATION), and its 3 same-coverage
  // values sort alphabetically — not insertion order, so this is "FF, FS, TT".
  assert.match(row.textContent, /Split: FF, FS, TT/);
  assert.doesNotMatch(row.textContent, /^Split: TT$/m, 'must not collapse to only the first item\'s value');
});

test('buildMetadataStripRow — stacked context prefixes "N wafers stacked" even with no metadata', () => {
  const row = buildMetadataStripRow([], { lotSize: 5, aggrMethod: 'mean' });
  assert.match(row.textContent, /5 wafers stacked · mean/);
});

test('buildMetadataStripBox — null for empty input, otherwise wraps the row in boxed chrome', () => {
  assert.equal(buildMetadataStripBox([]), null);
  const box = buildMetadataStripBox([{ metadata: { lot: 'LOT123' } }]);
  assert.match(box.textContent, /Lot: LOT123/);
  assert.equal(box.style.border !== '', true, 'has boxed chrome, unlike the bare row');
});

test('buildFunctionalTestSection — pass-rate rows from recorded verdicts and legacy 0/1 data', async () => {
  const { buildFunctionalTestSection } = await import('../dist/packages/canvas-adapter/summaryPanel.js');
  const defs = [
    { testNumber: 1050, name: 'Idsat' },
    { testNumber: 2001, name: 'scan_chain', testType: 'F' },
    { testNumber: 2002, name: 'bist', testType: 'F' },
  ];
  const dies = [
    die({ testPass: { 2001: true },  testValues: { 1050: 1, 2002: 1 } }),
    die({ testPass: { 2001: false }, testValues: { 1050: 2, 2002: 0 } }),
    die({ testPass: { 2001: true },  testValues: { 1050: 3 } }),          // no bist verdict
    die({ testPass: { 2001: true },  testValues: { 2002: 1 }, partial: true }), // excluded
  ];
  const section = buildFunctionalTestSection(dies, defs);
  assert.ok(section, 'section renders when functional defs exist');
  assert.match(section.textContent, /Functional Tests/);
  assert.match(section.textContent, /scan_chain/);
  assert.match(section.textContent, /bist/);
  // scan_chain: 3 verdicts, 2 pass → 66.7% (N=3)
  assert.match(section.textContent, /66\.7% \(N=3\)/);
  // bist (legacy 0/1): 2 verdicts, 1 pass → 50.0% (N=2)
  assert.match(section.textContent, /50\.0% \(N=2\)/);
  // parametric test never appears
  assert.doesNotMatch(section.textContent, /Idsat/);
});

test('buildFunctionalTestSection — null without functional defs; precomputed rows win', async () => {
  const { buildFunctionalTestSection } = await import('../dist/packages/canvas-adapter/summaryPanel.js');
  assert.equal(buildFunctionalTestSection([die({ testValues: { 1050: 1 } })], [{ testNumber: 1050, name: 'Idsat' }]), null);

  const precomputed = [{ testNumber: 2001, label: 'scan_chain', passDies: 90, failDies: 10, totalDies: 100, passRatePercent: 90 }];
  const section = buildFunctionalTestSection([], [{ testNumber: 2001, name: 'scan_chain', testType: 'F' }], precomputed);
  assert.match(section.textContent, /90\.0% \(N=100\)/);
});

test('buildLotFunctionalSection — pools per-wafer functionalYield counts exactly', async () => {
  const { buildLotFunctionalSection } = await import('../dist/packages/canvas-adapter/summaryPanel.js');
  const defs = [{ testNumber: 2001, name: 'scan_chain', testType: 'F' }];
  const mkSummary = (passDies, failDies) => ({
    stats: { functionalYield: [{ testNumber: 2001, label: 'scan_chain', passDies, failDies, totalDies: passDies + failDies, passRatePercent: (passDies / (passDies + failDies)) * 100 }] },
  });
  const section = buildLotFunctionalSection([], defs, [mkSummary(8, 2), mkSummary(6, 4)]);
  // pooled: 14 pass / 20 total = 70.0% (N=20)
  assert.match(section.textContent, /70\.0% \(N=20\)/);
});

// ── CsvExportContext: wafer identity on the per-test CSVs ──────────────────
//
// Neither exported CSV previously carried any wafer/lot identifier at all —
// concatenating several wafers' test-values.csv files produced rows with no
// way to tell which wafer a row came from.

function clickExport(section) {
  const btn = [...section.querySelectorAll('button')].find(b => b.textContent === 'Export CSV');
  btn.click();
}

test('buildTestSection — a supplied waferMetadata is stamped as leading CSV columns, not table columns', () => {
  const dies = [die({ testValues: { 1050: 1 } }), die({ testValues: { 1050: 3 } })];
  const testDefs = [{ testNumber: 1050, name: 'Idsat', unit: 'A' }];

  const saved = {};
  const section = buildTestSection(dies, testDefs, undefined, undefined, (text) => { saved.text = text; }, {
    waferMetadata: { lot: 'L1', waferId: 'W1' },
  });
  clickExport(section);

  const headerLine = saved.text.split('\n')[0];
  assert.match(headerLine, /^Lot,Wafer/);
  // The on-screen table must NOT gain a Lot/Wafer column — wafer metadata is CSV-only by default.
  const domHeaders = [...section.querySelectorAll('thead th')].map(th => th.textContent);
  assert.ok(!domHeaders.some(h => /lot/i.test(h)));
});

test('buildLotTestSection — pooled CSV gains the wafer identity that was previously entirely absent', () => {
  const testDefs = [{ testNumber: 1050, name: 'Idsat', unit: 'A' }];
  const mkSummary = (waferId, min, max, mean, count) => ({
    wafer: { lot: 'L1', waferId },
    stats: { perTestStats: [{ testNumber: 1050, min, max, mean, count }] },
  });
  const perWaferSummaries = [mkSummary('W1', 1, 5, 3, 10), mkSummary('W2', 2, 6, 4, 10)];
  const dies = [die({ testValues: { 1050: 3 } })];

  const saved = {};
  const section = buildLotTestSection(dies, testDefs, undefined, perWaferSummaries, (text) => { saved.text = text; });
  clickExport(section);

  const headerLine = saved.text.split('\n')[0];
  // 'Lot' is common across both wafers and must appear; 'Wafer' (waferId) varies and must NOT.
  assert.match(headerLine, /^Lot,/);
  assert.ok(!headerLine.includes('Wafer'), `pooled CSV must not claim a single wafer identity: ${headerLine}`);

  // Population is named on screen — an aggregated population must be identified.
  assert.match(section.textContent, /2 wafers pooled/);
});

test('buildLotTestSection — a mixed lot (no common metadata) emits no false identity column at all', () => {
  const testDefs = [{ testNumber: 1050, name: 'Idsat', unit: 'A' }];
  const mkSummary = (lot, waferId) => ({
    wafer: { lot, waferId },
    stats: { perTestStats: [{ testNumber: 1050, min: 1, max: 5, mean: 3, count: 10 }] },
  });
  // Different lots — nothing is common, so no identity column should appear at all.
  const perWaferSummaries = [mkSummary('L1', 'W1'), mkSummary('L2', 'W2')];
  const dies = [die({ testValues: { 1050: 3 } })];

  const saved = {};
  const section = buildLotTestSection(dies, testDefs, undefined, perWaferSummaries, (text) => { saved.text = text; });
  clickExport(section);

  const headerLine = saved.text.split('\n')[0];
  assert.ok(headerLine.startsWith('Test,'), `expected no identity prefix on a mixed lot, got: ${headerLine}`);
});

test('buildTestSection / buildFunctionalTestSection CSVs never contain a die-level metadata key', async () => {
  const { buildFunctionalTestSection } = await import('../dist/packages/canvas-adapter/summaryPanel.js');
  const dies = [die({ testValues: { 1050: 1 }, metadata: { part_id: 'XJ-1' } })];
  const testDefs = [{ testNumber: 1050, name: 'Idsat' }];

  const saved1 = {};
  const s1 = buildTestSection(dies, testDefs, undefined, undefined, (text) => { saved1.text = text; }, {
    waferMetadata: { lot: 'L1' },
  });
  clickExport(s1);
  assert.ok(!saved1.text.split('\n')[0].toLowerCase().includes('part'));

  const funcDies = [die({ testValues: {}, testPass: { 2001: true }, metadata: { part_id: 'XJ-1' } })];
  const funcDefs = [{ testNumber: 2001, name: 'scan_chain', testType: 'F' }];
  const saved2 = {};
  const s2 = buildFunctionalTestSection(funcDies, funcDefs, undefined, (text) => { saved2.text = text; }, {
    waferMetadata: { lot: 'L1' },
  });
  clickExport(s2);
  assert.ok(!saved2.text.split('\n')[0].toLowerCase().includes('part'));
});

// ── "View die list" link: gates the modal that reuses buildDieListSection ──
//
// No dedicated toolbar button — reached only from an already-open summary
// panel, the same way "Summary report" opens the HTML report without one.

function panelDiv() {
  return document.createElement('div');
}

function clickLink(panel, text) {
  const btn = [...panel.querySelectorAll('button')].find(b => b.textContent === text);
  assert.ok(btn, `expected a "${text}" button in the panel`);
  btn.click();
}

test('renderWaferSummaryContent — "View die list" is present by default (no dieListOptions at all)', () => {
  const panel = panelDiv();
  renderWaferSummaryContent(panel, {
    wafer: wafer({ metadata: { lot: 'L1' } }),
    dies: [die({ hbin: 1 })],
  });
  assert.ok([...panel.querySelectorAll('button')].some(b => b.textContent === 'View die list'));
});

test('renderWaferSummaryContent — "View die list" is absent when explicitly disabled', () => {
  const panel = panelDiv();
  renderWaferSummaryContent(panel, {
    wafer: wafer({ metadata: { lot: 'L1' } }),
    dies: [die({ hbin: 1 })],
    dieListOptions: { enabled: false },
  });
  assert.ok(![...panel.querySelectorAll('button')].some(b => b.textContent === 'View die list'));
});

test('renderWaferSummaryContent — "View die list" is absent when there are no dies, even with the default enabled', () => {
  const panel = panelDiv();
  renderWaferSummaryContent(panel, {
    wafer: wafer({ metadata: {} }),
    dies: [],
  });
  assert.ok(![...panel.querySelectorAll('button')].some(b => b.textContent === 'View die list'));
});

test('renderWaferSummaryContent — "View die list" opens a modal with this wafer\'s dies and metadata', () => {
  const panel = panelDiv();
  document.body.innerHTML = '';
  renderWaferSummaryContent(panel, {
    wafer: wafer({ metadata: { lot: 'L1', waferId: 'W1' } }),
    dies: [die({ hbin: 1, metadata: { part_id: 'XJ-1' } }), die({ hbin: 2 })],
    dieListOptions: { enabled: true },
  });
  clickLink(panel, 'View die list');

  const modal = document.body.querySelector('.wmap-dielist-table');
  assert.ok(modal, 'expected a die-list table to have been mounted into the modal');
  const headers = [...document.querySelectorAll('.wmap-dielist-th')].map(th => th.textContent);
  assert.ok(headers.some(h => /part/i.test(h)), `expected a part_id column: ${headers}`);
  const rows = document.querySelectorAll('.wmap-dielist-table tbody tr');
  assert.equal(rows.length, 2);
});

test('renderLotSummaryContent — "View die list" pools every wafer\'s dies with a Wafer column', () => {
  const panel = panelDiv();
  document.body.innerHTML = '';
  const lotSummary = { stats: { waferCount: 2 }, perWafer: [] };
  const items = [
    { label: 'W1', wafer: wafer({ metadata: { lot: 'L1', waferId: 'W1' } }), dies: [die({ hbin: 1 })] },
    { label: 'W2', wafer: wafer({ metadata: { lot: 'L1', waferId: 'W2' } }), dies: [die({ hbin: 2 }), die({ hbin: 1 })] },
  ];
  renderLotSummaryContent(panel, { lotSummary, items, dieListOptions: { enabled: true } });
  clickLink(panel, 'View die list');

  const headers = [...document.querySelectorAll('.wmap-dielist-th')].map(th => th.textContent);
  assert.equal(headers[0], 'Wafer', `expected the Wafer column leading: ${headers}`);

  const rows = [...document.querySelectorAll('.wmap-dielist-table tbody tr')];
  assert.equal(rows.length, 3, 'all dies across both wafers');
  const waferCol = rows.map(r => r.querySelector('td').textContent);
  assert.deepEqual(waferCol.sort(), ['W1', 'W2', 'W2']);
});

// ── "Summary report": opens in an in-app modal by default (WMAP_ISSUES.md #37) —
// no setReportOpener/window.open required just to view a report. ─────────────

test('renderWaferSummaryContent — "Summary report" opens an in-app modal with the report as an iframe, not window.open', () => {
  const panel = panelDiv();
  document.body.innerHTML = '';
  renderWaferSummaryContent(panel, {
    wafer: wafer({ metadata: { lot: 'L1' } }),
    dies: [die({ hbin: 1 })],
    yieldSummary: { passDies: 1, failDies: 0, edgeExcludedDies: 0, partialDies: 0, totalDies: 1, yieldPercent: 100, yieldPercentGross: null },
    dataCoverage: { filledDies: 1, totalDies: 1, edgeExcludedDies: 0, ratio: 1, unpositionedDies: 0 },
  });
  clickLink(panel, 'Summary report');

  const modal = document.body.querySelector('.wmap-modal-box');
  assert.ok(modal, 'expected an in-app modal to have been mounted, not a window.open() call');
  const iframe = modal.querySelector('iframe');
  assert.ok(iframe, 'expected the report HTML to be rendered via an iframe');
  assert.match(iframe.srcdoc, /<!DOCTYPE html>/i);
  assert.match(iframe.srcdoc, /L1/, 'expected the actual report content in srcdoc, not a placeholder');
  assert.ok(modal.querySelector('button[aria-label="Print / Save as PDF"]'), 'expected a print header button');
  assert.ok([...modal.querySelectorAll('button')].some(b => b.textContent.includes('Open as full page')), 'expected the "open as full page" fallback link');
});

test('renderLotSummaryContent — "Summary report" opens an in-app modal too', () => {
  const panel = panelDiv();
  document.body.innerHTML = '';
  const lotSummary = { stats: { waferCount: 1 }, perWafer: [] };
  const items = [{ label: 'W1', wafer: wafer({ metadata: { lot: 'L1' } }), dies: [die({ hbin: 1 })] }];
  renderLotSummaryContent(panel, { lotSummary, items });
  clickLink(panel, 'Summary report');

  const modal = document.body.querySelector('.wmap-modal-box');
  assert.ok(modal, 'expected an in-app modal to have been mounted');
  assert.ok(modal.querySelector('iframe'), 'expected the lot report HTML to be rendered via an iframe');
});

test('renderLotSummaryContent — "View die list" CSV carries only metadata common to every wafer', () => {
  const panel = panelDiv();
  document.body.innerHTML = '';
  const lotSummary = { stats: { waferCount: 2 }, perWafer: [] };
  const items = [
    // 'lot' is common to both, 'product' is not — the mixed-lot "no false claim" case.
    { label: 'W1', wafer: wafer({ metadata: { lot: 'L1', product: 'A' } }), dies: [die({ hbin: 1 })] },
    { label: 'W2', wafer: wafer({ metadata: { lot: 'L1', product: 'B' } }), dies: [die({ hbin: 2 })] },
  ];
  const saved = {};
  renderLotSummaryContent(panel, {
    lotSummary, items, dieListOptions: { enabled: true }, onSaveText: (text) => { saved.text = text; },
  });
  clickLink(panel, 'View die list');

  const exportBtn = [...document.querySelectorAll('button')].find(b => b.textContent === 'Export CSV');
  assert.ok(exportBtn, 'expected an Export CSV button inside the die-list modal');
  exportBtn.click();

  const headerLine = saved.text.split('\n')[0];
  assert.ok(headerLine.includes('Lot'), `common field should appear: ${headerLine}`);
  assert.ok(!headerLine.includes('Product'), `varying field must not appear: ${headerLine}`);
});

test('renderLotSummaryContent — "View die list" is present by default (no dieListOptions at all)', () => {
  const panel = panelDiv();
  const lotSummary = { stats: { waferCount: 1 }, perWafer: [] };
  const items = [{ label: 'W1', wafer: wafer({ metadata: {} }), dies: [die({ hbin: 1 })] }];
  renderLotSummaryContent(panel, { lotSummary, items });
  assert.ok([...panel.querySelectorAll('button')].some(b => b.textContent === 'View die list'));
});

test('renderLotSummaryContent — "View die list" is absent when explicitly disabled', () => {
  const panel = panelDiv();
  const lotSummary = { stats: { waferCount: 1 }, perWafer: [] };
  const items = [{ label: 'W1', wafer: wafer({ metadata: {} }), dies: [die({ hbin: 1 })] }];
  renderLotSummaryContent(panel, { lotSummary, items, dieListOptions: { enabled: false } });
  assert.ok(![...panel.querySelectorAll('button')].some(b => b.textContent === 'View die list'));
});
