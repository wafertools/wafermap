// The colorbar's right-hand label band must be sized from the text actually
// drawn in it. It was a pair of constants (`labelGap = 20`, `colorbarWidth + 28`)
// tuned when COLORBAR_LABEL_FONT was a hardcoded 10px; once the font became
// themeable via fontPx() the labels grew past the band and the last glyph was
// shaved off at the canvas edge (reported against correlated.csv: the value
// legend labels were truncated on the right).
//
// This measures the closed loop rather than absolute pixel widths: the library
// sizes the band with the same `measureText` it later draws with, so whatever
// the stub reports for a glyph, the drawn label must still land inside the
// canvas. That holds under jsdom's synthetic metrics and under real ones.
import test from 'node:test';
import assert from 'node:assert/strict';
import { setupDom as mountDom } from './fixtures/domHarness.mjs';

import { buildWaferMap } from '../dist/index.js';
import { clipDiesToWafer } from '../dist/packages/core/transforms.js';
import { createWafer } from '../dist/packages/core/wafer.js';
import { generateDies } from '../dist/packages/core/dies.js';
import { renderWaferMap } from '../dist/packages/canvas-adapter/index.js';

/** Canvas stub recording every fillText with the metric the library would have
 *  measured for it, so a drawn label's right edge can be reconstructed. */
function makeRecordingContext(log) {
  const state = { font: '', textAlign: 'left' };
  const measure = (text) => String(text).length * 6;
  return {
    scale() {}, fillRect() {}, strokeRect() {}, clearRect() {}, beginPath() {},
    moveTo() {}, lineTo() {}, closePath() {}, stroke() {}, fill() {}, save() {},
    restore() {}, drawImage() {}, arc() {}, arcTo() {}, rect() {},
    setLineDash() {}, strokeText() {}, clip() {}, translate() {}, setTransform() {},
    set font(v) { state.font = v; },        get font() { return state.font; },
    set textAlign(v) { state.textAlign = v; }, get textAlign() { return state.textAlign; },
    measureText(text) { return { width: measure(text) }; },
    fillText(text, x) {
      log.texts.push({ text: String(text), x, w: measure(text), align: state.textAlign });
    },
  };
}

/** A wafer whose single test spans [vMin, vMax], so the colorbar tick labels
 *  take a known character width. */
function buildValueWafer(vMin, vMax) {
  const base = createWafer({ diameter: 200 });
  const dies = clipDiesToWafer(
    generateDies(base, { width: 5, height: 5, gridSize: 24 }), base, { width: 5, height: 5 })
    .filter(die => !die.partial)
    .map(die => ({
      ...die,
      testValues: { 2: vMin + (vMax - vMin) * ((Math.abs(die.x) + Math.abs(die.y)) / 40) } }));
  return buildWaferMap({ dies, waferConfig: { diameter: 200 }, passBins: [1] });
}

test('colorbar tick labels stay inside the canvas whatever their width', () => {
  const log = { texts: [] };
  const dom = mountDom({ context: () => makeRecordingContext(log), canvasSize: 600 });
  try {
    const cases = [
      ['two-digit decimals', 48.3, 77.0],
      ['three-digit values', 100, 980],
      ['four-digit values',  1000, 9800],
      ['negatives (minus sign widens intermediate ticks)', -12.5, -3.2],
      ['range spanning zero', -250, 1000],
      ['sub-unit values',     0.0000012, 0.0000098],
    ];

    let widestSeen = 0;
    for (const [label, vMin, vMax] of cases) {
      log.texts.length = 0;
      const host = dom.window.document.createElement('div');
      dom.root.appendChild(host);
      renderWaferMap(host, buildValueWafer(vMin, vMax), {
        viewOptions: { plotMode: 'value', activeTest: 2 },
        showToolbar: false, height: 560,
        testDefs: [{ number: 2, name: 'test_002' }] });

      const canvas = host.querySelector('canvas');
      const cssW = canvas.clientWidth;
      // The colorbar's tick labels are the left-aligned text in the right-hand band.
      const band = log.texts.filter(t => t.align === 'left' && t.x > cssW * 0.75);
      assert.ok(band.length >= 2, `${label}: expected colorbar tick labels, got ${band.length}`);

      for (const t of band) {
        widestSeen = Math.max(widestSeen, t.w);
        const right = t.x + t.w;
        assert.ok(right <= cssW,
          `${label}: label "${t.text}" ends at ${right.toFixed(1)} of ${cssW}px — clipped by ${(right - cssW).toFixed(1)}px`);
      }
    }

    // Guard against a vacuous pass: if every label were trivially narrow the
    // band would never be under pressure and the assertions would prove nothing.
    assert.ok(widestSeen >= 30,
      `fixture labels are too narrow (widest ${widestSeen}px) to exercise the band`);
  } finally {
    dom.cleanup();
  }
});
