import test from 'node:test';
import assert from 'node:assert/strict';
import { buildWaferMap, isBuiltMap } from '../dist/packages/renderer/buildWaferMap.js';

const input = {
  results: [{ x: 0, y: 0, hbin: 1 }, { x: 1, y: 0, hbin: 2 }, { x: 0, y: 1, hbin: 1 }],
  dieConfig: { width: 10, height: 10, xAxisDirection: 'left' },
};

test('isBuiltMap — a built map, spread or structured-cloned, stays built', () => {
  const built = buildWaferMap(input);
  assert.equal(isBuiltMap(built), true);
  assert.equal(isBuiltMap({ ...built, label: 'W1' }), true);
  assert.equal(isBuiltMap(structuredClone({ ...built, dies: [] })), true);
});

test('isBuiltMap — an input, or a map assembled from its pieces, is not built', () => {
  const built = buildWaferMap(input);
  assert.equal(isBuiltMap(input), false);
  assert.equal(isBuiltMap({ dies: built.dies, waferConfig: { diameter: 100 } }), false);
  assert.equal(isBuiltMap({ wafer: built.wafer, dies: built.dies }), false);
});

test('buildWaferMap — the result carries the data\'s own axis flip', () => {
  assert.deepEqual(buildWaferMap(input).dataAxisFlip, { x: true, y: false });
  assert.deepEqual(buildWaferMap({ ...input, dieConfig: { width: 10, height: 10 } }).dataAxisFlip, { x: false, y: false });
});
