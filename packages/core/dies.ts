import type { Wafer } from './wafer.js';
import type { DieMetadata } from './metadata.js';

export interface DieSpec {
  width: number;   // mm
  height: number;  // mm
  gridSize?: number;
  offset?: { x: number; y: number };
}

export interface Die {
  id: string;
  /**
   * Grid position. Absent (together with `y`/`physX`/`physY`) means this die
   * has no reported spatial position at all — it still carries real
   * measured data (`testValues`, `hbin`, …) and counts toward every
   * non-spatial stat, but is never placed on a wafer map/gallery canvas and
   * never enters ring/quadrant/sector/reticle/cluster/pattern analysis. Use
   * `hasPosition()` rather than checking `x`/`y` individually — a die is
   * either fully positioned or fully unpositioned, never half.
   */
  x?: number;
  y?: number;
  physX?: number;       // physical position in mm (or normalized units)
  physY?: number;
  width: number;       // die size in mm — set by generateDies
  height: number;
  /**
   * Test values keyed by test number (a stable per-test identity, e.g. STDF TEST_NUM).
   * Example: `{ 1050: 1.42e-3, 1060: 0.487, 1070: 8.3e-12 }`
   */
  testValues?: Record<number, number>;
  /**
   * Recorded per-test pass/fail verdicts keyed by test number (true = pass),
   * parallel to `testValues`. Parametric tests carry a value in `testValues`
   * and may optionally carry a verdict here; functional tests (`testType: 'F'`)
   * carry a verdict here ONLY — they have no measured value.
   * Example: `{ 2001: true, 2002: false }`
   */
  testPass?: Record<number, boolean>;
  hbin?: number;       // hard bin (physical sort result)
  sbin?: number;       // soft bin (test-program failure category)
  metadata?: DieMetadata;
  insideWafer?: boolean;
  partial?: boolean;     // true if die straddles the wafer boundary
  edgeExcluded?: boolean; // true if die centre falls within the edge exclusion zone
  probeIndex?: number;   // assigned by applyProbeSequence
  /** Number of times this die position appeared in the input results. Only set when > 1. */
  retestCount?: number;
  /** STDF site_num — which parallel test site tested this die. Only meaningful when > 1 distinct value appears per wafer. */
  siteNum?: number;
  /** STDF pir.part_id — tester-assigned identifier for this tested unit. Encodes probe sequence at most fabs. */
  partId?: number;
}

export interface DieEligibilityOptions {
  /** Include dies that straddle the wafer boundary (`die.partial`). Default: excluded. */
  includePartial?: boolean;
  /** Include dies inside the edge-exclusion zone (`die.edgeExcluded`). Default: excluded. */
  includeEdgeExcluded?: boolean;
}

/**
 * Whether a die counts toward yield/rollup calculations, per wmap's standard
 * fab-reporting convention: partial (boundary-straddling) and edge-excluded
 * dies are skipped by default, even though they may carry real measured
 * values — many fabs exclude them from yield/bin reporting specifically,
 * not from other per-die analysis (a partial/edge-excluded die's test
 * values still belong in distributions, correlations, scatter, etc. — this
 * predicate is for yield-style pass/fail rollups only).
 *
 * Single source of truth for this rule — previously duplicated independently
 * in `renderer/buildWaferMap.ts`'s yield calculation and
 * `stats/analyzeWaferMap.ts`'s eligible-die filter, which could (and did)
 * silently drift apart. Both now call this.
 */
/**
 * Whether a die has a reported spatial position. The single source of truth
 * every spatial function (region builders, cluster/pattern detection, the
 * renderer's grid/geometry inference) filters on — never check `x`/`y`
 * individually elsewhere, since a die is either fully positioned or fully
 * unpositioned (`buildWaferMap` rejects the half-state at build time).
 */
export function hasPosition<T extends { x?: number | null; y?: number | null }>(
  die: T,
): die is T & { x: number; y: number } {
  return die.x != null && die.y != null;
}

/**
 * A `Die` known to carry a spatial position — every geometry-only function
 * (ring/quadrant classification, probe-sequence spatial sort, cluster/pattern
 * detection) takes this instead of plain `Die`, so the "caller must filter
 * first" invariant is enforced at the type level rather than by convention.
 * Get one via `dies.filter(isPositionedDie)`.
 */
export type PositionedDie = Die & { x: number; y: number; physX: number; physY: number };

/**
 * `hasPosition` narrowed for a real `Die`, yielding a `PositionedDie` — i.e.
 * `physX`/`physY` are narrowed too, not just `x`/`y`.
 *
 * Both exist because `hasPosition` is also applied to inputs that carry `x`/`y`
 * and no `physX` at all (a raw `DieResult`, before any layout has happened), so
 * it cannot promise the physical pair. Anything working with built `Die`s wants
 * this one: before it existed every such caller wrote
 * `dies.filter(hasPosition) as PositionedDie[]`, asserting this same invariant
 * by hand — six copies of one cast, each a place the type checker had been told
 * to stop looking.
 *
 * The invariant is real, which is why the runtime check need only look at
 * `x`/`y`: a die is either fully positioned or fully unpositioned, never half
 * (`buildWaferMap` rejects the half-state at build time).
 */
export function isPositionedDie<T extends Die>(die: T): die is T & PositionedDie {
  return die.x != null && die.y != null;
}

/**
 * Return a stable string key for a die — guaranteed format `"x,y"` for a
 * positioned die, or `"id:<id>"` for an unpositioned one (see `hasPosition`).
 *
 * THE way to build a die key. Use it for Map keys and post-enrichment lookups
 * rather than an ad-hoc template literal: findings carry `dieKeys` in this exact
 * format and the renderer resolves highlights by matching them, so a single site
 * that formats keys differently silently breaks click-to-highlight. Same reason
 * it lives in `core/` — `renderer/`, `stats/` and `canvas-adapter/` all need to
 * agree on one format.
 *
 * An unpositioned die has no `x`/`y` to key on — every one would collide on
 * the same key without the `id:` fallback, since `id` is the only field
 * guaranteed unique for a die with no position (`buildWaferMap` assigns
 * unpositioned dies an id like `unpositioned_3`).
 *
 * ```ts
 * const map = new Map(result.dies.map(d => [getDieKey(d), d]));
 * const die = map.get(getDieKey({ x: 3, y: -2 }));
 * ```
 */
export function getDieKey(die: { x?: number; y?: number; id?: string }): string {
  if (hasPosition(die)) return `${die.x},${die.y}`;
  return `id:${die.id}`;
}

export function isYieldEligibleDie(die: Die, options: DieEligibilityOptions = {}): boolean {
  if (!options.includePartial && die.partial) return false;
  if (!options.includeEdgeExcluded && die.edgeExcluded) return false;
  return true;
}

/**
 * Generate a rectangular grid of dies centered on the wafer.
 * Each die carries its width/height for use by the renderer.
 */
export function generateDies(wafer: Wafer, dieConfig: DieSpec): Die[] {
  const { width, height, offset = { x: 0, y: 0 } } = dieConfig;
  const gridSize = dieConfig.gridSize ?? Math.ceil(wafer.radius / Math.min(width, height)) + 1;
  const dies: Die[] = [];

  for (let row = -gridSize; row <= gridSize; row++) {
    for (let col = -gridSize; col <= gridSize; col++) {
      const physX = wafer.center.x + col * width + offset.x;
      const physY = wafer.center.y + row * height + offset.y;
      dies.push({ id: `${col}_${row}`, x: col, y: row, physX, physY, width, height });
    }
  }

  return dies;
}
