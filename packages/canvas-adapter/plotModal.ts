// The plot editor's window: the plot drawn large, with the editor beside it.
//
// Shared by the three ways a plot gets opened. A card's Edit button on the Plot tab and a saved plot opened from
// the drilldown menu edit the saved plot (every change is kept, as the host is told); "New plot from this
// selection..." opens a DRAFT, which stays in the window until the reader presses Add to my plots, so exploring a
// dozen selections never litters the saved list.
//
// Nothing here knows how a point is selected or a wafer opened: the caller passes those in (`chart`), which is also
// what keeps this module from depending on the drilldown menu that depends on it.

import type { PlotContext, PlotItem } from '../stats/plotData.js';
import { fieldCatalogue, resolvePlot, plotTitle } from '../stats/plotData.js';
import { plotToSweep, type PlotSpec } from '../stats/plotSpec.js';
import { renderPlotChart, type PlotChartOptions } from './charts/plotChart.js';
import { renderSweepPanel, type SweepPanelOptions } from './charts/sweep.js';
import { createPlotEditor } from './plotEditor.js';
import { createSweepEditor } from './sweepEditor.js';
import type { PlotStore } from './plotStore.js';
import { CLR, FONT, SPACE, controlStyle, openReparentedModal, wireControlHover } from './toolbar.js';

export interface PlotEditorWindowOptions {
  doc: Document;
  anchor: HTMLElement;
  store: PlotStore;
  plot: PlotSpec;
  /** A draft is not in the store until added. */
  draft: boolean;
  items: PlotItem[];
  ctx: PlotContext;
  /** The label "Follow Group by" resolves to, when the tab has one. */
  groupLabel?: string;
  /** Pointer callbacks for the chart (open a wafer, drag-select). */
  chart: Omit<PlotChartOptions, 'ownerDocument' | 'waferLabel'>;
  /** What the plot is drawn over, in words, when it is not the whole tab ("selected on W03"). */
  population?: string;
  /** The population before any count ("selected on W03"), which a sweep's own hint puts its count in front of. */
  rawPopulation?: string;
  /** Click a level of a sweep's curve: the menu on the dies measured there. Sweeps only. */
  onSelectLevel?: SweepPanelOptions['onSelectPoint'];
  /** The window's heading. Default: Edit plot, or New plot for a draft. */
  title?: string;
  onClosed?: () => void;
}

export function openPlotEditor(o: PlotEditorWindowOptions): void {
  const { doc, store } = o;
  let current = o.plot;
  let saved = !o.draft;
  const catalogue = fieldCatalogue(o.items, o.ctx);
  const resolve = (p: PlotSpec) => resolvePlot(p, o.items, o.ctx);

  const layout = doc.createElement('div');
  layout.dataset.wmapPlotWindow = '1';
  Object.assign(layout.style, {
    display: 'flex', flexWrap: 'wrap', gap: SPACE.xxl, alignItems: 'flex-start', width: '100%', boxSizing: 'border-box', padding: SPACE.xl,
  } as Partial<CSSStyleDeclaration>);

  const left = doc.createElement('div');
  Object.assign(left.style, { flex: '3 1 420px', minWidth: '0', display: 'flex', flexDirection: 'column', gap: SPACE.md } as Partial<CSSStyleDeclaration>);
  if (o.population) {
    const pop = doc.createElement('div');
    pop.textContent = `Population: ${o.population}`;
    pop.dataset.wmapPopulation = '1';
    Object.assign(pop.style, { color: CLR.label, fontSize: FONT.body } as Partial<CSSStyleDeclaration>);
    left.appendChild(pop);
  }
  // A sweep is drawn by the sweep panel and edited by the sweep editor; every other plot by the plot chart and editor.
  // Both pairs are driven the same way below, so the rest of the window does not care which it has.
  const isSweep = current.chart === 'sweep';
  let chart: { card: HTMLElement; setPlot(spec: PlotSpec): void; destroy(): void };
  if (isSweep) {
    const panel = renderSweepPanel({
      spec: plotToSweep(current)!, dies: o.items.flatMap(it => it.dies), testDefs: o.ctx.testDefs ? [...o.ctx.testDefs] : undefined, population: o.rawPopulation ?? o.population,
      onSaveImage: o.chart.onSaveImage, onSelectPoint: o.onSelectLevel, ownerDocument: doc,
    });
    chart = { card: panel.card, setPlot: spec => panel.setSpec(plotToSweep(spec)!), destroy: () => panel.destroy() };
  } else {
    const c = renderPlotChart({ ...o.chart, ownerDocument: doc, waferLabel: i => o.items[i]?.label ?? '' });
    chart = { card: c.card, setPlot: spec => c.setPlot(resolve(spec)), destroy: () => c.destroy() };
  }
  // The card takes the column's width, whatever its panel does in a grid (the sweep panel sits at the start of its cell
  // there). Left to size itself it would keep the width of its canvas, which an expanded view leaves at the modal's size,
  // and so cover the settings once restored.
  chart.card.style.alignSelf = 'stretch';
  left.appendChild(chart.card);

  const right = doc.createElement('div');
  // The settings can be taller than the window (a sweep with several series), so they scroll on their own: the chart
  // beside them stays put, and nothing is cut off at the bottom. The allowance is the window's header and padding.
  Object.assign(right.style, {
    flex: '1 1 300px', minWidth: '260px', maxWidth: '420px', display: 'flex', flexDirection: 'column', gap: SPACE.lg,
    maxHeight: 'calc(min(92vh, 800px) - 110px)', overflowY: 'auto', paddingRight: SPACE.sm,
  } as Partial<CSSStyleDeclaration>);

  const onEdit = (next: PlotSpec): void => {
    current = next;
    if (saved) store.upsert(next);
    redraw();
  };
  const editor: { el: HTMLElement; setPlot(p: PlotSpec): void; refreshAuto(): void } = isSweep
    ? { ...createSweepEditor({ doc, plot: current, testDefs: o.ctx.testDefs, onChange: onEdit }), refreshAuto: () => {} }
    : createPlotEditor({
      doc, plot: current, catalogue,
      followLabel: () => o.groupLabel ?? (o.items.length > 1 ? 'a colour per wafer' : undefined),
      autoText: () => { const r = resolve(current); return { title: r.autoTitle, x: r.x?.label, y: r.y?.label }; },
      onChange: onEdit,
    });
  right.appendChild(editor.el);

  // Stays in view while the settings scroll: Reset and Cancel are what a reader reaches for after a slip.
  const footer = doc.createElement('div');
  Object.assign(footer.style, {
    display: 'flex', flexDirection: 'column', gap: SPACE.sm, color: CLR.label, fontSize: FONT.body,
    position: 'sticky', bottom: '0', background: CLR.menuBg, borderTop: `1px solid ${CLR.menuBorder}`,
    // Room under the buttons inside the footer: a button's border flush with the edge of a scrolled, sticky box is cropped
    // at fractional pixel positions (a 125% display), so the footer, not the column, carries the space below them.
    paddingTop: SPACE.sm, paddingBottom: SPACE.md,
  } as Partial<CSSStyleDeclaration>);
  const note = doc.createElement('div');
  footer.appendChild(note);
  const addBtn = doc.createElement('button');
  addBtn.type = 'button';
  addBtn.textContent = 'Add to my plots';
  addBtn.dataset.wmapPlotAdd = '1';
  Object.assign(addBtn.style, { ...controlStyle('outlined'), alignSelf: 'flex-start' } as Partial<CSSStyleDeclaration>);
  wireControlHover(addBtn);
  addBtn.addEventListener('click', () => { saved = true; store.upsert(current); syncFooter(); });
  // Edits are kept as they are made, so undoing a slip is a button: Reset goes back to the plot as it was when this window
  // opened, Cancel does that and closes. (Closing with the window's own button keeps the changes.)
  const original = JSON.parse(JSON.stringify(o.plot)) as PlotSpec;
  const actionButton = (text: string, hook: string, run: () => void): HTMLButtonElement => {
    const b = doc.createElement('button');
    b.type = 'button';
    b.textContent = text;
    b.dataset[hook] = '1';
    Object.assign(b.style, controlStyle('outlined'));
    wireControlHover(b);
    b.addEventListener('click', run);
    return b;
  };
  const resetBtn = actionButton('Reset', 'wmapPlotReset', () => revert());
  const cancelBtn = actionButton('Cancel', 'wmapPlotCancel', () => { revert(); handle?.close(); });
  const buttons = doc.createElement('div');
  Object.assign(buttons.style, { display: 'flex', gap: SPACE.md, flexWrap: 'wrap' } as Partial<CSSStyleDeclaration>);
  buttons.append(resetBtn, cancelBtn, addBtn);
  footer.appendChild(buttons);
  right.appendChild(footer);

  const changed = (): boolean => JSON.stringify(current) !== JSON.stringify(original);
  function revert(): void {
    current = JSON.parse(JSON.stringify(original)) as PlotSpec;
    if (saved) store.upsert(current);
    editor.setPlot(current);
    redraw();
  }

  function syncFooter(): void {
    note.textContent = saved
      ? `Changes are saved to “${isSweep ? (current.title ?? 'Sweep') : plotTitle(resolve(current))}”.`
      : 'This is a draft: it is not kept until you add it to your plots.';
    addBtn.style.display = saved ? 'none' : '';
    resetBtn.disabled = !changed();
    resetBtn.style.opacity = resetBtn.disabled ? '0.5' : '1';
  }
  function redraw(): void {
    chart.setPlot(current);
    editor.refreshAuto();
    syncFooter();
  }
  redraw();

  layout.append(left, right);

  // A saved plot changed or went elsewhere (an import, an undo): follow it, or close if it is gone.
  const unsubscribe = store.subscribe(() => {
    if (!saved) return;
    const p = store.get().find(x => x.id === current.id);
    if (!p) { handle?.close(); return; }
    if (JSON.stringify(p) !== JSON.stringify(current)) { current = p; editor.setPlot(p); redraw(); }
  });

  const handle = openReparentedModal([layout], {
    title: o.title ?? (saved ? 'Edit plot' : 'New plot'),
    anchor: o.anchor, ownerDocument: doc,
    boxSize: { width: 'min(96vw, 1180px)', height: 'min(92vh, 800px)' },
    onClosed: () => { unsubscribe(); chart.destroy(); o.onClosed?.(); },
  });
  if (!handle) { unsubscribe(); chart.destroy(); }
}
