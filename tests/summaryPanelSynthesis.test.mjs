// "What stands out", the first section of both Summary panels: the same synthesis the HTML
// reports open with. It is its own section, not a part of Findings, so that a clean wafer or lot
// says so, which a list of findings (absent when empty) cannot.

import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>');
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.HTMLDivElement = dom.window.HTMLDivElement;
globalThis.Node = dom.window.Node;

const { buildSynthesisSection, renderWaferSummaryContent: renderWaferSummaryContentRaw } =
  await import('../dist/packages/canvas-adapter/summaryPanel.js');
// These panels are built without a map, so each test states the pass bins it judges by.
const renderWaferSummaryContent = (panel, params) => renderWaferSummaryContentRaw(panel, { passBins: [1], ringCount: 4, ...params });

/** A lot of two wafers (5,000 analysed dies each) with region findings of known cost and dies. */
function lot(regions, extra = {}) {
  const findings = regions.map(({ name, dies, drop }, i) => ({
    id: `lot-region:yield|yield|||ring|ring:${i}`, level: 'lot', severity: 'info',
    variable: { kind: 'yield', label: 'Yield' },
    comparison: { family: 'ring', left: name, right: 'Rest of map' },
    effect: { direction: 'lower', absoluteDelta: -drop },
    stats: { method: 'stouffer-z', sampleSizeLeft: 2, sampleSizeRight: 0 },
    summary: `${name} yield is lower`,
    highlight: { kind: 'wafer', waferIndices: [0, 1], dieKeysByWafer: {
      0: Array.from({ length: dies / 2 }, (_, k) => `r${i}:${k}`), 1: Array.from({ length: dies / 2 }, (_, k) => `s${i}:${k}`) } },
  }));
  return {
    level: 'lot', hasNotableFindings: false, findings,
    lotYieldSeries: [{ waferIndex: 0, yieldPercent: 90 }, { waferIndex: 1, yieldPercent: 90 }],
    stats: { waferCount: 2 },
    perWafer: [0, 1].map(waferIndex => ({ waferIndex, summary: { stats: { analyzedDies: 5000, totalDies: 5000, testsConsidered: [], hardBinsConsidered: [] } } })),
    ...extra,
  };
}

test('a lot with nothing material says so, and still carries its headline and what was compared', () => {
  const section = buildSynthesisSection(lot([{ name: 'A', dies: 1000, drop: 0.05 }]), [1], {});
  const text = section.textContent;
  assert.match(text, /What stands out/);
  assert.match(text, /Yield 90\.0% \(mean of 2 wafers/);
  assert.match(text, /Nothing stands out/);
  assert.match(text, /Compared: /);
});

test('an item shows an impact meter with a word, and the figures of its sentence', () => {
  const section = buildSynthesisSection(lot([{ name: 'Ring 4 (edge)', dies: 1000, drop: 0.4 }]), [1], {});
  const text = section.textContent;
  assert.match(text, /High impact/);
  assert.match(text, /●●●/);
  assert.match(text, /Ring 4 \(edge\): pass rate 40\.0 points below the rest of the wafer/);
  assert.match(text, /about 400 dies lost/);
  assert.doesNotMatch(text, /Nothing stands out/);
});

test('every item is a row button that selects its finding, and the active one is marked', () => {
  const l = lot([{ name: 'Ring 4 (edge)', dies: 1000, drop: 0.4 }]);
  const clicked = [];
  const section = buildSynthesisSection(l, [1], { onFindingClick: (f, row) => clicked.push([f.id, row.tagName]), activeFindingId: l.findings[0].id });
  const row = section.querySelector(`button[data-wmap-finding="${l.findings[0].id}"]`);
  assert.ok(row, 'the item is a button for its finding');
  assert.match(row.textContent, /High impact.*Ring 4 \(edge\): pass rate 40\.0 points below/s);
  assert.ok(row.querySelector('svg'), 'it ends with the show-on-map mark');
  assert.equal(row.getAttribute('aria-current'), 'true');
  row.dispatchEvent(new dom.window.Event('click'));
  assert.deepEqual(clicked, [[l.findings[0].id, 'BUTTON']]);
});

test('without handlers nothing is a button, and no row claims to act', () => {
  const regions = Array.from({ length: 4 }, (_, i) => ({ name: `R${i}`, dies: 1000, drop: 0.3 - i * 0.03 }));
  const section = buildSynthesisSection(lot(regions), [1], {});
  assert.equal(section.querySelectorAll('button[data-wmap-finding], button[data-wmap-test]').length, 0);
  assert.equal(section.querySelectorAll('svg').length, 0, 'no show-on-map mark without an action');
});

test('a test item is a row that shows its test, and a bin chip carries its legend colour', () => {
  const l = lot([{ name: 'Ring 4 (edge)', dies: 1000, drop: 0.4 }]);
  l.findings.push({ ...l.findings[0], id: 'lot-region:hardBin|hardBin|2||ring|ring:0', variable: { kind: 'hardBin', bin: 2, label: 'HBin 2' },
    effect: { direction: 'higher', absoluteDelta: 0.4 } });
  l.stats.testSpecYield = [{ testNumber: 9, label: 'IDDQ', failLowDies: 0, failHighDies: 300, totalDies: 10000, passDies: 9700, yieldPercent: 97 }];
  const tests = [];
  const section = buildSynthesisSection(l, [1], {
    onFindingClick: () => {}, onTestClick: (n) => tests.push(n), activeTest: 9,
    binColors: { hard: new Map([[2, 'rgb(200, 0, 0)']]), soft: new Map(), shared: { hard: [], soft: [] } },
  });
  const row = section.querySelector('button[data-wmap-test="9"]');
  assert.ok(row, 'the test is a row');
  assert.equal(row.getAttribute('aria-current'), 'true');
  row.dispatchEvent(new dom.window.Event('click'));
  assert.deepEqual(tests, [9]);
  const chip = section.querySelector('button[data-wmap-finding="lot-region:hardBin|hardBin|2||ring|ring:0"]');
  assert.equal(chip.textContent, 'Hard bin 2');
  assert.equal(chip.querySelector('span').style.background, 'rgb(200, 0, 0)');
});

test('items beyond the top one are a compact list with their share of the dies', () => {
  const regions = Array.from({ length: 5 }, (_, i) => ({ name: `R${i}`, dies: 1000, drop: 0.3 - i * 0.03 }));
  const text = buildSynthesisSection(lot(regions), [1], {}).textContent;
  assert.match(text, /Also, each costing at least 1% of the dies/);
  assert.match(text, /R3: pass rate, [\d,]+ dies\d+\.\d%/);
  assert.doesNotMatch(text, /Also over a yield point/);
});

test('wafers judged by different pass bins: no bin is called a failure, and the headline names no bins', () => {
  const l = lot([{ name: 'A', dies: 1000, drop: 0.4 }]);
  // a hard-bin finding that would be a "failing bin" if the pass bins were assumed
  l.findings.push({
    id: 'lot-region:hardBin|hardBin|2||ring|ring:0', level: 'lot', severity: 'unusual',
    variable: { kind: 'hardBin', bin: 2, label: 'HBin 2' },
    comparison: { family: 'ring', left: 'A', right: 'Rest of map' },
    effect: { direction: 'higher', absoluteDelta: 0.4 },
    stats: { method: 'stouffer-z', sampleSizeLeft: 2, sampleSizeRight: 0 },
    summary: '', highlight: l.findings[0].highlight,
  });
  const text = buildSynthesisSection(l, undefined, {}).textContent;
  assert.doesNotMatch(text, /pass bin/, 'the headline names no pass bins');
  assert.doesNotMatch(text, /hard bin 2|accounts for/, 'no bin is attributed without known pass bins');
  assert.match(text, /A: pass rate 40\.0 points below/);
});

test('the wafer panel opens with What stands out, ahead of Findings', () => {
  const panel = document.createElement('div');
  const dies = [];
  for (let x = -3; x <= 3; x++) for (let y = -3; y <= 3; y++) dies.push({ x, y, testValues: {}, hbin: x > 1 ? 2 : 1 });
  const statsSummary = {
    level: 'wafer', hasNotableFindings: false, findings: [],
    stats: { totalDies: 49, analyzedDies: 49, yieldPercent: 80, testsConsidered: [], hardBinsConsidered: [1, 2] },
  };
  renderWaferSummaryContent(panel, {
    wafer: { diameter: 300, radius: 150, center: { x: 0, y: 0 }, orientation: 0 }, dies, statsSummary,
    passBins: [1], onFindingClick: () => {}, findingsFilter: {}, onFindingsFilterChange: () => {},
  });
  const text = panel.textContent;
  assert.match(text, /What stands out/);
  assert.match(text, /Yield 80\.0% \(49 dies; pass bin 1\)/);
  assert.match(text, /Nothing stands out/, 'a wafer with no findings is stated as clean');
});
