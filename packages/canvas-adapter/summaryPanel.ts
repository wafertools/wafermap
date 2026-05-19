// ── Summary panel — shared DOM section builders ───────────────────────────────
// Pure DOM construction — no canvas, no toolbar state, no Plotly.
// Imported by renderWaferMap and renderWaferGallery.

import type { Wafer } from '../core/wafer.js';
import type { Die } from '../core/dies.js';
import type { BinDef, TestDef, YieldSummary } from '../renderer/buildWaferMap.js';
import type { StatsFinding, StatsSummary, LotStatsSummary } from '../stats/types.js';
import { buildRingRegions, buildQuadrantRegions } from '../stats/regions.js';
import { renderFindingsReportHtml, openHtmlReport } from '../stats/renderFindingsReport.js';
import { buildFindingsNarrative } from '../stats/findingsNarrative.js';
import { renderSummaryReportHtml, renderLotSummaryReportHtml } from '../stats/renderSummaryReport.js';
import { fmt as fmtValue } from '../renderer/fmt.js';
import { CLR } from './toolbar.js';

// ── Panel option type ─────────────────────────────────────────────────────────

export interface SummaryPanelOptions {
  /** Which side of the content area to place the panel. Default 'right'. */
  placement?: 'right' | 'left' | 'top' | 'bottom';
  /** Open the panel immediately on render without requiring the user to click the toolbar button. Default false. */
  defaultOpen?: boolean;
  /** Extra top padding in px to clear an overlapping toolbar. Set internally by renderWaferMap. */
  _toolbarClearance?: number;
}

// ── Styles ────────────────────────────────────────────────────────────────────

const PANEL_BG    = '#fafbfc';
const BORDER      = `1px solid ${CLR.menuBorder}`;
const SECTION_GAP = '12px';
const LABEL_COLOR = '#66788a';
const VALUE_COLOR = '#1f2f43';
const TITLE_SIZE  = '10px';

// ── Helpers ───────────────────────────────────────────────────────────────────

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

function sectionTitle(label: string): HTMLDivElement {
  const d = el('div', {
    fontSize:      TITLE_SIZE,
    fontWeight:    '700',
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
    color:         LABEL_COLOR,
    marginBottom:  '6px',
  }, label);
  return d;
}

/** Collapsible section wrapper. Returns the outer container and the content div. */
function collapsibleSection(
  label: string,
  defaultOpen = true,
  badge?: string,
): { outer: HTMLDivElement; content: HTMLDivElement } {
  const outer = el('div');

  const toggle = document.createElement('button');
  toggle.type = 'button';
  Object.assign(toggle.style, {
    display:        'flex',
    alignItems:     'center',
    gap:            '4px',
    width:          '100%',
    background:     'none',
    border:         'none',
    cursor:         'pointer',
    padding:        '0 0 6px',
    textAlign:      'left',
  });

  const arrow = el('span', {
    fontSize:    '9px',
    color:       LABEL_COLOR,
    transition:  'transform 0.15s',
    transform:   defaultOpen ? 'rotate(90deg)' : 'rotate(0deg)',
    display:     'inline-block',
    lineHeight:  '1',
    marginRight: '1px',
  }, '▶');

  const titleEl = el('span', {
    fontSize:      TITLE_SIZE,
    fontWeight:    '700',
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
    color:         LABEL_COLOR,
    flex:          '1',
  }, label);

  toggle.appendChild(arrow);
  toggle.appendChild(titleEl);

  if (badge) {
    const badgeEl = el('span', {
      fontSize:     '9px',
      fontWeight:   '700',
      background:   '#fef3c7',
      color:        '#92400e',
      borderRadius: '10px',
      padding:      '1px 5px',
    }, badge);
    toggle.appendChild(badgeEl);
  }

  const content = el('div');
  content.style.display = defaultOpen ? 'block' : 'none';

  let open = defaultOpen;
  toggle.addEventListener('click', () => {
    open = !open;
    content.style.display = open ? 'block' : 'none';
    arrow.style.transform = open ? 'rotate(90deg)' : 'rotate(0deg)';
  });

  outer.appendChild(toggle);
  outer.appendChild(content);
  return { outer, content };
}

function separator(): HTMLDivElement {
  return el('div', {
    height:     '1px',
    background: CLR.separator,
    margin:     `${SECTION_GAP} 0`,
    flexShrink: '0',
  });
}

/** Render a progress bar row: label left, bar + percent right. */
function progressRow(label: string, value: number, color = '#2a6fc0'): HTMLDivElement {
  const row = el('div', { marginBottom: '5px' });

  const top = el('div', {
    display:        'flex',
    justifyContent: 'space-between',
    fontSize:       '11px',
    color:          VALUE_COLOR,
    marginBottom:   '2px',
  });
  const lbl = el('span', {}, label);
  const pct = el('span', { fontWeight: '600' }, `${value.toFixed(1)}%`);
  top.appendChild(lbl);
  top.appendChild(pct);

  const track = el('div', {
    height:       '5px',
    background:   '#e2e5ea',
    borderRadius: '3px',
    overflow:     'hidden',
  });
  const fill = el('div', {
    height:     '100%',
    width:      `${Math.min(100, Math.max(0, value))}%`,
    background: color,
    borderRadius: '3px',
    transition: 'width 0.3s ease',
  });
  track.appendChild(fill);
  row.appendChild(top);
  row.appendChild(track);
  return row;
}

/** Big stat card — used for yield % and total dies. */
function statCard(value: string, label: string): HTMLDivElement {
  const card = el('div', {
    background:   '#fff',
    border:       BORDER,
    borderRadius: '6px',
    padding:      '8px 10px',
    textAlign:    'center',
    flex:         '1',
  });
  const v = el('div', {
    fontSize:   '20px',
    fontWeight: '700',
    color:      VALUE_COLOR,
    lineHeight: '1.2',
  }, value);
  const lbl = el('div', {
    fontSize:   '10px',
    color:      LABEL_COLOR,
    marginTop:  '2px',
  }, label);
  card.appendChild(v);
  card.appendChild(lbl);
  return card;
}

/** Key-value row for metadata. */
function kvRow(key: string, value: string): HTMLDivElement {
  const row = el('div', {
    display:        'flex',
    justifyContent: 'space-between',
    fontSize:       '11px',
    gap:            '8px',
    marginBottom:   '3px',
  });
  const k = el('span', { color: LABEL_COLOR, flexShrink: '0' }, key);
  const v = el('span', { color: VALUE_COLOR, textAlign: 'right', fontWeight: '500', wordBreak: 'break-all' }, value);
  row.appendChild(k);
  row.appendChild(v);
  return row;
}


// ── Section builders ──────────────────────────────────────────────────────────

function prettyKey(k: string): string {
  return k
    .replace(/([A-Z])/g, ' $1')
    .replace(/_/g, ' ')
    .trim()
    .replace(/^./, s => s.toUpperCase());
}

export function buildMetadataSection(meta: Record<string, unknown>): HTMLDivElement | null {
  const entries = Object.entries(meta).filter(([, v]) => v !== null && v !== undefined && v !== '');
  if (!entries.length) return null;

  const wrap = el('div');
  wrap.appendChild(sectionTitle('Wafer Info'));
  for (const [k, v] of entries) {
    wrap.appendChild(kvRow(prettyKey(k), String(v)));
  }
  return wrap;
}

export function buildYieldSection(
  yieldSummary: YieldSummary,
  dataCoverage: { filledDies: number; totalDies: number; edgeExcludedDies: number; ratio: number },
  passBins: number[] = [1],
): HTMLDivElement {
  const wrap = el('div');
  wrap.appendChild(sectionTitle('Summary'));

  const cards = el('div', { display: 'flex', gap: '6px', marginBottom: '8px' });
  cards.appendChild(statCard(String(dataCoverage.totalDies), 'Total dies'));
  if (yieldSummary.partialDies > 0) {
    cards.appendChild(statCard(String(yieldSummary.partialDies), 'Partial'));
  }
  if (yieldSummary.yieldPercent !== null) {
    const binLabel = passBins.length === 1 ? `bin ${passBins[0]}` : `bins ${passBins.join(', ')}`;
    cards.appendChild(statCard(`${(yieldSummary.yieldPercent * 100).toFixed(1)}%`, `Yield (pass: ${binLabel})`));
  }
  wrap.appendChild(cards);

  if (yieldSummary.edgeExcludedDies > 0) {
    wrap.appendChild(kvRow('Edge excluded (outer zone)', String(yieldSummary.edgeExcludedDies)));
  }

  return wrap;
}

export function buildBinSection(
  dies: Die[],
  binDefs: BinDef[] | undefined,
  mode: 'hard' | 'soft',
): HTMLDivElement | null {
  const binCounts = new Map<number, number>();
  for (const d of dies) {
    if (d.partial || d.edgeExcluded) continue;
    const b = mode === 'hard' ? d.hbin : d.sbin;
    if (b != null) binCounts.set(b, (binCounts.get(b) ?? 0) + 1);
  }
  if (!binCounts.size) return null;

  const total = [...binCounts.values()].reduce((a, b) => a + b, 0);
  const defMap = binDefs ? new Map(binDefs.map(d => [d.bin, d])) : null;
  const sorted = [...binCounts.entries()].sort((a, b) => a[0] - b[0]);

  const wrap = el('div');
  wrap.appendChild(sectionTitle(mode === 'hard' ? 'Hard Bin Breakdown' : 'Soft Bin Breakdown'));
  for (const [bin, count] of sorted) {
    const def   = defMap?.get(bin);
    const label = def?.name ? `Bin ${bin} · ${def.name}` : `Bin ${bin}`;
    const pct   = (count / total) * 100;
    const color = def?.color ?? '#2a6fc0';
    wrap.appendChild(progressRow(`${label}  (${count})`, pct, color));
  }
  return wrap;
}

type RegionBuilder = (dies: Die[], wafer: Wafer, ringCount: number) => ReturnType<typeof buildRingRegions>;

function buildRegionYieldSection(
  dies: Die[],
  wafer: Wafer,
  ringCount: number,
  passBins: number[],
  regionBuilder: RegionBuilder,
  title: string,
): HTMLDivElement | null {
  const hasBins = dies.some(d => d.hbin != null || d.sbin != null);
  if (!hasBins) return null;
  const regions = regionBuilder(dies, wafer, ringCount);
  if (!regions.length) return null;

  const passSet  = new Set(passBins);
  const dieByKey = new Map<string, Die>(dies.map(d => [`${d.x},${d.y}`, d]));

  const wrap = el('div');
  wrap.appendChild(sectionTitle(title));
  for (const region of regions) {
    let pass = 0, total = 0;
    for (const key of region.dieKeys) {
      const d = dieByKey.get(key);
      if (!d || d.partial || d.edgeExcluded) continue;
      const b = d.hbin ?? d.sbin;
      if (b == null) continue;
      total++;
      if (passSet.has(b)) pass++;
    }
    if (!total) continue;
    wrap.appendChild(progressRow(`${region.label} (N=${total})`, (pass / total) * 100));
  }
  return wrap;
}

export function buildRingSection(
  dies: Die[],
  wafer: Wafer,
  ringCount: number,
  passBins: number[],
): HTMLDivElement | null {
  return buildRegionYieldSection(dies, wafer, ringCount, passBins, buildRingRegions, 'Ring Yield');
}

export function buildQuadrantSection(
  dies: Die[],
  wafer: Wafer,
  ringCount: number,
  passBins: number[],
): HTMLDivElement | null {
  return buildRegionYieldSection(dies, wafer, ringCount, passBins, buildQuadrantRegions, 'Quadrant Yield');
}

const TEST_INLINE_LIMIT = 3;

export function buildTestSection(
  dies: Die[],
  testDefs: TestDef[] | undefined,
  fallbackFormat?: 'si' | 'engineering',
): HTMLDivElement | null {
  const activeDies = dies.filter(d => !d.partial && !d.edgeExcluded);

  // Build a unified list of { testNumber, name, unit } from testDefs when present,
  // or from the testNumber keys found in die.testValues when absent.
  type TestEntry = { testNumber: number; name: string; unit?: string; limitLow?: number; limitHigh?: number };
  let entries: TestEntry[];

  if (testDefs?.length) {
    entries = testDefs
      .map(def => ({ testNumber: def.testNumber ?? def.index!, name: def.name, unit: def.unit, limitLow: def.limitLow, limitHigh: def.limitHigh }))
      .filter(e => e.testNumber !== undefined);
  } else {
    const testNumbers = [...new Set(activeDies.flatMap(d =>
      d.testValues ? Object.keys(d.testValues).map(Number) : []
    ))].sort((a, b) => a - b);
    entries = testNumbers.map(tn => ({ testNumber: tn, name: `Test ${tn}` }));
  }

  if (!entries.length) return null;

  const entriesWithData = entries.filter(e =>
    activeDies.some(d => {
      const v = d.testValues?.[e.testNumber];
      return v !== undefined && isFinite(v);
    })
  );
  if (!entriesWithData.length) return null;

  const manyTests = entriesWithData.length > TEST_INLINE_LIMIT;
  const { outer, content } = collapsibleSection(
    'Test Values',
    !manyTests,
    manyTests ? `${entriesWithData.length}` : undefined,
  );

  for (const entry of entriesWithData) {
    const vals = activeDies
      .map(d => d.testValues?.[entry.testNumber])
      .filter((v): v is number => v !== undefined && isFinite(v));
    if (!vals.length) continue;

    const min  = Math.min(...vals);
    const max  = Math.max(...vals);
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    const f = (n: number) => fmtValue(n, entry.unit, fallbackFormat);

    const section = el('div', { marginBottom: '8px' });
    section.appendChild(el('div', { fontSize: '11px', fontWeight: '600', color: VALUE_COLOR, marginBottom: '3px' }, entry.name));
    section.appendChild(kvRow('Min',  f(min)));
    section.appendChild(kvRow('Mean', f(mean)));
    section.appendChild(kvRow('Max',  f(max)));

    if (entry.limitLow !== undefined) {
      section.appendChild(kvRow('LSL', f(entry.limitLow)));
    }
    if (entry.limitHigh !== undefined) {
      section.appendChild(kvRow('USL', f(entry.limitHigh)));
    }
    if (entry.limitLow !== undefined || entry.limitHigh !== undefined) {
      const specFail = vals.filter(v =>
        (entry.limitLow !== undefined && v < entry.limitLow) ||
        (entry.limitHigh !== undefined && v > entry.limitHigh),
      ).length;
      const specPass = vals.length - specFail;
      const specYield = vals.length > 0 ? ((specPass / vals.length) * 100).toFixed(1) + '%' : '—';
      section.appendChild(kvRow(`Spec yield (N=${vals.length})`, specYield));
    }

    content.appendChild(section);
  }
  return outer;
}

export function buildFindingsSection(
  findings: StatsFinding[],
  statsSummary: StatsSummary | LotStatsSummary,
  onFindingClick: (finding: StatsFinding, row: HTMLButtonElement) => void,
  activeFindingId: string | null,
): HTMLDivElement | null {
  if (!findings.length) return null;

  const hasNotable = findings.some(f => f.severity === 'unusual' || f.severity === 'notable');
  const badge = hasNotable
    ? findings.filter(f => f.severity !== 'info').length.toString()
    : undefined;

  const { outer, content } = collapsibleSection('Findings', hasNotable, badge);

  // Report button in the toggle row area — append to outer before content
  const reportBtn = el('button', {
    background:   'none',
    border:       BORDER,
    borderRadius: '4px',
    cursor:       'pointer',
    fontSize:     '10px',
    color:        '#2a3f5f',
    padding:      '2px 7px',
    marginBottom: '6px',
    display:      'block',
  }, 'Open Report');
  reportBtn.type = 'button';
  reportBtn.addEventListener('click', () => openHtmlReport(renderFindingsReportHtml(statsSummary)));
  content.appendChild(reportBtn);

  const narrativeText = buildFindingsNarrative(findings);
  if (narrativeText) {
    content.appendChild(el('p', {
      fontSize:   '10px',
      fontStyle:  'italic',
      color:      '#66788a',
      margin:     '0 0 8px',
      lineHeight: '1.5',
      padding:    '0',
    }, narrativeText));
  }

  const severityOrder: StatsFinding['severity'][] = ['unusual', 'notable', 'info'];
  const severityLabel: Record<StatsFinding['severity'], string> = {
    unusual: 'Unusual', notable: 'Notable', info: 'Informational',
  };
  function sevColor(s: StatsFinding['severity']): string {
    return s === 'unusual' ? '#a84112' : s === 'notable' ? '#8a6500' : '#506784';
  }

  const grouped = new Map<StatsFinding['severity'], StatsFinding[]>(
    severityOrder.map(s => [s, []])
  );
  for (const f of findings) grouped.get(f.severity)!.push(f);

  // Flat ordered list for arrow-key navigation
  const orderedFindings: StatsFinding[] = severityOrder.flatMap(s => grouped.get(s)!);
  const rowMap = new Map<string, HTMLButtonElement>();

  let first = true;
  for (const severity of severityOrder) {
    const group = grouped.get(severity)!;
    if (!group.length) continue;
    if (!first) content.appendChild(el('div', { height: '1px', background: CLR.separator, margin: '4px 0' }));
    first = false;

    content.appendChild(el('div', {
      fontSize:      '10px',
      fontWeight:    '700',
      letterSpacing: '0.05em',
      textTransform: 'uppercase',
      color:         sevColor(severity),
      padding:       '2px 0',
    }, severityLabel[severity]));

    for (const finding of group) {
      const isActive = activeFindingId === finding.id;
      const row = document.createElement('button');
      row.type = 'button';
      row.dataset.wmapFinding = finding.id;
      row.textContent = finding.summary;
      Object.assign(row.style, {
        border:       `1px solid ${CLR.menuBorder}`,
        borderLeft:   `3px solid ${sevColor(finding.severity)}`,
        background:   isActive ? CLR.bgActive : '#fff',
        borderRadius: '6px',
        padding:      '8px 10px',
        textAlign:    'left',
        fontSize:     '11px',
        fontWeight:   isActive ? '600' : '400',
        color:        '#2a3f5f',
        cursor:       'pointer',
        width:        '100%',
        marginBottom: '4px',
      });
      row.addEventListener('click', () => onFindingClick(finding, row));
      rowMap.set(finding.id, row);
      content.appendChild(row);
    }
  }

  return outer;
}

// ── Lot-level section builders ────────────────────────────────────────────────

export function buildLotOverviewSection(lotSummary: LotStatsSummary): HTMLDivElement {
  const wrap = el('div');
  wrap.appendChild(sectionTitle('Lot Summary'));

  const cards = el('div', { display: 'flex', gap: '6px', marginBottom: '8px' });
  cards.appendChild(statCard(String(lotSummary.stats.waferCount), 'Wafers'));

  // Compute lot yield from perWafer data
  const waferYields = lotSummary.perWafer
    .map(pw => pw.summary.stats.yieldPercent)
    .filter((y): y is number => y !== null);

  if (waferYields.length) {
    const mean = waferYields.reduce((a, b) => a + b, 0) / waferYields.length;
    cards.appendChild(statCard(`${(mean * 100).toFixed(1)}%`, 'Mean wafer yield'));
  }
  wrap.appendChild(cards);

  if (lotSummary.lot) {
    for (const [k, v] of Object.entries(lotSummary.lot)) {
      if (v !== null && v !== undefined && v !== '') {
        wrap.appendChild(kvRow(prettyKey(k), String(v)));
      }
    }
  }

  return wrap;
}

export function buildPerWaferYieldSection(
  lotSummary: LotStatsSummary,
  items: Array<{ label?: string }>,
): HTMLDivElement | null {
  const waferData = lotSummary.perWafer
    .map(pw => ({
      label: items[pw.waferIndex]?.label ?? `W${pw.waferIndex + 1}`,
      yieldPct: pw.summary.stats.yieldPercent,
    }))
    .filter(w => w.yieldPct !== null) as Array<{ label: string; yieldPct: number }>;

  if (!waferData.length) return null;

  const wrap = el('div');
  wrap.appendChild(sectionTitle('Wafer Yield'));
  for (const { label, yieldPct } of waferData) {
    wrap.appendChild(progressRow(label, yieldPct * 100));
  }
  return wrap;
}

/** Aggregate bin counts across all wafers in the lot. */
export function buildLotBinSection(
  allDies: Die[],
  binDefs: BinDef[] | undefined,
  mode: 'hard' | 'soft',
): HTMLDivElement | null {
  return buildBinSection(allDies, binDefs, mode);
}

function buildLotRegionYieldSection(
  diesByWafer: Die[][],
  allWafers: Wafer[],
  ringCount: number,
  passBins: number[],
  regionBuilder: RegionBuilder,
  title: string,
): HTMLDivElement | null {
  if (!allWafers.length) return null;
  const hasBins = diesByWafer.some(wd => wd.some(d => d.hbin != null || d.sbin != null));
  if (!hasBins) return null;

  const passSet = new Set(passBins);
  const totals  = new Map<string, { pass: number; total: number }>();
  const order: string[] = [];

  for (let wi = 0; wi < allWafers.length; wi++) {
    const wDies = diesByWafer[wi];
    if (!wDies?.length) continue;
    const regions  = regionBuilder(wDies, allWafers[wi], ringCount);
    const dieByKey = new Map(wDies.map(d => [`${d.x},${d.y}`, d]));
    for (const region of regions) {
      if (!order.includes(region.label)) order.push(region.label);
      const acc = totals.get(region.label) ?? { pass: 0, total: 0 };
      for (const key of region.dieKeys) {
        const d = dieByKey.get(key);
        if (!d || d.partial || d.edgeExcluded) continue;
        const b = d.hbin ?? d.sbin;
        if (b == null) continue;
        acc.total++;
        if (passSet.has(b)) acc.pass++;
      }
      totals.set(region.label, acc);
    }
  }
  if (!totals.size) return null;

  const wrap = el('div');
  wrap.appendChild(sectionTitle(title));
  for (const label of order) {
    const acc = totals.get(label);
    if (!acc || !acc.total) continue;
    wrap.appendChild(progressRow(`${label} (N=${acc.total})`, (acc.pass / acc.total) * 100));
  }
  return wrap;
}

/** Aggregate ring yield across all wafers in the lot. */
export function buildLotRingSection(
  diesByWafer: Die[][],
  allWafers: Wafer[],
  ringCount: number,
  passBins: number[],
): HTMLDivElement | null {
  return buildLotRegionYieldSection(diesByWafer, allWafers, ringCount, passBins, buildRingRegions, 'Ring Yield');
}

/** Aggregate quadrant yield across all wafers in the lot. */
export function buildLotQuadrantSection(
  diesByWafer: Die[][],
  allWafers: Wafer[],
  ringCount: number,
  passBins: number[],
): HTMLDivElement | null {
  return buildLotRegionYieldSection(diesByWafer, allWafers, ringCount, passBins, buildQuadrantRegions, 'Quadrant Yield');
}

/** Aggregate test value stats across all wafers in the lot. */
export function buildLotTestSection(
  allDies: Die[],
  testDefs: TestDef[] | undefined,
  fallbackFormat?: 'si' | 'engineering',
): HTMLDivElement | null {
  return buildTestSection(allDies, testDefs, fallbackFormat);
}



// ── Panel container ───────────────────────────────────────────────────────────

export function createSummaryPanelEl(
  placement: 'right' | 'left' | 'top' | 'bottom',
  toolbarClearance = 0,
): HTMLDivElement {
  const isVertical = placement === 'top' || placement === 'bottom';
  const panel = el('div', {
    background:  PANEL_BG,
    border:      BORDER,
    borderRadius:'8px',
    padding:     `${12 + toolbarClearance}px 12px 12px`,
    overflowY:   isVertical ? 'hidden' : 'auto',
    overflowX:   isVertical ? 'auto'   : 'hidden',
    flexShrink:  '0',
    boxSizing:   'border-box',
    fontFamily:  'system-ui, sans-serif',
    fontSize:    '12px',
    boxShadow:   '0 1px 4px rgba(0,0,0,0.08)',
  });

  if (!isVertical) {
    panel.style.width    = '220px';
    panel.style.maxHeight = 'calc(100vh - 80px)';
  } else {
    panel.style.height = '180px';
    panel.style.width  = '100%';
  }

  return panel;
}

/** Wrap the canvas + panel in a flex container according to placement. */
export function wrapWithSummaryPanel(
  canvas: HTMLCanvasElement,
  panel: HTMLDivElement,
  placement: 'right' | 'left' | 'top' | 'bottom',
): HTMLDivElement {
  const isVertical = placement === 'top' || placement === 'bottom';
  const wrapper = el('div', {
    display:       'flex',
    flexDirection: isVertical ? 'column' : 'row',
    gap:           '8px',
    width:         '100%',
    height:        '100%',
    boxSizing:     'border-box',
    alignItems:    'flex-start',
  });

  // Canvas takes all remaining space
  canvas.style.flex     = '1 1 0';
  canvas.style.minWidth = '0';
  canvas.style.minHeight = '0';

  if (placement === 'right' || placement === 'bottom') {
    wrapper.appendChild(canvas);
    wrapper.appendChild(panel);
  } else {
    wrapper.appendChild(panel);
    wrapper.appendChild(canvas);
  }

  return wrapper;
}

/** Render all wafer-level sections into a panel element. Clears existing content. */
export function renderWaferSummaryContent(
  panel: HTMLDivElement,
  params: {
    wafer:        Wafer;
    dies:         Die[];
    yieldSummary: YieldSummary;
    dataCoverage: { filledDies: number; totalDies: number; edgeExcludedDies: number; ratio: number };
    hbinDefs?:    BinDef[];
    sbinDefs?:    BinDef[];
    testDefs?:    TestDef[];
    statsSummary?: StatsSummary;
    passBins?:    number[];
    ringCount?:   number;
    fallbackFormat?: 'si' | 'engineering';
    onFindingClick?: (finding: StatsFinding, row: HTMLButtonElement) => void;
    activeFindingId?: string | null;
  },
): void {
  panel.innerHTML = '';
  const {
    wafer, dies, yieldSummary, dataCoverage,
    hbinDefs, sbinDefs, testDefs,
    statsSummary, passBins = [1], ringCount = 4,
    fallbackFormat,
    onFindingClick, activeFindingId = null,
  } = params;

  const sections: (HTMLDivElement | null)[] = [];

  const meta = wafer.metadata as Record<string, unknown> | undefined;
  const lotStackStats = statsSummary?.stats.isLotStack ? statsSummary.stats : undefined;
  const METHOD_LABELS: Record<string, string> = {
    mean: 'mean', median: 'median', stddev: 'std dev', min: 'min', max: 'max',
    count: 'count', countBin: 'occurrence count', percent: 'occurrence %',
  };
  const metaWithStack: Record<string, unknown> | undefined = lotStackStats
    ? {
        ...(meta ?? {}),
        'Lot stack': lotStackStats.lotSize !== undefined
          ? `${lotStackStats.lotSize} wafers · ${METHOD_LABELS[lotStackStats.aggregationMethod ?? ''] ?? lotStackStats.aggregationMethod ?? 'aggregated'}`
          : METHOD_LABELS[lotStackStats.aggregationMethod ?? ''] ?? lotStackStats.aggregationMethod ?? 'aggregated',
      }
    : meta;
  if (metaWithStack) sections.push(buildMetadataSection(metaWithStack));

  sections.push(buildYieldSection(yieldSummary, dataCoverage, passBins));

  // Use hard bin mode as the primary bin display; fall back to soft if only soft present
  const hasHbin = dies.some(d => d.hbin != null);
  const hasSbin = dies.some(d => d.sbin != null);
  if (hasHbin) sections.push(buildBinSection(dies, hbinDefs, 'hard'));
  else if (hasSbin) sections.push(buildBinSection(dies, sbinDefs, 'soft'));

  sections.push(buildRingSection(dies, wafer, ringCount, passBins));
  sections.push(buildQuadrantSection(dies, wafer, ringCount, passBins));

  sections.push(buildTestSection(dies, testDefs, fallbackFormat));

  if (statsSummary?.findings.length && onFindingClick) {
    sections.push(buildFindingsSection(
      statsSummary.findings,
      statsSummary,
      onFindingClick,
      activeFindingId,
    ));
  }

  // Panel-level "Summary report" button — always shown at the top
  const summaryReportBtn = el('button', {
    background:    'none',
    border:        BORDER,
    borderRadius:  '4px',
    cursor:        'pointer',
    fontSize:      '10px',
    color:         '#2a3f5f',
    padding:       '2px 7px',
    marginBottom:  '10px',
    display:       'block',
  }, 'Summary report');
  summaryReportBtn.type = 'button';
  summaryReportBtn.addEventListener('click', () => {
    openHtmlReport(renderSummaryReportHtml({
      wafer, dies, yieldSummary, dataCoverage,
      hbinDefs, sbinDefs, testDefs,
      statsSummary,
      passBins,
      ringCount,
    }));
  });
  panel.appendChild(summaryReportBtn);

  let first = true;
  for (const s of sections) {
    if (!s) continue;
    if (!first) panel.appendChild(separator());
    first = false;
    panel.appendChild(s);
  }

}

/** Render lot-level content into the panel. Clears existing content. */
export function renderLotSummaryContent(
  panel: HTMLDivElement,
  params: {
    lotSummary:       LotStatsSummary;
    items:            Array<{ label?: string; wafer?: Wafer; dies?: Die[] }>;
    hbinDefs?:        BinDef[];
    sbinDefs?:        BinDef[];
    testDefs?:        TestDef[];
    passBins?:        number[];
    ringCount?:       number;
    fallbackFormat?:  'si' | 'engineering';
    onFindingClick?:  (finding: StatsFinding, row: HTMLButtonElement) => void;
    activeFindingId?: string | null;
  },
): void {
  panel.innerHTML = '';
  const {
    lotSummary, items,
    hbinDefs, sbinDefs, testDefs,
    passBins = [1], ringCount = 4,
    fallbackFormat,
    onFindingClick, activeFindingId = null,
  } = params;

  const allWafers: Wafer[] = [];
  const diesByWafer: Die[][] = [];
  const allDies: Die[] = [];
  for (const item of items) {
    if (item.wafer) allWafers.push(item.wafer);
    const wd = item.dies ?? [];
    diesByWafer.push(wd);
    allDies.push(...wd);
  }

  const hasHbin = allDies.some(d => d.hbin != null);
  const hasSbin = allDies.some(d => d.sbin != null);

  const sections: (HTMLDivElement | null)[] = [
    buildLotOverviewSection(lotSummary),
    buildPerWaferYieldSection(lotSummary, items),
    hasHbin ? buildLotBinSection(allDies, hbinDefs, 'hard')
            : hasSbin ? buildLotBinSection(allDies, sbinDefs, 'soft') : null,
    buildLotRingSection(diesByWafer, allWafers, ringCount, passBins),
    buildLotQuadrantSection(diesByWafer, allWafers, ringCount, passBins),
    testDefs?.length ? buildLotTestSection(allDies, testDefs, fallbackFormat) : null,
  ];

  if (lotSummary.findings.length && onFindingClick) {
    sections.push(buildFindingsSection(
      lotSummary.findings,
      lotSummary,
      onFindingClick,
      activeFindingId,
    ));
  }

  // Panel-level "Summary report" button
  const summaryReportBtn = el('button', {
    background:   'none',
    border:       BORDER,
    borderRadius: '4px',
    cursor:       'pointer',
    fontSize:     '10px',
    color:        '#2a3f5f',
    padding:      '2px 7px',
    marginBottom: '10px',
    display:      'block',
  }, 'Summary report');
  summaryReportBtn.type = 'button';
  summaryReportBtn.addEventListener('click', () => {
    openHtmlReport(renderLotSummaryReportHtml({
      lotSummary,
      items: items.map((item, i) => ({
        label:  item.label ?? `W${i + 1}`,
        wafer:  item.wafer,
        dies:   item.dies,
      })),
      hbinDefs, sbinDefs, testDefs,
      passBins,
      ringCount,
    }));
  });
  panel.appendChild(summaryReportBtn);

  let first = true;
  for (const s of sections) {
    if (!s) continue;
    if (!first) panel.appendChild(separator());
    first = false;
    panel.appendChild(s);
  }
}

/** Build the wafer-detail panel header with a back button for gallery drill-down. */
export function buildWaferDetailHeader(
  label: string,
  yieldPct: number | null,
  onBack: () => void,
): HTMLDivElement {
  const header = el('div', {
    display:       'flex',
    alignItems:    'center',
    gap:           '6px',
    marginBottom:  '10px',
    paddingBottom: '8px',
    borderBottom:  `1px solid ${CLR.separator}`,
    flexShrink:    '0',
  });

  const backBtn = document.createElement('button');
  backBtn.type = 'button';
  backBtn.title = 'Back to lot summary';
  backBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>`;
  Object.assign(backBtn.style, {
    display:        'flex',
    alignItems:     'center',
    justifyContent: 'center',
    border:         BORDER,
    borderRadius:   '4px',
    background:     '#fff',
    color:          CLR.icon,
    cursor:         'pointer',
    padding:        '3px',
    flexShrink:     '0',
  });
  backBtn.addEventListener('click', onBack);

  const titleParts: string[] = [label];
  if (yieldPct !== null) titleParts.push(`${(yieldPct * 100).toFixed(1)}%`);

  const title = el('span', {
    fontSize:   '11px',
    fontWeight: '700',
    color:      VALUE_COLOR,
    flex:       '1',
    overflow:   'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  }, titleParts.join(' · '));

  header.appendChild(backBtn);
  header.appendChild(title);
  return header;
}
