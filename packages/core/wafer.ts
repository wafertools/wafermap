import type { WaferMetadata } from './metadata.js';

/**
 * Wafer orientation mark.  Pass only `type`; the library derives the standard
 * dimensions from the wafer diameter automatically.
 *
 * - ≤ 150 mm wafers: orientation **flat** (straight chord, 32.5–57.5 mm).
 * - > 150 mm wafers: orientation **notch** (small V-indentation, ~3.5 mm wide).
 *
 * Both are modelled with the same type; the appropriate geometry is chosen
 * internally based on the wafer diameter.
 */
export interface WaferNotch {
  type: 'top' | 'bottom' | 'left' | 'right';
}

export interface WaferSpec {
  diameter: number;
  center?: { x: number; y: number };
  notch?: WaferNotch;
  orientation?: number; // degrees
  metadata?: WaferMetadata;
}

export interface Wafer {
  diameter: number;
  radius: number;
  center: { x: number; y: number };
  /**
   * Resolved orientation mark.  `length` is the standard chord length (flat) or
   * half-width (V-notch), derived from the wafer diameter by `createWafer`.
   */
  notch?: { type: 'top' | 'bottom' | 'left' | 'right'; length: number };
  orientation: number;
  metadata?: WaferMetadata;
}

/** Standard flat/notch chord length in mm for the given wafer diameter. */
function standardNotchLength(diameter: number): number {
  if (diameter <= 100) return 32.5;  // SEMI M1 primary flat
  if (diameter <= 150) return 57.5;  // SEMI M1 primary flat
  return 1.75;                       // SEMI M1 V-notch half-width at surface
}

/** Create a wafer model from spec. Defaults: center={0,0}, orientation=0. */
export function createWafer(config: WaferSpec): Wafer {
  if (config.diameter <= 0) {
    throw new RangeError(`createWafer: diameter must be > 0 (got ${config.diameter})`);
  }
  return {
    diameter:    config.diameter,
    radius:      config.diameter / 2,
    center:      config.center ?? { x: 0, y: 0 },
    notch:       config.notch
                   ? { type: config.notch.type, length: standardNotchLength(config.diameter) }
                   : undefined,
    orientation: config.orientation ?? 0,
    metadata:    config.metadata,
  };
}
