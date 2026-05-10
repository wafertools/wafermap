import test from 'node:test';
import assert from 'node:assert/strict';

import { buildWaferMap, aggregateValues, buildScene, createWafer } from '../dist/index.js';

function approxEqual(actual, expected, epsilon = 1e-9) {
  assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} != ${expected}`);
}

function findDie(result, i, j) {
  return result.dies.find((die) => die.i === i && die.j === j);
}

test('buildWaferMap applies retest policy and chooses plot mode from the data', () => {
  const dies = [
    { id: '0_0', i: 0, j: 0, x: 0, y: 0, width: 10, height: 10 },
    { id: '1_0', i: 1, j: 0, x: 10, y: 0, width: 10, height: 10 },
  ];
  const results = [
    { x: 0, y: 0, values: [0.4], hbin: 1 },
    { x: 0, y: 0, values: [0.9], hbin: 2 },
    { x: 1, y: 0, values: [0.8], hbin: 1 },
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

  assert.equal(first.scene.plotMode, 'value');
  assert.equal(last.scene.plotMode, 'value');

  assert.deepEqual(findDie(first, 0, 0)?.testValues, { 0: 0.4 });
  assert.equal(findDie(first, 0, 0)?.hbin, 1);
  assert.equal(findDie(first, 0, 0)?.retestCount, 2);

  assert.deepEqual(findDie(last, 0, 0)?.testValues, { 0: 0.9 });
  assert.equal(findDie(last, 0, 0)?.hbin, 2);
  assert.equal(findDie(last, 0, 0)?.retestCount, 2);

  assert.equal(first.yield.passDies, 2);
  assert.equal(first.yield.failDies, 0);
  assert.equal(first.yield.yieldPercent, 1);

  assert.equal(last.yield.passDies, 1);
  assert.equal(last.yield.failDies, 1);
  assert.equal(last.yield.yieldPercent, 0.5);
});

test('buildWaferMap accepts explicit dies and enables reticles by default when configured', () => {
  const dies = [
    { id: '0_0', i: 0, j: 0, x: 0, y: 0, width: 10, height: 10 },
    { id: '1_0', i: 1, j: 0, x: 10, y: 0, width: 10, height: 10 },
  ];

  const result = buildWaferMap({
    dies,
    results: [{ x: 0, y: 0, values: [1.23], hbin: 1 }],
    waferConfig: {
      diameter: 60,
      metadata: { lot: 'LOT-9', waferNumber: 7 },
    },
    reticleConfig: { width: 1, height: 1 },
  });

  assert.equal(result.units, 'mm');
  assert.equal(result.wafer.metadata?.lot, 'LOT-9');
  assert.equal(result.scene.metadata?.lot, 'LOT-9');
  assert.deepEqual(findDie(result, 0, 0)?.testValues, { 0: 1.23 });
  assert.ok(result.scene.overlays.some((overlay) => overlay.kind === 'reticle'));
  assert.equal(result.dataCoverage.totalDies, 2);
});

test('buildWaferMap collapses lot stacks before rendering', () => {
  const lotStack = [
    [
      { x: 0, y: 0, values: [1], hbin: 2 },
      { x: 1, y: 0, values: [9], hbin: 1 },
    ],
    [
      { x: 0, y: 0, values: [3], hbin: 2 },
      { x: 1, y: 0, values: [7], hbin: 2 },
    ],
    [
      { x: 0, y: 0, values: [5], hbin: 1 },
      { x: 1, y: 0, values: [11], hbin: 2 },
    ],
  ];

  const mean = buildWaferMap({
    lotStack: { results: lotStack, method: 'mean' },
    waferConfig: { diameter: 40 },
    dieConfig: { width: 10, height: 10 },
  });
  assert.equal(mean.scene.plotMode, 'value');
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
  assert.equal(countBin.scene.plotMode, 'value');
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
  assert.equal(mode.scene.plotMode, 'hardBin');
  assert.deepEqual(mode.dies.filter((die) => die.hbin !== undefined).map((die) => die.hbin).sort((a, b) => (a ?? 0) - (b ?? 0)), [2, 2]);
});

test('buildWaferMap marks edge-excluded dies and falls back to hardBin mode when no values are present', () => {
  const result = buildWaferMap({
    results: [
      { x: 0, y: 0, hbin: 1 },
      { x: 1, y: 0, hbin: 2 },
    ],
    waferConfig: {
      diameter: 60,
      edgeExclusion: 5,
      notch: { type: 'bottom' },
    },
    dieConfig: { width: 10, height: 10 },
  });

  assert.equal(result.scene.plotMode, 'hardBin');
  assert.ok(result.dies.some((die) => die.edgeExcluded));
  assert.ok(result.dataCoverage.edgeExcludedDies > 0);
  assert.equal(result.dataCoverage.filledDies, 2);
});

test('buildWaferMap handles empty inputs gracefully', () => {
  const empty = buildWaferMap([]);
  assert.ok(empty.dies.length > 0); // Still generates default grid
  assert.equal(empty.units, 'normalized');
  assert.equal(empty.dataCoverage.filledDies, 0);
  assert.equal(empty.dataCoverage.totalDies, empty.dies.length);
  assert.equal(empty.yield.totalDies, 0); // No dies with bin data
  assert.equal(empty.yield.yieldPercent, null);
});

test('buildWaferMap handles explicit dies without results', () => {
  const dies = [
    { id: '0_0', i: 0, j: 0, x: 0, y: 0, width: 10, height: 10 },
    { id: '1_0', i: 1, j: 0, x: 10, y: 0, width: 10, height: 10 },
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
      { x: -5, y: -5, values: [1], hbin: 1 },
      { x: 5, y: 5, values: [1], hbin: 1 },
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
  // Mean of 1.0 and 3.0 = 2.0; stored at testValues[0] for buildScene consumption
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

test('buildScene stackedValues mode produces non-grey fills when dies have testValues[0]', () => {
  const wafer = createWafer({ diameter: 40 });
  const aggregated = aggregateValues([WAFER_A_DIES, WAFER_B_DIES], 'mean', 1050);
  const scene = buildScene(wafer, aggregated, {
    plotMode: 'stackedValues',
    testDefs: [{ index: 0, name: 'Idsat', unit: 'A' }],
  });
  const fills = scene.rectangles.map((r) => r.fill);
  // All dies with data must render with a colour other than the no-data grey
  assert.ok(fills.every((f) => f !== '#d6d9dd'), `Expected no grey fills, got: ${fills.join(', ')}`);
});

test('buildScene stackedValues mode produces grey fills when aggregation used wrong paramIndex', () => {
  // Regression guard: if aggregateValues is called with paramIndex=0 on dies keyed by 1050,
  // all values are missing and buildScene must render grey (no-data) — this is the bug state.
  const wafer = createWafer({ diameter: 40 });
  const badAggregated = aggregateValues([WAFER_A_DIES, WAFER_B_DIES], 'mean', 0);
  const scene = buildScene(wafer, badAggregated, {
    plotMode: 'stackedValues',
    testDefs: [{ index: 0, name: 'Idsat', unit: 'A' }],
  });
  const fills = scene.rectangles.map((r) => r.fill);
  assert.ok(fills.every((f) => f === '#d6d9dd'), `Expected all grey fills, got: ${fills.join(', ')}`);
});
