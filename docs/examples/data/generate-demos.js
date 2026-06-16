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
// 150 mm wafer, ~10 mm die pitch → grid from -8 to +8 each axis
const WAFER_RADIUS = 8.4; // in die units
const EDGE_BAND   = 1.4;  // dies within this distance from edge get edge treatment

function waferDies() {
  const dies = [];
  for (let x = -9; x <= 9; x++) {
    for (let y = -9; y <= 9; y++) {
      const r = Math.sqrt(x * x + y * y);
      if (r <= WAFER_RADIUS) dies.push({ x, y, r });
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

for (const [name, rows] of Object.entries(scenarios)) {
  const csv = toCsv(rows);
  const path = join(__dir, `${name}.csv`);
  writeFileSync(path, csv);
  const kb = (Buffer.byteLength(csv) / 1024).toFixed(1);
  console.log(`${name}.csv — ${rows.length.toLocaleString()} rows, ${kb} KB`);
}
