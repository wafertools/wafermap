// The live list of saved plots, shared by everything that shows or edits them: the Plot tab, its editor, and the
// drilldown menu (which lists them as targets). One list, so an edit made in the editor is the plot the next
// right-click opens.
//
// The library never stores anything itself. The host hands the list in (`InsightsOptions.plots`) and is told of
// every change (`onPlotsChange`), debounced so typing a title is one save, not forty. `flush()` sends any change
// still waiting, for when the view goes away.

import type { PlotSpec } from '../stats/plotSpec.js';
import { sweepToPlot } from '../stats/plotSpec.js';
import type { SweepSpec } from '../stats/sweep.js';
import { newPlotId } from '../stats/plotId.js';
import { noticeOnce } from '../renderer/deprecate.js';

export interface PlotStore {
  get(): readonly PlotSpec[];
  /** Replaces the plot with this id, or appends it. */
  upsert(plot: PlotSpec): void;
  /** Inserts at a position (undo of a delete puts the plot back where it was). */
  insertAt(index: number, plot: PlotSpec): void;
  remove(id: string): { plot: PlotSpec; index: number } | undefined;
  /** A copy with a new id, placed after the original. A typed title gains "(copy)"; an untitled plot stays untitled, so its title keeps following its fields. */
  duplicate(id: string): PlotSpec | undefined;
  /** Replaces the whole list (an import). A sweep the host still supplies that is not in it is reported through `onRemove`, as `remove` does. */
  replaceAll(plots: readonly PlotSpec[]): void;
  subscribe(fn: () => void): () => void;
  /** Sends a change still waiting for the debounce. */
  flush(): void;
}

/**
 * The title for a copy of a plot titled `title`: the original's name with a copy mark, numbered once there are several
 * ("Vth (copy)", "Vth (copy 2)"). A copy of a copy is a copy of the original, not a copy of a copy: marks do not pile up.
 */
export function copyTitle(title: string, existing: ReadonlyArray<string | undefined>): string {
  const base = title.replace(/(?:\s*\(copy(?: \d+)?\))+$/, '') || title;
  const taken = new Set(existing);
  let candidate = `${base} (copy)`;
  for (let n = 2; taken.has(candidate); n++) candidate = `${base} (copy ${n})`;
  return candidate;
}

/** Sweeps a host still supplies through `insights.sweeps`: they become sweep plots in the list. */
export interface LegacySweeps {
  sweeps: readonly SweepSpec[] | undefined;
  /** Told when the reader deletes one of them, so the host stops supplying it (else the next render brings it back). */
  onRemove?: (ids: string[]) => void;
}

/**
 * The store for a host's `insights` options: its saved plots, with any `sweeps` it still supplies turned into sweep
 * plots. A plot already saved under a sweep's id wins, so a host that keeps both does not show a sweep twice and an
 * edit the reader made is not undone by the host's older definition.
 */
export function plotStoreFor(insights: { plots?: PlotSpec[]; onPlotsChange?: (plots: PlotSpec[]) => void; sweeps?: SweepSpec[]; onRemoveSweeps?: (ids: string[]) => void } | undefined): PlotStore {
  return createPlotStore(insights?.plots, insights?.onPlotsChange, undefined, { sweeps: insights?.sweeps, onRemove: insights?.onRemoveSweeps });
}

export function createPlotStore(
  initial: readonly PlotSpec[] | undefined,
  onChange?: (plots: PlotSpec[]) => void,
  delayMs = 400,
  legacy?: LegacySweeps,
): PlotStore {
  const have = new Set((initial ?? []).map(p => p.id));
  const fromSweeps = (legacy?.sweeps ?? []).filter(sw => !have.has(sw.id));
  if ((legacy?.sweeps?.length ?? 0) > 0) {
    noticeOnce('insights.sweeps', '`insights.sweeps` is deprecated: sweeps are plots now. Pass them in `insights.plots` as sweep plots (readPlotsFile reads a sweeps file), which the Plot tab can also save and share.');
  }
  const legacyIds = new Set((legacy?.sweeps ?? []).map(sw => sw.id));
  let plots: PlotSpec[] = [...(initial ?? []), ...fromSweeps.map(sweepToPlot)].map(p => JSON.parse(JSON.stringify(p)) as PlotSpec);
  const listeners = new Set<() => void>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pending = false;

  const send = (): void => {
    if (timer !== undefined) { clearTimeout(timer); timer = undefined; }
    if (!pending) return;
    pending = false;
    onChange?.(plots.map(p => JSON.parse(JSON.stringify(p)) as PlotSpec));
  };
  const changed = (): void => {
    for (const fn of [...listeners]) fn();
    pending = true;
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(send, delayMs);
  };

  return {
    get: () => plots,
    upsert(plot) {
      const i = plots.findIndex(p => p.id === plot.id);
      plots = i < 0 ? [...plots, plot] : plots.map((p, k) => (k === i ? plot : p));
      changed();
    },
    insertAt(index, plot) {
      const at = Math.max(0, Math.min(index, plots.length));
      plots = [...plots.slice(0, at), plot, ...plots.slice(at)];
      changed();
    },
    remove(id) {
      const index = plots.findIndex(p => p.id === id);
      if (index < 0) return undefined;
      const plot = plots[index];
      plots = plots.filter((_, k) => k !== index);
      changed();
      if (legacyIds.has(id)) legacy?.onRemove?.([id]);
      return { plot, index };
    },
    duplicate(id) {
      const index = plots.findIndex(p => p.id === id);
      if (index < 0) return undefined;
      const src = plots[index];
      const copy = JSON.parse(JSON.stringify(src)) as PlotSpec;
      copy.id = newPlotId();
      // Only text the reader typed is copied as text. Baking the automatic title in would freeze it: the copy would go on
      // naming the old fields after they were changed.
      if (src.title) Object.assign(copy, { title: copyTitle(src.title, plots.map(p => p.title)) });
      plots = [...plots.slice(0, index + 1), copy, ...plots.slice(index + 1)];
      changed();
      return copy;
    },
    replaceAll(next) {
      const dropped = [...legacyIds].filter(id => plots.some(p => p.id === id) && !next.some(p => p.id === id));
      plots = next.map(p => JSON.parse(JSON.stringify(p)) as PlotSpec);
      changed();
      // A sweep the host still supplies that the import dropped: tell it, as `remove` does, or the next render brings it back.
      if (dropped.length > 0) legacy?.onRemove?.(dropped);
    },
    subscribe(fn) { listeners.add(fn); return () => { listeners.delete(fn); }; },
    flush: send,
  };
}

/**
 * How a gallery hands its own store to the maps it draws on its cards. Not a public option: a card's map would
 * otherwise build a store of its own from nothing, and the plots saved on the Plot tab would be missing from the
 * right-click menu on every card.
 */
export interface WithPlotStore { plotStore?: PlotStore }
