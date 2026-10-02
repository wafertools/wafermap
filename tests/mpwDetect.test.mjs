// The compact view is only offered for a repeating multi-project-wafer layout. There is
// no real MPW data to tune the detector on, so these synthetic layouts are the spec; the
// negative cases matter as much as the positive ones, because compacting a wafer that
// merely has holes in it could hide a real problem.

import test from 'node:test';
import assert from 'node:assert/strict';
import { detectMpwPeriod, detectMpwLayout, buildCompactMap, compactDies, compactLayoutOffered, diagnoseMpwLayout, formatMpwDiagnostics } from '../dist/packages/core/compact.js';
import {
  mpwDies, randomSparseDies, withoutColumns, fullWaferDies, occupied, GENERIC_CLUSTER, PERIOD_X, PERIOD_Y,
} from './fixtures/mpwLayout.mjs';

const block = (w, h) => Array.from({ length: w * h }, (_, i) => ({ dx: i % w, dy: Math.floor(i / w) }));

test('a clean MPW is detected with the right period on both axes', () => {
  const layout = detectMpwLayout(mpwDies());
  assert.equal(layout.offered, true);
  assert.equal(layout.x.kind, 'periodic');
  assert.equal(layout.y.kind, 'periodic');
  assert.equal(layout.x.period, PERIOD_X);
  assert.equal(layout.y.period, PERIOD_Y);
});

test('edge reticles truncated by the wafer circle do not stop detection', () => {
  for (const [radiusX, radiusY] of [[47, 44], [48, 46], [52, 41], [44, 49]]) {
    const layout = detectMpwLayout(mpwDies({ radiusX, radiusY }));
    assert.equal(layout.offered, true, `radii ${radiusX}x${radiusY}`);
    assert.equal(layout.x.period, PERIOD_X, `radii ${radiusX}x${radiusY}`);
    assert.equal(layout.y.period, PERIOD_Y, `radii ${radiusX}x${radiusY}`);
  }
});

test('the lattice position against the wafer centre does not matter', () => {
  for (let offsetX = 0; offsetX < PERIOD_X; offsetX++) {
    for (let offsetY = 0; offsetY < PERIOD_Y; offsetY += 3) {
      const layout = detectMpwLayout(mpwDies({ offsetX, offsetY }));
      assert.equal(layout.x.period, PERIOD_X, `offset ${offsetX},${offsetY}`);
      assert.equal(layout.y.period, PERIOD_Y, `offset ${offsetX},${offsetY}`);
    }
  }
});

test('1 to 5 percent random dropout inside the clusters still detects', () => {
  for (const dropout of [0.01, 0.03, 0.05]) {
    for (let seed = 1; seed <= 5; seed++) {
      const layout = detectMpwLayout(mpwDies({ dropout, seed }));
      assert.equal(layout.offered, true, `dropout ${dropout} seed ${seed}`);
      assert.equal(layout.x.period, PERIOD_X);
      assert.equal(layout.y.period, PERIOD_Y);
    }
  }
});

test('random sparse data with the same occupied fraction per axis is rejected', () => {
  for (const [columnFraction, rowFraction] of [[0.4, 0.33], [0.1, 0.1], [0.25, 0.5], [0.6, 0.6], [0.75, 0.25]]) {
    for (let seed = 1; seed <= 40; seed++) {
      const layout = detectMpwLayout(randomSparseDies({ columnFraction, rowFraction, seed }));
      assert.equal(layout.offered, false, `${columnFraction}/${rowFraction} seed ${seed}`);
    }
  }
});

test('heavy random dropout does not hide a layout that still touches every reticle column', () => {
  for (const dropout of [0.3, 0.6]) {
    for (let seed = 1; seed <= 10; seed++) {
      assert.equal(detectMpwLayout(mpwDies({ dropout, seed })).offered, true, `dropout ${dropout} seed ${seed}`);
    }
  }
});

test('a few whole reticle columns missing still detects, many missing does not', () => {
  const clean = mpwDies();
  let few = 0;
  for (let seed = 1; seed <= 20; seed++) {
    if (detectMpwLayout(withoutColumns(clean, 0.05, seed)).x.period === PERIOD_X) few++;
  }
  assert.ok(few >= 18, `${few}/20 detected with 5% of columns missing`);
  for (let seed = 1; seed <= 20; seed++) {
    assert.equal(detectMpwLayout(withoutColumns(clean, 0.5, seed)).offered, false, `seed ${seed}`);
  }
});

test('a fully populated wafer is not offered', () => {
  const layout = detectMpwLayout(fullWaferDies());
  assert.equal(layout.offered, false);
  assert.equal(layout.x.kind, 'dense');
  assert.equal(layout.y.kind, 'dense');
});

test('a single occupied column or row is rejected', () => {
  const column = mpwDies({ cluster: [{ dx: 0, dy: 0 }], periodX: 200 });
  assert.equal(detectMpwLayout(column).offered, false);
  const row = mpwDies({ cluster: [{ dx: 0, dy: 0 }], periodY: 200 });
  assert.equal(detectMpwLayout(row).offered, false);
});

test('a different product at different offsets in the reticle is detected', () => {
  // The reticle holds several products; the file carries only one of them.
  const layout = detectMpwLayout(mpwDies({ cluster: [{ dx: 5, dy: 4 }, { dx: 6, dy: 4 }, { dx: 5, dy: 5 }] }));
  assert.equal(layout.offered, true);
  assert.equal(layout.x.period, PERIOD_X);
  assert.equal(layout.y.period, PERIOD_Y);
});

test('period 1 or near-full occupancy is not offered', () => {
  // Nearly every column and row holds a die: nothing to compact.
  const nearFull = detectMpwLayout(mpwDies({ periodX: PERIOD_X, periodY: PERIOD_Y, cluster: block(PERIOD_X - 1, PERIOD_Y - 1) }));
  assert.equal(nearFull.offered, false);
  assert.equal(detectMpwPeriod(Array.from({ length: 60 }, (_, i) => i)), null);
});

test('a layout sparse in one direction only is offered', () => {
  // Every row is occupied, columns repeat: still worth removing the empty columns.
  const layout = detectMpwLayout(mpwDies({ periodY: 1, cluster: [...Array(4)].map((_, dx) => ({ dx, dy: 0 })) }));
  assert.equal(layout.x.kind, 'periodic');
  assert.equal(layout.y.kind, 'dense');
  assert.equal(layout.offered, true);
});

test('a layout that spans too few repeats is rejected', () => {
  // Two reticles across: not a pattern, just two blobs.
  const layout = detectMpwLayout(mpwDies({ radiusX: 12, radiusY: 12 }));
  assert.equal(layout.offered, false);
});

test('the lone metadata-only die keeps its row occupied', () => {
  // Every reticle's third row holds only one die. Occupancy is by existence,
  // so that row is part of the pattern and the cluster is three rows tall, not two.
  const dies = mpwDies();
  const rows = occupied(dies, 'y');
  const cluster = GENERIC_CLUSTER.map(c => c.dy);
  assert.equal(Math.max(...cluster) + 1, 3);
  const period = detectMpwPeriod(rows);
  assert.equal(period.period, PERIOD_Y);
  // Three occupied rows per reticle: occupancy 3/PERIOD_Y over the span.
  assert.ok(Math.abs(period.occupiedFraction - 3 / PERIOD_Y) < 0.05, `${period.occupiedFraction}`);
});

test('the result reports what was found, for diagnostics', () => {
  const period = detectMpwPeriod(occupied(mpwDies(), 'x'));
  assert.equal(period.period, PERIOD_X);
  assert.ok(period.score >= 0.75 && period.score <= 1);
  assert.ok(period.repeats >= 3);
  assert.ok(period.occupiedFraction > 0 && period.occupiedFraction < 0.8);
});

test('indices in any order, and with duplicates, give the same answer', () => {
  const xs = occupied(mpwDies(), 'x');
  const scrambled = [...xs, ...xs].sort(() => 0.5 - Math.random());
  assert.deepEqual(detectMpwPeriod(scrambled), detectMpwPeriod(xs));
});

test('unpositioned dies are ignored and empty input offers nothing', () => {
  const dies = [...mpwDies(), { id: 'a' }, { id: 'b', x: null, y: null }];
  assert.equal(detectMpwLayout(dies).offered, true);
  assert.equal(detectMpwLayout([]).offered, false);
  assert.equal(detectMpwPeriod([]), null);
});

// A host that knows its reticle can say so, but the check still has to pass.

test('a supplied reticle that matches the layout is offered', () => {
  const layout = detectMpwLayout(mpwDies(), { reticle: { width: PERIOD_X, height: PERIOD_Y } });
  assert.equal(layout.offered, true);
  assert.equal(layout.x.period, PERIOD_X);
  assert.equal(layout.y.period, PERIOD_Y);
});

test('a supplied reticle that the layout does not repeat at is not offered', () => {
  // Right layout, wrong claim: the occupied columns do not repeat every 5.
  const layout = detectMpwLayout(mpwDies(), { reticle: { width: 5, height: PERIOD_Y } });
  assert.equal(layout.offered, false);
  assert.equal(layout.x.kind, 'none');
});

test('a supplied reticle does not make random sparse data eligible', () => {
  for (let seed = 1; seed <= 20; seed++) {
    const layout = detectMpwLayout(randomSparseDies({ seed }), { reticle: { width: PERIOD_X, height: PERIOD_Y } });
    assert.equal(layout.offered, false, `seed ${seed}`);
  }
});

test('a reticle holding the pattern twice still passes at the reticle size', () => {
  // The cluster repeats every PERIOD_X columns, so a reticle twice that wide contains it twice.
  const layout = detectMpwLayout(mpwDies(), { reticle: { width: 2 * PERIOD_X, height: 2 * PERIOD_Y } });
  assert.equal(layout.offered, true);
  assert.equal(layout.x.period, 2 * PERIOD_X);
});

test('devices on every second reticle are offered with the reticle size supplied', () => {
  // The user's product sits on alternate reticle columns: the dies repeat at twice the reticle width.
  const dies = mpwDies({ periodX: 2 * PERIOD_X });
  const layout = detectMpwLayout(dies, { reticle: { width: PERIOD_X, height: PERIOD_Y } });
  assert.equal(layout.offered, true);
  assert.equal(layout.x.period, 2 * PERIOD_X, 'the period is two reticles');
  assert.equal(layout.y.period, PERIOD_Y);
  // and without a reticle the same period is inferred
  assert.equal(detectMpwLayout(dies).x.period, 2 * PERIOD_X);
  // every second reticle in y as well
  const sparse = detectMpwLayout(mpwDies({ periodX: 2 * PERIOD_X, periodY: 2 * PERIOD_Y }), { reticle: { width: PERIOD_X, height: PERIOD_Y } });
  assert.equal(sparse.offered, true);
  assert.equal(sparse.y.period, 2 * PERIOD_Y);
});

test('the compact layout of devices on alternate reticles has no empty reticle columns', () => {
  const dies = mpwDies({ periodX: 2 * PERIOD_X, radiusX: 80 });
  const map = buildCompactMap(dies);
  // only the product's own columns remain, so no skipped range is a whole empty reticle plus its gaps
  const widest = Math.max(...map.groups.map(g => g.columns[1] - g.columns[0]));
  assert.equal(widest, 5);
  assert.ok(map.columns.length < dies.length / 10);
});

// compactDies: the layout the compact view is drawn from.


test('compaction keeps exactly the occupied columns and rows, in order', () => {
  const dies = mpwDies();
  const map = buildCompactMap(dies);
  assert.deepEqual([...map.columns], occupied(dies, 'x'));
  assert.deepEqual([...map.rows], occupied(dies, 'y'));
  assert.ok(map.columns.length < 60 && map.rows.length < 55, 'far smaller than the wafer grid');
});

test('every die maps back to its own original position', () => {
  const dies = mpwDies();
  const { placements, map } = compactDies(dies);
  assert.equal(placements.length, dies.length);
  for (const { die, column, row } of placements) {
    assert.equal(map.columns[column], die.x);
    assert.equal(map.rows[row], die.y);
  }
});

test('no two dies share a compact cell', () => {
  const { placements } = compactDies(mpwDies());
  const cells = new Set(placements.map(p => `${p.column},${p.row}`));
  assert.equal(cells.size, placements.length);
});

test('dies keep their order and spacing within a group', () => {
  // Compaction removes gaps between groups, never inside one: two dies that were
  // neighbours stay neighbours.
  const { placements } = compactDies(mpwDies());
  const at = new Map(placements.map(p => [`${p.die.x},${p.die.y}`, p]));
  for (const { die, column, row } of placements) {
    const right = at.get(`${die.x + 1},${die.y}`);
    if (right) assert.equal(right.column, column + 1);
    const above = at.get(`${die.x},${die.y + 1}`);
    if (above) assert.equal(above.row, row + 1);
  }
});

test('breaks mark exactly where original indices were skipped', () => {
  const map = buildCompactMap(mpwDies());
  for (const axis of [['columns', 'columnBreaks'], ['rows', 'rowBreaks']]) {
    const [values, breaks] = [map[axis[0]], map[axis[1]]];
    const expected = [];
    for (let i = 1; i < values.length; i++) if (values[i] - values[i - 1] > 1) expected.push(i);
    assert.deepEqual([...breaks], expected);
    assert.ok(breaks.length >= 5, `${axis[0]}: one break per reticle gap`);
  }
});

test('a die with no bin keeps its row and column', () => {
  // The lone metadata-only die of each reticle: it exists, so its row is part of the layout
  // whether or not any bin is recorded there. Every reticle's third row is that die alone.
  const dies = mpwDies();
  const withAndWithout = dies.map(d => (d.y % 2 ? { ...d, hbin: 1 } : { x: d.x, y: d.y }));
  const lone = dies.filter(d => ((d.y - 2) % PERIOD_Y + PERIOD_Y) % PERIOD_Y === 2);
  assert.ok(lone.length > 0);
  const kept = buildCompactMap(withAndWithout);
  assert.deepEqual([...kept.rows], [...buildCompactMap(dies).rows]);
  assert.deepEqual([...kept.columns], [...buildCompactMap(dies).columns]);
  for (const d of lone) assert.notEqual(kept.rowOf(d.y), undefined);
});

test('wafers in a selection share one grid when built from the union', () => {
  const a = mpwDies({ seed: 1, dropout: 0.5 });
  const b = mpwDies({ seed: 2, dropout: 0.5 });
  const union = buildCompactMap([...a, ...b]);
  const pa = compactDies(a, union);
  const pb = compactDies(b, union);
  assert.equal(pa.map, pb.map);
  const cell = ({ die }) => `${die.x},${die.y}`;
  const colOf = new Map([...pa.placements, ...pb.placements].map(p => [cell(p), p.column]));
  for (const p of [...pa.placements, ...pb.placements]) assert.equal(colOf.get(cell(p)), p.column);
});

test('a die outside the supplied layout throws rather than being dropped', () => {
  const layout = buildCompactMap([{ x: 0, y: 0 }]);
  assert.throws(() => compactDies([{ x: 5, y: 0 }], layout), RangeError);
  assert.throws(() => compactDies([{ x: 0, y: 5 }], [{ x: 0, y: 0 }]), RangeError);
});

test('unpositioned dies are not placed, and nothing compacts to nothing', () => {
  const { placements } = compactDies([{ id: 'a' }, { x: 3, y: 4 }, { x: null, y: null }]);
  assert.equal(placements.length, 1);
  assert.equal(placements[0].column, 0);
  const empty = compactDies([]);
  assert.deepEqual(empty.placements, []);
  assert.deepEqual([...empty.map.columns], []);
  assert.equal(empty.map.columnOf(0), undefined);
});

test('negative and unsorted coordinates are renumbered from zero in ascending order', () => {
  const map = buildCompactMap([{ x: 40, y: -7 }, { x: -12, y: 3 }, { x: 40, y: 3 }]);
  assert.deepEqual([...map.columns], [-12, 40]);
  assert.deepEqual([...map.rows], [-7, 3]);
  assert.equal(map.columnOf(-12), 0);
  assert.equal(map.rowOf(3), 1);
  assert.deepEqual([...map.columnBreaks], [1]);
});

test('groups are the blocks that hold dies, one per reticle cell, with no skipped index inside', () => {
  const dies = mpwDies();
  const map = buildCompactMap(dies);
  const key = g => `${g.columns},${g.rows}`;
  assert.equal(new Set(map.groups.map(key)).size, map.groups.length, 'no duplicate groups');
  const { placements } = compactDies(dies, map);
  // every die sits in exactly one group, and every group holds a die
  for (const p of placements) {
    const hits = map.groups.filter(g => p.column >= g.columns[0] && p.column < g.columns[1]
      && p.row >= g.rows[0] && p.row < g.rows[1]);
    assert.equal(hits.length, 1);
  }
  for (const g of map.groups) {
    assert.ok(placements.some(p => p.column >= g.columns[0] && p.column < g.columns[1]
      && p.row >= g.rows[0] && p.row < g.rows[1]), `group ${key(g)} is empty`);
    for (const [start, end] of [g.columns, g.rows]) assert.ok(end > start);
  }
  // no break falls inside a group
  for (const g of map.groups) {
    assert.ok(![...map.columnBreaks].some(b => b > g.columns[0] && b < g.columns[1]));
    assert.ok(![...map.rowBreaks].some(b => b > g.rows[0] && b < g.rows[1]));
  }
  // a full reticle is a block of the cluster's size
  const widths = map.groups.map(g => g.columns[1] - g.columns[0]);
  assert.equal(Math.max(...widths), 5);
});

test('a layout with no gaps is a single group', () => {
  const map = buildCompactMap([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }]);
  assert.deepEqual(map.groups.map(g => [...g.columns, ...g.rows]), [[0, 2, 0, 2]]);
});

test('the offer rule shared by the single map and the gallery', () => {
  const dies = mpwDies();
  assert.equal(compactLayoutOffered(dies, [undefined]), true);
  const same = { width: PERIOD_X, height: PERIOD_Y };
  assert.equal(compactLayoutOffered(dies, [same, { ...same }]), true);
  // One map without a reticle, or maps that disagree, fall back to detecting the period.
  assert.equal(compactLayoutOffered(dies, [same, undefined]), true);
  assert.equal(compactLayoutOffered(dies, [same, { width: 5, height: PERIOD_Y }]), true);
  // A reticle every map agrees on must still be repeated by the dies.
  assert.equal(compactLayoutOffered(dies, [{ width: 5, height: PERIOD_Y }]), false);
  assert.equal(compactLayoutOffered(randomSparseDies(), [same]), false);
  assert.equal(compactLayoutOffered([], []), false);
});

// Diagnostics: what a user is asked to send back, since their data cannot be shared.

test('diagnostics agree with the gate and report the period and its score', () => {
  const dies = mpwDies();
  const d = diagnoseMpwLayout(dies, [undefined]);
  assert.equal(d.offered, compactLayoutOffered(dies, [undefined]));
  assert.equal(d.columns.pattern.period, PERIOD_X);
  assert.equal(d.rows.pattern.period, PERIOD_Y);
  assert.equal(d.positionedDies, dies.length);
  assert.ok(d.groups > 10);
  assert.equal(d.columns.bestPeriods[0].period, PERIOD_X);
  assert.ok(d.columns.bestPeriods.length <= 5);
  assert.equal(diagnoseMpwLayout(randomSparseDies(), [undefined]).offered, false);
});

test('diagnostics explain a rejection', () => {
  const d = diagnoseMpwLayout(randomSparseDies(), [undefined]);
  assert.equal(d.columns.pattern.kind, 'none');
  assert.ok(d.columns.bestPeriods[0].score < 0.75, 'the best candidate is below the threshold');
  assert.equal(diagnoseMpwLayout(fullWaferDies(), [undefined]).columns.pattern.kind, 'dense');
  const empty = diagnoseMpwLayout([], []);
  assert.equal(empty.offered, false);
  assert.equal(empty.columns.occupied, 0);
});

test('diagnostics carry no position: sliding every die leaves the text unchanged', () => {
  const dies = mpwDies();
  const text = formatMpwDiagnostics(diagnoseMpwLayout(dies, [undefined]), '9.9.9');
  const moved = dies.map(d => ({ x: d.x + 1000, y: d.y - 371 }));
  assert.equal(formatMpwDiagnostics(diagnoseMpwLayout(moved, [undefined]), '9.9.9'), text);
  // and nothing in it is a coordinate or an identity
  assert.ok(!/\b1000\b|\b371\b|\bLOT/.test(text));
  assert.match(text, /^wafermap compact-layout diagnostics/);
  assert.match(text, /library: 9\.9\.9/);
  assert.match(text, /columns: \d+ occupied of \d+ \(\d+\.\d%\), \d+ runs; periodic, period 12/);
});

test('diagnostics name a reticle only when every wafer supplies the same one', () => {
  const dies = mpwDies();
  const same = { width: PERIOD_X, height: PERIOD_Y };
  assert.deepEqual(diagnoseMpwLayout(dies, [same, same]).reticle, same);
  assert.equal(diagnoseMpwLayout(dies, [same, undefined]).reticle, undefined);
  assert.equal(diagnoseMpwLayout(dies, [same, same]).wafers, 2);
});
