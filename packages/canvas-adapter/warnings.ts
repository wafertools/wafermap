// Warning collection and presentation — the single place the library decides
// what advisories exist and how they look.
//
// The library raises structured advisories from two independent places:
//   • `WaferMapResult.warnings`      — geometry inference (dies may be MIS-POSITIONED)
//   • `StatsSummary.stats.warnings`  — analysis (e.g. test-value analysis skipped)
//
// Both used to be invisible unless the host went looking. Geometry warnings were
// never rendered by any UI code at all, and the analysis ones only appeared if
// the host both passed `statsSummary` and the user opened the Summary panel.
// That inverts the library's own rule: if we have the information to know the
// display may mislead, showing it is our responsibility, not the caller's.
//
// Collection, de-duplication and ordering live here so the toolbar indicator,
// the Summary panel banner and the `onWarning` callback can never disagree about
// what is wrong with a given map.
import type { WaferWarning, WaferMapResult } from '../renderer/buildWaferMap.js';
import type { StatsSummary, LotStatsSummary } from '../stats/types.js';
import { CLR, Z_BASE } from './toolbar.js';

export type { WaferWarning };

/**
 * Controls the built-in warning UI.
 *
 * Hosts that already have their own notification system should set
 * `display: false` and read the warnings from `onWarning` — that way the library
 * still does the collecting, de-duplicating and severity ordering, and the host
 * only owns presentation. Turning the UI off without wiring `onWarning` means
 * nobody is told, which is the situation this feature exists to end.
 */
export interface WarningsOptions {
  /**
   * Show the built-in warning indicator in the toolbar and the banner in the
   * Summary panel. Default `true`.
   */
  display?: boolean;
  /**
   * Called with the collected, de-duplicated, severity-ordered warnings whenever
   * they change (including once on mount, with an empty array when there are
   * none, so a host can clear its own display).
   */
  onWarning?: (warnings: WaferWarning[]) => void;
}

const SEVERITY_ORDER: Record<NonNullable<WaferWarning['severity']>, number> = {
  error:   0,
  warning: 1,
  info:    2,
};

/** Severity with the documented default applied. */
export function severityOf(w: WaferWarning): NonNullable<WaferWarning['severity']> {
  return w.severity ?? 'warning';
}

/**
 * Gather every advisory relevant to one rendered map, most serious first.
 *
 * De-duplicated on `code` + `message`: a lot gallery legitimately produces the
 * same geometry advisory on many wafers, and repeating it once per wafer would
 * bury the one that differs.
 */
export function collectWarnings(sources: {
  /** `warnings` is optional, not merely the object: a gallery card is a
   *  `WaferMapDisplayItem`, which carries the field only when it was spread
   *  from a `WaferMapResult`. The body already tolerates its absence — the
   *  type used to require it, which is why callers reached this through a
   *  cast. */
  result?: Partial<Pick<WaferMapResult, 'warnings'>> | null;
  statsSummary?: StatsSummary | null;
  lotStatsSummary?: LotStatsSummary | null;
}): WaferWarning[] {
  const out: WaferWarning[] = [];
  const seen = new Set<string>();

  const add = (w: WaferWarning | undefined | null): void => {
    if (!w?.message) return;
    // \u0000 as the separator: no code or message can contain it, so the two
    // fields can never run together into a colliding key. Written as an escape,
    // not a literal NUL byte — a raw one in the source made git treat this whole
    // file as binary (no diff, no blame, no merge) for an identical runtime string.
    const key = `${w.code}\u0000${w.message}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(w);
  };

  for (const w of sources.result?.warnings ?? []) add(w);
  for (const w of sources.statsSummary?.stats.warnings ?? []) add(w);
  // Lot summaries carry each wafer's own analysis; a warning on any wafer is a
  // warning about the lot view the user is looking at.
  for (const pw of sources.lotStatsSummary?.perWafer ?? []) {
    for (const w of pw.summary.stats.warnings ?? []) add(w);
  }

  return out.sort((a, b) => SEVERITY_ORDER[severityOf(a)] - SEVERITY_ORDER[severityOf(b)]);
}

/** Palette for a severity — errors read as errors, not as a slightly darker notice. */
function colorsFor(sev: NonNullable<WaferWarning['severity']>): { bg: string; border: string; text: string } {
  return sev === 'error'
    ? { bg: CLR.errBg, border: CLR.errBorder, text: CLR.errText }
    : { bg: CLR.warnBg, border: CLR.warnBorder, text: CLR.warnText };
}

/** `⚠` for warnings, `⛔` for errors — shape carries the meaning, not just colour. */
function glyphFor(sev: NonNullable<WaferWarning['severity']>): string {
  return sev === 'error' ? '⛔' : sev === 'info' ? 'ℹ' : '⚠';
}

/**
 * The Summary panel banner. One block per severity present, so an "dies may be
 * mis-positioned" error is never visually flattened into an advisory.
 */
export function buildWarningsBanner(warnings: WaferWarning[], ownerDocument: Document = document): HTMLDivElement {
  const wrap = ownerDocument.createElement('div');
  Object.assign(wrap.style, { marginBottom: '10px' });

  for (const w of warnings) {
    const sev = severityOf(w);
    const c = colorsFor(sev);
    const row = ownerDocument.createElement('div');
    Object.assign(row.style, {
      background:   c.bg,
      border:       `1px solid ${c.border}`,
      borderRadius: '4px',
      padding:      '7px 9px',
      marginBottom: '6px',
      fontSize:     '10px',
      color:        c.text,
      lineHeight:   '1.5',
    });
    // role="alert" would interrupt a screen reader mid-sentence on every
    // re-render; these are persistent conditions, not interruptions.
    row.setAttribute('role', 'status');
    row.textContent = `${glyphFor(sev)} ${w.message}`;
    wrap.appendChild(row);
  }

  return wrap;
}

/**
 * The popup opened by the toolbar's warning indicator.
 *
 * Anchored like the toolbar's other menus (see `buildCheckMenuEl`) and flips to
 * right-aligned near the viewport edge.
 */
export function buildWarningsMenuEl(
  anchorRect: DOMRect,
  warnings: WaferWarning[],
  ownerWindow: Window = window,
): HTMLDivElement {
  const doc = ownerWindow.document;
  const menu = doc.createElement('div');
  const width = 280;
  const fitsRight = anchorRect.left + width <= (ownerWindow.innerWidth ?? Infinity);
  const leftPx = fitsRight ? anchorRect.left : Math.max(4, anchorRect.right - width);

  Object.assign(menu.style, {
    position:      'fixed',
    top:           `${anchorRect.bottom + 4}px`,
    left:          `${leftPx}px`,
    background:    CLR.menuBg,
    border:        `1px solid ${CLR.menuBorder}`,
    borderRadius:  '4px',
    boxShadow:     '0 4px 12px rgba(0,0,0,0.15)',
    zIndex:        Z_BASE,
    width:         `${width}px`,
    maxHeight:     '320px',
    overflowY:     'auto',
    padding:       '4px 0',
    pointerEvents: 'auto',
  });
  menu.setAttribute('role', 'dialog');
  menu.setAttribute('aria-label', 'Data warnings');

  const heading = doc.createElement('div');
  Object.assign(heading.style, {
    padding:       '6px 12px 4px',
    fontSize:      '10px',
    fontWeight:    '700',
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
    color:         CLR.label,
  });
  heading.textContent = warnings.length === 1 ? '1 warning' : `${warnings.length} warnings`;
  menu.appendChild(heading);

  for (const w of warnings) {
    const sev = severityOf(w);
    const c = colorsFor(sev);

    const row = doc.createElement('div');
    Object.assign(row.style, {
      display:       'flex',
      gap:           '8px',
      padding:       '8px 12px',
      fontSize:      '11px',
      lineHeight:    '1.5',
      color:         CLR.text,
      borderTop:     `1px solid ${CLR.menuBorder}`,
      alignItems:    'flex-start',
    });

    const icon = doc.createElement('span');
    Object.assign(icon.style, { color: c.text, flexShrink: '0' });
    icon.textContent = glyphFor(sev);
    row.appendChild(icon);

    const body = doc.createElement('div');
    const title = doc.createElement('div');
    Object.assign(title.style, { fontWeight: '700', color: c.text, marginBottom: '2px' });
    // The code is the stable identity a host would branch on, so show it rather
    // than inventing a second set of prose titles that could drift from it.
    title.textContent = w.code;
    body.appendChild(title);

    const msg = doc.createElement('div');
    msg.textContent = w.message;
    body.appendChild(msg);

    row.appendChild(body);
    menu.appendChild(row);
  }

  return menu;
}
