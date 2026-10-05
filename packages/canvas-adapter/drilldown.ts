// Drilldown — open a chart on a population the user picked out.
//
// One mechanism, two halves: a SOURCE says which dies (and says so in words —
// see chartPopulation.ts), a TARGET is a chart that can be opened on any
// source. The menu is the list of targets for one source, each either
// available or disabled with the reason. Adding a source (a wafer card, a chart
// bar) or a target (a histogram) is one more of either — never a menu per
// pairing.
//
// Loaded on first use, like insightsTab: it pulls in chart panels, which the
// initial /render chunk must not carry (tests/bundle-size.test.mjs).

import type { Die } from '../core/dies.js';
import { isYieldEligibleDie } from '../core/dies.js';
import { testValue } from '../core/dieTable.js';
import { isParametricTest } from '../renderer/buildWaferMap.js';
import { buildSweepData, type SweepSpec } from '../stats/sweep.js';
import { plotToSweep } from '../stats/plotSpec.js';
import { renderSweepPanel } from './charts/sweep.js';
import { renderHistogramPanel } from './charts/histogram.js';
import { renderCapabilityPanel } from './charts/capability.js';
import { openChartExpandModal, populationPhrase } from './charts/chartShell.js';
import {
  buildCheckMenuEl, createToolbarHelpers, getTooltip, menuLayerFor, wireMenuA11y, CLR, FONT, SPACE,
  openReparentedModal, type CheckMenuRow, type SaveImageHandler, type SaveTextHandler,
} from './toolbar.js';
import type { DrilldownSource, DrilldownItem } from './chartPopulation.js';
import { defaultPlot, defaultSweep, fieldCatalogue, plotTitle, resolvePlot, type PlotContext } from '../stats/plotData.js';
import { newPlotId, type PlotSpec } from '../stats/plotSpec.js';
import { sourceFromPoints, toPlotItems } from './plotItems.js';
import type { PlotStore } from './plotStore.js';

export type { DrilldownSource, DrilldownItem };

/** What the targets can draw on — the host's chart definitions and hooks. */
export interface DrilldownContext {
  /** The reader's saved plots: each is a row in the menu, opened on the selection. */
  plots?: PlotStore;
  onSaveImage?: SaveImageHandler;
  /** The host's CSV save hook, for the tables' Export CSV. */
  onSaveText?: SaveTextHandler;
  /** A die row clicked in a table: show that die on the map it belongs to. The table steps aside first. */
  onLocateDie?: (die: Die, waferIndex: number | undefined) => void;
  /**
   * A narrower population for the same dies, offered as the menu's first row: the menu reopens on it, and its own
   * `narrower` is the population it left, so the row swaps back. Set by a gallery when dies are selected on several
   * wafers and the right-click is on one of them.
   */
  narrower?: { label: string; source: DrilldownSource; ctx?: DrilldownContext };
}

interface Target {
  section: string;
  label: string;
  /** `null` when the chart can be opened on this source. */
  unavailable: string | null;
  open: () => void;
}

/** Below this many dies a Ppk is an estimate with a wide margin — the chart
 *  must say so rather than print two decimals as though they were settled. */
const PPK_MIN_DIES = 30;

const allDies = (source: DrilldownSource): Die[] => source.items.flatMap(it => it.dies);

/** The source with partial and edge-excluded dies taken out, so every chart
 *  opened from it counts the same dies and the stated N is the plotted N. The
 *  histogram does not filter by itself; capability and sweeps do. */
function eligibleItems(source: DrilldownSource): DrilldownItem[] {
  return source.items.map(it => ({ ...it, dies: it.dies.filter(d => isYieldEligibleDie(d)) }));
}

/** Parametric tests with at least `min` finite values across `dies`. */
function testsWithValues(source: DrilldownSource, dies: Die[], min: number): number[] {
  return (source.testDefs ?? []).filter(isParametricTest).map(d => d.testNumber).filter(tn => {
    let n = 0;
    for (const d of dies) {
      const v = testValue(d, tn);
      if (v !== undefined && Number.isFinite(v) && ++n >= min) return true;
    }
    return false;
  });
}

/** A card built for the modal, with its population stated under the heading
 *  — the one line that tells an engineer this is not the whole lot. */
function openCard(card: HTMLElement, title: string, line: string, anchor: Element, destroy: () => void): void {
  const doc = card.ownerDocument;
  const el = doc.createElement('div');
  el.textContent = line;
  el.dataset.wmapPopulation = '1';
  Object.assign(el.style, { color: CLR.label, fontSize: FONT.body, marginBottom: SPACE.sm } as Partial<CSSStyleDeclaration>);
  // Directly under the heading — found by the card's own expand button, not by
  // position: panels insert their own hints ahead of the body.
  const headingRow = card.querySelector('[data-wmap-chart-expand]')?.parentElement;
  if (headingRow?.parentElement === card) headingRow.after(el);
  else card.prepend(el);
  openChartExpandModal(card, title, { anchor, onClosed: destroy });
}

function sweepTarget(spec: SweepSpec, source: DrilldownSource, ctx: DrilldownContext, anchor: Element): Target {
  const dies = allDies(source);
  let unavailable: string | null = source.notMeasuredReason ?? null;
  if (!unavailable && !dies.some(d => isYieldEligibleDie(d))) {
    unavailable = 'These dies are all partial or edge-excluded, which charts leave out';
  }
  if (!unavailable) {
    const data = buildSweepData(dies, source.testDefs, spec);
    if (!data.series.some(s => s.points.some(p => p.count > 0))) unavailable = 'These dies have no values for this sweep’s tests';
  }
  return {
    section: 'Plots', label: spec.title, unavailable,
    open: () => {
      // The sweep states its own population in its hint, with its own count.
      const panel = renderSweepPanel({
        spec, dies, population: source.population, testDefs: source.testDefs,
        onSaveImage: ctx.onSaveImage, ownerDocument: anchor.ownerDocument,
      });
      // The count the sweep plots — yield-eligible dies — with the "of N" when
      // that is fewer than were picked, exactly as its hint and every other
      // drilldown title say it.
      const plotted = dies.filter(d => isYieldEligibleDie(d)).length;
      openChartExpandModal(panel.card, `${spec.title} — ${populationPhrase(plotted, dies.length, source.population)}`, {
        anchor, onClosed: () => panel.destroy(),
      });
    },
  };
}

function distributionTargets(source: DrilldownSource, ctx: DrilldownContext, anchor: Element): Target[] {
  const items = eligibleItems(source);
  const total = allDies(source).length;
  const eligible = items.flatMap(it => it.dies);
  const phrase = populationPhrase(eligible.length, total, source.population);
  const defs = (source.testDefs ?? []).filter(isParametricTest);
  const doc = anchor.ownerDocument;

  const reasonFor = (min: number, what: string): string | null => {
    if (source.notMeasuredReason) return source.notMeasuredReason;
    if (eligible.length === 0) return 'These dies are all partial or edge-excluded, which charts leave out';
    return testsWithValues(source, eligible, min).length > 0 ? null : what;
  };

  const histogram: Target = {
    section: 'Distributions', label: 'Value histogram',
    unavailable: reasonFor(1, 'These dies have no parametric test values'),
    open: () => {
      const panel = renderHistogramPanel({
        title: 'Value histogram', items, testDefs: defs, selectedTestNumber: source.activeTest,
        onSaveImage: ctx.onSaveImage, ownerDocument: doc,
      });
      openCard(panel.card, `Value histogram — ${phrase}`, `Population: ${phrase}`, anchor, () => panel.destroy());
    },
  };

  const capability: Target = {
    section: 'Distributions', label: 'Process capability',
    // Ppk needs a spread, so two values of a test at the very least.
    unavailable: reasonFor(2, 'Needs at least 2 of these dies with values for one test'),
    open: () => {
      const panel = renderCapabilityPanel({
        title: 'Process capability', items, testDefs: defs, selectedTestNumber: source.activeTest,
        onSaveImage: ctx.onSaveImage, ownerDocument: doc,
      });
      const caution = eligible.length < PPK_MIN_DIES
        ? ` · fewer than ${PPK_MIN_DIES} dies, so each Ppk is a rough estimate`
        : '';
      openCard(panel.card, `Process capability — ${phrase}`, `Population: ${phrase}${caution}`, anchor, () => panel.destroy());
    },
  };

  return [histogram, capability];
}

/**
 * The reader's saved plots as targets, and "New plot…" for a one-off. A saved plot is drawn over this selection
 * exactly as it is on the Plot tab (the spec carries no population), in the editor window, where an edit is an
 * edit of the saved plot. "New plot…" opens a draft that is kept only if the reader adds it.
 */
function plotTargets(source: DrilldownSource, ctx: DrilldownContext, anchor: Element): Target[] {
  const store = ctx.plots;
  if (!store) return [];
  const doc = anchor.ownerDocument;
  const items = toPlotItems(source.items);
  const plotCtx: PlotContext = { testDefs: source.testDefs, passBins: [1] };
  const dies = allDies(source);
  const none = source.notMeasuredReason ?? (dies.length === 0 ? 'Nothing is selected' : null);
  const phrase = populationPhrase(dies.length, dies.length, source.population);

  // The chart and the editor are loaded when a plot is opened, not when the menu is: most right-clicks open a
  // table or a histogram.
  const open = (plot: PlotSpec, draft: boolean) => () => {
    void import('./plotModal.js').then(({ openPlotEditor }) => openPlotEditor({
      doc, anchor: anchor as HTMLElement, store, plot, draft, items, ctx: plotCtx, population: phrase,
      // Not the plot's own title: that follows its fields, and a window heading fixed at open would go on naming the old ones.
      title: `${draft ? (plot.chart === 'sweep' ? 'New sweep' : 'New plot') : (plot.chart === 'sweep' ? 'Sweep' : 'Plot')} — ${phrase}`,
      chart: {
        onSaveImage: ctx.onSaveImage,
        // A drag on the plot opens this menu again on the dies inside it.
        onSelectPoints: (points, at, el) => {
          const sub = sourceFromPoints(points, items, source.testDefs);
          if (sub) openDrilldownMenu(at, el, sub, ctx);
        },
      },
    }));
  };

  const saved: Target[] = store.get().map(plot => {
    // A sweep is a plot of its own kind: the sweep panel draws it, over the dies picked.
    const sweep = plotToSweep(plot);
    if (sweep) return sweepTarget(sweep, source, ctx, anchor);
    const r = resolvePlot(plot, items, plotCtx);
    return {
      section: 'Plots', label: plotTitle(r) || 'Plot',
      unavailable: none ?? r.issues[0] ?? (r.plotted === 0 ? 'No die here has the values this plot needs' : null),
      open: open(plot, false),
    };
  });
  const catalogue = fieldCatalogue(items, plotCtx);
  const hasTests = catalogue.some(f => f.group === 'Tests');
  saved.push({
    section: 'Plots', label: 'New plot…',
    unavailable: none ?? (hasTests ? null : 'These dies have no parametric test values'),
    open: open(defaultPlot(catalogue, newPlotId()), true),
  });
  // A sweep starts on the first tests the dies hold, in test order, and is kept only if the reader adds it.
  const sweepTests = (source.testDefs ?? []).filter(d => isParametricTest(d));
  saved.push({
    section: 'Plots', label: 'New sweep…',
    unavailable: none ?? (sweepTests.length > 0 ? null : 'These dies have no parametric test values'),
    open: open(defaultSweep(source.testDefs ?? [], newPlotId()), true),
  });
  return saved;
}

/** The population as tables — Dies and Statistics, in a modal. Loaded on first
 *  use: the tables, the virtual table under them and the CSV writer are not part
 *  of the chart chunk. A source of aggregates (a lot stack) has no dies to list. */
function tableTargets(source: DrilldownSource, ctx: DrilldownContext, anchor: Element): Target[] {
  const dies = allDies(source);
  const none = source.notMeasuredReason ?? (dies.length === 0 ? 'Nothing is selected' : null);
  const n = dies.length;
  const phrase = populationPhrase(n, n, source.population);
  const open = (view: 'dies' | 'statistics' | 'wafers', title: string) => () => {
    void import('./dataTab.js').then(({ renderSelectionTables }) => {
      const doc = anchor.ownerDocument;
      // A row click closes the table and rings that die on the map behind it (the table covers the map).
      let close: (() => void) | undefined;
      const tables = renderSelectionTables({
        doc, items: source.items, testDefs: source.testDefs, population: source.population,
        view, onSaveText: ctx.onSaveText,
        onLocateDie: ctx.onLocateDie ? (die, waferIndex) => { close?.(); ctx.onLocateDie!(die, waferIndex); } : undefined,
      });
      const handle = openReparentedModal([tables.el], {
        title: `${title} — ${phrase}`, anchor, ownerDocument: doc,
        boxSize: { width: 'min(96vw, 1200px)', height: 'min(92vh, 780px)' },
        onClosed: tables.destroy,
      });
      if (!handle) tables.destroy();
      else close = () => handle.close();
    });
  };
  return [
    { section: 'Tables', label: 'Dies', unavailable: none, open: open('dies', 'Dies') },
    {
      section: 'Tables', label: 'Test statistics',
      unavailable: none ?? (testsWithValues(source, dies, 1).length > 0 ? null : 'These dies have no parametric test values'),
      open: open('statistics', 'Test statistics'),
    },
    // One row per wafer, only where the population spans more than one.
    ...(source.items.length > 1 ? [{ section: 'Tables', label: 'Wafers', unavailable: none, open: open('wafers', 'Wafers') }] : []),
  ];
}

/** Every chart and table this context can open, for `source`. A target that needs
 *  more than one wafer (the boxplot, the trend) is not listed for a one-wafer
 *  source at all — its subject does not exist there, which is different from
 *  being temporarily unavailable. The menu is always offered: the tables need
 *  only dies, so a bins-only map has Dies to open. */
function targetsFor(source: DrilldownSource, ctx: DrilldownContext, anchor: Element): Target[] {
  return [
    ...distributionTargets(source, ctx, anchor),
    ...plotTargets(source, ctx, anchor),
    ...tableTargets(source, ctx, anchor),
  ];
}

/** The one open drilldown menu per document — opening another closes it. */
const openMenus = new WeakMap<Document, () => void>();

/**
 * Open the drilldown menu for `source` at viewport point `at`.
 *
 * `anchor` is an on-page element of the triggering render (the map canvas, or
 * the toolbar button) — it resolves the menu layer and the chart modal's root,
 * and gets focus back when the menu is dismissed with Escape. Returns a close
 * function; the menu also closes on an outside press, Escape, Tab, or when a
 * chart is picked.
 */
export function openDrilldownMenu(
  at: { x: number; y: number },
  anchor: HTMLElement,
  source: DrilldownSource,
  ctx: DrilldownContext,
): () => void {
  const doc = anchor.ownerDocument;
  const win = doc.defaultView ?? window;
  openMenus.get(doc)?.();

  const targets = targetsFor(source, ctx, anchor);
  const rows: CheckMenuRow[] = [];
  if (ctx.narrower) {
    const { label, source: other, ctx: otherCtx } = ctx.narrower;
    const back: DrilldownContext['narrower'] = {
      label: `All selected — ${populationPhrase(allDies(source).length, allDies(source).length, source.population)}`,
      source, ctx,
    };
    rows.push({ section: 'Dies' });
    rows.push({
      label, active: false, action: true, enabled: true,
      onClick: () => { close(); openDrilldownMenu(at, anchor, other, { ...(otherCtx ?? ctx), narrower: back }); },
    });
  }
  let section: string | undefined;
  for (const t of targets) {
    if (t.section !== section) { rows.push({ section: t.section }); section = t.section; }
    rows.push({
      label: t.label, active: false, action: true,
      enabled: t.unavailable === null,
      disabledHint: t.unavailable ?? undefined,
      onClick: () => { close(); t.open(); },
    });
  }

  const { makeMenuSection } = createToolbarHelpers(getTooltip(doc));
  const menu = buildCheckMenuEl(new DOMRect(at.x, at.y - 4, 0, 0), rows, { makeMenuSection }, win);
  const n = allDies(source).length;
  menu.setAttribute('role', 'menu');
  menu.setAttribute('aria-label', `Open a chart or table of ${populationPhrase(n, n, source.population)}`);
  menu.dataset.wmapDrilldownMenu = '1';
  menuLayerFor(anchor).appendChild(menu);

  // Keep it on screen: a menu opened near the bottom or right edge flips to
  // the other side of the point rather than running out of the viewport.
  const r = menu.getBoundingClientRect();
  if (r.bottom > win.innerHeight - 4) menu.style.top = `${Math.max(4, at.y - r.height)}px`;
  if (r.right > win.innerWidth - 4) menu.style.left = `${Math.max(4, win.innerWidth - r.width - 4)}px`;

  let closed = false;
  function close(): void {
    if (closed) return;
    closed = true;
    menu.remove();
    doc.removeEventListener('pointerdown', onOutside, true);
    win.removeEventListener('blur', close);
    if (openMenus.get(doc) === close) openMenus.delete(doc);
  }
  function onOutside(e: PointerEvent): void {
    if (!menu.contains(e.target as Node)) close();
  }
  doc.addEventListener('pointerdown', onOutside, true);
  win.addEventListener('blur', close);
  wireMenuA11y(menu, anchor, close);
  openMenus.set(doc, close);
  return close;
}
