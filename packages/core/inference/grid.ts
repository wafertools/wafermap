export interface GridAssignment {
  /** Parallel to the input points array — x,y index for each point. */
  indices: Array<{ x: number; y: number }>;
  /**
   * Integer offset of the grid origin from (0,0) in prober-step units.
   * To map a generated die's (x,y) back to the original prober position:
   *   origX = die.x + offsetX,  origY = die.y + offsetY
   */
  offsetX: number;
  offsetY: number;
  /**
   * 1.0 when all input positions are already integers (typical prober data);
   * lower when positions have significant fractional parts.
   */
  confidence: number;
}

/**
 * Assign grid indices to prober-step grid positions.
 *
 * Input x,y are die grid positions (prober step coordinates — integers in
 * normal use).  The offset is the rounded centroid of all positions so that
 * the generated die grid is centred at the wafer's physical origin (0,0).
 *
 * The offset is always an integer, which ensures that x = inputX − offsetX is
 * also an integer for integer inputs regardless of whether the centroid is
 * a whole number or a half-integer (e.g. even-count symmetric grids).
 */
export function assignGridIndices(
  gridPoints: Array<{ x: number; y: number }>,
): GridAssignment {
  if (gridPoints.length === 0) {
    return { indices: [], offsetX: 0, offsetY: 0, confidence: 1 };
  }

  const cx = gridPoints.reduce((s, p) => s + p.x, 0) / gridPoints.length;
  const cy = gridPoints.reduce((s, p) => s + p.y, 0) / gridPoints.length;

  const offsetX = Math.round(cx);
  const offsetY = Math.round(cy);

  const indices = gridPoints.map(p => ({
    x: Math.round(p.x) - offsetX,
    y: Math.round(p.y) - offsetY,
  }));

  // Confidence: fraction of points that were already near-integer.
  const nonInteger = gridPoints.filter(
    p => Math.abs(p.x - Math.round(p.x)) > 0.01 || Math.abs(p.y - Math.round(p.y)) > 0.01,
  ).length;
  const confidence = 1 - nonInteger / gridPoints.length;

  return { indices, offsetX, offsetY, confidence };
}
