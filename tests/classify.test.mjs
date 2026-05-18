import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyDie, getRingLabel } from '../dist/packages/core/classify.js';
import { createWafer } from '../dist/packages/core/wafer.js';

const wafer = createWafer({ diameter: 300 });
const cx = wafer.center.x;
const cy = wafer.center.y;
const r = wafer.radius;

function die(physX, physY) {
  return { id: 't', x: 0, y: 0, physX, physY, width: 5, height: 5 };
}

// ── classifyDie — ring ────────────────────────────────────────────────────────

test('classifyDie — center die is ring 1', () => {
  const { ring } = classifyDie(die(cx, cy), wafer);
  assert.equal(ring, 1);
});

test('classifyDie — edge die is outer ring', () => {
  const { ring } = classifyDie(die(cx + r * 0.99, cy), wafer);
  assert.equal(ring, 4);
});

test('classifyDie — ring never exceeds ringCount', () => {
  for (const ringCount of [1, 2, 3, 6]) {
    for (const offset of [0, 0.3, 0.6, 0.99]) {
      const { ring } = classifyDie(die(cx + r * offset, cy), wafer, { ringCount });
      assert.ok(ring >= 1, `ring ${ring} should be >= 1`);
      assert.ok(ring <= ringCount, `ring ${ring} should be <= ringCount=${ringCount}`);
    }
  }
});

test('classifyDie — ringCount=1 puts everything in ring 1', () => {
  for (const offset of [0, 0.5, 0.99]) {
    const { ring } = classifyDie(die(cx + r * offset, cy), wafer, { ringCount: 1 });
    assert.equal(ring, 1);
  }
});

// ── classifyDie — quadrant ────────────────────────────────────────────────────

test('classifyDie — NE quadrant (+x, +y)', () => {
  assert.equal(classifyDie(die(cx + 10, cy + 10), wafer).quadrant, 'NE');
});

test('classifyDie — NW quadrant (-x, +y)', () => {
  assert.equal(classifyDie(die(cx - 10, cy + 10), wafer).quadrant, 'NW');
});

test('classifyDie — SW quadrant (-x, -y)', () => {
  assert.equal(classifyDie(die(cx - 10, cy - 10), wafer).quadrant, 'SW');
});

test('classifyDie — SE quadrant (+x, -y)', () => {
  assert.equal(classifyDie(die(cx + 10, cy - 10), wafer).quadrant, 'SE');
});

// ── getRingLabel ──────────────────────────────────────────────────────────────

test('getRingLabel — ringCount=1 returns "Full Wafer"', () => {
  assert.equal(getRingLabel(1, 1), 'Full Wafer');
});

test('getRingLabel — ring 1 has "(core)" suffix', () => {
  assert.match(getRingLabel(1, 4), /core/);
});

test('getRingLabel — outer ring has "(edge)" suffix', () => {
  assert.match(getRingLabel(4, 4), /edge/);
});

test('getRingLabel — middle ring has no core/edge suffix', () => {
  const label = getRingLabel(2, 4);
  assert.ok(!label.includes('core'));
  assert.ok(!label.includes('edge'));
  assert.match(label, /Ring 2/);
});

test('getRingLabel — ringCount=2: ring 1 is core, ring 2 is edge', () => {
  assert.match(getRingLabel(1, 2), /core/);
  assert.match(getRingLabel(2, 2), /edge/);
});

test('getRingLabel — ring number appears in label', () => {
  assert.match(getRingLabel(3, 5), /Ring 3/);
});
