// Die regions (stats/dieRegions.ts): ring, quadrant, reticle cell and reticle shot are defined once, and the plot builder
// and the Dies table read that one definition. The reticle ones exist only when the wafer carries a stepper field.

import test from 'node:test';
import assert from 'node:assert/strict';
import { buildWaferMap } from '../dist/index.js';
import { DIE_REGIONS, DIE_REGION_KEYS, availableRegions } from '../dist/packages/stats/dieRegions.js';
import { resolvePlot, fieldCatalogue } from '../dist/packages/stats/plotData.js';
import { resolveDieColumns } from '../dist/packages/canvas-adapter/dieList.js';
import { getReticleCell, getReticleShot } from '../dist/packages/core/reticle.js';

const grid = [];
for (let x = -4; x <= 4; x++) for (let y = -4; y <= 4; y++) grid.push({ x, y, hbin: 1, testValues: { 1050: x + y } });

function item(reticleConfig) {
  const r = buildWaferMap({ results: grid, waferConfig: { diameter: 90 }, dieConfig: { width: 10, height: 10 }, passBins: [1], reticleConfig });
  return { label: 'W1', dies: r.dies, passBins: r.passBins, ringCount: r.ringCount, wafer: r.wafer };
}
const spec = (x) => ({ id: 'p', chart: 'bar', fields: { x, color: { none: true } } });
const labels = (cat) => cat.map(f => f.label);

test('the wafer carries the reticle it was built with, and none when it was given none', () => {
  assert.deepEqual(item({ width: 3, height: 2 }).wafer.reticle, { width: 3, height: 2 });
  assert.equal(item(undefined).wafer.reticle, undefined);
});

test('the registry lists ring, quadrant, reticle cell and reticle shot, in that order', () => {
  assert.deepEqual(DIE_REGION_KEYS, ['ring', 'quadrant', 'reticleCell', 'reticleShot']);
  assert.deepEqual(DIE_REGION_KEYS.map(k => DIE_REGIONS[k].label), ['Ring', 'Quadrant', 'Reticle cell', 'Reticle shot']);
});

test('reticle regions are offered only with a reticle', () => {
  const without = item(undefined);
  const withReticle = item({ width: 3, height: 2 });
  assert.deepEqual(availableRegions({ wafer: without.wafer, ringCount: without.ringCount }, true).map(r => r.key), ['ring', 'quadrant']);
  assert.deepEqual(availableRegions({ wafer: withReticle.wafer, ringCount: withReticle.ringCount }, true).map(r => r.key), ['ring', 'quadrant', 'reticleCell', 'reticleShot']);
  assert.deepEqual(availableRegions({ wafer: withReticle.wafer, ringCount: withReticle.ringCount }, false), [], 'nothing without a positioned die');
});

test('a die\'s cell is its place in the mask, and its shot is where on the wafer the mask was placed', () => {
  const cfg = { width: 3, height: 2 };
  assert.deepEqual(getReticleCell({ x: 4, y: 3 }, cfg), { column: 1, row: 1 });
  assert.deepEqual(getReticleShot({ x: 4, y: 3 }, cfg), { column: 1, row: 1 });
  // Negative positions wrap into the field and fall in the field before 0.
  assert.deepEqual(getReticleCell({ x: -1, y: -1 }, cfg), { column: 2, row: 1 });
  assert.deepEqual(getReticleShot({ x: -1, y: -1 }, cfg), { column: -1, row: -1 });
  // The anchor die sits at a field corner: it is cell (0, 0) of its own shot.
  const anchored = { width: 3, height: 2, anchorDie: { x: 2, y: 1 } };
  assert.deepEqual(getReticleCell({ x: 2, y: 1 }, anchored), { column: 0, row: 0 });
  assert.deepEqual(getReticleShot({ x: 2, y: 1 }, anchored), { column: 0, row: 0 });
  assert.deepEqual(getReticleShot({ x: 1, y: 1 }, anchored), { column: -1, row: 0 });
});

test('the plot builder offers reticle cell and shot when there is a reticle, as categories', () => {
  const cat = fieldCatalogue([item({ width: 3, height: 2 })], {});
  for (const name of ['Reticle cell', 'Reticle shot']) {
    const f = cat.find(o => o.label === name);
    assert.ok(f, `${name} is offered`);
    assert.equal(f.categorical, true);
    assert.equal(f.level, 'die');
    assert.equal(f.group, 'Die');
  }
  assert.ok(!labels(fieldCatalogue([item(undefined)], {})).includes('Reticle cell'), 'and not without one');
});

test('a bar by reticle cell has one bar per cell, and by reticle shot one per shot', () => {
  const it = item({ width: 3, height: 2 });
  const cells = resolvePlot(spec({ builtin: 'reticleCell' }), [it], {}).marks.categories;
  assert.equal(cells.length, 6, 'a 3 by 2 field has six cells');
  assert.ok(cells.includes('Reticle cell (0, 0)') && cells.includes('Reticle cell (2, 1)'));
  const fields = resolvePlot(spec({ builtin: 'reticleShot' }), [it], {}).marks.categories;
  assert.ok(fields.includes('Reticle shot (0, 0)') && fields.includes('Reticle shot (-1, -1)'), `got ${fields}`);
  assert.ok(fields.length > 1);
});

test('a plot of a reticle shot says why it cannot be drawn when the wafer has no reticle', () => {
  const r = resolvePlot(spec({ builtin: 'reticleCell' }), [item(undefined)], {});
  assert.ok(r.issues.length > 0 || (r.marks.categories ?? []).length === 0, 'nothing is drawn from no reticle');
});

test('the Dies table has Ring and Quadrant as before, and Reticle cell and shot with a reticle', () => {
  const heads = (it) => resolveDieColumns(it.dies, [], { getWafer: () => it.wafer, ringCount: it.ringCount }).columns.map(c => c.label);
  assert.ok(heads(item(undefined)).includes('Ring') && heads(item(undefined)).includes('Quadrant'));
  assert.ok(!heads(item(undefined)).includes('Reticle cell'));
  const withReticle = item({ width: 3, height: 2 });
  const h = heads(withReticle);
  assert.ok(h.includes('Reticle cell') && h.includes('Reticle shot'), `got ${h}`);
  const cols = resolveDieColumns(withReticle.dies, [], { getWafer: () => withReticle.wafer, ringCount: withReticle.ringCount }).columns;
  const die = withReticle.dies.find(d => d.x === 4 && d.y === 3);
  assert.equal(cols.find(c => c.label === 'Reticle cell').get(die), 'Reticle cell (1, 1)');
  assert.equal(cols.find(c => c.label === 'Reticle shot').get(die), 'Reticle shot (1, 1)');
  // Ring reads "Ring 2" on screen and is the bare number in the file.
  const ring = cols.find(c => c.label === 'Ring');
  assert.match(ring.get(die), /^Ring \d+$/);
  assert.match(String(ring.csvGet(die)), /^\d+$/);
});

test('reticle cells come out in numeric order, so cell (2, 0) precedes cell (10, 0)', async () => {
  const { buildReticlePositionRegions } = await import('../dist/packages/stats/regions.js');
  const dies = [10, 2, 0].map(x => ({ x, y: 0, physX: x, physY: 0 }));
  const regions = buildReticlePositionRegions(dies, { width: 20, height: 1 });
  assert.deepEqual(regions.map(r => r.label), ['Reticle cell (0, 0)', 'Reticle cell (2, 0)', 'Reticle cell (10, 0)']);
});

test('findings and plots place a die in the same region: same cell text, and a ring that is Ring N in both', async () => {
  const { buildRingRegions, buildReticlePositionRegions } = await import('../dist/packages/stats/regions.js');
  const it = item({ width: 3, height: 2 });
  const positioned = it.dies.filter(d => d.physX !== undefined);
  const ctx = { wafer: it.wafer, ringCount: it.ringCount };
  // A reticle cell reads the same wherever it appears.
  const regions = buildReticlePositionRegions(positioned, it.wafer.reticle);
  for (const r of regions) assert.ok(positioned.every(d => r.dies.includes(d) === (DIE_REGIONS.reticleCell.valueOf(d, ctx) === r.label)), r.label);
  // A ring is one region for both; findings add where it is (core, edge) to the same "Ring N".
  const rings = buildRingRegions(positioned, it.wafer, it.ringCount);
  for (const r of rings) {
    const n = r.key.slice('ring:'.length);
    assert.ok(r.label.startsWith(`Ring ${n}`) || it.ringCount === 1, `${r.label} starts with Ring ${n}`);
    assert.ok(r.dies.every(d => DIE_REGIONS.ring.valueOf(d, ctx) === `Ring ${n}`));
  }
});
