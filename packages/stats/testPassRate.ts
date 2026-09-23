// Per-test pass rate, broken down by group — "which test is failing, and is it
// failing more in one split than another?". Pure math, no DOM.
//
// THREE modes, not two, because a parametric test carries two independent
// pass/fail notions and they are different questions:
//
//   - 'spec'       — did the value fall inside the spec limits? Recomputed from
//                    `limitLow`/`limitHigh` (or read from `stats.testSpecYield`,
//                    which is the same judgement already computed per wafer).
//   - 'testFlag'   — did the TESTER call it a fail? The recorded verdict in
//                    `die.testPass`, read via `getTestPassStatus`. In STDF this is
//                    the PTR's own TEST_FLG pass/fail bits, which exist whether or
//                    not LO_LIMIT/HI_LIMIT are present.
//   - 'functional' — the recorded verdict for a functional ('F') test, which has
//                    no measured value and therefore only ever has this one.
//
// The first two can legitimately disagree — guard bands, dynamic or per-site
// limits, a tester applying criteria the exported limits do not describe, or a
// limits/data mismatch. Collapsing them into one "parametric pass rate" would
// silently pick a winner and hide exactly the discrepancy worth investigating, so
// they are separate modes and `TestPassRateData.disagreementDies` reports how far
// apart they are when both are available.
//
// A parametric test with neither limits nor a recorded verdict is genuinely
// unjudgeable and is excluded rather than reported as 100% — a fabricated pass
// rate is worse than an absent one.
//
// Rates, never raw counts. `binPareto.ts`'s clustered view compares die COUNTS
// across groups, which is right for a bin pareto; it would be wrong here, because
// splits routinely have different wafer counts and a group with twice the dies
// would show twice the failures while failing at the same rate.

import type { Die } from '../core/dies.js';
import { isYieldEligibleDie } from '../core/dies.js';
import { isParametricTest, getTestPassStatus, type TestDef } from '../renderer/buildWaferMap.js';
import { classifySpec } from '../renderer/spec.js';
import { testLabel, derivedFields } from '../renderer/testLabel.js';
import type { StatsSummary } from './types.js';

export type TestPassKind = 'spec' | 'testFlag' | 'functional';

export interface TestPassRateItem {
  dies?: Die[];
  /** `StatsSummary.stats.testSpecYield` — used directly when present. */
  testSpecYield?: StatsSummary['stats']['testSpecYield'];
  /** `StatsSummary.stats.functionalYield` — used directly when present. */
  functionalYield?: StatsSummary['stats']['functionalYield'];
}

export interface TestPassRateValue {
  passDies: number;
  failDies: number;
  /** Dies with a verdict for this test. `passDies + failDies`. */
  totalDies: number;
  /** null when no die in this group has a verdict — distinct from 0%. */
  passRatePercent: number | null;
}

export interface TestPassRateRow {
  testNumber: number;
  label: string;
  /** Pooled across every group — drives the worst-first ordering. */
  overall: TestPassRateValue;
  /** One entry per group, aligned to `TestPassRateData.groups`. */
  byGroup: TestPassRateValue[];
  /** Parametric only: which side of the spec the failures fell on. */
  failLowDies?: number;
  failHighDies?: number;
}

export interface TestPassRateData {
  /** Group keys in legend order. A single `''` entry means "ungrouped". */
  groups: string[];
  /** Worst overall pass rate first. */
  rows: TestPassRateRow[];
  /**
   * Dies whose spec-limit judgement and recorded tester verdict disagree, across
   * every test in `rows`. `null` when the comparison is not possible (a mode
   * other than the two parametric ones, or data carrying only one of the two
   * sources) — which is distinct from `0`, "both present and in full agreement".
   *
   * A non-zero count is not an error: guard bands and dynamic limits make it
   * expected. It is a prompt to look, which is why it is surfaced rather than
   * resolved by silently preferring one source.
   */
  disagreementDies: number | null;
}

const rate = (pass: number, total: number): number | null => total === 0 ? null : (pass / total) * 100;

/**
 * One row per judgeable test, worst pass rate first.
 *
 * Pass a single group (any key) for the ungrouped case — the shape is identical
 * and the chart renders one bar per test instead of a cluster, so there is no
 * second code path for "no grouping".
 */
export function buildTestPassRateData(
  groups: { key: string; items: TestPassRateItem[] }[],
  testDefs: TestDef[] | undefined,
  kind: TestPassKind,
): TestPassRateData {
  const groupOrder = groups.map(g => g.key);
  const empty: TestPassRateData = { groups: groupOrder, rows: [], disagreementDies: null };
  if (!testDefs?.length) return empty;

  const wanted = testDefs.filter(d => d.testNumber !== undefined && testMatchesKind(d, kind));
  if (!wanted.length) return empty;

  type Acc = { pass: number; fail: number; failLow: number; failHigh: number };
  const zero = (): Acc => ({ pass: 0, fail: 0, failLow: 0, failHigh: 0 });
  const byTest = new Map<number, { label: string; overall: Acc; perGroup: Acc[] }>();

  for (const def of wanted) {
    const tn = def.testNumber!;
    byTest.set(tn, { label: testLabel(def, tn), overall: zero(), perGroup: groupOrder.map(() => zero()) });
  }

  const add = (tn: number, gi: number, d: Partial<Acc>) => {
    const row = byTest.get(tn);
    if (!row) return;
    for (const target of [row.overall, row.perGroup[gi]]) {
      target.pass     += d.pass     ?? 0;
      target.fail     += d.fail     ?? 0;
      target.failLow  += d.failLow  ?? 0;
      target.failHigh += d.failHigh ?? 0;
    }
  };

  // Only meaningful while comparing the two parametric sources, and only once
  // some die has actually carried both — otherwise it stays null, which is a
  // different statement from "0 disagreements".
  const comparingParametric = kind === 'spec' || kind === 'testFlag';
  let comparableDies = 0;
  let disagreements = 0;

  groups.forEach((group, gi) => {
    for (const item of group.items) {
      // `testSpecYield` IS the spec-limit judgement, already computed per wafer —
      // so it is a fast path for 'spec' only. There is no precomputed equivalent
      // for the recorded parametric verdict, so 'testFlag' always walks dies.
      if (kind === 'spec' && item.testSpecYield && !comparingParametricNeedsDies(item)) {
        for (const e of item.testSpecYield) {
          add(e.testNumber, gi, {
            pass: e.passDies,
            fail: e.failLowDies + e.failHighDies,
            failLow: e.failLowDies,
            failHigh: e.failHighDies,
          });
        }
        continue;
      }
      if (kind === 'functional' && item.functionalYield) {
        for (const e of item.functionalYield) add(e.testNumber, gi, { pass: e.passDies, fail: e.failDies });
        continue;
      }

      for (const die of item.dies ?? []) {
        if (!isYieldEligibleDie(die)) continue;
        for (const def of wanted) {
          const tn = def.testNumber!;
          const specCat = classifySpec(die.testValues?.[tn], def);
          const flagVerdict = getTestPassStatus(die, tn, def);

          if (comparingParametric && specCat !== null && flagVerdict !== undefined) {
            comparableDies++;
            if ((specCat === 'pass') !== flagVerdict) disagreements++;
          }

          if (kind === 'spec') {
            if (specCat === null) continue;
            if (specCat === 'pass') add(tn, gi, { pass: 1 });
            else if (specCat === 'failLow') add(tn, gi, { fail: 1, failLow: 1 });
            else add(tn, gi, { fail: 1, failHigh: 1 });
          } else {
            if (flagVerdict === undefined) continue;
            add(tn, gi, flagVerdict ? { pass: 1 } : { fail: 1 });
          }
        }
      }
    }
  });

  const toValue = (a: Acc): TestPassRateValue => ({
    passDies: a.pass,
    failDies: a.fail,
    totalDies: a.pass + a.fail,
    passRatePercent: rate(a.pass, a.pass + a.fail),
  });

  const rows: TestPassRateRow[] = [];
  for (const [testNumber, r] of byTest) {
    // A test nothing was measured on is dropped, not drawn as an empty cluster.
    if (r.overall.pass + r.overall.fail === 0) continue;
    rows.push({
      testNumber,
      label: r.label,
      overall: toValue(r.overall),
      byGroup: r.perGroup.map(toValue),
      // Fail direction only exists for the spec judgement — the tester's flag
      // says "failed", not which side of anything it failed on.
      ...(kind === 'spec' ? { failLowDies: r.overall.failLow, failHighDies: r.overall.failHigh } : {}),
    });
  }

  // Worst first: this is a pareto of failing tests, so the thing to act on is at
  // the top. Ties broken by test number for a stable order.
  rows.sort((a, b) =>
    (a.overall.passRatePercent ?? 101) - (b.overall.passRatePercent ?? 101)
    || a.testNumber - b.testNumber);

  return {
    groups: groupOrder,
    rows,
    disagreementDies: comparingParametric && comparableDies > 0 ? disagreements : null,
  };
}

/** Spec-limit judgement for one die/test, or undefined when it cannot be made
 *  (no value, or no limit to judge against). */

/** True when this item must be walked die-by-die even in 'spec' mode — i.e. it
 *  carries recorded verdicts, so the spec/flag comparison needs the raw dies the
 *  precomputed `testSpecYield` aggregate cannot supply. */
function comparingParametricNeedsDies(item: TestPassRateItem): boolean {
  return (item.dies ?? []).some(d => d.testPass !== undefined && Object.keys(d.testPass).length > 0);
}

function testMatchesKind(d: TestDef, kind: TestPassKind): boolean {
  if (kind === 'functional') return !isParametricTest(d);
  if (!isParametricTest(d)) return false;
  return kind === 'spec'
    ? (d.limitLow !== undefined || d.limitHigh !== undefined)
    // 'testFlag' needs no limits at all — the tester's verdict stands alone.
    : true;
}

/**
 * True when this `kind` has something to show — used to decide which modes the
 * chart's selector offers.
 *
 * `'testFlag'` additionally requires a die to actually carry a recorded verdict:
 * every parametric test *could* have one, so a definition-only check would offer
 * a mode that renders empty on the (common) data that has none.
 */
export function hasJudgeableTests(
  testDefs: TestDef[] | undefined,
  kind: TestPassKind,
  dies?: Die[],
): boolean {
  if (!testDefs?.length) return false;
  const matching = testDefs.filter(d => d.testNumber !== undefined && testMatchesKind(d, kind));
  if (!matching.length) return false;
  if (kind !== 'testFlag') return true;
  return (dies ?? []).some(die =>
    matching.some(d => getTestPassStatus(die, d.testNumber!, d) !== undefined));
}

/**
 * Pool per-wafer functional-test results into one lot-level set.
 *
 * Counts sum and the rate is recomputed from the sums — never an average of
 * per-wafer rates, which would weight a 20-die wafer the same as a 2,000-die
 * one.
 *
 * Returns `undefined` unless EVERY wafer reported functional results: a pooled
 * pass rate computed over some of the lot, presented as the lot's, is the kind
 * of quietly-wrong figure this library exists not to produce.
 *
 * Extracted because it was computed twice, identically — once for the Summary
 * panel and once for the exported report. Two implementations of one figure can
 * drift, and the two places they surface are precisely the two a reader would
 * compare.
 */
export function poolFunctionalYield(
  perWaferSummaries: readonly StatsSummary[] | undefined,
): NonNullable<StatsSummary['stats']['functionalYield']> | undefined {
  if (!perWaferSummaries?.length) return undefined;
  if (!perWaferSummaries.every(s => s.stats.functionalYield !== undefined)) return undefined;

  // `derived`/`expression` ride along with the label: this rebuilds each row,
  // and a rebuilt row that forgets them is how a derived test's pass rate
  // reaches the lot table looking measured.
  const byTest = new Map<number, { label: string; derived?: true; expression?: string; passDies: number; failDies: number; totalDies: number }>();
  for (const s of perWaferSummaries) {
    for (const t of s.stats.functionalYield ?? []) {
      const acc = byTest.get(t.testNumber) ?? { label: t.label, ...derivedFields(t), passDies: 0, failDies: 0, totalDies: 0 };
      acc.passDies += t.passDies;
      acc.failDies += t.failDies;
      acc.totalDies += t.totalDies;
      byTest.set(t.testNumber, acc);
    }
  }

  const pooled = [...byTest.entries()].map(([testNumber, acc]) => ({
    testNumber,
    ...acc,
    passRatePercent: acc.totalDies > 0 ? (acc.passDies / acc.totalDies) * 100 : null,
  }));
  return pooled.length ? pooled : undefined;
}
