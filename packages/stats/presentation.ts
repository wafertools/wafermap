// The rules for how a finding, an item or a yield is drawn, shared by the HTML reports and the
// Summary panel. Each surface draws with its own tools (HTML strings, DOM nodes), but what a tier
// is called, how many dots it fills and when a shortfall is tinted are decided here once: two
// copies of those rules is how the panel and the report come to disagree about the same figure.

import type { StatsSeverity } from './types.js';
import type { ImpactTier } from './synthesis.js';

/** The three steps severity and impact are drawn in. */
export type MeterTier = ImpactTier;

export const METER_DOTS = 3;

/** Dots filled for a tier: high 3, medium 2, low 1. Never zero, so the lowest tier is still marked. */
export const filledDots = (tier: MeterTier): number => (tier === 'high' ? 3 : tier === 'medium' ? 2 : 1);

/** A finding's severity as a tier and the word it is shown by. `'info'` reads "Minor". */
export const SEVERITY_MARK: Readonly<Record<StatsSeverity, { tier: MeterTier; word: string }>> = {
  unusual: { tier: 'high', word: 'Unusual' },
  notable: { tier: 'medium', word: 'Notable' },
  info: { tier: 'low', word: 'Minor' },
};

/** An item's impact (share of dies lost) as the word it is shown by. */
export const impactWord = (tier: MeterTier): string =>
  `${tier === 'medium' ? 'Moderate' : tier === 'high' ? 'High' : 'Low'} impact`;

/** Points below the reference at which a figure is tinted, strongest first. Above the reference nothing is tinted. */
const SHORTFALL_STEPS: ReadonlyArray<{ points: number; step: 1 | 2 | 3 }> = [
  { points: 4, step: 3 }, { points: 2, step: 2 }, { points: 1, step: 1 },
];

/**
 * How strongly a yield difference is tinted: 0 for none, 1–3 light to strong. Only a shortfall of a
 * point or more is tinted — a lot with nothing wrong has no tint at all, which is how a good lot is
 * recognised. `points` is signed: yield minus its reference.
 */
export function shortfallStep(points: number): 0 | 1 | 2 | 3 {
  return SHORTFALL_STEPS.find((s) => -points >= s.points)?.step ?? 0;
}

/**
 * The tint of a shortfall, one colour at three strengths, as an alpha over whatever the surface is
 * (a translucent wash reads on the report's white and on any panel theme alike). Full ink stays on
 * every step: the strongest is still under a third opaque.
 */
export const SHORTFALL_RGB = '190, 60, 60';
export const SHORTFALL_ALPHA: Readonly<Record<1 | 2 | 3, number>> = { 1: 0.10, 2: 0.20, 3: 0.32 };

/** The CSS colour for a shortfall step. */
export const shortfallColor = (step: 1 | 2 | 3): string => `rgba(${SHORTFALL_RGB}, ${SHORTFALL_ALPHA[step]})`;

/** A signed difference in yield points: `+1.2`, `−1.2` (a true minus sign), `0.0`. */
export function formatPoints(points: number): string {
  return `${points > 0 ? '+' : points < 0 ? '−' : ''}${Math.abs(points).toFixed(1)}`;
}

/** A bar's fill as a percentage of a 0–100 scale, kept in range. */
export const barPercent = (percent: number): number => Math.max(0, Math.min(100, percent));

/** The legend sentence for a column of shortfall tints, naming its reference ("the lot", "the wafer"). */
export const shortfallLegend = (reference: string): string =>
  `Bars run 0–100%. A figure is tinted when it is 1, 2 or 4 or more points below ${reference}; nothing above it is.`;

/**
 * The label for the unweighted mean of each wafer's own yield. It is not the die-weighted yield of the
 * lot (which the bin breakdown's shares are), and the name says which statistic it is: the panel, the
 * Insights population line and the reports all use this one.
 */
export const MEAN_WAFER_YIELD_LABEL = 'Mean per-wafer yield';
