import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildRingRegions,
  buildQuadrantRegions,
  buildReticlePositionRegions,
  buildSectorRegions,
} from '../dist/packages/stats/regions.js';
import { createWafer } from '../dist/packages/core/wafer.js';

const wafer = createWafer({ diameter: 300 });
const cx = wafer.center.x;
const cy = wafer.center.y;
const r = wafer.radius;

function die(id, x, y, physX, physY) {
  return { id, x, y, physX, physY, width: 5, height: 5 };
}

const centerDie = die('c', 0, 0, cx, cy);
const edgeDie   = die('e', 5, 0, cx + r * 0.95, cy);
const midDie    = die('m', 3, 0, cx + r * 0.5, cy);
const dies = [centerDie, edgeDie, midDie];

// ── buildRingRegions ──────────────────────────────────────────────────────────

test('buildRingRegions — all regions have family "ring"', () => {
  for (const region of buildRingRegions(dies, wafer, 4)) {
    assert.equal(region.family, 'ring');
  }
});

test('buildRingRegions — keys start with "ring:"', () => {
  for (const region of buildRingRegions(dies, wafer, 4)) {
    assert.match(region.key, /^ring:/);
  }
});

test('buildRingRegions — all die keys present exactly once', () => {
  const regions = buildRingRegions(dies, wafer, 4);
  const allKeys = regions.flatMap(r => r.dieKeys);
  assert.equal(allKeys.length, dies.length);
});

test('buildRingRegions — sorted by key', () => {
  const regions = buildRingRegions(dies, wafer, 4);
  for (let i = 1; i < regions.length; i++) {
    assert.ok(regions[i - 1].key <= regions[i].key, 'should be sorted');
  }
});

test('buildRingRegions — ringCount=1 gives one "Full Wafer" region covering all dies', () => {
  const regions = buildRingRegions(dies, wafer, 1);
  assert.equal(regions.length, 1);
  assert.match(regions[0].label, /Full Wafer/);
  assert.equal(regions[0].dieKeys.length, dies.length);
});

test('buildRingRegions — center and edge dies are in different rings (ringCount=4)', () => {
  const regions = buildRingRegions([centerDie, edgeDie], wafer, 4);
  assert.equal(regions.length, 2);
});

// ── buildQuadrantRegions ──────────────────────────────────────────────────────

const qDies = [
  die('ne', 1,  1, cx + 10, cy + 10),
  die('nw', -1, 1, cx - 10, cy + 10),
  die('sw', -1, -1, cx - 10, cy - 10),
  die('se', 1, -1, cx + 10, cy - 10),
];

test('buildQuadrantRegions — 4 regions for all-quadrant dies', () => {
  assert.equal(buildQuadrantRegions(qDies, wafer, 4).length, 4);
});

test('buildQuadrantRegions — all regions have family "quadrant"', () => {
  for (const r of buildQuadrantRegions(qDies, wafer, 4)) {
    assert.equal(r.family, 'quadrant');
  }
});

test('buildQuadrantRegions — sorted NE, NW, SE, SW', () => {
  const regions = buildQuadrantRegions(qDies, wafer, 4);
  const order = regions.map(r => r.label);
  assert.equal(order[0], 'NE');
  assert.equal(order[1], 'NW');
  assert.equal(order[2], 'SE');
  assert.equal(order[3], 'SW');
});

test('buildQuadrantRegions — each die key appears exactly once', () => {
  const regions = buildQuadrantRegions(qDies, wafer, 4);
  const allKeys = regions.flatMap(r => r.dieKeys);
  assert.equal(allKeys.length, qDies.length);
  assert.equal(new Set(allKeys).size, qDies.length);
});

// ── buildReticlePositionRegions ───────────────────────────────────────────────

const rDies = [
  die('0_0', 0, 0, cx,      cy),
  die('1_0', 1, 0, cx + 5,  cy),
  die('0_1', 0, 1, cx,      cy + 5),
  die('1_1', 1, 1, cx + 5,  cy + 5),
  die('2_0', 2, 0, cx + 10, cy),
  die('2_1', 2, 1, cx + 10, cy + 5),
];

test('buildReticlePositionRegions — returns empty array with no config', () => {
  assert.deepEqual(buildReticlePositionRegions(rDies, undefined), []);
});

test('buildReticlePositionRegions — all regions have family "reticle-position"', () => {
  for (const r of buildReticlePositionRegions(rDies, { width: 2, height: 2 })) {
    assert.equal(r.family, 'reticle-position');
  }
});

test('buildReticlePositionRegions — keys start with "reticle-position:cell:"', () => {
  for (const r of buildReticlePositionRegions(rDies, { width: 2, height: 2 })) {
    assert.match(r.key, /^reticle-position:cell:/);
  }
});

test('buildReticlePositionRegions — all dies appear exactly once', () => {
  const regions = buildReticlePositionRegions(rDies, { width: 2, height: 2 });
  const allKeys = regions.flatMap(r => r.dieKeys);
  assert.equal(allKeys.length, rDies.length);
});

test('buildReticlePositionRegions — sorted by key lexicographically', () => {
  const regions = buildReticlePositionRegions(rDies, { width: 2, height: 2 });
  for (let i = 1; i < regions.length; i++) {
    assert.ok(regions[i - 1].key <= regions[i].key);
  }
});

test('buildReticlePositionRegions — anchorDie itself always lands in cell (0,0)', () => {
  // anchorDie is defined as the field's min-x/min-y corner (see generateReticleGrid),
  // so whatever die matches anchorDie must be labeled column 0, row 0 — regardless of
  // the anchor's own value. A sign error in the column/row formula previously shifted
  // this by 2*anchorDie for non-zero anchors while leaving anchorDie={0,0} looking fine.
  for (const anchorDie of [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }]) {
    const regions = buildReticlePositionRegions(rDies, { width: 2, height: 2, anchorDie });
    const anchorKey = `${anchorDie.x},${anchorDie.y}`;
    const cellForAnchor = regions.find(r => r.dieKeys.includes(anchorKey));
    assert.ok(cellForAnchor, `anchor die ${anchorKey} should appear in some region`);
    assert.equal(
      cellForAnchor.key, 'reticle-position:cell:0,0',
      `anchor die ${anchorKey} should map to cell (0,0) for anchorDie=${JSON.stringify(anchorDie)}`,
    );
  }
});

test('buildReticlePositionRegions — same set of cell positions with different anchorDie', () => {
  const baseline = buildReticlePositionRegions(rDies, { width: 2, height: 2 });
  const shifted  = buildReticlePositionRegions(rDies, { width: 2, height: 2, anchorDie: { x: 1, y: 0 } });
  assert.deepEqual(
    baseline.map(r => r.key).sort(),
    shifted.map(r => r.key).sort(),
  );
});

// ── buildSectorRegions ────────────────────────────────────────────────────────

// 8 dies spread around the wafer at ~mid-radius (avoids the centre exclusion zone).
const sDies = [
  die('e',   10, 0,  cx + r * 0.6,  cy),
  die('ne',  7,  7,  cx + r * 0.4,  cy + r * 0.4),
  die('n',   0,  10, cx,            cy + r * 0.6),
  die('nw', -7,  7,  cx - r * 0.4,  cy + r * 0.4),
  die('w',  -10, 0,  cx - r * 0.6,  cy),
  die('sw', -7, -7,  cx - r * 0.4,  cy - r * 0.4),
  die('s',   0, -10, cx,            cy - r * 0.6),
  die('se',  7, -7,  cx + r * 0.4,  cy - r * 0.4),
];
const centerOnlyDie = die('ctr', 0, 0, cx, cy); // normalised radius = 0 → excluded

test('buildSectorRegions — all regions have family "sector"', () => {
  for (const region of buildSectorRegions(sDies, wafer, 16)) {
    assert.equal(region.family, 'sector');
  }
});

test('buildSectorRegions — keys start with "sector:"', () => {
  for (const region of buildSectorRegions(sDies, wafer, 16)) {
    assert.match(region.key, /^sector:/);
  }
});

test('buildSectorRegions — each die assigned to exactly one sector', () => {
  const regions = buildSectorRegions(sDies, wafer, 16);
  const allKeys = regions.flatMap(r => r.dieKeys);
  assert.equal(allKeys.length, sDies.length);
  assert.equal(new Set(allKeys).size, sDies.length);
});

test('buildSectorRegions — die at normalised radius < 0.2 is excluded', () => {
  const regions = buildSectorRegions([centerOnlyDie], wafer, 16);
  assert.equal(regions.length, 0);
});

test('buildSectorRegions — sectorCount=8 produces at most 8 regions', () => {
  const regions = buildSectorRegions(sDies, wafer, 8);
  assert.ok(regions.length <= 8);
  for (const region of regions) {
    assert.equal(region.family, 'sector');
  }
});

test('buildSectorRegions — sectorCount=4 uses compass quadrant names', () => {
  const regions = buildSectorRegions(sDies, wafer, 4);
  const labels = regions.map(r => r.label);
  for (const label of labels) {
    assert.match(label, /^Sector (N|E|S|W)$/);
  }
});

test('buildSectorRegions — sorted by key lexicographically', () => {
  const regions = buildSectorRegions(sDies, wafer, 16);
  for (let i = 1; i < regions.length; i++) {
    assert.ok(regions[i - 1].key <= regions[i].key, 'should be sorted');
  }
});
