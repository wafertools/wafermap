// The editor of a filter: conditions that must all hold, each on one field, and a switch that keeps them while off.
//
// One editor for a plot's own filter (inside the plot editor) and the Insights population filter (in its own modal),
// so the two cannot come to work differently. A category condition is a list of values to keep; a number condition a
// range, either end open, started at the data's own range so adding it changes nothing until it is narrowed. Either
// can be turned round ("is not", "outside"). The editor only edits the filter; applying it is `applyConditions`.

import { conditionText, conditionUnit, fieldKey, type FieldOption } from '../stats/plotData.js';
import { sameField, type PlotCondition, type PlotField, type PlotFilter } from '../stats/plotSpec.js';
import type { TestDef } from '../renderer/buildWaferMap.js';
import type { FacetCuration } from '../stats/facets.js';
import { CLR, FONT, RADIUS, SPACE, controlStyle, wireControlHover, wireTooltip } from './toolbar.js';
import { inputStyle, makeListSelect, makeSegmented, makeToggle, type ListSelectOption } from './charts/chartShell.js';

export interface FilterEditorOptions {
  doc: Document;
  /** The population's fields; those a condition can be on are taken from it (`filterFields`). */
  catalogue: readonly FieldOption[];
  filter: PlotFilter | undefined;
  /** Called with the filter after every change; `undefined` once the last condition is removed. */
  onChange: (next: PlotFilter | undefined) => void;
  /** The values a category field takes on the population, in order. */
  valuesOf: (field: PlotField) => string[];
  /** The range a number field spans on the population. */
  extentOf: (field: PlotField) => [number, number] | undefined;
  testDefs?: readonly TestDef[];
  /** The host's names for wafer attributes, so a condition names a field as Group by and the plots do. */
  attributes?: Record<string, FacetCuration>;
  /** The switch's text: what is filtered ("Filter this plot", "Filter Insights"). */
  switchLabel: string;
}

export interface FilterEditorHandle {
  el: HTMLElement;
  /** The filter changed elsewhere (the card's switch, Clear): show it. */
  set(filter: PlotFilter | undefined): void;
}

/**
 * The fields a condition can be on: every category and number in the catalogue except Test, which divides a set of
 * tests rather than the dies, and the pass-rate columns, which are 100 or 0 per die (a verdict is under Verdicts).
 */
export function filterFields(catalogue: readonly FieldOption[]): FieldOption[] {
  return catalogue.filter(f => f.group !== 'Pass rates' && !('builtin' in f.field && f.field.builtin === 'test'));
}

/** Whether a condition on this field keeps values (a category) or a range (a number). */
const isRangeField = (f: FieldOption): boolean => !f.categorical;

const short = (v: number): string => String(Number(v.toPrecision(6)));

export function buildFilterEditor(o: FilterEditorOptions): FilterEditorHandle {
  const { doc } = o;
  const fields = filterFields(o.catalogue);
  const optionOf = (field: PlotField) => fields.find(f => sameField(f.field, field));
  const copy = (f: PlotFilter | undefined): PlotFilter | undefined => (f ? JSON.parse(JSON.stringify(f)) as PlotFilter : undefined);
  let cur = copy(o.filter);
  /** A row added with no field chosen yet: not part of the filter until a field is picked. */
  let pending = false;

  const el = doc.createElement('div');
  el.dataset.wmapFilterEditor = '1';
  Object.assign(el.style, { display: 'flex', flexDirection: 'column', gap: SPACE.md } as Partial<CSSStyleDeclaration>);

  const emit = (rebuild: boolean): void => {
    if (cur && cur.conditions.length === 0) cur = undefined;
    o.onChange(copy(cur));
    if (rebuild) build();
  };

  function newCondition(f: FieldOption): PlotCondition | undefined {
    if (isRangeField(f)) {
      const ext = o.extentOf(f.field);
      return ext ? { field: f.field, min: ext[0], max: ext[1] } : undefined;
    }
    const values = o.valuesOf(f.field);
    return values.length ? { field: f.field, values } : undefined;
  }

  function fieldSelect(selected: PlotField | undefined, onPick: (f: FieldOption) => void): HTMLElement {
    const options: ListSelectOption[] = fields.map(f => ({ value: fieldKey(f.field), label: f.label, group: f.group }));
    // A new row names no field yet: the box says what to do, and the list holds only fields.
    const sel = makeListSelect(options, selected ? fieldKey(selected) : '', key => {
      const f = fields.find(x => fieldKey(x.field) === key);
      if (f) onPick(f);
    }, { maxWidth: '100%', ownerDocument: doc, ariaLabel: 'Condition field', searchPlaceholder: 'Filter fields…', hook: 'filter-field', emptyText: 'Choose a field…' });
    Object.assign(sel.style, { flex: '1 1 auto', minWidth: '0' } as Partial<CSSStyleDeclaration>);
    return sel;
  }

  function removeButton(label: string, onRemove: () => void): HTMLButtonElement {
    const b = doc.createElement('button');
    b.type = 'button';
    b.textContent = '✕';
    b.setAttribute('aria-label', label);
    b.dataset.wmapFilterRemove = '1';
    Object.assign(b.style, { ...controlStyle('bare'), fontSize: FONT.body, padding: `0 ${SPACE.sm}`, flexShrink: '0' } as Partial<CSSStyleDeclaration>);
    wireControlHover(b, 'bare');
    wireTooltip(b, label);
    b.addEventListener('click', onRemove);
    return b;
  }

  function numberBox(value: number | undefined, placeholder: string, label: string, commit: (v: number | undefined) => void): HTMLInputElement {
    const input = doc.createElement('input');
    input.type = 'text';
    input.inputMode = 'decimal';
    input.value = value === undefined ? '' : short(value);
    input.placeholder = placeholder;
    input.setAttribute('aria-label', label);
    Object.assign(input.style, inputStyle(), { width: '9em' } as Partial<CSSStyleDeclaration>);
    input.addEventListener('change', () => {
      const t = input.value.trim();
      const v = t === '' ? undefined : Number(t);
      if (v !== undefined && !Number.isFinite(v)) { input.setAttribute('aria-invalid', 'true'); input.style.borderColor = CLR.errBorder; return; }
      input.removeAttribute('aria-invalid');
      input.style.borderColor = '';
      commit(v);
    });
    return input;
  }

  function conditionBox(c: PlotCondition, i: number): HTMLElement {
    const box = doc.createElement('div');
    box.dataset.wmapFilterCondition = String(i);
    box.setAttribute('role', 'group');
    box.setAttribute('aria-label', `Condition ${i + 1}`);
    Object.assign(box.style, {
      display: 'flex', flexDirection: 'column', gap: SPACE.sm, padding: SPACE.md,
      border: `1px solid ${CLR.menuBorder}`, borderRadius: RADIUS.control,
    } as Partial<CSSStyleDeclaration>);
    const opt = optionOf(c.field);
    const range = c.values === undefined;

    const head = doc.createElement('div');
    Object.assign(head.style, { display: 'flex', alignItems: 'center', gap: SPACE.sm, flexWrap: 'wrap' } as Partial<CSSStyleDeclaration>);
    head.appendChild(fieldSelect(c.field, f => {
      const next = newCondition(f);
      if (!next || !cur) return;
      cur.conditions[i] = next;
      emit(true);
    }));
    head.appendChild(makeSegmented(
      range ? [['in', 'from–to'], ['not', 'outside']] : [['in', 'is'], ['not', 'is not']],
      c.not ? 'not' : 'in',
      v => { if (!cur) return; if (v === 'not') cur.conditions[i].not = true; else delete cur.conditions[i].not; emit(false); summary.textContent = conditionText(cur.conditions[i], o.testDefs, o.attributes); },
      doc, true,
    ));
    head.appendChild(removeButton(`Remove the condition: ${conditionText(c, o.testDefs, o.attributes)}`, () => {
      if (!cur) return;
      cur.conditions.splice(i, 1);
      emit(true);
    }));
    box.appendChild(head);

    if (!opt) {
      const missing = doc.createElement('div');
      missing.textContent = 'This field is not in the wafers in view: the condition keeps nothing until it is changed or removed.';
      Object.assign(missing.style, { color: CLR.warnText, fontSize: FONT.body } as Partial<CSSStyleDeclaration>);
      box.appendChild(missing);
    } else if (range) {
      const line = doc.createElement('div');
      Object.assign(line.style, { display: 'flex', alignItems: 'center', gap: SPACE.sm, flexWrap: 'wrap', fontSize: FONT.body, color: CLR.label } as Partial<CSSStyleDeclaration>);
      const set = (k: 'min' | 'max') => (v: number | undefined) => {
        if (!cur) return;
        const cond = cur.conditions[i];
        if (v === undefined) delete cond[k]; else cond[k] = v;
        // A range with neither end is no condition: put back the data's own end rather than keep "any value".
        if (cond.min === undefined && cond.max === undefined) { const ext = o.extentOf(cond.field); if (ext) cond[k] = k === 'min' ? ext[0] : ext[1]; }
        const swap = cond.min !== undefined && cond.max !== undefined && cond.min > cond.max;
        if (swap) [cond.min, cond.max] = [cond.max, cond.min];
        // Redrawn only when the boxes must show something other than what was typed, so focus moves on as Tab sends it.
        const shown = cond[k] === v && !swap;
        emit(!shown);
        if (shown) summary.textContent = conditionText(cond, o.testDefs, o.attributes);
      };
      // The boxes take the field's own unit, unprefixed (volts, not millivolts), and say so.
      const unit = conditionUnit(c.field, o.testDefs);
      const unitText = unit ? ` ${unit}` : '';
      line.append(
        numberBox(c.min, 'no minimum', `${opt.name}: lowest value kept${unit ? `, in ${unit}` : ''}`, set('min')),
        doc.createTextNode('to'),
        numberBox(c.max, 'no maximum', `${opt.name}: highest value kept${unit ? `, in ${unit}` : ''}`, set('max')),
      );
      if (unit) line.appendChild(doc.createTextNode(unit));
      const ext = o.extentOf(c.field);
      if (ext) {
        const hint = doc.createElement('span');
        hint.textContent = `(values here: ${short(ext[0])} to ${short(ext[1])}${unitText})`;
        line.appendChild(hint);
      }
      box.appendChild(line);
    } else {
      const all = o.valuesOf(c.field);
      const list = doc.createElement('div');
      list.setAttribute('role', 'group');
      list.setAttribute('aria-label', `${opt.name}: values`);
      Object.assign(list.style, { display: 'flex', flexWrap: 'wrap', gap: `${SPACE.xs} ${SPACE.md}`, maxHeight: '120px', overflowY: 'auto' } as Partial<CSSStyleDeclaration>);
      // A value the condition names that the wafers in view lack is still listed, so it can be cleared.
      const shown = [...all, ...(c.values ?? []).filter(v => !all.includes(v))];
      for (const v of shown) {
        const t = makeToggle(v, (c.values ?? []).includes(v), on => {
          if (!cur) return;
          const cond = cur.conditions[i];
          const kept = new Set(cond.values ?? []);
          if (on) kept.add(v); else kept.delete(v);
          // No value at all would not be a filter but an empty view: the last value stays.
          if (kept.size === 0) { (t.querySelector('input') as HTMLInputElement).checked = true; return; }
          cond.values = shown.filter(x => kept.has(x));
          emit(false);
          summary.textContent = conditionText(cond, o.testDefs, o.attributes);
        }, doc);
        t.dataset.wmapFilterValue = v;
        list.appendChild(t);
      }
      box.appendChild(list);
    }
    // The condition in words, as the card and the band will state it.
    const summary = doc.createElement('div');
    summary.dataset.wmapFilterSummary = '1';
    summary.textContent = conditionText(c, o.testDefs, o.attributes);
    Object.assign(summary.style, { color: CLR.label, fontSize: FONT.meta } as Partial<CSSStyleDeclaration>);
    box.appendChild(summary);
    return box;
  }

  function build(): void {
    el.innerHTML = '';
    if (cur && cur.conditions.length) {
      const sw = makeToggle(o.switchLabel, !cur.off, on => {
        if (!cur) return;
        if (on) delete cur.off; else cur.off = true;
        emit(false);
        rows.style.opacity = cur.off ? '0.6' : '1';
      }, doc, 'Off keeps the conditions and applies none, so the filter can be switched back on as it was');
      sw.dataset.wmapFilterSwitch = '1';
      el.appendChild(sw);
    }
    const rows = doc.createElement('div');
    Object.assign(rows.style, { display: 'flex', flexDirection: 'column', gap: SPACE.sm, opacity: cur?.off ? '0.6' : '1' } as Partial<CSSStyleDeclaration>);
    cur?.conditions.forEach((c, i) => rows.appendChild(conditionBox(c, i)));
    if (pending) {
      const line = doc.createElement('div');
      line.dataset.wmapFilterPending = '1';
      Object.assign(line.style, { display: 'flex', alignItems: 'center', gap: SPACE.sm } as Partial<CSSStyleDeclaration>);
      line.appendChild(fieldSelect(undefined, f => {
        const next = newCondition(f);
        if (!next) return;
        pending = false;
        cur ??= { conditions: [] };
        cur.conditions.push(next);
        emit(true);
      }));
      line.appendChild(removeButton('Cancel the new condition', () => { pending = false; build(); }));
      rows.appendChild(line);
    }
    el.appendChild(rows);

    const add = doc.createElement('button');
    add.type = 'button';
    add.textContent = cur?.conditions.length ? '+ Add condition' : '+ Add a condition';
    add.dataset.wmapFilterAdd = '1';
    add.disabled = pending || fields.length === 0;
    Object.assign(add.style, { ...controlStyle('outlined'), fontSize: FONT.body, padding: `${SPACE.xs} ${SPACE.md}`, alignSelf: 'flex-start' } as Partial<CSSStyleDeclaration>);
    wireControlHover(add);
    wireTooltip(add, 'Keep only what meets this condition as well as the others');
    add.addEventListener('click', () => {
      pending = true;
      build();
      // The redraw removed the button that had focus: carry it to the field list of the row just added.
      el.querySelector<HTMLElement>('[data-wmap-filter-pending] button')?.focus();
    });
    el.appendChild(add);
  }

  build();
  return { el, set: f => { cur = copy(f); pending = false; build(); } };
}

export interface FilterStripOptions {
  doc: Document;
  filter: PlotFilter;
  testDefs?: readonly TestDef[];
  attributes?: Record<string, FacetCuration>;
  /** What the switch names ("Filter", "Insights filter"). */
  label: string;
  /** The switch was flipped: `on` true applies the conditions again. */
  onToggle: (on: boolean) => void;
  /** Said after the conditions while the filter is on: what it kept ("18 of 25 wafers"). */
  kept?: string;
  /** Buttons at the end of the line (Edit, Clear). */
  actions?: HTMLElement[];
}

/**
 * A filter as one line wherever its result is shown: a switch, each condition in words, and while on what it kept.
 * Filtering is never hidden, so the line stays while the filter is off, muted and saying so, until the filter is
 * removed. The same line on a plot card and above every Insights tab.
 */
export function buildFilterStrip(o: FilterStripOptions): HTMLElement {
  const { doc, filter } = o;
  const on = !filter.off;
  const el = doc.createElement('div');
  el.dataset.wmapFilterStrip = on ? 'on' : 'off';
  el.setAttribute('role', 'status');
  Object.assign(el.style, {
    display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: `${SPACE.xs} ${SPACE.md}`, flexBasis: '100%',
    padding: `${SPACE.xs} ${SPACE.md}`, borderRadius: RADIUS.control, fontSize: FONT.body,
    background: on ? CLR.infoBg : 'transparent', color: on ? CLR.infoText : CLR.label,
    border: `1px ${on ? 'solid' : 'dashed'} ${on ? CLR.iconActive : CLR.menuBorder}`,
  } as Partial<CSSStyleDeclaration>);
  const sw = makeToggle(on ? `${o.label} on:` : `${o.label} off`, on, o.onToggle, doc,
    on ? 'Switch the filter off: its conditions are kept, and nothing is filtered until it is switched back on'
      : 'Switch the filter back on, with the conditions below');
  sw.dataset.wmapFilterStripSwitch = '1';
  sw.style.fontWeight = '600';
  sw.style.color = 'inherit';
  el.appendChild(sw);
  const conds = doc.createElement('span');
  conds.dataset.wmapFilterStripText = '1';
  const text = filter.conditions.map(c => conditionText(c, o.testDefs, o.attributes)).join(' · ');
  conds.textContent = on ? text : `(would keep only: ${text})`;
  el.appendChild(conds);
  if (on && o.kept) {
    const kept = doc.createElement('span');
    kept.dataset.wmapFilterStripKept = '1';
    kept.textContent = `— ${o.kept}`;
    kept.style.fontWeight = '600';
    el.appendChild(kept);
  }
  if (o.actions?.length) {
    const end = doc.createElement('span');
    Object.assign(end.style, { display: 'inline-flex', gap: SPACE.sm, marginLeft: 'auto' } as Partial<CSSStyleDeclaration>);
    end.append(...o.actions);
    el.appendChild(end);
  }
  return el;
}
