import test from 'node:test';
import assert from 'node:assert/strict';

import {
  aggregateBinCounts,
  aggregateValues,
  applyOrientation,
  applyProbeSequence,
  buildScene,
  classifyDie,
  clipDiesToWafer,
  contrastTextColor,
  createWafer,
  generateDies,
  generateReticleGrid,
  generateTextOverlay,
  getColorScheme,
  getDieAtPoint,
  getDieKey,
  getRingLabel,
  getUniqueBins,
  hardBinColor,
  hardBinGreyscale,
  listColorSchemes,
  mapDataToDies,
  registerColorScheme,
  softBinColor,
  transformDies,
  toPlotly,
  valueToGreyscale,
  valueToViridis,
} from '../dist/index.js';
import { fmt, fmtColorbarAxis } from '../dist/packages/renderer/fmt.js';
import {
  assignGridIndices,
  inferWaferFromXY,
  resolveGridPitch,
} from '../dist/packages/core/inference/index.js';

function approxEqual(actual, expected, epsilon = 1e-9) {
  assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} != ${expected}`);
}

function buildSampleDies() {
  return [
    { id: '0_0', x: 0, y: 0, physX: 0, physY: 0, width: 10, height: 10, values: [0.9], hbin: 1 },
    { id: '1_0', x: 1, y: 0, physX: 10, physY: 0, width: 10, height: 10, values: [0.7], hbin: 2 },
    { id: '0_1', x: 0, y: 1, physX: 0, physY: 10, width: 10, height: 10, values: [0.8], hbin: 1 },
    { id: '1_1', x: 1, y: 1, physX: 10, physY: 10, width: 10, height: 10, values: [0.6], hbin: 2 },
  ];
}

test('core geometry, data mapping, sequencing, and reticle helpers stay stable', () => {
  const wafer = createWafer({
    diameter: 40,
    notch: { type: 'bottom' },
    metadata: { lot: 'LOT-001', waferNumber: 1 },
  });

  assert.equal(wafer.radius, 20);
  assert.deepEqual(wafer.center, { x: 0, y: 0 });
  assert.equal(wafer.notch?.length, 32.5);

  const dies = generateDies(wafer, { width: 10, height: 10, gridSize: 2 });
  assert.equal(dies.length, 25);
  assert.ok(dies.some((die) => die.id === '0_0'));

  const clipped = clipDiesToWafer(dies, wafer, { width: 10, height: 10 });
  assert.ok(clipped.length < dies.length);
  assert.ok(clipped.every((die) => die.insideWafer === true));
  assert.ok(clipped.some((die) => die.partial));

  const mapped = mapDataToDies(clipped, [
    { x: 0, y: 0, value: 0.97 },
    { x: 1, y: 0, value: 0.88 },
    { x: 1, y: 0, value: 0.91 },
  ], { valueField: 'value', matchBy: 'ij' });
  assert.deepEqual(mapped.find((die) => die.x === 0 && die.y === 0)?.values, [0.97]);
  assert.deepEqual(mapped.find((die) => die.x === 1 && die.y === 0)?.values, [0.91]);

  const oriented = applyOrientation([
    { id: '1_0', x: 1, y: 0, physX: 10, physY: 0, width: 10, height: 10 },
    { id: '0_1', x: 0, y: 1, physX: 0, physY: 10, width: 10, height: 10 },
  ], createWafer({ diameter: 100, orientation: 90 }));
  assert.equal(Math.round(oriented[0].physX), 0);
  assert.equal(Math.round(oriented[0].physY), 10);

  const transformed = transformDies(oriented, { rotation: 90, flipX: true }, wafer.center);
  assert.equal(Math.round(transformed[0].physX), 10);
  assert.equal(Math.round(transformed[0].physY), 0);

  const sequenced = applyProbeSequence([
    { id: '0_1', x: 0, y: 1, physX: 0, physY: 10, width: 10, height: 10 },
    { id: '1_1', x: 1, y: 1, physX: 10, physY: 10, width: 10, height: 10 },
    { id: '0_0', x: 0, y: 0, physX: 0, physY: 0, width: 10, height: 10 },
    { id: '1_0', x: 1, y: 0, physX: 10, physY: 0, width: 10, height: 10 },
  ], { type: 'snake' });
  assert.deepEqual(
    sequenced.map((die) => `${die.id}:${die.probeIndex}`),
    ['0_1:0', '1_1:1', '1_0:2', '0_0:3'],
  );

  const customSequenced = applyProbeSequence([
    { id: 'a', x: 0, y: 0, physX: 0, physY: 0, width: 10, height: 10 },
    { id: 'b', x: 1, y: 0, physX: 10, physY: 0, width: 10, height: 10 },
  ], { type: 'custom', customOrder: ['b', 'a'] });
  assert.deepEqual(customSequenced.map((die) => die.probeIndex), [1, 0]);

  const reticles = generateReticleGrid(wafer, { width: 2, height: 2, diePitchX: 10, diePitchY: 10 });
  const shiftedReticles = generateReticleGrid(wafer, {
    width: 2,
    height: 2,
    diePitchX: 10,
    diePitchY: 10,
    anchorDie: { x: 1, y: 1 },
  });
  assert.ok(reticles.length > 0);
  assert.ok(reticles.every((reticle) => reticle.width === 20 && reticle.height === 20));
  assert.notDeepEqual(
    reticles.slice(0, 3).map((reticle) => `${reticle.x},${reticle.y}`),
    shiftedReticles.slice(0, 3).map((reticle) => `${reticle.x},${reticle.y}`),
  );
});

test('aggregation, inference, classification, formatting, and color helpers are deterministic', () => {
  const diesByWafer = [
    [
      { id: '0_0', x: 0, y: 0, physX: 0, physY: 0, width: 10, height: 10, values: [1], hbin: 2 },
      { id: '1_0', x: 1, y: 0, physX: 10, physY: 0, width: 10, height: 10, values: [9], hbin: 1 },
    ],
    [
      { id: '0_0', x: 0, y: 0, physX: 0, physY: 0, width: 10, height: 10, values: [3], hbin: 2 },
      { id: '1_0', x: 1, y: 0, physX: 10, physY: 0, width: 10, height: 10, values: [7], hbin: 2 },
    ],
    [
      { id: '0_0', x: 0, y: 0, physX: 0, physY: 0, width: 10, height: 10, values: [5], hbin: 1 },
      { id: '1_0', x: 1, y: 0, physX: 10, physY: 0, width: 10, height: 10, values: [11], hbin: 2 },
    ],
  ];

  assert.deepEqual(aggregateValues(diesByWafer, 'mean').find((die) => die.x === 0 && die.y === 0)?.testValues, { 0: 3 });
  assert.deepEqual(aggregateValues(diesByWafer, 'median').find((die) => die.x === 0 && die.y === 0)?.testValues, { 0: 3 });
  approxEqual(
    aggregateValues(diesByWafer, 'stddev').find((die) => die.x === 0 && die.y === 0)?.testValues?.[0] ?? 0,
    Math.sqrt(4),
  );
  assert.deepEqual(aggregateValues(diesByWafer, 'min').find((die) => die.x === 0 && die.y === 0)?.testValues, { 0: 1 });
  assert.deepEqual(aggregateValues(diesByWafer, 'max').find((die) => die.x === 0 && die.y === 0)?.testValues, { 0: 5 });
  assert.deepEqual(aggregateValues(diesByWafer, 'count').find((die) => die.x === 0 && die.y === 0)?.testValues, { 0: 3 });
  assert.deepEqual(getUniqueBins(diesByWafer[0]), [1, 2]);
  assert.deepEqual(aggregateBinCounts(diesByWafer, 2).find((die) => die.x === 0 && die.y === 0)?.testValues, { 0: 2 });

  assert.deepEqual(classifyDie({ id: '1_1', x: 1, y: 1, physX: 9, physY: 9, width: 1, height: 1 }, createWafer({ diameter: 20 })), { ring: 4, quadrant: 'NE' });
  assert.equal(getRingLabel(1, 1), 'Full Wafer');
  assert.equal(getRingLabel(1, 2), 'Ring 1 (core)');
  assert.equal(getRingLabel(2, 2), 'Ring 2 (edge)');
  assert.equal(getRingLabel(3, 5), 'Ring 3');
  assert.equal(getRingLabel(1, 4), 'Ring 1 (core)');
  assert.equal(getRingLabel(4, 4), 'Ring 4 (edge)');

  assert.deepEqual(assignGridIndices([
    { x: 0, y: 0 },
    { x: 1, y: 1 },
  ]), {
    indices: [{ x: -1, y: -1 }, { x: 0, y: 0 }],
    offsetX: 1,
    offsetY: 1,
    confidence: 1,
  });

  const inferredWafer = inferWaferFromXY([
    { x: 90, y: 0 },
    { x: -90, y: 0 },
    { x: 0, y: 90 },
    { x: 0, y: -90 },
  ]);
  assert.deepEqual(inferredWafer, {
    center: { x: 0, y: 0 },
    diameter: 200,
    radius: 100,
    confidence: 1,
    method: 'snapped-200mm',
  });

  assert.deepEqual(resolveGridPitch([
    { x: 0, y: 0 },
    { x: 2, y: 0 },
    { x: 0, y: 1 },
    { x: 2, y: 1 },
  ]), {
    pitchX: 1,
    pitchY: 0.5,
    units: 'normalized',
    confidence: 0.5,
  });
  assert.deepEqual(resolveGridPitch([], { width: 11 }), {
    pitchX: 11,
    pitchY: 11,
    units: 'mm',
    confidence: 0,
  });

  assert.equal(fmt(0), '0');
  assert.equal(fmt(1234), '1234');
  assert.equal(fmt(1e6, undefined, 'engineering'), '1.00E+6');
  assert.equal(fmt(2e-6, 'A'), '2.00 µA');
  assert.equal(fmtColorbarAxis(1e-6, 'Idsat', 'A').axisLabel, 'Idsat (µA)');
  assert.equal(fmtColorbarAxis(1e-6, 'Idsat', 'A').tickFmt(2e-6), '2.00');

  assert.equal(hardBinColor(1), '#2ecc71');
  assert.equal(hardBinColor(999), '#16a085');
  assert.equal(hardBinGreyscale(1), '#f7f7f7');
  assert.equal(softBinColor(3, 6), valueToViridis(0.5));
  assert.equal(valueToViridis(-1), 'rgb(68,1,84)');
  assert.equal(valueToGreyscale(1), 'rgb(230,230,230)');
  assert.equal(contrastTextColor('#ffffff'), '#000000');
  assert.equal(contrastTextColor('#000000'), '#ffffff');

  assert.equal(getColorScheme('default').label, 'Default');
  assert.ok(listColorSchemes().some((scheme) => scheme.name === 'default'));
  assert.ok(listColorSchemes().some((scheme) => scheme.name === 'accessible'));

  registerColorScheme('custom-suite', {
    label: 'Custom Suite',
    forBin: (bin) => `bin-${bin}`,
    forValue: (t) => `value-${t.toFixed(2)}`,
    plotlyColorscale: [[0, '#000000'], [1, '#ffffff']],
  });
  assert.equal(getColorScheme('custom-suite').label, 'Custom Suite');
  assert.ok(listColorSchemes().some((scheme) => scheme.name === 'custom-suite'));
});

test('renderer scene assembly and Plotly conversion preserve the public contract', () => {
  const wafer = createWafer({
    diameter: 60,
    metadata: {
      lot: 'LOT-001',
      waferNumber: 1,
      testDate: '2026-04-21',
      testProgram: 'CP1',
      temperature: 25,
    },
  });

  const dies = applyProbeSequence(buildSampleDies(), { type: 'snake' });
  const reticles = generateReticleGrid(wafer, { width: 2, height: 2, diePitchX: 10, diePitchY: 10 });

  const scene = buildScene(wafer, dies, {
    plotMode: 'hardBin',
    showText: true,
    showReticle: true,
    showProbePath: true,
    showRingBoundaries: true,
    showQuadrantBoundaries: true,
    showXYIndicator: true,
    ringCount: 4,
    reticles,
    highlightBin: 1,
    testDefs: [{ index: 0, name: 'Idsat', unit: 'A' }],
    hbinDefs: [{ bin: 1, name: 'Pass', color: '#00aa00' }],
    sbinDefs: [{ bin: 2, name: 'SoftFail', color: '#aa0000' }],
  });

  assert.equal(scene.metadata?.lot, 'LOT-001');
  assert.equal(scene.valueRange[0], 0.6);
  assert.equal(scene.valueRange[1], 0.9);
  assert.ok(scene.rectangles.some((rect) => rect.fill === '#00aa00'));
  assert.ok(scene.rectangles.some((rect) => rect.fill === '#e8e9ea'));
  assert.ok(scene.texts.some((text) => text.text === '+X'));
  assert.ok(scene.texts.some((text) => text.text === '+Y'));
  assert.ok(scene.hoverPoints.every((point) => point.text.includes('Die (')));
  assert.ok(scene.hoverPoints[0].text.includes('HBin: 1'));
  assert.ok(scene.overlays.some((overlay) => overlay.kind === 'wafer-boundary'));
  assert.ok(scene.overlays.some((overlay) => overlay.kind === 'reticle'));
  assert.ok(scene.overlays.some((overlay) => overlay.kind === 'probe-path'));
  assert.ok(scene.overlays.some((overlay) => overlay.kind === 'ring-boundary'));
  assert.ok(scene.overlays.some((overlay) => overlay.kind === 'quadrant-boundary'));
  assert.ok(scene.overlays.some((overlay) => overlay.kind === 'xy-indicator'));

  assert.equal(getDieKey({ x: 3, y: -2 }), '3,-2');
  assert.equal(getDieAtPoint(scene, { points: [{ curveNumber: 0, pointIndex: 2 }] })?.id, '1_0');
  assert.equal(getDieAtPoint(scene, { points: [{ curveNumber: 1, pointIndex: 1 }] }), null);

  const textOverlay = generateTextOverlay(dies, {
    plotMode: 'value',
    colorFns: getColorScheme('default'),
    normalize: (v) => v,
    testIndex: 0,
    valueRange: [0.6, 0.9],
    testDefs: [{ index: 0, name: 'Idsat', unit: 'A' }],
  });
  assert.equal(textOverlay.length, dies.length);

  const plot = toPlotly(scene, { showAxes: true, diePitchMm: { x: 10, y: 10 } });
  assert.ok(Array.isArray(plot.data));
  assert.ok(Array.isArray(plot.layout.shapes));
  assert.ok(plot.layout.shapes.every((shape) => shape.type === 'path'));
  assert.equal(plot.data[0].type, 'scatter');
  assert.ok(plot.data.some((trace) => trace.mode === 'text'));
  assert.equal(plot.layout.xaxis.title.text, 'Die X');
  assert.equal(plot.layout.yaxis.title.text, 'Die Y');
});

test('error conditions are properly validated', () => {
  // createWafer validation
  assert.throws(() => createWafer({ diameter: 0 }), /diameter must be > 0/);
  assert.throws(() => createWafer({ diameter: -10 }), /diameter must be > 0/);

  // applyProbeSequence validation
  const dies = [
    { id: 'a', x: 0, y: 0, physX: 0, physY: 0, width: 10, height: 10 },
    { id: 'b', x: 1, y: 0, physX: 10, physY: 0, width: 10, height: 10 },
  ];

  assert.throws(() => applyProbeSequence(dies, { type: 'custom' }), /customOrder is required/);
  assert.throws(() => applyProbeSequence(dies, { type: 'custom', customOrder: ['a', 'c'] }), /die IDs not found in customOrder: b/);
});

test('inference functions handle edge cases', () => {
  // assignGridIndices with empty input
  const emptyGrid = assignGridIndices([]);
  assert.deepEqual(emptyGrid.indices, []);
  assert.equal(emptyGrid.confidence, 1); // Empty input has default confidence

  // assignGridIndices with single point
  const singlePoint = assignGridIndices([{ x: 0, y: 0 }]);
  assert.deepEqual(singlePoint.indices, [{ x: 0, y: 0 }]);
  assert.equal(singlePoint.confidence, 1); // Single integer point has full confidence

  // inferWaferFromXY with insufficient points
  const insufficient = inferWaferFromXY([{ x: 0, y: 0 }]);
  assert.equal(insufficient.confidence, 0.5); // Single point at origin has low confidence

  // inferWaferFromXY with collinear points
  const collinear = inferWaferFromXY([
    { x: -50, y: 0 },
    { x: 0, y: 0 },
    { x: 50, y: 0 },
  ]);
  assert.ok(collinear.confidence < 1); // Collinear points have lower confidence

  // resolveGridPitch with empty input
  const emptyPitch = resolveGridPitch([]);
  assert.equal(emptyPitch.confidence, 0);
  assert.equal(emptyPitch.units, 'normalized');

  // resolveGridPitch with single point
  const singlePitch = resolveGridPitch([{ x: 0, y: 0 }]);
  assert.equal(singlePitch.confidence, 0.4);
});
