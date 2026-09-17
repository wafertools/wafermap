import type { Die } from '../core/dies.js';
import { diePassStatus } from '../core/dies.js';
import { INPUT_DEFAULT_PASS_BINS, itemPassBins } from '../core/passBins.js';
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
   * Bins drawn in a colour that another bin of the same type also has — two
   * bins present whose numbers land on the same palette slot (they differ by a
   * multiple of the palette's length), or a defined colour that duplicates one.
   * Empty when every bin is distinguishable by colour alone. Ascending bin number.
   */
  shared: { hard: number[]; soft: number[] };
  /**
   * Bins that pass, per type — the verdict the colours were chosen with. Hard:
   * the bins in `passBins`. Soft: bins whose every die passes. Read this, never
   * `passBins`, to order, total or judge SOFT bins: `passBins` holds hard-bin
   * numbers, so testing a soft bin against it treats soft bin 1 as a pass and
   * soft bin 100 as a fail whatever their dies did.
   */
  pass: { hard: Set<number>; soft: Set<number> };
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
 * - **Pass/fail comes from `passBins`, never the number.** Passing bins take
 *   the palette's pass colours (greens) and failing bins its fail colours, so
 *   with `passBins: [1, 3]` bin 3 is green and a failing bin 1 is not.
 * - **Which colour is keyed by bin number, never by die count.** A pass bin
 *   takes `pass[(bin − 1) mod n]` and a fail bin `fail[(bin − 2) mod n]`: bin 1
 *   (the conventional pass bin) and bin 2 (the conventional first fail bin)
 *   land on the front, most distinct colour of each list, and the low bin
 *   numbers most programs use get the clearest colours. So bin 7 is the same
 *   colour in every lot, gallery subset and screenshot of a program, which is
 *   how engineers learn to read a bin map. This used to rank bins by die count,
 *   which gave "the biggest fail bin" a colour rather than any bin — two lots of
 *   one program drew the same bin in different colours. Before that it hashed
 *   the number, which collided two of the first sixteen soft bins; a modular
 *   index collides only at a palette's length apart, and `shared` names those.
 * - **The slot counts from the bin number alone**, not its position among the
 *   pass or fail bins, so changing `passBins` recolours only the bins whose
 *   verdict changed.
 * - **Soft bins are pass-aware too.** A soft bin passes when every die
 *   carrying it passes (by the same per-die rule yield uses); otherwise, or
 *   when no die says, it takes a fail colour. The library has the data to
 *   decide, so the caller never supplies it.
 * - **Soft bins read the palette shifted by half its length**, so hard bin n
 *   and soft bin n are different colours by default. They are separate number
 *   spaces and are never on screen together, but a shared colour invites
 *   reading one as the other.
 *
 * A gallery resolves ONCE over every wafer it shows and hands the result to every
 * card (`ViewOptions.binColors`): a `BinDef.color` supplied by one item then
 * colours that bin on every card, and `shared` describes the whole gallery.
 * A lone map resolves over its own dies.
 */
export function resolveBinColors(dies: Iterable<Die>, options: BinColorOptions = {}): BinColors {
  return resolveBinColorsByWafer([{ dies, passBins: options.passBins }], options).colors;
}

/** The inputs a built map carries for its bin colours. A `WaferMapResult` is one. */
export interface BinColorSource {
  dies: Iterable<Die>;
  /** The pass bins the map was built with (`WaferMapResult.passBins`). */
  passBins?: readonly number[];
  hbinDefs?: readonly BinDef[];
  sbinDefs?: readonly BinDef[];
}

/** Display choices for `binColorsForMaps` — the palette and whether defined colours win. */
export interface MapBinColorOptions {
  /** Registered bin palette name (`registerBinColorScheme`). Default `'default'`. */
  binColorScheme?: string;
  /** Honour `BinDef.color`. Default true. */
  useDefinedBinColors?: boolean;
}

/**
 * The bin colours for one or more built maps — exactly the colours
 * `renderWaferMap` and `renderWaferGallery` draw them in, for a host surface of
 * its own: a table swatch, a PDF, a chart in another library.
 *
 * Takes the maps rather than dies and a `passBins` list, so pass/fail cannot be
 * judged by the wrong bins: each map's dies are judged by that map's own
 * `passBins`, and bin definitions (with any `BinDef.color`) are merged across the
 * maps, first definition of a bin winning — the gallery's own rule. For a live
 * map with the user's palette choice, read `WaferMapController.getBinColors()` or
 * `GalleryController.getBinColors()` instead.
 */
export function binColorsForMaps(
  maps: BinColorSource | readonly BinColorSource[],
  options: MapBinColorOptions = {},
): BinColors {
  return resolveBinColorsForMaps(Array.isArray(maps) ? maps : [maps as BinColorSource], options).colors;
}

/** @internal `binColorsForMaps` plus the hard bins that pass on some maps and fail on others. */
export function resolveBinColorsForMaps(
  maps: readonly BinColorSource[],
  options: MapBinColorOptions = {},
): { colors: BinColors; mixedHardBins: number[] } {
  return resolveBinColorsByWafer(
    maps.map(m => ({ dies: m.dies, passBins: itemPassBins(m) })),
    { ...options, hbinDefs: mergeBinDefs(maps.map(m => m.hbinDefs)), sbinDefs: mergeBinDefs(maps.map(m => m.sbinDefs)) },
  );
}

/**
 * @internal Bin definitions merged across maps: one per bin, the first map's
 * definition winning. The one rule for a multi-map legend, report or colouring.
 */
export function mergeBinDefs(lists: Iterable<readonly BinDef[] | undefined>): BinDef[] {
  const seen = new Set<number>();
  const out: BinDef[] = [];
  for (const list of lists) for (const d of list ?? []) {
    if (seen.has(d.bin)) continue;
    seen.add(d.bin);
    out.push(d);
  }
  return out;
}

/** One wafer's dies and the pass bins that wafer was built with. */
export interface BinPassGroup {
  dies: Iterable<Die>;
  /** Omitted ⇒ the input convention `[1]` — pass `WaferMapResult.passBins`. */
  passBins?: readonly number[];
}

/**
 * `resolveBinColors` over several wafers that may carry DIFFERENT pass bins — a
 * gallery of wafers from more than one test program. Each die is judged by its
 * own wafer's `passBins`, and a bin passes only when every die carrying it
 * passes (for one wafer that is exactly "the bin is in `passBins`").
 *
 * `mixedHardBins` names hard bins that pass on some wafers and fail on others.
 * One colour and one legend row cannot be right for both, so the gallery states
 * it (`mixedPassBinsWarning`) rather than letting either wafer's verdict
 * silently stand for all of them.
 */
export function resolveBinColorsByWafer(
  groups: Iterable<BinPassGroup>,
  options: Omit<BinColorOptions, 'passBins'> = {},
): { colors: BinColors; mixedHardBins: number[] } {
  const scheme = getBinColorScheme(options.binColorScheme);
  const useDefined = options.useDefinedBinColors ?? true;
  const t = tallyGroups(groups);
  const hard = assign(t.hardBins, bin => t.pass.hard.has(bin), scheme, useDefined ? options.hbinDefs : undefined, false);
  const soft = assign(t.softBins, bin => t.pass.soft.has(bin), scheme, useDefined ? options.sbinDefs : undefined, true);
  return {
    colors: { hard: hard.colors, soft: soft.colors, shared: { hard: hard.shared, soft: soft.shared }, pass: t.pass },
    mixedHardBins: t.mixedHardBins,
  };
}

/**
 * Which hard and soft bins pass — `BinColors.pass` without the colours, for a
 * caller that has dies but no resolved assignment (the summary report). The same
 * tally `resolveBinColors` uses, so the two cannot disagree about a verdict.
 */
export function binPassSets(dies: Iterable<Die>, passBins?: readonly number[]): BinColors['pass'] {
  return tallyGroups([{ dies, passBins }]).pass;
}

/** `binPassSets` over wafers that each carry their own pass bins. */
export function binPassSetsByWafer(groups: Iterable<BinPassGroup>): BinColors['pass'] {
  return tallyGroups(groups).pass;
}

/** One pass over every group's dies — each may be a generator, so each is iterated once. */
function tallyGroups(groups: Iterable<BinPassGroup>) {
  // Bin → "every die carrying it passes so far". A single failing or
  // verdict-less die makes the bin a fail bin. Keys are the bins present.
  const hardAllPass = new Map<number, boolean>();
  const softAllPass = new Map<number, boolean>();
  const hardPassedSomewhere = new Set<number>();
  for (const g of groups) {
    const passSet = new Set(g.passBins ?? INPUT_DEFAULT_PASS_BINS);
    for (const d of g.dies) {
      const passes = diePassStatus(d, passSet) === true;
      if (d.hbin != null) {
        hardAllPass.set(d.hbin, (hardAllPass.get(d.hbin) ?? true) && passes);
        if (passes) hardPassedSomewhere.add(d.hbin);
      }
      if (d.sbin != null) softAllPass.set(d.sbin, (softAllPass.get(d.sbin) ?? true) && passes);
    }
  }
  const passing = (m: Map<number, boolean>) => new Set([...m].filter(([, p]) => p).map(([b]) => b));
  const pass = { hard: passing(hardAllPass), soft: passing(softAllPass) };
  return {
    hardBins: [...hardAllPass.keys()],
    softBins: [...softAllPass.keys()],
    pass,
    mixedHardBins: [...hardPassedSomewhere].filter(b => !pass.hard.has(b)).sort((a, b) => a - b),
  };
}

/** "3, 7, 12" — or the first eight "and N more". Shared by every bin advisory. */
function formatBinList(bins: readonly number[]): string {
  return bins.length > 8
    ? `${bins.slice(0, 8).join(', ')} and ${bins.length - 8} more`
    : bins.join(', ');
}

/** The `pass-bins-mixed` advisory for `resolveBinColorsByWafer`'s `mixedHardBins`, or null. */
export function mixedPassBinsWarning(bins: readonly number[]): WaferWarning | null {
  if (!bins.length) return null;
  const one = bins.length === 1;
  return {
    code: 'pass-bins-mixed',
    severity: 'warning',
    message: `Hard ${one ? 'bin' : 'bins'} ${formatBinList(bins)} ${one ? 'passes' : 'pass'} on some wafers and `
      + `${one ? 'fails' : 'fail'} on others: these wafers were built with different pass bins. Each wafer's own `
      + 'yield and die verdicts are correct, but a bin has one colour and one legend row, so '
      + `${one ? 'it is' : 'they are'} shown as failing there.`,
  };
}

/**
 * True when `colors` has an entry for every bin on these dies — i.e. it was
 * resolved over a population that includes them. `buildView` checks this
 * before trusting a caller-supplied assignment, since a stale one would leave
 * real bins without a colour.
 */
export function binColorsCover(colors: BinColors, dies: Iterable<Die>): boolean {
  // An assignment built before `pass` existed (a host holding an old object)
  // cannot order or total soft bins; resolve afresh rather than crash on it.
  if (!colors.pass) return false;
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
  const list = formatBinList(shared);
  return {
    code: 'bin-colors-shared',
    severity: 'warning',
    message: `${kind === 'hard' ? 'Hard' : 'Soft'} bins ${list} are drawn in a colour another bin also has, `
      + 'so colour alone cannot tell them apart. There are more bins than the colour scheme has distinct '
      + 'colours (or a bin definition repeats one). Use the legend, the tooltip, or highlight one bin at a time.',
  };
}

/** The bin number that takes the front colour of each list — see `resolveBinColors`. */
const FIRST_PASS_BIN = 1;
const FIRST_FAIL_BIN = 2;

/** `palette[(bin − first) mod n]`, shifted half a palette for soft bins. */
function paletteColor(palette: readonly string[], bin: number, first: number, soft: boolean): string {
  const n = palette.length;
  const offset = soft ? Math.floor(n / 2) : 0;
  return palette[(((bin - first + offset) % n) + n) % n];
}

function assign(
  bins: Iterable<number>,
  isPass: (bin: number) => boolean,
  scheme: BinColorScheme,
  defs: readonly BinDef[] | undefined,
  soft: boolean,
): { colors: Map<number, string>; shared: number[] } {
  const defined = new Map<number, string>();
  for (const d of defs ?? []) if (d.color) defined.set(d.bin, d.color);

  const colors = new Map<number, string>();
  for (const bin of bins) {
    colors.set(bin, defined.get(bin) ?? (isPass(bin)
      ? paletteColor(scheme.pass, bin, FIRST_PASS_BIN, soft)
      : paletteColor(scheme.fail, bin, FIRST_FAIL_BIN, soft)));
  }

  // Whatever the cause — two bin numbers a palette-length apart, or a defined
  // colour that happens to equal a palette colour — two bins in one colour
  // cannot be told apart on the map, and the viewer has to be told.
  const byColor = new Map<string, number[]>();
  for (const [bin, color] of colors) {
    const key = color.toLowerCase();
    byColor.set(key, [...(byColor.get(key) ?? []), bin]);
  }
  const shared = [...byColor.values()].filter(b => b.length > 1).flat().sort((a, b) => a - b);
  return { colors, shared };
}
