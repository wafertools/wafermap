import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeTestDefs } from '../dist/packages/stats/mergeTestDefs.js';

const item = (...testDefs) => ({ testDefs });

// ---------------------------------------------------------------------------
// The central rule: absent is "not stated", never a disagreement.
// ---------------------------------------------------------------------------

test('a file without limits merges silently with one that has them', () => {
  const { defs, conflicts, warnings } = mergeTestDefs([
    item({ testNumber: 1001, name: 'vth_n_mV', unit: 'mV', limitLow: 260, limitHigh: 380 }),
    item({ testNumber: 1001, name: 'vth_n_mV', unit: 'mV' }),
  ]);
  assert.deepEqual(conflicts, []);
  assert.deepEqual(warnings, []);
  assert.equal(defs.length, 1);
  assert.equal(defs[0].limitLow, 260, 'the stated limit wins over the absent one');
  assert.equal(defs[0].limitHigh, 380);
});

test('the stated limit wins regardless of which item states it first', () => {
  const { defs, conflicts } = mergeTestDefs([
    item({ testNumber: 1, name: 'Vt', unit: 'mV' }),
    item({ testNumber: 1, name: 'Vt', unit: 'mV', limitLow: 5, limitHigh: 9 }),
  ]);
  assert.deepEqual(conflicts, []);
  assert.equal(defs[0].limitLow, 5);
  assert.equal(defs[0].limitHigh, 9);
});

test('absent name and unit are not conflicts', () => {
  const { defs, conflicts } = mergeTestDefs([
    item({ testNumber: 1, name: '' }),
    item({ testNumber: 1, name: 'Vt', unit: 'mV' }),
    item({ testNumber: 1, name: '   ' }),
  ]);
  assert.deepEqual(conflicts, []);
  assert.equal(defs[0].name, 'Vt');
  assert.equal(defs[0].unit, 'mV');
});

test('absent testType is not an assertion of parametric', () => {
  const { defs, conflicts } = mergeTestDefs([
    item({ testNumber: 1, name: 'Fn' }),
    item({ testNumber: 1, name: 'Fn', testType: 'F' }),
  ]);
  assert.deepEqual(conflicts, []);
  assert.equal(defs[0].testType, 'F');
});

// ---------------------------------------------------------------------------
// Hard tier — different measurements sharing a number.
// ---------------------------------------------------------------------------

test('distinct names exclude the test and raise an error-severity warning', () => {
  const { defs, conflicts, warnings } = mergeTestDefs([
    item({ testNumber: 1001, name: 'vth_n_mV', unit: 'mV', limitLow: 260, limitHigh: 380 }),
    item({ testNumber: 1001, name: 'leakage_nA', unit: 'nA', limitLow: 0, limitHigh: 5 }),
  ]);
  assert.deepEqual(defs, [], 'the colliding test is withheld entirely');
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].kind, 'name');
  assert.equal(conflicts[0].excluded, true);
  assert.deepEqual(conflicts[0].values, ['vth_n_mV', 'leakage_nA']);
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0].code, 'test-def-collision');
  assert.equal(warnings[0].severity, 'error');
  assert.match(warnings[0].message, /vth_n_mV vs leakage_nA/);
});

test('distinct units exclude the test even when the name matches', () => {
  const { defs, conflicts } = mergeTestDefs([
    item({ testNumber: 1, name: 'Vt', unit: 'mV' }),
    item({ testNumber: 1, name: 'Vt', unit: 'V' }),
  ]);
  assert.deepEqual(defs, []);
  assert.equal(conflicts[0].kind, 'unit');
});

test('unit comparison is case-sensitive — SI prefixes carry magnitude', () => {
  const { defs, conflicts } = mergeTestDefs([
    item({ testNumber: 1, name: 'Vt', unit: 'mV' }),
    item({ testNumber: 1, name: 'Vt', unit: 'MV' }),
  ]);
  assert.deepEqual(defs, [], 'mV and MV are a billion apart, never the same unit');
  assert.equal(conflicts[0].kind, 'unit');
});

test('a parametric/functional disagreement excludes the test', () => {
  const { defs, conflicts } = mergeTestDefs([
    item({ testNumber: 1, name: 'T', testType: 'P' }),
    item({ testNumber: 1, name: 'T', testType: 'F' }),
  ]);
  assert.deepEqual(defs, []);
  assert.equal(conflicts[0].kind, 'testType');
});

test('one conflict is reported per test, not one per disagreeing field', () => {
  const { conflicts } = mergeTestDefs([
    item({ testNumber: 1, name: 'a', unit: 'mV', testType: 'P' }),
    item({ testNumber: 1, name: 'b', unit: 'nA', testType: 'F' }),
  ]);
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].kind, 'name');
});

// ---------------------------------------------------------------------------
// Name tolerance — formatting drift must not withhold data.
// ---------------------------------------------------------------------------

test('names compare trimmed and case-insensitively', () => {
  const { defs, conflicts } = mergeTestDefs([
    item({ testNumber: 1, name: 'vth_n_mV', unit: 'mV' }),
    item({ testNumber: 1, name: '  VTH_N_MV ', unit: 'mV' }),
  ]);
  assert.deepEqual(conflicts, [], 'case and padding drift is not a different test');
  assert.equal(defs[0].name, 'vth_n_mV', 'the first stated spelling is kept for display');
});

// ---------------------------------------------------------------------------
// Soft tier — same measurement, different spec.
// ---------------------------------------------------------------------------

test('different stated limits keep the test but drop BOTH limits', () => {
  const { defs, conflicts, warnings } = mergeTestDefs([
    item({ testNumber: 1, name: 'Vt', unit: 'mV', limitLow: 260, limitHigh: 380 }),
    item({ testNumber: 1, name: 'Vt', unit: 'mV', limitLow: 260, limitHigh: 400 }),
  ]);
  assert.equal(defs.length, 1, 'values are still comparable, so the test stays');
  assert.equal(defs[0].limitLow, undefined, 'the agreeing limit goes too — half a spec is not a spec');
  assert.equal(defs[0].limitHigh, undefined);
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].kind, 'limits');
  assert.equal(conflicts[0].excluded, false);
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0].code, 'test-limit-conflict');
  assert.equal(warnings[0].severity, 'warning');
});

test('limits are compared with a relative tolerance, not ===', () => {
  // The same nominal 380 arriving as float32 and as float64.
  const asFloat32 = Math.fround(380.1);
  assert.notEqual(asFloat32, 380.1, 'precondition: the two representations really differ');
  const { defs, conflicts } = mergeTestDefs([
    item({ testNumber: 1, name: 'Vt', unit: 'mV', limitLow: 0, limitHigh: 380.1 }),
    item({ testNumber: 1, name: 'Vt', unit: 'mV', limitLow: 0, limitHigh: asFloat32 }),
  ]);
  assert.deepEqual(conflicts, [], 'representation noise is not a spec disagreement');
  assert.equal(defs[0].limitHigh, 380.1);
});

test('limits that genuinely differ are still caught by the tolerance', () => {
  const { conflicts } = mergeTestDefs([
    item({ testNumber: 1, name: 'Vt', unit: 'mV', limitHigh: 380 }),
    item({ testNumber: 1, name: 'Vt', unit: 'mV', limitHigh: 381 }),
  ]);
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].kind, 'limits');
});

// ---------------------------------------------------------------------------
// Union — the truncation half of the bug.
// ---------------------------------------------------------------------------

test('tests present only in later items are included', () => {
  const { defs } = mergeTestDefs([
    item({ testNumber: 1, name: 'a' }),
    item({ testNumber: 2, name: 'b' }, { testNumber: 3, name: 'c' }),
  ]);
  assert.deepEqual(defs.map(d => d.testNumber), [1, 2, 3]);
});

test('items with no defs contradict nothing and are skipped', () => {
  const { defs, conflicts } = mergeTestDefs([
    null,
    undefined,
    {},
    item({ testNumber: 1, name: 'a', unit: 'mV' }),
  ]);
  assert.deepEqual(conflicts, []);
  assert.equal(defs.length, 1);
});

test('an empty population yields nothing rather than throwing', () => {
  const { defs, conflicts, warnings } = mergeTestDefs([]);
  assert.deepEqual(defs, []);
  assert.deepEqual(conflicts, []);
  assert.deepEqual(warnings, []);
});

test('a single-program population is returned unchanged, in order', () => {
  const defsIn = [
    { testNumber: 1001, name: 'vth_n_mV', unit: 'mV', limitLow: 260, limitHigh: 380 },
    { testNumber: 1003, name: 'idsat_n_uA', unit: 'uA', limitLow: 500, limitHigh: 900 },
  ];
  const { defs, conflicts, warnings } = mergeTestDefs([item(...defsIn), item(...defsIn)]);
  assert.deepEqual(conflicts, []);
  assert.deepEqual(warnings, []);
  assert.deepEqual(defs, defsIn);
});

// ---------------------------------------------------------------------------
// Reporting shape.
// ---------------------------------------------------------------------------

test('many collisions produce one warning, not one per test', () => {
  const a = Array.from({ length: 12 }, (_, i) => ({ testNumber: 1000 + i, name: `a${i}` }));
  const b = Array.from({ length: 12 }, (_, i) => ({ testNumber: 1000 + i, name: `b${i}` }));
  const { conflicts, warnings } = mergeTestDefs([item(...a), item(...b)]);
  assert.equal(conflicts.length, 12);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0].message, /and 7 more/, 'lists 5 then counts the rest honestly');
});

test('both tiers can be reported together', () => {
  const { warnings } = mergeTestDefs([
    item({ testNumber: 1, name: 'a' }, { testNumber: 2, name: 'Vt', limitHigh: 10 }),
    item({ testNumber: 1, name: 'b' }, { testNumber: 2, name: 'Vt', limitHigh: 20 }),
  ]);
  assert.deepEqual(warnings.map(w => w.code).sort(), ['test-def-collision', 'test-limit-conflict']);
});

// ---------------------------------------------------------------------------
// Scope. The rule is right; the population it is evaluated over is the whole
// question — see insightsTab's `scopeItems`.
// ---------------------------------------------------------------------------

test('reconciling over the whole load punishes lots that agree', () => {
  // Four lots use 1001 identically; two disagree. Reconciled over all six, the
  // four comparable lots lose their shared test.
  const agreeing = () => item({ testNumber: 1001, name: 'leakage', unit: 'nA', limitLow: 0.5, limitHigh: 5.5 });
  const all = [
    agreeing(), agreeing(), agreeing(), agreeing(),
    item({ testNumber: 1001, name: 'vth_n_mV', unit: 'mV', limitLow: 260, limitHigh: 380 }),
    item({ testNumber: 1001, name: 'leakage_nA', unit: 'nA', limitLow: 0, limitHigh: 5 }),
  ];
  const whole = mergeTestDefs(all);
  assert.deepEqual(whole.defs, [], 'the collision withholds it from everyone');
  assert.equal(whole.conflicts[0].excluded, true);

  // Scoped to the four that agree, it comes back with their own definition.
  const scoped = mergeTestDefs(all.slice(0, 4));
  assert.deepEqual(scoped.conflicts, []);
  assert.equal(scoped.defs.length, 1);
  assert.equal(scoped.defs[0].name, 'leakage');
  assert.equal(scoped.defs[0].limitLow, 0.5);
  assert.equal(scoped.defs[0].limitHigh, 5.5);
});

test('scoping to a single disagreeing lot returns ITS definition, limits and all', () => {
  const pvt = item({ testNumber: 1001, name: 'vth_n_mV', unit: 'mV', limitLow: 260, limitHigh: 380 });
  const hy  = item({ testNumber: 1001, name: 'leakage',  unit: 'nA', limitLow: 0.5, limitHigh: 5.5 });
  assert.deepEqual(mergeTestDefs([pvt, hy]).defs, []);

  const onlyPvt = mergeTestDefs([pvt]);
  assert.deepEqual(onlyPvt.conflicts, []);
  assert.deepEqual(onlyPvt.defs, [
    { testNumber: 1001, name: 'vth_n_mV', unit: 'mV', limitLow: 260, limitHigh: 380 },
  ]);
});

test('a scope of one item can never collide with itself', () => {
  const { conflicts } = mergeTestDefs([
    item(
      { testNumber: 1001, name: 'a', unit: 'mV' },
      { testNumber: 1002, name: 'b', unit: 'nA' },
    ),
  ]);
  assert.deepEqual(conflicts, []);
});

// ---------------------------------------------------------------------------
// Derived tests must stay marked across the merge. This module rebuilds each
// def field by field, so a field it does not name is silently dropped — which
// is how `derived` went missing from every cross-wafer panel: the gallery's
// capability grid drew a derived test with no marker while the single-wafer
// view marked it.
// ---------------------------------------------------------------------------

test('derived and its expression survive the merge', () => {
  const derived = { testNumber: 900001, name: 'Shift', derived: true, expression: 't[1020] - t[1010]' };
  const { defs } = mergeTestDefs([item(derived), item(derived)]);
  assert.equal(defs[0].derived, true);
  assert.equal(defs[0].expression, 't[1020] - t[1010]');
});

test('a test derived in any item is marked derived', () => {
  // Deliberately asymmetric: marking a measured test is a visible oddity
  // someone queries; leaving a derived one unmarked is invisible.
  const { defs } = mergeTestDefs([
    item({ testNumber: 900001, name: 'Shift' }),
    item({ testNumber: 900001, name: 'Shift', derived: true, expression: 't[1020] - t[1010]' }),
  ]);
  assert.equal(defs[0].derived, true);
});

test('a measured test gains no derived fields from the merge', () => {
  const { defs } = mergeTestDefs([item({ testNumber: 1010, name: 'Idsat' })]);
  assert.equal('derived' in defs[0], false);
  assert.equal('expression' in defs[0], false);
});
