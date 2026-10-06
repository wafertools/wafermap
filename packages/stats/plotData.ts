// Resolves a saved plot (`PlotSpec`) over a population of wafers into the data its mark draws.
//
// This is the part of the plot builder that has to be right whatever draws it, so it is pure and DOM-free and
// takes the same shape every population arrives in: a list of wafers, each with its dies (a drilldown source's
// items, or the Insights tab's scope). The Plot tab and the drilldown menu both call it, so there is one path
// for "plot this population" rather than one for the tab and one for a selection.
//
// What it guarantees, from the project's display rules:
//   - A test is looked up by number and CHECKED by name. A plot saved against another test program is reported
//     ("test 3001 is Vth in this plot and Leak here"), never drawn against the wrong measurement.
//   - Nothing is dropped silently: marks left out for a missing value are counted, by the field that was missing.
//   - A yield is never averaged as if it were a measurement: `yield` pools passing over judged dies across the
//     wafers in a cell; `mean` of the yield field is the mean of per-wafer yields, and is labelled so.
//   - A wafer-level field (yield, metadata) cannot be split by a die-level one; that is an issue, not a chart.

import type { Die } from '../core/dies.js';
import { hasPosition } from '../core/dies.js';
import { DIE_REGIONS, DIE_REGION_KEYS } from './dieRegions.js';
import type { Wafer } from '../core/wafer.js';
import type { WaferMetadata } from '../core/metadata.js';
import { testValue, testsPresent } from '../core/dieTable.js';
import { compareNatural, minOf, maxOf } from '../core/utils.js';
import { isParametricTest, type TestDef } from '../renderer/buildWaferMap.js';
import { facetValueOf, buildFacetTable, FACET_NONE_VALUE } from './facets.js';
import type { FacetCuration } from './facets.js';
import { yieldCounts } from './yield.js';
import { sameTestName } from './sweep.js';
import { sameField, plotIssue, isField } from './plotSpec.js';
import type { PlotSpec, PlotField, PlotAxis, PlotAggregate, PlotBuiltin } from './plotSpec.js';

/** One wafer of the population. The same shape a drilldown source's items have. */
export interface PlotItem {
  label: string;
  dies: readonly Die[];
  waferIndex?: number;
  metadata?: WaferMetadata;
  /** This wafer's own pass bins, from its built result: every yield the plot states judges by them. */
  passBins: readonly number[];
  /** This wafer's own ring count, from its built result: a ring or quadrant of its dies is the map's ring. */
  ringCount: number;
  /** Needed for ring and quadrant. */
  wafer?: Wafer;
}

export interface PlotContext {
  /** The population's reconciled test list (`mergeTestDefs`). */
  testDefs?: readonly TestDef[];
  /** The Insights tab's Group by key, which "follow Group by" resolves to. Absent outside the tab. */
  groupBy?: string;
  curation?: Record<string, FacetCuration>;
}

export type FieldKind = 'numeric' | 'categorical';

/** A test's limits: the tester's (`limitLow`/`limitHigh`) and the specification's (`specLow`/`specHigh`). Any may be absent. */
export interface TestLimits { limitLow?: number; limitHigh?: number; specLow?: number; specHigh?: number }

/** The limits a test definition states, or `undefined` when it states none. */
function limitsOf(def: TestDef | undefined): TestLimits | undefined {
  if (!def) return undefined;
  const out: TestLimits = {};
  for (const k of ['limitLow', 'limitHigh', 'specLow', 'specHigh'] as const) if (Number.isFinite(def[k])) out[k] = def[k];
  return Object.keys(out).length ? out : undefined;
}

/** A field resolved over the population, one value per die (`level: 'die'`) or per wafer (`'wafer'`). */
export interface FieldColumn {
  field: PlotField;
  /** The reader's name for it ("Vth", "Split", "Yield"). */
  label: string;
  unit?: string;
  level: 'die' | 'wafer';
  kind: FieldKind;
  /** Numeric values; NaN is missing. Present for a numeric field, and for a metadata field whose every value is a number. */
  num?: Float64Array;
  /** Category text; undefined is missing. Present for a categorical field and for metadata (numbers as text). */
  cat?: (string | undefined)[];
  /** Judged dies behind each value (a wafer's yield), or 1 per judged die (a die's pass), so a yield can be pooled. */
  weights?: Float64Array;
  /** The limits of a measured test, as the population's reconciled test list states them. */
  limits?: TestLimits;
  /** Set on a yield taken per die (100 for a passing die, 0 for a failing one): its mean over any set of dies is their yield. */
  perDie?: true;
  /** Why this field cannot be used on this population. */
  issue?: string;
}

export interface PlotPoint { x: number; y: number; group: number; item: number; die?: Die; /** The colour field's value, when it is continuous. */ value?: number }

/** What one mark stands for: the wafer it is on, and the die when it is one die (not a wafer's aggregate). */
export interface PlotUnit { item: number; die?: Die }

export type PlotMarks =
  | { type: 'scatter'; points: PlotPoint[] }
  /** `units[g][k]` is the unit behind `values[g][k]`, so a bar can say which dies (or wafers) it counts. */
  | { type: 'histogram'; values: number[][]; units: number[][]; unit: (u: number) => PlotUnit }
  | { type: 'box' | 'bar'; categories: string[]; cells: number[][][]; cellUnits: number[][][]; values: number[][]; categoryItems?: number[]; unit: (u: number) => PlotUnit }
  | { type: 'line'; xs: number[]; values: number[][]; counts: number[][]; cellUnits: number[][][]; unit: (u: number) => PlotUnit };

/** `label` is the axis title WITHOUT its unit: the chart appends the unit, scaled to the ticks ("µA" for 0.000861 A). */
export interface ResolvedAxis {
  label: string; unit?: string; scale: 'linear' | 'log'; min?: number; max?: number; reverse?: boolean;
  /** The limits of the test this axis measures, when it measures one: the chart draws them as lines. */
  limits?: TestLimits;
}

export interface ResolvedPlot {
  spec: PlotSpec;
  /** Reasons the plot cannot be drawn on this population. Empty when `marks` is set. */
  issues: string[];
  /** Non-blocking things the reader should be told (a log axis that fell back to linear). */
  notes: string[];
  marks?: PlotMarks;
  level: 'die' | 'wafer';
  /** The title the plot has until the user types one. */
  autoTitle: string;
  x?: ResolvedAxis;
  y?: ResolvedAxis;
  /** Colour groups in legend order; `['']` when there is no colour (or the colour is continuous, see `colorScale`). */
  groups: string[];
  /** Set when a scatter is coloured by a continuous field: the range its colourbar covers. */
  colorScale?: { label: string; unit?: string; lo: number; hi: number };
  colorLabel?: string;
  /** How values were combined, in words ("mean of Vth per wafer"), when they were. */
  aggregation?: string;
  /** The scope: every wafer and die handed in. */
  population: { wafers: number; dies: number };
  /** Marks drawn. */
  plotted: number;
  /** Marks left out because a value was missing, by the field it was missing from. */
  omitted: Array<{ field: string; count: number }>;
}

// ── field resolution ──────────────────────────────────────────────────────────────────────────────────────

interface Rows { dies: Die[]; item: Uint32Array }

function flatten(items: readonly PlotItem[]): Rows {
  let n = 0;
  for (const it of items) n += it.dies.length;
  const dies: Die[] = new Array(n);
  const item = new Uint32Array(n);
  let k = 0;
  items.forEach((it, i) => { for (const d of it.dies) { dies[k] = d; item[k++] = i; } });
  return { dies, item };
}

const BUILTIN_LABEL: Record<PlotBuiltin, string> = {
  wafer: 'Wafer', x: 'Die X', y: 'Die Y', ring: DIE_REGIONS.ring.label, quadrant: DIE_REGIONS.quadrant.label,
  reticleCell: DIE_REGIONS.reticleCell.label, reticleShot: DIE_REGIONS.reticleShot.label, hbin: 'Hard bin', sbin: 'Soft bin',
  site: 'Site', yield: 'Yield', dieCount: 'Dies', waferOrder: 'Wafer order',
};

/** The reader's name for a field, whether or not the population has it. */
export function fieldLabel(field: PlotField, testDefs?: readonly TestDef[]): string {
  if ('test' in field) return testDefs?.find(d => d.testNumber === field.test)?.name || field.name || `Test ${field.test}`;
  if ('builtin' in field) return BUILTIN_LABEL[field.builtin] ?? String(field.builtin);
  return prettyMetaKey(field.meta);
}

function prettyMetaKey(key: string): string {
  const spaced = key.replace(/[_-]+/g, ' ').replace(/([a-z0-9])([A-Z])/g, '$1 $2').trim();
  return spaced ? spaced[0].toUpperCase() + spaced.slice(1) : key;
}


interface Resolver {
  items: readonly PlotItem[];
  rows: Rows;
  ctx: PlotContext;
  present?: Set<number>;
}

/**
 * A number as a person writes one in a lot field: a sign, digits and an optional fraction. Not what `Number()` accepts:
 * `1E3`, `0x10`, `0b11` and `Infinity` are names (a lot ID, a part number), not quantities, and reading them as numbers
 * would turn a category into an axis.
 */
const PLAIN_NUMBER = /^[+-]?(?:\d+\.?\d*|\.\d+)$/;

function resolveField(field: PlotField, r: Resolver): FieldColumn {
  const { items, rows, ctx } = r;
  const label = fieldLabel(field, ctx.testDefs);
  const base = { field, label };
  const nDie = rows.dies.length, nWafer = items.length;

  if ('test' in field) {
    const def = ctx.testDefs?.find(d => d.testNumber === field.test);
    if (def === undefined) {
      r.present ??= new Set(rows.dies.length ? testsPresent(rows.dies, 'values') : []);
      if (!r.present.has(field.test)) {
        const col: FieldColumn = { ...base, level: 'die', kind: 'numeric', issue: `Needs test ${field.test}${field.name ? ` (${field.name})` : ''}, which is not in these dies` };
        return col;
      }
    } else if (field.name && def.name && !sameTestName(field.name, def.name)) {
      return { ...base, level: 'die', kind: 'numeric', unit: def.unit, issue: `Test ${field.test} is "${field.name}" in this plot and "${def.name}" here` };
    }
    const num = new Float64Array(nDie);
    for (let i = 0; i < nDie; i++) num[i] = testValue(rows.dies[i], field.test) ?? NaN;
    return { ...base, level: 'die', kind: 'numeric', unit: def?.unit, num, limits: limitsOf(def) };
  }

  if ('meta' in field) {
    const cat: (string | undefined)[] = items.map(it => facetValueOf(it.metadata, field.meta, ctx.curation));
    if (cat.every(c => c === undefined)) {
      return { ...base, level: 'wafer', kind: 'categorical', cat, issue: `No wafer has a "${prettyMetaKey(field.meta)}" value` };
    }
    const nums = cat.map(c => (c === undefined || !PLAIN_NUMBER.test(c.trim()) ? NaN : Number(c)));
    const numeric = cat.every((c, i) => c === undefined || Number.isFinite(nums[i]));
    return { ...base, level: 'wafer', kind: numeric ? 'numeric' : 'categorical', cat, num: numeric ? Float64Array.from(nums) : undefined };
  }

  switch (field.builtin) {
    case 'wafer':
      return { ...base, level: 'wafer', kind: 'categorical', cat: items.map(it => it.label) };
    case 'waferOrder':
      return { ...base, level: 'wafer', kind: 'numeric', num: Float64Array.from(items, (_, i) => i + 1) };
    case 'dieCount':
      return { ...base, level: 'wafer', kind: 'numeric', num: Float64Array.from(items, it => it.dies.length) };
    case 'yield': {
      const num = new Float64Array(nWafer), weights = new Float64Array(nWafer);
      items.forEach((it, i) => {
        const { pass, total } = yieldCounts(it.dies as Die[], it.passBins);
        num[i] = total > 0 ? (pass / total) * 100 : NaN;
        weights[i] = total;
      });
      return { ...base, level: 'wafer', kind: 'numeric', unit: '%', num, weights };
    }
    case 'x':
    case 'y': {
      const num = new Float64Array(nDie);
      for (let i = 0; i < nDie; i++) { const d = rows.dies[i]; num[i] = hasPosition(d) ? (field.builtin === 'x' ? d.x : d.y) : NaN; }
      return { ...base, level: 'die', kind: 'numeric', num };
    }
    case 'hbin':
    case 'sbin': {
      const cat = rows.dies.map(d => { const b = field.builtin === 'hbin' ? d.hbin : d.sbin; return b === undefined ? undefined : `Bin ${b}`; });
      return { ...base, level: 'die', kind: 'categorical', cat };
    }
    case 'site':
      return { ...base, level: 'die', kind: 'categorical', cat: rows.dies.map(d => (d.siteNum === undefined ? undefined : `Site ${d.siteNum}`)) };
    case 'ring':
    case 'quadrant':
    case 'reticleCell':
    case 'reticleShot': {
      // One definition of every die region (dieRegions.ts): the plot, the Dies table and the rest read the same one.
      const region = DIE_REGIONS[field.builtin];
      const cat = rows.dies.map((d, i) => {
        const it = items[rows.item[i]];
        return region.valueOf(d, { wafer: it.wafer, ringCount: it.ringCount });
      });
      return { ...base, level: 'die', kind: 'categorical', cat };
    }
    default:
      return { ...base, level: 'die', kind: 'categorical', issue: 'Needs a newer version of this tool' };
  }
}

/**
 * The yield as one value per die, in the dies' own order: 100 where the die passes, 0 where it fails, NaN where it is not
 * judged (partial, edge-excluded, no verdict) — the same rule `yieldCounts` applies, so a mean over a set of dies is
 * exactly the wafer-level figure over those dies. Each judged die weighs 1, so a pooled yield sums passes over dies.
 */
function dieYieldColumn(r: Resolver, like: FieldColumn): FieldColumn {
  const n = r.rows.dies.length;
  const num = new Float64Array(n), weights = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const it = r.items[r.rows.item[i]];
    const { pass, total } = yieldCounts([r.rows.dies[i]], it.passBins);
    num[i] = total > 0 ? pass * 100 : NaN;
    weights[i] = total;
  }
  return { ...like, level: 'die', num, weights, perDie: true };
}

// ── combining ─────────────────────────────────────────────────────────────────────────────────────────────

/** One value for a set of numbers. `count` ignores missing values; the rest of an empty set is NaN. */
export function combine(values: readonly number[], how: PlotAggregate): number {
  const v = values.filter(Number.isFinite);
  if (how === 'count') return v.length;
  if (v.length === 0) return NaN;
  switch (how) {
    case 'sum': return v.reduce((a, b) => a + b, 0);
    case 'min': return minOf(v);
    case 'max': return maxOf(v);
    case 'median': {
      const s = [...v].sort((a, b) => a - b);
      const m = s.length >> 1;
      return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
    }
    default: return v.reduce((a, b) => a + b, 0) / v.length;
  }
}

const AGG_WORD: Record<PlotAggregate, string> = { mean: 'Mean', median: 'Median', min: 'Min', max: 'Max', sum: 'Sum', count: 'Count', yield: 'Pooled yield' };

// ── the plot ─────────────────────────────────────────────────────────────────────────────────────────────

function axisFor(role: 'x' | 'y', label: string, unit: string | undefined, spec: PlotSpec, values: Iterable<number>, notes: string[]): ResolvedAxis {
  const a: PlotAxis = spec.axes?.[role] ?? {};
  let scale = a.scale ?? 'linear';
  if (scale === 'log') {
    for (const v of values) if (Number.isFinite(v) && v <= 0) { scale = 'linear'; notes.push(`The ${role.toUpperCase()} axis stays linear: a log axis needs every value above zero`); break; }
  }
  return { label: a.label ?? label, unit, scale, min: a.min, max: a.max, reverse: a.reverse };
}

/**
 * The title a plot has until the reader types one, from its field names alone: a plot that cannot be drawn still
 * needs a name in its heading, or the card reads as an empty box with nothing to say what it was for.
 */
function titleFromSpec(spec: PlotSpec, ctx: PlotContext): string {
  const { chart: mark } = spec;
  const enc = spec.fields ?? {};
  const x = enc.x ? fieldLabel(enc.x, ctx.testDefs) : (mark === 'box' || mark === 'bar') ? 'Wafer' : undefined;
  const y = enc.y ? fieldLabel(enc.y, ctx.testDefs) : undefined;
  switch (mark) {
    case 'scatter': return x && y ? `${y} vs ${x}` : 'Scatter';
    case 'histogram': { const v = y ?? (enc.x ? fieldLabel(enc.x, ctx.testDefs) : undefined); return v ?? 'Histogram'; }
    case 'line': return x && y ? `${y} over ${x}` : 'Line';
    case 'box': return y && x ? `${y} by ${x}` : 'Box';
    case 'bar': return x ? (y ? `${y} by ${x}` : `Dies by ${x}`) : 'Bar';
    default: return '';
  }
}

function emptyResult(spec: PlotSpec, items: readonly PlotItem[], issues: string[], ctx: PlotContext = {}): ResolvedPlot {
  return {
    spec, issues, notes: [], level: 'die', autoTitle: titleFromSpec(spec, ctx), groups: [''],
    population: { wafers: items.length, dies: items.reduce((n, it) => n + it.dies.length, 0) },
    plotted: 0, omitted: [],
  };
}

/** What the cross-field rules need to know of a field: its level, whether it is a number, and whether it is a yield. */
export interface FieldFacts { label: string; level: 'die' | 'wafer'; kind: FieldKind; yield: boolean }

/**
 * Whether the chosen fields can be drawn together, as the reason in two lengths: `long` for the chart card, `short` for the
 * editor's field list, where a choice that would break the plot is greyed with it. ONE function, so the list and the chart
 * can never disagree about what is allowed. Only rules that name two fields are here; a missing field is never a conflict.
 *
 * A yield is passing dies over judged dies, so it can be taken over any set of dies, but it is held per wafer: splitting it
 * by a die-level field (ring, quadrant, bin, die position) needs the verdict per die, which a bar of pooled yield and a line
 * have. Every other chart of it would be one wafer figure pretending to be per die.
 */
export function combinationIssue(
  mark: PlotSpec['chart'],
  f: { x?: FieldFacts; y?: FieldFacts; color?: FieldFacts },
  o: { aggregate?: PlotAggregate; level?: 'die' | 'wafer'; continuousColor?: boolean } = {},
): { long: string; short: string } | undefined {
  const dieOnly = [f.x, o.continuousColor ? undefined : f.color].filter((c): c is FieldFacts => !!c && c.level === 'die');
  const yieldY = !!f.y && f.y.yield && f.y.level === 'wafer';
  const yieldSplits = (mark === 'bar' || mark === 'line') && (o.aggregate === undefined || o.aggregate === 'yield' || o.aggregate === 'mean');
  if (yieldY && dieOnly.length && !yieldSplits) {
    return {
      long: `${f.y!.label} is one figure per wafer, and ${dieOnly[0].label} belongs to dies, so a ${mark} of it cannot be split by ${dieOnly[0].label}. `
        + `A bar chart of yield can (pooled yield per ${dieOnly[0].label.toLowerCase()}), or plot a measured value instead`,
      short: `${f.y!.label} is per wafer: use a bar or line chart`,
    };
  }
  const used = [f.x, f.y].filter((c): c is FieldFacts => !!c);
  let level: 'die' | 'wafer' = o.level ?? (used.some(c => c.level === 'die') ? 'die' : 'wafer');
  if (mark === 'bar' && !f.y && dieOnly.length) level = 'die';   // counting dies per wafer and ring is a count of dies
  if (f.color?.level === 'die' && level === 'wafer' && !o.continuousColor && !(yieldY && (mark === 'bar' || mark === 'line'))) {
    return {
      long: `${f.color.label} is per die, so it cannot colour a plot with one mark per wafer. `
        + `Plot a measured value (one mark per die), or make a bar chart of yield, which can be split by ${f.color.label.toLowerCase()}`,
      short: `${f.color.label} is per die: this plot has one mark per wafer`,
    };
  }
  return undefined;
}

/** Resolves `spec` over `items`. Never throws for a plot that cannot be drawn: it returns the reasons. */
export function resolvePlot(spec: PlotSpec, items: readonly PlotItem[], ctx: PlotContext = {}): ResolvedPlot {
  const versionIssue = plotIssue(spec);
  if (versionIssue) return emptyResult(spec, items, [versionIssue], ctx);
  const fail = (...issues: string[]) => emptyResult(spec, items, issues, ctx);
  // A sweep reads runs of tests, not fields: the sweep panel draws it, and the callers branch on the mark first.
  if (spec.chart === 'sweep') return fail('A sweep is drawn by the sweep panel');
  const rows = flatten(items);
  const r: Resolver = { items, rows, ctx };

  const mark = spec.chart;
  const enc = spec.fields ?? {};
  const xField: PlotField | undefined = enc.x ?? ((mark === 'box' || mark === 'bar') ? { builtin: 'wafer' } : undefined);
  const yField: PlotField | undefined = enc.y;
  const valueField = mark === 'histogram' ? (yField ?? xField) : yField;

  // Required roles.
  if (mark === 'scatter' || mark === 'line') {
    if (!xField) return fail('Choose a field for X');
    if (!yField) return fail('Choose a field for Y');
  }
  if (mark === 'box' && !yField) return fail('Choose a field for Y');
  if (mark === 'histogram' && !valueField) return fail('Choose a field to count');

  const xCol = mark === 'histogram' ? undefined : (xField ? resolveField(xField, r) : undefined);
  let yCol = valueField ? resolveField(valueField, r) : undefined;

  // A role that needs a number cannot take a category: say so, and where the category does belong.
  const needsNumber: Array<[string, FieldColumn | undefined]> = mark === 'scatter' || mark === 'line' ? [['X', xCol], ['Y', yCol]]
    : mark === 'histogram' ? [['to count', yCol]] : mark === 'box' || mark === 'bar' ? [['Y', yCol]] : [];
  for (const [role, col] of needsNumber) {
    if (col && !col.issue && col.kind === 'categorical' && !col.num) {
      return fail(`${col.label} is a category, not a number, so it cannot be ${role === 'to count' ? 'the field a histogram counts' : `the ${role} of a ${mark}`}. `
        + `Use it as the X of a bar or box chart (one bar per ${col.label.toLowerCase()}), or as the colour`);
    }
  }

  // Colour.
  const colorSpec = enc.color;
  let colorCol: FieldColumn | undefined;
  let followWafer = false;
  let followMeta: string | undefined;
  if (colorSpec === undefined || ('follow' in colorSpec)) {
    if (ctx.groupBy) followMeta = ctx.groupBy;
    else if (items.length > 1) followWafer = true;
  } else if (!('none' in colorSpec)) {
    colorCol = resolveField(colorSpec, r);
  }
  if (followMeta) colorCol = resolveField({ meta: followMeta }, r);
  if (followWafer) colorCol = resolveField({ builtin: 'wafer' }, r);
  // A colour that follows the tab is quietly absent where nothing has that field.
  if (colorCol?.issue && (colorSpec === undefined || 'follow' in colorSpec)) colorCol = undefined;

  const issues = [xCol?.issue, yCol?.issue, colorCol?.issue].filter((s): s is string => !!s);
  // A measured value or a wafer figure colours a scatter on a gradient; a lot field with numbers in it (temperature,
  // slot) is a handful of values and colours as a category. Everywhere else a colour is a category.
  const continuous = !!colorCol && colorCol.kind === 'numeric' && !('meta' in colorCol.field);
  if (continuous && mark !== 'scatter') {
    issues.push(`${colorCol!.label} is continuous, so it can colour a scatter but not a ${mark}: colour by a category such as wafer, split or bin`);
  }
  if (issues.length) return fail(...issues);

  // Level.
  const used = [xCol, yCol].filter((c): c is FieldColumn => !!c);
  let level: 'die' | 'wafer' = spec.level ?? (used.some(c => c.level === 'die') ? 'die' : 'wafer');
  const dieOnly = [xCol, continuous ? undefined : colorCol].filter((c): c is FieldColumn => !!c && c.level === 'die');
  const facts = (c: FieldColumn | undefined): FieldFacts | undefined => c && { label: c.label, level: c.level, kind: c.kind, yield: !!c.weights };
  const conflict = combinationIssue(mark, { x: facts(xCol), y: facts(yCol), color: facts(colorCol) }, { aggregate: spec.aggregate, level: spec.level, continuousColor: continuous });
  if (conflict) return fail(conflict.long);
  // Counting dies per wafer and ring is a count of dies, not of wafers.
  if (mark === 'bar' && !yCol && dieOnly.length) level = 'die';
  if (yCol && yCol.level === 'wafer' && yCol.weights && dieOnly.length) {
    // The verdict per die, so the yield can be pooled over any set of dies.
    yCol = dieYieldColumn(r, yCol);
    level = 'die';
  }
  if (level === 'die' && yCol?.weights && !yCol.perDie && !dieOnly.length) level = 'wafer';

  const nUnits = level === 'die' ? rows.dies.length : items.length;
  const itemOf = (u: number) => (level === 'die' ? rows.item[u] : u);
  const unitInfo = (u: number): PlotUnit => ({ item: itemOf(u), die: level === 'die' ? rows.dies[u] : undefined });

  // A column as one value per unit. A die-level numeric column at wafer level is aggregated per wafer.
  const aggHow: PlotAggregate = spec.aggregate && spec.aggregate !== 'yield' ? spec.aggregate : 'mean';
  const numAt = (c: FieldColumn): Float64Array => {
    if (!c.num) throw new Error('numeric field expected');
    if (c.level === level) return c.num;
    if (c.level === 'wafer') { const out = new Float64Array(nUnits); for (let u = 0; u < nUnits; u++) out[u] = c.num[itemOf(u)]; return out; }
    const per: number[][] = items.map(() => []);
    for (let i = 0; i < c.num.length; i++) per[rows.item[i]].push(c.num[i]);
    return Float64Array.from(per, v => combine(v, aggHow));
  };
  const catAt = (c: FieldColumn): (string | undefined)[] => {
    if (!c.cat) throw new Error('category field expected');
    if (c.level === level) return c.cat;
    if (c.level === 'wafer') return Array.from({ length: nUnits }, (_, u) => c.cat![itemOf(u)]);
    throw new Error('a per-die category cannot be used at wafer level');
  };
  const weightAt = (c: FieldColumn): Float64Array | undefined => (c.weights && c.level === level ? c.weights : undefined);

  // Colour groups.
  let groups = [''];
  let groupOf = new Int32Array(nUnits);
  let colorLabel: string | undefined;
  let colorValues: Float64Array | undefined;
  if (colorCol && continuous) {
    colorLabel = colorCol.label;
    colorValues = numAt(colorCol);
  } else if (colorCol) {
    colorLabel = colorCol.label;
    const cc = catAt(colorCol);
    const labels = new Map<string, number>();
    const seen: string[] = [];
    for (let u = 0; u < nUnits; u++) {
      const t = cc[u] ?? FACET_NONE_VALUE;
      if (!labels.has(t)) { labels.set(t, 0); seen.push(t); }
    }
    const isWafer = 'builtin' in colorCol.field && colorCol.field.builtin === 'wafer';
    const ordered = isWafer ? seen
      : colorCol.num && 'meta' in colorCol.field ? [...seen].sort((a, b) => (Number(a) || 0) - (Number(b) || 0))
      : [...seen].sort(compareNatural);
    ordered.forEach((t, i) => labels.set(t, i));
    groups = ordered;
    for (let u = 0; u < nUnits; u++) groupOf[u] = labels.get(cc[u] ?? FACET_NONE_VALUE)!;
  }

  const omittedBy = new Map<string, number>();
  const omit = (label: string) => omittedBy.set(label, (omittedBy.get(label) ?? 0) + 1);
  const notes: string[] = [];
  const unitNoun = level === 'die' ? 'dies' : 'wafers';

  let marks: PlotMarks;
  let xAxis: ResolvedAxis | undefined, yAxis: ResolvedAxis | undefined;
  let aggregation: string | undefined;
  let colorScale: ResolvedPlot['colorScale'];
  let plotted = 0;
  const groupCount = groups.length;

  const perWaferNote = (c: FieldColumn) => (c.level === 'die' && level === 'wafer' ? `${AGG_WORD[aggHow].toLowerCase()} of ${c.label} per wafer` : undefined);

  if (mark === 'scatter') {
    const xs = numAt(xCol!), ys = numAt(yCol!);
    const points: PlotPoint[] = [];
    for (let u = 0; u < nUnits; u++) {
      if (!Number.isFinite(xs[u])) { omit(xCol!.label); continue; }
      if (!Number.isFinite(ys[u])) { omit(yCol!.label); continue; }
      if (colorValues && !Number.isFinite(colorValues[u])) { omit(colorCol!.label); continue; }
      points.push({ x: xs[u], y: ys[u], group: groupOf[u], item: itemOf(u), die: level === 'die' ? rows.dies[u] : undefined, ...(colorValues ? { value: colorValues[u] } : {}) });
    }
    plotted = points.length;
    if (colorValues && points.length) {
      const vs = points.map(p => p.value!);
      colorScale = { label: colorCol!.label, unit: colorCol!.unit, lo: minOf(vs), hi: maxOf(vs) };
    }
    marks = { type: 'scatter', points };
    xAxis = axisFor('x', xCol!.label, xCol!.unit, spec, points.map(p => p.x), notes);
    yAxis = axisFor('y', yCol!.label, yCol!.unit, spec, points.map(p => p.y), notes);
    aggregation = [perWaferNote(xCol!), perWaferNote(yCol!)].filter(Boolean).join('; ') || undefined;
  } else if (mark === 'histogram') {
    const vs = numAt(yCol!);
    const values: number[][] = Array.from({ length: groupCount }, () => []);
    const units: number[][] = Array.from({ length: groupCount }, () => []);
    for (let u = 0; u < nUnits; u++) {
      if (!Number.isFinite(vs[u])) { omit(yCol!.label); continue; }
      values[groupOf[u]].push(vs[u]); units[groupOf[u]].push(u); plotted++;
    }
    marks = { type: 'histogram', values, units, unit: unitInfo };
    xAxis = axisFor('x', yCol!.label, yCol!.unit, spec, values.flat(), notes);
    yAxis = { label: 'Count', scale: 'linear', ...(spec.axes?.y?.label ? { label: spec.axes.y.label } : {}) };
    aggregation = perWaferNote(yCol!);
  } else if (mark === 'line') {
    const xs = numAt(xCol!), ys = numAt(yCol!);
    const xsSeen = new Set<number>();
    const cells = new Map<string, number[]>();
    const cellUnitsMap = new Map<string, number[]>();
    for (let u = 0; u < nUnits; u++) {
      if (!Number.isFinite(xs[u])) { omit(xCol!.label); continue; }
      if (!Number.isFinite(ys[u])) { omit(yCol!.label); continue; }
      xsSeen.add(xs[u]);
      const k = `${groupOf[u]}|${xs[u]}`;
      (cells.get(k) ?? cells.set(k, []).get(k)!).push(ys[u]); plotted++;
      (cellUnitsMap.get(k) ?? cellUnitsMap.set(k, []).get(k)!).push(u);
    }
    const xsSorted = [...xsSeen].sort((a, b) => a - b);
    const how = spec.aggregate ?? 'mean';
    const values = Array.from({ length: groupCount }, (_, g) => xsSorted.map(x => {
      const cell = cells.get(`${g}|${x}`);
      return cell ? combine(cell, how === 'yield' ? 'mean' : how) : NaN;
    }));
    const counts = Array.from({ length: groupCount }, (_, g) => xsSorted.map(x => cells.get(`${g}|${x}`)?.length ?? 0));
    const lineUnits = Array.from({ length: groupCount }, (_, g) => xsSorted.map(x => cellUnitsMap.get(`${g}|${x}`) ?? []));
    marks = { type: 'line', xs: xsSorted, values, counts, cellUnits: lineUnits, unit: unitInfo };
    xAxis = axisFor('x', xCol!.label, xCol!.unit, spec, xsSorted, notes);
    const yAgg = how === 'yield' ? 'mean' : how;
    yAxis = axisFor('y', yCol!.perDie ? yCol!.label : `${AGG_WORD[yAgg]} ${yCol!.label}`, yCol!.unit, spec, values.flat(), notes);
    aggregation = yCol!.perDie ? `passing dies over judged dies, per ${xCol!.label.toLowerCase()}` : `${AGG_WORD[yAgg].toLowerCase()} of ${yCol!.label} per ${xCol!.label}`;
  } else {
    // box and bar: one category per value of X.
    const xc = xCol!;
    const isCoordinate = 'builtin' in xc.field && (xc.field.builtin === 'x' || xc.field.builtin === 'y');
    if (xc.kind === 'numeric' && xc.level === 'die' && !isCoordinate) return fail(`${xc.label} is continuous, so a ${mark} cannot have one ${mark === 'bar' ? 'bar' : 'box'} per value; use a scatter or line, or choose a categorical X such as wafer, ring or bin`);
    const labelsOf: (string | undefined)[] = xc.cat
      ? catAt(xc)
      : Array.from(numAt(xc), v => (Number.isFinite(v) ? String(v) : undefined));
    const catSeen = new Map<string, number>();
    const order: string[] = [];
    for (let u = 0; u < nUnits; u++) { const t = labelsOf[u]; if (t !== undefined && !catSeen.has(t)) { catSeen.set(t, 0); order.push(t); } }
    const isWafer = 'builtin' in xc.field && xc.field.builtin === 'wafer';
    const categories = isWafer ? order
      : xc.kind === 'numeric' ? [...order].sort((a, b) => Number(a) - Number(b))
      : [...order].sort(compareNatural);
    categories.forEach((t, i) => catSeen.set(t, i));

    const wantsCount = mark === 'bar' && !yCol;
    const how: PlotAggregate = spec.aggregate ?? (wantsCount ? 'count' : yCol?.weights ? 'yield' : 'mean');
    if (how === 'yield' && !yCol?.weights) return fail('Pooled yield needs Yield as the Y field');
    if (mark === 'box' && how === 'count') return fail('A box plot needs a measured field for Y');

    const ys = yCol ? numAt(yCol) : undefined;
    const ws = yCol ? weightAt(yCol) : undefined;
    const cells: number[][][] = Array.from({ length: groupCount }, () => categories.map(() => []));
    const cellUnits: number[][][] = Array.from({ length: groupCount }, () => categories.map(() => []));
    const weights: number[][][] = Array.from({ length: groupCount }, () => categories.map(() => []));
    for (let u = 0; u < nUnits; u++) {
      const ci = labelsOf[u] === undefined ? undefined : catSeen.get(labelsOf[u]!);
      if (ci === undefined) { omit(xc.label); continue; }
      if (ys && !Number.isFinite(ys[u]) ) { omit(yCol!.label); continue; }
      cells[groupOf[u]][ci].push(ys ? ys[u] : 1);
      cellUnits[groupOf[u]][ci].push(u);
      if (ws) weights[groupOf[u]][ci].push(ws[u]);
      plotted++;
    }
    const values = cells.map((row, g) => row.map((cell, c) => {
      if (cell.length === 0) return NaN;
      if (how === 'yield') {
        const w = weights[g][c];
        const total = w.reduce((a, b) => a + b, 0);
        return total > 0 ? cell.reduce((a, v, i) => a + v * w[i], 0) / total : NaN;
      }
      return combine(cell, how);
    }));
    // A wafer is its own category, so a click on it can open that wafer: the item behind each label.
    const categoryItems = isWafer ? categories.map(c => labelsOf.findIndex((t, u) => t === c && u >= 0)) : undefined;
    marks = { type: mark === 'box' ? 'box' : 'bar', categories, cells, cellUnits, unit: unitInfo, values, categoryItems: categoryItems?.map(u => (level === 'die' ? rows.item[u] : u)) };
    xAxis = { label: spec.axes?.x?.label ?? xc.label, scale: 'linear' };
    if (mark === 'bar') {
      const word = how === 'count' ? 'Count' : AGG_WORD[how];
      const ylabel = wantsCount ? `Count of ${unitNoun}` : how === 'yield' ? 'Pooled yield' : `${word} ${yCol!.label}`;
      yAxis = axisFor('y', ylabel, how === 'yield' ? '%' : (how === 'count' ? undefined : yCol?.unit), spec, values.flat(), notes);
      aggregation = wantsCount ? undefined
        : how === 'yield' ? `passing dies over judged dies, pooled per ${xc.label.toLowerCase()}`
        : `${word.toLowerCase()} of ${yCol!.label}${yCol!.level === 'die' && level === 'wafer' ? ' per wafer' : ''} per ${xc.label.toLowerCase()}`;
    } else {
      yAxis = axisFor('y', yCol!.label, yCol!.unit, spec, cells.flat(2), notes);
      aggregation = perWaferNote(yCol!);
    }
  }

  // The limits of a measured test, on the axis that measures it. A value combined by sum or count, a yield or a
  // wafer figure has no limits to compare with, so nothing is drawn against it.
  const measuresTest = (c: FieldColumn | undefined, how?: PlotAggregate): TestLimits | undefined =>
    c && !c.perDie && (how === undefined || how === 'mean' || how === 'median' || how === 'min' || how === 'max') ? c.limits : undefined;
  const aggUsed = spec.aggregate ?? 'mean';
  if (xAxis && (mark === 'scatter' || mark === 'line')) xAxis.limits = measuresTest(xCol);
  if (yAxis && mark !== 'histogram') yAxis.limits = measuresTest(yCol, mark === 'scatter' || mark === 'box' ? undefined : aggUsed);
  if (mark === 'histogram' && xAxis) xAxis.limits = measuresTest(yCol);

  const title = (): string => {
    const x = xCol?.label, y = yCol?.label;
    const core = mark === 'scatter' ? `${y} vs ${x}`
      : mark === 'histogram' ? `${y}`
      : mark === 'line' ? `${y} over ${x}`
      : mark === 'box' ? `${y} by ${x}`
      : y ? `${y} by ${x}` : `Dies by ${x}`;
    return colorLabel && colorCol && !sameField(colorCol.field, xField) ? `${core} · by ${colorLabel}` : core;
  };

  return {
    spec, issues: [], notes, marks, level,
    autoTitle: title(), x: xAxis, y: yAxis, groups, colorScale, colorLabel, aggregation,
    population: { wafers: items.length, dies: rows.dies.length },
    plotted,
    omitted: [...omittedBy].map(([field, count]) => ({ field, count })),
  };
}

/** The plot's title: the one the user typed, else the automatic one. */
export function plotTitle(resolved: ResolvedPlot): string {
  return resolved.spec.title?.trim() ? resolved.spec.title : resolved.autoTitle;
}

/** The statement every plot carries about what it shows ("6 wafers · 3,966 dies · 12 dies without Ioff not plotted"). */
export function plotFootnote(resolved: ResolvedPlot): string {
  const { wafers, dies } = resolved.population;
  const parts = [`${wafers.toLocaleString('en-GB')} wafer${wafers === 1 ? '' : 's'} · ${dies.toLocaleString('en-GB')} dies`];
  if (resolved.aggregation) parts.push(resolved.aggregation);
  for (const o of resolved.omitted) parts.push(`${o.count.toLocaleString('en-GB')} ${resolved.level === 'die' ? 'dies' : 'wafers'} without ${o.field} not plotted`);
  return parts.join(' · ');
}


// ── what can be chosen ────────────────────────────────────────────────────────────────────────────────────

export type FieldGroup = 'Tests' | 'Die' | 'Wafer';

/** One entry of the editor's field list. */
export interface FieldOption {
  field: PlotField;
  /** The list text: the name, plus the test number so a filter box finds either. */
  label: string;
  /** The name alone ("Vth"), as a title would write it. */
  name: string;
  /** For a lot field: how many different values the wafers in view carry. */
  distinct?: number;
  group: FieldGroup;
  kind: FieldKind;
  level: 'die' | 'wafer';
  /** Can divide the data into series or categories (a colour, a bar's X). */
  categorical: boolean;
}

/** A stable string for a field, for list values and comparisons. */
export function fieldKey(f: PlotField): string {
  return 'test' in f ? `test:${f.test}` : 'builtin' in f ? `builtin:${f.builtin}` : `meta:${f.meta}`;
}

/**
 * Everything a plot could put on an axis or a colour over this population: its parametric tests, the die fields it
 * has data for, and the wafer and lot fields. Offered only when the population has something to show for it (no
 * soft-bin entry for a lot with no soft bins), so the list is the lot's, not the library's.
 */
export function fieldCatalogue(items: readonly PlotItem[], ctx: PlotContext = {}): FieldOption[] {
  const out: FieldOption[] = [];
  const dies = items.flatMap(it => it.dies);
  const present = new Set(dies.length ? testsPresent(dies, 'values') : []);
  const defs = ctx.testDefs ?? [];
  const tests = new Map<number, string | undefined>();
  for (const d of defs) {
    if (d.testType === 'F') continue;
    if (present.has(d.testNumber) || !dies.length) tests.set(d.testNumber, d.name);
  }
  for (const n of present) if (!tests.has(n) && !defs.some(d => d.testNumber === n && d.testType === 'F')) tests.set(n, undefined);
  for (const [n, name] of [...tests].sort((a, b) => a[0] - b[0])) {
    out.push({
      field: { test: n, ...(name ? { name } : {}) },
      label: name ? `${name} · ${n}` : `Test ${n}`, name: name || `Test ${n}`,
      group: 'Tests', kind: 'numeric', level: 'die', categorical: false,
    });
  }
  const has = (f: (d: Die) => boolean) => dies.some(f);
  const die = (builtin: PlotBuiltin, kind: FieldKind, categorical: boolean) =>
    out.push({ field: { builtin }, label: BUILTIN_LABEL[builtin], name: BUILTIN_LABEL[builtin], group: 'Die', kind, level: 'die', categorical });
  if (has(d => hasPosition(d))) { die('x', 'numeric', false); die('y', 'numeric', false); }
  // Die regions: each is offered only when this population can place a die in it (reticle ones need a stepper field).
  const placed = has(d => hasPosition(d));
  for (const key of DIE_REGION_KEYS) {
    if (items.some(it => DIE_REGIONS[key].available({ wafer: it.wafer, ringCount: it.ringCount }, placed))) die(key, 'categorical', true);
  }
  if (has(d => d.hbin !== undefined)) die('hbin', 'categorical', true);
  if (has(d => d.sbin !== undefined)) die('sbin', 'categorical', true);
  if (has(d => d.siteNum !== undefined)) die('site', 'categorical', true);

  const wafer = (builtin: PlotBuiltin, kind: FieldKind, categorical: boolean) =>
    out.push({ field: { builtin }, label: BUILTIN_LABEL[builtin], name: BUILTIN_LABEL[builtin], group: 'Wafer', kind, level: 'wafer', categorical });
  wafer('wafer', 'categorical', true);
  if (items.length > 1) wafer('waferOrder', 'numeric', false);
  wafer('yield', 'numeric', false);
  wafer('dieCount', 'numeric', false);
  const r: Resolver = { items, rows: { dies: [], item: new Uint32Array(0) }, ctx };
  for (const f of buildFacetTable(items.map(it => ({ metadata: it.metadata, dieCount: it.dies.length })), { facetableOnly: false, curation: ctx.curation })) {
    if (f.values.length === 0) continue;
    const col = resolveField({ meta: f.key }, r);
    out.push({
      field: { meta: f.key }, label: f.label || prettyMetaKey(f.key), name: f.label || prettyMetaKey(f.key), group: 'Wafer',
      kind: col.kind, level: 'wafer', categorical: true, distinct: f.values.length,
    });
  }
  return out;
}

export type PlotRole = 'x' | 'y' | 'color';

/**
 * The fields that make sense for a role of a mark, so the editor never offers a choice that can only fail:
 * values must be numeric; a bar or box groups by a category (or a lot field with a handful of values); a colour is
 * always a category, since a continuous colour is not drawn yet.
 */
export function fieldsForRole(catalogue: readonly FieldOption[], mark: PlotSpec['chart'], role: PlotRole): FieldOption[] {
  const valueRole = role === 'y' || (role === 'x' && (mark === 'scatter' || mark === 'line' || mark === 'histogram'));
  // A scatter can also be coloured on a gradient by a measured value or a wafer figure.
  if (role === 'color') return catalogue.filter(f => f.categorical || (mark === 'scatter' && f.kind === 'numeric'));
  if (valueRole) return catalogue.filter(f => f.kind === 'numeric');
  // A bar or box X: categories, or a numeric lot field, each value its own category.
  return catalogue.filter(f => f.categorical);
}

/**
 * A first plot for this population: the scatter of the first two tests, a histogram when there is one, a bar of
 * yield by wafer when there are none. Never an empty editor.
 */
export function defaultPlot(catalogue: readonly FieldOption[], id: string): PlotSpec {
  const tests = catalogue.filter(f => f.group === 'Tests');
  if (tests.length >= 2) return { id, chart: 'scatter', fields: { x: tests[0].field, y: tests[1].field } };
  if (tests.length === 1) return { id, chart: 'histogram', fields: { y: tests[0].field } };
  return { id, chart: 'scatter', fields: { x: { builtin: 'waferOrder' }, y: { builtin: 'yield' } } };
}


// ── titles that no longer match their plot ─────────────────────────────────────────────────────────────────

/** Words a title uses of everything, not of a field: naming one of these says nothing about what is plotted. */
const GENERIC_NAMES = new Set(['wafer', 'dies', 'die x', 'die y', 'wafer order']);

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const mentions = (title: string, name: string) =>
  name.length >= 3 && new RegExp(`(^|[^A-Za-z0-9_])${escapeRe(name)}($|[^A-Za-z0-9_])`, 'i').test(title);

export interface TitleDrift {
  /** Fields the title names that the plot does not use: the title is describing something else. */
  names: string[];
  /** Fields the plot plots that the title leaves out, when the title does describe its fields. */
  omits: string[];
}

/**
 * Whether a title the reader TYPED still describes its plot. A title written for one pair of tests goes on naming them
 * after the fields change, and nothing else would tell the reader the chart is no longer what it says. Two checks:
 *
 * - the title names a test (or another measured field) the plot does not use;
 * - the title names one of the plot's X or Y fields but not the other, so it is half a description.
 *
 * A title that names none of the plot's fields is free text ("Process check") and is left alone. Lot fields are not
 * checked for the first, since their names are everyday words and a followed colour changes with Group by. An
 * automatic title is always accurate and is never checked.
 */
export function titleDrift(spec: PlotSpec, catalogue: readonly FieldOption[]): TitleDrift {
  const title = spec.title?.trim();
  const none: TitleDrift = { names: [], omits: [] };
  if (!title) return none;
  const colour = spec.fields?.color;
  const used = [spec.fields?.x, spec.fields?.y, colour].filter((f): f is PlotField => isField(f));
  const isUsed = (f: PlotField) => used.some(u => sameField(u, f));
  const names = catalogue
    .filter(o => !GENERIC_NAMES.has(o.name.toLowerCase()) && !('meta' in o.field) && !isUsed(o.field) && mentions(title, o.name))
    .map(o => o.name);
  const roles = [spec.fields?.x, spec.fields?.y].filter((f): f is PlotField => isField(f));
  const nameOf = (f: PlotField) => catalogue.find(o => sameField(o.field, f))?.name ?? fieldLabel(f);
  const named = roles.filter(f => !GENERIC_NAMES.has(nameOf(f).toLowerCase()) && mentions(title, nameOf(f)));
  const missing = roles.filter(f => !GENERIC_NAMES.has(nameOf(f).toLowerCase()) && !mentions(title, nameOf(f)));
  const omits = named.length > 0 || names.length > 0 ? missing.map(nameOf) : [];
  return { names, omits };
}

const list = (a: readonly string[]) => (a.length < 2 ? a.join('') : `${a.slice(0, -1).join(', ')} and ${a[a.length - 1]}`);

/** `titleDrift` in a sentence for the reader, or null when the title is fine. */
export function describeTitleDrift(d: TitleDrift): string | null {
  const parts: string[] = [];
  if (d.names.length) parts.push(`The title names ${list(d.names)}, which this plot does not show.`);
  if (d.omits.length) parts.push(`It does not name ${list(d.omits)}, which this plot shows.`);
  return parts.length ? parts.join(' ') : null;
}

// ── example plots ──────────────────────────────────────────────────────────────────────────────────────────

/**
 * One example of each chart type that this population can show, so a reader who has not built a plot before has
 * something to start from: a scatter of the first two tests, a histogram of the first, a box of the first by wafer, a
 * bar of yield by the first lot field that divides the wafers (by wafer when none does), and the first test over wafer
 * order as a line, and a sweep of the first few tests in test order. A type is left out when the population cannot
 * support it (a line needs two wafers, a sweep two tests). Untitled, so each one is named by what it plots; the sweep,
 * which has no fields to name it by, is titled "Example sweep".
 */
export function examplePlots(catalogue: readonly FieldOption[], waferCount: number, newId: () => string): PlotSpec[] {
  const tests = catalogue.filter(f => f.group === 'Tests').map(f => f.field);
  const out: PlotSpec[] = [];
  const manyWafers = waferCount > 1;
  if (tests.length >= 2) out.push({ id: newId(), chart: 'scatter', fields: { x: tests[0], y: tests[1] } });
  if (tests.length >= 1) out.push({ id: newId(), chart: 'histogram', fields: { y: tests[0], color: { none: true } } });
  if (tests.length >= 1 && manyWafers) out.push({ id: newId(), chart: 'box', fields: { x: { builtin: 'wafer' }, y: tests[0], color: { none: true } } });
  if (manyWafers) {
    const dividing = catalogue.find(f => 'meta' in f.field && f.distinct !== undefined && f.distinct >= 2 && f.distinct <= Math.max(2, Math.floor(waferCount / 2)));
    out.push({ id: newId(), chart: 'bar', fields: { x: dividing ? dividing.field : { builtin: 'wafer' }, y: { builtin: 'yield' }, color: { none: true } } });
  }
  if (tests.length >= 1 && manyWafers) out.push({ id: newId(), chart: 'line', fields: { x: { builtin: 'waferOrder' }, y: tests[0], color: { none: true } }, aggregate: 'mean' });
  if (tests.length >= 2) out.push({ ...startingSweep(tests.flatMap(f => ('test' in f ? [f] : [])), newId()), title: 'Example sweep' });
  return out;
}


/**
 * The test a click on this plot should open a wafer on: the plot's own measurement, so the map shows the values the
 * plot is about rather than the bins. A scatter takes its X (as the Insights scatter does), then its Y, then its
 * colour; every other chart type its values. `undefined` when the plot has no test in it (yield against wafer order),
 * where the wafer's own default map is the right one.
 */
export function plotTestNumber(spec: PlotSpec): number | undefined {
  const { x, y, color } = spec.fields ?? {};
  const order = spec.chart === 'scatter' ? [x, y, color] : spec.chart === 'histogram' ? [y, x] : [y];
  for (const f of order) if (isField(f) && 'test' in f) return f.test;
  return undefined;
}

/**
 * A new sweep to start from: one series of the lot's first few parametric tests, in test order, on the ordinal axis
 * (no X scale is claimed). Never an empty editor; the reader edits the tests and adds the series they meant.
 */
export function defaultSweep(testDefs: readonly TestDef[], id: string): PlotSpec {
  return startingSweep(testDefs.filter(isParametricTest).map(t => ({ test: t.testNumber, name: t.name })), id);
}

/** One series of the first five of `tests`, in test order, with the names they have now (the check against another program's numbers). */
function startingSweep(tests: readonly { test: number; name?: string }[], id: string): PlotSpec {
  const run = [...tests].sort((a, b) => a.test - b.test).slice(0, 5);
  const names = Object.fromEntries(run.flatMap(t => (t.name ? [[String(t.test), t.name]] : [])));
  return { id, chart: 'sweep', sweep: { series: [{ label: 'Series 1', tests: run.map(t => t.test), ...(Object.keys(names).length ? { testNames: names } : {}) }] } };
}
