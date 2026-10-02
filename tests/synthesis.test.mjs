// The results synthesis: a few sentences saying how a wafer or lot did. It reads the findings
// and recomputes nothing, ranks by dies lost, lists only what is material, and says so plainly
// when nothing is — a good lot must read as a good lot.

import test from 'node:test';
import assert from 'node:assert/strict';
import { buildWaferMap, analyzeWaferMap, analyzeWaferLot } from '../dist/index.js';
import { buildSynthesis, synthesisText } from '../dist/packages/stats/synthesis.js';
import { renderLotReportHtml, renderWaferReportHtml } from '../dist/packages/stats/renderSummaryReport.js';
import { findingAnchor } from '../dist/packages/stats/reportHtml.js';

const R = 14;
const BIN_DEFS = [{ bin: 1, name: 'Pass' }, { bin: 2, name: 'Leakage' }, { bin: 3, name: 'Speed' }];

/**
 * A deterministic wafer: a sparse, spatially structureless scatter of bin-3 fails, so it carries no
 * pattern. `region` adds a block of bin-2 fails (a quadrant or the edge ring), `extra` more
 * scattered fails to lower the whole wafer.
 */
function wafer({ region, extra = 0, tag = 0, lot = 'L1' } = {}) {
  const results = [];
  for (let x = -R; x <= R; x++) {
    for (let y = -R; y <= R; y++) {
      const r = Math.hypot(x, y);
      if (r > R) continue;
      let hbin = 1;
      if (((x + 20) * 7 + (y + 20) * 13 + tag) % 37 === 0) hbin = 3;
      else if (extra && ((x + 20) * 11 + (y + 20) * 5 + tag) % Math.round(100 / extra) === 0) hbin = 3;
      if (region === 'quadrant' && x > 0 && y > 0 && ((x * 3 + y * 5 + tag) % 10 < 5)) hbin = 2;
      if (region === 'edge' && r > R * 0.82 && ((x * 3 + y * 5 + tag) % 10 < 4)) hbin = 2;
      results.push({ x, y, hbin, sbin: hbin * 10 + ((x + y) & 1) });
    }
  }
  return buildWaferMap({
    results, waferConfig: { diameter: 300, notch: { type: 'bottom' }, metadata: { lot, wafer: `W${tag}` } },
    hbinDefs: BIN_DEFS, passBins: [1], ringCount: 4 });
}
const lot = (maps) => analyzeWaferLot(maps);
const text = (item) => item.parts.map(p => p.text).join('');

test('a clean lot says nothing stands out, and still gives the yield and what was compared', () => {
  const s = buildSynthesis(lot([1, 2, 3, 4, 5].map(tag => wafer({ tag }))), { passBins: [1] });
  assert.equal(s.items.length, 0, synthesisText(s));
  assert.match(s.nothing, /Nothing stands out/);
  assert.match(synthesisText(s), /^Yield \d+\.\d% \(mean of 5 wafers, [\d,]+ dies; pass bin 1\)/);
  assert.match(s.checked, /^Compared: .*regions/);
});

test('a quadrant signature is one item, naming the bin that accounts for it', () => {
  const s = buildSynthesis(lot([1, 2, 3, 4, 5].map(tag => wafer({ region: 'quadrant', tag }))), { passBins: [1] });
  assert.equal(s.nothing, undefined);
  assert.ok(s.items.length >= 1);
  const line = text(s.items[0]);
  assert.match(line, /pass rate [\d.]+ points below the rest of the wafer on 5\/5 wafers/);
  assert.match(line, /hard bin 2 \(Leakage\)/, 'a bin is named in plain words');
  assert.ok(!/HBin|same dies/.test(line), 'no internal bin term');
  assert.ok(!/accounts for ([\d.]+) of those points/.test(line) ||
    Number(/accounts for ([\d.]+)/.exec(line)[1]) <= Number(/rate ([\d.]+) points/.exec(line)[1]), 'a bin never accounts for more than the whole');
  assert.match(line, /about [\d,]+ dies lost/);
});

test('findings standing on the same dies are one item, not one each', () => {
  const s = buildSynthesis(lot([1, 2, 3, 4, 5].map(tag => wafer({ region: 'quadrant', tag }))), { passBins: [1] });
  const ids = s.items.flatMap(i => i.findingIds);
  assert.equal(new Set(ids).size, ids.length, 'no finding is claimed by two items');
  assert.equal(s.items.length, 1, synthesisText(s));
});

test('a repeated pattern leads its item, so it is said once', () => {
  const s = buildSynthesis(lot([1, 2, 3, 4, 5, 6].map(tag => wafer({ region: 'edge', tag }))), { passBins: [1] });
  assert.match(text(s.items[0]), /^Edge-ring pattern on 6\/6 wafers\. Ring 4 \(edge\)/);
});

test('items are ranked by dies lost, capped at three, and none is below the materiality floor', () => {
  const s = buildSynthesis(lot([1, 2, 3, 4, 5].map(tag => wafer({ region: 'quadrant', extra: 6, tag }))), { passBins: [1] });
  assert.ok(s.items.length <= 3);
  const lost = s.items.map(i => i.diesLost);
  assert.deepEqual(lost, [...lost].sort((a, b) => b - a));
});

test('an outlier wafer is costed by its own dies, on the fraction scale every yield finding uses', () => {
  const maps = [1, 2, 3, 4, 5].map(tag => wafer({ tag }));
  maps.push(wafer({ extra: 30, tag: 9 }));
  const l = lot(maps);
  const out = l.findings.find(f => f.level === 'inter-wafer');
  assert.ok(out, 'fixture must produce an outlier wafer');
  assert.ok(Math.abs(out.effect.absoluteDelta) < 1, 'a yield difference is a fraction, not percentage points');
  const item = buildSynthesis(l, { passBins: [1] }).items.find(i => i.findingIds.includes(out.id));
  assert.ok(item, 'the outlier wafer is listed');
  const dies = l.perWafer[5].summary.stats.analyzedDies;
  assert.ok(Math.abs(item.diesLost - Math.abs(out.effect.absoluteDelta) * dies) < 1e-9);
  assert.ok(item.diesLost < dies, 'it cannot lose more dies than it has');
});

test('a wafer summary has a headline and the same shape', () => {
  const s = buildSynthesis(analyzeWaferMap(wafer({ region: 'quadrant', tag: 3 })), { passBins: [1] });
  assert.match(s.headline[0].text, /^Yield \d+\.\d% \(\d[\d,]* dies; pass bin 1\)\.$/);
  assert.match(s.checked, /^Compared: /);
  assert.ok(s.items.length >= 1);
});

test('every part that links points at a finding that exists', () => {
  const l = lot([1, 2, 3, 4, 5].map(tag => wafer({ region: 'quadrant', tag })));
  const ids = new Set(l.findings.map(f => f.id));
  for (const item of buildSynthesis(l, { passBins: [1] }).items) {
    for (const p of item.parts) if (p.target) assert.ok(ids.has(p.target.id), `${p.target.id} is a finding`);
  }
});

// ── In the report ────────────────────────────────────────────────────────────

test('the lot report opens with the synthesis, and each link lands on a finding row', () => {
  const html = renderLotReportHtml([1, 2, 3, 4, 5].map(tag => wafer({ region: 'quadrant', tag })));
  assert.match(html, /<section class="report-section synthesis" id="sec-\d+">\s*<h2>What stands out<\/h2>/);
  assert.ok(html.indexOf('What stands out') < html.indexOf('Per-Wafer Yield'), 'it comes before the detail');
  const links = [...html.matchAll(/href="#(finding-[^"]+)"/g)].map(m => m[1]);
  assert.ok(links.length > 0, 'the synthesis links to findings');
  for (const id of links) assert.ok(html.includes(`id="${id}"`), `${id} is a row on the page`);
});

test('the wafer report carries it too, and a clean wafer says nothing stands out', () => {
  const clean = wafer({ tag: 1 });
  const html = renderWaferReportHtml(clean, analyzeWaferMap(clean));
  assert.match(html, /<h2>What stands out<\/h2>/);
  assert.match(html, /Nothing stands out/);
});

test('finding anchors are unique per id and valid in an id attribute', () => {
  const ids = ['lot-region:yield|yield|||quadrant|quadrant:NE', 'lot-repeat:yield|||edge-arc|Edge arc ~ESE|lower', 'a b', 'a_b'];
  const anchors = ids.map(findingAnchor);
  assert.equal(new Set(anchors).size, ids.length);
  for (const a of anchors) assert.match(a, /^[A-Za-z0-9_-]+$/);
});

// ── The cap, the "also" line and the impact tiers, on fabricated findings with exact figures ──

/** A lot of `waferCount` wafers of 100 analysed dies each, with lot-level region findings of given costs. */
function fakeLot(regions) {
  const waferCount = 2;
  const findings = regions.map(({ name, dies, drop }, i) => ({
    id: `lot-region:yield|yield|||ring|ring:${i}`, level: 'lot', severity: 'info',
    variable: { kind: 'yield', label: 'Yield' },
    comparison: { family: 'ring', left: name, right: 'Rest of map' },
    effect: { direction: 'lower', absoluteDelta: -drop },
    stats: { method: 'stouffer-z', sampleSizeLeft: waferCount, sampleSizeRight: 0 },
    summary: '', 
    // disjoint dies per region, so no two findings are one item
    highlight: { kind: 'wafer', waferIndices: [0, 1], dieKeysByWafer: {
      0: Array.from({ length: dies / 2 }, (_, k) => `r${i}:${k}`), 1: Array.from({ length: dies / 2 }, (_, k) => `s${i}:${k}`) } },
  }));
  return {
    level: 'lot', hasNotableFindings: false, findings,
    lotYieldSeries: [{ waferIndex: 0, yieldPercent: 90 }, { waferIndex: 1, yieldPercent: 90 }],
    stats: { waferCount },
    perWafer: [0, 1].map(waferIndex => ({ waferIndex, summary: { stats: { analyzedDies: 5000, totalDies: 5000, testsConsidered: [], hardBinsConsidered: [] } } })),
  };
}

test('items over the cap go on one "also" line, so nothing material is dropped', () => {
  // 10,000 analysed dies: each region costs drop × dies.  A 400 (4.0%), B 300 (3.0%), C 250 (2.5%), D 150 (1.5%), E 110 (1.1%), F 50 (0.5%, below the floor)
  const s = buildSynthesis(fakeLot([
    { name: 'A', dies: 1000, drop: 0.4 }, { name: 'B', dies: 1000, drop: 0.3 }, { name: 'C', dies: 1000, drop: 0.25 },
    { name: 'D', dies: 1000, drop: 0.15 }, { name: 'E', dies: 1000, drop: 0.11 }, { name: 'F', dies: 1000, drop: 0.05 },
  ]));
  assert.deepEqual(s.items.map(i => i.brief.text.split(':')[0]), ['A', 'B', 'C']);
  const also = s.also.map(p => p.text).join('');
  assert.match(also, /^Also over a yield point: D: pass rate, 150 dies; E: pass rate, 110 dies\.$/);
  assert.ok(!also.includes('F:'), 'a region below the floor is not mentioned');
  assert.match(s.checked, /1 smaller finding not listed above/, 'the floor-and-below finding is the only one left');
});

test('a long "also" line names five and counts the rest', () => {
  const regions = Array.from({ length: 10 }, (_, i) => ({ name: `R${i}`, dies: 1000, drop: 0.2 - i * 0.01 }));
  const s = buildSynthesis(fakeLot(regions));
  assert.equal(s.items.length, 3);
  assert.match(s.also.map(p => p.text).join(''), /; and 2 more\.$/);
});

test('impact tiers follow the share of dies lost: under 2% low, 2–4% medium, 4% and over high', () => {
  const s = buildSynthesis(fakeLot([
    { name: 'A', dies: 1000, drop: 0.4 }, { name: 'B', dies: 1000, drop: 0.28 }, { name: 'C', dies: 1000, drop: 0.11 },
  ]));
  assert.deepEqual(s.items.map(i => i.impact), ['high', 'medium', 'low']);
});

test('the report draws severity as dots plus a word, not as a coloured badge', () => {
  const html = renderLotReportHtml([1, 2, 3, 4, 5].map(tag => wafer({ region: 'quadrant', tag })));
  assert.ok(!/class="badge/.test(html), 'no coloured badge');
  assert.match(html, /<span class="meter-dots" aria-hidden="true">●●●<\/span><span class="meter-word">(Unusual|High impact)<\/span>/);
  assert.match(html, /<tr class="tier-(high|medium|low)"/);
  assert.ok(!/>Info</.test(html), 'the weakest severity is called Minor');
});

// ── The layout around it: contents line, bars, tints ─────────────────────────

test('a report with several sections has a contents line whose links land on those sections', () => {
  const html = renderLotReportHtml([1, 2, 3, 4, 5].map(tag => wafer({ region: 'quadrant', tag })));
  const nav = /<nav class="report-toc"[^>]*>(.*?)<\/nav>/s.exec(html);
  assert.ok(nav, 'a contents line');
  const targets = [...nav[1].matchAll(/href="#(sec-\d+)"/g)].map(m => m[1]);
  assert.ok(targets.length >= 4);
  for (const id of targets) assert.ok(html.includes(`<section class="report-section`) && html.includes(`id="${id}"`), `${id} is a section`);
});

test('yields are drawn with a bar and the figure, and only a shortfall is tinted', () => {
  const html = renderLotReportHtml([1, 2, 3, 4, 5].map(tag => wafer({ region: 'quadrant', tag })));
  assert.match(html, /<td class="barcell"><span class="cellbar"><i style="width:[\d.]+%"><\/i><span>[\d.]+%<\/span><\/span><\/td>/);
  // a region well below the lot is tinted; no cell above it is
  assert.match(html, /<td class="numeric low-[123]">−[\d.]+<\/td>/);
  assert.ok(!/<td class="numeric low-[123]">\+/.test(html), 'a figure above the reference is never tinted');
});

test('a clean lot has no tinted cell at all', () => {
  const html = renderLotReportHtml([1, 2, 3, 4, 5].map(tag => wafer({ tag })));
  assert.ok(!/class="numeric low-[123]"/.test(html), 'nothing to tint on a clean lot');
});

test('two lot groups in one document never share an id', () => {
  const html = renderLotReportHtml([
    ...[1, 2, 3].map(tag => wafer({ region: 'quadrant', tag, lot: 'LA' })),
    ...[4, 5, 6].map(tag => wafer({ region: 'quadrant', tag, lot: 'LB' })),
  ]);
  assert.equal((html.match(/<main class="report">/g) ?? []).length, 2, 'the fixture really splits into two groups');
  const ids = [...html.matchAll(/ id="([^"]+)"/g)].map(m => m[1]);
  assert.ok(ids.some(id => id.startsWith('finding-g1-')) && ids.some(id => id.startsWith('finding-g2-')), 'each group scopes its anchors');
  assert.equal(new Set(ids).size, ids.length, 'every id on the page is unique');
});

// ── Tests that cost dies ─────────────────────────────────────────────────────

/** `fakeLot` with per-test tallies on its lot stats, over its 10,000 analysed dies. */
const withTests = (spec = [], functional = []) => {
  const l = fakeLot([]);
  l.stats.testSpecYield = spec.map((t, i) => ({ testNumber: i + 1, passDies: t.totalDies - t.failLowDies - t.failHighDies, yieldPercent: 0, ...t }));
  l.stats.functionalYield = functional.map((t, i) => ({ testNumber: 100 + i, passDies: t.totalDies - t.failDies, passRatePercent: 0, ...t }));
  return l;
};

test('a test below its low limit is an item, said in dies and a share, and sized by the dies it accounts for', () => {
  const s = buildSynthesis(withTests([{ label: 'IP3_DBM', failLowDies: 1100, failHighDies: 0, totalDies: 10000 }]));
  assert.equal(s.items.length, 1);
  assert.equal(s.items[0].parts.map(p => p.text).join(''), 'IP3_DBM is below its low limit on 1,100 of 10,000 dies (11.0%)');
  assert.equal(s.items[0].impact, 'high');
  assert.equal(s.items[0].diesLost, 1100);
});

test('a test above its high limit, or outside both, says which', () => {
  const s = buildSynthesis(withTests([
    { label: 'NF_DB', failLowDies: 0, failHighDies: 500, totalDies: 10000 },
    { label: 'VTH', failLowDies: 120, failHighDies: 180, totalDies: 10000 },
  ]));
  const lines = s.items.map(i => i.parts.map(p => p.text).join(''));
  assert.deepEqual(lines, [
    'NF_DB is above its high limit on 500 of 10,000 dies (5.0%)',
    'VTH is outside its limits (120 low, 180 high) on 300 of 10,000 dies (3.0%)',
  ]);
});

test('a functional test that fails is an item', () => {
  const s = buildSynthesis(withTests([], [{ label: 'SCAN', failDies: 300, totalDies: 10000 }]));
  assert.equal(s.items[0].parts.map(p => p.text).join(''), 'SCAN fails on 300 of 10,000 dies (3.0%)');
  assert.equal(s.items[0].impact, 'medium');
});

test('a test costing under a yield point is not listed, and a lot of such tests says nothing stands out', () => {
  const s = buildSynthesis(withTests([{ label: 'T', failLowDies: 60, failHighDies: 0, totalDies: 10000 }], [{ label: 'F', failDies: 90, totalDies: 10000 }]));
  assert.equal(s.items.length, 0);
  assert.match(s.nothing, /Nothing stands out/);
});

test('test items rank with region items by the dies they account for', () => {
  const l = withTests([{ label: 'T', failLowDies: 200, failHighDies: 0, totalDies: 10000 }]);
  const region = fakeLot([{ name: 'Ring 4', dies: 1000, drop: 0.3 }]);   // 300 dies
  l.findings = region.findings;
  const s = buildSynthesis(l);
  assert.deepEqual(s.items.map(i => i.diesLost), [300, 200]);
});

test('test items go on the "also" line like any other, with a short form', () => {
  const l = withTests([1, 2, 3, 4].map(i => ({ label: `T${i}`, failLowDies: 600 - i * 50, failHighDies: 0, totalDies: 10000 })));
  const s = buildSynthesis(l);
  assert.equal(s.items.length, 3);
  assert.match(s.also.map(p => p.text).join(''), /^Also over a yield point: T4: 400 dies outside limits\.$/);
});

// ── Impact is the higher of the share of dies and the share of the lot's loss ─────

test('a small area that is most of a good lot\'s loss is high impact, not low', () => {
  // 10,000 analysed dies at 98.8% yield: 120 dies fail in all. One item accounts for 114 of them (1.14% of
  // the dies, 95% of the loss).
  const l = fakeLot([{ name: 'Ring 1 (core)', dies: 1000, drop: 0.114 }]);
  for (const w of l.perWafer) w.summary.stats.yieldPercent = 98.8;
  const s = buildSynthesis(l);
  assert.equal(s.items[0].diesLost, 114);
  assert.equal(s.items[0].impact, 'high');
});

test('the same item in a lot that fails a lot is still low: it is a small part of a big loss', () => {
  const l = fakeLot([{ name: 'Ring 1 (core)', dies: 1000, drop: 0.114 }]);
  for (const w of l.perWafer) w.summary.stats.yieldPercent = 70;      // 3,000 failing dies; 114 is 3.8%
  assert.equal(buildSynthesis(l).items[0].impact, 'low');
});

test('shares of the loss: 15% is medium and 40% high, whatever the share of dies', () => {
  const l = fakeLot([{ name: 'A', dies: 1000, drop: 0.12 }, { name: 'B', dies: 1000, drop: 0.115 }]);
  for (const w of l.perWafer) w.summary.stats.yieldPercent = 94;      // 600 failing dies
  const tiers = Object.fromEntries(buildSynthesis(l).items.map(i => [i.brief.text.split(':')[0], i.impact]));
  // A: 120 dies = 20% of the loss, 1.2% of the dies → medium.  B: 115 = 19% → medium.
  assert.deepEqual(tiers, { A: 'medium', B: 'medium' });
});

test('a merged hard/soft twin is named by its hard bin, in both spellings of the label', () => {
  const lead = fakeLot([{ name: 'Ring 1 (core)', dies: 1000, drop: 0.3 }]);
  const bin = (bin, label, drop) => ({
    ...lead.findings[0], id: `lot-region:hardBin|hardBin|${bin}||ring|ring:0`,
    variable: { kind: 'hardBin', bin, label }, effect: { direction: 'higher', absoluteDelta: drop },
  });
  lead.findings.push(bin(2, 'HBin and SBin 2 (Leakage) (same dies)', 0.17), bin(3, 'HBin 3 (Edge Ring) and SBin 32 (Edge - Film)', 0.065));
  const line = buildSynthesis(lead, { passBins: [1] }).items[0].parts.map(p => p.text).join('');
  assert.match(line, /mostly hard bin 2 \(Leakage\) accounts for 17\.0 of those points, hard bin 3 \(Edge Ring\) for 6\.5/);
  assert.ok(!/soft bin|SBin|same dies/.test(line));
});
