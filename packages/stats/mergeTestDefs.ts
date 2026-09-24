// One test list for a whole population of wafers — the cross-item namespace
// that every multi-wafer surface needs and, until now, faked.
//
// `TestDef.testNumber` identifies a test WITHIN A TEST PROGRAM (see its doc in
// renderer/buildWaferMap.ts). Every cross-wafer surface used to take the defs
// from `items.find(it => it.testDefs?.length)` — one arbitrary wafer's list —
// and apply that name, unit, limits, logScale and testType to every other
// wafer's values. Across a multi-program load that is not a labelling slip: die
// values are keyed by test number, so test 1001 being `vth_n_mV` (260-380 mV) in
// one lot and `leakage_nA` (0-5 nA) in another meant the two were pooled into
// one distribution, normalised against whichever limits arrived first, and drawn
// under whichever name arrived first. Capability reported a Ppk of -1489 rather
// than saying the lots could not be compared.
//
// Four distinct failures came out of that one rule, and only the third is about
// limits — which is why this reconciles the whole def, not just the limits:
//   1. values pooled across genuinely different measurements (happens even when
//      no item states any limits at all);
//   2. name/unit mislabelling on every axis, title, tooltip and colorbar;
//   3. borrowed limits driving capability, spec yield and the LSL/USL lines;
//   4. tests present only in the non-first items missing from every selector,
//      because the list was one item's array rather than a union.
//
// THE CENTRAL RULE: an absent field is "not stated", never a disagreement.
// Loading a file that carries limits alongside one that does not is completely
// legitimate and must merge silently — the stated value wins and nothing is
// reported. Only two STATED and different values are a conflict. The same
// applies to name, unit and testType, so a host that populates defs sparsely is
// never punished for it.
//
// Conflicts come in two tiers because they have different honest answers:
//
//   HARD (name, unit, testType) — these are different measurements sharing a
//   number by accident. Their values must not be pooled at all, so the test is
//   withheld from `defs` entirely and reported at severity `error`. Splitting it
//   into one series per program was considered and rejected: it needs a compound
//   test key threaded through every panel, and one series that is honestly
//   absent beats two that every caller must learn to disambiguate.
//
//   SOFT (limits) — the same measurement held to different specs. The values ARE
//   comparable, so distributions still pool correctly and the test stays. Only
//   the spec-relative reading is undefined for the merged population, so the
//   merged def drops its limits: no Cp/Cpk/Pp/Ppk, no spec yield, no LSL/USL
//   line. Reported at severity `warning`.
//
// Pure and DOM-free. `analyzeWaferMap` is unaffected and must stay so: it runs
// per wafer against that wafer's OWN defs, which is correct and is why the
// single-wafer view never had this bug.

import type { TestDef, WaferWarning } from '../renderer/buildWaferMap.js';

/** Which field disagreed. `'limits'` is the soft tier; the rest are hard. */
export type TestDefConflictKind = 'name' | 'unit' | 'testType' | 'limits' | 'specLimits';

/** One test number whose defs could not be reconciled across the population. */
export interface TestDefConflict {
  testNumber: number;
  kind: TestDefConflictKind;
  /** True when the test was withheld from `defs` (the hard tier). */
  excluded: boolean;
  /**
   * The distinct STATED values that disagreed, in first-seen order, already
   * stringified for display. Absent values are not represented — they were
   * never in disagreement with anything.
   */
  values: string[];
}

export interface MergedTestDefs {
  /**
   * The union of every test number across every item, each carrying a def
   * reconciled from all items that described it. Hard-conflicting tests are
   * absent. Ordered by first appearance, so a single-program population gets
   * back exactly the order it supplied.
   */
  defs: TestDef[];
  /** Every unreconcilable test, both tiers. Empty for a clean population. */
  conflicts: TestDefConflict[];
  /**
   * `conflicts` rendered as structured advisories, ready to hand to
   * `collectWarnings` so the toolbar indicator and Summary banner report them
   * with no host work. At most one warning per severity — a program mismatch
   * hits many tests at once, and one line per test would bury everything else.
   */
  warnings: WaferWarning[];
}

/**
 * Relative tolerance for comparing two stated limits.
 *
 * Never `===`. The same nominal limit can arrive as a float32 STDF `LO_LIMIT`
 * from one file and a float64 CSV column from another, and the round-trip
 * differs in the last bits — declaring that a spec disagreement would withhold
 * capability from correctly-matched lots, which is exactly the false positive
 * this whole module exists to avoid. float32 carries ~1.2e-7 relative precision,
 * so 1e-6 clears representation noise with margin while still separating limits
 * that genuinely differ (260 vs 261 mV is 4e-3 — three orders of magnitude away).
 */
const LIMIT_REL_TOLERANCE = 1e-6;

function sameLimit(a: number, b: number): boolean {
  if (a === b) return true;
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  const scale = Math.max(Math.abs(a), Math.abs(b));
  return Math.abs(a - b) <= LIMIT_REL_TOLERANCE * scale;
}

/** A name is stated when it is more than whitespace. `''` is absence, not a value. */
function statedName(def: TestDef): string | undefined {
  const s = def.name?.trim();
  return s ? s : undefined;
}

/** A unit is stated when it is more than whitespace. */
function statedUnit(def: TestDef): string | undefined {
  const s = def.unit?.trim();
  return s ? s : undefined;
}

/**
 * Names compare case-insensitively: `TEST_TXT` case and padding drift between
 * files for what is unambiguously the same test, and hard-blocking on that would
 * withhold data for a formatting difference.
 *
 * Units deliberately do NOT — SI prefixes are case-bearing, and treating `mV`
 * and `MV` as equal would silently merge measurements a billion times apart.
 */
function nameKey(name: string): string {
  return name.toLowerCase();
}

/** Distinct stated values in first-seen order, compared with `keyOf`. */
function distinct<T>(values: T[], keyOf: (v: T) => string): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const v of values) {
    const k = keyOf(v);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(v);
  }
  return out;
}

/** Distinct stated limits, first-seen order, under the relative tolerance. */
function distinctLimits(values: number[]): number[] {
  const out: number[] = [];
  for (const v of values) if (!out.some(o => sameLimit(o, v))) out.push(v);
  return out;
}

/** `1001 (vth_n_mV vs leakage_nA)` — enough to act on without dumping the lot. */
function describeConflict(c: TestDefConflict): string {
  return `${c.testNumber} (${c.values.join(' vs ')})`;
}

/** At most `max` descriptions, then an honest count of what was elided. */
function summarise(conflicts: TestDefConflict[], max = 5): string {
  const shown = conflicts.slice(0, max).map(describeConflict).join(', ');
  const rest = conflicts.length - Math.min(max, conflicts.length);
  return rest > 0 ? `${shown}, and ${rest} more` : shown;
}

/**
 * Reconcile every item's `testDefs` into one list for the whole population.
 *
 * Items with no defs are skipped, not treated as disagreeing — a wafer that
 * describes nothing contradicts nothing.
 */
export function mergeTestDefs(items: Array<{ testDefs?: TestDef[] } | null | undefined>): MergedTestDefs {
  // Grouped by test number, in first-appearance order across the population.
  const byNumber = new Map<number, TestDef[]>();
  const order: number[] = [];

  for (const item of items) {
    for (const def of item?.testDefs ?? []) {
      const n = def.testNumber;
      let group = byNumber.get(n);
      if (!group) { group = []; byNumber.set(n, group); order.push(n); }
      group.push(def);
    }
  }

  const defs: TestDef[] = [];
  const conflicts: TestDefConflict[] = [];

  for (const testNumber of order) {
    const group = byNumber.get(testNumber)!;

    const names = distinct(group.map(statedName).filter((s): s is string => s !== undefined), nameKey);
    const units = distinct(group.map(statedUnit).filter((s): s is string => s !== undefined), u => u);
    // testType is compared only where BOTH sides state it. The field's
    // documented default is 'P', but reading an absent field as an assertion of
    // 'P' would make every partially-populated host collide with a fully
    // populated one — absence is absence here as everywhere else.
    const types = distinct(
      group.map(d => d.testType).filter((t): t is 'P' | 'F' => t !== undefined),
      t => t,
    );

    // Hard tier: different measurements. Report the first field that disagrees
    // rather than every one — they almost always disagree together (a different
    // test has a different name AND unit), and three warnings for one cause is
    // noise, not detail.
    const hard: TestDefConflict | undefined =
      names.length > 1 ? { testNumber, kind: 'name',     excluded: true, values: names } :
      units.length > 1 ? { testNumber, kind: 'unit',     excluded: true, values: units } :
      types.length > 1 ? { testNumber, kind: 'testType', excluded: true, values: types } :
      undefined;

    if (hard) { conflicts.push(hard); continue; }

    const lows  = distinctLimits(group.map(d => d.limitLow ).filter((v): v is number => v !== undefined));
    const highs = distinctLimits(group.map(d => d.limitHigh).filter((v): v is number => v !== undefined));
    // Whether a value equal to a limit passes is part of the judgement too: the
    // same number judged `≥` on one wafer and `>` on another is two specs.
    const lowIncl  = distinct(group.filter(d => d.limitLow  !== undefined).map(d => d.limitLowInclusive  !== false), b => String(b));
    const highIncl = distinct(group.filter(d => d.limitHigh !== undefined).map(d => d.limitHighInclusive !== false), b => String(b));
    const limitsConflict = lows.length > 1 || highs.length > 1 || lowIncl.length > 1 || highIncl.length > 1;

    if (limitsConflict) {
      // BOTH limits are dropped, not just the disagreeing one. A surviving
      // one-sided limit would keep driving spec colouring and the spec-yield
      // read for a population whose spec is genuinely unsettled — half of a
      // judgement nobody can make is not better than none of it.
      conflicts.push({
        testNumber,
        kind: 'limits',
        excluded: false,
        values: lows.length > 1 ? lows.map(v => String(v))
          : highs.length > 1 ? highs.map(v => String(v))
          : lowIncl.length > 1 ? lowIncl.map(incl => `${incl ? '≥' : '>'} ${lows[0]}`)
          : highIncl.map(incl => `${incl ? '≤' : '<'} ${highs[0]}`),
      });
    }

    // Spec limits get the same soft-tier rule, separately: a disagreement drops
    // the spec pair (capability then falls back to the test limits, and says so).
    const specLows  = distinctLimits(group.map(d => d.specLow ).filter((v): v is number => v !== undefined));
    const specHighs = distinctLimits(group.map(d => d.specHigh).filter((v): v is number => v !== undefined));
    const specConflict = specLows.length > 1 || specHighs.length > 1;
    if (specConflict) {
      conflicts.push({
        testNumber,
        kind: 'specLimits',
        excluded: false,
        values: (specLows.length > 1 ? specLows : specHighs).map(v => String(v)),
      });
    }

    defs.push({
      testNumber,
      name: names[0] ?? '',
      ...(units[0]  !== undefined ? { unit: units[0] } : {}),
      ...(types[0]  !== undefined ? { testType: types[0] } : {}),
      // logScale is a display preference, not a claim about the measurement, so
      // a disagreement is not worth withholding anything over — first stated wins.
      ...(group.find(d => d.logScale !== undefined) ? { logScale: group.find(d => d.logScale !== undefined)!.logScale } : {}),
      ...(!limitsConflict && lows[0]  !== undefined ? { limitLow:  lows[0]  } : {}),
      ...(!limitsConflict && highs[0] !== undefined ? { limitHigh: highs[0] } : {}),
      ...(!limitsConflict && lowIncl[0]  === false ? { limitLowInclusive:  false } : {}),
      ...(!limitsConflict && highIncl[0] === false ? { limitHighInclusive: false } : {}),
      ...(!specConflict && specLows[0]  !== undefined ? { specLow:  specLows[0]  } : {}),
      ...(!specConflict && specHighs[0] !== undefined ? { specHigh: specHighs[0] } : {}),
      // The derived flag survives the merge. This list reconstructs a def field by
      // field rather than copying one, so anything not named here is dropped —
      // and a dropped `derived` is the one failure this flag exists to prevent:
      // the test renders across every cross-wafer panel as though the tester
      // measured it. Marked when ANY item states it, deliberately asymmetric.
      // The two directions are not equally bad: marking a measured test is a
      // visible oddity someone queries, while leaving a derived one unmarked
      // is invisible and is what puts a Cpk on a derived quantity with nothing
      // to say so.
      ...(group.some(d => d.derived) ? { derived: true as const } : {}),
      ...(group.find(d => d.expression !== undefined)
        ? { expression: group.find(d => d.expression !== undefined)!.expression }
        : {}),
    });
  }

  return { defs, conflicts, warnings: buildWarnings(conflicts) };
}

function buildWarnings(conflicts: TestDefConflict[]): WaferWarning[] {
  const out: WaferWarning[] = [];
  const excluded = conflicts.filter(c => c.excluded);
  const limits   = conflicts.filter(c => c.kind === 'limits');
  const specs    = conflicts.filter(c => c.kind === 'specLimits');

  if (excluded.length > 0) {
    out.push({
      code: 'test-def-collision',
      severity: 'error',
      message:
        `${excluded.length} test ${excluded.length === 1 ? 'number describes' : 'numbers describe'} ` +
        'a different measurement in different wafers, so the same number cannot identify one test ' +
        'across this population. Affected: ' + summarise(excluded) + '. ' +
        'These tests are withheld from every cross-wafer chart, report and map mode — pooling them ' +
        'would mix unrelated measurements into one distribution. Each wafer\'s own view is unaffected. ' +
        'Load one test program at a time to see them.',
    });
  }

  if (limits.length > 0) {
    out.push({
      code: 'test-limit-conflict',
      severity: 'warning',
      message:
        `${limits.length} ${limits.length === 1 ? 'test is' : 'tests are'} held to different test ` +
        'limits in different wafers. Affected: ' + summarise(limits) + '. ' +
        'The measured values are still comparable, so distributions include them, but the ' +
        'limit yield, the limit lines, and capability measured against the test limits are ' +
        'withheld for these tests — there is no single pair of limits to judge the merged population against.',
    });
  }

  if (specs.length > 0) {
    out.push({
      code: 'test-limit-conflict',
      severity: 'warning',
      message:
        `${specs.length} ${specs.length === 1 ? 'test has' : 'tests have'} different spec limits in ` +
        'different wafers. Affected: ' + summarise(specs) + '. Their spec limits are withheld for the ' +
        'merged population, so capability uses the test limits where they agree.',
    });
  }

  return out;
}
