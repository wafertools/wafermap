/**
 * Genuinely per-die annotations for hover tooltips. Wafer/lot-level facts (lot,
 * wafer id, product, test program, temperature, …) live on {@link WaferMetadata}
 * and are merged into the tooltip automatically — do NOT duplicate them here.
 * A die cannot differ from its wafer on those fields, so storing them per-die was
 * pure redundancy (removed in 0.15.0). Only set keys here that genuinely vary
 * die-to-die; a key present here overrides the wafer-level value of the same name.
 */
export interface DieMetadata {
  [key: string]: unknown;
}

export interface WaferMetadata {
  lot?:         string;
  waferId?:     string | number;
  product?:     string;
  testDate?:    string;
  operator?:    string;
  testProgram?: string;
  temperature?: number;
  [key: string]: unknown;
}
