import { percentile98, clamp01 } from '../utils.js';

const STANDARD_DIAMETERS = [25, 50, 75, 100, 150, 200, 300, 450];
// Industry-standard sizes used in high-volume manufacturing today — snap to
// these first with a tighter tolerance before trying the full standard list.
const PREFERRED_DIAMETERS = [100, 150, 200, 300];

export interface WaferInference {
  center: { x: number; y: number };
  diameter: number;
  radius: number;
  confidence: number;
  method: string;
}

/**
 * Infer wafer geometry (center + diameter) from a set of XY die positions.
 * Snaps to standard wafer sizes; prefers 200mm/300mm if within ±10%.
 *
 * `minRadius` is a HARD floor: the resulting wafer is never smaller than this.
 * Callers pass the distance to the furthest corner of the furthest die, because a
 * die carrying test results is a real tested prober position and is therefore
 * always fully on the wafer — a prober cannot step to a site that overhangs the
 * edge. That makes the die extent ground truth and the inferred diameter the
 * guess, so the guess must yield to it. Without this floor the p98 sizing below
 * can undersize the wafer and manufacture "partial" dies that cannot physically
 * exist.
 */
export function inferWaferFromXY(
  points: Array<{ x: number; y: number }>,
  options: { minRadius?: number } = {},
): WaferInference {
  if (points.length === 0) {
    return { center: { x: 0, y: 0 }, diameter: 300, radius: 150, confidence: 0, method: 'default' };
  }

  const cx = points.reduce((s, p) => s + p.x, 0) / points.length;
  const cy = points.reduce((s, p) => s + p.y, 0) / points.length;

  // Use p98 rather than raw max: rectangular-masked datasets have corner-adjacent
  // die positions that push maxR well beyond the actual circular boundary, causing
  // the inferred circle to extend into empty grid space (grey no-data dies).
  // For fully circular data p98 ≈ max, so behaviour is unchanged for standard wafers.
  const radii = points.map(p => Math.sqrt((p.x - cx) ** 2 + (p.y - cy) ** 2));
  const boundaryR = percentile98(radii);

  // Die centers sit inside the wafer boundary — add a 5% buffer to account for
  // the half-die extent between the outermost die center and the wafer edge.
  // The floor wins over the estimate whenever the two disagree — see `minRadius`.
  const minDiameter = (options.minRadius ?? 0) * 2;
  const estimatedDiameter = Math.max(boundaryR * 2 * 1.05, minDiameter);

  const snapped = snapToStandardDiameter(estimatedDiameter, minDiameter);
  const meanR = radii.reduce((s, r) => s + r, 0) / radii.length;
  const stdR = Math.sqrt(radii.reduce((s, r) => s + (r - meanR) ** 2, 0) / radii.length);
  const cv = meanR > 0 ? stdR / meanR : 1;
  const confidence = clamp01(1 - cv * 0.5);

  return {
    center: { x: cx, y: cy },
    diameter: snapped.diameter,
    radius: snapped.diameter / 2,
    confidence,
    method: snapped.method,
  };
}

/**
 * Snap to a standard wafer size, never returning a diameter below `minDiameter`.
 * Snapping is a guess; `minDiameter` is a physical fact (see `inferWaferFromXY`),
 * so a snap that would cut through real dies steps UP to the next standard size
 * instead of down to the nearest one.
 */
function snapToStandardDiameter(estimated: number, minDiameter = 0): { diameter: number; method: string } {
  const fits = (d: number): boolean => d >= minDiameter;

  for (const d of PREFERRED_DIAMETERS) {
    if (fits(d) && Math.abs(estimated - d) / d <= 0.10) {
      return { diameter: d, method: `snapped-${d}mm` };
    }
  }

  let closestDiff = Infinity;
  let closestDiameter = estimated;
  for (const d of STANDARD_DIAMETERS) {
    if (!fits(d)) continue;
    const diff = Math.abs(estimated - d);
    if (diff < closestDiff) {
      closestDiff = diff;
      closestDiameter = d;
    }
  }

  if (closestDiff !== Infinity && closestDiff / estimated <= 0.20) {
    return { diameter: closestDiameter, method: `snapped-${closestDiameter}mm` };
  }

  const rounded = Math.max(Math.ceil(estimated / 10) * 10, minDiameter);
  return { diameter: rounded, method: 'rounded' };
}
