// The Filter window's JSON view: the filter as text, with suggestions from the lot and an undo history.
//
// The conditions editor and this view are two ways to write the same `PlotFilter`, so the text is read by the one reader a
// filters file goes through (`readFilter`, `readFiltersFile`) and writes into the window's draft as it is typed. The
// window's own Apply is the only apply: text that cannot be read tells the window (`onProblem`) so it can say so and hold
// Apply, and what a reading dropped is named here, as on import. A pasted `wafermap-filters` file with several filters offers
// them to choose from, as a plots file does in the plot editor.

import { nearest, readFilter, syntaxErrorAt, type PlotFilter } from '../stats/plotSpec.js';
import { FILTERS_FORMAT, readFiltersFile, type SavedFilter } from '../stats/filterFile.js';
import type { CompletionSource } from './plotJsonComplete.js';
import { attachJsonSuggestions } from './plotJsonSuggest.js';
import { copyText, createTextHistory } from './plotJsonHistory.js';
import { CLR, FONT, SPACE, controlStyle, wireControlHover, wireTooltip } from './toolbar.js';
import { inputStyle } from './charts/chartShell.js';

export interface FilterJsonOptions {
  doc: Document;
  /** The filter now in force in the window's draft. */
  filter: PlotFilter | undefined;
  /** What the suggestions know of the lot: its fields, its tests, and the values a field takes. */
  source: () => CompletionSource;
  /** The text now reads as this filter (undefined: no conditions). Called as the text is typed. */
  onChange: (filter: PlotFilter | undefined) => void;
  /** The text cannot be a filter yet (said in words), or can again (undefined). */
  onProblem: (problem: string | undefined) => void;
}

export interface FilterJsonHandle {
  el: HTMLElement;
  /** Show `filter` in the text (an edit the history can undo). */
  set(filter: PlotFilter | undefined): void;
  /** Put the text back as the draft stands, dropping what could not be read. */
  discard(filter: PlotFilter | undefined): void;
  focus(): void;
}

const KNOWN_KEYS = ['conditions', 'off', 'field', 'values', 'min', 'max', 'not'];

/** The filter as text: always with its conditions list, so an empty filter shows where conditions go. */
export const filterText = (f: PlotFilter | undefined): string => JSON.stringify(f ?? { conditions: [] }, null, 2);

interface Reading {
  /** The filter read: a filter, or null for none (no conditions). Absent while the text cannot be read, or waits on a choice. */
  filter?: PlotFilter | null;
  problem?: string;
  /** What was left out or ignored, each saying where. */
  notes: string[];
  /** A file of several filters: the one to use is not chosen yet. */
  choices?: SavedFilter[];
}

function read(text: string): Reading {
  let raw: unknown;
  try { raw = JSON.parse(text); } catch (e) { return { problem: `Not valid JSON: ${syntaxErrorAt(text, e instanceof Error ? e.message : String(e))}`, notes: [] }; }
  // A filters file (wrapped, or a bare list of filters): each filter is read as the file would.
  const isObject = typeof raw === 'object' && raw !== null && !Array.isArray(raw);
  if (Array.isArray(raw) || (isObject && (raw as { format?: unknown }).format === FILTERS_FORMAT)) {
    const file = readFiltersFile(text);
    if (file.error) return { problem: [file.error, ...file.warnings].join('\n'), notes: [] };
    if (file.filters.length > 1) return { choices: file.filters, notes: file.warnings, problem: 'This is a filters file: choose the filter to use' };
    return { filter: { conditions: file.filters[0].conditions }, notes: file.warnings };
  }
  if (!isObject) return { problem: 'A filter is an object with a "conditions" list, like { "conditions": [ … ] }', notes: [] };
  const notes: string[] = [];
  for (const k of Object.keys(raw as object)) {
    if (!KNOWN_KEYS.includes(k)) {
      const near = nearest(k, KNOWN_KEYS);
      notes.push(`filter.${k}: not a setting of a filter, ignored.${near ? ` Did you mean "${near}"?` : ''}`);
    }
  }
  const filter = readFilter(raw as Record<string, unknown>, 'filter', notes);
  if (!filter) {
    // No condition that can be read: an empty list is a filter with none; a list whose conditions were all refused is a problem.
    const listed = Array.isArray((raw as { conditions?: unknown }).conditions) ? (raw as { conditions: unknown[] }).conditions.length : 0;
    return listed > 0 ? { problem: ['No condition could be read:', ...notes].join('\n'), notes: [] } : { filter: null, notes };
  }
  return { filter, notes };
}

export function buildFilterJsonPanel(o: FilterJsonOptions): FilterJsonHandle {
  const { doc } = o;
  const el = doc.createElement('div');
  el.dataset.wmapFilterJson = '1';
  Object.assign(el.style, { display: 'flex', flexDirection: 'column', gap: SPACE.sm, minWidth: '0' } as Partial<CSSStyleDeclaration>);

  const area = doc.createElement('textarea');
  area.dataset.wmapFilterJsonText = '1';
  area.value = filterText(o.filter);
  area.spellcheck = false;
  area.rows = 14;
  area.setAttribute('aria-label', 'Filter as JSON');
  Object.assign(area.style, {
    ...inputStyle(), fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace', fontSize: FONT.sub,
    width: '100%', boxSizing: 'border-box', resize: 'vertical', whiteSpace: 'pre', overflow: 'auto',
  } as Partial<CSSStyleDeclaration>);

  const suggest = attachJsonSuggestions({ doc, area, source: o.source, as: 'filter' });
  const history = createTextHistory(area);
  const box = doc.createElement('div');
  box.append(area, suggest.el);

  const status = doc.createElement('div');
  status.dataset.wmapFilterJsonStatus = '1';
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  Object.assign(status.style, { fontSize: FONT.sub, minHeight: '1.4em', whiteSpace: 'pre-wrap', color: CLR.label } as Partial<CSSStyleDeclaration>);
  const choices = doc.createElement('div');
  Object.assign(choices.style, { display: 'flex', flexDirection: 'column', gap: SPACE.xs, alignItems: 'flex-start' } as Partial<CSSStyleDeclaration>);

  const button = (label: string, tip: string): HTMLButtonElement => {
    const b = doc.createElement('button');
    b.type = 'button';
    b.textContent = label;
    wireTooltip(b, tip);
    Object.assign(b.style, controlStyle('outlined'));
    wireControlHover(b);
    return b;
  };
  const suggestBtn = button('Suggest', 'Show what can be written at the cursor (also Ctrl/Cmd+Space)');
  suggestBtn.dataset.wmapFilterJsonSuggest = '1';
  suggestBtn.addEventListener('click', () => { if (!suggest.show()) { status.style.color = CLR.label; status.textContent = 'Nothing to suggest at the cursor'; } });
  const copyBtn = button('Copy', 'Copy the text to the clipboard');
  copyBtn.addEventListener('click', () => {
    const done = (ok: boolean): void => { status.style.color = ok ? CLR.label : CLR.errText; status.textContent = ok ? 'Copied' : 'The text could not be copied: select it and copy by hand'; };
    copyText(doc, area.value, done);
  });
  const buttons = doc.createElement('div');
  Object.assign(buttons.style, { display: 'flex', gap: SPACE.sm } as Partial<CSSStyleDeclaration>);
  buttons.append(suggestBtn, copyBtn);

  /** Put `text` in the box as an edit the history can undo (setting the value would leave nothing to go back to). */
  const setText = (text: string): void => {
    area.focus();
    area.select();
    if (!doc.execCommand?.('insertText', false, text)) { area.value = text; area.dispatchEvent(new Event('input', { bubbles: true })); }
    area.setSelectionRange(0, 0);
  };

  const refresh = (): void => {
    const r = read(area.value);
    choices.replaceChildren();
    if (r.problem) {
      status.style.color = CLR.errText;
      status.textContent = r.problem;
      o.onProblem(r.problem);
      r.choices?.forEach((c, i) => {
        const b = button(`${i + 1}. ${c.name}`, 'Use this filter from the file');
        b.dataset.wmapFilterJsonChoice = String(i);
        b.addEventListener('click', () => setText(filterText({ conditions: c.conditions })));
        choices.appendChild(b);
      });
      return;
    }
    o.onProblem(undefined);
    o.onChange(r.filter ?? undefined);
    const n = r.filter?.conditions.length ?? 0;
    status.style.color = r.notes.length ? CLR.errText : CLR.label;
    status.textContent = r.notes.length ? `Left out or ignored:\n${r.notes.join('\n')}` : n === 0 ? 'No conditions: every wafer and die is shown' : `${n} condition${n === 1 ? '' : 's'}`;
  };
  area.addEventListener('input', refresh);
  // Ctrl/Cmd+Z steps through the text's own history (the browser's differs by engine), Shift or Y goes forward.
  area.addEventListener('keydown', e => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
    const k = e.key.toLowerCase();
    const undo = k === 'z' && !e.shiftKey, redo = (k === 'z' && e.shiftKey) || k === 'y';
    if (!undo && !redo) return;
    if (undo ? history.canUndo : history.canRedo) { e.preventDefault(); if (undo) history.undo(); else history.redo(); }
  });

  el.append(box, buttons, status, choices);
  refresh();
  return {
    el,
    set: f => { if (filterText(f) !== area.value) setText(filterText(f)); else refresh(); },
    discard: f => { area.value = filterText(f); refresh(); },
    focus: () => area.focus(),
  };
}
