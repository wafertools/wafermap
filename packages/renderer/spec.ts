/**
 * The single spec-limit judgement in the library: "is this measured value within
 * the test's limits?"
 *
 * Every surface that shows or counts an out-of-spec die reads this — value-mode
 * die fills and ▽/△ markers (`buildView`), the legend's spec tally, the spec
 * pass-rate tables (`stats/testPassRate.ts`), and the `specPass[n]` accessor in
 * derived-test expressions. It previously existed twice, once here and once in
 * `testPassRate.ts`, and the two disagreed on both edge cases below.
 *
 * Two rules, and both are the *strict* reading:
 *
 * 1. **No limits defined ⇒ `null` (no judgement).** A test with no limits has not
 *    been given a spec, so there is nothing to be inside of. Reporting `'pass'`
 *    would manufacture an in-spec verdict out of an absence, and it would inflate
 *    a spec pass-rate to 100% for every unlimited test.
 * 2. **A non-finite value ⇒ `null`.** `NaN` is not in spec. Comparison operators
 *    are false for `NaN`, so a naive `v < low` / `v > high` pair falls through to
 *    "pass" — which is exactly the "never drawn as plain in-spec" failure this
 *    judgement exists to prevent.
 *
 * `null` means no verdict and must be treated as no-data by every caller, never
 * as a pass and never as a fail.
 *
 * Out-of-spec *classification* depends ONLY on whether limits are defined — never on
 * `colorbarRangeMode`. An out-of-spec die is always flagged when limits exist, regardless
 * of how the colorbar is scaled. The *form* of the indication, decided in
 * `pushDieRectangles`, depends only on the effective `passFailDisplay`: under `'spec'` the
 * die gets a solid green/blue/red categorical fill; in normal value/gradient mode it keeps
 * the value gradient fill (so the distribution stays readable and out-of-spec colours don't
 * collide with the scheme) and is flagged with a ▽/△ marker (`ViewRect.specMark`).
 */
export type SpecCategory = 'pass' | 'failHigh' | 'failLow';

/** Just the fields of a `TestDef` this judgement reads — kept structural so
 *  `core/` and `stats/` can call it without importing the full def. */
export interface SpecLimits {
  limitLow?: number;
  limitHigh?: number;
}

/**
 * Classify `value` against `limits`. Returns `null` when no verdict is possible:
 * no value, a non-finite value, or a test with neither limit defined.
 */
export function classifySpec(
  value: number | undefined,
  limits: SpecLimits | undefined,
): SpecCategory | null {
  if (value === undefined || !Number.isFinite(value)) return null;
  if (limits === undefined) return null;
  if (limits.limitLow === undefined && limits.limitHigh === undefined) return null;
  if (limits.limitLow !== undefined && value < limits.limitLow) return 'failLow';
  if (limits.limitHigh !== undefined && value > limits.limitHigh) return 'failHigh';
  return 'pass';
}

/** True when `limits` can produce a verdict at all — i.e. at least one limit is
 *  defined. Used to reject `specPass[n]` at parse time rather than silently
 *  yielding no-data for every die. */
export function hasSpecLimits(limits: SpecLimits | undefined): boolean {
  return limits !== undefined
    && (limits.limitLow !== undefined || limits.limitHigh !== undefined);
}
