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
import { benjaminiHochberg, sampleVariance } from './math.js';
import { adjustedFits, mergePartitions, type Partition } from './groupEffects.js';
import { yieldCounts } from './yield.js';
import type { PlotItem } from './plotData.js';

const MAX_DIES = 4000;
const MAX_TESTS = 60;
const MIN_VALUES = 20;
/** A set of groups is offered as an example when its adjusted p, over the sets compared, is under this. */
const SUGGEST_Q = 0.1;

export interface ExamplePicks {
  /** The tests, most telling first (between wafers, or against position for one wafer); tests never scored are last, in their own order. */
  ranked: number[];
  /** The test that best tracks the lead test over the sampled dies, when one does. */
  partner?: number;
  /** The lot field whose values best separate the wafers' means of the lead test. */
  splitKey?: string;
  /**
   * The lot fields whose groups differ in yield, strongest set of groups first. Fields that group the wafers identically (a
   * tester and the handler docked to it) are listed together, so each is offered; a set is read after allowing for the
   * strongest other one, as in What stands out. Absent when no field divides the wafers' yield.
   */
  yieldKeys?: string[];
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
  if (scored.length === 0 || total === 0) return { ranked: [...tests], ...fieldPicks(items, metaKeys, curation) };
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
  if (score[lead] <= 0) return { ranked: [...tests], ...fieldPicks(items, metaKeys, curation) };

  let partner: number | undefined, best = 0.3;
  const leadRows = finiteRows(lead);
  for (const k of order.slice(1)) {
    const rows = leadRows.filter(r => Number.isFinite(columns[k][r]));
    const r = Math.abs(pearson(rows.map(i => columns[lead][i]), rows.map(i => columns[k][i])));
    if (r > best) { best = r; partner = scored[k]; }
  }

  const picked = fieldPicks(items, metaKeys, curation, waferMeans(lead));
  return { ranked, ...(partner !== undefined ? { partner } : {}), ...picked };
}

/** The lot fields to split the examples by: for the lead test's wafer means, and for the wafers' yield (see {@link ExamplePicks}). */
function fieldPicks(
  items: readonly PlotItem[], metaKeys: readonly string[], curation: Record<string, FacetCuration> | undefined,
  leadMeans?: ReadonlyArray<number | undefined>,
): Pick<ExamplePicks, 'splitKey' | 'yieldKeys'> {
  if (items.length < 4) return {};
  // The sets of groups the lot fields make. Fields that group the wafers identically are one set; a field with a group of one
  // wafer, or with more groups than half the wafers, cannot be compared and is left out.
  const partitions: Partition[] = mergePartitions(metaKeys.flatMap(key => {
    const groupOf = items.map(it => facetValueOf(it.metadata, key, curation));
    const sizes = new Map<string, number>();
    for (const g of groupOf) if (g !== undefined) sizes.set(g, (sizes.get(g) ?? 0) + 1);
    return sizes.size >= 2 && sizes.size <= Math.max(2, Math.floor(items.length / 2)) && [...sizes.values()].every(n => n >= 2) ? [{ key, groupOf }] : [];
  }));
  if (partitions.length === 0) return {};
  // Strongest first, by the p of the set of groups against the measure, adjusted over the sets compared; a set is offered
  // when that q is under SUGGEST_Q (a suggestion to look, not a finding).
  const strongest = (values: ReadonlyArray<number | undefined>): Partition[] => {
    const fits = adjustedFits(values, partitions).filter(f => f.fitted);
    const q = benjaminiHochberg(fits.map(f => f.fitted!.p));
    return fits.map((f, i) => ({ f, q: q[i] })).filter(x => x.q < SUGGEST_Q).sort((a, b) => a.f.fitted!.p - b.f.fitted!.p).map(x => x.f.partition);
  };
  const splitKey = leadMeans ? strongest(leadMeans)[0]?.keys[0] : undefined;
  const yields = items.map(it => { const { pass, total } = yieldCounts(it.dies, it.passBins); return total ? pass / total : undefined; });
  const yieldKeys = strongest(yields).flatMap(p => p.keys);
  return { ...(splitKey ? { splitKey } : {}), ...(yieldKeys.length ? { yieldKeys } : {}) };
}
