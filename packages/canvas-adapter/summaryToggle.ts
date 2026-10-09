// The Summary button: a labelled toggle in the host's chrome row, just before the Maps | Insights
// switch, so it sits above the panel it opens and shows pressed while the panel is open. The
// familiar side-panel toggle (an editor's "toggle side bar", a document's "Comments"): the panel
// leaves nothing behind when closed, and the label makes the way back in findable. It owns no
// open/closed state: the host says what to show and what a click does, so it can never disagree
// with the panel. Shared by renderWaferMap and renderWaferGallery.

import { CLR, FONT, RADIUS, SHADOW, SPACE, wireControlHover, wireTooltip } from './toolbar.js';
import { ICONS } from './icons.js';

export interface SummaryToggle {
  el: HTMLButtonElement;
  /** `visible`: a Summary exists and the view shows it. `notable` tints the icon while the panel is closed. */
  sync(state: { visible: boolean; open: boolean; notable: boolean }): void;
}

export function createSummaryToggle(doc: Document, onToggle: () => void): SummaryToggle {
  const el = doc.createElement('button');
  el.type = 'button';
  el.dataset.wmapSummaryToggle = '1';
  Object.assign(el.style, {
    // After the toolbar and before the switch (`order` 1 like the switch, inserted ahead of it), so
    // the switch keeps its place at the end of the row when this hides in Insights.
    order: '1', flexShrink: '0', display: 'none', alignItems: 'center', gap: SPACE.xs,
    border: `1px solid ${CLR.menuBorder}`, borderRadius: RADIUS.control, boxShadow: SHADOW.panel,
    fontSize: FONT.body, fontWeight: '600', whiteSpace: 'nowrap',
    padding: `${SPACE.sm} ${SPACE.lg}`, cursor: 'pointer',
  } as Partial<CSSStyleDeclaration>);
  const icon = doc.createElement('span');
  icon.innerHTML = ICONS.findings;
  icon.setAttribute('aria-hidden', 'true');
  Object.assign(icon.style, { display: 'inline-flex', width: '14px', height: '14px' });
  const svg = icon.querySelector('svg');
  if (svg) { svg.setAttribute('width', '14'); svg.setAttribute('height', '14'); }
  el.append(icon, doc.createTextNode('Summary'));

  let open = false;
  wireTooltip(el, () => open
    ? 'Hide the Summary panel'
    : 'Show the Summary panel: what stands out, findings and statistics');
  wireControlHover(el, 'bare');
  el.addEventListener('click', onToggle);

  return {
    el,
    sync(state) {
      open = state.open;
      el.style.display = state.visible ? 'inline-flex' : 'none';
      el.setAttribute('aria-pressed', String(open));
      // `data-on` keeps the pressed background under the pointer (see wireControlHover).
      el.dataset.on = String(open);
      el.style.background = open ? CLR.bgActive : CLR.menuBg;
      el.style.color = open ? CLR.iconActive : CLR.label;
      icon.style.color = !open && state.notable ? CLR.findingIndicator : '';
    },
  };
}
