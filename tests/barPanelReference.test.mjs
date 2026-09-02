// The yield chart's reference line.
//
// Its first version was drawn as a single 55%-alpha rule with a muted label
// placed INSIDE the plot, which put grey text on top of the first bar — the
// label was effectively unreadable and the rule barely showed against either the
// pale track or a saturated bar. These tests pin the three things that fixed it:
// a reserved band so the label never lands on a bar, a two-pass stroke so the
// rule reads against any background, and the value mirrored into the DOM hint so
// it survives the plot scrolling.

import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body><div id="host"></div></body></html>', { pretendToBeVisual: true });
for (const k of ['window', 'document', 'HTMLElement', 'HTMLCanvasElement', 'HTMLDivElement', 'HTMLButtonElement', 'Node', 'Event', 'MouseEvent', 'CustomEvent', 'Blob', 'DOMRect']) {
  globalThis[k] = k === 'window' ? dom.window : dom.window[k];
}
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
globalThis.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
dom.window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
globalThis.ResizeObserver = dom.window.ResizeObserver;

/** Records the canvas calls we assert on; everything else is a no-op. */
function recordingContext(calls) {
  const noop = () => {};
  const recorded = new Set(['setLineDash', 'stroke', 'rect', 'fill', 'fillText', 'moveTo', 'lineTo', 'beginPath']);
  return new Proxy({}, {
    get: (_t, p) => {
      if (p === 'measureText') return () => ({ width: 60 });
      if (p === 'canvas') return { width: 600, height: 400 };
      if (typeof p === 'string' && recorded.has(p)) return (...a) => calls.push([p, ...a]);
      return noop;
    },
    set: (_t, p, v) => { calls.push([`set:${String(p)}`, v]); return true; },
  });
}

const { renderBarPanel } = await import('../dist/packages/canvas-adapter/charts/barPanel.js');

const DATA = [
  { label: 'W01', value: 95.5, percent: 95.5, itemCount: 1, key: 0 },
  { label: 'W02', value: 71.9, percent: 71.9, itemCount: 1, key: 1 },
  { label: 'W03', value: 73.8, percent: 73.8, itemCount: 1, key: 2 },
];

function mount({ reference } = {}) {
  const calls = [];
  dom.window.HTMLCanvasElement.prototype.getContext = () => recordingContext(calls);
  const host = dom.window.document.getElementById('host');
  host.innerHTML = '';
  const handle = renderBarPanel({
    title: 'Yield by wafer',
    data: DATA,
    valueLabel: d => `${d.percent.toFixed(1)}%`,
    reference,
    ownerDocument: dom.window.document,
  });
  host.appendChild(handle.card);
  return { handle, calls, host };
}

const medianRef = () => ({ value: 73.8, label: 'median 73.8%' });

test('the rule is stroked twice — a solid halo, then the dashed line over it', () => {
  const { calls } = mount({ reference: medianRef });
  const dashes = calls.filter(c => c[0] === 'setLineDash').map(c => JSON.stringify(c[1]));
  // Solid first (fills the dashes' own gaps and separates the rule from whatever
  // is behind it), dashed second. One flat colour cannot read against both the
  // pale track and a saturated bar in both themes.
  assert.ok(dashes.includes('[]'), `expected a solid halo pass: ${dashes}`);
  assert.ok(dashes.includes('[4,3]'), `expected a dashed pass: ${dashes}`);
  assert.ok(dashes.indexOf('[]') < dashes.indexOf('[4,3]'), 'halo must be drawn under the dashed line');
});

test('the label is drawn on a filled chip, not as bare text over a bar', () => {
  const { calls } = mount({ reference: medianRef });
  assert.ok(calls.some(c => c[0] === 'rect'), 'expected a chip background behind the label');
  assert.ok(calls.some(c => c[0] === 'fillText' && /median 73\.8%/.test(String(c[1]))));
});

test('a reserved band above the rows keeps the label clear of the first bar', () => {
  const withRef = mount({ reference: medianRef });
  const withRefH = parseFloat(withRef.handle.card.querySelector('canvas').style.height);
  const without = mount({});
  const withoutH = parseFloat(without.handle.card.querySelector('canvas').style.height);
  // The band is real vertical space, not an overlay — that is what stops the
  // label being painted on top of row 0.
  assert.ok(withRefH > withoutH, `${withRefH} should exceed ${withoutH}`);
});

test('no reference means no band and no rule — an ordinary panel is unchanged', () => {
  const { calls, handle } = mount({});
  assert.ok(!calls.some(c => c[0] === 'setLineDash'), 'nothing dashed is drawn');
  assert.ok(!/Dashed line/.test(handle.card.textContent));
});

test('the reference value is mirrored into the DOM hint, so scrolling cannot hide it', () => {
  const { handle } = mount({ reference: medianRef });
  // The plot scrolls past MAX_VISIBLE_ROWS and the chip lives at the top of the
  // canvas — on a lot large enough to scroll, which is exactly when a reference
  // matters most, the on-canvas label would scroll out of view.
  assert.match(handle.card.textContent, /Dashed line: median 73\.8%\./);
});

test('the reference is recomputed from the data it is drawn against', () => {
  const seen = [];
  mount({ reference: rows => { seen.push(rows.length); return medianRef(); } });
  assert.ok(seen.length > 0, 'reference is a function of the current rows, not a fixed value');
  assert.equal(seen[0], DATA.length);
});
