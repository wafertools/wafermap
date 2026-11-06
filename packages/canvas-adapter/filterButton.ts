// The small outlined button the filter's band, its editor and each view's Filter button share, and what a view says when
// the filter keeps nothing. Kept apart from `pageFilter.ts` so a view can show them without loading the filter itself.

import { CLR, FONT, SPACE, controlStyle, wireControlHover, wireTooltip } from './toolbar.js';

/** The small outlined button the band, the editor and each view's Filter button share. */
export function bandButton(doc: Document, text: string, hook: string, hint: string, onClick: () => void): HTMLButtonElement {
  const b = doc.createElement('button');
  b.type = 'button';
  b.textContent = text;
  b.dataset[hook] = '1';
  Object.assign(b.style, { ...controlStyle('outlined'), fontSize: FONT.body, padding: `0 ${SPACE.md}` } as Partial<CSSStyleDeclaration>);
  wireControlHover(b);
  wireTooltip(b, hint);
  b.addEventListener('click', onClick);
  return b;
}

/** What a view says where its maps or charts would be when the filter keeps nothing. */
export function filterKeepsNothing(doc: Document, hook: string): HTMLDivElement {
  const none = doc.createElement('div');
  none.dataset[hook] = '1';
  none.textContent = 'The filter keeps no wafer and no die. Edit the filter or switch it off to see the data.';
  Object.assign(none.style, { color: CLR.label, fontSize: FONT.body, padding: SPACE.xl } as Partial<CSSStyleDeclaration>);
  return none;
}
