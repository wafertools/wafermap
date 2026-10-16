/**
 * Which tests and lot field the Plot tab's example plots are drawn from, chosen from the data in view rather than
 * from the order the tests are listed in: the examples then show what this lot has to say. Pure and bounded: it reads a
 * sample of the dies and at most `MAX_TESTS` tests, so choosing costs about the same on a lot of a million dies.
 */

import { testValuesReader } from '../core/dieTable.js';
import { facetValueOf } from './facets.js';
import type { FacetCuration } from './facets.js';
import { dieRadialPosition } from './dieRegions.js';
import { pearsonOfPairs } from './correlation.js';
import { sampleVariance } from './math.js';
import type { PlotItem } from './plotData.js';

const MAX_DIES = 4000;
const MAX_TESTS = 60;
const MIN_VALUES = 20;

export interface ExamplePicks {
  /** The tests, most telling first (between wafers, or against position for one wafer); tests never scored are last, in their own order. */
  ranked: number[];
  /** The test that best tracks the lead test over the sampled dies, when one does. */
  partner?: number;
  /** The lot field whose values best separate the wafers' means of the lead test. */
  splitKey?: string;
}

const sd = (v: readonly number[]): number => Math.sqrt(sampleVariance(v));

/** The correlation of two equal-length columns, 0 below `MIN_VALUES` pairs or where either has no spread. */
function pearson(a: readonly number[], b: readonly number[]): number {
  const n = Math.min(a.length, b.length);
  if (n < MIN_VALUES) return 0;
  return pearsonOfPairs(Array.from({ length: n }, (_, i) => ({ x: a[i], y: b[i] }))).r ?? 0;
}

/**
 * `tests` in order of how much each has to show: the share of its variation that lies between wafers (a shift, a drift,
 * a split effect); for a single wafer, how strongly it follows distance from the centre (edge roll-off). A test with too
 * few values scores nothing. The partner and split field are read against the lead test.
 */
export function pickExamples(
  items: readonly PlotItem[], tests: readonly number[], metaKeys: readonly string[], curation?: Record<string, FacetCuration>,
): ExamplePicks {
  const scored = tests.slice(0, MAX_TESTS);
  const total = items.reduce((n, it) => n + it.dies.length, 0);
  if (scored.length === 0 || total === 0) return { ranked: [...tests] };
  const step = Math.max(1, Math.ceil(total / MAX_DIES));
  const read = testValuesReader(scored);
  const out = new Float64Array(scored.length);
  const columns = scored.map(() => [] as number[]);
  const waferOf: number[] = [];
  const radius: number[] = [];
  const rowsByWafer = items.map(() => [] as number[]);
  let seen = 0;
  items.forEach((it, w) => {
    for (const die of it.dies) {
      if (seen++ % step) continue;
      read(die, out);
      const row = waferOf.length;
      waferOf.push(w); rowsByWafer[w].push(row);
      radius.push(dieRadialPosition(die, { wafer: it.wafer }) ?? NaN);
      for (let k = 0; k < scored.length; k++) columns[k].push(out[k]);
    }
  });
  const finiteRows = (k: number) => columns[k].reduce<number[]>((r, v, i) => (Number.isFinite(v) ? (r.push(i), r) : r), []);
  const waferMeans = (k: number): Array<number | undefined> => rowsByWafer.map(rows => {
    const v = rows.map(r => columns[k][r]).filter(Number.isFinite);
    return v.length >= 3 ? v.reduce((a, b) => a + b, 0) / v.length : undefined;
  });
  const score = scored.map((_, k) => {
    const rows = finiteRows(k);
    if (rows.length < MIN_VALUES) return 0;
    if (items.length === 1) return Math.abs(pearson(rows.map(r => columns[k][r]), rows.map(r => radius[r])) || 0);
    const all = sd(rows.map(r => columns[k][r]));
    const means = waferMeans(k).filter((m): m is number => m !== undefined);
    return all > 0 && means.length >= 2 ? Math.min(1, sd(means) / all) : 0;
  });
  const order = scored.map((_, k) => k).sort((a, b) => score[b] - score[a] || a - b);
  const ranked = [...order.map(k => scored[k]), ...tests.slice(MAX_TESTS)];
  const lead = order[0];
  if (score[lead] <= 0) return { ranked: [...tests] };

  let partner: number | undefined, best = 0.3;
  const leadRows = finiteRows(lead);
  for (const k of order.slice(1)) {
    const rows = leadRows.filter(r => Number.isFinite(columns[k][r]));
    const r = Math.abs(pearson(rows.map(i => columns[lead][i]), rows.map(i => columns[k][i])));
    if (r > best) { best = r; partner = scored[k]; }
  }

  // The lot field whose groups explain most of the spread of the wafers' means of the lead test.
  let splitKey: string | undefined, share = 0;
  const means = waferMeans(lead);
  const pooled = means.filter((m): m is number => m !== undefined);
  const grand = pooled.length ? pooled.reduce((a, b) => a + b, 0) / pooled.length : 0;
  const ss = pooled.reduce((a, m) => a + (m - grand) ** 2, 0);
  if (ss > 0) {
    for (const key of metaKeys) {
      const groups = new Map<string, number[]>();
      items.forEach((it, w) => {
        const g = facetValueOf(it.metadata, key, curation), m = means[w];
        if (g !== undefined && m !== undefined) groups.set(g, [...(groups.get(g) ?? []), m]);
      });
      if (groups.size < 2 || groups.size > Math.max(2, Math.floor(pooled.length / 2))) continue;
      const between = [...groups.values()].reduce((a, v) => a + v.length * ((v.reduce((x, y) => x + y, 0) / v.length) - grand) ** 2, 0);
      if (between / ss > share) { share = between / ss; splitKey = key; }
    }
  }
  return { ranked, ...(partner !== undefined ? { partner } : {}), ...(splitKey && share > 0.05 ? { splitKey } : {}) };
}
