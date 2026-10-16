// The group comparison panel: every measured test compared across the Group by groups (the splits of a split lot),
// with each wafer as one value, ranked by how strongly the groups differ. The question a split experiment is run to
// answer — "which tests moved, and is it more than wafer-to-wafer noise?" — in one table, read from the top.
//
// The statistics are stats/groupCompare.ts's; this is the table. A row is a test: click it and the other
// Distributions panels show that test. A control group, when chosen, turns each other group's cell into its
// difference from the control with a Holm-adjusted p.

import { compareTestsByGroup, formatP, groupKeys, type TestComparison, type CompareWafer } from '../../stats/groupCompare.js';
import type { TestDef } from '../../renderer/buildWaferMap.js';
import { fmt } from '../../renderer/fmt.js';
import { testLabel, unmarkedLabel } from '../../renderer/testLabel.js';
import { CLR, FONT, SPACE, controlStyle, wireControlHover, wireTooltip, type SaveTextHandler } from '../toolbar.js';
import { exportCsv } from '../tableExport.js';
import { cardShell, makeListSelect, renderEmptyState } from './chartShell.js';

export interface GroupComparisonPanelOptions {
  title?: string;
  /** The groups to compare: each a key and its wafers' dies. */
  groups: ReadonlyArray<{ key: string; items: ReadonlyArray<{ dies: CompareWafer['dies'] }> }>;
  testDefs: readonly TestDef[];
  /** What the groups are ("Process split"), for the column heads and the method note. */
  groupLabelText?: string;
  /** The control group, or null for none. */
  control: string | null;
  onControlChange: (control: string | null) => void;
  /** The test the other panels show: its row is marked. */
  selectedTestNumber?: number;
  /** A row was chosen: show this test in the other panels. */
  onSelectTest: (testNumber: number) => void;
  onSaveText?: SaveTextHandler;
  ownerDocument?: Document;
}

const NONE = '\0none';
/** Group columns drawn in the table; more than this and the means are in the row's tooltip instead. */
const MAX_GROUP_COLUMNS = 6;

export function renderGroupComparisonPanel(o: GroupComparisonPanelOptions): { card: HTMLElement; setTest: (n: number) => void; destroy: () => void } {
  const doc = o.ownerDocument ?? document;
  const label = o.groupLabelText ?? 'group';
  const { card, body, controlsRow } = cardShell(o.title ?? `Comparison by ${label.toLowerCase()}`, undefined, doc);
  card.dataset.wmapGroupComparison = '1';
  card.style.gridColumn = '1 / -1';   // a table of many columns needs the row's width
  // A table has no canvas to save: the card's PNG button would do nothing, so it goes (Comparison CSV saves the table).
  card.querySelector('button[aria-label="Save as PNG"]')?.remove();

  const wafers: CompareWafer[] = o.groups.flatMap(g => g.items.map(it => ({ dies: it.dies, group: g.key })));
  const keys = groupKeys(wafers);
  const control = o.control !== null && keys.includes(o.control) ? o.control : null;
  const rows = compareTestsByGroup(wafers, o.testDefs, control ?? undefined);
  const shownGroups = keys.length <= MAX_GROUP_COLUMNS ? keys : [];

  const pick = makeListSelect(
    [{ value: NONE, label: 'No control: compare all groups' }, ...keys.map(k => ({ value: k, label: `Control: ${k}` }))],
    control ?? NONE, v => o.onControlChange(v === NONE ? null : v),
    { ownerDocument: doc, ariaLabel: 'Control group', hook: 'compare-control' });
  controlsRow.appendChild(pick);

  if (o.onSaveText && rows.length) {
    const csv = doc.createElement('button');
    csv.type = 'button';
    csv.textContent = 'Comparison CSV';
    wireTooltip(csv, 'Save this table as a CSV file, one row per test');
    Object.assign(csv.style, { ...controlStyle('outlined'), color: CLR.text } as Partial<CSSStyleDeclaration>);
    wireControlHover(csv);
    csv.addEventListener('click', () => exportCsv<TestComparison>([
      { header: 'Test', get: r => unmarkedLabel(testLabel(r.test, r.test.testNumber)) },
      { header: 'Test number', get: r => r.test.testNumber },
      { header: 'Unit', get: r => r.test.unit ?? '' },
      ...keys.flatMap(k => [
        { header: `${k} wafers`, get: (r: TestComparison) => r.comparison.groups.find(g => g.key === k)?.n ?? 0 },
        { header: `${k} mean`, get: (r: TestComparison) => num(r.comparison.groups.find(g => g.key === k)?.mean) },
        ...(control && k !== control ? [
          { header: `${k} minus ${control}`, get: (r: TestComparison) => num(r.comparison.contrasts?.find(c => c.key === k)?.delta) },
          { header: `${k} vs ${control} p (Holm)`, get: (r: TestComparison) => num(r.comparison.contrasts?.find(c => c.key === k)?.pAdjusted) },
        ] : []),
      ]),
      { header: 'Welch p', get: r => num(r.comparison.welch?.p) },
      { header: 'Kruskal-Wallis p', get: r => num(r.comparison.kruskal?.p) },
      { header: 'q (Benjamini-Hochberg)', get: r => num(r.pAdjusted) },
      { header: 'Largest shift (wafer SDs)', get: r => num(r.effect) },
      { header: 'Largest shift (share of limit window)', get: r => num(r.windowShare) },
      { header: 'Note', get: r => r.comparison.issue ?? '' },
    ], rows, 'group-comparison.csv', o.onSaveText!));
    controlsRow.appendChild(csv);
  }

  if (keys.length < 2) { renderEmptyState(body, `Needs two or more ${label.toLowerCase()} groups to compare.`); return { card, setTest: () => {}, destroy: () => {} }; }
  if (rows.length === 0) { renderEmptyState(body, 'No measured test has values in these wafers.'); return { card, setTest: () => {}, destroy: () => {} }; }

  const note = doc.createElement('div');
  const sizes = keys.map(k => `${k} ${wafers.filter(w => w.group === k).length}`).join(', ');
  note.textContent = `Each wafer is one value, the mean of its dies, so n is wafers (${sizes}). `
    + `Welch: Welch's ANOVA (Welch's t for two groups). Rank: Kruskal–Wallis${rows.some(r => r.comparison.kruskal?.approximate) ? ', approximate with fewer than five wafers in a group' : ''}. `
    + `q: Benjamini–Hochberg across the ${rows.length} tests, which the table is ranked by.`
    + (control ? ` Each group's difference from ${control} has a Holm-adjusted p.` : '')
    + ' How to read this: User guide, section 10.2.';
  Object.assign(note.style, { color: CLR.label, fontSize: FONT.body, marginBottom: SPACE.sm } as Partial<CSSStyleDeclaration>);
  body.appendChild(note);

  const scroller = doc.createElement('div');
  Object.assign(scroller.style, { overflow: 'auto', maxHeight: '420px', border: `1px solid ${CLR.menuBorder}` } as Partial<CSSStyleDeclaration>);
  const table = doc.createElement('table');
  Object.assign(table.style, { borderCollapse: 'collapse', width: '100%', fontSize: FONT.body, fontVariantNumeric: 'tabular-nums' } as Partial<CSSStyleDeclaration>);
  const head = doc.createElement('thead');
  const hr = doc.createElement('tr');
  const th = (text: string, hint?: string, align: 'left' | 'right' = 'right') => {
    const c = doc.createElement('th');
    c.scope = 'col';
    c.textContent = text;
    if (hint) wireTooltip(c, hint);
    Object.assign(c.style, { position: 'sticky', top: '0', background: CLR.menuBg, textAlign: align, padding: `${SPACE.xs} ${SPACE.sm}`, borderBottom: `1px solid ${CLR.menuBorder}`, color: CLR.label, fontWeight: '600', whiteSpace: 'nowrap' } as Partial<CSSStyleDeclaration>);
    hr.appendChild(c);
  };
  th('Test', undefined, 'left');
  for (const k of shownGroups) th(k === control ? `${k} (control)` : k, control && k !== control ? `Mean of the wafer means, and the difference from ${control}` : 'Mean of the wafer means');
  th('Welch p', 'Do the group means differ? Welch’s ANOVA on wafer means, not assuming equal spreads');
  th('Rank p', 'The same question on ranks (Kruskal–Wallis): one odd wafer cannot drive it');
  th('q', 'Welch p adjusted for the number of tests compared (Benjamini–Hochberg); the table is ranked by it');
  th('Largest shift', 'The largest difference between group means: in wafer-to-wafer standard deviations, and as a share of the limit window where the test has both limits');
  head.appendChild(hr);
  table.appendChild(head);

  const tbody = doc.createElement('tbody');
  const rowEls = new Map<number, HTMLTableRowElement>();
  const td = (tr: HTMLElement, content: string | HTMLElement, opts: { title?: string; strong?: boolean; muted?: boolean; align?: 'left' | 'right' } = {}) => {
    const c = doc.createElement('td');
    if (typeof content === 'string') c.textContent = content; else c.appendChild(content);
    if (opts.title) wireTooltip(c, opts.title);
    Object.assign(c.style, { padding: `${SPACE.xs} ${SPACE.sm}`, textAlign: opts.align ?? 'right', borderBottom: `1px solid ${CLR.menuBorder}`, whiteSpace: 'nowrap',
      fontWeight: opts.strong ? '700' : '400', color: opts.muted ? CLR.label : CLR.text } as Partial<CSSStyleDeclaration>);
    tr.appendChild(c);
  };
  for (const r of rows) {
    const tr = doc.createElement('tr');
    const c = r.comparison;
    const unit = r.test.unit;
    const name = doc.createElement('button');
    name.type = 'button';
    name.textContent = testLabel(r.test, r.test.testNumber);
    name.dataset.wmapCompareTest = String(r.test.testNumber);
    wireTooltip(name, `Show ${name.textContent} in the panels below${c.issue ? `. ${c.issue}` : ''}`);
    Object.assign(name.style, { ...controlStyle('bare'), padding: '0', textAlign: 'left', color: CLR.text, textDecoration: 'underline', textDecorationColor: CLR.menuBorder } as Partial<CSSStyleDeclaration>);
    wireControlHover(name, 'bare');
    name.addEventListener('click', () => { o.onSelectTest(r.test.testNumber); mark(r.test.testNumber); });
    td(tr, name, { align: 'left' });
    for (const k of shownGroups) {
      const g = c.groups.find(s => s.key === k);
      const contrast = c.contrasts?.find(x => x.key === k);
      const mean = g && g.n ? fmt(g.mean, unit) : '—';
      const text = contrast && Number.isFinite(contrast.delta)
        ? `${mean} (${contrast.delta >= 0 ? '+' : ''}${fmt(contrast.delta, unit)}, p ${formatP(contrast.pAdjusted)})`
        : mean;
      td(tr, text, { title: g ? `${k}: ${g.n} wafer${g.n === 1 ? '' : 's'}${g.n >= 2 ? `, wafer-to-wafer SD ${fmt(g.sd, unit)}` : ''}` : undefined, muted: !g || g.n < 2, strong: !!contrast && contrast.pAdjusted < 0.05 });
    }
    td(tr, formatP(c.welch?.p ?? NaN), { title: c.issue });
    td(tr, formatP(c.kruskal?.p ?? NaN));
    td(tr, formatP(r.pAdjusted), { strong: r.pAdjusted < 0.05 });
    const shift = Number.isFinite(r.effect) ? `${Math.abs(r.effect).toFixed(1)} SD${r.windowShare !== undefined ? ` · ${Math.abs(r.windowShare * 100).toFixed(0)}% of limits` : ''}` : '—';
    td(tr, shift);
    rowEls.set(r.test.testNumber, tr);
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  scroller.appendChild(table);
  body.appendChild(scroller);

  function mark(n: number | undefined): void {
    for (const [tn, tr] of rowEls) {
      tr.style.background = tn === n ? CLR.bgActive : '';
      if (tn === n) tr.setAttribute('aria-current', 'true'); else tr.removeAttribute('aria-current');
    }
  }
  mark(o.selectedTestNumber);
  return { card, setTest: mark, destroy: () => {} };
}

const num = (v: number | undefined): string => (v === undefined || !Number.isFinite(v) ? '' : String(v));
