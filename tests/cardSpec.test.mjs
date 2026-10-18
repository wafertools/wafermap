// Built-in Insights cards as plots: slots filled by the tab, and Edit as plot freezing them (stats/cardSpec.ts).

import test from 'node:test';
import assert from 'node:assert/strict';
import { fillCard, freezeCard } from '../dist/packages/stats/cardSpec.js';

const DEFS = [{ testNumber: 7, name: 'Vth', unit: 'V' }, { testNumber: 8, name: 'Idsat', unit: 'A' }];
const box = { id: 'card-box', chart: 'box', fields: { x: { slot: 'groupBy' }, y: { slot: 'test' } } };

test('a card follows the section test and the Group by', () => {
  const r = fillCard(box, { test: 8, groupBy: 'split', testDefs: DEFS });
  assert.deepEqual(r.spec.fields, { x: { meta: 'split' }, y: { test: 8, name: 'Idsat' } });
  assert.equal(r.spec.chart, 'box');
});

test('the Group by slot is the wafer when Group by is off', () => {
  assert.deepEqual(fillCard(box, { test: 7, testDefs: DEFS }).spec.fields.x, { builtin: 'wafer' });
});

test('a nested X fills each level', () => {
  const r = fillCard({ ...box, fields: { x: [{ slot: 'groupBy' }, { builtin: 'ring' }], y: { slot: 'test' } } }, { test: 7, groupBy: 'lot', testDefs: DEFS });
  assert.deepEqual(r.spec.fields.x, [{ meta: 'lot' }, { builtin: 'ring' }]);
});

test('no test chosen, or one the lot lacks, is named rather than drawn', () => {
  assert.deepEqual(fillCard(box, { testDefs: DEFS }), { issue: 'Choose a test' });
  assert.deepEqual(fillCard(box, { test: 99, testDefs: DEFS }), { issue: 'Test 99 is not in this data' });
});

test('a card without slots is its own plot, and a followed colour keeps following', () => {
  const pareto = { id: 'card-pareto', chart: 'bar', fields: { x: { builtin: 'hbin' }, color: { follow: 'groupBy' } }, sort: 'value', cumulative: true };
  assert.deepEqual(fillCard(pareto, {}).spec, pareto);
});

test('Edit as plot freezes every slot and the followed colour, under a new id', () => {
  const grouped = freezeCard(box, { test: 7, groupBy: 'split', testDefs: DEFS, waferCount: 6 }, 'new');
  assert.equal(grouped.spec.id, 'new');
  assert.deepEqual(grouped.spec.fields, { x: { meta: 'split' }, y: { test: 7, name: 'Vth' }, color: { meta: 'split' } });
  assert.deepEqual(freezeCard(box, { test: 7, testDefs: DEFS, waferCount: 6 }, 'n').spec.fields.color, { builtin: 'wafer' });
  assert.deepEqual(freezeCard(box, { test: 7, testDefs: DEFS, waferCount: 1 }, 'n').spec.fields.color, { none: true });
  const coloured = { ...box, fields: { ...box.fields, color: { builtin: 'site' } } };
  assert.deepEqual(freezeCard(coloured, { test: 7, testDefs: DEFS, waferCount: 6 }, 'n').spec.fields.color, { builtin: 'site' }, 'a stated colour stays');
});
