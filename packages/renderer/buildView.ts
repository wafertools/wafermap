import type { Wafer } from '../core/wafer.js';
import type { Die } from '../core/dies.js';
import type { Reticle } from '../core/reticle.js';
import { getReticleCell } from '../core/reticle.js';
import type { DieMetadata, WaferMetadata } from '../core/metadata.js';
import {
  type Affine, affineRotation, affineMirror, affineCompose,
  affinePoint, affineVector, affineSwapsAxes,
} from '../core/transforms.js';
import { contrastTextColor, SPEC_PASS_FILL, SPEC_FAIL_LOW, SPEC_FAIL_HIGH } from './colorMap.js';
import { getColorScheme } from './colorSchemes.js';
import type { TestDef, BinDef, MetadataFieldDef, ReticleConfig } from './buildWaferMap.js';
import { getDieTestValue, getTestPassStatus, isParametricTest } from './buildWaferMap.js';
import { fmt, fmtColorbarAxis, fmtAggregationMethod } from './fmt.js';
import { metadataValueColor } from './colorMap.js';
import { compareNatural, clamp01 } from '../core/utils.js';
import { prettyKey } from '../core/utils.js';

type BinDefMap = Map<number, BinDef>;

/** Resolve a toolbar activeTest cursor to the canonical test number for getDieTestValue. */
export function resolveTestNumber(activeTest: number, testDefs?: TestDef[]): { testNumber: number; fallbackIndex: number } {
  if (testDefs?.length) {
    const def = findTestDef(testDefs, activeTest) ?? testDefs[0];
    return {
      testNumber:    def.testNumber ?? def.index ?? activeTest,
      fallbackIndex: def.index     ?? activeTest,
    };
  }
  return { testNumber: activeTest, fallbackIndex: activeTest };
}

/** Find a TestDef by its testNumber (or legacy index field). Returns undefined when testDefs is absent or no match. */
export function findTestDef(testDefs: TestDef[] | undefined, testNumber: number): TestDef | undefined {
  return testDefs?.find(t => (t.testNumber ?? t.index) === testNumber);
}

/** Return sorted unique test numbers present across a set of dies (from testValues keys). */
export function getUniqueTestNumbers(dies: Die[]): number[] {
  return [...new Set(dies.flatMap(d => d.testValues ? Object.keys(d.testValues).map(Number) : []))].sort((a, b) => a - b);
}

export type PlotMode = 'value' | 'hardBin' | 'softBin' | 'stackedValues' | 'stackedBins' | 'stackedSoftBins' | 'metadata';

interface Point {
  x: number;
  y: number;
}

export interface ViewRect {
  x: number;
  y: number;
  width: number;
  height: number;
  fill: string | number;
  type: 'hardBin' | 'softBin' | 'value' | 'stacked' | 'metadata';
  stack?: number[];
  metadata?: DieMetadata;
  /**
   * Out-of-spec indicator for value-mode dies drawn with the value gradient.
   * The die keeps its gradient fill (so the distribution stays readable) and the
   * renderer draws a ▽ (`failLow`) / △ (`failHigh`) marker on top so the die is
   * never shown as plain in-spec. Set in both `'spec'` and `'data'` colorbar
   * ranges. Absent only under `colorBySpec`, where the solid categorical fill is
   * itself the indication and no marker is needed.
   */
  specMark?: 'failLow' | 'failHigh';
}

export interface ViewText {
  x: number;
  y: number;
  text: string;
  fontSize: number;
  color: string;
  align: 'center';
  /** Marks fixed-size overlay labels (currently only the +X/+Y orientation
   *  indicators) so canvas-adapter excludes them from die-label uniform sizing.
   *  Absent = an ordinary die label; its `fontSize` here is a build-time
   *  (mm-space, zoom-unaware) default for non-canvas consumers of ViewText —
   *  canvas-adapter recomputes the actual on-screen size at draw time. */
  role?: 'indicator';
}

export interface ViewHoverPoint {
  x: number;
  y: number;
}

export interface ViewOverlay {
  kind: 'wafer-boundary' | 'reticle' | 'probe-path' | 'ring-boundary' | 'quadrant-boundary' | 'xy-indicator';
  points: Point[][];
  closed: boolean;
  lineColor: string;
  lineWidth: number;
  fill?: string;
}

export interface View {
  rectangles: ViewRect[];
  hoverPoints: ViewHoverPoint[];
  texts: ViewText[];
  overlays: ViewOverlay[];
  plotMode: PlotMode;
  colorScheme: string;
  metadata: WaferMetadata | null;
  dies: Die[];
  /** Actual [min, max] of the value data used for color normalization. */
  valueRange: [number, number];
  /** True when every observed value for the active test is a whole number. Drives integer-only colorbar ticks. */
  allIntegerValues?: boolean;
  /** Named test definitions — populated when `testDefs` is passed to `buildWaferMap`. */
  testDefs?: TestDef[];
  /** Which `values[]` index is being displayed (for `value` plot mode). Default 0. */
  activeTest: number;
  /** True when log₁₀ scale is both requested and valid (vMin > 0). */
  logScale: boolean;
  /**
   * True when log₁₀ scale was *requested* (option or per-test default), regardless of whether it
   * was applied. When `logScaleRequested && !logScale` the data range included ≤ 0 and the view
   * fell back to linear — the colorbar reports this as "linear — log n/a".
   */
  logScaleRequested: boolean;
  /** Aggregation method label for `stackedValues` hover tooltips (e.g. `'mean'`). */
  aggrMethod?: string;
  /** Total wafers in lot — for `stackedBins` hover percentage calculation. */
  lotSize?: number;
  /**
   * Total effective axis flip (data-pipeline flip XOR interactive flip).
   *
   * @deprecated for coordinate maths — this and {@link rotation} are a *lossy*
   * summary: a summed angle plus XOR'd flip flags cannot represent
   * rotate→mirror→rotate, because rotation and mirroring don't commute. They are
   * correct only while `wafer.orientation` is 0. Use {@link gridToScreen} (or its
   * inverse) for anything positional. Retained for display code that only needs a
   * rough orientation hint, and because it is read back as a data-flip hint below.
   */
  axisFlip: { x: boolean; y: boolean };
  /**
   * The data-pipeline axis flip ALONE (from `xAxisDirection`/`yAxisDirection`/
   * `coordinateOrigin`), with no interactive flip mixed in. `renderWaferMap` feeds
   * this back into `buildView` as `dataAxisFlip` on every rebuild; reading
   * {@link axisFlip} for that purpose double-counts an active interactive flip.
   */
  dataAxisFlip: { x: boolean; y: boolean };
  /** Total effective rotation in degrees (wafer orientation + interactive rotation). See {@link axisFlip} on why this is lossy. */
  rotation: number;
  /**
   * Die-grid geometry → screen. THE authoritative display transform: composed from
   * the real pipeline in order, so it stays correct for any combination of wafer
   * orientation, data-axis flip and interactive rotate/flip. Invert it
   * (`affineInvert`) to map a screen position back to a die-grid position — this is
   * what axis tick labels do.
   */
  gridToScreen: Affine<'grid', 'screen'>;
  /** True when reticle geometry is present — used to conditionally show the reticle toolbar button. */
  hasReticle: boolean;
  /** True when the scene was built from lot-aggregated data (lotStack). Controls toolbar stacked-mode visibility. */
  isLotStack: boolean;
  /**
   * The *effective* pass/fail display for value mode, resolved by the library
   * from the request and the data (never trust the caller's flag alone):
   * - `'spec'` — dies coloured by spec pass/fail against the active test's limits.
   * - `'test'` — dies coloured by the tester's recorded verdict
   *   (`getTestPassStatus`). Forced automatically when the active test is
   *   functional (`testType: 'F'`) — a functional test has no value to plot.
   * - `'off'`  — continuous value gradient (or a non-value plot mode).
   */
  passFailDisplay: 'off' | 'spec' | 'test';
  /** True when `passFailDisplay === 'spec'` — kept for back-compat with existing consumers. */
  colorBySpec: boolean;
  /** Whether the colorbar range is anchored to spec limits ('spec') or data extents ('data'). */
  colorbarRangeMode: 'spec' | 'data';
  /** Wafer centre in scene/display mm coordinates (the rotation pivot). */
  waferCenter: { x: number; y: number };
  /** Wafer radius in mm. */
  waferRadius: number;
  /** Unit vector pointing toward the notch/flat in display space (post-transform). Null when no notch. */
  notchDir: { x: number; y: number } | null;
  /** Bin → die count for the active bin mode (hardBin or softBin). Undefined in value modes. */
  binCounts?: Map<number, number>;
  /** Value → die count for the active metadata field, `'metadata'` mode only. */
  metadataCounts?: Map<string, number>;
  /**
   * Value → resolved fill colour for the active metadata field, `'metadata'` mode only. The
   * single source of truth for metadata colours — built from the same filtered die population
   * as `metadataCounts`, so legend swatches (built from this map) always match die fills (also
   * built from this map). Consumers must read this rather than recomputing colours from
   * `metadataCounts`'s keys, or the two can diverge in ranking whenever iteration order differs.
   */
  metadataColorMap?: Map<string, string> | null;
  /** Which `die.metadata` key is active in `'metadata'` mode. */
  activeMetadataKey?: string;
  /** Named metadata-field definitions — populated when `metadataFields` is passed to `buildWaferMap`. */
  metadataFields?: MetadataFieldDef[];
  /**
   * Per-category die counts for `value` + `colorBySpec` mode — drives the spec legend. Counts only
   * dies with a value (no-data dies excluded). Undefined outside spec mode.
   */
  specCounts?: { pass: number; failHigh: number; failLow: number };
  /**
   * Per-category die counts for `value` mode with `passFailDisplay: 'test'` — drives the
   * Pass/Fail legend. Counts only dies with a recorded verdict (no-data dies excluded).
   * Undefined outside test pass/fail display.
   */
  passFailCounts?: { pass: number; fail: number };
  /** Bounding box of all die centres in scene coordinates (mm). */
  dieBounds: { minX: number; maxX: number; minY: number; maxY: number } | null;
}

export interface ViewOptions {
  plotMode?: PlotMode;
  showDieLabels?: boolean;
  showReticle?: boolean;
  showProbePath?: boolean;
  ringCount?: number;
  showRingBoundaries?: boolean;
  showQuadrantBoundaries?: boolean;
  showXYIndicator?: boolean;
  dieGap?: number;
  /** Named colour scheme — any scheme registered via registerColorScheme(). Default: 'default'. */
  colorScheme?: string;
  highlightBin?: number;
  /** Dim every die except this metadata value, `'metadata'` mode's analogue of `highlightBin`. */
  highlightMetadataValue?: string;
  interactiveTransform?: { rotation?: number; flipX?: boolean; flipY?: boolean };
  /**
   * Explicit value colour normalization range.
   *
   * - Tuple `[min, max]`: applied to whichever test is active. The caller is
   *   responsible for keeping it consistent with `activeTest`.
   * - Object `{ test, range }`: applied **only** when `test` matches the active
   *   test. On mismatch the range is ignored and the scene auto-scales — this
   *   makes it impossible to colour one test's data against another test's
   *   range. Prefer this form when the range was computed for a specific test.
   *
   * When omitted entirely, the range is auto-computed from the die values present.
   */
  valueRange?: [number, number] | { test: number; range: [number, number] };
  /**
   * Controls the default colorbar range when the active testDef has spec limits.
   * `'spec'` (default when limits present): colorbar spans [limitLow, limitHigh].
   * `'data'`: colorbar spans the actual data min/max regardless of limits.
   */
  colorbarRangeMode?: 'spec' | 'data';
  /**
   * Reticle rectangles to overlay on the map.
   * Generated by `generateReticleGrid` or the `reticle` option on `buildWaferMap`.
   */
  reticles?: Reticle[];
  /** Named test definitions — one per `values[]` entry. */
  testDefs?: TestDef[];
  /**
   * Which `values[]` index to display in `value` plot mode. Default `0`.
   * When `testDefs` is provided, the toolbar mode dropdown offers one item per test.
   */
  activeTest?: number;
  /**
   * Which `die.metadata` key to display in `'metadata'` plot mode. Must match
   * a `key` in `metadataFields` (passed to `buildWaferMap`, not here — see
   * the `binDefs` parameter of `buildView`) for the field to be colored/
   * legended; dies without that key set render as no-data.
   */
  activeMetadataKey?: string;
  /**
   * When true, apply log₁₀ scale to value normalization and the colorbar.
   * Overrides the per-test `TestDef.logScale` default.
   * Falls back to linear when vMin ≤ 0.
   */
  logScale?: boolean;
  /**
   * Format to use for unitless values outside the normal display range [0.1, 9999].
   * `'engineering'` (default): multiples-of-3 exponent notation (e.g. `12E-6`).
   * `'si'`: SI prefix with no unit suffix (e.g. `12 µ`).
   * Values with a unit always use SI prefix regardless of this setting.
   */
  fallbackFormat?: 'si' | 'engineering';
  /**
   * Aggregation method label shown in hover tooltips for `stackedValues` mode.
   * E.g. `'mean'`, `'median'`, `'stddev'`, `'min'`, `'max'`.
   */
  aggregationMethod?: string;
  /**
   * Total number of wafers in the lot — used to compute bin occurrence percentage
   * in `stackedBins` hover tooltips.
   */
  lotSize?: number;
  /**
   * Axis flip baked in by the data pipeline (for LL/LR/UL/UR origins or explicit
   * `xAxisDirection`/`yAxisDirection`). Combined with `interactiveTransform` flip
   * to produce the total effective axis flip for tick labels.
   */
  dataAxisFlip?: { x: boolean; y: boolean };
  /** Set to true when the scene is built from lot-aggregated data (lotStack). */
  isLotStack?: boolean;
  /**
   * Requested pass/fail display for `value` mode. The library resolves the
   * *effective* display from this request and the data (see `View.passFailDisplay`):
   * - `'spec'` — colour dies by spec pass/fail against the active test's limits
   *   (solid green / blue fail-low / red fail-high). Degrades to `'off'` when the
   *   active test has no limits.
   * - `'test'` — colour dies by the tester's recorded pass/fail verdict
   *   (`die.testPass`, via `getTestPassStatus`; solid green pass / red fail).
   *   Degrades to `'off'` when no die has a recorded verdict for the active test.
   * - `'off'` (default) — continuous value gradient.
   * A functional active test (`testType: 'F'`) always renders as `'test'`
   * regardless of this option — it has no value to plot.
   */
  passFailDisplay?: 'off' | 'spec' | 'test';
  /**
   * @deprecated Use `passFailDisplay: 'spec'` instead. `colorBySpec: true` is an
   * alias for `passFailDisplay: 'spec'`; ignored when `passFailDisplay` is set.
   */
  colorBySpec?: boolean;
  /**
   * When true (default), partial (edge) dies — positions that only partially
   * overlap the wafer circle — are rendered in a muted grey.
   * Set to false to hide them entirely, matching real prober behaviour where
   * edge positions are never tested.
   */
  showPartialDies?: boolean;
}


interface ColorFns {
  forValue: (t: number) => string;
  forBin: (bin: number) => string;
}

const PARTIAL_DIE_FILL = '#d3d6db';
const DIM_FILL = '#e8e9ea';
const EDGE_EXCLUDED_FILL = '#eceef0';
const NO_DATA_FILL     = '#d6d9dd';

/**
 * Read `die.metadata[key]` for `'metadata'` plot mode, stringified. Non-primitive values
 * (objects/arrays) and missing values both resolve to `undefined` (no-data) — there is no
 * sensible swatch/colour for `[object Object]`. The single read-path for every metadata-mode
 * consumer (die fill, text overlay, distinct-value/colour-map scan) so they can never diverge
 * on which dies count as having a value.
 */
function getDieMetadataValue(die: Die, key: string | undefined): string | undefined {
  const raw = key ? die.metadata?.[key] : undefined;
  return raw !== undefined && raw !== null &&
    (typeof raw === 'string' || typeof raw === 'number' || typeof raw === 'boolean')
    ? String(raw) : undefined;
}

/** A die's spec classification for `value` mode against the active test's limits. */
export type SpecCategory = 'pass' | 'failHigh' | 'failLow';

/**
 * Classify a value against the active test's spec limits, using the SAME rules as the value-mode
 * die colouring in `pushDieRectangles`. Returns null when there is no value. Shared by the colour
 * branch and the spec-count tally so the two never diverge.
 *
 * Out-of-spec *classification* depends ONLY on whether limits are defined — never on
 * `colorbarRangeMode`. An out-of-spec die is always flagged when limits exist, regardless of
 * how the colorbar is scaled. The *form* of the indication, decided in `pushDieRectangles`,
 * depends only on `colorBySpec`: under `colorBySpec` (pass/fail mode) the die gets a solid
 * green/blue/red categorical fill; in normal value/gradient mode it keeps the value gradient
 * fill (like every other die, so the distribution stays readable and out-of-spec colours don't
 * collide with the scheme) and is flagged with a ▽/△ marker (`ViewRect.specMark`). Either way
 * the die is never drawn as plain in-spec — the silent correctness bug this guards against.
 */
export function classifySpec(
  value: number | undefined,
  activeTestDef: { limitLow?: number; limitHigh?: number } | undefined,
): SpecCategory | null {
  if (value === undefined) return null;
  if (activeTestDef?.limitLow !== undefined && value < activeTestDef.limitLow) return 'failLow';
  if (activeTestDef?.limitHigh !== undefined && value > activeTestDef.limitHigh) return 'failHigh';
  return 'pass';
}

/**
 * The complete set of display transforms for one view, each tagged with the
 * coordinate frame it starts from. Built once per `buildView` by composing the
 * real pipeline in order, so a caller picks a frame rather than re-deriving
 * "which subset of the transforms has already been applied to my input?" — the
 * question that previously had four different, partly-wrong answers in this file
 * and produced a family of misplaced-overlay bugs.
 *
 * The real pipeline, in order:
 * ```
 *   physical --rot(wafer.orientation)--> [bake-rot]
 *            --mirror(dataAxisFlip)----> baked        (done in buildWaferMap)
 *            --rot(interactive)--------> [live-rot]
 *            --mirror(interactive)-----> screen       (done here)
 * ```
 */
interface ViewTransforms {
  /**
   * Physical wafer features (boundary/notch, ring and quadrant borders) → screen.
   * Deliberately EXCLUDES the data-axis flip: that flip exists to make the render
   * physically truthful for a prober convention (`yAxisDirection: 'down'` ⇒ row 1
   * at the top), so the wafer itself must hold still while the die grid moves
   * relative to it.
   */
  physicalToScreen: Affine<'physical', 'screen'>;
  /**
   * Die-grid-aligned geometry generated in the pre-bake frame (reticle fields,
   * the +X/+Y indicator directions, die rectangle shape) → screen. INCLUDES the
   * data-axis flip, because this geometry must stay locked to the dies.
   */
  gridToScreen: Affine<'grid', 'screen'>;
  /** Already-baked die centres (`Die.physX`/`physY`) → screen: interactive only. */
  bakedToScreen: Affine<'baked', 'screen'>;
}

function buildViewTransforms(
  wafer: Wafer,
  dataAxisFlip: { x: boolean; y: boolean } | undefined,
  interactiveTransform: ViewOptions['interactiveTransform'],
): ViewTransforms {
  const { x: cx, y: cy } = wafer.center;

  // Both pre-bake frames land in the same post-bake display space ('baked'); they
  // differ only in whether the data-axis mirror is part of the route there.
  const physicalToBaked = affineRotation<'physical', 'baked'>(wafer.orientation, cx, cy);
  const gridToBaked = affineCompose(
    affineMirror<'physical', 'baked'>(dataAxisFlip?.x ?? false, dataAxisFlip?.y ?? false, cx, cy),
    affineRotation<'grid', 'physical'>(wafer.orientation, cx, cy),
  );

  const bakedToScreen = affineCompose(
    affineMirror<'baked', 'screen'>(interactiveTransform?.flipX ?? false, interactiveTransform?.flipY ?? false, cx, cy),
    affineRotation<'baked', 'baked'>(interactiveTransform?.rotation ?? 0, cx, cy),
  );

  return {
    bakedToScreen,
    physicalToScreen: affineCompose(bakedToScreen, physicalToBaked),
    gridToScreen:     affineCompose(bakedToScreen, gridToBaked),
  };
}

function polyline(points: Point[], close = false): { points: Point[][]; closed: boolean } {
  return { points: [points], closed: close };
}

/**
 * Returns the boundary point at `angle` for a wafer with an orientation flat
 * (chord cut).  V-notch wafers are handled separately in buildBoundaryOverlay.
 */
function boundaryPointAtAngle(wafer: Wafer, angle: number): Point {
  const { center, radius, notch } = wafer;
  let x = center.x + radius * Math.cos(angle);
  let y = center.y + radius * Math.sin(angle);

  if (!notch) return { x, y };

  const chordDist = Math.sqrt(radius ** 2 - (notch.length / 2) ** 2);
  const halfLen   = notch.length / 2;
  const dx = x - center.x;
  const dy = y - center.y;

  if (notch.type === 'bottom' && dy < -chordDist) {
    y = center.y - chordDist;
    x = center.x + Math.max(-halfLen, Math.min(halfLen, dx));
  } else if (notch.type === 'top' && dy > chordDist) {
    y = center.y + chordDist;
    x = center.x + Math.max(-halfLen, Math.min(halfLen, dx));
  } else if (notch.type === 'left' && dx < -chordDist) {
    x = center.x - chordDist;
    y = center.y + Math.max(-halfLen, Math.min(halfLen, dy));
  } else if (notch.type === 'right' && dx > chordDist) {
    x = center.x + chordDist;
    y = center.y + Math.max(-halfLen, Math.min(halfLen, dy));
  }

  return { x, y };
}


function formatValueLabel(values: number[], tickFmt: (v: number) => string): string {
  return values.map(tickFmt).join(' / ');
}


/** Build a 256-entry lookup table for a continuous colour mapper. */
function buildColorLut(forValue: (t: number) => string, steps = 256): (t: number) => string {
  const lut = Array.from({ length: steps }, (_, i) => forValue(i / (steps - 1)));
  return (t: number) => lut[Math.min(steps - 1, Math.max(0, Math.round(t * (steps - 1))))];
}


function fontSizeForDie(die: Die, text: string): number {
  const minSide = Math.max(1, Math.min(die.width, die.height));
  const widthBudget = die.width / Math.max(text.length, 1);
  return Math.max(8, Math.min(16, Math.round(Math.min(minSide * 0.55, widthBudget * 1.8))));
}

/** One displayable test row for the hover tooltip: a label, a formatted value, and the
 * test's key (testNumber/index) so the active test can be located. Unifies the
 * testValues path, the recorded pass/fail path (`testPass`), and the deprecated
 * values[] path so the tooltip builder has a single source. Skips tests with no
 * result for this die.
 *
 * Row content per test kind:
 * - parametric: the formatted value; a `(recorded fail)` note is appended when the
 *   tester's recorded verdict for the test is fail — a fail verdict is always
 *   noteworthy, whereas annotating every passing row would be noise.
 * - functional: the verdict itself — `Pass` / `Fail` (via getTestPassStatus, so
 *   legacy 0/1-encoded data reads correctly). */
function collectTestRows(
  die: Die,
  testDefs: TestDef[] | undefined,
  fallbackFormat?: 'si' | 'engineering',
): Array<{ key: number; label: string; value: string }> {
  if (testDefs?.length) {
    const rows = testDefs.flatMap(def => {
      const key = def.testNumber ?? def.index;
      if (key === undefined) return [];
      if (!isParametricTest(def)) {
        const p = getTestPassStatus(die, key, def);
        if (p === undefined) return [];
        return [{ key, label: def.name, value: p ? 'Pass' : 'Fail' }];
      }
      const v = getDieTestValue(die, key, def.index);
      if (v === undefined) return [];
      const recordedFail = die.testPass?.[key] === false ? ' <i>(recorded fail)</i>' : '';
      return [{ key, label: def.name, value: `${fmt(v, def.unit, fallbackFormat)}${recordedFail}` }];
    });
    if (rows.length) return rows;
  }
  if (die.testValues && Object.keys(die.testValues).length > 0) {
    return Object.entries(die.testValues).map(([k, v]) => ({
      key: Number(k), label: `Test ${k}`, value: fmt(v, undefined, fallbackFormat),
    }));
  }
  if (die.values?.length) {
    // Deprecated positional values[].
    return die.values.map((v, i) => {
      const def = testDefs?.find(t => t.index === i);
      return { key: i, label: def?.name ?? `Test ${i}`, value: fmt(v, def?.unit, fallbackFormat) };
    });
  }
  // Verdict-only dies with no matching defs: a recorded pass/fail is still a result.
  if (die.testPass && Object.keys(die.testPass).length > 0) {
    return Object.entries(die.testPass).map(([k, p]) => ({
      key: Number(k), label: `Test ${k}`, value: p ? 'Pass' : 'Fail',
    }));
  }
  return [];
}

export function buildHoverText(
  die: Die,
  plotMode: PlotMode,
  testDefs?: TestDef[],
  hbinDefs?: BinDef[],
  sbinDefs?: BinDef[],
  fallbackFormat?: 'si' | 'engineering',
  aggrMethod?: string,
  lotSize?: number,
  /** @deprecated No longer used. The tooltip is now compact and mode-aware (value mode
   * leads with the active test + a "+N more" summary; bin modes show a test-value
   * count), so it never lists tests up to a cap. Kept for positional back-compat. */
  testLimit?: number,
  waferMeta?: WaferMetadata | null,
  /** Active test number (value mode only) — leads the tooltip and gets an out-of-spec note. */
  activeTest?: number,
  /** Reticle geometry, when configured — appended as a "Reticle (col, row)" line below Die (x, y). */
  reticleConfig?: ReticleConfig,
): string {
  const hbinMap = hbinDefs ? new Map(hbinDefs.map(d => [d.bin, d])) : null;
  const sbinMap = sbinDefs ? new Map(sbinDefs.map(d => [d.bin, d])) : null;
  const lines: string[] = [`Die (${die.x}, ${die.y})`];
  if (reticleConfig) {
    const cell = getReticleCell(die, reticleConfig);
    lines.push(`Reticle (${cell.column}, ${cell.row})`);
  }

  if (plotMode === 'stackedValues') {
    // Aggregated scalar is stored in testValues[0] (preferred) or values[0] (deprecated).
    const v = getDieTestValue(die, 0, 0);
    if (v !== undefined) {
      const def   = testDefs?.[0];
      const tn    = def?.testNumber ?? def?.index;
      const name  = def?.name ?? (tn != null ? `Test ${tn}` : 'Value');
      const method = aggrMethod ? ` (${aggrMethod})` : '';
      lines.push(`${name}${method}: ${fmt(v, def?.unit, fallbackFormat)}`);
    }
  } else if (plotMode === 'stackedBins' || plotMode === 'stackedSoftBins') {
    const value = getDieTestValue(die, 0, 0);
    const bin   = plotMode === 'stackedSoftBins' ? die.sbin : die.hbin;
    if (value !== undefined) {
      const defMap  = plotMode === 'stackedSoftBins' ? sbinMap : hbinMap;
      const binLabel = bin !== undefined
        ? (defMap?.get(bin)?.name ? `${bin} · ${defMap.get(bin)!.name}` : `Bin ${bin}`)
        : 'Bin';
      // The aggregated scalar's meaning depends on the lot-stack method:
      //  - 'percent'  → value is ALREADY a percentage; show it as N%, never derive
      //    a second (count/lotSize) percentage (which produced nonsense like "250%").
      //  - countBin/default → value is an occurrence count; optionally annotate with
      //    its share of the lot.
      let valueText: string;
      if (aggrMethod === 'percent') {
        valueText = `${value.toFixed(0)}%`;
      } else {
        const pct = lotSize ? ` (${((value / lotSize) * 100).toFixed(0)}% of lot)` : '';
        valueText = `${value}${pct}`;
      }
      // Name the aggregation method so an engineer knows whether they are reading
      // an occurrence count or a percentage.
      const method = aggrMethod ? ` [${fmtAggregationMethod(aggrMethod)}]` : '';
      lines.push(`${binLabel}: ${valueText}${method}`);
    }
  } else {
    // Standard modes (value / hardBin / softBin). The tooltip stays COMPACT — it is a
    // transient, non-scrollable hover element, so it never lists every test (which
    // becomes a full-height block on dies with many parametric tests). The form is
    // mode-aware:
    //  - value mode: lead with the ACTIVE (plotted) test, then summarise the rest as
    //    "+N more tests". Only value mode has a privileged test to show.
    //  - bin modes: the bin verdict is primary; no single test is privileged, so the
    //    tests collapse to a "N test values recorded" count rather than an arbitrary list.
    const testRows = collectTestRows(die, testDefs, fallbackFormat);

    if (plotMode === 'value' && testRows.length) {
      // Resolve the active test; fall back to the first available row if it is
      // unresolvable or has no result for this die. Rows exist only for tests
      // with a result (value or verdict), so locating by key covers both
      // parametric and functional active tests.
      const { testNumber, fallbackIndex } = resolveTestNumber(activeTest ?? 0, testDefs);
      const activeDef = findTestDef(testDefs, testNumber);
      const activeVal = getDieTestValue(die, testNumber, fallbackIndex);
      let leadIdx = testRows.findIndex(r => r.key === testNumber);
      if (leadIdx < 0) leadIdx = 0; // degrade: lead with the first present test
      const lead = testRows[leadIdx];

      let leadLine = `<b>${lead.label}: ${lead.value}</b>`;
      // Note out-of-spec status for the active test (complements the ▽/△ die markers).
      if (lead.key === testNumber && activeDef) {
        const spec = classifySpec(activeVal, activeDef);
        if (spec === 'failLow' || spec === 'failHigh') leadLine += ' <i>(out of spec)</i>';
      }
      lines.push(leadLine);

      const more = testRows.length - 1;
      if (more > 0) lines.push(`<i>+${more} more test${more === 1 ? '' : 's'}</i>`);
    } else if (testRows.length) {
      // Bin modes: collapse the tests to a count — the bin lines below are primary.
      // "results" not "values": functional verdicts count too.
      const n = testRows.length;
      lines.push(`<i>${n} test result${n === 1 ? '' : 's'} recorded</i>`);
    }

    if (die.hbin !== undefined || die.sbin !== undefined) {
      const parts: string[] = [];
      if (die.hbin !== undefined) {
        const name  = hbinMap?.get(die.hbin)?.name;
        const value = name ? `${die.hbin} · ${name}` : String(die.hbin);
        parts.push(`HBin: ${value}`);
      }
      if (die.sbin !== undefined) {
        const name  = sbinMap?.get(die.sbin)?.name;
        const value = name ? `${die.sbin} · ${name}` : String(die.sbin);
        parts.push(`SBin: ${value}`);
      }
      lines.push(parts.join(' &nbsp;·&nbsp; '));
    }
  }

  if (die.retestCount !== undefined) lines.push(`Retests: ${die.retestCount}`);
  if (die.siteNum     !== undefined) lines.push(`Site: ${die.siteNum}`);
  if (die.partId      !== undefined) lines.push(`Part ID: ${die.partId}`);
  if (die.partial) lines.push('<i>partial die</i>');
  if (die.probeIndex !== undefined) lines.push(`Probe: #${die.probeIndex}`);

  // Metadata: wafer-level facts (lot, wafer id, product, program, …) are the
  // base; any per-die key overrides the wafer value of the same name. wmap is
  // unopinionated about which fields belong in a tooltip — it renders whatever
  // keys the host supplies, so control over tooltip content lives in the
  // host-provided metadata.
  const meta: Record<string, unknown> = { ...(waferMeta ?? {}), ...(die.metadata ?? {}) };
  for (const [key, value] of Object.entries(meta)) {
    if (value === undefined || value === null) continue;
    lines.push(`${key}: ${String(value)}`);
  }

  return lines.join('<br>');
}

/**
 * The on-canvas map title split into two parts for placement around the colorbar/legend:
 * - `primary`   — the most important identifier, drawn ABOVE the colorbar/legend.
 * - `secondary` — supporting context (stack/wafer-count), drawn BELOW it. Empty when not needed.
 */
export interface MapTitleParts {
  primary: string;
  secondary: string;
}

/**
 * Build the on-canvas map title for any plot mode, derived from the View (+ optional bin defs so a
 * single-bin stacked card can name its bin). Returns a primary/secondary split so the renderer can
 * place the key identifier above the scale and the supporting context below it — keeping each line
 * short and never obscured.
 *
 * Primary / secondary per mode:
 * - value            → "{name} ({unit})"            / —
 * - stackedValues    → "{name} ({unit}) · {method}" / "stacked ({n} wafers)"
 * - hardBin/softBin  → "Hard Bin" / "Soft Bin"      / —
 * - stackedBins      → "Hard Bin {bin}" (or "Hard Bin") / "stacked ({n} wafers)"
 * - stackedSoftBins  → "Soft Bin {bin}" (or "Soft Bin") / "stacked ({n} wafers)"
 *
 * @param fallbackFormat unitless value formatting — matches the colorbar tick formatting.
 * @param binDefs the active bin defs (hbinDefs for hard modes, sbinDefs for soft) — used to name
 *   the bin on single-bin stacked cards.
 */
export function buildMapTitle(
  view: View,
  fallbackFormat: 'si' | 'engineering' = 'engineering',
  binDefs?: BinDef[],
): MapTitleParts {
  // Supporting context for stacked maps, e.g. "stacked (6 wafers)".
  const stackedContext =
    view.isLotStack && view.lotSize !== undefined
      ? `stacked (${view.lotSize} ${view.lotSize === 1 ? 'wafer' : 'wafers'})`
      : 'stacked';

  // Name the single bin a stacked-bin card represents, e.g. "Hard Bin 2" or "Hard Bin 2 · Leakage".
  const stackedBinPrimary = (kind: 'Hard' | 'Soft'): string => {
    const def = binDefs?.length === 1 ? binDefs[0] : undefined;
    if (def === undefined) return `${kind} Bin`;
    return def.name ? `${kind} Bin ${def.bin} · ${def.name}` : `${kind} Bin ${def.bin}`;
  };

  switch (view.plotMode) {
    case 'hardBin':
      return { primary: 'Hard Bin', secondary: '' };
    case 'softBin':
      return { primary: 'Soft Bin', secondary: '' };
    case 'stackedBins':
      return { primary: stackedBinPrimary('Hard'), secondary: stackedContext };
    case 'stackedSoftBins':
      return { primary: stackedBinPrimary('Soft'), secondary: stackedContext };
    case 'metadata': {
      const def = view.metadataFields?.find(f => f.key === view.activeMetadataKey);
      const fallback = view.activeMetadataKey ? prettyKey(view.activeMetadataKey) : 'Metadata';
      return { primary: def?.label ?? fallback, secondary: '' };
    }
    case 'stackedValues': {
      const def = view.testDefs?.[0];
      const vRef = view.valueRange[1] || view.valueRange[0] || 0;
      const { axisLabel } = fmtColorbarAxis(vRef, def?.name, def?.unit, fallbackFormat);
      const base = axisLabel || 'Value';
      const method = view.aggrMethod ? ` · ${fmtAggregationMethod(view.aggrMethod)}` : '';
      return { primary: `${base}${method}`, secondary: stackedContext };
    }
    case 'value':
    default: {
      const def = findTestDef(view.testDefs, view.activeTest);
      const vRef = view.valueRange[1] || view.valueRange[0] || 0;
      const { axisLabel } = fmtColorbarAxis(vRef, def?.name, def?.unit, fallbackFormat);
      const named = axisLabel || def?.name;
      if (view.passFailDisplay !== 'off') {
        // Pass/fail display: identify the test (name + number) above the legend, and name
        // WHICH pass/fail is shown below it — spec-limit judgement vs the tester's recorded
        // verdict — so the two can never be confused even when they disagree.
        const num = def?.testNumber ?? def?.index ?? view.activeTest;
        const primary = named ? `${named} · #${num}` : `Test ${num}`;
        const secondary = view.passFailDisplay === 'spec'
          ? 'Spec pass/fail'
          : (def !== undefined && !isParametricTest(def))
            ? 'Functional pass/fail'
            : 'Tester pass/fail';
        return { primary, secondary };
      }
      return { primary: named ?? `Test ${view.activeTest}`, secondary: '' };
    }
  }
}


export function generateTextOverlay(
  dies: Die[],
  txCoords: Float64Array | null,
  options: {
    plotMode: PlotMode;
    colorFns: ColorFns;
    normalize: (v: number) => number;
    activeTest: number;
    valueRange: [number, number];
    testDefs?: TestDef[];
    fallbackFormat?: 'si' | 'engineering';
    /** Effective pass/fail display (see View.passFailDisplay). 'test' renders P/F verdict labels. */
    passFailDisplay?: 'off' | 'spec' | 'test';
    /** Active `die.metadata` key + its resolved value→color map, `'metadata'` mode only. */
    activeMetadataKey?: string;
    metadataColorMap?: Map<string, string> | null;
  },
): ViewText[] {
  const { plotMode, colorFns, normalize, activeTest, valueRange, testDefs, fallbackFormat, passFailDisplay = 'off', activeMetadataKey, metadataColorMap } = options;

  // Build a tick formatter matched to the colorbar scale so die labels are consistent.
  const testDef = findTestDef(testDefs, activeTest);
  const { tickFmt } = fmtColorbarAxis(valueRange[1], testDef?.name, testDef?.unit, fallbackFormat);
  const { testNumber: tn, fallbackIndex: fi } = resolveTestNumber(activeTest, testDefs);

  return dies.flatMap((die, i) => {
    let text = '';
    let color = '#111111';

    if (plotMode === 'value' && passFailDisplay === 'test') {
      // Test pass/fail display: the die shows the verdict, so the label does too —
      // contrast is computed against the solid verdict fill, not the gradient.
      const p = getTestPassStatus(die, tn, testDef);
      if (p === undefined) return [];
      text = p ? 'P' : 'F';
      color = contrastTextColor(p ? SPEC_PASS_FILL : SPEC_FAIL_HIGH);
    } else if (plotMode === 'value') {
      const v = getDieTestValue(die, tn, fi);
      if (v === undefined) return [];
      text = formatValueLabel([v], tickFmt);
      color = contrastTextColor(colorFns.forValue(normalize(v)));
    } else if (plotMode === 'hardBin' || plotMode === 'softBin') {
      const bin = plotMode === 'softBin' ? die.sbin : die.hbin;
      if (bin === undefined) return [];
      text = String(bin);
      color = contrastTextColor(colorFns.forBin(bin));
    } else if (plotMode === 'metadata') {
      const value = getDieMetadataValue(die, activeMetadataKey);
      if (value === undefined) return [];
      text = value;
      color = contrastTextColor(metadataColorMap?.get(text) ?? NO_DATA_FILL);
    } else {
      // stackedValues / stackedBins: aggregated scalar in testValues[0] or values[0]
      const v = getDieTestValue(die, 0, 0);
      if (v === undefined) return [];
      text = formatValueLabel([v], tickFmt);
      color = contrastTextColor(colorFns.forValue(normalize(v)));
    }

    const physX = txCoords ? txCoords[i * 2]     : die.physX;
    const physY = txCoords ? txCoords[i * 2 + 1] : die.physY;
    return [{
      x: physX,
      y: physY,
      text,
      fontSize: fontSizeForDie(die, text),
      color,
      align: 'center',
    }];
  });
}

/**
 * Notch direction angle in radians.
 * Wafer convention: bottom notch points downward (−Y), which is angle −π/2.
 */
function notchAngle(type: 'top' | 'bottom' | 'left' | 'right'): number {
  if (type === 'top')    return  Math.PI / 2;
  if (type === 'bottom') return -Math.PI / 2;
  if (type === 'left')   return  Math.PI;
  return 0; // right
}

/**
 * Build the wafer boundary overlay, choosing between two rendering modes:
 *
 * - **Flat** (≤ 150 mm): straight chord cut — `boundaryPointAtAngle` handles it.
 * - **V-notch** (> 150 mm): three explicit points (entry → apex → exit) are
 *   spliced into the uniform circle trace so the notch renders as a sharp
 *   triangular indentation (~3.5 mm wide, ~1.25 mm deep — SEMI M1 standard).
 */
function buildBoundaryOverlay(wafer: Wafer, toScreen: Affine<'physical', 'screen'>, steps = 720): ViewOverlay[] {
  const { center, radius, notch } = wafer;
  const tx = (p: Point): Point => affinePoint(toScreen, p.x, p.y);

  // Determine rendering style from diameter — same threshold used in resolveNotch.
  const isVNotch = notch !== undefined && wafer.diameter > 150;

  if (!isVNotch) {
    // Flat / no alignment feature — uniform angle sweep with chord clamping.
    const points: Point[] = [];
    for (let index = 0; index <= steps; index++) {
      const angle = (2 * Math.PI * index) / steps;
      points.push(tx(boundaryPointAtAngle(wafer, angle)));
    }
    return [{ kind: 'wafer-boundary', ...polyline(points, true), lineColor: '#888888', lineWidth: 1 }];
  }

  // V-notch: build circle, then splice in the triangular indentation.
  // SEMI M1: half-width at surface ≈ 1.75 mm, depth ≈ 1.25 mm.
  const notchDepth     = 1.25;
  const notchHalfWidth = notch.length; // set by createWafer = 1.75 for large wafers
  const θ0             = notchAngle(notch.type);
  const Δ              = Math.atan2(notchHalfWidth, radius); // angular half-span (~0.67° for 300 mm)
  const apexRadius     = radius - notchDepth;

  // Collect uniform circle points, skipping any that fall inside the notch zone.
  const points: Point[] = [];
  let notchInserted = false;

  for (let index = 0; index <= steps; index++) {
    const angle = (2 * Math.PI * index) / steps;

    // Normalise angle difference to (−π, π].
    let dθ = angle - θ0;
    while (dθ >  Math.PI) dθ -= 2 * Math.PI;
    while (dθ < -Math.PI) dθ += 2 * Math.PI;

    if (Math.abs(dθ) <= Δ) {
      // Inside the notch arc — insert V geometry once at this crossing.
      if (!notchInserted) {
        notchInserted = true;
        const entry = { x: center.x + radius * Math.cos(θ0 - Δ), y: center.y + radius * Math.sin(θ0 - Δ) };
        const apex  = { x: center.x + apexRadius * Math.cos(θ0), y: center.y + apexRadius * Math.sin(θ0) };
        const exit_ = { x: center.x + radius * Math.cos(θ0 + Δ), y: center.y + radius * Math.sin(θ0 + Δ) };
        points.push(tx(entry), tx(apex), tx(exit_));
      }
      continue;
    }

    points.push(tx({ x: center.x + radius * Math.cos(angle), y: center.y + radius * Math.sin(angle) }));
  }

  return [{ kind: 'wafer-boundary', ...polyline(points, true), lineColor: '#888888', lineWidth: 1 }];
}

function buildRingOverlays(wafer: Wafer, toScreen: Affine<'physical', 'screen'>, ringCount: number, steps = 360): ViewOverlay[] {
  const overlays: ViewOverlay[] = [];
  const safeRingCount = Math.max(1, Math.floor(ringCount));

  for (let ring = 1; ring < safeRingCount; ring++) {
    const radius = (wafer.radius * ring) / safeRingCount;
    const points: Point[] = [];

    for (let index = 0; index <= steps; index++) {
      const angle = (2 * Math.PI * index) / steps;
      const localPoint = {
        x: wafer.center.x + radius * Math.cos(angle),
        y: wafer.center.y + radius * Math.sin(angle),
      };
      points.push(affinePoint(toScreen, localPoint.x, localPoint.y));
    }

    overlays.push({
      kind: 'ring-boundary',
      ...polyline(points, true),
      lineColor: 'rgba(255,255,255,0.7)',
      lineWidth: 1.5,
    });
  }

  return overlays;
}

function buildQuadrantOverlays(wafer: Wafer, toScreen: Affine<'physical', 'screen'>, splitX: number, splitY: number): ViewOverlay[] {
  const { x: cx, y: cy } = wafer.center;
  const r = wafer.radius;
  const tx = (x: number, y: number): Point => affinePoint(toScreen, x, y);

  // Vertical chord at x = splitX.
  const dxV = splitX - cx;
  const dyV = Math.sqrt(Math.max(0, r * r - dxV * dxV));
  const vStart = tx(splitX, cy - dyV);
  const vEnd   = tx(splitX, cy + dyV);

  // Horizontal chord at y = splitY.
  const dyH = splitY - cy;
  const dxH = Math.sqrt(Math.max(0, r * r - dyH * dyH));
  const hStart = tx(cx - dxH, splitY);
  const hEnd   = tx(cx + dxH, splitY);

  return [
    { kind: 'quadrant-boundary', ...polyline([vStart, vEnd]), lineColor: 'rgba(255,255,255,0.7)', lineWidth: 1.5 },
    { kind: 'quadrant-boundary', ...polyline([hStart, hEnd]), lineColor: 'rgba(255,255,255,0.7)', lineWidth: 1.5 },
  ];
}

/**
 * Reticle fields are generated by `generateReticleGrid` in the pre-bake `grid`
 * frame, so they take `gridToScreen` — the route that includes the data-axis
 * flip, keeping the field boundaries locked to the dies they enclose.
 */
function buildReticleOverlays(reticles: Reticle[], toScreen: Affine<'grid', 'screen'>): ViewOverlay[] {
  return reticles.map((reticle) => {
    const hw = reticle.width / 2, hh = reticle.height / 2;
    const points = ([
      [reticle.x - hw, reticle.y - hh], [reticle.x + hw, reticle.y - hh],
      [reticle.x + hw, reticle.y + hh], [reticle.x - hw, reticle.y + hh],
    ] as const).map(([x, y]) => affinePoint(toScreen, x, y));

    return {
      kind: 'reticle',
      points: [points],
      closed: true,
      // lineColor/lineWidth below are unused for 'reticle' — like ring/quadrant
      // boundaries, toCanvas.ts special-cases this kind with a dual black-halo
      // + white-core stroke so the field grid reads against any die colour or
      // gap, rather than a single flat colour that can blend into a same-toned
      // fill or the canvas background. Kept only for ViewOverlay shape parity.
      lineColor: 'rgba(255,255,255,0.7)',
      lineWidth: 1.5,
      fill: 'rgba(0,0,0,0)',
    };
  });
}

function buildProbeOverlay(dies: Die[]): ViewOverlay[] {
  const ordered = dies
    .filter((die) => die.probeIndex !== undefined)
    .sort((left, right) => (left.probeIndex ?? 0) - (right.probeIndex ?? 0));

  if (!ordered.length) return [];

  return [{
    kind: 'probe-path',
    ...polyline(ordered.map(die => ({ x: die.physX, y: die.physY }))),
    lineColor: 'rgba(220,80,0,0.55)',
    lineWidth: 1,
  }];
}

function pushDieRectangles(
  rectangles: ViewRect[],
  die: Die,
  physX: number,
  physY: number,
  plotMode: PlotMode,
  swapAxes: boolean,
  gap: number,
  colorFns: ColorFns,
  highlightBin: number | undefined,
  normalize: (v: number) => number,
  testNumber: number,
  fallbackIndex: number,
  binDefMap: Map<number, BinDef> | null,
  activeTestDef?: TestDef,
  passFailDisplay: 'off' | 'spec' | 'test' = 'off',
  activeMetadataKey?: string,
  metadataColorMap?: Map<string, string> | null,
  highlightMetadataValue?: string,
): void {
  const rw = die.width - gap;
  const rh = die.height - gap;
  // For 90°/270° rotations the axis-aligned bounding box swaps width and height.
  // `swapAxes` is derived from the FULL grid→screen transform by the caller: a die
  // rectangle is axis-aligned in the pre-bake grid frame, so the swap must account
  // for wafer.orientation as well as the interactive rotation. Keying it off the
  // interactive rotation alone left non-square dies drawn at their unrotated size
  // under a baked wafer orientation — visibly overlapping their neighbours.
  const sw = swapAxes ? rh : rw;
  const sh = swapAxes ? rw : rh;

  const getBin = (d: Die) => plotMode === 'softBin' ? d.sbin : d.hbin;
  const getMetadataValue = (d: Die) => getDieMetadataValue(d, activeMetadataKey);

  if (die.partial) {
    rectangles.push({
      x: physX, y: physY, width: sw, height: sh,
      fill: PARTIAL_DIE_FILL, type: 'stacked', metadata: die.metadata,
    });
    return;
  }

  if (die.edgeExcluded) {
    rectangles.push({
      x: physX, y: physY, width: sw, height: sh,
      fill: EDGE_EXCLUDED_FILL, type: 'stacked', metadata: die.metadata,
    });
    return;
  }

  if (highlightBin !== undefined &&
      (plotMode === 'hardBin' || plotMode === 'softBin') &&
      getBin(die) !== highlightBin) {
    rectangles.push({
      x: physX, y: physY, width: sw, height: sh,
      fill: DIM_FILL, type: 'hardBin', metadata: die.metadata,
    });
    return;
  }

  if (highlightMetadataValue !== undefined &&
      plotMode === 'metadata' &&
      getMetadataValue(die) !== highlightMetadataValue) {
    rectangles.push({
      x: physX, y: physY, width: sw, height: sh,
      fill: DIM_FILL, type: 'metadata', metadata: die.metadata,
    });
    return;
  }

  if (plotMode === 'value') {
    // Test pass/fail display: the fill is the tester's recorded verdict — solid
    // green (pass) / red (fail, undirected: a functional or recorded fail has no
    // "low"/"high" direction, so the directional blue is never used here). Dies
    // with no recorded verdict are no-data grey, never fail.
    if (passFailDisplay === 'test') {
      const p = getTestPassStatus(die, testNumber, activeTestDef);
      const fill = p === undefined ? NO_DATA_FILL : p ? SPEC_PASS_FILL : SPEC_FAIL_HIGH;
      rectangles.push({ x: physX, y: physY, width: sw, height: sh, fill, type: 'value', metadata: die.metadata });
      return;
    }
    const value = getDieTestValue(die, testNumber, fallbackIndex);
    const spec = classifySpec(value, activeTestDef);
    // Two distinct out-of-spec presentations:
    //  - spec pass/fail display: the die fill *is* the indication — solid
    //    green/blue/red categorical colours, no marker.
    //  - normal value/gradient mode (both colorbar ranges): the die keeps its
    //    gradient fill like every other die — so the value distribution stays
    //    readable and out-of-spec colours don't collide with the scheme — and is
    //    flagged with a ▽/△ marker via ViewRect.specMark. The indication form no
    //    longer depends on colorbarRangeMode (which now only sets the bar range).
    let fill: string;
    let specMark: 'failLow' | 'failHigh' | undefined;
    if (value === undefined) {
      fill = NO_DATA_FILL;
    } else if (passFailDisplay === 'spec') {
      fill = spec === 'failLow' ? SPEC_FAIL_LOW
           : spec === 'failHigh' ? SPEC_FAIL_HIGH
           : SPEC_PASS_FILL;
    } else {
      fill = colorFns.forValue(normalize(value));
      if (spec === 'failLow' || spec === 'failHigh') specMark = spec;
    }
    rectangles.push({ x: physX, y: physY, width: sw, height: sh, fill, type: 'value', specMark, metadata: die.metadata });
    return;
  }

  if (plotMode === 'hardBin' || plotMode === 'softBin') {
    const bin = getBin(die);
    const fill = bin != null ? colorFns.forBin(bin) : NO_DATA_FILL;
    rectangles.push({ x: physX, y: physY, width: sw, height: sh, fill, type: plotMode, metadata: die.metadata });
    return;
  }

  if (plotMode === 'metadata') {
    const key = getMetadataValue(die);
    const fill = key !== undefined ? (metadataColorMap?.get(key) ?? NO_DATA_FILL) : NO_DATA_FILL;
    rectangles.push({ x: physX, y: physY, width: sw, height: sh, fill, type: 'metadata', metadata: die.metadata });
    return;
  }

  // stackedValues / stackedBins: aggregated scalar in testValues[0] (preferred) or values[0].
  const aggValue = getDieTestValue(die, 0, 0);
  const fill = aggValue !== undefined ? colorFns.forValue(normalize(aggValue)) : NO_DATA_FILL;
  rectangles.push({ x: physX, y: physY, width: sw, height: sh, fill, type: 'value', metadata: die.metadata });
}

function buildXYIndicatorOverlay(
  wafer: Wafer,
  gridToScreen: Affine<'grid', 'screen'>,
  texts: ViewText[]
): ViewOverlay[] {
  // Anchor is fixed at the bottom-left corner in data space (outside the wafer circle).
  // 0.9 per axis → distance ≈ 1.27 × radius: outside the circle but inside the chart area.
  // Do NOT transform the anchor — it stays in the corner regardless of wafer rotation/flip.
  // Only the arrow directions rotate, so they still correctly indicate the data axes.
  //
  // These arrows name the DIE-GRID axes (+X = increasing die.x), so they must take
  // `gridToScreen` — including the data-axis flip. Using a transform that omitted
  // that flip previously made the arrows point opposite to the way the die indices
  // actually run under xAxisDirection/yAxisDirection/a non-'center' coordinateOrigin,
  // directly contradicting the axis tick labels on the same map. As directions rather
  // than positions they go through `affineVector`, which ignores translation.
  const len = wafer.radius * 0.15;
  const xDir = affineVector(gridToScreen, len, 0);
  const yDir = affineVector(gridToScreen, 0, len);
  // Place anchor in the corner the arrows point away from, so they never clip.
  const signX = (xDir.x + yDir.x) >= 0 ? -1 : 1;
  const signY = (xDir.y + yDir.y) >= 0 ? -1 : 1;
  const anchor = {
    x: wafer.center.x + signX * wafer.radius * 0.9,
    y: wafer.center.y + signY * wafer.radius * 0.9,
  };
  const xTip = { x: anchor.x + xDir.x, y: anchor.y + xDir.y };
  const yTip = { x: anchor.x + yDir.x, y: anchor.y + yDir.y };

  texts.push(
    { x: xTip.x + xDir.x * 0.35, y: xTip.y + xDir.y * 0.35, text: '+X', fontSize: 10, color: '#cc3300', align: 'center', role: 'indicator' },
    { x: yTip.x + yDir.x * 0.35, y: yTip.y + yDir.y * 0.35, text: '+Y', fontSize: 10, color: '#0044cc', align: 'center', role: 'indicator' },
  );

  return [
    { kind: 'xy-indicator', ...polyline([anchor, xTip]), lineColor: '#cc3300', lineWidth: 2 },
    { kind: 'xy-indicator', ...polyline([anchor, yTip]), lineColor: '#0044cc', lineWidth: 2 },
  ];
}

/**
 * Build a renderer-agnostic scene from a wafer, dies, and display options.
 *
 * ```ts
 * buildView(wafer, dies, { plotMode: 'hardBin', reticles })
 * ```
 */
export function buildView(
  wafer: Wafer,
  dies: Die[],
  options: ViewOptions = {},
  binDefs?: { hbinDefs?: BinDef[]; sbinDefs?: BinDef[]; metadataFields?: MetadataFieldDef[] },
): View {
  const reticles = options.reticles ?? [];

  const {
    plotMode = 'value',
    showDieLabels = false,
    showReticle = false,
    showProbePath = false,
    ringCount = 4,
    showRingBoundaries = false,
    showQuadrantBoundaries = false,
    showXYIndicator = false,
    dieGap = 1,
    // 'default' is the canonical scheme name ('color' is a deprecated alias). Using
    // the canonical name here means view.colorScheme matches the toolbar dropdown's
    // 'default' entry for active-state highlighting.
    colorScheme = 'default',
    highlightBin,
    highlightMetadataValue,
    interactiveTransform,
    valueRange: valueRangeOpt,
    testDefs,
    activeTest = 0,
    activeMetadataKey,
    fallbackFormat = 'engineering' as const,
    aggregationMethod,
    lotSize,
    dataAxisFlip,
    isLotStack = false,
    logScale: logScaleOption,
    colorbarRangeMode: colorbarRangeModeOpt = 'spec' as const,
    colorBySpec = false,
    passFailDisplay: passFailDisplayOpt,
    showPartialDies = true,
  } = options;

  // Requested pass/fail display — `colorBySpec: true` is the deprecated alias for 'spec'.
  const requestedPassFail: 'off' | 'spec' | 'test' = passFailDisplayOpt ?? (colorBySpec ? 'spec' : 'off');

  const hbinDefs = binDefs?.hbinDefs;
  const sbinDefs = binDefs?.sbinDefs;
  const metadataFields = binDefs?.metadataFields;
  const activeMetadataFieldDef = metadataFields?.find(f => f.key === activeMetadataKey);

  // Total effective axis flip for display: data-pipeline flip XOR interactive flip.
  const axisFlip = {
    x: (dataAxisFlip?.x ?? false) !== (interactiveTransform?.flipX ?? false),
    y: (dataAxisFlip?.y ?? false) !== (interactiveTransform?.flipY ?? false),
  };

  // Hard and soft bins have independent number spaces — select the correct def map for the
  // current plot mode so bin 5 in hardbin-space and bin 5 in softbin-space can have different names.
  const hbinDefMap: BinDefMap | null = hbinDefs ? new Map(hbinDefs.map(d => [d.bin, d])) : null;
  const sbinDefMap: BinDefMap | null = sbinDefs ? new Map(sbinDefs.map(d => [d.bin, d])) : null;
  const binDefMap: BinDefMap | null  = plotMode === 'softBin' ? sbinDefMap : hbinDefMap;

  const scheme = getColorScheme(colorScheme);

  const colorFns: ColorFns = {
    forValue: buildColorLut(scheme.forValue),
    forBin:   colorScheme === 'custom' && binDefMap
      ? (bin) => binDefMap.get(bin)?.color ?? scheme.forBin(bin)
      : scheme.forBin,
  };

  // Resolve activeTest (toolbar cursor) → canonical test number for getDieTestValue.
  let { testNumber: activeTestNumber, fallbackIndex: activeTestFallback } =
    resolveTestNumber(activeTest, testDefs);

  // When no testDefs are provided the toolbar passes actual testNumbers as activeTest.
  // If the resolved testNumber doesn't exist in any die (e.g. default activeTest=0 but data
  // uses keys like 1010), fall back to the lowest key actually present in the dies.
  if (!testDefs?.length && plotMode === 'value') {
    const hasKey = dies.some(d => d.testValues && activeTestNumber in d.testValues);
    if (!hasKey) {
      const firstKey = dies.reduce<number | undefined>((min, d) => {
        if (!d.testValues) return min;
        const keys = Object.keys(d.testValues).map(Number);
        const lo = keys.length ? Math.min(...keys) : undefined;
        return lo !== undefined && (min === undefined || lo < min) ? lo : min;
      }, undefined);
      if (firstKey !== undefined) {
        activeTestNumber  = firstKey;
        activeTestFallback = firstKey;
      }
    }
  }

  // Resolve the explicit value range from the ViewOptions union.
  // - Tuple form: applied as-is (caller owns the activeTest coupling).
  // - Object { test, range } form: applied ONLY when `test` resolves to the
  //   active test number. On mismatch we drop it and auto-scale, so the library
  //   can never colour one test's data against another test's range.
  let explicitRange: [number, number] | undefined;
  if (Array.isArray(valueRangeOpt)) {
    explicitRange = valueRangeOpt;
  } else if (valueRangeOpt) {
    const { testNumber: rangeTestNumber } = resolveTestNumber(valueRangeOpt.test, testDefs);
    explicitRange = rangeTestNumber === activeTestNumber ? valueRangeOpt.range : undefined;
  }

  // Resolve active test def now — needed for limit-based range defaulting below.
  // Use the resolved testNumber (not the raw cursor) so testDefs with non-zero numbers work on first render.
  const activeTestDef = findTestDef(testDefs, activeTestNumber);

  // Resolve the EFFECTIVE pass/fail display from the request and the data —
  // the library owns validity, never the caller's flag:
  //  - a functional active test (testType 'F') has no value to plot, so it is
  //    always rendered as test pass/fail regardless of the request;
  //  - 'spec' requires the active test to have at least one limit;
  //  - 'test' requires at least one die with a recorded verdict for the active
  //    test (via getTestPassStatus, which includes the legacy 0/1 fallback).
  const functionalActive =
    plotMode === 'value' && activeTestDef !== undefined && !isParametricTest(activeTestDef);
  const activeTestHasLimits =
    activeTestDef !== undefined &&
    (activeTestDef.limitLow !== undefined || activeTestDef.limitHigh !== undefined);
  let passFailDisplay: 'off' | 'spec' | 'test' = 'off';
  if (plotMode === 'value') {
    if (functionalActive) {
      passFailDisplay = 'test';
    } else if (requestedPassFail === 'spec' && activeTestHasLimits) {
      passFailDisplay = 'spec';
    } else if (requestedPassFail === 'test' &&
               dies.some(d => getTestPassStatus(d, activeTestNumber, activeTestDef) !== undefined)) {
      passFailDisplay = 'test';
    }
  }

  // Spec pass/fail display anchors the colorbar range to the spec limits.
  // (This only affects the colorbar's numeric range — out-of-spec die colouring
  // is independent of colorbarRangeMode; see classifySpec.)
  const colorbarRangeMode: 'spec' | 'data' =
    passFailDisplay === 'spec' ? 'spec' : colorbarRangeModeOpt;

  // Compute value range for normalization.
  // For stackedValues/stackedBins the aggregated scalar sits at testNumber=0.
  let vMin: number;
  let vMax: number;
  let allIntegerValues = false;
  if (explicitRange) {
    [vMin, vMax] = explicitRange;
  } else {
    const isStacked = plotMode === 'stackedValues' || plotMode === 'stackedBins' || plotMode === 'stackedSoftBins';
    const useSpecRange =
      !isStacked &&
      plotMode === 'value' &&
      colorbarRangeMode === 'spec' &&
      activeTestDef &&
      (activeTestDef.limitLow !== undefined || activeTestDef.limitHigh !== undefined);
    let lo = Infinity, hi = -Infinity;
    let allIntegers = true;
    for (const die of dies) {
      const v = isStacked
        ? getDieTestValue(die, 0, 0)
        : getDieTestValue(die, activeTestNumber, activeTestFallback);
      if (v !== undefined) {
        if (v < lo) lo = v;
        if (v > hi) hi = v;
        if (!Number.isInteger(v)) allIntegers = false;
      }
    }
    if (!isFinite(lo)) allIntegers = false;
    allIntegerValues = allIntegers;
    if (useSpecRange) {
      // Colorbar spans the spec window. Data extents fill whichever limit side is absent.
      vMin = activeTestDef!.limitLow  !== undefined ? activeTestDef!.limitLow  : (isFinite(lo) ? lo : 0);
      vMax = activeTestDef!.limitHigh !== undefined ? activeTestDef!.limitHigh : (isFinite(hi) ? hi : 1);
    } else {
      vMin = isFinite(lo) ? lo : 0;
      vMax = isFinite(hi) ? hi : 1;
    }
  }
  if (vMin === vMax) vMax = vMin + 1;

  // Resolve effective log scale: explicit option overrides per-test TestDef default.
  // A functional active test has no value axis at all, so log scale is neither
  // requested nor applied. (activeTestDef already resolved above)
  const wantsLogScale = functionalActive ? false : (logScaleOption ?? activeTestDef?.logScale ?? false);
  const logScaleValid = wantsLogScale && vMin > 0 && vMax > 0;
  const logScale      = logScaleValid;

  let normalize: (v: number) => number;
  if (logScaleValid) {
    const logMin   = Math.log10(vMin);
    const logRange = Math.log10(vMax) - logMin;
    normalize = (v: number) => {
      if (v <= 0) return 0;
      return clamp01((Math.log10(v) - logMin) / logRange);
    };
  } else {
    normalize = (v: number) => clamp01((v - vMin) / (vMax - vMin));
  }

  const tf = buildViewTransforms(wafer, dataAxisFlip, interactiveTransform);

  // Notch direction in display space (post-transform unit vector). The notch is a
  // physical wafer feature, so it takes `physicalToScreen` — matching the boundary
  // outline it belongs to.
  let notchDir: { x: number; y: number } | null = null;
  if (wafer.notch) {
    const θ0 = notchAngle(wafer.notch.type);
    const tv = affineVector(tf.physicalToScreen, Math.cos(θ0) * wafer.radius, Math.sin(θ0) * wafer.radius);
    const len = Math.hypot(tv.x, tv.y);
    if (len > 0) notchDir = { x: tv.x / len, y: tv.y / len };
  }

  // Cap the visual kerf gap at 12 % of the smallest die dimension so that
  // normalized-unit scenes (die pitch ≈ 1) remain visible. No effect for
  // standard 10 mm dies: min(1, 10 × 0.12 = 1.2) = 1.
  let minDim = Infinity;
  for (let i = 0; i < dies.length; i++) {
    const d = dies[i];
    if (d.width < minDim) minDim = d.width;
    if (d.height < minDim) minDim = d.height;
  }
  const gap = minDim !== Infinity ? Math.min(dieGap, minDim * 0.12) : dieGap;

  const rectangles: ViewRect[] = [];
  const hoverPoints: ViewHoverPoint[] = [];
  // Pre-compute transformed physical positions — only physX/physY move under
  // rotation/flip; all other die fields are unchanged. Storing coords in a
  // parallel Float64Array pair avoids allocating a new Die object per die.
  // Die CENTRES take `bakedToScreen`: wafer.orientation and the data-axis flip are
  // already baked into physX/physY by buildWaferMap, so only the interactive leg
  // remains. Die rectangle SHAPES key off `gridToScreen` instead (see swapAxes
  // below) — a die rect is axis-aligned in the pre-bake grid frame, so its
  // width/height swap must include the baked orientation the centres already carry.
  const isIdentity = tf.bakedToScreen.a === 1 && tf.bakedToScreen.b === 0
    && tf.bakedToScreen.c === 0 && tf.bakedToScreen.d === 1
    && tf.bakedToScreen.e === 0 && tf.bakedToScreen.f === 0;
  let txCoords: Float64Array | null = null;
  if (!isIdentity) {
    txCoords = new Float64Array(dies.length * 2);
    for (let i = 0; i < dies.length; i++) {
      const tp = affinePoint(tf.bakedToScreen, dies[i].physX, dies[i].physY);
      txCoords[i * 2]     = tp.x;
      txCoords[i * 2 + 1] = tp.y;
    }
  }
  const dieSwapAxes = affineSwapsAxes(tf.gridToScreen);

  const isBinMode = plotMode === 'hardBin' || plotMode === 'softBin' || plotMode === 'stackedBins' || plotMode === 'stackedSoftBins';
  const useSoftBin = plotMode === 'softBin' || plotMode === 'stackedSoftBins';
  let binCounts: Map<number, number> | undefined = isBinMode ? new Map() : undefined;
  const specCounts = plotMode === 'value' && passFailDisplay === 'spec'
    ? { pass: 0, failHigh: 0, failLow: 0 } : undefined;
  const passFailCounts = plotMode === 'value' && passFailDisplay === 'test'
    ? { pass: 0, fail: 0 } : undefined;

  // 'metadata' mode: color is resolved once per distinct value, not per die —
  // ordered (natural alphanumeric) assignment rather than hashing, so a small known
  // set of values gets maximally-distinct colours deterministically (not
  // dependent on die array iteration order). Never routed through colorFns/
  // the toolbar's colorScheme picker — those are spectrum schemes for
  // hard/soft bins with no string-keyed concept to extend; an arbitrary
  // metadata field has no universal "good/bad" meaning to encode either, so
  // it always uses the dedicated ordered palette + explicit overrides.
  const isMetadataMode = plotMode === 'metadata';
  let metadataCounts: Map<string, number> | undefined = isMetadataMode ? new Map() : undefined;
  let metadataColorMap: Map<string, string> | null = null;
  if (isMetadataMode && activeMetadataKey) {
    // Same population, same filter, as the `metadataCounts` tally below — a partial/
    // edge-excluded die never reaches the metadata fill branch in pushDieRectangles
    // (it returns early with PARTIAL_DIE_FILL/EDGE_EXCLUDED_FILL), so letting it into the
    // natural-order ranking here would assign colours based on values no visible die
    // actually shows, shifting every later value's colour for no reason a user could see.
    const distinct = new Set<string>();
    for (const die of dies) {
      if (die.partial || die.edgeExcluded) continue;
      const value = getDieMetadataValue(die, activeMetadataKey);
      if (value !== undefined) distinct.add(value);
    }
    // Natural order, so D0, D1, D2, D10 reads correctly in the legend instead of
    // the lexicographic D0, D1, D10, D2. This ordering also fixes colour assignment
    // (index → palette entry), so legend order and die colours stay in step.
    const sorted = [...distinct].sort(compareNatural);
    metadataColorMap = new Map(sorted.map((value, index) => [
      value,
      activeMetadataFieldDef?.values?.find(v => v.value === value)?.color ?? metadataValueColor(index),
    ]));
  }

  for (let i = 0; i < dies.length; i++) {
    const die = dies[i];
    const physX = txCoords ? txCoords[i * 2]     : die.physX;
    const physY = txCoords ? txCoords[i * 2 + 1] : die.physY;
    // Always add to hoverPoints so dieBounds covers the full die extent —
    // the viewport must fit the whole wafer regardless of showPartialDies.
    hoverPoints.push({ x: physX, y: physY });
    // Legend tallies must exclude both partial AND edge-excluded dies: those are
    // drawn as no-data grey (not their bin/spec colour), so counting them would
    // make the legend population disagree with what is actually coloured on the
    // map and with the summary panel (which also excludes edge-excluded dies).
    if (binCounts && !die.partial && !die.edgeExcluded) {
      const bin = useSoftBin ? die.sbin : die.hbin;
      if (bin != null) binCounts.set(bin, (binCounts.get(bin) ?? 0) + 1);
    }
    if (specCounts && !die.partial && !die.edgeExcluded) {
      // Same classification the colouring uses (shared helper) so counts match the drawn colours.
      const cat = classifySpec(getDieTestValue(die, activeTestNumber, activeTestFallback), activeTestDef);
      if (cat) specCounts[cat]++;
    }
    if (passFailCounts && !die.partial && !die.edgeExcluded) {
      // Same read-path the colouring uses so counts match the drawn colours.
      const p = getTestPassStatus(die, activeTestNumber, activeTestDef);
      if (p !== undefined) passFailCounts[p ? 'pass' : 'fail']++;
    }
    if (metadataCounts && !die.partial && !die.edgeExcluded) {
      const value = getDieMetadataValue(die, activeMetadataKey);
      if (value !== undefined) metadataCounts.set(value, (metadataCounts.get(value) ?? 0) + 1);
    }
    if (die.partial && !showPartialDies) continue;
    pushDieRectangles(rectangles, die, physX, physY, plotMode, dieSwapAxes, gap, colorFns, highlightBin, normalize, activeTestNumber, activeTestFallback, binDefMap, activeTestDef, passFailDisplay, activeMetadataKey, metadataColorMap, highlightMetadataValue);
  }

  const texts: ViewText[] = showDieLabels ? generateTextOverlay(dies, txCoords, {
    plotMode, colorFns, normalize, activeTest,
    valueRange: [vMin, vMax], testDefs, fallbackFormat, passFailDisplay,
    activeMetadataKey, metadataColorMap,
  }) : [];
  const overlays = buildBoundaryOverlay(wafer, tf.physicalToScreen);

  if (showRingBoundaries) overlays.push(...buildRingOverlays(wafer, tf.physicalToScreen, ringCount));
  if (showQuadrantBoundaries) {
    // The classification boundary in classifyDie is a hard cut at the wafer
    // centre (dx >= 0 / dy >= 0, i.e. physX/physY vs wafer.center). Draw the
    // lines exactly there. Do NOT place them at the midpoint between straddling
    // die columns: when a column sits on the centre (odd column count) that
    // midpoint lands half a pitch off-centre, while classifyDie still assigns
    // the centre column to E/N.
    overlays.push(...buildQuadrantOverlays(wafer, tf.physicalToScreen, wafer.center.x, wafer.center.y));
  }
  if (showReticle) overlays.push(...buildReticleOverlays(reticles, tf.gridToScreen));
  if (showProbePath) overlays.push(...buildProbeOverlay(dies));
  if (showXYIndicator) overlays.push(...buildXYIndicatorOverlay(wafer, tf.gridToScreen, texts));

  // Pre-compute bounding box for viewport fitting.
  // Use the wafer circle (center ± radius) rather than die extents so the viewport
  // is always sized to the drawn boundary, regardless of showPartialDies or how
  // many partial dies are present. This keeps the wafer consistently sized on screen.
  const dieBounds: View['dieBounds'] = hoverPoints.length > 0 ? {
    minX: wafer.center.x - wafer.radius,
    maxX: wafer.center.x + wafer.radius,
    minY: wafer.center.y - wafer.radius,
    maxY: wafer.center.y + wafer.radius,
  } : null;

  return {
    rectangles,
    hoverPoints,
    texts,
    overlays,
    plotMode,
    colorScheme,
    metadata: wafer.metadata ?? null,
    dies,
    valueRange: [vMin, vMax],
    allIntegerValues,
    testDefs,
    activeTest,
    logScale,
    logScaleRequested: wantsLogScale,
    aggrMethod: aggregationMethod,
    lotSize,
    axisFlip,
    dataAxisFlip: { x: dataAxisFlip?.x ?? false, y: dataAxisFlip?.y ?? false },
    gridToScreen: tf.gridToScreen,
    rotation: (((wafer.orientation + (interactiveTransform?.rotation ?? 0)) % 360) + 360) % 360,
    hasReticle: reticles.length > 0,
    isLotStack,
    passFailDisplay,
    colorBySpec: passFailDisplay === 'spec',
    colorbarRangeMode,
    waferCenter: wafer.center,
    waferRadius: wafer.radius,
    notchDir,
    binCounts,
    metadataCounts,
    metadataColorMap,
    activeMetadataKey,
    metadataFields,
    specCounts,
    passFailCounts,
    dieBounds,
  };
}

// ── Die lookup helpers ────────────────────────────────────────────────────────

/**
 * Return a stable string key for a die — guaranteed format `"x,y"`.
 *
 * Re-exported from `core/dies.ts`, where the canonical implementation lives so
 * that `stats/` and `canvas-adapter/` can share it without depending on
 * `renderer/`. Kept exported here to preserve the public `@paulrobins/wafermap/renderer`
 * entry point.
 */
export { getDieKey } from '../core/dies.js';
