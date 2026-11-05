// Groups of wafers and what they do to a measure: the one place the sets of groups a lot's fields make, the ties between
// them, and the reading of one set after allowing for another are decided. "What stands out", the example plots and
// "What divides yield" all read fields through here, so a tester and the handler docked to it are one set of groups
// everywhere, and a weak card hidden by a recipe is found by every surface that looks for it.
//
// Each wafer is one value of a measure (its yield, a test's mean), as in the split comparison: the wafers of a group
// are the samples, never its dies. Pure, no DOM.

import { compareGroups } from './groupCompare.js';
import { fUpperTail, tTwoSided } from './math.js';

/** The group each wafer is in on one field (undefined: no value for it). */
export type GroupOf = ReadonlyArray<string | undefined>;

/** A set of groups, and every field that puts the wafers in exactly those groups. */
export interface Partition {
  /** Which wafers are together, whatever the groups are called: equal for fields that group the wafers identically. */
  id: string;
  /** The fields, in the order given; the first names the set. */
  keys: string[];
  groupOf: GroupOf;
}

/** The wafers grouped as a number per group in order of first appearance, so equal groupings compare equal whatever their labels. */
export function partitionId(groupOf: GroupOf): string {
  const seen = new Map<string, number>();
  return groupOf.map(g => g === undefined ? '-' : String(seen.get(g) ?? seen.set(g, seen.size).get(g))).join(',');
}

/** Fields that group the wafers identically are one partition. */
export function mergePartitions(fields: ReadonlyArray<{ key: string; groupOf: GroupOf }>): Partition[] {
  const byId = new Map<string, Partition>();
  for (const f of fields) {
    const id = partitionId(f.groupOf);
    const known = byId.get(id);
    if (known) known.keys.push(f.key); else byId.set(id, { id, keys: [f.key], groupOf: f.groupOf });
  }
  return [...byId.values()];
}

/** Whether every group of `fine` lies inside one group of `coarse`: allowing for a finer set (a probe session) would remove the coarser one (its tester). */
export function nested(fine: GroupOf, coarse: GroupOf): boolean {
  const home = new Map<string, string | undefined>();
  return fine.every((g, i) => g === undefined || (home.has(g) ? home.get(g) === coarse[i] : (home.set(g, coarse[i]), true)));
}

/** The wafers of each group that have a value, and the groups' comparison (undefined when it cannot be made). */
export interface GroupFit { byGroup: Map<string, number[]>; p: number }

/**
 * `lostDf`: degrees of freedom already spent estimating means that were taken out of `values` (see {@link adjustedFits}), so
 * a difference read from what is left is judged on the wafers that remain free, not as if no mean had been estimated.
 */
export function fitGroups(values: ReadonlyArray<number | undefined>, groupOf: GroupOf, lostDf = 0): GroupFit | undefined {
  const byGroup = new Map<string, number[]>();
  values.forEach((v, i) => {
    const g = groupOf[i];
    if (v === undefined || !Number.isFinite(v) || g === undefined) return;
    (byGroup.get(g) ?? byGroup.set(g, []).get(g)!).push(i);
  });
  if (byGroup.size < 2) return undefined;
  const cmp = compareGroups([...byGroup].map(([key, idx]) => ({ key, values: idx.map(i => values[i]!) })));
  let p = cmp.welch?.p ?? cmp.kruskal?.p;
  if (cmp.welch && lostDf > 0) {
    const df2 = cmp.welch.df2 - lostDf;
    p = df2 < 1 ? 1 : cmp.welch.method === 'welch-t' ? tTwoSided(cmp.welch.statistic, df2) : fUpperTail(cmp.welch.statistic, cmp.welch.df1, df2);
  }
  return p === undefined || !Number.isFinite(p) ? undefined : { byGroup, p };
}

/** The p below which another set of groups is allowed for before a set is read. */
export const ALLOW_FOR_P = 0.25;

/** One set of groups read against a measure. */
export interface AdjustedFit {
  partition: Partition;
  /** The values compared: the measure's own, or what is left of them after allowing for other sets of groups. */
  used: Array<number | undefined>;
  fitted?: GroupFit;
  /** The first field of each set allowed for, when `used` is not the measure's own values. */
  allowedFor?: string[];
}

/**
 * Every partition read against `values`. Each is read after allowing for the strongest other set that explains the measure
 * at all (a raw p under {@link ALLOW_FOR_P}) and does not sit inside it, and for every coarser set it divides, so a field
 * another hides (a weak card on wafers that also differ by recipe) is still found, and a probe session is read beyond its
 * card. A set read this way says which it allowed for.
 */
export function adjustedFits(values: ReadonlyArray<number | undefined>, partitions: readonly Partition[]): AdjustedFit[] {
  const raw = partitions.map(partition => ({ partition, fitted: fitGroups(values, partition.groupOf) }));
  const ranked = raw.filter(r => r.fitted).sort((x, y) => x.fitted!.p - y.fitted!.p);
  return raw.map(r => {
    const allow = ranked.filter(x => x.partition.id !== r.partition.id && x.fitted!.p < ALLOW_FOR_P && !nested(x.partition.groupOf, r.partition.groupOf));
    const parents = allow.filter(x => nested(r.partition.groupOf, x.partition.groupOf));
    const strongest = allow.find(x => !nested(r.partition.groupOf, x.partition.groupOf));
    const allowing = [...(strongest ? [strongest] : []), ...parents];
    let used = [...values], fitted = r.fitted, allowedFor: string[] | undefined;
    if (allowing.length > 0) {
      let lostDf = 0;
      for (const a of allowing) {
        lostDf += Math.max(0, (a.fitted?.byGroup.size ?? 1) - 1);
        const groups = new Map<string, number[]>();
        used.forEach((v, i) => { const g = a.partition.groupOf[i]; if (v !== undefined && g !== undefined) (groups.get(g) ?? groups.set(g, []).get(g)!).push(v); });
        const mean = new Map([...groups].map(([g, v]) => [g, v.reduce((x, y) => x + y, 0) / v.length]));
        used = used.map((v, i) => { const g = a.partition.groupOf[i]; return v === undefined || g === undefined ? undefined : v - mean.get(g)!; });
      }
      fitted = fitGroups(used, r.partition.groupOf, lostDf) ?? r.fitted;
      if (fitted !== r.fitted) allowedFor = allowing.map(x => x.partition.keys[0]);
    }
    return { partition: r.partition, used: fitted === r.fitted ? [...values] : used, fitted, ...(allowedFor ? { allowedFor } : {}) };
  });
}
