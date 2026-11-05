// "What stands out" compares groups of wafers on yield as well as on tests (packages/stats/synthesis.ts, groupShiftItems),
// on the demo lots whose group effects are known (docs/examples/data/generate-demos.js, pinned by demoGroups.test.mjs).
// The effects are set by what each story says, not by what the detector finds; a miss here is a gap in the detector.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { analyzeWaferLot, buildWaferMap } from '../dist/index.js';
import { buildSynthesis } from '../dist/packages/stats/synthesis.js';
import { pickExamples } from '../dist/packages/stats/examplePicks.js';
import { examplePlots, fieldCatalogue } from '../dist/packages/stats/plotData.js';

const DATA = join(dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'examples', 'data');
const FIELDS = ['tester', 'handler', 'probe_card', 'operator', 'test_program', 'test_date', 'split'];

function synthesisFull(name) {
  const meta = JSON.parse(readFileSync(join(DATA, `${name}.meta.json`), 'utf8'));
  const [head, ...lines] = readFileSync(join(DATA, `${name}.csv`), 'utf8').trim().split('\n');
  const cols = head.split(',');
  const at = (c) => cols.indexOf(c);
  const byWafer = new Map();
  for (const line of lines) {
    const v = line.split(',');
    if (!byWafer.has(v[1])) byWafer.set(v[1], { metadata: { lot: v[0], waferId: v[1], ...Object.fromEntries(FIELDS.filter(f => at(f) >= 0).map(f => [f, v[at(f)]])) }, results: [] });
    byWafer.get(v[1]).results.push({ x: +v[2], y: +v[3], hbin: +v[4], sbin: +v[5], testValues: { 1001: +v[at('iddq')], 1002: +v[at('vref')], 1003: +v[at('fmax')] } });
  }
  const maps = [...byWafer.values()].map(w => buildWaferMap({ ...meta, results: w.results, waferConfig: { ...meta.waferConfig, metadata: w.metadata } }));
  const attributes = Object.fromEntries(FIELDS.map(f => [f, { label: f }]));
  return buildSynthesis(analyzeWaferLot(maps), { passBins: [1], attributes });
}
const synthesisOf = (name) => { const s = synthesisFull(name); return [...s.items, ...(s.also?.items ?? [])]; };
const groupItems = (items) => items.filter(it => it.target.kind === 'group' || it.subject in { probe_card: 1, split: 1, tester: 1, operator: 1 });

test('edge-ring: a weak probe card and a heavier ring on one recipe are both found, each allowing for the other', () => {
  const items = synthesisOf('edge-ring');
  const card = items.find(it => it.subject === 'probe_card' && /^Yield is/.test(it.text));
  const split = items.find(it => it.subject === 'split' && /pass rate/.test(it.text));
  assert.ok(card, 'the card costs yield');
  assert.match(card.text, /higher on probe_card PC-A than on probe_card PC-B/);
  assert.match(card.text, /allowing for split/);
  assert.ok(split, 'the ring is heavier on one recipe');
  assert.match(split.text, /Ring 4 \(edge\) pass rate is .* higher on split Baseline than on split Recipe-2/);
  assert.equal(items.find(it => it.subject === 'operator'), undefined, 'the operator does nothing');
});

test('parametric: the corner moves tests and the weakest ring, wafer by wafer', () => {
  const items = synthesisOf('parametric');
  assert.ok(items.some(it => it.subject === 'split' && /tests differ by split/.test(it.text)));
  assert.ok(items.some(it => it.subject === 'split' && /Ring 4 \(edge\) pass rate is .* lower on split FF/.test(it.text)));
});

test('high-yield: fields vary and no group is reported', () => {
  assert.deepEqual(groupItems(synthesisOf('high-yield')).map(it => it.text), []);
});

test('a group item about yield has no map to show, so its target names the field', () => {
  const card = synthesisOf('edge-ring').find(it => it.subject === 'probe_card');
  assert.deepEqual(card.target, { kind: 'group', field: 'probe_card' });
  assert.deepEqual(card.testNumbers, []);
  assert.equal(card.chart.chart, 'bar');
});

test('cluster: heavier clusters on one tester are possible, not confirmed, and the tied handler is named', () => {
  // Four wafers against four cannot have an exact p under 0.014, so no correction over a few dozen comparisons confirms it.
  const s = synthesisFull('cluster');
  assert.equal([...s.items, ...(s.also?.items ?? [])].some(it => it.subject.includes('tester')), false, 'not confirmed');
  assert.equal(s.possible.length, 1);
  const [p] = s.possible;
  assert.equal(p.severity, 'info');
  assert.match(p.text, /^Possibly tester Tester-1 \(handler PRB-200 groups the same wafers\)/);
  assert.match(p.text, /Ring 1 \(core\) pass rate higher/);
  assert.match(p.text, /No wafer of the group overlaps the others/);
});

test('a group that is confirmed is not also listed as possible, and the clean lot lists nothing', () => {
  assert.equal(synthesisFull('edge-ring').possible, undefined);
  assert.equal(synthesisFull('high-yield').possible, undefined);
});

/** The lot as the Plot tab's items. */
function plotItems(name) {
  const meta = JSON.parse(readFileSync(join(DATA, `${name}.meta.json`), 'utf8'));
  const [head, ...lines] = readFileSync(join(DATA, `${name}.csv`), 'utf8').trim().split('\n');
  const cols = head.split(',');
  const at = (c) => cols.indexOf(c);
  const byWafer = new Map();
  for (const line of lines) {
    const v = line.split(',');
    if (!byWafer.has(v[1])) byWafer.set(v[1], { metadata: { lot: v[0], waferId: v[1], ...Object.fromEntries(FIELDS.filter(f => at(f) >= 0).map(f => [f, v[at(f)]])) }, results: [] });
    byWafer.get(v[1]).results.push({ x: +v[2], y: +v[3], hbin: +v[4], sbin: +v[5], testValues: { 1001: +v[at('iddq')], 1002: +v[at('vref')], 1003: +v[at('fmax')] } });
  }
  return [...byWafer.values()].map((w, i) => {
    const m = buildWaferMap({ ...meta, results: w.results, waferConfig: { ...meta.waferConfig, metadata: w.metadata } });
    return { label: w.metadata.waferId, dies: m.dies, waferIndex: i, metadata: w.metadata, passBins: [1], ringCount: 4, wafer: m.wafer };
  });
}

test('example plots: the fields that divide yield are offered, a tied handler beside its tester', () => {
  const picks = (name) => pickExamples(plotItems(name), [1001, 1002, 1003], FIELDS);
  assert.deepEqual(picks('edge-ring').yieldKeys, ['probe_card', 'split']);
  assert.deepEqual(picks('cluster').yieldKeys.slice(0, 2).sort(), ['handler', 'tester']);
  assert.equal(picks('high-yield').yieldKeys, undefined, 'a lot whose fields do nothing offers none');
});

test('example plots: a bar of yield for each field offered, beyond the one the split draws', () => {
  const items = plotItems('cluster');
  const catalogue = fieldCatalogue(items, {});
  const bars = examplePlots(catalogue, items.length, ((n) => () => `e${n++}`)(0), { items }).filter(p => p.chart === 'bar' && p.fields.y?.builtin === 'yield');
  const xs = bars.map(p => p.fields.x.meta);
  assert.ok(xs.includes('tester') && xs.includes('handler'), `bars by ${xs.join(', ')}`);
});
