// The supported replacements added in 0.30.1 for exports deprecated in 0.30.0
// (API_REMOVALS.md, Part 2). Each replaced something a host could not otherwise
// do, so each is tested for the property that made the old export unsafe:
// pass bins and ring count taken from the built map, lot figures pooled
// correctly, and a layout that never contains an off-wafer die.

import test from 'node:test';
import assert from 'node:assert/strict';

const { buildWaferMap, analyzeWaferMap, analyzeWaferLot, binColorsForMaps, renderWaferReportHtml, renderLotReportHtml } =
  await import('../dist/index.js');

/** A 60-die wafer with one parametric test carrying limits and recorded verdicts. */
function wafer(waferId, shift, { passBins = [1], ringCount } = {}) {
  return buildWaferMap({
    results: Array.from({ length: 60 }, (_, i) => ({
      x: (i % 10) - 5, y: Math.floor(i / 10) - 3,
      hbin: (i + shift) % 7 === 0 ? 3 : (i + shift) % 5 === 0 ? 2 : 1,
      testValues: { 100: 1 + ((i * 7 + shift) % 13) / 10 },
      testPass: { 100: (i + shift) % 11 !== 0 },
    })),
    waferConfig: { diameter: 150, metadata: { lot: 'L1', waferId } },
    dieConfig: { width: 10, height: 10 },
    testDefs: [{ testNumber: 100, name: 'vth', unit: 'V', limitLow: 1.05, limitHigh: 2.1 }],
    passBins,
    ...(ringCount ? { ringCount } : {}),
  });
}

// ── Bin colours ──────────────────────────────────────────────────────────────

test('binColorsForMaps judges pass/fail by each map\'s own pass bins', () => {
  const both = binColorsForMaps(wafer('W1', 0, { passBins: [1, 2] }));
  assert.ok(both.pass.hard.has(2), 'bin 2 passes on a map built with passBins [1, 2]');
  const one = binColorsForMaps(wafer('W1', 0));
  assert.ok(!one.pass.hard.has(2), 'and fails on a map built with the default');
  assert.notEqual(both.hard.get(2), one.hard.get(2), 'so its colour differs');
});

test('binColorsForMaps over several maps is the gallery-wide resolution', () => {
  const colors = binColorsForMaps([wafer('W1', 0), wafer('W2', 3)]);
  assert.deepEqual([...colors.hard.keys()].sort(), [1, 2, 3]);
});

// ── Analysis figures ─────────────────────────────────────────────────────────

test('capability: one wafer has one subgroup, so Cp equals Pp; the five-number chart fields are not exposed', () => {
  const [c] = analyzeWaferMap(wafer('W1', 0), { computePerTestStats: true }).stats.capability;
  assert.equal(c.testNumber, 100);
  assert.equal(c.hasSpec, true);
  assert.equal(c.cp, c.pp);
  assert.equal(c.stdWithin, c.stdOverall);
  for (const chartOnly of ['min', 'q1', 'median', 'q3', 'max']) assert.ok(!(chartOnly in c), `${chartOnly} is normalised chart data`);
});

test('capability is gated like perTestStats', () => {
  assert.equal(analyzeWaferMap(wafer('W1', 0)).stats.capability, undefined);
});

test('lot capability pools within-wafer spread across wafers, so Cp and Pp differ', () => {
  const lot = analyzeWaferLot([wafer('W1', 0), wafer('W2', 3)], { computePerTestStats: true });
  const [c] = lot.stats.capability;
  assert.equal(c.n, 120);
  assert.notEqual(c.stdWithin, c.stdOverall);
  assert.notEqual(c.cp, c.pp);
});

test('lot capability pooled from the wafer summaries equals capability computed over every die at once', async () => {
  const { buildCapabilityData } = await import('../dist/packages/stats/capability.js');
  const maps = [wafer('W1', 0), wafer('W2', 3), wafer('W3', 5)];
  const opts = { computePerTestStats: true };
  const lot = analyzeWaferLot(maps, { ...opts, perWaferSummaries: maps.map(m => analyzeWaferMap(m, opts)) });
  const [direct] = buildCapabilityData(maps.map(m => ({ dies: m.dies })), maps[0].testDefs);
  const [pooled] = lot.stats.capability;
  for (const k of ['n', 'mean', 'stdOverall', 'stdWithin', 'cp', 'cpk', 'pp', 'ppk']) {
    assert.ok(Math.abs(pooled[k] - direct[k]) < 1e-9, `${k}: pooled ${pooled[k]} vs direct ${direct[k]}`);
  }
});

test('lot capability is absent unless every wafer has capability', () => {
  const maps = [wafer('W1', 0), wafer('W2', 3)];
  const summaries = [analyzeWaferMap(maps[0], { computePerTestStats: true }), analyzeWaferMap(maps[1])];
  assert.equal(analyzeWaferLot(maps, { perWaferSummaries: summaries }).stats.capability, undefined);
});

test('tester-verdict pass rates and the spec/verdict disagreement count', () => {
  const s = analyzeWaferMap(wafer('W1', 0)).stats;
  const [row] = s.testFlagYield;
  assert.deepEqual({ pass: row.passDies, fail: row.failDies, total: row.totalDies }, { pass: 54, fail: 6, total: 60 });
  assert.equal(row.passRatePercent, 90);
  assert.equal(typeof s.specVerdictDisagreementDies, 'number');
});

test('lot pass rates are counts summed over the wafers', () => {
  const a = wafer('W1', 0), b = wafer('W2', 3);
  const lot = analyzeWaferLot([a, b]);
  const sum = (field, key) => lot.perWafer.reduce((t, w) => t + w.summary.stats[field][0][key], 0);
  assert.equal(lot.stats.testSpecYield[0].totalDies, sum('testSpecYield', 'totalDies'));
  assert.equal(lot.stats.testSpecYield[0].passDies, sum('testSpecYield', 'passDies'));
  assert.equal(lot.stats.testFlagYield[0].failDies, sum('testFlagYield', 'failDies'));
  assert.equal(lot.stats.specVerdictDisagreementDies,
    lot.perWafer.reduce((t, w) => t + w.summary.stats.specVerdictDisagreementDies, 0));
});

test('a lot pass rate is absent unless every wafer reported it', () => {
  const noTests = buildWaferMap({ results: [{ x: 0, y: 0, hbin: 1 }, { x: 1, y: 0, hbin: 1 }], waferConfig: { diameter: 50 }, dieConfig: { width: 10, height: 10 } });
  const lot = analyzeWaferLot([wafer('W1', 0), noTests]);
  assert.equal(lot.stats.testSpecYield, undefined);
  assert.equal(lot.stats.testFlagYield, undefined);
});

test('region yield: every eligible binned die lands in exactly one quadrant and one ring', () => {
  const s = analyzeWaferMap(wafer('W1', 0)).stats;
  const total = (rows) => rows.reduce((t, r) => t + r.n, 0);
  assert.equal(total(s.regionYield.quadrant), 60);
  assert.equal(total(s.regionYield.ring), 60);
});

test('region yield judges by the map\'s pass bins', () => {
  const one = analyzeWaferMap(wafer('W1', 0)).stats.regionYield.quadrant;
  const two = analyzeWaferMap(wafer('W1', 0, { passBins: [1, 2] })).stats.regionYield.quadrant;
  assert.ok(two.every((r, i) => r.yieldPercent >= one[i].yieldPercent));
  assert.ok(two.some((r, i) => r.yieldPercent > one[i].yieldPercent));
});

test('lot region yield pooled from the wafer summaries equals region yield computed over every die at once', async () => {
  const { buildRegionYieldData, buildRingRegions, buildQuadrantRegions } = await import('../dist/packages/stats/regions.js');
  const maps = [wafer('W1', 0, { passBins: [1, 2] }), wafer('W2', 3)];
  const lot = analyzeWaferLot(maps, { perWaferSummaries: maps.map(m => analyzeWaferMap(m)) });
  const direct = (builder) => buildRegionYieldData(maps.map(m => m.dies), maps.map(m => m.wafer), maps[0].ringCount, wi => maps[wi].passBins, builder);
  const strip = rows => rows.map(({ key, n, passDies, yieldPercent }) => ({ key, n, passDies, yieldPercent: +yieldPercent.toFixed(9) }))
    .sort((a, b) => a.key.localeCompare(b.key));
  assert.deepEqual(strip(lot.stats.regionYield.quadrant), strip(direct(buildQuadrantRegions)));
  assert.deepEqual(strip(lot.stats.regionYield.ring), strip(direct(buildRingRegions)));
});

test('lot ring yield is absent when wafers were built with different ring counts; quadrants still pool', () => {
  const lot = analyzeWaferLot([wafer('W1', 0, { ringCount: 3 }), wafer('W2', 3, { ringCount: 5 })]);
  assert.equal(lot.stats.regionYield.ring, undefined);
  assert.equal(lot.stats.regionYield.quadrant.reduce((t, r) => t + r.n, 0), 120);
});

// ── Reports ──────────────────────────────────────────────────────────────────

test('renderWaferReportHtml reads pass bins from the built map', () => {
  const html = renderWaferReportHtml(wafer('W1', 0, { passBins: [1, 2] }));
  assert.match(html, /<!DOCTYPE html>/);
  assert.match(html, /bins 1, 2/, 'the yield is labelled with the map\'s pass bins, not bin 1');
});

test('renderWaferReportHtml analyses a built map, but never a map assembled from pieces', () => {
  const built = wafer('W1', 0);
  assert.match(renderWaferReportHtml(built), /Findings|findings/, 'a built map is analysed when no summary is given');
  const pieces = { wafer: built.wafer, dies: built.dies, yield: built.yield, dataCoverage: built.dataCoverage, passBins: built.passBins, ringCount: built.ringCount };
  assert.doesNotThrow(() => renderWaferReportHtml(pieces));
});

test('renderLotReportHtml builds a lot report from built maps', () => {
  const html = renderLotReportHtml([wafer('W1', 0), wafer('W2', 3)]);
  assert.match(html, /Lot Summary — L1/);
  assert.match(html, /W1/);
  assert.match(html, /W2/);
});

// ── Layout-only build ────────────────────────────────────────────────────────

test('layout: every die site fully on the wafer, counted independently', () => {
  const D = 200, W = 10, H = 8;
  let expected = 0;
  for (let c = -20; c <= 20; c++) for (let r = -20; r <= 20; r++) {
    const xs = [c * W - W / 2, c * W + W / 2], ys = [r * H - H / 2, r * H + H / 2];
    if (xs.every(x => ys.every(y => Math.hypot(x, y) <= D / 2 + 1e-9))) expected++;
  }
  const map = buildWaferMap({ layout: true, waferConfig: { diameter: D }, dieConfig: { width: W, height: H } });
  assert.equal(map.dies.length, expected);
  assert.deepEqual(map.warnings, []);
  assert.ok(map.dies.every(d => !d.partial));
  const centre = map.dies.find(d => d.x === 0 && d.y === 0);
  assert.deepEqual([centre.physX, centre.physY], [0, 0]);
});

test('layout: a flat removes sites on its own side, whichever way y counts', () => {
  const base = { layout: true, dieConfig: { width: 3, height: 3 } };
  const plain = buildWaferMap({ ...base, waferConfig: { diameter: 100 } });
  const flat = buildWaferMap({ ...base, waferConfig: { diameter: 100, notch: { type: 'bottom' } } });
  const down = buildWaferMap({ ...base, waferConfig: { diameter: 100, notch: { type: 'bottom' } }, dieConfig: { width: 3, height: 3, yAxisDirection: 'down' } });
  assert.ok(flat.dies.length < plain.dies.length);
  const minY = m => Math.min(...m.dies.map(d => d.physY));
  const maxY = m => Math.max(...m.dies.map(d => d.physY));
  assert.ok(minY(flat) > minY(plain), 'the bottom row lost sites');
  assert.equal(maxY(flat), maxY(plain), 'the top did not');
  const key = m => new Set(m.dies.map(d => `${Math.round(d.physX)},${Math.round(d.physY)}`));
  assert.deepEqual([...key(down)].sort(), [...key(flat)].sort(), 'same physical sites with y counting down');
  const top = down.dies.reduce((a, d) => (d.physY > a.physY ? d : a));
  assert.ok(top.y < 0, 'and the top site is numbered negative when y counts down');
});

test('layout: missing geometry, or combining layout with results, throws', () => {
  assert.throws(() => buildWaferMap({ layout: true, waferConfig: { diameter: 100 } }), /layout/);
  assert.throws(() => buildWaferMap({ layout: true, results: [{ x: 0, y: 0 }], waferConfig: { diameter: 100 }, dieConfig: { width: 5, height: 5 } }), /only one/);
});

// ── Spatial pattern features ─────────────────────────────────────────────────

/** A 400-die wafer whose failures sit in the given dies. */
function patternWafer(isFail) {
  const results = [];
  for (let x = -10; x <= 10; x++) for (let y = -10; y <= 10; y++) {
    if (x * x + y * y > 100) continue;
    results.push({ x, y, hbin: isFail(x, y) ? 2 : 1 });
  }
  return buildWaferMap({ results, waferConfig: { diameter: 210 }, dieConfig: { width: 10, height: 10 } });
}

test('stats.spatialPattern carries the classifier\'s label and features, even when no pattern is found', async () => {
  const { classifyPattern } = await import('../dist/packages/stats/patternClassification.js');
  let seed = 3;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const random = patternWafer(() => rnd() < 0.08);
  const summary = analyzeWaferMap(random);
  const sp = summary.stats.spatialPattern;
  assert.ok(sp, 'a wafer with failures always gets its measurement');
  assert.ok(!summary.findings.some(f => f.comparison.family === 'spatial-pattern') || !['random', 'none'].includes(sp.pattern),
    'a random/none wafer raises no pattern finding, yet still has features');
  for (const k of ['globalRdd', 'edgeRdd', 'centroidDistNorm', 'eccentricity', 'linearScore']) {
    assert.equal(typeof sp.features[k], 'number', k);
  }
  const direct = classifyPattern(random.dies.filter(d => !d.partial && !d.edgeExcluded), random.wafer,
    { passBins: random.passBins, ringCount: random.ringCount });
  assert.deepEqual(sp.features, direct.features, 'the same measurement classifyPattern makes');
});

test('a detected pattern\'s finding and stats.spatialPattern agree', () => {
  const edge = patternWafer((x, y) => x * x + y * y > 64);
  const summary = analyzeWaferMap(edge);
  assert.equal(summary.stats.spatialPattern.pattern, 'edge-ring');
  assert.ok(summary.findings.some(f => f.comparison.family === 'spatial-pattern'));
});

test('no spatialPattern without enough failing dies to have a shape', () => {
  const clean = patternWafer(() => false);
  assert.equal(analyzeWaferMap(clean).stats.spatialPattern, undefined);
});
