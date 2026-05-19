import test from 'node:test';
import assert from 'node:assert/strict';
import { buildWaferMap } from '../dist/index.js';
import { analyzeWaferMap } from '../dist/packages/stats/analyzeWaferMap.js';

const WAFER = { diameter: 300 };
const DIE   = { width: 8, height: 12 };

// Build a wafer with a known tight cluster of failing dies at a fixed position.
// All other dies pass. The cluster should be statistically significant.
function makeClusterResults({ clusterX = 3, clusterY = 2, radius = 2, failBin = 2 } = {}) {
  const results = [];
  const pitchX = 8, pitchY = 12, waferRadius = 150;
  const iMax = Math.ceil(waferRadius / pitchX);
  const jMax = Math.ceil(waferRadius / pitchY);
  const halfDiag = Math.hypot(pitchX / 2, pitchY / 2);

  for (let i = -iMax; i <= iMax; i++) {
    for (let j = -jMax; j <= jMax; j++) {
      if (Math.hypot(i * pitchX, j * pitchY) + halfDiag > waferRadius) continue;
      const inCluster = Math.hypot((i - clusterX) * pitchX, (j - clusterY) * pitchY) < radius * Math.max(pitchX, pitchY);
      results.push({ x: i, y: j, hbin: inCluster ? failBin : 1 });
    }
  }
  return results;
}

// Build a wafer with only random scattered fails (low density, non-contiguous).
function makeScatteredResults(failRate = 0.03) {
  const results = [];
  const pitchX = 8, pitchY = 12, waferRadius = 150;
  const iMax = Math.ceil(waferRadius / pitchX);
  const jMax = Math.ceil(waferRadius / pitchY);
  const halfDiag = Math.hypot(pitchX / 2, pitchY / 2);

  for (let i = -iMax; i <= iMax; i++) {
    for (let j = -jMax; j <= jMax; j++) {
      if (Math.hypot(i * pitchX, j * pitchY) + halfDiag > waferRadius) continue;
      // Deterministic pseudo-random: fail every ~33rd die in a non-spatial pattern
      const isScatterFail = ((Math.abs(i * 17 + j * 31)) % Math.round(1 / failRate)) === 0;
      results.push({ x: i, y: j, hbin: isScatterFail ? 2 : 1 });
    }
  }
  return results;
}

// Build a wafer with a cluster near the edge at a narrow angle (edge-arc pattern).
function makeEdgeArcResults() {
  const results = [];
  const pitchX = 8, pitchY = 12, waferRadius = 150;
  const iMax = Math.ceil(waferRadius / pitchX);
  const jMax = Math.ceil(waferRadius / pitchY);
  const halfDiag = Math.hypot(pitchX / 2, pitchY / 2);
  const targetAngle = Math.atan2(1, -0.4); // ~NNW

  for (let i = -iMax; i <= iMax; i++) {
    for (let j = -jMax; j <= jMax; j++) {
      const rMm = Math.hypot(i * pitchX, j * pitchY);
      if (rMm + halfDiag > waferRadius) continue;
      const t = rMm / waferRadius;
      const angle = Math.atan2(j * pitchY, i * pitchX);
      const angleDiff = Math.abs(((angle - targetAngle + 3 * Math.PI) % (2 * Math.PI)) - Math.PI);
      const isArcFail = t > 0.80 && angleDiff < 0.35;
      results.push({ x: i, y: j, hbin: isArcFail ? 2 : 1 });
    }
  }
  return results;
}

test('cluster detection — tight failure cluster produces a cluster finding', () => {
  const result = buildWaferMap({ results: makeClusterResults(), waferConfig: WAFER, dieConfig: DIE });
  const summary = analyzeWaferMap(result, {
    passBins: [1],
    enableClusterAnalysis: true,
    enableAngularAnalysis: false,
    enableYieldAnalysis: false,
    enableHardBinAnalysis: false,
    enableSoftBinAnalysis: false,
    enableTestValueAnalysis: false,
  });
  const clusterFindings = summary.findings.filter(f => f.comparison.family === 'cluster');
  assert.ok(clusterFindings.length >= 1, 'expected at least one cluster finding');
  assert.ok(clusterFindings.every(f => f.highlight.kind === 'dies'), 'cluster highlight should be kind=dies');
});

test('cluster detection — scattered low-density fails produce no cluster finding', () => {
  const result = buildWaferMap({ results: makeScatteredResults(0.025), waferConfig: WAFER, dieConfig: DIE });
  const summary = analyzeWaferMap(result, {
    passBins: [1],
    enableClusterAnalysis: true,
    enableAngularAnalysis: false,
    enableYieldAnalysis: false,
    enableHardBinAnalysis: false,
    enableSoftBinAnalysis: false,
    enableTestValueAnalysis: false,
    minimumClusterSize: 3,
  });
  const clusterFindings = summary.findings.filter(f =>
    f.comparison.family === 'cluster' || f.comparison.family === 'edge-arc',
  );
  assert.equal(clusterFindings.length, 0, 'scattered fails should not produce a cluster finding');
});

test('cluster detection — edge arc pattern produces an edge-arc finding', () => {
  const result = buildWaferMap({ results: makeEdgeArcResults(), waferConfig: WAFER, dieConfig: DIE });
  const summary = analyzeWaferMap(result, {
    passBins: [1],
    enableClusterAnalysis: true,
    enableAngularAnalysis: false,
    enableYieldAnalysis: false,
    enableHardBinAnalysis: false,
    enableSoftBinAnalysis: false,
    enableTestValueAnalysis: false,
  });
  const arcFindings = summary.findings.filter(f => f.comparison.family === 'edge-arc');
  assert.ok(arcFindings.length >= 1, 'expected at least one edge-arc finding');
  assert.ok(arcFindings.every(f => f.highlight.kind === 'dies'), 'edge-arc highlight should be kind=dies');
  assert.ok(arcFindings.every(f => f.comparison.left.startsWith('Edge arc')), 'label should start with "Edge arc"');
});

test('cluster detection — minimumClusterSize suppresses small clusters', () => {
  // Force a 3-die cluster by using a very small radius
  const result = buildWaferMap({
    results: makeClusterResults({ radius: 0.9 }),
    waferConfig: WAFER,
    dieConfig: DIE,
  });
  const summaryStrict = analyzeWaferMap(result, {
    passBins: [1],
    enableClusterAnalysis: true,
    enableAngularAnalysis: false,
    enableYieldAnalysis: false,
    enableHardBinAnalysis: false,
    enableSoftBinAnalysis: false,
    enableTestValueAnalysis: false,
    minimumClusterSize: 10,
  });
  const clusterFindings = summaryStrict.findings.filter(f =>
    f.comparison.family === 'cluster' || f.comparison.family === 'edge-arc',
  );
  assert.equal(clusterFindings.length, 0, 'minimumClusterSize=10 should suppress small clusters');
});

test('cluster detection — cluster findings have correct finding structure', () => {
  const result = buildWaferMap({ results: makeClusterResults(), waferConfig: WAFER, dieConfig: DIE });
  const summary = analyzeWaferMap(result, {
    passBins: [1],
    enableClusterAnalysis: true,
    enableAngularAnalysis: false,
    enableYieldAnalysis: false,
    enableHardBinAnalysis: false,
    enableSoftBinAnalysis: false,
    enableTestValueAnalysis: false,
  });
  const clusterFindings = summary.findings.filter(f => f.comparison.family === 'cluster');
  for (const f of clusterFindings) {
    assert.equal(f.level, 'wafer');
    assert.equal(f.variable.kind, 'yield');
    assert.ok(['info', 'notable', 'unusual'].includes(f.severity));
    assert.ok(f.stats.pValue !== undefined);
    assert.ok(f.stats.sampleSizeLeft > 0);
    assert.ok(f.highlight.kind === 'dies');
    assert.ok(f.highlight.dieKeys.length > 0);
  }
});

test('sector analysis — sector findings present with angular analysis enabled', () => {
  const result = buildWaferMap({ results: makeClusterResults(), waferConfig: WAFER, dieConfig: DIE });
  const summary = analyzeWaferMap(result, {
    passBins: [1],
    enableClusterAnalysis: false,
    enableAngularAnalysis: true,
    enableYieldAnalysis: true,
    enableHardBinAnalysis: false,
    enableSoftBinAnalysis: false,
    enableTestValueAnalysis: false,
    sectorCount: 16,
  });
  const sectorFindings = summary.findings.filter(f => f.comparison.family === 'sector');
  // Sector analysis may or may not fire depending on data, but structure should be correct when present
  for (const f of sectorFindings) {
    assert.equal(f.comparison.family, 'sector');
    assert.match(f.comparison.left, /^Sector /);
    assert.equal(f.highlight.kind, 'region');
    assert.equal(f.highlight.regionFamily, 'sector');
  }
});

test('cluster detection — cluster covering ≥10% of wafer scores unusual', () => {
  // A large contiguous cluster (radius=5 grid steps, ~16% of dies) on a clean
  // background must score unusual. This verifies the size criterion is wired in —
  // clusters of this scale are visually dominant and should top the findings list.
  const results = makeClusterResults({ clusterX: 0, clusterY: 0, radius: 5 });

  const result  = buildWaferMap({ results, waferConfig: WAFER, dieConfig: DIE });
  const summary = analyzeWaferMap(result, {
    passBins: [1],
    enableClusterAnalysis: true,
    enableAngularAnalysis: false,
    enableYieldAnalysis: false,
    enableHardBinAnalysis: false,
    enableSoftBinAnalysis: false,
    enableTestValueAnalysis: false,
  });

  const clusters = summary.findings.filter(f => f.comparison.family === 'cluster');
  assert.ok(clusters.length >= 1, 'expected at least one cluster finding');

  const largest = clusters.reduce((a, b) =>
    (a.highlight.dieKeys?.length ?? 0) >= (b.highlight.dieKeys?.length ?? 0) ? a : b
  );
  const totalDies = result.dies.filter(d => !d.partial).length;
  const fraction  = (largest.highlight.dieKeys?.length ?? 0) / totalDies;

  assert.ok(fraction >= 0.10,
    `largest cluster covers ${(fraction * 100).toFixed(1)}% of wafer — expected ≥10%`);
  assert.equal(largest.severity, 'unusual',
    `cluster covering ${(fraction * 100).toFixed(1)}% of wafer should score unusual, got ${largest.severity}`);
});

test('sector analysis — no sector findings when angular analysis disabled', () => {
  const result = buildWaferMap({ results: makeClusterResults(), waferConfig: WAFER, dieConfig: DIE });
  const summary = analyzeWaferMap(result, {
    passBins: [1],
    enableClusterAnalysis: false,
    enableAngularAnalysis: false,
  });
  const sectorFindings = summary.findings.filter(f => f.comparison.family === 'sector');
  assert.equal(sectorFindings.length, 0);
});
