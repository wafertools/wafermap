import test from 'node:test';
import assert from 'node:assert/strict';

import { buildWaferMap } from '../dist/index.js';

const PITCH = 10;

// Build a circular-masked set of prober results centred on prober (cx, cy),
// optionally keeping only one half/quadrant to simulate partial coverage.
function disc(cx, cy, radiusSteps, keep = () => true) {
  const results = [];
  for (let x = cx - radiusSteps; x <= cx + radiusSteps; x++) {
    for (let y = cy - radiusSteps; y <= cy + radiusSteps; y++) {
      const dx = x - cx, dy = y - cy;
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
