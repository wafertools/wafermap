import { BIN_PALETTE, HARD_BIN_GREY, VIRIDIS, lerpKp, valueToGreyscale, hardBinColor, wangHash } from './colorMap.js';

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
   * Values are pre-normalized by buildView before this is called.
   */
  forValue: (t: number) => string;
}

// ── Registry ──────────────────────────────────────────────────────────────────

interface SchemeRecord extends ColorScheme {
  isAlias?: boolean;
}

const registry = new Map<string, SchemeRecord>();

/**
 * Register a named colour scheme, making it available to buildView via the
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
 * });
 */
export function registerColorScheme(name: string, scheme: ColorScheme): void {
  registry.set(name, scheme as SchemeRecord);
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
    .filter(([, s]) => !s.isAlias)
    .map(([name, s]) => ({ name, label: s.label }));
}

// ── Internal helpers ──────────────────────────────────────────────────────────

/**
 * Hash a bin number into a colour array, skipping index 0 (reserved for no-data).
 * Different salts give different mappings for the same bin number. Uses the shared
 * Wang hash from colorMap so the hashing is defined in exactly one place.
 */
function binHash(colors: readonly string[], salt: number): (bin: number) => string {
  const slots = colors.length - 1;
  return (bin) => colors[(wangHash(bin ^ salt) % slots) + 1];
}

// ── Built-in schemes ──────────────────────────────────────────────────────────

/**
 * Thermal gradient keypoints: blue → cyan → yellow → red. Reads low→high
 * intuitively (blue = cold/low, red = hot/high), the convention semiconductor
 * engineers expect for parametric/electrical value maps. Shared by both the
 * `default` and `thermal` schemes — the canonical continuous value gradient.
 */
const THERMAL_KP: readonly [number, number, number][] = [
  [  0,   0, 255],  // blue
  [  0, 255, 255],  // cyan
  [255, 255,   0],  // yellow
  [255,   0,   0],  // red
];

/**
 * DEFAULT — colourful categorical bins, blue→cyan→yellow→red value gradient.
 * Good all-purpose choice for colour displays. The continuous gradient reads
 * low→high intuitively (blue=low, red=high), unlike a Viridis ramp.
 */
registerColorScheme('default', {
  label: 'Default',
  forBin: hardBinColor,
  forValue: (t) => lerpKp(THERMAL_KP, t),
});

/**
 * VIRIDIS — purple-to-yellow perceptually uniform gradient for both bins and values.
 * Unlike Default (which uses categorical colours for bins), Viridis maps bin numbers
 * sequentially through the gradient — useful when bins represent ordered severity levels.
 */
registerColorScheme('viridis', {
  label: 'Viridis',
  forBin:  (bin) => lerpKp(VIRIDIS, Math.min(bin, 16) / 16),
  forValue: (t) => lerpKp(VIRIDIS, 1 - t),
});

// 'color' kept as an alias so existing code that passed colorScheme:'color' still works.
registry.set('color', { ...registry.get('default')!, isAlias: true });

/**
 * GREYSCALE — grey categorical bins, grey continuous gradient.
 * Best for monochrome print output and high-contrast displays.
 */
registerColorScheme('greyscale', {
  label: 'Greyscale',
  forBin: binHash(HARD_BIN_GREY, 0x9e3779b9),
  forValue: (t) => valueToGreyscale(1 - t),
});

/**
 * ACCESSIBLE — 63-entry colourblind-safe categorical palette + Cividis gradient.
 * Designed to remain distinguishable for the most common forms of colour
 * vision deficiency (deuteranopia, protanopia, tritanopia).
 *
 * Palette design follows Okabe-Ito (2008) principles: four hue families chosen
 * from CVD-safe zones (blue 202–256°, orange/yellow 26–57°, teal 160–192°,
 * purple/pink 283–324°), three lightness tiers each (light 62%, mid 47%,
 * dark 33%), 6+5+5+5 hues = 63 colour slots. Index 0 = no-data grey.
 */
const ACCESSIBLE_PALETTE: readonly string[] = [
  '#aaaaaa', //  0: no data
  '#51b3ec', //  1: blue light
  '#5199ec', //  2: blue light
  '#517fec', //  3: blue light
  '#5165ec', //  4: blue light
  '#5b51ec', //  5: blue light
  '#7a51ec', //  6: blue light
  '#1891d8', //  7: blue mid
  '#1871d8', //  8: blue mid
  '#1851d8', //  9: blue mid
  '#1832d8', // 10: blue mid
  '#2518d8', // 11: blue mid
  '#4b18d8', // 12: blue mid
  '#116697', // 13: blue dark
  '#115097', // 14: blue dark
  '#113997', // 15: blue dark
  '#112397', // 16: blue dark
  '#1a1197', // 17: blue dark
  '#351197', // 18: blue dark
  '#f39349', // 19: orange light
  '#f3a749', // 20: orange light
  '#f3bb49', // 21: orange light
  '#f3d149', // 22: orange light
  '#f3eb49', // 23: orange light
  '#e16a0e', // 24: orange mid
  '#e1820e', // 25: orange mid
  '#e19b0e', // 26: orange mid
  '#e1b70e', // 27: orange mid
  '#e1d70e', // 28: orange mid
  '#9e4a0a', // 29: orange dark
  '#9e5c0a', // 30: orange dark
  '#9e6d0a', // 31: orange dark
  '#9e810a', // 32: orange dark
  '#9e970a', // 33: orange dark
  '#54e8b7', // 34: teal light
  '#54e8ca', // 35: teal light
  '#54e8de', // 36: teal light
  '#54dee8', // 37: teal light
  '#54cae8', // 38: teal light
  '#1dd396', // 39: teal mid
  '#1dd3af', // 40: teal mid
  '#1dd3c7', // 41: teal mid
  '#1dc7d3', // 42: teal mid
  '#1dafd3', // 43: teal mid
  '#149469', // 44: teal dark
  '#14947b', // 45: teal dark
  '#14948c', // 46: teal dark
  '#148c94', // 47: teal dark
  '#147b94', // 48: teal dark
  '#bb5ce0', // 49: purple light
  '#d35ce0', // 50: purple light
  '#e05cd5', // 51: purple light
  '#e05cbf', // 52: purple light
  '#e05cab', // 53: purple light
  '#9b26c9', // 54: purple mid
  '#b926c9', // 55: purple mid
  '#c926bc', // 56: purple mid
  '#c926a1', // 57: purple mid
  '#c92688', // 58: purple mid
  '#6d1b8d', // 59: purple dark
  '#821b8d', // 60: purple dark
  '#8d1b84', // 61: purple dark
  '#8d1b71', // 62: purple dark
  '#8d1b60', // 63: purple dark
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
  label: 'Accessible (CVD-safe / Cividis)',
  forBin:  binHash(ACCESSIBLE_PALETTE, 0x9e3779b9),
  forValue: (t) => lerpKp(CIVIDIS, 1 - t),
});

/**
 * PLASMA — vibrant purple-to-yellow palette.
 * High perceptual contrast and visually distinctive. A good perceptually-uniform
 * alternative to the default blue→red (thermal) value gradient.
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
  forBin: binHash(PLASMA_BINS, 0x9e3779b9),
  forValue: (t) => lerpKp(PLASMA_KP, 1 - t),
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
  forBin: binHash(INFERNO_BINS, 0x9e3779b9),
  forValue: (t) => lerpKp(INFERNO_KP, 1 - t),
});

/**
 * TRAFFIC — green → yellow → red.
 * Domain-standard for semiconductor parametric maps where low values are
 * good (passing) and high values are bad (failing or out-of-spec).
 * Immediately readable by process and yield engineers without a legend.
 */
const TRAFFIC_BINS: readonly string[] = [
  '#aaaaaa', //  0: no data
  '#27ae60', //  1: green
  '#e74c3c', //  2: red
  '#f39c12', //  3: amber
  '#2ecc71', //  4: light green
  '#c0392b', //  5: dark red
  '#f1c40f', //  6: yellow
  '#1e8449', //  7: dark green
  '#e67e22', //  8: orange
  '#a9cce3', //  9: pale blue
  '#922b21', // 10: deep red
  '#82e0aa', // 11: pale green
  '#d4e6f1', // 12: very pale blue
  '#fdebd0', // 13: pale orange
  '#d5f5e3', // 14: very pale green
];

const TRAFFIC_KP: readonly [number, number, number][] = [
  [ 46, 204,  113],  // green
  [241, 196,   15],  // yellow
  [231,  76,   60],  // red
];

registerColorScheme('traffic', {
  label: 'Traffic (Green–Yellow–Red)',
  forBin: binHash(TRAFFIC_BINS, 0x9e3779b9),
  forValue: (t) => lerpKp(TRAFFIC_KP, t),
});

/**
 * THERMAL — blue → cyan → yellow → red.
 * Conventional for parametric/electrical test maps (resistance, voltage,
 * timing). Blue reads as "cold/low", red as "hot/high".
 */
const THERMAL_BINS: readonly string[] = [
  '#aaaaaa', //  0: no data
  '#2980b9', //  1: blue
  '#e74c3c', //  2: red
  '#1abc9c', //  3: teal
  '#f39c12', //  4: amber
  '#8e44ad', //  5: purple
  '#e67e22', //  6: orange
  '#3498db', //  7: light blue
  '#c0392b', //  8: dark red
  '#16a085', //  9: dark teal
  '#f1c40f', // 10: yellow
  '#154360', // 11: dark blue
  '#922b21', // 12: deep red
  '#d6eaf8', // 13: pale blue
  '#fdedec', // 14: pale red
];

registerColorScheme('thermal', {
  label: 'Thermal (Blue–Cyan–Yellow–Red)',
  forBin: binHash(THERMAL_BINS, 0x9e3779b9),
  forValue: (t) => lerpKp(THERMAL_KP, t),
});
