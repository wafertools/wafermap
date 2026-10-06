// A pass/fail test (functional, or derived to a verdict) has an outcome per die and no value. The plot builder offers it as a
// category under Verdicts, so a chart can be coloured, compared or have its yield split by it.

import test from 'node:test';
import assert from 'node:assert/strict';
import { buildWaferMap } from '../dist/index.js';
import { fieldCatalogue, fieldsForRole, resolvePlot, fieldLabel, defaultPlot } from '../dist/packages/stats/plotData.js';

const DEFS = [
  { testNumber: 1050, name: 'Vth', unit: 'V' },
  { testNumber: 2001, name: 'Scan Chain', testType: 'F' },
];

function item(label = 'W1') {
  const r = buildWaferMap({
    results: Array.from({ length: 12 }, (_, k) => ({
      x: k % 4, y: Math.floor(k / 4), hbin: k % 3 === 0 ? 2 : 1,
      testValues: { 1050: 0.4 + k / 100 },
      // Dies 0 to 3 fail the scan chain; die 11 has no verdict at all.
      testPass: k === 11 ? {} : { 2001: k >= 4 },
    })),
    waferConfig: { diameter: 80 }, dieConfig: { width: 10, height: 10 }, passBins: [1], testDefs: DEFS,
  });
  return { label, dies: r.dies, metadata: r.metadata, passBins: [1], ringCount: r.ringCount, wafer: r.wafer };
}
const ctx = { testDefs: DEFS };

test('a functional test is offered under Verdicts, as a category named for its outcome', () => {
  const cat = fieldCatalogue([item()], ctx);
  const f = cat.find(o => 'test' in o.field && o.field.test === 2001);
  assert.ok(f, 'the scan chain is a field');
  assert.equal(f.group, 'Verdicts');
  assert.equal(f.kind, 'categorical');
  assert.equal(f.categorical, true);
  assert.match(f.label, /Scan Chain · 2001 \(pass\/fail\)/);
  assert.equal(cat.filter(o => o.group === 'Tests').length, 1, 'only the measured test is a Test');
});

test('a verdict is a Colour or Categories choice and never an axis value', () => {
  const cat = fieldCatalogue([item()], ctx);
  const names = (role, mark) => fieldsForRole(cat, mark, role).map(f => f.name);
  assert.ok(names('color', 'scatter').includes('Scan Chain'));
  assert.ok(names('x', 'bar').includes('Scan Chain'));
  assert.ok(!names('y', 'scatter').includes('Scan Chain'), 'no value to plot');
  assert.ok(!names('x', 'scatter').includes('Scan Chain'));
});

test('a verdict says so in its name wherever it is titled', () => {
  assert.equal(fieldLabel({ test: 2001, name: 'Scan Chain' }, DEFS), 'Scan Chain (pass/fail)');
  assert.equal(fieldLabel({ test: 1050, name: 'Vth' }, DEFS), 'Vth');
});

test('a bar by a verdict has a bar for Pass and one for Fail, and a die with no verdict is left out', () => {
  const r = resolvePlot({ id: 'p', chart: 'bar', fields: { x: { test: 2001, name: 'Scan Chain' }, y: { builtin: 'yield' }, color: { none: true } }, aggregate: 'yield' }, [item()], ctx);
  assert.deepEqual([...r.marks.categories].sort(), ['Fail', 'Pass']);
  assert.equal(r.issues.length, 0, `issues: ${r.issues}`);
});

test('a measured test can be compared by a verdict: a box of Vth for each outcome', () => {
  const r = resolvePlot({ id: 'p', chart: 'box', fields: { x: { test: 2001, name: 'Scan Chain' }, y: { test: 1050, name: 'Vth' }, color: { none: true } } }, [item()], ctx);
  assert.deepEqual([...r.marks.categories].sort(), ['Fail', 'Pass']);
  // Dies 0 to 3 fail, dies 4 to 10 pass, die 11 has no verdict and is in neither box.
  assert.deepEqual(r.marks.cells[0].map(values => values.length), [4, 7]);
});

test('the starting plot is still two measured tests, not a verdict', () => {
  const p = defaultPlot(fieldCatalogue([item()], ctx), 'id');
  assert.equal(p.chart, 'histogram', 'one measured test makes a histogram of it');
  assert.equal(p.fields.y.test, 1050);
});
