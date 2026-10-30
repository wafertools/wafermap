// Two cards that are two views of one idea (charts/chartShell.ts pairCards): a View choice in each header shows one.

import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><body></body>', { pretendToBeVisual: true });
for (const k of ['window', 'document', 'HTMLElement', 'Node', 'Event', 'MouseEvent', 'Element']) globalThis[k] = dom.window[k];
globalThis.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
class RO { observe() {} unobserve() {} disconnect() {} }
dom.window.ResizeObserver = RO; globalThis.ResizeObserver = RO;
const { cardShell, pairCards } = await import('../dist/packages/canvas-adapter/charts/chartShell.js');

test('the first card is shown, each header offers the View choice, and choosing it swaps the cards', () => {
  const a = cardShell('Ring yield by wafer', undefined, document), b = cardShell('Ring yield', undefined, document);
  const host = pairCards([{ label: 'Heatmap', card: a.card }, { label: 'Diagram', card: b.card }], document);
  document.body.appendChild(host);
  assert.equal(a.card.style.display, 'flex');
  assert.equal(b.card.style.display, 'none');
  for (const c of [a.card, b.card]) assert.equal([...c.querySelectorAll('[data-wmap-card-view] input')].length, 2, 'a View choice in each header');
  const second = a.card.querySelector('[data-wmap-card-view] input[value="1"]');
  second.checked = true; second.dispatchEvent(new window.Event('change', { bubbles: true }));
  assert.equal(a.card.style.display, 'none');
  assert.equal(b.card.style.display, 'flex', 'the card is shown as it was before it was hidden');
});

test('after a round trip each card\'s own View choice reads the view it shows, and still answers', () => {
  const a = cardShell('Quadrant yield by wafer', undefined, document), b = cardShell('Quadrant yield', undefined, document);
  const host = pairCards([{ label: 'Heatmap', card: a.card }, { label: 'Diagram', card: b.card }], document);
  document.body.appendChild(host);
  const radio = (card, i) => card.querySelector(`[data-wmap-card-view] input[value="${i}"]`);
  const on = (card) => [...card.querySelectorAll('[data-wmap-card-view] label')].map(l => l.dataset.on);
  radio(a.card, 1).click();                                   // Diagram, from the heatmap card
  assert.equal(b.card.style.display, 'flex');
  radio(b.card, 0).click();                                   // and back, from the diagram card
  assert.equal(a.card.style.display, 'flex');
  assert.deepEqual(on(a.card), ['true', 'false'], 'the heatmap card reads Heatmap, not the view it was left on');
  assert.deepEqual(on(b.card), ['true', 'false'], 'the hidden card\'s choice mirrors it: one choice, shown in both');
  radio(a.card, 1).click();                                   // the choice that used to look already chosen
  assert.equal(b.card.style.display, 'flex', 'Diagram answers at once');
  assert.equal(a.card.style.display, 'none');
  assert.deepEqual(on(b.card), ['false', 'true']);
  assert.deepEqual(on(a.card), ['false', 'true']);
  for (let i = 0; i < 4; i++) { radio(b.card, 0).click(); assert.equal(a.card.style.display, 'flex'); radio(a.card, 1).click(); assert.equal(b.card.style.display, 'flex'); }
});
