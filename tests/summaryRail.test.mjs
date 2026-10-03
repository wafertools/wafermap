import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createSummaryRail } from '../dist/packages/canvas-adapter/summaryRail.js';
import { createViewSwitch } from '../dist/packages/canvas-adapter/viewSwitch.js';

const doc = () => new JSDOM('<!doctype html><body></body>').window.document;

test('the Summary rail shows only when told, proxies its click, and tints for notable findings', () => {
  const d = doc();
  let opened = 0;
  const rail = createSummaryRail(d, 'right', () => { opened++; });
  assert.equal(rail.el.style.display, 'none', 'hidden until the host says the panel is closed');
  rail.sync(true, false);
  assert.equal(rail.el.style.display, 'block');
  const plain = rail.el.style.color;
  rail.sync(true, true);
  assert.notEqual(rail.el.style.color, plain, 'notable findings tint it');
  rail.el.click();
  assert.equal(opened, 1);
  rail.sync(false, true);
  assert.equal(rail.el.style.display, 'none');
});

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
