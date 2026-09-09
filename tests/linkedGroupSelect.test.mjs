import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

import { makeLinkedGroupSelect, ALL_GROUPS } from '../dist/packages/canvas-adapter/charts/chartShell.js';

// The Distributions section's shared group scope. Before this existed the three
// group-aware panels each held a private group state with a different default —
// capability restricted to groups[0], the boxplot pooled every group, the
// histogram overlaid them — so a grouped load showed three different
// populations side by side and the cross-panel test link broadcast the test
// without the group. These tests pin the two properties that make one shared
// scope safe: `set` adopts without firing, and `null` means all groups.
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

test('defaults to all groups, not the first one', () => {
  withDocument(() => {
    const sel = makeLinkedGroupSelect(['A', 'B'], 'Lot:', null, () => {});
    assert.equal(sel.get(), null);
  });
});

test('offers an All groups entry ahead of every group', () => {
  withDocument(() => {
    const sel = makeLinkedGroupSelect(['A', 'B'], 'Lot:', null, () => {});
    const trigger = sel.el.querySelector('[data-wmap-select="group-scope"]');
    assert.ok(trigger, 'the control carries a stable hook');
    assert.equal(trigger.value, ALL_GROUPS);
  });
});

test('set() adopts a broadcast without firing onUserChange', () => {
  withDocument(() => {
    let fired = 0;
    const sel = makeLinkedGroupSelect(['A', 'B'], 'Lot:', null, () => { fired++; });
    assert.equal(sel.set('B'), true);
    assert.equal(sel.get(), 'B');
    assert.equal(fired, 0, 'a broadcast must not bounce back as a user change');
  });
});

test('set() reports no change when it already matches', () => {
  withDocument(() => {
    const sel = makeLinkedGroupSelect(['A', 'B'], 'Lot:', 'A', () => {});
    assert.equal(sel.set('A'), false);
  });
});

test('set() ignores a group that is not in this panel s list', () => {
  withDocument(() => {
    const sel = makeLinkedGroupSelect(['A', 'B'], 'Lot:', 'A', () => {});
    assert.equal(sel.set('ZZ'), false);
    assert.equal(sel.get(), 'A', 'an unknown key leaves the scope alone');
  });
});

test('set(null) returns to all groups', () => {
  withDocument(() => {
    const sel = makeLinkedGroupSelect(['A', 'B'], 'Lot:', 'B', () => {});
    assert.equal(sel.set(null), true);
    assert.equal(sel.get(), null);
    const trigger = sel.el.querySelector('[data-wmap-select="group-scope"]');
    assert.equal(trigger.value, ALL_GROUPS, 'the visible control follows the broadcast');
  });
});

test('the control keeps the section label it was given', () => {
  withDocument(() => {
    const sel = makeLinkedGroupSelect(['A'], 'Lot:', null, () => {});
    assert.match(sel.el.textContent, /^Lot:/);
  });
});
