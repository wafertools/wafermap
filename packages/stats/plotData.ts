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

import { GUIDE_SECTIONS, type GuideSection } from './guideSections.js';
import type { Die } from '../core/dies.js';
import { hasPosition, isYieldEligibleDie } from '../core/dies.js';
import { DIE_REGIONS, DIE_REGION_KEYS, dieRadialPosition } from './dieRegions.js';
import type { Wafer } from '../core/wafer.js';
import type { WaferMetadata } from '../core/metadata.js';
import { excludedBy, excludedValue, testValue, testsPresent } from '../core/dieTable.js';
import { limitSetName } from '../renderer/valueFilter.js';
import { compareNatural, minOf, maxOf } from '../core/utils.js';
import { isParametricTest, getTestPassStatus, type TestDef } from '../renderer/buildWaferMap.js';
import { attributeLabel, facetValueOf, buildFacetTable, FACET_NONE_VALUE } from './facets.js';
import type { FacetCuration } from './facets.js';
import { yieldCounts } from './yield.js';
import { sameTestName } from './sweep.js';
import { sameField, plotIssue, plotConditions, isField, isTestSet, isBinned, isStatReference, isPassRateSet, xFieldsOf, PLOT_X_LEVELS, PLOT_FACET_LIMIT, PLOT_BINS_DEFAULT } from './plotSpec.js';
import type { PlotSpec, PlotCondition, PlotField, PlotAxis, PlotValueReference, PlotAggregate, PlotBuiltin, PlotTestSet, PlotNormalize, PlotColor, PlotBinnedField, PlotJudge } from './plotSpec.js';
import { fmtExact, fmt } from '../renderer/fmt.js';
import { parseTestReference } from '../renderer/derivedTests/parser.js';
import { capabilityLimits } from './capability.js';
import { mean as meanOf, median as medianOf } from '../core/utils.js';
import { sampleVariance, quantile, tQuantileTwoSided, robustFence } from './math.js';
import { pickExamples } from './examplePicks.js';
import { compareGroups, formatP, type GroupComparison } from './groupCompare.js';
import { dieTestVerdict, type TestPassKind } from './testPassRate.js';
import { pearsonOfPairs } from './correlation.js';
import { individualsLimits, westernElectric, CONTROL_RULE_TEXT, type ControlLimits, type ControlViolation } from './control.js';
import { buildCapabilityFigures } from './capability.js';
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
  /**
   * What the plot's items are, when they are not wafers: a selection and the rest of its wafer, say. The footnote then says
   * "24 dies · selection vs the rest of W07" rather than counting the two groups as wafers.
   */
  populationLabel?: string;
  /** @internal The dies a rescaling is measured over: a panel's values are scaled as the whole plot's are. */
  scaleDies?: readonly Die[];
  /** @internal The panels divide a set of tests by test, so neither X nor the colour has to. */
  facetByTest?: boolean;
  /** @internal Partial and edge-excluded dies are already left out (`resolveEligible`). */
  eligibleOnly?: boolean;
  /** @internal The plot's `where` is already applied: these are the dies it keeps. */
  whereApplied?: boolean;
  /** @internal A heatmap resolved as the bar of its two category levels, before it is laid out as a grid. */
  asHeatmap?: boolean;
  /** @internal Resolving one panel (or the whole) of a faceted plot: its facet is already applied. */
  inFacet?: boolean;
  /** @internal The wafers of the whole plot, when this is a panel of it: a followed colour is per wafer when the whole
   *  has several, though a panel may hold one. */
  wholeWafers?: number;
  /** @internal The whole population, when this is a panel of it: a binned field's ranges are cut over all of it. */
  wholeItems?: readonly PlotItem[];
  /** @internal The ranges a binned field was cut into, by field, so every panel shares them. */
  binEdges?: Map<string, number[]>;
}

export type FieldKind = 'numeric' | 'categorical';

/**
 * A test's limits: the tester's (`limitLow`/`limitHigh`), the specification's (`specLow`/`specHigh`), on a plot of one
 * wafer that wafer's PAT limits (`patLow`/`patHigh`), and proposed what-if limits (`whatIfLow`/`whatIfHigh`). Any may be absent.
 */
export interface TestLimits { limitLow?: number; limitHigh?: number; specLow?: number; specHigh?: number; patLow?: number; patHigh?: number; whatIfLow?: number; whatIfHigh?: number }

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
  /** For a pass rate judged by test limits: per die, −1 failed below the low limit, 1 above the high, 0 otherwise. */
  failSide?: Int8Array;
  /** Why this field cannot be used on this population. */
  issue?: string;
  /** For a set of tests: the test each row's value belongs to, by name, so a missing value is reported against its test. */
  labelOf?: (row: number) => string;
}

/** One test of a goal plot: `x` (mean − centre of the window) / window, `y` standard deviation / window, Ppk = (½ − |x|) / 3y. */
export interface GoalPoint { x: number; y: number; group: number; testNumber: number; label: string; ppk: number; n: number; basis: 'spec' | 'test' }

/** A line fitted to one colour's points: y = intercept + slope · x. `r2` is the squared Pearson correlation of the points. */
export interface PlotFit { group: number; slope: number; intercept: number; r2: number; n: number }

/**
 * The line through points `xs`, `ys`: least squares of y on x (`linear`), or the line closest to the points at right
 * angles (`orthogonal`, Deming regression with equal error variances), which does not tilt towards horizontal when x
 * is as noisy as y. Undefined with fewer than three points or no spread in x.
 */
export function fitLine(xs: readonly number[], ys: readonly number[], how: 'linear' | 'orthogonal'): Omit<PlotFit, 'group'> | undefined {
  const n = xs.length;
  if (n < 3) return undefined;
  let mx = 0, my = 0;
  for (let i = 0; i < n; i++) { mx += xs[i]; my += ys[i]; }
  mx /= n; my /= n;
  let sxx = 0, syy = 0, sxy = 0;
  for (let i = 0; i < n; i++) { const dx = xs[i] - mx, dy = ys[i] - my; sxx += dx * dx; syy += dy * dy; sxy += dx * dy; }
  if (!(sxx > 0)) return undefined;
  const r2 = syy > 0 ? (sxy * sxy) / (sxx * syy) : 1;
  const slope = how === 'linear' || sxy === 0 ? sxy / sxx
    : (syy - sxx + Math.sqrt((syy - sxx) ** 2 + 4 * sxy * sxy)) / (2 * sxy);
  return { slope, intercept: my - slope * mx, r2, n };
}

export interface PlotPoint { x: number; y: number; group: number; item: number; die?: Die; /** The colour field's value, when it is continuous. */ value?: number }

/** What one mark stands for: the wafer it is on, and the die when it is one die (not a wafer's aggregate). */
export interface PlotUnit { item: number; die?: Die }

/**
 * A bar of die pass rates or a yield per die: its cells' values are 100 (pass) and 0 (fail), and, judged by test limits,
 * `failSide[u]` is −1 for a unit that failed below the low limit, 1 above the high, 0 otherwise.
 */
export interface PassFailCells { failSide?: Int8Array }

export type PlotMarks =
  /** `fits`: a fitted line per colour, when the plot asks for one (`PlotSpec.fit`); `identity`: draw y = x. */
  | { type: 'scatter'; points: PlotPoint[]; fits?: PlotFit[]; identity?: true }
  /** `units[g][k]` is the unit behind `values[g][k]`, so a bar can say which dies (or wafers) it counts. */
  | { type: 'histogram'; values: number[][]; units: number[][]; unit: (u: number) => PlotUnit }
  /** Each group's values ascending, `units[g][k]` the unit behind `values[g][k]`; the k-th of n sits at `probabilityPosition(k, n)`. */
  | { type: 'probability'; values: number[][]; units: number[][]; unit: (u: number) => PlotUnit }
  /** `nest`, set when X has several levels: each category's value at each level, outer first, with the levels' names. */
  /**
   * `stack`: a bar's colours drawn one on another (`values` then the colours' counts or sums, or their shares in percent);
   * `cumulative`: each category's running share of the whole, in percent, for a pareto line.
   */
  | { type: 'box' | 'bar'; categories: string[]; cells: number[][][]; cellUnits: number[][][]; values: number[][]; categoryItems?: number[]; nest?: { levels: string[]; parts: string[][] }; stack?: 'stack' | 'percent'; cumulative?: number[]; unit: (u: number) => PlotUnit; passFail?: PassFailCells }
  /** An individuals chart: one value per wafer (`items[k]` is the wafer of `values[k]`) in X order, its limits and the points breaking a rule. */
  | { type: 'control'; xs: number[]; values: number[]; items: number[]; limits: ControlLimits; violations: ControlViolation[] }
  /**
   * A heatmap: `values[r][c]` the combined value of the cell at row r and column c (NaN where it holds nothing),
   * `cellUnits[r][c]` the units behind it.
   */
  | { type: 'heatmap'; rows: string[]; cols: string[]; values: number[][]; cellUnits: number[][][]; unit: (u: number) => PlotUnit }
  /** A goal plot: one point per test (and colour), its mean offset and spread as shares of its limit window. */
  | { type: 'goal'; points: GoalPoint[] }
  /** `band`: the spread round each value, per group and X, when the plot asks for one (`PlotSpec.spread`). */
  | { type: 'line'; xs: number[]; values: number[][]; counts: number[][]; cellUnits: number[][][]; band?: { lo: number[][]; hi: number[][] }; unit: (u: number) => PlotUnit };

/** `label` is the axis title WITHOUT its unit: the chart appends the unit, scaled to the ticks ("µA" for 0.000861 A). */
export interface ResolvedAxis {
  label: string; unit?: string; scale: 'linear' | 'log'; min?: number; max?: number; reverse?: boolean;
  /** The limits of the test this axis measures, when it measures one: the chart draws them as lines. */
  limits?: TestLimits;
  /** A panel of a faceted plot: the data range of every panel, so each panel's axis spans the same range. */
  extent?: [number, number];
  /** The axis's reference lines and bands as values: a median or mean worked out over what the whole plot draws. */
  references?: PlotValueReference[];
  /** The range a clipped axis (`PlotAxis.clip`) draws, over the whole plot's values, and how many lie outside it. */
  clip?: { lo: number; hi: number; outside: number };
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
  colorScale?: { label: string; unit?: string; lo: number; hi: number; /** Every value is a whole number (a count): shown without decimals. */ integer?: true };
  colorLabel?: string;
  /** Set when the colour is a hard or soft bin: each group takes that bin's colour on the maps (`BinColors`). */
  colorBins?: 'hard' | 'soft';
  /** Set when the colour is one of the X fields: the axis already names every colour, so no legend is needed. */
  colorRepeatsX?: true;
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
  /** A scatter's Pearson r over every point drawn (null when it is undefined: too few points, no spread) and n. */
  correlation?: { r: number | null; n: number };
  /** What `where` kept, in words ("only dies with Hard bin Bin 1"). */
  filterNote?: string;
  /** Dies left out because a yield does not judge them: partial dies and dies inside the edge exclusion. */
  leftOut?: { partial: number; edge: number };
  /** Each fitted line as an equation with its R² and n, one per colour. */
  fitNotes?: string[];
  /** The plotted test's pass rate under its own limits and under the proposed ones (`PlotSpec.whatIf`), over the dies it judges. */
  whatIf?: { lo?: number; hi?: number; judged: number; passNow: number; passThen: number; sentence: string };
  /** @internal The tests a set resolved to, and their labels, in order. */
  setTests?: { tests: number[]; labels: string[] };
  /** The scope: every wafer and die handed in. */
  population: { wafers: number; dies: number };
  /** From `PlotContext.populationLabel`: replaces the wafer count in the footnote. */
  populationLabel?: string;
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
export function fieldLabel(field: PlotField, testDefs?: readonly TestDef[], curation?: Record<string, FacetCuration>): string {
  if (isBinned(field)) return fieldLabel(field.binned, testDefs, curation);
  if (isTestSet(field)) return testSetLabel(field, testDefs);
  if ('passRate' in field) {
    const def = testDefs?.find(d => d.testNumber === field.passRate);
    return `${def?.name || field.name || `Test ${field.passRate}`} pass rate${field.judge === 'flag' ? ' (tester flag)' : ''}`;
  }
  if ('test' in field) {
    const def = testDefs?.find(d => d.testNumber === field.test);
    const name = def?.name || field.name || `Test ${field.test}`;
    // A functional test has no value to plot, only an outcome: the field is its verdict, and says so.
    return def !== undefined && !isParametricTest(def) ? `${name} (pass/fail)` : name;
  }
  if ('builtin' in field) return BUILTIN_LABEL[field.builtin] ?? String(field.builtin);
  // A wafer attribute by the one rule for its name (the host's label, the defaults, the key spelled out).
  return attributeLabel(field.meta, curation);
}

/**
 * The order a category field's values are listed in, wherever they are listed (colours, categories, panels): a wafer
 * keeps the population's order and a test the set's, PAT verdicts go from within to outside, numbers sort as numbers,
 * and anything else sorts naturally. One rule, so a field's values never come in two orders on one screen.
 */
function categoryOrder(field: PlotField, seen: readonly string[], numeric: boolean): string[] {
  // A binned field's ranges, lowest first: the order noted when it was resolved.
  if (isBinned(field)) { const o = BIN_ORDER.get(field); return o ? o.filter(n => seen.includes(n)) : [...seen].sort((a, b) => parseFloat(a) - parseFloat(b)); }
  if ('builtin' in field && (field.builtin === 'wafer' || field.builtin === 'test')) return [...seen];
  if ('builtin' in field && field.builtin === 'pat') return PAT_VERDICT_ORDER.filter(v => seen.includes(v));
  return orderValues(seen, numeric);
}

const orderValues = (seen: readonly string[], numeric: boolean): string[] =>
  numeric ? [...seen].sort((a, b) => (Number(a) || 0) - (Number(b) || 0)) : [...seen].sort(compareNatural);

/**
 * The order a wafer field's values (a split, a lot) are listed in: by number when every value is one, else naturally
 * (W2 before W10). A plot places and colours them in this order, and Insights' Group by lists its groups in it, so a
 * group has one colour on every card.
 */
export function orderFieldValues(values: readonly string[]): string[] {
  return orderValues(values, values.every(v => v === FACET_NONE_VALUE || PLAIN_NUMBER.test(v.trim())));
}

/** Whether a category column's values are numbers (a lot field of numbers, a die coordinate): they sort as numbers. */
const numericCategories = (c: FieldColumn): boolean => !!c.num && (c.kind === 'numeric' || 'meta' in c.field);

/** "a", "a and b", "a, b and c". */
/** A bin as a plot names it, as a category or a colour. */
const binLabel = (bin: number): string => `Bin ${bin}`;
/** The bin a category or colour named by `binLabel` stands for; `undefined` for any other label. */
export function binOfLabel(label: string): number | undefined {
  const m = /^Bin (-?\d+)$/.exec(label);
  return m ? Number(m[1]) : undefined;
}

const list = (a: readonly string[]) => (a.length < 2 ? a.join('') : `${a.slice(0, -1).join(', ')} and ${a[a.length - 1]}`);

/** The `pat` builtin: each die's PAT verdict. */
const isPatBuiltin = (f: PlotField | PlotColor | undefined): boolean => !!f && 'builtin' in f && f.builtin === 'pat';

/** The `test` builtin: the field that divides a set of tests into its tests. */
const isTestBuiltin = (f: PlotField | PlotColor | undefined): boolean => !!f && 'builtin' in f && f.builtin === 'test';

/** A set of tests by its members' names: up to three, then a count ("Vth, Idsat and Ioff", "12 tests"). */
function testSetLabel(set: PlotTestSet, testDefs?: readonly TestDef[]): string {
  const { tests } = expandTestSet(set, testDefs ?? []);
  const nameOf = (tn: number) => testDefs?.find(d => d.testNumber === tn)?.name || set.names?.[String(tn)] || `Test ${tn}`;
  if (set.passRate) return set.judge === 'flag' ? 'Pass rate (tester flag)' : 'Pass rate';
  if (tests.length === 0) return set.tests.length === 1 ? `Tests ${set.tests[0]}` : `${set.tests.length} test entries`;
  return tests.length > 3 ? `${tests.length} tests` : list(tests.map(nameOf));
}

/**
 * How a pass rate judges a die of `def`: a functional test by its recorded verdict, a parametric one by its test limits
 * or (`judge: 'flag'`) by the tester's recorded flag. The Overview pass-rate card's three modes, as one rule.
 */
export function passKindOf(def: TestDef, judge: PlotJudge | undefined): TestPassKind {
  if (!isParametricTest(def)) return 'functional';
  return judge === 'flag' ? 'testFlag' : 'spec';
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

/**
 * The edges between a binned field's ranges, ascending, interior only (`bins - 1` of them at most; fewer where values
 * repeat so that two ranges would hold the same cut). `count`: each range holds about the same number of values;
 * `width`: each spans the same width between the smallest and largest.
 */
export function binEdges(values: ArrayLike<number>, bins: number, by: 'count' | 'width'): number[] {
  const v = Array.from(values).filter(Number.isFinite).sort((a, b) => a - b);
  if (v.length === 0) return [];
  const lo = v[0], hi = v[v.length - 1];
  const raw: number[] = [];
  for (let k = 1; k < bins; k++) raw.push(by === 'width' ? lo + ((hi - lo) * k) / bins : quantile(v, k / bins));
  // An edge at either end, or equal to the one before it, makes an empty range.
  return raw.filter((e, i) => e > lo && e <= hi && (i === 0 || e > raw[i - 1]));
}

/** The range of `edges` a value falls in (0 is below the first edge). A value on an edge belongs to the range above it. */
const binIndex = (v: number, edges: readonly number[]): number => {
  let lo = 0, hi = edges.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (v >= edges[mid]) lo = mid + 1; else hi = mid; }
  return lo;
};

/**
 * The ranges' names in order, "7.16 pA to 19.4 pA": the low edge first, in the field's unit with its SI prefix (a
 * percentage as "15.7%"), to three significant figures, or more only where two neighbouring edges would read alike. A
 * computed edge is not a stored value (0.5238499999999999), so it is rounded to what tells the ranges apart.
 */
function binLabels(edges: readonly number[], lo: number, hi: number, unit: string | undefined): string[] {
  const bounds = [lo, ...edges, hi];
  const distinct = (t: readonly string[]) => t.every((x, i) => i === 0 || x !== t[i - 1]);
  let text = unit ? bounds.map(b => fmt(b, unit)) : [];
  if (!distinct(text) || text.length === 0) {
    const tail = unit === '%' ? '%' : unit ? ` ${unit}` : '';
    for (let p = 3; p <= 15; p++) {
      text = bounds.map(b => `${Number(b.toPrecision(p))}${tail}`);
      if (distinct(text)) break;
    }
  }
  return bounds.slice(0, -1).map((_, i) => `${text[i]} to ${text[i + 1]}`);
}

/** The order of each binned field's range names, lowest range first, noted as the field is resolved (names sort as text, not as ranges). */
const BIN_ORDER = new WeakMap<object, string[]>();

/** A measured value or a number, cut into ranges that are categories: edges set over the whole population plotted. */
function resolveBinned(field: PlotBinnedField, r: Resolver, base: { field: PlotField; label: string }): FieldColumn {
  const { ctx } = r;
  const inner = resolveField(field.binned, r);
  const label = inner.label;   // the unit is in the range names
  if (inner.issue) return { ...inner, ...base, label, kind: 'categorical', num: undefined, issue: inner.issue };
  if (!inner.num) return { ...inner, ...base, label, kind: 'categorical', issue: `${inner.label} is already a category: only a measured value or a number can be put into ranges` };
  const bins = field.bins ?? PLOT_BINS_DEFAULT, by = field.by ?? 'count';
  // Edges over the whole population, so panels and colours share them; a panel resolves its own part only to place its values.
  const key = `${JSON.stringify(field)}`;
  let edges = ctx.binEdges?.get(key);
  let whole = inner.num;
  if (!edges) {
    if (ctx.wholeItems && ctx.wholeItems !== r.items) {
      const w = resolveField(field.binned, { items: ctx.wholeItems, rows: flatten(ctx.wholeItems), ctx: { ...ctx, wholeItems: undefined } });
      if (w.num) whole = w.num;
    }
    edges = binEdges(whole, bins, by);
    ctx.binEdges?.set(key, edges);
  }
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < whole.length; i++) { const v = whole[i]; if (Number.isFinite(v)) { if (v < lo) lo = v; if (v > hi) hi = v; } }
  if (lo === Infinity) return { ...inner, ...base, label, kind: 'categorical', num: undefined, issue: `${inner.label} has no values to put into ranges` };
  const names = binLabels(edges, lo, hi, inner.unit);
  BIN_ORDER.set(field, names);
  const cat = Array.from(inner.num, v => (Number.isFinite(v) ? names[binIndex(v, edges!)] : undefined));
  return { ...base, label, unit: undefined, level: inner.level, kind: 'categorical', cat };
}

/**
 * A pass rate's columns from each die's verdict: 100 for a pass and 0 for a fail (so a mean over any dies is their pass
 * rate), a weight of 1 per judged die, and the side a die failed its limits on.
 */
function judgeDies(n: number, verdictOf: (i: number) => ReturnType<typeof dieTestVerdict>): { num: Float64Array; weights: Float64Array; failSide: Int8Array } {
  const num = new Float64Array(n), weights = new Float64Array(n), failSide = new Int8Array(n);
  for (let i = 0; i < n; i++) {
    const v = verdictOf(i);
    num[i] = v === undefined ? NaN : v === 'pass' ? 100 : 0;
    weights[i] = v === undefined ? 0 : 1;
    failSide[i] = v === 'failLow' ? -1 : v === 'failHigh' ? 1 : 0;
  }
  return { num, weights, failSide };
}

function resolveField(field: PlotField, r: Resolver): FieldColumn {
  const { items, rows, ctx } = r;
  const label = fieldLabel(field, ctx.testDefs, ctx.curation);
  const base = { field, label };
  const nDie = rows.dies.length, nWafer = items.length;

  if (isBinned(field)) return resolveBinned(field, r, base);

  if (isTestSet(field)) {
    const m = r.melt;
    if (!m) return { ...base, level: 'die', kind: 'numeric', issue: 'A set of tests can only be the values of a box, bar, line or histogram' };
    if (field.passRate) {
      // Each die 100 or 0 for the test its row is read for, as a single test's pass rate is: pooled per category.
      const defs = m.tests.map(tn => ctx.testDefs?.find(d => d.testNumber === tn)!);
      const { num, weights, failSide } = judgeDies(nDie, i => { const def = defs[m.testOf[rows.item[i]]]; return dieTestVerdict(rows.dies[i], def, passKindOf(def, field.judge)); });
      return { ...base, level: 'die', kind: 'numeric', unit: '%', num, weights, failSide, perDie: true, labelOf: item => m.labels[m.testOf[item]] };
    }
    const num = new Float64Array(nDie);
    for (let i = 0; i < nDie; i++) num[i] = testValue(rows.dies[i], m.tests[m.testOf[rows.item[i]]]) ?? NaN;
    const units = new Set(m.tests.map(tn => ctx.testDefs?.find(d => d.testNumber === tn)?.unit).filter((u): u is string => !!u));
    return { ...base, level: 'die', kind: 'numeric', unit: units.size === 1 ? [...units][0] : undefined, num, labelOf: item => m.labels[m.testOf[item]] };
  }

  if ('passRate' in field) {
    // 100 for a die that passes the test, 0 for one that fails, missing where it cannot be judged: the mean over any set
    // of dies is their pass rate, by the rule the Overview's test pass-rate card uses.
    const tn = field.passRate;
    const def = ctx.testDefs?.find(d => d.testNumber === tn);
    if (!def) return { ...base, level: 'die', kind: 'numeric', issue: `Needs test ${tn}${field.name ? ` (${field.name})` : ''}, which is not in these dies` };
    if (field.name && def.name && !sameTestName(field.name, def.name)) return { ...base, level: 'die', kind: 'numeric', issue: `Test ${tn} is "${field.name}" in this plot and "${def.name}" here` };
    const kind = passKindOf(def, field.judge);
    if (kind === 'spec' && def.limitLow === undefined && def.limitHigh === undefined) return { ...base, level: 'die', kind: 'numeric', issue: `${def.name || `Test ${tn}`} has no test limits to judge a pass by` };
    const { num, weights, failSide } = judgeDies(nDie, i => dieTestVerdict(rows.dies[i], def, kind));
    return { ...base, level: 'die', kind: 'numeric', unit: '%', num, weights, failSide, perDie: true };
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
      return { ...base, level: 'wafer', kind: 'categorical', cat, issue: `No wafer has a "${label}" value` };
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
      const cat = rows.dies.map(d => { const b = field.builtin === 'hbin' ? d.hbin : d.sbin; return b === undefined ? undefined : binLabel(b); });
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

/** A way of combining values as a sentence names it: "a maximum", "a pooled yield". */
const AGG_NOUN: Record<PlotAggregate, string> = { mean: 'a mean', median: 'a median', min: 'a minimum', max: 'a maximum', sum: 'a sum', count: 'a count', yield: 'a pooled yield' };

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
  const x = levels.length ? (named.length ? list(named.map(f => fieldLabel(f, ctx.testDefs, ctx.curation))) : undefined) : (mark === 'box' || mark === 'bar') && !isTestSet(enc.y) ? 'Wafer' : undefined;
  const y = enc.y ? fieldLabel(enc.y, ctx.testDefs, ctx.curation) : undefined;
  if ((mark === 'box' || mark === 'bar') && y && !x) return y;
  switch (mark) {
    case 'scatter': return x && y ? `${y} vs ${x}` : 'Scatter';
    case 'histogram': { const v = y ?? (levels[0] ? fieldLabel(levels[0], ctx.testDefs, ctx.curation) : undefined); return v ?? 'Histogram'; }
    case 'probability': return y ? `${y}, cumulative` : 'Probability plot';
    case 'control': return y ? `${y} control chart` : 'Control chart';
    case 'goal': return 'Capability goal plot';
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
    case 'line': vs = role === 'x' ? m.xs : [...m.values.flat(), ...(m.band ? [...m.band.lo.flat(), ...m.band.hi.flat()] : [])]; break;
    case 'control': vs = role === 'x' ? m.xs : [...m.values, m.limits.ucl, m.limits.lcl]; break;
    case 'goal': vs = m.points.map(p => (role === 'x' ? p.x : p.y)); break;
    case 'heatmap': vs = []; break;
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
  const gmap = r.groups.map(label => whole.groups.indexOf(label));
  if (gmap.some(g => g < 0)) return r;
  const marks = mapMarks(r.marks, index, gmap, whole.groups.length);
  const wx = whole.marks && markExtent(whole.marks, 'x'), wy = whole.marks && markExtent(whole.marks, 'y');
  return {
    ...r, marks, groups: whole.groups, colorScale: whole.colorScale ?? r.colorScale,
    x: r.x && wx ? { ...r.x, extent: wx } : r.x,
    y: r.y && wy ? { ...r.y, extent: wy } : r.y,
  };
}

/**
 * A plot resolved over part of the population (`items[k]` of the part is wafer `index[k]` of the whole), its units set
 * back on the whole's wafer indices: the one remapping a panel and a filtered plot both need.
 */
function remapUnits(r: ResolvedPlot, index: readonly number[]): ResolvedPlot {
  if (r.issues.length || !r.marks) return r;
  return { ...r, marks: mapMarks(r.marks, index, r.groups.map((_, g) => g), r.groups.length) };
}

/** `m` with each unit's wafer through `index`, and group arrays laid out on `G` colours through `gmap` (empty where none). */
function mapMarks(m: PlotMarks, index: readonly number[], gmap: readonly number[], G: number): PlotMarks {
  const widen = <T>(arr: readonly T[], empty: () => T): T[] => { const out = Array.from({ length: G }, empty); arr.forEach((v, l) => { out[gmap[l]] = v; }); return out; };
  const item = (k: number) => index[k];
  const unitOf = (unit: (u: number) => PlotUnit) => (u: number): PlotUnit => { const x = unit(u); return { ...x, item: item(x.item) }; };
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
      ...(m.band ? { band: { lo: widen(m.band.lo, () => m.xs.map(() => NaN)), hi: widen(m.band.hi, () => m.xs.map(() => NaN)) } } : {}),
    }; break;
    case 'control': marks = { ...m, items: m.items.map(item) }; break;
    case 'goal': marks = { type: 'goal', points: m.points.map(p => ({ ...p, group: gmap[p.group] })) }; break;
    case 'heatmap': marks = { ...m, unit: unitOf(m.unit) }; break;
  }
  return marks;
}

/**
 * A plot with `where`: only the dies (or, for a wafer field, the wafers) whose value of the field is one of `values`,
 * resolved as any plot is, its units on the population's wafer indices and its statement saying what was kept. PAT
 * limits stay the whole wafer's.
 */
/**
 * A plot reads only the dies a yield judges: a partial die, or one inside the edge exclusion, is left out
 * (`isYieldEligibleDie`), as every Insights card leaves it out, and the footnote counts them. Each wafer keeps its place
 * with the dies it has left, and its whole die list for PAT, whose limits are the wafer's own.
 */
function resolveEligible(spec: PlotSpec, items: readonly PlotItem[], ctx: PlotContext): ResolvedPlot {
  let partial = 0, edge = 0;
  const sub = items.map(it => {
    let kept: Die[] | undefined;
    for (let k = 0; k < it.dies.length; k++) {
      const d = it.dies[k];
      if (isYieldEligibleDie(d)) { kept?.push(d); continue; }
      kept ??= it.dies.slice(0, k);
      if (d.partial) partial++; else edge++;
    }
    return kept ? { ...it, dies: kept, allDies: it.allDies ?? it.dies } : it;
  });
  const r = withReferences(resolvePlot(spec, sub, { ...ctx, eligibleOnly: true }));
  return partial + edge > 0 ? { ...r, leftOut: { partial, edge } } : r;
}

/** The values a resolved plot draws along one axis (`markValues`): what a host compares its limits against. */
export const axisValues = (r: ResolvedPlot, role: 'x' | 'y'): number[] => (r.marks ? markValues(r.marks, role).filter(Number.isFinite) : []);

/** The values a plot draws along one axis: bar heights, points, the values in boxes, a histogram's values. */
function markValues(m: PlotMarks, role: 'x' | 'y'): number[] {
  switch (m.type) {
    case 'bar': return role === 'y' ? m.values.flat() : [];
    case 'box': return role === 'y' ? m.cells.flat(2) : [];
    case 'scatter': return m.points.map(p => (role === 'x' ? p.x : p.y));
    case 'line': return role === 'y' ? m.values.flat() : m.xs;
    case 'control': return role === 'y' ? m.values : m.xs;
    case 'histogram': case 'probability': return role === 'x' ? m.values.flat() : [];
    default: return [];
  }
}

/**
 * Each axis's reference lines as values: a typed value as it is, a median or mean worked out over what the whole plot
 * draws on that axis, so every panel shows the same line. One that has nothing to be worked out over is named.
 */
function withReferences(r: ResolvedPlot): ResolvedPlot {
  const notes: string[] = [];
  const resolveAxis = (role: 'x' | 'y'): PlotValueReference[] | undefined => {
    const refs = r.spec.axes?.[role]?.references;
    if (!refs?.length || !r[role]) return undefined;
    let values: number[] | undefined;
    return refs.flatMap((ref): PlotValueReference[] => {
      if (!isStatReference(ref)) return [ref];
      values ??= r.marks ? markValues(r.marks, role).filter(Number.isFinite) : [];
      if (values.length === 0) { notes.push(`No ${ref.stat} line: nothing is drawn along that axis`); return []; }
      return [{ at: ref.stat === 'median' ? medianOf(values) : meanOf(values), label: ref.label ?? ref.stat }];
    });
  };
  // A clipped axis: the robust fence over every value drawn along it, never wider than the values themselves.
  const clipAxis = (role: 'x' | 'y'): ResolvedAxis['clip'] => {
    if (!r.spec.axes?.[role]?.clip || !r[role] || !r.marks) return undefined;
    const values = markValues(r.marks, role).filter(Number.isFinite);
    const fence = robustFence(values);
    if (!fence || values.length === 0) return undefined;
    const lo = Math.max(minOf(values), fence.lo), hi = Math.min(maxOf(values), fence.hi);
    if (!(hi > lo)) return undefined;
    const outside = values.reduce((n, v) => n + (v < lo || v > hi ? 1 : 0), 0);
    return { lo, hi, outside };
  };
  const x = resolveAxis('x'), y = resolveAxis('y');
  const cx = clipAxis('x'), cy = clipAxis('y');
  if (!x && !y && !cx && !cy) return r;
  const one = (a: ResolvedAxis | undefined, refs: PlotValueReference[] | undefined, clip: ResolvedAxis['clip']) =>
    a && (refs || clip) ? { ...a, ...(refs ? { references: refs } : {}), ...(clip ? { clip } : {}) } : a;
  const axes = <T extends ResolvedPlot>(p: T): T => ({ ...p, x: one(p.x, x, cx), y: one(p.y, y, cy) });
  const out = axes(r);
  if (out.facets) out.facets = out.facets.map(f => ({ ...f, plot: axes(f.plot) }));
  for (const c of [cx, cy]) if (c?.outside) notes.push(`Axis clipped to the robust range: ${c.outside.toLocaleString('en-GB')} value${c.outside === 1 ? '' : 's'} outside it, still counted in every statistic`);
  return notes.length ? { ...out, notes: [...out.notes, ...notes] } : out;
}

/** The unit a condition's numbers are in, for stating its range: a test's own, or a percentage. */
export function conditionUnit(field: PlotField, testDefs?: readonly TestDef[]): string | undefined {
  if (isField(field) && 'test' in field) return testDefs?.find(d => d.testNumber === field.test)?.unit;
  if (isField(field) && 'builtin' in field && (field.builtin === 'yield' || field.builtin === 'radius')) return '%';
  return undefined;
}

/** A number the reader typed into a condition, as typed: in the unit with its prefix (0.4 V as 400 mV), a share as 90%. */
const conditionNumber = (v: number, unit: string | undefined): string => {
  const typed = String(Number(v.toPrecision(6)));
  return unit === '%' ? `${typed}%` : unit ? fmt(v, unit) : typed;
};

/**
 * One condition in words, as the card footnote, the filter band and the editor's summary state it: "Ring is Edge or
 * Middle", "Hard bin is not Bin 1", "Vth from 0.4 V to 0.6 V", "Yield below 90%".
 */
export function conditionText(c: PlotCondition, testDefs?: readonly TestDef[], curation?: Record<string, FacetCuration>): string {
  const label = fieldLabel(c.field, testDefs, curation);
  if (c.values) {
    const or = c.values.length < 2 ? c.values.join('') : `${c.values.slice(0, -1).join(', ')} or ${c.values[c.values.length - 1]}`;
    return `${label} is ${c.not ? 'not ' : ''}${or}`;
  }
  const unit = conditionUnit(c.field, testDefs);
  const lo = c.min !== undefined ? conditionNumber(c.min, unit) : undefined;
  const hi = c.max !== undefined ? conditionNumber(c.max, unit) : undefined;
  if (lo !== undefined && hi !== undefined) return `${label} ${c.not ? 'outside' : 'from'} ${lo} to ${hi}`;
  if (lo !== undefined) return `${label} ${c.not ? 'below' : 'at least'} ${lo}`;
  return `${label} ${c.not ? 'above' : 'at most'} ${hi}`;
}

/** What `applyConditions` kept: the items (each with only its kept dies), their places in the input, and counts. */
export interface ConditionsApplied {
  items: PlotItem[];
  /** For each kept item, its index in the items given. */
  index: number[];
  /** The kept dies over all dies, and the kept wafers over all wafers. */
  dies: { kept: number; total: number };
  wafers: { kept: number; total: number };
  /** The filter in words: "only wafers where Split is A; only dies where Ring is Edge". Empty with no conditions. */
  said: string;
  /** Why the conditions cannot be applied (a field the lot lacks, a range on a category); nothing is filtered then. */
  issue?: string;
}

/**
 * Keep the wafers and dies that meet every condition: the one filter rule, for a plot's own filter and the Insights
 * population filter alike. Every condition is judged on the population as given, so a wafer condition (yield below
 * 90%) reads the whole wafer, and die conditions then keep dies inside the wafers kept. A unit with no value for a
 * condition's field meets no condition, negated or not. A kept wafer keeps `allDies` (its whole wafer), so a PAT
 * verdict or a whole-wafer figure is still judged on all of it.
 */
export function applyConditions(conditions: readonly PlotCondition[], items: readonly PlotItem[], ctx: PlotContext = {}): ConditionsApplied {
  const rows = flatten(items);
  const totalDies = rows.dies.length;
  const none: ConditionsApplied = {
    items: [...items], index: items.map((_, i) => i), said: '',
    dies: { kept: totalDies, total: totalDies }, wafers: { kept: items.length, total: items.length },
  };
  if (conditions.length === 0) return none;
  const waferOk = new Uint8Array(items.length).fill(1), dieOk = new Uint8Array(totalDies).fill(1);
  const waferSaid: string[] = [], dieSaid: string[] = [];
  for (const c of conditions) {
    const col = resolveField(c.field, { items, rows, ctx });
    if (col.issue) return { ...none, issue: col.issue };
    let meets: (i: number) => boolean;
    if (c.values) {
      if (!col.cat) return { ...none, issue: `${col.label} is a number: keep a range of it, not values` };
      const keep = new Set(c.values), cat = col.cat;
      meets = i => cat[i] !== undefined && keep.has(cat[i]!) !== !!c.not;
    } else {
      if (!col.num) return { ...none, issue: `${col.label} is a category: keep some of its values, not a range` };
      const num = col.num, lo = c.min ?? -Infinity, hi = c.max ?? Infinity;
      meets = i => Number.isFinite(num[i]) && (num[i] >= lo && num[i] <= hi) !== !!c.not;
    }
    const target = col.level === 'wafer' ? waferOk : dieOk;
    for (let i = 0; i < target.length; i++) if (target[i] && !meets(i)) target[i] = 0;
    (col.level === 'wafer' ? waferSaid : dieSaid).push(conditionText(c, ctx.testDefs, ctx.curation));
  }
  const kept = items.map(() => [] as Die[]);
  let keptDies = 0;
  for (let i = 0; i < totalDies; i++) if (dieOk[i] && waferOk[rows.item[i]]) { kept[rows.item[i]].push(rows.dies[i]); keptDies++; }
  const out: PlotItem[] = [], index: number[] = [];
  items.forEach((it, i) => {
    if (!waferOk[i]) return;
    // A wafer kept by wafer conditions alone is kept whole; die conditions keep the wafers that still have dies.
    if (dieSaid.length === 0) { out.push(it); index.push(i); return; }
    if (kept[i].length) { out.push({ ...it, dies: kept[i], allDies: it.allDies ?? it.dies }); index.push(i); }
  });
  const said = [waferSaid.length ? `only wafers where ${list(waferSaid)}` : '', dieSaid.length ? `only dies where ${list(dieSaid)}` : '']
    .filter(Boolean).join('; ');
  return { items: out, index, said, dies: { kept: keptDies, total: totalDies }, wafers: { kept: out.length, total: items.length } };
}

function resolveFiltered(spec: PlotSpec, items: readonly PlotItem[], ctx: PlotContext): ResolvedPlot {
  const fail = (...issues: string[]) => emptyResult(spec, items, issues, ctx);
  const f = applyConditions(plotConditions(spec), items, ctx);
  if (f.issue) return fail(f.issue);
  if (f.items.length === 0) return fail(`Nothing is left: no ${f.said.replace(/^only /, '').replace(/; only /, ' and ')}`);
  const r = remapUnits(resolvePlot(spec, f.items, { ...ctx, whereApplied: true }), f.index);
  return { ...r, filterNote: f.said };
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
  const label = fieldLabel(facetField, ctx.testDefs, ctx.curation);
  const allDies = items.flatMap(it => it.dies);
  const inner: PlotContext = { ...ctx, inFacet: true, scaleDies: ctx.scaleDies ?? allDies, wholeWafers: ctx.wholeWafers ?? items.length, wholeItems: ctx.wholeItems ?? items, binEdges: ctx.binEdges ?? new Map() };
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

// ── heatmap ──────────────────────────────────────────────────────────────────────────────────────────────

/**
 * A heatmap: one cell per row and column, coloured by the value combined there. It is the bar chart of its two
 * category fields nested (rows outside, columns inside) laid out as a grid, so every rule a bar has holds here: a set
 * of tests with Test as the rows, rescaling, pass rates, pooled yield, a count of dies when there is no Y, the die
 * filter. The colour key spans the cells' values.
 */
function resolveHeatmap(spec: PlotSpec, items: readonly PlotItem[], ctx: PlotContext): ResolvedPlot {
  const enc = spec.fields ?? {};
  const fail = (...issues: string[]) => emptyResult(spec, items, issues, ctx);
  const cols = xFieldsOf(enc.x)[0] ?? { builtin: 'wafer' };
  const rows: PlotField | undefined = enc.rows ?? (isTestSet(enc.y) ? { builtin: 'test' } : undefined);
  if (!rows) return fail('Choose a field for the rows: a heatmap has one row per value of it');
  if (sameField(rows, cols)) return fail('The rows and the columns need two different fields');
  const { rows: _rows, ...rest } = enc;
  const bar: PlotSpec = { ...spec, chart: 'bar', fields: { ...rest, x: [rows, cols], color: { none: true } } };
  delete bar.stack; delete bar.sort; delete bar.top; delete bar.cumulative;
  const r = resolvePlot(bar, items, { ...ctx, asHeatmap: true, inFacet: true, whereApplied: ctx.whereApplied });
  if (r.issues.length || !r.marks || r.marks.type !== 'bar') return { ...r, spec };
  const m = r.marks;
  const parts = m.nest?.parts ?? [];
  // Rows come in their field's order already (the outer level); the columns are put in theirs by the one ordering rule,
  // since no single row need hold every column.
  const rowKeys = [...new Set(parts.map(p => p[0]))];
  const colKeys = [...new Set(parts.map(p => p[1]))];
  const colsSorted = categoryOrder(cols, colKeys, colKeys.every(k => PLAIN_NUMBER.test(k)));
  const values = rowKeys.map(() => colsSorted.map(() => NaN));
  const cellUnits = rowKeys.map(() => colsSorted.map(() => [] as number[]));
  parts.forEach((p, c) => {
    const ri = rowKeys.indexOf(p[0]), ci = colsSorted.indexOf(p[1]);
    values[ri][ci] = m.values[0][c];
    cellUnits[ri][ci] = m.cellUnits[0][c];
  });
  const finite = values.flat().filter(Number.isFinite);
  const rowLabel = fieldLabel(rows, ctx.testDefs, ctx.curation), colLabel = fieldLabel(cols, ctx.testDefs, ctx.curation);
  return {
    ...r, spec,
    marks: { type: 'heatmap', rows: rowKeys, cols: colsSorted, values, cellUnits, unit: m.unit },
    autoTitle: `${r.y?.label ?? 'Dies'} by ${rowLabel} and ${colLabel}`,
    x: { label: spec.axes?.x?.label ?? colLabel, scale: 'linear' },
    y: { label: spec.axes?.y?.label ?? rowLabel, scale: 'linear' },
    colorScale: finite.length ? { label: r.y?.label ?? 'Count', unit: r.y?.unit, lo: minOf(finite), hi: maxOf(finite), ...(finite.every(Number.isInteger) ? { integer: true as const } : {}) } : undefined,
    groups: [''],
  };
}

// ── control chart and goal plot ──────────────────────────────────────────────────────────────────────────

/**
 * An individuals chart: each wafer's value of Y (a test's wafer mean, or another way of combining by `aggregate`; a
 * yield or pass rate as the wafer's own), in order of a wafer field (wafer order unless X says otherwise), with the
 * centre and ±3σ limits of `stats/control.ts` and the Western Electric rules. One series: a colour is not drawn.
 */
function resolveControl(spec: PlotSpec, items: readonly PlotItem[], ctx: PlotContext): ResolvedPlot {
  const fail = (...issues: string[]) => emptyResult(spec, items, issues, ctx);
  const enc = spec.fields ?? {};
  if (!enc.y) return fail('Choose a field for the values');
  if (isTestSet(enc.y)) return fail('A control chart follows one value: choose one test');
  const xField: PlotField = (xFieldsOf(enc.x)[0]) ?? { builtin: 'waferOrder' };
  const rows = flatten(items);
  const r: Resolver = { items, rows, ctx };
  const xCol = resolveField(xField, r), yCol = resolveField(enc.y, r);
  const issue = xCol.issue ?? yCol.issue;
  if (issue) return fail(issue);
  if (xCol.level !== 'wafer' || !xCol.num) return fail(`A control chart runs along a wafer field with a number per wafer, such as wafer order or slot, not ${xCol.label}`);
  if (!yCol.num) return fail(`${yCol.label} is a category, not a number, so it cannot be charted`);
  // One value per wafer: a wafer field as it is, a die field combined over the wafer's dies.
  const how: PlotAggregate = spec.aggregate && spec.aggregate !== 'yield' && spec.aggregate !== 'count' ? spec.aggregate : 'mean';
  const per: number[][] = items.map(() => []);
  if (yCol.level === 'die') for (let i = 0; i < rows.dies.length; i++) per[rows.item[i]].push(yCol.num[i]);
  const valueOf = (i: number) => (yCol.level === 'wafer' ? yCol.num![i] : combine(per[i], yCol.perDie ? 'mean' : how));
  const order = items.map((_, i) => i).filter(i => Number.isFinite(xCol.num![i]) && Number.isFinite(valueOf(i)))
    .sort((a, b) => xCol.num![a] - xCol.num![b] || a - b);
  const omitted = items.length - order.length;
  if (order.length < 3) return fail('A control chart needs at least three wafers with a value');
  const values = order.map(valueOf), xs = order.map(i => xCol.num![i]);
  const limits = individualsLimits(values, spec.baseline)!;
  const violations = westernElectric(values, limits);
  const label = yCol.perDie || yCol.level === 'wafer' ? yCol.label : `${AGG_WORD[how]} ${yCol.label}`;
  const notes: string[] = [];
  if (enc.color && !('none' in enc.color) && !('follow' in enc.color)) notes.push('A control chart is one series: its points are not coloured');
  const ruled = violations.length
    ? `${violations.length} point${violations.length === 1 ? '' : 's'} break${violations.length === 1 ? 's' : ''} a Western Electric rule (${[...new Set(violations.flatMap(v => v.rules))].sort().map(n => `${n}: ${CONTROL_RULE_TEXT[n]}`).join('; ')})`
    : 'no point breaks a Western Electric rule';
  return {
    spec, issues: [], notes, level: 'wafer',
    marks: { type: 'control', xs, values, items: order, limits, violations },
    autoTitle: `${label} control chart`,
    x: axisFor('x', xCol.label, xCol.unit, spec, xs, notes),
    y: { ...axisFor('y', label, yCol.unit, spec, values, notes), limits: !yCol.perDie && yCol.level === 'die' && (how === 'mean' || how === 'median') ? yCol.limits : undefined },
    groups: [''],
    aggregation: `individuals chart: centre the mean of ${limits.baseline === values.length ? 'all' : `the first ${limits.baseline}`} wafers, limits ±3σ with σ the average moving range / 1.128; ${ruled}`,
    population: { wafers: items.length, dies: rows.dies.length },
    plotted: values.length,
    omitted: omitted ? [{ field: yCol.label, count: omitted }] : [],
  };
}

/**
 * A capability goal plot: each test with both limits (the set on Y, or every one), and each colour group, as its mean's
 * offset from the centre of its limit window and its overall standard deviation, both as shares of the window. A test
 * on the left or right is off-centre; one high up is too wide. Ppk = (½ − |x|) / (3y), so a line of equal Ppk is a
 * triangle, drawn by the chart for Ppk 1 and 1.33.
 */
function resolveGoal(spec: PlotSpec, items: readonly PlotItem[], ctx: PlotContext): ResolvedPlot {
  const fail = (...issues: string[]) => emptyResult(spec, items, issues, ctx);
  const defs = ctx.testDefs ?? [];
  const enc = spec.fields ?? {};
  let tests: TestDef[];
  if (!enc.y) tests = defs.filter(isParametricTest);
  else if (isTestSet(enc.y)) { const want = new Set(expandTestSet(enc.y, defs).tests); tests = defs.filter(d => want.has(d.testNumber)); }
  else if ('test' in enc.y) tests = defs.filter(d => d.testNumber === (enc.y as { test: number }).test);
  else return fail('A goal plot shows tests: choose tests, or leave the values empty for every test with both limits');
  tests = tests.filter(d => isParametricTest(d) && capabilityLimits(d) !== undefined);
  if (tests.length === 0) return fail('No test here has both a low and a high limit to set a goal by');
  // The colour divides the dies into groups, each a capability of its own; a followed colour is the Group by, never a wafer each.
  const rows = flatten(items);
  const r: Resolver = { items, rows, ctx };
  const c = enc.color;
  const colorField: PlotField | undefined = c === undefined || 'follow' in c ? (ctx.groupBy ? { meta: ctx.groupBy } : undefined) : 'none' in c ? undefined : c;
  let groups = [''];
  let groupOf: (i: number) => number = () => 0;
  if (colorField) {
    const col = resolveField(colorField, r);
    if (col.issue) return fail(col.issue);
    if (!col.cat) return fail(`${col.label} is continuous: colour a goal plot by a category such as split`);
    const at = (i: number) => (col.level === 'die' ? col.cat![i] : col.cat![rows.item[i]]);
    const seen: string[] = [];
    for (let i = 0; i < rows.dies.length; i++) { const v = at(i); if (v !== undefined && !seen.includes(v)) seen.push(v); }
    groups = categoryOrder(colorField, seen, numericCategories(col));
    groupOf = i => { const v = at(i); return v === undefined ? -1 : groups.indexOf(v); };
  }
  const byGroup: Die[][] = groups.map(() => []);
  for (let i = 0; i < rows.dies.length; i++) { const g = groupOf(i); if (g >= 0) byGroup[g].push(rows.dies[i]); }
  const points: GoalPoint[] = [];
  byGroup.forEach((dies, g) => {
    for (const f of buildCapabilityFigures([{ dies }], tests)) {
      if (!f.hasSpec || f.lsl === undefined || f.usl === undefined || !(f.stdOverall > 0) || f.ppk === null) continue;
      const w = f.usl - f.lsl;
      points.push({ x: (f.mean - (f.lsl + f.usl) / 2) / w, y: f.stdOverall / w, group: g, testNumber: f.testNumber, label: f.label, ppk: f.ppk, n: f.n, basis: f.limitBasis ?? 'test' });
    }
  });
  if (points.length === 0) return fail('No test has values with a spread to place');
  const notes: string[] = [];
  return {
    spec, issues: [], notes, level: 'die',
    marks: { type: 'goal', points },
    autoTitle: colorField ? `Capability goal plot · by ${fieldLabel(colorField, defs, ctx.curation)}` : 'Capability goal plot',
    x: axisFor('x', 'Mean offset from the centre of the limits', undefined, spec, points.map(p => p.x), notes),
    y: axisFor('y', 'Standard deviation', undefined, spec, points.map(p => p.y), notes),
    groups, colorLabel: colorField ? fieldLabel(colorField, defs, ctx.curation) : undefined,
    aggregation: `each test's mean offset and standard deviation over its dies, as shares of its limit window (spec limits where it has both, else test limits); triangles: Ppk 1 and 1.33`,
    population: { wafers: items.length, dies: rows.dies.length },
    plotted: points.length,
    omitted: [],
  };
}

/** Resolves `spec` over `items`. Never throws for a plot that cannot be drawn: it returns the reasons. */
export function resolvePlot(spec: PlotSpec, items: readonly PlotItem[], ctx: PlotContext = {}): ResolvedPlot {
  const r = resolvePlotCore(spec, items, ctx);
  return ctx.populationLabel && !ctx.inFacet ? { ...r, populationLabel: ctx.populationLabel } : r;
}

function resolvePlotCore(spec: PlotSpec, items: readonly PlotItem[], ctx: PlotContext = {}): ResolvedPlot {
  const versionIssue = plotIssue(spec);
  if (versionIssue) return emptyResult(spec, items, [versionIssue], ctx);
  const fail = (...issues: string[]) => emptyResult(spec, items, issues, ctx);
  // A sweep reads runs of tests, not fields: the sweep panel draws it, and the callers branch on the mark first.
  if (spec.chart === 'sweep') return fail('A sweep is drawn by the sweep panel');
  if (!ctx.eligibleOnly) return resolveEligible(spec, items, ctx);
  if (!ctx.whereApplied && plotConditions(spec).length) return resolveFiltered(spec, items, ctx);
  if (spec.fields?.facet && !ctx.inFacet) return resolveFacets(spec, items, ctx);
  if (spec.chart === 'control') return resolveControl(spec, items, ctx);
  if (spec.chart === 'goal') return resolveGoal(spec, items, ctx);
  if (spec.chart === 'heatmap' && !ctx.asHeatmap) return resolveHeatmap(spec, items, ctx);

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
      if (setField.passRate) {
        // A pass rate needs the test's definition, and test limits when it is judged by them.
        if (!def) { absent.push(saved ? `${saved} (test ${tn})` : `test ${tn}`); continue; }
        if (passKindOf(def, setField.judge) === 'spec' && def.limitLow === undefined && def.limitHigh === undefined) { absent.push(`${nameOfTest(tn)} (no test limits)`); continue; }
        tests.push(tn);
        continue;
      }
      if (def && !isParametricTest(def)) { absent.push(`${nameOfTest(tn)} (pass/fail, no value)`); continue; }
      if (!present.has(tn)) { absent.push(saved ? `${saved} (test ${tn})` : `test ${tn}`); continue; }
      tests.push(tn);
    }
    if (tests.length === 0) return fail(`None of these tests has ${setField.passRate ? 'a verdict to judge' : 'values'} in these dies${absent.length ? `: ${absent.join(', ')}` : ''}`);
    if (setField.passRate && spec.normalize) return fail('A pass rate is a share of dies, not a measured value: it cannot be rescaled');
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
    } else if (!setField.passRate) {
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
  } else if (melt && yCol && !yCol.issue && !isPassRateSet(yCol.field)) {
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
  // A pass rate is a share of dies: a die's own 0 or 100 drawn as a point, a box or a histogram says nothing.
  if (yCol && 'passRate' in yCol.field && level === 'die' && mark !== 'bar' && mark !== 'line') {
    return fail(`${yCol.label} is a share of dies: draw it as a bar or a line, or with one mark per wafer (each wafer's pass rate)`);
  }

  // With a set of tests the population is read once per test, so a wafer-level unit is one wafer for one test.
  const nUnits = level === 'die' ? rows.dies.length : source.length;
  const itemOf = (u: number) => (level === 'die' ? rows.item[u] : u);
  const unitInfo = (u: number): PlotUnit => ({ item: realItem(itemOf(u)), die: level === 'die' ? rows.dies[u] : undefined });

  // A column as one value per unit. A die-level numeric column at wafer level is aggregated per wafer.
  const aggHow: PlotAggregate = spec.aggregate && spec.aggregate !== 'yield' ? spec.aggregate : 'mean';
  const numAt = (c: FieldColumn): Float64Array => {
    if (!c.num) throw new Error('numeric field expected');
    if (c.level === level) return c.num;
    if (c.level === 'wafer') { const out = new Float64Array(nUnits); for (let u = 0; u < nUnits; u++) out[u] = c.num[itemOf(u)]; return out; }
    const per: number[][] = source.map(() => []);
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
  let correlation: ResolvedPlot['correlation'];
  let colorScale: ResolvedPlot['colorScale'];
  let fitNotes: string[] | undefined;
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
    // A fitted line per colour (one for the population with a single colour or a gradient), and y = x where the axes
    // measure one quantity.
    let fits: PlotFit[] | undefined;
    if (spec.fit) {
      const byGroup = colorValues ? [points] : Array.from({ length: groupCount }, (_, g) => points.filter(p => p.group === g));
      fits = byGroup.flatMap((ps, g) => { const f = fitLine(ps.map(p => p.x), ps.map(p => p.y), spec.fit!); return f ? [{ group: g, ...f }] : []; });
      const same = (xCol!.unit ?? '') === (yCol!.unit ?? '');
      fitNotes = fits.map(f => {
        const who = groupCount > 1 && !colorValues ? `${groups[f.group] || '(none)'}: ` : '';
        // A minus sign, not a hyphen, as the intercept has.
        const s4 = +f.slope.toPrecision(4);
        const mag = `${s4 < 0 ? '−' : ''}${fmtExact(Math.abs(s4))}`;
        const slope = same ? mag : `${mag} ${yCol!.unit ?? ''}/${xCol!.unit ?? ''}`.trim();
        const sign = f.intercept < 0 ? '−' : '+';
        return `${who}y = ${slope} x ${sign} ${fmt(Math.abs(f.intercept), yCol!.unit)}, R² ${f.r2.toFixed(3)}, n ${f.n.toLocaleString('en-GB')}`;
      });
    }
    let identity = false;
    if (spec.identity) {
      if ((xCol!.unit ?? '') !== (yCol!.unit ?? '')) notes.push(`y = x is left off: ${xCol!.label} and ${yCol!.label} are in different units`);
      else identity = true;
    }
    marks = { type: 'scatter', points, ...(fits?.length ? { fits } : {}), ...(identity ? { identity: true as const } : {}) };
    // How strongly the two go together, stated rather than left to the eye: Pearson's r over every point drawn, the rule
    // the correlation matrix uses, so the two cannot disagree about a pair.
    correlation = pearsonOfPairs(points);
    xAxis = axisFor('x', xCol!.label, xCol!.unit, spec, points.map(p => p.x), notes);
    yAxis = axisFor('y', yCol!.label, yCol!.unit, spec, points.map(p => p.y), notes);
    // Points of several splits or lots pooled into one cloud: a trend across them may be the groups' offset, not the
    // relationship (Simpson's paradox). Not when the colour or the panels already divide by the field.
    if (!ctx.inFacet) {
      const dividing = [colorCol?.field, spec.fields?.facet].flatMap(f => (f && 'meta' in f ? [f.meta] : []));
      const mixed = buildFacetTable(items.map(it => ({ metadata: it.metadata, dieCount: it.dies.length })), { facetableOnly: true, curation: ctx.curation })
        .filter(f => f.splittable && !dividing.includes(f.key)).map(f => f.label);
      if (mixed.length) notes.push(`Mixed ${list(mixed)} across these points: a trend here may come from the groups' offset rather than the relationship (Simpson's paradox). Colour or panel by it, or keep one value with Only dies where`);
    }
    aggregation = [perWaferNote(xCol!), perWaferNote(yCol!),
      fits?.length ? `${spec.fit === 'orthogonal' ? 'orthogonal (Deming) fit' : 'least-squares fit of Y on X'} per ${groupCount > 1 && !colorValues ? 'colour' : 'plot'}` : undefined]
      .filter(Boolean).join('; ') || undefined;
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
    const percent = spec.histNorm === 'percent';
    yAxis = { label: percent ? (groupCount > 1 ? `Share of each colour's ${unitNoun}` : `Share of ${unitNoun}`) : 'Count', scale: 'linear', ...(percent ? { unit: '%' } : {}), ...(spec.axes?.y?.label ? { label: spec.axes.y.label } : {}) };
    if (spec.normalCurve && xAxis.scale === 'log') notes.push('The normal curve is left off a log axis, where a normal distribution is not the shape its bars would follow');
    aggregation = [perWaferNote(yCol!), spec.normalCurve && xAxis.scale !== 'log' ? `curve: the normal distribution with ${groupCount > 1 ? "each colour's" : 'the'} mean and standard deviation` : undefined].filter(Boolean).join('; ') || undefined;
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
    // The spread of the values combined at each X: a band round a mean or a median, never round a pass rate, whose
    // values are 0 and 100 and whose spread says nothing about the rate.
    let band: { lo: number[][]; hi: number[][] } | undefined;
    const spread = spec.spread;
    if (spread) {
      if (yCol!.perDie) return fail(`A band shows how values spread, and ${yCol!.label} is a share of passing dies, not a value: leave the band off`);
      if (how !== 'mean' && how !== 'median') return fail(`A band goes round a mean or a median, not ${AGG_NOUN[how]}`);
      const tByDf = new Map<number, number>();   // Student's t for the 95% interval, once per degrees of freedom
      const at = (g: number, x: number, k: number): [number, number] => {
        const cell = (cells.get(`${g}|${x}`) ?? []).filter(Number.isFinite);
        if (cell.length === 0) return [NaN, NaN];
        if (spread === 'minmax') return [minOf(cell), maxOf(cell)];
        if (spread === 'iqr') { const sorted = cell.sort((a, b) => a - b); return [quantile(sorted, 0.25), quantile(sorted, 0.75)]; }
        if (cell.length < 2) return [NaN, NaN];
        const m = cell.reduce((a, b) => a + b, 0) / cell.length;
        const sd = Math.sqrt(sampleVariance(cell, m));
        let t = 1;
        if (spread === 'ci95') { t = tByDf.get(cell.length - 1) ?? tQuantileTwoSided(0.05, cell.length - 1); tByDf.set(cell.length - 1, t); }
        const half = spread === 'sd' ? sd : t * sd / Math.sqrt(cell.length);
        return [values[g][k] - half, values[g][k] + half];
      };
      const lo = values.map(() => [] as number[]), hi = values.map(() => [] as number[]);
      values.forEach((_, g) => xsSorted.forEach((x, k) => { const [l, h] = at(g, x, k); lo[g].push(l); hi[g].push(h); }));
      band = { lo, hi };
    }
    marks = { type: 'line', xs: xsSorted, values, counts, cellUnits: lineUnits, unit: unitInfo, ...(band ? { band } : {}) };
    xAxis = axisFor('x', xCol!.label, xCol!.unit, spec, xsSorted, notes);
    const yAgg = how === 'yield' ? 'mean' : how;
    yAxis = axisFor('y', yCol!.perDie ? yCol!.label : `${AGG_WORD[yAgg]} ${yCol!.label}`, yCol!.unit, spec, values.flat(), notes);
    const of = level === 'die' ? 'dies' : 'wafers';
    const bandWords = { sd: `± 1 standard deviation of the ${of}`, ci95: `the mean's 95% confidence interval (Student's t, n = ${of})`, iqr: `the quartiles of the ${of}`, minmax: `the range of the ${of}` } as const;
    aggregation = (yCol!.perDie ? `passing dies over judged dies, per ${xCol!.label.toLowerCase()}` : `${AGG_WORD[yAgg].toLowerCase()} of ${yCol!.label} per ${xCol!.label}`)
      + (spread ? `; band: ${bandWords[spread]} at each ${xCol!.label.toLowerCase()}` : '');
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
    if (spec.stack && !adds) return fail(`Stacking adds the colours' values, which means something for a count or a sum, not ${AGG_NOUN[how]}: combine by count or sum, or draw the colours side by side`);
    if (spec.cumulative && !(adds && spec.sort === 'value')) return fail('A cumulative line needs a bar of counts or sums sorted by value, largest first');
    if (spec.barNorm === 'percent' && !adds) return fail(`A share of each colour's total means something for a count or a sum, not ${AGG_NOUN[how]}: combine by count or sum`);
    if (spec.barNorm === 'percent' && spec.stack) return fail('Bars are either stacked or each colour\'s share of its own total, not both');
    // Each colour as shares of its own total, over every category (before any are left out), so groups of different
    // sizes compare; categories are then sorted by their summed shares, so a large group does not set the order alone.
    if (spec.barNorm === 'percent' && adds) {
      for (let g = 0; g < groupCount; g++) {
        const total = values[g].reduce((a, v) => a + (Number.isFinite(v) ? v : 0), 0);
        values[g] = values[g].map(v => (Number.isFinite(v) && total > 0 ? (v / total) * 100 : NaN));
      }
    }
    if ((spec.sort || spec.top) && xCols.length > 1) return fail('Sorting by value and keeping the top categories need one category field on X');
    // A category's value over all its colours: added up for counts and sums (and shares), else combined over every unit
    // in it as one cell would be (a pass rate pooled over every group's judged dies), so the order is the whole's.
    const totalOf = (c: number): number => {
      if (mark === 'box') { const all = cells.flatMap(row => row[c]); return all.length ? combine(all, 'median') : NaN; }
      if (adds || spec.barNorm === 'percent') {
        let t = 0, any = false;
        for (const row of values) if (Number.isFinite(row[c])) { t += row[c]; any = true; }
        return any ? t : NaN;
      }
      const all = cells.flatMap(row => row[c]);
      if (all.length === 0) return NaN;
      if (how === 'yield') {
        const w = weights.flatMap(row => row[c]);
        const total = w.reduce((a, b) => a + b, 0);
        return total > 0 ? all.reduce((a, v, i) => a + v * w[i], 0) / total : NaN;
      }
      return combine(all, how);
    };
    const totals = categories.map((_, c) => totalOf(c));
    let order = categories.map((_, c) => c);
    // Missing values last, whichever way.
    if (spec.sort === 'value') order.sort((a, b) => (Number.isFinite(totals[b]) ? totals[b] : -Infinity) - (Number.isFinite(totals[a]) ? totals[a] : -Infinity));
    if (spec.sort === 'ascending') order.sort((a, b) => (Number.isFinite(totals[a]) ? totals[a] : Infinity) - (Number.isFinite(totals[b]) ? totals[b] : Infinity));
    const grand = totals.reduce((a, t) => a + (Number.isFinite(t) ? t : 0), 0);
    if (spec.top && spec.top < order.length) {
      notes.push(`Showing the first ${spec.top} of ${order.length} ${xCols[0].label.toLowerCase()} values${spec.sort === 'value' ? ', largest first' : spec.sort === 'ascending' ? ', smallest first' : ''}`);
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
      ...(mark === 'bar' && level === 'die' && yCol?.perDie ? { passFail: yCol.failSide?.some(v => v !== 0) ? { failSide: yCol.failSide } : {} } : {}),
    };
    const perWhat = list(xCols.map(c => c.label.toLowerCase()));
    xAxis = { label: spec.axes?.x?.label ?? xCols.map(c => c.label).join(' › '), scale: 'linear' };
    if (mark === 'bar') {
      const word = how === 'count' ? 'Count' : AGG_WORD[how];
      const base = wantsCount ? `Count of ${unitNoun}` : how === 'yield' ? ('passRate' in yCol!.field ? yCol!.label : 'Pooled yield') : `${word} ${yCol!.label}`;
      const percent = spec.stack === 'percent' && groupCount > 1;
      const shares = spec.barNorm === 'percent';
      const what = wantsCount ? unitNoun : base.toLowerCase();
      const ylabel = percent ? `Share of each ${xCols[0].label.toLowerCase()}'s ${what}`
        : shares ? (groupCount > 1 ? `Share of each ${colorLabel ? colorLabel.toLowerCase() : 'colour'}'s ${what}` : `Share of ${what}`) : base;
      // A stack's axis spans each category's total, not its colours one by one.
      const spanValues = percent ? [0, 100] : spec.stack && groupCount > 1 ? shownTotals.filter(Number.isFinite) : values.flat();
      yAxis = axisFor('y', ylabel, percent || shares || how === 'yield' ? '%' : (how === 'count' ? undefined : yCol?.unit), spec, spanValues, notes);
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

  // What-if limits: the plotted test's pass rate under its own test limits and under the proposed ones, over the dies
  // judged by both (a value, yield-eligible), with the proposed limits drawn on the values axis.
  let whatIf: ResolvedPlot['whatIf'];
  if (spec.whatIf) {
    if (!(mark === 'histogram' || mark === 'probability')) return fail('What-if limits go on a histogram or a probability plot of one test');
    if (melt || !yCol || !('test' in yCol.field)) return fail('What-if limits need one measured test as the values');
    if (spec.normalize) return fail("What-if limits are in the test's own unit: turn rescaling off to set them");
    const tn = (yCol.field as { test: number }).test;
    const def = defs.find(d => d.testNumber === tn);
    const nowLo = def?.limitLow ?? -Infinity, nowHi = def?.limitHigh ?? Infinity;
    const lo = spec.whatIf.lo ?? def?.limitLow ?? -Infinity, hi = spec.whatIf.hi ?? def?.limitHigh ?? Infinity;
    let judged = 0, passNow = 0, passThen = 0;
    for (let i = 0; i < rows.dies.length; i++) {
      const v = testValue(rows.dies[i], tn);
      if (v === undefined || !Number.isFinite(v) || !isYieldEligibleDie(rows.dies[i])) continue;
      judged++;
      if (v >= nowLo && v <= nowHi) passNow++;
      if (v >= lo && v <= hi) passThen++;
    }
    const rate = (k: number) => (judged ? `${((k / judged) * 100).toFixed(1)}%` : '—');
    const range = `${Number.isFinite(lo) ? fmt(lo, yCol.unit) : '−∞'} to ${Number.isFinite(hi) ? fmt(hi, yCol.unit) : '∞'}`;
    const diff = passThen - passNow;
    const sentence = `what-if: ${yCol.label} passes ${rate(passNow)} of ${judged.toLocaleString('en-GB')} dies by its test limits, ${rate(passThen)} from ${range}`
      + ` (${diff === 0 ? 'no die changes' : `${diff > 0 ? '+' : '−'}${Math.abs(diff).toLocaleString('en-GB')} dies`})`;
    whatIf = { ...(Number.isFinite(lo) ? { lo } : {}), ...(Number.isFinite(hi) ? { hi } : {}), judged, passNow, passThen, sentence };
    if (xAxis) xAxis.limits = { ...xAxis.limits, ...(spec.whatIf.lo !== undefined ? { whatIfLow: spec.whatIf.lo } : {}), ...(spec.whatIf.hi !== undefined ? { whatIfHigh: spec.whatIf.hi } : {}) };
  }

  const usesPat = [...xCols, yCol, colorCol].some(c => !!c && 'builtin' in c.field && c.field.builtin === 'pat')
    || [xAxis, yAxis].some(a => a?.limits?.patLow !== undefined || a?.limits?.patHigh !== undefined);

  return {
    spec, issues: [], notes, marks, level,
    ...(comparison ? { comparison } : {}),
    ...(usesPat ? { usesPat: true as const } : {}),
    ...(fitNotes?.length ? { fitNotes } : {}),
    ...(whatIf ? { whatIf } : {}),
    ...(excludedSet ? { excluded: { limitSet: excludedSet, fields: excludedFields } } : {}),
    autoTitle: title(), x: xAxis, y: yAxis, groups, colorScale, colorLabel, aggregation, ...(correlation ? { correlation } : {}),
    ...(colorCol && !continuous && 'builtin' in colorCol.field && (colorCol.field.builtin === 'hbin' || colorCol.field.builtin === 'sbin')
      ? { colorBins: colorCol.field.builtin === 'hbin' ? 'hard' as const : 'soft' as const } : {}),
    ...(colorCol && xFields.some(f => sameField(colorCol!.field, f)) ? { colorRepeatsX: true as const } : {}),
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
  const parts = [resolved.populationLabel
    ? `${dies.toLocaleString('en-GB')} dies · ${resolved.populationLabel}`
    : `${wafers.toLocaleString('en-GB')} wafer${wafers === 1 ? '' : 's'} · ${dies.toLocaleString('en-GB')} dies`];
  if (resolved.leftOut) {
    const { partial, edge } = resolved.leftOut;
    const n = (k: number, what: string) => `${k.toLocaleString('en-GB')} ${what} di${k === 1 ? 'e' : 'es'}`;
    parts.push(`${list([...(edge ? [n(edge, 'edge-excluded')] : []), ...(partial ? [n(partial, 'partial')] : [])])} left out, as a yield leaves them out`);
  }
  if (resolved.filterNote) parts.push(resolved.filterNote);
  if (resolved.whatIf) parts.push(resolved.whatIf.sentence);
  if (resolved.aggregation) parts.push(resolved.aggregation);
  if (resolved.correlation) parts.push(`${resolved.correlation.r === null ? '' : `r = ${resolved.correlation.r.toFixed(3)} · `}n = ${resolved.correlation.n.toLocaleString('en-GB')}`);
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

/**
 * The user-guide sections that explain what a plot shows, a card linking each after its footnote: its chart type's
 * statistics, and each of these only while the plot uses it: groups compared wafer by wafer, a fit line or the y = x
 * line, a band, rescaled values, ranges of a number, panels, what-if limits. None for a plain chart (its About line
 * says all there is).
 */
export function plotGuideSections(resolved: ResolvedPlot): GuideSection[] {
  const { spec } = resolved;
  const f = spec.fields ?? {};
  const fields = [...xFieldsOf(f.x), f.y, f.color, f.rows, f.facet];
  const out = [
    GUIDE_SECTION[spec.chart],
    resolved.comparison && GUIDE_SECTIONS.groups,
    (resolved.fitNotes?.length || (spec.identity && resolved.marks?.type === 'scatter')) && GUIDE_SECTIONS.fit,
    (resolved.marks?.type === 'line' && resolved.marks.band) && GUIDE_SECTIONS.bands,
    resolved.normalization && GUIDE_SECTIONS.rescaling,
    (fields.some(isBinned) || resolved.facets || resolved.whatIf) && GUIDE_SECTIONS.ranges,
  ];
  return [...new Set(out.filter((s): s is GuideSection => !!s))];
}

const GUIDE_SECTION: Partial<Record<PlotSpec['chart'], GuideSection>> = {
  probability: GUIDE_SECTIONS.probability, control: GUIDE_SECTIONS.control, goal: GUIDE_SECTIONS.goal, heatmap: GUIDE_SECTIONS.heatmap,
};


// ── what can be chosen ────────────────────────────────────────────────────────────────────────────────────

export type FieldGroup = 'Tests' | 'Verdicts' | 'Pass rates' | 'Die' | 'Wafer';

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
  if (isBinned(f)) return `binned:${fieldKey(f.binned)}`;
  if (isTestSet(f)) return `${f.passRate ? `passRates:${f.judge ?? 'limits'}` : 'tests'}:${f.tests.join(',')}`;
  if ('passRate' in f) return `passRate:${f.passRate}${f.judge === 'flag' ? ':flag' : ''}`;
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
  // Each judgeable test's pass rate: a parametric test with a limit, or a functional one with outcomes here.
  for (const d of defs) {
    const judgeable = isParametricTest(d) ? (d.limitLow !== undefined || d.limitHigh !== undefined) && (present.has(d.testNumber) || !dies.length)
      : outcomes.has(d.testNumber) || !dies.length;
    if (!judgeable) continue;
    const name = d.name || `Test ${d.testNumber}`;
    out.push({
      field: { passRate: d.testNumber, ...(d.name ? { name: d.name } : {}) },
      label: `${name} · ${d.testNumber} pass rate`, name: `${name} pass rate`,
      group: 'Pass rates', kind: 'numeric', level: 'die', categorical: false,
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
      field: { meta: f.key }, label: f.label || attributeLabel(f.key, ctx.curation), name: f.label || attributeLabel(f.key, ctx.curation), group: 'Wafer',
      kind: col.kind, level: 'wafer', categorical: true, distinct: f.values.length,
    });
  }
  return out;
}

/**
 * The values a category field takes on this population, in the order every list of them uses (`categoryOrder`): what
 * the editor offers for a plot's `where`. Empty for a field with no categories here.
 */
/** The smallest and largest value a numeric field takes on the population, or undefined when it has none (or is a category). */
export function fieldExtent(field: PlotField, items: readonly PlotItem[], ctx: PlotContext = {}): [number, number] | undefined {
  const col = resolveField(field, { items, rows: flatten(items), ctx });
  if (col.issue || !col.num) return undefined;
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < col.num.length; i++) { const v = col.num[i]; if (Number.isFinite(v)) { if (v < lo) lo = v; if (v > hi) hi = v; } }
  return lo === Infinity ? undefined : [lo, hi];
}

export function fieldValues(field: PlotField, items: readonly PlotItem[], ctx: PlotContext = {}): string[] {
  const col = resolveField(field, { items, rows: flatten(items), ctx });
  if (col.issue || !col.cat) return [];
  const seen: string[] = [];
  for (const v of col.cat) if (v !== undefined && !seen.includes(v)) seen.push(v);
  return categoryOrder(field, seen, numericCategories(col));
}

export type PlotRole = 'x' | 'y' | 'color';

/**
 * The fields that make sense for a role of a mark, so the editor never offers a choice that can only fail:
 * values must be numeric; a bar or box groups by a category (or a lot field with a handful of values); a colour is
 * always a category, since a continuous colour is not drawn yet.
 */
export function fieldsForRole(catalogue: readonly FieldOption[], mark: PlotSpec['chart'], role: PlotRole): FieldOption[] {
  // A control chart runs along a wafer field with a number per wafer: wafer order, slot, a date.
  if (mark === 'control' && role === 'x') return catalogue.filter(f => f.kind === 'numeric' && f.level === 'wafer');
  const valueRole = role === 'y' || (role === 'x' && (mark === 'scatter' || mark === 'line' || mark === 'histogram'));
  // A scatter can also be coloured on a gradient by a measured value or a wafer figure.
  if (role === 'color') return catalogue.filter(f => f.categorical || (mark === 'scatter' && f.kind === 'numeric'));
  // A pass rate is a share to read off the values axis, never a position to plot against.
  if (valueRole) return catalogue.filter(f => f.kind === 'numeric' && (role === 'y' || f.group !== 'Pass rates'));
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
/** The ring whose dies yield least over the population, when it yields at least a point less than the wafers overall. */
function lowestYieldRing(items: readonly PlotItem[], ctx: PlotContext = {}): string | undefined {
  const rows = flatten(items);
  const col = resolveField({ builtin: 'ring' }, { items, rows, ctx });
  if (col.issue || !col.cat) return undefined;
  const tally = new Map<string, { pass: number; total: number }>();
  let pass = 0, total = 0;
  for (let i = 0; i < rows.dies.length; i++) {
    const ring = col.cat[i];
    if (ring === undefined) continue;
    const y = yieldCounts([rows.dies[i]], items[rows.item[i]].passBins);
    const t = tally.get(ring) ?? { pass: 0, total: 0 };
    t.pass += y.pass; t.total += y.total; pass += y.pass; total += y.total;
    tally.set(ring, t);
  }
  let worst: string | undefined, low = total ? (pass / total) * 100 - 1 : -Infinity;
  for (const [ring, t] of tally) if (t.total && (t.pass / t.total) * 100 < low) { low = (t.pass / t.total) * 100; worst = ring; }
  return worst;
}

/** Of `limited`, the test whose dies fail its limits most; the first when there is no data to judge by. */
function worstPassRate<T extends { f: PlotField; d: TestDef }>(limited: readonly T[], data?: { items: readonly PlotItem[]; ctx?: PlotContext }): T | undefined {
  if (!data || limited.length < 2) return limited[0];
  const rows = flatten(data.items);
  let worst = limited[0], low = Infinity;
  for (const t of limited) {
    const col = resolveField({ passRate: t.d.testNumber }, { items: data.items, rows, ctx: data.ctx ?? {} });
    if (!col.num || !col.weights) continue;
    let pass = 0, n = 0;
    for (let i = 0; i < col.num.length; i++) if (col.weights[i]) { n++; pass += col.num[i] / 100; }
    if (n && pass / n < low) { low = pass / n; worst = t; }
  }
  return worst;
}

export function examplePlots(catalogue: readonly FieldOption[], waferCount: number, newId: () => string, data?: { items: readonly PlotItem[]; ctx?: PlotContext }): PlotSpec[] {
  const inOrder = catalogue.filter(f => f.group === 'Tests' && 'test' in f.field);
  // With the data to hand the tests are put in the order they have most to show, the second being the one that follows the first.
  const metaKeys = catalogue.flatMap(f => ('meta' in f.field ? [f.field.meta] : []));
  const picks = data ? pickExamples(data.items, inOrder.map(f => (f.field as { test: number }).test), metaKeys, data.ctx?.curation) : undefined;
  const byNumber = new Map(inOrder.map(f => [(f.field as { test: number }).test, f]));
  const testFields = picks ? [
    ...picks.ranked.map(n => byNumber.get(n)!).filter(Boolean).filter(f => (f.field as { test: number }).test !== picks.partner),
  ] : inOrder;
  if (picks?.partner !== undefined && testFields.length) testFields.splice(1, 0, byNumber.get(picks.partner)!);
  const tests = testFields.map(f => f.field);
  const out: PlotSpec[] = [];
  const manyWafers = waferCount > 1;
  const has = (b: PlotBuiltin) => catalogue.some(f => 'builtin' in f.field && f.field.builtin === b);
  const dividing = (picks?.splitKey ? catalogue.find(f => 'meta' in f.field && f.field.meta === picks.splitKey) : undefined)
    ?? catalogue.find(f => 'meta' in f.field && f.distinct !== undefined && f.distinct >= 2 && f.distinct <= Math.max(2, Math.floor(waferCount / 2)));
  const add = (spec: Omit<PlotSpec, 'id'>) => out.push({ id: newId(), ...spec });
  // A few tests as one set, each named as it is here so the plot is read against the same tests elsewhere.
  const set: PlotTestSet | undefined = testFields.length >= 2 ? {
    tests: testFields.slice(0, 8).map(f => (f.field as { test: number }).test),
    names: Object.fromEntries(testFields.slice(0, 8).map(f => [String((f.field as { test: number }).test), f.name])),
  } : undefined;

  // Colour carries the comparison: the split where the lot has one, else the ring; a plot whose X is that field colours
  // each of its categories.
  const split: PlotField | undefined = dividing?.field;
  const tint: PlotField | undefined = split ?? (has('ring') ? { builtin: 'ring' } : undefined);
  const byTint: { color: PlotColor } = { color: tint ?? { none: true } };
  const bySplit: { color: PlotColor } = { color: split ?? { none: true } };

  if (tests.length >= 2) add({ chart: 'scatter', fields: { x: tests[0], y: tests[1], ...(split ? { color: split } : {}) }, fit: 'linear' });
  // Each colour as a share of its own dies: a split's arms (or the rings) differ in size, and counts would draw that instead of the shapes.
  if (tests.length >= 1) add({ chart: 'histogram', fields: { y: tests[0], ...byTint }, normalCurve: true, ...(tint ? { histNorm: 'percent' as const } : {}) });
  // Each wafer's spread of the lead test against the median of every die plotted.
  if (tests.length >= 1 && manyWafers) add({ chart: 'box', fields: { x: { builtin: 'wafer' }, y: tests[0], ...bySplit }, axes: { y: { references: [{ stat: 'median' }] } } });
  // Each value at its bar's end and the median of the bars as a line, as the Overview's yield card draws it.
  if (manyWafers) add({ chart: 'bar', fields: { x: split ?? { builtin: 'wafer' }, y: { builtin: 'yield' }, color: split ?? { none: true } }, valueLabels: true, axes: { y: { references: [{ stat: 'median' }] } } });
  // A filter: each wafer's yield on the ring that yields least, where a ring is worse than the rest (the edge, usually).
  const worstRing = manyWafers && has('ring') && data ? lowestYieldRing(data.items, data.ctx) : undefined;
  if (worstRing) add({ chart: 'bar', fields: { x: { builtin: 'wafer' }, y: { builtin: 'yield' }, color: { none: true } }, where: { conditions: [{ field: { builtin: 'ring' }, values: [worstRing] }] } });
  // The spread of dies within each wafer in order; from five wafers the control chart below reads the same order, so only one of them is offered.
  if (tests.length >= 1 && manyWafers && waferCount < 5) add({ chart: 'line', fields: { x: { builtin: 'waferOrder' }, y: tests[0], color: { none: true } }, aggregate: 'mean', spread: 'sd' });
  // The first test as cumulative curves, one per wafer (or per Group by), where a shifted or wider wafer stands out.
  if (tests.length >= 1) add({ chart: 'probability', fields: { y: tests[0], ...bySplit } });

  // Several tests at once, each rescaled so they share an axis: a box per test, and a grid of tests by wafer.
  // The tests that have both limits, as one set: each rescaled so its limits sit at 0 and 1, the capability card's view.
  const defs = data?.ctx?.testDefs ?? [];
  const limited = tests.flatMap(f => { const d = 'test' in f ? defs.find(x => x.testNumber === f.test) : undefined; return d && isParametricTest(d) ? [{ f, d }] : []; });
  const bounded = limited.filter(({ d }) => d.limitLow !== undefined && d.limitHigh !== undefined).slice(0, 8);
  const limitSet: PlotTestSet | undefined = bounded.length >= 2 ? {
    tests: bounded.map(({ f }) => (f as { test: number }).test),
    names: Object.fromEntries(bounded.filter(({ d }) => d.name).map(({ f, d }) => [String((f as { test: number }).test), d.name!])),
  } : undefined;
  if (limitSet) add({ chart: 'box', fields: { x: { builtin: 'test' }, y: limitSet, ...bySplit }, normalize: 'limits' });
  else if (set) add({ chart: 'box', fields: { x: { builtin: 'test' }, y: set, ...bySplit }, normalize: 'zscore' });
  if (set && manyWafers) add({ chart: 'heatmap', fields: { x: { builtin: 'wafer' }, y: set }, aggregate: 'mean', normalize: 'zscore' });
  // Split experiments: the groups compared with each wafer as one value, and wafers nested inside their split.
  if (tests.length >= 1 && split) add({ chart: 'box', fields: { x: split, y: tests[0], color: split } });
  if (tests.length >= 1 && split) add({ chart: 'box', fields: { x: [split, { builtin: 'wafer' }], y: tests[0], color: split } });
  // Panels: the same plot once per ring, on shared axes, coloured by split.
  if (tests.length >= 1 && has('ring')) add({ chart: 'histogram', fields: { y: tests[0], ...bySplit, facet: { builtin: 'ring' } } });
  // A measured value in ranges as a category: the first test by the second, and by distance from the centre.
  if (tests.length >= 2) add({ chart: 'box', fields: { x: { binned: tests[1], bins: 5 }, y: tests[0], ...byTint } });
  if (tests.length >= 1 && has('radius')) add({ chart: 'box', fields: { x: { binned: { builtin: 'radius' }, bins: 6, by: 'width' }, y: tests[0], ...bySplit } });
  // Bins: a pareto of the hard bins, and each wafer's bin mix.
  if (has('hbin')) add({ chart: 'bar', fields: { x: { builtin: 'hbin' }, color: { none: true } }, sort: 'value', cumulative: true });
  if (has('hbin') && manyWafers) add({ chart: 'bar', fields: { x: { builtin: 'wafer' }, color: { builtin: 'hbin' } }, stack: 'percent' });
  // Part-average testing: the first test by each die's verdict, so outliers inside the limits stand apart.
  if (tests.length >= 1 && has('pat')) add({ chart: 'box', fields: { x: { builtin: 'pat' }, y: tests[0], color: { builtin: 'pat' } } });
  // A pass/fail test as a category: does the lead test differ on the dies that fail it?
  const verdict = catalogue.find(f => f.group === 'Verdicts');
  if (tests.length >= 1 && verdict) add({ chart: 'box', fields: { x: verdict.field, y: tests[0], color: verdict.field } });
  // Wafer by wafer on an individuals chart with control limits and rule breaks.
  if (tests.length >= 1 && waferCount >= 5) add({ chart: 'control', fields: { x: { builtin: 'waferOrder' }, y: tests[0] } });
  // Which tests meet their limits: every test with both limits on a goal plot (a split moves its points), and the lead
  // test's pass rate by split. Only where the test definitions say which tests have limits.
  if (limited.some(({ d }) => d.limitLow !== undefined && d.limitHigh !== undefined)) add({ chart: 'goal', fields: dividing ? { color: dividing.field } : {} });
  // Which tests fail in which split (or wafer): the pass rates of the tests that have limits, as a grid.
  const rateTests = limited.filter(({ d }) => d.limitLow !== undefined || d.limitHigh !== undefined).slice(0, 8);
  if (rateTests.length >= 2 && manyWafers) {
    add({ chart: 'heatmap', fields: { x: dividing ? dividing.field : { builtin: 'wafer' }, y: {
      tests: rateTests.map(({ f }) => (f as { test: number }).test), passRate: true,
      names: Object.fromEntries(rateTests.filter(({ d }) => d.name).map(({ f, d }) => [String((f as { test: number }).test), d.name!])),
    } }, aggregate: 'mean' });
  }
  // The test that fails its limits most, among the leading ones: its pass rate by split, and what wider limits would pass.
  const rated = worstPassRate(limited.filter(({ d }) => d.limitLow !== undefined || d.limitHigh !== undefined).slice(0, 8), data);
  if (rated && manyWafers) add({ chart: 'bar', fields: { x: dividing ? dividing.field : { builtin: 'wafer' }, y: { passRate: (rated.f as { test: number }).test, ...(rated.d.name ? { name: rated.d.name } : {}) }, color: { none: true } } });
  if (rated && rated.d.limitLow !== undefined && rated.d.limitHigh !== undefined) {
    const widen = (rated.d.limitHigh - rated.d.limitLow) * 0.1;
    add({ chart: 'histogram', fields: { y: rated.f, color: { none: true } }, whatIf: { lo: rated.d.limitLow - widen, hi: rated.d.limitHigh + widen } });
  }
  if (tests.length >= 2) out.push({ ...startingSweep(inOrder.map(f => f.field).flatMap(f => ('test' in f ? [f] : [])), newId()), title: 'Example sweep' });
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
    if (isTestSet(f)) { const first = f.tests[0]; const n = typeof first === 'number' ? first : parseInt(String(first), 10); if (Number.isInteger(n)) return n; continue; }
    if (isField(f) && 'passRate' in f) return f.passRate;
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
