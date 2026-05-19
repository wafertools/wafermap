import type { WaferMapInput, WaferMapResult } from '../renderer/buildWaferMap.js';

export type StatsSeverity = 'info' | 'notable' | 'unusual';
export type StatsLevel = 'wafer' | 'lot' | 'inter-wafer';
export type StatsVariableKind = 'yield' | 'hardBin' | 'softBin' | 'test';
export type StatsComparisonFamily =
  | 'ring'
  | 'quadrant'
  | 'reticle-position'
  | 'wafer'
  | 'sector'
  | 'cluster'
  | 'edge-arc';

export interface HighlightRegionTarget {
  kind: 'region';
  regionFamily: 'ring' | 'quadrant' | 'reticle-position' | 'sector';
  keys: string[];
  dieKeys?: string[];
}

export interface HighlightBinTarget {
  kind: 'bin';
  bin: number;
  regionKeys?: string[];
  dieKeys?: string[];
}

export interface HighlightWaferTarget {
  kind: 'wafer';
  waferIndices: number[];
}

export interface HighlightDieTarget {
  kind: 'dies';
  dieKeys: string[];
}

export type HighlightTarget =
  | HighlightRegionTarget
  | HighlightBinTarget
  | HighlightWaferTarget
  | HighlightDieTarget;

export interface StatsFinding {
  id: string;
  level: StatsLevel;
  severity: StatsSeverity;
  variable: {
    kind: StatsVariableKind;
    index?: number;
    bin?: number;
    label: string;
    unit?: string;
  };
  comparison: {
    family: StatsComparisonFamily;
    left: string;
    right: string;
  };
  effect: {
    direction: 'higher' | 'lower' | 'different';
    absoluteDelta?: number;
    relativeDelta?: number;
    effectSize?: number;
  };
  stats: {
    method: string;
    pValue?: number;
    adjustedPValue?: number;
    sampleSizeLeft: number;
    sampleSizeRight: number;
  };
  summary: string;
  highlight: HighlightTarget;
}

export interface StatsSummary {
  level: 'wafer';
  hasNotableFindings: boolean;
  findings: StatsFinding[];
  /** Free-form identity fields from waferConfig.metadata (lot, wafer ID, test date, etc.). */
  wafer?: Record<string, unknown>;
  /** Engine-computed analysis stats for this wafer. */
  stats: {
    totalDies: number;
    analyzedDies: number;
    excludedDies: number;
    yieldPercent: number | null;
    testsConsidered: number[];
    hardBinsConsidered: number[];
    softBinsConsidered: number[];
    /** Structured warnings emitted during analysis (e.g. test-count cap exceeded). */
    warnings?: string[];
    /** True when this summary was produced from lot-aggregated data (lotStack). */
    isLotStack?: boolean;
    /** Aggregation method used to produce the lot-stack (e.g. 'mean', 'countBin'). Present only when isLotStack is true. */
    aggregationMethod?: string;
    /** Number of wafers in the lot stack. Present only when isLotStack is true. */
    lotSize?: number;
    /**
     * Per-test spec yield for each test that has at least one limit defined.
     * Only populated when testDefs with limitLow/limitHigh are provided.
     */
    testSpecYield?: Array<{
      testNumber:   number;
      label:        string;
      passDies:     number;
      failLowDies:  number;
      failHighDies: number;
      totalDies:    number;
      yieldPercent: number | null;
    }>;
  };
}

export interface LotStatsSummary {
  level: 'lot';
  hasNotableFindings: boolean;
  findings: StatsFinding[];
  /** Free-form lot-level identity fields (lot ID, product, etc. — wafer-specific keys excluded). */
  lot?: Record<string, unknown>;
  /** Engine-computed analysis stats for this lot. */
  stats: {
    waferCount: number;
  };
  /** Per-wafer yield as a flat series, ordered by waferIndex. null when a wafer had no bin data. */
  lotYieldSeries: Array<{ waferIndex: number; yieldPercent: number | null }>;
  perWafer: Array<{
    waferIndex: number;
    summary: StatsSummary;
  }>;
}

export interface AnalyzeWaferMapOptions {
  /**
   * Should mirror the ring count used by the renderer for consistent semantics.
   * Defaults to 4, which matches the current render default.
   */
  ringCount?: number;
  passBins?: number[];
  significanceLevel?: number;
  minimumEffectSize?: number;
  /**
   * Minimum relative effect size (|delta / background|) for proportion findings.
   * Catches meaningful signals on low-failure-rate wafers where the absolute delta
   * is small but the relative deviation is large. Default 0.5 (50% of background).
   */
  minimumRelativeEffect?: number;
  minimumSampleSize?: number;
  includePartial?: boolean;
  includeEdgeExcluded?: boolean;
  enableYieldAnalysis?: boolean;
  enableHardBinAnalysis?: boolean;
  enableSoftBinAnalysis?: boolean;
  enableTestValueAnalysis?: boolean;
  enableReticlePositionAnalysis?: boolean;
  /** Detect contiguous failure clusters and edge arc damage. Default true. */
  enableClusterAnalysis?: boolean;
  /** Angular sector analysis (finer-grained than quadrants). Default true. */
  enableAngularAnalysis?: boolean;
  /** Minimum number of contiguous failing dies to qualify as a cluster. Default 3. */
  minimumClusterSize?: number;
  /** Number of angular sectors for sector analysis. Must be 4, 8, 16, or 32. Default 16. */
  sectorCount?: number;
  /**
   * Restrict test value analysis to a specific subset of test numbers.
   * When omitted and more than 100 tests are present in the data, test value
   * analysis is skipped automatically with a console warning — pass this option
   * to analyse a specific subset in that case.
   * Example: `testNumbers: [1050, 1060, 1070]`
   */
  testNumbers?: number[];
}

export type AnalyzeWaferMapInput = WaferMapInput | WaferMapResult;
export type AnalyzeWaferLotInput = Array<WaferMapInput | WaferMapResult>;
