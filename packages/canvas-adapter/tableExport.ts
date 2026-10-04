// Saving a table as CSV: the columns-and-rows description from core/tableCsv.ts,
// written through the host's save hook. The one entry point every table export in
// the library uses, so the file's format and the way it is handed to the host
// cannot drift between them. The file NAME is not chosen here — a save site passes
// its content name and `exportName.ts` adds the lot/wafer context.
//
// SMALL AND LARGE. Most tables are a screenful; those are built in one go and
// handed over as a string, exactly as before. A table of a million cells or more
// (a lot's die list: 400k dies × 50 tests is 20 million) is built in slices of
// about 30 ms, yielding to the event loop between them so the page stays
// responsive, and each megabyte of text is moved into a Blob as it is made, so
// the JS heap never holds the whole file. The host then receives a Blob — see
// `SaveTextHandler`. Measured on 400k dies × 50 tests, 201 MB out: building one
// string needs about 400 MB of heap and fails at 250 MB; the sliced path
// completes at 250 MB, and has no string-length ceiling.

import { csvLines, type CsvColumn } from '../core/tableCsv.js';
import { saveTextFile, type SaveTextHandler } from './toolbar.js';

export type { CsvCell, CsvColumn } from '../core/tableCsv.js';

/** Cells (rows × columns) from which a table is written in slices as a Blob. */
export const LARGE_EXPORT_CELLS = 1_000_000;

/** How long one slice may run before yielding to the event loop. */
const SLICE_MS = 30;
/** Characters of text gathered before they are moved into a Blob. */
const BLOB_PART_CHARS = 1 << 20;

export interface ExportCsvOptions {
  /** Row count, when `rows` is not an array — decides small vs large. Unknown → large. */
  rowCount?: number;
  /** Called after each slice of a large export with the rows written so far.
   *  Never called for a small export, which finishes before it could be shown. */
  onProgress?: (rowsWritten: number, rowCount: number | undefined) => void;
  /** Override {@link LARGE_EXPORT_CELLS}; for tests. */
  largeCells?: number;
}

const yieldToEventLoop = () => new Promise<void>(resolve => setTimeout(resolve, 0));

/**
 * Write `rows` as CSV and save it as `filename` via `onSaveText` (or the browser
 * download). Returns `void` for a small table, which is saved before it returns,
 * and a promise for a large one, which resolves once the host has been handed the
 * Blob (not once the user has finished a native dialog).
 */
export function exportCsv<R>(
  columns: readonly CsvColumn<R>[],
  rows: Iterable<R>,
  filename: string,
  onSaveText?: SaveTextHandler,
  options: ExportCsvOptions = {},
): void | Promise<void> {
  const rowCount = Array.isArray(rows) ? rows.length : options.rowCount;
  const large = rowCount === undefined || rowCount * columns.length >= (options.largeCells ?? LARGE_EXPORT_CELLS);
  if (!large) {
    saveTextFile(Array.from(csvLines(columns, rows)).join('\n'), filename, 'text/csv', onSaveText);
    return;
  }
  return exportLarge(columns, rows, rowCount, filename, onSaveText, options);
}

async function exportLarge<R>(
  columns: readonly CsvColumn<R>[],
  rows: Iterable<R>,
  rowCount: number | undefined,
  filename: string,
  onSaveText: SaveTextHandler | undefined,
  options: ExportCsvOptions,
): Promise<void> {
  const parts: Blob[] = [];
  let pending: string[] = [];
  let pendingChars = 0;
  const flush = () => {
    if (pending.length) parts.push(new Blob([pending.join('')]));
    pending = [];
    pendingChars = 0;
  };

  let sliceStart = performance.now();
  let written = 0;     // data rows; the header line is not one
  let first = true;
  for (const line of csvLines(columns, rows)) {
    // A newline BEFORE every line but the first, so the file has no trailing one.
    const text = first ? line : '\n' + line;
    pending.push(text);
    pendingChars += text.length;
    if (!first) written++;
    first = false;
    if (pendingChars >= BLOB_PART_CHARS) flush();
    if (performance.now() - sliceStart >= SLICE_MS) {
      options.onProgress?.(written, rowCount);
      await yieldToEventLoop();
      sliceStart = performance.now();
    }
  }
  flush();
  options.onProgress?.(written, rowCount);
  saveTextFile(new Blob(parts, { type: 'text/csv' }), filename, 'text/csv', onSaveText);
}
