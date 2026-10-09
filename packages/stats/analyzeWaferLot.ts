import { waferDisplayLabel } from '../core/waferLabel.js';
import type { WaferMetadata } from '../core/metadata.js';
import { requireRingCount } from '../core/ringCount.js';
import {
  analyzeWaferMap, candidatesOf, describeRegional, resolveOptions, adjustPValues,
  twoProportionZ, welchOfSums, rateRelativeEffect, passesRateGate,
  severityForFinding, severityForScore, collapseRedundantFindings,
  findContiguousRuns, mergedRegionLabel, type MeanStats,
  type RegionCandidate, type ResolvedOptions, type RedundancyFacts, type WaferComparisons,
} from './analyzeWaferMap.js';
import { normalizeInput } from './normalizeInput.js';
import { poolCapability, poolRegionYield, poolPassRates } from './summaryFigures.js';
import { mergeTestDefs } from './mergeTestDefs.js';
import { findingPatternKey } from './filterFindings.js';
import type { WaferMapResult } from '../renderer/buildWaferMap.js';
import { median } from '../core/utils.js';
import { robustFence, zPValue } from './math.js';
import { findLotPattern, type LotPattern } from './lotPattern.js';
import { buildDriftFindings } from './lotDrift.js';
import { claimForPattern, weakestMultiplier } from './analyzeWaferMap.js';
import { PATTERN_LABELS } from './patternClassification.js';
import { describeWaferPopulation, populationStat, type WaferPopulation } from './population.js';
import type {
  AnalyzeWaferLotInput,
  AnalyzeWaferMapOptions,
  LotStatsSummary,
  StatsFinding,
  StatsSeverity,
  StatsSummary,
} from './types.js';

/** From this many wafers, Tukey's fences; below it, Dixon's Q test. With few
 *  values the quartiles sit almost on the extremes, so a fence can flag nothing
 *  (30/90/91: lower fence ≈ 14%) — Dixon's Q is the test built for small samples.
 *  Tukey takes over because Dixon tests only the most extreme wafer on each side,
 *  and on a large lot a second low wafer would mask the first. */
const TUKEY_MIN_WAFERS = 8;

/** Dixon's Q (r10) critical values at 95% and 99%, by wafer count 3–7
 *  (Rorabacher, Anal. Chem. 63, 1991). */
const DIXON_Q: Record<number, [number, number]> = {
  3: [0.970, 0.994], 4: [0.829, 0.926], 5: [0.710, 0.821], 6: [0.625, 0.740], 7: [0.568, 0.680],
};

/** An outlier wafer must also be at least this many yield points from the median.
 *  Both tests are relative to the wafers' own spread, so in a tight lot they flag
 *  differences no engineer would act on (1.5 points above a 94–95% lot). */
const OUTLIER_MIN_POINTS = 3;

export interface WaferOutlier {
  /** Position in the `yields` array passed in. */
  index: number;
  severity: 'notable' | 'unusual';
  /** The test's own statistic: Dixon's Q, or the distance from the median in IQR units. */
  statistic: number;
}

/**
 * The one rule for "outlier wafer", over per-wafer yields — the lot findings and
 * the Summary panel's yield bars both read it, so the list and the findings never
 * disagree about a wafer.
 *
 * - 3–7 wafers: Dixon's Q test on the lowest and highest wafer — gap to its
 *   nearest neighbour over the range. Beyond the 95% critical value is
 *   `notable`, beyond 99% `unusual`.
 * - 8 or more: Tukey's fences — beyond 1.5 × IQR from the quartiles is
 *   `notable`, beyond 3 × IQR `unusual`.
 * - Fewer than 3 wafers, or no spread: none — with two wafers there is no
 *   telling which is the odd one.
 *
 * Both tests judge a wafer against the wafers' own spread, so either may also
 * flag a trivially small difference in a tight lot; a wafer is an outlier only
 * when it is also at least `OUTLIER_MIN_POINTS` yield points from the median.
 */
export function outlierWafers(yields: readonly number[]): { method: 'dixon-q' | 'tukey-fence'; outliers: WaferOutlier[] } | null {
  const n = yields.length;
  if (n < 3) return null;
  const center = median([...yields]);
  const bigEnough = (y: number) => Math.abs(y - center) >= OUTLIER_MIN_POINTS;
  if (n >= TUKEY_MIN_WAFERS) {
    const notable = robustFence(yields, 1.5, TUKEY_MIN_WAFERS);
    const unusual = robustFence(yields, 3, TUKEY_MIN_WAFERS);
    if (!notable || !unusual) return null;
    const iqr = (notable.hi - notable.lo) / 4;  // the 1.5·IQR fences are 4·IQR apart
    const outliers: WaferOutlier[] = [];
    yields.forEach((y, index) => {
      if ((y >= notable.lo && y <= notable.hi) || !bigEnough(y)) return;
      const severity = y < unusual.lo || y > unusual.hi ? 'unusual' : 'notable';
      outliers.push({ index, severity, statistic: (y - center) / iqr });
    });
    return { method: 'tukey-fence', outliers };
  }
  const order = yields.map((_, i) => i).sort((a, b) => yields[a] - yields[b]);
  const range = yields[order[n - 1]] - yields[order[0]];
  if (range === 0) return null;
  const [q95, q99] = DIXON_Q[n];
  const outliers: WaferOutlier[] = [];
  const test = (index: number, neighbour: number) => {
    const q = Math.abs(yields[index] - yields[neighbour]) / range;
    if (q > q95 && bigEnough(yields[index])) outliers.push({ index, severity: q > q99 ? 'unusual' : 'notable', statistic: q });
  };
  test(order[0], order[1]);
  test(order[n - 1], order[n - 2]);
  return { method: 'dixon-q', outliers };
}
const REPEATED_PATTERN_MIN_WAFERS = 2;

function maxSeverity(left: StatsSeverity, right: StatsSeverity): StatsSeverity {
  const rank: Record<StatsSeverity, number> = { info: 0, notable: 1, unusual: 2 };
  return rank[left] >= rank[right] ? left : right;
}


/** The region families whose adjacent regions merge into one lot finding. */
const MERGEABLE_FAMILIES = new Set(['ring', 'quadrant', 'sector']);
const REGION_FAMILIES = new Set(['ring', 'quadrant', 'sector', 'reticle-position', 'test-site']);
const REGIONAL_KINDS = new Set(['yield', 'hardBin', 'softBin', 'functionalTest', 'test']);
/** A regional rate or test-value finding: the lot reports these from all wafers' data
 *  combined (`buildPooledRegionFindings`), not by counting wafers that reported one. */
function isPooledKind(f: StatsFinding): boolean {
  return REGION_FAMILIES.has(f.comparison.family) && REGIONAL_KINDS.has(f.variable.kind);
}

interface WaferCandidates { waferIndex: number; byKey: Map<string, RegionCandidate> }

/**
 * The redundancy facts that hold for the lot: a hard/soft pair coincides, a soft
 * bin is the yield, the pass bins agree — only where every wafer says so.
 */
function lotRedundancyFacts(wafers: WaferComparisons[], sectorCount: number): RedundancyFacts {
  const facts = wafers.map(w => w.facts);
  if (!facts.length || facts.some(f => !f)) return { coincident: new Set(), yieldSoftBin: undefined, passBins: [], sectorCount };
  const [first, ...rest] = facts as RedundancyFacts[];
  const samePass = rest.every(f => f.passBins.length === first.passBins.length && f.passBins.every(b => first.passBins.includes(b)));
  return {
    coincident: new Set([...first.coincident].filter(pair => rest.every(f => f.coincident.has(pair)))),
    yieldSoftBin: rest.every(f => f.yieldSoftBin === first.yieldSoftBin) ? first.yieldSoftBin : undefined,
    passBins: samePass ? first.passBins : [],
    sectorCount,
  };
}

interface Combined {
  z: number;
  delta: number;
  relativeDelta: number | undefined;
  /** Rates: relative effect on the adverse outcome; test values: pooled Cohen's d. */
  size: number;
}

/**
 * Stouffer's weighted Z over the wafers: each wafer's own signed z (the test its
 * analysis used), weighted by √(dies compared). Rates take their effect from the
 * summed counts; test values from the die-weighted mean of each wafer's effect.
 * `rest(c)` gives the rest-of-wafer side for each wafer, so the same routine
 * serves the re-test that leaves stronger opposite regions out.
 */
function combine(
  entries: { waferIndex: number; c: RegionCandidate }[],
  rest: (w: number, c: RegionCandidate) => { hits: number; n: number; sum: number; sq: number },
): Combined {
  let zw = 0, ww = 0;
  let hits = 0, n = 0, restHits = 0, restN = 0;
  let dSum = 0, deltaSum = 0, relSum = 0, relAll = true, meanN = 0;
  for (const { waferIndex, c } of entries) {
    const r = rest(waferIndex, c);
    const own = c.rate ?? c.mean!;
    const w = Math.sqrt(own.n + r.n);
    if (c.rate) {
      zw += w * twoProportionZ(c.rate.hits, c.rate.n, r.hits, r.n);
      hits += c.rate.hits; n += c.rate.n; restHits += r.hits; restN += r.n;
    } else {
      const t = welchOfSums(c.mean!, r.n, r.sum, r.sq);
      zw += w * t.z;
      dSum += c.mean!.n * t.effectSize; deltaSum += c.mean!.n * t.delta; meanN += c.mean!.n;
      if (c.relativeDelta === undefined) relAll = false; else relSum += c.mean!.n * c.relativeDelta;
    }
    ww += w * w;
  }
  const z = ww > 0 ? zw / Math.sqrt(ww) : 0;
  const first = entries[0].c;
  if (first.rate) {
    const restRate = restHits / restN;
    const delta = hits / n - restRate;
    return { z, delta, relativeDelta: restRate === 0 ? undefined : delta / restRate,
      size: rateRelativeEffect({ hits, n, restHits, restN, passRate: first.rate.passRate }) };
  }
  return { z, delta: deltaSum / meanN, relativeDelta: relAll ? relSum / meanN : undefined, size: dSum / meanN };
}

function passesCombinedGate(c: RegionCandidate, adjustedP: number, combined: Combined, options: ResolvedOptions): boolean {
  return c.rate
    ? passesRateGate(adjustedP, combined.delta, combined.size, options)
    : adjustedP <= options.significanceLevel && Math.abs(combined.size) >= options.minimumEffectSize;
}

/**
 * Lot findings for regional comparisons, tested on every wafer's data together
 * rather than by counting the wafers whose own analysis reported one: a pattern
 * present on every wafer but too faint on some to pass alone is still the
 * lot's pattern. Gates, Benjamini–Hochberg adjustment and the re-test against
 * stronger opposite regions are the wafer analysis's own. "N/M wafers" counts
 * the wafers whose region differs in the finding's direction.
 */
function buildPooledRegionFindings(
  wafers: WaferCandidates[], options: ResolvedOptions, facts: RedundancyFacts, ringCount: number,
): StatsFinding[] {
  const byKey = new Map<string, { waferIndex: number; c: RegionCandidate }[]>();
  for (const { waferIndex, byKey: cands } of wafers) {
    for (const c of cands.values()) (byKey.get(c.key) ?? byKey.set(c.key, []).get(c.key)!).push({ waferIndex, c });
  }
  const perWafer = new Map(wafers.map(w => [w.waferIndex, w.byKey]));
  const ownRest = (_w: number, c: RegionCandidate) => c.rate
    ? { hits: c.rate.restHits, n: c.rate.restN, sum: 0, sq: 0 }
    : { hits: 0, n: c.mean!.restN, sum: c.mean!.restSum, sq: c.mean!.restSq };

  type Candidate = { key: string; entries: { waferIndex: number; c: RegionCandidate }[]; combined: Combined; finding: StatsFinding };
  const all: Candidate[] = [];
  for (const [key, entries] of byKey) {
    if (entries.length < REPEATED_PATTERN_MIN_WAFERS) continue;
    const combined = combine(entries, ownRest);
    if (combined.z === 0) continue;
    const t = entries[0].c;
    all.push({ key, entries, combined, finding: {
      id: `lot-region:${key}`,
      level: 'lot',
      severity: 'info',
      variable: { ...t.variable, label: t.label },
      comparison: { ...t.comparison },
      effect: {
        direction: combined.z > 0 ? 'higher' : 'lower',
        absoluteDelta: combined.delta,
        relativeDelta: combined.relativeDelta,
        effectSize: t.rate ? combined.delta : combined.size },
      stats: { method: 'stouffer-z', pValue: zPValue(combined.z), sampleSizeLeft: 0, sampleSizeRight: 0 },
      summary: '',
      highlight: { kind: 'wafer', waferIndices: [] } } });
  }
  adjustPValues(all.map(a => a.finding as Parameters<typeof adjustPValues>[0][number]));

  const significant = all.filter(a => passesCombinedGate(a.entries[0].c, a.finding.stats.adjustedPValue ?? 1, a.combined, options));
  const sameComparison = (a: Candidate, b: Candidate) => {
    const x = a.entries[0].c, y = b.entries[0].c;
    return x.source === y.source && x.variable.kind === y.variable.kind && x.variable.bin === y.variable.bin &&
      x.variable.index === y.variable.index && x.region.family === y.region.family;
  };

  const out: StatsFinding[] = [];
  const reported = new Map<StatsFinding, Candidate>();
  for (const a of significant) {
    const rawP = a.finding.stats.pValue ?? 1;
    const opposites = significant.filter(b => b !== a && sameComparison(a, b) &&
      b.finding.effect.direction !== a.finding.effect.direction && (b.finding.stats.pValue ?? 1) < rawP);
    if (opposites.length) {
      // Each wafer's rest without the stronger opposite regions of that wafer.
      const rest = (w: number, c: RegionCandidate) => {
        const r = ownRest(w, c);
        for (const b of opposites) {
          const o = perWafer.get(w)?.get(b.key);
          if (!o) continue;
          if (o.rate) { r.hits -= o.rate.hits; r.n -= o.rate.n; }
          else { r.n -= o.mean!.n; r.sum -= o.mean!.sum; r.sq -= o.mean!.sq; }
        }
        return r;
      };
      const entries = a.entries.filter(e => rest(e.waferIndex, e.c).n >= options.minimumSampleSize);
      if (!entries.length) continue;
      const retest = combine(entries, rest);
      const multiplier = rawP > 0 ? (a.finding.stats.adjustedPValue ?? rawP) / rawP : 1;
      if (Math.sign(retest.z) !== Math.sign(a.combined.z) ||
          !passesCombinedGate(a.entries[0].c, Math.min(1, zPValue(retest.z) * multiplier), retest, options)) continue;
    }

    const sign = Math.sign(a.combined.z);
    const shown = a.entries.filter(e => Math.sign(e.c.delta) === sign);
    const m = wafers.length;
    const t = a.entries[0].c;
    const adjusted = a.finding.stats.adjustedPValue ?? rawP;
    const statSeverity = t.rate
      ? severityForFinding(adjusted, a.combined.delta, a.combined.size)
      : severityForScore(adjusted, a.combined.size);
    const severity = maxSeverity(statSeverity, shown.length / m >= 0.6 ? 'unusual' : 'info');
    const dieKeysByWafer: Record<number, string[]> = {};
    for (const e of shown) dieKeysByWafer[e.waferIndex] = [...e.c.region.dieKeys];
    const finding: StatsFinding = {
      ...a.finding,
      severity,
      stats: { ...a.finding.stats, sampleSizeLeft: shown.length, sampleSizeRight: m - shown.length },
      summary: `${describeRegional(t, a.combined.delta, a.combined.relativeDelta)} — ${a.finding.effect.direction} on ${shown.length}/${m} wafers, all wafers' data combined`,
      highlight: { kind: 'wafer', waferIndices: shown.map(e => e.waferIndex), dieKeysByWafer } };
    out.push(finding);
    reported.set(finding, a);
  }
  const merged = mergeAdjacentPooled(reported, perWafer, wafers.length, options, ringCount, ownRest);
  out.splice(0, out.length, ...out.filter(f => !merged.replaced.has(f)), ...merged.findings);
  // The wafer analysis's own collapse: the pass bin and the soft bin that are the
  // yield, and hard/soft twins, restate another lot finding exactly.
  collapseRedundantFindings(out as Parameters<typeof collapseRedundantFindings>[0], facts);
  return out;
}

/**
 * Lot findings for runs of adjacent regions that carry the same signal, as the
 * wafer analysis merges them (`mergeAdjacentFindings`): "Sectors E–N", not a row
 * per sector. The runs, their labels and the ring/sector/quadrant adjacency are
 * the wafer merge's own. What differs is the statistic: each wafer's regions add
 * up (counts or sums, the rest being the wafer's total less the run), and those
 * per-wafer unions are combined across the wafers as the single regions are —
 * Stouffer's Z, the same gates, and the Benjamini–Hochberg multiplier of the
 * weakest constituent, so the run is graded no more leniently than its parts. A
 * run that does not pass on its own keeps its separate rows.
 *
 * "N/M wafers" is the wafers where the merged region itself differs, in the
 * finding's direction, at the analysis's significance level.
 */
function mergeAdjacentPooled(
  reported: Map<StatsFinding, { key: string; entries: { waferIndex: number; c: RegionCandidate }[]; combined: Combined }>,
  perWafer: Map<number, Map<string, RegionCandidate>>,
  waferCount: number,
  options: ResolvedOptions,
  ringCount: number,
  ownRest: Parameters<typeof combine>[1],
): { findings: StatsFinding[]; replaced: Set<StatsFinding> } {
  const groups = new Map<string, { finding: StatsFinding; c: RegionCandidate; key: string }[]>();
  for (const [finding, a] of reported) {
    const c = a.entries[0].c;
    if (!MERGEABLE_FAMILIES.has(c.region.family)) continue;
    const id = [c.source, c.variable.kind, c.variable.bin ?? '', c.variable.index ?? '', c.region.family, finding.effect.direction].join('|');
    (groups.get(id) ?? groups.set(id, []).get(id)!).push({ finding, c, key: a.key });
  }

  const findings: StatsFinding[] = [];
  const replaced = new Set<StatsFinding>();
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const family = group[0].c.region.family;
    for (const run of findContiguousRuns(group, family, options.sectorCount, g => g.c.region.key)) {
      if (run.length < 2) continue;
      const merged = mergeRun(run, perWafer, waferCount, options, ringCount, ownRest);
      if (!merged) continue;
      findings.push(merged);
      for (const g of run) replaced.add(g.finding);
    }
  }
  return { findings, replaced };
}

function mergeRun(
  run: { finding: StatsFinding; c: RegionCandidate; key: string }[],
  perWafer: Map<number, Map<string, RegionCandidate>>,
  waferCount: number,
  options: ResolvedOptions,
  ringCount: number,
  ownRest: Parameters<typeof combine>[1],
): StatsFinding | undefined {
  const first = run[0].c;
  const sign = run[0].finding.effect.direction === 'higher' ? 1 : -1;
  const label = mergedRegionLabel(first.region.family, run.map(r => r.c.region.key), ringCount);

  // Each wafer's run as one region: counts or sums added, the rest the wafer's total less the run.
  const unions: { waferIndex: number; c: RegionCandidate; z: number; dieKeys: string[] }[] = [];
  for (const [waferIndex, candidates] of perWafer) {
    const parts = run.map(r => candidates.get(r.key));
    if (parts.some(part => !part)) continue;
    const cs = parts as RegionCandidate[];
    const base = cs[0];
    let union: RegionCandidate;
    let z: number;
    if (base.rate) {
      const hits = cs.reduce((t, c) => t + c.rate!.hits, 0);
      const n = cs.reduce((t, c) => t + c.rate!.n, 0);
      const restHits = base.rate.hits + base.rate.restHits - hits;
      const restN = base.rate.n + base.rate.restN - n;
      if (n < options.minimumSampleSize || restN < options.minimumSampleSize) continue;
      union = { ...base, rate: { hits, n, restHits, restN, passRate: base.rate.passRate } };
      z = twoProportionZ(hits, n, restHits, restN);
    } else {
      const b = base.mean!;
      const n = cs.reduce((t, c) => t + c.mean!.n, 0);
      const sum = cs.reduce((t, c) => t + c.mean!.sum, 0);
      const sq = cs.reduce((t, c) => t + c.mean!.sq, 0);
      const restN = b.n + b.restN - n, restSum = b.sum + b.restSum - sum, restSq = b.sq + b.restSq - sq;
      if (n < options.minimumSampleSize || restN < options.minimumSampleSize) continue;
      const mean: MeanStats = { n, sum, sq, restN, restSum, restSq, shift: b.shift };
      const t = welchOfSums(mean, restN, restSum, restSq);
      const restMean = restSum / restN + b.shift;
      union = { ...base, mean, relativeDelta: restMean !== 0 ? t.delta / Math.abs(restMean) : undefined };
      z = t.z;
    }
    const dieKeys = [...new Set(cs.flatMap(c => [...c.region.dieKeys]))];
    unions.push({ waferIndex, c: union, z, dieKeys });
  }
  if (unions.length < REPEATED_PATTERN_MIN_WAFERS) return undefined;

  const combined = combine(unions, ownRest);
  if (combined.z === 0 || Math.sign(combined.z) !== sign) return undefined;
  const rawP = zPValue(combined.z);
  const multiplier = weakestMultiplier(run.map(r => r.finding));
  const adjusted = Math.min(1, rawP * multiplier);
  if (!passesCombinedGate(first, adjusted, combined, options)) return undefined;

  const shown = unions.filter(u => Math.sign(u.z) === sign && zPValue(u.z) <= options.significanceLevel);
  if (!shown.length) return undefined;
  const statSeverity = first.rate
    ? severityForFinding(adjusted, combined.delta, combined.size)
    : severityForScore(adjusted, combined.size);
  const severity = maxSeverity(statSeverity, shown.length / waferCount >= 0.6 ? 'unusual' : 'info');
  const dieKeysByWafer: Record<number, string[]> = {};
  for (const u of shown) dieKeysByWafer[u.waferIndex] = u.dieKeys;

  const regionIds = run.map(r => r.c.region.key.slice(r.c.region.key.indexOf(':') + 1)).join('-');
  const described = { ...first, comparison: { ...first.comparison, left: label } };
  const template = run[0].finding;
  const direction = template.effect.direction;
  return {
    ...template,
    id: `lot-region:${run[0].key.split('|').slice(0, -1).join('|')}|${first.region.family}:${regionIds}`,
    severity,
    comparison: { ...template.comparison, left: label },
    effect: {
      direction,
      absoluteDelta: combined.delta,
      relativeDelta: combined.relativeDelta,
      effectSize: first.rate ? combined.delta : combined.size },
    stats: { method: 'stouffer-z', pValue: rawP, adjustedPValue: adjusted, sampleSizeLeft: shown.length, sampleSizeRight: waferCount - shown.length },
    summary: `${describeRegional(described, combined.delta, combined.relativeDelta)} — ${direction} on ${shown.length}/${waferCount} wafers, all wafers' data combined`,
    highlight: { kind: 'wafer', waferIndices: shown.map(u => u.waferIndex), dieKeysByWafer },
    relatedIds: run.map(r => r.finding.id) };
}

/**
 * Spatial-pattern labels a lot counts together. The classifier splits edge
 * ring from edge-local, and centre from donut (which it cannot reliably tell
 * apart), by thresholds; one process problem can land either side on different
 * wafers, and counted apart it reads as two weaker patterns.
 */
const PATTERN_FAMILY: Record<string, string> = {
  'Edge-ring': 'edge', 'Edge-local': 'edge',
  'Center cluster': 'centre or donut', 'Donut': 'centre or donut',
};

function buildRepeatedPatternFindings(perWafer: LotStatsSummary['perWafer'], lotPattern: LotPattern | null): StatsFinding[] {
  const buckets = new Map<string, {
    finding: StatsFinding;
    waferIndices: number[];
    severity: StatsSeverity;
    /** Spatial patterns: each wafer's label, and its failing dies to highlight. */
    labels: Map<string, number>;
    dieKeysByWafer: Record<number, string[]>;
    /** Pattern bucket key → wafers on which that wafer's spatial pattern claimed this finding. */
    explainedBy: Map<string, number>;
  }>();
  const keyOf = (finding: StatsFinding) => {
    const family = finding.variable.kind === 'spatialPattern' ? PATTERN_FAMILY[finding.comparison.left] : undefined;
    return family ? `spatialPattern|${family}` : findingPatternKey(finding);
  };

  for (const entry of perWafer) {
    const seen = new Set<string>();
    // This wafer's pattern claims (its `relatedIds`): an edge arc inside an edge
    // ring is part of that ring, and the lot keeps that link — see below.
    const claimedBy = new Map<string, string>();
    for (const p of entry.summary.findings) {
      if (p.variable.kind !== 'spatialPattern') continue;
      for (const id of p.relatedIds ?? []) claimedBy.set(id, keyOf(p));
    }
    // Skip findings that another finding in the SAME wafer already absorbs as an
    // exact restatement (a soft-bin twin over identical dies; the single pass
    // bin against the yield row). `summary.findings` is deliberately the full
    // uncollapsed list, so without this the duplication removed at wafer level
    // reappears here — one lot row per twin, each annotated "seen on N/M wafers",
    // which is where it is most misleading because it looks like corroboration.
    // The absorbing finding still buckets normally and carries the merged label.
    const absorbed = new Set(entry.summary.findings.flatMap(f => f.absorbedIds ?? []));
    for (const finding of entry.summary.findings) {
      if (absorbed.has(finding.id) || isPooledKind(finding)) continue;
      // A wafer that shows the lot's pattern is counted under the lot pattern
      // (`buildLotPatternFinding`), whatever label its own classification gave it.
      if (finding.variable.kind === 'spatialPattern' && lotPattern?.carriers.has(entry.waferIndex)) continue;
      const key = keyOf(finding);
      if (seen.has(key)) continue;
      seen.add(key);

      const bucket = buckets.get(key) ?? {
        finding,
        waferIndices: [],
        severity: finding.severity,
        labels: new Map<string, number>(),
        dieKeysByWafer: {},
        explainedBy: new Map<string, number>(),
      };
      bucket.waferIndices.push(entry.waferIndex);
      const claimer = claimedBy.get(finding.id);
      if (claimer) bucket.explainedBy.set(claimer, (bucket.explainedBy.get(claimer) ?? 0) + 1);
      if (finding.variable.kind === 'spatialPattern') {
        bucket.labels.set(finding.comparison.left, (bucket.labels.get(finding.comparison.left) ?? 0) + 1);
        const keys = (finding.highlight as { dieKeys?: string[] }).dieKeys;
        if (keys) bucket.dieKeysByWafer[entry.waferIndex] = keys;
      }
      bucket.severity = maxSeverity(bucket.severity, finding.severity);
      buckets.set(key, bucket);
    }
  }

  const findings: StatsFinding[] = [];

  for (const [key, bucket] of buckets) {
    if (bucket.waferIndices.length < REPEATED_PATTERN_MIN_WAFERS) continue;
    const coverage = bucket.waferIndices.length / Math.max(1, perWafer.length);
    const severity: StatsSeverity = coverage >= 0.6 || bucket.severity === 'unusual' ? 'unusual' : 'notable';
    const finding = bucket.finding;

    findings.push({
      id: `lot-repeat:${key}`,
      level: 'lot',
      severity,
      variable: { ...finding.variable },
      comparison: { ...finding.comparison },
      effect: {
        direction: finding.effect.direction,
        absoluteDelta: finding.effect.absoluteDelta,
        relativeDelta: finding.effect.relativeDelta,
        effectSize: finding.effect.effectSize,
      },
      stats: {
        method: 'wafer-finding-frequency',
        sampleSizeLeft: bucket.waferIndices.length,
        sampleSizeRight: perWafer.length - bucket.waferIndices.length,
      },
      summary: `${repeatedPatternSubject(finding, bucket.labels)} — seen on ${bucket.waferIndices.length}/${perWafer.length} wafers (${Math.round(coverage * 100)}%)`,
      highlight: {
        kind: 'wafer',
        waferIndices: bucket.waferIndices,
        ...(bucket.labels.size ? { dieKeysByWafer: bucket.dieKeysByWafer } : {}),
      },
    });
  }

  // A repeated finding that its wafer's pattern claimed on EVERY wafer it appears
  // on is part of the lot's repeated pattern: listed under it (`relatedIds`), as
  // at wafer level, not as a separate lot finding. Claimed on only some wafers,
  // it is also a signal of its own, and stays separate.
  const byId = new Map(findings.map(f => [f.id, f]));
  for (const [key, bucket] of buckets) {
    const child = byId.get(`lot-repeat:${key}`);
    if (!child) continue;
    for (const [patternKey, count] of bucket.explainedBy) {
      const parent = byId.get(`lot-repeat:${patternKey}`);
      if (!parent || count !== bucket.waferIndices.length) continue;
      (parent.relatedIds ??= []).push(child.id);
    }
  }

  return findings;
}

/**
 * The lot's pattern as one finding: the classifier's reading of where failures
 * recur across the stacked wafers, on every wafer that shows it. `claimForPattern`
 * then lists under it the lot findings it explains (rings, edge arcs, clusters).
 */
function buildLotPatternFinding(lotPattern: LotPattern, waferCount: number): StatsFinding {
  const { classification, carriers } = lotPattern;
  const label = PATTERN_LABELS[classification.pattern];
  const coverage = carriers.size / Math.max(1, waferCount);
  const dieKeysByWafer: Record<number, string[]> = {};
  for (const [index, keys] of carriers) dieKeysByWafer[index] = keys;
  return {
    id: 'lot-repeat:spatialPattern|lot',
    level: 'lot',
    severity: coverage >= 0.6 || classification.confidence === 'high' ? 'unusual' : 'notable',
    variable: { kind: 'spatialPattern', label },
    comparison: { family: 'spatial-pattern', left: label, right: 'Wafer' },
    effect: { direction: 'different', effectSize: classification.features.globalRdd },
    stats: {
      method: 'wafer-finding-frequency',
      sampleSizeLeft: carriers.size,
      sampleSizeRight: waferCount - carriers.size,
    },
    summary: `Spatial pattern: ${label.toLowerCase()} — seen on ${carriers.size}/${waferCount} wafers (${Math.round(coverage * 100)}%)`,
    highlight: { kind: 'wafer', waferIndices: [...carriers.keys()].sort((a, b) => a - b), dieKeysByWafer },
  };
}

/** The ring numbers a lot ring finding covers, from its label ("Ring 4 (edge)", "Rings 2–3"). */
function lotRingsOf(f: StatsFinding): number[] {
  const m = /^Rings? (\d+)(?:\s*[–-]\s*(\d+))?/.exec(f.comparison.left);
  if (!m) return [];
  const first = +m[1], last = m[2] ? +m[2] : first;
  return Array.from({ length: Math.max(0, last - first + 1) }, (_, i) => first + i);
}

/**
 * A repeated finding's sentence. A spatial pattern names its label (or each
 * label of a family, with its wafer count), never one wafer's confidence and
 * figures — those differ wafer to wafer and would be read as the lot's.
 */
function repeatedPatternSubject(finding: StatsFinding, labels: Map<string, number>): string {
  if (!labels.size) return finding.summary;
  const lower = (l: string) => l.toLowerCase();
  if (labels.size === 1) return `Spatial pattern: ${lower([...labels.keys()][0])}`;
  const family = PATTERN_FAMILY[finding.comparison.left];
  const parts = [...labels].sort((a, b) => b[1] - a[1]).map(([l, n]) => `${lower(l)} on ${n}`);
  return `Spatial pattern: ${family} (${parts.join(', ')})`;
}

function buildYieldOutlierFindings(perWafer: LotStatsSummary['perWafer'], population: WaferPopulation): StatsFinding[] {
  // "Lot median" only when the wafers really are one lot — see population.ts.
  const reference = populationStat(population, 'median');
  const comparable = perWafer
    .map((entry) => ({
      waferIndex: entry.waferIndex,
      yieldPercent: entry.summary.stats.yieldPercent,
    }))
    .filter((entry): entry is { waferIndex: number; yieldPercent: number } => entry.yieldPercent !== null);

  const values = comparable.map((entry) => entry.yieldPercent);
  const result = outlierWafers(values);
  if (!result) return [];
  const center = median(values);

  const findings: StatsFinding[] = [];

  for (const { index, severity, statistic } of result.outliers) {
    const entry = comparable[index];
    const delta = entry.yieldPercent - center;
    // The wafer's own ID, as every surface names it; its position only when it has none, and then said so.
    const name = waferDisplayLabel({ wafer: { metadata: perWafer.find(w => w.waferIndex === entry.waferIndex)?.summary.wafer as WaferMetadata | undefined } }, entry.waferIndex);
    findings.push({
      id: `inter-wafer:yield:${entry.waferIndex}`,
      level: 'inter-wafer',
      severity,
      variable: {
        kind: 'yield',
        label: 'Yield',
      },
      comparison: {
        family: 'wafer',
        left: name,
        right: reference.charAt(0).toUpperCase() + reference.slice(1),
      },
      effect: {
        direction: delta > 0 ? 'higher' : 'lower',
        // A fraction, like every yield finding (`delta` is in percentage points).
        absoluteDelta: delta / 100,
        relativeDelta: center === 0 ? undefined : delta / center,
        effectSize: statistic,
      },
      stats: {
        method: result.method,
        sampleSizeLeft: 1,
        sampleSizeRight: comparable.length - 1,
      },
      summary: `${name} yield is ${Math.abs(delta).toFixed(1)} percentage points ${delta > 0 ? 'higher' : 'lower'} than the ${reference}`,
      highlight: {
        kind: 'wafer',
        waferIndices: [entry.waferIndex],
      },
    });
  }

  return findings;
}

export function analyzeWaferLot(
  items: AnalyzeWaferLotInput,
  options: AnalyzeWaferMapOptions & { perWaferSummaries?: StatsSummary[] } = {},
): LotStatsSummary {
  // Built once here, so the lot figures below and each wafer's own analysis read
  // the same dies without building a raw input twice.
  const results = items.map(normalizeInput);
  const perWafer = results.map((result, waferIndex) => ({
    waferIndex,
    summary: options.perWaferSummaries?.[waferIndex] ?? analyzeWaferMap(result, options),
  }));
  // A summary that has been through a structured clone (a host's worker, say)
  // no longer carries its comparisons; that wafer is analysed again for them.
  const comparisons = perWafer.map(({ waferIndex, summary }) =>
    candidatesOf(summary) ?? candidatesOf(analyzeWaferMap(results[waferIndex], options))!);
  const waferCandidates = comparisons.map((w, waferIndex) =>
    ({ waferIndex, byKey: new Map(w.candidates.map(c => [c.key, c])) }));
  const resolved = resolveOptions(options).resolved;
  // The lot's ring figures use the first wafer's ring count, which each wafer carries from its build (wafers with different
  // ring counts are named by `ring-count-mixed`). There is no default to fall back on; an empty lot has no ring figures.
  const ringCount = results.length > 0 ? requireRingCount(results[0], 'analyzeWaferLot') : undefined;
  // From this many wafers showing it, a recurring area is a lot pattern; fewer and
  // the wafers keep their own classifications (the per-wafer counting below).
  const stacked = findLotPattern(results, resolved);
  const lotPattern = stacked && stacked.carriers.size >= REPEATED_PATTERN_MIN_WAFERS ? stacked : null;
  const findings = [
    ...(ringCount === undefined ? [] : buildPooledRegionFindings(waferCandidates, resolved, lotRedundancyFacts(comparisons, resolved.sectorCount), ringCount)),
    ...buildRepeatedPatternFindings(perWafer, lotPattern),
    ...buildYieldOutlierFindings(perWafer, describeWaferPopulation(perWafer.map(w => w.summary.wafer))),
    ...buildDriftFindings(perWafer, resolved.significanceLevel),
  ];
  if (lotPattern && ringCount !== undefined) {
    const pattern = buildLotPatternFinding(lotPattern, perWafer.length);
    pattern.relatedIds = claimForPattern([lotPattern.classification.pattern], pattern.severity, findings,
      lotRingsOf, ringCount);
    if (!pattern.relatedIds.length) delete pattern.relatedIds;
    findings.push(pattern);
  }
  findings.sort((left, right) => {
    const leftRank = left.severity === 'unusual' ? 2 : left.severity === 'notable' ? 1 : 0;
    const rightRank = right.severity === 'unusual' ? 2 : right.severity === 'notable' ? 1 : 0;
    if (leftRank !== rightRank) return rightRank - leftRank;
    return left.summary.localeCompare(right.summary, 'en');
  });

  // Lot-level identity: only keys every wafer that has identity data agrees on —
  // excluding wafer-specific keys so only lot/product/date etc. remain. A key
  // where wafers disagree (e.g. items pooled from more than one lot/program) is
  // omitted rather than silently taking the first wafer's value, and reported in
  // mixedIdentityFields so a caller can detect and warn/split instead of a report
  // silently mislabelling a pooled batch as a single lot.
  const identityWafers = perWafer.map(w => w.summary.wafer).filter((w): w is NonNullable<typeof w> => !!w);
  const lotIdentity: Record<string, unknown> = {};
  const mixedIdentityFields: string[] = [];
  if (identityWafers.length > 0) {
    const keys = new Set<string>();
    for (const w of identityWafers) for (const k of Object.keys(w)) keys.add(k);
    keys.delete('wafer');
    keys.delete('waferId');
    for (const key of keys) {
      const values = identityWafers.filter(w => key in w).map(w => w[key]);
      const allAgree = values.every(v => v === values[0]);
      if (allAgree) {
        lotIdentity[key] = values[0];
      } else {
        mixedIdentityFields.push(key);
      }
    }
  }

  const lotYieldSeries = perWafer.map(({ waferIndex, summary }) => ({
    waferIndex,
    yieldPercent: summary.stats.yieldPercent,
  }));

  const perWaferTestStatsRaw = perWafer
    .map(({ waferIndex, summary }) =>
      summary.stats.perTestStats?.length
        ? { waferIndex, tests: summary.stats.perTestStats }
        : null
    )
    .filter((e): e is NonNullable<typeof e> => e !== null);

  return {
    level: 'lot',
    hasNotableFindings: findings.some((finding) => finding.severity !== 'info')
      || perWafer.some((entry) => entry.summary.hasNotableFindings),
    findings,
    lot: Object.keys(lotIdentity).length > 0 ? lotIdentity : undefined,
    ...(mixedIdentityFields.length > 0 ? { mixedIdentityFields } : {}),
    stats: { waferCount: items.length, ...lotFigures(results, perWafer.map(w => w.summary)) },
    lotYieldSeries,
    perWafer,
    ...(perWaferTestStatsRaw.length > 0 ? { perWaferTestStats: perWaferTestStatsRaw } : {}),
  };
}

/**
 * Lot-level capability, pass rates and region yield, all pooled from the wafer
 * summaries without revisiting a die: pass rates and region yield sum counts,
 * and capability sums each wafer's moments, from which the pooled within-wafer
 * and overall standard deviations follow exactly.
 */
function lotFigures(results: WaferMapResult[], summaries: StatsSummary[]): Partial<LotStatsSummary['stats']> {
  const out: Partial<LotStatsSummary['stats']> = { ...poolPassRates(summaries) };
  const capability = poolCapability(summaries, mergeTestDefs(results).defs);
  if (capability) out.capability = capability;
  const regionYield = poolRegionYield(summaries, results.map(r => r.ringCount));
  if (regionYield) out.regionYield = regionYield;
  return out;
}
