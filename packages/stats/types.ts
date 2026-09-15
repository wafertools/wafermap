import type { WaferMapInput, WaferMapResult, WaferWarning } from '../renderer/buildWaferMap.js';

export type { WaferWarning };

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

/**
 * One statistically significant, practically meaningful difference the analysis
 * found — the unit a host renders in its own findings UI.
 *
 * A finding is only emitted when it clears BOTH a significance gate and an
 * effect-size gate; see docs/api.md §7.3.2 for the exact thresholds and why a
 * given pattern did or did not produce one. Everything here is already resolved
 * for display: `summary` is a written sentence, `variable.label` and
 * `comparison.left`/`right` are prose, and the numbers under `effect`/`stats`
 * are the evidence behind them.
 */
export interface StatsFinding {
  /**
   * Stable identity for this finding within its summary, e.g. `"ring:4:hbin:2"`
   * or `"cluster:-6,11"`. Use it as a list key and to correlate a click back to
   * the finding; do not parse it — the composition is not part of the contract.
   * `relatedIds`/`absorbedIds` reference other findings by this value.
   */
  id: string;
  /** Whether this describes one wafer or a whole lot. */
  level: StatsLevel;
  /**
   * How much this should draw the eye: `'unusual'` (strongest), `'notable'`, or
   * `'info'`. Derived from p-value AND effect size together, so it ranks
   * findings against each other — it is not a second threshold, and an `'info'`
   * finding has already passed both gates.
   */
  severity: StatsSeverity;
  /** What was measured. */
  variable: {
    /** Which quantity: yield, a hard/soft bin rate, a test value, a functional pass rate. */
    kind: StatsVariableKind;
    /** For `kind: 'test'`, the test number — matches `TestDef.testNumber` and the `testValues` key. */
    index?: number;
    /** For bin kinds, the bin number this finding is about. */
    bin?: number;
    /** Display name, already resolved through any supplied bin/test definitions. */
    label: string;
    /** Unit of `effect.absoluteDelta`, when the variable has one. */
    unit?: string;
  };
  /** Which two populations were compared. */
  comparison: {
    /** The region scheme this finding came from — ring, quadrant, sector, cluster, and so on. */
    family: StatsComparisonFamily;
    /** The subject population, as prose: `"Ring 4 (edge)"`, `"Rings 3–4"`. */
    left: string;
    /** What it was measured against, as prose: `"the rest of the map"`. */
    right: string;
  };
  /** How big the difference is. Which fields are populated depends on `variable.kind`. */
  effect: {
    /** Which way `left` differs from `right`. */
    direction: 'higher' | 'lower' | 'different';
    /**
     * Difference in the measured quantity. For proportions (yield, bin rates)
     * this is a FRACTION, not a percentage: 0.20 is 20 percentage points.
     */
    absoluteDelta?: number;
    /**
     * `absoluteDelta` as a multiple of the background rate — a RATIO, not a
     * percentage. **1.0 means a doubling**, not "1%" and not "100% of
     * background left unchanged". Set for proportion findings only. This is the
     * field most often misread; the gate it feeds is documented in §7.3.2.
     */
    relativeDelta?: number;
    /**
     * Standardised effect size. For test-value findings this is Cohen's d
     * (pooled SD); for proportion findings it mirrors `absoluteDelta`.
     */
    effectSize?: number;
  };
  /** The test behind the finding, for callers who want to show or audit it. */
  stats: {
    /** Which test was applied, e.g. `"welch"`, `"two-proportion-z"`. */
    method: string;
    /** Raw p-value, before multiple-comparison correction. */
    pValue?: number;
    /**
     * p-value after per-family Benjamini–Hochberg correction. **This is the one
     * the significance gate uses**, and the one to show — the raw `pValue` will
     * look more significant than the finding actually is.
     */
    adjustedPValue?: number;
    /** Dies in the subject population (`comparison.left`). */
    sampleSizeLeft: number;
    /** Dies it was compared against (`comparison.right`). */
    sampleSizeRight: number;
  };
  /**
   * The finding as a written sentence, ready to display — e.g. "Mean test_000 is
   * 4.5% higher than the rest of the map". Prefer this over composing your own
   * from the fields above: it already handles units, direction, merged regions
   * and the singular/plural cases.
   */
  summary: string;
  /**
   * What to highlight on the map when the reader selects this finding. Always
   * carries `dieKeys` in `getDieKey` format (`"x,y"`) — match on those rather
   * than re-deriving positions from the region label.
   */
  highlight: HighlightTarget;
  /**
   * IDs of other findings that describe the same signal at a finer level of
   * detail. Note these do NOT all resolve to entries in `findings`: when a run
   * of per-region findings is merged into one (e.g. `Rings 3–4`), this is the
   * audit trail of the constituents it REPLACED, and those no longer exist.
   */
  relatedIds?: string[];
  /**
   * IDs of findings that state exactly the same fact as this one and are
   * therefore hidden from reading surfaces (the Summary panel, the findings
   * report) in favour of it.
   *
   * Distinct from `relatedIds` deliberately: everything named here IS still
   * present in `findings` and can be read programmatically — nothing is
   * discarded, it is only de-duplicated for display. Two cases are collapsed:
   * a soft-bin finding whose hard-bin twin covers provably the same dies, and
   * the single pass bin's row against the yield row that restates it.
   */
  absorbedIds?: string[];
}

export interface StatsSummary {
  /** Discriminant — always `'wafer'`. Narrow on this to tell a wafer summary from a {@link LotStatsSummary}. */
  level: 'wafer';
  /**
   * True when at least one finding is `'unusual'` or `'notable'` — i.e. something
   * worth a reader's attention, as opposed to `'info'` findings which passed the
   * gates but rank low. Use it to decide whether to draw attention to the panel;
   * an empty `findings` array is not the same as nothing to report.
   */
  hasNotableFindings: boolean;
  /**
   * Every finding, most significant first. May include entries hidden from
   * reading surfaces via another finding's `absorbedIds` — filter with
   * `filterFindings` if you want what the built-in panel shows.
   */
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
    /**
     * Structured advisories raised during analysis — the same `WaferWarning`
     * shape used by `WaferMapResult.warnings`, so a host has one warning
     * vocabulary to handle rather than two. Branch on `warning.code`.
     *
     * The one raised today is `'test-count-capped'`: more tests were found than
     * the analysis cap allows, so test-value analysis was skipped and no test
     * findings exist. That is a silent absence — nothing throws — so check this
     * rather than assuming an empty findings list means "nothing to report".
     *
     * `renderWaferMap`/`renderWaferGallery` surface these automatically in the
     * toolbar's warning indicator; a host does not have to render them itself.
     */
    warnings?: WaferWarning[];
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
  /** Discriminant — always `'lot'`. Narrow on this to tell a lot summary from a {@link StatsSummary}. */
  level: 'lot';
  /**
   * True when at least one finding is `'unusual'` or `'notable'` — i.e. something
   * worth a reader's attention, as opposed to `'info'` findings which passed the
   * gates but rank low. Use it to decide whether to draw attention to the panel;
   * an empty `findings` array is not the same as nothing to report.
   */
  hasNotableFindings: boolean;
  /**
   * Every finding, most significant first. May include entries hidden from
   * reading surfaces via another finding's `absorbedIds` — filter with
   * `filterFindings` if you want what the built-in panel shows.
   */
  findings: StatsFinding[];
  /**
   * Free-form lot-level identity fields (lot ID, product, etc. — wafer-specific
   * keys excluded). Only includes a key when every wafer that has identity data
   * agrees on its value — see `mixedIdentityFields` for keys that disagree.
   */
  lot?: Record<string, unknown>;
  /**
   * Identity keys (lot, product, testProgram, temperature, etc.) where the
   * pooled wafers do NOT all agree — e.g. `items` mixed more than one
   * lot/product/program into one `analyzeWaferLot` call. Omitted from `lot`
   * rather than silently reporting the first wafer's value. Present only when
   * at least one such key exists; check this before treating `lot` as
   * describing the whole batch.
   */
  mixedIdentityFields?: string[];
  /** Engine-computed analysis stats for this lot. */
  stats: {
    waferCount: number;
  };
  /** Per-wafer yield as a flat series, ordered by waferIndex. `yieldPercent` is in [0, 100]; null when a wafer had no bin data. */
  lotYieldSeries: Array<{ waferIndex: number; yieldPercent: number | null }>;
  /**
   * Each wafer's own analysis, in input order. `waferIndex` is the position in
   * the array passed to `analyzeWaferLot`, so it indexes the caller's own list.
   * These are full summaries — a lot finding and its per-wafer counterparts can
   * both be present and describe the same signal at different levels.
   */
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
  /*
   * REMOVED in 0.27.0 — `significanceLevel`, `minimumEffectSize` and
   * `minimumRelativeEffect` are now internal constants, not options.
   *
   * They decide what counts as a finding, so a wrong value does not make the
   * output *look* different, it makes it wrong — and silently. A negative
   * `significanceLevel` returned zero findings across the board, which reads as
   * "nothing wrong with this wafer": the worst failure an analysis tool has.
   * `minimumSampleSize` was already internal for exactly this reason, and
   * `adaptOptions()` declines to adapt `significanceLevel` even internally
   * because it perturbs the multiple-comparison correction unpredictably. The
   * library was being more careful with itself than with its callers.
   *
   * The gates are documented in docs/api.md §7.3.2, so a reader can still learn
   * *why* a pattern did or did not produce a finding — which is what callers
   * actually wanted. Values passed by untyped (plain-JS) callers are now
   * validated and clamped rather than honoured; see `resolveOptions`.
   *
   * REMOVED in 0.30.0 — the per-analysis switches (enableYieldAnalysis, enableHardBinAnalysis, enableSoftBinAnalysis, enableReticlePositionAnalysis, enableTestSiteAnalysis, enableClusterAnalysis, enableAngularAnalysis, enablePatternClassification).
   * Each was cheap and on by default; every analysis now runs, and a caller wanting
   * fewer findings filters them (`filterFindings`). The two switches that cost real
   * time stay: `enableTestValueAnalysis` and `computePerTestStats`.
   */
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
  /** Number of angular sectors for sector analysis. Must be 4, 8, 16, or 32. Default 8. */
  sectorCount?: number;
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
