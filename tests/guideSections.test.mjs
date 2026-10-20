// "How to read this" links: the app cites a user-guide section by its title, never its number (the guide window shows
// none), and the title is a link that opens the guide at that section, or moves an open guide there, so the reader keeps
// the guide beside the app.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { setupDom } from './fixtures/domHarness.mjs';

setupDom({ canvasSize: { width: 600, height: 400 } });
window.open = () => null;   // the floating window, as in a desktop app's WebView
const scrolledTo = [];
window.HTMLElement.prototype.scrollIntoView = function () { scrolledTo.push(this.id); };

const { GUIDE_SECTIONS, guideCiteText } = await import('../dist/packages/stats/guideSections.js');
const { USER_GUIDE_HTML } = await import('../dist/packages/canvas-adapter/userGuideHtml.js');
const { guideCite, appendGuideCites } = await import('../dist/packages/canvas-adapter/charts/chartShell.js');
const { plotGuideSections } = await import('../dist/packages/stats/plotData.js');
const { registerGuideOpener } = await import('../dist/packages/canvas-adapter/guideWindow.js');
const flush = () => new Promise(resolve => setTimeout(resolve, 0));
// A guide just built scrolls once it has been laid out, two frames on.
const frames = () => new Promise(resolve => window.requestAnimationFrame(() => window.requestAnimationFrame(() => setTimeout(resolve, 0))));

test('every section the app cites is a heading of the guide, under that title', () => {
  for (const [key, s] of Object.entries(GUIDE_SECTIONS)) {
    const m = USER_GUIDE_HTML.match(new RegExp(`<h[2-4] id="${s.id}">([^<]*)<`));
    assert.ok(m, `${key}: no heading with the id ${s.id}`);
    assert.equal(m[1].replace(/^\s*\d+(?:\.\d+)*\.?\s+/, ''), s.title, `${key}: the heading's title`);
  }
});

test('no part of the app cites a guide section by number', () => {
  const files = [];
  const walk = d => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else if (p.endsWith('.js') && !p.endsWith('userGuideHtml.js')) files.push(p); } };
  walk('dist/packages');
  for (const f of files) assert.doesNotMatch(readFileSync(f, 'utf8'), /[Uu]ser guide, section \d/, f);
});

test('a cite names its section, a link on screen and plain text for an image or print', () => {
  const el = guideCite(document, GUIDE_SECTIONS.pat);
  assert.equal(el.textContent, 'How to read this: Part average testing (PAT) in the user guide');
  assert.equal(el.querySelector('button').dataset.wmapGuideLink, 'wmap-part-average-testing-pat');
  assert.equal(guideCiteText(GUIDE_SECTIONS.control), 'How to read this: “Control charts” in the user guide');
});

test('with no renderer mounted, a link opens the guide at its section; a second moves the open guide, not a new one', async () => {
  document.body.innerHTML = '';
  scrolledTo.length = 0;
  const link = s => { const el = guideCite(document, s); document.body.appendChild(el); return el.querySelector('button'); };
  link(GUIDE_SECTIONS.pat).click();
  await flush();
  await frames();
  const box = document.querySelector('.wmap-window-box');
  assert.ok(box, 'the guide window opened');
  assert.deepEqual(scrolledTo, ['wmap-part-average-testing-pat'], 'at the section');
  link(GUIDE_SECTIONS.control).click();
  await flush();
  assert.equal(document.querySelectorAll('.wmap-window-box').length, 1, 'still one guide window');
  assert.equal(document.querySelector('.wmap-window-box'), box, 'the same one, where the reader put it');
  assert.deepEqual(scrolledTo, ['wmap-part-average-testing-pat', 'wmap-control-charts'], 'moved to the next section');
});

test('a mounted renderer\'s opener is used, so the guide carries its host\'s extension; the latest mounted wins', () => {
  const got = [];
  const off1 = registerGuideOpener(s => got.push(['first', s]));
  const off2 = registerGuideOpener(s => got.push(['second', s]));
  guideCite(document, GUIDE_SECTIONS.groups).querySelector('button').click();
  off2();
  guideCite(document, GUIDE_SECTIONS.groups).querySelector('button').click();
  off1();
  assert.deepEqual(got, [['second', 'wmap-comparing-groups-of-wafers'], ['first', 'wmap-comparing-groups-of-wafers']]);
});

test('a plot links the sections for what it shows, and none when it shows nothing the guide explains', () => {
  // Only the parts of a resolved plot the choice reads.
  const plot = (chart, extra = {}, fields = {}) => ({ ...extra, spec: { id: 'p', chart, fields, ...(extra.spec ?? {}) } });
  const titles = r => plotGuideSections(r).map(s => s.title);
  assert.deepEqual(titles(plot('histogram', {}, { x: { test: 1 } })), [], 'a plain histogram');
  assert.deepEqual(titles(plot('scatter', { fitNotes: ['y = 2x + 1, R² 0.91, n 300'], marks: { type: 'scatter' } })), ['Fit lines, R² and y = x']);
  assert.deepEqual(titles(plot('scatter', { spec: { identity: true }, marks: { type: 'scatter' } })), ['Fit lines, R² and y = x'], 'the y = x line alone');
  assert.deepEqual(titles(plot('line', { marks: { type: 'line', band: { lo: [], hi: [] } } })), ['Bands on a line']);
  assert.deepEqual(titles(plot('line', { marks: { type: 'line' } })), [], 'a line without a band');
  assert.deepEqual(titles(plot('box', { comparison: { by: 'Split', result: {} } })), ['Comparing groups of wafers']);
  assert.deepEqual(titles(plot('box', { normalization: 'each test rescaled to its limits' })), ['Rescaling values']);
  assert.deepEqual(titles(plot('box', {}, { x: [{ test: 1 }, { binned: { builtin: 'radius' } }] })), ['Ranges, panels and what-if limits'], 'a number cut into ranges');
  assert.deepEqual(titles(plot('histogram', { whatIf: { sentence: '' } })), ['Ranges, panels and what-if limits']);
  assert.deepEqual(titles(plot('probability', { facets: [] })), ['The cumulative probability plot', 'Ranges, panels and what-if limits'], 'its chart type first');
});

test('a footnote with two sections links both, and says it once', () => {
  const el = document.createElement('div');
  el.textContent = '6 wafers · 300 dies';
  appendGuideCites(el, [GUIDE_SECTIONS.fit, GUIDE_SECTIONS.ranges]);
  assert.equal(el.textContent, '6 wafers · 300 dies · how to read this: Fit lines, R² and y = x and Ranges, panels and what-if limits in the user guide');
  assert.equal(el.querySelectorAll('[data-wmap-guide-link]').length, 2);
  const none = document.createElement('div');
  appendGuideCites(none, []);
  assert.equal(none.textContent, '');
});

test('the capability card links its section when it has a test with limits', async () => {
  const { buildWaferMap } = await import('../dist/index.js');
  const { renderCapabilityPanel } = await import('../dist/packages/canvas-adapter/charts/capability.js');
  const defs = [{ testNumber: 1, name: 'Vth', unit: 'V', limitLow: 0, limitHigh: 1 }];
  const r = buildWaferMap({ results: Array.from({ length: 12 }, (_, k) => ({ x: k % 4, y: Math.floor(k / 4), hbin: 1, testValues: { 1: 0.3 + k * 0.03 } })),
    waferConfig: { diameter: 80 }, dieConfig: { width: 10, height: 10 }, passBins: [1], testDefs: defs });
  const panel = renderCapabilityPanel({ items: [{ label: 'W1', dies: r.dies, waferIndex: 0, wafer: r.wafer, passBins: [1], ringCount: 4, testDefs: defs }], testDefs: defs, ownerDocument: document });
  document.body.replaceChildren(panel.card);
  assert.equal(panel.card.querySelector('[data-wmap-guide-link]')?.dataset.wmapGuideLink, 'wmap-capability-ppk-and-the-goal-plot');
  panel.destroy?.();
});
