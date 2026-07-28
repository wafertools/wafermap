/**
 * Compare two label strings in natural (alphanumeric) order, so embedded numbers
 * sort by value rather than character-by-character: `D0, D1, D2, D10, D11` rather
 * than the plain-`.sort()` result `D0, D1, D10, D11, D2`.
 *
 * THE comparator for any user-visible list of mixed alpha-numeric labels (metadata
 * values, legend entries, facet values, yield rows) — semiconductor identifiers are
 * overwhelmingly of this `<prefix><number>` shape, so lexicographic ordering reads
 * as scrambled to an engineer scanning a legend.
 *
 * Locale is pinned to `'en'` rather than left to the host: this ordering also drives
 * categorical colour assignment, and a library must not hand the same wafer different
 * colours on machines with different locales.
 */
export function compareNatural(a: string, b: string): number {
  return a.localeCompare(b, 'en', { numeric: true });
}

/**
 * camelCase/snake_case key → "Title Case" label (`dieSize` → "Die Size",
 * `test_program` → "Test Program").
 *
 * Lives in `core/` because both `renderer/` (on-canvas map title) and `stats/`
 * (facet tables, HTML report, summary panel, metadata badge) need it, and
 * `renderer/` must not depend on `stats/`. Previously duplicated in both with a
 * "keep in sync" comment — the same field would otherwise be labelled two
 * different ways depending on which surface rendered it.
 */
export function prettyKey(key: string): string {
  return key
    .replace(/([A-Z])/g, ' $1')
    .replace(/_/g, ' ')
    .trim()
    .replace(/^./, s => s.toUpperCase());
}

/** Clamp `v` into [0, 1] — the normalization range every colour scale expects. */
export function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

/**
 * Arithmetic mean. Returns **NaN** for an empty array — deliberately, not 0.
 *
 * This feeds statistical comparisons (Welch tests, effect sizes), where "no data"
 * must never masquerade as a real measurement of zero: a 0 would silently become
 * a genuine-looking delta in a finding. NaN propagates and is caught by the
 * existing non-finite guards. Same reasoning as never defaulting a missing bin
 * to `0` elsewhere in the library.
 */
export function mean(values: number[]): number {
  if (values.length === 0) return NaN;
  let total = 0;
  for (const v of values) total += v;
  return total / values.length;
}

/**
 * Median of an ALREADY-SORTED ascending array. Returns 0 when empty — these two
 * median helpers back display/summary surfaces whose call sites already guard for
 * emptiness, and 0 keeps them from rendering "NaN" in a panel. Do not use them
 * where the result feeds a statistical test; see {@link mean} on why that case
 * wants NaN instead.
 */
export function medianOfSorted(sorted: number[]): number {
  const n = sorted.length;
  if (n === 0) return 0;
  const mid = Math.floor(n / 2);
  return n % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Median of an unsorted array (sorts a copy, leaving the input untouched). */
export function median(values: number[]): number {
  return medianOfSorted([...values].sort((a, b) => a - b));
}

/**
 * The 98th-percentile value (nearest-rank, on a sorted copy). Used by wafer-size
 * inference to take a robust maximum — the true extreme is too easily thrown off
 * by a single stray coordinate. Returns 0 for an empty array.
 */
export function percentile98(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.floor(sorted.length * 0.98);
  return sorted[Math.min(idx, sorted.length - 1)];
}

/**
 * Return the most-frequent (mode) value from an array of numbers.
 * For pitch estimation, values should be pre-rounded to absorb noise.
 */
export function modeOf(values: number[]): number | null {
  if (!values.length) return null;
  const counts = new Map<number, number>();
  for (const v of values) {
    counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  let maxCount = 0;
  let result = values[0];
  for (const [v, count] of counts) {
    if (count > maxCount) { maxCount = count; result = v; }
  }
  return result;
}