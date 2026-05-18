import test from 'node:test';
import assert from 'node:assert/strict';
import { applyProbeSequence } from '../dist/packages/core/probe.js';

function makeDie(x, y) {
  return { id: `${x}_${y}`, x, y, physX: x, physY: y, width: 1, height: 1 };
}

// 3×3 grid; y=2 is the topmost row
const grid = [
  makeDie(0, 0), makeDie(1, 0), makeDie(2, 0),
  makeDie(0, 1), makeDie(1, 1), makeDie(2, 1),
  makeDie(0, 2), makeDie(1, 2), makeDie(2, 2),
];

function idx(dies, x, y) {
  return dies.find(d => d.x === x && d.y === y).probeIndex;
}

function allIndicesContiguous(dies) {
  return [...dies].map(d => d.probeIndex).sort((a, b) => a - b)
    .every((v, i) => v === i);
}

// ── row ───────────────────────────────────────────────────────────────────────

test('probe row — all dies assigned', () => {
  const result = applyProbeSequence(grid, { type: 'row' });
  assert.ok(result.every(d => d.probeIndex !== undefined));
});

test('probe row — top-left die has index 0 (topmost row, leftmost)', () => {
  const result = applyProbeSequence(grid, { type: 'row' });
  assert.equal(idx(result, 0, 2), 0);
});

test('probe row — bottom-right die has highest index', () => {
  const result = applyProbeSequence(grid, { type: 'row' });
  assert.equal(idx(result, 2, 0), 8);
});

test('probe row — within a row, x increases monotonically', () => {
  const result = applyProbeSequence(grid, { type: 'row' });
  assert.ok(idx(result, 0, 2) < idx(result, 1, 2));
  assert.ok(idx(result, 1, 2) < idx(result, 2, 2));
});

test('probe row — indices are 0-based and contiguous', () => {
  const result = applyProbeSequence(grid, { type: 'row' });
  assert.ok(allIndicesContiguous(result));
});

test('probe row — does not mutate original dies', () => {
  applyProbeSequence(grid, { type: 'row' });
  assert.ok(grid.every(d => d.probeIndex === undefined));
});

// ── column ────────────────────────────────────────────────────────────────────

test('probe column — all dies assigned', () => {
  const result = applyProbeSequence(grid, { type: 'column' });
  assert.ok(result.every(d => d.probeIndex !== undefined));
});

test('probe column — top of first column has index 0', () => {
  const result = applyProbeSequence(grid, { type: 'column' });
  assert.equal(idx(result, 0, 2), 0);
});

test('probe column — bottom of column 0 before top of column 1', () => {
  const result = applyProbeSequence(grid, { type: 'column' });
  assert.ok(idx(result, 0, 0) < idx(result, 1, 2));
});

test('probe column — indices are 0-based and contiguous', () => {
  const result = applyProbeSequence(grid, { type: 'column' });
  assert.ok(allIndicesContiguous(result));
});

// ── snake ─────────────────────────────────────────────────────────────────────

test('probe snake — all dies assigned', () => {
  const result = applyProbeSequence(grid, { type: 'snake' });
  assert.ok(result.every(d => d.probeIndex !== undefined));
});

test('probe snake — first row (rowIdx=0) scans left→right', () => {
  const result = applyProbeSequence(grid, { type: 'snake' });
  assert.ok(idx(result, 0, 2) < idx(result, 1, 2));
  assert.ok(idx(result, 1, 2) < idx(result, 2, 2));
});

test('probe snake — second row (rowIdx=1) scans right→left', () => {
  const result = applyProbeSequence(grid, { type: 'snake' });
  assert.ok(idx(result, 2, 1) < idx(result, 1, 1));
  assert.ok(idx(result, 1, 1) < idx(result, 0, 1));
});

test('probe snake — third row (rowIdx=2) scans left→right again', () => {
  const result = applyProbeSequence(grid, { type: 'snake' });
  assert.ok(idx(result, 0, 0) < idx(result, 1, 0));
  assert.ok(idx(result, 1, 0) < idx(result, 2, 0));
});

test('probe snake — indices are 0-based and contiguous', () => {
  const result = applyProbeSequence(grid, { type: 'snake' });
  assert.ok(allIndicesContiguous(result));
});

// ── custom ────────────────────────────────────────────────────────────────────

test('probe custom — assigns indices by customOrder position', () => {
  const ids = grid.map(d => d.id);
  const customOrder = [ids[4], ids[0], ids[8], ...ids.filter((_, i) => ![0, 4, 8].includes(i))];
  const result = applyProbeSequence(grid, { type: 'custom', customOrder });
  assert.equal(result.find(d => d.id === ids[4]).probeIndex, 0);
  assert.equal(result.find(d => d.id === ids[0]).probeIndex, 1);
});

test('probe custom — throws when customOrder is missing', () => {
  assert.throws(() => applyProbeSequence(grid, { type: 'custom' }), /customOrder/);
});

test('probe custom — throws when die IDs are missing from customOrder', () => {
  const ids = grid.map(d => d.id);
  assert.throws(
    () => applyProbeSequence(grid, { type: 'custom', customOrder: ids.slice(0, 5) }),
    /not found/i,
  );
});
