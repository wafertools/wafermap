// Where an axis puts its ticks, and how many decimals their labels need.
// Internal — every numeric axis in the library (the map colorbar, the chart
// suite's value axes, the sweep card) routes through here.
//
// Before this file each axis had its own rule. The colorbar snapped ticks to
// round steps; the box plot, scatter, trend and sweep divided the data range
// into equal fractions, so their ticks landed on values like 2.54 / 2.04 /
// 1.53 GHz; the histogram's count axis carried an inline copy of the rounding
// rule with different breakpoints. And every one of them chose label decimals
// from each VALUE's size rather than from the spacing between ticks — so a
// 1–10 range printed "2.00 4.00 6.00" and a bandgap's 1.195–1.205 V printed
// "1.20" five times, which reads as a flat line.
//
// The rule now: ticks sit on round multiples of a 1-2-5 step, and a label shows
// exactly the decimals that step needs.

/**
 * Round a raw spacing to the nearest 1, 2 or 5 × 10ⁿ — THE rounding rule for
 * every tick grid in the library, the wafer map's own mm axes included.
 */
export function niceStep(raw: number): number {
  if (!(raw > 0) || !Number.isFinite(raw)) return 0;
  const magnitude = Math.pow(10, Math.floor(Math.log10(raw)));
  const f = raw / magnitude;
  return (f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10) * magnitude;
}

/**
 * The decimal places that show every multiple of `step` exactly — 2 → 0,
 * 0.5 → 1, 0.25 → 2, 0.002 → 3. Capped at 9, past which the step is noise in
 * a double and more digits would print it.
 */
export function stepDecimals(step: number): number {
  if (!(step > 0) || !Number.isFinite(step)) return 0;
  for (let d = 0; d <= 9; d++) {
    const scaled = step * 10 ** d;
    if (Math.abs(scaled - Math.round(scaled)) < 1e-6 * Math.max(1, scaled)) return d;
  }
  return 9;
}

/** Every multiple of `step` inside `[lo, hi]`, snapped back onto the grid. */
function gridTicks(lo: number, hi: number, step: number): number[] {
  const first = Math.ceil(lo / step - 1e-9) * step;
  const ticks: number[] = [];
  for (let v = first; v <= hi + step * 1e-9; v += step) {
    // Accumulated floating error back onto the grid: 0.1 + 0.2 must be 0.3.
    ticks.push(Number((Math.round(v / step) * step).toFixed(stepDecimals(step) + 2)));
  }
  return ticks;
}

/**
 * The densest round tick grid that fits: walks the 1-2-5 ladder from fine to
 * coarse and returns the first step whose ticks sit at least
 * `minSpacingPx(step, ticks)` apart on an axis `lengthPx` long.
 *
 * Density comes from the space, never from a fixed tick count. A fixed count
 * was the first version of this, and on a 200 px box plot it rounded the step
 * up to leave three ticks — 1.0 / 1.2 / 1.4 on data spanning 0.863–1.56, fewer
 * and coarser than the unrounded five it replaced. A horizontal axis passes the
 * widest label its step would draw plus a gap, so the step is as fine as the
 * labels allow; a vertical axis passes a line spacing.
 *
 * Ticks are only returned inside the range: an axis maps `[lo, hi]` to its
 * pixels, and extending it to reach a round number would change what the plot
 * shows, not just how it is labelled.
 */
export function fitTicks(
  lo: number,
  hi: number,
  lengthPx: number,
  minSpacingPx: (step: number, ticks: number[]) => number,
): { ticks: number[]; step: number } {
  const span = hi - lo;
  if (!(span > 0) || !Number.isFinite(span) || !(lengthPx > 0)) {
    return { ticks: Number.isFinite(lo) ? [lo] : [], step: 0 };
  }
  const MANTISSAS = [1, 2, 5];
  // Start fine enough that the ladder can only ever coarsen: a tick every 4 px.
  let exp = Math.floor(Math.log10(span / Math.max(1, lengthPx / 4)));
  let m = 0;
  for (let guard = 0; guard < 60; guard++) {
    const step = Number((MANTISSAS[m]! * 10 ** exp).toPrecision(12));
    const ticks = gridTicks(lo, hi, step);
    if (ticks.length <= 1 || (step / span) * lengthPx >= minSpacingPx(step, ticks)) return { ticks, step };
    if (++m === MANTISSAS.length) { m = 0; exp++; }
  }
  return { ticks: [lo, hi], step: span };
}
