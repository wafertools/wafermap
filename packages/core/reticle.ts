import type { Wafer } from './wafer.js';

export interface ReticleSpec {
  width:        number;                      // field width in die counts
  height:       number;                      // field height in die counts
  diePitchX:    number;                      // die pitch in display units (mm or normalized)
  diePitchY:    number;
  anchorDie?:   { x: number; y: number };   // die index at field's min-x/min-y corner
                                              // (bottom-left, since +Y is up); default {0,0}
  /**
   * Physical position of die index (0,0) — i.e. where `anchorDie` is measured
   * from. Defaults to the wafer centre `{0,0}`, correct only when the die grid
   * is itself centred on the wafer. When the die grid's physical placement is
   * offset from wafer centre by a non-whole-die-pitch amount (e.g. partial/
   * off-centre wafer data, where `buildWaferMap` centres the *data extent*
   * rather than the wafer), that fractional remainder must be passed here or
   * field boundaries silently drift out of alignment with die edges.
   */
  gridOrigin?:  { x: number; y: number };
}

/** A reticle rectangle in wafer-local (pre-rotation) coordinates. */
export interface Reticle {
  x: number; // centre x
  y: number; // centre y
  width: number;
  height: number;
}

/**
 * Generate the grid of reticle rectangles that cover the wafer area.
 * Returns positions in wafer-local coordinates (before orientation rotation).
 * Reticles that don't overlap the wafer circle are excluded.
 *
 * Width and height are in die counts; diePitchX/diePitchY convert to display units.
 * The anchorDie index lands at the reticle's min-x/min-y corner (bottom-left,
 * since +Y is up) — i.e. anchorDie is the first (leftmost, bottom-most) die
 * of the field it belongs to.
 */
export function generateReticleGrid(wafer: Wafer, config: ReticleSpec): Reticle[] {
  const {
    width: W, height: H, diePitchX, diePitchY,
    anchorDie = { x: 0, y: 0 }, gridOrigin = { x: 0, y: 0 },
  } = config;

  const fw = W * diePitchX;
  const fh = H * diePitchY;

  // Phase: which column/row within a field the anchor die occupies.
  const phaseX = ((anchorDie.x % W) + W) % W;
  const phaseY = ((anchorDie.y % H) + H) % H;

  // Field centres are placed relative to gridOrigin (the physical position of
  // die index (0,0)), not the wafer centre — the die grid may itself be offset
  // from the wafer centre by a non-whole-die-pitch amount.
  const baseX = gridOrigin.x + (phaseX + (W - 1) / 2) * diePitchX;
  const baseY = gridOrigin.y + (phaseY + (H - 1) / 2) * diePitchY;

  // Range of integer k values whose reticle could touch the wafer circle.
  // cx - wafer.center.x = k*fw + (baseX - wafer.center.x), so solve for k against ±range.
  const range = wafer.radius + Math.max(fw, fh);
  const kMinX = Math.ceil((-range - (baseX - wafer.center.x)) / fw);
  const kMaxX = Math.floor(( range - (baseX - wafer.center.x)) / fw);
  const kMinY = Math.ceil((-range - (baseY - wafer.center.y)) / fh);
  const kMaxY = Math.floor(( range - (baseY - wafer.center.y)) / fh);

  const reticles: Reticle[] = [];

  for (let l = kMinY; l <= kMaxY; l++) {
    const cy = baseY + l * fh;

    for (let k = kMinX; k <= kMaxX; k++) {
      const cx = baseX + k * fw;

      // Closest point on this rectangle to the wafer centre
      const closestX = Math.max(cx - fw / 2, Math.min(wafer.center.x, cx + fw / 2));
      const closestY = Math.max(cy - fh / 2, Math.min(wafer.center.y, cy + fh / 2));
      const dx = closestX - wafer.center.x;
      const dy = closestY - wafer.center.y;

      if (dx * dx + dy * dy <= wafer.radius * wafer.radius) {
        reticles.push({ x: cx, y: cy, width: fw, height: fh });
      }
    }
  }

  return reticles;
}
