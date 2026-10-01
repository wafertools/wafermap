// Whole-system properties of the findings, checked over generated wafers and lots
// rather than over one hand-picked case. Each of these was a bug that example tests
// passed for: two findings for one region (a mean and a limit fail rate in one merge
// group), adjacent regions left as separate rows, a sector run beside the quadrant
// that restates it. The generator is the demo data's (`docs/examples/data.js`) with
// every pattern flag in turn, so the patterns are known and the seeds fixed.

import test from 'node:test';
import assert from 'node:assert/strict';
import { buildWaferMap, analyzeWaferLot } from '../dist/index.js';
import { analyzeWaferMap } from '../dist/packages/stats/analyzeWaferMap.js';
import { visibleFindings } from '../dist/packages/stats/filterFindings.js';
import { areQuadrantsAdjacent, regionAngleBins, sectorCompassNames } from '../dist/packages/stats/regions.js';
import {
  makeResults, WAFER_CONFIG, DIE_CONFIG, HBIN_DEFS, SBIN_DEFS, TEST_DEFS, FUNCTIONAL_TEST_DEF,
} from '../docs/examples/data.js';

const FLAGS = ['edgeFail', 'quadrant', 'center', 'reticlePattern', 'cluster', 'edgeArc'];
const SECTORS = 8;
const OPTIONS = { enableTestValueAnalysis: true };

const flagsFor = (trial) => {
  const mask = (trial * 37 + 11) % 64;
  return Object.fromEntries(FLAGS.filter((_, i) => mask & (1 << i)).map(f => [f, true]));
};
const wafer = (flags, seed) => buildWaferMap({
  results: makeResults({ ...flags, seed }), waferConfig: WAFER_CONFIG, dieConfig: DIE_CONFIG,
  hbinDefs: HBIN_DEFS, sbinDefs: SBIN_DEFS, testDefs: [...TEST_DEFS, FUNCTIONAL_TEST_DEF], ringCount: 4 });

const WAFER_TRIALS = 48;
const LOT_TRIALS = 24;
const lots = Array.from({ length: LOT_TRIALS }, (_, t) => {
  const flags = flagsFor(t);
  const maps = [1, 2, 3, 4, 5].map(k => wafer(flags, t * 7 + k));
  return { flags, maps, lot: analyzeWaferLot(maps, OPTIONS) };
});
const waferFindings = Array.from({ length: WAFER_TRIALS }, (_, t) =>
  analyzeWaferMap(wafer(flagsFor(t), t + 1), OPTIONS).findings);

// ── Region keys, from a wafer finding's highlight or a lot finding's id ─────────

const metricOf = (f) => /^(?:lot-region:)?([^:|]+)/.exec(f.id)[1];
function keysOf(f) {
  if (f.highlight.regionKeys?.length) return f.highlight.regionKeys;
  const m = /(ring|sector|quadrant):([^:|]+)$/.exec(f.id);
  return m ? m[2].split('-').map(n => `${m[1]}:${n}`) : [];
}
const comparisonOf = (f) => [metricOf(f), f.variable.kind, f.variable.bin ?? '', f.variable.index ?? '', f.effect.direction].join('|');

function adjacent(family, a, b) {
  const x = a.slice(a.indexOf(':') + 1), y = b.slice(b.indexOf(':') + 1);
  if (family === 'ring') return Math.abs(+x - +y) === 1;
  if (family === 'quadrant') return areQuadrantsAdjacent(x, y);
  const names = sectorCompassNames(SECTORS);
  const d = Math.abs(names.indexOf(x) - names.indexOf(y));
  return d === 1 || d === names.length - 1;
}

/** Regions of one comparison and family that overlap or touch: a run that was not merged. */
function unmerged(findings) {
  const groups = new Map();
  for (const f of findings) {
    const family = f.comparison.family;
    if (!['ring', 'sector', 'quadrant'].includes(family)) continue;
    const key = `${comparisonOf(f)}|${family}`;
    (groups.get(key) ?? groups.set(key, []).get(key)).push(f);
  }
  const bad = [];
  for (const [key, fs] of groups) {
    for (let i = 0; i < fs.length; i++) for (let j = i + 1; j < fs.length; j++) {
      const a = keysOf(fs[i]), b = keysOf(fs[j]);
      const family = fs[i].comparison.family;
      if (a.some(k => b.includes(k)) || a.some(k => b.some(l => adjacent(family, k, l)))) {
        bad.push(`${key}: ${fs[i].comparison.left} / ${fs[j].comparison.left}`);
      }
    }
  }
  return bad;
}

test('wafer findings: no two rows for one region, and no adjacent regions left unmerged', () => {
  const bad = waferFindings.flatMap(unmerged);
  assert.deepEqual([...new Set(bad)], []);
});

test('lot findings: no two rows for one region, and no adjacent regions left unmerged', () => {
  const bad = lots.flatMap(({ lot }) => unmerged(lot.findings.filter(f => f.id.startsWith('lot-region:'))));
  assert.deepEqual([...new Set(bad)], []);
});

// ── A sector run and a quadrant that restate one another are one finding ────────

function sameRegionPairs(findings) {
  const bins = (f) => new Set(keysOf(f).flatMap(k => [...regionAngleBins(k, SECTORS)]));
  const regional = visibleFindings(findings).filter(f => ['sector', 'quadrant'].includes(f.comparison.family));
  const bad = [];
  for (const s of regional.filter(f => f.comparison.family === 'sector')) {
    for (const q of regional.filter(f => f.comparison.family === 'quadrant')) {
      if (comparisonOf(s) !== comparisonOf(q)) continue;
      const a = bins(s), b = bins(q);
      let both = 0;
      for (const x of a) if (b.has(x)) both++;
      if (both * 5 >= (a.size + b.size - both) * 3) bad.push(`${s.comparison.left} / ${q.comparison.left} (${comparisonOf(s)})`);
    }
  }
  return bad;
}

test('a sector run and the quadrant it mostly covers are not both shown', () => {
  const bad = [
    ...waferFindings.flatMap(sameRegionPairs),
    ...lots.flatMap(({ lot }) => sameRegionPairs(lot.findings.filter(f => f.id.startsWith('lot-region:')))),
  ];
  assert.deepEqual([...new Set(bad)], []);
});

// ── The lot is the same whichever order its wafers arrive in ────────────────────

test('lot findings do not depend on the order of the wafers', () => {
  const figure = (f) => `${f.id}|${f.severity}|${(f.effect.absoluteDelta ?? 0).toFixed(9)}|${(f.stats.pValue ?? 0).toExponential(6)}`;
  for (const { maps, lot } of lots.slice(0, 12)) {
    const forward = lot.findings.filter(f => f.id.startsWith('lot-region:')).map(figure).sort();
    const reversed = analyzeWaferLot([...maps].reverse(), OPTIONS).findings.filter(f => f.id.startsWith('lot-region:')).map(figure).sort();
    assert.deepEqual(reversed, forward);
  }
});

// ── What a finding says is what it measured ─────────────────────────────────────

test('a finding\'s sentence says the direction its effect has', () => {
  const all = [...waferFindings.flat(), ...lots.flatMap(({ lot }) => lot.findings)];
  const bad = all.filter(f => {
    if (f.effect.direction !== 'higher' && f.effect.direction !== 'lower') return false;
    const higher = /\bhigher\b/.test(f.summary), lower = /\blower\b/.test(f.summary);
    return higher !== lower && (f.effect.direction === 'higher') !== higher;
  });
  assert.deepEqual(bad.map(f => `${f.id}: ${f.summary}`), []);
});

// ── Noise is not a finding ──────────────────────────────────────────────────────
// Uniformly random fails carry no spatial signal, so what is reported there is the
// false-positive rate. It is held near the significance level (0.05) by the
// Benjamini–Hochberg adjustment and the effect gates; a broken adjustment, a
// missing gate or a region counted twice shows here first. Seeds are fixed, so
// the counts are exact; the bounds leave room for a change of seed, not for a fault.

const rng = (seed) => () => {
  seed = (seed + 0x6D2B79F5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const noise = (seed) => {
  const random = rng(seed);
  const results = makeResults({ seed: 1 }).map(d => ({ x: d.x, y: d.y,
    ...(random() < 0.15 ? { hbin: 2, sbin: 21 } : { hbin: 1, sbin: 10 }) }));
  return buildWaferMap({ results, waferConfig: WAFER_CONFIG, dieConfig: DIE_CONFIG, hbinDefs: HBIN_DEFS, sbinDefs: SBIN_DEFS, ringCount: 4 });
};

test('random fails raise a regional finding on few wafers, about the significance level', () => {
  const wafers = 60;
  const flagged = Array.from({ length: wafers }, (_, i) => analyzeWaferMap(noise((i + 1) * 13)).findings
    .filter(f => ['ring', 'quadrant', 'sector', 'cluster', 'edge-arc'].includes(f.comparison.family)).length)
    .filter(n => n > 0).length;
  assert.ok(flagged <= 0.12 * wafers, `${flagged}/${wafers} noise wafers reported a regional finding`);
});

test('random fails raise a regional finding on few lots', () => {
  const total = 20;
  const flagged = Array.from({ length: total }, (_, l) => analyzeWaferLot([1, 2, 3, 4, 5].map(k => noise(l * 101 + k))).findings
    .filter(f => f.id.startsWith('lot-region:')).length)
    .filter(n => n > 0).length;
  assert.ok(flagged <= 0.2 * total, `${flagged}/${total} noise lots reported a regional finding`);
});

// ── A merged run is graded with its constituents' multiple-testing correction ──

test('a merged region finding carries an adjusted p no smaller than its raw p', () => {
  let merged = 0;
  for (const findings of waferFindings) {
    for (const f of findings) {
      if ((f.highlight.regionKeys?.length ?? 0) < 2) continue;
      merged++;
      assert.ok(f.stats.adjustedPValue !== undefined, `${f.id} has no adjusted p`);
      assert.ok(f.stats.adjustedPValue >= f.stats.pValue, `${f.id}: adjusted p below raw p`);
    }
  }
  assert.ok(merged > 0, 'the generated wafers produced no merged findings to check');
});
