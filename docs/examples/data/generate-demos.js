#!/usr/bin/env node
// Generates the 4 showcase demo JSON files.
// Run: node docs/examples/data/generate-demos.js
// Output: edge-ring.json, parametric.json, cluster.json, high-yield.json
//
// All files share the same column schema:
//   lot, wafer, x, y, hbin, sbin, leakage, voltage, frequency
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

// ── Scenario 1: edge-ring ──────────────────────────────────────────────────
// Clean centre, progressive yield loss near edge. 8 wafers.
function buildEdgeRing() {
  const rng = seededRng(0xABCD1234);
  const dies = waferDies();
  const rows = [];

  for (let w = 1; w <= 8; w++) {
    const wid = `W0${w}`;
    for (const { x, y, r } of dies) {
      // Edge stress: probability of fail increases sharply near edge
      const edgeFactor = Math.max(0, (r - (WAFER_RADIUS - EDGE_BAND)) / EDGE_BAND);
      const failProb = edgeFactor * edgeFactor * 0.85 + rng() * 0.01;

      let hbin, sbin;
      const roll = rng();
      if (roll < failProb) {
        // Edge-ring failure modes: bin 2 = oxide stress, bin 3 = metal thinning
        const subRoll = rng();
        hbin = subRoll < 0.6 ? 2 : 3;
        sbin = hbin === 2 ? (rng() < 0.5 ? 21 : 22) : 31;
      } else {
        hbin = 1;
        sbin = rng() < 0.92 ? 10 : 11;
      }

      // Test values — good centre, degraded at edge
      const stress = 1 + edgeFactor * 1.2;
      const leakage  = r2(clamp(normal(rng, 2.5 * stress, 0.4 * stress), 0.3, 18));
      const voltage  = r2(clamp(normal(rng, 1.8 - edgeFactor * 0.15, 0.04), 1.5, 2.1));
      const frequency = r2(clamp(normal(rng, 2100 - edgeFactor * 120, 30), 1750, 2250));

      rows.push({ lot: 'EDGE-LOT-01', wafer: wid, x, y, hbin, sbin,
        leakage, voltage, frequency });
    }
  }
  return rows;
}

// ── Scenario 2: parametric ────────────────────────────────────────────────
// Good yield with interesting parametric patterns (gradient + hotspot). 6 wafers.
function buildParametric() {
  const rng = seededRng(0xDEADBEEF);
  const dies = waferDies();
  const rows = [];

  for (let w = 1; w <= 6; w++) {
    const wid = `W0${w}`;
    // Wafer-to-wafer process drift in leakage
    const wDrift = rng() * 0.8 - 0.4;
    // One hotspot per wafer at a random position
    const hx = Math.round((rng() - 0.5) * 10);
    const hy = Math.round((rng() - 0.5) * 10);

    for (const { x, y } of dies) {
      // Radial gradient (higher leakage toward edge)
      const r = Math.sqrt(x * x + y * y);
      const gradient = r * 0.12;

      // Hotspot contribution (Gaussian bump)
      const dx = x - hx, dy = y - hy;
      const dist2 = dx * dx + dy * dy;
      const hotspot = Math.exp(-dist2 / 4) * 3.5;

      // Leakage: log-normally distributed
      const meanLog = Math.log(2.0 + gradient + hotspot + wDrift);
      const logVal  = normal(rng, meanLog, 0.18);
      const leakage = r2(clamp(Math.exp(logVal), 0.1, 80));

      // Voltage: slight x-gradient (process non-uniformity)
      const voltage  = r2(clamp(normal(rng, 1.8 + x * 0.005, 0.025), 1.62, 1.98));
      const frequency = r2(clamp(normal(rng, 2100, 25), 1980, 2220));

      // Fail where leakage exceeds spec — thresholds tuned to actual data range
      const hbin = leakage > 6.5 ? 3 : leakage > 5.0 ? 2 : 1;
      const sbin = hbin === 1 ? 10 : hbin === 2 ? 21 : 31;

      rows.push({ lot: 'PARAM-LOT-02', wafer: wid, x, y, hbin, sbin,
        leakage, voltage, frequency });
    }
  }
  return rows;
}

// ── Scenario 3: cluster ───────────────────────────────────────────────────
// High baseline yield, but 2–3 defect clusters per wafer. 7 wafers.
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
      // Probability of failure determined by proximity to any cluster
      let clusterP = 0;
      for (const { cx, cy, r2: cr2 } of clusters) {
        const d2 = (x - cx) ** 2 + (y - cy) ** 2;
        clusterP = Math.max(clusterP, Math.exp(-d2 / cr2) * 0.9);
      }
      const failProb = clusterP + rng() * 0.01;

      let hbin, sbin;
      if (rng() < failProb) {
        hbin = rng() < 0.7 ? 2 : 3;
        sbin = hbin === 2 ? (rng() < 0.5 ? 21 : 23) : 32;
      } else {
        hbin = 1;
        sbin = rng() < 0.95 ? 10 : 11;
      }

      const leakage  = r2(clamp(normal(rng, 2.8, 0.35), 0.4, 12));
      const voltage  = r2(clamp(normal(rng, 1.8, 0.03), 1.65, 1.95));
      const frequency = r2(clamp(normal(rng, 2100, 22), 2010, 2190));

      rows.push({ lot: 'CLUST-LOT-03', wafer: wid, x, y, hbin, sbin,
        leakage, voltage, frequency });
    }
  }
  return rows;
}

// ── Scenario 4: high-yield ────────────────────────────────────────────────
// Mature process, very high yield, nice distributions. 10 wafers.
function buildHighYield() {
  const rng = seededRng(0xF0F0F0F0);
  const dies = waferDies();
  const rows = [];

  for (let w = 1; w <= 10; w++) {
    const wid = w <= 9 ? `W0${w}` : `W${w}`;
    const wOffset = normal(rng, 0, 0.08); // small W2W spread

    for (const { x, y } of dies) {
      const failProb = 0.008 + rng() * 0.004;
      const hbin = rng() < failProb ? 2 : 1;
      const sbin = hbin === 1 ? 10 : 21;

      const leakage  = r3(clamp(normal(rng, 2.2 + wOffset, 0.2), 1.2, 4.5));
      const voltage  = r3(clamp(normal(rng, 1.800 + wOffset * 0.01, 0.018), 1.72, 1.88));
      const frequency = r2(clamp(normal(rng, 2100 + wOffset * 5, 18), 2035, 2165));

      rows.push({ lot: 'HY-LOT-04', wafer: wid, x, y, hbin, sbin,
        leakage, voltage, frequency });
    }
  }
  return rows;
}

// ── Write files as CSV ─────────────────────────────────────────────────────
const COLS = ['lot','wafer','x','y','hbin','sbin','leakage','voltage','frequency'];

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
    { bin: 2, name: 'Leakage' },
    { bin: 3, name: 'Edge Ring' },
    { bin: 4, name: 'Cluster Defect' },
    { bin: 5, name: 'Vth Shift' },
  ],
  sbinDefs: [
    { bin: 1,  name: 'Pass' },
    { bin: 21, name: 'Leakage - Gate' },
    { bin: 31, name: 'Edge - Chipping' },
    { bin: 32, name: 'Edge - Film' },
    { bin: 41, name: 'Cluster - Particle' },
    { bin: 51, name: 'Vth - Hi' },
  ],
  // Test numbers match showcase.html's DEMO_MAPPING.
  // Set from the pooled distributions these builders produce (leakage p97 4.95,
  // voltage p3 1.70 / p97 1.87, frequency p3 2025), so roughly 2–4% of dies fall
  // out of spec on each test — visible on the map without swamping it, and
  // enough for the pass-rate pareto to rank the three tests differently.
  testDefs: [
    { testNumber: 1001, name: 'Leakage',   unit: 'µA',  limitHigh: 5.0 },
    { testNumber: 1002, name: 'Voltage',   unit: 'V',   limitLow: 1.70, limitHigh: 1.88 },
    { testNumber: 1003, name: 'Frequency', unit: 'MHz', limitLow: 2025 },
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
