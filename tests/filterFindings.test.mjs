import test from 'node:test';
import assert from 'node:assert/strict';
import { filterFindings } from '../dist/packages/stats/filterFindings.js';

function makeFinding(overrides) {
  return {
    id: 'test:1',
    level: 'wafer',
    severity: 'info',
    variable: { kind: 'yield', label: 'Yield' },
    comparison: { family: 'ring', left: 'Ring 1', right: 'Rest of map' },
    effect: { direction: 'lower', absoluteDelta: -0.2 },
    stats: { method: 'two-proportion-z', sampleSizeLeft: 10, sampleSizeRight: 50 },
    summary: 'test finding',
    highlight: { kind: 'region', regionFamily: 'ring', keys: ['ring:1'] },
    ...overrides,
  };
}

const summary = {
  level: 'wafer',
  hasNotableFindings: false,
  findings: [
    makeFinding({ id: '1', severity: 'info',    variable: { kind: 'yield',    label: 'Yield' }, comparison: { family: 'ring',     left: 'Ring 1', right: 'Rest of map' } }),
    makeFinding({ id: '2', severity: 'notable', variable: { kind: 'hardBin',  label: 'Bin 2' }, comparison: { family: 'quadrant', left: 'NE', right: 'Rest of map' } }),
    makeFinding({ id: '3', severity: 'unusual', variable: { kind: 'test',     label: 'Vth' },   comparison: { family: 'ring',     left: 'Ring 4', right: 'Rest of map' } }),
  ],
  stats: { totalDies: 100, analyzedDies: 90, excludedDies: 10, yieldPercent: 0.9, testsConsidered: [], hardBinsConsidered: [], softBinsConsidered: [] },
};

test('filterFindings — no filter returns all findings', () => {
  assert.equal(filterFindings(summary, {}).length, 3);
});

test('filterFindings — filter by severity string', () => {
  const result = filterFindings(summary, { severity: 'notable' });
  assert.equal(result.length, 1);
  assert.equal(result[0].id, '2');
});

test('filterFindings — filter by severity array', () => {
  const result = filterFindings(summary, { severity: ['notable', 'unusual'] });
  assert.equal(result.length, 2);
});

test('filterFindings — filter by kind', () => {
  const result = filterFindings(summary, { kind: 'yield' });
  assert.equal(result.length, 1);
  assert.equal(result[0].id, '1');
});

test('filterFindings — filter by family', () => {
  const result = filterFindings(summary, { family: 'ring' });
  assert.equal(result.length, 2);
});

test('filterFindings — filter by family array', () => {
  const result = filterFindings(summary, { family: ['ring', 'quadrant'] });
  assert.equal(result.length, 3);
});

test('filterFindings — combined severity + family', () => {
  const result = filterFindings(summary, { severity: 'unusual', family: 'ring' });
  assert.equal(result.length, 1);
  assert.equal(result[0].id, '3');
});

test('filterFindings — no match returns empty array', () => {
  const result = filterFindings(summary, { severity: 'info', family: 'quadrant' });
  assert.equal(result.length, 0);
});

test('filterFindings — LotStatsSummary works as source', () => {
  const lot = {
    level: 'lot',
    hasNotableFindings: false,
    findings: [makeFinding({ id: 'lot-1', level: 'lot', severity: 'notable' })],
    stats: { waferCount: 3 },
    lotYieldSeries: [],
    perWafer: [],
  };
  const result = filterFindings(lot, { severity: 'notable' });
  assert.equal(result.length, 1);
});
