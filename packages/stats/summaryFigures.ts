// Figures carried on StatsSummary / LotStatsSummary that the Insights charts,
// Summary panel and reports also show: capability, tester-verdict pass rates and
// region yield. Each is computed by the same builder the chart or panel uses, so
// a host reading the analysis output and an engineer reading the chart see the
// same numbers. These replace the chart-data builders a host previously had to
// call itself (deprecated in 0.30.0).
//
// @internal — the fields are the contract, not these functions.

import type { Die, Wafer } from '../core/index.js';
import type { TestDef } from '../renderer/buildWaferMap.js';
import { itemPassBins } from '../core/passBins.js';
import { buildCapabilityFigures, poolCapabilityFigures } from './capability.js';
import { buildTestPassRateData, hasJudgeableTests, poolFunctionalYield } from './testPassRate.js';
import { buildRegionYieldData, buildRingRegions, buildQuadrantRegions } from './regions.js';
import type {
  TestCapability, TestVerdictYield, RegionYield, RegionYieldFigures, StatsSummary,
} from './types.js';

/** Capability over `items` (each one wafer — the subgroup), restricted to `testNumbers`. */
export function computeCapability(
  items: { dies: Die[] }[],
  testDefs: TestDef[] | undefined,
  testNumbers: readonly number[],
): TestCapability[] | undefined {
  if (!testDefs?.length || !testNumbers.length) return undefined;
  const wanted = new Set(testNumbers);
  // Not the chart builder: its normalised five-number fields are not the test's
  // real minimum and quartiles, and collecting and sorting every value for them
  // was most of the cost.
  const rows = buildCapabilityFigures(items, testDefs.filter(d => wanted.has(d.testNumber)));
  return rows.length ? rows : undefined;
}

/**
 * Lot capability pooled from each wafer's own `stats.capability` — exact, and
 * without revisiting a die. Absent unless every wafer has capability, like the
 * other pooled lot figures.
 */
export function poolCapability(summaries: StatsSummary[], testDefs: TestDef[]): TestCapability[] | undefined {
  const perWafer = summaries.map(s => s.stats.capability);
  if (!perWafer.length || perWafer.some(c => c === undefined)) return undefined;
  const rows = poolCapabilityFigures(perWafer as TestCapability[][], testDefs);
  return rows.length ? rows : undefined;
}

/** Pass rates by the tester's recorded verdict, plus the spec/verdict disagreement count. */
export function computeTestFlagYield(
  dies: Die[],
  testDefs: TestDef[] | undefined,
): { testFlagYield?: TestVerdictYield[]; specVerdictDisagreementDies?: number } {
  if (!hasJudgeableTests(testDefs, 'testFlag', dies)) return {};
  const data = buildTestPassRateData([{ key: '', items: [{ dies }] }], testDefs, 'testFlag');
  const out: { testFlagYield?: TestVerdictYield[]; specVerdictDisagreementDies?: number } = {};
  if (data.rows.length) {
    out.testFlagYield = data.rows.map(r => ({ testNumber: r.testNumber, label: r.label, ...r.overall }));
  }
  if (data.disagreementDies !== null) out.specVerdictDisagreementDies = data.disagreementDies;
  return out;
}

/**
 * Ring and quadrant yield over one or more wafers, each die judged by its own
 * wafer's pass bins and rings by its own ring count. Rings are pooled only when
 * every wafer has the same ring count — otherwise there are no common rings
 * (the gallery raises `ring-count-mixed` for the same case) and `ring` is absent.
 */
export function computeRegionYield(
  maps: { dies: Die[]; wafer: Wafer; passBins?: readonly number[]; ringCount: number }[],
): RegionYieldFigures | undefined {
  if (!maps.length) return undefined;
  const diesByWafer = maps.map(m => m.dies);
  const wafers = maps.map(m => m.wafer);
  const passBins = (wi: number) => itemPassBins(maps[wi]);
  const ringCounts = new Set(maps.map(m => m.ringCount));
  // Quadrants do not depend on ring count; the first wafer's is as good as any.
  const quadrant = buildRegionYieldData(diesByWafer, wafers, maps[0].ringCount, passBins, buildQuadrantRegions);
  const ring = ringCounts.size === 1
    ? buildRegionYieldData(diesByWafer, wafers, maps[0].ringCount, passBins, buildRingRegions)
    : undefined;
  if (!quadrant.length && !ring?.length) return undefined;
  return { ...(ring?.length ? { ring } : {}), quadrant };
}

/**
 * Lot region yield pooled from each wafer's own `regionYield`: pass and die
 * counts summed per region key, first-appearance order. Pooled from the
 * summaries rather than recomputed over every die, so a lot analysis given
 * `perWaferSummaries` stays cheap. Same rule as the pass rates: absent unless
 * every wafer has it, and rings pool only when every wafer has the same ring
 * count (the gallery raises `ring-count-mixed` for the same case).
 */
export function poolRegionYield(summaries: StatsSummary[], ringCounts: readonly number[]): RegionYieldFigures | undefined {
  const figures = summaries.map(s => s.stats.regionYield);
  if (!figures.length || figures.some(f => f === undefined)) return undefined;
  const pool = (lists: (RegionYield[] | undefined)[]): RegionYield[] | undefined => {
    if (lists.some(l => l === undefined)) return undefined;
    const byKey = new Map<string, RegionYield>();
    for (const list of lists) for (const r of list!) {
      const acc = byKey.get(r.key);
      if (acc) { acc.n += r.n; acc.passDies += r.passDies; }
      else byKey.set(r.key, { ...r });
    }
    const rows = [...byKey.values()];
    for (const r of rows) r.yieldPercent = (r.passDies / r.n) * 100;
    return rows.length ? rows : undefined;
  };
  const quadrant = pool(figures.map(f => f!.quadrant));
  const ring = new Set(ringCounts).size === 1 ? pool(figures.map(f => f!.ring)) : undefined;
  if (!quadrant && !ring) return undefined;
  return { ...(ring ? { ring } : {}), quadrant: quadrant ?? [] };
}

/**
 * Sum per-test counts across wafers, keeping first-appearance order — the same
 * rule as `poolFunctionalYield`: `undefined` unless EVERY wafer reported the
 * figure, since a rate pooled over part of the lot and presented as the lot's is
 * quietly wrong.
 */
function poolByTest<T extends { testNumber: number; label: string }>(
  lists: (T[] | undefined)[],
  add: (into: T, from: T) => void,
  finish: (row: T) => void,
): T[] | undefined {
  if (!lists.length || lists.some(l => l === undefined)) return undefined;
  const byTest = new Map<number, T>();
  for (const list of lists) for (const row of list ?? []) {
    const acc = byTest.get(row.testNumber);
    if (acc) add(acc, row);
    else byTest.set(row.testNumber, { ...row });
  }
  if (!byTest.size) return undefined;
  const rows = [...byTest.values()];
  rows.forEach(finish);
  return rows;
}

const pct = (pass: number, total: number): number | null => total === 0 ? null : (pass / total) * 100;

/** The lot-level pass-rate figures: each wafer's counts, summed per test, only when every wafer has them. */
export function poolPassRates(summaries: StatsSummary[]): {
  testSpecYield?: NonNullable<StatsSummary['stats']['testSpecYield']>;
  functionalYield?: NonNullable<StatsSummary['stats']['functionalYield']>;
  testFlagYield?: TestVerdictYield[];
  specVerdictDisagreementDies?: number;
} {
  const out: ReturnType<typeof poolPassRates> = {};
  const spec = poolByTest(summaries.map(s => s.stats.testSpecYield),
    (a, b) => { a.passDies += b.passDies; a.failLowDies += b.failLowDies; a.failHighDies += b.failHighDies; a.totalDies += b.totalDies; },
    r => { r.yieldPercent = pct(r.passDies, r.totalDies); });
  if (spec) out.testSpecYield = spec;
  const addVerdicts = (a: TestVerdictYield, b: TestVerdictYield) => { a.passDies += b.passDies; a.failDies += b.failDies; a.totalDies += b.totalDies; };
  const finishVerdicts = (r: TestVerdictYield) => { r.passRatePercent = pct(r.passDies, r.totalDies); };
  const functional = poolFunctionalYield(summaries);
  if (functional) out.functionalYield = functional;
  const flag = poolByTest(summaries.map(s => s.stats.testFlagYield), addVerdicts, finishVerdicts);
  if (flag) {
    // Worst first, as for one wafer; a test no die had a verdict for sorts last.
    out.testFlagYield = flag.sort((a, b) => (a.passRatePercent ?? Infinity) - (b.passRatePercent ?? Infinity));
  }
  const disagreements = summaries.map(s => s.stats.specVerdictDisagreementDies);
  if (disagreements.length && disagreements.every(n => n !== undefined)) {
    out.specVerdictDisagreementDies = (disagreements as number[]).reduce((a, b) => a + b, 0);
  }
  return out;
}
