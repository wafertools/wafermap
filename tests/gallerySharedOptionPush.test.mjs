// A gallery resolving its wafers one at a time must not redraw the cards already
// on screen for an option whose VALUE did not change.
//
// All three lot-wide options (binColors, valueRange, metadataValueOrder) are
// re-derived from the whole population after every resolution, and each
// derivation allocates a fresh object, so `prev !== next` is true even when the
// lot's bins and range are identical. Each card's setOptions is unconditional —
// any patch rebuilds the view and redraws the canvas — so an unchanged push cost
// a full redraw of every card on screen for no visible difference, and the load
// did n(n+1)/2 of them. Measured in Chrome on 50 wafers x 8,000 dies x 50 tests:
// 1,275 bin-colour pushes, 24 s of a 64 s load.
//
// The per-draw counter here is `ctx.scale`, which drawMapCanvas calls exactly
// once per pass (toCanvas.ts, immediately after sizing the backing store) and
// nowhere else — so it counts draw PASSES, not primitives.
//
// Written as .mjs deliberately: `npm test` runs `tests/*.test.mjs` only.

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

// Draw passes per canvas element. `scale` is drawMapCanvas's once-per-pass call.
const drawsByCanvas = new WeakMap();
const draws = (canvas) => drawsByCanvas.get(canvas) ?? 0;
const proto = dom.window.HTMLCanvasElement.prototype;
proto.getContext = function () {
  const canvas = this;
  return new Proxy({}, { get: (_, p) => {
    if (p === 'scale') return () => drawsByCanvas.set(canvas, (drawsByCanvas.get(canvas) ?? 0) + 1);
    if (p === 'measureText') return (t) => ({ width: String(t).length * 6 });
    if (p === 'createLinearGradient' || p === 'createRadialGradient') return () => ({ addColorStop: noop });
    if (p === 'getImageData') return () => ({ data: [] });
    if (p === 'canvas') return canvas;
    return noop;
  } });
};
proto.focus = noop; proto.setPointerCapture = noop; proto.releasePointerCapture = noop;
Object.defineProperty(proto, 'clientWidth', { configurable: true, get() { return 400; } });
Object.defineProperty(proto, 'clientHeight', { configurable: true, get() { return 400; } });

const { buildWaferMap } = await import('../dist/index.js');
const { renderWaferGallery } = await import('../dist/packages/canvas-adapter/index.js');
const { analyzeWaferMap, analyzeWaferLot } = await import('../dist/packages/stats/index.js');
const { binColorsEqual, resolveBinColors } = await import('../dist/packages/renderer/binColors.js');
const { arrayEqual, mapEqual, setEqual } = await import('../dist/packages/core/utils.js');

/** One wafer whose dies carry the given hard bins, cycling. */
function wafer(label, bins) {
  const built = buildWaferMap({
    results: Array.from({ length: 12 }, (_, i) => ({ x: i % 4, y: Math.floor(i / 4), hbin: bins[i % bins.length], sbin: 1 })),
    waferConfig: { diameter: 60 },
    dieConfig: { width: 10, height: 10 },
    passBins: [1],
  });
  return { ...built, label };
}

/** Let the gallery's setTimeout(0) resolution chain and rAF callbacks run. */
async function settle(turns = 12) {
  for (let i = 0; i < turns; i++) await new Promise(r => dom.window.setTimeout(r, 0));
}

const cardCanvases = (root) => [...root.querySelectorAll('.wmap-gallery-card canvas')];

// ── The rule, stated directly ───────────────────────────────────────────────

test('a resolved wafer that introduces no new bin does not redraw the cards on screen', async () => {
  const root = dom.window.document.getElementById('root');
  root.innerHTML = '';
  // Every wafer carries the same two bins, so every re-derivation of the
  // lot-wide colours produces an equal value — and must push nothing.
  const items = Array.from({ length: 5 }, (_, i) => wafer(`W0${i + 1}`, [1, 4]));
  const ctrl = renderWaferGallery(root, items.map(it => () => it), {});
  await settle(40);

  const canvases = cardCanvases(root);
  assert.equal(canvases.length, 5, 'all five factories resolved');
  // The first card has been on screen throughout. Its own first draw, plus at
  // most the shared-legend/fit follow-ups — nowhere near one per later wafer.
  assert.ok(draws(canvases[0]) <= 3,
    `first card drew ${draws(canvases[0])} times; before the equality check it drew once per later resolution`);
  ctrl.destroy();
});

test('total draw passes over a factory load grow linearly, not quadratically', async () => {
  const root = dom.window.document.getElementById('root');
  const total = async (n) => {
    root.innerHTML = '';
    const items = Array.from({ length: n }, (_, i) => wafer(`W${i + 1}`, [1, 4]));
    const ctrl = renderWaferGallery(root, items.map(it => () => it), {});
    await settle(n * 8);
    const cs = cardCanvases(root);
    assert.equal(cs.length, n, `all ${n} factories resolved`);
    const sum = cs.reduce((a, c) => a + draws(c), 0);
    ctrl.destroy();
    return sum;
  };
  const small = await total(4);
  const large = await total(12);
  // Linear would be 3x for 3x the wafers; quadratic is ~9x. The bound sits well
  // clear of both, so this fails on a return of per-resolution pushes without
  // becoming a brittle exact-count assertion.
  assert.ok(large < small * 4.5,
    `4 wafers drew ${small} times, 12 wafers drew ${large} — more than linear growth`);
});

// ── The lot panel settles once the lot is in ────────────────────────────────

test('the lot summary panel describes the whole lot once every factory has resolved', async () => {
  const root = dom.window.document.getElementById('root');
  root.innerHTML = '';
  const items = Array.from({ length: 4 }, (_, i) => wafer(`W0${i + 1}`, [1, 4]))
    .map(it => ({ ...it, statsSummary: analyzeWaferMap(it) }));
  const lot = analyzeWaferLot(items, { perWaferSummaries: items.map(i => i.statsSummary) });
  const ctrl = renderWaferGallery(root, items.map(it => () => it), {
    lotStatsSummary: lot,
    summaryPanel: { placement: 'right' },
  });
  await settle(60);
  // Scoped to the panel, NOT root.textContent: every card renders its own label
  // too, so a root-wide search passes even when the panel is empty and proves
  // nothing. The panel carries no class of its own, so it is found by the two
  // inline styles the gallery gives it and the sticky gallery header does not.
  const panel = [...root.querySelectorAll('div')].find(
    d => d.style.position === 'sticky' && d.style.maxHeight === 'calc(100vh - 80px)');
  assert.ok(panel, 'the placed summary panel is mounted');
  // renderLotSummaryContent pools every die of every resolved item and recomputes
  // its sections from that pool, so it runs once at the end rather than once per
  // resolution — but it must still have run, and describe every wafer.
  assert.match(panel.textContent, /Summary —/, 'the panel rendered at all');
  for (const label of ['W01', 'W02', 'W03', 'W04']) {
    assert.ok(panel.textContent.includes(label), `panel names ${label} once the lot is in`);
  }
  ctrl.destroy();
});

// ── onItemsResolved: one settle signal, whichever path the items took ───────

test('onItemsResolved fires once per build for factories AND for pre-built items', async () => {
  const root = dom.window.document.getElementById('root');
  const items = Array.from({ length: 4 }, (_, i) => wafer(`W0${i + 1}`, [1, 4]));

  for (const [label, entries] of [['factories', items.map(it => () => it)], ['pre-built', items]]) {
    root.innerHTML = '';
    let calls = 0;
    const ctrl = renderWaferGallery(root, entries, { onItemsResolved: () => calls++ });
    // Never synchronously: the host must have the controller in hand first.
    assert.equal(calls, 0, `${label}: not called before renderWaferGallery returns`);
    await settle(40);
    assert.equal(calls, 1, `${label}: called exactly once`);
    // And by then the gallery really is settled, not merely mounted.
    assert.equal(cardCanvases(root).length, 4, `${label}: every card is built by then`);
    ctrl.destroy();
  }
});

test('onItemResolved counts up to total, once per card, on both paths', async () => {
  const root = dom.window.document.getElementById('root');
  const items = Array.from({ length: 5 }, (_, i) => wafer(`W0${i + 1}`, [1, 4]));

  // Factories: one call per card, strictly ascending, ending at total. A host
  // bar that jumps or repeats a number is the defect this guards.
  root.innerHTML = '';
  let seen = [];
  let ctrl = renderWaferGallery(root, items.map(it => () => it), {
    onItemResolved: (resolved, total) => seen.push([resolved, total]),
  });
  assert.deepEqual(seen, [], 'not called before renderWaferGallery returns');
  await settle(40);
  assert.deepEqual(seen.map(([r]) => r), [1, 2, 3, 4, 5], 'factories: one call per card, ascending');
  assert.ok(seen.every(([, t]) => t === 5), 'factories: total is the expected count in every call');
  ctrl.destroy();

  // Pre-built: exactly one call, already complete, so a host needs no branch.
  root.innerHTML = '';
  seen = [];
  ctrl = renderWaferGallery(root, items, {
    onItemResolved: (resolved, total) => seen.push([resolved, total]),
  });
  assert.deepEqual(seen, [], 'not called before renderWaferGallery returns');
  await settle(40);
  assert.deepEqual(seen, [[5, 5]], 'pre-built: one call, resolved === total');
  ctrl.destroy();
});

test('onItemResolved reports pre-built items before the factories in a mixed set', async () => {
  const root = dom.window.document.getElementById('root');
  root.innerHTML = '';
  const items = Array.from({ length: 5 }, (_, i) => wafer(`W0${i + 1}`, [1, 4]));
  // Two pre-built, three factories — the pre-built pair already has cards when
  // resolution starts, so reporting them one-by-one would invent progress that
  // never happened, and omitting them would make the bar start at 0 of 5 with
  // two cards already on screen.
  const mixed = [items[0], items[1], () => items[2], () => items[3], () => items[4]];
  const seen = [];
  const ctrl = renderWaferGallery(root, mixed, {
    onItemResolved: (resolved, total) => seen.push([resolved, total]),
  });
  await settle(40);
  assert.deepEqual(seen, [[2, 5], [3, 5], [4, 5], [5, 5]], 'pre-built reported once, then one per factory');
  ctrl.destroy();
});

test('onItemResolved precedes onItemsResolved and stops at the item count', async () => {
  const root = dom.window.document.getElementById('root');
  root.innerHTML = '';
  const items = Array.from({ length: 4 }, (_, i) => wafer(`W0${i + 1}`, [1, 4]));
  const order = [];
  const ctrl = renderWaferGallery(root, items.map(it => () => it), {
    onItemResolved: (resolved, total) => order.push(`item ${resolved}/${total}`),
    onItemsResolved: () => order.push('settled'),
  });
  await settle(60);
  // The settle signal is terminal: advance never reports past total, and never
  // arrives after the gallery has been declared settled.
  assert.equal(order.at(-1), 'settled', 'settled is last');
  assert.equal(order.filter(o => o === 'settled').length, 1, 'settled once');
  assert.deepEqual(order.slice(0, 4), ['item 1/4', 'item 2/4', 'item 3/4', 'item 4/4'], 'advance then settle');
  ctrl.destroy();
});

test('onItemResolved stays quiet after destroy and for an empty gallery', async () => {
  const root = dom.window.document.getElementById('root');
  root.innerHTML = '';
  const items = Array.from({ length: 6 }, (_, i) => wafer(`W0${i + 1}`, [1, 4]));
  let calls = 0;
  const ctrl = renderWaferGallery(root, items.map(it => () => it), { onItemResolved: () => calls++ });
  await settle(2);
  const atDestroy = calls;
  ctrl.destroy();
  await settle(40);
  assert.equal(calls, atDestroy, 'a destroyed gallery reports no further advance');

  root.innerHTML = '';
  let emptyCalls = 0;
  const empty = renderWaferGallery(root, [], { onItemResolved: () => emptyCalls++ });
  await settle(20);
  assert.equal(emptyCalls, 0, 'nothing to report for an empty item list');
  empty.destroy();
});

test('onItemsResolved stays quiet for a build that was superseded', async () => {
  const root = dom.window.document.getElementById('root');
  root.innerHTML = '';
  const items = Array.from({ length: 6 }, (_, i) => wafer(`W0${i + 1}`, [1, 4]));
  let calls = 0;
  const ctrl = renderWaferGallery(root, items.map(it => () => it), { onItemsResolved: () => calls++ });
  // Replace the items mid-resolution: the first build's remaining callbacks are
  // stale and must not report a settle for a gallery that no longer exists.
  await settle(2);
  ctrl.setItems(items.slice(0, 3));
  await settle(40);
  assert.equal(calls, 1, 'only the surviving build reported');
  ctrl.destroy();
});

test('onItemsResolved stays quiet after destroy', async () => {
  const root = dom.window.document.getElementById('root');
  root.innerHTML = '';
  const items = Array.from({ length: 6 }, (_, i) => wafer(`W0${i + 1}`, [1, 4]));
  let calls = 0;
  const ctrl = renderWaferGallery(root, items.map(it => () => it), { onItemsResolved: () => calls++ });
  await settle(2);
  // A host tearing the view down mid-load (tsmap does this on every new file)
  // must not then be told the old gallery settled — it would clear the progress
  // indicator belonging to the render that replaced it.
  ctrl.destroy();
  await settle(40);
  assert.equal(calls, 0, 'a destroyed gallery reports nothing');
});

// ── The equality rules themselves ───────────────────────────────────────────

test('binColorsEqual compares by value, across every field', () => {
  const dies = [{ x: 0, y: 0, hbin: 1, sbin: 1 }, { x: 1, y: 0, hbin: 4, sbin: 4 }];
  const opts = { passBins: [1] };
  const a = resolveBinColors(dies, opts);
  const b = resolveBinColors(dies, opts);
  assert.notEqual(a, b, 'two resolutions are distinct objects — which is the whole problem');
  assert.ok(binColorsEqual(a, b), 'and equal by value');

  // A different colour for the same bin.
  const c = resolveBinColors(dies, opts);
  c.hard.set(4, '#123456');
  assert.ok(!binColorsEqual(a, c), 'a changed colour is a change');

  // A bin appearing is a change even if every shared colour matches.
  const d = resolveBinColors([...dies, { x: 2, y: 0, hbin: 9, sbin: 9 }], opts);
  assert.ok(!binColorsEqual(a, d), 'a new bin is a change');

  // The pass verdict is compared too: it is what the colours were chosen with,
  // and it drives bin order and soft-bin yield downstream.
  const e = resolveBinColors(dies, opts);
  e.pass.hard.add(4);
  assert.ok(!binColorsEqual(a, e), 'a changed pass set is a change');

  assert.ok(binColorsEqual(undefined, undefined), 'both absent is equal');
  assert.ok(!binColorsEqual(a, undefined), 'present vs absent is a change');
});

test('the equality primitives treat a missing key as a difference, not a match', () => {
  assert.ok(arrayEqual([1, 2], [1, 2]));
  assert.ok(!arrayEqual([1, 2], [2, 1]), 'order matters in an array');
  assert.ok(!arrayEqual([1], [1, 2]));
  assert.ok(arrayEqual(undefined, undefined));
  assert.ok(!arrayEqual([], undefined));

  assert.ok(mapEqual(new Map([[1, 'a']]), new Map([[1, 'a']])));
  assert.ok(mapEqual(new Map([[1, 'a'], [2, 'b']]), new Map([[2, 'b'], [1, 'a']])), 'insertion order is not compared');
  assert.ok(!mapEqual(new Map([[1, 'a']]), new Map([[2, 'a']])), 'same size, different key');
  // The case the size check exists for: an undefined value must not make a
  // missing key look present.
  assert.ok(!mapEqual(new Map([[1, undefined]]), new Map()));

  assert.ok(setEqual(new Set([1, 2]), new Set([2, 1])), 'order is meaningless in a set');
  assert.ok(!setEqual(new Set([1]), new Set([2])));
});

// ── onItemsResolved waits for the Summary panel, not just for the cards ─────
//
// The lot panel is staged across tasks (runChunked), so on a large lot it keeps
// building for seconds after the last card lands. Emitting when that render
// STARTS told every host the gallery had settled while the panel was still
// filling in — measured in Chrome on 50 wafers x 8,000 dies x 50 tests, 13 s
// early, which is the whole of the wait a host's indicator exists to cover.
//
// Staging is forced with a fake clock rather than with a lot big enough to
// overrun the real 150 ms first slice: runChunked reads `performance.now()`
// once per step, so a clock that jumps a second per reading makes every slice
// overrun after exactly one step on any machine. A size-based fixture would be
// a race against the test runner's hardware.
test('onItemsResolved waits for a staged lot panel to finish, not to start', async () => {
  const root = dom.window.document.getElementById('root');
  root.innerHTML = '';

  const tests = [{ testNumber: 1000, name: 'Idsat', unit: 'A', limitLow: 0.2, limitHigh: 0.9 }];
  const items = Array.from({ length: 3 }, (_, w) => buildWaferMap({
    results: Array.from({ length: 24 }, (_, i) => ({
      x: i % 6, y: Math.floor(i / 6),
      hbin: i % 5 === 0 ? 4 : 1, sbin: 1,
      testValues: { 1000: 0.3 + ((i + w) % 7) * 0.08 },
    })),
    waferConfig: { diameter: 80 }, dieConfig: { width: 10, height: 10 },
    passBins: [1], testDefs: tests,
  }));
  const lotStatsSummary = analyzeWaferLot(items);

  // Element count, not a panel selector: the panel root carries no class or
  // data attribute to find it by, and what this asserts — "everything the
  // build was going to add is already added" — is a property of the whole
  // render, not of one element.
  const elements = () => root.querySelectorAll('*').length;

  const realNow = performance.now.bind(performance);
  let fake = 0;
  performance.now = () => (fake += 1000);
  let elementsAtEmit = -1;
  let calls = 0;
  let ctrl;
  try {
    ctrl = renderWaferGallery(root, items.map(it => () => it), {
      lotStatsSummary,
      summaryPanel: { placement: 'right' },
      onItemsResolved: () => { calls++; elementsAtEmit = elements(); },
    });
    await settle(200);
  } finally {
    performance.now = realNow;
  }

  assert.equal(calls, 1, 'still exactly one settle signal');
  assert.ok(elements() > 50, `only ${elements()} elements rendered; the fixture built no real panel`);
  assert.equal(elementsAtEmit, elements(),
    `onItemsResolved fired with ${elementsAtEmit} of ${elements()} elements rendered — `
    + 'it reported a settle while the lot panel was still staging');
  ctrl.destroy();
});
