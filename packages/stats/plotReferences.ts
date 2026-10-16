/**
 * The text a reader types for an axis's reference lines and bands, and the reverse: `0.45 Target, 0.3..0.5 Window`. A
 * number alone is a line; `lo..hi` is a band between two values; any words after it are its label. Values are in the
 * axis's own unit, as the limits and what-if limits are. At most `PLOT_REFERENCES_MAX` per axis.
 */

import type { PlotReference } from './plotSpec.js';
import { PLOT_REFERENCES_MAX } from './plotSpec.js';

const NUMBER = String.raw`[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?`;
const ENTRY = new RegExp(String.raw`^(${NUMBER})(?:\s*\.\.\s*(${NUMBER}))?(?:\s+(.+))?$`);

export type ParsedReferences = { ok: true; value: PlotReference[] } | { ok: false; error: string };

export function parseReferences(text: string): ParsedReferences {
  const entries = text.split(/[;,]/).map(t => t.trim()).filter(Boolean);
  if (entries.length > PLOT_REFERENCES_MAX) return { ok: false, error: `At most ${PLOT_REFERENCES_MAX} lines or bands on an axis` };
  const value: PlotReference[] = [];
  for (const e of entries) {
    const m = ENTRY.exec(e);
    if (!m) return { ok: false, error: `"${e}": write a number, or a range such as 0.3..0.5, then an optional name` };
    const at = Number(m[1]);
    const to = m[2] === undefined ? undefined : Number(m[2]);
    if (to !== undefined && to === at) return { ok: false, error: `"${e}": a band needs two different values` };
    const [lo, hi] = to !== undefined && to < at ? [to, at] : [at, to];
    value.push({ at: lo, ...(hi !== undefined ? { to: hi } : {}), ...(m[3] ? { label: m[3].trim() } : {}) });
  }
  return { ok: true, value };
}

export function formatReferences(refs: readonly PlotReference[] | undefined): string {
  return (refs ?? []).map(r => `${r.to !== undefined ? `${r.at}..${r.to}` : r.at}${r.label ? ` ${r.label}` : ''}`).join(', ');
}
