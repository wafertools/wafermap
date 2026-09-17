// The plot-mode menu's "Test Value ▶" cascade (more tests than
// INLINE_TEST_LIMIT) must open by tap and by keyboard, not only by hover.
//
// It opened on mouseenter alone, with a no-op click. On a touchscreen a tap
// sends an emulated mouseenter and then a click: the mouseenter opened the
// submenu and registered a `{ once: true }` outside-click close, which that
// same tap's click then consumed, so the submenu vanished and no test could be
// chosen. From the keyboard, Enter on the row did nothing at all. And because
// the submenu is a sibling of the menu, not a child, the toolbar's
// outside-click close treated a tap on its filter box as outside the menu.
import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

import { buildModeMenuEl, createToolbarHelpers, wireMenuA11y, INLINE_TEST_LIMIT } from '../dist/packages/canvas-adapter/toolbar.js';

function setup() {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true, url: 'http://localhost/' });
  const { window } = dom;
  const saved = { document: globalThis.document, window: globalThis.window };
  globalThis.document = window.document;
  globalThis.window = window;
  const tooltip = window.document.createElement('div');
  window.document.body.appendChild(tooltip);
  const helpers = createToolbarHelpers(tooltip);

  const tests = Array.from({ length: INLINE_TEST_LIMIT + 10 }, (_, i) => ({
    plotMode: 'value', activeTest: 1000 + i, label: `T${1000 + i} vdd_${i}`,
  }));
  const picked = [];
  const menu = buildModeMenuEl(
    new window.DOMRect(10, 10, 40, 20), tests, [{ plotMode: 'hardBin', label: 'Hard Bin' }], [],
    () => false, entry => { picked.push(entry); menu.remove(); helpers.setOpenMenu(null); },
    helpers, 'hardBin', window,
  );
  window.document.body.appendChild(menu);
  helpers.setOpenMenu(menu);
  window.document.addEventListener('click', helpers.closeOpenMenu, true);
  // As renderWaferMap/renderWaferGallery do: roles and arrow/Enter/Escape keys.
  const trigger = window.document.createElement('button');
  window.document.body.appendChild(trigger);
  wireMenuA11y(menu, trigger, () => { menu.remove(); helpers.setOpenMenu(null); });

  const cascade = [...menu.querySelectorAll('[role="menuitemradio"]')].find(r => r.textContent.includes('▶'));
  const submenu = () => window.document.querySelector('[data-wmap-submenu]');
  const cleanup = () => { Object.assign(globalThis, saved); window.close(); };
  return { window, menu, cascade, submenu, picked, helpers, cleanup };
}

/** What a touchscreen tap delivers: emulated mouseenter, then click (detail 1). */
function tap(window, el) {
  el.dispatchEvent(new window.MouseEvent('mouseenter'));
  el.dispatchEvent(new window.MouseEvent('click', { bubbles: true, detail: 1 }));
}

test('tapping "Test Value ▶" opens the submenu and keeps it open; tapping a test picks it', () => {
  const { window, menu, cascade, submenu, picked, helpers, cleanup } = setup();
  try {
    assert.ok(cascade, 'the cascade row exists when there are more tests than INLINE_TEST_LIMIT');
    tap(window, cascade);
    assert.ok(submenu(), 'submenu is still open after the tap that opened it');
    assert.equal(cascade.getAttribute('aria-expanded'), 'true');

    // Tapping the filter box must not close the menu underneath.
    const input = submenu().querySelector('input');
    assert.ok(input, 'submenu has a filter box');
    input.dispatchEvent(new window.MouseEvent('click', { bubbles: true, detail: 1 }));
    assert.equal(helpers.getOpenMenu(), menu, 'menu stays open after tapping the submenu filter box');
    assert.ok(submenu(), 'submenu stays open after tapping its filter box');

    const row = [...submenu().querySelectorAll('[role="menuitemradio"]')][3];
    tap(window, row);
    assert.equal(picked.length, 1, 'a test was picked');
    assert.equal(picked[0].activeTest, 1003);
    assert.equal(submenu(), null, 'submenu closes after picking');
  } finally {
    cleanup();
  }
});

test('a tap outside closes the submenu', () => {
  const { window, cascade, submenu, cleanup } = setup();
  try {
    tap(window, cascade);
    assert.ok(submenu());
    window.document.body.dispatchEvent(new window.MouseEvent('click', { bubbles: true, detail: 1 }));
    assert.equal(submenu(), null);
  } finally {
    cleanup();
  }
});

test('Enter on "Test Value ▶" opens the submenu; Escape closes it and returns focus', async () => {
  const { window, menu, cascade, submenu, cleanup } = setup();
  try {
    cascade.focus();
    menu.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    assert.ok(submenu(), 'Enter opens the submenu');
    await new Promise(r => window.requestAnimationFrame(() => r()));
    await new Promise(r => setTimeout(r, 20));
    assert.ok(submenu().contains(window.document.activeElement), 'focus moves into the submenu');

    submenu().dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    assert.equal(submenu(), null, 'Escape closes the submenu');
    assert.equal(window.document.activeElement, cascade, 'focus returns to the cascade row');
  } finally {
    cleanup();
  }
});
