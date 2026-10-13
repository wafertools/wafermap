/**
 * Multi-bin false positive benchmark.
 *
 * Wafers with purely random (i.i.d. Bernoulli) failures split over four fail bins (50/25/15/10%), at
 * varying fail rates and grid sizes. No wafer has a pattern, so every cluster finding is a false
 * positive. Reports how often a cluster of one bin is raised, beside the clusters and edge arcs of every
 * fail bin together. WM-811K and the synthetic sweep have one fail bin, so neither runs the per-bin pass.
 *
 * Usage: node scripts/run-benchmark-multibin-fp.mjs   (REPS=n for wafers a cell, default 300)
 */
import { buildWaferMap } from '../dist/index.js';
import { analyzeWaferMap } from '../dist/packages/stats/analyzeWaferMap.js';

const GRID_SIZES = [20, 30, 40, 52, 100];
const FAIL_RATES = [0.02, 0.05, 0.10, 0.20, 0.40];
const SHARES = [0.5, 0.25, 0.15, 0.10];          // fail bins 2..5
const REPLICATES = Number(process.env.REPS ?? 300);
const DIAMETER = 300;

function mulberry32(seed) {
  return function () {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
function wafer(g, f, rng) {
  const c = Math.floor(g / 2), r = g / 2, out = [];
  for (let row = 0; row < g; row++) for (let col = 0; col < g; col++) {
    const dx = col - c, dy = row - c;
    if (Math.hypot(dx, dy) > r - 0.5) continue;
    let hbin = 1;
    if (rng() < f) { const u = rng(); let acc = 0; hbin = 5; for (let i = 0; i < SHARES.length; i++) { acc += SHARES[i]; if (u < acc) { hbin = i + 2; break; } } }
    out.push({ x: dx, y: -dy, hbin });
  }
  return out;
}

const pct = (n, d) => (n / d * 100).toFixed(1).padStart(5) + '%';
console.log(`grid  fail   per-bin cluster   pooled cluster/arc   (${REPLICATES} wafers a cell)`);
for (const g of GRID_SIZES) {
  for (const f of FAIL_RATES) {
    const rng = mulberry32(g * 7919 + Math.round(f * 1e4));
    let perBin = 0, pooled = 0;
    for (let i = 0; i < REPLICATES; i++) {
      const map = buildWaferMap({ results: wafer(g, f, rng), waferConfig: { diameter: DIAMETER }, dieConfig: { width: DIAMETER / g, height: DIAMETER / g } });
      const s = analyzeWaferMap(map, { enableTestValueAnalysis: false });
      if (s.findings.some(x => x.comparison.family === 'cluster' && x.variable.kind === 'hardBin')) perBin++;
      if (s.findings.some(x => (x.comparison.family === 'cluster' || x.comparison.family === 'edge-arc') && x.variable.kind !== 'hardBin')) pooled++;
    }
    console.log(`${String(g).padStart(4)}  ${(f * 100).toFixed(0).padStart(3)}%   ${pct(perBin, REPLICATES)}             ${pct(pooled, REPLICATES)}`);
  }
}
