import test from 'node:test';
import assert from 'node:assert/strict';
import {
  lerpKp,
  VIRIDIS,
  hardBinColor,
  hardBinGreyscale,
  valueToViridis,
  valueToGreyscale,
  softBinColor,
  contrastTextColor,
  HARD_BIN_COLORS,
  HARD_BIN_GREY,
  metadataValueColor,
} from '../dist/packages/renderer/colorMap.js';

// ── lerpKp ───────────────────────────────────────────────────────────────────

const BW = [[0, 0, 0], [255, 255, 255]];

test('lerpKp — t=0 returns first keypoint', () => {
  assert.equal(lerpKp(BW, 0), 'rgb(0,0,0)');
});

test('lerpKp — t=1 returns last keypoint', () => {
  assert.equal(lerpKp(BW, 1), 'rgb(255,255,255)');
});

test('lerpKp — t=0.5 interpolates midpoint', () => {
  assert.equal(lerpKp(BW, 0.5), 'rgb(128,128,128)');
});

test('lerpKp — clamps t below 0', () => {
  assert.equal(lerpKp(BW, -1), 'rgb(0,0,0)');
});

test('lerpKp — clamps t above 1', () => {
  assert.equal(lerpKp(BW, 2), 'rgb(255,255,255)');
});

test('lerpKp — single keypoint', () => {
  const single = [[100, 150, 200]];
  assert.equal(lerpKp(single, 0), 'rgb(100,150,200)');
  assert.equal(lerpKp(single, 1), 'rgb(100,150,200)');
});

test('lerpKp — asymmetric channel interpolation', () => {
  const kp = [[0, 100, 200], [100, 0, 100]];
  assert.equal(lerpKp(kp, 0.5), 'rgb(50,50,150)');
});

test('lerpKp — VIRIDIS t=0 is more blue than red (dark purple)', () => {
  const start = lerpKp(VIRIDIS, 0);
  const m = start.match(/rgb\((\d+),(\d+),(\d+)\)/);
  assert.ok(m, 'should be rgb format');
  assert.ok(+m[3] > +m[1], 'viridis t=0 should have more blue than red');
});

test('lerpKp — VIRIDIS t=1 is yellow (high r, high g, low b)', () => {
  const end = lerpKp(VIRIDIS, 1);
  const m = end.match(/rgb\((\d+),(\d+),(\d+)\)/);
  assert.ok(m, 'should be rgb format');
  assert.ok(+m[1] > 200, 'viridis t=1 should have high red');
  assert.ok(+m[2] > 200, 'viridis t=1 should have high green');
  assert.ok(+m[3] < 100, 'viridis t=1 should have low blue');
});

// ── hardBinColor ──────────────────────────────────────────────────────────────

test('hardBinColor — bin 1 is green (pass convention)', () => {
  assert.equal(hardBinColor(1), '#2ecc71');
});

test('hardBinColor — returns a CSS colour string for any bin', () => {
  for (const b of [2, 14, 15, 1000, 99999]) {
    assert.match(hardBinColor(b), /^#[0-9a-f]{6}$/i);
  }
});

test('hardBinColor — different bin numbers produce different colours', () => {
  assert.notEqual(hardBinColor(1), hardBinColor(2));
  assert.notEqual(hardBinColor(1), hardBinColor(100));
});

test('hardBinColor — same bin always returns same colour (deterministic)', () => {
  assert.equal(hardBinColor(42), hardBinColor(42));
  assert.equal(hardBinColor(10000), hardBinColor(10000));
});

test('hardBinColor — never returns the no-data grey', () => {
  const noData = HARD_BIN_COLORS[0];
  for (const b of [1, 2, 14, 15, 100, 9999]) {
    assert.notEqual(hardBinColor(b), noData);
  }
});

// ── hardBinGreyscale ──────────────────────────────────────────────────────────

test('hardBinGreyscale — bins 0, 1, 2 return distinct shades', () => {
  assert.equal(hardBinGreyscale(0), HARD_BIN_GREY[0]);
  assert.equal(hardBinGreyscale(1), HARD_BIN_GREY[1]);
  assert.notEqual(hardBinGreyscale(1), hardBinGreyscale(2));
});

test('HARD_BIN_GREY — index 14 is distinct from index 0', () => {
  assert.notEqual(HARD_BIN_GREY[14], HARD_BIN_GREY[0]);
});

// ── valueToViridis ────────────────────────────────────────────────────────────

test('valueToViridis — delegates to lerpKp(VIRIDIS)', () => {
  assert.equal(valueToViridis(0), lerpKp(VIRIDIS, 0));
  assert.equal(valueToViridis(0.5), lerpKp(VIRIDIS, 0.5));
  assert.equal(valueToViridis(1), lerpKp(VIRIDIS, 1));
});

// ── valueToGreyscale ──────────────────────────────────────────────────────────

test('valueToGreyscale — t=0 is near-dark grey (not pure black)', () => {
  const c = valueToGreyscale(0);
  const m = c.match(/rgb\((\d+),(\d+),(\d+)\)/);
  assert.ok(m);
  assert.equal(m[1], m[2]);
  assert.equal(m[2], m[3]);
  assert.ok(+m[1] >= 30);
});

test('valueToGreyscale — t=1 is near-bright grey (not pure white)', () => {
  const c = valueToGreyscale(1);
  const m = c.match(/rgb\((\d+),(\d+),(\d+)\)/);
  assert.ok(m);
  assert.ok(+m[1] <= 230);
  assert.ok(+m[1] > 100);
});

test('valueToGreyscale — brightness is monotonically increasing', () => {
  const v0 = valueToGreyscale(0).match(/rgb\((\d+)/);
  const v1 = valueToGreyscale(1).match(/rgb\((\d+)/);
  assert.ok(+v1[1] > +v0[1]);
});

// ── softBinColor ──────────────────────────────────────────────────────────────

test('softBinColor — returns a string from BIN_PALETTE', () => {
  assert.ok(HARD_BIN_COLORS.includes(softBinColor(1)));
  assert.ok(HARD_BIN_COLORS.includes(softBinColor(10000)));
});

test('softBinColor — same bin number gives different colour than hardBinColor', () => {
  for (const b of [1, 2, 6, 100, 10000]) {
    assert.notEqual(softBinColor(b), hardBinColor(b), `bin ${b} should differ`);
  }
});

test('softBinColor — good spread across a high-value range (birthday paradox allows collisions)', () => {
  // 45 bins into a 63-slot palette: birthday paradox gives ~32 expected unique.
  // Assert at least 25 distinct to catch degenerate hashes while allowing natural collisions.
  const colors = Array.from({ length: 45 }, (_, i) => softBinColor(100 + i));
  assert.ok(new Set(colors).size >= 25, `expected >= 25 distinct colours, got ${new Set(colors).size}`);
});

// ── contrastTextColor ─────────────────────────────────────────────────────────

test('contrastTextColor — white background yields black text', () => {
  assert.equal(contrastTextColor('#ffffff'), '#000000');
});

test('contrastTextColor — black background yields white text', () => {
  assert.equal(contrastTextColor('#000000'), '#ffffff');
});

test('contrastTextColor — rgb() format white', () => {
  assert.equal(contrastTextColor('rgb(255,255,255)'), '#000000');
});

test('contrastTextColor — rgb() format black', () => {
  assert.equal(contrastTextColor('rgb(0,0,0)'), '#ffffff');
});

test('contrastTextColor — light hex yields black', () => {
  assert.equal(contrastTextColor('#f7f7f7'), '#000000');
});

test('contrastTextColor — dark hex yields white', () => {
  assert.equal(contrastTextColor('#2c3e50'), '#ffffff');
});

// ── metadataValueColor ──────────────────────────────────────────────────────

test('metadataValueColor — same index always returns same colour (deterministic)', () => {
  assert.equal(metadataValueColor(0), metadataValueColor(0));
  assert.equal(metadataValueColor(3), metadataValueColor(3));
});

test('metadataValueColor — distinct indices in the ordered range produce distinct colours', () => {
  const colors = new Set(Array.from({ length: 10 }, (_, i) => metadataValueColor(i)));
  assert.equal(colors.size, 10);
});

test('metadataValueColor — returns a CSS colour string for any index', () => {
  for (const i of [0, 5, 9, 10, 50, 1000]) {
    assert.match(metadataValueColor(i), /^#[0-9a-f]{6}$/i);
  }
});

test('metadataValueColor — never returns bin 1/2\'s pass/fail-flavoured colours', () => {
  for (let i = 0; i < 12; i++) {
    assert.notEqual(metadataValueColor(i), hardBinColor(1)); // green "pass"
    assert.notEqual(metadataValueColor(i), hardBinColor(2)); // red "fail"
  }
});

test('metadataValueColor — falls back to the hash palette beyond the ordered range', () => {
  // Index 10 is past the fixed ordered palette — must still resolve to a valid,
  // deterministic colour via the hash fallback, not throw or return undefined.
  const a = metadataValueColor(10);
  const b = metadataValueColor(10);
  assert.match(a, /^#[0-9a-f]{6}$/i);
  assert.equal(a, b);
});
