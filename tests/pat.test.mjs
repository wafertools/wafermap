// Dynamic PAT (stats/pat.ts) and its use in plots: per wafer and test, median ± 6 × IQR/1.35 of the passing dies,
// never wider than the test's limits; each die within, a PAT outlier, or outside the test's limits.

import test from 'node:test';
import assert from 'node:assert/strict';
import { buildWaferMap } from '../dist/index.js';
import { waferPatLimits, waferPatVerdicts, PAT_K, PAT_IQR_SIGMA, PAT_MIN_DIES } from '../dist/packages/stats/pat.js';
import { fiveNumberSummary } from '../dist/packages/stats/math.js';
import { resolvePlot, plotFootnote, fieldCatalogue } from '../dist/packages/stats/plotData.js';

const DEFS = [
  { testNumber: 1, name: 'Vth', unit: 'V', limitLow: 0, limitHigh: 10 },
  { testNumber: 2, name: 'Wide', unit: 'V', specLow: 4.9, specHigh: 5.1, limitLow: 0, limitHigh: 10 },
  { testNumber: 3, name: 'Unlimited', unit: 'V' },
];

/**
 * A wafer of 100 dies: Vth = 5 + small spread for most, with an outlier at 5.9 (die 90), one out of limits at 11
 * (die 91), one failing-bin die at 3 (die 92, bin 2); Wide sits at 5 ± 0.01 so its ±6σ band is inside its spec.
 */
function wafer(label, { passBins = [1], failBin = 2, meta = {} } = {}) {
  const results = Array.from({ length: 100 }, (_, k) => {
    const vth = k === 90 ? 5.9 : k === 91 ? 11 : k === 92 ? 3 : 5 + ((k % 10) - 4.5) / 50;
    return { x: k % 10, y: Math.floor(k / 10), hbin: k === 92 ? failBin : passBins[0], testValues: { 1: vth, 2: 5 + ((k % 7) - 3) / 300, 3: k } };
  });
  const r = buildWaferMap({ results, waferConfig: { diameter: 30, metadata: meta }, dieConfig: { width: 2, height: 2 }, passBins, testDefs: DEFS });
  return { label, dies: r.dies, metadata: r.metadata, passBins, ringCount: r.ringCount, wafer: r.wafer };
}

test('PAT limits are median ± 6 robust σ of the passing values inside the limits', () => {
  const w = wafer('W1');
  const pat = waferPatLimits(w.dies, DEFS, w.passBins);
  const vth = pat.limits.get(1);
  // The values the limits are set from: passing dies, inside 0..10 — so not die 91 (11) and not die 92 (bin 2).
  const used = w.dies.filter((_, k) => k !== 91 && k !== 92).map(d => d.testValues[1]);
  const q = fiveNumberSummary(Float64Array.from(used));
  const sigma = (q.q3 - q.q1) / PAT_IQR_SIGMA;
  assert.equal(vth.n, 98);
  assert.ok(Math.abs(vth.median - q.median) < 1e-12);
  assert.ok(Math.abs(vth.lo - (q.median - PAT_K * sigma)) < 1e-12);
  assert.ok(Math.abs(vth.hi - (q.median + PAT_K * sigma)) < 1e-12);
  assert.equal(vth.basis, 'test');
  assert.equal(pat.limits.has(3), false, 'a test without limits is not judged');
});

test('PAT limits never go past the test’s own limits; spec limits bound them when a test has both', () => {
  const w = wafer('W1');
  const wide = waferPatLimits(w.dies, DEFS, w.passBins).limits.get(2);
  assert.equal(wide.basis, 'spec');
  assert.ok(wide.lo >= 4.9 && wide.hi <= 5.1);
  const tight = [{ testNumber: 1, name: 'Vth', unit: 'V', limitLow: 4.95, limitHigh: 5.05 }];
  const clipped = waferPatLimits(wafer('W2').dies, tight, [1]).limits.get(1);
  assert.equal(clipped.lo, 4.95);
  assert.equal(clipped.clippedLo, true);
});

test('verdicts: a passing die far from its wafer is a PAT outlier; a die failing its bin or a limit fails', () => {
  const w = wafer('W1');
  const v = waferPatVerdicts(w.dies, DEFS, w.passBins);
  assert.deepEqual(v[90], { verdict: 'outlier', tests: [1] });
  assert.deepEqual(v[91], { verdict: 'fails', tests: [1] });
  assert.deepEqual(v[92], { verdict: 'fails', tests: [] }, 'a die failing on its bin is not a PAT outlier, however far out');
  assert.equal(v[0].verdict, 'within');
  assert.equal(v.filter(x => x.verdict === 'outlier').length, 1);
});

test('the wafer’s own pass bins decide which dies set the limits', () => {
  // Bin 3 passes; the odd die is in bin 1, which fails here, so its value 3 does not set the limits but is judged.
  const w = wafer('W1', { passBins: [3], failBin: 1 });
  const vth = waferPatLimits(w.dies, DEFS, w.passBins).limits.get(1);
  assert.equal(vth.n, 98);
});

test('too few passing values, or no spread, and a test gets no PAT limits on that wafer', () => {
  const few = waferPatLimits(wafer('W1').dies.slice(0, PAT_MIN_DIES - 1), DEFS, [1]);
  assert.deepEqual(few.skipped.map(s => s.reason), ['few-values', 'few-values']);
  const flatDefs = [{ testNumber: 4, name: 'Flat', limitLow: 0, limitHigh: 2 }];
  const r = buildWaferMap({ results: Array.from({ length: 40 }, (_, k) => ({ x: k % 8, y: Math.floor(k / 8), hbin: 1, testValues: { 4: 1 } })),
    waferConfig: { diameter: 30 }, dieConfig: { width: 2, height: 2 }, passBins: [1], testDefs: flatDefs });
  assert.deepEqual(waferPatLimits(r.dies, flatDefs, [1]).skipped, [{ testNumber: 4, reason: 'no-spread' }]);
});

// ── in plots ──

const ctx = { testDefs: DEFS };
test('PAT as a colour: within, outlier, fails in that order, and the statement says how PAT is set', () => {
  const items = [wafer('W1', { meta: { split: 'A' } }), wafer('W2', { meta: { split: 'B' } })];
  assert.ok(fieldCatalogue(items, ctx).some(f => 'builtin' in f.field && f.field.builtin === 'pat'));
  const r = resolvePlot({ id: 'p', chart: 'scatter', fields: { x: { test: 1 }, y: { test: 3 }, color: { builtin: 'pat' } } }, items, ctx);
  assert.deepEqual(r.issues, []);
  assert.deepEqual(r.groups, ['Within PAT limits', 'PAT outlier', 'Fails (bin or limits)']);
  assert.match(plotFootnote(r), /PAT per wafer: median ± 6 × \(Q3 − Q1\) \/ 1\.35 of its passing dies, within the test's limits/);
  assert.equal(r.x.limits.patLow, undefined, 'two wafers have two sets of PAT limits: no line');
});

test('a plot of one wafer draws its PAT limits; panels by wafer each draw their own', () => {
  const one = resolvePlot({ id: 'h', chart: 'histogram', fields: { y: { test: 1 } } }, [wafer('W1')], ctx);
  const own = waferPatLimits(one.marks ? wafer('W1').dies : [], DEFS, [1]).limits.get(1);
  assert.ok(Math.abs(one.x.limits.patLow - own.lo) < 1e-12);
  assert.ok(one.usesPat);
  const panels = resolvePlot({ id: 'f', chart: 'histogram', fields: { y: { test: 1 }, facet: { builtin: 'wafer' } } }, [wafer('W1'), wafer('W2')], ctx);
  assert.ok(panels.facets.every(f => Number.isFinite(f.plot.x.limits.patLow)));
});

test('a panel of part of a wafer judges its dies by the whole wafer’s PAT limits', () => {
  const w = wafer('W1');
  const whole = resolvePlot({ id: 'a', chart: 'bar', fields: { x: { builtin: 'pat' }, color: { none: true } } }, [w], ctx);
  const byQuadrant = resolvePlot({ id: 'b', chart: 'bar', fields: { x: { builtin: 'pat' }, color: { none: true }, facet: { builtin: 'quadrant' } } }, [w], ctx);
  const count = r => Object.fromEntries(r.marks.categories.map((c, i) => [c, r.marks.values[0][i]]));
  const total = { 'Within PAT limits': 0, 'PAT outlier': 0, 'Fails (bin or limits)': 0 };
  for (const f of byQuadrant.facets) for (const [k, n] of Object.entries(count(f.plot))) total[k] += n;
  assert.deepEqual(total, count(whole), 'the quadrants’ verdicts add up to the wafer’s');
});
