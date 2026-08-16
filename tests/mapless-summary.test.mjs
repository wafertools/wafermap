import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>');
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.HTMLDivElement = dom.window.HTMLDivElement;
globalThis.Node = dom.window.Node;
globalThis.MouseEvent = dom.window.MouseEvent;

const { buildMaplessSummary } = await import('../dist/packages/canvas-adapter/maplessSummary.js');
const { buildBinSection } = await import('../dist/packages/canvas-adapter/summaryPanel.js');
const { buildTestHistogramData } = await import('../dist/packages/stats/histogram.js');
const { getColorScheme } = await import('../dist/packages/renderer/colorSchemes.js');
const { getTooltip } = await import('../dist/packages/canvas-adapter/toolbar.js');

function die(overrides) {
  return { testValues: {}, ...overrides };
}

function bars(el) {
  return [...el.querySelectorAll('[data-wmap-bar]')];
}

function hoverText(el) {
  document.body.appendChild(el); // ownerDocument must resolve to the live doc for getTooltip
  el.dispatchEvent(new MouseEvent('mousemove', { clientX: 10, clientY: 10, bubbles: true }));
  const tooltip = getTooltip(document);
  const text = tooltip.textContent;
  el.remove();
  return text;
}

test('buildMaplessSummary — hardBin mode matches buildBinSection on the same dies', () => {
  const dies = [die({ hbin: 1 }), die({ hbin: 1 }), die({ hbin: 2 })];
  const expected = buildBinSection(dies, undefined, 'hard');
  const actual = buildMaplessSummary(dies, undefined, { plotMode: 'hardBin' });
  assert.equal(actual.textContent, expected.textContent);
});

test('buildMaplessSummary — softBin mode matches buildBinSection on the same dies', () => {
  const dies = [die({ sbin: 3 }), die({ sbin: 3 }), die({ sbin: 4 })];
  const expected = buildBinSection(dies, undefined, 'soft');
  const actual = buildMaplessSummary(dies, undefined, { plotMode: 'softBin' });
  assert.equal(actual.textContent, expected.textContent);
});

test('buildMaplessSummary — value mode produces bars matching buildTestHistogramData bucket counts', () => {
  const dies = [
    die({ testValues: { 1001: 1.0 } }),
    die({ testValues: { 1001: 2.0 } }),
    die({ testValues: { 1001: 3.0 } }),
    die({ testValues: { 1001: 9.5 } }),
  ];
  const testDefs = [{ testNumber: 1001, name: 'Vdd' }];
  const expectedBuckets = buildTestHistogramData([{ dies }], 1001, 12);
  const el = buildMaplessSummary(dies, testDefs, { plotMode: 'value', activeTest: 1001 });
  const els = bars(el);
  assert.equal(els.length, expectedBuckets.length);
});

test('buildMaplessSummary — bar hover uses the shared themed tooltip (getTooltip), not a native title attribute', () => {
  const dies = [die({ testValues: { 1001: 1.0 } }), die({ testValues: { 1001: 9.5 } })];
  const testDefs = [{ testNumber: 1001, name: 'Vdd' }];
  const el = buildMaplessSummary(dies, testDefs, { plotMode: 'value', activeTest: 1001 });
  const bar = bars(el)[0];
  assert.equal(bar.title, '', 'bars must not carry a native title — that is the slow, unthemed browser tooltip this replaced');
  const text = hoverText(bar);
  assert.match(text, /:\s*\d+$/, `expected "<range>: <count>" tooltip text, got: ${text}`);
});

test('buildMaplessSummary — value mode bars are coloured by value through the map\'s own colour scheme', () => {
  const dies = [
    die({ testValues: { 1001: 0.0 } }),
    die({ testValues: { 1001: 10.0 } }),
  ];
  const testDefs = [{ testNumber: 1001, name: 'Vdd' }];
  const el = buildMaplessSummary(dies, testDefs, { plotMode: 'value', activeTest: 1001, colorScheme: 'viridis' });
  const els = bars(el);
  const colors = new Set(els.map((b) => b.style.background));
  // At least two distinct colours across the bucket range — proves bars are
  // NOT all painted the same flat colour any more.
  assert.ok(colors.size > 1, `expected varied bar colours, got: ${[...colors].join(', ')}`);
  // First bucket's colour matches the scheme function at that bucket's own
  // midpoint (computed the same way buildMaplessSummary does internally),
  // rather than assuming buckets land exactly on the data's min/max.
  const buckets = buildTestHistogramData([{ dies }], 1001, 12);
  const spanLow = buckets[0].rangeLow, spanHigh = buckets[buckets.length - 1].rangeHigh;
  const midT = ((buckets[0].rangeLow + buckets[0].rangeHigh) / 2 - spanLow) / (spanHigh - spanLow);
  const scheme = getColorScheme('viridis');
  // Round-trip the expected colour through a scratch element's style too —
  // jsdom's CSSOM normalizes "rgb(a,b,c)" to "rgb(a, b, c)" on read, so
  // comparing a raw forValue() string against els[0].style.background
  // (already round-tripped) would spuriously fail on whitespace alone.
  const scratch = document.createElement('div');
  scratch.style.background = scheme.forValue(midT);
  assert.equal(els[0].style.background, scratch.style.background);
});

test('buildMaplessSummary — value mode bar colours change with logScale (matching the map\'s own toggle)', () => {
  const dies = [
    die({ testValues: { 1001: 1.0 } }),
    die({ testValues: { 1001: 10.0 } }),
    die({ testValues: { 1001: 100.0 } }),
    die({ testValues: { 1001: 1000.0 } }),
  ];
  const testDefs = [{ testNumber: 1001, name: 'Vdd' }];
  const colorsOf = (el) => bars(el).map((b) => b.style.background);
  const linear = buildMaplessSummary(dies, testDefs, { plotMode: 'value', activeTest: 1001, colorScheme: 'viridis', logScale: false });
  const logged = buildMaplessSummary(dies, testDefs, { plotMode: 'value', activeTest: 1001, colorScheme: 'viridis', logScale: true });
  assert.notDeepEqual(colorsOf(linear), colorsOf(logged), 'log-scale toggle should change the colour mapping');
});

test('buildMaplessSummary — value mode bar colours change with colorbarRangeMode when the test has spec limits', () => {
  const dies = [
    die({ testValues: { 1001: 5.0 } }),
    die({ testValues: { 1001: 6.0 } }),
    die({ testValues: { 1001: 7.0 } }),
  ];
  const testDefs = [{ testNumber: 1001, name: 'Vdd', limitLow: 0, limitHigh: 100 }];
  const colorsOf = (el) => bars(el).map((b) => b.style.background);
  const specRange = buildMaplessSummary(dies, testDefs, { plotMode: 'value', activeTest: 1001, colorScheme: 'viridis', colorbarRangeMode: 'spec' });
  const dataRange = buildMaplessSummary(dies, testDefs, { plotMode: 'value', activeTest: 1001, colorScheme: 'viridis', colorbarRangeMode: 'data' });
  assert.notDeepEqual(colorsOf(specRange), colorsOf(dataRange), 'colorbar range mode should change the colour mapping when limits exist');
});

test('buildMaplessSummary — value mode draws LSL/USL markers when the test has spec limits', () => {
  const dies = [
    die({ testValues: { 1001: 1.0 } }),
    die({ testValues: { 1001: 2.0 } }),
    die({ testValues: { 1001: 3.0 } }),
  ];
  const testDefs = [{ testNumber: 1001, name: 'Vdd', unit: 'V', limitLow: 0.5, limitHigh: 3.5 }];
  const el = buildMaplessSummary(dies, testDefs, { plotMode: 'value', activeTest: 1001 });
  const markers = [...el.querySelectorAll('[data-wmap-limit-marker]')];
  assert.equal(markers.length, 2);
  // Always-visible label chips (not hover-gated) carry the LSL/USL text.
  assert.match(el.textContent, /LSL/);
  assert.match(el.textContent, /USL/);
});

test('buildMaplessSummary — value mode omits limit markers when the test has none', () => {
  const dies = [die({ testValues: { 1001: 1.0 } }), die({ testValues: { 1001: 2.0 } })];
  const testDefs = [{ testNumber: 1001, name: 'Vdd' }];
  const el = buildMaplessSummary(dies, testDefs, { plotMode: 'value', activeTest: 1001 });
  assert.equal(el.querySelectorAll('[data-wmap-limit-marker]').length, 0);
});

test('buildMaplessSummary — unhandled mode (metadata) falls back to a message, never blank', () => {
  const dies = [die({ hbin: 1 })];
  const el = buildMaplessSummary(dies, undefined, { plotMode: 'metadata' });
  assert.ok(el.textContent && el.textContent.length > 0);
  assert.match(el.textContent, /No summary available/);
});

test('buildMaplessSummary — hardBin mode with no bin data on any die falls back to a message', () => {
  const dies = [die({})];
  const el = buildMaplessSummary(dies, undefined, { plotMode: 'hardBin' });
  assert.match(el.textContent, /No summary available/);
});
