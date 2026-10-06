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

import { combinationIssue, describeTitleDrift, fieldKey, fieldsForRole, titleDrift, type FieldFacts, type FieldOption, type PlotRole } from '../stats/plotData.js';
import { sameField, type PlotAxis, type PlotField, type PlotLimits, type PlotSpec } from '../stats/plotSpec.js';
import { CLR, FONT, RADIUS, SPACE, controlStyle, wireControlHover, wireTooltip } from './toolbar.js';
import { makeListSelect, makeSegmented, makeToggle, type ListSelectOption } from './charts/chartShell.js';

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
];
const AUTO = '\0auto';
const COUNT = '\0count';

const AGGREGATE_LABEL: Record<string, string> = { mean: 'Mean', median: 'Median', min: 'Minimum', max: 'Maximum', sum: 'Sum', count: 'Count', yield: 'Pooled yield (passing over judged dies)' };

export function inputStyle(): Partial<CSSStyleDeclaration> {
  return {
    background: CLR.menuBg, color: CLR.text, border: `1px solid ${CLR.menuBorder}`, borderRadius: RADIUS.control,
    padding: `${SPACE.xs} ${SPACE.sm}`, fontSize: FONT.body, fontFamily: FONT.family, boxSizing: 'border-box', minWidth: '0',
  };
}

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
    const opt = f && o.catalogue.find(c => sameField(c.field, f));
    return opt ? { label: opt.name, level: opt.level, kind: opt.kind, yield: 'builtin' in opt.field && opt.field.builtin === 'yield' } : undefined;
  };
  /** Why choosing `candidate` for `role` would leave a plot that cannot be drawn, given the other fields now chosen. */
  function conflictFor(role: PlotRole, candidate: FieldOption): string | undefined {
    const f = plot.fields ?? {};
    const colorField = f.color && !('follow' in f.color) && !('none' in f.color) ? f.color : undefined;
    const chosen = { x: factsOf(f.x), y: factsOf(f.y), color: factsOf(colorField) };
    chosen[role] = factsOf(candidate.field);
    const continuousColor = plot.chart === 'scatter' && chosen.color?.kind === 'numeric' && !!colorField && !('meta' in colorField);
    return combinationIssue(plot.chart, chosen, { aggregate: plot.aggregate, level: plot.level, continuousColor })?.short;
  }
  const fieldOptions = (role: PlotRole): ListSelectOption[] => {
    const raw = plot.fields?.[role];
    const current = raw && !('follow' in raw) && !('none' in raw) ? raw : undefined;
    return fieldsForRole(o.catalogue, plot.chart, role).map(f => {
      // The field already in place stays pickable: it is what the reader is looking at.
      const why = current && sameField(f.field, current) ? undefined : conflictFor(role, f);
      return { value: fieldKey(f.field), label: f.label, group: f.group, ...(why ? { disabled: why } : {}) };
    });
  };

  const fieldByKey = (key: string): PlotField | undefined => o.catalogue.find(f => fieldKey(f.field) === key)?.field;

  /** A select for an X or Y role. A saved field the lot lacks, or one this chart type cannot use, stays selectable so the plot can be read. */
  function fieldSelect(role: 'x' | 'y', ariaLabel: string, opts: { optional?: string } = {}): HTMLElement {
    const current = plot.fields![role];
    const options = fieldOptions(role);
    if (opts.optional) options.unshift({ value: COUNT, label: opts.optional, group: 'Count' });
    if (current && !options.some(p => p.value === fieldKey(current))) {
      const inLot = o.catalogue.some(f => sameField(f.field, current));
      const name = 'test' in current ? (current.name ?? `Test ${current.test}`) : 'meta' in current ? current.meta : current.builtin;
      options.unshift({ value: fieldKey(current), label: `${name} (${inLot ? 'not usable here' : 'not in this lot'})`, group: 'Saved' });
    }
    const value = current ? fieldKey(current) : opts.optional ? COUNT : '';
    const sel = makeListSelect(options, value, key => {
      if (key === COUNT) { edit(d => { delete d.fields![role]; }); return; }
      const f = fieldByKey(key) ?? plot.fields![role];
      if (f) edit(d => { d.fields![role] = f; });
    }, { maxWidth: '100%', ownerDocument: doc, ariaLabel, emptyText: 'Choose a field…', searchPlaceholder: 'Filter fields…', hook: `plot-${role}` });
    sel.style.width = '100%';
    return sel;
  }

  /** Remembers a field a chart type could not use, so flipping back restores it rather than losing it. */
  const stash: Partial<Record<'x' | 'y', PlotField>> = {};
  /** Fields chosen for the reader when a type needed one, as against fields the reader picked: only the latter are worth keeping. */
  const supplied: Partial<Record<'x' | 'y', PlotField>> = {};

  function changeChart(next: PlotSpec['chart']): void {
    edit(d => {
      d.chart = next;
      for (const role of ['x', 'y'] as const) {
        const options = fieldsForRole(o.catalogue, next, role);
        const usable = (f: PlotField | undefined) => !!f && options.some(p => sameField(p.field, f));
        const current = d.fields![role];
        if (current && !usable(current)) {
          if (!sameField(current, supplied[role])) stash[role] = current;
          delete d.fields![role];
        }
        if (d.fields![role] || (role === 'y' && next === 'bar')) continue;
        const back = stash[role];
        if (usable(back)) { d.fields![role] = back; delete stash[role]; delete supplied[role]; continue; }
        const pick = role === 'x' && (next === 'box' || next === 'bar') ? { builtin: 'wafer' } as PlotField
          : role === 'x' && next === 'line' ? (options.find(p => p.group === 'Wafer')?.field ?? options[0]?.field)
          : options[0]?.field;
        if (pick && !(role === 'x' && (next === 'histogram'))) { d.fields![role] = pick; supplied[role] = pick; }
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
    }, { maxWidth: '100%', ownerDocument: doc, ariaLabel: 'Colour', searchPlaceholder: 'Filter fields…', hook: 'plot-color' });
    sel.style.width = '100%';
    return sel;
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

  function axisBlock(role: 'x' | 'y', title: string, autoLabel: string | undefined, opts: { scale: boolean; limits?: boolean }): HTMLElement {
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
        case 'box':
          panel.appendChild(row('Categories (X axis)', fieldSelect('x', 'Categories'), 'Compare by this field: one box per value, whether it is a wafer attribute (lot, split) or a die region (ring, reticle cell).'));
          panel.appendChild(row('Values (Y axis)', fieldSelect('y', 'Values')));
          break;
        case 'bar':
          panel.appendChild(row('Categories (X axis)', fieldSelect('x', 'Categories'), 'Compare by this field: one bar per value, whether it is a wafer attribute (lot, split) or a die region (ring, reticle cell).'));
          panel.appendChild(row('Values (Y axis)', fieldSelect('y', 'Values', { optional: `Count of ${noun}` })));
          break;
        case 'line':
          panel.appendChild(row('X axis', fieldSelect('x', 'X axis'), 'A line joins the value at each X.'));
          panel.appendChild(row('Y axis', fieldSelect('y', 'Y axis')));
          break;
      }
      panel.appendChild(row('Colour', colourSelect(), 'Compare by this field: each value gets its own colour. Follow Group by takes it from the Group by control.'));
      // How values become marks. Hidden where it cannot matter, so the common plot has no extra controls.
      if (plot.chart === 'bar' || plot.chart === 'line' || plot.level === 'wafer') panel.appendChild(row('Combine values by', aggregateSelect()));
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
      panel.appendChild(axisBlock('x', plot.chart === 'histogram' ? 'Values axis' : categorical ? 'Categories axis' : 'X axis', auto.x,
        { scale: !categorical, limits: !categorical }));
      panel.appendChild(axisBlock('y', plot.chart === 'histogram' ? 'Count axis' : categorical || plot.chart === 'line' ? 'Values axis' : 'Y axis', auto.y,
        { scale: plot.chart !== 'histogram' }));
      if (plot.chart === 'histogram') {
        panel.appendChild(row('Bins', numberBox(plot.bins, 'Number of bins', v => edit(d => {
          if (v === undefined || !Number.isInteger(v) || v < 1) delete d.bins; else d.bins = Math.min(v, 200);
        })), 'Automatic is 16 equal bins.'));
      }
      // The limits of a measured test are drawn on the axis that measures it; the choice appears where there is one.
      const f = plot.fields ?? {};
      if ((f.x && 'test' in f.x) || (f.y && 'test' in f.y)) {
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
