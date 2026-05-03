import { HARD_BIN_COLORS, HARD_BIN_GREY, valueToViridis, valueToGreyscale } from './colorMap.js';

// ── Public interface ──────────────────────────────────────────────────────────

export interface ColorScheme {
  /** Human-readable display name */
  label: string;
  /**
   * Return a CSS colour string for a categorical bin number.
   * Index 0 conventionally means "no data / unknown".
   */
  forBin: (bin: number) => string;
  /**
   * Return a CSS colour string for a continuous value t ∈ [0, 1].
   * Values are pre-normalized by buildScene before this is called.
   */
  forValue: (t: number) => string;
  /**
   * Plotly colorscale for the continuous colorbar.
   * Either a named Plotly colorscale string (e.g. 'Viridis', 'Plasma') or
   * an explicit [[stop, color], …] array.  Should visually match forValue.
   */
  plotlyColorscale: string | Array<[number, string]>;
}

// ── Registry ──────────────────────────────────────────────────────────────────

const registry = new Map<string, ColorScheme>();
const aliases = new Set<string>();

/**
 * Register a named colour scheme, making it available to buildScene via the
 * colorScheme option.  Call this once at app startup before rendering.
 *
 * `forBin` and `forValue` must return valid CSS color strings — invalid values
 * produce silent rendering artifacts (blank or black rectangles).
 *
 * @example
 * registerColorScheme('my-brand', {
 *   label: 'My Brand',
 *   forBin: (bin) => MY_BRAND_BINS[bin] ?? '#ccc',
 *   forValue: (t) => `hsl(${200 + t * 60}, 70%, ${30 + t * 40}%)`,
 *   plotlyColorscale: [[0, '#3311aa'], [1, '#ffdd00']],
 * });
 */
export function registerColorScheme(name: string, scheme: ColorScheme): void {
  registry.set(name, scheme);
}

/**
 * Retrieve a registered scheme by name.  Falls back to 'default' if the name
 * is not found, so callers never receive undefined.
 */
export function getColorScheme(name?: string): ColorScheme {
  return registry.get(name ?? 'default') ?? registry.get('default')!;
}

/** Return all registered schemes as { name, label } pairs, in insertion order. */
export function listColorSchemes(): Array<{ name: string; label: string }> {
  return [...registry.entries()]
    .filter(([name]) => !aliases.has(name))
    .map(([name, s]) => ({ name, label: s.label }));
}

// ── Internal helpers ──────────────────────────────────────────────────────────

/** Clamp-and-index into a flat colour array. */
function binArray(colors: readonly string[]): (bin: number) => string {
  return (bin) => colors[Math.max(0, Math.min(bin, colors.length - 1))];
}

/** Linear interpolation across RGB keypoints for t ∈ [0, 1]. */
function lerpKp(kp: readonly [number, number, number][], t: number): string {
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

// ── Built-in schemes ──────────────────────────────────────────────────────────

/**
 * DEFAULT — colourful categorical bins, Viridis continuous gradient.
 * Good all-purpose choice for colour displays.
 */
registerColorScheme('default', {
  label: 'Default',
  forBin: binArray(HARD_BIN_COLORS),
  forValue: valueToViridis,
  plotlyColorscale: 'Viridis',
});

// 'color' kept as an alias so existing code that passed colorScheme:'color' still works.
aliases.add('color');
registerColorScheme('color', registry.get('default')!);

/**
 * GREYSCALE — grey categorical bins, grey continuous gradient.
 * Best for monochrome print output and high-contrast displays.
 */
registerColorScheme('greyscale', {
  label: 'Greyscale',
  forBin: binArray(HARD_BIN_GREY),
  forValue: valueToGreyscale,
  plotlyColorscale: [[0, 'rgb(30,30,30)'], [1, 'rgb(230,230,230)']],
});

/**
 * ACCESSIBLE — Okabe-Ito categorical palette + Cividis gradient.
 * Designed to remain distinguishable for the most common forms of colour
 * vision deficiency (deuteranopia, protanopia, tritanopia).
 * Reference: Okabe & Ito (2008), "Color Universal Design".
 */
const OKABE_ITO: readonly string[] = [
  '#aaaaaa', //  0: no data
  '#E69F00', //  1: orange
  '#56B4E9', //  2: sky blue
  '#009E73', //  3: bluish green
  '#F0E442', //  4: yellow
  '#0072B2', //  5: blue
  '#D55E00', //  6: vermillion
  '#CC79A7', //  7: reddish purple
  '#999999', //  8: medium grey
  '#f5c650', //  9: lighter orange
  '#7ecbf7', // 10: lighter sky blue
  '#4cbf99', // 11: lighter green
  '#d4c34a', // 12: olive yellow
  '#3a8fc7', // 13: medium blue
  '#c46e3a', // 14: orange-brown
];

// Cividis keypoints — blue-grey to yellow, avoids red/green transitions.
const CIVIDIS: readonly [number, number, number][] = [
  [  0,  32,  77],
  [ 54,  68, 130],
  [107, 107, 145],
  [180, 154, 108],
  [253, 228,  32],
];

registerColorScheme('accessible', {
  label: 'Accessible (Okabe-Ito / Cividis)',
  forBin: binArray(OKABE_ITO),
  forValue: (t) => lerpKp(CIVIDIS, t),
  plotlyColorscale: 'Cividis',
});

/**
 * PLASMA — vibrant purple-to-yellow palette.
 * High perceptual contrast and visually distinctive. A good alternative
 * when the default Viridis palette feels too similar across ranges.
 */
const PLASMA_BINS: readonly string[] = [
  '#888888', //  0: no data
  '#0d0887', //  1: dark blue
  '#5302a3', //  2: indigo
  '#8b0aa5', //  3: purple
  '#b83289', //  4: magenta
  '#db5c68', //  5: salmon-red
  '#f48849', //  6: orange
  '#febc2a', //  7: amber
  '#f0f921', //  8: yellow
  '#2c0594', //  9: deep indigo
  '#6a00a8', // 10: mid purple
  '#a62098', // 11: hot pink
  '#d0456d', // 12: coral
  '#ec7958', // 13: peach-orange
  '#fad44c', // 14: light amber
];

const PLASMA_KP: readonly [number, number, number][] = [
  [ 13,   8, 135],
  [126,   3, 168],
  [204,  71, 120],
  [248, 149,  64],
  [240, 249,  33],
];

registerColorScheme('plasma', {
  label: 'Plasma',
  forBin: binArray(PLASMA_BINS),
  forValue: (t) => lerpKp(PLASMA_KP, t),
  plotlyColorscale: 'Plasma',
});

/**
 * INFERNO — dark background, fire-coloured gradient.
 * High contrast on dark-themed dashboards. Strong perceptual ordering
 * from black through purple and orange to pale yellow.
 */
const INFERNO_BINS: readonly string[] = [
  '#aaaaaa', //  0: no data
  '#000004', //  1: near-black
  '#1b0c41', //  2: dark purple
  '#4a0c6b', //  3: deep violet
  '#781c6d', //  4: plum
  '#a52c60', //  5: crimson
  '#cf4446', //  6: red
  '#ed6925', //  7: orange
  '#fb9b06', //  8: amber
  '#f7d13d', //  9: pale yellow
  '#fcffa4', // 10: near-white yellow
  '#2e0a47', // 11: very dark violet
  '#8e1e6e', // 12: dark magenta
  '#c8424b', // 13: red-orange
  '#f5a623', // 14: warm orange
];

const INFERNO_KP: readonly [number, number, number][] = [
  [  0,   0,   4],
  [ 87,  16, 110],
  [188,  55,  84],
  [249, 142,   9],
  [252, 255, 164],
];

registerColorScheme('inferno', {
  label: 'Inferno',
  forBin: binArray(INFERNO_BINS),
  forValue: (t) => lerpKp(INFERNO_KP, t),
  plotlyColorscale: 'Inferno',
});
