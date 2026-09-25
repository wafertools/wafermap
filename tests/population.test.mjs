import test from 'node:test';
import assert from 'node:assert/strict';
import { describeWaferPopulation, populationLabel, populationStat } from '../dist/packages/stats/population.js';
import { analyzeWaferLot, renderLotReportHtml } from '../dist/packages/stats/index.js';
import { buildWaferMap } from '../dist/index.js';

// "Lot" only when every wafer records the same lot ID — see stats/population.ts.

test('one lot: named, and statistics are "lot" statistics', () => {
  const p = describeWaferPopulation([{ lot: 'LOT1' }, { lotId: 'LOT1' }, { lot: 'LOT1', wafer: 'W3' }]);
  assert.deepEqual(p, { waferCount: 3, lotCount: 1, lotId: 'LOT1' });
  assert.equal(populationLabel(p), 'Lot LOT1 · 3 wafers');
  assert.equal(populationStat(p, 'median'), 'lot median');
});

test('several lots: never called a lot', () => {
  const p = describeWaferPopulation([{ lot: 'A' }, { lot: 'B' }, { lot: 'A' }]);
  assert.equal(p.lotId, undefined);
  assert.equal(populationLabel(p), '3 wafers from 2 lots');
  assert.equal(populationStat(p, 'mean'), 'mean of all wafers');
});

test('a wafer with no lot ID is not assumed to share the others\' lot', () => {
  const p = describeWaferPopulation([{ lot: 'A' }, {}, null]);
  assert.equal(p.lotId, undefined);
  assert.equal(p.lotCount, 1);
  assert.equal(populationLabel(p), '3 wafers');
});

test('no lot IDs at all, and a single wafer', () => {
  assert.equal(populationLabel(describeWaferPopulation([undefined])), '1 wafer');
});

// Failing dies per wafer (of 20): yields 40/90/85/95/90 %. The spread keeps the
// median absolute deviation non-zero, which the outlier test needs, and wafer 0
// sits far below the rest.
const FAILS = [12, 2, 3, 1, 2];

function maps(lotIds) {
  return lotIds.map((id, i) => buildWaferMap({
    results: Array.from({ length: 20 }, (_, k) => ({ x: k % 5, y: Math.floor(k / 5), hbin: k < FAILS[i] ? 2 : 1 })),
    waferConfig: { diameter: 60, metadata: id ? { lot: id, wafer: `W${i}` } : { wafer: `W${i}` } },
    dieConfig: { width: 10, height: 10 },
    passBins: [1],
  }));
}

function lot(lotIds) {
  return analyzeWaferLot(maps(lotIds));
}

test('yield outlier finding says "lot median" only for a single lot', () => {
  const one = lot(['L1', 'L1', 'L1', 'L1', 'L1']).findings.find(f => f.level === 'inter-wafer');
  const mixed = lot(['L1', 'L2', 'L1', 'L2', 'L1']).findings.find(f => f.level === 'inter-wafer');
  assert.ok(one && mixed, 'fixture produces a yield outlier');
  assert.match(one.summary, /than the lot median$/);
  assert.equal(one.comparison.right, 'Lot median');
  assert.match(mixed.summary, /than the median of all wafers$/);
  assert.equal(mixed.comparison.right, 'Median of all wafers');
});

test('lot report title names a lot only when there is one', () => {
  assert.match(renderLotReportHtml(maps(['L1', 'L1', 'L1', 'L1', 'L1'])), /<title>Lot Summary — L1<\/title>/);
  // Two lots are reported lot by lot, under a title that names neither.
  assert.match(renderLotReportHtml(maps(['L1', 'L2', 'L1', 'L2', 'L1'])), /<title>Summary<\/title>/);
});
