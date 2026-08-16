// Reusable die-list table: one row per die (site/index, position, hard/soft
// bin, per-test values) with CSV export. This is the general "show me the
// raw dies" view — used three ways:
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
import { isParametricTest, type TestDef } from '../renderer/buildWaferMap.js';
import { CLR, saveTextFile, type SaveTextHandler } from './toolbar.js';
import { csvField } from './summaryPanel.js';
import { fmt as fmtValue } from '../renderer/fmt.js';

export interface DieListOptions {
  /** Heading text. Default: `Die list (N)`. */
  title?: string;
  /** Optional note shown under the heading, e.g. explaining why this replaced the map. */
  note?: string;
  /** CSV filename, including extension. Default: `'dies.csv'`. */
  csvFilename?: string;
  /** Host hook for "Export CSV" — see `saveTextFile` (toolbar.ts). */
  onSaveText?: SaveTextHandler;
  /**
   * Extra leading column, e.g. a wafer-id label for a lot-level combined
   * list spanning multiple wafers. `get(die)` returning `undefined` renders
   * an empty cell for that row.
   */
  extraColumn?: { label: string; get: (die: Die) => string | undefined };
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
  const testColumns = resolveTestColumns(dies, testDefs);

  // flex:1;minHeight:0 (never height:100% — see the cross-platform CSS rules
  // in tsmap's CLAUDE.md; WebView2 is strict where WebKitGTK is lenient) so
  // this stretches when its parent is a definite-height flex column, and
  // falls back to natural height otherwise.
  const outer = el('div', { display: 'flex', flexDirection: 'column', gap: '8px', flex: '1', minHeight: '0' });

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

  const scrollWrap = el('div', {
    overflow: 'auto', flex: '1', minHeight: '0',
    border: `1px solid ${CLR.menuBorder}`, borderRadius: '4px',
    ...(options.maxHeight ? { maxHeight: options.maxHeight } : {}),
  });
  const table = el('table', { width: '100%', borderCollapse: 'collapse', fontSize: '11px' });

  const columns: Array<{ label: string; get: (die: Die) => string }> = [
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
  ];

  const thead = el('thead');
  const headRow = el('tr');
  for (const col of columns) {
    headRow.appendChild(el('th', {
      textAlign: 'left', padding: '4px 8px', position: 'sticky', top: '0',
      background: CLR.panelBg, color: CLR.label, fontWeight: '600', borderBottom: `1px solid ${CLR.menuBorder}`,
      whiteSpace: 'nowrap',
    }, col.label));
  }
  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = el('tbody');
  for (const die of dies) {
    const row = el('tr');
    for (const col of columns) {
      row.appendChild(el('td', {
        padding: '3px 8px', color: CLR.text, borderBottom: `1px solid ${CLR.menuBorder}`, whiteSpace: 'nowrap',
      }, col.get(die)));
    }
    tbody.appendChild(row);
  }
  table.appendChild(tbody);
  scrollWrap.appendChild(table);
  outer.appendChild(scrollWrap);

  exportBtn.addEventListener('click', () => {
    const lines = [columns.map((c) => csvField(c.label)).join(',')];
    for (const die of dies) {
      lines.push(columns.map((c) => csvField(c.get(die))).join(','));
    }
    saveTextFile(lines.join('\n'), options.csvFilename ?? 'dies.csv', 'text/csv', options.onSaveText);
  });

  return outer;
}
