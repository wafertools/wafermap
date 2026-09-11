import type { Die } from '../core/dies.js';
import { diePassStatus } from '../core/dies.js';
import type { BinDef, WaferWarning } from './buildWaferMap.js';
import { getBinColorScheme, type BinColorScheme } from './colorSchemes.js';

/**
 * Resolved bin → colour assignments for one population, per bin type.
 *
 * Plain Maps, not functions, so a View carrying them survives the worker's
 * structured clone. Hard and soft bins are independent number spaces, so they
 * are resolved and looked up separately — hard bin 3 and soft bin 3 are
 * different categories and usually different colours.
 */
export interface BinColors {
  hard: Map<number, string>;
  soft: Map<number, string>;
  /**
   * Bins drawn in a colour that another bin of the same type also has — the
   * population has more pass or fail bins than the palette has colours, or a
   * defined colour duplicates one. Empty when every bin is distinguishable by
   * colour alone. Ascending bin number.
   */
  shared: { hard: number[]; soft: number[] };
}

export interface BinColorOptions {
  /** Which bins pass. Default `[1]`. Must match the `passBins` behind the yield figure. */
  passBins?: readonly number[];
  /** Registered bin palette name (`registerBinColorScheme`). Default `'default'`. */
  binColorScheme?: string;
  hbinDefs?: readonly BinDef[];
  sbinDefs?: readonly BinDef[];
  /**
   * Honour `BinDef.color` where a definition supplies one. Default true —
   * colours that arrive with the data (a site's standard bin colour sheet) win
   * over the palette. The palette still colours every bin without one.
   */
  useDefinedBinColors?: boolean;
}

/**
 * Assign every bin present in `dies` a colour — the ONE rule for bin colour,
 * shared by the map, its legends, the summary panels and the Insights charts.
 *
 * Why not a function of the bin number, as it used to be:
 * - **Pass/fail comes from `passBins`, never the number.** Passing bins take
 *   the palette's pass colours (greens) and failing bins its fail colours, so
 *   with `passBins: [1, 3]` bin 3 is green and a failing bin 12 is not. Keying
 *   colour on the number made bin 1 green even when it failed.
 * - **Rank, not hash.** Bins are ordered by die count (then bin number) and
 *   take palette slots in that order, so the bins that dominate the map get
 *   the most distinct colours and no two bins collide until the palette is
 *   exhausted. Hashing collided from the start: two of the first sixteen soft
 *   bins shared a colour exactly.
 * - **Soft bins are pass-aware too.** A soft bin passes when every die
 *   carrying it passes (by the same per-die rule yield uses); otherwise, or
 *   when no die says, it takes a fail colour. The library has the data to
 *   decide, so the caller never supplies it.
 *
 * A gallery resolves ONCE over every wafer it shows and hands the result to every
 * card (`ViewOptions.binColors`), so a bin is the same colour on every wafer.
 * A lone map resolves over its own dies.
 */
export function resolveBinColors(dies: Iterable<Die>, options: BinColorOptions = {}): BinColors {
  const passSet = new Set(options.passBins ?? [1]);
  const scheme = getBinColorScheme(options.binColorScheme);
  const useDefined = options.useDefinedBinColors ?? true;

  const hardCounts = new Map<number, number>();
  const softCounts = new Map<number, number>();
  // Soft bin → "every die carrying it passes so far". A single failing or
  // verdict-less die makes the soft bin a fail bin for colouring.
  const softAllPass = new Map<number, boolean>();
  for (const d of dies) {
    if (d.hbin != null) hardCounts.set(d.hbin, (hardCounts.get(d.hbin) ?? 0) + 1);
    if (d.sbin != null) {
      softCounts.set(d.sbin, (softCounts.get(d.sbin) ?? 0) + 1);
      const passes = diePassStatus(d, passSet) === true;
      softAllPass.set(d.sbin, (softAllPass.get(d.sbin) ?? true) && passes);
    }
  }

  const hard = assign(hardCounts, bin => passSet.has(bin), scheme, useDefined ? options.hbinDefs : undefined);
  const soft = assign(softCounts, bin => softAllPass.get(bin) === true, scheme, useDefined ? options.sbinDefs : undefined);
  return { hard: hard.colors, soft: soft.colors, shared: { hard: hard.shared, soft: soft.shared } };
}

/**
 * True when `colors` has an entry for every bin on these dies — i.e. it was
 * resolved over a population that includes them. `buildView` checks this
 * before trusting a caller-supplied assignment, since a stale one would leave
 * real bins without a colour.
 */
export function binColorsCover(colors: BinColors, dies: Iterable<Die>): boolean {
  for (const d of dies) {
    if (d.hbin != null && !colors.hard.has(d.hbin)) return false;
    if (d.sbin != null && !colors.soft.has(d.sbin)) return false;
  }
  return true;
}

/**
 * The advisory for bins sharing a colour on the bin map being shown, or null
 * (none share, or `plotMode` is not a bin mode). One builder so the single map
 * and the gallery word it identically.
 *
 * Severity `'warning'`: every die is still drawn correctly, but the viewer can
 * no longer tell those bins apart by colour — an expected capability is
 * degraded, which is what that level means.
 */
export function binColorWarning(colors: BinColors, plotMode: string | undefined): WaferWarning | null {
  const kind = plotMode === 'softBin' ? 'soft' : plotMode === 'hardBin' ? 'hard' : null;
  if (!kind) return null;
  const shared = colors.shared[kind];
  if (!shared.length) return null;
  const list = shared.length > 8
    ? `${shared.slice(0, 8).join(', ')} and ${shared.length - 8} more`
    : shared.join(', ');
  return {
    code: 'bin-colors-shared',
    severity: 'warning',
    message: `${kind === 'hard' ? 'Hard' : 'Soft'} bins ${list} are drawn in a colour another bin also has, `
      + 'so colour alone cannot tell them apart. There are more bins than the colour scheme has distinct '
      + 'colours (or a bin definition repeats one). Use the legend, the tooltip, or highlight one bin at a time.',
  };
}

function assign(
  counts: Map<number, number>,
  isPass: (bin: number) => boolean,
  scheme: BinColorScheme,
  defs: readonly BinDef[] | undefined,
): { colors: Map<number, string>; shared: number[] } {
  const defined = new Map<number, string>();
  for (const d of defs ?? []) if (d.color) defined.set(d.bin, d.color);

  const colors = new Map<number, string>();
  const passing: number[] = [];
  const failing: number[] = [];
  for (const bin of counts.keys()) {
    const own = defined.get(bin);
    // A defined colour takes no palette slot, so the remaining bins still get
    // the palette's most distinct colours.
    if (own !== undefined) colors.set(bin, own);
    else (isPass(bin) ? passing : failing).push(bin);
  }

  const byRank = (a: number, b: number) => (counts.get(b)! - counts.get(a)!) || a - b;
  for (const [bins, palette] of [[passing, scheme.pass], [failing, scheme.fail]] as const) {
    bins.sort(byRank);
    bins.forEach((bin, i) => colors.set(bin, palette[i % palette.length]));
  }

  // Whatever the cause — palette exhausted, or a defined colour that happens
  // to equal a palette colour — two bins in one colour cannot be told apart on
  // the map, and the viewer has to be told.
  const byColor = new Map<string, number[]>();
  for (const [bin, color] of colors) {
    const key = color.toLowerCase();
    byColor.set(key, [...(byColor.get(key) ?? []), bin]);
  }
  const shared = [...byColor.values()].filter(b => b.length > 1).flat().sort((a, b) => a - b);
  return { colors, shared };
}
