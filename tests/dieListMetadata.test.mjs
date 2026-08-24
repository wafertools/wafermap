import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>');
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.HTMLDivElement = dom.window.HTMLDivElement;
globalThis.Node = dom.window.Node;

const { buildDieListSection } = await import('../dist/packages/canvas-adapter/dieList.js');
const { resolveMetadataColumns, discoverDieMetadataKeys } = await import('../dist/packages/stats/metadataColumns.js');

function die(overrides) {
  return { x: 0, y: 0, ...overrides };
}

// Minimal RFC4180-ish line splitter — the Position column is always
// "(x, y)", which csvField correctly quotes because it contains a comma, so
// a naive text.split(',') breaks on every single row this suite builds.
function parseCsvLine(line) {
  const fields = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') { inQuotes = false; }
      else { cur += c; }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      fields.push(cur); cur = '';
    } else {
      cur += c;
    }
  }
  fields.push(cur);
  return fields;
}

// ── Parity invariant: the regression guard for the exact drift this change
// fixes — the DOM table and the CSV export must never disagree. ─────────────

function buildWithCapture(dies, testDefs, options = {}) {
  const saved = {};
  const section = buildDieListSection(dies, testDefs, {
    ...options,
    onSaveText: (text) => { saved.text = text; },
  });
  const btn = [...section.querySelectorAll('button')].find(b => b.textContent === 'Export CSV');
  btn.click();
  return { section, csv: saved.text };
}

test('dieList — table and CSV headers/rows are identical for non-csvOnly columns', () => {
  const dies = [
    die({ x: 0, y: 0, hbin: 1, metadata: { part_id: 'XJ-1' } }),
    die({ x: 1, y: 0, hbin: 2, metadata: { part_id: 'XJ-2' } }),
  ];
  const { section, csv } = buildWithCapture(dies, undefined, { waferMetadataColumns: 'csv' });

  const domHeaders = [...section.querySelectorAll('th')].map(th => th.textContent);
  const domRows = [...section.querySelectorAll('tbody tr')].map(
    tr => [...tr.querySelectorAll('td')].map(td => td.textContent),
  );

  const [csvHeaderLine, ...csvRowLines] = csv.split('\n');
  const csvHeaders = parseCsvLine(csvHeaderLine);
  const csvRows = csvRowLines.map(l => parseCsvLine(l));

  assert.deepEqual(domHeaders, csvHeaders);
  assert.deepEqual(domRows, csvRows);
  assert.ok(domHeaders.includes('part_id') || domHeaders.some(h => /part/i.test(h)));
});

test('dieList — die metadata appears in both table and CSV; wafer metadata is CSV-only by default', () => {
  const dies = [die({ metadata: { part_id: 'XJ-1' } })];
  const { section, csv } = buildWithCapture(dies, undefined, {
    waferMetadata: { lot: 'L1', waferId: 'W1' },
  });

  const domHeaders = [...section.querySelectorAll('th')].map(th => th.textContent);
  assert.ok(domHeaders.some(h => /part.*id/i.test(h)), `expected a part_id column, got: ${domHeaders}`);
  assert.ok(!domHeaders.includes('Lot'), `wafer metadata leaked into the table: ${domHeaders}`);

  const csvHeaders = parseCsvLine(csv.split('\n')[0]);
  assert.ok(csvHeaders.includes('Lot'), `CSV missing wafer metadata: ${csvHeaders}`);
  assert.ok(csvHeaders.some(h => /wafer/i.test(h)), `CSV missing waferId column: ${csvHeaders}`);
});

test('dieList — waferMetadataColumns "both" shows wafer metadata on screen too', () => {
  const dies = [die()];
  const { section } = buildWithCapture(dies, undefined, {
    waferMetadata: { lot: 'L1' },
    waferMetadataColumns: 'both',
  });
  const domHeaders = [...section.querySelectorAll('th')].map(th => th.textContent);
  assert.ok(domHeaders.includes('Lot'));
});

test('dieList — waferMetadataColumns "none" omits wafer metadata from both', () => {
  const dies = [die()];
  const { section, csv } = buildWithCapture(dies, undefined, {
    waferMetadata: { lot: 'L1' },
    waferMetadataColumns: 'none',
  });
  const domHeaders = [...section.querySelectorAll('th')].map(th => th.textContent);
  const csvHeaders = parseCsvLine(csv.split('\n')[0]);
  assert.ok(!domHeaders.includes('Lot'));
  assert.ok(!csvHeaders.includes('Lot'));
});

test('dieList — metadataColumns "none" omits die metadata from both', () => {
  const dies = [die({ metadata: { part_id: 'XJ-1' } })];
  const { section, csv } = buildWithCapture(dies, undefined, { metadataColumns: 'none' });
  const domHeaders = [...section.querySelectorAll('th')].map(th => th.textContent);
  const csvHeaders = parseCsvLine(csv.split('\n')[0]);
  assert.ok(!domHeaders.some(h => /part/i.test(h)));
  assert.ok(!csvHeaders.some(h => /part/i.test(h)));
});

// ── Collision resolution ─────────────────────────────────────────────────

test('dieList — a die metadata key literally named "Site" gets its own distinct column, nothing dropped', () => {
  const dies = [die({ siteNum: 1, metadata: { Site: 'north' } })];
  const { section, csv } = buildWithCapture(dies, undefined, {});
  const domHeaders = [...section.querySelectorAll('th')].map(th => th.textContent);
  // Built-in 'Site' plus the disambiguated metadata column — five distinct headers.
  assert.deepEqual(domHeaders, ['Position', 'Site', 'Hard bin', 'Soft bin', 'Site (metadata)']);
  const domRow = [...section.querySelector('tbody tr').querySelectorAll('td')].map(td => td.textContent);
  assert.equal(domRow[1], '1');            // built-in Site (siteNum)
  assert.equal(domRow[4], 'north');        // metadata Site, disambiguated
});

// ── Shadowing ─────────────────────────────────────────────────────────────

test('dieList — a key on both wafer and die metadata yields exactly one column, carrying the die value', () => {
  const dies = [die({ metadata: { operator: 'die-value' } })];
  const { csv } = buildWithCapture(dies, undefined, {
    waferMetadata: { operator: 'wafer-value' },
  });
  const headers = parseCsvLine(csv.split('\n')[0]);
  const operatorCols = headers.filter(h => /operator/i.test(h));
  assert.equal(operatorCols.length, 1, `expected exactly one Operator column, got: ${headers}`);
  const row = parseCsvLine(csv.split('\n')[1]);
  assert.equal(row[headers.indexOf(operatorCols[0])], 'die-value');
});

// ── Determinism ───────────────────────────────────────────────────────────

test('discoverDieMetadataKeys — key order is independent of per-die insertion order', () => {
  const diesA = [
    die({ metadata: { b: 1, a: 2 } }),
    die({ metadata: { a: 3, b: 4 } }),
  ];
  const diesB = [
    die({ metadata: { a: 2, b: 1 } }),
    die({ metadata: { b: 4, a: 3 } }),
  ];
  assert.deepEqual(discoverDieMetadataKeys(diesA).keys, discoverDieMetadataKeys(diesB).keys);
});

test('dieList — CSV export is byte-identical across two builds of the same data', () => {
  const dies = [
    die({ metadata: { b: 'x', a: 'y' } }),
    die({ metadata: { a: 'z', b: 'w' } }),
  ];
  const { csv: csv1 } = buildWithCapture(dies, undefined, {});
  const { csv: csv2 } = buildWithCapture(dies, undefined, {});
  assert.equal(csv1, csv2);
});

// ── Union discovery over the whole population ────────────────────────────

test('dieList — a metadata key present only on a late die still gets a column, with blanks earlier', () => {
  const dies = [
    die({ metadata: { part_id: 'XJ-1' } }),
    die({ metadata: { part_id: 'XJ-2' } }),
    die({ metadata: { part_id: 'XJ-3', probe_card: 'PC-7' } }),
  ];
  const { csv } = buildWithCapture(dies, undefined, {});
  const lines = csv.split('\n');
  const headers = parseCsvLine(lines[0]);
  const probeIdx = headers.findIndex(h => /probe.card/i.test(h));
  assert.ok(probeIdx >= 0, `expected a probe_card column, got: ${headers}`);
  assert.equal(parseCsvLine(lines[1])[probeIdx], '');
  assert.equal(parseCsvLine(lines[2])[probeIdx], '');
  assert.equal(parseCsvLine(lines[3])[probeIdx], 'PC-7');
  // Column count is constant across every row.
  for (const line of lines) assert.equal(parseCsvLine(line).length, headers.length);
});

// ── maxRows ───────────────────────────────────────────────────────────────

test('dieList — maxRows caps the DOM table but never the CSV export', () => {
  const dies = Array.from({ length: 10 }, (_, i) => die({ x: i, siteNum: i }));
  const { section, csv } = buildWithCapture(dies, undefined, { maxRows: 3 });

  const domRows = section.querySelectorAll('tbody tr');
  assert.equal(domRows.length, 3);

  const csvLines = csv.split('\n');
  assert.equal(csvLines.length, dies.length + 1); // header + every die

  const footerText = section.textContent;
  assert.match(footerText, /Showing the first 3 of 10 dies/);
  assert.match(footerText, /CSV export contains all 10/);
});

test('dieList — no footer appears when nothing was truncated', () => {
  const dies = [die(), die()];
  const { section } = buildWithCapture(dies, undefined, { maxRows: 50 });
  assert.doesNotMatch(section.textContent, /Showing the first/);
});

// ── metadataFields: labels and declared-key ordering ─────────────────────

test('dieList — metadataFields.label wins over the auto prettyKey label', () => {
  const dies = [die({ metadata: { part_id: 'XJ-1' } })];
  const { section } = buildWithCapture(dies, undefined, {
    metadataFields: [{ key: 'part_id', label: 'Part serial' }],
  });
  const headers = [...section.querySelectorAll('th')].map(th => th.textContent);
  assert.ok(headers.includes('Part serial'));
  assert.ok(!headers.includes('Part Id'));
});

test('dieList — keys declared in metadataFields sort before undeclared discovered keys', () => {
  const dies = [die({ metadata: { zeta: '1', part_id: '2' } })];
  const { section } = buildWithCapture(dies, undefined, {
    metadataFields: [{ key: 'part_id' }],
  });
  const headers = [...section.querySelectorAll('th')].map(th => th.textContent);
  const partIdx = headers.findIndex(h => /part/i.test(h));
  const zetaIdx = headers.findIndex(h => /zeta/i.test(h));
  assert.ok(partIdx < zetaIdx, `declared key should sort first: ${headers}`);
});

// ── extraColumn keeps working alongside the new columns (tsmap's own usage) ─

test('dieList — extraColumn (tsmap\'s wafer-label slot) coexists with metadata columns', () => {
  const dies = [die({ metadata: { part_id: 'XJ-1' } })];
  const { section, csv } = buildWithCapture(dies, undefined, {
    extraColumn: { label: 'Wafer', get: () => 'W01' },
  });
  const headers = [...section.querySelectorAll('th')].map(th => th.textContent);
  assert.equal(headers[0], 'Wafer');
  assert.ok(headers.some(h => /part/i.test(h)));
  const row = parseCsvLine(csv.split('\n')[1]);
  assert.equal(row[0], 'W01');
});

// ── resolveMetadataColumns: maxDieKeys truncation is reported, not hidden ──

test('resolveMetadataColumns — keys beyond maxDieKeys are reported in truncatedKeys, not silently dropped', () => {
  const dies = [die({ metadata: { a: 1, b: 2, c: 3 } })];
  const { columns, truncatedKeys } = resolveMetadataColumns({ dies, maxDieKeys: 2, waferPlacement: 'none' });
  assert.equal(columns.length, 2);
  assert.equal(truncatedKeys.length, 1);
});

// ── Flex sizing: BOTH axes must be constrained ─────────────────────────────
//
// Regression guard for a real, shipped bug (0.24.0/0.24.1): the section and
// its scroll container set minHeight:0 but not minWidth:0. A flex item's
// default `min-width: auto` refuses to shrink below its content's intrinsic
// minimum, and every cell here is white-space:nowrap — so a wafer with many
// long test-name columns stretched the section far past its modal, dragging
// the scroll container's own vertical scrollbar off the right-hand edge. The
// table then appeared unscrollable, with only a stray horizontal scrollbar
// visible and the Export CSV button pushed out of view.
//
// jsdom does no layout, so this asserts the CSS constraint is DECLARED rather
// than measuring the resulting geometry (same approach dom-adapter.test.mjs
// uses for its own layout-constraint checks).

test('dieList — the section and its scroll container constrain BOTH flex axes', () => {
  const dies = [die({ testValues: { 1: 0.5 } })];
  const testDefs = [{ testNumber: 1, name: 'Continuity check for TESTMODE pin' }];
  const { section } = buildWithCapture(dies, testDefs, {});

  assert.equal(section.style.minHeight, '0px', 'section must set min-height:0');
  assert.equal(section.style.minWidth, '0px', 'section must set min-width:0');

  const scrollWrap = section.querySelector('table').parentElement;
  assert.equal(scrollWrap.style.overflow, 'auto');
  assert.equal(scrollWrap.style.minHeight, '0px', 'scroll container must set min-height:0');
  assert.equal(scrollWrap.style.minWidth, '0px', 'scroll container must set min-width:0');
});
