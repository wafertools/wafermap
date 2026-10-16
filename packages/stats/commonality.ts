// Commonality: which wafer field divides the wafers' yield (or a fail bin's rate) most clearly. The question a yield
// excursion starts with — is it a lot, a tool, a probe card, a date? — asked of every field the wafers carry at once,
// and answered in rank order.
//
// Each wafer is one value (its yield, or its share of judged dies in a bin), as in the split comparison: the wafers of a
// group are the samples, never its dies. Every field with at least two groups of two or more wafers is compared with
// Welch's ANOVA and Kruskal–Wallis (stats/groupCompare.ts), for yield and for each of the main fail bins, and the rows
// are ranked together by the Benjamini–Hochberg q of Welch's p. What it cannot say, it says: a field that gives every
// wafer its own value cannot be tested, and two fields that change together (a lot and its date) cannot be told apart
// by the wafers alone.
//
// Pure, no DOM.

import type { Die } from '../core/dies.js';
import { diePassStatus, isYieldEligibleDie } from '../core/dies.js';
import type { WaferMetadata } from '../core/metadata.js';
import { benjaminiHochberg } from './math.js';
import { compareGroups, comparisonP, type GroupComparison } from './groupCompare.js';
import { facetValueOf, type FacetCuration } from './facets.js';
import { yieldCounts } from './yield.js';
import { compareNatural } from '../core/utils.js';

export interface CommonalityWafer { metadata?: WaferMetadata; dies: readonly Die[]; passBins: readonly number[] }
export interface CommonalityField { key: string; label: string }

/** What is compared across a field's groups: the wafers' yield, or their share of judged dies in one hard bin. */
export type CommonalityMeasure = { kind: 'yield' } | { kind: 'bin'; bin: number };

export interface CommonalityRow {
  field: CommonalityField;
  measure: CommonalityMeasure;
  comparison: GroupComparison;
  /** The group with the lowest yield (or the highest bin rate), and its mean over its wafers, in percent. */
  worst: { key: string; mean: number };
  /** The group at the other end. */
  best: { key: string; mean: number };
  /** `worst` to `best` in percentage points, always positive. */
  spread: number;
  /** Benjamini–Hochberg q of Welch's p (Kruskal–Wallis's where Welch cannot be computed), over every row. */
  pAdjusted: number;
}

export interface CommonalityResult {
  rows: CommonalityRow[];
  /** Fields with no two groups of two or more wafers: nothing to compare. */
  untestable: CommonalityField[];
  /** The fail bins compared, most dies first. */
  bins: number[];
  /**
   * Pairs of fields that divide the wafers identically (every group of one is a group of the other): the wafers cannot
   * say which of the two it is.
   */
  confounded: Array<[CommonalityField, CommonalityField]>;
}

/** How many of the most common fail bins are compared, besides yield. */
export const COMMONALITY_BINS = 5;

/** A wafer's share of its judged dies in hard bin `bin`, in percent; NaN with no judged dies. The yield's denominator. */
function binRate(w: CommonalityWafer, bin: number): number {
  let inBin = 0, judged = 0;
  for (const d of w.dies) {
    if (!isYieldEligibleDie(d) || d.hbin === undefined) continue;
    judged++;
    if (d.hbin === bin) inBin++;
  }
  return judged ? (inBin / judged) * 100 : NaN;
}

/**
 * Every field of `fields` ranked by how clearly its groups differ in yield and in the rate of each of the
 * `COMMONALITY_BINS` most common fail bins (failing by each wafer's own pass bins). A wafer with no value for a field
 * is left out of that field's comparison.
 */
export function rankCommonality(wafers: readonly CommonalityWafer[], fields: readonly CommonalityField[], curation?: Record<string, FacetCuration>): CommonalityResult {
  const yields = wafers.map(w => { const { pass, total } = yieldCounts(w.dies as Die[], w.passBins); return total ? (pass / total) * 100 : NaN; });
  const failCount = new Map<number, number>();
  for (const w of wafers) {
    const pass = new Set(w.passBins);
    for (const d of w.dies) if (isYieldEligibleDie(d) && d.hbin !== undefined && diePassStatus(d, pass) === false) failCount.set(d.hbin, (failCount.get(d.hbin) ?? 0) + 1);
  }
  const bins = [...failCount].sort((a, b) => b[1] - a[1] || a[0] - b[0]).slice(0, COMMONALITY_BINS).map(([b]) => b);
  const rates = new Map(bins.map(b => [b, wafers.map(w => binRate(w, b))]));

  const rows: CommonalityRow[] = [];
  const untestable: CommonalityField[] = [];
  const partitions = new Map<string, string>();
  for (const field of fields) {
    const value = wafers.map(w => facetValueOf(w.metadata, field.key, curation));
    const keys = [...new Set(value.filter((v): v is string => v !== undefined))].sort(compareNatural);
    const sized = keys.filter(k => value.filter(v => v === k).length >= 2);
    if (sized.length < 2) { untestable.push(field); continue; }
    partitions.set(field.key, value.map(v => (v === undefined ? '' : String(keys.indexOf(v)))).join('|'));
    const measures: Array<[CommonalityMeasure, number[]]> = [[{ kind: 'yield' }, yields], ...bins.map(b => [{ kind: 'bin', bin: b }, rates.get(b)!] as [CommonalityMeasure, number[]])];
    for (const [measure, per] of measures) {
      const comparison = compareGroups(keys.map(key => ({ key, values: per.filter((_, i) => value[i] === key) })));
      const tested = comparison.groups.filter(g => !comparison.tooSmall.includes(g.key) && Number.isFinite(g.mean));
      if (tested.length < 2) continue;
      const low = tested.reduce((a, b) => (b.mean < a.mean ? b : a)), high = tested.reduce((a, b) => (b.mean > a.mean ? b : a));
      const [worst, best] = measure.kind === 'yield' ? [low, high] : [high, low];
      rows.push({ field, measure, comparison, worst: { key: worst.key, mean: worst.mean }, best: { key: best.key, mean: best.mean }, spread: high.mean - low.mean, pAdjusted: NaN });
    }
  }
  const withP = rows.filter(r => Number.isFinite(comparisonP(r.comparison)));
  const q = benjaminiHochberg(withP.map(r => comparisonP(r.comparison)));
  withP.forEach((r, i) => { r.pAdjusted = q[i]; });
  const rank = (r: CommonalityRow) => (Number.isFinite(r.pAdjusted) ? r.pAdjusted : Infinity);
  rows.sort((a, b) => rank(a) - rank(b) || b.spread - a.spread);

  // Fields whose groups are the same wafers: the ranking cannot separate them, and the reader must be told.
  const confounded: Array<[CommonalityField, CommonalityField]> = [];
  const tested = fields.filter(f => partitions.has(f.key));
  for (let i = 0; i < tested.length; i++) for (let j = i + 1; j < tested.length; j++) {
    if (samePartition(partitions.get(tested[i].key)!, partitions.get(tested[j].key)!)) confounded.push([tested[i], tested[j]]);
  }
  return { rows, untestable, bins, confounded };
}

/** Whether two labellings of the wafers group them identically, whatever the labels. */
function samePartition(a: string, b: string): boolean {
  const x = a.split('|'), y = b.split('|');
  const fwd = new Map<string, string>(), back = new Map<string, string>();
  for (let i = 0; i < x.length; i++) {
    if (fwd.has(x[i]) && fwd.get(x[i]) !== y[i]) return false;
    if (back.has(y[i]) && back.get(y[i]) !== x[i]) return false;
    fwd.set(x[i], y[i]); back.set(y[i], x[i]);
  }
  return true;
}

/** A measure as the reader names it: "Yield", "Hard bin 2". */
export const measureLabel = (m: CommonalityMeasure, binName?: (bin: number) => string | undefined): string =>
  m.kind === 'yield' ? 'Yield' : `Hard bin ${m.bin}${binName?.(m.bin) ? ` (${binName(m.bin)})` : ''}`;
