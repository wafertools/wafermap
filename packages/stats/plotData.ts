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
import type { Wafer } from '../core/wafer.js';
import type { WaferMetadata } from '../core/metadata.js';
import { classifyDie } from '../core/classify.js';
import { testValue, testsPresent } from '../core/dieTable.js';
import { compareNatural, minOf, maxOf } from '../core/utils.js';
import type { TestDef } from '../renderer/buildWaferMap.js';
import { facetValueOf, FACET_NONE_VALUE } from './facets.js';
import type { FacetCuration } from './facets.js';
import { yieldCounts } from './yield.js';
import { sameField, plotIssue } from './plotSpec.js';
import type { PlotSpec, PlotField, PlotAxis, PlotAggregate, PlotBuiltin } from './plotSpec.js';

/** One wafer of the population. The same shape a drilldown source's items have. */
export interface PlotItem {
  label: string;
  dies: readonly Die[];
  waferIndex?: number;
  metadata?: WaferMetadata;
  /** This wafer's own pass bins; wins over the context's. */
  passBins?: readonly number[];
  /** Needed for ring and quadrant. */
  wafer?: Wafer;
}

export interface PlotContext {
  /** The population's reconciled test list (`mergeTestDefs`). */
  testDefs?: readonly TestDef[];
  passBins?: readonly number[];
  /** The Insights tab's Group by key, which "follow Group by" resolves to. Absent outside the tab. */
  groupBy?: string;
  ringCount?: number;
  curation?: Record<string, FacetCuration>;
}

export type FieldKind = 'numeric' | 'categorical';

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
  /** Wafer-level only: judged dies behind each value, so a yield can be pooled. */
  weights?: Float64Array;
  /** Why this field cannot be used on this population. */
  issue?: string;
}

export interface PlotPoint { x: number; y: number; group: number; item: number; die?: Die }

export type PlotMarks =
  | { type: 'scatter'; points: PlotPoint[] }
  | { type: 'histogram'; values: number[][] }
  | { type: 'box' | 'bar'; categories: string[]; cells: number[][][]; values: number[][] }
  | { type: 'line'; xs: number[]; values: number[][] };

export interface ResolvedAxis { label: string; unit?: string; scale: 'linear' | 'log'; min?: number; max?: number; reverse?: boolean }

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
  /** Colour groups in legend order; `['']` when there is no colour. */
  groups: string[];
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
  wafer: 'Wafer', x: 'Die X', y: 'Die Y', ring: 'Ring', quadrant: 'Quadrant', hbin: 'Hard bin', sbin: 'Soft bin',
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

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

interface Resolver {
  items: readonly PlotItem[];
  rows: Rows;
  ctx: PlotContext;
  present?: Set<number>;
}

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
    } else if (field.name && def.name && !sameName(field.name, def.name)) {
      return { ...base, level: 'die', kind: 'numeric', unit: def.unit, issue: `Test ${field.test} is "${field.name}" in this plot and "${def.name}" here` };
    }
    const num = new Float64Array(nDie);
    for (let i = 0; i < nDie; i++) num[i] = testValue(rows.dies[i], field.test) ?? NaN;
    return { ...base, level: 'die', kind: 'numeric', unit: def?.unit, num };
  }

  if ('meta' in field) {
    const cat: (string | undefined)[] = items.map(it => facetValueOf(it.metadata, field.meta, ctx.curation));
    if (cat.every(c => c === undefined)) {
      return { ...base, level: 'wafer', kind: 'categorical', cat, issue: `No wafer has a "${prettyMetaKey(field.meta)}" value` };
    }
    const nums = cat.map(c => (c === undefined || c.trim() === '' ? NaN : Number(c)));
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
        const { pass, total } = yieldCounts(it.dies as Die[], it.passBins ?? ctx.passBins ?? [1]);
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
    case 'quadrant': {
      const ringCount = ctx.ringCount ?? 4;
      const cat = rows.dies.map((d, i) => {
        const w = items[rows.item[i]].wafer;
        if (!w || !hasPosition(d) || d.physX === undefined || d.physY === undefined) return undefined;
        const c = classifyDie(d as Parameters<typeof classifyDie>[0], w, { ringCount });
        return field.builtin === 'ring' ? `Ring ${c.ring}` : c.quadrant;
      });
      return { ...base, level: 'die', kind: 'categorical', cat };
    }
    default:
      return { ...base, level: 'die', kind: 'categorical', issue: 'Needs a newer version of this tool' };
  }
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

const unitSuffix = (unit?: string) => (unit ? ` (${unit})` : '');

function axisFor(role: 'x' | 'y', label: string, unit: string | undefined, spec: PlotSpec, values: Iterable<number>, notes: string[]): ResolvedAxis {
  const a: PlotAxis = spec.axes?.[role] ?? {};
  let scale = a.scale ?? 'linear';
  if (scale === 'log') {
    for (const v of values) if (Number.isFinite(v) && v <= 0) { scale = 'linear'; notes.push(`The ${role.toUpperCase()} axis stays linear: a log axis needs every value above zero`); break; }
  }
  return { label: a.label ?? label, unit, scale, min: a.min, max: a.max, reverse: a.reverse };
}

function emptyResult(spec: PlotSpec, items: readonly PlotItem[], issues: string[]): ResolvedPlot {
  return {
    spec, issues, notes: [], level: 'die', autoTitle: spec.title ?? '', groups: [''],
    population: { wafers: items.length, dies: items.reduce((n, it) => n + it.dies.length, 0) },
    plotted: 0, omitted: [],
  };
}

/** Resolves `spec` over `items`. Never throws for a plot that cannot be drawn: it returns the reasons. */
export function resolvePlot(spec: PlotSpec, items: readonly PlotItem[], ctx: PlotContext = {}): ResolvedPlot {
  const versionIssue = plotIssue(spec);
  if (versionIssue) return emptyResult(spec, items, [versionIssue]);
  const rows = flatten(items);
  const r: Resolver = { items, rows, ctx };
  const fail = (...issues: string[]) => ({ ...emptyResult(spec, items, issues), autoTitle: spec.title ?? '' });

  const mark = spec.mark;
  const enc = spec.encoding;
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
  const yCol = valueField ? resolveField(valueField, r) : undefined;

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
  if (colorCol && colorCol.kind === 'numeric' && !('meta' in colorCol.field)) {
    issues.push(`${colorCol.label} cannot be a colour yet: colour by a category such as wafer, split or bin`);
  }
  if (issues.length) return fail(...issues);

  // Level.
  const used = [xCol, yCol].filter((c): c is FieldColumn => !!c);
  let level: 'die' | 'wafer' = spec.level ?? (used.some(c => c.level === 'die') ? 'die' : 'wafer');
  if (colorCol?.level === 'die' && level === 'wafer') {
    return fail(`${colorCol.label} is per die, so it cannot colour a plot of one mark per wafer`);
  }
  const dieOnly = [xCol, colorCol].filter((c): c is FieldColumn => !!c && c.level === 'die');
  if (yCol && yCol.level === 'wafer' && yCol.weights && dieOnly.length) {
    return fail(`${yCol.label} is per wafer, so it cannot be split by ${dieOnly[0].label}, which is per die`);
  }
  if (level === 'die' && yCol?.weights && !dieOnly.length) level = 'wafer';

  const nUnits = level === 'die' ? rows.dies.length : items.length;
  const itemOf = (u: number) => (level === 'die' ? rows.item[u] : u);

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
  const weightAt = (c: FieldColumn): Float64Array | undefined => (c.weights && c.level === 'wafer' && level === 'wafer' ? c.weights : undefined);

  // Colour groups.
  let groups = [''];
  let groupOf = new Int32Array(nUnits);
  let colorLabel: string | undefined;
  if (colorCol) {
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
  let plotted = 0;
  const groupCount = groups.length;

  const perWaferNote = (c: FieldColumn) => (c.level === 'die' && level === 'wafer' ? `${AGG_WORD[aggHow].toLowerCase()} of ${c.label} per wafer` : undefined);

  if (mark === 'scatter') {
    const xs = numAt(xCol!), ys = numAt(yCol!);
    const points: PlotPoint[] = [];
    for (let u = 0; u < nUnits; u++) {
      if (!Number.isFinite(xs[u])) { omit(xCol!.label); continue; }
      if (!Number.isFinite(ys[u])) { omit(yCol!.label); continue; }
      points.push({ x: xs[u], y: ys[u], group: groupOf[u], item: itemOf(u), die: level === 'die' ? rows.dies[u] : undefined });
    }
    plotted = points.length;
    marks = { type: 'scatter', points };
    xAxis = axisFor('x', xCol!.label + unitSuffix(xCol!.unit), xCol!.unit, spec, points.map(p => p.x), notes);
    yAxis = axisFor('y', yCol!.label + unitSuffix(yCol!.unit), yCol!.unit, spec, points.map(p => p.y), notes);
    aggregation = [perWaferNote(xCol!), perWaferNote(yCol!)].filter(Boolean).join('; ') || undefined;
  } else if (mark === 'histogram') {
    const vs = numAt(yCol!);
    const values: number[][] = Array.from({ length: groupCount }, () => []);
    for (let u = 0; u < nUnits; u++) {
      if (!Number.isFinite(vs[u])) { omit(yCol!.label); continue; }
      values[groupOf[u]].push(vs[u]); plotted++;
    }
    marks = { type: 'histogram', values };
    xAxis = axisFor('x', yCol!.label + unitSuffix(yCol!.unit), yCol!.unit, spec, values.flat(), notes);
    yAxis = { label: 'Count', scale: 'linear', ...(spec.axes?.y?.label ? { label: spec.axes.y.label } : {}) };
    aggregation = perWaferNote(yCol!);
  } else if (mark === 'line') {
    const xs = numAt(xCol!), ys = numAt(yCol!);
    const xsSeen = new Set<number>();
    const cells = new Map<string, number[]>();
    for (let u = 0; u < nUnits; u++) {
      if (!Number.isFinite(xs[u])) { omit(xCol!.label); continue; }
      if (!Number.isFinite(ys[u])) { omit(yCol!.label); continue; }
      xsSeen.add(xs[u]);
      const k = `${groupOf[u]}|${xs[u]}`;
      (cells.get(k) ?? cells.set(k, []).get(k)!).push(ys[u]); plotted++;
    }
    const xsSorted = [...xsSeen].sort((a, b) => a - b);
    const how = spec.aggregate ?? 'mean';
    const values = Array.from({ length: groupCount }, (_, g) => xsSorted.map(x => {
      const cell = cells.get(`${g}|${x}`);
      return cell ? combine(cell, how === 'yield' ? 'mean' : how) : NaN;
    }));
    marks = { type: 'line', xs: xsSorted, values };
    xAxis = axisFor('x', xCol!.label + unitSuffix(xCol!.unit), xCol!.unit, spec, xsSorted, notes);
    const yAgg = how === 'yield' ? 'mean' : how;
    yAxis = axisFor('y', `${AGG_WORD[yAgg]} ${yCol!.label}${unitSuffix(yCol!.unit)}`, yCol!.unit, spec, values.flat(), notes);
    aggregation = `${AGG_WORD[yAgg].toLowerCase()} of ${yCol!.label} per ${xCol!.label}`;
  } else {
    // box and bar: one category per value of X.
    const xc = xCol!;
    if (xc.kind === 'numeric' && xc.level === 'die') return fail(`${xc.label} is continuous; use a scatter or line, or choose a categorical X`);
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
    const weights: number[][][] = Array.from({ length: groupCount }, () => categories.map(() => []));
    for (let u = 0; u < nUnits; u++) {
      const ci = labelsOf[u] === undefined ? undefined : catSeen.get(labelsOf[u]!);
      if (ci === undefined) { omit(xc.label); continue; }
      if (ys && !Number.isFinite(ys[u]) ) { omit(yCol!.label); continue; }
      cells[groupOf[u]][ci].push(ys ? ys[u] : 1);
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
    marks = { type: mark === 'box' ? 'box' : 'bar', categories, cells, values };
    xAxis = { label: spec.axes?.x?.label ?? xc.label, scale: 'linear' };
    if (mark === 'bar') {
      const word = how === 'count' ? 'Count' : AGG_WORD[how];
      const ylabel = wantsCount ? `Count of ${unitNoun}` : how === 'yield' ? 'Pooled yield (%)' : `${word} ${yCol!.label}${unitSuffix(yCol!.unit)}`;
      yAxis = axisFor('y', ylabel, yCol?.unit, spec, values.flat(), notes);
      aggregation = wantsCount ? undefined
        : how === 'yield' ? `passing dies over judged dies, pooled per ${xc.label.toLowerCase()}`
        : `${word.toLowerCase()} of ${yCol!.label}${yCol!.level === 'die' && level === 'wafer' ? ' per wafer' : ''} per ${xc.label.toLowerCase()}`;
    } else {
      yAxis = axisFor('y', yCol!.label + unitSuffix(yCol!.unit), yCol!.unit, spec, cells.flat(2), notes);
      aggregation = perWaferNote(yCol!);
    }
  }

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
    autoTitle: title(), x: xAxis, y: yAxis, groups, colorLabel, aggregation,
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

