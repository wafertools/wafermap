// A built-in Insights card drawn as a plot.
//
// A card is a `PlotSpec` whose fields may name a slot instead of a field: the section's test, or the tab's Group by.
// The tab fills the slots each time it draws, so the card follows the reader's choices there, as the fixed panels do.
// A reader's own plot never has a slot: it names its fields outright and draws what it says on any lot. `freezeCard` is
// how a card becomes one (Edit as plot): every slot, and a colour that follows the tab, is filled with what the card
// shows now.
//
// Internal and never saved, so the plots file format does not change. Pure, no DOM.

import type { PlotColor, PlotField, PlotSpec } from './plotSpec.js';
import type { TestDef } from '../renderer/buildWaferMap.js';

/**
 * A field the tab supplies:
 *   - `test`: the section's chosen test.
 *   - `groupBy`: the tab's Group by field, or the wafer when Group by is off.
 */
export type CardSlot = { slot: 'test' } | { slot: 'groupBy' };

export type CardField = PlotField | CardSlot;

export interface CardSpec extends Omit<PlotSpec, 'fields'> {
  fields: {
    x?: CardField | CardField[];
    y?: CardField;
    color?: PlotColor;
    rows?: CardField;
    facet?: CardField;
  };
}

/** What the slots are filled with. */
export interface CardSlotValues {
  /** The section's test. Absent = none chosen yet. */
  test?: number;
  /** The tab's Group by key. Absent = Group by is off. */
  groupBy?: string;
  testDefs?: readonly TestDef[];
}

export const isCardSlot = (f: unknown): f is CardSlot => typeof f === 'object' && f !== null && 'slot' in f;

/**
 * The plot `card` draws with these slot values, or why it cannot be drawn yet (no test chosen, or one the lot does not
 * hold). The colour is left as the card states it: a colour that follows Group by keeps following it.
 */
export function fillCard(card: CardSpec, values: CardSlotValues): { spec: PlotSpec } | { issue: string } {
  let issue: string | undefined;
  const fill = (f: CardField): PlotField => {
    if (!isCardSlot(f)) return f;
    if (f.slot === 'groupBy') return values.groupBy ? { meta: values.groupBy } : { builtin: 'wafer' };
    const tn = values.test;
    const def = tn === undefined ? undefined : values.testDefs?.find(d => d.testNumber === tn);
    if (tn === undefined || (values.testDefs && !def)) { issue ??= tn === undefined ? 'Choose a test' : `Test ${tn} is not in this data`; return { test: tn ?? 0 }; }
    return def?.name ? { test: tn, name: def.name } : { test: tn };
  };
  const { fields, ...rest } = card;
  const out: NonNullable<PlotSpec['fields']> = {};
  if (fields.x !== undefined) out.x = Array.isArray(fields.x) ? fields.x.map(fill) : fill(fields.x);
  if (fields.y !== undefined) out.y = fill(fields.y);
  if (fields.rows !== undefined) out.rows = fill(fields.rows);
  if (fields.facet !== undefined) out.facet = fill(fields.facet);
  if (fields.color !== undefined) out.color = fields.color;
  if (issue) return { issue };
  return { spec: { ...rest, fields: out } };
}

/**
 * The reader's own plot made from `card` as it is drawn now (Edit as plot): the slots filled, a colour that follows the
 * tab replaced by the field it follows (the Group by field; the wafer when Group by is off and several wafers are in
 * view; no colour otherwise), under a new id. It then draws the same thing on any lot and follows nothing.
 */
export function freezeCard(card: CardSpec, values: CardSlotValues & { waferCount: number }, id: string): { spec: PlotSpec } | { issue: string } {
  const filled = fillCard(card, values);
  if ('issue' in filled) return filled;
  const spec: PlotSpec = { ...filled.spec, id, fields: { ...filled.spec.fields } };
  const c = spec.fields!.color;
  if (c === undefined || 'follow' in c) {
    spec.fields!.color = values.groupBy ? { meta: values.groupBy } : values.waferCount > 1 ? { builtin: 'wafer' } : { none: true };
  }
  return { spec };
}
