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
  /**
   * User-assigned experiment/process-corner tag (e.g. "TT", "FF", a custom
   * group name) — distinct from any parser-derived field. A first-class slot
   * so hosts that support wafer-split assignment (grouping wafers into
   * ad-hoc experiment buckets after the fact) get it picked up automatically
   * by anything that facets/groups on `WaferMetadata` — reports, an
   * eventual Group-by control — without per-host special-casing.
   */
  split?:       string;
  [key: string]: unknown;
}
