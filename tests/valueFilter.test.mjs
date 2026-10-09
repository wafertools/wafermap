// The value filter: values outside a limit set are treated as missing, counted, and kept for the tooltip.
// Only values change: bins and recorded verdicts are the tester's own.

import test from 'node:test';
import assert from 'node:assert/strict';
import { buildWaferMap } from '../dist/index.js';
import { testValue, excludedValue } from '../dist/packages/core/dieTable.js';

// Five dies on test 1: one tester clamp (9.99e9), one ordinary out-of-spec reading, three in spec.
const VALUES = [1.0, 1.2, 9.99e9, 2.6, 1.1];
const build = (extra = {}, defExtra = {}) => buildWaferMap({
  results: VALUES.map((v, i) => ({ x: i - 2, y: 0, hbin: 1, testValues: { 1: v }, testPass: { 1: v < 2 } })),
  waferConfig: { diameter: 80 }, dieConfig: { width: 10, height: 10 },
  testDefs: [{ testNumber: 1, name: 'Vth', unit: 'V', validLow: -100, validHigh: 100, specLow: 0.5, specHigh: 2.5, limitLow: 0, limitHigh: 3, ...defExtra }],
  ...extra,
});
const dieAt = (r, x) => r.dies.find(d => d.x === x);

test('validity limits are the default: a clamped value becomes no value, and is counted', () => {
  const r = build();
  assert.equal(testValue(dieAt(r, 0), 1), undefined);
  assert.equal(excludedValue(dieAt(r, 0), 1), 9.99e9, 'the excluded value is kept for the tooltip');
  assert.equal(testValue(dieAt(r, 1), 1), 2.6, 'an out-of-spec reading inside the validity limits stays');
  assert.deepEqual(r.valueFilter, { mode: 'validity', tests: [{ testNumber: 1, excluded: 1, total: 5 }] });
  const w = r.warnings.find(x => x.code === 'values-excluded');
  assert.ok(w && /1 value outside the validity limits/.test(w.message), w?.message);
});

test('bins and the recorded verdict are left as the tester gave them', () => {
  const r = build();
  assert.equal(dieAt(r, 0).hbin, 1);
  assert.equal(dieAt(r, 0).testPass[1], false, 'the tester said fail for 9.99e9, and that is what is recorded');
  assert.equal(r.yield.yieldPercent, 100);
});

test('no validity limits, or valueFilter none: nothing is excluded and no summary is carried', () => {
  assert.equal(build({}, { validLow: undefined, validHigh: undefined }).valueFilter, undefined);
  const r = build({ valueFilter: 'none' });
  assert.equal(testValue(dieAt(r, 0), 1), 9.99e9);
  assert.equal(r.valueFilter, undefined);
  assert.equal(r.warnings.some(x => x.code === 'values-excluded'), false);
});

test('spec and test limits can be the filter too', () => {
  const spec = build({ valueFilter: 'spec' });
  assert.deepEqual(spec.valueFilter.tests, [{ testNumber: 1, excluded: 2, total: 5 }]);
  assert.equal(testValue(dieAt(spec, 1), 1), undefined, '2.6 is above the 2.5 spec limit');
  const test_ = build({ valueFilter: 'test' });
  assert.deepEqual(test_.valueFilter.tests, [{ testNumber: 1, excluded: 1, total: 5 }]);
  assert.equal(test_.valueFilter.mode, 'test');
});

test('an inclusive-off test limit excludes a value equal to the limit', () => {
  const r = build({ valueFilter: 'test' }, { limitHigh: 2.6, limitHighInclusive: false });
  assert.equal(testValue(dieAt(r, 1), 1), undefined);
});

test('a derived test never sees the clamped reading', () => {
  const r = build({ derivedTests: [{ testNumber: 900001, name: 'Double', expression: 't[1] * 2' }] });
  assert.equal(testValue(dieAt(r, 0), 900001), undefined, 'no value in, no value out');
  assert.equal(testValue(dieAt(r, -2), 900001), 2);
});

test('a lot sums the exclusions over its wafers', () => {
  const wafer = () => VALUES.map((v, i) => ({ x: i - 2, y: 0, hbin: 1, testValues: { 1: v } }));
  const r = buildWaferMap({
    waferConfig: { diameter: 80 }, dieConfig: { width: 10, height: 10 },
    testDefs: [{ testNumber: 1, name: 'Vth', validHigh: 100 }],
    lotStack: { results: [wafer(), wafer()], method: 'mean' },
  });
  assert.deepEqual(r.valueFilter.tests, [{ testNumber: 1, excluded: 2, total: 10 }]);
});

test('the tooltip says why a die is grey, with the excluded value and the limit set', async () => {
  const { buildHoverText } = await import('../dist/packages/renderer/buildView.js');
  const r = build();
  const text = buildHoverText(dieAt(r, 0), 'value', { testDefs: r.testDefs, activeTest: 1 });
  assert.match(text, /outside validity limits, excluded/);
  assert.match(text, /Vth/);
  const spec = build({ valueFilter: 'spec' });
  assert.match(buildHoverText(dieAt(spec, 1), 'value', { testDefs: spec.testDefs, activeTest: 1 }), /outside specification limits, excluded/);
});

test('a plot footnote and the capability data state the excluded count', async () => {
  const { resolvePlot, plotFootnote } = await import('../dist/packages/stats/plotData.js');
  const { buildCapabilityData } = await import('../dist/packages/stats/capability.js');
  const r = build();
  const resolved = resolvePlot({ id: 'p', chart: 'histogram', fields: { y: { test: 1 } } }, [{ dies: r.dies, wafer: r.wafer, passBins: r.passBins, ringCount: r.ringCount }], { testDefs: r.testDefs });
  assert.ok(resolved.excluded, JSON.stringify(resolved.issues));
  assert.match(plotFootnote(resolved), /1 Vth value outside validity limits excluded/);
  const cap = buildCapabilityData([{ dies: r.dies }], r.testDefs);
  assert.deepEqual(cap[0].excluded, { count: 1, limitSet: 'validity' });
  assert.equal(cap[0].n, 4);
});
