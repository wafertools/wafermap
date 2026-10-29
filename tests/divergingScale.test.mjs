// The colours of a value that runs either side of zero (canvas-adapter/charts/divergingScale.ts).

import test from 'node:test';
import assert from 'node:assert/strict';
import { divergingRgb, divergingColor, darkTextOn, darkTextOnColor, plotGradient, ratingRgb, PLOT_GRADIENTS } from '../dist/packages/canvas-adapter/charts/divergingScale.js';
import { resolveValueColorFn } from '../dist/packages/renderer/colorSchemes.js';

test('blue below, a light neutral at zero, warm above, in the signed scale\'s two hues', () => {
  assert.deepEqual(divergingRgb(0), [0, 114, 178], 'Okabe-Ito blue');
  assert.deepEqual(divergingRgb(0.5), [247, 247, 247]);
  assert.deepEqual(divergingRgb(1), [213, 94, 0], 'Okabe-Ito vermillion');
  const [lr, , lb] = divergingRgb(0.1), [hr, , hb] = divergingRgb(0.9);
  assert.ok(lb > lr, 'below zero is bluer than red');
  assert.ok(hr > hb, 'above zero is warmer than blue');
});

test('a value outside the key, or not a number, is held at the ends or the middle', () => {
  assert.deepEqual(divergingRgb(-3), divergingRgb(0));
  assert.deepEqual(divergingRgb(7), divergingRgb(1));
  assert.deepEqual(divergingRgb(NaN), divergingRgb(0.5));
  assert.equal(divergingColor(0.5), 'rgb(247, 247, 247)');
});

test('the ramp changes smoothly: neighbouring steps are close, and the middle is the lightest', () => {
  let lightest = 0, at = 0;
  for (let i = 0; i <= 100; i++) {
    const [r, g, b] = divergingRgb(i / 100);
    const sum = r + g + b;
    if (sum > lightest) { lightest = sum; at = i; }
    if (i > 0) {
      const [pr, pg, pb] = divergingRgb((i - 1) / 100);
      assert.ok(Math.abs(r - pr) + Math.abs(g - pg) + Math.abs(b - pb) < 40, `step ${i}`);
    }
  }
  assert.equal(at, 50);
});

test('dark text on the light cells, white on the dark ones', () => {
  assert.equal(darkTextOn(divergingRgb(0.5)), true, 'the neutral middle');
  assert.equal(darkTextOn(divergingRgb(0.25)), true, 'pale blue');
  assert.equal(darkTextOn(divergingRgb(0)), false, 'deep blue');
  assert.equal(darkTextOn(divergingRgb(1)), true, 'vermillion is light enough that dark text has the better contrast');
});

test('a plot offers two gradients of its own, a signed scale and a rating, beside the map\'s', () => {
  assert.deepEqual(PLOT_GRADIENTS.map(g => g.name), ['diverging', 'rating']);
  assert.match(PLOT_GRADIENTS.find(g => g.name === 'rating').label, /colour-blind safe/);
});

test('a plot\'s gradient: its own setting first, blue to orange for a rescaled value, a rating scale for a yield, the map\'s default otherwise, and reversible', () => {
  assert.equal(plotGradient(undefined, undefined, true)(0.5), 'rgb(247, 247, 247)', 'rescaled around zero: blue to red');
  assert.equal(plotGradient(undefined, undefined, false)(0.5), plotGradient('default', undefined, false)(0.5), 'else the map\'s default');
  assert.notEqual(plotGradient(undefined, undefined, false)(0.5), 'rgb(247, 247, 247)');
  const mapTraffic = resolveValueColorFn('traffic');
  assert.equal(plotGradient('traffic', undefined, true)(0), mapTraffic(0), 'a map gradient by name; the setting wins over the rescaling');
  assert.equal(plotGradient('traffic', true, false)(0), mapTraffic(1), 'reversed');
  assert.equal(plotGradient('diverging', true, false)(0), 'rgb(213, 94, 0)');
  assert.equal(plotGradient(undefined, undefined, false, true)(0), 'rgb(213, 94, 0)', 'a rating: bad is vermillion');
  assert.equal(plotGradient(undefined, undefined, false, true)(1), 'rgb(0, 114, 178)', 'and good is blue');
  assert.equal(plotGradient('cividis', undefined, false, true)(0), resolveValueColorFn('cividis')(0), 'a setting wins over the rating');
  assert.equal(plotGradient(undefined, undefined, true, true)(0), 'rgb(0, 114, 178)', 'values rescaled around zero are signed, not a rating');
  assert.equal(plotGradient('no-such-gradient', undefined, false)(0.3), plotGradient(undefined, undefined, false)(0.3), 'an unknown name falls back to the default');
});

test('text colour for any CSS colour the gradients return', () => {
  assert.equal(darkTextOnColor('rgb(247, 247, 247)'), true);
  assert.equal(darkTextOnColor('rgb(33, 102, 172)'), false);
  assert.equal(darkTextOnColor('#fde725'), true, 'a pale yellow, written in hex');
  assert.equal(darkTextOnColor('#440154'), false, 'a deep purple');
  assert.equal(darkTextOnColor('#fff'), true);
  assert.equal(darkTextOnColor('not a colour'), false, 'white where it cannot tell');
});

// ── colour vision ───────────────────────────────────────────────────────────────────────────────────────────
// The ends of a gradient must stay apart for the common colour-vision deficiencies (Machado et al. 2009 at full severity,
// distance as CIE76 ΔE in Lab): this is the measurement behind the automatic gradients.
const MATRICES = {
  protan: [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
  deutan: [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.011820, 0.042940, 0.968881]],
  tritan: [[1.255528, -0.076749, -0.178779], [-0.078411, 0.930809, 0.147602], [0.004733, 0.691367, 0.303900]],
};
const lin = c => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const unlin = c => { c = Math.min(1, Math.max(0, c)); return 255 * (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055); };
const seen = (rgb, kind) => (kind === 'normal' ? rgb : MATRICES[kind].map(r => unlin(r[0] * lin(rgb[0]) + r[1] * lin(rgb[1]) + r[2] * lin(rgb[2]))));
const lab = (rgb) => {
  const [r, g, b] = rgb.map(lin);
  const X = (0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / 0.95047, Y = 0.2126729 * r + 0.7151522 * g + 0.0721750 * b, Z = (0.0193339 * r + 0.1191920 * g + 0.9503041 * b) / 1.08883;
  const f = t => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
  return [116 * f(Y) - 16, 500 * (f(X) - f(Y)), 200 * (f(Y) - f(Z))];
};
const apart = (a, b, kind) => { const x = lab(seen(a, kind)), y = lab(seen(b, kind)); return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]); };

test('the signed scale and the rating scale keep their ends well apart under every common colour vision', () => {
  for (const kind of ['normal', 'protan', 'deutan', 'tritan']) {
    assert.ok(apart(divergingRgb(0), divergingRgb(1), kind) > 60, `signed scale, ${kind}`);
    assert.ok(apart(ratingRgb(0), ratingRgb(1), kind) > 60, `rating scale, ${kind}`);
  }
});

const rgbOf = css => css.match(/\d+/g).slice(0, 3).map(Number);

test('the map\'s Cividis stays apart under every vision, and its Traffic does not (so neither is automatic)', () => {
  const cividis = resolveValueColorFn('cividis'), traffic = resolveValueColorFn('traffic');
  for (const kind of ['normal', 'protan', 'deutan', 'tritan']) {
    assert.ok(apart(rgbOf(cividis(0)), rgbOf(cividis(1)), kind) > 60, `cividis, ${kind}`);
  }
  assert.ok(apart(rgbOf(traffic(0)), rgbOf(traffic(1)), 'deutan') < 60, 'traffic, deuteranopia');
});
