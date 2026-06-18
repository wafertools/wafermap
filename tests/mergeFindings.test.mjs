import test from 'node:test';
import assert from 'node:assert/strict';

import {
  analyzeWaferMap,
  buildWaferMap,
  classifyDie,
  clipDiesToWafer,
  createWafer,
  generateDies,
} from '../dist/index.js';

import {
  parseRegionKey,
  areQuadrantsAdjacent,
  sectorCompassNames,
} from '../dist/packages/stats/regions.js';

// ── Shared region utilities ─────────────────────────────────────────────────

test('parseRegionKey parses ring / quadrant / sector keys', () => {
  assert.deepEqual(parseRegionKey('ring:2'), { family: 'ring', ring: 2 });
  assert.deepEqual(parseRegionKey('quadrant:NE'), { family: 'quadrant', quadrant: 'NE' });
  assert.deepEqual(parseRegionKey('sector:NNE'), { family: 'sector', sector: 'NNE' });
  assert.equal(parseRegionKey('reticle-position:cell:1,0').family, 'unknown');
});

test('areQuadrantsAdjacent — edges adjacent, diagonals not', () => {
  assert.equal(areQuadrantsAdjacent('NE', 'NW'), true);
  assert.equal(areQuadrantsAdjacent('NE', 'SE'), true);
  assert.equal(areQuadrantsAdjacent('NE', 'SW'), false); // diagonal
  assert.equal(areQuadrantsAdjacent('NW', 'SE'), false); // diagonal
});

test('sectorCompassNames returns the right count for 4/8/16/32', () => {
  assert.equal(sectorCompassNames(4).length, 4);
  assert.equal(sectorCompassNames(8).length, 8);
  assert.equal(sectorCompassNames(16).length, 16);
  assert.equal(sectorCompassNames(32).length, 16); // 32 reuses the 16-point names
  assert.equal(sectorCompassNames(7).length, 16);  // invalid → default 16
});

// ── Integration: adjacent ring findings merge ────────────────────────────────

function makeWafer() {
  // Auto grid (omit gridSize) so the grid actually spans the wafer radius and
  // populates all 5 rings — gridSize:N would cap the grid at ±N regardless of size.
  const wafer = createWafer({ diameter: 100 });
  const dies = clipDiesToWafer(
    generateDies(wafer, { width: 5, height: 5 }),
    wafer,
    { width: 5, height: 5 },
  ).filter((die) => !die.partial);
  return { wafer, dies };
}

const MERGE_OPTS = {
  ringCount: 5,
  minimumSampleSize: 3,
  minimumEffectSize: 0.2,
  // keep pattern classification off so we test the raw merge, not pattern grouping
  enablePatternClassification: false,
};

test('adjacent ring yield findings merge into one Rings a–b finding', () => {
  const { wafer, dies } = makeWafer();
  // Rings 4,5 fail (bin 2); rings 1–3 pass — a contiguous outer band, with a
  // good-enough core that each side is significant against the other.
  const enriched = dies.map((die) => {
    const { ring } = classifyDie(die, wafer, { ringCount: 5 });
    return { ...die, hbin: ring >= 4 ? 2 : 1 };
  });

  const summary = analyzeWaferMap(
    buildWaferMap({ dies: enriched, waferConfig: { diameter: 100 }, passBins: [1] }),
    MERGE_OPTS,
  );

  const ringYield = summary.findings.filter(
    (f) => f.variable.kind === 'yield' && f.comparison.family === 'ring',
  );

  // The failing edge band (rings 4–5) collapses to a single 'lower' finding.
  const band = ringYield.find((f) => f.effect.direction === 'lower');
  assert.ok(band, 'expected a merged lower-yield edge band');
  assert.match(band.comparison.left, /^Rings \d+–\d+$/);
  assert.deepEqual([...band.highlight.regionKeys].sort(), ['ring:4', 'ring:5']);

  // Audit trail: relatedIds names the per-region findings it replaced.
  assert.deepEqual([...band.relatedIds].sort(), ['yield:ring:4', 'yield:ring:5']);
  assert.equal(band.id, 'yield:ring:4-5');

  // highlight.dieKeys is the union — equals every die in rings 4–5, with no dupes.
  const expectedBandDies = enriched.filter((d) => {
    const { ring } = classifyDie(d, wafer, { ringCount: 5 });
    return ring >= 4;
  }).length;
  assert.equal(band.highlight.dieKeys.length, expectedBandDies);
  assert.equal(new Set(band.highlight.dieKeys).size, band.highlight.dieKeys.length);

  // Merged stats reflect the union: a real, finite p-value computed fresh.
  assert.ok(band.stats.pValue !== undefined && Number.isFinite(band.stats.pValue));
});

test('non-adjacent same-signal rings do NOT merge', () => {
  const { wafer, dies } = makeWafer();
  // Rings 1 (core) and 4 fail; rings 2,3,5 pass — a gap at rings 2–3 breaks
  // adjacency between the two failing rings.
  const enriched = dies.map((die) => {
    const { ring } = classifyDie(die, wafer, { ringCount: 5 });
    return { ...die, hbin: (ring === 1 || ring === 4) ? 2 : 1 };
  });

  const summary = analyzeWaferMap(
    buildWaferMap({ dies: enriched, waferConfig: { diameter: 100 }, passBins: [1] }),
    MERGE_OPTS,
  );

  // No ring finding may span the non-adjacent failing rings 1 and 4.
  for (const f of summary.findings.filter((f) => f.comparison.family === 'ring')) {
    const rings = (f.highlight.regionKeys ?? []).map((k) => Number(k.slice('ring:'.length)));
    assert.ok(
      !(rings.includes(1) && rings.includes(4)),
      `rings 1 and 4 must not merge: ${f.comparison.left}`,
    );
  }
});
