// A scatter draws every colour as the same 2.5px dot at one strength, translucent as the dots shown are dense, with the
// rarer colours drawn last so they lie on top: narrowing the legend keeps the size, and the fewer dots left grow stronger.
import test from 'node:test';
import assert from 'node:assert/strict';
import { setupDom, makeCanvasContext } from './fixtures/domHarness.mjs';

const dots = [];
setupDom({
  canvasSize: { width: 600, height: 400 },
  context: () => {
    const ctx = makeCanvasContext();
    let r = 0;
    ctx.globalAlpha = 1;
    ctx.arc = (_x, _y, radius) => { r = radius; };
    ctx.fill = () => { if (r) dots.push({ r, alpha: ctx.globalAlpha, color: ctx.fillStyle }); r = 0; };
    return ctx;
  },
});

const { buildWaferMap } = await import('../dist/index.js');
const { resolvePlot } = await import('../dist/packages/stats/plotData.js');
const { renderPlotChart } = await import('../dist/packages/canvas-adapter/charts/plotChart.js');

const DEFS = [{ testNumber: 1, name: 'A' }, { testNumber: 2, name: 'B' }];
const map = buildWaferMap({
  results: Array.from({ length: 3600 }, (_, k) => ({ x: k % 60, y: Math.floor(k / 60), hbin: k % 20 === 0 ? 2 : 1, testValues: { 1: k % 97, 2: (k * 7) % 89 } })),
  waferConfig: { diameter: 900 }, dieConfig: { width: 10, height: 10 }, passBins: [1], testDefs: DEFS,
});
const items = [{ label: 'W1', dies: map.dies, waferIndex: 0, wafer: map.wafer, passBins: [1], ringCount: 4 }];

test('every colour is the same dot; narrowing the legend keeps its size, and the few dots left grow stronger', () => {
  const r = resolvePlot({ id: 's', chart: 'scatter', fields: { x: { test: 1 }, y: { test: 2 }, color: { builtin: 'hbin' } } }, items, { testDefs: DEFS });
  assert.deepEqual(r.issues, []);
  const chart = renderPlotChart({ ownerDocument: document, waferLabel: () => 'W1' });
  document.getElementById('root').replaceChildren(chart.card);
  const styles = () => { const set = [...new Set(dots.map(d => `${d.r}/${d.alpha}`))]; dots.length = 0; return set.map(t => t.split('/').map(Number)); };
  dots.length = 0;
  chart.setPlot(r);
  const both = dots.map(d => [d.r, d.alpha, d.color]);
  dots.length = 0;
  assert.ok(both.every(([radius]) => radius === 2.5), 'one dot size for both bins');
  assert.deepEqual([...new Set(both.map(([, a]) => a))], [0.15], 'one strength for both bins, whatever their counts');
  const rareColor = both.at(-1)[2];
  assert.ok(both.slice(-180).every(([, , c]) => c === rareColor), 'the rare bin, 180 dies, is drawn last, on top');
  assert.ok(both.slice(0, 3420).every(([, , c]) => c !== rareColor), 'after the 3,420 dies of the common bin');
  chart.setActiveGroups(new Set([1]));   // the rare bin alone
  assert.deepEqual(styles(), [[2.5, 0.7]], 'the same size, stronger alone');
  chart.destroy();
});
