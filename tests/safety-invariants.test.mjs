import test from 'node:test';
import assert from 'node:assert/strict';

import { buildWaferMap, buildView, buildHoverText, createWafer } from '../dist/index.js';

// ── Coordinate correctness ────────────────────────────────────────────────────
// All coordinates shown to the user must be original die grid coords (die.x/die.y),
// never internal display or transformed (physX/physY) values.

test('hoverPoints text shows original die grid coords after 90° rotation', () => {
  const result = buildWaferMap({
    results: [
      { x: 3, y: 7, hbin: 1 },
      { x: -2, y: 4, hbin: 2 },
    ],
    waferConfig: { diameter: 300, orientation: 90 },
    dieConfig: { width: 10, height: 10 },
  });

  const scene = buildView(result.wafer, result.dies, {
    plotMode: 'hardBin',
    rotation: 90,
  });

  for (const die of scene.dies) {
    const text = buildHoverText(die, 'hardBin');
    const match = text.match(/Die \((-?\d+), (-?\d+)\)/);
    assert.ok(match, `hover text has no Die (x, y): ${text}`);
    const x = parseInt(match[1], 10);
    const y = parseInt(match[2], 10);
    const original = result.dies.find((d) => d.x === x && d.y === y);
    assert.ok(original, `hover text shows coords (${x},${y}) not found in original dies`);
  }
});

test('hoverPoints text shows original die grid coords after flipX', () => {
  const result = buildWaferMap({
    results: [
      { x: 5, y: -3, hbin: 1 },
      { x: -1, y: 2, hbin: 2 },
    ],
    waferConfig: { diameter: 300 },
    dieConfig: { width: 10, height: 10 },
  });

  const scene = buildView(result.wafer, result.dies, {
    plotMode: 'hardBin',
    flipX: true,
  });

  for (const die of scene.dies) {
    const text = buildHoverText(die, 'hardBin');
    const match = text.match(/Die \((-?\d+), (-?\d+)\)/);
    assert.ok(match, `hover text has no Die (x, y): ${text}`);
    const x = parseInt(match[1], 10);
    const y = parseInt(match[2], 10);
    const original = result.dies.find((d) => d.x === x && d.y === y);
    assert.ok(original, `hover text shows coords (${x},${y}) not found in original dies`);
  }
});

// ── isLotStack gating ─────────────────────────────────────────────────────────
// scene.isLotStack must be true only when lotStack was passed to buildWaferMap,
// and false for single-wafer inputs.

test('scene.isLotStack is false for single-wafer buildWaferMap', () => {
  const result = buildWaferMap({
    results: [{ x: 0, y: 0, hbin: 1 }],
    waferConfig: { diameter: 300 },
    dieConfig: { width: 10, height: 10 },
  });
  assert.equal(result.view.isLotStack, false);
});

test('scene.isLotStack is true when lotStack is passed', () => {
  const result = buildWaferMap({
    lotStack: {
      results: [
        [{ x: 0, y: 0, hbin: 1 }],
        [{ x: 0, y: 0, hbin: 2 }],
      ],
      method: 'mode',
    },
    waferConfig: { diameter: 300 },
    dieConfig: { width: 10, height: 10 },
  });
  assert.equal(result.view.isLotStack, true);
});

test('buildView isLotStack defaults to false', () => {
  const wafer = createWafer({ diameter: 300 });
  const scene = buildView(wafer, [], { plotMode: 'hardBin' });
  assert.equal(scene.isLotStack, false);
});

// ── colorbarRangeMode independence from out-of-spec coloring ─────────────────
// Out-of-spec dies must render blue/red regardless of colorbarRangeMode.
// colorbarRangeMode only affects the colorbar bounds, not die fill colors.

const SPEC_FAIL_LOW  = '#3498db';
const SPEC_FAIL_HIGH = '#e74c3c';

test('out-of-spec dies get fail color regardless of colorbarRangeMode=spec', () => {
  const wafer = createWafer({ diameter: 300 });
  const dies = [
    { id: '0_0', x: 0, y: 0, physX: 0,  physY: 0,  width: 10, height: 10, testValues: { 0: 0.1 } },
    { id: '1_0', x: 1, y: 0, physX: 10, physY: 0,  width: 10, height: 10, testValues: { 0: 5.0 } },
    { id: '0_1', x: 0, y: 1, physX: 0,  physY: 10, width: 10, height: 10, testValues: { 0: 2.5 } },
  ];

  const scene = buildView(wafer, dies, {
    plotMode: 'value',
    colorbarRangeMode: 'spec',
    activeTest: 0,
    testDefs: [{ index: 0, name: 'Vt', unit: 'V', limitLow: 0.5, limitHigh: 4.5 }],
  });

  // rectangles use physX/physY as x/y
  const rect00 = scene.rectangles.find((r) => r.x === 0  && r.y === 0);
  const rect10 = scene.rectangles.find((r) => r.x === 10 && r.y === 0);
  const rect01 = scene.rectangles.find((r) => r.x === 0  && r.y === 10);

  assert.equal(rect00?.fill, SPEC_FAIL_LOW,  'value below limitLow must render as spec-fail-low (blue)');
  assert.equal(rect10?.fill, SPEC_FAIL_HIGH, 'value above limitHigh must render as spec-fail-high (red)');
  assert.notEqual(rect01?.fill, SPEC_FAIL_LOW,  'in-spec die must not render as spec-fail-low');
  assert.notEqual(rect01?.fill, SPEC_FAIL_HIGH, 'in-spec die must not render as spec-fail-high');
});

test('out-of-spec dies get fail color regardless of colorbarRangeMode=data', () => {
  const wafer = createWafer({ diameter: 300 });
  const dies = [
    { id: '0_0', x: 0, y: 0, physX: 0,  physY: 0,  width: 10, height: 10, testValues: { 0: 0.1 } },
    { id: '1_0', x: 1, y: 0, physX: 10, physY: 0,  width: 10, height: 10, testValues: { 0: 5.0 } },
    { id: '0_1', x: 0, y: 1, physX: 0,  physY: 10, width: 10, height: 10, testValues: { 0: 2.5 } },
  ];

  const scene = buildView(wafer, dies, {
    plotMode: 'value',
    colorbarRangeMode: 'data',
    activeTest: 0,
    testDefs: [{ index: 0, name: 'Vt', unit: 'V', limitLow: 0.5, limitHigh: 4.5 }],
  });

  const rect00 = scene.rectangles.find((r) => r.x === 0  && r.y === 0);
  const rect10 = scene.rectangles.find((r) => r.x === 10 && r.y === 0);

  assert.equal(rect00?.fill, SPEC_FAIL_LOW,  'value below limitLow must render as spec-fail-low regardless of colorbarRangeMode=data');
  assert.equal(rect10?.fill, SPEC_FAIL_HIGH, 'value above limitHigh must render as spec-fail-high regardless of colorbarRangeMode=data');
});
