// The suggestion list under the plot editor's JSON text: the DOM side of `plotJsonComplete.ts`.
//
// A listbox beneath the textarea (a textarea cannot place a popup at its caret). It opens as the reader types inside a
// string or starts a number, or on Ctrl/Cmd+Space; Up and Down move through it, Tab or Enter accept, Escape closes it
// without closing the window the editor is in. An accepted item goes in through the browser's own editing, so Ctrl+Z
// takes it back. The textarea keeps focus throughout (the list is not in the tab order), and says what the list is
// through `aria-controls`, `aria-expanded` and `aria-activedescendant`, as the combobox pattern in UI_STANDARDS.md asks.

import { completionsAt, type Completion, type CompletionSource } from './plotJsonComplete.js';
import { CLR, FONT, RADIUS, SPACE } from './toolbar.js';

/** Items shown at once: a lot with thousands of tests narrows as digits are typed, and the list stays a list. */
const MAX_ITEMS = 100;

let serial = 0;

export interface JsonSuggestHandle {
  /** The list, to place under the textarea. */
  el: HTMLElement;
  close(): void;
  /** Open the list at the caret as if Ctrl/Cmd+Space were pressed; false when there is nothing to suggest there. */
  show(): boolean;
}

export function attachJsonSuggestions(o: {
  doc: Document;
  area: HTMLTextAreaElement;
  source: () => CompletionSource;
}): JsonSuggestHandle {
  const { doc, area } = o;
  const id = `wmap-json-suggest-${++serial}`;
  const list = doc.createElement('div');
  list.id = id;
  list.setAttribute('role', 'listbox');
  list.setAttribute('aria-label', 'Suggestions');
  Object.assign(list.style, {
    display: 'none', maxHeight: '11.5em', overflowY: 'auto', border: `1px solid ${CLR.controlBorder}`, borderRadius: RADIUS.control,
    background: CLR.menuBg, boxSizing: 'border-box', width: '100%', fontSize: FONT.sub,
  } as Partial<CSSStyleDeclaration>);
  area.setAttribute('aria-autocomplete', 'list');
  area.setAttribute('aria-haspopup', 'listbox');
  area.setAttribute('aria-controls', id);
  area.setAttribute('aria-expanded', 'false');
  area.setAttribute('aria-keyshortcuts', 'Control+Space Meta+Space');

  let current: Completion | undefined;
  let active = 0;
  /**
   * Whether Enter takes the highlighted item. A list that opened by itself after a comma or a brace is not asking for
   * anything yet, so Enter stays a new line there (Tab, a click or the arrow keys still choose); once a word is being
   * typed, the arrow keys have been used or the list was asked for, Enter accepts.
   */
  let engaged = false;
  /** While an accepted item is going in, the input it causes does not open the list again. */
  let inserting = false;

  const optionId = (i: number): string => `${id}-${i}`;

  function close(): void {
    current = undefined;
    list.style.display = 'none';
    list.replaceChildren();
    area.setAttribute('aria-expanded', 'false');
    area.removeAttribute('aria-activedescendant');
  }

  function paintActive(): void {
    [...list.children].forEach((child, i) => {
      const on = i === active;
      (child as HTMLElement).setAttribute('aria-selected', String(on));
      (child as HTMLElement).style.background = on ? CLR.menuActive : 'transparent';
      if (on) (child as HTMLElement).scrollIntoView?.({ block: 'nearest' });
    });
    area.setAttribute('aria-activedescendant', optionId(active));
  }

  function open(c: Completion, asked: boolean): void {
    current = c;
    active = 0;
    engaged = asked || c.typed.length > 0;
    list.replaceChildren();
    c.items.slice(0, MAX_ITEMS).forEach((item, i) => {
      const row = doc.createElement('div');
      row.id = optionId(i);
      row.setAttribute('role', 'option');
      row.dataset.wmapPlotJsonSuggestion = item.label;
      Object.assign(row.style, { display: 'flex', gap: SPACE.md, padding: `${SPACE.xs} ${SPACE.md}`, cursor: 'pointer', color: CLR.text } as Partial<CSSStyleDeclaration>);
      const label = doc.createElement('span');
      label.textContent = item.label;
      label.style.fontFamily = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
      row.appendChild(label);
      if (item.detail) {
        const detail = doc.createElement('span');
        detail.textContent = item.detail;
        Object.assign(detail.style, { color: CLR.label, minWidth: '0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } as Partial<CSSStyleDeclaration>);
        row.appendChild(detail);
      }
      // Under the pointer a row is the active one, as in a native list.
      row.addEventListener('mouseenter', () => { active = i; paintActive(); });
      // The pointer must not take focus from the text: the mouse goes down on the row, and the item goes in.
      row.addEventListener('mousedown', e => { e.preventDefault(); accept(i); });
      list.appendChild(row);
    });
    list.style.display = 'block';
    area.setAttribute('aria-expanded', 'true');
    paintActive();
  }

  /** `asked`: the reader asked for the list (Ctrl/Cmd+Space, the button); otherwise it is opening itself. */
  function update(force: boolean, asked = false): boolean {
    if (area.selectionStart !== area.selectionEnd) { close(); return false; }
    const c = completionsAt(area.value, area.selectionStart, o.source(), { force });
    if (c) open(c, asked); else close();
    return !!c;
  }
  /** True where the text before the caret ends in a character after which something new is written. */
  const afterStructure = (): boolean => /[{,:[]$/.test(area.value.slice(0, area.selectionStart).trimEnd());

  function accept(i: number): void {
    const c = current;
    const item = c?.items[i];
    if (!c || !item) return;
    close();
    area.focus();
    inserting = true;
    try {
      area.setSelectionRange(c.from, c.to);
      // The browser's own insertion keeps the text's undo history; where it is not there, the text is set directly.
      if (!doc.execCommand?.('insertText', false, item.insert)) {
        area.setRangeText(item.insert, c.from, c.to, 'end');
        area.dispatchEvent(new Event('input', { bubbles: true }));
      }
    } finally { inserting = false; }
    // A key goes in with its colon: its value is the next thing to choose.
    if (/:\s?$/.test(item.insert)) update(true, true);
  }

  area.addEventListener('input', e => {
    if (inserting) return;
    const kind = (e as InputEvent).inputType ?? '';
    // Deleting, or stepping through the text's history, closes the list rather than offering again.
    if (kind.startsWith('delete') || kind.startsWith('history')) { close(); return; }
    // After a brace, comma, colon or bracket (and the new line or space that follows) what could come next is offered
    // without being asked for; anywhere else the list opens for a word being typed.
    if (afterStructure()) update(true); else update(false);
  });
  area.addEventListener('keydown', e => {
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key === ' ') { e.preventDefault(); update(true, true); return; }
    if (!current) return;
    if (e.altKey || e.shiftKey || mod) return;
    const shown = Math.min(current.items.length, MAX_ITEMS);
    if (e.key === 'ArrowDown') { e.preventDefault(); engaged = true; active = (active + 1) % shown; paintActive(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); engaged = true; active = (active + shown - 1) % shown; paintActive(); }
    else if (e.key === 'Tab' || (e.key === 'Enter' && engaged)) { e.preventDefault(); e.stopPropagation(); accept(active); }
    // Enter on a list nobody asked for is a new line, and the list is for the next position.
    else if (e.key === 'Enter') close();
    // Escape closes the list and nothing else: the window holding the editor stays.
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'Home' || e.key === 'End' || e.key === 'PageUp' || e.key === 'PageDown') close();
  });
  area.addEventListener('blur', close);
  area.addEventListener('mousedown', close);

  return { el: list, close, show: () => { area.focus(); return update(true, true); } };
}
