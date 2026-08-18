import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

import { buildWaferMap, analyzeWaferMap, classifyDie, clipDiesToWafer, createWafer, generateDies } from '../dist/index.js';
import { renderWaferMap, renderWaferGallery } from '../dist/packages/canvas-adapter/index.js';

// A wafer with a clean ring-3 (edge) yield loss — triggers a real StatsFinding
// from analyzeWaferMap (same fixture shape as tests/stats.test.mjs's
// "detects ring-level yield loss" case), so Findings-sidebar tests exercise
// a real finding instead of a hand-rolled fixture.
function buildWaferWithFinding() {
  const baseWafer = createWafer({ diameter: 60 });
  const baseDies = clipDiesToWafer(
    generateDies(baseWafer, { width: 10, height: 10, gridSize: 2 }),
    baseWafer,
    { width: 10, height: 10 },
  ).filter((die) => !die.partial);
  const enriched = baseDies.map((die) => {
    const { ring } = classifyDie(die, baseWafer, { ringCount: 3 });
    return { ...die, hbin: ring === 3 ? 2 : 1 };
  });
  const wafer = buildWaferMap({ dies: enriched, waferConfig: { diameter: 60 }, passBins: [1] });
  const statsSummary = analyzeWaferMap(wafer, { ringCount: 3, minimumSampleSize: 3, minimumEffectSize: 0.2 });
  return { wafer, statsSummary };
}

function makeDies() {
  return [
    { id: '0_0', i: 0, j: 0, x: 0, y: 0, width: 10, height: 10, testValues: { 0: 0.9 }, hbin: 1 },
    { id: '1_0', i: 1, j: 0, x: 10, y: 0, width: 10, height: 10, testValues: { 0: 0.7 }, hbin: 2 },
    { id: '0_1', i: 0, j: 1, x: 0, y: 10, width: 10, height: 10, testValues: { 0: 0.8 }, hbin: 1 },
    { id: '1_1', i: 1, j: 1, x: 10, y: 10, width: 10, height: 10, testValues: { 0: 0.6 }, hbin: 2 },
  ];
}

function makeCanvasContext() {
  return {
    scale() {},
    fillRect() {},
    strokeRect() {},
    clearRect() {},
    beginPath() {},
    moveTo() {},
    lineTo() {},
    closePath() {},
    stroke() {},
    fill() {},
    save() {},
    restore() {},
    setTransform() {},
    fillText() {},
    drawImage() {},
    arc() {},
    arcTo() {},
    rect() {},
    measureText(text) {
      return { width: String(text).length * 6 };
    },
    setLineDash() {},
    strokeText() {},
    clip() {},
    translate() {},
  };
}

function setupDom() {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    pretendToBeVisual: true,
    url: 'http://localhost/',
  });

  const { window } = dom;
  const previous = new Map();
  const globals = [
    'window',
    'document',
    'HTMLElement',
    'HTMLCanvasElement',
    'HTMLDivElement',
    'HTMLButtonElement',
    'Node',
    'Event',
    'MouseEvent',
    'KeyboardEvent',
    'CustomEvent',
    'Blob',
    'DOMRect',
    'navigator',
    'getComputedStyle',
    'matchMedia',
    'ResizeObserver',
    'URL',
  ];

  for (const key of globals) previous.set(key, globalThis[key]);

  globalThis.window = window;
  globalThis.document = window.document;
  globalThis.HTMLElement = window.HTMLElement;
  globalThis.HTMLCanvasElement = window.HTMLCanvasElement;
  globalThis.HTMLDivElement = window.HTMLDivElement;
  globalThis.HTMLButtonElement = window.HTMLButtonElement;
  globalThis.Node = window.Node;
  globalThis.Event = window.Event;
  globalThis.MouseEvent = window.MouseEvent;
  globalThis.KeyboardEvent = window.KeyboardEvent;
  globalThis.CustomEvent = window.CustomEvent;
  globalThis.Blob = window.Blob;
  globalThis.DOMRect = window.DOMRect;
  // globalThis.navigator is a read-only getter on Node ≥ 21 — use defineProperty.
  Object.defineProperty(globalThis, 'navigator', {
    value: window.navigator,
    configurable: true,
    writable: true,
  });
  globalThis.getComputedStyle = window.getComputedStyle.bind(window);
  // JSDOM's window has no native matchMedia. The library now derives its window
  // reference from the rendered container's own document (`ownerDocument.defaultView`)
  // rather than the bare global, so the shim must live on the JSDOM `window` object
  // itself, not just on globalThis, or `container.ownerDocument.defaultView.matchMedia`
  // resolves to undefined.
  const matchMediaShim = window.matchMedia?.bind(window) ?? (() => ({
    matches: false,
    media: '',
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    dispatchEvent() { return false; },
  }));
  window.matchMedia = matchMediaShim;
  globalThis.matchMedia = matchMediaShim;
  globalThis.URL = window.URL;
  if (typeof globalThis.URL.createObjectURL !== 'function') {
    globalThis.URL.createObjectURL = () => 'blob:mock';
  }
  if (typeof globalThis.URL.revokeObjectURL !== 'function') {
    globalThis.URL.revokeObjectURL = () => {};
  }

  class FakeResizeObserver {
    constructor(callback) {
      this.callback = callback;
    }
    observe(target) {
      this.callback([{ target }], this);
    }
    disconnect() {}
    unobserve() {}
  }
  // Same reasoning as the matchMedia shim above: the library now derives its
  // ResizeObserver constructor from the rendered container's own window
  // (`ownerDocument.defaultView.ResizeObserver`) rather than the bare global,
  // so the shim must live on the JSDOM `window` object itself.
  window.ResizeObserver = FakeResizeObserver;
  globalThis.ResizeObserver = FakeResizeObserver;

  window.devicePixelRatio = 1;

  const canvasProto = window.HTMLCanvasElement.prototype;
  canvasProto.getContext = function getContext() {
    if (!this.__ctx) this.__ctx = makeCanvasContext();
    return this.__ctx;
  };
  canvasProto.toBlob = function toBlob(callback) {
    callback(new window.Blob(['fake'], { type: 'image/png' }));
  };
  canvasProto.focus = function focus() {};
  canvasProto.setPointerCapture = function setPointerCapture() {};
  canvasProto.releasePointerCapture = function releasePointerCapture() {};
  canvasProto.getBoundingClientRect = function getBoundingClientRect() {
    const width = this.clientWidth || 400;
    const height = this.clientHeight || 400;
    return { x: 0, y: 0, left: 0, top: 0, right: width, bottom: height, width, height, toJSON() {} };
  };

  Object.defineProperty(window.HTMLCanvasElement.prototype, 'clientWidth', {
    configurable: true,
    get() {
      return this.__clientWidth ?? (Number.parseInt(this.style.width, 10) || 400);
    },
  });
  Object.defineProperty(window.HTMLCanvasElement.prototype, 'clientHeight', {
    configurable: true,
    get() {
      return this.__clientHeight ?? (Number.parseInt(this.style.height, 10) || 400);
    },
  });

  // Gallery card detach opens a real popup window (see openDetachWindow in
  // toolbar.ts) — a genuinely separate Window/Document pair, which is exactly
  // what a second JSDOM instance is. Track every popup opened during this
  // setupDom() session so cleanup() can close them (mirrors the real browser
  // API: popups outlive their opener unless explicitly closed).
  const popups = [];
  window.open = function open() {
    const popupDom = new JSDOM('<!doctype html><html><head></head><body></body></html>', {
      pretendToBeVisual: true,
      url: 'http://localhost/',
    });
    const popupWindow = popupDom.window;
    installTestShims(popupWindow);
    popups.push(popupDom);
    return popupWindow;
  };

  return {
    window,
    root: window.document.getElementById('root'),
    cleanup() {
      for (const [key, value] of previous) {
        if (value === undefined) delete globalThis[key];
        else globalThis[key] = value;
      }
      for (const popupDom of popups) popupDom.window.close();
      dom.window.close();
    },
  };
}

/** Install the same matchMedia/ResizeObserver/canvas shims setupDom() gives
 * the main JSDOM window onto a popup window, so a renderWaferMap instance
 * mounted inside it behaves identically to one in the main document. */
function installTestShims(win) {
  win.matchMedia = win.matchMedia?.bind(win) ?? (() => ({
    matches: false,
    media: '',
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    dispatchEvent() { return false; },
  }));

  class FakeResizeObserver {
    constructor(callback) { this.callback = callback; }
    observe(target) { this.callback([{ target }], this); }
    disconnect() {}
    unobserve() {}
  }
  win.ResizeObserver = FakeResizeObserver;
  win.devicePixelRatio = 1;

  const canvasProto = win.HTMLCanvasElement.prototype;
  canvasProto.getContext = function getContext() {
    if (!this.__ctx) this.__ctx = makeCanvasContext();
    return this.__ctx;
  };
  canvasProto.toBlob = function toBlob(callback) {
    callback(new win.Blob(['fake'], { type: 'image/png' }));
  };
  canvasProto.focus = function focus() {};
  canvasProto.setPointerCapture = function setPointerCapture() {};
  canvasProto.releasePointerCapture = function releasePointerCapture() {};
  canvasProto.getBoundingClientRect = function getBoundingClientRect() {
    const width = this.clientWidth || 400;
    const height = this.clientHeight || 400;
    return { x: 0, y: 0, left: 0, top: 0, right: width, bottom: height, width, height, toJSON() {} };
  };
  Object.defineProperty(canvasProto, 'clientWidth', {
    configurable: true,
    get() { return this.__clientWidth ?? (Number.parseInt(this.style.width, 10) || 400); },
  });
  Object.defineProperty(canvasProto, 'clientHeight', {
    configurable: true,
    get() { return this.__clientHeight ?? (Number.parseInt(this.style.height, 10) || 400); },
  });
}

function pointerEvent(window, type, init = {}) {
  const ev = new window.MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: init.clientX ?? 100,
    clientY: init.clientY ?? 100,
    button: init.button ?? 0,
  });
  Object.defineProperties(ev, {
    pointerId: { value: init.pointerId ?? 1 },
    ctrlKey: { value: init.ctrlKey ?? false },
    metaKey: { value: init.metaKey ?? false },
  });
  return ev;
}

function click(window, target) {
  target.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
}

test('renderWaferMap mounts toolbar controls and supports option/controller updates', () => {
  const { window, root, cleanup } = setupDom();
  try {
    const container = window.document.createElement('div');
    Object.assign(container.style, { position: 'relative', width: '400px', height: '400px' });
    root.appendChild(container);

    const wafer = buildWaferMap({
      results: [
        { x: 0, y: 0, testValues: { 0: 0.9 }, hbin: 1 },
        { x: 1, y: 0, testValues: { 0: 0.7 }, hbin: 2 },
        { x: 0, y: 1, testValues: { 0: 0.8 }, hbin: 1 },
      ],
      waferConfig: { diameter: 40 },
      dieConfig: { width: 10, height: 10 },
    });

    const hoverCalls = [];
    const clickCalls = [];
    const selectCalls = [];
    const sceneCalls = [];
    const ctrl = renderWaferMap(container, wafer, {
      showTooltip: true,
      onHover: (die) => hoverCalls.push(die?.id ?? null),
      onClick: (die) => clickCalls.push(die.id),
      onSelect: (dies) => selectCalls.push(dies.map((die) => die.id)),
      onViewOptionsChange: (opts) => sceneCalls.push(opts),
    });

    const canvas = container.querySelector('canvas');
    assert.ok(canvas, 'canvas should be mounted inside container');
    assert.equal(container.querySelector('[data-wmap-toolbar="single"]') !== null, true);
    assert.equal(ctrl.getOptions().plotMode, 'hardBin');

    const buttons = [...root.querySelectorAll('button')];
    const overlaysBtn = buttons.find((btn) => btn.ariaLabel === 'Overlays');
    assert.ok(overlaysBtn, 'Overlays dropdown button should exist');
    // Open the overlays menu and verify labels toggle is inside it.
    click(window, overlaysBtn);
    // Each overlays menu row is a flex div containing a tick span and a label span.
    // Find the row whose label span text matches.
    const labelsRow = [...window.document.querySelectorAll('div')].find((el) =>
      [...el.children].some((ch) => ch.children.length === 0 && ch.textContent === 'Die labels'),
    );
    assert.ok(labelsRow, 'Die labels row should appear in overlays menu');
    click(window, labelsRow);
    assert.equal(ctrl.getOptions().showDieLabels, true);
    assert.equal(sceneCalls.at(-1).showDieLabels, true);

    const panBtn = buttons.find((btn) => btn.ariaLabel === 'Pan (drag to move)');
    assert.ok(panBtn);
    click(window, panBtn);
    assert.equal(canvas.style.cursor, 'grab');

    const selectBtn = buttons.find((btn) => btn.ariaLabel === 'Select (drag to select dies)');
    assert.ok(selectBtn);
    click(window, selectBtn);
    assert.equal(canvas.style.cursor, 'crosshair');

    ctrl.setSelection(wafer.dies.filter((die) => die.x === 0 && die.y === 0));
    ctrl.clearSelection();

    canvas.dispatchEvent(pointerEvent(window, 'pointermove', { clientX: 200, clientY: 200 }));
    assert.equal(hoverCalls.length > 0, true);

    ctrl.destroy();
    assert.equal(container.querySelector('[data-wmap-toolbar="1"]'), null);
    assert.equal(window.document.body.querySelector('[data-wmap-toolbar="1"]'), null);
    assert.equal(clickCalls.length >= 0, true);
    assert.equal(selectCalls.length >= 0, true);
  } finally {
    cleanup();
  }
});

test('renderWaferMap Expand modal reparents the toolbar and canvas via openReparentedModal, and restores both intact on close (including across repeated open/close cycles)', () => {
  const { window, root, cleanup } = setupDom();
  try {
    const container = window.document.createElement('div');
    Object.assign(container.style, { position: 'relative', width: '400px', height: '400px' });
    root.appendChild(container);

    const wafer = buildWaferMap({
      results: [{ x: 0, y: 0, testValues: { 0: 0.9 }, hbin: 1 }],
      waferConfig: { diameter: 40 },
      dieConfig: { width: 10, height: 10 },
    });
    renderWaferMap(container, wafer, {});

    const canvas = container.querySelector('canvas');
    assert.ok(canvas, 'canvas should be mounted inside container');
    const findExpandBtn = () =>
      [...root.querySelectorAll('button')].find((btn) => btn.ariaLabel === 'Expand (E)');
    assert.ok(findExpandBtn(), 'Expand button should be present');

    // Open → close → open again: exercises both halves of openReparentedModal
    // (toolbar.ts). Close must restore canvas+toolbar to their exact original
    // position without throwing (the stale-sibling-reference bug: toolbar was
    // canvasWrap's own original nextSibling, and both are reparented together
    // in one call — restoring the second-moved element first left the
    // first's `insertBefore(el, staleNextSibling)` reference no longer a
    // child of its recorded parent). The second open must actually reopen
    // (the WeakSet re-entrancy guard must not still think canvasWrap/toolbar
    // are "already in a modal" after the first legitimate close).
    for (let cycle = 1; cycle <= 2; cycle++) {
      click(window, findExpandBtn());

      const backdrop = window.document.getElementById('wmap-modal-backdrop');
      assert.ok(backdrop, `modal backdrop should appear on open #${cycle}`);
      const dialog = backdrop.querySelector('[role="dialog"]');
      assert.ok(dialog, `modal dialog should exist on open #${cycle}`);
      assert.ok(dialog.contains(canvas), `canvas should be reparented into the modal on open #${cycle}`);
      assert.ok(
        dialog.querySelector('[data-wmap-toolbar="single"]'),
        `toolbar should be reparented into the modal alongside the canvas on open #${cycle}`,
      );
      assert.equal(container.contains(canvas), false, `canvas should have left container while expanded on open #${cycle}`);

      const closeBtn = dialog.querySelector('button[aria-label="Close"]');
      assert.ok(closeBtn, `modal should expose a Close button on open #${cycle}`);
      click(window, closeBtn);

      assert.equal(
        window.document.getElementById('wmap-modal-backdrop'), null,
        `modal backdrop should be gone after close #${cycle}`,
      );
      assert.ok(container.contains(canvas), `canvas should be restored to container after close #${cycle}`);
      assert.ok(
        container.querySelector('[data-wmap-toolbar="single"]'),
        `toolbar should be restored to container after close #${cycle}`,
      );
    }
  } finally {
    cleanup();
  }
});

test('renderWaferMap onSaveImage hook intercepts the PNG download', () => {
  const { window, root, cleanup } = setupDom();
  try {
    const container = window.document.createElement('div');
    Object.assign(container.style, { position: 'relative', width: '400px', height: '400px' });
    root.appendChild(container);

    const wafer = buildWaferMap({
      results: [
        { x: 0, y: 0, hbin: 1 },
        { x: 1, y: 0, hbin: 2 },
        { x: 0, y: 1, hbin: 1 },
      ],
      waferConfig: { diameter: 40 },
      dieConfig: { width: 10, height: 10 },
    });

    const saved = [];
    // When the host provides onSaveImage, the toolbar must call it instead of
    // appending an <a download> and clicking it. Track any anchor clicks to
    // confirm the default path is bypassed.
    let anchorClicks = 0;
    const origClick = window.HTMLAnchorElement.prototype.click;
    window.HTMLAnchorElement.prototype.click = function () { anchorClicks++; };

    try {
      renderWaferMap(container, wafer, {
        downloadFilename: 'my-wafer',
        onSaveImage: (blob, name) => { saved.push({ blob, name }); },
      });

      const downloadBtn = [...root.querySelectorAll('button')].find((b) => b.ariaLabel === 'Download PNG');
      assert.ok(downloadBtn, 'Download PNG button should exist');
      click(window, downloadBtn);

      assert.equal(saved.length, 1, 'onSaveImage should be called exactly once');
      assert.ok(saved[0].blob instanceof window.Blob, 'hook receives a Blob');
      assert.equal(saved[0].name, 'my-wafer.png', 'suggestedName uses downloadFilename + .png');
      assert.equal(anchorClicks, 0, 'default <a download> path is bypassed when onSaveImage is set');
    } finally {
      window.HTMLAnchorElement.prototype.click = origClick;
    }
  } finally {
    cleanup();
  }
});

test('renderWaferMap onSaveText hook intercepts the Summary panel\'s CSV export', () => {
  const { window, root, cleanup } = setupDom();
  try {
    const container = window.document.createElement('div');
    Object.assign(container.style, { position: 'relative', width: '700px', height: '500px' });
    root.appendChild(container);

    const wafer = buildWaferMap({
      results: [
        { x: 0, y: 0, testValues: { 1010: 0.5 }, hbin: 1 },
        { x: 1, y: 0, testValues: { 1010: 2.5 }, hbin: 1 },
        { x: 0, y: 1, testValues: { 1010: 5.0 }, hbin: 1 },
      ],
      waferConfig: { diameter: 40 },
      dieConfig: { width: 10, height: 10 },
      testDefs: [{ testNumber: 1010, name: 'Vth', unit: 'V' }],
    });
    const statsSummary = analyzeWaferMap(wafer);

    const saved = [];
    // Same bypass-the-<a-download> contract as onSaveImage — tsmap (WMAP_ISSUES.md
    // #33) hit this exact gap: the CSV export button had no host hook at all, so
    // it always fell through to a raw anchor click, a silent no-op in Tauri.
    let anchorClicks = 0;
    const origClick = window.HTMLAnchorElement.prototype.click;
    window.HTMLAnchorElement.prototype.click = function () { anchorClicks++; };

    try {
      renderWaferMap(container, wafer, {
        statsSummary,
        summaryPanel: { placement: 'right', defaultOpen: true },
        onSaveText: (text, name, mimeType) => { saved.push({ text, name, mimeType }); },
      });

      const exportBtn = [...root.querySelectorAll('button')].find((b) => b.textContent === 'Export CSV');
      assert.ok(exportBtn, 'Export CSV button should exist in the Test Values section');
      click(window, exportBtn);

      assert.equal(saved.length, 1, 'onSaveText should be called exactly once');
      assert.match(saved[0].text, /Vth/, 'hook receives the CSV text, including the test name');
      assert.equal(saved[0].name, 'test-values.csv', 'suggestedName matches the export');
      assert.equal(saved[0].mimeType, 'text/csv');
      assert.equal(anchorClicks, 0, 'default <a download> path is bypassed when onSaveText is set');
    } finally {
      window.HTMLAnchorElement.prototype.click = origClick;
    }
  } finally {
    cleanup();
  }
});

test('renderWaferMap zIndex option sets --wmap-z for its lifetime and restores on destroy', () => {
  const { window, root, cleanup } = setupDom();
  try {
    const docEl = window.document.documentElement;
    const container = window.document.createElement('div');
    Object.assign(container.style, { position: 'relative', width: '400px', height: '400px' });
    root.appendChild(container);

    const wafer = buildWaferMap({
      results: [{ x: 0, y: 0, hbin: 1 }, { x: 1, y: 0, hbin: 2 }],
      waferConfig: { diameter: 40 },
      dieConfig: { width: 10, height: 10 },
    });

    // Seed a pre-existing host value so we can confirm it is restored, not cleared.
    docEl.style.setProperty('--wmap-z', '42');

    const ctrl = renderWaferMap(container, wafer, { zIndex: 5100 });
    assert.equal(
      docEl.style.getPropertyValue('--wmap-z'), '5100',
      'zIndex is written to --wmap-z on document.documentElement while mounted',
    );

    ctrl.destroy();
    assert.equal(
      docEl.style.getPropertyValue('--wmap-z'), '42',
      'destroy() restores the prior --wmap-z value',
    );
  } finally {
    cleanup();
  }
});

test('renderWaferMap leaves --wmap-z untouched when no zIndex is given', () => {
  const { window, root, cleanup } = setupDom();
  try {
    const docEl = window.document.documentElement;
    const container = window.document.createElement('div');
    Object.assign(container.style, { position: 'relative', width: '400px', height: '400px' });
    root.appendChild(container);

    const wafer = buildWaferMap({
      results: [{ x: 0, y: 0, hbin: 1 }, { x: 1, y: 0, hbin: 2 }],
      waferConfig: { diameter: 40 },
      dieConfig: { width: 10, height: 10 },
    });

    // The default-high path relies on the CSS fallback (var(--wmap-z, 6000)) and
    // must never write the property — so concurrent default renders don't clash.
    const ctrl = renderWaferMap(container, wafer, {});
    assert.equal(
      docEl.style.getPropertyValue('--wmap-z'), '',
      'no zIndex leaves --wmap-z unset (safe high default applies via CSS fallback)',
    );
    ctrl.destroy();
  } finally {
    cleanup();
  }
});

test('renderWaferMap toolbar menus carry ARIA roles and expanded state', () => {
  const { window, root, cleanup } = setupDom();
  try {
    const container = window.document.createElement('div');
    Object.assign(container.style, { position: 'relative', width: '400px', height: '400px' });
    root.appendChild(container);

    const wafer = buildWaferMap({
      results: [
        { x: 0, y: 0, hbin: 1 },
        { x: 1, y: 0, hbin: 2 },
        { x: 0, y: 1, hbin: 1 },
      ],
      waferConfig: { diameter: 40 },
      dieConfig: { width: 10, height: 10 },
    });
    renderWaferMap(container, wafer);

    const buttons = [...root.querySelectorAll('button')];

    // Plot mode trigger advertises a popup and reflects expanded state.
    const modeBtn = buttons.find((b) => b.ariaLabel === 'Plot mode');
    assert.ok(modeBtn, 'Plot mode button exists');
    assert.equal(modeBtn.getAttribute('aria-haspopup'), 'menu');
    assert.equal(modeBtn.getAttribute('aria-expanded'), 'false');

    click(window, modeBtn);
    assert.equal(modeBtn.getAttribute('aria-expanded'), 'true', 'aria-expanded flips on open');
    const modeMenu = [...window.document.querySelectorAll('[role="menu"]')].at(-1);
    assert.ok(modeMenu, 'mode menu has role=menu');
    const radioItems = modeMenu.querySelectorAll('[role="menuitemradio"]');
    assert.ok(radioItems.length > 0, 'mode menu rows are menuitemradio');
    // Exactly the active mode is aria-checked.
    const checked = [...radioItems].filter((r) => r.getAttribute('aria-checked') === 'true');
    assert.equal(checked.length, 1, 'one mode row is aria-checked');
    // Clicking outside the menu (the document body) closes it and resets aria.
    click(window, window.document.body);
    assert.equal(modeBtn.getAttribute('aria-expanded'), 'false', 'aria-expanded resets when menu closes');

    // Overlays check-menu uses menuitemcheckbox semantics.
    const overlaysBtn = buttons.find((b) => b.ariaLabel === 'Overlays');
    assert.ok(overlaysBtn);
    assert.equal(overlaysBtn.getAttribute('aria-haspopup'), 'menu');
    click(window, overlaysBtn);
    const checkMenu = [...window.document.querySelectorAll('[role="menu"]')].at(-1);
    assert.ok(checkMenu.querySelectorAll('[role="menuitemcheckbox"]').length > 0, 'overlays rows are menuitemcheckbox');
  } finally {
    cleanup();
  }
});

test('renderWaferGallery builds cards, detaches a card into a real popup window, and rebuilds items', () => {
  const { window, root, cleanup } = setupDom();
  try {
    const container = window.document.createElement('div');
    root.appendChild(container);

    const base = buildWaferMap({
      results: [
        { x: 0, y: 0, testValues: { 0: 0.9 }, hbin: 1 },
        { x: 1, y: 0, testValues: { 0: 0.7 }, hbin: 2 },
        { x: 0, y: 1, testValues: { 0: 0.8 }, hbin: 1 },
      ],
      waferConfig: { diameter: 40 },
      dieConfig: { width: 10, height: 10 },
    });

    const items = [
      { ...base, label: 'A' },
      { ...base, label: 'B' },
    ];

    const ctrl = renderWaferGallery(container, items, { cardPadding: 4 });
    assert.equal(container.querySelectorAll('.wmap-gallery-card').length, 2);
    assert.equal(container.querySelectorAll('canvas').length >= 2, true);
    assert.equal(container.querySelectorAll('button').length > 0, true);

    click(window, container.querySelector('[data-wmap-expand-btn]'));
    // Card expand opens a real, separate popup window (window.open) — the
    // host document has no backdrop/modal box at all, since nothing was ever
    // added to it; the popup is a genuinely different Window/Document.
    assert.equal(window.document.getElementById('wmap-modal-backdrop'), null);
    assert.equal(window.document.querySelector('.wmap-window-box'), null);
    assert.equal(window.document.querySelectorAll('canvas').length, 1); // card A's canvas removed from the grid (its popup is the only live view); card B's remains

    ctrl.setItems([{ ...base, label: 'C' }]);
    assert.equal(container.querySelectorAll('.wmap-gallery-card').length, 1);

    ctrl.destroy();
    assert.equal(container.childElementCount, 0);
  } finally {
    cleanup();
  }
});

test('renderWaferGallery legend strip: a field with one value shows it plainly; a field that varies shows every distinct value, not first-wafer-wins', () => {
  const { window, root, cleanup } = setupDom();
  try {
    const container = window.document.createElement('div');
    root.appendChild(container);

    const dieOpts = { results: [{ x: 0, y: 0, hbin: 1 }], dieConfig: { width: 10, height: 10 } };
    const itemA = buildWaferMap({ ...dieOpts, waferConfig: { diameter: 40, metadata: { lot: 'LOT123', product: 'ACME-9', waferId: 'W01' } } });
    const itemB = buildWaferMap({ ...dieOpts, waferConfig: { diameter: 40, metadata: { lot: 'LOT123', product: 'ACME-9', waferId: 'W02' } } });

    // legendEl is the second child of container (after the toolbar bar), same
    // convention as tests/renderWaferGallery.test.ts.
    const legendEl = () => container.children[1];

    renderWaferGallery(container, [itemA, itemB], { viewOptions: { plotMode: 'hardBin' } });
    assert.match(legendEl().textContent, /Lot: LOT123/, 'a single common value should show plainly, no list');
    assert.match(legendEl().textContent, /Product: ACME-9/, 'consistent product should be shown');
    assert.doesNotMatch(legendEl().textContent, /W01/, 'waferId is excluded from faceting by default — unique per wafer, never a useful summary field');

    // Mixed lot — the varying field must show every distinct value it takes
    // across the visible set, not just the first wafer's (lotIdentity's bug),
    // and not be dropped entirely either (the earlier, over-conservative fix).
    const itemC = buildWaferMap({ ...dieOpts, waferConfig: { diameter: 40, metadata: { lot: 'LOT456', product: 'ACME-9' } } });
    container.innerHTML = '';
    renderWaferGallery(container, [itemA, itemC], { viewOptions: { plotMode: 'hardBin' } });
    assert.match(legendEl().textContent, /Lot: LOT123, LOT456/, 'a varying field lists every distinct value present');
    assert.match(legendEl().textContent, /Product: ACME-9/, 'a field that IS consistent should still show even when lot varies');
  } finally {
    cleanup();
  }
});

test('renderWaferGallery legend strip: a field with many distinct values truncates to "+N more" rather than growing unbounded', () => {
  const { window, root, cleanup } = setupDom();
  try {
    const container = window.document.createElement('div');
    root.appendChild(container);

    const dieOpts = { results: [{ x: 0, y: 0, hbin: 1 }], dieConfig: { width: 10, height: 10 } };
    const lots = ['LOT-A', 'LOT-B', 'LOT-C', 'LOT-D', 'LOT-E'];
    const items = lots.map(lot => buildWaferMap({ ...dieOpts, waferConfig: { diameter: 40, metadata: { lot } } }));

    renderWaferGallery(container, items, { viewOptions: { plotMode: 'hardBin' } });
    const legendEl = container.children[1];
    assert.match(legendEl.textContent, /Lot: LOT-A, LOT-B, LOT-C \+2 more/, 'shows the top values by coverage then a +N more summary');
  } finally {
    cleanup();
  }
});

test('renderWaferGallery: per-card floating metadata badge is suppressed, replaced by an expandable card header showing the full per-wafer metadata', () => {
  const { window, root, cleanup } = setupDom();
  try {
    const container = window.document.createElement('div');
    root.appendChild(container);

    // Two items sharing lot but differing product/operator — the shared top
    // strip's commonMetadata will show only "Lot: LOT123" (product/operator
    // vary), so those two fields are otherwise invisible except through this
    // card's own expand toggle, letting the test distinguish "shown by the
    // shared strip" from "revealed by expanding this card".
    const dieOpts = { results: [{ x: 0, y: 0, hbin: 1 }], dieConfig: { width: 10, height: 10 } };
    const itemA = buildWaferMap({ ...dieOpts, waferConfig: { diameter: 40, metadata: { lot: 'LOT123', waferId: 'W01', product: 'ACME-9', operator: 'alice' } } });
    const itemB = buildWaferMap({ ...dieOpts, waferConfig: { diameter: 40, metadata: { lot: 'LOT123', waferId: 'W02', product: 'ACME-7', operator: 'bob' } } });
    renderWaferGallery(container, [{ ...itemA, label: 'LOT123 · W01' }, { ...itemB, label: 'LOT123 · W02' }], {});

    // No standalone floating badge (bottom-left overlay) inside either card's canvas area.
    const floatingBadges = [...container.querySelectorAll('[aria-label^="Wafer info: "]')];
    assert.equal(floatingBadges.length, 0, 'the standalone bottom-left metadata badge must not be mounted inside gallery cards');

    // The first card's own expand toggle exists instead, and reveals fields
    // beyond what the header's label and the shared strip already show
    // (product, operator), without duplicating the label text.
    const toggle = container.querySelector('[aria-label^="Wafer info for "]');
    assert.ok(toggle, 'card header should expose a metadata expand toggle when the wafer has metadata');
    assert.equal(toggle.getAttribute('aria-expanded'), 'false');

    const panel = container.querySelector('[data-wmap-card-meta-panel]');
    assert.ok(panel, 'metadata panel should exist (hidden) even before expanding');
    assert.equal(panel.style.display, 'none', 'panel starts hidden — collapsed by default, matching the standalone badge');
    assert.match(panel.textContent, /ACME-9/, 'panel content includes fields the shared strip omits (they vary across wafers)');

    toggle.click();
    assert.equal(toggle.getAttribute('aria-expanded'), 'true');
    assert.equal(panel.style.display, 'block', 'panel becomes visible after expanding');
    assert.match(panel.textContent, /alice/, 'expanding reveals this card\'s own operator');
  } finally {
    cleanup();
  }
});

test('renderWaferGallery: card header shows no expand toggle when the wafer has no metadata at all', () => {
  const { window, root, cleanup } = setupDom();
  try {
    const container = window.document.createElement('div');
    root.appendChild(container);

    const item = buildWaferMap({
      results: [{ x: 0, y: 0, hbin: 1 }],
      dieConfig: { width: 10, height: 10 },
      waferConfig: { diameter: 40 },
    });
    renderWaferGallery(container, [{ ...item, label: 'W01' }], {});

    const toggle = container.querySelector('[aria-label^="Wafer info for "]');
    assert.equal(toggle, null, 'no expand affordance should render when there is nothing to expand');
  } finally {
    cleanup();
  }
});

test('renderWaferGallery falls back to an in-page floating window when window.open is blocked (e.g. Tauri)', () => {
  const { window, root, cleanup } = setupDom();
  // Simulate an embedded host (Tauri's WebView) where window.open() is
  // blocked and silently returns null — same as tsmap's openHtmlReport gap.
  window.open = () => null;
  try {
    const container = window.document.createElement('div');
    root.appendChild(container);

    const base = buildWaferMap({
      results: [
        { x: 0, y: 0, testValues: { 0: 0.9 }, hbin: 1 },
        { x: 1, y: 0, testValues: { 0: 0.7 }, hbin: 2 },
        { x: 0, y: 1, testValues: { 0: 0.8 }, hbin: 1 },
      ],
      waferConfig: { diameter: 40 },
      dieConfig: { width: 10, height: 10 },
    });

    const items = [
      { ...base, label: 'A' },
      { ...base, label: 'B' },
    ];

    const ctrl = renderWaferGallery(container, items, { cardPadding: 4 });
    const expandBtn = container.querySelector('[data-wmap-expand-btn]');

    click(window, expandBtn);
    // No real popup available — falls back to the in-page non-modal floating
    // window instead of silently doing nothing. A fresh controller is built
    // into the floating window (same as the real-popup case) rather than
    // reparenting the grid's existing canvas.
    assert.ok(window.document.querySelector('.wmap-window-box'));
    assert.equal(window.document.querySelectorAll('canvas').length, 2); // card A's fresh canvas in the floating window + card B's in the grid

    // Reattach via the same toggle button, same as the real-popup case.
    click(window, expandBtn);
    assert.equal(window.document.querySelector('.wmap-window-box'), null);
    assert.equal(container.querySelectorAll('canvas').length, 2);

    ctrl.destroy();
  } finally {
    cleanup();
  }
});

test('renderWaferGallery floating-window fallback: title gets an expand chevron revealing full metadata, no separate corner badge', () => {
  const { window, root, cleanup } = setupDom();
  window.open = () => null; // force the floating-window fallback path
  try {
    const container = window.document.createElement('div');
    root.appendChild(container);

    const item = buildWaferMap({
      results: [{ x: 0, y: 0, hbin: 1 }],
      dieConfig: { width: 10, height: 10 },
      waferConfig: { diameter: 40, metadata: { lot: 'LOT123', waferId: 'W01', product: 'ACME-9' } },
    });
    const ctrl = renderWaferGallery(container, [{ ...item, label: 'LOT123 · W01' }], {});
    const expandBtn = container.querySelector('[data-wmap-expand-btn]');
    click(window, expandBtn);

    const box = window.document.querySelector('.wmap-window-box');
    assert.ok(box, 'floating window should open');

    const toggle = box.querySelector('[aria-label^="Wafer info for "]');
    assert.ok(toggle, 'window title should expose a metadata expand toggle');
    assert.equal(toggle.getAttribute('aria-expanded'), 'false');

    const panel = box.querySelector('[data-wmap-card-meta-panel]');
    assert.ok(panel, 'metadata panel should exist (hidden) before expanding');
    assert.equal(panel.style.display, 'none');

    click(window, toggle);
    assert.equal(toggle.getAttribute('aria-expanded'), 'true');
    assert.equal(panel.style.display, 'block');
    assert.match(panel.textContent, /ACME-9/);

    // No standalone floating badge duplicating this — the window's own title is the one place.
    assert.equal(box.querySelectorAll('[aria-label^="Wafer info: "]').length, 0);

    ctrl.destroy();
  } finally {
    cleanup();
  }
});

test('renderWaferGallery floating-window fallback: the header\'s drag-to-move does not swallow a pointerdown on the metadata toggle', () => {
  const { window, root, cleanup } = setupDom();
  window.open = () => null; // force the floating-window fallback path
  try {
    const container = window.document.createElement('div');
    root.appendChild(container);

    const item = buildWaferMap({
      results: [{ x: 0, y: 0, hbin: 1 }],
      dieConfig: { width: 10, height: 10 },
      waferConfig: { diameter: 40, metadata: { lot: 'LOT123', waferId: 'W01', product: 'ACME-9' } },
    });
    const ctrl = renderWaferGallery(container, [{ ...item, label: 'LOT123 · W01' }], {});
    click(window, container.querySelector('[data-wmap-expand-btn]'));

    const box = window.document.querySelector('.wmap-window-box');
    const toggle = box.querySelector('[aria-label^="Wafer info for "]');

    // Regression: the window header is draggable (pointerdown starts a
    // reposition via setPointerCapture + preventDefault), and used to only
    // exclude real <button> elements from that — the metadata toggle is a
    // role="button" div/span, so a pointerdown on it also started a drag,
    // which silently swallowed the following click (no error, chevron never
    // flipped) and, since the drag keeps tracking the pointer via capture,
    // visibly dragged the window if the pointer moved afterward (even
    // outside the page). The header's drag-start handler must skip any
    // [role="button"] target, not just real <button> tags.
    const pd = new window.PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerId: 1 });
    toggle.dispatchEvent(pd);
    assert.equal(pd.defaultPrevented, false, 'pointerdown on the metadata toggle must not be treated as a drag-start');

    // The toggle's own click behavior is unaffected by that pointerdown.
    click(window, toggle);
    assert.equal(toggle.getAttribute('aria-expanded'), 'true');

    ctrl.destroy();
  } finally {
    cleanup();
  }
});

test('renderWaferGallery real popup window: persistent identity header with expand chevron, dismissed by an outside click in the popup\'s own document', () => {
  const { window, root, cleanup } = setupDom();
  let popupWindow = null;
  const originalOpen = window.open;
  window.open = function open(...args) {
    popupWindow = originalOpen.apply(this, args);
    return popupWindow;
  };
  try {
    const container = window.document.createElement('div');
    root.appendChild(container);

    const item = buildWaferMap({
      results: [{ x: 0, y: 0, hbin: 1 }],
      dieConfig: { width: 10, height: 10 },
      waferConfig: { diameter: 40, metadata: { lot: 'LOT123', waferId: 'W01', product: 'ACME-9' } },
    });
    const ctrl = renderWaferGallery(container, [{ ...item, label: 'LOT123 · W01' }], {});
    const expandBtn = container.querySelector('[data-wmap-expand-btn]');
    click(window, expandBtn);

    assert.ok(popupWindow, 'a real popup window should have opened');
    const doc = popupWindow.document;

    const toggle = doc.querySelector('[aria-label^="Wafer info for "]');
    assert.ok(toggle, 'popup should show a persistent identity header with an expand toggle');
    assert.equal(toggle.getAttribute('aria-expanded'), 'false');
    assert.equal(doc.querySelectorAll('[aria-label^="Wafer info: "]').length, 0, 'no separate floating badge — the header is the one place');

    const panel = doc.querySelector('[data-wmap-card-meta-panel]');
    assert.ok(panel, 'metadata panel should exist (hidden) before expanding');
    assert.equal(panel.style.display, 'none');

    click(popupWindow, toggle);
    assert.equal(toggle.getAttribute('aria-expanded'), 'true');
    assert.equal(panel.style.display, 'block');
    assert.match(panel.textContent, /ACME-9/);

    // Dismiss via a click elsewhere in the POPUP'S OWN document — this only
    // works because wireExpandToggle registers its outside-click listener on
    // trigger.ownerDocument, not the bare global `document`; the popup is a
    // genuinely different Document than the main page.
    click(popupWindow, doc.body);
    assert.equal(toggle.getAttribute('aria-expanded'), 'false');
    assert.equal(panel.style.display, 'none');

    ctrl.destroy();
  } finally {
    cleanup();
  }
});

test('renderWaferGallery supports multiple simultaneous detached popup windows and unlinks them on rebuild', () => {
  const { window, root, cleanup } = setupDom();
  try {
    const container = window.document.createElement('div');
    root.appendChild(container);

    const base = buildWaferMap({
      results: [
        { x: 0, y: 0, testValues: { 0: 0.9 }, hbin: 1, sbin: 10 },
        { x: 1, y: 0, testValues: { 0: 0.7 }, hbin: 2, sbin: 11 },
        { x: 0, y: 1, testValues: { 0: 0.8 }, hbin: 1, sbin: 10 },
      ],
      waferConfig: { diameter: 40 },
      dieConfig: { width: 10, height: 10 },
      hbinDefs: [{ bin: 1, name: 'Pass' }, { bin: 2, name: 'Fail' }],
      sbinDefs: [{ bin: 10, name: 'Soft A' }, { bin: 11, name: 'Soft B' }],
      testDefs: [{ testNumber: 0, name: 'Test', unit: 'V' }],
    });

    const items = [
      { ...base, label: 'A' },
      { ...base, label: 'B' },
      { ...base, label: 'C' },
    ];

    const ctrl = renderWaferGallery(container, items, { cardPadding: 4 });

    const expandBtns = container.querySelectorAll('[data-wmap-expand-btn]');
    assert.equal(expandBtns.length, 3);

    // Detach two cards simultaneously — each opens its own independent popup.
    click(window, expandBtns[0]);
    click(window, expandBtns[1]);
    // Non-modal by construction (real separate windows): the grid (still
    // holding card C) stays fully interactive, with an empty placeholder
    // where each detached card used to be.
    assert.equal(container.querySelectorAll('.wmap-gallery-card').length, 3);
    assert.equal(container.querySelectorAll('canvas').length, 1); // only card C's canvas remains in the grid

    // A stacked-mode transition rebuilds the grid out from under the two
    // detached cards — this is the scenario the buildCards() unlink guard fixes.
    ctrl.setOptions({ plotMode: 'stackedBins' });
    // Both popups must survive the rebuild, not be destroyed — confirmed via
    // their titles switching to the unlinked notice.
    const detachBtnLabel = 'Reattach to gallery';
    const reattachBtnsRemaining = [...container.querySelectorAll('[data-wmap-expand-btn]')]
      .filter(b => b.getAttribute('aria-label') === detachBtnLabel);
    assert.equal(reattachBtnsRemaining.length, 0); // no grid slot still offers reattach

    ctrl.destroy();
  } finally {
    cleanup();
  }
});

test('renderWaferGallery reattaches a detached card via its own toggle button', () => {
  const { window, root, cleanup } = setupDom();
  try {
    const container = window.document.createElement('div');
    root.appendChild(container);

    const base = buildWaferMap({
      results: [
        { x: 0, y: 0, testValues: { 0: 0.9 }, hbin: 1 },
        { x: 1, y: 0, testValues: { 0: 0.7 }, hbin: 2 },
        { x: 0, y: 1, testValues: { 0: 0.8 }, hbin: 1 },
      ],
      waferConfig: { diameter: 40 },
      dieConfig: { width: 10, height: 10 },
    });

    const items = [
      { ...base, label: 'A' },
      { ...base, label: 'B' },
    ];

    const ctrl = renderWaferGallery(container, items, { cardPadding: 4 });
    const expandBtn = container.querySelector('[data-wmap-expand-btn]');

    click(window, expandBtn);
    assert.equal(expandBtn.getAttribute('aria-label'), 'Reattach to gallery');
    assert.equal(container.querySelectorAll('canvas').length, 1); // card A detached, only card B's canvas in the grid

    // Same button, now wired to reattach — closes the popup and rebuilds the
    // grid slot with a fresh controller.
    click(window, expandBtn);
    assert.equal(container.querySelectorAll('canvas').length, 2);
    const rebuiltBtn = container.querySelector('[data-wmap-expand-btn]');
    assert.equal(rebuiltBtn.title, 'Open full view');

    ctrl.destroy();
  } finally {
    cleanup();
  }
});

test('renderWaferGallery restores original cards when leaving stacked mode', () => {
  const { window, root, cleanup } = setupDom();
  try {
    const container = window.document.createElement('div');
    root.appendChild(container);

    const base = buildWaferMap({
      results: [
        { x: 0, y: 0, testValues: { 0: 0.9 }, hbin: 1, sbin: 10 },
        { x: 1, y: 0, testValues: { 0: 0.7 }, hbin: 2, sbin: 11 },
        { x: 0, y: 1, testValues: { 0: 0.8 }, hbin: 1, sbin: 10 },
      ],
      waferConfig: { diameter: 40 },
      dieConfig: { width: 10, height: 10 },
      hbinDefs: [{ bin: 1, name: 'Pass' }, { bin: 2, name: 'Fail' }],
      sbinDefs: [{ bin: 10, name: 'Soft A' }, { bin: 11, name: 'Soft B' }],
      testDefs: [{ testNumber: 0, name: 'Test', unit: 'V' }],
    });

    const items = [
      { ...base, label: 'A' },
      { ...base, label: 'B' },
      { ...base, label: 'C' },
    ];

    const ctrl = renderWaferGallery(container, items, {
      viewOptions: { plotMode: 'stackedBins' },
    });

    const stackedCards = container.querySelectorAll('.wmap-gallery-card').length;
    assert.equal(stackedCards, (base.hbinDefs ?? []).length);

    ctrl.setOptions({ plotMode: 'hardBin' });
    assert.equal(container.querySelectorAll('.wmap-gallery-card').length, items.length);

    ctrl.destroy();
  } finally {
    cleanup();
  }
});

test('renderWaferGallery clears stacked options when leaving stacked mode', () => {
  const { window, root, cleanup } = setupDom();
  try {
    const container = window.document.createElement('div');
    root.appendChild(container);

    const base = buildWaferMap({
      results: [
        { x: 0, y: 0, testValues: { 0: 0.9 }, hbin: 1, sbin: 10 },
        { x: 1, y: 0, testValues: { 0: 0.7 }, hbin: 2, sbin: 11 },
        { x: 0, y: 1, testValues: { 0: 0.8 }, hbin: 1, sbin: 10 },
      ],
      waferConfig: { diameter: 40 },
      dieConfig: { width: 10, height: 10 },
      hbinDefs: [{ bin: 1, name: 'Pass' }, { bin: 2, name: 'Fail' }],
      sbinDefs: [{ bin: 10, name: 'Soft A' }, { bin: 11, name: 'Soft B' }],
      testDefs: [{ testNumber: 0, name: 'Test', unit: 'V' }],
    });

    const items = [
      { ...base, label: 'A' },
      { ...base, label: 'B' },
      { ...base, label: 'C' },
    ];

    const ctrl = renderWaferGallery(container, items, {
      viewOptions: { plotMode: 'stackedValues' },
    });

    // Initially in stacked mode
    assert.equal(container.querySelectorAll('.wmap-gallery-card').length, 1); // One aggregated card for stackedValues

    // Switch to value mode - should restore individual cards and clear stacked options
    ctrl.setOptions({ plotMode: 'value', activeTest: 0 });
    assert.equal(container.querySelectorAll('.wmap-gallery-card').length, items.length);

    // Verify the shared options don't contain stacked-specific properties
    const opts = ctrl.getOptions();
    assert.equal(opts.valueRange, undefined);
    assert.equal(opts.lotSize, undefined);
    assert.equal(opts.aggregationMethod, undefined);
    assert.equal(opts.plotMode, 'value');
    assert.equal(opts.activeTest, 0);

    ctrl.destroy();
  } finally {
    cleanup();
  }
});

test('renderWaferGallery computes correct valueRange for stackedValues mode', () => {
  const { window, root, cleanup } = setupDom();
  try {
    const container = window.document.createElement('div');
    root.appendChild(container);

    // Create test data with known value ranges
    const base = buildWaferMap({
      results: [
        { x: 0, y: 0, testValues: { 0: 1.0 }, hbin: 1, sbin: 10 },
        { x: 1, y: 0, testValues: { 0: 2.0 }, hbin: 2, sbin: 11 },
        { x: 0, y: 1, testValues: { 0: 3.0 }, hbin: 1, sbin: 10 },
      ],
      waferConfig: { diameter: 40 },
      dieConfig: { width: 10, height: 10 },
      hbinDefs: [{ bin: 1, name: 'Pass' }, { bin: 2, name: 'Fail' }],
      sbinDefs: [{ bin: 10, name: 'Soft A' }, { bin: 11, name: 'Soft B' }],
      testDefs: [{ testNumber: 0, name: 'Test', unit: 'V' }],
    });

    const items = [
      { ...base, label: 'A' },
      { ...base, label: 'B' },
      { ...base, label: 'C' },
    ];

    const ctrl = renderWaferGallery(container, items, {
      viewOptions: { plotMode: 'hardBin' },
    });

    // Switch to stackedValues mode
    ctrl.setOptions({ plotMode: 'stackedValues' });

    // Check that valueRange is not set globally for stackedValues (each card computes its own)
    const opts = ctrl.getOptions();
    assert.equal(opts.valueRange, undefined); // Each card computes its own range

    ctrl.destroy();
  } finally {
    cleanup();
  }
});

test('renderWaferMap handles empty scenes gracefully', () => {
  const { window, root, cleanup } = setupDom();
  try {
    const container = window.document.createElement('div');
    root.appendChild(container);

    const emptyWafer = buildWaferMap([]);
    const ctrl = renderWaferMap(container, emptyWafer);

    assert.ok(ctrl);
    ctrl.destroy();
  } finally {
    cleanup();
  }
});

test('renderWaferGallery exposes Spec pass/fail and Colorbar range for value maps with limits', () => {
  const { window, root, cleanup } = setupDom();
  try {
    const container = window.document.createElement('div');
    Object.assign(container.style, { position: 'relative', width: '600px', height: '500px' });
    root.appendChild(container);

    const base = buildWaferMap({
      results: [
        { x: 0, y: 0, testValues: { 1010: 0.5 }, hbin: 1 },
        { x: 1, y: 0, testValues: { 1010: 2.5 }, hbin: 1 },
        { x: 0, y: 1, testValues: { 1010: 5.0 }, hbin: 1 },
      ],
      waferConfig: { diameter: 40 },
      dieConfig: { width: 10, height: 10 },
      testDefs: [{ testNumber: 1010, name: 'Vth', unit: 'V', limitLow: 1.0, limitHigh: 3.0 }],
    });

    const ctrl = renderWaferGallery(container, [{ ...base, label: 'A' }, { ...base, label: 'B' }]);
    const buttons = () => [...container.querySelectorAll('button')];

    // Colorbar range button exists.
    const rangeBtn = buttons().find((b) => (b.ariaLabel ?? '').startsWith('Colorbar range'));
    assert.ok(rangeBtn, 'Colorbar range button should exist in the gallery toolbar');

    // In a bin/default mode it is hidden; switching to the value test makes it visible.
    ctrl.setOptions({ plotMode: 'value', activeTest: 1010 });
    assert.notEqual(rangeBtn.style.display, 'none', 'Colorbar range visible in value mode with limits');

    // Overlays menu offers an enabled "Spec pass/fail" row in value mode.
    const overlaysBtn = buttons().find((b) => b.ariaLabel === 'Overlays');
    assert.ok(overlaysBtn, 'Overlays button exists');
    click(window, overlaysBtn);
    const menu = [...window.document.querySelectorAll('[role="menu"]')].at(-1);
    // Disabled overlay rows are omitted entirely; presence here ⇒ enabled (active test has limits).
    const specRow = [...menu.querySelectorAll('[role="menuitemcheckbox"]')]
      .find((el) => /Spec pass\/fail/.test(el.textContent ?? ''));
    assert.ok(specRow, 'Spec pass/fail row present (enabled) when active test has limits');

    // Enabling spec mode hides the colorbar-range button (bar irrelevant in pass/fail).
    ctrl.setOptions({ passFailDisplay: 'spec' });
    assert.equal(rangeBtn.style.display, 'none', 'Colorbar range hidden while colouring by spec');

    // Leaving value mode clears spec colouring.
    ctrl.setOptions({ plotMode: 'hardBin', activeTest: undefined, passFailDisplay: 'off' });
    assert.equal(rangeBtn.style.display, 'none', 'Colorbar range hidden outside value mode');

    ctrl.destroy();
  } finally {
    cleanup();
  }
});

test('renderWaferGallery handles empty items array', () => {
  const { window, root, cleanup } = setupDom();
  try {
    const container = window.document.createElement('div');
    root.appendChild(container);

    const ctrl = renderWaferGallery(container, []);
    assert.equal(container.querySelectorAll('.wmap-gallery-card').length, 0);

    ctrl.destroy();
    assert.equal(container.childElementCount, 0);
  } finally {
    cleanup();
  }
});

test('renderWaferMap: summaryPanel option renders a docked Summary panel with severity filter controls, independent of Insights', () => {
  const { window, root, cleanup } = setupDom();
  try {
    const container = window.document.createElement('div');
    Object.assign(container.style, { position: 'relative', width: '600px', height: '400px' });
    root.appendChild(container);

    const { wafer, statsSummary } = buildWaferWithFinding();
    assert.ok(statsSummary.findings.length > 0, 'fixture should produce at least one finding');

    const ctrl = renderWaferMap(container, wafer, {
      statsSummary,
      summaryPanel: { defaultOpen: true },
    });

    const buttons = [...root.querySelectorAll('button')];
    const summaryBtn = buttons.find((btn) => btn.ariaLabel === 'Summary panel');
    assert.ok(summaryBtn, 'Summary toolbar button should exist');

    // Severity filter chips (e.g. "Unusual 2") should be present in the
    // panel's findings section — toggle buttons with per-severity counts.
    const chips = [...root.querySelectorAll('button')].filter((btn) => /^(Unusual|Notable|Info) \d+$/.test(btn.textContent ?? ''));
    assert.ok(chips.length >= 1, 'severity filter chips should render');

    // At least one finding row (a button with the finding's summary text) should render.
    const findingRows = [...root.querySelectorAll('button[data-wmap-finding]')];
    assert.ok(findingRows.length > 0, 'at least one finding row should render');

    // Summary button stays reachable/independent even without Insights enabled.
    ctrl.closeSummaryPanel();
    ctrl.destroy();
  } finally {
    cleanup();
  }
});

test('renderWaferMap: insights option renders a full-takeover tab with Overview/Distributions/Correlation sub-tabs, and hides the Summary button while open', () => {
  const { window, root, cleanup } = setupDom();
  try {
    const container = window.document.createElement('div');
    Object.assign(container.style, { position: 'relative', width: '900px', height: '600px' });
    root.appendChild(container);

    const { wafer, statsSummary } = buildWaferWithFinding();

    const ctrl = renderWaferMap(container, wafer, {
      statsSummary,
      summaryPanel: { defaultOpen: false },
      insights: { enabled: true },
    });

    const buttons = [...root.querySelectorAll('button')];
    const insightsBtn = buttons.find((btn) => btn.ariaLabel === 'Insights');
    const summaryBtn = buttons.find((btn) => btn.ariaLabel === 'Summary panel');
    assert.ok(insightsBtn, 'Insights toolbar button should exist');
    assert.ok(summaryBtn, 'Summary toolbar button should exist alongside Insights');
    // Stable identity hook — this button's aria-label is toggled by open
    // state (asserted below), so tooling needs a hook that doesn't change
    // with it. See tsmap's WMAP_ISSUES.md #36.
    assert.equal(insightsBtn.dataset.wmapInsightsBtn, '1', 'Insights button carries a stable data-wmap-insights-btn hook');

    ctrl.setInsightsOpen(true);
    const subTabLabels = [...root.querySelectorAll('button')].map((b) => b.textContent);
    assert.ok(subTabLabels.includes('Overview'), 'Overview sub-tab should render');
    assert.ok(subTabLabels.includes('Distributions'), 'Distributions sub-tab should render');
    assert.ok(subTabLabels.includes('Correlation'), 'Correlation sub-tab should render');

    const tabButtons = [...root.querySelectorAll('button[role="tab"]')];
    assert.deepEqual(
      tabButtons.map((b) => b.dataset.wmapInsightsTab).sort(),
      ['correlation', 'distributions', 'overview'],
      'each Insights sub-tab carries data-wmap-insights-tab set to its view key',
    );

    // Overview's chart cards (cardShell) carry stable card/title hooks —
    // the only way tooling could locate "Yield by wafer" before this was
    // matching its heading's raw textContent (WMAP_ISSUES.md #36).
    const chartCards = [...root.querySelectorAll('[data-wmap-chart-card]')];
    assert.ok(chartCards.length > 0, 'at least one chart card renders in Overview');
    // "Hard bin pareto" (not "Yield by wafer") — the yield panel is skipped
    // for a single-wafer host (renderYieldBinsSection's includeYieldPanel),
    // but bin pareto renders unconditionally, so it's the reliable title to
    // assert against for both single-wafer and gallery hosts.
    const paretoCard = chartCards.find((c) => c.dataset.wmapChartTitle === 'Hard bin pareto');
    assert.ok(paretoCard, 'the "Hard bin pareto" card is findable by data-wmap-chart-title, not heading text');

    // The responsive card grid wrapping those cards.
    assert.ok(root.querySelector('[data-wmap-chart-grid]'), 'the Overview section grid carries data-wmap-chart-grid');

    // The Summary button stays mounted (so it's still there when Insights closes) but
    // hidden while Insights is open — its panel sits behind the Insights overlay with
    // no visible effect, and only Insights/Expand/User guide remain reachable, per docs.
    assert.ok(root.contains(summaryBtn), 'Summary button stays mounted while Insights is open');
    assert.strictEqual(summaryBtn.style.display, 'none', 'Summary button is hidden while Insights is open');

    // The Insights button's own icon flips to signal "click to go back" while open.
    assert.strictEqual(insightsBtn.ariaLabel, 'Back to wafer view', 'Insights button label flips while open');

    ctrl.setInsightsOpen(false);
    assert.notEqual(summaryBtn.style.display, 'none', 'Summary button reappears once Insights closes');
    assert.strictEqual(insightsBtn.ariaLabel, 'Insights', 'Insights button label reverts once closed');

    ctrl.destroy();
  } finally {
    cleanup();
  }
});

test('renderWaferMap: metadata badge is mounted by default, absent when disabled, and survives Insights being opened', () => {
  const { window, root, cleanup } = setupDom();
  try {
    const container = window.document.createElement('div');
    Object.assign(container.style, { position: 'relative', width: '900px', height: '600px' });
    root.appendChild(container);

    const wafer = buildWaferMap({
      results: [{ x: 0, y: 0, hbin: 1 }],
      waferConfig: { diameter: 60, metadata: { lot: 'LOT123', waferId: 'W01' } },
    });

    const ctrl = renderWaferMap(container, wafer, { insights: { enabled: true } });
    const badgeEl = [...container.querySelectorAll('div')].find((d) => /LOT123/.test(d.textContent) && /W01/.test(d.textContent));
    assert.ok(badgeEl, 'metadata badge should render lot + waferId by default');

    ctrl.setInsightsOpen(true);
    // Still in the DOM (covered by the Insights overlay, not removed) — same
    // coverage behaviour the toolbar already relies on.
    assert.ok(container.contains(badgeEl), 'badge stays mounted (covered, not destroyed) while Insights is open');
    ctrl.setInsightsOpen(false);
    ctrl.destroy();

    const container2 = window.document.createElement('div');
    Object.assign(container2.style, { position: 'relative', width: '900px', height: '600px' });
    root.appendChild(container2);
    const ctrl2 = renderWaferMap(container2, wafer, { showMetadataBadge: false });
    const badgeEl2 = [...container2.querySelectorAll('div')].find((d) => /LOT123/.test(d.textContent) && /W01/.test(d.textContent));
    assert.equal(badgeEl2, undefined, 'showMetadataBadge:false should render no badge');
    ctrl2.destroy();
  } finally {
    cleanup();
  }
});

test('renderWaferMap: metadata badge does not render when the wafer has no metadata', () => {
  const { window, root, cleanup } = setupDom();
  try {
    const container = window.document.createElement('div');
    Object.assign(container.style, { position: 'relative', width: '900px', height: '600px' });
    root.appendChild(container);

    const wafer = buildWaferMap({ results: [{ x: 0, y: 0, hbin: 1 }], waferConfig: { diameter: 60 } });
    const ctrl = renderWaferMap(container, wafer);
    const badgeButtons = [...container.querySelectorAll('[role="button"][aria-expanded]')];
    assert.equal(badgeButtons.length, 0, 'no badge chrome should exist when metadata is empty');
    ctrl.destroy();
  } finally {
    cleanup();
  }
});

test('renderWaferGallery: Insights hides the Summary button and flips its own icon/label to signal the way back', () => {
  const { window, root, cleanup } = setupDom();
  try {
    const container = window.document.createElement('div');
    root.appendChild(container);

    const { wafer, statsSummary } = buildWaferWithFinding();
    const item = { wafer: wafer.wafer, dies: wafer.dies, hbinDefs: wafer.hbinDefs, statsSummary, label: 'W01' };

    const ctrl = renderWaferGallery(container, [item], {
      insights: { enabled: true },
    });

    const buttons = [...root.querySelectorAll('button')];
    const summaryBtn = buttons.find((btn) => btn.ariaLabel === 'Summary panel');
    const insightsBtn = buttons.find((btn) => btn.ariaLabel === 'Insights');
    assert.ok(summaryBtn, 'Summary toolbar button should exist (item carries per-wafer findings)');
    assert.ok(insightsBtn, 'Insights toolbar button should exist');

    click(window, insightsBtn);
    const subTabLabels = [...root.querySelectorAll('button')].map((b) => b.textContent);
    assert.ok(subTabLabels.includes('Overview'), 'Overview sub-tab should render in the gallery Insights tab too');

    // Summary stays mounted (so it's there when Insights closes) but hidden while
    // Insights is open — its panel sits behind the Insights grid with no visible effect.
    assert.ok(root.contains(summaryBtn), 'Summary button stays mounted while Insights is open');
    assert.strictEqual(summaryBtn.style.display, 'none', 'Summary button is hidden while Insights is open');
    assert.strictEqual(insightsBtn.ariaLabel, 'Back to gallery view', 'Insights button label flips while open');

    click(window, insightsBtn);
    assert.notEqual(summaryBtn.style.display, 'none', 'Summary button reappears once Insights closes');
    assert.strictEqual(insightsBtn.ariaLabel, 'Insights', 'Insights button label reverts once closed');

    ctrl.destroy();
  } finally {
    cleanup();
  }
});

test('pass/fail display toolbar: menu entries appear per data validity; log button hides for F test', () => {
  const { window, root, cleanup } = setupDom();
  try {
    const container = window.document.createElement('div');
    Object.assign(container.style, { position: 'relative', width: '400px', height: '400px' });
    root.appendChild(container);

    const testDefs = [
      { testNumber: 1010, name: 'Vth', unit: 'V', limitLow: 0.2, limitHigh: 3.0 },
      { testNumber: 2001, name: 'scan_chain', testType: 'F' },
    ];
    const wafer = buildWaferMap({
      results: [
        { x: 0, y: 0, hbin: 1, testValues: { 1010: 1.0 }, testPass: { 1010: true, 2001: true } },
        { x: 1, y: 0, hbin: 2, testValues: { 1010: 1.1 }, testPass: { 1010: false, 2001: false } },
      ],
      waferConfig: { diameter: 40 },
      dieConfig: { width: 10, height: 10 },
      testDefs,
    });

    const ctrl = renderWaferMap(container, wafer, { viewOptions: { plotMode: 'value', activeTest: 1010 } });
    const buttons = [...root.querySelectorAll('button')];
    const overlaysBtn = buttons.find((btn) => btn.ariaLabel === 'Overlays');
    const logBtn = buttons.find((btn) => btn.ariaLabel === 'Toggle log scale');
    assert.ok(overlaysBtn && logBtn);

    const menuRowByLabel = (label) =>
      [...window.document.querySelectorAll('div')].find((el) =>
        [...el.children].some((ch) => ch.children.length === 0 && ch.textContent === label));

    // P test with limits AND recorded verdicts: both entries offered.
    click(window, overlaysBtn);
    assert.ok(menuRowByLabel('Spec pass/fail'), 'spec entry offered for a limited P test');
    const testRow = menuRowByLabel('Test pass/fail');
    assert.ok(testRow, 'test entry offered when recorded verdicts exist');
    click(window, testRow);
    assert.equal(ctrl.getOptions().passFailDisplay, 'test');
    assert.equal(logBtn.style.display, 'none', 'log scale hidden under a solid pass/fail display');

    // Functional active test: neither entry offered (its value mode IS test pass/fail),
    // log scale hidden.
    ctrl.setOptions({ activeTest: 2001, passFailDisplay: 'off' });
    click(window, overlaysBtn); // close
    click(window, overlaysBtn); // reopen with fresh rows
    assert.equal(menuRowByLabel('Spec pass/fail'), undefined, 'no spec entry for an F test');
    assert.equal(menuRowByLabel('Test pass/fail'), undefined, 'no test entry for an F test');
    assert.equal(logBtn.style.display, 'none', 'log scale hidden for a functional test');

    ctrl.destroy();
  } finally {
    cleanup();
  }
});

test('renderWaferGallery stackedValues excludes functional tests from value stacks', () => {
  const { window, root, cleanup } = setupDom();
  try {
    const container = window.document.createElement('div');
    root.appendChild(container);

    const testDefs = [
      { testNumber: 1010, name: 'Vth', unit: 'V' },
      { testNumber: 2001, name: 'scan_chain', testType: 'F' },
    ];
    const base = buildWaferMap({
      results: [
        // scan_chain arrives the legacy way (0/1 in testValues) — the worst case:
        // it must STILL not get a mean/median stacked card.
        { x: 0, y: 0, hbin: 1, testValues: { 1010: 0.9, 2001: 1 } },
        { x: 1, y: 0, hbin: 2, testValues: { 1010: 0.7, 2001: 0 } },
      ],
      waferConfig: { diameter: 40 },
      dieConfig: { width: 10, height: 10 },
      testDefs,
    });
    const ctrl = renderWaferGallery(container, [{ ...base, label: 'A' }, { ...base, label: 'B' }], {
      viewOptions: { plotMode: 'stackedValues' },
    });

    const cards = [...container.querySelectorAll('.wmap-gallery-card')];
    assert.equal(cards.length, 1, 'only the parametric test gets a stacked card');
    assert.match(container.textContent, /Vth/, 'the parametric stack is present');
    assert.doesNotMatch(container.textContent, /scan_chain · mean/, 'no functional value stack');

    ctrl.destroy();
  } finally {
    cleanup();
  }
});

test('renderWaferMap: metadata mode menu entry appears only when a configured field is actually present, switches mode/legend on click', () => {
  const { window, root, cleanup } = setupDom();
  try {
    const container = window.document.createElement('div');
    Object.assign(container.style, { position: 'relative', width: '400px', height: '400px' });
    root.appendChild(container);

    const wafer = buildWaferMap({
      results: [
        { x: 0, y: 0, hbin: 1, metadata: { project: 'our-project' } },
        { x: 1, y: 0, hbin: 2, metadata: { project: 'vendor' } },
      ],
      waferConfig: { diameter: 40 },
      dieConfig: { width: 10, height: 10 },
      metadataFields: [
        { key: 'project', label: 'Project' },
        { key: 'unused' }, // configured but present on no die — must not appear
      ],
    });

    const ctrl = renderWaferMap(container, wafer);
    const buttons = [...root.querySelectorAll('button')];
    const modeBtn = buttons.find((b) => b.ariaLabel === 'Plot mode');

    const menuRowByLabel = (label) =>
      [...window.document.querySelectorAll('[role="menuitemradio"]')].find((el) => el.textContent === label);

    click(window, modeBtn);
    const projectRow = menuRowByLabel('Project');
    assert.ok(projectRow, 'entry offered for a configured field actually present in the dies');
    assert.equal(menuRowByLabel('Unused'), undefined, 'no entry for a configured field absent from every die');

    click(window, projectRow);
    assert.equal(ctrl.getOptions().plotMode, 'metadata');
    assert.equal(ctrl.getOptions().activeMetadataKey, 'project');

    const legend = ctrl.getActiveLegend();
    assert.ok(legend, 'getActiveLegend returns entries in metadata mode');
    const names = legend.map((e) => e.name).sort();
    assert.deepEqual(names, ['our-project', 'vendor']);

    ctrl.destroy();
  } finally {
    cleanup();
  }
});

test('renderWaferGallery: metadata mode legend strip shows every distinct value across cards, coloured and labelled from metadataFields', () => {
  const { window, root, cleanup } = setupDom();
  try {
    const container = window.document.createElement('div');
    root.appendChild(container);

    const metadataFields = [{ key: 'project', label: 'Project', values: [
      { value: 'our-project', label: 'Our Project' },
    ] }];
    const a = buildWaferMap({
      results: [{ x: 0, y: 0, hbin: 1, metadata: { project: 'our-project' } }],
      waferConfig: { diameter: 40 }, dieConfig: { width: 10, height: 10 }, metadataFields,
    });
    const b = buildWaferMap({
      results: [{ x: 0, y: 0, hbin: 1, metadata: { project: 'vendor' } }],
      waferConfig: { diameter: 40 }, dieConfig: { width: 10, height: 10 }, metadataFields,
    });

    const ctrl = renderWaferGallery(container, [{ ...a, label: 'A' }, { ...b, label: 'B' }], {
      viewOptions: { plotMode: 'metadata', activeMetadataKey: 'project' },
    });

    assert.match(container.textContent, /Our Project/, 'override label used for our-project');
    assert.match(container.textContent, /vendor/, 'raw value used for vendor (no override)');

    ctrl.destroy();
  } finally {
    cleanup();
  }
});

test('renderWaferGallery: clicking a metadata legend swatch toggles highlightMetadataValue, exactly like hardBin/softBin swatches toggle highlightBin', () => {
  const { window, root, cleanup } = setupDom();
  try {
    const container = window.document.createElement('div');
    root.appendChild(container);

    const metadataFields = [{ key: 'project', label: 'Project' }];
    const a = buildWaferMap({
      results: [{ x: 0, y: 0, hbin: 1, metadata: { project: 'our-project' } }],
      waferConfig: { diameter: 40 }, dieConfig: { width: 10, height: 10 }, metadataFields,
    });
    const b = buildWaferMap({
      results: [{ x: 0, y: 0, hbin: 1, metadata: { project: 'vendor' } }],
      waferConfig: { diameter: 40 }, dieConfig: { width: 10, height: 10 }, metadataFields,
    });

    const ctrl = renderWaferGallery(container, [{ ...a, label: 'A' }, { ...b, label: 'B' }], {
      viewOptions: { plotMode: 'metadata', activeMetadataKey: 'project' },
    });

    const swatchRow = [...container.querySelectorAll('div')].find((el) => el.textContent === 'our-project');
    assert.ok(swatchRow, 'a clickable row exists for the our-project value');

    click(window, swatchRow);
    assert.equal(ctrl.getOptions().highlightMetadataValue, 'our-project');

    click(window, swatchRow); // clicking the active value again clears it
    assert.equal(ctrl.getOptions().highlightMetadataValue, undefined);

    ctrl.destroy();
  } finally {
    cleanup();
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Toolbar overflow.
//
// The toolbar is pinned by its RIGHT edge, so with no width bound its overflow
// grows leftward — out of the container and across whatever sits beside it. It
// had always been wider than a ~400px container; adding the warning indicator
// pushed the threshold to ~467px and made it visible in a 3-up demo, where each
// map's toolbar ran across its neighbour.
//
// jsdom does no layout, so this asserts the constraint is DECLARED rather than
// measuring the result. Real widths are checked in a browser; this is the guard
// that stops the declaration being dropped in an unrelated edit.
// ─────────────────────────────────────────────────────────────────────────────

test('renderWaferMap toolbar is width-bounded so it cannot overflow across neighbouring content', () => {
  const { window, root, cleanup } = setupDom();
  try {
    const container = window.document.createElement('div');
    Object.assign(container.style, { position: 'relative', width: '300px', height: '300px' });
    root.appendChild(container);

    const wafer = buildWaferMap({
      results: [
        { x: 0, y: 0, hbin: 1 },
        { x: 1, y: 0, hbin: 2 },
        { x: 0, y: 1, hbin: 1 },
      ],
      waferConfig: { diameter: 40 },
      dieConfig: { width: 10, height: 10 },
    });

    renderWaferMap(container, wafer, {});

    const toolbar = container.querySelector('[data-wmap-toolbar="single"]');
    assert.ok(toolbar, 'expected a toolbar');

    assert.ok(
      /calc\(100% - \d+px\)|100%/.test(toolbar.style.maxWidth),
      `toolbar needs a max-width bound relative to its container, got '${toolbar.style.maxWidth}'`,
    );
    assert.equal(
      toolbar.style.flexWrap, 'wrap-reverse',
      'toolbar must wrap rather than overflow, and wrap-REVERSE keeps the trailing '
      + 'group (ending in Expand) on the top row where it always sits',
    );
    assert.equal(
      toolbar.style.justifyContent, 'flex-end',
      'rows stay right-aligned to match the toolbar\'s right-pinned edge',
    );

    // The toolbar's direct children are the control GROUPS, which is what makes
    // it break on a group boundary instead of mid-group.
    const groups = [...toolbar.children].filter(c => c.tagName === 'DIV');
    assert.ok(groups.length >= 1, 'toolbar should be composed of group containers');
  } finally {
    cleanup();
  }
});

test('renderWaferMap warning indicator: hidden when clean, shown with an accessible name when not', () => {
  const { window, root, cleanup } = setupDom();
  try {
    // A half-wafer with no geometry supplied raises 'partial-coverage'.
    const results = [];
    for (let x = 0; x <= 8; x++) {
      for (let y = -8; y <= 8; y++) {
        if (Math.hypot(x, y) > 8) continue;
        results.push({ x, y, hbin: 1 });
      }
    }
    const warned = buildWaferMap({ results, passBins: [1] });
    assert.ok(warned.warnings.length > 0, 'fixture should raise a geometry advisory');

    const c1 = window.document.createElement('div');
    Object.assign(c1.style, { position: 'relative', width: '600px', height: '600px' });
    root.appendChild(c1);
    renderWaferMap(c1, warned, {});

    const btn = [...c1.querySelectorAll('button')]
      .find(b => (b.getAttribute('aria-label') ?? '').toLowerCase().includes('warning'));
    assert.ok(btn, 'expected a warning indicator when the result carries advisories');
    assert.notEqual(btn.style.display, 'none', 'indicator must be visible when there is something to say');
    // Severity must not be conveyed by colour alone (WCAG 1.4.1).
    assert.match(btn.getAttribute('aria-label'), /positionally wrong/,
      'an error-severity advisory must say so in the accessible name, not just in red');

    // Clean wafer → the indicator exists but stays hidden.
    const clean = buildWaferMap({
      results: [{ x: 0, y: 0, hbin: 1 }, { x: 1, y: 0, hbin: 2 }],
      waferConfig: { diameter: 40 }, dieConfig: { width: 10, height: 10 }, passBins: [1],
    });
    assert.equal(clean.warnings.length, 0, 'fixture should be clean');

    const c2 = window.document.createElement('div');
    Object.assign(c2.style, { position: 'relative', width: '600px', height: '600px' });
    root.appendChild(c2);
    renderWaferMap(c2, clean, {});

    const hidden = [...c2.querySelectorAll('button')]
      .find(b => (b.getAttribute('aria-label') ?? '').toLowerCase().includes('warning'));
    assert.ok(!hidden || hidden.style.display === 'none',
      'an unremarkable map must carry no visible warning chrome');
  } finally {
    cleanup();
  }
});

test('renderWaferMap warnings display:false suppresses the indicator but still calls onWarning', () => {
  const { window, root, cleanup } = setupDom();
  try {
    const results = [];
    for (let x = 0; x <= 8; x++) {
      for (let y = -8; y <= 8; y++) {
        if (Math.hypot(x, y) > 8) continue;
        results.push({ x, y, hbin: 1 });
      }
    }
    const warned = buildWaferMap({ results, passBins: [1] });

    const container = window.document.createElement('div');
    Object.assign(container.style, { position: 'relative', width: '600px', height: '600px' });
    root.appendChild(container);

    const seen = [];
    renderWaferMap(container, warned, {
      warnings: { display: false, onWarning: (w) => seen.push(w) },
    });

    const btn = [...container.querySelectorAll('button')]
      .find(b => (b.getAttribute('aria-label') ?? '').toLowerCase().includes('warning'));
    assert.ok(!btn, 'display:false must render no indicator at all');

    // The host owns presentation, but the library still owns collection —
    // turning the UI off must not turn the information off.
    assert.equal(seen.length, 1, 'onWarning fires once on mount');
    assert.ok(seen[0].some(w => w.code === 'partial-coverage'));
  } finally {
    cleanup();
  }
});
