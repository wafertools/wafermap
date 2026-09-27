// The legend filter (highlightBin / highlightMetadataValue): one value or several.
import test from 'node:test';
import assert from 'node:assert/strict';

import { buildWaferMap } from '../dist/index.js';
import { toggleHighlight, asList } from '../dist/packages/core/utils.js';
import { withView } from './fixtures/withView.mjs';

test('toggleHighlight: a click shows only that value, or clears it when it is the only one', () => {
  assert.equal(toggleHighlight(undefined, 2, false), 2);
  assert.equal(toggleHighlight(2, 2, false), undefined);
  assert.equal(toggleHighlight(2, 3, false), 3);
  assert.equal(toggleHighlight([2, 3], 3, false), 3, 'inside several, a click selects just that value');
});

test('toggleHighlight: Ctrl/Cmd+click adds or removes, and one value stays a plain value', () => {
  assert.deepEqual(toggleHighlight(2, 3, true), [2, 3]);
  assert.equal(toggleHighlight([2, 3], 2, true), 3);
  assert.equal(toggleHighlight(2, 2, true), undefined);
  assert.deepEqual(asList(undefined), []);
  assert.deepEqual(asList(4), [4]);
});

test('a filter of several bins greys only the other bins', () => {
  const results = [1, 2, 3, 4].flatMap((hbin, i) => [{ x: i, y: 0, hbin }, { x: i, y: 1, hbin }]);
  const map = buildWaferMap({ results, passBins: [1] });
  const { view } = withView(map, { plotMode: 'hardBin', highlightBin: [2, 3] });
  const fills = new Map(view.rectangles.map((r, i) => [view.dies[i].hbin, r.fill]));
  const grey = fills.get(1);
  assert.equal(fills.get(4), grey, 'bins outside the filter share the greyed fill');
  assert.notEqual(fills.get(2), grey);
  assert.notEqual(fills.get(3), grey);
  assert.notEqual(fills.get(2), fills.get(3), 'filtered bins keep their own colours');
});
