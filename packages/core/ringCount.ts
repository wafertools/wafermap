/**
 * The ring count a map's rings, ring findings, ring yields and ring plots all use — and the ONE place its default lives.
 *
 * Same rule as pass bins (core/passBins.ts): the default applies where data ENTERS the library, `buildWaferMap`
 * (`WaferMapInput.ringCount`, default 4), and from there the value travels on the result (`WaferMapResult.ringCount`).
 * Everywhere else it is read, never replaced: a surface that fell back to 4 for a wafer built with 6 rings would draw one
 * set of rings and report findings for another. `scripts/check-pass-bin-defaults.mjs` and `tests/passBinsDefault.test.mjs`
 * hold this too.
 *
 * Deliberately internal (not re-exported from `core/index.ts`).
 */

const INPUT_DEFAULT_RING_COUNT = 4;

/** The ring count of an input that states none. Called by `buildWaferMap` and nothing else. */
export function defaultRingCount(): number {
  return INPUT_DEFAULT_RING_COUNT;
}

/** The ring count a source carries, or an error naming where it was missing. There is no default to fall back on. */
export function requireRingCount(source: { ringCount?: number } | null | undefined, where: string): number {
  const n = source?.ringCount;
  if (typeof n !== 'number' || !Number.isFinite(n)) {
    throw new Error(`${where}: no ring count (WaferMapResult.ringCount); a map not built by buildWaferMap must state it.`);
  }
  return n;
}

/** One item's ring count: its own, else `fallback` — a value the CALLER holds — else an error. Never a built-in default. */
export function itemRingCount(item: { ringCount?: number } | null | undefined, fallback?: number): number {
  return item?.ringCount ?? fallback ?? requireRingCount(undefined, 'itemRingCount');
}
