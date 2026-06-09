#!/usr/bin/env node
// Generates a large synthetic CSV for scale testing.
// Produces N_WAFERS wafers × ~D_TARGET dies × N_TESTS parametric tests.
//
// Usage: node scripts/gen-large-parametric.mjs [outpath]
// Default output: site/data/large-parametric.csv
//
// Design:
//   - 300 mm wafer, 5 mm pitch → ~3 600 dies per wafer (circular clip)
//   - 5 wafers, 200 parametric tests (testA001..testA200) + hbin/sbin
//   - Each test has a mean/sigma drawn from a reproducible LCG seed
//   - Wafer-to-wafer variation: per-wafer mean shift (±5 % of sigma)
//   - Spatial gradient: mild centre-to-edge gradient on ~20 % of tests
//   - Hard bin: pass (bin 1) if all "critical" tests (first 10) are in-spec
//   - Soft bin: encodes which critical test failed first (bins 101–110)
//   - ~3 % random edge-ring fails added on top

import { writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const OUT = process.argv[2]
  ?? join(dirname(fileURLToPath(import.meta.url)), '../site/data/large-parametric.csv');

const N_WAFERS   = 5;
const N_TESTS    = 200;
const RADIUS_MM  = 150;
const PITCH_MM   = 5;
const EDGE_EX_MM = 3;
const CRITICAL_N = 10;   // first N tests gate the hard bin
const LOT        = 'SCALE-LOT-01';

// ── LCG PRNG ────────────────────────────────────────────────────────────────

function makeLcg(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(1664525, s) + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

function gauss(mean, sigma, rng) {
  const u1 = Math.max(1e-10, rng());
  const u2 = rng();
  return mean + sigma * Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

// ── Wafer grid (prober step coordinates) ────────────────────────────────────

function waferGrid(radiusMm, pitchMm, edgeExMm) {
  const r = radiusMm - edgeExMm;
  const iMax = Math.ceil(r / pitchMm);
  const dies = [];
  for (let y = -iMax; y <= iMax; y++) {
    for (let x = -iMax; x <= iMax; x++) {
      if ((x * pitchMm) ** 2 + (y * pitchMm) ** 2 <= r * r) {
        dies.push({ x, y });
      }
    }
  }
  return dies;
}

// ── Test parameter table (stable across wafers) ──────────────────────────────

const rngParams = makeLcg(0xdeadbeef);
const tests = Array.from({ length: N_TESTS }, (_, i) => {
  const testNumber = 1000 + i + 1;     // 1001..1200
  const mean       = 0.5 + rngParams() * 4.5;   // 0.5–5.0
  const sigma      = mean * (0.02 + rngParams() * 0.08);  // 2–10 % CV
  const limitLow   = i < CRITICAL_N ? mean - 3 * sigma : undefined;
  const limitHigh  = i < CRITICAL_N ? mean + 3 * sigma : undefined;
  const hasGradient = rngParams() < 0.20;
  const gradScale   = hasGradient ? (rngParams() - 0.5) * 0.01 * mean : 0;
  return { testNumber, mean, sigma, limitLow, limitHigh, gradScale };
});

// ── Generate ────────────────────────────────────────────────────────────────

const grid = waferGrid(RADIUS_MM, PITCH_MM, EDGE_EX_MM);
console.log(`Grid: ${grid.length} dies per wafer, ${N_TESTS} tests, ${N_WAFERS} wafers`);
console.log(`Output: ${OUT}`);

const colNames = tests.map(t => `test${String(t.testNumber).padStart(4, '0')}`);
const header = ['lot', 'wafer', 'x', 'y', 'hbin', 'sbin', ...colNames].join(',');
const lines = [header];

for (let w = 0; w < N_WAFERS; w++) {
  const waferId = `W${String(w + 1).padStart(2, '0')}`;
  const rng = makeLcg(0xf00d_cafe + w * 0x100);

  // Per-wafer mean shift (±5 % of sigma per test)
  const waferShift = tests.map(t => gauss(0, t.sigma * 0.05, rng));

  for (const { x, y } of grid) {
    // Slight edge-ring radial boost on critical tests
    const rFrac = Math.sqrt((x * PITCH_MM) ** 2 + (y * PITCH_MM) ** 2) / RADIUS_MM;
    const edgeFail = rFrac > 0.88 && rng() < 0.03;

    const vals = tests.map((t, i) => {
      const spatial = x * t.gradScale + y * t.gradScale * 0.5;
      let v = gauss(t.mean + waferShift[i] + spatial, t.sigma, rng);
      if (edgeFail && i < CRITICAL_N) v = (t.limitHigh ?? t.mean + 3 * t.sigma) * 1.05;
      return v;
    });

    // Bin assignment: fail if any critical test is out of spec
    let hbin = 1, sbin = 101;
    for (let i = 0; i < CRITICAL_N; i++) {
      const t = tests[i];
      if ((t.limitLow !== undefined && vals[i] < t.limitLow) ||
          (t.limitHigh !== undefined && vals[i] > t.limitHigh)) {
        hbin = 4;
        sbin = 110 + i;  // 110–119: which test failed
        break;
      }
    }

    const row = [LOT, waferId, x, y, hbin, sbin, ...vals.map(v => v.toFixed(6))].join(',');
    lines.push(row);
  }

  const passCount = lines.filter((l, idx) => idx > 0 && l.includes(`,${waferId},`) && l.includes(',1,')).length;
  console.log(`  ${waferId}: ${grid.length} dies written`);
}

writeFileSync(OUT, lines.join('\n') + '\n', 'utf8');
const kb = Math.round(lines.join('\n').length / 1024);
console.log(`\nDone — ${lines.length - 1} data rows, ~${kb} KB`);
