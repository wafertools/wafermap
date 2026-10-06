// Die regions: the categories a die falls into from where it sits, rather than from anything the file recorded —
// ring, quadrant, and the two reticle regions. ONE definition of them, read by the plot fields and the Dies table, so a
// region is named, offered and valued the same way wherever it appears (see notes: field-vocabulary).
//
// A region is a category of dies, so it is what a chart is broken down by. It is distinct from a wafer attribute (a lot,
// a split), which Group by pools whole wafers on.

import { classifyDie } from '../core/classify.js';
import { getReticleCell, getReticleShot } from '../core/reticle.js';
import { requireRingCount } from '../core/ringCount.js';
import { hasPosition } from '../core/dies.js';
import type { Die } from '../core/dies.js';
import type { Wafer, WaferReticle } from '../core/wafer.js';
import { getRingLabel } from '../core/classify.js';

export const DIE_REGION_KEYS = ['ring', 'quadrant', 'reticleCell', 'reticleShot'] as const;
export type DieRegionKey = (typeof DIE_REGION_KEYS)[number];

/** What a region needs to place a die. */
export interface RegionContext {
  /** The wafer's geometry. Its `reticle`, when the host gave a stepper field, is what makes the reticle regions exist. */
  wafer?: Wafer;
  ringCount: number;
  /** A stepper field to use instead of `wafer.reticle`, for a caller that was handed the config on its own. */
  reticle?: WaferReticle;
}

/** The families findings and region yield group dies by. Reticle shot has none: no finding is made per shot. */
export type RegionFamily = 'ring' | 'quadrant' | 'reticle-position';

/** How findings and region yield group dies into this region: the key a finding carries, its words, and the order of the rows. */
export interface RegionGrouping {
  family: RegionFamily;
  place(die: Die, ctx: RegionContext): { key: string; label: string } | undefined;
  /** Order of two region keys. */
  order(a: string, b: string): number;
}

export interface DieRegionDef {
  key: DieRegionKey;
  /** The field's name wherever it is listed. */
  label: string;
  /** Whether this population can place a die in the region at all. */
  available(ctx: RegionContext, anyPositioned: boolean): boolean;
  /** The die's value as text on screen and in a chart (`Ring 2`, `NE`, `Reticle cell (1, 3)`), or undefined when it has none. */
  valueOf(die: Die, ctx: RegionContext): string | undefined;
  /** The same value as a spreadsheet wants it: a bare number or a short code. Defaults to `valueOf`. */
  rawOf?(die: Die, ctx: RegionContext): string | undefined;
  /** Present when findings and region yield group dies by this region. */
  grouping?: RegionGrouping;
}

/** The wafer geometry a physical region needs: a die with a position in millimetres, on a wafer that knows its centre. */
function physical(d: Die, ctx: RegionContext): boolean {
  return !!ctx.wafer && hasPosition(d) && d.physX !== undefined && d.physY !== undefined;
}

/** The die's ring and quadrant, or undefined when it cannot be placed on this wafer. */
function classify(d: Die, ctx: RegionContext, what: string) {
  if (!physical(d, ctx)) return undefined;
  return classifyDie(d as Parameters<typeof classifyDie>[0], ctx.wafer!, { ringCount: requireRingCount(ctx, what) });
}

const QUADRANT_RANK = new Map([['quadrant:NE', 0], ['quadrant:NW', 1], ['quadrant:SE', 2], ['quadrant:SW', 3]]);

function cellOf(d: Die, ctx: RegionContext): { column: number; row: number } | undefined {
  const reticle = ctx.reticle ?? ctx.wafer?.reticle;
  return reticle && hasPosition(d) ? getReticleCell(d, reticle) : undefined;
}

export const DIE_REGIONS: Record<DieRegionKey, DieRegionDef> = {
  ring: {
    key: 'ring', label: 'Ring',
    available: (ctx, anyPositioned) => !!ctx.wafer && anyPositioned,
    valueOf: (d, ctx) => { const c = classify(d, ctx, 'a ring of a plot'); return c ? `Ring ${c.ring}` : undefined; },
    rawOf: (d, ctx) => { const c = classify(d, ctx, 'a ring of a plot'); return c ? String(c.ring) : undefined; },
    grouping: {
      family: 'ring',
      // Findings say where the ring is as well as which: "Ring 1 (core)", "Ring 4 (edge)".
      place: (d, ctx) => { const c = classify(d, ctx, 'a ring'); return c ? { key: `ring:${c.ring}`, label: getRingLabel(c.ring, ctx.ringCount) } : undefined; },
      order: (a, b) => a.localeCompare(b),
    },
  },
  quadrant: {
    key: 'quadrant', label: 'Quadrant',
    available: (ctx, anyPositioned) => !!ctx.wafer && anyPositioned,
    valueOf: (d, ctx) => classify(d, ctx, 'a quadrant of a plot')?.quadrant,
    grouping: {
      family: 'quadrant',
      place: (d, ctx) => { const c = classify(d, ctx, 'a quadrant'); return c ? { key: `quadrant:${c.quadrant}`, label: c.quadrant } : undefined; },
      order: (a, b) => (QUADRANT_RANK.get(a) ?? 4) - (QUADRANT_RANK.get(b) ?? 4),
    },
  },
  reticleCell: {
    key: 'reticleCell', label: 'Reticle cell',
    available: (ctx, anyPositioned) => !!(ctx.reticle ?? ctx.wafer?.reticle) && anyPositioned,
    valueOf: (d, ctx) => { const c = cellOf(d, ctx); return c ? `Reticle cell (${c.column}, ${c.row})` : undefined; },
    grouping: {
      family: 'reticle-position',
      place: (d, ctx) => { const c = cellOf(d, ctx); return c ? { key: `reticle-position:cell:${c.column},${c.row}`, label: `Reticle cell (${c.column}, ${c.row})` } : undefined; },
      // Numeric order, so cell (2, 0) comes before cell (10, 0).
      order: (a, b) => a.localeCompare(b, undefined, { numeric: true }),
    },
  },
  reticleShot: {
    key: 'reticleShot', label: 'Reticle shot',
    available: (ctx, anyPositioned) => !!(ctx.reticle ?? ctx.wafer?.reticle) && anyPositioned,
    valueOf: (d, ctx) => {
      const reticle = ctx.reticle ?? ctx.wafer?.reticle;
      if (!reticle || !hasPosition(d)) return undefined;
      const { column, row } = getReticleShot(d, reticle);
      return `Reticle shot (${column}, ${row})`;
    },
  },
};

/** The regions this population offers, in the order they are listed. */
export function availableRegions(ctx: RegionContext, anyPositioned: boolean): DieRegionDef[] {
  return DIE_REGION_KEYS.map(k => DIE_REGIONS[k]).filter(r => r.available(ctx, anyPositioned));
}

export const isDieRegionKey = (k: string): k is DieRegionKey => (DIE_REGION_KEYS as readonly string[]).includes(k);
