import { modeOf as genericModeOf } from '../utils.js';

export interface PitchResult {
  pitchX: number;
  pitchY: number;
  /** 'mm' when at least one physical dimension is known; 'normalized' when
   *  dimensions are estimated solely from the circular grid constraint. */
  units: 'mm' | 'normalized';
  confidence: number;
}

// ── Nearest-neighbour pitch estimation ────────────────────────────────────────

/**
 * Return the most-frequent (mode) value from an array of positive numbers.
 * Values are rounded to one decimal place before counting to absorb
 * floating-point noise from prober step data.
 */
function modeOf(values: number[]): number | null {
  if (!values.length) return null;
  // Round to one decimal place before finding the mode to absorb 
  // floating-point noise from prober step data.
  const rounded = values.map(v => Math.round(v * 10) / 10);
  return genericModeOf(rounded);
}

/**
 * Estimate die pitch by finding the mode of adjacent-step distances within
 * rows (for X pitch) and within columns (for Y pitch).
 *
 * Works well even with sparse datasets where the circular-constraint aspect
 * ratio is unreliable (e.g., quarter-wafer coverage, strip lots).
 *
 * Returns null when the dataset is too small to derive both pitches.
 */
function computeNearestNeighborPitch(
  gridPoints: Array<{ x: number; y: number }>,
): { pitchX: number; pitchY: number } | null {
  if (gridPoints.length < 2) return null;

  const pts = gridPoints.map(p => ({ x: Math.round(p.x), y: Math.round(p.y) }));

  // Group by row (Y value) to collect X step distances.
  const byRow = new Map<number, number[]>();
  for (const p of pts) {
    const xs = byRow.get(p.y) ?? [];
    xs.push(p.x);
    byRow.set(p.y, xs);
  }
  const xSteps: number[] = [];
  for (const xs of byRow.values()) {
    xs.sort((a, b) => a - b);
    for (let index = 1; index < xs.length; index++) {
      const d = xs[index] - xs[index - 1];
      if (d > 0) xSteps.push(d);
    }
  }

  // Group by column (X value) to collect Y step distances.
  const byCol = new Map<number, number[]>();
  for (const p of pts) {
    const ys = byCol.get(p.x) ?? [];
    ys.push(p.y);
    byCol.set(p.x, ys);
  }
  const ySteps: number[] = [];
  for (const ys of byCol.values()) {
    ys.sort((a, b) => a - b);
    for (let index = 1; index < ys.length; index++) {
      const d = ys[index] - ys[index - 1];
      if (d > 0) ySteps.push(d);
    }
  }

  const pitchX = modeOf(xSteps);
  const pitchY = modeOf(ySteps);

  if (pitchX === null && pitchY === null) return null;
  // When one axis has no adjacent pairs, fall back to the other axis value.
  const px = pitchX ?? pitchY!;
  const py = pitchY ?? pitchX!;
  return { pitchX: px, pitchY: py };
}

// ── Public resolver ───────────────────────────────────────────────────────────

/**
 * Resolve die pitch from prober-step grid positions and optional geometry.
 *
 * Input x,y are integer prober step coordinates (die grid positions), not mm.
 * Physical mm position = grid_pos × pitch.
 *
 * When neither die dimensions nor wafer diameter are known, the function tries
 * nearest-neighbour step analysis first (works well for regular grids with ≥ 4
 * points), then falls back to the circular-wafer aspect-ratio constraint.
 */
export function resolveGridPitch(
  gridPoints: Array<{ x: number; y: number }>,
  dieOpts?: { width?: number; height?: number },
  waferDiameter?: number,
): PitchResult {
  const hasWidth  = dieOpts?.width  !== undefined;
  const hasHeight = dieOpts?.height !== undefined;

  // Case 1: Both dimensions provided — fully specified in mm.
  if (hasWidth && hasHeight) {
    return {
      pitchX: dieOpts!.width!,
      pitchY: dieOpts!.height!,
      units: 'mm',
      confidence: 1.0,
    };
  }

  if (gridPoints.length === 0) {
    const fallback = hasWidth ? dieOpts!.width! : hasHeight ? dieOpts!.height! : 10;
    return {
      pitchX: fallback,
      pitchY: fallback,
      units: hasWidth || hasHeight || waferDiameter !== undefined ? 'mm' : 'normalized',
      confidence: 0,
    };
  }

  const xs = gridPoints.map(p => p.x);
  const ys = gridPoints.map(p => p.y);
  const xRange = Math.max(...xs) - Math.min(...xs) + 1;
  const yRange = Math.max(...ys) - Math.min(...ys) + 1;

  // Case 2: Width only — derive height from circular aspect ratio.
  if (hasWidth) {
    const pitchX = dieOpts!.width!;
    return { pitchX, pitchY: pitchX * xRange / yRange, units: 'mm', confidence: 0.8 };
  }

  // Case 3: Height only — derive width from circular aspect ratio.
  if (hasHeight) {
    const pitchY = dieOpts!.height!;
    return { pitchX: pitchY * yRange / xRange, pitchY, units: 'mm', confidence: 0.8 };
  }

  // Case 4: Wafer diameter provided but no die size.
  // Each axis independently spans approximately the full diameter in steps.
  if (waferDiameter !== undefined) {
    return {
      pitchX: waferDiameter / xRange,
      pitchY: waferDiameter / yRange,
      units: 'mm',
      confidence: 0.6,
    };
  }

  // Case 5: Nothing provided — attempt nearest-neighbour step analysis first,
  // then apply the circular-wafer constraint to recover the aspect ratio.
  //
  // NN finds the step size in each axis (e.g. pitchX=1, pitchY=1 for integer
  // grid coordinates). When NN returns equal steps in both directions the ratio
  // is uninformative (all integer grids look the same), so we use the circular
  // constraint: a wafer is always round, therefore physical X and Y extents must
  // be equal, giving pitchY/pitchX = xRange/yRange.
  //
  // When NN finds genuinely different step sizes (e.g. a 2-step coarse grid on
  // one axis), those steps carry real aspect-ratio information and we use them
  // directly — the circular constraint is not applied on top.
  const nn = computeNearestNeighborPitch(gridPoints);
  const nnRatio = nn !== null ? nn.pitchY / nn.pitchX : 1;
  const useCircular = nnRatio === 1;
  const aspectRatio = useCircular && yRange > 0 ? xRange / yRange : nnRatio;
  return {
    pitchX: 1,
    pitchY: aspectRatio,
    units: 'normalized',
    confidence: nn !== null ? 0.5 : 0.4,
  };
}
