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
