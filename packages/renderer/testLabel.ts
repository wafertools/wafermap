// How a test is named, and how a derived test is distinguished from a measured
// one. Internal — every display surface routes through here rather than
// formatting a test name itself.
//
// There were six copies of `def.name ?? \`Test ${tn}\`` before this file (stats:
// sweep, capability, testPassRate, analyzeWaferMap; canvas-adapter: chartShell),
// which is already one rule in six places. Adding a derived-test marker to each
// of the ~16 surfaces that show a test name would have made it twenty-odd. The
// marker is a semiconductor-correctness requirement, not decoration — a reader
// must never take a derived value for a measured one — so it needs a single
// definition, the way `getDieKey` and `passBinsLabel` do.

import type { TestDef } from './buildWaferMap.js';

/**
 * The derived-test part of anything that describes a test: a `TestDef`, or a
 * narrower record carried onward from one — a finding's `variable`, a
 * capability row. Structural, so every such shape is read by the same helpers.
 */
export type DerivedSource = { derived?: true; expression?: string } | undefined;

/**
 * Marks a test name as derived rather than measured.
 *
 * A dagger rather than the obvious `ƒ`: in this domain `f` is femto, and a `ƒ`
 * beside a column of `fA`/`fF` units is a genuine misread. The dagger collides
 * with no unit and no operator, and already means "see the note" — which is the
 * contract: wherever the glyph can appear, {@link DERIVED_KEY} appears with it.
 */
export const DERIVED_MARK = '†';

/**
 * What {@link DERIVED_MARK} means, in words — the key every marked surface shows.
 *
 * Short on purpose: it has to fit the lower-right corner of a map beside the
 * colorbar as well as a legend, and one string everywhere cannot drift. What a
 * value was computed FROM is the expression, which tooltips show alongside it.
 */
export const DERIVED_KEY = 'Derived, not measured';

/**
 * True when this def describes a test computed from other tests rather than
 * measured by the tester. Reads the flag `buildWaferMap` stamps on the defs it
 * admits from `derivedTests` — never infers it from the test number, which is
 * an application-defined identifier carrying no such meaning.
 */
export function isDerivedTest(def: DerivedSource): boolean {
  return def?.derived === true;
}

/**
 * The display name for a test: its `name`, or `"Test <number>"` when it has no
 * def or no name. The single source of that fallback.
 *
 * `testNumber` is passed separately so a caller holding only a number and a
 * possibly-missing def gets the same string as one holding a complete def — the
 * shape every previous copy of this rule had.
 *
 * Typed to the structural minimum rather than `TestDef` so the chart test
 * picker's own `TestSelectItem` (which carries only a number and an optional
 * name) uses the same fallback as everything else instead of keeping its copy.
 */
export function testLabel(def: { name?: string } | undefined, testNumber: number): string {
  const name = def?.name;
  return name !== undefined && name !== '' ? name : `Test ${testNumber}`;
}

/**
 * {@link testLabel} with the derived-test marker in front when the def is
 * derived — `"† On/Off Ratio"`. The form every surface uses to name a test: the
 * map title, tooltips, findings, tables, pickers and menus.
 *
 * The marker always PRECEDES the name, everywhere (Paul, 2026-09-23). In a list
 * the eye runs down the left edge, so leading marks form a column and a derived
 * test is found at a glance, where trailing ones land at a different x on every
 * row; and truncating a long name can never cut the marker off. One position on
 * every surface, so a reader learns it once. A unit follows the name as usual —
 * `"† Vth Margin (V)"` — so the marker qualifies the whole test.
 *
 * A list that should keep measured names aligned with marked ones pads them by
 * the marker's width when any entry is derived — {@link DERIVED_LANE_PAD} for
 * plain text, a fixed-width slot where there is DOM or canvas to measure with.
 */
export function markedTestLabel(
  def: (TestDef | { name?: string; derived?: true }) | undefined,
  testNumber: number,
): string {
  const label = testLabel(def, testNumber);
  return def?.derived === true ? `${DERIVED_MARK} ${label}` : label;
}

/**
 * Plain-text stand-in for `"† "` in front of a MEASURED name, for a text-only
 * list (a native `<select>`) that holds derived tests too, so every name starts
 * at about the same x. A figure space plus a thin space: close to the width of
 * a dagger and a space in the UI fonts, and invisible. Approximate by nature —
 * a surface that can measure uses a real fixed-width slot instead.
 */
export const DERIVED_LANE_PAD = '\u2007\u2009';

/**
 * The one-line explanation of a derived test for a tooltip:
 * `"† Derived, not measured: t[1010] / t[1020]"`, or without
 * the expression when none was carried. `undefined` for a measured test.
 *
 * Plain text — the caller escapes it, like every other tooltip line.
 */
export function derivedTestNote(def: DerivedSource): string | undefined {
  if (!isDerivedTest(def)) return undefined;
  const source = derivedTestSource(def);
  return source ? `${DERIVED_MARK} ${DERIVED_KEY}: ${source}` : `${DERIVED_MARK} ${DERIVED_KEY}`;
}

/**
 * What a derived test was computed from, as a phrase fit to show a user, or
 * `undefined` for a measured test.
 *
 * Deliberately returns the expression verbatim rather than prettifying it: it
 * is the exact text the application author wrote and can be matched against
 * their own test-program source, which a reformatted version could not be.
 */
export function derivedTestSource(def: DerivedSource): string | undefined {
  if (!isDerivedTest(def) || !def?.expression) return undefined;
  return def.expression;
}

/**
 * `{ derived: true, expression }` for a derived test, `{}` for a measured one —
 * spread into any row or record that carries a test onward (a capability row,
 * a summary table entry, a finding's variable, a stacked card's def).
 *
 * The single form of that hand-off. Every place a test is re-described in a
 * narrower shape is a place the flag can be dropped — it was, in
 * `mergeTestDefs`, the Summary panel's table and `poolFunctionalYield`, each a
 * row rebuilt field by field. A shape that spreads this cannot forget the
 * expression while remembering the flag.
 */
export function derivedFields(def: DerivedSource): { derived?: true; expression?: string } {
  if (!isDerivedTest(def)) return {};
  return def!.expression !== undefined ? { derived: true, expression: def!.expression } : { derived: true };
}

/**
 * A label with the derived-test marker taken back out — for a surface that
 * states derivation another way and so must not also carry a bare glyph (a
 * CSV column, the key line that opens with the marker). The inverse of
 * {@link markedTestLabel}, which is the only thing that marks a label, so the
 * two live side by side.
 */
export function unmarkedLabel(label: string): string {
  const prefix = `${DERIVED_MARK} `;
  return label.startsWith(prefix) ? label.slice(prefix.length) : label;
}

/** Header of the column a CSV export adds when any row is a derived test. */
export const DERIVED_CSV_HEADER = 'Derived from';

/**
 * The {@link DERIVED_CSV_HEADER} cell for one row. A CSV has nowhere to put a
 * key, so a derived test is stated as data: its expression, or the key's
 * words if none was carried — never blank, which would read as measured.
 * Blank for a measured test.
 */
export function derivedCsvCell(entry: DerivedSource): string {
  if (!isDerivedTest(entry)) return '';
  return derivedTestSource(entry) ?? DERIVED_KEY;
}

/**
 * The key line for a surface that shows several tests at once with no hover to
 * explain each one — a stats table, a findings list, a printed report:
 * `"† Derived, not measured — Leakage Shift: abs(t[1020] - t[1010]); …"`.
 * `undefined` when none of `entries` is derived, so the line appears exactly
 * when a marked name is on the surface.
 *
 * Entries are de-duplicated by name, and the marker is dropped from each name
 * ({@link unmarkedLabel}) since the line already opens with it. Plain text; the
 * caller escapes it.
 */
export function derivedKeyText(
  entries: ReadonlyArray<{ label: string; derived?: true; expression?: string }>,
): string | undefined {
  const byName = new Map<string, string | undefined>();
  for (const e of entries) {
    if (!isDerivedTest(e)) continue;
    const name = unmarkedLabel(e.label);
    if (!byName.has(name)) byName.set(name, e.expression);
  }
  if (byName.size === 0) return undefined;
  const items = [...byName].map(([name, expr]) => (expr ? `${name}: ${expr}` : name));
  return `${DERIVED_MARK} ${DERIVED_KEY} — ${items.join('; ')}`;
}

/**
 * True when any test in this population is derived — the gate for reserving a
 * marker gutter in a view.
 *
 * Reserving it per view rather than per row is what keeps the marker from
 * shifting content relative to itself: every row of a view indents equally, so
 * the markers align in a column instead of leaving a ragged edge, and a
 * population with no derived tests — the common case — is unchanged to the
 * pixel.
 */
export function hasDerivedTests(defs: readonly TestDef[] | undefined): boolean {
  return (defs ?? []).some(isDerivedTest);
}
