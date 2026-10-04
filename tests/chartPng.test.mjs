// A chart saved as a PNG carries its title, what it shows and its colour key; a printed page does not carry the
// controls that act on the screen.

import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><head></head><body><div id="root"></div></body></html>', { pretendToBeVisual: true, url: 'http://localhost/' });
for (const k of ['window', 'document', 'HTMLElement', 'HTMLCanvasElement', 'HTMLDivElement', 'HTMLButtonElement', 'Node', 'Event', 'MouseEvent', 'DOMRect']) {
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

/** Every 2d context records what was drawn on it, by canvas. */
const drawn = new Map();
const noop = () => {};
const proto = dom.window.HTMLCanvasElement.prototype;
proto.getContext = function getContext() {
  if (!drawn.has(this)) {
    const log = { text: [], rects: [], dots: 0, images: [], fills: [] };
    const state = {};
    const entry = { log, state, ctx: null };
    drawn.set(this, entry);
    const ctx = new Proxy(state, {
      get: (t, p) => {
        if (p === 'measureText') return (s) => ({ width: String(s).length * 7 });
        if (p === 'fillText') return (s, x, y) => log.text.push({ s, x, y });
        if (p === 'fillRect') return (x, y, w, h) => log.rects.push({ x, y, w, h, fill: state.fillStyle });
        if (p === 'arc') return () => { log.dots++; };
        if (p === 'drawImage') return (img, x, y) => log.images.push({ img, x, y });
        if (p === 'createLinearGradient' || p === 'createRadialGradient') return () => ({ addColorStop: noop });
        if (p === 'getImageData') return () => ({ data: [] });
        if (p === 'canvas') return this;
        return p in t ? t[p] : noop;
      },
      set: (t, p, v) => { t[p] = v; if (p === 'fillStyle') log.fills.push(v); return true; },
    });
    entry.ctx = ctx;
    return ctx;
  }
  return drawn.get(this).ctx;
};
Object.defineProperty(proto, 'clientWidth', { configurable: true, get() { return 600; } });
Object.defineProperty(proto, 'clientHeight', { configurable: true, get() { return 400; } });

const { composeChartPng, cardShell, describeCard, captionText } = await import('../dist/packages/canvas-adapter/charts/chartShell.js');
const { buildWaferMap } = await import('../dist/index.js');
const { renderHistogramPanel } = await import('../dist/packages/canvas-adapter/charts/histogram.js');
const { renderScatterPanel } = await import('../dist/packages/canvas-adapter/charts/scatter.js');
const { renderBoxplotPanel } = await import('../dist/packages/canvas-adapter/charts/boxplot.js');
const { renderCorrelationPanel } = await import('../dist/packages/canvas-adapter/charts/correlation.js');
const { renderCapabilityPanel } = await import('../dist/packages/canvas-adapter/charts/capability.js');
const { markNoPrint } = await import('../dist/packages/canvas-adapter/toolbar.js');

function source(width = 1200, height = 800) {
  const c = document.createElement('canvas');
  c.width = width; c.height = height;
  return c;
}
const textOf = (flat) => drawn.get(flat).log.text.map(t => t.s);

test('with no header the image is the canvas on white, as before', () => {
  const c = source();
  const flat = composeChartPng(c);
  assert.equal(flat.width, 1200);
  assert.equal(flat.height, 800);
  assert.deepEqual(textOf(flat), []);
});

test('the title is drawn above the canvas, which moves down by the header\'s height', () => {
  const card = document.createElement('div');
  document.getElementById('root').appendChild(card);
  const c = source();
  const flat = composeChartPng(c, { card, title: 'Vth vs Idsat' });
  assert.deepEqual(textOf(flat), ['Vth vs Idsat']);
  assert.ok(flat.height > 800, 'the image is taller by the header');
  const img = drawn.get(flat).log.images[0];
  assert.equal(img.y, flat.height - 800, 'the chart sits directly under it');
  assert.equal(flat.width, 1200);
});

test('the caption wraps to the width, and the legend and colour bar are drawn', () => {
  const card = document.createElement('div');
  document.getElementById('root').appendChild(card);
  const long = Array.from({ length: 40 }, (_, i) => `word${i}`).join(' ');
  const flat = composeChartPng(source(), {
    card, title: 'T',
    decor: {
      caption: long,
      legend: [{ label: 'W01', color: '#0072B2' }, { label: 'W02', color: '#E69F00' }],
      colorbar: { label: 'Yield', lo: '80 %', hi: '93 %', color: t => `rgb(${Math.round(t * 255)},0,0)` },
    },
  });
  const t = textOf(flat);
  assert.ok(t.filter(s => s.startsWith('word')).length >= 2, 'a long caption is wrapped onto lines');
  assert.equal(t.filter(s => s.startsWith('word')).join(' '), long, 'and none of it is lost');
  assert.ok(t.includes('W01') && t.includes('W02'), 'the legend');
  assert.ok(t.includes('Yield') && t.includes('80 %') && t.includes('93 %'), 'the colour bar\'s name and range');
  assert.equal(drawn.get(flat).log.dots, 2, 'a dot per legend entry');
  assert.ok(drawn.get(flat).log.rects.filter(r => r.w === 1).length >= 200, 'a gradient strip');
});

test('the image takes the card\'s own background, so a dark theme saves a dark chart', () => {
  const card = document.createElement('div');
  card.style.background = 'rgb(20, 22, 30)';
  document.getElementById('root').appendChild(card);
  const flat = composeChartPng(source(), { card, title: 'T' });
  assert.equal(drawn.get(flat).log.fills[0], 'rgb(20, 22, 30)');
});

test('a high-density canvas scales the header with it', () => {
  const card = document.createElement('div');
  document.getElementById('root').appendChild(card);
  const one = composeChartPng(source(600, 400), { card, title: 'T' });
  const two = composeChartPng(source(1200, 800), { card, title: 'T' });
  assert.ok((two.height - 800) > (one.height - 400) * 1.5, 'twice the pixels per point, twice the header');
});

test('a card\'s Save as PNG saves under its title with the decor it supplies', () => {
  const blobs = [];
  proto.toBlob = function toBlob(cb) { blobs.push(this); cb(new dom.window.Blob(['x'])); };
  const saved = [];
  const shell = cardShell('Old', (blob, name) => saved.push(name), document);
  document.getElementById('root').appendChild(shell.card);
  shell.heading.textContent = 'Now named';
  shell.body.appendChild(source());
  shell.setPngDecor(() => ({ caption: '6 wafers · 3,966 dies' }));
  shell.card.querySelector('button[aria-label="Save as PNG"]').click();
  assert.deepEqual(saved, ['Now named.png'], 'the file is named for the title as it reads now');
  const flat = blobs.at(-1);
  assert.deepEqual(textOf(flat), ['Now named', '6 wafers · 3,966 dies']);
});

test('markNoPrint adds one print rule to the document, however many controls use it', () => {
  const a = document.createElement('button'), b = document.createElement('button');
  document.getElementById('root').append(a, b);
  markNoPrint(a); markNoPrint(b);
  assert.equal(a.hasAttribute('data-wmap-noprint'), true);
  const styles = [...document.head.querySelectorAll('#wmap-noprint-style')];
  assert.equal(styles.length, 1);
  assert.match(styles[0].textContent, /@media print\{\[data-wmap-noprint\]\{display:none!important\}\}/);
});

test('a chart card\'s own Save and Expand buttons are left off the page when printed', () => {
  const shell = cardShell('T', undefined, document);
  document.getElementById('root').appendChild(shell.card);
  for (const label of ['Save as PNG', 'Expand']) assert.ok(shell.card.querySelector(`button[aria-label="${label}"]`).hasAttribute('data-wmap-noprint'), label);
});

// ── what a card says around its canvas ──

const DEFS = [{ testNumber: 1050, name: 'Vth', unit: 'V', limitLow: 0.4, limitHigh: 0.6 }, { testNumber: 1060, name: 'Idsat', unit: 'A' }];
const panelItems = () => [0, 1, 2].map(i => ({
  ...buildWaferMap({
    results: Array.from({ length: 24 }, (_, k) => ({ x: k % 6, y: Math.floor(k / 6), hbin: k % 7 === 0 ? 2 : 1, testValues: { 1050: 0.4 + i / 10 + k / 1000, 1060: 0.001 + k / 1e5 } })),
    waferConfig: { diameter: 80, metadata: { lot: 'L', wafer: `W${i + 1}` } }, dieConfig: { width: 10, height: 10 }, passBins: [1], testDefs: DEFS,
  }),
  label: `W${i + 1}`, waferIndex: i,
}));
const mounted = (panel) => { document.getElementById('root').appendChild(panel.card); return panel.card; };

test('captionText drops the instructions to click or drag and keeps what the chart states', () => {
  assert.equal(
    captionText('One point per die across all wafers · coloured by hard bin · click legend to filter · click a point to open this wafer · drag to select dies · r = 0.93 · n = 3,966'),
    'One point per die across all wafers · coloured by hard bin · r = 0.93 · n = 3,966',
  );
  assert.equal(captionText('Pearson r · n ≈ 72 dies per pair · click a cell to view that pair in scatter ·'), 'Pearson r · n ≈ 72 dies per pair');
  assert.equal(captionText('Click to open this wafer'), '');
  assert.equal(captionText('box = Q1–Q3, line = median, whiskers = min/max · value shown is the median'), 'box = Q1–Q3, line = median, whiskers = min/max · value shown is the median');
});

test('a histogram\'s card names the test it is showing, and what its bars count', () => {
  const ctx = describeCard(mounted(renderHistogramPanel({ items: panelItems(), testDefs: DEFS })));
  assert.ok(ctx.controls.includes('Test: Vth'), ctx.controls.join(' | '));
  assert.ok(ctx.controls.includes('Wafer: All wafers'));
  assert.match(ctx.captions.join(' '), /dies\/bucket/);
});

test('a scatter\'s card names X and Y, and states its population without the instructions', () => {
  const ctx = describeCard(mounted(renderScatterPanel({ items: panelItems(), testDefs: DEFS, onOpen: () => {}, onSelect: () => {} })));
  assert.ok(ctx.controls.includes('X: Vth') && ctx.controls.includes('Y: Idsat'), ctx.controls.join(' | '));
  const text = ctx.captions.join(' ');
  assert.match(text, /One point per die across all wafers/);
  assert.doesNotMatch(text, /click|drag/i);
  assert.ok(ctx.legend.length >= 1 && ctx.legend.every(l => l.label && l.color), 'the bin legend');
});

test('a box plot and a correlation card carry their test and their reading key', () => {
  const box = describeCard(mounted(renderBoxplotPanel({ items: panelItems(), testDefs: DEFS })));
  assert.ok(box.controls.includes('Test: Vth'));
  assert.match(box.captions.join(' '), /box = Q1–Q3/);
  const corr = describeCard(mounted(renderCorrelationPanel({ items: panelItems(), testDefs: DEFS })));
  assert.match(corr.captions.join(' '), /Pearson r/);
  assert.doesNotMatch(corr.captions.join(' '), /click/i);
});

test('capability states its normalisation, which is its whole premise', () => {
  const ctx = describeCard(mounted(renderCapabilityPanel({ items: panelItems(), testDefs: DEFS })));
  assert.match(ctx.captions.join(' '), /Normalised to/);
});

test('a control that is not showing is not reported, and a checkbox only when ticked', () => {
  const card = mounted(renderHistogramPanel({ items: panelItems(), testDefs: DEFS }));
  const ctx = describeCard(card);
  assert.ok(!ctx.controls.some(c => /Clip outliers/.test(c)), 'unticked');
  const box = card.querySelector('[data-wmap-controls] input[type="checkbox"]');
  box.checked = true;
  assert.ok(describeCard(card).controls.some(c => c === box.closest('label').textContent.trim()), 'ticked');
});

test('a saved image carries the test the card is set to and its caption', () => {
  const blobs = [];
  proto.toBlob = function toBlob(cb) { blobs.push(this); cb(new dom.window.Blob(['x'])); };
  const card = mounted(renderHistogramPanel({ items: panelItems(), testDefs: DEFS, onSaveImage: () => {} }));
  card.querySelector('canvas').width = 600; card.querySelector('canvas').height = 300;
  card.querySelector('button[aria-label="Save as PNG"]').click();
  const text = textOf(blobs.at(-1));
  assert.ok(text.includes('Test: Vth · Wafer: All wafers') || text.some(t => t.startsWith('Test: Vth')), text.join(' | '));
  assert.ok(text.some(t => /dies\/bucket/.test(t)), 'the caption');
});

test('before printing, each card\'s print block is filled from its current settings, and the hints and controls are hidden', () => {
  const card = mounted(renderScatterPanel({ items: panelItems(), testDefs: DEFS, onOpen: () => {}, onSelect: () => {} }));
  const block = card.querySelector(':scope > [data-wmap-print-only]');
  assert.ok(block, 'a print block');
  assert.equal(block.style.display, 'none', 'not on screen');
  assert.equal(block.textContent, '', 'empty until printing');
  dom.window.dispatchEvent(new dom.window.Event('beforeprint'));
  assert.match(block.textContent, /X: Vth · Y: Idsat · Wafer: All wafers/);
  assert.match(block.textContent, /One point per die across all wafers/);
  assert.doesNotMatch(block.textContent, /click|drag/i);
  assert.ok(card.querySelector('[data-wmap-controls]').hasAttribute('data-wmap-noprint'), 'dropdowns do not print');
  assert.ok(card.querySelector('[data-wmap-caption]').hasAttribute('data-wmap-noprint'), 'the on-screen hint does not print');
  assert.match(document.head.textContent, /@media print\{\[data-wmap-print-only\]\{display:block!important\}\}/);
});

test('printing again after a change reads the new setting', () => {
  const card = mounted(renderHistogramPanel({ items: panelItems(), testDefs: DEFS }));
  dom.window.dispatchEvent(new dom.window.Event('beforeprint'));
  const block = card.querySelector(':scope > [data-wmap-print-only]');
  const before = block.textContent;
  const trigger = card.querySelector('[data-wmap-controls] button[aria-haspopup]');
  trigger.click();
  const options = [...document.querySelectorAll('[role="option"]')];
  options.find(o => o.textContent.startsWith('Idsat')).click();
  dom.window.dispatchEvent(new dom.window.Event('beforeprint'));
  assert.notEqual(block.textContent, before);
  assert.match(block.textContent, /Test: Idsat/);
});
