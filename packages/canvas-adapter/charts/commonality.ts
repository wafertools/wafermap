// The commonality card: every wafer field ranked by how clearly its groups differ in yield and in the main fail bins,
// with each wafer as one value (stats/commonality.ts). Read from the top: the first rows are the fields worth grouping
// by, and a row's button does that, so every chart in Insights follows.

import { rankCommonality, measureLabel, type CommonalityField, type CommonalityWafer } from '../../stats/commonality.js';
import { formatP } from '../../stats/groupCompare.js';
import type { FacetCuration } from '../../stats/facets.js';
import { CLR, FONT, SPACE, controlStyle, wireControlHover, wireTooltip } from '../toolbar.js';
import { cardShell, firstRowsToggle, renderEmptyState } from './chartShell.js';
import { cardAbout } from './cardAbout.js';

export interface CommonalityPanelOptions {
  wafers: readonly CommonalityWafer[];
  /** The wafer fields that divide the wafers (the Group by list). */
  fields: readonly CommonalityField[];
  curation?: Record<string, FacetCuration>;
  /** The field Insights is grouped by now, if any: its row says so instead of offering it. */
  groupedBy?: string;
  /** Group Insights by this field. */
  onGroupBy: (key: string) => void;
  ownerDocument?: Document;
}

/** Rows shown before "Show all". */
const FIRST_ROWS = 8;

export function renderCommonalityPanel(o: CommonalityPanelOptions): { card: HTMLElement; destroy: () => void } {
  const doc = o.ownerDocument ?? document;
  const { card, body, setAbout } = cardShell('What divides yield', undefined, doc);
  setAbout(cardAbout('commonality'));
  card.dataset.wmapCommonality = '1';
  card.style.gridColumn = '1 / -1';
  // As tall as its table: a card sized by a canvas has a zero flex basis, and with no canvas here it would collapse.
  card.style.flex = '0 0 auto';

  const result = rankCommonality(o.wafers, o.fields, o.curation);
  if (o.fields.length === 0 || result.rows.length === 0) {
    renderEmptyState(body, o.fields.length === 0
      ? 'No wafer field divides these wafers, so there is nothing to compare.'
      : 'No wafer field has two groups of two or more wafers, so there is nothing to compare.');
    return { card, destroy: () => {} };
  }

  const note = doc.createElement('div');
  const parts = [
    `Every wafer field, compared for yield and for the ${result.bins.length} most common fail bin${result.bins.length === 1 ? '' : 's'}, with each wafer as one value. Ranked by q (Welch's p adjusted for the ${result.rows.length} comparisons). A low q says the groups differ by more than wafer-to-wafer noise; it does not say why. How to read this: User guide, section 10.3.`,
  ];
  if (result.confounded.length) parts.push(`These fields group the wafers identically, so the wafers cannot tell them apart: ${result.confounded.map(([a, b]) => `${a.label} and ${b.label}`).join('; ')}.`);
  if (result.untestable.length) parts.push(`Not compared, with no two groups of two or more wafers: ${result.untestable.map(f => f.label).join(', ')}.`);
  note.textContent = parts.join(' ');
  Object.assign(note.style, { color: CLR.label, fontSize: FONT.body, marginBottom: SPACE.sm } as Partial<CSSStyleDeclaration>);
  body.appendChild(note);

  const table = doc.createElement('table');
  Object.assign(table.style, { borderCollapse: 'collapse', width: '100%', fontSize: FONT.body, fontVariantNumeric: 'tabular-nums' } as Partial<CSSStyleDeclaration>);
  const hr = doc.createElement('tr');
  const th = (text: string, hint?: string, align: 'left' | 'right' = 'right') => {
    const c = doc.createElement('th');
    c.scope = 'col';
    c.textContent = text;
    if (hint) wireTooltip(c, hint);
    Object.assign(c.style, { textAlign: align, padding: `${SPACE.xs} ${SPACE.sm}`, borderBottom: `1px solid ${CLR.menuBorder}`, color: CLR.label, fontWeight: '600', whiteSpace: 'nowrap' } as Partial<CSSStyleDeclaration>);
    hr.appendChild(c);
  };
  th('Field', undefined, 'left');
  th('Measure', 'Yield, or a fail bin’s share of the judged dies', 'left');
  th('Worst group', 'The group with the lowest yield, or the highest rate of the bin: its mean over its wafers', 'left');
  th('Best group', undefined, 'left');
  th('Spread', 'Worst to best, in percentage points');
  th('Welch p', 'Do the groups’ wafer means differ? Welch’s ANOVA, or Welch’s t for two groups');
  th('Rank p', 'The same question on ranks (Kruskal–Wallis)');
  th('q', 'Welch p adjusted for every comparison in the table (Benjamini–Hochberg)');
  th('');
  const head = doc.createElement('thead');
  head.appendChild(hr);
  table.appendChild(head);
  const tbody = doc.createElement('tbody');
  table.appendChild(tbody);

  const td = (tr: HTMLElement, content: string | HTMLElement, opts: { align?: 'left' | 'right'; strong?: boolean; title?: string } = {}) => {
    const c = doc.createElement('td');
    if (typeof content === 'string') c.textContent = content; else c.appendChild(content);
    if (opts.title) wireTooltip(c, opts.title);
    Object.assign(c.style, { padding: `${SPACE.xs} ${SPACE.sm}`, textAlign: opts.align ?? 'right', borderBottom: `1px solid ${CLR.menuBorder}`, whiteSpace: 'nowrap', fontWeight: opts.strong ? '700' : '400' } as Partial<CSSStyleDeclaration>);
    tr.appendChild(c);
  };
  const pct = (v: number) => `${v.toFixed(1)}%`;
  const n = (key: string, row: (typeof result.rows)[number]) => row.comparison.groups.find(g => g.key === key)?.n ?? 0;

  function fill(all: boolean): void {
    tbody.replaceChildren();
    for (const r of all ? result.rows : result.rows.slice(0, FIRST_ROWS)) {
      const tr = doc.createElement('tr');
      td(tr, r.field.label, { align: 'left' });
      td(tr, measureLabel(r.measure), { align: 'left' });
      td(tr, `${r.worst.key}: ${pct(r.worst.mean)} (${n(r.worst.key, r)} wafers)`, { align: 'left' });
      td(tr, `${r.best.key}: ${pct(r.best.mean)} (${n(r.best.key, r)} wafers)`, { align: 'left' });
      td(tr, `${r.spread.toFixed(1)} pts`);
      td(tr, formatP(r.comparison.welch?.p ?? NaN), { title: r.comparison.issue });
      td(tr, `${formatP(r.comparison.kruskal?.p ?? NaN)}${r.comparison.kruskal?.approximate ? '*' : ''}`, { title: r.comparison.kruskal?.approximate ? 'Approximate: fewer than five wafers in a group' : undefined });
      td(tr, formatP(r.pAdjusted), { strong: r.pAdjusted < 0.05 });
      if (r.field.key === o.groupedBy) {
        td(tr, 'Grouped by this', { align: 'left' });
      } else {
        const b = doc.createElement('button');
        b.type = 'button';
        b.textContent = 'Group by';
        b.dataset.wmapCommonalityGroup = r.field.key;
        wireTooltip(b, `Group Insights by ${r.field.label}, so every chart compares its groups`);
        Object.assign(b.style, controlStyle('outlined'));
        wireControlHover(b);
        b.addEventListener('click', () => o.onGroupBy(r.field.key));
        td(tr, b, { align: 'left' });
      }
      tbody.appendChild(tr);
    }
  }

  const scroller = doc.createElement('div');
  Object.assign(scroller.style, { overflowX: 'auto' } as Partial<CSSStyleDeclaration>);
  scroller.appendChild(table);
  const more = firstRowsToggle(doc, { total: result.rows.length, first: FIRST_ROWS, noun: 'rows', scroller, fill });
  body.append(scroller, more);
  return { card, destroy: () => {} };
}
