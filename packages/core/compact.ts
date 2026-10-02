import { hasPosition } from './dies.js';

/**
 * Detection of a repeating multi-project-wafer (MPW) layout, the gate for the compact view.
 *
 * On an MPW only a few parts sit in each reticle, so the occupied columns and rows form a
 * pattern that repeats at the reticle pitch. Random missing data does not repeat, which is
 * what separates the two: hiding the empty rows of a wafer that merely has holes could hide
 * a real problem, so compaction is only offered when a clear period is found.
 *
 * "Occupied" means a die EXISTS at that index, whether or not it carries a bin: a die with
 * only metadata still has a position, and the layout must not change with the colour mode.
 */

export interface MpwDetectOptions {
  /** Fewest whole repeats of the period the axis must span. Default 3. */
  minRepeats?: number;
  /**
   * Lowest lag correlation of the occupancy signal that counts as a period. Default 0.75:
   * random sparse layouts score under 0.5 at every lag, while a clean MPW with a few
   * reticle columns missing outright still scores above it.
   */
  minScore?: number;
  /** Occupied fraction above which an axis is dense: nothing worth compacting. Default 0.8. */
  maxDensity?: number;
  /**
   * A unit the host already knows, such as a reticle width or height in dies. Only that unit and
   * its multiples are tested (devices on every second reticle repeat at twice the reticle, a
   * cluster that repeats within a reticle at a divisor of it, which the multiples reach too), so
   * the check still has to pass (the occupied indices must actually repeat) but nothing else is
   * inferred.
   */
  expectedPeriod?: number;
}

/** A period found on one axis. */
export interface MpwPeriod {
  /** Indices between one repeat and the next. */
  period: number;
  /** Lag correlation of the occupancy signal at `period`, 0 to 1. */
  score: number;
  /** Whole repeats of the period within the occupied span. */
  repeats: number;
  /** Occupied indices as a fraction of the span between the first and last. */
  occupiedFraction: number;
}

const DEFAULTS: Required<Omit<MpwDetectOptions, 'expectedPeriod'>> = { minRepeats: 3, minScore: 0.75, maxDensity: 0.8 };

/** Pearson correlation of `v[i]` with `v[i + lag]`; 0 when either side has no variance. */
function lagCorrelation(v: Uint8Array, lag: number): number {
  const n = v.length - lag;
  if (n < 2) return 0;
  let sa = 0, sb = 0, saa = 0, sbb = 0, sab = 0;
  for (let i = 0; i < n; i++) {
    const a = v[i], b = v[i + lag];
    sa += a; sb += b; saa += a * a; sbb += b * b; sab += a * b;
  }
  const varA = saa - (sa * sa) / n;
  const varB = sbb - (sb * sb) / n;
  if (varA <= 0 || varB <= 0) return 0;
  return (sab - (sa * sb) / n) / Math.sqrt(varA * varB);
}

/**
 * The periods worth testing on an axis `span` indices long: every lag from 2 up, or, when the host
 * knows a unit (a reticle size), that unit and its multiples. A period must leave room for
 * `minRepeats` repeats.
 */
function candidatePeriods(span: number, minRepeats: number, unit?: number): number[] {
  const last = Math.floor(span / minRepeats);
  const periods: number[] = [];
  if (unit !== undefined && unit >= 1) {
    const step = Math.floor(unit);
    for (let p = step; p <= last; p += step) if (p >= 2) periods.push(p);
  } else {
    for (let p = 2; p <= last; p++) periods.push(p);
  }
  return periods;
}

function occupancy(indices: readonly number[]): { signal: Uint8Array; count: number } | null {
  if (indices.length === 0) return null;
  let lo = Infinity, hi = -Infinity;
  for (const i of indices) {
    if (i < lo) lo = i;
    if (i > hi) hi = i;
  }
  const signal = new Uint8Array(hi - lo + 1);
  let count = 0;
  for (const i of indices) {
    if (!signal[i - lo]) { signal[i - lo] = 1; count++; }
  }
  return { signal, count };
}

/**
 * Find the smallest period at which the occupied indices of one axis repeat.
 *
 * `indices` are the distinct integer indices that hold at least one die, in any order.
 * Returns `null` when the axis is nearly full (nothing to compact), spans too few repeats,
 * or does not repeat: random sparse data scores near zero at every period.
 */
export function detectMpwPeriod(
  indices: readonly number[],
  options: MpwDetectOptions = {},
): MpwPeriod | null {
  const { minRepeats, minScore, maxDensity } = { ...DEFAULTS, ...options };
  const { expectedPeriod } = options;
  const occ = occupancy(indices);
  if (!occ) return null;
  const span = occ.signal.length;
  const occupiedFraction = occ.count / span;
  if (occupiedFraction > maxDensity) return null;
  for (const period of candidatePeriods(span, minRepeats, expectedPeriod)) {
    const score = lagCorrelation(occ.signal, period);
    if (score >= minScore) {
      return { period, score, repeats: Math.floor(span / period), occupiedFraction };
    }
  }
  return null;
}

/** What one axis looks like for the purposes of the compact gate. */
export type AxisPattern =
  | ({ kind: 'periodic' } & MpwPeriod)
  | { kind: 'dense'; occupiedFraction: number }
  | { kind: 'none' };

export interface MpwLayout {
  x: AxisPattern;
  y: AxisPattern;
  /** True when compaction should be offered. */
  offered: boolean;
}

function classifyAxis(indices: readonly number[], options: MpwDetectOptions): AxisPattern {
  const { minRepeats, maxDensity } = { ...DEFAULTS, ...options };
  const period = detectMpwPeriod(indices, options);
  if (period) return { kind: 'periodic', ...period };
  const occ = occupancy(indices);
  // A dense axis only counts when it is a real run of indices: a single occupied column is
  // "full" trivially and says nothing about the layout.
  if (occ && occ.count >= minRepeats && occ.count / occ.signal.length > maxDensity) {
    return { kind: 'dense', occupiedFraction: occ.count / occ.signal.length };
  }
  return { kind: 'none' };
}

/**
 * Decide whether the compact view applies to a set of dies.
 *
 * Offered when both axes repeat, or one repeats and the other is dense (a layout that is
 * sparse in one direction only still has empty rows or columns worth removing). Pass the
 * dies of every wafer in the selection, so the answer, and the layout built from it, is
 * the same for every card in a gallery. Unpositioned dies are ignored.
 */
export function detectMpwLayout(
  dies: readonly { x?: number | null; y?: number | null }[],
  options: Omit<MpwDetectOptions, 'expectedPeriod'> & { reticle?: { width: number; height: number } } = {},
): MpwLayout {
  const { reticle, ...detect } = options;
  const xs = new Set<number>();
  const ys = new Set<number>();
  for (const die of dies) {
    if (!hasPosition(die)) continue;
    xs.add(die.x);
    ys.add(die.y);
  }
  // A host-supplied reticle fixes the period, but the occupied indices must still repeat at it:
  // a sparse layout that does not is not offered, whatever the host asserts.
  const x = classifyAxis([...xs], { ...detect, expectedPeriod: reticle?.width });
  const y = classifyAxis([...ys], { ...detect, expectedPeriod: reticle?.height });
  const offered =
    (x.kind === 'periodic' && (y.kind === 'periodic' || y.kind === 'dense')) ||
    (y.kind === 'periodic' && x.kind === 'dense');
  return { x, y, offered };
}

/**
 * The compact layout of a set of dies: which original columns and rows survive, and the
 * indices they take. Only the layout, never the dies themselves, so one map can be built
 * from every wafer in a selection and applied to each, giving all gallery cards one grid.
 */
export interface CompactMap {
  /** Original die `x` of each compact column, ascending. All coordinates shown to a user are these. */
  readonly columns: readonly number[];
  /** Original die `y` of each compact row, ascending. */
  readonly rows: readonly number[];
  /** Compact columns that follow a skipped range of original columns (so a group of columns starts there). */
  readonly columnBreaks: readonly number[];
  /** Compact rows that follow a skipped range of original rows. */
  readonly rowBreaks: readonly number[];
  /**
   * The blocks the layout falls into: each is a run of compact columns and a run of compact
   * rows, `[start, end)`, with no skipped original index inside either, and at least one
   * die of the layout in it. On an MPW these are the reticle groups the dies sit in, so
   * drawing each as a box keeps them distinct once the gaps between them are gone.
   */
  readonly groups: readonly CompactGroup[];
  /** Compact column of an original `x`, or `undefined` when no die of the layout sits in it. */
  columnOf(x: number): number | undefined;
  /** Compact row of an original `y`, or `undefined` when no die of the layout sits in it. */
  rowOf(y: number): number | undefined;
}

/** A block of compact cells with no skipped original index inside it; see `CompactMap.groups`. */
export interface CompactGroup {
  readonly columns: readonly [start: number, end: number];
  readonly rows: readonly [start: number, end: number];
}

/** Group id of each compact index: the number of breaks at or before it. */
function groupIds(count: number, breaks: readonly number[]): { ids: Int32Array; bounds: number[] } {
  const bounds = [0, ...breaks, count];
  const ids = new Int32Array(count);
  for (let g = 0; g + 1 < bounds.length; g++) ids.fill(g, bounds[g], bounds[g + 1]);
  return { ids, bounds };
}

function compactAxis(values: Set<number>): { sorted: number[]; breaks: number[]; indexOf: Map<number, number> } {
  const sorted = [...values].sort((a, b) => a - b);
  const breaks: number[] = [];
  const indexOf = new Map<number, number>();
  sorted.forEach((value, i) => {
    indexOf.set(value, i);
    if (i > 0 && value - sorted[i - 1] > 1) breaks.push(i);
  });
  return { sorted, breaks, indexOf };
}

/**
 * Build the compact layout for `dies`: the columns and rows that hold at least one die,
 * renumbered 0..n-1 in order. A die EXISTS there whether or not it carries a bin (see the
 * note at the top of this file), so the layout never depends on colour mode, filters or
 * which wafer has data. Unpositioned dies are ignored.
 */
export function buildCompactMap(dies: readonly { x?: number | null; y?: number | null }[]): CompactMap {
  const xs = new Set<number>();
  const ys = new Set<number>();
  for (const die of dies) {
    if (!hasPosition(die)) continue;
    xs.add(die.x);
    ys.add(die.y);
  }
  const col = compactAxis(xs);
  const row = compactAxis(ys);
  const colGroups = groupIds(col.sorted.length, col.breaks);
  const rowGroups = groupIds(row.sorted.length, row.breaks);
  const occupied = new Set<number>();
  for (const die of dies) {
    if (!hasPosition(die)) continue;
    occupied.add(colGroups.ids[col.indexOf.get(die.x)!] * rowGroups.bounds.length + rowGroups.ids[row.indexOf.get(die.y)!]);
  }
  const groups: CompactGroup[] = [...occupied].sort((a, b) => a - b).map(key => {
    const gc = Math.floor(key / rowGroups.bounds.length);
    const gr = key % rowGroups.bounds.length;
    return {
      columns: [colGroups.bounds[gc], colGroups.bounds[gc + 1]],
      rows: [rowGroups.bounds[gr], rowGroups.bounds[gr + 1]],
    };
  });
  return {
    groups,
    columns: col.sorted,
    rows: row.sorted,
    columnBreaks: col.breaks,
    rowBreaks: row.breaks,
    columnOf: x => col.indexOf.get(x),
    rowOf: y => row.indexOf.get(y),
  };
}

/** A die with the compact cell it is drawn in. */
export interface CompactPlacement<T> {
  die: T;
  column: number;
  row: number;
}

/**
 * Place `dies` on a compact grid. With no `basis` the layout is built from `dies`; pass the
 * dies of every wafer in a selection as `basis` so each wafer lands on the same grid. Every
 * positioned die is placed, none dropped: a die whose column or row is missing from the
 * layout throws, since that is a layout built from the wrong dies, not data to hide.
 */
export function compactDies<T extends { x?: number | null; y?: number | null }>(
  dies: readonly T[],
  basis?: readonly { x?: number | null; y?: number | null }[] | CompactMap,
): { placements: CompactPlacement<T>[]; map: CompactMap } {
  const map = basis && 'columnOf' in basis ? basis : buildCompactMap(basis ?? dies);
  const placements: CompactPlacement<T>[] = [];
  for (const die of dies) {
    if (!hasPosition(die)) continue;
    const column = map.columnOf(die.x);
    const row = map.rowOf(die.y);
    if (column === undefined || row === undefined) {
      throw new RangeError(`compactDies: die (${die.x}, ${die.y}) is outside the compact layout`);
    }
    placements.push({ die, column, row });
  }
  return { placements, map };
}

/**
 * Whether the compact layout should be offered for the dies of one map or of every map in a
 * gallery. The single rule both renderers use: `reticles` holds one entry per map, and a
 * reticle size fixes the period only when every map supplies the same one; otherwise the
 * period is inferred from the dies.
 */
export function compactLayoutOffered(
  dies: readonly { x?: number | null; y?: number | null }[],
  reticles: readonly ({ width: number; height: number } | undefined)[],
  options: Omit<MpwDetectOptions, 'expectedPeriod'> = {},
): boolean {
  return detectMpwLayout(dies, { ...options, reticle: sharedReticle(reticles) }).offered;
}

/** The reticle size every map supplies, or undefined when any map lacks one or they differ. */
function sharedReticle(
  reticles: readonly ({ width: number; height: number } | undefined)[],
): { width: number; height: number } | undefined {
  const first = reticles[0];
  return first && reticles.every(r => r && r.width === first.width && r.height === first.height)
    ? { width: first.width, height: first.height }
    : undefined;
}

/** What the detector saw on one axis. Counts and scores only: no index or coordinate. */
export interface AxisDiagnostics {
  /** Distinct indices that hold a die. */
  occupied: number;
  /** Indices from the first occupied to the last. */
  span: number;
  /** Maximal runs of consecutive occupied indices. */
  runs: number;
  pattern: AxisPattern;
  /** The best-scoring candidate periods, whether or not any passed. */
  bestPeriods: { period: number; score: number }[];
}

export interface MpwDiagnostics {
  wafers: number;
  positionedDies: number;
  unpositionedDies: number;
  /** Blocks of compact cells that hold dies. */
  groups: number;
  reticle: { width: number; height: number } | undefined;
  offered: boolean;
  thresholds: Required<Omit<MpwDetectOptions, 'expectedPeriod'>>;
  columns: AxisDiagnostics;
  rows: AxisDiagnostics;
}

function diagnoseAxis(indices: readonly number[], options: MpwDetectOptions): AxisDiagnostics {
  const { minRepeats } = { ...DEFAULTS, ...options };
  const occ = occupancy(indices);
  if (!occ) return { occupied: 0, span: 0, runs: 0, pattern: { kind: 'none' }, bestPeriods: [] };
  let runs = 0;
  occ.signal.forEach((v, i) => { if (v && !occ.signal[i - 1]) runs++; });
  const scores: { period: number; score: number }[] = [];
  for (const period of candidatePeriods(occ.signal.length, minRepeats, options.expectedPeriod)) {
    scores.push({ period, score: lagCorrelation(occ.signal, period) });
  }
  scores.sort((a, b) => b.score - a.score || a.period - b.period);
  return {
    occupied: occ.count,
    span: occ.signal.length,
    runs,
    pattern: classifyAxis(indices, options),
    bestPeriods: scores.slice(0, 5),
  };
}

/**
 * Everything the compact gate saw, as numbers a host can show a user and ask them to send
 * back. It exists because the detector's thresholds cannot be tuned on data nobody can
 * share, so what it needs to report must carry no die position, bin, value or identity:
 * counts, fractions, scores and periods only. `reticles` holds one entry per map, as for
 * `compactLayoutOffered`, which this agrees with by construction.
 */
export function diagnoseMpwLayout(
  dies: readonly { x?: number | null; y?: number | null }[],
  reticles: readonly ({ width: number; height: number } | undefined)[],
  options: Omit<MpwDetectOptions, 'expectedPeriod'> = {},
): MpwDiagnostics {
  const reticle = sharedReticle(reticles);
  const xs = new Set<number>();
  const ys = new Set<number>();
  let positioned = 0;
  for (const die of dies) {
    if (!hasPosition(die)) continue;
    positioned++;
    xs.add(die.x);
    ys.add(die.y);
  }
  return {
    wafers: reticles.length,
    positionedDies: positioned,
    unpositionedDies: dies.length - positioned,
    groups: buildCompactMap(dies).groups.length,
    reticle,
    offered: detectMpwLayout(dies, { ...options, reticle }).offered,
    thresholds: { ...DEFAULTS, ...options },
    columns: diagnoseAxis([...xs], { ...options, expectedPeriod: reticle?.width }),
    rows: diagnoseAxis([...ys], { ...options, expectedPeriod: reticle?.height }),
  };
}

function formatAxis(name: string, a: AxisDiagnostics): string {
  const pct = a.span > 0 ? ` (${(100 * a.occupied / a.span).toFixed(1)}%)` : '';
  const verdict = a.pattern.kind === 'periodic'
    ? `periodic, period ${a.pattern.period}, score ${a.pattern.score.toFixed(3)}, ${a.pattern.repeats} repeats`
    : a.pattern.kind === 'dense' ? 'dense, nothing to compact' : 'no repeating pattern found';
  const best = a.bestPeriods.length
    ? `\n  best periods: ${a.bestPeriods.map(b => `${b.period} (${b.score.toFixed(3)})`).join(', ')}`
    : '';
  return `${name}: ${a.occupied} occupied of ${a.span}${pct}, ${a.runs} runs; ${verdict}${best}`;
}

/** The text a user copies and sends back. Plain lines, so it can be read before it is sent. */
export function formatMpwDiagnostics(d: MpwDiagnostics, library: string): string {
  return [
    'wafermap compact-layout diagnostics (format 1)',
    `library: ${library}`,
    'Counts and scores only: no die coordinates, bins, test values or wafer identity.',
    `wafers: ${d.wafers}`,
    `dies: ${d.positionedDies} positioned, ${d.unpositionedDies} without a position`,
    `reticle size: ${d.reticle ? `${d.reticle.width} x ${d.reticle.height} (supplied by every wafer)` : 'not supplied'}`,
    `compact layout offered: ${d.offered ? 'yes' : 'no'}`,
    `groups of dies: ${d.groups}`,
    `thresholds: minRepeats ${d.thresholds.minRepeats}, minScore ${d.thresholds.minScore}, maxDensity ${d.thresholds.maxDensity}`,
    formatAxis('columns', d.columns),
    formatAxis('rows', d.rows),
  ].join('\n');
}
