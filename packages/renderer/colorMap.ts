import { clamp01 } from '../core/utils.js';
/**
 * Spec pass/fail die colours, shared by the value-map renderer and the spec legend so both use one
 * definition. Pass = green, fail-low (below limitLow) = blue, fail-high (above limitHigh) = red.
 */
export const SPEC_PASS_FILL  = '#2ecc71';
export const SPEC_FAIL_LOW   = '#3498db';
export const SPEC_FAIL_HIGH  = '#e74c3c';

/**
 * Fill for a die with no value for what is being plotted — no bin in a bin
 * mode, no reading in a value mode. Shared by the map and every surface that
 * draws a "no data" swatch, so the two can never disagree.
 */
export const NO_DATA_FILL = '#d6d9dd';

/**
 * Categorical fallback palette for `'metadata'` mode values beyond
 * METADATA_PALETTE's fixed slots. Index 0 is a no-data grey sentinel.
 * Indices 1–63 are perceptually spread colours generated via golden-angle
 * HSL stepping.
 *
 * No longer used for bins: bin colours come from a registered bin palette,
 * indexed by bin number and pass/fail, in `resolveBinColors` (binColors.ts).
 * Hashing a bin number into this list is what made two different bins share a
 * colour.
 */
export const BIN_PALETTE: readonly string[] = [
  '#95a5a6', //  0: no data
  '#1eb84b', //  1
  '#932cdd', //  2
  '#b8a51e', //  3
  '#2cbfdd', //  4
  '#b81e71', //  5
  '#58dd2c', //  6
  '#251eb8', //  7
  '#dd672c', //  8
  '#1eb87f', //  9
  '#ce2cdd', // 10
  '#98b81e', // 11
  '#2c84dd', // 12
  '#b81e3e', // 13
  '#2cdd3b', // 14
  '#581eb8', // 15
  '#dda22c', // 16
  '#1eb8b2', // 17
  '#dd2cb0', // 18
  '#64b81e', // 19
  '#2c49dd', // 20
  '#b8321e', // 21
  '#2cdd76', // 22
  '#8c1eb8', // 23
  '#dcdd2c', // 24
  '#1e8bb8', // 25
  '#dd2c75', // 26
  '#31b81e', // 27
  '#4b2cdd', // 28
  '#b8651e', // 29
  '#2cddb1', // 30
  '#b81eb1', // 31
  '#a1dd2c', // 32
  '#1e57b8', // 33
  '#dd2c3a', // 34
  '#1eb83f', // 35
  '#852cdd', // 36
  '#b8991e', // 37
  '#2ccddd', // 38
  '#b81e7e', // 39
  '#66dd2c', // 40
  '#1e24b8', // 41
  '#dd5a2c', // 42
  '#1eb872', // 43
  '#c02cdd', // 44
  '#a4b81e', // 45
  '#2c92dd', // 46
  '#b81e4a', // 47
  '#2cdd2e', // 48
  '#4c1eb8', // 49
  '#dd942c', // 50
  '#1eb8a6', // 51
  '#dd2cbe', // 52
  '#70b81e', // 53
  '#2c57dd', // 54
  '#b8261e', // 55
  '#2cdd69', // 56
  '#801eb8', // 57
  '#ddcf2c', // 58
  '#1e97b8', // 59
  '#dd2c83', // 60
  '#3db81e', // 61
  '#3d2cdd', // 62
  '#b8591e', // 63
];

/** Wang hash — maps any integer to a well-distributed unsigned 32-bit value. Shared with colorSchemes. */
export function wangHash(n: number): number {
  let h = n | 0;
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  return (h ^ (h >>> 16)) >>> 0;
}

/** Number of palette slots available (excludes the no-data grey at index 0). */
const PALETTE_SIZE = BIN_PALETTE.length - 1;

/** Linear interpolation across RGB keypoints for t ∈ [0, 1]. */
export function lerpKp(kp: readonly [number, number, number][], t: number): string {
  const c = clamp01(t);
  const pos = c * (kp.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.min(lo + 1, kp.length - 1);
  const f = pos - lo;
  const r = Math.round(kp[lo][0] + f * (kp[hi][0] - kp[lo][0]));
  const g = Math.round(kp[lo][1] + f * (kp[hi][1] - kp[lo][1]));
  const b = Math.round(kp[lo][2] + f * (kp[hi][2] - kp[lo][2]));
  return `rgb(${r},${g},${b})`;
}

// Standard Viridis keypoints [R, G, B]
export const VIRIDIS: readonly [number, number, number][] = [
  [68,  1,  84],
  [59, 82, 139],
  [33, 145, 140],
  [94, 201,  98],
  [253, 231,  37],
];

/** Map t ∈ [0, 1] to a Viridis RGB colour string. */
export function valueToViridis(t: number): string {
  return lerpKp(VIRIDIS, t);
}

/**
 * Ordered qualitative palette for the `'metadata'` plot mode's first ~10
 * distinct values. Deliberately NOT a bin palette's pass/fail-flavoured
 * greens and reds — an arbitrary metadata field
 * (project, vendor, test site, …) has no universal "good/bad" meaning, so
 * this is a plain maximally-distinct hue set with no implied ordering.
 */
const METADATA_PALETTE: readonly string[] = [
  '#4e79a7',
  '#f28e2b',
  '#e15759',
  '#76b7b2',
  '#59a14f',
  '#edc948',
  '#b07aa1',
  '#ff9da7',
  '#9c755f',
  '#bab0ac',
];

/** Salt for the hash fallback beyond METADATA_PALETTE's fixed slots. */
const METADATA_SALT = 0x27d4eb2f;

/**
 * Categorical colour for the `index`-th distinct value of an active
 * `'metadata'` field, where `index` comes from sorting the field's distinct
 * values alphabetically (deterministic — never dependent on die array
 * iteration order). Ordered assignment, not hashing, for the first
 * `METADATA_PALETTE.length` slots — this maximizes distinctness for the
 * common case of a handful of categories, unlike a hash which doesn't
 * optimize for a *known* small set. Falls back to hashing into `BIN_PALETTE`
 * for wafers with an unusually large category count.
 */
export function metadataValueColor(index: number): string {
  if (index < METADATA_PALETTE.length) return METADATA_PALETTE[index];
  return BIN_PALETTE[(wangHash(index ^ METADATA_SALT) % PALETTE_SIZE) + 1];
}

/** Map t ∈ [0, 1] to a greyscale rgb string (range 30–230 to avoid pure black/white). */
export function valueToGreyscale(t: number): string {
  const v = Math.round(clamp01(t) * 200 + 30);
  return `rgb(${v},${v},${v})`;
}

/** Return '#000000' or '#ffffff' for maximum contrast against the given colour. */
export function contrastTextColor(cssColor: string): '#000000' | '#ffffff' {
  let r = 0, g = 0, b = 0;
  const rgb = cssColor.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
  if (rgb) {
    r = +rgb[1]; g = +rgb[2]; b = +rgb[3];
  } else {
    const hex = cssColor.replace('#', '');
    r = parseInt(hex.slice(0, 2), 16);
    g = parseInt(hex.slice(2, 4), 16);
    b = parseInt(hex.slice(4, 6), 16);
  }
  const lin = (c: number) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
  const lum = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  return lum > 0.179 ? '#000000' : '#ffffff';
}
