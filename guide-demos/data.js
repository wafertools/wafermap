/**
 * data.js — shared synthetic data for wafermap guide demos.
 *
 * All results are generated deterministically from a seed, calibrated to
 * resemble real 300 mm wafer test output: edge yield gradient, physical test
 * value distributions, and optional spatial failure patterns.
 *
 * Typical setup used by most demos:
 *   300 mm diameter · 10 mm × 10 mm dies · ~580 dies per wafer
 */

// ── Core RNG ─────────────────────────────────────────────────────────────────

/**
 * Repeatable pseudo-random float in [0, 1) from a 2-D position and seed.
 * Uses a simple sinusoidal hash — fast and sufficient for demo data.
 */
export function rng(i, j, seed = 1) {
  const x = Math.sin(i * 127.1 + j * 311.7 + seed * 74.3) * 43758.5453;
  return x - Math.floor(x);
}

// ── Data generator ────────────────────────────────────────────────────────────

/**
 * Generate one wafer's worth of DieResult objects for a 300 mm / 10 mm-pitch wafer.
 *
 * @param {object}  opts
 * @param {number}  [opts.seed=1]          Controls per-wafer variation.
 * @param {number}  [opts.radius=14]       Die-grid radius (steps from wafer centre to edge).
 * @param {boolean} [opts.edgeFail=false]  Adds a strong failure band in the outer ring (~r > 72% radius).
 * @param {boolean} [opts.quadrant=false]  NE quadrant has lower yield and higher Vth.
 * @param {boolean} [opts.center=false]    Small defect cluster at the wafer centre.
 * @returns {Array<{x,y,bins,values}>}
 */
export function makeResults({
  seed       = 1,
  radius     = 14,
  edgeFail   = false,
  quadrant   = false,
  center     = false,
} = {}) {
  const results = [];

  for (let i = -radius; i <= radius; i++) {
    for (let j = -radius; j <= radius; j++) {
      const r = Math.hypot(i, j);
      if (r > radius - 0.5) continue; // exclude dice straddling the wafer edge

      // Independent noise channels
      const n1 = rng(i, j, seed);
      const n2 = rng(i, j, seed + 37);
      const n3 = rng(i, j, seed + 89);
      const roll = rng(i, j, seed + 200); // bin assignment roll

      // Base pass probability: ~93% at centre, falls to ~68% at the edge
      let pass = 0.93 * Math.exp(-(r / radius) * 1.3)
               + 0.68 * (1 - Math.exp(-(r / radius) * 1.3))
               + (n1 - 0.5) * 0.06;

      // Optional failure patterns
      if (edgeFail  && r > radius * 0.72)           pass -= 0.32; // outer ring yield loss
      if (quadrant  && i > 0 && j > 0)              pass -= 0.20; // NE quadrant drift
      if (center    && r < radius * 0.22)           pass -= 0.28; // centre defect cluster

      pass = Math.max(0.04, Math.min(0.97, pass));

      // Hard bin + soft bin assignment
      let hbin, sbin;
      if (roll < pass) {
        hbin = 1; sbin = 10; // Pass
      } else {
        const which = rng(i, j, seed + 400);
        if      (which < 0.45) { hbin = 2; sbin = 20; } // Contact Open
        else if (which < 0.75) { hbin = 3; sbin = 11; } // Vth - Hi
        else                   { hbin = 4; sbin = 21; } // Leakage
      }

      // Test values — physically motivated spatial gradients:
      //   Idsat: drive current peaks at centre, drops toward edge
      const idsatBase = 1.5e-3 * (1 - (r / radius) * 0.35);
      const idsatQuad = (quadrant && i > 0 && j > 0) ? -0.11e-3 : 0;
      const idsat = idsatBase + idsatQuad + (n2 - 0.5) * 0.18e-3;

      //   Vth: threshold voltage increases toward edge (process gradient)
      const vthQuad = (quadrant && i > 0 && j > 0) ? 0.04 : 0;
      const vth = 0.450 + (r / radius) * 0.085 + vthQuad + (n3 - 0.5) * 0.028;

      //   Ioff: off-state leakage grows exponentially toward edge
      const ioff = 8e-12 * Math.exp((r / radius) * 2.1) * (1 + (n1 - 0.5) * 0.4);

      results.push({ x: i, y: j, bins: [hbin, sbin], values: [idsat, vth, ioff] });
    }
  }

  return results;
}

// ── Shared definitions ────────────────────────────────────────────────────────

/**
 * Hard bin names and brand colours.
 * Bin 1 = Pass; bins 2–4 are failure categories as assigned by the test program handler.
 */
export const HBIN_DEFS = [
  { bin: 1, name: 'Pass',          color: '#22c55e' },
  { bin: 2, name: 'Contact Open',  color: '#ef4444' },
  { bin: 3, name: 'Vth - Hi',      color: '#f97316' },
  { bin: 4, name: 'Leakage',       color: '#a855f7' },
];

/**
 * Soft bin names — independent number space from hard bins (STDF V4: both 0–32767).
 * Many soft bins can map to a single hard bin for triage purposes.
 */
export const SBIN_DEFS = [
  { bin: 10, name: 'Pass',             color: '#22c55e' },
  { bin: 11, name: 'Vth Out of Range', color: '#f97316' },
  { bin: 20, name: 'Contact Fail',     color: '#ef4444' },
  { bin: 21, name: 'Leakage Fail',     color: '#a855f7' },
];

/**
 * Three continuous parametric tests: saturation current, threshold voltage, leakage.
 * The index matches the values[] slot in each DieResult.
 */
export const TEST_DEFS = [
  { index: 0, name: 'Idsat', unit: 'A' },
  { index: 1, name: 'Vth',   unit: 'V' },
  { index: 2, name: 'Ioff',  unit: 'A' },
];

/** Standard 300 mm production wafer with bottom notch. */
export const WAFER_CONFIG = { diameter: 300, notch: { type: 'bottom' } };

/** 10 mm × 10 mm die pitch — common for test vehicles and leading-edge devices. */
export const DIE_CONFIG = { width: 10, height: 10 };
