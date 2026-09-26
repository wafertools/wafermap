// The die table (core/dieTable.ts). A die buildWaferMap returns holds no value
// objects: it is linked to a row of its map's table, wmap reads it through the
// table's accessors, and `die.testValues` / `die.testPass` are read-only getters
// returning frozen snapshots. Every reading, whichever way it is made, must
// equal the die's input record. Random lots cover unpositioned dies,
// stop-on-fail gaps, functional tests, lot stacks and explicit dies.

import test from 'node:test';
import assert from 'node:assert/strict';
import { buildWaferMap } from '../dist/index.js';
import {
  testValue, recordedVerdict, dieHasAnyTestData, dieHasValues, dieHasVerdicts, dieValueEntries,
  dieVerdictEntries, testsPresent, dieLink, copyDie, tableFromRows,
} from '../dist/packages/core/dieTable.js';

let seed = 11;
const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);

/** One record per position (no retests, so each die's record is known), some unpositioned. */
function lot({ R = 10, tests = [1001, 1002, 1500, 70000], fTest = 5001 } = {}) {
  const results = [];
  for (let x = -R; x <= R; x++) for (let y = -R; y <= R; y++) {
    if (x * x + y * y > R * R) continue;
    const d = { x, y, hbin: rand() < 0.1 ? 3 : 1 };
    const stop = Math.floor(rand() * (tests.length + 2));  // stop-on-fail: later tests missing
    if (stop > 0) {
      d.testValues = {};
      tests.slice(0, stop).forEach(tn => { d.testValues[tn] = rand() < 0.02 ? 0 : rand() * 2 - 1; });
    }
    if (rand() < 0.7) d.testPass = { [fTest]: rand() > 0.2 };
    if (rand() < 0.03) { delete d.x; delete d.y; }
    results.push(d);
  }
  return {
    results,
    testDefs: [...tests.map(tn => ({ testNumber: tn, name: `T${tn}` })), { testNumber: fTest, name: 'F', testType: 'F' }],
  };
}

/** Each built die's input record: by position, and unpositioned ones in input order. */
function recordsOf(input, map) {
  const byPos = new Map(input.results.filter(r => r.x !== undefined).map(r => [`${r.x},${r.y}`, r]));
  const unpositioned = input.results.filter(r => r.x === undefined);
  return new Map(map.dies.map(d => [d, d.x !== undefined ? byPos.get(`${d.x},${d.y}`) : unpositioned[Number(d.id.split('_')[1])]]));
}

const ALL_TESTS = [1001, 1002, 1500, 70000, 5001, 9999];
const entries = (o) => Object.entries(o ?? {}).map(([k, v]) => [Number(k), v]);

function assertMatchesRecord(die, rec) {
  for (const tn of ALL_TESTS) {
    assert.equal(testValue(die, tn), rec.testValues?.[tn], `value ${tn} of ${die.id}`);
    assert.equal(recordedVerdict(die, tn), rec.testPass?.[tn], `verdict ${tn} of ${die.id}`);
  }
  assert.deepEqual(dieValueEntries(die), entries(rec.testValues));
  assert.deepEqual(dieVerdictEntries(die), entries(rec.testPass));
  assert.equal(dieHasValues(die), entries(rec.testValues).length > 0);
  assert.equal(dieHasVerdicts(die), entries(rec.testPass).length > 0);
  assert.equal(dieHasAnyTestData(die), dieHasValues(die) || dieHasVerdicts(die));
}

test('built dies are linked, hold no value objects, and read as their records', () => {
  for (let w = 0; w < 4; w++) {
    const input = lot();
    const map = buildWaferMap(input);
    const recs = recordsOf(input, map);
    for (const die of map.dies) {
      assert.ok(dieLink(die), `die ${die.id} has no table link`);
      assertMatchesRecord(die, recs.get(die));
    }
  }
});

test('the getters give fresh frozen snapshots equal to the record, keep nothing, and do not change how wmap reads', () => {
  const input = lot();
  const map = buildWaferMap(input);
  const recs = recordsOf(input, map);
  for (const die of map.dies) {
    const rec = recs.get(die);
    assert.deepEqual(die.testValues, rec.testValues);
    assert.deepEqual(die.testPass, rec.testPass);
    assert.equal('testValues' in die, rec.testValues !== undefined, 'a die exposes only the fields its record carried');
    assert.equal('testPass' in die, rec.testPass !== undefined);
    if (die.testValues) {
      assert.ok(Object.isFrozen(die.testValues));
      assert.notEqual(die.testValues, die.testValues, 'a fresh snapshot per read');
    }
    assert.ok(dieLink(die), 'reading the getter keeps the link');
    assert.equal(Object.getOwnPropertySymbols(die).length, 2, 'nothing is kept on the die but its link');
    assertMatchesRecord(die, rec);
  }
});

test('spread, structured clone and JSON give plain objects with the same values', () => {
  const input = lot();
  const map = buildWaferMap(input);
  const recs = recordsOf(input, map);
  for (const die of map.dies) {
    const rec = recs.get(die);
    for (const copy of [{ ...die }, structuredClone(die), JSON.parse(JSON.stringify(die))]) {
      assert.equal(dieLink(copy), undefined, 'a copy never carries the link');
      assertMatchesRecord(copy, rec);
    }
  }
});

test('assigning to a built die\'s values throws; a copy can replace them', () => {
  const [die] = buildWaferMap({ results: [{ x: 0, y: 0, hbin: 1, testValues: { 1: 5 }, testPass: { 2: true } }] }).dies;
  assert.throws(() => { die.testValues = { 1: 6 }; }, /read-only on a die built by buildWaferMap.*copy the die/);
  assert.throws(() => { die.testPass = {}; }, /read-only/);
  assert.throws(() => { die.testValues[1] = 6; }, TypeError);
  const mine = { ...die, testValues: { 1: 6 } };
  assert.equal(testValue(mine, 1), 6);
  assert.equal(recordedVerdict(mine, 2), true);
  assert.equal(testValue(die, 1), 5);
});

test('copyDie keeps the link without building snapshots; a patch of values gives own objects', () => {
  const input = lot();
  const map = buildWaferMap(input);
  const recs = recordsOf(input, map);
  for (const die of map.dies.slice(0, 50)) {
    const copy = copyDie(die, { probeIndex: 3 });
    assert.ok(dieLink(copy));
    assert.equal(copy.probeIndex, 3);
    assertMatchesRecord(copy, recs.get(die));
    const replaced = copyDie(die, { testValues: { 1: 9 } });
    assert.equal(dieLink(replaced), undefined);
    assert.equal(testValue(replaced, 1), 9);
    assert.deepEqual(replaced.testPass, recs.get(die).testPass);
  }
});

test('subsets and shuffles keep reading the right rows', () => {
  const input = lot();
  const map = buildWaferMap(input);
  const recs = recordsOf(input, map);
  const subset = [...map.dies].sort(() => rand() - 0.5).filter(() => rand() < 0.3);
  for (const die of subset) assertMatchesRecord(die, recs.get(die));
  const expected = new Set();
  for (const d of subset) for (const [tn] of [...entries(recs.get(d).testValues), ...entries(recs.get(d).testPass)]) expected.add(tn);
  assert.deepEqual(testsPresent(subset), [...expected].sort((a, b) => a - b));
});

test('a retested position reads its winning record', () => {
  const results = [
    { x: 0, y: 0, hbin: 2, testValues: { 1: 10 }, testPass: { 2: false } },
    { x: 0, y: 0, hbin: 1, testValues: { 1: 20 } },
    { x: 1, y: 0, hbin: 1, testValues: { 1: 30 } },
  ];
  for (const [policy, want] of [['last', 20], ['first', 10], ['best', 20], ['worst', 10]]) {
    const die = buildWaferMap({ results, retestPolicy: policy }).dies.find(d => d.x === 0 && d.y === 0);
    assert.equal(testValue(die, 1), want, policy);
    assert.equal(recordedVerdict(die, 2), policy === 'first' || policy === 'worst' ? false : undefined, policy);
    assert.equal(die.testValues[1], want, policy);
  }
});

test('lot stacks and explicit dies read correctly', () => {
  const r = (o) => [{ x: 0, y: 0, hbin: 1, testValues: { 1: o } }, { x: 1, y: 0, hbin: 2, testValues: { 1: o + 1 } }];
  const stacked = buildWaferMap({ lotStack: { results: [r(1), r(3)], method: 'mean' }, testDefs: [{ testNumber: 1, name: 'a' }] });
  assert.deepEqual(stacked.dies.map(d => testValue(d, 1)), [2, 3]);
  assert.deepEqual(stacked.dies.map(d => d.testValues), [{ 1: 2 }, { 1: 3 }]);

  const explicit = buildWaferMap({
    dies: [
      { id: 'a', x: 0, y: 0, width: 1, height: 1 },
      { id: 'b', x: 1, y: 0, width: 1, height: 1 },
      // A layout die with its own verdicts, and a record with values only: keeps both.
      { id: 'c', x: 2, y: 0, width: 1, height: 1, testPass: { 9: true } },
    ],
    results: [{ x: 0, y: 0, hbin: 1, testValues: { 7: 1.5 } }, { x: 2, y: 0, hbin: 1, testValues: { 7: 3.5 } }, { hbin: 1, testValues: { 7: 2.5 } }],
  });
  const byId = new Map(explicit.dies.map(d => [d.id, d]));
  assert.equal(testValue(byId.get('a'), 7), 1.5);
  assert.equal(dieHasAnyTestData(byId.get('b')), false);
  assert.equal(testValue(byId.get('c'), 7), 3.5);
  assert.equal(recordedVerdict(byId.get('c'), 9), true);
  assert.equal(testValue(explicit.dies.find(d => d.id.startsWith('unpositioned')), 7), 2.5);
});

test('unlinked dies read their own objects; bare dies have no test data', () => {
  const own = { id: 'h', x: 0, y: 0, width: 1, height: 1, testValues: { 3: 1 }, testPass: { 4: false } };
  assert.equal(testValue(own, 3), 1);
  assert.equal(recordedVerdict(own, 4), false);
  assert.deepEqual(testsPresent([own]), [3, 4]);
  const bare = { id: 'x', x: 0, y: 0, width: 1, height: 1 };
  assert.equal(testValue(bare, 1), undefined);
  assert.equal(dieHasAnyTestData(bare), false);
  assert.deepEqual(testsPresent([bare]), []);
});

test('tableFromRows: NaN / no verdict for gaps, test numbers ascending, fields per row', () => {
  const t = tableFromRows([{ testValues: { 9: 1, 2: 3 } }, { testPass: { 4: true } }, {}]);
  assert.equal(t.rows, 3);
  assert.deepEqual([...t.values.keys()], [2, 9]);
  assert.deepEqual([...t.values.get(9)], [1, NaN, NaN]);
  assert.deepEqual([...t.verdicts.get(4)], [-1, 1, -1]);
  assert.deepEqual([...t.fields], [1, 2, 0]);
});
