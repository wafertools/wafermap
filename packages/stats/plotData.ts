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
import { DIE_REGIONS, DIE_REGION_KEYS, dieRadialPosition } from './dieRegions.js';
import type { Wafer } from '../core/wafer.js';
import type { WaferMetadata } from '../core/metadata.js';
import { excludedBy, excludedValue, testValue, testsPresent } from '../core/dieTable.js';
import { limitSetName } from '../renderer/valueFilter.js';
import { compareNatural, minOf, maxOf } from '../core/utils.js';
import { isParametricTest, getTestPassStatus, type TestDef } from '../renderer/buildWaferMap.js';
import { facetValueOf, buildFacetTable, FACET_NONE_VALUE } from './facets.js';
import type { FacetCuration } from './facets.js';
import { yieldCounts } from './yield.js';
import { sameTestName } from './sweep.js';
import { sameField, plotIssue, isField, isTestSet, xFieldsOf, PLOT_X_LEVELS, PLOT_FACET_LIMIT } from './plotSpec.js';
import type { PlotSpec, PlotField, PlotAxis, PlotAggregate, PlotBuiltin, PlotTestSet, PlotNormalize, PlotColor } from './plotSpec.js';
import { fmtExact } from '../renderer/fmt.js';
import { parseTestReference } from '../renderer/derivedTests/parser.js';
import { capabilityLimits } from './capability.js';
import { mean as meanOf, median as medianOf } from '../core/utils.js';
import { sampleVariance } from './math.js';
import { compareGroups, formatP, type GroupComparison } from './groupCompare.js';
import { patTests, waferPatLimits, waferPatVerdicts, PAT_VERDICT_LABEL, PAT_VERDICT_ORDER, PAT_K } from './pat.js';

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
  /** @internal The wafer's whole die list when `dies` is part of it (a panel's ring): PAT limits are the wafer's. */
  allDies?: readonly Die[];
}

export interface PlotContext {
  /** The population's reconciled test list (`mergeTestDefs`). */
  testDefs?: readonly TestDef[];
  /** The Insights tab's Group by key, which "follow Group by" resolves to. Absent outside the tab. */
  groupBy?: string;
  curation?: Record<string, FacetCuration>;
  /** @internal The dies a rescaling is measured over: a panel's values are scaled as the whole plot's are. */
  scaleDies?: readonly Die[];
  /** @internal The panels divide a set of tests by test, so neither X nor the colour has to. */
  facetByTest?: boolean;
  /** @internal Resolving one panel (or the whole) of a faceted plot: its facet is already applied. */
  inFacet?: boolean;
  /** @internal The wafers of the whole plot, when this is a panel of it: a followed colour is per wafer when the whole
   *  has several, though a panel may hold one. */
  wholeWafers?: number;
}

export type FieldKind = 'numeric' | 'categorical';

/**
 * A test's limits: the tester's (`limitLow`/`limitHigh`), the specification's (`specLow`/`specHigh`) and, on a plot of
 * one wafer, that wafer's PAT limits (`patLow`/`patHigh`). Any may be absent.
 */
export interface TestLimits { limitLow?: number; limitHigh?: number; specLow?: number; specHigh?: number; patLow?: number; patHigh?: number }

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
  /** For a set of tests: the test each row's value belongs to, by name, so a missing value is reported against its test. */
  labelOf?: (row: number) => string;
}

export interface PlotPoint { x: number; y: number; group: number; item: number; die?: Die; /** The colour field's value, when it is continuous. */ value?: number }

/** What one mark stands for: the wafer it is on, and the die when it is one die (not a wafer's aggregate). */
export interface PlotUnit { item: number; die?: Die }

export type PlotMarks =
  | { type: 'scatter'; points: PlotPoint[] }
  /** `units[g][k]` is the unit behind `values[g][k]`, so a bar can say which dies (or wafers) it counts. */
  | { type: 'histogram'; values: number[][]; units: number[][]; unit: (u: number) => PlotUnit }
  /** Each group's values ascending, `units[g][k]` the unit behind `values[g][k]`; the k-th of n sits at `probabilityPosition(k, n)`. */
  | { type: 'probability'; values: number[][]; units: number[][]; unit: (u: number) => PlotUnit }
  /** `nest`, set when X has several levels: each category's value at each level, outer first, with the levels' names. */
  /**
   * `stack`: a bar's colours drawn one on another (`values` then the colours' counts or sums, or their shares in percent);
   * `cumulative`: each category's running share of the whole, in percent, for a pareto line.
   */
  | { type: 'box' | 'bar'; categories: string[]; cells: number[][][]; cellUnits: number[][][]; values: number[][]; categoryItems?: number[]; nest?: { levels: string[]; parts: string[][] }; stack?: 'stack' | 'percent'; cumulative?: number[]; unit: (u: number) => PlotUnit }
  | { type: 'line'; xs: number[]; values: number[][]; counts: number[][]; cellUnits: number[][][]; unit: (u: number) => PlotUnit };

/** `label` is the axis title WITHOUT its unit: the chart appends the unit, scaled to the ticks ("µA" for 0.000861 A). */
export interface ResolvedAxis {
  label: string; unit?: string; scale: 'linear' | 'log'; min?: number; max?: number; reverse?: boolean;
  /** The limits of the test this axis measures, when it measures one: the chart draws them as lines. */
  limits?: TestLimits;
  /** A panel of a faceted plot: the data range of every panel, so each panel's axis spans the same range. */
  extent?: [number, number];
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
  /** How the values were rescaled, in words, when they were (`PlotSpec.normalize`). */
  normalization?: string;
  /**
   * For a box or bar of one measured test divided by a wafer field (split, lot): the groups compared with each wafer
   * as one value (the mean of its dies), so n is wafers. `by` names the field.
   */
  comparison?: { by: string; result: GroupComparison };
  /**
   * A faceted plot: one plot per value of the facet field, in order, each on the whole plot's colours (`groups`) and
   * axis ranges, with its units naming wafers of the population handed in. The fields above describe the whole.
   */
  facets?: Array<{ label: string; plot: ResolvedPlot }>;
  /** The facet field's name, when there are panels. */
  facetLabel?: string;
  /** The plot shows PAT verdicts or PAT limits: its statement says how they are set. */
  usesPat?: true;
  /** @internal The tests a set resolved to, and their labels, in order. */
  setTests?: { tests: number[]; labels: string[] };
  /** The scope: every wafer and die handed in. */
  population: { wafers: number; dies: number };
  /** Marks drawn. */
  plotted: number;
  /** Marks left out because a value was missing, by the field it was missing from. */
  omitted: Array<{ field: string; count: number }>;
  /**
   * Values the value filter took out of the tests this plot reads: the limit set they were outside of, and how many
   * dies lost a value per test. Absent when none did. These dies are in `omitted` too (they have no value).
   */
  excluded?: { limitSet: string; fields: Array<{ field: string; count: number }> };
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
  site: 'Site', yield: 'Yield', dieCount: 'Dies', waferOrder: 'Wafer order', test: 'Test', pat: 'PAT', radius: 'Radial position',
};

/** The reader's name for a field, whether or not the population has it. */
export function fieldLabel(field: PlotField, testDefs?: readonly TestDef[]): string {
  if (isTestSet(field)) return testSetLabel(field, testDefs);
  if ('test' in field) {
    const def = testDefs?.find(d => d.testNumber === field.test);
    const name = def?.name || field.name || `Test ${field.test}`;
    // A functional test has no value to plot, only an outcome: the field is its verdict, and says so.
    return def !== undefined && !isParametricTest(def) ? `${name} (pass/fail)` : name;
  }
  if ('builtin' in field) return BUILTIN_LABEL[field.builtin] ?? String(field.builtin);
  return prettyMetaKey(field.meta);
}

/**
 * The order a category field's values are listed in, wherever they are listed (colours, categories, panels): a wafer
 * keeps the population's order and a test the set's, PAT verdicts go from within to outside, numbers sort as numbers,
 * and anything else sorts naturally. One rule, so a field's values never come in two orders on one screen.
 */
function categoryOrder(field: PlotField, seen: readonly string[], numeric: boolean): string[] {
  if ('builtin' in field && (field.builtin === 'wafer' || field.builtin === 'test')) return [...seen];
  if ('builtin' in field && field.builtin === 'pat') return PAT_VERDICT_ORDER.filter(v => seen.includes(v));
  if (numeric) return [...seen].sort((a, b) => (Number(a) || 0) - (Number(b) || 0));
  return [...seen].sort(compareNatural);
}

/** Whether a category column's values are numbers (a lot field of numbers, a die coordinate): they sort as numbers. */
const numericCategories = (c: FieldColumn): boolean => !!c.num && (c.kind === 'numeric' || 'meta' in c.field);

/** "a", "a and b", "a, b and c". */
const list = (a: readonly string[]) => (a.length < 2 ? a.join('') : `${a.slice(0, -1).join(', ')} and ${a[a.length - 1]}`);

/** The `pat` builtin: each die's PAT verdict. */
const isPatBuiltin = (f: PlotField | PlotColor | undefined): boolean => !!f && 'builtin' in f && f.builtin === 'pat';

/** The `test` builtin: the field that divides a set of tests into its tests. */
const isTestBuiltin = (f: PlotField | PlotColor | undefined): boolean => !!f && 'builtin' in f && f.builtin === 'test';

/** A set of tests by its members' names: up to three, then a count ("Vth, Idsat and Ioff", "12 tests"). */
function testSetLabel(set: PlotTestSet, testDefs?: readonly TestDef[]): string {
  const { tests } = expandTestSet(set, testDefs ?? []);
  const nameOf = (tn: number) => testDefs?.find(d => d.testNumber === tn)?.name || set.names?.[String(tn)] || `Test ${tn}`;
  if (tests.length === 0) return set.tests.length === 1 ? `Tests ${set.tests[0]}` : `${set.tests.length} test entries`;
  return tests.length > 3 ? `${tests.length} tests` : list(tests.map(nameOf));
}

/**
 * The test numbers a set names, in the order written, ranges expanded to the declared tests inside them by the parser a
 * sweep and a derived test use, so the same text names the same tests everywhere. A test named twice is kept once.
 */
export function expandTestSet(set: PlotTestSet, testDefs: readonly TestDef[]): { tests: number[]; problems: string[] } {
  const defs = new Map(testDefs.map(d => [d.testNumber, d]));
  const out: number[] = [];
  const problems: string[] = [];
  for (const entry of set.tests) {
    if (typeof entry === 'number') { if (!out.includes(entry)) out.push(entry); continue; }
    const ref = parseTestReference(String(entry), defs);
    if (!ref.ok) { problems.push(`"${entry}": ${ref.message}`); continue; }
    for (const tn of ref.tests) if (!out.includes(tn)) out.push(tn);
  }
  return { tests: out, problems };
}

/**
 * `set` with `names` holding the name each of its tests has in `testDefs`, for the check that the plot is read against
 * the same tests in another lot. A test the definitions do not hold is left out of `names`.
 */
export function withTestSetNames(set: PlotTestSet, testDefs: readonly TestDef[]): PlotTestSet {
  const names: Record<string, string> = {};
  for (const tn of expandTestSet(set, testDefs).tests) {
    const name = testDefs.find(d => d.testNumber === tn)?.name;
    if (name) names[String(tn)] = name;
  }
  const { names: _old, ...rest } = set;
  return Object.keys(names).length ? { ...rest, names } : rest;
}

/**
 * The most values a set of tests reads at once (dies × tests). Every value is held by the box or bar that draws it, so a
 * set over a large lot is refused with the numbers rather than stalling the tab.
 */
export const TEST_SET_VALUE_LIMIT = 4_000_000;

function prettyMetaKey(key: string): string {
  const spaced = key.replace(/[_-]+/g, ' ').replace(/([a-z0-9])([A-Z])/g, '$1 $2').trim();
  return spaced ? spaced[0].toUpperCase() + spaced.slice(1) : key;
}


interface Resolver {
  items: readonly PlotItem[];
  rows: Rows;
  ctx: PlotContext;
  present?: Set<number>;
  /**
   * Set when Y is a set of tests. The population is then read once per test: `items` holds each wafer once for every
   * test, test by test, and these say which wafer and which test each entry is, so a wafer field is still the wafer's
   * and the `test` field can name each value's test.
   */
  melt?: { realOf: Int32Array; testOf: Int32Array; tests: number[]; labels: string[] };
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

  if (isTestSet(field)) {
    const m = r.melt;
    if (!m) return { ...base, level: 'die', kind: 'numeric', issue: 'A set of tests can only be the values of a box, bar, line or histogram' };
    const num = new Float64Array(nDie);
    for (let i = 0; i < nDie; i++) num[i] = testValue(rows.dies[i], m.tests[m.testOf[rows.item[i]]]) ?? NaN;
    const units = new Set(m.tests.map(tn => ctx.testDefs?.find(d => d.testNumber === tn)?.unit).filter((u): u is string => !!u));
    return { ...base, level: 'die', kind: 'numeric', unit: units.size === 1 ? [...units][0] : undefined, num, labelOf: item => m.labels[m.testOf[item]] };
  }

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
    if (def !== undefined && !isParametricTest(def)) {
      // A functional (or derived pass/fail) test: the die's recorded verdict, as a category to colour, compare or split yield by.
      const cat = rows.dies.map(d => { const v = getTestPassStatus(d, field.test, def); return v === undefined ? undefined : v ? 'Pass' : 'Fail'; });
      return { ...base, level: 'die', kind: 'categorical', cat };
    }
    const num = new Float64Array(nDie);
    for (let i = 0; i < nDie; i++) num[i] = testValue(rows.dies[i], field.test) ?? NaN;
    // A plot of one wafer also has that wafer's PAT limits for the test, set from all its dies.
    let limits = limitsOf(def);
    if (items.length === 1 && !r.melt && def) {
      const it = items[0];
      const pat = waferPatLimits(it.allDies ?? it.dies, ctx.testDefs ?? [], it.passBins).limits.get(field.test);
      if (pat) limits = { ...limits, patLow: pat.lo, patHigh: pat.hi };
    }
    return { ...base, level: 'die', kind: 'numeric', unit: def?.unit, num, limits };
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
      return { ...base, level: 'wafer', kind: 'numeric', num: Float64Array.from(items, (_, i) => (r.melt ? r.melt.realOf[i] : i) + 1) };
    case 'test':
      if (!r.melt) return { ...base, level: 'wafer', kind: 'categorical', issue: 'Test divides a set of tests: choose several tests as the values' };
      return { ...base, level: 'wafer', kind: 'categorical', cat: items.map((_, i) => r.melt!.labels[r.melt!.testOf[i]]) };
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
    case 'radius': {
      // Distance from the centre as a percentage of the radius, the measure the rings are bands of.
      const num = new Float64Array(nDie);
      for (let i = 0; i < nDie; i++) { const p = dieRadialPosition(rows.dies[i], { wafer: items[rows.item[i]].wafer }); num[i] = p === undefined ? NaN : p * 100; }
      return { ...base, level: 'die', kind: 'numeric', unit: '%', num };
    }
    case 'pat': {
      // Each die's verdict on its own wafer, the limits set from the whole wafer even when the plot holds part of it.
      const defs = ctx.testDefs ?? [];
      if (patTests(defs).length === 0) return { ...base, level: 'die', kind: 'categorical', issue: 'PAT needs tests with both a low and a high limit' };
      const verdictsOf = new Map<PlotItem, Map<Die, string | undefined>>();
      const cat = rows.dies.map((d, i) => {
        const it = items[rows.item[i]];
        let m = verdictsOf.get(it);
        if (!m) {
          const all = it.allDies ?? it.dies;
          const vs = waferPatVerdicts(all, defs, it.passBins);
          m = new Map(all.map((x, k) => [x, vs[k].verdict ? PAT_VERDICT_LABEL[vs[k].verdict!] : undefined]));
          verdictsOf.set(it, m);
        }
        return m.get(d);
      });
      return { ...base, level: 'die', kind: 'categorical', cat };
    }
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

/**
 * The cumulative share a probability plot puts the k-th smallest of n values at (k from 0): (k + ½) / n, Hazen's
 * plotting position. It never reaches 0 or 1, so the smallest and largest values have a place on a normal-probability
 * axis, and it puts the median of an odd count at exactly 50%.
 */
export const probabilityPosition = (k: number, n: number): number => (k + 0.5) / n;

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
  const levels = xFieldsOf(enc.x);
  // A set of tests along X is named by its tests alone, as the drawn plot is: the Test level names nothing more.
  const named = levels.filter(f => !isTestBuiltin(f));
  const x = levels.length ? (named.length ? list(named.map(f => fieldLabel(f, ctx.testDefs))) : undefined) : (mark === 'box' || mark === 'bar') && !isTestSet(enc.y) ? 'Wafer' : undefined;
  const y = enc.y ? fieldLabel(enc.y, ctx.testDefs) : undefined;
  if ((mark === 'box' || mark === 'bar') && y && !x) return y;
  switch (mark) {
    case 'scatter': return x && y ? `${y} vs ${x}` : 'Scatter';
    case 'histogram': { const v = y ?? (levels[0] ? fieldLabel(levels[0], ctx.testDefs) : undefined); return v ?? 'Histogram'; }
    case 'probability': return y ? `${y}, cumulative` : 'Probability plot';
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

// ── rescaling a test ──────────────────────────────────────────────────────────────────────────────────────

/** `(v − offset) / scale` takes a test's value to the rescaled one. */
interface TestScale { offset: number; scale: number }

const NORMALIZE_WORD: Record<PlotNormalize, string> = { limits: 'position in limits', zscore: 'z-score', robust: 'robust z-score' };

/** What a rescaling means, in the words a footnote uses. */
function normalizeNote(how: PlotNormalize, bases: ReadonlySet<'spec' | 'test'>): string {
  if (how === 'limits') {
    const which = bases.size === 1 ? (bases.has('spec') ? 'spec limits' : 'test limits') : 'spec limits, or test limits where a test has no spec';
    return `rescaled to ${which}: 0 is the low limit, 1 the high`;
  }
  return how === 'zscore'
    ? 'rescaled per test: standard deviations from the mean of the values in view'
    : 'rescaled per test: robust standard deviations (1.4826 × median absolute deviation) from the median of the values in view';
}

/**
 * The rescaling of each of `tests` over `dies`, or the reason a test cannot be rescaled (no limits to place it by, no
 * spread to measure in). Read from the population in view, every die of it, before any value is combined.
 */
function testScales(tests: readonly number[], dies: readonly Die[], defs: readonly TestDef[], how: PlotNormalize, nameOf: (tn: number) => string):
  { scales: Map<number, TestScale>; dropped: string[]; bases: Set<'spec' | 'test'> } {
  const scales = new Map<number, TestScale>();
  const dropped: string[] = [];
  const bases = new Set<'spec' | 'test'>();
  for (const tn of tests) {
    if (how === 'limits') {
      const def = defs.find(d => d.testNumber === tn);
      const lim = def && capabilityLimits(def);
      if (!lim) { dropped.push(`${nameOf(tn)} has no low and high limit to place it by`); continue; }
      bases.add(lim.basis);
      scales.set(tn, { offset: lim.lsl, scale: lim.usl - lim.lsl });
      continue;
    }
    const vs: number[] = [];
    for (const d of dies) { const v = testValue(d, tn); if (v !== undefined && Number.isFinite(v)) vs.push(v); }
    if (vs.length < 2) { dropped.push(`${nameOf(tn)} has fewer than two values to measure a spread in`); continue; }
    let offset: number, scale: number;
    if (how === 'zscore') {
      offset = meanOf(vs);
      scale = Math.sqrt(sampleVariance(vs, offset));
    } else {
      offset = medianOf(vs);
      scale = 1.4826 * medianOf(vs.map(v => Math.abs(v - offset)));
    }
    if (!(scale > 0) || !Number.isFinite(scale)) { dropped.push(`${nameOf(tn)} has no spread: its values ${how === 'robust' ? 'are mostly' : 'are all'} the same`); continue; }
    scales.set(tn, { offset, scale });
  }
  return { scales, dropped, bases };
}

/**
 * A test's limits after rescaling, kept only where every test of the set lands the same limit at the same place: rescaled
 * to limits, the low limit of every test is 0, so one line serves them all; a z-score puts each test's limits somewhere
 * different, and a line for one would misstate the others.
 */
function scaledLimits(tests: readonly number[], limitsOfTest: (tn: number) => TestLimits | undefined, scales: ReadonlyMap<number, TestScale>): TestLimits | undefined {
  const out: TestLimits = {};
  for (const k of ['limitLow', 'limitHigh', 'specLow', 'specHigh', 'patLow', 'patHigh'] as const) {
    let at: number | undefined;
    let shared = true;
    for (const tn of tests) {
      const raw = limitsOfTest(tn)?.[k];
      const sc = scales.get(tn);
      if (raw === undefined || !Number.isFinite(raw) || !sc) { shared = false; break; }
      const v = (raw - sc.offset) / sc.scale;
      if (at === undefined) at = v;
      else if (Math.abs(v - at) > 1e-9 * Math.max(1, Math.abs(at))) { shared = false; break; }
    }
    if (shared && at !== undefined) out[k] = at;
  }
  return Object.keys(out).length ? out : undefined;
}

// ── panels ────────────────────────────────────────────────────────────────────────────────────────────────

/** The finite range of the values a mark draws on one axis, or undefined when it has none. */
function markExtent(m: PlotMarks, role: 'x' | 'y'): [number, number] | undefined {
  let vs: number[];
  switch (m.type) {
    case 'scatter': vs = m.points.map(p => (role === 'x' ? p.x : p.y)); break;
    case 'histogram': case 'probability': vs = role === 'x' ? m.values.flat() : []; break;
    case 'box': vs = role === 'y' ? m.cells.flat(2) : []; break;
    case 'bar': vs = role === 'y' ? m.values.flat() : []; break;
    case 'line': vs = role === 'x' ? m.xs : m.values.flat(); break;
  }
  const finite = vs.filter(Number.isFinite);
  return finite.length ? [minOf(finite), maxOf(finite)] : undefined;
}

/**
 * A panel's plot set on the whole plot's colours and axes, and on the population's wafer indices: `items[k]` of the
 * panel is wafer `index[k]` of the population. Group arrays are widened to every colour of the whole, empty where the
 * panel has none of it, so colour g is the same group in every panel.
 */
function alignPanel(r: ResolvedPlot, index: readonly number[], whole: ResolvedPlot): ResolvedPlot {
  if (r.issues.length || !r.marks) return r;
  const G = whole.groups.length;
  const gmap = r.groups.map(label => whole.groups.indexOf(label));
  if (gmap.some(g => g < 0)) return r;
  const widen = <T>(arr: readonly T[], empty: () => T): T[] => { const out = Array.from({ length: G }, empty); arr.forEach((v, l) => { out[gmap[l]] = v; }); return out; };
  const item = (k: number) => index[k];
  const unitOf = (unit: (u: number) => PlotUnit) => (u: number): PlotUnit => { const x = unit(u); return { ...x, item: item(x.item) }; };
  const m = r.marks;
  let marks: PlotMarks;
  switch (m.type) {
    case 'scatter': marks = { type: 'scatter', points: m.points.map(p => ({ ...p, item: item(p.item), group: gmap[p.group] })) }; break;
    case 'histogram': marks = { type: 'histogram', values: widen(m.values, () => []), units: widen(m.units, () => []), unit: unitOf(m.unit) }; break;
    case 'probability': marks = { type: 'probability', values: widen(m.values, () => []), units: widen(m.units, () => []), unit: unitOf(m.unit) }; break;
    case 'box': case 'bar': marks = {
      ...m, cells: widen(m.cells, () => m.categories.map(() => [])), cellUnits: widen(m.cellUnits, () => m.categories.map(() => [])),
      values: widen(m.values, () => m.categories.map(() => NaN)), categoryItems: m.categoryItems?.map(k => (k >= 0 ? item(k) : k)), unit: unitOf(m.unit),
    }; break;
    case 'line': marks = {
      ...m, values: widen(m.values, () => m.xs.map(() => NaN)), counts: widen(m.counts, () => m.xs.map(() => 0)),
      cellUnits: widen(m.cellUnits, () => m.xs.map(() => [])), unit: unitOf(m.unit),
    }; break;
  }
  const wx = whole.marks && markExtent(whole.marks, 'x'), wy = whole.marks && markExtent(whole.marks, 'y');
  return {
    ...r, marks, groups: whole.groups, colorScale: whole.colorScale ?? r.colorScale,
    x: r.x && wx ? { ...r.x, extent: wx } : r.x,
    y: r.y && wy ? { ...r.y, extent: wy } : r.y,
  };
}

/**
 * A plot with `fields.facet`: the whole plot resolved once over the population, which fixes the colours, the axis ranges
 * and what the footnote states, then one plot per value of the facet field over that part of the population. A wafer
 * field takes whole wafers, a die field each wafer's dies with that value, Test one test of the set. Values are in the
 * order a colour would list them; a unit with no value is left out of every panel and counted.
 */
function resolveFacets(spec: PlotSpec, items: readonly PlotItem[], ctx: PlotContext): ResolvedPlot {
  const facetField = spec.fields!.facet!;
  const { facet: _facet, ...rest } = spec.fields!;
  const base: PlotSpec = { ...spec, fields: rest };
  const fail = (...issues: string[]) => emptyResult(spec, items, issues, ctx);
  const label = fieldLabel(facetField, ctx.testDefs);
  const allDies = items.flatMap(it => it.dies);
  const inner: PlotContext = { ...ctx, inFacet: true, scaleDies: ctx.scaleDies ?? allDies, wholeWafers: ctx.wholeWafers ?? items.length };
  const byTest = isTestBuiltin(facetField);
  if (byTest && !isTestSet(spec.fields?.y)) return fail('Test panels need several tests as the values');
  if (byTest && (xFieldsOf(spec.fields?.x).some(isTestBuiltin) || isTestBuiltin(spec.fields?.color))) {
    return fail('Test already divides the panels, so it cannot also be on the X axis or the colour');
  }
  if (xFieldsOf(spec.fields?.x).some(f => sameField(f, facetField)) || (spec.fields?.color && isField(spec.fields.color) && sameField(spec.fields.color, facetField))) {
    return fail(`${label} divides the panels, so on the X axis or the colour as well it would have one value per panel`);
  }
  const whole = resolvePlot(base, items, byTest ? { ...inner, facetByTest: true } : inner);
  const titled = (r: ResolvedPlot): ResolvedPlot => ({ ...r, autoTitle: `${r.autoTitle} · panels by ${label}` });
  if (whole.issues.length || !whole.marks) return titled(whole);

  type Panel = { label: string; items: PlotItem[]; index: number[]; spec: PlotSpec };
  let panels: Panel[] = [];
  const notes: string[] = [];
  if (byTest) {
    const set = whole.setTests;
    if (!set) return fail('Test panels need several tests as the values');
    const identity = items.map((_, i) => i);
    panels = set.tests.map((tn, k) => ({
      label: set.labels[k], items: [...items], index: identity,
      spec: { ...base, fields: { ...rest, y: { test: tn, ...(ctx.testDefs?.find(d => d.testNumber === tn)?.name ? { name: ctx.testDefs!.find(d => d.testNumber === tn)!.name } : {}) } } },
    }));
  } else {
    const rows = flatten(items);
    const col = resolveField(facetField, { items, rows, ctx });
    if (col.issue) return fail(col.issue);
    if (!col.cat) return fail(`${label} is continuous: panels need a category, such as split, ring or site`);
    if (col.level === 'die' && whole.level === 'wafer') return fail(`${label} is per die, so it cannot divide a plot with one mark per wafer into panels`);
    const seen: string[] = [];
    for (const v of col.cat) if (v !== undefined && !seen.includes(v)) seen.push(v);
    const order = categoryOrder(facetField, seen, numericCategories(col));
    if (order.length > PLOT_FACET_LIMIT) return fail(`${label} has ${order.length} values, and a plot draws at most ${PLOT_FACET_LIMIT} panels: choose a field with fewer, or narrow Show`);
    const missing = col.cat.filter(v => v === undefined).length;
    if (missing) notes.push(`${missing.toLocaleString('en-GB')} ${col.level === 'die' ? 'dies' : 'wafers'} with no ${label} value are in no panel`);
    panels = order.map(value => {
      const sub: PlotItem[] = [], index: number[] = [];
      if (col.level === 'wafer') {
        items.forEach((it, i) => { if (col.cat![i] === value) { sub.push(it); index.push(i); } });
      } else {
        const keep = items.map(() => [] as Die[]);
        for (let i = 0; i < rows.dies.length; i++) if (col.cat![i] === value) keep[rows.item[i]].push(rows.dies[i]);
        items.forEach((it, i) => { if (keep[i].length) { sub.push({ ...it, dies: keep[i], allDies: it.allDies ?? it.dies }); index.push(i); } });
      }
      return { label: value, items: sub, index, spec: base };
    });
  }
  const facets = panels.map(p => ({ label: p.label, plot: alignPanel(resolvePlot(p.spec, p.items, inner), p.index, whole) }));
  const usesPat = whole.usesPat || isPatBuiltin(facetField) || facets.some(f => f.plot.usesPat);
  return { ...titled(whole), notes: [...whole.notes, ...notes], facets, facetLabel: label, ...(usesPat ? { usesPat: true as const } : {}) };
}

/** Resolves `spec` over `items`. Never throws for a plot that cannot be drawn: it returns the reasons. */
export function resolvePlot(spec: PlotSpec, items: readonly PlotItem[], ctx: PlotContext = {}): ResolvedPlot {
  const versionIssue = plotIssue(spec);
  if (versionIssue) return emptyResult(spec, items, [versionIssue], ctx);
  const fail = (...issues: string[]) => emptyResult(spec, items, issues, ctx);
  // A sweep reads runs of tests, not fields: the sweep panel draws it, and the callers branch on the mark first.
  if (spec.chart === 'sweep') return fail('A sweep is drawn by the sweep panel');
  if (spec.fields?.facet && !ctx.inFacet) return resolveFacets(spec, items, ctx);

  const mark = spec.chart;
  const enc = spec.fields ?? {};
  const defs = ctx.testDefs ?? [];
  const origDies = items.flatMap(it => it.dies);
  const notes: string[] = [];

  // A set of tests on Y: the population is read once per test (see `Resolver.melt`), after the set is checked against
  // this population and, when the values are rescaled, after each test's scale is read from it.
  const setField = isTestSet(enc.y) ? enc.y : undefined;
  if (isTestSet(enc.x) || isTestSet(enc.color)) return fail('A set of tests can only be the values (Y) of a plot');
  if (spec.normalize && mark === 'scatter') return fail('Rescaling applies to the values of a box, bar, line or histogram, not to a scatter');
  if (setField && mark === 'scatter') return fail('A scatter plots one value against another: choose one test for each axis, or a box, bar, line or histogram to show several tests');
  const nameOfTest = (tn: number) => defs.find(d => d.testNumber === tn)?.name || setField?.names?.[String(tn)] || `Test ${tn}`;
  let melt: Resolver['melt'];
  let scales: Map<number, TestScale> | undefined;
  let bases = new Set<'spec' | 'test'>();
  let source: readonly PlotItem[] = items;
  if (setField) {
    const { tests: named, problems } = expandTestSet(setField, defs);
    if (problems.length) return fail(...problems);
    const present = new Set(origDies.length ? testsPresent(origDies, 'values') : []);
    const absent: string[] = [];
    let tests: number[] = [];
    for (const tn of named) {
      const def = defs.find(d => d.testNumber === tn);
      const saved = setField.names?.[String(tn)];
      if (def && saved && def.name && !sameTestName(saved, def.name)) return fail(`Test ${tn} is "${saved}" in this plot and "${def.name}" here`);
      if (def && !isParametricTest(def)) { absent.push(`${nameOfTest(tn)} (pass/fail, no value)`); continue; }
      if (!present.has(tn)) { absent.push(saved ? `${saved} (test ${tn})` : `test ${tn}`); continue; }
      tests.push(tn);
    }
    if (tests.length === 0) return fail(`None of these tests has values in these dies${absent.length ? `: ${absent.join(', ')}` : ''}`);
    if (tests.length * origDies.length > TEST_SET_VALUE_LIMIT) {
      const most = Math.max(1, Math.floor(TEST_SET_VALUE_LIMIT / Math.max(1, origDies.length)));
      return fail(`${tests.length} tests over ${origDies.length.toLocaleString('en-GB')} dies is ${(tests.length * origDies.length).toLocaleString('en-GB')} values, more than one plot draws (${TEST_SET_VALUE_LIMIT.toLocaleString('en-GB')}): choose at most ${most} tests, or show fewer wafers`);
    }
    if (absent.length) notes.push(`Left out, with no values here: ${absent.join(', ')}`);
    if (spec.normalize) {
      const got = testScales(tests, ctx.scaleDies ?? origDies, defs, spec.normalize, nameOfTest);
      if (got.scales.size === 0) return fail(...got.dropped);
      if (got.dropped.length) notes.push(`Left out: ${got.dropped.join('; ')}`);
      tests = tests.filter(tn => got.scales.has(tn));
      scales = got.scales;
      bases = got.bases;
    } else {
      const units = [...new Set(tests.map(tn => defs.find(d => d.testNumber === tn)?.unit).filter((u): u is string => !!u))];
      if (units.length > 1) return fail(`These tests are measured in different units (${units.join(', ')}): rescale them to compare them on one axis`);
    }
    const names = tests.map(nameOfTest);
    const labels = names.map((n, k) => (names.indexOf(n) !== names.lastIndexOf(n) ? `${n} · ${tests[k]}` : n));
    const pseudo: PlotItem[] = [];
    const realOf: number[] = [], testOf: number[] = [];
    tests.forEach((_, t) => items.forEach((it, i) => { pseudo.push(it); realOf.push(i); testOf.push(t); }));
    melt = { realOf: Int32Array.from(realOf), testOf: Int32Array.from(testOf), tests, labels };
    source = pseudo;
  }
  const realItem = (i: number) => (melt ? melt.realOf[i] : i);

  const rows = flatten(source);
  const r: Resolver = { items: source, rows, ctx, melt };

  const givenX = xFieldsOf(enc.x);
  if (givenX.length > 1 && mark !== 'box' && mark !== 'bar') return fail('Nested categories need a box or bar chart: choose one field for X');
  if (givenX.length > PLOT_X_LEVELS) return fail(`At most ${PLOT_X_LEVELS} fields can be nested on X`);
  if (givenX.some((f, i) => givenX.findIndex(g => sameField(f, g)) !== i)) return fail('A field can be only one level of the categories');
  const xFields: PlotField[] = givenX.length ? givenX : (mark === 'box' || mark === 'bar') ? [{ builtin: setField ? 'test' : 'wafer' }] : [];
  /** The one X of a chart that takes one; the outer level of nested categories. */
  const xField: PlotField | undefined = xFields[0];
  const xHasTest = xFields.some(isTestBuiltin);
  const yField: PlotField | undefined = enc.y;
  /** A histogram and a probability plot read one field of values, and take no X. */
  const valuesOnly = mark === 'histogram' || mark === 'probability';
  const valueField = valuesOnly ? (yField ?? xField) : yField;

  // Required roles.
  if (mark === 'scatter' || mark === 'line') {
    if (!xField) return fail('Choose a field for X');
    if (!yField) return fail('Choose a field for Y');
  }
  if (mark === 'box' && !yField) return fail('Choose a field for Y');
  if (mark === 'histogram' && !valueField) return fail('Choose a field to count');
  if (mark === 'probability' && !valueField) return fail('Choose the values to plot');

  const xCols = valuesOnly ? [] : xFields.map(f => resolveField(f, r));
  const xCol: FieldColumn | undefined = xCols[0];
  let yCol = valueField ? resolveField(valueField, r) : undefined;

  // Rescaling: each test on its own, read over every die in view, before anything is combined.
  if (spec.normalize && yCol && !yCol.issue) {
    if (!melt) {
      if (!('test' in yCol.field) || !yCol.num) return fail('Rescaling applies to a measured test: choose a test for the values');
      const tn = yCol.field.test;
      const got = testScales([tn], ctx.scaleDies ?? rows.dies, defs, spec.normalize, () => yCol!.label);
      if (got.scales.size === 0) return fail(...got.dropped);
      scales = got.scales;
      bases = got.bases;
    }
    const testAt = (row: number) => (melt ? melt.tests[melt.testOf[rows.item[row]]] : (yCol!.field as { test: number }).test);
    const num = new Float64Array(yCol.num!.length);
    for (let i = 0; i < num.length; i++) { const sc = scales!.get(testAt(i))!; num[i] = (yCol.num![i] - sc.offset) / sc.scale; }
    const tests = melt ? melt.tests : [testAt(0)];
    const base = melt ? (tests.length > 3 ? `${tests.length} tests` : list(melt.labels)) : yCol.label;
    // One test's limits are its column's (PAT included, on one wafer); a set's are each test's definition.
    const own = yCol.limits;
    const limitsOfTest = melt ? (tn: number) => limitsOf(defs.find(d => d.testNumber === tn)) : () => own;
    yCol = { ...yCol, num, unit: undefined, limits: scaledLimits(tests, limitsOfTest, scales!), label: `${base} (${NORMALIZE_WORD[spec.normalize]})` };
  } else if (melt && yCol && !yCol.issue) {
    yCol = { ...yCol, label: melt.tests.length > 3 ? `${melt.tests.length} tests` : list(melt.labels) };
  }

  // A role that needs a number cannot take a category: say so, and where the category does belong.
  const needsNumber: Array<[string, FieldColumn | undefined]> = mark === 'scatter' || mark === 'line' ? [['X', xCol], ['Y', yCol]]
    : mark === 'histogram' ? [['to count', yCol]] : mark === 'probability' ? [['values', yCol]] : mark === 'box' || mark === 'bar' ? [['Y', yCol]] : [];
  for (const [role, col] of needsNumber) {
    if (col && !col.issue && col.kind === 'categorical' && !col.num) {
      return fail(`${col.label} is a category, not a number, so it cannot be ${role === 'to count' ? 'the field a histogram counts' : role === 'values' ? 'the values of a probability plot' : `the ${role} of a ${mark}`}. `
        + `Use it as the X of a bar or box chart (one bar per ${col.label.toLowerCase()}), or as the colour`);
    }
  }

  // Colour. A set of tests is divided by test: on X, or else on the colour, which a followed colour gives way to.
  const colorSpec: PlotColor | undefined =
    setField && !xHasTest && !ctx.facetByTest && (enc.color === undefined || 'follow' in enc.color) ? { builtin: 'test' } : enc.color;
  if (setField && !xHasTest && !ctx.facetByTest && !isTestBuiltin(colorSpec)) return fail('Put Test on the X axis or the colour, so each test is drawn on its own');
  let colorCol: FieldColumn | undefined;
  let followWafer = false;
  let followMeta: string | undefined;
  if (colorSpec === undefined || ('follow' in colorSpec)) {
    if (ctx.groupBy) followMeta = ctx.groupBy;
    else if ((ctx.wholeWafers ?? items.length) > 1) followWafer = true;
  } else if (!('none' in colorSpec)) {
    colorCol = resolveField(colorSpec, r);
  }
  if (followMeta) colorCol = resolveField({ meta: followMeta }, r);
  if (followWafer) colorCol = resolveField({ builtin: 'wafer' }, r);
  // A colour that follows the tab is quietly absent where nothing has that field.
  if (colorCol?.issue && (colorSpec === undefined || 'follow' in colorSpec)) colorCol = undefined;

  const issues = [...xCols.map(c => c.issue), yCol?.issue, colorCol?.issue].filter((s): s is string => !!s);
  // A measured value or a wafer figure colours a scatter on a gradient; a lot field with numbers in it (temperature,
  // slot) is a handful of values and colours as a category. Everywhere else a colour is a category.
  const continuous = !!colorCol && colorCol.kind === 'numeric' && !('meta' in colorCol.field);
  if (continuous && mark !== 'scatter') {
    issues.push(`${colorCol!.label} is continuous, so it can colour a scatter but not a ${mark}: colour by a category such as wafer, split or bin`);
  }
  if (issues.length) return fail(...issues);

  // Level.
  const used = [...xCols, yCol].filter((c): c is FieldColumn => !!c);
  let level: 'die' | 'wafer' = spec.level ?? (used.some(c => c.level === 'die') ? 'die' : 'wafer');
  const dieOnly = [...xCols, continuous ? undefined : colorCol].filter((c): c is FieldColumn => !!c && c.level === 'die');
  const facts = (c: FieldColumn | undefined): FieldFacts | undefined => c && { label: c.label, level: c.level, kind: c.kind, yield: !!c.weights };
  // Of nested categories, the finest level is the one the rules are about: a per-die level makes the plot per die.
  const conflict = combinationIssue(mark, { x: facts(xCols.find(c => c.level === 'die') ?? xCol), y: facts(yCol), color: facts(colorCol) }, { aggregate: spec.aggregate, level: spec.level, continuousColor: continuous });
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
  const unitInfo = (u: number): PlotUnit => ({ item: realItem(itemOf(u)), die: level === 'die' ? rows.dies[u] : undefined });

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
    const ordered = categoryOrder(colorCol.field, seen, numericCategories(colorCol));
    ordered.forEach((t, i) => labels.set(t, i));
    groups = ordered;
    for (let u = 0; u < nUnits; u++) groupOf[u] = labels.get(cc[u] ?? FACET_NONE_VALUE)!;
  }

  const omittedBy = new Map<string, number>();
  const omit = (label: string) => omittedBy.set(label, (omittedBy.get(label) ?? 0) + 1);
  /** The field a unit's missing value is reported against: for a set of tests, the unit's own test. */
  const labelAt = (c: FieldColumn, u: number) => (c.labelOf ? c.labelOf(level === 'die' ? rows.item[u] : u) : c.label);
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
      if (!Number.isFinite(ys[u])) { omit(labelAt(yCol!, u)); continue; }
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
      if (!Number.isFinite(vs[u])) { omit(labelAt(yCol!, u)); continue; }
      values[groupOf[u]].push(vs[u]); units[groupOf[u]].push(u); plotted++;
    }
    marks = { type: 'histogram', values, units, unit: unitInfo };
    xAxis = axisFor('x', yCol!.label, yCol!.unit, spec, values.flat(), notes);
    yAxis = { label: 'Count', scale: 'linear', ...(spec.axes?.y?.label ? { label: spec.axes.y.label } : {}) };
    aggregation = perWaferNote(yCol!);
  } else if (mark === 'probability') {
    // Each group's values in order, the unit behind each kept beside it so a point can name its die.
    // Each group's units sorted by value: a plain index sort, no pair per value, since a lot can hold millions of them.
    const vs = numAt(yCol!);
    const units: number[][] = Array.from({ length: groupCount }, () => []);
    for (let u = 0; u < nUnits; u++) {
      if (!Number.isFinite(vs[u])) { omit(labelAt(yCol!, u)); continue; }
      units[groupOf[u]].push(u); plotted++;
    }
    for (const g of units) g.sort((a, b) => vs[a] - vs[b]);
    const values = units.map(g => g.map(u => vs[u]));
    marks = { type: 'probability', values, units, unit: unitInfo };
    xAxis = axisFor('x', yCol!.label, yCol!.unit, spec, values.flat(), notes);
    const linear = spec.probabilityAxis === 'linear';
    yAxis = { label: spec.axes?.y?.label ?? 'Cumulative share', scale: 'linear' };
    aggregation = [perWaferNote(yCol!), `each ${level === 'die' ? 'die' : 'wafer'} at (rank − ½) / n of its ${groupCount > 1 ? 'group' : 'population'}${linear ? '' : ', on a normal-probability scale'}`].filter(Boolean).join('; ');
  } else if (mark === 'line') {
    const xs = numAt(xCol!), ys = numAt(yCol!);
    const xsSeen = new Set<number>();
    const cells = new Map<string, number[]>();
    const cellUnitsMap = new Map<string, number[]>();
    for (let u = 0; u < nUnits; u++) {
      if (!Number.isFinite(xs[u])) { omit(xCol!.label); continue; }
      if (!Number.isFinite(ys[u])) { omit(labelAt(yCol!, u)); continue; }
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
    // box and bar: one category per value of X, or per combination of the values of nested X levels, outer first.
    const levelLabels: Array<(string | undefined)[]> = [];
    const levelRank: Array<Map<string, number>> = [];
    for (const xc of xCols) {
      const isCoordinate = 'builtin' in xc.field && (xc.field.builtin === 'x' || xc.field.builtin === 'y');
      if (xc.kind === 'numeric' && xc.level === 'die' && !isCoordinate) return fail(`${xc.label} is continuous, so a ${mark} cannot have one ${mark === 'bar' ? 'bar' : 'box'} per value; use a scatter or line, or choose a categorical X such as wafer, ring or bin`);
      const labelsOf: (string | undefined)[] = xc.cat
        ? catAt(xc)
        : Array.from(numAt(xc), v => (Number.isFinite(v) ? fmtExact(v) : undefined));
      const seen = new Set<string>();
      const order: string[] = [];
      for (let u = 0; u < nUnits; u++) { const t = labelsOf[u]; if (t !== undefined && !seen.has(t)) { seen.add(t); order.push(t); } }
      const sorted = categoryOrder(xc.field, order, numericCategories(xc));
      levelLabels.push(labelsOf);
      levelRank.push(new Map(sorted.map((t, i) => [t, i])));
    }
    const SEP = '\u001f';
    const catSeen = new Map<string, number>();
    const tuples: string[][] = [];
    /** The unit's category key, or the level it has no value at. */
    const keyAt = (u: number): string | { missing: number } => {
      const parts: string[] = [];
      for (let k = 0; k < levelLabels.length; k++) { const t = levelLabels[k][u]; if (t === undefined) return { missing: k }; parts.push(t); }
      return parts.join(SEP);
    };
    for (let u = 0; u < nUnits; u++) {
      const key = keyAt(u);
      if (typeof key === 'string' && !catSeen.has(key)) { catSeen.set(key, 0); tuples.push(key.split(SEP)); }
    }
    tuples.sort((a, b) => { for (let k = 0; k < a.length; k++) { const d = levelRank[k].get(a[k])! - levelRank[k].get(b[k])!; if (d) return d; } return 0; });
    const categories = tuples.map(t => t.join(' · '));
    tuples.forEach((t, i) => catSeen.set(t.join(SEP), i));
    const labelsOf = levelLabels.length === 1 ? levelLabels[0] : undefined;

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
      const key = keyAt(u);
      if (typeof key !== 'string') { omit(xCols[key.missing].label); continue; }
      const ci = catSeen.get(key)!;
      if (ys && !Number.isFinite(ys[u]) ) { omit(labelAt(yCol!, u)); continue; }
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

    // Rearrangements: categories by value, the first few kept, the colours stacked or as shares, a cumulative line.
    const adds = mark === 'bar' && (how === 'count' || how === 'sum');
    if (spec.stack && mark !== 'bar') return fail('Only a bar chart stacks its colours');
    if (spec.stack && !adds) return fail(`Stacking adds the colours' values, which means something for a count or a sum, not a ${AGG_WORD[how].toLowerCase()}: combine by count or sum, or draw the colours side by side`);
    if (spec.cumulative && !(adds && spec.sort === 'value')) return fail('A cumulative line needs a bar of counts or sums sorted by value, largest first');
    if ((spec.sort || spec.top) && xCols.length > 1) return fail('Sorting by value and keeping the top categories need one category field on X');
    const totalOf = (c: number): number => {
      if (mark === 'box') { const all = cells.flatMap(row => row[c]); return all.length ? combine(all, 'median') : NaN; }
      let t = 0, any = false;
      for (const row of values) if (Number.isFinite(row[c])) { t += row[c]; any = true; }
      return any ? t : NaN;
    };
    const totals = categories.map((_, c) => totalOf(c));
    let order = categories.map((_, c) => c);
    if (spec.sort === 'value') order.sort((a, b) => (Number.isFinite(totals[b]) ? totals[b] : -Infinity) - (Number.isFinite(totals[a]) ? totals[a] : -Infinity));
    const grand = totals.reduce((a, t) => a + (Number.isFinite(t) ? t : 0), 0);
    if (spec.top && spec.top < order.length) {
      notes.push(`Showing the first ${spec.top} of ${order.length} ${xCols[0].label.toLowerCase()} values${spec.sort === 'value' ? ', largest first' : ''}`);
      order = order.slice(0, spec.top);
    }
    const pick = <T>(arr: readonly T[]) => order.map(c => arr[c]);
    categories.splice(0, categories.length, ...pick(categories));
    for (let g = 0; g < groupCount; g++) { cells[g] = pick(cells[g]); cellUnits[g] = pick(cellUnits[g]); values[g] = pick(values[g]); }
    const shownTotals = pick(totals);
    if (tuples.length) tuples.splice(0, tuples.length, ...pick(tuples));
    if (spec.stack === 'percent') {
      for (let g = 0; g < groupCount; g++) values[g] = values[g].map((v, c) => (Number.isFinite(v) && shownTotals[c] > 0 ? (v / shownTotals[c]) * 100 : NaN));
    }
    let running = 0;
    const cumulative = spec.cumulative && grand > 0 ? shownTotals.map(t => { running += Number.isFinite(t) ? t : 0; return (running / grand) * 100; }) : undefined;

    // A wafer is its own category, so a click on it can open that wafer: the item behind each label. Only when the wafer
    // is the whole category; a nested one (a ring within a wafer) is part of a wafer, and a click selects its dies.
    const isWafer = !!labelsOf && 'builtin' in xCols[0].field && xCols[0].field.builtin === 'wafer';
    const categoryItems = isWafer ? categories.map(c => labelsOf!.findIndex((t, u) => t === c && u >= 0)) : undefined;
    const nest = xCols.length > 1 ? { levels: xCols.map(c => c.label), parts: tuples } : undefined;
    marks = {
      type: mark === 'box' ? 'box' : 'bar', categories, cells, cellUnits, unit: unitInfo, values,
      categoryItems: categoryItems?.map(u => realItem(level === 'die' ? rows.item[u] : u)),
      ...(nest ? { nest } : {}), ...(spec.stack && groupCount > 1 ? { stack: spec.stack } : {}), ...(cumulative ? { cumulative } : {}),
    };
    const perWhat = list(xCols.map(c => c.label.toLowerCase()));
    xAxis = { label: spec.axes?.x?.label ?? xCols.map(c => c.label).join(' › '), scale: 'linear' };
    if (mark === 'bar') {
      const word = how === 'count' ? 'Count' : AGG_WORD[how];
      const base = wantsCount ? `Count of ${unitNoun}` : how === 'yield' ? 'Pooled yield' : `${word} ${yCol!.label}`;
      const percent = spec.stack === 'percent' && groupCount > 1;
      const ylabel = percent ? `Share of each ${xCols[0].label.toLowerCase()}'s ${wantsCount ? unitNoun : base.toLowerCase()}` : base;
      // A stack's axis spans each category's total, not its colours one by one.
      const spanValues = percent ? [0, 100] : spec.stack && groupCount > 1 ? shownTotals.filter(Number.isFinite) : values.flat();
      yAxis = axisFor('y', ylabel, percent || how === 'yield' ? '%' : (how === 'count' ? undefined : yCol?.unit), spec, spanValues, notes);
      aggregation = wantsCount ? undefined
        : how === 'yield' ? `passing dies over judged dies, pooled per ${perWhat}`
        : `${word.toLowerCase()} of ${yCol!.label}${yCol!.level === 'die' && level === 'wafer' ? ' per wafer' : ''} per ${perWhat}`;
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
  if (valuesOnly && xAxis) xAxis.limits = measuresTest(yCol);

  const title = (): string => {
    const y = yCol?.label;
    // Nested categories are named together; a Test level names nothing the values do not already.
    const named = xCols.filter(c => !isTestBuiltin(c.field));
    const x = mark === 'box' || mark === 'bar' ? (named.length ? list(named.map(c => c.label)) : undefined) : xCol?.label;
    const core = mark === 'scatter' ? `${y} vs ${x}`
      : mark === 'histogram' ? `${y}`
      : mark === 'probability' ? `${y}, cumulative`
      : mark === 'line' ? `${y} over ${x}`
      : !x ? `${y}`
      : mark === 'box' ? `${y} by ${x}`
      : y ? `${y} by ${x}` : `Dies by ${x}`;
    return colorLabel && colorCol && !xFields.some(f => sameField(colorCol!.field, f)) && !isTestBuiltin(colorCol.field) ? `${core} · by ${colorLabel}` : core;
  };

  // Values the value filter excluded from the tests this plot reads: said in the footnote, never silent.
  const excludedFields: Array<{ field: string; count: number }> = [];
  let excludedSet: string | undefined;
  const read: Array<{ field: string; test: number }> = melt ? melt.tests.map((tn, k) => ({ field: melt!.labels[k], test: tn })) : [];
  for (const col of new Set([...xCols, melt ? undefined : yCol, colorCol])) if (col && 'test' in col.field) read.push({ field: col.label, test: col.field.test });
  for (const { field, test: tn } of read) {
    let count = 0;
    for (const d of origDies) if (excludedValue(d, tn) !== undefined) { count++; excludedSet ??= limitSetName(excludedBy(d)!); }
    if (count > 0) excludedFields.push({ field, count });
  }

  // A wafer-level comparison, where the plot divides wafers by a wafer field: the plotted test's wafer means per group.
  let comparison: ResolvedPlot['comparison'];
  if ((mark === 'box' || mark === 'bar') && !melt && yCol && 'test' in yCol.field && yCol.level === 'die' && yCol.num && !yCol.perDie) {
    const byWafer = (c: FieldColumn | undefined) => !!c && c.level === 'wafer' && c.kind === 'categorical' && !!c.cat && !('builtin' in c.field && (c.field.builtin === 'wafer' || c.field.builtin === 'test'));
    const by = xCols.length === 1 && byWafer(xCols[0]) ? xCols[0] : !continuous && byWafer(colorCol) ? colorCol : undefined;
    if (by) {
      const sum = new Float64Array(items.length), count = new Uint32Array(items.length);
      for (let i = 0; i < rows.dies.length; i++) { const v = yCol.num[i]; if (Number.isFinite(v)) { sum[rows.item[i]] += v; count[rows.item[i]]++; } }
      const perGroup = new Map<string, number[]>();
      items.forEach((_, i) => {
        const key = by.cat![i];
        if (key === undefined || count[i] === 0) return;
        (perGroup.get(key) ?? perGroup.set(key, []).get(key)!).push(sum[i] / count[i]);
      });
      const keys = [...perGroup.keys()].sort(compareNatural);
      if (keys.length >= 2) comparison = { by: by.label, result: compareGroups(keys.map(key => ({ key, values: perGroup.get(key)! }))) };
    }
  }

  const usesPat = [...xCols, yCol, colorCol].some(c => !!c && 'builtin' in c.field && c.field.builtin === 'pat')
    || [xAxis, yAxis].some(a => a?.limits?.patLow !== undefined || a?.limits?.patHigh !== undefined);

  return {
    spec, issues: [], notes, marks, level,
    ...(comparison ? { comparison } : {}),
    ...(usesPat ? { usesPat: true as const } : {}),
    ...(excludedSet ? { excluded: { limitSet: excludedSet, fields: excludedFields } } : {}),
    autoTitle: title(), x: xAxis, y: yAxis, groups, colorScale, colorLabel, aggregation,
    ...(spec.normalize && scales ? { normalization: normalizeNote(spec.normalize, bases) } : {}),
    population: { wafers: items.length, dies: origDies.length },
    ...(melt ? { setTests: { tests: melt.tests, labels: melt.labels } } : {}),
    plotted,
    omitted: [...omittedBy].map(([field, count]) => ({ field, count })),
  };
}

/** The plot's title: the one the user typed, else the automatic one. */
export function plotTitle(resolved: ResolvedPlot): string {
  return resolved.spec.title?.trim() ? resolved.spec.title : resolved.autoTitle;
}

/** A wafer-level comparison in one clause: what was compared, with how many wafers, and the two p-values. */
function comparisonSentence(by: string, c: GroupComparison): string {
  const sizes = c.groups.map(g => `${g.key} ${g.n}`).join(', ');
  const head = `by ${by.toLowerCase()}, wafer means (wafers: ${sizes})`;
  if (!c.welch && !c.kruskal) return `${head}: ${c.issue?.toLowerCase() ?? 'not comparable'}`;
  const welch = c.welch ? `${c.welch.method === 'welch-t' ? 'Welch t' : 'Welch ANOVA'} p ${formatP(c.welch.p)}` : undefined;
  const rank = c.kruskal ? `rank p ${formatP(c.kruskal.p)}${c.kruskal.approximate ? ' (approximate)' : ''}` : undefined;
  return `${head}: ${[welch, rank].filter(Boolean).join(', ')}`;
}

/** The statement every plot carries about what it shows ("6 wafers · 3,966 dies · 12 dies without Ioff not plotted"). */
export function plotFootnote(resolved: ResolvedPlot): string {
  const { wafers, dies } = resolved.population;
  const parts = [`${wafers.toLocaleString('en-GB')} wafer${wafers === 1 ? '' : 's'} · ${dies.toLocaleString('en-GB')} dies`];
  if (resolved.aggregation) parts.push(resolved.aggregation);
  if (resolved.normalization) parts.push(resolved.normalization);
  if (resolved.comparison) parts.push(comparisonSentence(resolved.comparison.by, resolved.comparison.result));
  if (resolved.usesPat) parts.push(`PAT per wafer: median ± ${PAT_K} × (Q3 − Q1) / 1.35 of its passing dies, within the test's limits`);
  if (resolved.facets) parts.push(`${resolved.facets.length} panels by ${resolved.facetLabel!.toLowerCase()}, on shared axes`);
  for (const o of resolved.omitted) parts.push(`${o.count.toLocaleString('en-GB')} ${resolved.level === 'die' ? 'dies' : 'wafers'} without ${o.field} not plotted`);
  if (resolved.excluded) {
    for (const f of resolved.excluded.fields) parts.push(`${f.count.toLocaleString('en-GB')} ${f.field} value${f.count === 1 ? '' : 's'} outside ${resolved.excluded.limitSet} excluded`);
  }
  return parts.join(' · ');
}


// ── what can be chosen ────────────────────────────────────────────────────────────────────────────────────

export type FieldGroup = 'Tests' | 'Verdicts' | 'Die' | 'Wafer';

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
  if (isTestSet(f)) return `tests:${f.tests.join(',')}`;
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
  // The category that divides a set of tests into its tests, when the lot has tests enough to make a set of.
  if (tests.size >= 2) out.push({ field: { builtin: 'test' }, label: BUILTIN_LABEL.test, name: BUILTIN_LABEL.test, group: 'Tests', kind: 'categorical', level: 'wafer', categorical: true });
  // Pass/fail tests (functional, or derived to a verdict) have an outcome per die and no value: they are categories, offered
  // under Verdicts when this population has an outcome for them.
  const outcomes = new Set(dies.length ? testsPresent(dies, 'all') : []);
  for (const d of defs) {
    if (isParametricTest(d) || !(outcomes.has(d.testNumber) || !dies.length)) continue;
    const name = d.name || `Test ${d.testNumber}`;
    out.push({
      field: { test: d.testNumber, ...(d.name ? { name: d.name } : {}) },
      label: `${name} · ${d.testNumber} (pass/fail)`, name,
      group: 'Verdicts', kind: 'categorical', level: 'die', categorical: true,
    });
  }
  const has = (f: (d: Die) => boolean) => dies.some(f);
  const die = (builtin: PlotBuiltin, kind: FieldKind, categorical: boolean) =>
    out.push({ field: { builtin }, label: BUILTIN_LABEL[builtin], name: BUILTIN_LABEL[builtin], group: 'Die', kind, level: 'die', categorical });
  if (has(d => hasPosition(d))) { die('x', 'numeric', false); die('y', 'numeric', false); }
  if (items.some(it => it.wafer) && has(d => hasPosition(d) && d.physX !== undefined)) die('radius', 'numeric', false);
  // Die regions: each is offered only when this population can place a die in it (reticle ones need a stepper field).
  const placed = has(d => hasPosition(d));
  for (const key of DIE_REGION_KEYS) {
    if (items.some(it => DIE_REGIONS[key].available({ wafer: it.wafer, ringCount: it.ringCount }, placed))) die(key, 'categorical', true);
  }
  if (has(d => d.hbin !== undefined)) die('hbin', 'categorical', true);
  if (has(d => d.sbin !== undefined)) die('sbin', 'categorical', true);
  if (has(d => d.siteNum !== undefined)) die('site', 'categorical', true);
  if (dies.length && patTests(defs.filter(d => present.has(d.testNumber))).length) die('pat', 'categorical', true);

  const wafer = (builtin: PlotBuiltin, kind: FieldKind, categorical: boolean) =>
    out.push({ field: { builtin }, label: BUILTIN_LABEL[builtin], name: BUILTIN_LABEL[builtin], group: 'Wafer', kind, level: 'wafer', categorical });
  wafer('wafer', 'categorical', true);
  if (items.length > 1) wafer('waferOrder', 'numeric', false);
  wafer('yield', 'numeric', false);
  wafer('dieCount', 'numeric', false);
  const r: Resolver = { items, rows: { dies: [], item: new Uint32Array(0) }, ctx };
  for (const f of buildFacetTable(items.map(it => ({ metadata: it.metadata, dieCount: it.dies.length })), { facetableOnly: true, curation: ctx.curation })) {
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
  const tests = catalogue.filter(f => f.group === 'Tests' && 'test' in f.field);
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
  const used = [...xFieldsOf(spec.fields?.x), spec.fields?.y, colour, spec.fields?.facet].filter((f): f is PlotField => isField(f));
  const isUsed = (f: PlotField) => used.some(u => sameField(u, f));
  const names = catalogue
    .filter(o => !GENERIC_NAMES.has(o.name.toLowerCase()) && !('meta' in o.field) && !isUsed(o.field) && mentions(title, o.name))
    .map(o => o.name);
  const roles = [...xFieldsOf(spec.fields?.x), spec.fields?.y].filter((f): f is PlotField => isField(f));
  const nameOf = (f: PlotField) => catalogue.find(o => sameField(o.field, f))?.name ?? fieldLabel(f);
  const named = roles.filter(f => !GENERIC_NAMES.has(nameOf(f).toLowerCase()) && mentions(title, nameOf(f)));
  const missing = roles.filter(f => !GENERIC_NAMES.has(nameOf(f).toLowerCase()) && !mentions(title, nameOf(f)));
  const omits = named.length > 0 || names.length > 0 ? missing.map(nameOf) : [];
  return { names, omits };
}


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
 * order as a line, the first test as a probability plot (a curve per wafer, or per Group by), and a sweep of the first
 * few tests in test order. A type is left out when the population cannot
 * support it (a line needs two wafers, a sweep two tests). Untitled, so each one is named by what it plots; the sweep,
 * which has no fields to name it by, is titled "Example sweep".
 */
export function examplePlots(catalogue: readonly FieldOption[], waferCount: number, newId: () => string): PlotSpec[] {
  const tests = catalogue.filter(f => f.group === 'Tests' && 'test' in f.field).map(f => f.field);
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
  // The first test as cumulative curves, one per wafer (or per Group by), where a shifted or wider wafer stands out.
  if (tests.length >= 1) out.push({ id: newId(), chart: 'probability', fields: { y: tests[0] } });
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
  const order = spec.chart === 'scatter' ? [x, y, color] : spec.chart === 'histogram' || spec.chart === 'probability' ? [y, x] : [y];
  for (const f of order) {
    if (isField(f) && 'test' in f) return f.test;
    // A set of tests opens a wafer on its first.
    if (isTestSet(f)) { const first = f.tests[0]; const n = typeof first === 'number' ? first : parseInt(String(first), 10); if (Number.isInteger(n)) return n; }
  }
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
