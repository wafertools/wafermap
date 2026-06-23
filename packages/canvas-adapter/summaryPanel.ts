// ── Summary panel — shared DOM section builders ───────────────────────────────
// Pure DOM construction — no canvas, no toolbar state.
// Imported by renderWaferMap and renderWaferGallery.

import type { Wafer } from '../core/wafer.js';
import type { Die } from '../core/dies.js';
import type { BinDef, TestDef, YieldSummary } from '../renderer/buildWaferMap.js';
import type { StatsFinding, StatsSummary, LotStatsSummary } from '../stats/types.js';
import { buildRingRegions, buildQuadrantRegions } from '../stats/regions.js';
import { renderFindingsReportHtml, openHtmlReport } from '../stats/renderFindingsReport.js';
import { buildFindingsNarrative } from '../stats/findingsNarrative.js';
import { renderSummaryReportHtml, renderLotSummaryReportHtml } from '../stats/renderSummaryReport.js';
import { getColorScheme } from '../renderer/colorSchemes.js';
import { fmt as fmtValue, fmtAggregationMethod } from '../renderer/fmt.js';
import { getUniqueTestNumbers } from '../renderer/buildView.js';
import { CLR, openModal } from './toolbar.js';

// ── Panel option type ─────────────────────────────────────────────────────────

export interface SummaryPanelOptions {
  /** Which side of the content area to place the panel. Default 'right'. */
  placement?: 'right' | 'left' | 'top' | 'bottom';
  /** Open the panel immediately on render without requiring the user to click the toolbar button. Default false. */
  defaultOpen?: boolean;
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

function buildWarningsBanner(warnings: string[]): HTMLDivElement {
  const wrap = el('div', {
    background:   '#fffbe6',
    border:       '1px solid #f0c040',
    borderRadius: '4px',
    padding:      '7px 9px',
    marginBottom: '10px',
    fontSize:     '10px',
    color:        '#7a5800',
    lineHeight:   '1.5',
  });
  for (const w of warnings) {
    wrap.appendChild(el('div', {}, `⚠ ${w}`));
  }
  return wrap;
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

/** Render a progress bar row: label left, bar + percent right.
 *  `fillPct` overrides bar width independently of the displayed value — use for
 *  range-normalised bars where the fill encodes relative spread, not absolute yield.
 *  `medianLinePct` draws a vertical rule at that fill % position (lot median marker).
 *  `belowMedian` renders the fill in a muted colour. */
function progressRow(
  label: string,
  value: number,
  color = '#2a6fc0',
  fillPct?: number,
  medianLinePct?: number,
  belowMedian?: boolean,
): HTMLDivElement {
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

  const barWidth  = fillPct !== undefined ? fillPct : Math.min(100, Math.max(0, value));
  const fillColor = belowMedian ? '#94a3b8' : color;
  const track = el('div', {
    position:     'relative',
    height:       '9px',
    background:   '#e2e5ea',
    borderRadius: '4px',
    overflow:     'hidden',
  });
  const fill = el('div', {
    height:       '100%',
    width:        `${barWidth}%`,
    background:   fillColor,
    borderRadius: '4px',
    transition:   'width 0.3s ease',
  });
  track.appendChild(fill);
  if (medianLinePct !== undefined) {
    const line = el('div', {
      position:   'absolute',
      top:        '0',
      bottom:     '0',
      left:       `${medianLinePct}%`,
      width:      '1px',
      background: '#334155',
      opacity:    '0.5',
    });
    track.appendChild(line);
  }
  row.appendChild(top);
  row.appendChild(track);
  return row;
}

/** Normalise a value within [min, max] to a fill % in [MIN_FILL, 100].
 *  When all values are equal the fill is fixed at MIN_FILL. */
const REGION_MIN_FILL = 15;
function regionFillPct(value: number, min: number, max: number): number {
  if (max === min) return REGION_MIN_FILL;
  return REGION_MIN_FILL + ((value - min) / (max - min)) * (100 - REGION_MIN_FILL);
}

function medianOf(sorted: number[]): number {
  const n = sorted.length;
  if (n === 0) return 0;
  const mid = Math.floor(n / 2);
  return n % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
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
    cards.appendChild(statCard(`${yieldSummary.yieldPercent.toFixed(1)}%`, `Yield (pass: ${binLabel})`));
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
  colorScheme?: string,
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
    const scheme = getColorScheme(colorScheme);
    const color  = (colorScheme === 'custom' ? def?.color : undefined) ?? scheme.forBin(bin);
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

  const rows: { label: string; yPct: number }[] = [];
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
    rows.push({ label: `${region.label} (N=${total})`, yPct: (pass / total) * 100 });
  }
  if (!rows.length) return null;

  const minY = Math.min(...rows.map(r => r.yPct));
  const maxY = Math.max(...rows.map(r => r.yPct));
  const rangeNote = minY === maxY ? '' : ` (${minY.toFixed(1)}–${maxY.toFixed(1)}%)`;

  const wrap = el('div');
  wrap.appendChild(sectionTitle(title + rangeNote));
  for (const { label, yPct } of rows) {
    wrap.appendChild(progressRow(label, yPct, undefined, regionFillPct(yPct, minY, maxY)));
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
    const testNumbers = getUniqueTestNumbers(activeDies);
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

  const severityRank: Record<StatsFinding['severity'], number> = { unusual: 0, notable: 1, info: 2 };
  function sevColor(s: StatsFinding['severity']): string {
    return s === 'unusual' ? '#a84112' : s === 'notable' ? '#8a6500' : '#506784';
  }
  function worstSeverity(fs: StatsFinding[]): StatsFinding['severity'] {
    return fs.reduce<StatsFinding['severity']>(
      (best, f) => severityRank[f.severity] < severityRank[best] ? f.severity : best,
      'info',
    );
  }
  function buildGroups(fs: StatsFinding[]) {
    const groupMap = new Map<string, StatsFinding[]>();
    for (const f of fs) {
      const key = `${f.comparison.family}\0${f.comparison.left}`;
      const bucket = groupMap.get(key) ?? [];
      bucket.push(f);
      groupMap.set(key, bucket);
    }
    const result = [...groupMap.entries()].map(([key, members]) => {
      const sorted = [...members].sort((a, b) => severityRank[a.severity] - severityRank[b.severity]);
      return { key, findings: sorted, worst: worstSeverity(sorted) };
    });
    result.sort((a, b) => severityRank[a.worst] - severityRank[b.worst]);
    return result;
  }
  function groupLabel(family: string, left: string): string {
    const familyMap: Record<string, string> = {
      ring: 'Ring', quadrant: 'Quadrant', sector: 'Sector',
      'reticle-position': 'Reticle', 'test-site': 'Test site',
      cluster: 'Cluster', 'edge-arc': 'Edge arc', wafer: 'Wafer',
    };
    return `${familyMap[family] ?? family}: ${left}`;
  }

  // Separate spatial-pattern (parent) findings from the rest
  const patternFindings = findings.filter(f => f.comparison.family === 'spatial-pattern');
  const relatedIdSet    = new Set(patternFindings.flatMap(f => f.relatedIds ?? []));
  const standaloneFindings = findings.filter(
    f => f.comparison.family !== 'spatial-pattern' && !relatedIdSet.has(f.id),
  );
  const groups = buildGroups(standaloneFindings);

  // Helper: build a clickable finding row button
  function makeFindingRow(finding: StatsFinding, isChild = false): HTMLButtonElement {
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
      padding:      isChild ? '6px 10px' : '8px 10px',
      textAlign:    'left',
      fontSize:     isChild ? '10px' : '11px',
      fontWeight:   isActive ? '600' : '400',
      color:        '#2a3f5f',
      cursor:       'pointer',
      width:        '100%',
      marginBottom: '4px',
    });
    row.addEventListener('click', () => onFindingClick(finding, row));
    return row;
  }

  // Narrative block — elevated styling with a "Detail ▸" expand button
  const narrativeText = buildFindingsNarrative(findings);
  if (narrativeText) {
    const narrativeBlock = el('div', {
      background:    CLR.bgActive,
      borderRadius:  '6px',
      padding:       '8px 10px',
      marginBottom:  '8px',
      display:       'flex',
      gap:           '8px',
      alignItems:    'flex-start',
    });

    const narrativeText2 = el('span', {
      flex:       '1',
      fontSize:   '12px',
      lineHeight: '1.5',
      color:      '#2a3f5f',
    }, narrativeText);
    narrativeBlock.appendChild(narrativeText2);

    const detailBtn = el('button', {
      flexShrink: '0',
      border:     'none',
      background: 'none',
      fontSize:   '10px',
      color:      '#506784',
      cursor:     'pointer',
      padding:    '0',
      lineHeight: '1.5',
      whiteSpace: 'nowrap',
    }, 'Detail ▸');
    (detailBtn as HTMLButtonElement).type = 'button';
    detailBtn.addEventListener('click', () => {
      const handle = openModal({ title: 'Findings Summary', onClose: () => {} });

      // Narrative paragraph
      const narPara = el('p', {
        fontSize:     '16px',
        lineHeight:   '1.6',
        color:        '#2a3f5f',
        padding:      '20px 24px 16px',
        margin:       '0',
        borderBottom: '1px solid #e2e5ea',
        flexShrink:   '0',
      }, narrativeText);
      handle.contentWrap.appendChild(narPara);

      // Scrollable findings list — pattern parents first, then standalone groups
      const listWrap = el('div', {
        overflowY: 'auto',
        padding:   '16px 24px',
        flex:      '1',
      });

      for (const pf of patternFindings) {
        listWrap.appendChild(el('div', {
          fontSize:      '11px',
          fontWeight:    '700',
          letterSpacing: '0.04em',
          textTransform: 'uppercase',
          color:         sevColor(pf.severity),
          padding:       '6px 0 4px 8px',
          borderLeft:    `3px solid ${sevColor(pf.severity)}`,
          marginTop:     '10px',
          marginBottom:  '4px',
        }, pf.comparison.left));
        listWrap.appendChild(el('div', {
          fontSize:    '13px',
          color:       '#2a3f5f',
          padding:     '3px 0 3px 12px',
          borderLeft:  `2px solid ${sevColor(pf.severity)}`,
          marginBottom: '2px',
        }, pf.summary));
        const children = findings.filter(f => pf.relatedIds?.includes(f.id));
        for (const cf of children) {
          listWrap.appendChild(el('div', {
            fontSize:    '12px',
            color:       '#506784',
            padding:     '2px 0 2px 20px',
            borderLeft:  `2px solid ${sevColor(cf.severity)}`,
            marginBottom: '2px',
          }, cf.summary));
        }
      }

      for (const group of groups) {
        const [fam, left] = group.key.split('\0');
        listWrap.appendChild(el('div', {
          fontSize:      '11px',
          fontWeight:    '700',
          letterSpacing: '0.04em',
          textTransform: 'uppercase',
          color:         sevColor(group.worst),
          padding:       '6px 0 4px 8px',
          borderLeft:    `3px solid ${sevColor(group.worst)}`,
          marginTop:     '10px',
          marginBottom:  '4px',
        }, groupLabel(fam, left)));
        for (const f of group.findings) {
          listWrap.appendChild(el('div', {
            fontSize:    '13px',
            color:       '#2a3f5f',
            padding:     '3px 0 3px 12px',
            borderLeft:  `2px solid ${sevColor(f.severity)}`,
            marginBottom: '2px',
          }, f.summary));
        }
      }
      handle.contentWrap.appendChild(listWrap);
      Object.assign(handle.contentWrap.style, { flexDirection: 'column', overflow: 'hidden' });
    });

    narrativeBlock.appendChild(detailBtn);
    content.appendChild(narrativeBlock);
  }

  let firstItem = true;

  // Render spatial-pattern findings as collapsible parents
  for (const pf of patternFindings) {
    if (!firstItem) content.appendChild(el('div', { height: '1px', background: CLR.separator, margin: '4px 0' }));
    firstItem = false;

    const children = findings.filter(f => pf.relatedIds?.includes(f.id));
    const hasChildren = children.length > 0;

    // Parent row wrapper (flex row: clickable text area + chevron toggle)
    const parentWrap = el('div', { position: 'relative', marginBottom: hasChildren ? '2px' : '4px' });

    const isActive = activeFindingId === pf.id;
    const parentRow = document.createElement('button');
    parentRow.type = 'button';
    parentRow.dataset.wmapFinding = pf.id;
    Object.assign(parentRow.style, {
      border:       `1px solid ${CLR.menuBorder}`,
      borderLeft:   `3px solid ${sevColor(pf.severity)}`,
      background:   isActive ? CLR.bgActive : '#fff',
      borderRadius: '6px',
      padding:      '8px 32px 8px 10px', // right padding for chevron
      textAlign:    'left',
      fontSize:     '11px',
      fontWeight:   isActive ? '600' : '500',
      color:        '#2a3f5f',
      cursor:       'pointer',
      width:        '100%',
    });
    parentRow.textContent = pf.summary;
    parentRow.addEventListener('click', () => onFindingClick(pf, parentRow));
    parentWrap.appendChild(parentRow);

    if (hasChildren) {
      // Child container — initially collapsed
      const childWrap = el('div', {
        display:     'none',
        paddingLeft: '12px',
        marginBottom: '4px',
      });
      for (const cf of children) {
        childWrap.appendChild(makeFindingRow(cf, true));
      }
      parentWrap.appendChild(childWrap);

      // Chevron toggle button (absolutely positioned in top-right of parentRow)
      let expanded = false;
      const chevron = el('button', {
        position:   'absolute',
        top:        '50%',
        right:      '8px',
        transform:  'translateY(-50%)',
        border:     'none',
        background: 'none',
        fontSize:   '10px',
        color:      '#506784',
        cursor:     'pointer',
        padding:    '2px 4px',
        lineHeight: '1',
      }, '▸') as HTMLButtonElement;
      chevron.type = 'button';
      chevron.title = 'Show supporting findings';
      chevron.addEventListener('click', (e) => {
        e.stopPropagation();
        expanded = !expanded;
        childWrap.style.display = expanded ? 'block' : 'none';
        chevron.textContent = expanded ? '▾' : '▸';
        chevron.title = expanded ? 'Hide supporting findings' : 'Show supporting findings';
      });
      parentWrap.appendChild(chevron);
    }

    content.appendChild(parentWrap);
  }

  // Render remaining standalone findings in existing flat-group style
  for (const group of groups) {
    if (!firstItem) content.appendChild(el('div', { height: '1px', background: CLR.separator, margin: '4px 0' }));
    firstItem = false;

    const [family, left] = group.key.split('\0');
    content.appendChild(el('div', {
      fontSize:      '10px',
      fontWeight:    '700',
      letterSpacing: '0.04em',
      textTransform: 'uppercase',
      color:         sevColor(group.worst),
      padding:       '2px 0 2px 6px',
      borderLeft:    `3px solid ${sevColor(group.worst)}`,
      marginBottom:  '3px',
    }, groupLabel(family, left)));

    for (const finding of group.findings) {
      content.appendChild(makeFindingRow(finding));
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
    cards.appendChild(statCard(`${mean.toFixed(1)}%`, 'Mean wafer yield'));
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
  items: Array<{ label?: string } | null>,
  onWaferClick?: (waferIndex: number) => void,
): HTMLDivElement | null {
  const waferData = lotSummary.perWafer
    .map(pw => ({
      waferIndex: pw.waferIndex,
      label: (items[pw.waferIndex]?.label ?? `W${pw.waferIndex + 1}`)
        .replace(/\s*·\s*\d+(\.\d+)?%$/, ''),
      yieldPct: pw.summary.stats.yieldPercent,
    }))
    .filter(w => w.yieldPct !== null) as Array<{ waferIndex: number; label: string; yieldPct: number }>;

  if (!waferData.length) return null;

  const minY = Math.min(...waferData.map(w => w.yieldPct));
  const maxY = Math.max(...waferData.map(w => w.yieldPct));
  const rangeNote = minY === maxY ? '' : ` (${minY.toFixed(1)}–${maxY.toFixed(1)}%)`;

  const sorted  = [...waferData.map(w => w.yieldPct)].sort((a, b) => a - b);
  const med     = medianOf(sorted);
  const medFill = regionFillPct(med, minY, maxY);

  const wrap = el('div');
  wrap.appendChild(sectionTitle('Wafer Yield' + rangeNote));
  for (const { waferIndex, label, yieldPct } of waferData) {
    const yPct = yieldPct;
    const row = progressRow(label, yPct, undefined, regionFillPct(yPct, minY, maxY), medFill, yPct < med);
    if (onWaferClick) {
      row.style.cursor = 'pointer';
      row.style.borderRadius = '4px';
      row.style.padding = '2px 3px';
      row.style.marginLeft = '-3px';
      row.style.marginRight = '-3px';
      row.addEventListener('mouseenter', () => { row.style.background = CLR.bgHover; });
      row.addEventListener('mouseleave', () => { row.style.background = ''; });
      row.addEventListener('click', () => onWaferClick(waferIndex));
    }
    wrap.appendChild(row);
  }
  return wrap;
}

/** Aggregate bin counts across all wafers in the lot. */
export function buildLotBinSection(
  allDies: Die[],
  binDefs: BinDef[] | undefined,
  mode: 'hard' | 'soft',
  colorScheme?: string,
): HTMLDivElement | null {
  return buildBinSection(allDies, binDefs, mode, colorScheme);
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

  const validRows = order
    .map(label => ({ label, acc: totals.get(label) }))
    .filter((r): r is { label: string; acc: { pass: number; total: number } } => !!r.acc?.total);
  if (!validRows.length) return null;

  const yPcts = validRows.map(({ acc }) => (acc.pass / acc.total) * 100);
  const minY  = Math.min(...yPcts);
  const maxY  = Math.max(...yPcts);
  const rangeNote = minY === maxY ? '' : ` (${minY.toFixed(1)}–${maxY.toFixed(1)}%)`;

  const wrap = el('div');
  wrap.appendChild(sectionTitle(title + rangeNote));
  for (let i = 0; i < validRows.length; i++) {
    const { label, acc } = validRows[i];
    const yPct = yPcts[i];
    wrap.appendChild(progressRow(`${label} (N=${acc.total})`, yPct, undefined, regionFillPct(yPct, minY, maxY)));
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
): HTMLDivElement {
  const isVertical = placement === 'top' || placement === 'bottom';
  const panel = el('div', {
    background:  PANEL_BG,
    border:      BORDER,
    borderRadius:'8px',
    padding:     '12px',
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
    // Bound the panel by its container (the flex row), not the viewport. A
    // viewport-relative cap (e.g. 100vh) overflows a container shorter than the
    // viewport, stretching the row and clipping the wafer. With the wrapper
    // pinned to the container height, `100%` keeps the panel inside it and lets
    // overflowY:auto scroll the panel internally.
    panel.style.maxHeight = '100%';
  } else {
    panel.style.height = '180px';
    panel.style.width  = '100%';
  }

  return panel;
}

/** Wrap the canvas + panel in a flex container according to placement. */
export function wrapWithSummaryPanel(
  content: HTMLElement,
  panel: HTMLDivElement,
  placement: 'right' | 'left' | 'top' | 'bottom',
): HTMLDivElement {
  const isVertical = placement === 'top' || placement === 'bottom';
  const wrapper = el('div', {
    display:       'flex',
    flexDirection: isVertical ? 'column' : 'row',
    gap:           '8px',
    width:         '100%',
    // Fill the container's height so the whole subtree is bounded by it. The
    // container (a plain block in the common embedding) gives no height to a
    // `flex:1` child, so the row would otherwise size to its tallest child (the
    // panel) and overflow — dragging the canvas past the container and clipping
    // the wafer. `height:100%` + a min-height floor pins it to the container.
    height:        '100%',
    flex:          '1 1 0',
    minHeight:     '0',
    boxSizing:     'border-box',
    // Stretch children to the row height (horizontal layout) so the canvas and
    // panel both track the container, not their own content.
    alignItems:    isVertical ? 'flex-start' : 'stretch',
  });

  // Content takes all remaining space
  content.style.flex     = '1 1 0';
  content.style.minWidth = '0';
  content.style.minHeight = '0';

  if (placement === 'right' || placement === 'bottom') {
    wrapper.appendChild(content);
    wrapper.appendChild(panel);
  } else {
    wrapper.appendChild(panel);
    wrapper.appendChild(content);
  }

  return wrapper;
}

/** Render all wafer-level sections into a panel element. Clears existing content. */
export function renderWaferSummaryContent(
  panel: HTMLDivElement,
  params: {
    wafer:        Wafer;
    dies:         Die[];
    yieldSummary?: YieldSummary;
    dataCoverage?: { filledDies: number; totalDies: number; edgeExcludedDies: number; ratio: number };
    hbinDefs?:    BinDef[];
    sbinDefs?:    BinDef[];
    testDefs?:    TestDef[];
    statsSummary?: StatsSummary;
    passBins?:    number[];
    ringCount?:   number;
    colorScheme?: string;
    fallbackFormat?: 'si' | 'engineering';
    onFindingClick?: (finding: StatsFinding, row: HTMLButtonElement) => void;
    activeFindingId?: string | null;
  },
): void {
  const savedScroll = panel.scrollTop;
  panel.innerHTML = '';
  const {
    wafer, dies, yieldSummary, dataCoverage,
    hbinDefs, sbinDefs, testDefs,
    statsSummary, passBins = [1], ringCount = 4,
    colorScheme, fallbackFormat,
    onFindingClick, activeFindingId = null,
  } = params;

  const warnings = statsSummary?.stats.warnings;
  if (warnings?.length) panel.appendChild(buildWarningsBanner(warnings));

  const sections: (HTMLDivElement | null)[] = [];

  const meta = wafer.metadata as Record<string, unknown> | undefined;
  const lotStackStats = statsSummary?.stats.isLotStack ? statsSummary.stats : undefined;
  const metaWithStack: Record<string, unknown> | undefined = lotStackStats
    ? {
        ...(meta ?? {}),
        'Lot stack': lotStackStats.lotSize !== undefined
          ? `${lotStackStats.lotSize} wafers · ${fmtAggregationMethod(lotStackStats.aggregationMethod)}`
          : fmtAggregationMethod(lotStackStats.aggregationMethod),
      }
    : meta;
  if (metaWithStack) sections.push(buildMetadataSection(metaWithStack));

  if (yieldSummary && dataCoverage) sections.push(buildYieldSection(yieldSummary, dataCoverage, passBins));

  // Use hard bin mode as the primary bin display; fall back to soft if only soft present
  const hasHbin = dies.some(d => d.hbin != null);
  const hasSbin = dies.some(d => d.sbin != null);
  if (hasHbin) sections.push(buildBinSection(dies, hbinDefs, 'hard', colorScheme));
  else if (hasSbin) sections.push(buildBinSection(dies, sbinDefs, 'soft', colorScheme));

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
  if (yieldSummary && dataCoverage) {
    summaryReportBtn.addEventListener('click', () => {
      openHtmlReport(renderSummaryReportHtml({
        wafer, dies, yieldSummary: yieldSummary!, dataCoverage: dataCoverage!,
        hbinDefs, sbinDefs, testDefs,
        statsSummary,
        passBins,
        ringCount,
      }));
    });
    panel.appendChild(summaryReportBtn);
  }

  let first = true;
  for (const s of sections) {
    if (!s) continue;
    if (!first) panel.appendChild(separator());
    first = false;
    panel.appendChild(s);
  }

  // Browsers ignore padding-bottom on scrollable containers. A bottom spacer
  // ensures the last finding card is not clipped when scrolled to the end.
  panel.appendChild(el('div', { height: '12px', flexShrink: '0' }));

  panel.scrollTop = savedScroll;
}

/** Render lot-level content into the panel. Clears existing content. */
export function renderLotSummaryContent(
  panel: HTMLDivElement,
  params: {
    lotSummary:       LotStatsSummary;
    items:            Array<{ label?: string; wafer?: Wafer; dies?: Die[] } | null>;
    hbinDefs?:        BinDef[];
    sbinDefs?:        BinDef[];
    testDefs?:        TestDef[];
    passBins?:        number[];
    ringCount?:       number;
    colorScheme?:     string;
    fallbackFormat?:  'si' | 'engineering';
    onFindingClick?:  (finding: StatsFinding, row: HTMLButtonElement) => void;
    activeFindingId?: string | null;
    onWaferClick?:    (waferIndex: number) => void;
  },
): void {
  const savedScroll = panel.scrollTop;
  panel.innerHTML = '';
  const {
    lotSummary, items,
    hbinDefs, sbinDefs, testDefs,
    passBins = [1], ringCount = 4,
    colorScheme, fallbackFormat,
    onFindingClick, activeFindingId = null,
    onWaferClick,
  } = params;

  const allWarnings = [...new Set(
    lotSummary.perWafer.flatMap(pw => pw.summary.stats.warnings ?? []),
  )];
  if (allWarnings.length) panel.appendChild(buildWarningsBanner(allWarnings));

  const allWafers: Wafer[] = [];
  const diesByWafer: Die[][] = [];
  const allDies: Die[] = [];
  for (const item of items) {
    if (!item) { diesByWafer.push([]); continue; }
    if (item.wafer) allWafers.push(item.wafer);
    const wd = item.dies ?? [];
    diesByWafer.push(wd);
    allDies.push(...wd);
  }

  const hasHbin = allDies.some(d => d.hbin != null);
  const hasSbin = allDies.some(d => d.sbin != null);

  const sections: (HTMLDivElement | null)[] = [
    buildLotOverviewSection(lotSummary),
    buildPerWaferYieldSection(lotSummary, items, onWaferClick),
    hasHbin ? buildLotBinSection(allDies, hbinDefs, 'hard', colorScheme)
            : hasSbin ? buildLotBinSection(allDies, sbinDefs, 'soft', colorScheme) : null,
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
        label:  item?.label ?? `W${i + 1}`,
        wafer:  item?.wafer,
        dies:   item?.dies,
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

  panel.appendChild(el('div', { height: '12px', flexShrink: '0' }));

  panel.scrollTop = savedScroll;
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
  if (yieldPct !== null) titleParts.push(`${yieldPct.toFixed(1)}%`);

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
