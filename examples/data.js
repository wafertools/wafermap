/**
 * data.js — shared synthetic data for wafermap guide demos.
 *
 * All results are generated deterministically from a seed, calibrated to
 * resemble real 300 mm wafer test output: edge yield gradient, physical test
 * value distributions, and optional spatial failure patterns.
 *
 * Typical setup used by most demos:
 *   300 mm diameter · 8 mm × 12 mm dies · ~490 dies per wafer
 *   (8×12 mm is a realistic rectangular die for a leading-edge logic device)
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
 * Generate one wafer's worth of DieResult objects for a 300 mm wafer with 8×12 mm dies.
 * Spatial patterns are computed from physical mm distances so they are correct for
 * rectangular dies. buildWaferMap clips the result to the real circular wafer boundary.
 *
 * @param {object}  opts
 * @param {number}  [opts.seed=1]               Controls per-wafer variation.
 * @param {boolean} [opts.edgeFail=false]        Adds a strong failure band in the outer ring (r > 72%).
 * @param {boolean} [opts.quadrant=false]        NE quadrant has lower yield and higher Vth.
 * @param {boolean} [opts.center=false]          Small defect cluster at the wafer centre.
 * @param {boolean} [opts.reticlePattern=false]  Repeating field-position defect pattern.
 * @returns {Array<{x,y,hbin,sbin,values}>}
 */
export function makeResults({
  seed            = 1,
  edgeFail        = false,
  quadrant        = false,
  center          = false,
  reticlePattern  = false,
} = {}) {
  // Physical die pitch and wafer radius in mm.
  // Grid sweeps enough index steps to cover the full wafer in each direction.
  const pitchX = 8, pitchY = 12, waferRadius = 150;
  const iMax = Math.ceil(waferRadius / pitchX);
  const jMax = Math.ceil(waferRadius / pitchY);

  const results = [];

  for (let i = -iMax; i <= iMax; i++) {
    for (let j = -jMax; j <= jMax; j++) {
      // Physical distance from wafer centre — used for all spatial patterns.
      const rMm = Math.hypot(i * pitchX, j * pitchY);
      // Skip dies whose centre is outside the wafer; buildWaferMap will also
      // clip based on die corners, but pre-filtering keeps the data set lean.
      if (rMm > waferRadius) continue;

      const t = rMm / waferRadius; // normalised radial position [0, 1]

      // Independent noise channels
      const n1 = rng(i, j, seed);
      const n2 = rng(i, j, seed + 37);
      const n3 = rng(i, j, seed + 89);
      const roll = rng(i, j, seed + 200);

      // Base pass probability: ~93% at centre, falls to ~68% at the edge
      let pass = 0.93 * Math.exp(-t * 1.3)
               + 0.68 * (1 - Math.exp(-t * 1.3))
               + (n1 - 0.5) * 0.06;

      // Optional failure patterns
      if (edgeFail  && t > 0.72)            pass -= 0.32; // outer ring yield loss
      if (quadrant  && i > 0 && j > 0)      pass -= 0.20; // NE quadrant drift
      if (center    && t < 0.22)            pass -= 0.28; // centre defect cluster
      if (reticlePattern) {
        const reticleWidth = 4, reticleHeight = 3;
        const phaseX = ((1 % reticleWidth) + reticleWidth) % reticleWidth;
        const cellX = ((i + phaseX) % reticleWidth + reticleWidth) % reticleWidth;
        const cellY = ((j % reticleHeight) + reticleHeight) % reticleHeight;
        if (cellX === 2 && cellY === 1) pass -= 0.32;
      }

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
      const idsatBase = 1.5e-3 * (1 - t * 0.35);
      const idsatQuad = (quadrant && i > 0 && j > 0) ? -0.11e-3 : 0;
      const idsat = idsatBase + idsatQuad + (n2 - 0.5) * 0.18e-3;

      //   Vth: threshold voltage increases toward edge (process gradient)
      const vthQuad = (quadrant && i > 0 && j > 0) ? 0.04 : 0;
      const vth = 0.450 + t * 0.085 + vthQuad + (n3 - 0.5) * 0.028;

      //   Ioff: off-state leakage grows exponentially toward edge
      const ioff = 8e-12 * Math.exp(t * 2.1) * (1 + (n1 - 0.5) * 0.4);

      results.push({ x: i, y: j, hbin, sbin, testValues: { 1050: idsat, 1060: vth, 1070: ioff } });
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
 * testNumber is a stable per-test identity (e.g. STDF TEST_NUM or equivalent).
 */
export const TEST_DEFS = [
  { testNumber: 1050, name: 'Idsat', unit: 'A' },
  { testNumber: 1060, name: 'Vth',   unit: 'V' },
  { testNumber: 1070, name: 'Ioff',  unit: 'A' },
];

/** Standard 300 mm production wafer with bottom notch. */
export const WAFER_CONFIG = {
  diameter: 300,
  notch: { type: 'bottom' },
  metadata: { lot: 'LOT-DEMO', product: 'DEMO-DEVICE', wafer: 'W01' },
};

/**
 * Build a wafer config for a specific wafer in a lot.
 * @param {number} index  0-based wafer index.
 */
export function makeWaferConfig(index) {
  const n = String(index + 1).padStart(2, '0');
  return { ...WAFER_CONFIG, metadata: { ...WAFER_CONFIG.metadata, wafer: `W${n}` } };
}

/** 8 mm × 12 mm die pitch — realistic rectangular die for a leading-edge logic device. */
export const DIE_CONFIG = { width: 8, height: 12 };
