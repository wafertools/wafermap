// Per-test pass rate by group — parametric (spec-limit judgement) and functional
// (recorded verdict) in one builder, since only the source of the verdict differs.

import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTestPassRateData, hasJudgeableTests } from '../dist/packages/stats/testPassRate.js';

const die = (testValues, extra = {}) => ({ x: 0, y: 0, testValues, ...extra });

const P_DEFS = [
  { testNumber: 1, name: 'vth', limitLow: 0, limitHigh: 10 },
  { testNumber: 2, name: 'ioff', limitLow: 0, limitHigh: 10 },
  // No limits: unjudgeable, must not appear at all.
  { testNumber: 3, name: 'unbounded' },
];
const F_DEFS = [
  { testNumber: 90, name: 'scan_chain', testType: 'F' },
  { testNumber: 91, name: 'bist', testType: 'F' },
];

test('parametric rows come from spec limits, worst pass rate first', () => {
  const dies = [
    die({ 1: 5, 2: 5 }), die({ 1: 5, 2: 99 }), die({ 1: 5, 2: 99 }), die({ 1: -1, 2: 5 }),
  ];
  const { rows } = buildTestPassRateData([{ key: 'all', items: [{ dies }] }], P_DEFS, 'spec');
  assert.deepEqual(rows.map(r => r.label), ['ioff', 'vth'], 'worst first — ioff fails 2 of 4');
  assert.equal(rows[0].overall.passDies, 2);
  assert.equal(rows[0].overall.failDies, 2);
  assert.equal(rows[0].overall.passRatePercent, 50);
});

test('a test with no limits is excluded, never reported as 100%', () => {
  const dies = [die({ 1: 5, 3: 12345 })];
  const { rows } = buildTestPassRateData([{ key: 'all', items: [{ dies }] }], P_DEFS, 'spec');
  assert.ok(!rows.some(r => r.label === 'unbounded'),
    'a test with nothing to judge against has no pass rate to report');
});

test('a single-sided limit still judges a die', () => {
  const defs = [{ testNumber: 1, name: 'leak', limitHigh: 10 }];
  const dies = [die({ 1: 5 }), die({ 1: 50 })];
  const { rows } = buildTestPassRateData([{ key: 'all', items: [{ dies }] }], defs, 'spec');
  assert.equal(rows[0].overall.passRatePercent, 50);
});

test('parametric rows carry which side of the spec the failures fell on', () => {
  const dies = [die({ 1: -5 }), die({ 1: -5 }), die({ 1: 50 }), die({ 1: 5 })];
  const { rows } = buildTestPassRateData([{ key: 'all', items: [{ dies }] }],
    [{ testNumber: 1, name: 'vth', limitLow: 0, limitHigh: 10 }], 'spec');
  assert.equal(rows[0].failLowDies, 2);
  assert.equal(rows[0].failHighDies, 1);
});

test('rates are per group, so unequal group sizes compare fairly', () => {
  // A: 1 fail of 2 (50%). B: 2 fails of 8 (75%). B has MORE failures but a BETTER
  // rate — the count-based bin cluster would rank these backwards.
  const groupA = [die({ 1: 5 }), die({ 1: 99 })];
  const groupB = [
    die({ 1: 5 }), die({ 1: 5 }), die({ 1: 5 }), die({ 1: 5 }),
    die({ 1: 5 }), die({ 1: 5 }), die({ 1: 99 }), die({ 1: 99 }),
  ];
  const { groups, rows } = buildTestPassRateData(
    [{ key: 'A', items: [{ dies: groupA }] }, { key: 'B', items: [{ dies: groupB }] }],
    [{ testNumber: 1, name: 'vth', limitLow: 0, limitHigh: 10 }], 'spec');
  assert.deepEqual(groups, ['A', 'B']);
  assert.equal(rows[0].byGroup[0].passRatePercent, 50);
  assert.equal(rows[0].byGroup[1].passRatePercent, 75);
  assert.equal(rows[0].byGroup[1].failDies, 2, 'B has more failures...');
  assert.ok(rows[0].byGroup[1].passRatePercent > rows[0].byGroup[0].passRatePercent, '...but a better rate');
});

test('a group with no verdicts is null, not 0%', () => {
  const { rows } = buildTestPassRateData(
    [{ key: 'A', items: [{ dies: [die({ 1: 5 })] }] }, { key: 'B', items: [{ dies: [die({ 2: 5 })] }] }],
    [{ testNumber: 1, name: 'vth', limitLow: 0, limitHigh: 10 }], 'spec');
  assert.equal(rows[0].byGroup[0].passRatePercent, 100);
  assert.equal(rows[0].byGroup[1].passRatePercent, null, '"not measured" is not "all failed"');
});

test('functional rows come from recorded verdicts, including the legacy 0/1 form', () => {
  const dies = [
    die({ 91: 1 }, { testPass: { 90: true } }),
    die({ 91: 0 }, { testPass: { 90: false } }),
    die({ 91: 1 }, { testPass: { 90: true } }),
  ];
  const { rows } = buildTestPassRateData([{ key: 'all', items: [{ dies }] }], F_DEFS, 'functional');
  const scan = rows.find(r => r.label === 'scan_chain');
  const bist = rows.find(r => r.label === 'bist');
  assert.equal(scan.overall.passDies, 2);
  assert.equal(scan.overall.failDies, 1);
  // bist has no recorded testPass — read through the legacy 0/1 testValues path.
  assert.equal(bist.overall.passDies, 2);
  assert.equal(bist.overall.failDies, 1);
});

test('a missing functional verdict is not counted as a fail', () => {
  const dies = [
    die({}, { testPass: { 90: true } }),
    die({}), // never tested
  ];
  const { rows } = buildTestPassRateData([{ key: 'all', items: [{ dies }] }],
    [{ testNumber: 90, name: 'scan_chain', testType: 'F' }], 'functional');
  assert.equal(rows[0].overall.totalDies, 1, 'denominator is dies with a verdict');
  assert.equal(rows[0].overall.passRatePercent, 100);
});

test('partial and edge-excluded dies are excluded from both kinds', () => {
  const pDies = [die({ 1: 5 }), die({ 1: 99 }, { partial: true }), die({ 1: 99 }, { edgeExcluded: true })];
  const { rows } = buildTestPassRateData([{ key: 'all', items: [{ dies: pDies }] }],
    [{ testNumber: 1, name: 'vth', limitLow: 0, limitHigh: 10 }], 'spec');
  assert.equal(rows[0].overall.totalDies, 1);
});

test('precomputed per-wafer yields are used instead of rescanning dies', () => {
  const { rows } = buildTestPassRateData([{
    key: 'all',
    items: [{
      dies: [die({ 1: 5 })],
      testSpecYield: [{ testNumber: 1, label: 'vth', passDies: 900, failLowDies: 60, failHighDies: 40, totalDies: 1000, yieldPercent: 90 }],
    }],
  }], [{ testNumber: 1, name: 'vth', limitLow: 0, limitHigh: 10 }], 'spec');
  assert.equal(rows[0].overall.passDies, 900, 'the precomputed value wins, proving the fast path');
  assert.equal(rows[0].failLowDies, 60);
});

test('hasJudgeableTests gates which modes the selector offers', () => {
  assert.equal(hasJudgeableTests(P_DEFS, 'spec'), true);
  assert.equal(hasJudgeableTests(P_DEFS, 'functional'), false);
  assert.equal(hasJudgeableTests(F_DEFS, 'functional'), true);
  assert.equal(hasJudgeableTests([{ testNumber: 3, name: 'unbounded' }], 'spec'), false);
  assert.equal(hasJudgeableTests(undefined, 'spec'), false);

  // 'testFlag' needs a die to actually carry a verdict: every parametric test
  // COULD have one, so a definition-only check would offer a mode that renders
  // empty on the common data that has none.
  assert.equal(hasJudgeableTests(P_DEFS, 'testFlag', []), false);
  assert.equal(hasJudgeableTests(P_DEFS, 'testFlag', [die({ 1: 5 })]), false);
  assert.equal(hasJudgeableTests(P_DEFS, 'testFlag', [die({ 1: 5 }, { testPass: { 1: false } })]), true);
});

// ── The two parametric questions are kept apart ─────────────────────────────
//
// STDF's PTR carries its own TEST_FLG pass/fail bits, which exist whether or not
// LO_LIMIT/HI_LIMIT do. "Did it fail the limits" and "did the tester fail it" are
// therefore different questions over the same test, and they can disagree.

test("a parametric test with no limits is still judgeable by the tester's flag", () => {
  const defs = [{ testNumber: 3, name: 'unbounded' }];
  const dies = [
    die({ 3: 1 }, { testPass: { 3: true } }),
    die({ 3: 2 }, { testPass: { 3: false } }),
  ];
  // 'spec' has nothing to judge against and reports nothing...
  assert.equal(buildTestPassRateData([{ key: '', items: [{ dies }] }], defs, 'spec').rows.length, 0);
  // ...but the tester already judged it.
  const flag = buildTestPassRateData([{ key: '', items: [{ dies }] }], defs, 'testFlag');
  assert.equal(flag.rows.length, 1);
  assert.equal(flag.rows[0].overall.passRatePercent, 50);
});

test('the two parametric modes can disagree, and the disagreement is counted', () => {
  const defs = [{ testNumber: 1, name: 'vth', limitLow: 0, limitHigh: 10 }];
  const dies = [
    die({ 1: 5 }, { testPass: { 1: true } }),   // agree: pass
    die({ 1: 99 }, { testPass: { 1: false } }), // agree: fail
    // Inside the limits, but the tester failed it — a guard band, a dynamic
    // limit, or a limits/data mismatch. This is the case worth surfacing.
    die({ 1: 9.9 }, { testPass: { 1: false } }),
  ];
  const spec = buildTestPassRateData([{ key: '', items: [{ dies }] }], defs, 'spec');
  const flag = buildTestPassRateData([{ key: '', items: [{ dies }] }], defs, 'testFlag');
  assert.equal(spec.rows[0].overall.passDies, 2, 'limits pass 2 of 3');
  assert.equal(flag.rows[0].overall.passDies, 1, 'the tester passed only 1');
  assert.equal(spec.disagreementDies, 1);
  assert.equal(flag.disagreementDies, 1);
});

test('disagreement is null when only one source exists — distinct from zero', () => {
  const defs = [{ testNumber: 1, name: 'vth', limitLow: 0, limitHigh: 10 }];
  // Limits only, no recorded verdicts: nothing to compare, so null.
  const noFlags = buildTestPassRateData([{ key: '', items: [{ dies: [die({ 1: 5 })] }] }], defs, 'spec');
  assert.equal(noFlags.disagreementDies, null);

  // Both present and in full agreement: 0, which is a real answer.
  const agreeing = buildTestPassRateData(
    [{ key: '', items: [{ dies: [die({ 1: 5 }, { testPass: { 1: true } })] }] }], defs, 'spec');
  assert.equal(agreeing.disagreementDies, 0);

  // Functional mode never compares the two parametric sources.
  assert.equal(buildTestPassRateData([{ key: '', items: [{ dies: [die({}, { testPass: { 90: true } })] }] }],
    [{ testNumber: 90, name: 'scan', testType: 'F' }], 'functional').disagreementDies, null);
});

test('fail direction is a spec-mode notion only — a tester flag says only "failed"', () => {
  const defs = [{ testNumber: 1, name: 'vth', limitLow: 0, limitHigh: 10 }];
  const dies = [die({ 1: -5 }, { testPass: { 1: false } })];
  assert.equal(buildTestPassRateData([{ key: '', items: [{ dies }] }], defs, 'spec').rows[0].failLowDies, 1);
  assert.equal(buildTestPassRateData([{ key: '', items: [{ dies }] }], defs, 'testFlag').rows[0].failLowDies, undefined);
});

test("the precomputed spec fast path is skipped when dies carry verdicts to compare", () => {
  const defs = [{ testNumber: 1, name: 'vth', limitLow: 0, limitHigh: 10 }];
  // A precomputed aggregate cannot supply the per-die verdicts the comparison
  // needs, so the walk must happen — and the counts must come from the dies.
  const data = buildTestPassRateData([{
    key: '',
    items: [{
      dies: [die({ 1: 5 }, { testPass: { 1: false } })],
      testSpecYield: [{ testNumber: 1, label: 'vth', passDies: 900, failLowDies: 0, failHighDies: 100, totalDies: 1000, yieldPercent: 90 }],
    }],
  }], defs, 'spec');
  assert.equal(data.rows[0].overall.totalDies, 1, 'walked the dies, not the aggregate');
  assert.equal(data.disagreementDies, 1);
});
