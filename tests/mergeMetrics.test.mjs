// A test's mean and its limit fail rate are different findings of one variable
// kind and index. Adjacent regions merge per metric: a region with both must not
// split a run in two, and must not drop one of them.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildWaferMap, analyzeWaferLot } from '../dist/index.js';
import { analyzeWaferMap, inQuadrantOrder } from '../dist/packages/stats/analyzeWaferMap.js';
import { regionAngleBins } from '../dist/packages/stats/regions.js';
import { visibleFindings } from '../dist/packages/stats/filterFindings.js';
import { makeResults, WAFER_CONFIG, DIE_CONFIG, TEST_DEFS, HBIN_DEFS, SBIN_DEFS } from '../docs/examples/data.js';
import { buildLot } from './fixtures/synthLots.mjs';

const VTH = 1060;

test('Vth tilt: adjacent sectors merge into one run', () => {
  const result = buildWaferMap({
    lotStack: { results: [1, 2, 3, 4, 5, 6].map(seed => makeResults({ seed, quadrant: true })), method: 'mean' },
    waferConfig: WAFER_CONFIG, dieConfig: DIE_CONFIG, testDefs: TEST_DEFS, ringCount: 4 });
  const { findings } = analyzeWaferMap(result, { enableTestValueAnalysis: true, testNumbers: [VTH] });
  const mean = findings.filter(f => f.id.startsWith(`test:${VTH}:`));
  const sectors = mean.filter(f => f.comparison.family === 'sector' && f.effect.direction === 'higher');
  assert.equal(sectors.length, 1, sectors.map(f => f.comparison.left).join(' | '));
  assert.deepEqual(mean.filter(f => f.comparison.family === 'quadrant').map(f => f.comparison.left).sort(), ['NE', 'SW']);
});

/** One wafer whose VT fails its low limit on 40% of the dies in the NE and N sectors: a mean shift and a limit fail
 *  rate over the same two sectors, both strong enough to stand among every comparison the wafer makes. */
const twoSectorTilt = () => {
  const [m] = buildLot({ name: 'merge:sectors', wafers: 1, tests: 'parametric', testFailures: [{ test: 101, region: 'sectors-NE-N', p: 0.4, binning: 'pass' }] });
  return analyzeWaferMap(m, { enableTestValueAnalysis: true }).findings;
};

test('a test\'s mean and its limit fail rate over the same sectors merge separately, one run per metric', () => {
  const findings = twoSectorTilt();
  const mean = findings.find(f => f.id === 'test:101:sector:NE-N');
  const limit = findings.find(f => f.id === 'specLimit:101:sector:NE-N');
  assert.ok(mean && limit, findings.filter(f => /101/.test(f.id)).map(f => f.id).join(' | '));
  assert.notEqual(mean, limit);
});

test('a run of quadrants is named in order round the wafer', () => {
  assert.deepEqual(inQuadrantOrder(['SE', 'NE', 'NW']), ['SE', 'NE', 'NW']);
  assert.deepEqual(inQuadrantOrder(['NE', 'SE', 'NW']), ['SE', 'NE', 'NW']);
  assert.deepEqual(inQuadrantOrder(['SW', 'NW']), ['NW', 'SW']);
  assert.deepEqual(inQuadrantOrder(['SE', 'SW', 'NW', 'NE']), ['NE', 'NW', 'SW', 'SE']);
  assert.deepEqual(inQuadrantOrder(['NE']), ['NE']);
});

test('adjacent sectors with a limit fail rate merge into one run, recomputed over their union', () => {
  const limit = twoSectorTilt().filter(f => f.id.startsWith('specLimit:101:sector:'));
  assert.ok(limit.some(f => (f.relatedIds?.length ?? 0) >= 2), limit.map(f => f.id).join(' | '));
  for (const f of limit) assert.match(f.summary, /limit fail rate for/);
});

// The lot merges adjacent regions as a wafer does. Two identical wafers make the
// lot's combined statistic the wafer's own, so the two must agree to rounding.
test('a lot of identical wafers merges adjacent regions to the wafer\'s own figures', () => {
  const make = () => buildWaferMap({
    results: makeResults({ seed: 3, quadrant: true }), waferConfig: WAFER_CONFIG, dieConfig: DIE_CONFIG,
    hbinDefs: HBIN_DEFS, sbinDefs: SBIN_DEFS, testDefs: TEST_DEFS, ringCount: 4 });
  const [a, b] = [make(), make()];
  const options = { enableTestValueAnalysis: true };
  const wafer = analyzeWaferMap(a, options).findings.filter(f => f.relatedIds?.length && /^test:/.test(f.id));
  const lot = analyzeWaferLot([a, b], options).findings.filter(f => f.id.startsWith('lot-region:test|') && f.relatedIds?.length);
  assert.ok(wafer.length >= 2, 'the wafer merges runs');
  let compared = 0;
  for (const w of wafer) {
    const l = lot.find(f => f.comparison.left === w.comparison.left && f.variable.index === w.variable.index);
    if (!l) continue;
    compared++;
    assert.ok(Math.abs(l.effect.absoluteDelta - w.effect.absoluteDelta) < 1e-9, `${w.comparison.left}: ${l.effect.absoluteDelta} vs ${w.effect.absoluteDelta}`);
    assert.match(l.summary, /on 2\/2 wafers/);
  }
  assert.ok(compared >= 2, 'the lot merges the same runs');
});

test('lot findings list a run of adjacent sectors once, not once per sector', () => {
  const wafers = [1, 2, 3, 4, 5, 6].map(seed => buildWaferMap({
    results: makeResults({ seed, quadrant: true }), waferConfig: WAFER_CONFIG, dieConfig: DIE_CONFIG,
    hbinDefs: HBIN_DEFS, sbinDefs: SBIN_DEFS, testDefs: TEST_DEFS, ringCount: 4 }));
  const { findings } = analyzeWaferLot(wafers, { enableTestValueAnalysis: true });
  const vth = findings.filter(f => f.id.startsWith('lot-region:test|') && f.variable.index === VTH &&
    f.comparison.family === 'sector' && f.effect.direction === 'higher');
  assert.equal(vth.length, 1, vth.map(f => f.comparison.left).join(' | '));
  assert.deepEqual(vth[0].relatedIds.length >= 2, true);
  assert.deepEqual(vth[0].highlight.waferIndices.length > 0, true);
});

// A sector run and a quadrant over the same part of the wafer are one statement.
test('region angles: a sector run and the quadrant it mostly covers overlap; one sector in a quadrant does not enough', () => {
  const union = (keys) => new Set(keys.flatMap(k => [...regionAngleBins(k, 8)]));
  const overlap = (a, b) => { let both = 0; for (const x of a) if (b.has(x)) both++; return both / (a.size + b.size - both); };
  const ne = union(['quadrant:NE']);
  assert.ok(Math.abs(overlap(union(['sector:E', 'sector:NE', 'sector:N']), ne) - 2 / 3) < 1e-9);
  assert.ok(Math.abs(overlap(union(['sector:E', 'sector:NE']), ne) - 3 / 5) < 1e-9);
  assert.ok(Math.abs(overlap(union(['sector:NE']), ne) - 1 / 2) < 1e-9);
  assert.equal(overlap(union(['sector:W', 'sector:SW', 'sector:S']), ne), 0);
  assert.equal(regionAngleBins('ring:2', 8), undefined);
});

test('the Vth tilt reads as two findings, not a sector run and a quadrant each', () => {
  const stack = buildWaferMap({
    lotStack: { results: [1, 2, 3, 4, 5, 6].map(seed => makeResults({ seed, quadrant: true })), method: 'mean' },
    waferConfig: WAFER_CONFIG, dieConfig: DIE_CONFIG, testDefs: TEST_DEFS, ringCount: 4 });
  const visible = visibleFindings(analyzeWaferMap(stack, { enableTestValueAnalysis: true, testNumbers: [VTH] }).findings);
  const mean = visible.filter(f => f.id.startsWith(`test:${VTH}:`) && ['sector', 'quadrant'].includes(f.comparison.family));
  assert.deepEqual(mean.map(f => `${f.comparison.left}/${f.effect.direction}`).sort(), ['Sectors E–N/higher', 'Sectors W–S/lower']);
});

test('a sector run absorbs the quadrant inside it per metric, never another metric\'s', () => {
  const findings = twoSectorTilt();
  const visible = visibleFindings(findings);
  const run = (prefix) => findings.find(f => f.id === `${prefix}:101:sector:NE-N`);
  assert.deepEqual(run('test').absorbedIds, ['test:101:quadrant:NE']);
  assert.deepEqual(run('specLimit').absorbedIds, ['specLimit:101:quadrant:NE']);
  assert.ok(visible.includes(run('test')) && visible.includes(run('specLimit')), 'each metric keeps its own run');
});

test('a lot collapses a sector run and its quadrant the same way, per metric', () => {
  const wafers = [1, 2, 3, 4, 5, 6].map(seed => buildWaferMap({
    results: makeResults({ seed, quadrant: true }), waferConfig: WAFER_CONFIG, dieConfig: DIE_CONFIG,
    hbinDefs: HBIN_DEFS, sbinDefs: SBIN_DEFS, testDefs: TEST_DEFS, ringCount: 4 }));
  const all = analyzeWaferLot(wafers, { enableTestValueAnalysis: true }).findings;
  const run = all.find(f => f.id.startsWith('lot-region:test|') && f.variable.index === VTH && f.comparison.left === 'Sectors E–N');
  assert.ok(run, 'the merged sector run');
  assert.deepEqual(run.absorbedIds, ['lot-region:test|test||1060|quadrant|quadrant:NE']);
  const visible = visibleFindings(all);
  assert.ok(visible.some(f => f.id === 'lot-region:limitFail|test||1060|quadrant|quadrant:NE'), 'another metric is not absorbed');
});
