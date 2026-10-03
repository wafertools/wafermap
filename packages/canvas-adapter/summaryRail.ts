// A slim labelled tab on the outer edge of the map area that opens the Summary panel while
// it is closed. The toolbar's Summary icon stays; this is the findable way in. It owns no
// open/closed state: the host says when to show it and what a click does, so it can never
// disagree with the panel. Shared by renderWaferMap and renderWaferGallery.

import { CLR, FONT, RADIUS, SPACE, wireControlHover, wireTooltip } from './toolbar.js';

export interface SummaryRail {
  el: HTMLButtonElement;
  /** Show while the panel is closed and a Summary exists; `notable` tints it like the toolbar icon. */
  sync(visible: boolean, notable: boolean): void;
}

export function createSummaryRail(doc: Document, side: 'left' | 'right', onOpen: () => void): SummaryRail {
  const el = doc.createElement('button');
  el.type = 'button';
  el.dataset.wmapSummaryRail = '1';
  el.setAttribute('aria-expanded', 'false');
  el.textContent = side === 'right' ? '◂ Summary' : 'Summary ▸';
  Object.assign(el.style, {
    display: 'none', flexShrink: '0', alignSelf: 'flex-start',
    writingMode: 'vertical-rl', cursor: 'pointer', whiteSpace: 'nowrap',
    fontSize: FONT.body, fontWeight: '600', color: CLR.icon,
    background: CLR.menuBg, border: `1px solid ${CLR.menuBorder}`,
    borderRadius: RADIUS.control, padding: `${SPACE.md} ${SPACE.sm}`,
    // Sticky so, in a scrolling gallery, it stays beside the part being read.
    position: 'sticky', top: SPACE.md,
    // Outer edge of the row whichever order the host appends its children in.
    order: side === 'right' ? '10' : '-10',
  } as Partial<CSSStyleDeclaration>);
  wireControlHover(el, 'bare');
  wireTooltip(el, 'Open the Summary panel: what stands out, findings and statistics');
  el.addEventListener('click', onOpen);
  return {
    el,
    sync(visible, notable) {
      el.style.display = visible ? 'block' : 'none';
      el.style.color = notable ? CLR.findingIndicator : CLR.icon;
    },
  };
}
