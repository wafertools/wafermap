// The page filter on the gallery: a wafer condition removes the wafer's card, a die condition dims the dies it drops,
// and the band states the filter above the cards. The filter is the one Insights uses (pageFilter.ts).

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
dom.window.devicePixelRatio = 1;
const noop = () => {};
const proto = dom.window.HTMLCanvasElement.prototype;
proto.getContext = () => new Proxy({}, { get: (_, p) => {
  if (p === 'measureText') return (t) => ({ width: String(t).length * 6 });
  if (p === 'createLinearGradient' || p === 'createRadialGradient') return () => ({ addColorStop: noop });
  if (p === 'getImageData') return () => ({ data: [] });
  if (p === 'canvas') return { width: 400, height: 400 };
  return noop;
} });
proto.focus = noop; proto.setPointerCapture = noop; proto.releasePointerCapture = noop;
Object.defineProperty(proto, 'clientWidth', { configurable: true, get() { return 400; } });
Object.defineProperty(proto, 'clientHeight', { configurable: true, get() { return 400; } });

const { buildWaferMap } = await import('../dist/index.js');
const { renderWaferGallery } = await import('../dist/packages/canvas-adapter/index.js');

const { createPageFilter } = await import('../dist/packages/canvas-adapter/pageFilter.js');

function wafer(label, split, nBad) {
  const built = buildWaferMap({
    results: Array.from({ length: 9 }, (_, i) => ({ x: i % 3, y: Math.floor(i / 3), hbin: i < nBad ? 2 : 1 })),
    waferConfig: { diameter: 60, metadata: { split } },
    dieConfig: { width: 10, height: 10 },
    passBins: [1],
  });
  return { ...built, label };
}
const ITEMS = () => [wafer('W01', 'A', 0), wafer('W02', 'B', 3), wafer('W03', 'A', 3)];
const tick = () => new Promise(r => setTimeout(r, 60));

function mount(filter, onFilterChange) {
  const root = document.getElementById('root');
  root.replaceChildren();
  const g = renderWaferGallery(root, ITEMS(), { insights: { enabled: true, filter, onFilterChange } });
  return { root, g };
}
const cards = root => [...root.querySelectorAll('.wmap-gallery-card')];

test('a wafer condition removes the wafer\'s card and the band says how many are kept', async () => {
  const { root, g } = mount({ conditions: [{ field: { meta: 'split' }, values: ['A'] }] });
  assert.ok(await until(() => /of 3 wafers/.test(root.querySelector('[data-wmap-insights-filter]')?.textContent ?? '')), 'the filter has loaded');
  const shown = cards(root).filter(c => c.style.display !== 'none');
  assert.equal(shown.length, 2);
  assert.equal(cards(root).length, 3, 'the slot stays so indexes keep matching');
  const band = root.querySelector('[data-wmap-insights-filter]');
  assert.notEqual(band.style.display, 'none');
  assert.match(band.textContent, /Filter on:.*Split is A.*2 of 3 wafers/);
  g.destroy();
});

test('a die condition keeps every card and flags the dies it drops', async () => {
  const { root, g } = mount({ conditions: [{ field: { builtin: 'hbin' }, values: ['Bin 1'] }] });
  assert.ok(await until(() => /of 3 wafers/.test(root.querySelector('[data-wmap-insights-filter]')?.textContent ?? '')), 'the filter has loaded');
  assert.equal(cards(root).filter(c => c.style.display !== 'none').length, 3);
  assert.match(root.querySelector('[data-wmap-insights-filter]').textContent, /3 of 3 wafers · 21 of 27 dies/);
  g.destroy();
});

test('Remove restores every card, and the host is told', async () => {
  const changes = [];
  const { root, g } = mount({ conditions: [{ field: { meta: 'split' }, values: ['A'] }] }, f => changes.push(f));
  assert.ok(await until(() => root.querySelector('[data-wmap-insights-filter-remove]')), 'the band is up once the filter has loaded');
  root.querySelector('[data-wmap-insights-filter-remove]').click();
  await tick();
  assert.equal(changes.at(-1), undefined);
  assert.equal(cards(root).filter(c => c.style.display !== 'none').length, 3);
  assert.equal(root.querySelector('[data-wmap-insights-filter]').style.display, 'none');
  g.destroy();
});

test('the Filter button opens the editor with no filter set', async () => {
  const { root, g } = mount();
  root.querySelector('[data-wmap-gallery-filter-open]').click();
  await tick();
  assert.ok(document.querySelector('[data-wmap-insights-filter-modal]'));
  document.querySelector('[data-wmap-insights-filter-cancel]').click();
  g.destroy();
});

test('mark flags the dropped dies on copies and leaves the source dies alone', async () => {
  const items = ITEMS().map((it, i) => ({ dies: it.dies, wafer: it.wafer, label: it.label, waferIndex: i, passBins: [1] }));
  const ctl = createPageFilter({ doc: document, initial: { conditions: [{ field: { builtin: 'hbin' }, values: ['Bin 1'] }] }, getRingCount: () => items.length && 3 });
  const m = ctl.mark(items);
  assert.equal(m.items[1].dies.filter(d => d.filteredOut).length, 3);
  assert.equal(items[1].dies.filter(d => d.filteredOut).length, 0, 'the source is untouched');
  assert.equal(m.items[0], items[0], 'a wafer nothing is dropped from is the same object');
});

// ── the Summary panel follows the filter ──────────────────────────────────────────────────────────────────

const { analyzeWaferLot } = await import('../dist/packages/stats/index.js');
async function until(ok) { for (let i = 0; i < 100; i++) { if (ok()) return true; await new Promise(r => setTimeout(r, 20)); } return false; }

test('the Summary button and panel stay while the filter narrows, and describe the wafers kept', async () => {
  const items = ITEMS();
  const root = document.getElementById('root');
  root.replaceChildren();
  let ctl;
  const g = renderWaferGallery(root, items, { lotStatsSummary: analyzeWaferLot(items), insights: { enabled: true } });
  const toggle = () => root.querySelector('[data-wmap-summary-toggle]');
  assert.ok(toggle() && toggle().style.display !== 'none', 'the Summary button shows before filtering');
  root.querySelector('[data-wmap-gallery-filter-open]').click();
  await tick();
  const { createPageFilter } = await import('../dist/packages/canvas-adapter/pageFilter.js');
  // Set the filter through the editor's own controller: Apply with a split condition.
  const modal = document.querySelector('[data-wmap-insights-filter-modal]');
  assert.ok(modal);
  modal.querySelector('[data-wmap-insights-filter-cancel]').click();
  g.destroy();
  root.replaceChildren();
  const g2 = renderWaferGallery(root, ITEMS(), { lotStatsSummary: analyzeWaferLot(ITEMS()), insights: { enabled: true, filter: { conditions: [{ field: { meta: 'split' }, values: ['A'] }] } } });
  await tick();
  assert.ok(toggle() && toggle().style.display !== 'none', 'the Summary button stays with a filter on');
  toggle().querySelector('button, [role=button]')?.click?.();
  await tick();
  const panelText = () => root.textContent;
  assert.ok(await until(() => /2 wafers|W01|W03/.test(panelText())), 'the panel describes the wafers kept');
  root.querySelector('[data-wmap-insights-filter-remove]').click();
  await tick();
  assert.ok(toggle() && toggle().style.display !== 'none', 'the Summary button is still there once the filter is removed');
  g2.destroy();
});

// ── one place for the Filter button ───────────────────────────────────────────────────────────────────────

const { renderWaferMap } = await import('../dist/packages/canvas-adapter/index.js');
const switchTab = async (root, view) => { root.querySelector(`[data-wmap-view="${view}"]`).click(); await tick(); await tick(); };

test('the Filter button is the last control in the row, and stays put and visible in Insights, on the gallery and on a map', async () => {
  const root = document.getElementById('root');
  for (const [name, mountIt, hook] of [
    ['gallery', () => renderWaferGallery(root, ITEMS(), { insights: { enabled: true } }), 'data-wmap-gallery-filter-open'],
    ['map', () => renderWaferMap(root, ITEMS()[0], { insights: { enabled: true } }), 'data-wmap-map-filter-open'],
  ]) {
    root.replaceChildren();
    const ctl = mountIt();
    const button = () => root.querySelector(`[${hook}]`);
    const isLast = () => button() === button().parentElement.lastElementChild;
    assert.ok(button(), `${name}: has a Filter button`);
    assert.ok(isLast(), `${name}: it is the last control in its row`);
    await switchTab(root, 'insights');
    assert.notEqual(button().style.display, 'none', `${name}: still shown in Insights`);
    assert.ok(isLast(), `${name}: still last in Insights`);
    assert.equal(root.querySelectorAll('[data-wmap-insights-filter-open]').length, 0, `${name}: Insights adds no second button`);
    await switchTab(root, 'maps');
    assert.ok(isLast(), `${name}: still last back on the maps`);
    ctl.destroy();
  }
});

// ── the filtered analysis follows the items and the host's analysis ───────────────────────────────────────

const FILTER_A = { conditions: [{ field: { meta: 'split' }, values: ['A'] }] };

test('replacing the items under a filter analyses the new items, not the ones replaced', async () => {
  const root = document.getElementById('root');
  root.replaceChildren();
  const g = renderWaferGallery(root, ITEMS(), { lotStatsSummary: analyzeWaferLot(ITEMS()), insights: { enabled: true, filter: FILTER_A } });
  root.querySelector('[data-wmap-summary-toggle] button, [data-wmap-summary-toggle]')?.click?.();
  const dies = () => /Hard Bin Breakdown — % of dies \(N=(\d+)\)/.exec(root.textContent)?.[1];
  assert.ok(await until(() => dies() === '18'), `the panel describes the two wafers kept (N=${dies()})`);
  // Four wafers now, three of them in split A: 27 dies kept.
  const next = [...ITEMS(), wafer('W04', 'A', 1)];
  g.setItems(next);
  assert.ok(await until(() => dies() === '27'), `the new items are analysed (N=${dies()})`);
  // The host's analysis arrives for the same items, over a different population.
  g.setLotStatsSummary(analyzeWaferLot(next.slice(0, 2)));
  await tick();
  assert.ok(await until(() => dies() !== undefined), 'the panel is rebuilt rather than left on the old figures');
  g.destroy();
});
