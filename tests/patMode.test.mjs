// The PAT verdict as a plot mode on the map and the gallery: the metadata mode over a derived attribute.

import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { pretendToBeVisual: true, url: 'http://localhost/' });
for (const k of ['window', 'document', 'HTMLElement', 'HTMLCanvasElement', 'HTMLDivElement', 'HTMLButtonElement', 'Node', 'Event', 'MouseEvent', 'KeyboardEvent', 'CustomEvent', 'Blob', 'DOMRect', 'URL']) {
  if (dom.window[k]) globalThis[k] = dom.window[k];
}
globalThis.window = dom.window;
globalThis.document = dom.window.document;
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
globalThis.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
const mm = () => ({ matches: false, media: '', addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false });
dom.window.matchMedia = mm; globalThis.matchMedia = mm;
class FakeResizeObserver { observe() {} unobserve() {} disconnect() {} }
dom.window.ResizeObserver = FakeResizeObserver; globalThis.ResizeObserver = FakeResizeObserver;
const noop = () => {};
const proto = dom.window.HTMLCanvasElement.prototype;
// One recorder per canvas: a drawing context whose `lineWidth` assignments are logged. The located-die
// ring is the only thing drawn with a 6px halo, so a "lw6" is the ring.
const logs = new WeakMap();
const ctxs = new WeakMap();
proto.getContext = function () {
  if (ctxs.has(this)) return ctxs.get(this);
  const log = [];
  logs.set(this, log);
  const store = {};
  const ctx = new Proxy(store, {
    get: (t, p) => {
      if (p in t) return t[p];
      if (p === 'fillText') return (t) => { (globalThis.__drawn ??= []).push(String(t)); };
      if (p === 'measureText') return (s) => ({ width: String(s).length * 6 });
      if (p === 'createLinearGradient' || p === 'createRadialGradient') return () => ({ addColorStop: noop });
      if (p === 'getImageData') return () => ({ data: [] });
      if (p === 'canvas') return { width: 600, height: 600 };
      return noop;
    },
    set: (t, p, v) => { t[p] = v; if (p === 'lineWidth') log.push('lw' + v); return true; },
  });
  ctxs.set(this, ctx);
  return ctx;
};
proto.focus = noop; proto.setPointerCapture = noop; proto.releasePointerCapture = noop;
Object.defineProperty(proto, 'clientWidth', { configurable: true, get() { return 600; } });
Object.defineProperty(proto, 'clientHeight', { configurable: true, get() { return 600; } });
dom.window.HTMLElement.prototype.scrollIntoView = function () { (globalThis.__scrolled ??= []).push(this); };



const { buildWaferMap } = await import('../dist/index.js');
const { renderWaferMap } = await import('../dist/packages/canvas-adapter/renderWaferMap.js');
const { renderWaferGallery } = await import('../dist/packages/canvas-adapter/renderWaferGallery.js');
const { withPatVerdicts, PAT_MODE_KEY, patModeOffered } = await import('../dist/packages/canvas-adapter/patMode.js');

const waitFor = async (cond, what) => { for (let i = 0; i < 300 && !cond(); i++) await new Promise(r => setTimeout(r, 5)); assert.ok(cond(), what); };
const DEFS = [{ testNumber: 1, name: 'Vth', unit: 'V', limitLow: 0, limitHigh: 10 }];
const mk = () => {
  const results = Array.from({ length: 100 }, (_, k) => ({ x: k % 10, y: Math.floor(k / 10), hbin: 1, testValues: { 1: k === 90 ? 5.9 : 5 + ((k % 10) - 4.5) / 50 } }));
  return buildWaferMap({ results, waferConfig: { diameter: 30 }, dieConfig: { width: 2, height: 2 }, passBins: [1], testDefs: DEFS });
};
const verdictOf = d => d.metadata?.[PAT_MODE_KEY];
const PAT_VIEW = { plotMode: 'metadata', activeMetadataKey: PAT_MODE_KEY };

test('each die carries its verdict in a copy, and the host\'s dies are left as they were', () => {
  const m = mk();
  const out = withPatVerdicts(m.dies, DEFS, [1]);
  assert.equal(out.length, m.dies.length);
  assert.ok(out.some(d => verdictOf(d) === 'PAT outlier'), 'the planted outlier is named');
  assert.ok(out.every((d, i) => d.hbin === m.dies[i].hbin && d.testValues?.[1] === m.dies[i].testValues?.[1]), 'bins and values are kept');
  assert.ok(m.dies.every(d => d.metadata?.[PAT_MODE_KEY] === undefined), 'the source dies carry nothing');
  assert.equal(withPatVerdicts(m.dies, DEFS, [1]), out, 'memoised on the die list');
});

test('verdicts are judged over the dies the filter keeps; a dropped die has none', () => {
  const m = mk();
  const dies = m.dies.map((d, i) => (i < 40 ? { ...d, filteredOut: true } : d));
  const out = withPatVerdicts(dies, DEFS, [1]);
  assert.ok(out.slice(0, 40).every((d, i) => d === dies[i] && verdictOf(d) === undefined), 'dropped dies are left as they are');
  assert.ok(out.slice(40).some(d => verdictOf(d) !== undefined), 'kept dies are judged');
  // Too few kept dies to set PAT limits from: nothing is judged.
  const few = m.dies.map((d, i) => (i < 80 ? { ...d, filteredOut: true } : d));
  assert.ok(withPatVerdicts(few, DEFS, [1]).every(d => verdictOf(d) === undefined));
});

test('the mode is offered only where a test has both limits and the wafer has the dies', () => {
  const m = mk();
  assert.equal(patModeOffered([{ dies: m.dies, testDefs: DEFS }]), true);
  assert.equal(patModeOffered([{ dies: m.dies, testDefs: [{ testNumber: 1, name: 'Vth' }] }]), false);
  assert.equal(patModeOffered([{ dies: m.dies.slice(0, 10), testDefs: DEFS }]), false);
  assert.equal(patModeOffered([null]), false);
});

test('a single map in the mode names the verdicts in its legend, with its bins and values kept', async () => {
  const host = document.createElement('div');
  host.style.height = '600px';
  document.getElementById('root').replaceChildren(host);
  const errors = [];
  const error = console.error;
  console.error = (...a) => errors.push(a.join(' '));
  try {
    const ctrl = renderWaferMap(host, mk(), { height: 600, viewOptions: PAT_VIEW });
    await waitFor(() => (globalThis.__drawn ?? []).some(t => /PAT outlier/.test(t)), 'the legend names the verdicts');
    assert.ok(globalThis.__drawn.some(t => /Within PAT/.test(t)));
    assert.deepEqual(errors, []);
    ctrl.destroy();
  } finally { console.error = error; }
});

test('Map the verdicts on the PAT card switches a single map to the mode', async () => {
  const host = document.createElement('div');
  host.style.height = '600px';
  document.getElementById('root').replaceChildren(host);
  const errors = [];
  const error = console.error;
  console.error = (...a) => errors.push(a.join(' '));
  try {
    const ctrl = renderWaferMap(host, mk(), { height: 600, insights: { enabled: true, defaultOpen: true } });
    await waitFor(() => document.querySelector('[data-wmap-pat-maps]'), 'the PAT card offers its maps');
    globalThis.__drawn = [];
    document.querySelector('[data-wmap-pat-maps]').click();
    await waitFor(() => (globalThis.__drawn ?? []).some(t => /PAT outlier/.test(t)), 'the map is shown, coloured by verdict');
    assert.deepEqual(errors, []);
    ctrl.destroy();
  } finally { console.error = error; }
});

test('a gallery in the mode colours every card by the same three verdicts', async () => {
  const host = document.createElement('div');
  host.style.height = '700px';
  document.getElementById('root').replaceChildren(host);
  const errors = [];
  const error = console.error;
  console.error = (...a) => errors.push(a.join(' '));
  try {
    const g = renderWaferGallery(host, [mk(), mk()], { viewOptions: PAT_VIEW, insights: { enabled: true } });
    await waitFor(() => document.querySelectorAll('canvas').length >= 2 && /PAT outlier/.test(host.textContent), 'the legend names the verdicts');
    assert.match(host.textContent, /Within PAT limits/);
    assert.doesNotMatch(host.textContent, /Hard bin/i, 'nothing calls a verdict a hard bin');
    // Leaving the mode gives the cards their dies back.
    g.setOptions({ plotMode: 'hardBin', activeMetadataKey: undefined });
    await waitFor(() => !/PAT outlier/.test(host.textContent), 'the verdicts are gone from the legend');
    g.setOptions(PAT_VIEW);
    await waitFor(() => /PAT outlier/.test(host.textContent), 'and back');
    assert.deepEqual(errors, []);
    g.destroy();
  } finally { console.error = error; }
});
