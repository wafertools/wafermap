/**
 * The front door: both forms of `results` (rows or columns) become the same
 * internal form here, record shells linked to a value table, before anything
 * else in `buildWaferMap` runs.
 *
 * A shell is a `DieResult` without `testValues`/`testPass`: position, bins,
 * site, part ID, metadata, `supersedes`. It is linked to its row of the table
 * (`linkDie`), so retest resolution, derived tests and the lot stack read its
 * values through `core/dieTable.ts` like any die, and the dies built from the
 * shells are linked to the same rows.
 */
import type { DieMetadata } from '../core/metadata.js';
import type { DieTable } from '../core/dieTable.js';
import { dieLink, linkDie, tableFromRows, HAS_VALUES, HAS_VERDICTS, VERDICT_FAIL, VERDICT_NONE, VERDICT_PASS } from '../core/dieTable.js';
import { isStdfTestNumber } from '../core/stdf.js';
import type { DieResult } from './buildWaferMap.js';

/**
 * One wafer's results as columns: one entry per **record**, retests included
 * (wmap resolves retests exactly as for rows). An alternative to `DieResult[]`
 * for a host that already holds columns (a parser, Arrow or Parquet): it builds
 * the same map without an object per die. If you have rows, pass rows.
 *
 * Per-record columns must all have `count` entries. A missing entry is `NaN`,
 * or STDF V4's own missing value in an integer column: −32768 for `x`/`y`,
 * 65535 for `hbin`, `sbin` and `siteNum`. Any other value outside STDF's ranges
 * is treated as missing and reported, as for rows. A die is either fully
 * positioned or fully unpositioned: `x` and `y` must be missing together.
 *
 * Test values and verdicts are **sparse**: per test number, the record indices
 * that have one, and their values. A record a test did not run on is simply
 * not listed, so a missing value can never be mistaken for a reading, and
 * nothing can shift. Indices must be whole numbers in `[0, count)`, each at
 * most once per test, and `indices` and `values` must be the same length:
 * `buildWaferMap` throws otherwise, because a misaligned column would draw a
 * plausible, wrong map. Values are stored as supplied (`Float32Array` stays
 * 32-bit); a non-finite value is treated as missing and reported. Verdicts are
 * `true`/`1` (pass) or `false`/`0` (fail).
 */
export interface DieColumns {
  /** Number of records. */
  count: number;
  x?: ArrayLike<number>;
  y?: ArrayLike<number>;
  hbin?: ArrayLike<number>;
  sbin?: ArrayLike<number>;
  siteNum?: ArrayLike<number>;
  partId?: ArrayLike<number | string | undefined>;
  supersedes?: ArrayLike<'partId' | 'position' | undefined>;
  metadata?: ArrayLike<DieMetadata | undefined>;
  /** Per test number: the records that have a value, and the values. */
  testValues?: Record<number, { indices: ArrayLike<number>; values: ArrayLike<number> }>;
  /** Per test number: the records that have a recorded verdict, and the verdicts. */
  testPass?: Record<number, { indices: ArrayLike<number>; values: ArrayLike<boolean | number> }>;
}

/** Findings from the columns' test data, reported with the rest of the input checks. */
export interface ColumnFindings {
  /** Verdicts that were neither true/false nor 1/0. */
  wrongVerdicts: number;
  /** Values that were not numbers. */
  wrongValues: number;
  example?: string;
  /** Non-finite values. */
  nonFinite: number;
  /** Test numbers STDF cannot store, as given. */
  badTestNumbers: string[];
}

/** A wafer as record shells, each linked to its row of `table`. */
export interface LinkedRecords {
  records: DieResult[];
  table: DieTable;
}

export function isDieColumns(v: unknown): v is DieColumns {
  return v !== null && typeof v === 'object' && !Array.isArray(v) && typeof (v as DieColumns).count === 'number';
}

/** Rows as shells linked to a table built from their values. The rows are not changed. */
export function linkRows(rows: readonly DieResult[]): LinkedRecords {
  const table = tableFromRows(rows);
  const records = rows.map((r, i) => {
    const { testValues: _v, testPass: _p, ...shell } = r;
    return linkDie(shell as DieResult, table, i);
  });
  return { records, table };
}

/** Points every record at `table` (same rows): after derived tests extend it. */
export function relink(records: readonly DieResult[], table: DieTable): void {
  for (const r of records) linkDie(r, table, dieLink(r)!.row);
}

/** STDF's missing values for integer columns; `NaN` is missing in any column. */
const COORD_MISSING = -32768;
const U16_MISSING = 65535;

/**
 * Columns as shells linked to a table. Structural faults (lengths, indices)
 * throw; value faults are left for the input checks (positions, bins, sites:
 * copied onto the shells as given) or counted in `findings` (test data).
 */
export function linkColumns(cols: DieColumns, findings: ColumnFindings): LinkedRecords {
  const n = cols.count;
  if (!Number.isInteger(n) || n < 0) throw new TypeError(`buildWaferMap: columns \`count\` must be a whole number of records, got ${String(n)}.`);
  const perRecord = ['x', 'y', 'hbin', 'sbin', 'siteNum', 'partId', 'supersedes', 'metadata'] as const;
  for (const f of perRecord) {
    const col = cols[f];
    if (col !== undefined && col.length !== n) {
      throw new TypeError(`buildWaferMap: column \`${f}\` has ${col.length} entries for ${n} records. Every per-record column needs one entry per record.`);
    }
  }

  const fields = new Uint8Array(n);
  const values = new Map<number, Float32Array | Float64Array>();
  const verdicts = new Map<number, Int8Array>();
  const seen = new Uint8Array(n);

  const pairs = <V>(field: 'testValues' | 'testPass', each: (tn: number, idx: ArrayLike<number>, vals: ArrayLike<V>) => void) => {
    const byTest = cols[field] as Record<string, { indices: ArrayLike<number>; values: ArrayLike<V> }> | undefined;
    if (byTest === undefined) return;
    for (const key of Object.keys(byTest)) {
      const { indices, values: vals } = byTest[key] ?? {};
      if (indices === undefined || vals === undefined || indices.length !== vals.length) {
        throw new TypeError(`buildWaferMap: ${field}[${key}] needs \`indices\` and \`values\` of the same length `
          + `(got ${indices?.length ?? 'none'} and ${vals?.length ?? 'none'}).`);
      }
      seen.fill(0);
      for (let k = 0; k < indices.length; k++) {
        const i = indices[k];
        if (!Number.isInteger(i) || i < 0 || i >= n) {
          throw new TypeError(`buildWaferMap: ${field}[${key}].indices[${k}] is ${String(i)}, not a record index in [0, ${n}).`);
        }
        if (seen[i]) throw new TypeError(`buildWaferMap: ${field}[${key}] lists record ${i} twice.`);
        seen[i] = 1;
      }
      if (!isStdfTestNumber(Number(key))) { findings.badTestNumbers.push(key); continue; }
      each(Number(key), indices, vals);
    }
  };

  pairs<number>('testValues', (tn, idx, vals) => {
    const col = vals instanceof Float32Array ? new Float32Array(n).fill(NaN) : new Float64Array(n).fill(NaN);
    for (let k = 0; k < idx.length; k++) {
      const i = idx[k], v = vals[k];
      fields[i] |= HAS_VALUES;
      if (typeof v !== 'number') { findings.wrongValues++; findings.example ??= `testValues ${JSON.stringify(v)}`; continue; }
      if (!Number.isFinite(v)) { findings.nonFinite++; continue; }
      col[i] = v;
    }
    values.set(tn, col);
  });
  pairs<boolean | number>('testPass', (tn, idx, vals) => {
    const col = new Int8Array(n).fill(VERDICT_NONE);
    for (let k = 0; k < idx.length; k++) {
      const i = idx[k], v = vals[k];
      fields[i] |= HAS_VERDICTS;
      if (v === true || v === 1) col[i] = VERDICT_PASS;
      else if (v === false || v === 0) col[i] = VERDICT_FAIL;
      else { findings.wrongVerdicts++; findings.example ??= `testPass ${JSON.stringify(v)}`; }
    }
    verdicts.set(tn, col);
  });

  const table: DieTable = {
    rows: n,
    values: new Map([...values].sort((a, b) => a[0] - b[0])),
    verdicts: new Map([...verdicts].sort((a, b) => a[0] - b[0])),
    fields,
  };

  const num = (col: ArrayLike<number> | undefined, i: number, missing: number): number | undefined => {
    if (col === undefined) return undefined;
    const v = col[i];
    return v === missing || Number.isNaN(v) ? undefined : v;
  };
  const records = new Array<DieResult>(n);
  for (let i = 0; i < n; i++) {
    // Fields in one fixed order, so every shell shares a shape.
    const r: DieResult = {};
    const x = num(cols.x, i, COORD_MISSING), y = num(cols.y, i, COORD_MISSING);
    if (x !== undefined) r.x = x;
    if (y !== undefined) r.y = y;
    const hbin = num(cols.hbin, i, U16_MISSING), sbin = num(cols.sbin, i, U16_MISSING);
    if (hbin !== undefined) r.hbin = hbin;
    if (sbin !== undefined) r.sbin = sbin;
    const site = num(cols.siteNum, i, U16_MISSING);
    if (site !== undefined) r.siteNum = site;
    const partId = cols.partId?.[i];
    if (partId !== undefined) r.partId = partId;
    const supersedes = cols.supersedes?.[i];
    if (supersedes !== undefined) r.supersedes = supersedes;
    const metadata = cols.metadata?.[i];
    if (metadata !== undefined) r.metadata = metadata;
    records[i] = linkDie(r, table, i);
  }
  return { records, table };
}
