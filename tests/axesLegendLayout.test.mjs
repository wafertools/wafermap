// With axes on, the tick labels and the legend share the canvas edges; they must not overlap, and a side legend
// must leave clear space before the wafer area.

import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { buildWaferMap } from '../dist/index.js';
import { withView } from './fixtures/withView.mjs';

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://localhost/' });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
const { drawMapCanvas, BIN_LEGEND_W, BIN_LEGEND_MAP_GAP } = await import('../dist/packages/canvas-adapter/toCanvas.js');

const SWATCH = 11;
/** A legend count shares its row with a swatch; an axis label never does. */
const notLegendRow = (swatches) => (t) => !swatches.some(s => Math.abs(t.y - (s.y + SWATCH / 2)) < 2);
const FONT_RE = /(\d+(?:\.\d+)?)px/;

/** Draws a 600x600 canvas and returns the swatch rectangles (legend) and the text boxes by font size. */
function draw(legendPosition) {
  const result = buildWaferMap({
    results: Array.from({ length: 100 }, (_, k) => ({ x: k % 10, y: Math.floor(k / 10), hbin: 1 + (k % 4) })),
    waferConfig: { diameter: 100 }, dieConfig: { width: 8, height: 8 }, passBins: [1],
  });
  const { view } = withView(result, { plotMode: 'hardBin' });
  const calls = { swatches: [], texts: [] };
  const ctx = new Proxy({ font: '12px sans-serif', textAlign: 'left' }, {
    get: (t, p) => {
      if (p in t) return t[p];
      if (p === 'measureText') return (s) => ({ width: String(s).length * 6 });
      if (p === 'fillRect') return (x, y, w, h) => { if (w === SWATCH && h === SWATCH) calls.swatches.push({ x, y, w, h }); };
      if (p === 'fillText') return (s, x, y) => {
        const w = String(s).length * 6, px = Number(FONT_RE.exec(t.font)?.[1] ?? 12);
        calls.texts.push({ s, px, x0: t.textAlign === 'right' ? x - w : t.textAlign === 'center' ? x - w / 2 : x, x1: t.textAlign === 'right' ? x : t.textAlign === 'center' ? x + w / 2 : x + w, y });
      };
      if (p === 'createLinearGradient' || p === 'createRadialGradient') return () => ({ addColorStop() {} });
      return () => {};
    },
    set: (t, p, v) => { t[p] = v; return true; },
  });
  const canvas = { clientWidth: 600, clientHeight: 600, width: 600, height: 600, ownerDocument: document, parentElement: document.getElementById('root'), getContext: () => ctx };
  drawMapCanvas(canvas, view, { showAxes: true, legendPosition, diePitchMm: { x: 8, y: 8 } });
  return calls;
}

test('a left legend leaves the y-axis labels clear of its swatches', () => {
  const { swatches, texts } = draw('left');
  assert.ok(swatches.length > 0);
  const legendRight = Math.max(...swatches.map(s => s.x + BIN_LEGEND_W));
  const axisTexts = texts.filter(t => /^-?\d+$/.test(t.s) && t.px < 12 && t.x1 < 300).filter(notLegendRow(swatches));
  assert.ok(axisTexts.length > 0);
  for (const t of axisTexts.filter(t => t.x0 < 300 && t.y < 560)) {
    assert.ok(t.x0 >= legendRight, `axis label "${t.s}" starts at ${t.x0}, inside the legend (right edge ${legendRight})`);
  }
});

test('a bottom legend leaves the x-axis labels above it', () => {
  const { swatches, texts } = draw('bottom');
  assert.ok(swatches.length > 0);
  const legendTop = Math.min(...swatches.map(s => s.y));
  const xLabels = texts.filter(t => /^-?\d+$/.test(t.s) && t.px < 12 && t.y > 300).filter(t => t.s !== '25');
  assert.ok(xLabels.length > 0);
  for (const t of xLabels) assert.ok(t.y + 7 <= legendTop, `x label "${t.s}" at y ${t.y} reaches the legend top ${legendTop}`);
});

test('a side legend keeps a gap to the wafer area', () => {
  assert.ok(BIN_LEGEND_MAP_GAP >= 8);
});

test('x-axis labels stay within the dies whichever way the legend sits', () => {
  // The grid is centred on 0 and 10 dies wide, so no label may name a column beyond +-6.
  for (const pos of ['bottom', 'top', 'default']) {
    const { texts, swatches } = draw(pos);
    const xLabels = texts.filter(t => /^-?\d+$/.test(t.s) && t.px < 12 && t.y > 300 && t.s !== '25')
      .filter(t => !swatches.some(s => Math.abs(t.y - (s.y + SWATCH / 2)) < 2 && t.x0 >= s.x));
    assert.ok(xLabels.length > 0, pos);
    for (const t of xLabels) assert.ok(Number(t.s) >= -6 && Number(t.s) <= 6, `${pos}: label "${t.s}" is beyond the dies`);
  }
});
