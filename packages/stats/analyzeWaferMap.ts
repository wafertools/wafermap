import type { Die } from '../core/dies.js';
import { buildWaferMap, type WaferMapResult } from '../renderer/buildWaferMap.js';
import type { BinDef, TestDef } from '../renderer/buildWaferMap.js';
import type {
  AnalyzeWaferMapInput,
  AnalyzeWaferMapOptions,
  StatsFinding,
  StatsSeverity,
  StatsSummary,
} from './types.js';
import { buildQuadrantRegions, buildReticlePositionRegions, buildRingRegions, buildSectorRegions, type StatsRegion } from './regions.js';
import { buildClusterFindings } from './clusterDetection.js';

interface EligibleDie extends Die {
  hbin?: number;
}

interface RawFinding extends StatsFinding {
  comparison: StatsFinding['comparison'];
  stats: StatsFinding['stats'];
  effect: StatsFinding['effect'];
}

type ResolvedOptions = Required<Omit<AnalyzeWaferMapOptions, 'testNumbers'>> & { testNumbers?: number[] };

const DEFAULT_OPTIONS: ResolvedOptions = {
  ringCount: 4,
  passBins: [1],
  significanceLevel: 0.05,
  minimumEffectSize: 0.15,
  minimumRelativeEffect: 0.5,
  minimumSampleSize: 5,
  includePartial: false,
  includeEdgeExcluded: false,
  enableYieldAnalysis: true,
  enableHardBinAnalysis: true,
  enableSoftBinAnalysis: true,
  enableTestValueAnalysis: true,
  enableReticlePositionAnalysis: true,
  enableClusterAnalysis: true,
  enableAngularAnalysis: true,
  minimumClusterSize: 3,
  sectorCount: 16,
};

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
      yieldPercent: totalDies > 0 ? passDies / totalDies : null,
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
  if (pValue <= 0.01 && (absDelta >= 0.25 || absRel >= 2.0)) return 'unusual';
  if (pValue <= 0.05 && (absDelta >= 0.15 || absRel >= 1.0)) return 'notable';
  return 'info';
}

function severityForScore(pValue: number, score: number): StatsSeverity {
  if (pValue <= 0.01 && Math.abs(score) >= 0.5) return 'unusual';
  if (pValue <= 0.05 && Math.abs(score) >= 0.15) return 'notable';
  return 'info';
}

type RegionFamily = 'ring' | 'quadrant' | 'reticle-position' | 'sector';

function summarizeYieldFinding(label: string, delta: number, family: RegionFamily): string {
  const target = family === 'reticle-position' ? 'other reticle positions' : 'the rest of the map';
  const pp = (Math.abs(delta) * 100).toFixed(1);
  return `${label} yield is ${pp} percentage points ${delta > 0 ? 'higher' : 'lower'} than ${target}`;
}

function summarizeRegionLabel(label: string, family: RegionFamily): string {
  if (family === 'quadrant') return `quadrant ${label}`;
  return label;
}

function summarizeBinFinding(
  label: string,
  binLabel: string,
  delta: number,
  family: RegionFamily,
): string {
  const familyLabel = summarizeRegionLabel(label, family);
  const target = family === 'reticle-position' ? 'other reticle positions' : 'the rest of the map';
  const pp = (Math.abs(delta) * 100).toFixed(1);
  return `${familyLabel} has ${binLabel} occurrence ${pp} percentage points ${delta > 0 ? 'higher' : 'lower'} than ${target}`;
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
  const target = family === 'reticle-position' ? 'other reticle positions' : 'the rest of the map';
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
        right: region.family === 'reticle-position' ? 'Other reticle positions' : 'Rest of map',
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
        keys: [region.key],
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
          right: region.family === 'reticle-position' ? 'Other reticle positions' : 'Rest of map',
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
): { findings: RawFinding[]; warning?: string } {
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
          right: region.family === 'reticle-position' ? 'Other reticle positions' : 'Rest of map',
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
          keys: [region.key],
          dieKeys: [...region.dieKeys],
        },
      });
    }
  }

  adjustPValues(findings);

  return {
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
            right: region.family === 'reticle-position' ? 'Other reticle positions' : 'Rest of map',
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
            keys: [region.key],
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

export function analyzeWaferMap(
  input: AnalyzeWaferMapInput,
  options: AnalyzeWaferMapOptions = {},
): StatsSummary {
  const resolved = { ...DEFAULT_OPTIONS, ...options };
  const result = normalizeInput(input);
  const isLotStack  = result.view.isLotStack;
  const stackMethod = result.view.aggrMethod;
  const hasHbinData = !isLotStack ||
    stackMethod === 'mode' || stackMethod === 'countBin' || stackMethod === 'percent';
  const eligibleDies = result.dies.filter((die): die is EligibleDie => isEligibleDie(die, resolved));
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
  const sectorRegions = resolved.enableAngularAnalysis
    ? buildSectorRegions(includedDies, result.wafer, resolved.sectorCount)
    : [];

  const findings: RawFinding[] = [];
  if (resolved.enableYieldAnalysis && hasHbinData) {
    findings.push(
      ...buildYieldFindings(eligibleDies, ringRegions, resolved.passBins, resolved),
      ...buildYieldFindings(eligibleDies, quadrantRegions, resolved.passBins, resolved),
      ...buildYieldFindings(eligibleDies, reticlePositionRegions, resolved.passBins, resolved),
      ...buildYieldFindings(eligibleDies, sectorRegions, resolved.passBins, resolved),
    );
  }
  if (resolved.enableHardBinAnalysis && hasHbinData) {
    findings.push(
      ...buildBinFindings(eligibleDies, ringRegions, 'hard', result.hbinDefs, 'hardBin', resolved),
      ...buildBinFindings(eligibleDies, quadrantRegions, 'hard', result.hbinDefs, 'hardBin', resolved),
      ...buildBinFindings(eligibleDies, reticlePositionRegions, 'hard', result.hbinDefs, 'hardBin', resolved),
      ...buildBinFindings(eligibleDies, sectorRegions, 'hard', result.hbinDefs, 'hardBin', resolved),
    );
  }
  if (resolved.enableSoftBinAnalysis) {
    const softEligibleDies = eligibleDies.filter((die): die is EligibleDie => die.sbin !== undefined);
    findings.push(
      ...buildBinFindings(softEligibleDies, ringRegions, 'soft', result.sbinDefs, 'softBin', resolved),
      ...buildBinFindings(softEligibleDies, quadrantRegions, 'soft', result.sbinDefs, 'softBin', resolved),
      ...buildBinFindings(softEligibleDies, reticlePositionRegions, 'soft', result.sbinDefs, 'softBin', resolved),
      ...buildBinFindings(softEligibleDies, sectorRegions, 'soft', result.sbinDefs, 'softBin', resolved),
    );
  }
  const warnings: string[] = [];
  if (resolved.enableTestValueAnalysis) {
    const ring    = buildTestValueFindings(eligibleDies, ringRegions, result.view.testDefs, resolved);
    const quad    = buildTestValueFindings(eligibleDies, quadrantRegions, result.view.testDefs, resolved);
    const reticle = buildTestValueFindings(eligibleDies, reticlePositionRegions, result.view.testDefs, resolved);
    const sector  = buildTestValueFindings(eligibleDies, sectorRegions, result.view.testDefs, resolved);
    findings.push(...ring.findings, ...quad.findings, ...reticle.findings, ...sector.findings);
    if (ring.warning) warnings.push(ring.warning);

    findings.push(...buildSpecLimitFindings(
      eligibleDies,
      [ringRegions, quadrantRegions, reticlePositionRegions, sectorRegions],
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

  return {
    level: 'wafer',
    hasNotableFindings: findings.some((finding) => finding.severity === 'notable' || finding.severity === 'unusual'),
    findings,
    wafer: result.wafer.metadata ?? undefined,
    stats,
  };
}
