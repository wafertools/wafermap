import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCorrelationMatrix, filterCorrelationMatrix, CORRELATION_DIE_BUDGET, correlationSampleNote } from '../dist/packages/stats/correlation.js';

const testDefs = [
  { testNumber: 1, name: 'T1' },
  { testNumber: 2, name: 'T2' },
  { testNumber: 3, name: 'T3' },
];

test('buildCorrelationMatrix — returns empty cells for fewer than 2 tests', () => {
  const matrix = buildCorrelationMatrix([], [{ testNumber: 1, name: 'T1' }]);
  assert.deepEqual(matrix.cells, []);
});

test('buildCorrelationMatrix — diagonal is always r=1', () => {
  const dies = Array.from({ length: 5 }, (_, i) => ({ x: i, y: 0, testValues: { 1: i, 2: i * 2, 3: 100 - i } }));
  const matrix = buildCorrelationMatrix(dies, testDefs);
  for (const cell of matrix.cells) {
    if (cell.xIndex === cell.yIndex) assert.equal(cell.r, 1);
  }
});

test('filterCorrelationMatrix — still shows tests when every off-diagonal r is null (zero variance)', () => {
  const dies = Array.from({ length: 5 }, () => ({ x: 0, y: 0, testValues: { 1: 1, 2: 2, 3: 3 } }));
  const matrix = buildCorrelationMatrix(dies, testDefs);
  const offDiagNonNull = matrix.cells.filter(c => c.xIndex !== c.yIndex && c.r !== null);
  assert.equal(offDiagNonNull.length, 0);

  const { matrix: filtered, strongestPair } = filterCorrelationMatrix(matrix, { minTests: 6, maxTests: 20 });
  assert.equal(filtered.tests.length, 3);
  assert.equal(strongestPair, null);
});

test('filterCorrelationMatrix — selects correlated tests normally when data has variance', () => {
  const dies = Array.from({ length: 20 }, (_, i) => ({ x: i, y: 0, testValues: { 1: i, 2: i * 2, 3: 100 - i } }));
  const matrix = buildCorrelationMatrix(dies, testDefs);
  const { strongestPair } = filterCorrelationMatrix(matrix, { minTests: 6, maxTests: 20 });
  assert.ok(strongestPair !== null);
  assert.ok(Math.abs(Math.abs(strongestPair.r) - 1) < 1e-5);
});

test('buildCorrelationMatrix — functional tests (testType F) are excluded from the matrix', () => {
  const dies = Array.from({ length: 5 }, (_, i) => ({ x: i, y: 0, testValues: { 1: i, 2: i * 2, 9: i % 2 } }));
  const defs = [...testDefs, { testNumber: 9, name: 'scan_chain', testType: 'F' }];
  const matrix = buildCorrelationMatrix(dies, defs);
  assert.ok(!matrix.tests.some(t => t.testNumber === 9), 'functional test must not appear on matrix axes');
  assert.ok(matrix.tests.some(t => t.testNumber === 1), 'parametric tests still present');
});

// ── Sampling above CORRELATION_DIE_BUDGET ────────────────────────────────────

test('correlation — below the budget, every die is read and nothing claims a sample', () => {
  const dies = Array.from({ length: 1000 }, (_, i) => ({ x: i, y: 0, testValues: { 1: i, 2: i * 2, 3: 100 - i } }));
  const m = buildCorrelationMatrix(dies, testDefs);
  assert.equal(m.sample, undefined, 'an unsampled matrix must not carry a sample note');
  const pair = m.cells.find(c => c.xIndex === 0 && c.yIndex === 1);
  assert.equal(pair.n, 1000, 'all dies contribute when under budget');
});

test('correlation — above the budget it samples, and says so', () => {
  const n = CORRELATION_DIE_BUDGET * 3;
  const dies = Array.from({ length: n }, (_, i) => ({ x: i, y: 0, testValues: { 1: i, 2: i * 2, 3: 100 - i } }));
  const m = buildCorrelationMatrix(dies, testDefs);
  assert.ok(m.sample, 'a sampled matrix must declare it');
  assert.equal(m.sample.of, n);
  assert.equal(m.sample.used, CORRELATION_DIE_BUDGET);
  const pair = m.cells.find(c => c.xIndex === 0 && c.yIndex === 1);
  assert.equal(pair.n, CORRELATION_DIE_BUDGET, 'n reports the dies actually read');
  // The sample must not change the answer for a relationship this clean.
  assert.ok(Math.abs(pair.r - 1) < 1e-12, `perfectly correlated pair still reads r=1, got ${pair.r}`);
});

test('correlation — the sample spans the whole population, not a prefix', () => {
  // The failure this guards: dies arrive grouped by wafer, so reading the first
  // 25,000 of a large lot describes the first few wafers. Here the value encodes
  // position, so a prefix sample would show a mean far below the population's.
  const n = CORRELATION_DIE_BUDGET * 4;
  const dies = Array.from({ length: n }, (_, i) => ({ x: i, y: 0, testValues: { 1: i, 2: i * 2, 3: 100 - i } }));
  const m = buildCorrelationMatrix(dies, testDefs);
  assert.ok(m.sample);

  // Reconstruct which dies were read from the accumulators is not exposed, so
  // assert via a signal only a spread sample can produce: correlate position
  // against a value that only differs in the LAST quarter of the population. A
  // prefix sample would never see it and would report r for a constant.
  const skewed = Array.from({ length: n }, (_, i) => ({
    x: i, y: 0,
    testValues: { 1: i, 2: i < n * 0.75 ? 0 : 1, 3: 0 },
  }));
  const ms = buildCorrelationMatrix(skewed, testDefs);
  const pair = ms.cells.find(c => c.xIndex === 0 && c.yIndex === 1);
  assert.ok(pair.r !== null && pair.r > 0.5,
    `a spread sample must see the last quarter's signal (r=${pair.r}); a prefix sample reports null or ~0`);
});

test('correlationSampleNote — names both numbers, or nothing when unsampled', () => {
  assert.equal(correlationSampleNote(undefined), undefined);
  const note = correlationSampleNote({ of: 400000, used: 25000 });
  assert.match(note, /25,000/);
  assert.match(note, /400,000/);
});
