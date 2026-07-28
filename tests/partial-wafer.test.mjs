import test from 'node:test';
import assert from 'node:assert/strict';

import { buildWaferMap } from '../dist/index.js';

const PITCH = 10;

// Build a circular-masked set of prober results centred on prober (cx, cy),
// optionally keeping only one half/quadrant to simulate partial coverage.
//
// Keeps a die only when it fits ENTIRELY inside the disc (furthest corner within
// the radius), not merely when its centre does. That models a real prober map: a
// prober can only step to sites that lie wholly on the wafer, so probed dies are
// never edge-straddling. A centre-only test emits dies that overhang the wafer
// edge, which buildWaferMap now (correctly) reports as impossible geometry.
function disc(cx, cy, radiusSteps, keep = () => true) {
  const results = [];
  for (let x = cx - radiusSteps; x <= cx + radiusSteps; x++) {
    for (let y = cy - radiusSteps; y <= cy + radiusSteps; y++) {
      const dx = Math.abs(x - cx) + 0.5, dy = Math.abs(y - cy) + 0.5;
      if (dx * dx + dy * dy <= radiusSteps * radiusSteps && keep(x, y, cx, cy)) {
        results.push({ x, y, hbin: 1 });
      }
    }
  }
  return results;
}

function findDie(result, x, y) {
  return result.dies.find((d) => d.x === x && d.y === y);
}

const anchoredConfig = (center) => ({
  waferConfig: { diameter: 300, center },
  dieConfig: { width: PITCH, height: PITCH },
});

test('partial: half-wafer anchored at (0,0) positions the centre die at physical origin', () => {
  // Right half only: prober x ∈ [0..15]. True centre is prober (0,0).
  const results = disc(0, 0, 15, (x) => x >= 0);
  const result = buildWaferMap({ results, ...anchoredConfig({ x: 0, y: 0 }) });

  const centre = findDie(result, 0, 0);
  assert.ok(centre, 'die (0,0) exists');
  assert.equal(centre.physX, 0);
  assert.equal(centre.physY, 0);
  // Right-half data must stay on the +X side of the true centre.
  assert.ok(result.dies.every((d) => d.physX >= -1e-9));
  assert.equal(result.wafer.diameter, 300);
  // Anchored → no partial-data warning.
  assert.ok(!result.inference.warnings || result.inference.warnings.length === 0);
});

test('partial: single quadrant anchored at (0,0) keeps dies in the +X/+Y quadrant', () => {
  const results = disc(0, 0, 10, (x, y) => x >= 0 && y >= 0);
  const result = buildWaferMap({ results, ...anchoredConfig({ x: 0, y: 0 }) });

  const centre = findDie(result, 0, 0);
  assert.equal(centre.physX, 0);
  assert.equal(centre.physY, 0);
  assert.ok(result.dies.every((d) => d.physX >= -1e-9 && d.physY >= -1e-9));
  assert.ok(!result.inference.warnings || result.inference.warnings.length === 0);
});

test('partial: off-center prober origin — center at prober (5,5) anchors there, labels preserved', () => {
  // Full disc but the prober origin is at the corner: true centre is prober (5,5).
  const results = disc(5, 5, 15);
  const result = buildWaferMap({ results, ...anchoredConfig({ x: 5, y: 5 }) });

  const centre = findDie(result, 5, 5);
  assert.ok(centre, 'die labelled (5,5) exists — original prober coords preserved');
  assert.equal(centre.physX, 0);
  assert.equal(centre.physY, 0);
  // A die one step right of centre sits one pitch to the +X side.
  const right = findDie(result, 6, 5);
  assert.equal(right.physX, PITCH);
});

test('partial: sparse off-center cluster anchored is NOT re-centered to the origin', () => {
  // A small cluster around prober (10,10), with the true wafer centre at (0,0).
  const results = disc(10, 10, 3);
  const result = buildWaferMap({ results, ...anchoredConfig({ x: 0, y: 0 }) });

  // The cluster centre die (10,10) must sit out at +100mm, not pulled to origin.
  const clusterCentre = findDie(result, 10, 10);
  assert.equal(clusterCentre.physX, 100);
  assert.equal(clusterCentre.physY, 100);
});

test('partial: half-wafer with NO geometry emits an inference warning (current fallback)', () => {
  const results = disc(0, 0, 15, (x) => x >= 0);
  const result = buildWaferMap({ results });

  assert.ok(Array.isArray(result.inference.warnings));
  assert.ok(result.inference.warnings.length > 0);
  assert.equal(result.inference.wafer.method, 'inferred-partial');

  // Promoted structured channel mirrors the deprecated string array.
  assert.ok(Array.isArray(result.warnings));
  const partial = result.warnings.find((w) => w.code === 'partial-coverage');
  assert.ok(partial, 'structured partial-coverage warning present');
  assert.equal(typeof partial.message, 'string');
  assert.ok(partial.message.length > 0);
  // String mirror and structured messages stay in sync.
  assert.deepEqual(
    result.inference.warnings,
    result.warnings.map((w) => w.message),
  );
  // Documented limitation (not asserted as correct): with no anchor the data
  // midpoint — not the true centre — is placed at the origin, so the centre die
  // is pushed off the physical origin. This is exactly why the warning fires.
  const centre = findDie(result, 0, 0);
  assert.ok(centre.physX < 0);
});

test('partial: symmetric full wafer with no geometry is unchanged and warning-free (regression guard)', () => {
  const results = disc(0, 0, 15);
  const result = buildWaferMap({ results });

  const centre = findDie(result, 0, 0);
  assert.equal(centre.physX, 0);
  assert.equal(centre.physY, 0);
  assert.ok(!result.inference.warnings || result.inference.warnings.length === 0);
  // Promoted channel is always an array; empty when geometry is trustworthy.
  assert.ok(Array.isArray(result.warnings));
  assert.equal(result.warnings.length, 0);
});

test('partial: full wafer with an off-origin prober coordinate system does NOT warn', () => {
  // Full symmetric coverage, but prober (0,0) is a corner — the wafer centre is
  // prober (5,5). Detection keys on coverage symmetry, not on the origin being
  // at the centre, so this must not be flagged as partial.
  const results = disc(5, 5, 15);
  const result = buildWaferMap({ results });
  assert.ok(!result.inference.warnings || result.inference.warnings.length === 0);
});

test('partial: single quadrant with no geometry is flagged as partial', () => {
  const results = disc(0, 0, 15, (x, y) => x >= 0 && y >= 0);
  const result = buildWaferMap({ results });
  assert.ok(result.inference.warnings && result.inference.warnings.length > 0);
});

test('sparse: full-extent skip-sampled data is NOT flagged (positions missing, extent intact)', () => {
  // Every other row and column across the whole wafer — sparse, not partial.
  // The extent still reaches the edge, so geometry resolves correctly.
  const results = disc(0, 0, 15, (x, y) => x % 2 === 0 && y % 2 === 0);
  const result = buildWaferMap({ results });

  // Centre die still lands at the origin — coverage is balanced.
  const centre = findDie(result, 0, 0);
  assert.equal(centre.physX, 0);
  assert.equal(centre.physY, 0);
  assert.ok(!result.inference.warnings || result.inference.warnings.length === 0);
});

// ── Probed dies are always fully on the wafer ────────────────────────────────
//
// A die carrying test results is a real tested prober position, and a prober can
// only step to sites that lie entirely on the wafer — a prober map never contains
// edge-straddling dies. So the die extent is ground truth and the wafer geometry
// is the guess: inferred geometry must yield to the data, never the reverse.

/** A realistic prober map: every die fully inside a `diameterMm` wafer. */
function proberMap(diameterMm, pitch) {
  const r = diameterMm / 2, out = [];
  const n = Math.ceil(r / pitch) + 1;
  for (let x = -n; x <= n; x++) {
    for (let y = -n; y <= n; y++) {
      if (Math.hypot(Math.abs(x * pitch) + pitch / 2, Math.abs(y * pitch) + pitch / 2) <= r) {
        out.push({ x, y, hbin: 1 });
      }
    }
  }
  return out;
}

const fitsEntirely = (die, wafer) =>
  Math.hypot(Math.abs(die.physX) + die.width / 2, Math.abs(die.physY) + die.height / 2)
    <= wafer.radius + 1e-6;

test('invariant: inferred geometry always fully contains every probed die', () => {
  const probed = proberMap(300, PITCH);
  // Reticle-filtered: whole edge fields dropped, the case that used to undersize
  // the inferred circle and manufacture partial dies.
  const key = (x, y) => `${Math.floor(x / 5)}|${Math.floor(y / 5)}`;
  const seen = new Map();
  for (const d of probed) seen.set(key(d.x, d.y), (seen.get(key(d.x, d.y)) ?? 0) + 1);
  const filtered = probed.filter(d => seen.get(key(d.x, d.y)) === 25);

  for (const [label, data] of [['full prober map', probed], ['reticle-filtered', filtered]]) {
    for (const [cfgLabel, cfg] of [
      ['no config',  {}],
      ['pitch only', { dieConfig: { width: PITCH, height: PITCH } }],
    ]) {
      const result = buildWaferMap({ results: data, ...cfg });
      const escaped = result.dies.filter(d => !fitsEntirely(d, result.wafer));
      assert.equal(escaped.length, 0,
        `${label} / ${cfgLabel}: ${escaped.length} probed dies fall outside the inferred wafer`);
    }
  }
});

test('invariant: a die built from results is never marked partial', () => {
  const probed = proberMap(300, PITCH);
  for (const cfg of [
    {},
    { dieConfig: { width: PITCH, height: PITCH } },
    { waferConfig: { diameter: 300 } },
    { dieConfig: { width: PITCH, height: PITCH }, waferConfig: { diameter: 300 } },
    // Even a deliberately wrong wafer must not relabel real probed sites as partial.
    { dieConfig: { width: PITCH, height: PITCH }, waferConfig: { diameter: 100 } },
  ]) {
    const result = buildWaferMap({ results: probed, ...cfg });
    assert.equal(result.dies.filter(d => d.partial).length, 0,
      `probed dies were flagged partial for config ${JSON.stringify(cfg)}`);
  }
});

test('invariant: caller geometry too small for the probed dies warns, and is not silently resized', () => {
  const probed = proberMap(300, PITCH);
  const result = buildWaferMap({
    results: probed,
    dieConfig: { width: PITCH, height: PITCH },
    waferConfig: { diameter: 100 },
  });
  // The caller asserted 100 mm — we report the contradiction rather than overriding it.
  assert.equal(result.wafer.diameter, 100, 'explicit diameter must be respected, not silently changed');
  const warning = (result.inference.warnings ?? []).find(w => w.includes('do not fit inside'));
  assert.ok(warning, 'expected a geometry-contradiction warning');
  assert.match(warning, /probed die positions/);
  assert.match(warning, /at least/, 'warning should state the diameter actually required');
});

test('invariant: "dies do not fit" is only claimed when the pitch was actually supplied', () => {
  // Pitch is a free scaling parameter — for any grid positions and any diameter
  // there is always a pitch small enough to fit them. So with an inferred pitch,
  // "these dies don't fit" says nothing about the data. Worse: diameter-without-
  // pitch derives pitch = diameter / gridSpan, which makes the data span the
  // diameter edge-to-edge by construction, so corners ALWAYS fall outside — the
  // check would report a contradiction it created, on perfectly good data.
  const probed = proberMap(300, PITCH);

  const inferredPitch = buildWaferMap({ results: probed, waferConfig: { diameter: 300 } });
  assert.equal(
    inferredPitch.warnings.filter(w => w.code === 'geometry-conflict').length, 0,
    'must not claim a fit failure when the pitch was invented',
  );
  assert.deepEqual(inferredPitch.warnings.map(w => w.code), ['inferred-pitch'],
    'should instead flag the unverifiable pitch assumption');
  assert.match(inferredPitch.warnings[0].message, /dieConfig\.width/, 'must point at the actual fix');

  // Correct data + correct pitch + correct diameter → silent.
  const correct = buildWaferMap({
    results: probed, dieConfig: { width: PITCH, height: PITCH }, waferConfig: { diameter: 300 },
  });
  assert.equal(correct.warnings.length, 0, 'correct geometry must not warn');
});

test('invariant: any pitch small enough fits, so a fit claim requires a supplied pitch', () => {
  const probed = proberMap(300, PITCH);
  for (const pitch of [10, 8, 5, 2]) {
    const result = buildWaferMap({
      results: probed, dieConfig: { width: pitch, height: pitch }, waferConfig: { diameter: 300 },
    });
    assert.equal(result.warnings.filter(w => w.code === 'geometry-conflict').length, 0,
      `pitch ${pitch}mm fits inside 300mm and must not be flagged`);
  }
});

test('invariant: geometry-conflict is its own warning code, distinct from partial-coverage', () => {
  // Hosts branch on `code`, not on prose — the two advisories must not collide.
  const probed = proberMap(300, PITCH);
  const conflict = buildWaferMap({
    results: probed,
    dieConfig: { width: PITCH, height: PITCH },
    waferConfig: { diameter: 100 },
  });
  assert.deepEqual(conflict.warnings.map(w => w.code), ['geometry-conflict']);

  // A genuinely partial dataset still reports partial-coverage, not the new code.
  const halfWafer = probed.filter(d => d.x >= 0);
  const partial = buildWaferMap({ results: halfWafer });
  assert.ok(partial.warnings.length > 0);
  assert.ok(partial.warnings.every(w => w.code === 'partial-coverage'));

  // The deprecated string channel and the structured channel stay in sync.
  for (const result of [conflict, partial]) {
    assert.deepEqual(result.inference.warnings, result.warnings.map(w => w.message));
  }
});
