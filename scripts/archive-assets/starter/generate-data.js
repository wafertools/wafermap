// Synthetic wafer data, so the starter renders something before you have a file
// to load. Delete this once you are reading real data — nothing else depends on it.
//
// Deliberately separate from ../data.js, which is tuned to produce specific
// failure signatures for the demo pages. This one is meant to be read and edited.

// ── Knobs ────────────────────────────────────────────────────────────────────

export const YIELD     = 0.92;  // baseline pass probability at the wafer centre
export const EDGE_LOSS = 0.35;  // extra failure probability at the very edge

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
 *
 * `waferConfig` and `dieConfig` are the same objects passed to buildWaferMap —
 * generating dies on a different grid to the one the map is built with is what
 * makes a wafer map render as a ragged non-circle, so they come from one place.
 */
export function generateResults({ seed = 1, waferConfig, dieConfig } = {}) {
  const results = [];

  const waferRadius = waferConfig.diameter / 2;
  const pitchX = dieConfig.width, pitchY = dieConfig.height;

  // Sweep enough index steps to cover the wafer in each direction. Derived, not
  // hardcoded: a hardcoded index radius silently crops the map into a rectangle
  // as soon as the die size shrinks.
  const iMax = Math.ceil(waferRadius / pitchX);
  const jMax = Math.ceil(waferRadius / pitchY);

  // A prober only steps to sites lying ENTIRELY on the wafer, so require the die
  // centre to sit at least one half-diagonal inside the edge. Testing the centre
  // alone admits dies that straddle the boundary and render poking out past the
  // wafer outline — and a die built from results is never a "partial" die.
  const halfDiag = Math.hypot(pitchX / 2, pitchY / 2);

  for (let x = -iMax; x <= iMax; x++) {
    for (let y = -jMax; y <= jMax; y++) {
      // Physical distance from centre, in mm — not index space, since a
      // rectangular die pitch makes an index-space circle an ellipse in mm.
      const rMm = Math.hypot(x * pitchX, y * pitchY);
      if (rMm + halfDiag > waferRadius) continue;

      const r = rMm / waferRadius;   // normalised radial position [0, 1]

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
