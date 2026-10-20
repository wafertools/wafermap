// The small outlined button the filter's band, its editor and each view's Filter button share. Kept apart from
// `pageFilter.ts` so a view can show the button without loading the filter itself.

import { FONT, SPACE, controlStyle, wireControlHover, wireTooltip } from './toolbar.js';

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
