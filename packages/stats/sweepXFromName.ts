// Reading a sweep point's x value out of its test's NAME — for programs that
// record the swept quantity only in the test text ("… LRS_STATS_12K / …").
//
// The pattern is a placeholder template, not a regular expression: `{x}` reads
// a number, `*` matches any run of characters, everything else is literal.
// That is deliberate. A sweeps file is shared between people, and JavaScript
// cannot interrupt a running regex — a user-supplied pattern such as `(a+)+$`
// would freeze the app on a single test name. This matcher is memoised over
// (pattern part, name position), so its cost is bounded by the pattern's length
// times the name's, whatever the pattern says. It also spares the author JSON's
// double-escaped backslashes (`"(\\d+)"`).
//
// Matching finds the FIRST place in the name the pattern fits — the test text
// is often long and truncated at STDF's 255 characters, with the value in the
// middle — so no leading or trailing `*` is needed. Literal text matches case-
// insensitively, because test text changes case between programs (tsmap
// compares test names the same way). The value's SI prefix does not: `m`
// (milli) and `M` (mega) are 10⁹ apart, and a wrong guess still draws a
// believable curve. A letter after the number is a prefix only when it stands
// alone or leads a unit symbol, and an M before a unit in capitals is refused —
// see `prefixAt`.

import { SI_PREFIX_SCALE, KNOWN_BASE_UNITS } from '../renderer/fmt.js';

type Part = { kind: 'lit'; text: string } | { kind: 'star' } | { kind: 'x' };

/** A compiled `xFromName` pattern. */
export interface XNamePattern { source: string; parts: Part[] }

/** Power of ten per prefix letter. `K` is not SI (kilo is `k`) but is how
 *  test programs write it everywhere — the one alias accepted. */
const PREFIX_EXP: Record<string, number> = Object.fromEntries(
  Object.entries({ ...SI_PREFIX_SCALE, K: 1e3 }).map(([p, s]) => [p, Math.round(Math.log10(s))]),
);

const isLetter = (c: string | undefined): boolean => c !== undefined && /\p{L}/u.test(c);

const UNITS_LOWER = [...new Set(KNOWN_BASE_UNITS.map(u => u.toLowerCase()))];

/**
 * How the letter at `at` reads: a prefix's power of ten, `null` when it is not
 * a prefix, or `'ambiguous'`.
 *
 * - **Alone** (`12K`, `12K_`, `12M/`): a prefix, case-sensitive — `m` milli,
 *   `M` mega.
 * - **Before a unit** (`12kΩ`, `10GHz`, `5us`): a prefix. The unit is found in
 *   any case, because test text is often all capitals (`12KOHM`).
 * - **Before a unit written in capitals** that are not its own spelling
 *   (`12KOHM`), or in a name with no lower-case letter at all (`V_5NS`): the
 *   text has lost its case, so the prefix is read in any
 *   case too — except `M`, which in capitals is milli or mega and is refused
 *   rather than guessed (`2MV` is far more likely 2 mV than 2 MV). A wrong
 *   guess would scale every point by the same factor and still look right.
 * - **Otherwise** it begins a word: `12Kangaroos` is twelve, `3pass` three.
 */
function prefixAt(name: string, at: number): number | null | 'ambiguous' {
  const c = name[at];
  if (c === undefined || !isLetter(c)) return null;
  const next = at + 1;
  if (!isLetter(name[next])) return PREFIX_EXP[c] ?? null;
  const rest = name.slice(next);
  const unit = UNITS_LOWER.find(u => rest.toLowerCase().startsWith(u) && !isLetter(rest[u.length]));
  if (unit === undefined) return null;
  // The text has lost its case when the unit is in capitals that are not its
  // own spelling (OHM, HZ), or — for a one-letter unit, whose own spelling IS a
  // capital (V, A, S) — when the whole name has no lower-case letter at all.
  const written = rest.slice(0, unit.length);
  const shouted = !KNOWN_BASE_UNITS.includes(written) || !/\p{Ll}/u.test(name);
  if (!shouted) return PREFIX_EXP[c] ?? null;
  // Capitals: the prefix letter's case no longer means anything.
  if (c.toLowerCase() === 'm') return 'ambiguous';
  return PREFIX_EXP[c] ?? PREFIX_EXP[c.toLowerCase()] ?? PREFIX_EXP[c.toUpperCase()] ?? null;
}

/** Compile a pattern, or return why it cannot be used. */
export function compileXNamePattern(source: string): XNamePattern | { error: string } {
  const parts: Part[] = [];
  let lit = '';
  let xCount = 0;
  const flush = (): void => { if (lit) { parts.push({ kind: 'lit', text: lit.toLowerCase() }); lit = ''; } };
  for (let i = 0; i < source.length; i++) {
    if (source.startsWith('{x}', i)) { flush(); parts.push({ kind: 'x' }); xCount++; i += 2; continue; }
    if (source[i] === '*') { flush(); if (parts.at(-1)?.kind !== 'star') parts.push({ kind: 'star' }); continue; }
    lit += source[i];
  }
  flush();
  if (xCount !== 1) return { error: `the pattern must contain {x} exactly once (it has ${xCount})` };
  return { source, parts };
}

// Sign, digits with an optional decimal point, optional exponent. A fixed
// pattern of our own, linear on any input — not the author's.
const NUMBER = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/;

/** A way to read the number at a position. `literalMustFollow` marks the plain
 *  reading after an ambiguous prefix: usable only when the pattern's next
 *  literal text consumes that letter (`{x}MV`), never left for the free tail. */
interface Reading { value: number; end: number; literalMustFollow?: string }

/** The ways the number at `pos` can be read: with its SI prefix, then without
 *  it — the second for a pattern that spells the prefix out as literal text
 *  (`{x}K`), which must see the `K` still in the name. */
function numberReadings(name: string, pos: number): Reading[] {
  const m = NUMBER.exec(name.slice(pos));
  if (!m) return [];
  const text = m[0];
  const end = pos + text.length;
  const prefix = prefixAt(name, end);
  if (prefix === 'ambiguous') {
    const token = name.slice(pos, end + 1 + (/^\p{L}+/u.exec(name.slice(end + 1))?.[0].length ?? 0));
    return [{ value: Number(text), end, literalMustFollow: token }];
  }
  const readings: Reading[] = [];
  if (prefix !== null) {
    // Built as one decimal literal, "5e-6", rather than 5 × 1e-6: the product
    // carries binary rounding (4.9999999999999996e-6) into every label.
    const [mantissa, exp = '0'] = text.split(/[eE]/);
    readings.push({ value: Number(`${mantissa}e${Number(exp) + prefix}`), end: end + 1 });
  }
  readings.push({ value: Number(text), end });
  return readings;
}

/**
 * The x value `pattern` reads from `name`; `null` when the pattern does not fit
 * the name anywhere (or fits only where no number stands at `{x}`); or
 * `{ ambiguous }` naming the text whose prefix cannot be read — `"2MV"`.
 */
export function readXFromName(pattern: XNamePattern, name: string): number | null | { ambiguous: string } {
  const { parts } = pattern;
  let ambiguous: string | undefined;
  const lower = name.toLowerCase();
  // Failed (part, position) pairs — the memo that bounds the search.
  const failed = new Set<number>();
  const key = (pi: number, pos: number): number => pi * (name.length + 1) + pos;

  function match(pi: number, pos: number): number | undefined {
    // Every part matched: the rest of the name is free (implicit trailing `*`).
    // `undefined` = no match; a number = the value read at `{x}`, or NaN before it.
    if (pi === parts.length) return NaN;
    if (failed.has(key(pi, pos))) return undefined;
    const part = parts[pi]!;
    let result: number | undefined;
    if (part.kind === 'lit') {
      if (lower.startsWith(part.text, pos)) result = match(pi + 1, pos + part.text.length);
    } else if (part.kind === 'star') {
      for (let p = pos; p <= name.length && result === undefined; p++) result = match(pi + 1, p);
    } else {
      for (const r of numberReadings(name, pos)) {
        if (r.literalMustFollow !== undefined) {
          const next = parts[pi + 1];
          if (next?.kind !== 'lit' || !lower.startsWith(next.text, r.end)) { ambiguous ??= r.literalMustFollow; continue; }
        }
        const rest = match(pi + 1, r.end);
        if (rest !== undefined) { result = r.value; break; }
      }
    }
    if (result === undefined) failed.add(key(pi, pos));
    return result;
  }

  // Implicit leading `*`: the first place in the name the pattern fits.
  for (let start = 0; start <= name.length; start++) {
    const v = match(0, start);
    if (v !== undefined) return Number.isFinite(v) ? v : null;
  }
  return ambiguous !== undefined ? { ambiguous } : null;
}
