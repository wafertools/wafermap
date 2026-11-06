// stats/groupEffects: which wafers two sets of groups put together. Identical sets are one partition; a set that nearly
// matches another without being identical is an overlap, said so that the wafers are not taken to tell them apart.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mergePartitions, overlapOf, overlapping, nested } from '../dist/packages/stats/groupEffects.js';

const g = s => [...s];

test('identical groupings are one partition, whatever the groups are called', () => {
  const parts = mergePartitions([{ key: 'tester', groupOf: g('AABB') }, { key: 'handler', groupOf: ['H2', 'H2', 'H3', 'H3'] }, { key: 'operator', groupOf: g('ABAB') }]);
  assert.deepEqual(parts.map(p => p.keys), [['tester', 'handler'], ['operator']]);
});

test('two sets that match on 7 of 8 wafers overlap, on the best pairing of their groups', () => {
  assert.deepEqual(overlapOf(g('AAAABBBB'), g('XXXXXXYY'.replace('XXXXXXYY', 'XXXXXYYY'))), { agree: 7, of: 8 });
  assert.deepEqual(overlapOf(g('AAAABBBB'), g('YYYYXXXX')), { agree: 8, of: 8 }, 'identical, labels swapped');
});

test('sets that cannot be paired are not an overlap: different numbers of groups, or one inside the other', () => {
  assert.equal(overlapOf(g('AABBCCDD'), g('XXXXYYYY')), undefined, 'four groups against two');
  assert.equal(overlapOf(g('AABB'), g('XXXX')), undefined, 'a single group');
  assert.equal(nested(g('AABBCCDD'), g('XXXXYYYY')), true, 'the finer set sits inside the coarser, which is a different thing to say');
});

test('overlapping lists the near matches from strongest, and leaves out identical and distant sets', () => {
  const [tester, near, far] = mergePartitions([
    { key: 'tester', groupOf: g('AAAABBBB') }, { key: 'operator', groupOf: g('AAAABBBA') }, { key: 'shift', groupOf: g('ABABABAB') }, { key: 'handler', groupOf: g('XXXXYYYY') },
  ]);
  const found = overlapping(tester, [tester, near, far]);
  assert.deepEqual(found.map(f => [f.partition.keys[0], f.agree, f.of]), [['operator', 7, 8]]);
  assert.deepEqual(tester.keys, ['tester', 'handler'], 'the identical one is already in the set');
});
