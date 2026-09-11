import { VIRIDIS, lerpKp, valueToGreyscale } from './colorMap.js';

// Two registries, not one.
//
// Bin palettes and value gradients used to be fused into a single `ColorScheme`
// object ({ forBin, forValue }) selected by one `colorScheme` option. Every
// consequence of that was a defect:
//   - a bin map and a value map could not keep separate choices, so picking a
//     gradient for values and switching to a bin mode reset it (the "not
//     bin-compatible" reset, written out in three places);
//   - every value scheme had to carry a bin palette nobody could select, and a
//     host's own registered bin palette could never appear in the bin menu,
//     which filtered by hardcoded name;
//   - bin colours were hashed from the bin NUMBER, which guarantees identical
//     colours for different bins and ties "green" to bin 1 regardless of
//     `passBins`.
// Bins are categories and values are a continuum; they are chosen, persisted
// and resolved separately. Bin colours are assigned by `resolveBinColors`
// (binColors.ts) from the palette's pass and fail lists — see there for why.

// ── Value gradients ───────────────────────────────────────────────────────────

export interface ValueColorScheme {
  /** Human-readable display name. */
  label: string;
  /**
   * Return a CSS colour string for a continuous value t ∈ [0, 1]. Values are
   * pre-normalized by buildView before this is called.
   */
  forValue: (t: number) => string;
}

const valueRegistry = new Map<string, ValueColorScheme>();

/**
 * Register a named value gradient, making it selectable via the
 * `valueColorScheme` option and listed in the toolbar for value and stacked
 * modes. Call once at startup, before rendering.
 *
 * `forValue` must return a valid CSS colour — an invalid string renders as a
 * silent blank or black die.
 */
export function registerValueColorScheme(name: string, scheme: ValueColorScheme): void {
  valueRegistry.set(name, scheme);
}

/** Retrieve a value gradient by name. Falls back to `'default'`, never undefined. */
export function getValueColorScheme(name?: string): ValueColorScheme {
  return valueRegistry.get(name ?? 'default') ?? valueRegistry.get('default')!;
}

/** All registered value gradients as `{ name, label }`, in registration order. */
export function listValueColorSchemes(): Array<{ name: string; label: string }> {
  return [...valueRegistry.entries()].map(([name, s]) => ({ name, label: s.label }));
}

// ── Bin palettes ──────────────────────────────────────────────────────────────

export interface BinColorScheme {
  /** Human-readable display name. */
  label: string;
  /**
   * Colours for passing bins, handed out most-populous bin first. Convention is
   * greens: an engineer reads green as pass before reading the legend.
   */
  pass: readonly string[];
  /**
   * Colours for failing bins, handed out most-populous bin first, so put the
   * most distinct colours at the front. Must not resemble the pass colours —
   * a fail bin that reads as a pass is the most expensive misreading a wafer
   * map can produce.
   */
  fail: readonly string[];
}

const binRegistry = new Map<string, BinColorScheme>();

/**
 * Register a named bin palette, making it selectable via the `binColorScheme`
 * option and listed in the toolbar for hard/soft-bin modes. Call once at
 * startup, before rendering.
 *
 * Throws on an empty `pass` or `fail` list: there would be nothing to colour
 * that category with, and the failure is better at registration than as
 * uncoloured dies later.
 */
export function registerBinColorScheme(name: string, scheme: BinColorScheme): void {
  if (!scheme.pass.length || !scheme.fail.length) {
    throw new Error(`registerBinColorScheme('${name}'): 'pass' and 'fail' must each list at least one colour`);
  }
  binRegistry.set(name, scheme);
}

/** Retrieve a bin palette by name. Falls back to `'default'`, never undefined. */
export function getBinColorScheme(name?: string): BinColorScheme {
  return binRegistry.get(name ?? 'default') ?? binRegistry.get('default')!;
}

/** All registered bin palettes as `{ name, label }`, in registration order. */
export function listBinColorSchemes(): Array<{ name: string; label: string }> {
  return [...binRegistry.entries()].map(([name, s]) => ({ name, label: s.label }));
}

// ── Built-in value gradients ──────────────────────────────────────────────────

/**
 * Thermal gradient keypoints: blue → cyan → yellow → red. Reads low→high
 * intuitively (blue = cold/low, red = hot/high), the convention semiconductor
 * engineers expect for parametric/electrical value maps.
 *
 * This IS the default gradient. A separate "Thermal" entry with the same
 * keypoints used to sit beside it — two menu rows drawing identical maps.
 */
const THERMAL_KP: readonly [number, number, number][] = [
  [  0,   0, 255],  // blue
  [  0, 255, 255],  // cyan
  [255, 255,   0],  // yellow
  [255,   0,   0],  // red
];

registerValueColorScheme('default', {
  label: 'Default (Blue–Cyan–Yellow–Red)',
  forValue: (t) => lerpKp(THERMAL_KP, t) });

/** Perceptually uniform purple → yellow. */
registerValueColorScheme('viridis', {
  label: 'Viridis',
  forValue: (t) => lerpKp(VIRIDIS, 1 - t) });

// Cividis keypoints — blue-grey to yellow, avoids red/green transitions.
const CIVIDIS: readonly [number, number, number][] = [
  [  0,  32,  77],
  [ 54,  68, 130],
  [107, 107, 145],
  [180, 154, 108],
  [253, 228,  32],
];

/**
 * Cividis — designed to read the same with and without the common forms of
 * colour-vision deficiency. Was named 'accessible' when bins and values shared
 * one scheme; the bin half of that is now the 'accessible' bin palette.
 */
registerValueColorScheme('cividis', {
  label: 'Cividis (colour-blind safe)',
  forValue: (t) => lerpKp(CIVIDIS, 1 - t) });

/** Grey ramp — monochrome print output. */
registerValueColorScheme('greyscale', {
  label: 'Greyscale',
  forValue: (t) => valueToGreyscale(1 - t) });

const PLASMA_KP: readonly [number, number, number][] = [
  [ 13,   8, 135],
  [126,   3, 168],
  [204,  71, 120],
  [248, 149,  64],
  [240, 249,  33],
];

/** Vibrant, perceptually uniform purple → yellow. */
registerValueColorScheme('plasma', {
  label: 'Plasma',
  forValue: (t) => lerpKp(PLASMA_KP, 1 - t) });

const INFERNO_KP: readonly [number, number, number][] = [
  [  0,   0,   4],
  [ 87,  16, 110],
  [188,  55,  84],
  [249, 142,   9],
  [252, 255, 164],
];

/** Black → purple → orange → pale yellow; strong ordering on dark dashboards. */
registerValueColorScheme('inferno', {
  label: 'Inferno',
  forValue: (t) => lerpKp(INFERNO_KP, 1 - t) });

const TRAFFIC_KP: readonly [number, number, number][] = [
  [ 46, 204,  113],  // green
  [241, 196,   15],  // yellow
  [231,  76,   60],  // red
];

/**
 * Green → yellow → red, for parameters where low is good and high is bad.
 * Not colour-blind safe (the ends are a red/green pair).
 */
registerValueColorScheme('traffic', {
  label: 'Traffic (Green–Yellow–Red)',
  forValue: (t) => lerpKp(TRAFFIC_KP, t) });

/**
 * The classic MATLAB rainbow: dark navy → blue → cyan → yellow → red → dark red.
 * Offered for familiarity only — like every rainbow ramp it is not perceptually
 * uniform; prefer Viridis or Cividis when read accuracy or colour-blind safety
 * matters.
 */
const JET_KP: readonly [number, number, number][] = [
  [  0,   0, 128],  // dark navy
  [  0,   0, 255],  // blue
  [  0, 255, 255],  // cyan
  [255, 255,   0],  // yellow
  [255,   0,   0],  // red
  [128,   0,   0],  // dark red
];

registerValueColorScheme('jet', {
  label: 'Jet (MATLAB rainbow)',
  forValue: (t) => lerpKp(JET_KP, t) });

// ── Built-in bin palettes ─────────────────────────────────────────────────────
//
// Both lists were selected by measurement, not by eye: a greedy max–min pick
// (CIEDE2000) from the Okabe-Ito, Paul Tol, Kelly, Tableau and d3 categorical
// sets, keeping clear of the no-data, dimmed, partial and edge-excluded fills
// and excluding every green from the fail list. The front of each list is the
// most distinct, because the most populous fail bins take the front slots.
// `tests/binPalettes.test.mjs` re-measures them and fails if an edit erodes the
// separation, so change these through that test, not around it.

/**
 * Default — 3 pass greens, 19 fail colours, every pair ≥ 16 ΔE00 apart for
 * normal colour vision. The largest fail bin is red, matching the usual
 * pass-green / fail-red reading.
 */
registerBinColorScheme('default', {
  label: 'Default',
  pass: ['#2ca02c', '#98df8a', '#1b5e20'],
  fail: [
    '#d62728', '#332288', '#e69f00', '#000000', '#0072b2', '#654522', '#ff9d9a',
    '#aa3377', '#499894', '#e377c2', '#f0e442', '#225555', '#79706e', '#33bbee',
    '#ee7733', '#999933', '#9467bd', '#663333', '#cc6677',
  ],
});

/**
 * Colour-blind safe — 2 pass colours (Okabe-Ito bluish green family), 14 fail
 * colours, every pair ≥ 8.8 ΔE00 apart under simulated deuteranopia,
 * protanopia AND tritanopia simultaneously. Fewer colours than Default because
 * that is what the constraint allows; past 14 fail bins the colours repeat and
 * the map raises a `bin-colors-shared` warning. `markFailingDies` adds a
 * pass/fail channel that does not depend on colour at all.
 */
registerBinColorScheme('accessible', {
  label: 'Colour-blind safe',
  pass: ['#009e73', '#44bb99'],
  fail: [
    '#d55e00', '#000000', '#604e97', '#882d17', '#f3c300', '#222255', '#225555',
    '#a1caf1', '#9467bd', '#8c564b', '#b07aa1', '#eedd88', '#f38400', '#663333',
  ],
});
