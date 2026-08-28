import test from 'node:test';
import assert from 'node:assert/strict';

import {
  analyzeWaferLot,
  analyzeWaferMap,
  buildWaferMap,
  classifyDie,
  clipDiesToWafer,
  createWafer,
  generateDies,
  renderFindingsReportHtml,
} from '../dist/index.js';

function makeBaseDies() {
  const wafer = createWafer({ diameter: 60 });
  const dies = clipDiesToWafer(
    generateDies(wafer, { width: 10, height: 10, gridSize: 2 }),
    wafer,
    { width: 10, height: 10 },
  ).filter((die) => !die.partial);
  return { wafer, dies };
}

test('analyzeWaferMap detects ring-level yield loss', () => {
  const { wafer, dies } = makeBaseDies();
  const enriched = dies.map((die) => {
    const { ring } = classifyDie(die, wafer, { ringCount: 3 });
    return { ...die, hbin: ring === 3 ? 2 : 1 };
  });

  const result = buildWaferMap({
    dies: enriched,
    waferConfig: { diameter: 60 },
    passBins: [1],
  });

  const summary = analyzeWaferMap(result, {
    ringCount: 3,
    minimumSampleSize: 3,
    minimumEffectSize: 0.2,
  });

  assert.equal(summary.level, 'wafer');
  assert.equal(summary.hasNotableFindings, true);
  assert.ok(summary.findings.some((finding) =>
    finding.variable.kind === 'yield' &&
    finding.comparison.family === 'ring' &&
    finding.comparison.left === 'Ring 3 (edge)' &&
    finding.effect.direction === 'lower',
  ));
  assert.equal(summary.stats.analyzedDies, enriched.length);
  assert.deepEqual(summary.stats.hardBinsConsidered, [1, 2]);
});

test('analyzeWaferMap populates hardBinCounts over the yield-eligible population', () => {
  const { wafer, dies } = makeBaseDies();
  const enriched = dies.map((die, i) => ({ ...die, hbin: i % 2 === 0 ? 1 : 2 }));
  // A partial die with a bin assigned must not be counted — hardBinCounts is
  // scoped to the same isYieldEligibleDie population every other bin display
  // (binPareto, summaryPanel's bin section) uses, or the two would disagree.
  enriched.push({ x: 999, y: 999, hbin: 1, partial: true });

  const result = buildWaferMap({ dies: enriched, waferConfig: { diameter: 60 }, passBins: [1] });
  const summary = analyzeWaferMap(result, { ringCount: 3 });

  const expectedBin1 = enriched.filter(d => d.hbin === 1 && !d.partial && !d.edgeExcluded).length;
  const expectedBin2 = enriched.filter(d => d.hbin === 2 && !d.partial && !d.edgeExcluded).length;
  assert.equal(summary.stats.hardBinCounts[1], expectedBin1);
  assert.equal(summary.stats.hardBinCounts[2], expectedBin2);
  const totalCounted = Object.values(summary.stats.hardBinCounts).reduce((a, b) => a + b, 0);
  assert.equal(totalCounted, expectedBin1 + expectedBin2);
});

test('analyzeWaferMap detects quadrant-level yield loss and respects filtering options', () => {
  const { dies } = makeBaseDies();
  const enriched = dies.map((die) => ({
    ...die,
    hbin: die.x >= 0 && die.y >= 0 ? 2 : 1,
  }));

  const summary = analyzeWaferMap({
    dies: enriched,
    waferConfig: { diameter: 60 },
    passBins: [1],
  }, {
    minimumSampleSize: 3,
    minimumEffectSize: 0.2,
  });

  assert.ok(summary.findings.some((finding) =>
    finding.comparison.family === 'quadrant' &&
    finding.comparison.left === 'NE' &&
    finding.effect.direction === 'lower',
  ));
  assert.equal(summary.stats.softBinsConsidered.length, 0);
  assert.deepEqual(summary.stats.testsConsidered, []);
});

test('analyzeWaferMap detects hard-bin, soft-bin, and test-value regional patterns', () => {
  const { wafer, dies } = makeBaseDies();
  const enriched = dies.map((die) => {
    const { ring, quadrant } = classifyDie(die, wafer, { ringCount: 3 });
    // Deterministic within-region jitter so each group has real variance — a
    // constant-per-region value has zero within-group spread, which Welch
    // correctly treats as unmeasurable (no finding). Real test data always varies.
    const jitter = (((die.x * 7 + die.y * 13) % 10) - 4.5) * 0.05; // ~±0.225
    return {
      ...die,
      testValues: { 0: (quadrant === 'NE' ? 10 : 1) + jitter },
      hbin: quadrant === 'NE' ? 8 : 1,
      sbin: ring === 3 ? 23 : 1,
    };
  });

  const summary = analyzeWaferMap({
    dies: enriched,
    waferConfig: { diameter: 60 },
    passBins: [1],
    testDefs: [{ testNumber: 0, name: 'Idsat', unit: 'A' }],
    hbinDefs: [{ bin: 8, name: 'NE Fail' }],
    sbinDefs: [{ bin: 23, name: 'Edge Signature' }],
  }, {
    ringCount: 3,
    minimumSampleSize: 3,
    minimumEffectSize: 0.2,
    enableYieldAnalysis: false,
    enableTestValueAnalysis: true,
  });

  assert.ok(summary.findings.some((finding) =>
    finding.variable.kind === 'hardBin' &&
    finding.variable.bin === 8 &&
    finding.comparison.family === 'quadrant' &&
    finding.comparison.left === 'NE',
  ));
  assert.ok(summary.findings.some((finding) =>
    finding.variable.kind === 'softBin' &&
    finding.variable.bin === 23 &&
    finding.comparison.family === 'ring' &&
    finding.comparison.left === 'Ring 3 (edge)',
  ));
  assert.ok(summary.findings.some((finding) =>
    finding.variable.kind === 'test' &&
    finding.variable.label === 'Idsat' &&
    finding.comparison.family === 'quadrant' &&
    finding.comparison.left === 'NE' &&
    finding.effect.direction === 'higher',
  ));
  assert.deepEqual(summary.stats.testsConsidered, [0]);
  assert.deepEqual(summary.stats.hardBinsConsidered, [1, 8]);
  assert.deepEqual(summary.stats.softBinsConsidered, [1, 23]);
});

test('analyzeWaferMap detects repeating reticle-local patterns when reticle config is present', () => {
  const { dies } = makeBaseDies();
  const enriched = dies.map((die) => {
    const localCol = ((die.x % 2) + 2) % 2;
    const localRow = ((die.y % 2) + 2) % 2;
    const isBadCell = localCol === 1 && localRow === 0;
    // Deterministic within-group jitter so values have real variance (constant
    // per group → zero within-group spread → Welch correctly finds nothing).
    const jitter = (((die.x * 7 + die.y * 13) % 10) - 4.5) * 0.05;
    return {
      ...die,
      testValues: { 0: (isBadCell ? 10 : 1) + jitter },
      hbin: isBadCell ? 9 : 1,
      sbin: isBadCell ? 31 : 1,
    };
  });

  const summary = analyzeWaferMap({
    dies: enriched,
    waferConfig: { diameter: 60 },
    reticleConfig: { width: 2, height: 2 },
    passBins: [1],
    testDefs: [{ testNumber: 0, name: 'Leakage', unit: 'A' }],
    hbinDefs: [{ bin: 9, name: 'Reticle Cell Fail' }],
    sbinDefs: [{ bin: 31, name: 'Reticle Cell Soft Fail' }],
  }, {
    minimumSampleSize: 3,
    minimumEffectSize: 0.2,
    enableYieldAnalysis: false,
    enableTestValueAnalysis: true,
  });

  assert.ok(summary.findings.some((finding) =>
    finding.comparison.family === 'reticle-position' &&
    finding.comparison.right === 'Other reticle positions' &&
    finding.comparison.left === 'Reticle cell (1, 0)' &&
    finding.variable.kind === 'hardBin' &&
    finding.variable.bin === 9,
  ));
  assert.ok(summary.findings.some((finding) =>
    finding.comparison.family === 'reticle-position' &&
    finding.comparison.right === 'Other reticle positions' &&
    finding.comparison.left === 'Reticle cell (1, 0)' &&
    finding.variable.kind === 'softBin' &&
    finding.variable.bin === 31,
  ));
  assert.ok(summary.findings.some((finding) =>
    finding.comparison.family === 'reticle-position' &&
    finding.comparison.left === 'Reticle cell (1, 0)' &&
    finding.variable.kind === 'test' &&
    finding.variable.label === 'Leakage' &&
    finding.effect.direction === 'higher',
  ));
});

test('analyzeWaferLot emits repeated-pattern and inter-wafer findings', () => {
  const { wafer, dies } = makeBaseDies();
  const patternDies = dies.map((die) => {
    const { ring } = classifyDie(die, wafer, { ringCount: 3 });
    return { ...die, hbin: ring === 3 ? 2 : 1 };
  });
  const passDies = dies.map((die) => ({ ...die, hbin: 1 }));
  const lowYieldDies = dies.map((die) => ({ ...die, hbin: 2 }));

  const lot = analyzeWaferLot([
    { dies: patternDies, waferConfig: { diameter: 60 }, passBins: [1] },
    { dies: passDies, waferConfig: { diameter: 60 }, passBins: [1] },
    { dies: lowYieldDies, waferConfig: { diameter: 60 }, passBins: [1] },
    { dies: patternDies, waferConfig: { diameter: 60 }, passBins: [1] },
  ], {
    ringCount: 3,
    minimumSampleSize: 3,
    minimumEffectSize: 0.2,
  });

  assert.equal(lot.level, 'lot');
  assert.equal(lot.stats.waferCount, 4);
  assert.equal(lot.perWafer.length, 4);
  assert.ok(lot.findings.some((finding) =>
    finding.level === 'lot' &&
    finding.variable.kind === 'yield' &&
    finding.comparison.family === 'ring' &&
    finding.comparison.left === 'Ring 3 (edge)' &&
    finding.highlight.kind === 'wafer' &&
    finding.highlight.waferIndices.length === 2,
  ));
  assert.ok(lot.findings.some((finding) =>
    finding.level === 'inter-wafer' &&
    finding.variable.kind === 'yield' &&
    finding.comparison.family === 'wafer' &&
    finding.effect.direction === 'lower',
  ));
  assert.equal(lot.hasNotableFindings, true);
  assert.equal(lot.perWafer[0].summary.hasNotableFindings, true);
  assert.equal(lot.perWafer[1].summary.hasNotableFindings, false);
  // perWafer[2] is all-failing (near-full pattern) — spatial-pattern finding makes it notable
  assert.equal(lot.perWafer[2].summary.hasNotableFindings, true);
  assert.equal(lot.perWafer[3].summary.hasNotableFindings, true);
});

test('lot findings report uses the lot wafer count for coverage', () => {
  const { wafer, dies } = makeBaseDies();
  const patternDies = dies.map((die) => {
    const { ring } = classifyDie(die, wafer, { ringCount: 3 });
    return { ...die, hbin: ring === 3 ? 2 : 1 };
  });
  const passDies = dies.map((die) => ({ ...die, hbin: 1 }));

  const lot = analyzeWaferLot([
    { dies: patternDies, waferConfig: { diameter: 60 }, passBins: [1] },
    { dies: passDies, waferConfig: { diameter: 60 }, passBins: [1] },
    { dies: passDies, waferConfig: { diameter: 60 }, passBins: [1] },
    { dies: patternDies, waferConfig: { diameter: 60 }, passBins: [1] },
    { dies: passDies, waferConfig: { diameter: 60 }, passBins: [1] },
    { dies: passDies, waferConfig: { diameter: 60 }, passBins: [1] },
  ], {
    ringCount: 3,
    minimumSampleSize: 3,
    minimumEffectSize: 0.2,
  });

  const html = renderFindingsReportHtml(lot);

  assert.match(html, /2\/6/);
  assert.doesNotMatch(html, /2\/4/);
});
test('analyzeWaferMap handles wafers with no data', () => {
  const { wafer, dies } = makeBaseDies();
  const emptyDies = dies.map(die => ({ ...die, hbin: undefined, sbin: undefined, values: undefined }));

  const summary = analyzeWaferMap({
    dies: emptyDies,
    waferConfig: { diameter: 60 },
    passBins: [1],
  });

  assert.equal(summary.level, 'wafer');
  assert.equal(summary.hasNotableFindings, false);
  assert.equal(summary.findings.length, 0);
});

test('analyzeWaferLot handles empty lot', () => {
  const lot = analyzeWaferLot([]);

  assert.equal(lot.level, 'lot');
  assert.equal(lot.hasNotableFindings, false);
  assert.equal(lot.findings.length, 0);
  assert.equal(lot.perWafer.length, 0);
});

test('analyzeWaferLot lot identity: agreeing fields are kept, disagreeing fields are omitted and reported', () => {
  const { dies } = makeBaseDies();
  const passDies = dies.map((die) => ({ ...die, hbin: 1 }));

  const lot = analyzeWaferLot([
    { dies: passDies, waferConfig: { diameter: 60, metadata: { lot: 'LOT-A', product: 'X1', waferId: 'W01' } }, passBins: [1] },
    { dies: passDies, waferConfig: { diameter: 60, metadata: { lot: 'LOT-A', product: 'X1', waferId: 'W02' } }, passBins: [1] },
    { dies: passDies, waferConfig: { diameter: 60, metadata: { lot: 'LOT-B', product: 'X1', waferId: 'W03' } }, passBins: [1] },
  ]);

  // 'lot' disagrees across wafers (A, A, B) — omitted from the identity, not
  // silently taken from the first wafer.
  assert.equal(lot.lot.lot, undefined);
  // 'product' agrees across all three wafers — kept.
  assert.equal(lot.lot.product, 'X1');
  // 'waferId' is always excluded from lot identity, agreeing or not.
  assert.equal(lot.lot.waferId, undefined);
  assert.deepEqual(lot.mixedIdentityFields, ['lot']);
});

test('analyzeWaferLot lot identity: fully agreeing wafers report no mixedIdentityFields', () => {
  const { dies } = makeBaseDies();
  const passDies = dies.map((die) => ({ ...die, hbin: 1 }));

  const lot = analyzeWaferLot([
    { dies: passDies, waferConfig: { diameter: 60, metadata: { lot: 'LOT-A', product: 'X1' } }, passBins: [1] },
    { dies: passDies, waferConfig: { diameter: 60, metadata: { lot: 'LOT-A', product: 'X1' } }, passBins: [1] },
  ]);

  assert.deepEqual(lot.lot, { lot: 'LOT-A', product: 'X1' });
  assert.equal(lot.mixedIdentityFields, undefined);
});

test('analyzeWaferMap populates perTestStats with quartiles', () => {
  const { dies } = makeBaseDies();
  const enriched = dies.map((die, i) => ({
    ...die,
    testValues: { 1050: i % 10 + Math.random() * 0.1 },
  }));

  const summary = analyzeWaferMap({
    dies: enriched,
    waferConfig: { diameter: 60 },
  }, { computePerTestStats: true });

  assert.ok(summary.stats.perTestStats, 'perTestStats should be populated');
  const entry = summary.stats.perTestStats.find(s => s.testNumber === 1050);
  assert.ok(entry, 'should have entry for test 1050');
  assert.ok(entry.count > 0);
  assert.ok(entry.q1 <= entry.median, 'q1 <= median');
  assert.ok(entry.median <= entry.q3, 'median <= q3');
  assert.ok(entry.min <= entry.q1, 'min <= q1');
  assert.ok(entry.q3 <= entry.max, 'q3 <= max');
});

test('test-value analysis is off by default — no test findings, no perTestStats', () => {
  const { wafer, dies } = makeBaseDies();
  const enriched = dies.map((die) => {
    const { quadrant } = classifyDie(die, wafer, { ringCount: 3 });
    return { ...die, hbin: 1, testValues: { 1050: quadrant === 'NE' ? 10 : 1 } };
  });

  const summary = analyzeWaferMap({
    dies: enriched,
    waferConfig: { diameter: 60 },
    testDefs: [{ testNumber: 1050, name: 'Idsat', unit: 'A' }],
  }, { minimumSampleSize: 3, minimumEffectSize: 0.2 });

  assert.ok(!summary.findings.some(f => f.variable.kind === 'test'),
    'no test-value findings should be produced by default');
  assert.equal(summary.stats.perTestStats, undefined,
    'perTestStats should not be populated by default');
});

test('computePerTestStats yields quartiles WITHOUT regional test findings', () => {
  const { wafer, dies } = makeBaseDies();
  const enriched = dies.map((die) => {
    const { quadrant } = classifyDie(die, wafer, { ringCount: 3 });
    return { ...die, hbin: 1, testValues: { 1050: quadrant === 'NE' ? 10 : 1 } };
  });

  const summary = analyzeWaferMap({
    dies: enriched,
    waferConfig: { diameter: 60 },
    testDefs: [{ testNumber: 1050, name: 'Idsat', unit: 'A' }],
  }, { computePerTestStats: true, minimumSampleSize: 3, minimumEffectSize: 0.2 });

  assert.ok(summary.stats.perTestStats?.length, 'perTestStats should be populated');
  assert.ok(!summary.findings.some(f => f.variable.kind === 'test'),
    'computePerTestStats must NOT run the regional Welch findings pass');
});

test('enableTestValueAnalysis implies perTestStats', () => {
  const { wafer, dies } = makeBaseDies();
  const enriched = dies.map((die) => {
    const { quadrant } = classifyDie(die, wafer, { ringCount: 3 });
    return { ...die, hbin: 1, testValues: { 1050: quadrant === 'NE' ? 10 : 1 } };
  });

  const summary = analyzeWaferMap({
    dies: enriched,
    waferConfig: { diameter: 60 },
    testDefs: [{ testNumber: 1050, name: 'Idsat', unit: 'A' }],
  }, { enableTestValueAnalysis: true, minimumSampleSize: 3, minimumEffectSize: 0.2 });

  assert.ok(summary.stats.perTestStats?.length,
    'enableTestValueAnalysis should also populate perTestStats');
});

test('test-value findings — constant-per-region values produce NO finding (zero within-group variance)', () => {
  // Two rings only, value constant within each (inner ring = 1, outer = 10).
  // With exactly two regions, the only comparison is constant-vs-constant — ZERO
  // within-group spread on both sides. Welch is undefined on constant groups; the
  // difference is statistically unmeasurable, so NO test-value finding should fire
  // (regression for the old p=0 / infinite-effect behaviour). Other region
  // families are disabled so none can straddle the ring boundary and reintroduce
  // variance into the "rest of wafer" comparison.
  const { wafer, dies } = makeBaseDies();
  const enriched = dies.map((die) => {
    const { ring } = classifyDie(die, wafer, { ringCount: 2 });
    return { ...die, hbin: 1, testValues: { 1050: ring === 2 ? 10 : 1 } };
  });

  const summary = analyzeWaferMap({
    dies: enriched,
    waferConfig: { diameter: 60 },
    testDefs: [{ testNumber: 1050, name: 'Idsat', unit: 'A' }],
  }, {
    ringCount: 2,
    enableTestValueAnalysis: true,
    enableAngularAnalysis: false,         // no sectors straddling the ring boundary
    enableReticlePositionAnalysis: false,
    enableTestSiteAnalysis: false,
    minimumSampleSize: 3,
    minimumEffectSize: 0.2,
  });

  assert.ok(!summary.findings.some(f => f.variable.kind === 'test'),
    'constant-vs-constant values must not produce any test-value finding');
});

test('test-value findings — stable on large-magnitude, low-variance values', () => {
  // Values ~1e6 with a tiny (~few-ppm) spread and a real ~0.5 NE shift. The raw
  // one-pass variance (Σx² − n·mean²) catastrophically cancels at this scale and
  // would mis-estimate variance (→ wrong/garbage p-values). The shifted
  // accumulator must still detect the genuine NE difference.
  const { wafer, dies } = makeBaseDies();
  const enriched = dies.map((die) => {
    const { quadrant } = classifyDie(die, wafer, { ringCount: 3 });
    const jitter = (((die.x * 7 + die.y * 13) % 10) - 4.5) * 0.1; // ~±0.45 within-group
    const base = 1_000_000 + (quadrant === 'NE' ? 0.6 : 0); // tiny real shift on a huge base
    return { ...die, hbin: 1, testValues: { 1050: base + jitter } };
  });

  const summary = analyzeWaferMap({
    dies: enriched,
    waferConfig: { diameter: 60 },
    testDefs: [{ testNumber: 1050, name: 'Idsat', unit: 'V' }],
  }, { enableTestValueAnalysis: true, minimumSampleSize: 3, minimumEffectSize: 0.2 });

  const testFinding = summary.findings.find(
    f => f.variable.kind === 'test' && f.comparison.left === 'NE',
  );
  assert.ok(testFinding, 'should detect the NE shift even on a 1e6 base');
  assert.ok(Number.isFinite(testFinding.stats.pValue), 'p-value must be finite');
  assert.ok(testFinding.stats.pValue >= 0 && testFinding.stats.pValue <= 1, 'p-value in [0,1]');
});

test('yield findings — hbin-less (sbin-only) dies are not counted as fails (H3)', () => {
  // Outer ring: every die actually PASSES (hbin 1) but half carry only an sbin and
  // no hbin. Inner rings: all pass with hbin 1. With the old full-bucket denominator
  // the sbin-only outer dies counted as fails, deflating outer-ring yield to ~50%
  // and manufacturing a spurious "outer ring lower yield" finding. With the
  // hbin-bearing denominator the outer ring is correctly 100% pass → no finding.
  const { wafer, dies } = makeBaseDies();
  let n = 0;
  const enriched = dies.map((die) => {
    const { ring } = classifyDie(die, wafer, { ringCount: 3 });
    if (ring === 3) {
      const sbinOnly = (n++ % 2 === 0);
      return sbinOnly
        ? { ...die, sbin: 1 }            // eligible via sbin, NO hbin
        : { ...die, hbin: 1, sbin: 1 };  // genuine pass
    }
    return { ...die, hbin: 1, sbin: 1 };
  });

  const summary = analyzeWaferMap({
    dies: enriched,
    waferConfig: { diameter: 60 },
    passBins: [1],
  }, { ringCount: 3, minimumSampleSize: 3, minimumEffectSize: 0.05 });

  const outerYieldFinding = summary.findings.find(
    f => f.variable.kind === 'yield' && /Ring 3/.test(f.comparison.left ?? ''),
  );
  assert.ok(!outerYieldFinding,
    'sbin-only dies must not deflate outer-ring yield into a spurious finding');
});

test('analyzeWaferMap respects minimum sample size filtering', () => {
  const { wafer, dies } = makeBaseDies();
  // Create a wafer with very few dies in each ring
  const minimalDies = dies.slice(0, 2).map((die, i) => ({
    ...die,
    hbin: i === 0 ? 1 : 2,
  }));

  const summary = analyzeWaferMap({
    dies: minimalDies,
    waferConfig: { diameter: 60 },
    passBins: [1],
  }, {
    minimumSampleSize: 5, // Higher than available
  });

  assert.equal(summary.hasNotableFindings, false);
});

test('functional tests (testType F) are excluded from perTestStats and test-value findings', () => {
  const { wafer, dies } = makeBaseDies();
  const enriched = dies.map((die, i) => {
    const { quadrant } = classifyDie(die, wafer, { ringCount: 3 });
    return {
      ...die,
      testValues: {
        1050: quadrant === 'NE' ? 10 : 1,   // parametric, with a strong regional signal
        2001: i % 7 === 0 ? 0 : 1,          // functional pass/fail outcome
      },
    };
  });
  const testDefs = [
    { testNumber: 1050, name: 'Idsat', unit: 'A' },
    { testNumber: 2001, name: 'scan_chain', testType: 'F' },
  ];

  const summary = analyzeWaferMap({
    dies: enriched,
    waferConfig: { diameter: 60 },
    testDefs,
  }, { enableTestValueAnalysis: true, computePerTestStats: true, minimumSampleSize: 3, minimumEffectSize: 0.2 });

  assert.ok(summary.stats.perTestStats.some(s => s.testNumber === 1050),
    'parametric test should appear in perTestStats');
  assert.ok(!summary.stats.perTestStats.some(s => s.testNumber === 2001),
    'functional test must not appear in perTestStats');
  assert.ok(!summary.findings.some(f => f.variable.kind === 'test' && f.variable.index === 2001),
    'functional test must not produce test-value findings');
});

test('functional tests are excluded even when explicitly requested via testNumbers', () => {
  const { dies } = makeBaseDies();
  const enriched = dies.map((die, i) => ({ ...die, testValues: { 2001: i % 2 } }));

  const summary = analyzeWaferMap({
    dies: enriched,
    waferConfig: { diameter: 60 },
    testDefs: [{ testNumber: 2001, name: 'scan_chain', testType: 'F' }],
  }, { computePerTestStats: true, testNumbers: [2001] });

  assert.equal(summary.stats.perTestStats, undefined,
    'no perTestStats when the only requested test is functional');
});

test('functionalYield: per-test pass rate with verdict-only denominators', () => {
  const { dies } = makeBaseDies();
  const enriched = dies.map((die, i) => ({
    ...die,
    // 2001 via recorded verdicts: every 5th die has NO verdict, every 3rd fails.
    ...(i % 5 === 0 ? {} : { testPass: { 2001: i % 3 !== 0 } }),
    // 2002 via legacy 0/1 encoding.
    testValues: { 2002: i % 4 === 0 ? 0 : 1 },
  }));
  const testDefs = [
    { testNumber: 2001, name: 'scan_chain', testType: 'F' },
    { testNumber: 2002, name: 'bist', testType: 'F' },
  ];

  const summary = analyzeWaferMap({ dies: enriched, waferConfig: { diameter: 60 }, testDefs });
  const fy = summary.stats.functionalYield;
  assert.ok(fy, 'functionalYield populated when functional defs exist');

  const scan = fy.find(t => t.testNumber === 2001);
  const active = enriched.filter(d => !d.partial && !d.edgeExcluded);
  const expectedTotal = active.filter((_, ) => true).filter(d => d.testPass?.[2001] !== undefined).length;
  assert.equal(scan.totalDies, expectedTotal, 'denominator = dies with a verdict only');
  assert.equal(scan.passDies + scan.failDies, scan.totalDies);
  assert.ok(scan.passRatePercent > 0 && scan.passRatePercent < 100);

  const bist = fy.find(t => t.testNumber === 2002);
  assert.ok(bist, 'legacy 0/1-encoded functional test gets a pass rate too');
  assert.equal(bist.passDies + bist.failDies, bist.totalDies);

  // A parametric test never appears in functionalYield.
  assert.ok(!fy.some(t => t.testNumber === 1050));
});

test('regional functional pass-rate finding fires on a low-pass-rate quadrant', () => {
  const { wafer, dies } = makeBaseDies();
  const enriched = dies.map((die) => {
    const { quadrant } = classifyDie(die, wafer, { ringCount: 3 });
    return { ...die, hbin: 1, testPass: { 2001: quadrant === 'NE' ? false : true } };
  });
  const testDefs = [{ testNumber: 2001, name: 'scan_chain', testType: 'F' }];

  const summary = analyzeWaferMap({
    dies: enriched,
    waferConfig: { diameter: 60 },
    testDefs,
  }, { enableTestValueAnalysis: true, minimumSampleSize: 3, minimumEffectSize: 0.2 });

  const f = summary.findings.find(x => x.variable.kind === 'functionalTest');
  assert.ok(f, 'a functionalTest finding should be produced');
  assert.equal(f.stats.method, 'two-proportion-z');
  assert.match(f.variable.label, /scan_chain pass rate/);
  assert.match(f.summary, /pass rate .* percentage points lower/);
  assert.equal(f.highlight?.kind, 'region');
});

test('no functional findings or functionalYield without functional defs', () => {
  const { dies } = makeBaseDies();
  const enriched = dies.map((die, i) => ({ ...die, hbin: 1, testValues: { 1050: i } }));
  const summary = analyzeWaferMap({
    dies: enriched,
    waferConfig: { diameter: 60 },
    testDefs: [{ testNumber: 1050, name: 'Idsat' }],
  }, { enableTestValueAnalysis: true });
  assert.equal(summary.stats.functionalYield, undefined);
  assert.ok(!summary.findings.some(f => f.variable.kind === 'functionalTest'));
});
