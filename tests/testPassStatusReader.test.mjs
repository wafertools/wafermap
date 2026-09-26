// `testPassStatusReader` reads `getTestPassStatus`'s verdicts for many tests of a
// die at once. It must give the same answer for every die and test: the recorded
// verdict first, and for a functional test with none, the legacy 0/1 value — never
// for a parametric test, and never for any other value.
import test from 'node:test';
import assert from 'node:assert/strict';

const { buildWaferMap, getTestPassStatus, testPassStatusReader } = await import('../dist/packages/renderer/buildWaferMap.js');

const DEFS = [
  { testNumber: 10, name: 'P with verdicts', testType: 'P', limitLow: 0, limitHigh: 1 },
  { testNumber: 11, name: 'P, values only', testType: 'P' },
  { testNumber: 20, name: 'F with verdicts', testType: 'F' },
  { testNumber: 21, name: 'F, legacy values', testType: 'F' },
  { testNumber: 30, name: 'absent everywhere', testType: 'F' },
];

function rows(seed) {
  let s = seed;
  const rnd = () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
  const pick = (xs) => xs[Math.floor(rnd() * xs.length)];
  return Array.from({ length: 150 }, (_, i) => {
    const testValues = {}, testPass = {};
    if (rnd() < 0.8) testValues[10] = pick([0, 1, 0.5, 2, -1]);
    if (rnd() < 0.8) testPass[10] = rnd() < 0.7;
    if (rnd() < 0.8) testValues[11] = pick([0, 1, 0.25]);   // 0/1 on a P test is a measurement
    if (rnd() < 0.6) testPass[20] = rnd() < 0.5;
    if (rnd() < 0.6) testValues[20] = pick([0, 1]);          // recorded verdict must win over this
    if (rnd() < 0.8) testValues[21] = pick([0, 1, 0.5, 2]);  // only 0 and 1 are verdicts
    return { x: i % 15, y: Math.floor(i / 15), hbin: 1, testValues, ...(Object.keys(testPass).length ? { testPass } : {}) };
  });
}

function assertSame(dies, label) {
  const read = testPassStatusReader(DEFS);
  const out = new Int8Array(DEFS.length);
  let verdicts = 0;
  for (const die of dies) {
    read(die, out);
    DEFS.forEach((def, k) => {
      const want = getTestPassStatus(die, def.testNumber, def);
      const got = out[k] === -1 ? undefined : out[k] === 1;
      if (want !== undefined) verdicts++;
      assert.equal(got, want, `${label}: die ${die.x},${die.y} test ${def.testNumber}`);
    });
  }
  assert.ok(verdicts > 100, `${label}: the comparison must cover real verdicts (${verdicts})`);
}

test('the reader agrees with getTestPassStatus on built (column-backed) dies', () => {
  for (const seed of [1, 2, 3]) {
    const map = buildWaferMap({ results: rows(seed), testDefs: DEFS, waferConfig: { diameter: 300 }, dieConfig: { width: 10, height: 10 } });
    assertSame(map.dies, `built, seed ${seed}`);
  }
});

test('the reader agrees with getTestPassStatus on plain die objects', () => {
  for (const seed of [4, 5]) assertSame(rows(seed), `plain, seed ${seed}`);
});
