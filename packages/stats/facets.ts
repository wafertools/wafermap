// Faceting: the distinct-values table over wafer metadata — "what can I
// group/compare/split by?" — generalized from tsmap's own metadata.ts so any
// host gets this for free from data it's already attaching to
// `waferConfig.metadata` (WaferMetadata), rather than re-deriving it from a
// host-specific raw-field shape. Pure and DOM-free.

import type { WaferMetadata } from '../core/metadata.js';
import { compareNatural } from '../core/utils.js';

/** Bucket label for wafers with no value for the active facet field — kept
 *  visible (not dropped) so grouped output stays honest about what it's missing. */
export const FACET_NONE_VALUE = '(none)';

/**
 * camelCase/snake_case key → "Title Case" label — the one label convention
 * every metadata surface in this library uses for an uncurated field
 * (`DEFAULT_FACET_CURATION`'s own `label`s, e.g. "Program", intentionally
 * differ and are reserved for facet/group-by UI, not general display — see
 * `buildFacetTable`'s callers in canvas-adapter). Shared by the canvas
 * (Summary panel, metadata badge) and stats (HTML report) layers so a field
 * is never labelled two different ways depending which surface rendered it.
 */
export { prettyKey } from '../core/utils.js';

/** One distinct value of a facet field, with how much data it covers. */
export interface FacetValue {
  value: string;
  waferCount: number;
  dieCount: number;
}

/** A metadata field that wafers can be grouped/split on, plus its distinct values. */
export interface FacetField {
  /** WaferMetadata key (e.g. `lot`, `temperature`, or a caller-supplied extra key). */
  key: string;
  /** Human-readable label — curated, or the raw key for uncurated fields. */
  label: string;
  /** Distinct non-empty values, sorted by coverage (wafer count desc, then label). */
  values: FacetValue[];
  /** True when the field has more than one distinct value — i.e. splitting on it actually partitions the data. */
  splittable: boolean;
}

/** Curation for one metadata key: label + whether it's offered as a facet by default + date handling. */
export interface FacetCuration {
  label: string;
  /** Show this field in the facet table by default. Defaults to true when omitted. */
  facet?: boolean;
  /** Value is an ISO datetime; facet by its date portion only, not full timestamp. */
  date?: boolean;
}

/** Default curation for wmap's own known `WaferMetadata` keys. Callers extend
 *  (not replace) this via `buildFacetTable`'s `curation` option — their own
 *  app-specific extra keys layer on top rather than needing to redeclare these. */
export const DEFAULT_FACET_CURATION: Record<string, FacetCuration> = {
  split:       { label: 'Split' },
  lot:         { label: 'Lot' },
  product:     { label: 'Product' },
  testProgram: { label: 'Program' },
  temperature: { label: 'Temperature' },
  testDate:    { label: 'Test date', date: true },
  operator:    { label: 'Operator' },
  // Identity fields, not grouping axes: unique per wafer by definition, so
  // "splitting" on them just recreates one group per wafer — never useful.
  // Present (not hidden entirely) so an explicit `facetableOnly: false` call
  // can still see them, matching tsmap's own "known but not offered by
  // default" pattern for low-value fields.
  waferId:     { label: 'Wafer', facet: false },
};

function dateOnly(value: string): string {
  const t = value.indexOf('T');
  return t > 0 ? value.slice(0, t) : value;
}

/** The faceting value of one metadata key for one wafer's metadata — the raw
 *  value, except date-curated fields are truncated to date-only so grouping
 *  is by day, not timestamp. */
export function facetValueOf(
  metadata: WaferMetadata | undefined,
  key: string,
  curation: Record<string, FacetCuration> = DEFAULT_FACET_CURATION,
): string | undefined {
  const raw = metadata?.[key];
  if (raw === undefined || raw === null || raw === '') return undefined;
  const str = String(raw);
  return curation[key]?.date ? dateOnly(str) : str;
}

export interface FacetItem {
  metadata?: WaferMetadata;
  /** Die count for this wafer, if known — used for `FacetValue.dieCount` coverage. Omit if not tracked; defaults to 0. */
  dieCount?: number;
}

/** Fields present with the same value on every item's `metadata` — the
 *  conservative lot identity a mixed population can safely display. A field
 *  that varies per item (e.g. `waferId`) is naturally excluded, since it
 *  won't be common across all items. Returns `{}` for an empty list (no
 *  false lot-level claim about zero wafers). */
export function commonMetadata(items: Array<{ metadata?: WaferMetadata }>): WaferMetadata {
  if (!items.length) return {};
  const first = items[0].metadata ?? {};
  const common: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(first)) {
    if (v === null || v === undefined || v === '') continue;
    if (items.every(it => (it.metadata ?? {})[k] === v)) common[k] = v;
  }
  return common;
}

export interface BuildFacetTableOptions {
  /** Extra/override curation entries layered on top of `DEFAULT_FACET_CURATION` — a caller's own app-specific keys (or a relabel of a default one) without losing wmap's built-in defaults. */
  curation?: Record<string, FacetCuration>;
  /** Restrict to fields curated `facet: true` (the default) plus any uncurated key. Pass `false` to include curated-but-`facet:false` fields too. */
  facetableOnly?: boolean;
}

/**
 * Build the distinct-values table over a set of wafers' metadata. One entry
 * per key present on at least one item's `metadata`; curated keys appear
 * first in `DEFAULT_FACET_CURATION`/`curation` order, uncurated keys after
 * (labelled by their raw key). Counts are exact over the full input.
 */
export function buildFacetTable(items: FacetItem[], options: BuildFacetTableOptions = {}): FacetField[] {
  const curation = { ...DEFAULT_FACET_CURATION, ...options.curation };
  const facetableOnly = options.facetableOnly ?? true;

  const present = new Set<string>();
  for (const item of items) {
    for (const key of Object.keys(item.metadata ?? {})) present.add(key);
  }

  const knownOrder = Object.keys(curation);
  const ordered: string[] = [
    ...knownOrder.filter(k => present.has(k)),
    ...[...present].filter(k => !(k in curation)),
  ];

  const table: FacetField[] = [];
  for (const key of ordered) {
    const known = curation[key];
    if (facetableOnly && known && known.facet === false) continue;

    const byValue = new Map<string, { waferCount: number; dieCount: number }>();
    for (const item of items) {
      const v = facetValueOf(item.metadata, key, curation) ?? FACET_NONE_VALUE;
      const entry = byValue.get(v) ?? { waferCount: 0, dieCount: 0 };
      entry.waferCount += 1;
      entry.dieCount += item.dieCount ?? 0;
      byValue.set(v, entry);
    }
    if (byValue.size === 0) continue;

    const values: FacetValue[] = Array.from(byValue, ([value, c]) => ({
      value, waferCount: c.waferCount, dieCount: c.dieCount,
    }));
    // `(none)` always sorts last (it's the residual bucket), regardless of size.
    values.sort((a, b) =>
      (a.value === FACET_NONE_VALUE ? 1 : 0) - (b.value === FACET_NONE_VALUE ? 1 : 0) ||
      b.waferCount - a.waferCount ||
      compareNatural(a.value, b.value));

    table.push({ key, label: known?.label ?? key, values, splittable: values.length > 1 });
  }

  return table;
}
