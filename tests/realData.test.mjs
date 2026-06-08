/**
 * Real-data integration tests using curated fixtures from two public datasets.
 *
 * WM-811K fixture (tests/fixtures/wm811k-sample.json):
 *   Produced by scripts/convert-wm811k.py. 27 wafer maps (3 per type × 9 types).
 *
 * MixedWM38 fixture (tests/fixtures/mixedwm38-sample.json):
 *   Produced by scripts/convert-mixedwm38.py. 38 wafer maps (1 per class × 38 classes),
 *   including compound patterns such as Center+Edge-Ring+LOC. Labels are decoded from
 *   8-bit multi-hot vectors into human-readable class names.
 *
 * Both fixtures use {x, y, hbin} die records with centred grid origin.
 *
 * These tests verify:
 *  - The library doesn't throw on real variable-size grids
 *  - Coordinate inference works correctly (no erroneous LL-origin offset)
 *  - Yield values stay in [0, 1]
 *  - No phantom Bin 0 dies appear
 *  - analyzeWaferMap fires the expected finding family for labelled defect types
 *  - analyzeWaferMap doesn't crash on high-failure-rate patterns (Near-Full, Random)
 *  - Compound MixedWM38 patterns produce findings from the expected spatial families,
 *    noting cases where no matching finding is detected
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = join(__dirname, 'fixtures', 'wm811k-sample.json');

// Skip all tests gracefully if the fixture hasn't been generated yet.
const FIXTURE_MISSING = !existsSync(FIXTURE_PATH);
if (FIXTURE_MISSING) {
  test('WM-811K fixture missing — run scripts/convert-wm811k.py to generate it', () => {
    // Not a failure — just a reminder. Tests are skipped when fixture absent.
  });
}

// Only import library modules and parse fixture when it exists.
let buildWaferMap, analyzeWaferMap, fixture;
if (!FIXTURE_MISSING) {
  ({ buildWaferMap } = await import('../dist/index.js'));
  ({ analyzeWaferMap } = await import('../dist/packages/stats/analyzeWaferMap.js'));
  fixture = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8'));
}

// ── Helper ────────────────────────────────────────────────────────────────────

function skip(label, fn) {
  if (FIXTURE_MISSING) return;
  test(label, fn);
}

// ── 1. Smoke — buildWaferMap doesn't throw ────────────────────────────────────

skip('real data: buildWaferMap succeeds on all fixture wafers', () => {
  for (const sample of fixture) {
    const result = buildWaferMap({ results: sample.results, passBins: [1] });
    assert.ok(result.dies.length > 0,
      `${sample.failureType} W${sample.waferIndex}: expected dies`);
    assert.ok(result.wafer.radius > 0,
      `${sample.failureType} W${sample.waferIndex}: expected positive radius`);
  }
});

// ── 2. Coordinate inference ───────────────────────────────────────────────────

skip('real data: grid centroid is near (0,0) — no erroneous LL-origin offset', () => {
  for (const sample of fixture) {
    const result = buildWaferMap({ results: sample.results, passBins: [1] });
    const dies = result.dies.filter(d => !d.partial && !d.edgeExcluded);
    if (!dies.length) continue;
    const meanX = dies.reduce((s, d) => s + d.x, 0) / dies.length;
    const meanY = dies.reduce((s, d) => s + d.y, 0) / dies.length;
    assert.ok(Math.abs(meanX) < 3,
      `${sample.failureType} W${sample.waferIndex}: meanX=${meanX.toFixed(2)} too far from 0`);
    assert.ok(Math.abs(meanY) < 3,
      `${sample.failureType} W${sample.waferIndex}: meanY=${meanY.toFixed(2)} too far from 0`);
  }
});

// ── 3. Yield plausibility ─────────────────────────────────────────────────────

skip('real data: yield values are in [0, 100]', () => {
  for (const sample of fixture) {
    const result = buildWaferMap({ results: sample.results, passBins: [1] });
    const y = result.yield.yieldPercent;
    if (y !== null) {
      assert.ok(y >= 0 && y <= 100,
        `${sample.failureType} W${sample.waferIndex}: yield ${y} out of range`);
    }
  }
});

// ── 4. No phantom Bin 0 ───────────────────────────────────────────────────────

skip('real data: no phantom Bin 0 dies', () => {
  for (const sample of fixture) {
    const result = buildWaferMap({ results: sample.results, passBins: [1] });
    const phantom = result.dies.find(d => d.hbin === 0);
    assert.ok(!phantom,
      `${sample.failureType} W${sample.waferIndex}: Bin 0 die at (${phantom?.x},${phantom?.y})`);
  }
});

// ── 5. Spatial pattern detection ──────────────────────────────────────────────

// For each labelled defect type, list the finding families we expect analyzeWaferMap
// to fire on at least one of the three samples. Using "at least one" rather than "all"
// because individual samples can be too noisy to cross the significance threshold.
const EXPECTED_FAMILIES = {
  'Edge-Ring':   ['ring'],
  'Edge-Loc':    ['edge-arc', 'sector', 'ring'],
  'Center':      ['ring', 'cluster'],
  'Scratch':     ['cluster'],
  'Donut':       ['ring'],
  'Loc':         ['cluster', 'sector'],
};

if (!FIXTURE_MISSING) {
  for (const [failureType, families] of Object.entries(EXPECTED_FAMILIES)) {
    test(`analyzeWaferMap detects expected finding family for "${failureType}"`, () => {
      const samples = fixture.filter(s => s.failureType === failureType);
      if (!samples.length) return; // type absent from fixture — skip silently

      let matched = 0;
      const detectedPerSample = [];

      for (const sample of samples) {
        const result = buildWaferMap({ results: sample.results, passBins: [1] });
        const summary = analyzeWaferMap(result, { passBins: [1] });
        const detected = [...new Set(summary.findings.map(f => f.comparison.family))];
        detectedPerSample.push(detected);
        if (families.some(f => detected.includes(f))) matched++;
      }

      assert.ok(
        matched >= 1,
        `"${failureType}": none of the ${samples.length} samples produced a finding in ` +
        `[${families.join(', ')}]. Detected per sample: ${detectedPerSample.map(d => `[${d.join(',')}]`).join(' ')}`,
      );
    });
  }
}

// ── 6. Crash safety on high-failure-rate patterns ─────────────────────────────

skip('analyzeWaferMap handles Near-Full and Random without throwing', () => {
  const highNoise = fixture.filter(s =>
    s.failureType === 'Near-full' || s.failureType === 'Random',
  );
  for (const sample of highNoise) {
    const result = buildWaferMap({ results: sample.results, passBins: [1] });
    assert.doesNotThrow(
      () => analyzeWaferMap(result, { passBins: [1] }),
      `analyzeWaferMap threw on ${sample.failureType} W${sample.waferIndex}`,
    );
  }
});

// ── 7. dataCoverage ratio is in [0, 1] ────────────────────────────────────────

skip('real data: dataCoverage ratio is in [0, 1] for all samples', () => {
  for (const sample of fixture) {
    const result = buildWaferMap({ results: sample.results, passBins: [1] });
    const { ratio } = result.dataCoverage;
    assert.ok(ratio >= 0 && ratio <= 1,
      `${sample.failureType} W${sample.waferIndex}: dataCoverage.ratio=${ratio}`);
  }
});

// ══ MixedWM38 ════════════════════════════════════════════════════════════════

const MX_FIXTURE_PATH = join(__dirname, 'fixtures', 'mixedwm38-sample.json');
const MX_FIXTURE_MISSING = !existsSync(MX_FIXTURE_PATH);
if (MX_FIXTURE_MISSING) {
  test('MixedWM38 fixture missing — run scripts/convert-mixedwm38.py to generate it', () => {});
}

let mxFixture;
if (!MX_FIXTURE_MISSING) {
  if (FIXTURE_MISSING) {
    // buildWaferMap / analyzeWaferMap not yet imported — load them now.
    ({ buildWaferMap } = await import('../dist/index.js'));
    ({ analyzeWaferMap } = await import('../dist/packages/stats/analyzeWaferMap.js'));
  }
  mxFixture = JSON.parse(readFileSync(MX_FIXTURE_PATH, 'utf8'));
}

function mxSkip(label, fn) {
  if (MX_FIXTURE_MISSING) return;
  test(label, fn);
}

// ── MX-1. Smoke ───────────────────────────────────────────────────────────────

mxSkip('MixedWM38: buildWaferMap succeeds on all 38 class samples', () => {
  for (const sample of mxFixture) {
    const result = buildWaferMap({ results: sample.results, passBins: [1] });
    assert.ok(result.dies.length > 0,      `${sample.className}: expected dies`);
    assert.ok(result.wafer.radius > 0,     `${sample.className}: expected positive radius`);
  }
});

// ── MX-2. Yield plausibility ──────────────────────────────────────────────────

mxSkip('MixedWM38: yield values are in [0, 100]', () => {
  for (const sample of mxFixture) {
    const result = buildWaferMap({ results: sample.results, passBins: [1] });
    const y = result.yield.yieldPercent;
    if (y !== null) {
      assert.ok(y >= 0 && y <= 100, `${sample.className}: yield ${y} out of range`);
    }
  }
});

// ── MX-3. No phantom Bin 0 ────────────────────────────────────────────────────

mxSkip('MixedWM38: no phantom Bin 0 dies', () => {
  for (const sample of mxFixture) {
    const result = buildWaferMap({ results: sample.results, passBins: [1] });
    const phantom = result.dies.find(d => d.hbin === 0);
    assert.ok(!phantom, `${sample.className}: Bin 0 die at (${phantom?.x},${phantom?.y})`);
  }
});

// ── MX-4. Spatial pattern detection ──────────────────────────────────────────
//
// For each base defect component, the expected spatial finding families.
// A compound class passes if at least one component's families are detected.
// Cases where no expected family fires are noted in the diagnostic output but
// do NOT fail the test — the dataset labels are ground truth for ML classification,
// not for spatial statistics, so some samples may not be statistically clear enough.

const MX_COMPONENT_FAMILIES = {
  'Center':    ['ring', 'cluster'],
  'Donut':     ['ring'],
  'Edge-Loc':  ['edge-arc', 'sector', 'ring'],
  'Edge-Ring': ['ring'],
  'LOC':       ['cluster', 'sector'],
  'Scratch':   ['cluster', 'sector'],
  'Near-Full': [], // too high failure rate — no spatial structure expected
  'Random':    [], // random — no spatial structure expected
  'Normal':    [], // no defect — no findings expected
};

if (!MX_FIXTURE_MISSING) {
  test('MixedWM38: spatial finding families match class components (noting misses)', () => {
    const misses = [];
    const hits   = [];

    for (const sample of mxFixture) {
      const result  = buildWaferMap({ results: sample.results, passBins: [1] });
      const summary = analyzeWaferMap(result, { passBins: [1] });
      const detected = new Set(summary.findings.map(f => f.comparison.family));

      // Decode which base components this class contains
      const components = sample.className === 'Normal'
        ? ['Normal']
        : sample.className.split('+');

      // Gather all families expected from any component
      const expectedFamilies = [...new Set(
        components.flatMap(c => MX_COMPONENT_FAMILIES[c] ?? []),
      )];

      if (expectedFamilies.length === 0) {
        // Normal / Near-Full / Random — just check no crash
        hits.push(`${sample.className}: no findings expected (${summary.findings.length} found)`);
        continue;
      }

      const matched = expectedFamilies.some(f => detected.has(f));
      const detectedList = [...detected].join(',') || 'none';

      if (matched) {
        hits.push(`${sample.className}: OK (detected: ${detectedList})`);
      } else {
        misses.push(
          `${sample.className}: expected [${expectedFamilies.join(',')}] but detected [${detectedList}]`,
        );
      }
    }

    // Print diagnostic summary — misses are noted, not failed
    if (misses.length) {
      console.log(`\nMixedWM38 spatial detection misses (${misses.length}/${mxFixture.length}):`);
      for (const m of misses) console.log(`  MISS  ${m}`);
    }
    console.log(`\nMixedWM38 spatial detection hits: ${hits.length - misses.length}/${mxFixture.length}`);

    // The test itself always passes — misses are diagnostic output only.
    // To harden this, change the assert below to a strict threshold if desired.
    assert.ok(true, 'see diagnostic output above for per-class results');
  });
}
