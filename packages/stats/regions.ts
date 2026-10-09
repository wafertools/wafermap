import { DIE_REGIONS, type DieRegionKey, type RegionContext } from './dieRegions.js';
import { isPositionedDie, diePassStatus, getDieKey } from '../core/dies.js';
import type { Die, PositionedDie } from '../core/dies.js';
import type { Wafer } from '../core/wafer.js';
import type { ReticleConfig } from '../renderer/buildWaferMap.js';

export interface StatsRegion {
  family: 'ring' | 'quadrant' | 'reticle-position' | 'test-site' | 'sector';
  key: string;
  label: string;
  /** `getDieKey` of each member — what findings carry, for highlighting. */
  dieKeys: string[];
  /**
   * The member dies themselves, parallel to `dieKeys`. Analysis reads these:
   * finding a region's dies again by key string cost more than a quarter of a
   * large wafer's analysis.
   */
  dies: Die[];
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
  /** Of those, the dies that pass. */
  passDies: number;
}

/**
 * Pass/fail yield per region (ring, quadrant, or any other `StatsRegion`
 * family), pooled across one or more wafers. Single source of truth for this
 * computation — consumed by both the summary panel's progress-bar rows and
 * the ring/quadrant yield diagrams, which previously each recomputed the
 * same pass/total tally independently.
 *
 * `passBins` is one set for every wafer, or a lookup by wafer index for a lot
 * whose wafers were built with different pass bins (pass each item's
 * `WaferMapResult.passBins`). Each die is judged by `diePassStatus`, the rule
 * yield itself uses.
 */
export function buildRegionYieldData(
  diesByWafer: Die[][],
  allWafers: Wafer[],
  ringCount: number,
  passBins: readonly number[] | ((waferIndex: number) => readonly number[]),
  regionBuilder: (dies: PositionedDie[], wafer: Wafer, ringCount: number) => StatsRegion[],
): RegionYieldDatum[] {
  const totals = new Map<string, { label: string; pass: number; total: number }>();
  const order: string[] = [];

  for (let wi = 0; wi < allWafers.length; wi++) {
    const wDies = diesByWafer[wi];
    if (!wDies?.length) continue;
    const passSet = new Set(typeof passBins === 'function' ? passBins(wi) : passBins);
    // Ring/quadrant (the only regionBuilders this is ever called with) are
    // spatial — unpositioned dies never enter a region.
    // isPositionedDie (not hasPosition) narrows physX/physY too, which is what
    // a regionBuilder's PositionedDie[] needs — no cast required.
    const regions = regionBuilder(wDies.filter(isPositionedDie), allWafers[wi], ringCount);
    for (const region of regions) {
      if (!order.includes(region.key)) order.push(region.key);
      const acc = totals.get(region.key) ?? { label: region.label, pass: 0, total: 0 };
      for (const d of region.dies) {
        if (d.partial || d.edgeExcluded) continue;
        const verdict = diePassStatus(d, passSet);
        if (verdict === undefined) continue;
        acc.total++;
        if (verdict) acc.pass++;
      }
      totals.set(region.key, acc);
    }
  }

  return order
    .map((key): RegionYieldDatum | null => {
      const acc = totals.get(key)!;
      if (acc.total === 0) return null;
      return { key, label: acc.label, n: acc.total, passDies: acc.pass, yieldPercent: (acc.pass / acc.total) * 100 };
    })
    .filter((d): d is RegionYieldDatum => d !== null);
}

/**
 * The dies behind one region of `buildRegionYieldData`'s output, on one wafer: the same dies its `n` counts (positioned,
 * not partial or edge-excluded, with a bin recorded), found by the same region builder. For picking out what a click on a
 * ring or quadrant of the yield diagram stands for.
 */
export function diesInRegion(
  dies: readonly Die[], wafer: Wafer, ringCount: number, key: string,
  regionBuilder: (dies: PositionedDie[], wafer: Wafer, ringCount: number) => StatsRegion[],
): Die[] {
  const region = regionBuilder(dies.filter(isPositionedDie), wafer, ringCount).find(r => r.key === key);
  return region ? region.dies.filter(d => !d.partial && !d.edgeExcluded && (d.hbin ?? d.sbin) !== undefined) : [];
}

// ── Shared ordering / adjacency utilities ──────────────────────────────────
// Single source of truth for region ordering, consumed by buildSectorRegions
// and the adjacent-finding merge pass (analyzeWaferMap.ts) — keep these here so the compass
// order is never duplicated.

// 16-point compass names, indexed by bucket going CCW from East.
const COMPASS_16 = ['E', 'ENE', 'NE', 'NNE', 'N', 'NNW', 'NW', 'WNW', 'W', 'WSW', 'SW', 'SSW', 'S', 'SSE', 'SE', 'ESE'];
const COMPASS_8  = ['E', 'NE', 'N', 'NW', 'W', 'SW', 'S', 'SE'];
const COMPASS_4  = ['E', 'N', 'W', 'S'];

/**
 * The compass bucket of a direction `dx, dy` from the wafer centre, of `count` (4, 8 or 16) buckets each
 * centred on its bearing: east spans −11.25° to 11.25° of 16. The one rule for naming a direction, read by
 * the sectors and by the edge arcs.
 */
export function compassBucket(dx: number, dy: number, count: number): number {
  const half = Math.PI / count;
  const angle = (Math.atan2(dy, dx) + 2 * Math.PI + half) % (2 * Math.PI);
  return Math.floor((angle / (2 * Math.PI)) * count) % count;
}

/** Compass bearing names for a given sector count, ordered CCW from East. */
export function sectorCompassNames(sectorCount: number): string[] {
  const safe = [4, 8, 16].includes(sectorCount) ? sectorCount : 16;
  return safe === 4 ? COMPASS_4 : safe === 8 ? COMPASS_8 : COMPASS_16;
}

/** Quadrants going round the wafer, counter-clockwise from the north-east. */
export const QUADRANT_CYCLE = ['NE', 'NW', 'SW', 'SE'] as const;

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

/** The circle is cut into this many equal bins to compare angular regions; 16 sectors of 22.5° fall on whole bins. */
const ANGLE_BINS = 1440;

/**
 * The angular extent of a sector or quadrant region as the set of bins it covers
 * (counter-clockwise from East), for asking how much two regions overlap. Both
 * are cuts of the same wafer by angle alone, so their dies overlap as their
 * angles do. `undefined` for any other region, or a name outside the compass.
 */
export function regionAngleBins(key: string, sectorCount: number): Set<number> | undefined {
  const parsed = parseRegionKey(key);
  let start: number, width: number;
  if (parsed.family === 'quadrant') {
    const i = QUADRANT_CYCLE.indexOf(parsed.quadrant as typeof QUADRANT_CYCLE[number]);
    if (i < 0) return undefined;
    start = i * ANGLE_BINS / 4; width = ANGLE_BINS / 4;
  } else if (parsed.family === 'sector') {
    const safe = [4, 8, 16].includes(sectorCount) ? sectorCount : undefined;
    const i = safe ? sectorCompassNames(safe).indexOf(parsed.sector ?? '') : -1;
    if (!safe || i < 0) return undefined;
    width = ANGLE_BINS / safe; start = i * width - width / 2;
  } else {
    return undefined;
  }
  const bins = new Set<number>();
  for (let b = 0; b < width; b++) bins.add(((start + b) % ANGLE_BINS + ANGLE_BINS) % ANGLE_BINS);
  return bins;
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
/**
 * A reticle cell's position within its field, from its region key: `reticle-position:cell:2,1` is column 2, row 1.
 * Separate from `parseRegionKey`, which leaves a reticle key `unknown` on purpose: only ring, quadrant and sector findings
 * merge, and the merge logic reads `unknown` as "leave alone".
 */
export function parseReticleCellKey(key: string): { column: number; row: number } | undefined {
  const m = /^reticle-position:cell:(-?\d+),(-?\d+)$/.exec(key);
  return m ? { column: Number(m[1]), row: Number(m[2]) } : undefined;
}

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

/** Group dies into the regions of one family, in the family's own row order — the one grouping every builder below uses. */
function groupInto(dies: PositionedDie[], region: DieRegionKey, ctx: RegionContext): StatsRegion[] {
  const grouping = DIE_REGIONS[region].grouping!;
  const regions = new Map<string, StatsRegion>();
  for (const die of dies) {
    const placed = grouping.place(die, ctx);
    if (!placed) continue;
    const existing = regions.get(placed.key) ?? { family: grouping.family, key: placed.key, label: placed.label, dieKeys: [], dies: [] };
    existing.dieKeys.push(dieKey(die));
    existing.dies.push(die);
    regions.set(placed.key, existing);
  }
  return [...regions.values()].sort((left, right) => grouping.order(left.key, right.key));
}

export function buildRingRegions(dies: PositionedDie[], wafer: Wafer, ringCount: number): StatsRegion[] {
  return groupInto(dies, 'ring', { wafer, ringCount });
}

export function buildQuadrantRegions(dies: PositionedDie[], wafer: Wafer, ringCount: number): StatsRegion[] {
  return groupInto(dies, 'quadrant', { wafer, ringCount });
}

export function buildReticlePositionRegions(
  dies: PositionedDie[],
  reticleConfig: ReticleConfig | undefined,
): StatsRegion[] {
  if (!reticleConfig) return [];
  return groupInto(dies, 'reticleCell', { ringCount: 0, reticle: reticleConfig });
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
  const siteDies = new Map<number, Die[]>();

  for (const die of dies) {
    if (die.siteNum === undefined) continue;
    const members = siteDies.get(die.siteNum) ?? [];
    members.push(die);
    siteDies.set(die.siteNum, members);
  }

  if (!forceEnable) {
    // Count how many sites meet the minimum population threshold.
    let qualifyingSites = 0;
    for (const members of siteDies.values()) {
      if (members.length >= MIN_DIES_PER_SITE) qualifyingSites++;
    }
    if (qualifyingSites < 2) return [];
  }

  return [...siteDies.entries()]
    .sort(([a], [b]) => a - b)
    .map(([siteNum, members]) => ({
      family: 'test-site' as const,
      key: `test-site:${siteNum}`,
      label: `Site ${siteNum}`,
      dieKeys: members.map(dieKey),
      dies: members,
    }));
}

export function buildSectorRegions(dies: PositionedDie[], wafer: Wafer, sectorCount: number): StatsRegion[] {
  const safe = [4, 8, 16].includes(sectorCount) ? sectorCount : 16;
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

    // Centred on its bearing: "E" spans −22.5° to 22.5° of 8, not 0° to 45°.
    const label = names[compassBucket(dx, dy, safe)];
    const key = `sector:${label}`;

    const existing = regions.get(key) ?? {
      family: 'sector' as const,
      key,
      label: `Sector ${label}`,
      dieKeys: [],
      dies: [],
    };
    existing.dieKeys.push(dieKey(die));
    existing.dies.push(die);
    regions.set(key, existing);
  }

  return [...regions.values()].sort((a, b) => a.key.localeCompare(b.key));
}
