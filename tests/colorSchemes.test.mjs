import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getValueColorScheme,
  resolveValueColorFn,
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
  for (const expected of ['default', 'cividis', 'greyscale', 'plasma', 'inferno', 'mako', 'traffic', 'jet']) {
    assert.ok(names.includes(expected), `missing gradient: ${expected}`);
  }
});

test('listValueColorSchemes — returns human-readable labels', () => {
  const map = Object.fromEntries(listValueColorSchemes().map(s => [s.name, s.label]));
  assert.equal(map['default'], 'Default (Viridis)');
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

// ── Direction ────────────────────────────────────────────────────────────────
//
// Every perceptual built-in must read low = dark, high = light. This is the
// test that would have caught the defect these ramps shipped with for months:
// viridis, cividis, plasma, inferno and greyscale were each registered as
// `forValue: t => ramp(1 - t)`, so a value map's bright end was its LOW end
// while `default`, `traffic` and `jet` ran the other way — switching gradient
// inverted the map, and on a stacked map the defects became dark specks on a
// glowing healthy field. Rainbow ramps are exempt by construction: `jet` and
// `traffic` are not lightness ramps at all, which is itself why neither is the
// default.

/** Relative luminance → approximate CIE L*, enough to rank two colours. */
function lstar(css) {
  const m = css.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
  assert.ok(m, `expected an rgb() string, got ${css}`);
  const lin = [1, 2, 3].map(i => {
    const c = Number(m[i]) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  const y = 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
  return y <= 216 / 24389 ? y * 24389 / 27 : Math.cbrt(y) * 116 - 16;
}

const PERCEPTUAL = ['default', 'cividis', 'greyscale', 'plasma', 'inferno', 'mako'];

test('every perceptual built-in rises in lightness from low to high', () => {
  for (const name of PERCEPTUAL) {
    const { forValue } = getValueColorScheme(name);
    const ls = Array.from({ length: 11 }, (_, i) => lstar(forValue(i / 10)));
    assert.ok(ls.at(-1) - ls[0] > 40, `${name}: too little lightness range (${ls[0].toFixed(0)} → ${ls.at(-1).toFixed(0)})`);
    for (let i = 1; i < ls.length; i++) {
      // 1.5 L* of slack: these are sampled keypoint interpolations, not the
      // exact analytic ramps, so a hair of non-monotonicity is not a defect.
      assert.ok(ls[i] >= ls[i - 1] - 1.5,
        `${name}: lightness falls between t=${(i - 1) / 10} and t=${i / 10} (${ls[i - 1].toFixed(1)} → ${ls[i].toFixed(1)})`);
    }
  }
});

test('resolveValueColorFn — reversed swaps the ends, unreversed matches the registry', () => {
  const plain = getValueColorScheme('default').forValue;
  assert.equal(resolveValueColorFn('default', false)(0.25), plain(0.25));
  assert.equal(resolveValueColorFn('default')(0.25), plain(0.25));
  assert.equal(resolveValueColorFn('default', true)(0.25), plain(0.75));
  assert.equal(resolveValueColorFn('default', true)(0), plain(1));
});

test('resolveValueColorFn — reversing applies to a host-registered gradient too', () => {
  registerValueColorScheme('reverse-probe', {
    label: 'Reverse probe',
    forValue: (t) => `rgb(${Math.round(t * 255)},0,0)`,
  });
  assert.equal(resolveValueColorFn('reverse-probe', true)(0), 'rgb(255,0,0)');
  assert.equal(resolveValueColorFn('reverse-probe', true)(1), 'rgb(0,0,0)');
});

test('resolveValueColorFn — an unknown name still falls back to default', () => {
  assert.equal(resolveValueColorFn('does-not-exist', true)(0.1),
               getValueColorScheme('default').forValue(0.9));
});
