// Resolves metadata keys into table/CSV columns. DOM-free and pure, so the
// same column set drives the die-list table, the die-list CSV export, and the
// per-test CSV exports — one definition, no chance of a header and its getter
// drifting apart.
//
// Lives beside facets.ts because it reuses DEFAULT_FACET_CURATION's key
// ordering, and because both stats/ and canvas-adapter/ need it while
// renderer/ must not depend on stats/.
//
// Why keys are auto-discovered here, when `metadataFields` exists to opt keys
// into `'metadata'` PLOT mode: that opt-in guards *legend cardinality* — a
// free-text key with thousands of distinct values cannot be a colour legend.
// A table column carries no such constraint (one cell per die, whatever the
// value), so the same restriction would only serve to silently drop host data
// from an export. `metadataFields` still supplies labels and ordering when the
// host has bothered to declare a key.
import type { Die } from '../core/dies.js';
import type { WaferMetadata } from '../core/metadata.js';
import { metadataDisplayValue } from '../core/metadata.js';
import { compareNatural, prettyKey } from '../core/utils.js';
import type { MetadataFieldDef } from '../renderer/buildWaferMap.js';
import { DEFAULT_FACET_CURATION } from './facets.js';

/** Where a column's value comes from. A `'wafer'` column is constant down
 *  every row; a `'die'` column genuinely varies die to die. */
export type MetadataColumnScope = 'die' | 'wafer';

/** How metadata keys are chosen. `'auto'` = every key present in the data. */
export type MetadataKeySelection = 'auto' | 'none' | string[];

export interface MetadataColumn {
  /** The metadata key this column reads. */
  key: string;
  /** Column header, already de-duplicated against every other column. */
  label: string;
  scope: MetadataColumnScope;
  /** Value for one die. Always a string — `''` for absent, never `'undefined'`. */
  get: (die: Die) => string;
  /** Wafer scope only: the die-independent value, for exports with no die rows. */
  constant?: string;
  /** True when the column belongs in the CSV but not the on-screen table. */
  csvOnly: boolean;
}

export interface ResolveMetadataColumnsOptions {
  /** Population to discover die keys from. Scanned in full — never sampled. */
  dies?: Die[];
  waferMetadata?: WaferMetadata;
  /** Supplies label and ordering for keys the host has already declared. */
  metadataFields?: MetadataFieldDef[];
  /** Die-level key selection. Default `'auto'`. */
  dieKeys?: MetadataKeySelection;
  /** Wafer-level key selection. Default `'auto'`. */
  waferKeys?: MetadataKeySelection;
  /** Where wafer-level columns appear. Default `'csv'`. */
  waferPlacement?: 'csv' | 'both' | 'none';
  /** Headers already taken by built-in columns, for collision resolution. */
  reservedLabels?: string[];
  /**
   * Cap on auto-discovered die keys. Default 64. Exceeding it is a data shape
   * no table can usefully show; the excess is reported in `truncatedKeys` so
   * the caller can state the omission rather than hide it.
   */
  maxDieKeys?: number;
}

export interface MetadataColumnSet {
  columns: MetadataColumn[];
  /** Die keys dropped by `maxDieKeys`, in the order they would have appeared. */
  truncatedKeys: string[];
}

const DEFAULT_MAX_DIE_KEYS = 64;

/**
 * Union of `die.metadata` keys across the whole population, deterministically
 * ordered: keys named in `metadataFields` first (declaration order), then the
 * rest by `compareNatural`. Never object insertion order — two runs over the
 * same data must produce byte-identical exports.
 *
 * The scan is deliberately exhaustive rather than sampled: a key appearing
 * only on late dies would otherwise vanish from the export with no signal.
 */
export function discoverDieMetadataKeys(
  dies: Die[],
  metadataFields?: MetadataFieldDef[],
  limit: number = DEFAULT_MAX_DIE_KEYS,
): { keys: string[]; truncated: string[] } {
  const present = new Set<string>();
  for (const die of dies) {
    if (!die.metadata) continue;
    for (const key of Object.keys(die.metadata)) present.add(key);
  }

  const declared: string[] = [];
  for (const def of metadataFields ?? []) {
    if (present.has(def.key) && !declared.includes(def.key)) declared.push(def.key);
  }
  const rest = [...present].filter(k => !declared.includes(k)).sort(compareNatural);
  const ordered = [...declared, ...rest];

  return { keys: ordered.slice(0, limit), truncated: ordered.slice(limit) };
}

/** Wafer keys in curation order first, then uncurated keys naturally sorted.
 *
 *  `facetableOnly` is deliberately NOT applied: `waferId` is hidden from facet
 *  UI because it is an identity field rather than a grouping axis — which is
 *  exactly why an export must carry it. Facet = what you group by; column =
 *  what identifies the row. */
function orderWaferKeys(metadata: WaferMetadata): string[] {
  const present = Object.keys(metadata).filter(k => metadataDisplayValue(metadata[k]) !== undefined);
  const curated = Object.keys(DEFAULT_FACET_CURATION).filter(k => present.includes(k));
  const rest = present.filter(k => !curated.includes(k)).sort(compareNatural);
  return [...curated, ...rest];
}

const selectKeys = (selection: MetadataKeySelection | undefined, available: string[]): string[] => {
  if (selection === 'none') return [];
  if (Array.isArray(selection)) return selection.filter(k => available.includes(k));
  return available; // 'auto' or omitted
};

/**
 * Build the metadata column set for a population.
 *
 * A key present on both a die and its wafer yields exactly ONE column, scope
 * `'die'`, carrying the die value — the same shadowing rule the hover tooltip
 * applies with `{ ...waferMeta, ...die.metadata }`. Two columns for one key
 * could otherwise disagree in the same row.
 */
export function resolveMetadataColumns(o: ResolveMetadataColumnsOptions): MetadataColumnSet {
  const waferMetadata = o.waferMetadata ?? {};
  const placement = o.waferPlacement ?? 'csv';

  const discovered = discoverDieMetadataKeys(
    o.dies ?? [], o.metadataFields, o.maxDieKeys ?? DEFAULT_MAX_DIE_KEYS,
  );
  const dieKeys = selectKeys(o.dieKeys, discovered.keys);

  const waferKeys = placement === 'none'
    ? []
    : selectKeys(o.waferKeys, orderWaferKeys(waferMetadata))
        // Shadowed by a die column of the same key — the die value wins.
        .filter(k => !dieKeys.includes(k));

  // Labels are claimed in a fixed order so the result is deterministic:
  // built-ins first, then die columns, then wafer columns.
  const taken = new Set(o.reservedLabels ?? []);
  const labelFor = (key: string, scope: MetadataColumnScope): string => {
    const declared = o.metadataFields?.find(f => f.key === key)?.label;
    const base = declared ?? prettyKey(key);
    if (!taken.has(base)) { taken.add(base); return base; }

    // Distinguish by source before falling back to anything opaque.
    const scoped = scope === 'die' ? `${base} (metadata)` : `${base} (wafer metadata)`;
    if (!taken.has(scoped)) { taken.add(scoped); return scoped; }

    // Two keys pretty-printing to the same label (test_program vs testProgram).
    const raw = `${base} (${key})`;
    if (!taken.has(raw)) { taken.add(raw); return raw; }

    // Total function: never drop a column for want of a name.
    for (let n = 2; ; n++) {
      const numbered = `${raw} (${n})`;
      if (!taken.has(numbered)) { taken.add(numbered); return numbered; }
    }
  };

  const columns: MetadataColumn[] = [];

  for (const key of dieKeys) {
    columns.push({
      key,
      label: labelFor(key, 'die'),
      scope: 'die',
      get: (die: Die) => metadataDisplayValue(die.metadata?.[key]) ?? '',
      csvOnly: false,
    });
  }

  for (const key of waferKeys) {
    const constant = metadataDisplayValue(waferMetadata[key]) ?? '';
    columns.push({
      key,
      label: labelFor(key, 'wafer'),
      scope: 'wafer',
      get: () => constant,
      constant,
      csvOnly: placement === 'csv',
    });
  }

  return { columns, truncatedKeys: discovered.truncated };
}
