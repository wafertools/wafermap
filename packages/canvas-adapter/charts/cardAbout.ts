// What each Insights card and each plot chart type shows, in one line: the text of a card's "About this chart" ("About
// this table" on a table).
//
// One table, so a card says the same thing wherever it is drawn (Insights, My plots, a drilldown window) and the chart
// reference says it too: the lines live in `stats/chartCatalogue.ts`, and this reads them. Keyed by the built-in card's id,
// and by chart type for a reader's own plot.

import type { PlotChart } from '../../stats/plotSpec.js';
import { CHART_CATALOGUE, type CardKind } from '../../stats/chartCatalogue.js';

export type { CardKind };

/** The About lines by built-in card id, by built-in card kind and by plot chart type: read from the catalogue, written there once. */
const CARDS: Record<string, string> = {};
const KINDS = {} as Record<CardKind, string>;
const CHARTS = {} as Record<PlotChart, string>;
for (const e of CHART_CATALOGUE) {
  for (const id of e.cards ?? []) CARDS[id] = e.about;
  if (e.card) KINDS[e.card] = e.about;
  if (e.chart) CHARTS[e.chart] = e.about;
}

/** The cards that are tables, whose menu row reads "About this table". */
const TABLES: ReadonlySet<CardKind> = new Set(CHART_CATALOGUE.flatMap(e => (e.kind === 'table' && e.card ? [e.card] : [])));

/** A card's About line, and what the card is, which names its menu row. */
export interface CardAboutLine { text: string; noun: 'chart' | 'table' }

/** The About line of a plot: its built-in card's, or its chart type's for a reader's own plot. */
export function plotAbout(spec: { id: string; chart: PlotChart }): CardAboutLine {
  const card = spec.id.startsWith('card-pass-rate-') ? 'card-pass-rate' : spec.id;
  return { text: CARDS[card] ?? CHARTS[spec.chart], noun: 'chart' };
}

/** The About line of a built-in card that is not a plot. */
export function cardAbout(kind: CardKind): CardAboutLine {
  return { text: KINDS[kind], noun: TABLES.has(kind) ? 'table' : 'chart' };
}

/** @internal Every line the table holds, for tests. */
export const ABOUT_LINES = { cards: CARDS, charts: CHARTS };
