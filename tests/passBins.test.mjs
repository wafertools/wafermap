// Pass bins travel with the result.
//
// `buildWaferMap` used its `passBins` for `result.yield` and kept no copy, so every
// later surface — analysis, bin colours and legend order, the Summary panel and
// report, region yield, Insights, the gallery strip, even the result's own view —
// fell back to `[1]` unless the caller repeated the value. tsmap gives each wafer's
// pass bins to `buildWaferMap` and nothing else, so a program whose bins 1 and 2
// both pass showed bin 2 as a failure everywhere but the one yield figure.
//
// `[1]` is now a default only at the input; these guard that the value reaches
// every consumer, per wafer where a lot mixes programs.

import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { pretendToBeVisual: true, url: 'http://localhost/' });
for (const k of ['window', 'document', 'HTMLElement', 'HTMLCanvasElement', 'HTMLDivElement', 'HTMLButtonElement', 'Node', 'Event', 'MouseEvent', 'KeyboardEvent', 'CustomEvent', 'Blob', 'DOMRect', 'URL']) {
  if (dom.window[k]) globalThis[k] = dom.window[k];
}
globalThis.window = dom.window;
globalThis.document = dom.window.document;
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
globalThis.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
const mm = () => ({ matches: false, media: '', addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false });
dom.window.matchMedia = mm; globalThis.matchMedia = mm;
class FakeResizeObserver { observe() {} unobserve() {} disconnect() {} }
dom.window.ResizeObserver = FakeResizeObserver; globalThis.ResizeObserver = FakeResizeObserver;
dom.window.devicePixelRatio = 1;
const noop = () => {};
const proto = dom.window.HTMLCanvasElement.prototype;
proto.getContext = () => new Proxy({}, { get: (_, p) => {
  if (p === 'measureText') return (t) => ({ width: String(t).length * 6 });
  if (p === 'createLinearGradient' || p === 'createRadialGradient') return () => ({ addColorStop: noop });
  if (p === 'getImageData') return () => ({ data: [] });
  if (p === 'canvas') return { width: 400, height: 400 };
  return noop;
} });
proto.focus = noop; proto.setPointerCapture = noop; proto.releasePointerCapture = noop;
Object.defineProperty(proto, 'clientWidth', { configurable: true, get() { return 400; } });
Object.defineProperty(proto, 'clientHeight', { configurable: true, get() { return 400; } });

const { buildWaferMap, analyzeWaferMap, buildYieldData, buildRegionYieldData, buildRingRegions } = await import('../dist/index.js');
const { renderWaferMap, renderWaferGallery } = await import('../dist/packages/canvas-adapter/index.js');
const { resolveBinColors, resolveBinColorsByWafer, binPassSetsByWafer } = await import('../dist/packages/renderer/binColors.js');
const { passBinsLabel } = await import('../dist/packages/core/passBins.js');

// 8 dies: two each of bins 1 and 2, four of bin 3.
const HBINS = [1, 1, 2, 2, 3, 3, 3, 3];

function wafer(label, passBins) {
  const built = buildWaferMap({
    results: HBINS.map((hbin, i) => ({ x: i % 4, y: Math.floor(i / 4), hbin })),
    waferConfig: { diameter: 80 },
    dieConfig: { width: 10, height: 10 },
    ...(passBins ? { passBins } : {}),
  });
  return { ...built, label };
}

const tick = () => new Promise((r) => setTimeout(r, 60));

// ── The result ───────────────────────────────────────────────────────────────

test('buildWaferMap — the result carries the pass bins it was built with', () => {
  assert.deepEqual(wafer('A', [1, 2]).passBins, [1, 2]);
  assert.deepEqual(wafer('A').passBins, [1], '[1] only where the input states none');
});

test('buildWaferMap — the result\'s own view judges pass with them, not buildView\'s default', () => {
  const r = wafer('A', [1, 2]);
  assert.ok(r.view.binColors.pass.hard.has(2), 'bin 2 passes on the internal view too');
});

test('analyzeWaferMap — defaults to the result\'s pass bins', () => {
  const r = wafer('A', [1, 2]);
  assert.equal(r.yield.yieldPercent, 50);
  const summary = analyzeWaferMap(r);
  assert.equal(summary.stats.yieldPercent, 50, 'same verdicts as result.yield');
  // Bin 2 is a pass here, so a yield finding must never name it as a failing bin.
  assert.ok(!summary.findings.some((f) => f.variable?.kind === 'bin' && f.variable.bin === 2),
    'bin 2 is not analysed as a failure');
});

// ── Per-wafer verdicts ───────────────────────────────────────────────────────

test('resolveBinColorsByWafer — each wafer judged by its own; disagreement is named', () => {
  const a = wafer('A', [1, 2]), b = wafer('B', [1]);
  const { colors, mixedHardBins } = resolveBinColorsByWafer([
    { dies: a.dies, passBins: a.passBins }, { dies: b.dies, passBins: b.passBins }]);
  assert.deepEqual(mixedHardBins, [2]);
  assert.ok(colors.pass.hard.has(1));
  assert.ok(!colors.pass.hard.has(2), 'a bin that fails anywhere cannot be coloured as a pass');
  assert.deepEqual([...binPassSetsByWafer([{ dies: a.dies, passBins: a.passBins }, { dies: b.dies, passBins: b.passBins }]).hard], [...colors.pass.hard]);
});

test('resolveBinColorsByWafer — one wafer resolves exactly as resolveBinColors does', () => {
  const a = wafer('A', [1, 2]);
  const one = resolveBinColorsByWafer([{ dies: a.dies, passBins: [1, 2] }]);
  const direct = resolveBinColors(a.dies, { passBins: [1, 2] });
  assert.deepEqual([...one.colors.hard], [...direct.hard]);
  assert.deepEqual([...one.colors.pass.hard].sort(), [...direct.pass.hard].sort());
  assert.deepEqual(one.mixedHardBins, []);
});

test('buildYieldData — an item\'s own pass bins win over the argument', () => {
  const a = wafer('A', [1, 2]), b = wafer('B', [1]);
  const rows = buildYieldData([
    { label: 'A', dies: a.dies, passBins: a.passBins },
    { label: 'B', dies: b.dies },
  ], [1]);
  assert.equal(rows.find((r) => r.label === 'A').percent, 50);
  assert.equal(rows.find((r) => r.label === 'B').percent, 25);
});

test('buildRegionYieldData — a per-wafer lookup matches a set given directly', () => {
  const a = wafer('A', [1, 2]);
  const direct = buildRegionYieldData([a.dies], [a.wafer], 4, [1, 2], buildRingRegions);
  const lookup = buildRegionYieldData([a.dies], [a.wafer], 4, () => [1, 2], buildRingRegions);
  assert.deepEqual(lookup, direct);
  const byOne = buildRegionYieldData([a.dies], [a.wafer], 4, [1], buildRingRegions);
  assert.notDeepEqual(lookup, byOne, 'and the pass bins actually change the result');
});

test('passBinsLabel — names one set, or says the wafers differ', () => {
  assert.equal(passBinsLabel([[1]]), 'bin 1');
  assert.equal(passBinsLabel([[1, 2], [2, 1]]), 'bins 1, 2', 'the same set in another order is one set');
  assert.equal(passBinsLabel([[1], [1, 2]]), 'per wafer: bin 1 · bins 1, 2');
});

// ── Renderers ────────────────────────────────────────────────────────────────

function codesFrom(mountFn) {
  const seen = [];
  const ctrl = mountFn((ws) => { seen.splice(0, seen.length, ...ws.map((w) => w.code)); });
  return { seen, ctrl };
}

test('renderWaferGallery — the strip yield judges every wafer by its own pass bins', async () => {
  const root = dom.window.document.getElementById('root');
  root.innerHTML = '';
  // A: bins 1+2 pass → 4 of 8. B: bin 1 passes → 2 of 8. Per wafer: 6 / 16 = 37.5%.
  // One gallery-wide [1] would read 4 / 16 = 25%.
  const ctrl = renderWaferGallery(root, [wafer('A', [1, 2]), wafer('B', [1])], { viewOptions: { plotMode: 'hardBin' } });
  await tick();
  const m = /Yield (\d+(?:\.\d+)?)%/.exec(root.textContent);
  assert.ok(m, `no yield on the strip: ${root.textContent.slice(0, 200)}`);
  assert.equal(Number(m[1]), 37.5);
  ctrl.destroy();
});

test('renderWaferGallery — wafers that disagree about a present bin raise pass-bins-mixed', async () => {
  const root = dom.window.document.getElementById('root');
  root.innerHTML = '';
  const { seen, ctrl } = codesFrom((onWarning) =>
    renderWaferGallery(root, [wafer('A', [1, 2]), wafer('B', [1])], { warnings: { onWarning } }));
  await tick();
  assert.ok(seen.includes('pass-bins-mixed'), `codes: ${seen}`);
  ctrl.destroy();
});

test('renderWaferGallery — wafers that agree raise nothing', async () => {
  const root = dom.window.document.getElementById('root');
  root.innerHTML = '';
  const { seen, ctrl } = codesFrom((onWarning) =>
    renderWaferGallery(root, [wafer('A', [1, 2]), wafer('B', [2, 1])], { warnings: { onWarning } }));
  await tick();
  assert.ok(!seen.includes('pass-bins-mixed'), `codes: ${seen}`);
  ctrl.destroy();
});
