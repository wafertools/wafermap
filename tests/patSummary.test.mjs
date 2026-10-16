// What PAT finds, wafer by wafer and test by test (stats/patSummary.ts), and the Overview card that states it.

import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true, url: 'http://localhost/' });
for (const k of ['window', 'document', 'HTMLElement', 'Node', 'Event', 'MouseEvent', 'Blob', 'URL']) if (dom.window[k]) globalThis[k] = dom.window[k];
globalThis.window = dom.window; globalThis.document = dom.window.document;
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
globalThis.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
class FakeResizeObserver { observe() {} unobserve() {} disconnect() {} }
dom.window.ResizeObserver = FakeResizeObserver; globalThis.ResizeObserver = FakeResizeObserver;

const { buildWaferMap } = await import('../dist/index.js');
const { summarisePat } = await import('../dist/packages/stats/patSummary.js');
const { renderPatCard } = await import('../dist/packages/canvas-adapter/charts/patCard.js');

const DEFS = [{ testNumber: 1, name: 'Vth', unit: 'V', limitLow: 0, limitHigh: 10 }, { testNumber: 3, name: 'Free', unit: 'V' }];
/** 100 dies: Vth about 5, an outlier at 5.9 (die 90), one outside its limits (die 91), one in a failing bin (die 92). */
function wafer(label, outlier = true) {
  const results = Array.from({ length: 100 }, (_, k) => ({
    x: k % 10, y: Math.floor(k / 10), hbin: k === 92 ? 2 : 1,
    testValues: { 1: outlier && k === 90 ? 5.9 : outlier && k === 91 ? 11 : k === 92 ? 3 : 5 + ((k % 10) - 4.5) / 50, 3: k },
  }));
  const r = buildWaferMap({ results, waferConfig: { diameter: 30 }, dieConfig: { width: 2, height: 2 }, passBins: [1], testDefs: DEFS });
  return { label, dies: r.dies, passBins: [1] };
}

test('outliers pass every limit and bin, fails do not; the test behind an outlier is named', () => {
  const s = summarisePat([wafer('W1')], DEFS);
  assert.equal(s.tests, 1);
  assert.deepEqual(s.wafers[0], { label: 'W1', judged: 100, within: 97, outliers: 1, fails: 2 });
  assert.deepEqual(s.byTest, [{ testNumber: 1, name: 'Vth', outliers: 1 }]);
  assert.deepEqual(s.total, { judged: 100, within: 97, outliers: 1, fails: 2 });
});

test('a part of a wafer is counted against the limits of the whole', () => {
  const w = wafer('W1');
  const part = { ...w, dies: w.dies.slice(85, 100), allDies: w.dies };
  const s = summarisePat([part], DEFS);
  assert.equal(s.wafers[0].judged, 15);
  assert.equal(s.wafers[0].outliers, 1);
});

test('no test with both limits, or no wafer with enough passing dies, means no summary', () => {
  assert.equal(summarisePat([wafer('W1')], [DEFS[1]]), undefined);
  const small = { label: 'S', dies: wafer('S').dies.slice(0, 10), passBins: [1] };
  assert.equal(summarisePat([small], DEFS), undefined);
});

test('the card states the rule, the overall count and the wafers with most outliers first', () => {
  const card = renderPatCard({ items: [wafer('Clean', false), wafer('Dirty')], testDefs: DEFS, ownerDocument: document });
  const text = card.card.textContent;
  assert.match(text, /median ± 6 robust standard deviations/);
  assert.match(text, /1 outlier in 200 dies/);
  const rows = [...card.card.querySelectorAll('tbody tr')].map(r => r.firstChild.textContent);
  assert.deepEqual(rows.slice(0, 2), ['Dirty', 'Clean']);
  assert.match(text, /Where the outliers are outside/);
  assert.equal(renderPatCard({ items: [wafer('W')], testDefs: [DEFS[1]], ownerDocument: document }), undefined);
});

test('a lopsided test is named, a symmetric one is not, and the card says why symmetric limits fit it badly', () => {
  const skewed = (label) => {
    const results = Array.from({ length: 100 }, (_, k) => ({ x: k % 10, y: Math.floor(k / 10), hbin: 1, testValues: { 1: Math.exp((k / 100) * 2.2), 3: k } }));
    const r = buildWaferMap({ results, waferConfig: { diameter: 30 }, dieConfig: { width: 2, height: 2 }, passBins: [1], testDefs: DEFS });
    return { label, dies: r.dies, passBins: [1] };
  };
  const s = summarisePat([skewed('S1'), skewed('S2')], DEFS);
  assert.equal(s.skewed.length, 1);
  assert.deepEqual([s.skewed[0].name, s.skewed[0].wafers, s.skewed[0].of], ['Vth', 2, 2]);
  assert.ok(s.skewed[0].worst > 0.2, 'a long tail towards high values is positive');
  assert.deepEqual(summarisePat([wafer('Clean', false)], DEFS).skewed, [], 'a symmetric spread is not flagged');
  const text = renderPatCard({ items: [skewed('S1')], testDefs: DEFS, ownerDocument: document }).card.textContent;
  assert.match(text, /Lopsided distributions/);
  assert.match(text, /Vth1 of 1\+0\.\d\d/);
});

test('examples show where the PAT outliers are: dies at their positions, coloured by verdict', async () => {
  const { examplePlots, fieldCatalogue, resolvePlot } = await import('../dist/packages/stats/plotData.js');
  const w = { ...wafer('W1'), ringCount: 4 };
  const items = [w];
  const ctx = { testDefs: DEFS, passBins: [1] };
  const ex = examplePlots(fieldCatalogue(items, ctx), 1, () => 'x', { items, ctx });
  const where = ex.find(p => p.chart === 'scatter' && p.fields.color?.builtin === 'pat');
  assert.ok(where, 'a scatter of Die X and Die Y coloured by PAT');
  const r = resolvePlot(where, items, ctx);
  assert.deepEqual(r.issues, []);
  assert.deepEqual(r.groups, ['Within PAT limits', 'PAT outlier', 'Fails (bin or limits)']);
});

test('the PAT showcase lot has planted outliers on every wafer, more where they are grouped, and a lopsided test', async () => {
  const { readFileSync } = await import('node:fs');
  const text = readFileSync(new URL('../docs/data/showcase-pat-screen.csv', import.meta.url), 'utf8').trim().split('\n');
  const meta = JSON.parse(readFileSync(new URL('../docs/data/showcase-pat-screen.meta.json', import.meta.url), 'utf8'));
  const head = text[0].split(',');
  const byWafer = new Map();
  for (const line of text.slice(1)) {
    const c = Object.fromEntries(line.split(',').map((v, i) => [head[i], v]));
    if (!byWafer.has(c.WAFER_ID)) byWafer.set(c.WAFER_ID, []);
    byWafer.get(c.WAFER_ID).push({ x: +c.X, y: +c.Y, sbin: +c.SBIN, hbin: +c.SBIN, testValues: { 1: +c.VTH_V, 2: +c.IDDQ_UA, 3: +c.IDSAT_MA, 4: +c.TPD_NS } });
  }
  const items = [...byWafer].map(([label, results]) => {
    const r = buildWaferMap({ results, ...meta });
    return { label, dies: r.dies, passBins: [1] };
  });
  const s = summarisePat(items, meta.testDefs);
  assert.equal(s.wafers.length, 4);
  for (const w of s.wafers) assert.ok(w.outliers >= 3, `${w.label}: ${w.outliers} outliers`);
  const by = Object.fromEntries(s.wafers.map(w => [w.label, w.outliers]));
  assert.ok(by.P3 > 1.5 * Math.max(by.P1, by.P2, by.P4), `the grouped wafer stands out: ${JSON.stringify(by)}`);
  assert.ok(s.skewed.some(t => t.name === 'IDDQ_UA'), 'the log-normal Iddq is lopsided');
  assert.equal(s.skewed.some(t => t.name === 'VTH_V'), false);
});
