// Regressions from the review of v0.34.0..v0.35.1 work.

import test from 'node:test';
import assert from 'node:assert/strict';
import { buildWaferMap } from '../dist/index.js';
import { analyzeWaferMap } from '../dist/packages/stats/analyzeWaferMap.js';
import { renderWaferReportHtml } from '../dist/packages/stats/renderSummaryReport.js';
import { testValue } from '../dist/packages/core/dieTable.js';

const grid = (make) => {
  const results = [];
  for (let x = -9; x <= 9; x++) for (let y = -9; y <= 9; y++) if (Math.hypot(x, y) <= 9) results.push(make(x, y));
  return results;
};

test('a host constant named like a die field still reads as the constant without parentheses', () => {
  const r = buildWaferMap({
    results: grid((x, y) => ({ x, y, hbin: 1, testValues: { 1: 2 } })),
    waferConfig: { diameter: 300 },
    testDefs: [{ testNumber: 1, name: 'T1' }],
    derivedTests: [{ testNumber: 900001, name: 'Scaled', expression: 'site * t[1]', constants: { site: 3 } }],
  });
  assert.equal(testValue(r.dies[0], 900001), 6);
});

test('a test name in the excluded-values note is escaped in the report', () => {
  const r = buildWaferMap({
    results: grid((x, y) => ({ x, y, hbin: 1, testValues: { 1: x === 0 && y === 0 ? 9e9 : 1 } })),
    waferConfig: { diameter: 300 },
    testDefs: [{ testNumber: 1, name: 'VDD<3V & <b>x</b>', validLow: -10, validHigh: 10 }],
  });
  const html = renderWaferReportHtml(r, analyzeWaferMap(r));
  assert.ok(html.includes('VDD&lt;3V &amp; &lt;b&gt;x&lt;/b&gt; 1'), 'the name is escaped');
  assert.ok(!html.includes('<b>x</b>'));
});

test('a significance level below 0.01 can still report a large cluster', () => {
  const r = buildWaferMap({
    results: grid((x, y) => ({ x, y, hbin: x > 1 && x < 7 && y > 1 && y < 7 ? 2 : 1 })),
    waferConfig: { diameter: 300 }, passBins: [1], ringCount: 4,
  });
  const found = analyzeWaferMap(r, { significanceLevel: 0.001 }).findings.filter(f => f.comparison.family === 'cluster');
  assert.ok(found.length > 0, 'the permutation count follows the level');
  assert.ok(found.every(f => f.stats.pValue <= 0.001));
});
