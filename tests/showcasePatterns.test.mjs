// The showcase's spatial-pattern scenarios (docs/examples/showcase.html), checked
// against what their generator (docs/examples/data/generate-demos.js) put there.
// The data is synthetic, so the right answer is known:
//
// - edge-ring:  failure probability rises steeply over the outer three dies of
//               every wafer — an edge ring on 8/8 wafers.
// - parametric: leakage rises with radius and fails its bin limit near the edge
//               on every wafer — an edge ring on 6/6 — plus one hotspot per wafer
//               at a different place each time, which is not a lot pattern.
// - cluster:    two or three defect clusters per wafer, all within 6 dies of the
//               centre of a 20-die-radius wafer — a centre cluster on 7/7.
// - high-yield: uniform ~1% random fails — no spatial pattern at all.
//
// A pattern visible on every wafer must be reported on every wafer, as one lot
// finding; the regional and cluster findings it explains sit under it rather
// than beside it as separate, weaker-looking patterns.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { analyzeWaferLot, buildWaferMap } from '../dist/index.js';

const DATA = join(dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'examples', 'data');

function loadScenario(name) {
  const meta = JSON.parse(readFileSync(join(DATA, `${name}.meta.json`), 'utf8'));
  const [header, ...lines] = readFileSync(join(DATA, `${name}.csv`), 'utf8').trim().split('\n');
  const cols = header.split(',');
  const at = (c) => cols.indexOf(c);
  const byWafer = new Map();
  for (const line of lines) {
    const v = line.split(',');
    const wafer = v[at('wafer')];
    if (!byWafer.has(wafer)) byWafer.set(wafer, []);
    byWafer.get(wafer).push({ x: +v[at('x')], y: +v[at('y')], hbin: +v[at('hbin')], sbin: +v[at('sbin')] });
  }
  return [...byWafer].map(([wafer, results]) => buildWaferMap({
    ...meta, results, waferConfig: { ...meta.waferConfig, metadata: { lot: name, wafer } } }));
}

const EDGE = new Set(['Edge-ring', 'Edge-local']);
const CENTRE = new Set(['Center cluster', 'Donut']);

const SCENARIOS = [
  { name: 'edge-ring',  labels: EDGE,   ring: 'Ring 4 (edge)' },
  { name: 'parametric', labels: EDGE,   ring: 'Ring 4 (edge)' },
  { name: 'cluster',    labels: CENTRE, ring: 'Ring 1 (core)' },
];

for (const { name, labels, ring } of SCENARIOS) {
  test(`showcase ${name}: the lot reports its pattern on every wafer, once`, () => {
    const maps = loadScenario(name);
    const lot = analyzeWaferLot(maps);
    const patterns = lot.findings.filter(f => f.variable.kind === 'spatialPattern');
    assert.equal(patterns.length, 1, `one lot pattern, got: ${patterns.map(f => f.summary).join(' | ')}`);
    const [pattern] = patterns;
    assert.ok(labels.has(pattern.comparison.left), `wrong pattern: ${pattern.summary}`);
    assert.deepEqual([...pattern.highlight.waferIndices].sort((a, b) => a - b), maps.map((_, i) => i),
      `on every wafer: ${pattern.summary}`);
    for (const i of pattern.highlight.waferIndices) {
      assert.ok(pattern.highlight.dieKeysByWafer?.[i]?.length, `wafer ${i + 1} names the dies to highlight`);
    }

    // What the pattern explains is listed under it, not beside it.
    const nested = new Set(pattern.relatedIds ?? []);
    const stray = lot.findings.filter(f => !nested.has(f.id) && (
      f.comparison.family === 'cluster' || f.comparison.family === 'edge-arc' ||
      (f.comparison.family === 'ring' && f.comparison.left === ring && f.variable.kind === 'yield')));
    assert.deepEqual(stray.map(f => f.summary), [], 'findings the pattern explains are nested under it');
  });
}

test('showcase high-yield: uniform random fails raise no lot pattern', () => {
  const lot = analyzeWaferLot(loadScenario('high-yield'));
  const spatial = lot.findings.filter(f => f.variable.kind === 'spatialPattern' ||
    f.comparison.family === 'cluster' || f.comparison.family === 'edge-arc');
  assert.deepEqual(spatial.map(f => f.summary), []);
});
