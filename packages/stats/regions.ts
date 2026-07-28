import { classifyDie, getReticleCell, getRingLabel, type Die, type Wafer, getDieKey} from '../core/index.js';
import type { ReticleConfig } from '../renderer/buildWaferMap.js';

export interface StatsRegion {
  family: 'ring' | 'quadrant' | 'reticle-position' | 'test-site' | 'sector';
  key: string;
  label: string;
  dieKeys: string[];
}

function dieKey(die: Die): string {
  return getDieKey(die);
}

export interface RegionYieldDatum {
  /** Region identity, e.g. `ring:2` or `quadrant:NE` — parse with `parseRegionKey`. */
  key: string;
  label: string;
  /** `(pass / n) × 100`, in [0, 100]. Only present for regions with n > 0 (see filter below). */
  yieldPercent: number;
  /** Yield-eligible, binned die count in this region. */
  n: number;
}

/**
 * Pass/fail yield per region (ring, quadrant, or any other `StatsRegion`
 * family), pooled across one or more wafers. Single source of truth for this
 * computation — consumed by both the summary panel's progress-bar rows and
 * the ring/quadrant yield diagrams, which previously each recomputed the
 * same pass/total tally independently.
 */
export function buildRegionYieldData(
  diesByWafer: Die[][],
  allWafers: Wafer[],
  ringCount: number,
  passBins: number[],
  regionBuilder: (dies: Die[], wafer: Wafer, ringCount: number) => StatsRegion[],
): RegionYieldDatum[] {
  const passSet = new Set(passBins);
  const totals = new Map<string, { label: string; pass: number; total: number }>();
  const order: string[] = [];

  for (let wi = 0; wi < allWafers.length; wi++) {
    const wDies = diesByWafer[wi];
    if (!wDies?.length) continue;
    const regions = regionBuilder(wDies, allWafers[wi], ringCount);
    const dieByKey = new Map(wDies.map(d => [dieKey(d), d]));
    for (const region of regions) {
      if (!order.includes(region.key)) order.push(region.key);
      const acc = totals.get(region.key) ?? { label: region.label, pass: 0, total: 0 };
      for (const key of region.dieKeys) {
        const d = dieByKey.get(key);
        if (!d || d.partial || d.edgeExcluded) continue;
        const b = d.hbin ?? d.sbin;
        if (b == null) continue;
        acc.total++;
        if (passSet.has(b)) acc.pass++;
      }
      totals.set(region.key, acc);
    }
  }

  return order
    .map((key): RegionYieldDatum | null => {
      const acc = totals.get(key)!;
      if (acc.total === 0) return null;
      return { key, label: acc.label, n: acc.total, yieldPercent: (acc.pass / acc.total) * 100 };
    })
    .filter((d): d is RegionYieldDatum => d !== null);
}

// ── Shared ordering / adjacency utilities ──────────────────────────────────
// Single source of truth for region ordering, consumed by buildSectorRegions,
// the adjacent-finding merge pass (analyzeWaferMap.ts), and the narrative builder
// (findingsNarrative.ts) — keep these here so the compass order is never duplicated.

// 16-point compass names, indexed by bucket going CCW from East.
const COMPASS_16 = ['E', 'ENE', 'NE', 'NNE', 'N', 'NNW', 'NW', 'WNW', 'W', 'WSW', 'SW', 'SSW', 'S', 'SSE', 'SE', 'ESE'];
const COMPASS_8  = ['E', 'NE', 'N', 'NW', 'W', 'SW', 'S', 'SE'];
const COMPASS_4  = ['E', 'N', 'W', 'S'];

/** Compass bearing names for a given sector count, ordered CCW from East. */
export function sectorCompassNames(sectorCount: number): string[] {
  const safe = [4, 8, 16, 32].includes(sectorCount) ? sectorCount : 16;
  return safe === 4 ? COMPASS_4 : safe === 8 ? COMPASS_8 : COMPASS_16;
}

/** Adjacency on the 2×2 quadrant grid — edge-sharing only, no diagonals. */
const QUADRANT_ADJACENCY: Record<string, string[]> = {
  NE: ['NW', 'SE'],
  NW: ['NE', 'SW'],
  SE: ['NE', 'SW'],
  SW: ['NW', 'SE'],
};

/** True when two quadrants share an edge (NE–NW, NE–SE, NW–SW, SE–SW); diagonals are not adjacent. */
export function areQuadrantsAdjacent(a: string, b: string): boolean {
  return QUADRANT_ADJACENCY[a]?.includes(b) ?? false;
}

export interface ParsedRegionKey {
  family: StatsRegion['family'] | 'unknown';
  ring?: number;
  quadrant?: string;
  sector?: string;
}

/**
 * Parse a region key (e.g. `ring:2`, `quadrant:NE`, `sector:NNE`) into its
 * structured parts. Always parse identity from the key, never from the label.
 */
export function parseRegionKey(key: string): ParsedRegionKey {
  if (key.startsWith('ring:')) {
    return { family: 'ring', ring: Number(key.slice('ring:'.length)) };
  }
  if (key.startsWith('quadrant:')) {
    return { family: 'quadrant', quadrant: key.slice('quadrant:'.length) };
  }
  if (key.startsWith('sector:')) {
    return { family: 'sector', sector: key.slice('sector:'.length) };
  }
  return { family: 'unknown' };
}

export function buildRingRegions(dies: Die[], wafer: Wafer, ringCount: number): StatsRegion[] {
  const regions = new Map<string, StatsRegion>();

  for (const die of dies) {
    const { ring } = classifyDie(die, wafer, { ringCount });
    const key = `ring:${ring}`;
    const existing = regions.get(key) ?? {
      family: 'ring' as const,
      key,
      label: getRingLabel(ring, ringCount),
      dieKeys: [],
    };
    existing.dieKeys.push(dieKey(die));
    regions.set(key, existing);
  }

  return [...regions.values()].sort((left, right) => left.key.localeCompare(right.key));
}

export function buildQuadrantRegions(dies: Die[], wafer: Wafer, ringCount: number): StatsRegion[] {
  const regions = new Map<string, StatsRegion>();

  for (const die of dies) {
    const { quadrant } = classifyDie(die, wafer, { ringCount });
    const key = `quadrant:${quadrant}`;
    const existing = regions.get(key) ?? {
      family: 'quadrant' as const,
      key,
      label: quadrant,
      dieKeys: [],
    };
    existing.dieKeys.push(dieKey(die));
    regions.set(key, existing);
  }

  const rank = new Map([['quadrant:NE', 0], ['quadrant:NW', 1], ['quadrant:SE', 2], ['quadrant:SW', 3]]);
  return [...regions.values()].sort((left, right) => (rank.get(left.key) ?? 4) - (rank.get(right.key) ?? 4));
}

export function buildReticlePositionRegions(
  dies: Die[],
  reticleConfig: ReticleConfig | undefined,
): StatsRegion[] {
  if (!reticleConfig) return [];

  const regions = new Map<string, StatsRegion>();

  for (const die of dies) {
    const { column, row } = getReticleCell(die, reticleConfig);
    const key = `reticle-position:cell:${column},${row}`;
    const existing = regions.get(key) ?? {
      family: 'reticle-position' as const,
      key,
      label: `Reticle cell (${column}, ${row})`,
      dieKeys: [],
    };
    existing.dieKeys.push(dieKey(die));
    regions.set(key, existing);
  }

  return [...regions.values()].sort((left, right) => left.key.localeCompare(right.key));
}

// Minimum dies-per-site to consider a site meaningfully populated.
const MIN_DIES_PER_SITE = 3;

/**
 * Group dies by siteNum for parallel test site analysis.
 *
 * Returns an empty array (suppressing analysis) unless at least 2 distinct
 * siteNum values each appear on MIN_DIES_PER_SITE or more dies — this prevents
 * spurious regions when siteNum is used as a monotonically-increasing counter
 * rather than a true parallel-site identifier.
 *
 * Pass `forceEnable: true` to bypass the guard (e.g. when the caller has already
 * validated the data).
 */
export function buildTestSiteRegions(dies: Die[], forceEnable = false): StatsRegion[] {
  const siteCounts = new Map<number, string[]>();

  for (const die of dies) {
    if (die.siteNum === undefined) continue;
    const keys = siteCounts.get(die.siteNum) ?? [];
    keys.push(dieKey(die));
    siteCounts.set(die.siteNum, keys);
  }

  if (!forceEnable) {
    // Count how many sites meet the minimum population threshold.
    let qualifyingSites = 0;
    for (const keys of siteCounts.values()) {
      if (keys.length >= MIN_DIES_PER_SITE) qualifyingSites++;
    }
    if (qualifyingSites < 2) return [];
  }

  return [...siteCounts.entries()]
    .sort(([a], [b]) => a - b)
    .map(([siteNum, keys]) => ({
      family: 'test-site' as const,
      key: `test-site:${siteNum}`,
      label: `Site ${siteNum}`,
      dieKeys: keys,
    }));
}

export function buildSectorRegions(dies: Die[], wafer: Wafer, sectorCount: number): StatsRegion[] {
  const safe = [4, 8, 16, 32].includes(sectorCount) ? sectorCount : 16;
  const names = sectorCompassNames(safe);
  const regions = new Map<string, StatsRegion>();
  const cx = wafer.center.x;
  const cy = wafer.center.y;
  const r  = wafer.radius;

  for (const die of dies) {
    const dx = die.physX - cx;
    const dy = die.physY - cy;
    const normRadius = Math.hypot(dx, dy) / r;
    if (normRadius < 0.2) continue;   // too close to centre for a directional signal

    // atan2 in [-π, π]; convert to [0, 2π) going CCW from East.
    // Offset by half a bucket so each label is centred on its compass bearing
    // rather than starting there (without offset, "E" spans 0°–45° so it reads
    // as ~2 o'clock; with the offset it spans −22.5°–22.5° around true East).
    const halfBucket = Math.PI / safe;
    const angle = (Math.atan2(dy, dx) + 2 * Math.PI + halfBucket) % (2 * Math.PI);
    const bucketIndex = Math.floor((angle / (2 * Math.PI)) * safe) % safe;
    const label = names[bucketIndex];
    const key = `sector:${label}`;

    const existing = regions.get(key) ?? {
      family: 'sector' as const,
      key,
      label: `Sector ${label}`,
      dieKeys: [],
    };
    existing.dieKeys.push(dieKey(die));
    regions.set(key, existing);
  }

  return [...regions.values()].sort((a, b) => a.key.localeCompare(b.key));
}
