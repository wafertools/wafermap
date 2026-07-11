import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCapabilityData } from '../dist/packages/stats/capability.js';

function dies(values) {
  return values.map((v, i) => ({ x: i, y: 0, testValues: { 1: v } }));
}

test('buildCapabilityData — excludes tests missing either limit', () => {
  const items = [{ dies: [{ x: 0, y: 0, testValues: { 1: 5, 2: 5, 3: 5 } }] }];
  const testDefs = [
    { testNumber: 1, name: 'Both', limitLow: 0, limitHigh: 10 },
    { testNumber: 2, name: 'LoOnly', limitLow: 0 },
    { testNumber: 3, name: 'None' },
  ];
  const out = buildCapabilityData(items, testDefs);
  assert.deepEqual(out.map(d => d.testNumber), [1]);
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

test('buildCapabilityData — returns an empty array when no test has both limits', () => {
  const items = [{ dies: [{ x: 0, y: 0, testValues: { 1: 5 } }] }];
  const testDefs = [{ testNumber: 1, name: 'T' }];
  assert.deepEqual(buildCapabilityData(items, testDefs), []);
});
