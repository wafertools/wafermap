// The page filter on a single map: a die condition dims the dies it drops (and only those stay in the Summary panel's
// yield), a wafer condition on the one wafer dims the whole map, and the band states what was kept.


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
proto.getContext = () => new Proxy({}, { get: (_, p) => {
  if (p === 'measureText') return (t) => ({ width: String(t).length * 6 });
  if (p === 'createLinearGradient' || p === 'createRadialGradient') return () => ({ addColorStop: noop });
  if (p === 'getImageData') return () => ({ data: [] });
  if (p === 'canvas') return { width: 600, height: 600 };
  return noop;
} });
proto.focus = noop; proto.setPointerCapture = noop; proto.releasePointerCapture = noop;
Object.defineProperty(proto, 'clientWidth', { configurable: true, get() { return 600; } });
Object.defineProperty(proto, 'clientHeight', { configurable: true, get() { return 600; } });

const { buildWaferMap } = await import('../dist/index.js');
const { renderWaferMap } = await import('../dist/packages/canvas-adapter/index.js');

function wafer(split) {
  return buildWaferMap({
    results: Array.from({ length: 24 }, (_, k) => ({ x: k % 6, y: Math.floor(k / 6), hbin: k % 4 === 0 ? 2 : 1 })),
    waferConfig: { diameter: 80, metadata: { split } },
    dieConfig: { width: 10, height: 10 },
    passBins: [1],
  });
}
const tick = () => new Promise(r => setTimeout(r, 60));
function mount(filter, split = 'A') {
  const host = dom.window.document.getElementById('root');
  host.innerHTML = '';
  const changes = [];
  const ctrl = renderWaferMap(host, wafer(split), { insights: { enabled: true, filter, onFilterChange: f => changes.push(f) } });
  return { host, ctrl, changes };
}
const band = host => host.querySelector('[data-wmap-insights-filter]');

test('with no filter there is no band, and the Filter button opens the editor', async () => {
  const { host, ctrl } = mount();
  assert.equal(band(host), null);
  host.querySelector('[data-wmap-map-filter-open]').click();
  await tick();
  assert.ok(dom.window.document.querySelector('[data-wmap-insights-filter-modal]'));
  dom.window.document.querySelector('[data-wmap-insights-filter-cancel]').click();
  ctrl.destroy();
});

test('a die condition: the band says how many dies it kept', async () => {
  const { host, ctrl } = mount({ conditions: [{ field: { builtin: 'hbin' }, values: ['Bin 1'] }] });
  await tick();
  assert.notEqual(band(host).style.display, 'none');
  assert.match(band(host).textContent, /Filter on:.*Hard bin is Bin 1.*1 of 1 wafer · 18 of 24 dies/);
  ctrl.destroy();
});

test('a wafer condition this wafer fails drops all of it', async () => {
  const { host, ctrl } = mount({ conditions: [{ field: { meta: 'split' }, values: ['B'] }] });
  await tick();
  assert.match(band(host).textContent, /0 of 1 wafer · 0 of 24 dies/);
  ctrl.destroy();
});

test('Remove clears the band and tells the host', async () => {
  const { host, ctrl, changes } = mount({ conditions: [{ field: { builtin: 'hbin' }, values: ['Bin 1'] }] });
  await tick();
  band(host).querySelector('[data-wmap-insights-filter-remove]').click();
  await tick();
  assert.equal(changes.at(-1), undefined);
  assert.equal(band(host).style.display, 'none');
  ctrl.destroy();
});

const { analyzeWaferMap } = await import('../dist/packages/stats/index.js');

test('the analysis is rerun over the dies kept: the Summary panel shows their yield, and the button stays', async () => {
  const host = dom.window.document.getElementById('root');
  host.innerHTML = '';
  const result = wafer('A');
  const ctrl = renderWaferMap(host, result, {
    statsSummary: analyzeWaferMap(result), summaryPanel: { defaultOpen: true },
    insights: { enabled: true, filter: { conditions: [{ field: { builtin: 'hbin' }, values: ['Bin 1'] }] } },
  });
  for (let i = 0; i < 50 && !/Yield.{0,12}100(\.0)?\s*%/.test(host.textContent); i++) await tick();
  assert.match(host.textContent, /Yield.{0,12}100(\.0)?\s*%/, 'the kept dies are all passes');
  assert.ok(host.querySelector('[data-wmap-summary-toggle]'), 'the Summary button is still there');
  band(host).querySelector('[data-wmap-insights-filter-remove]').click();
  await tick();
  assert.match(host.textContent, /Yield.{0,12}75(\.0)?\s*%/, 'the host\'s own analysis is back');
  assert.ok(host.querySelector('[data-wmap-summary-toggle]'));
  ctrl.destroy();
});
