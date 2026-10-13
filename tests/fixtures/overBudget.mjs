// Die results with more test values than analyzeWaferMap's 'auto' analyses (TEST_VALUE_AUTO_BUDGET,
// 1,500,000 dies × tests): a 100 × 100 grid, 10,000 dies. `tests` defaults to 251 (2,510,000 values);
// values are deterministic.
export const OVER_BUDGET_DIES = 10_000;

export function overBudgetResults(tests = 251) {
  const results = [];
  for (let i = 0; i < OVER_BUDGET_DIES; i++) {
    const testValues = {};
    for (let t = 0; t < tests; t++) testValues[1000 + t] = ((i * 7 + t * 3) % 17) / 17;
    results.push({ x: i % 100, y: Math.floor(i / 100), hbin: 1, testValues });
  }
  return results;
}
