// Synthetic multi-project-wafer (MPW) layouts for the compact-view detector tests.
//
// There is no real MPW data to tune against, so these layouts are the spec. Every
// generator returns plain `{ x, y }` grid positions (the dies that EXIST on the wafer,
// whether or not they carry a bin), in original die-grid coordinates centred on (0, 0).

/** Deterministic PRNG (mulberry32) so a failing layout reproduces. */
export function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const mod = (n, m) => ((n % m) + m) % m;

const inside = (x, y, radiusX, radiusY) => (x * x) / (radiusX * radiusX) + (y * y) / (radiusY * radiusY) <= 1;

/** Every grid position inside the wafer ellipse. */
export function fullWaferDies({ radiusX = 47, radiusY = 44 } = {}) {
  const dies = [];
  for (let y = -radiusY; y <= radiusY; y++) {
    for (let x = -radiusX; x <= radiusX; x++) {
      if (inside(x, y, radiusX, radiusY)) dies.push({ x, y });
    }
  }
  return dies;
}

export const PERIOD_X = 12;
export const PERIOD_Y = 8;

/**
 * A reticle cluster: a block of 5 dies by 2, plus a single die alone on a third row at the
 * right (the kind of position that carries metadata only, with no test or bin data).
 */
export const GENERIC_CLUSTER = [
  ...Array.from({ length: 10 }, (_, i) => ({ dx: i % 5, dy: Math.floor(i / 5) })),
  { dx: 4, dy: 2 },
];

/**
 * An MPW wafer: a reticle repeating every `periodX` columns and `periodY` rows, with
 * `cluster` (cell offsets within the reticle) occupied, clipped by the wafer ellipse so
 * edge reticles are truncated. `dropout` removes that fraction of the remaining dies at
 * random.
 *
 * `offsetX`/`offsetY` slide the lattice against the wafer centre; the defaults are
 * arbitrary, so no fixture is accidentally symmetric about the origin.
 */
export function mpwDies({
  periodX = PERIOD_X, periodY = PERIOD_Y, cluster = GENERIC_CLUSTER,
  radiusX = 47, radiusY = 44, offsetX = 3, offsetY = 2,
  dropout = 0, seed = 1,
} = {}) {
  const wanted = new Set(cluster.map(c => `${c.dx},${c.dy}`));
  const rand = seeded(seed);
  const dies = [];
  for (const { x, y } of fullWaferDies({ radiusX, radiusY })) {
    if (!wanted.has(`${mod(x - offsetX, periodX)},${mod(y - offsetY, periodY)}`)) continue;
    if (dropout > 0 && rand() < dropout) continue;
    dies.push({ x, y });
  }
  return dies;
}

/**
 * Dies on a random subset of columns and rows: the same occupied fraction per axis as an
 * MPW, with none of its structure. (Scattering dies at random instead would touch every
 * column and row of a wafer this size, leaving nothing to compact: a trivial negative.)
 */
export function randomSparseDies({ columnFraction = 0.4, rowFraction = 0.33, radiusX = 47, radiusY = 44, seed = 1 } = {}) {
  const rand = seeded(seed);
  const columns = new Set();
  const rows = new Set();
  for (let x = -radiusX; x <= radiusX; x++) if (rand() < columnFraction) columns.add(x);
  for (let y = -radiusY; y <= radiusY; y++) if (rand() < rowFraction) rows.add(y);
  return fullWaferDies({ radiusX, radiusY }).filter(d => columns.has(d.x) && rows.has(d.y));
}

/** `dies` with every die in the given fraction of its occupied columns removed: whole reticle columns missing. */
export function withoutColumns(dies, fraction, seed = 1) {
  const rand = seeded(seed);
  const gone = new Set(occupied(dies, 'x').filter(() => rand() < fraction));
  return dies.filter(d => !gone.has(d.x));
}

/** Sorted distinct values of one axis: the "occupied indices" the detector consumes. */
export function occupied(dies, axis) {
  return [...new Set(dies.map(d => d[axis]))].sort((a, b) => a - b);
}
