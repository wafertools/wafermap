import type { Die, PositionedDie } from '../core/dies.js';
import type { Wafer } from '../core/wafer.js';
import type { StatsFinding, StatsSeverity } from './types.js';
import { seededRandom } from './math.js';
import { ringOf } from '../core/classify.js';
import { compassBucket, sectorCompassNames } from './regions.js';
import { getDieKey, gridKey } from '../core/dies.js';
import { findConnectedComponents, LargestComponentSizer } from './connectedComponents.js';

/** An edge arc's bearing, on the 16-point compass the sectors use. */
function compassBearing(dx: number, dy: number): string {
  return sectorCompassNames(16)[compassBucket(dx, dy, 16)];
}

/**
 * The angle (radians) a set of directions covers round the circle: the full turn less the widest gap between
 * neighbours. Not max − min of angles in [0, 2π), which reads an arc across due east (from 355° to 5°) as a
 * near-full circle.
 */
function circularSpan(angles: number[]): number {
  if (angles.length < 2) return 0;
  const sorted = [...angles].sort((a, b) => a - b);
  let widestGap = sorted[0] + 2 * Math.PI - sorted[sorted.length - 1];
  for (let i = 1; i < sorted.length; i++) widestGap = Math.max(widestGap, sorted[i] - sorted[i - 1]);
  return 2 * Math.PI - widestGap;
}

function severityForCluster(
  pValue: number,
  delta: number,
  clusterFraction: number,
  relativeDelta?: number,
): StatsSeverity {
  const absRel = relativeDelta !== undefined ? Math.abs(relativeDelta) : 0;
  // Size criterion: large clusters are intrinsically unusual/notable regardless
  // of rate contrast. A 700-die donut cluster covering 37% of the wafer is
  // striking even when the background failure rate is already elevated.
  if (pValue <= 0.01 && (delta >= 0.25 || absRel >= 2.0 || clusterFraction >= 0.10)) return 'unusual';
  if (pValue <= 0.05 && (delta >= 0.15 || absRel >= 1.0 || clusterFraction >= 0.03)) return 'notable';
  return 'info';
}

/** Shuffles of the fail labels in a cluster's null distribution, and the exceedances that end it early. */
const PERMUTATIONS = 99;
const EXCEEDANCES_TO_STOP = 10;

/**
 * The null distribution of the largest failing group: the largest group on each of a series of shuffles
 * that scatter `failCount` fails over a die layout. A series is a fixed, seeded stream, extended only as
 * far as a p-value needs it, so the same layout and fail count always give the same p-values.
 */
class LargestGroupNull {
  readonly maxima: number[] = [];
  private readonly random: () => number;
  private readonly order: Int32Array;
  private readonly failing: Uint8Array;

  constructor(private readonly sizer: LargestComponentSizer, n: number, private readonly failCount: number, seed: number) {
    this.random = seededRandom(seed);
    this.order = new Int32Array(n);
    for (let i = 0; i < n; i++) this.order[i] = i;
    this.failing = new Uint8Array(n);
  }

  /** The largest group of shuffle `i`, drawing the shuffles up to it if they are not drawn yet. */
  at(i: number): number {
    const { order, failing, failCount, random } = this;
    const n = order.length;
    while (this.maxima.length <= i) {
      // A partial Fisher–Yates shuffle draws which dies fail.
      for (let d = 0; d < failCount; d++) {
        const j = d + Math.floor(random() * (n - d));
        const t = order[d]; order[d] = order[j]; order[j] = t;
        failing[order[d]] = 1;
      }
      this.maxima.push(this.sizer.largest(failing));
      for (let d = 0; d < failCount; d++) failing[order[d]] = 0;
    }
    return this.maxima[i];
  }

  /**
   * How often random placement makes a group of at least `size` (Besag and Clifford, 1991): the count stops
   * at {@link EXCEEDANCES_TO_STOP}, with p = exceedances / shuffles so far, so a group no larger than random
   * placement makes is settled in a few dozen shuffles; otherwise all {@link PERMUTATIONS} are drawn and
   * p = (1 + exceedances) / (1 + shuffles).
   */
  pValue(size: number): number {
    let exceed = 0;
    for (let i = 0; i < PERMUTATIONS; i++) {
      if (this.at(i) >= size && ++exceed === EXCEEDANCES_TO_STOP) return EXCEEDANCES_TO_STOP / (i + 1);
    }
    return (1 + exceed) / (1 + PERMUTATIONS);
  }
}

/**
 * A die layout's identity, independent of the order its dies arrive in: two 32-bit sums of a hash of
 * each die's grid position, with the count. Wafers of one lot share it.
 */
function layoutKey(dies: readonly PositionedDie[]): string {
  let a = 0, b = 0;
  for (let i = 0; i < dies.length; i++) {
    let h = Math.imul(dies[i].x | 0, 0x9e3779b1) ^ Math.imul(dies[i].y | 0, 0x85ebca6b);
    h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
    h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
    a = (a + (h ^ (h >>> 16))) | 0;
    b = (b + Math.imul(h, 0x27d4eb2f) + 0x165667b1) | 0;
  }
  return `${dies.length}:${a >>> 0}:${b >>> 0}`;
}

/**
 * Fail counts are taken up to the top of a band 5% wide, so the wafers of a lot share a few null
 * distributions instead of drawing one each. Rounding up only makes the test stricter: more fails
 * scattered make larger groups by chance.
 */
function failBand(failCount: number, n: number): number {
  if (failCount <= 20) return failCount;
  return Math.min(n, Math.ceil(20 * 1.05 ** Math.ceil(Math.log(failCount / 20) / Math.log(1.05))));
}

/** Recently used layouts and null distributions, so a lot's wafers draw each once. Bounded: oldest out. */
const SIZERS = new Map<string, LargestComponentSizer>();
const NULLS = new Map<string, LargestGroupNull>();
function remember<T>(cache: Map<string, T>, key: string, limit: number, make: () => T): T {
  let v = cache.get(key);
  if (v === undefined) {
    v = make();
    cache.set(key, v);
    if (cache.size > limit) cache.delete(cache.keys().next().value!);
  }
  return v;
}

/**
 * Permutation p-values for failing groups of the given sizes: how often the LARGEST group on the wafer is at
 * least that size when the same number of fails is scattered at random over the same dies.
 *
 * A group is found because its dies fail, so testing its fail rate against the wafer's counts that selection
 * as evidence: random failures at a few percent always form some group that a rate test calls significant.
 * The largest group under random placement is the null that selection implies. Comparing every group with
 * the largest also makes the wafer's groups one family (family-wise), so no further correction applies.
 */
function clusterPermutationPValues(dies: readonly PositionedDie[], failCount: number, sizes: readonly number[]): number[] {
  const n = dies.length;
  const layout = layoutKey(dies);
  const fails = failBand(failCount, n);
  const nul = remember(NULLS, `${layout}:${fails}`, 16, () => {
    // In grid order, so the order the dies arrive in does not change which dies a draw picks.
    const sizer = remember(SIZERS, layout, 4, () => new LargestComponentSizer([...dies].sort((a, b) => a.y - b.y || a.x - b.x)));
    const [, a, b] = layout.split(':').map(Number);
    return new LargestGroupNull(sizer, n, fails, (a ^ Math.imul(b, 0x2c1b3c6d) ^ Math.imul(fails + 1, 0x85ebca6b)) >>> 0);
  });
  return sizes.map(size => nul.pValue(size));
}

interface ClusterOptions {
  passBins: number[];
  significanceLevel: number;
  minimumEffectSize: number;
  minimumRelativeEffect: number;
  minimumSampleSize: number;
  minimumClusterSize: number;
  ringCount: number;
  /** Optional override for the failure predicate. Default: hard bin, then soft bin, not in passBins. */
  isFailingDie?: (die: Die) => boolean;
}

export function buildClusterFindings(
  dies: PositionedDie[],
  wafer: Wafer,
  options: ClusterOptions,
): StatsFinding[] {
  const { passBins, significanceLevel, minimumEffectSize, minimumRelativeEffect, minimumSampleSize, minimumClusterSize, ringCount } = options;
  const passSet = new Set(passBins);

  // Caller passes pre-filtered eligible dies; enforce minimum sample size.
  if (dies.length < minimumSampleSize) return [];

  const defaultIsFailingDie = (d: Die) => {
    const bin = d.hbin ?? d.sbin;
    return bin === undefined || !passSet.has(bin);
  };
  const isFailingFn = options.isFailingDie ?? defaultIsFailingDie;
  const failing = dies.filter(isFailingFn);
  const pBg = failing.length / dies.length;

  // Derive pitch from die dimensions (adapts to any die size).
  const firstDie = dies[0];
  const pitchX = firstDie ? firstDie.width  : 10;
  const pitchY = firstDie ? firstDie.height : 10;

  // Neighbourhood radius for the statistical test: larger — captures all eligible
  // dies that could plausibly be associated with the cluster.
  const neighbourRadius = Math.max(pitchX, pitchY) * 1.5;

  // Grid index for O(1) neighbour lookups by integer grid coordinate.
  // Adjacency uses the die's integer x,y grid position (8-connected: |dx|<=1, |dy|<=1).
  const allByKey = new Map<number, PositionedDie>();
  for (const d of dies) allByKey.set(gridKey(d.x, d.y), d);

  // Neighbourhood radius in grid steps (ceil to cover the physical radius).
  const neighStepsX = Math.ceil(neighbourRadius / pitchX);
  const neighStepsY = Math.ceil(neighbourRadius / pitchY);

  // Shared with `patternClassification.ts` — both ask "which failing dies form
  // a contiguous group", and two answers to one question can drift apart.
  const components = findConnectedComponents(failing);

  const findings: StatsFinding[] = [];
  const tested: { component: PositionedDie[]; k: number; clusterRate: number; delta: number; relativeDelta: number | undefined }[] = [];
  const cx = wafer.center.x;
  const cy = wafer.center.y;
  const r  = wafer.radius;

  for (const component of components) {
    if (component.length < minimumClusterSize) continue;

    // Neighbourhood: all eligible dies within neighbourRadius of any cluster member.
    // Use grid-step window around each cluster member for O(component × window) lookup.
    const neighbourKeySet = new Set<number>(component.map(d => gridKey(d.x, d.y)));
    for (const m of component) {
      for (let dy = -neighStepsY; dy <= neighStepsY; dy++) {
        for (let dx = -neighStepsX; dx <= neighStepsX; dx++) {
          const ck = gridKey(m.x + dx, m.y + dy);
          if (neighbourKeySet.has(ck)) continue;
          const candidate = allByKey.get(ck);
          if (!candidate) continue;
          // Exact physical distance check within the grid window.
          if (Math.hypot(candidate.physX - m.physX, candidate.physY - m.physY) <= neighbourRadius) {
            neighbourKeySet.add(ck);
          }
        }
      }
    }
    const neighbourhood = [...neighbourKeySet].map(k => allByKey.get(k)!).filter(Boolean);

    const k = component.length;
    const n = neighbourhood.length;
    if (n < minimumSampleSize) continue;

    const clusterRate = k / n;
    const delta = clusterRate - pBg;
    const relativeDelta = pBg > 0 ? delta / pBg : undefined;
    const passesEffect = delta >= minimumEffectSize ||
      (relativeDelta !== undefined && relativeDelta >= minimumRelativeEffect);
    // The effect gate first: only a group that could be reported costs a permutation test.
    if (passesEffect) tested.push({ component, k, clusterRate, delta, relativeDelta });
  }
  if (!tested.length) return [];

  // The largest group is the statistic, so its p-value is already family-wise over the wafer's groups:
  // it is both the p-value and the adjusted one.
  const pValues = clusterPermutationPValues(dies, failing.length, tested.map(t => t.k));
  for (let i = 0; i < tested.length; i++) {
    const { component, k, clusterRate, delta, relativeDelta } = tested[i];
    const pValue = pValues[i];
    const adjustedPValue = pValue;
    if (adjustedPValue > significanceLevel) continue;

    // Centroid in physical coords.
    const centPhysX = component.reduce((s, d) => s + d.physX, 0) / k;
    const centPhysY = component.reduce((s, d) => s + d.physY, 0) / k;

    // Find the die closest to the centroid for grid-coord label.
    let closestDie = component[0];
    let closestDist = Infinity;
    for (const d of component) {
      const dist = Math.hypot(d.physX - centPhysX, d.physY - centPhysY);
      if (dist < closestDist) { closestDist = dist; closestDie = d; }
    }

    // Angular span of cluster members relative to wafer centre.
    const spanDeg = (circularSpan(component.map(d => Math.atan2(d.physY - cy, d.physX - cx))) * 180) / Math.PI;

    // Classify as edge-arc if the majority of the cluster dies are in the outer
    // ring and the angular span is narrow. Using a majority vote rather than
    // centroid radius makes the test robust when a few background dies chain
    // the arc cluster inward, pulling the centroid below the ring boundary.
    const outerCount = component.filter(d => ringOf(d.physX - cx, d.physY - cy, r, ringCount) === ringCount).length;
    const isEdgeArc = outerCount > k / 2 && spanDeg < 120;

    const family = isEdgeArc ? 'edge-arc' as const : 'cluster' as const;
    const bearing = compassBearing(centPhysX - cx, centPhysY - cy);
    const leftLabel = isEdgeArc
      ? `Edge arc ~${bearing}`
      : `Cluster at (${closestDie.x}, ${closestDie.y})`;

    const clusterFraction = k / dies.length;
    const severity = severityForCluster(adjustedPValue, delta, clusterFraction, relativeDelta);
    const dieKeys = component.map(d => getDieKey(d));

    findings.push({
      id: `${family}:${closestDie.x},${closestDie.y}`,
      level: 'wafer',
      severity,
      variable: { kind: 'yield', label: 'Yield' },
      comparison: { family, left: leftLabel, right: 'Rest of wafer' },
      effect: {
        direction: 'lower',
        absoluteDelta: -delta,
        relativeDelta: relativeDelta !== undefined ? -relativeDelta : undefined,
        effectSize: delta,
      },
      stats: {
        method: 'permutation',
        pValue,
        adjustedPValue,
        sampleSizeLeft: k,
        sampleSizeRight: dies.length - k,
      },
      summary: isEdgeArc
        ? `Edge arc near ${bearing}: ${k} contiguous failing dies (${(clusterRate * 100).toFixed(0)}% vs ${(pBg * 100).toFixed(0)}% background)`
        : `Failure cluster at (${closestDie.x}, ${closestDie.y}): ${k} contiguous failing dies (${(clusterRate * 100).toFixed(0)}% vs ${(pBg * 100).toFixed(0)}% background)`,
      highlight: { kind: 'dies', dieKeys },
    });
  }

  // Strongest first: smallest p, then largest effect.
  return findings.sort((a, b) => {
    const pA = a.stats.pValue ?? 1, pB = b.stats.pValue ?? 1;
    if (pA !== pB) return pA - pB;
    return Math.abs(b.effect.effectSize ?? 0) - Math.abs(a.effect.effectSize ?? 0);
  });
}
