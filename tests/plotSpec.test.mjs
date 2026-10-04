// The plot builder's saved recipe and its file (stats/plotSpec.ts): reading is lenient and keeps what it does not
// understand, writing round-trips, importing never overwrites.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  readPlotsFile, writePlotsFile, addPlots, newPlotId, plotIssue, sameField, PLOTS_FORMAT, PLOTS_VERSION,
} from '../dist/packages/stats/plotSpec.js';

const scatter = (over = {}) => ({
  id: 'p1', mark: 'scatter', encoding: { x: { test: 1050, name: 'Vth' }, y: { test: 1060 } }, ...over,
});
const file = (plots, extra = {}) => JSON.stringify({ format: PLOTS_FORMAT, version: PLOTS_VERSION, plots, ...extra });

test('a written file reads back unchanged', () => {
  const plots = [
    scatter({ title: 'Vth vs Idsat', axes: { x: { scale: 'log', min: 1 }, y: { label: 'Idsat (A)', reverse: true } }, level: 'wafer', aggregate: 'median' }),
    { id: 'p2', mark: 'bar', encoding: { x: { meta: 'temperature' }, y: { builtin: 'yield' }, color: { none: true } }, aggregate: 'yield' },
    { id: 'p3', mark: 'histogram', encoding: { y: { test: 7 }, color: { follow: 'groupBy' } }, bins: 40 },
  ];
  const text = writePlotsFile(plots);
  const back = readPlotsFile(text);
  assert.equal(back.error, undefined);
  assert.deepEqual(back.warnings, []);
  assert.deepEqual(back.plots, plots);
  const wrapper = JSON.parse(text);
  assert.equal(wrapper.format, PLOTS_FORMAT);
  assert.equal(wrapper.version, PLOTS_VERSION);
});

test('a bare array of plots is accepted', () => {
  const r = readPlotsFile(JSON.stringify([scatter()]));
  assert.equal(r.plots.length, 1);
});

test('a file that is not a plots file is refused by name, not by shape', () => {
  assert.match(readPlotsFile('{"wafers": []}').error, /not a plots file/);
  assert.match(readPlotsFile('{"format":"tsmap-sweeps","sweeps":[]}').error, /not a plots file/);
  assert.match(readPlotsFile('42').error, /not a plots file/);
});

test('a syntax error is reported as one', () => {
  const r = readPlotsFile('{\n  "format": "wafermap-plots",\n  "plots": [ ,]\n}');
  assert.match(r.error, /Not valid JSON/);
});

test('every good plot is kept and each bad setting is named', () => {
  const r = readPlotsFile(file([
    scatter({ title: 'Good' }),
    scatter({ id: 'p2', title: 'Odd', level: 'galaxy', bins: 0, aggregate: 'mode', axes: { x: { scale: 'sqrt', min: 'low' } } }),
    { id: 'p3', encoding: {} },
    'nonsense',
  ]));
  assert.equal(r.error, undefined);
  assert.deepEqual(r.plots.map(p => p.id), ['p1', 'p2']);
  const odd = r.plots[1];
  assert.equal(odd.level, undefined);
  assert.equal(odd.bins, undefined);
  assert.equal(odd.aggregate, undefined);
  assert.equal(odd.axes.x.scale, undefined);
  assert.equal(odd.axes.x.min, undefined);
  const w = r.warnings.join('\n');
  assert.match(w, /"Odd"\.level/);
  assert.match(w, /"Odd"\.bins/);
  assert.match(w, /"Odd"\.aggregate/);
  assert.match(w, /axes\.x\.scale/);
  assert.match(w, /plot 3: no mark/);
  assert.match(w, /plot 4: not an object/);
});

test('a file with plots but none readable is an error', () => {
  const r = readPlotsFile(file([{ encoding: {} }, 5]));
  assert.match(r.error, /No plot in the file could be read/);
});

test('an empty list is a valid, empty file', () => {
  const r = readPlotsFile(file([]));
  assert.equal(r.error, undefined);
  assert.deepEqual(r.plots, []);
});

test('settings this version does not know survive a read and write', () => {
  const newer = scatter({ shiny: { a: 1 }, axes: { x: { scale: 'log', tickFormat: 'si' } }, encoding: { x: { test: 1 }, y: { test: 2 }, size: { test: 3 } } });
  const back = JSON.parse(writePlotsFile(readPlotsFile(file([newer], { version: PLOTS_VERSION + 1 })).plots)).plots[0];
  assert.deepEqual(back.shiny, { a: 1 });
  assert.equal(back.axes.x.tickFormat, 'si');
  assert.deepEqual(back.encoding.size, { test: 3 });
});

test('a newer file version is read with a warning', () => {
  const r = readPlotsFile(file([scatter()], { version: PLOTS_VERSION + 1 }));
  assert.equal(r.plots.length, 1);
  assert.match(r.warnings.join(), /newer version/);
});

test('a mark or a field kind from a newer version is kept and reported, not dropped', () => {
  const r = readPlotsFile(file([
    { id: 'a', mark: 'sweep', encoding: {}, sweep: { series: [] } },
    { id: 'b', mark: 'scatter', encoding: { x: { wavelet: 3 }, y: { test: 1 } } },
    { id: 'c', mark: 'scatter', encoding: { x: { builtin: 'reticleRow' }, y: { test: 1 } } },
    scatter({ id: 'd' }),
  ]));
  assert.deepEqual(r.plots.map(p => p.id), ['a', 'b', 'c', 'd']);
  assert.match(plotIssue(r.plots[0]), /newer version/);
  assert.match(plotIssue(r.plots[1]), /newer version/);
  assert.match(plotIssue(r.plots[2]), /newer version/);
  assert.equal(plotIssue(r.plots[3]), undefined);
  assert.deepEqual(r.plots[0].sweep, { series: [] });
});

test('colour: follow, none, a field, and a bad value', () => {
  const r = readPlotsFile(file([
    scatter({ id: 'a', encoding: { x: { test: 1 }, y: { test: 2 }, color: { follow: 'groupBy' } } }),
    scatter({ id: 'b', encoding: { x: { test: 1 }, y: { test: 2 }, color: { none: true } } }),
    scatter({ id: 'c', encoding: { x: { test: 1 }, y: { test: 2 }, color: { meta: 'split' } } }),
    scatter({ id: 'd', encoding: { x: { test: 1 }, y: { test: 2 }, color: { meta: '' } } }),
  ]));
  assert.deepEqual(r.plots[0].encoding.color, { follow: 'groupBy' });
  assert.deepEqual(r.plots[1].encoding.color, { none: true });
  assert.deepEqual(r.plots[2].encoding.color, { meta: 'split' });
  assert.equal(r.plots[3].encoding.color, undefined);
  assert.match(r.warnings.join(), /metadata key is empty/);
});

test('a test number must be a whole number', () => {
  const r = readPlotsFile(file([scatter({ encoding: { x: { test: 1.5 }, y: { test: '7' } } })]));
  assert.equal(r.plots[0].encoding.x, undefined);
  assert.equal(r.plots[0].encoding.y, undefined);
  assert.equal(r.warnings.length, 2);
});

test('a missing or repeated id is replaced; an empty title is dropped', () => {
  const r = readPlotsFile(file([scatter({ title: '  ' }), scatter(), { mark: 'histogram', encoding: { y: { test: 1 } } }]));
  assert.equal(r.plots.length, 3);
  assert.equal(new Set(r.plots.map(p => p.id)).size, 3);
  assert.equal(r.plots[0].title, undefined);
  assert.match(r.warnings.join(), /no id/);
});

test('importing adds plots as copies and never replaces one with the same id', () => {
  const mine = [scatter({ title: 'Mine', level: 'wafer' })];
  const theirs = [scatter({ title: 'Theirs' }), scatter({ id: 'other', title: 'New' })];
  const { plots, copies } = addPlots(mine, theirs);
  assert.equal(plots.length, 3);
  assert.deepEqual(plots[0], mine[0]);
  assert.deepEqual(copies, ['Theirs']);
  assert.equal(new Set(plots.map(p => p.id)).size, 3);
  assert.equal(plots.find(p => p.title === 'Theirs').mark, 'scatter');
});

test('generated ids are distinct', () => {
  assert.equal(new Set(Array.from({ length: 1000 }, newPlotId)).size, 1000);
});

test('sameField compares by kind and key', () => {
  assert.ok(sameField({ test: 1, name: 'a' }, { test: 1 }));
  assert.ok(!sameField({ test: 1 }, { test: 2 }));
  assert.ok(sameField({ meta: 'split' }, { meta: 'split' }));
  assert.ok(!sameField({ meta: 'split' }, { builtin: 'wafer' }));
  assert.ok(sameField(undefined, undefined));
  assert.ok(!sameField(undefined, { test: 1 }));
});
