import type { Die, DieSpec, PositionedDie } from '../core/dies.js';
import type { DieMetadata, WaferMetadata } from '../core/metadata.js';
import type { Wafer, WaferSpec } from '../core/wafer.js';
import type { Reticle, ReticleSpec } from '../core/reticle.js';
import { createWafer } from '../core/wafer.js';
import { generateDies, isYieldEligibleDie, getDieKey, hasPosition } from '../core/dies.js';
import { applyOrientation, transformDies } from '../core/transforms.js';
import { affineRotation, affineMirror, affineCompose, affinePoint } from '../core/transforms.js';
import { inferWaferFromXY } from '../core/inference/wafer.js';
import { resolveGridPitch } from '../core/inference/pitch.js';
import { assignGridIndices } from '../core/inference/grid.js';
import { generateReticleGrid } from '../core/reticle.js';
import { buildView, type View, type ViewOptions, type PlotMode } from './buildView.js';
import { modeOf } from '../core/utils.js';
import { aggregateValues, aggregateBinCounts, type AggregationMethod as CoreAggregationMethod } from '../core/aggregates.js';

// ── Public input types ────────────────────────────────────────────────────────

/**
 * Test result for a single die position, as output by the prober.
 * `x` and `y` are **die grid positions** (prober step coordinates) — integers
 * such as −7, 0, 5.  They are NOT millimetre values.
 */
export interface DieResult {
  /**
   * Die grid X position (prober step coordinate). Omit (together with `y`)
   * when this die has no reported spatial position at all — it still counts
   * toward every non-spatial stat (yield, bin counts, per-test
   * histograms/correlation/scatter) but is never placed on a wafer
   * map/gallery canvas and never enters ring/quadrant/sector/reticle/
   * cluster/pattern analysis. A die must be either fully positioned (both
   * `x` and `y`) or fully unpositioned (neither) — `buildWaferMap` rejects
   * the half-state.
   */
  x?: number;
  /** Die grid Y position (prober step coordinate). See `x`. */
  y?: number;
  /**
   * Test values keyed by test number — a stable per-test identity such as
   * STDF TEST_NUM or an equivalent application-defined integer. Keying by test
   * number is unaffected by test ordering changes in the test program.
   * Example: `{ 1050: 1.42e-3, 1060: 0.487, 1070: 8.3e-12 }`
   */
  testValues?: Record<number, number>;
  /**
   * Recorded per-test pass/fail verdicts keyed by test number (true = pass),
   * parallel to `testValues`. Parametric tests carry a value in `testValues`
   * and may optionally carry the tester's recorded verdict here (e.g. STDF
   * PTR TEST_FLG); functional tests (`testType: 'F'` in `testDefs`) carry a
   * verdict here ONLY — they have no measured value.
   * Example: `{ 2001: true, 2002: false }`
   */
  testPass?: Record<number, boolean>;
  /** Hard bin assignment (physical sort result). */
  hbin?: number;
  /** Soft bin assignment (test-program failure category). */
  sbin?: number;
  /**
   * Number of times this die position appeared in the input results array.
   * Populated automatically by `buildWaferMap` — do not set manually.
   * Only present when the die was tested more than once.
   */
  retestCount?: number;
  /**
   * STDF `site_num` — which parallel test site tested this die.
   * Only meaningful when more than one distinct value appears across the wafer
   * (i.e. the wafer was tested with a multi-site probe card).
   */
  siteNum?: number;
  /**
   * STDF `pir.part_id` — tester-assigned identifier for this tested unit.
   * At most fabs this encodes the probe sequence (the order in which the prober
   * stepped across the wafer), but the field is semantically neutral — its
   * meaning is fab-specific.
   */
  partId?: number;
  /** Per-die metadata — all fields appear automatically in hover tooltips. See `DieMetadata → §12.4`. */
  metadata?: DieMetadata;
}


/** Wafer geometry parameters — all optional; any omitted fields are inferred. */
export interface WaferConfig {
  /** Wafer diameter in mm.  Inferred from grid extent × pitch when omitted. */
  diameter?: number;
  /**
   * The prober coordinate `(x, y)` that lies at the physical centre of the
   * wafer.  Supply this for **partial or sparse** data (a half wafer, a single
   * quadrant, an edge ring, a small cluster) or whenever the prober origin is
   * not the wafer centre.
   *
   * When omitted, the centre is inferred as the midpoint of the observed die
   * positions — correct only when the data spans a full, roughly symmetric
   * wafer.  For partial data that assumption is wrong: the data midpoint is not
   * the wafer centre, so dies would be mis-positioned relative to the true
   * boundary and notch.  Setting this anchors placement to the real centre.
   *
   * Note: this does not change the public `die.x` / `die.y` labels — those are
   * always the original prober coordinates.  It only fixes physical placement.
   */
  center?: { x: number; y: number };
  /**
   * Orientation mark direction.  Standard dimensions are derived automatically
   * from the wafer diameter:
   * - ≤ 100 mm → 32.5 mm orientation flat (SEMI M1)
   * - ≤ 150 mm → 57.5 mm orientation flat (SEMI M1)
   * - > 150 mm → V-notch (~3.5 mm wide, 1.25 mm deep — SEMI M1)
   */
  notch?: { type: 'top' | 'bottom' | 'left' | 'right' };
  /**
   * Wafer orientation in degrees.  Positive values rotate the map
   * clockwise.  The notch/flat position is set by `notch.type` and is not
   * affected by this value — `orientation` rotates the *die grid* on the display.
   *
   * Common values: 0 (default), 90, 180, 270.
   */
  orientation?: number;
  metadata?: WaferMetadata;
  /**
   * Physical edge exclusion zone in mm measured from the wafer edge inward.
   * Dies whose centres fall inside this band are rendered dimmed and marked
   * `edgeExcluded: true` on the returned Die objects.
   */
  edgeExclusion?: number;
}


/**
 * Die geometry and coordinate-system parameters — all optional.
 * When omitted, dimensions are estimated from the grid layout.
 */
export interface DieConfig {
  /** Die width in mm (= X pitch). */
  width?: number;
  /** Die height in mm (= Y pitch). */
  height?: number;
  /**
   * Where the prober places coordinate (0,0) on the wafer grid.
   *
   * - `'center'`  (default) — grid already near (0,0); centroid offset applied.
   * - `'LL'`      — (0,0) at lower-left; positive x right, positive y up.
   * - `'UL'`      — (0,0) at upper-left; positive x right, positive y **down**.
   * - `'LR'`      — (0,0) at lower-right; positive x **left**, positive y up.
   * - `'UR'`      — (0,0) at upper-right; positive x left, positive y down.
   * - `'custom'`  — apply explicit `offset` (in grid steps) to centre the grid.
   *
   */
  coordinateOrigin?: {
    type: 'center' | 'LL' | 'UL' | 'LR' | 'UR' | 'custom';
    /** Grid-step offset to the true centre.  Used only when type is `'custom'`. */
    offset?: { x: number; y: number };
  };
  /**
   * Direction in which the prober Y axis increases.
   * `'up'` (default) is standard Cartesian; `'down'` is row/matrix convention
   * (row 1 at top).  The library flips the display Y axis so the map renders
   * with +Y pointing up regardless of the prober convention.
   */
  yAxisDirection?: 'up' | 'down';
  /**
   * Direction in which the prober X axis increases.
   * `'right'` (default) is standard; `'left'` is used for backside probing or
   * mirrored coordinate systems.
   */
  xAxisDirection?: 'right' | 'left';
}


/**
 * Reticle (stepper field) overlay configuration.
 * Dimensions are in die counts; `anchorDie` pins a specific die index to the
 * reticle's min-x/min-y corner (bottom-left, since +Y is up).
 */
export interface ReticleConfig {
  /** Field width in number of dies. */
  width: number;
  /** Field height in number of dies. */
  height: number;
  /**
   * Die grid index (x, y) — in original die coordinates (`die.x`/`die.y`) — that
   * sits at the reticle field's min-x/min-y corner (bottom-left, since +Y is up).
   * That die becomes the leftmost, bottom-most die of the field it belongs to;
   * every field boundary is placed relative to it. Controls the phase
   * (alignment) of the reticle grid. Defaults to `{x: 0, y: 0}`.
   */
  anchorDie?: { x: number; y: number };
}

/**
 * Lot-level stacking — collapse results from several wafers into a single map.
 * The aggregated result is used as the `results` for this map; any top-level
 * `results` field is ignored when `lotStack` is present.
 */
export interface LotStackConfig {
  /** One `DieResult[]` per wafer in the lot. */
  results: DieResult[][];
  /** Aggregation method applied per die position across all wafers. */
  method: 'mean' | 'median' | 'stddev' | 'min' | 'max' | 'count' | 'countBin' | 'mode' | 'percent';
  /** Required when `method` is `'countBin'` or `'percent'`. */
  targetBin?: number;
}

/**
 * Metadata for one test measurement.
 * Provides a human-readable name and optional unit for display in tooltips,
 * the colorbar, and the mode selector.
 */
export interface TestDef {
  /**
   * Stable per-test identity — an application-defined integer that uniquely
   * identifies this test within a test program (for example, STDF TEST_NUM).
   * Must match the key used in `DieResult.testValues` / `DieResult.testPass`.
   */
  testNumber: number;
  /** Human-readable test name, e.g. `"Idsat"` or `"Vth"`. */
  name: string;
  /** Physical unit string, e.g. `"A"`, `"V"`, `"Ω"`. Shown in tooltip and colorbar. */
  unit?: string;
  /**
   * When true, value normalization and the colorbar use log₁₀ scale for this test.
   * Silently falls back to linear when any die value is ≤ 0. Default: false.
   */
  logScale?: boolean;
  /**
   * Lower specification limit in the same units as the test value.
   * When set, values below this limit are considered out-of-spec.
   * Both limits are optional independently — some tests have one-sided limits.
   */
  limitLow?: number;
  /**
   * Upper specification limit in the same units as the test value.
   * When set, values above this limit are considered out-of-spec.
   */
  limitHigh?: number;
  /**
   * Test kind: `'P'` (parametric — a continuous measured value) or `'F'`
   * (functional — a pass/fail outcome, conventionally recorded as 1 = pass,
   * 0 = fail, e.g. an STDF FTR). Functional tests render on the wafer map
   * like any other test value, but are excluded from parametric statistics —
   * per-test descriptive stats, capability, correlation, distribution charts,
   * and regional value findings — where a mean or Cpk of a binary outcome
   * would be meaningless. Default: `'P'`.
   */
  testType?: 'P' | 'F';
}

/**
 * True when `def` describes a parametric (continuous-value) test — i.e. its
 * values are valid input for parametric statistics (mean, quartiles, Cpk,
 * correlation). Functional tests (`testType: 'F'`) record pass/fail outcomes,
 * not measurements. An undefined def or undefined `testType` defaults to
 * parametric, so untyped callers keep today's behaviour.
 */
export function isParametricTest(def: TestDef | undefined): boolean {
  return def?.testType !== 'F';
}

/**
 * Metadata for one bin number (hard bin or soft bin).
 * Hard bins and soft bins have independent number spaces (both 0–32767 per STDF V4)
 * so separate `hbinDefs` and `sbinDefs` arrays are used — never mixed.
 */
export interface BinDef {
  /** Numeric bin value this definition describes. */
  bin: number;
  /** Human-readable bin name, e.g. `"Pass"` or `"Contact Open"`. */
  name: string;
  /**
   * Optional CSS color override for this bin.
   * When set, overrides the active colour scheme for this bin value.
   */
  color?: string;
}

/**
 * Named definition for one `die.metadata` key, opting it into the `'metadata'`
 * plot mode's toolbar entry, color fill, and legend. Presence in
 * `metadataFields` is what makes a key selectable — wmap never guesses which
 * metadata keys are "categorical enough" to plot.
 */
export interface MetadataFieldDef {
  /** The `die.metadata` key this definition applies to. */
  key: string;
  /** Display name for the toolbar entry and map title. Defaults to a Title-Cased version of `key`. */
  label?: string;
  /**
   * Optional per-value name/color overrides. Distinct values not listed here
   * are still shown — auto-labeled with the raw (stringified) value and
   * auto-colored from an ordered palette.
   */
  values?: Array<{ value: string; label?: string; color?: string }>;
}

/** Input accepted by {@link buildWaferMap}.  All fields are optional. */
/** Fields common to both single-wafer and lot-stack inputs. */
export interface WaferMapInputBase {
  /** Wafer geometry — diameter, notch direction, orientation, edge exclusion. */
  waferConfig?: WaferConfig;
  /** Die size and coordinate-system conventions. */
  dieConfig?: DieConfig;
  /** Pre-built die array. When supplied, geometry generation is skipped. */
  dies?: Die[];
  /**
   * Reticle (stepper field) overlay.
   * When provided, `showReticle` defaults to `true` in the scene options.
   */
  reticleConfig?: ReticleConfig;
  /**
   * Bin values that count as pass for yield calculation.
   * Defaults to `[1]` (industry convention: bin 1 = pass).
   * Set to an empty array to suppress yield calculation.
   */
  passBins?: number[];
  /**
   * How to handle multiple `DieResult` entries for the same die position (retests).
   *
   * - `'last'`  (default) — keep the most recent result. Matches pre-existing behaviour
   *              and is appropriate when records are in probe order and the final touch
   *              is the authoritative result.
   * - `'first'` — keep the earliest result. Useful when the first touch is canonical
   *              or when the array is already sorted best-first.
   * - `'best'`  — keep the result with the best hard bin outcome. Pass beats fail
   *              (determined by `passBins`); within the same category, the lower hbin
   *              number wins. Requires `hbin` on each result — if either record in a
   *              comparison has no `hbin`, the existing record is kept. `sbin` and
   *              `testValues` are not used as ordering criteria.
   * - `'worst'` — inverse of `'best'`: fail beats pass; higher hbin number wins within
   *              each category. Same `hbin` requirement applies.
   *
   * Regardless of policy, `die.retestCount` is set on any die that was tested more than
   * once, so retest hotspots are always visible.
   */
  retestPolicy?: 'last' | 'first' | 'best' | 'worst';
  /**
   * Named test definitions — one per entry in `die.values[]`.
   * When provided, tooltips show `"Idsat: 1.23 A"` instead of `"Values: 1.23"`,
   * and the mode selector offers a per-test dropdown entry.
   */
  testDefs?: TestDef[];
  /**
   * Named hard bin definitions — one per distinct `hbin` value.
   * Hard bins and soft bins have independent number spaces (STDF V4: both 0–32767),
   * so they are defined separately.
   * When provided, the bin legend and tooltips show names like `"Pass"` instead of `"Bin 1"`.
   * A `color` on a `BinDef` overrides the active colour scheme for that bin.
   */
  hbinDefs?: BinDef[];
  /**
   * Named soft bin definitions — one per distinct `sbin` value.
   * Soft bins are the logical/test-program classification; hard bins are the physical sort result.
   * Both spaces range 0–32767 and may overlap — define them separately.
   */
  sbinDefs?: BinDef[];
  /**
   * Named definitions for `die.metadata` keys that should be selectable as the
   * `'metadata'` plot mode — a generic categorical view driven by whatever
   * per-die classification a host already has in `metadata` (project, vendor,
   * test site, wafer zone, …), distinct from test/bin results. A key only
   * appears in the toolbar when it's listed here (opt-in, never auto-detected)
   * and at least one die actually has that key set.
   */
  metadataFields?: MetadataFieldDef[];
  /**
   * Controls how edge-excluded dies (dies within the edge exclusion zone) are counted in yield.
   *
   * - `'exclude'` (default) — edge dies are excluded from both numerator and denominator.
   *   `yieldPercent` = `passDies / (passDies + failDies)` counting only non-edge dies.
   * - `'denominator-only'` — edge dies are counted in `totalDies` denominator but never
   *   as pass.  This gives gross die yield: pass count vs. total populated area.
   *   `yieldPercentGross` is also set on `YieldSummary` for unambiguous reference.
   */
  edgeDieYieldMode?: 'exclude' | 'denominator-only';
}

/** Single-wafer input — pass one wafer's die results directly. */
export interface WaferMapInputSingle extends WaferMapInputBase {
  /** Per-die test results from the prober. */
  results?: DieResult[];
  lotStack?: never;
}

/** Lot-stack input — collapse results from multiple wafers into a single aggregated map. */
export interface WaferMapInputLotStack extends WaferMapInputBase {
  /** Lot-level stacking — collapse results from several wafers into a single map. */
  lotStack: LotStackConfig;
  results?: never;
}

/**
 * Input accepted by {@link buildWaferMap}.
 * Use {@link WaferMapInputSingle} for a single wafer or {@link WaferMapInputLotStack}
 * for an aggregated lot-stack map. Passing both `results` and `lotStack` is a type error.
 */
export type WaferMapInput = WaferMapInputSingle | WaferMapInputLotStack;

/** Options forwarded to {@link buildView}. */
export interface WaferMapOptions extends ViewOptions {
  debug?: boolean;
}

// ── Output types ──────────────────────────────────────────────────────────────

export interface YieldSummary {
  /** Dies with a bin in `passBins`. */
  passDies: number;
  /** Full dies inside wafer boundary with a bin not in `passBins`. */
  failDies: number;
  /** Full dies whose centres fall within the edge exclusion zone. */
  edgeExcludedDies: number;
  /** Dies that straddle the wafer boundary. */
  partialDies: number;
  /** Total full dies inside wafer boundary used for yield (excludes edge and partial). */
  totalDies: number;
  /** `(passDies / totalDies) × 100` in [0, 100], or `null` when no bin data is present. */
  yieldPercent: number | null;
  /**
   * Gross die yield: `passDies / (passDies + failDies + edgeExcludedDies) × 100` in [0, 100].
   * Set when `edgeDieYieldMode: 'denominator-only'` was passed; `null` otherwise.
   */
  yieldPercentGross?: number | null;
}


/**
 * A non-fatal advisory raised while `buildWaferMap` inferred geometry from data.
 * Surface these to the user (a panel, a log, a status line) instead of letting
 * silent inference mask questionable input — an engineer reading a wafer map
 * built on guessed geometry must be told the geometry was guessed.
 */
export interface WaferWarning {
  /**
   * Stable machine-readable key for the advisory. Branch on this, not on
   * `message` (which is prose and may be reworded). Known codes:
   * - `'partial-coverage'` — data does not span a full symmetric wafer; the
   *   inferred diameter and centre may be wrong and dies may be mis-positioned.
   * - `'geometry-conflict'` — `waferConfig.diameter` and `dieConfig.width`/`height`
   *   were BOTH supplied, and the wafer is too small to contain the probed dies.
   *   Since a die with test results is a real prober position and is always fully
   *   on the wafer, the two supplied values contradict each other and the die
   *   positions are the trustworthy side. wmap does not silently resize a diameter
   *   you asserted — it reports this so you can correct one of them. Only raised
   *   when the pitch was supplied: pitch is a free scaling parameter, so with an
   *   inferred pitch "the dies don't fit" is not a statement about your data.
   * - `'inferred-pitch'` — `waferConfig.diameter` was supplied without a die pitch,
   *   so the pitch was derived as `diameter ÷ grid span`, assuming the grid spans
   *   the full wafer. That assumption fails whenever edge dies are absent, which
   *   silently scales every die position. Supply `dieConfig.width`/`height`.
   * - `'test-count-capped'` — raised by `analyzeWaferMap`: more tests were found in
   *   the die data than the analysis cap allows, so test-value analysis was skipped
   *   entirely and NO test findings were produced. Pass `testNumbers` to scope it.
   *
   * The union is intentionally open to string so future advisory codes can be
   * added without a breaking change; switch with a `default` branch.
   */
  code: 'partial-coverage' | 'geometry-conflict' | 'inferred-pitch'
      | 'test-count-capped' | (string & {});
  /** Human-readable explanation, suitable for direct display. */
  message: string;
  /**
   * How much this affects trust in what is on screen. Drives the built-in
   * warning indicator's colour and ordering; default `'warning'` when absent.
   *
   * - `'error'` — the map may be *positionally wrong* (dies drawn in the wrong
   *   place). Nothing downstream of the geometry can be trusted.
   * - `'warning'` — something the viewer expected is absent or degraded, but what
   *   is drawn is correct.
   * - `'info'` — worth knowing, no impact on correctness.
   */
  severity?: 'error' | 'warning' | 'info';
  /** Inference confidence in [0, 1] for the related quantity, when one exists. */
  confidence?: number;
}

export interface WaferMapResult {
  wafer: Wafer;
  dies: Die[];
  /**
   * The initial plot mode selected by `buildWaferMap` — `'value'` when test values are
   * present, `'hardBin'` otherwise. Used to initialise the toolbar to the most useful mode.
   */
  plotMode: PlotMode;
  /** Wafer metadata copied from `waferConfig.metadata`, or `null` if none was provided. */
  metadata: import('../core/metadata.js').WaferMetadata | null;
  /** `true` when the result was built from a `lotStack` aggregation. */
  isLotStack: boolean;
  /**
   * @internal Renderer-agnostic draw list consumed by `renderWaferMap` and `toCanvas`.
   * Not part of the public API — access the named fields on `WaferMapResult` instead.
   */
  view: View;
  /** Reticle configuration used to generate the overlay and reticle-local groupings. */
  reticleConfig?: ReticleConfig;
  /**
   * Coordinate space of `die.physX` / `die.physY` and wafer dimensions:
   * - **'mm'**         — at least one physical dimension was provided or could
   *                      be inferred; all spatial values are in real millimetres.
   * - **'normalized'** — only grid positions were supplied; coordinates are
   *                      proportionally correct but not in physical mm.
   */
  units: 'mm' | 'normalized';
  inference: {
    wafer:    { confidence: number; method: string };
    diePitch: { confidence: number; units: 'mm' | 'normalized' };
    grid:     { confidence: number };
    /**
     * @deprecated Use the promoted top-level `WaferMapResult.warnings` instead —
     * it is always present (empty when none) and carries structured
     * `{ code, message, confidence? }` entries you can branch on. This raw
     * string array is retained for backward compatibility and mirrors the
     * `message` of each structured warning.
     */
    warnings?: string[];
  };
  /**
   * Structured non-fatal advisories raised while inferring geometry from data.
   * Always present; empty when geometry was supplied or confidently inferred.
   * Branch on `warning.code` and display `warning.message`. The most important
   * case is `'partial-coverage'`: data that does not span a full symmetric
   * wafer, where the inferred diameter and centre may be wrong. Read this
   * programmatically rather than relying on console output.
   */
  warnings: WaferWarning[];
  /** Die population statistics. */
  dataCoverage: {
    /** Positioned dies inside the wafer boundary that have at least one value or bin. */
    filledDies: number;
    /** Total positioned dies inside the wafer boundary (including partial). Excludes unpositioned dies — see `unpositionedDies`. */
    totalDies: number;
    /** Positioned dies falling within the edge exclusion zone. */
    edgeExcludedDies: number;
    /**
     * Dies with no reported x/y position at all (see `Die.x`/`hasPosition`).
     * Always present, `0` when every die is positioned. These dies are
     * counted in `dies` and in every non-spatial stat (yield, bin counts,
     * per-test analysis) but never in `totalDies`/`filledDies`/`ratio`
     * above, and never drawn on the map/gallery canvas.
     */
    unpositionedDies: number;
    /** `filledDies / totalDies` in [0, 1] — `0` when there are no positioned dies, even if `unpositionedDies` is large. */
    ratio: number;
  };
  /** Yield statistics computed against `passBins`. */
  yield: YieldSummary;
  /** Generated reticle geometry — pass as `viewOptions.reticles` to `renderWaferMap` to show the reticle overlay. */
  reticles: Reticle[];
  /** Named hard bin definitions passed to `buildWaferMap`. Consumed automatically by the renderer — no need to pass again to `renderWaferMap`. */
  hbinDefs?: BinDef[];
  /** Named soft bin definitions passed to `buildWaferMap`. Consumed automatically by the renderer — no need to pass again to `renderWaferMap`. */
  sbinDefs?: BinDef[];
  /** Named test definitions passed to `buildWaferMap`. Consumed automatically by the renderer — no need to pass again to `renderWaferMap`. */
  testDefs?: TestDef[];
  /** Named metadata-field definitions passed to `buildWaferMap`. Consumed automatically by the renderer — no need to pass again to `renderWaferMap`. */
  metadataFields?: MetadataFieldDef[];
  /**
   * Lot-stack aggregation method used when `lotStack` was passed to `buildWaferMap`.
   * `undefined` for single-wafer results.
   */
  aggrMethod?: string;
  /**
   * Number of wafers aggregated when `lotStack` was passed to `buildWaferMap`.
   * `undefined` for single-wafer results.
   */
  lotSize?: number;
}

// ── Internal normalized model ─────────────────────────────────────────────────

interface Normalized {
  results:      DieResult[];
  waferOpts:    WaferConfig    | undefined;
  dieOpts:      DieConfig      | undefined;
  explicitDies: Die[]          | undefined;
  reticleOpts:  ReticleConfig  | undefined;
  lotStackOpts: LotStackConfig | undefined;
  passBins:     number[];
  testDefs:     TestDef[] | undefined;
  hbinDefs:     BinDef[]  | undefined;
  sbinDefs:     BinDef[]  | undefined;
  metadataFields: MetadataFieldDef[] | undefined;
  retestPolicy:      'last' | 'first' | 'best' | 'worst';
  edgeDieYieldMode:  'exclude' | 'denominator-only';
}


function normalizeInput(input: DieResult[] | WaferMapInput): Normalized {
  if (!Array.isArray(input) && 'results' in input && input.results !== undefined && 'lotStack' in input && input.lotStack !== undefined) {
    throw new Error('buildWaferMap: pass either `results` or `lotStack`, not both.');
  }
  if (Array.isArray(input)) {
    return {
      results:          input as DieResult[],
      waferOpts:        undefined,
      dieOpts:          undefined,
      explicitDies:     undefined,
      reticleOpts:      undefined,
      lotStackOpts:     undefined,
      passBins:         [1],
      testDefs:         undefined,
      hbinDefs:         undefined,
      sbinDefs:         undefined,
      metadataFields:   undefined,
      retestPolicy:     'last',
      edgeDieYieldMode: 'exclude',
    };
  }
  return {
    results:          input.results   ?? [],
    waferOpts:        input.waferConfig,
    dieOpts:          input.dieConfig,
    explicitDies:     input.dies,
    reticleOpts:      input.reticleConfig,
    lotStackOpts:     input.lotStack,
    passBins:         input.passBins ?? [1],
    testDefs:         input.testDefs,
    hbinDefs:         input.hbinDefs,
    sbinDefs:         input.sbinDefs,
    metadataFields:   input.metadataFields,
    retestPolicy:     input.retestPolicy ?? 'last',
    edgeDieYieldMode: input.edgeDieYieldMode ?? 'exclude',
  };
}

// ── Grid origin & axis helpers ────────────────────────────────────────────────

function detectOrigin(
  _results: DieResult[],
  dieOpts: DieConfig | undefined,
): NonNullable<DieConfig['coordinateOrigin']> {
  if (dieOpts?.coordinateOrigin) return dieOpts.coordinateOrigin;
  return { type: 'center' };
}

function resolveGridOriginOffset(
  gridPoints: Array<{ x: number; y: number }>,
  origin: NonNullable<DieConfig['coordinateOrigin']>,
  ga: { offsetX: number; offsetY: number },
): { offsetX: number; offsetY: number } {
  if (origin.type === 'custom' && origin.offset) {
    return { offsetX: origin.offset.x, offsetY: origin.offset.y };
  }
  if (origin.type !== 'center') {
    let xMin = Infinity, xMax = -Infinity, yMin = Infinity, yMax = -Infinity;
    for (const p of gridPoints) {
      if (p.x < xMin) xMin = p.x;
      if (p.x > xMax) xMax = p.x;
      if (p.y < yMin) yMin = p.y;
      if (p.y > yMax) yMax = p.y;
    }
    return {
      offsetX: Math.round((xMax + xMin) / 2),
      offsetY: Math.round((yMax + yMin) / 2),
    };
  }
  return { offsetX: ga.offsetX, offsetY: ga.offsetY };
}

/**
 * Determine the physical offset (`colMidX`, `colMidY`) that places the wafer
 * centre at physical (0,0).  Die physical positions are computed as
 * `physX = col * pitchX - colMidX`, where `col = round(proberX) - offsetX`.
 *
 * - When `waferCenter` (a prober coordinate) is supplied, that die is anchored
 *   to physical (0,0): `colMidX = (round(center.x) - offsetX) * pitchX`.
 *   `anchored = true`.
 * - Otherwise the offset is the midpoint of the observed column/row extent, so
 *   the data is centred on the canvas.  This is correct only for full, roughly
 *   symmetric coverage; for partial data the data midpoint is not the wafer
 *   centre.  `anchored = false`.
 *
 * Extents are measured in the die-col frame (using `offsetX`/`offsetY`), so the
 * result is consistent with how die positions are computed downstream.
 */
function resolveCenterAnchor(
  gridPoints: Array<{ x: number; y: number }>,
  offsetX: number,
  offsetY: number,
  pitchX: number,
  pitchY: number,
  waferCenter: { x: number; y: number } | undefined,
): { colMidX: number; colMidY: number; anchored: boolean } {
  if (waferCenter) {
    return {
      colMidX: (Math.round(waferCenter.x) - offsetX) * pitchX,
      colMidY: (Math.round(waferCenter.y) - offsetY) * pitchY,
      anchored: true,
    };
  }
  if (gridPoints.length === 0) {
    return { colMidX: 0, colMidY: 0, anchored: false };
  }
  let cMin = Infinity, cMax = -Infinity, rMin = Infinity, rMax = -Infinity;
  for (const p of gridPoints) {
    const col = Math.round(p.x) - offsetX;
    const row = Math.round(p.y) - offsetY;
    if (col < cMin) cMin = col; if (col > cMax) cMax = col;
    if (row < rMin) rMin = row; if (row > rMax) rMax = row;
  }
  return {
    colMidX: ((cMin + cMax) / 2) * pitchX,
    colMidY: ((rMin + rMax) / 2) * pitchY,
    anchored: false,
  };
}

/**
 * Heuristic: does the data look like one-sided (partial) coverage rather than a
 * full wafer?
 *
 * For a full wafer — or a wafer sampled sparsely but across its whole face
 * (systematic skip-sampling or random sampling) — the data centroid coincides
 * with the centre of the bounding box: the mass is balanced. A contiguous
 * partial region (a half, a quadrant, a 60%-slice) pulls the centroid toward the
 * populated side, away from the bounding-box centre. We measure that pull on each
 * axis as |centroid − bbox-mid| / half-span and flag when it exceeds 0.11.
 *
 * Threshold rationale: contiguous half/quadrant/60% cases land at ≈0.12–0.14;
 * random sparse sampling stays ≲0.10 (centroid ≈ bbox centre by averaging). 0.11
 * separates them with a low (~2–3%) false-positive rate on random samples.
 *
 * Two cases this deliberately does NOT flag, because both still infer a correct
 * diameter/centre:
 *   - sparse-but-full-extent data (the point of the threshold), and
 *   - an edge ring / annulus, which is centroid-symmetric and reaches the true edge.
 * A small symmetric cluster far from the true centre is geometrically
 * indistinguishable from a tiny full wafer and is likewise not guessed at — the
 * documented remedy for all ambiguous cases is to supply waferConfig.center.
 */
function isLikelyPartialCoverage(
  gridPoints: Array<{ x: number; y: number }>,
  offsetX: number,
  offsetY: number,
): boolean {
  let cMin = Infinity, cMax = -Infinity, rMin = Infinity, rMax = -Infinity;
  let cSum = 0, rSum = 0;
  for (const p of gridPoints) {
    const col = Math.round(p.x) - offsetX;
    const row = Math.round(p.y) - offsetY;
    cSum += col; rSum += row;
    if (col < cMin) cMin = col; if (col > cMax) cMax = col;
    if (row < rMin) rMin = row; if (row > rMax) rMax = row;
  }
  const n = gridPoints.length;
  const centroidOffset = (sum: number, min: number, max: number): number => {
    const half = (max - min) / 2;
    if (half <= 0) return 0; // single column/row — no axis information
    return Math.abs(sum / n - (min + max) / 2) / half;
  };
  return centroidOffset(cSum, cMin, cMax) > 0.11 || centroidOffset(rSum, rMin, rMax) > 0.11;
}

function resolveAxisFlips(
  dieOpts: DieConfig | undefined,
  origin: NonNullable<DieConfig['coordinateOrigin']>,
): { flipX: boolean; flipY: boolean } {
  let flipX = dieOpts?.xAxisDirection === 'left';
  let flipY = dieOpts?.yAxisDirection === 'down';

  if (origin.type === 'UL' || origin.type === 'UR') flipY = true;
  if (origin.type === 'LR' || origin.type === 'UR') flipX = true;

  return { flipX, flipY };
}

// ── Lot-stack aggregation ─────────────────────────────────────────────────────

function collapseLotStack(lotStack: NonNullable<WaferMapInput['lotStack']>, testDefs?: TestDef[]): DieResult[] {
  const { method, targetBin } = lotStack;
  // Lot-stack aggregation combines multiple wafers' values at "the same
  // physical die" — a concept that only makes sense by position. An
  // unpositioned die has no cross-wafer position identity to aggregate by,
  // so it's excluded from the stack entirely rather than aggregated
  // meaninglessly.
  const waferResults = lotStack.results.map(wafer => wafer.filter(hasPosition));

  // 1. Scalar numeric aggregations: mean, median, stddev, min, max, count.
  // Collect all unique testValues keys across all wafers, then run aggregateValues
  // once per key and merge results back so multi-test data isn't silently dropped.
  // Functional tests (testType 'F') are skipped — a mean/median/σ of a pass/fail
  // outcome is meaningless; this also keeps legacy 0/1-encoded functional values
  // out of value stacks. Keys with no matching def default to parametric.
  if (method === 'mean' || method === 'median' || method === 'stddev' || method === 'min' || method === 'max' || method === 'count') {
    const functionalKeys = new Set(
      (testDefs ?? []).filter(td => !isParametricTest(td)).map(td => td.testNumber),
    );
    const testKeys = new Set<number>();
    for (const wafer of waferResults) {
      for (const die of wafer) {
        if (die.testValues) {
          for (const k of Object.keys(die.testValues)) {
            const key = Number(k);
            if (!functionalKeys.has(key)) testKeys.add(key);
          }
        }
      }
    }

    // No testValues keys at all — fall back to paramIndex 0 (legacy values[] path).
    if (testKeys.size === 0) {
      return aggregateValues(waferResults, method as CoreAggregationMethod) as DieResult[];
    }

    // Aggregate each test key independently and merge into a single testValues map per die.
    const keyList = [...testKeys];
    const perKey = keyList.map(k => aggregateValues(waferResults, method as CoreAggregationMethod, k));

    // Build a position → merged testValues map from the per-key results.
    const mergedMap = new Map<string, { template: ReturnType<typeof aggregateValues>[number]; testValues: Record<number, number> }>();
    for (let ki = 0; ki < keyList.length; ki++) {
      const testKey = keyList[ki]!;
      for (const die of perKey[ki]!) {
        const pos = getDieKey(die);
        if (!mergedMap.has(pos)) mergedMap.set(pos, { template: die, testValues: {} });
        const entry = mergedMap.get(pos)!;
        const v = die.testValues?.[0];  // aggregateValues stores result at key 0
        if (v !== undefined) entry.testValues[testKey] = v;
      }
    }

    return [...mergedMap.values()].map(({ template, testValues }) => ({
      ...template,
      testValues: Object.keys(testValues).length > 0 ? testValues : undefined,
    })) as DieResult[];
  }

  // 2. Bin occurrence aggregations: countBin, percent.
  // Reuses template-based logic (assumes consistent wafer layout).
  if (method === 'countBin' || method === 'percent') {
    if (targetBin === undefined) return [];
    const aggregated = aggregateBinCounts(waferResults, targetBin, 'hard') as DieResult[];

    if (method === 'countBin') return aggregated;

    const totalWafers = waferResults.length;
    return aggregated.map(dr => ({
      ...dr,
      testValues: { 0: totalWafers > 0 ? ((dr.testValues?.[0] ?? 0) / totalWafers) * 100 : 0 }
    }));
  }

  // 3. Mode aggregation: Categorical (most frequent hbin).
  // Remains local as core/aggregates focuses on testValue scalars.
  if (method === 'mode') {
    const grouped = new Map<string, DieResult[]>();
    for (const waferPoints of waferResults) {
      for (const pt of waferPoints) {
        const key = getDieKey(pt);
        if (!grouped.has(key)) grouped.set(key, []);
        grouped.get(key)!.push(pt);
      }
    }

    const result: DieResult[] = [];
    for (const [key, points] of grouped) {
      const parts = key.split(',');
      const x = Number(parts[0]);
      const y = Number(parts[1]);
      const bins = points.map(p => p.hbin).filter((b): b is number => b !== undefined);
      const m = modeOf(bins);
      if (m !== null) result.push({ x, y, hbin: m });
    }
    return result;
  }

  return [];
}

// ── Coverage & yield ──────────────────────────────────────────────────────────

function computeCoverage(dies: Die[]): WaferMapResult['dataCoverage'] {
  const positioned = dies.filter(hasPosition);
  const totalDies = positioned.length;
  const edgeExcludedDies = positioned.filter(d => d.edgeExcluded).length;
  const filledDies = positioned.filter(
    d => dieHasTestData(d) || d.hbin !== undefined || d.sbin !== undefined,
  ).length;
  return {
    filledDies,
    totalDies,
    edgeExcludedDies,
    unpositionedDies: dies.length - positioned.length,
    ratio: totalDies > 0 ? filledDies / totalDies : 0,
  };
}

function computeYield(dies: Die[], passBins: number[], edgeDieYieldMode: 'exclude' | 'denominator-only' = 'exclude'): YieldSummary {
  const passBinSet = new Set(passBins);
  const fullDies = dies.filter(d => !d.partial);
  const edgeCount = fullDies.filter(d => d.edgeExcluded).length;
  const partialDies = dies.filter(d => d.partial).length;

  let passDies = 0;
  let failDies = 0;
  let hasBinData = false;

  for (const die of dies) {
    if (!isYieldEligibleDie(die)) continue;
    const bin = die.hbin ?? die.sbin;
    if (bin !== undefined) {
      hasBinData = true;
      if (passBinSet.has(bin)) passDies++;
      else failDies++;
    }
  }

  const totalDies = passDies + failDies;
  const yieldPercent = hasBinData && totalDies > 0 ? (passDies / totalDies) * 100 : null;

  let yieldPercentGross: number | null = null;
  if (edgeDieYieldMode === 'denominator-only') {
    const grossDenom = totalDies + edgeCount;
    yieldPercentGross = hasBinData && grossDenom > 0 ? (passDies / grossDenom) * 100 : null;
  }

  return {
    passDies,
    failDies,
    edgeExcludedDies: edgeCount,
    partialDies,
    totalDies,
    yieldPercent,
    yieldPercentGross,
  };
}

// ── Reticle builder ───────────────────────────────────────────────────────────

function buildReticles(
  reticleOpts: ReticleConfig | undefined,
  wafer: Wafer,
  dies: PositionedDie[],
  diePitchX: number,
  diePitchY: number,
  // Grid-centering shift applied when building `dies` (see resolveGridOriginOffset):
  // die.x/die.y = col/row + offsetX/offsetY. anchorDie is specified in public
  // die.x/die.y coordinates, but generateReticleGrid places fields in the
  // internal col/row (physX/physY) space, so it must be converted here.
  offsetX = 0,
  offsetY = 0,
  // Physical placement of col/row (0,0) — i.e. physX/physY = col*pitchX - colMidX
  // (see resolveCenterAnchor). The die grid is not necessarily centred on the
  // wafer by a whole die pitch (partial/off-centre data), so this fractional
  // remainder must be passed through or field boundaries drift off die edges.
  colMidX = 0,
  colMidY = 0,
  // wafer.orientation (notch rotation) and the resolved data-pipeline axis flip
  // (xAxisDirection/yAxisDirection/coordinateOrigin) — both already baked into
  // `dies[].physX/physY` by applyOrientation/transformDies before this is called.
  // generateReticleGrid returns rectangles in the PRE-bake physical frame, so the
  // same bake must be replayed on each candidate here or the "does this field
  // contain a die" test below compares mismatched frames and silently drops or
  // keeps the wrong fields (see rotateAndFlip's doc comment).
  orientation = 0,
  flipX = false,
  flipY = false,
): Reticle[] {
  if (!reticleOpts) return [];
  const anchorDie = reticleOpts.anchorDie ?? { x: 0, y: 0 };
  const all = generateReticleGrid(wafer, {
    width:      reticleOpts.width,
    height:     reticleOpts.height,
    diePitchX,
    diePitchY,
    anchorDie:  { x: anchorDie.x - offsetX, y: anchorDie.y - offsetY },
    gridOrigin: { x: -colMidX, y: -colMidY },
  });
  // Only keep reticles that contain at least one die — fields that merely
  // overlap the wafer circle boundary but hold no dies should not be drawn.
  // `dies` here are already baked (applyOrientation → transformDies), while
  // generateReticleGrid emits pre-bake geometry, so replay the identical bake on
  // each candidate before testing containment — same composition, same order.
  const gridToBaked = affineCompose(
    affineMirror<'physical', 'baked'>(flipX, flipY, wafer.center.x, wafer.center.y),
    affineRotation<'grid', 'physical'>(orientation, wafer.center.x, wafer.center.y),
  );
  return all.filter(r => {
    const hw = r.width / 2, hh = r.height / 2;
    const corners = ([
      [r.x - hw, r.y - hh], [r.x + hw, r.y - hh],
      [r.x + hw, r.y + hh], [r.x - hw, r.y + hh],
    ] as const).map(([x, y]) => affinePoint(gridToBaked, x, y));
    const x0 = Math.min(...corners.map(c => c.x));
    const x1 = Math.max(...corners.map(c => c.x));
    const y0 = Math.min(...corners.map(c => c.y));
    const y1 = Math.max(...corners.map(c => c.y));
    return dies.some(d => d.physX >= x0 && d.physX < x1 && d.physY >= y0 && d.physY < y1);
  });
}

// ── Edge exclusion ────────────────────────────────────────────────────────────

function applyEdgeExclusion(dies: PositionedDie[], wafer: Wafer, exclusionMm: number): PositionedDie[] {
  const innerRadiusSq = (wafer.radius - exclusionMm) ** 2;
  return dies.map(die => {
    const dx = die.physX - wafer.center.x;
    const dy = die.physY - wafer.center.y;
    return dx * dx + dy * dy > innerRadiusSq ? { ...die, edgeExcluded: true } : die;
  });
}

// ── Retest deduplication ──────────────────────────────────────────────────────

function applyRetestPolicy(
  allResults: DieResult[],
  policy: 'last' | 'first' | 'best' | 'worst',
  passBins: number[],
): DieResult[] {
  // Retesting is inherently a "same x/y tested more than once" concept — an
  // unpositioned die has no coordinate identity to dedupe by at this stage
  // (DieResult doesn't carry an id the way a built Die does), so it passes
  // through untouched, one result in, one result out, never merged with
  // another unpositioned entry.
  const results = allResults.filter(hasPosition);
  const unpositioned = allResults.filter(r => !hasPosition(r));

  const counts = new Map<number, Map<number, number>>();
  for (const d of results) {
    let yCounts = counts.get(d.x);
    if (!yCounts) {
      yCounts = new Map<number, number>();
      counts.set(d.x, yCounts);
    }
    yCounts.set(d.y, (yCounts.get(d.y) ?? 0) + 1);
  }

  const passBinSet = new Set(passBins);
  // Returns true when the candidate should replace the existing winner.
  // 'best': pass beats fail; within same category, lower hbin wins.
  // 'worst': fail beats pass; within same category, higher hbin wins.
  function shouldReplace(existing: DieResult, candidate: DieResult): boolean {
    const eHbin = existing.hbin;
    const cHbin = candidate.hbin;
    if (eHbin === undefined || cHbin === undefined) return false;
    const ePass = passBinSet.has(eHbin);
    const cPass = passBinSet.has(cHbin);
    if (policy === 'best') {
      if (cPass !== ePass) return cPass;  // pass beats fail
      return cHbin < eHbin;              // tiebreak: lower bin number
    } else {
      if (cPass !== ePass) return ePass; // fail beats pass (i.e. replace when existing is pass)
      return cHbin > eHbin;              // tiebreak: higher bin number
    }
  }

  const winners = new Map<string, DieResult & { x: number; y: number }>();
  for (const d of results) {
    const key = getDieKey(d);
    const existing = winners.get(key);
    if (policy === 'first' && existing) continue;
    if ((policy === 'best' || policy === 'worst') && existing) {
      if (!shouldReplace(existing, d)) continue;
    }
    winners.set(key, d);
  }

  const deduped = Array.from(winners.values()).map(d => {
    const xMap = counts.get(d.x);
    const count = xMap?.get(d.y) ?? 1;
    return count > 1 ? { ...d, retestCount: count } : d;
  });

  return [...deduped, ...unpositioned];
}

// ── Test value helpers ────────────────────────────────────────────────────────

/** Read a test value from a die by test number. */
export function getDieTestValue(die: Die, testNumber: number): number | undefined {
  return die.testValues?.[testNumber];
}

/**
 * Single read-path for "did this die pass test `testNumber`".
 *
 * Primary source: `die.testPass[testNumber]` (the tester's recorded verdict).
 * Migration fallback — the ONLY place this rule exists: a functional test
 * (`testType: 'F'`) with no `testPass` entry but a `testValues` entry of
 * exactly 0 or 1 is legacy encoding (1 = pass, 0 = fail) from callers that
 * predate `testPass`. The fallback is never applied to parametric tests,
 * whose values are measurements.
 *
 * Returns `undefined` when no verdict is recorded — callers must treat that
 * as no-data, never as a fail.
 */
export function getTestPassStatus(
  die: Pick<Die, 'testValues' | 'testPass'>,
  testNumber: number,
  testDef?: TestDef,
): boolean | undefined {
  const recorded = die.testPass?.[testNumber];
  if (recorded !== undefined) return recorded;
  if (testDef !== undefined && !isParametricTest(testDef)) {
    const v = die.testValues?.[testNumber];
    if (v === 0 || v === 1) return v === 1;
  }
  return undefined;
}

/**
 * True when the die carries any per-test data — a measured test value or a
 * recorded pass/fail verdict. The single source for "does this die have test
 * data", used by coverage, plot-mode inference, and the toolbar's value-mode
 * availability checks.
 */
export function dieHasTestData(die: Pick<Die, 'testValues' | 'testPass'>): boolean {
  return (die.testValues !== undefined && Object.keys(die.testValues).length > 0) ||
         (die.testPass   !== undefined && Object.keys(die.testPass).length > 0);
}

// ── Data attachment ───────────────────────────────────────────────────────────

function attachData<D extends Die>(die: D, pt: DieResult): D {
  const base: Partial<Die> = {};
  if (pt.hbin        !== undefined) base.hbin        = pt.hbin;
  if (pt.sbin        !== undefined) base.sbin        = pt.sbin;
  if (pt.retestCount !== undefined) base.retestCount = pt.retestCount;
  if (pt.siteNum     !== undefined) base.siteNum     = pt.siteNum;
  if (pt.partId      !== undefined) base.partId      = pt.partId;
  if (pt.metadata    !== undefined) base.metadata    = pt.metadata;
  if (pt.testPass    !== undefined) base.testPass    = pt.testPass;
  if (pt.testValues  !== undefined) base.testValues  = pt.testValues;

  return { ...die, ...base };
}

function autoPlotMode(results: DieResult[], opts: ViewOptions): PlotMode {
  if (opts.plotMode) return opts.plotMode;
  return results.some(dieHasTestData) ? 'value' : 'hardBin';
}

// ── Main entry point ──────────────────────────────────────────────────────────

/**
 * Build a complete wafer map from any level of input.
 *
 * `x` and `y` in each result are **die grid positions** (prober step
 * coordinates — integers like −7, 0, 5), not millimetre values.  Supply
 * whatever geometry you have; the library infers the rest.
 *
 * @example Minimal — grid positions + values only (all geometry inferred):
 * ```ts
 * const result = buildWaferMap([
 *   { x:  0, y:  0, values: [0.95] },
 *   { x:  1, y:  0, values: [0.87] },
 *   { x:  0, y: -1, values: [0.91] },
 * ]);
 * renderWaferMap(document.getElementById('map'), result);
 * ```
 *
 * @example Multiple tests and bins supplied directly:
 * ```ts
 * const result = buildWaferMap({
 *   results: rows.map(r => ({
 *     x: +r.x, y: +r.y,
 *     values: [+r.testA, +r.testB, +r.testC],
 *     hbin: +r.hbin,
 *     sbin: +r.sbin,
 *   })),
 *   dieConfig: { width: 10, height: 10 },
 * });
 * ```
 *
 * @example Reticle overlay phased to die (2,1):
 * ```ts
 * const result = buildWaferMap({
 *   results,
 *   dieConfig: { width: 10, height: 10 },
 *   reticleConfig: { width: 4, height: 2, anchorDie: { x: 2, y: 1 } },
 * });
 * ```
 *
 * @example Aggregate bin failures across six wafers:
 * ```ts
 * const result = buildWaferMap({
 *   waferConfig: { diameter: 300 },
 *   dieConfig:   { width: 10, height: 10 },
 *   lotStack:    { results: [wafer1, wafer2, wafer3, wafer4, wafer5, wafer6],
 *               method: 'countBin', targetBin: 2 },
 * });
 * ```
 */
/**
 * Derive the structured, public `WaferMapResult.warnings` array from the
 * internal `inference` record. Single source of truth for both build paths.
 *
 * Only genuinely questionable inference is flagged. Normalized-unit geometry
 * (raw prober steps with no physical dimensions) is the library's primary
 * supported input and is inferred confidently — it is NOT a warning. The one
 * advisory today is `'partial-coverage'`: data that does not span a full
 * symmetric wafer, where the inferred diameter/centre may be wrong. That
 * detection lives at the inference site; here we just promote its message(s)
 * into the structured shape.
 */
function buildWarnings(inference: WaferMapResult['inference']): WaferWarning[] {
  return (inference.warnings ?? []).map(message => ({
    code: codeForAdvisory(message),
    message,
    // Every geometry advisory means die positions may be wrong — a wrong-looking
    // map, not a missing feature — so all three are errors rather than notices.
    severity: 'error' as const,
    confidence: inference.wafer.confidence,
  }));
}

/**
 * Map an advisory message to its stable machine-readable code.
 *
 * `inference.warnings` is the (deprecated) string channel and is the one place
 * both advisories are recorded, so the code is recovered here rather than being
 * assumed. Hosts branch on `code`, so stamping every message `'partial-coverage'`
 * — as this did before `'geometry-conflict'` existed — silently misclassifies it.
 * Keep this in step with the push sites in `buildWaferMap`.
 */
function codeForAdvisory(message: string): WaferWarning['code'] {
  if (message.includes(GEOMETRY_CONFLICT_MARKER)) return 'geometry-conflict';
  if (message.includes(INFERRED_PITCH_MARKER))    return 'inferred-pitch';
  return 'partial-coverage';
}

/** Distinctive phrase identifying the geometry-conflict advisory in the string channel. */
const GEOMETRY_CONFLICT_MARKER = 'do not fit inside the supplied';
/** Distinctive phrase identifying the inferred-pitch advisory in the string channel. */
const INFERRED_PITCH_MARKER = 'The die pitch was inferred as';

export function buildWaferMap(
  input: DieResult[] | WaferMapInput,
  options?: WaferMapOptions,
): WaferMapResult {
  const norm = normalizeInput(input);
  const { debug: _debug, ...viewOpts } = options ?? {};

  const rawResults = norm.lotStackOpts ? collapseLotStack(norm.lotStackOpts, norm.testDefs) : norm.results;

  // Fail fast on string coordinates — common mistake when piping CSV without numeric casting
  for (let i = 0; i < Math.min(5, rawResults.length); i++) {
    const r = rawResults[i];
    if (typeof r.x === 'string' || typeof r.y === 'string') {
      throw new TypeError(
        `buildWaferMap: x and y must be numbers, received strings. ` +
        `Did you forget to cast CSV values? e.g. { x: +row.x, y: +row.y }`
      );
    }
  }

  // A die is either fully positioned (both x and y) or fully unpositioned
  // (neither) — see hasPosition(). A caller that supplies only one of the
  // two almost certainly has a bug (a null x with a real y, say), and
  // silently treating it as "unpositioned" would hide that; fail fast
  // instead. Checked over every result, not just a sample, since this is
  // cheap and a partial-half-state bug could easily hide past the first few
  // rows of a real file.
  for (const r of rawResults) {
    if ((r.x == null) !== (r.y == null)) {
      throw new TypeError(
        `buildWaferMap: die has only one of x/y set (x=${String(r.x)}, y=${String(r.y)}). ` +
        `A die must be either fully positioned (both x and y) or fully unpositioned ` +
        `(neither) — omit both to mark a die as having no reported position.`
      );
    }
  }

  const results: DieResult[] = applyRetestPolicy(rawResults, norm.retestPolicy, norm.passBins);

  const inference: WaferMapResult['inference'] = {
    wafer:    { confidence: 1.0, method: 'provided' },
    diePitch: { confidence: 1.0, units: 'mm' as 'mm' | 'normalized' },
    grid:     { confidence: 1.0 },
  };

  // ── Explicit dies path ─────────────────────────────────────────────────────

  if (norm.explicitDies) {
    let dies = norm.explicitDies;

    // Pre-built dies always carry their own position (they're a caller-supplied
    // layout) — only `results` (the data to attach) can include unpositioned
    // entries. Those never match anything by getDieKey (an unpositioned die
    // keys by id, which no pre-built die shares), so they're carried through
    // separately below rather than silently dropped.
    const positionedResults = results.filter(hasPosition);
    const unpositionedResults = results.filter(r => !hasPosition(r));

    if (positionedResults.length > 0) {
      const lookup = new Map(positionedResults.map(d => [getDieKey(d), d]));
      dies = dies.map(die => {
        const pt = lookup.get(getDieKey(die));
        return pt ? attachData(die, pt) : die;
      });
    }

    const diameter = norm.waferOpts?.diameter ?? 300;
    const wafer    = createWafer({
      diameter,
      notch:       norm.waferOpts?.notch,
      orientation: norm.waferOpts?.orientation ?? 0,
      metadata:    norm.waferOpts?.metadata,
    });

    // Pre-built dies carry the caller's own physX/physY, but waferConfig.orientation
    // is still honored — applyOrientation rotates them to match, the same as the
    // main (results-based) path. Without this, the wafer notch and any overlay that
    // rotates with wafer.orientation (reticle fields, quadrant boundaries) would
    // rotate while the dies themselves stayed put.
    // explicitDies is a caller-supplied pre-built layout, always positioned
    // by convention (not part of the coordinate-less data path).
    if (wafer.orientation !== 0) dies = applyOrientation(dies as PositionedDie[], wafer);

    const reticles    = buildReticles(norm.reticleOpts, wafer, dies as PositionedDie[], 1, 1, 0, 0, 0, 0, wafer.orientation);
    const showReticle = viewOpts.showReticle ?? (norm.reticleOpts !== undefined);

    const view = buildView(wafer, dies as PositionedDie[], {
      ...viewOpts,
      reticles,
      showReticle,
      plotMode:   autoPlotMode(results, viewOpts),
      testDefs:   norm.testDefs,
      isLotStack: false,
    }, { hbinDefs: norm.hbinDefs, sbinDefs: norm.sbinDefs, metadataFields: norm.metadataFields });

    const unpositionedDies: Die[] = unpositionedResults.map((pt, i) =>
      attachData({ id: `unpositioned_${i}`, width: dies[0]?.width ?? 1, height: dies[0]?.height ?? 1 }, pt),
    );
    const allDies = [...dies, ...unpositionedDies];

    return {
      wafer, dies: allDies, view, reticleConfig: norm.reticleOpts, units: 'mm', inference,
      warnings: buildWarnings(inference),
      plotMode: view.plotMode,
      metadata: view.metadata,
      isLotStack: false,
      dataCoverage: computeCoverage(allDies),
      yield: computeYield(allDies, norm.passBins, norm.edgeDieYieldMode),
      reticles,
      hbinDefs: norm.hbinDefs,
      sbinDefs: norm.sbinDefs,
      testDefs: norm.testDefs,
      metadataFields: norm.metadataFields,
    };
  }

  // ── Grid-position path ─────────────────────────────────────────────────────

  // Geometry inference (pitch, origin, grid, wafer diameter, orientation,
  // edge-exclusion, reticle assignment) runs only on positioned dies —
  // unpositioned ones have no coordinates to infer from and are folded back
  // in at the very end, after `dies`/`view`/`reticles` are all built from
  // the positioned subset only.
  const positionedResults = results.filter(hasPosition);
  const unpositionedResults = results.filter(r => !hasPosition(r));

  const gridPoints = positionedResults.map(d => ({ x: d.x, y: d.y }));

  const pitchResult = resolveGridPitch(gridPoints, norm.dieOpts, norm.waferOpts?.diameter);
  inference.diePitch = { confidence: pitchResult.confidence, units: pitchResult.units as 'mm' | 'normalized' };
  const { pitchX, pitchY } = pitchResult;
  const units = pitchResult.units as 'mm' | 'normalized';

  const origin      = detectOrigin(positionedResults, norm.dieOpts);
  const ga          = assignGridIndices(gridPoints);
  inference.grid    = { confidence: ga.confidence };
  const { offsetX, offsetY } = resolveGridOriginOffset(gridPoints, origin, ga);

  const { flipX, flipY } = resolveAxisFlips(norm.dieOpts, origin);

  // Physical offset placing the wafer centre at (0,0).  When waferConfig.center
  // is given that prober coordinate is anchored to (0,0); otherwise the observed
  // data extent is centred (correct only for full, symmetric coverage).
  const { colMidX, colMidY, anchored } = resolveCenterAnchor(
    gridPoints, offsetX, offsetY, pitchX, pitchY, norm.waferOpts?.center,
  );

  let waferDiameter = norm.waferOpts?.diameter;

  // Physical positions in the same frame as die placement (relative to the
  // resolved wafer centre), so an anchored centre yields a circle that encloses
  // the data about the true centre — not the data midpoint.
  const physPoints = gridPoints.map(p => ({
    x: (Math.round(p.x) - offsetX) * pitchX - colMidX,
    y: (Math.round(p.y) - offsetY) * pitchY - colMidY,
  }));

  /**
   * Distance from the wafer centre to the furthest corner of the furthest die.
   *
   * Every die here came from `results`, i.e. a real tested prober position — and a
   * prober can only step to sites that sit entirely on the wafer, so a probed die
   * is never edge-straddling. The wafer must therefore be at least this big; the
   * die extent is ground truth and the inferred diameter is the guess.
   */
  const requiredRadius = physPoints.length > 0
    ? Math.max(...physPoints.map(({ x: px, y: py }) =>
        Math.hypot(Math.abs(px) + pitchX / 2, Math.abs(py) + pitchY / 2)))
    : 0;

  if (waferDiameter === undefined) {
    if (gridPoints.length > 0) {
      if (units === 'mm') {
        // pitchX/pitchY are real mm — physPoints are true physical positions.
        const wi = inferWaferFromXY(physPoints, { minRadius: requiredRadius });
        waferDiameter = wi.diameter;
        inference.wafer = { confidence: wi.confidence, method: wi.method };
      } else {
        // pitchX/pitchY are normalized (no physical info). inferWaferFromXY would
        // receive coordinates in normalized units and produce a meaningless diameter.
        // Instead derive the diameter directly from the grid step extents: the
        // furthest corner distance for each data die is the radius the circle must
        // reach to fully enclose that die. Using corners (not centres) handles
        // asymmetric grids where one side extends further from (0,0) than the other.
        // Uses the true maximum, not a percentile: every die is a real probed site
        // and must fit inside the circle, so there are no outliers to trim here.
        waferDiameter = requiredRadius * 2;
        inference.wafer = { confidence: pitchResult.confidence * 0.8, method: 'extent' };
      }
    } else {
      waferDiameter = units === 'mm' ? 300 : 30;
      inference.wafer = { confidence: 0, method: 'default' };
    }
  }

  // Partial-data guard: when the wafer centre was not anchored (no
  // waferConfig.center) and the data does not look like full symmetric
  // coverage, the inferred centre/diameter may be wrong and dies may be
  // mis-positioned relative to the true boundary. Surface this so callers are
  // not silently misled (see WaferMapResult.inference.warnings).
  if (!anchored && gridPoints.length > 0 && isLikelyPartialCoverage(gridPoints, offsetX, offsetY)) {
    inference.wafer.method = 'inferred-partial';
    (inference.warnings ??= []).push(
      'Wafer geometry was inferred from die positions alone. The data does not span a full symmetric wafer, so the inferred diameter and centre may be wrong and dies may be mis-positioned relative to the true wafer boundary. Supply waferConfig.diameter and waferConfig.center (the prober coordinate of the wafer centre) to position partial data correctly.',
    );
  }

  // Geometry advisories for caller-supplied `waferConfig.diameter`.
  //
  // A "these dies don't fit" claim is only meaningful when the die pitch was ALSO
  // supplied. Pitch is a free scaling parameter: for any set of grid positions and
  // any diameter there is always a pitch small enough to fit them, so with an
  // inferred pitch "doesn't fit" says nothing about the data. `resolveGridPitch`
  // already clamps an inferred pitch so it's guaranteed to fit the given diameter
  // (see its containment clamp), so this check would never have anything to
  // report for that path anyway — it's restricted to the case below where the
  // caller supplied both diameter and pitch, which is the only case where "doesn't
  // fit" is a genuine, checkable contradiction rather than something the inference
  // itself would have prevented.
  if (norm.waferOpts?.diameter !== undefined) {
    const pitchWasSupplied = norm.dieOpts?.width !== undefined && norm.dieOpts?.height !== undefined;

    if (pitchWasSupplied && requiredRadius > waferDiameter / 2 + 1e-9) {
      // Both quantities were asserted by the caller, so this is a genuine
      // contradiction between two independent facts — and by the prober invariant
      // the die positions are the trustworthy one. We do NOT silently resize.
      const outside = physPoints.filter(({ x: px, y: py }) =>
        Math.hypot(Math.abs(px) + pitchX / 2, Math.abs(py) + pitchY / 2) > waferDiameter / 2 + 1e-9).length;
      (inference.warnings ??= []).push(
        `${outside} of ${physPoints.length} probed die positions ${GEOMETRY_CONFLICT_MARKER} ${waferDiameter} mm wafer ` +
        `at the supplied die pitch of ${pitchX} × ${pitchY} mm. A die with test results is a real prober position and is ` +
        `always fully on the wafer, so one of the two supplied values must be wrong: containing these dies at this pitch ` +
        `would need a diameter of at least ${(requiredRadius * 2).toFixed(1)} mm. Check waferConfig.diameter and ` +
        `dieConfig.width/height against the real device.`,
      );
    } else if (!pitchWasSupplied) {
      // Containment is guaranteed (resolveGridPitch clamps to fit the diameter),
      // but the assumed aspect ratio may still not match the true die shape when
      // edge dies are absent from the data (a reticle-complete map, or partial
      // dies filtered out upstream) — only worth flagging that as an
      // unverifiable assumption made on the caller's behalf.
      (inference.warnings ??= []).push(
        `${INFERRED_PITCH_MARKER} ${pitchX.toFixed(3)} × ${pitchY.toFixed(3)} mm by assuming the die grid fits within the ` +
        `${waferDiameter} mm wafer. The assumed aspect ratio may not match the true die shape whenever edge dies are ` +
        `absent from the data (a reticle-complete map, or partial dies filtered out upstream). Supply dieConfig.width and ` +
        `dieConfig.height — the die pitch, not the diameter, is what fixes placement.`,
      );
    }
  }

  const wafer = createWafer({
    diameter:    waferDiameter,
    notch:       norm.waferOpts?.notch,
    orientation: norm.waferOpts?.orientation ?? 0,
    metadata:    norm.waferOpts?.metadata,
  });

  const dieConfigGeom = { width: pitchX, height: pitchY };

  // Build dies directly from data positions — never generate positions without data.
  //
  // `partial` is always false here. Each of these dies came from `results`, i.e. a
  // real tested prober position, and a prober only steps to sites that lie entirely
  // on the wafer — a prober map never contains edge-straddling dies. Deriving the
  // flag by testing die corners against the wafer circle inverted that: it treated
  // the (often inferred) geometry as truth and the measured data as suspect, so an
  // undersized circle invented partial dies that cannot physically exist, greyed
  // them out, and silently dropped them from yield. When the geometry genuinely
  // cannot contain the data we now say so via inference.warnings above instead.
  //
  // `partial` remains meaningful for a synthesized die grid clipped to a wafer —
  // see `clipDiesToWafer`, which is where straddling dies legitimately arise.
  let dies: PositionedDie[] = positionedResults.map(pt => {
    const col = Math.round(pt.x) - offsetX;
    const row = Math.round(pt.y) - offsetY;
    const base: PositionedDie = {
      id: `${col}_${row}`,
      x: col, y: row,
      physX: col * pitchX - colMidX,
      physY: row * pitchY - colMidY,
      width: pitchX, height: pitchY,
      insideWafer: true,
      partial: false,
    };
    return attachData(base, pt);
  });

  // Shift x/y from centred grid indices to original input coordinates.
  // die.physX/physY remain unchanged — only the public identity fields move.
  if (offsetX !== 0 || offsetY !== 0) {
    dies = dies.map(die => ({
      ...die,
      x:  die.x + offsetX,
      y:  die.y + offsetY,
      id: `${die.x + offsetX}_${die.y + offsetY}`,
    }));
  }

  dies = applyOrientation(dies, wafer);

  if (flipX || flipY) {
    dies = transformDies(dies, { flipX, flipY }, wafer.center);
  }

  if (norm.waferOpts?.edgeExclusion && norm.waferOpts.edgeExclusion > 0) {
    dies = applyEdgeExclusion(dies, wafer, norm.waferOpts.edgeExclusion);
  }

  const reticles    = buildReticles(norm.reticleOpts, wafer, dies, pitchX, pitchY, offsetX, offsetY, colMidX, colMidY, wafer.orientation, flipX, flipY);
  const showReticle = viewOpts.showReticle ?? (norm.reticleOpts !== undefined);

  const view = buildView(wafer, dies, {
    ...viewOpts,
    reticles,
    showReticle,
    plotMode:     autoPlotMode(results, viewOpts),
    testDefs:     norm.testDefs,
    dataAxisFlip: { x: flipX, y: flipY },
    isLotStack:   norm.lotStackOpts !== undefined,
    aggregationMethod: norm.lotStackOpts?.method,
    lotSize:      norm.lotStackOpts?.results.length,
  }, { hbinDefs: norm.hbinDefs, sbinDefs: norm.sbinDefs, metadataFields: norm.metadataFields });

  // Unpositioned dies never went through grid/geometry inference above (no
  // coordinates to infer from) — folded in only now, so `view`/`reticles`
  // (the render draw list) reflect positioned dies only, while the returned
  // `dies` and every stat computed below sees the full population.
  const unpositionedDies: Die[] = unpositionedResults.map((pt, i) =>
    attachData({ id: `unpositioned_${i}`, width: pitchX, height: pitchY }, pt),
  );
  const allDies = [...dies, ...unpositionedDies];

  return {
    wafer, dies: allDies, view, reticleConfig: norm.reticleOpts, units, inference,
    warnings: buildWarnings(inference),
    plotMode: view.plotMode,
    metadata: view.metadata,
    isLotStack: norm.lotStackOpts !== undefined,
    dataCoverage: computeCoverage(allDies),
    yield: computeYield(allDies, norm.passBins, norm.edgeDieYieldMode),
    reticles,
    hbinDefs: norm.hbinDefs,
    sbinDefs: norm.sbinDefs,
    testDefs: norm.testDefs,
    metadataFields: norm.metadataFields,
    aggrMethod: view.aggrMethod,
    lotSize: view.lotSize,
  };
}
