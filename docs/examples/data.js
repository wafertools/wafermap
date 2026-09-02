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
 * Uses a Wang-style integer hash — spatially uncorrelated, so adjacent dies
 * don't produce correlated noise that could look like spurious clusters.
 */
export function rng(i, j, seed = 1) {
  let h = (((i + 1000) * 2654435761) ^ ((j + 1000) * 2246822519) ^ (seed * 3266489917)) >>> 0;
  h = (Math.imul(h ^ (h >>> 16), 0x45d9f3b)) >>> 0;
  h = (Math.imul(h ^ (h >>> 16), 0x45d9f3b)) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 0xffffffff;
}

// ── Process split ────────────────────────────────────────────────────────────

/**
 * The two process splits a demo lot is built from. Wafers alternate between them,
 * which is what gives the Insights tab a real "Group by" axis: `waferId` is
 * unique per wafer and the facet table deliberately excludes it, so without a
 * field like this no generated demo has anything to group on at all.
 *
 * "POR" is process-of-record; the split arm runs a higher implant dose, which
 * shifts Vth up — see `SPLIT_VTH_BIAS`. That makes the split arm fail the Vth
 * upper limit more often, so a grouped pass-rate chart shows a real difference
 * rather than two identical bars.
 */
export const PROCESS_SPLITS = ['POR', 'Hi-dose'];

/** Which split a wafer belongs to. Wafers alternate, so even a 2-wafer demo has both. */
export function splitForWafer(index) {
  return PROCESS_SPLITS[index % PROCESS_SPLITS.length];
}

/**
 * Vth offset (volts) applied by each split arm. The higher implant dose pushes Vth
 * up against the 0.57 V upper limit.
 *
 * Calibrated, not guessed: at +50 mV the split arm still passes the exported spec
 * on ~98% of dies but passes the tester's tighter guard band on only ~81%. That
 * gap is the demo — a split that looks acceptable against the datasheet limits and
 * marginal against the criterion the tester actually applied. POR sits well inside
 * both, so the difference reads as a property of the split rather than of the lot.
 */
export const SPLIT_VTH_BIAS = { 'POR': 0, 'Hi-dose': 0.050 };

// ── Data generator ────────────────────────────────────────────────────────────

/**
 * Generate one wafer's worth of DieResult objects for a 300 mm wafer with 8×12 mm dies.
 * Spatial patterns are computed from physical mm distances so they are correct for
 * rectangular dies. buildWaferMap clips the result to the real circular wafer boundary.
 *
 * @param {object}  opts
 * @param {number}  [opts.seed=1]               Controls per-wafer variation.
 * @param {boolean} [opts.edgeFail=false]        Adds a strong failure band in the outer ring (r > 72%).
 * @param {boolean} [opts.quadrant=false]        Smooth NE→SW Vth process tilt (high NE → USL fails, low SW → LSL fails) with a mild NE-corner yield droop.
 * @param {boolean} [opts.center=false]          Small defect cluster at the wafer centre.
 * @param {boolean} [opts.reticlePattern=false]  Repeating field-position defect pattern.
 * @param {boolean} [opts.cluster=false]         Tight failure cluster (~8 dies) simulating a particle/ESD event.
 * @param {boolean} [opts.edgeArc=false]         Short failure arc near the wafer edge (~NNW) simulating handling damage.
 * @param {number}  [opts.siteCount=0]           When > 0, assigns siteNum (1-based) in a repeating grid of this
 *                                               many sites. 4 → 2×2 tile; 8 → 4×2 tile; use with siteFail to
 *                                               inject a per-site yield defect.
 * @param {number}  [opts.siteFail=0]            Site number (1-based) to inject a yield loss on (~20 pp drop).
 *                                               Ignored when siteCount=0.
 * @param {boolean} [opts.includePartId=false]   When true, adds partId (1-based probe step counter, row order).
 * @param {number}  [opts.waferIndex]             When given, applies that wafer's process-split Vth bias
 *                                                (see `splitForWafer`/`SPLIT_VTH_BIAS`). Pair it with
 *                                                `makeWaferConfig(waferIndex)`, which stamps the matching
 *                                                `processSplit` metadata — the two must agree or the chart
 *                                                will group wafers by a label their data does not reflect.
 * @returns {Array<{x,y,hbin,sbin,testValues,testPass,siteNum?,partId?}>}
 */
export function makeResults({
  seed            = 1,
  edgeFail        = false,
  quadrant        = false,
  center          = false,
  reticlePattern  = false,
  cluster         = false,
  edgeArc         = false,
  siteCount       = 0,
  siteFail        = 0,
  includePartId   = false,
  waferIndex,
} = {}) {
  const vthBias = waferIndex === undefined ? 0 : (SPLIT_VTH_BIAS[splitForWafer(waferIndex)] ?? 0);
  // Physical die pitch and wafer radius in mm.
  // Grid sweeps enough index steps to cover the full wafer in each direction.
  const pitchX = 8, pitchY = 12, waferRadius = 150;
  const iMax = Math.ceil(waferRadius / pitchX);
  const jMax = Math.ceil(waferRadius / pitchY);
  // In practice partial dies (straddling the wafer edge) are never probed —
  // the prober map plan excludes them. Enforce that here by requiring the
  // die centre to be at least one half-diagonal inside the wafer boundary.
  const halfDiag = Math.hypot(pitchX / 2, pitchY / 2);

  const results = [];
  let partIdCounter = 1;

  // Pre-compute site grid dimensions for siteCount > 0.
  // Sites are assigned by tiling a (cols × rows) grid over die coordinates.
  // siteCount 4 → 2×2; siteCount 8 → 4×2; other values → 1×siteCount fallback.
  const siteCols = siteCount === 4 ? 2 : siteCount === 8 ? 4 : siteCount;
  const siteRows = siteCount === 4 ? 2 : siteCount === 8 ? 2 : 1;

  for (let i = -iMax; i <= iMax; i++) {
    for (let j = -jMax; j <= jMax; j++) {
      // Physical distance from wafer centre — used for all spatial patterns.
      const rMm = Math.hypot(i * pitchX, j * pitchY);
      if (rMm + halfDiag > waferRadius) continue;

      const t = rMm / waferRadius; // normalised radial position [0, 1]

      // Physical die position in mm (used by the smooth spatial pattern below).
      const xMm = i * pitchX, yMm = j * pitchY;

      // Smooth NE→SW process tilt: a single linear gradient across the wafer (like
      // real implant-angle / anneal non-uniformity), NOT a localised blob and not a
      // hard quadrant step. `tilt` runs ~ -1 at the SW corner to ~ +1 at the NE
      // corner, smoothly. It drives Vth high toward the NE (→ USL fails) and low
      // toward the SW (→ LSL fails), and is reused (attenuated) for the yield and
      // Idsat coupling so the high-Vth corner also reads as slightly weaker silicon.
      const tilt = quadrant ? (xMm + yMm) / (2 * waferRadius) : 0;

      // Independent noise samples
      const n1 = rng(i, j, seed);
      const n2 = rng(i, j, seed + 37);
      const n3 = rng(i, j, seed + 89);
      const roll = rng(i, j, seed + 200);

      // Base pass probability: ~97% at centre, falls to ~88% at the edge (~8% wafer-wide failure rate).
      // The tighter noise term (0.04 vs previous 0.06) avoids spatially-correlated noise clusters
      // that could produce false-positive cluster findings when no cluster pattern is injected.
      let pass = 0.97 * Math.exp(-t * 1.3)
               + 0.88 * (1 - Math.exp(-t * 1.3))
               + (n1 - 0.5) * 0.04;

      // Optional failure patterns
      if (edgeFail  && t > 0.72)            pass -= 0.22; // outer ring yield loss
      if (quadrant)                         pass -= 0.10 * Math.max(0, tilt); // mild NE-corner yield droop (smooth)
      if (center    && t < 0.22)            pass -= 0.20; // centre defect cluster
      if (cluster   && Math.hypot(i + 5, j + 3) < 2.5)  pass -= 0.80; // particle/ESD cluster (SW, away from NE drift)
      if (edgeArc) {
        // Short arc near the top-left edge (~NNW direction)
        const dieAngle = Math.atan2(j * pitchY, i * pitchX);
        const targetAngle = Math.atan2(1, -0.4); // ~NNW
        const angleDiff = Math.abs(((dieAngle - targetAngle + 3 * Math.PI) % (2 * Math.PI)) - Math.PI);
        if (t > 0.78 && angleDiff < 0.44)         pass -= 0.65; // handling/chucking arc
      }
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
      //   Idsat: drive current peaks at centre, drops toward edge; the high-Vth NE
      //   corner reads as slightly weaker drive current.
      const idsatBase = 1.5e-3 * (1 - t * 0.35);
      const idsatTilt = -0.10e-3 * tilt;
      const idsat = idsatBase + idsatTilt + (n2 - 0.5) * 0.18e-3;

      //   Vth: a gentle centre-to-edge rise plus the smooth NE→SW process tilt —
      //   high toward the NE (→ USL fails), low toward the SW (→ LSL fails). The
      //   tilt is a single across-wafer gradient, so out-of-spec dies form soft,
      //   irregular corner patches rather than a blob or a hard quadrant block.
      const vth = 0.490 + t * 0.02 + 0.095 * tilt + (n3 - 0.5) * 0.028 + vthBias;

      //   Ioff: off-state leakage grows exponentially toward edge
      const ioff = 8e-12 * Math.exp(t * 2.1) * (1 + (n1 - 0.5) * 0.4);

      // Continuity: a functional (pass/fail-only) probe-contact test, no measured
      // value. Physically motivated: probe-pin contact quality degrades toward the
      // wafer edge, so pass rate drops there (~97.5% interior, ~80% outer ring).
      const continuityRoll = rng(i, j, seed + 900);
      const continuityPassProb = t > 0.82 ? 0.80 : 0.975;
      const continuityPass = continuityRoll < continuityPassProb;

      // Compute siteNum and partId when requested.
      let siteNum, partId;
      if (siteCount > 0) {
        const col = ((i % siteCols) + siteCols) % siteCols;
        const row = ((j % siteRows) + siteRows) % siteRows;
        siteNum = col + row * siteCols + 1; // 1-based
        // Inject a yield loss on the target site.
        if (siteFail > 0 && siteNum === siteFail) pass -= 0.20;
        pass = Math.max(0.04, Math.min(0.97, pass));
        // Re-resolve hbin/sbin after site-induced pass adjustment.
        if (roll < pass) {
          hbin = 1; sbin = 10;
        } else {
          const which = rng(i, j, seed + 400);
          if      (which < 0.45) { hbin = 2; sbin = 20; }
          else if (which < 0.75) { hbin = 3; sbin = 11; }
          else                   { hbin = 4; sbin = 21; }
        }
      }
      if (includePartId) {
        partId = partIdCounter++;
      }

      // Tester-recorded verdicts for the PARAMETRIC tests, separate from their
      // measured values. In STDF these are the PTR's own TEST_FLG pass/fail bits,
      // which exist whether or not LO_LIMIT/HI_LIMIT were exported — so "did it
      // fail the limits" and "did the tester fail it" are two different questions
      // over the same test, and the Insights pass-rate chart offers both.
      //
      // Modelled the way they actually diverge in production: the tester applies a
      // GUARD BAND tighter than the limits in the datasheet, to protect against
      // measurement uncertainty. A die measuring just inside the exported limits
      // is therefore failed by the tester. Those dies are exactly the population
      // the chart's "N dies judged differently" note exists to surface — without
      // them the feature has nothing to show.
      const vthGuardLow  = TEST_DEFS_VTH_LIMITS.low  + VTH_GUARD_BAND;
      const vthGuardHigh = TEST_DEFS_VTH_LIMITS.high - VTH_GUARD_BAND;
      const vthTesterPass = vth >= vthGuardLow && vth <= vthGuardHigh;
      // Idsat's tester verdict agrees with its limit exactly — one test that
      // diverges and one that does not, so the note reads as a real signal about
      // Vth rather than a blanket property of the dataset.
      const idsatTesterPass = idsat >= IDSAT_LSL;

      const die = {
        x: i, y: j, hbin, sbin,
        testValues: { 1050: idsat, 1060: vth, 1070: ioff },
        testPass:   { 1050: idsatTesterPass, 1060: vthTesterPass, 1080: continuityPass },
      };
      if (siteNum !== undefined) die.siteNum = siteNum;
      if (partId  !== undefined) die.partId  = partId;
      results.push(die);
    }
  }

  return results;
}

// ── Shared definitions ────────────────────────────────────────────────────────

/** Vth spec window, named so the generator's guard-band maths and `TEST_DEFS`
 *  below cannot drift apart. */
const TEST_DEFS_VTH_LIMITS = { low: 0.44, high: 0.57 };

/** How much tighter the tester's own Vth criterion is than the exported spec
 *  (volts, each side). This is the entire source of the spec-vs-tester
 *  disagreement in the demo data — set it to 0 and the two modes agree exactly. */
const VTH_GUARD_BAND = 0.008;

/** Idsat lower spec limit (A). Drive current falls toward the wafer edge, so this
 *  fails an outer band — giving the spec pass-rate chart a second ranked row
 *  instead of the single Vth row it had when Vth was the only limited test. */
const IDSAT_LSL = 0.95e-3;

/** Ioff upper spec limit (A). Leakage grows exponentially toward the edge. */
const IOFF_USL = 6e-11;

/**
 * Hard bin names and brand colours.
 * Bin 1 = Pass; bins 2–4 are failure categories as assigned by the test program handler.
 */
export const HBIN_DEFS = [
  { bin: 1, name: 'Pass'          },
  { bin: 2, name: 'Contact Open'  },
  { bin: 3, name: 'Vth - Hi'      },
  { bin: 4, name: 'Leakage'       },
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
 *
 * All three carry spec limits: with limits on Vth alone the Insights pass-rate
 * chart could only ever draw one row, which shows the mechanism but not the
 * pareto it is meant to be. With `quadrant: true` a smooth NE→SW process tilt
 * additionally runs Vth high toward the NE (USL fails) and low toward the SW
 * (LSL fails), so that wafer shows both out-of-spec sides.
 *
 * Every die also carries a tester-recorded verdict for Idsat and Vth (see
 * `makeResults`), so the chart's "Tester flag" mode has data too — and Vth's
 * guard band makes the two parametric modes disagree, which is the case the
 * disagreement note exists for.
 */
export const TEST_DEFS = [
  { testNumber: 1050, name: 'Idsat', unit: 'A', limitLow: IDSAT_LSL },
  { testNumber: 1060, name: 'Vth',   unit: 'V', limitLow: TEST_DEFS_VTH_LIMITS.low, limitHigh: TEST_DEFS_VTH_LIMITS.high },
  { testNumber: 1070, name: 'Ioff',  unit: 'A', limitHigh: IOFF_USL },
];

/**
 * Functional (pass/fail-only) test — every die from `makeResults` carries a
 * `testPass[1080]` verdict, but this def is kept separate from `TEST_DEFS` so
 * existing demos that pass `testDefs: TEST_DEFS` are unaffected. Opt in with
 * `testDefs: [...TEST_DEFS, FUNCTIONAL_TEST_DEF]` to exercise functional-test
 * rendering (forced `passFailDisplay: 'test'`) and `stats.functionalYield`.
 */
export const FUNCTIONAL_TEST_DEF = { testNumber: 1080, name: 'Continuity', testType: 'F' };

/** Standard 300 mm production wafer with bottom notch. */
export const WAFER_CONFIG = {
  diameter: 300,
  notch: { type: 'bottom' },
  // waferId (not a bare "wafer" key) — the canonical WaferMetadata field.
  // The Insights tab's facet table specifically excludes waferId from its
  // "Group by"/mixed-population checks (it's unique per wafer by
  // definition, never a useful grouping axis) — a non-canonical key would
  // leak through as a bogus "mixed" facet instead.
  metadata: { lot: 'LOT-DEMO', product: 'DEMO-DEVICE', waferId: 'W01' },
};

/**
 * Build a wafer config for a specific wafer in a lot.
 * @param {number} index  0-based wafer index.
 */
export function makeWaferConfig(index) {
  const n = String(index + 1).padStart(2, '0');
  return {
    ...WAFER_CONFIG,
    metadata: {
      ...WAFER_CONFIG.metadata,
      waferId: `W${n}`,
      // The lot's groupable axis. Pair with `makeResults({ waferIndex: index })`
      // so the wafer's data actually reflects the split it is labelled with.
      processSplit: splitForWafer(index),
    },
  };
}

/** 8 mm × 12 mm die pitch — realistic rectangular die for a leading-edge logic device. */
export const DIE_CONFIG = { width: 8, height: 12 };
