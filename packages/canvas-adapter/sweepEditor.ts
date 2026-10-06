// The sweep editor: the controls that change one sweep plot's definition.
//
// A sweep is a list of series (each an ordered run of tests, with the X value of each test) plus a few axis and
// measurement settings, so the editor is a list of series blocks and a short form, not the field pickers a
// scatter has. Lists are typed as text (`1010, 1011, 1020..1030`), parsed by stats/sweepText.ts, and a line that
// does not parse is flagged where it is typed and not applied, so the chart beside it is always a definition the
// reader meant. Every valid change applies at once, as in the plot editor.
//
// Edits the definition only: drawing is the sweep panel's job, saving the host's (`onChange`).

import { formatNumberList, formatTestList, parseNumberList, parseTestList } from '../stats/sweepText.js';
import type { PlotSpec } from '../stats/plotSpec.js';
import { previewXFromName, recordSweepTestNames, type SweepSeriesSpec } from '../stats/sweep.js';
import { NAME_PATTERN_EXAMPLES, NAME_PATTERN_LIMIT } from '../stats/sweepXFromName.js';
import type { TestDef } from '../renderer/buildWaferMap.js';
import { CLR, FONT, RADIUS, SPACE, controlStyle, wireControlHover } from './toolbar.js';
import { makeSegmented, makeToggle } from './charts/chartShell.js';
import { fieldRow, inputStyle } from './plotEditor.js';

export interface SweepEditorOptions {
  doc: Document;
  plot: PlotSpec;
  /** The open lot's tests: with them, a series read from test names shows those names, and what its pattern reads. */
  testDefs?: readonly TestDef[];
  /** Called with the new spec after every valid change. */
  onChange: (next: PlotSpec) => void;
}

export interface SweepEditorHandle {
  el: HTMLElement;
  /** The plot changed elsewhere (undo, an import): show it. */
  setPlot(plot: PlotSpec): void;
}

type XSource = 'order' | 'values' | 'name';

const xSourceOf = (s: SweepSeriesSpec): XSource => (s.xFromName !== undefined ? 'name' : s.xValues !== undefined ? 'values' : 'order');

export function createSweepEditor(o: SweepEditorOptions): SweepEditorHandle {
  const { doc } = o;
  let plot = o.plot;
  const root = doc.createElement('div');
  root.dataset.wmapSweepEditor = '1';
  Object.assign(root.style, { display: 'flex', flexDirection: 'column', gap: SPACE.lg, minWidth: '0' } as Partial<CSSStyleDeclaration>);

  const edit = (fn: (draft: PlotSpec) => void): void => {
    const draft = JSON.parse(JSON.stringify(plot)) as PlotSpec;
    draft.sweep = draft.sweep ?? { series: [] };
    fn(draft);
    // What the tests are called now, so a lot that numbers other tests the same way is told apart from this one.
    draft.sweep = recordSweepTestNames(draft.sweep, o.testDefs);
    plot = draft;
    o.onChange(draft);
  };

  /** A text box that applies what it holds when that parses, and says why when it does not. */
  function textField(
    value: string, label: string, placeholder: string,
    apply: (text: string) => string | undefined,
    opts: { mono?: boolean } = {},
  ): { el: HTMLElement; input: HTMLInputElement } {
    const wrap = doc.createElement('div');
    Object.assign(wrap.style, { display: 'flex', flexDirection: 'column', gap: SPACE.xxs, minWidth: '0' } as Partial<CSSStyleDeclaration>);
    const input = doc.createElement('input');
    input.type = 'text';
    input.value = value;
    input.placeholder = placeholder;
    input.setAttribute('aria-label', label);
    Object.assign(input.style, inputStyle(), { width: '100%', ...(opts.mono ? { fontVariantNumeric: 'tabular-nums' } : {}) } as Partial<CSSStyleDeclaration>);
    const error = doc.createElement('div');
    error.setAttribute('role', 'alert');
    Object.assign(error.style, { display: 'none', fontSize: FONT.sub, color: CLR.errText } as Partial<CSSStyleDeclaration>);
    input.addEventListener('input', () => {
      const problem = apply(input.value);
      error.textContent = problem ?? '';
      error.style.display = problem ? '' : 'none';
      input.setAttribute('aria-invalid', String(!!problem));
      input.style.borderColor = problem ? CLR.errText : CLR.menuBorder;
    });
    input.addEventListener('keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); input.blur(); } });
    wrap.append(input, error);
    return { el: wrap, input };
  }

  const smallButton = (text: string, hook: string, run: () => void): HTMLButtonElement => {
    const b = doc.createElement('button');
    b.type = 'button';
    b.textContent = text;
    b.dataset[hook] = '1';
    Object.assign(b.style, { ...controlStyle('outlined'), fontSize: FONT.body } as Partial<CSSStyleDeclaration>);
    wireControlHover(b);
    b.addEventListener('click', run);
    return b;
  };

  /** The names of a series' first tests and what its pattern reads from each, so a pattern can be written against them. */
  function renderNamePreview(el: HTMLElement, series: SweepSeriesSpec | undefined): void {
    el.replaceChildren();
    if (!series) return;
    const { rows, total, error } = previewXFromName(series, o.testDefs);
    const line = (text: string, color?: string): void => {
      const d = doc.createElement('div');
      d.textContent = text;
      if (color) d.style.color = color;
      el.appendChild(d);
    };
    if (rows.length === 0) { line('This series has no tests yet, so there are no names to show.'); return; }
    line(error || !series.xFromName ? 'The names of these tests (write a pattern with {x} where the number is):' : 'What the pattern reads from the first names:');
    for (const r of rows) {
      const name = r.name === undefined ? '(not in this data)' : `“${r.name}”`;
      if (error || !series.xFromName) { line(`${r.test}  ${name}`); continue; }
      const read = typeof r.x === 'number' ? `→ ${r.x}` : r.x === null ? '→ no match' : `→ unclear: “${r.x.ambiguous}” could be milli or mega`;
      line(`${r.test}  ${name}  ${read}`, typeof r.x === 'number' ? undefined : CLR.errText);
    }
    if (total > rows.length) line(`… and ${total - rows.length} more`);
  }

  /** Worked patterns, folded away until wanted: what to type for the name in front of the reader is rarely obvious. */
  function patternExamples(): HTMLElement {
    const details = doc.createElement('details');
    details.dataset.wmapSweepExamples = '1';
    Object.assign(details.style, { fontSize: FONT.sub, color: CLR.label } as Partial<CSSStyleDeclaration>);
    const summary = doc.createElement('summary');
    summary.textContent = 'Pattern examples';
    Object.assign(summary.style, { cursor: 'pointer' } as Partial<CSSStyleDeclaration>);
    wireControlHover(summary, 'bare');
    details.appendChild(summary);
    const list = doc.createElement('div');
    Object.assign(list.style, { display: 'flex', flexDirection: 'column', gap: SPACE.sm, paddingTop: SPACE.sm } as Partial<CSSStyleDeclaration>);
    for (const ex of NAME_PATTERN_EXAMPLES) {
      const item = doc.createElement('div');
      item.textContent = `“${ex.name}” with ${ex.pattern} reads ${ex.reads}` + (ex.note ? ` (${ex.note})` : '');
      list.appendChild(item);
    }
    const limit = doc.createElement('div');
    limit.textContent = NAME_PATTERN_LIMIT;
    limit.style.fontStyle = 'italic';
    list.appendChild(limit);
    details.appendChild(list);
    return details;
  }

  function seriesBlock(s: SweepSeriesSpec, i: number, count: number): HTMLElement {
    const box = doc.createElement('div');
    box.dataset.wmapSweepSeries = String(i);
    Object.assign(box.style, { display: 'flex', flexDirection: 'column', gap: SPACE.md, padding: SPACE.lg, border: `1px solid ${CLR.menuBorder}`, borderRadius: RADIUS.control } as Partial<CSSStyleDeclaration>);

    const head = doc.createElement('div');
    Object.assign(head.style, { display: 'flex', gap: SPACE.md, alignItems: 'center' } as Partial<CSSStyleDeclaration>);
    const name = textField(s.label, `Series ${i + 1} name`, `Series ${i + 1}`, text => {
      edit(d => { d.sweep!.series[i].label = text.trim() === '' ? `Series ${i + 1}` : text; });
      return undefined;
    });
    name.el.style.flex = '1';
    head.appendChild(name.el);
    if (count > 1) head.appendChild(smallButton('Remove', 'wmapSweepRemoveSeries', () => { edit(d => { d.sweep!.series.splice(i, 1); }); build(); }));
    box.appendChild(head);

    // Set below for a series read from test names: the names shown follow the tests and the pattern as either is typed.
    let refreshPreview: (() => void) | undefined;
    const tests = textField(formatTestList(s.tests), `Series ${i + 1} tests`, '1010, 1011, 1020..1030', text => {
      const r = parseTestList(text);
      if (!r.ok) return r.error;
      edit(d => { d.sweep!.series[i].tests = r.value; });
      refreshPreview?.();
      return undefined;
    }, { mono: true });
    tests.input.dataset.wmapSweepTests = String(i);
    box.appendChild(fieldRow(doc, 'Tests, in sweep order', tests.el, 'Test numbers, or a range such as 1010..1030 for the tests declared between them.'));

    const source = xSourceOf(s);
    box.appendChild(fieldRow(doc, 'X value of each test', makeSegmented(
      [['order', 'Test order', 'The position of each test in the run is its X'], ['values', 'Values', 'Type the swept value for each test'], ['name', 'From test name', "Read the swept value from each test's name"]], source, v => {
        edit(d => {
          const sr = d.sweep!.series[i];
          delete sr.xValues; delete sr.xFromName;
          if (v === 'values') sr.xValues = [];
          if (v === 'name') sr.xFromName = '';
        });
        build();
      }, doc, true)));
    if (source === 'values') {
      const xs = textField(formatNumberList(s.xValues ?? []), `Series ${i + 1} X values`, '0, 5, 10', text => {
        const r = parseNumberList(text);
        if (!r.ok) return r.error;
        edit(d => { d.sweep!.series[i].xValues = r.value; });
        return undefined;
      }, { mono: true });
      box.appendChild(fieldRow(doc, 'X values', xs.el, 'One per test, in the same order. A different count is reported on the chart, which then uses test order.'));
    } else if (source === 'name') {
      const pat = textField(s.xFromName ?? '', `Series ${i + 1} name pattern`, 'LRS_STATS_{x}', text => {
        edit(d => { d.sweep!.series[i].xFromName = text; });
        refreshPreview?.();
        return undefined;
      });
      box.appendChild(fieldRow(doc, 'Name pattern', pat.el,
        '{x} reads a number from each test’s name, * matches any text and ? any one character. The pattern may match anywhere in the name: “@ {x}” reads 0.55 from “Fmax @ 0.55 V”.'));
      box.appendChild(patternExamples());
      if (o.testDefs) {
        const preview = doc.createElement('div');
        preview.dataset.wmapSweepNames = String(i);
        Object.assign(preview.style, { display: 'flex', flexDirection: 'column', gap: SPACE.xxs, fontSize: FONT.sub, color: CLR.label, fontVariantNumeric: 'tabular-nums' } as Partial<CSSStyleDeclaration>);
        refreshPreview = () => renderNamePreview(preview, plot.sweep?.series[i]);
        refreshPreview();
        box.appendChild(preview);
      }
    } else {
      const note = doc.createElement('div');
      note.textContent = 'The X axis is the position in the run, labelled by test number. No scale between the tests is assumed.';
      Object.assign(note.style, { fontSize: FONT.sub, color: CLR.label } as Partial<CSSStyleDeclaration>);
      box.appendChild(note);
    }
    return box;
  }

  function build(): void {
    root.replaceChildren();
    const sweep = plot.sweep ?? { series: [] };

    const title = textField(plot.title ?? '', 'Sweep title', 'Sweep', text => {
      edit(d => { if (text.trim() === '') delete d.title; else Object.assign(d, { title: text }); });
      return undefined;
    });
    title.input.dataset.wmapSweepTitle = '1';
    root.appendChild(fieldRow(doc, 'Title', title.el));

    const list = doc.createElement('div');
    Object.assign(list.style, { display: 'flex', flexDirection: 'column', gap: SPACE.md } as Partial<CSSStyleDeclaration>);
    sweep.series.forEach((s, i) => list.appendChild(seriesBlock(s, i, sweep.series.length)));
    root.appendChild(list);
    root.appendChild(smallButton('+ Add series', 'wmapSweepAddSeries', () => {
      edit(d => { d.sweep!.series.push({ label: `Series ${d.sweep!.series.length + 1}`, tests: [] }); });
      build();
    }));

    // The axis and the measurements. A sweep measures the first two series against each other.
    const axis = doc.createElement('div');
    Object.assign(axis.style, { display: 'flex', flexDirection: 'column', gap: SPACE.md, padding: SPACE.lg, border: `1px solid ${CLR.menuBorder}`, borderRadius: RADIUS.control } as Partial<CSSStyleDeclaration>);
    const head = doc.createElement('div');
    head.textContent = 'Axes and measurements';
    Object.assign(head.style, { fontSize: FONT.body, fontWeight: '600', color: CLR.value } as Partial<CSSStyleDeclaration>);
    axis.appendChild(head);
    const labelled = (key: 'xLabel' | 'xUnit' | 'yLabel', label: string, placeholder: string) => {
      const f = textField(sweep[key] ?? '', label, placeholder, text => {
        edit(d => { if (text.trim() === '') delete d.sweep![key]; else d.sweep![key] = text; });
        return undefined;
      });
      return fieldRow(doc, label, f.el);
    };
    const pair = doc.createElement('div');
    Object.assign(pair.style, { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: SPACE.md } as Partial<CSSStyleDeclaration>);
    pair.append(labelled('xLabel', 'X title', 'automatic'), labelled('xUnit', 'X unit', 'e.g. V, Hz'));
    axis.append(pair, labelled('yLabel', 'Y title', 'automatic'));
    axis.appendChild(fieldRow(doc, 'X scale', makeSegmented([['linear', 'Linear'], ['log', 'Log']], sweep.xScale ?? 'linear',
      v => { edit(d => { if (v === 'log') d.sweep!.xScale = 'log'; else delete d.sweep!.xScale; }); }, doc),
      'Log needs every X value to be positive; the chart says so otherwise.'));
    if (sweep.series.length >= 2) {
      axis.appendChild(makeToggle('Mark where the first two series cross', sweep.crossing ?? true, v => { edit(d => { d.sweep!.crossing = v; }); }, doc));
      const sep = textField(formatNumberList(sweep.separationAt ?? []), 'Widths at levels', '1.2, 2.5', text => {
        const r = parseNumberList(text);
        if (!r.ok) return r.error;
        edit(d => { if (r.value.length) d.sweep!.separationAt = r.value; else delete d.sweep!.separationAt; });
        return undefined;
      }, { mono: true });
      axis.appendChild(fieldRow(doc, 'Width between the first two series at these Y levels', sep.el, 'Optional. In the tests’ own unit.'));
    }
    root.appendChild(axis);
  }
  build();

  return {
    el: root,
    setPlot(next) { plot = next; build(); },
  };
}
