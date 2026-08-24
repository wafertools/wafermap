// Reusable die-list table: one row per die (site/index, position, hard/soft
// bin, per-test values, metadata) with CSV export. This is the general "show
// me the raw dies" view — used three ways:
//   1. In place of the map canvas for a wafer with NO positioned dies at all
//      (a wafer-shaped visual would misleadingly imply real spatial data).
//   2. The "+N dies without position data" expandable footer on a mixed
//      wafer's card, scoped to just the unpositioned subset.
//   3. A general per-wafer/lot toggle, for any wafer — exact values are
//      often easier to read as a table than picked off a coloured map.
//
// Deliberately NOT a wafer-shaped visual (no mosaic-of-tiles) even for case 1
// — a colour-coded grid risks being misread as real spatial layout by a user
// skimming quickly, which is the whole reason this exists instead of that.

import type { Die } from '../core/dies.js';
import { hasPosition } from '../core/dies.js';
import { isParametricTest, type MetadataFieldDef, type TestDef } from '../renderer/buildWaferMap.js';
import type { WaferMetadata } from '../core/metadata.js';
import { resolveMetadataColumns, type MetadataKeySelection } from '../stats/metadataColumns.js';
import { CLR, saveTextFile, type SaveTextHandler } from './toolbar.js';
import { csvField } from './summaryPanel.js';
import { fmt as fmtValue } from '../renderer/fmt.js';

/** Display preferences for the built-in die-list table. Everything here is a
 *  choice about what to show; the *data* it acts on (wafer metadata, metadata
 *  field definitions) is supplied by the library from its own build result
 *  when reached through `renderWaferMap`'s `RenderOptions.dieList` — never by
 *  the host substituting its own, so an export can't be handed the wrong
 *  identity data by mistake. */
export interface DieListDisplayOptions {
  /**
   * Show a "View die list" link inside the Summary panel (`renderWaferMap`)
   * / lot Summary panel (`renderWaferGallery`) that opens this wafer's — or,
   * in the gallery, the whole lot's — dies as a table in a modal, with the
   * same "Export CSV" button `buildDieListSection` always has. **Default
   * `true`** — set `enabled: false` to hide it. Requires a Summary panel to
   * be reachable at all (`RenderOptions.summaryPanel` / `GalleryOptions.summaryPanel`),
   * since that panel is this link's only home; irrelevant otherwise.
   *
   * Has no effect on the coordinate-less map replacement or the "+N dies
   * without position" footer, both of which show a die list unconditionally
   * regardless of this flag — those exist because there is literally nothing
   * else to show, not as an opt-in extra. The rest of this options object
   * (column selection, `maxRows`, …) is shared by both surfaces.
   */
  enabled?: boolean;
  /**
   * `die.metadata` keys to show as columns. Default `'auto'` — every key
   * present on any die, deterministically ordered. `'none'` omits them; an
   * explicit array pins both the set and the order.
   *
   * Unlike `metadataFields` (which gates the `'metadata'` PLOT mode, where a
   * key must be categorical enough for a legend), a table column has no
   * cardinality limit — one cell per die, whatever the value — so this
   * defaults to on. An export that silently drops host data is worse than a
   * wide one.
   */
  metadataColumns?: MetadataKeySelection;
  /**
   * Where wafer-level metadata (lot, wafer id, product, …) appears.
   *  - `'csv'` (default): CSV only. It is constant down every row, so on
   *    screen it is pure noise beside the metadata badge that already shows
   *    it — but a CSV travels alone, and per-row identity is what lets
   *    several exports be concatenated and pivoted later.
   *  - `'both'`: also as table columns.
   *  - `'none'`: omitted entirely.
   */
  waferMetadataColumns?: 'csv' | 'both' | 'none';
  /**
   * Cap the number of rows **rendered** in the DOM. Default `50_000`. The CSV
   * export is never capped — it always contains every die — and a footer
   * states the truncation explicitly when it applies, since a silently
   * truncated view is exactly the kind of unlabelled filtered population
   * this library's own display rules forbid.
   *
   * Exists because this table has no virtualisation: each row is real DOM.
   * At lot scale (a quarter-million dies is a realistic STDF batch) an
   * unbounded table is tens of seconds and several hundred MB before any
   * metadata column is added. Set `0` to skip the table entirely and offer
   * only the CSV export.
   */
  maxRows?: number;
  /**
   * Cap the scrolling table at this CSS length instead of letting it fill.
   *
   * Default (omitted) is **fill**: the table grows to consume whatever height
   * its container gives it (`flex: 1; min-height: 0`), which is what every
   * in-library caller wants — a card overlay, a footer panel and a resizable
   * modal all have a definite height, and a fixed cap left a short table
   * floating in a half-empty box. In a container with NO definite height the
   * table simply renders at its natural full length and the host page
   * scrolls; set this if that isn't wanted (e.g. mounting a 10k-row list
   * directly into a long document).
   */
  maxHeight?: string;
  /** CSV filename, including extension. Default: `'dies.csv'`. */
  csvFilename?: string;
}

export interface DieListOptions extends DieListDisplayOptions {
  /** Heading text. Default: `Die list (N)`. */
  title?: string;
  /** Optional note shown under the heading, e.g. explaining why this replaced the map. */
  note?: string;
  /** Host hook for "Export CSV" — see `saveTextFile` (toolbar.ts). */
  onSaveText?: SaveTextHandler;
  /**
   * Extra leading column, e.g. a wafer-id label for a lot-level combined
   * list spanning multiple wafers. `get(die)` returning `undefined` renders
   * an empty cell for that row.
   */
  extraColumn?: { label: string; get: (die: Die) => string | undefined };
  /** Wafer-level metadata for this population, e.g. `WaferMapResult.metadata`. */
  waferMetadata?: WaferMetadata;
  /** Label/order hints for die metadata columns, e.g. `WaferMapResult.metadataFields`. */
  metadataFields?: MetadataFieldDef[];
}

const DEFAULT_MAX_ROWS = 50_000;

let stylesInjected = false;

/** One scoped `<style>` block for die-list cells, shared by every table
 *  instance, instead of an inline style object per `<td>`/`<th>`. At lot
 *  scale (hundreds of thousands of dies) that is the difference between one
 *  style recalculation and one Object.assign per cell — a real cost when the
 *  table already has no virtualisation. CLR's tokens are `var(--wmap-*, …)`
 *  strings, so they resolve identically in a stylesheet rule as inline. */
function ensureStylesInjected(): void {
  if (stylesInjected) return;
  stylesInjected = true;
  const style = document.createElement('style');
  style.textContent = `
    .wmap-dielist-table { width: 100%; border-collapse: collapse; font-size: 11px; }
    .wmap-dielist-th {
      text-align: left; padding: 4px 8px; position: sticky; top: 0;
      background: ${CLR.panelBg}; color: ${CLR.label}; font-weight: 600;
      border-bottom: 1px solid ${CLR.menuBorder}; white-space: nowrap;
    }
    .wmap-dielist-td {
      padding: 3px 8px; color: ${CLR.text};
      border-bottom: 1px solid ${CLR.menuBorder}; white-space: nowrap;
    }
  `;
  document.head.appendChild(style);
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  styles?: Partial<CSSStyleDeclaration>,
  text?: string,
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (styles) Object.assign(e.style, styles);
  if (text !== undefined) e.textContent = text;
  return e;
}

function positionLabel(die: Die): string {
  return hasPosition(die) ? `(${die.x}, ${die.y})` : '—';
}

/**
 * Test columns to show: parametric `testDefs` when supplied (functional
 * tests carry no measured value, so they're excluded — same rule
 * `summaryPanel.ts`'s test-value table uses), otherwise every test number
 * discovered across the given dies' `testValues`.
 */
function resolveTestColumns(dies: Die[], testDefs: TestDef[] | undefined): TestDef[] {
  if (testDefs?.length) return testDefs.filter(isParametricTest);
  const seen = new Map<number, TestDef>();
  for (const die of dies) {
    for (const key of Object.keys(die.testValues ?? {})) {
      const tn = Number(key);
      if (!seen.has(tn)) seen.set(tn, { testNumber: tn, name: `Test ${tn}` });
    }
  }
  return [...seen.values()].sort((a, b) => a.testNumber - b.testNumber);
}

/**
 * Build a scrollable die-list table + "Export CSV" button. Returns `null`
 * when `dies` is empty (nothing to show).
 */
export function buildDieListSection(
  dies: Die[],
  testDefs: TestDef[] | undefined,
  options: DieListOptions = {},
): HTMLDivElement | null {
  if (!dies.length) return null;
  ensureStylesInjected();

  const testColumns = resolveTestColumns(dies, testDefs);
  const maxRows = options.maxRows ?? DEFAULT_MAX_ROWS;
  const truncatedRowCount = Math.max(0, dies.length - maxRows);
  const visibleDies = truncatedRowCount > 0 ? dies.slice(0, maxRows) : dies;

  // flex:1;minHeight:0 (never height:100% — see the cross-platform CSS rules
  // in tsmap's CLAUDE.md; WebView2 is strict where WebKitGTK is lenient) so
  // this stretches when its parent is a definite-height flex column, and
  // falls back to natural height otherwise.
  // minWidth:0 alongside minHeight:0 — BOTH are required. A flex item's default
  // `min-width: auto` refuses to shrink below its content's intrinsic minimum,
  // and every cell here is `white-space: nowrap`, so with many/long test-name
  // columns that minimum is the table's full width. Without this the section
  // stretches past the modal (clipped by its overflow:hidden), which drags the
  // scroll container's own vertical scrollbar off the right-hand edge — the
  // table then looks unscrollable, showing only a stray horizontal scrollbar.
  const outer = el('div', {
    display: 'flex', flexDirection: 'column', gap: '8px',
    flex: '1', minHeight: '0', minWidth: '0',
  });

  // flexShrink:0 on the fixed-height rows around the table, so the table is
  // the only thing that absorbs (or gives up) space when the box resizes.
  const headerRow = el('div', { display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: '0' });
  headerRow.appendChild(el('div', {
    fontSize: '10px', fontWeight: '700', letterSpacing: '0.06em', textTransform: 'uppercase', color: CLR.label,
  }, options.title ?? `Die list (${dies.length})`));

  const exportBtn = el('button', {
    fontSize: '11px', padding: '3px 8px', borderRadius: '4px',
    border: `1px solid ${CLR.menuBorder}`, background: CLR.menuBg, color: CLR.text, cursor: 'pointer',
  }, 'Export CSV');
  exportBtn.type = 'button';
  headerRow.appendChild(exportBtn);
  outer.appendChild(headerRow);

  if (options.note) {
    outer.appendChild(el('div', { fontSize: '11px', color: CLR.label, lineHeight: '1.4', flexShrink: '0' }, options.note));
  }

  // Built-in labels a metadata key must not silently collide with. Test
  // columns are resolved before this, so their names are already known.
  const reservedLabels = [
    ...(options.extraColumn ? [options.extraColumn.label] : []),
    'Position', 'Site', 'Hard bin', 'Soft bin',
    ...testColumns.map(td => td.name),
  ];

  const { columns: metaColumns, truncatedKeys } = resolveMetadataColumns({
    dies,
    waferMetadata: options.waferMetadata,
    metadataFields: options.metadataFields,
    dieKeys: options.metadataColumns,
    waferKeys: options.waferMetadataColumns === 'none' ? 'none' : undefined,
    waferPlacement: options.waferMetadataColumns ?? 'csv',
    reservedLabels,
  });

  type DieColumn = { label: string; get: (die: Die) => string; csvOnly?: boolean };

  const columns: DieColumn[] = [
    ...(options.extraColumn ? [{ label: options.extraColumn.label, get: (d: Die) => options.extraColumn!.get(d) ?? '' }] : []),
    { label: 'Position', get: positionLabel },
    { label: 'Site', get: (d) => d.siteNum !== undefined ? String(d.siteNum) : '' },
    { label: 'Hard bin', get: (d) => d.hbin !== undefined ? String(d.hbin) : '' },
    { label: 'Soft bin', get: (d) => d.sbin !== undefined ? String(d.sbin) : '' },
    ...testColumns.map((td) => ({
      label: td.name,
      get: (d: Die) => {
        const v = d.testValues?.[td.testNumber];
        if (v !== undefined) return fmtValue(v, td.unit);
        const p = d.testPass?.[td.testNumber];
        return p === undefined ? '' : (p ? 'PASS' : 'FAIL');
      },
    })),
    ...metaColumns.map((c) => ({ label: c.label, get: c.get, csvOnly: c.csvOnly })),
  ];
  const visibleColumns = columns.filter((c) => !c.csvOnly);

  const scrollWrap = el('div', {
    // minWidth:0 for the same reason as `outer` above — this is the element
    // that must actually stay modal-width so its own scrollbars stay reachable.
    overflow: 'auto', flex: '1', minHeight: '0', minWidth: '0',
    border: `1px solid ${CLR.menuBorder}`, borderRadius: '4px',
    ...(options.maxHeight ? { maxHeight: options.maxHeight } : {}),
  });
  const table = document.createElement('table');
  table.className = 'wmap-dielist-table';
  table.setAttribute('aria-label', options.title ?? `Die list (${dies.length} dies)`);

  const thead = el('thead');
  const headRow = el('tr');
  for (const col of visibleColumns) {
    const th = document.createElement('th');
    th.className = 'wmap-dielist-th';
    th.scope = 'col';
    th.textContent = col.label;
    headRow.appendChild(th);
  }
  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = el('tbody');
  for (const die of visibleDies) {
    const row = el('tr');
    for (const col of visibleColumns) {
      const td = document.createElement('td');
      td.className = 'wmap-dielist-td';
      td.textContent = col.get(die);
      row.appendChild(td);
    }
    tbody.appendChild(row);
  }
  table.appendChild(tbody);
  scrollWrap.appendChild(table);
  outer.appendChild(scrollWrap);

  // A rendered-but-truncated population, or metadata keys dropped by the
  // discovery cap, must be stated — an unlabelled partial view is exactly
  // what this library's own display rules forbid elsewhere (e.g. lot-stack
  // labelling, warning banners).
  if (truncatedRowCount > 0 || truncatedKeys.length > 0) {
    const parts: string[] = [];
    if (truncatedRowCount > 0) {
      parts.push(
        `Showing the first ${maxRows.toLocaleString()} of ${dies.length.toLocaleString()} dies. ` +
        `The CSV export contains all ${dies.length.toLocaleString()}.`,
      );
    }
    if (truncatedKeys.length > 0) {
      parts.push(`${truncatedKeys.length} further metadata field${truncatedKeys.length === 1 ? '' : 's'} not shown.`);
    }
    outer.appendChild(el(
      'div',
      { fontSize: '11px', color: CLR.label, lineHeight: '1.4', flexShrink: '0' },
      parts.join(' '),
    ));
  }

  exportBtn.addEventListener('click', () => {
    const lines = [columns.map((c) => csvField(c.label)).join(',')];
    for (const die of dies) {
      lines.push(columns.map((c) => csvField(c.get(die))).join(','));
    }
    saveTextFile(lines.join('\n'), options.csvFilename ?? 'dies.csv', 'text/csv', options.onSaveText);
  });

  return outer;
}
