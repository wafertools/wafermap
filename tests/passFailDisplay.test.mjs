import test from 'node:test';
import assert from 'node:assert/strict';
import { buildWaferMap, getTestPassStatus } from '../dist/packages/renderer/buildWaferMap.js';
import { buildView, buildMapTitle, buildHoverText } from '../dist/packages/renderer/buildView.js';
import { SPEC_PASS_FILL, SPEC_FAIL_HIGH } from '../dist/packages/renderer/colorMap.js';

const waferConfig = { diameter: 300 };
const dieConfig   = { width: 10, height: 10 };

const F_DEF = { testNumber: 2001, name: 'scan_chain', testType: 'F' };
const P_DEF = { testNumber: 1010, name: 'Vth', unit: 'V', limitLow: 0.2, limitHigh: 3.0 };

/** 3 dies: pass, fail, no result — functional test only (testPass, no testValues). */
function functionalResults() {
  return [
    { x: 0, y: 0, hbin: 1, testPass: { 2001: true } },
    { x: 1, y: 0, hbin: 2, testPass: { 2001: false } },
    { x: 0, y: 1, hbin: 1 },
  ];
}

function rectFillAt(view, x, y) {
  // dies and rectangles are pushed in the same order; find the die index.
  const idx = view.dies.findIndex(d => d.x === x && d.y === y && !d.partial);
  const die = view.dies[idx];
  // Locate the rect at the die's physical position.
  return view.rectangles.find(r => Math.abs(r.x - die.physX) < 1e-9 && Math.abs(r.y - die.physY) < 1e-9)?.fill;
}

test('functional active test forces test pass/fail display: solid verdict fills, counts, no gradient', () => {
  const { wafer, dies } = buildWaferMap({
    results: functionalResults(), waferConfig, dieConfig, testDefs: [F_DEF],
  });
  const view = buildView(wafer, dies, { plotMode: 'value', testDefs: [F_DEF], activeTest: 2001 });

  assert.equal(view.passFailDisplay, 'test', 'F active test must force test display');
  assert.equal(view.colorBySpec, false);
  assert.equal(rectFillAt(view, 0, 0), SPEC_PASS_FILL, 'passing die is solid pass green');
  assert.equal(rectFillAt(view, 1, 0), SPEC_FAIL_HIGH, 'failing die is solid fail red');
  assert.notEqual(rectFillAt(view, 0, 1), SPEC_PASS_FILL, 'no-result die must not be pass');
  assert.notEqual(rectFillAt(view, 0, 1), SPEC_FAIL_HIGH, 'no-result die must not be fail');
  assert.deepEqual(view.passFailCounts, { pass: 1, fail: 1 }, 'counts exclude the no-result die');
});

test('functional test encoded the legacy way (0/1 testValues) renders identically via the fallback', () => {
  const { wafer, dies } = buildWaferMap({
    results: [
      { x: 0, y: 0, hbin: 1, testValues: { 2001: 1 } },
      { x: 1, y: 0, hbin: 2, testValues: { 2001: 0 } },
    ],
    waferConfig, dieConfig, testDefs: [F_DEF],
  });
  const view = buildView(wafer, dies, { plotMode: 'value', testDefs: [F_DEF], activeTest: 2001 });
  assert.equal(view.passFailDisplay, 'test');
  assert.equal(rectFillAt(view, 0, 0), SPEC_PASS_FILL);
  assert.equal(rectFillAt(view, 1, 0), SPEC_FAIL_HIGH);
  assert.deepEqual(view.passFailCounts, { pass: 1, fail: 1 });
});

test('functional active test: log scale request is ignored, never reported as requested', () => {
  const { wafer, dies } = buildWaferMap({
    results: functionalResults(), waferConfig, dieConfig, testDefs: [F_DEF],
  });
  const view = buildView(wafer, dies, { plotMode: 'value', testDefs: [F_DEF], activeTest: 2001, logScale: true });
  assert.equal(view.logScale, false);
  assert.equal(view.logScaleRequested, false);
});

test('map title names the display: functional vs recorded vs spec', () => {
  const { wafer, dies } = buildWaferMap({
    results: functionalResults(), waferConfig, dieConfig, testDefs: [F_DEF],
  });
  const fView = buildView(wafer, dies, { plotMode: 'value', testDefs: [F_DEF], activeTest: 2001 });
  assert.equal(buildMapTitle(fView).secondary, 'Functional pass/fail');
  assert.match(buildMapTitle(fView).primary, /scan_chain/);

  const pResults = [
    { x: 0, y: 0, hbin: 1, testValues: { 1010: 1.0 }, testPass: { 1010: true } },
    { x: 1, y: 0, hbin: 2, testValues: { 1010: 1.1 }, testPass: { 1010: false } },
  ];
  const built = buildWaferMap({ results: pResults, waferConfig, dieConfig, testDefs: [P_DEF] });
  const tView = buildView(built.wafer, built.dies, { plotMode: 'value', testDefs: [P_DEF], activeTest: 1010, passFailDisplay: 'test' });
  assert.equal(buildMapTitle(tView).secondary, 'Tester pass/fail');
  const sView = buildView(built.wafer, built.dies, { plotMode: 'value', testDefs: [P_DEF], activeTest: 1010, passFailDisplay: 'spec' });
  assert.equal(buildMapTitle(sView).secondary, 'Spec pass/fail');
});

test('parametric test pass/fail display: recorded FAIL colours the die red even when in-spec', () => {
  const results = [
    { x: 0, y: 0, hbin: 1, testValues: { 1010: 1.0 }, testPass: { 1010: true } },
    // In-spec value (0.2..3.0) but the tester recorded a FAIL.
    { x: 1, y: 0, hbin: 2, testValues: { 1010: 1.1 }, testPass: { 1010: false } },
    // No recorded verdict — must be no-data in test display, even though it has a value.
    { x: 0, y: 1, hbin: 1, testValues: { 1010: 1.2 } },
  ];
  const { wafer, dies } = buildWaferMap({ results, waferConfig, dieConfig, testDefs: [P_DEF] });
  const view = buildView(wafer, dies, { plotMode: 'value', testDefs: [P_DEF], activeTest: 1010, passFailDisplay: 'test' });
  assert.equal(view.passFailDisplay, 'test');
  assert.equal(rectFillAt(view, 0, 0), SPEC_PASS_FILL);
  assert.equal(rectFillAt(view, 1, 0), SPEC_FAIL_HIGH, 'recorded fail wins over in-spec value');
  assert.notEqual(rectFillAt(view, 0, 1), SPEC_FAIL_HIGH, 'no verdict is never shown as fail');
  assert.deepEqual(view.passFailCounts, { pass: 1, fail: 1 });
});

test('requested displays degrade to off when invalid for the active test (library-enforced)', () => {
  // P test, no limits, no recorded verdicts: both 'spec' and 'test' must degrade to 'off'.
  const noExtras = [{ testNumber: 1050, name: 'Idsat' }];
  const { wafer, dies } = buildWaferMap({
    results: [{ x: 0, y: 0, hbin: 1, testValues: { 1050: 5 } }],
    waferConfig, dieConfig, testDefs: noExtras,
  });
  const spec = buildView(wafer, dies, { plotMode: 'value', testDefs: noExtras, activeTest: 1050, passFailDisplay: 'spec' });
  assert.equal(spec.passFailDisplay, 'off');
  const tst = buildView(wafer, dies, { plotMode: 'value', testDefs: noExtras, activeTest: 1050, passFailDisplay: 'test' });
  assert.equal(tst.passFailDisplay, 'off');
});

test("passFailDisplay: 'spec' sets the view's colorBySpec flag and solid spec fills", () => {
  const results = [
    { x: 0, y: 0, hbin: 1, testValues: { 1010: 1.0 } },
    { x: 1, y: 0, hbin: 2, testValues: { 1010: 5.0 } }, // above limitHigh
  ];
  const { wafer, dies } = buildWaferMap({ results, waferConfig, dieConfig, testDefs: [P_DEF] });
  const view = buildView(wafer, dies, { plotMode: 'value', testDefs: [P_DEF], activeTest: 1010, passFailDisplay: 'spec' });
  assert.equal(view.passFailDisplay, 'spec');
  assert.equal(view.colorBySpec, true);
  assert.equal(rectFillAt(view, 1, 0), SPEC_FAIL_HIGH);
  assert.ok(view.specCounts, 'spec counts still produced');
});

test('tooltip: functional lead reads Pass/Fail; parametric rows get a recorded-fail note', () => {
  const fDie = { x: 0, y: 0, hbin: 1, testPass: { 2001: true } };
  const fHtml = buildHoverText(fDie, 'value', { testDefs: [F_DEF], activeTest: 2001 });
  assert.match(fHtml, /<b>scan_chain: Pass<\/b>/);

  const fFail = { x: 1, y: 0, hbin: 2, testPass: { 2001: false } };
  const fFailHtml = buildHoverText(fFail, 'value', { testDefs: [F_DEF], activeTest: 2001 });
  assert.match(fFailHtml, /<b>scan_chain: Fail<\/b>/);

  const pDie = { x: 0, y: 0, hbin: 2, testValues: { 1010: 1.1 }, testPass: { 1010: false } };
  const pHtml = buildHoverText(pDie, 'value', { testDefs: [P_DEF], activeTest: 1010 });
  assert.match(pHtml, /recorded fail/, 'recorded FAIL on a parametric test is noted');
});

test('die labels in test display are P/F verdicts', async () => {
  const { generateTextOverlay } = await import('../dist/packages/renderer/buildView.js');
  const { wafer, dies } = buildWaferMap({
    results: functionalResults(), waferConfig, dieConfig, testDefs: [F_DEF],
  });
  const view = buildView(wafer, dies, {
    plotMode: 'value', testDefs: [F_DEF], activeTest: 2001, showDieLabels: true,
  });
  const labels = view.texts.filter(t => t.role !== 'indicator').map(t => t.text).sort();
  assert.deepEqual(labels, ['F', 'P'], 'one P and one F label; no-result die unlabelled');
});

test('getTestPassStatus is the read-path everywhere: verdict beats legacy value', () => {
  // Sanity coupling check: a die with contradictory legacy encoding must follow testPass.
  const die = { testValues: { 2001: 1 }, testPass: { 2001: false } };
  assert.equal(getTestPassStatus(die, 2001, F_DEF), false);
});
