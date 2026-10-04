// The one CSV writer (core/tableCsv.ts) and the exports built on it. The point of
// the module is how a number reaches a file: plain and at full precision, never
// the screen's four-figure formatting — the earlier exports rounded
// `452.123456789` to `452.1`, which is lossy for anything that reads the file.

import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>');
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.HTMLDivElement = dom.window.HTMLDivElement;
globalThis.Node = dom.window.Node;

const { fileNumber, csvCell, csvLine, tableToCsv } = await import('../dist/packages/core/tableCsv.js');
const { buildTestSection } = await import('../dist/packages/canvas-adapter/summaryPanel.js');
const { buildDieListSection } = await import('../dist/packages/canvas-adapter/dieList.js');

test('fileNumber keeps every real digit and drops float noise', () => {
  assert.equal(fileNumber(452.123456789), '452.123456789');
  assert.equal(fileNumber(1234.5678), '1234.5678');
  assert.equal(fileNumber(0.1 + 0.2), '0.3');
  assert.equal(fileNumber(0.001151199649817308), '0.00115119964981731');
  assert.equal(fileNumber(1.5e-7), '1.5e-7');
  assert.equal(fileNumber(-0), '0');
  assert.equal(fileNumber(42), '42');
});

test('a single-precision reading is written in its shortest single-precision form', () => {
  // STDF R*4 values are kept as f32 and read back as the double they widen to;
  // the 17-digit expansion of that double claims precision the tester never had.
  const f = Math.fround;
  assert.equal(fileNumber(f(0.512345678)), '0.5123457');
  assert.equal(fileNumber(f(0.1)), '0.1');
  assert.equal(fileNumber(f(452.123456789)), '452.12344');
  assert.equal(fileNumber(f(1e-7)), '1e-7');
  assert.equal(fileNumber(f(1 / 3)), '0.33333334');
  for (const v of [f(0.512345678), f(452.123456789), f(1e-7), f(-3.14159), f(123456.789), f(7.7e11)]) {
    assert.equal(f(Number(fileNumber(v))), v, `${v} must read back as the same f32`);
  }
});

test('every single-precision reading reads back exactly, across the whole range of magnitudes', () => {
  let seed = 7;
  const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  let checked = 0;
  for (let i = 0; i < 100000; i++) {
    const v = Math.fround((rand() - 0.5) * 2 * 10 ** (Math.floor(rand() * 40) - 20));
    if (!Number.isFinite(v)) continue;
    const text = fileNumber(v);
    checked++;
    assert.equal(Math.fround(Number(text)), v, `${v} -> ${text}`);
    if (Number.isInteger(v)) continue;   // a whole number is written exactly, however many digits that takes
    // Never more digits than a single-precision value can need.
    const digits = text.replace(/e.*$/, '').replace(/[-.]/g, '').replace(/^0+/, '').replace(/0+$/, '');
    assert.ok(digits.length <= 9, `${v} -> ${text}`);
  }
  assert.ok(checked > 90000);
});

test('a whole number is written as is, including a large one', () => {
  assert.equal(fileNumber(1000), '1000');
  assert.equal(fileNumber(-7), '-7');
  assert.equal(fileNumber(123456789012), '123456789012');
});

test('fileNumber is empty for a value that is not a number', () => {
  assert.equal(fileNumber(NaN), '');
  assert.equal(fileNumber(Infinity), '');
  assert.equal(fileNumber(-Infinity), '');
});

test('a written number parses back to the value it came from, to 15 digits', () => {
  for (const v of [452.123456789, 1.23456789012345e-9, -7.5e12, 0.1 + 0.2, 1 / 3]) {
    assert.ok(Math.abs(Number(fileNumber(v)) - v) <= Math.abs(v) * 1e-14, `${v} -> ${fileNumber(v)}`);
  }
});

test('csvCell: numbers plain, strings escaped, missing values empty', () => {
  assert.equal(csvCell(3.5), '3.5');
  assert.equal(csvCell('a,b'), '"a,b"');
  assert.equal(csvCell('say "hi"'), '"say ""hi"""');
  assert.equal(csvCell(null), '');
  assert.equal(csvCell(undefined), '');
  assert.equal(csvCell(NaN), '');
});

test('csvCell: a string that a spreadsheet would run as a formula is neutralised, a negative number is not', () => {
  assert.equal(csvCell('=SUM(A1)'), "'=SUM(A1)");
  assert.equal(csvCell(-1.25), '-1.25');
  assert.equal(csvCell('-1.25'), '-1.25');
});

test('tableToCsv: header, one line per row, no trailing newline', () => {
  const csv = tableToCsv(
    [{ header: 'Name', get: r => r.name }, { header: 'Value', get: r => r.v }],
    [{ name: 'a', v: 1.5 }, { name: 'b,c', v: undefined }],
  );
  assert.equal(csv, 'Name,Value\na,1.5\n"b,c",');
});

test('tableToCsv accepts any iterable of rows', () => {
  function* rows() { yield 1; yield 2; }
  assert.equal(tableToCsv([{ header: 'n', get: r => r }], rows()), 'n\n1\n2');
  assert.equal(csvLine(['x', 2, null]), 'x,2,');
});

const TEST = { testNumber: 1, name: 'vth', unit: 'V' };
const dies = [
  { x: 0, y: 0, hbin: 1, testValues: { 1: 0.000123456789 } },
  { x: 1, y: 0, hbin: 1, testValues: { 1: 452.123456789 } },
];

test('the test-values export writes statistics at full precision', () => {
  const same = [
    { x: 0, y: 0, hbin: 1, testValues: { 1: 452.123456789 } },
    { x: 1, y: 0, hbin: 1, testValues: { 1: 452.123456789 } },
  ];
  const saved = {};
  const section = buildTestSection(same, [TEST], undefined, undefined, (t) => { saved.text = t; });
  [...section.querySelectorAll('button')].find(b => /CSV$/.test(b.textContent)).click();
  const [header, row] = saved.text.split('\n');
  const cols = header.split(',');
  const cells = row.split(',');
  assert.equal(cells[cols.indexOf('Min')], '452.123456789');
  assert.equal(cells[cols.indexOf('Max')], '452.123456789');
  assert.equal(cells[cols.indexOf('Mean')], '452.123456789');
  assert.equal(cells[cols.indexOf('N')], '2');
  assert.equal(cells[cols.indexOf('Unit')], 'V');
});

test('the die list export writes each value as the stored number', () => {
  const saved = {};
  const section = buildDieListSection(dies, [TEST], { onSaveText: (t) => { saved.text = t; } });
  [...section.querySelectorAll('button')].find(b => b.textContent === 'Export CSV').click();
  const lines = saved.text.split('\n');
  const col = lines[0].split(',').findIndex(h => h.startsWith('vth'));
  assert.equal(lines[1].split(',')[col], '0.000123456789');
  assert.equal(lines[2].split(',')[col], '452.123456789');
});
