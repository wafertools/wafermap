// A stack by standard deviation or count holds spreads and tallies, not measurements
// of the test, so the test's limits say nothing about it: no limit fail, limit yield
// or capability against them, and no out-of-spec colouring. A stack by mean, median,
// minimum or maximum is in the test's units and keeps them.

import test from 'node:test';
import assert from 'node:assert/strict';
import { buildWaferMap } from '../dist/index.js';
import { analyzeWaferMap } from '../dist/packages/stats/analyzeWaferMap.js';
import { makeResults, WAFER_CONFIG, DIE_CONFIG, TEST_DEFS } from '../docs/examples/data.js';

const LIMIT_FIELDS = ['limitLow', 'limitHigh', 'limitLowInclusive', 'limitHighInclusive', 'specLow', 'specHigh'];

function stack(method) {
  const results = [1, 2, 3, 4, 5, 6].map(seed => makeResults({ seed, quadrant: true }));
  const { waferId: _w, processSplit: _s, ...metadata } = WAFER_CONFIG.metadata;
  const result = buildWaferMap({ lotStack: { results, method }, waferConfig: { ...WAFER_CONFIG, metadata }, dieConfig: DIE_CONFIG, testDefs: TEST_DEFS, ringCount: 4 });
  return { result, summary: analyzeWaferMap(result, { enableTestValueAnalysis: true }) };
}

for (const method of ['stddev', 'count']) {
  test(`a ${method} stack carries no limits, so nothing is judged against them`, () => {
    const { result, summary } = stack(method);
    for (const def of result.testDefs) {
      assert.deepEqual(LIMIT_FIELDS.filter(f => def[f] !== undefined), [], `${def.name} keeps no limit`);
      assert.ok(def.name && def.testNumber !== undefined, 'the rest of the definition is kept');
    }
    assert.equal(summary.stats.testSpecYield, undefined);
    assert.deepEqual(summary.findings.filter(f => f.id.startsWith('specLimit:')).map(f => f.id), []);
    for (const row of summary.stats.capability ?? []) {
      assert.equal(row.hasSpec, false, `${row.label} has no specification to be capable against`);
      assert.equal(row.cpk ?? null, null);
      assert.equal(row.ppk ?? null, null);
    }
  });
}

for (const method of ['mean', 'median', 'min', 'max']) {
  test(`a ${method} stack keeps the limits: its values are in the test's units`, () => {
    const { result, summary } = stack(method);
    assert.ok(result.testDefs.some(d => d.limitLow !== undefined || d.limitHigh !== undefined));
    assert.ok(summary.stats.testSpecYield?.length > 0);
  });
}

test('the limits of the definitions the caller passed are left alone', () => {
  const before = JSON.stringify(TEST_DEFS);
  stack('stddev');
  assert.equal(JSON.stringify(TEST_DEFS), before);
});
