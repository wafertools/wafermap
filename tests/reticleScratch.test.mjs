import test from 'node:test';
import assert from 'node:assert/strict';
import { makeResults, WAFER_CONFIG, DIE_CONFIG } from '../docs/examples/data.js';
import { buildWaferMap } from '../dist/index.js';
import { analyzeWaferMap } from '../dist/packages/stats/index.js';

const RETICLE = { width: 4, height: 3, anchorDie: { x: 1, y: 0 } };

function analyse(flags, scratchLine) {
  let results = makeResults({ seed: 19, ...flags });
  if (scratchLine) {
    const line = new Set();
    for (let t = -12; t <= 12; t++) { line.add(`${t},${Math.round(t * 0.6) + 2}`); line.add(`${t},${Math.round(t * 0.6) + 3}`); }
    results = results.map(d => line.has(`${d.x},${d.y}`) ? { ...d, hbin: 7, sbin: 17 } : d);
  }
  return analyzeWaferMap(buildWaferMap({ results, waferConfig: WAFER_CONFIG, dieConfig: DIE_CONFIG, reticleConfig: RETICLE }));
}

test('a reticle cell\'s repeated failures do not turn an edge arc into a scratch', () => {
  const s = analyse({ edgeFail: true, reticlePattern: true });
  assert.ok(s.findings.some(f => f.comparison.family === 'reticle-position' && f.severity !== 'info'), 'the cell has its own finding');
  assert.notEqual(s.stats.spatialPattern.pattern, 'scratch');
  assert.match(s.stats.spatialPattern.note ?? '', /failures set aside/);
  assert.ok(!s.findings.some(f => f.id === 'spatial-pattern:scratch'));
});

test('a real scratch is still a scratch on a wafer with a reticle-cell defect', () => {
  const s = analyse({ reticlePattern: true }, true);
  assert.equal(s.stats.spatialPattern.pattern, 'scratch');
  assert.ok(s.findings.some(f => f.id === 'spatial-pattern:scratch'));
});
