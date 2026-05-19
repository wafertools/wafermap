import test from 'node:test';
import assert from 'node:assert/strict';
import { buildFindingsNarrative } from '../dist/packages/stats/findingsNarrative.js';

// ── Minimal finding factory ───────────────────────────────────────────────────

function finding({
  family = 'ring',
  left = 'Ring 1 (core)',
  severity = 'notable',
  direction = 'lower',
  kind = 'yield',
  label = 'Yield',
  bin = undefined,
  sampleSizeLeft = 100,
} = {}) {
  return {
    id: `${family}:${left}`,
    level: 'wafer',
    severity,
    variable: { kind, label, bin },
    comparison: { family, left, right: 'Rest of wafer' },
    effect: { direction, absoluteDelta: -0.2, effectSize: 0.2 },
    stats: { method: 'z', pValue: 0.01, adjustedPValue: 0.01, sampleSizeLeft, sampleSizeRight: 500 },
    summary: 'test finding',
    highlight: { kind: 'region', regionFamily: family, keys: [] },
  };
}

// ── Guards ────────────────────────────────────────────────────────────────────

test('narrative — empty findings returns empty string', () => {
  assert.equal(buildFindingsNarrative([]), '');
});

test('narrative — all-info findings returns cautious sentence', () => {
  const result = buildFindingsNarrative([
    finding({ severity: 'info' }),
    finding({ severity: 'info', family: 'quadrant', left: 'NE' }),
  ]);
  assert.equal(result, 'Minor spatial variation detected; no strongly significant patterns.');
});

// ── Ring sentences ────────────────────────────────────────────────────────────

test('narrative — all edge rings → "Edge rings show"', () => {
  const result = buildFindingsNarrative([
    finding({ family: 'ring', left: 'Ring 4 (edge)', direction: 'lower', kind: 'yield' }),
    finding({ family: 'ring', left: 'Ring 3 (edge)', direction: 'lower', kind: 'hardBin', bin: 2, label: 'HBin 2' }),
  ]);
  assert.match(result, /^Edge rings show/);
});

test('narrative — all core rings → "The core ring shows"', () => {
  const result = buildFindingsNarrative([
    finding({ family: 'ring', left: 'Ring 1 (core)', direction: 'lower' }),
  ]);
  assert.match(result, /^The core ring shows/);
});

test('narrative — single non-core non-edge ring → uses label directly', () => {
  const result = buildFindingsNarrative([
    finding({ family: 'ring', left: 'Ring 2', direction: 'lower' }),
  ]);
  assert.match(result, /^Ring 2 show/);
});

test('narrative — mixed rings → "Multiple rings show"', () => {
  const result = buildFindingsNarrative([
    finding({ family: 'ring', left: 'Ring 1 (core)', direction: 'lower' }),
    finding({ family: 'ring', left: 'Ring 4 (edge)', direction: 'lower' }),
  ]);
  assert.match(result, /^Multiple rings show/);
});

// ── Quadrant sentences ────────────────────────────────────────────────────────

test('narrative — single quadrant', () => {
  const result = buildFindingsNarrative([
    finding({ family: 'quadrant', left: 'NE', direction: 'higher' }),
  ]);
  assert.equal(result, 'The NE quadrant shows elevated yield.');
});

test('narrative — two quadrants', () => {
  const result = buildFindingsNarrative([
    finding({ family: 'quadrant', left: 'NE', direction: 'lower' }),
    finding({ family: 'quadrant', left: 'NW', direction: 'lower' }),
  ]);
  assert.match(result, /The NE and NW quadrants show/);
});

test('narrative — three+ quadrants → multiple quadrants', () => {
  const result = buildFindingsNarrative([
    finding({ family: 'quadrant', left: 'NE' }),
    finding({ family: 'quadrant', left: 'NW' }),
    finding({ family: 'quadrant', left: 'SW' }),
  ]);
  assert.match(result, /multiple quadrants/);
});

// ── Sector sentences ──────────────────────────────────────────────────────────

test('narrative — single sector uses bearing + region', () => {
  const result = buildFindingsNarrative([
    finding({ family: 'sector', left: 'Sector NE', direction: 'lower' }),
  ]);
  assert.equal(result, 'The NE region shows reduced yield.');
});

test('narrative — adjacent sectors collapse to mid bearing', () => {
  // NE and NNE are adjacent (span = 1 step)
  const result = buildFindingsNarrative([
    finding({ family: 'sector', left: 'Sector NE' }),
    finding({ family: 'sector', left: 'Sector NNE' }),
  ]);
  assert.match(result, /region shows/);
  assert.doesNotMatch(result, /multiple sectors/);
});

test('narrative — spread sectors → multiple sectors', () => {
  // N and S are 8 steps apart — well over the 4-step threshold
  const result = buildFindingsNarrative([
    finding({ family: 'sector', left: 'Sector N' }),
    finding({ family: 'sector', left: 'Sector S' }),
  ]);
  assert.match(result, /multiple sectors/);
});

// ── Cluster sentences ─────────────────────────────────────────────────────────

test('narrative — single cluster strips "Cluster at" prefix', () => {
  const result = buildFindingsNarrative([
    finding({ family: 'cluster', left: 'Cluster at (3, -5)', sampleSizeLeft: 45 }),
  ]);
  assert.equal(result, 'A failure cluster at (3, -5).');
});

test('narrative — multiple clusters picks largest by sampleSizeLeft', () => {
  // findings[0] has 45 dies, findings[1] has 189 — largest must be findings[1]
  const result = buildFindingsNarrative([
    finding({ family: 'cluster', left: 'Cluster at (3, -5)',  sampleSizeLeft: 45,  severity: 'unusual' }),
    finding({ family: 'cluster', left: 'Cluster at (18, 1)', sampleSizeLeft: 189, severity: 'notable' }),
  ]);
  assert.match(result, /2 failure clusters identified/);
  assert.match(result, /\(18, 1\)/);
  assert.doesNotMatch(result, /\(3, -5\)/);
});

test('narrative — cluster does not say "Cluster at (x,y)" verbatim in multi sentence', () => {
  const result = buildFindingsNarrative([
    finding({ family: 'cluster', left: 'Cluster at (1, 2)', sampleSizeLeft: 10, severity: 'notable' }),
    finding({ family: 'cluster', left: 'Cluster at (3, 4)', sampleSizeLeft: 50, severity: 'unusual' }),
  ]);
  assert.doesNotMatch(result, /the largest at Cluster at/);
});

// ── Edge-arc sentences ────────────────────────────────────────────────────────

test('narrative — single edge arc strips prefix', () => {
  const result = buildFindingsNarrative([
    finding({ family: 'edge-arc', left: 'Edge arc ~NW', severity: 'unusual' }),
  ]);
  assert.equal(result, 'An edge arc near NW shows localised failures.');
});

test('narrative — multiple edge arcs', () => {
  const result = buildFindingsNarrative([
    finding({ family: 'edge-arc', left: 'Edge arc ~NW', severity: 'unusual' }),
    finding({ family: 'edge-arc', left: 'Edge arc ~SE', severity: 'notable' }),
  ]);
  assert.match(result, /^2 edge arcs detected, including near NW/);
});

// ── Metric phrase ─────────────────────────────────────────────────────────────

test('narrative — 1 metric: label only', () => {
  const result = buildFindingsNarrative([
    finding({ family: 'ring', left: 'Ring 4 (edge)', kind: 'yield', label: 'Yield' }),
  ]);
  assert.match(result, /reduced yield\./);
});

test('narrative — 2 metrics: "A and B"', () => {
  const result = buildFindingsNarrative([
    finding({ family: 'ring', left: 'Ring 4 (edge)', kind: 'yield',    label: 'Yield' }),
    finding({ family: 'ring', left: 'Ring 4 (edge)', kind: 'hardBin',  label: 'HBin 2', bin: 2 }),
  ]);
  assert.match(result, /yield and HBin 2/);
});

test('narrative — 3 metrics: "A, B, and C"', () => {
  const result = buildFindingsNarrative([
    finding({ family: 'ring', left: 'Ring 4 (edge)', kind: 'yield',   label: 'Yield' }),
    finding({ family: 'ring', left: 'Ring 4 (edge)', kind: 'hardBin', label: 'HBin 2', bin: 2 }),
    finding({ family: 'ring', left: 'Ring 4 (edge)', kind: 'softBin', label: 'SBin 5', bin: 5 }),
  ]);
  assert.match(result, /yield, HBin 2, and SBin 5/);
});

test('narrative — 4+ metrics: "A, B, and N more"', () => {
  const result = buildFindingsNarrative([
    finding({ family: 'ring', left: 'Ring 4 (edge)', kind: 'yield',   label: 'Yield' }),
    finding({ family: 'ring', left: 'Ring 4 (edge)', kind: 'hardBin', label: 'HBin 2', bin: 2 }),
    finding({ family: 'ring', left: 'Ring 4 (edge)', kind: 'softBin', label: 'SBin 5', bin: 5 }),
    finding({ family: 'ring', left: 'Ring 4 (edge)', kind: 'test',    label: 'Vth' }),
  ]);
  assert.match(result, /and 2 more/);
  assert.doesNotMatch(result, /and \d others/);
});

// ── Multi-family ordering and cap ─────────────────────────────────────────────

test('narrative — families ordered by count then priority', () => {
  // 2 cluster findings vs 1 ring — clusters should lead despite lower priority
  const result = buildFindingsNarrative([
    finding({ family: 'ring',    left: 'Ring 4 (edge)',    severity: 'notable' }),
    finding({ family: 'cluster', left: 'Cluster at (1,1)', severity: 'notable', sampleSizeLeft: 50 }),
    finding({ family: 'cluster', left: 'Cluster at (2,2)', severity: 'notable', sampleSizeLeft: 30 }),
  ]);
  // Cluster sentence should come first (2 findings vs 1)
  assert.match(result, /^2 failure clusters/);
});

test('narrative — capped at 4 sentences maximum', () => {
  const result = buildFindingsNarrative([
    finding({ family: 'ring',              left: 'Ring 4 (edge)',    severity: 'notable' }),
    finding({ family: 'quadrant',          left: 'NE',              severity: 'notable' }),
    finding({ family: 'cluster',           left: 'Cluster at (1,1)', severity: 'notable', sampleSizeLeft: 50 }),
    finding({ family: 'edge-arc',          left: 'Edge arc ~NW',    severity: 'notable' }),
    finding({ family: 'reticle-position',  left: 'R1C2',            severity: 'notable' }),
  ]);
  const sentences = result.split('. ').filter(Boolean);
  assert.ok(sentences.length <= 4, `expected ≤4 sentences, got ${sentences.length}`);
});
