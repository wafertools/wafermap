import type { PositionedDie, Wafer } from '../core/index.js';
import { getDieKey } from '../core/dies.js';
import { clamp01 } from '../core/utils.js';

export type PatternLabel =
  | 'center'
  | 'donut'
  | 'edge-ring'
  | 'edge-local'
  | 'scratch'
  | 'near-full'
  | 'random'
  | 'none';

export interface PatternFeatures {
  /** Ratio of failing dies to total eligible dies (whole-wafer). */
  globalRdd: number;
  /** Ratio of failing dies in the outermost ring to total outermost-ring dies (whole-wafer). */
  edgeRdd: number;
  /** Distance from wafer centre to centroid of the salient region, normalised by wafer radius. */
  centroidDistNorm: number;
  /** Minimum distance from wafer centre among salient-region dies, normalised by radius. */
  minDistNorm: number;
  /** Maximum distance from wafer centre among salient-region dies, normalised by radius. */
  maxDistNorm: number;
  /**
   * 25th-percentile radial distance among ALL failing dies, normalised by radius.
   * Used for donut detection: a true donut has most fails away from the centre
   * even when the salient component incidentally touches the centre.
   */
  p25DistNorm: number;
  /**
   * Ratio of failure density in the inner half (r < 0.5) vs outer half (r >= 0.5).
   * Center: inner > outer (ratio > 1). Donut: outer > inner (ratio < 1).
   */
  innerOuterRatio: number;
  /**
   * Eccentricity of the bounding ellipse around the salient region (0 = circle, 1 = line).
   * Derived from the 2nd-order central moments of the salient-region die positions.
   */
  eccentricity: number;
  /**
   * Linear score: fraction of salient-region dies in the single best collinear run
   * (along row or column), normalised to [0, 1].
   */
  linearScore: number;
  /** Number of dies in the most salient (largest) connected component of failing dies. */
  salienceSize: number;
  /** Fraction of all failing dies that belong to the salient region. */
  salienceFraction: number;
  /**
   * Fraction of the full circumference (0–1) covered by edge-zone failing dies,
   * measured in 16 angular sectors. 1.0 = all sectors occupied (full ring),
   * low value = concentrated arc (edge-local).
   */
  edgeAngularSpread: number;
}

export interface PatternClassification {
  pattern: PatternLabel;
  confidence: 'high' | 'medium' | 'low';
  features: PatternFeatures;
  /** Human-readable note about classification uncertainty, when applicable. */
  note?: string;
}

export interface PatternThresholds {
  nearFullGlobalRdd: number;
  edgeRingEdgeRdd: number;
  edgeRingEdgeRddHigh: number;
  edgeRingRadialSpread: number;
  /** Minimum angular spread (0–1) for edge-ring vs edge-local classification. */
  edgeRingAngularSpread: number;
  edgeLocalEdgeRdd: number;
  /** p25DistNorm separator: ≥ this → edge-ring; [0.55, this) → edge-local. */
  edgeLocalCentroidDist: number;
  /** p25DistNorm separator: &lt; this → center; [this, 0.55) → donut. */
  donutP25Dist: number;
  centerCentroidDist: number;
  centerCentroidDistHigh: number;
  centerEdgeRdd: number;
  donutEdgeRdd: number;
  scratchLinearScore: number;
  scratchLinearScoreHigh: number;
  scratchEccentricity: number;
  minimumFailingDies: number;
}

/**
 * Default thresholds for the spatial pattern classifier.
 *
 * Calibrated against WM-811K — 25,519 labelled real-world wafers from TSMC
 * 300mm fabrication (Wu et al. 2015). Benchmark results on that dataset:
 *
 * | Pattern    | Recall | Notes                                      |
 * |------------|--------|--------------------------------------------|
 * | Near-full  | 100%   |                                            |
 * | Edge-ring  |  74%   |                                            |
 * | Edge-local |  65%   |                                            |
 * | Center     |  60%   |                                            |
 * | Random     |  59%   |                                            |
 * | Scratch    |  26%   | Fragmented patterns harder to detect       |
 * | Donut      |  15%   | Geometrically similar to center with noise |
 *
 * Overall accuracy: 64% exact match, 86% detection rate (any pattern flagged).
 */
export const DEFAULT_PATTERN_THRESHOLDS: PatternThresholds = {
  // Calibrated against WM-811K (25,519 labelled wafers)
  nearFullGlobalRdd:       0.60,
  // Edge-ring: p25D mean=0.84, edge-local p25D mean=0.69 → split at 0.76
  edgeRingEdgeRdd:         0.18,
  edgeRingEdgeRddHigh:     0.30,
  edgeRingRadialSpread:    0.45,
  edgeRingAngularSpread:   0.60,
  // Edge-local: p25D mean=0.69, centroid mean=0.23
  edgeLocalEdgeRdd:        0.10,
  edgeLocalCentroidDist:   0.76,  // p25D > 0.76 → edge-ring; 0.55–0.76 → edge-local
  donutP25Dist:            0.40,  // donut p25D mean=0.43, center=0.38 → split at 0.40
  // Center: cDist mean=0.07, p25D mean=0.38
  centerCentroidDist:      0.22,
  centerCentroidDistHigh:  0.10,
  centerEdgeRdd:           0.35,
  donutEdgeRdd:            0.22,  // donut eRdd mean=0.17, center=0.22 → split at 0.22
  // Scratch: gRdd mean=0.10, eRdd mean=0.12, p25D mean=0.60
  scratchLinearScore:      0.25,
  scratchLinearScoreHigh:  0.45,
  scratchEccentricity:     0.75,
  minimumFailingDies:      5,
};

// ── Connected-component labelling (8-connected) ───────────────────────────────

function findConnectedComponents(failing: PositionedDie[]): PositionedDie[][] {
  if (failing.length === 0) return [];

  const byKey = new Map<string, PositionedDie>();
  for (const d of failing) byKey.set(getDieKey(d), d);

  const visited = new Set<string>();
  const components: PositionedDie[][] = [];

  for (const d of failing) {
    const k = getDieKey(d);
    if (visited.has(k)) continue;

    // BFS
    const component: PositionedDie[] = [];
    const queue: PositionedDie[] = [d];
    visited.add(k);

    while (queue.length > 0) {
      const cur = queue.pop()!;
      component.push(cur);
      // 8-connected neighbours
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          if (dx === 0 && dy === 0) continue;
          const nk = `${cur.x + dx},${cur.y + dy}`;
          if (!visited.has(nk) && byKey.has(nk)) {
            visited.add(nk);
            queue.push(byKey.get(nk)!);
          }
        }
      }
    }
    components.push(component);
  }

  return components;
}

// ── Feature computation ────────────────────────────────────────────────────────

function isEdgeDie(die: PositionedDie, wafer: Wafer, ringCount: number): boolean {
  const dx = die.physX - wafer.center.x;
  const dy = die.physY - wafer.center.y;
  const normalized = Math.sqrt(dx * dx + dy * dy) / wafer.radius;
  const ring = Math.min(ringCount, Math.max(1, Math.floor(normalized * ringCount) + 1));
  return ring === ringCount;
}

function computeEccentricity(dies: PositionedDie[], cx: number, cy: number): number {
  if (dies.length < 3) return 0;
  let mxx = 0, myy = 0, mxy = 0;
  for (const d of dies) {
    const dx = d.physX - cx;
    const dy = d.physY - cy;
    mxx += dx * dx;
    myy += dy * dy;
    mxy += dx * dy;
  }
  mxx /= dies.length;
  myy /= dies.length;
  mxy /= dies.length;
  const trace = mxx + myy;
  const det   = mxx * myy - mxy * mxy;
  const disc  = Math.max(0, (trace / 2) ** 2 - det);
  const lambda1 = trace / 2 + Math.sqrt(disc);
  const lambda2 = trace / 2 - Math.sqrt(disc);
  if (lambda1 <= 0) return 0;
  const ratio = clamp01(lambda2 / lambda1);
  return Math.sqrt(1 - ratio);
}

function computeLinearScore(dies: PositionedDie[], total: number): number {
  if (total === 0) return 0;
  // Axis-aligned: count per row and column
  const rowCounts = new Map<number, number>();
  const colCounts = new Map<number, number>();
  // Diagonal: d1 = x-y (constant along NE-SW diagonal), d2 = x+y (constant along NW-SE diagonal)
  const diag1Counts = new Map<number, number>();
  const diag2Counts = new Map<number, number>();
  for (const d of dies) {
    rowCounts.set(d.y, (rowCounts.get(d.y) ?? 0) + 1);
    colCounts.set(d.x, (colCounts.get(d.x) ?? 0) + 1);
    diag1Counts.set(d.x - d.y, (diag1Counts.get(d.x - d.y) ?? 0) + 1);
    diag2Counts.set(d.x + d.y, (diag2Counts.get(d.x + d.y) ?? 0) + 1);
  }
  let maxRun = 0;
  for (const count of rowCounts.values())  if (count > maxRun) maxRun = count;
  for (const count of colCounts.values())  if (count > maxRun) maxRun = count;
  for (const count of diag1Counts.values()) if (count > maxRun) maxRun = count;
  for (const count of diag2Counts.values()) if (count > maxRun) maxRun = count;
  return maxRun / total;
}

function computeFeatures(
  failing: PositionedDie[],
  all: PositionedDie[],
  wafer: Wafer,
  ringCount: number,
): PatternFeatures {
  const n = all.length;
  const k = failing.length;
  const globalRdd = n > 0 ? k / n : 0;

  // Global edge RDD — whole-wafer statistic, not region-specific
  const edgeDies    = all.filter(d => isEdgeDie(d, wafer, ringCount));
  const edgeFailing = failing.filter(d => isEdgeDie(d, wafer, ringCount));
  const edgeRdd     = edgeDies.length > 0 ? edgeFailing.length / edgeDies.length : 0;

  // Find connected components; largest = salient region for position/shape features.
  // For linear score and eccentricity, union the top-5 components so fragmented
  // scratches (which break into many small diagonal runs) are captured.
  const components = findConnectedComponents(failing);
  const sorted = components.length > 0
    ? [...components].sort((a, b) => b.length - a.length)
    : [failing];
  const salient      = sorted[0];
  const top5         = sorted.slice(0, 5).flat();
  const salienceSize     = salient.length;
  const salienceFraction = k > 0 ? salienceSize / k : 0;

  // Shape and position features computed on salient region
  const cx = wafer.center.x;
  const cy = wafer.center.y;
  const r  = wafer.radius;

  let sumX = 0, sumY = 0;
  let minDist = Infinity, maxDist = 0;
  for (const d of salient) {
    sumX += d.physX;
    sumY += d.physY;
    const dist = Math.sqrt((d.physX - cx) ** 2 + (d.physY - cy) ** 2);
    if (dist < minDist) minDist = dist;
    if (dist > maxDist) maxDist = dist;
  }
  const centroidX = sumX / salient.length;
  const centroidY = sumY / salient.length;
  const centroidDistNorm = Math.sqrt((centroidX - cx) ** 2 + (centroidY - cy) ** 2) / r;
  const minDistNorm      = minDist === Infinity ? 0 : minDist / r;
  const maxDistNorm      = Math.min(maxDist / r, 1);

  // 25th-percentile radial distance over ALL failing dies
  const allDists = failing.map(d =>
    Math.sqrt((d.physX - cx) ** 2 + (d.physY - cy) ** 2) / r,
  ).sort((a, b) => a - b);
  const p25DistNorm = allDists[Math.floor(allDists.length * 0.25)] ?? 0;

  // Inner/outer density ratio: compare fail rate in inner half vs outer half
  // of the wafer area. Center has high inner density; donut is the inverse.
  const allInner  = all.filter(d => Math.sqrt((d.physX-cx)**2+(d.physY-cy)**2)/r < 0.5).length;
  const allOuter  = all.filter(d => Math.sqrt((d.physX-cx)**2+(d.physY-cy)**2)/r >= 0.5).length;
  const failInner = failing.filter(d => Math.sqrt((d.physX-cx)**2+(d.physY-cy)**2)/r < 0.5).length;
  const failOuter = failing.filter(d => Math.sqrt((d.physX-cx)**2+(d.physY-cy)**2)/r >= 0.5).length;
  const innerRate = allInner > 0 ? failInner / allInner : 0;
  const outerRate = allOuter > 0 ? failOuter / allOuter : 0;
  const innerOuterRatio = outerRate > 0 ? innerRate / outerRate : (innerRate > 0 ? 2 : 1);

  // Use top-5 components for eccentricity and linear score so fragmented
  // scratches (many small diagonal runs) are not missed.
  const top5CentroidX = top5.reduce((s, d) => s + d.physX, 0) / top5.length;
  const top5CentroidY = top5.reduce((s, d) => s + d.physY, 0) / top5.length;
  const eccentricity = computeEccentricity(top5, top5CentroidX, top5CentroidY);
  const linearScore  = computeLinearScore(top5, top5.length);

  // Angular spread of edge-zone failing dies: count occupied sectors out of 16
  const SECTORS = 16;
  const edgeOccupied = new Set<number>();
  for (const d of edgeFailing) {
    const angle = (Math.atan2(d.physY - cy, d.physX - cx) + 2 * Math.PI) % (2 * Math.PI);
    edgeOccupied.add(Math.floor((angle / (2 * Math.PI)) * SECTORS) % SECTORS);
  }
  const edgeAngularSpread = edgeFailing.length > 0 ? edgeOccupied.size / SECTORS : 0;

  return {
    globalRdd, edgeRdd,
    centroidDistNorm, minDistNorm, maxDistNorm, p25DistNorm,
    eccentricity, linearScore,
    salienceSize, salienceFraction,
    edgeAngularSpread, innerOuterRatio,
  };
}

// ── Classifier ─────────────────────────────────────────────────────────────────

function classify(
  f: PatternFeatures,
  t: PatternThresholds,
  dieCount: number,
): { pattern: PatternLabel; confidence: 'high' | 'medium' | 'low'; note?: string } {
  // Require minimum salient size for shape-based rules to fire.
  // Scale with wafer size: 0.3% of die count, floored at 5.
  // A 5-die cluster is meaningful on a small wafer but noise on a 2500-die wafer.
  const minSalience = Math.max(5, Math.round(dieCount * 0.003));
  const salienceOk = f.salienceSize >= minSalience;

  // If the salient region covers less than 10% of failing dies there is no
  // dominant spatial cluster — treat as random.
  // (near-full exempt: when whole wafer fails, no single cluster exists)
  if (f.globalRdd < t.nearFullGlobalRdd && f.salienceFraction < 0.10) {
    return { pattern: 'random', confidence: 'low' };
  }

  // near-full: almost the whole wafer is failing
  if (f.globalRdd >= t.nearFullGlobalRdd) {
    return { pattern: 'near-full', confidence: f.globalRdd >= 0.80 ? 'high' : 'medium' };
  }

  // scratch: elongated linear pattern — includes diagonal runs
  if (salienceOk && f.linearScore >= t.scratchLinearScore && f.eccentricity >= t.scratchEccentricity) {
    const confidence = f.linearScore >= t.scratchLinearScoreHigh ? 'high' : 'medium';
    const note = confidence === 'medium'
      ? 'Scratch detection is less reliable for fragmented or diagonal patterns'
      : undefined;
    return { pattern: 'scratch', confidence, note };
  }

  // Edge patterns: use p25DistNorm as primary separator (calibrated on WM-811K).
  // p25D > edgeLocalCentroidDist (0.76) → edge-ring; 0.55–0.76 → edge-local.
  // Also require salient region reaches the outer zone (maxDistNorm >= 0.70).
  const hasEdgeSignal = salienceOk && f.edgeRdd >= t.edgeLocalEdgeRdd && f.maxDistNorm >= 0.70;

  // edge-ring: p25D is very high (mean 0.84) — fails concentrated at periphery in
  // a full ring. Check before edge-local.
  if (
    hasEdgeSignal &&
    f.p25DistNorm >= t.edgeLocalCentroidDist &&
    f.maxDistNorm - f.minDistNorm <= t.edgeRingRadialSpread
  ) {
    const confidence = f.edgeRdd >= t.edgeRingEdgeRddHigh ? 'high' : 'medium';
    return { pattern: 'edge-ring', confidence };
  }

  // edge-local: p25D moderate (mean 0.69), centroid off-centre (mean 0.23).
  if (
    hasEdgeSignal &&
    f.p25DistNorm >= 0.55 &&
    f.p25DistNorm < t.edgeLocalCentroidDist
  ) {
    return { pattern: 'edge-local', confidence: f.edgeRdd >= t.edgeRingEdgeRdd ? 'medium' : 'low' };
  }

  // center vs donut: both have centroid near wafer centre and low eRdd.
  // Use p25DistNorm as primary separator (center mean=0.38, donut mean=0.43).
  // These classes overlap heavily at real-wafer noise levels; misclassifications are common.
  // WM-811K center wafers have background scatter so maxDistNorm is ~1.0 — no gate.
  // Note: innerOuterRatio is not a useful discriminator here — WM-811K donuts have
  // high inner/outer failure rates due to the hole geometry reducing outer fail rate.
  const isSymmetric = salienceOk && f.centroidDistNorm <= t.centerCentroidDist && f.edgeRdd <= t.centerEdgeRdd;

  const CENTER_DONUT_NOTE = 'Center and donut patterns have similar geometry; classification may be imprecise';

  if (isSymmetric && f.p25DistNorm < t.donutP25Dist) {
    const confidence = f.centroidDistNorm <= t.centerCentroidDistHigh ? 'high' : 'medium';
    const note = confidence !== 'high' ? CENTER_DONUT_NOTE : undefined;
    return { pattern: 'center', confidence, note };
  }

  if (isSymmetric && f.p25DistNorm >= t.donutP25Dist && f.p25DistNorm < 0.55) {
    return { pattern: 'donut', confidence: 'medium', note: CENTER_DONUT_NOTE };
  }

  return { pattern: 'random', confidence: 'low' };
}

/**
 * Classify the spatial failure pattern of a wafer from its die data.
 *
 * Uses connected-component analysis to identify the most salient (largest)
 * failing region, then computes shape and position features on that region.
 * Global statistics (RDD, edge RDD) are computed over all failing dies.
 *
 * Returns `null` when the failing-die count is below the minimum threshold
 * (`thresholds.minimumFailingDies`, default 5) — too few failures to classify.
 */
export function classifyPattern(
  dies: PositionedDie[],
  wafer: Wafer,
  options: {
    passBins: number[];
    ringCount?: number;
  },
): PatternClassification | null {
  const t: PatternThresholds = { ...DEFAULT_PATTERN_THRESHOLDS };
  const ringCount = options.ringCount ?? 4;
  const passSet   = new Set(options.passBins);

  const failing = dies.filter(d => {
    const bin = d.hbin ?? d.sbin;
    return bin !== undefined && !passSet.has(bin);
  });

  // Adaptive minimum: 0.3% of wafer die count, floored at 5.
  const minFailingDies = Math.max(t.minimumFailingDies, Math.round(dies.length * 0.003));
  if (failing.length < minFailingDies) return null;

  const features = computeFeatures(failing, dies, wafer, ringCount);
  const { pattern, confidence, note } = classify(features, t, dies.length);

  return { pattern, confidence, features, ...(note ? { note } : {}) };
}
