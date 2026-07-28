import { clamp01 } from '../../core/utils.js';
// Chart-only colour vocabulary for the Insights panels.
//
// Deliberately decoupled from the wafer map's registered colour schemes
// (renderer/colorSchemes.ts): those ramps encode *die values on the map*,
// and reusing them for chart quantities misfires badly — the default
// thermal ramp rendered a 95% yield ring saturated red (alarm colour for
// an objectively good number), and a data-range-normalized ramp let a
// *better* wafer draw redder than a worse one. Charts instead follow three
// fixed rules:
//
// - **Quantity** (bar lengths, box fills, histogram mass): one neutral
//   colour. The geometry already carries the value; colour variation would
//   only add false meaning. Inherently colour-vision-safe.
// - **Identity** (which bin, which group): bins keep the *map's* scheme
//   (`forBin`) so the same bin is the same colour in both views — including
//   the accessible scheme when the user selects it. Facet groups, which
//   have no map identity, use the Okabe-Ito colour-blind-safe categorical
//   palette below.
// - **Semantics** (capable/marginal/poor, correlated/anti-correlated):
//   fixed Okabe-Ito hues, always reinforced by position or a label so
//   colour is never the sole carrier.
//
// This is why Insights has no colour-scheme picker of its own: identity
// colours follow the map's picker automatically, and everything else is
// CVD-safe by construction.

/** Neutral single fill for "how much" encodings (bars, boxes, histogram). */
export const QUANTITY = '#4e79a7';

/**
 * Okabe-Ito colour-blind-safe categorical palette — group/series identity
 * only (facet groups, overlaid histogram series), never quantities.
 * Yellow is omitted: it is illegible as a thin line/small swatch on white.
 */
const CATEGORICAL = ['#0072B2', '#E69F00', '#009E73', '#CC79A7', '#56B4E9', '#D55E00', '#8C6D31', '#999999'];

export function categorical(i: number): string {
  return CATEGORICAL[((i % CATEGORICAL.length) + CATEGORICAL.length) % CATEGORICAL.length];
}

function lerpHex(a: string, b: string, t: number): string {
  const pa = [parseInt(a.slice(1, 3), 16), parseInt(a.slice(3, 5), 16), parseInt(a.slice(5, 7), 16)];
  const pb = [parseInt(b.slice(1, 3), 16), parseInt(b.slice(3, 5), 16), parseInt(b.slice(5, 7), 16)];
  const c = pa.map((v, i) => Math.round(v + (pb[i] - v) * t));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

/**
 * Sequential fill for a yield percentage on a **fixed** domain — light at
 * ≤50%, deepest at 100% — so the same yield is always the same colour
 * across wafers, lots, and renders (a data-range-normalized ramp lets a
 * better wafer render more alarming than a worse one). Single-hue blue:
 * "more saturated = higher yield", monotonic in lightness, CVD-safe, and
 * never reads as an alarm. The visible label chips remain the primary
 * carrier of the number; this fill is reinforcement only.
 */
export function yieldFill(yieldPercent: number): string {
  const t = clamp01((yieldPercent - 50) / 50);
  return lerpHex('#e7eef6', '#2f6395', t);
}

/**
 * Semantic capability colour from Ppk against the conventional 1.33
 * threshold: capable (≥1.33), marginal (≥1.0), poor (<1.0). Okabe-Ito
 * hues (bluish green / orange / vermillion) rather than pure green/red so
 * the distinction survives the common colour-vision deficiencies; the
 * per-column Ppk value in the tooltip and the worst-first sort carry the
 * same information positionally.
 */
export function capabilityColor(ppk: number | null): string {
  if (ppk === null) return '#999999';
  return ppk >= 1.33 ? '#009E73' : ppk >= 1.0 ? '#E69F00' : '#D55E00';
}

/** Correlation sign hues (blue = positive, vermillion = negative); |r| sets intensity via background blend. */
export const CORRELATION_POSITIVE = '#0072B2';
export const CORRELATION_NEGATIVE = '#D55E00';
