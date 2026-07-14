import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCapabilityData } from '../dist/packages/stats/capability.js';

function dies(values) {
  return values.map((v, i) => ({ x: i, y: 0, testValues: { 1: v } }));
}

test('buildCapabilityData — tests missing either limit still appear, marked hasSpec:false', () => {
  const items = [{ dies: [{ x: 0, y: 0, testValues: { 1: 5, 2: 5, 3: 5 } }] }];
  const testDefs = [
    { testNumber: 1, name: 'Both', limitLow: 0, limitHigh: 10 },
    { testNumber: 2, name: 'LoOnly', limitLow: 0 },
    { testNumber: 3, name: 'None' },
  ];
  const out = buildCapabilityData(items, testDefs);
  assert.deepEqual(out.map(d => d.testNumber).sort(), [1, 2, 3]);
  const byTest = new Map(out.map(d => [d.testNumber, d]));
  assert.equal(byTest.get(1).hasSpec, true);
  assert.equal(byTest.get(2).hasSpec, false);
  assert.equal(byTest.get(3).hasSpec, false);
  assert.equal(byTest.get(2).lsl, undefined);
  assert.equal(byTest.get(2).usl, undefined);
  assert.equal(byTest.get(2).cp, null);
  assert.equal(byTest.get(2).cpk, null);
  assert.equal(byTest.get(2).pp, null);
  assert.equal(byTest.get(2).ppk, null);
});

test('buildCapabilityData — unspec\'d tests normalize onto their own [min, max]', () => {
  const items = [{ dies: Array.from({ length: 11 }, (_, i) => ({ x: i, y: 0, testValues: { 1: 20 + i } })) }];
  const testDefs = [{ testNumber: 1, name: 'NoSpec' }];
  const [d] = buildCapabilityData(items, testDefs);
  assert.equal(d.hasSpec, false);
  assert.ok(Math.abs(d.min - 0) < 1e-9);
  assert.ok(Math.abs(d.max - 1) < 1e-9);
  assert.ok(Math.abs(d.median - 0.5) < 1e-9);
});

test('buildCapabilityData — sorts spec\'d tests ahead of unspec\'d, unspec\'d by most-variable-first', () => {
  const items = [{
    dies: [
      { x: 0, y: 0, testValues: { 1: 5, 2: 1, 3: 1 } },
      { x: 1, y: 0, testValues: { 1: 5, 2: 9, 3: 1.1 } },
      { x: 2, y: 0, testValues: { 1: 5, 2: 5, 3: 0.9 } },
    ],
  }];
  const testDefs = [
    { testNumber: 1, name: 'Spec\'d', limitLow: 0, limitHigh: 10 },
    { testNumber: 2, name: 'Wide, no spec' },
    { testNumber: 3, name: 'Narrow, no spec' },
  ];
  const out = buildCapabilityData(items, testDefs);
  assert.deepEqual(out.map(d => d.testNumber), [1, 2, 3]);
});

test('buildCapabilityData — normalizes the five-number summary to [lsl, usl]', () => {
  const items = [{ dies: Array.from({ length: 11 }, (_, i) => ({ x: i, y: 0, testValues: { 1: i } })) }];
  const testDefs = [{ testNumber: 1, name: 'T', limitLow: 0, limitHigh: 10 }];
  const [d] = buildCapabilityData(items, testDefs);
  assert.ok(Math.abs(d.min - 0) < 1e-9);
  assert.ok(Math.abs(d.max - 1) < 1e-9);
  assert.ok(Math.abs(d.median - 0.5) < 1e-9);
});

test('buildCapabilityData — Cp/Cpk use within-item stddev, Pp/Ppk use overall', () => {
  // Two items, each internally constant (zero within-item spread) but
  // differing from each other — all variance is between-item, none within.
  const items = [
    { dies: dies([4, 4, 4, 4, 4]) },
    { dies: dies([6, 6, 6, 6, 6]) },
  ];
  const testDefs = [{ testNumber: 1, name: 'T', limitLow: 0, limitHigh: 10 }];
  const [d] = buildCapabilityData(items, testDefs);
  assert.equal(d.cp, null);
  assert.equal(d.cpk, null);
  assert.ok(d.pp !== null);
  assert.ok(d.ppk !== null);
  assert.ok(Math.abs(d.mean - 5) < 1e-9);
});

test('buildCapabilityData — sorts worst (lowest) Ppk first', () => {
  const tight = Array.from({ length: 30 }, (_, i) => ({ x: i, y: 0, testValues: { 1: 5 + (i % 2 === 0 ? -0.01 : 0.01), 2: i % 10 } }));
  const items = [{ dies: tight }];
  const testDefs = [
    { testNumber: 1, name: 'Tight', limitLow: 0, limitHigh: 10 },
    { testNumber: 2, name: 'Wide', limitLow: 0, limitHigh: 10 },
  ];
  const out = buildCapabilityData(items, testDefs);
  assert.deepEqual(out.map(d => d.testNumber), [2, 1]);
});

test('buildCapabilityData — still returns unspec\'d tests when none have both limits', () => {
  const items = [{ dies: [{ x: 0, y: 0, testValues: { 1: 5 } }] }];
  const testDefs = [{ testNumber: 1, name: 'T' }];
  const out = buildCapabilityData(items, testDefs);
  assert.equal(out.length, 1);
  assert.equal(out[0].hasSpec, false);
});

test('buildCapabilityData — returns an empty array when no test has any recorded values', () => {
  const items = [{ dies: [{ x: 0, y: 0, testValues: {} }] }];
  const testDefs = [{ testNumber: 1, name: 'T' }];
  assert.deepEqual(buildCapabilityData(items, testDefs), []);
});
