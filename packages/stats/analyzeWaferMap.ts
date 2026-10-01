import type { Die } from '../core/dies.js';
import { normalizeInput } from './normalizeInput.js';
import { computeCapability, computeTestFlagYield, computeRegionYield } from './summaryFigures.js';
import { binPassSets } from '../renderer/binColors.js';
import { diePassStatus, isYieldEligibleDie, getDieKey, isPositionedDie, positionKey } from '../core/dies.js';
import { dieHasValues, testsPresent, testValue } from '../core/dieTable.js';
import { getTestPassStatus, isParametricTest } from '../renderer/buildWaferMap.js';
import type { BinDef, TestDef, WaferWarning } from '../renderer/buildWaferMap.js';
import { markedTestLabel, derivedFields } from '../renderer/testLabel.js';
import type {
  AnalyzeWaferMapInput,
  AnalyzeWaferMapOptions,
  StatsFinding,
  StatsSeverity,
  StatsSummary,
  HighlightTarget } from './types.js';
import {
  buildQuadrantRegions, buildReticlePositionRegions, buildRingRegions, buildSectorRegions, buildTestSiteRegions,
  sectorCompassNames, areQuadrantsAdjacent, parseRegionKey, QUADRANT_CYCLE, regionAngleBins,
  type StatsRegion } from './regions.js';
import { buildClusterFindings } from './clusterDetection.js';
import {
  classifyPattern, patternExplains, patternFailVerdict, PATTERN_LABELS,
  type PatternClassification, type PatternLabel } from './patternClassification.js';
import { benjaminiHochberg, fiveNumberSummary, normalCdf } from './math.js';
import { mean, clamp01 } from '../core/utils.js';
import { classifySpec, isOutOfSpec } from '../renderer/spec.js';

interface EligibleDie extends Die {
  hbin?: number;
}

interface RawFinding extends StatsFinding {
  comparison: StatsFinding['comparison'];
  stats: StatsFinding['stats'];
  effect: StatsFinding['effect'];
}

export type ResolvedOptions = Required<Omit<AnalyzeWaferMapOptions, 'testNumbers'>> & {
  testNumbers?: number[];
  // From the analysed result (`WaferMapResult.passBins`/`.ringCount`), never from
  // options — see analyzeWaferMap.
  passBins: number[];
  ringCount: number;
  // Internal — not exposed in AnalyzeWaferMapOptions. These decide what counts as
  // a finding; see the note in types.ts for why they are not callable options.
  significanceLevel: number;
  minimumEffectSize: number;
  minimumRelativeEffect: number;
  minimumSampleSize: number;
  minimumClusterSize: number;
  /** Soft bins every die carrying which passes — computed once per analysis. */
  softPassBins?: ReadonlySet<number>;
};

/**
 * Bounds for the numeric options callers can still set, plus the internal
 * thresholds — the latter only because a plain-JS caller has no type checking to
 * stop them passing the removed options, and honouring an out-of-range value
 * there reintroduces exactly the silent-wrong-answer this release removed.
 *
 * `ringCount` is not validated here: it is set once on `buildWaferMap` and
 * validated there (`WaferMapInput.ringCount`), no-upper-bound reasoning included.
 */
const OPTION_BOUNDS = {
  // A p-value threshold is a probability, and 0 admits nothing.
  significanceLevel:     { min: 1e-6, max: 1 },
  minimumEffectSize:     { min: 0, max: 1 },
  minimumRelativeEffect: { min: 0, max: Number.MAX_SAFE_INTEGER },
} as const;

const VALID_SECTOR_COUNTS = [4, 8, 16] as const;

/**
 * Clamp the numeric options into ranges that can produce a meaningful analysis,
 * reporting anything corrected. A caller who passes nonsense previously got a
 * confident, wrong answer with no indication anything was amiss; they now get
 * the nearest sane analysis plus a warning saying what was changed.
 */
export function resolveOptions(
  options: AnalyzeWaferMapOptions,
): { resolved: ResolvedOptions; warnings: WaferWarning[] } {
  // Explicit `undefined` is ABSENCE, not a value. `{ ...defaults, ...options }`
  // makes `{ sectorCount: undefined }` overwrite the default with `undefined`,
  // which then fails the finite-number test below and reports a correction — so
  // the most ordinary way a host forwards an optional (`{ sectorCount: opts.sectors }`,
  // where `opts.rings` is simply unset) raised an `analysis-option-corrected`
  // advisory, and that advisory is not quiet: it reaches the toolbar's warning
  // indicator and the Summary panel's banner. Dropping undefined keys first
  // makes "not passed" and "passed as undefined" mean the same thing, which is
  // what every caller already assumes.
  const supplied = Object.fromEntries(
    Object.entries(options).filter(([, v]) => v !== undefined),
  ) as AnalyzeWaferMapOptions;
  const merged = { ...DEFAULT_OPTIONS, ...supplied } as ResolvedOptions;
  const warnings: WaferWarning[] = [];
  const corrections: string[] = [];

  for (const key of ['significanceLevel', 'minimumEffectSize', 'minimumRelativeEffect'] as const) {
    const { min, max } = OPTION_BOUNDS[key];
    const value = merged[key];
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      corrections.push(`${key}=${String(value)} is not a finite number (using ${DEFAULT_OPTIONS[key]})`);
      merged[key] = DEFAULT_OPTIONS[key];
      continue;
    }
    const clamped = Math.min(max, Math.max(min, value));
    if (clamped !== value) {
      corrections.push(`${key}=${value} is outside ${min}–${max} (using ${clamped})`);
      merged[key] = clamped;
    }
  }
  if (!VALID_SECTOR_COUNTS.includes(merged.sectorCount as typeof VALID_SECTOR_COUNTS[number])) {
    corrections.push(
      `sectorCount=${merged.sectorCount} is not one of ${VALID_SECTOR_COUNTS.join(', ')} `
      + `(using ${DEFAULT_OPTIONS.sectorCount})`);
    merged.sectorCount = DEFAULT_OPTIONS.sectorCount;
  }

  if (corrections.length) {
    const message = `analyzeWaferMap: ${corrections.join('; ')}. `
      + `The analysis ran with the corrected values.`;
    console.warn(`[wafermap] ${message}`);
    warnings.push({ code: 'analysis-option-corrected', message, severity: 'warning' });
  }

  // Removed in 0.30.0: both are set once, on buildWaferMap, and read from the
  // result. A plain-JavaScript caller still passing them gets no type error, and
  // silently ignoring the value would leave them believing their pass bins or
  // ring banding were in effect — so say where the analysis took them from.
  const removed = (['passBins', 'ringCount'] as const)
    .filter(key => (supplied as Record<string, unknown>)[key] !== undefined);
  if (removed.length) {
    const message = `analyzeWaferMap: ${removed.join(' and ')} ${removed.length > 1 ? 'are' : 'is'} no longer `
      + `an analysis option and was ignored. Set ${removed.length > 1 ? 'them' : 'it'} on buildWaferMap; `
      + `the analysis used the value the map was built with.`;
    console.warn(`[wafermap] ${message}`);
    warnings.push({ code: 'analysis-option-corrected', message, severity: 'warning' });
  }

  // Removed in 0.30.0: the per-analysis switches. Every analysis now runs, so a
  // caller that passed `false` expecting fewer findings is told why it got them.
  const switches = ['enableYieldAnalysis', 'enableHardBinAnalysis', 'enableSoftBinAnalysis', 'enableReticlePositionAnalysis', 'enableTestSiteAnalysis', 'enableClusterAnalysis', 'enableAngularAnalysis', 'enablePatternClassification']
    .filter(key => (supplied as Record<string, unknown>)[key] !== undefined);
  if (switches.length) {
    const message = `analyzeWaferMap: ${switches.join(', ')} ${switches.length > 1 ? 'are' : 'is'} no longer `
      + `an option and was ignored: every analysis now runs. Filter the findings (filterFindings) to show fewer.`;
    console.warn(`[wafermap] ${message}`);
    warnings.push({ code: 'analysis-option-corrected', message, severity: 'warning' });
  }
  return { resolved: merged, warnings };
}

const DEFAULT_OPTIONS: ResolvedOptions = {
  ringCount: 4,
  passBins: [1],
  significanceLevel: 0.05,
  minimumEffectSize: 0.20,
  minimumRelativeEffect: 1.0,
  minimumSampleSize: 5,        // internal, not in public AnalyzeWaferMapOptions
  // Off by default: the regional Welch pass is the expensive part of analysis
  // (scales with regions × tests × dies). Callers that display regional
  // test-value findings opt in explicitly. For cheap per-test quartiles without
  // the spatial comparisons, use computePerTestStats instead.
  enableTestValueAnalysis: false,
  computePerTestStats: false,
  sectorCount: 8,
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


function isEligibleDie(die: Die): die is EligibleDie {
  if (!isYieldEligibleDie(die)) return false;
  return (
    die.hbin !== undefined ||
    die.sbin !== undefined ||
    dieHasValues(die)
  );
}

function makeClusterFailurePredicate(
  isLotStack: boolean,
  hasBinData: boolean,
  testDefs: TestDef[] | undefined,
): ((die: Die) => boolean) | undefined {
  if (!isLotStack || hasBinData) return undefined;
  const limited = (testDefs ?? []).filter(
    td => isParametricTest(td) && (td.limitLow !== undefined || td.limitHigh !== undefined),
  );
  if (limited.length === 0) return undefined;
  return (die: Die): boolean => {
    for (const td of limited) {
      if (isOutOfSpec(classifySpec(testValue(die, td.testNumber), td))) return true;
    }
    return false;
  };
}

function collectStats(dies: Die[], analyzedDies: number, yieldPercent: number | null): StatsSummary['stats'] {
  const testSet = new Set<number>();
  const hardBinSet = new Set<number>();
  const softBinSet = new Set<number>();
  const hardBinCounts = new Map<number, number>();
  const softBinCounts = new Map<number, number>();

  for (const tn of testsPresent(dies)) testSet.add(tn);
  for (const die of dies) {
    if (die.hbin !== undefined) hardBinSet.add(die.hbin);
    if (die.sbin !== undefined) softBinSet.add(die.sbin);
    // Counts (not just "which bins appear") are only meaningful over the
    // same yield-eligible population every other bin display uses.
    if (isYieldEligibleDie(die)) {
      if (die.hbin !== undefined) hardBinCounts.set(die.hbin, (hardBinCounts.get(die.hbin) ?? 0) + 1);
      if (die.sbin !== undefined) softBinCounts.set(die.sbin, (softBinCounts.get(die.sbin) ?? 0) + 1);
    }
  }

  return {
    totalDies: dies.length,
    analyzedDies,
    excludedDies: dies.length - analyzedDies,
    yieldPercent,
    testsConsidered: [...testSet].sort((left, right) => left - right),
    hardBinsConsidered: [...hardBinSet].sort((left, right) => left - right),
    softBinsConsidered: [...softBinSet].sort((left, right) => left - right),
    ...(hardBinCounts.size ? { hardBinCounts: Object.fromEntries(hardBinCounts) } : {}),
    ...(softBinCounts.size ? { softBinCounts: Object.fromEntries(softBinCounts) } : {}) };
}

function computeTestSpecYield(
  dies: Die[],
  testDefs: TestDef[] | undefined,
): StatsSummary['stats']['testSpecYield'] {
  if (!testDefs?.length) return undefined;
  const limited = testDefs.filter(td => isParametricTest(td) && (td.limitLow !== undefined || td.limitHigh !== undefined));
  if (!limited.length) return undefined;

  const result: NonNullable<StatsSummary['stats']['testSpecYield']> = [];
  for (const td of limited) {
    const tn = td.testNumber;
    let passDies = 0, failLowDies = 0, failHighDies = 0, totalDies = 0;
    for (const die of dies) {
      if (die.partial || die.edgeExcluded) continue;
      const category = classifySpec(testValue(die, tn), td);
      if (category === null) continue;
      totalDies++;
      if (category === 'failLow') failLowDies++;
      else if (category === 'failHigh') failHighDies++;
      else passDies++;
    }
    result.push({
      testNumber:   tn,
      label:        td.name,
      passDies,
      failLowDies,
      failHighDies,
      totalDies,
      yieldPercent: totalDies > 0 ? (passDies / totalDies) * 100 : null });
  }
  return result.length ? result : undefined;
}

/**
 * Per-test pass rate for functional (`testType: 'F'`) tests — the functional
 * counterpart of `computeTestSpecYield`. Same population convention: partial and
 * edge-excluded dies are skipped; the denominator is dies with a recorded
 * verdict for the test (read via `getTestPassStatus`, so legacy 0/1-encoded
 * functional data is counted identically); dies never tested count as neither.
 */
export function computeFunctionalYield(
  dies: Die[],
  testDefs: TestDef[] | undefined,
): StatsSummary['stats']['functionalYield'] {
  if (!testDefs?.length) return undefined;
  const fDefs = testDefs.filter(td => !isParametricTest(td));
  if (!fDefs.length) return undefined;

  const result: NonNullable<StatsSummary['stats']['functionalYield']> = [];
  for (const td of fDefs) {
    const tn = td.testNumber;
    let passDies = 0, failDies = 0;
    for (const die of dies) {
      if (die.partial || die.edgeExcluded) continue;
      const status = getTestPassStatus(die, tn, td);
      if (status === undefined) continue;
      if (status) passDies++; else failDies++;
    }
    const totalDies = passDies + failDies;
    result.push({
      testNumber:      tn,
      label:           markedTestLabel(td, tn),
      ...derivedFields(td),
      passDies,
      failDies,
      totalDies,
      passRatePercent: totalDies > 0 ? (passDies / totalDies) * 100 : null });
  }
  return result.length ? result : undefined;
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
      const v = testValue(die, tn);
      // `Number.isFinite`, not just `!== undefined`, which is what every other
      // per-test collection in this library screens on (the pooled pass, the
      // boxplot, the report). Without it one NaN reading made `mean` and
      // `stddev` NaN for the whole row and left the sort below in an order the
      // spec does not define, because `(a, b) => a - b` returns NaN for it —
      // so a single bad value silently took out a test's entire statistics.
      if (v !== undefined && Number.isFinite(v)) values.push(v);
    }
    if (values.length < minimumSampleSize) continue;
    const avg = mean(values);
    const stddev = Math.sqrt(sampleVariance(values, avg));
    // Min, quartiles and max by selection, not by sorting every value — the
    // same order statistics (see `fiveNumberSummary`), for one test's values
    // across every die of the wafer.
    const five = fiveNumberSummary(Float64Array.from(values));
    const label = testDefs?.find(td => td.testNumber === tn)?.name ?? String(tn);
    result.push({
      testNumber: tn,
      label,
      count:  values.length,
      min:    five.min,
      max:    five.max,
      mean:   avg,
      stddev,
      median: five.median,
      q1:     five.q1,
      q3:     five.q3 });
  }
  return result.length ? result : undefined;
}

/** The two-proportion z statistic, signed as left − right; 0 when untestable. */
export function twoProportionZ(leftPass: number, leftTotal: number, rightPass: number, rightTotal: number): number {
  const pooled = (leftPass + rightPass) / (leftTotal + rightTotal);
  const variance = pooled * (1 - pooled) * ((1 / leftTotal) + (1 / rightTotal));
  if (!Number.isFinite(variance) || variance <= 0) return 0;
  return ((leftPass / leftTotal) - (rightPass / rightTotal)) / Math.sqrt(variance);
}

/** Two-sided p-value of a z statistic. */
export function zPValue(z: number): number {
  return clamp01(2 * (1 - normalCdf(Math.abs(z))));
}

function twoProportionPValue(
  leftPass: number,
  leftTotal: number,
  rightPass: number,
  rightTotal: number,
): number {
  const z = twoProportionZ(leftPass, leftTotal, rightPass, rightTotal);
  return z === 0 ? 1 : zPValue(z);
}

export function adjustPValues(findings: RawFinding[]): RawFinding[] {
  const families = new Map<string, RawFinding[]>();
  for (const finding of findings) {
    const key = `${finding.variable.kind}:${finding.comparison.family}`;
    const entries = families.get(key) ?? [];
    entries.push(finding);
    families.set(key, entries);
  }

  for (const entries of families.values()) {
    const tested = entries.filter((entry) => entry.stats.pValue !== undefined);
    const adjusted = benjaminiHochberg(tested.map((entry) => entry.stats.pValue!));
    tested.forEach((entry, i) => { entry.stats.adjustedPValue = adjusted[i]; });
  }

  return findings;
}

/**
 * A rate finding's counts: hits and dies in its region and in the rest of the
 * wafer. `passRate` marks a rate of passes (yield, a functional pass rate)
 * rather than of an outcome such as a bin or a limit fail.
 */
export interface RateCounts { hits: number; n: number; restHits: number; restN: number; passRate: boolean }

/**
 * The size of a rate's relative change, for the effect gate and severity —
 * always measured on the adverse outcome. A pass rate is judged by its failure
 * rate: yield 98% → 94% is failures 2% → 6%, a tripling, and must reach the same
 * verdict as the bin rate made of the same dies; as a relative change in yield
 * (4%) it never could. A rate that is zero in the rest of the wafer and not in
 * the region — a bin found only at the edge — is the largest relative change
 * there is, not none (its published `relativeDelta` has no finite value).
 */
export function rateRelativeEffect(c: RateCounts): number {
  const regionRate = (c.passRate ? c.n - c.hits : c.hits) / c.n;
  const restRate = (c.passRate ? c.restN - c.restHits : c.restHits) / c.restN;
  if (restRate === 0) return regionRate === 0 ? 0 : Infinity;
  return Math.abs(regionRate - restRate) / restRate;
}

export function severityForFinding(pValue: number, delta: number, relEffect: number): StatsSeverity {
  const absDelta = Math.abs(delta);
  const absRel = relEffect;
  if (pValue <= 0.01 && (absDelta >= 0.30 || absRel >= 2.5)) return 'unusual';
  if (pValue <= 0.05 && (absDelta >= 0.20 || absRel >= 1.5)) return 'notable';
  return 'info';
}

export function severityForScore(pValue: number, score: number): StatsSeverity {
  if (pValue <= 0.01 && Math.abs(score) >= 0.5) return 'unusual';
  if (pValue <= 0.05 && Math.abs(score) >= 0.15) return 'notable';
  return 'info';
}

export type RegionFamily = 'ring' | 'quadrant' | 'reticle-position' | 'test-site' | 'sector';

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

/**
 * The verb for a region as the subject of a finding sentence. A merged region
 * is plural — "Rings 1–2 have", "Quadrants NE & SE have" — and the merge
 * label (`mergedRegionLabel`) is the only place a plural region word is
 * produced, so its leading word decides.
 */
function regionHas(label: string): 'has' | 'have' {
  return /^(Rings|Sectors|Quadrants)\b/.test(label) ? 'have' : 'has';
}

function summarizeBinFinding(
  label: string,
  binLabel: string,
  delta: number,
  family: RegionFamily,
): string {
  const familyLabel = summarizeRegionLabel(label, family);
  const pp = (Math.abs(delta) * 100).toFixed(1);
  return `${familyLabel} ${regionHas(familyLabel)} ${binLabel} occurrence ${pp} percentage points ${delta > 0 ? 'higher' : 'lower'} than ${comparisonTarget(family)}`;
}

function summarizeFunctionalFinding(
  label: string,
  testName: string,
  delta: number,
  family: RegionFamily,
): string {
  const familyLabel = summarizeRegionLabel(label, family);
  const pp = (Math.abs(delta) * 100).toFixed(1);
  return `${familyLabel} ${regionHas(familyLabel)} ${testName} pass rate ${pp} percentage points ${delta > 0 ? 'higher' : 'lower'} than ${comparisonTarget(family)}`;
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

function labelForTest(
  testNumber: number,
  defs: TestDef[] | undefined,
): { label: string; unit?: string; derived?: true; expression?: string } {
  const def = defs?.find((entry) => entry.testNumber === testNumber);
  return { label: markedTestLabel(def, testNumber), unit: def?.unit, ...derivedFields(def) };
}

// Die keys and region buckets, computed once per die list (and region family)
// rather than once per builder. One analysis buckets the same two populations
// into the same five region families for yield, hard bins, soft bins, functional
// tests and spec limits. Keyed on array identity: the lists and families are
// built once per analysis and never changed afterwards, and a WeakMap lets them
// go with the analysis.
const keysCache = new WeakMap<readonly Die[], string[]>();
const bucketsCache = new WeakMap<readonly Die[], { members: Set<Die>; byFamily: WeakMap<StatsRegion[], Map<string, Die[]>> }>();

/** `getDieKey` of every die in `dies`, in order. */
/**
 * The region each single-region finding was built for. A merge of adjacent
 * findings then works from those regions' dies by position key, rather than
 * hashing every die-key string of every constituent — on a large lot that
 * string work was most of the merge. Kept beside the finding, never on it, so
 * the published finding is unchanged. Keyed by the finding's own `dieKeys`
 * array, which the builders create per finding: later passes hand findings on
 * as shallow copies (`{ ...finding }`), which keep that array but not the
 * finding object itself.
 */
const findingRegion = new WeakMap<readonly string[], StatsRegion>();
function ofRegion(region: StatsRegion, finding: RawFinding): RawFinding {
  const keys = (finding.highlight as { dieKeys?: string[] }).dieKeys;
  if (keys) findingRegion.set(keys, region);
  return finding;
}
/**
 * One regional comparison a wafer's analysis made, reported or not — what
 * `analyzeWaferLot` combines across wafers. Compact on purpose: counts or sums
 * and the region, never the finding's own copy of its die keys.
 */
export interface RegionCandidate {
  /** `source|variable|family|region key` — equal for the same comparison on every wafer. */
  key: string;
  source: 'yield' | 'hardBin' | 'softBin' | 'functional' | 'limitFail' | 'test';
  /** The finding's own objects, shared; the wafer's redundancy collapse later
   *  relabels a surviving hard/soft twin, so the label is kept as it was here. */
  variable: StatsFinding['variable'];
  label: string;
  comparison: StatsFinding['comparison'];
  region: StatsRegion;
  /** Signed z of the wafer's own test (region − rest). */
  z: number;
  /** Region − rest, in the finding's units; and its standardised size for test values. */
  delta: number;
  effectSize: number;
  relativeDelta: number | undefined;
  rate?: RateCounts;
  mean?: MeanStats;
}
let collecting: RegionCandidate[] | null = null;
let collectedFacts: RedundancyFacts | undefined;
/** A wafer analysis's comparisons and the facts its redundancy collapse used. */
export interface WaferComparisons { candidates: RegionCandidate[]; facts: RedundancyFacts | undefined }
const regionCandidates = new WeakMap<StatsSummary, WaferComparisons>();
/** The comparisons behind a summary `analyzeWaferMap` returned in this realm (not
 *  after a structured clone, which drops them). */
export function candidatesOf(summary: StatsSummary): WaferComparisons | undefined {
  return regionCandidates.get(summary);
}

function recordCandidate(finding: RawFinding, z: number, rate?: RateCounts, mean?: MeanStats): void {
  if (!collecting) return;
  const region = regionOfFinding(finding);
  if (!region) return;
  const prefix = finding.id.slice(0, finding.id.indexOf(':'));
  const source = (prefix === 'specLimit' ? 'limitFail' : prefix) as RegionCandidate['source'];
  const { kind, bin, index } = finding.variable;
  collecting.push({
    key: [source, kind, bin ?? '', index ?? '', region.family, region.key].join('|'),
    source, variable: finding.variable, label: finding.variable.label, comparison: finding.comparison, region, z,
    delta: finding.effect.absoluteDelta ?? 0, effectSize: finding.effect.effectSize ?? 0,
    relativeDelta: finding.effect.relativeDelta, rate, mean });
}

/**
 * A combined finding's sentence, in the words the wafer finding of the same
 * comparison uses — one wording per kind, whichever level reports it.
 */
export function describeRegional(c: RegionCandidate, delta: number, relativeDelta: number | undefined): string {
  const label = c.comparison.left;
  const family = c.region.family as RegionFamily;
  switch (c.source) {
    case 'yield': return summarizeYieldFinding(label, delta, family);
    case 'hardBin': case 'softBin': return summarizeBinFinding(label, c.label, delta, family);
    case 'functional': return summarizeFunctionalFinding(label, c.label.replace(/ pass rate$/, ''), delta, family);
    case 'limitFail': return specLimitSummary(label, c.label, delta);
    case 'test': return summarizeTestFinding(label, c.label, delta, relativeDelta, family, c.variable.unit);
  }
}

function specLimitSummary(regionLabel: string, testLabel: string, delta: number): string {
  return `${regionLabel} limit fail rate for ${testLabel} is ${(Math.abs(delta) * 100).toFixed(1)} pp ${delta > 0 ? 'higher' : 'lower'} than the rest of the wafer`;
}

/** Each rate finding's {@link RateCounts}, kept beside it like {@link findingRegion}
 *  so the published finding is unchanged; read by {@link finalizeProportionFindings}. */
const rateCounts = new WeakMap<RawFinding, RateCounts>();
function withRate(finding: RawFinding, counts: RateCounts): RawFinding {
  rateCounts.set(finding, counts);
  return finding;
}

function regionOfFinding(f: RawFinding): StatsRegion | undefined {
  const keys = (f.highlight as { dieKeys?: string[] }).dieKeys;
  return keys ? findingRegion.get(keys) : undefined;
}

/** `positionKey` of each die — equal exactly when the `getDieKey` strings are. Cached like {@link dieKeysOf}. */
const positionKeysCache = new WeakMap<readonly Die[], Array<number | string>>();
function positionKeysOf(dies: readonly Die[]): Array<number | string> {
  let keys = positionKeysCache.get(dies);
  if (!keys) positionKeysCache.set(dies, keys = dies.map(positionKey));
  return keys;
}

function dieKeysOf(dies: readonly Die[]): string[] {
  let keys = keysCache.get(dies);
  if (!keys) keysCache.set(dies, keys = dies.map(getDieKey));
  return keys;
}

/**
 * Each region's members that are in `dies`. Regions are non-overlapping, so a
 * "rest of the map" comparison is simply the sum of all other buckets. Shared
 * preamble of every regional findings builder. The result is cached: callers
 * read the buckets and never change them.
 */
function bucketDiesByRegion<D extends Die>(dies: readonly D[], regionFamily: StatsRegion[]): Map<string, D[]> {
  let entry = bucketsCache.get(dies);
  if (!entry) bucketsCache.set(dies, entry = { members: new Set(dies), byFamily: new WeakMap() });
  const cached = entry.byFamily.get(regionFamily);
  if (cached) return cached as Map<string, D[]>;

  const { members } = entry;
  const buckets = new Map<string, D[]>();
  for (const region of regionFamily) {
    buckets.set(region.key, region.dies.filter(d => members.has(d)) as D[]);
  }
  entry.byFamily.set(regionFamily, buckets);
  return buckets;
}

/**
 * Shared tail of every proportion-findings builder: BH-adjust the p-values over
 * the family, drop insignificant / small-effect findings, then map the survivors
 * to their severity. Extracted so yield, bin, and functional pass-rate findings
 * can never drift in how significance is applied.
 */
function finalizeProportionFindings(findings: RawFinding[], options: ResolvedOptions): RawFinding[] {
  adjustPValues(findings);
  for (const f of findings) {
    const c = rateCounts.get(f)!;
    recordCandidate(f, twoProportionZ(c.hits, c.n, c.restHits, c.restN), c);
  }
  const significant = findings.filter((finding) => passesRateGate(
    finding.stats.adjustedPValue ?? finding.stats.pValue ?? 1,
    finding.effect.absoluteDelta ?? 0,
    rateRelativeEffect(rateCounts.get(finding)!),
    options));
  return significant
    .filter((finding) => !explainedByOppositeRegions(finding, significant, options))
    .map((finding) => ({
      ...finding,
      severity: severityForFinding(
        finding.stats.adjustedPValue ?? finding.stats.pValue ?? 1,
        finding.effect.absoluteDelta ?? 0,
        rateRelativeEffect(rateCounts.get(finding)!),
      ) }));
}

export function passesRateGate(adjustedP: number, delta: number, relEffect: number, options: ResolvedOptions): boolean {
  return adjustedP <= options.significanceLevel &&
    (Math.abs(delta) >= options.minimumEffectSize || relEffect >= options.minimumRelativeEffect);
}

/**
 * The ids of the `candidates` a spatial pattern explains (`patternExplains`), for
 * its `relatedIds` — the wafer's pattern over the wafer's findings, the lot's
 * over the lot's. `patterns` holds more than one label for a lot row that
 * counts a family together (edge-ring and edge-local wafers).
 *
 * A ring, quadrant or sector row the pattern claims is downgraded to info so it
 * does not count twice towards the badge and `hasNotableFindings`; cluster and
 * edge-arc rows keep their own severity — they carry their own evidence (a
 * p-value, an exact die count) and are supporting detail, not a restatement.
 */
export function claimForPattern<F extends StatsFinding>(
  patterns: PatternLabel[],
  severity: StatsSeverity,
  candidates: readonly F[],
  ringsOf: (f: F) => number[],
  ringCount: number,
): string[] {
  const ids: string[] = [];
  for (const f of candidates) {
    const family = f.comparison.family;
    const rings = family === 'ring' ? ringsOf(f) : [];
    if (!patterns.some(p => patternExplains(p, family, rings, ringCount))) continue;
    ids.push(f.id);
    if (severity !== 'info' && (family === 'ring' || family === 'quadrant' || family === 'sector')) f.severity = 'info';
  }
  return ids;
}

/**
 * A region compared with "the rest of the wafer" looks deviant in the opposite
 * direction whenever the rest contains a stronger deviation: an edge ring rich
 * in bin 2 makes ring 3 look poor in bin 2, though ring 3 matches the core. So a
 * finding opposite to a stronger finding of the same variable and family must
 * still hold when compared with the rest WITHOUT those regions — same test, same
 * Benjamini–Hochberg multiplier, same gates, same direction — or it is dropped.
 */
function explainedByOppositeRegions(finding: RawFinding, significant: RawFinding[], options: ResolvedOptions): boolean {
  const own = rateCounts.get(finding);
  if (!own) return false;
  const rawP = finding.stats.pValue ?? 1;
  let { restHits, restN } = own;
  for (const other of strongerOpposites(finding, significant)) {
    const c = rateCounts.get(other);
    if (!c) continue;
    restHits -= c.hits;
    restN -= c.n;
  }
  if (restN === own.restN) return false;
  if (restN < options.minimumSampleSize) return true;
  const delta = own.hits / own.n - restHits / restN;
  if (Math.sign(delta) !== Math.sign(finding.effect.absoluteDelta ?? 0)) return true;
  const multiplier = rawP > 0 ? (finding.stats.adjustedPValue ?? rawP) / rawP : 1;
  const adjusted = Math.min(1, twoProportionPValue(own.hits, own.n, restHits, restN) * multiplier);
  return !passesRateGate(adjusted, delta, rateRelativeEffect({ ...own, restHits, restN }), options);
}

/** The findings a finding must be re-tested without: significant, same variable
 *  and region family, opposite direction, and stronger (smaller raw p). */
function strongerOpposites(finding: RawFinding, significant: RawFinding[]): RawFinding[] {
  const rawP = finding.stats.pValue ?? 1;
  return significant.filter(other =>
    other !== finding && other.effect.direction !== finding.effect.direction &&
    other.variable.kind === finding.variable.kind && other.variable.bin === finding.variable.bin &&
    other.variable.index === finding.variable.index && other.comparison.family === finding.comparison.family &&
    (other.stats.pValue ?? 1) < rawP);
}

/** A test-value finding's per-region sums, in the builder's shifted space. */
export interface MeanStats { n: number; sum: number; sq: number; restN: number; restSum: number; restSq: number; shift: number }
const meanStats = new WeakMap<RawFinding, MeanStats>();

/** Welch's test of a region's sums against a rest given as sums (one wafer's shifted space). */
export function welchOfSums(own: MeanStats, restN: number, restSum: number, restSq: number): ReturnType<typeof welchFromStats> {
  const variance = (sq: number, sum: number, n: number): number =>
    n > 1 ? Math.max(0, sq - sum * sum / n) / (n - 1) : 0;
  return welchFromStats(
    own.n, own.sum / own.n, variance(own.sq, own.sum, own.n),
    restN, restSum / restN, variance(restSq, restSum, restN));
}

/** {@link explainedByOppositeRegions} for a test-value (Welch) finding. */
function meanExplainedByOppositeRegions(finding: RawFinding, significant: RawFinding[], options: ResolvedOptions): boolean {
  const own = meanStats.get(finding);
  if (!own) return false;
  let { restN, restSum, restSq } = own;
  for (const other of strongerOpposites(finding, significant)) {
    const m = meanStats.get(other);
    if (!m) continue;
    restN -= m.n; restSum -= m.sum; restSq -= m.sq;
  }
  if (restN === own.restN) return false;
  if (restN < options.minimumSampleSize) return true;
  const { pValue, effectSize, delta } = welchOfSums(own, restN, restSum, restSq);
  if (Math.sign(delta) !== Math.sign(finding.effect.absoluteDelta ?? 0)) return true;
  const rawP = finding.stats.pValue ?? 1;
  const multiplier = rawP > 0 ? (finding.stats.adjustedPValue ?? rawP) / rawP : 1;
  return !(Math.min(1, pValue * multiplier) <= options.significanceLevel &&
    Math.abs(effectSize) >= options.minimumEffectSize);
}

function buildYieldFindings(
  eligibleDies: EligibleDie[],
  regionFamily: StatsRegion[],
  passBins: number[],
  options: ResolvedOptions,
): RawFinding[] {
  const passSet = new Set(passBins);
  const buckets = bucketDiesByRegion(eligibleDies, regionFamily);

  // Pre-count pass dies and the hbin-bearing population per bucket. The yield
  // denominator must be dies that HAVE a hard bin — a die eligible only via sbin
  // or test values has no hard-bin pass/fail verdict and must not be counted as a
  // fail (which it would be if the denominator were the full bucket length, since
  // the pass test requires d.hbin). This mirrors the global yield (passDies /
  // dies-with-bin-data) so regional and overall yields use the same population.
  const passCounts = new Map<string, number>();
  const bucketSizes = new Map<string, number>();
  for (const [regionKey, bucket] of buckets) {
    let passes = 0;
    let withHbin = 0;
    for (const d of bucket) {
      if (d.hbin === undefined) continue;
      withHbin++;
      if (passSet.has(d.hbin)) passes++;
    }
    passCounts.set(regionKey, passes);
    bucketSizes.set(regionKey, withHbin);
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

    findings.push(withRate(ofRegion(region, {
      id: `yield:${region.key}`,
      level: 'wafer',
      severity: 'info',
      variable: {
        kind: 'yield',
        label: 'Yield' },
      comparison: {
        family: region.family,
        left: region.label,
        right: comparisonRight(region.family) },
      effect: {
        direction: delta === 0 ? 'different' : delta > 0 ? 'higher' : 'lower',
        absoluteDelta: delta,
        relativeDelta: rightRate === 0 ? undefined : delta / rightRate,
        effectSize: delta },
      stats: {
        method: 'two-proportion-z',
        pValue,
        sampleSizeLeft: leftSize,
        sampleSizeRight: rightSize },
      summary: summarizeYieldFinding(region.label, delta, region.family),
      highlight: {
        kind: 'region',
        regionFamily: region.family,
        regionKeys: [region.key],
        dieKeys: [...region.dieKeys] } }), { hits: leftPass, n: leftSize, restHits: rightPass, restN: rightSize, passRate: true }));
  }

  return finalizeProportionFindings(findings, options);
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
  const bins = [...new Set(
    eligibleDies
      .map(getBin)
      .filter((bin): bin is number => bin !== undefined),
  )].sort((left, right) => left - right);
  const buckets = bucketDiesByRegion(eligibleDies, regionFamily);
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
  // A pass bin's rate is a pass rate, judged like yield (see RateCounts.passRate).
  const passing = binSpace === 'hard' ? new Set(options.passBins) : options.softPassBins ?? binPassSets(eligibleDies, options.passBins).soft;

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

      findings.push(withRate(ofRegion(region, {
        id: `${variableKind}:${bin}:${region.key}`,
        level: 'wafer',
        severity: 'info',
        variable: {
          kind: variableKind,
          bin,
          label: binLabel },
        comparison: {
          family: region.family,
          left: region.label,
          right: comparisonRight(region.family) },
        effect: {
          direction: delta === 0 ? 'different' : delta > 0 ? 'higher' : 'lower',
          absoluteDelta: delta,
          relativeDelta: rightRate === 0 ? undefined : delta / rightRate,
          effectSize: delta },
        stats: {
          method: 'two-proportion-z',
          pValue,
          sampleSizeLeft: leftSize,
          sampleSizeRight: rightSize },
        summary: summarizeBinFinding(region.label, binLabel, delta, region.family),
        highlight: {
          kind: 'bin',
          bin,
          regionKeys: [region.key],
          dieKeys: [...region.dieKeys] } }), { hits: leftHits, n: leftSize, restHits: rightHits, restN: rightSize, passRate: passing.has(bin) }));
    }
  }

  return finalizeProportionFindings(findings, options);
}

/**
 * Regional pass-rate findings for functional (`testType: 'F'`) tests: for each
 * functional test, compare each region's pass rate against the rest of the wafer
 * with the same two-proportion z-test the yield/bin findings use. Verdicts are
 * read via `getTestPassStatus`, so legacy 0/1-encoded functional data is analysed
 * identically. Denominators are dies with a recorded verdict for that test —
 * `minimumSampleSize` gates apply to those counts, not the raw bucket sizes.
 */
function buildFunctionalPassFindings(
  eligibleDies: EligibleDie[],
  regionFamily: StatsRegion[],
  testDefs: TestDef[] | undefined,
  options: ResolvedOptions,
): RawFinding[] {
  const fDefs = (testDefs ?? []).filter(
    (td): td is TestDef & { name: string } =>
      !isParametricTest(td),
  );
  if (!fDefs.length) return [];
  const testNumbers = fDefs.map(td => td.testNumber);
  const buckets = bucketDiesByRegion(eligibleDies, regionFamily);

  // Pre-count per bucket, per functional test: passes and dies-with-verdict.
  const passCounts = new Map<string, Uint32Array>();
  const verdictCounts = new Map<string, Uint32Array>();
  for (const [regionKey, bucket] of buckets) {
    const passes = new Uint32Array(fDefs.length);
    const verdicts = new Uint32Array(fDefs.length);
    for (const d of bucket) {
      for (let i = 0; i < fDefs.length; i++) {
        const status = getTestPassStatus(d, testNumbers[i], fDefs[i]);
        if (status === undefined) continue;
        verdicts[i]++;
        if (status) passes[i]++;
      }
    }
    passCounts.set(regionKey, passes);
    verdictCounts.set(regionKey, verdicts);
  }

  const findings: RawFinding[] = [];

  for (const region of regionFamily) {
    const leftPasses = passCounts.get(region.key)!;
    const leftVerdicts = verdictCounts.get(region.key)!;
    for (let i = 0; i < fDefs.length; i++) {
      let rightPass = 0;
      let rightSize = 0;
      for (const [key, verdicts] of verdictCounts) {
        if (key === region.key) continue;
        rightSize += verdicts[i];
        rightPass += passCounts.get(key)![i];
      }
      const leftSize = leftVerdicts[i];
      const leftPass = leftPasses[i];
      if (leftSize < options.minimumSampleSize || rightSize < options.minimumSampleSize) continue;

      const leftRate = leftPass / leftSize;
      const rightRate = rightPass / rightSize;
      const delta = leftRate - rightRate;
      const pValue = twoProportionPValue(leftPass, leftSize, rightPass, rightSize);
      const testNumber = testNumbers[i];

      findings.push(withRate(ofRegion(region, {
        id: `functional:${testNumber}:${region.key}`,
        level: 'wafer',
        severity: 'info',
        variable: {
          kind: 'functionalTest',
          index: testNumber,
          label: `${markedTestLabel(fDefs[i], testNumber)} pass rate`,
          ...derivedFields(fDefs[i]) },
        comparison: {
          family: region.family,
          left: region.label,
          right: comparisonRight(region.family) },
        effect: {
          direction: delta === 0 ? 'different' : delta > 0 ? 'higher' : 'lower',
          absoluteDelta: delta,
          relativeDelta: rightRate === 0 ? undefined : delta / rightRate,
          effectSize: delta },
        stats: {
          method: 'two-proportion-z',
          pValue,
          sampleSizeLeft: leftSize,
          sampleSizeRight: rightSize },
        summary: summarizeFunctionalFinding(region.label, markedTestLabel(fDefs[i], testNumber), delta, region.family),
        highlight: {
          kind: 'region',
          regionFamily: region.family,
          regionKeys: [region.key],
          dieKeys: [...region.dieKeys] } }), { hits: leftPass, n: leftSize, restHits: rightPass, restN: rightSize, passRate: true }));
    }
  }

  return finalizeProportionFindings(findings, options);
}

function sampleVariance(values: number[], avg: number): number {
  if (values.length < 2) return 0;
  return values.reduce((sum, value) => sum + (value - avg) ** 2, 0) / (values.length - 1);
}

/**
 * Welch two-sample comparison from summary statistics (count, mean, variance).
 * The findings pass accumulates these per region in a single columnar scan, so
 * the comparison never materialises the value arrays — see buildTestValueFindings.
 */
export function welchFromStats(
  leftN: number, leftMean: number, leftVar: number,
  rightN: number, rightMean: number, rightVar: number,
): { pValue: number; effectSize: number; delta: number; z: number } {
  const standardError = Math.sqrt((leftVar / leftN) + (rightVar / rightN));
  const delta = leftMean - rightMean;

  // Zero (or non-finite) standard error means there is no within-group spread to
  // test against — both groups are constant. A constant-vs-constant difference is
  // statistically *unmeasurable*, not infinitely significant: with zero variance
  // the Welch statistic is undefined. Treat it as a non-finding (p = 1, no effect)
  // rather than awarding p = 0 / infinite effect, which previously fired spurious
  // "unusual" findings on uniform or coarsely-quantised test data.
  if (!Number.isFinite(standardError) || standardError === 0) {
    return { pValue: 1, effectSize: 0, delta, z: 0 };
  }

  const z = delta / standardError;
  const pooledSd = Math.sqrt(Math.max(0, ((leftVar + rightVar) / 2)));
  const effectSize = pooledSd === 0 ? delta : delta / pooledSd;
  return {
    pValue: clamp01(2 * (1 - normalCdf(Math.abs(z)))),
    effectSize,
    delta,
    z };
}

/**
 * Array-based Welch comparison — convenience wrapper over welchFromStats for the
 * cold merge/re-aggregation path, which works on arbitrary merged die sets rather
 * than the per-region running sums the columnar findings pass maintains.
 */
function welchPValue(leftValues: number[], rightValues: number[]): { pValue: number; effectSize: number; delta: number } {
  const leftMean = mean(leftValues);
  const rightMean = mean(rightValues);
  return welchFromStats(
    leftValues.length, leftMean, sampleVariance(leftValues, leftMean),
    rightValues.length, rightMean, sampleVariance(rightValues, rightMean),
  );
}

const TEST_COUNT_WARN_THRESHOLD = 250;

/**
 * Discover the test numbers present in the die data, or echo back an explicit
 * caller-supplied subset. Shared by the cheap perTestStats pass and the regional
 * findings pass so the auto-cap behaviour is defined in exactly one place.
 * Stops scanning once the cap is exceeded and returns a warning instead.
 *
 * Functional tests (`testType: 'F'` in `testDefs`) are excluded from the
 * result — both discovered and explicitly requested — because every consumer
 * of this list computes parametric statistics, which are meaningless for a
 * pass/fail outcome. A test number with no matching def counts as parametric.
 */
function discoverTestNumbers(
  dies: Die[],
  explicit: number[] | undefined,
  testDefs: TestDef[] | undefined,
): { testNumbers: number[]; warning?: WaferWarning } {
  const parametricOnly = (numbers: number[]): number[] =>
    numbers.filter(tn => isParametricTest(testDefs?.find(td => td.testNumber === tn)));
  if (explicit) return { testNumbers: parametricOnly(explicit.slice().sort((a, b) => a - b)) };

  // Column by column for built dies, not a key walk per die: this runs once
  // per region family, over every die of the wafer.
  const present = testsPresent(dies, 'values');
  const capped = present.length > TEST_COUNT_WARN_THRESHOLD;

  if (capped) {
    // Deliberately explicit that the OUTCOME is "no test findings at all", not
    // "some tests were skipped". The failure is silent — findings are simply
    // absent — so the message has to say so, since nothing else will.
    const message =
      `Test-value analysis was skipped: more than ${TEST_COUNT_WARN_THRESHOLD} tests were found ` +
      `in the die data, so no test findings were computed. Pass testNumbers: [...] to ` +
      `analyse specific tests.`;
    console.warn(`[wafermap] analyzeWaferMap: ${message}`);
    return {
      testNumbers: [],
      warning: { code: 'test-count-capped', message, severity: 'warning' } };
  }
  return { testNumbers: parametricOnly(present) };
}

/**
 * Regional parametric significance findings: for each test, compare each region's
 * values against the rest of the wafer (Welch).
 *
 * Performance: the previous implementation allocated two value arrays per
 * (region × test) via `.map().filter()` and rebuilt the "rest of wafer" die set
 * per region — O(regions² + regions·tests) allocations that dominated analysis
 * (profiled at ~95% of cost, mostly GC). This version is allocation-light:
 *   • each die is assigned its region index once (regionOf), and
 *   • per test we walk the dies once accumulating running sums (n, Σ, Σ²) per
 *     region plus a family total, over values shifted by a per-test constant for
 *     numerical stability; the "rest of wafer" stats are derived by subtraction
 *     (total − region), never materialised.
 * Welch needs only count/mean/variance, all available from the running sums, so
 * no value arrays are built in the hot path. The region set the comparison sees
 * is the same as the array-based path because the regions are disjoint (each die
 * maps to at most one bucket), so total − region == union of the other regions.
 * Findings match the array path to within floating-point tolerance (the shifted
 * one-pass variance is, if anything, better-conditioned than a raw two-pass sum
 * on large-magnitude data).
 */
function buildTestValueFindings(
  dies: Die[],
  regionFamily: StatsRegion[],
  defs: TestDef[] | undefined,
  options: ResolvedOptions,
): { findings: RawFinding[]; warning?: WaferWarning; activeTestNumbers?: number[] } {
  const discovered = discoverTestNumbers(dies, options.testNumbers, defs);
  if (discovered.warning) return { findings: [], warning: discovered.warning };
  const activeTestNumbers = discovered.testNumbers;

  // Assign each die to its region index once (−1 = not in this family).
  // By position key, from the regions' own dies (parallel to their `dieKeys`).
  const keyToRegion = new Map<number | string, number>();
  for (let r = 0; r < regionFamily.length; r++) {
    for (const key of positionKeysOf(regionFamily[r].dies)) keyToRegion.set(key, r);
  }
  const nRegions = regionFamily.length;
  // Dies that belong to some region in this family, paired with their region idx.
  const regionDies: Die[] = [];
  const regionIdx: number[] = [];
  for (const die of dies) {
    const r = keyToRegion.get(positionKey(die));
    if (r !== undefined) { regionDies.push(die); regionIdx.push(r); }
  }

  const findings: RawFinding[] = [];

  // Per-region accumulators, reused across tests (cleared each test).
  const n   = new Float64Array(nRegions);
  const sum = new Float64Array(nRegions);
  const sq  = new Float64Array(nRegions);

  for (const testNumber of activeTestNumbers) {
    n.fill(0); sum.fill(0); sq.fill(0);
    let totN = 0, totSum = 0, totSq = 0;

    // Accumulate sums of (v − shift) rather than v. Subtracting a constant close
    // to the data leaves variance and the between-region delta unchanged but keeps
    // Σ(v−shift)² well-conditioned, avoiding the catastrophic cancellation of the
    // raw (Σv² − n·mean²) form for large-magnitude / low-variance test values
    // (e.g. voltages ≈1e6 with mV spread). We use the first observed value as the
    // shift — it is O(1), needs no pre-pass, and is guaranteed to be on-scale.
    let shift: number | undefined;
    for (let i = 0; i < regionDies.length; i++) {
      const die = regionDies[i];
      const raw = testValue(die, testNumber);
      if (raw === undefined) continue;
      if (shift === undefined) shift = raw;
      const v = raw - shift;
      const r = regionIdx[i];
      n[r]   += 1;   sum[r] += v;   sq[r] += v * v;
      totN   += 1;   totSum += v;   totSq += v * v;
    }
    if (shift === undefined) continue; // no data for this test

    for (let r = 0; r < nRegions; r++) {
      const leftN  = n[r];
      const rightN = totN - leftN;
      if (leftN < options.minimumSampleSize || rightN < options.minimumSampleSize) continue;

      // Means in shifted space; true means add `shift` back (delta is shift-invariant).
      const leftMeanS  = sum[r] / leftN;
      const rightSum   = totSum - sum[r];
      const rightMeanS = rightSum / rightN;
      const leftMean   = leftMeanS  + shift;
      const rightMean  = rightMeanS + shift;
      // Sample variance from running sums of the shifted data:
      // (Σ(v−k)² − n·meanS²) / (n − 1) — identical to the variance of v.
      const leftVar  = leftN  > 1 ? Math.max(0, (sq[r]          - leftN  * leftMeanS  * leftMeanS )) / (leftN  - 1) : 0;
      const rightVar = rightN > 1 ? Math.max(0, ((totSq - sq[r]) - rightN * rightMeanS * rightMeanS)) / (rightN - 1) : 0;

      const { pValue, effectSize, delta, z } = welchFromStats(leftN, leftMean, leftVar, rightN, rightMean, rightVar);
      const region = regionFamily[r];
      const { label, unit, ...derivation } = labelForTest(testNumber, defs);
      const relativeDelta = rightMean !== 0 ? delta / Math.abs(rightMean) : undefined;

      const finding: RawFinding = ofRegion(region, {
        id: `test:${testNumber}:${region.key}`,
        level: 'wafer',
        severity: 'info',
        variable: {
          kind: 'test',
          index: testNumber,
          label,
          unit,
          ...derivation },
        comparison: {
          family: region.family,
          left: region.label,
          right: comparisonRight(region.family) },
        effect: {
          direction: delta === 0 ? 'different' : delta > 0 ? 'higher' : 'lower',
          absoluteDelta: delta,
          relativeDelta,
          effectSize },
        stats: {
          method: 'welch-z-approx',
          pValue,
          sampleSizeLeft: leftN,
          sampleSizeRight: rightN },
        summary: summarizeTestFinding(region.label, label, delta, relativeDelta, region.family, unit),
        highlight: {
          kind: 'region',
          regionFamily: region.family,
          regionKeys: [region.key],
          dieKeys: [...region.dieKeys] } });
      const stats: MeanStats = { n: leftN, sum: sum[r], sq: sq[r], restN: rightN, restSum: totSum - sum[r], restSq: totSq - sq[r], shift };
      meanStats.set(finding, stats);
      recordCandidate(finding, z, undefined, stats);
      findings.push(finding);
    }
  }

  adjustPValues(findings);
  const significant = findings.filter((finding) => {
    const adjusted = finding.stats.adjustedPValue ?? finding.stats.pValue ?? 1;
    const effectSize = Math.abs(finding.effect.effectSize ?? 0);
    return adjusted <= options.significanceLevel && effectSize >= options.minimumEffectSize;
  });

  return {
    activeTestNumbers,
    findings: significant
      .filter((finding) => !meanExplainedByOppositeRegions(finding, significant, options))
      .map((finding) => ({
        ...finding,
        severity: severityForScore(
          finding.stats.adjustedPValue ?? finding.stats.pValue ?? 1,
          finding.effect.effectSize ?? 0,
        ) })) };
}

function buildSpecLimitFindings(
  dies: Die[],
  regionFamilies: StatsRegion[][],
  testDefs: TestDef[] | undefined,
  options: ResolvedOptions,
): RawFinding[] {
  if (!testDefs?.length) return [];
  const limited = testDefs.filter(td => isParametricTest(td) && (td.limitLow !== undefined || td.limitHigh !== undefined));
  if (!limited.length) return [];

  const allFindings: RawFinding[] = [];

  for (const td of limited) {
    const tn = td.testNumber;

    for (const regionFamily of regionFamilies) {
      const buckets = bucketDiesByRegion(dies, regionFamily);
      const findings: RawFinding[] = [];

      // Each region's dies with a value, and of those the out-of-spec ones, in
      // one read per die; "the rest of the wafer" is the family's total less
      // the region (regions do not overlap). The same counts as filtering the
      // region and the rest separately, which read every die twice per region.
      const counts = new Map<string, { valid: number; fail: number }>();
      let totalValid = 0, totalFail = 0;
      for (const [key, bucket] of buckets) {
        let valid = 0, fail = 0;
        for (const d of bucket) {
          const v = testValue(d, tn);
          if (v === undefined) continue;
          valid++;
          if (isOutOfSpec(classifySpec(v, td))) fail++;
        }
        counts.set(key, { valid, fail });
        totalValid += valid;
        totalFail += fail;
      }

      for (const region of regionFamily) {
        const own = counts.get(region.key)!;
        const leftN = own.valid, rightN = totalValid - own.valid;
        if (leftN < options.minimumSampleSize || rightN < options.minimumSampleSize) continue;

        const leftFail = own.fail;
        const rightFail = totalFail - own.fail;
        const leftRate = leftFail / leftN;
        const rightRate = rightFail / rightN;
        const delta = leftRate - rightRate;
        const pValue = twoProportionPValue(leftFail, leftN, rightFail, rightN);

        findings.push(withRate(ofRegion(region, {
          id: `specLimit:${tn}:${region.key}`,
          level: 'wafer',
          severity: 'info',
          variable: {
            kind: 'test',
            index: tn,
            label: markedTestLabel(td, tn),
            unit: td.unit,
            ...derivedFields(td) },
          comparison: {
            family: region.family,
            left: region.label,
            right: comparisonRight(region.family) },
          effect: {
            direction: delta === 0 ? 'different' : delta > 0 ? 'higher' : 'lower',
            absoluteDelta: delta,
            relativeDelta: rightRate === 0 ? undefined : delta / rightRate,
            effectSize: delta },
          stats: {
            method: 'two-proportion-z',
            pValue,
            sampleSizeLeft: leftN,
            sampleSizeRight: rightN },
          summary: specLimitSummary(region.label, markedTestLabel(td, tn), delta),
          highlight: {
            kind: 'region',
            regionFamily: region.family,
            regionKeys: [region.key],
            dieKeys: [...region.dieKeys] } }), { hits: leftFail, n: leftN, restHits: rightFail, restN: rightN, passRate: false }));
      }

      allFindings.push(...finalizeProportionFindings(findings, options));
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
  /** Positions of the dies each region family covers. A region is compared with
   *  the rest of ITS family (sectors leave out the centre dies), so a merged
   *  run's rest is the family's dies outside the run, not every die. */
  regionDies: Record<'ring' | 'quadrant' | 'sector', ReadonlySet<number | string>>;
  hbinDefs?: BinDef[];
  sbinDefs?: BinDef[];
  testDefs?: TestDef[];
}

/** The die pool the original builder used for a finding of this kind. */
function poolOf(kind: RawFinding['variable']['kind'], ctx: MergeContext): readonly Die[] {
  return kind === 'softBin' ? ctx.softEligibleDies
    : kind === 'test' ? ctx.testDies
    : ctx.eligibleDies;
}

/** A test's limit fail rate, as opposed to its mean: both are `variable.kind` 'test'. */
function isLimitFail(f: RawFinding): boolean {
  return f.id.startsWith('specLimit:');
}

/** Region keys this finding covers (e.g. `["ring:1","ring:2"]`); empty for non-region targets. */
function regionKeysOf(f: RawFinding): string[] {
  return (f.highlight as { regionKeys?: string[] }).regionKeys ?? [];
}

/**
 * Group key for findings that describe the same signal in different regions. The
 * metric is part of it (the id's first segment): a test's mean and its limit fail
 * rate share a variable kind and index, and one region's two findings in a group
 * split a run of adjacent regions in two.
 */
function mergeGroupKey(f: RawFinding): string {
  const variableKey = f.variable.bin ?? f.variable.index ?? '';
  return `${f.comparison.family}\0${metricOf(f)}\0${f.variable.kind}\0${variableKey}\0${f.effect.direction}`;
}

/** Order of a ring or sector region within its family, so contiguous-run detection is linear. */
function regionOrderIndex(key: string, sectorCount: number): number {
  const parsed = parseRegionKey(key);
  if (parsed.family === 'ring') return parsed.ring ?? 0;
  if (parsed.family === 'sector') {
    const names = sectorCompassNames(sectorCount);
    return names.indexOf(parsed.sector ?? '');
  }
  return 0;
}

/**
 * A connected set of quadrants in reading order round the wafer, starting after
 * a gap when there is one ("NW, SW & SE", not whatever order the search met
 * them in). All four quadrants have no gap and start at the north-east.
 */
export function inQuadrantOrder(quadrants: string[]): string[] {
  const present = new Set(quadrants);
  const start = QUADRANT_CYCLE.findIndex((q, i) => present.has(q) && !present.has(QUADRANT_CYCLE[(i + 3) % 4]));
  const from = start < 0 ? 0 : start;
  return Array.from({ length: 4 }, (_, i) => QUADRANT_CYCLE[(from + i) % 4]).filter(q => present.has(q));
}

/**
 * Partition a same-signal group into maximal runs of spatially adjacent regions.
 * Singletons (no adjacent same-signal neighbour) come back as length-1 runs.
 */
export function findContiguousRuns<T>(group: T[], family: string, sectorCount: number, keyOf: (item: T) => string): T[][] {
  if (family === 'quadrant') {
    // Connected components in the quadrant adjacency graph.
    const byQuadrant = new Map<string, T>();
    for (const item of group) {
      const q = parseRegionKey(keyOf(item)).quadrant;
      if (q) byQuadrant.set(q, item);
    }
    const quadrants = [...byQuadrant.keys()];
    const seen = new Set<string>();
    const runs: T[][] = [];
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
      runs.push(inQuadrantOrder(component).map(q => byQuadrant.get(q)!));
    }
    return runs;
  }

  // Ring (linear) and sector (cyclic) — sort by order index, then split where the
  // index gap exceeds 1. For sectors, also stitch the wrap-around (last↔first).
  const orderOf = (item: T) => regionOrderIndex(keyOf(item), sectorCount);
  const sorted = [...group].sort((a, b) => orderOf(a) - orderOf(b));
  const runs: T[][] = [];
  let current: T[] = [];
  for (const f of sorted) {
    if (current.length === 0) {
      current.push(f);
      continue;
    }
    const prev = orderOf(current[current.length - 1]);
    const next = orderOf(f);
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
    const firstIdx = orderOf(runs[0][0]);
    const lastIdx = orderOf(runs[runs.length - 1][runs[runs.length - 1].length - 1]);
    if (firstIdx === 0 && lastIdx === n - 1) {
      const last = runs.pop()!;
      runs[0] = [...last, ...runs[0]];
    }
  }

  return runs;
}

/** The label of a run of adjacent regions, from their region keys in run order. */
export function mergedRegionLabel(family: string, keys: string[], ringCount: number): string {
  if (family === 'ring') {
    const rings = keys
      .map(k => parseRegionKey(k).ring)
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
  if (family === 'sector') {
    // A contiguous arc, first to last.
    const sectors = keys.map(k => parseRegionKey(k).sector ?? '');
    return sectors.length === 1 ? `Sector ${sectors[0]}` : `Sectors ${sectors[0]}–${sectors[sectors.length - 1]}`;
  }
  // Quadrants, e.g. "Quadrants NW, SW & SE".
  const quads = keys.map(k => parseRegionKey(k).quadrant ?? '');
  if (quads.length === 1) return quads[0];
  if (quads.length === 2) return `Quadrants ${quads[0]} & ${quads[1]}`;
  return `Quadrants ${quads.slice(0, -1).join(', ')} & ${quads[quads.length - 1]}`;
}

function uniqueKeys(arr: string[]): string[] {
  return [...new Set(arr)];
}

/**
 * The Benjamini–Hochberg multiplier (adjusted p over raw p) of the weakest finding
 * in a merged run. A merged finding is graded on its own p-value times this, so a
 * run is judged no more leniently than its parts. Wafer and lot merges both use it.
 */
export function weakestMultiplier(run: readonly RawFinding[]): number {
  return Math.max(...run.map(f => {
    const raw = f.stats.pValue ?? 1;
    return raw > 0 ? (f.stats.adjustedPValue ?? raw) / raw : 1;
  }));
}

function gradedP(pValue: number, multiplier: number): number {
  return Math.min(1, pValue * multiplier);
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

  const unionRegionKeys = uniqueKeys(run.flatMap(regionKeysOf));
  // The union of the run's die keys, first occurrence first, and the test for
  // "is this pool die in the union". From the regions' dies by position key
  // when every finding came from one region (always, for the builders above);
  // otherwise from the key strings. Both give the same keys and the same test.
  let unionDieKeys: string[];
  let inUnion: (poolIndex: number) => boolean;
  const regions = run.map(regionOfFinding);
  if (regions.every((r): r is StatsRegion => r !== undefined)) {
    const union = new Set<number | string>();
    unionDieKeys = [];
    for (const region of regions) {
      const keys = positionKeysOf(region.dies);
      for (let i = 0; i < keys.length; i++) {
        if (union.has(keys[i])) continue;
        union.add(keys[i]);
        unionDieKeys.push(region.dieKeys[i]);
      }
    }
    const poolPositions = positionKeysOf(poolOf(template.variable.kind, ctx));
    inUnion = (i) => union.has(poolPositions[i]);
  } else {
    unionDieKeys = uniqueKeys(run.flatMap(f => (f.highlight as { dieKeys?: string[] }).dieKeys ?? []));
    const leftKeySet = new Set(unionDieKeys);
    const poolKeys = dieKeysOf(poolOf(template.variable.kind, ctx));
    inUnion = (i) => leftKeySet.has(poolKeys[i]);
  }

  const label = mergedRegionLabel(family, run.map(f => regionKeysOf(f)[0] ?? ''), ctx.ringCount);

  const pool = poolOf(kind, ctx);
  const familyDies = ctx.regionDies[family as 'ring' | 'quadrant' | 'sector'];
  const poolPositions = positionKeysOf(pool);
  const leftDies: Die[] = [];
  const rightDies: Die[] = [];
  for (let i = 0; i < pool.length; i++) {
    if (!familyDies.has(poolPositions[i])) continue;
    (inUnion(i) ? leftDies : rightDies).push(pool[i]);
  }

  const multiplier = weakestMultiplier(run);
  let effect: RawFinding['effect'];
  let stats: RawFinding['stats'];
  let severity: StatsSeverity;
  let summary: string;
  let idMetric: string;

  if (isLimitFail(template)) {
    // The limit fail rate, recomputed over the merged region exactly as
    // `buildSpecLimitFindings` computes it per region: dies with a value, of those
    // the out-of-spec ones, against the rest of the wafer.
    const testNumber = template.variable.index!;
    const def = ctx.testDefs?.find(d => d.testNumber === testNumber);
    const count = (dies: Die[]) => {
      let valid = 0, fail = 0;
      for (const d of dies) {
        const v = testValue(d, testNumber);
        if (v === undefined) continue;
        valid++;
        if (def && isOutOfSpec(classifySpec(v, def))) fail++;
      }
      return { valid, fail };
    };
    const left = count(leftDies), right = count(rightDies);
    const leftRate = left.valid > 0 ? left.fail / left.valid : 0;
    const rightRate = right.valid > 0 ? right.fail / right.valid : 0;
    const delta = leftRate - rightRate;
    const pValue = twoProportionPValue(left.fail, left.valid, right.fail, right.valid);
    effect = {
      direction: delta === 0 ? 'different' : delta > 0 ? 'higher' : 'lower',
      absoluteDelta: delta,
      relativeDelta: rightRate === 0 ? undefined : delta / rightRate,
      effectSize: delta };
    stats = { method: 'two-proportion-z', pValue, sampleSizeLeft: left.valid, sampleSizeRight: right.valid };
    const graded = gradedP(pValue, multiplier);
    severity = severityForFinding(graded, delta,
      rateRelativeEffect({ hits: left.fail, n: left.valid, restHits: right.fail, restN: right.valid, passRate: false }));
    summary = specLimitSummary(label, markedTestLabel(def, testNumber), delta);
    idMetric = `specLimit:${testNumber}`;
  } else if (kind === 'test') {
    const testNumber = template.variable.index!;
    const read = (d: Die) => testValue(d, testNumber);
    const leftValues = leftDies.map(read).filter((v): v is number => v !== undefined);
    const rightValues = rightDies.map(read).filter((v): v is number => v !== undefined);
    const { pValue, effectSize, delta } = welchPValue(leftValues, rightValues);
    const rightMean = mean(rightValues);
    const relativeDelta = rightMean !== 0 ? delta / Math.abs(rightMean) : undefined;
    effect = {
      direction: delta === 0 ? 'different' : delta > 0 ? 'higher' : 'lower',
      absoluteDelta: delta,
      relativeDelta,
      effectSize };
    stats = { method: 'welch-z-approx', pValue, sampleSizeLeft: leftValues.length, sampleSizeRight: rightValues.length };
    const graded = gradedP(pValue, multiplier);
    severity = severityForScore(graded, effectSize);
    summary = summarizeTestFinding(label, template.variable.label, delta, relativeDelta, family, template.variable.unit);
    idMetric = `test:${testNumber}`;
  } else if (kind === 'yield') {
    const passSet = new Set(ctx.passBins);
    // Denominator is the hbin-bearing population only (see buildYieldFindings):
    // dies without a hard bin have no pass/fail verdict and must not deflate yield.
    const leftHbin = leftDies.filter(d => d.hbin !== undefined);
    const rightHbin = rightDies.filter(d => d.hbin !== undefined);
    const leftN = leftHbin.length;
    const rightN = rightHbin.length;
    const leftPass = leftHbin.filter(d => passSet.has(d.hbin!)).length;
    const rightPass = rightHbin.filter(d => passSet.has(d.hbin!)).length;
    const leftRate = leftN > 0 ? leftPass / leftN : 0;
    const rightRate = rightN > 0 ? rightPass / rightN : 0;
    const delta = leftRate - rightRate;
    const pValue = twoProportionPValue(leftPass, leftN, rightPass, rightN);
    effect = {
      direction: delta === 0 ? 'different' : delta > 0 ? 'higher' : 'lower',
      absoluteDelta: delta,
      relativeDelta: rightRate === 0 ? undefined : delta / rightRate,
      effectSize: delta };
    stats = { method: 'two-proportion-z', pValue, sampleSizeLeft: leftN, sampleSizeRight: rightN };
    const graded = gradedP(pValue, multiplier);
    severity = severityForFinding(graded, delta,
      rateRelativeEffect({ hits: leftPass, n: leftN, restHits: rightPass, restN: rightN, passRate: true }));
    summary = summarizeYieldFinding(label, delta, family);
    idMetric = 'yield';
  } else if (kind === 'functionalTest') {
    // A functional pass rate, recomputed over the merged region exactly as
    // `buildFunctionalTestFindings` computes it per region: verdicts through
    // `getTestPassStatus`, dies without a verdict excluded from both sides.
    //
    // This branch did not exist until 0.30.3. A functional run fell through to
    // the bin branch below, which counted dies whose hard bin equalled
    // `variable.bin` — undefined for a functional finding — so every side
    // counted 0, the merged finding reported a 0.0 pp difference as
    // "HBin undefined occurrence", and it REPLACED the correct per-ring
    // findings it merged. A real functional signal spanning adjacent rings was
    // reported as no difference at all.
    const testNumber = template.variable.index!;
    const def = ctx.testDefs?.find(d => d.testNumber === testNumber);
    let leftPass = 0, leftN = 0, rightPass = 0, rightN = 0;
    for (const d of leftDies) {
      const s = getTestPassStatus(d, testNumber, def);
      if (s === undefined) continue;
      leftN++; if (s) leftPass++;
    }
    for (const d of rightDies) {
      const s = getTestPassStatus(d, testNumber, def);
      if (s === undefined) continue;
      rightN++; if (s) rightPass++;
    }
    const leftRate = leftN > 0 ? leftPass / leftN : 0;
    const rightRate = rightN > 0 ? rightPass / rightN : 0;
    const delta = leftRate - rightRate;
    const pValue = twoProportionPValue(leftPass, leftN, rightPass, rightN);
    effect = {
      direction: delta === 0 ? 'different' : delta > 0 ? 'higher' : 'lower',
      absoluteDelta: delta,
      relativeDelta: rightRate === 0 ? undefined : delta / rightRate,
      effectSize: delta };
    stats = { method: 'two-proportion-z', pValue, sampleSizeLeft: leftN, sampleSizeRight: rightN };
    const graded = gradedP(pValue, multiplier);
    severity = severityForFinding(graded, delta,
      rateRelativeEffect({ hits: leftPass, n: leftN, restHits: rightPass, restN: rightN, passRate: true }));
    summary = summarizeFunctionalFinding(label, markedTestLabel(def, testNumber), delta, family);
    idMetric = `functional:${testNumber}`;
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
      effectSize: delta };
    stats = { method: 'two-proportion-z', pValue, sampleSizeLeft: leftDies.length, sampleSizeRight: rightDies.length };
    const graded = gradedP(pValue, multiplier);
    severity = severityForFinding(graded, delta,
      rateRelativeEffect({ hits: leftHit, n: leftDies.length, restHits: rightHit, restN: rightDies.length, passRate: false }));
    const defs = kind === 'softBin' ? ctx.sbinDefs : ctx.hbinDefs;
    summary = summarizeBinFinding(label, labelForBin(bin, defs, kind === 'softBin' ? 'SBin' : 'HBin'), delta, family);
    idMetric = `${kind}:${bin}`;
  }

  stats = { ...stats, adjustedPValue: gradedP(stats.pValue ?? 1, multiplier) };

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
    relatedIds: run.map(f => f.id) };
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
    for (const run of findContiguousRuns(group, family, ctx.sectorCount, f => regionKeysOf(f)[0] ?? '')) {
      merged.push(run.length === 1 ? run[0] : buildMergedFinding(run, ctx));
    }
  }

  return [...passthrough, ...merged];
}

// ─────────────────────────────────────────────────────────────────────────────
// Redundancy collapse.
//
// The same physical phenomenon is legitimately detected by several independent
// passes, and the findings list then restates one fact many times. On a wafer
// with an edge failure the list can read:
//
//   Hard bin 1  -22.2 pp   Soft bin 1  -22.2 pp   Yield  -22.2 pp
//   Hard bin 2   +8.1 pp   Soft bin 2   +8.1 pp
//   Hard bin 3   +8.8 pp   Soft bin 3   +8.8 pp
//
// — seven rows for what an engineer would state in one sentence. Two exact
// redundancies are responsible, and both are collapsed here by CLAIMING the
// duplicate via `relatedIds` rather than deleting it: the panel and the report
// hide claimed findings, while `filterFindings` and any host reading
// `summary.findings` still see every finding individually. Nothing is lost.
//
// The merge conditions are deliberately structural, never "the numbers look the
// same":
//
//  1. Hard/soft twins. Hard and soft bins are INDEPENDENT number spaces — "hard
//     bin 3" and "soft bin 3" usually mean different things, and merging on the
//     bin number would conflate two unrelated populations. They are merged only
//     when the die sets are provably identical, computed from the dies.
//
//  2. Pass bin ≡ yield. When exactly one pass bin is configured, "hard bin 1
//     occurrence is 22.2 pp lower" and "yield is 22.2 pp lower" are the same
//     statement by definition. With several pass bins no single bin finding
//     equals yield, so the rule correctly does not fire.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Hard/soft bin pairs whose die sets are exactly equal, as `"h:s"` keys.
 * Only such pairs may be presented as one finding.
 */
function coincidentBinPairs(dies: EligibleDie[]): Set<string> {
  // Position keys, not `getDieKey` strings: equal exactly when the strings are,
  // so the sets compare the same, without a string per die.
  const hard = new Map<number, Set<number | string>>();
  const soft = new Map<number, Set<number | string>>();
  for (const d of dies) {
    const key = positionKey(d);
    if (d.hbin !== undefined && d.hbin !== null) {
      (hard.get(d.hbin) ?? hard.set(d.hbin, new Set()).get(d.hbin)!).add(key);
    }
    if (d.sbin !== undefined && d.sbin !== null) {
      (soft.get(d.sbin) ?? soft.set(d.sbin, new Set()).get(d.sbin)!).add(key);
    }
  }
  const out = new Set<string>();
  for (const [h, hKeys] of hard) {
    for (const [sb, sKeys] of soft) {
      if (hKeys.size !== sKeys.size) continue;
      let same = true;
      for (const k of hKeys) if (!sKeys.has(k)) { same = false; break; }
      if (same) out.add(`${h}:${sb}`);
    }
  }
  return out;
}

/**
 * The soft bin whose rate IS the yield: the one soft bin every passing die
 * carries and no failing die does. Pass/fail is `diePassStatus`, the rule yield
 * uses; `undefined` when passing dies are split across soft bins or lack one.
 */
function soleYieldSoftBin(dies: EligibleDie[], passBins: number[]): number | undefined {
  const passSet = new Set(passBins);
  let bin: number | undefined;
  for (const d of dies) {
    const passes = diePassStatus(d, passSet);
    if (passes === undefined) continue;
    if (passes) {
      if (d.sbin == null || (bin !== undefined && d.sbin !== bin)) return undefined;
      bin = d.sbin;
    }
  }
  if (bin === undefined) return undefined;
  for (const d of dies) if (d.sbin === bin && diePassStatus(d, passSet) !== true) return undefined;
  return bin;
}

/** Region identity for redundancy purposes: same family, same region label. */
function regionKeyOf(f: RawFinding): string {
  return `${f.comparison.family}\u0000${f.comparison.left}`;
}

/** What {@link collapseRedundantFindings} needs to know about a wafer's dies. */
export interface RedundancyFacts {
  /** `"hard:soft"` bin pairs carried by exactly the same dies. */
  coincident: Set<string>;
  /** The soft bin whose rate is the yield, if one is. */
  yieldSoftBin: number | undefined;
  passBins: number[];
  /** How the sectors divide the wafer, for comparing a sector run with a quadrant. */
  sectorCount: number;
}
export function redundancyFacts(eligibleDies: EligibleDie[], passBins: number[], sectorCount: number): RedundancyFacts {
  return { coincident: coincidentBinPairs(eligibleDies), yieldSoftBin: soleYieldSoftBin(eligibleDies, passBins), passBins, sectorCount };
}

/** A sector run and a quadrant this much alike in extent (overlap over union) are one region to a reader. */
const SAME_REGION_OVERLAP = 3 / 5;

/** The metric a finding reports, from its id: `test`, `specLimit`, `yield`, … — a lot finding's id carries it after `lot-region:`. */
function metricOf(f: RawFinding): string {
  return /^(?:lot-region:)?([^:|]+)/.exec(f.id)?.[1] ?? f.id;
}

/** The region keys a finding covers: a wafer finding's own, a lot finding's from its id (`…|sector:E-NE-N`). */
function regionKeysOfFinding(f: RawFinding): string[] {
  const own = regionKeysOf(f);
  if (own.length) return own;
  const m = /(ring|sector|quadrant):([^:|]+)$/.exec(f.id);
  return m ? m[2].split('-').map(name => `${m[1]}:${name}`) : [];
}

function angleBinsOfFinding(f: RawFinding, sectorCount: number): Set<number> | undefined {
  const bins = new Set<number>();
  for (const key of regionKeysOfFinding(f)) {
    const part = regionAngleBins(key, sectorCount);
    if (!part) return undefined;
    for (const b of part) bins.add(b);
  }
  return bins.size ? bins : undefined;
}

export function collapseRedundantFindings(findings: RawFinding[], facts: RedundancyFacts): void {
  const { coincident, yieldSoftBin, passBins } = facts;
  // `absorbedIds`, not `relatedIds`: the latter already means two things —
  // a run-merge's audit trail of constituents it REPLACED (which no longer
  // exist) and a spatial pattern's supporting detail. Everything absorbed here
  // is still live and readable, so it needs a field that says so.
  const claim = (owner: RawFinding, claimed: RawFinding): void => {
    owner.absorbedIds = [...(owner.absorbedIds ?? []), claimed.id];
  };

  const byRegion = new Map<string, RawFinding[]>();
  for (const f of findings) {
    const k = regionKeyOf(f);
    (byRegion.get(k) ?? byRegion.set(k, []).get(k)!).push(f);
  }

  const alreadyClaimed = new Set<string>();

  for (const group of byRegion.values()) {
    // ── 1. Hard/soft twins ──────────────────────────────────────────────────
    for (const hardF of group) {
      if (hardF.variable.kind !== 'hardBin' || hardF.variable.bin === undefined) continue;
      for (const softF of group) {
        if (softF.variable.kind !== 'softBin' || softF.variable.bin === undefined) continue;
        if (alreadyClaimed.has(softF.id)) continue;
        if (!coincident.has(`${hardF.variable.bin}:${softF.variable.bin}`)) continue;
        // Same dies AND the same statement about them.
        if (softF.effect.direction !== hardF.effect.direction) continue;

        claim(hardF, softF);
        alreadyClaimed.add(softF.id);

        // Name BOTH bins, rather than silently showing only the hard-bin row:
        // an engineer who filters on soft bins must not conclude the soft
        // finding was never raised. "(same dies)" is load-bearing — without it
        // "hard bin 3 and soft bin 3" could be read as two populations summed.
        //
        // Built from the findings' own labels in the internal `HBin N`/`SBin N`
        // vocabulary so `plainBinTerms` expands them to "hard bin"/"soft bin"
        // on every display surface, exactly as it does for unmerged findings.
        //
        // When the two bins share a number AND a name — overwhelmingly the common
        // case, since a hard/soft twin is only merged when they cover the same dies
        // — the bin term is factored out instead of printed twice. The old form
        // rendered as "hard bin 3 (Fail (multi)) and soft bin 3 (Fail (multi))
        // (same dies)": three nested parentheses restating one fact, in a sentence
        // whose job is to make a statistical claim legible.
        const hardTail = hardF.variable.label.replace(/^HBin\s+/, '');
        const softTail = softF.variable.label.replace(/^SBin\s+/, '');
        const both = hardTail === softTail
          ? `HBin and SBin ${hardTail} (same dies)`
          : `${hardF.variable.label} and ${softF.variable.label} (same dies)`;
        // Replace the bin term inside the sentence rather than anchoring at the
        // start: the summary reads "<region> has <binLabel> occurrence …", so
        // the bin term is mid-string.
        hardF.summary = hardF.summary.replace(hardF.variable.label, both);
        hardF.variable.label = both;
        break;
      }
    }

    // ── 2. Pass bin ≡ yield ─────────────────────────────────────────────────
    const yieldF = group.find(f => f.variable.kind === 'yield');
    if (!yieldF) continue;
    for (const f of group) {
      if (f === yieldF || alreadyClaimed.has(f.id)) continue;
      const isPassBinRow =
        (f.variable.kind === 'hardBin' && passBins.length === 1 && f.variable.bin === passBins[0]) ||
        (f.variable.kind === 'softBin' && f.variable.bin === yieldSoftBin);
      if (!isPassBinRow) continue;
      claim(yieldF, f);
      alreadyClaimed.add(f.id);
      // Anything the pass-bin row had already absorbed moves across too, so a
      // claimed finding is never orphaned behind a claimed claimer.
      for (const id of f.absorbedIds ?? []) {
        yieldF.absorbedIds = [...(yieldF.absorbedIds ?? []), id];
      }
    }
  }

  // ── 3. A sector run and a quadrant over the same part of the wafer ────────
  // "Sectors W–S" and "Quadrant SW" make one statement about one part of the
  // wafer, in two region vocabularies, and the region merge runs within a family
  // only. They are one finding when they are the same comparison (metric,
  // variable, direction) and cover the same angles — overlap over union of at
  // least 3/5, by geometry, never because the figures look alike. The one with
  // the smaller p-value is kept (the sector run on a tie: it shows the extent).
  const sameComparison = new Map<string, RawFinding[]>();
  for (const f of findings) {
    if (alreadyClaimed.has(f.id) || (f.comparison.family !== 'sector' && f.comparison.family !== 'quadrant')) continue;
    const key = [metricOf(f), f.variable.kind, f.variable.bin ?? '', f.variable.index ?? '', f.effect.direction].join('\0');
    (sameComparison.get(key) ?? sameComparison.set(key, []).get(key)!).push(f);
  }
  for (const group of sameComparison.values()) {
    const pairs: { sector: RawFinding; quadrant: RawFinding; overlap: number }[] = [];
    for (const sector of group.filter(f => f.comparison.family === 'sector')) {
      const a = angleBinsOfFinding(sector, facts.sectorCount);
      if (!a) continue;
      for (const quadrant of group.filter(f => f.comparison.family === 'quadrant')) {
        const b = angleBinsOfFinding(quadrant, facts.sectorCount);
        if (!b) continue;
        let both = 0;
        for (const bin of a) if (b.has(bin)) both++;
        const union = a.size + b.size - both;
        if (both / union >= SAME_REGION_OVERLAP - 1e-9) pairs.push({ sector, quadrant, overlap: both / union });
      }
    }
    pairs.sort((x, y) => y.overlap - x.overlap);
    for (const { sector, quadrant } of pairs) {
      if (alreadyClaimed.has(sector.id) || alreadyClaimed.has(quadrant.id)) continue;
      const keepQuadrant = (quadrant.stats.pValue ?? 1) < (sector.stats.pValue ?? 1);
      const [owner, claimed] = keepQuadrant ? [quadrant, sector] : [sector, quadrant];
      claim(owner, claimed);
      alreadyClaimed.add(claimed.id);
      owner.absorbedIds = [...(owner.absorbedIds ?? []), ...(claimed.absorbedIds ?? [])];
    }
  }
}

export function analyzeWaferMap(
  input: AnalyzeWaferMapInput,
  options: AnalyzeWaferMapOptions = {},
): StatsSummary {
  const outer = collecting, outerFacts = collectedFacts;
  const mine: RegionCandidate[] = [];
  collecting = mine;
  collectedFacts = undefined;
  try {
    const summary = analyzeWaferMapUncollected(input, options);
    regionCandidates.set(summary, { candidates: mine, facts: collectedFacts });
    return summary;
  } finally {
    collecting = outer;
    collectedFacts = outerFacts;
  }
}

function analyzeWaferMapUncollected(
  input: AnalyzeWaferMapInput,
  options: AnalyzeWaferMapOptions,
): StatsSummary {
  const { resolved: optionResolved, warnings: optionWarnings } = resolveOptions(options);
  const result = normalizeInput(input);
  // Pass bins come from the result — the ones `result.yield` was computed with.
  // There is no analysis option to contradict them (removed: a second place to
  // set pass bins is how every surface came to judge by `[1]`). Assigned
  // unconditionally, so an untyped caller still passing the removed option
  // cannot override them through the options spread above. DEFAULT_OPTIONS'
  // `[1]` only reaches a hand-built result that carries none.
  const baseResolved: ResolvedOptions = { ...optionResolved, passBins: result.passBins ?? DEFAULT_OPTIONS.passBins,
    // Ring count likewise: set once on buildWaferMap, so ring boundaries on the map
    // and ring findings here cannot describe different rings.
    ringCount: result.ringCount ?? DEFAULT_OPTIONS.ringCount };
  const isLotStack  = result.isLotStack;
  const stackMethod = result.aggrMethod;
  const hasHbinData = !isLotStack ||
    stackMethod === 'mode' || stackMethod === 'countBin' || stackMethod === 'percent';
  const eligibleDies = result.dies.filter((die): die is EligibleDie => isEligibleDie(die));
  // Cluster/pattern detection are spatial (physX/physY-based flood-fill and
  // shape features) — an unpositioned die can't belong to a spatial cluster
  // or contribute to a spatial pattern, so both take this instead of
  // eligibleDies directly.
  const positionedEligibleDies = eligibleDies.filter(isPositionedDie);
  const resolved = adaptOptions(baseResolved, eligibleDies.length);
  resolved.softPassBins = binPassSets(eligibleDies, resolved.passBins).soft;
  const includedDies = result.dies.filter((die) => isYieldEligibleDie(die));
  // Ring/quadrant/reticle-position/sector are spatial — an unpositioned die
  // has no ring/quadrant/etc. by definition, so it's excluded from every one
  // of these region families. buildTestSiteRegions is deliberately exempt
  // (keyed by siteNum, not coordinates) and stays on the full includedDies.
  // isPositionedDie narrows physX/physY alongside x/y, so this filter produces
  // the PositionedDie[] the region builders require without a cast.
  const positionedIncludedDies = includedDies.filter(isPositionedDie);
  const ringRegions = buildRingRegions(positionedIncludedDies, result.wafer, resolved.ringCount);
  const quadrantRegions = buildQuadrantRegions(positionedIncludedDies, result.wafer, resolved.ringCount);
  const reticlePositionRegions = buildReticlePositionRegions(positionedIncludedDies, result.reticleConfig);
  // Test-site regions exist only when the wafer has meaningful site duplication —
  // buildTestSiteRegions' own guard decides.
  const testSiteRegions = buildTestSiteRegions(includedDies, false);
  const sectorRegions = buildSectorRegions(positionedIncludedDies, result.wafer, resolved.sectorCount);

  const findings: RawFinding[] = [];
  if (hasHbinData) {
    findings.push(
      ...buildYieldFindings(eligibleDies, ringRegions, resolved.passBins, resolved),
      ...buildYieldFindings(eligibleDies, quadrantRegions, resolved.passBins, resolved),
      ...buildYieldFindings(eligibleDies, reticlePositionRegions, resolved.passBins, resolved),
      ...buildYieldFindings(eligibleDies, testSiteRegions, resolved.passBins, resolved),
      ...buildYieldFindings(eligibleDies, sectorRegions, resolved.passBins, resolved),
    );
  }
  if (hasHbinData) {
    findings.push(
      ...buildBinFindings(eligibleDies, ringRegions, 'hard', result.hbinDefs, 'hardBin', resolved),
      ...buildBinFindings(eligibleDies, quadrantRegions, 'hard', result.hbinDefs, 'hardBin', resolved),
      ...buildBinFindings(eligibleDies, reticlePositionRegions, 'hard', result.hbinDefs, 'hardBin', resolved),
      ...buildBinFindings(eligibleDies, testSiteRegions, 'hard', result.hbinDefs, 'hardBin', resolved),
      ...buildBinFindings(eligibleDies, sectorRegions, 'hard', result.hbinDefs, 'hardBin', resolved),
    );
  }
  {
    const softEligibleDies = eligibleDies.filter((die): die is EligibleDie => die.sbin !== undefined);
    findings.push(
      ...buildBinFindings(softEligibleDies, ringRegions, 'soft', result.sbinDefs, 'softBin', resolved),
      ...buildBinFindings(softEligibleDies, quadrantRegions, 'soft', result.sbinDefs, 'softBin', resolved),
      ...buildBinFindings(softEligibleDies, reticlePositionRegions, 'soft', result.sbinDefs, 'softBin', resolved),
      ...buildBinFindings(softEligibleDies, testSiteRegions, 'soft', result.sbinDefs, 'softBin', resolved),
      ...buildBinFindings(softEligibleDies, sectorRegions, 'soft', result.sbinDefs, 'softBin', resolved),
    );
  }
  const warnings: WaferWarning[] = [...optionWarnings];
  let activeTestNumbers: number[] | undefined;
  if (resolved.enableTestValueAnalysis) {
    const ring     = buildTestValueFindings(eligibleDies, ringRegions, result.testDefs, resolved);
    // ── set below; the cheap perTestStats pass reuses ring.activeTestNumbers ──
    const quad     = buildTestValueFindings(eligibleDies, quadrantRegions, result.testDefs, resolved);
    const reticle  = buildTestValueFindings(eligibleDies, reticlePositionRegions, result.testDefs, resolved);
    const testSite = buildTestValueFindings(eligibleDies, testSiteRegions, result.testDefs, resolved);
    const sector   = buildTestValueFindings(eligibleDies, sectorRegions, result.testDefs, resolved);
    findings.push(...ring.findings, ...quad.findings, ...reticle.findings, ...testSite.findings, ...sector.findings);
    if (ring.warning) warnings.push(ring.warning);
    activeTestNumbers = ring.activeTestNumbers;

    findings.push(...buildSpecLimitFindings(
      eligibleDies,
      [ringRegions, quadrantRegions, reticlePositionRegions, testSiteRegions, sectorRegions],
      result.testDefs,
      resolved,
    ));

    // Functional tests get pass-rate findings (two-proportion, like yield/bin)
    // instead of the parametric Welch comparisons above, from which they are
    // excluded. No-op unless a functional testDef exists.
    findings.push(
      ...buildFunctionalPassFindings(eligibleDies, ringRegions, result.testDefs, resolved),
      ...buildFunctionalPassFindings(eligibleDies, quadrantRegions, result.testDefs, resolved),
      ...buildFunctionalPassFindings(eligibleDies, reticlePositionRegions, result.testDefs, resolved),
      ...buildFunctionalPassFindings(eligibleDies, testSiteRegions, result.testDefs, resolved),
      ...buildFunctionalPassFindings(eligibleDies, sectorRegions, result.testDefs, resolved),
    );
  }
  {
    const failPredicate = makeClusterFailurePredicate(isLotStack, hasHbinData, result.testDefs);
    if (!isLotStack || hasHbinData || failPredicate !== undefined) {
      findings.push(...buildClusterFindings(positionedEligibleDies, result.wafer, {
        ...resolved,
        isFailingDie: failPredicate }));
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
    regionDies: {
      ring: new Set(ringRegions.flatMap(r => positionKeysOf(r.dies))),
      quadrant: new Set(quadrantRegions.flatMap(r => positionKeysOf(r.dies))),
      sector: new Set(sectorRegions.flatMap(r => positionKeysOf(r.dies))) },
    hbinDefs: result.hbinDefs,
    sbinDefs: result.sbinDefs,
    testDefs: result.testDefs });
  findings.length = 0;
  findings.push(...mergedFindings);

  // Kept for stats.spatialPattern, for every wafer the classifier could measure —
  // including 'random' and 'none', which raise no finding below.
  let spatialPattern: PatternClassification | undefined;
  if (hasHbinData) {
    const patternResult = classifyPattern(positionedEligibleDies, result.wafer, {
      passBins:  resolved.passBins,
      ringCount: resolved.ringCount });
    spatialPattern = patternResult ?? undefined;
    if (patternResult !== null && patternResult.pattern !== 'random' && patternResult.pattern !== 'none') {
      const label = PATTERN_LABELS[patternResult.pattern];
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
      const passSet = new Set(resolved.passBins);
      const failingDies = eligibleDies.filter(d => patternFailVerdict(d, passSet) === true);

      // The findings this pattern explains are listed under it (`relatedIds`).
      // Ring rows are matched on their ring numbers from highlight.regionKeys
      // (robust to merged labels like "Rings 3–4").
      const relatedIds = claimForPattern([patternResult.pattern], severity, findings,
        f => regionKeysOf(f as RawFinding).map(k => parseRegionKey(k).ring).filter((r): r is number => r !== undefined),
        resolved.ringCount);

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
          sampleSizeRight: eligibleDies.length },
        summary: `Spatial pattern: ${label.toLowerCase()} (${patternResult.confidence} confidence) — ${detail}${patternResult.note ? ` [${patternResult.note}]` : ''}`,
        highlight: { kind: 'dies', dieKeys: failingDies.map(d => getDieKey(d)) },
        relatedIds: relatedIds.length > 0 ? relatedIds : undefined });
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
  const specYield = computeTestSpecYield(result.dies, result.testDefs);
  if (specYield) stats.testSpecYield = specYield;
  const functionalYield = computeFunctionalYield(result.dies, result.testDefs);
  if (functionalYield) stats.functionalYield = functionalYield;
  if (spatialPattern) stats.spatialPattern = spatialPattern;
  // Per-test descriptive stats (quartiles for box plots). Produced when the full
  // test-value analysis ran (reusing its discovered test numbers) OR when the
  // caller asked for the cheap computePerTestStats pass on its own. This may push
  // a cap warning, so it must run BEFORE stats.warnings is assigned below.
  if (activeTestNumbers === undefined && resolved.computePerTestStats) {
    const discovered = discoverTestNumbers(eligibleDies, resolved.testNumbers, result.testDefs);
    if (discovered.warning) warnings.push(discovered.warning);
    activeTestNumbers = discovered.testNumbers;
  }
  if (activeTestNumbers?.length) {
    const perTestStats = computePerTestStats(result.dies, activeTestNumbers, result.testDefs, resolved.minimumSampleSize);
    if (perTestStats) stats.perTestStats = perTestStats;
    // Same tests and same gate as perTestStats: both scan every value of every test.
    const capability = computeCapability([{ dies: result.dies }], result.testDefs, activeTestNumbers);
    if (capability) stats.capability = capability;
  }
  Object.assign(stats, computeTestFlagYield(result.dies, result.testDefs));
  const regionYield = computeRegionYield(
    [{ dies: result.dies, wafer: result.wafer, passBins: resolved.passBins, ringCount: resolved.ringCount }]);
  if (regionYield) stats.regionYield = regionYield;
  // Assign warnings last so cap warnings raised by the cheap perTestStats path
  // above are not lost (they are pushed after the earlier assignment point).
  if (warnings.length > 0) stats.warnings = warnings;

  // Runs last, over the complete list: the spatial-pattern pass above also
  // claims findings, and collapsing before it would leave those claims dangling.
  const facts = redundancyFacts(eligibleDies, resolved.passBins, resolved.sectorCount);
  collapseRedundantFindings(findings, facts);
  if (collecting) collectedFacts = facts;

  return {
    level: 'wafer',
    hasNotableFindings: findings.some((finding) => finding.severity === 'notable' || finding.severity === 'unusual'),
    findings,
    wafer: result.wafer.metadata ?? undefined,
    stats };
}
