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
/**
 * Smallest / largest of `values`, by iteration rather than `Math.min(...values)`.
 *
 * **Never spread a per-die array into `Math.min`/`Math.max`.** Spread passes one
 * argument per element, and V8 throws `RangeError: Maximum call stack size
 * exceeded` somewhere above ~125k arguments — so the idiom works on every test
 * fixture and every small wafer, then fails outright on a real production lot.
 * It did: `buildWaferMap` could not build a 400k-die map at all, and the aggregate
 * min/max stacks had the same latent fault.
 *
 * Returns 0 for an empty array, matching the callers that treat "no values" as no
 * extent rather than as ±Infinity.
 */
export function minOf(values: readonly number[]): number {
  if (values.length === 0) return 0;
  let m = values[0];
  for (let i = 1; i < values.length; i++) if (values[i] < m) m = values[i];
  return m;
}

export function maxOf(values: readonly number[]): number {
  if (values.length === 0) return 0;
  let m = values[0];
  for (let i = 1; i < values.length; i++) if (values[i] > m) m = values[i];
  return m;
}

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
  // A `Float64Array` sort, unlike `median` above, because this one's caller
  // passes ONE VALUE PER DIE — `inferWaferFromXY` hands it a radius for every
  // die on the wafer, so it is a 400,000-element sort on a large map, inside
  // `buildWaferMap`. A typed sort is ~4x a `(a, b) => a - b` comparator at that
  // size (measured in Chrome; see `pooledTestStatsSteps`). `median`'s callers
  // pass one value per WAFER, where the typed array would cost more to
  // allocate than the comparator costs to run.
  //
  // Non-finite input sorts last here rather than in an order the spec does not
  // define; every caller screens its values first.
  const sorted = Float64Array.from(values);
  sorted.sort();
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
// ── CSV ──────────────────────────────────────────────────────────────────────

// A value starting with =, +, -, or @ is read as a formula by Excel/Sheets/
// LibreOffice on open — a known injection vector when the source is die/wafer
// metadata this library didn't originate (host data pipelines, MES/LIMS
// fields, operator free text). Only applied to values that don't parse as a
// number: a leading '-'/'+' on an actual number (offsets, leakage, deltas —
// routine in test data) must round-trip unchanged.
const FORMULA_LEAD = /^[=+\-@]/;

/**
 * CSV field escaper — quoting plus the formula-injection guard above.
 *
 * Lives here rather than in `canvas-adapter/summaryPanel.ts`, its original home:
 * it is a pure string function with no DOM, and it now has consumers in the
 * summary panel, the die list AND the correlation chart. Importing summaryPanel
 * from a chart to reach it would have inverted the dependency (summaryPanel
 * already imports charts/chartShell), so the third consumer made the wrong home
 * obvious. Every CSV this library writes must go through it.
 */
export function csvField(value: string): string {
  const v = (FORMULA_LEAD.test(value) && Number.isNaN(Number(value))) ? `'${value}` : value;
  return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/**
 * Escape text for insertion into HTML — the one copy for the whole library.
 *
 * Every string the library puts into `innerHTML` that did not come from its own
 * literals must go through this: test names, units, bin names, wafer labels and
 * metadata values all arrive from input files (STDF/ATDF/CSV headers, MES
 * fields, operator free text), and a name like `<img src=x onerror=…>` would
 * otherwise run as script when a tooltip showed it — in a Tauri or Electron
 * host, inside the app's own webview. It used to live in stats/reportHtml.ts,
 * where only the reports used it, while every tooltip interpolated raw names.
 */
export function escHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Shallow structural equality for the three collection shapes the library's
 * shared display options are built from — the one copy of each rule.
 *
 * These exist for a single purpose: deciding whether a recomputed option is
 * actually DIFFERENT before pushing it to every live card. A gallery resolves
 * its wafers one at a time and re-derives the lot-wide options (bin colours,
 * value range, metadata order) after each one, and each of those derivations
 * allocates a fresh object — so a reference check always reports "changed" and
 * every card rebuilds its view and redraws. Measured on 50 wafers x 8,000 dies,
 * that pushed the same unchanged bin-colour map 1,275 times and cost 24 s of
 * the load. Identity is the wrong question; value is the right one.
 *
 * Deliberately shallow: every value compared here is a number, a string or a
 * colour, never a nested object. A generic deep-equal would invite use on
 * `Die` or `View`, where it would be both wrong and ruinously slow.
 */
export function arrayEqual<T>(a: readonly T[] | undefined, b: readonly T[] | undefined): boolean {
  if (a === b) return true;
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** See {@link arrayEqual}. Same keys, same values — insertion order is not compared. */
export function mapEqual<K, V>(a: ReadonlyMap<K, V> | undefined, b: ReadonlyMap<K, V> | undefined): boolean {
  if (a === b) return true;
  if (!a || !b || a.size !== b.size) return false;
  // `b.get(k) !== v` alone would treat a missing key as equal when v is
  // undefined, so the size check above is load-bearing, not an optimisation.
  for (const [k, v] of a) if (!b.has(k) || b.get(k) !== v) return false;
  return true;
}

/** See {@link arrayEqual}. Same members — order is meaningless in a Set. */
export function setEqual<T>(a: ReadonlySet<T> | undefined, b: ReadonlySet<T> | undefined): boolean {
  if (a === b) return true;
  if (!a || !b || a.size !== b.size) return false;
  for (const v of a) if (!b.has(v)) return false;
  return true;
}

/**
 * A computation written as a generator so its caller decides how much of it to
 * run at once: each `yield` is a point at which the work may be paused and the
 * thread handed back. The generator's return value is the finished result, so a
 * chunked computation has exactly ONE implementation — a caller that does not
 * care runs it to completion with {@link drain} and cannot observe the
 * difference, while a caller on the main thread drives it a slice at a time
 * (see `runChunked` in `canvas-adapter/chunked.ts`).
 *
 * This shape, rather than a callback or an `async` rewrite, because the work
 * here is synchronous and CPU-bound: there is nothing to await, only somewhere
 * to stop. A second "progressive" copy of the same builder is the alternative,
 * and two copies of a rule is the bug this library keeps finding.
 */
export type Chunked<T> = Generator<void, T, void>;

/** Run a {@link Chunked} computation to completion without yielding, and
 *  return its result — the synchronous entry point for any chunked builder. */
export function drain<T>(work: Chunked<T>): T {
  let step = work.next();
  while (!step.done) step = work.next();
  return step.value;
}
