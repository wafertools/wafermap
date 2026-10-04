// Resolving a saved plot over a population of wafers (stats/plotData.ts): the data each mark draws, the level
// rules, pooled yield, and the reasons a plot cannot be drawn.

import test from 'node:test';
import assert from 'node:assert/strict';
import { buildWaferMap } from '../dist/index.js';
import { resolvePlot, plotFootnote, plotTitle, combine } from '../dist/packages/stats/plotData.js';

const DEFS = [
  { testNumber: 1050, name: 'Vth', unit: 'V' },
  { testNumber: 1060, name: 'Idsat', unit: 'A' },
];

/** A wafer of `n` dies, the first `pass` in bin 1 and the rest in bin 2. Vth is `vth0 + k/100`; Idsat is absent for the first `noIdsat` dies. */
function wafer(label, { n = 10, pass = 9, vth0 = 0.4, idsat = 1, noIdsat = 0, meta = {} } = {}) {
  const r = buildWaferMap({
    results: Array.from({ length: n }, (_, k) => ({
      x: k % 6, y: Math.floor(k / 6), hbin: k < pass ? 1 : 2,
      testValues: k < noIdsat ? { 1050: vth0 + k / 100 } : { 1050: vth0 + k / 100, 1060: idsat * (k + 1) },
    })),
    waferConfig: { diameter: 80, metadata: meta },
    dieConfig: { width: 1, height: 1 },
    passBins: [1], testDefs: DEFS,
  });
  return { label, dies: r.dies, metadata: r.metadata, passBins: [1], wafer: r.wafer };
}

const lot = () => [
  wafer('W1', { n: 10, pass: 9, vth0: 0.40, meta: { split: 'TT', temperature: 25 } }),
  wafer('W2', { n: 20, pass: 10, vth0: 0.45, noIdsat: 4, meta: { split: 'FF', temperature: 25 } }),
  wafer('W3', { n: 10, pass: 5, vth0: 0.50, meta: { split: 'TT', temperature: 85 } }),
];
const ctx = { testDefs: DEFS, passBins: [1] };
const spec = (mark, encoding, over = {}) => ({ id: 'p', mark, encoding, ...over });
const T = (n, name) => ({ test: n, name });

test('combine: each way of reducing a set, ignoring missing values', () => {
  const v = [1, 2, 3, 10, NaN];
  assert.equal(combine(v, 'mean'), 4);
  assert.equal(combine(v, 'median'), 2.5);
  assert.equal(combine(v, 'min'), 1);
  assert.equal(combine(v, 'max'), 10);
  assert.equal(combine(v, 'sum'), 16);
  assert.equal(combine(v, 'count'), 4);
  assert.ok(Number.isNaN(combine([], 'mean')));
  assert.equal(combine([], 'count'), 0);
});

test('scatter at die level: one point per die with both values, the missing ones counted', () => {
  const r = resolvePlot(spec('scatter', { x: T(1050, 'Vth'), y: T(1060, 'Idsat'), color: { none: true } }), lot(), ctx);
  assert.deepEqual(r.issues, []);
  assert.equal(r.level, 'die');
  assert.equal(r.marks.type, 'scatter');
  assert.equal(r.marks.points.length, 40 - 4);
  assert.equal(r.plotted, 36);
  assert.deepEqual(r.omitted, [{ field: 'Idsat', count: 4 }]);
  assert.deepEqual(r.population, { wafers: 3, dies: 40 });
  assert.deepEqual(r.groups, ['']);
  const p = r.marks.points[0];
  assert.ok(p.die && p.item === 0);
  assert.equal(r.x.label, 'Vth (V)');
  assert.equal(r.y.label, 'Idsat (A)');
  assert.equal(r.autoTitle, 'Idsat vs Vth');
});

test('a die carries the wafer it is on (item) so a click can open it', () => {
  const r = resolvePlot(spec('scatter', { x: T(1050), y: T(1060), color: { none: true } }), lot(), ctx);
  const items = new Set(r.marks.points.map(p => p.item));
  assert.deepEqual([...items].sort(), [0, 1, 2]);
});

test('colour follows the wafer when there is more than one and no tab grouping', () => {
  const r = resolvePlot(spec('scatter', { x: T(1050), y: T(1060) }), lot(), ctx);
  assert.deepEqual(r.groups, ['W1', 'W2', 'W3']);
  assert.equal(r.colorLabel, 'Wafer');
  assert.equal(r.autoTitle, 'Idsat vs Vth · by Wafer');
  const one = resolvePlot(spec('scatter', { x: T(1050), y: T(1060) }), [lot()[0]], ctx);
  assert.deepEqual(one.groups, ['']);
});

test("colour follows the tab's Group by when there is one, and a plot's own field beats it", () => {
  const follow = resolvePlot(spec('scatter', { x: T(1050), y: T(1060) }), lot(), { ...ctx, groupBy: 'split' });
  assert.deepEqual(follow.groups, ['FF', 'TT']);
  const own = resolvePlot(spec('scatter', { x: T(1050), y: T(1060), color: { meta: 'temperature' } }), lot(), { ...ctx, groupBy: 'split' });
  assert.deepEqual(own.groups, ['25', '85']);
  const none = resolvePlot(spec('scatter', { x: T(1050), y: T(1060), color: { none: true } }), lot(), { ...ctx, groupBy: 'split' });
  assert.deepEqual(none.groups, ['']);
  const explicit = resolvePlot(spec('scatter', { x: T(1050), y: T(1060), color: { follow: 'groupBy' } }), lot(), { ...ctx, groupBy: 'split' });
  assert.deepEqual(explicit.groups, ['FF', 'TT']);
});

test('a followed Group by that no wafer has is quietly absent, a named one is an issue', () => {
  const quiet = resolvePlot(spec('scatter', { x: T(1050), y: T(1060), color: { none: true } }), lot(), { ...ctx, groupBy: 'nope' });
  assert.deepEqual(quiet.issues, []);
  const named = resolvePlot(spec('scatter', { x: T(1050), y: T(1060), color: { meta: 'nope' } }), lot(), ctx);
  assert.match(named.issues[0], /No wafer has a "Nope" value/);
});

test('level wafer: die-level values are aggregated per wafer, and the plot says so', () => {
  const r = resolvePlot(spec('scatter', { x: T(1050), y: T(1060), color: { none: true } }, { level: 'wafer', aggregate: 'median' }), lot(), ctx);
  assert.equal(r.level, 'wafer');
  assert.equal(r.marks.points.length, 3);
  assert.equal(r.population.wafers, 3);
  // W1: Vth 0.40..0.49 -> median 0.445
  assert.ok(Math.abs(r.marks.points[0].x - 0.445) < 1e-9);
  assert.match(r.aggregation, /median of Vth per wafer/);
  assert.match(plotFootnote(r), /3 wafers · 40 dies · median of Vth per wafer/);
  assert.equal(r.marks.points[0].die, undefined);
});

test('histogram: values by colour group, from Y or from X', () => {
  const a = resolvePlot(spec('histogram', { y: T(1050) }), lot(), { ...ctx, groupBy: 'split' });
  assert.equal(a.marks.type, 'histogram');
  assert.deepEqual(a.marks.values.map(v => v.length), [20, 20]);
  assert.equal(a.autoTitle, 'Vth · by Split');
  const b = resolvePlot(spec('histogram', { x: T(1050), color: { none: true } }), lot(), ctx);
  assert.equal(b.marks.values[0].length, 40);
  assert.equal(b.x.label, 'Vth (V)');
});

test('bar: yield by temperature is POOLED, not an average of wafer yields', () => {
  const r = resolvePlot(spec('bar', { x: { meta: 'temperature' }, y: { builtin: 'yield' }, color: { none: true } }), lot(), ctx);
  assert.deepEqual(r.issues, []);
  assert.equal(r.level, 'wafer');
  assert.deepEqual(r.marks.categories, ['25', '85']);
  // 25 C: W1 9/10 and W2 10/20 -> 19/30
  assert.ok(Math.abs(r.marks.values[0][0] - (19 / 30) * 100) < 1e-9);
  assert.ok(Math.abs(r.marks.values[0][1] - 50) < 1e-9);
  assert.equal(r.y.label, 'Pooled yield (%)');
  assert.match(r.aggregation, /passing dies over judged dies/);
  const mean = resolvePlot(spec('bar', { x: { meta: 'temperature' }, y: { builtin: 'yield' }, color: { none: true } }, { aggregate: 'mean' }), lot(), ctx);
  assert.ok(Math.abs(mean.marks.values[0][0] - 70) < 1e-9);
  assert.match(mean.y.label, /^Mean Yield/);
});

test('bar: a test aggregate by split, coloured by temperature, is a clustered bar', () => {
  const r = resolvePlot(spec('bar', { x: { meta: 'split' }, y: T(1050), color: { meta: 'temperature' } }, { aggregate: 'max' }), lot(), ctx);
  assert.deepEqual(r.marks.categories, ['FF', 'TT']);
  assert.deepEqual(r.groups, ['25', '85']);
  // temperature 25, FF = W2: Vth up to 0.45 + 19/100; 85, FF has none
  assert.ok(Math.abs(r.marks.values[0][0] - 0.64) < 1e-9);
  assert.ok(Number.isNaN(r.marks.values[1][0]));
  assert.equal(r.level, 'die');
  assert.equal(r.y.label, 'Max Vth (V)');
});

test('bar with no Y counts what it stands for', () => {
  const r = resolvePlot(spec('bar', { x: { meta: 'split' }, color: { none: true } }), lot(), ctx);
  assert.equal(r.level, 'wafer');
  assert.deepEqual(r.marks.values, [[1, 2]]);
  assert.equal(r.y.label, 'Count of wafers');
  assert.equal(r.autoTitle, 'Dies by Split');
});

test('bar and box default to wafer on X', () => {
  const r = resolvePlot(spec('box', { y: T(1050), color: { none: true } }), lot(), ctx);
  assert.deepEqual(r.marks.categories, ['W1', 'W2', 'W3']);
  assert.deepEqual(r.marks.cells[0].map(c => c.length), [10, 20, 10]);
  assert.equal(r.autoTitle, 'Vth by Wafer');
  assert.equal(r.x.label, 'Wafer');
});

test('box: a numeric lot field is one category per value, in numeric order', () => {
  const items = [wafer('a', { meta: { slot: 10 } }), wafer('b', { meta: { slot: 9 } }), wafer('c', { meta: { slot: 10 } })];
  const r = resolvePlot(spec('box', { x: { meta: 'slot' }, y: T(1050), color: { none: true } }), items, ctx);
  assert.deepEqual(r.marks.categories, ['9', '10']);
  assert.deepEqual(r.marks.cells[0].map(c => c.length), [10, 20]);
});

test('box needs a measured field, and pooled yield needs the yield field', () => {
  assert.match(resolvePlot(spec('box', { x: { meta: 'split' } }), lot(), ctx).issues[0], /Choose a field for Y/);
  assert.match(resolvePlot(spec('bar', { x: { meta: 'split' }, y: T(1050) }, { aggregate: 'yield' }), lot(), ctx).issues[0], /Pooled yield needs Yield/);
  assert.match(resolvePlot(spec('box', { x: { meta: 'split' }, y: T(1050) }, { aggregate: 'count' }), lot(), ctx).issues[0], /measured field/);
});

test('line: a mean per distinct X, by colour group, in X order', () => {
  const r = resolvePlot(spec('line', { x: { builtin: 'waferOrder' }, y: { builtin: 'yield' }, color: { none: true } }, { aggregate: 'mean' }), lot(), ctx);
  assert.deepEqual(r.marks.xs, [1, 2, 3]);
  assert.deepEqual(r.marks.values, [[90, 50, 50]]);
  assert.equal(r.level, 'wafer');
  assert.equal(r.autoTitle, 'Yield over Wafer order');
  const byTemp = resolvePlot(spec('line', { x: { meta: 'temperature' }, y: T(1050), color: { meta: 'split' } }, { aggregate: 'min' }), lot(), ctx);
  assert.deepEqual(byTemp.marks.xs, [25, 85]);
  assert.deepEqual(byTemp.groups, ['FF', 'TT']);
  assert.ok(Number.isNaN(byTemp.marks.values[0][1]));
});

test('a wafer-level field cannot be split by a die-level one', () => {
  const r = resolvePlot(spec('bar', { x: { builtin: 'hbin' }, y: { builtin: 'yield' } }), lot(), ctx);
  assert.match(r.issues[0], /Yield is per wafer, so it cannot be split by Hard bin/);
  const c = resolvePlot(spec('bar', { x: { meta: 'split' }, y: { builtin: 'yield' }, color: { builtin: 'hbin' } }), lot(), ctx);
  assert.match(c.issues[0], /per wafer/);
  const wc = resolvePlot(spec('scatter', { x: { builtin: 'waferOrder' }, y: { builtin: 'yield' }, color: { builtin: 'site' } }), lot(), ctx);
  assert.match(wc.issues[0], /per die/);
});

test('a die-level category as X: hard bin, ring and quadrant', () => {
  const r = resolvePlot(spec('bar', { x: { builtin: 'hbin' }, color: { none: true } }), lot(), ctx);
  assert.deepEqual(r.marks.categories, ['Bin 1', 'Bin 2']);
  assert.deepEqual(r.marks.values, [[24, 16]]);
  const q = resolvePlot(spec('bar', { x: { builtin: 'quadrant' }, color: { none: true } }), lot(), ctx);
  assert.ok(q.marks.categories.every(c => ['NE', 'NW', 'SW', 'SE'].includes(c)));
  assert.equal(q.marks.values[0].reduce((a, b) => a + b, 0), 40 - (q.omitted[0]?.count ?? 0));
  const ring = resolvePlot(spec('bar', { x: { builtin: 'ring' }, color: { none: true } }), lot(), ctx);
  assert.ok(ring.marks.categories.every(c => /^Ring \d$/.test(c)));
});

test('a continuous die-level field is not a category on a bar or box', () => {
  const r = resolvePlot(spec('bar', { x: T(1050), y: T(1060) }), lot(), ctx);
  assert.match(r.issues[0], /Vth is continuous/);
});

test('a test the dies do not have is an issue naming it', () => {
  const r = resolvePlot(spec('scatter', { x: T(3001, 'Leak'), y: T(1060) }), lot(), ctx);
  assert.equal(r.marks, undefined);
  assert.match(r.issues[0], /Needs test 3001 \(Leak\), which is not in these dies/);
});

test('a test number that names another test here is refused, not plotted', () => {
  const r = resolvePlot(spec('scatter', { x: T(1050, 'Leakage'), y: T(1060) }), lot(), ctx);
  assert.equal(r.marks, undefined);
  assert.match(r.issues[0], /Test 1050 is "Leakage" in this plot and "Vth" here/);
  const same = resolvePlot(spec('scatter', { x: T(1050, ' vth '), y: T(1060), color: { none: true } }), lot(), ctx);
  assert.deepEqual(same.issues, []);
});

test('a test present in the dies but not in the list is plotted under its number', () => {
  const r = resolvePlot(spec('histogram', { y: { test: 1050 }, color: { none: true } }), lot(), {});
  assert.deepEqual(r.issues, []);
  assert.equal(r.x.label, 'Test 1050');
});

test('a continuous colour is an issue for now', () => {
  const r = resolvePlot(spec('scatter', { x: T(1050), y: T(1060), color: T(1050) }), lot(), ctx);
  assert.match(r.issues[0], /cannot be a colour yet/);
});

test('a plot from a newer version, or with a role missing, says so', () => {
  assert.match(resolvePlot({ id: 'p', mark: 'sweep', encoding: {} }, lot(), ctx).issues[0], /newer version/);
  assert.match(resolvePlot(spec('scatter', { x: T(1050) }), lot(), ctx).issues[0], /Choose a field for Y/);
  assert.match(resolvePlot(spec('scatter', { y: T(1050) }), lot(), ctx).issues[0], /Choose a field for X/);
  assert.match(resolvePlot(spec('histogram', {}), lot(), ctx).issues[0], /Choose a field/);
});

test('a log axis falls back to linear when a value is not above zero, and says so', () => {
  const r = resolvePlot(spec('scatter', { x: T(1050), y: { builtin: 'x' }, color: { none: true }, }, { axes: { y: { scale: 'log' }, x: { scale: 'log' } } }), lot(), ctx);
  assert.equal(r.x.scale, 'log');
  assert.equal(r.y.scale, 'linear');
  assert.match(r.notes[0], /Y axis stays linear/);
});

test('axis settings and the title the user typed override the automatic ones', () => {
  const r = resolvePlot(spec('scatter', { x: T(1050), y: T(1060), color: { none: true } },
    { title: 'My plot', axes: { x: { label: 'Threshold', min: 0.3, max: 0.9, reverse: true } } }), lot(), ctx);
  assert.equal(plotTitle(r), 'My plot');
  assert.equal(r.autoTitle, 'Idsat vs Vth');
  assert.equal(r.x.label, 'Threshold');
  assert.equal(r.x.min, 0.3);
  assert.equal(r.x.reverse, true);
  assert.equal(plotTitle({ ...r, spec: { ...r.spec, title: undefined } }), 'Idsat vs Vth');
});

test('the footnote states population, aggregation and what was left out', () => {
  const r = resolvePlot(spec('scatter', { x: T(1050), y: T(1060), color: { none: true } }), lot(), ctx);
  assert.equal(plotFootnote(r), '3 wafers · 40 dies · 4 dies without Idsat not plotted');
  const one = resolvePlot(spec('histogram', { y: T(1050), color: { none: true } }), [lot()[0]], ctx);
  assert.equal(plotFootnote(one), '1 wafer · 10 dies');
});

test('an empty population resolves without throwing', () => {
  const r = resolvePlot(spec('scatter', { x: T(1050), y: T(1060) }), [], ctx);
  assert.deepEqual(r.population, { wafers: 0, dies: 0 });
  assert.equal(r.plotted, 0);
});

test('ring and quadrant need the wafer; without it the dies are counted as left out', () => {
  const items = lot().map(it => ({ ...it, wafer: undefined }));
  const r = resolvePlot(spec('bar', { x: { builtin: 'quadrant' }, color: { none: true } }), items, ctx);
  assert.equal(r.plotted, 0);
  assert.deepEqual(r.omitted, [{ field: 'Quadrant', count: 40 }]);
});
