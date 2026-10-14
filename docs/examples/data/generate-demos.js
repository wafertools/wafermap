#!/usr/bin/env node
// Generates the 4 showcase demo CSV files and their .meta.json sidecars.
// Run: node docs/examples/data/generate-demos.js
// Output: edge-ring.csv, parametric.csv, cluster.csv, high-yield.csv
//
// All files share the same column schema:
//   lot, wafer, x, y, hbin, sbin, iddq, vref, fmax
// so a single hardcoded mapping in showcase.html covers all scenarios.

import { writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dir = dirname(fileURLToPath(import.meta.url));

// ── Wafer geometry ─────────────────────────────────────────────────────────
// A real 200 mm wafer at a 5 mm die pitch: radius 100 mm / 5 mm = 20 die units,
// giving ~1,250 dies per wafer.
//
// This used to be a 17×17 grid clipped to radius 8.4 — 221 dies. Two problems.
// It was far coarser than any real wafer map (each die was 0.45% of the wafer,
// so every yield figure moved in half-percent steps), and the dimensions were
// never recorded anywhere, so `buildWaferMap` had nothing to work from and
// inferred a dimensionless wafer "17.7 across" with 1×1 dies and
// `diePitch.units: 'normalized'`. The header comment claimed 150 mm at 10 mm
// pitch, which is exactly the information that was missing from the output.
//
// The numbers below are now also written to a `.meta.json` sidecar beside each
// CSV, which showcase.html loads — see writeMeta.
const WAFER_DIAMETER_MM = 200;
const DIE_PITCH_MM      = 5;
const WAFER_RADIUS      = (WAFER_DIAMETER_MM / 2) / DIE_PITCH_MM;  // 20 die units
const EDGE_BAND         = 3.0;  // dies within this distance from edge get edge treatment

// Half the die DIAGONAL, in die units. The clip below tests a die's CENTRE
// against the radius, but the part of a die that leaves the wafer first is its
// far corner — so clipping on the centre alone lets whole rows of dies overhang
// the boundary. That is not a cosmetic detail: a probed die is by definition a
// real prober position and therefore fully on the wafer, so an overhanging die
// is a contradiction, and `buildWaferMap` correctly reports it as
// `geometry-conflict` once the geometry is declared. It did so on all four
// scenarios until this was fixed — invisible beforehand only because the
// geometry was not declared at all and nothing could check it.
const HALF_DIAGONAL = Math.hypot(0.5, 0.5);

function waferDies() {
  const dies = [];
  const lim = Math.ceil(WAFER_RADIUS);
  const clip = WAFER_RADIUS - HALF_DIAGONAL;
  for (let x = -lim; x <= lim; x++) {
    for (let y = -lim; y <= lim; y++) {
      const r = Math.sqrt(x * x + y * y);
      if (r <= clip) dies.push({ x, y, r });
    }
  }
  return dies;
}

// ── Seeded PRNG (mulberry32) ───────────────────────────────────────────────
function seededRng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) >>> 0;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Normal variate (Box-Muller)
function normal(rng, mean, sd) {
  const u = 1 - rng(), v = rng();
  return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// Clamp
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// Round to N decimal places
const r2 = v => Math.round(v * 100) / 100;
const r3 = v => Math.round(v * 1000) / 1000;

// ── Test flow and binning ─────────────────────────────────────────────────
// Every die runs the same test flow, and its bins come from its test results
// in flow order, the way a test program bins: the first test a die fails
// decides its bin. A spatial pattern therefore reaches the bins through the
// tests — an edge die with high Iddq is binned Iddq because its Iddq is high —
// so the bin map, the test-value maps and the Summary panel all agree.
//
//   1  Continuity  pass/fail probe contact (a defect, not a column)  → bin 2
//   2  Iddq        quiescent supply current, µA, high limit          → bin 3
//   3  Vref        bandgap reference output, V, two-sided            → bin 4
//   4  Fmax        maximum operating frequency, MHz, low limit       → bin 5
const LIMITS = {
  iddqHigh: 5.0,
  vrefLow:  1.70, vrefHigh: 1.88,
  fmaxLow:  2025,
};

/** Hard and soft bin from one die's results, in test-flow order. */
function binDie({ open, short, iddq, vref, fmax }) {
  if (open)                   return { hbin: 2, sbin: 20 };
  if (short)                  return { hbin: 2, sbin: 21 };
  if (iddq > LIMITS.iddqHigh) return { hbin: 3, sbin: 30 };
  if (vref < LIMITS.vrefLow)  return { hbin: 4, sbin: 40 };
  if (vref > LIMITS.vrefHigh) return { hbin: 4, sbin: 41 };
  if (fmax < LIMITS.fmaxLow)  return { hbin: 5, sbin: 50 };
  return { hbin: 1, sbin: 10 };
}

/**
 * A die hit by a physical defect (a particle, edge chipping, film damage)
 * fails in one of the ways a real defect shows up at test: an open contact,
 * a short, or excess supply current. Returns the overrides for that die.
 */
function defect(rng, iddq) {
  const k = rng();
  if (k < 0.25) return { open: true };
  if (k < 0.35) return { short: true };
  return { iddq: Math.max(iddq, LIMITS.iddqHigh * (1.15 + rng() * 2.5)) };
}

function row(lot, wafer, x, y, die) {
  const { hbin, sbin } = binDie(die);
  return { lot, wafer, x, y, hbin, sbin,
    iddq: r2(die.iddq), vref: r3(die.vref), fmax: r2(die.fmax) };
}

// ── Scenario 1: edge-ring ──────────────────────────────────────────────────
// Clean centre, progressive yield loss near the edge. 8 wafers.
function buildEdgeRing() {
  const rng = seededRng(0xABCD1234);
  const dies = waferDies();
  const rows = [];

  for (let w = 1; w <= 8; w++) {
    const wid = `W0${w}`;
    for (const { x, y, r } of dies) {
      // Edge stress: probability of a defect rises sharply over the outer dies,
      // and the surviving edge dies run slower and leakier.
      const edgeFactor = Math.max(0, (r - (WAFER_RADIUS - EDGE_BAND)) / EDGE_BAND);
      const failProb = edgeFactor * edgeFactor * 0.85 + rng() * 0.01;

      let die = {
        iddq: clamp(normal(rng, 2.4 * (1 + edgeFactor * 0.5), 0.3), 0.5, 40),
        vref: clamp(normal(rng, 1.790 - edgeFactor * 0.02, 0.015), 1.6, 2.0),
        fmax: clamp(normal(rng, 2110 - edgeFactor * 70, 20), 1800, 2250),
      };
      if (rng() < failProb) die = { ...die, ...defect(rng, die.iddq) };
      rows.push(row('EDGE-LOT-01', wid, x, y, die));
    }
  }
  return rows;
}

// ── Scenario 2: parametric ────────────────────────────────────────────────
// Iddq rising with radius plus one hotspot per wafer, and a left-to-right Vref
// gradient. The yield loss is the Iddq limit, so the bin map follows the
// value map. 6 wafers.
function buildParametric() {
  const rng = seededRng(0xDEADBEEF);
  const dies = waferDies();
  const rows = [];

  for (let w = 1; w <= 6; w++) {
    const wid = `W0${w}`;
    // Wafer-to-wafer process drift in Iddq
    const wDrift = rng() * 0.8 - 0.4;
    // One hotspot per wafer at a random position
    const hx = Math.round((rng() - 0.5) * 10);
    const hy = Math.round((rng() - 0.5) * 10);

    for (const { x, y } of dies) {
      // Radial gradient (higher Iddq toward the edge)
      const r = Math.sqrt(x * x + y * y);
      const gradient = r * 0.12;

      // Hotspot contribution (Gaussian bump)
      const dx = x - hx, dy = y - hy;
      const hotspot = Math.exp(-(dx * dx + dy * dy) / 4) * 3.5;

      // Iddq: log-normally distributed
      const meanLog = Math.log(2.0 + gradient + hotspot + wDrift);
      const die = {
        iddq: clamp(Math.exp(normal(rng, meanLog, 0.18)), 0.1, 80),
        // Vref: slight x-gradient (process non-uniformity) that reaches the
        // high limit at the right-hand edge
        vref: clamp(normal(rng, 1.800 + x * 0.0035, 0.015), 1.6, 2.0),
        fmax: clamp(normal(rng, 2110, 20), 1950, 2250),
      };
      rows.push(row('PARAM-LOT-02', wid, x, y, die));
    }
  }
  return rows;
}

// ── Scenario 3: cluster ───────────────────────────────────────────────────
// High baseline yield, but 2–3 particle clusters per wafer. 7 wafers.
function buildCluster() {
  const rng = seededRng(0x13579BDF);
  const dies = waferDies();
  const rows = [];

  for (let w = 1; w <= 7; w++) {
    const wid = `W0${w}`;

    // 2–3 clusters, each at a random position with random radius
    const nClusters = 2 + (rng() < 0.5 ? 1 : 0);
    const clusters = [];
    for (let c = 0; c < nClusters; c++) {
      const angle = rng() * 2 * Math.PI;
      const dist  = rng() * 6;
      clusters.push({
        cx: dist * Math.cos(angle),
        cy: dist * Math.sin(angle),
        r2: (1.2 + rng() * 1.5) ** 2,
      });
    }

    for (const { x, y } of dies) {
      // Probability of a defect determined by proximity to any cluster
      let clusterP = 0;
      for (const { cx, cy, r2: cr2 } of clusters) {
        const d2 = (x - cx) ** 2 + (y - cy) ** 2;
        clusterP = Math.max(clusterP, Math.exp(-d2 / cr2) * 0.9);
      }
      const failProb = clusterP + rng() * 0.01;

      let die = {
        iddq: clamp(normal(rng, 2.5, 0.3), 0.5, 40),
        vref: clamp(normal(rng, 1.790, 0.015), 1.6, 2.0),
        fmax: clamp(normal(rng, 2110, 20), 1950, 2250),
      };
      if (rng() < failProb) die = { ...die, ...defect(rng, die.iddq) };
      rows.push(row('CLUST-LOT-03', wid, x, y, die));
    }
  }
  return rows;
}

// ── Scenario 4: high-yield ────────────────────────────────────────────────
// Mature process, very high yield, tight distributions. 10 wafers.
function buildHighYield() {
  const rng = seededRng(0xF0F0F0F0);
  const dies = waferDies();
  const rows = [];

  for (let w = 1; w <= 10; w++) {
    const wid = w <= 9 ? `W0${w}` : `W${w}`;
    const wOffset = normal(rng, 0, 0.08); // small W2W spread

    for (const { x, y } of dies) {
      const failProb = 0.008 + rng() * 0.004;
      let die = {
        iddq: clamp(normal(rng, 2.2 + wOffset, 0.2), 1.2, 40),
        vref: clamp(normal(rng, 1.790 + wOffset * 0.01, 0.012), 1.6, 2.0),
        fmax: clamp(normal(rng, 2110 + wOffset * 5, 16), 1950, 2250),
      };
      if (rng() < failProb) die = { ...die, ...defect(rng, die.iddq) };
      rows.push(row('HY-LOT-04', wid, x, y, die));
    }
  }
  return rows;
}

// ── Write files as CSV ─────────────────────────────────────────────────────
const COLS = ['lot','wafer','x','y','hbin','sbin','iddq','vref','fmax'];

function toCsv(rows) {
  const lines = [COLS.join(',')];
  for (const r of rows) lines.push(COLS.map(c => r[c]).join(','));
  return lines.join('\n') + '\n';
}

const scenarios = {
  'edge-ring':  buildEdgeRing(),
  'parametric': buildParametric(),
  'cluster':    buildCluster(),
  'high-yield': buildHighYield(),
};

/**
 * Geometry and definitions that a flat die CSV cannot carry, written beside each
 * scenario as `<name>.meta.json` and loaded by showcase.html.
 *
 * Without it every scenario rendered a dimensionless wafer: correct relative
 * die positions, but a fictional diameter, 1×1 dies, and no way to show spec
 * limits or named bins because the CSV has nowhere to put them.
 *
 * Limits are set against the distributions these builders actually produce, near
 * the tails, so a small realistic fraction of dies falls out of spec. A limit
 * nothing violates demonstrates nothing; one everything violates is no better.
 */
const META = {
  waferConfig: { diameter: WAFER_DIAMETER_MM, notch: { type: 'bottom' } },
  dieConfig:   { width: DIE_PITCH_MM, height: DIE_PITCH_MM },
  passBins: [1],
  hbinDefs: [
    { bin: 1, name: 'Pass' },
    { bin: 2, name: 'Continuity' },
    { bin: 3, name: 'Iddq' },
    { bin: 4, name: 'Vref' },
    { bin: 5, name: 'Fmax' },
  ],
  sbinDefs: [
    { bin: 10, name: 'Pass' },
    { bin: 20, name: 'Continuity - Open' },
    { bin: 21, name: 'Continuity - Short' },
    { bin: 30, name: 'Iddq - High' },
    { bin: 40, name: 'Vref - Low' },
    { bin: 41, name: 'Vref - High' },
    { bin: 50, name: 'Fmax - Slow' },
  ],
  // Test numbers match showcase.html's DEMO_MAPPING; the limits are the ones
  // binDie applies, so a die outside a limit is always binned for it.
  testDefs: [
    { testNumber: 1001, name: 'Iddq', unit: 'µA',  limitHigh: LIMITS.iddqHigh },
    { testNumber: 1002, name: 'Vref', unit: 'V',   limitLow: LIMITS.vrefLow, limitHigh: LIMITS.vrefHigh },
    { testNumber: 1003, name: 'Fmax', unit: 'MHz', limitLow: LIMITS.fmaxLow },
  ],
};

for (const [name, rows] of Object.entries(scenarios)) {
  const csv = toCsv(rows);
  const path = join(__dir, `${name}.csv`);
  writeFileSync(path, csv);
  writeFileSync(join(__dir, `${name}.meta.json`), JSON.stringify(META, null, 2) + '\n');
  const kb = (Buffer.byteLength(csv) / 1024).toFixed(1);
  console.log(`${name}.csv — ${rows.length.toLocaleString()} rows, ${kb} KB  (+ ${name}.meta.json)`);
}
