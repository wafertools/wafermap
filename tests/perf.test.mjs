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
import { buildCapabilityData } from '../dist/packages/stats/capability.js';
import { buildTestBoxplotData } from '../dist/packages/stats/boxplot.js';
import { buildCorrelationMatrix } from '../dist/packages/stats/correlation.js';
import { buildScatterData, buildScatterDataGrouped } from '../dist/packages/stats/scatter.js';
import { buildTestHistogramData } from '../dist/packages/stats/histogram.js';
import { buildYieldData, buildYieldDataCombined } from '../dist/packages/stats/yield.js';
import { buildBinParetoData } from '../dist/packages/stats/binPareto.js';

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

/**
 * Median wall-clock time of `fn` over `n` runs. A single timed call at
 * sub-millisecond scale is dominated by timer jitter; the median over many
 * runs is stable enough to compare two code paths without flaking.
 */
function median(fn, n = 41) {
  const samples = new Array(n);
  for (let i = 0; i < n; i++) samples[i] = time(fn);
  samples.sort((a, b) => a - b);
  return samples[(n - 1) >> 1];
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
  // High-density wafer so each build is comfortably above timer resolution —
  // a 1-test wafer builds in sub-millisecond time, making a single-shot ratio
  // pure jitter. Median over many runs makes the comparison deterministic.
  const { results, testDefs } = makeWafer({ pitchX: 4, pitchY: 4, tests: 1 });
  const wmr = buildWaferMap({ results, passBins: [1], testDefs });
  const buildHardBin = () => buildView(wmr.wafer, wmr.dies, { plotMode: 'hardBin', testDefs, activeTest: 1000 });
  const buildValue   = () => buildView(wmr.wafer, wmr.dies, { plotMode: 'value',   testDefs, activeTest: 1000 });
  // Warmup
  buildHardBin();
  buildValue();
  const tHardBin = median(buildHardBin);
  const tValue   = median(buildValue);
  // Floor the denominator at a real measured magnitude (not 0.1) so a tiny
  // hardBin median can't manufacture a huge ratio. Limit loosened to 2.5× to
  // absorb residual JIT/GC variance while still catching a per-die-allocation
  // regression (pre-LUT value mode was ~3×).
  const ratio = tValue / Math.max(tHardBin, 0.5);
  assert.ok(ratio < 2.5, `value mode median is ${ratio.toFixed(2)}× slower than hardBin (limit 2.5×, hardBin=${tHardBin.toFixed(2)}ms value=${tValue.toFixed(2)}ms) — color LUT may have regressed`);
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

// ── Analysis tab: chart-data builders (packages/stats/*) ────────────────────
// No prior coverage existed for this layer — added alongside the Analysis
// tab feature. Same budget methodology as above (~10× a measured mid-range
// desktop baseline), on a deliberately large lot (25 wafers, ~4300 dies
// each, 8 parametric tests — the scale a real fab lot + full test program
// can reach, well above what the gallery's own default demo data exercises).

const ANALYSIS_LOT_SIZE = 25;
const ANALYSIS_TEST_DEFS = Array.from({ length: 8 }, (_, i) => ({ testNumber: 1000 + i, name: `T${i}`, limitLow: 0, limitHigh: 10 }));

/** One synthetic wafer with parametric test values on every die, for the chart-data builders above (which all need `testValues`, unlike the plain-hbin generator `makeWafer` above). `pitch` controls die density/count, independent of wafer count — used to vary total value count cheaply for the complexity-ratio test below, without needing many full `buildWaferMap` calls. */
function makeTestValueWafer(seedBase, pitch = 8) {
  const { results } = makeWafer({ pitchX: pitch, pitchY: pitch, failRate: 0.08 });
  let seed = 0x12345678 ^ (seedBase * 7919);
  function rand() { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 0xFFFFFFFF; }
  for (const r of results) {
    r.testValues = {};
    for (const def of ANALYSIS_TEST_DEFS) r.testValues[def.testNumber] = rand() * 10;
  }
  return results;
}

function makeAnalysisLot(waferCount = ANALYSIS_LOT_SIZE, pitch = 8) {
  return Array.from({ length: waferCount }, (_, i) => {
    const wmr = buildWaferMap({ results: makeTestValueWafer(i + 1, pitch), testDefs: ANALYSIS_TEST_DEFS, passBins: [1] });
    return { dies: wmr.dies, label: `W${String(i).padStart(2, '0')}` };
  });
}

// Built once and reused across the tests below — repeatedly constructing a
// full 25-wafer lot (each a real buildWaferMap call) is itself the expensive
// part; the builders being measured are all comfortably faster than that.
const analysisLot = makeAnalysisLot();

test('buildCapabilityData — 25-wafer lot × 8 tests (~4300 dies/wafer) completes within budget', () => {
  buildCapabilityData(analysisLot, ANALYSIS_TEST_DEFS); // warmup
  const ms = median(() => buildCapabilityData(analysisLot, ANALYSIS_TEST_DEFS), 5);
  // ~68ms measured (the heaviest of these builders — dominated by sorting
  // every test's full value set for an exact five-number summary); budget 700ms.
  assert.ok(ms < 700, `buildCapabilityData took ${ms.toFixed(0)}ms (budget 700ms, ${analysisLot.length} items × ${ANALYSIS_TEST_DEFS.length} tests)`);
});

test('buildCapabilityData — complexity is sub-quadratic (2× values per test ≤ 6× time)', () => {
  // Same 3-wafer lot at two die pitches (not two different wafer counts) —
  // varies total values per test the same way analyzeWaferMap's own
  // complexity test above varies die count, without needing many extra
  // buildWaferMap calls just to set up the comparison.
  const small = makeAnalysisLot(3, 12); // sparser: ~1,100 dies/wafer
  const large = makeAnalysisLot(3, 8);  // denser: ~4,300 dies/wafer (~4× the values)
  buildCapabilityData(small, ANALYSIS_TEST_DEFS);
  buildCapabilityData(large, ANALYSIS_TEST_DEFS);
  const tSmall = median(() => buildCapabilityData(small, ANALYSIS_TEST_DEFS), 5);
  const tLarge = median(() => buildCapabilityData(large, ANALYSIS_TEST_DEFS), 5);
  const ratio = tLarge / Math.max(tSmall, 0.1);
  const valueRatio = large.reduce((n, it) => n + it.dies.length, 0) / small.reduce((n, it) => n + it.dies.length, 0);
  // An O(n log n) sort ratio is a bit above the value-count ratio; 6× leaves
  // headroom for noise while still catching an O(n²) regression.
  assert.ok(ratio < 6, `buildCapabilityData time ratio ${ratio.toFixed(2)} for ${valueRatio.toFixed(1)}× more values/test; expected <6 (sub-quadratic)`);
});

test('buildCorrelationMatrix — 25-wafer lot × 8 tests completes within budget', () => {
  const dies = analysisLot.flatMap(it => it.dies);
  buildCorrelationMatrix(dies, ANALYSIS_TEST_DEFS); // warmup
  const ms = median(() => buildCorrelationMatrix(dies, ANALYSIS_TEST_DEFS), 5);
  // ~11ms measured; budget 200ms.
  assert.ok(ms < 200, `buildCorrelationMatrix took ${ms.toFixed(0)}ms (budget 200ms, ${dies.length} dies × ${ANALYSIS_TEST_DEFS.length} tests)`);
});

test('buildTestBoxplotData — 25-wafer lot, one test, completes within budget', () => {
  buildTestBoxplotData(analysisLot, 1000); // warmup
  const ms = median(() => buildTestBoxplotData(analysisLot, 1000));
  // ~5ms measured; budget 100ms.
  assert.ok(ms < 100, `buildTestBoxplotData took ${ms.toFixed(0)}ms (budget 100ms)`);
});

test('buildScatterData / buildScatterDataGrouped — 25-wafer lot, two tests, completes within budget', () => {
  const groups = [{ key: 'A', items: analysisLot.filter((_, i) => i % 2) }, { key: 'B', items: analysisLot.filter((_, i) => !(i % 2)) }];
  buildScatterData(analysisLot, 1000, 1001);
  buildScatterDataGrouped(groups, 1000, 1001);
  const msFlat = median(() => buildScatterData(analysisLot, 1000, 1001));
  const msGrouped = median(() => buildScatterDataGrouped(groups, 1000, 1001));
  // ~1.6ms / ~2.9ms measured; budget 100ms each.
  assert.ok(msFlat < 100, `buildScatterData took ${msFlat.toFixed(0)}ms (budget 100ms)`);
  assert.ok(msGrouped < 100, `buildScatterDataGrouped took ${msGrouped.toFixed(0)}ms (budget 100ms)`);
});

test('buildTestHistogramData, buildYieldData/Combined, buildBinParetoData — 25-wafer lot completes within budget', () => {
  const items = analysisLot;
  const groups = [{ key: 'A', items: items.filter((_, i) => i % 2) }, { key: 'B', items: items.filter((_, i) => !(i % 2)) }];
  // Cheapest builders — a shared, generous budget covers all of them; the
  // point of this test is a floor against a future accidental O(N²), not
  // fine-grained per-builder timing (each already gets isolated coverage above).
  const ops = [
    ['buildTestHistogramData', () => buildTestHistogramData(items, 1000, 16)],
    ['buildYieldData', () => buildYieldData(items, [1], 'label')],
    ['buildYieldDataCombined', () => buildYieldDataCombined(groups, [1], 'label')],
    ['buildBinParetoData', () => buildBinParetoData(items, 'hbin')],
  ];
  for (const [name, fn] of ops) {
    fn(); // warmup
    const ms = median(fn);
    assert.ok(ms < 100, `${name} took ${ms.toFixed(0)}ms (budget 100ms)`);
  }
});
