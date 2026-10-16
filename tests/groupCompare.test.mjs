// Comparing groups of wafers (stats/groupCompare.ts): the tests against R's reference results, the wafer as the
// unit (not the die), a control with Holm-adjusted contrasts, and many tests ranked by Benjamini–Hochberg.

import test from 'node:test';
import assert from 'node:assert/strict';
import { buildWaferMap } from '../dist/index.js';
import { compareGroups, compareTestsByGroup, comparisonP, formatP } from '../dist/packages/stats/groupCompare.js';
import { tTwoSided, fUpperTail, chiSquareUpperTail, holm, incompleteBeta } from '../dist/packages/stats/math.js';
import { resolvePlot, plotFootnote } from '../dist/packages/stats/plotData.js';

const near = (a, b, tol = 1e-6) => assert.ok(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), `${a} ≉ ${b}`);

test('distribution tails: t, F and chi-square at their textbook points', () => {
  near(tTwoSided(2.228138852, 10), 0.05);
  near(tTwoSided(12.70620474, 1), 0.05);
  near(fUpperTail(4.256494729, 2, 9), 0.05);
  near(fUpperTail(161.4476388, 1, 1), 0.05);
  near(chiSquareUpperTail(5.991464547, 2), 0.05);
  near(chiSquareUpperTail(40, 3), 1.065509e-8, 1e-5);
  near(incompleteBeta(0.3, 2, 5), 0.579825, 1e-5);
  assert.deepEqual(holm([0.01, 0.04, 0.03]).map(p => +p.toFixed(6)), [0.03, 0.06, 0.06]);
});

test('Kruskal–Wallis matches R’s kruskal.test on the airway example (χ² 0.77143, df 2, p 0.68)', () => {
  const c = compareGroups([
    { key: 'normal', values: [2.9, 3.0, 2.5, 2.6, 3.2] },
    { key: 'oad', values: [3.8, 2.7, 4.0, 2.4] },
    { key: 'asbestosis', values: [2.8, 3.4, 3.7, 2.2, 2.0] },
  ]);
  near(c.kruskal.h, 0.7714286, 1e-6);
  assert.equal(c.kruskal.df, 2);
  near(c.kruskal.p, 0.6799648, 1e-6);
  assert.equal(c.kruskal.approximate, true, 'four values in a group');
  assert.equal(c.welch.method, 'welch-anova');
});

test('Welch’s t matches R’s t.test on the sleep data (t −1.8608, df 17.776, p 0.07939), and the control contrast agrees', () => {
  const c = compareGroups([
    { key: '1', values: [0.7, -1.6, -0.2, -1.2, -0.1, 3.4, 3.7, 0.8, 0.0, 2.0] },
    { key: '2', values: [1.9, 0.8, 1.1, 0.1, -0.1, 4.4, 5.5, 1.6, 4.6, 3.4] },
  ], '2');
  assert.equal(c.welch.method, 'welch-t');
  near(c.welch.statistic, -1.860813, 1e-6);
  near(c.welch.df2, 17.77647, 1e-6);
  near(c.welch.p, 0.07939414, 1e-6);
  assert.equal(c.control, '2');
  near(c.contrasts[0].p, 0.07939414, 1e-6);
  near(c.contrasts[0].delta, -1.58, 1e-9);
});

test('a group of one wafer is summarised and left out of the tests; a single testable group has nothing to compare', () => {
  const c = compareGroups([{ key: 'A', values: [1, 2, 3] }, { key: 'B', values: [5] }, { key: 'C', values: [2, 4] }]);
  assert.deepEqual(c.tooSmall, ['B']);
  assert.equal(c.welch.method, 'welch-t', 'A against C only');
  const one = compareGroups([{ key: 'A', values: [1, 2] }, { key: 'B', values: [3] }]);
  assert.match(one.issue, /two groups with two or more wafers/);
  assert.equal(one.welch, undefined);
});

test('no spread in a group: Welch cannot be computed, the rank test stands and the reason is given', () => {
  const c = compareGroups([{ key: 'A', values: [1, 1, 1] }, { key: 'B', values: [2, 3, 4] }]);
  assert.equal(c.welch, undefined);
  assert.ok(c.kruskal);
  assert.match(c.issue, /same value/);
  assert.equal(comparisonP(c), c.kruskal.p);
});

test('three contrasts against a control are Holm-adjusted', () => {
  const c = compareGroups([
    { key: 'POR', values: [10, 10.2, 9.9, 10.1] },
    { key: 'A', values: [11, 11.2, 10.9, 11.1] },
    { key: 'B', values: [10.1, 10.3, 9.8, 10.2] },
    { key: 'C', values: [9, 9.1, 8.8, 9.2] },
  ], 'POR');
  const raw = c.contrasts.map(x => x.p);
  assert.deepEqual(c.contrasts.map(x => x.pAdjusted), holm(raw));
  assert.ok(c.contrasts.find(x => x.key === 'A').pAdjusted < 0.01);
  assert.ok(c.contrasts.find(x => x.key === 'B').pAdjusted > 0.5);
});

test('p-values read as a reader is shown them', () => {
  assert.equal(formatP(0.0004), '< 0.001');
  assert.equal(formatP(0.0123), '0.012');
  assert.equal(formatP(NaN), '—');
});

// ── wafers, not dies ──

const DEFS = [
  { testNumber: 1, name: 'Shifted', unit: 'V', specLow: 0, specHigh: 2 },
  { testNumber: 2, name: 'Flat', unit: 'V' },
];
/** A wafer of 200 dies: Shifted around `centre` with a little die noise, Flat the same everywhere but for noise. */
function wafer(label, split, centre, seed) {
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647) - 0.5;
  const r = buildWaferMap({
    results: Array.from({ length: 200 }, (_, k) => ({ x: k % 20, y: Math.floor(k / 20), hbin: 1, testValues: { 1: centre + rnd() * 0.2, 2: 1 + rnd() * 0.2 } })),
    waferConfig: { diameter: 80, metadata: { split } }, dieConfig: { width: 1, height: 1 }, passBins: [1], testDefs: DEFS,
  });
  return { label, dies: r.dies, metadata: r.metadata, passBins: [1], ringCount: r.ringCount, wafer: r.wafer };
}

test('two wafers a split: the dies would call any wafer offset certain, the wafers do not', () => {
  // Wafer-to-wafer offsets swamp the split: TT at 1.0 and 1.3, FF at 1.1 and 1.4.
  const items = [wafer('W1', 'TT', 1.0, 7), wafer('W2', 'TT', 1.3, 11), wafer('W3', 'FF', 1.1, 13), wafer('W4', 'FF', 1.4, 17)];
  const rows = compareTestsByGroup(items.map(it => ({ dies: it.dies, group: it.metadata.split })), DEFS);
  const shifted = rows.find(r => r.test.testNumber === 1);
  assert.deepEqual(shifted.comparison.groups.map(g => g.n), [2, 2], 'n is wafers');
  assert.ok(shifted.comparison.welch.p > 0.3, `wafer-level p ${shifted.comparison.welch.p}`);
});

test('a real split shift ranks first, with its share of the limit window', () => {
  const items = [wafer('W1', 'POR', 1.0, 7), wafer('W2', 'POR', 1.02, 11), wafer('W3', 'POR', 0.98, 19),
    wafer('W4', 'NEW', 1.5, 13), wafer('W5', 'NEW', 1.52, 17), wafer('W6', 'NEW', 1.49, 23)];
  const rows = compareTestsByGroup(items.map(it => ({ dies: it.dies, group: it.metadata.split })), DEFS, 'POR');
  assert.equal(rows[0].test.name, 'Shifted');
  assert.ok(rows[0].pAdjusted < 0.01);
  near(rows[0].windowShare, 0.503 / 2, 0.05);
  assert.ok(rows[1].pAdjusted > rows[0].pAdjusted);
  assert.equal(rows[0].comparison.control, 'POR');
  assert.equal(rows[0].windowShare > 0, true, 'NEW above POR');

  // A box of the test by split says the same thing under the plot, with n in wafers.
  const r = resolvePlot({ id: 'b', chart: 'box', fields: { x: { meta: 'split' }, y: { test: 1, name: 'Shifted' } } }, items, { testDefs: DEFS });
  assert.deepEqual(r.issues, []);
  assert.deepEqual(r.comparison.result.groups.map(g => [g.key, g.n]), [['NEW', 3], ['POR', 3]]);
  assert.match(plotFootnote(r), /by split, wafer means \(wafers: NEW 3, POR 3\): Welch t p < 0\.001, rank p 0\.\d+ \(approximate\)/);

  // Coloured by split with wafers along X, the same comparison; by wafer alone, none.
  const coloured = resolvePlot({ id: 'c', chart: 'box', fields: { x: { builtin: 'wafer' }, y: { test: 1 }, color: { meta: 'split' } } }, items, { testDefs: DEFS });
  assert.equal(coloured.comparison.by, 'Split');
  assert.equal(resolvePlot({ id: 'w', chart: 'box', fields: { x: { builtin: 'wafer' }, y: { test: 1 }, color: { none: true } } }, items, { testDefs: DEFS }).comparison, undefined);
});
