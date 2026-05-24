import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getColorScheme,
  listColorSchemes,
  registerColorScheme,
} from '../dist/packages/renderer/colorSchemes.js';

// ── listColorSchemes ──────────────────────────────────────────────────────────

test('listColorSchemes — includes all 6 built-in schemes', () => {
  const names = listColorSchemes().map(s => s.name);
  for (const expected of ['default', 'viridis', 'greyscale', 'accessible', 'plasma', 'inferno']) {
    assert.ok(names.includes(expected), `missing scheme: ${expected}`);
  }
});

test('listColorSchemes — does not include "color" alias', () => {
  const names = listColorSchemes().map(s => s.name);
  assert.ok(!names.includes('color'), '"color" alias must not appear in listing');
});

test('listColorSchemes — returns human-readable labels', () => {
  const map = Object.fromEntries(listColorSchemes().map(s => [s.name, s.label]));
  assert.equal(map['default'], 'Default');
  assert.equal(map['viridis'], 'Viridis');
  assert.equal(map['greyscale'], 'Greyscale');
});

// ── getColorScheme ────────────────────────────────────────────────────────────

test('getColorScheme — default', () => {
  const s = getColorScheme('default');
  assert.equal(s.label, 'Default');
});

test('getColorScheme — viridis', () => {
  assert.equal(getColorScheme('viridis').label, 'Viridis');
});

test('getColorScheme — greyscale', () => {
  assert.equal(getColorScheme('greyscale').label, 'Greyscale');
});

test('getColorScheme — accessible', () => {
  assert.ok(getColorScheme('accessible').label.includes('Accessible'));
});

test('getColorScheme — plasma', () => {
  assert.equal(getColorScheme('plasma').label, 'Plasma');
});

test('getColorScheme — inferno', () => {
  assert.equal(getColorScheme('inferno').label, 'Inferno');
});

test('getColorScheme — unknown name falls back to default', () => {
  const def = getColorScheme('default');
  const unknown = getColorScheme('does-not-exist');
  assert.equal(unknown.label, def.label);
});

test('getColorScheme — no argument falls back to default', () => {
  const def = getColorScheme('default');
  assert.equal(getColorScheme().label, def.label);
});

test('getColorScheme — "color" alias returns same scheme as default', () => {
  assert.equal(getColorScheme('color').label, getColorScheme('default').label);
});

test('getColorScheme — forBin(0) returns a non-empty CSS string for all schemes', () => {
  for (const { name } of listColorSchemes()) {
    const c = getColorScheme(name).forBin(0);
    assert.ok(typeof c === 'string' && c.length > 0, `${name}.forBin(0) empty`);
  }
});

test('getColorScheme — forValue returns non-empty CSS string at t=0,0.5,1 for all schemes', () => {
  for (const { name } of listColorSchemes()) {
    const s = getColorScheme(name);
    for (const t of [0, 0.5, 1]) {
      const c = s.forValue(t);
      assert.ok(typeof c === 'string' && c.length > 0, `${name}.forValue(${t}) empty`);
    }
  }
});

// ── registerColorScheme ───────────────────────────────────────────────────────

test('registerColorScheme — custom scheme is retrievable and listed', () => {
  registerColorScheme('test-custom-scheme', {
    label: 'Test Custom',
    forBin: () => '#aabbcc',
    forValue: () => '#ddeeff',
  });
  assert.equal(getColorScheme('test-custom-scheme').label, 'Test Custom');
  const listed = listColorSchemes().find(s => s.name === 'test-custom-scheme');
  assert.ok(listed, 'custom scheme must appear in listColorSchemes');
});
