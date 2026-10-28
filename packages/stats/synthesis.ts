// The results synthesis: a few sentences naming what is worth looking at, each built
// from the findings the panels already show. Pure — it reads a computed summary and
// recomputes nothing, so a figure in a sentence is the figure in the finding it names.
//
// Ranking is by the share of the lot an item affects, not by p-value or severity: severity
// saturates on a large lot and p-values track sample size, while "how much of the lot is
// this" does neither. A loss affects the dies it cost; a signal that costs no dies (a test
// shifted in a region, a drift across the wafers, a spread too wide for its limits) affects
// its dies weighted by how far it moved them, so a characterisation lot with no limits and no
// fails still has items, ranked on the same axis as yield loss. The p/effect gates still
// decide whether a finding is real; the share decides where it appears. Findings that stand
// on the same dies are one item, so a quadrant, a sector and an edge arc over the same corner
// read as one thing, not three.

import { maxOf, minOf } from '../core/utils.js';
import { isPassBin, passBinsLabel } from '../core/passBins.js';
import { DRIFT_MIN_WAFERS } from './lotDrift.js';
import { isOneBinCluster } from './filterFindings.js';
import { plainBinTerms } from '../renderer/fmt.js';
import { benjaminiHochberg, normalUpperTail } from './math.js';
import { compareGroups, formatP } from './groupCompare.js';
import { attributeLabel, buildFacetTable, facetValueOf, type FacetCuration } from './facets.js';
import type { LotStatsSummary, StatsFinding, StatsSeverity, StatsSummary } from './types.js';
import type { PlotBuiltin, PlotField, PlotSpec } from './plotSpec.js';

/**
 * What an item shows when it is chosen: a finding (its dies, as the findings list shows them), or a test
 * (its values, with the dies it fails). Every item and every Watch line has one, so a surface can make
 * every row act the same way rather than linking only the items that happen to rest on a finding.
 */
export type SynthesisTarget =
  | { kind: 'finding'; id: string }
  | { kind: 'test'; testNumber: number };

/** One part of an item that can be shown on its own: a fail bin in its region, the pattern, a test on the same dies. */
export interface SynthesisChip {
  label: string;
  target: SynthesisTarget;
  /** Set for a bin, so a surface can draw the bin's legend colour beside it. */
  bin?: { kind: 'hardBin' | 'softBin'; bin: number };
  /** Set for a test whose values shift on the item's dies: the chip shows that region on the test's map. */
  shift?: true;
}

/** How much of the lot an item costs, in three steps. Drawn as a meter, never as colour alone. */
export type ImpactTier = 'high' | 'medium' | 'low';

export interface SynthesisItem {
  /**
   * `loss`: the item costs dies (a region's shortfall, a fail bin, an outlier wafer, a failing test). `signal`: it costs
   * none of its own but moves the values (a test shifted in a region, a drift across the wafers, a spread too wide for
   * its limits, dies out of limits yet binned as passing). Both are ranked by `affected`.
   */
  kind: 'loss' | 'signal';
  /** From the share of the lot the item affects, the same quantity the items are ranked by. */
  impact: ImpactTier;
  /** `affected` as a fraction (0–1) of the analysed dies; set once the items are ranked. */
  shareOfDies: number;
  /** Estimated dies lost to this item (pass-rate shortfall × dies in the region). 0 for a signal. */
  diesLost: number;
  /**
   * The dies the item affects, the quantity it is ranked by: a loss, the dies it cost; a shift, the dies it moved
   * weighted by how far (in full from two standard deviations); a spread too wide for its limits, the dies it is
   * expected to put outside them.
   */
  affected: number;
  /** The item's size as its compact row shows it: `2.4%` of the dies for a loss, `1.3σ` for a shift, `Ppk 0.62`. */
  measure: string;
  severity: StatsSeverity;
  /** The item as a sentence. Plain text: what the item shows is `target`, and its parts are `chips`. */
  text: string;
  /**
   * The item in one short sentence, for a card that has a chart to say the rest: its own figure (a region's shortfall
   * and the dies it cost, a test's failures, a shift's size), without the bins, regions and tests `text` goes on to
   * name. Plain text.
   */
  reason: string;
  /** The item in a few words, for the compact list: `Ring 2: hard bin 4 (Short), 62 dies`. */
  brief: string;
  /** What `target` is, as a reader names it: `Ring 4 (edge)`, `W06`, `IP3_DBM`. */
  subject: string;
  /** What choosing the item shows: the finding whose dies it counts, or the test it is about. */
  target: SynthesisTarget;
  /** Its parts that can be shown alone, in the order the sentence names them. Empty for a single-part item. */
  chips: SynthesisChip[];
  /** Tests folded into the item beyond its chips, counted rather than listed. Absent when every test is a chip. */
  moreTests?: number;
  /** The leading finding, then the others that stand on the same dies. */
  findingIds: string[];
  /** Tests the item names: its own test, or tests whose failing dies lie mostly on its dies. */
  testNumbers: number[];
  /**
   * The chart that shows the item, as a plot of the lot (Insights' Worth a look card): a region's loss as yield by that
   * kind of region, a fail bin as the bins' shares by it, a shift as the test by it, a failing or too-wide test as its
   * histogram, a trend as a control chart, an outlier wafer as yield by wafer. Its title is the plot's own.
   */
  chart: Omit<PlotSpec, 'id'>;
}

export interface Synthesis {
  headline: string;
  items: SynthesisItem[];
  /**
   * Items that clear the floor but not the cap, so nothing material goes unmentioned: the ones named
   * (each shown in a few words, from its `brief`) and how many more were left out. Absent when the cap
   * shows them all.
   */
  also?: { items: SynthesisItem[]; more: number };
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
  /**
   * The host's wafer attributes (`attributes` on the render options), over the defaults: which wafer fields' groups are
   * compared (those Group by offers) and what each is called. Omitted ⇒ the defaults.
   */
  attributes?: Record<string, FacetCuration>;
}

/** A test whose Ppk against its limits is below this is a signal: 1.0 is the line between a spread that fits its limits and one that does not. */
const SIGNAL_PPK = 1.0;
/**
 * A shift of this many standard deviations counts its dies in full; a smaller one by the square of its share of it, so
 * a 1σ shift counts a quarter of its dies and a 0.6σ shift under a tenth. A shift moves values, it does not lose dies:
 * a small one over half a wafer must not outrank a quadrant losing a third of its yield.
 */
const FULL_SHIFT_SD = 2;
/** A shift smaller than this (a medium effect) is real but not worth a look on its own. */
const MIN_SHIFT_SD = 0.5;
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
const plural = (n: number, one: string, many = `${one}s`): string => `${count(n)} ${n === 1 ? one : many}`;

/** "NE" is a quadrant; the other families already say what they are ("Ring 4", "Sector NE"). */
function subjectOf(f: StatsFinding): string {
  const left = f.comparison.left;
  return f.comparison.family === 'quadrant' && !/quadrant/i.test(left) ? `${left} quadrant` : left;
}

/** One bin's cluster: a few dies of one bin, inside a ring and a quadrant at once. */
const isBinCluster = isOneBinCluster;

/**
 * Union-find over candidate indices: findings sharing dies are one item. One bin's cluster lies inside a ring and
 * a quadrant at once, so it never joins two items into one: it goes with the finding it shares most dies with, when
 * it is at least half of that finding's loss and of its bin or the pass rate, and otherwise stands as its own item.
 */
function groupBySharedDies(candidates: StatsFinding[]): number[][] {
  const parent = candidates.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const sets = candidates.map(dieKeySet);
  const sharedDies = (a: number, b: number): number => {
    const small = sets[a].size <= sets[b].size ? sets[a] : sets[b];
    const large = small === sets[a] ? sets[b] : sets[a];
    let shared = 0;
    for (const k of small) if (large.has(k)) shared++;
    return shared;
  };
  const binClusters = candidates.map((_, i) => i).filter(i => isBinCluster(candidates[i]));
  const rest = candidates.map((_, i) => i).filter(i => !isBinCluster(candidates[i]));
  for (let a = 0; a < rest.length; a++) {
    for (let b = a + 1; b < rest.length; b++) {
      const small = Math.min(sets[rest[a]].size, sets[rest[b]].size);
      if (small > 0 && sharedDies(rest[a], rest[b]) >= SHARED_DIES * small) parent[find(rest[a])] = find(rest[b]);
    }
  }
  for (const c of binClusters) {
    let best = -1, bestShared = 0;
    for (const r of rest) {
      // Its own bin's findings, or the pass rate's; another bin's rise is another cause.
      if (isBin(candidates[r]) && candidates[r].variable.bin !== candidates[c].variable.bin) continue;
      const shared = sharedDies(c, r);
      if (shared > bestShared && shared >= SHARED_DIES * sets[c].size && shared >= SHARED_DIES * diesLostBy(candidates[r])) {
        best = r; bestShared = shared;
      }
    }
    if (best >= 0) parent[c] = find(best);
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
function failBinsIn(lead: StatsFinding, findings: readonly StatsFinding[], isFailBin: (f: StatsFinding) => boolean): StatsFinding[] {
  const inRegion = (kind: 'hardBin' | 'softBin') => findings.filter(f =>
    f.variable.kind === kind && sameRegion(f, lead) && f.effect.direction === 'higher' && isFailBin(f));
  const bins = inRegion('hardBin').length > 0 ? inRegion('hardBin') : inRegion('softBin');
  return bins.filter(f => f !== lead).sort((a, b) => shortfall(b) - shortfall(a));
}

/** How a summary's bin findings are judged: which say a region's pass rate, which a failure. */
interface BinJudgement {
  /** A yield finding, or a pass bin's: the region's whole pass rate. */
  isPassRate: (f: StatsFinding) => boolean;
  isFailBin: (f: StatsFinding) => boolean;
}

/** "seen on" names: the families with a long tail (edge arcs, clusters) counted, the rest named. */
const FAMILY_PLURAL: Record<string, string> = {
  ring: 'rings', quadrant: 'quadrants', sector: 'sectors', 'edge-arc': 'edge arcs', cluster: 'clusters',
  'reticle-position': 'reticle positions', 'test-site': 'test sites',
};
/** At most this many of one family are named; beyond it the family is counted ("6 edge arcs"). */
const MAX_NAMED_PER_FAMILY = 2;
function seenAs(others: readonly StatsFinding[]): string {
  const byFamily = new Map<string, Set<string>>();
  for (const f of others) {
    const fam = f.comparison.family;
    (byFamily.get(fam) ?? byFamily.set(fam, new Set()).get(fam)!).add(subjectOf(f));
  }
  const said: string[] = [];
  for (const [fam, names] of byFamily) {
    if (names.size <= MAX_NAMED_PER_FAMILY) said.push(...names);
    else said.push(`${names.size} ${FAMILY_PLURAL[fam] ?? fam}`);
  }
  return said.join(', ');
}

const capitalise = (t: string): string => t.charAt(0).toUpperCase() + t.slice(1);
const findingTarget = (f: StatsFinding): SynthesisTarget => ({ kind: 'finding', id: f.id });
const binChip = (f: StatsFinding): SynthesisChip => ({
  label: capitalise(nameOf(f)),
  target: findingTarget(f),
  ...(f.variable.bin !== undefined && (f.variable.kind === 'hardBin' || f.variable.kind === 'softBin')
    ? { bin: { kind: f.variable.kind, bin: f.variable.bin } } : {}),
});

/** The plot field a finding's kind of region is drawn by: a sector by its quadrant, an arc or a cluster by the rings. */
function regionField(f: StatsFinding): PlotField {
  const fam = f.comparison.family;
  const builtin: PlotBuiltin = fam === 'quadrant' || fam === 'sector' ? 'quadrant'
    : fam === 'reticle-position' ? 'reticleCell' : fam === 'test-site' ? 'site' : 'ring';
  return { builtin };
}
/**
 * A rate by category (a yield, a pass rate) as a bar each, with its value at the end and the median of the bars as a
 * line, as the Overview's yield card shows it: where each bar stands, and against what.
 */
const rateBars = (x: PlotField, y: PlotField): Omit<PlotSpec, 'id'> =>
  ({ chart: 'bar', fields: { x, y, color: { none: true } }, valueLabels: true, axes: { y: { references: [{ stat: 'median' }] } } });
/** The test a finding or an item is about, as a plot field. */
const testField = (testNumber: number): PlotField => ({ test: testNumber });
const histogramOf = (testNumber: number, normalCurve = false): Omit<PlotSpec, 'id'> =>
  ({ chart: 'histogram', fields: { y: testField(testNumber), color: { none: true } }, ...(normalCurve ? { normalCurve: true } : {}) });

function lossItem(
  group: StatsFinding[],
  findings: readonly StatsFinding[],
  waferCount: number | undefined,
  judge: BinJudgement,
): SynthesisItem {
  // The finding that costs the most dies leads, and the rest stand on the same dies. A pass-rate finding
  // (yield, or a pass bin that fell) in that finding's own region leads instead: it is the whole shortfall
  // there, and the fail bins are its parts. A pass rate elsewhere in the group never outranks a larger
  // loss: an edge arc is a pass-rate finding on a few dies, and leading with it costed a ring by the arc.
  const costliest = [...group].sort((a, b) => diesLostBy(b) - diesLostBy(a))[0];
  const lead = group.find(f => judge.isPassRate(f) && sameRegion(f, costliest)) ?? costliest;
  const others = group.filter(f => f !== lead);

  const wafers = lead.level === 'lot' && 'waferIndices' in lead.highlight ? lead.highlight.waferIndices?.length : undefined;
  const where = wafers !== undefined && waferCount ? ` on ${wafers}/${waferCount} wafers` : '';
  const leadIsBin = !judge.isPassRate(lead);
  // What the region was compared with: the rest of the wafer, except for sectors, which leave out the dies
  // near the centre (a direction means little there) and are compared with the other sectors.
  const versus = lead.comparison.family === 'sector' ? 'the other sectors' : 'the rest of the wafer';
  let text = leadIsBin
    ? `${subjectOf(lead)}: ${nameOf(lead)} ${points(shortfall(lead))} points higher than ${versus}${where}`
    : `${subjectOf(lead)}: pass rate ${points(shortfall(lead))} points below ${versus}${where}`;

  const reason = `${text} — about ${count(diesLostBy(lead))} dies lost`;

  // Every die carries one hard bin, so a region's pass-rate shortfall is exactly the sum of its
  // fail-bin excesses: the bins are read, not guessed. "mostly" only when one bin is over half.
  const bins = failBinsIn(lead, findings, judge.isFailBin)
    .map(f => ({ f, share: shortfall(f) / (shortfall(lead) || 1) }))
    .filter(b => leadIsBin || b.share >= MIN_BIN_SHARE)
    .slice(0, MAX_BINS_NAMED);
  if (leadIsBin) {
    for (const { f } of bins) text += `, ${nameOf(f)} ${points(shortfall(f))} points higher`;
  } else if (bins.length > 0) {
    // The shortfall is the net of every bin, so the named bins can exceed it when another fail bin fell in
    // the region. They are then simply said to be higher, never "accounts for" more than the whole.
    const own = bins.reduce((n, b) => n + b.share, 0) <= 1 + 1e-9;
    const mostly = own && bins[0].share > 0.5 ? 'mostly ' : '';
    bins.forEach(({ f }, i) => {
      text += i === 0 ? `; ${own ? mostly : ''}` : ', ';
      text += nameOf(f) + (i === 0
        ? (own ? ` accounts for ${points(shortfall(f))} of those points` : ` is ${points(shortfall(f))} points higher`)
        : (own ? ` for ${points(shortfall(f))}` : ` ${points(shortfall(f))} points higher`));
    });
  }

  text += ` — about ${count(diesLostBy(lead))} dies lost`;
  const elsewhere = others.filter(f => !sameRegion(f, lead));
  if (elsewhere.length > 0) text += ` (also seen as ${seenAs(elsewhere)})`;
  const what = leadIsBin ? nameOf(lead) : 'pass rate';
  return {
    kind: 'loss',
    impact: 'low',
    shareOfDies: 0,
    diesLost: diesLostBy(lead),
    affected: diesLostBy(lead),
    measure: '',
    severity: lead.severity,
    text,
    reason,
    brief: `${subjectOf(lead)}: ${what}, ${count(diesLostBy(lead))} dies`,
    subject: subjectOf(lead),
    target: findingTarget(lead),
    // The bins the item names, each shown alone. A bin that leads is the row itself and is listed
    // too, so the chips are always the item's whole bin list, each with its legend colour.
    chips: [...(leadIsBin ? [lead] : []), ...bins.map(({ f }) => f)].map(binChip),
    findingIds: [lead.id, ...others.map(f => f.id)],
    testNumbers: [],
    // A fail bin's rise as each bin's share of the dies by that kind of region; a pass rate's fall as yield by it.
    chart: leadIsBin
      ? { chart: 'bar', fields: { x: regionField(lead), color: { builtin: lead.variable.kind === 'softBin' ? 'sbin' : 'hbin' } }, stack: 'percent' }
      // Across a lot the region's yield wafer by wafer: whether the loss is on every wafer or on one.
      : lead.level === 'lot'
        ? { chart: 'heatmap', fields: { x: { builtin: 'wafer' }, rows: regionField(lead), y: { builtin: 'yield' } } }
        : rateBars(regionField(lead), { builtin: 'yield' }),
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
      kind: 'loss',
      impact: 'low',
      shareOfDies: 0,
      diesLost: shortfall(f) * dies,
      affected: shortfall(f) * dies,
      measure: '',
      severity: f.severity,
      text: `${f.summary.replace(/ percentage points lower than the lot median$/, ' points below the lot median')} — about ${count(shortfall(f) * dies)} dies lost`,
      reason: `${f.summary.replace(/ percentage points lower than the lot median$/, ' points below the lot median')} — about ${count(shortfall(f) * dies)} dies lost`,
      brief: `${f.comparison.left}: yield, ${count(shortfall(f) * dies)} dies`,
      subject: f.comparison.left,
      target: findingTarget(f),
      chips: [],
      findingIds: [f.id],
      testNumbers: [],
      // The wafer's yield in the lot's order against the lot's own control limits: how far outside its spread it stands.
      chart: { chart: 'control', fields: { x: { builtin: 'waferOrder' }, y: { builtin: 'yield' } } },
    });
  }
  return items;
}

/**
 * A test's failures as the summary records them: the failing dies, keyed as {@link dieKeySet} keys them
 * (a lot's by wafer) so they can be laid over an item's dies, and how many also fail yield. `undefined`
 * when the summary does not carry them.
 */
function testFailures(summary: StatsSummary | LotStatsSummary, testNumber: number): { keys: Set<string>; lost: number } | undefined {
  if (summary.level === 'wafer') {
    const f = summary.stats.testFailures?.[testNumber];
    return f ? { keys: new Set(f.dieKeys), lost: f.lostDies } : undefined;
  }
  const keys = new Set<string>();
  let lost = 0;
  let any = false;
  for (const w of summary.perWafer) {
    const f = w.summary.stats.testFailures?.[testNumber];
    if (!f) continue;
    any = true;
    lost += f.lostDies;
    for (const k of f.dieKeys) keys.add(`${w.waferIndex}:${k}`);
  }
  return any ? { keys, lost } : undefined;
}

/** A test that costs dies, before it is either ranked on its own or folded into the item whose dies it fails on. */
interface TestLoss {
  item: SynthesisItem;
  testNumber: number;
  label: string;
  /** "is below its low limit", "fails": what the test does on its failing dies. */
  verb: string;
  /** `verb` without the low/high counts, for a sentence about only some of the failing dies. */
  plainVerb: string;
  failDies: number;
  /** Of `failDies`, the dies binned as passing: outside the test's limits, yet no yield lost. */
  passingDies: number;
  keys?: Set<string>;
}

/**
 * Tests that fail dies, from the tallies the summary already holds: a parametric test outside its limits
 * (`testSpecYield`) and a functional test that fails (`functionalYield`). They are not findings. A test
 * costs only the failing dies that also fail yield; a die outside a test's limits but binned as passing
 * costs nothing. A test whose failing dies lie mostly on one item's dies is folded into that item (see
 * {@link foldTests}); the rest stand on their own and are ranked with the items by the dies they cost.
 */
function testLosses(summary: StatsSummary | LotStatsSummary, named: Set<number>): TestLoss[] {
  const stats = summary.stats;
  const out: TestLoss[] = [];
  // A pass/fail test has no values to draw: its chart is its pass rate, by wafer for a lot and by ring for a wafer.
  const passRateChart = (testNumber: number): Omit<PlotSpec, 'id'> =>
    rateBars({ builtin: summary.level === 'lot' ? 'wafer' : 'ring' }, { passRate: testNumber });
  const make = (testNumber: number, label: string, failDies: number, totalDies: number, verb: string, brief: string, plainVerb = verb, functional = false): void => {
    if (failDies <= 0 || totalDies <= 0) return;
    named.add(testNumber);
    const failures = testFailures(summary, testNumber);
    // Without the per-die record (a summary from elsewhere), every failure is taken as lost.
    const lost = failures ? Math.min(failures.lost, failDies) : failDies;
    const passing = failDies - lost;
    const share = (failDies / totalDies) * 100;
    out.push({
      testNumber, label, verb, plainVerb, failDies, passingDies: passing, keys: failures?.keys,
      item: {
        kind: 'loss',
        impact: 'low',
        shareOfDies: 0,
        diesLost: lost,
        affected: lost,
        measure: '',
        severity: 'info',
        text: `${label} ${verb} on ${count(failDies)} of ${count(totalDies)} dies (${share.toFixed(1)}%)`
          + (passing > 0 ? `; ${count(passing)} of them are binned as passing, so about ${count(lost)} dies lost` : ''),
        reason: `${label} ${verb} on ${count(failDies)} of ${count(totalDies)} dies (${share.toFixed(1)}%)`,
        brief: passing > 0 ? `${label}: ${brief}, ${count(lost)} dies lost` : `${label}: ${count(failDies)} dies ${brief}`,
        subject: label,
        target: { kind: 'test', testNumber },
        chips: [],
        findingIds: [],
        testNumbers: [testNumber],
        // Across a lot, where the test fails (which wafers) is the question its limits histogram cannot answer.
        chart: functional || summary.level === 'lot' ? passRateChart(testNumber) : histogramOf(testNumber),
      },
    });
  };
  for (const t of stats.testSpecYield ?? []) {
    const verb = t.failHighDies === 0 ? 'is below its low limit'
      : t.failLowDies === 0 ? 'is above its high limit'
      : `is outside its limits (${count(t.failLowDies)} low, ${count(t.failHighDies)} high)`;
    make(t.testNumber, t.label, t.failLowDies + t.failHighDies, t.totalDies, verb, 'outside limits',
      t.failLowDies > 0 && t.failHighDies > 0 ? 'is outside its limits' : verb);
  }
  for (const t of stats.functionalYield ?? []) make(t.testNumber, t.label, t.failDies, t.totalDies, 'fails', 'fail', 'fails', true);
  return out;
}

/** A test joins an item when at least this share of its failing dies are on the item's dies… */
const FOLD_SHARE = 0.5;
/** …and that share is at least this many times the item's own share of the dies, so a test failing evenly
 *  across the wafer is not claimed by whichever large region it happens to overlap most. */
const FOLD_ENRICHMENT = 2;
/** An item's sentence names at most this many folded tests… */
const MAX_TESTS_SAID = 2;
/** …and its chips show at most this many; the rest are counted. A wafer whose every test fails on the edge
 *  folds dozens of tests into one item, and a chip per test buries the item it belongs to. */
const MAX_TEST_CHIPS = 5;

/**
 * Folds each test into the region item whose dies hold most of its failures. A region item counts only the
 * dies above the rest of the wafer, a test every die it fails, so the two ranked side by side put a test
 * ahead of the region it fails in — the same dies, counted twice and on different scales. Folded, the test
 * is said as part of the region's item and shown as one of its chips, the tests failing most dies first.
 * Returns the tests left standing alone, in the order they came.
 */
function foldTests(
  tests: TestLoss[], regionItems: SynthesisItem[], itemDies: Map<SynthesisItem, Set<string>>, total: number,
): TestLoss[] {
  const alone = new Set<TestLoss>();
  const said = new Map<SynthesisItem, number>();
  const shown = new Map<SynthesisItem, number>();
  const ranked = [...tests].sort((a, b) => b.failDies - a.failDies || a.testNumber - b.testNumber);
  for (const t of ranked) {
    const keys = t.keys;
    // A test too small to be listed on its own is too small to add to another item's sentence.
    if (total > 0 && t.failDies / total < MIN_SHARE_OF_DIES) { alone.add(t); continue; }
    let best: { item: SynthesisItem; inside: number } | undefined;
    if (keys && keys.size > 0 && total > 0) {
      for (const item of regionItems) {
        const dies = itemDies.get(item);
        if (!dies || dies.size === 0) continue;
        let inside = 0;
        for (const k of keys) if (dies.has(k)) inside++;
        const share = inside / keys.size;
        if (share >= FOLD_SHARE && share >= FOLD_ENRICHMENT * (dies.size / total) && (!best || inside > best.inside)) best = { item, inside };
      }
    }
    if (!best) { alone.add(t); continue; }
    const n = said.get(best.item) ?? 0;
    if (n < MAX_TESTS_SAID) {
      const where = best.inside === t.failDies ? 'all' : count(best.inside);
      best.item.text += `. ${t.label} ${t.verb} on ${plural(t.failDies, 'die')}, ${where} of them in ${best.item.subject}`;
      said.set(best.item, n + 1);
    }
    const chips = shown.get(best.item) ?? 0;
    if (chips < MAX_TEST_CHIPS) {
      best.item.chips.push({ label: t.label, target: t.item.target });
      shown.set(best.item, chips + 1);
    } else {
      best.item.moreTests = (best.item.moreTests ?? 0) + 1;
    }
    best.item.testNumbers.push(t.testNumber);
  }
  return tests.filter(t => alone.has(t));
}

/** A signal item: one that costs no dies of its own, ranked by the dies it affects. */
function signalItem(o: {
  affected: number; measure: string; severity: StatsSeverity; text: string; brief: string; subject: string;
  target: SynthesisTarget; chart: Omit<PlotSpec, 'id'>; findingIds?: string[]; testNumbers?: number[];
  /** Short of `text`, when `text` goes on past the item's own figure. Default `text`. */
  reason?: string;
}): SynthesisItem {
  return {
    kind: 'signal', impact: 'low', shareOfDies: 0, diesLost: 0, affected: o.affected, measure: o.measure,
    severity: o.severity, text: o.text, reason: o.reason ?? o.text, brief: o.brief, subject: o.subject, target: o.target, chips: [],
    findingIds: o.findingIds ?? [], testNumbers: o.testNumbers ?? [], chart: o.chart,
  };
}

/** How much of a shift of `d` standard deviations counts: none below {@link MIN_SHIFT_SD}, in full from {@link FULL_SHIFT_SD}. */
const shiftWeight = (d: number): number => (Math.abs(d) < MIN_SHIFT_SD ? 0 : Math.min(1, (Math.abs(d) / FULL_SHIFT_SD) ** 2));
const sigma = (d: number): string => `${Math.abs(d).toFixed(1)}σ`;
/** A test-value finding about a region: the test's mean differs there. */
const isShift = (f: StatsFinding): boolean => f.variable.kind === 'test' && f.variable.measure !== 'limitFailRate'
  && REGION_FAMILIES.has(f.comparison.family) && Number.isFinite(f.effect.effectSize ?? NaN) && !f.id.startsWith('drift:');

/**
 * A test whose values differ in a region (the test-value findings), one item per test led by its strongest region:
 * the region's dies weighted by the size of the shift. A shift standing mostly on a loss item's dies is said as part
 * of that item (the same dies, one item), and returns nothing here.
 */
function shiftItems(findings: readonly StatsFinding[], lossItems: SynthesisItem[], itemDies: Map<SynthesisItem, Set<string>>): SynthesisItem[] {
  const byTest = new Map<number, StatsFinding[]>();
  for (const f of findings) {
    if (!isShift(f) || f.variable.index === undefined) continue;
    (byTest.get(f.variable.index) ?? byTest.set(f.variable.index, []).get(f.variable.index)!).push(f);
  }
  const weight = (f: StatsFinding) => (diesIn(f) ?? f.stats.sampleSizeLeft) * shiftWeight(f.effect.effectSize ?? 0);
  const out: SynthesisItem[] = [];
  for (const [testNumber, list] of [...byTest].sort((a, b) => a[0] - b[0])) {
    const ranked = [...list].sort((a, b) => weight(b) - weight(a));
    const lead = ranked[0];
    const d = lead.effect.effectSize ?? 0;
    // Real but small: not worth a look on its own, nor worth a sentence in another item.
    if (weight(lead) === 0) continue;
    const dies = dieKeySet(lead);
    // An item that already holds one of these findings (a pattern lists the findings it explains) is its home; else the
    // loss item it shares most dies with, when at least half of the smaller of the two is shared.
    // An item that already names the test (its own loss item, or a region it fails in) says the shift too: one item
    // per test. The shifted region can be the other side of the same signal (higher elsewhere, failing low there).
    let home: SynthesisItem | undefined = lossItems.find(it => it.target.kind === 'test' && it.target.testNumber === testNumber)
      ?? lossItems.find(it => it.testNumbers.includes(testNumber))
      ?? lossItems.find(it => ranked.some(f => it.findingIds.includes(f.id))), best = 0;
    for (const item of home ? [] : lossItems) {
      const own = itemDies.get(item);
      if (!own || own.size === 0 || dies.size === 0) continue;
      let shared = 0;
      for (const k of dies) if (own.has(k)) shared++;
      if (shared >= SHARED_DIES * Math.min(own.size, dies.size) && shared > best) { best = shared; home = item; }
    }
    if (home) {
      // Said as part of the item: its sentence, and the test as one of the item's tests, its chip showing the shifted
      // region on the test's own map; unless the item already names the test as one that fails there.
      home.text += `. ${lead.summary}`;
      if (!home.testNumbers.includes(testNumber)) {
        const testChips = home.chips.filter(c => c.target.kind === 'test' || c.shift).length;
        if (testChips < MAX_TEST_CHIPS) home.chips.push({ label: lead.variable.label, target: findingTarget(lead), shift: true });
        else home.moreTests = (home.moreTests ?? 0) + 1;
        home.testNumbers.push(testNumber);
      }
      for (const f of ranked) if (!home.findingIds.includes(f.id)) home.findingIds.push(f.id);
      continue;
    }
    const n = diesIn(lead) ?? lead.stats.sampleSizeLeft;
    out.push(signalItem({
      affected: weight(lead), measure: sigma(d), severity: lead.severity,
      text: `${lead.summary}: a shift of ${sigma(d)} over ${plural(n, 'die')}`
        + (ranked.length > 1 ? ` (also seen as ${seenAs(ranked.slice(1))})` : ''),
      reason: `${lead.summary}: a shift of ${sigma(d)} over ${plural(n, 'die')}`,
      brief: `${subjectOf(lead)}: ${lead.variable.label} ${lead.effect.direction}`,
      subject: subjectOf(lead), target: findingTarget(lead), findingIds: ranked.map(f => f.id), testNumbers: [testNumber],
      // Each region's values against the median of every die plotted: the shift the item reports.
      chart: { chart: 'box', fields: { x: regionField(lead), y: testField(testNumber), color: { none: true } }, axes: { y: { references: [{ stat: 'median' }] } } },
    }));
  }
  return out;
}

/** A trend across the wafers (the lot's drift findings): a test's, weighted by its size; yield's, by the points it moved. */
function driftItems(findings: readonly StatsFinding[], total: number): SynthesisItem[] {
  return findings.filter(f => f.id.startsWith('drift:')).map(f => {
    const yieldTrend = f.variable.kind === 'yield';
    const size = f.effect.effectSize ?? 0;
    return signalItem({
      affected: total * (yieldTrend ? Math.abs(size) : shiftWeight(size)),
      measure: yieldTrend ? `${points(Math.abs(size))} pts` : sigma(size),
      severity: f.severity, text: f.summary, brief: `${f.variable.label}: drifts across the wafers`, subject: f.variable.label,
      target: findingTarget(f), findingIds: [f.id], ...(f.variable.index !== undefined ? { testNumbers: [f.variable.index] } : {}),
      // Wafer by wafer, in the order the trend was read, against the wafers' own variation.
      chart: { chart: 'control', fields: { x: { builtin: 'waferOrder' }, y: yieldTrend || f.variable.index === undefined ? { builtin: 'yield' } : testField(f.variable.index) } },
    });
  });
}

/**
 * A test whose spread is too wide for its limits (Ppk under 1.0) and that does not already cost dies: the dies its
 * spread is expected to put outside them, from the normal tail beyond 3 × Ppk standard deviations (Ppk 0.5 is about
 * 7%). A prediction, said as one.
 */
function capabilityItems(summary: StatsSummary | LotStatsSummary, failing: ReadonlySet<number>, total: number): SynthesisItem[] {
  return (summary.stats.capability ?? [])
    .filter(c => c.hasSpec && c.ppk !== null && c.ppk !== undefined && c.ppk < SIGNAL_PPK && !failing.has(c.testNumber))
    .map(c => {
      const ppk = c.ppk as number;
      const share = normalUpperTail(3 * ppk);
      return signalItem({
        affected: total * share, measure: `Ppk ${ppk.toFixed(2)}`, severity: 'notable',
        text: `${c.label} has Ppk ${ppk.toFixed(2)} against its limits: a spread that would put about ${points(share)}% of the dies outside them`,
        brief: `${c.label}: Ppk ${ppk.toFixed(2)}`, subject: c.label,
        target: { kind: 'test', testNumber: c.testNumber }, testNumbers: [c.testNumber], chart: histogramOf(c.testNumber, true),
      });
    });
}

/** A group's test shift is listed when its BH-adjusted p, over every field and test compared, is under this. */
const GROUP_Q = 0.05;
/** The most tests a group-shift chart draws together. */
const MAX_SET_TESTS = 8;

/**
 * A wafer field whose groups differ in tests (Vth higher on process split SS, on lot L2, on one test program): each
 * wafer one value, its mean, so a lot's dies do not make every wafer offset look certain. For every field Group by
 * would offer (two values or more, at most half as many as wafers) and every test with wafer means, the groups are
 * compared (Welch, or Kruskal–Wallis where Welch cannot be computed), adjusted together (Benjamini–Hochberg), and the
 * group furthest from the other wafers is the shift: its size in the test's within-wafer standard deviations, the scale
 * a region shift is measured on, weighted by the group's dies. One item per field, led by its largest shift and ranked
 * by its heaviest test.
 */
function groupShiftItems(lot: LotStatsSummary, attributes: Record<string, FacetCuration> | undefined): { items: SynthesisItem[]; compared: string[] } {
  const none = { items: [], compared: [] };
  const wafers = lot.perWafer;
  if (wafers.length < 4) return none;
  const fields = buildFacetTable(wafers.map(w => ({ metadata: w.summary.wafer as Record<string, string> | undefined, dieCount: w.summary.stats.totalDies })), { facetableOnly: true, curation: attributes })
    .filter(f => f.splittable && f.values.length <= Math.max(2, Math.floor(wafers.length / 2)));
  if (fields.length === 0) return none;
  // Each wafer's mean and spread per test: the lot's per-wafer table, or each wafer's own statistics.
  const statsOf = (w: (typeof wafers)[number]) => lot.perWaferTestStats?.find(x => x.waferIndex === w.waferIndex)?.tests ?? w.summary.stats.perTestStats ?? [];
  const perWafer = wafers.map(w => new Map(statsOf(w).filter(t => t.count >= 2 && Number.isFinite(t.mean)).map(t => [t.testNumber, t])));
  const tests = new Map<number, string>();
  for (const m of perWafer) for (const [n, t] of m) if (!tests.has(n)) tests.set(n, t.label);
  const dies = wafers.map(w => w.summary.stats.analyzedDies);

  type Candidate = { testNumber: number; label: string; field: string; group: string; groupWafers: number; groupDies: number; d: number; higher: boolean; p: number;
    /** With two groups, the other one: the sentence names both. */
    other?: { group: string; wafers: number } };
  const candidates: Candidate[] = [];
  for (const f of fields) {
    const groupOf = wafers.map(w => facetValueOf(w.summary.wafer as Record<string, string> | undefined, f.key, attributes));
    for (const [testNumber, label] of [...tests].sort((a, b) => a[0] - b[0])) {
      const byGroup = new Map<string, number[]>();
      const within: number[] = [];
      perWafer.forEach((m, i) => {
        const t = m.get(testNumber), g = groupOf[i];
        if (!t || g === undefined) return;
        (byGroup.get(g) ?? byGroup.set(g, []).get(g)!).push(i);
        if (Number.isFinite(t.stddev)) within.push(t.stddev ** 2);
      });
      if (byGroup.size < 2) continue;
      const cmp = compareGroups([...byGroup].map(([key, idx]) => ({ key, values: idx.map(i => perWafer[i].get(testNumber)!.mean) })));
      const p = cmp.welch?.p ?? cmp.kruskal?.p;
      const sd = within.length ? Math.sqrt(within.reduce((a, b) => a + b, 0) / within.length) : NaN;
      if (p === undefined || !Number.isFinite(p) || !(sd > 0)) continue;
      // The group furthest from the rest of the wafers.
      let best: Candidate | undefined;
      for (const [group, idx] of byGroup) {
        const inside = idx.map(i => perWafer[i].get(testNumber)!.mean);
        const rest = [...byGroup].filter(([k]) => k !== group).flatMap(([, ix]) => ix.map(i => perWafer[i].get(testNumber)!.mean));
        if (inside.length < 2 || rest.length < 2) continue;
        const delta = inside.reduce((a, b) => a + b, 0) / inside.length - rest.reduce((a, b) => a + b, 0) / rest.length;
        const d = delta / sd;
        // Furthest first; two groups are equally far, so the one with fewer wafers is the shifted one, then the higher.
        const better = !best || Math.abs(d) > Math.abs(best.d) + 1e-9
          || (Math.abs(Math.abs(d) - Math.abs(best.d)) <= 1e-9 && (idx.length < best.groupWafers || (idx.length === best.groupWafers && delta > 0)));
        if (better) best = { testNumber, label, field: f.key, group, groupWafers: idx.length, groupDies: idx.reduce((n, i) => n + dies[i], 0), d, higher: delta > 0, p };
      }
      if (best && byGroup.size === 2) {
        const [otherKey, otherIdx] = [...byGroup].find(([k]) => k !== best!.group)!;
        best.other = { group: otherKey, wafers: otherIdx.length };
      }
      if (best) candidates.push(best);
    }
  }
  const q = benjaminiHochberg(candidates.map(c => c.p));
  // Per field, the tests whose groups differ.
  const byField = new Map<string, Array<{ c: Candidate; q: number; weight: number }>>();
  candidates.forEach((c, i) => {
    const weight = c.groupDies * shiftWeight(c.d);
    if (q[i] >= GROUP_Q || weight === 0) return;
    (byField.get(c.field) ?? byField.set(c.field, []).get(c.field)!).push({ c, q: q[i], weight });
  });
  const compared = candidates.length ? [...new Set(candidates.map(c => c.field))].map(k => attributeLabel(k, attributes)) : [];
  const saidOf = (c: Candidate, field: string): string => c.other
    ? `${c.label} is ${c.higher ? 'higher' : 'lower'} on ${field} ${c.group} than on ${field} ${c.other.group} (${c.groupWafers} and ${c.other.wafers} wafers)`
    : `${c.label} is ${c.higher ? 'higher' : 'lower'} on ${field} ${c.group} (${c.groupWafers} of ${wafers.length} wafers) than on the other wafers`;
  const items = [...byField].map(([key, list]) => {
    // Largest shift first, so the one said as the largest is; the weight caps at 2σ, so it cannot order the shifts above it.
    list.sort((a, b) => Math.abs(b.c.d) - Math.abs(a.c.d) || b.weight - a.weight || a.c.testNumber - b.c.testNumber);
    const weight = list.reduce((m, x) => Math.max(m, x.weight), 0);
    const field = attributeLabel(key, attributes);
    const [lead, ...rest] = list;
    const c = lead.c;
    const said = `${saidOf(c, field)}: a shift of ${sigma(c.d)}`;
    // A field that moves many tests (corners, by design) is one item: its strongest test leads, the next two are named,
    // the rest counted, so one field never fills the list.
    const named = rest.slice(0, 2).map(({ c: o }) => `${o.label} ${o.higher ? 'higher' : 'lower'} on ${o.group} (${sigma(o.d)})`);
    const more = rest.length - named.length;
    const n = list.length;
    const text = n === 1
      ? `${said}, each wafer one value (q ${formatP(lead.q)})`
      : `${n} tests differ by ${field}. Largest: ${said}, each wafer one value (q ${formatP(lead.q)}); next: ${named.join(', ')}${more > 0 ? `, and ${more} more` : ''}`;
    const item = signalItem({
      affected: weight, measure: sigma(c.d), severity: lead.q < 0.001 ? 'unusual' : 'notable',
      text, reason: n === 1 ? said : `${n} tests differ by ${field}. Largest: ${said}`,
      brief: n === 1 ? `${field} ${c.group}: ${c.label} ${c.higher ? 'higher' : 'lower'}` : `${field}: ${n} tests differ`,
      subject: field, target: { kind: 'test', testNumber: c.testNumber }, testNumbers: list.map(x => x.c.testNumber),
      // Each wafer one value, as the comparison counts them (the dies of a wafer are not independent). Several tests: the
      // field's tests together, each rescaled to share an axis.
      chart: n > 1
        ? { chart: 'box', level: 'wafer', aggregate: 'mean', normalize: 'zscore', fields: { x: { builtin: 'test' }, y: { tests: list.slice(0, MAX_SET_TESTS).map(x => x.c.testNumber) }, color: { meta: key } } }
        : { chart: 'box', level: 'wafer', aggregate: 'mean', fields: { x: { meta: key }, y: testField(c.testNumber), color: { meta: key } } },
    });
    // Each of its tests shown on its own map, largest shift first; the rest counted.
    if (n > 1) {
      item.chips = list.slice(0, MAX_TEST_CHIPS).map(({ c: o }) => ({ label: `${o.label} ${sigma(o.d)}`, target: { kind: 'test', testNumber: o.testNumber } as SynthesisTarget }));
      if (n > MAX_TEST_CHIPS) item.moreTests = n - MAX_TEST_CHIPS;
    }
    return item;
  });
  return { items, compared };
}

/** Dies outside a test's limits but binned as passing: the limits and the test program disagree about them. */
function passingFailItems(passingFails: readonly TestLoss[]): SynthesisItem[] {
  return passingFails.map(t => signalItem({
    affected: t.passingDies, measure: '', severity: 'notable',
    text: `${t.label} ${t.plainVerb} on ${plural(t.passingDies, 'die')} binned as passing`,
    brief: `${t.label}: ${count(t.passingDies)} dies out of limits, binned passing`, subject: t.label,
    target: t.item.target, testNumbers: [t.testNumber], chart: histogramOf(t.testNumber),
  }));
}

function headlineOf(summary: StatsSummary | LotStatsSummary, ctx: SynthesisContext): string {
  const pass = ctx.passBins && ctx.passBins.length > 0 ? `; pass ${passBinsLabel([ctx.passBins])}` : '';
  if (summary.level === 'wafer') {
    const y = summary.stats.yieldPercent;
    if (y === null || y === undefined) return `${count(summary.stats.totalDies)} dies, no bin data to judge yield by.`;
    return `Yield ${y.toFixed(1)}% (${count(summary.stats.totalDies)} dies${pass}).`;
  }
  const ys = summary.lotYieldSeries.map(p => p.yieldPercent).filter((v): v is number => typeof v === 'number');
  if (ys.length === 0) return `${plural(summary.stats.waferCount, 'wafer')}, no bin data to judge yield by.`;
  const mean = ys.reduce((a, b) => a + b, 0) / ys.length;
  const dies = summary.perWafer.reduce((n, w) => n + w.summary.stats.totalDies, 0);
  const [lo, hi] = [minOf(ys).toFixed(1), maxOf(ys).toFixed(1)];
  const range = lo !== hi ? `, range ${lo}–${hi}%` : '';
  return `Yield ${mean.toFixed(1)}% (mean of ${plural(ys.length, 'wafer')}, ${count(dies)} dies${pass})${range}.`;
}

/** What was compared. Read from the summary, so it never claims more than the analysis shows it did. */
function checkedLine(summary: StatsSummary | LotStatsSummary, shown: Set<string>, groupFields: readonly string[] = []): string {
  const parts: string[] = [];
  const tests = summary.level === 'wafer'
    ? summary.stats.testsConsidered.length
    : new Set(summary.perWafer.flatMap(w => w.summary.stats.testsConsidered)).size;
  const hbins = summary.level === 'wafer'
    ? summary.stats.hardBinsConsidered.length
    : new Set(summary.perWafer.flatMap(w => w.summary.stats.hardBinsConsidered)).size;
  // When the test-value analysis was skipped only the limit checks ran over the
  // tests, and when it was off not even those, so the count must not read as
  // "every test's values were compared".
  const state = summary.stats.testValueAnalysis?.state;
  if (tests > 0 && state !== 'off') parts.push(plural(tests, 'test') + (state === 'skipped' ? ' (against their limits only)' : ''));
  if (hbins > 0) parts.push(plural(hbins, 'hard bin'));
  parts.push('the ring, quadrant and sector regions');
  if (summary.level === 'lot' && summary.stats.waferCount >= 3) {
    const outliers = summary.findings.filter(isOutlierWafer);
    parts.push(outliers.length === 0 ? 'wafer-to-wafer yield (no outlier wafers)' : `wafer-to-wafer yield (${plural(outliers.length, 'outlier wafer')})`);
    if (summary.stats.waferCount >= DRIFT_MIN_WAFERS) parts.push('the yield trend across the wafers (input order)');
    if (groupFields.length) parts.push(`the tests between the groups of ${groupFields.join(', ')} (each wafer one value)`);
  }
  const rest = summary.findings.filter(f => !shown.has(f.id)).length;
  const tail = rest > 0 ? ` ${plural(rest, 'smaller finding')} not listed above.` : ' Nothing else was found.';
  return `Compared: ${parts.join(', ')}.${tail}`;
}

/**
 * The summary a synthesis is written from. A lot of one wafer is that wafer: the lot's own findings need
 * a signal to recur on two wafers, so on one they are always empty and the lot would read as clean while
 * its only wafer is not. Surfaces resolve an item's finding ids against this summary's findings.
 */
export function synthesisSource(summary: StatsSummary | LotStatsSummary): StatsSummary | LotStatsSummary {
  return summary.level === 'lot' && summary.perWafer.length === 1 ? summary.perWafer[0].summary : summary;
}

/**
 * Built syntheses by summary, then by the options that shape one. The summary panel, Insights and the report each ask for
 * the same synthesis of the same summary, and building it costs about a second on a lot of 266,000 dies, so a later
 * request for one already built is answered from here. Keyed on the summary object, so it goes with it, and on the
 * options by their content (the pass bins and the attributes), so a change to either builds again.
 */
const synthesisCache = new WeakMap<StatsSummary | LotStatsSummary, Map<string, { findings: readonly StatsFinding[]; synthesis: Synthesis }>>();

/**
 * The synthesis for a wafer or a lot: a headline, up to three loss items ranked by dies
 * lost, and a line saying what was compared. The result is shared between callers, so it is frozen.
 */
export function buildSynthesis(input: StatsSummary | LotStatsSummary, ctx: SynthesisContext = {}): Synthesis {
  const key = `${ctx.passBins?.join(',') ?? '-'}|${ctx.attributes ? JSON.stringify(ctx.attributes) : '-'}`;
  let byOptions = synthesisCache.get(input);
  if (!byOptions) synthesisCache.set(input, byOptions = new Map());
  const cached = byOptions.get(key);
  // The findings are what a synthesis is built from, so an entry holds only while they are the same ones: a summary whose
  // findings were added to, removed or replaced after the first build is built again.
  const findings = input.findings;
  if (cached && cached.findings.length === findings.length && cached.findings.every((f, i) => f === findings[i])) return cached.synthesis;
  const built = computeSynthesis(input, ctx);
  Object.freeze(built.items);
  built.items.forEach(Object.freeze);
  if (built.also) { Object.freeze(built.also.items); built.also.items.forEach(Object.freeze); Object.freeze(built.also); }
  byOptions.set(key, { findings: [...findings], synthesis: Object.freeze(built) });
  return built;
}

function computeSynthesis(input: StatsSummary | LotStatsSummary, ctx: SynthesisContext): Synthesis {
  const summary = synthesisSource(input);
  const findings = summary.findings;
  const waferCount = summary.level === 'lot' ? summary.stats.waferCount : undefined;

  const passBins = ctx.passBins;
  // Candidates: a region finding where the pass rate fell, or a fail bin rose. Both need dies to
  // be costed. A pattern finding does not stand on dies of its own; it names the region findings
  // it explains, and those are the candidates.
  const byId = new Map(findings.map(f => [f.id, f]));
  // A bin is a failure only against known pass bins. Without them (wafers judged differently) the bins
  // are left out and the items rest on yield alone. Pass bins are hard-bin numbers; they judge a soft
  // bin only when the dies carry no hard bin, when a die's verdict is its soft bin's (`diePassStatus`).
  // Otherwise a soft bin's verdict is unknown here and a rise in one is taken as a failure.
  const softJudged = (summary.level === 'wafer' ? [summary] : summary.perWafer.map(w => w.summary))
    .every(w => (w.stats.hardBinsConsidered ?? []).length === 0);
  const judgedPass = (f: StatsFinding): boolean => passBins !== undefined && isBin(f) &&
    isPassBin(f.variable.kind as 'hardBin' | 'softBin', f.variable.bin ?? NaN, passBins, !softJudged);
  const judge: BinJudgement = {
    // The only pass bin, fallen in a region, is that region's pass rate, as a yield finding is: data with
    // soft bins only has no separate yield finding, and costing its region by one fail bin undercounts it.
    // With several pass bins one of them is only a part of the pass rate.
    isPassRate: f => f.variable.kind === 'yield' || (passBins?.length === 1 && judgedPass(f)),
    isFailBin: f => passBins !== undefined && isBin(f) && !judgedPass(f),
  };
  const candidates = findings.filter(f =>
    REGION_FAMILIES.has(f.comparison.family) && diesLostBy(f) > 0 &&
    ((judge.isPassRate(f) && f.effect.direction === 'lower') ||
     (judge.isFailBin(f) && f.effect.direction === 'higher')));
  // Soft bins duplicate hard bins' dies when both exist; the hard bin speaks for them.
  const hasHard = candidates.some(f => f.variable.kind === 'hardBin');
  const costed = hasHard ? candidates.filter(f => f.variable.kind !== 'softBin') : candidates;

  const items: SynthesisItem[] = [];
  const itemDies = new Map<SynthesisItem, Set<string>>();
  const shown = new Set<string>();
  for (const group of groupBySharedDies(costed)) {
    const members = group.map(i => costed[i]);
    const item = lossItem(members, findings, waferCount, judge);
    items.push(item);
    // The dies of the region the item names: a test folded in is said to fail "in" that region, so it is
    // counted against those dies, not the arcs and clusters the item also covers.
    const lead = item.target.kind === 'finding' ? item.target.id : undefined;
    itemDies.set(item, dieKeySet(members.find(f => f.id === lead) ?? members[0]));
  }

  // A spatial pattern names the loss it explains: lead its item with the pattern, so "Edge-ring on
  // all 6 wafers" is said once, with the region figures after it. The pattern is a chip, ahead of the bins.
  for (const pattern of findings.filter(f => f.variable.kind === 'spatialPattern')) {
    const members = new Set((pattern.relatedIds ?? []).filter(id => byId.has(id)));
    const item = items.find(it => it.findingIds.some(id => members.has(id)));
    if (!item) continue;
    const seen = pattern.level === 'lot' && 'waferIndices' in pattern.highlight ? pattern.highlight.waferIndices?.length : undefined;
    const on = seen !== undefined && waferCount ? ` on ${seen}/${waferCount} wafers` : '';
    item.text = `${pattern.variable.label} pattern${on}. ${item.text}`;
    item.reason = `${pattern.variable.label} pattern${on}. ${item.reason}`;
    item.chips.unshift({ label: `${pattern.variable.label} pattern`, target: findingTarget(pattern) });
    // A finding the pattern explains that another item already holds stays with that item.
    item.findingIds.unshift(pattern.id, ...[...members].filter(id => !items.some(it => it.findingIds.includes(id))));
  }

  const total = analysedDies(summary);
  const lossTests = new Set<number>();
  const losses = testLosses(summary, lossTests);
  const regionItems = [...items];
  const standalone = foldTests(losses, regionItems, itemDies, total);
  if (summary.level === 'lot') items.push(...outlierItems(summary));
  items.push(...standalone.map(t => t.item));

  // Signals, on the same axis: shifts (or said within the loss item on their dies), drifts, spreads too wide for
  // their limits, and dies out of limits yet binned as passing. A test that stands as its own loss item already says
  // how many of its failing dies are binned as passing.
  // (Only when that item is listed: one that costs under a yield point says nothing.)
  const alone = new Set(standalone.filter(t => total > 0 && t.item.diesLost / total >= MIN_SHARE_OF_DIES).map(t => t.testNumber));
  items.push(
    ...shiftItems(findings, [...regionItems, ...standalone.map(t => t.item)], itemDies),
    ...driftItems(findings, total),
    ...capabilityItems(summary, lossTests, total),
    ...passingFailItems(losses.filter(t => t.passingDies > 0 && !alone.has(t.testNumber))),
  );

  // A field whose groups differ in tests is one item. One that moves a single test an item already names is said in
  // that item instead: one item per test.
  let groupFields: string[] = [];
  if (summary.level === 'lot') {
    const groups = groupShiftItems(summary, ctx.attributes);
    groupFields = groups.compared;
    for (const g of groups.items) {
      const n = g.testNumbers[0];
      const home = g.testNumbers.length === 1
        ? items.find(it => it.target.kind === 'test' && it.target.testNumber === n) ?? items.find(it => it.testNumbers.includes(n))
        : undefined;
      if (home) home.text += `. ${g.text}`;
      else items.push(g);
    }
  }

  const failing = failingDies(summary);
  const material = items.filter(it => total > 0 && it.affected / total >= MIN_SHARE_OF_DIES);
  for (const it of material) {
    it.shareOfDies = it.affected / total;
    it.impact = impactTier(it.shareOfDies, it.kind === 'loss' && failing > 0 ? it.diesLost / failing : 0);
    if (!it.measure) it.measure = `${(it.shareOfDies * 100).toFixed(1)}%`;
  }
  // Largest first; ties by the first test or finding named, so the same data always lists the same order.
  const tie = (it: SynthesisItem) => `${String(it.testNumbers[0] ?? '').padStart(10, '0')}${it.findingIds[0] ?? ''}`;
  material.sort((a, b) => b.affected - a.affected || (tie(a) < tie(b) ? -1 : tie(a) > tie(b) ? 1 : 0));
  const top = material.slice(0, MAX_LOSS_ITEMS);
  const rest = material.slice(MAX_LOSS_ITEMS);
  for (const item of [...top, ...rest]) for (const id of item.findingIds) shown.add(id);

  const also = rest.length > 0
    ? { items: rest.slice(0, MAX_ALSO_NAMED), more: Math.max(0, rest.length - MAX_ALSO_NAMED) }
    : undefined;

  const what = summary.level === 'lot' ? 'region, fail bin or wafer' : 'region or fail bin';
  // "Nothing stands out" would contradict a finding marked Unusual in the list below, so then the
  // sentence says only what is true: none of them costs a yield point.
  const unusual = findings.filter(f => f.severity === 'unusual' && !shown.has(f.id)).length;
  const nothing = top.length === 0
    ? unusual > 0
      ? `No ${what} costs as much as ${points(MIN_SHARE_OF_DIES)} yield points, though ${plural(unusual, 'finding')} below ${unusual === 1 ? 'is' : 'are'} marked unusual.`
      : `Nothing stands out: no ${what} costs as much as ${points(MIN_SHARE_OF_DIES)} yield points.`
    : undefined;
  return { headline: headlineOf(summary, ctx), items: top, ...(also ? { also } : {}), ...(nothing ? { nothing } : {}), checked: checkedLine(summary, shown, groupFields) };
}

/**
 * A stable key for an item: what it shows, the same in the panel and in Insights, so a row's Chart link finds the item's
 * card and a card's Show on map finds its row.
 */
export const synthesisKey = (it: Pick<SynthesisItem, 'target'>): string =>
  it.target.kind === 'finding' ? `finding:${it.target.id}` : `test:${it.target.testNumber}`;

/** The heading over the compact list of further items: the floor is the same one that admits an item at all. */
export const SYNTHESIS_ALSO_HEADING = `Also, each affecting at least ${(MIN_SHARE_OF_DIES * 100).toFixed(0)}% of the dies`;

/** A compact-list row: the item in a few words, then its size (`2.4%` of the dies, `1.3σ`, `Ppk 0.62`). Plain text. */
export const synthesisRowShare = (it: SynthesisItem): string => it.measure;

/** After an item's chips: the folded tests not shown as one. Undefined when every test is a chip. Plain text. */
export const synthesisMoreTests = (it: SynthesisItem): string | undefined =>
  it.moreTests ? `and ${it.moreTests} more test${it.moreTests === 1 ? '' : 's'}` : undefined;

/** A synthesis as plain text, one line per item, for tests and for any surface that is not HTML. */
export function synthesisText(s: Synthesis): string {
  return [
    s.headline,
    ...(s.nothing ? [s.nothing] : []),
    ...s.items.map((it, i) => `${i + 1}. ${it.text}`),
    ...(s.also ? [`${SYNTHESIS_ALSO_HEADING}: ${s.also.items.map(it => `${it.brief} (${synthesisRowShare(it)})`).join('; ')}${s.also.more ? `; and ${s.also.more} more` : ''}.`] : []),
    s.checked,
  ].join('\n');
}
