import { requireRingCount } from './ringCount.js';
import type { Wafer } from './wafer.js';
import type { PositionedDie } from './dies.js';

export type Quadrant = 'NE' | 'NW' | 'SW' | 'SE';

export interface DieClassification {
  ring: number;
  quadrant: Quadrant;
}

export interface ClassifyOptions {
  /** The map's own ring count (`WaferMapResult.ringCount`). Required: there is no default ring count to classify by. */
  ringCount: number;
}

/**
 * The ring (1 = innermost, `ringCount` = the edge) of a point `dx, dy` from the wafer centre: equal widths of
 * the radius, a point on a boundary in the outer ring. The one ring rule; the edge ring is `ringCount`.
 */
export function ringOf(dx: number, dy: number, radius: number, ringCount: number): number {
  const normalized = Math.sqrt(dx * dx + dy * dy) / radius;
  return Math.min(ringCount, Math.max(1, Math.floor(normalized * ringCount) + 1));
}

/**
 * A die's offset from the wafer centre, in the wafer's own units, from its physical position (which follows the
 * wafer's orientation, not the view's rotation). The one source of every radial and angular rule: ring, quadrant and
 * radial position all read it.
 */
export function centreOffset(die: PositionedDie, wafer: Wafer): { dx: number; dy: number } {
  return { dx: die.physX - wafer.center.x, dy: die.physY - wafer.center.y };
}

/** A die's distance from the wafer centre as a share of the wafer radius: 0 at the centre, 1 at the edge. */
export function radialPosition(die: PositionedDie, wafer: Wafer): number {
  const { dx, dy } = centreOffset(die, wafer);
  return Math.sqrt(dx * dx + dy * dy) / wafer.radius;
}

const QUADRANT_BY_QUARTER: readonly Quadrant[] = ['NE', 'NW', 'SW', 'SE'];

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
export function classifyDie(die: PositionedDie, wafer: Wafer, options: ClassifyOptions): DieClassification {
  const ringCount = Math.max(1, requireRingCount(options, 'classifyDie'));
  const { dx, dy } = centreOffset(die, wafer);
  const ring = ringOf(dx, dy, wafer.radius, ringCount);

  // A quarter turn each, counter-clockwise from east, including its starting edge and not its end, as the
  // sectors are bucketed: NE holds the positive x axis, NW the positive y axis, SW the negative x axis and
  // SE the negative y axis. Every quadrant then holds the same share of a symmetric grid (the centre die,
  // at angle 0, is NE) and a half turn maps each quadrant onto its opposite.
  const angle = (Math.atan2(dy, dx) + 2 * Math.PI) % (2 * Math.PI);
  const quadrant: Quadrant = QUADRANT_BY_QUARTER[Math.min(3, Math.floor(angle / (Math.PI / 2)))];

  return { ring, quadrant };
}

/** Human-readable label for a ring index (1-based) given a total ring count. */
export function getRingLabel(ring: number, ringCount: number): string {
  if (ringCount === 1) return 'Full Wafer';
  if (ring === 1) return 'Ring 1 (core)';
  if (ring === ringCount) return `Ring ${ring} (edge)`;
  return `Ring ${ring}`;
}
