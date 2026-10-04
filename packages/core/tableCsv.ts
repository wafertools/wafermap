// The one CSV writer for tabular exports — pure, no DOM, no host hook.
//
// Every table this library saves (the test-values and functional tables, the die
// list, the correlation matrix) describes its columns the same way: a header and
// a function from a row to a cell. This module turns that description into text,
// so quoting, line endings and — above all — how a number is written are decided
// once. `canvas-adapter/tableExport.ts` adds the host save hook on top.
//
// NUMBERS. A file is read by a spreadsheet, JMP or a script, not by a person
// looking at a table, so a number is written as a number: plain, parseable and
// carrying every digit the measurement had. Screen formatting (`fmt`, with its
// unit prefixes and four significant figures) belongs to the screen only; the
// earlier exports ran values through it and so rounded `452.123456789` to `452.1`.
// What is trimmed is float noise, not data: 15 significant digits is where a
// double stops being reliable (0.1 + 0.2 → 0.3). Single-precision readings, which
// are what testers record, are written in their own shortest form (see fileNumber).

import { csvField } from './utils.js';

/** A cell: a number is written by {@link fileNumber}, a string is escaped by
 *  `csvField`, and null/undefined/non-finite are an empty cell. */
export type CsvCell = string | number | null | undefined;

/** One column: its header and how to read it from a row. */
export interface CsvColumn<R> {
  header: string;
  get: (row: R) => CsvCell;
}

/** Significant digits written for a number: a double's reliable precision. */
export const FILE_NUMBER_DIGITS = 15;

/**
 * A number as it goes into a file, in plain or exponent notation (`0.000123`,
 * `1.5e-7`) that every consumer parses. Non-finite → empty.
 *
 * - **A whole number** is written as is.
 * - **A single-precision reading** (an STDF `R*4`, which wmap keeps as `f32`)
 *   is written as the shortest decimal that is still that same `f32`: `0.5123457`,
 *   not the 17-digit expansion of the double it was widened to
 *   (`0.51234567165374756`), which claims precision the tester never recorded and
 *   doubles the size of the file.
 * - **Anything else** keeps {@link FILE_NUMBER_DIGITS} significant digits, which
 *   drops float noise (`0.1 + 0.2` → `0.3`) and nothing a measurement carried.
 */
export function fileNumber(n: number): string {
  if (!Number.isFinite(n)) return '';
  if (Number.isInteger(n) && Math.abs(n) < 1e15) return String(n);
  if (Math.fround(n) === n) return singlePrecisionText(n);
  return String(Number(n.toPrecision(FILE_NUMBER_DIGITS)));
}

/**
 * The shortest decimal that reads back as the same `f32` — 7, 8 or 9 significant
 * digits. Done by scaling and rounding rather than `toPrecision`, which is about
 * four times slower and this runs once per cell of a table that can have 20
 * million. `Math.round(n * 10^k) / 10^k` is the double nearest the k-place
 * decimal (an integer over an exact power of ten is correctly rounded), so its
 * `String` is that decimal; the `fround` check means a wrong guess can only cost
 * a digit, never produce a different reading.
 */
function singlePrecisionText(n: number): string {
  const e = Math.floor(Math.log10(Math.abs(n)));
  for (let digits = 7; digits <= 9; digits++) {
    const k = digits - 1 - e;
    if (k < 0 || k > 22) break;          // beyond where a power of ten is exact
    const scale = 10 ** k;
    const c = Math.round(n * scale) / scale;
    if (Math.fround(c) === n) return String(c);
  }
  // Very small or very large readings, or a guess that never verified.
  for (let p = 7; p <= 9; p++) {
    const s = n.toPrecision(p);
    if (Math.fround(Number(s)) === n) return String(Number(s));
  }
  return String(Number(n.toPrecision(FILE_NUMBER_DIGITS)));
}

/** One cell as CSV text, escaped. */
export function csvCell(value: CsvCell): string {
  if (value === null || value === undefined) return '';
  return typeof value === 'number' ? fileNumber(value) : csvField(value);
}

/** One CSV line from cells, without a line ending. */
export function csvLine(cells: readonly CsvCell[]): string {
  return cells.map(csvCell).join(',');
}

/** A header row and one line per row, joined with `\n` (no trailing newline —
 *  the format every export here has always used). */
export function tableToCsv<R>(columns: readonly CsvColumn<R>[], rows: Iterable<R>): string {
  return Array.from(csvLines(columns, rows)).join('\n');
}

/** The header line, then one line per row, as they are produced. The unit a
 *  streaming writer works in: it can stop between any two lines, which a joined
 *  string cannot. */
export function* csvLines<R>(columns: readonly CsvColumn<R>[], rows: Iterable<R>): Generator<string> {
  yield csvLine(columns.map(c => c.header));
  for (const row of rows) yield csvLine(columns.map(c => c.get(row)));
}
