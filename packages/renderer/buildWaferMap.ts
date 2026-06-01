import type { Die, DieSpec } from '../core/dies.js';
import type { DieMetadata, WaferMetadata } from '../core/metadata.js';
import type { Wafer, WaferSpec } from '../core/wafer.js';
import type { Reticle, ReticleSpec } from '../core/reticle.js';
import { createWafer } from '../core/wafer.js';
import { generateDies } from '../core/dies.js';
import { clipDiesToWafer, isInsideWafer, applyOrientation, transformDies } from '../core/transforms.js';
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
  /** Die grid X position (prober step coordinate). */
  x: number;
  /** Die grid Y position (prober step coordinate). */
  y: number;
  /**
   * Test values keyed by test number — a stable per-test identity such as
   * STDF TEST_NUM or an equivalent application-defined integer.
   * Preferred over the deprecated `values` array because it is unaffected by
   * test ordering changes in the test program.
   * Example: `{ 1050: 1.42e-3, 1060: 0.487, 1070: 8.3e-12 }`
   */
  testValues?: Record<number, number>;
  /**
   * @deprecated Use `testValues` instead.
   * Positional array of test measurements — fragile when tests are added,
   * removed, or reordered between runs.
   */
  values?: number[];
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
   * counter-clockwise (standard mathematical convention).  The notch/flat
   * position is set by `notch.type` and is not affected by this value —
   * `orientation` rotates the *die grid* on the display.
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
 * reticle's internal (0,0) corner.
 */
export interface ReticleConfig {
  /** Field width in number of dies. */
  width: number;
  /** Field height in number of dies. */
  height: number;
  /**
   * Die grid index (x, y) that sits at the reticle field's internal (0,0) corner.
   * Controls the phase (alignment) of the reticle grid.
   * Defaults to `{x: 0, y: 0}`.
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
 *
 * At least one of `testNumber` or `index` must be set.
 */
export interface TestDef {
  /**
   * Stable per-test identity — an application-defined integer that uniquely
   * identifies this test within a test program (for example, STDF TEST_NUM).
   * Preferred over `index` because it is unaffected by test ordering changes.
   */
  testNumber?: number;
  /**
   * @deprecated Use `testNumber` instead.
   * Positional index into the deprecated `die.values[]` array.
   * Required only when using the deprecated `values` field.
   */
  index?: number;
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
  /** `passDies / totalDies` in [0, 1], or `null` when no bin data is present. */
  yieldPercent: number | null;
  /**
   * Gross die yield: `passDies / (passDies + failDies + edgeExcludedDies)`.
   * Set when `edgeDieYieldMode: 'denominator-only'` was passed; `null` otherwise.
   */
  yieldPercentGross?: number | null;
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
     * Non-fatal geometry-trust warnings raised during inference. Empty/absent
     * when geometry was supplied or confidently inferred. The most important
     * case: data that does not span a full symmetric wafer, where the inferred
     * diameter and centre may be wrong. Check this programmatically rather than
     * relying on console output.
     */
    warnings?: string[];
  };
  /** Die population statistics. */
  dataCoverage: {
    /** Dies inside the wafer boundary that have at least one value or bin. */
    filledDies: number;
    /** Total dies inside the wafer boundary (including partial). */
    totalDies: number;
    /** Dies falling within the edge exclusion zone. */
    edgeExcludedDies: number;
    /** `filledDies / totalDies` in [0, 1]. */
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
  retestPolicy:      'last' | 'first' | 'best' | 'worst';
  edgeDieYieldMode:  'exclude' | 'denominator-only';
}

function percentile98(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.floor(sorted.length * 0.98);
  return sorted[Math.min(idx, sorted.length - 1)];
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

function collapseLotStack(lotStack: NonNullable<WaferMapInput['lotStack']>): DieResult[] {
  const { results: waferResults, method, targetBin } = lotStack;

  // 1. Scalar numeric aggregations: mean, median, stddev, min, max, count.
  // Collect all unique testValues keys across all wafers, then run aggregateValues
  // once per key and merge results back so multi-test data isn't silently dropped.
  if (method === 'mean' || method === 'median' || method === 'stddev' || method === 'min' || method === 'max' || method === 'count') {
    const testKeys = new Set<number>();
    for (const wafer of waferResults) {
      for (const die of wafer) {
        if (die.testValues) {
          for (const k of Object.keys(die.testValues)) testKeys.add(Number(k));
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
        const pos = `${die.x},${die.y}`;
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
        const key = `${pt.x},${pt.y}`;
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
  const totalDies = dies.length;
  const edgeExcludedDies = dies.filter(d => d.edgeExcluded).length;
  const filledDies = dies.filter(
    d => (d.testValues !== undefined && Object.keys(d.testValues).length > 0) ||
         (d.values?.length ?? 0) > 0 ||
         d.hbin !== undefined || d.sbin !== undefined,
  ).length;
  return {
    filledDies,
    totalDies,
    edgeExcludedDies,
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

  for (const die of fullDies) {
    if (die.edgeExcluded) continue;
    const bin = die.hbin ?? die.sbin;
    if (bin !== undefined) {
      hasBinData = true;
      if (passBinSet.has(bin)) passDies++;
      else failDies++;
    }
  }

  const totalDies = passDies + failDies;
  const yieldPercent = hasBinData && totalDies > 0 ? passDies / totalDies : null;

  let yieldPercentGross: number | null = null;
  if (edgeDieYieldMode === 'denominator-only') {
    const grossDenom = totalDies + edgeCount;
    yieldPercentGross = hasBinData && grossDenom > 0 ? passDies / grossDenom : null;
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
  diePitchX: number,
  diePitchY: number,
): Reticle[] {
  if (!reticleOpts) return [];
  return generateReticleGrid(wafer, {
    width:      reticleOpts.width,
    height:     reticleOpts.height,
    diePitchX,
    diePitchY,
    anchorDie:  reticleOpts.anchorDie ?? { x: 0, y: 0 },
  });
}

// ── Edge exclusion ────────────────────────────────────────────────────────────

function applyEdgeExclusion(dies: Die[], wafer: Wafer, exclusionMm: number): Die[] {
  const innerRadiusSq = (wafer.radius - exclusionMm) ** 2;
  return dies.map(die => {
    const dx = die.physX - wafer.center.x;
    const dy = die.physY - wafer.center.y;
    return dx * dx + dy * dy > innerRadiusSq ? { ...die, edgeExcluded: true } : die;
  });
}

// ── Retest deduplication ──────────────────────────────────────────────────────

function applyRetestPolicy(
  results: DieResult[],
  policy: 'last' | 'first' | 'best' | 'worst',
  passBins: number[],
): DieResult[] {
  const counts = new Map<string, number>();
  for (const d of results) {
    const key = `${d.x},${d.y}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
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

  const winners = new Map<string, DieResult>();
  for (const d of results) {
    const key = `${d.x},${d.y}`;
    const existing = winners.get(key);
    if (policy === 'first' && existing) continue;
    if ((policy === 'best' || policy === 'worst') && existing) {
      if (!shouldReplace(existing, d)) continue;
    }
    winners.set(key, d);
  }

  return Array.from(winners.values()).map(d => {
    const count = counts.get(`${d.x},${d.y}`) ?? 1;
    return count > 1 ? { ...d, retestCount: count } : d;
  });
}

// ── Test value helpers ────────────────────────────────────────────────────────

/**
 * Read a test value from a die by test number.
 * Falls back to `values[fallbackIndex]` when `testValues` is absent (deprecated path).
 */
export function getDieTestValue(die: Die, testNumber: number, fallbackIndex?: number): number | undefined {
  if (die.testValues) return die.testValues[testNumber];
  return fallbackIndex !== undefined ? die.values?.[fallbackIndex] : undefined;
}

// ── Data attachment ───────────────────────────────────────────────────────────

function attachData(die: Die, pt: DieResult, testDefs?: TestDef[]): Die {
  const base: Partial<Die> = {};
  if (pt.hbin        !== undefined) base.hbin        = pt.hbin;
  if (pt.sbin        !== undefined) base.sbin        = pt.sbin;
  if (pt.retestCount !== undefined) base.retestCount = pt.retestCount;
  if (pt.siteNum     !== undefined) base.siteNum     = pt.siteNum;
  if (pt.partId      !== undefined) base.partId      = pt.partId;
  if (pt.metadata    !== undefined) base.metadata    = pt.metadata;

  // Preferred path: testValues map supplied directly — use as-is.
  if (pt.testValues) {
    return { ...die, ...base, testValues: pt.testValues };
  }

  // Deprecated path: convert positional values[] to testValues using TestDef mappings.
  if (pt.values?.length) {
    base.values = pt.values; // keep for backwards-compat reads
    const testValues: Record<number, number> = {};
    if (testDefs?.length) {
      for (const def of testDefs) {
        const key = def.testNumber ?? def.index;
        const idx = def.index ?? def.testNumber;
        if (key !== undefined && idx !== undefined && pt.values[idx] !== undefined) {
          testValues[key] = pt.values[idx]!;
        }
      }
    } else {
      // No testDefs — key by positional index.
      pt.values.forEach((v, i) => { testValues[i] = v; });
    }
    return { ...die, ...base, testValues };
  }

  return { ...die, ...base };
}

function autoPlotMode(results: DieResult[], opts: ViewOptions): PlotMode {
  if (opts.plotMode) return opts.plotMode;
  const hasValues = results.some(d => (d.testValues && Object.keys(d.testValues).length > 0) || (d.values?.length ?? 0) > 0);
  return hasValues ? 'value' : 'hardBin';
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
export function buildWaferMap(
  input: DieResult[] | WaferMapInput,
  options?: WaferMapOptions,
): WaferMapResult {
  const norm = normalizeInput(input);
  const { debug: _debug, ...viewOpts } = options ?? {};

  const rawResults = norm.lotStackOpts ? collapseLotStack(norm.lotStackOpts) : norm.results;

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

  const results: DieResult[] = applyRetestPolicy(rawResults, norm.retestPolicy, norm.passBins);

  const inference: WaferMapResult['inference'] = {
    wafer:    { confidence: 1.0, method: 'provided' },
    diePitch: { confidence: 1.0, units: 'mm' as 'mm' | 'normalized' },
    grid:     { confidence: 1.0 },
  };

  // ── Explicit dies path ─────────────────────────────────────────────────────

  if (norm.explicitDies) {
    let dies = norm.explicitDies;

    if (results.length > 0) {
      const lookup = new Map(results.map(d => [`${d.x},${d.y}`, d]));
      dies = dies.map(die => {
        const pt = lookup.get(`${die.x},${die.y}`);
        return pt ? attachData(die, pt, norm.testDefs) : die;
      });
    }

    const diameter = norm.waferOpts?.diameter ?? 300;
    const wafer    = createWafer({
      diameter,
      notch:       norm.waferOpts?.notch,
      orientation: norm.waferOpts?.orientation ?? 0,
      metadata:    norm.waferOpts?.metadata,
    });

    const reticles    = buildReticles(norm.reticleOpts, wafer, 1, 1);
    const showReticle = viewOpts.showReticle ?? (norm.reticleOpts !== undefined);

    const view = buildView(wafer, dies, {
      ...viewOpts,
      reticles,
      showReticle,
      plotMode:   autoPlotMode(results, viewOpts),
      testDefs:   norm.testDefs,
      isLotStack: false,
    }, { hbinDefs: norm.hbinDefs, sbinDefs: norm.sbinDefs });

    return {
      wafer, dies, view, reticleConfig: norm.reticleOpts, units: 'mm', inference,
      plotMode: view.plotMode,
      metadata: view.metadata,
      isLotStack: false,
      dataCoverage: computeCoverage(dies),
      yield: computeYield(dies, norm.passBins, norm.edgeDieYieldMode),
      reticles,
      hbinDefs: norm.hbinDefs,
      sbinDefs: norm.sbinDefs,
      testDefs: norm.testDefs,
    };
  }

  // ── Grid-position path ─────────────────────────────────────────────────────

  const gridPoints = results.map(d => ({ x: d.x, y: d.y }));

  const pitchResult = resolveGridPitch(gridPoints, norm.dieOpts, norm.waferOpts?.diameter);
  inference.diePitch = { confidence: pitchResult.confidence, units: pitchResult.units as 'mm' | 'normalized' };
  const { pitchX, pitchY } = pitchResult;
  const units = pitchResult.units as 'mm' | 'normalized';

  const origin      = detectOrigin(results, norm.dieOpts);
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

  if (waferDiameter === undefined) {
    if (gridPoints.length > 0) {
      // Physical positions in the same frame as die placement (relative to the
      // resolved wafer centre), so an anchored centre yields a circle that
      // encloses the data about the true centre — not the data midpoint.
      const physPoints = gridPoints.map(p => ({
        x: (Math.round(p.x) - offsetX) * pitchX - colMidX,
        y: (Math.round(p.y) - offsetY) * pitchY - colMidY,
      }));
      if (units === 'mm') {
        // pitchX/pitchY are real mm — physPoints are true physical positions.
        const wi = inferWaferFromXY(physPoints);
        waferDiameter = wi.diameter;
        inference.wafer = { confidence: wi.confidence, method: wi.method };
      } else {
        // pitchX/pitchY are normalized (no physical info). inferWaferFromXY would
        // receive coordinates in normalized units and produce a meaningless diameter.
        // Instead derive the diameter directly from the grid step extents: the
        // furthest corner distance for each data die is the radius the circle must
        // reach to fully enclose that die. Using corners (not centres) handles
        // asymmetric grids where one side extends further from (0,0) than the other.
        // p98 of corner distances excludes rectangular-corner outliers in dense grids.
        const hpx = pitchX / 2, hpy = pitchY / 2;
        const cornerRadii = physPoints.map(({ x: px, y: py }) =>
          Math.max(
            Math.sqrt((px - hpx) ** 2 + (py - hpy) ** 2),
            Math.sqrt((px + hpx) ** 2 + (py - hpy) ** 2),
            Math.sqrt((px + hpx) ** 2 + (py + hpy) ** 2),
            Math.sqrt((px - hpx) ** 2 + (py + hpy) ** 2),
          ),
        );
        waferDiameter = percentile98(cornerRadii) * 2;
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

  const wafer = createWafer({
    diameter:    waferDiameter,
    notch:       norm.waferOpts?.notch,
    orientation: norm.waferOpts?.orientation ?? 0,
    metadata:    norm.waferOpts?.metadata,
  });

  const dieConfigGeom = { width: pitchX, height: pitchY };
  const hw = pitchX / 2, hh = pitchY / 2;

  // Build dies directly from data positions — never generate positions without data.
  // partial flag is set when any die corner falls outside the wafer circle.
  let dies: Die[] = results.map(pt => {
    const col = Math.round(pt.x) - offsetX;
    const row = Math.round(pt.y) - offsetY;
    const physX = col * pitchX - colMidX;
    const physY = row * pitchY - colMidY;
    const corners: [number,number][] = [
      [physX-hw, physY-hh], [physX+hw, physY-hh],
      [physX+hw, physY+hh], [physX-hw, physY+hh],
    ];
    const base: Die = {
      id: `${col}_${row}`,
      x: col, y: row,
      physX, physY,
      width: pitchX, height: pitchY,
      insideWafer: true,
      partial: corners.filter(([cx, cy]) => isInsideWafer(cx, cy, wafer)).length < 4,
    };
    return attachData(base, pt, norm.testDefs);
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

  const reticles    = buildReticles(norm.reticleOpts, wafer, pitchX, pitchY);
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
  }, { hbinDefs: norm.hbinDefs, sbinDefs: norm.sbinDefs });

  return {
    wafer, dies, view, reticleConfig: norm.reticleOpts, units, inference,
    plotMode: view.plotMode,
    metadata: view.metadata,
    isLotStack: norm.lotStackOpts !== undefined,
    dataCoverage: computeCoverage(dies),
    yield: computeYield(dies, norm.passBins, norm.edgeDieYieldMode),
    reticles,
    hbinDefs: norm.hbinDefs,
    sbinDefs: norm.sbinDefs,
    testDefs: norm.testDefs,
  };
}
