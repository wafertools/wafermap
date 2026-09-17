import { metadataDisplayValue, type WaferMetadata } from './metadata.js';

/**
 * The name to show for one wafer among several — a gallery card's header, a
 * findings or yield list row, a report's Wafer column, a die list's Wafer
 * column, a detached window's title.
 *
 * Deliberately internal (not re-exported from `core/index.ts`): it is the one
 * rule for every surface that names a wafer, not an API a host needs.
 *
 * Every one of those surfaces used to supply its own fallback for an item with
 * no `label`, and they disagreed: the gallery card header was blank, the
 * findings list and reports said `W3` (a position, which reads as a wafer ID
 * and need not match one), a detached window said "Wafer map", and the
 * Insights tab used the wafer ID. The wafer ID was on the item the whole time.
 *
 * Order: the caller's `label` (a blank one counts as absent), then the wafer's
 * own `metadata.waferId`, then a position that says plainly it is not an ID.
 */
export function waferDisplayLabel(
  item: WaferLabelSource,
  index: number,
): string {
  return waferIdentityLabel(item) ?? `Wafer ${index + 1} (no ID)`;
}

type WaferLabelSource = { label?: string; wafer?: { metadata?: WaferMetadata | null } | null } | null | undefined;

/**
 * The wafer's real identity — the caller's `label`, else `metadata.waferId` —
 * or `undefined` when it has none. `waferDisplayLabel` without its positional
 * fallback, for places where a position must not stand in for an identity: a
 * saved file's name (see canvas-adapter/exportName.ts), where "Wafer 3 (no ID)"
 * would be written into every export of a lot and read back later as an ID.
 */
export function waferIdentityLabel(item: WaferLabelSource): string | undefined {
  return (item?.label?.trim() || undefined)
    ?? metadataDisplayValue(item?.wafer?.metadata?.waferId);
}
