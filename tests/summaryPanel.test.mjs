import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>');
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.HTMLDivElement = dom.window.HTMLDivElement;
globalThis.Node = dom.window.Node;

const { buildBinSection, buildTestSection, buildCompactMetadataRows, buildMetadataStripRow, buildMetadataStripBox, metadataEntries } =
  await import('../dist/packages/canvas-adapter/summaryPanel.js');

function die(overrides) {
  return { x: 0, y: 0, testValues: {}, ...overrides };
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
