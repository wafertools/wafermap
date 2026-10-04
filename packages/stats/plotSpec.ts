// The plot builder's saved recipe, and the file it travels in.
//
// A `PlotSpec` is plain data: which fields stand for X, Y and colour, what kind of mark draws them, and the
// handful of axis settings a user can change. It carries NO population (which wafers are in view is the
// Insights scope or the drilldown selection), so the same spec works on any lot, and it holds no function, so
// a host can keep it as JSON. The library never stores anything itself; the host keeps the list
// (`InsightsOptions.plots` in, `onPlotsChange` out), the way it keeps sweeps.
//
// Compatibility is the point of this file, because once a user has a file the format is a promise:
//   - `version` is an integer; a reader accepts any version up to its own and ignores fields it does not know.
//   - Fields it does not know are KEPT on write, so a round trip through an older build does not strip a
//     newer build's settings.
//   - A mark or field kind it does not know is kept and reported by `plotIssue`, never dropped.
//   - New fields are optional with a stated default, so a plot saved today means the same plot in a year.
//
// Pure, no DOM. Design record: notes/wafermap/design-plot-builder.md.

import { newPlotId } from './plotId.js';
export { newPlotId };

export const PLOTS_FORMAT = 'wafermap-plots';
export const PLOTS_VERSION = 1;

export const PLOT_MARKS = ['scatter', 'histogram', 'box', 'bar', 'line'] as const;
export type PlotMark = (typeof PLOT_MARKS)[number];

export const PLOT_BUILTINS = ['wafer', 'x', 'y', 'ring', 'quadrant', 'hbin', 'sbin', 'site', 'yield', 'dieCount', 'waferOrder'] as const;
export type PlotBuiltin = (typeof PLOT_BUILTINS)[number];

/** A series a plot can put on an axis or use for colour. */
export type PlotField =
  /** A measured test. The number is the key; the name is a check, so a plot saved against another test program is
   *  reported rather than drawn against the wrong measurement. */
  | { test: number; name?: string }
  | { builtin: PlotBuiltin }
  /** A wafer or lot metadata key (split, slot, temperature…). */
  | { meta: string };

export interface PlotAxis {
  /** Replaces the automatic axis title. Absent = automatic. */
  label?: string;
  scale?: 'linear' | 'log';
  min?: number;
  max?: number;
  reverse?: boolean;
}

export const PLOT_AGGREGATES = ['mean', 'median', 'min', 'max', 'sum', 'count', 'yield'] as const;
export type PlotAggregate = (typeof PLOT_AGGREGATES)[number];

export type PlotColor = PlotField | { follow: 'groupBy' } | { none: true };

export interface PlotSpec {
  /** Stable, generated once, never reused; survives rename and reorder. */
  id: string;
  /** Set only when the user typed one; absent = the automatic title. */
  title?: string;
  mark: PlotMark;
  encoding: {
    x?: PlotField;
    y?: PlotField;
    /** Absent = follow the tab's Group by. */
    color?: PlotColor;
  };
  /** The unit one mark stands for. Absent = the finest level the X and Y fields allow. */
  level?: 'die' | 'wafer';
  /** How die-level values are combined into one mark. Absent = a mean (a count when there is no Y). */
  aggregate?: PlotAggregate;
  axes?: { x?: PlotAxis; y?: PlotAxis };
  /** Histogram bin count. Absent = automatic. */
  bins?: number;
}

export interface ReadPlotsResult {
  plots: PlotSpec[];
  /** Problems that dropped a plot or a setting, each naming where. */
  warnings: string[];
  /** Set when nothing could be read at all: the file as a whole is rejected. */
  error?: string;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Two fields name the same series. */
export function sameField(a: PlotField | undefined, b: PlotField | undefined): boolean {
  if (!a || !b) return a === b;
  if ('test' in a) return 'test' in b && a.test === b.test;
  if ('builtin' in a) return 'builtin' in b && a.builtin === b.builtin;
  return 'meta' in b && a.meta === b.meta;
}

export function isField(v: unknown): v is PlotField {
  if (!isObject(v)) return false;
  if ('test' in v) return Number.isInteger(v.test);
  if ('builtin' in v) return (PLOT_BUILTINS as readonly unknown[]).includes(v.builtin);
  if ('meta' in v) return typeof v.meta === 'string' && v.meta !== '';
  return false;
}

/** A field this build can read, or `null` with the reason it cannot. A kind it does not know is not an error. */
function readField(raw: unknown, where: string, warnings: string[]): PlotField | undefined {
  if (raw === undefined) return undefined;
  if (!isObject(raw)) { warnings.push(`${where}: not a field, left out`); return undefined; }
  if ('test' in raw) {
    if (!Number.isInteger(raw.test)) { warnings.push(`${where}: test number ${JSON.stringify(raw.test)} is not an integer, left out`); return undefined; }
    const out: { test: number; name?: string } = { test: raw.test as number };
    if (typeof raw.name === 'string' && raw.name !== '') out.name = raw.name;
    return out;
  }
  if ('builtin' in raw) {
    if (!(PLOT_BUILTINS as readonly unknown[]).includes(raw.builtin)) {
      // Possibly a field a newer build added: kept as written, and reported by plotIssue.
      return raw as unknown as PlotField;
    }
    return { builtin: raw.builtin as PlotBuiltin };
  }
  if ('meta' in raw) {
    if (typeof raw.meta !== 'string' || raw.meta === '') { warnings.push(`${where}: metadata key is empty, left out`); return undefined; }
    return { meta: raw.meta };
  }
  return raw as unknown as PlotField; // a kind from a newer build
}

function readAxis(raw: unknown, where: string, warnings: string[]): PlotAxis | undefined {
  if (raw === undefined) return undefined;
  if (!isObject(raw)) { warnings.push(`${where}: not an object, left out`); return undefined; }
  const out: PlotAxis & Record<string, unknown> = { ...raw };
  if ('label' in raw && typeof raw.label !== 'string') { warnings.push(`${where}.label: not text, left out`); delete out.label; }
  if ('scale' in raw && raw.scale !== 'linear' && raw.scale !== 'log') { warnings.push(`${where}.scale: "${String(raw.scale)}" is not linear or log, left out`); delete out.scale; }
  for (const k of ['min', 'max'] as const) {
    if (k in raw && !isFiniteNumber(raw[k])) { warnings.push(`${where}.${k}: not a number, left out`); delete out[k]; }
  }
  if ('reverse' in raw && typeof raw.reverse !== 'boolean') { warnings.push(`${where}.reverse: not true or false, left out`); delete out.reverse; }
  return out;
}

/**
 * One plot from parsed JSON, or `null` when it cannot be a plot at all (no mark). Unknown keys survive; a
 * setting that is wrong is dropped with a warning and the rest of the plot is kept.
 */
export function readPlot(raw: unknown, where: string, warnings: string[]): PlotSpec | null {
  if (!isObject(raw)) { warnings.push(`${where}: not an object, skipped`); return null; }
  if (typeof raw.mark !== 'string' || raw.mark === '') { warnings.push(`${where}: no mark, skipped`); return null; }
  const out: Record<string, unknown> = { ...raw };

  if (typeof raw.id !== 'string' || raw.id === '') { out.id = newPlotId(); warnings.push(`${where}: no id, given a new one`); }

  if ('title' in raw && typeof raw.title !== 'string') { warnings.push(`${where}.title: not text, left out`); delete out.title; }
  else if (typeof raw.title === 'string' && raw.title.trim() === '') delete out.title;

  const enc = isObject(raw.encoding) ? raw.encoding : {};
  if (raw.encoding !== undefined && !isObject(raw.encoding)) warnings.push(`${where}.encoding: not an object, left empty`);
  const encoding: Record<string, unknown> = { ...enc };
  for (const role of ['x', 'y'] as const) {
    const f = readField(enc[role], `${where}.encoding.${role}`, warnings);
    if (f) encoding[role] = f; else delete encoding[role];
  }
  if (enc.color !== undefined) {
    const c = enc.color;
    if (isObject(c) && 'follow' in c) { if (c.follow === 'groupBy') encoding.color = { follow: 'groupBy' }; else { encoding.color = c; } }
    else if (isObject(c) && 'none' in c) encoding.color = { none: true };
    else {
      const f = readField(c, `${where}.encoding.color`, warnings);
      if (f) encoding.color = f; else delete encoding.color;
    }
  }
  out.encoding = encoding;

  if ('level' in raw && raw.level !== 'die' && raw.level !== 'wafer') { warnings.push(`${where}.level: "${String(raw.level)}" is not die or wafer, left out`); delete out.level; }
  if ('aggregate' in raw && !(PLOT_AGGREGATES as readonly unknown[]).includes(raw.aggregate)) {
    warnings.push(`${where}.aggregate: "${String(raw.aggregate)}" is not known to this version, left out`); delete out.aggregate;
  }
  if ('bins' in raw && !(Number.isInteger(raw.bins) && (raw.bins as number) >= 1)) { warnings.push(`${where}.bins: not a whole number of at least 1, left out`); delete out.bins; }

  if (raw.axes !== undefined) {
    if (!isObject(raw.axes)) { warnings.push(`${where}.axes: not an object, left out`); delete out.axes; }
    else {
      const axes: Record<string, unknown> = { ...raw.axes };
      for (const a of ['x', 'y'] as const) {
        const ax = readAxis(raw.axes[a], `${where}.axes.${a}`, warnings);
        if (ax) axes[a] = ax; else delete axes[a];
      }
      out.axes = axes;
    }
  }
  return out as unknown as PlotSpec;
}

/** Offset of a JSON syntax error as line and column, where the engine's message states a position. */
function syntaxErrorAt(text: string, message: string): string {
  const m = /position (\d+)/.exec(message);
  if (!m) return message;
  const at = Math.min(Number(m[1]), text.length);
  const before = text.slice(0, at);
  const line = before.split('\n').length;
  const col = at - (before.lastIndexOf('\n') + 1) + 1;
  return `${message} (line ${line}, column ${col})`;
}

/**
 * Reads a plots file. Lenient: every plot that can be read is kept and each problem is named, because a file a
 * user spent time on must not be refused for one bad setting. Only a file with nothing usable is an error.
 * A bare array of plots is accepted as well as the wrapped form.
 */
export function readPlotsFile(text: string): ReadPlotsResult {
  let json: unknown;
  try { json = JSON.parse(text); }
  catch (e) { return { plots: [], warnings: [], error: `Not valid JSON: ${syntaxErrorAt(text, e instanceof Error ? e.message : String(e))}` }; }

  let list: unknown;
  if (Array.isArray(json)) list = json;
  else if (isObject(json)) {
    if (json.format !== PLOTS_FORMAT) {
      return { plots: [], warnings: [], error: `This is not a plots file (expected "format": "${PLOTS_FORMAT}")` };
    }
    list = json.plots;
  } else return { plots: [], warnings: [], error: 'This is not a plots file' };

  if (!Array.isArray(list)) return { plots: [], warnings: [], error: 'The file has no "plots" list' };

  const warnings: string[] = [];
  if (isObject(json) && isFiniteNumber(json.version) && json.version > PLOTS_VERSION) {
    warnings.push(`Written by a newer version (${json.version}); settings this version does not know are kept but not used`);
  }

  const plots: PlotSpec[] = [];
  const seen = new Set<string>();
  list.forEach((raw, i) => {
    const label = isObject(raw) && typeof raw.title === 'string' && raw.title ? `"${raw.title}"` : `plot ${i + 1}`;
    const p = readPlot(raw, label, warnings);
    if (!p) return;
    if (seen.has(p.id)) { p.id = newPlotId(); warnings.push(`${label}: its id was already used, given a new one`); }
    seen.add(p.id);
    plots.push(p);
  });
  if (plots.length === 0 && list.length > 0) return { plots, warnings, error: 'No plot in the file could be read' };
  return { plots, warnings };
}

/** The file for `plots`: wrapped, versioned, with every setting (including ones this build does not know). */
export function writePlotsFile(plots: readonly PlotSpec[]): string {
  return JSON.stringify({ format: PLOTS_FORMAT, version: PLOTS_VERSION, plots }, null, 2) + '\n';
}

/**
 * Adds `incoming` to `existing` as copies where an id is already in use, never replacing: an import must not
 * overwrite a plot the user has edited since. Returns the merged list and the titles that became copies.
 */
export function addPlots(existing: readonly PlotSpec[], incoming: readonly PlotSpec[]): { plots: PlotSpec[]; copies: string[] } {
  const used = new Set(existing.map(p => p.id));
  const copies: string[] = [];
  const added = incoming.map(p => {
    if (!used.has(p.id)) { used.add(p.id); return p; }
    const id = newPlotId();
    used.add(id);
    copies.push(p.title ?? p.id);
    return { ...p, id };
  });
  return { plots: [...existing, ...added], copies };
}

/**
 * Why this build cannot draw `plot`, or `undefined` when it can: a mark or field kind from a newer version.
 * (A test that is missing from the open lot is a data question, answered by the resolver, not a version one.)
 */
export function plotIssue(plot: PlotSpec): string | undefined {
  if (!(PLOT_MARKS as readonly unknown[]).includes(plot.mark)) return 'Needs a newer version of this tool';
  const fields = [plot.encoding.x, plot.encoding.y, plot.encoding.color];
  for (const f of fields) {
    if (f === undefined || (isObject(f) && ('follow' in f || 'none' in f))) continue;
    if (!isField(f)) return 'Needs a newer version of this tool';
  }
  return undefined;
}
