/**
 * Shared categorical palette for hard and soft bin colouring.
 * Index 0 is the no-data grey sentinel. Indices 1–63 are perceptually
 * spread colours generated via golden-angle HSL stepping.
 * Hard and soft bins use different hash salts so the same bin number
 * maps to different colours in each scheme.
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

/** Wang hash — maps any integer to a well-distributed unsigned 32-bit value. */
function binHash(n: number): number {
  let h = n | 0;
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  return (h ^ (h >>> 16)) >>> 0;
}

/** Number of palette slots available for coloured bins (excludes the no-data grey at index 0). */
const PALETTE_SIZE = BIN_PALETTE.length - 1;

/** Hard-bin salt — ensures hard and soft bins of the same number get different colours. */
const HARD_SALT = 0x9e3779b9;
/** Soft-bin salt. */
const SOFT_SALT = 0x6c62272e;

/**
 * Bins 1–14 use hand-picked colours chosen for maximum distinctiveness in the
 * low-bin range that appears on most wafers. Bin 15+ uses the hash.
 */
const HARD_BIN_OVERRIDES: Record<number, string> = {
   1: '#2ecc71', // pass
   2: '#e74c3c', // fail
   3: '#f39c12', // marginal
   4: '#9b59b6',
   5: '#3498db',
   6: '#1abc9c',
   7: '#e67e22',
   8: '#2c3e50',
   9: '#c0392b',
  10: '#8e44ad',
  11: '#2980b9',
  12: '#27ae60',
  13: '#d35400',
  14: '#16a085',
};

/** Categorical colour for a hard bin. No-data handling is the caller's responsibility. */
export function hardBinColor(bin: number): string {
  return HARD_BIN_OVERRIDES[bin] ?? BIN_PALETTE[(binHash(bin ^ HARD_SALT) % PALETTE_SIZE) + 1];
}

/** @deprecated Use BIN_PALETTE directly if you need the raw array. */
export const HARD_BIN_COLORS: readonly string[] = BIN_PALETTE;

/** Linear interpolation across RGB keypoints for t ∈ [0, 1]. */
export function lerpKp(kp: readonly [number, number, number][], t: number): string {
  const c = Math.max(0, Math.min(1, t));
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

/** Categorical colour for a soft bin. No-data handling is the caller's responsibility. */
export function softBinColor(bin: number): string {
  return BIN_PALETTE[(binHash(bin ^ SOFT_SALT) % PALETTE_SIZE) + 1];
}

/** @deprecated Use BIN_PALETTE directly if you need the raw array. */
export const SOFT_BIN_COLORS: readonly string[] = BIN_PALETTE;

/** Categorical greyscale shades for hard bins. Index 0 = no data. */
export const HARD_BIN_GREY: readonly string[] = [
  '#aaaaaa', // 0: no data
  '#f7f7f7', // 1: pass (lightest — clearly distinct)
  '#303030', // 2: fail (darkest)
  '#888888', // 3: marginal
  '#bbbbbb', // 4
  '#666666', // 5
  '#999999', // 6
  '#555555', // 7
  '#444444', // 8
  '#222222', // 9
  '#cccccc', // 10
  '#777777', // 11
  '#eeeeee', // 12
  '#333333', // 13
  '#888888', // 14
];

export function hardBinGreyscale(bin: number): string {
  return HARD_BIN_GREY[Math.max(0, Math.min(bin, HARD_BIN_GREY.length - 1))];
}

/** Map t ∈ [0, 1] to a greyscale rgb string (range 30–230 to avoid pure black/white). */
export function valueToGreyscale(t: number): string {
  const v = Math.round(Math.max(0, Math.min(1, t)) * 200 + 30);
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
