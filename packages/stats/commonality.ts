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
import { adjustedFits, mergePartitions, overlapping, partitionId } from './groupEffects.js';
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
  /**
   * The comparison the p and q come from, when the field was read after allowing for another (the strongest other field that
   * explains the same measure): its groups' values less that field's group means. Absent when `comparison` is what was ranked.
   * `comparison` always holds the measure's own means, so a row reads in percent whichever way it was ranked.
   */
  adjusted?: GroupComparison;
  /** The fields allowed for, when `adjusted` is set. */
  allowedFor?: CommonalityField[];
  /** Benjamini–Hochberg q of Welch's p (Kruskal–Wallis's where Welch cannot be computed) of `adjusted ?? comparison`, over every row. */
  pAdjusted: number;
}

export interface CommonalityResult {
  rows: CommonalityRow[];
  /** Fields with no two groups of two or more wafers: nothing to compare. */
  untestable: CommonalityField[];
  /** The fail bins compared, most dies first. */
  bins: number[];
  /**
   * Sets of fields that divide the wafers identically (every group of one is a group of the other), each of two or more
   * fields: the wafers cannot say which of them it is.
   */
  tied: CommonalityField[][];
  /** Sets of fields that nearly match without being identical: how many of the wafers they put in matching groups. */
  overlapping: Array<{ fields: CommonalityField[]; with: CommonalityField[]; agree: number; of: number }>;
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
  const testedFields: Array<{ field: CommonalityField; value: Array<string | undefined>; keys: string[] }> = [];
  for (const field of fields) {
    const value = wafers.map(w => facetValueOf(w.metadata, field.key, curation));
    const keys = [...new Set(value.filter((v): v is string => v !== undefined))].sort(compareNatural);
    const sized = keys.filter(k => value.filter(v => v === k).length >= 2);
    if (sized.length < 2) { untestable.push(field); continue; }
    testedFields.push({ field, value, keys });
  }
  // Fields that group the wafers identically are one set of groups; each set is read after allowing for the strongest other one.
  const sets = mergePartitions(testedFields.map(t => ({ key: t.field.key, groupOf: t.value })));
  const fieldOf = new Map(fields.map(f => [f.key, f]));
  const measures: Array<[CommonalityMeasure, number[]]> = [[{ kind: 'yield' }, yields], ...bins.map(b => [{ kind: 'bin', bin: b }, rates.get(b)!] as [CommonalityMeasure, number[]])];
  for (const [measure, per] of measures) {
    const fits = new Map(adjustedFits(per.map(v => (Number.isFinite(v) ? v : undefined)), sets).map(f => [f.partition.id, f]));
    for (const { field, value, keys } of testedFields) {
      const comparison = compareGroups(keys.map(key => ({ key, values: per.filter((_, i) => value[i] === key) })));
      const tested = comparison.groups.filter(g => !comparison.tooSmall.includes(g.key) && Number.isFinite(g.mean));
      if (tested.length < 2) continue;
      const low = tested.reduce((a, b) => (b.mean < a.mean ? b : a)), high = tested.reduce((a, b) => (b.mean > a.mean ? b : a));
      const [worst, best] = measure.kind === 'yield' ? [low, high] : [high, low];
      const fit = fits.get(partitionId(value));
      let adjusted = fit?.allowedFor
        ? compareGroups(keys.map(key => ({ key, values: fit.used.filter((v, i) => value[i] === key && v !== undefined) as number[] })))
        : undefined;
      // The p is the fit's, which has charged the degrees of freedom the allowed-for means used up.
      if (adjusted?.welch && fit?.fitted) adjusted = { ...adjusted, welch: { ...adjusted.welch, p: fit.fitted.p } };
      rows.push({
        field, measure, comparison, worst: { key: worst.key, mean: worst.mean }, best: { key: best.key, mean: best.mean }, spread: high.mean - low.mean, pAdjusted: NaN,
        ...(adjusted && fit?.allowedFor ? { adjusted, allowedFor: fit.allowedFor.map(k => fieldOf.get(k) ?? { key: k, label: k }) } : {}),
      });
    }
  }
  const rowP = (r: CommonalityRow) => comparisonP(r.adjusted ?? r.comparison);
  const withP = rows.filter(r => Number.isFinite(rowP(r)));
  const q = benjaminiHochberg(withP.map(rowP));
  withP.forEach((r, i) => { r.pAdjusted = q[i]; });
  const rank = (r: CommonalityRow) => (Number.isFinite(r.pAdjusted) ? r.pAdjusted : Infinity);
  rows.sort((a, b) => rank(a) - rank(b) || b.spread - a.spread);

  // Fields whose groups are the same wafers: the ranking cannot separate them, and the reader must be told.
  const tied = sets.filter(set => set.keys.length > 1).map(set => set.keys.map(k => fieldOf.get(k)!));
  const near: CommonalityResult['overlapping'] = [];
  sets.forEach((set, i) => {
    for (const o of overlapping(set, sets)) {
      // Each pair once.
      if (sets.indexOf(o.partition) > i) near.push({ fields: set.keys.map(k => fieldOf.get(k)!), with: o.partition.keys.map(k => fieldOf.get(k)!), agree: o.agree, of: o.of });
    }
  });
  return { rows, untestable, bins, tied, overlapping: near };
}

/** A measure as the reader names it: "Yield", "Hard bin 2". */
export const measureLabel = (m: CommonalityMeasure, binName?: (bin: number) => string | undefined): string =>
  m.kind === 'yield' ? 'Yield' : `Hard bin ${m.bin}${binName?.(m.bin) ? ` (${binName(m.bin)})` : ''}`;

/** How plainly a row's groups differ, from its q: the word the card shows in place of the p-values. */
export type CommonalityConfidence = 'clear' | 'possible' | 'none';

/** q under 0.05 is clear, under 0.2 possible; a q that could not be computed is not clear. */
export const commonalityConfidence = (q: number): CommonalityConfidence => (q < 0.05 ? 'clear' : q < 0.2 ? 'possible' : 'none');

export const CONFIDENCE_LABEL: Record<CommonalityConfidence, string> = { clear: 'Clear', possible: 'Possible', none: 'Not clear' };

/** One field with its strongest measure, and its other measures behind it. */
export interface CommonalityFieldRows {
  field: CommonalityField;
  /** Every field that gives the same groups of wafers, `field` first: one row stands for all of them. */
  fields: CommonalityField[];
  primary: CommonalityRow;
  others: CommonalityRow[];
}

/**
 * The rows as one entry per field: yield leads unless a fail bin is clearer, then the measure with the lowest q, the field's other measures follow it.
 * Fields are ordered clear, then possible, then not clear, and within each by the size of the leading difference.
 */
export function groupCommonalityRows(rows: readonly CommonalityRow[], tied: readonly (readonly CommonalityField[])[] = []): CommonalityFieldRows[] {
  const byField = new Map<string, CommonalityRow[]>();
  for (const r of rows) (byField.get(r.field.key) ?? byField.set(r.field.key, []).get(r.field.key)!).push(r);
  const tier = (r: CommonalityRow) => ['clear', 'possible', 'none'].indexOf(commonalityConfidence(r.pAdjusted));
  const setOf = new Map<string, readonly CommonalityField[]>();
  for (const set of tied) for (const f of set) setOf.set(f.key, set);
  // Fields that group the wafers identically have identical rows: one row for the set, led by its first field in rank order.
  const emitted = new Set<readonly CommonalityField[]>();
  const entries: CommonalityFieldRows[] = [];
  for (const rs of byField.values()) {
    const set = setOf.get(rs[0].field.key);
    if (set) { if (emitted.has(set)) continue; emitted.add(set); }
    // With nothing clear to lead with, yield leads: the measure a reader looks for first. A fail bin leads only when it is
    // clearer than yield.
    const yieldRow = rs.find(r => r.measure.kind === 'yield');
    const lead = yieldRow && tier(yieldRow) <= tier(rs[0]) ? yieldRow : rs[0];
    entries.push({ field: rs[0].field, fields: set ? [rs[0].field, ...set.filter(f => f.key !== rs[0].field.key)] : [rs[0].field], primary: lead, others: rs.filter(r => r !== lead) });
  }
  return entries.sort((a, b) => tier(a.primary) - tier(b.primary) || b.primary.spread - a.primary.spread);
}
