import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCorrelationMatrix, filterCorrelationMatrix, CORRELATION_DIE_BUDGET, CORRELATION_TEST_BUDGET, CORRELATION_WORK_BUDGET, correlationSampleNote } from '../dist/packages/stats/correlation.js';

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
  assert.equal(correlationSampleNote({}), undefined);
  const note = correlationSampleNote({ sample: { of: 400000, used: 25000 } });
  assert.match(note, /25,000/);
  assert.match(note, /400,000/);
});

// A test program reaches thousands of parametric tests; the pairwise pass is
// quadratic in them. At 2,002 tests the matrix took 38 s and at 15,002 it never
// finished (tsmap, example-data mcu_auto / soc_big). Above the budget the tests
// are chosen first: most dies outside limits, then widest spread.
test('buildCorrelationMatrix — above the test budget, pairs only the chosen tests and says so', () => {
  const nTests = CORRELATION_TEST_BUDGET + 200;
  const defs = Array.from({ length: nTests }, (_, i) => ({ testNumber: i + 1, name: `T${i + 1}`, limitLow: -10, limitHigh: 10 }));
  // Tests 401 and 402 move together and fail on a quarter of the dies; the rest are quiet noise.
  const dies = Array.from({ length: 40 }, (_, d) => {
    const tv = {};
    for (let t = 1; t <= nTests; t++) tv[t] = Math.sin(d * 7.1 + t) * 0.01;
    tv[401] = d % 4 === 0 ? 20 + d : d * 0.1;
    tv[402] = tv[401] * 2 + 1;
    return { x: d, y: 0, testValues: tv };
  });
  const m = buildCorrelationMatrix(dies, defs);
  assert.equal(m.tests.length, CORRELATION_TEST_BUDGET);
  assert.deepEqual(m.testSample, { of: nTests, used: CORRELATION_TEST_BUDGET });
  assert.equal(m.cells.length, CORRELATION_TEST_BUDGET ** 2);
  const nums = m.tests.map(t => t.testNumber);
  assert.ok(nums.includes(401) && nums.includes(402), 'the failing, correlated pair is kept');
  assert.deepEqual(nums, [...nums].sort((a, b) => a - b), 'original test order kept');
  const { strongestPair } = filterCorrelationMatrix(m);
  assert.deepEqual([strongestPair.xLabel, strongestPair.yLabel].sort(), ['T401', 'T402']);
  assert.match(correlationSampleNote(m), new RegExp(`${CORRELATION_TEST_BUDGET} of ${nTests}`));
});

test('buildCorrelationMatrix — at or below the test budget, every test and no note', () => {
  const defs = Array.from({ length: 10 }, (_, i) => ({ testNumber: i + 1, name: `T${i + 1}` }));
  const dies = Array.from({ length: 8 }, (_, d) => ({ x: d, y: 0, testValues: Object.fromEntries(defs.map(t => [t.testNumber, d * t.testNumber])) }));
  const m = buildCorrelationMatrix(dies, defs);
  assert.equal(m.tests.length, 10);
  assert.equal(m.testSample, undefined);
});

// Pair updates are tests² × dies: 300 tests over the full 25k-die budget was 1.1×10⁹
// of them and 12 s in a browser (tsmap example-data lot25_stress). Past the work
// budget the dies are thinned, evenly, and the matrix says it is a sample.
test('buildCorrelationMatrix — thins the dies to the work budget, and says so', () => {
  const nTests = 300, nDies = 6000;
  const defs = Array.from({ length: nTests }, (_, i) => ({ testNumber: i + 1, name: `T${i + 1}` }));
  const dies = Array.from({ length: nDies }, (_, d) => {
    const tv = {};
    for (let t = 1; t <= nTests; t++) tv[t] = ((d * 31 + t * 17) % 97) + (t === 2 ? d : 0);
    return { x: d % 100, y: Math.floor(d / 100), testValues: tv };
  });
  const m = buildCorrelationMatrix(dies, defs);
  const pairs = nTests * (nTests - 1) / 2;
  const budget = Math.floor(CORRELATION_WORK_BUDGET / pairs);
  assert.ok(budget < nDies, 'the case is over the work budget');
  assert.deepEqual(m.sample, { of: nDies, used: budget });
  assert.match(correlationSampleNote(m), new RegExp(`${budget.toLocaleString()}-die sample of ${nDies.toLocaleString()}`));
});
