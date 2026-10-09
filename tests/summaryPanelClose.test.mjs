// The Summary panel behaves as a side panel does: a labelled Summary button above it toggles it and
// shows as pressed while it is open, and a close button in its own header closes it. A closed panel
// leaves nothing behind. A panel with no way back in (no toolbar) has no close button.

import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeWaferMap, analyzeWaferLot } from '../dist/index.js';
import { buildLot } from './fixtures/synthLots.mjs';
import { setupDom, click } from './fixtures/domHarness.mjs';

const quiet = console.warn;
console.warn = () => {};
const maps = buildLot({ name: 'edge-ring', wafers: 3, signatures: [{ region: 'edge-ring', p: 0.5, bin: 5 }] });
console.warn = quiet;
const per = maps.map(m => analyzeWaferMap(m));
const lot = analyzeWaferLot(maps, { perWaferSummaries: per });

async function until(ready, what) {
  for (let i = 0; i < 400; i++) {
    const v = ready();
    if (v) return v;
    await new Promise(r => setTimeout(r, 5));
  }
  assert.fail(`timed out waiting for ${what}`);
}

/** The panel that holds the close button, and the Summary button in the row above. */
function parts(container) {
  const close = container.querySelector('[data-wmap-summary-close]');
  const panel = close?.closest('[data-wmap-placement]');
  const toggle = container.querySelector('[data-wmap-summary-toggle]');
  return { close, panel, toggle };
}

async function closesLikeASidePanel(mount) {
  const { window, root, cleanup } = setupDom();
  try {
    const container = window.document.createElement('div');
    root.appendChild(container);
    const ctrl = mount(container);
    const { close, panel, toggle } = await until(() => { const p = parts(container); return p.close ? p : null; }, 'the close button');
    const open = () => panel.style.display !== 'none';
    assert.equal(close.textContent, '▸', 'a right-hand panel folds to the right');
    assert.equal(close.getAttribute('aria-label'), 'Close the Summary panel');
    assert.ok(open());
    assert.equal(toggle.textContent, 'Summary', 'the button is labelled');
    assert.equal(toggle.getAttribute('aria-pressed'), 'true', 'pressed while the panel is open');
    const sw = container.querySelector('[data-wmap-view-switch]');
    if (sw) assert.equal(toggle.nextElementSibling, sw, 'just before Maps | Insights');

    click(window, close);
    assert.ok(!open(), 'the close button closes it');
    assert.equal(toggle.getAttribute('aria-pressed'), 'false');
    assert.notEqual(toggle.style.display, 'none', 'the Summary button offers it back');
    assert.equal(container.querySelector('[data-wmap-summary-rail]'), null, 'no edge tab: a closed panel leaves no column');

    click(window, toggle);
    assert.ok(open(), 'the Summary button opens it');
    assert.equal(toggle.getAttribute('aria-pressed'), 'true');
    await until(() => panel.querySelector('[data-wmap-summary-close]'), 'the close button after reopening');

    click(window, toggle);
    assert.ok(!open(), 'and closes it');
    ctrl.destroy();
  } finally {
    cleanup();
  }
}

test('a single map\'s Summary panel closes from its header and toggles from its labelled Summary button', async () => {
  const { renderWaferMap } = await import('../dist/packages/canvas-adapter/index.js');
  await closesLikeASidePanel(c => renderWaferMap(c, maps[0], { statsSummary: per[0], summaryPanel: { defaultOpen: true } }));
});

test('a gallery\'s Summary panel closes from its header and toggles from its labelled Summary button', async () => {
  const { renderWaferGallery } = await import('../dist/packages/canvas-adapter/index.js');
  await closesLikeASidePanel(c => renderWaferGallery(c, maps.map((m, i) => ({ ...m, statsSummary: per[i] })), { lotStatsSummary: lot, summaryPanel: { defaultOpen: true } }));
});

test('a map without a toolbar has no way back in, so its panel has no close button', async () => {
  const { renderWaferMap } = await import('../dist/packages/canvas-adapter/index.js');
  const { window, root, cleanup } = setupDom();
  try {
    const container = window.document.createElement('div');
    root.appendChild(container);
    const ctrl = renderWaferMap(container, maps[0], { statsSummary: per[0], showToolbar: false });
    await until(() => container.querySelector('[data-wmap-placement]')?.textContent.includes('Wafer Summary'), 'the panel');
    assert.equal(container.querySelector('[data-wmap-summary-close]'), null);
    ctrl.destroy();
  } finally {
    cleanup();
  }
});

test('a click just after closing lands on nothing, not on the control that moved under it', async () => {
  const { renderWaferMap } = await import('../dist/packages/canvas-adapter/index.js');
  const { window, root, cleanup } = setupDom();
  try {
    const container = window.document.createElement('div');
    root.appendChild(container);
    const ctrl = renderWaferMap(container, maps[0], { statsSummary: per[0], summaryPanel: { defaultOpen: true } });
    const close = await until(() => container.querySelector('[data-wmap-summary-close]'), 'the close button');
    // JSDOM lays nothing out: give the button the place it would have.
    close.getBoundingClientRect = () => ({ left: 500, top: 40, width: 22, height: 22, right: 522, bottom: 62, x: 500, y: 40, toJSON() {} });

    let reachedPage = 0;
    window.document.addEventListener('click', () => { reachedPage++; });
    click(window, close);
    const shield = window.document.querySelector('[data-wmap-click-shield]');
    assert.ok(shield, 'a shield covers where the close button was');
    assert.equal(shield.style.position, 'fixed');
    reachedPage = 0;
    click(window, shield);
    assert.equal(reachedPage, 0, 'the second click goes no further');

    await new Promise(r => setTimeout(r, 600));
    assert.equal(window.document.querySelector('[data-wmap-click-shield]'), null, 'and it is gone after a moment');
    ctrl.destroy();
  } finally {
    cleanup();
  }
});
