// The catalogue of what wmap draws: every map mode, chart, built-in card and table, once, with the one line that says what
// it shows. Internal; pure data, no DOM.
//
// One table, so the app, the chart reference and the gallery cannot drift apart:
//
//   - a card's "About this chart" line (`canvas-adapter/charts/cardAbout.ts`) is read from here, wherever the card is
//     drawn (Insights, My plots, a drilldown window);
//   - an entry's `id` is its heading anchor on the chart reference page (`docs/charts.md#<id>`), and the gallery page
//     draws its entries in this order;
//   - `guide` names the user-guide sections that explain the statistics behind it (`guideSections.ts`).
//
// The long text (why it is useful, how to read it, pitfalls) is the reference page's only; nothing here repeats it.
// `tests/chartCatalogue.test.mjs` holds the table to what the app has: every plot chart type, every built-in card and every
// plot mode has an entry, ids are unique, and every `see` and `guide` names something that exists.

import type { PlotChart } from './plotSpec.js';
import { GUIDE_SECTIONS, type GuideSection } from './guideSections.js';

/** The built-in cards that are not plots. */
export type CardKind =
  | 'capability' | 'correlation' | 'ring-yield' | 'quadrant-yield' | 'reticle-yield'
  | 'comparison' | 'commonality' | 'pat' | 'difference-map';

/** Where a chart or table is found in Insights; `drilldown` is the menu opened on picked dies. */
export type CatalogueTab = 'overview' | 'distributions' | 'correlation' | 'data' | 'plots' | 'drilldown';

/** What an entry is: a way of colouring the map, a chart, a built-in card (a chart or a table), or a table of the Data tab. */
export type CatalogueKind = 'map' | 'chart' | 'table';

export interface CatalogueEntry {
  /** The heading anchor on the reference page, which is the slug of `title` (Zensical takes an anchor from the heading text alone): lower-case words joined by hyphens. Never reused or renamed once published. */
  id: string;
  kind: CatalogueKind;
  /** What the entry is called on the reference page and in the gallery. */
  title: string;
  /** One line: what it shows. The text of the card's "About this chart" ("About this table" on a table). */
  about: string;
  /** The ids of the built-in Insights cards that draw it (a plot card's id, or a card of the drilldown window). */
  cards?: readonly string[];
  /** The plot chart type it is, for a reader's own plot. */
  chart?: PlotChart;
  /** The built-in card that is not a plot. */
  card?: CardKind;
  /** The plot mode of the map it is (`PlotMode`), for a map entry. */
  mode?: readonly string[];
  /** The Insights tab that draws it, for a built-in card or table; `plots` is My plots, where a reader's own plot is built. */
  tab?: CatalogueTab;
  /** The example page (under `docs/examples/`) that shows it live, where it is not on an Insights tab. */
  example?: string;
  /** The user-guide sections that explain the statistics behind it. */
  guide?: readonly GuideSection[];
  /** The ids of related entries: the neighbour to reach for instead, or the one that completes it. */
  see?: readonly string[];
}

export const CHART_CATALOGUE: readonly CatalogueEntry[] = [
  // ── Maps: how the wafer is coloured ────────────────────────────────────────────────────────────────────────────────
  {
    id: 'bin-map', kind: 'map', title: 'Bin map', mode: ['hardBin', 'softBin'], example: 'display-control.html',
    about: 'Each die coloured by its hard or soft bin, passing bins in greens and failing bins in other colours, to show where the failures are.',
    see: ['test-value-map', 'bin-pareto'],
  },
  {
    id: 'test-value-map', kind: 'map', title: 'Test value map', mode: ['value'], example: 'test-values.html',
    about: 'Each die coloured by one test’s value on a colour scale, with the test’s limits on the colour bar, to show where on the wafer the value shifts.',
    see: ['bin-map', 'limit-passfail-map', 'test-passfail-map', 'value-histogram'],
  },
  {
    id: 'limit-passfail-map', kind: 'map', title: 'Limit pass/fail map', example: 'test-values.html',
    about: 'Each die coloured by whether its value for one test lies inside the test’s limits, with the dies below the low limit and above the high limit marked apart, to show where a test fails its limits.',
    see: ['test-value-map', 'test-passfail-map', 'pass-rate-by-test'],
  },
  {
    id: 'test-passfail-map', kind: 'map', title: 'Test pass/fail map', example: 'test-values.html',
    about: 'Each die coloured by the pass or fail the tester recorded for one test, to show where a test failed, whether or not it has a measured value.',
    see: ['limit-passfail-map', 'test-value-map', 'pass-rate-by-test'],
  },
  {
    id: 'die-attribute-map', kind: 'map', title: 'Die attribute map', mode: ['metadata'], example: 'metadata-mode.html',
    about: 'Each die coloured by an attribute the data carries (a test site, a probe step, a zone), to show whether a pattern follows it.',
    see: ['bin-map'],
  },
  {
    id: 'stacked-map', kind: 'map', title: 'Stacked map', mode: ['stackedBins', 'stackedSoftBins', 'stackedValues'], example: 'lot-stack-analysis.html',
    about: 'The wafers of a lot laid over one another die by die: how often a bin occurs, or a value’s mean, median or spread at each position, to show what repeats from wafer to wafer.',
    see: ['difference-map', 'reticle-cell-yield'],
  },
  {
    id: 'pat-verdict-map', kind: 'map', title: 'PAT verdict map', tab: 'overview',
    about: 'Each die coloured by its part average testing verdict (within the limits, an outlier or failing), one map per wafer, to show where the PAT outliers sit.',
    see: ['part-average-testing-pat', 'bin-map', 'test-value-map'],
  },
  {
    id: 'difference-map', kind: 'map', title: 'Difference map', card: 'difference-map', tab: 'distributions',
    about: 'One group’s wafer map less another’s, die position by die position, to show where on the wafer they differ.',
    guide: [GUIDE_SECTIONS.heatmap], see: ['stacked-map', 'comparison-by-group'],
  },

  // ── Built-in cards: yield, bins and regions ───────────────────────────────────────────────────────────────────────
  {
    id: 'yield-by-wafer', kind: 'chart', title: 'Yield by wafer', cards: ['card-yield'], tab: 'overview',
    about: 'Yield of each wafer or group: passing dies as a share of judged dies, with partial and edge-excluded dies left out. The line is the median bar.',
    see: ['bin-pareto', 'what-divides-yield'],
  },
  {
    id: 'bin-pareto', kind: 'chart', title: 'Bin pareto', cards: ['card-bin-pareto'], tab: 'overview',
    about: 'Dies in each bin, largest first, so the bins that cost the most yield lead. Shown alone, the line is the running share of all dies.',
    see: ['bin-map', 'pareto'],
  },
  {
    id: 'pass-rate-by-test', kind: 'chart', title: 'Pass rate by test', cards: ['card-pass-rate'], tab: 'overview',
    about: 'The share of judged dies that pass each test, lowest first, so the tests that fail the most dies lead.',
    see: ['process-capability', 'bin-pareto'],
  },
  {
    id: 'ring-yield', kind: 'chart', title: 'Ring yield', card: 'ring-yield', tab: 'overview',
    about: 'Yield of each ring, from the wafer centre to its edge, to show a radial pattern.',
    see: ['quadrant-yield', 'bin-map'],
  },
  {
    id: 'quadrant-yield', kind: 'chart', title: 'Quadrant yield', card: 'quadrant-yield', tab: 'overview',
    about: 'Yield of each quarter of the wafer, to show a one-sided pattern.',
    see: ['ring-yield', 'bin-map'],
  },
  {
    id: 'reticle-cell-yield', kind: 'chart', title: 'Reticle cell yield', card: 'reticle-yield', tab: 'overview',
    about: 'Yield of each position in the reticle, pooled over every shot on every wafer. A cell low everywhere points at the mask rather than the wafer.',
    see: ['stacked-map', 'ring-yield'],
  },

  // ── Built-in cards: test values ───────────────────────────────────────────────────────────────────────────────────
  {
    id: 'test-value-distribution', kind: 'chart', title: 'Test value distribution', cards: ['card-box'], tab: 'distributions',
    about: 'How one test’s values spread on each wafer or group: the box holds the middle half of the dies, the line inside it is the median, and the whiskers reach the lowest and highest values.',
    see: ['box-plot', 'value-histogram'],
  },
  {
    id: 'value-histogram', kind: 'chart', title: 'Value histogram', cards: ['card-histogram'], tab: 'distributions',
    about: 'How one test’s values are distributed: the number of dies in each value range, with the test’s limits marked.',
    see: ['histogram', 'probability-plot', 'test-value-map'],
  },
  {
    id: 'histogram-of-the-dies-picked', kind: 'chart', title: 'Histogram of the dies picked', cards: ['drill-histogram'], tab: 'drilldown',
    about: 'How one test’s values are distributed over the dies picked: the number of dies in each value range, with the test’s limits marked.',
    see: ['value-histogram'],
  },
  {
    id: 'wafer-to-wafer-trend', kind: 'chart', title: 'Wafer-to-wafer trend', cards: ['card-trend'], tab: 'distributions',
    about: 'Each wafer’s mean of one test in wafer order, with a band of one standard deviation either side, to show drift through the lot.',
    guide: [GUIDE_SECTIONS.bands], see: ['control-chart', 'line-chart'],
  },
  {
    id: 'test-scatter', kind: 'chart', title: 'Test scatter', cards: ['card-scatter'], tab: 'correlation',
    about: 'One test against another, a point per die, to show whether the two move together. r is the correlation coefficient and n the number of dies.',
    guide: [GUIDE_SECTIONS.fit], see: ['test-correlation-matrix', 'scatter-plot'],
  },
  {
    id: 'test-correlation-matrix', kind: 'chart', title: 'Test correlation matrix', card: 'correlation', tab: 'correlation',
    about: 'The correlation of every pair of tests. A strong colour means two tests move together; click a cell to show the pair in the scatter.',
    see: ['test-scatter', 'heatmap'],
  },
  {
    id: 'process-capability', kind: 'chart', title: 'Process capability', card: 'capability', tab: 'distributions',
    about: 'Every test with limits on one scale, the low limit at 0 and the high limit at 1, sorted lowest Ppk first, so the tests closest to their limits lead.',
    guide: [GUIDE_SECTIONS.goal], see: ['capability-goal-plot', 'pass-rate-by-test'],
  },

  // ── Built-in cards that are tables ────────────────────────────────────────────────────────────────────────────────
  {
    id: 'comparison-by-group', kind: 'table', title: 'Comparison by group', card: 'comparison', tab: 'distributions',
    about: 'Yield and each test compared between groups, counting each wafer once, with how likely a difference this large is by chance.',
    guide: [GUIDE_SECTIONS.groups], see: ['what-divides-yield', 'difference-map', 'box-plot'],
  },
  {
    id: 'what-divides-yield', kind: 'table', title: 'What divides yield', card: 'commonality', tab: 'overview',
    about: 'The wafer and lot fields ranked by how strongly they divide yield, as places to look for a cause.',
    guide: [GUIDE_SECTIONS.dividesYield], see: ['comparison-by-group', 'yield-by-wafer'],
  },
  {
    id: 'part-average-testing-pat', kind: 'table', title: 'Part average testing (PAT)', card: 'pat', tab: 'overview',
    about: 'Dies outside part average testing limits, set from each wafer’s own spread of each test (the AEC-Q001 method), by wafer and by test.',
    guide: [GUIDE_SECTIONS.pat], see: ['pat-verdict-map', 'process-capability', 'scatter-plot'],
  },

  // ── Plot charts: what a reader's own plot can be ──────────────────────────────────────────────────────────────────
  {
    id: 'scatter-plot', kind: 'chart', title: 'Scatter plot', chart: 'scatter', tab: 'plots',
    about: 'One field against another, a point per die or per wafer, to show whether they move together.',
    guide: [GUIDE_SECTIONS.fit], see: ['test-scatter', 'heatmap'],
  },
  {
    id: 'histogram', kind: 'chart', title: 'Histogram', chart: 'histogram', tab: 'plots',
    about: 'How a value is distributed: the number of dies or wafers in each value range.',
    see: ['value-histogram', 'probability-plot', 'box-plot'],
  },
  {
    id: 'box-plot', kind: 'chart', title: 'Box plot', chart: 'box', tab: 'plots',
    about: 'How a value spreads in each category: the box holds the middle half, the line inside it is the median, and the whiskers reach the lowest and highest values.',
    guide: [GUIDE_SECTIONS.groups], see: ['test-value-distribution', 'nested-categories', 'probability-plot'],
  },
  {
    id: 'bar-chart', kind: 'chart', title: 'Bar chart', chart: 'bar', tab: 'plots',
    about: 'A count, a share or a summary value for each category, side by side.',
    see: ['pareto', 'stacked-bars-and-shares', 'yield-by-wafer'],
  },
  {
    id: 'line-chart', kind: 'chart', title: 'Line chart', chart: 'line', tab: 'plots',
    about: 'A summary value in order along the X axis (wafer order, a test, a condition), to show a trend.',
    guide: [GUIDE_SECTIONS.bands], see: ['control-chart', 'sweep', 'wafer-to-wafer-trend'],
  },
  {
    id: 'sweep', kind: 'chart', title: 'Sweep', chart: 'sweep', tab: 'plots',
    about: 'A measured value against a swept condition, a curve per series, to show how the part responds across the range.',
    see: ['line-chart'],
  },
  {
    id: 'probability-plot', kind: 'chart', title: 'Probability plot', chart: 'probability', tab: 'plots',
    about: 'The share of values at or below each value, a curve per colour, so whole distributions compare, tails included.',
    guide: [GUIDE_SECTIONS.probability], see: ['histogram', 'box-plot'],
  },
  {
    id: 'control-chart', kind: 'chart', title: 'Control chart', chart: 'control', tab: 'plots',
    about: 'One value per wafer in order against its centre line and control limits, with the points that break a Western Electric rule marked.',
    guide: [GUIDE_SECTIONS.control], see: ['wafer-to-wafer-trend', 'line-chart', 'capability-goal-plot'],
  },
  {
    id: 'capability-goal-plot', kind: 'chart', title: 'Capability goal plot', chart: 'goal', tab: 'plots',
    about: 'Each test with both limits placed by how far its mean is off centre and how wide its spread is, as shares of its limit window. A test outside the solid triangle is short of Ppk 1.33.',
    guide: [GUIDE_SECTIONS.goal], see: ['process-capability', 'control-chart'],
  },
  {
    id: 'heatmap', kind: 'chart', title: 'Heatmap', chart: 'heatmap', tab: 'plots',
    about: 'A value for every pair of two categories, as a colour, to show where the two interact.',
    guide: [GUIDE_SECTIONS.heatmap], see: ['test-correlation-matrix', 'difference-map', 'bar-chart'],
  },

  // ── Ways a plot is built ──────────────────────────────────────────────────────────────────────────────────────────
  {
    id: 'pareto', kind: 'chart', title: 'Pareto', tab: 'plots',
    about: 'Categories largest first with a line for their running share, to show which few account for most of the total.',
    see: ['bin-pareto', 'bar-chart'],
  },
  {
    id: 'stacked-bars-and-shares', kind: 'chart', title: 'Stacked bars and shares', tab: 'plots',
    about: 'Each bar split into its colours, as counts or as each colour’s share of its own total, to show what a category is made of.',
    see: ['bar-chart'],
  },
  {
    id: 'nested-categories', kind: 'chart', title: 'Nested categories', tab: 'plots',
    about: 'A box or bar with categories inside categories, such as lots with their wafers, to show whether variation sits between or within the groups.',
    guide: [GUIDE_SECTIONS.ranges], see: ['box-plot', 'bar-chart'],
  },
  {
    id: 'panels-small-multiples', kind: 'chart', title: 'Panels (small multiples)', tab: 'plots',
    about: 'One small chart per value of a field, on shared axes, to compare the same view across groups side by side.',
    guide: [GUIDE_SECTIONS.ranges], see: ['box-plot', 'scatter-plot', 'histogram'],
  },

  // ── The Data tab's tables ─────────────────────────────────────────────────────────────────────────────────────────
  {
    id: 'statistics-table', kind: 'table', title: 'Statistics table', tab: 'data',
    about: 'One row per test and group: the count, mean, spread, extremes, limits and capability, to read the numbers behind the charts.',
    see: ['dies-table', 'process-capability'],
  },
  {
    id: 'dies-table', kind: 'table', title: 'Dies table', tab: 'data',
    about: 'One row per die with its position, bin and values, to see exactly which dies a chart counts; it exports to CSV.',
    see: ['wafers-table', 'statistics-table'],
  },
  {
    id: 'wafers-table', kind: 'table', title: 'Wafers table', tab: 'data',
    about: 'One row per wafer with its attributes and its yield, to check what each wafer is and to compare them.',
    see: ['dies-table', 'yield-by-wafer'],
  },
];

/** An entry by id. */
export function catalogueEntry(id: string): CatalogueEntry | undefined {
  return CHART_CATALOGUE.find(e => e.id === id);
}
