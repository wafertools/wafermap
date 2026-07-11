import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCorrelationMatrix, filterCorrelationMatrix } from '../dist/packages/stats/correlation.js';

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
