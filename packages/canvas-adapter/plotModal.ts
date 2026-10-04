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
import type { PlotSpec } from '../stats/plotSpec.js';
import { renderPlotChart, type PlotChartOptions } from './charts/plotChart.js';
import { createPlotEditor } from './plotEditor.js';
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
  const chart = renderPlotChart({ ...o.chart, ownerDocument: doc, waferLabel: i => o.items[i]?.label ?? '' });
  left.appendChild(chart.card);

  const right = doc.createElement('div');
  Object.assign(right.style, { flex: '1 1 300px', minWidth: '260px', maxWidth: '420px', display: 'flex', flexDirection: 'column', gap: SPACE.lg } as Partial<CSSStyleDeclaration>);

  const editor = createPlotEditor({
    doc, plot: current, catalogue,
    followLabel: () => o.groupLabel ?? (o.items.length > 1 ? 'a colour per wafer' : undefined),
    autoText: () => { const r = resolve(current); return { title: r.autoTitle, x: r.x?.label, y: r.y?.label }; },
    onChange: next => {
      current = next;
      if (saved) store.upsert(next);
      redraw();
    },
  });
  right.appendChild(editor.el);

  const footer = doc.createElement('div');
  Object.assign(footer.style, { display: 'flex', flexDirection: 'column', gap: SPACE.sm, color: CLR.label, fontSize: FONT.body } as Partial<CSSStyleDeclaration>);
  const note = doc.createElement('div');
  footer.appendChild(note);
  const addBtn = doc.createElement('button');
  addBtn.type = 'button';
  addBtn.textContent = 'Add to my plots';
  addBtn.dataset.wmapPlotAdd = '1';
  Object.assign(addBtn.style, { ...controlStyle('outlined'), alignSelf: 'flex-start' } as Partial<CSSStyleDeclaration>);
  wireControlHover(addBtn);
  addBtn.addEventListener('click', () => { saved = true; store.upsert(current); syncFooter(); });
  footer.appendChild(addBtn);
  right.appendChild(footer);

  function syncFooter(): void {
    note.textContent = saved
      ? `Changes are saved to “${plotTitle(resolve(current))}”.`
      : 'This is a draft: it is not kept until you add it to your plots.';
    addBtn.style.display = saved ? 'none' : '';
  }
  function redraw(): void {
    chart.setPlot(resolve(current));
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
