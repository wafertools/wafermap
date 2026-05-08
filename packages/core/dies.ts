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
  i: number;
  j: number;
  x: number;           // display coordinate (mm)
  y: number;
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
}

/**
 * Generate a rectangular grid of dies centered on the wafer.
 * Each die carries its width/height for use by the renderer.
 */
export function generateDies(wafer: Wafer, dieConfig: DieSpec): Die[] {
  const { width, height, offset = { x: 0, y: 0 } } = dieConfig;
  const gridSize = dieConfig.gridSize ?? Math.ceil(wafer.radius / Math.min(width, height)) + 1;
  const dies: Die[] = [];

  for (let j = -gridSize; j <= gridSize; j++) {
    for (let i = -gridSize; i <= gridSize; i++) {
      const x = wafer.center.x + i * width + offset.x;
      const y = wafer.center.y + j * height + offset.y;
      dies.push({ id: `${i}_${j}`, i, j, x, y, width, height });
    }
  }

  return dies;
}
