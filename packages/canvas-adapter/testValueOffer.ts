// The Findings section's offer to run a test-value analysis that did not run, built from what the summary
// records (`stats.testValueAnalysis`). One copy for the single map and the gallery, so both say the same thing.

import type { TestValueAnalysisStatus } from '../stats/types.js';
import type { FindingsNotice } from './summaryPanel.js';

/**
 * "about 400 ms" / "about 2.5 s" / "about 10 s" — a duration the reader can act on. Deliberately coarse and
 * hedged: the estimate is a linear model, and "9,687 ms" would claim a precision it does not have.
 */
export function describeDuration(ms: number): string {
  if (ms < 1000) return `about ${Math.max(1, Math.round(ms / 100)) * 100} ms`;
  if (ms < 10_000) return `about ${(ms / 1000).toFixed(ms < 3000 ? 1 : 0)} s`;
  return `about ${Math.round(ms / 5000) * 5} s`;
}

const count = (n: number): string => n.toLocaleString('en-GB');

/**
 * The notice for a test-value analysis that did not run (`status` from a summary's `stats.testValueAnalysis`, over
 * `wafers` wafers), or `undefined` when it ran or there are no test values. While `running`, the same row says so
 * and offers nothing, so a second click cannot start a second run.
 */
export function testValueNotice(
  status: TestValueAnalysisStatus | undefined,
  wafers: number,
  running: boolean,
  onAnalyse: () => void,
): FindingsNotice | undefined {
  if (!status || status.state === 'done') return undefined;
  // "parametric": the count leaves out functional (pass/fail) tests, which have no values to compare, so it can be
  // smaller than the test count stated elsewhere.
  const size = `${count(status.tests)} parametric test${status.tests === 1 ? '' : 's'} on ${count(status.dies)} dies`
    + (wafers > 1 ? ` across ${count(wafers)} wafers` : '');
  if (running) return { message: 'Analysing test values…', detail: `${size}, ${describeDuration(status.estimateMs)}.` };
  return {
    message: status.state === 'skipped'
      ? 'Test-value findings are not included: the analysis is too large to run without asking.'
      : 'Test-value findings are not included.',
    detail: `Comparing each test's values between regions: ${size}, ${describeDuration(status.estimateMs)}.`
      + (status.state === 'skipped' ? ' Limit-failure findings are included.' : ''),
    actionLabel: 'Analyse',
    onAction: onAnalyse,
  };
}
