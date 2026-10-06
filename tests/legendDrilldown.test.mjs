// Right-click on a bin legend entry opens the drilldown menu on that bin's dies — in the gallery's lot legend strip
// and on a map's own canvas legend — with no selection made. With several bins filtered in, on all of them, with a row
// to narrow to the one clicked.


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
const { renderWaferGallery, renderWaferMap } = await import('../dist/packages/canvas-adapter/index.js');

const tick = () => new Promise(r => setTimeout(r, 0));
const waitFor = async (cond, what) => { for (let i = 0; i < 200 && !cond(); i++) await new Promise(r => setTimeout(r, 5)); assert.ok(cond(), what); };
const menus = () => [...document.querySelectorAll('[data-wmap-drilldown-menu]')];
const closeMenu = () => menus().forEach(m => m.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
const rightClick = (target, x = 1, y = 1) => {
  const e = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 2 });
  target.dispatchEvent(e);
  return e.defaultPrevented;
};

/** Bins by position: 1 pass, 2 and 3 fail, in fixed proportions so each wafer holds all three. */
function wafer(id) {
  return {
    ...buildWaferMap({
      results: Array.from({ length: 36 }, (_, k) => ({ x: k % 6, y: Math.floor(k / 6), hbin: k % 6 === 0 ? 2 : k % 7 === 0 ? 3 : 1 })),
      waferConfig: { diameter: 80, metadata: { lot: 'L1', waferId: id } },
      dieConfig: { width: 10, height: 10 }, passBins: [1],
    }),
    label: id,
  };
}
const count = (w, bins) => w.dies.filter(d => bins.includes(d.hbin)).length;

async function mountGallery() {
  const items = ['W1', 'W2', 'W3'].map(wafer);
  const host = document.getElementById('root');
  host.innerHTML = '';
  const gallery = renderWaferGallery(host, items, {});
  await tick(); await tick();
  return { host, gallery, items };
}
const entry = (host, text) => [...host.querySelectorAll('[role="button"][aria-pressed]')].find(e => e.textContent.startsWith(text));

test('gallery legend strip: right-click a bin opens the menu on that bin\'s dies across every wafer, selecting nothing', async () => {
  const { host, gallery, items } = await mountGallery();
  const bin2 = entry(host, 'Bin 2');
  assert.ok(bin2, 'a legend entry for bin 2');
  assert.equal(rightClick(bin2), true, 'the browser menu is replaced');
  await waitFor(() => menus().length > 0, 'the menu opened');
  const n = items.reduce((s, w) => s + count(w, [2]), 0);
  assert.equal(menus()[0].getAttribute('aria-label'), `Open a chart or table of ${n} dies in hard bin 2, across 3 wafers`);
  assert.ok(![...menus()[0].querySelectorAll('[role="menuitem"]')].some(i => /^Only/.test(i.textContent)), 'one bin: nothing to narrow');
  assert.equal(bin2.getAttribute('aria-pressed'), 'false', 'the legend filter is untouched');
  closeMenu();
  gallery.destroy();
});

test('gallery legend strip: with bins 2 and 3 filtered in, a right-click on bin 2 opens on both, with a row to narrow to bin 2 and back', async () => {
  const { host, gallery, items } = await mountGallery();
  entry(host, 'Bin 2').dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true }));
  await tick();
  entry(host, 'Bin 3').dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true }));
  await tick();
  rightClick(entry(host, 'Bin 2'));
  await waitFor(() => menus().length > 0, 'the menu opened');
  const both = items.reduce((s, w) => s + count(w, [2, 3]), 0);
  assert.equal(menus()[0].getAttribute('aria-label'), `Open a chart or table of ${both} dies in hard bins 2, 3, across 3 wafers`);
  const first = [...menus()[0].querySelectorAll('[role="menuitem"]')][0];
  assert.equal(first.textContent, 'Only hard bin 2');
  first.click();
  const two = items.reduce((s, w) => s + count(w, [2]), 0);
  await waitFor(() => menus().length > 0 && new RegExp(`${two} dies in hard bin 2,`).test(menus()[0].getAttribute('aria-label')), 'narrowed to bin 2');
  const back = [...menus()[0].querySelectorAll('[role="menuitem"]')][0];
  assert.match(back.textContent, /^All filtered bins — /);
  closeMenu();
  gallery.destroy();
});

test('gallery legend strip: the Menu key on a focused entry opens it too', async () => {
  const { host, gallery } = await mountGallery();
  const bin3 = entry(host, 'Bin 3');
  bin3.dispatchEvent(new KeyboardEvent('keydown', { key: 'ContextMenu', bubbles: true, cancelable: true }));
  await waitFor(() => menus().length > 0, 'the menu opened');
  assert.match(menus()[0].getAttribute('aria-label'), /in hard bin 3, across 3 wafers/);
  closeMenu();
  gallery.destroy();
});

test('a map\'s own canvas legend: right-click on a bin entry opens on that bin\'s dies on this wafer', async () => {
  const host = document.getElementById('root');
  host.innerHTML = '';
  const w = wafer('W9');
  const ctrl = renderWaferMap(host, w, { viewOptions: { showLegend: true, legendPosition: 'floating' }, insights: { enabled: false } });
  await tick(); await tick();
  const canvas = host.querySelector('canvas');
  // The legend is drawn on the canvas: scan for a point where the right-click lands on one of its entries.
  let found = null;
  outer: for (let y = 6; y < 590; y += 6) {
    for (let x = 6; x < 590; x += 6) {
      closeMenu();
      rightClick(canvas, x, y);
      await new Promise(r => setTimeout(r, 15));
      const m = menus()[0];
      if (m && /in hard bin \d/.test(m.getAttribute('aria-label'))) { found = m.getAttribute('aria-label'); break outer; }
    }
  }
  assert.ok(found, 'a legend entry took the right-click');
  assert.match(found, /dies in hard bin \d on W9/);
  closeMenu();
  ctrl.destroy();
});
