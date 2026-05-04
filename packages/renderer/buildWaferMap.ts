import type { Die, DieSpec } from '../core/dies.js';
import type { WaferMetadata } from '../core/metadata.js';
import type { Wafer, WaferSpec } from '../core/wafer.js';
import type { Reticle, ReticleSpec } from '../core/reticle.js';
import { createWafer } from '../core/wafer.js';
import { generateDies } from '../core/dies.js';
import { clipDiesToWafer, applyOrientation, transformDies } from '../core/transforms.js';
import { inferWaferFromXY } from '../core/inference/wafer.js';
import { resolveGridPitch } from '../core/inference/pitch.js';
import { assignGridIndices } from '../core/inference/grid.js';
import { generateReticleGrid } from '../core/reticle.js';
import { buildScene, type Scene, type SceneOptions, type PlotMode } from './buildScene.js';

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
  /** Measured test values — one entry per test (e.g. [idsat, vth, ioff]). */
  values?: number[];
  /** Bin assignments — bins[0] is the hard bin, bins[1] the soft bin, etc. */
  bins?: number[];
  /**
   * Number of times this die position appeared in the input results array.
   * Populated automatically by `buildWaferMap` — do not set manually.
   * Only present when the die was tested more than once.
   */
  retestCount?: number;
}

/** @deprecated Use {@link DieResult} */
export type DieSample = DieResult;
/** @deprecated Use {@link DieResult} */
export type WaferMapPoint = DieResult;

/** Wafer geometry parameters — all optional; any omitted fields are inferred. */
export interface WaferOptions {
  /** Wafer diameter in mm.  Inferred from grid extent × pitch when omitted. */
  diameter?: number;
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

/** @deprecated Use {@link WaferOptions} */
export type WaferConfig = WaferOptions;
/** @deprecated Use {@link WaferOptions} */
export type WaferParams = WaferOptions;

/**
 * Die geometry and coordinate-system parameters — all optional.
 * When omitted, dimensions are estimated from the grid layout.
 */
export interface DieOptions {
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
   * Auto-detected as `'LL'` when all input coordinates are ≥ 0 (standard STDF/KLA output).
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

/** @deprecated Use {@link DieOptions} */
export type DieConfig = DieOptions;
/** @deprecated Use {@link DieOptions} */
export type DieParams = DieOptions;

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
   * Die grid index (i, j) that sits at the reticle field's internal (0,0) corner.
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
  method: 'mean' | 'median' | 'stddev' | 'countBin' | 'mode' | 'percent';
  /** Required when `method` is `'countBin'` or `'percent'`. */
  targetBin?: number;
}

/**
 * Metadata for one test measurement — maps to `die.values[index]`.
 * Provides a human-readable name and optional unit for display in tooltips,
 * the colorbar, and the mode selector.
 */
export interface TestDef {
  /** Index into `die.values[]` that this definition describes. */
  index: number;
  /** Human-readable test name, e.g. `"Idsat"` or `"Vth"`. */
  name: string;
  /** Physical unit string, e.g. `"A"`, `"V"`, `"Ω"`. Shown in tooltip and colorbar. */
  unit?: string;
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
export interface WaferMapInput {
  /** Per-die test results from the prober. */
  results?: DieResult[];
  /** Wafer geometry — diameter, notch direction, orientation, edge exclusion. */
  waferConfig?: WaferOptions;
  /** Die size and coordinate-system conventions. */
  dieConfig?: DieOptions;
  /** Pre-built die array.  When supplied, geometry generation is skipped. */
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
  /** Lot-level stacking — collapse results from several wafers into a single map. */
  lotStack?: LotStackConfig;
  /**
   * How to handle multiple `DieResult` entries for the same die position (retests).
   *
   * - `'last'`  (default) — keep the most recent result. Matches pre-existing behaviour
   *              and is appropriate when records are in probe order and the final touch
   *              is the authoritative result.
   * - `'first'` — keep the earliest result. Useful when the first touch is canonical
   *              or when the array is already sorted best-first.
   *
   * Regardless of policy, `die.retestCount` is set on any die that was tested more than
   * once, so retest hotspots are always visible.
   */
  retestPolicy?: 'last' | 'first';
  /**
   * Named test definitions — one per entry in `die.values[]`.
   * When provided, tooltips show `"Idsat: 1.23 A"` instead of `"Values: 1.23"`,
   * and the mode selector offers a per-test dropdown entry.
   */
  testDefs?: TestDef[];
  /**
   * Named hard bin definitions — one per distinct `bins[0]` value.
   * Hard bins and soft bins have independent number spaces (STDF V4: both 0–32767),
   * so they are defined separately.
   * When provided, the bin legend and tooltips show names like `"Pass"` instead of `"Bin 1"`.
   * A `color` on a `BinDef` overrides the active colour scheme for that bin.
   */
  hbinDefs?: BinDef[];
  /**
   * Named soft bin definitions — one per distinct `bins[1]` value.
   * Soft bins are the logical/test-program classification; hard bins are the physical sort result.
   * Both spaces range 0–32767 and may overlap — define them separately.
   */
  sbinDefs?: BinDef[];
}

/** Options forwarded to {@link buildScene}. */
export interface WaferMapOptions extends SceneOptions {
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
}

/** @deprecated Use {@link YieldSummary} */
export type WaferYield = YieldSummary;

export interface WaferMapResult {
  wafer: Wafer;
  dies: Die[];
  scene: Scene;
  /** Reticle configuration used to generate the overlay and reticle-local groupings. */
  reticleConfig?: ReticleConfig;
  /**
   * Coordinate space of `die.x` / `die.y` and wafer dimensions:
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
  /** Generated reticle geometry — pass as `sceneOptions.reticles` to `renderWaferMap` to show the reticle overlay. */
  reticles: Reticle[];
}

// ── Internal normalized model ─────────────────────────────────────────────────

interface Normalized {
  results:      DieResult[];
  waferOpts:    WaferOptions    | undefined;
  dieOpts:      DieOptions      | undefined;
  explicitDies: Die[]          | undefined;
  reticleOpts:  ReticleConfig  | undefined;
  lotStackOpts: LotStackConfig | undefined;
  passBins:     number[];
  testDefs:     TestDef[] | undefined;
  hbinDefs:     BinDef[]  | undefined;
  sbinDefs:     BinDef[]  | undefined;
  retestPolicy: 'last' | 'first';
}

function normalizeInput(input: DieResult[] | WaferMapInput): Normalized {
  if (Array.isArray(input)) {
    return {
      results:      input,
      waferOpts:    undefined,
      dieOpts:      undefined,
      explicitDies: undefined,
      reticleOpts:  undefined,
      lotStackOpts: undefined,
      passBins:     [1],
      testDefs:     undefined,
      hbinDefs:     undefined,
      sbinDefs:     undefined,
      retestPolicy: 'last',
    };
  }
  return {
    results:      input.results   ?? [],
    waferOpts:    input.waferConfig,
    dieOpts:      input.dieConfig,
    explicitDies: input.dies,
    reticleOpts:  input.reticleConfig,
    lotStackOpts: input.lotStack,
    passBins:     input.passBins ?? [1],
    testDefs:     input.testDefs,
    hbinDefs:     input.hbinDefs,
    sbinDefs:     input.sbinDefs,
    retestPolicy: input.retestPolicy ?? 'last',
  };
}

// ── Notch helper ──────────────────────────────────────────────────────────────

function resolveNotch(
  waferOpts: WaferOptions | undefined,
): { type: 'top' | 'bottom' | 'left' | 'right' } | undefined {
  return waferOpts?.notch;
}

// ── Grid origin & axis helpers ────────────────────────────────────────────────

function detectOrigin(
  results: DieResult[],
  dieOpts: DieOptions | undefined,
): NonNullable<DieOptions['coordinateOrigin']> {
  if (dieOpts?.coordinateOrigin) return dieOpts.coordinateOrigin;
  if (results.length > 0 && results.every(p => p.x >= 0 && p.y >= 0)) {
    return { type: 'LL' };
  }
  return { type: 'center' };
}

function resolveGridOriginOffset(
  gridPoints: Array<{ x: number; y: number }>,
  origin: NonNullable<DieOptions['coordinateOrigin']>,
  ga: { offsetX: number; offsetY: number },
): { offsetX: number; offsetY: number } {
  if (origin.type === 'custom' && origin.offset) {
    return { offsetX: origin.offset.x, offsetY: origin.offset.y };
  }
  if (origin.type !== 'center') {
    const xs = gridPoints.map(p => p.x);
    const ys = gridPoints.map(p => p.y);
    return {
      offsetX: Math.round((Math.max(...xs) + Math.min(...xs)) / 2),
      offsetY: Math.round((Math.max(...ys) + Math.min(...ys)) / 2),
    };
  }
  return { offsetX: ga.offsetX, offsetY: ga.offsetY };
}

function resolveAxisFlips(
  dieOpts: DieOptions | undefined,
  origin: NonNullable<DieOptions['coordinateOrigin']>,
): { flipX: boolean; flipY: boolean } {
  let flipX = dieOpts?.xAxisDirection === 'left';
  let flipY = dieOpts?.yAxisDirection === 'down';

  if (origin.type === 'UL' || origin.type === 'UR') flipY = true;
  if (origin.type === 'LR' || origin.type === 'UR') flipX = true;

  return { flipX, flipY };
}

// ── Lot-stack aggregation ─────────────────────────────────────────────────────

function modeOf(values: number[]): number | null {
  if (!values.length) return null;
  const counts = new Map<number, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  let maxCount = 0;
  let result = values[0];
  for (const [v, count] of counts) {
    if (count > maxCount) { maxCount = count; result = v; }
  }
  return result;
}

function medianOf(sorted: number[]): number {
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function collapseLotStack(lotStack: NonNullable<WaferMapInput['lotStack']>): DieResult[] {
  const { results: waferResults, method, targetBin } = lotStack;
  const totalWafers = waferResults.length;

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

    const primaryBin = (pt: DieResult) => pt.bins?.[0];
    const primaryVal = (pt: DieResult): number | undefined => pt.values?.[0];

    if (method === 'countBin' && targetBin !== undefined) {
      result.push({ x, y, values: [points.filter(p => primaryBin(p) === targetBin).length] });

    } else if (method === 'percent' && targetBin !== undefined) {
      result.push({
        x, y,
        values: [(points.filter(p => primaryBin(p) === targetBin).length / totalWafers) * 100],
      });

    } else if (method === 'mean') {
      const vals = points.map(primaryVal).filter((v): v is number => v !== undefined);
      if (vals.length) result.push({ x, y, values: [vals.reduce((a, b) => a + b, 0) / vals.length] });

    } else if (method === 'median') {
      const vals = points
        .map(primaryVal)
        .filter((v): v is number => v !== undefined)
        .sort((a, b) => a - b);
      if (vals.length) result.push({ x, y, values: [medianOf(vals)] });

    } else if (method === 'stddev') {
      const vals = points.map(primaryVal).filter((v): v is number => v !== undefined);
      if (vals.length > 1) {
        const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
        const variance = vals.reduce((s, v) => s + (v - mean) ** 2, 0) / (vals.length - 1);
        result.push({ x, y, values: [Math.sqrt(variance)] });
      }

    } else if (method === 'mode') {
      const bins = points.map(primaryBin).filter((b): b is number => b !== undefined);
      const m = modeOf(bins);
      if (m !== null) result.push({ x, y, bins: [m] });
    }
  }

  return result;
}

// ── Coverage & yield ──────────────────────────────────────────────────────────

function computeCoverage(dies: Die[]): WaferMapResult['dataCoverage'] {
  const totalDies = dies.length;
  const edgeExcludedDies = dies.filter(d => d.edgeExcluded).length;
  const filledDies = dies.filter(
    d => (d.values?.length ?? 0) > 0 || (d.bins?.length ?? 0) > 0,
  ).length;
  return {
    filledDies,
    totalDies,
    edgeExcludedDies,
    ratio: totalDies > 0 ? filledDies / totalDies : 0,
  };
}

function computeYield(dies: Die[], passBins: number[]): YieldSummary {
  const passBinSet = new Set(passBins);
  const fullDies = dies.filter(d => !d.partial);
  const edgeExcludedDies = fullDies.filter(d => d.edgeExcluded).length;
  const partialDies = dies.filter(d => d.partial).length;

  let passDies = 0;
  let failDies = 0;
  let hasBinData = false;

  for (const die of fullDies) {
    if (die.edgeExcluded) continue;
    const bin = die.bins?.[0];
    if (bin !== undefined) {
      hasBinData = true;
      if (passBinSet.has(bin)) passDies++;
      else failDies++;
    }
  }

  const totalDies = passDies + failDies;
  return {
    passDies,
    failDies,
    edgeExcludedDies,
    partialDies,
    totalDies,
    yieldPercent: hasBinData && totalDies > 0 ? passDies / totalDies : null,
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
    const dx = die.x - wafer.center.x;
    const dy = die.y - wafer.center.y;
    return dx * dx + dy * dy > innerRadiusSq ? { ...die, edgeExcluded: true } : die;
  });
}

// ── Retest deduplication ──────────────────────────────────────────────────────

function applyRetestPolicy(
  results: DieResult[],
  policy: 'last' | 'first',
): DieResult[] {
  const counts = new Map<string, number>();
  for (const d of results) {
    const key = `${d.x},${d.y}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const winners = new Map<string, DieResult>();
  for (const d of results) {
    const key = `${d.x},${d.y}`;
    if (policy === 'first' && winners.has(key)) continue;
    winners.set(key, d);
  }

  return Array.from(winners.values()).map(d => {
    const count = counts.get(`${d.x},${d.y}`) ?? 1;
    return count > 1 ? { ...d, retestCount: count } : d;
  });
}

// ── Data attachment ───────────────────────────────────────────────────────────

function attachData(die: Die, pt: DieResult): Die {
  return {
    ...die,
    ...(pt.values      !== undefined ? { values:      pt.values      } : {}),
    ...(pt.bins        !== undefined ? { bins:        pt.bins        } : {}),
    ...(pt.retestCount !== undefined ? { retestCount: pt.retestCount } : {}),
  };
}

function autoPlotMode(results: DieResult[], opts: SceneOptions): PlotMode {
  if (opts.plotMode) return opts.plotMode;
  const hasValues = results.some(d => (d.values?.length ?? 0) > 0);
  return hasValues ? 'value' : 'hardbin';
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
 * const { data, layout } = toPlotly(result.scene);
 * Plotly.react('chart', data, layout);
 * ```
 *
 * @example Multiple tests and bins supplied directly:
 * ```ts
 * const result = buildWaferMap({
 *   results: rows.map(r => ({
 *     x: +r.x, y: +r.y,
 *     values: [+r.testA, +r.testB, +r.testC],
 *     bins:   [+r.hbin, +r.sbin],
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
  const { debug: _debug, ...sceneOpts } = options ?? {};

  const results: DieResult[] = applyRetestPolicy(
    norm.lotStackOpts ? collapseLotStack(norm.lotStackOpts) : norm.results,
    norm.retestPolicy,
  );

  const inference = {
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
        const pt = lookup.get(`${die.i},${die.j}`);
        return pt ? attachData(die, pt) : die;
      });
    }

    const diameter = norm.waferOpts?.diameter ?? 300;
    const wafer    = createWafer({
      diameter,
      notch:       resolveNotch(norm.waferOpts),
      orientation: norm.waferOpts?.orientation ?? 0,
      metadata:    norm.waferOpts?.metadata,
    });

    const reticles    = buildReticles(norm.reticleOpts, wafer, 1, 1);
    const showReticle = sceneOpts.showReticle ?? (norm.reticleOpts !== undefined);

    const scene = buildScene(wafer, dies, {
      ...sceneOpts,
      reticles,
      showReticle,
      plotMode:   autoPlotMode(results, sceneOpts),
      testDefs:   norm.testDefs,
      hbinDefs:   norm.hbinDefs,
      sbinDefs:   norm.sbinDefs,
      isLotStack: false,
    });

    return {
      wafer, dies, scene, reticleConfig: norm.reticleOpts, units: 'mm', inference,
      dataCoverage: computeCoverage(dies),
      yield: computeYield(dies, norm.passBins),
      reticles,
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

  let waferDiameter = norm.waferOpts?.diameter;

  if (waferDiameter === undefined) {
    if (ga.indices.length > 0) {
      const physPoints = ga.indices.map(({ i, j }) => ({ x: i * pitchX, y: j * pitchY }));
      const wi = inferWaferFromXY(physPoints);
      waferDiameter = wi.diameter;
      inference.wafer = { confidence: wi.confidence, method: wi.method };
    } else {
      waferDiameter = units === 'mm' ? 300 : 30;
      inference.wafer = { confidence: 0, method: 'default' };
    }
  }

  const wafer = createWafer({
    diameter:    waferDiameter,
    notch:       resolveNotch(norm.waferOpts),
    orientation: norm.waferOpts?.orientation ?? 0,
    metadata:    norm.waferOpts?.metadata,
  });

  const dieConfigGeom = { width: pitchX, height: pitchY };
  const allDies   = generateDies(wafer, dieConfigGeom);
  let dies        = clipDiesToWafer(allDies, wafer, dieConfigGeom);

  if (results.length > 0) {
    const lookup = new Map(results.map(d => [`${d.x},${d.y}`, d]));
    dies = dies.map(die => {
      const pt = lookup.get(`${die.i + offsetX},${die.j + offsetY}`);
      return pt ? attachData(die, pt) : die;
    });
  }

  // Shift i/j from centred grid indices to original input coordinates.
  // die.x/y (physical mm) remain unchanged — only the public identity fields move.
  if (offsetX !== 0 || offsetY !== 0) {
    dies = dies.map(die => ({
      ...die,
      i:  die.i + offsetX,
      j:  die.j + offsetY,
      id: `${die.i + offsetX}_${die.j + offsetY}`,
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
  const showReticle = sceneOpts.showReticle ?? (norm.reticleOpts !== undefined);

  const scene = buildScene(wafer, dies, {
    ...sceneOpts,
    reticles,
    showReticle,
    plotMode:     autoPlotMode(results, sceneOpts),
    testDefs:     norm.testDefs,
    hbinDefs:     norm.hbinDefs,
    sbinDefs:     norm.sbinDefs,
    dataAxisFlip: { x: flipX, y: flipY },
    isLotStack:   norm.lotStackOpts !== undefined,
  });

  return {
    wafer, dies, scene, reticleConfig: norm.reticleOpts, units, inference,
    dataCoverage: computeCoverage(dies),
    yield: computeYield(dies, norm.passBins),
    reticles,
  };
}
