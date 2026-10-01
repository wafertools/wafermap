import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { analyzeWaferLot, buildWaferMap } from '../dist/index.js';
import { binomialUpperTail, benjaminiHochberg } from '../dist/packages/stats/math.js';

test('binomialUpperTail is the exact upper tail', () => {
  assert.ok(Math.abs(binomialUpperTail(8, 10, 0.5) - 56 / 1024) < 1e-12);
  assert.equal(binomialUpperTail(0, 10, 0.3), 1);
  assert.equal(binomialUpperTail(11, 10, 0.3), 0);
});

test('benjaminiHochberg adjusts in the order given and stays monotone', () => {
  const adjusted = benjaminiHochberg([0.01, 0.04, 0.03]);
  assert.deepEqual(adjusted.map(v => +v.toFixed(12)), [0.03, 0.04, 0.04]);
});

const DATA = join(dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'examples', 'data');

function loadWafers(name, count) {
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
  return [...byWafer].slice(0, count).map(([wafer, results]) => buildWaferMap({
    ...meta, results, waferConfig: { ...meta.waferConfig, metadata: { lot: name, wafer } } }));
}

test('a lot too small for failures to recur significantly keeps its per-wafer findings', () => {
  const lot = analyzeWaferLot(loadWafers('edge-ring', 2));
  assert.ok(!lot.findings.some(f => f.id === 'lot-repeat:spatialPattern|lot'));
});

test('the lot pattern lists the ring findings it explains under it', () => {
  const lot = analyzeWaferLot(loadWafers('edge-ring', 8));
  const pattern = lot.findings.find(f => f.id === 'lot-repeat:spatialPattern|lot');
  assert.ok(pattern, 'a lot pattern');
  const nested = lot.findings.filter(f => pattern.relatedIds?.includes(f.id));
  assert.ok(nested.some(f => f.comparison.family === 'ring'), 'a ring finding is nested');
  assert.ok(nested.every(f => f.id !== pattern.id));
});
