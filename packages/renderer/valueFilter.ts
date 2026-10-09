/**
 * The value filter: take values that lie outside a limit set out of a wafer's
 * data, so every map, statistic and chart reads the same population.
 *
 * Runs once, on the raw probe records at the start of `buildWaferMap` (before
 * derived tests, which would otherwise be computed from a clamped reading). An
 * excluded value becomes no value for that test on that die; the value itself is
 * kept in `DieTable.excluded` so the tooltip can say what was excluded and why.
 *
 * Only values change. `die.testPass` and the bins are the tester's own verdict
 * and are left alone.
 */
import type { DieTable } from '../core/dieTable.js';
import { excludedCounts, withExcluded, type DieData } from '../core/dieTable.js';
import type { TestDef, WaferWarning } from './buildWaferMap.js';
import { aboveHigh, belowLow } from './spec.js';

/**
 * Which limit set a value must lie inside to be kept.
 * `'validity'` excludes values outside the validity limits (tester clamps) and
 * only affects tests that have them. `'spec'` and `'test'` keep only values
 * inside the specification or test limits. `'none'` filters nothing.
 */
export type ValueFilterMode = 'validity' | 'spec' | 'test' | 'none';

/** Per-test outcome of the value filter, carried on `WaferMapResult.valueFilter`. */
export interface ValueFilterTest {
  testNumber: number;
  /** Values excluded across the wafer (or across every wafer of a lot). */
  excluded: number;
  /** Values the test had before filtering. */
  total: number;
}

export interface ValueFilterSummary {
  mode: Exclude<ValueFilterMode, 'none'>;
  /** Tests with at least one excluded value. */
  tests: ValueFilterTest[];
}

/** Display name of a limit set, as the UI and the log name it. */
export function limitSetName(mode: Exclude<ValueFilterMode, 'none'>): string {
  return mode === 'validity' ? 'validity limits' : mode === 'spec' ? 'specification limits' : 'test limits';
}

/** The range `def` states for `mode`, or `undefined` when it states none. */
function rangeFor(def: TestDef, mode: Exclude<ValueFilterMode, 'none'>):
  { low?: number; high?: number; lowInclusive?: boolean; highInclusive?: boolean } | undefined {
  const r = mode === 'validity'
    ? { low: def.validLow, high: def.validHigh }
    : mode === 'spec'
      ? { low: def.specLow, high: def.specHigh }
      : { low: def.limitLow, high: def.limitHigh, lowInclusive: def.limitLowInclusive, highInclusive: def.limitHighInclusive };
  return r.low === undefined && r.high === undefined ? undefined : r;
}

/**
 * `table` with out-of-range values taken out, and the per-test counts.
 * Parametric tests only: a functional test has no measured value to be out of range.
 */
export function applyValueFilter(
  table: DieTable,
  testDefs: readonly TestDef[] | undefined,
  mode: ValueFilterMode,
): { table: DieTable; tests: ValueFilterTest[] } {
  if (mode === 'none' || !testDefs) return { table, tests: [] };
  const values = new Map<number, Float32Array | Float64Array>();
  const excluded = new Map<number, Float32Array | Float64Array>();
  const tests: ValueFilterTest[] = [];
  for (const def of testDefs) {
    if (def.testType === 'F') continue;
    const range = rangeFor(def, mode);
    const col = table.values.get(def.testNumber);
    if (range === undefined || col === undefined) continue;
    let kept: Float32Array | Float64Array | undefined;
    let taken: Float32Array | Float64Array | undefined;
    let total = 0, count = 0;
    for (let i = 0; i < col.length; i++) {
      const v = col[i];
      if (Number.isNaN(v)) continue;
      total++;
      const out = (range.low !== undefined && belowLow(v, range.low, range.lowInclusive))
        || (range.high !== undefined && aboveHigh(v, range.high, range.highInclusive));
      if (!out) continue;
      if (kept === undefined) { kept = col.slice(); taken = new (col.constructor as typeof Float64Array)(col.length).fill(NaN); }
      kept[i] = NaN; taken![i] = v; count++;
    }
    if (kept === undefined || taken === undefined) continue;
    values.set(def.testNumber, kept);
    excluded.set(def.testNumber, taken);
    tests.push({ testNumber: def.testNumber, excluded: count, total });
  }
  return tests.length === 0 ? { table, tests } : { table: withExcluded(table, values, excluded, mode), tests };
}

/**
 * The caption fragment for `testNumber` over `dies`: " · 3 values outside validity limits excluded", or ''
 * when the filter took nothing out of them. One wording for every chart caption.
 */
export function excludedNote(dies: readonly DieData[], testNumber: number): string {
  const found = excludedCounts(dies);
  const count = found?.counts.get(testNumber) ?? 0;
  return found && count > 0 ? ` · ${count.toLocaleString('en-GB')} value${count === 1 ? '' : 's'} outside ${limitSetName(found.by)} excluded` : '';
}

/** Sums per-wafer outcomes into one (a lot is filtered wafer by wafer). */
export function mergeValueFilterTests(parts: readonly ValueFilterTest[][]): ValueFilterTest[] {
  const by = new Map<number, ValueFilterTest>();
  for (const part of parts) for (const t of part) {
    const have = by.get(t.testNumber);
    if (have) { have.excluded += t.excluded; have.total += t.total; } else by.set(t.testNumber, { ...t });
  }
  return [...by.values()].sort((a, b) => a.testNumber - b.testNumber);
}

/** The log line for an outcome: what was excluded, per test, and under which limits. */
export function valueFilterWarning(
  mode: Exclude<ValueFilterMode, 'none'>,
  tests: readonly ValueFilterTest[],
  defs: readonly TestDef[] | undefined,
): WaferWarning | undefined {
  if (tests.length === 0) return undefined;
  const name = (n: number) => defs?.find(d => d.testNumber === n)?.name ?? `test ${n}`;
  const total = tests.reduce((s, t) => s + t.excluded, 0);
  const detail = tests.slice(0, 5).map(t => `${name(t.testNumber)}: ${t.excluded} of ${t.total}`).join('; ')
    + (tests.length > 5 ? `; and ${tests.length - 5} more tests` : '');
  return {
    code: 'values-excluded',
    message: `${total} value${total === 1 ? '' : 's'} outside the ${limitSetName(mode)} treated as missing (${detail}).`,
    severity: 'info',
  };
}
