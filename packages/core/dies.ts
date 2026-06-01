import type { Wafer } from './wafer.js';
import type { DieMetadata } from './metadata.js';

export interface DieSpec {
  width: number;   // mm
  height: number;  // mm
  gridSize?: number;
  offset?: { x: number; y: number };
}

export interface Die {
  id: string;
  x: number;
  y: number;
  physX: number;       // physical position in mm (or normalized units)
  physY: number;
  width: number;       // die size in mm — set by generateDies
  height: number;
  /**
   * Test values keyed by test number (a stable per-test identity, e.g. STDF TEST_NUM).
   * Preferred over the deprecated `values` array.
   * Example: `{ 1050: 1.42e-3, 1060: 0.487, 1070: 8.3e-12 }`
   */
  testValues?: Record<number, number>;
  /** @deprecated Use `testValues` instead. Positional array — fragile when tests are added or removed. */
  values?: number[];
  hbin?: number;       // hard bin (physical sort result)
  sbin?: number;       // soft bin (test-program failure category)
  metadata?: DieMetadata;
  insideWafer?: boolean;
  partial?: boolean;     // true if die straddles the wafer boundary
  edgeExcluded?: boolean; // true if die centre falls within the edge exclusion zone
  probeIndex?: number;   // assigned by applyProbeSequence
  /** Number of times this die position appeared in the input results. Only set when > 1. */
  retestCount?: number;
  /** STDF site_num — which parallel test site tested this die. Only meaningful when > 1 distinct value appears per wafer. */
  siteNum?: number;
  /** STDF pir.part_id — tester-assigned identifier for this tested unit. Encodes probe sequence at most fabs. */
  partId?: number;
}

/**
 * Generate a rectangular grid of dies centered on the wafer.
 * Each die carries its width/height for use by the renderer.
 */
export function generateDies(wafer: Wafer, dieConfig: DieSpec): Die[] {
  const { width, height, offset = { x: 0, y: 0 } } = dieConfig;
  const gridSize = dieConfig.gridSize ?? Math.ceil(wafer.radius / Math.min(width, height)) + 1;
  const dies: Die[] = [];

  for (let row = -gridSize; row <= gridSize; row++) {
    for (let col = -gridSize; col <= gridSize; col++) {
      const physX = wafer.center.x + col * width + offset.x;
      const physY = wafer.center.y + row * height + offset.y;
      dies.push({ id: `${col}_${row}`, x: col, y: row, physX, physY, width, height });
    }
  }

  return dies;
}
