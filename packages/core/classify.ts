import type { Wafer } from './wafer.js';
import type { PositionedDie } from './dies.js';

export type Quadrant = 'NE' | 'NW' | 'SW' | 'SE';

export interface DieClassification {
  ring: number;
  quadrant: Quadrant;
}

export interface ClassifyOptions {
  ringCount?: number;
}

/**
 * Classify a die by its radial ring (1 = innermost) and physical wafer quadrant.
 *
 * Quadrant and ring are computed from `physX/physY`, which carry `wafer.orientation`
 * (notch position) but NOT the view's interactive rotation. This is deliberate:
 * spatial findings ("NE quadrant yield is low") describe the physical wafer relative
 * to its notch, so they must follow orientation and stay invariant to how the user
 * has rotated the on-screen view. (Not "screen" coordinates — those are post-
 * interactive-transform and live only in the renderer.)
 *
 * Takes a `PositionedDie`, not `Die` — callers must filter to `hasPosition`
 * first (region builders only ever classify positioned dies; an unpositioned
 * die has no ring/quadrant by definition).
 */
export function classifyDie(die: PositionedDie, wafer: Wafer, options: ClassifyOptions = {}): DieClassification {
  const ringCount = Math.max(1, options.ringCount ?? 4);
  const dx = die.physX - wafer.center.x;
  const dy = die.physY - wafer.center.y;
  const normalized = Math.sqrt(dx * dx + dy * dy) / wafer.radius;
  const ring = Math.min(ringCount, Math.max(1, Math.floor(normalized * ringCount) + 1));

  let quadrant: Quadrant;
  if (dx >= 0 && dy >= 0) quadrant = 'NE';
  else if (dx < 0 && dy >= 0) quadrant = 'NW';
  else if (dx < 0 && dy < 0) quadrant = 'SW';
  else quadrant = 'SE';

  return { ring, quadrant };
}

/** Human-readable label for a ring index (1-based) given a total ring count. */
export function getRingLabel(ring: number, ringCount: number): string {
  if (ringCount === 1) return 'Full Wafer';
  if (ring === 1) return 'Ring 1 (core)';
  if (ring === ringCount) return `Ring ${ring} (edge)`;
  return `Ring ${ring}`;
}
