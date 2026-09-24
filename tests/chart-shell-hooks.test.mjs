import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

import { cardShell, makeChartGridWrap, makeLabeledSelect } from '../dist/packages/canvas-adapter/charts/chartShell.js';

// Unit coverage for the data-wmap-* hooks — these three factories are what
// insightsTab.ts's chart cards, section grids, and Group-by/per-panel
// Group selects are all built from, so testing them here covers every
// caller at once. Full-pipeline coverage (the hooks actually reaching a
// rendered Insights tab) lives in dom-adapter.test.mjs's
// "insights option renders a full-takeover tab..." test.
//
// Only `document` is needed — none of these three factories touch canvas,
// ResizeObserver, or matchMedia, so this doesn't need dom-adapter.test.mjs's
// full setupDom().
function withDocument(fn) {
  const dom = new JSDOM('<!doctype html><html><body></body></html>');
  const previous = globalThis.document;
  globalThis.document = dom.window.document;
  try {
    fn();
  } finally {
    globalThis.document = previous;
  }
}

test('cardShell: card carries data-wmap-chart-card and data-wmap-chart-title', () => {
  withDocument(() => {
    const { card } = cardShell('Yield by wafer');
    assert.equal(card.dataset.wmapChartCard, '1');
    assert.equal(card.dataset.wmapChartTitle, 'Yield by wafer');
  });
});

test('cardShell: title is carried verbatim, including titles that collide with other cards\' prefixes', () => {
  withDocument(() => {
    // Regression guard for the prefix-matching failure mode: the
    // old approach matched a card by heading textContent PREFIX
    // (startsWith), so "Yield by wafer" and a hypothetical "Yield by wafer
    // (grouped)" card were ambiguous to find. A data attribute holding the
    // full title removes the need for prefix matching entirely.
    const a = cardShell('Yield by wafer');
    const b = cardShell('Yield by wafer (grouped)');
    assert.equal(a.card.dataset.wmapChartTitle, 'Yield by wafer');
    assert.equal(b.card.dataset.wmapChartTitle, 'Yield by wafer (grouped)');
    assert.notEqual(a.card.dataset.wmapChartTitle, b.card.dataset.wmapChartTitle);
  });
});

test('makeChartGridWrap: wrapper carries data-wmap-chart-grid', () => {
  withDocument(() => {
    const wrap = makeChartGridWrap();
    assert.equal(wrap.dataset.wmapChartGrid, '1');
  });
});

// The picker is a themed trigger button + popup listbox (makeListSelect), not
// a native <select> — see CHANGELOG 0.27.0. The hook therefore lives on the
// trigger, which is both the element a host clicks to open the list and the
// only part of the control present in the DOM while it's closed.
test('makeLabeledSelect: opts.hook sets data-wmap-select on the trigger button', () => {
  withDocument(() => {
    const label = makeLabeledSelect(
      'Group by:',
      [{ value: '', label: 'None' }, { value: 'split', label: 'Split (4)' }],
      '',
      () => {},
      { hook: 'group-by' },
    );
    const trigger = label.querySelector('button');
    assert.ok(trigger, 'makeLabeledSelect returns a <label> wrapping a trigger button');
    assert.equal(trigger.dataset.wmapSelect, 'group-by');
    // No native <select> anywhere: a host automating this must click the
    // trigger, not assign `.value` and dispatch `change`.
    assert.equal(label.querySelector('select'), null);
  });
});

test('makeLabeledSelect: without opts.hook, the trigger carries no data-wmap-select (no accidental default)', () => {
  withDocument(() => {
    // This same factory also builds per-panel "Group: <value> ▾" restrict
    // dropdowns and the histogram wafer picker — those call sites don't
    // pass a hook, and shouldn't silently start carrying one just because
    // the Group-by call site does.
    const label = makeLabeledSelect('Group:', [{ value: 'a', label: 'A' }], 'a', () => {});
    const trigger = label.querySelector('button');
    assert.equal(trigger.dataset.wmapSelect, undefined);
  });
});
