// A sweep as a plot (chart 'sweep'): how it is read from a plots file and from the older sweeps file, what survives a
// round trip, and the text its lists are typed as in the editor. The DOM side (the card, the editor, the menu) is in
// plotBuilder.test.mjs.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  readPlotsFile, writePlotsFile, plotIssue, sweepToPlot, plotToSweep, PLOTS_FORMAT, PLOTS_VERSION, SWEEPS_FORMAT,
} from '../dist/packages/stats/plotSpec.js';
import { defaultSweep } from '../dist/packages/stats/plotData.js';
import { parseTestList, parseNumberList, formatTestList } from '../dist/packages/stats/sweepText.js';

const SWEEP = {
  id: 'power', title: 'Power Sweep',
  series: [
    { label: 'Rising', tests: [1010, 1011, '1020..1022'], xValues: [0, 5, 10, 15, 20] },
    { label: 'Falling', tests: [1030, 1031], xFromName: 'P_{x}' },
  ],
  xLabel: 'Power', xUnit: 'dBm', xScale: 'linear', crossing: true, separationAt: [1.2],
};

test('a sweep becomes a plot with its id and title on the envelope, and back', () => {
  const plot = sweepToPlot(SWEEP);
  assert.equal(plot.chart, 'sweep');
  assert.equal(plot.id, 'power');
  assert.equal(plot.title, 'Power Sweep');
  assert.ok(!('title' in plot.sweep) && !('id' in plot.sweep), 'the payload does not repeat them');
  assert.deepEqual(plotToSweep(plot), SWEEP);
  assert.equal(plotToSweep({ id: 'x', chart: 'scatter', fields: {} }), undefined);
});

test('a sweep plot round-trips through the plots file, settings and all', () => {
  const plots = [sweepToPlot(SWEEP)];
  const back = readPlotsFile(writePlotsFile(plots));
  assert.equal(back.error, undefined);
  assert.deepEqual(back.warnings, []);
  assert.deepEqual(back.plots, plots);
});

test('a sweep plot is a chart this build knows, so it is drawn and not "needs a newer version"', () => {
  assert.equal(plotIssue(sweepToPlot(SWEEP)), undefined);
});

test('a sweeps file from before sweeps were plots is read as sweep plots', () => {
  const text = JSON.stringify({ format: SWEEPS_FORMAT, version: 1, sweeps: [SWEEP, { ...SWEEP, id: 'second', title: 'Two' }] });
  const r = readPlotsFile(text);
  assert.equal(r.error, undefined);
  assert.deepEqual(r.plots.map(p => [p.id, p.title, p.chart]), [['power', 'Power Sweep', 'sweep'], ['second', 'Two', 'sweep']]);
  assert.deepEqual(plotToSweep(r.plots[0]), SWEEP);
});

test('a sweeps file with no list is refused, and says so', () => {
  assert.match(readPlotsFile(JSON.stringify({ format: SWEEPS_FORMAT })).error, /no "sweeps" list/);
});

test('a bad series is named and left out; the rest of the sweep is kept', () => {
  const text = writePlotsFile([]).replace('[]', JSON.stringify([
    { id: 's', title: 'Mixed', chart: 'sweep', sweep: { series: [
      { label: 'Good', tests: [1, 2] },
      { label: 'Bad', tests: ['not a test'] },
      { label: 'Spaced', tests: [3], xValues: [1, 'two'] },
    ], xScale: 'sideways' } },
  ]));
  const r = readPlotsFile(text);
  assert.equal(r.error, undefined);
  const sw = r.plots[0].sweep;
  assert.deepEqual(sw.series.map(s => s.label), ['Good', 'Spaced']);
  assert.ok(!('xValues' in sw.series[1]), 'a wrong X list is dropped, not guessed');
  assert.ok(!('xScale' in sw));
  assert.ok(r.warnings.some(w => /series 2.*skipped/.test(w)), r.warnings.join('|'));
  assert.ok(r.warnings.some(w => /xValues/.test(w)));
  assert.ok(r.warnings.some(w => /xScale/.test(w)));
});

test('settings this build does not know are kept on a sweep, so an older build does not strip them', () => {
  const plot = { id: 'k', chart: 'sweep', sweep: { series: [{ label: 'A', tests: [1], futureThing: 7 }], futureSetting: 'x' }, futurePlotKey: true };
  const back = readPlotsFile(writePlotsFile([plot])).plots[0];
  assert.equal(back.futurePlotKey, true);
  assert.equal(back.sweep.futureSetting, 'x');
  assert.equal(back.sweep.series[0].futureThing, 7);
});

test('a sweep with no definition is kept empty, with a warning, not dropped', () => {
  const r = readPlotsFile(JSON.stringify({ format: PLOTS_FORMAT, version: PLOTS_VERSION, plots: [{ id: 'e', chart: 'sweep' }] }));
  assert.deepEqual(r.plots[0].sweep, { series: [] });
  assert.ok(r.warnings.length > 0);
});

test('a new sweep starts on the lot\'s first parametric tests in test order, with no X scale claimed', () => {
  const defs = [{ testNumber: 30, name: 'c' }, { testNumber: 10, name: 'a' }, { testNumber: 20, name: 'f', testType: 'F' }, { testNumber: 40, name: 'd' }];
  const p = defaultSweep(defs, 'new');
  assert.equal(p.chart, 'sweep');
  assert.deepEqual(p.sweep.series, [{ label: 'Series 1', tests: [10, 30, 40], testNames: { 10: 'a', 30: 'c', 40: 'd' } }], 'functional tests have no value to sweep; the names are recorded to tell another program apart');
});

test('tests are typed as numbers and ranges, separated by commas or spaces', () => {
  assert.deepEqual(parseTestList('1010, 1011 1020..1030, 5 .. 7').value, [1010, 1011, '1020..1030', '5..7']);
  assert.deepEqual(parseTestList('').value, []);
  assert.equal(formatTestList([1010, '1020..1030']), '1010, 1020..1030');
});

test('text that is not a test number is named, never skipped', () => {
  assert.match(parseTestList('1010, abc').error, /"abc" is not a test number/);
  assert.match(parseTestList('1.5').error, /"1.5"/);
  assert.match(parseTestList('30..10').error, /runs backwards/);
});

test('swept values are numbers, negative and fractional included', () => {
  assert.deepEqual(parseNumberList('-10, 0.5  20').value, [-10, 0.5, 20]);
  assert.match(parseNumberList('1, x').error, /"x" is not a number/);
});
