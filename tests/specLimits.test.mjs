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

// ── passFailDisplay: 'spec' view option ──────────────────────────────────────

test("passFailDisplay 'spec' — rectangles are colored by pass/fail category", () => {
  const testDefs = [{ testNumber: 1010, name: 'Vth', unit: 'V', limitLow: 0.2, limitHigh: 3.0 }];
  const results = [
    makeResult(0, 0, 1.0),  // within limits → pass (green)
    makeResult(1, 0, 0.1),  // below limitLow → fail low (blue)
    makeResult(-1, 0, 4.0), // above limitHigh → fail high (red)
  ];
  const { wafer, dies } = buildWaferMap({ results, waferConfig, dieConfig, testDefs });

  const scene = buildView(wafer, dies, { plotMode: 'value', passFailDisplay: 'spec', testDefs, activeTest: 1010 });

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

test('value mode — out-of-spec dies keep the gradient fill but carry a specMark under colorbarRangeMode: data', () => {
  // In 'data' range mode the die is coloured by the value gradient so the
  // distribution stays readable and the colorbar (data range) and die colours
  // agree. Out-of-spec dies are NOT filled solid blue/red — instead they carry a
  // `specMark` ('failLow'/'failHigh') the renderer draws as a marker, so an
  // out-of-spec die is flagged without losing its place in the distribution.
  // (In 'spec' range mode and under passFailDisplay 'spec' the fill IS solid blue/red — see
  // the 'spec'-mode tests above; this is the 'data'-mode-only behaviour.)
  const testDefs = [{ testNumber: 1010, name: 'Vth', unit: 'V', limitLow: 0.2, limitHigh: 3.0 }];
  const results = [
    makeResult(0, 0, 1.0),  // within limits
    makeResult(1, 0, 0.1),  // below limitLow → gradient fill + specMark 'failLow'
    makeResult(-1, 0, 4.0), // above limitHigh → gradient fill + specMark 'failHigh'
  ];
  const { wafer, dies } = buildWaferMap({ results, waferConfig, dieConfig, testDefs });

  // NOTE: plain value mode (NOT passFailDisplay 'spec'), explicitly colorbarRangeMode: 'data'.
  const scene = buildView(wafer, dies, {
    plotMode: 'value', testDefs, activeTest: 1010, colorbarRangeMode: 'data',
  });

  const getRectForDie = (x, y) => {
    const die = scene.dies.find(d => d.x === x && d.y === y);
    return die ? scene.rectangles.find(r => Math.abs(r.x - die.physX) < 0.1 && Math.abs(r.y - die.physY) < 0.1) : null;
  };

  const failLow  = getRectForDie(1, 0);
  const failHigh = getRectForDie(-1, 0);
  const inSpec   = getRectForDie(0, 0);

  // Out-of-spec dies keep the gradient (NOT the solid spec-fail colours)…
  assert.notEqual(failLow.fill,  '#3498db', 'fail-low die should use the gradient, not solid blue, in data mode');
  assert.notEqual(failHigh.fill, '#e74c3c', 'fail-high die should use the gradient, not solid red, in data mode');
  // …but are flagged via specMark so they are never shown as plain in-spec.
  assert.equal(failLow.specMark,  'failLow',  'fail-low die must carry specMark failLow');
  assert.equal(failHigh.specMark, 'failHigh', 'fail-high die must carry specMark failHigh');
  // In-spec die has no marker.
  assert.equal(inSpec.specMark, undefined, 'in-spec die must not carry a specMark');
});

test('value mode — out-of-spec dies keep the gradient fill and carry a specMark under colorbarRangeMode: spec', () => {
  // Unified rule: in normal value mode the out-of-spec indication is the ▽/△ marker
  // in BOTH colorbar ranges. Out-of-spec dies are NOT solid blue/red — they keep the
  // gradient fill like every other die (so the indication never collides with a
  // scheme whose gradient is blue/red at that end). colorbarRangeMode now only sets
  // the colorbar's numeric range, not the form of the spec indication.
  const testDefs = [{ testNumber: 1010, name: 'Vth', unit: 'V', limitLow: 0.2, limitHigh: 3.0 }];
  const results = [
    makeResult(0, 0, 1.0),
    makeResult(1, 0, 0.1),
    makeResult(-1, 0, 4.0),
  ];
  const { wafer, dies } = buildWaferMap({ results, waferConfig, dieConfig, testDefs });
  const scene = buildView(wafer, dies, {
    plotMode: 'value', testDefs, activeTest: 1010, colorbarRangeMode: 'spec',
  });

  const getRectForDie = (x, y) => {
    const die = scene.dies.find(d => d.x === x && d.y === y);
    return die ? scene.rectangles.find(r => Math.abs(r.x - die.physX) < 0.1 && Math.abs(r.y - die.physY) < 0.1) : null;
  };

  assert.notEqual(getRectForDie(1, 0).fill,  '#3498db', 'fail-low die uses the gradient, not solid blue, in spec mode');
  assert.notEqual(getRectForDie(-1, 0).fill, '#e74c3c', 'fail-high die uses the gradient, not solid red, in spec mode');
  assert.equal(getRectForDie(1, 0).specMark,  'failLow',  'fail-low die must carry specMark failLow in spec mode');
  assert.equal(getRectForDie(-1, 0).specMark, 'failHigh', 'fail-high die must carry specMark failHigh in spec mode');
  assert.equal(getRectForDie(0, 0).specMark,  undefined, 'in-spec die must not carry a specMark');
});

test("value mode — passFailDisplay 'spec' keeps solid spec fills (no specMark) even with colorbarRangeMode: data", () => {
  // passFailDisplay 'spec' coerces range mode to 'spec' internally (buildView), so spec
  // colouring is always solid blue/red/green and no marker is emitted.
  const testDefs = [{ testNumber: 1010, name: 'Vth', unit: 'V', limitLow: 0.2, limitHigh: 3.0 }];
  const results = [
    makeResult(0, 0, 1.0),
    makeResult(1, 0, 0.1),
    makeResult(-1, 0, 4.0),
  ];
  const { wafer, dies } = buildWaferMap({ results, waferConfig, dieConfig, testDefs });
  const scene = buildView(wafer, dies, {
    plotMode: 'value', testDefs, activeTest: 1010, passFailDisplay: 'spec', colorbarRangeMode: 'data',
  });

  const getRectForDie = (x, y) => {
    const die = scene.dies.find(d => d.x === x && d.y === y);
    return die ? scene.rectangles.find(r => Math.abs(r.x - die.physX) < 0.1 && Math.abs(r.y - die.physY) < 0.1) : null;
  };

  assert.equal(getRectForDie(1, 0).fill,  '#3498db', "fail-low solid blue under passFailDisplay 'spec'");
  assert.equal(getRectForDie(-1, 0).fill, '#e74c3c', "fail-high solid red under passFailDisplay 'spec'");
  assert.equal(getRectForDie(0, 0).fill,  '#2ecc71', "in-spec solid green under passFailDisplay 'spec'");
  assert.equal(getRectForDie(1, 0).specMark, undefined, "passFailDisplay 'spec' emits no marker");
});

test("passFailDisplay 'spec' — die with no value gets no-data fill", () => {
  const testDefs = [{ testNumber: 1010, name: 'Vth', unit: 'V', limitLow: 0.2, limitHigh: 3.0 }];
  const results = [
    { x: 0, y: 0, hbin: 1, testValues: { 1010: 1.0 } },
    { x: 1, y: 0, hbin: 1 }, // no testValues
  ];
  const { wafer, dies } = buildWaferMap({ results, waferConfig, dieConfig, testDefs });
  const scene = buildView(wafer, dies, { plotMode: 'value', passFailDisplay: 'spec', testDefs, activeTest: 1010 });

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
  assert.ok(Math.abs(entry.yieldPercent - 50) < 1e-6);
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
  const summary = analyzeWaferMap(input, { enableTestValueAnalysis: true });
  assert.ok(summary.stats.warnings?.length, 'should have at least one warning');
  // Structured WaferWarning, not a bare string — branch on `code`, which is
  // stable, rather than on prose that may be reworded.
  const w = summary.stats.warnings[0];
  assert.equal(w.code, 'test-count-capped');
  assert.equal(typeof w.message, 'string');
  assert.equal(w.severity, 'warning');
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

test('stats.warnings — cap warning from computePerTestStats reaches stats.warnings (H4)', () => {
  // The cheap perTestStats path discovers test numbers and can raise the >250-test
  // cap warning. Regression: that warning was previously dropped because
  // stats.warnings was assigned before this path ran. No findings pass here, so
  // warnings starts empty — exactly the case where the old code skipped assignment.
  const testValues = {};
  for (let i = 0; i < 251; i++) testValues[i] = Math.random();
  const input = buildWaferMap({
    results: [{ x: 0, y: 0, hbin: 1, testValues }, { x: 1, y: 0, hbin: 1, testValues }],
    waferConfig, dieConfig,
  });
  const summary = analyzeWaferMap(input, { computePerTestStats: true });
  assert.ok(summary.stats.warnings?.length, 'cap warning should reach stats.warnings');
  assert.equal(summary.stats.warnings[0].code, 'test-count-capped');
  // The outcome is "no test findings at all", not "some tests skipped" — the
  // message has to say so, because nothing else will.
  assert.match(summary.stats.warnings[0].message, /no test findings|skipped/i);
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

test('value mode — out-of-spec dies keep the gradient fill and are flagged via specMark', () => {
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

  // All dies use the gradient fill (never the solid fail colours); out-of-spec
  // dies are flagged with a ▽/△ marker via specMark instead.
  assert.notEqual(inSpec.fill,   '#3498db', 'in-spec die should not be fail-low color');
  assert.notEqual(inSpec.fill,   '#e74c3c', 'in-spec die should not be fail-high color');
  assert.notEqual(failLow.fill,  '#3498db', 'fail-low die uses the gradient, not solid blue');
  assert.notEqual(failHigh.fill, '#e74c3c', 'fail-high die uses the gradient, not solid red');
  assert.equal(inSpec.specMark,   undefined, 'in-spec die carries no marker');
  assert.equal(failLow.specMark,  'failLow',  'fail-low die flagged via specMark');
  assert.equal(failHigh.specMark, 'failHigh', 'fail-high die flagged via specMark');
});

// ── spec legend counts (view.specCounts) ─────────────────────────────────────

test('specCounts — tallies pass / failHigh / failLow against both limits', () => {
  const testDefs = [{ testNumber: 1010, name: 'Vth', unit: 'V', limitLow: 0.2, limitHigh: 3.0 }];
  const { wafer, dies } = buildWaferMap({
    results: [
      makeResult(0, 0, 1.0),   // pass
      makeResult(1, 0, 2.0),   // pass
      makeResult(0, 1, 0.1),   // fail low  (< 0.2)
      makeResult(-1, 0, 5.0),  // fail high (> 3.0)
      makeResult(0, -1, 4.0),  // fail high
    ],
    waferConfig, dieConfig, testDefs,
  });
  const view = buildView(wafer, dies, { plotMode: 'value', testDefs, activeTest: 1010, passFailDisplay: 'spec' });
  assert.deepEqual(view.specCounts, { pass: 2, failHigh: 2, failLow: 1 });
});

test('specCounts — one-sided (high only) limit never classifies fail-low', () => {
  const testDefs = [{ testNumber: 1010, name: 'Vth', unit: 'V', limitHigh: 3.0 }];
  const { wafer, dies } = buildWaferMap({
    results: [makeResult(0, 0, 1.0), makeResult(1, 0, 0.05), makeResult(0, 1, 9.0)],
    waferConfig, dieConfig, testDefs,
  });
  const view = buildView(wafer, dies, { plotMode: 'value', testDefs, activeTest: 1010, passFailDisplay: 'spec' });
  // 0.05 has no low limit to fail → counts as pass; 9.0 fails high.
  assert.deepEqual(view.specCounts, { pass: 2, failHigh: 1, failLow: 0 });
});

test('specCounts — undefined outside spec mode', () => {
  const testDefs = [{ testNumber: 1010, name: 'Vth', unit: 'V', limitLow: 0.2, limitHigh: 3.0 }];
  const { wafer, dies } = buildWaferMap({
    results: [makeResult(0, 0, 1.0)], waferConfig, dieConfig, testDefs,
  });
  const view = buildView(wafer, dies, { plotMode: 'value', testDefs, activeTest: 1010 });
  assert.equal(view.specCounts, undefined);
});
