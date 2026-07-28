import test from 'node:test';
import assert from 'node:assert/strict';
import { buildWaferMap } from '../dist/index.js';
import {
  affineIdentity, affineRotation, affineMirror, affineCompose,
  affineInvert, affinePoint, affineVector, affineSwapsAxes, rotatePoint,
} from '../dist/packages/core/transforms.js';

// ─────────────────────────────────────────────────────────────────────────────
// Display-transform correctness.
//
// Every overlay and every die rectangle is placed by composing rotations and
// mirrors. Rotation and mirroring do NOT commute, and geometry generated outside
// the die pipeline (reticle fields, axis indicator, wafer outline) has to replay
// exactly the transforms the dies went through. Getting that wrong does not throw
// — it silently draws correct-looking geometry over the wrong dies, which for a
// wafer map is a wrong answer, not a cosmetic bug.
//
// These tests therefore assert *invariants against the dies themselves* rather
// than against expected coordinates: whatever the display convention, the overlay
// must land on the same dies it does in the untransformed baseline.
// ─────────────────────────────────────────────────────────────────────────────

const EPS = 1e-6;
const sgn = (v) => (Math.abs(v) < EPS ? 0 : Math.sign(v));

/** The full display-convention matrix these invariants must hold across. */
const CONFIGS = [
  ['baseline',                      {},                                   {},                {}],
  ['xAxisDirection:left',           { xAxisDirection: 'left' },           {},                {}],
  ['yAxisDirection:down',           { yAxisDirection: 'down' },           {},                {}],
  ['coordinateOrigin LL',           { coordinateOrigin: { type: 'LL' } }, {},                {}],
  ['coordinateOrigin UL',           { coordinateOrigin: { type: 'UL' } }, {},                {}],
  ['coordinateOrigin LR',           { coordinateOrigin: { type: 'LR' } }, {},                {}],
  ['coordinateOrigin UR',           { coordinateOrigin: { type: 'UR' } }, {},                {}],
  ['orientation 90',                {},                                   { orientation: 90 },  {}],
  ['orientation 180',               {},                                   { orientation: 180 }, {}],
  ['orientation 270',               {},                                   { orientation: 270 }, {}],
  ['interactive rot90',             {},                                   {},                { interactiveTransform: { rotation: 90 } }],
  ['interactive flipX',             {},                                   {},                { interactiveTransform: { flipX: true } }],
  ['interactive flipY',             {},                                   {},                { interactiveTransform: { flipY: true } }],
  ['orient90 + xleft',              { xAxisDirection: 'left' },           { orientation: 90 },  {}],
  // Rotation → mirror → rotation → mirror, every stage non-trivial. This is the
  // composition a summed-angle + XOR'd-flags model provably cannot represent.
  ['orient90 + xleft + rot90',      { xAxisDirection: 'left' },           { orientation: 90 },  { interactiveTransform: { rotation: 90 } }],
  ['orient270 + UR + rot90 + flipY',{ coordinateOrigin: { type: 'UR' } }, { orientation: 270 }, { interactiveTransform: { rotation: 90, flipY: true } }],
];

function gridResults(min = -3, max = 3) {
  const out = [];
  for (let x = min; x <= max; x++) for (let y = min; y <= max; y++) out.push({ x, y, hbin: 1 });
  return out;
}

function build(dieConfigExtra, waferConfigExtra, viewOpts, { pitch = { width: 5, height: 5 }, reticleConfig } = {}) {
  return buildWaferMap({
    results: gridResults(),
    dieConfig: { ...pitch, ...dieConfigExtra },
    waferConfig: { diameter: 300, ...waferConfigExtra },
    ...(reticleConfig ? { reticleConfig } : {}),
  }, { showXYIndicator: true, showRingBoundaries: true, showQuadrantBoundaries: true, ...viewOpts });
}

/** Screen position of a die, by die-grid index. */
function screenPos(result, x, y) {
  const i = result.view.dies.findIndex((d) => d.x === x && d.y === y);
  assert.notEqual(i, -1, `die (${x},${y}) missing`);
  return result.view.hoverPoints[i];
}

// ── The matrix primitive ─────────────────────────────────────────────────────

test('affineRotation reproduces rotatePoint exactly', () => {
  for (const deg of [0, 37, 90, 180, 270, -45]) {
    const m = affineRotation(deg, 3, -7);
    for (const [x, y] of [[0, 0], [10, 0], [-4, 9], [3, -7]]) {
      const a = affinePoint(m, x, y);
      const b = rotatePoint(x, y, deg, 3, -7);
      assert.ok(Math.hypot(a.x - b.x, a.y - b.y) < 1e-9,
        `rotation ${deg}° at (${x},${y}) diverges from rotatePoint`);
    }
  }
});

test('affineCompose applies inner first, then outer', () => {
  const rot = affineRotation(90, 0, 0);
  const mir = affineMirror(true, false, 0, 0);
  const composed = affineCompose(mir, rot); // rotate, then mirror
  const p = affinePoint(composed, 10, 0);
  const stepwise = (() => { const r = affinePoint(rot, 10, 0); return affinePoint(mir, r.x, r.y); })();
  assert.ok(Math.hypot(p.x - stepwise.x, p.y - stepwise.y) < 1e-9, 'compose must equal sequential application');
});

test('affineInvert round-trips any composed transform', () => {
  const m = affineCompose(
    affineCompose(affineMirror(true, true, 2, 3), affineRotation(90, 2, 3)),
    affineRotation(37, 2, 3),
  );
  const inv = affineInvert(m);
  for (const [x, y] of [[0, 0], [11, -4], [-6, 8]]) {
    const back = affinePoint(inv, ...Object.values(affinePoint(m, x, y)));
    assert.ok(Math.hypot(back.x - x, back.y - y) < 1e-9, `round-trip failed at (${x},${y})`);
  }
});

test('rotation and mirroring do NOT commute — the reason a matrix is required', () => {
  // This is the precise fact that made the previous
  // `{ rotation:number, flipX:boolean, flipY:boolean }` representation unsound:
  // it can only express "one rotation then one mirror", but the real pipeline is
  // rotate → mirror → rotate → mirror.
  const real = affineCompose(affineRotation(90, 0, 0), affineMirror(true, false, 0, 0)); // mirror then rotate
  const swapped = affineCompose(affineMirror(true, false, 0, 0), affineRotation(90, 0, 0)); // rotate then mirror
  const a = affinePoint(real, 10, 0), b = affinePoint(swapped, 10, 0);
  assert.ok(Math.hypot(a.x - b.x, a.y - b.y) > 1, 'ordering must matter — otherwise this whole test file is moot');
});

test('affineSwapsAxes is true exactly for the 90°/270° class', () => {
  assert.equal(affineSwapsAxes(affineIdentity()), false);
  assert.equal(affineSwapsAxes(affineRotation(90)), true);
  assert.equal(affineSwapsAxes(affineRotation(270)), true);
  assert.equal(affineSwapsAxes(affineRotation(180)), false);
  assert.equal(affineSwapsAxes(affineRotation(37)), false, 'non-cardinal rotation is not an axis swap');
  assert.equal(affineSwapsAxes(affineMirror(true, true)), false, 'mirroring alone never swaps axes');
  assert.equal(affineSwapsAxes(affineCompose(affineMirror(true, false), affineRotation(90))), true,
    'a mirrored quarter-turn still swaps axes');
});

// ── View-level invariants across the full config matrix ──────────────────────

test('view.gridToScreen reproduces every die position, in every configuration', () => {
  // gridToScreen is the authoritative transform other code (axis tick labels)
  // inverts. If it disagrees with where dies actually are, every label built from
  // it names the wrong die.
  for (const [label, dc, wc, vo] of CONFIGS) {
    const r = build(dc, wc, vo);
    let worst = 0;
    r.view.dies.forEach((die, i) => {
      const p = affineVector(r.view.gridToScreen, die.x * 5, die.y * 5);
      const actual = r.view.hoverPoints[i];
      worst = Math.max(worst, Math.hypot(p.x - actual.x, p.y - actual.y));
    });
    assert.ok(worst < 1e-9, `${label}: gridToScreen disagrees with actual die positions by ${worst}mm`);
  }
});

test('XY indicator arrows point the way the die indices actually run', () => {
  for (const [label, dc, wc, vo] of CONFIGS) {
    const r = build(dc, wc, vo);
    const dxDir = { x: sgn(screenPos(r, 3, 0).x - screenPos(r, -3, 0).x), y: sgn(screenPos(r, 3, 0).y - screenPos(r, -3, 0).y) };
    const dyDir = { x: sgn(screenPos(r, 0, 3).x - screenPos(r, 0, -3).x), y: sgn(screenPos(r, 0, 3).y - screenPos(r, 0, -3).y) };

    const arrows = r.view.overlays.filter((o) => o.kind === 'xy-indicator');
    assert.equal(arrows.length, 2, `${label}: expected +X and +Y arrows`);
    const vec = (o) => ({ x: sgn(o.points[0][1].x - o.points[0][0].x), y: sgn(o.points[0][1].y - o.points[0][0].y) });

    assert.deepEqual(vec(arrows[0]), dxDir, `${label}: +X arrow contradicts the direction die.x actually increases`);
    assert.deepEqual(vec(arrows[1]), dyDir, `${label}: +Y arrow contradicts the direction die.y actually increases`);
  }
});

test('die rectangles never overlap their neighbours — square and non-square dies', () => {
  // A die rect is axis-aligned in the pre-bake grid frame, so its width/height
  // must swap whenever the total transform is a quarter turn — including a turn
  // that came from wafer.orientation rather than the interactive control. Keying
  // the swap off the interactive rotation alone drew non-square dies at their
  // unrotated size, overlapping every neighbour.
  for (const pitch of [{ width: 5, height: 5 }, { width: 10, height: 4 }, { width: 3, height: 11 }]) {
    for (const [label, dc, wc, vo] of CONFIGS) {
      const r = build(dc, wc, vo, { pitch });
      const rect = r.view.rectangles[0];
      for (const [ax, ay] of [[1, 0], [0, 1]]) {
        const a = screenPos(r, 0, 0), b = screenPos(r, ax, ay);
        const dx = Math.abs(b.x - a.x), dy = Math.abs(b.y - a.y);
        // Neighbours separate along exactly one screen axis; the rect extent on
        // that axis must fit inside the gap.
        const [gap, extent] = dx > dy ? [dx, rect.width] : [dy, rect.height];
        assert.ok(extent <= gap + EPS,
          `${label} @ ${pitch.width}x${pitch.height}: rect extent ${extent.toFixed(2)}mm exceeds neighbour spacing ${gap.toFixed(2)}mm — dies overlap`);
      }
    }
  }
});

test('ring overlays stay concentric circles about the wafer centre under every transform', () => {
  for (const [label, dc, wc, vo] of CONFIGS) {
    const r = build(dc, wc, vo);
    const rings = r.view.overlays.filter((o) => o.kind === 'ring-boundary');
    assert.ok(rings.length > 0, `${label}: expected ring overlays`);
    for (const ring of rings) {
      const radii = ring.points[0].map((p) => Math.hypot(p.x - r.wafer.center.x, p.y - r.wafer.center.y));
      const spread = Math.max(...radii) - Math.min(...radii);
      assert.ok(spread < 1e-6, `${label}: ring is not a circle about the wafer centre (radius spread ${spread})`);
    }
  }
});

test('wafer boundary encloses every die, in every configuration', () => {
  for (const [label, dc, wc, vo] of CONFIGS) {
    const r = build(dc, wc, vo);
    const boundary = r.view.overlays.find((o) => o.kind === 'wafer-boundary');
    assert.ok(boundary, `${label}: expected a wafer-boundary overlay`);
    const radii = boundary.points[0].map((p) => Math.hypot(p.x - r.wafer.center.x, p.y - r.wafer.center.y));
    assert.ok(Math.max(...radii) <= r.wafer.radius + 1e-6, `${label}: boundary exceeds the wafer radius`);
    for (const die of r.view.dies) {
      const d = Math.hypot(die.physX - r.wafer.center.x, die.physY - r.wafer.center.y);
      assert.ok(d <= r.wafer.radius + 1e-6, `${label}: die (${die.x},${die.y}) lies outside the wafer boundary`);
    }
  }
});

test('reticle fields group the same dies regardless of display convention', () => {
  // Mirrors tests/reticle.test.mjs but driven from the shared CONFIGS matrix, so
  // any convention added there is automatically covered for reticles too.
  const reticleConfig = { width: 3, height: 2, anchorDie: { x: 1, y: 0 } };
  const inPoly = (pt, poly) => {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const xi = poly[i].x, yi = poly[i].y, xj = poly[j].x, yj = poly[j].y;
      if (((yi > pt.y) !== (yj > pt.y)) && (pt.x < ((xj - xi) * (pt.y - yi)) / (yj - yi) + xi)) inside = !inside;
    }
    return inside;
  };
  const partition = (r) => {
    const fields = r.view.overlays.filter((o) => o.kind === 'reticle');
    const groups = new Map();
    r.view.dies.forEach((die, i) => {
      const idx = fields.findIndex((o) => inPoly(r.view.hoverPoints[i], o.points[0]));
      assert.notEqual(idx, -1, `die (${die.x},${die.y}) is covered by no reticle field`);
      if (!groups.has(idx)) groups.set(idx, []);
      groups.get(idx).push(`${die.x},${die.y}`);
    });
    return new Set([...groups.values()].map((g) => g.sort().join('|')));
  };

  const baseline = partition(build({}, {}, {}, { reticleConfig }));
  assert.ok(baseline.size > 1, 'sanity: data must span more than one reticle field');
  for (const [label, dc, wc, vo] of CONFIGS) {
    assert.deepEqual(partition(build(dc, wc, vo, { reticleConfig })), baseline,
      `${label}: reticle field grouping diverged from the baseline`);
  }
});
