import { classifyDie, getRingLabel, type Die, type Wafer } from '../core/index.js';
import type { ReticleConfig } from '../renderer/buildWaferMap.js';

export interface StatsRegion {
  family: 'ring' | 'quadrant' | 'reticle-position';
  key: string;
  label: string;
  dieKeys: string[];
}

function dieKey(die: Die): string {
  return `${die.i},${die.j}`;
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

  const order = ['quadrant:NE', 'quadrant:NW', 'quadrant:SE', 'quadrant:SW'];
  return [...regions.values()].sort((left, right) => order.indexOf(left.key) - order.indexOf(right.key));
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
    const column = normalizePhase(die.i + phaseX, safeWidth);
    const row = normalizePhase(die.j + phaseY, safeHeight);
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
