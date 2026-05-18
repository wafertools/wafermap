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
 */
export function inferWaferFromXY(points: Array<{ x: number; y: number }>): WaferInference {
  if (points.length === 0) {
    return { center: { x: 0, y: 0 }, diameter: 300, radius: 150, confidence: 0, method: 'default' };
  }

  const cx = points.reduce((s, p) => s + p.x, 0) / points.length;
  const cy = points.reduce((s, p) => s + p.y, 0) / points.length;

  const maxDist = points.reduce((m, p) => {
    const d = Math.sqrt((p.x - cx) ** 2 + (p.y - cy) ** 2);
    return d > m ? d : m;
  }, 0);

  // Die centers sit inside the wafer boundary — add a 5% buffer to account for
  // the half-die extent between the outermost die center and the wafer edge.
  const estimatedDiameter = maxDist * 2 * 1.05;

  const snapped = snapToStandardDiameter(estimatedDiameter);

  // Confidence: low coefficient of variation of radial distances = more
  // circular/complete coverage = higher confidence in the inferred center.
  const radii = points.map(p => Math.sqrt((p.x - cx) ** 2 + (p.y - cy) ** 2));
  const meanR = radii.reduce((s, r) => s + r, 0) / radii.length;
  const stdR = Math.sqrt(radii.reduce((s, r) => s + (r - meanR) ** 2, 0) / radii.length);
  const cv = meanR > 0 ? stdR / meanR : 1;
  const confidence = Math.max(0, Math.min(1, 1 - cv * 0.5));

  return {
    center: { x: cx, y: cy },
    diameter: snapped.diameter,
    radius: snapped.diameter / 2,
    confidence,
    method: snapped.method,
  };
}

function snapToStandardDiameter(estimated: number): { diameter: number; method: string } {
  for (const d of PREFERRED_DIAMETERS) {
    if (Math.abs(estimated - d) / d <= 0.10) {
      return { diameter: d, method: `snapped-${d}mm` };
    }
  }

  let closestDiff = Infinity;
  let closestDiameter = estimated;
  for (const d of STANDARD_DIAMETERS) {
    const diff = Math.abs(estimated - d);
    if (diff < closestDiff) {
      closestDiff = diff;
      closestDiameter = d;
    }
  }

  if (closestDiff / estimated <= 0.20) {
    return { diameter: closestDiameter, method: `snapped-${closestDiameter}mm` };
  }

  const rounded = Math.ceil(estimated / 10) * 10;
  return { diameter: rounded, method: 'rounded' };
}
