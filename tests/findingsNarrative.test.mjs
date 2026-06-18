import test from 'node:test';
import assert from 'node:assert/strict';
import { buildFindingsNarrative } from '../dist/packages/stats/findingsNarrative.js';

// ── Minimal finding factory ───────────────────────────────────────────────────

let _fid = 0;
function finding({
  family = 'ring',
  left = 'Ring 1 (core)',
  severity = 'notable',
  direction = 'lower',
  kind = 'yield',
  label = 'Yield',
  bin = undefined,
  index = undefined,
  id = undefined,
  relatedIds = undefined,
  method = 'z',
  sampleSizeLeft = 100,
} = {}) {
  return {
    id: id ?? `${family}:${left}:${kind}:${bin ?? index ?? ''}:${_fid++}`,
    level: 'wafer',
    severity,
    variable: { kind, label, bin, index },
    comparison: { family, left, right: 'Rest of wafer' },
    effect: { direction, absoluteDelta: -0.2, effectSize: 0.2 },
    stats: { method, pValue: 0.01, adjustedPValue: 0.01, sampleSizeLeft, sampleSizeRight: 500 },
    summary: 'test finding',
    highlight: { kind: 'region', regionFamily: family, regionKeys: [] },
    relatedIds,
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

test('narrative — edge rings with yield + redundant fail-bin → folds to yield only', () => {
  // HBin 2 (a fail bin) merely restates the yield drop; the prose folds it into
  // yield. Two same-zone edge rings of one metric read as a single ring sentence.
  const result = buildFindingsNarrative([
    finding({ family: 'ring', left: 'Ring 4 (edge)', direction: 'lower', kind: 'yield' }),
    finding({ family: 'ring', left: 'Ring 3 (edge)', direction: 'lower', kind: 'hardBin', bin: 2, label: 'HBin 2' }),
  ]);
  assert.match(result, /reduced yield/);
  assert.doesNotMatch(result, /HBin/);
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

test('narrative — mixed rings → names each ring', () => {
  const result = buildFindingsNarrative([
    finding({ family: 'ring', left: 'Ring 1 (core)', direction: 'lower' }),
    finding({ family: 'ring', left: 'Ring 4 (edge)', direction: 'lower' }),
  ]);
  assert.match(result, /^Ring 1 \(core\) and Ring 4 \(edge\) show/);
});

test('narrative — merged ring band uses the merged label verbatim', () => {
  const result = buildFindingsNarrative([
    finding({ family: 'ring', left: 'Rings 1–3', direction: 'lower' }),
  ]);
  assert.match(result, /^Rings 1–3 show/);
});

test('narrative — opposing-direction yield regions split into two clauses, problem first', () => {
  // For yield, lower (the failures) leads; no vague "shifted".
  const result = buildFindingsNarrative([
    finding({ family: 'ring', left: 'Rings 1–3',     direction: 'higher' }),
    finding({ family: 'ring', left: 'Ring 4 (edge)', direction: 'lower'  }),
  ]);
  assert.match(result, /Ring 4 \(edge\) shows reduced yield while rings 1–3 show elevated yield\./);
  assert.doesNotMatch(result, /shifted/);
});

test('narrative — opposing metrics in the SAME region do not split or self-contradict', () => {
  // A region with higher yield necessarily has a lower fail-bin rate — this is one
  // physical signal, not a spatial split. The region must be named once and the
  // "elevated" clause must not contain the (lower) fail-bin metric.
  const result = buildFindingsNarrative([
    finding({ family: 'ring', left: 'Rings 1–3', direction: 'higher', kind: 'yield',   label: 'Yield' }),
    finding({ family: 'ring', left: 'Rings 1–3', direction: 'lower',  kind: 'hardBin', label: 'HBin 2', bin: 2 }),
  ]);
  assert.match(result, /^Rings 1–3 shows? elevated yield\./);
  assert.doesNotMatch(result, /while/);
  assert.doesNotMatch(result, /shifted/);
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

test('narrative — three+ bare quadrants names each one', () => {
  const result = buildFindingsNarrative([
    finding({ family: 'quadrant', left: 'NE' }),
    finding({ family: 'quadrant', left: 'NW' }),
    finding({ family: 'quadrant', left: 'SW' }),
  ]);
  assert.match(result, /The NE, NW, and SW quadrants show/);
});

test('narrative — merged quadrant label used verbatim (no doubled "quadrant")', () => {
  const result = buildFindingsNarrative([
    finding({ family: 'quadrant', left: 'Quadrants NW, SW & SE', direction: 'lower' }),
  ]);
  assert.match(result, /^Quadrants NW, SW & SE show/);
  assert.doesNotMatch(result, /quadrant Quadrants/i);
});

// ── Sector sentences ──────────────────────────────────────────────────────────

test('narrative — single sector uses bearing + region', () => {
  const result = buildFindingsNarrative([
    finding({ family: 'sector', left: 'Sector NE', direction: 'lower' }),
  ]);
  assert.equal(result, 'The NE region shows reduced yield.');
});

test('narrative — multiple sectors are named, not collapsed to "multiple sectors"', () => {
  const result = buildFindingsNarrative([
    finding({ family: 'sector', left: 'Sector NE' }),
    finding({ family: 'sector', left: 'Sector NNE' }),
  ]);
  assert.match(result, /The NE and NNE sectors show/);
  assert.doesNotMatch(result, /multiple sectors/);
});

test('narrative — merged sector arc uses the merged label', () => {
  const result = buildFindingsNarrative([
    finding({ family: 'sector', left: 'Sectors NE–E', direction: 'lower' }),
  ]);
  assert.match(result, /The NE–E sectors show/);
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

// Independent test metrics are NOT folded (only pass/fail bins fold into yield),
// so they exercise the metric-joining phrase.
test('narrative — 2 independent metrics: "A and B"', () => {
  const result = buildFindingsNarrative([
    finding({ family: 'ring', left: 'Ring 4 (edge)', kind: 'test', label: 'Vth' }),
    finding({ family: 'ring', left: 'Ring 4 (edge)', kind: 'test', label: 'Idd', bin: undefined }),
  ]);
  assert.match(result, /Vth and Idd/);
});

test('narrative — 3 independent metrics: "A, B, and C"', () => {
  const result = buildFindingsNarrative([
    finding({ family: 'ring', left: 'Ring 4 (edge)', kind: 'test', label: 'Vth' }),
    finding({ family: 'ring', left: 'Ring 4 (edge)', kind: 'test', label: 'Idd' }),
    finding({ family: 'ring', left: 'Ring 4 (edge)', kind: 'test', label: 'Ileak' }),
  ]);
  assert.match(result, /Vth, Idd, and Ileak/);
});

test('narrative — 4+ independent metrics: "A, B, and N more"', () => {
  const result = buildFindingsNarrative([
    finding({ family: 'ring', left: 'Ring 4 (edge)', kind: 'test', label: 'Vth' }),
    finding({ family: 'ring', left: 'Ring 4 (edge)', kind: 'test', label: 'Idd' }),
    finding({ family: 'ring', left: 'Ring 4 (edge)', kind: 'test', label: 'Ileak' }),
    finding({ family: 'ring', left: 'Ring 4 (edge)', kind: 'test', label: 'Cgs' }),
  ]);
  assert.match(result, /and 2 more/);
  assert.doesNotMatch(result, /and \d others/);
});

test('narrative — yield folds redundant pass/fail bins (single metric word)', () => {
  const result = buildFindingsNarrative([
    finding({ family: 'ring', left: 'Ring 4 (edge)', kind: 'yield',   direction: 'lower', label: 'Yield' }),
    finding({ family: 'ring', left: 'Ring 4 (edge)', kind: 'hardBin', direction: 'higher', label: 'HBin 2', bin: 2 }),
  ]);
  assert.match(result, /reduced yield\.?$/);
  assert.doesNotMatch(result, /HBin/);
});

// ── Multi-family ordering and cap ─────────────────────────────────────────────

test('narrative — leads with strongest finding when no spatial pattern', () => {
  // A cluster (unusual) and a ring (notable) with no pattern: the stronger cluster leads.
  const result = buildFindingsNarrative([
    finding({ family: 'ring',    left: 'Ring 4 (edge)',    severity: 'notable' }),
    finding({ family: 'cluster', left: 'Cluster at (1,1)', severity: 'unusual', sampleSizeLeft: 50 }),
    finding({ family: 'cluster', left: 'Cluster at (2,2)', severity: 'notable', sampleSizeLeft: 30 }),
  ]);
  // The ring (regional) sentence + the cluster supporting sentence both appear;
  // the cluster signal must be present and not duplicated.
  assert.match(result, /failure cluster/i);
  assert.doesNotMatch(result, /shifted/);
});

test('narrative — capped at 3 sentences maximum', () => {
  const result = buildFindingsNarrative([
    finding({ family: 'ring',              left: 'Ring 4 (edge)',    severity: 'notable' }),
    finding({ family: 'quadrant',          left: 'NE',              severity: 'notable' }),
    finding({ family: 'cluster',           left: 'Cluster at (1,1)', severity: 'notable', sampleSizeLeft: 50 }),
    finding({ family: 'edge-arc',          left: 'Edge arc ~NW',    severity: 'notable' }),
    finding({ family: 'reticle-position',  left: 'R1C2',            severity: 'notable' }),
  ]);
  const sentences = result.split('. ').filter(Boolean);
  assert.ok(sentences.length <= 3, `expected ≤3 sentences, got ${sentences.length}`);
});

// ── Pipeline: lead, gradient consolidation, cross-family dedup ─────────────────

test('narrative — leads with the spatial pattern when present', () => {
  const result = buildFindingsNarrative([
    finding({ family: 'sector', left: 'Sectors NE–E', kind: 'test', label: 'Test A', direction: 'higher', severity: 'unusual' }),
    finding({ family: 'spatial-pattern', left: 'Center cluster', kind: 'spatialPattern', direction: 'different', severity: 'unusual', method: 'geometry' }),
  ]);
  assert.match(result, /^Center cluster failure pattern detected/);
});

test('narrative — pattern names failure locus from a related edge arc', () => {
  const arc = finding({ family: 'edge-arc', left: 'Edge arc ~NW', severity: 'unusual', id: 'edge-arc:nw' });
  const pattern = finding({
    family: 'spatial-pattern', left: 'Edge-ring', kind: 'spatialPattern', direction: 'different',
    severity: 'unusual', method: 'geometry', relatedIds: ['edge-arc:nw'],
  });
  const result = buildFindingsNarrative([arc, pattern]);
  assert.match(result, /^Edge-ring failure pattern detected .*near NW\./);
  // The related arc is folded into the lead, not repeated as its own sentence.
  assert.doesNotMatch(result, /An edge arc near NW/);
});

test('narrative — directional gradient collapses to one "increases from X toward Y" phrase', () => {
  const result = buildFindingsNarrative([
    finding({ family: 'sector', left: 'Sectors SE–NE', kind: 'test', label: 'Test A', direction: 'higher', severity: 'unusual' }),
    finding({ family: 'sector', left: 'Sectors NW–S',  kind: 'test', label: 'Test A', direction: 'lower',  severity: 'unusual' }),
  ]);
  assert.match(result, /Test A increases from \w+ toward \w+ across the wafer\./);
  assert.doesNotMatch(result, /while/);
});

test('narrative — a region never appears in both elevated and reduced clauses', () => {
  // A merged "Quadrants NW, SW & SE" lower test finding and a bare "SW" higher
  // spec-fail finding both mention SW — SW must not land on both sides.
  const result = buildFindingsNarrative([
    finding({ family: 'quadrant', left: 'NE', kind: 'test', label: 'Test A', direction: 'higher', severity: 'unusual' }),
    finding({ family: 'quadrant', left: 'Quadrants NW, SW & SE', kind: 'test', label: 'Test A', direction: 'lower', severity: 'unusual' }),
    finding({ family: 'quadrant', left: 'SW', kind: 'test', label: 'Test A', direction: 'higher', severity: 'notable' }),
  ]);
  // SW appears at most once across the whole sentence.
  const swCount = (result.match(/\bSW\b/g) ?? []).length;
  assert.ok(swCount <= 1, `SW appears ${swCount} times: ${result}`);
});
