// Synthetic lots for the synthesis suite: a deterministic generator whose every dimension is a knob,
// so one spec can be rebuilt with its bins relabelled, carried as soft bins instead of hard, rotated,
// reordered or stripped of its test limits, and the results compared. The data is generic and invented:
// it imitates no real product, program or customer layout.
//
// A spec describes a lot in logical bins: 1 is the pass bin, 2 an optional second pass grade, and 3 and up
// are failures. `binScheme` decides how they reach the dies (hard and soft, hard only, soft only, none)
// and `binMap` what numbers they carry, so the same lot can be judged by pass bins [1], [3, 5] or [1, 2].

import { buildWaferMap } from '../../dist/index.js';

/** mulberry32: a small seeded generator, so a case builds the same dies every run. */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const hash = (s) => [...s].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0, 2166136261);
/** A normal deviate (Box–Muller). */
const normal = (r) => Math.sqrt(-2 * Math.log(1 - r())) * Math.cos(2 * Math.PI * r());

/** Grid radius in dies; with a 5 mm pitch the 210 mm wafer holds every die whole. */
export const RADIUS = 20;
const PITCH = 5;
const DIAMETER = 210;

/**
 * Where a signature lies, on the die grid. `r` is the distance from the centre as a fraction of the grid
 * radius. Each is a plain spatial shape, the kind a fab sees on any product.
 */
const REGIONS = {
  'edge-ring': (x, y, r) => r > 0.85,
  'quadrant-NE': (x, y) => x > 0 && y > 0,
  'quadrant-SW': (x, y) => x < 0 && y < 0,
  centre: (x, y, r) => r < 0.3,
  donut: (x, y, r) => r > 0.4 && r < 0.6,
  scratch: (x, y) => Math.abs(y - 0.6 * x - 2) < 0.9 && x > -12 && x < 14,
  cluster: (x, y) => Math.hypot(x - 8, y + 6) < 3.5,
  'edge-arc-N': (x, y, r) => r > 0.8 && y > 0 && Math.abs(x) < y * 0.6,
  // Straddles due east, where an angle in [0°, 360°) wraps from 359° to 0°.
  'edge-arc-E': (x, y, r) => r > 0.8 && x > 0 && Math.abs(y) < x * 0.6,
  // Exactly the north-east and north sectors of eight (22.5° to 112.5°), away from the centre.
  'sectors-NE-N': (x, y, r) => r > 0.3 && ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360 >= 22.5 && ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360 < 112.5,
  'scratch-diagonal': (x, y) => Math.abs(y - x) < 0.8 && x > -13 && x < 13,
  'scratch-steep': (x, y) => Math.abs(x - 0.35 * y + 3) < 0.8 && y > -14 && y < 14,
  everywhere: () => true,
};
export const REGION_NAMES = Object.keys(REGIONS);

/** Bin names, by logical bin. Generic failure classes, not any program's list. */
const BIN_NAMES = { 1: 'Pass', 2: 'Pass grade B', 3: 'Open', 4: 'Short', 5: 'Leakage', 6: 'Speed', 7: 'Functional' };

/**
 * @typedef {object} Signature  a failure mode laid on some wafers
 * @property {keyof typeof REGIONS} region
 * @property {number} p          probability that a die in the region fails
 * @property {number} bin        logical fail bin it gets
 * @property {number[] | 'all'} [on]  wafer indices it is on (default all)
 *
 * @typedef {object} TestFailure  dies a test fails
 * @property {number} test        test number
 * @property {keyof typeof REGIONS} region
 * @property {number} p
 * @property {'low' | 'high'} [side]  for a parametric test (default low)
 * @property {number | 'pass'} binning  the logical bin a failing die is given, or 'pass' to leave it as it is
 *
 * @typedef {object} LotSpec
 * @property {string} name
 * @property {number} wafers
 * @property {'hard+soft' | 'hard' | 'soft' | 'none'} [binScheme]
 * @property {number} [baseRate]  scattered fails on every wafer (bins 3–4)
 * @property {Signature[]} [signatures]
 * @property {{ wafer: number, extra: number }} [outlier]  one wafer with more scattered fails
 * @property {number} [drift]  added to the scattered rate per wafer, in input order
 * @property {number} [gradeB]  share of good dies given logical bin 2 (a second pass grade)
 * @property {boolean} [passGradeB]  whether bin 2 is a pass bin (default: true when gradeB is set)
 * @property {Record<number, number>} [binMap]  logical bin → the number the dies carry (default identity)
 * @property {'parametric' | 'functional' | 'both' | 'none'} [tests]
 * @property {TestFailure[]} [testFailures]
 * @property {boolean} [limits]  whether the test definitions carry their limits (default true)
 * @property {0 | 90 | 180 | 270} [rotate]  rotate every die about the centre, counter-clockwise
 * @property {boolean} [mirror]  mirror every die left to right (after any rotation)
 * @property {boolean} [shuffle]  give each wafer's results in a shuffled order
 * @property {boolean} [holeAtCentre]  leave out the one die at the centre, the only die no quarter turn moves:
 *   with it gone a quarter turn maps every quadrant, sector and ring exactly onto another
 * @property {boolean} [reverse]  reverse the wafers' input order
 */

export const PARAMETRIC = [
  { testNumber: 101, name: 'VT', unit: 'V', mean: 0.45, sd: 0.02, limitLow: 0.38, limitHigh: 0.52 },
  { testNumber: 102, name: 'IDSAT', unit: 'mA', mean: 5.0, sd: 0.25, limitLow: 4.2, limitHigh: 5.8 },
  { testNumber: 103, name: 'RING_OSC', unit: 'MHz', mean: 820, sd: 18, limitLow: 760 },
];
export const FUNCTIONAL = [{ testNumber: 201, name: 'SCAN', testType: 'F' }];

/** The test definitions a spec's wafers carry. */
export function testDefsOf(spec) {
  const kind = spec.tests ?? 'none';
  const p = kind === 'parametric' || kind === 'both'
    ? PARAMETRIC.map(({ mean: _m, sd: _s, ...d }) => (spec.limits === false ? { testNumber: d.testNumber, name: d.name, unit: d.unit } : d))
    : [];
  const f = kind === 'functional' || kind === 'both' ? FUNCTIONAL : [];
  return [...p, ...f];
}

const onWafer = (on, w) => on === undefined || on === 'all' || on.includes(w);

/** Logical pass bins of a spec. */
export const logicalPassBins = (spec) => (spec.gradeB && spec.passGradeB !== false ? [1, 2] : [1]);
/** The pass bins the dies are judged by, after `binMap`. */
export const passBinsOf = (spec) => logicalPassBins(spec).map(b => spec.binMap?.[b] ?? b);

/**
 * The raw results of a spec, one entry per wafer in input order (`wafer` is its own number, which `reverse`
 * does not change), in logical bins (before `binMap` and `binScheme`), with each die's test values. Kept
 * apart from the build so a test can recompute a figure from the same dies.
 */
export function logicalWafers(spec) {
  const r = rng(hash(spec.name));
  const tests = testDefsOf(spec);
  const params = PARAMETRIC.filter(p => tests.some(t => t.testNumber === p.testNumber));
  const functional = tests.some(t => t.testNumber === 201);
  const out = [];
  for (let w = 0; w < spec.wafers; w++) {
    const dies = [];
    for (let x = -RADIUS; x <= RADIUS; x++) {
      for (let y = -RADIUS; y <= RADIUS; y++) {
        if (Math.hypot(Math.abs(x) + 0.5, Math.abs(y) + 0.5) > RADIUS + 1) continue;
        if (spec.holeAtCentre && x === 0 && y === 0) continue;
        const rr = Math.hypot(x, y) / RADIUS;
        let bin = 1;
        const rate = (spec.baseRate ?? 0.02) + (spec.drift ?? 0) * w + (spec.outlier?.wafer === w ? spec.outlier.extra : 0);
        if (r() < rate) bin = r() < 0.5 ? 3 : 4;
        for (const s of spec.signatures ?? []) {
          if (onWafer(s.on, w) && REGIONS[s.region](x, y, rr) && r() < s.p) bin = s.bin;
        }
        if (bin === 1 && spec.gradeB && r() < spec.gradeB) bin = 2;
        const testValues = {};
        for (const p of params) testValues[p.testNumber] = +(p.mean + p.sd * normal(r)).toFixed(4);
        const testPass = functional ? { 201: true } : undefined;
        for (const f of spec.testFailures ?? []) {
          if (!REGIONS[f.region](x, y, rr) || r() >= f.p) continue;
          const p = PARAMETRIC.find(q => q.testNumber === f.test);
          if (p && f.test in testValues) {
            testValues[f.test] = f.side === 'high' ? +(p.limitHigh + p.sd * (1 + r())).toFixed(4) : +(p.limitLow - p.sd * (1 + r())).toFixed(4);
          } else if (f.test === 201 && testPass) testPass[201] = false;
          else continue;
          if (f.binning !== 'pass') bin = f.binning;
        }
        dies.push({ x, y, bin, testValues, testPass });
      }
    }
    out.push({ wafer: w, dies });
  }
  return spec.reverse ? out.reverse() : out;
}

/** A logical bin as the dies carry it: its hard bin and its soft bin (hard × 10, plus a variant for fails). */
function carried(spec, bin, x, y) {
  const n = spec.binMap?.[bin] ?? bin;
  const scheme = spec.binScheme ?? 'hard+soft';
  const soft = bin <= 2 ? n * 10 : n * 10 + ((x + y) & 1);
  if (scheme === 'none') return {};
  if (scheme === 'hard') return { hbin: n };
  if (scheme === 'soft') return { sbin: n };
  return { hbin: n, sbin: soft };
}

const binDefs = (spec, soft) => Object.entries(BIN_NAMES).flatMap(([b, name]) => {
  const n = spec.binMap?.[b] ?? Number(b);
  return soft && (spec.binScheme ?? 'hard+soft') === 'hard+soft'
    ? [{ bin: n * 10, name }, { bin: n * 10 + 1, name: `${name} (alt)` }]
    : [{ bin: n, name }];
});

/** Where a logical die lands after the spec's rotation and mirror: the transform the metamorphic tests undo. */
export function placeDie(x, y, spec) {
  let p = [x, y];
  for (let q = 0; q < ((spec.rotate ?? 0) / 90) % 4; q++) p = [-p[1], p[0]];
  if (spec.mirror) p = [-p[0], p[1]];
  return p;
}

/** Fisher–Yates with the given generator. */
function shuffled(items, r) {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** The spec's wafers, built. */
export function buildLot(spec) {
  const testDefs = testDefsOf(spec);
  const scheme = spec.binScheme ?? 'hard+soft';
  return logicalWafers(spec).map(({ wafer, dies }) => {
    const placed = dies.map(({ x, y, bin, testValues, testPass }) => {
      const [rx, ry] = placeDie(x, y, spec);
      return {
        x: rx, y: ry, ...carried(spec, bin, rx, ry),
        ...(testDefs.some(t => t.testType !== 'F') ? { testValues } : {}),
        ...(testPass ? { testPass } : {}),
      };
    });
    const results = spec.shuffle ? shuffled(placed, rng(hash(`${spec.name}:order:${wafer}`))) : placed;
    return buildWaferMap({
      results,
      waferConfig: { diameter: DIAMETER, notch: { type: 'bottom' }, metadata: { lot: spec.name, waferId: `W${String(wafer + 1).padStart(2, '0')}` } },
      dieConfig: { width: PITCH, height: PITCH },
      ...(scheme === 'hard' || scheme === 'hard+soft' ? { hbinDefs: binDefs(spec, false) } : {}),
      ...(scheme === 'soft' ? { sbinDefs: binDefs(spec, false) } : scheme === 'hard+soft' ? { sbinDefs: binDefs(spec, true) } : {}),
      ...(testDefs.length ? { testDefs } : {}),
      passBins: passBinsOf(spec),
      ringCount: 4,
    });
  });
}
