// Die outlines are stroked as the union of the dies' edges, merged into the
// fewest straight segments (`outlineSegments`, canvas-adapter/toCanvas.ts), not
// as one rectangle per die: WebKit's canvas took seconds to stroke a large
// gallery rectangle by rectangle. The union must cover exactly the rectangles'
// edges: every edge drawn, nothing drawn that is not an edge.

import test from 'node:test';
import assert from 'node:assert/strict';
import { outlineSegments } from '../dist/packages/canvas-adapter/toCanvas.js';

const segs = (rects) => {
  const f = outlineSegments(rects), out = [];
  for (let i = 0; i < f.length; i += 4) out.push([f[i], f[i + 1], f[i + 2], f[i + 3]]);
  return out;
};
const close = (a, b) => Math.abs(a - b) < 1e-6;

test('a full grid becomes one line per row and column boundary', () => {
  const rects = [];
  for (let c = 0; c < 3; c++) for (let r = 0; r < 2; r++) rects.push({ x: c + 0.5, y: r + 0.5, width: 1, height: 1 });
  const s = segs(rects);
  const h = s.filter(([, y0, , y1]) => y0 === y1).map(v => v.join(',')).sort();
  const v = s.filter(([x0, , x1]) => x0 === x1).map(v => v.join(',')).sort();
  assert.deepEqual(h, ['0,0,3,0', '0,1,3,1', '0,2,3,2']);
  assert.deepEqual(v, ['0,0,0,2', '1,0,1,2', '2,0,2,2', '3,0,3,2']);
});

test('random dies with gaps and float noise: every edge covered, nothing beyond the edges', () => {
  let seed = 3; const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  for (let trial = 0; trial < 20; trial++) {
    const w = 0.7 + rand(), h = 0.4 + rand();
    const rects = [];
    for (let c = -6; c <= 6; c++) for (let r = -6; r <= 6; r++) {
      if (rand() < 0.3) continue;
      // Positions as a view computes them: products that do not land exactly.
      rects.push({ x: c * w * (1 + 1e-12 * rand()), y: r * h, width: w, height: h });
    }
    const s = segs(rects);
    const covered = (x0, y0, x1, y1) => s.some(([a, b, c, d]) =>
      (y0 === y1 && close(b, y0) && close(d, y0) && Math.min(a, c) <= x0 + 1e-6 && Math.max(a, c) >= x1 - 1e-6) ||
      (x0 === x1 && close(a, x0) && close(c, x0) && Math.min(b, d) <= y0 + 1e-6 && Math.max(b, d) >= y1 - 1e-6));
    for (const r of rects) {
      const x0 = r.x - w / 2, x1 = r.x + w / 2, y0 = r.y - h / 2, y1 = r.y + h / 2;
      assert.ok(covered(x0, y0, x1, y0) && covered(x0, y1, x1, y1), 'horizontal edges covered');
      assert.ok(covered(x0, y0, x0, y1) && covered(x1, y0, x1, y1), 'vertical edges covered');
    }
    // Every segment's midpoint lies on some rectangle's edge.
    for (const [a, b, c, d] of s) {
      const mx = (a + c) / 2, my = (b + d) / 2;
      const onEdge = rects.some(r => {
        const x0 = r.x - w / 2, x1 = r.x + w / 2, y0 = r.y - h / 2, y1 = r.y + h / 2;
        const inX = mx >= x0 - 1e-6 && mx <= x1 + 1e-6, inY = my >= y0 - 1e-6 && my <= y1 + 1e-6;
        return (inX && (close(my, y0) || close(my, y1))) || (inY && (close(mx, x0) || close(mx, x1)));
      });
      assert.ok(onEdge, `segment ${[a, b, c, d]} is not on any die edge`);
    }
    assert.ok(s.length < rects.length * 4 / 2, 'shared edges are merged');
  }
});
