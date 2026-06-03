/**
 * Detection accuracy regression tests.
 *
 * Uses the wm811k-sample.json fixture (27 wafers, 3 per type × 9 types) to assert
 * floor-level recall for the spatial pattern classifier and combined detection.
 * These tests run fast (27 wafers) and are part of the regular test suite.
 *
 * Baselines are FLOORS — a test fails if recall drops below the floor, but
 * improvements (higher recall) are welcomed. When you improve the classifier,
 * raise the floor to lock in the gain.
 *
 * Full WM-811K benchmarks (25,519 wafers) are in scripts/run-benchmark-*.mjs
 * and are run manually, not as part of npm test.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { buildWaferMap } from '../dist/index.js';
import { classifyPattern } from '../dist/packages/stats/patternClassification.js';
import { analyzeWaferMap } from '../dist/packages/stats/analyzeWaferMap.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = join(__dirname, 'fixtures', 'wm811k-sample.json');
const FIXTURE_MISSING = !existsSync(FIXTURE_PATH);

// WM-811K label → our PatternLabel
const LABEL_MAP = {
  'Center':    'center',
  'Donut':     'donut',
  'Edge-Loc':  'edge-local',
  'Edge-Ring': 'edge-ring',
  'Loc':       'random',
  'Near-full': 'near-full',
  'Random':    'random',
  'Scratch':   'scratch',
  'none':      'none',
};

// Regional finding families that are semantically consistent with each WM-811K label.
// Used to assess combined (classifier + regional) detection.
const SEMANTIC_FAMILIES = {
  'center':     ['ring', 'cluster'],
  'donut':      ['ring', 'cluster'],
  'edge-local': ['edge-arc', 'cluster', 'ring', 'sector', 'quadrant'],
  'edge-ring':  ['ring', 'edge-arc'],
  'near-full':  ['ring'],
  'scratch':    ['cluster', 'edge-arc', 'sector', 'quadrant'],
};

const REGIONAL_FAMILIES = new Set(['ring', 'quadrant', 'sector', 'edge-arc', 'cluster']);

// ── Recall floors ─────────────────────────────────────────────────────────────
// These are minimums on a 3-sample fixture — a single sample swing can move
// recall by 33pp. Floors are set conservatively below full-dataset recall.
// Raise them when you improve the classifier to lock in gains.
//
// Full-dataset (WM-811K 25,519 wafers) baselines as of last benchmark run:
//   Classifier only: 64% exact-match, 86.2% detection
//   Combined:        99.0% any detection, 98.9% matched detection
const CLASSIFIER_DETECTION_FLOOR = 0.55;    // ≥55% of real-pattern wafers get any non-random label
const COMBINED_DETECTION_FLOOR   = 0.80;    // ≥80% get classifier OR semantic regional finding

if (FIXTURE_MISSING) {
  test.skip('wm811k-sample.json fixture missing — skipping detection accuracy tests');
} else {
  const fixture = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8'));

  // ── 1. Classifier-only detection rate ───────────────────────────────────────

  test('classifier detection rate meets floor on wm811k-sample', () => {
    const realPatternWafers = fixture.filter(s => {
      const label = LABEL_MAP[s.failureType];
      return label && label !== 'none' && label !== 'random';
    });

    let detected = 0;
    for (const sample of realPatternWafers) {
      const pitchX = sample.gridCols > 0 ? 300 / sample.gridCols : 10;
      const pitchY = sample.gridRows > 0 ? 300 / sample.gridRows : 10;
      let result;
      try {
        result = buildWaferMap({
          results: sample.results,
          waferConfig: { diameter: 300 },
          dieConfig: { width: pitchX, height: pitchY },
        });
      } catch { continue; }

      const c = classifyPattern(result.dies, result.wafer, { passBins: [1], ringCount: 4 });
      const got = c?.pattern ?? 'none';
      if (got !== 'none' && got !== 'random') detected++;
    }

    const rate = detected / realPatternWafers.length;
    assert.ok(
      rate >= CLASSIFIER_DETECTION_FLOOR,
      `Classifier detection rate ${(rate * 100).toFixed(1)}% is below floor ` +
      `${(CLASSIFIER_DETECTION_FLOOR * 100).toFixed(0)}% ` +
      `(${detected}/${realPatternWafers.length} wafers detected)`,
    );
  });

  // ── 2. Combined (classifier + regional) detection rate ──────────────────────

  test('combined detection rate meets floor on wm811k-sample', () => {
    const realPatternWafers = fixture.filter(s => {
      const label = LABEL_MAP[s.failureType];
      return label && label !== 'none' && label !== 'random';
    });

    let detected = 0;
    for (const sample of realPatternWafers) {
      const expected = LABEL_MAP[sample.failureType];
      const pitchX = sample.gridCols > 0 ? 300 / sample.gridCols : 10;
      const pitchY = sample.gridRows > 0 ? 300 / sample.gridRows : 10;
      let result;
      try {
        result = buildWaferMap({
          results: sample.results,
          waferConfig: { diameter: 300 },
          dieConfig: { width: pitchX, height: pitchY },
        });
      } catch { continue; }

      // Classifier fired?
      const c = classifyPattern(result.dies, result.wafer, { passBins: [1], ringCount: 4 });
      const got = c?.pattern ?? 'none';
      if (got !== 'none' && got !== 'random') { detected++; continue; }

      // Regional analysis rescue?
      let summary;
      try { summary = analyzeWaferMap(result, { passBins: [1] }); } catch { continue; }
      const firedFamilies = summary.findings
        .map(f => f.comparison.family)
        .filter(f => REGIONAL_FAMILIES.has(f));
      const semanticMatch = firedFamilies.some(
        f => (SEMANTIC_FAMILIES[expected] ?? []).includes(f),
      );
      if (semanticMatch) detected++;
    }

    const rate = detected / realPatternWafers.length;
    assert.ok(
      rate >= COMBINED_DETECTION_FLOOR,
      `Combined detection rate ${(rate * 100).toFixed(1)}% is below floor ` +
      `${(COMBINED_DETECTION_FLOOR * 100).toFixed(0)}% ` +
      `(${detected}/${realPatternWafers.length} wafers detected)`,
    );
  });

  // ── 3. Per-pattern classifier sanity — each pattern type gets at least 1 hit ─

  const DETECTABLE_TYPES = ['Edge-Ring', 'Edge-Loc', 'Center', 'Near-full', 'Scratch'];

  for (const failureType of DETECTABLE_TYPES) {
    test(`classifier detects at least 1 of 3 "${failureType}" samples`, () => {
      const samples = fixture.filter(s => s.failureType === failureType);
      if (!samples.length) return;

      let hits = 0;
      for (const sample of samples) {
        const pitchX = sample.gridCols > 0 ? 300 / sample.gridCols : 10;
        const pitchY = sample.gridRows > 0 ? 300 / sample.gridRows : 10;
        let result;
        try {
          result = buildWaferMap({
            results: sample.results,
            waferConfig: { diameter: 300 },
            dieConfig: { width: pitchX, height: pitchY },
          });
        } catch { continue; }

        const c = classifyPattern(result.dies, result.wafer, { passBins: [1], ringCount: 4 });
        const got = c?.pattern ?? 'none';
        if (got !== 'none' && got !== 'random') hits++;
      }

      assert.ok(
        hits >= 1,
        `"${failureType}": 0 of ${samples.length} samples detected by classifier`,
      );
    });
  }
}
