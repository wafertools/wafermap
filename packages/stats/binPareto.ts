// The order bins are listed in: one rule for every legend, panel and report. Pure, no DOM.

/**
 * Display order for a bin breakdown: pass bins first (in bin order), then failing
 * bins by descending count, ties broken by bin number.
 *
 * The single source of this ordering, for the Summary panel's bin section, the summary report's bin tables (per wafer
 * and lot), the legends and the gallery strip, so a wafer's bins are listed in one order everywhere.
 *
 * Pass bins are pinned to the top rather than competing on count: they are the
 * reference the failures are read against, not themselves a failure mode.
 *
 * `passBins` must be the passing bins OF THE TYPE BEING SORTED. For hard bins
 * that is `passBins`; for soft bins it is `BinColors.pass.soft` (or
 * `binPassSets(dies, passBins).soft`) — hard pass numbers applied to a soft
 * tally pin the wrong rows.
 */
export function sortBinsForDisplay(
  entries: Iterable<[bin: number, count: number]>,
  passBins: Iterable<number>,
): Array<[bin: number, count: number]> {
  const passSet = new Set(passBins);
  return [...entries].sort((a, b) => {
    const aPass = passSet.has(a[0]), bPass = passSet.has(b[0]);
    if (aPass !== bPass) return aPass ? -1 : 1;
    if (aPass && bPass) return a[0] - b[0];
    return b[1] - a[1] || a[0] - b[0];
  });
}
