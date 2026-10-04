// The categorical series palette: eight colour-blind-safe hues, then a second round of the same families, so a chart
// with up to sixteen groups never gives two groups the same colour.

import test from 'node:test';
import assert from 'node:assert/strict';
import { categorical, CATEGORICAL_COUNT } from '../dist/packages/canvas-adapter/charts/palette.js';

const rgb = (hex) => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
const dist = (a, b) => Math.hypot(...rgb(a).map((v, i) => v - rgb(b)[i]));

test('the first eight are the Okabe-Ito hues, unchanged', () => {
  assert.deepEqual(Array.from({ length: 8 }, (_, i) => categorical(i)),
    ['#0072B2', '#E69F00', '#009E73', '#CC79A7', '#56B4E9', '#D55E00', '#8C6D31', '#999999']);
});

test('sixteen groups get sixteen different colours, and the palette then repeats', () => {
  assert.equal(CATEGORICAL_COUNT, 16);
  const all = Array.from({ length: 16 }, (_, i) => categorical(i));
  assert.equal(new Set(all).size, 16);
  assert.equal(categorical(16), categorical(0));
  assert.equal(categorical(-1), categorical(15));
});

test('the second round is not a shade of the first: each is a clear step from every first-round colour', () => {
  for (let i = 8; i < 16; i++) for (let j = 0; j < 8; j++) {
    assert.ok(dist(categorical(i), categorical(j)) > 60, `colours ${i} and ${j}: ${dist(categorical(i), categorical(j)).toFixed(1)}`);
  }
});

test('no two of the sixteen are close enough to be taken for one another', () => {
  const all = Array.from({ length: 16 }, (_, i) => categorical(i));
  let closest = Infinity;
  for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) closest = Math.min(closest, dist(all[i], all[j]));
  assert.ok(closest > 60, `the two closest colours are ${closest.toFixed(1)} apart in RGB`);
});

