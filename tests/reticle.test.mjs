import test from 'node:test';
import assert from 'node:assert/strict';
import { generateReticleGrid } from '../dist/packages/core/reticle.js';
import { createWafer } from '../dist/packages/core/wafer.js';
import { buildWaferMap } from '../dist/index.js';

const wafer = createWafer({ diameter: 300 }); // radius 150, center (0,0)

// Physical position of a die at grid index (col, row), matching buildWaferMap's
// `physX = col * pitchX - colMidX` for centered (colMidX/colMidY = 0) data.
function diePhys(col, row, pitchX, pitchY) {
  return { x: col * pitchX, y: row * pitchY };
}

// Finds the reticle field containing a given physical point.
function fieldContaining(reticles, x, y) {
  return reticles.find(r =>
    x >= r.x - r.width / 2 && x < r.x + r.width / 2 &&
    y >= r.y - r.height / 2 && y < r.y + r.height / 2,
  );
}

test('generateReticleGrid — default anchor {0,0} puts die (0,0) at a field corner', () => {
  const pitchX = 8, pitchY = 12;
  const reticles = generateReticleGrid(wafer, { width: 4, height: 3, diePitchX: pitchX, diePitchY: pitchY });
  const { x, y } = diePhys(0, 0, pitchX, pitchY);
  const field = fieldContaining(reticles, x, y);
  assert.ok(field, 'die (0,0) should fall inside a reticle field');
  // The die's own min-x/min-y corner (center ± half pitch) should coincide with
  // the field's min-x/min-y corner — not the die center.
  assert.equal(x - pitchX / 2, field.x - field.width / 2, 'die (0,0) should sit at the field min-x edge');
  assert.equal(y - pitchY / 2, field.y - field.height / 2, 'die (0,0) should sit at the field min-y edge');
});

test('generateReticleGrid — anchorDie pins that exact die to the field min-x/min-y corner', () => {
  const pitchX = 8, pitchY = 12;
  const anchorDie = { x: 1, y: 0 };
  const reticles = generateReticleGrid(wafer, {
    width: 4, height: 3, diePitchX: pitchX, diePitchY: pitchY, anchorDie,
  });
  const { x, y } = diePhys(anchorDie.x, anchorDie.y, pitchX, pitchY);
  const field = fieldContaining(reticles, x, y);
  assert.ok(field, 'anchor die should fall inside a reticle field');
  assert.equal(x - pitchX / 2, field.x - field.width / 2, 'anchor die should sit at the field min-x edge, not mid-field');
  assert.equal(y - pitchY / 2, field.y - field.height / 2, 'anchor die should sit at the field min-y edge, not mid-field');
});

test('generateReticleGrid — anchorDie is honored for negative and multi-field-width offsets', () => {
  const pitchX = 5, pitchY = 5;
  for (const anchorDie of [{ x: -6, y: -3 }, { x: 11, y: 7 }, { x: 3, y: 4 }]) {
    const reticles = generateReticleGrid(wafer, {
      width: 7, height: 5, diePitchX: pitchX, diePitchY: pitchY, anchorDie,
    });
    const { x, y } = diePhys(anchorDie.x, anchorDie.y, pitchX, pitchY);
    const field = fieldContaining(reticles, x, y);
    assert.ok(field, `anchor die ${JSON.stringify(anchorDie)} should fall inside a reticle field`);
    assert.equal(x - pitchX / 2, field.x - field.width / 2, `anchor die ${JSON.stringify(anchorDie)} should sit at min-x edge`);
    assert.equal(y - pitchY / 2, field.y - field.height / 2, `anchor die ${JSON.stringify(anchorDie)} should sit at min-y edge`);
  }
});

test('generateReticleGrid — fields tile without gaps or overlaps along both axes', () => {
  const pitchX = 8, pitchY = 12;
  const anchorDie = { x: 1, y: 0 };
  const reticles = generateReticleGrid(wafer, {
    width: 4, height: 3, diePitchX: pitchX, diePitchY: pitchY, anchorDie,
  });
  const anchorLeftEdge = anchorDie.x * pitchX - pitchX / 2;
  const xEdges = new Set(reticles.map(r => Math.round((r.x - r.width / 2) * 1e6) / 1e6));
  for (const edge of xEdges) {
    // Every left edge should be reachable from the anchor die's own corner by
    // whole multiples of the field width.
    const stepsFromAnchor = (edge - anchorLeftEdge) / (4 * pitchX);
    assert.ok(Number.isInteger(Math.round(stepsFromAnchor * 1e6) / 1e6), `edge ${edge} misaligned with field grid`);
  }
});

test('generateReticleGrid — bounds search does not drop fields near the wafer edge for large/negative anchors', () => {
  const pitchX = 5, pitchY = 5;
  function bruteForceCount(config) {
    const { width: W, height: H, diePitchX, diePitchY, anchorDie = { x: 0, y: 0 } } = config;
    const fw = W * diePitchX, fh = H * diePitchY;
    const phaseX = ((anchorDie.x % W) + W) % W;
    const phaseY = ((anchorDie.y % H) + H) % H;
    let count = 0;
    for (let l = -200; l <= 200; l++) {
      const j0 = l * H + phaseY;
      const cy = wafer.center.y + (j0 + (H - 1) / 2) * diePitchY;
      for (let k = -200; k <= 200; k++) {
        const i0 = k * W + phaseX;
        const cx = wafer.center.x + (i0 + (W - 1) / 2) * diePitchX;
        const closestX = Math.max(cx - fw / 2, Math.min(wafer.center.x, cx + fw / 2));
        const closestY = Math.max(cy - fh / 2, Math.min(wafer.center.y, cy + fh / 2));
        const dx = closestX - wafer.center.x, dy = closestY - wafer.center.y;
        if (dx * dx + dy * dy <= wafer.radius * wafer.radius) count++;
      }
    }
    return count;
  }

  for (const anchorDie of [{ x: -6, y: -3 }, { x: 200, y: -173 }, { x: 3, y: 4 }]) {
    const config = { width: 7, height: 5, diePitchX: pitchX, diePitchY: pitchY, anchorDie };
    const reticles = generateReticleGrid(wafer, config);
    assert.equal(reticles.length, bruteForceCount(config), `field count mismatch for anchor ${JSON.stringify(anchorDie)}`);
  }
});

test('generateReticleGrid — gridOrigin shifts field placement by a fractional (sub-die-pitch) amount', () => {
  const pitchX = 8, pitchY = 12;
  // Die grid's col=0 sits 3.5 die-pitches away from the wafer centre (not a
  // whole multiple of the pitch) — this is what happens for off-centre/partial
  // wafer coverage once buildWaferMap centres the data extent instead of the
  // true wafer centre (colMidX/colMidY).
  const gridOrigin = { x: 3.5 * pitchX, y: -1.5 * pitchY };
  const reticles = generateReticleGrid(wafer, {
    width: 4, height: 3, diePitchX: pitchX, diePitchY: pitchY, gridOrigin,
  });
  // Die (0,0)'s physical position is gridOrigin itself; its corner must still
  // land exactly on a field boundary.
  const field = fieldContaining(reticles, gridOrigin.x, gridOrigin.y);
  assert.ok(field, 'die (0,0) should fall inside a reticle field even with a fractional gridOrigin');
  assert.equal(gridOrigin.x - pitchX / 2, field.x - field.width / 2, 'min-x edge should track gridOrigin exactly, not round to the nearest pitch');
  assert.equal(gridOrigin.y - pitchY / 2, field.y - field.height / 2, 'min-y edge should track gridOrigin exactly, not round to the nearest pitch');
});

// ── buildWaferMap integration — reproduces the real-world report ──────────────
//
// The demo's synthetic data sweeps a symmetric index range, so its grid
// origin coincides exactly with the wafer centre (colMidX/colMidY = 0) and
// die.x already equals the internal column index (offsetX = 0). Real prober
// data is rarely centred like that, so both of those normally-zero
// corrections actually matter — this section reproduces reticle placement
// against non-centred data the way a real caller would supply it.

function offCenterResults() {
  // Prober coordinates 10..25 / 5..20, clipped to a disk — deliberately not
  // centred at (0,0), so buildWaferMap must compute a non-zero offsetX/offsetY
  // (die.x/die.y != internal column index) and a fractional colMidX/colMidY
  // (data extent midpoint is not a whole multiple of the die pitch).
  const results = [];
  for (let x = 10; x <= 25; x++) {
    for (let y = 5; y <= 20; y++) {
      if (Math.hypot(x - 17.5, y - 12.5) <= 9) results.push({ x, y, hbin: 1 });
    }
  }
  return results;
}

test('buildWaferMap — anchorDie pins an existing die to a field corner on non-centred data', () => {
  const results = offCenterResults();
  const probe = buildWaferMap({ results, dieConfig: { width: 8, height: 8 } });
  const anchorDie = { x: probe.dies[0].x, y: probe.dies[0].y };

  const result = buildWaferMap({
    results,
    dieConfig: { width: 8, height: 8 },
    reticleConfig: { width: 4, height: 4, anchorDie },
  });

  const anchor = result.dies.find(d => d.x === anchorDie.x && d.y === anchorDie.y);
  const cornerX = anchor.physX - 4; // pitchX/2
  const cornerY = anchor.physY - 4; // pitchY/2
  const field = result.reticles.find(r =>
    Math.abs((r.x - r.width / 2) - cornerX) < 1e-9 &&
    Math.abs((r.y - r.height / 2) - cornerY) < 1e-9,
  );
  assert.ok(field, `anchorDie ${JSON.stringify(anchorDie)} should sit exactly at a reticle field corner`);
});

test('buildWaferMap — every reticle field boundary is exactly die-pitch-aligned, never a fractional die-pitch off', () => {
  const results = offCenterResults();
  const result = buildWaferMap({
    results,
    dieConfig: { width: 8, height: 8 },
    reticleConfig: { width: 4, height: 4, anchorDie: { x: 11, y: 6 } },
  });

  // Reference: a die's own min-x/min-y corner, known to be exactly grid-aligned.
  const ref = result.dies[0];
  const refCornerX = ref.physX - 4; // pitchX/2
  const refCornerY = ref.physY - 4; // pitchY/2

  assert.ok(result.reticles.length > 0, 'expected at least one reticle field');
  for (const field of result.reticles) {
    const cornerX = field.x - field.width / 2;
    const cornerY = field.y - field.height / 2;
    // Every field corner must be an integer number of die-pitches away from
    // the reference die corner -- not requiring an actual (possibly clipped)
    // die to sit there, just that the two grids tile together exactly.
    const stepsX = (cornerX - refCornerX) / 8;
    const stepsY = (cornerY - refCornerY) / 8;
    assert.ok(Math.abs(stepsX - Math.round(stepsX)) < 1e-9, `field corner x=${cornerX} is off the die grid by a fractional die-pitch`);
    assert.ok(Math.abs(stepsY - Math.round(stepsY)) < 1e-9, `field corner y=${cornerY} is off the die grid by a fractional die-pitch`);
  }
});

// ── Reticle overlay alignment under non-default grid/display conventions ──────
//
// The reticle overlay geometry (drawn field rectangles, and the "keep only
// fields containing a die" filter in buildWaferMap's buildReticles) is
// computed independently of the die transform pipeline, in the PRE-transform
// physical frame. Every non-default xAxisDirection/yAxisDirection/
// coordinateOrigin/waferConfig.orientation/interactive rotate-flip must
// replay the exact same bake dies went through (applyOrientation, then
// transformDies) or the drawn boxes silently group the WRONG dies together —
// a correctness bug, not just a display glitch, since which dies are
// attributed to which stepper field is what reticle-position findings and
// the "Reticle (column, row)" tooltip line are built on.
//
// These tests assert the actual invariant that matters: which dies get
// grouped into the same drawn field rectangle must be IDENTICAL to the
// default (untransformed) grouping, regardless of display convention — only
// the on-screen position of that group may change.

function pointInPolygon(pt, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y, xj = poly[j].x, yj = poly[j].y;
    const intersect = ((yi > pt.y) !== (yj > pt.y)) &&
      (pt.x < ((xj - xi) * (pt.y - yi)) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

// Partition of dies into "which drawn reticle field contains it", expressed
// as a set of die-index groups (die.x,die.y — never physical position, so
// it's directly comparable across configs whose on-screen layout differs).
//
// Uses view.hoverPoints (not die.physX/physY) for each die's on-screen
// position: hoverPoints is the interactive-rotation/flip-transformed
// position (same index order as result.dies — see buildView.ts), whereas
// die.physX/physY only carries the BAKED (data-pipeline) transform. The
// drawn reticle overlay is transformed all the way to on-screen coordinates
// (baked + interactive), so the die position it's tested against must be too.
function fieldPartition(result) {
  const reticleOverlays = result.view.overlays.filter(o => o.kind === 'reticle');
  const groups = new Map();
  result.dies.forEach((die, i) => {
    const pt = result.view.hoverPoints[i];
    const idx = reticleOverlays.findIndex(o => pointInPolygon(pt, o.points[0]));
    assert.notEqual(idx, -1, `die (${die.x},${die.y}) is not covered by any drawn reticle field`);
    if (!groups.has(idx)) groups.set(idx, []);
    groups.get(idx).push(`${die.x},${die.y}`);
  });
  return new Set([...groups.values()].map(g => g.sort().join('|')));
}

function asymmetricRowResults() {
  // Odd field width (3) and an asymmetric die range so the field tiling is
  // never accidentally symmetric about the wafer/data centre — a coincidence
  // that would mask a broken transform.
  const results = [];
  for (let x = -4; x <= 2; x++) results.push({ x, y: 0, hbin: 1 });
  return results;
}

function buildWithConfig(dieConfigExtra, waferConfigExtra, viewOptionsExtra, anchorDie = { x: 0, y: 0 }) {
  return buildWaferMap({
    results: asymmetricRowResults(),
    dieConfig: { width: 5, height: 5, ...dieConfigExtra },
    waferConfig: { diameter: 300, ...waferConfigExtra },
    reticleConfig: { width: 3, height: 1, anchorDie },
  }, viewOptionsExtra);
}

test('reticle overlay field grouping is invariant to xAxisDirection/yAxisDirection/coordinateOrigin/orientation', () => {
  const baseline = fieldPartition(buildWithConfig({}, {}));
  assert.ok(baseline.size > 1, 'sanity: test data must span more than one reticle field');

  const configs = [
    ['xAxisDirection: left',  { xAxisDirection: 'left' }, {}],
    ['yAxisDirection: down',  { yAxisDirection: 'down' }, {}],
    ['coordinateOrigin LL',   { coordinateOrigin: { type: 'LL' } }, {}],
    ['coordinateOrigin UL',   { coordinateOrigin: { type: 'UL' } }, {}],
    ['coordinateOrigin LR',   { coordinateOrigin: { type: 'LR' } }, {}],
    ['coordinateOrigin UR',   { coordinateOrigin: { type: 'UR' } }, {}],
  ];
  for (const [label, dieConfigExtra] of configs) {
    const partition = fieldPartition(buildWithConfig(dieConfigExtra, {}));
    assert.deepEqual(partition, baseline, `${label}: reticle field grouping diverged from the default (untransformed) grouping`);
  }

  for (const orientation of [90, 180, 270]) {
    const partition = fieldPartition(buildWithConfig({}, { orientation }));
    assert.deepEqual(partition, baseline, `wafer orientation ${orientation}: reticle field grouping diverged from the default grouping`);
  }

  // A flip AND a rotation together — the case most likely to expose an
  // order-of-composition bug (mirror and rotation do not commute).
  const combo = fieldPartition(buildWithConfig({ xAxisDirection: 'left' }, { orientation: 90 }));
  assert.deepEqual(combo, baseline, 'xAxisDirection: left + wafer orientation 90: reticle field grouping diverged from the default grouping');
});

test('reticle overlay field grouping is invariant to interactive rotation/flip (toolbar transform)', () => {
  const baseline = fieldPartition(buildWithConfig({}, {}));

  const interactiveConfigs = [
    ['interactive flipX',   { interactiveTransform: { flipX: true } }],
    ['interactive flipY',   { interactiveTransform: { flipY: true } }],
    ['interactive rotation 90', { interactiveTransform: { rotation: 90 } }],
    ['interactive rotation 90 + flipX', { interactiveTransform: { rotation: 90, flipX: true } }],
  ];
  for (const [label, viewOptionsExtra] of interactiveConfigs) {
    const partition = fieldPartition(buildWithConfig({}, {}, viewOptionsExtra));
    assert.deepEqual(partition, baseline, `${label}: reticle field grouping diverged from the default grouping`);
  }
});

test('reticle overlay field grouping is invariant to non-90°-multiple rotation angles', () => {
  // wafer.orientation and interactiveTransform.rotation both accept arbitrary
  // degrees, not just quarter turns (unlike the notch/quadrant convention most
  // real callers use) — rotateAndFlip must handle any angle, not just 0/90/180/270.
  const baseline = fieldPartition(buildWithConfig({}, {}));

  const arbitraryAngleConfigs = [
    ['wafer orientation 37deg',    {}, { orientation: 37 }],
    ['wafer orientation 12.5deg',  {}, { orientation: 12.5 }],
    ['interactive rotation 25deg', {}, {}, { interactiveTransform: { rotation: 25 } }],
  ];
  for (const [label, dieConfigExtra, waferConfigExtra, viewOptionsExtra] of arbitraryAngleConfigs) {
    const partition = fieldPartition(buildWithConfig(dieConfigExtra, waferConfigExtra, viewOptionsExtra));
    assert.deepEqual(partition, baseline, `${label}: reticle field grouping diverged from the default grouping`);
  }
});

test('reticle overlay field grouping is invariant when every transform stacks at once', () => {
  // Data-pipeline flip + wafer orientation + interactive rotation + interactive
  // flip, all simultaneously nonzero — the case most likely to expose an
  // ordering mistake in the bake-then-interactive composition.
  const baseline = fieldPartition(buildWithConfig({}, {}));
  const stacked = fieldPartition(buildWithConfig(
    { xAxisDirection: 'left' },
    { orientation: 90 },
    { interactiveTransform: { rotation: 90, flipY: true } },
  ));
  assert.deepEqual(stacked, baseline, 'fully stacked transform: reticle field grouping diverged from the default grouping');
});

test('reticle overlay field grouping is invariant to axis flip/orientation with a non-zero anchorDie', () => {
  // The original bug report was specifically about a non-zero anchorDie
  // (mislabeled findings) — repeat the transform matrix with anchorDie != {0,0}
  // to make sure that case, not just the anchorDie={0,0} default, is covered.
  const anchorDie = { x: 2, y: 0 };
  const baseline = fieldPartition(buildWithConfig({}, {}, {}, anchorDie));

  const configs = [
    ['xAxisDirection: left', { xAxisDirection: 'left' }, {}, {}],
    ['coordinateOrigin UR',  { coordinateOrigin: { type: 'UR' } }, {}, {}],
    ['wafer orientation 90', {}, { orientation: 90 }, {}],
    ['interactive rotation 90 + flipX', {}, {}, { interactiveTransform: { rotation: 90, flipX: true } }],
  ];
  for (const [label, dieConfigExtra, waferConfigExtra, viewOptionsExtra] of configs) {
    const partition = fieldPartition(buildWithConfig(dieConfigExtra, waferConfigExtra, viewOptionsExtra, anchorDie));
    assert.deepEqual(partition, baseline, `${label} (anchorDie={2,0}): reticle field grouping diverged from the default grouping`);
  }
});

test('buildWaferMap({ dies }) explicit-dies path honors waferConfig.orientation for reticle fields', () => {
  // The explicit-dies input path (pre-built Die[], geometry generation skipped)
  // never ran applyOrientation on the caller's dies, while the reticle (and
  // quadrant-boundary) overlay always rotated by wafer.orientation regardless —
  // a pre-existing mismatch, not introduced by the flip/orientation fix above,
  // uncovered while verifying it. Confirmed before the fix: 6 of 7 dies ended up
  // with no covering reticle field at orientation=90.
  const dies = [];
  for (let x = -4; x <= 2; x++) {
    dies.push({ id: `${x}_0`, x, y: 0, physX: x * 5, physY: 0, width: 5, height: 5, hbin: 1 });
  }
  const result = buildWaferMap({
    dies,
    waferConfig: { diameter: 300, orientation: 90 },
    reticleConfig: { width: 3, height: 1, anchorDie: { x: 0, y: 0 } },
  });
  const partition = fieldPartition(result);
  const totalGrouped = [...partition].reduce((n, g) => n + g.split('|').length, 0);
  assert.equal(totalGrouped, dies.length, 'every die must be covered by exactly one drawn reticle field');
});
