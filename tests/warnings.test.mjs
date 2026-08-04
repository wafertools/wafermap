import test from 'node:test';
import assert from 'node:assert/strict';
import { collectWarnings, severityOf } from '../dist/packages/canvas-adapter/warnings.js';
import { buildWaferMap } from '../dist/index.js';
import { analyzeWaferMap } from '../dist/packages/stats/index.js';

// ─────────────────────────────────────────────────────────────────────────────
// The library raises advisories from two independent places — geometry
// inference (dies may be MIS-POSITIONED) and analysis (a feature silently
// produced nothing). Before this, geometry advisories were rendered by no UI at
// all, and analysis ones only if the host both passed a statsSummary and the
// user opened the Summary panel.
//
// These tests pin the collection contract the toolbar indicator, the Summary
// panel banner and the `onWarning` callback all share, so those three surfaces
// cannot drift apart.
// ─────────────────────────────────────────────────────────────────────────────

const wafer = (x, y) => ({ x, y, hbin: 1 });

/** A half-wafer: enough to trip 'partial-coverage' geometry inference. */
function halfWaferResults() {
  const out = [];
  for (let x = 0; x <= 14; x++) {
    for (let y = -14; y <= 14; y++) {
      if (Math.hypot(x, y) > 14) continue;
      out.push(wafer(x, y));
    }
  }
  return out;
}

test('severityOf applies the documented default', () => {
  assert.equal(severityOf({ code: 'x', message: 'm' }), 'warning');
  assert.equal(severityOf({ code: 'x', message: 'm', severity: 'error' }), 'error');
  assert.equal(severityOf({ code: 'x', message: 'm', severity: 'info' }), 'info');
});

test('collectWarnings returns an empty list when nothing is wrong', () => {
  assert.deepEqual(collectWarnings({}), []);
  assert.deepEqual(collectWarnings({ result: null, statsSummary: null }), []);
});

test('geometry advisories are collected — they were previously shown by no UI at all', () => {
  const result = buildWaferMap({ results: halfWaferResults(), passBins: [1] });
  assert.ok(result.warnings.length > 0, 'expected a geometry advisory for half-wafer data');

  const collected = collectWarnings({ result });
  assert.equal(collected.length, result.warnings.length);
  assert.ok(collected.every(w => w.code && w.message), 'every warning needs a code and a message');
});

test('geometry advisories are errors — a mis-positioned die is a wrong map, not a notice', () => {
  const result = buildWaferMap({ results: halfWaferResults(), passBins: [1] });
  for (const w of result.warnings) {
    assert.equal(severityOf(w), 'error', `${w.code} should be an error`);
  }
});

test('errors sort ahead of warnings', () => {
  const collected = collectWarnings({
    result: { warnings: [{ code: 'geom', message: 'g', severity: 'error' }] },
    statsSummary: { stats: { warnings: [{ code: 'cap', message: 'c', severity: 'warning' }] } },
  });
  assert.deepEqual(collected.map(w => w.code), ['geom', 'cap']);
});

test('info sorts last', () => {
  const collected = collectWarnings({
    result: {
      warnings: [
        { code: 'i', message: 'i', severity: 'info' },
        { code: 'w', message: 'w', severity: 'warning' },
        { code: 'e', message: 'e', severity: 'error' },
      ],
    },
  });
  assert.deepEqual(collected.map(w => w.code), ['e', 'w', 'i']);
});

test('duplicates are collapsed — a lot repeats the same advisory on every wafer', () => {
  const dup = { code: 'partial-coverage', message: 'same text', severity: 'error' };
  const collected = collectWarnings({
    lotStatsSummary: {
      perWafer: Array.from({ length: 20 }, () => ({ summary: { stats: { warnings: [dup] } } })),
    },
  });
  assert.equal(collected.length, 1, 'twenty identical advisories should state the problem once');
});

test('same code with different messages is kept — the one that differs must not be buried', () => {
  const collected = collectWarnings({
    result: {
      warnings: [
        { code: 'partial-coverage', message: 'wafer A', severity: 'error' },
        { code: 'partial-coverage', message: 'wafer B', severity: 'error' },
      ],
    },
  });
  assert.equal(collected.length, 2);
});

test('warnings with no message are dropped rather than rendered blank', () => {
  const collected = collectWarnings({
    result: { warnings: [{ code: 'x', message: '' }, { code: 'y', message: 'real' }] },
  });
  assert.deepEqual(collected.map(w => w.code), ['y']);
});

test('the test-count cap is a structured warning, not a bare string', () => {
  // Above the cap, analyzeWaferMap returns NO test findings at all. That silence
  // is the whole reason this has to be surfaced.
  const results = [];
  for (let x = -6; x <= 6; x++) {
    for (let y = -6; y <= 6; y++) {
      if (Math.hypot(x, y) > 6) continue;
      const testValues = {};
      for (let t = 0; t < 300; t++) testValues[1000 + t] = Math.random();
      results.push({ x, y, hbin: 1, testValues });
    }
  }
  const result  = buildWaferMap({ results, waferConfig: { diameter: 200 }, dieConfig: { width: 10, height: 10 }, passBins: [1] });
  const summary = analyzeWaferMap(result, { computePerTestStats: true });

  const warnings = summary.stats.warnings ?? [];
  assert.ok(warnings.length > 0, 'exceeding the test cap must raise a warning');

  const capped = warnings.find(w => w.code === 'test-count-capped');
  assert.ok(capped, `expected a 'test-count-capped' warning, got ${JSON.stringify(warnings)}`);
  assert.equal(typeof capped.message, 'string');
  assert.notEqual(typeof capped, 'string', 'warnings are structured objects now, not strings');

  // The message must say the outcome is "no findings", not merely "many tests" —
  // an agent or engineer reading it should not have to infer the consequence.
  assert.match(capped.message, /no test findings|skipped/i);

  // And it must be collectable alongside geometry advisories.
  assert.ok(collectWarnings({ statsSummary: summary }).some(w => w.code === 'test-count-capped'));
});

test('collectWarnings merges every source into one list', () => {
  const collected = collectWarnings({
    result:       { warnings: [{ code: 'a', message: 'a', severity: 'error' }] },
    statsSummary: { stats: { warnings: [{ code: 'b', message: 'b' }] } },
    lotStatsSummary: { perWafer: [{ summary: { stats: { warnings: [{ code: 'c', message: 'c' }] } } }] },
  });
  assert.deepEqual(collected.map(w => w.code).sort(), ['a', 'b', 'c']);
});
