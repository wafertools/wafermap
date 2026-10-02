// The compact view moves dies and nothing else. These tests hold it to that across the
// display-convention matrix the physical view is tested against: rotation and mirroring do
// not commute, so a compact layout that skipped the grid-to-screen matrix would draw a
// correct-looking grid with the wrong dies in it.

import test from 'node:test';
import assert from 'node:assert/strict';
import { buildWaferMap } from '../dist/index.js';
import { buildCompactMap } from '../dist/packages/core/compact.js';
import { affineInvert, affineVector } from '../dist/packages/core/transforms.js';
import { compactTickIndices } from '../dist/packages/renderer/axisTicks.js';
import { withView } from './fixtures/withView.mjs';
import { mpwDies } from './fixtures/mpwLayout.mjs';

const EPS = 1e-6;

const CONFIGS = [
  ['baseline',                       {},                                    {},                   {}],
  ['xAxisDirection:left',            { xAxisDirection: 'left' },            {},                   {}],
  ['yAxisDirection:down',            { yAxisDirection: 'down' },            {},                   {}],
  ['orientation 90',                 {},                                    { orientation: 90 },  {}],
  ['orientation 270',                {},                                    { orientation: 270 }, {}],
  ['interactive rot90',              {},                                    {},                   { interactiveTransform: { rotation: 90 } }],
  ['interactive flipX',              {},                                    {},                   { interactiveTransform: { flipX: true } }],
  ['orient90 + xleft + rot90',       { xAxisDirection: 'left' },            { orientation: 90 }, { interactiveTransform: { rotation: 90 } }],
  ['orient270 + rot90 + flipY',      {},                                    { orientation: 270 }, { interactiveTransform: { rotation: 90, flipY: true } }],
];

function mpwResult(dieConfigExtra = {}, waferConfigExtra = {}) {
  return buildWaferMap({
    results: mpwDies().map((d, i) => ({ x: d.x, y: d.y, hbin: 1 + (i % 4) })),
    dieConfig: { width: 2, height: 2.4, ...dieConfigExtra },
    waferConfig: { diameter: 300, ...waferConfigExtra },
  });
}

function views(dieConfigExtra, waferConfigExtra, viewOpts) {
  const result = mpwResult(dieConfigExtra, waferConfigExtra);
  const positioned = result.dies.filter(d => d.x != null && d.y != null);
  const map = buildCompactMap(positioned);
  const physical = withView(result, viewOpts).view;
  const compact = withView(result, { ...viewOpts, compact: map }).view;
  return { physical, compact, map, positioned };
}

for (const [name, dieExtra, waferExtra, viewOpts] of CONFIGS) {
  test(`compact view, ${name}: same dies, same colours, same tallies`, () => {
    const { physical, compact } = views(dieExtra, waferExtra, viewOpts);
    assert.deepEqual(compact.dies, physical.dies);
    assert.equal(compact.rectangles.length, physical.rectangles.length);
    assert.deepEqual(compact.rectangles.map(r => r.fill), physical.rectangles.map(r => r.fill));
    assert.deepEqual(compact.rectangles.map(r => [r.width, r.height]), physical.rectangles.map(r => [r.width, r.height]));
    assert.deepEqual([...compact.binCounts], [...physical.binCounts]);
  });

  test(`compact view, ${name}: neighbours stay one die pitch apart and no two dies overlap`, () => {
    const { compact } = views(dieExtra, waferExtra, viewOpts);
    const { a, b, c, d } = compact.gridToScreen;
    const at = new Map(compact.dies.map((die, i) => [`${die.x},${die.y}`, compact.hoverPoints[i]]));
    let checked = 0;
    for (const die of compact.dies) {
      const here = at.get(`${die.x},${die.y}`);
      const right = at.get(`${die.x + 1},${die.y}`);
      if (right) {
        checked++;
        assert.ok(Math.abs(right.x - here.x - a * 2) < EPS && Math.abs(right.y - here.y - b * 2) < EPS);
      }
      const up = at.get(`${die.x},${die.y + 1}`);
      if (up) {
        checked++;
        assert.ok(Math.abs(up.x - here.x - c * 2.4) < EPS && Math.abs(up.y - here.y - d * 2.4) < EPS);
      }
    }
    assert.ok(checked > 100);
    assert.equal(new Set(compact.hoverPoints.map(p => `${p.x.toFixed(6)},${p.y.toFixed(6)}`)).size, compact.dies.length);
  });

  test(`compact view, ${name}: axis labels recover each die's original coordinates`, () => {
    // What the axis ticks do: invert the display matrix, then look the index up in the map.
    const { compact, map } = views(dieExtra, waferExtra, viewOpts);
    const inv = affineInvert(compact.gridToScreen);
    const { centreColumn, centreRow } = compact.compact;
    compact.dies.forEach((die, i) => {
      const p = compact.hoverPoints[i];
      const gx = inv.a * p.x + inv.c * p.y;
      const gy = inv.b * p.x + inv.d * p.y;
      const column = Math.round(gx / 2 + centreColumn);
      const row = Math.round(gy / 2.4 + centreRow);
      assert.equal(map.columns[column], die.x);
      assert.equal(map.rows[row], die.y);
    });
  });

  test(`compact view, ${name}: only group outlines are drawn, and the notch sits on the grid edge`, () => {
    const { compact, map } = views(dieExtra, waferExtra, viewOpts);
    assert.ok(compact.overlays.length > 0);
    assert.ok(compact.overlays.every(o => o.kind === 'compact-group' && o.closed));
    assert.equal(compact.overlays.length, map.groups.length);
    assert.equal(compact.hasReticle, false);
    assert.equal(compact.texts.filter(t => t.role === 'indicator').length, 0);
    // The existing notch arrow is placed waferRadius from waferCenter along notchDir; that must
    // be the edge of the compact grid, not a wafer circle that is no longer drawn.
    if (compact.notchDir) {
      const xs = compact.hoverPoints.map(p => p.x), ys = compact.hoverPoints.map(p => p.y);
      const tip = { x: compact.notchDir.x * compact.waferRadius, y: compact.notchDir.y * compact.waferRadius };
      const halfW = (Math.max(...xs) - Math.min(...xs)) / 2 + compact.rectangles[0].width / 2;
      const halfH = (Math.max(...ys) - Math.min(...ys)) / 2 + compact.rectangles[0].height / 2;
      assert.ok(Math.abs(tip.x) <= halfW + 1e-3 && Math.abs(tip.y) <= halfH + 1e-3, 'inside the grid box');
      const onEdge = Math.abs(Math.abs(tip.x) - halfW) < 0.2 * halfW || Math.abs(Math.abs(tip.y) - halfH) < 0.2 * halfH;
      assert.ok(onEdge, 'on the grid edge');
    }
  });
}

for (const [name, dieExtra, waferExtra, viewOpts] of CONFIGS) {
  test(`compact view, ${name}: the XY indicator names the grid axes and sits clear of the dies`, () => {
    const { compact, physical } = views(dieExtra, waferExtra, { ...viewOpts, showXYIndicator: true });
    const arrows = o => o.overlays.filter(a => a.kind === 'xy-indicator');
    assert.equal(arrows(compact).length, 2);
    // Same arrows as the wafer view: the directions come from the grid-to-screen matrix, nothing else.
    const dir = a => { const [from, to] = a.points[0]; const dx = to.x - from.x, dy = to.y - from.y; const n = Math.hypot(dx, dy); return [dx / n, dy / n]; };
    const expected = [affineVector(compact.gridToScreen, 1, 0), affineVector(compact.gridToScreen, 0, 1)];
    arrows(compact).forEach((a, i) => {
      const [dx, dy] = dir(a);
      const e = expected[i], n = Math.hypot(e.x, e.y);
      assert.ok(Math.abs(dx - e.x / n) < 1e-6 && Math.abs(dy - e.y / n) < 1e-6, `arrow ${i} points along its grid axis`);
      assert.deepEqual(dir(arrows(physical)[i]).map(v => +v.toFixed(6)), [dx, dy].map(v => +v.toFixed(6)));
    });
    assert.deepEqual(compact.texts.filter(t => t.role === 'indicator').map(t => t.text).sort(), ['+X', '+Y']);
    // No die rectangle covers either arrow end, and the viewport fits both.
    const b = compact.dieBounds;
    for (const a of arrows(compact)) for (const p of a.points[0]) {
      assert.ok(!compact.rectangles.some(r => Math.abs(p.x - r.x) < r.width / 2 && Math.abs(p.y - r.y) < r.height / 2), 'arrow end is over a die');
      const half = compact.rectangles[0];
      assert.ok(p.x >= b.minX - half.width / 2 - 1e-6 && p.x <= b.maxX + half.width / 2 + 1e-6, 'fits horizontally');
      assert.ok(p.y >= b.minY - half.height / 2 - 1e-6 && p.y <= b.maxY + half.height / 2 + 1e-6, 'fits vertically');
    }
  });
}

test('without the XY indicator the compact view reserves no margin for it', () => {
  const plain = views({}, {}, {}).compact;
  const withArrows = views({}, {}, { showXYIndicator: true }).compact;
  assert.equal(plain.overlays.filter(o => o.kind === 'xy-indicator').length, 0);
  const w = v => v.dieBounds.maxX - v.dieBounds.minX;
  assert.ok(w(withArrows) > w(plain));
});

test('the compact grid is much smaller than the wafer it replaces', () => {
  const { physical, compact } = views({}, {}, {});
  const area = v => (v.dieBounds.maxX - v.dieBounds.minX) * (v.dieBounds.maxY - v.dieBounds.minY);
  assert.ok(area(compact) < area(physical) / 3);
});

test('compact view leaves the physical view alone when no layout is given', () => {
  const result = mpwResult();
  const plain = withView(result, {}).view;
  assert.equal(plain.compact, undefined);
  assert.ok(plain.overlays.some(o => o.kind === 'wafer-boundary'));
});

// Axis labels in the compact layout: group starts, or every cell once there is room.

test('compact axis labels name the start of each group when cells are narrow', () => {
  // Three groups of four cells: starts at 0, 4 and 8, 8px cells (32px between starts), labels 30px apart at least.
  assert.deepEqual(compactTickIndices(12, [4, 8], 8, 30), [0, 4, 8]);
  // Starts too close together are thinned, never overlapped.
  assert.deepEqual(compactTickIndices(12, [4, 8], 8, 45), [0, 8]);
  assert.deepEqual(compactTickIndices(12, [4, 8], 8, 100), [0]);
});

test('compact axis labels name every cell once there is room, and thin a single group evenly', () => {
  assert.deepEqual(compactTickIndices(5, [2], 40, 30), [0, 1, 2, 3, 4]);
  assert.deepEqual(compactTickIndices(10, [], 6, 18), [0, 3, 6, 9]);
  assert.deepEqual(compactTickIndices(0, [], 6, 18), []);
});

test('on a real layout the labels sit on group starts and are far fewer than the columns', () => {
  const { map } = views({}, {}, {});
  const labelled = compactTickIndices(map.columns.length, map.columnBreaks, 8, 36);
  assert.ok(labelled.length < map.columns.length / 2);
  assert.ok(labelled.every(i => i === 0 || map.columnBreaks.includes(i)));
  assert.ok(labelled.length >= 4, 'several boundaries are named');
});
