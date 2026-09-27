import {
  analyzeWaferMap, candidatesOf, describeRegional, resolveOptions, adjustPValues,
  twoProportionZ, zPValue, welchOfSums, rateRelativeEffect, passesRateGate,
  severityForFinding, severityForScore, collapseRedundantFindings,
  type RegionCandidate, type ResolvedOptions, type RedundancyFacts, type WaferComparisons,
} from './analyzeWaferMap.js';
import { normalizeInput } from './normalizeInput.js';
import { poolCapability, poolRegionYield, poolPassRates } from './summaryFigures.js';
import { mergeTestDefs } from './mergeTestDefs.js';
import { findingPatternKey } from './filterFindings.js';
import type { WaferMapResult } from '../renderer/buildWaferMap.js';
import { median } from '../core/utils.js';
import { describeWaferPopulation, populationStat, type WaferPopulation } from './population.js';
import type {
  AnalyzeWaferLotInput,
  AnalyzeWaferMapOptions,
  LotStatsSummary,
  StatsFinding,
  StatsSeverity,
  StatsSummary,
} from './types.js';

const OUTLIER_THRESHOLD = 1.3;
const REPEATED_PATTERN_MIN_WAFERS = 2;

function maxSeverity(left: StatsSeverity, right: StatsSeverity): StatsSeverity {
  const rank: Record<StatsSeverity, number> = { info: 0, notable: 1, unusual: 2 };
  return rank[left] >= rank[right] ? left : right;
}


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
function lotRedundancyFacts(wafers: WaferComparisons[]): RedundancyFacts {
  const facts = wafers.map(w => w.facts);
  if (!facts.length || facts.some(f => !f)) return { coincident: new Set(), yieldSoftBin: undefined, passBins: [] };
  const [first, ...rest] = facts as RedundancyFacts[];
  const samePass = rest.every(f => f.passBins.length === first.passBins.length && f.passBins.every(b => first.passBins.includes(b)));
  return {
    coincident: new Set([...first.coincident].filter(pair => rest.every(f => f.coincident.has(pair)))),
    yieldSoftBin: rest.every(f => f.yieldSoftBin === first.yieldSoftBin) ? first.yieldSoftBin : undefined,
    passBins: samePass ? first.passBins : [],
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
function buildPooledRegionFindings(wafers: WaferCandidates[], options: ResolvedOptions, facts: RedundancyFacts): StatsFinding[] {
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
    out.push({
      ...a.finding,
      severity,
      stats: { ...a.finding.stats, sampleSizeLeft: shown.length, sampleSizeRight: m - shown.length },
      summary: `${describeRegional(t, a.combined.delta, a.combined.relativeDelta)} — ${a.finding.effect.direction} on ${shown.length}/${m} wafers, all wafers' data combined`,
      highlight: { kind: 'wafer', waferIndices: shown.map(e => e.waferIndex), dieKeysByWafer } });
  }
  // The wafer analysis's own collapse: the pass bin and the soft bin that are the
  // yield, and hard/soft twins, restate another lot finding exactly.
  collapseRedundantFindings(out as Parameters<typeof collapseRedundantFindings>[0], facts);
  return out;
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

function buildRepeatedPatternFindings(perWafer: LotStatsSummary['perWafer']): StatsFinding[] {
  const buckets = new Map<string, {
    finding: StatsFinding;
    waferIndices: number[];
    severity: StatsSeverity;
    /** Spatial patterns: each wafer's label, and its failing dies to highlight. */
    labels: Map<string, number>;
    dieKeysByWafer: Record<number, string[]>;
  }>();

  for (const entry of perWafer) {
    const seen = new Set<string>();
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
      const family = finding.variable.kind === 'spatialPattern' ? PATTERN_FAMILY[finding.comparison.left] : undefined;
      const key = family ? `spatialPattern|${family}` : findingPatternKey(finding);
      if (seen.has(key)) continue;
      seen.add(key);

      const bucket = buckets.get(key) ?? {
        finding,
        waferIndices: [],
        severity: finding.severity,
        labels: new Map<string, number>(),
        dieKeysByWafer: {},
      };
      bucket.waferIndices.push(entry.waferIndex);
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

  return findings;
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

  if (comparable.length < 3) return [];

  const values = comparable.map((entry) => entry.yieldPercent);
  const center = median(values);
  const mad = median(values.map((value) => Math.abs(value - center)));
  if (!Number.isFinite(mad) || mad === 0) return [];

  const findings: StatsFinding[] = [];

  for (const entry of comparable) {
    const zScore = 0.6745 * (entry.yieldPercent - center) / mad;
    if (Math.abs(zScore) < OUTLIER_THRESHOLD) continue;
    const delta = entry.yieldPercent - center;
    findings.push({
      id: `inter-wafer:yield:${entry.waferIndex}`,
      level: 'inter-wafer',
      severity: Math.abs(zScore) >= 2 ? 'unusual' : 'notable',
      variable: {
        kind: 'yield',
        label: 'Yield',
      },
      comparison: {
        family: 'wafer',
        left: `Wafer ${entry.waferIndex + 1}`,
        right: reference.charAt(0).toUpperCase() + reference.slice(1),
      },
      effect: {
        direction: delta > 0 ? 'higher' : 'lower',
        absoluteDelta: delta,
        relativeDelta: center === 0 ? undefined : delta / center,
        effectSize: zScore,
      },
      stats: {
        method: 'mad-z-score',
        sampleSizeLeft: 1,
        sampleSizeRight: comparable.length - 1,
      },
      summary: `Wafer ${entry.waferIndex + 1} yield is ${Math.abs(delta).toFixed(1)} percentage points ${delta > 0 ? 'higher' : 'lower'} than the ${reference}`,
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
  const findings = [
    ...buildPooledRegionFindings(waferCandidates, resolveOptions(options).resolved, lotRedundancyFacts(comparisons)),
    ...buildRepeatedPatternFindings(perWafer),
    ...buildYieldOutlierFindings(perWafer, describeWaferPopulation(perWafer.map(w => w.summary.wafer))),
  ].sort((left, right) => {
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
