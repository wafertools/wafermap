import type { Wafer } from './wafer.js';
import type { Die, DieSpec } from './dies.js';

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
  return dies.map((die) => {
    const p = rotatePoint(die.physX, die.physY, wafer.orientation, wafer.center.x, wafer.center.y);
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
  let result = dies;

  if (rotation !== 0) {
    result = result.map((d) => {
      const p = rotatePoint(d.physX, d.physY, rotation, center.x, center.y);
      return { ...d, physX: p.x, physY: p.y };
    });
  }

  if (flipX) result = result.map((d) => ({ ...d, physX: 2 * center.x - d.physX }));
  if (flipY) result = result.map((d) => ({ ...d, physY: 2 * center.y - d.physY }));

  return result;
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

  if (matchBy === 'ij') {
    const iField = options.iField ?? 'x', jField = options.jField ?? 'y';
    for (const row of data) lookup.set(`${+row[iField]},${+row[jField]}`, +row[valueField]);
    return dies.map((d) => {
      const v = lookup.get(`${d.x},${d.y}`);
      return v !== undefined ? { ...d, values: [...(d.values ?? []), v] } : { ...d };
    });
  }

  const xField = options.xField ?? 'x', yField = options.yField ?? 'y';
  for (const row of data) lookup.set(`${+row[xField]},${+row[yField]}`, +row[valueField]);
  return dies.map((d) => {
    const v = lookup.get(`${d.x},${d.y}`);
    return v !== undefined ? { ...d, values: [...(d.values ?? []), v] } : { ...d };
  });
}
