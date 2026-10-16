// The Dies table carries each die's part-average-testing verdict (and the tests behind an outlier) when the dies are
// whole wafers, and none when they are a part of one (PAT limits are set from every die of a wafer).

import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { pretendToBeVisual: true, url: 'http://localhost/' });
for (const k of ['window', 'document', 'HTMLElement', 'Node', 'Event', 'MouseEvent', 'KeyboardEvent', 'Blob', 'URL']) if (dom.window[k]) globalThis[k] = dom.window[k];
globalThis.window = dom.window; globalThis.document = dom.window.document;
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
globalThis.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
class FakeResizeObserver { observe() {} unobserve() {} disconnect() {} }
dom.window.ResizeObserver = FakeResizeObserver; globalThis.ResizeObserver = FakeResizeObserver;

const { buildWaferMap } = await import('../dist/index.js');
const { resolveDieColumns } = await import('../dist/packages/canvas-adapter/dieList.js');
const { renderDataTables } = await import('../dist/packages/canvas-adapter/dataTab.js');

const DEFS = [{ testNumber: 1, name: 'Vth', unit: 'V', limitLow: 0, limitHigh: 10 }, { testNumber: 3, name: 'Free', unit: 'V' }];
function wafer(label) {
  const results = Array.from({ length: 100 }, (_, k) => ({
    x: k % 10, y: Math.floor(k / 10), hbin: k === 92 ? 2 : 1,
    testValues: { 1: k === 90 ? 5.9 : k === 91 ? 11 : k === 92 ? 3 : 5 + ((k % 10) - 4.5) / 50, 3: k },
  }));
  const r = buildWaferMap({ results, waferConfig: { diameter: 30 }, dieConfig: { width: 2, height: 2 }, passBins: [1], testDefs: DEFS });
  return { label, dies: r.dies, passBins: [1], waferIndex: 0, wafer: r.wafer };
}
const headers = (el) => [...el.querySelectorAll('th')].map(h => h.textContent.trim());
const input = (items, extra = {}) => ({ doc: document, items, testDefs: DEFS.filter(d => d.testNumber === 1), view: 'dies', ringCount: 4, ...extra });

test('a whole wafer’s Dies table has PAT and PAT tests columns', () => {
  const t = renderDataTables(input([wafer('W1')]));
  const h = headers(t.el);
  assert.ok(h.includes('PAT'), h.join());
  assert.ok(h.includes('PAT tests'), 'an outlier is on this wafer, so the tests behind it are listed');
  t.destroy();
});

test('a part of a wafer has none, unless the whole wafer behind it is given', () => {
  const w = wafer('W1');
  const part = { ...w, dies: w.dies.slice(0, 50) };
  const without = renderDataTables(input([part], { population: 'selected on W1' }));
  assert.equal(headers(without.el).includes('PAT'), false);
  without.destroy();
  const withWhole = renderDataTables(input([{ ...part, allDies: w.dies }], { population: 'selected on W1' }));
  assert.ok(headers(withWhole.el).includes('PAT'));
  withWhole.destroy();
});

test('the columns come from the caller’s getters, after Soft bin, and PAT tests only when there is an outlier', () => {
  const w = wafer('W1');
  const mk = (anyOutlier) => resolveDieColumns(w.dies, DEFS, { patColumns: { verdict: () => 'Within PAT limits', tests: () => '', anyOutlier } }).columns.map(c => c.label);
  const labels = mk(true);
  assert.deepEqual(labels.slice(labels.indexOf('Soft bin') + 1, labels.indexOf('Soft bin') + 3), ['PAT', 'PAT tests']);
  assert.equal(mk(false).includes('PAT tests'), false);
});
