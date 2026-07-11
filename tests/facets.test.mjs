import test from 'node:test';
import assert from 'node:assert/strict';
import { buildFacetTable, facetValueOf, FACET_NONE_VALUE } from '../dist/packages/stats/facets.js';

const item = (metadata, dieCount = 0) => ({ metadata, dieCount });

// ── facetValueOf ────────────────────────────────────────────────────────────

test('facetValueOf — reads a known metadata key', () => {
  assert.equal(facetValueOf({ lot: 'A' }, 'lot'), 'A');
});

test('facetValueOf — returns undefined when metadata is missing', () => {
  assert.equal(facetValueOf(undefined, 'lot'), undefined);
});

test('facetValueOf — returns undefined for an absent key', () => {
  assert.equal(facetValueOf({ lot: 'A' }, 'testProgram'), undefined);
});

test('facetValueOf — truncates date-curated fields to date-only', () => {
  assert.equal(facetValueOf({ testDate: '2026-06-23T14:31:00Z' }, 'testDate'), '2026-06-23');
});

test('facetValueOf — respects a custom curation override', () => {
  const curation = { widget: { label: 'Widget', date: true } };
  assert.equal(facetValueOf({ widget: '2026-01-01T00:00:00Z' }, 'widget', curation), '2026-01-01');
});

// ── buildFacetTable ───────────────────────────────────────────────────────────

test('buildFacetTable — omits fields absent across all items', () => {
  const keys = buildFacetTable([item({ lot: 'A' })]).map(f => f.key);
  assert.ok(keys.includes('lot'));
  assert.ok(!keys.includes('testProgram'));
});

test('buildFacetTable — labels curated fields and marks a single-value field non-splittable', () => {
  const table = buildFacetTable([item({ lot: 'LOT-1' }, 5), item({ lot: 'LOT-1' }, 7)]);
  const lot = table.find(f => f.key === 'lot');
  assert.equal(lot.label, 'Lot');
  assert.equal(lot.values.length, 1);
  assert.equal(lot.splittable, false);
  assert.deepEqual(lot.values[0], { value: 'LOT-1', waferCount: 2, dieCount: 12 });
});

test('buildFacetTable — marks a multi-value field splittable with correct wafer/die counts', () => {
  const table = buildFacetTable([
    item({ lot: 'A', testProgram: 'PGM' }, 10),
    item({ lot: 'A', testProgram: 'PGM' }, 20),
    item({ lot: 'B', testProgram: 'PGM' }, 5),
  ]);
  const lot = table.find(f => f.key === 'lot');
  assert.equal(lot.splittable, true);
  assert.equal(lot.values.length, 2);
  const a = lot.values.find(v => v.value === 'A');
  assert.deepEqual(a, { value: 'A', waferCount: 2, dieCount: 30 });
});

test('buildFacetTable — wafers with no value for a field fold into the (none) bucket, sorted last', () => {
  const table = buildFacetTable([
    item({ split: 'TT' }, 10),
    item({}, 5),
  ]);
  const split = table.find(f => f.key === 'split');
  assert.equal(split.values.length, 2);
  assert.equal(split.values[split.values.length - 1].value, FACET_NONE_VALUE);
});

test('buildFacetTable — facetableOnly hides a curated facet:false field by default', () => {
  const curation = { internalId: { label: 'Internal ID', facet: false } };
  const withHidden = buildFacetTable([item({ internalId: 'X' }, 1), item({ internalId: 'Y' }, 1)], { curation });
  assert.ok(!withHidden.some(f => f.key === 'internalId'));

  const shown = buildFacetTable([item({ internalId: 'X' }, 1), item({ internalId: 'Y' }, 1)], { curation, facetableOnly: false });
  assert.ok(shown.some(f => f.key === 'internalId'));
});

test('buildFacetTable — uncurated keys always pass through regardless of facetableOnly', () => {
  const table = buildFacetTable([item({ frameId: 'FR-9' }, 1)]);
  const frame = table.find(f => f.key === 'frameId');
  assert.ok(frame);
  assert.equal(frame.label, 'frameId'); // uncurated — falls back to the raw key
});

test('buildFacetTable — custom curation extends (not replaces) the built-in defaults', () => {
  const table = buildFacetTable(
    [item({ lot: 'A', widget: 'W1' }, 1)],
    { curation: { widget: { label: 'Widget' } } },
  );
  assert.ok(table.some(f => f.key === 'lot' && f.label === 'Lot')); // default curation still applies
  assert.ok(table.some(f => f.key === 'widget' && f.label === 'Widget')); // caller's extra curation applies too
});

test('buildFacetTable — waferId is excluded by default (unique per wafer, never a meaningful group-by)', () => {
  const table = buildFacetTable([
    item({ waferId: 'W01', lot: 'A' }, 1),
    item({ waferId: 'W02', lot: 'A' }, 1),
  ]);
  assert.ok(!table.some(f => f.key === 'waferId'));
});

test('buildFacetTable — waferId still appears when facetableOnly is false', () => {
  const table = buildFacetTable([
    item({ waferId: 'W01' }, 1),
    item({ waferId: 'W02' }, 1),
  ], { facetableOnly: false });
  assert.ok(table.some(f => f.key === 'waferId'));
});
