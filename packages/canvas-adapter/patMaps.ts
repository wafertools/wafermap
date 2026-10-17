// The PAT verdicts as wafer maps: one map per wafer in a gallery, each die coloured by its verdict, so the maps' own
// legend, value toggles, expand and tooltips all apply. The verdicts are those of stats/pat.ts on the whole wafer; the
// maps are built from copies of the dies and carry no test values.

import type { Die } from '../core/dies.js';
import { copyDie } from '../core/dieTable.js';
import type { MetadataFieldDef, TestDef } from '../renderer/buildWaferMap.js';
import { PAT_VERDICT_LABEL, waferPatVerdicts } from '../stats/pat.js';
import type { RenderableWaferMap } from './renderWaferMap.js';
import { openModal } from './toolbar.js';
import { renderWaferGallery, type WaferMapDisplayItem } from './renderWaferGallery.js';

export interface PatMapItem { label: string; dies: readonly Die[]; allDies?: readonly Die[]; passBins: readonly number[]; source?: RenderableWaferMap }

/** The die metadata key the verdict is carried in, and the name the maps call it by. */
const KEY = 'pat';
const FIELD: MetadataFieldDef = {
  key: KEY, label: 'PAT verdict',
  // Colours that say what a verdict is: the dies within in blue, the outliers amber, the fails red.
  values: [
    { value: PAT_VERDICT_LABEL.within, color: '#0072b2' },
    { value: PAT_VERDICT_LABEL.outlier, color: '#e69f00' },
    { value: PAT_VERDICT_LABEL.fails, color: '#c0392b' },
  ],
};

/**
 * One map per wafer that has its own result to draw on (geometry and orientation come from it), each die carrying its
 * verdict as a value of the field "PAT verdict" and the map coloured by it, so the legend, toolbar and tooltips name the
 * verdict and not a bin. A die with no verdict (no test judged it) carries no value and draws as no data. The maps state no
 * yield: a verdict is not a bin.
 */
export function patVerdictMaps(items: readonly PatMapItem[], testDefs: readonly TestDef[]): WaferMapDisplayItem[] {
  const out: WaferMapDisplayItem[] = [];
  for (const it of items) {
    if (!it.source) continue;
    const whole = it.allDies ?? it.dies;
    const verdicts = waferPatVerdicts(whole, testDefs, it.passBins);
    const dies = whole.map((d, i) => {
      const v = verdicts[i].verdict;
      return copyDie(d as Die, { hbin: undefined, sbin: undefined, testValues: undefined, testPass: undefined, metadata: v ? { [KEY]: PAT_VERDICT_LABEL[v] } : undefined });
    });
    out.push({ ...it.source, label: it.label, dies, passBins: [], hbinDefs: [], sbinDefs: [], testDefs: [], metadataFields: [FIELD] });
  }
  return out;
}

/** Opens the maps in a window over `anchor`: a gallery of them coloured by verdict, destroyed with the window. */
export function openPatMaps(o: { anchor: HTMLElement; items: readonly PatMapItem[]; testDefs: readonly TestDef[] }): void {
  const maps = patVerdictMaps(o.items, o.testDefs);
  if (maps.length === 0) return;
  const doc = o.anchor.ownerDocument;
  const host = doc.createElement('div');
  Object.assign(host.style, { height: '100%', minHeight: '0', overflow: 'auto' } as Partial<CSSStyleDeclaration>);
  let gallery: ReturnType<typeof renderWaferGallery> | undefined;
  const handle = openModal({
    title: 'PAT verdicts by wafer', anchor: o.anchor, ownerDocument: doc, onClose: () => gallery?.destroy(),
    boxSize: { width: 'min(96vw, 1200px)', height: 'min(92vh, 780px)' },
  });
  handle.contentWrap.appendChild(host);
  gallery = renderWaferGallery(host, maps, { viewOptions: { plotMode: 'metadata', activeMetadataKey: KEY }, insights: { enabled: false } });
}
