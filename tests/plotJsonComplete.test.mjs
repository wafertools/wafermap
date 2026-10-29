// The suggestions for the plot editor's JSON text (canvas-adapter/plotJsonComplete.ts): where in the JSON the caret is,
// what it may be given there, and the range an accepted item replaces.

import test from 'node:test';
import assert from 'node:assert/strict';
import { completionsAt } from '../dist/packages/canvas-adapter/plotJsonComplete.js';
import { PLOT_CHARTS, PLOT_BUILTINS } from '../dist/packages/stats/plotSpec.js';

const source = {
  tests: [{ number: 1050, name: 'Vth' }, { number: 1060, name: 'Idsat' }],
  metaKeys: [{ key: 'processSplit', label: 'Process Split' }, { key: 'lot' }],
  describe: (setting, value) => (setting === 'chart' && value === 'box' ? 'Quartiles' : undefined),
};
/** Suggestions with the caret at `|`. */
const at = (marked, o) => {
  const caret = marked.indexOf('|');
  const text = marked.replace('|', '');
  return { text, c: completionsAt(text, caret, source, o) };
};
const labels = c => c?.items.map(i => i.label);
const apply = (text, c, i = 0) => text.slice(0, c.from) + c.items[i].insert + text.slice(c.to);

test('a chart type is offered inside the quotes of "chart", each with its line, sweep included', () => {
  const { c } = at('{ "chart": "|" }');
  assert.deepEqual(labels(c), [...PLOT_CHARTS]);
  assert.equal(c.items.find(i => i.label === 'box').detail, 'Quartiles');
});

test('typing narrows the list to the words that start with it, then the ones that contain it', () => {
  const { text, c } = at('{ "chart": "h|" }');
  assert.equal(labels(c)[0], 'histogram', 'a word that starts with it comes first');
  assert.ok(labels(c).includes('heatmap'));
  assert.ok(!labels(c).includes('line'), 'a word without an h is not offered');
  assert.equal(apply(text, c, labels(c).indexOf('heatmap')), '{ "chart": "heatmap" }');
});

test('nothing is offered once the word is complete', () => {
  assert.equal(at('{ "chart": "box|" }').c, undefined);
});

test('a key of the plot is offered, with its colon, and a key already written is not', () => {
  const { text, c } = at('{ "chart": "box", "n|" }');
  assert.deepEqual(labels(c).slice(0, 2), ['normalize', 'normalCurve'], 'the keys that start with it come first');
  assert.ok(labels(c).slice(2).every(k => k.toLowerCase().includes('n')), 'then the ones that contain it');
  assert.equal(apply(text, c), '{ "chart": "box", "normalize": }', 'with its colon, and no second space');
  assert.ok(!labels(at('{ "chart": "box", "|" }').c).includes('chart'));
});

test('a key that already has its colon after it is not given another', () => {
  const { text, c } = at('{ "n|": "zscore" }');
  assert.equal(apply(text, c), '{ "normalize": "zscore" }');
});

test('the settings with a few words offer them, the same words the reader accepts', () => {
  assert.deepEqual(labels(at('{ "aggregate": "|" }').c), ['mean', 'median', 'min', 'max', 'sum', 'count', 'yield']);
  assert.deepEqual(labels(at('{ "normalize": "|" }').c), ['limits', 'zscore', 'robust']);
  assert.deepEqual(labels(at('{ "level": "|" }').c), ['die', 'wafer']);
});

test('inside a field: its keys, a built-in field, a wafer field of the lot, and test numbers with their names', () => {
  assert.ok(labels(at('{ "fields": { "y": { "|" } } }').c).includes('test'));
  assert.ok(labels(at('{ "fields": { "color": { "|" } } }').c).includes('follow'));
  assert.ok(!labels(at('{ "fields": { "y": { "|" } } }').c).includes('follow'), 'follow is a colour only');
  assert.deepEqual(labels(at('{ "fields": { "x": { "builtin": "|" } } }').c), [...PLOT_BUILTINS]);
  const meta = at('{ "fields": { "x": { "meta": "|" } } }').c;
  assert.deepEqual(labels(meta), ['processSplit', 'lot']);
  assert.equal(meta.items[0].detail, 'Process Split');
  const t = at('{ "fields": { "y": { "test": 10| } } }');
  assert.deepEqual(t.c.items.map(i => [i.label, i.detail]), [['1050', 'Vth'], ['1060', 'Idsat']]);
  assert.equal(apply(t.text, t.c, 1), '{ "fields": { "y": { "test": 1060 } } }', 'a number is written without quotes');
});

test('the first level of a list of X fields is a field too', () => {
  assert.ok(labels(at('{ "fields": { "x": [ { "|" } ] } }').c).includes('builtin'));
});

test('the keys of fields, axes, a filter and the what-if limits', () => {
  assert.deepEqual(labels(at('{ "fields": { "|" } }').c), ['x', 'y', 'color', 'rows', 'facet']);
  assert.ok(labels(at('{ "axes": { "y": { "s|" } } }').c).includes('scale'));
  assert.deepEqual(labels(at('{ "axes": { "y": { "scale": "|" } } }').c), ['linear', 'log']);
  assert.ok(labels(at('{ "where": { "conditions": [ { "|" } ] } }').c).includes('values'));
  assert.deepEqual(labels(at('{ "whatIf": { "|" } }').c), ['lo', 'hi']);
});

test('Ctrl+Space where nothing is typed yet offers the keys or the values of that position, quoted', () => {
  const key = at('{ "chart": "box", | }', { force: true });
  assert.ok(labels(key.c).includes('aggregate'));
  assert.equal(apply(key.text, key.c, labels(key.c).indexOf('aggregate')), '{ "chart": "box", "aggregate": }', 'a key is quoted and given its colon');
  const value = at('{ "level": | }', { force: true });
  assert.equal(apply(value.text, value.c), '{ "level": "die" }');
  const bool = at('{ "valueLabels": | }', { force: true });
  assert.equal(apply(bool.text, bool.c), '{ "valueLabels": true }');
});

test('without Ctrl+Space nothing is offered where nothing has been typed, and none where it cannot help', () => {
  assert.equal(at('{ "chart": | }').c, undefined);
  assert.equal(at('{ "title": "|" }').c, undefined, 'a title is free text');
  assert.equal(at('{ "fields": { "y": { "test": "|" } } }').c, undefined, 'a test number is not written in quotes');
  assert.equal(at('{ "chart" |').c, undefined, 'after a key and before its colon');
  assert.equal(at('not json |', { force: true }).c, undefined);
  assert.equal(at('').c, undefined);
});

test('an unfinished string is replaced up to the caret, and a finished one to its closing quote', () => {
  const open = at('{ "chart": "hi|');
  assert.equal(apply(open.text, open.c), '{ "chart": "histogram"');
  const mid = at('{ "chart": "b|ox" }');
  assert.deepEqual(labels(mid.c).slice(0, 2), ['box', 'bar'], 'what is typed is what is before the caret');
  assert.equal(apply(mid.text, mid.c, 1), '{ "chart": "bar" }', 'the whole string, to its closing quote, is replaced');
  const wrong = at('{ "chart": "heat|map" }');
  assert.equal(apply(wrong.text, wrong.c), '{ "chart": "heatmap" }');
});

test('a value straight after a colon is given its space, and a key accepted before a space does not double it', () => {
  const v = at('{ "level":| }', { force: true });
  assert.equal(apply(v.text, v.c), '{ "level": "die" }');
  const k = at('{ "|" }');
  assert.equal(apply(k.text, k.c), '{ "chart": }');
});

test('a list of tests offers the lot\'s test numbers', () => {
  const { text, c } = at('{ "fields": { "y": { "tests": [ 10| ] } } }');
  assert.deepEqual(labels(c), ['1050', '1060']);
  assert.equal(apply(text, c, 1), '{ "fields": { "y": { "tests": [ 1060 ] } } }');
});

test('a sweep\'s own keys and values: its settings, a series\' keys, the scale and the crossing mark', () => {
  assert.ok(labels(at('{ "chart": "sweep", "|" }').c).includes('sweep'));
  assert.deepEqual(labels(at('{ "sweep": { "|" } }').c), ['series', 'xLabel', 'xUnit', 'yLabel', 'xScale', 'crossing', 'separationAt']);
  assert.deepEqual(labels(at('{ "sweep": { "series": [ { "|" } ] } }').c), ['label', 'tests', 'xValues', 'xFromName', 'testNames']);
  assert.deepEqual(labels(at('{ "sweep": { "xScale": "|" } }').c), ['linear', 'log']);
  const b = at('{ "sweep": { "crossing": | } }', { force: true });
  assert.deepEqual(labels(b.c), ['true', 'false']);
});
