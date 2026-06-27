import test from 'node:test';
import assert from 'node:assert/strict';

import { buildWaferMap, buildHoverText, createWafer } from '../dist/index.js';
import { buildView } from '../dist/packages/renderer/buildView.js';

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

// ── wafer.orientation is applied exactly once ─────────────────────────────────
// Regression: buildWaferMap bakes wafer.orientation into physX/physY, and buildView
// previously re-applied it in the render transform — double-rotating the dies
// relative to the wafer boundary (which rotates once). Invisible at orientation 0
// (the only previously-tested case), wrong at any non-zero orientation.

test('wafer.orientation is applied exactly once — die rects match baked positions and stay in bounds', () => {
  const result = buildWaferMap({
    results: [
      { x: 3, y: 7, hbin: 1 },
      { x: -2, y: 4, hbin: 2 },
      { x: 5, y: -1, hbin: 1 },
    ],
    waferConfig: { diameter: 300, orientation: 90 },
    dieConfig: { width: 10, height: 10 },
  });

  // No interactive rotation: the render must NOT move the already-oriented dies.
  // A die rect's drawn centre must equal its baked physX/physY. (Before the fix the
  // render re-rotated by 90°, so centres were swapped/negated — off by the bug.)
  const scene = buildView(result.wafer, result.dies, { plotMode: 'hardBin' });

  for (const die of result.dies) {
    const rect = scene.rectangles.find(
      (r) => Math.abs(r.x - die.physX) < 1e-6 && Math.abs(r.y - die.physY) < 1e-6,
    );
    assert.ok(rect,
      `die (${die.x},${die.y}) rect not drawn at its baked position (${die.physX},${die.physY}) — orientation double-applied`);
  }

  // Dies and boundary must agree: every die centre lies within the wafer radius.
  const { center, radius } = result.wafer;
  for (const die of result.dies) {
    const dist = Math.hypot(die.physX - center.x, die.physY - center.y);
    assert.ok(dist <= radius + 1e-6,
      `die (${die.x},${die.y}) centre is outside the wafer boundary after orientation`);
  }
});

test('wafer.orientation composes correctly with interactive rotation', () => {
  // orientation 90 + interactive 90 = 180 total for dies. Verify a die ends up at
  // the 180°-rotated position of its baked (already-90°-oriented) coordinate, i.e.
  // negated about the wafer centre — confirming the two rotations compose, not
  // double-count the orientation.
  const result = buildWaferMap({
    results: [{ x: 4, y: 2, hbin: 1 }, { x: -3, y: 5, hbin: 2 }],
    waferConfig: { diameter: 300, orientation: 90 },
    dieConfig: { width: 10, height: 10 },
  });
  const { center } = result.wafer;
  const scene = buildView(result.wafer, result.dies, {
    plotMode: 'hardBin',
    interactiveTransform: { rotation: 180 },
  });

  for (const die of result.dies) {
    // interactive 180° about centre negates the baked coordinate about the centre.
    const expX = 2 * center.x - die.physX;
    const expY = 2 * center.y - die.physY;
    const rect = scene.rectangles.find(
      (r) => Math.abs(r.x - expX) < 1e-6 && Math.abs(r.y - expY) < 1e-6,
    );
    assert.ok(rect,
      `die (${die.x},${die.y}) not at expected 180° interactive position — orientation/interactive compose wrongly`);
  }
});

// ── stacked-bin hover: percent vs occurrence count ────────────────────────────
// The aggregated scalar's meaning depends on the lot-stack method. A 'percent'
// aggregate is already a percentage and must NOT be relabelled as a count nor
// have a second percentage derived from it (which produced nonsense like "250%").

test('stackedBins hover labels percent aggregate as % and does not derive a second percentage', () => {
  const die = { id: '0_0', x: 0, y: 0, physX: 0, physY: 0, width: 10, height: 10, hbin: 2, testValues: { 0: 66 } };
  // method 'percent', lotSize 3 — the value 66 is ALREADY a percentage.
  const text = buildHoverText(die, 'stackedBins', undefined, undefined, undefined, undefined, 'percent', 3);
  assert.match(text, /66%/, 'percent aggregate must render as N%');
  assert.doesNotMatch(text, /\(\d+% of lot\)/, 'must not derive a second percentage from a percentage');
  assert.match(text, /occurrence %/, 'must name the aggregation method');
});

test('stackedBins hover labels countBin aggregate as a count with optional lot share', () => {
  const die = { id: '0_0', x: 0, y: 0, physX: 0, physY: 0, width: 10, height: 10, hbin: 2, testValues: { 0: 2 } };
  // method 'countBin', lotSize 3 — the value 2 is an occurrence count (2 of 3 wafers).
  const text = buildHoverText(die, 'stackedBins', undefined, undefined, undefined, undefined, 'countBin', 3);
  assert.match(text, /Bin 2: 2/, 'count aggregate shows the raw count');
  assert.match(text, /67% of lot/, 'count aggregate annotates its share of the lot');
  assert.match(text, /occurrence count/, 'must name the aggregation method');
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
  assert.equal(result.isLotStack, false);
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
  assert.equal(result.isLotStack, true);
});

test('buildView isLotStack defaults to false', () => {
  const wafer = createWafer({ diameter: 300 });
  const scene = buildView(wafer, [], { plotMode: 'hardBin' });
  assert.equal(scene.isLotStack, false);
});

// ── colorbarRangeMode independence from out-of-spec coloring ─────────────────
// Out-of-spec dies must always be distinguishable from in-spec dies, regardless
// of colorbarRangeMode — a die outside its limits must never look in-spec. The
// *form* of the indication depends on the range mode:
//   - 'spec' (default): solid blue/red fill.
//   - 'data': the value gradient fill (so the distribution reads correctly) PLUS
//     a blue/red `specMark` the renderer draws as a marker.
// Either way an engineer can always tell an out-of-spec die from an in-spec one.

const SPEC_FAIL_LOW  = '#3498db';
const SPEC_FAIL_HIGH = '#e74c3c';

test('out-of-spec dies are flagged via specMark regardless of colorbarRangeMode=spec', () => {
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

  // Unified rule: out-of-spec dies keep the gradient fill (never solid blue/red)
  // and are flagged with a ▽/△ marker via specMark, in spec range too.
  assert.notEqual(rect00?.fill, SPEC_FAIL_LOW,  'value below limitLow keeps the gradient, not solid blue');
  assert.notEqual(rect10?.fill, SPEC_FAIL_HIGH, 'value above limitHigh keeps the gradient, not solid red');
  assert.equal(rect00?.specMark, 'failLow',  'value below limitLow must be flagged with specMark failLow');
  assert.equal(rect10?.specMark, 'failHigh', 'value above limitHigh must be flagged with specMark failHigh');
  assert.equal(rect01?.specMark, undefined,  'in-spec die must not carry a specMark');
});

test('out-of-spec dies are always distinguishable from in-spec in BOTH colorbarRangeMode=data and =spec', () => {
  // Safety invariant: an out-of-spec die must never be shown as plain in-spec.
  // In normal value mode (both colorbar ranges) the die keeps its value-gradient
  // fill — so the distribution stays readable and the indication never collides
  // with a scheme whose gradient is blue/red at that end — and is flagged with a
  // ▽/△ `specMark` marker. The form no longer depends on colorbarRangeMode.
  const wafer = createWafer({ diameter: 300 });
  const dies = [
    { id: '0_0', x: 0, y: 0, physX: 0,  physY: 0,  width: 10, height: 10, testValues: { 0: 0.1 } },
    { id: '1_0', x: 1, y: 0, physX: 10, physY: 0,  width: 10, height: 10, testValues: { 0: 5.0 } },
    { id: '0_1', x: 0, y: 1, physX: 0,  physY: 10, width: 10, height: 10, testValues: { 0: 2.5 } },
  ];
  const testDefs = [{ index: 0, name: 'Vt', unit: 'V', limitLow: 0.5, limitHigh: 4.5 }];

  for (const colorbarRangeMode of ['spec', 'data']) {
    const view = buildView(wafer, dies, { plotMode: 'value', colorbarRangeMode, activeTest: 0, testDefs });
    const below = view.rectangles.find((r) => r.x === 0  && r.y === 0);
    const above = view.rectangles.find((r) => r.x === 10 && r.y === 0);
    const inSpec = view.rectangles.find((r) => r.x === 0  && r.y === 10);
    assert.notEqual(below?.fill, SPEC_FAIL_LOW,  `${colorbarRangeMode}: out-of-spec die keeps the gradient, not solid blue`);
    assert.notEqual(above?.fill, SPEC_FAIL_HIGH, `${colorbarRangeMode}: out-of-spec die keeps the gradient, not solid red`);
    assert.equal(below?.specMark, 'failLow',  `${colorbarRangeMode}: below limitLow is flagged with specMark`);
    assert.equal(above?.specMark, 'failHigh', `${colorbarRangeMode}: above limitHigh is flagged with specMark`);
    assert.equal(inSpec?.specMark, undefined, `${colorbarRangeMode}: in-spec die carries no marker`);
  }
});
