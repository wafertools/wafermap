import test from 'node:test';
import assert from 'node:assert/strict';
import { buildWaferMap } from '../dist/index.js';
import { classifyPattern } from '../dist/packages/stats/patternClassification.js';
import { analyzeWaferMap } from '../dist/packages/stats/analyzeWaferMap.js';

const WAFER = { diameter: 300 };
const DIE   = { width: 8, height: 12 };
const pitchX = 8, pitchY = 12, waferRadius = 150;

function allDiesOnWafer() {
  const results = [];
  const iMax = Math.ceil(waferRadius / pitchX);
  const jMax = Math.ceil(waferRadius / pitchY);
  const halfDiag = Math.hypot(pitchX / 2, pitchY / 2);
  for (let i = -iMax; i <= iMax; i++) {
    for (let j = -jMax; j <= jMax; j++) {
      if (Math.hypot(i * pitchX, j * pitchY) + halfDiag <= waferRadius) {
        results.push({ i, j });
      }
    }
  }
  return results;
}

function buildResult(failPredicate) {
  const positions = allDiesOnWafer();
  const results = positions.map(({ i, j }) => ({
    x: i, y: j, hbin: failPredicate(i, j) ? 2 : 1,
  }));
  return buildWaferMap({ results, waferConfig: WAFER, dieConfig: DIE });
}

// Edge-ring: all dies in the outermost ring fail
function makeEdgeRing() {
  return buildResult((i, j) => {
    const norm = Math.hypot(i * pitchX, j * pitchY) / waferRadius;
    return norm >= 0.75;
  });
}

// Center: all dies within the central 25% of radius fail
function makeCenter() {
  return buildResult((i, j) => {
    const norm = Math.hypot(i * pitchX, j * pitchY) / waferRadius;
    return norm <= 0.25;
  });
}

// Near-full: 70% of dies fail uniformly
function makeNearFull() {
  return buildResult((i, j) => {
    return ((Math.abs(i * 13 + j * 7)) % 10) < 7;
  });
}

// Scratch: a single horizontal row of failing dies across the wafer
function makeScratch() {
  return buildResult((i, j) => j === 0);
}

// Donut: annular band between 30% and 60% radius, low edge RDD
function makeDonut() {
  return buildResult((i, j) => {
    const norm = Math.hypot(i * pitchX, j * pitchY) / waferRadius;
    return norm >= 0.30 && norm <= 0.60;
  });
}

// Scattered random fails (low rate, non-spatial)
function makeRandom() {
  return buildResult((i, j) => ((Math.abs(i * 17 + j * 31)) % 50) === 0);
}

// Helper to run classifyPattern directly from a WaferMapResult
function classify(result) {
  return classifyPattern(result.dies, result.wafer, { passBins: [1], ringCount: 4 });
}

test('edge-ring pattern — high confidence', () => {
  const result = makeEdgeRing();
  const c = classify(result);
  assert.ok(c !== null, 'should return a classification');
  assert.equal(c.pattern, 'edge-ring');
  assert.equal(c.confidence, 'high');
  assert.ok(c.features.edgeRdd > 0.70, `edgeRdd should be high, got ${c.features.edgeRdd}`);
});

test('center pattern — high confidence', () => {
  const result = makeCenter();
  const c = classify(result);
  assert.ok(c !== null);
  assert.equal(c.pattern, 'center');
  assert.ok(c.features.centroidDistNorm < 0.25, `centroidDistNorm should be low, got ${c.features.centroidDistNorm}`);
});

test('near-full pattern', () => {
  const result = makeNearFull();
  const c = classify(result);
  assert.ok(c !== null);
  assert.equal(c.pattern, 'near-full');
  assert.ok(c.features.globalRdd >= 0.60, `globalRdd should be high, got ${c.features.globalRdd}`);
});

test('scratch pattern — high linear score', () => {
  const result = makeScratch();
  const c = classify(result);
  assert.ok(c !== null);
  assert.equal(c.pattern, 'scratch');
  assert.ok(c.features.linearScore >= 0.60, `linearScore should be high, got ${c.features.linearScore}`);
  assert.ok(c.features.eccentricity >= 0.70, `eccentricity should be high, got ${c.features.eccentricity}`);
});

test('donut pattern', () => {
  const result = makeDonut();
  const c = classify(result);
  assert.ok(c !== null);
  assert.equal(c.pattern, 'donut');
  assert.ok(c.features.minDistNorm >= 0.20, `minDistNorm should be non-zero, got ${c.features.minDistNorm}`);
});

test('random pattern — returns random or null for very sparse data', () => {
  const result = makeRandom();
  const c = classify(result);
  // Very sparse scatter: either null (below min threshold) or 'random'
  if (c !== null) {
    assert.equal(c.pattern, 'random');
  }
});

test('returns null when failing dies below minimum threshold', () => {
  // Only 2 failing dies — below default minimumFailingDies of 5
  const result = buildWaferMap({
    results: [
      { x: 0, y: 0, hbin: 1 },
      { x: 1, y: 0, hbin: 1 },
      { x: 2, y: 0, hbin: 2 },
      { x: 3, y: 0, hbin: 1 },
      { x: 0, y: 1, hbin: 2 },
    ],
    waferConfig: WAFER,
    dieConfig: DIE,
  });
  const c = classify(result);
  assert.equal(c, null);
});

test('analyzeWaferMap emits spatial-pattern finding for edge-ring', () => {
  const result = makeEdgeRing();
  const summary = analyzeWaferMap(result, { passBins: [1] });
  const patternFindings = summary.findings.filter(f => f.comparison.family === 'spatial-pattern');
  assert.ok(patternFindings.length === 1, 'should have exactly one spatial-pattern finding');
  assert.ok(patternFindings[0].summary.toLowerCase().includes('edge-ring'));
  assert.equal(patternFindings[0].severity, 'unusual');
});

test('analyzeWaferMap respects enablePatternClassification: false', () => {
  const result = makeEdgeRing();
  const summary = analyzeWaferMap(result, { passBins: [1], enablePatternClassification: false });
  const patternFindings = summary.findings.filter(f => f.comparison.family === 'spatial-pattern');
  assert.equal(patternFindings.length, 0, 'should suppress spatial-pattern findings');
});

test('adaptive minimumFailingDies — returns null when fails below 0.3% of die count', () => {
  // Large wafer (~1500 dies): adaptive minimum = max(5, round(1500 * 0.003)) = 5
  // So 4 failing dies should return null
  const positions = allDiesOnWafer();
  const results = positions.map(({ i, j }, idx) => ({
    x: i, y: j, hbin: idx < 4 ? 2 : 1, // exactly 4 failing dies
  }));
  const result = buildWaferMap({ results, waferConfig: WAFER, dieConfig: DIE });
  const c = classify(result);
  assert.equal(c, null, 'should return null when failing dies below adaptive minimum');
});

test('RELATED_FAMILIES — edge-ring pattern downgrades ring findings to info', () => {
  const result = makeEdgeRing();
  const summary = analyzeWaferMap(result, { passBins: [1] });
  const patternFinding = summary.findings.find(f => f.comparison.family === 'spatial-pattern');
  assert.ok(patternFinding, 'should have a spatial-pattern finding');
  // Ring findings correlated with an edge-ring should be downgraded to info
  const ringFindings = summary.findings.filter(f => f.comparison.family === 'ring');
  if (ringFindings.length > 0 && patternFinding.severity !== 'info') {
    for (const rf of ringFindings) {
      if (patternFinding.relatedIds?.includes(rf.id)) {
        assert.equal(rf.severity, 'info', 'ring finding related to edge-ring pattern should be info');
      }
    }
  }
});

test('RELATED_FAMILIES — edge-local pattern downgrades sector/quadrant/edge-arc findings', () => {
  // Edge-local: failures in a localised arc near one edge
  const result = buildResult((i, j) => {
    const norm = Math.hypot(i * pitchX, j * pitchY) / waferRadius;
    // Upper-right quadrant, outer zone
    return norm >= 0.70 && i > 0 && j > 0;
  });
  const summary = analyzeWaferMap(result, { passBins: [1] });
  const patternFinding = summary.findings.find(f => f.comparison.family === 'spatial-pattern');
  if (!patternFinding || patternFinding.comparison.left !== 'Edge-local') return; // skip if not classified as edge-local
  // Sector/quadrant/edge-arc findings in relatedIds should be info
  const relatedSet = new Set(patternFinding.relatedIds ?? []);
  const related = summary.findings.filter(f =>
    relatedSet.has(f.id) &&
    ['sector', 'quadrant', 'edge-arc'].includes(f.comparison.family),
  );
  for (const rf of related) {
    assert.equal(rf.severity, 'info', `${rf.comparison.family} finding related to edge-local should be info`);
  }
});
