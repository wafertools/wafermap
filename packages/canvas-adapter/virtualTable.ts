// A table that renders only the rows in view.
//
// The Data tab's Dies and Wafers views can hold hundreds of thousands of rows
// (a lot's dies), and one `<tr>` per row is the several-hundred-MB, multi-second
// cost the die-list modal avoided only by capping what it shows. Here the
// scroll container's height is the full height of all the rows (two spacer rows
// above and below the ones drawn), and the rows drawn are the window the
// scrollbar is over plus a little overscan, redrawn as it moves.
//
// Rows are a fixed height, so the window is arithmetic, not measurement.
// Columns are a fixed width (`table-layout: fixed`), chosen once from the
// headers and a sample of rows, so they do not jump as different rows scroll in.
//
// Sorting orders an index permutation, never the rows, so the rows can be a
// typed-array-backed view or a plain array alike, and an export can walk the
// same order the screen shows (`orderedRows`).

import { ensureStylesInjected } from './dieList.js';
import { CLR, RADIUS } from './toolbar.js';

export interface VirtualColumn<R> {
  header: string;
  /** The cell as shown. */
  get: (row: R) => string;
  /** What to sort by, when that is not the shown text (a number column). Omit to sort by `get`. */
  sortKey?: (row: R) => number | string | undefined;
  /** Right-align (numbers). */
  numeric?: boolean;
}

export interface VirtualTableOptions<R> {
  columns: VirtualColumn<R>[];
  rows: ArrayLike<R>;
  ariaLabel: string;
  ownerDocument?: Document;
  /** Pixel height of every row. Default 24. */
  rowHeight?: number;
  /** Rows drawn beyond the visible window, each side. Default 10. */
  overscan?: number;
  /** Viewport height assumed when the element has not been laid out (tests, hidden parents). Default 480. */
  fallbackViewportHeight?: number;
  onRowClick?: (row: R, rowIndex: number) => void;
}

export interface VirtualTable<R> {
  /** The scroll container; mount it in a flex column or give it a height. */
  el: HTMLElement;
  /** Row count currently shown. */
  readonly length: number;
  /** The rows in the order shown (after sorting). Lazily walks the permutation. */
  orderedRows(): Iterable<R>;
  /** Replace the rows, keeping the current sort. */
  setRows(rows: ArrayLike<R>): void;
  /** The index range currently drawn, for tests. */
  drawnRange(): { first: number; last: number };
  destroy(): void;
}

const MIN_COL = 64;
const MAX_COL = 260;
const CH = 7.4;     // px per character at the table's 12px font, tabular figures

export function createVirtualTable<R>(opts: VirtualTableOptions<R>): VirtualTable<R> {
  const doc = opts.ownerDocument ?? document;
  ensureStylesInjected(doc);
  const rowH = opts.rowHeight ?? 24;
  const overscan = opts.overscan ?? 10;
  const cols = opts.columns;
  let rows: ArrayLike<R> = opts.rows;
  let order: Uint32Array | null = null;           // null = natural order
  let sortCol = -1;
  let sortDir: 1 | -1 = 1;
  let first = 0, last = -1;                       // drawn range (inclusive)

  const scroller = doc.createElement('div');
  Object.assign(scroller.style, {
    overflow: 'auto', flex: '1', minHeight: '0', minWidth: '0',
    border: `1px solid ${CLR.menuBorder}`, borderRadius: RADIUS.control,
  } as Partial<CSSStyleDeclaration>);
  scroller.tabIndex = 0;      // keyboard scrolling
  scroller.setAttribute('role', 'region');
  scroller.setAttribute('aria-label', opts.ariaLabel);

  const table = doc.createElement('table');
  table.className = 'wmap-dielist-table';
  table.setAttribute('aria-label', opts.ariaLabel);
  table.style.tableLayout = 'fixed';

  // Widths from the header and a sample of rows, once.
  const colgroup = doc.createElement('colgroup');
  const sampleN = Math.min(rows.length, 50);
  let totalW = 0;
  cols.forEach((c) => {
    let chars = c.header.length + 2;                 // room for the sort arrow
    for (let i = 0; i < sampleN; i++) chars = Math.max(chars, c.get(rows[i]).length);
    const w = Math.max(MIN_COL, Math.min(MAX_COL, Math.round(chars * CH + 20)));
    totalW += w;
    const col = doc.createElement('col');
    col.style.width = `${w}px`;
    colgroup.appendChild(col);
  });
  table.style.width = `${totalW}px`;
  table.style.minWidth = '100%';
  table.appendChild(colgroup);

  const thead = doc.createElement('thead');
  const headRow = doc.createElement('tr');
  const ths: HTMLTableCellElement[] = [];
  cols.forEach((c, ci) => {
    const th = doc.createElement('th');
    th.className = 'wmap-dielist-th';
    th.scope = 'col';
    th.textContent = c.header;
    th.style.cursor = 'pointer';
    th.style.overflow = 'hidden';
    th.style.textOverflow = 'ellipsis';
    if (c.numeric) th.style.textAlign = 'right';
    th.setAttribute('aria-sort', 'none');
    th.tabIndex = 0;
    const activate = () => sortBy(ci);
    th.addEventListener('click', activate);
    th.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activate(); } });
    ths.push(th);
    headRow.appendChild(th);
  });
  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = doc.createElement('tbody');
  table.appendChild(tbody);
  scroller.appendChild(table);

  const spacer = (): HTMLTableRowElement => {
    const tr = doc.createElement('tr');
    tr.setAttribute('aria-hidden', 'true');
    const td = doc.createElement('td');
    td.colSpan = cols.length;
    td.style.padding = '0';
    td.style.border = 'none';
    tr.appendChild(td);
    return tr;
  };
  const topSpacer = spacer();
  const bottomSpacer = spacer();

  const rowAt = (displayIndex: number): R => rows[order ? order[displayIndex] : displayIndex];

  function viewportHeight(): number {
    return scroller.clientHeight > 0 ? scroller.clientHeight : (opts.fallbackViewportHeight ?? 480);
  }

  function draw(force = false): void {
    const n = rows.length;
    const headH = thead.offsetHeight || rowH;
    const top = Math.max(0, scroller.scrollTop - headH);
    const f = Math.max(0, Math.floor(top / rowH) - overscan);
    const l = Math.min(n - 1, Math.ceil((top + viewportHeight()) / rowH) + overscan);
    if (!force && f === first && l === last) return;
    first = f; last = l;
    const frag = doc.createDocumentFragment();
    (topSpacer.firstElementChild as HTMLElement).style.height = `${f * rowH}px`;
    (bottomSpacer.firstElementChild as HTMLElement).style.height = `${Math.max(0, n - 1 - l) * rowH}px`;
    frag.appendChild(topSpacer);
    for (let i = f; i <= l; i++) {
      const row = rowAt(i);
      const tr = doc.createElement('tr');
      tr.style.height = `${rowH}px`;
      tr.setAttribute('aria-rowindex', String(i + 2));      // the header is row 1
      for (const c of cols) {
        const td = doc.createElement('td');
        td.className = 'wmap-dielist-td';
        td.textContent = c.get(row);
        td.style.overflow = 'hidden';
        td.style.textOverflow = 'ellipsis';
        if (c.numeric) td.style.textAlign = 'right';
        tr.appendChild(td);
      }
      if (opts.onRowClick) {
        tr.style.cursor = 'pointer';
        const idx = order ? order[i] : i;
        tr.addEventListener('click', () => opts.onRowClick!(row, idx));
      }
      frag.appendChild(tr);
    }
    frag.appendChild(bottomSpacer);
    tbody.replaceChildren(frag);
  }

  function sortBy(ci: number): void {
    if (sortCol === ci) sortDir = sortDir === 1 ? -1 : 1;
    else { sortCol = ci; sortDir = 1; }
    ths.forEach((th, i) => th.setAttribute('aria-sort', i !== sortCol ? 'none' : sortDir === 1 ? 'ascending' : 'descending'));
    ths.forEach((th, i) => { th.textContent = cols[i].header + (i === sortCol ? (sortDir === 1 ? ' ▲' : ' ▼') : ''); });
    applySort();
    scroller.scrollTop = 0;
    draw(true);
  }

  function applySort(): void {
    const n = rows.length;
    if (sortCol < 0 || n === 0) { order = null; return; }
    const c = cols[sortCol];
    const key = c.sortKey ?? c.get;
    const keys: Array<number | string | undefined> = new Array(n);
    for (let i = 0; i < n; i++) keys[i] = key(rows[i]);
    const idx = new Uint32Array(n);
    for (let i = 0; i < n; i++) idx[i] = i;
    // Missing values last in either direction; numbers by value, text by locale.
    idx.sort((a, b) => {
      const ka = keys[a], kb = keys[b];
      const ma = ka === undefined || ka === '' || (typeof ka === 'number' && Number.isNaN(ka));
      const mb = kb === undefined || kb === '' || (typeof kb === 'number' && Number.isNaN(kb));
      if (ma || mb) return ma === mb ? a - b : ma ? 1 : -1;
      const cmp = typeof ka === 'number' && typeof kb === 'number' ? ka - kb : String(ka).localeCompare(String(kb), undefined, { numeric: true });
      return cmp !== 0 ? cmp * sortDir : a - b;
    });
    order = idx;
  }

  let raf = 0;
  const win = doc.defaultView;
  const onScroll = () => {
    if (raf) return;
    if (win && typeof win.requestAnimationFrame === 'function') raf = win.requestAnimationFrame(() => { raf = 0; draw(); });
    else { draw(); }
  };
  scroller.addEventListener('scroll', onScroll);
  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => draw()) : null;
  ro?.observe(scroller);

  table.setAttribute('aria-rowcount', String(rows.length + 1));
  draw(true);

  return {
    el: scroller,
    get length() { return rows.length; },
    *orderedRows() { for (let i = 0; i < rows.length; i++) yield rowAt(i); },
    setRows(next) {
      rows = next;
      table.setAttribute('aria-rowcount', String(rows.length + 1));
      applySort();
      scroller.scrollTop = 0;
      draw(true);
    },
    drawnRange: () => ({ first, last }),
    destroy() {
      scroller.removeEventListener('scroll', onScroll);
      ro?.disconnect();
      if (raf && win) win.cancelAnimationFrame(raf);
      scroller.remove();
    },
  };
}
