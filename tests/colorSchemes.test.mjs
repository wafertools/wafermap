import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getValueColorScheme,
  listValueColorSchemes,
  registerValueColorScheme,
  getBinColorScheme,
  listBinColorSchemes,
} from '../dist/packages/renderer/colorSchemes.js';

// Bin palettes and value gradients are separate registries. Resolution of bin
// colours (rank, pass/fail) is covered in binColors.test.mjs, and the built-in
// bin palettes' measured separation in binPalettes.test.mjs.

// ── Value gradients ──────────────────────────────────────────────────────────

test('listValueColorSchemes — includes every built-in gradient', () => {
  const names = listValueColorSchemes().map(s => s.name);
  for (const expected of ['default', 'viridis', 'cividis', 'greyscale', 'plasma', 'inferno', 'traffic', 'jet']) {
    assert.ok(names.includes(expected), `missing gradient: ${expected}`);
  }
});

test('listValueColorSchemes — returns human-readable labels', () => {
  const map = Object.fromEntries(listValueColorSchemes().map(s => [s.name, s.label]));
  assert.equal(map['viridis'], 'Viridis');
  assert.equal(map['greyscale'], 'Greyscale');
  assert.match(map['cividis'], /colour-blind safe/);
});

test('getValueColorScheme — unknown or missing name falls back to default', () => {
  const def = getValueColorScheme('default');
  assert.equal(getValueColorScheme('does-not-exist').label, def.label);
  assert.equal(getValueColorScheme().label, def.label);
});

test('getValueColorScheme — forValue returns a CSS string at t=0, 0.5, 1 for every gradient', () => {
  for (const { name } of listValueColorSchemes()) {
    const s = getValueColorScheme(name);
    for (const t of [0, 0.5, 1]) {
      const c = s.forValue(t);
      assert.ok(typeof c === 'string' && c.length > 0, `${name}.forValue(${t}) empty`);
    }
  }
});

test('no two built-in gradients draw identically', () => {
  const sig = (name) => [0, 0.25, 0.5, 0.75, 1].map(t => getValueColorScheme(name).forValue(t)).join('|');
  const seen = new Map();
  for (const { name } of listValueColorSchemes()) {
    const s = sig(name);
    assert.ok(!seen.has(s), `${name} draws the same map as ${seen.get(s)}`);
    seen.set(s, name);
  }
});

test('registerValueColorScheme — a registered gradient is retrievable and listed', () => {
  registerValueColorScheme('test-custom-gradient', { label: 'Test Custom', forValue: () => '#ddeeff' });
  assert.equal(getValueColorScheme('test-custom-gradient').label, 'Test Custom');
  assert.ok(listValueColorSchemes().some(s => s.name === 'test-custom-gradient'));
});

// ── Bin palettes ─────────────────────────────────────────────────────────────

test('listBinColorSchemes — default and colour-blind safe palettes, labelled', () => {
  const map = Object.fromEntries(listBinColorSchemes().map(s => [s.name, s.label]));
  assert.equal(map['default'], 'Default');
  assert.equal(map['accessible'], 'Colour-blind safe');
});

test('getBinColorScheme — unknown name falls back to default', () => {
  assert.equal(getBinColorScheme('does-not-exist').label, getBinColorScheme('default').label);
});
