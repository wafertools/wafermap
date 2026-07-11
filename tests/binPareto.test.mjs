import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBinParetoData, buildBinClusterData } from '../dist/packages/stats/binPareto.js';

function die(hbin, sbin) { return { x: 0, y: 0, hbin, sbin }; }

test('buildBinParetoData — one row per bin, sorted by count descending', () => {
  const items = [{ dies: [die(1), die(1), die(2)] }];
  const out = buildBinParetoData(items, 'hbin');
  assert.equal(out.length, 2);
  assert.equal(out[0].binCode, 1);
  assert.equal(out[0].value, 2);
  assert.equal(out[1].binCode, 2);
  assert.equal(out[1].value, 1);
});

test('buildBinParetoData — percent is share of total binned dies', () => {
  const items = [{ dies: [die(1), die(1), die(2), die(2)] }];
  const out = buildBinParetoData(items, 'hbin');
  for (const row of out) assert.ok(Math.abs(row.percent - 50) < 1e-9);
});

test('buildBinParetoData — sbin uses the sbin field, not hbin', () => {
  const items = [{ dies: [die(1, 10), die(1, 20)] }];
  const out = buildBinParetoData(items, 'sbin');
  assert.equal(out.length, 2);
  assert.ok(out.every(r => r.label.startsWith('SBin')));
});

test('buildBinClusterData — one cluster per bin, counts aligned to group order', () => {
  const groups = [
    { key: 'A', items: [{ dies: [die(1), die(1)] }] },
    { key: 'B', items: [{ dies: [die(1), die(2)] }] },
  ];
  const out = buildBinClusterData(groups, 'hbin');
  assert.deepEqual(out.groups, ['A', 'B']);
  const bin1 = out.bins.find(b => b.binCode === 1);
  assert.deepEqual(bin1.counts, [2, 1]);
  assert.equal(bin1.total, 3);
});

test('buildBinClusterData — bins sorted by total descending', () => {
  const groups = [{ key: 'A', items: [{ dies: [die(2), die(2), die(2), die(1)] }] }];
  const out = buildBinClusterData(groups, 'hbin');
  assert.equal(out.bins[0].binCode, 2);
});
