// Map-space strokes must keep their size in CSS pixels at every display scale.
//
// The map is drawn under setTransform(ppm·dpr, …), so a lineWidth divided by
// ppm·dpr is a fixed number of DEVICE pixels — it halved on a 2× display and
// thirded on a 3× one, turning the ring/quadrant dual-stroke into a faint
// hairline on exactly the high-DPI screens most users have (tsmap
// WMAP_ISSUES #55). The die outline is the one deliberate exception: a
// device-pixel hairline, so it does not grey out a dense map as dpr rises.
import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

import { buildWaferMap } from '../dist/index.js';
import { drawMapCanvas } from '../dist/packages/canvas-adapter/toCanvas.js';

/** Canvas stub recording each stroke's width in device pixels: lineWidth times
 *  the x-scale of the transform in force when stroke() is called. */
function makeRecordingContext(strokes) {
  let scaleX = 1;
  const ctx = {
    lineWidth: 1,
    strokeStyle: '',
    setTransform(a) { scaleX = a; },
    scale(sx) { scaleX *= sx; },
    stroke() { strokes.push({ style: String(ctx.strokeStyle), device: ctx.lineWidth * scaleX }); },
    measureText(text) { return { width: String(text).length * 6 }; },
  };
  let saved = [];
  ctx.save = () => { saved.push(scaleX); };
  ctx.restore = () => { scaleX = saved.pop() ?? 1; };
  return new Proxy(ctx, { get: (t, k) => (k in t ? t[k] : () => {}) });
}

function strokesAt(dpr) {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true });
  dom.window.devicePixelRatio = dpr;
  const canvas = dom.window.document.createElement('canvas');
  Object.defineProperty(canvas, 'clientWidth', { get: () => 400 });
  Object.defineProperty(canvas, 'clientHeight', { get: () => 400 });
  dom.window.document.body.appendChild(canvas);
  const strokes = [];
  const ctx = makeRecordingContext(strokes);
  canvas.getContext = () => ctx;

  const results = [];
  for (let x = -8; x <= 8; x++) for (let y = -8; y <= 8; y++) {
    if (Math.hypot(Math.abs(x) + 0.5, Math.abs(y) + 0.5) * 10 < 95) results.push({ x, y, hbin: 1 });
  }
  const map = buildWaferMap({ results, waferConfig: { diameter: 200 }, dieConfig: { width: 10, height: 10 } });
  drawMapCanvas(canvas, map.view);
  dom.window.close();
  return strokes;
}

test('map-space strokes scale with devicePixelRatio (CSS pixels), the die outline does not', () => {
  const byDpr = [1, 2, 3].map(dpr => ({ dpr, strokes: strokesAt(dpr) }));
  const dieOutline = s => s.style === 'rgba(0,0,0,0.18)';
  const boundary = s => s.style === '#888888';

  for (const { dpr, strokes } of byDpr) {
    const outline = strokes.find(dieOutline);
    const edge = strokes.find(boundary);
    assert.ok(outline, `die outline stroked at dpr ${dpr}`);
    assert.ok(edge, `wafer boundary stroked at dpr ${dpr}`);
    // Wafer boundary: lineWidth 1 → dpr device pixels, i.e. 1 CSS pixel.
    assert.ok(Math.abs(edge.device - dpr) < 1e-9, `wafer boundary is 1 CSS px at dpr ${dpr} (got ${edge.device} device px)`);
    // Die outline: 0.5 device pixels at every dpr.
    assert.ok(Math.abs(outline.device - 0.5) < 1e-9, `die outline stays 0.5 device px at dpr ${dpr} (got ${outline.device})`);
  }
});
