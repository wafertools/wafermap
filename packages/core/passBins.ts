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

/**
 * THE ONE PLACE the default pass bins exist, and `normalizePassBins` the one
 * place it is applied. `tests/passBinsDefault.test.mjs` and
 * `scripts/check-pass-bin-defaults.mjs` (run by `npm run check`) fail the build
 * if the literal, this constant or a `[1]` fallback appears anywhere else.
 *
 * Why so strict: a user who states pass bins "3, 5" has made bin 1 a FAIL bin.
 * Any surface that quietly falls back to `[1]` then reports a wrong yield and
 * says nothing, and a yield is what lots are dispositioned on.
 */
const INPUT_DEFAULT_PASS_BINS: readonly number[] = [1];

/**
 * The pass bins of a build: what the input states, or — only when it states
 * none — the industry convention (bin 1). Called by `buildWaferMap` and nothing
 * else; from there the value travels on the result.
 */
export function normalizePassBins(stated: readonly number[] | undefined): number[] {
  return [...(stated ?? INPUT_DEFAULT_PASS_BINS)];
}

/**
 * The pass bins a source carries, or an error naming where they were missing.
 * Downstream of the build there is no default to fall back on: a surface that
 * cannot say which bins pass must not state a yield.
 */
export function requirePassBins(
  source: { passBins?: readonly number[] } | null | undefined,
  where: string,
): readonly number[] {
  const bins = source?.passBins;
  if (!bins) {
    throw new Error(`${where}: no pass bins (WaferMapResult.passBins); a map not built by buildWaferMap must state them.`);
  }
  return bins;
}

/**
 * One wafer's pass bins: its own (carried from `buildWaferMap`), else
 * `fallback` — a value the CALLER holds for items built without any (a report
 * given `passBins` for hand-built maps) — else an error. Never a built-in default.
 */
export function itemPassBins(
  item: { passBins?: readonly number[] } | null | undefined,
  fallback?: readonly number[],
): readonly number[] {
  return item?.passBins ?? fallback ?? requirePassBins(undefined, 'itemPassBins');
}

/** Same bins, in any order. */
export function sameBins(a: readonly number[], b: readonly number[]): boolean {
  const sa = new Set(a), sb = new Set(b);
  return sa.size === sb.size && [...sa].every(x => sb.has(x));
}

/**
 * Whether a hard or soft bin number is a pass bin. Pass bins are hard-bin numbers; they judge a soft bin only
 * when the dies carry no hard bin, when a die's verdict is its soft bin's (`diePassStatus`). Otherwise a soft
 * bin's verdict is not known from the pass bins, and it is not called a pass bin.
 */
export function isPassBin(kind: 'hardBin' | 'softBin', bin: number, passBins: readonly number[], hasHardBins: boolean): boolean {
  return (kind === 'hardBin' || !hasHardBins) && passBins.includes(bin);
}

/**
 * The pass bins every wafer is judged by, or `undefined` when they differ (or there are none to
 * ask). For a surface that must name one set — a headline, or which bins count as failures — and
 * so says nothing rather than naming one wafer's set for a population judged several ways.
 */
export function commonPassBins(sets: Iterable<readonly number[] | undefined>): readonly number[] | undefined {
  let first: readonly number[] | undefined;
  for (const s of sets) {
    if (s === undefined) return undefined;
    if (first === undefined) first = s;
    else if (!sameBins(first, s)) return undefined;
  }
  return first;
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
  if (distinct.length === 0) return 'no wafers';
  if (distinct.length === 1) return one(distinct[0]);
  return `per wafer: ${distinct.map(one).join(' · ')}`;
}
