// `results` as columns (`DieColumns`): the same records as rows must build the
// same map, die for die, with the same analysis and the same warnings. Then the
// columns' own rules: STDF missing markers, sparse test data, and the
// structural faults that throw rather than draw a wrong map.

import test from 'node:test';
import assert from 'node:assert/strict';
import { buildWaferMap } from '../dist/index.js';
import { analyzeWaferMap } from '../dist/packages/stats/index.js';
import { dieLink, testValue, recordedVerdict } from '../dist/packages/core/dieTable.js';

let seed = 23;
const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);

function rows({ R = 12 } = {}) {
  const out = [];
  for (let x = -R; x <= R; x++) for (let y = -R; y <= R; y++) {
    if (x * x + y * y > R * R) continue;
    for (let t = 0; t < (rand() < 0.1 ? 2 : 1); t++) {         // some retests
      const d = { x: x + 30, y, hbin: rand() < 0.15 ? 2 + (x & 3) : 1, sbin: rand() < 0.5 ? 10 : 11, siteNum: (x & 3) };
      if (rand() < 0.3) d.partId = rand() < 0.5 ? x * 100 + y : `p${x}_${y}_${t}`;
      if (rand() < 0.2) d.metadata = { reticle: `R${x & 1}` };
      const stop = Math.floor(rand() * 6);                       // stop-on-fail gaps
      if (stop > 0) {
        d.testValues = {};
        [1001, 1002, 1500, 70000, 2].slice(0, stop).forEach(tn => { d.testValues[tn] = rand() < 0.03 ? 0 : rand() * 2 - 1; });
      }
      if (rand() < 0.6) d.testPass = { 5001: rand() > 0.2 };
      if (rand() < 0.03) { delete d.x; delete d.y; }
      out.push(d);
    }
  }
  return out;
}

/** The same records as columns: sparse test data, STDF missing markers in the integer columns. */
function toColumns(rs, { float32 = false } = {}) {
  const n = rs.length;
  const x = new Int16Array(n), y = new Int16Array(n), hbin = new Uint16Array(n), sbin = new Uint16Array(n), site = new Uint16Array(n);
  const partId = [], metadata = [];
  const tv = {}, tp = {};
  rs.forEach((r, i) => {
    x[i] = r.x ?? -32768; y[i] = r.y ?? -32768;
    hbin[i] = r.hbin ?? 65535; sbin[i] = r.sbin ?? 65535; site[i] = r.siteNum ?? 65535;
    partId.push(r.partId); metadata.push(r.metadata);
    for (const [k, v] of Object.entries(r.testValues ?? {})) ((tv[k] ??= { indices: [], values: [] }).indices.push(i), tv[k].values.push(v));
    for (const [k, v] of Object.entries(r.testPass ?? {})) ((tp[k] ??= { indices: [], values: [] }).indices.push(i), tp[k].values.push(v));
  });
  for (const k of Object.keys(tv)) tv[k] = { indices: Int32Array.from(tv[k].indices), values: float32 ? Float32Array.from(tv[k].values) : Float64Array.from(tv[k].values) };
  for (const k of Object.keys(tp)) tp[k] = { indices: Int32Array.from(tp[k].indices), values: Uint8Array.from(tp[k].values, v => (v ? 1 : 0)) };
  return { count: n, x, y, hbin, sbin, siteNum: site, partId, metadata, testValues: tv, testPass: tp };
}

const sortKeys = (v) => Array.isArray(v) ? v.map(sortKeys)
  : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, sortKeys(v[k])])) : v;
const json = (v) => JSON.stringify(sortKeys(v));

const testDefs = [
  { testNumber: 1001, name: 'A', limitLow: -0.5, limitHigh: 0.5 },
  { testNumber: 1002, name: 'B' }, { testNumber: 1500, name: 'C' }, { testNumber: 70000, name: 'D' },
  { testNumber: 2, name: 'E' }, { testNumber: 5001, name: 'F', testType: 'F' },
];
const derivedTests = [
  { testNumber: 900001, name: 'A+B', expression: 't[1001] + t[1002]' },
  { testNumber: 900002, name: 'A ok', expression: 'specPass[1001] and testPass[5001]', testType: 'F' },
  { testNumber: 900003, name: 'nested', expression: 't[900001] * 2' },
];

test('columns build the same map as rows: dies, analysis and warnings', () => {
  for (let w = 0; w < 6; w++) {
    const rs = rows();
    const opts = [{}, { derivedTests }, { retestPolicy: 'best' }, { waferConfig: { orientation: 90 } }, { derivedTests, retestPolicy: 'worst' }, {}][w];
    const fromRows = buildWaferMap({ results: rs, testDefs, ...opts });
    const fromCols = buildWaferMap({ results: toColumns(rs, { float32: false }), testDefs, ...opts });
    assert.equal(json(fromCols.dies), json(fromRows.dies), `dies, case ${w}`);
    assert.deepEqual(fromCols.warnings, fromRows.warnings, `warnings, case ${w}`);
    assert.deepEqual(fromCols.testDefs, fromRows.testDefs);
    assert.equal(JSON.stringify(analyzeWaferMap(fromCols)), JSON.stringify(analyzeWaferMap(fromRows)), `analysis, case ${w}`);
    for (const d of fromCols.dies) if (d.testValues || d.testPass) assert.ok(dieLink(d), 'dies from columns are linked');
  }
});

test('Float32Array values are kept as 32-bit, never widened in storage', () => {
  const rs = rows({ R: 4 });
  const map = buildWaferMap({ results: toColumns(rs, { float32: true }), testDefs });
  const die = map.dies.find(d => testValue(d, 1001) !== undefined);
  assert.ok(dieLink(die).table.values.get(1001) instanceof Float32Array);
  const rec = rs.find(r => r.x === die.x && r.y === die.y && r.testValues?.[1001] !== undefined);
  assert.equal(testValue(die, 1001), Math.fround(rec.testValues[1001]));
});

test('missing markers and NaN are missing, silently; other out-of-range values are reported as for rows', () => {
  const cols = {
    count: 4,
    x: Float64Array.of(0, NaN, 1, 2), y: Float64Array.of(0, NaN, 0, 0),
    hbin: Uint16Array.of(1, 65535, 40000, 1), sbin: Float64Array.of(NaN, 3, 3, 3),
    siteNum: Uint16Array.of(65535, 1, 300, 2),
  };
  const map = buildWaferMap({ results: cols });
  const byX = new Map(map.dies.filter(d => d.x !== undefined).map(d => [d.x, d]));
  assert.equal(byX.get(0).hbin, 1);
  assert.equal(byX.get(0).sbin, undefined);
  assert.equal(byX.get(0).siteNum, undefined);
  assert.equal(byX.get(1).hbin, undefined, 'bin 40000 is outside STDF: missing');
  assert.equal(byX.get(1).siteNum, undefined, 'site 300 is outside STDF: missing');
  assert.equal(map.dies.filter(d => d.x === undefined).length, 1);
  const w = map.warnings.find(x => x.code === 'input-values-outside-stdf');
  assert.match(w.message, /1 bin \(legal/);
  assert.match(w.message, /1 site number/);
  const rowsWarn = buildWaferMap({ results: [{ x: 0, y: 0, hbin: 1 }, {}, { x: 1, y: 0, hbin: 40000, sbin: 3, siteNum: 300 }, { x: 2, y: 0, hbin: 1, sbin: 3, siteNum: 2 }] })
    .warnings.find(x => x.code === 'input-values-outside-stdf');
  assert.equal(w.message, rowsWarn.message);
});

test('non-finite values, bad test numbers and wrong-type verdicts are reported like rows', () => {
  const cols = {
    count: 2, x: [0, 1], y: [0, 0], hbin: [1, 1],
    testValues: { 7: { indices: [0, 1], values: [Infinity, 1.5] }, [-3]: { indices: [0], values: [1] } },
    testPass: { 8: { indices: [0, 1], values: [1, 'yes'] } },
  };
  const rs = [
    { x: 0, y: 0, hbin: 1, testValues: { 7: Infinity, [-3]: 1 }, testPass: { 8: true } },
    { x: 1, y: 0, hbin: 1, testValues: { 7: 1.5 }, testPass: { 8: 'yes' } },
  ];
  const a = buildWaferMap({ results: cols }), b = buildWaferMap({ results: rs });
  assert.deepEqual(a.warnings.map(w => w.code), b.warnings.map(w => w.code));
  assert.equal(a.warnings.find(w => w.code === 'input-values-outside-stdf').message,
    b.warnings.find(w => w.code === 'input-values-outside-stdf').message);
  const [d0, d1] = [a.dies.find(d => d.x === 0), a.dies.find(d => d.x === 1)];
  assert.equal(testValue(d0, 7), undefined);
  assert.equal(testValue(d1, 7), 1.5);
  assert.equal(recordedVerdict(d0, 8), true);
  assert.equal(recordedVerdict(d1, 8), undefined);
  assert.equal(testValue(d0, -3), undefined);
});

test('structural faults throw: counts, lengths, indices', () => {
  const base = { count: 3, x: [0, 1, 2], y: [0, 0, 0] };
  const bad = [
    [{ ...base, hbin: [1, 1] }, /column `hbin` has 2 entries for 3 records/],
    [{ ...base, count: 2.5 }, /`count` must be a whole number/],
    [{ ...base, testValues: { 1: { indices: [0, 1], values: [1] } } }, /same length/],
    [{ ...base, testValues: { 1: { indices: [0, 3], values: [1, 2] } } }, /not a record index in \[0, 3\)/],
    [{ ...base, testValues: { 1: { indices: [1.5], values: [1] } } }, /not a record index/],
    [{ ...base, testValues: { 1: { indices: [2, 2], values: [1, 2] } } }, /lists record 2 twice/],
    [{ ...base, testPass: { 1: { indices: [0] } } }, /same length/],
  ];
  for (const [cols, re] of bad) assert.throws(() => buildWaferMap({ results: cols }), re);
});

test('a record with no test data has no testValues / testPass on its die', () => {
  const map = buildWaferMap({ results: { count: 2, x: [0, 1], y: [0, 0], hbin: [1, 2], testValues: { 5: { indices: [1], values: [0.25] } } } });
  const [a, b] = [map.dies.find(d => d.x === 0), map.dies.find(d => d.x === 1)];
  assert.equal('testValues' in a, false);
  assert.equal('testPass' in b, false);
  assert.deepEqual(b.testValues, { 5: 0.25 });
});

test('columns with explicit dies and with unpositioned records', () => {
  const map = buildWaferMap({
    dies: [{ id: 'a', x: 0, y: 0, width: 1, height: 1 }, { id: 'b', x: 1, y: 0, width: 1, height: 1 }],
    results: { count: 2, x: [0, NaN], y: [0, NaN], hbin: [1, 1], testValues: { 7: { indices: [0, 1], values: [1.5, 2.5] } } },
  });
  assert.equal(testValue(map.dies.find(d => d.id === 'a'), 7), 1.5);
  assert.equal(testValue(map.dies.find(d => d.id.startsWith('unpositioned')), 7), 2.5);
});
