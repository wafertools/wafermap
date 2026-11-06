// The plot mode a wafer opened from an Insights chart starts in, when the chart does not name a test.
//
// A chart that is about a test opens the wafer on that test (the host is handed the test number). One that is not (yield,
// a table row) lands in the gallery's own mode, except where that mode cannot describe one wafer: a lot-stacked mode needs
// the lot, so the wafer opens in the same kind of measure on its own, and a yield bar always opens the bins, since that is
// the map that says where the yield went.

import type { PlotMode } from '../renderer/buildView.js';

const UNSTACKED: Partial<Record<PlotMode, PlotMode>> = { stackedValues: 'value', stackedBins: 'hardBin', stackedSoftBins: 'softBin' };

/**
 * The mode to open the wafer in, or `undefined` to leave the gallery's mode as it is.
 * `sharedMode` and `sharedTest` are the gallery's own; `testNumber` is the one the chart names, `view` 'bins' a request for the bins.
 */
export function waferOpenMode(sharedMode: PlotMode | undefined, sharedTest: number | undefined, testNumber: number | undefined, view?: 'bins'): PlotMode | undefined {
  if (testNumber !== undefined) return undefined; // the host opens the wafer on that test
  if (view === 'bins') return 'hardBin';
  const plain = sharedMode ? UNSTACKED[sharedMode] : undefined;
  // A stack of test values has no single test to show unless the gallery has picked one.
  return plain === 'value' && sharedTest === undefined ? 'hardBin' : plain;
}
