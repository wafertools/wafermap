import type { PositionedDie } from '../core/dies.js';
import type { Wafer } from '../core/wafer.js';
import { findConnectedComponents } from './connectedComponents.js';
import { clamp01 } from '../core/utils.js';
import { ringOf } from '../core/classify.js';

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
  /**
   * Spread of the salient region across its principal axis (root mean square), in die pitches. A scratch is
   * about one die wide at any angle (under 1); a blob is wider.
   */
  lineWidth: number;
  /** Extent of the salient region along its principal axis, in die pitches. */
  lineLength: number;
  /** Failing dies on that line: the salient region and the fragments that continue it along its axis. */
  lineSize: number;
  /** Nearest and farthest distance of that line's dies from the wafer centre, normalised by radius. */
  lineMinDistNorm: number;
  lineMaxDistNorm: number;
  /**
   * Fail rate in five rings of equal width, centre outwards (0–0.2 of the radius, 0.2–0.4, …). A donut is a
   * raised band at mid-radius over a cleaner centre and rim; a centre cluster falls away from the first.
   */
  radialFailRates: number[];
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
  centerCentroidDist: number;
  centerCentroidDistHigh: number;
  centerEdgeRdd: number;
  /** A scratch's salient region is at most this wide across its axis (lineWidth, die pitches). */
  scratchMaxLineWidth: number;
  /** …and at least this long along it (lineLength, die pitches): random fails at 15% make thin groups 6–7
   *  dies long by chance, whatever the wafer's size. */
  scratchMinLineLength: number;
  /** …and at least this long against the wafer's radius in pitches, so a scratch is long for its wafer. */
  scratchMinLineLengthRadius: number;
  /** A scratch's line must reach at least this far out (lineMaxDistNorm): a
   *  scratch is long, so an elongated blob wholly inside the central zone is a
   *  centre cluster, not a scratch. */
  scratchMinReach: number;
  /** …and come at least this far in (lineMinDistNorm below it): a thin line along the rim is edge-local. */
  scratchMaxInnerDist: number;
  /** A donut's mid-radius band (the higher of rings 2 and 3 of `radialFailRates`) fails at least this much more
   *  often than the centre band, at least `donutRim` more than the outermost, and at least `donutPeak` in all. */
  donutHole: number;
  donutRim: number;
  donutPeak: number;
  minimumFailingDies: number;
}

/**
 * Default thresholds for the spatial pattern classifier.
 *
 * Calibrated against WM-811K — 25,519 labelled real-world wafers from TSMC
 * 300mm fabrication (Wu et al. 2015). Benchmark results on that dataset
 * (`scripts/run-benchmark-npz.mjs`, 2026-10-09):
 *
 * | Pattern    | Recall | Precision |
 * |------------|--------|-----------|
 * | Near-full  | 100%   | 40%       |
 * | Center     |  85%   | 88%       |
 * | Donut      |  78%   | 69%       |
 * | Edge-ring  |  75%   | 92%       |
 * | Edge-local |  68%   | 52%       |
 * | Random     |  60%   | 52%       |
 * | Scratch    |  41%   | 87%       |
 *
 * Overall: 71% exact match.
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
  // Center: cDist mean=0.07, p25D mean=0.38
  centerCentroidDist:      0.22,
  centerCentroidDistHigh:  0.10,
  centerEdgeRdd:           0.35,
  // Scratch: the salient region is a thin line at any angle. WM-811K medians: lineWidth 0.68 for
  // scratches, 1.24 edge-local, 1.65 random, 1.86 centre. 0.75–0.9 wide and 0.7–0.8 inner reach score
  // within 0.2 points of each other (2026-10-09); the middle is taken. 8 dies long rather than 6 keeps
  // chance lines on random wafers out (5 of 160 clean synthetic wafers at 3–25% fails → 1) for 6 points
  // of scratch recall on WM-811K (precision 84% → 91%).
  scratchMaxLineWidth:     0.8,
  scratchMinLineLength:    8,
  scratchMinLineLengthRadius: 0.3,
  // Elongated centre clusters (maxD 0.21–0.29) are not scratches.
  scratchMinReach:         0.35,
  // A thin line along the rim (minD at or above 0.7) is edge-local.
  scratchMaxInnerDist:     0.7,
  // Donut: mid-radius band over centre and rim. WM-811K 10th percentiles for donuts: 0.13 over the
  // centre, 0.15 over the rim; 75th percentiles for centre −0.26 and random 0.05 over the centre.
  // 0.12–0.20 for both score within 0.1 point of each other; 0.15 is the middle.
  donutHole:               0.15,
  donutRim:                0.15,
  donutPeak:               0.15,
  minimumFailingDies:      5,
};


// ── Feature computation ────────────────────────────────────────────────────────

function isEdgeDie(die: PositionedDie, wafer: Wafer, ringCount: number): boolean {
  return ringOf(die.physX - wafer.center.x, die.physY - wafer.center.y, wafer.radius, ringCount) === ringCount;
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

/** Spread across (root mean square) and extent along the principal axis of `dies` about (cx, cy), in `pitch` units. */
function principalAxisExtent(dies: PositionedDie[], cx: number, cy: number, pitch: number): { width: number; length: number } {
  if (dies.length < 2) return { width: 0, length: 0 };
  let sxx = 0, syy = 0, sxy = 0;
  for (const d of dies) {
    const dx = d.physX - cx, dy = d.physY - cy;
    sxx += dx * dx; syy += dy * dy; sxy += dx * dy;
  }
  const theta = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  const ux = Math.cos(theta), uy = Math.sin(theta);
  let lo = Infinity, hi = -Infinity, across = 0;
  for (const d of dies) {
    const dx = d.physX - cx, dy = d.physY - cy;
    const along = dx * ux + dy * uy;
    const off = dy * ux - dx * uy;
    across += off * off;
    if (along < lo) lo = along;
    if (along > hi) hi = along;
  }
  return { width: Math.sqrt(across / dies.length) / pitch, length: (hi - lo) / pitch };
}

function centroidOf(dies: PositionedDie[]): [number, number] {
  let x = 0, y = 0;
  for (const d of dies) { x += d.physX; y += d.physY; }
  return [x / dies.length, y / dies.length];
}

/** Fragments within this many pitches of the line, across it, and of its current end, along it, continue it. */
const LINE_ACROSS = 1.5;
const LINE_GAP = 3;

/**
 * `salient` with the `fragments` that continue its principal axis: a fragment every die of which lies within
 * {@link LINE_ACROSS} pitches of the line, and within {@link LINE_GAP} pitches of the line's current end. Taken
 * one at a time, the nearest first, with the axis re-fitted to the line after each, so a line grows only
 * through its own gaps (never out to scattered fails far along it) and a short first piece's direction is
 * corrected as the line lengthens.
 */
function extendAlongAxis(salient: PositionedDie[], fragments: PositionedDie[][], pitch: number): PositionedDie[] {
  const line = [...salient];
  if (salient.length < 2) return line;
  const rest = fragments.filter(f => f.length > 0);
  for (;;) {
    const [cx, cy] = centroidOf(line);
    let sxx = 0, syy = 0, sxy = 0;
    for (const d of line) {
      const dx = d.physX - cx, dy = d.physY - cy;
      sxx += dx * dx; syy += dy * dy; sxy += dx * dy;
    }
    const theta = 0.5 * Math.atan2(2 * sxy, sxx - syy);
    const ux = Math.cos(theta), uy = Math.sin(theta);
    const along = (d: PositionedDie) => (d.physX - cx) * ux + (d.physY - cy) * uy;
    let lo = Infinity, hi = -Infinity;
    for (const d of line) { const t = along(d); if (t < lo) lo = t; if (t > hi) hi = t; }
    let best = -1, bestGap = Infinity;
    for (let i = 0; i < rest.length; i++) {
      let a = Infinity, b = -Infinity, offLine = false;
      for (const d of rest[i]) {
        if (Math.abs((d.physY - cy) * ux - (d.physX - cx) * uy) > LINE_ACROSS * pitch) { offLine = true; break; }
        const t = along(d);
        if (t < a) a = t;
        if (t > b) b = t;
      }
      if (offLine) continue;
      const gap = Math.max(a - hi, lo - b, 0);
      if (gap <= LINE_GAP * pitch && gap < bestGap) { best = i; bestGap = gap; }
    }
    if (best < 0) return line;
    line.push(...rest[best]);
    rest.splice(best, 1);
  }
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
  // Largest first; equal sizes nearest the centre first, then by their first die in grid order: neither the
  // order the dies arrive in nor a turn of the wafer decides which group is salient or which fragments extend
  // a line.
  const tieKey = (c: PositionedDie[]): [number, number, number] => {
    let y = Infinity, x = Infinity, mx = 0, my = 0;
    for (const d of c) {
      mx += d.physX; my += d.physY;
      if (d.y < y || (d.y === y && d.x < x)) { y = d.y; x = d.x; }
    }
    const radius = Math.hypot(mx / c.length - wafer.center.x, my / c.length - wafer.center.y);
    return [Math.round(radius * 1e6), y, x];
  };
  const sorted = components.length > 0
    ? components.map(c => ({ c, k: tieKey(c) }))
        .sort((a, b) => b.c.length - a.c.length || a.k[0] - b.k[0] || a.k[1] - b.k[1] || a.k[2] - b.k[2])
        .map(({ c }) => c)
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

  // The salient region against its own principal axis (any angle), in die pitches, extended by the
  // fragments that continue it: a scratch at a sparse density breaks into pieces along one line.
  // `lineWidth`, `lineLength` and `lineSize` describe that line.
  const pitch = Math.max(salient[0]?.width ?? 1, salient[0]?.height ?? 1);
  const line = extendAlongAxis(salient, sorted.slice(1, 12), pitch);
  const { width: lineWidth, length: lineLength } = principalAxisExtent(line, ...centroidOf(line), pitch);
  let lineMin = Infinity, lineMax = 0;
  for (const d of line) {
    const dist = Math.sqrt((d.physX - cx) ** 2 + (d.physY - cy) ** 2) / r;
    if (dist < lineMin) lineMin = dist;
    if (dist > lineMax) lineMax = dist;
  }
  const lineMinDistNorm = lineMin === Infinity ? 0 : lineMin;
  const lineMaxDistNorm = Math.min(lineMax, 1);

  // Fail rate in five rings of equal width.
  const BANDS = 5;
  const bandN = new Array<number>(BANDS).fill(0), bandK = new Array<number>(BANDS).fill(0);
  const failingSet = new Set(failing);
  for (const d of all) {
    const b = Math.min(BANDS - 1, Math.floor(Math.sqrt((d.physX - cx) ** 2 + (d.physY - cy) ** 2) / r * BANDS));
    bandN[b]++;
    if (failingSet.has(d)) bandK[b]++;
  }
  const radialFailRates = bandN.map((n, i) => n > 0 ? bandK[i] / n : 0);

  return {
    globalRdd, edgeRdd,
    centroidDistNorm, minDistNorm, maxDistNorm, p25DistNorm,
    eccentricity, linearScore,
    salienceSize, salienceFraction,
    edgeAngularSpread, innerOuterRatio,
    lineWidth, lineLength, lineSize: line.length, lineMinDistNorm, lineMaxDistNorm, radialFailRates,
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

  // edge-ring from the failing dies' positions alone: most fails at the rim and
  // spread round it. A ring is often fragmented — scattered fails with no
  // connected component big enough to be "salient" — so it must not depend on
  // one, and must be tested before the no-dominant-cluster exit and before the
  // scratch rule (a short run along the rim is not a scratch).
  if (
    f.globalRdd < t.nearFullGlobalRdd &&
    f.p25DistNorm >= t.edgeLocalCentroidDist &&
    f.edgeAngularSpread >= t.edgeRingAngularSpread &&
    f.edgeRdd >= t.edgeLocalEdgeRdd
  ) {
    return { pattern: 'edge-ring', confidence: f.edgeRdd >= t.edgeRingEdgeRddHigh ? 'high' : 'medium' };
  }

  // donut: a band of fails at mid-radius over a cleaner centre and rim, read from the fail rate by
  // radius rather than from one connected group, which a donut's ring rarely forms.
  const [band0, band1, band2, , band4] = f.radialFailRates;
  const midBand = Math.max(band1, band2);
  if (
    f.globalRdd < t.nearFullGlobalRdd &&
    midBand >= t.donutPeak && midBand - band0 >= t.donutHole && midBand - band4 >= t.donutRim
  ) {
    return { pattern: 'donut', confidence: midBand - band0 >= 2 * t.donutHole ? 'high' : 'medium' };
  }

  // scratch: the salient region is a long, thin line at any angle, reaching in from the edge. Tested before
  // the no-dominant-cluster exit: a scratch on a noisy wafer holds few of its failing dies.
  if (
    f.globalRdd < t.nearFullGlobalRdd && f.lineSize >= minSalience &&
    f.lineWidth <= t.scratchMaxLineWidth && f.lineLength >= t.scratchMinLineLength &&
    f.lineLength >= t.scratchMinLineLengthRadius * Math.sqrt(dieCount / Math.PI) &&
    f.lineMaxDistNorm >= t.scratchMinReach && f.lineMinDistNorm < t.scratchMaxInnerDist
  ) {
    return { pattern: 'scratch', confidence: f.lineWidth <= t.scratchMaxLineWidth / 2 ? 'high' : 'medium' };
  }

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

  // center: the salient region sits on the centre and the edge is not failing. (A donut was taken above,
  // by its radial profile.)
  const isSymmetric = salienceOk && f.centroidDistNorm <= t.centerCentroidDist && f.edgeRdd <= t.centerEdgeRdd;
  if (isSymmetric) {
    return { pattern: 'center', confidence: f.centroidDistNorm <= t.centerCentroidDistHigh ? 'high' : 'medium' };
  }

  return { pattern: 'random', confidence: 'low' };
}

/** How each pattern is named to an engineer — the wafer's finding and the lot's. */
export const PATTERN_LABELS: Record<PatternLabel, string> = {
  'center':     'Center cluster',
  'donut':      'Donut',
  'edge-ring':  'Edge-ring',
  'edge-local': 'Edge-local',
  'scratch':    'Scratch',
  'near-full':  'Near-full',
  'random':     'Random',
  'none':       'None',
};

/**
 * Whether a die counts as failing for pattern classification: its hard bin, or
 * failing that its soft bin, is not a pass bin. `undefined` for a die with no
 * bin — no data, neither passing nor failing.
 */
export function patternFailVerdict(die: { hbin?: number; sbin?: number }, passSet: ReadonlySet<number>): boolean | undefined {
  const bin = die.hbin ?? die.sbin;
  return bin === undefined ? undefined : !passSet.has(bin);
}

/**
 * The finding families a spatial pattern explains, and so lists under itself:
 * the ring an edge or centre pattern lies in, the edge arcs of an edge pattern,
 * the clusters of a centre cluster or a scratch. One rule for the wafer's
 * pattern and the lot's.
 *
 * `rings` are the ring numbers a ring finding covers (none for other families);
 * edge patterns explain the outer ring, a centre cluster the core ring, a donut
 * the rings between.
 */
export function patternExplains(pattern: PatternLabel, family: string, rings: number[], ringCount: number): boolean {
  const families: Partial<Record<PatternLabel, string[]>> = {
    'edge-ring':  ['ring', 'edge-arc'],
    'edge-local': ['edge-arc', 'sector', 'quadrant'],
    'center':     ['ring', 'cluster'],
    'donut':      ['ring'],
    'scratch':    ['cluster', 'sector', 'quadrant'],
    'near-full':  ['ring'],
  };
  if (!families[pattern]?.includes(family)) return false;
  if (family !== 'ring' || rings.length === 0) return true;
  const includesEdge = rings.includes(ringCount);
  const includesCore = rings.includes(1);
  if (pattern === 'edge-ring' || pattern === 'edge-local') return includesEdge;
  if (pattern === 'center') return includesCore;
  if (pattern === 'donut') return !includesEdge && !includesCore;
  return true; // near-full: every ring
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
    ringCount: number;
  },
): PatternClassification | null {
  const passSet = new Set(options.passBins);
  const failing = dies.filter(d => patternFailVerdict(d, passSet) === true);
  return classifyFailingDies(failing, dies, wafer, options.ringCount);
}

/**
 * {@link classifyPattern} over a failing set already chosen — a wafer's failing
 * dies, or the positions at which a lot's failures recur (`findLotPattern`).
 */
export function classifyFailingDies(
  failing: PositionedDie[],
  dies: PositionedDie[],
  wafer: Wafer,
  ringCount: number,
): PatternClassification | null {
  const t: PatternThresholds = { ...DEFAULT_PATTERN_THRESHOLDS };

  // Adaptive minimum: 0.3% of wafer die count, floored at 5.
  const minFailingDies = Math.max(t.minimumFailingDies, Math.round(dies.length * 0.003));
  if (failing.length < minFailingDies) return null;

  const features = computeFeatures(failing, dies, wafer, ringCount);
  const { pattern, confidence, note } = classify(features, t, dies.length);

  return { pattern, confidence, features, ...(note ? { note } : {}) };
}
