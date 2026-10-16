// The difference map card: with Group by on, one group's mean minus another's at each die position, drawn as a wafer
// map (stats/differenceMap.ts). The map is a real map, rendered by `renderWaferMap` on the first wafer of group A's
// geometry and orientation, so a position on it is where it is on every other map; its colours run symmetrically about
// zero, so no difference and a difference of the opposite sign never look alike.

import { differenceMap, type DifferenceMeasure } from '../stats/differenceMap.js';
import { isParametricTest, type TestDef } from '../renderer/buildWaferMap.js';
import type { Die } from '../core/dies.js';
import { testLabel } from '../renderer/testLabel.js';
import { fmt } from '../renderer/fmt.js';
import { CLR, FONT, SPACE } from './toolbar.js';
import { cardShell, makeListSelect, renderEmptyState, type SaveImageHandler } from './charts/chartShell.js';
import { renderWaferMap, type RenderableWaferMap, type WaferMapController } from './renderWaferMap.js';

export interface DifferenceMapPanelOptions {
  groups: ReadonlyArray<{ key: string; items: ReadonlyArray<{ dies: readonly Die[]; passBins: readonly number[]; source?: RenderableWaferMap }> }>;
  testDefs: readonly TestDef[];
  groupLabelText?: string;
  /** The test the other panels show: the map starts on it, and follows it until the reader picks a measure here. */
  selectedTestNumber?: number;
  onSaveImage?: SaveImageHandler;
  ownerDocument?: Document;
}

const YIELD = '\0yield';

export function renderDifferenceMapPanel(o: DifferenceMapPanelOptions): { card: HTMLElement; setTest: (n: number) => void; destroy: () => void } {
  const doc = o.ownerDocument ?? document;
  const { card, body, controlsRow } = cardShell('Difference map', o.onSaveImage, doc);
  card.dataset.wmapDifferenceMap = '1';
  // The map draws itself into its own container: the card's PNG button would find no canvas of its own to save.
  card.querySelector('button[aria-label="Save as PNG"]')?.remove();
  const keys = o.groups.map(g => g.key);
  const tests = o.testDefs.filter(isParametricTest);
  let a = keys[0], b = keys[1];
  let measure: string = o.selectedTestNumber !== undefined && tests.some(t => t.testNumber === o.selectedTestNumber) ? String(o.selectedTestNumber) : tests[0] ? String(tests[0].testNumber) : YIELD;
  let followsSection = true;
  let map: WaferMapController | undefined;

  if (keys.length < 2) { renderEmptyState(body, 'Needs two groups to subtract.'); return { card, setTest: () => {}, destroy: () => {} }; }

  const label = (o.groupLabelText ?? 'Group').toLowerCase();
  const select = (value: string, aria: string, hook: string, set: (v: string) => void) =>
    makeListSelect(keys.map(k => ({ value: k, label: k })), value, v => { set(v); draw(); }, { ownerDocument: doc, ariaLabel: aria, hook });
  const minus = doc.createElement('span');
  minus.textContent = 'minus';
  Object.assign(minus.style, { color: CLR.label, fontSize: FONT.body } as Partial<CSSStyleDeclaration>);
  const makeMeasure = () => makeListSelect([{ value: YIELD, label: 'Yield' }, ...tests.map(t => ({ value: String(t.testNumber), label: testLabel(t, t.testNumber) }))], measure,
    v => { measure = v; followsSection = false; draw(); }, { ownerDocument: doc, ariaLabel: 'Measure', hook: 'difference-measure', searchPlaceholder: 'Filter tests…' });
  let measureSel = makeMeasure();
  controlsRow.append(select(a, `First ${label}`, 'difference-a', v => { a = v; }), minus, select(b, `Second ${label}`, 'difference-b', v => { b = v; }), measureSel);

  const note = doc.createElement('div');
  Object.assign(note.style, { color: CLR.label, fontSize: FONT.body, marginBottom: SPACE.sm } as Partial<CSSStyleDeclaration>);
  const host = doc.createElement('div');
  Object.assign(host.style, { position: 'relative', height: '380px' } as Partial<CSSStyleDeclaration>);
  body.append(note, host);

  function draw(): void {
    map?.destroy(); map = undefined;
    host.replaceChildren();
    if (a === b) { note.textContent = 'Choose two different groups.'; return; }
    const ga = o.groups.find(g => g.key === a)!, gb = o.groups.find(g => g.key === b)!;
    const m: DifferenceMeasure = measure === YIELD ? { yield: true } : { test: Number(measure) };
    const def = measure === YIELD ? undefined : tests.find(t => t.testNumber === Number(measure));
    const what = measure === YIELD ? 'Yield' : testLabel(def, Number(measure));
    const unit = measure === YIELD ? '%' : def?.unit;
    const r = differenceMap(ga.items, gb.items, m);
    note.textContent = r.compared
      ? `${what}: ${a} (${ga.items.length} wafer${ga.items.length === 1 ? '' : 's'}) minus ${b} (${gb.items.length}), each the mean over its wafers at the position${measure === YIELD ? ' of the share passing' : ''}. `
        + `${r.compared.toLocaleString('en-GB')} positions compared; the colours run from −${fmt(r.maxAbs, unit)} to +${fmt(r.maxAbs, unit)}, zero in the middle. Grey: a position one group has no value at.`
      : `${a} and ${b} have no position with a value of ${what} in common.`;
    const base = ga.items[0]?.source;
    if (!base || !r.compared) return;
    // The first wafer's geometry and orientation, without its identity: this map is no single wafer.
    const { metadata: _meta, ...wafer } = base.wafer;
    const item: RenderableWaferMap = {
      ...base, wafer, dies: r.dies, passBins: [...ga.items[0].passBins],
      testDefs: [{ testNumber: 0, name: `${what}: ${a} − ${b}`, unit }],
    };
    const range: [number, number] = [-(r.maxAbs || 1), r.maxAbs || 1];
    // A map inside Insights offers no Insights of its own.
    map = renderWaferMap(host, item, { viewOptions: { plotMode: 'value', activeTest: 0, valueRange: range }, showIdentity: false, insights: { enabled: false }, onSaveImage: o.onSaveImage });
  }
  draw();
  return {
    card,
    // Follows the section's test until the reader picks a measure here; the list is rebuilt so it shows the new one.
    setTest: n => {
      if (!followsSection || !tests.some(t => t.testNumber === n) || String(n) === measure) return;
      measure = String(n);
      const next = makeMeasure();
      measureSel.replaceWith(next);
      measureSel = next;
      draw();
    },
    destroy: () => { map?.destroy(); },
  };
}
