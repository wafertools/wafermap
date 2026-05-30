// End-to-end comparison: main thread vs Web Worker, for the build+analyze flow.
//
// Uses Node worker_threads, which serializes messages with the SAME structured
// clone algorithm as browser postMessage — so the relative cost is representative
// (absolute ms will differ from a browser, but the crossover point holds).
//
// Run: node scripts/bench-worker-vs-main.mjs [gridRadius] [waferCount]

import { Worker, isMainThread, parentPort } from 'node:worker_threads';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { buildWaferMap } from '../dist/packages/renderer/buildWaferMap.js';
import { analyzeWaferMap, analyzeWaferLot } from '../dist/packages/stats/index.js';

// ── Worker side: mirror what packages/worker does, over worker_threads ─────────
if (!isMainThread) {
  parentPort.on('message', (msg) => {
    if (msg.type === 'runWithAnalysis') {
      const results = msg.inputs.map(i => buildWaferMap(i));
      const waferSummaries = results.map(r => analyzeWaferMap(r, msg.options));
      const lotSummary = msg.hasMultiWafer
        ? analyzeWaferLot(results, { ...msg.options, perWaferSummaries: waferSummaries })
        : null;
      parentPort.postMessage({ type: 'done', results, waferSummaries, lotSummary });
    } else if (msg.type === 'run') {
      // old pattern: build only, ship result out
      const results = msg.inputs.map(i => buildWaferMap(i));
      parentPort.postMessage({ type: 'built', results });
    } else if (msg.type === 'analyze') {
      // old pattern part 2: result clone IN, summaries out
      const waferSummaries = msg.results.map(r => analyzeWaferMap(r, msg.options));
      const lotSummary = msg.hasMultiWafer
        ? analyzeWaferLot(msg.results, { ...msg.options, perWaferSummaries: waferSummaries })
        : null;
      parentPort.postMessage({ type: 'analyzed', waferSummaries, lotSummary });
    }
  });
} else {
  // ── Main side ──────────────────────────────────────────────────────────────
  const R = Number(process.argv[2] ?? 80);
  const N = Number(process.argv[3] ?? 1);

  function makeInputs(radius, count) {
    const inputs = [];
    for (let w = 0; w < count; w++) {
      const results = [];
      for (let x = -radius; x <= radius; x++) {
        for (let y = -radius; y <= radius; y++) {
          if (x * x + y * y > radius * radius) continue;
          const r = Math.sqrt(x * x + y * y) / radius;
          const fail = r > 0.85 && Math.random() < 0.4;
          results.push({
            x, y,
            hbin: fail ? 4 : 1, sbin: fail ? 40 : 1,
            testValues: { 1050: 1 - r * 0.2, 1060: r * 8, 1070: 1e-9 },
          });
        }
      }
      inputs.push({ results, dieConfig: { width: 8, height: 8 } });
    }
    return inputs;
  }

  const inputs = makeInputs(R, N);
  const options = { passBins: [1] };
  const hasMultiWafer = N > 1;
  const dieCount = inputs[0].results.length;
  console.log(`grid radius ${R} · ${N} wafer(s) · ${dieCount} dies each\n`);

  const median = (xs) => { xs.sort((a, b) => a - b); return xs[Math.floor(xs.length / 2)]; };

  // ── A. Main thread: build + analyze, zero copy ─────────────────────────────
  function mainThreadOnce() {
    const t0 = performance.now();
    const results = inputs.map(i => buildWaferMap(i));
    const waferSummaries = results.map(r => analyzeWaferMap(r, options));
    if (hasMultiWafer) analyzeWaferLot(results, { ...options, perWaferSummaries: waferSummaries });
    return performance.now() - t0;
  }

  const self = fileURLToPath(import.meta.url);
  const worker = new Worker(self);
  const rpc = (msg) => new Promise((resolve) => {
    const t0 = performance.now();
    worker.once('message', (m) => resolve({ ms: performance.now() - t0, m }));
    worker.postMessage(msg);
  });

  // ── B. Worker, combined runWithAnalysis (1 result crossing) ────────────────
  async function workerCombinedOnce() {
    const { ms } = await rpc({ type: 'runWithAnalysis', inputs, options, hasMultiWafer });
    return ms;
  }

  // ── C. Worker, old run + runAnalysis (result crosses 3×) ───────────────────
  async function workerSplitOnce() {
    const t0 = performance.now();
    const built = await rpc({ type: 'run', inputs });          // result clone OUT
    await rpc({ type: 'analyze', results: built.m.results, options, hasMultiWafer }); // clone IN, summaries OUT
    return performance.now() - t0;
  }

  const ITERS = 5;
  // warm up each path
  mainThreadOnce(); await workerCombinedOnce(); await workerSplitOnce();

  const mainSamples = [], combSamples = [], splitSamples = [];
  for (let i = 0; i < ITERS; i++) mainSamples.push(mainThreadOnce());
  for (let i = 0; i < ITERS; i++) combSamples.push(await workerCombinedOnce());
  for (let i = 0; i < ITERS; i++) splitSamples.push(await workerSplitOnce());

  const main = median(mainSamples);
  const comb = median(combSamples);
  const split = median(splitSamples);

  console.log(`A. main thread (build+analyze, blocks UI)   ${main.toFixed(1)} ms`);
  console.log(`B. worker runWithAnalysis (combined)        ${comb.toFixed(1)} ms`);
  console.log(`C. worker run + runAnalysis (old, 3×)       ${split.toFixed(1)} ms`);
  console.log(`\nworker(combined) vs main:  ${comb > main ? '+' : ''}${(comb - main).toFixed(1)} ms  (${(comb / main).toFixed(2)}× wall-clock)`);
  console.log(`combine saved over old:    ${(split - comb).toFixed(1)} ms`);
  console.log(comb > main
    ? `→ at this size the worker is SLOWER wall-clock; its value is keeping the UI responsive (${main.toFixed(0)}ms of main-thread block avoided).`
    : `→ at this size the worker is also faster wall-clock.`);

  worker.terminate();
}
