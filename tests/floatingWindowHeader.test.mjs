// A floating window's collapse button must not look or act like an OS
// minimize. In a desktop host (Tauri) the detached-card fallback window,
// maximized, puts its header directly under the OS title bar; an OS-style `_`
// there read as a second minimize button that did something else. So the
// button is drawn as chevrons, labelled Collapse / Show contents, and hidden
// while the window is maximized.
import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

import { openFloatingWindow, openModal } from '../dist/packages/canvas-adapter/toolbar.js';
import { ICONS } from '../dist/packages/canvas-adapter/icons.js';

function setup() {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true, url: 'http://localhost/' });
  const { window } = dom;
  window.matchMedia ??= () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
  return { window, doc: window.document, cleanup: () => window.close() };
}

const click = (window, el) => el.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
const visible = btn => btn.style.display !== 'none';
// Compare icons by path data: the DOM re-serialises `<path/>` as `<path></path>`.
const paths = html => [...html.matchAll(/ d="([^"]+)"/g)].map(m => m[1]).join('|');

test('floating window: Collapse button, relabelled when collapsed, hidden while maximized', () => {
  const { window, doc, cleanup } = setup();
  try {
    const handle = openFloatingWindow({ title: 'W05', onClose() {}, ownerDocument: doc });
    const btn = label => handle.box.querySelector(`button[aria-label="${label}"]`);

    const collapse = btn('Collapse');
    assert.ok(collapse, 'header has a Collapse button');
    assert.equal(btn('Minimize'), null, 'no button is labelled Minimize');
    assert.equal(paths(collapse.innerHTML), paths(ICONS.collapse), 'drawn with the collapse chevrons, not an OS-style underscore');

    click(window, collapse);
    assert.equal(collapse.getAttribute('aria-label'), 'Show contents');
    assert.equal(paths(collapse.innerHTML), paths(ICONS.uncollapse));
    click(window, collapse);
    assert.equal(collapse.getAttribute('aria-label'), 'Collapse');

    click(window, btn('Maximize (F)'));
    assert.equal(visible(collapse), false, 'Collapse is hidden while maximized');
    assert.ok(btn('Restore (F)') && btn('Close (Esc)'), 'a maximized window keeps restore and close');

    click(window, btn('Restore (F)'));
    assert.equal(visible(collapse), true, 'Collapse returns when the window is restored');
    handle.close();
  } finally {
    cleanup();
  }
});

test('modal: no collapse button in either size', () => {
  const { window, doc, cleanup } = setup();
  try {
    const handle = openModal({ title: 'Report', onClose() {}, ownerDocument: doc });
    assert.equal(handle.box.querySelector('button[aria-label="Collapse"]'), null);
    click(window, handle.box.querySelector('button[aria-label="Maximize (F)"]'));
    assert.equal(handle.box.querySelector('button[aria-label="Collapse"]'), null);
    handle.close();
  } finally {
    cleanup();
  }
});
