// Reading your own CSV — usually the first real thing you will do.
//
// This is a deliberately small parser: enough for well-formed test data, short
// enough to read in one sitting and adapt. It does NOT handle quoted fields
// containing commas or newlines. If your exports have those, reach for a real
// CSV library (Papa Parse, csv-parse) — the mapping below stays the same either way.
//
// Usage in app.js:
//   import { loadCsv } from './load-csv.js';
//   const results = await loadCsv('./my-wafer.csv');

/**
 * Column names this maps automatically. Edit to match your tester's export
 * rather than renaming columns in the file.
 */
export const COLUMNS = {
  x:    ['x', 'die_x', 'diex', 'xcoord', 'x_coord'],
  y:    ['y', 'die_y', 'diey', 'ycoord', 'y_coord'],
  hbin: ['hbin', 'hard_bin', 'hardbin', 'bin'],
  sbin: ['sbin', 'soft_bin', 'softbin'],
};

/** Numeric test columns to carry through as testValues, keyed by testNumber. */
export const TEST_COLUMNS = {
  // 'testA': 1050,
  // 'testB': 1060,
};

function findColumn(header, candidates) {
  const lower = header.map(h => h.trim().toLowerCase());
  for (const c of candidates) {
    const i = lower.indexOf(c);
    if (i !== -1) return i;
  }
  return -1;
}

/**
 * Fetch and parse a CSV into a DieResult[] ready for buildWaferMap.
 *
 * @param {string} url            path to the CSV, relative to this page
 * @param {object} [opts]
 * @param {string} [opts.waferId] keep only rows whose wafer column matches
 */
export async function loadCsv(url, { waferId } = {}) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`could not load ${url} — HTTP ${response.status}`);
  }

  const text  = await response.text();
  const lines = text.split(/\r?\n/).filter(l => l.trim() && !l.startsWith('#'));
  if (!lines.length) throw new Error(`${url} is empty`);

  const header = lines[0].split(',');
  const ix     = findColumn(header, COLUMNS.x);
  const iy     = findColumn(header, COLUMNS.y);
  const ihbin  = findColumn(header, COLUMNS.hbin);
  const isbin  = findColumn(header, COLUMNS.sbin);
  const iwafer = findColumn(header, ['wafer', 'wafer_id', 'waferid']);

  if (ix === -1 || iy === -1) {
    throw new Error(
      `${url}: could not find x/y columns. Header was: ${header.join(', ')}\n` +
      `Add your column names to COLUMNS in load-csv.js.`
    );
  }

  const testIx = Object.entries(TEST_COLUMNS)
    .map(([name, testNumber]) => ({ testNumber, i: findColumn(header, [name.toLowerCase()]) }))
    .filter(t => t.i !== -1);

  const results = [];

  for (let n = 1; n < lines.length; n++) {
    const cells = lines[n].split(',');

    if (waferId != null && iwafer !== -1 && cells[iwafer]?.trim() !== waferId) continue;

    const x = Number(cells[ix]);
    const y = Number(cells[iy]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;

    const die = { x, y };

    // A missing bin is NOT bin 0 — leave the field off entirely so the die
    // renders as no-data grey instead of being counted as a real bin.
    if (ihbin !== -1) {
      const v = Number(cells[ihbin]);
      if (Number.isFinite(v)) die.hbin = v;
    }
    if (isbin !== -1) {
      const v = Number(cells[isbin]);
      if (Number.isFinite(v)) die.sbin = v;
    }

    if (testIx.length) {
      const testValues = {};
      for (const t of testIx) {
        const v = Number(cells[t.i]);
        if (Number.isFinite(v)) testValues[t.testNumber] = v;
      }
      if (Object.keys(testValues).length) die.testValues = testValues;
    }

    results.push(die);
  }

  if (!results.length) {
    throw new Error(`${url}: parsed 0 dies${waferId ? ` for wafer '${waferId}'` : ''}`);
  }

  return results;
}

/** Distinct wafer ids in a CSV — build your wafer selector from this, never a hardcoded list. */
export async function listWafers(url) {
  const text   = await (await fetch(url)).text();
  const lines  = text.split(/\r?\n/).filter(l => l.trim() && !l.startsWith('#'));
  const header = lines[0].split(',');
  const iwafer = findColumn(header, ['wafer', 'wafer_id', 'waferid']);
  if (iwafer === -1) return [];

  const seen = new Set();
  for (let n = 1; n < lines.length; n++) {
    const v = lines[n].split(',')[iwafer]?.trim();
    if (v) seen.add(v);
  }
  return [...seen].sort();
}
