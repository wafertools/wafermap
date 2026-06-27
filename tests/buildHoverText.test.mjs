import test from 'node:test';
import assert from 'node:assert/strict';
import { buildHoverText } from '../dist/packages/renderer/buildView.js';

// buildHoverText(die, plotMode, testDefs?, hbinDefs?, sbinDefs?, fallbackFormat?,
//                aggrMethod?, lotSize?, testLimit?, waferMeta?, activeTest?)

// A die with many parametric tests — the case that previously produced a giant block.
function manyTestDie(n) {
  const testValues = {};
  for (let i = 0; i < n; i++) testValues[1000 + i] = i * 0.01;
  return { x: 3, y: 4, hbin: 1, sbin: 10, testValues };
}
function manyTestDefs(n) {
  return Array.from({ length: n }, (_, i) => ({ testNumber: 1000 + i, name: `T${i}`, unit: 'V' }));
}

test('value mode — tooltip leads with the active test and summarises the rest, never dumping all', () => {
  const n = 50;
  const html = buildHoverText(
    manyTestDie(n), 'value', manyTestDefs(n),
    undefined, undefined, undefined, undefined, undefined, undefined, undefined,
    1025, // activeTest
  );
  // Leads with the active test, bolded.
  assert.match(html, /<b>T25: [^<]*<\/b>/, 'active test T25 must lead, bolded');
  // Compact summary of the remainder, not a full list.
  assert.match(html, /\+49 more tests/, 'must summarise the other 49 tests');
  // Only ONE test row is actually spelled out (the lead) — no wall of test lines.
  const testRowCount = (html.match(/T\d+:/g) || []).length;
  assert.equal(testRowCount, 1, 'exactly one test value line (the active one) should appear');
});

test('value mode — out-of-spec active test is flagged in the tooltip', () => {
  const die = { x: 0, y: 0, hbin: 1, testValues: { 1010: 0.9 } }; // above limitHigh
  const testDefs = [{ testNumber: 1010, name: 'Vth', unit: 'V', limitLow: 0.2, limitHigh: 0.5 }];
  const html = buildHoverText(
    die, 'value', testDefs,
    undefined, undefined, undefined, undefined, undefined, undefined, undefined, 1010,
  );
  assert.match(html, /<b>Vth: [^<]*<\/b>/, 'active test leads');
  assert.match(html, /out of spec/i, 'out-of-spec active test must be flagged');
});

test('value mode — degrades gracefully when activeTest is missing/unresolvable', () => {
  const die = { x: 0, y: 0, hbin: 1, testValues: { 1010: 1.0, 1020: 2.0 } };
  const testDefs = [
    { testNumber: 1010, name: 'A', unit: 'V' },
    { testNumber: 1020, name: 'B', unit: 'V' },
  ];
  // No activeTest passed → falls back to the first present test, no crash.
  const html = buildHoverText(die, 'value', testDefs);
  assert.match(html, /<b>A: [^<]*<\/b>/, 'falls back to the first test as the lead');
  assert.match(html, /\+1 more test\b/, 'singular "+1 more test" for exactly one remainder');
});

test('bin mode — shows the bin verdict then a test-value COUNT, never a list', () => {
  const n = 48;
  const die = manyTestDie(n);
  die.hbin = 2;
  const html = buildHoverText(
    die, 'hardBin', manyTestDefs(n),
    [{ bin: 2, name: 'Contact Open' }],
  );
  assert.match(html, /HBin: 2 · Contact Open/, 'bin verdict is primary in bin mode');
  assert.match(html, /48 test values recorded/, 'tests collapse to a count in bin mode');
  // No individual test rows are listed.
  assert.equal((html.match(/T\d+:/g) || []).length, 0, 'bin mode must not list any test rows');
});

test('singular/plural and empty edges', () => {
  // Exactly one test value, bin mode → singular "1 test value recorded".
  const oneTestBin = { x: 0, y: 0, hbin: 1, testValues: { 1010: 1.0 } };
  const defs1 = [{ testNumber: 1010, name: 'A', unit: 'V' }];
  const binHtml = buildHoverText(oneTestBin, 'hardBin', defs1);
  assert.match(binHtml, /1 test value recorded/);
  assert.doesNotMatch(binHtml, /1 test values recorded/, 'no incorrect plural');

  // No test values at all → no count line, no "more" line.
  const noTests = { x: 0, y: 0, hbin: 1 };
  const noneHtml = buildHoverText(noTests, 'value', defs1, undefined, undefined,
    undefined, undefined, undefined, undefined, undefined, 1010);
  assert.doesNotMatch(noneHtml, /more test/);
  assert.doesNotMatch(noneHtml, /test value.* recorded/);
});

test('stacked modes are untouched — still show a single aggregated value', () => {
  const die = { x: 0, y: 0, testValues: { 0: 1.23 } };
  const testDefs = [{ testNumber: 1010, name: 'Vth', unit: 'V' }];
  const html = buildHoverText(
    die, 'stackedValues', testDefs,
    undefined, undefined, undefined, 'mean',
  );
  assert.match(html, /Vth \(mean\): /, 'stackedValues still shows its single aggregated value');
});
