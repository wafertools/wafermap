// The Filter window's JSON view (canvas-adapter/filterJson.ts): the filter as text, written into the draft as it is typed.

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


const { readFiltersFile, writeFiltersFile } = await import('../dist/packages/stats/index.js');
const { addSavedFilters, FILTERS_FORMAT } = await import('../dist/packages/stats/filterFile.js');

function wafer(label, split) {
  const built = buildWaferMap({
    results: Array.from({ length: 9 }, (_, i) => ({ x: i % 3, y: Math.floor(i / 3), hbin: i < 3 ? 2 : 1 })),
    waferConfig: { diameter: 60, metadata: { split } }, dieConfig: { width: 10, height: 10 }, passBins: [1],
  });
  return { ...built, label };
}
const tick = () => new Promise(r => setTimeout(r, 60));
const BIN1 = { field: { builtin: 'hbin' }, values: ['Bin 1'] };

function mount(extra = {}) {
  const root = document.getElementById('root');
  root.replaceChildren();
  const saved = [];
  const saves = [];
  const g = renderWaferGallery(root, [wafer('W1', 'A'), wafer('W2', 'B')], {
    insights: { enabled: true, onSavedFiltersChange: l => saved.push(l), onPickFiltersFile: extra.pick, savedFilters: extra.savedFilters },
    onSaveText: (text, name) => { saves.push({ text, name }); },
  });
  return { root, g, saved, saves };
}
async function openEditor(root) {
  root.querySelector('[data-wmap-gallery-filter-open]').click();
  await tick();
  return document.querySelector('[data-wmap-insights-filter-modal]');
}
const closeEditor = () => document.querySelector('[data-wmap-insights-filter-cancel]')?.click();


const textOf = (modal) => modal.querySelector('[data-wmap-filter-json-text]');
const statusOf = (modal) => modal.querySelector('[data-wmap-filter-json-status]').textContent;
const previewOf = (modal) => modal.querySelector('[data-wmap-insights-filter-preview]').textContent;
const applyOf = (modal) => modal.querySelector('[data-wmap-insights-filter-apply]');
const goJson = (modal) => { const r = [...modal.querySelectorAll('[data-wmap-filter-mode] input[type="radio"]')].find(x => x.value === 'json'); r.checked = true; r.dispatchEvent(new window.Event('change', { bubbles: true })); };
const goConditions = (modal) => { const r = [...modal.querySelectorAll('[data-wmap-filter-mode] input[type="radio"]')].find(x => x.value === 'conditions'); r.checked = true; r.dispatchEvent(new window.Event('change', { bubbles: true })); };
const typeJson = (modal, value) => { const a = textOf(modal); a.value = typeof value === 'string' ? value : JSON.stringify(value); a.setSelectionRange(a.value.length, a.value.length); a.dispatchEvent(new window.InputEvent('input', { bubbles: true, inputType: 'insertFromPaste', data: a.value })); };
const SPLIT_A = { conditions: [{ field: { meta: 'split' }, values: ['A'] }] };

test('the window has a Conditions | JSON switch, and the JSON view shows the draft, an empty one as an empty list', async () => {
  const { root, g } = mount();
  const modal = await openEditor(root);
  assert.ok(modal.querySelector('[data-wmap-filter-mode]'), 'the switch');
  assert.equal(textOf(modal).closest('[data-wmap-filter-json]').style.display, 'none', 'Conditions is the first view');
  goJson(modal);
  assert.equal(textOf(modal).closest('[data-wmap-filter-json]').style.display, '');
  assert.deepEqual(JSON.parse(textOf(modal).value), { conditions: [] });
  assert.match(statusOf(modal), /No conditions/);
  closeEditor();
  g.destroy();
});

test('valid text is the draft as it is typed: the preview follows, and the window\'s Apply filters', async () => {
  const { root, g } = mount();
  const modal = await openEditor(root);
  goJson(modal);
  typeJson(modal, SPLIT_A);
  assert.match(previewOf(modal), /Keeps 1 of 2 wafers/);
  assert.match(statusOf(modal), /^1 condition$/);
  assert.equal(applyOf(modal).disabled, false);
  applyOf(modal).click();
  await tick();
  assert.match(root.querySelector('[data-wmap-insights-filter]').textContent, /1 of 2 wafers/);
  g.destroy();
});

test('text that cannot be read says why and holds Apply; going back to Conditions drops it and frees Apply', async () => {
  const { root, g } = mount();
  const modal = await openEditor(root);
  goJson(modal);
  typeJson(modal, SPLIT_A);
  typeJson(modal, '{ "conditions": [ { "field": ');
  assert.match(statusOf(modal), /^Not valid JSON/);
  assert.equal(applyOf(modal).disabled, true, 'nothing unreadable can be applied');
  assert.match(previewOf(modal), /Keeps 1 of 2 wafers/, 'the draft is the last good reading');
  goConditions(modal);
  assert.equal(applyOf(modal).disabled, false);
  goJson(modal);
  assert.deepEqual(JSON.parse(textOf(modal).value), SPLIT_A, 'the text is the draft again');
  closeEditor();
  g.destroy();
});

test('a mistyped key is named with the nearest, and what the reader leaves out is said', async () => {
  const { root, g } = mount();
  const modal = await openEditor(root);
  goJson(modal);
  typeJson(modal, { condtions: [], conditions: [{ field: { meta: 'split' }, values: ['A'], nott: true }] });
  assert.match(statusOf(modal), /filter\.condtions: not a setting of a filter, ignored\. Did you mean "conditions"\?/);
  assert.equal(applyOf(modal).disabled, false, 'a note is not a problem');
  typeJson(modal, { conditions: [{ field: 5 }] });
  assert.match(statusOf(modal), /No condition could be read/);
  assert.equal(applyOf(modal).disabled, true);
  closeEditor();
  g.destroy();
});

test('a pasted filters file of several filters offers each to choose from; Apply waits for the choice', async () => {
  const { root, g } = mount();
  const modal = await openEditor(root);
  goJson(modal);
  typeJson(modal, { format: 'wafermap-filters', version: 1, filters: [
    { id: 'a', name: 'Bin 1 only', conditions: [BIN1] },
    { id: 'b', name: 'Split A', conditions: SPLIT_A.conditions },
  ] });
  assert.match(statusOf(modal), /choose the filter to use/);
  assert.equal(applyOf(modal).disabled, true);
  const choices = [...modal.querySelectorAll('[data-wmap-filter-json-choice]')];
  assert.deepEqual(choices.map(c => c.textContent), ['1. Bin 1 only', '2. Split A']);
  choices[1].click();
  assert.deepEqual(JSON.parse(textOf(modal).value), { conditions: SPLIT_A.conditions });
  assert.equal(applyOf(modal).disabled, false);
  assert.match(previewOf(modal), /Keeps 1 of 2 wafers/);
  closeEditor();
  g.destroy();
});

test('a file of one filter is simply used', async () => {
  const { root, g } = mount();
  const modal = await openEditor(root);
  goJson(modal);
  typeJson(modal, [{ id: 'a', name: 'Split A', conditions: SPLIT_A.conditions }]);
  assert.equal(applyOf(modal).disabled, false);
  assert.match(previewOf(modal), /Keeps 1 of 2 wafers/);
  closeEditor();
  g.destroy();
});

test('suggestions name the lot\'s own wafer fields and the values a field takes', async () => {
  const { root, g } = mount();
  const modal = await openEditor(root);
  goJson(modal);
  const a = textOf(modal);
  const at = (marked) => { const caret = marked.indexOf('|'); a.value = marked.replace('|', ''); a.setSelectionRange(caret, caret); a.dispatchEvent(new window.InputEvent('input', { bubbles: true, inputType: 'insertText', data: 'x' })); };
  const options = () => [...modal.querySelectorAll('[role="option"]')].map(o => o.dataset.wmapPlotJsonSuggestion);
  at('{ "conditions": [ { "field": { "meta": "|" } } ] }');
  assert.ok(options().includes('split'), options().join());
  at('{ "conditions": [ { "field": { "meta": "split" }, "values": [ "|" ] } ] }');
  assert.deepEqual(options().sort(), ['A', 'B'], 'the values the split field takes in this lot');
  at('{ "|" }');
  assert.deepEqual(options().sort(), ['conditions', 'off'], 'a filter\'s own keys, not a plot\'s');
  closeEditor();
  g.destroy();
});

test('Ctrl+Z steps back through the text, and loading a saved filter fills the text', async () => {
  const { root, g } = mount({ savedFilters: [{ id: 'a', name: 'Split A', conditions: SPLIT_A.conditions }] });
  const modal = await openEditor(root);
  goJson(modal);
  const before = textOf(modal).value;
  typeJson(modal, SPLIT_A);
  const ev = new window.KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true });
  textOf(modal).dispatchEvent(ev);
  assert.equal(ev.defaultPrevented, true);
  assert.equal(textOf(modal).value, before, 'back to the text as it was');
  modal.querySelector('[data-wmap-saved-filter-load]').click();
  assert.deepEqual(JSON.parse(textOf(modal).value), { conditions: SPLIT_A.conditions }, 'a loaded filter is in the text');
  closeEditor();
  g.destroy();
});
