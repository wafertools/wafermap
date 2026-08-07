// wafermap starter — the whole app is these two calls.
//
//   buildWaferMap()   pure data + geometry. No DOM, safe to run on a server or
//                     in a worker. Call it once, when your data loads.
//   renderWaferMap()  mounts an interactive canvas with a hover toolbar into a
//                     DOM element. Call it once per map.
//
// Everything else on this page is configuration.

import { buildWaferMap }  from 'wafermap';
import { renderWaferMap } from 'wafermap/render';

import { generateResults, HBIN_DEFS, TEST_DEFS } from './generate-data.js';
// Swap the line above for this to read a CSV instead — see load-csv.js:
//   import { loadCsv } from './load-csv.js';
//   const results = await loadCsv('./my-wafer.csv');

// ── 1. Your data ─────────────────────────────────────────────────────────────
//
// `results` is a DieResult[]. The only required fields are x and y; everything
// else is optional and unlocks a plot mode:
//
//   { x, y }                          position — PROBER STEP POSITIONS, not mm
//   hbin / sbin                       hard / soft bin number  → bin plot modes
//   testValues: { [testNumber]: n }   parametric measurements → value plot mode
//   testPass:   { [testNumber]: b }   functional test verdicts
//   metadata:   { ... }               anything else            → metadata mode
//
// x and y are the prober's integer step positions. Pass them straight through —
// the library converts to millimetres itself using dieConfig.

// Geometry. Both are optional on buildWaferMap: leave either out and the library
// infers it from the data's extent. Supplying real values is always better —
// inference cannot tell a small full wafer from a slice of a large one.
//
// Declared here rather than inline because the synthetic generator needs the same
// numbers: dies laid out on a different grid to the one the map is built with is
// what makes a wafer map render as a ragged non-circle.
const waferConfig = { diameter: 300, notch: { type: 'bottom' } };
const dieConfig   = { width: 8, height: 12 };   // millimetres

const results = generateResults({ seed: 1, waferConfig, dieConfig });

// ── 2. Build ─────────────────────────────────────────────────────────────────

const result = buildWaferMap({
  results,
  waferConfig,
  dieConfig,

  // Which bins count as passing. This drives the yield number AND the yield
  // label's wording, so set it honestly — do not assume bin 1.
  passBins: [1],

  // Names, colours and spec limits for display. Optional, but without them the
  // UI can only show bare numbers.
  hbinDefs: HBIN_DEFS,
  testDefs: TEST_DEFS,
});

// `result` is a plain object you can inspect or hand to the stats package:
//   result.yield.yieldPercent   result.dies   result.wafer   result.inference
console.log(`yield ${result.yield.yieldPercent?.toFixed(1)}% of ${result.dies.length} dies`);

// inference.warnings tells you when supplied geometry could not contain the
// data — worth surfacing rather than swallowing, because it means one of the
// two is wrong.
if (result.inference.warnings?.length) {
  console.warn('geometry warnings:', result.inference.warnings);
}

// ── 3. Render ────────────────────────────────────────────────────────────────

const controller = renderWaferMap(document.getElementById('map'), result, {
  viewOptions: {
    plotMode: 'hardBin',        // 'hardBin' | 'softBin' | 'value' | 'metadata'
    // activeTest: 1050,        // required for plotMode 'value' — a testNumber
  },

  showHelpButton: true,         // '?' toolbar button → the built-in user guide
  insights: { enabled: true },  // Insights toolbar button → chart suite

  // Callbacks are how you wire the map into the rest of your UI.
  onClick(die) {
    // die.x / die.y are ORIGINAL grid coordinates — always safe to show a user,
    // whatever rotation or flip the display is in.
    console.log('clicked die', die.x, die.y, 'hbin', die.hbin);
  },
});

// The controller drives the map from your own code:
//   controller.setOptions({ plotMode: 'value', activeTest: 1050 })
//   controller.resetZoom()
//   controller.getOptions()
//   controller.destroy()
globalThis.wafermapController = controller;   // handy while experimenting
