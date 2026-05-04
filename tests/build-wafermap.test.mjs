import test from 'node:test';
import assert from 'node:assert/strict';

import { buildWaferMap } from '../dist/index.js';

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
    { x: 0, y: 0, values: [0.4], bins: [1] },
    { x: 0, y: 0, values: [0.9], bins: [2] },
    { x: 1, y: 0, values: [0.8], bins: [1] },
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

  assert.deepEqual(findDie(first, 0, 0)?.values, [0.4]);
  assert.deepEqual(findDie(first, 0, 0)?.bins, [1]);
  assert.equal(findDie(first, 0, 0)?.retestCount, 2);

  assert.deepEqual(findDie(last, 0, 0)?.values, [0.9]);
  assert.deepEqual(findDie(last, 0, 0)?.bins, [2]);
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
    results: [{ x: 0, y: 0, values: [1.23], bins: [1] }],
    waferConfig: {
      diameter: 60,
      metadata: { lot: 'LOT-9', waferNumber: 7 },
    },
    reticleConfig: { width: 1, height: 1 },
  });

  assert.equal(result.units, 'mm');
  assert.equal(result.wafer.metadata?.lot, 'LOT-9');
  assert.equal(result.scene.metadata?.lot, 'LOT-9');
  assert.deepEqual(findDie(result, 0, 0)?.values, [1.23]);
  assert.ok(result.scene.overlays.some((overlay) => overlay.kind === 'reticle'));
  assert.equal(result.dataCoverage.totalDies, 2);
});

test('buildWaferMap collapses lot stacks before rendering', () => {
  const lotStack = [
    [
      { x: 0, y: 0, values: [1], bins: [2] },
      { x: 1, y: 0, values: [9], bins: [1] },
    ],
    [
      { x: 0, y: 0, values: [3], bins: [2] },
      { x: 1, y: 0, values: [7], bins: [2] },
    ],
    [
      { x: 0, y: 0, values: [5], bins: [1] },
      { x: 1, y: 0, values: [11], bins: [2] },
    ],
  ];

  const mean = buildWaferMap({
    lotStack: { results: lotStack, method: 'mean' },
    waferConfig: { diameter: 40 },
    dieConfig: { width: 10, height: 10 },
  });
  assert.equal(mean.scene.plotMode, 'value');
  assert.deepEqual(mean.dies.filter((die) => die.values).map((die) => die.values?.[0]).sort((a, b) => (a ?? 0) - (b ?? 0)), [3, 9]);

  const median = buildWaferMap({
    lotStack: { results: lotStack, method: 'median' },
    waferConfig: { diameter: 40 },
    dieConfig: { width: 10, height: 10 },
  });
  assert.deepEqual(median.dies.filter((die) => die.values).map((die) => die.values?.[0]).sort((a, b) => (a ?? 0) - (b ?? 0)), [3, 9]);

  const stddev = buildWaferMap({
    lotStack: { results: lotStack, method: 'stddev' },
    waferConfig: { diameter: 40 },
    dieConfig: { width: 10, height: 10 },
  });
  assert.deepEqual(stddev.dies.filter((die) => die.values).map((die) => die.values?.[0]).sort((a, b) => (a ?? 0) - (b ?? 0)), [2, 2]);

  const countBin = buildWaferMap({
    lotStack: { results: lotStack, method: 'countBin', targetBin: 2 },
    waferConfig: { diameter: 40 },
    dieConfig: { width: 10, height: 10 },
  });
  assert.equal(countBin.scene.plotMode, 'value');
  assert.deepEqual(countBin.dies.filter((die) => die.values).map((die) => die.values?.[0]).sort((a, b) => (a ?? 0) - (b ?? 0)), [2, 2]);

  const percent = buildWaferMap({
    lotStack: { results: lotStack, method: 'percent', targetBin: 2 },
    waferConfig: { diameter: 40 },
    dieConfig: { width: 10, height: 10 },
  });
  percent.dies.filter((die) => die.values).forEach((die) => approxEqual(die.values?.[0] ?? 0, 66.6666666667, 1e-6));

  const mode = buildWaferMap({
    lotStack: { results: lotStack, method: 'mode' },
    waferConfig: { diameter: 40 },
    dieConfig: { width: 10, height: 10 },
  });
  assert.equal(mode.scene.plotMode, 'hardbin');
  assert.deepEqual(mode.dies.filter((die) => die.bins).map((die) => die.bins?.[0]).sort((a, b) => (a ?? 0) - (b ?? 0)), [2, 2]);
});

test('buildWaferMap marks edge-excluded dies and falls back to hardbin mode when no values are present', () => {
  const result = buildWaferMap({
    results: [
      { x: 0, y: 0, bins: [1] },
      { x: 1, y: 0, bins: [2] },
    ],
    waferConfig: {
      diameter: 60,
      edgeExclusion: 5,
      notch: { type: 'bottom' },
    },
    dieConfig: { width: 10, height: 10 },
  });

  assert.equal(result.scene.plotMode, 'hardbin');
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
      { x: -5, y: -5, values: [1], bins: [1] },
      { x: 5, y: 5, values: [1], bins: [1] },
    ],
    dieConfig: { width: 10, height: 10 },
  });

  assert.ok(result.wafer.diameter > 100); // Should be larger than the grid extent
  assert.equal(result.units, 'mm');
});
