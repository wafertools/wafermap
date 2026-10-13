// A test's mean and its limit fail rate share a variable kind, index and label. The finding says
// which it is (`variable.measure`), and every table that prints one names the statistic and states
// a rate in points: a rate difference printed in the test's unit ("+22.2 mV") or as a ratio of two
// rates ("+401%") reads as a shift in the test's values.
import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeWaferMap } from '../dist/packages/stats/analyzeWaferMap.js';
import { formatFindingDelta, findingsTableHtml } from '../dist/packages/stats/reportHtml.js';
import { findingMetricLabel } from '../dist/packages/stats/findingText.js';
import { arrangeFindings } from '../dist/packages/stats/filterFindings.js';
import { buildLot } from './fixtures/synthLots.mjs';

const findingsOf = () => {
  const [m] = buildLot({ name: 'measure:sectors', wafers: 1, tests: 'parametric', testFailures: [{ test: 101, region: 'sectors-NE-N', p: 0.4, binning: 'pass' }] });
  return analyzeWaferMap(m, { enableTestValueAnalysis: true }).findings;
};

test('every test finding says which statistic it compares, and a rate carries no unit', () => {
  const tests = findingsOf().filter(f => f.variable.kind === 'test');
  const limit = tests.filter(f => f.id.startsWith('specLimit:'));
  const mean = tests.filter(f => f.id.startsWith('test:'));
  assert.ok(limit.length && mean.length);
  for (const f of limit) { assert.equal(f.variable.measure, 'limitFailRate', f.id); assert.equal(f.variable.unit, undefined, f.id); }
  for (const f of mean) assert.equal(f.variable.measure, 'mean', f.id);
});

test('the metric label names the statistic', () => {
  const v = { kind: 'test', index: 1, label: 'VT' };
  assert.equal(findingMetricLabel({ variable: { ...v, measure: 'mean' } }), 'VT mean');
  assert.equal(findingMetricLabel({ variable: { ...v, measure: 'limitFailRate' } }), 'VT limit fail rate');
  assert.equal(findingMetricLabel({ variable: { kind: 'yield', label: 'Yield' } }), 'Yield');
});

test('a limit fail rate is stated in points, whatever the background rate', () => {
  const variable = { kind: 'test', index: 1, label: 'VT', measure: 'limitFailRate' };
  // Rest of the wafer at 0%: no ratio exists, and the unit must not stand in for one.
  assert.equal(formatFindingDelta({ variable, effect: { absoluteDelta: 0.022, relativeDelta: undefined } }), '+2.2 pp');
  // Rest at 4%: the ratio (5.0, "+500%") is not what is printed.
  assert.equal(formatFindingDelta({ variable, effect: { absoluteDelta: 0.2, relativeDelta: 5 } }), '+20.0 pp');
});

test('a mean, a functional pass rate and a spatial pattern each print their own delta', () => {
  assert.equal(formatFindingDelta({ variable: { kind: 'test', label: 'VT', unit: 'V', measure: 'mean' }, effect: { absoluteDelta: 0.0222, relativeDelta: 0.053 } }), '+5.3%');
  assert.equal(formatFindingDelta({ variable: { kind: 'functionalTest', label: 'SCAN pass rate' }, effect: { absoluteDelta: -0.031 } }), '−3.1 pp');
  assert.equal(formatFindingDelta({ variable: { kind: 'spatialPattern', label: 'Edge-local' }, effect: { absoluteDelta: 0 } }), '—');
});

test('the report table names the statistic beside each test', () => {
  const html = findingsTableHtml(findingsOf());
  assert.match(html, /limit fail rate<\/td>/);
  assert.match(html, /mean<\/td>/);
});

test('a pattern lists the findings it explains most severe first', () => {
  const rank = { unusual: 0, notable: 1, info: 2 };
  const mk = (id, severity) => ({ id, severity, comparison: { family: 'ring', left: id }, variable: { kind: 'yield', label: 'Yield' }, effect: {} });
  const children = [mk('a', 'info'), mk('b', 'unusual'), mk('c', 'notable')];
  const pattern = { ...mk('p', 'notable'), comparison: { family: 'spatial-pattern', left: 'Edge-local' }, relatedIds: ['a', 'b', 'c'] };
  const [{ children: got }] = arrangeFindings([pattern, ...children]).patterns;
  assert.deepEqual(got.map(f => f.id), ['b', 'c', 'a']);
  for (let i = 1; i < got.length; i++) assert.ok(rank[got[i - 1].severity] <= rank[got[i].severity]);
});
