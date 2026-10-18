// The PAT card: how many dies part-average testing sets apart on each wafer, and on which tests (stats/patSummary.ts).
// A table, so there is nothing to save as an image. The wafers with the most outliers come first.

import { summarisePat } from '../../stats/patSummary.js';
import { PAT_K, PAT_MIN_DIES, PAT_SKEW_WARN } from '../../stats/pat.js';
import type { Die } from '../../core/dies.js';
import type { TestDef } from '../../renderer/buildWaferMap.js';
import type { RenderableWaferMap } from '../renderWaferMap.js';
import { CLR, FONT, SPACE, controlStyle, wireControlHover, wireTooltip } from '../toolbar.js';
import { cardShell, firstRowsToggle } from './chartShell.js';
import { cardAbout } from './cardAbout.js';

export interface PatCardOptions {
  items: ReadonlyArray<{ label: string; dies: readonly Die[]; allDies?: readonly Die[]; passBins: readonly number[]; ringCount: number; source?: RenderableWaferMap }>;
  testDefs: readonly TestDef[];
  ownerDocument?: Document;
}

const FIRST_ROWS = 8;
const pct = (n: number, of: number) => (of > 0 ? `${((n / of) * 100).toFixed(of >= 1000 ? 2 : 1)}%` : '–');

/** The card, or undefined when no test has both limits or no wafer has enough passing dies for PAT limits. */
export function renderPatCard(o: PatCardOptions): { card: HTMLElement; destroy: () => void } | undefined {
  const sum = summarisePat(o.items, o.testDefs);
  if (!sum) return undefined;
  const doc = o.ownerDocument ?? document;
  const { card, body, setAbout } = cardShell('Part average testing (PAT)', undefined, doc);
  setAbout(cardAbout('pat'));
  card.dataset.wmapPatCard = '1';
  card.style.gridColumn = '1 / -1';
  card.style.flex = '0 0 auto';

  const note = doc.createElement('div');
  note.textContent = `Dynamic limits for each of the ${sum.tests} test${sum.tests === 1 ? '' : 's'} with both limits, set per wafer at the median ± ${PAT_K} robust standard deviations (interquartile range ÷ 1.35) of the dies that pass, never wider than the specification limits (the test's own where a test has none), and only where a wafer has ${PAT_MIN_DIES} or more passing values. `
    + `An outlier passes its bin and every test limit but lies outside the PAT limits of at least one test. Overall: ${sum.total.outliers.toLocaleString('en-GB')} outlier${sum.total.outliers === 1 ? '' : 's'} in ${sum.total.judged.toLocaleString('en-GB')} dies (${pct(sum.total.outliers, sum.total.judged)}). How to read this, and how it differs from AEC-Q001: User guide, section 10.12.`;
  Object.assign(note.style, { color: CLR.label, fontSize: FONT.body, marginBottom: SPACE.sm } as Partial<CSSStyleDeclaration>);
  body.appendChild(note);

  const makeTable = (heads: Array<[string, string?]>) => {
    const table = doc.createElement('table');
    Object.assign(table.style, { borderCollapse: 'collapse', width: '100%', fontSize: FONT.body, fontVariantNumeric: 'tabular-nums' } as Partial<CSSStyleDeclaration>);
    const tr = doc.createElement('tr');
    heads.forEach(([text, hint], i) => {
      const th = doc.createElement('th');
      th.scope = 'col'; th.textContent = text;
      if (hint) wireTooltip(th, hint);
      Object.assign(th.style, { textAlign: i === 0 ? 'left' : 'right', padding: `${SPACE.xs} ${SPACE.sm}`, borderBottom: `1px solid ${CLR.menuBorder}`, color: CLR.label, fontWeight: '600', whiteSpace: 'nowrap' } as Partial<CSSStyleDeclaration>);
      tr.appendChild(th);
    });
    const head = doc.createElement('thead'); head.appendChild(tr);
    const tbody = doc.createElement('tbody');
    table.append(head, tbody);
    return { table, tbody };
  };
  const row = (tbody: HTMLElement, cells: string[], strong = false) => {
    const tr = doc.createElement('tr');
    cells.forEach((text, i) => {
      const td = doc.createElement('td');
      td.textContent = text;
      Object.assign(td.style, { padding: `${SPACE.xs} ${SPACE.sm}`, textAlign: i === 0 ? 'left' : 'right', borderBottom: `1px solid ${CLR.menuBorder}`, whiteSpace: 'nowrap', fontWeight: strong ? '700' : '400' } as Partial<CSSStyleDeclaration>);
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  };

  const wafers = [...sum.wafers].sort((a, b) => b.outliers / b.judged - a.outliers / a.judged || b.outliers - a.outliers);
  const { table: wt, tbody: wb } = makeTable([['Wafer'], ['Dies judged', 'Dies with a PAT verdict'], ['Within', 'Pass and inside the PAT limits'], ['Outliers', 'Pass every limit and bin, but outside the PAT limits of a test'], ['Outlier rate'], ['Fail anyway', 'Fail their bin or a test limit']]);
  const wrap = doc.createElement('div');
  wrap.style.overflowX = 'auto';
  wrap.appendChild(wt);
  const more = firstRowsToggle(doc, {
    total: wafers.length, first: FIRST_ROWS, noun: 'wafers', scroller: wrap,
    fill: all => {
      wb.replaceChildren();
      for (const w of all ? wafers : wafers.slice(0, FIRST_ROWS)) {
        row(wb, [w.label, w.judged.toLocaleString('en-GB'), w.within.toLocaleString('en-GB'), w.outliers.toLocaleString('en-GB'), pct(w.outliers, w.judged), w.fails.toLocaleString('en-GB')], w.outliers > 0);
      }
    },
  });
  body.append(wrap, more);
  // The verdicts as a map of each wafer, in a gallery: where on each wafer the outliers are, and whether they recur.
  if (o.items.some(it => it.source)) {
    const maps = doc.createElement('button');
    maps.type = 'button';
    maps.textContent = 'Map the verdicts';
    maps.dataset.wmapPatMaps = '1';
    wireTooltip(maps, 'Open a map of each wafer with its dies coloured by PAT verdict: within the limits, outlier, fails anyway');
    Object.assign(maps.style, { ...controlStyle('outlined'), marginTop: SPACE.sm, marginLeft: SPACE.sm } as Partial<CSSStyleDeclaration>);
    wireControlHover(maps);
    maps.addEventListener('click', () => {
      // A failure here would otherwise vanish in the promise, leaving an empty window and nothing to say why.
      void import('../patMaps.js').then(m => m.openPatMaps({ anchor: maps, items: o.items, testDefs: o.testDefs }))
        .catch(e => console.error('[wafermap] The PAT verdict maps could not be drawn:', e));
    });
    body.appendChild(maps);
  }

  if (sum.byTest.length) {
    const h = doc.createElement('div');
    h.textContent = 'Where the outliers are outside';
    Object.assign(h.style, { fontWeight: '600', color: CLR.text, fontSize: FONT.body, margin: `${SPACE.md} 0 ${SPACE.xs}` } as Partial<CSSStyleDeclaration>);
    const { table: tt, tbody: tb } = makeTable([['Test'], ['Outliers', 'Outlier dies outside the PAT limits of this test; a die outside on several tests counts for each']]);
    for (const t of sum.byTest.slice(0, 5)) row(tb, [t.name, t.outliers.toLocaleString('en-GB')]);
    body.append(h, tt);
  }
  if (sum.skewed.length) {
    const h = doc.createElement('div');
    h.textContent = 'Lopsided distributions';
    Object.assign(h.style, { fontWeight: '600', color: CLR.text, fontSize: FONT.body, margin: `${SPACE.md} 0 ${SPACE.xs}` } as Partial<CSSStyleDeclaration>);
    const why = doc.createElement('div');
    why.textContent = `The middle half of these tests' values is lopsided (quartile skewness of ${PAT_SKEW_WARN} or more either way), so limits placed symmetrically about the median sit too close on one side and too far on the other: they flag normal dies on the short side and miss outliers on the long one. Read their counts with care.`;
    Object.assign(why.style, { color: CLR.label, fontSize: FONT.body, marginBottom: SPACE.xs } as Partial<CSSStyleDeclaration>);
    const { table: st, tbody: sb } = makeTable([['Test'], ['Wafers lopsided', 'Wafers where the test is lopsided, of the wafers that have PAT limits for it'], ['Most lopsided', 'Quartile skewness of the most lopsided wafer: positive means a long tail towards high values']]);
    for (const t of sum.skewed.slice(0, 5)) row(sb, [t.name, `${t.wafers} of ${t.of}`, `${t.worst > 0 ? '+' : '−'}${Math.abs(t.worst).toFixed(2)}`]);
    body.append(h, why, st);
  }
  return { card, destroy: () => {} };
}
