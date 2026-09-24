// Bins and test values of the wrong type. A CSV parser gives every field as
// text; string x/y throw, but string bins and test values used to build a map
// that looked fine and was wrong — a bin of "1" is not pass bin 1, so yield
// read 0 %. buildWaferMap now reports them as 'input-values-not-numbers'.

import test from 'node:test';
import assert from 'node:assert/strict';

const { buildWaferMap } = await import('../dist/index.js');
const quiet = (f) => { const w = console.warn; console.warn = () => {}; try { return f(); } finally { console.warn = w; } };
const codeOf = (r) => r.warnings.map(w => w.code);

test('string bins are reported, with counts and an example', () => {
  const r = quiet(() => buildWaferMap({ results: [{ x: 0, y: 0, hbin: '1', sbin: '10' }, { x: 1, y: 0, hbin: '2', sbin: 20 }] }));
  const w = r.warnings.find(w => w.code === 'input-values-not-numbers');
  assert.ok(w, JSON.stringify(codeOf(r)));
  assert.equal(w.severity, 'error');
  assert.match(w.message, /2 hard bins, 1 soft bin/);
  assert.match(w.message, /hbin "1"/);
});

test('string test values and non-boolean verdicts are reported', () => {
  const r = quiet(() => buildWaferMap({ results: [
    { x: 0, y: 0, hbin: 1, testValues: { 10: '0.5' }, testPass: { 20: 'true' } },
    { x: 1, y: 0, hbin: 1, testValues: { 10: 0.7 },   testPass: { 20: false } },
  ] }));
  assert.match(r.warnings.find(w => w.code === 'input-values-not-numbers').message, /1 test value, 1 pass\/fail verdict/);
});

test('a column that turns to text part-way through a large file is still reported', () => {
  const results = [];
  for (let x = 0; x < 40; x++) for (let y = 0; y < 40; y++) {
    results.push({ x, y, hbin: 1, testValues: { 10: x > 30 ? String(x) : x } });
  }
  const r = quiet(() => buildWaferMap({ results }));
  assert.ok(codeOf(r).includes('input-values-not-numbers'));
});

test('clean numeric input raises nothing, and missing values are not type errors', () => {
  const r = buildWaferMap({ results: [
    { x: 0, y: 0, hbin: 1, sbin: 10, testValues: { 10: 0.5 }, testPass: { 20: true } },
    { x: 1, y: 0 },
    { x: 0, y: 1, hbin: 2, testValues: { 10: undefined } },
  ] });
  assert.ok(!codeOf(r).includes('input-values-not-numbers'), JSON.stringify(codeOf(r)));
});

test('lot-stack inputs are checked too', () => {
  const r = quiet(() => buildWaferMap({ lotStack: { method: 'countBin', targetBin: 2, results: [
    [{ x: 0, y: 0, hbin: 1 }, { x: 1, y: 0, hbin: 2 }],
    [{ x: 0, y: 0, hbin: '2' }, { x: 1, y: 0, hbin: 1 }],
  ] } }));
  assert.ok(codeOf(r).includes('input-values-not-numbers'));
});

// ── STDF V4 ranges: reported, values used as given (for now) ────────────────

test('values outside the STDF V4 ranges are reported, and used as given', () => {
  const r = quiet(() => buildWaferMap({
    results: [
      { x: 0, y: 0, hbin: 40000, sbin: -1, siteNum: 300, testValues: { 10: Infinity } },
      { x: 1.5, y: 0, hbin: 2.5, testValues: { 10: 1 } },
      { x: 0, y: 1, hbin: 1, testValues: { '-5': 1 } },
    ],
    waferConfig: { orientation: 45 },
  }));
  const w = r.warnings.find(w => w.code === 'input-values-outside-stdf');
  assert.ok(w, JSON.stringify(codeOf(r)));
  assert.equal(w.severity, 'warning');
  assert.match(w.message, /3 bins \(legal: whole numbers 0–32767\)/);
  assert.match(w.message, /1 coordinate /);
  assert.match(w.message, /1 test number /);
  assert.match(w.message, /1 test value that is not finite/);
  assert.match(w.message, /1 site number/);
  assert.match(w.message, /orientation other than 0, 90, 180 or 270/);
  assert.equal(r.dies.find(d => d.x === 0 && d.y === 0).hbin, 40000, 'used as given');
});

test('a NaN bin is no bin: not a fail, and reported', () => {
  const r = quiet(() => buildWaferMap({ results: [
    { x: 0, y: 0, hbin: NaN }, { x: 1, y: 0, hbin: 1 },
  ] }));
  assert.equal(r.dies.find(d => d.x === 0).hbin, undefined);
  assert.equal(r.yield.failDies, 0, 'a missing bin is not a fail');
  assert.match(r.warnings.find(w => w.code === 'input-values-outside-stdf').message, /1 bin was NaN/);
});

test('in-range input raises no STDF range warning', () => {
  const r = buildWaferMap({ results: [
    { x: -32767, y: 32767, hbin: 0, sbin: 32767, siteNum: 255, testValues: { 4294967295: 0 } },
  ], waferConfig: { orientation: -90 } });
  assert.ok(!codeOf(r).includes('input-values-outside-stdf'), JSON.stringify(r.warnings));
});
