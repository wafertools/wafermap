// PAT verdict as a plot mode: the metadata mode, with each die's verdict (stats/pat.ts) carried as a value of a derived
// die attribute, so the legend, tooltip, counts, expand and the gallery's lot-wide colours all apply with no new
// drawing code. The host's dies are never changed: a map or a gallery card is given copies on demand.

import type { Die } from '../core/dies.js';
import { copyDie } from '../core/dieTable.js';
import type { MetadataFieldDef, TestDef } from '../renderer/buildWaferMap.js';
import { PAT_MIN_DIES, PAT_VERDICT_LABEL, PAT_VERDICT_ORDER, patTests, waferPatVerdicts } from '../stats/pat.js';

/** The die metadata key the verdict is carried under. Not a host key: nothing a host sets can collide with it. */
export const PAT_MODE_KEY = 'wmapPat';

/** The field the legend and tooltip name the verdict by; the colours say what a verdict is (blue within, amber outlier, red fails). */
export const PAT_MODE_FIELD: MetadataFieldDef = {
  key: PAT_MODE_KEY, label: 'PAT verdict',
  values: [
    { value: PAT_VERDICT_LABEL.within, color: '#0072b2' },
    { value: PAT_VERDICT_LABEL.outlier, color: '#e69f00' },
    { value: PAT_VERDICT_LABEL.fails, color: '#c0392b' },
  ],
};

/** The lot-wide order of the verdicts: fixed, so no card has to be read to know it. */
export const PAT_MODE_ORDER: readonly string[] = PAT_VERDICT_ORDER;

/** Whether these view options are the PAT verdict mode. */
export function isPatMode(o: { plotMode?: string; activeMetadataKey?: string }): boolean {
  return o.plotMode === 'metadata' && o.activeMetadataKey === PAT_MODE_KEY;
}

/** Cheap test for the mode menu: a test with both limits and a wafer with enough dies to set PAT limits from. */
export function patModeOffered(items: ReadonlyArray<{ dies: readonly Die[]; testDefs?: readonly TestDef[] } | null | undefined>): boolean {
  return items.some(it => !!it && it.dies.length >= PAT_MIN_DIES && patTests(it.testDefs ?? []).length > 0);
}

const memo = new WeakMap<readonly Die[], { testDefs: readonly TestDef[]; passKey: string; out: Die[] }>();

/**
 * A wafer's dies with each die's verdict under {@link PAT_MODE_KEY}. The verdicts are judged over the dies the page
 * filter keeps (the Insights PAT card's rule), and a die the filter dropped keeps no verdict and is left as it is, to be
 * drawn dimmed. A die no test judged carries no value and draws as no data. Memoised on the die list.
 */
export function withPatVerdicts(dies: readonly Die[], testDefs: readonly TestDef[] | undefined, passBins: readonly number[]): Die[] {
  const defs = testDefs ?? [];
  const passKey = passBins.join(',');
  const hit = memo.get(dies);
  if (hit && hit.testDefs === defs && hit.passKey === passKey) return hit.out;
  const filtered = dies.some(d => d.filteredOut);
  const kept = filtered ? dies.filter(d => !d.filteredOut) : dies;
  const verdicts = waferPatVerdicts(kept, defs, passBins);
  let k = 0;
  const out = dies.map(d => {
    if (d.filteredOut) return d;
    const v = verdicts[k++]?.verdict;
    return v ? copyDie(d, { metadata: { ...d.metadata, [PAT_MODE_KEY]: PAT_VERDICT_LABEL[v] } }) : d;
  });
  memo.set(dies, { testDefs: defs, passKey, out });
  return out;
}

/** `fields` with the verdict field added (once). */
export function withPatField(fields: readonly MetadataFieldDef[] | undefined): MetadataFieldDef[] {
  return fields?.some(f => f.key === PAT_MODE_KEY) ? [...fields] : [...(fields ?? []), PAT_MODE_FIELD];
}
