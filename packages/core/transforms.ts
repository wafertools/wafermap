import type { Wafer } from './wafer.js';
import type { Die, DieSpec } from './dies.js';
import { getDieKey } from './dies.js';

export interface DataRow {
  [key: string]: string | number;
}

export interface MapOptions {
  xField?: string;
  yField?: string;
  iField?: string;
  jField?: string;
  valueField: string;
  /** 'xy' matches by wafer coordinates; 'ij' matches by grid indices (default: 'xy') */
  matchBy?: 'xy' | 'ij';
}

export interface TransformOptions {
  /** Additional rotation in degrees, applied on top of existing die coordinates. */
  rotation?: number;
  /** Mirror x around the wafer centre. Applied after rotation. */
  flipX?: boolean;
  /** Mirror y around the wafer centre. Applied after rotation. */
  flipY?: boolean;
}

// ── Geometry ──────────────────────────────────────────────────────────────────

/** Rotate (x, y) clockwise by angleDegrees around (cx, cy). */
export function rotatePoint(
  x: number, y: number, angleDegrees: number, cx = 0, cy = 0
): { x: number; y: number } {
  const rad = (angleDegrees * Math.PI) / 180;
  const cos = Math.cos(rad), sin = Math.sin(rad);
  const dx = x - cx, dy = y - cy;
  return { x: cx + dx * cos + dy * sin, y: cy - dx * sin + dy * cos };
}

// ── Affine transforms ─────────────────────────────────────────────────────────
//
// THE single representation for every rotation/mirror in the library. Rotation
// and mirroring do NOT commute, so a display transform can never be stored as a
// `{ rotation: number; flipX: boolean; flipY: boolean }` bundle: the real
// pipeline is rotate → mirror → rotate → mirror, and
//   mirror ∘ rot(θ) = rot(−θ) ∘ mirror
// means collapsing that into one summed angle plus XOR'd flip flags is only
// valid when the first rotation is zero. Matrices compose associatively and get
// this right by construction, which is the whole reason this type exists.
//
// Matrices are frame-branded (`Affine<From, To>`): `compose` only accepts a pair
// whose frames meet, so composing in the wrong order — or applying a matrix to a
// point from the wrong coordinate frame — is a compile error rather than a
// silently-misplaced overlay. The brands are phantom (type-level only); at
// runtime these are plain 6-number objects.

/**
 * A 2D affine transform, applied as:
 * ```
 *   x' = a·x + c·y + e
 *   y' = b·x + d·y + f
 * ```
 * `From`/`To` are phantom coordinate-frame tags — see {@link CoordFrame}.
 */
export interface Affine<From extends CoordFrame = CoordFrame, To extends CoordFrame = CoordFrame> {
  a: number; b: number; c: number; d: number; e: number; f: number;
  /** Phantom source frame — never present at runtime. */
  readonly __from?: From;
  /** Phantom target frame — never present at runtime. */
  readonly __to?: To;
}

/**
 * The distinct coordinate frames a point can live in. Mixing them up is the
 * single most common source of misplaced-geometry bugs in this library, so the
 * frame travels in the type of the matrix that converts between them.
 *
 * - `physical` — wafer-local mm describing a *physical wafer feature* (the
 *   boundary outline, the notch, ring/quadrant region borders). These follow
 *   `wafer.orientation` but NOT the data-axis flip: that flip exists to make the
 *   rendered image physically correct for a prober convention (e.g.
 *   `yAxisDirection: 'down'` puts row 1 at the top), so the physical wafer must
 *   stay put while the die grid moves relative to it.
 * - `grid` — wafer-local mm for geometry *aligned to the die grid* (reticle
 *   fields, the +X/+Y axis indicator). These DO follow the data-axis flip,
 *   because they must stay locked to the dies they describe.
 * - `baked` — what `Die.physX`/`physY` holds after `buildWaferMap` has applied
 *   `applyOrientation` then `transformDies`. Public API; do not redefine.
 * - `screen` — final display mm after the interactive rotate/flip. This is what
 *   `View.hoverPoints` holds and what hit-testing compares against.
 */
export type CoordFrame = 'physical' | 'grid' | 'baked' | 'screen';

/** The identity transform. */
export function affineIdentity<F extends CoordFrame>(): Affine<F, F> {
  return { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
}

/**
 * Clockwise rotation by `angleDegrees` about (cx, cy) — the same convention as
 * {@link rotatePoint}, which this reproduces exactly.
 */
export function affineRotation<From extends CoordFrame, To extends CoordFrame>(
  angleDegrees: number, cx = 0, cy = 0,
): Affine<From, To> {
  const rad = (angleDegrees * Math.PI) / 180;
  const cos = Math.cos(rad), sin = Math.sin(rad);
  // Linear part [a c; b d] = [cos sin; -sin cos]; translation keeps (cx,cy) fixed.
  return {
    a: cos, c: sin,
    b: -sin, d: cos,
    e: cx - (cos * cx + sin * cy),
    f: cy - (-sin * cx + cos * cy),
  };
}

/** Mirror through (cx, cy) on each requested axis. */
export function affineMirror<From extends CoordFrame, To extends CoordFrame>(
  flipX: boolean, flipY: boolean, cx = 0, cy = 0,
): Affine<From, To> {
  return {
    a: flipX ? -1 : 1, c: 0,
    b: 0, d: flipY ? -1 : 1,
    e: flipX ? 2 * cx : 0,
    f: flipY ? 2 * cy : 0,
  };
}

/**
 * Compose two transforms: `inner` runs first, then `outer`. The frame brands must
 * meet (`inner` ends where `outer` begins), so an out-of-order composition — the
 * exact mistake that mis-drew reticle fields — will not type-check.
 */
export function affineCompose<A extends CoordFrame, B extends CoordFrame, C extends CoordFrame>(
  outer: Affine<B, C>, inner: Affine<A, B>,
): Affine<A, C> {
  return {
    a: outer.a * inner.a + outer.c * inner.b,
    b: outer.b * inner.a + outer.d * inner.b,
    c: outer.a * inner.c + outer.c * inner.d,
    d: outer.b * inner.c + outer.d * inner.d,
    e: outer.a * inner.e + outer.c * inner.f + outer.e,
    f: outer.b * inner.e + outer.d * inner.f + outer.f,
  };
}

/** Invert a transform. Every transform built here is a rotation/mirror, so it is always invertible. */
export function affineInvert<From extends CoordFrame, To extends CoordFrame>(
  m: Affine<From, To>,
): Affine<To, From> {
  const det = m.a * m.d - m.b * m.c;
  const ia = m.d / det, ib = -m.b / det, ic = -m.c / det, id = m.a / det;
  return { a: ia, b: ib, c: ic, d: id, e: -(ia * m.e + ic * m.f), f: -(ib * m.e + id * m.f) };
}

/** Transform a point (translation applies). */
export function affinePoint<From extends CoordFrame, To extends CoordFrame>(
  m: Affine<From, To>, x: number, y: number,
): { x: number; y: number } {
  return { x: m.a * x + m.c * y + m.e, y: m.b * x + m.d * y + m.f };
}

/**
 * Transform a direction/offset (translation does NOT apply). Use for arrows and
 * any other quantity that is a vector rather than a position.
 */
export function affineVector<From extends CoordFrame, To extends CoordFrame>(
  m: Affine<From, To>, dx: number, dy: number,
): { x: number; y: number } {
  return { x: m.a * dx + m.c * dy, y: m.b * dx + m.d * dy };
}

/**
 * True when the transform maps the x-axis onto the y-axis (the 90°/270° class,
 * with or without mirroring) — i.e. when an axis-aligned rectangle's width and
 * height must be exchanged to describe its image.
 *
 * Rotations that are not a multiple of 90° do not map an axis-aligned rectangle
 * to an axis-aligned rectangle at all; those return `false`, matching the
 * library's existing behaviour of drawing dies as unrotated rectangles.
 */
export function affineSwapsAxes(m: Affine): boolean {
  return Math.abs(m.a) < 1e-9 && Math.abs(m.d) < 1e-9 && Math.abs(m.b) > 1e-9;
}

/** Perpendicular distance from wafer centre to notch/flat chord: sqrt(r² − (L/2)²). */
function alignmentChordDistance(radius: number, chordLength: number): number {
  return Math.sqrt(radius * radius - (chordLength / 2) ** 2);
}

/**
 * Check whether (x, y) — in wafer-local (pre-rotation) coordinates —
 * lies inside the wafer boundary, including the notch/flat exclusion zone.
 */
export function isInsideWafer(x: number, y: number, wafer: Wafer): boolean {
  const dx = x - wafer.center.x, dy = y - wafer.center.y;
  if (dx * dx + dy * dy > wafer.radius * wafer.radius) return false;
  if (wafer.notch) {
    const d = alignmentChordDistance(wafer.radius, wafer.notch.length);
    if (wafer.notch.type === 'bottom' && dy < -d) return false;
    if (wafer.notch.type === 'top'    && dy >  d) return false;
    if (wafer.notch.type === 'left'   && dx < -d) return false;
    if (wafer.notch.type === 'right'  && dx >  d) return false;
  }
  return true;
}

// ── Pipeline transforms ───────────────────────────────────────────────────────

/**
 * Clip dies to the wafer boundary (circle + optional notch/flat).
 * When dieConfig is supplied, all four corners are checked to detect partial dies.
 * Operates on wafer-local coordinates (before applyOrientation).
 */
export function clipDiesToWafer(dies: Die[], wafer: Wafer, dieConfig?: DieSpec): Die[] {
  const result: Die[] = [];
  for (const die of dies) {
    const centerIn = isInsideWafer(die.physX, die.physY, wafer);
    if (!dieConfig) {
      if (centerIn) result.push({ ...die, insideWafer: true, partial: false });
      continue;
    }
    const hw = dieConfig.width / 2, hh = dieConfig.height / 2;
    const corners: [number, number][] = [
      [die.physX - hw, die.physY - hh], [die.physX + hw, die.physY - hh],
      [die.physX + hw, die.physY + hh], [die.physX - hw, die.physY + hh],
    ];
    const cornersIn = corners.filter(([cx, cy]) => isInsideWafer(cx, cy, wafer)).length;
    if (!centerIn && cornersIn === 0) continue;
    result.push({ ...die, insideWafer: true, partial: cornersIn < 4 });
  }
  return result;
}

/**
 * Rotate all die display coordinates by wafer.orientation around wafer.center.
 * Call this after clipping and data mapping so that i/j indices remain intact.
 */
export function applyOrientation(dies: Die[], wafer: Wafer): Die[] {
  if (wafer.orientation === 0) return dies;
  const m = affineRotation(wafer.orientation, wafer.center.x, wafer.center.y);
  return dies.map((die) => {
    const p = affinePoint(m, die.physX, die.physY);
    return { ...die, physX: p.x, physY: p.y };
  });
}

/**
 * Apply interactive transforms (rotation + flip) to die display coordinates.
 * Rotation is around wafer.center; flip mirrors through wafer.center.
 * Call this at render time — baseDies already have applyOrientation baked in.
 */
export function transformDies(
  dies: Die[], options: TransformOptions, center = { x: 0, y: 0 }
): Die[] {
  const { rotation = 0, flipX = false, flipY = false } = options;
  if (rotation === 0 && !flipX && !flipY) return dies;

  // Rotate first, then mirror — composed into one matrix so the whole pipeline is
  // a single pass over the dies. The previous implementation ran up to three
  // separate `.map()` stages, allocating three full copies of the die array.
  const m = affineCompose(
    affineMirror(flipX, flipY, center.x, center.y),
    affineRotation(rotation, center.x, center.y),
  );
  return dies.map((d) => {
    const p = affinePoint(m, d.physX, d.physY);
    return { ...d, physX: p.x, physY: p.y };
  });
}

/**
 * Attach data values to dies.
 * matchBy='xy'  — matches by wafer coordinates (v0.1 behaviour)
 * matchBy='ij'  — matches by grid indices
 *
 * Note: duplicate rows with the same coordinate produce last-wins behaviour.
 * Deduplicate `data` upstream if needed.
 */
export function mapDataToDies(dies: Die[], data: DataRow[], options: MapOptions): Die[] {
  const { valueField, matchBy = 'xy' } = options;
  const lookup = new Map<string, number>();

  // Each call appends one more mapped value, keyed by how many are already
  // present — so the first call lands at testValues[0], which is the key
  // `plotMode: 'value'` selects by default when no testDefs are supplied.
  const attach = (d: Die): Die => {
    const v = lookup.get(getDieKey(d));
    if (v === undefined) return { ...d };
    const existing = d.testValues ?? {};
    return { ...d, testValues: { ...existing, [Object.keys(existing).length]: v } };
  };

  if (matchBy === 'ij') {
    const iField = options.iField ?? 'x', jField = options.jField ?? 'y';
    for (const row of data) lookup.set(`${+row[iField]},${+row[jField]}`, +row[valueField]);
    return dies.map(attach);
  }

  const xField = options.xField ?? 'x', yField = options.yField ?? 'y';
  for (const row of data) lookup.set(`${+row[xField]},${+row[yField]}`, +row[valueField]);
  return dies.map(attach);
}
