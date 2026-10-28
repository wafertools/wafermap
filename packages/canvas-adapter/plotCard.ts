// A built-in Insights card drawn by the plot renderer: a `CardSpec` (stats/cardSpec.ts) resolved over the tab's
// population, with the slots filled from the tab each time it draws, and any choice of the card's own (Hard or Soft
// bins, the sort) as a segmented control that swaps the spec. The same chart a reader's plot is, so a card and a plot of
// the same thing cannot disagree.

import { resolvePlot, type PlotContext, type PlotItem, type PlotPoint, type ResolvedPlot } from '../stats/plotData.js';
import { fillCard, freezeCard, type CardSlotValues, type CardSpec } from '../stats/cardSpec.js';
import { newPlotId, type PlotSpec } from '../stats/plotSpec.js';
import { renderPlotChart, type PlotChartOptions } from './charts/plotChart.js';
import { makeBackButton, makeSegmented } from './charts/chartShell.js';
import { markNoPrint } from './toolbar.js';

type ChoiceOptions = Array<[value: string, label: string, hint?: string]>;

/**
 * One of a card's own choices (Hard or Soft bins, the sort): its options and the one shown first. Options given as a
 * function are named for whether the card is drilled into a group (the sort then orders wafers, not groups).
 */
export interface CardChoice { current: string; options: ChoiceOptions | ((drilled: boolean) => ChoiceOptions) }

/** A change the card makes to whichever variant is shown: a drill into one group. */
export type CardTransform = (spec: CardSpec) => CardSpec;

export interface PlotCardOptions {
  doc: Document;
  items: readonly PlotItem[];
  ctx: PlotContext;
  /** The card, or its variants: one segmented control per choice, and the spec for the values chosen, in order. */
  spec: CardSpec | { choices: CardChoice[]; build: (values: readonly string[]) => CardSpec };
  /** The slots' values now (the section's test, the Group by). */
  slots?: () => CardSlotValues;
  /**
   * Clicking a mark that is not one wafer (a group's bar) drills into it: the change to draw, or `null` to fall through to
   * `chart.onSelectPoints`. A Back button undoes it.
   */
  drill?: (points: readonly PlotPoint[]) => CardTransform | null;
  /** What a click on a bar that drills does, in the reader's words ("see its wafers"). */
  drillLabel?: string | (() => string | undefined);
  /** Lines the card adds under its statement, for what the plot itself cannot know (two judgements disagreeing). */
  notes?: (spec: CardSpec) => string[];
  /** Controls the host owns (a test picker shared across a section, its axis settings), put before the card's own. */
  extras?: HTMLElement[];
  /** A Back button the host drives: shown while `shown()` (a scope narrowed elsewhere), calling `onBack`. */
  externalBack?: { shown: () => boolean; onBack: () => void };
  /** Why the card draws nothing on this population (a trend through one wafer), in place of the plot. */
  unavailable?: string;
  /** Told each resolved plot, after it is drawn (a host control that reflects what was drawn). */
  onResolved?: (r: ResolvedPlot) => void;
  chart: Omit<PlotChartOptions, 'ownerDocument' | 'waferLabel'>;
  /**
   * Edit as plot, in the card's ⋯ menu: called with the reader's own plot of what the card shows now (`freezeCard`) and
   * the population the card draws, to open in the plot editor. Absent = no such row (a host that keeps no plots).
   */
  editAsPlot?: (plot: PlotSpec, over: { items: readonly PlotItem[]; ctx: PlotContext }) => void;
}

export interface PlotCardHandle {
  card: HTMLElement;
  /** The spec drawn now, slots unfilled. */
  current(): CardSpec;
  /** Draw again, with the slots as they are now. */
  refresh(): void;
  destroy(): void;
}

export function renderPlotCard(o: PlotCardOptions): PlotCardHandle {
  let drilled: CardTransform | undefined;
  const back = makeBackButton(() => { if (drilled) { drilled = undefined; refresh(); } else o.externalBack?.onBack(); }, o.doc);
  markNoPrint(back);
  // Kept, so the click hint can follow whether a click drills now (`selectActionLabel` is read at each draw).
  const chartOptions: PlotChartOptions = {
    ownerDocument: o.doc, waferLabel: i => o.items[i]?.label ?? '', ...o.chart,
    onSelectPoints: o.drill || o.chart.onSelectPoints
      ? (points, at, anchor, info) => {
        const into = drilled ? null : o.drill?.(points);
        if (into) { drilled = into; refresh(); return; }
        o.chart.onSelectPoints?.(points, at, anchor, info);
      }
      : undefined,
  };
  const chart = renderPlotChart(chartOptions);
  const variants = 'build' in o.spec ? o.spec : undefined;
  const chosen = variants?.choices.map(c => c.current) ?? [];
  const base = (): CardSpec => (variants ? variants.build(chosen) : (o.spec as CardSpec));
  const current = (): CardSpec => (drilled ? drilled(base()) : base());

  const slotValues = (): CardSlotValues => ({ testDefs: o.ctx.testDefs, groupBy: o.ctx.groupBy, ...o.slots?.() });
  if (o.editAsPlot) {
    const edit = o.editAsPlot;
    chart.setMenuRows(() => {
      const frozen = freezeCard(current(), { ...slotValues(), waferCount: o.items.length }, newPlotId());
      return [{ label: 'Edit as plot', disabledHint: 'issue' in frozen ? frozen.issue : undefined, onClick: () => { if ('spec' in frozen) edit(frozen.spec, { items: o.items, ctx: o.ctx }); } }];
    });
  }

  chart.actions.appendChild(back);
  for (const el of o.extras ?? []) chart.actions.appendChild(el);
  // The choices' controls, rebuilt when the drill changes what their options are called.
  let segs: HTMLElement[] = [];
  let segsDrilled: boolean | undefined;
  const placeChoices = (): void => {
    const isDrilled = !!drilled;
    if (segsDrilled === isDrilled) return;
    segsDrilled = isDrilled;
    const next = (variants?.choices ?? []).map((c, k) => {
      const seg = makeSegmented(typeof c.options === 'function' ? c.options(isDrilled) : c.options, chosen[k], v => { chosen[k] = v; refresh(); }, o.doc);
      markNoPrint(seg);
      return seg;
    });
    if (segs.length) segs.forEach((old, k) => old.replaceWith(next[k])); else for (const seg of next) chart.actions.appendChild(seg);
    segs = next;
  };

  function refresh(): void {
    placeChoices();
    back.style.display = drilled || o.externalBack?.shown() ? '' : 'none';
    const filled = fillCard(current(), slotValues());
    // After the spec is built: a card's own choice (nested categories) may decide whether a click drills.
    const drillLabel = typeof o.drillLabel === 'function' ? o.drillLabel() : o.drillLabel;
    chartOptions.selectActionLabel = o.drill && !drilled && drillLabel ? drillLabel : o.chart.selectActionLabel;
    const spec = 'spec' in filled ? filled.spec : { ...current(), fields: {} };
    const r = resolvePlot(spec, o.items, o.ctx);
    const extra = o.notes?.(current()) ?? [];
    const shown = o.unavailable ? { ...r, marks: undefined, issues: [o.unavailable] }
      : 'issue' in filled ? { ...r, issues: [filled.issue] } : extra.length ? { ...r, notes: [...r.notes, ...extra] } : r;
    chart.setPlot(shown);
    o.onResolved?.(shown);
  }
  refresh();
  return { card: chart.card, current, refresh, destroy: () => chart.destroy() };
}
