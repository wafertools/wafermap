import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { collectWarnings, severityOf } from '../dist/packages/canvas-adapter/warnings.js';
import { buildWaferMap } from '../dist/index.js';
import { STANDARD_WAFER_DIAMETERS_MM } from '../dist/packages/renderer/buildWaferMap.js';
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

/** A full symmetric wafer: geometry infers cleanly, so only the pitch advisory fires. */
function fullWaferResults() {
  const out = [];
  for (let x = -14; x <= 14; x++) {
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

test('mis-positioning advisories are errors — a mis-positioned die is a wrong map, not a notice', () => {
  const result = buildWaferMap({ results: halfWaferResults(), passBins: [1] });
  assert.ok(result.warnings.length > 0, 'expected a geometry advisory for half-wafer data');
  for (const w of result.warnings) {
    assert.equal(severityOf(w), 'error', `${w.code} should be an error`);
  }
});

test('a diameter without a pitch raises nothing — an inferred pitch is not evidence', () => {
  // The pitch is derived as diameter / grid span, which places the outermost die
  // at ~95% of the radius by construction: the result is always self-consistent
  // and there is nothing to check it against. This used to raise `inferred-pitch`
  // on every such build, including the ones where the derived pitch was within
  // 1% — noise in the channel that also carries real geometry errors.
  const result = buildWaferMap({
    results: fullWaferResults(), passBins: [1], waferConfig: { diameter: 300 },
  });
  assert.deepEqual(result.warnings.map(w => w.code), [],
    'a supplied diameter with an inferred pitch is a supported input and reports nothing');
});

test('an inferred diameter off the standard ladder is a warning', () => {
  // The checkable half of the same risk: pitch supplied, diameter inferred from
  // the die extent. Silicon only comes in standard sizes, so a non-standard
  // result is evidence the probed grid did not reach the wafer edge.
  const results = [];
  for (let x = -20; x <= 20; x++) for (let y = -20; y <= 20; y++) {
    // A 300 mm wafer at 10 mm pitch with the outer third never probed → infers 210 mm.
    if (Math.hypot(x * 10, y * 10) > 150 * 0.65) continue;
    results.push({ x, y, hbin: 1 });
  }
  const result = buildWaferMap({ results, passBins: [1], dieConfig: { width: 10, height: 10 } });
  const hit = result.warnings.filter(w => w.code === 'non-standard-diameter');
  assert.equal(hit.length, 1, `expected non-standard-diameter, got ${JSON.stringify(result.warnings.map(w => w.code))}`);
  assert.equal(severityOf(hit[0]), 'warning', 'it reports a suspect inference, not a wrong map');
  assert.match(hit[0].message, /not a standard wafer size/);
});

test('a correctly inferred diameter is silent', () => {
  // The property that makes the rule usable: it must not fire on good data.
  const results = [];
  for (let x = -20; x <= 20; x++) for (let y = -20; y <= 20; y++) {
    if (Math.hypot(x * 10, y * 10) > 150 * 0.94) continue;
    results.push({ x, y, hbin: 1 });
  }
  const result = buildWaferMap({ results, passBins: [1], dieConfig: { width: 10, height: 10 } });
  assert.deepEqual(result.warnings.map(w => w.code), [],
    'a grid that does reach the wafer edge infers a standard diameter and says nothing');
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

// ── standardDiameters ────────────────────────────────────────────────────────
// The check is only as good as its table, and the table is a trade-off: every
// entry is a value a wrong inference can hide behind, every omission wrongly
// accuses someone running that size. So it is overridable, and the override
// REPLACES the default rather than extending it.

/** A wafer of `dia` mm at `pitch` mm, probed out to `span` of its radius. */
function probedTo(dia, pitch, span) {
  const R = dia / 2, out = [], lim = Math.ceil(R / pitch) + 1;
  for (let x = -lim; x <= lim; x++) for (let y = -lim; y <= lim; y++) {
    if (Math.hypot(x * pitch, y * pitch) <= R * span) out.push({ x, y, hbin: 1 });
  }
  return out;
}
const codesOf = (r) => (r.warnings ?? []).map(w => w.code);

test('the default table is the documented production set', () => {
  assert.deepEqual([...STANDARD_WAFER_DIAMETERS_MM], [100, 125, 150, 200, 300]);
});

test('a size outside the default table is flagged even when correctly inferred', () => {
  // The documented cost of a narrow table: a genuine 3-inch wafer looks suspect.
  // Stated as a test so the trade-off cannot be forgotten and rediscovered.
  const r = buildWaferMap({
    results: probedTo(76.2, 3, 0.94), passBins: [1], dieConfig: { width: 3, height: 3 },
  });
  assert.deepEqual(codesOf(r), ['non-standard-diameter']);
});

test('extending the table silences that, without losing a real error', () => {
  const extended = [...STANDARD_WAFER_DIAMETERS_MM, 76.2];
  const threeInch = buildWaferMap({
    results: probedTo(76.2, 3, 0.94), passBins: [1],
    dieConfig: { width: 3, height: 3 }, standardDiameters: extended,
  });
  assert.deepEqual(codesOf(threeInch), [], 'a genuine 3-inch wafer is now accepted');

  // A 300 mm wafer with the outer third unprobed infers 210 mm — still caught.
  const wrong = buildWaferMap({
    results: probedTo(300, 10, 0.65), passBins: [1],
    dieConfig: { width: 10, height: 10 }, standardDiameters: extended,
  });
  assert.deepEqual(codesOf(wrong), ['non-standard-diameter']);
});

test('narrowing the table catches more, which is why hosts should', () => {
  // A fab running only 200/300 gets strictly better detection than the default:
  // 150 is no longer a hiding place for a mis-inferred 200 mm wafer.
  const results = probedTo(200, 5, 0.65);   // infers exactly 150 mm
  const withDefault = buildWaferMap({ results, passBins: [1], dieConfig: { width: 5, height: 5 } });
  assert.deepEqual(codesOf(withDefault), [], 'the default table lets 150 mm through');

  const narrowed = buildWaferMap({
    results, passBins: [1], dieConfig: { width: 5, height: 5 }, standardDiameters: [200, 300],
  });
  assert.deepEqual(codesOf(narrowed), ['non-standard-diameter'],
    'naming only the sizes you actually run turns that miss into a catch');
});

test('an empty table disables the check', () => {
  const r = buildWaferMap({
    results: probedTo(300, 10, 0.65), passBins: [1],
    dieConfig: { width: 10, height: 10 }, standardDiameters: [],
  });
  assert.deepEqual(codesOf(r), [], 'the documented opt-out for non-standard substrates');
});

test('unusable entries are ignored rather than throwing', () => {
  const r = buildWaferMap({
    results: probedTo(300, 10, 0.65), passBins: [1], dieConfig: { width: 10, height: 10 },
    standardDiameters: [300, NaN, -5, 0, Infinity],
  });
  assert.deepEqual(codesOf(r), ['non-standard-diameter'], 'filtered down to [300]');
});

test('a supplied diameter is never second-guessed', () => {
  // 210 is not a standard size, but the caller asserted it — the check is only
  // ever about an inference the library made on their behalf.
  const r = buildWaferMap({
    results: probedTo(210, 10, 0.9), passBins: [1],
    waferConfig: { diameter: 210 }, dieConfig: { width: 10, height: 10 },
  });
  assert.ok(!codesOf(r).includes('non-standard-diameter'),
    `a diameter you supply is yours; got ${JSON.stringify(codesOf(r))}`);
});

// ── diameter-exceeds-die-extent ──────────────────────────────────────────────
// `geometry-conflict` asks whether the dies FIT the supplied wafer. Nothing
// asked whether they FILL it, so a diameter that was too large passed silently —
// and it is not harmless: ring bands are equal-radius, so an over-large wafer
// crushes every die into the inner rings and empties the outer ones.

test('an over-large supplied diameter is flagged, and the rings show why', () => {
  const results = probedTo(300, 10, 0.94);           // dies reach ~141 mm
  const ok = buildWaferMap({
    results, passBins: [1], waferConfig: { diameter: 300 }, dieConfig: { width: 10, height: 10 },
  });
  assert.deepEqual(codesOf(ok), [], 'the correct diameter is silent');

  // 3000 mm — a plausible typo for 300. Dies fit trivially, so geometry-conflict
  // cannot fire; before this check, nothing did.
  const huge = buildWaferMap({
    results, passBins: [1], waferConfig: { diameter: 3000 }, dieConfig: { width: 10, height: 10 },
  });
  assert.deepEqual(codesOf(huge), ['diameter-exceeds-die-extent']);
  assert.equal(severityOf(huge.warnings[0]), 'warning',
    'the dies are drawn correctly — it is the analysis that is distorted');
  assert.match(huge.warnings[0].message, /partial map/,
    'must name the innocent explanation too, since the two are indistinguishable');
});

test('normal edge exclusion and reticle-complete maps are left alone', () => {
  // The calibration that makes the check usable: real maps sit at 83-99% fill.
  for (const span of [0.94, 0.88, 0.83]) {
    const r = buildWaferMap({
      results: probedTo(300, 10, span), passBins: [1],
      waferConfig: { diameter: 300 }, dieConfig: { width: 10, height: 10 },
    });
    assert.ok(!codesOf(r).includes('diameter-exceeds-die-extent'),
      `a map reaching ${(span * 100).toFixed(0)}% of the radius must not be flagged`);
  }
});

test('it cannot fire when the diameter or the pitch was inferred', () => {
  const results = probedTo(300, 10, 0.94);
  // Diameter inferred → sized TO the die extent, so fill is ~1 by construction.
  const inferredDia = buildWaferMap({ results, passBins: [1], dieConfig: { width: 10, height: 10 } });
  assert.ok(!codesOf(inferredDia).includes('diameter-exceeds-die-extent'));

  // Pitch inferred → scales to fit whatever diameter was asserted, which is why
  // a wrong diameter is harmless on that path.
  const inferredPitch = buildWaferMap({ results, passBins: [1], waferConfig: { diameter: 3000 } });
  assert.ok(!codesOf(inferredPitch).includes('diameter-exceeds-die-extent'));
});

// ── Every advisory code has a short label ───────────────────────────────────
// The collapsed warnings banner keys its heading off `code` and falls back to
// truncating the message. That fallback is a safety net, and in 0.27.0 it became
// the norm without anyone noticing: the table still keyed the REMOVED
// `inferred-pitch` and had no entry for `non-standard-diameter` or
// `diameter-exceeds-die-extent`, the two codes that replaced it — so every
// geometry advisory the release actually raised rendered as a 57-character
// truncation of its own prose.

test('SHORT_LABEL covers every code the library declares, and no code it does not', async () => {
  const { SHORT_LABEL } = await import('../dist/packages/canvas-adapter/warnings.js');
  const src = readFileSync(new URL('../packages/renderer/buildWaferMap.ts', import.meta.url), 'utf8');
  // The `code:` union on WaferWarning — the one declared list of codes.
  const start = src.indexOf("  code: 'partial-coverage'");
  const declared = new Set(
    [...src.slice(start, src.indexOf(';', start)).matchAll(/'([a-z-]+)'/g)].map(m => m[1]),
  );
  assert.ok(declared.size >= 7, `parsed the code union (${declared.size} codes)`);

  const labelled = new Set(Object.keys(SHORT_LABEL));
  const missing = [...declared].filter(c => !labelled.has(c));
  assert.deepEqual(missing, [], 'every declared code needs a short label');

  // And nothing labelled that no longer exists — the stale `inferred-pitch`
  // entry is what made the gap invisible for a whole release.
  const stale = [...labelled].filter(c => !declared.has(c) && c !== 'test-def-collision');
  assert.deepEqual(stale, [], 'a label for a code nothing emits is a sign the list drifted');
});
