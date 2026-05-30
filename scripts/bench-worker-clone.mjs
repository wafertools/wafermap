// Benchmark: is the worker slow because of buildWaferMap compute, or because of
// structured-clone serialization of the WaferMapResult across postMessage?
//
// Run: node scripts/bench-worker-clone.mjs [gridRadius]
// gridRadius controls die count (~ pi * r^2). Default 80 -> ~20k dies.

import { performance } from 'node:perf_hooks';
import v8 from 'node:v8';
import { buildWaferMap } from '../dist/packages/renderer/buildWaferMap.js';

const R = Number(process.argv[2] ?? 80);

// ── Generate a large symmetric dataset (centred grid -> offset 0) ──────────────
function makeResults(radius) {
  const results = [];
  for (let x = -radius; x <= radius; x++) {
    for (let y = -radius; y <= radius; y++) {
      if (x * x + y * y > radius * radius) continue; // inside circle only
      const r = Math.sqrt(x * x + y * y) / radius;
      const fail = r > 0.85 && Math.random() < 0.4;
      results.push({
        x, y,
        hbin: fail ? 4 : 1,
        sbin: fail ? 40 : 1,
        testValues: { 1050: 1 - r * 0.2 + Math.random() * 0.05, 1060: r * 8, 1070: 1e-9 * (1 + r) },
      });
    }
  }
  return results;
}

const results = makeResults(R);
const input = { results, dieConfig: { width: 8, height: 8 } };
console.log(`die count: ${results.length}`);

// ── 1. buildWaferMap compute (what the worker actually computes) ───────────────
function timeit(label, fn, iters = 5) {
  fn(); // warm up
  const samples = [];
  for (let i = 0; i < iters; i++) {
    const t0 = performance.now();
    fn();
    samples.push(performance.now() - t0);
  }
  samples.sort((a, b) => a - b);
  const median = samples[Math.floor(samples.length / 2)];
  console.log(`${label.padEnd(38)} ${median.toFixed(1)} ms (median of ${iters})`);
  return median;
}

const result = buildWaferMap(input);

const compute = timeit('buildWaferMap (compute, by-ref)', () => buildWaferMap(input));

// ── 2. structured clone of the full WaferMapResult (1 boundary crossing) ───────
// postMessage serializes on the sender AND deserializes on the receiver.
// structuredClone() does both halves in one call -> models one crossing.
const cloneFull = timeit('structuredClone(result)  [1 crossing]', () => structuredClone(result));
// One postMessage crossing = serialize on sender + deserialize on receiver = a full clone.
const roundTripHalf = cloneFull;

// ── 3. v8.serialize size + the cost split (serialize vs deserialize) ───────────
const buf = v8.serialize(result);
const serOnly = timeit('v8.serialize(result)   [send half]', () => v8.serialize(result));
const deserOnly = timeit('v8.deserialize(buf)    [recv half]', () => v8.deserialize(buf));
console.log(`serialized payload size                ${(buf.length / 1024 / 1024).toFixed(2)} MB`);

// ── 4. what the duplication costs: result.dies vs result.view.dies vs rectangles
const dieCount = result.dies.length;
const viewDieCount = result.view.dies.length;
const rectCount = result.view.rectangles.length;
const hoverCount = result.view.hoverPoints.length;
console.log(`\npayload contains die data N times:`);
console.log(`  result.dies          = ${dieCount}`);
console.log(`  result.view.dies     = ${viewDieCount}  (duplicate of result.dies)`);
console.log(`  result.view.rectangles = ${rectCount}`);
console.log(`  result.view.hoverPoints = ${hoverCount}`);

// Clone with view.dies stripped, to see what removing the duplicate saves.
const stripped = { ...result, view: { ...result.view, dies: [] } };
const bufStripped = v8.serialize(stripped);
const cloneStripped = timeit('structuredClone(result w/o view.dies)', () => structuredClone(stripped));
console.log(`stripped payload size                  ${(bufStripped.length / 1024 / 1024).toFixed(2)} MB`);

// ── 5. run + runAnalysis (old) vs runWithAnalysis (new) clone accounting ───────
// Model the structured-clone crossings each pattern pays for the BIG result.
// input clone is the same for both; we focus on the result object crossings.
//
// OLD: run() -> result clone OUT (1) ; runAnalysis(results) -> result clone IN (2)
//      worker analyzes ; summaries clone OUT (tiny, ignore)
//      => 2 full result crossings
// NEW: runWithAnalysis() -> result clone OUT (1) only ; summaries OUT (tiny)
//      => 1 full result crossing
console.log(`\n── run+runAnalysis  vs  runWithAnalysis ─────────────`);
console.log(`OLD result crossings: 2 × ${roundTripHalf.toFixed(0)}ms ≈ ${(2*roundTripHalf).toFixed(0)} ms of clone`);
console.log(`NEW result crossings: 1 × ${roundTripHalf.toFixed(0)}ms ≈ ${roundTripHalf.toFixed(0)} ms of clone`);
console.log(`saving from combine:  ≈ ${roundTripHalf.toFixed(0)} ms (one full result crossing removed)`);

// ── Verdict ────────────────────────────────────────────────────────────────
const roundTrip = cloneFull; // ~ both halves of one postMessage
console.log(`\n── summary ──────────────────────────────────────────`);
console.log(`compute (main thread, zero copy):  ${compute.toFixed(1)} ms`);
console.log(`clone cost per crossing:           ${roundTrip.toFixed(1)} ms`);
console.log(`worker total ≈ compute + 2 crossings (in+out) for run():`);
console.log(`   ≈ ${compute.toFixed(1)} + 2×(input clone) + ${roundTrip.toFixed(1)} (result)`);
console.log(`clone / compute ratio:             ${(roundTrip / compute).toFixed(1)}×`);
console.log(`removing view.dies duplicate saves: ${(cloneFull - cloneStripped).toFixed(1)} ms/crossing (${(100*(buf.length-bufStripped.length)/buf.length).toFixed(0)}% smaller)`);
