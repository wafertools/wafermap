// Out-of-spec ▽/△ marks have a floor size so they stay visible zoomed out. On a
// dense wafer (119k dies, ~1 px each in a card) that floor made every mark larger
// than its die: ~40k overlapping triangles that covered their neighbours and cost
// over a second per paint (tsmap example-data sensor_dense). Below
// MIN_MARKED_DIE_PX the marks are left off and the colorbar says "zoom in"
// instead of keying marks that are not drawn.
import test from 'node:test';
import assert from 'node:assert/strict';
import { setupDom as mountDom } from './fixtures/domHarness.mjs';
import { buildWaferMap } from '../dist/index.js';
import { renderWaferMap } from '../dist/packages/canvas-adapter/index.js';

function recorder(log) {
  return {
    scale() {}, fillRect() {}, strokeRect() {}, clearRect() {}, beginPath() {},
    moveTo() {}, lineTo() {}, closePath() { log.closePaths++; }, stroke() {}, fill() {}, save() {},
    restore() {}, drawImage() {}, arc() {}, arcTo() {}, rect() {},
    setLineDash() {}, strokeText() {}, clip() {}, translate() {}, setTransform() {},
    font: '', textAlign: 'left',
    measureText(t) { return { width: String(t).length * 6 }; },
    fillText(t) { log.texts.push(String(t)); },
  };
}

/** A round wafer `r` dies in radius; every third die above the high limit. */
function wafer(r) {
  const results = [];
  for (let x = -r; x <= r; x++) for (let y = -r; y <= r; y++) {
    if (x * x + y * y <= r * r) results.push({ x, y, hbin: 1, testValues: { 2: (x + y) % 3 === 0 ? 20 : 5 } });
  }
  return buildWaferMap({ results, testDefs: [{ testNumber: 2, name: 'vth', limitLow: 0, limitHigh: 10 }] });
}

function draw(r) {
  const log = { texts: [], closePaths: 0 };
  const dom = mountDom({ context: () => recorder(log), canvasSize: 400 });
  try {
    const host = dom.window.document.createElement('div');
    dom.root.appendChild(host);
    renderWaferMap(host, wafer(r), { viewOptions: { plotMode: 'value', activeTest: 2 }, showToolbar: false, height: 400 });
  } finally { dom.cleanup?.(); }
  return log;
}

test('out-of-spec marks: drawn and keyed on dies large enough to carry them', () => {
  const log = draw(6);
  assert.ok(!log.texts.some(t => t.includes('zoom in')), 'no zoom-in note');
  assert.ok(log.closePaths > 20, `a triangle per marked die (${log.closePaths} closePath calls)`);
});

test('out-of-spec marks: left off tiny dies, and the colorbar says so', () => {
  const log = draw(150);
  assert.ok(log.texts.some(t => t.includes('limit marks: zoom in')), 'the colorbar names the hidden marks');
  assert.ok(log.closePaths < 20, `no triangle per die (${log.closePaths} closePath calls)`);
});
