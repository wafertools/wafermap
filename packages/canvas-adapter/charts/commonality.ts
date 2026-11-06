// The commonality card: every wafer field ranked by how clearly its groups differ in yield and in the main fail bins,
// with each wafer as one value (stats/commonality.ts). One row per field, clearest first: its yield (or a clearer fail bin) as the
// worst and best group in two bars and a sentence, and a word for how plainly the groups differ. The p-values are in the tooltip, and the
// field's other measures open under it. A row's button groups Insights by the field, so every chart follows.

import { rankCommonality, measureLabel, groupCommonalityRows, commonalityConfidence, CONFIDENCE_LABEL, type CommonalityField, type CommonalityRow, type CommonalityWafer } from '../../stats/commonality.js';
import { formatP } from '../../stats/groupCompare.js';
import { maxGroups } from '../../stats/groupEffects.js';
import type { FacetCuration } from '../../stats/facets.js';
import { CLR, FONT, RADIUS, SPACE, controlStyle, wireControlHover, wireTooltip } from '../toolbar.js';
import { shortfallShade } from '../cellShade.js';
import { cardShell, firstRowsToggle, guideCite, renderEmptyState } from './chartShell.js';
import { GUIDE_SECTIONS } from '../../stats/guideSections.js';
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

/** Fields shown before "Show all". */
const FIRST_ROWS = 8;
/** Groups smaller than this are named with their wafer counts in the sentence, since a mean of few wafers is soft. */
const SMALL_GROUP = 5;
const BAR_W = 110;

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
  const fieldRows = groupCommonalityRows(result.rows, result.tied);

  const names = (fs: readonly CommonalityField[]) => `${fs.slice(0, -1).map(f => f.label).join(', ')}${fs.length > 1 ? ' and ' : ''}${fs[fs.length - 1].label}`;
  const note = doc.createElement('div');
  const parts = [
    `Each wafer field, compared for yield and for the ${result.bins.length} most common fail bin${result.bins.length === 1 ? '' : 's'}, with each wafer as one value. The clearest fields come first. A clear difference is more than wafer-to-wafer noise; it does not say why.`,
  ];
  if (result.overlapping.length) parts.push(`These fields nearly match, so the wafers cannot fully tell them apart: ${result.overlapping.map(o => `${names(o.fields)} and ${names(o.with)} put ${o.agree} of ${o.of} wafers in the same groups`).join('; ')}.`);
  if (result.untestable.length) parts.push(`Not compared: ${result.untestable.map(f => f.label).join(', ')}. A field is compared when two of its groups have two wafers or more and it has no more than ${maxGroups(o.wafers.length)} groups.`);
  note.textContent = parts.join(' ');
  Object.assign(note.style, { color: CLR.label, fontSize: FONT.body, marginBottom: SPACE.xs } as Partial<CSSStyleDeclaration>);
  body.appendChild(note);

  const how = doc.createElement('details');
  const howSummary = doc.createElement('summary');
  howSummary.textContent = 'How to read this';
  Object.assign(howSummary.style, { cursor: 'pointer' } as Partial<CSSStyleDeclaration>);
  wireControlHover(howSummary, 'bare');
  const howText = doc.createElement('div');
  howText.textContent = `Clear means q is under 0.05 and possible under 0.2, where q is Welch’s p adjusted for the ${result.rows.length} comparisons in the table (Benjamini–Hochberg). Hover a word for the p-values. Each field is read after allowing for the strongest other field that explains the same measure and does not contain it, and its row says so. The bars show the worst (in bold) and the best group’s mean, filled from zero on a scale of 0 to 100%; hover a bar for its group’s median, spread and wafers. `;
  howText.append(guideCite(doc, GUIDE_SECTIONS.dividesYield), '.');
  how.append(howSummary, howText);
  Object.assign(how.style, { color: CLR.label, fontSize: FONT.body, marginBottom: SPACE.sm } as Partial<CSSStyleDeclaration>);
  body.appendChild(how);

  const table = doc.createElement('table');
  Object.assign(table.style, { borderCollapse: 'collapse', width: '100%', fontSize: FONT.body, fontVariantNumeric: 'tabular-nums' } as Partial<CSSStyleDeclaration>);
  const hr = doc.createElement('tr');
  const th = (text: string, hint?: string) => {
    const c = doc.createElement('th');
    c.scope = 'col';
    c.textContent = text;
    if (hint) wireTooltip(c, hint);
    Object.assign(c.style, { textAlign: 'left', padding: `${SPACE.xs} ${SPACE.sm}`, borderBottom: `1px solid ${CLR.menuBorder}`, color: CLR.label, fontWeight: '600', whiteSpace: 'nowrap' } as Partial<CSSStyleDeclaration>);
    hr.appendChild(c);
  };
  th('Field');
  th('Effect', 'The worst and the best group’s mean over their wafers, and how far apart they are');
  th('Confidence', 'Whether the groups differ by more than wafer-to-wafer noise: clear (q under 0.05), possible (under 0.2), or not clear');
  th('');
  const head = doc.createElement('thead');
  head.appendChild(hr);
  table.appendChild(head);
  const tbody = doc.createElement('tbody');
  table.appendChild(tbody);

  const td = (tr: HTMLElement, content: string | HTMLElement, opts: { strong?: boolean; title?: string; shade?: string } = {}) => {
    const c = doc.createElement('td');
    if (typeof content === 'string') c.textContent = content; else c.appendChild(content);
    if (opts.title) wireTooltip(c, opts.title);
    if (opts.shade) c.style.background = opts.shade;
    Object.assign(c.style, { padding: `${SPACE.xs} ${SPACE.sm}`, textAlign: 'left', borderBottom: `1px solid ${CLR.menuBorder}`, verticalAlign: 'top', fontWeight: opts.strong ? '700' : '400' } as Partial<CSSStyleDeclaration>);
    tr.appendChild(c);
    return c;
  };
  const pct = (v: number) => `${v.toFixed(1)}%`;
  const pts = (v: number) => `${v.toFixed(1)} pts`;
  const n = (key: string, r: CommonalityRow) => r.comparison.groups.find(g => g.key === key)?.n ?? 0;
  const testedGroups = (r: CommonalityRow) => r.comparison.groups.filter(g => !r.comparison.tooSmall.includes(g.key) && Number.isFinite(g.mean));

  /** A yield's worst group is tinted by the report's rule against the wafers' mean yield over all the groups; a bin's share is not a yield. */
  const worstShade = (r: CommonalityRow): string | undefined => {
    if (r.measure.kind !== 'yield') return undefined;
    const gs = r.comparison.groups.filter(g => Number.isFinite(g.mean) && g.n > 0);
    const wafers = gs.reduce((a, g) => a + g.n, 0);
    return wafers > 0 ? shortfallShade(r.worst.mean - gs.reduce((a, g) => a + g.mean * g.n, 0) / wafers) : undefined;
  };

  const sentence = (r: CommonalityRow): string => {
    const base = r.measure.kind === 'yield'
      ? `${r.worst.key} is ${pts(r.spread)} below ${r.best.key}`
      : `${measureLabel(r.measure)} is ${pts(r.spread)} higher in ${r.worst.key} than in ${r.best.key}`;
    const [nw, nb] = [n(r.worst.key, r), n(r.best.key, r)];
    return Math.min(nw, nb) < SMALL_GROUP ? `${base} (${nw} vs ${nb} wafers)` : base;
  };

  /** The worst and the best group as two bars from zero, each with its mean; hover a bar for its group's detail. */
  const bars = (r: CommonalityRow): HTMLElement => {
    const groups = testedGroups(r);
    // Every bar is a percentage of dies on one 0 to 100 scale, from zero, so a bar's length is the number beside it.
    const top = 100;
    const el = doc.createElement('div');
    Object.assign(el.style, { display: 'flex', flexDirection: 'column', gap: '2px', flex: '0 0 auto' } as Partial<CSSStyleDeclaration>);
    const bar = (g: (typeof groups)[number], role: 'worst' | 'best') => {
      const row = doc.createElement('div');
      row.dataset.wmapBar = role;
      Object.assign(row.style, { display: 'flex', alignItems: 'center', gap: SPACE.sm } as Partial<CSSStyleDeclaration>);
      const name = doc.createElement('span');
      name.textContent = g.key;
      Object.assign(name.style, { width: '72px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: CLR.label, fontWeight: role === 'worst' ? '700' : '400' } as Partial<CSSStyleDeclaration>);
      const track = doc.createElement('div');
      // An outlined frame, empty inside: the filled part is the mean, the rest of the frame what is missing from the full scale.
      Object.assign(track.style, { width: `${BAR_W}px`, height: '10px', border: `1px solid ${CLR.label}`, boxSizing: 'border-box', flex: '0 0 auto' } as Partial<CSSStyleDeclaration>);
      const fill = doc.createElement('div');
      Object.assign(fill.style, { width: `${Math.max(0, Math.min(100, (g.mean / top) * 100)).toFixed(1)}%`, height: '100%', background: CLR.label } as Partial<CSSStyleDeclaration>);
      track.appendChild(fill);
      const value = doc.createElement('span');
      value.textContent = pct(g.mean);
      Object.assign(value.style, { width: '52px', textAlign: 'right' } as Partial<CSSStyleDeclaration>);
      row.append(name, track, value);
      wireTooltip(row, [
        `${g.key}${role === 'worst' ? ' (worst group)' : ' (best group)'}`,
        `mean ${pct(g.mean)} · median ${pct(g.median)}`,
        Number.isFinite(g.sd) ? `standard deviation ${g.sd.toFixed(1)} pts between wafers` : '',
        `${g.n} wafer${g.n === 1 ? '' : 's'}`,
      ].filter(Boolean).join('\n'));
      return row;
    };
    const w = groups.find(g => g.key === r.worst.key), b = groups.find(g => g.key === r.best.key);
    if (w) el.appendChild(bar(w, 'worst'));
    if (b) el.appendChild(bar(b, 'best'));
    const between = groups.filter(g => g !== w && g !== b);
    if (between.length) {
      const more = doc.createElement('div');
      more.textContent = `+ ${between.length} other group${between.length === 1 ? '' : 's'}`;
      Object.assign(more.style, { color: CLR.label } as Partial<CSSStyleDeclaration>);
      wireTooltip(more, between.map(g => `${g.key}: ${pct(g.mean)} (${g.n} wafer${g.n === 1 ? '' : 's'})`).join('\n'));
      el.appendChild(more);
    }
    return el;
  };

  const confidenceTitle = (r: CommonalityRow): string => {
    const ranked = r.adjusted ?? r.comparison;
    const kw = ranked.kruskal;
    return [
      `q ${formatP(r.pAdjusted)} · Welch p ${formatP(ranked.welch?.p ?? NaN)} · rank p ${formatP(kw?.p ?? NaN)}${kw?.approximate ? '* (approximate: fewer than five wafers in a group)' : ''}`,
      ranked.issue,
    ].filter(Boolean).join('\n');
  };

  const expanded = new Set<string>();
  let showAll = false;

  const addRow = (r: CommonalityRow, f: { field: CommonalityField; fields: readonly CommonalityField[]; others: CommonalityRow[] }, lead: boolean) => {
    const tr = doc.createElement('tr');
    tr.dataset.wmapCommonalityRow = lead ? 'field' : 'measure';
    const fieldCell = doc.createElement('div');
    if (lead) {
      const label = doc.createElement('div');
      label.textContent = names(f.fields);
      label.style.fontWeight = '600';
      if (f.fields.length > 1) wireTooltip(label, `These fields group the wafers identically, so the wafers cannot tell them apart: one row stands for all of them.`);
      fieldCell.appendChild(label);
    }
    const sub = doc.createElement('div');
    sub.textContent = measureLabel(r.measure) + (r.allowedFor ? `, allowing for ${r.allowedFor.map(a => a.label).join(', ')}` : '');
    Object.assign(sub.style, { color: CLR.label, paddingLeft: lead ? '0' : SPACE.md } as Partial<CSSStyleDeclaration>);
    if (r.allowedFor) wireTooltip(sub, `Read after allowing for ${r.allowedFor.map(a => a.label).join(', ')}: each wafer's value less its ${r.allowedFor.length === 1 ? 'group’s' : 'groups’'} mean on ${r.allowedFor.length === 1 ? 'that field' : 'those fields'}, so a difference the other field explains does not hide this one. The bars and the points are the measure's own means.`);
    fieldCell.appendChild(sub);
    if (lead && f.others.length) {
      const differ = f.others.filter(x => commonalityConfidence(x.pAdjusted) !== 'none').length;
      const b = doc.createElement('button');
      b.type = 'button';
      b.dataset.wmapCommonalityMore = f.field.key;
      const open = expanded.has(f.field.key);
      b.setAttribute('aria-expanded', String(open));
      b.textContent = open ? 'Hide other measures'
        : differ ? `+${differ} other measure${differ === 1 ? '' : 's'} ${differ === 1 ? 'differs' : 'differ'}`
        : `${f.others.length} other measure${f.others.length === 1 ? '' : 's'}`;
      Object.assign(b.style, { ...controlStyle('outlined'), marginTop: SPACE.xs, fontSize: FONT.body } as Partial<CSSStyleDeclaration>);
      wireControlHover(b);
      b.addEventListener('click', () => { if (expanded.has(f.field.key)) expanded.delete(f.field.key); else expanded.add(f.field.key); fill(showAll); });
      fieldCell.appendChild(b);
    }
    td(tr, fieldCell);

    const effect = doc.createElement('div');
    Object.assign(effect.style, { display: 'flex', alignItems: 'flex-start', gap: SPACE.md } as Partial<CSSStyleDeclaration>);
    const text = doc.createElement('span');
    text.textContent = sentence(r);
    const shade = worstShade(r);
    if (shade) Object.assign(text.style, { background: shade, padding: `0 ${SPACE.xs}`, borderRadius: RADIUS.control } as Partial<CSSStyleDeclaration>);
    text.dataset.wmapSentence = '1';
    effect.append(bars(r), text);
    td(tr, effect);

    const conf = commonalityConfidence(r.pAdjusted);
    const word = td(tr, CONFIDENCE_LABEL[conf], { strong: conf === 'clear', title: confidenceTitle(r) });
    word.dataset.wmapConfidence = conf;

    if (lead) {
      if (f.fields.some(x => x.key === o.groupedBy)) {
        td(tr, 'Grouped by this');
      } else {
        const b = doc.createElement('button');
        b.type = 'button';
        b.textContent = 'Group by';
        b.dataset.wmapCommonalityGroup = f.field.key;
        wireTooltip(b, `Group Insights by ${f.field.label}, so every chart compares its groups${f.fields.length > 1 ? `; ${names(f.fields.slice(1))} give the same groups` : ''}`);
        Object.assign(b.style, controlStyle('outlined'));
        wireControlHover(b);
        b.addEventListener('click', () => o.onGroupBy(f.field.key));
        td(tr, b);
      }
    } else {
      td(tr, '');
    }
    tbody.appendChild(tr);
  };

  function fill(all: boolean): void {
    showAll = all;
    tbody.replaceChildren();
    for (const f of all ? fieldRows : fieldRows.slice(0, FIRST_ROWS)) {
      addRow(f.primary, f, true);
      if (expanded.has(f.field.key)) for (const r of f.others) addRow(r, f, false);
    }
  }

  const scroller = doc.createElement('div');
  Object.assign(scroller.style, { overflowX: 'auto' } as Partial<CSSStyleDeclaration>);
  scroller.appendChild(table);
  const more = firstRowsToggle(doc, { total: fieldRows.length, first: FIRST_ROWS, noun: 'rows', scroller, fill });
  body.append(scroller, more);
  return { card, destroy: () => {} };
}
