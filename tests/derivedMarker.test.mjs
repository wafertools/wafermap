// The derived-test marker: every surface that names a test must say when the
// value was computed from other tests rather than measured.
//
// The rules under test:
//  - the `†` goes in FRONT of the name wherever a test is named (tooltip, map
//    title, finding label and sentence, functional pass-rate label, pickers)
//  - the glyph never appears without its key: tooltips carry the words and the
//    expression, the map title adds a key line, lists and reports add a key line
//  - a surface with no derived test is unchanged — no key, no extra column
//  - the flag survives every place a test is re-described in a narrower shape
//    (finding variable, functional-yield row, lot pooling)
//  - a CSV states the derivation as a column, never as a bare glyph

import test from 'node:test';
import assert from 'node:assert/strict';
import { buildWaferMap } from '../dist/index.js';
import { buildView, buildMapTitle, buildHoverText } from '../dist/packages/renderer/buildView.js';
import { analyzeWaferMap } from '../dist/packages/stats/analyzeWaferMap.js';
import { poolFunctionalYield } from '../dist/packages/stats/testPassRate.js';
import { formatFindingTooltip, derivedFindingsKeyHtml } from '../dist/packages/stats/reportHtml.js';
import {
  markedTestLabel, unmarkedLabel, derivedKeyText, derivedCsvCell, derivedTestNote,
  DERIVED_MARK, DERIVED_KEY, DERIVED_LANE_PAD,
} from '../dist/packages/renderer/testLabel.js';
import { testOptionLabels } from '../dist/packages/canvas-adapter/charts/chartShell.js';
import { buildDataModeEntries } from '../dist/packages/canvas-adapter/toolbar.js';
import { buildCorrelationMatrix } from '../dist/packages/stats/correlation.js';

const TEST_DEFS = [
  { testNumber: 1010, name: 'Leak', unit: 'A' },
  { testNumber: 2000, name: 'Func A', testType: 'F' },
];
const DERIVED = [
  { testNumber: 900001, name: 'Leak x2', unit: 'A', expression: 't[1010] * 2' },
  { testNumber: 900002, name: 'Func OK', testType: 'F', expression: 'testPass[2000]' },
];

/** A seeded LCG, so the wafer is identical on every run. */
function rng(seed) {
  let s = seed;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

/**
 * One wafer whose outer ring is shifted on the measured test and fails the
 * functional one — a signal strong enough that analysis reports it, so the
 * derived tests derived from those inputs produce findings of their own.
 */
function build() {
  const r = rng(3);
  const results = [];
  for (let x = -8; x <= 8; x++) for (let y = -8; y <= 8; y++) {
    const rad = Math.hypot(x, y);
    if (rad > 8) continue;
    const edge = rad > 6;
    results.push({
      x, y, hbin: 1,
      testValues: { 1010: (edge ? 6 : 1) + 0.1 * r() },
      testPass:   { 2000: edge ? r() < 0.2 : r() < 0.97 },
    });
  }
  return buildWaferMap({
    results, testDefs: TEST_DEFS, derivedTests: DERIVED,
    dieConfig: { width: 10, height: 10 }, waferConfig: { diameter: 180 },
  });
}

const RESULT = build();
const defOf = (tn) => RESULT.testDefs.find(d => d.testNumber === tn);

// ── Shared helpers ────────────────────────────────────────────────────────────

test('the marker precedes the name, and only on a derived test', () => {
  assert.equal(markedTestLabel(defOf(900001), 900001), `${DERIVED_MARK} Leak x2`);
  assert.equal(markedTestLabel(defOf(1010), 1010), 'Leak');
  assert.equal(unmarkedLabel(markedTestLabel(defOf(900001), 900001)), 'Leak x2');
});

test('the key line names each derived test once, with its expression, and is absent otherwise', () => {
  const text = derivedKeyText([
    { label: `${DERIVED_MARK} Leak x2`, derived: true, expression: 't[1010] * 2' },
    { label: `${DERIVED_MARK} Leak x2`, derived: true, expression: 't[1010] * 2' },
    { label: 'Leak' },
  ]);
  assert.equal(text, `${DERIVED_MARK} ${DERIVED_KEY} — Leak x2: t[1010] * 2`);
  assert.equal(derivedKeyText([{ label: 'Leak' }]), undefined);
});

test('a CSV cell states the expression for a derived test and is blank for a measured one', () => {
  assert.equal(derivedCsvCell(defOf(900001)), 't[1010] * 2');
  assert.equal(derivedCsvCell({ derived: true }), DERIVED_KEY, 'never blank for a derived test — blank reads as measured');
  assert.equal(derivedCsvCell(defOf(1010)), '');
});

// ── Map tooltip and title ─────────────────────────────────────────────────────

test('the map tooltip marks a derived active test and explains it in words', () => {
  const die = RESULT.dies.find(d => d.testValues?.[900001] !== undefined);
  const html = buildHoverText(die, 'value', { testDefs: RESULT.testDefs, activeTest: 900001 });
  assert.match(html, new RegExp(`${DERIVED_MARK} Leak x2:`));
  assert.ok(html.includes(`${DERIVED_MARK} ${DERIVED_KEY}: t[1010] * 2`), html);
});

test('the map tooltip for a measured active test carries no marker', () => {
  const die = RESULT.dies.find(d => d.testValues?.[1010] !== undefined);
  const html = buildHoverText(die, 'value', { testDefs: RESULT.testDefs, activeTest: 1010 });
  assert.ok(!html.includes(DERIVED_MARK), html);
});

test('the map title marks the name in front, the unit after it, and adds the key as its own line', () => {
  const view = buildView(RESULT.wafer, RESULT.dies, { plotMode: 'value', testDefs: RESULT.testDefs, activeTest: 900001 });
  const title = buildMapTitle(view);
  assert.match(title.primary, new RegExp(`^${DERIVED_MARK} Leak x2 \\(`), 'marker in front of the name, unit after');
  assert.equal(title.note, `${DERIVED_MARK} ${DERIVED_KEY}`);
});

test('the map title of a measured test has no key line', () => {
  const view = buildView(RESULT.wafer, RESULT.dies, { plotMode: 'value', testDefs: RESULT.testDefs, activeTest: 1010 });
  assert.equal(buildMapTitle(view).note, undefined);
});

// ── Findings ──────────────────────────────────────────────────────────────────

// Test-value findings are opt-in; functional pass-rate findings are not.
const SUMMARY = analyzeWaferMap(RESULT, { enableTestValueAnalysis: true });

test('a finding about a derived test is marked in its label and sentence, and carries the flag', () => {
  const f = SUMMARY.findings.find(x => x.variable.kind === 'test' && x.variable.index === 900001);
  assert.ok(f, 'the outer-ring shift produces a finding on the derived test');
  assert.ok(f.variable.label.startsWith(`${DERIVED_MARK} `));
  assert.ok(f.summary.includes(`${DERIVED_MARK} Leak x2`), f.summary);
  assert.equal(f.variable.derived, true);
  assert.equal(f.variable.expression, 't[1010] * 2');
});

test('a finding about a measured test carries no marker and no flag', () => {
  const f = SUMMARY.findings.find(x => x.variable.kind === 'test' && x.variable.index === 1010);
  assert.ok(f);
  assert.ok(!f.summary.includes(DERIVED_MARK));
  assert.equal('derived' in f.variable, false);
});

test('a derived functional test is marked in its finding and its pass-rate row', () => {
  const f = SUMMARY.findings.find(x => x.variable.kind === 'functionalTest' && x.variable.index === 900002);
  assert.ok(f, 'the outer-ring failures produce a pass-rate finding on the derived verdict');
  assert.ok(f.variable.label.startsWith(`${DERIVED_MARK} Func OK`), f.variable.label);
  assert.equal(f.variable.derived, true);

  const row = SUMMARY.stats.functionalYield.find(r => r.testNumber === 900002);
  assert.equal(row.label, `${DERIVED_MARK} Func OK`);
  assert.equal(row.derived, true);
  assert.equal(row.expression, 'testPass[2000]');
});

test('pooling functional yield across wafers keeps the flag', () => {
  // The pooler rebuilds each row; a rebuilt row that forgets the flag is how a
  // derived verdict reaches the lot table looking measured.
  const pooled = poolFunctionalYield([SUMMARY, SUMMARY]);
  const row = pooled.find(r => r.testNumber === 900002);
  assert.equal(row.derived, true);
  assert.equal(row.expression, 'testPass[2000]');
  assert.equal(row.totalDies, 2 * SUMMARY.stats.functionalYield.find(r => r.testNumber === 900002).totalDies);
});

test('a finding tooltip adds the words and the expression on their own line', () => {
  const f = SUMMARY.findings.find(x => x.variable.index === 900001);
  assert.equal(formatFindingTooltip(f), `${f.summary}\n${derivedTestNote(f.variable)}`);
  const m = SUMMARY.findings.find(x => x.variable.index === 1010);
  assert.equal(formatFindingTooltip(m), m.summary, 'unchanged for a measured test');
});

test('the report key appears under a findings table only when a finding is about a derived test', () => {
  const html = derivedFindingsKeyHtml(SUMMARY.findings);
  assert.ok(html.includes(DERIVED_KEY) && html.includes('Leak x2: t[1010] * 2'), html);
  const measuredOnly = SUMMARY.findings.filter(f => !f.variable.derived);
  assert.equal(derivedFindingsKeyHtml(measuredOnly), '');
});

// ── Merged functional findings (a pre-existing bug, fixed alongside) ─────────

test('a functional finding merged across adjacent rings is recomputed as a pass rate', () => {
  // Until 0.30.3 the adjacent-region merge had no functional branch and fell
  // through to the bin one: it counted dies whose hard bin equalled
  // `variable.bin` (undefined), reported a 0.0 pp difference as "HBin undefined
  // occurrence", and REPLACED the correct per-ring findings it merged.
  const merged = SUMMARY.findings.filter(f =>
    f.variable.kind === 'functionalTest' && f.variable.index === 2000 && f.comparison.left.startsWith('Rings '));
  assert.ok(merged.length > 0, 'the inner rings merge into one finding');
  for (const f of merged) {
    assert.ok(!f.summary.includes('undefined'), f.summary);
    assert.match(f.summary, /Func A pass rate/);
    assert.match(f.summary, /^Rings \S+ have /, 'a merged region is plural');
    assert.ok(Math.abs(f.effect.absoluteDelta) > 0.2, `a real pass-rate gap, got ${f.effect.absoluteDelta}`);
    assert.equal(f.stats.method, 'two-proportion-z');
  }
});

// ── One findings table for every report ──────────────────────────────────────

test('the shared findings table uses plain bin terms and states when there are none', async () => {
  // Each report module used to keep its own copy; only the findings report
  // translated "HBin 2", so the wafer and lot reports printed the internal term.
  const { findingsTableHtml } = await import('../dist/packages/stats/reportHtml.js');
  const binFinding = {
    ...SUMMARY.findings[0],
    variable: { kind: 'hardBin', bin: 2, label: 'HBin 2' },
  };
  const html = findingsTableHtml([binFinding]);
  assert.ok(!html.includes('HBin 2'), 'no internal bin term in a report');
  assert.match(html, /hard bin 2/i);
  assert.match(findingsTableHtml([]), /No significant findings/);
});

test('the wafer report renders its findings through the shared table', async () => {
  const { renderWaferReportHtml } = await import('../dist/packages/stats/renderSummaryReport.js');
  const { findingsTableHtml } = await import('../dist/packages/stats/reportHtml.js');
  const { visibleFindings } = await import('../dist/packages/stats/filterFindings.js');
  const html = renderWaferReportHtml(RESULT, SUMMARY);
  assert.ok(html.includes(findingsTableHtml(visibleFindings(SUMMARY.findings))), 'the same table, byte for byte');
});

// ── Test pickers and lists: the mark in front, names aligned ─────────────────
// Where tests are chosen — the plot-mode menu, the Insights pickers, the
// correlation matrix — a derived test is marked like everywhere else, and a list
// holding one keeps measured names aligned with it.


test('picker labels put the mark in front and pad measured names only when a derived test is listed', () => {
  assert.deepEqual(testOptionLabels([defOf(1010), defOf(900001)]), [`${DERIVED_LANE_PAD}Leak`, `${DERIVED_MARK} Leak x2`]);
  assert.deepEqual(testOptionLabels([defOf(1010)]), ['Leak'], 'no derived test, no padding');
});

test('plot-mode test entries carry the derived flag and a plain label for the menu to mark', () => {
  const { testEntries } = buildDataModeEntries(RESULT.dies, RESULT.testDefs, { includeStacked: false });
  const derived = testEntries.find(e => e.activeTest === 900001);
  assert.equal(derived.derived, true);
  assert.equal(derived.label, 'Leak x2 (A)', 'the menu draws the mark in its own slot');
  assert.equal('derived' in testEntries.find(e => e.activeTest === 1010), false);
});

test('the correlation matrix marks a derived test on its axes and carries the flag', () => {
  const m = buildCorrelationMatrix(RESULT.dies, RESULT.testDefs);
  const t = m.tests.find(x => x.testNumber === 900001);
  assert.equal(t.label, `${DERIVED_MARK} Leak x2`);
  assert.equal(t.derived, true);
  assert.equal(m.tests.find(x => x.testNumber === 1010).label, 'Leak');
});
