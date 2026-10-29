// Shading for table cells: a colour behind a number, so a table can be read across before it is read digit by digit.
//
// Four rules, the same everywhere a table uses them:
//   - a value compared with its peers (a group's mean among the groups, a wafer's mean among the wafers) is blue below the
//     average and warm above it, the signed scale's two hues (palette.ts), fading to nothing at the average;
//   - a yield is tinted only when it falls short of its reference, by the one rule the summary report and the docked panel
//     use (stats/presentation.ts `shortfallStep`): a lot with nothing wrong has no tint at all;
//   - a Ppk takes the capable, marginal and poor colours the capability chart uses;
//   - a value outside its test's limits is warm.
// The shade is translucent, so it sits on a light or a dark table alike and the cell's own text colour stays legible, and
// it is only ever a second cue: the number is always printed.

import { SIGNED_HIGH, SIGNED_LOW, capabilityColor } from './charts/palette.js';
import { NEGLIGIBLE_SPREAD, maxOf, minOf } from '../core/utils.js';
import { shortfallColor, shortfallStep } from '../stats/presentation.js';

type Rgb = [number, number, number];

const fromHex = (h: string): Rgb => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const rgba = ([r, g, b]: Rgb, alpha: number): string => `rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}, ${alpha.toFixed(2)})`;

/** The strongest a shade gets: a cell is tinted, never filled. */
const STRONGEST = 0.42;
/** Below this share of the largest deviation a cell is left unshaded: nothing to say. */
const QUIET = 0.05;

/**
 * A value among its peers, as a shade: `fraction` is its deviation from their average over the largest deviation among
 * them, from −1 to 1. Blue below, warm above, stronger the further it is, nothing at the average.
 */
export function signedShade(fraction: number): string | undefined {
  if (!Number.isFinite(fraction)) return undefined;
  const f = Math.max(-1, Math.min(1, fraction));
  if (Math.abs(f) < QUIET) return undefined;
  return rgba(fromHex(f < 0 ? SIGNED_LOW : SIGNED_HIGH), STRONGEST * Math.abs(f));
}

/**
 * The shade of each value among the others of its set, by `signedShade`: the deviation from the set's mean over the
 * set's largest deviation. A set of one, or of equal values, has no shade, and neither has a set whose values print the
 * same (`show`) or differ by under 1% of their mean: a colour must not tell apart numbers the table shows as one.
 */
export function shadesAmong(values: readonly number[], show?: (v: number) => string): Array<string | undefined> {
  const finite = values.filter(Number.isFinite);
  if (finite.length < 2) return values.map(() => undefined);
  if (show && new Set(finite.map(show)).size < 2) return values.map(() => undefined);
  const mean = finite.reduce((a, b) => a + b, 0) / finite.length;
  const far = maxOf(finite.map(v => Math.abs(v - mean)));
  if (!(far > 0)) return values.map(() => undefined);
  // A spread of under 1% of the mean is too small to colour, however far apart its ends are within it.
  if (mean !== 0 && (maxOf(finite) - minOf(finite)) / Math.abs(mean) < NEGLIGIBLE_SPREAD) return values.map(() => undefined);
  return values.map(v => signedShade((v - mean) / far));
}

/**
 * A yield's shortfall below its reference, in points (yield minus reference, so negative is short), tinted by the summary
 * report's rule: a point or more short is light, two medium, four strong; nothing at or above the reference.
 */
export function shortfallShade(points: number | null | undefined): string | undefined {
  if (points === null || points === undefined || !Number.isFinite(points)) return undefined;
  const step = shortfallStep(points);
  return step ? shortfallColor(step) : undefined;
}

/** A Ppk as capable (1.33 and over), marginal (1.0 and over) or poor, in the capability chart's colours. */
export function capabilityShade(ppk: number | null | undefined): string | undefined {
  if (ppk === null || ppk === undefined || !Number.isFinite(ppk)) return undefined;
  return rgba(fromHex(capabilityColor(ppk)), 0.3);
}

/** A value outside its limits, in the warm hue. */
export function outOfLimitsShade(): string {
  return rgba(fromHex(SIGNED_HIGH), 0.3);
}
