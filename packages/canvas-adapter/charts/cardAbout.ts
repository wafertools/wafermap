// What each Insights card and each plot chart type shows, in one line: the text of a card's "About this chart" ("About
// this table" on a table).
//
// One table, so a card says the same thing wherever it is drawn (Insights, My plots, a drilldown window). Keyed by the
// built-in card's id, and by chart type for a reader's own plot.

import type { PlotChart } from '../../stats/plotSpec.js';

/** The built-in cards that are not plots. */
export type CardKind =
  | 'capability' | 'correlation' | 'ring-yield' | 'quadrant-yield' | 'reticle-yield'
  | 'comparison' | 'commonality' | 'pat' | 'difference-map';

const CARDS: Record<string, string> = {
  'card-yield': 'Yield of each wafer or group: passing dies as a share of judged dies, with partial and edge-excluded dies left out. The line is the median bar.',
  'card-bin-pareto': 'Dies in each bin, largest first, so the bins that cost the most yield lead. Shown alone, the line is the running share of all dies.',
  'card-pass-rate': 'The share of judged dies that pass each test, lowest first, so the tests that fail the most dies lead.',
  'card-box': 'How one test’s values spread on each wafer or group: the box holds the middle half of the dies, the line inside it is the median, and the whiskers reach the lowest and highest values.',
  'card-histogram': 'How one test’s values are distributed: the number of dies in each value range, with the test’s limits marked.',
  'card-trend': 'Each wafer’s mean of one test in wafer order, with a band of one standard deviation either side, to show drift through the lot.',
  'card-scatter': 'One test against another, a point per die, to show whether the two move together. r is the correlation coefficient and n the number of dies.',
  'drill-histogram': 'How one test’s values are distributed over the dies picked: the number of dies in each value range, with the test’s limits marked.',
  capability: 'Every test with limits on one scale, the low limit at 0 and the high limit at 1, sorted lowest Ppk first, so the tests closest to their limits lead.',
  correlation: 'The correlation of every pair of tests. A strong colour means two tests move together; click a cell to show the pair in the scatter.',
  'ring-yield': 'Yield of each ring, from the wafer centre to its edge, to show a radial pattern.',
  'quadrant-yield': 'Yield of each quarter of the wafer, to show a one-sided pattern.',
  'reticle-yield': 'Yield of each position in the reticle, pooled over every shot on every wafer. A cell low everywhere points at the mask rather than the wafer.',
  comparison: 'Yield and each test compared between groups, counting each wafer once, with how likely a difference this large is by chance.',
  commonality: 'The wafer and lot fields ranked by how strongly they divide yield, as places to look for a cause.',
  pat: 'Dies outside part average testing limits, set from each wafer’s own spread of each test (the AEC-Q001 method), by wafer and by test.',
  'difference-map': 'One group’s wafer map less another’s, die position by die position, to show where on the wafer they differ.',
};

const CHARTS: Record<PlotChart, string> = {
  scatter: 'One field against another, a point per die or per wafer, to show whether they move together.',
  histogram: 'How a value is distributed: the number of dies or wafers in each value range.',
  box: 'How a value spreads in each category: the box holds the middle half, the line inside it is the median, and the whiskers reach the lowest and highest values.',
  bar: 'A count, a share or a summary value for each category, side by side.',
  line: 'A summary value in order along the X axis (wafer order, a test, a condition), to show a trend.',
  sweep: 'A measured value against a swept condition, a curve per series, to show how the part responds across the range.',
  probability: 'The share of values at or below each value, a curve per colour, so whole distributions compare, tails included.',
  control: 'One value per wafer in order against its centre line and control limits, with the points that break a Western Electric rule marked.',
  goal: 'Each test with both limits placed by how far its mean is off centre and how wide its spread is, as shares of its limit window. A test outside the solid triangle is short of Ppk 1.33.',
  heatmap: 'A value for every pair of two categories, as a colour, to show where the two interact.',
};

/** The cards that are tables, whose menu row reads "About this table". */
const TABLES: ReadonlySet<CardKind> = new Set(['comparison', 'commonality', 'pat']);

/** A card's About line, and what the card is, which names its menu row. */
export interface CardAboutLine { text: string; noun: 'chart' | 'table' }

/** The About line of a plot: its built-in card's, or its chart type's for a reader's own plot. */
export function plotAbout(spec: { id: string; chart: PlotChart }): CardAboutLine {
  const card = spec.id.startsWith('card-pass-rate-') ? 'card-pass-rate' : spec.id;
  return { text: CARDS[card] ?? CHARTS[spec.chart], noun: 'chart' };
}

/** The About line of a built-in card that is not a plot. */
export function cardAbout(kind: CardKind): CardAboutLine {
  return { text: CARDS[kind], noun: TABLES.has(kind) ? 'table' : 'chart' };
}

/** @internal Every line the table holds, for tests. */
export const ABOUT_LINES = { cards: CARDS, charts: CHARTS };
