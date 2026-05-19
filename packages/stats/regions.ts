import { classifyDie, getRingLabel, type Die, type Wafer } from '../core/index.js';
import type { ReticleConfig } from '../renderer/buildWaferMap.js';

export interface StatsRegion {
  family: 'ring' | 'quadrant' | 'reticle-position' | 'sector';
  key: string;
  label: string;
  dieKeys: string[];
}

function dieKey(die: Die): string {
  return `${die.x},${die.y}`;
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

function normalizePhase(anchor: number, span: number): number {
  return ((anchor % span) + span) % span;
}

export function buildReticlePositionRegions(
  dies: Die[],
  reticleConfig: ReticleConfig | undefined,
): StatsRegion[] {
  if (!reticleConfig) return [];

  const { width, height, anchorDie = { x: 0, y: 0 } } = reticleConfig;
  const safeWidth = Math.max(1, Math.floor(width));
  const safeHeight = Math.max(1, Math.floor(height));
  const phaseX = normalizePhase(anchorDie.x, safeWidth);
  const phaseY = normalizePhase(anchorDie.y, safeHeight);
  const regions = new Map<string, StatsRegion>();

  for (const die of dies) {
    const column = normalizePhase(die.x + phaseX, safeWidth);
    const row = normalizePhase(die.y + phaseY, safeHeight);
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

export function buildSectorRegions(dies: Die[], wafer: Wafer, sectorCount: number): StatsRegion[] {
  // 16-point compass names, indexed by bucket going CCW from East.
  const COMPASS_16 = ['E', 'ENE', 'NE', 'NNE', 'N', 'NNW', 'NW', 'WNW', 'W', 'WSW', 'SW', 'SSW', 'S', 'SSE', 'SE', 'ESE'];
  const COMPASS_8  = ['E', 'NE', 'N', 'NW', 'W', 'SW', 'S', 'SE'];
  const COMPASS_4  = ['E', 'N', 'W', 'S'];
  const safe = [4, 8, 16, 32].includes(sectorCount) ? sectorCount : 16;
  const names = safe === 4 ? COMPASS_4 : safe === 8 ? COMPASS_8 : COMPASS_16;
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
