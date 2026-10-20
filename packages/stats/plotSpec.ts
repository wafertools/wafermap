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

export const PLOT_CHARTS = ['scatter', 'histogram', 'box', 'bar', 'line', 'sweep', 'probability', 'control', 'goal', 'heatmap'] as const;
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
  | PlotTestSet
  /**
   * A test's pass rate: each die 100 when it passes the test and 0 when it fails (a parametric test judged by its test
   * limits, a functional one by its recorded verdict), so a bar or line of it is the share of judged dies that pass.
   * `name` is checked as a test field's is.
   */
  | { passRate: number; name?: string; judge?: PlotJudge }
  | PlotBinnedField;

/**
 * How a pass rate judges a die: `limits` (the default) a parametric test's measured value against its test limits;
 * `flag` the pass or fail the tester recorded (STDF's own flag, which exists whether or not limits do). A functional
 * test has only its recorded verdict, and is judged by it either way.
 */
export const PLOT_JUDGES = ['limits', 'flag'] as const;
export type PlotJudge = (typeof PLOT_JUDGES)[number];

/**
 * Several tests as one series. `passRate`: each test's pass rate (each die 100 or 0, as a single test's pass rate is)
 * instead of its measured values, judged by `judge`.
 */
export interface PlotTestSet { tests: Array<number | string>; names?: Record<string, string>; passRate?: true; judge?: PlotJudge }

/** A set of tests read as pass rates. */
export const isPassRateSet = (f: unknown): f is PlotTestSet & { passRate: true } => isTestSet(f) && f.passRate === true;

export const PLOT_BIN_BY = ['count', 'width'] as const;
/** Fewest and most bins a binned field takes, and how many it takes when it does not say. */
export const PLOT_BINS_MIN = 2, PLOT_BINS_MAX = 20, PLOT_BINS_DEFAULT = 5;

/**
 * A continuous field cut into ranges, so it can be a category: the X of a box or bar, a colour, a heatmap's rows or
 * columns, the panels. `binned` is a measured test, a die position (radius, X, Y) or a wafer figure (yield, a lot field
 * of numbers); `bins` how many ranges (default 5); `by` whether each range holds about the same number of values
 * (`'count'`, the default: quintiles, deciles) or spans the same width (`'width'`). The edges are set over the whole
 * population plotted, so every panel and every colour shares them.
 */
export interface PlotBinnedField { binned: PlotField; bins?: number; by?: (typeof PLOT_BIN_BY)[number] }

/** A binned field. */
export const isBinned = (f: unknown): f is PlotBinnedField => isObject(f) && 'binned' in f;

/** The most reference lines and bands one axis carries. */
export const PLOT_REFERENCES_MAX = 8;

/**
 * A line the reader draws on a value axis: at `at`, or a shaded band from `at` to `to`. Values are in the axis's own
 * unit, as measured (or as rescaled, when the plot is). `label` names it on the chart; absent = the value alone.
 */
export type PlotReference = PlotValueReference | PlotStatReference;
export interface PlotValueReference { at: number; to?: number; label?: string }

export const PLOT_REFERENCE_STATS = ['median', 'mean'] as const;
/**
 * A line at the median or mean of what the plot draws on that axis: the bars' heights, the points' values, the values
 * in the boxes. Over the whole plot, so every panel shares it. `label` names it; absent = the statistic's name.
 */
export interface PlotStatReference { stat: (typeof PLOT_REFERENCE_STATS)[number]; label?: string }

export const isStatReference = (r: PlotReference): r is PlotStatReference => 'stat' in r;

export interface PlotAxis {
  /** Replaces the automatic axis title. Absent = automatic. */
  label?: string;
  /** Reference lines and bands on a value axis: a target, a guard band, a customer's limit. Absent = none. */
  references?: PlotReference[];
  scale?: 'linear' | 'log';
  /** Widen the axis to every limit drawn on it (`true`), or never (`false`). Absent = when that still leaves the data at
   *  least a third of the axis. */
  includeLimits?: boolean;
  /** Narrow the axis to a robust range (the quartiles ± 1.5 × their spread) so a few extreme values do not flatten the
   *  rest. Only the axis: every statistic still uses every value, and the footnote counts the values outside. */
  clip?: boolean;
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

/**
 * One condition of a filter. A category field keeps the units whose value is one of `values`; a number keeps those
 * from `min` to `max` inclusive, either end open. `not` keeps everything else. A unit with no value for the field
 * (no bin, no reading) meets no condition, negated or not.
 */
export interface PlotCondition {
  field: PlotField;
  values?: string[];
  min?: number;
  max?: number;
  not?: boolean;
}

/** Conditions that must all hold. `off` keeps them and applies none, so a filter can be switched off and back on. */
export interface PlotFilter {
  conditions: PlotCondition[];
  off?: boolean;
}

/** The conditions a spec applies: none when it has no filter or the filter is off. */
export function plotConditions(spec: Pick<PlotSpec, 'where'>): PlotCondition[] {
  const f = spec.where;
  return f && !f.off ? f.conditions : [];
}

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
    /** A heatmap's rows: a category field (Test, with a set of tests as the values; a bin; a ring). Its columns are `x`. */
    rows?: PlotField;
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
  /** Categories in order of their value: `value` largest first (a box by its median), `ascending` smallest first (the
   *  worst pass rate at the top). With colours, a category's value is all its colours together. Absent = the field's own order. */
  sort?: 'value' | 'ascending';
  /** Only the first this many categories, after sorting; the rest are counted in a note. Absent = all. */
  top?: number;
  /**
   * A bar of counts or sums as each colour's share of its own total, in percent (`percent`), so groups of different sizes
   * compare: the bin mix of a small split beside a large one. Not with `stack`. Absent = the counts or sums.
   */
  barNorm?: 'count' | 'percent';
  /** A box or bar plot's categories down the left and its values along the bottom (`horizontal`), for many categories or
   *  long names. Absent = categories along the bottom. */
  orientation?: 'vertical' | 'horizontal';
  /** Each bar's value printed at its end (when every value fits its bar's width; else none are). Absent = none. */
  valueLabels?: boolean;
  /** A cumulative-percentage line over a value-sorted bar of counts or sums: a pareto chart. */
  cumulative?: boolean;
  /**
   * A band round a line of means or medians at each X: `sd` mean ± one standard deviation of the values combined there,
   * `ci95` the mean's 95% confidence interval (Student's t), `iqr` the quartiles, `minmax` the range. Absent = none.
   */
  spread?: 'sd' | 'ci95' | 'iqr' | 'minmax';
  /**
   * A scatter's fitted line per colour: `linear` least squares of Y on X, `orthogonal` the line closest to the points
   * at right angles (Deming regression with equal errors), for two measurements of one quantity. Absent = none.
   */
  fit?: 'linear' | 'orthogonal';
  /** A scatter's y = x line, for X and Y in one unit. */
  identity?: boolean;
  /** A histogram's bars as counts, or as each colour's share of its own values in percent. Absent = counts. */
  histNorm?: 'count' | 'percent';
  /** Each colour's fitted normal distribution over its histogram bars. */
  normalCurve?: boolean;
  /** Proposed limits for the plotted test, on a histogram or probability plot: drawn, and its pass rate under them stated. */
  whatIf?: { lo?: number; hi?: number };
  /** A control chart's limits set from its first this many points (at least 3). Absent = all of them. */
  baseline?: number;
  /**
   * Only the dies (or, for a wafer field, the wafers) that meet every condition: bin 1 only, the edge ring, one split,
   * Vth within a range. Applied before everything else, panels included; `off` keeps the conditions and applies none.
   * Absent = every die.
   */
  where?: PlotFilter;
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
  // A binned field is the same series as another binning of the same field: it is one field, cut differently.
  if (isBinned(a) || isBinned(b)) return isBinned(a) && isBinned(b) && sameField(a.binned, b.binned);
  if ('test' in a) return 'test' in b && a.test === b.test;
  if ('builtin' in a) return 'builtin' in b && a.builtin === b.builtin;
  if ('tests' in a) return 'tests' in b && !!a.passRate === !!b.passRate && (a.judge ?? 'limits') === (b.judge ?? 'limits')
    && a.tests.length === b.tests.length && a.tests.every((t, i) => String(t) === String(b.tests[i]));
  if ('passRate' in a) return 'passRate' in b && !('tests' in b) && a.passRate === b.passRate && (a.judge ?? 'limits') === (b.judge ?? 'limits');
  return 'meta' in b && a.meta === b.meta;
}

/** A field that names several tests. */
export const isTestSet = (f: unknown): f is PlotTestSet => isObject(f) && 'tests' in f && Array.isArray(f.tests);

export function isField(v: unknown): v is PlotField {
  if (!isObject(v)) return false;
  if ('binned' in v) return isField(v.binned) && !isBinned(v.binned) && !isTestSet(v.binned) && !('passRate' in v.binned);
  if ('test' in v) return Number.isInteger(v.test);
  if ('builtin' in v) return (PLOT_BUILTINS as readonly unknown[]).includes(v.builtin);
  if ('meta' in v) return typeof v.meta === 'string' && v.meta !== '';
  if ('tests' in v) return Array.isArray(v.tests) && v.tests.length > 0 && v.tests.every(isTestEntry);
  if ('passRate' in v) return Number.isInteger(v.passRate) && (v.judge === undefined || (PLOT_JUDGES as readonly unknown[]).includes(v.judge));
  return false;
}

/** A pass rate's `judge` this build does not know is left out (the default, test limits, then applies) and named. */
function dropBadJudge(out: Record<string, unknown>, where: string, warnings: string[]): void {
  if ('judge' in out && !(PLOT_JUDGES as readonly unknown[]).includes(out.judge)) {
    warnings.push(`${where}.judge: "${String(out.judge)}" is not limits or flag, left out`);
    delete out.judge;
  }
}

/** A field this build can read, or `null` with the reason it cannot. A kind it does not know is not an error. */
function readField(raw: unknown, where: string, warnings: string[]): PlotField | undefined {
  if (raw === undefined) return undefined;
  if (!isObject(raw)) { warnings.push(`${where}: not a field, left out`); return undefined; }
  if ('binned' in raw) {
    const inner = readField(raw.binned, `${where}.binned`, warnings);
    if (!inner || isBinned(inner) || isTestSet(inner) || 'passRate' in inner) { if (inner) warnings.push(`${where}: only one test or value can be binned, left out`); return undefined; }
    const out: Record<string, unknown> = { ...raw, binned: inner };
    if ('bins' in raw && !(Number.isInteger(raw.bins) && (raw.bins as number) >= PLOT_BINS_MIN && (raw.bins as number) <= PLOT_BINS_MAX)) {
      warnings.push(`${where}.bins: ${JSON.stringify(raw.bins)} is not a whole number from ${PLOT_BINS_MIN} to ${PLOT_BINS_MAX}, left out`); delete out.bins;
    }
    if ('by' in raw && !(PLOT_BIN_BY as readonly unknown[]).includes(raw.by)) { warnings.push(`${where}.by: "${String(raw.by)}" is not count or width, left out`); delete out.by; }
    return out as unknown as PlotField;
  }
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
  if ('passRate' in raw && !('tests' in raw)) {
    if (!Number.isInteger(raw.passRate)) { warnings.push(`${where}: pass-rate test ${JSON.stringify(raw.passRate)} is not an integer, left out`); return undefined; }
    const out: Record<string, unknown> = { ...raw };
    if (!(typeof raw.name === 'string' && raw.name !== '')) delete out.name;
    dropBadJudge(out, where, warnings);
    return out as unknown as PlotField;
  }
  if ('tests' in raw) {
    if (!Array.isArray(raw.tests) || raw.tests.length === 0 || !raw.tests.every(isTestEntry)) {
      warnings.push(`${where}: its tests must be test numbers or ranges such as "1010..1030", left out`); return undefined;
    }
    const out: Record<string, unknown> = { ...raw, tests: raw.tests };
    if ('passRate' in raw && raw.passRate !== true) { warnings.push(`${where}.passRate: not true, left out`); delete out.passRate; }
    dropBadJudge(out, where, warnings);
    if ('names' in raw && !(isObject(raw.names) && Object.values(raw.names).every(v => typeof v === 'string'))) { warnings.push(`${where}.names: not a list of names, left out`); delete out.names; }
    return out as unknown as PlotField;
  }
  return raw as unknown as PlotField; // a kind from a newer build
}

/**
 * A filter from a file: `{ conditions, off }`. A single condition written without the list (`{ field, values }`) is read
 * as a list of one. A condition that cannot be read is named and left out; a filter left with none is no filter.
 */
export function readFilter(raw: Record<string, unknown>, where: string, warnings: string[]): PlotFilter | undefined {
  const list = Array.isArray(raw.conditions) ? raw.conditions : 'field' in raw ? [{ field: raw.field, values: raw.values }] : [];
  const conditions: PlotCondition[] = [];
  list.forEach((c, i) => {
    const at = Array.isArray(raw.conditions) ? `${where}.conditions[${i}]` : where;
    const cond = readCondition(c, at, warnings);
    if (cond) conditions.push(cond);
  });
  if (conditions.length === 0) return undefined;
  const { field: _f, values: _v, conditions: _c, ...rest } = raw;
  const out: PlotFilter = { ...rest, conditions };
  if ('off' in raw && typeof raw.off !== 'boolean') { warnings.push(`${where}.off: not true or false, left out`); delete out.off; }
  return out;
}

function readCondition(raw: unknown, where: string, warnings: string[]): PlotCondition | undefined {
  if (!isObject(raw)) { warnings.push(`${where}: not a condition, left out`); return undefined; }
  const field = readField(raw.field, `${where}.field`, warnings);
  if (!field) return undefined;
  const out: PlotCondition = { ...raw, field };
  if ('values' in raw) {
    const values = Array.isArray(raw.values) ? raw.values.filter((v): v is string => typeof v === 'string') : [];
    if (values.length) out.values = values; else { warnings.push(`${where}.values: not a list of values, left out`); delete out.values; }
  }
  for (const k of ['min', 'max'] as const) if (k in raw && !isFiniteNumber(raw[k])) { warnings.push(`${where}.${k}: not a number, left out`); delete out[k]; }
  if (out.min !== undefined && out.max !== undefined && out.min > out.max) { warnings.push(`${where}: min is above max, the range left out`); delete out.min; delete out.max; }
  if ('not' in raw && typeof raw.not !== 'boolean') { warnings.push(`${where}.not: not true or false, left out`); delete out.not; }
  if (!out.values && out.min === undefined && out.max === undefined) { warnings.push(`${where}: needs values or a range, left out`); return undefined; }
  return out;
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
  for (const k of ['reverse', 'includeLimits', 'clip'] as const) if (k in raw && typeof raw[k] !== 'boolean') { warnings.push(`${where}.${k}: not true or false, left out`); delete out[k]; }
  if ('references' in raw) {
    const kept: PlotReference[] = [];
    const list = Array.isArray(raw.references) ? raw.references : [];
    if (!Array.isArray(raw.references)) warnings.push(`${where}.references: not a list, left out`);
    list.forEach((r, i) => {
      const labelOk = isObject(r) && (r.label === undefined || typeof r.label === 'string');
      const value = labelOk && isFiniteNumber(r.at) && (r.to === undefined || (isFiniteNumber(r.to) && r.to !== r.at));
      const stat = labelOk && !value && (PLOT_REFERENCE_STATS as readonly unknown[]).includes(r.stat);
      if (value || stat) {
        if (kept.length < PLOT_REFERENCES_MAX) kept.push(value ? { ...r, at: r.at, ...(r.to !== undefined ? { to: r.to } : {}) } as PlotReference : { ...r } as unknown as PlotReference);
        else warnings.push(`${where}.references[${i}]: more than ${PLOT_REFERENCES_MAX}, left out`);
      } else warnings.push(`${where}.references[${i}]: needs a number (and a different number for a band), or median or mean, left out`);
    });
    if (kept.length) out.references = kept; else delete out.references;
  }
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
  if (enc.rows !== undefined) {
    const f = readField(enc.rows, `${where}.fields.rows`, warnings);
    if (f) fields.rows = f; else delete fields.rows;
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
  if ('where' in raw) {
    const w = raw.where;
    const filter = isObject(w) ? readFilter(w, `${where}.where`, warnings) : undefined;
    if (!filter) { warnings.push(`${where}.where: needs at least one condition, left out`); delete out.where; }
    else out.where = filter;
  }
  if ('stack' in raw && raw.stack !== 'stack' && raw.stack !== 'percent') { warnings.push(`${where}.stack: "${String(raw.stack)}" is not stack or percent, left out`); delete out.stack; }
  if ('sort' in raw && raw.sort !== 'value' && raw.sort !== 'ascending') { warnings.push(`${where}.sort: "${String(raw.sort)}" is not known to this version, left out`); delete out.sort; }
  if ('top' in raw && !(Number.isInteger(raw.top) && (raw.top as number) >= 1)) { warnings.push(`${where}.top: not a whole number of at least 1, left out`); delete out.top; }
  if ('baseline' in raw && !(Number.isInteger(raw.baseline) && (raw.baseline as number) >= 3)) { warnings.push(`${where}.baseline: not a whole number of at least 3, left out`); delete out.baseline; }
  if ('fit' in raw && raw.fit !== 'linear' && raw.fit !== 'orthogonal') { warnings.push(`${where}.fit: "${String(raw.fit)}" is not linear or orthogonal, left out`); delete out.fit; }
  for (const k of ['identity', 'normalCurve', 'valueLabels'] as const) if (k in raw && typeof raw[k] !== 'boolean') { warnings.push(`${where}.${k}: not true or false, left out`); delete out[k]; }
  if ('orientation' in raw && raw.orientation !== 'vertical' && raw.orientation !== 'horizontal') { warnings.push(`${where}.orientation: "${String(raw.orientation)}" is not vertical or horizontal, left out`); delete out.orientation; }
  if ('barNorm' in raw && raw.barNorm !== 'count' && raw.barNorm !== 'percent') { warnings.push(`${where}.barNorm: "${String(raw.barNorm)}" is not count or percent, left out`); delete out.barNorm; }
  if ('histNorm' in raw && raw.histNorm !== 'count' && raw.histNorm !== 'percent') { warnings.push(`${where}.histNorm: "${String(raw.histNorm)}" is not count or percent, left out`); delete out.histNorm; }
  if ('whatIf' in raw) {
    const w = raw.whatIf;
    const lo = isObject(w) && isFiniteNumber(w.lo) ? w.lo : undefined, hi = isObject(w) && isFiniteNumber(w.hi) ? w.hi : undefined;
    if (lo === undefined && hi === undefined) { warnings.push(`${where}.whatIf: needs a low or a high limit, left out`); delete out.whatIf; }
    else out.whatIf = { ...(lo !== undefined ? { lo } : {}), ...(hi !== undefined ? { hi } : {}) };
  }
  if ('spread' in raw && !['sd', 'ci95', 'iqr', 'minmax'].includes(raw.spread as string)) { warnings.push(`${where}.spread: "${String(raw.spread)}" is not known to this version, left out`); delete out.spread; }
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
export function syntaxErrorAt(text: string, message: string): string {
  const m = /position (\d+)/.exec(message);
  if (!m) return message;
  const at = Math.min(Number(m[1]), text.length);
  const before = text.slice(0, at);
  const line = before.split('\n').length;
  const col = at - (before.lastIndexOf('\n') + 1) + 1;
  return `${message} (line ${line}, column ${col})`;
}

/**
 * The items of a file's list that can be read, each given an id not yet used (a repeat gets a new one, said in
 * `warnings`). `read` returns an item, or `undefined` after naming what was wrong.
 */
export function readIdentified<T extends { id: string }>(list: readonly unknown[], warnings: string[], o: {
  labelOf: (raw: unknown, index: number) => string;
  read: (raw: unknown, label: string, warnings: string[]) => T | null | undefined;
  newId: () => string;
}): T[] {
  const out: T[] = [];
  const seen = new Set<string>();
  list.forEach((raw, i) => {
    const label = o.labelOf(raw, i);
    const item = o.read(raw, label, warnings);
    if (!item) return;
    if (seen.has(item.id)) { item.id = o.newId(); warnings.push(`${label}: its id was already used, given a new one`); }
    seen.add(item.id);
    out.push(item);
  });
  return out;
}

/**
 * The list in a file of `noun` (a plots or a filters file), or why there is none. A bare array is accepted as well as the
 * wrapped form; a file from a newer version is read with a warning. `legacy` reads an older wrapped form of the same
 * list: its list, an error, or `undefined` when the file is not that form.
 */
export function unwrapListFile(text: string, o: {
  format: string; noun: string; key: string; version: number;
  legacy?: (json: Record<string, unknown>) => unknown[] | string | undefined;
}): { list: unknown[]; warnings: string[] } | { error: string } {
  let json: unknown;
  try { json = JSON.parse(text); }
  catch (e) { return { error: `Not valid JSON: ${syntaxErrorAt(text, e instanceof Error ? e.message : String(e))}` }; }
  let list: unknown;
  if (Array.isArray(json)) list = json;
  else if (isObject(json)) {
    const old = o.legacy?.(json);
    if (typeof old === 'string') return { error: old };
    if (old) list = old;
    else if (json.format !== o.format) return { error: `This is not a ${o.noun} file (expected "format": "${o.format}")` };
    else list = json[o.key];
  } else return { error: `This is not a ${o.noun} file` };
  if (!Array.isArray(list)) return { error: `The file has no "${o.key}" list` };
  const warnings: string[] = [];
  if (isObject(json) && isFiniteNumber(json.version) && json.version > o.version) {
    warnings.push(`Written by a newer version (${json.version}); settings this version does not know are kept but not used`);
  }
  return { list, warnings };
}

/**
 * Reads a plots file. Lenient: every plot that can be read is kept and each problem is named, because a file a
 * user spent time on must not be refused for one bad setting. Only a file with nothing usable is an error.
 * A bare array of plots is accepted as well as the wrapped form.
 */
export function readPlotsFile(text: string): ReadPlotsResult {
  const file = unwrapListFile(text, {
    format: PLOTS_FORMAT, noun: 'plots', key: 'plots', version: PLOTS_VERSION,
    // A sweeps file from before sweeps were plots: each sweep is a plot with the sweep chart.
    legacy: json => {
      if (json.format !== SWEEPS_FORMAT) return undefined;
      if (!Array.isArray(json.sweeps)) return 'The file has no "sweeps" list';
      return json.sweeps.map(sw => (isObject(sw) ? { id: sw.id, title: sw.title, chart: 'sweep', sweep: sw } : sw));
    },
  });
  if ('error' in file) return { plots: [], warnings: [], error: file.error };
  const { list, warnings } = file;

  const plots = readIdentified<PlotSpec>(list, warnings, {
    labelOf: (raw, i) => (isObject(raw) && typeof raw.title === 'string' && raw.title ? `"${raw.title}"` : `plot ${i + 1}`),
    read: readPlot, newId: newPlotId,
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
  const { items, copies } = addIdentified(existing, incoming, p => p.title ?? p.id, newPlotId);
  return { plots: items, copies };
}

/**
 * `incoming` added to `existing` as copies where an id is already in use, never replacing. Returns the merged list and
 * the names (`nameOf`) of those that became copies.
 */
export function addIdentified<T extends { id: string }>(
  existing: readonly T[], incoming: readonly T[], nameOf: (item: T) => string, newId: () => string,
): { items: T[]; copies: string[] } {
  const used = new Set(existing.map(p => p.id));
  const copies: string[] = [];
  const added = incoming.map(p => {
    if (!used.has(p.id)) { used.add(p.id); return p; }
    const id = newId();
    used.add(id);
    copies.push(nameOf(p));
    return { ...p, id };
  });
  return { items: [...existing, ...added], copies };
}

/**
 * Why this build cannot draw `plot`, or `undefined` when it can: a chart or field kind from a newer version.
 * (A test that is missing from the open lot is a data question, answered by the resolver, not a version one.)
 */
export function plotIssue(plot: PlotSpec): string | undefined {
  if (!(PLOT_CHARTS as readonly unknown[]).includes(plot.chart)) return 'Needs a newer version of this tool';
  const given = plot.fields ?? {};
  for (const f of [...xFieldsOf(given.x), given.y, given.color, given.facet, given.rows, ...(plot.where?.conditions.map(c => c.field) ?? [])]) {
    if (f === undefined || (isObject(f) && ('follow' in f || 'none' in f))) continue;
    if (!isField(f)) return 'Needs a newer version of this tool';
  }
  return undefined;
}
