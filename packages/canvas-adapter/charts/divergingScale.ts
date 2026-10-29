// The colours a plot can give a continuous value: the map's gradients, and two that suit plots.
//
// The map's value gradients run from dark to light and say "low to high". A value that runs either side of zero (a
// z-score) needs a middle that is a colour of its own: blue below, a light neutral at zero and warm above, the same two
// hues as every signed scale (palette.ts), so an average cell fades into the page rather than competing with the
// extremes. A rating (a pass rate, a yield) runs from vermillion for bad to blue for good, so it survives the common
// kinds of colour blindness. Any of the map's own gradients (Viridis, Cividis, Plasma, Traffic…) can be chosen as well.
//
// `plotGradient` is the one place a plot's gradient is resolved, so the cells, the points, the colour key and the saved
// image cannot disagree about what a colour means.

import { resolveValueColorFn } from '../../renderer/colorSchemes.js';
import { SIGNED_HIGH, SIGNED_LOW } from './palette.js';

type Rgb = [number, number, number];

const fromHex = (h: string): Rgb => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const NEUTRAL: Rgb = [247, 247, 247];
const mix = (a: Rgb, b: Rgb, t: number): Rgb => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const LOW = fromHex(SIGNED_LOW), HIGH = fromHex(SIGNED_HIGH);
/** From the lowest value (t = 0) to the highest (t = 1): the signed scale's blue, a tint, a neutral, a tint, its vermillion. */
const DIVERGING: Rgb[] = [LOW, mix(LOW, NEUTRAL, 0.5), NEUTRAL, mix(HIGH, NEUTRAL, 0.5), HIGH];
/** Okabe-Ito vermillion, orange, yellow, sky blue and blue: bad at the lowest value, good at the highest. */
const RATING: Rgb[] = [[213, 94, 0], [230, 159, 0], [240, 228, 66], [86, 180, 233], [0, 114, 178]];

function along(stops: readonly Rgb[], t: number): Rgb {
  const u = Math.min(1, Math.max(0, Number.isFinite(t) ? t : 0.5)) * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(u));
  const f = u - i;
  const a = stops[i], b = stops[i + 1];
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
}

const css = ([r, g, b]: Rgb): string => `rgb(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)})`;

/** The colour at `t` in [0, 1] on the signed scale (blue below, warm above), where 0.5 is zero. */
export const divergingRgb = (t: number): Rgb => along(DIVERGING, t);
export const divergingColor = (t: number): string => css(divergingRgb(t));
/** The colour at `t` on the rating scale (vermillion for bad to blue for good). */
export const ratingRgb = (t: number): Rgb => along(RATING, t);

/** The gradients only a plot offers, beside the map's own (`listValueColorSchemes`). */
export const PLOT_GRADIENTS: ReadonlyArray<{ name: string; label: string }> = [
  { name: 'diverging', label: 'Blue to orange, around zero' },
  { name: 'rating', label: 'Rating: orange-red to blue (colour-blind safe)' },
];

/**
 * The colour of a value at `t` in [0, 1] of a plot's key. `scheme` is a name from `PLOT_GRADIENTS` or a map gradient;
 * unset, a value rescaled around zero (`diverging`) takes the signed scale, a rating (a yield, a pass rate) the rating
 * scale, and any other the map's default. `reversed` flips the key.
 */
export function plotGradient(scheme: string | undefined, reversed: boolean | undefined, diverging: boolean | undefined, rating?: boolean): (t: number) => string {
  const name = scheme ?? (diverging ? 'diverging' : rating ? 'rating' : undefined);
  const base = name === 'diverging' ? divergingColor
    : name === 'rating' ? (t: number) => css(ratingRgb(t))
    : resolveValueColorFn(name);
  return reversed ? (t: number) => base(1 - t) : base;
}

function relativeLuminance([r, g, b]: Rgb): number {
  const lin = (c: number): number => { const v = c / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** Whether dark text reads better than white on `rgb` (WCAG relative luminance: the crossover of the two contrasts). */
export const darkTextOn = (rgb: Rgb): boolean => relativeLuminance(rgb) > 0.179;

/** Whether dark text reads better on a CSS colour (`rgb(...)` or `#rgb`/`#rrggbb`); white when the colour cannot be read. */
export function darkTextOnColor(color: string): boolean {
  const rgb = /^rgba?\(\s*(\d+(?:\.\d+)?)[ ,]+(\d+(?:\.\d+)?)[ ,]+(\d+(?:\.\d+)?)/i.exec(color);
  if (rgb) return darkTextOn([Number(rgb[1]), Number(rgb[2]), Number(rgb[3])]);
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim());
  if (!hex) return false;
  const h = hex[1].length === 3 ? [...hex[1]].map(c => c + c).join('') : hex[1];
  return darkTextOn([parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]);
}
