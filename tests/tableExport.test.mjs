// exportCsv (canvas-adapter/tableExport.ts): a small table is saved as a string
// before the call returns; a large one is built in slices and handed to the host
// as a Blob, with the same bytes. The die list shows progress on its button.

import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>');
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.HTMLDivElement = dom.window.HTMLDivElement;
globalThis.Node = dom.window.Node;

const { exportCsv, LARGE_EXPORT_CELLS } = await import('../dist/packages/canvas-adapter/tableExport.js');
const { tableToCsv } = await import('../dist/packages/core/tableCsv.js');
const { buildDieListSection } = await import('../dist/packages/canvas-adapter/dieList.js');

const columns = [
  { header: 'Name', get: r => r.name },
  { header: 'Value', get: r => r.v },
];
const rows = Array.from({ length: 500 }, (_, i) => ({ name: i % 7 === 0 ? `a,${i}` : `n${i}`, v: Math.fround(i / 3) }));

test('a small table is saved as a string before exportCsv returns', () => {
  let got;
  const result = exportCsv(columns, rows, 'x.csv', (content, name, mime) => { got = { content, name, mime }; });
  assert.equal(result, undefined);
  assert.equal(typeof got.content, 'string');
  assert.equal(got.content, tableToCsv(columns, rows));
  assert.deepEqual([got.name, got.mime], ['x.csv', 'text/csv']);
});

test('a large table reaches the host as a Blob with the same bytes and no trailing newline', async () => {
  let got;
  const progress = [];
  const result = exportCsv(columns, rows, 'big.csv', (content, name) => { got = { content, name }; },
    { largeCells: 10, onProgress: (n, total) => progress.push([n, total]) });
  assert.ok(result instanceof Promise);
  await result;
  assert.ok(got.content instanceof Blob);
  const text = await got.content.text();
  assert.equal(text, tableToCsv(columns, rows));
  assert.ok(!text.endsWith('\n'));
  assert.equal(got.content.type, 'text/csv');
  assert.deepEqual(progress.at(-1), [rows.length, rows.length]);
});

test('rows that are not an array are written as a large table, with their count unknown', async () => {
  function* gen() { yield* rows; }
  let got;
  await exportCsv(columns, gen(), 'g.csv', (content) => { got = content; });
  assert.ok(got instanceof Blob);
  assert.equal(await got.text(), tableToCsv(columns, rows));
});

test('text spread over several Blob parts is joined without a gap or a doubled newline', async () => {
  // More than the 1 MiB part size, so the writer flushes more than once.
  const many = Array.from({ length: 60000 }, (_, i) => ({ name: 'row-' + 'x'.repeat(20) + i, v: i }));
  let got;
  await exportCsv(columns, many, 'm.csv', (content) => { got = content; }, { largeCells: 1 });
  const text = await got.text();
  assert.ok(text.length > (1 << 20) * 1.2);
  assert.equal(text, tableToCsv(columns, many));
});

test('the default threshold is a million cells', () => {
  assert.equal(LARGE_EXPORT_CELLS, 1_000_000);
});

test('the die list shows progress on its button during a large export, and restores it', async () => {
  const TESTS = 40;
  const defs = Array.from({ length: TESTS }, (_, t) => ({ testNumber: 1001 + t, name: `T${t}` }));
  const dies = Array.from({ length: 30000 }, (_, i) => {
    const testValues = {};
    for (let t = 0; t < TESTS; t++) testValues[1001 + t] = Math.fround(0.5 + ((i * 31 + t * 7) % 1000) / 10000);
    return { x: i % 200, y: (i / 200) | 0, hbin: 1, testValues };
  });
  let got;
  const section = buildDieListSection(dies, defs, { maxRows: 10, onSaveText: (c) => { got = c; } });
  const btn = [...section.querySelectorAll('button')].find(b => b.textContent === 'Export CSV');
  btn.click();
  assert.equal(btn.disabled, true, 'a second click is refused while it runs');
  assert.equal(btn.getAttribute('aria-busy'), 'true');
  await new Promise(resolve => {
    const poll = () => (got ? resolve() : setTimeout(poll, 20));
    poll();
  });
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.ok(got instanceof Blob);
  assert.equal(btn.disabled, false);
  assert.equal(btn.textContent, 'Export CSV');
  const lines = (await got.text()).split('\n');
  assert.equal(lines.length, dies.length + 1);
});
