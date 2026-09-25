import test from 'node:test';
import assert from 'node:assert/strict';
import { listBinColorSchemes, listValueColorSchemes, registerBinColorScheme } from '../dist/index.js';
import { resolveBinColors } from '../dist/packages/renderer/binColors.js';
import { getBinColorScheme } from '../dist/packages/renderer/colorSchemes.js';
import { buildView } from '../dist/packages/renderer/buildView.js';
import { createWafer } from '../dist/packages/core/wafer.js';
import { generateDies } from '../dist/packages/core/dies.js';

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

// ── By bin number, never by die count ────────────────────────────────────────

test('resolveBinColors — a bin keeps its colour whatever its die count', () => {
  // Same bins, opposite populations. Ranking by count swapped these two
  // colours between lots, so two screenshots of one program disagreed.
  const a = resolveBinColors(dies([[1, undefined, 50], [7, undefined, 30], [42, undefined, 3]]));
  const b = resolveBinColors(dies([[1, undefined, 50], [7, undefined, 3], [42, undefined, 30]]));
  assert.equal(a.hard.get(7), b.hard.get(7));
  assert.equal(a.hard.get(42), b.hard.get(42));
  assert.notEqual(a.hard.get(7), a.hard.get(42));
});

test('resolveBinColors — a bin keeps its colour whichever other bins are present', () => {
  const alone = resolveBinColors(dies([[9, undefined, 1]]));
  const crowd = resolveBinColors(dies([[2, undefined, 5], [3, undefined, 5], [9, undefined, 1]]));
  assert.equal(alone.hard.get(9), crowd.hard.get(9));
});

test('resolveBinColors — bin 1 takes the first pass colour, bin 2 the first fail colour', () => {
  const c = resolveBinColors(dies([[1, undefined, 1], [2, undefined, 1], [3, undefined, 1]]));
  assert.equal(c.hard.get(1), PAL.pass[0]);
  assert.equal(c.hard.get(2), PAL.fail[0]);
  assert.equal(c.hard.get(3), PAL.fail[1]);
});

test('resolveBinColors — changing passBins recolours only the bins whose verdict changed', () => {
  const spec = dies([[1, undefined, 1], [3, undefined, 1], [5, undefined, 1]]);
  const a = resolveBinColors(spec, { passBins: [1] });
  const b = resolveBinColors(spec, { passBins: [1, 3] });
  assert.equal(a.hard.get(5), b.hard.get(5));
  assert.notEqual(a.hard.get(3), b.hard.get(3));
});

test('resolveBinColors — consecutive fail bins are distinct for a whole palette', () => {
  const spec = Array.from({ length: PAL.fail.length }, (_, i) => [2 + i, undefined, 1]);
  const c = resolveBinColors(dies([[1, undefined, 1], ...spec]));
  assert.equal(new Set(c.hard.values()).size, c.hard.size);
  assert.deepEqual(c.shared.hard, []);
});

test('resolveBinColors — fail bins a palette-length apart share a colour and are reported', () => {
  const n = PAL.fail.length;
  const c = resolveBinColors(dies([[2, undefined, 1], [2 + n, undefined, 1]]));
  assert.equal(c.hard.get(2), c.hard.get(2 + n));
  assert.deepEqual(c.shared.hard, [2, 2 + n]);
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

test('resolveBinColors — hard bin n and soft bin n are different colours', () => {
  for (const name of ['default', 'accessible']) {
    for (let n = 1; n <= 16; n++) {
      const c = resolveBinColors(dies([[n, n, 1]]), { binColorScheme: name });
      assert.notEqual(c.hard.get(n), c.soft.get(n), `${name}: hard and soft bin ${n}`);
    }
  }
});

// ── Pass sets ────────────────────────────────────────────────────────────────

test('resolveBinColors — `pass` names the passing bins of each type by their own verdict', () => {
  const c = resolveBinColors(dies([
    [1, 100, 4],               // sbin 100: every die passes
    [1, 101, 1], [3, 101, 1],  // sbin 101: one failing die
    [3, 1, 2],                 // sbin 1: numbered like the hard pass bin, but its dies fail
  ]));
  assert.deepEqual([...c.pass.hard].sort((a, b) => a - b), [1]);
  assert.deepEqual([...c.pass.soft], [100], 'soft bin 1 must not pass just because hard bin 1 does');
});

test('binPassSets — the same verdict resolveBinColors colours with', async () => {
  const { binPassSets } = await import('../dist/packages/renderer/binColors.js');
  const spec = dies([[1, 100, 3], [2, 200, 1], [1, 200, 1], [4, 401, 2]]);
  const c = resolveBinColors(spec, { passBins: [1, 4] });
  const p = binPassSets(spec, [1, 4]);
  assert.deepEqual([...p.hard].sort(), [...c.pass.hard].sort());
  assert.deepEqual([...p.soft].sort(), [...c.pass.soft].sort());
});

test('sortBinsForDisplay — a soft pass set pins soft pass bins, not hard pass numbers', async () => {
  const { sortBinsForDisplay } = await import('../dist/packages/stats/binPareto.js');
  // Soft bin 100 passes; soft bin 1 is a failing bin that happens to share hard pass bin 1's number.
  const order = sortBinsForDisplay([[1, 2], [301, 40], [100, 500], [502, 9]], new Set([100])).map(([b]) => b);
  assert.deepEqual(order, [100, 301, 502, 1]);
});

test('buildView — an assignment without `pass` (an older object) is resolved afresh, not trusted', () => {
  const { wafer, ds } = viewDies([{ hbin: 1, sbin: 100 }]);
  const old = resolveBinColors(dies([[1, 100, 1]]));
  delete old.pass;
  const v = buildView(wafer, ds, { plotMode: 'softBin', binColors: old });
  assert.ok(v.binColors.pass?.soft.has(100));
});

// ── Colours from bin definitions ─────────────────────────────────────────────

test('resolveBinColors — BinDef.color wins and leaves every other bin on its own slot', () => {
  const c = resolveBinColors(dies([[1, undefined, 1], [5, undefined, 9], [6, undefined, 4]]), {
    hbinDefs: [{ bin: 5, name: 'Open', color: '#123456' }] });
  assert.equal(c.hard.get(5), '#123456');
  assert.equal(c.hard.get(6), PAL.fail[6 - 2]);
});

test('resolveBinColors — useDefinedBinColors: false ignores BinDef.color', () => {
  const c = resolveBinColors(dies([[5, undefined, 1]]), {
    hbinDefs: [{ bin: 5, name: 'Open', color: '#123456' }], useDefinedBinColors: false });
  assert.notEqual(c.hard.get(5), '#123456');
});

test('resolveBinColors — a defined colour equal to a palette colour is reported as shared', () => {
  const c = resolveBinColors(dies([[5, undefined, 9], [6, undefined, 1]]), {
    hbinDefs: [{ bin: 6, name: 'Dup', color: PAL.fail[5 - 2] }] });
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
  // The colour comes from another item's bin definition, which this wafer's
  // own view options do not carry — only the lot-wide assignment knows it.
  const lot = resolveBinColors(dies([[2, undefined, 1], [3, undefined, 50]]), {
    hbinDefs: [{ bin: 2, name: 'Open', color: '#123456' }] });
  const v = buildView(wafer, ds, { plotMode: 'hardBin', binColors: lot });
  assert.equal(v.rectangles[0].fill, '#123456');
});

test('buildView — a supplied assignment missing a bin is ignored, never leaving a bin uncoloured', () => {
  const { wafer, ds } = viewDies([{ hbin: 2 }, { hbin: 9 }]);
  const stale = resolveBinColors(dies([[2, undefined, 1]]));
  const v = buildView(wafer, ds, { plotMode: 'hardBin', binColors: stale });
  assert.ok(v.binColors.hard.has(9));
  assert.equal(v.rectangles[1].fill, v.binColors.hard.get(9));
});
