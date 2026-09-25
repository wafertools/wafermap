// The selection/finding highlight, click hit-testing and hover all read their
// geometry back from `currentViewport()` (i.e. the cached `fittedViewport`),
// while the map itself is drawn with the viewport toCanvas computes for that
// draw. Those two must never diverge.
//
// The auto-fit origin/ppm depend on the colorbar and bin-legend reserve, the
// legend position, the axis gutter and the legend row count — none of which
// resize the canvas, so the ResizeObserver never fires for them. Caching the
// first fit forever left the highlight drawn tens of px away from the dies it
// belonged to (reported against a real lot: clicking a ring finding in the
// summary panel highlighted a ring offset from the wafer).
import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

import { buildWaferMap } from '../dist/index.js';
import { clipDiesToWafer } from '../dist/packages/core/transforms.js';
import { createWafer } from '../dist/packages/core/wafer.js';
import { generateDies } from '../dist/packages/core/dies.js';
import { renderWaferMap } from '../dist/packages/canvas-adapter/index.js';

/** Canvas stub that records the draw transform and every rect() emitted.
 *  Dies are drawn under `ctx.setTransform(ppm, 0, 0, -ppm, originX, originY)`;
 *  the selection overlay draws afterwards in raw screen space. */
function makeRecordingContext(log) {
  return {
    scale() {}, fillRect() {}, strokeRect() {}, clearRect() {}, beginPath() {},
    moveTo() {}, lineTo() {}, closePath() {}, stroke() {}, fill() {}, save() {},
    restore() {}, fillText() {}, drawImage() {}, arc() {}, arcTo() {},
    setLineDash() {}, strokeText() {}, clip() {}, translate() {},
    setTransform(a, b, c, d, e, f) {
      if (a) log.transforms.push({ ppm: a, originX: e, originY: f });
    },
    rect(x, y, w, h) { log.rects.push({ x, y, w, h }); },
    measureText(text) { return { width: String(text).length * 6 }; },
  };
}

function setupDom(log) {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    pretendToBeVisual: true, url: 'http://localhost/' });
  const { window } = dom;
  const keys = ['window', 'document', 'HTMLElement', 'HTMLCanvasElement', 'HTMLDivElement',
    'HTMLButtonElement', 'Node', 'Event', 'MouseEvent', 'KeyboardEvent', 'CustomEvent',
    'Blob', 'DOMRect', 'URL', 'getComputedStyle', 'matchMedia', 'ResizeObserver'];
  const previous = new Map(keys.map(k => [k, globalThis[k]]));

  for (const k of keys) if (window[k]) globalThis[k] = window[k];
  globalThis.window = window;
  globalThis.document = window.document;
  const previousNavigator = globalThis.navigator;
  Object.defineProperty(globalThis, 'navigator',
    { value: window.navigator, configurable: true, writable: true });
  globalThis.getComputedStyle = window.getComputedStyle.bind(window);

  const matchMediaShim = () => ({
    matches: false, media: '', addEventListener() {}, removeEventListener() {},
    addListener() {}, removeListener() {}, dispatchEvent() { return false; } });
  window.matchMedia = matchMediaShim;
  globalThis.matchMedia = matchMediaShim;

  class FakeResizeObserver {
    constructor(cb) { this.cb = cb; }
    observe(target) { this.cb([{ target }], this); }
    disconnect() {} unobserve() {}
  }
  window.ResizeObserver = FakeResizeObserver;
  globalThis.ResizeObserver = FakeResizeObserver;
  window.devicePixelRatio = 1;

  const proto = window.HTMLCanvasElement.prototype;
  proto.getContext = function getContext() {
    if (!this.__ctx) this.__ctx = makeRecordingContext(log);
    return this.__ctx;
  };
  proto.toBlob = function toBlob(cb) { cb(new window.Blob(['fake'])); };
  proto.focus = function focus() {};
  proto.setPointerCapture = function setPointerCapture() {};
  proto.releasePointerCapture = function releasePointerCapture() {};
  proto.getBoundingClientRect = function getBoundingClientRect() {
    const width = this.clientWidth, height = this.clientHeight;
    return { x: 0, y: 0, left: 0, top: 0, right: width, bottom: height, width, height, toJSON() {} };
  };
  Object.defineProperty(proto, 'clientWidth',
    { configurable: true, get() { return this.__clientWidth ?? 600; } });
  Object.defineProperty(proto, 'clientHeight',
    { configurable: true, get() { return this.__clientHeight ?? 600; } });

  return {
    window,
    root: window.document.getElementById('root'),
    cleanup() {
      for (const [k, v] of previous) {
        if (v === undefined) delete globalThis[k];
        else globalThis[k] = v;
      }
      // navigator is a getter-only global on Node >= 21 — restore it the same
      // way it was installed.
      Object.defineProperty(globalThis, 'navigator',
        { value: previousNavigator, configurable: true, writable: true });
      dom.window.close();
    },
  };
}

function buildTestWafer() {
  const base = createWafer({ diameter: 100 });
  const dies = clipDiesToWafer(
    generateDies(base, { width: 10, height: 10, gridSize: 6 }), base, { width: 10, height: 10 })
    .filter(die => !die.partial)
    .map(die => ({ ...die, hbin: die.x === 0 && die.y === 0 ? 2 : 1, testValues: { 0: die.x + die.y } }));
  return buildWaferMap({ dies, waferConfig: { diameter: 100 }, passBins: [1] });
}

test('the selection highlight tracks the map when the auto-fit geometry shifts', () => {
  const log = { rects: [], transforms: [] };
  const dom = setupDom(log);
  try {
    const wafer = buildTestWafer();
    const ctrl = renderWaferMap(dom.root, wafer, {
      viewOptions: { plotMode: 'value', activeTest: 0 }, showToolbar: false, height: 600 });

    // The centre die sits at the wafer centre, so its true screen position is
    // exactly the draw transform's origin — no die-pitch arithmetic needed.
    const centreDie = wafer.dies.find(die => die.x === 0 && die.y === 0);
    assert.ok(centreDie, 'fixture should have a die at the wafer centre');
    ctrl.setSelection([centreDie]);

    /** Redraw, then measure how far the selection overlay landed from where
     *  the map was actually drawn. */
    const offsetAfter = (mutate) => {
      log.rects.length = 0;
      log.transforms.length = 0;
      mutate();
      assert.ok(log.transforms.length > 0, 'expected a map draw');
      assert.ok(log.rects.length > 3, 'expected die rects plus a selection overlay');
      const { originX, originY } = log.transforms[0];
      // The overlay's three batched passes (tint, white halo, black core) are
      // the last rects emitted and are identical, so any one of them will do.
      const sel = log.rects.at(-1);
      return Math.hypot(sel.x + sel.w / 2 - originX, sel.y + sel.h / 2 - originY);
    };

    // Each of these changes the fit without changing the canvas size.
    const shifts = [
      ['legend hidden',        () => ctrl.setOptions({ showLegend: false })],
      ['legend shown again',   () => ctrl.setOptions({ showLegend: true })],
      ['legend moved bottom',  () => ctrl.setOptions({ legendPosition: 'bottom' })],
      ['legend back to right', () => ctrl.setOptions({ legendPosition: 'default' })],
      ['plot mode → hardBin',  () => ctrl.setOptions({ plotMode: 'hardBin' })],
      ['plot mode → value',    () => ctrl.setOptions({ plotMode: 'value' })],
    ];

    assert.equal(offsetAfter(() => ctrl.setOptions({})), 0,
      'baseline: selection should sit on the die it belongs to');

    // Guard against a vacuous pass — at least one of these must actually move
    // the map, or the test would succeed even with the bug present.
    let sawAShift = false;
    let previousOrigin = log.transforms[0].originX;
    for (const [label, mutate] of shifts) {
      const offset = offsetAfter(mutate);
      if (log.transforms[0].originX !== previousOrigin) sawAShift = true;
      previousOrigin = log.transforms[0].originX;
      assert.equal(offset, 0, `selection drifted ${offset.toFixed(1)}px from the map after ${label}`);
    }
    assert.ok(sawAShift, 'fixture no longer shifts the auto-fit origin — test would be vacuous');

    // The reported case: the window is maximised and a finding is clicked before
    // the ResizeObserver's invalidation has been delivered. The RO callback is
    // async, so any render in that window — the click's own — draws the map at
    // the new size. The overlay must follow it without waiting for the RO.
    const canvas = dom.root.querySelector('canvas');
    canvas.__clientWidth = 1400;
    canvas.__clientHeight = 900;
    const afterResize = offsetAfter(
      () => ctrl.setOptions({ plotMode: 'value', activeTest: 0, highlightBin: undefined }));
    assert.equal(afterResize, 0,
      `selection drifted ${afterResize.toFixed(1)}px after a resize the ResizeObserver had not yet reported`);
  } finally {
    dom.cleanup();
  }
});
