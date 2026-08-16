import test from 'node:test';
import assert from 'node:assert/strict';

import { buildWaferMap, aggregateValues, createWafer } from '../dist/index.js';
import { buildView } from '../dist/packages/renderer/buildView.js';

function approxEqual(actual, expected, epsilon = 1e-9) {
  assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} != ${expected}`);
}

function findDie(result, x, y) {
  return result.dies.find((die) => die.x === x && die.y === y);
}

test('buildWaferMap applies retest policy and chooses plot mode from the data', () => {
  const dies = [
    { id: '0_0', x: 0, y: 0, physX: 0, physY: 0, width: 10, height: 10 },
    { id: '1_0', x: 1, y: 0, physX: 10, physY: 0, width: 10, height: 10 },
  ];
  const results = [
    { x: 0, y: 0, testValues: { 0: 0.4 }, hbin: 1 },
    { x: 0, y: 0, testValues: { 0: 0.9 }, hbin: 2 },
    { x: 1, y: 0, testValues: { 0: 0.8 }, hbin: 1 },
  ];

  const first = buildWaferMap({
    dies,
    results,
    waferConfig: { diameter: 40 },
    retestPolicy: 'first',
  });

  const last = buildWaferMap({
    dies,
    results,
    waferConfig: { diameter: 40 },
    retestPolicy: 'last',
  });

  assert.equal(first.plotMode, 'value');
  assert.equal(last.plotMode, 'value');

  assert.deepEqual(findDie(first, 0, 0)?.testValues, { 0: 0.4 });
  assert.equal(findDie(first, 0, 0)?.hbin, 1);
  assert.equal(findDie(first, 0, 0)?.retestCount, 2);

  assert.deepEqual(findDie(last, 0, 0)?.testValues, { 0: 0.9 });
  assert.equal(findDie(last, 0, 0)?.hbin, 2);
  assert.equal(findDie(last, 0, 0)?.retestCount, 2);

  assert.equal(first.yield.passDies, 2);
  assert.equal(first.yield.failDies, 0);
  assert.equal(first.yield.yieldPercent, 100);

  assert.equal(last.yield.passDies, 1);
  assert.equal(last.yield.failDies, 1);
  assert.equal(last.yield.yieldPercent, 50);
});

test('buildWaferMap accepts explicit dies and enables reticles by default when configured', () => {
  const dies = [
    { id: '0_0', x: 0, y: 0, physX: 0, physY: 0, width: 10, height: 10 },
    { id: '1_0', x: 1, y: 0, physX: 10, physY: 0, width: 10, height: 10 },
  ];

  const result = buildWaferMap({
    dies,
    results: [{ x: 0, y: 0, testValues: { 0: 1.23 }, hbin: 1 }],
    waferConfig: {
      diameter: 60,
      metadata: { lot: 'LOT-9', waferNumber: 7 },
    },
    reticleConfig: { width: 1, height: 1 },
  });

  assert.equal(result.units, 'mm');
  assert.equal(result.wafer.metadata?.lot, 'LOT-9');
  assert.equal(result.metadata?.lot, 'LOT-9');
  assert.deepEqual(findDie(result, 0, 0)?.testValues, { 0: 1.23 });
  assert.ok(result.reticles.length > 0);
  assert.equal(result.dataCoverage.totalDies, 2);
});

test('buildWaferMap collapses lot stacks before rendering', () => {
  const lotStack = [
    [
      { x: 0, y: 0, testValues: { 0: 1 }, hbin: 2 },
      { x: 1, y: 0, testValues: { 0: 9 }, hbin: 1 },
    ],
    [
      { x: 0, y: 0, testValues: { 0: 3 }, hbin: 2 },
      { x: 1, y: 0, testValues: { 0: 7 }, hbin: 2 },
    ],
    [
      { x: 0, y: 0, testValues: { 0: 5 }, hbin: 1 },
      { x: 1, y: 0, testValues: { 0: 11 }, hbin: 2 },
    ],
  ];

  const mean = buildWaferMap({
    lotStack: { results: lotStack, method: 'mean' },
    waferConfig: { diameter: 40 },
    dieConfig: { width: 10, height: 10 },
  });
  assert.equal(mean.plotMode, 'value');
  assert.deepEqual(mean.dies.filter((die) => die.testValues).map((die) => die.testValues?.[0]).sort((a, b) => (a ?? 0) - (b ?? 0)), [3, 9]);

  const median = buildWaferMap({
    lotStack: { results: lotStack, method: 'median' },
    waferConfig: { diameter: 40 },
    dieConfig: { width: 10, height: 10 },
  });
  assert.deepEqual(median.dies.filter((die) => die.testValues).map((die) => die.testValues?.[0]).sort((a, b) => (a ?? 0) - (b ?? 0)), [3, 9]);

  const stddev = buildWaferMap({
    lotStack: { results: lotStack, method: 'stddev' },
    waferConfig: { diameter: 40 },
    dieConfig: { width: 10, height: 10 },
  });
  assert.deepEqual(stddev.dies.filter((die) => die.testValues).map((die) => die.testValues?.[0]).sort((a, b) => (a ?? 0) - (b ?? 0)), [2, 2]);

  const countBin = buildWaferMap({
    lotStack: { results: lotStack, method: 'countBin', targetBin: 2 },
    waferConfig: { diameter: 40 },
    dieConfig: { width: 10, height: 10 },
  });
  assert.equal(countBin.plotMode, 'value');
  assert.deepEqual(countBin.dies.filter((die) => die.testValues).map((die) => die.testValues?.[0]).sort((a, b) => (a ?? 0) - (b ?? 0)), [2, 2]);

  const percent = buildWaferMap({
    lotStack: { results: lotStack, method: 'percent', targetBin: 2 },
    waferConfig: { diameter: 40 },
    dieConfig: { width: 10, height: 10 },
  });
  percent.dies.filter((die) => die.testValues).forEach((die) => approxEqual(die.testValues?.[0] ?? 0, 66.6666666667, 1e-6));

  const mode = buildWaferMap({
    lotStack: { results: lotStack, method: 'mode' },
    waferConfig: { diameter: 40 },
    dieConfig: { width: 10, height: 10 },
  });
  assert.equal(mode.plotMode, 'hardBin');
  assert.deepEqual(mode.dies.filter((die) => die.hbin !== undefined).map((die) => die.hbin).sort((a, b) => (a ?? 0) - (b ?? 0)), [2, 2]);
});

test('buildWaferMap marks edge-excluded dies and falls back to hardBin mode when no values are present', () => {
  // diameter=60mm (radius=30), edgeExclusion=5 → keep-zone radius=25mm, pitch=10mm.
  // Symmetric grid [-3..+3]: physX/Y = col*10, so dies at ±30mm are outside the keep zone.
  // Dies at (3,0) → physX=30 → edge-excluded; die at (0,0) → physX=0 → kept.
  const results = [];
  for (let x = -3; x <= 3; x++) {
    for (let y = -3; y <= 3; y++) {
      results.push({ x, y, hbin: 1 });
    }
  }
  const result = buildWaferMap({
    results,
    waferConfig: {
      diameter: 60,
      edgeExclusion: 5,
      notch: { type: 'bottom' },
    },
    dieConfig: { width: 10, height: 10 },
  });

  assert.equal(result.plotMode, 'hardBin');
  assert.ok(result.dies.some((die) => die.edgeExcluded));
  assert.ok(result.dataCoverage.edgeExcludedDies > 0);
  assert.equal(result.dataCoverage.filledDies, results.length);
});

test('buildWaferMap handles empty inputs gracefully', () => {
  const empty = buildWaferMap([]);
  assert.equal(empty.dies.length, 0);
  assert.equal(empty.units, 'normalized');
  assert.equal(empty.dataCoverage.filledDies, 0);
  assert.equal(empty.dataCoverage.totalDies, empty.dies.length);
  assert.equal(empty.yield.totalDies, 0); // No dies with bin data
  assert.equal(empty.yield.yieldPercent, null);
});

test('buildWaferMap handles explicit dies without results', () => {
  const dies = [
    { id: '0_0', x: 0, y: 0, physX: 0, physY: 0, width: 10, height: 10 },
    { id: '1_0', x: 1, y: 0, physX: 10, physY: 0, width: 10, height: 10 },
  ];

  const result = buildWaferMap({
    dies,
    waferConfig: { diameter: 40 },
  });

  assert.equal(result.dies.length, 2);
  assert.equal(result.units, 'mm');
  assert.equal(result.dataCoverage.filledDies, 0);
  assert.equal(result.dataCoverage.totalDies, 2);
});

test('buildWaferMap infers wafer diameter from grid extent when not provided', () => {
  const result = buildWaferMap({
    results: [
      { x: -5, y: -5, testValues: { 0: 1 }, hbin: 1 },
      { x: 5, y: 5, testValues: { 0: 1 }, hbin: 1 },
    ],
    dieConfig: { width: 10, height: 10 },
  });

  assert.ok(result.wafer.diameter > 100); // Should be larger than the grid extent
  assert.equal(result.units, 'mm');
});

// Dies whose testValues are keyed by a non-zero testNumber (e.g. 1050, 1060) — the
// typical shape produced by buildWaferMap when testDefs use testNumber rather than index.
const WAFER_A_DIES = [
  { id: '0_0', i: 0, j: 0, x: 0, y: 0, width: 10, height: 10, testValues: { 1050: 1.0, 1060: 0.5 } },
  { id: '1_0', i: 1, j: 0, x: 10, y: 0, width: 10, height: 10, testValues: { 1050: 3.0, 1060: 1.5 } },
];
const WAFER_B_DIES = [
  { id: '0_0', i: 0, j: 0, x: 0, y: 0, width: 10, height: 10, testValues: { 1050: 3.0, 1060: 2.5 } },
  { id: '1_0', i: 1, j: 0, x: 10, y: 0, width: 10, height: 10, testValues: { 1050: 5.0, 1060: 3.5 } },
];

test('aggregateValues reads from non-zero testNumber keys and stores result at index 0', () => {
  const result = aggregateValues([WAFER_A_DIES, WAFER_B_DIES], 'mean', 1050);
  const d00 = result.find((d) => d.i === 0 && d.j === 0);
  const d10 = result.find((d) => d.i === 1 && d.j === 0);
  // Mean of 1.0 and 3.0 = 2.0; stored at testValues[0] for buildView consumption
  assert.deepEqual(d00?.testValues, { 0: 2.0 });
  // Mean of 3.0 and 5.0 = 4.0
  assert.deepEqual(d10?.testValues, { 0: 4.0 });
});

test('aggregateValues with paramIndex=1060 stores correct mean at index 0', () => {
  const result = aggregateValues([WAFER_A_DIES, WAFER_B_DIES], 'mean', 1060);
  const d00 = result.find((d) => d.i === 0 && d.j === 0);
  // Mean of 0.5 and 2.5 = 1.5
  assert.deepEqual(d00?.testValues, { 0: 1.5 });
});

test('buildView stackedValues mode produces non-grey fills when dies have testValues[0]', () => {
  const wafer = createWafer({ diameter: 40 });
  const aggregated = aggregateValues([WAFER_A_DIES, WAFER_B_DIES], 'mean', 1050);
  const scene = buildView(wafer, aggregated, {
    plotMode: 'stackedValues',
    testDefs: [{ testNumber: 0, name: 'Idsat', unit: 'A' }],
  });
  const fills = scene.rectangles.map((r) => r.fill);
  // All dies with data must render with a colour other than the no-data grey
  assert.ok(fills.every((f) => f !== '#d6d9dd'), `Expected no grey fills, got: ${fills.join(', ')}`);
});

test('buildView stackedValues mode produces grey fills when aggregation used wrong paramIndex', () => {
  // Regression guard: if aggregateValues is called with paramIndex=0 on dies keyed by 1050,
  // all values are missing and buildView must render grey (no-data) — this is the bug state.
  const wafer = createWafer({ diameter: 40 });
  const badAggregated = aggregateValues([WAFER_A_DIES, WAFER_B_DIES], 'mean', 0);
  const scene = buildView(wafer, badAggregated, {
    plotMode: 'stackedValues',
    testDefs: [{ testNumber: 0, name: 'Idsat', unit: 'A' }],
  });
  const fills = scene.rectangles.map((r) => r.fill);
  assert.ok(fills.every((f) => f === '#d6d9dd'), `Expected all grey fills, got: ${fills.join(', ')}`);
});

test('testPass survives buildWaferMap onto result dies, through orientation transforms', () => {
  const results = [
    { x: 0, y: 0, testValues: { 1050: 1.2 }, testPass: { 1050: true, 2001: true }, hbin: 1 },
    { x: 1, y: 0, testValues: { 1050: 3.4 }, testPass: { 1050: false, 2001: false }, hbin: 2 },
    { x: 0, y: 1, testPass: { 2001: true } }, // functional-only die: no testValues at all
  ];
  const result = buildWaferMap({
    results,
    waferConfig: { diameter: 40, notch: { type: 'bottom' } },
    viewOptions: { rotation: 90, flipX: true },
    testDefs: [
      { testNumber: 1050, name: 'Idsat' },
      { testNumber: 2001, name: 'scan_chain', testType: 'F' },
    ],
  });

  const d00 = findDie(result, 0, 0);
  assert.deepEqual(d00.testPass, { 1050: true, 2001: true });
  const d10 = findDie(result, 1, 0);
  assert.deepEqual(d10.testPass, { 1050: false, 2001: false });
  const d01 = findDie(result, 0, 1);
  assert.deepEqual(d01.testPass, { 2001: true });
  assert.equal(d01.testValues, undefined);
  // functional-only data still counts as test data for plot-mode inference
  assert.equal(result.plotMode, 'value');
});

test('getTestPassStatus — recorded verdict, legacy 0/1 fallback for F tests only, undefined otherwise', async () => {
  const { getTestPassStatus } = await import('../dist/index.js');
  const fDef = { testNumber: 2001, name: 'scan_chain', testType: 'F' };
  const pDef = { testNumber: 1050, name: 'Idsat' };

  // recorded verdict wins
  assert.equal(getTestPassStatus({ testPass: { 2001: false }, testValues: { 2001: 1 } }, 2001, fDef), false);
  // legacy 0/1 fallback for F tests
  assert.equal(getTestPassStatus({ testValues: { 2001: 1 } }, 2001, fDef), true);
  assert.equal(getTestPassStatus({ testValues: { 2001: 0 } }, 2001, fDef), false);
  // never applied to parametric tests, even at exactly 0/1
  assert.equal(getTestPassStatus({ testValues: { 1050: 1 } }, 1050, pDef), undefined);
  // non-binary value on an F test is not a verdict
  assert.equal(getTestPassStatus({ testValues: { 2001: 0.5 } }, 2001, fDef), undefined);
  // no data at all
  assert.equal(getTestPassStatus({}, 2001, fDef), undefined);
});

test('lot aggregation never carries per-wafer testPass into aggregated dies', async () => {
  const { aggregateBinCounts } = await import('../dist/index.js');
  const w1 = [
    { id: '0_0', x: 0, y: 0, testValues: { 0: 10 }, testPass: { 0: true }, width: 10, height: 10, physX: 0, physY: 0 },
    { id: '1_0', x: 1, y: 0, testPass: { 2001: false }, hbin: 5, width: 10, height: 10, physX: 10, physY: 0 },
  ];
  const w2 = [
    { id: '0_0', x: 0, y: 0, testValues: { 0: 30 }, testPass: { 0: false }, width: 10, height: 10, physX: 0, physY: 0 },
    { id: '1_0', x: 1, y: 0, testPass: { 2001: true }, hbin: 5, width: 10, height: 10, physX: 10, physY: 0 },
  ];
  for (const die of aggregateValues([w1, w2], 'mean')) assert.equal(die.testPass, undefined);
  for (const die of aggregateBinCounts([w1, w2], 5, 'hard')) assert.equal(die.testPass, undefined);
});

test('lotStack value aggregation skips functional tests (including legacy 0/1 encoding)', () => {
  const testDefs = [
    { testNumber: 1010, name: 'Vth', unit: 'V' },
    { testNumber: 2001, name: 'scan_chain', testType: 'F' },
  ];
  const w1 = [
    { x: 0, y: 0, testValues: { 1010: 1.0, 2001: 1 } },
    { x: 1, y: 0, testValues: { 1010: 2.0, 2001: 0 } },
  ];
  const w2 = [
    { x: 0, y: 0, testValues: { 1010: 3.0, 2001: 1 } },
    { x: 1, y: 0, testValues: { 1010: 4.0, 2001: 1 } },
  ];
  const result = buildWaferMap({
    lotStack: { results: [w1, w2], method: 'mean' },
    waferConfig: { diameter: 40 },
    dieConfig: { width: 10, height: 10 },
    testDefs,
  });
  const d00 = findDie(result, 0, 0);
  approxEqual(d00.testValues[1010], 2.0);
  assert.equal(d00.testValues[2001], undefined, 'functional test never aggregated into value stacks');
});

// ── metadataFields (generic categorical/layout plot mode) ───────────────────

test('metadataFields is promoted onto WaferMapResult', () => {
  const results = [
    { x: 0, y: 0, hbin: 1, metadata: { project: 'our-project' } },
    { x: 1, y: 0, hbin: 1, metadata: { project: 'vendor' } },
  ];
  const metadataFields = [{ key: 'project', label: 'Project' }];
  const result = buildWaferMap({
    results,
    waferConfig: { diameter: 40 },
    dieConfig: { width: 10, height: 10 },
    metadataFields,
  });
  assert.deepEqual(result.metadataFields, metadataFields);
});

test('a die can carry both hbin and metadata — neither is dropped', () => {
  const results = [{ x: 0, y: 0, hbin: 1, metadata: { project: 'our-project' } }];
  const result = buildWaferMap({
    results,
    waferConfig: { diameter: 40 },
    dieConfig: { width: 10, height: 10 },
    metadataFields: [{ key: 'project' }],
  });
  const d00 = findDie(result, 0, 0);
  assert.equal(d00.hbin, 1);
  assert.deepEqual(d00.metadata, { project: 'our-project' });
});

test('autoPlotMode never selects metadata mode, even when metadataFields is configured', () => {
  // No test values and no bins — historically falls back to 'hardBin' (all no-data
  // grey). Configuring metadataFields must not change this default, since there is
  // no principled key to pick automatically — 'metadata' is purely opt-in.
  const results = [
    { x: 0, y: 0, metadata: { project: 'our-project' } },
    { x: 1, y: 0, metadata: { project: 'vendor' } },
  ];
  const result = buildWaferMap({
    results,
    waferConfig: { diameter: 40 },
    dieConfig: { width: 10, height: 10 },
    metadataFields: [{ key: 'project' }],
  });
  assert.equal(result.plotMode, 'hardBin');
});

test('coordinate-less dies (no x/y) are kept, not dropped, and excluded from positioned coverage', () => {
  const results = [
    { x: 0, y: 0, hbin: 1, testValues: { 0: 1.0 } },
    { x: 1, y: 0, hbin: 2, testValues: { 0: 2.0 } },
    { hbin: 1, testValues: { 0: 3.0 } },
    { hbin: 2, testValues: { 0: 4.0 } },
    { hbin: 1, testValues: { 0: 5.0 } },
  ];
  const result = buildWaferMap({
    results,
    waferConfig: { diameter: 40 },
    dieConfig: { width: 10, height: 10 },
  });

  assert.equal(result.dies.length, 5, 'unpositioned dies must still appear in dies[]');
  const unpositioned = result.dies.filter((d) => d.x === undefined);
  assert.equal(unpositioned.length, 3);
  for (const d of unpositioned) {
    assert.equal(d.y, undefined);
    assert.equal(d.physX, undefined);
    assert.equal(d.physY, undefined);
    assert.ok(d.id.startsWith('unpositioned_'));
  }
  // Every unpositioned die must have a distinct id (and therefore key).
  const ids = new Set(unpositioned.map((d) => d.id));
  assert.equal(ids.size, 3);

  // dataCoverage.totalDies/filledDies/ratio are scoped to POSITIONED dies only.
  assert.equal(result.dataCoverage.totalDies, 2);
  assert.equal(result.dataCoverage.filledDies, 2);
  assert.equal(result.dataCoverage.unpositionedDies, 3);

  // Yield is not spatial — unpositioned dies with bin data still count.
  assert.equal(result.yield.totalDies, 5);
  assert.equal(result.yield.passDies, 3); // hbin 1, three times
  assert.equal(result.yield.failDies, 2); // hbin 2, twice
});

test('a die with only one of x/y set throws — no half-positioned state', () => {
  assert.throws(() => {
    buildWaferMap({
      results: [{ x: 0, hbin: 1 }],
      waferConfig: { diameter: 40 },
      dieConfig: { width: 10, height: 10 },
    });
  }, TypeError);
  assert.throws(() => {
    buildWaferMap({
      results: [{ y: 0, hbin: 1 }],
      waferConfig: { diameter: 40 },
      dieConfig: { width: 10, height: 10 },
    });
  }, TypeError);
});

test('a fully coordinate-less wafer (no positioned dies at all) does not throw', () => {
  const results = [
    { hbin: 1, testValues: { 0: 1.0 } },
    { hbin: 2, testValues: { 0: 2.0 } },
  ];
  const result = buildWaferMap({ results, waferConfig: { diameter: 40 } });

  assert.equal(result.dies.length, 2);
  assert.equal(result.dataCoverage.totalDies, 0);
  assert.equal(result.dataCoverage.unpositionedDies, 2);
  assert.equal(result.dataCoverage.ratio, 0, 'ratio must not be NaN when totalDies is 0');
  assert.equal(result.yield.totalDies, 2, 'yield still counts unpositioned dies — it is not spatial');
});
