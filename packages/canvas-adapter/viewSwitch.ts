// The Maps | Insights switch: one labelled control, first in the host's chrome row,
// that stays where it is when the view changes, so it works as a toggle and as the
// discoverable way into Insights. Shared by renderWaferMap and renderWaferGallery.
// The toolbar's own Insights button stays as the quick toggle.

import { CLR, FONT, RADIUS, SHADOW, SPACE, wireControlHover, wireTooltip } from './toolbar.js';

export interface ViewSwitch {
  el: HTMLDivElement;
  /** Reflect the host's state; never calls `onChange`. */
  setInsightsOpen(open: boolean): void;
}

/**
 * `mapsLabel` is "Map" for a single wafer and "Maps" for a gallery. Built as a two-tab tablist
 * (APG Tabs): arrow keys move and activate, only the selected tab is in the Tab order.
 */
export function createViewSwitch(
  doc: Document,
  mapsLabel: string,
  /** What Insights covers: "this wafer" or "this lot", so the tooltip names the population. */
  scope: 'wafer' | 'lot',
  onChange: (insightsOpen: boolean) => void,
): ViewSwitch {
  const el = doc.createElement('div');
  el.setAttribute('role', 'tablist');
  el.setAttribute('aria-label', 'View');
  el.dataset.wmapViewSwitch = '1';
  Object.assign(el.style, {
    // First in the row whatever order the host appends its children in.
    order: '-1', flexShrink: '0', display: 'inline-flex', alignItems: 'stretch',
    background: CLR.menuBg, border: `1px solid ${CLR.menuBorder}`, borderRadius: RADIUS.control,
    boxShadow: SHADOW.panel, overflow: 'hidden',
  } as Partial<CSSStyleDeclaration>);

  const make = (label: string, view: 'maps' | 'insights', tip: string): HTMLButtonElement => {
    const b = doc.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.dataset.wmapView = view;
    b.setAttribute('role', 'tab');
    Object.assign(b.style, {
      border: 'none', cursor: 'pointer', fontSize: FONT.body,
      padding: `${SPACE.sm} ${SPACE.lg}`, whiteSpace: 'nowrap',
    } as Partial<CSSStyleDeclaration>);
    wireControlHover(b, 'bare');
    wireTooltip(b, tip);
    b.addEventListener('click', () => { if (b.getAttribute('aria-selected') !== 'true') onChange(view === 'insights'); });
    return b;
  };
  const maps = make(mapsLabel, 'maps', scope === 'lot' ? 'The wafer maps' : 'The wafer map');
  const insights = make('Insights', 'insights', `Charts and statistics for this ${scope}`);
  el.append(maps, insights);

  const paint = (b: HTMLButtonElement, on: boolean): void => {
    b.setAttribute('aria-selected', String(on));
    b.dataset.on = String(on);
    b.tabIndex = on ? 0 : -1;
    Object.assign(b.style, {
      background: on ? CLR.bgActive : 'transparent',
      color: on ? CLR.iconActive : CLR.label,
      fontWeight: '600',
    } as Partial<CSSStyleDeclaration>);
  };
  const setInsightsOpen = (open: boolean): void => { paint(maps, !open); paint(insights, open); };
  setInsightsOpen(false);

  el.addEventListener('keydown', e => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const next = doc.activeElement === maps ? insights : maps;
    if (doc.activeElement !== maps && doc.activeElement !== insights) return;
    e.preventDefault();
    next.focus();
    next.click();
  });
  return { el, setInsightsOpen };
}
