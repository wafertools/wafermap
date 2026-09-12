import test from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveBinColors,
  getBinColorScheme,
  listBinColorSchemes,
  listValueColorSchemes,
  registerBinColorScheme,
  buildView,
  createWafer,
  generateDies,
} from '../dist/index.js';

const PAL = getBinColorScheme('default');
const dies = (spec) => spec.flatMap(([hbin, sbin, n = 1]) => Array.from({ length: n }, () => ({ hbin, sbin })));

// ── Pass/fail comes from passBins, never the bin number ──────────────────────

test('resolveBinColors — a pass bin takes a pass colour whatever its number', () => {
  const c = resolveBinColors(dies([[3, undefined, 5], [1, undefined, 5]]), { passBins: [3] });
  assert.ok(PAL.pass.includes(c.hard.get(3)), 'bin 3 is the pass bin and must be green');
  assert.ok(PAL.fail.includes(c.hard.get(1)), 'bin 1 is failing here and must not be green');
});

test('resolveBinColors — with two pass bins, both are pass colours and distinct', () => {
  const c = resolveBinColors(dies([[1, undefined, 9], [3, undefined, 4], [2, undefined, 2]]), { passBins: [1, 3] });
  assert.ok(PAL.pass.includes(c.hard.get(1)));
  assert.ok(PAL.pass.includes(c.hard.get(3)));
  assert.notEqual(c.hard.get(1), c.hard.get(3));
  assert.ok(PAL.fail.includes(c.hard.get(2)));
});

// ── Rank, not hash ───────────────────────────────────────────────────────────

test('resolveBinColors — the most populous fail bin takes the first fail colour', () => {
  const c = resolveBinColors(dies([[1, undefined, 50], [7, undefined, 3], [42, undefined, 30]]));
  assert.equal(c.hard.get(42), PAL.fail[0]);
  assert.equal(c.hard.get(7), PAL.fail[1]);
});

test('resolveBinColors — ties break by bin number, so the result is deterministic', () => {
  const a = resolveBinColors(dies([[9, undefined, 2], [4, undefined, 2]]));
  const b = resolveBinColors(dies([[4, undefined, 2], [9, undefined, 2]]));
  assert.deepEqual([...a.hard], [...b.hard].sort((x, y) => [...a.hard.keys()].indexOf(x[0]) - [...a.hard.keys()].indexOf(y[0])));
  assert.equal(a.hard.get(4), PAL.fail[0]);
});

test('resolveBinColors — no two bins share a colour until the palette runs out', () => {
  const spec = Array.from({ length: PAL.fail.length }, (_, i) => [100 + i, undefined, 1]);
  const c = resolveBinColors(dies([[1, undefined, 1], ...spec]));
  assert.equal(new Set(c.hard.values()).size, c.hard.size);
  assert.deepEqual(c.shared.hard, []);
});

test('resolveBinColors — one fail bin past the palette is reported in `shared`', () => {
  const spec = Array.from({ length: PAL.fail.length + 1 }, (_, i) => [100 + i, undefined, 1]);
  const c = resolveBinColors(dies(spec));
  assert.ok(c.shared.hard.length >= 2, 'the extra bin and the bin it repeats must both be named');
});

// ── Soft bins ────────────────────────────────────────────────────────────────

test('resolveBinColors — a soft bin passes only when every die carrying it passes', () => {
  const c = resolveBinColors(dies([
    [1, 10, 4],               // sbin 10: all dies pass
    [1, 11, 3], [2, 11, 1],   // sbin 11: one failing die
    [2, 12, 2],               // sbin 12: all fail
  ]));
  assert.ok(PAL.pass.includes(c.soft.get(10)));
  assert.ok(PAL.fail.includes(c.soft.get(11)));
  assert.ok(PAL.fail.includes(c.soft.get(12)));
});

test('resolveBinColors — hard and soft bins are resolved in separate number spaces', () => {
  const c = resolveBinColors(dies([[2, 2, 3]]));
  assert.ok(c.hard.has(2) && c.soft.has(2));
  assert.equal(c.hard.size, 1);
  assert.equal(c.soft.size, 1);
});

// ── Colours from bin definitions ─────────────────────────────────────────────

test('resolveBinColors — BinDef.color wins and takes no palette slot', () => {
  const c = resolveBinColors(dies([[1, undefined, 1], [5, undefined, 9], [6, undefined, 4]]), {
    hbinDefs: [{ bin: 5, name: 'Open', color: '#123456' }] });
  assert.equal(c.hard.get(5), '#123456');
  // Bin 6 is the biggest bin still on the palette, so it gets the first slot.
  assert.equal(c.hard.get(6), PAL.fail[0]);
});

test('resolveBinColors — useDefinedBinColors: false ignores BinDef.color', () => {
  const c = resolveBinColors(dies([[5, undefined, 1]]), {
    hbinDefs: [{ bin: 5, name: 'Open', color: '#123456' }], useDefinedBinColors: false });
  assert.notEqual(c.hard.get(5), '#123456');
});

test('resolveBinColors — a defined colour equal to a palette colour is reported as shared', () => {
  const c = resolveBinColors(dies([[5, undefined, 9], [6, undefined, 1]]), {
    hbinDefs: [{ bin: 6, name: 'Dup', color: PAL.fail[0] }] });
  assert.deepEqual(c.shared.hard, [5, 6]);
});

// ── Registries ───────────────────────────────────────────────────────────────

test('bin palettes and value gradients are separate registries', () => {
  const bins = listBinColorSchemes().map((s) => s.name);
  const values = listValueColorSchemes().map((s) => s.name);
  assert.deepEqual(bins.slice(0, 2), ['default', 'accessible']);
  assert.ok(!bins.includes('viridis'), 'a gradient is not a bin palette');
  assert.ok(values.includes('cividis') && values.includes('mako'));
  assert.ok(!values.includes('thermal'), 'thermal duplicated default exactly and was removed');
  assert.ok(!values.includes('viridis'), 'viridis IS the default — a separate row would draw the same map twice');
});

test('registerBinColorScheme — rejects an empty pass or fail list', () => {
  assert.throws(() => registerBinColorScheme('empty-fail', { label: 'x', pass: ['#0f0'], fail: [] }));
  assert.throws(() => registerBinColorScheme('empty-pass', { label: 'x', pass: [], fail: ['#f00'] }));
});

test('registerBinColorScheme — a registered palette is used by name', () => {
  registerBinColorScheme('test-brand', { label: 'Brand', pass: ['#00ff00'], fail: ['#ff0000', '#0000ff'] });
  const c = resolveBinColors(dies([[1, undefined, 1], [2, undefined, 1]]), { binColorScheme: 'test-brand' });
  assert.equal(c.hard.get(1), '#00ff00');
  assert.equal(c.hard.get(2), '#ff0000');
  assert.ok(listBinColorSchemes().some((s) => s.name === 'test-brand'));
});

// ── buildView ────────────────────────────────────────────────────────────────

function viewDies(assign) {
  const wafer = createWafer({ diameter: 60 });
  const ds = generateDies(wafer, { width: 10, height: 10 }).slice(0, assign.length)
    .map((d, i) => ({ ...d, partial: false, ...assign[i] }));
  return { wafer, ds };
}

test('buildView — the soft-bin failing-die hatch judges the die, not the soft bin number', () => {
  // Soft bin 1 on a failing die, soft bin 2 on a passing die. Comparing the
  // soft number against hard pass bins [1] hatched exactly the wrong one.
  const { wafer, ds } = viewDies([{ hbin: 2, sbin: 1 }, { hbin: 1, sbin: 2 }]);
  const v = buildView(wafer, ds, { plotMode: 'softBin', passBins: [1] });
  const byBin = new Map(v.rectangles.map((r, i) => [ds[i].sbin, r]));
  assert.equal(byBin.get(1).binFail, true);
  assert.equal(byBin.get(2).binFail, undefined);
});

test('buildView — die fills come from the resolved colours exposed on the view', () => {
  const { wafer, ds } = viewDies([{ hbin: 1 }, { hbin: 2 }]);
  const v = buildView(wafer, ds, { plotMode: 'hardBin', passBins: [1] });
  assert.equal(v.rectangles[0].fill, v.binColors.hard.get(1));
  assert.equal(v.rectangles[1].fill, v.binColors.hard.get(2));
  assert.equal(v.binColorScheme, 'default');
  assert.equal(v.valueColorScheme, 'default');
});

test('buildView — a supplied lot-wide assignment is used when it covers every bin', () => {
  const { wafer, ds } = viewDies([{ hbin: 2 }]);
  const lot = resolveBinColors(dies([[2, undefined, 1], [3, undefined, 50]]));
  const v = buildView(wafer, ds, { plotMode: 'hardBin', binColors: lot });
  // Bin 3 dominates the lot, so bin 2 is NOT the first fail colour lot-wide —
  // though it would be if this wafer ranked its own bins.
  assert.equal(v.rectangles[0].fill, lot.hard.get(2));
  assert.notEqual(v.rectangles[0].fill, PAL.fail[0]);
});

test('buildView — a supplied assignment missing a bin is ignored, never leaving a bin uncoloured', () => {
  const { wafer, ds } = viewDies([{ hbin: 2 }, { hbin: 9 }]);
  const stale = resolveBinColors(dies([[2, undefined, 1]]));
  const v = buildView(wafer, ds, { plotMode: 'hardBin', binColors: stale });
  assert.ok(v.binColors.hard.has(9));
  assert.equal(v.rectangles[1].fill, v.binColors.hard.get(9));
});
