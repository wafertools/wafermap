// Synthetic wafer data, so the starter renders something before you have a file
// to load. Delete this once you are reading real data — nothing else depends on it.
//
// Deliberately separate from ../data.js, which is tuned to produce specific
// failure signatures for the demo pages. This one is meant to be read and edited.

// ── Knobs ────────────────────────────────────────────────────────────────────
//
// Must match the geometry passed to buildWaferMap in app.js. The cutoff below
// is computed in physical mm, using DIE_WIDTH/DIE_HEIGHT/WAFER_DIAMETER — not
// in die-index space — because a rectangular die pitch (8x12) makes an
// index-space circle (hypot(x, y) / GRID_RADIUS) an ELLIPSE in mm. Left
// unclipped to the real wafer circle, that ellipse pokes outside the actual
// 300mm wafer outline on the tall axis, which is exactly the jagged,
// non-circular map this constant exists to prevent.
export const GRID_RADIUS    = 18;    // dies from centre to edge
export const DIE_WIDTH      = 8;     // mm — must match app.js's dieConfig.width
export const DIE_HEIGHT     = 12;    // mm — must match app.js's dieConfig.height
export const WAFER_DIAMETER = 300;   // mm — must match app.js's waferConfig.diameter
export const YIELD          = 0.92;  // baseline pass probability at the wafer centre
export const EDGE_LOSS      = 0.35;  // extra failure probability at the very edge

// ── Bin and test definitions ─────────────────────────────────────────────────
//
// Bin numbers are yours; only `passBins` in app.js decides which ones pass.
// Omit `color` to let the active colour scheme choose.

export const HBIN_DEFS = [
  { bin: 1, name: 'Pass'         },
  { bin: 2, name: 'Contact Open' },
  { bin: 3, name: 'Vth High'     },
  { bin: 4, name: 'Leakage'      },
];

// testNumber is required and is the key used in DieResult.testValues.
// limitLow / limitHigh drive the out-of-spec markers and the capability charts.
export const TEST_DEFS = [
  { testNumber: 1050, name: 'Idsat', unit: 'mA', limitLow: 0.40, limitHigh: 0.80 },
  { testNumber: 1060, name: 'Vth',   unit: 'V',  limitLow: 0.30, limitHigh: 0.57 },
];

// ── Generator ────────────────────────────────────────────────────────────────

/** Deterministic pseudo-random in [0, 1) — same seed gives the same wafer. */
function rand(x, y, seed) {
  const n = Math.sin((x * 127.1 + y * 311.7 + seed * 74.7)) * 43758.5453;
  return n - Math.floor(n);
}

/**
 * Build a DieResult[] for one wafer.
 * Positions are prober step positions centred on (0, 0).
 */
export function generateResults({ seed = 1 } = {}) {
  const results = [];

  const waferRadius = WAFER_DIAMETER / 2;

  for (let x = -GRID_RADIUS; x <= GRID_RADIUS; x++) {
    for (let y = -GRID_RADIUS; y <= GRID_RADIUS; y++) {
      // Physical distance from centre, in mm — not index space, since the die
      // pitch is rectangular (see the comment on the constants above).
      const r = Math.hypot(x * DIE_WIDTH, y * DIE_HEIGHT) / waferRadius;

      // A prober only steps to sites that lie fully on the wafer, so anything
      // outside the circle is simply never probed — not a "partial" die.
      if (r > 1) continue;

      // Yield falls off towards the edge, as it usually does in reality.
      const passProb = YIELD - EDGE_LOSS * Math.pow(r, 4);
      const roll     = rand(x, y, seed);
      const pass     = roll < passProb;

      // Failures spread across the three failure bins.
      const hbin = pass ? 1 : 2 + Math.floor(rand(x, y, seed + 99) * 3);

      // Parametric values, with a mild radial gradient so the value plot mode
      // and the capability charts have something to show.
      const idsat = 0.62 - 0.10 * r + (rand(x, y, seed + 7) - 0.5) * 0.06;
      const vth   = 0.42 + 0.08 * r + (rand(x, y, seed + 13) - 0.5) * 0.05;

      results.push({
        x,
        y,
        hbin,
        // Keyed by testNumber — NOT a positional array.
        testValues: { 1050: idsat, 1060: vth },
      });
    }
  }

  return results;
}
