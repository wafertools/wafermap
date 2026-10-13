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
    enableTestValueAnalysis: false,
  });
  const clusterFindings = summary.findings.filter(f => f.comparison.family === 'cluster');
  assert.ok(clusterFindings.length >= 1, 'expected at least one cluster finding');
  assert.ok(clusterFindings.every(f => f.highlight.kind === 'dies'), 'cluster highlight should be kind=dies');
});

test('cluster detection — scattered low-density fails produce no cluster finding', () => {
  const result = buildWaferMap({ results: makeScatteredResults(0.025), waferConfig: WAFER, dieConfig: DIE });
  const summary = analyzeWaferMap(result, {
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

// A wafer whose dies fail by rule: `binAt(i, j, rMm, angle)` returns the die's hard bin.
function makeBinResults(binAt) {
  const results = [];
  const pitchX = 8, pitchY = 12, waferRadius = 150;
  const iMax = Math.ceil(waferRadius / pitchX);
  const jMax = Math.ceil(waferRadius / pitchY);
  const halfDiag = Math.hypot(pitchX / 2, pitchY / 2);
  for (let i = -iMax; i <= iMax; i++) {
    for (let j = -jMax; j <= jMax; j++) {
      const rMm = Math.hypot(i * pitchX, j * pitchY);
      if (rMm + halfDiag > waferRadius) continue;
      results.push({ x: i, y: j, hbin: binAt(i, j, rMm, Math.atan2(j * pitchY, i * pitchX)) });
    }
  }
  return results;
}

const inDisc = (i, j, ci, cj, radius) => Math.hypot((i - ci) * 8, (j - cj) * 12) < radius * 12;

test('cluster detection — a bin spot touching another bin’s edge arc is reported as that bin’s cluster', () => {
  const sw = -3 * Math.PI / 4;
  const results = makeBinResults((i, j, rMm, angle) => {
    if (inDisc(i, j, -9.5, -6.4, 2)) return 4;
    const off = Math.abs(((angle - sw + 3 * Math.PI) % (2 * Math.PI)) - Math.PI);
    return rMm > 0.85 * 150 && off < 0.8 ? 2 : 1;
  });
  const summary = analyzeWaferMap(buildWaferMap({ results, waferConfig: WAFER, dieConfig: DIE }), { enableTestValueAnalysis: false });
  const spots = summary.findings.filter(f => f.comparison.family === 'cluster' && f.variable.kind === 'hardBin');
  assert.equal(spots.length, 1, 'expected one hard-bin cluster');
  const [spot] = spots;
  assert.equal(spot.variable.bin, 4);
  assert.equal(spot.effect.direction, 'higher');
  assert.ok(spot.effect.absoluteDelta > 0);
  assert.ok(spot.summary.startsWith('HBin 4 cluster at'), spot.summary);
  assert.ok(spot.comparison.left.startsWith('Cluster at'), spot.comparison.left);
  const fours = new Set(results.filter(r => r.hbin === 4).map(r => `${r.x},${r.y}`));
  assert.deepEqual(new Set(spot.highlight.dieKeys), fours, 'the cluster is the bin 4 dies, not the arc they touch');
  assert.ok(!summary.findings.some(f => f.comparison.family === 'edge-arc' && f.variable.kind === 'hardBin'),
    'edge arcs come from the run over every fail bin only');
});

test('cluster detection — a bin cluster lists the region rises of its bin it makes up, and the pattern does not', () => {
  const sw = -3 * Math.PI / 4;
  const results = makeBinResults((i, j, rMm, angle) => {
    if (inDisc(i, j, -9.5, -6.4, 2)) return 4;
    const off = Math.abs(((angle - sw + 3 * Math.PI) % (2 * Math.PI)) - Math.PI);
    return rMm > 0.85 * 150 && off < 0.8 ? 2 : 1;
  });
  const summary = analyzeWaferMap(buildWaferMap({ results, waferConfig: WAFER, dieConfig: DIE }), { enableTestValueAnalysis: false });
  const spot = summary.findings.find(f => f.comparison.family === 'cluster' && f.variable.kind === 'hardBin');
  assert.ok(spot?.relatedIds?.length, 'the cluster names the region rows it explains');
  const byId = new Map(summary.findings.map(f => [f.id, f]));
  for (const id of spot.relatedIds) {
    const r = byId.get(id);
    assert.ok(['ring', 'quadrant', 'sector'].includes(r.comparison.family), r.id);
    assert.equal(r.variable.bin, 4);
    assert.equal(r.severity, 'info', 'a row the cluster restates does not count twice');
  }
  const claimedByPattern = summary.findings.filter(f => f.comparison.family === 'spatial-pattern').flatMap(f => f.relatedIds ?? []);
  assert.ok(spot.relatedIds.every(id => !claimedByPattern.includes(id)));
});

test('cluster detection — a bin cluster already found over every fail bin is not repeated', () => {
  const results = makeBinResults((i, j) => inDisc(i, j, -8, 5, 2) ? 2 : inDisc(i, j, 8, -5, 2) ? 4 : 1);
  const summary = analyzeWaferMap(buildWaferMap({ results, waferConfig: WAFER, dieConfig: DIE }), { enableTestValueAnalysis: false });
  const clusters = summary.findings.filter(f => f.comparison.family === 'cluster');
  assert.equal(clusters.length, 2);
  assert.ok(clusters.every(f => f.variable.kind === 'yield'));
});

test('cluster detection — a bin with fewer dies than the minimum cluster size is not tested on its own', () => {
  const sw = -3 * Math.PI / 4;
  const results = makeBinResults((i, j, rMm, angle) => {
    if (inDisc(i, j, -9.5, -6.4, 0.9)) return 4;
    const off = Math.abs(((angle - sw + 3 * Math.PI) % (2 * Math.PI)) - Math.PI);
    return rMm > 0.85 * 150 && off < 0.8 ? 2 : 1;
  });
  // The minimum is max(5, 0.3% of the dies): 5 on this wafer.
  const fours = results.filter(r => r.hbin === 4).length;
  assert.ok(fours > 0 && fours < 5, `${fours} bin 4 dies`);
  const summary = analyzeWaferMap(buildWaferMap({ results, waferConfig: WAFER, dieConfig: DIE }), { enableTestValueAnalysis: false });
  assert.ok(!summary.findings.some(f => f.variable.kind === 'hardBin' && f.comparison.family === 'cluster'));
});

test('sector analysis — sector findings are well-formed (a merged run of adjacent sectors is "Sectors A–B")', () => {
  const result = buildWaferMap({ results: makeClusterResults(), waferConfig: WAFER, dieConfig: DIE });
  const summary = analyzeWaferMap(result, {
    enableTestValueAnalysis: false,
    sectorCount: 16,
  });
  const sectorFindings = summary.findings.filter(f => f.comparison.family === 'sector');
  // Sector analysis may or may not fire depending on data, but structure should be correct when present
  for (const f of sectorFindings) {
    assert.equal(f.comparison.family, 'sector');
    assert.match(f.comparison.left, /^Sectors? /);
    // A yield finding highlights its region; a bin finding highlights the bin within its regions.
    assert.ok(['region', 'bin'].includes(f.highlight.kind), `unexpected highlight kind ${f.highlight.kind}`);
    if (f.highlight.kind === 'region') assert.equal(f.highlight.regionFamily, 'sector');
    else assert.ok(f.highlight.regionKeys?.length > 0, 'a sector bin finding names its sectors');
  }
});

test('cluster detection — cluster covering ≥10% of wafer scores unusual', () => {
  // A large contiguous cluster (radius=5 grid steps, ~16% of dies) on a clean
  // background must score unusual. This verifies the size criterion is wired in —
  // clusters of this scale are visually dominant and should top the findings list.
  const results = makeClusterResults({ clusterX: 0, clusterY: 0, radius: 5 });

  const result  = buildWaferMap({ results, waferConfig: WAFER, dieConfig: DIE });
  const summary = analyzeWaferMap(result, {
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

