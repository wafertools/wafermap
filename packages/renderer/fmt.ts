import { stepDecimals } from './axisTicks.js';

const SI_PREFIXES: [number, string][] = [
  [1e12, 'T'], [1e9, 'G'], [1e6, 'M'], [1e3, 'k'],
  [1, ''], [1e-3, 'm'], [1e-6, 'µ'], [1e-9, 'n'], [1e-12, 'p'], [1e-15, 'f'],
];

/** Multiplier per SI prefix letter. Exported for the one place that PARSES a
 *  prefixed number (`stats/sweepXFromName.ts`), so reading and printing values
 *  agree on every prefix. Internal — not re-exported from the package. */
export const SI_PREFIX_SCALE: Record<string, number> = {
  T: 1e12, G: 1e9, M: 1e6, k: 1e3,
  m: 1e-3, µ: 1e-6, u: 1e-6, n: 1e-9, p: 1e-12, f: 1e-15,
};

// Base units test defs commonly carry (electrical + frequency). Used only to detect a caller
// passing an already-prefixed unit (e.g. "MHz", "nA") despite the documented contract that
// `unit` must be the bare base unit — see docs/api.md's TestDef.unit note.
// Also read by `stats/sweepXFromName.ts`, to tell a prefix before a unit
// (`12kΩ`, `10GHz`) from a letter that merely starts a word (`12Kangaroos`).
export const KNOWN_BASE_UNITS = ['Hz', 'V', 'A', 'W', 'F', 'Ω', 'Ohm', 'ohm', 'S', 'H', 'J', 'C', 's'];

/**
 * If `unit` looks like a known base unit with a single SI-prefix letter stuck on the front
 * (e.g. "MHz" = M + Hz, "nA" = n + A), return the scale that converts a value already expressed
 * in that prefixed unit back to the bare base unit, plus the bare unit itself. Otherwise `unit`
 * is treated as already bare (scale 1) — this is what keeps `fmt(2100, 'MHz')` from rendering as
 * the double-prefixed "kMHz" instead of "2.10 GHz".
 */
function resolveUnitPrefix(unit: string): { preScale: number; base: string } {
  for (const base of KNOWN_BASE_UNITS) {
    if (unit.length === base.length + 1 && unit.endsWith(base)) {
      const p = unit[0];
      if (p in SI_PREFIX_SCALE) return { preScale: SI_PREFIX_SCALE[p], base };
    }
  }
  return { preScale: 1, base: unit };
}

function siFormat(v: number, unit: string): string {
  const { preScale, base } = resolveUnitPrefix(unit);
  const baseValue = v * preScale;
  const abs = Math.abs(baseValue);
  const [scale, prefix] = SI_PREFIXES.find(([s]) => abs >= s * 0.9999) ?? [1e-15, 'f'];
  const scaled = baseValue / scale;
  const a = Math.abs(scaled);
  const digits = a >= 100 ? 0 : a >= 10 ? 1 : 2;
  return `${scaled.toFixed(digits)} ${prefix}${base}`;
}

function engFormat(v: number): string {
  const abs = Math.abs(v);
  const exp3 = Math.floor(Math.log10(abs) / 3) * 3;
  const clamped = Math.max(-15, Math.min(12, exp3));
  const scaled = v / Math.pow(10, clamped);
  const a = Math.abs(scaled);
  const digits = a >= 100 ? 0 : a >= 10 ? 1 : 2;
  const expStr = clamped === 0 ? '' : `E${clamped > 0 ? '+' : ''}${clamped}`;
  return `${scaled.toFixed(digits)}${expStr}`;
}

/**
 * Plain-language labels for lot-stack aggregation methods. Maps internal API terms to the words
 * shown to the user (e.g. `countBin` → "occurrence count"). Shared by the canvas map title and the
 * DOM summary panel so both name the method identically.
 */
export const AGGREGATION_METHOD_LABELS: Record<string, string> = {
  mean: 'mean', median: 'median', stddev: 'std dev', min: 'min', max: 'max',
  count: 'count', countBin: 'occurrence count', percent: 'occurrence %',
};

/** Format an aggregation method for display, falling back to the raw key or "aggregated". */
export function fmtAggregationMethod(method: string | undefined): string {
  return AGGREGATION_METHOD_LABELS[method ?? ''] ?? method ?? 'aggregated';
}

/**
 * Map internal bin terms to plain language for display — "HBin 2" →
 * "hard bin 2" (CLAUDE.md: internal API terms must never appear in the UI).
 * Shared by the Summary panel and the printable reports so both surfaces
 * speak the same language; stats-level `StatsFinding` text keeps the
 * compact internal terms (they're also machine-consumed and test-asserted).
 */
export function plainBinTerms(text: string): string {
  return text.replace(/\bHBin\b/g, 'hard bin').replace(/\bSBin\b/g, 'soft bin');
}

/**
 * Format a numeric value for display (tooltips, overlays, single-value labels).
 *
 * - With a unit: always uses SI prefix (e.g. `12 µV`).
 * - Without a unit, `fallbackFormat: 'si'`: SI prefix with no unit suffix (e.g. `12 µ`).
 * - Without a unit, `fallbackFormat: 'engineering'` (default): fixed decimal for [0.1, 9999],
 *   engineering notation (E±N, multiples of 3) outside that range.
 */
export function fmt(v: number, unit?: string, fallbackFormat?: 'si' | 'engineering'): string {
  if (!isFinite(v)) return String(v);
  const abs = Math.abs(v);
  if (abs === 0) return unit ? `0 ${unit}` : '0';
  if (unit !== undefined) return siFormat(v, unit);
  if (fallbackFormat === 'si') return siFormat(v, '');
  if (abs >= 0.1 && abs < 1e4) {
    return abs >= 1000 ? v.toFixed(0) : abs >= 100 ? v.toFixed(1) : abs >= 10 ? v.toFixed(2) : v.toFixed(3);
  }
  return engFormat(v);
}

/**
 * A tick label in a shared scale. With `step` — the spacing of the ticks being
 * labelled — every label carries exactly the decimals that step needs
 * (`stepDecimals`): a 1–10 axis in steps of 2 reads "2 4 6 8", and a bandgap's
 * 1.195–1.205 V in steps of 2 mV reads "1.196 1.198 1.200". Without a step the
 * decimals follow each value's own size — the right rule for a lone value such
 * as a die label, and the wrong one for a tick grid, where it printed "2.00" on
 * a coarse axis and "1.20" five times on a fine one.
 */
function makeTickFormatter(scale: number, step?: number): (v: number) => string {
  const fixed = step !== undefined && step > 0 ? stepDecimals(step / scale) : undefined;
  return (v: number): string => {
    if (!isFinite(v)) return String(v);
    if (v === 0) return '0';
    const scaled = v / scale;
    if (fixed !== undefined) return scaled.toFixed(fixed);
    const a = Math.abs(scaled);
    const digits = a >= 100 ? 0 : a >= 10 ? 1 : 2;
    return scaled.toFixed(digits);
  };
}

/**
 * A data value shown at an axis end — the colorbar's exact min and max — which
 * is not on the tick grid. One decimal more than the ticks, dropped again when
 * it is a zero: with the ticks' own decimals a 9.87 maximum on a 2-step axis
 * would print as "10", a value past the data.
 */
function makeEdgeFormatter(scale: number, step: number | undefined, tick: (v: number) => string): (v: number) => string {
  if (step === undefined || !(step > 0)) return tick;
  const d = stepDecimals(step / scale) + 1;
  return (v: number): string => {
    if (!isFinite(v)) return String(v);
    if (v === 0) return '0';
    const s = (v / scale).toFixed(d);
    return s.endsWith('0') ? s.slice(0, d === 1 ? -2 : -1) : s;
  };
}

export interface AxisFormat {
  /** A tick label: a bare number in the axis's shared scale. */
  tickFmt: (v: number) => string;
  /** A data value at an axis end (not on the tick grid) — see `makeEdgeFormatter`. */
  edgeFmt: (v: number) => string;
  /** Name plus scaled unit, shown once for the axis — e.g. `"Idsat (mA)"`. */
  axisLabel: string;
  /** The scaled unit alone (`"mA"`), for an axis that prints it on every tick; `''` when none. */
  scaledUnit: string;
}

/**
 * The formatting for one numeric axis: a shared SI scale chosen from `vRef`
 * (typically the largest-magnitude value), applied to every tick so the axis
 * reads consistently, with the scaled unit returned once.
 *
 * Pass `step` — the spacing of the ticks, from `fitTicks` (`axisTicks.ts`) —
 * for a tick grid. Omit it for lone values, which keep size-based decimals.
 * Without a unit, values in [0.1, 9999] are unscaled and, with no step, use
 * `fmt()` as before.
 */
export function fmtColorbarAxis(
  vRef: number,
  name: string | null | undefined,
  unit: string | undefined,
  fallbackFormat: 'si' | 'engineering' = 'engineering',
  step?: number,
): AxisFormat {
  const abs = Math.abs(vRef);
  const build = (scale: number, axisLabel: string, scaledUnit: string, plain?: (v: number) => string): AxisFormat => {
    const tickFmt = plain && step === undefined ? plain : makeTickFormatter(scale, step);
    return { tickFmt, edgeFmt: makeEdgeFormatter(scale, step, tickFmt), axisLabel, scaledUnit };
  };

  if (unit) {
    // With unit: pick SI prefix from vRef (folded back to the bare base unit first, in case
    // `unit` itself is already prefixed — see resolveUnitPrefix), ticks are bare scaled numbers,
    // label carries prefix+unit.
    const { preScale, base } = resolveUnitPrefix(unit);
    const baseAbs = abs * preScale;
    const [scale, prefix] = baseAbs === 0
      ? ([1, ''] as [number, string])
      : (SI_PREFIXES.find(([s]) => baseAbs >= s * 0.9999) ?? [1e-15, 'f']);

    const scaledUnit = `${prefix}${base}`;
    return build(scale / preScale, name ? `${name} (${scaledUnit})` : scaledUnit, scaledUnit);
  }

  // No unit. Values in the normal display range [0.1, 9999] need no scaling —
  // ticks show as plain numbers and the label is just the name.
  if (abs === 0 || (abs >= 0.1 && abs < 1e4)) {
    return build(1, name ?? '', '', v => fmt(v, undefined, fallbackFormat));
  }

  if (fallbackFormat === 'si') {
    // SI prefix mode: scale ticks by the SI prefix factor; label uses ×10ⁿ notation
    // (the prefix letter alone is cryptic without a unit).
    const [scale] = SI_PREFIXES.find(([s]) => abs >= s * 0.9999) ?? [1e-15, 'f'];
    const exp      = Math.round(Math.log10(scale));
    const expLabel = exp === 0 ? '' : `×10E${exp}`;
    return build(scale, name ? (expLabel ? `${name} (${expLabel})` : name) : expLabel, expLabel);
  }

  // Engineering mode: pick the shared E±N exponent from vRef, ticks are bare scaled numbers,
  // label carries the exponent so "8.00" with "Cgg ×10⁻¹⁵" is unambiguous.
  const exp3    = Math.floor(Math.log10(abs) / 3) * 3;
  const clamped = Math.max(-15, Math.min(12, exp3));
  const scale   = Math.pow(10, clamped);
  const expLabel  = clamped === 0 ? '' : `×10E${clamped}`;
  return build(scale, name ? (expLabel ? `${name} (${expLabel})` : name) : expLabel, expLabel);
}

