// The JSDOM harness for tests that mount the real renderers: a canvas that records nothing, the
// matchMedia/ResizeObserver shims the library reads from the container's own window, and popups that
// are real second windows. Shared, so a test that clicks through a map does not grow its own copy.

import { JSDOM } from 'jsdom';

export function makeCanvasContext() {
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

export function setupDom() {
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
export function installTestShims(win) {
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

export function pointerEvent(window, type, init = {}) {
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

export function click(window, target) {
  target.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
}
