/**
 * Which bins pass, per wafer — and how to name a set of them.
 *
 * The rule this file exists for: `[1]` is a default only where data ENTERS the
 * library (`buildWaferMap`'s input). From there the value travels on the result
 * (`WaferMapResult.passBins`), and every display, analysis and report reads it —
 * per wafer, because a gallery can hold wafers from programs with different pass
 * bins. Every downstream surface used to default `passBins` to `[1]` on its own
 * unless the caller repeated it, so a host that told `buildWaferMap` bins 1 and 2
 * pass saw bin 2 drawn, sorted and totalled as a failure everywhere else — with
 * `result.yield`, the one figure that did use them, disagreeing beside it.
 *
 * Deliberately internal (not re-exported from `core/index.ts`).
 */

/** The industry convention, applied ONLY to input that states no pass bins. */
export const INPUT_DEFAULT_PASS_BINS: readonly number[] = [1];

/**
 * One wafer's pass bins: its own (carried from `buildWaferMap`), else the
 * caller's default for items built without any, else the input convention.
 */
export function itemPassBins(
  item: { passBins?: readonly number[] } | null | undefined,
  fallback: readonly number[] = INPUT_DEFAULT_PASS_BINS,
): readonly number[] {
  return item?.passBins ?? fallback;
}

/** Same bins, in any order. */
export function sameBins(a: readonly number[], b: readonly number[]): boolean {
  const sa = new Set(a), sb = new Set(b);
  return sa.size === sb.size && [...sa].every(x => sb.has(x));
}

/**
 * Names the pass bins in use, for a yield label: "bin 1", "bins 1, 2", or —
 * when the wafers shown disagree — "per wafer: bin 1 · bins 1, 2". A label that
 * named one wafer's set while the figure pooled wafers judged differently would
 * be the exact mislabelled population the library must never show.
 */
export function passBinsLabel(sets: Iterable<readonly number[]>): string {
  const distinct: (readonly number[])[] = [];
  for (const s of sets) if (!distinct.some(d => sameBins(d, s))) distinct.push(s);
  const one = (s: readonly number[]) =>
    s.length === 0 ? 'no bins' : s.length === 1 ? `bin ${s[0]}` : `bins ${s.join(', ')}`;
  if (distinct.length <= 1) return one(distinct[0] ?? INPUT_DEFAULT_PASS_BINS);
  return `per wafer: ${distinct.map(one).join(' · ')}`;
}
