// Summary-panel section behaviour: which bin type the breakdown follows, the
// pareto ordering, the merged region section, per-panel collapse/selector state,
// the trimmed test table, and the population labelling.
//
// Separate from summaryPanel.test.mjs (which covers the individual section
// builders and the CSV exports) because everything here is about how the panel
// as a whole composes and remembers those sections.

import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>');
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.HTMLDivElement = dom.window.HTMLDivElement;
globalThis.Node = dom.window.Node;

const {
  buildBinBreakdownSection, buildRegionYieldPanelSection, buildPerWaferYieldSection,
  buildTestSection, buildLotOverviewSection,
  renderWaferSummaryContent, renderLotSummaryContent,
} = await import('../dist/packages/canvas-adapter/summaryPanel.js');

function die(overrides) {
  return { x: 0, y: 0, testValues: {}, ...overrides };
}
function wafer(overrides) {
  return { diameter: 300, radius: 150, center: { x: 0, y: 0 }, orientation: 0, ...overrides };
}
function panelDiv() {
  return document.createElement('div');
}
/** Dies carrying both a hard and a soft bin, so the hard/soft choice is a real one. */
function dualBinDies() {
  return [
    die({ hbin: 1, sbin: 1 }), die({ hbin: 1, sbin: 1 }), die({ hbin: 1, sbin: 1 }),
    die({ hbin: 4, sbin: 7 }), die({ hbin: 4, sbin: 7 }),
    die({ hbin: 2, sbin: 5 }),
  ];
}
function segmentValues(section) {
  return [...section.querySelectorAll('input[type=radio]')].map(r => r.value);
}
function pickSegment(section, value) {
  const radio = [...section.querySelectorAll('input[type=radio]')].find(r => r.value === value);
  assert.ok(radio, `expected a "${value}" option`);
  radio.checked = true;
  radio.dispatchEvent(new dom.window.Event('change'));
}

// ── Bin breakdown follows the plot mode ──────────────────────────────────────

test('bin breakdown opens on the plot mode\'s bin type, not on whichever bin data exists', () => {
  const dies = dualBinDies();
  const hard = buildBinBreakdownSection({ dies, plotMode: 'hardBin' });
  const soft = buildBinBreakdownSection({ dies, plotMode: 'softBin' });
  assert.match(hard.textContent, /Hard Bin Breakdown/);
  // The regression this exists for: both bin types have data, so the old
  // `hasHbin ? 'hard' : 'soft'` rule showed a hard-bin breakdown beside a
  // soft-bin map.
  assert.match(soft.textContent, /Soft Bin Breakdown/);
  assert.doesNotMatch(soft.textContent, /Hard Bin Breakdown/);
});

test('stacked bin plot modes follow the same rule as their unstacked counterparts', () => {
  const dies = dualBinDies();
  assert.match(buildBinBreakdownSection({ dies, plotMode: 'stackedSoftBins' }).textContent, /Soft Bin Breakdown/);
  assert.match(buildBinBreakdownSection({ dies, plotMode: 'stackedBins' }).textContent, /Hard Bin Breakdown/);
});

test('a non-bin plot mode falls back to whichever bin type has data', () => {
  const softOnly = [die({ sbin: 3 }), die({ sbin: 3 })];
  assert.match(buildBinBreakdownSection({ dies: softOnly, plotMode: 'value' }).textContent, /Soft Bin Breakdown/);
});

test('the bin type requested by the plot mode is overridden when that type has no data', () => {
  const hardOnly = [die({ hbin: 1 }), die({ hbin: 2 })];
  // A soft-bin plot mode over hard-only data must not render an empty section.
  const section = buildBinBreakdownSection({ dies: hardOnly, plotMode: 'softBin' });
  assert.match(section.textContent, /Hard Bin Breakdown/);
  assert.match(section.textContent, /Bin 1/);
});

test('bin section states the denominator — "% of dies" and its N', () => {
  const section = buildBinBreakdownSection({ dies: dualBinDies(), plotMode: 'hardBin' });
  // The panel also shows a "Mean wafer yield" percentage, which is a different
  // statistic over a different denominator; a bare "%" for both is what made the
  // two indistinguishable.
  assert.match(section.textContent, /% of dies \(N=6\)/);
});

// ── Pareto ordering ──────────────────────────────────────────────────────────

test('bin rows are pass-bins-first then failing bins by descending count, not by bin number', () => {
  // hbin 1 ×3 (pass), hbin 4 ×2, hbin 2 ×1. Bin-number order would put 2 above 4.
  const section = buildBinBreakdownSection({ dies: dualBinDies(), plotMode: 'hardBin', passBins: [1] });
  const labels = [...section.querySelectorAll('span')]
    .map(s => s.textContent)
    .filter(t => /^Bin \d/.test(t));
  assert.deepEqual(labels, ['Bin 1  (3)', 'Bin 4  (2)', 'Bin 2  (1)']);
});

test('a pass bin is pinned to the top even when it is not the largest', () => {
  const dies = [
    die({ hbin: 1 }),
    die({ hbin: 9 }), die({ hbin: 9 }), die({ hbin: 9 }),
  ];
  const section = buildBinBreakdownSection({ dies, plotMode: 'hardBin', passBins: [1] });
  const labels = [...section.querySelectorAll('span')]
    .map(s => s.textContent)
    .filter(t => /^Bin \d/.test(t));
  assert.deepEqual(labels, ['Bin 1  (1)', 'Bin 9  (3)']);
});

test('multiple pass bins keep bin-number order among themselves', () => {
  const dies = [
    die({ hbin: 3 }), die({ hbin: 3 }),
    die({ hbin: 1 }),
    die({ hbin: 8 }), die({ hbin: 8 }), die({ hbin: 8 }), die({ hbin: 8 }),
  ];
  const section = buildBinBreakdownSection({ dies, plotMode: 'hardBin', passBins: [1, 3] });
  const labels = [...section.querySelectorAll('span')]
    .map(s => s.textContent)
    .filter(t => /^Bin \d/.test(t));
  assert.deepEqual(labels, ['Bin 1  (1)', 'Bin 3  (2)', 'Bin 8  (4)']);
});

// ── Hard/soft selector ───────────────────────────────────────────────────────

test('the hard/soft selector appears only when both bin types have data', () => {
  const panel = panelDiv();
  const both = buildBinBreakdownSection({ dies: dualBinDies(), plotMode: 'hardBin', panel });
  assert.deepEqual(segmentValues(both), ['hard', 'soft']);

  const hardOnly = buildBinBreakdownSection({ dies: [die({ hbin: 1 })], plotMode: 'hardBin', panel: panelDiv() });
  assert.deepEqual(segmentValues(hardOnly), [], 'a one-option toggle is noise');
});

test('picking soft rebuilds the section in place and the choice survives a panel re-render', () => {
  const panel = panelDiv();
  const host = document.createElement('div');
  panel.appendChild(host);
  const section = buildBinBreakdownSection({ dies: dualBinDies(), plotMode: 'hardBin', panel });
  host.appendChild(section);

  pickSegment(section, 'soft');
  assert.match(host.textContent, /Soft Bin Breakdown/);

  // A later re-render (new stats, plot-mode change elsewhere) must not silently
  // revert an explicit user choice back to the plot-mode default.
  const rebuilt = buildBinBreakdownSection({ dies: dualBinDies(), plotMode: 'hardBin', panel });
  assert.match(rebuilt.textContent, /Soft Bin Breakdown/);
});

// ── Merged region section ────────────────────────────────────────────────────

const positionedDies = () => Array.from({ length: 40 }, (_, i) => die({
  x: i % 8, y: Math.floor(i / 8),
  physX: -100 + (i % 8) * 25, physY: -60 + Math.floor(i / 8) * 25,
  hbin: i % 5 === 0 ? 4 : 1,
}));

test('region yield is one section defaulting to Ring, with Quadrant behind the selector', () => {
  const panel = panelDiv();
  const section = buildRegionYieldPanelSection({
    diesByWafer: [positionedDies()], allWafers: [wafer()], ringCount: 4, passBins: [1], panel,
  });
  assert.ok(section);
  assert.match(section.textContent, /Ring Yield/);
  // The two stacked always-on sections are what this replaced.
  assert.doesNotMatch(section.textContent, /Quadrant Yield/);
  assert.deepEqual(segmentValues(section), ['ring', 'quadrant']);
});

test('picking Quadrant swaps the section, including its title', () => {
  const panel = panelDiv();
  const host = document.createElement('div');
  panel.appendChild(host);
  const section = buildRegionYieldPanelSection({
    diesByWafer: [positionedDies()], allWafers: [wafer()], ringCount: 4, passBins: [1], panel,
  });
  host.appendChild(section);
  pickSegment(section, 'quadrant');
  assert.match(host.textContent, /Quadrant Yield/);
  assert.doesNotMatch(host.textContent, /Ring Yield/);
});

// ── Collapse persistence ─────────────────────────────────────────────────────

function chevronFor(section) {
  const btn = section.querySelector('button[aria-expanded]');
  assert.ok(btn, 'expected a collapse toggle');
  return btn;
}

test('a collapsed section stays collapsed across a re-render of the same panel', () => {
  const panel = panelDiv();
  const first = buildBinBreakdownSection({ dies: dualBinDies(), plotMode: 'hardBin', panel });
  const toggle = chevronFor(first);
  assert.equal(toggle.getAttribute('aria-expanded'), 'true');
  toggle.click();
  assert.equal(toggle.getAttribute('aria-expanded'), 'false');

  // The panel render functions begin with `panel.innerHTML = ''`, so without
  // out-of-DOM state every collapse is undone by the next stats update.
  const rebuilt = buildBinBreakdownSection({ dies: dualBinDies(), plotMode: 'hardBin', panel });
  assert.equal(chevronFor(rebuilt).getAttribute('aria-expanded'), 'false');
});

test('collapse state is per panel, not global', () => {
  const a = panelDiv(), b = panelDiv();
  chevronFor(buildBinBreakdownSection({ dies: dualBinDies(), plotMode: 'hardBin', panel: a })).click();
  const other = buildBinBreakdownSection({ dies: dualBinDies(), plotMode: 'hardBin', panel: b });
  assert.equal(chevronFor(other).getAttribute('aria-expanded'), 'true');
});

// ── Test table ───────────────────────────────────────────────────────────────

const specDies = () => Array.from({ length: 20 }, (_, i) => die({
  hbin: 1, testValues: { 1050: 10 + (i % 5) * 0.4 },
}));
const specDefs = [{ testNumber: 1050, name: 'Idsat', unit: 'A', limitLow: 9, limitHigh: 13 }];

test('the compact table shows Ppk and drops the columns that never fitted', () => {
  const dies = specDies();
  // 'compact' is the docked panel's set; the default is the full table (see the
  // column-set tests at the end of this file).
  const section = buildTestSection(dies, specDefs, undefined, undefined, undefined, undefined, [{ dies }], undefined, 'compact');
  const headers = [...section.querySelectorAll('th')].map(th => th.textContent);
  assert.deepEqual(headers, ['Test', 'Mean', 'Ppk', 'Spec yield']);
  // Twelve columns in a 260px panel meant four were visible; the rest live in
  // the report and the CSV.
  for (const gone of ['Q1', 'Q3', 'Median', 'StdDev', 'Min', 'Max', 'LSL', 'USL']) {
    assert.ok(!headers.includes(gone), `${gone} should not be an on-screen column`);
  }
});

test('Ppk is absent when no test has both limits', () => {
  const dies = specDies();
  const oneSided = [{ testNumber: 1050, name: 'Idsat', unit: 'A', limitHigh: 13 }];
  const section = buildTestSection(dies, oneSided, undefined, undefined, undefined, undefined, [{ dies }], undefined, 'compact');
  const headers = [...section.querySelectorAll('th')].map(th => th.textContent);
  assert.ok(!headers.includes('Ppk'), 'a single-sided limit gives no capability index');
});

test('Ppk column is absent entirely when no capability population is supplied', () => {
  const section = buildTestSection(specDies(), specDefs, undefined, undefined, undefined, undefined, undefined, undefined, 'compact');
  const headers = [...section.querySelectorAll('th')].map(th => th.textContent);
  assert.ok(!headers.includes('Ppk'));
});

test('a uniform N moves to the section title instead of repeating down a column', () => {
  const dies = specDies();
  const section = buildTestSection(dies, specDefs, undefined, undefined, undefined, undefined, [{ dies }], undefined, 'compact');
  const headers = [...section.querySelectorAll('th')].map(th => th.textContent);
  assert.ok(!headers.includes('N'));
  assert.match(section.textContent, /N=20/);
});

test('a differing N stays a column — that is the case worth seeing', () => {
  const dies = [
    ...Array.from({ length: 6 }, () => die({ hbin: 1, testValues: { 1050: 11, 1051: 4 } })),
    ...Array.from({ length: 3 }, () => die({ hbin: 1, testValues: { 1050: 12 } })),
  ];
  const defs = [
    { testNumber: 1050, name: 'Idsat' },
    { testNumber: 1051, name: 'Ioff' },
  ];
  const section = buildTestSection(dies, defs, undefined, undefined, undefined, undefined, undefined, undefined, 'compact');
  const headers = [...section.querySelectorAll('th')].map(th => th.textContent);
  assert.ok(headers.includes('N'), `expected an N column when counts differ: ${headers}`);
});

// ── Lot population + per-wafer bars ──────────────────────────────────────────

test('lot overview states the die population, not just a wafer count and a percentage', () => {
  const lotSummary = {
    stats: { waferCount: 2 },
    perWafer: [
      { waferIndex: 0, summary: { stats: { yieldPercent: 80 } } },
      { waferIndex: 1, summary: { stats: { yieldPercent: 90 } } },
    ],
  };
  const perWaferSummaries = [
    { stats: { analyzedDies: 1000, excludedDies: 40 } },
    { stats: { analyzedDies: 1000, excludedDies: 60 } },
  ];
  const section = buildLotOverviewSection(lotSummary, perWaferSummaries);
  assert.match(section.textContent, /Dies analysed/);
  assert.match(section.textContent, /2,000/);
  assert.match(section.textContent, /100/, 'excluded dies are stated too');
  // The mean must name its own aggregation — it is not the same statistic as the
  // bin breakdown's pass-bin percentage sitting a few rows below it. The name
  // carries that now ("per-wafer") rather than a sublabel qualifier, which read
  // as noise with nothing beside it to contrast against.
  assert.match(section.textContent, /Mean per-wafer yield/);
});

function lotOf(yields) {
  return {
    stats: { waferCount: yields.length },
    perWafer: yields.map((y, i) => ({ waferIndex: i, summary: { stats: { yieldPercent: y } } })),
  };
}

test('per-wafer bars name low outliers in text and put the median in the title', () => {
  //  One clear Tukey outlier (20) against a tight cluster.
  const yields = [92, 93, 92.5, 94, 93.5, 92.8, 20];
  const section = buildPerWaferYieldSection(lotOf(yields), yields.map((_, i) => ({ label: `W${i + 1}` })));
  assert.match(section.textContent, /median /);
  assert.match(section.textContent, /low outlier/);
  // Exactly one — the old rule flagged everything below the median, i.e. half the lot.
  assert.equal(section.textContent.match(/low outlier/g).length, 1);
});

test('a tight lot flags no outliers at all', () => {
  const yields = [92, 93, 92.5, 94, 93.5, 92.8, 93.1];
  const section = buildPerWaferYieldSection(lotOf(yields), yields.map((_, i) => ({ label: `W${i + 1}` })));
  assert.doesNotMatch(section.textContent, /low outlier/);
});

test('wafer bars are slot-ordered by default and yield-ordered on request', () => {
  const panel = panelDiv();
  const host = document.createElement('div');
  panel.appendChild(host);
  const yields = [90, 40, 70];
  const section = buildPerWaferYieldSection(
    lotOf(yields), yields.map((_, i) => ({ label: `W${i + 1}` })), undefined, panel,
  );
  host.appendChild(section);

  const order = () => [...host.querySelectorAll('span')]
    .map(s => s.textContent)
    .filter(t => /^W\d/.test(t));
  // Slot order must be the default: sorting by yield destroys the slot-correlated
  // patterns this list exists to make visible.
  assert.deepEqual(order(), ['W1', 'W2', 'W3']);
  pickSegment(section, 'yield');
  assert.deepEqual(order(), ['W2', 'W3', 'W1']);
});

// ── Panel composition ────────────────────────────────────────────────────────

/** A finding shaped as `analyzeWaferMap` emits them — the narrative renderer
 *  reads `comparison.left`, so a partial fixture throws rather than rendering. */
function finding(i) {
  return {
    id: `f${i}`, level: 'wafer', severity: 'notable',
    variable: { kind: 'yield', label: 'Yield' },
    comparison: { family: 'ring', left: 'Ring 4 (edge)', right: 'rest of map' },
    effect: { direction: 'lower', absoluteDelta: -8.8, relativeDelta: -0.1 },
    stats: { method: 'welch', pValue: 0.001, sampleSizeLeft: 100, sampleSizeRight: 900 },
    summary: `Ring 4 (edge) shows reduced yield (${i}).`,
    highlight: { kind: 'region', regionFamily: 'ring', regionKeys: ['ring-4'] },
  };
}

function sectionTitlesOf(panel) {
  return [...panel.querySelectorAll('div, span')]
    .map(e => e.textContent)
    .filter(t => /^(Findings|Hard Bin Breakdown|Soft Bin Breakdown|Ring Yield|Quadrant Yield|Test Values)/.test(t));
}

test('findings render above the bin/region/test detail, not below it', () => {
  const panel = panelDiv();
  const statsSummary = {
    stats: { analyzedDies: 6, excludedDies: 0, yieldPercent: 50 },
    findings: [finding(1)],
  };
  renderWaferSummaryContent(panel, {
    wafer: wafer(), dies: dualBinDies(),
    statsSummary,
    plotMode: 'hardBin',
    onFindingClick: () => {},
    findingsFilter: {},
    onFindingsFilterChange: () => {},
  });
  const titles = sectionTitlesOf(panel);
  const findingsAt = titles.findIndex(t => t.startsWith('Findings'));
  const binsAt     = titles.findIndex(t => /Bin Breakdown/.test(t));
  assert.ok(findingsAt >= 0, `expected a Findings section: ${titles}`);
  assert.ok(binsAt >= 0, `expected a bin section: ${titles}`);
  assert.ok(findingsAt < binsAt, `findings must precede the bin breakdown: ${titles}`);
});

test('the Kind/Region filter dropdowns are withheld below the findings threshold', () => {
  const render = (count) => {
    const panel = panelDiv();
    renderWaferSummaryContent(panel, {
      wafer: wafer(), dies: dualBinDies(),
      statsSummary: {
        stats: { analyzedDies: 6, excludedDies: 0 },
        findings: Array.from({ length: count }, (_, i) => finding(i)),
      },
      onFindingClick: () => {}, findingsFilter: {}, onFindingsFilterChange: () => {},
    });
    return panel;
  };
  // Four findings: the controls for narrowing the list were taller than the list.
  assert.doesNotMatch(render(4).textContent, /Kind:/);
  assert.match(render(10).textContent, /Kind:/);
  assert.match(render(10).textContent, /Region:/);
});

test('lot panel renders one region section and follows the gallery plot mode', () => {
  const panel = panelDiv();
  const dies = dualBinDies();
  renderLotSummaryContent(panel, {
    lotSummary: lotOf([80, 90]),
    items: [
      { label: 'W1', wafer: wafer(), dies, statsSummary: { stats: { analyzedDies: 6, excludedDies: 0 } } },
      { label: 'W2', wafer: wafer(), dies, statsSummary: { stats: { analyzedDies: 6, excludedDies: 0 } } },
    ],
    plotMode: 'softBin',
  });
  assert.match(panel.textContent, /Soft Bin Breakdown/);
  assert.doesNotMatch(panel.textContent, /Hard Bin Breakdown/);
  assert.doesNotMatch(panel.textContent, /Quadrant Yield/, 'quadrant is behind the region selector');
});


// ── Metadata is rendered once, not twice ─────────────────────────────────────

test('the wafer panel drops its metadata section when the caller already shows it', () => {
  const meta = { lot: 'LOT123', waferId: 'W01' };
  const withSection = panelDiv();
  renderWaferSummaryContent(withSection, { wafer: wafer({ metadata: meta }), dies: dualBinDies() });
  assert.match(withSection.textContent, /Wafer Info/);
  assert.match(withSection.textContent, /LOT123/);

  // `renderWaferMap` passes this whenever its identity header is mounted — that
  // header's expandable panel is built from the same metadataEntries helpers, so
  // without this the same fields print twice in a 260px column.
  const suppressed = panelDiv();
  renderWaferSummaryContent(suppressed, {
    wafer: wafer({ metadata: meta }), dies: dualBinDies(), metadataShownElsewhere: true,
  });
  assert.doesNotMatch(suppressed.textContent, /Wafer Info/);
  // The rest of the panel is untouched.
  assert.match(suppressed.textContent, /Bin Breakdown/);
});

// ── Per-wafer findings folded into the wafer yield rows ──────────────────────

test('wafer yield rows carry a findings badge, and wafers without findings still appear', () => {
  const yields = [90, 40, 70];
  const tally = { 0: { total: 3, unusual: 1, notable: 2 } };
  const section = buildPerWaferYieldSection(
    lotOf(yields),
    yields.map((_, i) => ({ label: `W${i + 1}` })),
    undefined,
    panelDiv(),
    i => tally[i],
  );
  const text = section.textContent;
  // The wafer with findings is badged...
  assert.match(text, /W1/);
  assert.match(text, /3/);
  // ...and the two WITHOUT findings are still listed. The removed per-wafer
  // "Findings" tab was a subset list and structurally could not show W2 — which
  // here is the lowest-yielding wafer in the lot.
  assert.match(text, /W2/);
  assert.match(text, /W3/);
});

test('a wafer yield row says it opens the wafer, and names its findings count', () => {
  const yields = [90, 40];
  const section = buildPerWaferYieldSection(
    lotOf(yields),
    yields.map((_, i) => ({ label: `W${i + 1}` })),
    () => {},
    panelDiv(),
    i => (i === 0 ? { total: 2, unusual: 1, notable: 1 } : undefined),
  );
  const labels = [...section.querySelectorAll('[role=button]')].map(r => r.getAttribute('aria-label'));
  // Previously "— view wafer" while the gallery's handler only highlighted the
  // card in the grid; the row now actually opens it.
  assert.ok(labels.every(l => / — open wafer$/.test(l)), `every row must state the action: ${labels}`);
  assert.match(labels[0], /2 findings, 1 unusual/);
  assert.doesNotMatch(labels[1], /finding/);
});

test('the lot panel offers one report, not a summary/findings pair', () => {
  const items = [
    { label: 'W1', wafer: wafer(), dies: dualBinDies(), statsSummary: { stats: { analyzedDies: 6, excludedDies: 0 } } },
  ];
  const panel = panelDiv();
  renderLotSummaryContent(panel, { lotSummary: lotOf([80]), items });
  const labels = [...panel.querySelectorAll('button')].map(b => b.textContent);
  assert.ok(labels.includes('Summary report'));
  // The separate findings report was a strict subset of this document AND
  // appeared only when some wafer had findings, so the panel's set of exports
  // changed with the data in a way no label explained.
  assert.ok(!labels.includes('Findings report'), labels.join(' | '));
});

// ── Column set follows the surface, not one surface's constraint ─────────────

test('the compact column set is the docked panel\'s alone — other callers keep the full table', async () => {
  const { buildLotTestSection } = await import('../dist/packages/canvas-adapter/summaryPanel.js');
  const dies = Array.from({ length: 12 }, (_, i) => die({ hbin: 1, testValues: { 1050: 10 + (i % 5) * 0.4 } }));
  const defs = [{ testNumber: 1050, name: 'Idsat', unit: 'A', limitLow: 9, limitHigh: 13 }];

  // Insights' Overview card is a full-width sibling of the chart grid. Trimming
  // it to the 260px panel's budget lost min/quartiles/max/σ for no benefit —
  // which is exactly what happened when the compact set was introduced
  // unconditionally.
  const full = buildLotTestSection(dies, defs, undefined, undefined, undefined, [{ dies }]);
  const fullHeaders = [...full.querySelectorAll('th')].map(t => t.textContent);
  for (const col of ['Min', 'Q1', 'Median', 'Mean', 'Q3', 'Max', 'StdDev', 'LSL', 'USL']) {
    assert.ok(fullHeaders.includes(col), `full table must keep ${col}: ${fullHeaders}`);
  }

  const compact = buildLotTestSection(dies, defs, undefined, undefined, undefined, [{ dies }], undefined, 'compact');
  const compactHeaders = [...compact.querySelectorAll('th')].map(t => t.textContent);
  assert.deepEqual(compactHeaders, ['Test', 'Mean', 'Ppk', 'Spec yield']);
});

test('the docked wafer panel asks for the compact set', () => {
  const dies = Array.from({ length: 12 }, (_, i) => die({ hbin: 1, testValues: { 1050: 10 + (i % 5) * 0.4 } }));
  const panel = panelDiv();
  renderWaferSummaryContent(panel, {
    wafer: wafer(), dies,
    testDefs: [{ testNumber: 1050, name: 'Idsat', unit: 'A', limitLow: 9, limitHigh: 13 }],
  });
  const headers = [...panel.querySelectorAll('th')].map(t => t.textContent);
  assert.ok(!headers.includes('StdDev'), `panel stays compact: ${headers}`);
});

// ── Default collapse state ──────────────────────────────────────────────────
//
// Seven always-open sections in a 300px column pushed findings and the bin
// breakdown — the two that are acted on — below two dense reference tables.
// Collapsing the reference sections lifts the rest WITHOUT reordering them,
// which was the alternative considered and rejected (sections moving between
// renders is disorienting; a shorter panel is not).

/** `{ title, open }` per section, in panel order. */
function sectionOpenState(panel) {
  return [...panel.querySelectorAll('button[aria-expanded]')].map(btn => ({
    // The toggle's text starts with the ▶/▼ disclosure glyph and can end with a
    // badge count, so match on words rather than anchoring to either end.
    title: btn.textContent.replace(/\s+/g, ' ').replace(/[▶▼]/g, '').trim(),
    open: btn.getAttribute('aria-expanded') === 'true',
  }));
}

function fullPanel() {
  const panel = panelDiv();
  renderWaferSummaryContent(panel, {
    wafer: wafer(), dies: dualBinDies(),
    statsSummary: { stats: { analyzedDies: 6, excludedDies: 0, yieldPercent: 50 }, findings: [finding(1)] },
    plotMode: 'hardBin',
    onFindingClick: () => {},
    findingsFilter: {},
    onFindingsFilterChange: () => {},
  });
  return panel;
}

test('reference sections start collapsed; the acted-on ones start open', () => {
  const state = sectionOpenState(fullPanel());
  const find = (re) => state.find(s => re.test(s.title));

  const findings = find(/Findings/);
  const bins     = find(/Bin Breakdown/);
  assert.ok(findings, `expected a Findings section: ${JSON.stringify(state)}`);
  assert.ok(bins, `expected a bin section: ${JSON.stringify(state)}`);
  assert.equal(findings.open, true, 'findings must start open — the only actionable section');
  assert.equal(bins.open, true, 'the bin breakdown explains the colours on screen; it must start open');

  const region = find(/(Ring|Quadrant|Region) Yield/);
  if (region) assert.equal(region.open, false, 'region yield is reference data — starts collapsed');
});

test('a default-collapsed section can be opened, and the choice survives a re-render', () => {
  const panel = fullPanel();
  const toggleFor = (re) => [...panel.querySelectorAll('button[aria-expanded]')]
    .find(b => re.test(b.textContent.replace(/\s+/g, ' ').trim()));

  const region = toggleFor(/(Ring|Quadrant|Region) Yield/);
  if (!region) return;                        // no region data in this fixture
  assert.equal(region.getAttribute('aria-expanded'), 'false', 'starts collapsed');
  region.click();
  assert.equal(region.getAttribute('aria-expanded'), 'true', 'opens on click');

  // The collapsed set records what is CLOSED, so opening a default-collapsed
  // section must REMOVE it — otherwise the user's choice would be reverted by
  // the next data update, which is the bug this direction can silently have.
  renderWaferSummaryContent(panel, {
    wafer: wafer(), dies: dualBinDies(),
    statsSummary: { stats: { analyzedDies: 6, excludedDies: 0, yieldPercent: 50 }, findings: [finding(1)] },
    plotMode: 'hardBin',
    onFindingClick: () => {}, findingsFilter: {}, onFindingsFilterChange: () => {},
  });
  assert.equal(
    toggleFor(/(Ring|Quadrant|Region) Yield/).getAttribute('aria-expanded'), 'true',
    'a user-opened section must stay open across a re-render',
  );
});

// ── Findings notice ──────────────────────────────────────────────────────────
// A host row at the top of the Findings section, for stating that a category of
// finding is absent and offering to compute it. The case that motivates it: the
// regional test-value pass is expensive, so a host may skip it — and a reader
// looking at the Findings list has no way to tell that it did. See FindingsNotice.

/** Minimal params for renderWaferSummaryContent's findings path. */
function waferParams(statsSummary, findingsNotice) {
  return {
    wafer: wafer(), dies: dualBinDies(), statsSummary,
    onFindingClick: () => {},
    activeFindingId: null,
    findingsFilter: {},
    onFindingsFilterChange: () => {},
    findingsNotice,
  };
}
const noFindings = { findings: [], stats: {} };
const findingsSectionOf = (panel) =>
  [...panel.querySelectorAll('*')].find(e => /^Findings \(/.test(e.textContent ?? ''));

test('the findings notice renders its message, detail and action', () => {
  const panel = panelDiv();
  renderWaferSummaryContent(panel, waferParams(noFindings, {
    message: 'Test-value findings are not included.',
    detail: 'Regional analysis of 30 tests across 25 wafers — about 10s.',
    actionLabel: 'Analyse',
    onAction: () => {},
  }));
  const text = panel.textContent ?? '';
  assert.match(text, /Test-value findings are not included\./);
  assert.match(text, /30 tests across 25 wafers — about 10s/);
  const btn = [...panel.querySelectorAll('button')].find(b => b.textContent === 'Analyse');
  assert.ok(btn, 'expected an "Analyse" action button');
});

test('the notice renders even when the lot has no findings at all', () => {
  // The load-bearing case: on a lot whose only findings WOULD have come from the
  // skipped analysis, the section is otherwise empty and used to return null —
  // hiding the very offer to run it, exactly when it matters most.
  const panel = panelDiv();
  renderWaferSummaryContent(panel, waferParams(noFindings, {
    message: 'Test-value findings are not included.', actionLabel: 'Analyse', onAction: () => {},
  }));
  assert.ok(findingsSectionOf(panel), 'expected a Findings section built around the notice alone');
  assert.match(panel.textContent ?? '', /Test-value findings are not included\./);
});

test('no notice and no findings still renders no findings section', () => {
  const panel = panelDiv();
  renderWaferSummaryContent(panel, waferParams(noFindings, undefined));
  assert.equal(findingsSectionOf(panel), undefined,
    'an empty findings list with nothing to offer must not produce an empty section');
});

test('the notice action fires exactly once per click', () => {
  const panel = panelDiv();
  let calls = 0;
  renderWaferSummaryContent(panel, waferParams(noFindings, {
    message: 'Test-value findings are not included.',
    actionLabel: 'Analyse',
    onAction: () => { calls++; },
  }));
  const btn = [...panel.querySelectorAll('button')].find(b => b.textContent === 'Analyse');
  btn.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  assert.equal(calls, 1);
});

test('a message-only notice renders no button', () => {
  const panel = panelDiv();
  renderWaferSummaryContent(panel, waferParams(noFindings, {
    message: 'Test-value findings are not included.',
  }));
  assert.match(panel.textContent ?? '', /Test-value findings are not included\./);
  assert.equal([...panel.querySelectorAll('button')].some(b => b.textContent === 'Analyse'), false);
});
