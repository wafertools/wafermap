// The shared demo fixture (docs/examples/data.js).
//
// It is not just sample numbers: several Insights features are only reachable
// when the data has particular properties, and those properties are easy to
// flatten with an innocent-looking tweak to a bias or a limit. These tests pin
// the ones features depend on — the split axis, the tester verdicts, and the
// deliberate spec/tester disagreement — so a change that removes a demo's whole
// point fails here instead of silently rendering an empty card.

import test from 'node:test';
import assert from 'node:assert/strict';

const data = await import('../docs/examples/data.js');
const { buildTestPassRateData } = await import('../dist/packages/stats/testPassRate.js');

const lotGroups = () => {
  const groups = data.PROCESS_SPLITS.map(k => ({ key: k, items: [] }));
  for (let i = 0; i < 6; i++) {
    groups[i % data.PROCESS_SPLITS.length].items.push({ dies: data.makeResults({ seed: i + 1, waferIndex: i }) });
  }
  return groups;
};
const ALL_DEFS = () => [...data.TEST_DEFS, data.FUNCTIONAL_TEST_DEF];

test('wafers alternate between two process splits, giving Insights a Group by axis', () => {
  // `waferId` is unique per wafer and the facet table deliberately excludes it,
  // so without a field like this no generated demo has anything to group on.
  assert.equal(data.PROCESS_SPLITS.length, 2);
  assert.equal(data.makeWaferConfig(0).metadata.processSplit, data.PROCESS_SPLITS[0]);
  assert.equal(data.makeWaferConfig(1).metadata.processSplit, data.PROCESS_SPLITS[1]);
  assert.equal(data.makeWaferConfig(2).metadata.processSplit, data.PROCESS_SPLITS[0]);
});

test('every parametric test carries a spec limit, so the pareto has rows to rank', () => {
  for (const def of data.TEST_DEFS) {
    assert.ok(def.limitLow !== undefined || def.limitHigh !== undefined,
      `${def.name} needs a limit or the spec pass-rate chart cannot judge it`);
  }
  assert.ok(data.TEST_DEFS.length >= 3);
});

test('dies carry tester verdicts for parametric tests, not only the functional one', () => {
  const dies = data.makeResults({ seed: 1, waferIndex: 0 });
  const sample = dies[Math.floor(dies.length / 2)];
  // 1050/1060 are parametric; 1080 is the functional Continuity test. Without the
  // parametric verdicts the chart's "Tester flag" mode never appears at all.
  assert.equal(typeof sample.testPass[1050], 'boolean');
  assert.equal(typeof sample.testPass[1060], 'boolean');
  assert.equal(typeof sample.testPass[1080], 'boolean');
});

test('all three pass-rate modes have data', () => {
  const groups = lotGroups();
  for (const kind of ['spec', 'testFlag', 'functional']) {
    const { rows } = buildTestPassRateData(groups, ALL_DEFS(), kind);
    assert.ok(rows.length > 0, `${kind} mode must have something to draw`);
  }
});

test('the spec and tester judgements genuinely disagree — the note has something to report', () => {
  const { disagreementDies } = buildTestPassRateData(lotGroups(), ALL_DEFS(), 'spec');
  assert.ok(disagreementDies > 0,
    'the Vth guard band is the only source of disagreement in this fixture; if it stops '
    + 'biting, the disagreement note can never be demonstrated');
});

test('the split arm is visibly worse on Vth by the tester flag, and barely so by the limits', () => {
  const groups = lotGroups();
  const vthOf = (kind) => {
    const { rows } = buildTestPassRateData(groups, ALL_DEFS(), kind);
    return rows.find(r => r.label === 'Vth');
  };
  const spec = vthOf('spec');
  const flag = vthOf('testFlag');
  const [porSpec, hiSpec] = spec.byGroup.map(g => g.passRatePercent);
  const [porFlag, hiFlag] = flag.byGroup.map(g => g.passRatePercent);

  // This contrast IS the demo: against the datasheet limits the split looks
  // acceptable, against the criterion the tester actually applied it does not.
  assert.ok(hiSpec > 95, `split arm should still pass most of the spec limits, got ${hiSpec}`);
  assert.ok(porFlag - hiFlag > 10,
    `the tester flag should separate the arms clearly, got POR ${porFlag} vs split ${hiFlag}`);
  assert.ok(porSpec - hiSpec < porFlag - hiFlag,
    'the tester flag must reveal more of the split difference than the limits do');
});

test('the functional test does NOT vary by split, so the Vth signal reads as real', () => {
  const { rows } = buildTestPassRateData(lotGroups(), ALL_DEFS(), 'functional');
  const [a, b] = rows[0].byGroup.map(g => g.passRatePercent);
  // Probe-contact quality is not implant-dose dependent. If everything differed
  // by split, a reader could not tell a real effect from a fixture artefact.
  assert.ok(Math.abs(a - b) < 1, `expected no split effect on Continuity, got ${a} vs ${b}`);
});

test('omitting waferIndex leaves the data unbiased, so single-wafer demos are unchanged', () => {
  const plain = data.makeResults({ seed: 1 });
  const por = data.makeResults({ seed: 1, waferIndex: 0 });
  assert.deepEqual(plain[10].testValues, por[10].testValues, 'POR is the zero-bias arm');
  const split = data.makeResults({ seed: 1, waferIndex: 1 });
  assert.notEqual(plain[10].testValues[1060], split[10].testValues[1060]);
});
