import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.HTMLDivElement = dom.window.HTMLDivElement;
globalThis.Node = dom.window.Node;
globalThis.Event = dom.window.Event;
globalThis.CustomEvent = dom.window.CustomEvent;
window.open = () => null; // force the floating-window fallback path, same as the popup-blocked tests

const { openWaferMapGuide } = await import('../dist/packages/canvas-adapter/index.js');

// ── openWaferMapGuide opens the same guide window a live controller's own
// openUserGuide() opens, but with NO renderWaferMap/renderWaferGallery call
// having happened first — the whole point of this export (WMAP_ISSUES.md #37,
// the empty-state guide-access gap). ─────────────────────────────────────────

// openWaferMapGuide is fire-and-forget (mirrors the controller closures it
// wraps) — its dynamic imports resolve on a later tick even when the modules
// are already cached, so tests must yield before inspecting the DOM.
const flush = () => new Promise(resolve => setTimeout(resolve, 0));

test('openWaferMapGuide opens the guide floating window with no prior render', async () => {
  document.body.innerHTML = '';
  openWaferMapGuide();
  await flush();
  const box = document.querySelector('.wmap-window-box');
  assert.ok(box, 'expected the guide floating window to open with no live controller');
  assert.ok(box.querySelector('.wmap-guide-content'), 'expected guide content to be mounted');
  assert.ok(box.querySelector('.wmap-guide'), "expected wmap's own guide content inside it");
});

test('openWaferMapGuide prepends a host extension\'s html before wmap\'s own guide content', async () => {
  document.body.innerHTML = '';
  openWaferMapGuide({ title: 'Host App — Help', html: '<h1 id="host-marker">Host App</h1>' });
  await flush();
  const box = document.querySelector('.wmap-window-box');
  assert.ok(box, 'expected the guide floating window to open');
  const content = box.querySelector('.wmap-guide-content');
  assert.ok(content, 'expected guide content to be mounted');
  assert.ok(content.querySelector('#host-marker'), "expected the host extension's html to be present");
  const marker = content.querySelector('#host-marker');
  const guideEl = content.querySelector('.wmap-guide');
  assert.ok(guideEl, "expected wmap's own guide content inside it");
  assert.ok(
    marker.compareDocumentPosition(guideEl) & Node.DOCUMENT_POSITION_FOLLOWING,
    'expected the host extension to come BEFORE wmap\'s own guide content',
  );
});
