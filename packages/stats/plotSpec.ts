// The plot builder's saved recipe, and the file it travels in.
//
// A `PlotSpec` is plain data: which fields stand for X, Y and colour, what kind of chart draws them, and the
// handful of axis settings a user can change. It carries NO population (which wafers are in view is the
// Insights scope or the drilldown selection), so the same spec works on any lot, and it holds no function, so
// a host can keep it as JSON. The library never stores anything itself; the host keeps the list
// (`InsightsOptions.plots` in, `onPlotsChange` out), the way it keeps sweeps.
//
// Compatibility is the point of this file, because once a user has a file the format is a promise:
//   - `version` is an integer; a reader accepts any version up to its own and ignores fields it does not know.
//   - Fields it does not know are KEPT on write, so a round trip through an older build does not strip a
//     newer build's settings.
//   - A chart or field kind it does not know is kept and reported by `plotIssue`, never dropped.
//   - New fields are optional with a stated default, so a plot saved today means the same plot in a year.
//
// Pure, no DOM.

import { newPlotId } from './plotId.js';
import type { SweepSpec } from './sweep.js';
export { newPlotId };

export const PLOTS_FORMAT = 'wafermap-plots';
export const PLOTS_VERSION = 1;

/** The marker of the sweeps file tsmap wrote before sweeps became plots. A plots file reader accepts it. */
export const SWEEPS_FORMAT = 'tsmap-sweeps';

/** A sweep's own definition: a `SweepSpec` without the `id` and `title` the plot already carries. */
export type SweepPayload = Omit<SweepSpec, 'id' | 'title'>;

export const PLOT_CHARTS = ['scatter', 'histogram', 'box', 'bar', 'line', 'sweep', 'probability'] as const;
export type PlotChart = (typeof PLOT_CHARTS)[number];

export const PLOT_BUILTINS = ['wafer', 'x', 'y', 'ring', 'quadrant', 'reticleCell', 'reticleShot', 'hbin', 'sbin', 'site', 'yield', 'dieCount', 'waferOrder', 'test', 'pat', 'radius'] as const;
export type PlotBuiltin = (typeof PLOT_BUILTINS)[number];

/** A series a plot can put on an axis or use for colour. */
export type PlotField =
  /** A measured test. The number is the key; the name is a check, so a plot saved against another test program is
   *  reported rather than drawn against the wrong measurement. */
  | { test: number; name?: string }
  | { builtin: PlotBuiltin }
  /** A wafer or lot metadata key (split, slot, temperature…). */
  | { meta: string }
  /**
   * Several measured tests read as one series of values, each value labelled with its test: the Y of a box, bar, line
   * or histogram, divided by the `test` builtin on X or Colour. Entries are test numbers or ranges such as
   * `"1010..1030"`, the syntax a sweep's tests use. `names` holds the name each test had when the plot was made, the
   * same check a single test's `name` is.
   */
  | PlotTestSet;

export interface PlotTestSet { tests: Array<number | string>; names?: Record<string, string> }

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

export const PLOT_LIMITS = ['both', 'test', 'spec', 'none'] as const;
export type PlotLimits = (typeof PLOT_LIMITS)[number];

export type PlotColor = PlotField | { follow: 'groupBy' } | { none: true };

export const PLOT_NORMALIZE = ['limits', 'zscore', 'robust'] as const;
/**
 * How a measured test's values are rescaled before they are drawn, each test on its own:
 *   - `limits`: 0 at the low limit, 1 at the high one (spec limits when the test has both, else test limits), as the
 *     capability chart draws them. A test without both limits cannot be placed and is left out.
 *   - `zscore`: standard deviations from the mean of the values in view.
 *   - `robust`: the same from the median, with the spread read from the median absolute deviation (×1.4826), so a few
 *     outliers do not set the scale.
 */
export type PlotNormalize = (typeof PLOT_NORMALIZE)[number];

export interface PlotSpec {
  /** Stable, generated once, never reused; survives rename and reorder. */
  id: string;
  /** Set only when the user typed one; absent = the automatic title. */
  title?: string;
  /** The kind of chart that draws the plot. */
  chart: PlotChart;
  /** Which field stands for each role. Absent for a sweep, which names runs of tests instead. */
  fields?: {
    /**
     * A box or bar may take a list, outer level first: one category per combination of their values, drawn as a nested
     * axis (test, then ring within each test). Every other chart takes one field.
     */
    x?: PlotField | PlotField[];
    y?: PlotField;
    /** Absent = follow the tab's Group by. */
    color?: PlotColor;
    /**
     * One panel per value of this category field, each drawing the plot over that part of the population, on shared
     * axes and colours: a wafer field (split, lot) takes whole wafers, a die field (ring, site) the dies in it, and Test,
     * with a set of tests on Y, one test per panel. Absent = one plot.
     */
    facet?: PlotField;
  };
  /** The unit one mark stands for. Absent = the finest level the X and Y fields allow. */
  level?: 'die' | 'wafer';
  /** How die-level values are combined into one mark. Absent = a mean (a count when there is no Y). */
  aggregate?: PlotAggregate;
  axes?: { x?: PlotAxis; y?: PlotAxis };
  /** Histogram bin count. Absent = automatic. */
  bins?: number;
  /** Which of a plotted test's limits are drawn: `test` limits, `spec` limits (LSL/USL), `both` or `none`. Absent = both. */
  limits?: PlotLimits;
  /**
   * A probability plot's vertical axis: `normal` spaces the cumulative share by the normal quantile, so a normal
   * distribution is a straight line and its tails are spread out; `linear` is the plain cumulative share, 0 to 100%.
   * Absent = normal.
   */
  probabilityAxis?: 'normal' | 'linear';
  /** A bar's colours stacked into one bar per category (`stack`), or each as its share of the category (`percent`).
   *  Only for counts and sums, which add up. Absent = side by side. */
  stack?: 'stack' | 'percent';
  /** Categories in order of their value, largest first (a box by its median). Absent = the field's own order. */
  sort?: 'value';
  /** Only the first this many categories, after sorting; the rest are counted in a note. Absent = all. */
  top?: number;
  /** A cumulative-percentage line over a value-sorted bar of counts or sums: a pareto chart. */
  cumulative?: boolean;
  /** Rescale the measured values on Y, each test on its own. Absent = the values as measured. */
  normalize?: PlotNormalize;
  /** The definition of a `sweep` chart: ordered runs of tests read as curves. Such a plot has no `fields`. */
  sweep?: SweepPayload;
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
const RANGE_TEXT = /^\s*\d+\s*(\.\.\s*\d+\s*)?$/;
const isTestEntry = (v: unknown): boolean => (typeof v === 'number' && Number.isInteger(v)) || (typeof v === 'string' && RANGE_TEXT.test(v));

/** Most panels a faceted plot draws. */
export const PLOT_FACET_LIMIT = 24;

/** Most levels a nested X takes. */
export const PLOT_X_LEVELS = 3;

/** The X field or fields of a plot as a list, outer first; empty when it has none. */
export const xFieldsOf = (x: PlotField | PlotField[] | undefined): PlotField[] => (x === undefined ? [] : Array.isArray(x) ? x : [x]);

/** Two fields name the same series. */
export function sameField(a: PlotField | undefined, b: PlotField | undefined): boolean {
  if (!a || !b) return a === b;
  if ('test' in a) return 'test' in b && a.test === b.test;
  if ('builtin' in a) return 'builtin' in b && a.builtin === b.builtin;
  if ('tests' in a) return 'tests' in b && a.tests.length === b.tests.length && a.tests.every((t, i) => String(t) === String(b.tests[i]));
  return 'meta' in b && a.meta === b.meta;
}

/** A field that names several tests. */
export const isTestSet = (f: unknown): f is PlotTestSet => isObject(f) && 'tests' in f && Array.isArray(f.tests);

export function isField(v: unknown): v is PlotField {
  if (!isObject(v)) return false;
  if ('test' in v) return Number.isInteger(v.test);
  if ('builtin' in v) return (PLOT_BUILTINS as readonly unknown[]).includes(v.builtin);
  if ('meta' in v) return typeof v.meta === 'string' && v.meta !== '';
  if ('tests' in v) return Array.isArray(v.tests) && v.tests.length > 0 && v.tests.every(isTestEntry);
  return false;
}

/** A field this build can read, or `null` with the reason it cannot. A kind it does not know is not an error. */
function readField(raw: unknown, where: string, warnings: string[]): PlotField | undefined {
  if (raw === undefined) return undefined;
  if (!isObject(raw)) { warnings.push(`${where}: not a field, left out`); return undefined; }
  if ('test' in raw) {
    if (!Number.isInteger(raw.test)) { warnings.push(`${where}: test number ${JSON.stringify(raw.test)} is not an integer, left out`); return undefined; }
    // Keys this build does not know are kept, so a round trip through it does not strip a newer build's settings.
    const out: Record<string, unknown> = { ...raw, test: raw.test as number };
    if (typeof raw.name === 'string' && raw.name !== '') out.name = raw.name; else delete out.name;
    return out as unknown as PlotField;
  }
  if ('builtin' in raw) {
    if (!(PLOT_BUILTINS as readonly unknown[]).includes(raw.builtin)) {
      // Possibly a field a newer build added: kept as written, and reported by plotIssue.
      return raw as unknown as PlotField;
    }
    return { ...raw, builtin: raw.builtin as PlotBuiltin } as unknown as PlotField;
  }
  if ('meta' in raw) {
    if (typeof raw.meta !== 'string' || raw.meta === '') { warnings.push(`${where}: metadata key is empty, left out`); return undefined; }
    return { ...raw, meta: raw.meta } as unknown as PlotField;
  }
  if ('tests' in raw) {
    if (!Array.isArray(raw.tests) || raw.tests.length === 0 || !raw.tests.every(isTestEntry)) {
      warnings.push(`${where}: its tests must be test numbers or ranges such as "1010..1030", left out`); return undefined;
    }
    const out: Record<string, unknown> = { ...raw, tests: raw.tests };
    if ('names' in raw && !(isObject(raw.names) && Object.values(raw.names).every(v => typeof v === 'string'))) { warnings.push(`${where}.names: not a list of names, left out`); delete out.names; }
    return out as unknown as PlotField;
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
 * A sweep's definition from parsed JSON. Lenient like the rest of the file: a series that cannot be read is named and
 * left out, a setting that is wrong is dropped, and settings this build does not know are kept.
 */
export function readSweepPayload(raw: unknown, where: string, warnings: string[]): SweepPayload {
  if (!isObject(raw)) { warnings.push(`${where}: no sweep definition, left empty`); return { series: [] }; }
  const out: Record<string, unknown> = { ...raw };
  delete out.id; delete out.title;
  const list = Array.isArray(raw.series) ? raw.series : [];
  if (!Array.isArray(raw.series)) warnings.push(`${where}.series: not a list, left empty`);
  const series: unknown[] = [];
  list.forEach((s, i) => {
    const at = `${where}.series ${i + 1}`;
    if (!isObject(s)) { warnings.push(`${at}: not an object, skipped`); return; }
    const one: Record<string, unknown> = { ...s };
    if (typeof s.label !== 'string' || s.label.trim() === '') one.label = `Series ${i + 1}`;
    if (!Array.isArray(s.tests) || !s.tests.every(isTestEntry)) {
      warnings.push(`${at}: its tests must be test numbers or ranges such as "1010..1030", skipped`);
      return;
    }
    if ('xValues' in s && !(Array.isArray(s.xValues) && s.xValues.every(isFiniteNumber))) { warnings.push(`${at}.xValues: not a list of numbers, left out`); delete one.xValues; }
    if ('xFromName' in s && typeof s.xFromName !== 'string') { warnings.push(`${at}.xFromName: not text, left out`); delete one.xFromName; }
    if ('color' in s && typeof s.color !== 'string') delete one.color;
    if ('testNames' in s && !(isObject(s.testNames) && Object.values(s.testNames).every(v => typeof v === 'string'))) { warnings.push(`${at}.testNames: not a list of names, left out`); delete one.testNames; }
    series.push(one);
  });
  out.series = series;
  for (const k of ['xLabel', 'xUnit', 'yLabel'] as const) {
    if (k in raw && typeof raw[k] !== 'string') { warnings.push(`${where}.${k}: not text, left out`); delete out[k]; }
  }
  if ('xScale' in raw && raw.xScale !== 'linear' && raw.xScale !== 'log') { warnings.push(`${where}.xScale: "${String(raw.xScale)}" is not linear or log, left out`); delete out.xScale; }
  if ('crossing' in raw && typeof raw.crossing !== 'boolean') { warnings.push(`${where}.crossing: not true or false, left out`); delete out.crossing; }
  if ('separationAt' in raw && !(Array.isArray(raw.separationAt) && raw.separationAt.every(isFiniteNumber))) { warnings.push(`${where}.separationAt: not a list of numbers, left out`); delete out.separationAt; }
  return out as unknown as SweepPayload;
}

/** The plot a sweep becomes: its id and title go on the envelope, the rest is the payload. */
export function sweepToPlot(spec: SweepSpec): PlotSpec {
  const { id, title, ...payload } = spec;
  return { id, ...(title ? { title } : {}), chart: 'sweep', sweep: payload };
}

/** The sweep a `sweep` plot defines, in the shape the sweep maths reads; `undefined` for any other chart. */
export function plotToSweep(plot: PlotSpec): SweepSpec | undefined {
  if (plot.chart !== 'sweep') return undefined;
  return { ...(plot.sweep ?? { series: [] }), id: plot.id, title: plot.title ?? 'Sweep' };
}

/**
 * One plot from parsed JSON, or `null` when it cannot be a plot at all (no chart). Unknown keys survive; a
 * setting that is wrong is dropped with a warning and the rest of the plot is kept.
 */
export function readPlot(raw: unknown, where: string, warnings: string[]): PlotSpec | null {
  if (!isObject(raw)) { warnings.push(`${where}: not an object, skipped`); return null; }
  const chart = raw.chart;
  if (typeof chart !== 'string' || chart === '') { warnings.push(`${where}: no chart, skipped`); return null; }
  const out: Record<string, unknown> = { ...raw };

  if (typeof raw.id !== 'string' || raw.id === '') { out.id = newPlotId(); warnings.push(`${where}: no id, given a new one`); }

  if ('title' in raw && typeof raw.title !== 'string') { warnings.push(`${where}.title: not text, left out`); delete out.title; }
  else if (typeof raw.title === 'string' && raw.title.trim() === '') delete out.title;

  const enc = isObject(raw.fields) ? raw.fields : {};
  if (raw.fields !== undefined && !isObject(raw.fields)) warnings.push(`${where}.fields: not an object, left empty`);
  const fields: Record<string, unknown> = { ...enc };
  for (const role of ['x', 'y'] as const) {
    if (role === 'x' && Array.isArray(enc.x)) {
      const levels = enc.x.map((raw, i) => readField(raw, `${where}.fields.x ${i + 1}`, warnings)).filter((f): f is PlotField => !!f);
      if (levels.length) fields.x = levels; else delete fields.x;
      continue;
    }
    const f = readField(enc[role], `${where}.fields.${role}`, warnings);
    if (f) fields[role] = f; else delete fields[role];
  }
  if (enc.facet !== undefined) {
    const f = readField(enc.facet, `${where}.fields.facet`, warnings);
    if (f) fields.facet = f; else delete fields.facet;
  }
  if (enc.color !== undefined) {
    const c = enc.color;
    if (isObject(c) && 'follow' in c) { if (c.follow === 'groupBy') fields.color = { follow: 'groupBy' }; else { fields.color = c; } }
    else if (isObject(c) && 'none' in c) fields.color = { none: true };
    else {
      const f = readField(c, `${where}.fields.color`, warnings);
      if (f) fields.color = f; else delete fields.color;
    }
  }
  // A sweep has no fields to name; any other chart always has the object, so a reader of the list can rely on it.
  if (chart === 'sweep' && Object.keys(fields).length === 0) delete out.fields; else out.fields = fields;

  if ('level' in raw && raw.level !== 'die' && raw.level !== 'wafer') { warnings.push(`${where}.level: "${String(raw.level)}" is not die or wafer, left out`); delete out.level; }
  if ('aggregate' in raw && !(PLOT_AGGREGATES as readonly unknown[]).includes(raw.aggregate)) {
    warnings.push(`${where}.aggregate: "${String(raw.aggregate)}" is not known to this version, left out`); delete out.aggregate;
  }
  if ('stack' in raw && raw.stack !== 'stack' && raw.stack !== 'percent') { warnings.push(`${where}.stack: "${String(raw.stack)}" is not stack or percent, left out`); delete out.stack; }
  if ('sort' in raw && raw.sort !== 'value') { warnings.push(`${where}.sort: "${String(raw.sort)}" is not known to this version, left out`); delete out.sort; }
  if ('top' in raw && !(Number.isInteger(raw.top) && (raw.top as number) >= 1)) { warnings.push(`${where}.top: not a whole number of at least 1, left out`); delete out.top; }
  if ('cumulative' in raw && typeof raw.cumulative !== 'boolean') { warnings.push(`${where}.cumulative: not true or false, left out`); delete out.cumulative; }
  if ('probabilityAxis' in raw && raw.probabilityAxis !== 'normal' && raw.probabilityAxis !== 'linear') {
    warnings.push(`${where}.probabilityAxis: "${String(raw.probabilityAxis)}" is not normal or linear, left out`); delete out.probabilityAxis;
  }
  if ('normalize' in raw && !(PLOT_NORMALIZE as readonly unknown[]).includes(raw.normalize)) {
    warnings.push(`${where}.normalize: "${String(raw.normalize)}" is not known to this version, left out`); delete out.normalize;
  }
  if ('limits' in raw && !(PLOT_LIMITS as readonly unknown[]).includes(raw.limits)) { warnings.push(`${where}.limits: "${String(raw.limits)}" is not both, test, spec or none, left out`); delete out.limits; }
  if ('bins' in raw && !(Number.isInteger(raw.bins) && (raw.bins as number) >= 1)) { warnings.push(`${where}.bins: not a whole number of at least 1, left out`); delete out.bins; }
  if (chart === 'sweep') out.sweep = readSweepPayload(raw.sweep, `${where}.sweep`, warnings);

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
    if (json.format === SWEEPS_FORMAT) {
      // A sweeps file from before sweeps were plots: each sweep is a plot with the sweep chart.
      if (!Array.isArray(json.sweeps)) return { plots: [], warnings: [], error: 'The file has no "sweeps" list' };
      list = json.sweeps.map(sw => (isObject(sw) ? { id: sw.id, title: sw.title, chart: 'sweep', sweep: sw } : sw));
    } else if (json.format !== PLOTS_FORMAT) {
      return { plots: [], warnings: [], error: `This is not a plots file (expected "format": "${PLOTS_FORMAT}")` };
    } else list = json.plots;
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
 * Why this build cannot draw `plot`, or `undefined` when it can: a chart or field kind from a newer version.
 * (A test that is missing from the open lot is a data question, answered by the resolver, not a version one.)
 */
export function plotIssue(plot: PlotSpec): string | undefined {
  if (!(PLOT_CHARTS as readonly unknown[]).includes(plot.chart)) return 'Needs a newer version of this tool';
  const given = plot.fields ?? {};
  for (const f of [...xFieldsOf(given.x), given.y, given.color, given.facet]) {
    if (f === undefined || (isObject(f) && ('follow' in f || 'none' in f))) continue;
    if (!isField(f)) return 'Needs a newer version of this tool';
  }
  return undefined;
}
