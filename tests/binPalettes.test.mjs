// Guards the built-in bin palettes' measured separation.
//
// The palettes in renderer/colorSchemes.ts were chosen by measurement (greedy
// max–min CIEDE2000 over published categorical sets), because the previous
// ones were chosen by eye and measured badly: two of the first sixteen soft
// bins were identical, and bin 4 vs bin 11 was ΔE 1.4 for a deuteranope. This
// re-measures them so an edit that looks harmless cannot quietly erode that.
//
// Thresholds are a little under the values the selection achieved, so this
// flags regressions without pinning every hex.

import test from 'node:test';
import assert from 'node:assert/strict';
import { getBinColorScheme } from '../dist/packages/renderer/colorSchemes.js';
import { NO_DATA_FILL } from '../dist/packages/renderer/colorMap.js';

// ── Colour maths (sRGB → CIELAB, CIEDE2000, Machado 2009 CVD simulation) ─────

const toRgb = (hex) => { const h = hex.replace('#', ''); return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)); };
const lin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
const unlin = (v) => Math.round(255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055));
const CVD = {
  deutan: [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.011820, 0.042940, 0.968881]],
  protan: [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
  tritan: [[1.255528, -0.076749, -0.178779], [-0.078411, 0.930809, 0.147602], [0.004733, 0.691367, 0.303900]],
};
const simulate = (rgb, m) => { const l = rgb.map(lin); return m.map((r) => unlin(Math.min(1, Math.max(0, r[0] * l[0] + r[1] * l[1] + r[2] * l[2])))); };
function lab(rgb) {
  const [r, g, b] = rgb.map(lin);
  const X = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047;
  const Y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const Z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883;
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  return [116 * f(Y) - 16, 500 * (f(X) - f(Y)), 200 * (f(Y) - f(Z))];
}
function deltaE00([L1, a1, b1], [L2, a2, b2]) {
  const rad = Math.PI / 180;
  const C1 = Math.hypot(a1, b1), C2 = Math.hypot(a2, b2), Cb = (C1 + C2) / 2;
  const G = 0.5 * (1 - Math.sqrt(Cb ** 7 / (Cb ** 7 + 25 ** 7)));
  const a1p = a1 * (1 + G), a2p = a2 * (1 + G);
  const C1p = Math.hypot(a1p, b1), C2p = Math.hypot(a2p, b2);
  const hue = (b, a) => { const x = Math.atan2(b, a) / rad; return x < 0 ? x + 360 : x; };
  const h1 = hue(b1, a1p), h2 = hue(b2, a2p);
  const dL = L2 - L1, dC = C2p - C1p;
  let dh = h2 - h1;
  if (C1p * C2p === 0) dh = 0; else if (dh > 180) dh -= 360; else if (dh < -180) dh += 360;
  const dH = 2 * Math.sqrt(C1p * C2p) * Math.sin((dh * rad) / 2);
  const Lb = (L1 + L2) / 2, Cbp = (C1p + C2p) / 2;
  let hb = h1 + h2;
  if (C1p * C2p !== 0) { hb = Math.abs(h1 - h2) > 180 ? (h1 + h2 + 360) / 2 : (h1 + h2) / 2; if (hb >= 360) hb -= 360; }
  const T = 1 - 0.17 * Math.cos((hb - 30) * rad) + 0.24 * Math.cos(2 * hb * rad) + 0.32 * Math.cos((3 * hb + 6) * rad) - 0.2 * Math.cos((4 * hb - 63) * rad);
  const SL = 1 + (0.015 * (Lb - 50) ** 2) / Math.sqrt(20 + (Lb - 50) ** 2), SC = 1 + 0.045 * Cbp, SH = 1 + 0.015 * Cbp * T;
  const RT = -2 * Math.sqrt(Cbp ** 7 / (Cbp ** 7 + 25 ** 7)) * Math.sin(60 * Math.exp(-(((hb - 275) / 25) ** 2)) * rad);
  return Math.sqrt((dL / SL) ** 2 + (dC / SC) ** 2 + (dH / SH) ** 2 + RT * (dC / SC) * (dH / SH));
}
/** Smallest ΔE00 between two colours across the given vision modes. */
function separation(a, b, modes) {
  return Math.min(...modes.map((m) => {
    const tx = m === 'normal' ? (x) => x : (x) => simulate(x, CVD[m]);
    return deltaE00(lab(tx(toRgb(a))), lab(tx(toRgb(b))));
  }));
}
function closestPair(colours, modes) {
  let min = Infinity, pair = '';
  for (let i = 0; i < colours.length; i++) {
    for (let j = i + 1; j < colours.length; j++) {
      const d = separation(colours[i], colours[j], modes);
      if (d < min) { min = d; pair = `${colours[i]} ~ ${colours[j]}`; }
    }
  }
  return { min, pair };
}
const isGreenish = (hex) => {
  const [, a, b] = lab(toRgb(hex));
  const hueDeg = (Math.atan2(b, a) * 180 / Math.PI + 360) % 360;
  return Math.hypot(a, b) > 18 && hueDeg > 105 && hueDeg < 175;
};

// The neutral fills a die can already carry — a bin colour near one of these
// would read as "no data", "dimmed", "partial" or "edge excluded". The last
// three are buildView.ts's private constants, mirrored here deliberately.
const RESERVED = [NO_DATA_FILL, '#e8e9ea', '#d3d6db', '#aab0ba'];

// ── Default palette ──────────────────────────────────────────────────────────

test('default bin palette — every pass/fail pair ≥ 15 ΔE00 for normal vision', () => {
  const s = getBinColorScheme('default');
  const { min, pair } = closestPair([...s.pass, ...s.fail], ['normal']);
  assert.ok(min >= 15, `closest pair ${pair} is only ΔE ${min.toFixed(1)}`);
});

test('default bin palette — no fail colour is green, every pass colour is', () => {
  const s = getBinColorScheme('default');
  for (const c of s.fail) assert.ok(!isGreenish(c), `fail colour ${c} reads as green (pass)`);
  for (const c of s.pass) assert.ok(isGreenish(c), `pass colour ${c} does not read as green`);
});

test('default bin palette — clear of the neutral no-data/dim/partial/edge fills', () => {
  const s = getBinColorScheme('default');
  for (const c of [...s.pass, ...s.fail]) {
    for (const r of RESERVED) {
      const d = separation(c, r, ['normal']);
      assert.ok(d >= 12, `${c} is only ΔE ${d.toFixed(1)} from reserved fill ${r}`);
    }
  }
});

// ── Colour-blind safe palette ────────────────────────────────────────────────

test('accessible bin palette — every pair ≥ 8.5 ΔE00 under deutan, protan and tritan simulation', () => {
  const s = getBinColorScheme('accessible');
  const { min, pair } = closestPair([...s.pass, ...s.fail], ['normal', 'deutan', 'protan', 'tritan']);
  assert.ok(min >= 8.5, `closest pair ${pair} is only ΔE ${min.toFixed(1)} under some form of CVD`);
});

test('accessible bin palette — pass colours stay apart from every fail colour under CVD', () => {
  const s = getBinColorScheme('accessible');
  for (const p of s.pass) {
    for (const f of s.fail) {
      const d = separation(p, f, ['normal', 'deutan', 'protan', 'tritan']);
      assert.ok(d >= 10, `pass ${p} vs fail ${f} is only ΔE ${d.toFixed(1)} under some form of CVD`);
    }
  }
});

test('accessible bin palette — clear of the neutral fills under CVD', () => {
  const s = getBinColorScheme('accessible');
  for (const c of [...s.pass, ...s.fail]) {
    for (const r of RESERVED) {
      const d = separation(c, r, ['normal', 'deutan', 'protan', 'tritan']);
      assert.ok(d >= 9, `${c} is only ΔE ${d.toFixed(1)} from reserved fill ${r} under some form of CVD`);
    }
  }
});
