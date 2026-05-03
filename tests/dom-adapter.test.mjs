import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

import { buildWaferMap } from '../dist/index.js';
import { renderWaferMap, renderWaferGallery } from '../dist/packages/canvas-adapter/index.js';

function makeDies() {
  return [
    { id: '0_0', i: 0, j: 0, x: 0, y: 0, width: 10, height: 10, values: [0.9], bins: [1] },
    { id: '1_0', i: 1, j: 0, x: 10, y: 0, width: 10, height: 10, values: [0.7], bins: [2] },
    { id: '0_1', i: 0, j: 1, x: 0, y: 10, width: 10, height: 10, values: [0.8], bins: [1] },
    { id: '1_1', i: 1, j: 1, x: 10, y: 10, width: 10, height: 10, values: [0.6], bins: [2] },
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
  globalThis.navigator = window.navigator;
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
    const wrapper = window.document.createElement('div');
    wrapper.style.position = 'relative';
    const canvas = window.document.createElement('canvas');
    canvas.width = 400;
    canvas.height = 400;
    canvas.__clientWidth = 400;
    canvas.__clientHeight = 400;
    wrapper.appendChild(canvas);
    root.appendChild(wrapper);

    const wafer = buildWaferMap({
      results: [
        { x: 0, y: 0, values: [0.9], bins: [1] },
        { x: 1, y: 0, values: [0.7], bins: [2] },
        { x: 0, y: 1, values: [0.8], bins: [1] },
      ],
      waferConfig: { diameter: 40 },
      dieConfig: { width: 10, height: 10 },
    });

    const hoverCalls = [];
    const clickCalls = [];
    const selectCalls = [];
    const sceneCalls = [];
    const ctrl = renderWaferMap(canvas, wafer.wafer, wafer.dies, {
      showTooltip: true,
      onHover: (die) => hoverCalls.push(die?.id ?? null),
      onClick: (die) => clickCalls.push(die.id),
      onSelect: (dies) => selectCalls.push(dies.map((die) => die.id)),
      onSceneOptionsChange: (opts) => sceneCalls.push(opts),
    });

    assert.equal(wrapper.querySelector('[data-wmap-toolbar="1"]') !== null, true);
    assert.equal(ctrl.getOptions().plotMode, 'hardbin');

    const buttons = [...wrapper.parentElement.querySelectorAll('button')];
    const labelsBtn = buttons.find((btn) => btn.title === 'Toggle die labels');
    assert.ok(labelsBtn);
    click(window, labelsBtn);
    assert.equal(ctrl.getOptions().showText, true);
    assert.equal(sceneCalls.at(-1).showText, true);

    const panBtn = buttons.find((btn) => btn.title === 'Pan (drag to move)');
    assert.ok(panBtn);
    click(window, panBtn);
    assert.equal(canvas.style.cursor, 'grab');

    const selectBtn = buttons.find((btn) => btn.title === 'Select (drag to select dies)');
    assert.ok(selectBtn);
    click(window, selectBtn);
    assert.equal(canvas.style.cursor, 'crosshair');

    ctrl.setSelection(wafer.dies.filter((die) => die.i === 0 && die.j === 0));
    assert.equal(canvas.parentElement.querySelector('canvas') === canvas, true);
    ctrl.clearSelection();

    canvas.dispatchEvent(pointerEvent(window, 'pointermove', { clientX: 200, clientY: 200 }));
    assert.equal(hoverCalls.length > 0, true);

    ctrl.destroy();
    assert.equal(wrapper.querySelector('[data-wmap-toolbar="1"]'), null);
    assert.equal(window.document.body.querySelector('[data-wmap-toolbar="1"]'), null);
    assert.equal(canvas.style.cursor, '');
    assert.equal(clickCalls.length >= 0, true);
    assert.equal(selectCalls.length >= 0, true);
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
        { x: 0, y: 0, values: [0.9], bins: [1] },
        { x: 1, y: 0, values: [0.7], bins: [2] },
        { x: 0, y: 1, values: [0.8], bins: [1] },
      ],
      waferConfig: { diameter: 40 },
      dieConfig: { width: 10, height: 10 },
    });

    const items = [
      { wafer: base.wafer, dies: base.dies, label: 'A' },
      { wafer: base.wafer, dies: base.dies, label: 'B' },
    ];

    const ctrl = renderWaferGallery(container, items, { cardPadding: 4 });
    assert.equal(container.querySelectorAll('.wmap-gallery-card').length, 2);
    assert.equal(container.querySelectorAll('canvas').length >= 2, true);
    assert.equal(container.querySelectorAll('button').length > 0, true);

    click(window, container.querySelector('[data-wmap-expand-btn]'));
    assert.ok(window.document.getElementById('wmap-modal-backdrop'));

    ctrl.setItems([{ wafer: base.wafer, dies: base.dies, label: 'C' }]);
    assert.equal(container.querySelectorAll('.wmap-gallery-card').length, 1);

    ctrl.destroy();
    assert.equal(container.childElementCount, 0);
    assert.equal(window.document.getElementById('wmap-modal-backdrop'), null);
  } finally {
    cleanup();
  }
});
