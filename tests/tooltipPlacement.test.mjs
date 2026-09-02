// positionTooltip / wireTooltip.
//
// `positionTooltip` received the anchor element from the start but used it only
// to pick an overlay root — placement came from the cursor point alone, and since
// `y` starts above the cursor the box then extended down over whatever was being
// pointed at. On the map canvas that overlap is unavoidable (the anchor IS the
// canvas); on a small anchor it is a defect, and these tests pin that distinction.

import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>');
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.HTMLDivElement = dom.window.HTMLDivElement;
globalThis.Node = dom.window.Node;
globalThis.Event = dom.window.Event;
globalThis.MouseEvent = dom.window.MouseEvent;

const { positionTooltip, wireTooltip, getTooltip } =
  await import('../dist/packages/canvas-adapter/toolbar.js');

const VIEW_W = 1000, VIEW_H = 800;
Object.defineProperty(dom.window, 'innerWidth',  { value: VIEW_W, configurable: true });
Object.defineProperty(dom.window, 'innerHeight', { value: VIEW_H, configurable: true });

/** JSDOM lays nothing out, so size the tooltip and anchor explicitly. */
function makeTooltip(w = 200, h = 60) {
  const t = document.createElement('div');
  document.body.appendChild(t);
  Object.defineProperty(t, 'offsetWidth',  { value: w, configurable: true });
  Object.defineProperty(t, 'offsetHeight', { value: h, configurable: true });
  return t;
}
function makeAnchor(rect) {
  const el = document.createElement('div');
  document.body.appendChild(el);
  el.getBoundingClientRect = () => ({
    left: rect.left, top: rect.top, right: rect.left + rect.width, bottom: rect.top + rect.height,
    width: rect.width, height: rect.height, x: rect.left, y: rect.top,
  });
  return el;
}
const px = (v) => parseFloat(v);

test('a small anchor is not covered — the tooltip flips below it', () => {
  const tooltip = makeTooltip(200, 60);
  // A 20px-tall row, cursor inside it. The old placement put the tooltip's top at
  // clientY - 8, i.e. straddling the row.
  const anchor = makeAnchor({ left: 100, top: 300, width: 240, height: 20 });
  positionTooltip(tooltip, anchor, 150, 310);

  const top = px(tooltip.style.top);
  assert.ok(top >= 320, `tooltip must start below the anchor's bottom (320), got ${top}`);
});

test('flips above when there is no room below', () => {
  const tooltip = makeTooltip(200, 60);
  // Row near the bottom of the viewport: below would overflow.
  const anchor = makeAnchor({ left: 100, top: VIEW_H - 30, width: 240, height: 20 });
  positionTooltip(tooltip, anchor, 150, VIEW_H - 20);

  const top = px(tooltip.style.top);
  assert.ok(top + 60 <= VIEW_H - 30, `tooltip must sit above the anchor, got top ${top}`);
});

test('a large anchor keeps the previous cursor-following behaviour', () => {
  const tooltip = makeTooltip(200, 60);
  // The map canvas: taller than 40% of the viewport, so "beside it" does not
  // exist and displacing the tooltip that far would be worse than overlapping.
  const anchor = makeAnchor({ left: 0, top: 0, width: 900, height: 700 });
  positionTooltip(tooltip, anchor, 400, 400);

  assert.equal(px(tooltip.style.top), 392, 'still clientY - 8');
  assert.equal(px(tooltip.style.left), 414, 'still clientX + 14');
});

test('still flips horizontally at the right edge, and never leaves the viewport', () => {
  const tooltip = makeTooltip(200, 60);
  const anchor = makeAnchor({ left: 0, top: 0, width: 900, height: 700 });
  positionTooltip(tooltip, anchor, VIEW_W - 20, 400);
  const left = px(tooltip.style.left);
  assert.ok(left + 200 <= VIEW_W, `must not overflow the right edge, got ${left}`);

  positionTooltip(tooltip, anchor, 400, 5);
  assert.ok(px(tooltip.style.top) >= 8, 'clamped to the top margin');
});

// ── wireTooltip ──────────────────────────────────────────────────────────────

test('wireTooltip shows the themed tooltip on hover and hides it on leave', () => {
  const el = document.createElement('button');
  el.getBoundingClientRect = () => ({ left: 10, top: 10, right: 60, bottom: 30, width: 50, height: 20, x: 10, y: 10 });
  document.body.appendChild(el);
  wireTooltip(el, 'Open full view');

  el.dispatchEvent(new dom.window.MouseEvent('mousemove', { clientX: 20, clientY: 20 }));
  const tip = getTooltip(document);
  assert.equal(tip.textContent, 'Open full view');
  assert.equal(tip.style.display, 'block');

  el.dispatchEvent(new dom.window.Event('mouseleave'));
  assert.equal(tip.style.display, 'none');
});

test('omitting the text live-reads aria-label, so a relabelled control stays correct', () => {
  const el = document.createElement('button');
  el.getBoundingClientRect = () => ({ left: 0, top: 0, right: 20, bottom: 20, width: 20, height: 20, x: 0, y: 0 });
  document.body.appendChild(el);
  el.setAttribute('aria-label', 'Open full view');
  wireTooltip(el);

  el.dispatchEvent(new dom.window.MouseEvent('mousemove', { clientX: 5, clientY: 5 }));
  assert.equal(getTooltip(document).textContent, 'Open full view');

  // The gallery's expand button relabels itself in place once detached.
  el.setAttribute('aria-label', 'Reattach to gallery');
  el.dispatchEvent(new dom.window.MouseEvent('mousemove', { clientX: 5, clientY: 5 }));
  assert.equal(getTooltip(document).textContent, 'Reattach to gallery');
});

test('a getter is re-read per hover, for hints that flip with control state', () => {
  const el = document.createElement('button');
  el.getBoundingClientRect = () => ({ left: 0, top: 0, right: 20, bottom: 20, width: 20, height: 20, x: 0, y: 0 });
  document.body.appendChild(el);
  let on = true;
  wireTooltip(el, () => (on ? 'Click to hide these findings' : 'Click to show these findings'));

  el.dispatchEvent(new dom.window.MouseEvent('mousemove', { clientX: 5, clientY: 5 }));
  assert.match(getTooltip(document).textContent, /hide/);
  on = false;
  el.dispatchEvent(new dom.window.MouseEvent('mousemove', { clientX: 5, clientY: 5 }));
  assert.match(getTooltip(document).textContent, /show/);
});

test('asDataPoint makes a non-control focusable and named; a control is left alone', () => {
  const bar = document.createElement('div');
  bar.getBoundingClientRect = () => ({ left: 0, top: 0, right: 10, bottom: 40, width: 10, height: 40, x: 0, y: 0 });
  document.body.appendChild(bar);
  wireTooltip(bar, '1.0 – 2.0: 37', { asDataPoint: true });
  assert.equal(bar.tabIndex, 0);
  assert.equal(bar.getAttribute('role'), 'img');
  assert.equal(bar.getAttribute('aria-label'), '1.0 – 2.0: 37');

  // A button must NOT get a second focus stop or have its own name overwritten.
  const btn = document.createElement('button');
  btn.getBoundingClientRect = () => ({ left: 0, top: 0, right: 20, bottom: 20, width: 20, height: 20, x: 0, y: 0 });
  document.body.appendChild(btn);
  btn.setAttribute('aria-label', 'Reattach to gallery');
  wireTooltip(btn, 'some hover hint');
  assert.equal(btn.getAttribute('role'), null);
  assert.equal(btn.getAttribute('aria-label'), 'Reattach to gallery');
});

test('keyboard focus shows the tooltip anchored to the element, with no cursor', () => {
  const el = document.createElement('button');
  el.getBoundingClientRect = () => ({ left: 100, top: 300, right: 340, bottom: 320, width: 240, height: 20, x: 100, y: 300 });
  document.body.appendChild(el);
  wireTooltip(el, 'Show supporting findings');

  el.dispatchEvent(new dom.window.Event('focus'));
  const tip = getTooltip(document);
  assert.equal(tip.style.display, 'block');
  assert.equal(tip.textContent, 'Show supporting findings');

  el.dispatchEvent(new dom.window.Event('blur'));
  assert.equal(tip.style.display, 'none');
});

// ── No native `title` anywhere it competes with the themed tooltip ───────────
//
// A regression guard, not a unit test: `title` kept coming back (maplessSummary
// converted away from it, then summaryPanel, the two expand buttons and the
// window chrome were all written with it anyway). The one legitimate use is a
// fallback for CSS-truncated text, where the browser's show-the-full-string
// behaviour is the point — that site is allowlisted by name.

test('no canvas-adapter source sets a native title tooltip', async () => {
  const { readFileSync, readdirSync } = await import('node:fs');
  const { join } = await import('node:path');

  const roots = ['packages/canvas-adapter', 'packages/canvas-adapter/charts'];
  // Allowlisted receivers: `document`/`doc` set a WINDOW title, not a tooltip;
  // `iframe` is an iframe's accessible name (required by ARIA); `titleEl` is the
  // truncation fallback on an overlay header's own title text, where the browser
  // showing the full ellipsised string on hover is exactly the wanted behaviour.
  const allowed = new Set(['document', 'doc', 'iframe', 'titleEl']);
  const offenders = [];
  for (const root of roots) {
    for (const file of readdirSync(root).filter(f => f.endsWith('.ts'))) {
      const path = join(root, file);
      readFileSync(path, 'utf8').split('\n').forEach((line, i) => {
        const m = /(\w+)\.title\s*=/.exec(line);
        if (m && !allowed.has(m[1])) offenders.push(`${path}:${i + 1}  ${line.trim()}`);
      });
    }
  }
  assert.deepEqual(offenders, [],
    `use wireTooltip (the shared themed tooltip) instead of a native title:\n${offenders.join('\n')}`);
});

// ── Canvas colours must be resolved, never CSS custom properties ────────────
//
// `CLR.*` values are `var(--wmap-…, fallback)` strings, which are correct for
// element.style and meaningless to a canvas: assigning one to fillStyle or
// strokeStyle is silently ignored, so the shape is drawn in whatever colour was
// set last. That produced an entirely invisible bar chart (the fill inherited the
// track colour) and invisible spec-limit lines, neither of which throws or warns.
// Canvas colours come from palette.ts (plain hex) or resolveChartCanvasColors.

test('no chart assigns a CLR.* CSS variable to a canvas fill or stroke', async () => {
  const { readFileSync, readdirSync } = await import('node:fs');
  const { join } = await import('node:path');

  const roots = ['packages/canvas-adapter', 'packages/canvas-adapter/charts'];
  const offenders = [];
  for (const root of roots) {
    for (const file of readdirSync(root).filter(f => f.endsWith('.ts'))) {
      const path = join(root, file);
      readFileSync(path, 'utf8').split('\n').forEach((line, i) => {
        if (/(fillStyle|strokeStyle)\s*=\s*CLR\./.test(line)) {
          offenders.push(`${path}:${i + 1}  ${line.trim()}`);
        }
      });
    }
  }
  assert.deepEqual(offenders, [],
    `canvas cannot resolve a CSS custom property — use palette.ts or resolveChartCanvasColors:\n${offenders.join('\n')}`);
});
