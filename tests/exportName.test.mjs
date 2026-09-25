// Saved-file names — one rule (canvas-adapter/exportName.ts) for every PNG and
// CSV the library saves. Every export used to be named for its content alone
// (`dies.csv`, `wafermap.png`), so two wafers' exports were indistinguishable.
// The DOM-level tests (a real map, gallery and card clicking their own save
// buttons) are in dom-adapter.test.mjs.

import test from 'node:test';
import assert from 'node:assert/strict';

const { buildExportFilename } = await import('../dist/packages/canvas-adapter/exportName.js');

test('lot, wafer and content, in that order', () => {
  assert.equal(buildExportFilename({ lots: ['LOT123'], wafer: 'W05' }, 'die-list.csv'), 'LOT123_W05_die-list.csv');
});

test('parts the data does not have are left out, never invented', () => {
  assert.equal(buildExportFilename({ lots: [] }, 'die-list.csv'), 'die-list.csv');
  assert.equal(buildExportFilename({ lots: ['LOT123'] }, 'die-list.csv'), 'LOT123_die-list.csv');
});

test('a map title becomes a lowercase, filesystem-safe content part', () => {
  assert.equal(buildExportFilename({ lots: ['L1'], wafer: 'W1' }, 'Vdd (mV) · #1050.png'), 'L1_W1_vdd-mv-1050.png');
  assert.equal(buildExportFilename({ lots: ['L1'], wafer: 'W1' }, 'Hard Bin.png'), 'L1_W1_hard-bin.png');
});

test('identity keeps its case and non-Latin letters, but loses path and reserved characters', () => {
  assert.equal(buildExportFilename({ lots: ['A/B:C*?'], wafer: 'Wafer #7' }, 'x.csv'), 'A-B-C_Wafer-7_x.csv');
  assert.equal(buildExportFilename({ lots: ['ロット1'], wafer: 'μ3' }, 'x.csv'), 'ロット1_μ3_x.csv');
});

test('a digits-only lot or wafer is labelled, so it cannot read as a count', () => {
  assert.equal(buildExportFilename({ lots: ['123'], wafer: '5' }, 'x.csv'), 'lot-123_wafer-5_x.csv');
});

test('several lots or wafers are counted, not listed', () => {
  assert.equal(buildExportFilename({ lots: ['L1', 'L2'], waferCount: 25 }, 'gallery.png'), '2-lots_25-wafers_gallery.png');
  assert.equal(buildExportFilename({ lots: ['L1'], waferCount: 1 }, 'x.csv'), 'L1_x.csv');
});

test('a lot-stacked map says so, and how many wafers, instead of naming one wafer', () => {
  assert.equal(buildExportFilename({ lots: ['L1'], stackedWafers: 6, wafer: 'W01' }, 'x.png'), 'L1_stacked-6-wafers_x.png');
  assert.equal(buildExportFilename({ lots: ['L1'], stackedWafers: 1 }, 'x.png'), 'L1_stacked-1-wafer_x.png');
  assert.equal(buildExportFilename({ lots: [], stackedWafers: true }, 'x.png'), 'stacked_x.png');
});

test('the host prefix leads, and suppresses context it already names', () => {
  // tsmap passes the source file's stem, which usually already carries the lot.
  assert.equal(buildExportFilename({ prefix: 'LOT123_sort', lots: ['LOT123'], wafer: 'W05' }, 'hard-bin.png'), 'LOT123_sort_W05_hard-bin.png');
  assert.equal(buildExportFilename({ prefix: 'lot123-W05', lots: ['LOT123'], wafer: 'W05' }, 'x.csv'), 'lot123-W05_x.csv');
  // A digits-only lot is suppressed by its raw value, not only its labelled form.
  assert.equal(buildExportFilename({ prefix: '123_sort', lots: ['123'], wafer: 'W1' }, 'x.csv'), '123_sort_W1_x.csv');
  // Only whole separator-bounded runs count: W1 is not named by W10.
  assert.equal(buildExportFilename({ prefix: 'run_W10', lots: [], wafer: 'W1' }, 'x.csv'), 'run_W10_W1_x.csv');
  // A blank prefix is no prefix.
  assert.equal(buildExportFilename({ prefix: '   ', lots: ['L1'] }, 'x.csv'), 'L1_x.csv');
});

test('names stay bounded, and never empty or a Windows device name', () => {
  const long = 'L'.repeat(500);
  const name = buildExportFilename({ prefix: long, lots: [long], wafer: long }, `${long}.csv`);
  assert.ok(name.length <= 180 + '.csv'.length, `got ${name.length} chars`);
  assert.ok(name.endsWith('.csv'));
  assert.equal(buildExportFilename({ lots: [] }, '.png'), 'wafermap.png');
  assert.equal(buildExportFilename({ lots: [] }, 'con.csv'), 'wafermap-con.csv');
});
