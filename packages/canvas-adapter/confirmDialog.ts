// A two-button confirmation, on the library's own modal.
//
// For an action that cannot be taken back by looking at the screen (deleting every saved plot). It is the modal every
// other window here is, so it takes focus, keeps Tab inside, hands focus back to what opened it, and closes on Escape or
// the header ✕ — all of which answer "no", the same as Cancel. Focus starts on Cancel, not on the destructive button: a
// stray Enter must not be the thing that deletes.
//
// Resolves, never rejects: `true` only when the confirm button is pressed.

import { openModal, controlStyle, wireControlHover, CLR, FONT, SPACE } from './toolbar.js';

export interface ConfirmOptions {
  doc: Document;
  /** An element from the live DOM the dialog belongs to, so it lands inside a host's own `<dialog>` (see `OverlayOptions.anchor`). */
  anchor: Element;
  title: string;
  /** What will happen, in a sentence or two. Plain text. */
  message: string;
  /** The destructive button's label, naming the action ("Delete 4 plots"), not "OK". */
  confirmLabel: string;
  cancelLabel?: string;
}

export function confirmDialog(o: ConfirmOptions): Promise<boolean> {
  const { doc } = o;
  return new Promise<boolean>(resolve => {
    let answer = false;
    let cancel: HTMLButtonElement | undefined;
    const handle = openModal({
      title: o.title,
      anchor: o.anchor,
      ownerDocument: doc,
      boxSize: { width: 'min(90vw, 460px)', height: 'auto' },
      maximizable: false,
      // Cancel, not the destructive button and not the header's ✕: the overlay would otherwise move focus to ✕ a frame after opening.
      initialFocus: () => cancel,
      onClose: () => resolve(answer),
    });
    handle.box.dataset.wmapConfirm = '1';
    // The box is sized for a map (a 240px floor); a question is as tall as its sentence.
    handle.box.style.minHeight = '0';

    const body = doc.createElement('div');
    Object.assign(body.style, { display: 'flex', flexDirection: 'column', gap: SPACE.lg, padding: SPACE.xl, color: CLR.text, fontSize: FONT.body } as Partial<CSSStyleDeclaration>);
    const message = doc.createElement('p');
    message.textContent = o.message;
    message.id = `wmap-confirm-${Math.random().toString(36).slice(2, 8)}`;
    message.style.margin = '0';
    handle.box.setAttribute('aria-describedby', message.id);

    const row = doc.createElement('div');
    Object.assign(row.style, { display: 'flex', justifyContent: 'flex-end', gap: SPACE.md, flexWrap: 'wrap' } as Partial<CSSStyleDeclaration>);
    const button = (text: string, hook: string, onClick: () => void): HTMLButtonElement => {
      const b = doc.createElement('button');
      b.type = 'button';
      b.textContent = text;
      b.dataset[hook] = '1';
      Object.assign(b.style, { ...controlStyle('outlined'), fontSize: FONT.body, padding: `${SPACE.sm} ${SPACE.lg}` } as Partial<CSSStyleDeclaration>);
      wireControlHover(b);
      b.addEventListener('click', onClick);
      return b;
    };
    cancel = button(o.cancelLabel ?? 'Cancel', 'wmapConfirmCancel', () => handle.close());
    const confirm = button(o.confirmLabel, 'wmapConfirmOk', () => { answer = true; handle.close(); });
    row.append(cancel, confirm);

    body.append(message, row);
    handle.contentWrap.appendChild(body);
  });
}
