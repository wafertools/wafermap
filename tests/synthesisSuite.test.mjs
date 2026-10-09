// The synthesis suite: "What stands out" run over a catalogue of lots, checked four ways.
//
//   1. A snapshot of every lot's and every wafer's synthesis, so any change to what the panel says is seen
//      and approved (`UPDATE_SNAPSHOTS=1 node --test tests/synthesisSuite.test.mjs` rewrites it).
//   2. Invariants that hold for any data: no contradictions, no figure that cannot be true, every item a
//      target that exists, the panel and the report saying the same thing.
//   3. Oracles: figures recomputed here from the dies, by a route that shares no code with the library.
//   4. Metamorphic pairs: the same lot carried differently (soft bins for hard, bins renumbered, rotated,
//      reordered, without its test limits) must say the same thing.
//
// And the maps themselves: every row and chip clicked twice in a real gallery and a real single map must
// show something and then put the map back as it was.
//
// The catalogue is synthetic (tests/fixtures/synthLots.mjs) plus the showcase files under docs/data, each
// also loaded the way the desktop app reads a CSV: without the test limits a meta file would supply.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { buildWaferMap, analyzeWaferMap, analyzeWaferLot } from '../dist/index.js';
import { buildSynthesis, synthesisSource } from '../dist/packages/stats/synthesis.js';
import { renderLotReportHtml } from '../dist/packages/stats/renderSummaryReport.js';
import { buildLot, passBinsOf, testDefsOf } from './fixtures/synthLots.mjs';
import { setupDom, click } from './fixtures/domHarness.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SNAPSHOT = path.join(HERE, 'snapshots', 'synthesis.json');
const DATA = path.join(HERE, '..', 'docs', 'data');

// ── The catalogue ────────────────────────────────────────────────────────────

const ring = (bin, p = 0.35, on) => ({ region: 'edge-ring', p, bin, ...(on ? { on } : {}) });

/** @type {import('./fixtures/synthLots.mjs').LotSpec[]} */
const SPECS = [
  { name: 'clean', wafers: 6 },
  { name: 'edge-ring', wafers: 6, signatures: [ring(5)] },
  { name: 'edge-ring-soft-only', wafers: 4, binScheme: 'soft', signatures: [ring(5)] },
  { name: 'edge-ring-hard-only', wafers: 4, binScheme: 'hard', signatures: [ring(5)] },
  { name: 'edge-ring-two-bins', wafers: 4, signatures: [ring(5, 0.2), ring(6, 0.2)] },
  { name: 'quadrant-on-four-of-six', wafers: 6, signatures: [{ region: 'quadrant-NE', p: 0.3, bin: 6, on: [0, 1, 2, 3] }] },
  { name: 'centre', wafers: 5, signatures: [{ region: 'centre', p: 0.5, bin: 4 }] },
  { name: 'donut', wafers: 3, signatures: [{ region: 'donut', p: 0.3, bin: 6 }] },
  { name: 'scratch', wafers: 8, signatures: [{ region: 'scratch', p: 0.8, bin: 3 }] },
  { name: 'cluster-one-wafer', wafers: 6, signatures: [{ region: 'cluster', p: 0.9, bin: 5, on: [2] }] },
  { name: 'edge-arc', wafers: 5, signatures: [{ region: 'edge-arc-N', p: 0.6, bin: 5 }] },
  { name: 'outlier-wafer', wafers: 7, outlier: { wafer: 4, extra: 0.15 } },
  { name: 'drift', wafers: 8, drift: 0.012 },
  { name: 'two-pass-grades', wafers: 5, gradeB: 0.2, signatures: [ring(5)] },
  { name: 'grade-b-is-a-failure', wafers: 5, gradeB: 0.2, passGradeB: false, signatures: [ring(5)] },
  { name: 'pass-bins-renumbered', wafers: 4, gradeB: 0.1, binMap: { 1: 3, 2: 5, 3: 1, 4: 2, 5: 7, 6: 8, 7: 9 }, signatures: [ring(5)] },
  { name: 'test-fails-in-ring', wafers: 4, tests: 'both', signatures: [ring(5)], testFailures: [{ test: 101, region: 'edge-ring', p: 0.3, binning: 6 }] },
  { name: 'test-fails-on-passing-dies', wafers: 6, tests: 'parametric', testFailures: [{ test: 102, region: 'everywhere', p: 0.05, side: 'high', binning: 'pass' }] },
  { name: 'test-fails-everywhere', wafers: 6, tests: 'parametric', testFailures: [{ test: 102, region: 'everywhere', p: 0.06, binning: 6 }] },
  { name: 'test-fails-in-quadrant', wafers: 5, tests: 'parametric', testFailures: [{ test: 103, region: 'quadrant-SW', p: 0.3, binning: 6 }] },
  { name: 'functional-fails-in-ring', wafers: 4, tests: 'both', testFailures: [{ test: 201, region: 'edge-ring', p: 0.4, binning: 7 }] },
  { name: 'tests-without-limits', wafers: 4, tests: 'both', limits: false, signatures: [ring(5)], testFailures: [{ test: 101, region: 'edge-ring', p: 0.3, binning: 6 }] },
  { name: 'no-bins', wafers: 3, binScheme: 'none', tests: 'both', testFailures: [{ test: 101, region: 'edge-ring', p: 0.3, binning: 6 }] },
  { name: 'one-wafer', wafers: 1, signatures: [ring(5)] },
  { name: 'two-wafers', wafers: 2, signatures: [{ region: 'quadrant-SW', p: 0.4, bin: 6 }] },
  { name: 'many-things', wafers: 8, tests: 'both', outlier: { wafer: 6, extra: 0.12 },
    signatures: [ring(5, 0.3), { region: 'quadrant-NE', p: 0.25, bin: 6, on: [0, 1, 2, 3] }, { region: 'scratch', p: 0.8, bin: 3, on: [5, 7] }],
    testFailures: [{ test: 102, region: 'everywhere', p: 0.04, binning: 'pass' }, { test: 201, region: 'centre', p: 0.5, binning: 7 }] },
  { name: 'small-loss-good-lot', wafers: 6, baseRate: 0.004, signatures: [{ region: 'cluster', p: 0.9, bin: 4 }] },
  { name: 'poor-lot', wafers: 6, baseRate: 0.2, signatures: [ring(5, 0.3)] },
];

/** A showcase CSV and its meta file, read the way the examples read them. Test numbers are column indices. */
function loadShowcase(name, { limits = true } = {}) {
  const lines = fs.readFileSync(path.join(DATA, `${name}.csv`), 'utf8').split(/\r?\n/).filter(l => l && !l.startsWith('#'));
  const meta = JSON.parse(fs.readFileSync(path.join(DATA, `${name}.meta.json`), 'utf8'));
  const hdr = lines[0].split(',');
  const col = (re) => hdr.findIndex(h => re.test(h));
  const c = {
    lot: col(/^(lot|lid|lot_id|lot_num)$/i), wafer: col(/^(wafer|wfr|wid|wafer_id|wafer_num)$/i),
    x: col(/^(x|col|x_loc|step_x|xstep|die_x)$/i), y: col(/^(y|row|y_loc|step_y|ystep|die_y)$/i),
    hbin: col(/^(hbin|h_bin|hard_bin|bin)$/i), sbin: col(/^(sbin|s_bin|soft_bin)$/i), temp: col(/^(temp|tst_temp)$/i),
  };
  const testDefs = (meta.testDefs ?? []).map(t => (limits ? t : { testNumber: t.testNumber, name: t.name, ...(t.unit ? { unit: t.unit } : {}), ...(t.testType ? { testType: t.testType } : {}) }));
  const byWafer = new Map();
  for (const line of lines.slice(1)) {
    const v = line.split(',');
    const key = `${v[c.wafer]}${c.temp >= 0 ? `@${v[c.temp]}` : ''}`;
    if (!byWafer.has(key)) byWafer.set(key, { lot: v[c.lot], wafer: key, results: [] });
    const r = { x: +v[c.x], y: +v[c.y] };
    if (c.hbin >= 0 && v[c.hbin] !== '') r.hbin = +v[c.hbin];
    if (c.sbin >= 0 && v[c.sbin] !== '') r.sbin = +v[c.sbin];
    if (testDefs.length) {
      r.testValues = {};
      for (const t of testDefs) if (v[t.testNumber] !== '' && v[t.testNumber] !== undefined && Number.isFinite(+v[t.testNumber])) r.testValues[t.testNumber] = +v[t.testNumber];
    }
    byWafer.get(key).results.push(r);
  }
  return [...byWafer.values()].map(w => buildWaferMap({
    results: w.results,
    waferConfig: { ...meta.waferConfig, metadata: { lot: w.lot, waferId: w.wafer } },
    dieConfig: meta.dieConfig, passBins: meta.passBins, hbinDefs: meta.hbinDefs, sbinDefs: meta.sbinDefs,
    ...(testDefs.length ? { testDefs } : {}),
  }));
}

const SHOWCASE = ['bin-rich', 'highdensity', 'memory-ring', 'power-device', 'rf-analog', 'sparse-qual', 'wide-die', 'parser-stress'];

/** Every case, analysed once: its maps, each wafer's summary, the lot summary and the pass bins. */
const CASES = (() => {
  const quiet = console.warn;
  console.warn = () => {};   // the showcase files carry deliberate oddities the build reports
  try {
    const analyse = (name, maps, passBins, spec) => {
      const per = maps.map(m => analyzeWaferMap(m));
      return { name, spec, maps, per, lot: analyzeWaferLot(maps, { perWaferSummaries: per }), passBins };
    };
    const out = SPECS.map(spec => analyse(spec.name, buildLot(spec), passBinsOf(spec), spec));
    for (const name of SHOWCASE) {
      const meta = JSON.parse(fs.readFileSync(path.join(DATA, `showcase-${name}.meta.json`), 'utf8'));
      out.push(analyse(`showcase:${name}`, loadShowcase(`showcase-${name}`), meta.passBins));
      if ((meta.testDefs ?? []).some(t => t.limitLow !== undefined || t.limitHigh !== undefined)) {
        out.push(analyse(`showcase:${name}:as-the-desktop-app-reads-it`, loadShowcase(`showcase-${name}`, { limits: false }), meta.passBins));
      }
    }
    return out;
  } finally {
    console.warn = quiet;
  }
})();

// ── Describing a synthesis, for the snapshot and the messages ────────────────

function describeTarget(t, findings) {
  if (t.kind === 'test') return `test ${t.testNumber}`;
  const f = findings.get(t.id);
  return f ? `${f.variable.kind} @ ${f.comparison.left}` : `MISSING ${t.id}`;
}

function describe(s, summary) {
  const findings = new Map(synthesisSource(summary).findings.map(f => [f.id, f]));
  const chips = (it) => (it.chips.length ? `  [${it.chips.map(c => `${c.label} → ${describeTarget(c.target, findings)}`).join('; ')}]` : '');
  return [
    s.headline,
    ...(s.nothing ? [`nothing: ${s.nothing}`] : []),
    ...s.items.map((it, i) => `${i + 1}. (${it.impact}, ${(it.shareOfDies * 100).toFixed(1)}%) → ${describeTarget(it.target, findings)} | ${i === 0 ? it.text : it.brief}${i === 0 ? chips(it) : ''}`),
    ...(s.also?.items ?? []).map(it => `also (${it.impact}, ${(it.shareOfDies * 100).toFixed(1)}%) → ${describeTarget(it.target, findings)} | ${it.brief}`),
    ...(s.also?.more ? [`and ${s.also.more} more`] : []),
    ...(s.watch ?? []).map(w => `watch → ${describeTarget(w.target, findings)} | ${w.text}`),
    s.checked,
  ];
}

const synth = (summary, passBins) => buildSynthesis(summary, { passBins });

// ── 1. The snapshot ──────────────────────────────────────────────────────────

test('every lot and wafer says what the snapshot says', () => {
  const now = {};
  for (const c of CASES) {
    now[c.name] = {
      lot: describe(synth(c.lot, c.passBins), c.lot),
      wafers: Object.fromEntries(c.per.map((s, i) => [c.maps[i].metadata?.waferId ?? `#${i}`, describe(synth(s, c.passBins), s)])),
    };
  }
  if (process.env.UPDATE_SNAPSHOTS || !fs.existsSync(SNAPSHOT)) {
    fs.mkdirSync(path.dirname(SNAPSHOT), { recursive: true });
    fs.writeFileSync(SNAPSHOT, `${JSON.stringify(now, null, 1)}\n`);
    return;
  }
  const before = JSON.parse(fs.readFileSync(SNAPSHOT, 'utf8'));
  const changed = [];
  for (const name of new Set([...Object.keys(before), ...Object.keys(now)])) {
    const a = JSON.stringify(before[name]), b = JSON.stringify(now[name]);
    if (a !== b) changed.push(name);
  }
  assert.deepEqual(changed, [], `What stands out changed for: ${changed.join(', ')}. Review the diff of the snapshot by `
    + 'running with UPDATE_SNAPSHOTS=1 and reading tests/snapshots/synthesis.json, then commit it if the change is intended.');
});

// ── 2. Invariants ────────────────────────────────────────────────────────────

const MIN_SHARE = 0.01;
const plain = /\b(NaN|undefined|null|Infinity)\b|HBin|SBin|same dies|\s{2}| [,.;)]|\(\s/;

/** Every problem with one synthesis, as sentences. Empty when it is sound. */
function problems(s, summary, passBins) {
  const out = [];
  const src = synthesisSource(summary);
  const findings = new Map(src.findings.map(f => [f.id, f]));
  const waferCount = src.level === 'lot' ? src.stats.waferCount : 1;
  const total = src.level === 'wafer' ? src.stats.analyzedDies : src.perWafer.reduce((n, w) => n + w.summary.stats.analyzedDies, 0);
  const tests = new Set([
    ...(src.stats.testSpecYield ?? []).map(t => t.testNumber), ...(src.stats.functionalYield ?? []).map(t => t.testNumber),
    ...(src.stats.capability ?? []).map(t => t.testNumber),
  ]);
  const resolves = (t) => (t.kind === 'finding' ? findings.has(t.id) : tests.has(t.testNumber));
  const all = [...s.items, ...(s.also?.items ?? [])];

  const texts = [s.headline, s.nothing ?? '', s.checked, ...all.flatMap(i => [i.text, i.brief, ...i.chips.map(c => c.label)]), ...(s.watch ?? []).map(w => w.text)];
  for (const t of texts) {
    if (plain.test(t)) out.push(`malformed text: "${t}"`);
    if (/\b1 (dies|wafers|findings|tests|hard bins)\b/.test(t) || /\babout 0 dies\b/.test(t)) out.push(`count reads wrong: "${t}"`);
    for (const [, k, n] of t.matchAll(/(\d+)\/(\d+) wafers/g)) {
      if (+k > +n || +n !== waferCount) out.push(`"${k}/${n} wafers" in a lot of ${waferCount}: "${t}"`);
    }
    for (const [, pct] of t.matchAll(/(\d+(?:\.\d+)?)%/g)) if (+pct > 100) out.push(`a share over 100%: "${t}"`);
  }

  // An item: a target that exists, a cost that is possible and material, and figures that agree with it.
  for (const it of all) {
    if (!it.target || !resolves(it.target)) out.push(`item without a live target: ${it.brief}`);
    for (const c of it.chips) if (!resolves(c.target)) out.push(`chip without a live target: ${c.label}`);
    if (!(it.diesLost >= MIN_SHARE * total - 1e-9)) out.push(`item under the floor: ${it.brief} (${it.diesLost} of ${total})`);
    if (it.diesLost > total) out.push(`item loses more dies than there are: ${it.brief}`);
    if (Math.abs(it.shareOfDies - it.diesLost / total) > 1e-12) out.push(`share is not dies lost over dies: ${it.brief}`);
    const lost = /about ([\d,]+) dies lost/.exec(it.text);
    if (lost && +lost[1].replace(/,/g, '') !== Math.round(it.diesLost)) out.push(`sentence and cost disagree: ${it.text} vs ${it.diesLost}`);
    // Named bins are parts of the shortfall: together they cannot account for more than all of it.
    const whole = /pass rate ([\d.]+) points below/.exec(it.text);
    const parts = [...it.text.matchAll(/(?:accounts for|for) ([\d.]+)(?: of those points)?/g)].map(m => +m[1]);
    if (whole && parts.length && parts.reduce((a, b) => a + b, 0) > +whole[1] + 0.05 * (parts.length + 1)) out.push(`bins account for more than the whole: ${it.text}`);
    for (const c of it.chips) if (c.bin && !new RegExp(`\\bbin ${c.bin.bin}\\b`).test(c.label)) out.push(`bin chip names another bin: ${c.label}`);
  }
  for (let i = 1; i < s.items.length; i++) if (s.items[i].diesLost > s.items[i - 1].diesLost) out.push('items are not ranked by dies lost');
  const claimed = all.flatMap(i => i.findingIds);
  if (new Set(claimed).size !== claimed.length) out.push('a finding is claimed by two items');
  for (const w of s.watch ?? []) if (!w.target || !resolves(w.target)) out.push(`watch line without a live target: ${w.text}`);

  // Nothing material: then nothing is listed, and the sentence does not contradict a finding marked unusual.
  if (s.nothing && s.items.length) out.push('says nothing stands out and lists items');
  const shown = new Set([...claimed, ...(s.watch ?? []).flatMap(w => w.findingIds)]);
  if (s.nothing?.startsWith('Nothing stands out') && src.findings.some(f => f.severity === 'unusual' && !shown.has(f.id))) {
    out.push('says nothing stands out beside an unusual finding');
  }
  // The headline names the pass bins it judged by, and its yield is the summary's.
  if (passBins && !s.headline.includes(`pass bin${passBins.length > 1 ? 's' : ''} ${passBins.join(', ')}`) && /Yield/.test(s.headline)) {
    out.push(`headline does not name pass bins ${passBins}: ${s.headline}`);
  }
  return out;
}

test('no synthesis contradicts itself or states an impossible figure', () => {
  const found = [];
  for (const c of CASES) {
    for (const [label, summary] of [['lot', c.lot], ...c.per.map((s, i) => [`wafer ${i + 1}`, s])]) {
      for (const p of problems(synth(summary, c.passBins), summary, c.passBins)) found.push(`${c.name} ${label}: ${p}`);
    }
  }
  assert.deepEqual(found, []);
});

test('building and analysing the same lot twice says the same thing', () => {
  for (const spec of SPECS.slice(0, 6)) {
    const again = buildLot(spec);
    const per = again.map(m => analyzeWaferMap(m));
    const c = CASES.find(x => x.name === spec.name);
    assert.deepEqual(describe(synth(analyzeWaferLot(again, { perWaferSummaries: per }), c.passBins), c.lot), describe(synth(c.lot, c.passBins), c.lot), spec.name);
  }
});

test('a lot of one wafer says what its wafer says', () => {
  for (const c of CASES.filter(x => x.maps.length === 1)) {
    assert.deepEqual(synth(c.lot, c.passBins).items.map(i => i.text), synth(c.per[0], c.passBins).items.map(i => i.text), c.name);
  }
});

// ── 3. Oracles: figures recomputed from the dies ─────────────────────────────

/** A die's verdict, recomputed: its hard bin, else its soft bin, against the pass bins. */
const passes = (d, passBins) => {
  const b = d.hbin ?? d.sbin;
  return b === undefined ? undefined : passBins.includes(b);
};
const key = (d) => `${d.x},${d.y}`;

test('each wafer\'s yield is its passing dies over its binned dies, and the headline says so', () => {
  for (const c of CASES) {
    c.maps.forEach((m, i) => {
      const judged = m.dies.filter(d => !d.partial && !d.edgeExcluded && passes(d, c.passBins) !== undefined);
      const s = c.per[i];
      if (!judged.length) { assert.equal(s.stats.yieldPercent ?? null, null, c.name); return; }
      const y = (100 * judged.filter(d => passes(d, c.passBins)).length) / judged.length;
      assert.ok(Math.abs(s.stats.yieldPercent - y) < 1e-9, `${c.name} wafer ${i + 1}: ${s.stats.yieldPercent} vs ${y}`);
      assert.match(synth(s, c.passBins).headline, new RegExp(`^Yield ${y.toFixed(1).replace('.', '\\.')}%`), c.name);
    });
  }
});

test('a test\'s failing dies, and how many of them fail yield, are the dies outside its limits', () => {
  for (const c of CASES) {
    c.maps.forEach((m, i) => {
      const defs = m.testDefs ?? [];
      const expected = {};
      for (const d of m.dies) {
        if (d.partial || d.edgeExcluded) continue;
        for (const t of defs) {
          let fails;
          if (t.testType === 'F') fails = d.testPass?.[t.testNumber] === false || (d.testPass?.[t.testNumber] === undefined && d.testValues?.[t.testNumber] === 0);
          else {
            const v = d.testValues?.[t.testNumber];
            if (v === undefined || !Number.isFinite(v) || (t.limitLow === undefined && t.limitHigh === undefined)) continue;
            fails = (t.limitLow !== undefined && v < t.limitLow) || (t.limitHigh !== undefined && v > t.limitHigh);
          }
          if (!fails) continue;
          const e = expected[t.testNumber] ??= { dieKeys: [], lostDies: 0 };
          e.dieKeys.push(key(d));
          if (passes(d, c.passBins) !== true) e.lostDies++;
        }
      }
      const got = c.per[i].stats.testFailures ?? {};
      assert.deepEqual(Object.keys(got).sort(), Object.keys(expected).sort(), `${c.name} wafer ${i + 1}: which tests fail`);
      for (const [tn, e] of Object.entries(expected)) {
        assert.deepEqual([...got[tn].dieKeys].sort(), e.dieKeys.sort(), `${c.name} wafer ${i + 1} test ${tn}: failing dies`);
        assert.equal(got[tn].lostDies, e.lostDies, `${c.name} wafer ${i + 1} test ${tn}: dies lost`);
      }
    });
  }
});

// Rings and quadrants share the wafer out between them, so their "rest" is the rest of the wafer. Sectors
// leave out the dies near the centre and are compared with the other sectors (the synthesis says so).
test('a wafer\'s ring or quadrant yield finding is the pass rate inside its dies against the rest of the wafer', () => {
  let checked = 0;
  for (const c of CASES) {
    c.maps.forEach((m, i) => {
      const judged = m.dies.filter(d => !d.partial && !d.edgeExcluded && passes(d, c.passBins) !== undefined);
      for (const f of c.per[i].findings) {
        if (f.variable.kind !== 'yield' || !['ring', 'quadrant'].includes(f.comparison.family) || !f.highlight.dieKeys) continue;
        const inside = new Set(f.highlight.dieKeys);
        const rate = (ds) => ds.filter(d => passes(d, c.passBins)).length / ds.length;
        const delta = rate(judged.filter(d => inside.has(key(d)))) - rate(judged.filter(d => !inside.has(key(d))));
        assert.ok(Math.abs(delta - f.effect.absoluteDelta) < 1e-9, `${c.name} wafer ${i + 1} ${f.comparison.left}: ${f.effect.absoluteDelta} vs ${delta}`);
        checked++;
      }
    });
  }
  assert.ok(checked > 20, `only ${checked} region findings checked`);
});

test('a test said as part of a region item fails on the dies it says, and that many of them are in the region', () => {
  let checked = 0;
  for (const c of CASES) {
    c.per.forEach((s, i) => {
      const findings = new Map(s.findings.map(f => [f.id, f]));
      for (const it of synth(s, c.passBins).items) {
        for (const [, label, n, inside] of it.text.matchAll(/\. (\S+) (?:is [^.]*?|fails) on ([\d,]+) dies, (all|[\d,]+) of them in /g)) {
          const def = (c.maps[i].testDefs ?? []).find(t => t.name === label);
          const keys = new Set(s.stats.testFailures?.[def.testNumber]?.dieKeys ?? []);
          const region = new Set(findings.get(it.target.id)?.highlight.dieKeys ?? []);
          const both = [...keys].filter(k => region.has(k)).length;
          assert.equal(+n.replace(/,/g, ''), keys.size, `${c.name} wafer ${i + 1}: ${label} failing dies`);
          assert.equal(inside === 'all' ? keys.size : +inside.replace(/,/g, ''), both, `${c.name} wafer ${i + 1}: ${label} inside`);
          checked++;
        }
      }
    });
  }
  assert.ok(checked > 3, `only ${checked} folded tests checked`);
});

// ── 4. Metamorphic pairs ─────────────────────────────────────────────────────

/** A lot's items, with bin numbers and bin type taken out: what must not depend on how bins are carried. */
const essence = (lot, passBins) => synth(lot, passBins).items.map(it => ({
  text: it.text.replace(/\b(hard|soft) bin \d+/g, 'bin #').replace(/\b(hard|soft) bins?\b/g, 'bins'),
  diesLost: +it.diesLost.toFixed(6),
}));
const variant = (spec, change) => {
  const s = { ...spec, ...change };
  const maps = buildLot(s);
  return { maps, lot: analyzeWaferLot(maps), passBins: passBinsOf(s) };
};
const SAME_BINS = ['edge-ring', 'edge-ring-two-bins', 'quadrant-on-four-of-six', 'centre', 'scratch', 'outlier-wafer', 'test-fails-in-ring'];

test('how bins are carried does not change what stands out: hard and soft, hard only, soft only', () => {
  for (const name of SAME_BINS) {
    const spec = SPECS.find(s => s.name === name);
    const hs = variant(spec, { binScheme: 'hard+soft' });
    for (const scheme of ['hard', 'soft']) {
      const other = variant(spec, { binScheme: scheme });
      assert.deepEqual(essence(other.lot, other.passBins), essence(hs.lot, hs.passBins), `${name}: ${scheme} only`);
    }
  }
});

test('renumbering the bins, pass bins included, does not change what stands out', () => {
  const map = { 1: 3, 2: 5, 3: 1, 4: 2, 5: 7, 6: 8, 7: 9 };
  for (const name of [...SAME_BINS, 'two-pass-grades', 'grade-b-is-a-failure']) {
    const spec = SPECS.find(s => s.name === name);
    const a = variant(spec, {});
    const b = variant(spec, { binMap: map });
    assert.deepEqual(essence(b.lot, b.passBins), essence(a.lot, a.passBins), name);
  }
});

test('turning the wafers half a turn moves the regions but not what they cost', () => {
  const costs = (v) => synth(v.lot, v.passBins).items.map(i => `${i.impact} ${i.diesLost.toFixed(6)}`).sort();
  for (const name of ['edge-ring', 'edge-ring-two-bins', 'quadrant-on-four-of-six', 'two-wafers', 'test-fails-in-quadrant', 'centre', 'donut', 'scratch', 'test-fails-in-ring']) {
    const spec = SPECS.find(s => s.name === name);
    assert.deepEqual(costs(variant(spec, { rotate: 180 })), costs(variant(spec, {})), name);
  }
});

test('the order of the wafers does not change what stands out, when there is no trend to read', () => {
  for (const name of ['edge-ring', 'quadrant-on-four-of-six', 'outlier-wafer', 'many-things', 'cluster-one-wafer']) {
    const spec = SPECS.find(s => s.name === name);
    const a = synth(variant(spec, {}).lot, passBinsOf(spec));
    const b = synth(variant(spec, { reverse: true }).lot, passBinsOf(spec));
    assert.ok(!(a.watch ?? []).some(w => /successive wafers/.test(w.text)), `${name} has a trend; pick another case`);
    assert.deepEqual(b.items.map(i => i.text).sort(), a.items.map(i => i.text).sort(), name);
  }
});

test('taking the test limits away removes the test items and leaves the region items as they were', () => {
  for (const name of ['test-fails-in-ring', 'test-fails-in-quadrant', 'many-things', 'functional-fails-in-ring']) {
    const spec = SPECS.find(s => s.name === name);
    const regions = (v) => {
      const s = synth(v.lot, v.passBins);
      return [...s.items, ...(s.also?.items ?? [])].filter(i => i.target.kind === 'finding').map(i => i.text.replace(/\. \S+ (is|fails) .*$/, ''));
    };
    const without = variant(spec, { limits: false });
    assert.deepEqual(regions(without), regions(variant(spec, {})), name);
    const parametric = new Set(testDefsOf(spec).filter(t => t.testType !== 'F').map(t => t.testNumber));
    assert.ok(!synth(without.lot, without.passBins).items.some(i => i.target.kind === 'test' && parametric.has(i.target.testNumber)), `${name}: no parametric test item without limits`);
  }
});

// ── The panel and the report say the same thing ──────────────────────────────

test('the panel shows every item as a row that acts, and nothing else acts', async () => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>');
  const prev = { window: globalThis.window, document: globalThis.document, HTMLElement: globalThis.HTMLElement, HTMLDivElement: globalThis.HTMLDivElement, Node: globalThis.Node };
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, HTMLDivElement: dom.window.HTMLDivElement, Node: dom.window.Node });
  try {
    const { buildSynthesisSection } = await import('../dist/packages/canvas-adapter/summaryPanel.js');
    for (const c of CASES) {
      const s = synth(c.lot, c.passBins);
      const section = buildSynthesisSection(c.lot, c.passBins, { onFindingClick: () => {}, onTestClick: () => {} });
      const acting = [...section.querySelectorAll('button[data-wmap-finding], button[data-wmap-test]')];
      const expected = s.items.length + (s.also?.items.length ?? 0) + (s.watch?.length ?? 0) + (s.items[0]?.chips.length ?? 0);
      assert.equal(acting.length, expected, `${c.name}: rows and chips that act`);
      const ids = new Set(synthesisSource(c.lot).findings.map(f => f.id));
      for (const b of acting) if (b.dataset.wmapFinding) assert.ok(ids.has(b.dataset.wmapFinding), `${c.name}: ${b.dataset.wmapFinding}`);
      const text = section.textContent;
      for (const it of [s.items[0], ...s.items.slice(1)].filter(Boolean)) assert.ok(text.includes(it === s.items[0] ? it.text : it.brief), `${c.name}: shows ${it.brief}`);
      assert.equal(section.querySelectorAll('a').length, 0, `${c.name}: no inline links`);
    }
  } finally {
    Object.assign(globalThis, prev);
  }
});

test('every link in a report\'s What stands out lands on the page', () => {
  const quiet = console.warn;
  console.warn = () => {};
  try {
    for (const c of CASES.filter((_, i) => i % 3 === 0)) {
      const html = renderLotReportHtml(c.maps);
      const section = /<section class="report-section synthesis"[^>]*>([\s\S]*?)<\/section>/.exec(html)?.[1] ?? '';
      for (const [, id] of section.matchAll(/href="#([^"]+)"/g)) assert.ok(html.includes(`id="${id}"`), `${c.name}: #${id}`);
    }
  } finally {
    console.warn = quiet;
  }
});

// ── The maps: every row and chip, clicked twice ──────────────────────────────

const CLICK_CASES = ['edge-ring', 'edge-ring-soft-only', 'test-fails-in-ring', 'many-things', 'functional-fails-in-ring', 'showcase:rf-analog:as-the-desktop-app-reads-it'];

/** The section's acting elements, found afresh: the panel re-renders on every click. */
const actingIn = (root) => {
  const head = [...root.querySelectorAll('*')].find(e => e.childElementCount === 0 && /^what stands out$/i.test(e.textContent.trim()));
  let sec = head;
  while (sec && !sec.textContent.includes('Compared:')) sec = sec.parentElement;
  return sec ? [...sec.querySelectorAll('button[data-wmap-finding], button[data-wmap-test]')] : [];
};
const ident = (b) => b.dataset.wmapFinding ?? `test ${b.dataset.wmapTest}`;
/** Polls until `ready` holds: a large wafer's panel renders in stages, a few ticks after the click. */
async function until(ready, what) {
  for (let i = 0; i < 400; i++) {
    const v = ready();
    if (v) return v;
    await new Promise(r => setTimeout(r, 5));
  }
  assert.fail(`timed out waiting for ${what}`);
}

async function clickEachTwice(c, mount, readState) {
  const { window, root, cleanup } = setupDom();
  try {
    const container = window.document.createElement('div');
    root.appendChild(container);
    const ctrl = mount(container, c);
    const hasHard = c.maps.some(m => m.dies.some(d => d.hbin != null));
    const targets = (await until(() => { const a = actingIn(container); return a.length ? a : null; }, `${c.name}: the panel's rows`)).map(ident);
    assert.ok(!hasHard ? readState(ctrl).plotMode !== 'hardBin' : true, `${c.name}: a lot with no hard bins opens in hard bins`);
    for (const id of targets) {
      const before = readState(ctrl);
      click(window, actingIn(container).find(b => ident(b) === id));
      const on = await until(() => actingIn(container).find(b => ident(b) === id && b.getAttribute('aria-current') === 'true'), `${c.name}: ${id} marked as shown`);
      const shown = readState(ctrl);
      if (!hasHard) assert.notEqual(shown.plotMode, 'hardBin', `${c.name}: ${id} switched a lot with no hard bins to hard bins`);
      if (id.startsWith('test ')) assert.equal(shown.activeTest, +id.slice(5), `${c.name}: ${id} shows its test`);
      // A pass bin is a pass rate: its finding shows the region, never the passing dies picked out.
      if (shown.highlightBin !== undefined && (shown.plotMode === 'hardBin' || !hasHard)) {
        assert.ok(!c.passBins.includes(shown.highlightBin), `${c.name}: ${id} highlights pass bin ${shown.highlightBin}`);
      }
      if ('selected' in shown && !id.startsWith('lot-repeat')) assert.ok(shown.selected > 0, `${c.name}: ${id} selects its dies`);
      click(window, on);
      await until(() => actingIn(container).find(b => ident(b) === id && b.getAttribute('aria-current') !== 'true'), `${c.name}: ${id} released`);
      assert.deepEqual(readState(ctrl), before, `${c.name}: clicking ${id} twice leaves the map as it was`);
    }
    ctrl.destroy();
  } finally {
    cleanup();
  }
}

test('in a gallery, every row and chip shows something and a second click puts the map back', async () => {
  const { renderWaferGallery } = await import('../dist/packages/canvas-adapter/index.js');
  for (const name of CLICK_CASES) {
    const c = CASES.find(x => x.name === name);
    await clickEachTwice(c,
      (container) => renderWaferGallery(container, c.maps.map((m, i) => ({ ...m, statsSummary: c.per[i] })), { lotStatsSummary: c.lot, summaryPanel: { defaultOpen: true } }),
      (ctrl) => {
        const o = ctrl.getOptions();
        return { plotMode: o.plotMode, activeTest: o.activeTest, highlightBin: o.highlightBin };
      });
  }
});

test('on a single map, every row and chip shows something and a second click puts the map back', async () => {
  const { renderWaferMap } = await import('../dist/packages/canvas-adapter/index.js');
  for (const name of CLICK_CASES) {
    const c = CASES.find(x => x.name === name);
    await clickEachTwice({ ...c, maps: [c.maps[0]] },
      (container) => renderWaferMap(container, c.maps[0], { statsSummary: c.per[0], summaryPanel: { defaultOpen: true } }),
      (ctrl) => {
        const o = ctrl.getOptions();
        return { plotMode: o.plotMode, activeTest: o.activeTest, highlightBin: o.highlightBin, selected: ctrl.getSelectedDies().length };
      });
  }
});

