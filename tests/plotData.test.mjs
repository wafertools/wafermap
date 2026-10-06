// Resolving a saved plot over a population of wafers (stats/plotData.ts): the data each mark draws, the level
// rules, pooled yield, and the reasons a plot cannot be drawn.

import test from 'node:test';
import assert from 'node:assert/strict';
import { buildWaferMap } from '../dist/index.js';
import { resolvePlot, plotFootnote, plotTitle, combine, combinationIssue, fieldCatalogue, fieldsForRole, defaultPlot, fieldKey, titleDrift, describeTitleDrift, examplePlots } from '../dist/packages/stats/plotData.js';
import { yieldCounts } from '../dist/packages/stats/yield.js';

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
  return { label, dies: r.dies, metadata: r.metadata, passBins: [1], ringCount: r.ringCount, wafer: r.wafer };
}

const lot = () => [
  wafer('W1', { n: 10, pass: 9, vth0: 0.40, meta: { split: 'TT', temperature: 25 } }),
  wafer('W2', { n: 20, pass: 10, vth0: 0.45, noIdsat: 4, meta: { split: 'FF', temperature: 25 } }),
  wafer('W3', { n: 10, pass: 5, vth0: 0.50, meta: { split: 'TT', temperature: 85 } }),
];
const ctx = { testDefs: DEFS, passBins: [1] };
const spec = (chart, fields, over = {}) => ({ id: 'p', chart, fields, ...over });
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
  assert.equal(r.x.label, 'Vth');
  assert.equal(r.x.unit, 'V');
  assert.equal(r.y.label, 'Idsat');
  assert.equal(r.y.unit, 'A');
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
  assert.equal(b.x.label, 'Vth');
  assert.equal(b.x.unit, 'V');
});

test('bar: yield by temperature is POOLED, not an average of wafer yields', () => {
  const r = resolvePlot(spec('bar', { x: { meta: 'temperature' }, y: { builtin: 'yield' }, color: { none: true } }), lot(), ctx);
  assert.deepEqual(r.issues, []);
  assert.equal(r.level, 'wafer');
  assert.deepEqual(r.marks.categories, ['25', '85']);
  // 25 C: W1 9/10 and W2 10/20 -> 19/30
  assert.ok(Math.abs(r.marks.values[0][0] - (19 / 30) * 100) < 1e-9);
  assert.ok(Math.abs(r.marks.values[0][1] - 50) < 1e-9);
  assert.equal(r.y.label, 'Pooled yield');
  assert.equal(r.y.unit, '%');
  assert.match(r.aggregation, /passing dies over judged dies/);
  const mean = resolvePlot(spec('bar', { x: { meta: 'temperature' }, y: { builtin: 'yield' }, color: { none: true } }, { aggregate: 'mean' }), lot(), ctx);
  assert.ok(Math.abs(mean.marks.values[0][0] - 70) < 1e-9);
  assert.equal(mean.y.label, 'Mean Yield');
});

test('bar: a test aggregate by split, coloured by temperature, is a clustered bar', () => {
  const r = resolvePlot(spec('bar', { x: { meta: 'split' }, y: T(1050), color: { meta: 'temperature' } }, { aggregate: 'max' }), lot(), ctx);
  assert.deepEqual(r.marks.categories, ['FF', 'TT']);
  assert.deepEqual(r.groups, ['25', '85']);
  // temperature 25, FF = W2: Vth up to 0.45 + 19/100; 85, FF has none
  assert.ok(Math.abs(r.marks.values[0][0] - 0.64) < 1e-9);
  assert.ok(Number.isNaN(r.marks.values[1][0]));
  assert.equal(r.level, 'die');
  assert.equal(r.y.label, 'Max Vth');
  assert.equal(r.y.unit, 'V');
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

test('a wafer-level field cannot be split by a die-level one, except a yield in a bar or line', () => {
  const r = resolvePlot(spec('box', { x: { builtin: 'hbin' }, y: { builtin: 'yield' } }), lot(), ctx);
  assert.match(r.issues[0], /Yield is one figure per wafer, and Hard bin belongs to dies, so a box of it cannot be split by Hard bin/);
  assert.match(r.issues[0], /A bar chart of yield can/);
  const wc = resolvePlot(spec('scatter', { x: { builtin: 'waferOrder' }, y: { builtin: 'waferOrder' }, color: { builtin: 'site' } }), lot(), ctx);
  assert.match(wc.issues[0], /per die/);
  assert.match(wc.issues[0], /bar chart of yield/);
});

test('yield is taken per ring, quadrant, bin or die position in a bar, pooled over judged dies', () => {
  const items = lot();
  const overall = items.reduce((a, it) => { const c = yieldCounts(it.dies, [1]); return { pass: a.pass + c.pass, total: a.total + c.total }; }, { pass: 0, total: 0 });
  for (const x of [{ builtin: 'quadrant' }, { builtin: 'hbin' }, { builtin: 'x' }, { builtin: 'y' }]) {
    const r = resolvePlot(spec('bar', { x, y: { builtin: 'yield' }, color: { none: true } }), items, ctx);
    assert.deepEqual(r.issues, [], JSON.stringify(x));
    assert.equal(r.level, 'die');
    // Every judged die is in exactly one bar, so the bars' passes and counts add up to the lot's.
    const cells = r.marks.cells[0];
    const total = cells.reduce((a, c) => a + c.length, 0);
    const pass = cells.reduce((a, c) => a + c.filter(v => v === 100).length, 0);
    assert.deepEqual({ pass, total }, overall, JSON.stringify(x));
    r.marks.values[0].forEach((v, i) => { const want = cells[i].length ? (cells[i].filter(q => q === 100).length / cells[i].length) * 100 : NaN; assert.ok(Number.isNaN(want) ? Number.isNaN(v) : Math.abs(v - want) < 1e-9, `${v} vs ${want}`); });
    assert.match(r.aggregation, /passing dies over judged dies, pooled per/);
  }
});

test('yield per ring split by wafer, and a line of yield over wafer order split by ring, resolve', () => {
  const bar = resolvePlot(spec('bar', { x: { builtin: 'quadrant' }, y: { builtin: 'yield' }, color: { builtin: 'wafer' } }), lot(), ctx);
  assert.deepEqual(bar.issues, []);
  assert.equal(bar.groups.length, lot().length);
  const line = resolvePlot(spec('line', { x: { builtin: 'waferOrder' }, y: { builtin: 'yield' }, color: { builtin: 'quadrant' } }), lot(), ctx);
  assert.deepEqual(line.issues, []);
  assert.equal(line.y.label, 'Yield');
});

test('a bar of die counts per wafer can be coloured by a die-level field', () => {
  const r = resolvePlot(spec('bar', { x: { builtin: 'wafer' }, color: { builtin: 'hbin' } }), lot(), ctx);
  assert.deepEqual(r.issues, []);
  assert.equal(r.level, 'die');
});

test('die X and die Y can be the categories of a bar or box', () => {
  const r = resolvePlot(spec('bar', { x: { builtin: 'x' }, color: { none: true } }), lot(), ctx);
  assert.deepEqual(r.issues, []);
  assert.ok(r.marks.categories.every((c, i, a) => i === 0 || Number(c) > Number(a[i - 1])), 'in numeric order');
  const c = resolvePlot(spec('bar', { x: { test: 1050 }, color: { none: true } }), lot(), ctx);
  assert.match(c.issues[0], /is continuous, so a bar cannot have one bar per value/);
});

test('a category in a role that needs a number is a reason, never an exception', () => {
  const kinds = ['scatter', 'line', 'histogram', 'box', 'bar'];
  const fields = [{ builtin: 'ring' }, { builtin: 'wafer' }, { builtin: 'hbin' }, { meta: 'split' }, { builtin: 'yield' }, { builtin: 'x' }, { test: 1050 }, undefined];
  for (const chart of kinds) for (const x of fields) for (const y of fields) for (const color of [undefined, { builtin: 'ring' }, { builtin: 'wafer' }]) {
    const f = {}; if (x) f.x = x; if (y) f.y = y; if (color) f.color = color;
    assert.doesNotThrow(() => resolvePlot(spec(chart, f), lot(), ctx), `${chart} ${JSON.stringify(f)}`);
  }
  const r = resolvePlot(spec('scatter', { x: { test: 1050 }, y: { builtin: 'ring' } }), lot(), ctx);
  assert.match(r.issues[0], /Ring is a category, not a number, so it cannot be the Y of a scatter/);
  assert.match(r.issues[0], /Use it as the X of a bar or box chart/);
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


test('a plot from a newer version, or with a role missing, says so', () => {
  assert.match(resolvePlot({ id: 'p', chart: 'ripple', fields: {} }, lot(), ctx).issues[0], /newer version/);
  assert.match(resolvePlot({ id: 'p', chart: 'sweep', sweep: { series: [] } }, lot(), ctx).issues[0], /drawn by the sweep panel/, 'a sweep is not a field plot');
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

// ── what can be chosen ──

test('the catalogue is the lot\'s: its tests, the die fields it has data for, and its wafer and lot fields', () => {
  const cat = fieldCatalogue(lot(), ctx);
  const keys = cat.map(f => fieldKey(f.field));
  assert.deepEqual(keys.filter(k => k.startsWith('test:')), ['test:1050', 'test:1060']);
  for (const k of ['builtin:x', 'builtin:y', 'builtin:ring', 'builtin:quadrant', 'builtin:hbin', 'builtin:wafer', 'builtin:waferOrder', 'builtin:yield', 'builtin:dieCount', 'meta:split', 'meta:temperature']) {
    assert.ok(keys.includes(k), k);
  }
  assert.ok(!keys.includes('builtin:sbin'), 'no soft bins in this lot');
  assert.ok(!keys.includes('builtin:site'), 'no site numbers in this lot');
  const test1050 = cat.find(f => fieldKey(f.field) === 'test:1050');
  assert.equal(test1050.label, 'Vth · 1050', 'the number is in the text, so a filter finds either');
  assert.equal(test1050.group, 'Tests');
  assert.equal(cat.find(f => fieldKey(f.field) === 'meta:temperature').kind, 'numeric');
  assert.equal(cat.find(f => fieldKey(f.field) === 'meta:split').kind, 'categorical');
});

test('one wafer has no wafer order', () => {
  const keys = fieldCatalogue([lot()[0]], ctx).map(f => fieldKey(f.field));
  assert.ok(!keys.includes('builtin:waferOrder'));
});

test('a functional test is not offered as a value', () => {
  const defs = [...DEFS, { testNumber: 2000, name: 'Cont', testType: 'F' }];
  const keys = fieldCatalogue(lot(), { testDefs: defs }).map(f => fieldKey(f.field));
  assert.ok(!keys.includes('test:2000'));
});

test('each role is offered only what it can use', () => {
  const cat = fieldCatalogue(lot(), ctx);
  const labels = (mark, role) => fieldsForRole(cat, mark, role).map(f => f.label);
  assert.ok(labels('scatter', 'x').includes('Vth · 1050') && labels('scatter', 'x').includes('Yield'));
  assert.ok(!labels('scatter', 'x').includes('Wafer') && !labels('scatter', 'x').includes('Split'));
  assert.ok(labels('histogram', 'y').includes('Idsat · 1060'));
  assert.ok(labels('scatter', 'color').includes('Wafer') && labels('scatter', 'color').includes('Split'));
  assert.ok(labels('scatter', 'color').includes('Vth · 1050'), 'a scatter can be coloured by a measured value');
  assert.ok(!labels('bar', 'color').includes('Vth · 1050'), 'a bar can not');
  assert.ok(labels('bar', 'x').includes('Temperature'), labels('bar', 'x').join(','));
  assert.ok(!labels('bar', 'x').includes('Vth · 1050'), 'a bar groups by a category, not a measurement');
});

test('a first plot is never empty: two tests, one test, or neither', () => {
  const cat = fieldCatalogue(lot(), ctx);
  assert.deepEqual(defaultPlot(cat, 'a'), { id: 'a', chart: 'scatter', fields: { x: { test: 1050, name: 'Vth' }, y: { test: 1060, name: 'Idsat' } } });
  const one = fieldCatalogue(lot(), { testDefs: [DEFS[0]] }).filter(f => f.group !== 'Tests' || f.field.test === 1050);
  assert.equal(defaultPlot(one, 'b').chart, 'histogram');
  const none = defaultPlot(cat.filter(f => f.group !== 'Tests'), 'c');
  assert.deepEqual(none.fields, { x: { builtin: 'waferOrder' }, y: { builtin: 'yield' } });
});

// ── a continuous colour ──

test('a scatter can be coloured on a gradient by a measured value, and says what the colours span', () => {
  const r = resolvePlot(spec('scatter', { x: T(1050), y: T(1060), color: T(1050) }), lot(), ctx);
  assert.deepEqual(r.issues, []);
  assert.deepEqual(r.groups, ['']);
  assert.equal(r.colorScale.label, 'Vth');
  assert.equal(r.colorScale.unit, 'V');
  const vs = r.marks.points.map(p => p.value);
  assert.equal(r.colorScale.lo, Math.min(...vs));
  assert.equal(r.colorScale.hi, Math.max(...vs));
  assert.equal(r.autoTitle, 'Idsat vs Vth', 'colouring by the X field adds nothing to say');
  const other = resolvePlot(spec('scatter', { x: T(1050), y: T(1060), color: { builtin: 'yield' } }), lot(), ctx);
  assert.equal(other.autoTitle, 'Idsat vs Vth · by Yield');
});

test('a die without the colour value is left out and counted, not drawn grey', () => {
  const r = resolvePlot(spec('scatter', { x: T(1050), y: { builtin: 'x' }, color: T(1060) }), lot(), ctx);
  assert.equal(r.plotted, 36);
  assert.deepEqual(r.omitted, [{ field: 'Idsat', count: 4 }]);
});

test('a continuous colour on a wafer-level scatter is the per-wafer aggregate of the value', () => {
  const r = resolvePlot(spec('scatter', { x: { builtin: 'waferOrder' }, y: { builtin: 'yield' }, color: T(1050) }, { aggregate: 'max' }), lot(), ctx);
  assert.deepEqual(r.issues, []);
  assert.equal(r.level, 'wafer');
  assert.equal(r.marks.points.length, 3);
  assert.ok(Math.abs(r.marks.points[0].value - 0.49) < 1e-9, 'W1 Vth max is 0.40 + 9/100');
});

test('a continuous colour is for a scatter only; a lot field with numbers still colours as categories', () => {
  assert.match(resolvePlot(spec('histogram', { y: T(1050), color: T(1060) }), lot(), ctx).issues[0], /can colour a scatter but not a histogram/);
  assert.match(resolvePlot(spec('bar', { x: { meta: 'split' }, color: { builtin: 'yield' } }), lot(), ctx).issues[0], /can colour a scatter but not a bar/);
  const t = resolvePlot(spec('scatter', { x: T(1050), y: T(1060), color: { meta: 'temperature' } }), lot(), ctx);
  assert.deepEqual(t.groups, ['25', '85']);
  assert.equal(t.colorScale, undefined);
});

test('the colour list for a scatter includes measured values; for other types it does not', () => {
  const cat = fieldCatalogue(lot(), ctx);
  assert.ok(fieldsForRole(cat, 'scatter', 'color').some(f => f.label === 'Vth · 1050'));
  assert.ok(!fieldsForRole(cat, 'bar', 'color').some(f => f.label === 'Vth · 1050'));
  assert.ok(!fieldsForRole(cat, 'histogram', 'color').some(f => f.label === 'Vth · 1050'));
});

// ── a typed title that no longer matches ──

test('an automatic title is never checked', () => {
  const cat = fieldCatalogue(lot(), ctx);
  assert.deepEqual(titleDrift(spec('scatter', { x: T(1050), y: T(1060) }), cat), { names: [], omits: [] });
});

test('a title naming a test the plot does not use is reported', () => {
  const cat = fieldCatalogue(lot(), ctx);
  const d = titleDrift(spec('scatter', { x: T(1050), y: T(1050) }, { title: 'Vth vs Idsat' }), cat);
  assert.deepEqual(d.names, ['Idsat']);
  assert.match(describeTitleDrift(d), /The title names Idsat, which this plot does not show\./);
});

test('a title that names one of the two fields but not the other is half a description', () => {
  const cat = fieldCatalogue(lot(), ctx);
  const d = titleDrift(spec('scatter', { x: T(1050), y: T(1060) }, { title: 'Vth over the lot' }), cat);
  assert.deepEqual(d, { names: [], omits: ['Idsat'] });
  assert.match(describeTitleDrift(d), /does not name Idsat, which this plot shows/);
});

test('free text that names none of the fields is left alone, and so is a title that is right', () => {
  const cat = fieldCatalogue(lot(), ctx);
  assert.equal(describeTitleDrift(titleDrift(spec('scatter', { x: T(1050), y: T(1060) }, { title: 'Process check' }), cat)), null);
  assert.equal(describeTitleDrift(titleDrift(spec('scatter', { x: T(1050), y: T(1060) }, { title: 'Idsat against Vth, lot 5' }), cat)), null);
});

test('a name must match as a word: Vth does not match vth_n_mV, case does not matter', () => {
  const defs = [{ testNumber: 1, name: 'vth' }, { testNumber: 2, name: 'vth_n_mV' }];
  const items = [wafer('a')].map(w => ({ ...w, dies: w.dies.map(d => ({ ...d, testValues: { 1: 1, 2: 2 } })) }));
  const cat = fieldCatalogue(items, { testDefs: defs });
  assert.deepEqual(titleDrift(spec('histogram', { y: { test: 2 } }, { title: 'VTH_N_MV spread' }), cat).names, [], 'the title names the plotted test, in other case');
  assert.deepEqual(titleDrift(spec('histogram', { y: { test: 2 } }, { title: 'vth_n_mV spread' }), cat).names, [], 'vth is not found inside vth_n_mV');
  assert.deepEqual(titleDrift(spec('histogram', { y: { test: 1 } }, { title: 'vth_n_mV spread' }), cat).names, ['vth_n_mV']);
});

test('generic words and lot fields in a title are not mistaken for fields', () => {
  const cat = fieldCatalogue(lot(), ctx);
  const d = titleDrift(spec('bar', { x: { meta: 'split' }, y: T(1050) }, { title: 'Vth by Wafer and Temperature' }), cat);
  assert.deepEqual(d.names, []);
});

// ── examples ──

test('examples: one of each type the lot can show, built from its own tests and fields', () => {
  const cat = fieldCatalogue(lot(), ctx);
  let n = 0;
  const ex = examplePlots(cat, 3, () => `e${n++}`);
  assert.deepEqual(ex.map(p => p.chart), ['scatter', 'histogram', 'box', 'bar', 'line', 'sweep']);
  assert.deepEqual(ex[0].fields, { x: { test: 1050, name: 'Vth' }, y: { test: 1060, name: 'Idsat' } });
  assert.deepEqual(ex[3].fields.x, { meta: 'split' }, 'the first lot field that divides the wafers');
  assert.deepEqual(ex[3].fields.y, { builtin: 'yield' });
  assert.equal(new Set(ex.map(p => p.id)).size, 6);
  for (const p of ex.filter(p => p.chart !== 'sweep')) {
    assert.equal('title' in p, false, 'untitled, so each is named by what it plots');
    const r = resolvePlot(p, lot(), ctx);
    assert.deepEqual(r.issues, [], `${p.chart}: ${r.issues}`);
    assert.ok(r.plotted > 0, p.chart);
  }
  const sweep = ex[5];
  assert.equal(sweep.title, 'Example sweep', 'a sweep has no fields to name it, so it is titled');
  assert.deepEqual(sweep.sweep.series, [{ label: 'Series 1', tests: [1050, 1060], testNames: { 1050: 'Vth', 1060: 'Idsat' } }], 'the lot\'s own tests, in test order');
});

test('examples: a single wafer gets only what makes sense for one', () => {
  const cat = fieldCatalogue([lot()[0]], ctx);
  assert.deepEqual(examplePlots(cat, 1, () => 'x').map(p => p.chart), ['scatter', 'histogram', 'sweep']);
});

test('examples: with no tests there is nothing to draw but yield', () => {
  const cat = fieldCatalogue(lot(), ctx).filter(f => f.group !== 'Tests');
  assert.deepEqual(examplePlots(cat, 3, () => 'x').map(p => p.chart), ['bar']);
});

test('examples: yield is by wafer when no lot field divides them', () => {
  const items = [wafer('a'), wafer('b'), wafer('c')];
  const ex = examplePlots(fieldCatalogue(items, ctx), 3, () => 'x');
  assert.deepEqual(ex.find(p => p.chart === 'bar').fields.x, { builtin: 'wafer' });
});

test('combinationIssue: one rule for the chart and the editor, in a long and a short form', () => {
  const yieldF = { label: 'Yield', level: 'wafer', kind: 'numeric', yield: true };
  const ring = { label: 'Ring', level: 'die', kind: 'categorical', yield: false };
  const wafer = { label: 'Wafer', level: 'wafer', kind: 'categorical', yield: false };
  const vth = { label: 'Vth', level: 'die', kind: 'numeric', yield: false };
  assert.equal(combinationIssue('bar', { x: ring, y: yieldF }), undefined, 'a bar of yield splits by a die-level field');
  assert.equal(combinationIssue('line', { x: wafer, y: yieldF, color: ring }), undefined);
  const box = combinationIssue('box', { x: ring, y: yieldF });
  assert.match(box.long, /Yield is one figure per wafer, and Ring belongs to dies/);
  assert.equal(box.short, 'Yield is per wafer: use a bar or line chart');
  assert.equal(combinationIssue('box', { x: wafer, y: vth, color: ring }), undefined, 'a measured value is per die, so a die-level colour is fine');
  assert.match(combinationIssue('scatter', { x: wafer, y: wafer, color: ring }).short, /Ring is per die/);
  assert.equal(combinationIssue('bar', { x: wafer, color: ring }), undefined, 'counting dies per wafer and ring');
  assert.equal(combinationIssue('box', { y: yieldF }), undefined, 'a missing field is never a conflict');
});

// ── limits on the axis of a measured test ──────────────────────────────────────────────────────────────────

const LIMITED = { ...ctx, testDefs: DEFS.map(d => (d.testNumber === 1050 ? { ...d, limitLow: 2, limitHigh: 9, specLow: 1, specHigh: 10 } : d)) };
const LIM = { limitLow: 2, limitHigh: 9, specLow: 1, specHigh: 10 };

test('a test\'s limits ride on the axis that measures it, and only there', () => {
  const sc = resolvePlot(spec('scatter', { x: T(1050, 'Vth'), y: T(1060, 'Idsat') }), lot(), LIMITED);
  assert.deepEqual(sc.x.limits, LIM);
  assert.equal(sc.y.limits, undefined, 'a test without limits has none');
  const h = resolvePlot(spec('histogram', { y: T(1050, 'Vth') }), lot(), LIMITED);
  assert.deepEqual(h.x.limits, LIM, 'the values axis');
  assert.equal(h.y.limits, undefined, 'the count axis never carries the test\'s limits');
  const box = resolvePlot(spec('box', { x: { builtin: 'wafer' }, y: T(1050, 'Vth') }), lot(), LIMITED);
  assert.deepEqual(box.y.limits, LIM);
  const mean = resolvePlot(spec('bar', { x: { builtin: 'wafer' }, y: T(1050, 'Vth') }), lot(), LIMITED);
  assert.deepEqual(mean.y.limits, LIM, 'a mean is compared with the limits');
  const sum = resolvePlot(spec('bar', { x: { builtin: 'wafer' }, y: T(1050, 'Vth') }, { aggregate: 'sum' }), lot(), LIMITED);
  assert.equal(sum.y.limits, undefined, 'a sum or a count is not a value the limits describe');
  const yld = resolvePlot(spec('bar', { x: { builtin: 'quadrant' }, y: { builtin: 'yield' } }), lot(), LIMITED);
  assert.equal(yld.y.limits, undefined);
  const line = resolvePlot(spec('line', { x: { builtin: 'waferOrder' }, y: T(1050, 'Vth') }), lot(), LIMITED);
  assert.deepEqual(line.y.limits, LIM);
});

test('no limits on a test whose limits the lot disagrees about (the reconciled list drops them)', () => {
  const none = { ...ctx, testDefs: DEFS };
  assert.equal(resolvePlot(spec('histogram', { y: T(1050, 'Vth') }), lot(), none).x.limits, undefined);
});

test('a lot field is a number only when every value is written as a plain decimal', () => {
  const kindOf = (...values) => {
    const items = values.map((v, i) => wafer(`W${i + 1}`, { meta: { lot: v } }));
    return fieldCatalogue(items, ctx).find(f => 'meta' in f.field && f.field.meta === 'lot')?.kind;
  };
  assert.equal(kindOf('25', '85', '125'), 'numeric', 'a temperature');
  assert.equal(kindOf('-40', '25.5', '.5', '+3'), 'numeric', 'signs and fractions');
  // Names that `Number()` would read as quantities.
  assert.equal(kindOf('1E3', '2E5'), 'categorical', 'exponent-looking lot IDs');
  assert.equal(kindOf('0x10', '0x1A'), 'categorical', 'hexadecimal');
  assert.equal(kindOf('Infinity', '-Infinity'), 'categorical');
  assert.equal(kindOf('12', '1E3'), 'categorical', 'one name among numbers makes the field a category');
});

test('a ring or quadrant of a plot is the wafer\'s own ring, whatever the default is', () => {
  const grid = [];
  for (let x = -4; x <= 4; x++) for (let y = -4; y <= 4; y++) grid.push({ x, y, hbin: 1 });
  const item = (ringCount) => {
    const r = buildWaferMap({ results: grid, waferConfig: { diameter: 90 }, dieConfig: { width: 10, height: 10 }, passBins: [1], ringCount });
    return { label: `R${ringCount}`, dies: r.dies, passBins: r.passBins, ringCount: r.ringCount, wafer: r.wafer };
  };
  const rings = (it) => resolvePlot(spec('bar', { x: { builtin: 'ring' }, color: { none: true } }), [it], {}).marks.categories;
  assert.equal(rings(item(6)).length, 6, 'a wafer built with six rings has six');
  assert.deepEqual(rings(item(6)), ['Ring 1', 'Ring 2', 'Ring 3', 'Ring 4', 'Ring 5', 'Ring 6']);
  assert.ok(rings(item(4)).length <= 4 && !rings(item(4)).includes('Ring 5'));
  assert.throws(() => rings({ ...item(6), ringCount: undefined }), /no ring count/, 'no default stands in for a missing one');
});
