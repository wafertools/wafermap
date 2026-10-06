// Wafer attributes (lot, product, a host's own columns) are named and offered by ONE curation: the host's `attributes`
// over the defaults. Group by, the plot fields, the Wafers table, the strip and the reports ask the same function.

import test from 'node:test';
import assert from 'node:assert/strict';
import { buildWaferMap } from '../dist/index.js';
import { attributeLabel, buildFacetTable, facetValueOf } from '../dist/packages/stats/facets.js';
import { fieldCatalogue } from '../dist/packages/stats/plotData.js';
import { buildMetadataRows } from '../dist/packages/stats/reportHtml.js';

function item(label, meta) {
  const r = buildWaferMap({
    results: Array.from({ length: 6 }, (_, k) => ({ x: k, y: 0, hbin: 1 })),
    waferConfig: { diameter: 80, metadata: meta }, dieConfig: { width: 10, height: 10 }, passBins: [1],
  });
  return { label, dies: r.dies, metadata: r.metadata, passBins: [1], ringCount: r.ringCount, wafer: r.wafer };
}
const wafers = () => [
  item('W1', { lot: 'A', testProgram: 'P1', jobRev: 'r1', testDate: '2026-01-01T09:00:00Z', waferId: 1 }),
  item('W2', { lot: 'B', testProgram: 'P2', jobRev: 'r2', testDate: '2026-01-01T17:30:00Z', waferId: 2 }),
];
const fieldLabels = (items, ctx) => fieldCatalogue(items, ctx).filter(f => 'meta' in f.field).map(f => f.label);

test('an attribute is named by the host first, then the defaults, then spelled out', () => {
  assert.equal(attributeLabel('lot'), 'Lot');
  assert.equal(attributeLabel('testProgram'), 'Test Program');
  assert.equal(attributeLabel('jobRev'), 'Job Rev', 'an uncurated key is spelled out');
  assert.equal(attributeLabel('jobRev', { jobRev: { label: 'Program rev' } }), 'Program rev');
  assert.equal(attributeLabel('lot', { jobRev: { label: 'Program rev' } }), 'Lot', 'a host entry for another key leaves the defaults alone');
  assert.equal(attributeLabel('lot', { lot: { label: 'Lot ID' } }), 'Lot ID');
});

test('the plot fields offer an attribute under the same name and leave out one the host marks not groupable', () => {
  const ws = wafers();
  assert.deepEqual(fieldLabels(ws, {}).sort(), ['Job Rev', 'Lot', 'Test Date', 'Test Program'], 'defaults');
  const curation = { jobRev: { label: 'Program rev', facet: false }, lot: { label: 'Lot ID' } };
  const labels = fieldLabels(ws, { curation });
  assert.ok(labels.includes('Lot ID') && !labels.includes('Lot'));
  assert.ok(!labels.includes('Program rev') && !labels.includes('Job Rev'), 'facet: false keeps it out of the field list');
  assert.ok(!labels.includes('Wafer Id'), 'a per-wafer identity is not a field: the Wafer field already is that');
});

test('Group by and a plot field are the same list: the facet table is what both read', () => {
  const ws = wafers();
  const curation = { jobRev: { label: 'Program rev', facet: false }, lot: { label: 'Lot ID' } };
  const table = buildFacetTable(ws.map(w => ({ metadata: w.metadata })), { facetableOnly: true, curation }).map(f => f.label).sort();
  assert.deepEqual(table, fieldLabels(ws, { curation }).sort());
});

test('a date attribute the host declares groups by day, not by timestamp', () => {
  const [a, b] = wafers();
  assert.equal(facetValueOf(a.metadata, 'startedAt', { startedAt: { label: 'Started', date: true } }), undefined, 'absent stays absent');
  const meta = { startedAt: '2026-01-01T09:00:00Z' };
  assert.equal(facetValueOf(meta, 'startedAt', { startedAt: { label: 'Started', date: true } }), '2026-01-01');
  assert.equal(facetValueOf(meta, 'startedAt', {}), '2026-01-01T09:00:00Z', 'without the declaration it is the full value');
  assert.equal(facetValueOf(a.metadata, 'testDate'), '2026-01-01');
  assert.equal(facetValueOf(b.metadata, 'testDate'), '2026-01-01', 'the default date field groups by day');
});

test('the report names an attribute the way Group by does', () => {
  const rows = buildMetadataRows(wafers().map(w => ({ metadata: w.metadata })));
  const labels = rows.map(r => r.label);
  assert.ok(labels.includes('Test Program') && labels.includes('Lot'), `got ${labels}`);
});
