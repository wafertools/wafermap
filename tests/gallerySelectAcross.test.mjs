// Gallery: "Select the same dies on every wafer". Off, each card selects on its own. On, a
// selection made on one card is made at the same die positions on every card, and the drilldown
// menu opens on those dies across all the wafers.

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
const { renderWaferGallery } = await import('../dist/packages/canvas-adapter/index.js');

const tick = () => new Promise(r => setTimeout(r, 0));
const waitFor = async (cond, what) => { for (let i = 0; i < 200 && !cond(); i++) await new Promise(r => setTimeout(r, 5)); assert.ok(cond(), what); };

function wafer(id) {
  return {
    ...buildWaferMap({
      results: Array.from({ length: 24 }, (_, k) => ({ x: k % 6, y: Math.floor(k / 6), hbin: 1, testValues: { 1000: k + id.length } })),
      testDefs: [{ testNumber: 1000, name: 'Idsat' }],
      waferConfig: { diameter: 80, metadata: { lot: 'L1', waferId: id } },
      dieConfig: { width: 10, height: 10 }, passBins: [1],
    }),
    label: id,
  };
}

/** A gallery of three wafers; `selections` records each card's onSelect as [wafer, dieCount]. */
async function mount() {
  const selections = [];
  const items = ['W1', 'W2', 'W3'].map(id => ({ ...wafer(id), onSelect: (dies) => selections.push([id, dies.length]) }));
  const host = document.getElementById('root');
  host.innerHTML = '';
  const gallery = renderWaferGallery(host, items, {});
  await tick(); await tick();
  const canvases = [...host.querySelectorAll('canvas')];
  assert.equal(canvases.length, 3);
  return { host, gallery, canvases, selections };
}

const pointer = (canvas, type, x, y) => {
  const e = new MouseEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0 });
  Object.defineProperty(e, 'pointerId', { value: 1 });
  canvas.dispatchEvent(e);
};
let DIE_POS = null;
/** Where a die is on a card's canvas, found once with propagation off (so the search stays cheap). */
async function findDie() {
  if (DIE_POS) return DIE_POS;
  const { gallery, canvases, selections } = await mount();
  outer: for (let y = 20; y < 580; y += 8) {
    for (let x = 20; x < 580; x += 8) {
      pointer(canvases[0], 'pointerdown', x, y);
      pointer(canvases[0], 'pointerup', x, y);
      if (selections.some(([, n]) => n > 0)) { DIE_POS = [x, y]; break outer; }
    }
  }
  gallery.destroy();
  assert.ok(DIE_POS, 'a die was found');
  return DIE_POS;
}
/** Select the die at the known position on a card. */
async function selectADie(canvas, selections, wafer) {
  const [x, y] = await findDie();
  pointer(canvas, 'pointerdown', x, y);
  pointer(canvas, 'pointerup', x, y);
  assert.ok(selections.some(([w, n]) => w === wafer && n > 0), 'the die was selected');
  return [x, y];
}
const rightClick = (target) => {
  const e = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 1, clientY: 1, button: 2 });
  target.dispatchEvent(e);
  return e.defaultPrevented;
};
const menus = () => [...document.querySelectorAll('[data-wmap-drilldown-menu]')];
const toggle = (host) => host.querySelector('button[aria-label^="Select the same dies on every wafer"]');
const lastNonEmpty = (selections, wafer) => selections.filter(([w, n]) => w === wafer && n > 0).length;
const closeMenu = () => menus().forEach(m => m.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));

test('the toggle is in the gallery toolbar, off by default, and flips', async () => {
  const { host, gallery } = await mount();
  const btn = toggle(host);
  assert.ok(btn, 'a Select-on-every-wafer button');
  assert.equal(btn.getAttribute('aria-pressed'), 'false');
  btn.click();
  assert.equal(btn.getAttribute('aria-pressed'), 'true');
  assert.match(btn.getAttribute('aria-label'), /on \(click/);
  btn.click();
  assert.equal(btn.getAttribute('aria-pressed'), 'false');
  gallery.destroy();
});

test('off: a selection on one card stays on that card', async () => {
  const { gallery, canvases, selections } = await mount();
  await selectADie(canvases[0], selections, 'W1');
  assert.equal(lastNonEmpty(selections, 'W2'), 0);
  assert.equal(lastNonEmpty(selections, 'W3'), 0);
  gallery.destroy();
});

test('on: a die selected on one card is selected at the same position on every card', async () => {
  const { host, gallery, canvases, selections } = await mount();
  toggle(host).click();
  await selectADie(canvases[0], selections, 'W1');
  // Every card now has the selection: its own drilldown names all three wafers.
  assert.equal(rightClick(canvases[1]), true);
  await waitFor(() => menus().length > 0, 'the menu opened');
  assert.equal(menus()[0].getAttribute('aria-label'), 'Open a chart or table of 3 dies selected at the same die positions on 3 wafers');
  closeMenu();
  gallery.destroy();
});

test('the menu opens on the whole selection from any card, and offers a Wafers table with a row per wafer', async () => {
  const { host, gallery, canvases, selections } = await mount();
  toggle(host).click();
  await selectADie(canvases[2], selections, 'W3');
  rightClick(canvases[0]);
  await waitFor(() => menus().length > 0, 'the menu opened');
  const items = [...menus()[0].querySelectorAll('[role="menuitem"]')];
  assert.ok(items.some(i => i.textContent === 'Wafers'), items.map(i => i.textContent).join(' | '));
  items.find(i => i.textContent === 'Wafers').click();
  await waitFor(() => document.querySelector('.wmap-overlay-box [data-wmap-data-view="wafers"]'), 'the Wafers table opened');
  const box = document.querySelector('.wmap-overlay-box');
  assert.equal(box.querySelectorAll('tbody tr[aria-rowindex]').length, 3);
  assert.match(box.textContent, /3 dies selected at the same die positions on 3 wafers/);
  box.querySelector('button[aria-label^="Close"]')?.click();
  gallery.destroy();
});

test('the Dies table lists the selected positions on every wafer, one wafer per row group', async () => {
  const { host, gallery, canvases, selections } = await mount();
  toggle(host).click();
  await selectADie(canvases[0], selections, 'W1');
  rightClick(canvases[0]);
  await waitFor(() => menus().length > 0, 'the menu opened');
  [...menus()[0].querySelectorAll('[role="menuitem"]')].find(i => i.textContent === 'Dies').click();
  await waitFor(() => document.querySelector('.wmap-overlay-box [data-wmap-data-view="dies"]'), 'the Dies table opened');
  const box = document.querySelector('.wmap-overlay-box');
  const wafers = [...box.querySelectorAll('tbody tr[aria-rowindex]')].map(tr => tr.querySelector('td').textContent);
  assert.deepEqual(wafers.sort(), ['W1', 'W2', 'W3']);
  box.querySelector('button[aria-label^="Close"]')?.click();
  gallery.destroy();
});

test('clearing the selection on one card clears it on all of them', async () => {
  const { host, gallery, canvases, selections } = await mount();
  toggle(host).click();
  const at = await selectADie(canvases[0], selections, 'W1');
  pointer(canvases[0], 'pointerdown', 2, 2);             // empty space
  pointer(canvases[0], 'pointerup', 2, 2);
  rightClick(canvases[1]);
  await waitFor(() => menus().length > 0, 'the menu opened');
  assert.equal(menus()[0].getAttribute('aria-label'), 'Open a chart or table of 24 dies on W2', `cleared after ${at}`);
  closeMenu();
  gallery.destroy();
});

test('right-click on a card outside its map uses the whole selection too', async () => {
  const { host, gallery, canvases, selections } = await mount();
  toggle(host).click();
  await selectADie(canvases[0], selections, 'W1');
  const header = host.querySelectorAll('[data-wmap-expand-btn]')[1].parentElement;
  assert.equal(rightClick(header), true);
  await waitFor(() => menus().length > 0, 'the menu opened');
  assert.match(menus()[0].getAttribute('aria-label'), /3 dies selected at the same die positions on 3 wafers/);
  closeMenu();
  gallery.destroy();
});

test('turning it off clears the selection on every card, not just the one it was made on', async () => {
  const { host, gallery, canvases, selections } = await mount();
  toggle(host).click();
  await selectADie(canvases[0], selections, 'W1');
  const cleared = () => ['W1', 'W2', 'W3'].map(w => selections.filter(([x]) => x === w).at(-1)?.[1]);
  toggle(host).click();                                 // clears first (see below), a second click turns it off
  toggle(host).click();
  assert.equal(toggle(host).getAttribute('aria-pressed'), 'false');
  assert.deepEqual(cleared(), [0, 0, 0], 'every card was told its selection is empty');
  rightClick(canvases[1]);
  await waitFor(() => menus().length > 0, 'the menu opened');
  assert.equal(menus()[0].getAttribute('aria-label'), 'Open a chart or table of 24 dies on W2');
  closeMenu();
  gallery.destroy();
});

const badge = (host) => host.querySelector('[data-wmap-select-across-count]');

test('the toggle shows how many die positions are selected', async () => {
  const { host, gallery, canvases, selections } = await mount();
  assert.equal(badge(host).style.display, 'none', 'nothing selected, nothing shown');
  toggle(host).click();
  assert.equal(badge(host).style.display, 'none', 'on, but nothing selected');
  await selectADie(canvases[0], selections, 'W1');
  assert.equal(badge(host).style.display, 'block');
  assert.equal(badge(host).textContent, '1');
  assert.match(toggle(host).getAttribute('aria-label'), /on, 1 die position selected \(click to clear the selection\)/);
  gallery.destroy();
});

test('a click on the toggle with a selection clears it and stays on; the next click turns it off', async () => {
  const { host, gallery, canvases, selections } = await mount();
  toggle(host).click();
  await selectADie(canvases[0], selections, 'W1');
  toggle(host).click();
  assert.equal(toggle(host).getAttribute('aria-pressed'), 'true', 'still on');
  assert.equal(badge(host).style.display, 'none', 'nothing selected any more');
  assert.deepEqual(['W1', 'W2', 'W3'].map(w => selections.filter(([x]) => x === w).at(-1)[1]), [0, 0, 0]);
  assert.match(toggle(host).getAttribute('aria-label'), /on \(click to turn off\)/);
  toggle(host).click();
  assert.equal(toggle(host).getAttribute('aria-pressed'), 'false');
  gallery.destroy();
});

test('clearing on a card (empty space) clears the count too', async () => {
  const { host, gallery, canvases, selections } = await mount();
  toggle(host).click();
  await selectADie(canvases[0], selections, 'W1');
  pointer(canvases[0], 'pointerdown', 2, 2);
  pointer(canvases[0], 'pointerup', 2, 2);
  assert.equal(badge(host).style.display, 'none');
  gallery.destroy();
});
