import test from 'node:test';
import assert from 'node:assert/strict';
import { hitGridDims } from '../dist/packages/canvas-adapter/hitGrid.js';

test('hitGridDims: sane geometry keeps cells of the requested size', () => {
  // 40×40 die-index span, dies 1 unit across → cells 1.5 across.
  const g = hitGridDims(40, 40, 1.5, 1.5, 1200);
  assert.equal(g.cellW, 1.5);
  assert.equal(g.cellH, 1.5);
  assert.equal(g.nCols, Math.ceil(40 / 1.5) + 1);
  assert.equal(g.nRows, Math.ceil(40 / 1.5) + 1);
});

test('hitGridDims: an absurdly small die size cannot ask for an impossible grid', () => {
  // The shape a misread WCR produced: dies ~1e-8 across a normal span, which
  // used to request ~1e19 cells and throw "Invalid array length" on render.
  const g = hitGridDims(40, 40, 6e-8, 6e-8, 2873);
  assert.ok(g.nCols * g.nRows <= Math.max(4096, 2873 * 4), `grid of ${g.nCols}×${g.nRows}`);
  assert.doesNotThrow(() => Array.from({ length: g.nCols * g.nRows }, () => []));
});

test('hitGridDims: non-finite or non-positive inputs fall back to a usable grid', () => {
  for (const [sx, sy, w, h] of [[40, 40, 0, 0], [40, 40, NaN, Infinity], [NaN, NaN, 1, 1], [0, 0, 1, 1], [-5, 10, -1, 2]]) {
    const g = hitGridDims(sx, sy, w, h, 100);
    assert.ok(Number.isInteger(g.nCols) && g.nCols >= 1, `nCols for ${[sx, sy, w, h]}`);
    assert.ok(Number.isInteger(g.nRows) && g.nRows >= 1, `nRows for ${[sx, sy, w, h]}`);
    assert.ok(g.cellW > 0 && Number.isFinite(g.cellW) && g.cellH > 0 && Number.isFinite(g.cellH));
  }
});
