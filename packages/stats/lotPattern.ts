import { requireRingCount } from '../core/ringCount.js';
import type { WaferMapResult } from '../renderer/buildWaferMap.js';
import { getDieKey, isPositionedDie, isYieldEligibleDie, positionKey, type PositionedDie } from '../core/dies.js';
import { itemPassBins } from '../core/passBins.js';
import { classifyFailingDies, patternFailVerdict, type PatternClassification } from './patternClassification.js';
import { benjaminiHochberg, binomialUpperTail } from './math.js';
import { passesRateGate, rateRelativeEffect, twoProportionZ, zPValue, type ResolvedOptions } from './analyzeWaferMap.js';

/** A lot's spatial pattern: where its failures recur, what shape that is, and which wafers show it. */
export interface LotPattern {
  /** The classifier's reading of the recurring positions — never 'random' or 'none'. */
  classification: PatternClassification;
  /** Each wafer that shows the pattern → its failing dies inside the recurring area. */
  carriers: Map<number, string[]>;
}

/** Wafers stack by die position only when they share a grid: same wafer radius and die size. */
const GRID_TOLERANCE = 0.01;

/**
 * The lot's spatial pattern, decided from the lot rather than by counting each
 * wafer's single best label — so one pattern that the classifier reads two ways
 * on different wafers (an elongated centre cluster called a scratch, a faint
 * edge ring called random) is still one pattern.
 *
 * 1. Stack the wafers by die position. A position is *recurring* when more wafers
 *    fail in its 3×3 neighbourhood than the lot's overall fail rate explains
 *    (an exact binomial test, Benjamini–Hochberg across positions at the
 *    analysis's significance level) and it fails above that rate itself. A systematic cause fails the same dies wafer after
 *    wafer; random defects and patterns that move (scratches, particles) do not.
 * 2. Classify the recurring positions as a map of their own — the same
 *    classifier and thresholds as a single wafer.
 * 3. A wafer shows the pattern when its own failures are concentrated in that
 *    area: its fail rate inside against outside, by the same two-proportion test
 *    and effect gate as any regional finding, Benjamini–Hochberg across wafers.
 *
 * Wafers stack only with wafers on the same grid as the first (a lot stack, or a
 * wafer of another geometry, is left out and keeps its own classification).
 * Returns null when nothing recurs, or what recurs has no shape.
 */
export function findLotPattern(results: readonly WaferMapResult[], options: ResolvedOptions): LotPattern | null {
  type Wafer = { index: number; dies: PositionedDie[]; fails: boolean[] };
  const wafers: Wafer[] = [];
  let ref: WaferMapResult | undefined;
  let refWidth = 0, refHeight = 0;
  results.forEach((result, index) => {
    if (result.isLotStack) return;
    const passSet = new Set(itemPassBins(result));
    const dies: PositionedDie[] = [];
    const fails: boolean[] = [];
    for (const die of result.dies) {
      if (!isYieldEligibleDie(die) || !isPositionedDie(die)) continue;
      const verdict = patternFailVerdict(die, passSet);
      if (verdict === undefined) continue;
      dies.push(die);
      fails.push(verdict);
    }
    if (!dies.length) return;
    const near = (a: number, b: number) => Math.abs(a - b) <= GRID_TOLERANCE * Math.max(Math.abs(a), Math.abs(b));
    if (!ref) { ref = result; refWidth = dies[0].width; refHeight = dies[0].height; }
    else if (!near(result.wafer.radius, ref.wafer.radius) || !near(dies[0].width, refWidth) || !near(dies[0].height, refHeight)) return;
    wafers.push({ index, dies, fails });
  });
  if (!ref || wafers.length < 2) return null;

  // 1. Recurring positions.
  const positions = new Map<number | string, { die: PositionedDie; n: number; k: number }>();
  let totalN = 0, totalK = 0;
  for (const w of wafers) {
    w.dies.forEach((die, i) => {
      const key = positionKey(die);
      let p = positions.get(key);
      if (!p) positions.set(key, p = { die, n: 0, k: 0 });
      p.n++;
      if (w.fails[i]) { p.k++; totalK++; }
      totalN++;
    });
  }
  if (totalK === 0) return null;
  const background = totalK / totalN;
  const cells = [...positions.values()];
  // A single position has too little data for a small lot (8 wafers can never
  // make one position significant among a thousand), and a ring or blob is a
  // neighbourhood effect anyway: each position is tested on its 3×3 neighbourhood
  // pooled. Positions without integer grid coordinates have no neighbours and are
  // tested alone.
  const pooled = cells.map(c => {
    let n = 0, k = 0;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const q = dx === 0 && dy === 0 ? c : positions.get(positionKey({ x: c.die.x + dx, y: c.die.y + dy }));
        if (q) { n += q.n; k += q.k; }
      }
    }
    return { n, k };
  });
  const adjusted = benjaminiHochberg(pooled.map(p => binomialUpperTail(p.k, p.n, background)));
  const recurring = new Set<number | string>();
  const recurringDies: PositionedDie[] = [];
  cells.forEach((c, i) => {
    // The neighbourhood must be significant and the position itself above the
    // lot's fail rate, so the test does not fatten the area by a die all round.
    if (adjusted[i] > options.significanceLevel || c.k / c.n <= background) return;
    recurring.add(positionKey(c.die));
    recurringDies.push(c.die);
  });

  // 2. Its shape.
  const classification = classifyFailingDies(recurringDies, cells.map(c => c.die), ref.wafer, requireRingCount(ref, 'the lot pattern'));
  if (!classification || classification.pattern === 'random' || classification.pattern === 'none') return null;

  // 3. The wafers that show it.
  const tests = wafers.map(w => {
    let hits = 0, n = 0, restHits = 0, restN = 0;
    const inside: string[] = [];
    w.dies.forEach((die, i) => {
      if (recurring.has(positionKey(die))) {
        n++;
        if (w.fails[i]) { hits++; inside.push(getDieKey(die)); }
      } else {
        restN++;
        if (w.fails[i]) restHits++;
      }
    });
    const z = n >= options.minimumSampleSize && restN >= options.minimumSampleSize
      ? twoProportionZ(hits, n, restHits, restN) : 0;
    return { index: w.index, z, hits, n, restHits, restN, inside };
  });
  const adjustedWafers = benjaminiHochberg(tests.map(t => t.z > 0 ? zPValue(t.z) : 1));
  const carriers = new Map<number, string[]>();
  tests.forEach((t, i) => {
    if (t.z <= 0) return;
    const delta = t.hits / t.n - t.restHits / t.restN;
    const size = rateRelativeEffect({ hits: t.hits, n: t.n, restHits: t.restHits, restN: t.restN, passRate: false });
    if (passesRateGate(adjustedWafers[i], delta, size, options)) carriers.set(t.index, t.inside);
  });
  return carriers.size ? { classification, carriers } : null;
}
