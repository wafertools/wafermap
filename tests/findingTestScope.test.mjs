import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeTestDefs } from '../dist/packages/stats/mergeTestDefs.js';

// A finding comes from PER-WAFER analysis, so it reads that wafer's own
// testDefs and its test number is meaningful for the wafers it names — not
// necessarily for any other. `renderWaferGallery`'s finding click used to write
// the gallery-wide `activeTest` unguarded, bypassing every reconciliation the
// merged list performs: clicking a `leakage` finding raised on one lot's wafers
// switched EVERY card to test 1001, which in a lot that calls 1001 `vth_n_mV`
// is a different quantity in different units, laid out as one comparison.
//
// The gate is `mergeTestDefs(...).defs.some(d => d.testNumber === n)`: agreed
// tests switch the whole gallery, withheld ones switch only the finding's own
// wafers. These pin the predicate that gate depends on — the DOM wiring itself
// is covered by dom-adapter.test.mjs's gallery rendering.

const item = (...testDefs) => ({ testDefs });
const P = (testNumber, name, unit, limitLow, limitHigh) =>
  ({ testNumber, name, unit, limitLow, limitHigh });

test('a test every lot agrees on stays available lot-wide', () => {
  const { defs } = mergeTestDefs([
    item(P(1001, 'leakage', 'nA', 0.5, 5.5)),
    item(P(1001, 'leakage', 'nA', 0.5, 5.5)),
  ]);
  assert.equal(defs.some(d => d.testNumber === 1001), true,
    'agreed → the finding click may switch every card');
});

test('a test the lots disagree about is not available lot-wide', () => {
  const { defs } = mergeTestDefs([
    item(P(1001, 'leakage', 'nA', 0.5, 5.5)),
    item(P(1001, 'vth_n_mV', 'mV', 260, 380)),
  ]);
  assert.equal(defs.some(d => d.testNumber === 1001), false,
    'withheld → the finding click must scope to its own wafers only');
});

test('the wafers a withheld finding names do agree among themselves', () => {
  // The scoping is only honest if the finding's own wafers are mutually
  // consistent — they come from one file, so they are.
  const hy = item(P(1001, 'leakage', 'nA', 0.5, 5.5));
  const { defs, conflicts } = mergeTestDefs([hy, hy, hy]);
  assert.deepEqual(conflicts, []);
  assert.equal(defs[0].name, 'leakage');
  assert.equal(defs[0].limitHigh, 5.5);
});

test('a test present in only one lot is still agreed — nothing contradicts it', () => {
  const { defs } = mergeTestDefs([
    item(P(1004, 'idsat_p_uA', 'uA', 460, 840)),
    item(P(1001, 'leakage', 'nA', 0.5, 5.5)),
  ]);
  assert.equal(defs.some(d => d.testNumber === 1004), true,
    'unique is not the same as contradicted — it stays lot-wide, and the '
    + 'mode menu names its coverage instead');
});

// ---------------------------------------------------------------------------
// `undefined` (nobody described any tests) vs `[]` (reconciled to nothing).
// Three call sites now depend on telling these apart — the plot-mode menu, the
// stacked-value builder and the die list. Each falls back to discovering bare
// test numbers from the dies, which is right for the first and catastrophic for
// the second: it would re-offer every withheld number under a "Test N" label
// and pool the measurements reconciliation had just ruled incomparable.
// ---------------------------------------------------------------------------

import { buildDataModeEntries } from '../dist/packages/canvas-adapter/toolbar.js';

const dieWith = (testNumber) => ({ x: 0, y: 0, hbin: 1, testValues: { [testNumber]: 1.5 } });

test('no defs supplied at all: bare test numbers are discovered from the dies', () => {
  const { testEntries } = buildDataModeEntries([dieWith(1001)], undefined, { includeStacked: false });
  assert.equal(testEntries.length, 1);
  assert.equal(testEntries[0].activeTest, 1001);
  assert.match(testEntries[0].label, /1001/);
});

test('reconciled to nothing: no value modes are offered, and nothing is discovered', () => {
  const { testEntries } = buildDataModeEntries([dieWith(1001)], [], { includeStacked: false });
  assert.deepEqual(testEntries, [],
    'an empty array is a decision, not an absence — the withheld test must not come back');
});

test('reconciled to a subset: only the surviving tests are offered', () => {
  const { testEntries } = buildDataModeEntries(
    [dieWith(1001), dieWith(1004)],
    [{ testNumber: 1004, name: 'idsat_p_uA', unit: 'uA' }],
    { includeStacked: false },
  );
  assert.deepEqual(testEntries.map(e => e.activeTest), [1004]);
});
