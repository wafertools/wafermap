// One lot, up to three identical O(dies x tests) walks.
//
// The lot summary panel's Test Values table, the Insights Overview's copy of
// that same table, and the Insights capability chart all pool the same dies and
// derive the same per-test figures from them. At 50 wafers x 4,000 dies x 100
// tests that pass is ~17 s, so opening Insights after the panel had settled paid
// it again, and the capability chart a third time.
//
// `pooledTestStatsSteps` now memoises its result. The whole correctness argument
// rests on one claim — that the identity of the `Die[]` arrays plus the VALUES of
// the `TestDef`s determine the answer — so this file is mostly about the cases
// where that claim could fail: a changed limit, a different population, a subset,
// a shared array someone mutates. The speed is the easy part.
import test from 'node:test';
import assert from 'node:assert/strict';

const {
  pooledTestStatsSteps, buildCapabilityData, clearPooledTestStatsCache,
} = await import('../dist/packages/stats/capability.js');
const { drain } = await import('../dist/packages/core/utils.js');

const defs = () => [
  { testNumber: 1050, name: 'Idsat', unit: 'A', limitLow: -2, limitHigh: 2 },
  { testNumber: 1060, name: 'Vth', unit: 'V', limitLow: 0, limitHigh: 10 },
  { testNumber: 1070, name: 'Leak', unit: 'A' }, // no limits — no spec tally
];

/** Deterministic, so a failure is reproducible. */
function makeWafer(diesPerWafer = 60, seedStart = 7) {
  let seed = seedStart;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const dies = [];
  for (let i = 0; i < diesPerWafer; i++) {
    dies.push({
      x: i % 8, y: (i / 8) | 0, hbin: 1, sbin: 1,
      testValues: { 1050: (rnd() - 0.5) * 6, 1060: rnd() * 12, 1070: rnd() },
    });
  }
  return dies;
}

const pooled = (items, testDefs) => drain(pooledTestStatsSteps(items, testDefs));

/** The spec tally computed the long way, straight off the dies. */
function naiveSpecTally(items, def) {
  let n = 0, fail = 0;
  for (const item of items) {
    for (const die of item.dies ?? []) {
      if (die.partial || die.edgeExcluded) continue;
      const v = die.testValues?.[def.testNumber];
      if (v === undefined || !Number.isFinite(v)) continue;
      n++;
      if ((def.limitLow !== undefined && v < def.limitLow)
        || (def.limitHigh !== undefined && v > def.limitHigh)) fail++;
    }
  }
  return { n, fail };
}

test('specTally matches a naive per-die count, test by test', () => {
  clearPooledTestStatsCache();
  const items = [{ dies: makeWafer() }, { dies: makeWafer(60, 99) }];
  const testDefs = defs();
  const out = pooled(items, testDefs);

  for (const def of testDefs) {
    if (def.limitLow === undefined && def.limitHigh === undefined) {
      assert.equal(out.specTally.has(def.testNumber), false,
        `test ${def.testNumber} has no limits and must get no tally`);
      continue;
    }
    assert.deepEqual(out.specTally.get(def.testNumber), naiveSpecTally(items, def),
      `spec tally for test ${def.testNumber}`);
  }
  // A tally that counted nothing would pass the comparison above vacuously.
  assert.ok(out.specTally.get(1050).fail > 0, 'the fixture must actually fail some limits');
});

test('a value exactly ON a limit is in spec — the tally is strict < / >, like the per-die rule', () => {
  clearPooledTestStatsCache();
  // Values placed either side of, and exactly on, both limits.
  const dies = [-3, -2, -1, 0, 1, 2, 3].map((v, i) => ({ x: i, y: 0, testValues: { 1050: v } }));
  const testDefs = [{ testNumber: 1050, name: 'Idsat', limitLow: -2, limitHigh: 2 }];
  const out = pooled([{ dies }], testDefs);
  assert.deepEqual(out.specTally.get(1050), { n: 7, fail: 2 }, 'only -3 and 3 are out of spec');
});

test('a second call over the same dies arrays returns the identical memoised result', () => {
  clearPooledTestStatsCache();
  const items = [{ dies: makeWafer() }];
  const first = pooled(items, defs());
  // A fresh `items` wrapper over the SAME dies array, and a fresh `testDefs`
  // array of equal defs — which is exactly how the panel, the Insights Overview
  // and the capability chart each arrive.
  const second = pooled([{ dies: items[0].dies }], defs());
  assert.equal(second, first, 'same population must hit the memo, not recompute');
});

test('a memo hit costs no steps — the die pass does not run again', () => {
  clearPooledTestStatsCache();
  const items = [{ dies: makeWafer(400) }];
  const testDefs = defs();

  const countSteps = () => {
    const it = pooledTestStatsSteps(items, testDefs);
    let steps = 0;
    for (;;) { const s = it.next(); if (s.done) return steps; steps++; }
  };

  const cold = countSteps();
  assert.ok(cold > 0, 'a cold pass must step at least once');
  assert.equal(countSteps(), 0, 'a warm pass must yield no steps at all');
});

test('a different population misses, and gets its own numbers', () => {
  clearPooledTestStatsCache();
  const testDefs = defs();
  const a = [{ dies: makeWafer(60, 7) }];
  const b = [{ dies: makeWafer(60, 99) }];
  const outA = pooled(a, testDefs);
  const outB = pooled(b, testDefs);
  assert.notEqual(outA, outB);
  assert.notEqual(outA.stats.get(1050).mean, outB.stats.get(1050).mean);
  // And the first is still intact — the second did not overwrite it.
  assert.equal(pooled(a, testDefs), outA);
});

test('a subset of the wafers is a different population, not a hit on the whole lot', () => {
  clearPooledTestStatsCache();
  const testDefs = defs();
  const w0 = makeWafer(60, 7), w1 = makeWafer(60, 99);
  const whole = pooled([{ dies: w0 }, { dies: w1 }], testDefs);
  const facet = pooled([{ dies: w0 }], testDefs);
  assert.notEqual(facet, whole, 'an Insights group scope must not read the whole lot');
  assert.equal(facet.stats.get(1050).count, 60);
  assert.equal(whole.stats.get(1050).count, 120);
});

test('a changed spec limit misses, and the tally follows the new limit', () => {
  clearPooledTestStatsCache();
  const dies = [-3, -1, 1, 3].map((v, i) => ({ x: i, y: 0, testValues: { 1050: v } }));
  const items = [{ dies }];
  const wide = pooled(items, [{ testNumber: 1050, name: 'Idsat', limitLow: -4, limitHigh: 4 }]);
  assert.deepEqual(wide.specTally.get(1050), { n: 4, fail: 0 });
  const narrow = pooled(items, [{ testNumber: 1050, name: 'Idsat', limitLow: -2, limitHigh: 2 }]);
  assert.deepEqual(narrow.specTally.get(1050), { n: 4, fail: 2 },
    'the tighter limit must not read the wide limit\'s cached tally');
});

test('a renamed test misses — the label travels in the capability rows', () => {
  clearPooledTestStatsCache();
  const items = [{ dies: makeWafer() }];
  const before = pooled(items, [{ testNumber: 1050, name: 'Idsat', limitLow: -2, limitHigh: 2 }]);
  const after = pooled(items, [{ testNumber: 1050, name: 'Idsat (retuned)', limitLow: -2, limitHigh: 2 }]);
  assert.notEqual(after, before);
  assert.equal(after.capability[0].label, 'Idsat (retuned)');
});

test('buildCapabilityData hands each caller its own array to sort or splice', () => {
  clearPooledTestStatsCache();
  const items = [{ dies: makeWafer() }];
  const testDefs = defs();
  const first = buildCapabilityData(items, testDefs);
  first.length = 0; // a caller filtering in place must not empty the cache
  const second = buildCapabilityData(items, testDefs);
  assert.ok(second.length > 0, 'the memoised rows survive a caller mutating its copy');
});

test('the cache is bounded — a fifth population evicts, without changing any answer', () => {
  clearPooledTestStatsCache();
  const testDefs = defs();
  const pops = [];
  for (let i = 0; i < 5; i++) pops.push([{ dies: makeWafer(20, 7 + i * 13) }]);
  const means = pops.map(p => pooled(p, testDefs).stats.get(1050).mean);
  // The first population is the one evicted; it must recompute to the same number.
  assert.equal(pooled(pops[0], testDefs).stats.get(1050).mean, means[0]);
  // And every population still reports its own mean, not a neighbour's.
  pops.forEach((p, i) => assert.equal(pooled(p, testDefs).stats.get(1050).mean, means[i]));
});

test('partial and edge-excluded dies are outside the population, in the tally as in the stats', () => {
  clearPooledTestStatsCache();
  const testDefs = [{ testNumber: 1050, name: 'Idsat', limitLow: -2, limitHigh: 2 }];
  const dies = [
    { x: 0, y: 0, testValues: { 1050: 0 } },
    { x: 1, y: 0, testValues: { 1050: 9 }, partial: true },
    { x: 2, y: 0, testValues: { 1050: 9 }, edgeExcluded: true },
  ];
  const out = pooled([{ dies }], testDefs);
  assert.deepEqual(out.specTally.get(1050), { n: 1, fail: 0 },
    'the two excluded dies would each have been a spec failure had they counted');
  assert.equal(out.stats.get(1050).count, 1);
});
