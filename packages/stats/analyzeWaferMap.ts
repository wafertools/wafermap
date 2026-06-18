import type { Die } from '../core/dies.js';
import { buildWaferMap, type WaferMapResult } from '../renderer/buildWaferMap.js';
import type { BinDef, TestDef } from '../renderer/buildWaferMap.js';
import type {
  AnalyzeWaferMapInput,
  AnalyzeWaferMapOptions,
  StatsFinding,
  StatsSeverity,
  StatsSummary,
  StatsComparisonFamily,
  HighlightTarget,
} from './types.js';
import {
  buildQuadrantRegions, buildReticlePositionRegions, buildRingRegions, buildSectorRegions, buildTestSiteRegions,
  sectorCompassNames, areQuadrantsAdjacent, parseRegionKey,
  type StatsRegion,
} from './regions.js';
import { buildClusterFindings } from './clusterDetection.js';
import { classifyPattern } from './patternClassification.js';

interface EligibleDie extends Die {
  hbin?: number;
}

interface RawFinding extends StatsFinding {
  comparison: StatsFinding['comparison'];
  stats: StatsFinding['stats'];
  effect: StatsFinding['effect'];
}

type ResolvedOptions = Required<Omit<AnalyzeWaferMapOptions, 'testNumbers' | 'enableTestSiteAnalysis'>> & {
  testNumbers?: number[];
  enableTestSiteAnalysis?: boolean;
  // Internal — not exposed in AnalyzeWaferMapOptions.
  minimumSampleSize: number;
  minimumClusterSize: number;
};

const DEFAULT_OPTIONS: ResolvedOptions = {
  ringCount: 4,
  passBins: [1],
  significanceLevel: 0.05,
  minimumEffectSize: 0.20,
  minimumRelativeEffect: 1.0,
  minimumSampleSize: 5,        // internal, not in public AnalyzeWaferMapOptions
  includePartial: false,
  includeEdgeExcluded: false,
  enableYieldAnalysis: true,
  enableHardBinAnalysis: true,
  enableSoftBinAnalysis: true,
  enableTestValueAnalysis: true,
  enableReticlePositionAnalysis: true,
  enableClusterAnalysis: true,
  enableAngularAnalysis: true,
  sectorCount: 8,
  enablePatternClassification: true,
  minimumClusterSize: 5,     // overwritten by adaptOptions()
};

/**
 * Compute adaptive overrides for thresholds that scale with wafer geometry.
 * Called once per analyzeWaferMap invocation after eligible dies are known.
 *
 * Only minimumClusterSize is adapted here — other region analysis thresholds
 * (minimumSampleSize, significanceLevel) must not be adapted because changing
 * the number of tests fed into Bonferroni correction alters the correction itself,
 * producing unpredictable FP rate changes.
 */
function adaptOptions(base: ResolvedOptions, dieCount: number): ResolvedOptions {
  const adapted = { ...base };
  // minimumClusterSize: ~0.3% of wafer die count, floored at 3.
  // A 5-die cluster is meaningful on a small wafer but noise on a 2500-die wafer.
  // Safe to adapt because cluster findings go through a separate code path
  // and do not affect the regional analysis Bonferroni denominator.
  adapted.minimumClusterSize = Math.max(5, Math.round(dieCount * 0.003));
  return adapted;
}

function normalizeInput(input: AnalyzeWaferMapInput): WaferMapResult {
  return 'wafer' in input && 'dies' in input && 'view' in input ? input : buildWaferMap(input);
}

function isEligibleDie(die: Die, options: ResolvedOptions): die is EligibleDie {
  if (!options.includePartial && die.partial) return false;
  if (!options.includeEdgeExcluded && die.edgeExcluded) return false;
  return (
    die.hbin !== undefined ||
    die.sbin !== undefined ||
    (die.testValues !== undefined && Object.keys(die.testValues).length > 0)
  );
}

function makeClusterFailurePredicate(
  isLotStack: boolean,
  hasBinData: boolean,
  testDefs: TestDef[] | undefined,
): ((die: Die) => boolean) | undefined {
  if (!isLotStack || hasBinData) return undefined;
  const limited = (testDefs ?? []).filter(
    td => td.limitLow !== undefined || td.limitHigh !== undefined,
  );
  if (limited.length === 0) return undefined;
  return (die: Die): boolean => {
    for (const td of limited) {
      const tn = td.testNumber ?? td.index;
      if (tn === undefined) continue;
      const v = die.testValues?.[tn];
      if (v === undefined) continue;
      if (td.limitLow  !== undefined && v < td.limitLow)  return true;
      if (td.limitHigh !== undefined && v > td.limitHigh) return true;
    }
    return false;
  };
}

function collectStats(dies: Die[], analyzedDies: number, yieldPercent: number | null): StatsSummary['stats'] {
  const testSet = new Set<number>();
  const hardBinSet = new Set<number>();
  const softBinSet = new Set<number>();

  for (const die of dies) {
    if (die.testValues) {
      for (const k of Object.keys(die.testValues)) testSet.add(Number(k));
    } else {
      die.values?.forEach((value, index) => {
        if (value !== undefined) testSet.add(index);
      });
    }
    if (die.hbin !== undefined) hardBinSet.add(die.hbin);
    if (die.sbin !== undefined) softBinSet.add(die.sbin);
  }

  return {
    totalDies: dies.length,
    analyzedDies,
    excludedDies: dies.length - analyzedDies,
    yieldPercent,
    testsConsidered: [...testSet].sort((left, right) => left - right),
    hardBinsConsidered: [...hardBinSet].sort((left, right) => left - right),
    softBinsConsidered: [...softBinSet].sort((left, right) => left - right),
  };
}

function computeTestSpecYield(
  dies: Die[],
  testDefs: TestDef[] | undefined,
): StatsSummary['stats']['testSpecYield'] {
  if (!testDefs?.length) return undefined;
  const limited = testDefs.filter(td => td.limitLow !== undefined || td.limitHigh !== undefined);
  if (!limited.length) return undefined;

  const result: NonNullable<StatsSummary['stats']['testSpecYield']> = [];
  for (const td of limited) {
    const tn = td.testNumber ?? td.index;
    if (tn === undefined) continue;
    let passDies = 0, failLowDies = 0, failHighDies = 0, totalDies = 0;
    for (const die of dies) {
      if (die.partial || die.edgeExcluded) continue;
      const v = die.testValues?.[tn] ?? die.values?.[tn];
      if (v === undefined) continue;
      totalDies++;
      if (td.limitLow !== undefined && v < td.limitLow) {
        failLowDies++;
      } else if (td.limitHigh !== undefined && v > td.limitHigh) {
        failHighDies++;
      } else {
        passDies++;
      }
    }
    result.push({
      testNumber:   tn,
      label:        td.name,
      passDies,
      failLowDies,
      failHighDies,
      totalDies,
      yieldPercent: totalDies > 0 ? (passDies / totalDies) * 100 : null,
    });
  }
  return result.length ? result : undefined;
}

function quantile(sorted: number[], p: number): number {
  const pos = p * (sorted.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.min(lo + 1, sorted.length - 1);
  return sorted[lo] + (pos - lo) * (sorted[hi] - sorted[lo]);
}

function computePerTestStats(
  dies: Die[],
  testNumbers: number[],
  testDefs: TestDef[] | undefined,
  minimumSampleSize: number,
): StatsSummary['stats']['perTestStats'] {
  const result: NonNullable<StatsSummary['stats']['perTestStats']> = [];
  for (const tn of testNumbers) {
    const values: number[] = [];
    for (const die of dies) {
      if (die.partial || die.edgeExcluded) continue;
      const v = die.testValues?.[tn] ?? die.values?.[tn];
      if (v !== undefined) values.push(v);
    }
    if (values.length < minimumSampleSize) continue;
    const avg = mean(values);
    const stddev = Math.sqrt(sampleVariance(values, avg));
    const sorted = values.slice().sort((a, b) => a - b);
    const label = testDefs?.find(td => (td.testNumber ?? td.index) === tn)?.name ?? String(tn);
    result.push({
      testNumber: tn,
      label,
      count:  values.length,
      min:    sorted[0],
      max:    sorted[sorted.length - 1],
      mean:   avg,
      stddev,
      median: quantile(sorted, 0.5),
      q1:     quantile(sorted, 0.25),
      q3:     quantile(sorted, 0.75),
    });
  }
  return result.length ? result : undefined;
}

function errorFunction(value: number): number {
  const sign = value < 0 ? -1 : 1;
  const x = Math.abs(value);
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;
  const t = 1 / (1 + p * x);
  const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
  return sign * y;
}

function normalCdf(value: number): number {
  return 0.5 * (1 + errorFunction(value / Math.sqrt(2)));
}

function twoProportionPValue(
  leftPass: number,
  leftTotal: number,
  rightPass: number,
  rightTotal: number,
): number {
  const pooled = (leftPass + rightPass) / (leftTotal + rightTotal);
  const variance = pooled * (1 - pooled) * ((1 / leftTotal) + (1 / rightTotal));
  if (!Number.isFinite(variance) || variance <= 0) return 1;
  const z = ((leftPass / leftTotal) - (rightPass / rightTotal)) / Math.sqrt(variance);
  return Math.max(0, Math.min(1, 2 * (1 - normalCdf(Math.abs(z)))));
}

function adjustPValues(findings: RawFinding[]): RawFinding[] {
  const families = new Map<string, RawFinding[]>();
  for (const finding of findings) {
    const key = `${finding.variable.kind}:${finding.comparison.family}`;
    const entries = families.get(key) ?? [];
    entries.push(finding);
    families.set(key, entries);
  }

  for (const entries of families.values()) {
    const sorted = [...entries]
      .filter((entry) => entry.stats.pValue !== undefined)
      .sort((left, right) => (left.stats.pValue ?? 1) - (right.stats.pValue ?? 1));
    const total = sorted.length;
    let runningMin = 1;

    for (let index = total - 1; index >= 0; index--) {
      const entry = sorted[index];
      const raw = entry.stats.pValue ?? 1;
      const adjusted = Math.min(1, Math.min(runningMin, (raw * total) / (index + 1)));
      entry.stats.adjustedPValue = adjusted;
      runningMin = adjusted;
    }
  }

  return findings;
}

function severityForFinding(pValue: number, delta: number, relativeDelta?: number): StatsSeverity {
  const absDelta = Math.abs(delta);
  const absRel = relativeDelta !== undefined ? Math.abs(relativeDelta) : 0;
  if (pValue <= 0.01 && (absDelta >= 0.30 || absRel >= 2.5)) return 'unusual';
  if (pValue <= 0.05 && (absDelta >= 0.20 || absRel >= 1.5)) return 'notable';
  return 'info';
}

function severityForScore(pValue: number, score: number): StatsSeverity {
  if (pValue <= 0.01 && Math.abs(score) >= 0.5) return 'unusual';
  if (pValue <= 0.05 && Math.abs(score) >= 0.15) return 'notable';
  return 'info';
}

type RegionFamily = 'ring' | 'quadrant' | 'reticle-position' | 'test-site' | 'sector';

function comparisonTarget(family: RegionFamily): string {
  if (family === 'reticle-position') return 'other reticle positions';
  if (family === 'test-site') return 'other test sites';
  return 'the rest of the map';
}

function comparisonRight(family: RegionFamily): string {
  if (family === 'reticle-position') return 'Other reticle positions';
  if (family === 'test-site') return 'Other test sites';
  return 'Rest of map';
}

function summarizeYieldFinding(label: string, delta: number, family: RegionFamily): string {
  const pp = (Math.abs(delta) * 100).toFixed(1);
  return `${label} yield is ${pp} percentage points ${delta > 0 ? 'higher' : 'lower'} than ${comparisonTarget(family)}`;
}

function summarizeRegionLabel(label: string, family: RegionFamily): string {
  // Single-quadrant labels are a bare compass ("NE") and read better with the
  // family word prepended ("quadrant NE"). Merged labels already self-describe
  // ("Quadrants NW, SW & SE"), so leave them untouched.
  if (family === 'quadrant' && !label.startsWith('Quadrant')) return `quadrant ${label}`;
  return label;
}

function summarizeBinFinding(
  label: string,
  binLabel: string,
  delta: number,
  family: RegionFamily,
): string {
  const familyLabel = summarizeRegionLabel(label, family);
  const pp = (Math.abs(delta) * 100).toFixed(1);
  return `${familyLabel} has ${binLabel} occurrence ${pp} percentage points ${delta > 0 ? 'higher' : 'lower'} than ${comparisonTarget(family)}`;
}

function summarizeTestFinding(
  label: string,
  testLabel: string,
  delta: number,
  relativeDelta: number | undefined,
  family: RegionFamily,
  unit?: string,
): string {
  const familyLabel = summarizeRegionLabel(label, family);
  const target = comparisonTarget(family);
  const dir = delta > 0 ? 'higher' : 'lower';
  if (relativeDelta !== undefined && Number.isFinite(relativeDelta)) {
    const pct = (Math.abs(relativeDelta) * 100).toFixed(1);
    return `${familyLabel} mean ${testLabel} is ${pct}% ${dir} than ${target}`;
  }
  const unitSuffix = unit ? ` ${unit}` : '';
  return `${familyLabel} mean ${testLabel} is ${Math.abs(delta).toPrecision(3)}${unitSuffix} ${dir} than ${target}`;
}

function labelForBin(bin: number, defs: BinDef[] | undefined, prefix: 'HBin' | 'SBin'): string {
  const def = defs?.find((entry) => entry.bin === bin);
  return def?.name ? `${prefix} ${bin} (${def.name})` : `${prefix} ${bin}`;
}

function labelForTest(testNumber: number, defs: TestDef[] | undefined): { label: string; unit?: string } {
  // Match by testNumber first, then fall back to index for the deprecated path.
  const def = defs?.find((entry) => (entry.testNumber ?? entry.index) === testNumber);
  return { label: def?.name ?? `Test ${testNumber}`, unit: def?.unit };
}

function buildYieldFindings(
  eligibleDies: EligibleDie[],
  regionFamily: StatsRegion[],
  passBins: number[],
  options: ResolvedOptions,
): RawFinding[] {
  const passSet = new Set(passBins);
  const dieMap = new Map(eligibleDies.map((die) => [`${die.x},${die.y}`, die]));
  // Pre-build per-region die arrays once so "right" is all-regions minus left bucket.
  // Pre-build per-region die arrays once; right = all other buckets (regions are non-overlapping).
  const buckets = new Map<string, EligibleDie[]>();
  for (const region of regionFamily) {
    const bucket: EligibleDie[] = [];
    for (const key of region.dieKeys) {
      const d = dieMap.get(key);
      if (d) bucket.push(d);
    }
    buckets.set(region.key, bucket);
  }

  // Pre-count pass dies per bucket.
  const passCounts = new Map<string, number>();
  const bucketSizes = new Map<string, number>();
  for (const [regionKey, bucket] of buckets) {
    let passes = 0;
    for (const d of bucket) {
      if (d.hbin !== undefined && passSet.has(d.hbin)) passes++;
    }
    passCounts.set(regionKey, passes);
    bucketSizes.set(regionKey, bucket.length);
  }

  const findings: RawFinding[] = [];

  for (const region of regionFamily) {
    const leftSize = bucketSizes.get(region.key) ?? 0;
    const leftPass = passCounts.get(region.key) ?? 0;
    let rightSize = 0;
    let rightPass = 0;
    for (const [key, size] of bucketSizes) {
      if (key === region.key) continue;
      rightSize += size;
      rightPass += passCounts.get(key) ?? 0;
    }

    if (leftSize < options.minimumSampleSize || rightSize < options.minimumSampleSize) continue;

    const leftRate = leftPass / leftSize;
    const rightRate = rightPass / rightSize;
    const delta = leftRate - rightRate;
    const pValue = twoProportionPValue(leftPass, leftSize, rightPass, rightSize);

    findings.push({
      id: `yield:${region.key}`,
      level: 'wafer',
      severity: 'info',
      variable: {
        kind: 'yield',
        label: 'Yield',
      },
      comparison: {
        family: region.family,
        left: region.label,
        right: comparisonRight(region.family),
      },
      effect: {
        direction: delta === 0 ? 'different' : delta > 0 ? 'higher' : 'lower',
        absoluteDelta: delta,
        relativeDelta: rightRate === 0 ? undefined : delta / rightRate,
        effectSize: delta,
      },
      stats: {
        method: 'two-proportion-z',
        pValue,
        sampleSizeLeft: leftSize,
        sampleSizeRight: rightSize,
      },
      summary: summarizeYieldFinding(region.label, delta, region.family),
      highlight: {
        kind: 'region',
        regionFamily: region.family,
        regionKeys: [region.key],
        dieKeys: [...region.dieKeys],
      },
    });
  }

  adjustPValues(findings);

  return findings
    .filter((finding) => {
      const adjusted = finding.stats.adjustedPValue ?? finding.stats.pValue ?? 1;
      const delta = Math.abs(finding.effect.absoluteDelta ?? 0);
      const relDelta = Math.abs(finding.effect.relativeDelta ?? 0);
      return adjusted <= options.significanceLevel &&
        (delta >= options.minimumEffectSize || relDelta >= options.minimumRelativeEffect);
    })
    .map((finding) => ({
      ...finding,
      severity: severityForFinding(
        finding.stats.adjustedPValue ?? finding.stats.pValue ?? 1,
        finding.effect.absoluteDelta ?? 0,
        finding.effect.relativeDelta,
      ),
    }));
}

function buildBinFindings(
  eligibleDies: EligibleDie[],
  regionFamily: StatsRegion[],
  binSpace: 'hard' | 'soft',
  defs: BinDef[] | undefined,
  variableKind: 'hardBin' | 'softBin',
  options: ResolvedOptions,
): RawFinding[] {
  const getBin = (d: EligibleDie) => binSpace === 'soft' ? d.sbin : d.hbin;
  const dieMap = new Map(eligibleDies.map((die) => [`${die.x},${die.y}`, die]));
  const bins = [...new Set(
    eligibleDies
      .map(getBin)
      .filter((bin): bin is number => bin !== undefined),
  )].sort((left, right) => left - right);
  const buckets = new Map<string, EligibleDie[]>();
  for (const region of regionFamily) {
    const bucket: EligibleDie[] = [];
    for (const key of region.dieKeys) {
      const d = dieMap.get(key);
      if (d) bucket.push(d);
    }
    buckets.set(region.key, bucket);
  }
  // Pre-count bin occurrences per bucket to avoid O(N_bucket × bins) filter per region.
  const binCounts = new Map<string, Map<number, number>>();
  const bucketSizes = new Map<string, number>();
  for (const [regionKey, bucket] of buckets) {
    const counts = new Map<number, number>();
    for (const d of bucket) {
      const b = getBin(d);
      if (b !== undefined) counts.set(b, (counts.get(b) ?? 0) + 1);
    }
    binCounts.set(regionKey, counts);
    bucketSizes.set(regionKey, bucket.length);
  }

  const findings: RawFinding[] = [];
  const prefix = variableKind === 'hardBin' ? 'HBin' : 'SBin';

  for (const region of regionFamily) {
    const leftSize = bucketSizes.get(region.key) ?? 0;
    const leftCounts = binCounts.get(region.key)!;
    let rightSize = 0;
    const rightCounts = new Map<number, number>();
    for (const [key, counts] of binCounts) {
      if (key === region.key) continue;
      rightSize += bucketSizes.get(key) ?? 0;
      for (const [b, c] of counts) rightCounts.set(b, (rightCounts.get(b) ?? 0) + c);
    }

    if (leftSize < options.minimumSampleSize || rightSize < options.minimumSampleSize) continue;

    for (const bin of bins) {
      const leftHits = leftCounts.get(bin) ?? 0;
      const rightHits = rightCounts.get(bin) ?? 0;
      const leftRate = leftHits / leftSize;
      const rightRate = rightHits / rightSize;
      const delta = leftRate - rightRate;
      const pValue = twoProportionPValue(leftHits, leftSize, rightHits, rightSize);
      const binLabel = labelForBin(bin, defs, prefix);

      findings.push({
        id: `${variableKind}:${bin}:${region.key}`,
        level: 'wafer',
        severity: 'info',
        variable: {
          kind: variableKind,
          bin,
          label: binLabel,
        },
        comparison: {
          family: region.family,
          left: region.label,
          right: comparisonRight(region.family),
        },
        effect: {
          direction: delta === 0 ? 'different' : delta > 0 ? 'higher' : 'lower',
          absoluteDelta: delta,
          relativeDelta: rightRate === 0 ? undefined : delta / rightRate,
          effectSize: delta,
        },
        stats: {
          method: 'two-proportion-z',
          pValue,
          sampleSizeLeft: leftSize,
          sampleSizeRight: rightSize,
        },
        summary: summarizeBinFinding(region.label, binLabel, delta, region.family),
        highlight: {
          kind: 'bin',
          bin,
          regionKeys: [region.key],
          dieKeys: [...region.dieKeys],
        },
      });
    }
  }

  adjustPValues(findings);

  return findings
    .filter((finding) => {
      const adjusted = finding.stats.adjustedPValue ?? finding.stats.pValue ?? 1;
      const delta = Math.abs(finding.effect.absoluteDelta ?? 0);
      const relDelta = Math.abs(finding.effect.relativeDelta ?? 0);
      return adjusted <= options.significanceLevel &&
        (delta >= options.minimumEffectSize || relDelta >= options.minimumRelativeEffect);
    })
    .map((finding) => ({
      ...finding,
      severity: severityForFinding(
        finding.stats.adjustedPValue ?? finding.stats.pValue ?? 1,
        finding.effect.absoluteDelta ?? 0,
        finding.effect.relativeDelta,
      ),
    }));
}

function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function sampleVariance(values: number[], avg: number): number {
  if (values.length < 2) return 0;
  return values.reduce((sum, value) => sum + (value - avg) ** 2, 0) / (values.length - 1);
}

function welchPValue(leftValues: number[], rightValues: number[]): { pValue: number; effectSize: number; delta: number } {
  const leftMean = mean(leftValues);
  const rightMean = mean(rightValues);
  const leftVar = sampleVariance(leftValues, leftMean);
  const rightVar = sampleVariance(rightValues, rightMean);
  const standardError = Math.sqrt((leftVar / leftValues.length) + (rightVar / rightValues.length));
  const delta = leftMean - rightMean;

  if (!Number.isFinite(standardError) || standardError === 0) {
    return { pValue: delta === 0 ? 1 : 0, effectSize: delta === 0 ? 0 : Math.sign(delta) * Infinity, delta };
  }

  const z = delta / standardError;
  const pooledSd = Math.sqrt(Math.max(0, ((leftVar + rightVar) / 2)));
  const effectSize = pooledSd === 0 ? delta : delta / pooledSd;
  return {
    pValue: Math.max(0, Math.min(1, 2 * (1 - normalCdf(Math.abs(z))))),
    effectSize,
    delta,
  };
}

const TEST_COUNT_WARN_THRESHOLD = 250;

function buildTestValueFindings(
  dies: Die[],
  regionFamily: StatsRegion[],
  defs: TestDef[] | undefined,
  options: ResolvedOptions,
): { findings: RawFinding[]; warning?: string; activeTestNumbers?: number[] } {
  const dieMap = new Map(dies.map((die) => [`${die.x},${die.y}`, die]));

  // If the caller specifies exact test numbers, use them directly — skip the
  // expensive scan of all die testValues keys, which is O(N × tests).
  let activeTestNumbers: number[];
  if (options.testNumbers) {
    activeTestNumbers = options.testNumbers.slice().sort((a, b) => a - b);
  } else {
    // No filter provided: discover test numbers present in the data.
    // Stop early once we exceed the cap — no need to scan all dies.
    const testNumberSet = new Set<number>();
    let cappedCount = 0;
    outer: for (const die of dies) {
      const keys = die.testValues
        ? Object.keys(die.testValues)
        : (die.values ?? []).map((v, i) => v !== undefined ? String(i) : null).filter(Boolean) as string[];
      for (const k of keys) {
        const n = Number(k);
        if (!testNumberSet.has(n)) {
          testNumberSet.add(n);
          if (testNumberSet.size > TEST_COUNT_WARN_THRESHOLD) {
            cappedCount = testNumberSet.size;
            break outer;
          }
        }
      }
    }

    if (cappedCount > TEST_COUNT_WARN_THRESHOLD) {
      const warning =
        `[wafermap] analyzeWaferMap: more than ${TEST_COUNT_WARN_THRESHOLD} tests found in die data. ` +
        `Pass testNumbers: [...] in options to enable test value analysis for specific tests. ` +
        `Auto-cap threshold is ${TEST_COUNT_WARN_THRESHOLD}.`;
      console.warn(warning);
      return { findings: [], warning };
    }
    activeTestNumbers = [...testNumberSet].sort((a, b) => a - b);
  }

  const buckets = new Map<string, Die[]>();
  for (const region of regionFamily) {
    const bucket: Die[] = [];
    for (const key of region.dieKeys) {
      const d = dieMap.get(key);
      if (d) bucket.push(d);
    }
    buckets.set(region.key, bucket);
  }

  const findings: RawFinding[] = [];

  for (const region of regionFamily) {
    const leftDies = buckets.get(region.key)!;
    const rightDies: Die[] = [];
    for (const [key, bucket] of buckets) {
      if (key !== region.key) for (const d of bucket) rightDies.push(d);
    }

    for (const testNumber of activeTestNumbers) {
      const readVal = (die: Die) => die.testValues?.[testNumber] ?? die.values?.[testNumber];
      const leftValues = leftDies.map(readVal).filter((value): value is number => value !== undefined);
      const rightValues = rightDies.map(readVal).filter((value): value is number => value !== undefined);

      if (leftValues.length < options.minimumSampleSize || rightValues.length < options.minimumSampleSize) continue;

      const { pValue, effectSize, delta } = welchPValue(leftValues, rightValues);
      const { label, unit } = labelForTest(testNumber, defs);
      const rightMean = mean(rightValues);
      const relativeDelta = rightMean !== 0 ? delta / Math.abs(rightMean) : undefined;

      findings.push({
        id: `test:${testNumber}:${region.key}`,
        level: 'wafer',
        severity: 'info',
        variable: {
          kind: 'test',
          index: testNumber,
          label,
          unit,
        },
        comparison: {
          family: region.family,
          left: region.label,
          right: comparisonRight(region.family),
        },
        effect: {
          direction: delta === 0 ? 'different' : delta > 0 ? 'higher' : 'lower',
          absoluteDelta: delta,
          relativeDelta,
          effectSize,
        },
        stats: {
          method: 'welch-z-approx',
          pValue,
          sampleSizeLeft: leftValues.length,
          sampleSizeRight: rightValues.length,
        },
        summary: summarizeTestFinding(region.label, label, delta, relativeDelta, region.family, unit),
        highlight: {
          kind: 'region',
          regionFamily: region.family,
          regionKeys: [region.key],
          dieKeys: [...region.dieKeys],
        },
      });
    }
  }

  adjustPValues(findings);

  return {
    activeTestNumbers,
    findings: findings
      .filter((finding) => {
        const adjusted = finding.stats.adjustedPValue ?? finding.stats.pValue ?? 1;
        const effectSize = Math.abs(finding.effect.effectSize ?? 0);
        return adjusted <= options.significanceLevel && effectSize >= options.minimumEffectSize;
      })
      .map((finding) => ({
        ...finding,
        severity: severityForScore(
          finding.stats.adjustedPValue ?? finding.stats.pValue ?? 1,
          finding.effect.effectSize ?? 0,
        ),
      })),
  };
}

function buildSpecLimitFindings(
  dies: Die[],
  regionFamilies: StatsRegion[][],
  testDefs: TestDef[] | undefined,
  options: ResolvedOptions,
): RawFinding[] {
  if (!testDefs?.length) return [];
  const limited = testDefs.filter(td => td.limitLow !== undefined || td.limitHigh !== undefined);
  if (!limited.length) return [];

  const allFindings: RawFinding[] = [];

  const dieMap = new Map(dies.map(d => [`${d.x},${d.y}`, d]));

  for (const td of limited) {
    const tn = td.testNumber ?? td.index;
    if (tn === undefined) continue;

    for (const regionFamily of regionFamilies) {
      const buckets = new Map<string, Die[]>();
      for (const region of regionFamily) {
        const bucket: Die[] = [];
        for (const key of region.dieKeys) {
          const d = dieMap.get(key);
          if (d) bucket.push(d);
        }
        buckets.set(region.key, bucket);
      }
      const findings: RawFinding[] = [];

      for (const region of regionFamily) {
        const leftDies = buckets.get(region.key)!;
        const rightDies: Die[] = [];
        for (const [key, bucket] of buckets) {
          if (key !== region.key) for (const d of bucket) rightDies.push(d);
        }

        const hasValue = (d: Die) => (d.testValues?.[tn] ?? d.values?.[tn]) !== undefined;
        const isSpecFail = (d: Die) => {
          const v = d.testValues?.[tn] ?? d.values?.[tn];
          if (v === undefined) return false;
          if (td.limitLow !== undefined && v < td.limitLow) return true;
          if (td.limitHigh !== undefined && v > td.limitHigh) return true;
          return false;
        };

        const leftValid = leftDies.filter(hasValue);
        const rightValid = rightDies.filter(hasValue);

        if (leftValid.length < options.minimumSampleSize || rightValid.length < options.minimumSampleSize) continue;

        const leftFail = leftValid.filter(isSpecFail).length;
        const rightFail = rightValid.filter(isSpecFail).length;
        const leftRate = leftFail / leftValid.length;
        const rightRate = rightFail / rightValid.length;
        const delta = leftRate - rightRate;
        const pValue = twoProportionPValue(leftFail, leftValid.length, rightFail, rightValid.length);

        findings.push({
          id: `specLimit:${tn}:${region.key}`,
          level: 'wafer',
          severity: 'info',
          variable: {
            kind: 'test',
            index: tn,
            label: td.name,
            unit: td.unit,
          },
          comparison: {
            family: region.family,
            left: region.label,
            right: comparisonRight(region.family),
          },
          effect: {
            direction: delta === 0 ? 'different' : delta > 0 ? 'higher' : 'lower',
            absoluteDelta: delta,
            relativeDelta: rightRate === 0 ? undefined : delta / rightRate,
            effectSize: delta,
          },
          stats: {
            method: 'two-proportion-z',
            pValue,
            sampleSizeLeft: leftValid.length,
            sampleSizeRight: rightValid.length,
          },
          summary: `${region.label} spec-fail rate for ${td.name} is ${(Math.abs(delta) * 100).toFixed(1)} pp ${delta > 0 ? 'higher' : 'lower'} than the rest of the wafer`,
          highlight: {
            kind: 'region',
            regionFamily: region.family,
            regionKeys: [region.key],
            dieKeys: [...region.dieKeys],
          },
        });
      }

      adjustPValues(findings);
      allFindings.push(
        ...findings
          .filter(f => {
            const adj = f.stats.adjustedPValue ?? f.stats.pValue ?? 1;
            const delta = Math.abs(f.effect.absoluteDelta ?? 0);
            const relDelta = Math.abs(f.effect.relativeDelta ?? 0);
            return adj <= options.significanceLevel &&
              (delta >= options.minimumEffectSize || relDelta >= options.minimumRelativeEffect);
          })
          .map(f => ({
            ...f,
            severity: severityForScore(
              f.stats.adjustedPValue ?? f.stats.pValue ?? 1,
              f.effect.effectSize ?? 0,
            ),
          })),
      );
    }
  }

  return allFindings;
}

// ── Adjacent-finding merge ─────────────────────────────────────────────────
// The region builders emit one finding per region, so a single contiguous signal
// (e.g. an edge-fail band spanning rings 1 and 2) surfaces as several near-identical
// findings. This pass collapses runs of *adjacent* regions that carry the *same*
// signal (same family, same variable, same direction) into one finding whose stats
// are recomputed over the union of the constituent dies. The original per-region
// finding ids are kept in `relatedIds` as an audit trail.

interface MergeContext {
  eligibleDies: EligibleDie[];
  softEligibleDies: EligibleDie[];
  testDies: Die[];
  passBins: number[];
  ringCount: number;
  sectorCount: number;
  hbinDefs?: BinDef[];
  sbinDefs?: BinDef[];
  testDefs?: TestDef[];
}

/** Region keys this finding covers (e.g. `["ring:1","ring:2"]`); empty for non-region targets. */
function regionKeysOf(f: RawFinding): string[] {
  return (f.highlight as { regionKeys?: string[] }).regionKeys ?? [];
}

/** Group key for findings that describe the same signal in different regions. */
function mergeGroupKey(f: RawFinding): string {
  const variableKey = f.variable.bin ?? f.variable.index ?? '';
  return `${f.comparison.family}\0${f.variable.kind}\0${variableKey}\0${f.effect.direction}`;
}

/** Order findings within a ring/sector group so contiguous-run detection is linear. */
function findingOrderIndex(f: RawFinding, sectorCount: number): number {
  const key = regionKeysOf(f)[0] ?? '';
  const parsed = parseRegionKey(key);
  if (parsed.family === 'ring') return parsed.ring ?? 0;
  if (parsed.family === 'sector') {
    const names = sectorCompassNames(sectorCount);
    return names.indexOf(parsed.sector ?? '');
  }
  return 0;
}

/**
 * Partition a same-signal group into maximal runs of spatially adjacent regions.
 * Singletons (no adjacent same-signal neighbour) come back as length-1 runs.
 */
function findContiguousRuns(group: RawFinding[], family: string, sectorCount: number): RawFinding[][] {
  if (family === 'quadrant') {
    // Connected components in the quadrant adjacency graph.
    const byQuadrant = new Map<string, RawFinding>();
    for (const f of group) {
      const q = parseRegionKey(regionKeysOf(f)[0] ?? '').quadrant;
      if (q) byQuadrant.set(q, f);
    }
    const quadrants = [...byQuadrant.keys()];
    const seen = new Set<string>();
    const runs: RawFinding[][] = [];
    for (const start of quadrants) {
      if (seen.has(start)) continue;
      const component: string[] = [];
      const stack = [start];
      seen.add(start);
      while (stack.length) {
        const q = stack.pop()!;
        component.push(q);
        for (const other of quadrants) {
          if (!seen.has(other) && areQuadrantsAdjacent(q, other)) {
            seen.add(other);
            stack.push(other);
          }
        }
      }
      runs.push(component.map(q => byQuadrant.get(q)!));
    }
    return runs;
  }

  // Ring (linear) and sector (cyclic) — sort by order index, then split where the
  // index gap exceeds 1. For sectors, also stitch the wrap-around (last↔first).
  const sorted = [...group].sort(
    (a, b) => findingOrderIndex(a, sectorCount) - findingOrderIndex(b, sectorCount),
  );
  const runs: RawFinding[][] = [];
  let current: RawFinding[] = [];
  for (const f of sorted) {
    if (current.length === 0) {
      current.push(f);
      continue;
    }
    const prev = findingOrderIndex(current[current.length - 1], sectorCount);
    const next = findingOrderIndex(f, sectorCount);
    if (next - prev === 1) {
      current.push(f);
    } else {
      runs.push(current);
      current = [f];
    }
  }
  if (current.length) runs.push(current);

  if (family === 'sector' && runs.length > 1) {
    // Cyclic wrap: if the first sector and last sector are adjacent (indices 0 and N-1),
    // the last run continues into the first run.
    const names = sectorCompassNames(sectorCount);
    const n = names.length;
    const firstIdx = findingOrderIndex(runs[0][0], sectorCount);
    const lastIdx = findingOrderIndex(runs[runs.length - 1][runs[runs.length - 1].length - 1], sectorCount);
    if (firstIdx === 0 && lastIdx === n - 1) {
      const last = runs.pop()!;
      runs[0] = [...last, ...runs[0]];
    }
  }

  return runs;
}

/** Build the merged label for a run of ring findings. */
function mergeRingLabel(run: RawFinding[], ringCount: number): string {
  const rings = run
    .map(f => parseRegionKey(regionKeysOf(f)[0] ?? '').ring)
    .filter((r): r is number => r !== undefined)
    .sort((a, b) => a - b);
  const min = rings[0];
  const max = rings[rings.length - 1];
  // Attach a zone suffix only when the run is uniformly that zone.
  let suffix = '';
  if (min === max && min === 1 && ringCount > 1) suffix = ' (core)';
  else if (min === max && min === ringCount && ringCount > 1) suffix = ' (edge)';
  return min === max ? `Ring ${min}${suffix}` : `Rings ${min}–${max}`;
}

/** Build the merged label for a run of sector findings (contiguous arc). */
function mergeSectorLabel(run: RawFinding[], sectorCount: number): string {
  const sectors = run.map(f => parseRegionKey(regionKeysOf(f)[0] ?? '').sector ?? '');
  return sectors.length === 1 ? `Sector ${sectors[0]}` : `Sectors ${sectors[0]}–${sectors[sectors.length - 1]}`;
}

/** Build the merged label for a run of quadrant findings, e.g. "Quadrants NW, SW & SE". */
function mergeQuadrantLabel(run: RawFinding[]): string {
  const quads = run.map(f => parseRegionKey(regionKeysOf(f)[0] ?? '').quadrant ?? '');
  if (quads.length === 1) return quads[0];
  if (quads.length === 2) return `Quadrants ${quads[0]} & ${quads[1]}`;
  return `Quadrants ${quads.slice(0, -1).join(', ')} & ${quads[quads.length - 1]}`;
}

function uniqueKeys(arr: string[]): string[] {
  return [...new Set(arr)];
}

/**
 * Recompute stats for a merged finding over the union of its constituent dies.
 * Uses the same proportion/Welch helpers the builders use — never averages
 * the per-region p-values. Returns a finding ready to replace the run.
 */
function buildMergedFinding(run: RawFinding[], ctx: MergeContext): RawFinding {
  const template = run[0];
  const family = template.comparison.family as RegionFamily;
  const kind = template.variable.kind;

  const unionDieKeys = uniqueKeys(run.flatMap(f => (f.highlight as { dieKeys?: string[] }).dieKeys ?? []));
  const unionRegionKeys = uniqueKeys(run.flatMap(regionKeysOf));
  const leftKeySet = new Set(unionDieKeys);

  const label =
    family === 'ring' ? mergeRingLabel(run, ctx.ringCount) :
    family === 'sector' ? mergeSectorLabel(run, ctx.sectorCount) :
    mergeQuadrantLabel(run);

  // Pick the die pool the original builder used for this kind.
  const pool =
    kind === 'softBin' ? ctx.softEligibleDies :
    kind === 'test'    ? ctx.testDies :
    ctx.eligibleDies;
  const leftDies = pool.filter(d => leftKeySet.has(`${d.x},${d.y}`));
  const rightDies = pool.filter(d => !leftKeySet.has(`${d.x},${d.y}`));

  let effect: RawFinding['effect'];
  let stats: RawFinding['stats'];
  let severity: StatsSeverity;
  let summary: string;
  let idMetric: string;

  if (kind === 'test') {
    const testNumber = template.variable.index!;
    const read = (d: Die) => d.testValues?.[testNumber] ?? d.values?.[testNumber];
    const leftValues = leftDies.map(read).filter((v): v is number => v !== undefined);
    const rightValues = rightDies.map(read).filter((v): v is number => v !== undefined);
    const { pValue, effectSize, delta } = welchPValue(leftValues, rightValues);
    const rightMean = mean(rightValues);
    const relativeDelta = rightMean !== 0 ? delta / Math.abs(rightMean) : undefined;
    effect = {
      direction: delta === 0 ? 'different' : delta > 0 ? 'higher' : 'lower',
      absoluteDelta: delta,
      relativeDelta,
      effectSize,
    };
    stats = { method: 'welch-z-approx', pValue, sampleSizeLeft: leftValues.length, sampleSizeRight: rightValues.length };
    severity = severityForScore(pValue, effectSize);
    summary = summarizeTestFinding(label, template.variable.label, delta, relativeDelta, family, template.variable.unit);
    idMetric = `test:${testNumber}`;
  } else if (kind === 'yield') {
    const passSet = new Set(ctx.passBins);
    const leftPass = leftDies.filter(d => d.hbin !== undefined && passSet.has(d.hbin)).length;
    const rightPass = rightDies.filter(d => d.hbin !== undefined && passSet.has(d.hbin)).length;
    const leftRate = leftPass / leftDies.length;
    const rightRate = rightPass / rightDies.length;
    const delta = leftRate - rightRate;
    const pValue = twoProportionPValue(leftPass, leftDies.length, rightPass, rightDies.length);
    effect = {
      direction: delta === 0 ? 'different' : delta > 0 ? 'higher' : 'lower',
      absoluteDelta: delta,
      relativeDelta: rightRate === 0 ? undefined : delta / rightRate,
      effectSize: delta,
    };
    stats = { method: 'two-proportion-z', pValue, sampleSizeLeft: leftDies.length, sampleSizeRight: rightDies.length };
    severity = severityForFinding(pValue, delta, effect.relativeDelta);
    summary = summarizeYieldFinding(label, delta, family);
    idMetric = 'yield';
  } else {
    // hardBin / softBin — count occurrences of the target bin.
    const bin = template.variable.bin!;
    const getBin = (d: Die) => kind === 'softBin' ? d.sbin : d.hbin;
    const leftHit = leftDies.filter(d => getBin(d) === bin).length;
    const rightHit = rightDies.filter(d => getBin(d) === bin).length;
    const leftRate = leftHit / leftDies.length;
    const rightRate = rightHit / rightDies.length;
    const delta = leftRate - rightRate;
    const pValue = twoProportionPValue(leftHit, leftDies.length, rightHit, rightDies.length);
    effect = {
      direction: delta === 0 ? 'different' : delta > 0 ? 'higher' : 'lower',
      absoluteDelta: delta,
      relativeDelta: rightRate === 0 ? undefined : delta / rightRate,
      effectSize: delta,
    };
    stats = { method: 'two-proportion-z', pValue, sampleSizeLeft: leftDies.length, sampleSizeRight: rightDies.length };
    severity = severityForFinding(pValue, delta, effect.relativeDelta);
    const defs = kind === 'softBin' ? ctx.sbinDefs : ctx.hbinDefs;
    summary = summarizeBinFinding(label, labelForBin(bin, defs, kind === 'softBin' ? 'SBin' : 'HBin'), delta, family);
    idMetric = `${kind}:${bin}`;
  }

  // Deterministic id from the sorted region keys (e.g. yield:ring:1-2).
  const regionIds = uniqueKeys(
    unionRegionKeys.map(k => k.replace(`${family}:`, '')),
  ).join('-');

  // Preserve the original highlight shape per kind: bin findings carry a bin +
  // regionKeys (so click-to-highlight still applies highlightBin); yield/test
  // findings carry a region target. dieKeys is the union in both cases.
  const highlight: HighlightTarget = kind === 'hardBin' || kind === 'softBin'
    ? { kind: 'bin', bin: template.variable.bin!, regionKeys: unionRegionKeys, dieKeys: unionDieKeys }
    : { kind: 'region', regionFamily: family, regionKeys: unionRegionKeys, dieKeys: unionDieKeys };

  return {
    ...template,
    id: `${idMetric}:${family}:${regionIds}`,
    severity,
    comparison: { family, left: label, right: comparisonRight(family) },
    effect,
    stats,
    summary,
    highlight,
    relatedIds: run.map(f => f.id),
  };
}

/**
 * Replace runs of adjacent same-signal ring/quadrant/sector findings with a single
 * merged finding each. Findings of other families (cluster, edge-arc, reticle-position,
 * test-site) and singleton runs pass through unchanged.
 */
function mergeAdjacentFindings(findings: RawFinding[], ctx: MergeContext): RawFinding[] {
  const MERGEABLE = new Set<string>(['ring', 'quadrant', 'sector']);
  const passthrough: RawFinding[] = [];
  const groups = new Map<string, RawFinding[]>();

  for (const f of findings) {
    if (!MERGEABLE.has(f.comparison.family)) {
      passthrough.push(f);
      continue;
    }
    const key = mergeGroupKey(f);
    const arr = groups.get(key) ?? [];
    arr.push(f);
    groups.set(key, arr);
  }

  const merged: RawFinding[] = [];
  for (const group of groups.values()) {
    if (group.length === 1) {
      merged.push(group[0]);
      continue;
    }
    const family = group[0].comparison.family;
    for (const run of findContiguousRuns(group, family, ctx.sectorCount)) {
      merged.push(run.length === 1 ? run[0] : buildMergedFinding(run, ctx));
    }
  }

  return [...passthrough, ...merged];
}

export function analyzeWaferMap(
  input: AnalyzeWaferMapInput,
  options: AnalyzeWaferMapOptions = {},
): StatsSummary {
  const baseResolved = { ...DEFAULT_OPTIONS, ...options } as ResolvedOptions;
  const result = normalizeInput(input);
  const isLotStack  = result.view.isLotStack;
  const stackMethod = result.view.aggrMethod;
  const hasHbinData = !isLotStack ||
    stackMethod === 'mode' || stackMethod === 'countBin' || stackMethod === 'percent';
  const eligibleDies = result.dies.filter((die): die is EligibleDie => isEligibleDie(die, baseResolved));
  const resolved = adaptOptions(baseResolved, eligibleDies.length);
  const includedDies = result.dies.filter((die) => {
    if (!resolved.includePartial && die.partial) return false;
    if (!resolved.includeEdgeExcluded && die.edgeExcluded) return false;
    return true;
  });
  const ringRegions = buildRingRegions(includedDies, result.wafer, resolved.ringCount);
  const quadrantRegions = buildQuadrantRegions(includedDies, result.wafer, resolved.ringCount);
  const reticlePositionRegions = resolved.enableReticlePositionAnalysis
    ? buildReticlePositionRegions(includedDies, result.reticleConfig)
    : [];
  // enableTestSiteAnalysis: undefined means auto (guard in buildTestSiteRegions decides);
  // true forces it on; false suppresses it.
  const testSiteRegions = resolved.enableTestSiteAnalysis === false
    ? []
    : buildTestSiteRegions(includedDies, resolved.enableTestSiteAnalysis === true);
  const sectorRegions = resolved.enableAngularAnalysis
    ? buildSectorRegions(includedDies, result.wafer, resolved.sectorCount)
    : [];

  const findings: RawFinding[] = [];
  if (resolved.enableYieldAnalysis && hasHbinData) {
    findings.push(
      ...buildYieldFindings(eligibleDies, ringRegions, resolved.passBins, resolved),
      ...buildYieldFindings(eligibleDies, quadrantRegions, resolved.passBins, resolved),
      ...buildYieldFindings(eligibleDies, reticlePositionRegions, resolved.passBins, resolved),
      ...buildYieldFindings(eligibleDies, testSiteRegions, resolved.passBins, resolved),
      ...buildYieldFindings(eligibleDies, sectorRegions, resolved.passBins, resolved),
    );
  }
  if (resolved.enableHardBinAnalysis && hasHbinData) {
    findings.push(
      ...buildBinFindings(eligibleDies, ringRegions, 'hard', result.hbinDefs, 'hardBin', resolved),
      ...buildBinFindings(eligibleDies, quadrantRegions, 'hard', result.hbinDefs, 'hardBin', resolved),
      ...buildBinFindings(eligibleDies, reticlePositionRegions, 'hard', result.hbinDefs, 'hardBin', resolved),
      ...buildBinFindings(eligibleDies, testSiteRegions, 'hard', result.hbinDefs, 'hardBin', resolved),
      ...buildBinFindings(eligibleDies, sectorRegions, 'hard', result.hbinDefs, 'hardBin', resolved),
    );
  }
  if (resolved.enableSoftBinAnalysis) {
    const softEligibleDies = eligibleDies.filter((die): die is EligibleDie => die.sbin !== undefined);
    findings.push(
      ...buildBinFindings(softEligibleDies, ringRegions, 'soft', result.sbinDefs, 'softBin', resolved),
      ...buildBinFindings(softEligibleDies, quadrantRegions, 'soft', result.sbinDefs, 'softBin', resolved),
      ...buildBinFindings(softEligibleDies, reticlePositionRegions, 'soft', result.sbinDefs, 'softBin', resolved),
      ...buildBinFindings(softEligibleDies, testSiteRegions, 'soft', result.sbinDefs, 'softBin', resolved),
      ...buildBinFindings(softEligibleDies, sectorRegions, 'soft', result.sbinDefs, 'softBin', resolved),
    );
  }
  const warnings: string[] = [];
  let activeTestNumbers: number[] | undefined;
  if (resolved.enableTestValueAnalysis) {
    const ring     = buildTestValueFindings(eligibleDies, ringRegions, result.view.testDefs, resolved);
    const quad     = buildTestValueFindings(eligibleDies, quadrantRegions, result.view.testDefs, resolved);
    const reticle  = buildTestValueFindings(eligibleDies, reticlePositionRegions, result.view.testDefs, resolved);
    const testSite = buildTestValueFindings(eligibleDies, testSiteRegions, result.view.testDefs, resolved);
    const sector   = buildTestValueFindings(eligibleDies, sectorRegions, result.view.testDefs, resolved);
    findings.push(...ring.findings, ...quad.findings, ...reticle.findings, ...testSite.findings, ...sector.findings);
    if (ring.warning) warnings.push(ring.warning);
    activeTestNumbers = ring.activeTestNumbers;

    findings.push(...buildSpecLimitFindings(
      eligibleDies,
      [ringRegions, quadrantRegions, reticlePositionRegions, testSiteRegions, sectorRegions],
      result.view.testDefs,
      resolved,
    ));
  }
  if (resolved.enableClusterAnalysis) {
    const failPredicate = makeClusterFailurePredicate(isLotStack, hasHbinData, result.view.testDefs);
    if (!isLotStack || hasHbinData || failPredicate !== undefined) {
      findings.push(...buildClusterFindings(eligibleDies, result.wafer, {
        ...resolved,
        isFailingDie: failPredicate,
      }));
    }
  }
  // Collapse runs of adjacent same-signal ring/quadrant/sector findings into one
  // each. Runs BEFORE pattern classification so the pattern pass links the merged
  // finding (not the constituents) via relatedIds.
  const mergedFindings = mergeAdjacentFindings(findings, {
    eligibleDies,
    softEligibleDies: eligibleDies.filter((die): die is EligibleDie => die.sbin !== undefined),
    testDies: eligibleDies,
    passBins: resolved.passBins,
    ringCount: resolved.ringCount,
    sectorCount: resolved.sectorCount,
    hbinDefs: result.hbinDefs,
    sbinDefs: result.sbinDefs,
    testDefs: result.view.testDefs,
  });
  findings.length = 0;
  findings.push(...mergedFindings);

  if (resolved.enablePatternClassification && hasHbinData) {
    const patternResult = classifyPattern(eligibleDies, result.wafer, {
      passBins:  resolved.passBins,
      ringCount: resolved.ringCount,
    });
    if (patternResult !== null && patternResult.pattern !== 'random' && patternResult.pattern !== 'none') {
      const LABEL_MAP: Record<string, string> = {
        'center':     'Center cluster',
        'donut':      'Donut',
        'edge-ring':  'Edge-ring',
        'edge-local': 'Edge-local',
        'scratch':    'Scratch',
        'near-full':  'Near-full',
      };
      const label = LABEL_MAP[patternResult.pattern] ?? patternResult.pattern;
      const severity: StatsSeverity =
        patternResult.confidence === 'high'   ? 'unusual' :
        patternResult.confidence === 'medium' ? 'notable' : 'info';
      const f = patternResult.features;
      const pct = (v: number) => `${(v * 100).toFixed(0)}%`;
      const detail =
        patternResult.pattern === 'edge-ring' || patternResult.pattern === 'edge-local'
          ? `${pct(f.edgeRdd)} of edge dies failing`
          : patternResult.pattern === 'center' || patternResult.pattern === 'donut'
          ? `centroid at ${pct(f.centroidDistNorm)} of wafer radius from centre`
          : patternResult.pattern === 'scratch'
          ? `linear score ${f.linearScore.toFixed(2)}, eccentricity ${f.eccentricity.toFixed(2)}`
          : `${pct(f.globalRdd)} of dies failing`;
      const failingDies = eligibleDies.filter(d => {
        const bin = d.hbin ?? d.sbin;
        return bin !== undefined && !new Set(resolved.passBins).has(bin);
      });

      // Find existing findings that are correlated with this spatial pattern.
      // A finding is related when its comparison family is one the pattern explains.
      const RELATED_FAMILIES: Record<string, StatsComparisonFamily[]> = {
        'edge-ring':  ['ring', 'edge-arc'],
        'edge-local': ['edge-arc', 'sector', 'quadrant'],
        'center':     ['ring', 'cluster'],
        'donut':      ['ring'],
        'scratch':    ['cluster', 'sector', 'quadrant'],
        'near-full':  ['ring'],
      };
      const relatedFamilies = new Set<StatsComparisonFamily>(
        RELATED_FAMILIES[patternResult.pattern] ?? [],
      );

      // For ring-based patterns, further filter to only rings that are relevant:
      // edge patterns → outer ring; center → core ring; donut → middle rings.
      // Parse ring indices from highlight.regionKeys (robust to merged labels
      // like "Rings 3–4" which a substring match on the label would miss).
      const detectedPattern = patternResult.pattern;
      const ringCount = resolved.ringCount;
      function isRingRelevant(existing: RawFinding): boolean {
        const rings = regionKeysOf(existing)
          .map(k => parseRegionKey(k).ring)
          .filter((r): r is number => r !== undefined);
        if (rings.length === 0) return true;
        const includesEdge = rings.some(r => r === ringCount);
        const includesCore = rings.some(r => r === 1);
        if (detectedPattern === 'edge-ring' || detectedPattern === 'edge-local') return includesEdge;
        if (detectedPattern === 'center') return includesCore;
        if (detectedPattern === 'donut') return !includesEdge && !includesCore;
        return true; // near-full: all rings
      }

      const relatedIds: string[] = [];
      for (const existing of findings) {
        if (!relatedFamilies.has(existing.comparison.family as StatsComparisonFamily)) continue;
        if (existing.comparison.family === 'ring' && !isRingRelevant(existing as RawFinding)) continue;
        relatedIds.push(existing.id);
        // Downgrade ring-family findings to info so they don't double-count in the badge/hasNotable.
        // Cluster and edge-arc findings carry their own statistical evidence (p-value, exact die count)
        // and should keep their computed severity — they are supporting detail, not redundant.
        const isRegionOnly = existing.comparison.family === 'ring' ||
          existing.comparison.family === 'quadrant' || existing.comparison.family === 'sector';
        if (severity !== 'info' && isRegionOnly) {
          (existing as RawFinding).severity = 'info';
        }
      }

      findings.push({
        id: `spatial-pattern:${patternResult.pattern}`,
        level: 'wafer',
        severity,
        variable: { kind: 'spatialPattern', label },
        comparison: { family: 'spatial-pattern', left: label, right: 'Wafer' },
        effect: { direction: 'different', effectSize: f.globalRdd },
        stats: {
          method: 'geometry',
          sampleSizeLeft:  failingDies.length,
          sampleSizeRight: eligibleDies.length,
        },
        summary: `Spatial pattern: ${label.toLowerCase()} (${patternResult.confidence} confidence) — ${detail}${patternResult.note ? ` [${patternResult.note}]` : ''}`,
        highlight: { kind: 'dies', dieKeys: failingDies.map(d => `${d.x},${d.y}`) },
        relatedIds: relatedIds.length > 0 ? relatedIds : undefined,
      });
    }
  }

  findings.sort((left, right) => {
    const leftScore = left.stats.adjustedPValue ?? left.stats.pValue ?? 1;
    const rightScore = right.stats.adjustedPValue ?? right.stats.pValue ?? 1;
    if (leftScore !== rightScore) return leftScore - rightScore;
    return Math.abs((right.effect.absoluteDelta ?? 0)) - Math.abs((left.effect.absoluteDelta ?? 0));
  });

  const stats = collectStats(result.dies, eligibleDies.length, result.yield.yieldPercent);
  if (isLotStack) {
    stats.isLotStack = true;
    if (stackMethod) stats.aggregationMethod = stackMethod;
  }
  if (warnings.length > 0) stats.warnings = warnings;
  const specYield = computeTestSpecYield(result.dies, result.view.testDefs);
  if (specYield) stats.testSpecYield = specYield;
  if (activeTestNumbers?.length) {
    const perTestStats = computePerTestStats(result.dies, activeTestNumbers, result.view.testDefs, resolved.minimumSampleSize);
    if (perTestStats) stats.perTestStats = perTestStats;
  }

  return {
    level: 'wafer',
    hasNotableFindings: findings.some((finding) => finding.severity === 'notable' || finding.severity === 'unusual'),
    findings,
    wafer: result.wafer.metadata ?? undefined,
    stats,
  };
}
