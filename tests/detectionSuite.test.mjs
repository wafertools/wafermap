// The detection suite: what analyzeWaferMap and analyzeWaferLot find, checked against data whose answer is
// known. Where the synthesis suite asks "does the panel say what the findings say", this one asks "are the
// findings right".
//
//   1. Planted patterns: a pattern of known shape and strength must be found, and found as what it is.
//   2. Clean data: random failures with no pattern must not read as one.
//   3. The same wafer carried differently (a quarter turn, a mirror, its dies in another order, its bins
//      renumbered) must give the same findings, on the same dies, with the same statistics.
//   4. The statistics, recomputed here by routes that share no code with the library.
//
// The data comes from tests/fixtures/synthLots.mjs: invented, seeded, generic.

import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeWaferMap, analyzeWaferLot } from '../dist/index.js';
import { buildLot, logicalWafers, placeDie } from './fixtures/synthLots.mjs';

const strong = (f) => f.severity !== 'info';
const wafer = (spec) => {
  const [m] = buildLot({ wafers: 1, ...spec });
  return { m, s: analyzeWaferMap(m) };
};
/** The dies a spec planted with logical bin `bin` on its first wafer, as grid keys. */
const plantedKeys = (spec, bin) => new Set(logicalWafers({ wafers: 1, ...spec })[0].dies.filter(d => d.bin === bin).map(d => `${d.x},${d.y}`));
/** A notable or unusual finding with at least `share` of its dies on the planted ones. */
const foundOn = (findings, planted, share = 0.3) => findings.filter(strong).find(f => {
  const keys = f.highlight.dieKeys ?? [];
  return keys.length > 0 && keys.filter(k => planted.has(k)).length / keys.length >= share;
});

// ── 1. Planted patterns ──────────────────────────────────────────────────────

const SEEDS = 10;

test('a pattern of moderate strength is found on every wafer it is planted on', () => {
  const missed = [];
  for (const region of ['edge-ring', 'centre', 'donut', 'quadrant-NE', 'cluster', 'edge-arc-N', 'edge-arc-E']) {
    for (let seed = 0; seed < SEEDS; seed++) {
      const spec = { name: `plant:${region}:0.4:${seed}`, signatures: [{ region, p: 0.4, bin: 5 }] };
      if (!foundOn(wafer(spec).s.findings, plantedKeys(spec, 5))) missed.push(`${region} seed ${seed}`);
    }
  }
  assert.deepEqual(missed, []);
});

test('a dense scratch is found, at any angle', () => {
  const missed = [];
  for (const region of ['scratch', 'scratch-diagonal', 'scratch-steep']) {
    let found = 0;
    for (let seed = 0; seed < SEEDS; seed++) {
      const spec = { name: `plant:${region}:0.7:${seed}`, signatures: [{ region, p: 0.7, bin: 3 }] };
      if (foundOn(wafer(spec).s.findings, plantedKeys(spec, 3))) found++;
    }
    if (found < SEEDS - 1) missed.push(`${region}: ${found}/${SEEDS}`);
  }
  assert.deepEqual(missed, []);
});

test('an arc at the edge is called an edge arc wherever it is, due east included', () => {
  // Due east is where an angle in [0°, 360°) wraps: an arc across it once measured as a near-full circle.
  for (const region of ['edge-arc-N', 'edge-arc-E']) {
    let arcs = 0;
    for (let seed = 0; seed < SEEDS; seed++) {
      const spec = { name: `plant:${region}:0.6:${seed}`, signatures: [{ region, p: 0.6, bin: 5 }] };
      if (foundOn(wafer(spec).s.findings, plantedKeys(spec, 5))?.comparison.family === 'edge-arc') arcs++;
    }
    assert.ok(arcs >= SEEDS - 1, `${region}: ${arcs}/${SEEDS} edge arcs`);
  }
});

test('an edge ring and a centre cluster are classified as what they are', () => {
  for (const [region, label] of [['edge-ring', 'edge-ring'], ['centre', 'center']]) {
    let right = 0;
    for (let seed = 0; seed < SEEDS; seed++) {
      const spec = { name: `plant:${region}:0.3:${seed}`, signatures: [{ region, p: 0.3, bin: 5 }] };
      if (wafer(spec).s.stats.spatialPattern?.pattern === label) right++;
    }
    assert.ok(right >= SEEDS - 1, `${region}: classified ${label} on ${right}/${SEEDS}`);
  }
});

// ── 2. Clean data ────────────────────────────────────────────────────────────

const CLEAN = 30;
const REGION_FAMILIES = new Set(['ring', 'quadrant', 'sector', 'reticle-position', 'test-site']);

test('random failures do not read as a regional pattern', () => {
  // With every rate comparison on a wafer one family for the false-discovery rate, and an exact test where
  // counts are small, a clean wafer almost never reports a region. Before, one in two did at a 1% fail rate.
  const flagged = [];
  for (const base of [0.01, 0.03, 0.08, 0.15]) {
    let n = 0;
    for (let seed = 0; seed < CLEAN; seed++) {
      if (wafer({ name: `clean:${base}:${seed}`, baseRate: base }).s.findings.some(f => strong(f) && REGION_FAMILIES.has(f.comparison.family))) n++;
    }
    if (n > 2) flagged.push(`${base}: ${n}/${CLEAN} clean wafers with a notable region`);
  }
  assert.deepEqual(flagged, []);
});

test('random failures are never called unusual', () => {
  const flagged = [];
  for (const base of [0.01, 0.03, 0.08, 0.15]) {
    for (let seed = 0; seed < CLEAN; seed++) {
      const f = wafer({ name: `clean:${base}:${seed}`, baseRate: base }).s.findings.find(x => x.severity === 'unusual' && x.comparison.family !== 'cluster' && x.comparison.family !== 'edge-arc');
      if (f) flagged.push(`${base} seed ${seed}: ${f.summary}`);
    }
  }
  assert.deepEqual(flagged, []);
});

test('a lot of clean wafers has no lot finding', () => {
  const flagged = [];
  for (const base of [0.01, 0.03, 0.08]) {
    for (let seed = 0; seed < 6; seed++) {
      const lot = analyzeWaferLot(buildLot({ name: `cleanlot:${base}:${seed}`, wafers: 6, baseRate: base }));
      for (const f of lot.findings.filter(x => strong(x) && x.level === 'lot')) flagged.push(`${base} seed ${seed}: ${f.summary}`);
    }
  }
  assert.ok(flagged.length <= 1, flagged.join('\n'));
});

test('random failures do not read as a cluster', { todo: 'a cluster is tested against a neighbourhood chosen because it fails, so a random clump at a moderate fail rate reads as a cluster' }, () => {
  let n = 0;
  for (let seed = 0; seed < CLEAN; seed++) {
    if (wafer({ name: `clean:0.08:${seed}`, baseRate: 0.08 }).s.findings.some(f => strong(f) && (f.comparison.family === 'cluster' || f.comparison.family === 'edge-arc'))) n++;
  }
  assert.ok(n <= 2, `${n}/${CLEAN} clean wafers at 8% with a notable cluster`);
});

// ── 3. The same wafer, carried differently ───────────────────────────────────

/**
 * What a wafer's findings say, independent of how its dies were laid out or ordered: each finding's kind,
 * statistics and dies, its dies taken back to where the spec planted them. Labels are left out: a quarter
 * turn renames NE to NW, and that is the point.
 */
function signature(findings, spec) {
  const back = new Map();
  for (const { dies } of logicalWafers({ wafers: 1, ...spec })) for (const d of dies) back.set(placeDie(d.x, d.y, spec).join(','), `${d.x},${d.y}`);
  return findings.map(f => [
    f.comparison.family, f.variable.kind, f.variable.bin ?? '', f.effect.direction, f.severity, f.stats.method,
    f.effect.absoluteDelta?.toPrecision(10), f.stats.pValue?.toPrecision(8), f.stats.adjustedPValue?.toPrecision(8),
    (f.highlight.dieKeys ?? []).map(k => back.get(k) ?? `?${k}`).sort().join(' '),
  ].join('|')).sort();
}
const CARRIED = [
  { name: 'carried:ring', signatures: [{ region: 'edge-ring', p: 0.3, bin: 5 }] },
  { name: 'carried:quadrant', signatures: [{ region: 'quadrant-NE', p: 0.3, bin: 6 }] },
  { name: 'carried:arc', signatures: [{ region: 'edge-arc-N', p: 0.6, bin: 5 }, { region: 'cluster', p: 0.8, bin: 4 }] },
  { name: 'carried:scratch', signatures: [{ region: 'scratch-diagonal', p: 0.7, bin: 3 }] },
].map(s => ({ ...s, holeAtCentre: true }));

test('a quarter turn gives the same findings on the same dies', () => {
  // The centre die is left out: it is the one die no turn moves, so it sits in one quadrant whichever way the
  // wafer faces. Every other region maps exactly onto another.
  for (const spec of CARRIED) {
    const base = signature(wafer(spec).s.findings, spec);
    for (const rotate of [90, 180, 270]) {
      const turned = { ...spec, rotate };
      assert.deepEqual(signature(wafer(turned).s.findings, turned), base, `${spec.name} turned ${rotate}°`);
      assert.equal(wafer(turned).s.stats.spatialPattern?.pattern, wafer(spec).s.stats.spatialPattern?.pattern, `${spec.name} ${rotate}°: classification`);
    }
  }
});

test('a mirror gives the same findings, quadrants apart', () => {
  // Each quadrant holds one half axis (NE the positive x axis, NW the positive y axis…). A mirror sends the
  // positive x axis to the negative x axis, which SW holds, so no mirror maps the quadrants onto each other.
  // The adjusted p-values are left out too: every rate comparison on a wafer is one family, so the quadrants'
  // own p-values move every other finding's adjustment a little. The raw statistics must not move at all.
  for (const spec of CARRIED) {
    const notQuadrant = (s) => s.filter(x => !x.startsWith('quadrant|')).map(x => x.split('|').filter((_, i) => i !== 8).join('|')).sort();
    const mirrored = { ...spec, mirror: true };
    assert.deepEqual(notQuadrant(signature(wafer(mirrored).s.findings, mirrored)), notQuadrant(signature(wafer(spec).s.findings, spec)), spec.name);
  }
});

test('the order the dies arrive in changes nothing', () => {
  for (const spec of CARRIED) {
    const shuffled = { ...spec, shuffle: true };
    assert.deepEqual(signature(wafer(shuffled).s.findings, shuffled), signature(wafer(spec).s.findings, spec), spec.name);
  }
});

test('renumbering the bins, pass bin included, changes only the numbers', () => {
  const map = { 1: 3, 2: 5, 3: 1, 4: 2, 5: 7, 6: 8, 7: 9 };
  const unbinned = (s) => s.map(x => x.split('|').filter((_, i) => i !== 2).join('|')).sort();
  for (const spec of CARRIED) {
    const renumbered = { ...spec, binMap: map };
    assert.deepEqual(unbinned(signature(wafer(renumbered).s.findings, renumbered)), unbinned(signature(wafer(spec).s.findings, spec)), spec.name);
  }
});

// ── 4. The statistics, recomputed ────────────────────────────────────────────

/** Upper tail of the standard normal, by the continued fraction for erfc (no shared code with the library). */
function normalUpper(z) {
  const x = Math.abs(z) / Math.SQRT2;
  let erfc;
  if (x < 2) {
    // Series for erf.
    let term = x, sum = x;
    for (let n = 1; n < 200; n++) { term *= -x * x / n; sum += term / (2 * n + 1); }
    erfc = 1 - (2 / Math.sqrt(Math.PI)) * sum;
  } else {
    let f = 0;
    for (let n = 60; n >= 1; n--) f = (n / 2) / (x + f);
    erfc = Math.exp(-x * x) / Math.sqrt(Math.PI) / (x + f);
  }
  return z >= 0 ? erfc / 2 : 1 - erfc / 2;
}
/** Two-sided Fisher exact, summing log-factorials directly. */
function fisherReference(a, b, c, d) {
  const lf = (n) => { let s = 0; for (let i = 2; i <= n; i++) s += Math.log(i); return s; };
  const r1 = a + b, r2 = c + d, c1 = a + c, n = r1 + r2;
  const base = lf(r1) + lf(r2) + lf(c1) + lf(n - c1) - lf(n);
  const lp = (x) => base - lf(x) - lf(r1 - x) - lf(c1 - x) - lf(r2 - c1 + x);
  const obs = lp(a);
  let p = 0;
  for (let x = Math.max(0, c1 - r2); x <= Math.min(r1, c1); x++) { const v = lp(x); if (v <= obs + 1e-7) p += Math.exp(v); }
  return Math.min(1, p);
}
/** The rate test the library documents: Fisher when an expected count is under five, else the pooled z. */
function rateP(hits, n, restHits, restN) {
  const N = n + restN, H = hits + restHits;
  if (Math.min(H, N - H) * Math.min(n, restN) / N < 5) return { p: fisherReference(hits, n - hits, restHits, restN - restHits), method: 'fisher-exact' };
  const pooled = H / N;
  const z = (hits / n - restHits / restN) / Math.sqrt(pooled * (1 - pooled) * (1 / n + 1 / restN));
  return { p: Math.min(1, 2 * normalUpper(Math.abs(z))), method: 'two-proportion-z', z };
}

/** Wafers with findings of every kind: patterns, scattered noise, renumbered pass bins. */
const STAT_WAFERS = [
  { name: 'stats:ring', signatures: [{ region: 'edge-ring', p: 0.2, bin: 5 }] },
  { name: 'stats:quadrant', signatures: [{ region: 'quadrant-NE', p: 0.15, bin: 6 }] },
  { name: 'stats:faint', baseRate: 0.01, signatures: [{ region: 'centre', p: 0.15, bin: 4 }] },
  { name: 'stats:renumbered', binMap: { 1: 3, 3: 1 }, signatures: [{ region: 'donut', p: 0.3, bin: 5 }] },
];

test('a ring or quadrant rate finding has the p-value its counts give, by the test the counts call for', () => {
  let checked = 0;
  for (const spec of STAT_WAFERS) {
    const { m, s } = wafer(spec);
    const passBins = m.passBins;
    const judged = m.dies.filter(d => !d.partial && !d.edgeExcluded);
    for (const f of s.findings) {
      if (!['ring', 'quadrant'].includes(f.comparison.family) || !f.highlight.dieKeys || f.comparison.left.includes('&')) continue;
      if (f.variable.label.includes(' and ')) continue;   // a merged hard/soft twin restates its hard bin's figures
      const hit = f.variable.kind === 'yield' ? (d) => passBins.includes(d.hbin)
        : f.variable.kind === 'hardBin' ? (d) => d.hbin === f.variable.bin
        : f.variable.kind === 'softBin' ? (d) => d.sbin === f.variable.bin : undefined;
      if (!hit) continue;
      const pool = judged.filter(d => (f.variable.kind === 'softBin' ? d.sbin : d.hbin) !== undefined);
      const inside = new Set(f.highlight.dieKeys);
      const L = pool.filter(d => inside.has(`${d.x},${d.y}`)), R = pool.filter(d => !inside.has(`${d.x},${d.y}`));
      const { p, method } = rateP(L.filter(hit).length, L.length, R.filter(hit).length, R.length);
      assert.equal(f.stats.method, method, `${spec.name} ${f.variable.label} @ ${f.comparison.left}`);
      // The library's normal tail is good to ~1.5e-7 absolute; Fisher it computes exactly.
      assert.ok(Math.abs(f.stats.pValue - p) <= 2e-7 + 1e-9 * p, `${spec.name} ${f.variable.label} @ ${f.comparison.left}: p ${f.stats.pValue} vs ${p}`);
      checked++;
    }
  }
  assert.ok(checked >= 8, `only ${checked} findings checked`);
});

test('every rate finding on a wafer is adjusted as one family: adjusted p rises with raw p, across kinds and regions', () => {
  for (const spec of [...STAT_WAFERS, { name: 'stats:many', signatures: [{ region: 'edge-ring', p: 0.2, bin: 5 }, { region: 'quadrant-SW', p: 0.2, bin: 6 }, { region: 'centre', p: 0.3, bin: 4 }] }]) {
    // A merged region ("Sectors E–NE") is re-tested over its union after the adjustment, with its run's weakest
    // multiplier, so it stands outside the family's ordering; the single regions are the family.
    const merged = (f) => /[–&]/.test(f.comparison.left) || /^(Rings|Quadrants|Sectors) /.test(f.comparison.left);
    const rates = wafer(spec).s.findings.filter(f => REGION_FAMILIES.has(f.comparison.family) && !merged(f) && f.variable.kind !== 'test' && f.stats.adjustedPValue !== undefined)
      .sort((a, b) => a.stats.pValue - b.stats.pValue);
    for (let i = 1; i < rates.length; i++) {
      assert.ok(rates[i].stats.adjustedPValue >= rates[i - 1].stats.adjustedPValue - 1e-15,
        `${spec.name}: ${rates[i - 1].variable.label} @ ${rates[i - 1].comparison.left} and ${rates[i].variable.label} @ ${rates[i].comparison.left} are adjusted as separate families`);
    }
    for (const f of rates) assert.ok(f.stats.adjustedPValue >= f.stats.pValue - 1e-15 && f.stats.adjustedPValue <= 0.05, `${spec.name}: ${f.summary}`);
  }
});

test('a lot finding combines its wafers\' z by Stouffer, weighted by each wafer\'s dies', () => {
  const spec = { name: 'stats:lot', wafers: 5, signatures: [{ region: 'edge-ring', p: 0.2, bin: 5 }, { region: 'quadrant-SW', p: 0.15, bin: 6, on: [0, 1, 2] }] };
  const maps = buildLot(spec);
  const lot = analyzeWaferLot(maps);
  let checked = 0;
  for (const f of lot.findings.filter(x => x.level === 'lot' && x.variable.kind === 'yield' && ['ring', 'quadrant'].includes(x.comparison.family) && x.highlight.dieKeysByWafer)) {
    let zw = 0, ww = 0;
    for (const [w, keys] of Object.entries(f.highlight.dieKeysByWafer)) {
      const pool = maps[+w].dies.filter(d => !d.partial && !d.edgeExcluded && d.hbin !== undefined);
      const inside = new Set(keys);
      const L = pool.filter(d => inside.has(`${d.x},${d.y}`)), R = pool.filter(d => !inside.has(`${d.x},${d.y}`));
      const pass = (d) => d.hbin === 1;
      const a = L.filter(pass).length, c = R.filter(pass).length;
      const pooled = (a + c) / pool.length;
      const z = (a / L.length - c / R.length) / Math.sqrt(pooled * (1 - pooled) * (1 / L.length + 1 / R.length));
      zw += Math.sqrt(pool.length) * z; ww += pool.length;
    }
    const p = Math.min(1, 2 * normalUpper(Math.abs(zw / Math.sqrt(ww))));
    assert.ok(Math.abs(f.stats.pValue - p) <= 2e-7 + 1e-9 * p, `${f.comparison.left}: ${f.stats.pValue} vs ${p}`);
    checked++;
  }
  assert.ok(checked >= 1, 'no lot region finding to check');
});

test('outlier wafers are the ones outside Tukey\'s fences, at least three points from the median', () => {
  const spec = { name: 'stats:outliers', wafers: 10, outlier: { wafer: 3, extra: 0.12 } };
  const lot = analyzeWaferLot(buildLot(spec));
  const ys = lot.lotYieldSeries.map(p => p.yieldPercent);
  const sorted = [...ys].sort((a, b) => a - b);
  const q = (t) => { const pos = t * (sorted.length - 1), k = Math.floor(pos); return sorted[k] + (sorted[Math.min(k + 1, sorted.length - 1)] - sorted[k]) * (pos - k); };
  const [q1, q3] = [q(0.25), q(0.75)], iqr = q3 - q1, median = q(0.5);
  const expected = ys.map((y, i) => [y, i]).filter(([y]) => (y < q1 - 1.5 * iqr || y > q3 + 1.5 * iqr) && Math.abs(y - median) >= 3).map(([, i]) => i);
  const got = lot.findings.filter(f => f.id.startsWith('inter-wafer:yield:')).map(f => f.highlight.waferIndices[0]).sort((a, b) => a - b);
  assert.deepEqual(got, expected);
  assert.ok(expected.includes(3), 'the planted outlier is one');
});
