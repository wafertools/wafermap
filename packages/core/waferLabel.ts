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
  item: { label?: string; wafer?: { metadata?: WaferMetadata | null } | null } | null | undefined,
  index: number,
): string {
  return (item?.label?.trim() || undefined)
    ?? metadataDisplayValue(item?.wafer?.metadata?.waferId)
    ?? `Wafer ${index + 1} (no ID)`;
}
