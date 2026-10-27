import test from 'node:test';
import assert from 'node:assert/strict';
import { checkDerivedExpression, buildWaferMap } from '../dist/index.js';

const defs = [
  { testNumber: 1001, name: 'Vdd', unit: 'V' },
  { testNumber: 1002, name: 'Idsat', unit: 'mA' },
];
const die = (x, y) => ({ x, y, hbin: 1, testValues: { 1001: 1.8, 1002: 4 }, testPass: {} });

test('a good numeric expression reports what it produces and reads', () => {
  const r = checkDerivedExpression({ expression: 't[1002] / t[1001]', testNumber: 900001 }, defs);
  assert.equal(r.ok, true);
  assert.equal(r.produces, 'number');
  assert.deepEqual(r.reads.map(x => x.test), [1002, 1001]);
  assert.deepEqual(r.warnings, []);
});

test('a bad expression comes back with a message and a position, never a throw', () => {
  const r = checkDerivedExpression({ expression: 't[1002] / ', testNumber: 900001 }, defs);
  assert.equal(r.ok, false);
  assert.equal(typeof r.message, 'string');
  assert.equal(typeof r.position, 'number');
});

test('an unknown test is refused', () => {
  const r = checkDerivedExpression({ expression: 't[7777] + 1', testNumber: 900001 }, defs);
  assert.equal(r.ok, false);
});

test('a verdict needs a functional test, and a number cannot be functional', () => {
  assert.equal(checkDerivedExpression({ expression: 't[1001] > 1', testNumber: 900001, testType: 'P' }, defs).ok, false);
  assert.equal(checkDerivedExpression({ expression: 't[1001] > 1', testNumber: 900001, testType: 'F' }, defs).produces, 'verdict');
  assert.equal(checkDerivedExpression({ expression: 't[1001] + 1', testNumber: 900001, testType: 'F' }, defs).ok, false);
});

test('a number already in the data is refused, as the build refuses it', () => {
  const r = checkDerivedExpression({ expression: 't[1001] + 1', testNumber: 1001 }, defs);
  assert.equal(r.ok, false);
  assert.match(r.message, /already exists/);
});

test('a derived test may read another derived test, and not itself', () => {
  const other = [{ testNumber: 900001, name: 'A', expression: 't[1001] * 2' }];
  assert.equal(checkDerivedExpression({ expression: 't[900001] + 1', testNumber: 900002 }, defs, other).ok, true);
  assert.equal(checkDerivedExpression({ expression: 't[900002] + 1', testNumber: 900002 }, defs, [{ testNumber: 900002, expression: 'x' }]).ok, false);
});

test('the build’s identity rules hold: an STDF test number, and not another derived test’s', () => {
  for (const testNumber of [-1, 1.5, 4294967296, 5000000000, Number.NaN]) {
    assert.equal(checkDerivedExpression({ expression: 't[1001] + 1', testNumber }, defs).ok, false, String(testNumber));
  }
  assert.equal(checkDerivedExpression({ expression: 't[1001] + 1', testNumber: 4294967295 }, defs).ok, true);
  const dup = checkDerivedExpression({ expression: 't[1001] + 1', testNumber: 900001 }, defs, [{ testNumber: 900001, name: 'A', expression: 't[1001]' }]);
  assert.equal(dup.ok, false);
  assert.match(dup.message, /another derived test/);
  // …and the build drops what the check refuses
  const r = buildWaferMap({ results: [die(0, 0)], testDefs: defs, derivedTests: [{ testNumber: 5000000000, name: 'Big', expression: 't[1001] + 1' }] });
  assert.ok(r.warnings.some(w => w.code === 'derived-test-invalid'));
});

test('combining units warns but is accepted', () => {
  const r = checkDerivedExpression({ expression: 't[1001] + t[1002]', testNumber: 900001 }, defs);
  assert.equal(r.ok, true);
  assert.equal(r.warnings.length, 1);
});

test('agrees with the build: what the check accepts, buildWaferMap computes', () => {
  const dt = { testNumber: 900001, name: 'Ratio', expression: 't[1002] / t[1001]' };
  assert.equal(checkDerivedExpression(dt, defs).ok, true);
  const r = buildWaferMap({ results: [die(0, 0)], testDefs: defs, derivedTests: [dt] });
  assert.ok(r.testDefs?.some(d => d.testNumber === 900001));
  const bad = { testNumber: 900002, name: 'Bad', expression: 't[1001] +' };
  assert.equal(checkDerivedExpression(bad, defs).ok, false);
  const r2 = buildWaferMap({ results: [die(0, 0)], testDefs: defs, derivedTests: [bad] });
  assert.ok(r2.warnings.some(w => w.code === 'derived-test-invalid'));
});
