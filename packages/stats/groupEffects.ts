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

/** The most groups a field may put `wafers` wafers in and still be compared: past it the field nearly names each wafer. */
export const maxGroups = (wafers: number): number => Math.max(2, Math.floor(wafers / 2));

/**
 * Whether a field's groups can be compared: two groups or more with two wafers or more each, and no more groups than
 * {@link maxGroups}. Every surface that reads groups of wafers takes its fields through here, so a field is read by all of
 * them or by none, and each set of groups is read after allowing for the same others.
 */
export function comparableGrouping(groupOf: GroupOf): boolean {
  const sizes = new Map<string, number>();
  for (const g of groupOf) if (g !== undefined) sizes.set(g, (sizes.get(g) ?? 0) + 1);
  let sized = 0;
  for (const n of sizes.values()) if (n >= 2) sized++;
  return sized >= 2 && sizes.size <= maxGroups(groupOf.length);
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

/** Whether two sets of groups match on most wafers: allowing for one would remove most of the other, so neither is allowed for the other. */
function nearlyTheSame(a: GroupOf, b: GroupOf): boolean {
  const o = overlapOf(a, b);
  return !!o && o.agree / o.of >= MIN_OVERLAP_SHARE;
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
    const allow = ranked.filter(x => x.partition.id !== r.partition.id && x.fitted!.p < ALLOW_FOR_P && !nested(x.partition.groupOf, r.partition.groupOf) && !nearlyTheSame(x.partition.groupOf, r.partition.groupOf));
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

/** How closely two sets of groups agree: wafers in matching groups, and wafers compared. */
export interface Overlap { agree: number; of: number }

/** Overlaps this share of wafers or more, short of identical, is worth saying (a tester and an operator who mostly go together). */
export const MIN_OVERLAP_SHARE = 0.75;

/**
 * The wafers two sets of groups put in matching groups, when they have the same number of groups and each group of one matches a
 * different group of the other (its commonest partner). Undefined when they cannot be matched that way: different numbers of
 * groups, or two groups with the same partner (one set nests inside the other, which is a different thing to say). Identical
 * sets agree on every wafer; they are one partition (see {@link mergePartitions}) and not reported as an overlap.
 */
export function overlapOf(a: GroupOf, b: GroupOf): Overlap | undefined {
  const pairs = a.flatMap((g, i) => (g !== undefined && b[i] !== undefined ? [[g, b[i]!] as const] : []));
  const left = new Set(pairs.map(p => p[0])), right = new Set(pairs.map(p => p[1]));
  if (pairs.length === 0 || left.size < 2 || left.size !== right.size) return undefined;
  const counts = new Map<string, Map<string, number>>();
  for (const [g, h] of pairs) { const m = counts.get(g) ?? counts.set(g, new Map()).get(g)!; m.set(h, (m.get(h) ?? 0) + 1); }
  const partner = new Map<string, string>();
  let agree = 0;
  for (const [g, m] of counts) {
    const [best, n] = [...m].sort((x, y) => y[1] - x[1] || (x[0] < y[0] ? -1 : 1))[0];
    partner.set(g, best); agree += n;
  }
  return new Set(partner.values()).size === left.size ? { agree, of: pairs.length } : undefined;
}

/** The sets among `partitions` that overlap `partition` without being identical to it, strongest first. */
export function overlapping(partition: Partition, partitions: readonly Partition[]): Array<{ partition: Partition } & Overlap> {
  return partitions
    .filter(q => q.id !== partition.id)
    .flatMap(q => { const o = overlapOf(partition.groupOf, q.groupOf); return o && o.agree < o.of && o.agree / o.of >= MIN_OVERLAP_SHARE ? [{ partition: q, ...o }] : []; })
    .sort((x, y) => y.agree / y.of - x.agree / x.of);
}
