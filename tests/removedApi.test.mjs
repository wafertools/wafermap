// API removed in 0.30.0, and input names removed in earlier releases.
//
// A removal is only half done while an untyped caller can still pass the old
// name and get silence: `data` in place of `results` used to build an empty map,
// and `values` in place of `testValues` a map with no test data, with nothing in
// `result.warnings` to say so. These tests hold both halves — the old names are
// gone from the published types, and passing one at runtime is reported.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildWaferMap, buildView } from '../dist/index.js';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dts = (rel) => fs.readFileSync(path.join(root, 'dist', rel), 'utf8');
const interfaceBody = (text, name) => {
  const m = new RegExp(`export interface ${name}\\b[^{]*\\{([\\s\\S]*?)\\n\\}`).exec(text);
  assert.ok(m, `interface ${name} not found`);
  return m[1].replace(/\/\*\*[\s\S]*?\*\//g, '');
};

const grid = () => Array.from({ length: 25 }, (_, i) => ({ x: i % 5, y: Math.floor(i / 5), hbin: i % 4 ? 1 : 2 }));

/** Build with console.warn captured, so the notice can be asserted and the log stays clean. */
function build(input) {
  const notices = [];
  const realWarn = console.warn;
  console.warn = (...args) => { notices.push(args.join(' ')); };
  try {
    const result = buildWaferMap(input);
    return { result, notices, removed: result.warnings.filter(w => w.code === 'input-field-removed') };
  } finally {
    console.warn = realWarn;
  }
}

// ── Removed input names are reported, never honoured and never silent ───────

test('input using only current names raises no removed-field warning', () => {
  const { removed, notices } = build({ results: grid(), dieConfig: { width: 5, height: 5 } });
  assert.deepEqual(removed, []);
  assert.ok(!notices.some(n => n.includes('ignored')), 'and logs nothing');
});

const CASES = [
  ['data',                 { data: grid() },                                                          '`data` (now `results`)'],
  ['die',                  { results: grid(), die: { width: 5, height: 5 } },                        '`die` (now `dieConfig`)'],
  ['stack',                { results: grid(), stack: { method: 'mean' } },                           '`stack` (now `lotStack`)'],
  ['values',               { results: grid().map((p, i) => ({ ...p, values: [i] })) },               '`values` (now `testValues`)'],
  ['values, array input',  grid().map((p, i) => ({ ...p, values: [i] })),                            '`values` (now `testValues`)'],
  ['values, in a lotStack', { lotStack: { method: 'mean', results: [grid(), grid().map(p => ({ ...p, values: [1] }))] } }, '`values` (now `testValues`)'],
  ['TestDef.index',        { results: grid(), testDefs: [{ index: 0, name: 'A' }] },                 '`TestDef.index` (now `TestDef.testNumber`)'],
  ['dieConfig.origin',     { results: grid(), dieConfig: { origin: 'LL' } },                         '`dieConfig.origin` (now `dieConfig.coordinateOrigin`)'],
  ['waferConfig.flat',     { results: grid(), waferConfig: { flat: { type: 'bottom' } } },           '`waferConfig.flat` (now `waferConfig.notch`)'],
  ['reticleConfig.anchor', { results: grid(), reticleConfig: { width: 2, height: 2, anchor: { x: 0, y: 0 } } }, '`reticleConfig.anchor` (now `reticleConfig.anchorDie`)'],
  ['lotStack.aggr',        { lotStack: { method: 'mean', aggr: 'mean', results: [grid(), grid()] } }, '`lotStack.aggr` (now `lotStack.method`)'],
];

for (const [label, input, named] of CASES) {
  test(`a removed input name is reported: ${label}`, () => {
    const { removed, notices } = build(input);
    assert.equal(removed.length, 1, 'one warning, however many names it covers');
    assert.equal(removed[0].severity, 'error', 'what the name described is missing from the map');
    assert.ok(removed[0].message.includes(named), `names it and its replacement: ${removed[0].message}`);
    assert.ok(notices.some(n => n.includes(named)), 'and says so on the console, for a caller not reading result.warnings');
  });
}

test('a TestDef that states testNumber is not flagged for also carrying index', () => {
  const { removed } = build({ results: grid(), testDefs: [{ testNumber: 7, index: 0, name: 'A' }] });
  assert.deepEqual(removed, []);
});

test('several removed names share one warning that lists each', () => {
  const { removed } = build({ data: grid(), die: { width: 5, height: 5 }, waferConfig: { flat: { type: 'top' } } });
  assert.equal(removed.length, 1);
  for (const name of ['`data`', '`die`', '`waferConfig.flat`']) assert.ok(removed[0].message.includes(name), name);
});

test('the removed-field warning is not honoured as a translation: data: still builds no dies', () => {
  const { result } = build({ data: grid() });
  assert.equal(result.dies.length, 0, 'reported, not quietly mapped onto results');
});

// ── Fields removed from the published types in 0.30.0 ───────────────────────

test('WaferMapResult.inference no longer carries the string warnings mirror', () => {
  const inference = /inference:\s*\{([\s\S]*?)\n\s{4}\};/.exec(interfaceBody(dts('packages/renderer/buildWaferMap.d.ts'), 'WaferMapResult'));
  assert.ok(inference, 'inference block found');
  assert.doesNotMatch(inference[1], /\bwarnings\??:/);

  const { result } = build({ results: grid().filter(p => p.x >= 2) });
  assert.ok(!('warnings' in result.inference), 'absent at runtime too');
  assert.ok(Array.isArray(result.warnings), 'result.warnings is the one channel');
});

test('View no longer carries colorBySpec — passFailDisplay is the one field', () => {
  assert.doesNotMatch(interfaceBody(dts('packages/renderer/buildView.d.ts'), 'View'), /\bcolorBySpec\??:/);
  const { result } = build({ results: grid() });
  const view = buildView(result.wafer, result.dies, { plotMode: 'hardBin' });
  assert.ok(!('colorBySpec' in view));
  assert.equal(view.passFailDisplay, 'off');
});

test("ToCanvasOptions no longer carries the interactive map's own draw state", () => {
  const body = interfaceBody(dts('packages/canvas-adapter/toCanvas.d.ts'), 'ToCanvasOptions');
  for (const name of ['activeBin', 'hoverBin', 'minRightReserve']) {
    assert.doesNotMatch(body, new RegExp(`\\b${name}\\??:`), `${name} is renderWaferMap's state, not a toCanvas option`);
  }
  for (const kept of ['viewport', 'legendOffset', 'colorbarWidth', 'legendPosition']) {
    assert.match(body, new RegExp(`\\b${kept}\\??:`), `${kept} still works for a direct caller and stays`);
  }
  const index = dts('packages/canvas-adapter/index.d.ts');
  assert.doesNotMatch(index, /\bdrawMapCanvas\b|\bMapCanvasOptions\b/, 'the internal draw entry is not exported');
});
