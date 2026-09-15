// The analysis options decide what counts as a finding, so a bad value does not
// make the output look different — it makes it wrong, silently. Before 0.27.0,
// `significanceLevel: -0.2` returned zero findings across the board with no error
// and nothing in the result to say why: a clean, confident "nothing wrong with
// this wafer", which is the worst failure an analysis tool has.
//
// Two things guard that now, and both are tested here: the statistical
// thresholds are no longer callable options at all, and every numeric option
// that remains is validated with the correction reported through `stats.warnings`.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildWaferMap, analyzeWaferMap, createWafer, generateDies, clipDiesToWafer } from '../dist/index.js';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

/** A wafer with a deliberate edge effect, so region analysis has something real to find. */
function edgeEffectWafer() {
  const base = createWafer({ diameter: 200 });
  const grid = 14, pitch = 200 / (2 * grid);
  const geom = clipDiesToWafer(
    generateDies(base, { width: pitch, height: pitch, gridSize: grid }),
    base, { width: pitch, height: pitch }).filter(d => !d.partial);
  const nTests = 6;
  const testDefs = Array.from({ length: nTests }, (_, i) => ({ number: i, name: `test_${i}` }));
  const isEdge = d => Math.hypot(d.x, d.y) > grid * 0.75;
  // Deterministic: a fixture that flakes on randomness would be worse than none.
  let seed = 12345;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const dies = geom.map(d => {
    const testValues = {};
    for (let t = 0; t < nTests; t++) testValues[t] = 50 + Math.sin(d.x * 0.3 + t) * 2 + rnd() * 2 + (isEdge(d) ? 4 : 0);
    return { ...d, hbin: isEdge(d) ? (rnd() < 0.45 ? 2 : 1) : (rnd() < 0.05 ? 2 : 1), testValues };
  });
  return { result: buildWaferMap({ dies, passBins: [1], testDefs }), testDefs };
}

const { result, testDefs } = edgeEffectWafer();
const analyse = (options) =>
  analyzeWaferMap(result, { testDefs, enableTestValueAnalysis: true, ...options });

test('the statistical thresholds are no longer part of the public API', () => {
  // A type-level removal, so the check is on the published declarations rather
  // than on runtime behaviour.
  const dts = fs.readFileSync(path.join(root, 'dist/packages/stats/types.d.ts'), 'utf8');
  const iface = /export interface AnalyzeWaferMapOptions \{([\s\S]*?)\n\}/.exec(dts);
  assert.ok(iface, 'AnalyzeWaferMapOptions not found in the built declarations');
  // Strip comments — the interface documents why these were removed, by name.
  const declarations = iface[1].replace(/\/\*\*[\s\S]*?\*\//g, '');
  for (const removed of ['significanceLevel', 'minimumEffectSize', 'minimumRelativeEffect']) {
    assert.doesNotMatch(declarations, new RegExp(`\\b${removed}\\??:`),
      `${removed} must not be a callable option — it decides what counts as a finding`);
  }
  // Pass bins are set once, on buildWaferMap, and read from the result — an
  // analysis option could only produce a summary whose findings and yield
  // figure judged pass/fail differently.
  assert.doesNotMatch(declarations, /\bpassBins\??:/, 'passBins must not be an analysis option');
  // The options that legitimately remain are still there.
  // Ring count is set once, on buildWaferMap, so ring boundaries and ring
  // findings cannot disagree.
  assert.doesNotMatch(declarations, /\bringCount\??:/, 'ringCount must not be an analysis option');
  for (const kept of ['sectorCount', 'enableTestValueAnalysis']) {
    assert.match(declarations, new RegExp(`\\b${kept}\\??:`), `${kept} should still be an option`);
  }
});

test('a baseline analysis reports findings and no option warnings', () => {
  const summary = analyse({});
  assert.ok(summary.findings.length > 0, 'the fixture should produce findings');
  assert.equal(summary.stats.warnings ?? undefined, undefined,
    'valid options must not manufacture warnings');
});

test('out-of-range numeric options are corrected, reported, and still analysed', () => {
  const cases = [
    ['sectorCount: 7',         { sectorCount: 7 }],
    // Only reachable from untyped callers now, which is exactly why it is guarded.
    ['significanceLevel: -0.2', { significanceLevel: -0.2 }],
    ['significanceLevel: 1.5',  { significanceLevel: 1.5 }],
    ['significanceLevel: NaN',  { significanceLevel: NaN }],
    ['minimumEffectSize: -1',   { minimumEffectSize: -1 }],
  ];
  for (const [label, options] of cases) {
    const summary = analyse(options);
    const codes = (summary.stats.warnings ?? []).map(w => w.code);
    assert.ok(codes.includes('analysis-option-corrected'),
      `${label} must report 'analysis-option-corrected', got ${JSON.stringify(codes)}`);
    assert.ok(summary.findings.length > 0,
      `${label} must still produce an analysis, not a silently empty one`);
  }
});

test('a negative significanceLevel no longer silently empties the findings list', () => {
  // The specific regression this release exists for.
  const summary = analyse({ significanceLevel: -0.2 });
  assert.ok(summary.findings.length > 0,
    'a mis-signed significanceLevel must not read as "nothing wrong with this wafer"');
  const warning = (summary.stats.warnings ?? []).find(w => w.code === 'analysis-option-corrected');
  assert.ok(warning, 'the correction must be reported, not applied silently');
  assert.match(warning.message, /significanceLevel/,
    'the warning must name the option it corrected');
});

test('a fine ring banding is left alone — minimumSampleSize already guards it', () => {
  // There is deliberately no ceiling on ringCount. A cap looked right ("rings
  // thinner than a die") until measured: at ringCount 40 the ring findings still
  // carry tens of dies each, and a die-count-derived cap rejected ringCount 3 on
  // this repo's own small test wafers.
  const fine = buildWaferMap({ dies: result.dies, passBins: [1], testDefs, ringCount: 40 });
  const summary = analyzeWaferMap(fine, { testDefs, enableTestValueAnalysis: true });
  const codes = [...fine.warnings, ...(summary.stats.warnings ?? [])].map(w => w.code);
  assert.ok(!codes.includes('analysis-option-corrected'),
    'a fine but legitimate banding must not be corrected');
  const ringFindings = summary.findings.filter(f => f.comparison?.family === 'ring');
  assert.ok(ringFindings.length > 0, 'ringCount 40 should still produce ring findings');
  for (const f of ringFindings) {
    assert.ok(f.stats.sampleSizeLeft >= 5,
      `every reported region must clear minimumSampleSize; got ${f.stats.sampleSizeLeft}`);
  }
});

// ── Explicit `undefined` is absence, not a bad value ─────────────────────────
// `{ ...DEFAULT_OPTIONS, ...options }` let `{ ringCount: undefined }` overwrite
// the default, which then failed the finite-number test and raised an
// `analysis-option-corrected` advisory — and that advisory is not quiet: it
// reaches the toolbar's warning indicator and the Summary panel's banner. The
// trigger was the most ordinary thing a host writes: forwarding an optional.

test('a forwarded, unset option is not reported as a correction', () => {
  const warned = [];
  const realWarn = console.warn;
  console.warn = (...a) => warned.push(a.join(' '));
  try {
    const summary = analyse({ sectorCount: undefined });
    const corrections = (summary.stats.warnings ?? []).filter(w => w.code === 'analysis-option-corrected');
    assert.deepEqual(corrections, [], 'nothing was corrected, so nothing should be reported');
    assert.deepEqual(warned, [], 'and nothing should reach the console either');
    // And the defaults really did apply, rather than `undefined` surviving.
    const withNothing = analyse({});
    assert.equal(summary.findings.length, withNothing.findings.length,
      'and the defaults really applied, rather than `undefined` surviving into the analysis');
  } finally {
    console.warn = realWarn;
  }
});

test('a genuinely bad value is still corrected and still reported', () => {
  const realWarn = console.warn;
  console.warn = () => {};
  try {
    const summary = analyse({ sectorCount: 7 });
    const corrections = (summary.stats.warnings ?? []).filter(w => w.code === 'analysis-option-corrected');
    assert.equal(corrections.length, 1);
    assert.match(corrections[0].message, /sectorCount=7/);
  } finally {
    console.warn = realWarn;
  }
});

// ── Ring count: set, and validated, on buildWaferMap ─────────────────────────

test('ringCount is validated on buildWaferMap, reported, and still analysed', () => {
  for (const [raw, expected] of [[0, 1], [-3, 1], [2.7, 3], [NaN, 4]]) {
    const built = buildWaferMap({ dies: result.dies, passBins: [1], testDefs, ringCount: raw });
    assert.equal(built.ringCount, expected, `ringCount ${raw} resolves to ${expected}`);
    const w = built.warnings.find(x => x.code === 'analysis-option-corrected');
    assert.ok(w && /ringCount=/.test(w.message), `ringCount ${raw} must be reported, not applied silently`);
    assert.ok(analyzeWaferMap(built, { testDefs, enableTestValueAnalysis: true }).findings.length > 0,
      `ringCount ${raw} must still produce an analysis`);
  }
  assert.equal(buildWaferMap({ dies: result.dies, passBins: [1] }).ringCount, 4, 'default 4');
});

test('the analysis uses the ring count the map was built with', () => {
  const three = analyzeWaferMap(buildWaferMap({ dies: result.dies, passBins: [1], testDefs, ringCount: 3 }));
  const ringLabels = three.findings.filter(f => f.comparison?.family === 'ring').map(f => f.comparison.left ?? '');
  assert.ok(ringLabels.length > 0, 'the fixture should produce ring findings');
  assert.ok(ringLabels.every(l => !/Ring 4/.test(l)), `a 3-ring build must not report Ring 4: ${ringLabels}`);
});

test('the removed passBins/ringCount analysis options are reported, not silently ignored', () => {
  const built = buildWaferMap({ dies: result.dies, passBins: [1], testDefs, ringCount: 3 });
  const clean = analyzeWaferMap(built, { testDefs });
  assert.ok(!(clean.stats.warnings ?? []).some(w => /no longer/.test(w.message)), 'no warning when not passed');

  const stale = analyzeWaferMap(built, { testDefs, passBins: [1, 2], ringCount: 6 });
  const w = (stale.stats.warnings ?? []).find(x => /no longer/.test(x.message));
  assert.ok(w, 'a stale option must be reported');
  assert.equal(w.code, 'analysis-option-corrected');
  assert.match(w.message, /passBins and ringCount/);
  assert.match(w.message, /buildWaferMap/);
  // …and the build's values are still the ones in effect.
  const ringLabels = stale.findings.filter(f => f.comparison?.family === 'ring').map(f => f.comparison.left ?? '');
  assert.ok(ringLabels.every(l => !/Ring [56]/.test(l)), 'ring banding comes from the build, not the stale option');
});
