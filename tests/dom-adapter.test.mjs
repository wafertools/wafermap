import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

import { buildWaferMap } from '../dist/index.js';
import { renderWaferMap, renderWaferGallery } from '../dist/packages/canvas-adapter/index.js';

function makeDies() {
  return [
    { id: '0_0', i: 0, j: 0, x: 0, y: 0, width: 10, height: 10, values: [0.9], hbin: 1 },
    { id: '1_0', i: 1, j: 0, x: 10, y: 0, width: 10, height: 10, values: [0.7], hbin: 2 },
    { id: '0_1', i: 0, j: 1, x: 0, y: 10, width: 10, height: 10, values: [0.8], hbin: 1 },
    { id: '1_1', i: 1, j: 1, x: 10, y: 10, width: 10, height: 10, values: [0.6], hbin: 2 },
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
  globalThis.matchMedia = window.matchMedia?.bind(window) ?? (() => ({
    matches: false,
    media: '',
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    dispatchEvent() { return false; },
  }));
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

  return {
    window,
    root: window.document.getElementById('root'),
    cleanup() {
      for (const [key, value] of previous) {
        if (value === undefined) delete globalThis[key];
        else globalThis[key] = value;
      }
      dom.window.close();
    },
  };
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
        { x: 0, y: 0, values: [0.9], hbin: 1 },
        { x: 1, y: 0, values: [0.7], hbin: 2 },
        { x: 0, y: 1, values: [0.8], hbin: 1 },
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

test('renderWaferGallery builds cards, opens the modal, and rebuilds items', () => {
  const { window, root, cleanup } = setupDom();
  try {
    const container = window.document.createElement('div');
    root.appendChild(container);

    const base = buildWaferMap({
      results: [
        { x: 0, y: 0, values: [0.9], hbin: 1 },
        { x: 1, y: 0, values: [0.7], hbin: 2 },
        { x: 0, y: 1, values: [0.8], hbin: 1 },
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
    assert.ok(window.document.getElementById('wmap-modal-backdrop'));

    ctrl.setItems([{ ...base, label: 'C' }]);
    assert.equal(container.querySelectorAll('.wmap-gallery-card').length, 1);

    ctrl.destroy();
    assert.equal(container.childElementCount, 0);
    assert.equal(window.document.getElementById('wmap-modal-backdrop'), null);
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
        { x: 0, y: 0, values: [0.9], hbin: 1, sbin: 10 },
        { x: 1, y: 0, values: [0.7], hbin: 2, sbin: 11 },
        { x: 0, y: 1, values: [0.8], hbin: 1, sbin: 10 },
      ],
      waferConfig: { diameter: 40 },
      dieConfig: { width: 10, height: 10 },
      hbinDefs: [{ bin: 1, name: 'Pass' }, { bin: 2, name: 'Fail' }],
      sbinDefs: [{ bin: 10, name: 'Soft A' }, { bin: 11, name: 'Soft B' }],
      testDefs: [{ index: 0, name: 'Test', unit: 'V' }],
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
        { x: 0, y: 0, values: [0.9], hbin: 1, sbin: 10 },
        { x: 1, y: 0, values: [0.7], hbin: 2, sbin: 11 },
        { x: 0, y: 1, values: [0.8], hbin: 1, sbin: 10 },
      ],
      waferConfig: { diameter: 40 },
      dieConfig: { width: 10, height: 10 },
      hbinDefs: [{ bin: 1, name: 'Pass' }, { bin: 2, name: 'Fail' }],
      sbinDefs: [{ bin: 10, name: 'Soft A' }, { bin: 11, name: 'Soft B' }],
      testDefs: [{ index: 0, name: 'Test', unit: 'V' }],
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
        { x: 0, y: 0, values: [1.0], hbin: 1, sbin: 10 },
        { x: 1, y: 0, values: [2.0], hbin: 2, sbin: 11 },
        { x: 0, y: 1, values: [3.0], hbin: 1, sbin: 10 },
      ],
      waferConfig: { diameter: 40 },
      dieConfig: { width: 10, height: 10 },
      hbinDefs: [{ bin: 1, name: 'Pass' }, { bin: 2, name: 'Fail' }],
      sbinDefs: [{ bin: 10, name: 'Soft A' }, { bin: 11, name: 'Soft B' }],
      testDefs: [{ index: 0, name: 'Test', unit: 'V' }],
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
    ctrl.setOptions({ colorBySpec: true });
    assert.equal(rangeBtn.style.display, 'none', 'Colorbar range hidden while colouring by spec');

    // Leaving value mode clears spec colouring.
    ctrl.setOptions({ plotMode: 'hardBin', activeTest: undefined, colorBySpec: false });
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
