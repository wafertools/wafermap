// The Findings section's own offer of a test-value analysis that did not run (`testValueNotice`):
// clicking Analyse re-runs the analysis and reports the new summary through `onStatsSummaryChange`.
// A run is applied only to the data it analysed, and a run that fails leaves the offer usable.

import test from 'node:test';
import assert from 'node:assert/strict';

import { buildWaferMap, analyzeWaferMap } from '../dist/index.js';
import { analyzeWaferLot } from '../dist/packages/stats/index.js';
import { renderWaferMap, renderWaferGallery } from '../dist/packages/canvas-adapter/index.js';
import { setupDom } from './fixtures/domHarness.mjs';

/** A small wafer with one parametric test, so there is a test-value analysis to offer. */
function wafer(label, shift = 0) {
  const built = buildWaferMap({
    results: Array.from({ length: 25 }, (_, i) => ({
      x: i % 5, y: Math.floor(i / 5), hbin: 1, testValues: { 100: 1 + shift + (i % 5) * 0.1 },
    })),
    waferConfig: { diameter: 60 },
    dieConfig: { width: 10, height: 10 },
    passBins: [1],
    testDefs: [{ testNumber: 100, name: 'Vt' }],
  });
  return { ...built, label };
}

const off = { enableTestValueAnalysis: false };
const analyseButton = (root) => [...root.querySelectorAll('button')].find(b => b.textContent === 'Analyse');
const settle = (ms = 200) => new Promise(r => setTimeout(r, ms));

test('single map: Analyse runs the test-value analysis and reports it', async () => {
  const { root, cleanup } = setupDom();
  try {
    const built = wafer('W01');
    const changes = [];
    renderWaferMap(root, built, {
      statsSummary: analyzeWaferMap(built, off),
      summaryPanel: { placement: 'right', defaultOpen: true },
      onStatsSummaryChange: (s) => changes.push(s),
    });
    analyseButton(root).click();
    await settle();
    assert.equal(changes.length, 1);
    assert.equal(changes[0].stats.testValueAnalysis.state, 'done');
    assert.equal(analyseButton(root), undefined, 'the offer is gone once the analysis ran');
  } finally {
    cleanup();
  }
});

test('single map: a run that throws leaves the offer usable', async () => {
  const { root, cleanup } = setupDom();
  try {
    const built = wafer('W01');
    const summary = analyzeWaferMap(built, off);
    // Reading the recorded options throws, so the re-run fails part-way.
    const failing = { ...summary, analysisOptions: { get sectorCount() { throw new Error('boom'); } } };
    const changes = [];
    renderWaferMap(root, built, {
      statsSummary: failing,
      summaryPanel: { placement: 'right', defaultOpen: true },
      onStatsSummaryChange: (s) => changes.push(s),
    });
    analyseButton(root).click();
    await settle();
    assert.equal(changes.length, 0);
    assert.ok(analyseButton(root), 'Analyse is offered again, not stuck on "Analysing test values…"');
  } finally {
    cleanup();
  }
});

test('single map: a run is dropped when the host replaces the data meanwhile', async () => {
  const { root, cleanup } = setupDom();
  try {
    const built = wafer('W01');
    const changes = [];
    const ctrl = renderWaferMap(root, built, {
      statsSummary: analyzeWaferMap(built, off),
      summaryPanel: { placement: 'right', defaultOpen: true },
      onStatsSummaryChange: (s) => changes.push(s),
    });
    analyseButton(root).click();
    ctrl.setResult(wafer('W02', 5));
    await settle();
    assert.equal(changes.length, 0, 'the summary of the replaced data is not reported');
  } finally {
    cleanup();
  }
});

test('gallery: new items cancel a lot run in progress', async () => {
  const { root, cleanup } = setupDom();
  try {
    const withSummary = (w) => ({ ...w, statsSummary: analyzeWaferMap(w, off) });
    const items = [withSummary(wafer('W01')), withSummary(wafer('W02', 1))];
    const changes = [];
    const ctrl = renderWaferGallery(root, items, {
      lotStatsSummary: analyzeWaferLot(items, off),
      summaryPanel: { defaultOpen: true },
      onStatsSummaryChange: (c) => changes.push(c),
    });
    await settle(50);
    analyseButton(root).click();
    const next = [withSummary(wafer('W03', 2)), withSummary(wafer('W04', 3))];
    ctrl.setItems(next);
    await settle(400);
    assert.equal(changes.length, 0, 'the old lot\'s summaries are not reported');
  } finally {
    cleanup();
  }
});

test('gallery: Analyse runs the lot\'s test-value analysis and reports it', async () => {
  const { root, cleanup } = setupDom();
  try {
    const withSummary = (w) => ({ ...w, statsSummary: analyzeWaferMap(w, off) });
    const items = [withSummary(wafer('W01')), withSummary(wafer('W02', 1))];
    const changes = [];
    renderWaferGallery(root, items, {
      lotStatsSummary: analyzeWaferLot(items, off),
      summaryPanel: { defaultOpen: true },
      onStatsSummaryChange: (c) => changes.push(c),
    });
    await settle(50);
    analyseButton(root).click();
    await settle(400);
    assert.equal(changes.length, 1);
    assert.equal(changes[0].summaries.length, 2);
    assert.equal(changes[0].lotStatsSummary.stats.testValueAnalysis.state, 'done');
  } finally {
    cleanup();
  }
});
