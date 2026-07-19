import type { Die } from './dies.js';

export type AggregationMethod = 'mean' | 'median' | 'stddev' | 'min' | 'max' | 'count';

/** Minimal die shape required by aggregation functions — satisfied by both Die and DieResult. */
export interface DieLike {
  x: number;
  y: number;
  testValues?: Record<number, number>;
  /** Recorded per-test pass/fail verdicts (true = pass). Never aggregated — always stripped from outputs. */
  testPass?: Record<number, boolean>;
  /** @deprecated */
  values?: number[];
  hbin?: number;
  sbin?: number;
}

/**
 * Aggregate a per-test-parameter numeric value across a lot of wafers.
 *
 * @param diesByWafer  One `Die[]` per wafer — all wafers must share the same grid layout.
 * @param method       Aggregation function applied per (x,y) position across all wafers.
 * @param paramIndex   Which index in `die.values[]` to aggregate (default 0).
 * @returns One Die per unique (x,y) position with `values[0]` set to the aggregate result.
 *          Dies that had no values on any wafer are included with `values: undefined` as a
 *          "no data" signal — they are not filtered out.
 *
 * @example Compute mean test value across a lot:
 * ```ts
 * const lotMean = aggregateValues(diesByWafer, 'mean');
 * const scene = buildView(wafer, lotMean, { plotMode: 'value' });
 * ```
 */
export function aggregateValues(
  diesByWafer: DieLike[][],
  method: AggregationMethod,
  paramIndex = 0,
): DieLike[] {
  if (!diesByWafer.length) return [];

  const valuesMap = new Map<string, number[]>();
  const dieTemplate = new Map<string, DieLike>();

  for (const waferDies of diesByWafer) {
    for (const die of waferDies) {
      const key = `${die.x},${die.y}`;
      // Read from testValues (preferred) then fall back to deprecated values[].
      const v = die.testValues?.[paramIndex] ?? die.values?.[paramIndex];
      if (v !== undefined) {
        if (!valuesMap.has(key)) {
          valuesMap.set(key, []);
          dieTemplate.set(key, die);
        }
        valuesMap.get(key)!.push(v);
      } else if (!dieTemplate.has(key)) {
        dieTemplate.set(key, die);
      }
    }
  }

  const result: DieLike[] = [];
  for (const [key, template] of dieTemplate) {
    const vals = valuesMap.get(key);
    // testPass is always stripped: it is one wafer's verdicts, meaningless on
    // a lot-aggregated die.
    if (!vals?.length) {
      result.push({ ...template, testValues: undefined, testPass: undefined });
      continue;
    }

    let agg: number;
    if (method === 'mean') {
      agg = vals.reduce((a, b) => a + b, 0) / vals.length;
    } else if (method === 'median') {
      const sorted = [...vals].sort((a, b) => a - b);
      const mid = Math.floor(sorted.length / 2);
      agg = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
    } else if (method === 'stddev') {
      if (vals.length < 2) { result.push({ ...template, testValues: { 0: 0 }, testPass: undefined }); continue; }
      const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
      agg = Math.sqrt(vals.reduce((s, v) => s + (v - mean) ** 2, 0) / (vals.length - 1));
    } else if (method === 'min') {
      agg = Math.min(...vals);
    } else if (method === 'max') {
      agg = Math.max(...vals);
    } else {
      agg = vals.length; // 'count'
    }

    result.push({ ...template, testValues: { 0: agg }, testPass: undefined });
  }

  return result;
}

/**
 * Return all unique bin values present in dies, sorted ascending.
 * `binSpace` selects whether to inspect `die.hbin` (default) or `die.sbin`.
 */
export function getUniqueBins(dies: Die[], binSpace: 'hard' | 'soft' = 'hard'): number[] {
  const seen = new Set<number>();
  for (const die of dies) {
    const b = binSpace === 'soft' ? die.sbin : die.hbin;
    if (b !== undefined) seen.add(b);
  }
  return [...seen].sort((a, b) => a - b);
}

/**
 * Aggregate multiple wafers by counting, per die position, how many wafers
 * had a specific bin value.
 *
 * Returns one Die per unique (x,y) position (using the first wafer's layout
 * as the spatial template) where:
 *   values[0]  = number of wafers that had targetBin at this position
 *   hbin/sbin  = targetBin (in the appropriate bin space)
 *
 * Use with plotMode: 'value' and valueRange: [0, diesByWafer.length] to get
 * a colour scale that runs from "never" to "always".
 *
 * @param diesByWafer  One Die[] per wafer, all sharing the same grid layout.
 * @param targetBin    The bin value to count.
 * @param binSpace     Which bin space to test — `'hard'` (default) or `'soft'`.
 */
export function aggregateBinCounts(
  diesByWafer: DieLike[][],
  targetBin: number,
  binSpace: 'hard' | 'soft' = 'hard',
): DieLike[] {
  if (!diesByWafer.length) return [];

  const countMap = new Map<string, number>();
  for (const waferDies of diesByWafer) {
    for (const die of waferDies) {
      const b = binSpace === 'soft' ? die.sbin : die.hbin;
      if (b === targetBin) {
        const key = `${die.x},${die.y}`;
        countMap.set(key, (countMap.get(key) ?? 0) + 1);
      }
    }
  }

  return (diesByWafer[0] ?? []).map((die) => ({
    ...die,
    testValues: { 0: countMap.get(`${die.x},${die.y}`) ?? 0 },
    testPass: undefined,
    ...(binSpace === 'soft' ? { sbin: targetBin } : { hbin: targetBin }),
  }));
}
