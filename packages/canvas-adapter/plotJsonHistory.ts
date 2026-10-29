// Undo and redo for the plot editor's JSON text, kept by the editor rather than left to the browser.
//
// A browser keeps an undo stack for a text box, but what it keeps differs by engine and by how the text was changed:
// setting the value, or inserting through script, can clear it or leave it out of step, and the suggestion list, a
// chosen plot and Discard edits all change the text that way. Keeping the history here means Ctrl/Cmd+Z behaves the
// same in every engine, and every change to the text, typed or not, can be taken back.
//
// Each change to the text is a state (the text and where the caret was after it). Typing and deleting a character at a
// time are joined into one step, as a text box does, until a pause, a change of direction, a space or a new line; any
// other change (a paste, an accepted suggestion, a chosen plot) is a step of its own.

export interface TextHistory {
  /** Step back; false when there is nothing earlier. */
  undo(): boolean;
  /** Step forward again; false when nothing has been undone. */
  redo(): boolean;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
}

interface State { value: string; start: number; end: number }

const MAX_STATES = 300;
/** Typing within this many milliseconds of the last character continues the same step. */
const JOIN_MS = 900;

export function createTextHistory(area: HTMLTextAreaElement, now: () => number = () => Date.now()): TextHistory {
  const states: State[] = [{ value: area.value, start: area.selectionStart, end: area.selectionEnd }];
  let at = 0;
  let restoring = false;
  let lastKind: string | undefined;
  let lastAt = 0;

  const snapshot = (): State => ({ value: area.value, start: area.selectionStart, end: area.selectionEnd });

  area.addEventListener('input', e => {
    if (restoring) return;
    const kind = (e as InputEvent).inputType ?? '';
    const data = (e as InputEvent).data ?? '';
    const t = now();
    const single = (kind === 'insertText' && data.length === 1 && !/[\s,:{}[\]]/.test(data)) || kind === 'deleteContentBackward' || kind === 'deleteContentForward';
    const join = single && kind === lastKind && t - lastAt < JOIN_MS && at === states.length - 1 && at > 0;
    lastKind = single ? kind : undefined;
    lastAt = t;
    const state = snapshot();
    if (state.value === states[at].value) { states[at] = state; return; }
    if (join) { states[at] = state; return; }
    states.length = at + 1;   // a new change drops what had been undone
    states.push(state);
    if (states.length > MAX_STATES) states.shift();
    at = states.length - 1;
  });

  function restore(i: number, direction: 'historyUndo' | 'historyRedo'): void {
    at = i;
    lastKind = undefined;
    const s = states[i];
    restoring = true;
    try {
      area.value = s.value;
      area.setSelectionRange(s.start, s.end);
      // The rest of the editor (the status line, the suggestions) follows the text as it follows typing.
      const InputEv = area.ownerDocument.defaultView?.InputEvent;
      area.dispatchEvent(InputEv ? new InputEv('input', { bubbles: true, inputType: direction }) : new Event('input', { bubbles: true }));
    } finally { restoring = false; }
  }

  return {
    undo() { if (at <= 0) return false; restore(at - 1, 'historyUndo'); return true; },
    redo() { if (at >= states.length - 1) return false; restore(at + 1, 'historyRedo'); return true; },
    get canUndo() { return at > 0; },
    get canRedo() { return at < states.length - 1; },
  };
}
