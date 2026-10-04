// The text a sweep's lists are typed as, and back. Pure, so the editor's parsing is tested without a DOM and the
// same words mean the same list wherever a sweep is edited.
//
//   tests:    "1010, 1011, 1020..1030"   a test number, or a range as in a derived test's t[1020..1030]
//   numbers:  "0, 5, 10.5"               swept values, or separation levels
//
// Entries are separated by commas or whitespace. Nothing is guessed: text that is not a number or a range is
// reported with the offending word, never skipped, because a dropped test would shift every later test onto the
// wrong X.

const RANGE = /^(\d+)\s*\.\.\s*(\d+)$/;

export type TextResult<T> = { ok: true; value: T } | { ok: false; error: string };

const words = (text: string): string[] => text.replace(/\s*\.\.\s*/g, '..').split(/[,\s]+/).filter(w => w !== '');

/** A series' tests: whole numbers stay numbers, `a..b` stays a range string for the sweep to expand against the lot. */
export function parseTestList(text: string): TextResult<Array<number | string>> {
  const out: Array<number | string> = [];
  for (const w of words(text)) {
    if (/^\d+$/.test(w)) { out.push(Number(w)); continue; }
    const m = RANGE.exec(w);
    if (m) {
      if (Number(m[1]) > Number(m[2])) return { ok: false, error: `"${w}" runs backwards: write the lower test number first` };
      out.push(`${m[1]}..${m[2]}`);
      continue;
    }
    return { ok: false, error: `"${w}" is not a test number or a range such as 1010..1030` };
  }
  return { ok: true, value: out };
}

export const formatTestList = (tests: ReadonlyArray<number | string>): string => tests.join(', ');

/** Numbers separated by commas or spaces. */
export function parseNumberList(text: string): TextResult<number[]> {
  const out: number[] = [];
  for (const w of words(text)) {
    const n = Number(w);
    if (!Number.isFinite(n)) return { ok: false, error: `"${w}" is not a number` };
    out.push(n);
  }
  return { ok: true, value: out };
}

export const formatNumberList = (values: readonly number[]): string => values.join(', ');
