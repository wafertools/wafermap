// The results synthesis: a few sentences naming what is worth looking at, each built
// from the findings the panels already show. Pure — it reads a computed summary and
// recomputes nothing, so a figure in a sentence is the figure in the finding it names.
//
// Ranking is by dies lost, not by p-value or severity: severity saturates on a large
// lot and p-values track sample size, while "how many dies did this cost" does neither.
// The p/effect gates still decide whether a finding is real; dies lost decides where it
// appears. Findings that stand on the same dies are one item, so a quadrant, a sector
// and an edge arc over the same corner read as one thing, not three.

import { maxOf, minOf } from '../core/utils.js';
import { passBinsLabel } from '../core/passBins.js';
import { DRIFT_MIN_WAFERS } from './lotDrift.js';
import { plainBinTerms } from '../renderer/fmt.js';
import type { LotStatsSummary, StatsFinding, StatsSeverity, StatsSummary } from './types.js';

/** What a sentence fragment points at, so a surface can link it to its evidence. */
export interface SynthesisTarget {
  kind: 'finding';
  id: string;
}

/** A run of text, optionally linked. Structured, not a string, so the panel can make
 *  links and the report can make anchors from the same sentence. */
export interface SynthesisPart {
  text: string;
  target?: SynthesisTarget;
}

/** How much of the lot an item costs, in three steps. Drawn as a meter, never as colour alone. */
export type ImpactTier = 'high' | 'medium' | 'low';

export interface SynthesisItem {
  /** From the share of analysed dies lost, the same quantity the items are ranked by. */
  impact: ImpactTier;
  /** Dies lost as a fraction (0–1) of the analysed dies; set once the items are costed. */
  shareOfDies: number;
  /** Estimated dies lost to this item (pass-rate shortfall × dies in the region). */
  diesLost: number;
  severity: StatsSeverity;
  parts: SynthesisPart[];
  /** The leading finding, then the others that stand on the same dies. */
  findingIds: string[];
  /** The item in a few words, for the compact list: `Ring 2: hard bin 4 (Short), 62 dies`. */
  brief: SynthesisPart;
}

/**
 * A signal that costs no dies of its own yet but predicts loss: a trend across the wafers, or a test whose
 * spread leaves little margin to its limits. Kept apart from the items, which are ranked by dies lost: a
 * Ppk of 0.9 with no failures does not belong on the same axis as 400 failing dies.
 */
export interface SynthesisWatch {
  parts: SynthesisPart[];
  findingIds: string[];
}

export interface Synthesis {
  headline: SynthesisPart[];
  items: SynthesisItem[];
  /**
   * Items that clear the floor but not the cap, so nothing material goes unmentioned: the ones named
   * (each shown in a few words, from its `brief`) and how many more were left out. Absent when the cap
   * shows them all.
   */
  also?: { items: SynthesisItem[]; more: number };
  /** At most two things to keep an eye on, after the items. Absent when there are none. */
  watch?: SynthesisWatch[];
  /** Said instead of the items when none is material, so a good lot reads as one rather than as an empty list. */
  nothing?: string;
  /** What was compared and not repeated above. Required: a short synthesis must not read as "not analysed". */
  checked: string;
}

export interface SynthesisContext {
  /**
   * The pass bins every wafer was judged by: names them in the headline, and says which bins are
   * failures. Left out when the wafers were judged differently — the synthesis then stays with
   * yield and does not call any bin a failure, rather than assume `[1]`.
   */
  passBins?: readonly number[];
}

/** At most this many things go in the Watch tier. */
const MAX_WATCH = 2;
/** A test whose Ppk against its limits is below this is worth watching: 1.0 is the line between a spread that fits its limits and one that does not. */
const WATCH_PPK = 1.0;
/** At most this many items are written out in full; the rest that clear the floor go on one "also" line. */
const MAX_LOSS_ITEMS = 3;
/** The "also" line names at most this many, then counts the rest. */
const MAX_ALSO_NAMED = 5;
/**
 * An item is listed only when it costs at least this share of the analysed dies (one yield
 * point). A finding below it is real, and stays in the findings list, but is not worth a
 * sentence: a good lot must read as a good lot, not as twenty small differences. The figure
 * is a judgement, not a derived value; revisit it against labelled real wafers.
 */
const MIN_SHARE_OF_DIES = 0.01;
/**
 * Impact tiers, by the higher of two measures. Of the lot's dies: 2% is medium, 4% high. Of the lot's loss
 * (the dies that fail): 15% is medium, 40% high. The second is what makes a small area with a severe fault
 * read as it should: on a 97.6% lot, 114 failing dies is 1.4% of the dies and still more than half of
 * everything that fails. Judgements, like the floor.
 */
const MEDIUM_SHARE = 0.02;
const HIGH_SHARE = 0.04;
const MEDIUM_SHARE_OF_LOSS = 0.15;
const HIGH_SHARE_OF_LOSS = 0.4;
/** Findings share dies when this fraction of the smaller one's dies are in both. */
const SHARED_DIES = 0.5;
/** A bin is named in an item when it carries at least this share of the shortfall. */
const MIN_BIN_SHARE = 0.1;
const MAX_BINS_NAMED = 2;

const REGION_FAMILIES = new Set(['ring', 'quadrant', 'sector', 'reticle-position', 'test-site', 'cluster', 'edge-arc']);

/**
 * Dies a finding stands on: a lot finding by its per-wafer keys, a wafer finding by its own.
 * `undefined` when the finding does not say — a lot finding that tallies how many wafers showed
 * a per-wafer finding (an edge arc) has wafers, not dies, and must not be costed as if it had.
 */
function diesIn(f: StatsFinding): number | undefined {
  const h = f.highlight;
  if ('dieKeysByWafer' in h && h.dieKeysByWafer) {
    return Object.values(h.dieKeysByWafer).reduce((n, keys) => n + keys.length, 0);
  }
  if ('dieKeys' in h && h.dieKeys && h.dieKeys.length > 0) return h.dieKeys.length;
  return f.level === 'lot' ? undefined : f.stats.sampleSizeLeft;
}

/** The finding's dies as comparable keys; a lot finding's are qualified by wafer. */
function dieKeySet(f: StatsFinding): Set<string> {
  const h = f.highlight;
  const keys = new Set<string>();
  if ('dieKeysByWafer' in h && h.dieKeysByWafer) {
    for (const [wafer, list] of Object.entries(h.dieKeysByWafer)) for (const k of list) keys.add(`${wafer}:${k}`);
  } else if ('dieKeys' in h && h.dieKeys) {
    for (const k of h.dieKeys) keys.add(k);
  }
  return keys;
}

const shortfall = (f: StatsFinding): number => Math.abs(f.effect.absoluteDelta ?? 0);
const diesLostBy = (f: StatsFinding): number => shortfall(f) * (diesIn(f) ?? 0);

const points = (fraction: number): string => (fraction * 100).toFixed(1);
/** A finding's variable as a reader says it: `hard bin 2 (Leakage)`, not the internal `HBin 2`. A merged hard/soft twin is named by its hard bin. */
const nameOf = (f: StatsFinding): string => {
  const label = f.variable.label
    .replace(/ \(same dies\)$/, '')
    // A merged hard/soft twin: "HBin and SBin 2 (X)" is hard bin 2; "HBin 3 (A) and SBin 32 (B)" is hard bin 3 (A).
    .replace(/^HBin and SBin (\d+)/, 'HBin $1')
    .replace(/^(HBin \d+(?: \([^)]*\))?) and SBin .*$/, '$1');
  return plainBinTerms(label);
};
const count = (n: number): string => Math.round(n).toLocaleString('en-GB');
const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

/** "NE" is a quadrant; the other families already say what they are ("Ring 4", "Sector NE"). */
function subjectOf(f: StatsFinding): string {
  const left = f.comparison.left;
  return f.comparison.family === 'quadrant' && !/quadrant/i.test(left) ? `${left} quadrant` : left;
}

/** Union-find over candidate indices. */
function groupBySharedDies(candidates: StatsFinding[]): number[][] {
  const parent = candidates.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const sets = candidates.map(dieKeySet);
  for (let a = 0; a < candidates.length; a++) {
    for (let b = a + 1; b < candidates.length; b++) {
      const small = sets[a].size <= sets[b].size ? sets[a] : sets[b];
      const large = small === sets[a] ? sets[b] : sets[a];
      if (small.size === 0) continue;
      let shared = 0;
      for (const k of small) if (large.has(k)) shared++;
      if (shared >= SHARED_DIES * small.size) parent[find(a)] = find(b);
    }
  }
  const groups = new Map<number, number[]>();
  candidates.forEach((_, i) => {
    const root = find(i);
    (groups.get(root) ?? groups.set(root, []).get(root)!).push(i);
  });
  return [...groups.values()];
}

const isBin = (f: StatsFinding): boolean => f.variable.kind === 'hardBin' || f.variable.kind === 'softBin';
const sameRegion = (a: StatsFinding, b: StatsFinding): boolean =>
  a.level === b.level && a.comparison.family === b.comparison.family && a.comparison.left === b.comparison.left;

/** The fail bins in the lead's own region, largest first. Hard bins when the data has them, soft otherwise. */
function failBinsIn(lead: StatsFinding, findings: readonly StatsFinding[], passBins: readonly number[] | undefined): StatsFinding[] {
  if (!passBins) return [];
  const inRegion = (kind: 'hardBin' | 'softBin') => findings.filter(f =>
    f.variable.kind === kind && sameRegion(f, lead) && f.effect.direction === 'higher' &&
    !(kind === 'hardBin' && passBins.includes(f.variable.bin ?? NaN)));
  const bins = inRegion('hardBin').length > 0 ? inRegion('hardBin') : inRegion('softBin');
  return bins.filter(f => f !== lead).sort((a, b) => shortfall(b) - shortfall(a));
}

function lossItem(
  group: StatsFinding[],
  findings: readonly StatsFinding[],
  waferCount: number | undefined,
  passBins: readonly number[] | undefined,
): SynthesisItem {
  // A yield finding is the whole shortfall in its region and the fail bins are its parts, so it
  // leads; with none, the bin that costs the most dies does. Either way the rest stand on the same dies.
  const yields = group.filter(f => f.variable.kind === 'yield');
  const lead = [...(yields.length > 0 ? yields : group)].sort((a, b) => diesLostBy(b) - diesLostBy(a))[0];
  const others = group.filter(f => f !== lead);
  const parts: SynthesisPart[] = [];

  const wafers = lead.level === 'lot' && 'waferIndices' in lead.highlight ? lead.highlight.waferIndices?.length : undefined;
  const where = wafers !== undefined && waferCount ? ` on ${wafers}/${waferCount} wafers` : '';
  const leadIsBin = isBin(lead);
  // Only the names link (the region, each bin): a sentence underlined from end to end reads as noise.
  const link = (text: string, f: StatsFinding): SynthesisPart => ({ text, target: { kind: 'finding', id: f.id } });
  parts.push(link(subjectOf(lead), lead));
  parts.push({
    text: leadIsBin ? '' : `: pass rate ${points(shortfall(lead))} points below the rest of the wafer${where}`,
  });
  if (leadIsBin) parts.push({ text: ': ' }, link(nameOf(lead), lead), { text: ` ${points(shortfall(lead))} points higher than the rest of the wafer${where}` });

  // Every die carries one hard bin, so a region's pass-rate shortfall is exactly the sum of its
  // fail-bin excesses: the bins are read, not guessed. "mostly" only when one bin is over half.
  const bins = failBinsIn(lead, findings, passBins)
    .map(f => ({ f, share: shortfall(f) / (shortfall(lead) || 1) }))
    .filter(b => leadIsBin || b.share >= MIN_BIN_SHARE)
    .slice(0, MAX_BINS_NAMED);
  if (leadIsBin) {
    for (const { f } of bins) parts.push({ text: ', ' }, link(nameOf(f), f), { text: ` ${points(shortfall(f))} points higher` });
  } else if (bins.length > 0) {
    // The shortfall is the net of every bin, so one bin can exceed it when another fail bin fell in
    // the region; it is then simply said to be higher, never "accounts for more than the whole".
    const mostly = bins[0].share > 0.5 && bins[0].share <= 1 ? 'mostly ' : '';
    bins.forEach(({ f, share }, i) => {
      const own = share <= 1;
      if (i === 0) parts.push({ text: `; ${own ? mostly : ''}` }); else parts.push({ text: ', ' });
      parts.push(link(nameOf(f), f));
      parts.push({ text: i === 0
        ? (own ? ` accounts for ${points(shortfall(f))} of those points` : ` is ${points(shortfall(f))} points higher`)
        : (own ? ` for ${points(shortfall(f))}` : ` ${points(shortfall(f))} points higher`) });
    });
  }

  parts.push({ text: ` — about ${count(diesLostBy(lead))} dies lost` });
  const elsewhere = [...new Set(others.filter(f => !sameRegion(f, lead)).map(subjectOf))];
  if (elsewhere.length > 0) parts.push({ text: ` (also seen as ${elsewhere.join(', ')})` });
  const what = leadIsBin ? nameOf(lead) : 'pass rate';
  return {
    impact: 'low',
    shareOfDies: 0,
    diesLost: diesLostBy(lead),
    severity: lead.severity,
    parts,
    findingIds: [lead.id, ...others.map(f => f.id)],
    brief: { text: `${subjectOf(lead)}: ${what}, ${count(diesLostBy(lead))} dies`, target: { kind: 'finding', id: lead.id } },
  };
}

/** The tier from the share of the dies an item costs and the share of all the dies that fail. */
function impactTier(shareOfDies: number, shareOfLoss: number): ImpactTier {
  if (shareOfDies >= HIGH_SHARE || shareOfLoss >= HIGH_SHARE_OF_LOSS) return 'high';
  if (shareOfDies >= MEDIUM_SHARE || shareOfLoss >= MEDIUM_SHARE_OF_LOSS) return 'medium';
  return 'low';
}

/** The dies that fail, from each wafer's yield over its analysed dies: the denominator of "share of the loss". */
function failingDies(summary: StatsSummary | LotStatsSummary): number {
  const one = (s: StatsSummary): number => (s.stats.yieldPercent == null ? 0 : s.stats.analyzedDies * (1 - s.stats.yieldPercent / 100));
  return summary.level === 'wafer' ? one(summary) : summary.perWafer.reduce((n, w) => n + one(w.summary), 0);
}

/** Dies the yield is judged over: the denominator of "share of the lot". */
function analysedDies(summary: StatsSummary | LotStatsSummary): number {
  return summary.level === 'wafer'
    ? summary.stats.analyzedDies
    : summary.perWafer.reduce((n, w) => n + w.summary.stats.analyzedDies, 0);
}

/** An outlier-wafer finding (one wafer against the lot), as opposed to a trend across them. */
const isOutlierWafer = (f: StatsFinding): boolean => f.id.startsWith('inter-wafer:yield:');

/** A wafer well below the lot, costed as the pass rate it is short of the lot's median over its own dies. */
function outlierItems(lot: LotStatsSummary): SynthesisItem[] {
  const items: SynthesisItem[] = [];
  for (const f of lot.findings) {
    if (!isOutlierWafer(f) || f.effect.direction !== 'lower') continue;
    const wafer = 'waferIndices' in f.highlight ? f.highlight.waferIndices?.[0] : undefined;
    const dies = wafer === undefined ? undefined : lot.perWafer.find(w => w.waferIndex === wafer)?.summary.stats.analyzedDies;
    if (dies === undefined) continue;
    items.push({
      impact: 'low',
    shareOfDies: 0,
      diesLost: shortfall(f) * dies,
      severity: f.severity,
      parts: [
        { text: f.summary.replace(/ percentage points lower than the lot median$/, ' points below the lot median'), target: { kind: 'finding', id: f.id } },
        { text: ` — about ${count(shortfall(f) * dies)} dies lost` },
      ],
      findingIds: [f.id],
      brief: { text: `${f.comparison.left}: yield, ${count(shortfall(f) * dies)} dies`, target: { kind: 'finding', id: f.id } },
    });
  }
  return items;
}

/**
 * Tests that cost dies, from the tallies the summary already holds: a parametric test outside its limits
 * (`testSpecYield`) and a functional test that fails (`functionalYield`). They are not findings and have no
 * region, so they stand on their own and are ranked with the rest by the dies they account for. The dies are
 * counted per test, so they overlap the items above (a die outside one limit is usually also in a fail bin):
 * an item says "outside its limits on N dies", never that those dies were lost on top of another's.
 */
function testLossItems(summary: StatsSummary | LotStatsSummary, named: Set<number>): SynthesisItem[] {
  const stats = summary.stats;
  const items: SynthesisItem[] = [];
  const make = (testNumber: number, label: string, failDies: number, totalDies: number, what: string, brief: string): void => {
    if (failDies <= 0 || totalDies <= 0) return;
    named.add(testNumber);
    const share = (failDies / totalDies) * 100;
    items.push({
      impact: 'low',
    shareOfDies: 0,
      diesLost: failDies,
      severity: 'info',
      parts: [
        { text: label },
        { text: ` ${what} on ${count(failDies)} of ${count(totalDies)} dies (${share.toFixed(1)}%)` },
      ],
      findingIds: [],
      brief: { text: `${label}: ${count(failDies)} dies ${brief}` },
    });
  };
  for (const t of stats.testSpecYield ?? []) {
    const fail = t.failLowDies + t.failHighDies;
    const side = t.failHighDies === 0 ? 'is below its low limit'
      : t.failLowDies === 0 ? 'is above its high limit'
      : `is outside its limits (${count(t.failLowDies)} low, ${count(t.failHighDies)} high)`;
    make(t.testNumber, t.label, fail, t.totalDies, side, 'outside limits');
  }
  for (const t of stats.functionalYield ?? []) make(t.testNumber, t.label, t.failDies, t.totalDies, 'fails', 'fail');
  return items;
}

/**
 * What to keep an eye on, from signals that cost no dies of their own: a trend across the wafers (the
 * lot's drift findings, strongest first) and then tests whose Ppk against their limits is under 1.0,
 * worst first. A test already listed as costing dies is not repeated here. At most {@link MAX_WATCH}.
 */
function watchItems(summary: StatsSummary | LotStatsSummary, listedTests: ReadonlySet<number>): SynthesisWatch[] {
  const out: SynthesisWatch[] = [];

  const rank: Record<StatsSeverity, number> = { unusual: 0, notable: 1, info: 2 };
  const drift = summary.findings
    .filter(f => f.id.startsWith('drift:'))
    .sort((a, b) => rank[a.severity] - rank[b.severity] || (a.stats.adjustedPValue ?? 1) - (b.stats.adjustedPValue ?? 1));
  for (const f of drift) {
    const name = f.variable.label;
    out.push({
      parts: [{ text: name, target: { kind: 'finding', id: f.id } }, { text: f.summary.slice(name.length) }],
      findingIds: [f.id],
    });
  }

  const weak = (summary.stats.capability ?? [])
    .filter(c => c.hasSpec && c.ppk !== null && c.ppk !== undefined && c.ppk < WATCH_PPK && !listedTests.has(c.testNumber))
    .sort((a, b) => (a.ppk ?? 0) - (b.ppk ?? 0));
  for (const c of weak) {
    out.push({ parts: [{ text: `${c.label} has Ppk ${(c.ppk as number).toFixed(2)} against its limits (below ${WATCH_PPK.toFixed(1)})` }], findingIds: [] });
  }
  return out.slice(0, MAX_WATCH);
}

function headlineOf(summary: StatsSummary | LotStatsSummary, ctx: SynthesisContext): SynthesisPart[] {
  const pass = ctx.passBins && ctx.passBins.length > 0 ? `; pass ${passBinsLabel([ctx.passBins])}` : '';
  if (summary.level === 'wafer') {
    const y = summary.stats.yieldPercent;
    if (y === null || y === undefined) return [{ text: `${count(summary.stats.totalDies)} dies, no bin data to judge yield by.` }];
    return [{ text: `Yield ${y.toFixed(1)}% (${count(summary.stats.totalDies)} dies${pass}).` }];
  }
  const ys = summary.lotYieldSeries.map(p => p.yieldPercent).filter((v): v is number => typeof v === 'number');
  if (ys.length === 0) return [{ text: `${plural(summary.stats.waferCount, 'wafer')}, no bin data to judge yield by.` }];
  const mean = ys.reduce((a, b) => a + b, 0) / ys.length;
  const dies = summary.perWafer.reduce((n, w) => n + w.summary.stats.totalDies, 0);
  const [lo, hi] = [minOf(ys).toFixed(1), maxOf(ys).toFixed(1)];
  const range = lo !== hi ? `, range ${lo}–${hi}%` : '';
  return [{ text: `Yield ${mean.toFixed(1)}% (mean of ${plural(ys.length, 'wafer')}, ${count(dies)} dies${pass})${range}.` }];
}

/** What was compared. Read from the summary, so it never claims more than the analysis shows it did. */
function checkedLine(summary: StatsSummary | LotStatsSummary, shown: Set<string>): string {
  const parts: string[] = [];
  const tests = summary.level === 'wafer'
    ? summary.stats.testsConsidered.length
    : new Set(summary.perWafer.flatMap(w => w.summary.stats.testsConsidered)).size;
  const hbins = summary.level === 'wafer'
    ? summary.stats.hardBinsConsidered.length
    : new Set(summary.perWafer.flatMap(w => w.summary.stats.hardBinsConsidered)).size;
  if (tests > 0) parts.push(plural(tests, 'test'));
  if (hbins > 0) parts.push(plural(hbins, 'hard bin'));
  parts.push('the ring, quadrant and sector regions');
  if (summary.level === 'lot' && summary.stats.waferCount >= 3) {
    const outliers = summary.findings.filter(isOutlierWafer);
    parts.push(outliers.length === 0 ? 'wafer-to-wafer yield (no outlier wafers)' : `wafer-to-wafer yield (${plural(outliers.length, 'outlier wafer')})`);
    if (summary.stats.waferCount >= DRIFT_MIN_WAFERS) parts.push('the yield trend across the wafers (input order)');
  }
  const rest = summary.findings.filter(f => !shown.has(f.id)).length;
  const tail = rest > 0 ? ` ${plural(rest, 'smaller finding')} not listed above.` : ' Nothing else was found.';
  return `Compared: ${parts.join(', ')}.${tail}`;
}

/**
 * The synthesis for a wafer or a lot: a headline, up to three loss items ranked by dies
 * lost, and a line saying what was compared.
 */
export function buildSynthesis(summary: StatsSummary | LotStatsSummary, ctx: SynthesisContext = {}): Synthesis {
  const findings = summary.findings;
  const waferCount = summary.level === 'lot' ? summary.stats.waferCount : undefined;

  const passBins = ctx.passBins;
  // Candidates: a region finding where the pass rate fell, or a fail bin rose. Both need dies to
  // be costed. A pattern finding does not stand on dies of its own; it names the region findings
  // it explains, and those are the candidates.
  const byId = new Map(findings.map(f => [f.id, f]));
  // A bin is a failure only against known pass bins. Without them (wafers judged differently) the bins
  // are left out and the items rest on yield alone.
  const isFailBin = (f: StatsFinding): boolean => passBins !== undefined &&
    (f.variable.kind === 'hardBin' ? !passBins.includes(f.variable.bin ?? NaN) : f.variable.kind === 'softBin');
  const candidates = findings.filter(f =>
    REGION_FAMILIES.has(f.comparison.family) && diesLostBy(f) > 0 &&
    ((f.variable.kind === 'yield' && f.effect.direction === 'lower') ||
     (isFailBin(f) && f.effect.direction === 'higher')));
  // Soft bins duplicate hard bins' dies when both exist; the hard bin speaks for them.
  const hasHard = candidates.some(f => f.variable.kind === 'hardBin');
  const costed = hasHard ? candidates.filter(f => f.variable.kind !== 'softBin') : candidates;

  const items: SynthesisItem[] = [];
  const shown = new Set<string>();
  for (const group of groupBySharedDies(costed)) {
    items.push(lossItem(group.map(i => costed[i]), findings, waferCount, passBins));
  }

  // A spatial pattern names the loss it explains: lead its item with the pattern, so "Edge-ring on
  // all 6 wafers" is said once, with the region figures after it.
  for (const pattern of findings.filter(f => f.variable.kind === 'spatialPattern')) {
    const members = new Set((pattern.relatedIds ?? []).filter(id => byId.has(id)));
    const item = items.find(it => it.findingIds.some(id => members.has(id)));
    if (!item) continue;
    const seen = pattern.level === 'lot' && 'waferIndices' in pattern.highlight ? pattern.highlight.waferIndices?.length : undefined;
    const on = seen !== undefined && waferCount ? ` on ${seen}/${waferCount} wafers` : '';
    item.parts.unshift({ text: `${pattern.variable.label} pattern${on}. `, target: { kind: 'finding', id: pattern.id } });
    item.findingIds.unshift(pattern.id, ...[...members].filter(id => !item.findingIds.includes(id)));
  }

  if (summary.level === 'lot') items.push(...outlierItems(summary));
  const lossTests = new Set<number>();
  items.push(...testLossItems(summary, lossTests));

  const total = analysedDies(summary);
  const failing = failingDies(summary);
  const material = items.filter(it => total > 0 && it.diesLost / total >= MIN_SHARE_OF_DIES);
  for (const it of material) {
    it.shareOfDies = it.diesLost / total;
    it.impact = impactTier(it.diesLost / total, failing > 0 ? it.diesLost / failing : 0);
  }
  material.sort((a, b) => b.diesLost - a.diesLost);
  const top = material.slice(0, MAX_LOSS_ITEMS);
  const rest = material.slice(MAX_LOSS_ITEMS);
  for (const item of [...top, ...rest]) for (const id of item.findingIds) shown.add(id);

  const also = rest.length > 0
    ? { items: rest.slice(0, MAX_ALSO_NAMED), more: Math.max(0, rest.length - MAX_ALSO_NAMED) }
    : undefined;

  const watch = watchItems(summary, lossTests);
  for (const w of watch) for (const id of w.findingIds) shown.add(id);

  const what = summary.level === 'lot' ? 'region, fail bin or wafer' : 'region or fail bin';
  const nothing = top.length === 0
    ? `Nothing stands out: no ${what} costs as much as ${points(MIN_SHARE_OF_DIES)} yield points.`
    : undefined;
  return { headline: headlineOf(summary, ctx), items: top, ...(also ? { also } : {}), ...(watch.length ? { watch } : {}), ...(nothing ? { nothing } : {}), checked: checkedLine(summary, shown) };
}

/** The heading over the compact list of smaller items: the floor is the same one that admits an item at all. */
export const SYNTHESIS_SMALLER_HEADING = `Smaller, each costing at least ${(MIN_SHARE_OF_DIES * 100).toFixed(0)}% of the dies`;

/** A compact-list row: the item in a few words, then its share of the analysed dies. Plain text. */
export const synthesisRowShare = (it: SynthesisItem): string => `${(it.shareOfDies * 100).toFixed(1)}%`;

/** A synthesis as plain text, one line per part, for tests and for any surface that is not HTML. */
export function synthesisText(s: Synthesis): string {
  const line = (parts: SynthesisPart[]): string => parts.map(p => p.text).join('');
  return [line(s.headline), ...(s.nothing ? [s.nothing] : []), ...s.items.map((it, i) => `${i + 1}. ${line(it.parts)}`), ...(s.also ? [`${SYNTHESIS_SMALLER_HEADING}: ${s.also.items.map(it => `${it.brief.text} (${synthesisRowShare(it)})`).join('; ')}${s.also.more ? `; and ${s.also.more} more` : ''}.`] : []), ...(s.watch ? s.watch.map(w => `Watch: ${line(w.parts)}`) : []), s.checked].join('\n');
}
