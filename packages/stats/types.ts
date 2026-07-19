import type { WaferMapInput, WaferMapResult } from '../renderer/buildWaferMap.js';

export type StatsSeverity = 'info' | 'notable' | 'unusual';
export type StatsLevel = 'wafer' | 'lot' | 'inter-wafer';
export type StatsVariableKind = 'yield' | 'hardBin' | 'softBin' | 'test' | 'functionalTest' | 'spatialPattern';
export type StatsComparisonFamily =
  | 'ring'
  | 'quadrant'
  | 'reticle-position'
  | 'test-site'
  | 'wafer'
  | 'sector'
  | 'cluster'
  | 'edge-arc'
  | 'spatial-pattern';

export interface HighlightRegionTarget {
  kind: 'region';
  regionFamily: 'ring' | 'quadrant' | 'reticle-position' | 'test-site' | 'sector';
  /**
   * Provenance only — the region keys this finding covers, e.g. `["ring:1", "ring:2"]`
   * (a merged band lists several). Not used for rendering: the built-in highlight draws
   * per-die rectangles from {@link dieKeys}. Exposed so callers can group or filter findings
   * by region without re-parsing the label, and read by the adjacent-finding merge pass.
   * Same field name and meaning as {@link HighlightBinTarget.regionKeys}.
   */
  regionKeys: string[];
  /** The dies to highlight — what the renderer actually draws. */
  dieKeys?: string[];
}

export interface HighlightBinTarget {
  kind: 'bin';
  bin: number;
  /** Provenance only — see {@link HighlightRegionTarget.regionKeys}. The renderer draws from {@link dieKeys}. */
  regionKeys?: string[];
  /** The dies to highlight — what the renderer actually draws. */
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
  /** IDs of other findings that describe the same signal at a finer level of detail. */
  relatedIds?: string[];
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
    /** `(passDies / totalDies) × 100` in [0, 100], or `null` when no bin data is present. */
    yieldPercent: number | null;
    testsConsidered: number[];
    hardBinsConsidered: number[];
    softBinsConsidered: number[];
    /**
     * Die counts per hard/soft bin, keyed by bin code, over the same
     * yield-eligible population `YieldSummary`/`buildBinParetoData` use
     * (`isYieldEligibleDie` — excludes `partial`/`edgeExcluded` dies).
     * Unlike `hardBinsConsidered`/`softBinsConsidered` (which list every bin
     * code that appears anywhere, eligible or not), these are the actual
     * counts a bin-breakdown display should show. Consumed by
     * `buildBinParetoData`/`buildBinClusterData` and the summary panel's bin
     * section when supplied, instead of each independently re-walking dies.
     */
    hardBinCounts?: Record<number, number>;
    softBinCounts?: Record<number, number>;
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
      /** `(passDies / totalDies) × 100` in [0, 100], or `null` when no dies had this test. */
      yieldPercent: number | null;
    }>;
    /**
     * Per-test pass rate for each functional (`testType: 'F'`) test — "functional
     * yield" in fab terms. Verdicts are read via `getTestPassStatus` (recorded
     * `testPass` first, then the legacy 0/1 `testValues` fallback). The
     * denominator is dies with a recorded verdict for the test — partial and
     * edge-excluded dies are excluded, dies never tested are not counted as fails.
     * Only populated when functional testDefs are provided.
     */
    functionalYield?: Array<{
      testNumber:      number;
      label:           string;
      passDies:        number;
      failDies:        number;
      /** Dies with a recorded pass/fail verdict for this test. */
      totalDies:       number;
      /** `(passDies / totalDies) × 100` in [0, 100], or `null` when no dies had a verdict. */
      passRatePercent: number | null;
    }>;
    /**
     * Descriptive statistics for each test's values across all eligible dies.
     * Only populated when `computePerTestStats` or `enableTestValueAnalysis` is
     * true and the test count is within the cap.
     */
    perTestStats?: Array<{
      testNumber: number;
      label:      string;
      count:      number;
      min:        number;
      max:        number;
      mean:       number;
      stddev:     number;
      median:     number;
      q1:         number;
      q3:         number;
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
  /** Per-wafer yield as a flat series, ordered by waferIndex. `yieldPercent` is in [0, 100]; null when a wafer had no bin data. */
  lotYieldSeries: Array<{ waferIndex: number; yieldPercent: number | null }>;
  perWafer: Array<{
    waferIndex: number;
    summary: StatsSummary;
  }>;
  /**
   * Per-wafer × per-test descriptive statistics, for box-plot rendering.
   * Only populated when `computePerTestStats` or `enableTestValueAnalysis` is
   * true and at least one wafer has test data. Prefer `computePerTestStats` for
   * box plots — it skips the expensive regional Welch pass.
   * Each entry's `tests` array has the same shape as `StatsSummary.stats.perTestStats`.
   */
  perWaferTestStats?: Array<{
    waferIndex: number;
    tests: Array<{
      testNumber: number;
      label:      string;
      count:      number;
      min:        number;
      max:        number;
      mean:       number;
      stddev:     number;
      median:     number;
      q1:         number;
      q3:         number;
    }>;
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
   * is small but the relative deviation is large. Default 1.0 (100% of background).
   */
  minimumRelativeEffect?: number;
  includePartial?: boolean;
  includeEdgeExcluded?: boolean;
  enableYieldAnalysis?: boolean;
  enableHardBinAnalysis?: boolean;
  enableSoftBinAnalysis?: boolean;
  /**
   * Full parametric **spatial significance** analysis: Welch comparisons of each
   * test's values between every region (ring/quadrant/reticle/site/sector) and
   * the rest of the wafer, plus spec-limit region findings. This is the expensive
   * pass — it scales with (regions × tests × dies) — so it is **off by default**.
   * Enable it only when you display the resulting regional test-value findings.
   *
   * For per-test descriptive statistics (mean/stddev/quartiles for box plots)
   * **without** the spatial comparisons, use {@link computePerTestStats} instead —
   * it is an order of magnitude cheaper. Enabling `enableTestValueAnalysis` also
   * produces `perTestStats`, so you do not need both.
   */
  enableTestValueAnalysis?: boolean;
  /**
   * Compute per-test descriptive statistics (`count`, `min`, `max`, `mean`,
   * `stddev`, `median`, `q1`, `q3`) into `StatsSummary.stats.perTestStats` —
   * the cheap quartile scan only, **without** the expensive regional Welch
   * comparisons of {@link enableTestValueAnalysis}. Use this for box-plot /
   * histogram panels that need distribution shape but not spatial findings.
   * Off by default. Implied by `enableTestValueAnalysis`.
   */
  computePerTestStats?: boolean;
  enableReticlePositionAnalysis?: boolean;
  /**
   * Analyse yield and bin distributions by test site (`siteNum`).
   * Enabled automatically when the wafer contains meaningful site duplication
   * (at least 2 distinct site numbers each appearing on 3 or more dies).
   * Set to `false` to suppress, or `true` to force-enable regardless of the guard.
   */
  enableTestSiteAnalysis?: boolean;
  /** Detect contiguous failure clusters and edge arc damage. Default true. */
  enableClusterAnalysis?: boolean;
  /** Angular sector analysis (finer-grained than quadrants). Default true. */
  enableAngularAnalysis?: boolean;
  /** Number of angular sectors for sector analysis. Must be 4, 8, 16, or 32. Default 8. */
  sectorCount?: number;
  /** Classify the spatial failure pattern (center, edge-ring, scratch, etc.). Default true. */
  enablePatternClassification?: boolean;
  /**
   * Restrict test value analysis to a specific subset of test numbers.
   * When omitted and more than 250 tests are present in the data, test value
   * analysis is skipped automatically with a console warning — pass this option
   * to analyse a specific subset in that case.
   * Example: `testNumbers: [1050, 1060, 1070]`
   */
  testNumbers?: number[];
}

export type AnalyzeWaferMapInput = WaferMapInput | WaferMapResult;
export type AnalyzeWaferLotInput = Array<WaferMapInput | WaferMapResult>;
