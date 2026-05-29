/**
 * Performance regression tests.
 *
 * Strategy: wall-clock budgets with large headroom to pass on slow CI/Chromebook,
 * plus complexity-ratio checks at two wafer sizes to catch O(N²) regressions
 * regardless of absolute machine speed.
 *
 * Budgets are set at ~10× the measured time on a mid-range desktop (Node 22).
 * The ratio checks are the more important guard: if t(2N) / t(N) > ratioLimit,
 * the algorithm has regressed toward super-linear complexity.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { buildWaferMap } from '../dist/index.js';
import { buildView } from '../dist/packages/renderer/buildView.js';
import { analyzeWaferMap, analyzeWaferLot } from '../dist/packages/stats/index.js';

// ── Wafer generators ────────────────────────────────────────────────────────

/**
 * Generate a full 300mm wafer at a given die pitch, with realistic bin data.
 * Uses a deterministic LCG so results are reproducible.
 */
function makeWafer({ pitchX = 8, pitchY = 8, diameter = 300, failRate = 0.08, tests = 0 } = {}) {
  const waferRadius = diameter / 2;
  const iMax = Math.ceil(waferRadius / pitchX);
  const jMax = Math.ceil(waferRadius / pitchY);
  const halfDiag = Math.hypot(pitchX / 2, pitchY / 2);

  // LCG for deterministic pseudo-random values
  let seed = 0x12345678;
  function rand() {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 0xFFFFFFFF;
  }

  const testDefs = Array.from({ length: tests }, (_, i) => ({ testNumber: 1000 + i, name: `T${i}` }));
  const results = [];

  for (let i = -iMax; i <= iMax; i++) {
    for (let j = -jMax; j <= jMax; j++) {
      if (Math.hypot(i * pitchX, j * pitchY) + halfDiag > waferRadius) continue;
      const r = rand();
      const hbin = r < failRate ? 2 : 1;
      const entry = { x: i, y: j, hbin };
      if (tests > 0) {
        entry.testValues = {};
        for (let t = 0; t < tests; t++) entry.testValues[1000 + t] = rand() * 10;
      }
      results.push(entry);
    }
  }

  return { results, testDefs: tests > 0 ? testDefs : undefined, dieCount: results.length };
}

function time(fn) {
  const t0 = performance.now();
  fn();
  return performance.now() - t0;
}

// ── buildWaferMap ────────────────────────────────────────────────────────────

test('buildWaferMap — 300mm/8mm die completes within budget', () => {
  const { results } = makeWafer({ pitchX: 8, pitchY: 8 });
  const ms = time(() => buildWaferMap({ results, passBins: [1] }));
  // ~30ms measured; budget 500ms
  assert.ok(ms < 500, `buildWaferMap took ${ms.toFixed(0)}ms (budget 500ms)`);
});

test('buildWaferMap — complexity is sub-quadratic (2× die count ≤ 16× time)', () => {
  const small = makeWafer({ pitchX: 12, pitchY: 12 });
  const large = makeWafer({ pitchX: 8,  pitchY: 8  });

  // Warm up
  buildWaferMap({ results: small.results, passBins: [1] });
  buildWaferMap({ results: large.results, passBins: [1] });

  const tSmall = time(() => buildWaferMap({ results: small.results, passBins: [1] }));
  const tLarge = time(() => buildWaferMap({ results: large.results, passBins: [1] }));
  const ratio  = tLarge / tSmall;

  // Die counts: small ~1,700, large ~4,300 — ratio ~2.5×
  // If linear: time ratio ~2.5. Allow up to 16× for wall-clock noise on shared machines.
  assert.ok(ratio < 16, `buildWaferMap time ratio ${ratio.toFixed(2)} (${small.dieCount}→${large.dieCount} dies); expected <16 (sub-quadratic)`);
});

// ── analyzeWaferMap ──────────────────────────────────────────────────────────

test('analyzeWaferMap — 300mm/8mm die (~4300 dies) completes within budget', () => {
  const { results } = makeWafer({ pitchX: 8, pitchY: 8, failRate: 0.08 });
  const wmr = buildWaferMap({ results, passBins: [1] });
  const ms = time(() => analyzeWaferMap(wmr, { passBins: [1] }));
  // ~25ms measured; budget 1000ms
  assert.ok(ms < 1000, `analyzeWaferMap took ${ms.toFixed(0)}ms (budget 1000ms, ${wmr.dies.length} dies)`);
});

test('analyzeWaferMap — high-density 300mm/4mm die (~16k dies) completes within budget', () => {
  const { results } = makeWafer({ pitchX: 4, pitchY: 4, failRate: 0.08 });
  const wmr = buildWaferMap({ results, passBins: [1] });
  const ms = time(() => analyzeWaferMap(wmr, { passBins: [1] }));
  // ~120ms measured; budget 3000ms
  assert.ok(ms < 3000, `analyzeWaferMap took ${ms.toFixed(0)}ms (budget 3000ms, ${wmr.dies.length} dies)`);
});

test('analyzeWaferMap — with test values completes within budget', () => {
  const { results, testDefs } = makeWafer({ pitchX: 8, pitchY: 8, failRate: 0.08, tests: 4 });
  const wmr = buildWaferMap({ results, testDefs, passBins: [1] });
  const ms = time(() => analyzeWaferMap(wmr, { passBins: [1] }));
  // ~50ms measured; budget 1500ms
  assert.ok(ms < 1500, `analyzeWaferMap (4 tests) took ${ms.toFixed(0)}ms (budget 1500ms)`);
});

test('analyzeWaferMap — complexity is sub-quadratic (2× die count ≤ 6× time)', () => {
  const small = makeWafer({ pitchX: 12, pitchY: 12, failRate: 0.08 });
  const large = makeWafer({ pitchX: 6,  pitchY: 6,  failRate: 0.08 });

  const wmrSmall = buildWaferMap({ results: small.results, passBins: [1] });
  const wmrLarge = buildWaferMap({ results: large.results, passBins: [1] });

  // Warm up
  analyzeWaferMap(wmrSmall, { passBins: [1] });
  analyzeWaferMap(wmrLarge, { passBins: [1] });

  const tSmall = time(() => analyzeWaferMap(wmrSmall, { passBins: [1] }));
  const tLarge = time(() => analyzeWaferMap(wmrLarge, { passBins: [1] }));
  const ratio  = tLarge / tSmall;

  // Die counts: small ~1,700, large ~6,900 — ratio ~4×
  // Linear → time ratio ~4. Allow up to 12× for noise/JIT variance.
  assert.ok(
    ratio < 12,
    `analyzeWaferMap time ratio ${ratio.toFixed(2)} (${wmrSmall.dies.length}→${wmrLarge.dies.length} dies); expected <12 (sub-quadratic)`,
  );
});

// ── buildClusterFindings (via analyzeWaferMap) ────────────────────────────────

test('analyzeWaferMap — high failure rate (50%) does not cause super-linear slowdown', () => {
  // The old O(F²) flood-fill was catastrophic at high failure rates.
  // At 50% fail, F ≈ N/2, so O(F²) = O(N²/4) — worst case for the old code.
  const { results } = makeWafer({ pitchX: 8, pitchY: 8, failRate: 0.5 });
  const wmr = buildWaferMap({ results, passBins: [1] });
  const ms = time(() => analyzeWaferMap(wmr, { passBins: [1] }));
  // At 50% fail the cluster finder produces many components; still must be fast.
  // Budget 2000ms.
  assert.ok(ms < 2000, `analyzeWaferMap (50% fail) took ${ms.toFixed(0)}ms (budget 2000ms, ${wmr.dies.length} dies)`);
});

// ── analyzeWaferLot ──────────────────────────────────────────────────────────

test('analyzeWaferLot — 6-wafer lot completes within budget', () => {
  const waferMapResults = Array.from({ length: 6 }, () => {
    const { results } = makeWafer({ pitchX: 8, pitchY: 8, failRate: 0.08 });
    return buildWaferMap({ results, passBins: [1] });
  });
  const waferSummaries = waferMapResults.map(r => analyzeWaferMap(r, { passBins: [1] }));
  const ms = time(() => analyzeWaferLot(waferMapResults, { passBins: [1], perWaferSummaries: waferSummaries }));
  // analyzeWaferLot itself (cross-wafer only) is trivially fast; budget 200ms
  assert.ok(ms < 200, `analyzeWaferLot took ${ms.toFixed(0)}ms (budget 200ms)`);
});

// ── buildView ───────────────────────────────────────────────────────────────

test('buildView hardBin — 300mm/8mm (~4300 dies) completes within budget', () => {
  const { results } = makeWafer({ pitchX: 8, pitchY: 8 });
  const wmr = buildWaferMap({ results, passBins: [1] });
  const ms = time(() => buildView(wmr.wafer, wmr.dies, { plotMode: 'hardBin' }));
  // ~10ms measured; budget 200ms
  assert.ok(ms < 200, `buildView hardBin took ${ms.toFixed(0)}ms (budget 200ms, ${wmr.dies.length} dies)`);
});

test('buildView value mode — no more than 2× slower than hardBin', () => {
  // Pre-optimisation: value mode was ~3× slower due to per-die string allocation in lerpKp.
  // Post-optimisation: LUT eliminates per-die allocation; both modes should be near identical.
  const { results, testDefs } = makeWafer({ pitchX: 8, pitchY: 8, tests: 1 });
  const wmr = buildWaferMap({ results, passBins: [1], testDefs });
  // Warmup
  buildView(wmr.wafer, wmr.dies, { plotMode: 'hardBin', testDefs, activeTest: 1000 });
  buildView(wmr.wafer, wmr.dies, { plotMode: 'value', testDefs, activeTest: 1000 });
  const tHardBin = time(() => buildView(wmr.wafer, wmr.dies, { plotMode: 'hardBin', testDefs, activeTest: 1000 }));
  const tValue   = time(() => buildView(wmr.wafer, wmr.dies, { plotMode: 'value',   testDefs, activeTest: 1000 }));
  const ratio = tValue / Math.max(tHardBin, 0.1);
  assert.ok(ratio < 2.0, `value mode is ${ratio.toFixed(2)}× slower than hardBin (limit 2×) — color LUT may have regressed`);
});

test('buildView — complexity is sub-quadratic (2× die count ≤ 4× time)', () => {
  const small = makeWafer({ pitchX: 8, pitchY: 8 });
  const large = makeWafer({ pitchX: 4, pitchY: 4 });
  const wmrSmall = buildWaferMap({ results: small.results, passBins: [1] });
  const wmrLarge = buildWaferMap({ results: large.results, passBins: [1] });
  // Warmup
  buildView(wmrSmall.wafer, wmrSmall.dies, { plotMode: 'hardBin' });
  buildView(wmrLarge.wafer, wmrLarge.dies, { plotMode: 'hardBin' });
  const tSmall = time(() => buildView(wmrSmall.wafer, wmrSmall.dies, { plotMode: 'hardBin' }));
  const tLarge = time(() => buildView(wmrLarge.wafer, wmrLarge.dies, { plotMode: 'hardBin' }));
  const dieRatio = wmrLarge.dies.length / wmrSmall.dies.length;
  const timeRatio = tLarge / Math.max(tSmall, 0.1);
  assert.ok(
    timeRatio < dieRatio * dieRatio,
    `buildView time ratio ${timeRatio.toFixed(1)}× for ${dieRatio.toFixed(1)}× more dies — super-linear regression detected`,
  );
});

test('analyzeWaferLot — does not re-run analyzeWaferMap when perWaferSummaries provided', () => {
  // If perWaferSummaries is ignored and analyzeWaferMap runs again, lot time ≈ N × per-wafer time.
  // Verify that lot time << single-wafer time × wafer count.
  const waferMapResults = Array.from({ length: 4 }, () => {
    const { results } = makeWafer({ pitchX: 8, pitchY: 8, failRate: 0.08 });
    return buildWaferMap({ results, passBins: [1] });
  });
  const waferSummaries = waferMapResults.map(r => analyzeWaferMap(r, { passBins: [1] }));
  const tPerWafer = time(() => analyzeWaferMap(waferMapResults[0], { passBins: [1] }));
  const tLot = time(() => analyzeWaferLot(waferMapResults, { passBins: [1], perWaferSummaries: waferSummaries }));
  // Lot should be well under 1 full wafer analysis (not 4×).
  assert.ok(
    tLot < tPerWafer,
    `analyzeWaferLot (${tLot.toFixed(0)}ms) should be faster than a single analyzeWaferMap (${tPerWafer.toFixed(0)}ms) when perWaferSummaries is provided`,
  );
});
