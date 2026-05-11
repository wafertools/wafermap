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
    return {
      ...die,
      values: [quadrant === 'NE' ? 10 : 1],
      hbin: quadrant === 'NE' ? 8 : 1,
      sbin: ring === 3 ? 23 : 1,
    };
  });

  const summary = analyzeWaferMap({
    dies: enriched,
    waferConfig: { diameter: 60 },
    passBins: [1],
    testDefs: [{ index: 0, name: 'Idsat', unit: 'A' }],
    hbinDefs: [{ bin: 8, name: 'NE Fail' }],
    sbinDefs: [{ bin: 23, name: 'Edge Signature' }],
  }, {
    ringCount: 3,
    minimumSampleSize: 3,
    minimumEffectSize: 0.2,
    enableYieldAnalysis: false,
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
    const localCol = ((die.i % 2) + 2) % 2;
    const localRow = ((die.j % 2) + 2) % 2;
    const isBadCell = localCol === 1 && localRow === 0;
    return {
      ...die,
      values: [isBadCell ? 10 : 1],
      hbin: isBadCell ? 9 : 1,
      sbin: isBadCell ? 31 : 1,
    };
  });

  const summary = analyzeWaferMap({
    dies: enriched,
    waferConfig: { diameter: 60 },
    reticleConfig: { width: 2, height: 2 },
    passBins: [1],
    testDefs: [{ index: 0, name: 'Leakage', unit: 'A' }],
    hbinDefs: [{ bin: 9, name: 'Reticle Cell Fail' }],
    sbinDefs: [{ bin: 31, name: 'Reticle Cell Soft Fail' }],
  }, {
    minimumSampleSize: 3,
    minimumEffectSize: 0.2,
    enableYieldAnalysis: false,
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
  assert.equal(lot.perWafer[2].summary.hasNotableFindings, false);
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
