import test from 'node:test';
import assert from 'node:assert/strict';
import { buildWaferMap } from '../dist/packages/renderer/buildWaferMap.js';
import { buildView } from '../dist/packages/renderer/buildView.js';
import { analyzeWaferMap } from '../dist/packages/stats/analyzeWaferMap.js';

// Use a standard 300 mm wafer, 10 mm dies, so (0,0) is safely in the centre.
const waferConfig = { diameter: 300 };
const dieConfig   = { width: 10, height: 10 };

function makeResult(x, y, value, hbin = 1) {
  return { x, y, hbin, testValues: { 1010: value } };
}

// ── buildView: colorbar default range from spec limits ───────────────────────

test('specLimit — colorbar range defaults to [limitLow, limitHigh] when both defined', () => {
  const testDefs = [{ testNumber: 1010, name: 'Vth', unit: 'V', limitLow: 0.2, limitHigh: 3.0 }];
  const { wafer, dies } = buildWaferMap({
    results: [makeResult(0, 0, 0.5), makeResult(1, 0, 1.5), makeResult(0, 1, 2.5)],
    waferConfig, dieConfig, testDefs,
  });
  const scene = buildView(wafer, dies, { plotMode: 'value', testDefs, activeTest: 1010 });
  assert.equal(scene.valueRange[0], 0.2);
  assert.equal(scene.valueRange[1], 3.0);
});

test('specLimit — explicit valueRange overrides limit-based default', () => {
  const testDefs = [{ testNumber: 1010, name: 'Vth', unit: 'V', limitLow: 0.2, limitHigh: 3.0 }];
  const { wafer, dies } = buildWaferMap({
    results: [makeResult(0, 0, 1.0), makeResult(1, 0, 2.0)],
    waferConfig, dieConfig, testDefs,
  });
  const scene = buildView(wafer, dies, {
    plotMode: 'value', testDefs, activeTest: 1010, valueRange: [0.0, 5.0],
  });
  assert.equal(scene.valueRange[0], 0.0);
  assert.equal(scene.valueRange[1], 5.0);
});

test('test-keyed valueRange — applied when { test } matches the active test', () => {
  const testDefs = [
    { testNumber: 1010, name: 'Vth', unit: 'V' },
    { testNumber: 1020, name: 'Idd', unit: 'A' },
  ];
  const { wafer, dies } = buildWaferMap({
    results: [
      { x: 0, y: 0, hbin: 1, testValues: { 1010: 1.0, 1020: 0.1 } },
      { x: 1, y: 0, hbin: 1, testValues: { 1010: 2.0, 1020: 0.2 } },
    ],
    waferConfig, dieConfig, testDefs,
  });
  const scene = buildView(wafer, dies, {
    plotMode: 'value', testDefs, activeTest: 1010,
    valueRange: { test: 1010, range: [0.0, 5.0] },
  });
  assert.equal(scene.valueRange[0], 0.0);
  assert.equal(scene.valueRange[1], 5.0);
});

test('test-keyed valueRange — IGNORED (auto-scales) when { test } ≠ active test', () => {
  // Range computed for test 1010 must NOT colour test 1020's data. The library
  // drops the mismatched range and auto-scales to 1020's own data extents,
  // making a cross-test mis-scaled plot impossible regardless of caller error.
  const testDefs = [
    { testNumber: 1010, name: 'Vth', unit: 'V' },
    { testNumber: 1020, name: 'Idd', unit: 'A' },
  ];
  const { wafer, dies } = buildWaferMap({
    results: [
      { x: 0, y: 0, hbin: 1, testValues: { 1010: 1.0, 1020: 0.1 } },
      { x: 1, y: 0, hbin: 1, testValues: { 1010: 2.0, 1020: 0.4 } },
    ],
    waferConfig, dieConfig, testDefs,
  });
  const scene = buildView(wafer, dies, {
    plotMode: 'value', testDefs, activeTest: 1020,
    valueRange: { test: 1010, range: [0.0, 5.0] },
  });
  // Auto-scaled to 1020's data [0.1, 0.4], NOT the mismatched [0.0, 5.0].
  assert.equal(scene.valueRange[0], 0.1);
  assert.equal(scene.valueRange[1], 0.4);
});

test('specLimit — only limitLow defined: low end is limitLow, high end is data max', () => {
  const testDefs = [{ testNumber: 1010, name: 'Vth', unit: 'V', limitLow: 0.5 }];
  const { wafer, dies } = buildWaferMap({
    results: [makeResult(0, 0, 1.0), makeResult(1, 0, 4.0)],
    waferConfig, dieConfig, testDefs,
  });
  const scene = buildView(wafer, dies, { plotMode: 'value', testDefs, activeTest: 1010 });
  assert.equal(scene.valueRange[0], 0.5);
  assert.equal(scene.valueRange[1], 4.0);
});

// ── colorBySpec view option ───────────────────────────────────────────────────

test('colorBySpec — rectangles are colored by pass/fail category', () => {
  const testDefs = [{ testNumber: 1010, name: 'Vth', unit: 'V', limitLow: 0.2, limitHigh: 3.0 }];
  const results = [
    makeResult(0, 0, 1.0),  // within limits → pass (green)
    makeResult(1, 0, 0.1),  // below limitLow → fail low (blue)
    makeResult(-1, 0, 4.0), // above limitHigh → fail high (red)
  ];
  const { wafer, dies } = buildWaferMap({ results, waferConfig, dieConfig, testDefs });

  const scene = buildView(wafer, dies, { plotMode: 'value', colorBySpec: true, testDefs, activeTest: 1010 });

  const getRectForDie = (x, y) => {
    const die = scene.dies.find(d => d.x === x && d.y === y);
    if (!die) return null;
    return scene.rectangles.find(r => Math.abs(r.x - die.physX) < 0.1 && Math.abs(r.y - die.physY) < 0.1);
  };

  const passRect  = getRectForDie(0, 0);
  const failLRect = getRectForDie(1, 0);
  const failHRect = getRectForDie(-1, 0);

  assert.ok(passRect,  'pass die rect not found');
  assert.ok(failLRect, 'fail-low die rect not found');
  assert.ok(failHRect, 'fail-high die rect not found');

  assert.equal(passRect.fill,  '#2ecc71', 'pass color should be green');
  assert.equal(failLRect.fill, '#3498db', 'fail-low color should be blue');
  assert.equal(failHRect.fill, '#e74c3c', 'fail-high color should be red');
});

test('colorBySpec — die with no value gets no-data fill', () => {
  const testDefs = [{ testNumber: 1010, name: 'Vth', unit: 'V', limitLow: 0.2, limitHigh: 3.0 }];
  const results = [
    { x: 0, y: 0, hbin: 1, testValues: { 1010: 1.0 } },
    { x: 1, y: 0, hbin: 1 }, // no testValues
  ];
  const { wafer, dies } = buildWaferMap({ results, waferConfig, dieConfig, testDefs });
  const scene = buildView(wafer, dies, { plotMode: 'value', colorBySpec: true, testDefs, activeTest: 1010 });

  const noDataDie = scene.dies.find(d => d.x === 1 && d.y === 0);
  const noDataRect = noDataDie && scene.rectangles.find(
    r => Math.abs(r.x - noDataDie.physX) < 0.1 && Math.abs(r.y - noDataDie.physY) < 0.1
  );
  assert.ok(noDataRect, 'no-data die rect not found');
  assert.equal(noDataRect.fill, '#d6d9dd', 'no-data fill should be grey');
});

// ── analyzeWaferMap: per-test spec yield ──────────────────────────────────────

test('testSpecYield — populated when testDef has limits', () => {
  const testDefs = [{ testNumber: 1010, name: 'Vth', unit: 'V', limitLow: 0.2, limitHigh: 3.0 }];
  const input = buildWaferMap({
    results: [
      makeResult(0, 0, 1.0),  // pass
      makeResult(1, 0, 0.1),  // fail low
      makeResult(-1, 0, 4.0), // fail high
      makeResult(0, 1, 1.5),  // pass
    ],
    waferConfig, dieConfig, testDefs,
  });
  const summary = analyzeWaferMap(input);
  const specYield = summary.stats.testSpecYield;

  assert.ok(specYield?.length, 'testSpecYield should be populated');
  const entry = specYield[0];
  assert.equal(entry.testNumber, 1010);
  assert.equal(entry.label, 'Vth');
  assert.equal(entry.passDies, 2);
  assert.equal(entry.failLowDies, 1);
  assert.equal(entry.failHighDies, 1);
  assert.equal(entry.totalDies, 4);
  assert.ok(Math.abs(entry.yieldPercent - 0.5) < 1e-9);
});

test('testSpecYield — undefined when testDef has no limits', () => {
  const testDefs = [{ testNumber: 1010, name: 'Vth', unit: 'V' }];
  const input = buildWaferMap({
    results: [makeResult(0, 0, 1.0)],
    waferConfig, dieConfig, testDefs,
  });
  const summary = analyzeWaferMap(input);
  assert.equal(summary.stats.testSpecYield, undefined);
});

test('testSpecYield — one-sided limit (limitHigh only)', () => {
  const testDefs = [{ testNumber: 1010, name: 'Vth', unit: 'V', limitHigh: 3.0 }];
  const input = buildWaferMap({
    results: [makeResult(0, 0, 1.0), makeResult(1, 0, 5.0)],
    waferConfig, dieConfig, testDefs,
  });
  const summary = analyzeWaferMap(input);
  const entry = summary.stats.testSpecYield?.[0];
  assert.ok(entry, 'testSpecYield entry should exist');
  assert.equal(entry.passDies, 1);
  assert.equal(entry.failLowDies, 0);
  assert.equal(entry.failHighDies, 1);
});

// ── stats.warnings — test count cap ──────────────────────────────────────────

test('stats.warnings — populated when >250 tests present without testNumbers filter', () => {
  const testValues = {};
  for (let i = 0; i < 251; i++) testValues[i] = Math.random();
  const input = buildWaferMap({
    results: [{ x: 0, y: 0, hbin: 1, testValues }, { x: 1, y: 0, hbin: 1, testValues }],
    waferConfig, dieConfig,
  });
  const summary = analyzeWaferMap(input);
  assert.ok(summary.stats.warnings?.length, 'should have at least one warning');
  assert.ok(summary.stats.warnings[0].includes('tests found'));
});

test('stats.warnings — undefined when testNumbers filter provided', () => {
  const testValues = {};
  for (let i = 0; i < 101; i++) testValues[i] = Math.random();
  const input = buildWaferMap({
    results: [{ x: 0, y: 0, hbin: 1, testValues }, { x: 1, y: 0, hbin: 1, testValues }],
    waferConfig, dieConfig,
  });
  const summary = analyzeWaferMap(input, { testNumbers: [0, 1, 2] });
  assert.equal(summary.stats.warnings, undefined);
});

// ── colorbarRangeMode ─────────────────────────────────────────────────────────

test('colorbarRangeMode spec — valueRange clamps to [limitLow, limitHigh]', () => {
  const testDefs = [{ testNumber: 1010, name: 'Vth', unit: 'V', limitLow: 1.0, limitHigh: 3.0 }];
  const { wafer, dies } = buildWaferMap({
    results: [makeResult(0, 0, 0.5), makeResult(1, 0, 2.0), makeResult(-1, 0, 4.0)],
    waferConfig, dieConfig, testDefs,
  });
  const scene = buildView(wafer, dies, {
    plotMode: 'value', testDefs, activeTest: 1010, colorbarRangeMode: 'spec',
  });
  assert.equal(scene.valueRange[0], 1.0);
  assert.equal(scene.valueRange[1], 3.0);
});

test('colorbarRangeMode data — valueRange uses data min/max even with limits', () => {
  const testDefs = [{ testNumber: 1010, name: 'Vth', unit: 'V', limitLow: 1.0, limitHigh: 3.0 }];
  const { wafer, dies } = buildWaferMap({
    results: [makeResult(0, 0, 0.5), makeResult(1, 0, 2.0), makeResult(-1, 0, 4.0)],
    waferConfig, dieConfig, testDefs,
  });
  const scene = buildView(wafer, dies, {
    plotMode: 'value', testDefs, activeTest: 1010, colorbarRangeMode: 'data',
  });
  assert.equal(scene.valueRange[0], 0.5);
  assert.equal(scene.valueRange[1], 4.0);
});

// ── out-of-spec coloring in value mode ───────────────────────────────────────

test('value mode — out-of-spec dies colored with fail-low/fail-high colors', () => {
  const testDefs = [{ testNumber: 1010, name: 'Vth', unit: 'V', limitLow: 1.0, limitHigh: 3.0 }];
  const results = [
    makeResult(0, 0, 2.0),   // in spec
    makeResult(1, 0, 0.5),   // below limitLow
    makeResult(-1, 0, 4.0),  // above limitHigh
  ];
  const { wafer, dies } = buildWaferMap({ results, waferConfig, dieConfig, testDefs });
  const scene = buildView(wafer, dies, { plotMode: 'value', testDefs, activeTest: 1010 });

  const getRectForDie = (x, y) => {
    const die = scene.dies.find(d => d.x === x && d.y === y);
    if (!die) return null;
    return scene.rectangles.find(r => Math.abs(r.x - die.physX) < 0.1 && Math.abs(r.y - die.physY) < 0.1);
  };

  const inSpec  = getRectForDie(0, 0);
  const failLow = getRectForDie(1, 0);
  const failHigh = getRectForDie(-1, 0);

  assert.ok(inSpec,   'in-spec die rect not found');
  assert.ok(failLow,  'fail-low die rect not found');
  assert.ok(failHigh, 'fail-high die rect not found');

  // In-spec die should use the gradient (not fail colors)
  assert.notEqual(inSpec.fill,  '#3498db', 'in-spec die should not be fail-low color');
  assert.notEqual(inSpec.fill,  '#e74c3c', 'in-spec die should not be fail-high color');
  assert.equal(failLow.fill,  '#3498db', 'fail-low color should be blue');
  assert.equal(failHigh.fill, '#e74c3c', 'fail-high color should be red');
});
