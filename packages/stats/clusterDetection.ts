import type { Die, PositionedDie } from '../core/dies.js';
import type { Wafer } from '../core/wafer.js';
import type { StatsFinding, StatsSeverity } from './types.js';
import { benjaminiHochberg, binomialUpperTail } from './math.js';
import { ringOf } from '../core/classify.js';
import { compassBucket, sectorCompassNames } from './regions.js';
import { getDieKey, gridKey } from '../core/dies.js';
import { findConnectedComponents } from './connectedComponents.js';

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
  const tested: { component: PositionedDie[]; k: number; clusterRate: number; delta: number; pValue: number }[] = [];
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
    // Exact: a cluster's counts are small, where a normal approximation overstates significance.
    const pValue = binomialUpperTail(k, n, pBg);
    tested.push({ component, k, clusterRate, delta, pValue });
  }

  // Every cluster tested on the wafer is one family for the false-discovery rate, as the regions are.
  const adjusted = benjaminiHochberg(tested.map(t => t.pValue));
  for (let i = 0; i < tested.length; i++) {
    const { component, k, clusterRate, delta, pValue } = tested[i];
    const adjustedPValue = adjusted[i];
    const relativeDelta = pBg > 0 ? delta / pBg : undefined;
    const passesEffect = delta >= minimumEffectSize ||
      (relativeDelta !== undefined && relativeDelta >= minimumRelativeEffect);
    if (adjustedPValue > significanceLevel || !passesEffect) continue;

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
        method: 'binomial',
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
