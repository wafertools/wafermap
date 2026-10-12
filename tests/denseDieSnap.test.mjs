// A dense wafer drawn small (119k dies at ~1.5 device px each, tsmap example-data
// sensor_dense) showed light horizontal bands: a kerf and die edges a fraction of
// a pixel wide, anti-aliased, beat against the pixel grid. Below a one-pixel kerf
// the dies are drawn edge to edge, snapped to whole device pixels, without
// outlines; above it, as before.
import test from 'node:test';
import assert from 'node:assert/strict';
import { setupDom as mountDom } from './fixtures/domHarness.mjs';
import { buildWaferMap } from '../dist/index.js';
import { renderWaferMap } from '../dist/packages/canvas-adapter/index.js';

function recorder(log) {
  let transform = [1, 0, 0, 1, 0, 0];
  return {
    scale() {}, fillRect() {}, strokeRect() {}, clearRect() {}, beginPath() {},
    moveTo() {}, lineTo() {}, closePath() {}, stroke() { log.strokes++; }, fill() {}, save() {},
    restore() {}, drawImage() {}, arc() {}, arcTo() {}, setLineDash() {}, strokeText() {}, clip() {}, translate() {},
    setTransform(...m) { transform = m; },
    rect(x, y, w, h) { log.rects.push({ x, y, w, h, identity: transform[0] === 1 && transform[3] === 1 }); },
    font: '', textAlign: 'left', strokeStyle: '', lineWidth: 1,
    measureText(t) { return { width: String(t).length * 6 }; },
    fillText() {},
  };
}

function draw(r) {
  const log = { rects: [], strokes: 0 };
  const results = [];
  for (let x = -r; x <= r; x++) for (let y = -r; y <= r; y++) if (x * x + y * y <= r * r) results.push({ x, y, hbin: (x + y) % 5 ? 1 : 2 });
  const dom = mountDom({ context: () => recorder(log), canvasSize: 400 });
  try {
    const host = dom.window.document.createElement('div');
    dom.root.appendChild(host);
    renderWaferMap(host, buildWaferMap({ results }), { showToolbar: false, height: 400 });
  } finally { dom.cleanup?.(); }
  return { log, dies: results.length };
}

test('dense dies: snapped to whole device pixels, edge to edge, no outlines', () => {
  const { log, dies } = draw(150);
  const dieRects = log.rects.filter(r => r.identity);
  assert.ok(dieRects.length >= dies, `every die drawn in device space (${dieRects.length} of ${dies})`);
  assert.ok(dieRects.every(r => Number.isInteger(r.x) && Number.isInteger(r.y) && r.w >= 1 && r.h >= 1));
  // Two horizontal neighbours share their edge exactly: no seam, no overlap.
  const byRow = new Map();
  for (const r of dieRects) { const k = r.y; if (!byRow.has(k)) byRow.set(k, []); byRow.get(k).push(r); }
  const row = [...byRow.values()].sort((a, b) => b.length - a.length)[0].sort((a, b) => a.x - b.x);
  for (let i = 1; i < row.length; i++) {
    if (row[i].x - (row[i - 1].x + row[i - 1].w) > 0) assert.fail(`seam at x=${row[i].x}`);
  }
});

test('sparse dies: drawn with their kerf and outlines, as before', () => {
  const { log } = draw(8);
  assert.ok(!log.rects.some(r => r.identity && r.w > 4), 'no device-space die fills');
  assert.ok(log.strokes > 0, 'outlines stroked');
});
