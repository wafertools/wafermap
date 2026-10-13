// The test-value analysis budget: whether `enableTestValueAnalysis: 'auto'` runs, and what a summary records about
// it (`TestValueAnalysisStatus`). Its own small module so the renderers can read a status without loading the
// analysis itself.

import type { StatsSummary, TestValueAnalysisStatus } from './types.js';

/**
 * How many test values (dies × parametric tests) the test-value analysis takes on when `enableTestValueAnalysis`
 * is `'auto'`, summed over a lot's wafers so a lot decides once. The pass is a linear scan of every value, at
 * {@link TEST_VALUE_US_PER_VALUE} in the slower engine, so this is about a second there: 150 tests on a
 * 10,000-die wafer, 500 on a 3,000-die one. Above it the analysis is skipped and the renderers offer to run it.
 */
export const TEST_VALUE_AUTO_BUDGET = 1_500_000;

/** docs/performance.md's figure for WebKit, the desktop app's engine: ~0.65µs a value (V8 ~0.3µs). */
const TEST_VALUE_US_PER_VALUE = 0.65;

/** The size of a test-value analysis over `dies` and `tests`, and what became of it. */
export function testValueStatus(state: TestValueAnalysisStatus['state'], tests: number, dies: number): TestValueAnalysisStatus {
  const values = tests * dies;
  return { state, tests, dies, values, estimateMs: (values * TEST_VALUE_US_PER_VALUE) / 1000 };
}

/** `'auto'` decided over `values`: run it when the values fit the budget. */
export function autoDecision(values: number): 'done' | 'skipped' {
  return values <= TEST_VALUE_AUTO_BUDGET ? 'done' : 'skipped';
}

/** A lot's test-value status from its wafers': sizes and time summed (tests: the most on any wafer). */
export function lotTestValueStatus(summaries: StatsSummary[]): TestValueAnalysisStatus | undefined {
  const own = summaries.map(s => s.stats.testValueAnalysis).filter((t): t is TestValueAnalysisStatus => t !== undefined);
  if (!own.length) return undefined;
  const state = own.every(t => t.state === 'done') ? 'done' : own.some(t => t.state === 'skipped') ? 'skipped' : 'off';
  // Values and time summed per wafer, not the most tests × all dies: wafers can carry different tests.
  return {
    state,
    tests: own.reduce((most, t) => Math.max(most, t.tests), 0),
    dies: own.reduce((n, t) => n + t.dies, 0),
    values: own.reduce((n, t) => n + t.values, 0),
    estimateMs: own.reduce((n, t) => n + t.estimateMs, 0),
  };
}
