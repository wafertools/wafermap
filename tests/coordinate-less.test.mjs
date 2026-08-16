import test from 'node:test';
import assert from 'node:assert/strict';
import { buildWaferMap } from '../dist/index.js';
import { analyzeWaferMap } from '../dist/packages/stats/index.js';

// End-to-end coverage for dies with no reported x/y position, mixed into an
// otherwise normal wafer — the mixed-die-per-wafer case. Spatial analysis
// (ring/quadrant/sector/reticle/cluster/pattern) must never reference an
// unpositioned die; non-spatial stats (yield, per-test analysis) must still
// count it.

function buildMixedWafer() {
  const results = [];
  // A small full grid of positioned dies, mostly passing (hbin 1), one
  // failing corner (hbin 2) so bin/yield findings have something to report.
  for (let x = -3; x <= 3; x++) {
    for (let y = -3; y <= 3; y++) {
      if (Math.hypot(x, y) > 3) continue;
      const hbin = x === 3 && y === 0 ? 2 : 1;
      results.push({ x, y, hbin, testValues: { 1001: 1.0 + x * 0.01 } });
    }
  }
  const positionedCount = results.length;

  // A handful of coordinate-less dies mixed into the same wafer — same test
  // number, some passing, some failing.
  const unpositionedCount = 5;
  for (let i = 0; i < unpositionedCount; i++) {
    results.push({
      hbin: i === 0 ? 2 : 1,
      testValues: { 1001: 2.0 + i * 0.01 },
    });
  }

  const result = buildWaferMap({
    results,
    waferConfig: { diameter: 40 },
    dieConfig: { width: 5, height: 5 },
    testDefs: [{ testNumber: 1001, name: 'Vdd' }],
  });

  return { result, positionedCount, unpositionedCount };
}

test('mixed wafer — buildWaferMap keeps every die, coverage/yield split correctly', () => {
  const { result, positionedCount, unpositionedCount } = buildMixedWafer();
  assert.equal(result.dies.length, positionedCount + unpositionedCount);
  assert.equal(result.dataCoverage.totalDies, positionedCount);
  assert.equal(result.dataCoverage.unpositionedDies, unpositionedCount);
  assert.equal(result.yield.totalDies, positionedCount + unpositionedCount);
});

test('mixed wafer — analyzeWaferMap findings never reference an unpositioned die', () => {
  const { result } = buildMixedWafer();
  const summary = analyzeWaferMap(result, { passBins: [1] });

  const unpositionedIds = new Set(
    result.dies.filter((d) => d.x === undefined).map((d) => d.id),
  );
  assert.ok(unpositionedIds.size > 0);

  for (const finding of summary.findings) {
    const dieKeys = finding.highlight?.kind === 'dies' || finding.highlight?.kind === 'region'
      ? finding.highlight.dieKeys ?? []
      : [];
    for (const key of dieKeys) {
      assert.ok(
        !key.startsWith('id:unpositioned_'),
        `finding "${finding.summary}" referenced an unpositioned die key: ${key}`,
      );
    }
  }
});

test('mixed wafer — testSpecYield/perTestStats/functionalYield counts include unpositioned dies', () => {
  const { result, positionedCount, unpositionedCount } = buildMixedWafer();
  const summary = analyzeWaferMap(result, { passBins: [1], computePerTestStats: true });

  // perTestStats' sample count for test 1001 must cover every die (both
  // positioned and unpositioned) that carries a value for it — non-spatial.
  const perTest = summary.stats.perTestStats?.find((t) => t.testNumber === 1001);
  assert.ok(perTest, 'expected perTestStats for test 1001');
  assert.equal(perTest.count, positionedCount + unpositionedCount);
});

test('a wafer with zero positioned dies produces no spatial findings, no crash', () => {
  // computePerTestStats requires >= 5 samples (analyzeWaferMap's internal
  // minimumSampleSize) — 5 unpositioned dies, so the assertion below is
  // meaningful rather than short-circuited by the sample-size floor.
  const results = [
    { hbin: 1, testValues: { 1001: 1.0 } },
    { hbin: 2, testValues: { 1001: 2.0 } },
    { hbin: 1, testValues: { 1001: 1.1 } },
    { hbin: 1, testValues: { 1001: 1.2 } },
    { hbin: 2, testValues: { 1001: 1.3 } },
  ];
  const result = buildWaferMap({
    results,
    waferConfig: { diameter: 40 },
    testDefs: [{ testNumber: 1001, name: 'Vdd' }],
  });
  const summary = analyzeWaferMap(result, { passBins: [1], computePerTestStats: true });

  for (const finding of summary.findings) {
    assert.notEqual(finding.comparison?.family, 'ring');
    assert.notEqual(finding.comparison?.family, 'quadrant');
    assert.notEqual(finding.comparison?.family, 'sector');
  }
  assert.equal(summary.stats.perTestStats?.find((t) => t.testNumber === 1001)?.count, 5);
});
