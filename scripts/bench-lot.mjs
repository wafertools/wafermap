#!/usr/bin/env node
// Lot-scale baseline: where time and heap go when a host builds, analyses and
// views a whole lot. Run with the GC exposed so heap figures are settled:
//
//   node --expose-gc --max-old-space-size=8192 scripts/bench-lot.mjs [wafers] [gridRadius] [tests]
//
// Defaults: 25 wafers × radius 56 (~9.9k dies each, ~247k total) × 50 tests —
// the ordinary production sweep the web build cannot open today.
//
// Heap is Node's, not a browser's: good for comparing two wmap builds on one
// machine, not for predicting where a browser tab fails.

import { performance } from 'node:perf_hooks';
import { buildWaferMap, analyzeWaferMap, analyzeWaferLot } from '../dist/index.js';
import { buildView } from '../dist/packages/renderer/buildView.js';

const WAFERS = Number(process.argv[2] ?? 25);
const R      = Number(process.argv[3] ?? 56);
const TESTS  = Number(process.argv[4] ?? 50);

const gc = globalThis.gc ?? (() => {});
const heapMB = () => { gc(); gc(); return process.memoryUsage().heapUsed / 2 ** 20; };

// Seeded, so two builds see identical data.
let seed = 12345;
const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);

const testDefs = Array.from({ length: TESTS }, (_, i) => ({
  testNumber: 1001 + i, name: `T${i}`, limitLow: 0.4, limitHigh: 0.9,
}));

function makeWafer(w) {
  const results = [];
  for (let x = -R; x <= R; x++) for (let y = -R; y <= R; y++) {
    if (x * x + y * y > R * R) continue;
    const r = Math.sqrt(x * x + y * y) / R;
    const testValues = {};
    for (const d of testDefs) testValues[d.testNumber] = 0.5 + r * 0.3 + (rand() - 0.5) * 0.1 + w * 0.001;
    const fail = rand() < 0.05 + (r > 0.9 ? 0.3 : 0);
    results.push({ x, y, hbin: fail ? 2 + Math.floor(rand() * 6) : 1, sbin: fail ? 20 + Math.floor(rand() * 10) : 1, testValues });
  }
  return results;
}

const time = (label, f) => {
  const t0 = performance.now();
  const out = f();
  const ms = performance.now() - t0;
  console.log(`${label.padEnd(34)} ${ms.toFixed(0).padStart(7)} ms`);
  return out;
};

const h0 = heapMB();
const lot = time('generate input', () => Array.from({ length: WAFERS }, (_, w) => makeWafer(w)));
const dieCount = lot.reduce((n, w) => n + w.length, 0);
const h1 = heapMB();
console.log(`${WAFERS} wafers · ${dieCount} dies · ${TESTS} tests\n`);

const maps = time('buildWaferMap × wafers', () =>
  lot.map(results => buildWaferMap({ results, testDefs, dieConfig: { width: 5, height: 5 } })));
const h2 = heapMB();

time('analyzeWaferMap × wafers', () => maps.map(m => analyzeWaferMap(m)));
time('analyzeWaferLot', () => analyzeWaferLot(maps));
time('buildView value × wafers', () =>
  maps.map(m => buildView(m.wafer, m.dies, { plotMode: 'value', activeTest: 1001, testDefs, passBins: m.passBins })));
time('buildView hardBin × wafers', () =>
  maps.map(m => buildView(m.wafer, m.dies, { plotMode: 'hardBin', testDefs, passBins: m.passBins })));

console.log(`\nheap: input ${(h1 - h0).toFixed(0)} MB (${((h1 - h0) * 2 ** 20 / dieCount).toFixed(0)} B/die)` +
  ` · maps on top ${(h2 - h1).toFixed(0)} MB (${((h2 - h1) * 2 ** 20 / dieCount).toFixed(0)} B/die)`);

// Keep everything live until after the heap reading.
if (maps.length !== WAFERS || lot.length !== WAFERS) throw new Error('unreachable');
