/**
 * Multi-bin cluster recall benchmark.
 *
 * One spot of one bin, planted at a random place on a 40×40 wafer whose other failures are random in
 * other bins (and, in half the runs, an edge ring of another bin), across background fail rates, spot
 * densities and spot sizes. A spot counts as located when a cluster finding holds at least half its dies
 * and is no more than three times its size. "pooled" is the clusters and arcs of every fail bin together,
 * "per-bin" the clusters of one bin, "either" what the analysis reports.
 *
 * Usage: node scripts/run-benchmark-multibin-recall.mjs   (REPS=n for wafers a cell, default 100)
 */
import { buildWaferMap } from '../dist/index.js';
import { analyzeWaferMap } from '../dist/packages/stats/analyzeWaferMap.js';

const REPS = Number(process.env.REPS ?? 100);
const G = 40, DIAMETER = 300;
const BACKGROUNDS = [0.05, 0.10, 0.20, 0.30];
const DENSITIES = [0.4, 0.6, 0.9];
const RADII = [1.5, 2.5, 3.5];

function mulberry32(seed) {
  return function () {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

function wafer(rng, bg, density, radius, edgeRing) {
  const c = Math.floor(G / 2), r = G / 2;
  // Spot centre anywhere inside 85% of the radius.
  let sx, sy;
  do { sx = (rng() * 2 - 1) * r * 0.85; sy = (rng() * 2 - 1) * r * 0.85; } while (Math.hypot(sx, sy) > r * 0.85);
  const out = [], spot = new Set();
  for (let row = 0; row < G; row++) for (let col = 0; col < G; col++) {
    const x = col - c, y = c - row, rr = Math.hypot(x, y);
    if (rr > r - 0.5) continue;
    let hbin = 1;
    if (edgeRing && rr > r * 0.85 && rng() < 0.5) hbin = 3;
    else if (Math.hypot(x - sx, y - sy) < radius && rng() < density) { hbin = 4; spot.add(`${x},${y}`); }
    else if (rng() < bg) { const u = rng(); hbin = u < 0.6 ? 2 : u < 0.9 ? 5 : 4; }   // bin 4 also fails at random, thinly
    out.push({ x, y, hbin });
  }
  return { results: out, spot };
}

function located(findings, spot, perBin) {
  return findings.some(f => {
    if (f.comparison.family !== 'cluster' && f.comparison.family !== 'edge-arc') return false;
    if ((f.variable.kind === 'hardBin') !== perBin) return false;
    const keys = f.highlight.dieKeys ?? [];
    const inside = keys.filter(k => spot.has(k)).length;
    return inside >= 0.5 * spot.size && keys.length <= 3 * spot.size;
  });
}

console.log(`edge  bg    dens  rad   spot   pooled  per-bin  either   (${REPS} wafers a cell, ${G}x${G})`);
for (const edgeRing of [false, true]) for (const bg of BACKGROUNDS) for (const d of DENSITIES) for (const rad of RADII) {
  const rng = mulberry32(Math.round(bg * 1e4) * 31 + Math.round(d * 100) * 7 + Math.round(rad * 10) + (edgeRing ? 99991 : 0));
  let p = 0, b = 0, e = 0, spotSize = 0, n = 0;
  for (let i = 0; i < REPS; i++) {
    const { results, spot } = wafer(rng, bg, d, rad, edgeRing);
    if (spot.size < 3) continue;
    n++; spotSize += spot.size;
    const s = analyzeWaferMap(buildWaferMap({ results, waferConfig: { diameter: DIAMETER }, dieConfig: { width: DIAMETER / G, height: DIAMETER / G } }), { enableTestValueAnalysis: false });
    const lp = located(s.findings, spot, false), lb = located(s.findings, spot, true);
    p += lp; b += lb; e += lp || lb;
  }
  const pc = (k) => `${(k / n * 100).toFixed(0).padStart(4)}%`;
  console.log(`${edgeRing ? 'yes' : 'no '}  ${(bg * 100).toFixed(0).padStart(3)}%  ${d.toFixed(1)}  ${rad.toFixed(1)}  ${(spotSize / n).toFixed(0).padStart(5)}  ${pc(p)}   ${pc(b)}   ${pc(e)}`);
}
