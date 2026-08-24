import test from 'node:test';
import assert from 'node:assert/strict';
import { metadataDisplayValue, metadataCategoricalValue } from '../dist/packages/core/metadata.js';

test('metadataDisplayValue — absent values resolve to undefined', () => {
  assert.equal(metadataDisplayValue(null), undefined);
  assert.equal(metadataDisplayValue(undefined), undefined);
  assert.equal(metadataDisplayValue(''), undefined);
});

test('metadataDisplayValue — falsy primitives are real values, not absences', () => {
  // The classic bug: a truthiness check drops these. 0 and false are data.
  assert.equal(metadataDisplayValue(0), '0');
  assert.equal(metadataDisplayValue(false), 'false');
  assert.equal(metadataDisplayValue(NaN), 'NaN');
});

test('metadataDisplayValue — primitives', () => {
  assert.equal(metadataDisplayValue('XJ-4471-A'), 'XJ-4471-A');
  assert.equal(metadataDisplayValue(42), '42');
  assert.equal(metadataDisplayValue(-1.5), '-1.5');
  assert.equal(metadataDisplayValue(true), 'true');
});

test('metadataDisplayValue — Date becomes ISO, so it sorts and parses in a spreadsheet', () => {
  assert.equal(metadataDisplayValue(new Date(Date.UTC(2026, 7, 24))), '2026-08-24T00:00:00.000Z');
});

test('metadataDisplayValue — objects serialise, never "[object Object]"', () => {
  // Two structurally different objects must not collapse into one
  // indistinguishable cell — that is silent data loss in an export and a
  // bogus merged bucket in a facet table.
  const a = metadataDisplayValue({ probe: 1 });
  const b = metadataDisplayValue({ probe: 2 });
  assert.equal(a, '{"probe":1}');
  assert.equal(b, '{"probe":2}');
  assert.notEqual(a, b);
  assert.equal(metadataDisplayValue([1, 2]), '[1,2]');
});

test('metadataDisplayValue — an unserialisable value reports itself rather than throwing', () => {
  const circular = {};
  circular.self = circular;
  assert.equal(metadataDisplayValue(circular), '[unserializable]');
});

test('metadataCategoricalValue — matches display mode for every primitive', () => {
  for (const v of ['a', 0, 1, false, true, -2.5, '', null, undefined]) {
    assert.equal(
      metadataCategoricalValue(v),
      metadataDisplayValue(v),
      `primitive ${String(v)} must agree across both modes`,
    );
  }
});

test('metadataCategoricalValue — non-primitives are no-data, since a swatch cannot show an object', () => {
  assert.equal(metadataCategoricalValue({ probe: 1 }), undefined);
  assert.equal(metadataCategoricalValue([1, 2]), undefined);
  assert.equal(metadataCategoricalValue(new Date()), undefined);
});
