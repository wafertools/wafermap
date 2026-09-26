/**
 * A wafer's test values and pass/fail verdicts, held as one column per test,
 * and the link from each `Die` to its row. Internal: nothing here is exported
 * from `core/index.ts`.
 *
 * A die has one storage for its test data, for its whole life:
 *
 * - **Linked.** A die `buildWaferMap` returns holds no value objects. It is
 *   linked to its row of the map's table, and `testValues` / `testPass` are
 *   read-only getters: each read builds a fresh frozen snapshot from the row
 *   and keeps nothing, so it is garbage once the host drops it. Reading never
 *   changes the die or how wmap reads it. Assigning to either field throws
 *   (see `readOnly`).
 * - **Own objects.** Every other die (hand-built, host-built, or a host's
 *   copy) is read from its `testValues` / `testPass` objects, as dies always
 *   were.
 *
 * The functions below are the ONLY read-path for a die's test data, for both
 * storages (`tests/dieReadPath.test.mjs` enforces it). Internal reads never
 * touch the getters, so a lot nobody asks for per-die objects never builds any.
 *
 * The link is non-enumerable, so a host's `{ ...die }` copy calls the getters
 * and gets plain objects, never a link: `{ ...die, testValues: mine }` then
 * reads `mine`. Structured clone and `JSON.stringify` also call the getters.
 */
import { hasAnyKey } from './utils.js';
import type { Die } from './dies.js';

/** No value in a value column. */
const NO_VALUE = NaN;
/** Verdict column entries: no verdict / fail / pass. */
export const VERDICT_NONE = -1;
export const VERDICT_FAIL = 0;
export const VERDICT_PASS = 1;

/** `DieTable.fields` bits: the record carried a `testValues` / `testPass` object. */
export const HAS_VALUES = 1;
export const HAS_VERDICTS = 2;

export interface DieTable {
  /** Number of rows. A die's row is an index below this. */
  readonly rows: number;
  /** Test number → value per row; `NaN` = no value. Stored as supplied, never narrowed. */
  readonly values: ReadonlyMap<number, Float32Array | Float64Array>;
  /** Test number → verdict per row: −1 none, 0 fail, 1 pass. */
  readonly verdicts: ReadonlyMap<number, Int8Array>;
  /**
   * Per row, which of `testValues` / `testPass` the die exposes (bits
   * `HAS_VALUES`, `HAS_VERDICTS`): the fields its record carried, so a die
   * with no verdicts has no `testPass`, exactly as before.
   */
  readonly fields: Uint8Array;
}

/**
 * The link from a die to its table row. During `buildWaferMap` the symbols
 * are ordinary properties, which the build's own copies carry along;
 * `finaliseDie` makes them non-enumerable on the die the host receives.
 */
const TABLE = Symbol('wmap.dieTable');
const ROW   = Symbol('wmap.dieRow');

type LinkedDie = { [TABLE]?: DieTable; [ROW]?: number };

/** What the readers need of a die. A `DieResult` qualifies. */
export type DieData = Pick<Die, 'testValues' | 'testPass'>;

/** Marks a die being built as `row` of `table`, in place. `finaliseDie` completes it. */
export function linkDie<D extends object>(die: D, table: DieTable, row: number): D {
  (die as LinkedDie)[TABLE] = table;
  (die as LinkedDie)[ROW] = row;
  return die;
}

/** The table and row `die` is linked to, or `undefined` for a die with its own objects. */
export function dieLink(die: DieData): { table: DieTable; row: number } | undefined {
  const table = (die as LinkedDie)[TABLE];
  return table === undefined ? undefined : { table, row: (die as LinkedDie)[ROW]! };
}

// ── Building ────────────────────────────────────────────────────────────────

type Row = { testValues?: Record<number, number>; testPass?: Record<number, boolean> };

/**
 * A table built from row-shaped records (`DieResult`s): row `i` holds
 * `rows[i]`'s values and verdicts. Values are copied as-is (`Float64Array`,
 * the precision a JS number has); a missing entry is `NaN` / no verdict.
 */
export function tableFromRows(rows: readonly Row[]): DieTable {
  const n = rows.length;
  const values = new Map<string, Float64Array>();
  const verdicts = new Map<string, Int8Array>();
  const fields = new Uint8Array(n);
  const valueCols = columnsFor(values, () => new Float64Array(n).fill(NO_VALUE));
  const verdictCols = columnsFor(verdicts, () => new Int8Array(n).fill(VERDICT_NONE));
  for (let i = 0; i < n; i++) {
    const tv = rows[i].testValues;
    if (tv) {
      fields[i] |= HAS_VALUES;
      const cols = valueCols(tv), vals = Object.values(tv);
      for (let j = 0; j < cols.length; j++) cols[j][i] = vals[j];
    }
    const tp = rows[i].testPass;
    if (tp) {
      fields[i] |= HAS_VERDICTS;
      const cols = verdictCols(tp), vals = Object.values(tp);
      for (let j = 0; j < cols.length; j++) cols[j][i] = vals[j] ? VERDICT_PASS : VERDICT_FAIL;
    }
  }
  return { rows: n, values: byTestNumber(values), verdicts: byTestNumber(verdicts), fields };
}

/**
 * For a row's object, its columns in `Object.keys` order (which is also
 * `Object.values` order). Rows of one wafer nearly always share their key
 * list, so the previous row's columns are reused when the keys match: no
 * lookup per value. Keys, not `for…in`: JavaScriptCore walks these
 * dictionary objects far more slowly with `for…in` (COLUMNAR_DATA §16.15).
 */
function columnsFor<C>(byKey: Map<string, C>, make: () => C): (obj: object) => C[] {
  let lastKeys: string[] = [];
  let lastCols: C[] = [];
  return (obj) => {
    const keys = Object.keys(obj);
    let same = keys.length === lastKeys.length;
    for (let j = 0; same && j < keys.length; j++) same = keys[j] === lastKeys[j];
    if (same) return lastCols;
    lastKeys = keys;
    lastCols = keys.map(k => {
      let col = byKey.get(k);
      if (col === undefined) byKey.set(k, col = make());
      return col;
    });
    return lastCols;
  };
}

/** Keyed by test number, ascending (as integer object keys enumerate): maps iterate in insertion order. */
function byTestNumber<V>(m: Map<string, V>): Map<number, V> {
  return new Map([...m].map(([k, v]): [number, V] => [Number(k), v]).sort((a, b) => a[0] - b[0]));
}

/**
 * A copy of `table` with more columns: `values` / `verdicts` are added (a test
 * number already present is replaced), and `fields` is copied, so the caller
 * can mark rows that gained data. The original table is never changed.
 */
export function extendTable(
  table: DieTable,
  values: ReadonlyMap<number, Float32Array | Float64Array>,
  verdicts: ReadonlyMap<number, Int8Array>,
): DieTable & { fields: Uint8Array } {
  const v = new Map(table.values), p = new Map(table.verdicts);
  for (const [tn, col] of values) v.set(tn, col);
  for (const [tn, col] of verdicts) p.set(tn, col);
  return {
    rows: table.rows,
    values: new Map([...v].sort((a, b) => a[0] - b[0])),
    verdicts: new Map([...p].sort((a, b) => a[0] - b[0])),
    fields: table.fields.slice(),
  };
}

/**
 * One reusable die-shaped view over `table`: `at(row)` points it at a row and
 * returns it, so a rule that takes a die (`getTestPassStatus`) can be applied
 * row by row without an object per row. Valid until the next `at`.
 */
export function rowView(table: DieTable): (row: number) => DieData {
  const view = linkDie({} as Die, table, 0) as Die & LinkedDie;
  return (row) => { view[ROW] = row; return view; };
}

// ── The die the host receives ───────────────────────────────────────────────

/** Row `row`'s values as an object (empty when it has none). Highest key first: see below. */
function materialiseValues(table: DieTable, row: number): Record<number, number> {
  const out: Record<number, number> = {};
  // Highest test number first: V8 then stores the keys as a dictionary rather
  // than a holey array sized to the largest key (COLUMNAR_DATA §16.8).
  // Enumeration order is ascending either way.
  const cols = [...table.values];
  for (let j = cols.length - 1; j >= 0; j--) {
    const v = cols[j][1][row];
    if (!Number.isNaN(v)) out[cols[j][0]] = v;
  }
  return out;
}

function materialiseVerdicts(table: DieTable, row: number): Record<number, boolean> {
  const out: Record<number, boolean> = {};
  const cols = [...table.verdicts];
  for (let j = cols.length - 1; j >= 0; j--) {
    const v = cols[j][1][row];
    if (v !== VERDICT_NONE) out[cols[j][0]] = v === VERDICT_PASS;
  }
  return out;
}

// One shared getter per field, so every die shares its shape. Each read builds
// a fresh frozen snapshot and keeps nothing on the die: once the host drops
// it, the garbage collector frees it, so however a host reads the dies, the
// lot's memory stays at the table's size. Hold on to the object to read it
// repeatedly.
function getValues(this: Die & LinkedDie): Die['testValues'] {
  return Object.freeze(materialiseValues(this[TABLE]!, this[ROW]!));
}
function getVerdicts(this: Die & LinkedDie): Die['testPass'] {
  return Object.freeze(materialiseVerdicts(this[TABLE]!, this[ROW]!));
}
/**
 * The values of a die `buildWaferMap` built are the map's data, not the die's:
 * changing one die's copy would make the die disagree with every chart and
 * statistic. So assigning throws, and says what to do instead.
 */
function readOnly(field: string): (this: Die) => void {
  return function (this: Die) {
    throw new TypeError(
      `wafermap: die.${field} is read-only on a die built by buildWaferMap (die ${this.id}). `
      + `Pass the values you want to buildWaferMap, or copy the die: { ...die, ${field}: yours }.`);
  };
}

const VALUES_ACCESSOR: PropertyDescriptor = { get: getValues, set: readOnly('testValues'), enumerable: true, configurable: true };
const VERDICTS_ACCESSOR: PropertyDescriptor = { get: getVerdicts, set: readOnly('testPass'), enumerable: true, configurable: true };
const hidden = (value: unknown): PropertyDescriptor => ({ value, writable: true, enumerable: false, configurable: true });

/**
 * The die a host receives, from a die built with `linkDie`: a fresh object with
 * the same fields, a non-enumerable link, and `testValues` / `testPass` getters
 * for the fields its record carried. A die with no link is returned as is.
 *
 * A die that already carries a value object its record does not replace (a
 * host-supplied layout die with its own `testPass`, say, and a record with
 * only values) is not linked: it gets its record's objects built onto it now,
 * beside its own, which is exactly what it had before tables existed.
 */
export function finaliseDie<D extends Die>(die: D): D {
  const table = (die as LinkedDie)[TABLE];
  if (table === undefined) return die;
  const row = (die as LinkedDie)[ROW]!;
  const fields = table.fields[row];
  const keepsOwn = (die.testValues !== undefined && !(fields & HAS_VALUES))
    || (die.testPass !== undefined && !(fields & HAS_VERDICTS));
  const out = {} as D;
  for (const k of Object.keys(die) as Array<keyof D & string>) {
    if (k === 'testValues' && fields & HAS_VALUES) continue;
    if (k === 'testPass' && fields & HAS_VERDICTS) continue;
    out[k] = die[k];
  }
  if (keepsOwn) {
    if (fields & HAS_VALUES) out.testValues = materialiseValues(table, row);
    if (fields & HAS_VERDICTS) out.testPass = materialiseVerdicts(table, row);
    return out;
  }
  Object.defineProperty(out, TABLE, hidden(table));
  Object.defineProperty(out, ROW, hidden(row));
  if (fields & HAS_VALUES) Object.defineProperty(out, 'testValues', VALUES_ACCESSOR);
  if (fields & HAS_VERDICTS) Object.defineProperty(out, 'testPass', VERDICTS_ACCESSOR);
  return out;
}

/**
 * A copy of `die` with `patch` applied. For a linked die this copies the
 * fields and the link without calling the getters: an object spread would
 * call them and build the value objects of every die it copies (3 s and the
 * lot's full memory on 266k dies). A patch that sets `testValues` or
 * `testPass` gives an own-objects die (the other field built from the row).
 */
export function copyDie<D extends DieData>(die: D, patch: Partial<D>): D {
  const table = (die as LinkedDie)[TABLE];
  if (table === undefined) return { ...die, ...patch };
  const row = (die as LinkedDie)[ROW]!;
  const fields = table.fields[row];
  const out = {} as D;
  for (const k of Object.keys(die) as Array<keyof D & string>) {
    if (k !== 'testValues' && k !== 'testPass') out[k] = die[k];
  }
  if ('testValues' in patch || 'testPass' in patch) {
    // Build only what the patch leaves: the stacked modes replace both.
    if (fields & HAS_VALUES && !('testValues' in patch)) out.testValues = materialiseValues(table, row);
    if (fields & HAS_VERDICTS && !('testPass' in patch)) out.testPass = materialiseVerdicts(table, row);
    return Object.assign(out, patch);
  }
  Object.assign(out, patch);
  Object.defineProperty(out, TABLE, hidden(table));
  Object.defineProperty(out, ROW, hidden(row));
  if (fields & HAS_VALUES) Object.defineProperty(out, 'testValues', VALUES_ACCESSOR);
  if (fields & HAS_VERDICTS) Object.defineProperty(out, 'testPass', VERDICTS_ACCESSOR);
  return out;
}

// ── Across a worker boundary ────────────────────────────────────────────────

/** What `detachTables` sends beside the dies: their tables, and each die's table and row. */
export interface DetachedTables {
  tables: DieTable[];
  /** Per die, in order across every die array: its table's index in `tables` (−1 unlinked), then its row. */
  links: Int32Array;
}

/**
 * Prepares linked dies to be posted from a worker without their values being
 * built and copied: takes their `testValues` / `testPass` getters off (a
 * structured clone would call them), and returns their tables and links. Post
 * the dies, and the result with `transfer` as the transfer list, which moves
 * the columns without a copy; the other side calls `attachTables`.
 *
 * **Changes the dies in place**, and transferring empties the columns: only
 * for dies the sender discards once they are posted.
 */
export function detachTables(dieArrays: ReadonlyArray<readonly Die[]>): DetachedTables & { transfer: ArrayBuffer[] } {
  const tables: DieTable[] = [];
  const indexOf = new Map<DieTable, number>();
  const total = dieArrays.reduce((n, a) => n + a.length, 0);
  const links = new Int32Array(total * 2);
  let k = 0;
  for (const dies of dieArrays) {
    for (const die of dies) {
      const link = dieLink(die);
      if (link === undefined) { links[k++] = -1; links[k++] = 0; continue; }
      let t = indexOf.get(link.table);
      if (t === undefined) { indexOf.set(link.table, t = tables.length); tables.push(link.table); }
      links[k++] = t; links[k++] = link.row;
      delete (die as Partial<Die>).testValues;
      delete (die as Partial<Die>).testPass;
    }
  }
  const transfer = new Set<ArrayBuffer>();
  for (const t of tables) {
    for (const col of t.values.values()) transfer.add(col.buffer as ArrayBuffer);
    for (const col of t.verdicts.values()) transfer.add(col.buffer as ArrayBuffer);
    transfer.add(t.fields.buffer as ArrayBuffer);
  }
  return { tables, links, transfer: [...transfer] };
}

/** The receiving half of `detachTables`: links the posted dies to their tables again, in place. */
export function attachTables(dieArrays: ReadonlyArray<readonly Die[]>, detached: DetachedTables): void {
  let k = 0;
  for (const dies of dieArrays) {
    for (const die of dies) {
      const t = detached.links[k++], row = detached.links[k++];
      if (t < 0) continue;
      const table = detached.tables[t];
      const fields = table.fields[row];
      Object.defineProperty(die, TABLE, hidden(table));
      Object.defineProperty(die, ROW, hidden(row));
      if (fields & HAS_VALUES) Object.defineProperty(die, 'testValues', VALUES_ACCESSOR);
      if (fields & HAS_VERDICTS) Object.defineProperty(die, 'testPass', VERDICTS_ACCESSOR);
    }
  }
}

// ── Reading ─────────────────────────────────────────────────────────────────

/** `die`'s value for test `testNumber`, or `undefined` when it has none. */
export function testValue(die: DieData, testNumber: number): number | undefined {
  const table = (die as LinkedDie)[TABLE];
  if (table === undefined) return die.testValues?.[testNumber];
  const v = table.values.get(testNumber)?.[(die as LinkedDie)[ROW]!];
  return v === undefined || Number.isNaN(v) ? undefined : v;
}

/**
 * `die`'s recorded verdict for test `testNumber` (true = pass), or `undefined`.
 * The raw record only: `getTestPassStatus` owns the functional-test fallback
 * and is what callers use.
 */
export function recordedVerdict(die: DieData, testNumber: number): boolean | undefined {
  const table = (die as LinkedDie)[TABLE];
  if (table === undefined) return die.testPass?.[testNumber];
  const v = table.verdicts.get(testNumber)?.[(die as LinkedDie)[ROW]!];
  return v === undefined || v === VERDICT_NONE ? undefined : v === VERDICT_PASS;
}

/** True when `die` has any measured value or recorded verdict. */
export function dieHasAnyTestData(die: DieData): boolean {
  return dieHasValues(die) || dieHasVerdicts(die);
}

/** True when `die` has at least one measured value. */
export function dieHasValues(die: DieData): boolean {
  const link = dieLink(die);
  if (link === undefined) return hasAnyKey(die.testValues);
  for (const col of link.table.values.values()) if (!Number.isNaN(col[link.row])) return true;
  return false;
}

/** True when `die` has at least one recorded verdict. */
export function dieHasVerdicts(die: DieData): boolean {
  const link = dieLink(die);
  if (link === undefined) return hasAnyKey(die.testPass);
  for (const col of link.table.verdicts.values()) if (col[link.row] !== VERDICT_NONE) return true;
  return false;
}

/** `die`'s values as `[testNumber, value]`, test numbers ascending. */
export function dieValueEntries(die: DieData): Array<[number, number]> {
  const link = dieLink(die);
  if (link === undefined) {
    const own = die.testValues;
    return own === undefined ? [] : Object.keys(own).map(k => [Number(k), own[Number(k)]]);
  }
  const out: Array<[number, number]> = [];
  for (const [tn, col] of link.table.values) {
    const v = col[link.row];
    if (!Number.isNaN(v)) out.push([tn, v]);
  }
  return out;
}

/** `die`'s recorded verdicts as `[testNumber, pass]`, test numbers ascending. */
export function dieVerdictEntries(die: DieData): Array<[number, boolean]> {
  const link = dieLink(die);
  if (link === undefined) {
    const own = die.testPass;
    return own === undefined ? [] : Object.keys(own).map(k => [Number(k), own[Number(k)]]);
  }
  const out: Array<[number, boolean]> = [];
  for (const [tn, col] of link.table.verdicts) {
    const v = col[link.row];
    if (v !== VERDICT_NONE) out.push([tn, v === VERDICT_PASS]);
  }
  return out;
}

/**
 * A reader of tests `testNumbers` for die after die: `read(die, out)` writes
 * test `testNumbers[k]`'s value to `out[k]` (`NaN` when none) and returns
 * `out`. For a linked die it is one indexed read per test: the columns are
 * looked up once per table, not once per die. The bulk path for statistics
 * that walk many dies × many tests.
 */
export function testValuesReader(testNumbers: readonly number[]): (die: DieData, out: Float64Array) => Float64Array {
  let lastTable: DieTable | undefined;
  let cols: Array<Float32Array | Float64Array | undefined> = [];
  return function readTestValues(die, out) {
    const link = dieLink(die);
    if (link === undefined) {
      const own = die.testValues;
      for (let k = 0; k < testNumbers.length; k++) {
        const v = own?.[testNumbers[k]];
        out[k] = v === undefined ? NaN : v;
      }
      return out;
    }
    if (link.table !== lastTable) {
      lastTable = link.table;
      cols = testNumbers.map(tn => link.table.values.get(tn));
    }
    for (let k = 0; k < cols.length; k++) {
      const col = cols[k];
      out[k] = col === undefined ? NaN : col[link.row];
    }
    return out;
  };
}

/**
 * {@link testValuesReader} for recorded verdicts: `read(die, out)` writes test
 * `testNumbers[k]`'s recorded verdict to `out[k]` — `VERDICT_PASS`,
 * `VERDICT_FAIL` or `VERDICT_NONE` — and returns `out`. The raw record only, as
 * {@link recordedVerdict}: `testPassStatusReader` adds the functional-test
 * fallback and is what callers use.
 */
export function recordedVerdictsReader(testNumbers: readonly number[]): (die: DieData, out: Int8Array) => Int8Array {
  let lastTable: DieTable | undefined;
  let cols: Array<Int8Array | undefined> = [];
  return function readRecordedVerdicts(die, out) {
    const link = dieLink(die);
    if (link === undefined) {
      const own = die.testPass;
      for (let k = 0; k < testNumbers.length; k++) {
        const v = own?.[testNumbers[k]];
        out[k] = v === undefined ? VERDICT_NONE : v ? VERDICT_PASS : VERDICT_FAIL;
      }
      return out;
    }
    if (link.table !== lastTable) {
      lastTable = link.table;
      cols = testNumbers.map(tn => link.table.verdicts.get(tn));
    }
    for (let k = 0; k < cols.length; k++) {
      const col = cols[k];
      out[k] = col === undefined ? VERDICT_NONE : col[link.row];
    }
    return out;
  };
}

/**
 * Every test number with at least one value or verdict among `dies` (only
 * values, with `which: 'values'`), ascending. Linked dies are checked column
 * by column per table, not die by die, and each column stops at its first hit.
 */
export function testsPresent(dies: readonly DieData[], which: 'all' | 'values' = 'all'): number[] {
  const found = new Set<number>();
  const rowsByTable = new Map<DieTable, number[]>();
  for (const d of dies) {
    const link = dieLink(d);
    if (link === undefined) {
      if (d.testValues) for (const k in d.testValues) found.add(Number(k));
      if (which === 'all' && d.testPass) for (const k in d.testPass) found.add(Number(k));
      continue;
    }
    let rows = rowsByTable.get(link.table);
    if (rows === undefined) rowsByTable.set(link.table, rows = []);
    rows.push(link.row);
  }
  for (const [table, rows] of rowsByTable) {
    for (const [tn, col] of table.values) {
      if (!found.has(tn) && rows.some(r => !Number.isNaN(col[r]))) found.add(tn);
    }
    if (which === 'values') continue;
    for (const [tn, col] of table.verdicts) {
      if (!found.has(tn) && rows.some(r => col[r] !== VERDICT_NONE)) found.add(tn);
    }
  }
  return [...found].sort((a, b) => a - b);
}
