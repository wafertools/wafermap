// Derived tests: expression parsing, static validation, and per-die evaluation.
//
// The rules under test are the ones that make a derived value trustworthy on a
// production wafer map, not the arithmetic:
//
//  - an unknown input yields an ABSENT value (no-data grey), never 0 and never false
//  - a boolean expression is a verdict and lands in `testPass`, never as 1/0 in
//    `testValues` — which would put it in the correlation matrix and the Cpk table
//  - measured data is never overwritten by a derived test
//  - every statically-knowable mistake is a warning with a position, and the
//    offending test is dropped rather than half-applied
//  - derivation happens per raw probe record, before lot stacking and retest collapse

import test from 'node:test';
import assert from 'node:assert/strict';
import { buildWaferMap } from '../dist/index.js';

const TESTS = [
  { testNumber: 1010, name: 'Rise A', unit: 'uA', limitLow: 0, limitHigh: 10 },
  { testNumber: 1011, name: 'Rise B', unit: 'uA', limitLow: 0, limitHigh: 10 },
  { testNumber: 1020, name: 'Fall A', unit: 'uA', limitLow: 0, limitHigh: 10 },
  { testNumber: 1030, name: 'Volts',  unit: 'V' },
  { testNumber: 2000, name: 'Func A', testType: 'F' },
  { testNumber: 2001, name: 'Func B', testType: 'F' },
];

const DIE_CONFIG = { width: 5, height: 5 };
const WAFER = { diameter: 100 };

/** Build a one-wafer map over `results` with `derivedTests` applied. */
function build(results, derivedTests, extra = {}) {
  return buildWaferMap({
    results,
    testDefs: TESTS,
    derivedTests,
    waferConfig: WAFER,
    dieConfig: DIE_CONFIG,
    ...extra,
  });
}

const dieAt = (result, x, y) => result.dies.find(d => d.x === x && d.y === y);
const derivedWarnings = (result) => result.warnings.filter(w => w.code === 'derived-test-invalid');

// ── Arithmetic and the value channel ──────────────────────────────────────────

test('a numeric expression lands in testValues and joins testDefs', () => {
  const r = build(
    [{ x: 0, y: 0, hbin: 1, testValues: { 1010: 3, 1020: 8 } }],
    [{ testNumber: 900001, name: 'Shift', unit: 'uA', expression: 'abs(t[1020] - t[1010])' }],
  );

  assert.deepEqual(derivedWarnings(r), []);
  assert.equal(dieAt(r, 0, 0).testValues[900001], 5);

  const def = r.testDefs.find(d => d.testNumber === 900001);
  assert.equal(def.name, 'Shift');
  assert.equal(def.unit, 'uA');
  assert.equal(def.testType, 'P');
  assert.equal(def.derived, true, 'derived defs are marked so every surface naming them can say so');
});

test('a derived def carries its expression into testDefs, a measured one does not', () => {
  // Display surfaces must be able to say WHERE a computed number came from
  // without the host holding its `derivedTests` input alongside the result and
  // joining the two by test number. `expression` therefore travels with the def
  // that was actually admitted. `derived` distinguishes the two kinds; it is
  // never inferred from the test number, which carries no such meaning.
  const r = build(
    [{ x: 0, y: 0, hbin: 1, testValues: { 1010: 3, 1020: 8 } }],
    [{ testNumber: 900001, name: 'Shift', expression: 'abs(t[1020] - t[1010])', constants: { k: 2 } }],
  );

  const derived = r.testDefs.find(d => d.testNumber === 900001);
  assert.equal(derived.expression, 'abs(t[1020] - t[1010])', 'verbatim, so it matches the author\'s own source');
  assert.deepEqual(derived.constants, { k: 2 });

  const measured = r.testDefs.find(d => d.testNumber === 1010);
  assert.equal(measured.derived, undefined, 'a measured test is not marked');
  assert.equal(measured.expression, undefined, 'and has no expression to show');
});

test('constants are substituted and precedence follows normal maths', () => {
  const r = build(
    [{ x: 0, y: 0, hbin: 1, testValues: { 1010: 2, 1020: 4 } }],
    [{
      testNumber: 900001, name: 'Scaled', unit: 'uA',
      expression: 't[1010] + t[1020] * k ^ 2',
      constants: { k: 3 },
    }],
  );
  assert.deepEqual(derivedWarnings(r), []);
  // 2 + 4*9 = 38, not (2+4)*9
  assert.equal(dieAt(r, 0, 0).testValues[900001], 38);
});

// ── Unknown propagation ───────────────────────────────────────────────────────

test('a missing input makes the derived value ABSENT, not zero', () => {
  const r = build(
    [
      { x: 0, y: 0, hbin: 1, testValues: { 1010: 3, 1020: 8 } },
      { x: 1, y: 0, hbin: 1, testValues: { 1010: 3 } },          // 1020 never recorded
    ],
    [{ testNumber: 900001, name: 'Shift', unit: 'uA', expression: 't[1020] - t[1010]' }],
  );

  assert.equal(dieAt(r, 0, 0).testValues[900001], 5);
  assert.equal(
    900001 in (dieAt(r, 1, 0).testValues ?? {}), false,
    'an unknown operand must leave NO entry — a 0 here would plot as a real measurement and drag the mean',
  );
});

test('a non-finite result is absent, not NaN', () => {
  const r = build(
    [{ x: 0, y: 0, hbin: 1, testValues: { 1010: 0, 1020: 0 } }],
    [{ testNumber: 900001, name: 'Ratio', expression: 't[1020] / t[1010]' }],
  );
  assert.equal(900001 in (dieAt(r, 0, 0).testValues ?? {}), false, '0/0 must be no-data, never NaN');
});

// ── Verdicts: the two kinds, and the channel they land in ─────────────────────

test('a boolean expression writes to testPass, never a 1/0 in testValues', () => {
  const r = build(
    [{ x: 0, y: 0, hbin: 1, testPass: { 2000: true, 2001: false } }],
    [{ testNumber: 900002, name: 'All Func Pass', testType: 'F', expression: 'all(testPass[2000..2001])' }],
  );

  assert.deepEqual(derivedWarnings(r), []);
  const die = dieAt(r, 0, 0);
  assert.equal(die.testPass[900002], false);
  assert.equal(
    900002 in (die.testValues ?? {}), false,
    'a verdict as 1/0 in testValues would enter the correlation matrix and the Cpk table',
  );
  assert.equal(r.testDefs.find(d => d.testNumber === 900002).testType, 'F');
});

test('testPass and specPass are different questions', () => {
  // Value 12 is above limitHigh 10 — spec says fail — but the tester recorded a pass.
  const results = [{ x: 0, y: 0, hbin: 1, testValues: { 1010: 12 }, testPass: { 1010: true } }];

  const byFlag = build(results, [
    { testNumber: 900003, name: 'Flag', testType: 'F', expression: 'testPass[1010]' }]);
  const bySpec = build(results, [
    { testNumber: 900004, name: 'Spec', testType: 'F', expression: 'specPass[1010]' }]);

  assert.equal(dieAt(byFlag, 0, 0).testPass[900003], true,  'testPass is the recorded verdict');
  assert.equal(dieAt(bySpec, 0, 0).testPass[900004], false, 'specPass is the limit judgement');
});

test('specPass on a test with values but no recorded verdict still works', () => {
  // The case that a single conflated accessor would have got wrong: CSV-sourced
  // parametric data has measurements and no TEST_FLG at all.
  const r = build(
    [{ x: 0, y: 0, hbin: 1, testValues: { 1010: 5 } }],
    [{ testNumber: 900005, name: 'In Spec', testType: 'F', expression: 'specPass[1010]' }],
  );
  assert.deepEqual(derivedWarnings(r), []);
  assert.equal(dieAt(r, 0, 0).testPass[900005], true);
});

test('a missing verdict is unknown, never a fail', () => {
  const r = build(
    [{ x: 0, y: 0, hbin: 1, testPass: { 2000: true } }],   // 2001 never ran
    [{ testNumber: 900002, name: 'Both', testType: 'F', expression: 'testPass[2000] and testPass[2001]' }],
  );
  assert.equal(
    900002 in (dieAt(r, 0, 0).testPass ?? {}), false,
    'a missing verdict must not be read as false',
  );
});

test('diePass() reads the bin verdict under the map\'s own passBins', () => {
  const r = build(
    [
      { x: 0, y: 0, hbin: 5, testValues: { 1010: 1 } },
      { x: 1, y: 0, hbin: 9, testValues: { 1010: 1 } },
    ],
    [{ testNumber: 900006, name: 'Die OK', testType: 'F', expression: 'diePass()' }],
    { passBins: [5] },
  );
  assert.equal(dieAt(r, 0, 0).testPass[900006], true);
  assert.equal(dieAt(r, 1, 0).testPass[900006], false);
});

// ── Ranges and reducers ───────────────────────────────────────────────────────

test('reducers skip unknowns and countKnown reports the real denominator', () => {
  const r = build(
    [{ x: 0, y: 0, hbin: 1, testValues: { 1010: 2, 1020: 6 } }],  // 1011 not recorded
    [
      { testNumber: 900007, name: 'Mean',  unit: 'uA', expression: 'mean(t[1010..1020])' },
      { testNumber: 900008, name: 'Known',            expression: 'countKnown(t[1010..1020])' },
    ],
  );
  const die = dieAt(r, 0, 0);
  assert.equal(die.testValues[900007], 4, 'mean of the KNOWN values (2, 6), not of three with a zero');
  assert.equal(die.testValues[900008], 2);
});

test('a range names a block of numbers, not an assertion that all exist', () => {
  // 1012..1019 are not declared; the range still resolves to the declared ones.
  const r = build(
    [{ x: 0, y: 0, hbin: 1, testValues: { 1010: 1, 1011: 3 } }],
    [{ testNumber: 900009, name: 'Sum', unit: 'uA', expression: 'sum(t[1010..1019])' }],
  );
  assert.deepEqual(derivedWarnings(r), []);
  assert.equal(dieAt(r, 0, 0).testValues[900009], 4);
});

test('countFalse over a verdict range counts failing tests', () => {
  const r = build(
    [{ x: 0, y: 0, hbin: 1, testPass: { 2000: false, 2001: true } }],
    [{ testNumber: 900010, name: 'Fail Count', expression: 'countFalse(testPass[2000..2001])' }],
  );
  assert.equal(dieAt(r, 0, 0).testValues[900010], 1);
});

test('a bare range is rejected — it must be reduced', () => {
  const r = build(
    [{ x: 0, y: 0, hbin: 1, testValues: { 1010: 1 } }],
    [{ testNumber: 900011, name: 'Bare', expression: 't[1010..1011]' }],
  );
  assert.equal(derivedWarnings(r).length, 1);
  assert.match(derivedWarnings(r)[0].message, /reduce/i);
  assert.equal(r.testDefs.some(d => d.testNumber === 900011), false);
});

test('there is no vector arithmetic', () => {
  const r = build(
    [{ x: 0, y: 0, hbin: 1, testValues: { 1010: 1 } }],
    [{ testNumber: 900012, name: 'VecMath', expression: 't[1010..1011] * 2' }],
  );
  assert.equal(derivedWarnings(r).length, 1);
  assert.equal(r.testDefs.some(d => d.testNumber === 900012), false);
});

// ── Static validation: every one of these is knowable at build ────────────────

const REJECTIONS = [
  ['t[] on a functional test',      { expression: 't[2000]' },                     /functional/i],
  ['specPass with no limits',       { expression: 'specPass[1030]', testType: 'F' }, /limitLow/],
  ['specPass on a functional test', { expression: 'specPass[2000]', testType: 'F' }, /functional/i],
  ['an undeclared test',            { expression: 't[7777]' },                     /not declared/i],
  ['an unknown function',           { expression: 'wat(t[1010])' },                /Unknown function/],
  ['an unknown name',               { expression: 't[1010] * scale' },             /Unknown name/],
  ['a syntax error',                { expression: 't[1010] +' },                   /position/],
  ['boolean where number expected', { expression: 't[1010] + testPass[2000]' },    /numeric/i],
  ['a backwards range',             { expression: 'mean(t[1020..1010])' },         /backwards/],
  ['an empty expression',           { expression: '   ' },                         /empty/],
];

for (const [label, fields, pattern] of REJECTIONS) {
  test(`rejected with a reason: ${label}`, () => {
    const r = build(
      [{ x: 0, y: 0, hbin: 1, testValues: { 1010: 1 }, testPass: { 2000: true } }],
      [{ testNumber: 900099, name: 'Bad', ...fields }],
    );
    const w = derivedWarnings(r);
    assert.equal(w.length >= 1, true, `expected a warning for ${label}`);
    assert.match(w[0].message, pattern);
    assert.equal(
      r.testDefs.some(d => d.testNumber === 900099), false,
      'a rejected derived test is DROPPED, never half-applied',
    );
  });
}

test('a declared type that disagrees with the expression is rejected', () => {
  const asNumber = build(
    [{ x: 0, y: 0, hbin: 1, testPass: { 2000: true } }],
    [{ testNumber: 900013, name: 'Wrong', expression: 'testPass[2000]' }],   // boolean, declared P
  );
  assert.match(derivedWarnings(asNumber)[0].message, /testType: 'F'/);

  const asFunctional = build(
    [{ x: 0, y: 0, hbin: 1, testValues: { 1010: 1 } }],
    [{ testNumber: 900014, name: 'Wrong', testType: 'F', expression: 't[1010] * 2' }],
  );
  assert.match(derivedWarnings(asFunctional)[0].message, /produces a number/);
});

test('measured data is never overwritten by a derived test', () => {
  const r = build(
    [{ x: 0, y: 0, hbin: 1, testValues: { 1010: 42 } }],
    [{ testNumber: 1010, name: 'Hijack', expression: 't[1020] * 0' }],
  );
  assert.match(derivedWarnings(r)[0].message, /already exists/);
  assert.equal(dieAt(r, 0, 0).testValues[1010], 42, 'the measured value survives');
});

test('two derived tests cannot claim the same number', () => {
  const r = build(
    [{ x: 0, y: 0, hbin: 1, testValues: { 1010: 2 } }],
    [
      { testNumber: 900015, name: 'First',  expression: 't[1010]' },
      { testNumber: 900015, name: 'Second', expression: 't[1010] * 2' },
    ],
  );
  assert.match(derivedWarnings(r)[0].message, /earlier derived test/);
  assert.equal(dieAt(r, 0, 0).testValues[900015], 2, 'the first definition wins');
});

test('a derived test can read another derived test', () => {
  const r = build(
    [{ x: 0, y: 0, hbin: 1, testValues: { 1010: 2, 1020: 8 } }],
    [
      { testNumber: 900016, name: 'Gap',    unit: 'uA', expression: 't[1020] - t[1010]' },
      { testNumber: 900017, name: 'Double', unit: 'uA', expression: 't[900016] * 2' },
    ],
  );
  assert.deepEqual(derivedWarnings(r), []);
  assert.equal(dieAt(r, 0, 0).testValues[900016], 6);
  assert.equal(dieAt(r, 0, 0).testValues[900017], 12);
});

test('nesting works regardless of declaration order', () => {
  // The dependent is declared FIRST — evaluation must follow dependency order,
  // not the order the caller happened to write.
  const r = build(
    [{ x: 0, y: 0, hbin: 1, testValues: { 1010: 2, 1020: 8 } }],
    [
      { testNumber: 900017, name: 'Double', unit: 'uA', expression: 't[900016] * 2' },
      { testNumber: 900016, name: 'Gap',    unit: 'uA', expression: 't[1020] - t[1010]' },
    ],
  );
  assert.deepEqual(derivedWarnings(r), []);
  assert.equal(dieAt(r, 0, 0).testValues[900017], 12);
});

test('nesting crosses the value/verdict boundary', () => {
  const r = build(
    [{ x: 0, y: 0, hbin: 1, testValues: { 1010: 2, 1020: 8 } }],
    [
      { testNumber: 900016, name: 'Gap', unit: 'uA', expression: 't[1020] - t[1010]',
        limitHigh: 5 },
      { testNumber: 900018, name: 'Gap OK', testType: 'F', expression: 'specPass[900016]' },
    ],
  );
  assert.deepEqual(derivedWarnings(r), []);
  assert.equal(
    dieAt(r, 0, 0).testPass[900018], false,
    'a nested specPass is judged against the limits declared on the derived test it reads',
  );
});

test('an unknown value propagates through the nesting', () => {
  const r = build(
    [{ x: 0, y: 0, hbin: 1, testValues: { 1010: 2 } }],      // 1020 missing
    [
      { testNumber: 900016, name: 'Gap',    unit: 'uA', expression: 't[1020] - t[1010]' },
      { testNumber: 900017, name: 'Double', unit: 'uA', expression: 't[900016] * 2' },
    ],
  );
  const die = dieAt(r, 0, 0);
  assert.equal(900016 in (die.testValues ?? {}), false);
  assert.equal(900017 in (die.testValues ?? {}), false, 'the dependent goes absent too, not zero');
});

test('a dependency cycle is rejected with the cycle named', () => {
  const r = build(
    [{ x: 0, y: 0, hbin: 1, testValues: { 1010: 2 } }],
    [
      { testNumber: 900016, name: 'A', expression: 't[900017] + 1' },
      { testNumber: 900017, name: 'B', expression: 't[900016] + 1' },
    ],
  );
  const w = derivedWarnings(r);
  assert.ok(w.some(x => /depends on itself through/.test(x.message)));
  assert.equal(r.testDefs.some(d => d.testNumber === 900016), false);
  assert.equal(r.testDefs.some(d => d.testNumber === 900017), false);
});

test('a self-reference is rejected', () => {
  const r = build(
    [{ x: 0, y: 0, hbin: 1, testValues: { 1010: 2 } }],
    [{ testNumber: 900016, name: 'Self', expression: 't[900016] + 1' }],
  );
  assert.match(derivedWarnings(r)[0].message, /reads itself/);
  assert.equal(r.testDefs.some(d => d.testNumber === 900016), false);
});

test('a dependent of a dropped test is dropped too, naming the cause', () => {
  const r = build(
    [{ x: 0, y: 0, hbin: 1, testValues: { 1010: 2 } }],
    [
      { testNumber: 900016, name: 'Broken',    expression: 't[7777]' },   // undeclared test
      { testNumber: 900017, name: 'Dependent', expression: 't[900016] * 2' },
    ],
  );
  const w = derivedWarnings(r);
  assert.ok(w.some(x => /not declared/i.test(x.message)));
  assert.ok(w.some(x => /which was itself dropped/.test(x.message)),
    'an expression whose input never materialises would otherwise look like missing data');
  assert.equal(r.testDefs.some(d => d.testNumber === 900017), false);
});

test('mixing units is computed but reported', () => {
  const r = build(
    [{ x: 0, y: 0, hbin: 1, testValues: { 1010: 3, 1030: 1 } }],
    [{ testNumber: 900018, name: 'Mixed', expression: 't[1010] - t[1030]' }],
  );
  const w = derivedWarnings(r);
  assert.equal(w.length, 1);
  assert.match(w[0].message, /uA and V/);
  assert.equal(
    dieAt(r, 0, 0).testValues[900018], 2,
    'a unit mismatch is an advisory — unit strings are free text, so refusing to build would be worse',
  );
});

// ── Ordering ──────────────────────────────────────────────────────────────────

test('derivation runs per raw probe record, before lot stacking', () => {
  // Wafer 1: |8-2| = 6.  Wafer 2: |4-4| = 0.  Mean of the derived values = 3.
  // Deriving AFTER a mean stack would give |6-3| = 3 by coincidence, so the
  // numbers are chosen to differ: mean(1010) = 3, mean(1020) = 6, |6-3| = 3 vs 3.
  // Use max instead, where the two orders genuinely disagree.
  const r = buildWaferMap({
    lotStack: {
      results: [
        [{ x: 0, y: 0, hbin: 1, testValues: { 1010: 2, 1020: 8 } }],
        [{ x: 0, y: 0, hbin: 1, testValues: { 1010: 9, 1020: 1 } }],
      ],
      method: 'max',
    },
    testDefs: TESTS,
    derivedTests: [{ testNumber: 900019, name: 'Gap', unit: 'uA', expression: 'abs(t[1020] - t[1010])' }],
    waferConfig: WAFER,
    dieConfig: DIE_CONFIG,
  });

  // Per-record: |8-2| = 6 and |1-9| = 8 → max = 8.
  // If it derived after stacking: max(1010)=9, max(1020)=8 → |8-9| = 1. Wrong.
  assert.equal(
    dieAt(r, 0, 0).testValues[900019], 8,
    'deriving after the stack would subtract one aggregate from another — a number with no physical meaning',
  );
});

test('derivation runs before retest collapse, on the surviving record', () => {
  const r = build(
    [
      { x: 0, y: 0, hbin: 1, testValues: { 1010: 1, 1020: 2 } },
      { x: 0, y: 0, hbin: 1, testValues: { 1010: 5, 1020: 9 } },   // last touchdown
    ],
    [{ testNumber: 900020, name: 'Gap', unit: 'uA', expression: 't[1020] - t[1010]' }],
    { retestPolicy: 'last' },
  );
  assert.equal(
    dieAt(r, 0, 0).testValues[900020], 4,
    'both operands must come from the SAME touchdown (9-5), never mixed across records',
  );
});

// ── Hygiene ───────────────────────────────────────────────────────────────────

test('no derivedTests means no change and no warnings', () => {
  const r = build([{ x: 0, y: 0, hbin: 1, testValues: { 1010: 1 } }], undefined);
  assert.deepEqual(derivedWarnings(r), []);
  assert.deepEqual(r.testDefs.map(d => d.testNumber), TESTS.map(d => d.testNumber));
});

test('the caller\'s input arrays are not mutated', () => {
  const results = [{ x: 0, y: 0, hbin: 1, testValues: { 1010: 3, 1020: 8 } }];
  build(results, [{ testNumber: 900021, name: 'Shift', unit: 'uA', expression: 't[1020] - t[1010]' }]);
  assert.deepEqual(results[0].testValues, { 1010: 3, 1020: 8 });
});

test('there is no path to a host object', () => {
  const attacks = [
    'constructor',
    'this.constructor',
    '__proto__',
    'globalThis',
    'process.exit(1)',
    'Function("return 1")()',
    't[1010].constructor',
  ];
  for (const expression of attacks) {
    const r = build(
      [{ x: 0, y: 0, hbin: 1, testValues: { 1010: 1 } }],
      [{ testNumber: 900022, name: 'Attack', expression }],
    );
    assert.equal(derivedWarnings(r).length >= 1, true, `${expression} must not compile`);
    assert.equal(r.testDefs.some(d => d.testNumber === 900022), false, `${expression} must not produce a test`);
  }
});

test('an over-long expression is refused', () => {
  const r = build(
    [{ x: 0, y: 0, hbin: 1, testValues: { 1010: 1 } }],
    [{ testNumber: 900023, name: 'Long', expression: `t[1010]${' + 1'.repeat(1000)}` }],
  );
  assert.match(derivedWarnings(r)[0].message, /limit/);
});
