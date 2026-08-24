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

/**
 * Stringify one metadata value for **display or export** — the single source of
 * truth for what a metadata value looks like as text.
 *
 * - `null` / `undefined` / `''` → `undefined`. The field is absent, not
 *   present-and-empty: a blank cell and a missing key must not be confusable.
 * - `string` / `number` / `boolean` → `String(v)`. Note `0` and `false` are
 *   real values and are kept — the classic falsy bug is to drop them.
 * - `Date` → ISO string, so a date sorts and parses in a spreadsheet.
 * - object / array → `JSON.stringify(v)`. Deliberately **not** `String(v)`,
 *   which yields `[object Object]` and collapses genuinely different values
 *   into one indistinguishable cell — invisible data loss in an export, and
 *   in a facet table it merges distinct groups into a single bogus bucket.
 *
 * Its stricter sibling is {@link metadataCategoricalValue}.
 */
export function metadataDisplayValue(raw: unknown): string | undefined {
  if (raw === null || raw === undefined || raw === '') return undefined;
  if (typeof raw === 'string' || typeof raw === 'number' || typeof raw === 'boolean') {
    return String(raw);
  }
  if (raw instanceof Date) return raw.toISOString();
  try {
    return JSON.stringify(raw);
  } catch {
    // Circular structure, or a BigInt inside. Better an honest marker than a
    // thrown error from a tooltip or a CSV export.
    return '[unserializable]';
  }
}

/**
 * Stringify one metadata value for **categorical** use — a colour swatch, a
 * legend entry, a palette key.
 *
 * Identical to {@link metadataDisplayValue} except that non-primitives resolve
 * to `undefined` (no-data). That is the one legitimate difference between the
 * two modes: there is no sensible swatch for an object, and a JSON blob is not
 * a legend entry. Everything else — the falsy-value rule, the empty-string
 * rule — is shared, so the two can never disagree about which dies *have* a
 * value for a primitive key.
 */
export function metadataCategoricalValue(raw: unknown): string | undefined {
  if (typeof raw === 'object' && raw !== null) return undefined;
  return metadataDisplayValue(raw);
}
