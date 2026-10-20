// Saved filters and their file (stats/filterFile.ts, and the Saved filters section of the Filter window).

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

// ── the file ──────────────────────────────────────────────────────────────────────────────────────────────

test('a written file reads back the same, wrapped and versioned', () => {
  const filters = [{ id: 'f1', name: 'Bin 1', conditions: [BIN1] }];
  const text = writeFiltersFile(filters);
  assert.equal(JSON.parse(text).format, FILTERS_FORMAT);
  assert.equal(JSON.parse(text).version, 1);
  const read = readFiltersFile(text);
  assert.deepEqual(read.filters, filters);
  assert.deepEqual(read.warnings, []);
});

test('a hand-written file is read leniently: a bare condition, a missing name and id, a bare array', () => {
  const read = readFiltersFile(JSON.stringify([{ field: { meta: 'split' }, values: ['A'] }, { name: 'Two', conditions: [BIN1] }]));
  assert.equal(read.filters.length, 2);
  assert.equal(read.filters[0].name, 'Filter 1');
  assert.deepEqual(read.filters[0].conditions, [{ field: { meta: 'split' }, values: ['A'] }]);
  assert.ok(read.filters.every(f => typeof f.id === 'string' && f.id));
});

test('a bad condition is named and left out; a filter left with none is dropped; nothing readable is an error', () => {
  const some = readFiltersFile(JSON.stringify({ format: FILTERS_FORMAT, filters: [
    { name: 'Mixed', conditions: [BIN1, { field: { meta: 'split' } }] },
    { name: 'Empty', conditions: [{ nonsense: true }] },
  ] }));
  assert.equal(some.filters.length, 1);
  assert.equal(some.filters[0].conditions.length, 1);
  assert.ok(some.warnings.some(w => /Mixed/.test(w)) && some.warnings.some(w => /Empty/.test(w)));
  assert.match(readFiltersFile('not json').error, /Not valid JSON/);
  assert.match(readFiltersFile('{"format":"wafermap-plots","plots":[]}').error, /not a filters file/);
  assert.match(readFiltersFile(JSON.stringify([{ conditions: [{ nope: 1 }] }])).error, /No filter in the file could be read/);
});

test('a file from a newer version is read with a warning', () => {
  const read = readFiltersFile(JSON.stringify({ format: FILTERS_FORMAT, version: 9, filters: [{ name: 'A', conditions: [BIN1], future: 1 }] }));
  assert.equal(read.filters.length, 1);
  assert.equal(read.filters[0].future, 1, 'a setting this version does not know is kept');
  assert.ok(read.warnings.some(w => /newer version/.test(w)));
});

test('an import never replaces: an id already in use is added as a copy', () => {
  const have = [{ id: 'a', name: 'One', conditions: [BIN1] }];
  const r = addSavedFilters(have, [{ id: 'a', name: 'One again', conditions: [BIN1] }, { id: 'b', name: 'Two', conditions: [BIN1] }]);
  assert.equal(r.filters.length, 3);
  assert.deepEqual(r.copies, ['One again']);
  assert.equal(new Set(r.filters.map(f => f.id)).size, 3);
});

// ── the Filter window ─────────────────────────────────────────────────────────────────────────────────────

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

test('the host\'s saved filters are listed, and one naming a field the lot lacks says so', async () => {
  const { root, g } = mount({ savedFilters: [
    { id: 'a', name: 'Bin 1 only', conditions: [BIN1] },
    { id: 'b', name: 'Needs a test', conditions: [{ field: { test: 999 }, min: 1 }] },
  ] });
  const modal = await openEditor(root);
  const rows = [...modal.querySelectorAll('[data-wmap-saved-filter]')];
  assert.equal(rows.length, 2);
  assert.match(rows[0].textContent, /Bin 1 only/);
  assert.equal(rows[0].querySelector('[data-wmap-saved-filter-issue]'), null);
  assert.ok(rows[1].querySelector('[data-wmap-saved-filter-issue]'), 'the unusable one is said, not hidden');
  closeEditor();
  g.destroy();
});

test('Load puts the conditions in the editor without applying; Apply then filters', async () => {
  const { root, g } = mount({ savedFilters: [{ id: 'a', name: 'Split A', conditions: [{ field: { meta: 'split' }, values: ['A'] }] }] });
  const modal = await openEditor(root);
  modal.querySelector('[data-wmap-saved-filter-load]').click();
  assert.match(modal.querySelector('[data-wmap-insights-filter-preview]').textContent, /Keeps 1 of 2 wafers/);
  assert.equal(root.querySelector('[data-wmap-insights-filter]')?.style.display ?? 'none', 'none', 'nothing is applied yet');
  modal.querySelector('[data-wmap-insights-filter-apply]').click();
  await tick();
  assert.match(root.querySelector('[data-wmap-insights-filter]').textContent, /1 of 2 wafers/);
  g.destroy();
});

test('Save keeps the draft under a name, tells the host, and saving the same name updates it', async () => {
  const { root, g, saved } = mount({ savedFilters: [{ id: 'a', name: 'Split A', conditions: [{ field: { meta: 'split' }, values: ['A'] }] }] });
  const modal = await openEditor(root);
  modal.querySelector('[data-wmap-saved-filter-load]').click();
  const name = modal.querySelector('[data-wmap-saved-filter-name]');
  name.value = 'Mine';
  modal.querySelector('[data-wmap-saved-filter-save]').click();
  assert.equal(saved.at(-1).length, 2);
  assert.equal(saved.at(-1)[1].name, 'Mine');
  name.value = 'Mine';
  modal.querySelector('[data-wmap-saved-filter-save]').click();
  assert.equal(saved.at(-1).length, 2, 'the same name updates, it does not add');
  modal.querySelectorAll('[data-wmap-saved-filter-delete]')[1].click();
  assert.deepEqual(saved.at(-1).map(f => f.name), ['Split A']);
  closeEditor();
  g.destroy();
});

test('Save with nothing to save, or no name, says so and saves nothing', async () => {
  const { root, g, saved } = mount();
  const modal = await openEditor(root);
  modal.querySelector('[data-wmap-saved-filter-save]').click();
  assert.match(modal.querySelector('[data-wmap-saved-filters-status]').textContent, /nothing to save/);
  assert.equal(saved.length, 0);
  closeEditor();
  g.destroy();
});

test('Export writes the file through the host; Import adds the filters from the host\'s picker', async () => {
  const text = writeFiltersFile([{ id: 'z', name: 'From a file', conditions: [BIN1] }, { id: 'a', name: 'Clash', conditions: [BIN1] }]);
  const { root, g, saved, saves } = mount({ pick: async () => text, savedFilters: [{ id: 'a', name: 'Existing', conditions: [BIN1] }] });
  const modal = await openEditor(root);
  modal.querySelector('[data-wmap-saved-filter-export]').click();
  assert.equal(saves.at(-1).name, 'wafermap-filters.json');
  assert.equal(readFiltersFile(saves.at(-1).text).filters.length, 1);
  modal.querySelector('[data-wmap-saved-filter-import]').click();
  await tick();
  assert.equal(saved.at(-1).length, 3);
  assert.match(modal.querySelector('[data-wmap-saved-filters-status]').textContent, /Imported 2.*Kept as copies.*Clash/s);
  assert.equal(modal.querySelectorAll('[data-wmap-saved-filter]').length, 3);
  closeEditor();
  g.destroy();
});
