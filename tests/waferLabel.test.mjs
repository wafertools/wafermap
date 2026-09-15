// waferDisplayLabel is the one rule for naming a wafer on every surface that
// lists several — gallery card header, findings/yield lists, reports, the die
// list's Wafer column, detached windows. Those used to disagree (blank, `W3`,
// "Wafer map", the wafer ID) for an item with no `label`.

import test from 'node:test';
import assert from 'node:assert/strict';
import { waferDisplayLabel } from '../dist/packages/core/waferLabel.js';

test('waferDisplayLabel — the caller\'s label wins', () => {
  assert.equal(waferDisplayLabel({ label: 'LOT-A · W07', wafer: { metadata: { waferId: 'W07' } } }, 0), 'LOT-A · W07');
});

test('waferDisplayLabel — without a label, the wafer\'s own ID names it', () => {
  assert.equal(waferDisplayLabel({ wafer: { metadata: { waferId: 'S03' } } }, 0), 'S03');
  // A numeric ID is a real ID, including 0.
  assert.equal(waferDisplayLabel({ wafer: { metadata: { waferId: 0 } } }, 4), '0');
});

test('waferDisplayLabel — a blank label counts as no label', () => {
  assert.equal(waferDisplayLabel({ label: '  ', wafer: { metadata: { waferId: 'S03' } } }, 0), 'S03');
});

test('waferDisplayLabel — with no label and no ID, the position says it is not an ID', () => {
  const name = waferDisplayLabel({ wafer: { metadata: {} } }, 2);
  assert.equal(name, 'Wafer 3 (no ID)');
  assert.notEqual(name, 'W3', 'a bare position reads as a wafer ID');
  assert.equal(waferDisplayLabel(null, 0), 'Wafer 1 (no ID)');
});
