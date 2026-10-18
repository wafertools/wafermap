// The plot editor: the controls that change one `PlotSpec`.
//
// Laid out as a spreadsheet's chart editor is, because that is the one most users have used: a chart type, then
// the series for each role (Setup), then titles and axes (Customise). Every change applies at once; there is no
// Apply button, so the chart beside it is always the plot as it stands. The editor only edits the spec: drawing is
// the chart's job and saving is the host's (`onChange`), so the same editor serves the Plot tab's modal and the
// draft opened from a drilldown.
//
// A field list offers only what a role can use (`fieldsForRole`), grouped Tests · Die · Wafer and filterable by
// name or test number, so there is no choice that can only fail. Titles are automatic until typed in; clearing the
// box brings the automatic one back.

import { combinationIssue, describeTitleDrift, fieldKey, fieldsForRole, titleDrift, withTestSetNames, type FieldFacts, type FieldOption, type PlotRole } from '../stats/plotData.js';
import { isBinned, isField, isPassRateSet, isTestSet, sameField, xFieldsOf, PLOT_BINS_DEFAULT, PLOT_BINS_MAX, PLOT_BINS_MIN, PLOT_X_LEVELS, type PlotAxis, type PlotBinnedField, type PlotField, type PlotLimits, type PlotNormalize, type PlotSpec, type PlotTestSet } from '../stats/plotSpec.js';
import { formatTestList, parseTestList } from '../stats/sweepText.js';
import { formatReferences, parseReferences } from '../stats/plotReferences.js';
import type { TestDef } from '../renderer/buildWaferMap.js';
import type { FacetCuration } from '../stats/facets.js';
import { CLR, FONT, RADIUS, SPACE, controlStyle, wireControlHover, wireTooltip } from './toolbar.js';
import { inputStyle, makeListSelect, makeSegmented, makeToggle, type ListSelectOption } from './charts/chartShell.js';
export { inputStyle };
import { buildFilterEditor } from './filterEditor.js';

export interface PlotEditorOptions {
  doc: Document;
  plot: PlotSpec;
  catalogue: readonly FieldOption[];
  /** What "Follow Group by" means right now ("Split", or "a colour per wafer" with no grouping), or undefined for a single colour. */
  followLabel: () => string | undefined;
  /** The automatic title and axis titles, shown as placeholders so the reader sees what clearing a box gives back. */
  autoText: () => { title: string; x?: string; y?: string };
  /** Called with the new spec after every change. */
  onChange: (next: PlotSpec) => void;
  /** The values a category field takes on the population, in order: what a filter condition offers. */
  valuesOf?: (field: PlotField) => string[];
  /** The range a number field spans on the population: where a new range condition starts. */
  extentOf?: (field: PlotField) => [number, number] | undefined;
  /** The population's test definitions, so a condition on a test is stated with its name and unit. */
  testDefs?: readonly TestDef[];
  /** The host's names for wafer attributes, so a condition names a field as the field list does. */
  attributes?: Record<string, FacetCuration>;
}

export interface PlotEditorHandle {
  el: HTMLElement;
  /** The spec changed elsewhere (undo, a rebind): show it. */
  setPlot(plot: PlotSpec): void;
  /** The automatic text changed (the data did): refresh the placeholders. */
  refreshAuto(): void;
}

const FOLLOW = '\0follow';
const NONE = '\0none';

const CHART_OPTIONS: Array<[string, string, string]> = [
  ['scatter', 'Scatter', 'One point per die or wafer, one value against another'],
  ['histogram', 'Histogram', 'How often each value occurs'],
  ['box', 'Box', 'Quartiles, with whiskers to the minimum and maximum, for each category'],
  ['bar', 'Bar', 'One combined value for each category, or a count'],
  ['line', 'Line', 'One combined value at each X, joined'],
  ['probability', 'Probability', 'The share of values at or below each value, one curve per colour: on the normal-probability axis a normal distribution is a straight line, and its tails are spread out to read'],
  ['control', 'Control', 'One value per wafer in order, against limits from its own wafer-to-wafer variation, with the points that break a Western Electric rule marked'],
  ['heatmap', 'Heatmap', 'One cell per row and column, coloured by the value combined there: tests by wafer, bins by wafer, rings by split'],
  ['goal', 'Goal', 'Every test with both limits as a point: how far its mean is off centre, and how wide it is, against lines of equal Ppk'],
];
const AUTO = '\0auto';
const COUNT = '\0count';
const SET = '\0set';
/** How many tests a new set starts with: enough to compare, few enough to read. */
const SET_START = 8;

const NORMALIZE_OPTIONS: Array<[string, string, string]> = [
  [AUTO, 'None', 'The values as measured, in their own unit'],
  ['limits', 'To limits', '0 at the low limit and 1 at the high one, each test by its own limits (spec limits where it has both)'],
  ['zscore', 'z-score', 'Standard deviations from the mean of the values in view, each test on its own'],
  ['robust', 'Robust z', 'Like a z-score, from the median and the median absolute deviation, so a few outliers do not set the scale'],
];

const AGGREGATE_LABEL: Record<string, string> = { mean: 'Mean', median: 'Median', min: 'Minimum', max: 'Maximum', sum: 'Sum', count: 'Count', yield: 'Pooled yield (passing over judged dies)' };

/** A labelled control with an optional hint beneath it: the one layout every editor field uses. */
export function fieldRow(doc: Document, label: string, control: HTMLElement, hint?: string): HTMLElement {
  const wrap = doc.createElement('div');
  Object.assign(wrap.style, { display: 'flex', flexDirection: 'column', gap: SPACE.xxs, minWidth: '0' } as Partial<CSSStyleDeclaration>);
  const l = doc.createElement('div');
  l.textContent = label;
  Object.assign(l.style, { fontSize: FONT.sub, color: CLR.label, fontWeight: '600' } as Partial<CSSStyleDeclaration>);
  wrap.append(l, control);
  if (hint) {
    const h = doc.createElement('div');
    h.textContent = hint;
    Object.assign(h.style, { fontSize: FONT.sub, color: CLR.label } as Partial<CSSStyleDeclaration>);
    wrap.appendChild(h);
  }
  return wrap;
}

export function createPlotEditor(o: PlotEditorOptions): PlotEditorHandle {
  const { doc } = o;
  /** A plot of any field-based chart always has `fields` here (a sweep, which may lack them, is not edited by this editor). */
  const withFields = (p: PlotSpec): PlotSpec => (p.fields ? p : { ...p, fields: {} });
  let plot = withFields(o.plot);
  let tab: 'setup' | 'customise' = 'setup';
  const root = doc.createElement('div');
  root.dataset.wmapPlotEditor = '1';
  Object.assign(root.style, { display: 'flex', flexDirection: 'column', gap: SPACE.lg, minWidth: '0' } as Partial<CSSStyleDeclaration>);

  const emit = (next: PlotSpec): void => { plot = next; o.onChange(next); };
  const edit = (fn: (draft: PlotSpec) => void): void => {
    const draft = JSON.parse(JSON.stringify(plot)) as PlotSpec;
    fn(draft);
    emit(draft);
  };

  const row = (label: string, control: HTMLElement, hint?: string): HTMLElement => fieldRow(doc, label, control, hint);

  /** The facts the cross-field rules need of one field of the catalogue. */
  const factsOf = (f: PlotField | undefined): FieldFacts | undefined => {
    // A set of tests is not one entry of the catalogue: it is measured values, one per die and test.
    if (isTestSet(f)) return { label: 'Tests', level: 'die', kind: 'numeric', yield: false };
    const opt = f && o.catalogue.find(c => sameField(c.field, isBinned(f) ? f.binned : f));
    // Put into ranges, a measured value or a number is a category of its own level.
    return opt ? { label: opt.name, level: opt.level, kind: f && isBinned(f) ? 'categorical' : opt.kind, yield: !(f && isBinned(f)) && 'builtin' in opt.field && opt.field.builtin === 'yield' } : undefined;
  };
  /** The X field or levels of `p`, outer first: a copy, so trying a field at a level never edits the plot itself. */
  const xLevels = (p: PlotSpec = plot): PlotField[] => [...xFieldsOf(p.fields?.x)];
  /** One level is written as the field itself, the shape every chart reads; several as a list; none as no X. */
  const setXLevels = (d: PlotSpec, levels: PlotField[]): void => {
    if (levels.length === 0) delete d.fields!.x; else d.fields!.x = levels.length === 1 ? levels[0] : levels;
  };
  /** Of nested levels, the finest decides what the plot's marks are, so it is the one the cross-field rules see. */
  const finestFacts = (levels: readonly PlotField[]): FieldFacts | undefined => {
    const facts = levels.map(factsOf).filter((x): x is FieldFacts => !!x);
    return facts.find(x => x.level === 'die') ?? facts[0];
  };
  /**
   * Why choosing `candidate` for `role` would leave a plot that cannot be drawn, given the other fields now chosen. For
   * X, `at` is the level it would take (the first, or one past the last for a new level).
   */
  function conflictFor(role: PlotRole, candidate: FieldOption, at = 0): string | undefined {
    const f = plot.fields ?? {};
    const colorField = f.color && !('follow' in f.color) && !('none' in f.color) ? f.color : undefined;
    const levels = xLevels();
    if (role === 'x') { levels[at] = candidate.field; }
    const chosen = { x: finestFacts(levels), y: factsOf(f.y), color: factsOf(colorField) };
    if (role !== 'x') chosen[role] = factsOf(candidate.field);
    const continuousColor = plot.chart === 'scatter' && chosen.color?.kind === 'numeric' && !!colorField && !('meta' in colorField);
    return combinationIssue(plot.chart, chosen, { aggregate: plot.aggregate, level: plot.level, continuousColor })?.short;
  }
  /** The parametric tests of the lot, as the definitions a set's ranges and names are read against. */
  const lotTests = (): TestDef[] => o.catalogue.flatMap(f => (f.group === 'Tests' && 'test' in f.field ? [{ testNumber: f.field.test, name: f.field.name ?? '' }] : []));
  const ySet = (): PlotTestSet | undefined => (isTestSet(plot.fields?.y) ? plot.fields!.y as PlotTestSet : undefined);
  const isTestField = (f: PlotField | undefined) => !!f && 'builtin' in f && f.builtin === 'test';
  /** The fields a role can take, the ones that would break the plot greyed with why. For X, `at` is the level. */
  const fieldOptions = (role: PlotRole, at = 0): ListSelectOption[] => {
    const raw = role === 'x' ? xLevels()[at] : plot.fields?.[role];
    const current = raw && !('follow' in raw) && !('none' in raw) ? raw : undefined;
    // A field already at another level of the categories is not offered again.
    const others = role === 'x' ? xLevels().filter((_, i) => i !== at) : [];
    // Test divides a set of tests, and means nothing without one.
    const plain = fieldsForRole(o.catalogue, plot.chart, role).filter(f => (ySet() || !isTestField(f.field)) && !others.some(x => sameField(x, f.field))).map(f => {
      // The field already in place stays pickable: it is what the reader is looking at.
      const why = current && sameField(f.field, current) ? undefined : conflictFor(role, f, at);
      return { value: fieldKey(f.field), label: f.label, group: f.group, ...(why ? { disabled: why } : {}) };
    });
    return role === 'y' ? plain : [...plain, ...rangeEntries(role, at)];
  };

  /**
   * A measured value or a number put into ranges, for a role that takes categories: listed beside the fields that are
   * categories already, as "Idsat in ranges". Not on a scatter's colour, which has a gradient for a number.
   */
  const rangeEntries = (role: 'x' | 'color' | 'rows' | 'facet', at = 0): ListSelectOption[] => {
    if (role === 'x' && !(plot.chart === 'box' || plot.chart === 'bar' || plot.chart === 'heatmap')) return [];
    if (role === 'color' && plot.chart === 'scatter') return [];
    const used = [...(role === 'x' ? xLevels().filter((_, i) => i !== at) : xLevels()), ...(plot.fields?.color && isField(plot.fields.color) ? [plot.fields.color] : [])];
    return o.catalogue.filter(f => f.kind === 'numeric' && !f.categorical && f.group !== 'Pass rates' && !isTestSet(f.field) && !used.some(u => sameField(u, f.field))).map(f => {
      const field: PlotField = { binned: f.field };
      const why = role === 'facet' && f.level === 'die' && plot.level === 'wafer' ? `${f.name} is per die: this plot has one mark per wafer`
        : role === 'x' || role === 'color' ? conflictFor(role, { ...f, field, kind: 'categorical', categorical: true }, at) : undefined;
      return { value: fieldKey(field), label: `${f.label} in ranges`, group: f.group, ...(why ? { disabled: why } : {}) };
    });
  };

  const fieldByKey = (key: string): PlotField | undefined => {
    const hit = o.catalogue.find(f => fieldKey(f.field) === key)?.field;
    if (hit || !key.startsWith('binned:')) return hit;
    const inner = o.catalogue.find(f => fieldKey({ binned: f.field }) === key)?.field;
    return inner ? { binned: inner } : undefined;
  };

  /**
   * `select` with, beneath it when the field is in ranges, how many ranges and whether each holds about the same
   * number of values or spans the same width. `edit` changes the binned field wherever it sits in the plot.
   */
  function withRanges(select: HTMLElement, field: PlotField | undefined, hook: string, change: (d: PlotSpec, fn: (b: PlotBinnedField) => void) => void): HTMLElement {
    if (!field || !isBinned(field)) return select;
    const wrap = doc.createElement('div');
    Object.assign(wrap.style, { display: 'flex', flexDirection: 'column', gap: SPACE.xs, minWidth: '0' } as Partial<CSSStyleDeclaration>);
    const line = doc.createElement('div');
    Object.assign(line.style, { display: 'flex', gap: SPACE.sm, alignItems: 'center', minWidth: '0' } as Partial<CSSStyleDeclaration>);
    const count = numberBox(field.bins ?? PLOT_BINS_DEFAULT, 'Number of ranges', v => {
      const n = v === undefined ? PLOT_BINS_DEFAULT : Math.round(v);
      edit(d => change(d, b => { if (n === PLOT_BINS_DEFAULT) delete b.bins; else b.bins = Math.min(PLOT_BINS_MAX, Math.max(PLOT_BINS_MIN, n)); }));
      build();
    });
    count.dataset.wmapPlotBins = hook;
    count.style.width = '64px';
    const label = doc.createElement('span');
    label.textContent = 'ranges';
    Object.assign(label.style, { fontSize: FONT.sub, color: CLR.label } as Partial<CSSStyleDeclaration>);
    const how = makeSegmented([['count', 'Equal counts', 'Each range holds about the same number of values (quartiles, deciles)'], ['width', 'Equal widths', 'Each range spans the same width of values']],
      field.by ?? 'count', v => edit(d => change(d, b => { if (v === 'count') delete b.by; else b.by = 'width'; })), doc);
    line.append(count, label, how);
    wrap.append(select, line);
    return wrap;
  }

  /** A select for an X or Y role. A saved field the lot lacks, or one this chart type cannot use, stays selectable so the plot can be read. */
  function fieldSelect(role: 'x' | 'y', ariaLabel: string, opts: { optional?: string; at?: number } = {}): HTMLElement {
    const at = opts.at ?? 0;
    const current = role === 'x' ? xLevels()[at] : plot.fields!.y;
    const options = fieldOptions(role, at);
    if (opts.optional) options.unshift({ value: COUNT, label: opts.optional, group: 'Count' });
    // Several tests at once: the values of any chart but a scatter, which needs one value for each axis.
    const sets = role === 'y' && plot.chart !== 'scatter' && lotTests().length >= 2;
    if (sets) options.unshift({ value: SET, label: 'Several tests…', group: 'Several tests' });
    if (current && !isTestSet(current) && !options.some(p => p.value === fieldKey(current))) {
      const inLot = o.catalogue.some(f => sameField(f.field, current));
      const name = 'test' in current ? (current.name ?? `Test ${current.test}`) : 'meta' in current ? current.meta : 'builtin' in current ? current.builtin : '';
      options.unshift({ value: fieldKey(current), label: `${name} (${inLot ? 'not usable here' : 'not in this lot'})`, group: 'Saved' });
    }
    const value = current ? (isTestSet(current) ? SET : fieldKey(current)) : opts.optional ? COUNT : '';
    const sel = makeListSelect(options, value, key => {
      if (key === COUNT) { edit(d => { delete d.fields![role]; }); return; }
      if (key === SET) { if (!ySet()) { chooseSet(); build(); } return; }
      const f = fieldByKey(key) ?? current;
      if (!f) return;
      const leavingSet = role === 'y' && !!ySet();
      edit(d => {
        if (role === 'x') { const levels = xLevels(d); levels[at] = f; setXLevels(d, levels); } else d.fields!.y = f;
        if (!leavingSet) return;
        // One test again: the field that divided the set has nothing left to divide.
        const levels = xLevels(d), kept = levels.filter(l => !isTestField(l));
        if (kept.length !== levels.length) setXLevels(d, kept.length || !(d.chart === 'box' || d.chart === 'bar') ? kept : [{ builtin: 'wafer' }]);
        if (isTestField(d.fields!.color as PlotField | undefined)) delete d.fields!.color;
      });
      if (leavingSet || isBinned(f) || (current && isBinned(current))) build();
    }, { maxWidth: '100%', ownerDocument: doc, ariaLabel, emptyText: 'Choose a field…', searchPlaceholder: 'Filter fields…', hook: role === 'x' && at > 0 ? `plot-x-${at + 1}` : `plot-${role}` });
    sel.style.width = '100%';
    return sel;
  }

  /** Y becomes a set of the lot's first tests, divided by test along X for a box or bar (by colour otherwise). */
  function chooseSet(): void {
    const defs = lotTests();
    const set = withTestSetNames({ tests: defs.slice(0, SET_START).map(d => d.testNumber) }, defs);
    edit(d => {
      d.fields!.y = set;
      const levels = xLevels(d);
      if ((d.chart === 'box' || d.chart === 'bar') && (levels.length === 0 || (levels.length === 1 && sameField(levels[0], { builtin: 'wafer' })))) d.fields!.x = { builtin: 'test' };
    });
  }

  /** The tests of a set, typed as a sweep's are: numbers, or ranges of the declared tests between two numbers. */
  function testSetBox(set: PlotTestSet): HTMLElement {
    const wrap = doc.createElement('div');
    Object.assign(wrap.style, { display: 'flex', flexDirection: 'column', gap: SPACE.xxs } as Partial<CSSStyleDeclaration>);
    const input = doc.createElement('input');
    input.type = 'text';
    input.value = formatTestList(set.tests);
    input.placeholder = '1010, 1011, 1020..1030';
    input.setAttribute('aria-label', 'Tests');
    input.dataset.wmapPlotTests = '1';
    Object.assign(input.style, inputStyle(), { width: '100%', fontVariantNumeric: 'tabular-nums' } as Partial<CSSStyleDeclaration>);
    const error = doc.createElement('div');
    error.setAttribute('role', 'alert');
    Object.assign(error.style, { fontSize: FONT.sub, color: CLR.errText } as Partial<CSSStyleDeclaration>);
    input.addEventListener('input', () => {
      const r = parseTestList(input.value);
      const problem = !r.ok ? r.error : r.value.length === 0 ? 'Name at least one test' : undefined;
      error.textContent = problem ?? '';
      input.setAttribute('aria-invalid', String(!!problem));
      input.style.borderColor = problem ? CLR.errText : CLR.menuBorder;
      if (problem || !r.ok) return;
      const tests = r.value;
      edit(d => { d.fields!.y = withTestSetNames({ tests }, lotTests()); });
    });
    input.addEventListener('keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); input.blur(); } });
    wrap.append(input, error);
    return wrap;
  }

  /**
   * The categories of a box or bar: one field, or several nested, outer first. Each level has its field list and, once
   * there are two, buttons to move it out or in a level and to remove it; Add a level appends the next. The order is the
   * nesting: the first level's values are the groups, the last level's are the boxes within them.
   */
  function categoriesBlock(): HTMLElement {
    const levels = xLevels();
    const wrap = doc.createElement('div');
    wrap.dataset.wmapPlotLevels = '1';
    Object.assign(wrap.style, { display: 'flex', flexDirection: 'column', gap: SPACE.xs, minWidth: '0' } as Partial<CSSStyleDeclaration>);
    const nameAt = (i: number) => { const f = levels[i]; return (f && o.catalogue.find(c => sameField(c.field, f))?.name) ?? `level ${i + 1}`; };
    const levelButton = (text: string, label: string, hook: string, disabled: boolean, act: () => void): HTMLButtonElement => {
      const b = doc.createElement('button');
      b.type = 'button';
      b.textContent = text;
      b.setAttribute('aria-label', label);
      b.dataset.wmapPlotLevel = hook;
      b.disabled = disabled;
      wireTooltip(b, label);
      Object.assign(b.style, controlStyle('outlined'), { minWidth: '28px', opacity: disabled ? '0.4' : '1' } as Partial<CSSStyleDeclaration>);
      wireControlHover(b);
      b.addEventListener('click', act);
      return b;
    };
    /**
     * Rebuilds and puts focus back on the level that moved, so a keyboard reader can keep moving it: on the same button
     * when it can still be used, else the first of `hooks` that can (a level moved to the top cannot move further out).
     */
    const refocus = (...hooks: string[]) => {
      build();
      for (const h of hooks) { const b = root.querySelector<HTMLButtonElement>(`[data-wmap-plot-level="${h}"]`); if (b && !b.disabled) { b.focus(); return; } }
    };
    const move = (i: number, by: -1 | 1) => {
      edit(d => { const l = xLevels(d); [l[i], l[i + by]] = [l[i + by], l[i]]; setXLevels(d, l); });
      const at = i + by;
      refocus(`${by < 0 ? 'out' : 'in'}:${at}`, `${by < 0 ? 'in' : 'out'}:${at}`);
    };
    const count = Math.max(1, levels.length);
    for (let i = 0; i < count; i++) {
      const line = doc.createElement('div');
      Object.assign(line.style, { display: 'flex', gap: SPACE.xs, alignItems: 'center', minWidth: '0' } as Partial<CSSStyleDeclaration>);
      const sel = withRanges(fieldSelect('x', count > 1 ? `Categories, level ${i + 1} of ${count}` : 'Categories', { at: i }), levels[i], `x-${i + 1}`, (d, fn) => {
        const l = xLevels(d), b = l[i];
        if (b && isBinned(b)) { fn(b); setXLevels(d, l); }
      });
      Object.assign(sel.style, { flex: '1', minWidth: '0' } as Partial<CSSStyleDeclaration>);
      line.appendChild(sel);
      if (levels.length > 1) {
        line.append(
          levelButton('↑', `Move ${nameAt(i)} out a level`, `out:${i}`, i === 0, () => move(i, -1)),
          levelButton('↓', `Move ${nameAt(i)} in a level`, `in:${i}`, i === levels.length - 1, () => move(i, 1)),
          levelButton('×', `Remove ${nameAt(i)} from the categories`, `remove:${i}`, false, () => {
            edit(d => { const l = xLevels(d); l.splice(i, 1); setXLevels(d, l); });
            // One level left has no buttons: focus goes to its field list.
            refocus(`remove:${Math.min(i, levels.length - 2)}`);
            if (levels.length - 1 < 2) root.querySelector<HTMLElement>('[data-wmap-select="plot-x"]')?.focus();
          }),
        );
      }
      wrap.appendChild(line);
    }
    // The next level: the first field the plot can take there, so the reader changes it rather than starting blank.
    const next = levels.length < PLOT_X_LEVELS && levels.length > 0 ? fieldOptions('x', levels.length).find(f => !f.disabled) : undefined;
    const add = doc.createElement('button');
    add.type = 'button';
    add.textContent = '+ Add a level';
    add.dataset.wmapPlotLevelAdd = '1';
    add.disabled = !next;
    const why = levels.length >= PLOT_X_LEVELS ? `At most ${PLOT_X_LEVELS} levels` : !next ? 'No other field can divide these categories' : 'Divide each category by another field, nested inside it';
    wireTooltip(add, why);
    Object.assign(add.style, controlStyle('outlined'), { alignSelf: 'flex-start', opacity: add.disabled ? '0.4' : '1' } as Partial<CSSStyleDeclaration>);
    wireControlHover(add);
    add.addEventListener('click', () => {
      const f = next && fieldByKey(next.value);
      if (!f) return;
      edit(d => { setXLevels(d, [...xLevels(d), f]); });
      build();
      root.querySelector<HTMLElement>(`[data-wmap-select="plot-x-${levels.length + 1}"]`)?.focus();
    });
    wrap.appendChild(add);
    return wrap;
  }

  /** Remembers a field a chart type could not use, so flipping back restores it rather than losing it. */
  const stash: Partial<Record<'x' | 'y', PlotField | PlotField[]>> = {};
  /** Fields chosen for the reader when a type needed one, as against fields the reader picked: only the latter are worth keeping. */
  const supplied: Partial<Record<'x' | 'y', PlotField>> = {};

  function changeChart(next: PlotSpec['chart']): void {
    edit(d => {
      d.chart = next;
      for (const role of ['x', 'y'] as const) {
        const options = fieldsForRole(o.catalogue, next, role);
        const one = (f: PlotField | undefined) => !!f && (isTestSet(f) ? role === 'y' && next !== 'scatter' : isBinned(f) ? role === 'x' && (next === 'box' || next === 'bar' || next === 'heatmap') : options.some(p => sameField(p.field, f)));
        // Nested categories belong to a box or bar; any other chart keeps them aside for the way back.
        const usable = (f: PlotField | PlotField[] | undefined) => (Array.isArray(f) ? (next === 'box' || next === 'bar') && f.every(one) : one(f));
        const current = d.fields![role];
        if (current && !usable(current)) {
          if (Array.isArray(current) || !sameField(current, supplied[role])) stash[role] = current;
          delete d.fields![role];
        }
        if (d.fields![role] || (role === 'y' && (next === 'bar' || next === 'goal' || next === 'heatmap'))) continue;
        const back = stash[role];
        if (usable(back)) {
          if (role === 'x') d.fields!.x = back; else d.fields!.y = back as PlotField;
          delete stash[role]; delete supplied[role]; continue;
        }
        const pick = role === 'x' && (next === 'box' || next === 'bar' || next === 'heatmap') ? { builtin: 'wafer' } as PlotField
          : role === 'x' && (next === 'line' || next === 'control') ? (options.find(p => p.group === 'Wafer')?.field ?? options[0]?.field)
          : options[0]?.field;
        if (pick && !(role === 'x' && (next === 'histogram' || next === 'probability' || next === 'goal'))) { d.fields![role] = pick; supplied[role] = pick; }
      }
    });
    build();
  }

  function aggregateSelect(): HTMLElement {
    const yIsYield = !!plot.fields!.y && 'builtin' in plot.fields!.y && plot.fields!.y.builtin === 'yield';
    const options: ListSelectOption[] = [{ value: AUTO, label: 'Automatic' }, ...(['mean', 'median', 'min', 'max', 'sum', 'count'] as const).map(k => ({ value: k, label: AGGREGATE_LABEL[k] }))];
    if (yIsYield) options.push({ value: 'yield', label: AGGREGATE_LABEL.yield });
    const sel = makeListSelect(options, plot.aggregate ?? AUTO, key => edit(d => {
      if (key === AUTO) delete d.aggregate; else d.aggregate = key as PlotSpec['aggregate'];
    }), { maxWidth: '100%', ownerDocument: doc, ariaLabel: 'Combine values by', hook: 'plot-aggregate' });
    sel.style.width = '100%';
    return sel;
  }

  function colourSelect(): HTMLElement {
    const c = plot.fields!.color;
    const follow = o.followLabel();
    const opts: ListSelectOption[] = [
      { value: FOLLOW, label: follow ? `Follow Group by (${follow})` : 'Follow Group by (single colour)', group: 'Colour' },
      { value: NONE, label: 'None', group: 'Colour' },
      ...fieldOptions('color'),
    ];
    const value = c === undefined || 'follow' in c ? FOLLOW : 'none' in c ? NONE : fieldKey(c);
    const sel = makeListSelect(opts, value, key => {
      edit(d => {
        if (key === FOLLOW) delete d.fields!.color;
        else if (key === NONE) d.fields!.color = { none: true };
        else { const f = fieldByKey(key); if (f) d.fields!.color = f; }
      });
      if (key.startsWith('binned:') || value.startsWith('binned:')) build();
    }, { maxWidth: '100%', ownerDocument: doc, ariaLabel: 'Colour', searchPlaceholder: 'Filter fields…', hook: 'plot-color' });
    sel.style.width = '100%';
    return withRanges(sel, c && isField(c) ? c : undefined, 'color', (d, fn) => { const b = d.fields!.color; if (b && isField(b) && isBinned(b)) fn(b); });
  }

  /** A heatmap's rows: a category other than the columns; Test only with a set of tests as the values. */
  function rowsSelect(): HTMLElement {
    const current = plot.fields!.rows;
    const options: ListSelectOption[] = o.catalogue
      .filter(f => f.categorical && !xLevels().some(x => sameField(x, f.field)) && (!isTestField(f.field) || ySet()))
      .map(f => ({ value: fieldKey(f.field), label: f.label, group: f.group }));
    options.push(...rangeEntries('rows'));
    const value = current ? fieldKey(current) : ySet() ? fieldKey({ builtin: 'test' }) : '';
    const sel = makeListSelect(options, value, key => {
      const f = fieldByKey(key);
      if (!f) return;
      edit(d => { d.fields!.rows = f; });
      if (key.startsWith('binned:') || value.startsWith('binned:')) build();
    }, { maxWidth: '100%', ownerDocument: doc, ariaLabel: 'Rows', emptyText: 'Choose a field…', searchPlaceholder: 'Filter fields…', hook: 'plot-rows' });
    sel.style.width = '100%';
    return withRanges(sel, current, 'rows', (d, fn) => { const b = d.fields!.rows; if (b && isBinned(b)) fn(b); });
  }

  /**
   * Panels: one per value of a category field. Offered: any category the plot does not already use on X or the colour
   * (Test only when the values are a set of tests); a per-die field is greyed while the plot has one mark per wafer.
   */
  function panelsSelect(): HTMLElement {
    const current = plot.fields!.facet;
    const used = [...xLevels(), ...(plot.fields!.color && isField(plot.fields!.color) ? [plot.fields!.color] : [])];
    const options: ListSelectOption[] = [{ value: NONE, label: 'None: one plot', group: 'Panels' }];
    for (const f of o.catalogue) {
      if (!f.categorical || used.some(u => sameField(u, f.field))) continue;
      if (isTestField(f.field) && !ySet()) continue;
      const why = f.level === 'die' && plot.level === 'wafer' ? `${f.name} is per die: this plot has one mark per wafer` : undefined;
      options.push({ value: fieldKey(f.field), label: f.label, group: f.group, ...(why ? { disabled: why } : {}) });
    }
    options.push(...rangeEntries('facet'));
    const was = current ? fieldKey(current) : NONE;
    const sel = makeListSelect(options, was, key => {
      edit(d => {
        if (key === NONE) delete d.fields!.facet;
        else { const f = fieldByKey(key); if (f) d.fields!.facet = f; }
      });
      if (key.startsWith('binned:') || was.startsWith('binned:')) build();
    }, { maxWidth: '100%', ownerDocument: doc, ariaLabel: 'Panels', searchPlaceholder: 'Filter fields…', hook: 'plot-facet' });
    sel.style.width = '100%';
    return withRanges(sel, current, 'facet', (d, fn) => { const b = d.fields!.facet; if (b && isBinned(b)) fn(b); });
  }

  /** The plot's filter: conditions that must all hold, edited by the one filter editor (filterEditor.ts). */
  function whereBlock(): HTMLElement {
    const ed = buildFilterEditor({
      doc, catalogue: o.catalogue, filter: plot.where, testDefs: o.testDefs, attributes: o.attributes, switchLabel: 'Filter this plot',
      valuesOf: f => o.valuesOf?.(f) ?? [], extentOf: f => o.extentOf?.(f),
      onChange: f => edit(d => { if (f) d.where = f; else delete d.where; }),
    });
    ed.el.dataset.wmapPlotWhere = '1';
    return ed.el;
  }

  function textBox(value: string, placeholder: string, label: string, commit: (v: string) => void): HTMLInputElement {
    const input = doc.createElement('input');
    input.type = 'text';
    input.value = value;
    input.placeholder = placeholder;
    input.setAttribute('aria-label', label);
    Object.assign(input.style, inputStyle(), { width: '100%' } as Partial<CSSStyleDeclaration>);
    input.addEventListener('input', () => commit(input.value));
    input.addEventListener('keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); input.blur(); } });
    return input;
  }

  function numberBox(value: number | undefined, label: string, commit: (v: number | undefined) => void): HTMLInputElement {
    const input = doc.createElement('input');
    input.type = 'text';
    input.inputMode = 'decimal';
    input.value = value === undefined ? '' : String(value);
    input.placeholder = 'auto';
    input.setAttribute('aria-label', label);
    Object.assign(input.style, inputStyle(), { width: '100%', fontVariantNumeric: 'tabular-nums' } as Partial<CSSStyleDeclaration>);
    const apply = () => {
      const t = input.value.trim();
      if (t === '') { commit(undefined); return; }
      const n = Number(t);
      if (Number.isFinite(n)) commit(n); else input.value = value === undefined ? '' : String(value);
    };
    input.addEventListener('change', apply);
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') apply();
      if (e.key === 'Escape') { e.stopPropagation(); input.value = value === undefined ? '' : String(value); input.blur(); }
    });
    return input;
  }

  function axisBlock(role: 'x' | 'y', title: string, autoLabel: string | undefined, opts: { scale: boolean; limits?: boolean; references?: boolean }): HTMLElement {
    const ax: PlotAxis = plot.axes?.[role] ?? {};
    const setAxis = (fn: (a: PlotAxis) => void) => edit(d => {
      d.axes = d.axes ?? {};
      const a = (d.axes[role] = d.axes[role] ?? {});
      fn(a);
      for (const k of Object.keys(a) as Array<keyof PlotAxis>) if (a[k] === undefined || a[k] === '' || (k === 'reverse' && a[k] === false)) delete a[k];
      if (Object.keys(a).length === 0) delete d.axes![role];
      if (Object.keys(d.axes).length === 0) delete d.axes;
    });
    const wrap = doc.createElement('div');
    Object.assign(wrap.style, { display: 'flex', flexDirection: 'column', gap: SPACE.md, padding: SPACE.lg, border: `1px solid ${CLR.menuBorder}`, borderRadius: RADIUS.control } as Partial<CSSStyleDeclaration>);
    const head = doc.createElement('div');
    head.textContent = title;
    Object.assign(head.style, { fontSize: FONT.body, fontWeight: '600', color: CLR.value } as Partial<CSSStyleDeclaration>);
    wrap.appendChild(head);
    const titleBox = textBox(ax.label ?? '', autoLabel ?? '', `${title} title`, v => setAxis(a => { a.label = v.trim() === '' ? undefined : v; }));
    titleBox.dataset.wmapPlotAxisTitle = role;
    wrap.appendChild(row('Title', titleBox));
    // A category axis has a title only: its slots are the categories, so there is nothing to limit or reverse.
    if (opts.limits === false) return wrap;
    const limits = doc.createElement('div');
    Object.assign(limits.style, { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: SPACE.md } as Partial<CSSStyleDeclaration>);
    limits.append(
      row('Minimum', numberBox(ax.min, `${title} minimum`, v => setAxis(a => { a.min = v; }))),
      row('Maximum', numberBox(ax.max, `${title} maximum`, v => setAxis(a => { a.max = v; }))),
    );
    wrap.appendChild(limits);
    if (opts.scale) {
      wrap.appendChild(row('Scale', makeSegmented([['linear', 'Linear'], ['log', 'Log']], ax.scale ?? 'linear', v => setAxis(a => { a.scale = v === 'log' ? 'log' : undefined; }), doc)));
    }
    wrap.appendChild(makeToggle('Reverse direction', !!ax.reverse, v => setAxis(a => { a.reverse = v; }), doc));
    // Lines and bands the reader adds: `0.45 Target, 0.3..0.5 Window`, in the axis's own unit. Only on an axis the chart draws them on.
    if (opts.references === false) return wrap;
    const refs = textBox(formatReferences(ax.references), '0.45 Target, 0.3..0.5 Window, median', `${title} reference lines`, v => {
      const parsed = parseReferences(v);
      if (!parsed.ok) { refsError.textContent = parsed.error; refs.setAttribute('aria-invalid', 'true'); return; }
      refsError.textContent = ''; refs.removeAttribute('aria-invalid');
      setAxis(a => { a.references = parsed.value.length ? parsed.value : undefined; });
    });
    refs.dataset.wmapPlotRefs = role;
    const refsError = doc.createElement('div');
    refsError.setAttribute('role', 'alert');
    Object.assign(refsError.style, { fontSize: FONT.sub, color: CLR.errText } as Partial<CSSStyleDeclaration>);
    const refsRow = row('Reference lines', refs, 'A value for a line, or lo..hi for a shaded band, each with an optional name, in the axis’s own unit.');
    refsRow.appendChild(refsError);
    wrap.appendChild(refsRow);
    return wrap;
  }

  const tabButton = (key: 'setup' | 'customise'): HTMLElement | null => root.querySelector(`[role="tab"][data-tab="${key}"]`);
  let titleBoxEl: HTMLInputElement | undefined;
  let driftEl: HTMLElement | undefined;
  const axisBoxes = new Map<string, HTMLInputElement>();

  /** A typed title that no longer describes its plot: say so, and offer the automatic one. */
  function syncDrift(): void {
    if (!driftEl) return;
    const text = describeTitleDrift(titleDrift(plot, o.catalogue));
    driftEl.replaceChildren();
    driftEl.style.display = text ? 'flex' : 'none';
    if (!text) return;
    const t = doc.createElement('span');
    t.textContent = text;
    const use = doc.createElement('button');
    use.type = 'button';
    use.textContent = 'Use the automatic title';
    use.dataset.wmapPlotAutoTitle = '1';
    Object.assign(use.style, controlStyle('outlined'));
    wireControlHover(use);
    use.addEventListener('click', () => { edit(d => { delete d.title; }); build(); });
    driftEl.append(t, use);
  }

  function build(): void {
    root.replaceChildren();
    axisBoxes.clear();
    const tabs = doc.createElement('div');
    tabs.setAttribute('role', 'tablist');
    Object.assign(tabs.style, { display: 'flex', gap: SPACE.sm, borderBottom: `1px solid ${CLR.menuBorder}` } as Partial<CSSStyleDeclaration>);
    for (const [key, label, hint] of [['setup', 'Setup', 'Which fields to plot and how they are combined'], ['customise', 'Customise', 'Titles, axis limits, scale and direction']] as const) {
      const b = doc.createElement('button');
      b.type = 'button';
      b.textContent = label;
      wireTooltip(b, hint);
      b.setAttribute('role', 'tab');
      b.dataset.tab = key;
      b.setAttribute('aria-selected', String(tab === key));
      Object.assign(b.style, {
        ...controlStyle('bare'), padding: `${SPACE.sm} ${SPACE.lg}`, fontSize: FONT.body,
        borderBottom: `2px solid ${tab === key ? CLR.iconActive : 'transparent'}`, borderRadius: '0',
        color: tab === key ? CLR.iconActive : CLR.text, fontWeight: tab === key ? '600' : '400',
      } as Partial<CSSStyleDeclaration>);
      wireControlHover(b, 'bare');
      b.tabIndex = tab === key ? 0 : -1;
      b.addEventListener('click', () => { tab = key; build(); });
      // Arrow keys move between the tabs, the way a tab list is operated.
      b.addEventListener('keydown', e => {
        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
        e.preventDefault();
        tab = key === 'setup' ? 'customise' : 'setup';
        build();
        tabButton(tab)?.focus();
      });
      tabs.appendChild(b);
    }
    root.appendChild(tabs);

    const panel = doc.createElement('div');
    panel.setAttribute('role', 'tabpanel');
    Object.assign(panel.style, { display: 'flex', flexDirection: 'column', gap: SPACE.lg } as Partial<CSSStyleDeclaration>);

    if (tab === 'setup') {
      panel.appendChild(row('Chart type', makeSegmented(CHART_OPTIONS, plot.chart, v => changeChart(v as PlotSpec['chart']), doc, true)));
      const noun = plot.level === 'wafer' ? 'wafers' : 'dies';
      switch (plot.chart) {
        case 'scatter':
          panel.appendChild(row('X axis', fieldSelect('x', 'X axis')));
          panel.appendChild(row('Y axis', fieldSelect('y', 'Y axis')));
          break;
        case 'histogram':
          panel.appendChild(row('Values', fieldSelect('y', 'Values')));
          break;
        case 'control':
          panel.appendChild(row('Along (X axis)', fieldSelect('x', 'Along'), 'A wafer field with a number per wafer: wafer order, slot, a date.'));
          panel.appendChild(row('Values (Y axis)', fieldSelect('y', 'Values'), 'One value per wafer: a test’s wafer mean (or as Combine values by says), a yield or a pass rate.'));
          panel.appendChild(row('Limits from the first', numberBox(plot.baseline, 'Wafers the limits are set from', v => edit(d => {
            if (v === undefined || !Number.isInteger(v) || v < 3) delete d.baseline; else d.baseline = v;
          })), 'Wafers, at least 3. Empty sets the limits from every wafer.'));
          break;
        case 'heatmap':
          panel.appendChild(row('Columns (X axis)', fieldSelect('x', 'Columns'), 'One column per value: wafer, split, site…'));
          panel.appendChild(row('Rows', rowsSelect(), 'One row per value. With several tests as the values, Test gives a row per test.'));
          panel.appendChild(row('Values (colour)', fieldSelect('y', 'Values', { optional: `Count of ${noun}` }), 'What each cell’s colour shows, combined over its dies or wafers.'));
          break;
        case 'goal':
          panel.appendChild(row('Tests', fieldSelect('y', 'Tests', { optional: 'Every test with both limits' }), 'Each test with both a low and a high limit is a point. Colour by a split to see it move.'));
          break;
        case 'probability':
          panel.appendChild(row('Values (X axis)', fieldSelect('y', 'Values'), 'One curve per colour, each value at its share of its group: a shift is a curve moved sideways, a wider spread a flatter one, a second population a bend.'));
          break;
        case 'box':
          panel.appendChild(row('Categories (X axis)', categoriesBlock(), 'Compare by this field: one box per value, whether it is a wafer attribute (lot, split) or a die region (ring, reticle cell). Add a level to nest another inside it: the first level is the outer groups.'));
          panel.appendChild(row('Values (Y axis)', fieldSelect('y', 'Values')));
          break;
        case 'bar':
          panel.appendChild(row('Categories (X axis)', categoriesBlock(), 'Compare by this field: one bar per value, whether it is a wafer attribute (lot, split) or a die region (ring, reticle cell). Add a level to nest another inside it: the first level is the outer groups.'));
          panel.appendChild(row('Values (Y axis)', fieldSelect('y', 'Values', { optional: `Count of ${noun}` })));
          break;
        case 'line':
          panel.appendChild(row('X axis', fieldSelect('x', 'X axis'), 'A line joins the value at each X.'));
          panel.appendChild(row('Y axis', fieldSelect('y', 'Y axis')));
          break;
      }
      const set = ySet();
      if (set && plot.chart !== 'scatter') {
        panel.appendChild(row('Tests', testSetBox(set), 'Test numbers, or a range such as 1010..1030 for the tests declared between them. Put Test on the X axis or the colour to tell them apart.'));
        if (plot.chart === 'bar' || plot.chart === 'line') {
          panel.appendChild(row('Read as', makeSegmented([[AUTO, 'Values', 'Each test’s measured values'], ['passRate', 'Pass rates', 'Each test’s share of judged dies that pass it']],
            set.passRate ? 'passRate' : AUTO, v => { edit(d => {
              const y = d.fields!.y;
              if (!isTestSet(y)) return;
              const next: PlotTestSet = { ...y };
              if (v === AUTO) { delete next.passRate; delete next.judge; } else { next.passRate = true; delete d.normalize; }
              d.fields!.y = next;
            }); build(); }, doc)));
        }
      }
      // A pass rate (one test's or a set's) is judged by the test limits or by the tester's recorded flag.
      const judged = plot.fields!.y;
      if (judged && (isPassRateSet(judged) || (!isTestSet(judged) && 'passRate' in judged))) {
        panel.appendChild(row('Judged by', makeSegmented([[AUTO, 'Test limits', 'A parametric test’s measured value against its test limits'], ['flag', 'Tester flag', 'The pass or fail the tester recorded for each die']],
          (judged as { judge?: string }).judge ?? AUTO, v => edit(d => {
            const y = { ...(d.fields!.y as Record<string, unknown>) };
            if (v === AUTO) delete y.judge; else y.judge = 'flag';
            d.fields!.y = y as unknown as PlotField;
          }), doc), 'A functional test is judged by its recorded verdict either way.'));
      }
      panel.appendChild(row('Colour', colourSelect(), 'Compare by this field: each value gets its own colour. Follow Group by takes it from the Group by control.'));
      panel.appendChild(row('Filter', whereBlock(), 'Keep only the dies that meet every condition: bin 1, the edge ring, a range of a test. A condition on a wafer field (split, yield) keeps whole wafers.'));
      if (plot.chart === 'line') {
        panel.appendChild(row('Band', makeSegmented([[AUTO, 'None'], ['sd', '±1 SD', 'Mean ± one standard deviation of the values at each X'], ['ci95', '95% CI', 'The mean’s 95% confidence interval (Student’s t)'], ['iqr', 'Quartiles'], ['minmax', 'Range']],
          plot.spread ?? AUTO, v => edit(d => { if (v === AUTO) delete d.spread; else d.spread = v as PlotSpec['spread']; }), doc), 'Round a line of means or medians.'));
      }
      panel.appendChild(row('Panels', panelsSelect(), 'One panel per value of this field, on shared axes and colours: split or lot takes whole wafers, ring or site the dies in it.'));
      // A scatter's fitted lines and y = x; a histogram's bars as shares, and its normal curves.
      if (plot.chart === 'scatter') {
        panel.appendChild(row('Fit line', makeSegmented([[AUTO, 'None'], ['linear', 'Least squares', 'Y on X: the usual regression line'], ['orthogonal', 'Orthogonal', 'Closest to the points at right angles: for two measurements of one quantity (two testers, two insertions)']],
          plot.fit ?? AUTO, v => edit(d => { if (v === AUTO) delete d.fit; else d.fit = v as 'linear' | 'orthogonal'; }), doc), 'One line per colour, with its equation, R² and n above the chart.'));
        panel.appendChild(makeToggle('y = x line', !!plot.identity, v => edit(d => { if (v) d.identity = true; else delete d.identity; }), doc));
      }
      if (plot.chart === 'histogram') {
        panel.appendChild(row('Bars as', makeSegmented([[AUTO, 'Counts'], ['percent', 'Shares', 'Each colour’s bars as a share of its own values, so groups of different size compare']],
          plot.histNorm === 'percent' ? 'percent' : AUTO, v => edit(d => { if (v === AUTO) delete d.histNorm; else d.histNorm = 'percent'; }), doc)));
        panel.appendChild(makeToggle('Normal curve', !!plot.normalCurve, v => edit(d => { if (v) d.normalCurve = true; else delete d.normalCurve; }), doc));
      }
      // What-if limits: proposed limits for the plotted test, in its own unit.
      const yv = plot.fields!.y;
      if ((plot.chart === 'histogram' || plot.chart === 'probability') && yv && 'test' in yv && !plot.normalize) {
        const limits = doc.createElement('div');
        Object.assign(limits.style, { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: SPACE.md } as Partial<CSSStyleDeclaration>);
        const setWhatIf = (k: 'lo' | 'hi') => (v: number | undefined) => edit(d => {
          const w = { ...(d.whatIf ?? {}) };
          if (v === undefined) delete w[k]; else w[k] = v;
          if (w.lo === undefined && w.hi === undefined) delete d.whatIf; else d.whatIf = w;
        });
        limits.append(row('Low', numberBox(plot.whatIf?.lo, 'What-if low limit', setWhatIf('lo'))), row('High', numberBox(plot.whatIf?.hi, 'What-if high limit', setWhatIf('hi'))));
        panel.appendChild(row('What-if limits', limits, 'In the test’s own unit (V, A…). The line under the plot gives the test’s pass rate now and with these, and the dies that change.'));
      }
      // How a box or bar lays out its categories: order, how many, a bar's colours stacked, a pareto line.
      if (plot.chart === 'box' || plot.chart === 'bar') {
        panel.appendChild(row('Orientation', makeSegmented([[AUTO, 'Vertical', 'Categories along the bottom'], ['horizontal', 'Horizontal', 'Categories down the left: for many categories or long names']],
          plot.orientation === 'horizontal' ? 'horizontal' : AUTO, v => edit(d => { if (v === AUTO) delete d.orientation; else d.orientation = 'horizontal'; }), doc)));
        const single = xLevels().length <= 1;
        if (single) {
          panel.appendChild(row('Order', makeSegmented([[AUTO, 'Field order', 'The field’s own order: wafers as loaded, numbers by value, names naturally'], ['value', 'Largest first', plot.chart === 'box' ? 'By median, largest first' : 'By value, largest first (a pareto)'],
            ['ascending', 'Smallest first', plot.chart === 'box' ? 'By median, smallest first' : 'By value, smallest first (the worst pass rate at the top)']],
            plot.sort ?? AUTO, v => { edit(d => { if (v === AUTO) { delete d.sort; delete d.cumulative; } else { d.sort = v as 'value' | 'ascending'; if (v === 'ascending') delete d.cumulative; } }); build(); }, doc)));
          panel.appendChild(row('Show the first', numberBox(plot.top, 'Categories shown', v => edit(d => {
            if (v === undefined || !Number.isInteger(v) || v < 1) delete d.top; else d.top = v;
          })), 'Leave empty for every category; the rest are counted in a note.'));
        }
        if (plot.chart === 'bar') {
          panel.appendChild(row('Colours', makeSegmented([[AUTO, 'Side by side'], ['share', 'Share of colour', 'Side by side, each colour as its share of its own total, so groups of different sizes compare'],
            ['stack', 'Stacked', 'One bar per category, its colours one on another'], ['percent', '100%', 'Each colour as its share of the category']],
            plot.stack ?? (plot.barNorm === 'percent' ? 'share' : AUTO), v => edit(d => {
              delete d.stack; delete d.barNorm;
              if (v === 'share') d.barNorm = 'percent'; else if (v !== AUTO) d.stack = v as 'stack' | 'percent';
            }), doc), 'Shares and stacking add values, so they need a count or a sum.'));
          if (single && plot.sort === 'value') {
            panel.appendChild(makeToggle('Cumulative line (pareto)', !!plot.cumulative, v => edit(d => { if (v) d.cumulative = true; else delete d.cumulative; }), doc));
          }
          panel.appendChild(makeToggle('Values on the bars', !!plot.valueLabels, v => edit(d => { if (v) d.valueLabels = true; else delete d.valueLabels; }), doc,
            'Each bar’s value at its end. Shown only when every value fits its bar, so none is left unlabelled.'));
        }
      }
      const y = plot.fields!.y;
      if (plot.chart !== 'scatter' && y && (isTestSet(y) || 'test' in y)) {
        panel.appendChild(row('Rescale values', makeSegmented(NORMALIZE_OPTIONS, plot.normalize ?? AUTO, v => {
          edit(d => { if (v === AUTO) delete d.normalize; else d.normalize = v as PlotNormalize; });
        }, doc), set ? 'Tests in different units share one axis only once they are rescaled.' : undefined));
      }
      // How values become marks. Hidden where it cannot matter, so the common plot has no extra controls.
      if (plot.chart === 'bar' || plot.chart === 'line' || plot.chart === 'control' || plot.chart === 'heatmap' || plot.level === 'wafer') panel.appendChild(row('Combine values by', aggregateSelect()));
      panel.appendChild(row('One mark per', makeSegmented([[AUTO, 'Automatic'], ['die', 'Die'], ['wafer', 'Wafer']], plot.level ?? AUTO, v => {
        edit(d => { if (v === AUTO) delete d.level; else d.level = v as 'die' | 'wafer'; });
        build();
      }, doc, true), plot.level === 'wafer' ? 'Die-level values are combined per wafer.' : 'Automatic uses the finest level the chosen fields allow.'));
    } else {
      titleBoxEl = textBox(plot.title ?? '', o.autoText().title, 'Plot title', v => { edit(d => { if (v.trim() === '') delete d.title; else Object.assign(d, { title: v }); }); syncDrift(); });
      titleBoxEl.dataset.wmapPlotTitle = '1';
      driftEl = doc.createElement('div');
      driftEl.dataset.wmapPlotTitleDrift = '1';
      Object.assign(driftEl.style, { display: 'none', flexDirection: 'column', gap: SPACE.sm, alignItems: 'flex-start', padding: `${SPACE.sm} ${SPACE.md}`,
        background: CLR.warnBg, border: `1px solid ${CLR.warnBorder}`, borderRadius: RADIUS.control, color: CLR.warnText, fontSize: FONT.body } as Partial<CSSStyleDeclaration>);
      panel.appendChild(row('Title', titleBoxEl));
      panel.appendChild(driftEl);
      syncDrift();
      const auto = o.autoText();
      const categorical = plot.chart === 'box' || plot.chart === 'bar';
      const probability = plot.chart === 'probability';
      // Reference lines are drawn on a values axis: both of a scatter or line, the values of a histogram, probability plot,
      // box or bar, and a control chart's Y. A count, share, category or Ppk axis has none.
      const drawsReferences = (r: 'x' | 'y'): boolean => {
        switch (plot.chart) {
          case 'scatter': case 'line': return true;
          case 'histogram': case 'probability': return r === 'x';
          case 'box': case 'bar': case 'control': return r === 'y';
          default: return false;
        }
      };
      panel.appendChild(axisBlock('x', plot.chart === 'histogram' || probability ? 'Values axis' : categorical ? 'Categories axis' : 'X axis', auto.x,
        { scale: !categorical, limits: !categorical, references: drawsReferences('x') }));
      // A probability plot's vertical axis is shares, fixed at 0 to 100%: a title, and how the shares are spaced.
      panel.appendChild(axisBlock('y', plot.chart === 'histogram' ? 'Count axis' : probability ? 'Cumulative share axis' : categorical || plot.chart === 'line' ? 'Values axis' : 'Y axis', auto.y,
        { scale: plot.chart !== 'histogram' && !probability, limits: !probability, references: drawsReferences('y') }));
      if (probability) {
        panel.appendChild(row('Share axis', makeSegmented([['normal', 'Normal probability', 'Shares spaced by the normal quantile: a normal distribution is a straight line'], ['linear', 'Linear', 'Shares spaced evenly, 0 to 100%']],
          plot.probabilityAxis ?? 'normal', v => edit(d => { if (v === 'normal') delete d.probabilityAxis; else d.probabilityAxis = 'linear'; }), doc),
          'Normal probability spreads out the tails, where outliers and a second population show.'));
      }
      if (plot.chart === 'histogram') {
        panel.appendChild(row('Bins', numberBox(plot.bins, 'Number of bins', v => edit(d => {
          if (v === undefined || !Number.isInteger(v) || v < 1) delete d.bins; else d.bins = Math.min(v, 200);
        })), 'Automatic is 16 equal bins.'));
      }
      // The limits of a measured test are drawn on the axis that measures it; the choice appears where there is one.
      const f = plot.fields ?? {};
      if ((f.x && 'test' in f.x) || (f.y && ('test' in f.y || isTestSet(f.y)))) {
        panel.appendChild(row('Limits', makeSegmented([['both', 'Test + spec'], ['test', 'Test'], ['spec', 'Spec'], ['none', 'None']], plot.limits ?? 'both',
          v => edit(d => { if (v === 'both') delete d.limits; else d.limits = v as PlotLimits; }), doc),
          'Drawn as dashed lines on the axis of a test that has them: short dashes for test limits, long for spec limits.'));
      }
      for (const input of panel.querySelectorAll<HTMLInputElement>('[data-wmap-plot-axis-title]')) axisBoxes.set(input.dataset.wmapPlotAxisTitle!, input);
    }
    root.appendChild(panel);
  }
  build();

  return {
    el: root,
    setPlot(next) {
      const incoming = withFields(next);
      if (JSON.stringify(incoming) === JSON.stringify(plot)) return;
      plot = incoming;
      build();
    },
    refreshAuto() {
      const auto = o.autoText();
      if (titleBoxEl) titleBoxEl.placeholder = auto.title;
      syncDrift();
      for (const [role, input] of axisBoxes) input.placeholder = (role === 'x' ? auto.x : auto.y) ?? '';
    },
  };
}
