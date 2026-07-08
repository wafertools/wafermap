// Canvas theming — resolves the chrome colours drawn onto the <canvas> (axis
// text, tick lines, colorbar/legend labels, active highlight, background) from
// the same `--wmap-*` CSS custom properties that theme the DOM chrome (see CLR
// in toolbar.ts). A canvas can't inherit CSS, so we read the computed variables
// ONCE per draw into a plain object and thread it through — never per die or per
// tick. That one `getComputedStyle` call is ~microseconds (benchmarked), so the
// draw cost is unchanged; per-primitive resolution would be catastrophic and is
// deliberately avoided.
//
// NOT included here: contrast/overlay effects (the dual dark+light strokes on
// ring/quadrant boundaries and colorbar limit lines, and per-die label contrast)
// are relative to the die colour *underneath*, not the theme, so they stay as
// literal rgba() in toCanvas. Data-viz colours (the bin/value palette) are the
// orthogonal `colorScheme`, untouched.

import type { WmapTokenName } from './toolbar.js';

/** Chrome colours drawn onto the canvas, resolved from `--wmap-*` per draw. */
export interface CanvasTheme {
  /** Canvas background fill. */
  background: string;
  /** Raised surface fill (e.g. gallery-export header strip). */
  surface: string;
  /** Primary on-canvas text (axis labels, legend labels, die-count). */
  text: string;
  /** Muted on-canvas text (overflow "+N", secondary counts). */
  textMuted: string;
  /** Axis tick lines / faint separators. */
  axisLine: string;
  /** Active-selection highlight (legend row, active bin). */
  accent: string;
}

/** Light defaults — the values these colours had before theming. Used as the
 *  `var(--wmap-*, <default>)` fallback so unstyled hosts render identically. */
const LIGHT: CanvasTheme = {
  background: '#f5f5f5',
  surface:    '#fff',
  text:       '#333',
  textMuted:  '#999',
  axisLine:   '#bbb',
  accent:     '#1a66cc',
};

/**
 * Resolve the canvas chrome palette from `--wmap-*` custom properties on `el`
 * (the render container, where a host sets its theme). Call ONCE per draw.
 * Each token falls back to its light default, so a host that sets no variables
 * gets the previous appearance exactly.
 *
 * `background` maps to `--wmap-canvas-bg` (a canvas can be a different shade
 * from the DOM surface — often a touch darker/lighter than the panel), falling
 * back to `--wmap-surface` and then the light default, so hosts that only set
 * the general surface token still get a sensible canvas.
 */
export function resolveCanvasTheme(el: HTMLElement | null): CanvasTheme {
  if (!el || typeof getComputedStyle !== 'function') return { ...LIGHT };
  const cs = getComputedStyle(el);
  // `name` is constrained to `WmapTokenName` — the same list `CLR` and
  // `copyWmapThemeTokens` read from in toolbar.ts — so a renamed or typo'd
  // token fails to compile here instead of silently reading a stale variable.
  const read = (name: WmapTokenName, fallback: string): string => {
    const v = cs.getPropertyValue(`--wmap-${name}`).trim();
    return v || fallback;
  };
  return {
    background: read('canvas-bg', read('surface', LIGHT.background)),
    surface:    read('surface',    LIGHT.surface),
    text:       read('text',       LIGHT.text),
    textMuted:  read('text-muted', LIGHT.textMuted),
    axisLine:   read('border',     LIGHT.axisLine),
    accent:     read('icon-active', LIGHT.accent),
  };
}
