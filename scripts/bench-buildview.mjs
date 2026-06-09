#!/usr/bin/env node
// Benchmark for buildView and getDieAtPoint — the two areas changed by Tier 1 fixes.
// Run: node scripts/bench-buildview.mjs [gridRadius] [nTests]
//
// gridRadius: prober step radius (default 80 → ~20k dies)
// nTests:     parametric tests per die (default 100)

import { performance } from 'node:perf_hooks';
import { buildWaferMap } from '../dist/packages/renderer/buildWaferMap.js';
import { buildView } from '../dist/packages/renderer/buildView.js';

const R      = Number(process.argv[2] ?? 80);
const N_TEST = Number(process.argv[3] ?? 100);
const ITERS  = 20;

// ── Synthetic data ────────────────────────────────────────────────────────────
function makeResults(radius, nTests) {
  const results = [];
  const testKeys = Array.from({ length: nTests }, (_, i) => 1000 + i + 1);
  for (let x = -radius; x <= radius; x++) {
    for (let y = -radius; y <= radius; y++) {
      if (x * x + y * y > radius * radius) continue;
      const r = Math.sqrt(x * x + y * y) / radius;
      const testValues = {};
      for (const k of testKeys) testValues[k] = 0.5 + r * 0.3 + (Math.random() - 0.5) * 0.05;
      results.push({ x, y, hbin: r > 0.85 ? 4 : 1, sbin: r > 0.85 ? 40 : 1, testValues });
    }
  }
  return results;
}

const results = makeResults(R, N_TEST);
const waferMap = buildWaferMap({ results, dieConfig: { width: 8, height: 8 } });
const { wafer, dies } = waferMap;
const firstTest = Number(Object.keys(results[0].testValues)[0]);
const dieCount = dies.length;

console.log(`grid radius ${R} · ${dieCount} dies · ${N_TEST} tests\n`);

const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
const fmt = (ms) => `${ms.toFixed(2)} ms`;

// ── 1. buildView — value mode (exercises min/max scan) ────────────────────────
{
  const times = [];
  for (let i = 0; i < ITERS; i++) {
    const t0 = performance.now();
    buildView(wafer, dies, { plotMode: 'value', activeTest: firstTest });
    times.push(performance.now() - t0);
  }
  console.log(`buildView value mode:       ${fmt(median(times))}  (${ITERS} iters)`);
}

// ── 2. buildView — value mode with rotation (exercises Float64Array tx) ───────
{
  const times = [];
  for (let i = 0; i < ITERS; i++) {
    const t0 = performance.now();
    buildView(wafer, dies, {
      plotMode: 'value', activeTest: firstTest,
      interactiveTransform: { rotation: 90, flipX: false, flipY: false },
    });
    times.push(performance.now() - t0);
  }
  console.log(`buildView value+rotate90°:  ${fmt(median(times))}  (${ITERS} iters)`);
}

// ── 3. buildView — hardBin mode (exercises merged bin-count loop) ─────────────
{
  const times = [];
  for (let i = 0; i < ITERS; i++) {
    const t0 = performance.now();
    buildView(wafer, dies, { plotMode: 'hardBin' });
    times.push(performance.now() - t0);
  }
  console.log(`buildView hardBin mode:     ${fmt(median(times))}  (${ITERS} iters)`);
}

// ── 4. getDieAtPoint — spatial index vs old linear scan ──────────────────────
//    We build a view, extract the hit target, then probe 1000 random points.
{
  // Dynamic import of toCanvas is browser-only (canvas API); simulate getDieAtPoint
  // using the spatial index logic directly from the built view.
  // Instead, time a proxy: findDie by linear scan vs the index via a simple harness.
  const view = buildView(wafer, dies, { plotMode: 'value', activeTest: firstTest });
  const pts  = view.hoverPoints;
  const rects = view.rectangles;

  // Probe points: mix of on-die and gap hits
  const probes = Array.from({ length: 1000 }, (_, i) => {
    const p = pts[Math.floor(Math.random() * pts.length)];
    return { x: p.x + (Math.random() - 0.5) * 2, y: p.y + (Math.random() - 0.5) * 2 };
  });

  // Old: full linear scan (simulating pre-fix getDieAtPoint exact pass)
  {
    const times = [];
    for (let iter = 0; iter < 10; iter++) {
      const t0 = performance.now();
      for (const { x, y } of probes) {
        for (let i = 0; i < rects.length; i++) {
          const r = rects[i];
          if (Math.abs(x - r.x) <= r.width / 2 && Math.abs(y - r.y) <= r.height / 2) break;
        }
      }
      times.push(performance.now() - t0);
    }
    console.log(`getDieAtPoint linear scan:  ${fmt(median(times))}  per 1000 probes (10 iters)`);
  }

  // New: uniform grid index
  {
    const rectW = rects[0]?.width  ?? 1;
    const rectH = rects[0]?.height ?? 1;
    const cellW = rectW * 1.5;
    const cellH = rectH * 1.5;
    const db = view.dieBounds;
    const minX = db ? db.minX : Math.min(...pts.map(p => p.x));
    const minY = db ? db.minY : Math.min(...pts.map(p => p.y));
    const maxX = db ? db.maxX : Math.max(...pts.map(p => p.x));
    const maxY = db ? db.maxY : Math.max(...pts.map(p => p.y));
    const nCols = Math.max(1, Math.ceil((maxX - minX) / cellW) + 1);
    const nRows = Math.max(1, Math.ceil((maxY - minY) / cellH) + 1);
    const gridCells = Array.from({ length: nCols * nRows }, () => []);
    for (let i = 0; i < pts.length; i++) {
      const col = Math.max(0, Math.min(nCols - 1, Math.floor((pts[i].x - minX) / cellW)));
      const row = Math.max(0, Math.min(nRows - 1, Math.floor((pts[i].y - minY) / cellH)));
      gridCells[row * nCols + col].push(i);
    }

    // Build time
    let buildMs;
    {
      const t0 = performance.now();
      for (let iter = 0; iter < 100; iter++) {
        const gc2 = Array.from({ length: nCols * nRows }, () => []);
        for (let i = 0; i < pts.length; i++) {
          const col = Math.max(0, Math.min(nCols - 1, Math.floor((pts[i].x - minX) / cellW)));
          const row = Math.max(0, Math.min(nRows - 1, Math.floor((pts[i].y - minY) / cellH)));
          gc2[row * nCols + col].push(i);
        }
      }
      buildMs = (performance.now() - t0) / 100;
    }

    const times = [];
    for (let iter = 0; iter < 10; iter++) {
      const t0 = performance.now();
      for (const { x, y } of probes) {
        const c0 = Math.max(0, Math.floor((x - rectW - minX) / cellW));
        const c1 = Math.min(nCols - 1, Math.floor((x + rectW - minX) / cellW));
        const r0 = Math.max(0, Math.floor((y - rectH - minY) / cellH));
        const r1 = Math.min(nRows - 1, Math.floor((y + rectH - minY) / cellH));
        outer: for (let rr = r0; rr <= r1; rr++) {
          for (let cc = c0; cc <= c1; cc++) {
            for (const i of gridCells[rr * nCols + cc]) {
              const r = rects[i];
              if (r && Math.abs(x - r.x) <= r.width / 2 && Math.abs(y - r.y) <= r.height / 2) break outer;
            }
          }
        }
      }
      times.push(performance.now() - t0);
    }
    console.log(`getDieAtPoint grid index:   ${fmt(median(times))}  per 1000 probes (10 iters)  [index build: ${fmt(buildMs)}]`);
  }
}
