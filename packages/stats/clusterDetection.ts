import type { Die, Wafer } from '../core/index.js';
import type { StatsFinding, StatsSeverity } from './types.js';

// 16-point compass for edge-arc bearing labels.
const COMPASS_16 = ['E', 'ENE', 'NE', 'NNE', 'N', 'NNW', 'NW', 'WNW', 'W', 'WSW', 'SW', 'SSW', 'S', 'SSE', 'SE', 'ESE'];

function compassBearing(dx: number, dy: number): string {
  const angle = (Math.atan2(dy, dx) + 2 * Math.PI) % (2 * Math.PI);
  return COMPASS_16[Math.round((angle / (2 * Math.PI)) * 16) % 16];
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

// Normal CDF approximation (same as analyzeWaferMap).
function normalCdf(value: number): number {
  const x = Math.abs(value);
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741, a4 = -1.453152027, a5 = 1.061405429;
  const p = 0.3275911;
  const t = 1 / (1 + p * x);
  const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
  return 0.5 * (1 + (value < 0 ? -y : y));
}

// One-sided binomial p-value P(X >= k | n, p) using normal approximation.
function binomialPValue(k: number, n: number, p: number): number {
  if (n === 0 || p <= 0) return k > 0 ? 0 : 1;
  if (p >= 1) return k <= n ? 0 : 1;
  const mean = n * p;
  const sd = Math.sqrt(n * p * (1 - p));
  if (sd === 0) return k > mean ? 0 : 1;
  // Continuity correction: P(X >= k) ~ P(Z >= (k - 0.5 - mean) / sd)
  const z = (k - 0.5 - mean) / sd;
  return 1 - normalCdf(z);
}

interface ClusterOptions {
  passBins: number[];
  significanceLevel: number;
  minimumEffectSize: number;
  minimumRelativeEffect: number;
  minimumSampleSize: number;
  minimumClusterSize: number;
  ringCount: number;
  includePartial: boolean;
  includeEdgeExcluded: boolean;
  /** Optional override for the failure predicate. Default: hbin not in passBins. */
  isFailingDie?: (die: Die) => boolean;
}

export function buildClusterFindings(
  dies: Die[],
  wafer: Wafer,
  options: ClusterOptions,
): StatsFinding[] {
  const { passBins, significanceLevel, minimumEffectSize, minimumRelativeEffect, minimumSampleSize, minimumClusterSize, ringCount } = options;
  const passSet = new Set(passBins);

  // Caller passes pre-filtered eligible dies; enforce minimum sample size.
  if (dies.length < minimumSampleSize) return [];

  const defaultIsFailingDie = (d: Die) => d.hbin === undefined || !passSet.has(d.hbin);
  const isFailingFn = options.isFailingDie ?? defaultIsFailingDie;
  const failing = dies.filter(isFailingFn);
  const pBg = failing.length / dies.length;

  // Derive pitch from die dimensions (adapts to any die size).
  const firstDie = dies[0];
  const pitchX = firstDie ? firstDie.width  : 10;
  const pitchY = firstDie ? firstDie.height : 10;

  // Connectivity threshold: dies are adjacent if within 1.1× a single grid step
  // in either direction. Tight enough to separate isolated clusters from
  // diffuse background failures even at high wafer-wide failure rates.
  const connectX = pitchX * 1.1;
  const connectY = pitchY * 1.1;

  // Neighbourhood radius for the statistical test: larger — captures all eligible
  // dies that could plausibly be associated with the cluster.
  const neighbourRadius = Math.max(pitchX, pitchY) * 1.5;

  // Flood-fill connected components of failing dies using tight connectivity.
  const visited = new Set<string>();
  const components: Die[][] = [];

  for (const seed of failing) {
    const seedKey = `${seed.x},${seed.y}`;
    if (visited.has(seedKey)) continue;

    const component: Die[] = [];
    const queue: Die[] = [seed];
    visited.add(seedKey);

    while (queue.length > 0) {
      const current = queue.pop()!;
      component.push(current);
      for (const candidate of failing) {
        const ck = `${candidate.x},${candidate.y}`;
        if (visited.has(ck)) continue;
        // 8-connected adjacency: within one grid step in X and Y independently
        if (Math.abs(candidate.physX - current.physX) <= connectX &&
            Math.abs(candidate.physY - current.physY) <= connectY) {
          visited.add(ck);
          queue.push(candidate);
        }
      }
    }

    components.push(component);
  }

  const findings: StatsFinding[] = [];
  const cx = wafer.center.x;
  const cy = wafer.center.y;
  const r  = wafer.radius;

  for (const component of components) {
    if (component.length < minimumClusterSize) continue;

    // Neighbourhood: all eligible dies within neighbourRadius of any cluster member.
    const clusterKeySet = new Set(component.map(d => `${d.x},${d.y}`));
    const neighbourhood = dies.filter(d => {
      if (clusterKeySet.has(`${d.x},${d.y}`)) return true;
      return component.some(m => Math.hypot(d.physX - m.physX, d.physY - m.physY) <= neighbourRadius);
    });

    const k = component.length;
    const n = neighbourhood.length;
    if (n < minimumSampleSize) continue;

    const clusterRate = k / n;
    const delta = clusterRate - pBg;
    const pValue = binomialPValue(k, n, pBg);

    const relativeDelta = pBg > 0 ? delta / pBg : undefined;
    const passesEffect = delta >= minimumEffectSize ||
      (relativeDelta !== undefined && relativeDelta >= minimumRelativeEffect);
    if (pValue > significanceLevel || !passesEffect) continue;

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
    const angles = component.map(d => (Math.atan2(d.physY - cy, d.physX - cx) + 2 * Math.PI) % (2 * Math.PI));
    let minA = angles[0], maxA = angles[0];
    for (const a of angles) { minA = Math.min(minA, a); maxA = Math.max(maxA, a); }
    const spanDeg = ((maxA - minA) * 180) / Math.PI;

    // Classify as edge-arc if the majority of the cluster dies are in the outer
    // ring and the angular span is narrow. Using a majority vote rather than
    // centroid radius makes the test robust when a few background dies chain
    // the arc cluster inward, pulling the centroid below the ring boundary.
    const edgeThreshold = 1 - 1 / ringCount;
    const outerCount = component.filter(
      d => Math.hypot(d.physX - cx, d.physY - cy) / r > edgeThreshold,
    ).length;
    const isEdgeArc = outerCount > k / 2 && spanDeg < 120;

    const family = isEdgeArc ? 'edge-arc' as const : 'cluster' as const;
    const bearing = compassBearing(centPhysX - cx, centPhysY - cy);
    const leftLabel = isEdgeArc
      ? `Edge arc ~${bearing}`
      : `Cluster at (${closestDie.x}, ${closestDie.y})`;

    const clusterFraction = k / dies.length;
    const severity = severityForCluster(pValue, delta, clusterFraction, relativeDelta);
    const dieKeys = [...clusterKeySet];

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
        adjustedPValue: pValue,
        sampleSizeLeft: k,
        sampleSizeRight: dies.length - k,
      },
      summary: isEdgeArc
        ? `Edge arc near ${bearing}: ${k} contiguous failing dies (${(clusterRate * 100).toFixed(0)}% vs ${(pBg * 100).toFixed(0)}% background)`
        : `Failure cluster at (${closestDie.x}, ${closestDie.y}): ${k} contiguous failing dies (${(clusterRate * 100).toFixed(0)}% vs ${(pBg * 100).toFixed(0)}% background)`,
      highlight: { kind: 'dies', dieKeys },
    });
  }

  // Sort by severity then effect size.
  return findings.sort((a, b) => {
    const pA = a.stats.pValue ?? 1, pB = b.stats.pValue ?? 1;
    if (pA !== pB) return pA - pB;
    return Math.abs(b.effect.effectSize ?? 0) - Math.abs(a.effect.effectSize ?? 0);
  });
}
