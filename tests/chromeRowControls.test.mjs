import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createViewSwitch } from '../dist/packages/canvas-adapter/viewSwitch.js';
import { createSummaryToggle } from '../dist/packages/canvas-adapter/summaryToggle.js';

const doc = () => new JSDOM('<!doctype html><body></body>').window.document;

test('the Maps | Insights switch reflects the host state and only reports user changes', () => {
  const d = doc();
  const seen = [];
  const sw = createViewSwitch(d, 'Maps', 'lot', open => seen.push(open));
  const [maps, insights] = sw.el.querySelectorAll('[role="tab"]');
  assert.equal(maps.getAttribute('aria-selected'), 'true');
  sw.setInsightsOpen(true);
  assert.equal(insights.getAttribute('aria-selected'), 'true');
  assert.deepEqual(seen, [], 'a host-driven change is not reported back');
  maps.click();
  assert.deepEqual(seen, [false]);
  sw.setInsightsOpen(false);
  insights.click();
  assert.deepEqual(seen, [false, true]);
});

test('the Summary button shows when told, reflects the panel, and tints its icon for notable findings while closed', () => {
  const d = doc();
  let clicks = 0;
  const t = createSummaryToggle(d, () => { clicks++; });
  assert.equal(t.el.style.display, 'none', 'hidden until the host has a summary to show');
  t.sync({ visible: true, open: false, notable: true });
  assert.equal(t.el.style.display, 'inline-flex');
  assert.equal(t.el.textContent, 'Summary');
  assert.equal(t.el.getAttribute('aria-pressed'), 'false');
  const icon = t.el.querySelector('span');
  assert.notEqual(icon.style.color, '', 'notable findings tint the icon while the panel is closed');
  t.sync({ visible: true, open: true, notable: true });
  assert.equal(t.el.getAttribute('aria-pressed'), 'true');
  assert.equal(icon.style.color, '', 'no tint once the panel is open');
  t.el.click();
  assert.equal(clicks, 1);
  t.sync({ visible: false, open: true, notable: false });
  assert.equal(t.el.style.display, 'none');
});
