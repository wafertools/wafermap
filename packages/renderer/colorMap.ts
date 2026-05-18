/** Categorical colors for hard bins. Index 0 = no data. */
export const HARD_BIN_COLORS: readonly string[] = [
  '#95a5a6', // 0: no data
  '#2ecc71', // 1: pass
  '#e74c3c', // 2: fail
  '#f39c12', // 3: marginal
  '#9b59b6', // 4
  '#3498db', // 5
  '#1abc9c', // 6
  '#e67e22', // 7
  '#2c3e50', // 8
  '#c0392b', // 9
  '#8e44ad', // 10
  '#2980b9', // 11
  '#27ae60', // 12
  '#d35400', // 13
  '#16a085', // 14
];

export function hardBinColor(bin: number): string {
  return HARD_BIN_COLORS[Math.max(0, Math.min(bin, HARD_BIN_COLORS.length - 1))];
}

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

/** Map a bin number to a position on the Viridis scale. */
export function softBinColor(bin: number, maxBin = 6): string {
  return valueToViridis(bin / maxBin);
}

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
