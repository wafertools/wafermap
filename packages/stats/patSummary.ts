/**
 * What part-average testing finds in a population, wafer by wafer and test by test (stats/pat.ts holds the rule): how
 * many dies are within their PAT limits, how many pass every test limit and bin yet sit outside the wafer's PAT limits
 * (the outliers PAT exists to catch), and how many fail anyway; and which tests the outliers are outside on.
 */

import type { Die } from '../core/dies.js';
import type { TestDef } from '../renderer/buildWaferMap.js';
import { patTests, waferPatLimits, waferPatVerdicts, PAT_SKEW_WARN } from './pat.js';

export interface PatWaferRow {
  label: string;
  /** Dies with a verdict: within, outlier or fails. */
  judged: number;
  within: number;
  outliers: number;
  fails: number;
}

export interface PatTestRow { testNumber: number; name: string; /** Outlier dies outside the PAT limits of this test. */ outliers: number }

/** A test whose values are lopsided on some wafers, where symmetric PAT limits fit less well. */
export interface PatSkewRow { testNumber: number; name: string; /** Wafers where it is lopsided, of the wafers with PAT limits for it. */ wafers: number; of: number; /** The most lopsided wafer's quartile skewness. */ worst: number }

export interface PatSummary {
  /** Tests PAT judged (parametric, with both limits). */
  tests: number;
  wafers: PatWaferRow[];
  /** Tests by the outliers they explain, most first; a die outside on several tests counts for each. */
  byTest: PatTestRow[];
  /** Tests that are lopsided on at least one wafer, most wafers first. */
  skewed: PatSkewRow[];
  total: Omit<PatWaferRow, 'label'>;
}

export function summarisePat(
  items: ReadonlyArray<{ label: string; dies: readonly Die[]; allDies?: readonly Die[]; passBins: readonly number[] }>,
  testDefs: readonly TestDef[],
): PatSummary | undefined {
  const judged = patTests(testDefs);
  if (judged.length === 0) return undefined;
  const wafers: PatWaferRow[] = [];
  const perTest = new Map<number, number>();
  const skew = new Map<number, { wafers: number; of: number; worst: number }>();
  for (const it of items) {
    // The limits belong to the whole wafer, whatever part of it is in view.
    const all = it.allDies ?? it.dies;
    const verdicts = waferPatVerdicts(all, testDefs, it.passBins);
    for (const [tn, lim] of waferPatLimits(all, testDefs, it.passBins).limits) {
      const e = skew.get(tn) ?? { wafers: 0, of: 0, worst: 0 };
      e.of++;
      if (Math.abs(lim.skew) >= PAT_SKEW_WARN) { e.wafers++; if (Math.abs(lim.skew) > Math.abs(e.worst)) e.worst = lim.skew; }
      skew.set(tn, e);
    }
    const row: PatWaferRow = { label: it.label, judged: 0, within: 0, outliers: 0, fails: 0 };
    const shown = new Set<Die>(it.dies);
    all.forEach((d, i) => {
      const v = verdicts[i];
      if (!v.verdict || !shown.has(d)) return;
      row.judged++;
      if (v.verdict === 'within') row.within++;
      else if (v.verdict === 'fails') row.fails++;
      else { row.outliers++; for (const tn of v.tests) perTest.set(tn, (perTest.get(tn) ?? 0) + 1); }
    });
    if (row.judged > 0) wafers.push(row);
  }
  if (wafers.length === 0) return undefined;
  const sum = (k: 'judged' | 'within' | 'outliers' | 'fails') => wafers.reduce((n, w) => n + w[k], 0);
  const byTest = [...perTest].map(([testNumber, outliers]) => ({ testNumber, name: testDefs.find(d => d.testNumber === testNumber)?.name || `Test ${testNumber}`, outliers }))
    .sort((a, b) => b.outliers - a.outliers || a.testNumber - b.testNumber);
  const nameOf = (tn: number) => testDefs.find(d => d.testNumber === tn)?.name || `Test ${tn}`;
  const skewed = [...skew].filter(([, e]) => e.wafers > 0).map(([testNumber, e]) => ({ testNumber, name: nameOf(testNumber), ...e }))
    .sort((a, b) => b.wafers / b.of - a.wafers / a.of || Math.abs(b.worst) - Math.abs(a.worst) || a.testNumber - b.testNumber);
  return { tests: judged.length, wafers, byTest, skewed, total: { judged: sum('judged'), within: sum('within'), outliers: sum('outliers'), fails: sum('fails') } };
}
