import type { PlotMode } from '../renderer/buildView.js';
import { getUniqueTestNumbers } from '../renderer/buildView.js';
import { listColorSchemes, getColorScheme } from '../renderer/colorSchemes.js';
import { CLR, ROTATIONS, MODE_LABELS, BIN_LEGEND_MODES, STACKED_MODES, createTooltip, createToolbarHelpers, buildModeMenuEl, openModal, saveImageBlob, markMenuTrigger, wireMenuA11y, type ModeEntry, type SaveImageHandler } from './toolbar.js';
import { USER_GUIDE_HTML } from './userGuideHtml.js';
import type { Die } from '../core/dies.js';
import { aggregateValues, aggregateBinCounts } from '../core/aggregates.js';
import type { AggregationMethod } from '../core/aggregates.js';
import { renderWaferMap } from './renderWaferMap.js';
import type { WaferViewOptions, WaferMapController } from './renderWaferMap.js';
import { classifyChanged } from './renderWaferMap.js';
import type { BinDef } from '../renderer/buildWaferMap.js';
import type { LotStatsSummary, StatsFinding, StatsSummary } from '../stats/types.js';
import { analyzeWaferMap } from '../stats/analyzeWaferMap.js';
import type { SummaryPanelOptions } from './summaryPanel.js';
import {
  createSummaryPanelEl, renderLotSummaryContent,
} from './summaryPanel.js';
import { openHtmlReport, renderFindingsReportHtml } from '../stats/renderFindingsReport.js';

// ── Public types ───────────────────────────────────────────────────────────────

/**
 * The data and display overrides for a single gallery card.
 *
 * `WaferMapResult` satisfies this interface structurally, so you can pass
 * `buildWaferMap(...)` results directly. Spread in display overrides as needed:
 *
 * ```ts
 * renderWaferGallery(container, [
 *   result1,
 *   { ...result2, label: 'W02', statsSummary: summary2 },
 * ]);
 * ```
 */
export interface WaferMapDisplayItem {
  // Required — the geometry and die data the gallery needs to render a card.
  wafer: import('../core/wafer.js').Wafer;
  dies:  Die[];

  // Definitions carried from buildWaferMap — all optional for synthetic items.
  hbinDefs?:  import('../renderer/buildWaferMap.js').BinDef[];
  sbinDefs?:  import('../renderer/buildWaferMap.js').BinDef[];
  testDefs?:  import('../renderer/buildWaferMap.js').TestDef[];
  reticles?:  import('../core/reticle.js').Reticle[];

  // Per-card display overrides.
  label?:        string;
  /** Merged on top of the shared gallery options for this card only. */
  viewOptions?:  Partial<WaferViewOptions>;
  /** Shown in the findings panel when this card is opened in the modal. */
  statsSummary?: import('../stats/types.js').StatsSummary;
  onClick?:      (die: Die, event: MouseEvent) => void;
  onSelect?:     (dies: Die[]) => void;

}

/**
 * A factory function that builds a WaferMapDisplayItem on demand.
 * The gallery calls each factory in a deferred task (`setTimeout(0)`) so the
 * browser stays responsive while large item sets are built progressively.
 */
export type WaferMapDisplayItemFactory = () => WaferMapDisplayItem;

/** @deprecated Use WaferMapDisplayItem instead. */
export type GalleryItem = WaferMapDisplayItem;
/** @deprecated Use WaferMapDisplayItemFactory instead. */
export type GalleryItemFactory = WaferMapDisplayItemFactory;

export interface GalleryOptions {
  /** Initial shared scene options applied to all cards. */
  viewOptions?:         WaferViewOptions;
  /** Called whenever a shared gallery option changes. */
  onViewOptionsChange?: (
    opts:     WaferViewOptions,
    changed:  (keyof WaferViewOptions)[],
    category: 'preference' | 'state' | 'mixed',
  ) => void;
  /** Legend position for bin modes. Default 'default'. */
  legendPosition?:       'default' | 'compact' | 'bottom' | 'top' | 'left' | 'floating';
  /** Padding inside each card canvas in CSS pixels. Default 6. */
  cardPadding?:          number;
  /** Filename stem for the composite gallery PNG. Default 'wafer-gallery'. */
  downloadFilename?:     string;
  /**
   * Host hook for persisting the composite gallery PNG. When provided, the save
   * action calls `onSaveImage(blob, suggestedName)` instead of triggering a
   * browser `<a download>` — letting embedded hosts (Tauri, Electron, WebView2)
   * route the image through a native save dialog. `suggestedName` includes the
   * `.png` extension and is derived from `downloadFilename`. When omitted, the
   * default browser download behaviour is unchanged.
   */
  onSaveImage?:          SaveImageHandler;
  /**
   * Format to use for unitless values outside the normal display range [0.1, 9999].
   * `'engineering'` (default): multiples-of-3 exponent notation (e.g. `12E-6`).
   * `'si'`: SI prefix with no unit suffix (e.g. `12 µ`).
   * Values with a unit always use SI prefix regardless of this setting.
   */
  fallbackFormat?:         'si' | 'engineering';
  /**
   * Show the plot mode selector in the gallery control bar. Default true.
   * Set to false when the host application manages mode switching itself.
   */
  showPlotModeSelector?:   boolean;
  /** Precomputed lot-level stats summary. Enables the summary panel toggle button in the control bar. */
  lotStatsSummary?:        LotStatsSummary;
  /**
   * When provided, renders a persistent summary panel alongside the gallery grid.
   * The panel starts in lot-level state and drills down to wafer level when a card
   * is clicked, with a back button to return to lot view.
   * When active, the findings drawer is suppressed.
   */
  summaryPanel?:           SummaryPanelOptions;
  /**
   * Bin numbers treated as pass for yield calculation in the summary panel.
   * Defaults to `[1]`. Must match the `passBins` passed to `analyzeWaferLot` / `buildWaferMap`
   * to ensure the summary panel yield label is consistent with the rest of the display.
   */
  passBins?:               number[];
  /**
   * Fix the number of columns in the gallery grid. When set, overrides the
   * auto-computed minimum card width and the toolbar columns control.
   * Omit (default) to let the gallery auto-size cards based on die pitch.
   */
  columns?:                number;
  /**
   * Show a help button in the gallery control bar that opens the built-in end-user guide in a modal.
   * Default false. Enable in applications that want to surface the guide without linking externally.
   */
  showHelpButton?:         boolean;
}

export interface GalleryController {
  /** Replace all items — destroys existing cards and rebuilds the grid. Accepts pre-built items, factory functions, or a mix. */
  setItems(items: Array<WaferMapDisplayItem | WaferMapDisplayItemFactory>): void;
  /** Merge shared scene option overrides across all cards. */
  setOptions(opts: Partial<WaferViewOptions>): void;
  /** Return the current shared scene options. */
  getOptions(): WaferViewOptions;
  /** Update the fallback format for unitless values across all cards. */
  setFallbackFormat(format: 'si' | 'engineering'): void;
  /** Replace the lot-level stats summary used by the built-in findings panel. */
  setLotStatsSummary(summary: LotStatsSummary | undefined): void;
  /**
   * Set the number of columns in the gallery grid. Pass `undefined` to restore
   * the auto-computed layout based on die pitch.
   */
  setColumns(columns: number | undefined): void;
  /** Remove all DOM and event listeners. */
  destroy(): void;
}


// ── Helpers ───────────────────────────────────────────────────────────────────

function deduplicateDefs(defs: BinDef[]): BinDef[] {
  const seen = new Set<number>();
  return defs.filter(d => seen.has(d.bin) ? false : (seen.add(d.bin), true));
}

// ── Main export ───────────────────────────────────────────────────────────────

export function renderWaferGallery(
  container: HTMLElement,
  items: Array<WaferMapDisplayItem | WaferMapDisplayItemFactory>,
  options: GalleryOptions = {},
): GalleryController {
  const cardPadding          = options.cardPadding          ?? 6;
  const downloadFilename     = options.downloadFilename     ?? 'wafer-gallery';
  let currentColumns         = options.columns;
  const showPlotModeSelector = options.showPlotModeSelector ?? true;
  const showHelpButton       = options.showHelpButton       ?? false;
  const summaryPanelOpts     = options.summaryPanel;
  const passBins             = options.passBins             ?? [1];
  let currentFallbackFormat  = options.fallbackFormat;
  let currentLotStats        = options.lotStatsSummary;
  let currentLegendStyle     = options.legendPosition ?? 'default' as 'default' | 'compact' | 'bottom' | 'top' | 'left' | 'floating';

  let sharedOpts: WaferViewOptions = {
    plotMode:               'hardBin',
    colorScheme:            'default',
    showDieLabels:               false,
    showRingBoundaries:     false,
    showQuadrantBoundaries: false,
    ringCount:              4,
    rotation:               0,
    flipX:                  false,
    flipY:                  false,
    ...options.viewOptions,
  };

  let cardControllers: WaferMapController[] = [];
  let cardContainers: HTMLDivElement[] = [];  // canvasWrapper per card — used for modal reparenting
  let currentItems:  WaferMapDisplayItem[] = [];
  let originalItems: (WaferMapDisplayItem | null)[] = [];  // per-wafer source items; null = factory not yet resolved
  let buildGeneration = 0;  // incremented on each buildCards call; stale factory callbacks check this
  let modalReparentedContainer: HTMLDivElement | null = null;
  let modalReparentedParent: HTMLElement | null = null;
  let modalCardIndex = -1;
  let modalHandleGallery: ReturnType<typeof openModal> | null = null;


  let btnLotFindings: HTMLButtonElement | null = null;
  let activeLotFindingId: string | null = null;
  // Card highlight state: indices of cards to visually emphasise.
  let highlightedCardIndices = new Set<number>();

  // Summary panel state
  let gallerySummaryPanelEl: HTMLDivElement | null = null;
  // 'lot' = lot-level aggregated view (requires currentLotStats)
  // 'wafers' = per-wafer findings index (requires items with statsSummary)
  let gallerySummaryTab: 'lot' | 'wafers' = 'lot';

  // ── Per-wafer summary helpers ─────────────────────────────────────────────

  // Resolve the per-wafer StatsSummary for a given item index.
  // Falls back to lotStatsSummary.perWafer so a single analyzeWaferLot call
  // is sufficient — no separate analyzeWaferMap per item required.
  function perWaferSummary(index: number): StatsSummary | undefined {
    return originalItems[index]?.statsSummary
      ?? currentLotStats?.perWafer.find(pw => pw.waferIndex === index)?.summary;
  }

  // True when any wafer has per-wafer findings, either on the item or in the lot summary.
  function hasAnyPerWaferFindings(): boolean {
    if (originalItems.some(it => it?.statsSummary?.findings.length)) return true;
    if (currentLotStats?.perWafer.some(pw => pw.summary.findings.length)) return true;
    return false;
  }

  // ── Toolbar helpers ────────────────────────────────────────────────────────

  const tooltip = createTooltip();
  const { makeBtn, setActive, makeSep, makeMenuRow, makeMenuSection, makeDropdown, makeCheckMenuBtn, closeOpenMenu, getOpenMenu, setOpenMenu } = createToolbarHelpers(tooltip);
  document.addEventListener('click', closeOpenMenu, true);

  function applyCardHighlight(indices: number[]): void {
    highlightedCardIndices = new Set(indices);
    const cards = [...gridEl.querySelectorAll<HTMLElement>('.wmap-gallery-card')];
    let firstHighlighted: HTMLElement | undefined;
    cards.forEach((card, i) => {
      const active = highlightedCardIndices.has(i);
      card.style.outline       = active ? '3px solid #e07a20' : '';
      card.style.outlineOffset = active ? '-3px' : '';
      if (active && firstHighlighted === undefined) firstHighlighted = card;
    });
    firstHighlighted?.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' });
  }

  function clearCardHighlight(): void {
    applyCardHighlight([]);
  }

  function clearDieZoneHighlight(): void {
    for (const ctrl of cardControllers) if (ctrl) ctrl.clearSelection();
  }

  function applyDieZoneHighlight(dieKeys: string[], cardIndices?: number[]): void {
    const keySet = new Set(dieKeys);
    const targets = cardIndices ?? cardControllers.map((_, i) => i);
    for (const ci of targets) {
      const item = currentItems[ci];
      if (!item) continue;
      const matched = item.dies.filter(d => keySet.has(`${d.x},${d.y}`));
      cardControllers[ci].setSelection(matched);
    }
  }

  // ── Gallery summary panel ──────────────────────────────────────────────────

  // Severity colour — matches summaryPanel.ts sevColor
  function gallerySevColor(s: 'unusual' | 'notable' | 'info'): string {
    return s === 'unusual' ? '#a84112' : s === 'notable' ? '#8a6500' : '#506784';
  }

  // Tab row shown when both lot stats and per-wafer findings are present.
  function buildPanelTabRow(): HTMLDivElement {
    const row = document.createElement('div');
    Object.assign(row.style, {
      display:       'flex',
      gap:           '4px',
      marginBottom:  '10px',
      borderBottom:  `1px solid rgba(0,0,0,0.10)`,
      paddingBottom: '8px',
    });
    for (const tab of (['lot', 'wafers'] as const)) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = tab === 'lot' ? 'Lot' : 'Wafers';
      const active = gallerySummaryTab === tab;
      Object.assign(btn.style, {
        border:       'none',
        borderRadius: '4px',
        padding:      '2px 8px',
        fontSize:     '11px',
        cursor:       'pointer',
        fontWeight:   active ? '600' : '400',
        background:   active ? CLR.bgActive : 'transparent',
        color:        active ? '#2a3f5f' : CLR.icon,
      });
      btn.addEventListener('click', () => {
        gallerySummaryTab = tab;
        clearCardHighlight();
        clearDieZoneHighlight();
        renderGallerySummaryPanel();
      });
      row.appendChild(btn);
    }
    return row;
  }

  // Per-wafer findings index — list of wafers with findings; clicking opens the modal.
  function renderPerWaferIndex(): void {
    if (!gallerySummaryPanelEl) return;
    gallerySummaryPanelEl.innerHTML = '';

    // Tab row only when lot findings also exist
    if (currentLotStats) {
      gallerySummaryPanelEl.appendChild(buildPanelTabRow());
    }

    // Collect wafers that have findings — from item.statsSummary or lotStats.perWafer
    const wafersWithFindings: Array<{ index: number; item: WaferMapDisplayItem; unusualCount: number; notableCount: number; totalCount: number }> = [];
    for (let i = 0; i < originalItems.length; i++) {
      const item = originalItems[i];
      if (!item) continue;
      const findings = perWaferSummary(i)?.findings ?? [];
      if (!findings.length) continue;
      const unusualCount = findings.filter(f => f.severity === 'unusual').length;
      const notableCount = findings.filter(f => f.severity === 'notable').length;
      wafersWithFindings.push({ index: i, item, unusualCount, notableCount, totalCount: findings.length });
    }

    // "Report all wafers" button
    if (wafersWithFindings.length > 0) {
      const reportBtn = document.createElement('button');
      reportBtn.type = 'button';
      reportBtn.textContent = 'Findings report';
      Object.assign(reportBtn.style, {
        border:       `1px solid rgba(0,0,0,0.15)`,
        borderRadius: '4px',
        padding:      '3px 8px',
        marginBottom: '10px',
        fontSize:     '10px',
        color:        '#2a3f5f',
        background:   'none',
        cursor:       'pointer',
        display:      'block',
        width:        '100%',
        textAlign:    'left',
      });
      reportBtn.addEventListener('click', () => {
        const sections = wafersWithFindings
          .map(({ item, index }) => {
            const summary = perWaferSummary(index)!;
            const label = item.label ?? `W${index + 1}`;
            const rows = summary.findings.map(f => {
              const dot = f.severity === 'unusual' ? '●' : f.severity === 'notable' ? '◉' : '○';
              return `<li style="margin:2px 0">${dot} ${f.summary}</li>`;
            }).join('');
            return `<section style="margin-bottom:24px"><h2 style="font-size:14px;margin:0 0 8px;color:#2a3f5f">${label}</h2><ul style="margin:0;padding-left:18px;font-size:12px;color:#444">${rows}</ul></section>`;
          }).join('');
        const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Findings report</title><style>body{font-family:system-ui,sans-serif;padding:24px;max-width:800px;margin:0 auto}</style></head><body><h1 style="font-size:16px;margin:0 0 20px;color:#1a2f4f">Findings report — ${wafersWithFindings.length} wafer${wafersWithFindings.length > 1 ? 's' : ''}</h1>${sections}</body></html>`;
        openHtmlReport(html);
      });
      gallerySummaryPanelEl.appendChild(reportBtn);
    }

    // Wafer rows
    if (wafersWithFindings.length === 0) {
      const empty = document.createElement('div');
      Object.assign(empty.style, { color: CLR.icon, fontSize: '11px', padding: '4px 0' });
      empty.textContent = 'No findings on any wafer.';
      gallerySummaryPanelEl.appendChild(empty);
    } else {
      for (const { index, item, unusualCount, notableCount, totalCount } of wafersWithFindings) {
        const topSeverity: 'unusual' | 'notable' | 'info' =
          unusualCount ? 'unusual' : notableCount ? 'notable' : 'info';
        // Badge shows notable+unusual count if any exist, otherwise total findings count
        const badgeCount = (unusualCount + notableCount) || totalCount;

        const row = document.createElement('button');
        row.type = 'button';
        Object.assign(row.style, {
          display:        'flex',
          alignItems:     'center',
          justifyContent: 'space-between',
          width:          '100%',
          padding:        '5px 8px',
          marginBottom:   '4px',
          border:         'none',
          borderLeft:     `3px solid ${gallerySevColor(topSeverity)}`,
          borderRadius:   '3px',
          background:     'rgba(0,0,0,0.03)',
          cursor:         'pointer',
          fontSize:       '11px',
          textAlign:      'left',
          boxSizing:      'border-box',
        });
        row.addEventListener('mouseover', () => { row.style.background = CLR.bgActive; });
        row.addEventListener('mouseout',  () => { row.style.background = 'rgba(0,0,0,0.03)'; });

        const labelSpan = document.createElement('span');
        labelSpan.textContent = item.label ?? `W${index + 1}`;
        Object.assign(labelSpan.style, {
          color:         '#2a3f5f',
          overflow:      'hidden',
          textOverflow:  'ellipsis',
          whiteSpace:    'nowrap',
        });

        const badge = document.createElement('span');
        badge.textContent = String(badgeCount);
        Object.assign(badge.style, {
          marginLeft:   '6px',
          flexShrink:   '0',
          background:   gallerySevColor(topSeverity),
          color:        '#fff',
          borderRadius: '8px',
          padding:      '1px 5px',
          fontSize:     '10px',
          fontWeight:   '600',
        });

        row.appendChild(labelSpan);
        row.appendChild(badge);
        // Open the modal for this wafer — openModalForCard already calls setFindingsVisible(true)
        row.addEventListener('click', () => openModalForCard(index, item));
        gallerySummaryPanelEl.appendChild(row);
      }
    }

    // Bottom spacer so last row isn't clipped when scrolled
    const spacer = document.createElement('div');
    spacer.style.height = '12px';
    gallerySummaryPanelEl.appendChild(spacer);
  }

  function renderGallerySummaryPanel(): void {
    if (!gallerySummaryPanelEl) return;

    if (gallerySummaryTab === 'lot' && currentLotStats) {
      // Lot-level view
      const lotHbinDefs = deduplicateDefs(originalItems.flatMap(it => it?.hbinDefs ?? []));
      const lotSbinDefs = deduplicateDefs(originalItems.flatMap(it => it?.sbinDefs ?? []));
      const lotActiveFindingId = activeLotFindingId;
      renderLotSummaryContent(gallerySummaryPanelEl, {
        lotSummary: currentLotStats,
        items:      originalItems,
        hbinDefs:   lotHbinDefs.length ? lotHbinDefs : undefined,
        sbinDefs:   lotSbinDefs.length ? lotSbinDefs : undefined,
        testDefs:   originalItems.find(it => it?.testDefs?.length)?.testDefs,
        passBins,
        ringCount:      sharedOpts.ringCount,
        colorScheme:    sharedOpts.colorScheme,
        fallbackFormat: currentFallbackFormat,
        activeFindingId: lotActiveFindingId,
        onFindingClick: (finding, row) => {
          if (activeLotFindingId === finding.id) {
            clearLotFindingHighlight();
          } else {
            applyLotFindingHighlight(finding, row);
          }
          renderGallerySummaryPanel();
        },
        onWaferClick: (waferIndex) => {
          applyCardHighlight([waferIndex]);
        },
      });
      // Prepend tab row if per-wafer findings also exist
      if (hasAnyPerWaferFindings()) {
        gallerySummaryPanelEl.insertBefore(buildPanelTabRow(), gallerySummaryPanelEl.firstChild);
      }
    } else {
      renderPerWaferIndex();
    }
  }

  function findingFingerprint(f: StatsFinding): string {
    return [
      f.variable.kind,
      f.variable.index ?? '',
      f.variable.bin ?? '',
      f.comparison.family,
      f.comparison.left,
      f.effect.direction,
    ].join('|');
  }

  function clearLotFindingHighlight(): void {
    activeLotFindingId = null;
    clearCardHighlight();
    clearDieZoneHighlight();
    updateShared({ highlightBin: undefined }, { fireCallback: false });
  }

  function applyLotFindingHighlight(finding: StatsFinding, row: HTMLButtonElement): void {
    // Toggle off if already active.
    if (activeLotFindingId === finding.id) {
      clearLotFindingHighlight();
      return;
    }

    activeLotFindingId   = finding.id;
    row.style.background = CLR.bgActive;
    row.style.fontWeight = '600';

    // Switch to the mode that makes this finding's data visible.
    // Don't set highlightBin — the die zone selection overlay already shows the affected
    // dies, and highlightBin dims everything else making the map look empty.
    const { kind, index } = finding.variable;
    if (kind === 'test') {
      updateShared({ plotMode: 'value', activeTest: index ?? 0, highlightBin: undefined }, { fireCallback: false });
    } else if (kind === 'softBin') {
      updateShared({ plotMode: 'softBin', highlightBin: undefined }, { fireCallback: false });
    } else {
      updateShared({ plotMode: 'hardBin', highlightBin: undefined }, { fireCallback: false });
    }

    // Clear all card outlines and die zone selections before applying new ones.
    clearCardHighlight();
    clearDieZoneHighlight();

    const h = finding.highlight;
    if (h.kind === 'wafer') {
      applyCardHighlight(h.waferIndices);
      // For repeated-pattern findings, highlight the actual die zones on the
      // affected cards using each card's matching per-wafer finding's dieKeys.
      const fp = findingFingerprint(finding);
      for (const ci of h.waferIndices) {
        const item = currentItems[ci];
        const perWaferFinding = item?.statsSummary?.findings.find(
          f => findingFingerprint(f) === fp,
        );
        const dieKeys = (perWaferFinding?.highlight as { dieKeys?: string[] } | undefined)?.dieKeys;
        if (dieKeys?.length) applyDieZoneHighlight(dieKeys, [ci]);
      }
    } else if (h.kind === 'bin') {
      if (h.dieKeys?.length) applyDieZoneHighlight(h.dieKeys);
    } else if (h.kind === 'region' || h.kind === 'dies') {
      if (h.dieKeys?.length) applyDieZoneHighlight(h.dieKeys);
    }
  }

  function refreshLotFindingsButton(): void {
    if (!btnLotFindings) return;
    const hasSummaryPanel = !!gallerySummaryPanelEl;
    btnLotFindings.style.display = ((currentLotStats || hasAnyPerWaferFindings()) && hasSummaryPanel) ? 'flex' : 'none';
    const panelOpen = gallerySummaryPanelEl
      ? gallerySummaryPanelEl.style.display !== 'none'
      : false;
    const hasNotable = currentLotStats?.hasNotableFindings
      || originalItems.some(it => it?.statsSummary?.hasNotableFindings);
    if (hasNotable && !panelOpen) {
      btnLotFindings.style.color = '#b7551a';
    } else if (!btnLotFindings.dataset.active) {
      btnLotFindings.style.color = CLR.icon;
    }
  }

  // ── Gallery control bar ────────────────────────────────────────────────────

  const barEl = document.createElement('div');
  barEl.dataset.wmapToolbar = 'gallery';
  Object.assign(barEl.style, {
    display:       'inline-flex',
    flexDirection: 'row',
    alignItems:    'center',
    gap:           '0',
    background:    '#fff',
    border:        `1px solid ${CLR.menuBorder}`,
    borderRadius:  '6px',
    padding:       '3px 4px',
    marginBottom:  '10px',
    boxShadow:     '0 1px 4px rgba(0,0,0,0.10)',
    flexWrap:      'wrap',
    minWidth:      '0',
    overflowX:     'auto',
  });

  const closeModeMenu = (): void => {
    const m = getOpenMenu();
    if (m) { m.remove(); setOpenMenu(null); }
    markMenuTrigger(btnMode, false);
  };
  const btnMode = makeBtn('mode', 'Plot mode', () => {
    if (getOpenMenu()) { closeModeMenu(); return; }

    // Use originalItems (per-wafer source) — currentItems may be aggregated cards
    // in stacked modes, which don't accurately reflect the full data availability.
    const dies      = originalItems.flatMap(it => it?.dies ?? []);
    const testDefs  = originalItems.find(it => it?.testDefs?.length)?.testDefs;
    const hasValues = dies.some(d =>
      (d.testValues !== undefined && Object.keys(d.testValues).length > 0) ||
      (d.values?.length ?? 0) > 0
    );
    const hasHbin = dies.some(d => d.hbin != null);
    const hasSbin = dies.some(d => d.sbin != null);

    const currentMode    = sharedOpts.plotMode ?? 'hardBin';
    const currentTestIdx = sharedOpts.activeTest ?? 0;

    function isCurrentEntry(e: ModeEntry): boolean {
      if (e.plotMode !== currentMode) return false;
      if (e.plotMode === 'value') return currentTestIdx === (e.activeTest ?? 0);
      return true;
    }

    function pickEntry(entry: ModeEntry, menu: HTMLElement): void {
      if (entry.activeTest !== undefined) {
        updateShared({ plotMode: 'value', activeTest: entry.activeTest, logScale: entry.logScale });
      } else {
        updateShared({ plotMode: entry.plotMode, activeTest: undefined });
      }
      menu.remove();
      setOpenMenu(null);
      markMenuTrigger(btnMode, false);
    }

    const testEntries: ModeEntry[] = hasValues
      ? (testDefs?.length
          ? testDefs.map(t => ({
              plotMode: 'value' as PlotMode,
              activeTest: t.index ?? t.testNumber ?? 0,
              label: t.unit ? `${t.name} (${t.unit})` : t.name,
              logScale: t.logScale,
            }))
          : getUniqueTestNumbers(dies).map(tn => ({
              plotMode: 'value' as PlotMode,
              activeTest: tn,
              label: `Test ${tn}`,
            })))
      : [];
    const binEntries: ModeEntry[] = [
      ...(hasHbin ? [{ plotMode: 'hardBin' as PlotMode, label: MODE_LABELS.hardBin }] : []),
      ...(hasSbin ? [{ plotMode: 'softBin' as PlotMode, label: MODE_LABELS.softBin }] : []),
    ];
    const stackedEntries: ModeEntry[] = [
      ...(hasValues ? [{ plotMode: 'stackedValues'   as PlotMode, label: MODE_LABELS.stackedValues }]   : []),
      ...(hasHbin   ? [{ plotMode: 'stackedBins'     as PlotMode, label: MODE_LABELS.stackedBins }]     : []),
      ...(hasSbin   ? [{ plotMode: 'stackedSoftBins' as PlotMode, label: MODE_LABELS.stackedSoftBins }] : []),
    ];

    const menu = buildModeMenuEl(
      btnMode.getBoundingClientRect(),
      testEntries, binEntries, stackedEntries,
      isCurrentEntry, pickEntry,
      { makeMenuRow, makeMenuSection },
      currentMode,
    );
    document.body.appendChild(menu);
    setOpenMenu(menu);
    markMenuTrigger(btnMode, true);
    wireMenuA11y(menu, btnMode, closeModeMenu);
  });
  markMenuTrigger(btnMode, false);

  const itemsHaveCustomColors = (): boolean =>
    currentItems.flatMap(it => it ? [...(it.hbinDefs ?? []), ...(it.sbinDefs ?? [])] : []).some(d => d.color);

  const btnPalette = makeDropdown(
    'palette', 'Colour scheme',
    () => {
      const pm = sharedOpts.plotMode ?? 'hardBin';
      const isBinMode = pm === 'hardBin' || pm === 'softBin';
      const schemes = isBinMode
        ? listColorSchemes().filter(s => s.name === 'default' || s.name === 'accessible')
        : listColorSchemes();
      return [
        ...(itemsHaveCustomColors() ? [{ value: 'custom', label: 'Custom' }] : []),
        ...schemes.map(s => ({ value: s.name, label: s.label })),
      ];
    },
    () => sharedOpts.colorScheme ?? 'default',
    v => updateShared({ colorScheme: v }),
  );

  const hasReticleInItems = items.some(it => typeof it !== 'function' && ((it as WaferMapDisplayItem).reticles?.length ?? 0) > 0);

  const btnOverlays = makeCheckMenuBtn(
    'overlays', 'Overlays',
    () => [
      { label: 'Ring boundaries', active: !!sharedOpts.showRingBoundaries,     onClick: () => updateShared({ showRingBoundaries:   !sharedOpts.showRingBoundaries   }) },
      { label: 'Quadrant lines',  active: !!sharedOpts.showQuadrantBoundaries, onClick: () => updateShared({ showQuadrantBoundaries: !sharedOpts.showQuadrantBoundaries }) },
      { label: 'Die labels',      active: !!sharedOpts.showDieLabels,               onClick: () => updateShared({ showDieLabels:              !sharedOpts.showDieLabels              }) },
      { label: 'Reticle grid',    active: !!sharedOpts.showReticle,            enabled: hasReticleInItems, onClick: () => updateShared({ showReticle: !sharedOpts.showReticle }) },
      { label: 'XY indicator',    active: !!sharedOpts.showXYIndicator,        onClick: () => updateShared({ showXYIndicator:      !sharedOpts.showXYIndicator      }) },
    ],
    (btn) => {
      const anyOn = !!(sharedOpts.showRingBoundaries || sharedOpts.showQuadrantBoundaries ||
                       sharedOpts.showDieLabels || sharedOpts.showReticle || sharedOpts.showXYIndicator);
      setActive(btn, anyOn);
    },
  );
  const btnLegendStyle = makeDropdown(
    'legend',
    'Legend style',
    () => [
      { value: 'default'  as const, label: 'Default (right)' },
      { value: 'compact'  as const, label: 'Compact (right)' },
      { value: 'left'     as const, label: 'Left' },
      { value: 'top'      as const, label: 'Top' },
      { value: 'bottom'   as const, label: 'Bottom' },
      { value: 'floating' as const, label: 'Floating' },
    ],
    () => currentLegendStyle,
    (v) => {
      currentLegendStyle = v;
      for (const ctrl of cardControllers) if (ctrl) ctrl.setOptions({ legendPosition: currentLegendStyle });
    },
  );

  function syncLegendStyleBtn(): void {
    const isBinMode = sharedOpts.plotMode === 'hardBin' || sharedOpts.plotMode === 'softBin';
    btnLegendStyle.style.display = isBinMode ? '' : 'none';
  }
  syncLegendStyleBtn();

  const AGGR_METHOD_ITEMS: Array<{ value: string; label: string }> = [
    { value: 'mean',   label: 'Mean' },
    { value: 'median', label: 'Median' },
    { value: 'stddev', label: 'Std Dev' },
    { value: 'min',    label: 'Min' },
    { value: 'max',    label: 'Max' },
    { value: 'count',  label: 'Count' },
  ];

  const btnAggrMethod = makeDropdown(
    'aggr', 'Aggregation method',
    () => AGGR_METHOD_ITEMS,
    () => sharedOpts.aggregationMethod ?? 'mean',
    v => updateShared({ aggregationMethod: v }),
  );
  function syncAggrMethodBtn(): void {
    const isStackedValues = sharedOpts.plotMode === 'stackedValues';
    btnAggrMethod.style.display = isStackedValues ? '' : 'none';
  }
  syncAggrMethodBtn();

  const btnLogScale = makeBtn('logScale', 'Toggle log scale', () => {
    updateShared({ logScale: !sharedOpts.logScale });
    syncLogScaleBtn();
  });
  function syncLogScaleBtn(): void {
    const isValueMode = sharedOpts.plotMode === 'value' || sharedOpts.plotMode === 'stackedValues';
    btnLogScale.style.display = isValueMode ? '' : 'none';
    setActive(btnLogScale, !!sharedOpts.logScale);
  }
  syncLogScaleBtn();

  const btnOrient = makeCheckMenuBtn(
    'orient', 'Orientation',
    () => [
      { section: 'Rotate' },
      { label: 'Rotate 90° clockwise', active: false, onClick: () => { const r = sharedOpts.rotation ?? 0; updateShared({ rotation: ROTATIONS[(ROTATIONS.indexOf(r) + 1) % 4] }); } },
      { section: 'Flip' },
      { label: 'Flip horizontal', active: !!sharedOpts.flipX, onClick: () => updateShared({ flipX: !sharedOpts.flipX }) },
      { label: 'Flip vertical',   active: !!sharedOpts.flipY, onClick: () => updateShared({ flipY: !sharedOpts.flipY }) },
    ],
    (btn) => {
      const nonDefault = !!(sharedOpts.rotation || sharedOpts.flipX || sharedOpts.flipY);
      setActive(btn, nonDefault);
    },
  );
  const btnDownloadAll = makeBtn('downloadAll', 'Download gallery PNG', downloadGalleryPng);

  type ColsValue = '1' | '2' | '3' | '4' | '5' | 'auto';
  const btnColumns = makeDropdown(
    'columns', 'Columns',
    () => [
      { value: 'auto' as ColsValue, label: 'Auto' },
      { value: '1'    as ColsValue, label: '1 column' },
      { value: '2'    as ColsValue, label: '2 columns' },
      { value: '3'    as ColsValue, label: '3 columns' },
      { value: '4'    as ColsValue, label: '4 columns' },
      { value: '5'    as ColsValue, label: '5 columns' },
    ],
    () => (currentColumns != null ? String(currentColumns) as ColsValue : 'auto'),
    (v) => setColumnsState(v === 'auto' ? undefined : Number(v)),
  );

  if (showPlotModeSelector) barEl.appendChild(btnMode);
  barEl.appendChild(btnPalette);
  barEl.appendChild(btnAggrMethod);
  barEl.appendChild(btnLogScale);
  barEl.appendChild(makeSep());
  barEl.appendChild(btnOverlays);
  barEl.appendChild(makeSep());
  barEl.appendChild(btnLegendStyle);
  barEl.appendChild(makeSep());
  barEl.appendChild(btnOrient);
  barEl.appendChild(makeSep());
  barEl.appendChild(btnColumns);
  barEl.appendChild(makeSep());
  barEl.appendChild(btnDownloadAll);

  // Findings button — toggles the gallery summary panel.
  // Shown when lotStatsSummary is provided, or when any item carries per-wafer findings.
  {
    if (currentLotStats || hasAnyPerWaferFindings()) {
      btnLotFindings = makeBtn('findings', 'Summary panel', () => {
        if (!gallerySummaryPanelEl) return;
        const isOpen = gallerySummaryPanelEl.style.display !== 'none';
        if (!isOpen) renderGallerySummaryPanel();
        gallerySummaryPanelEl.style.display = isOpen ? 'none' : 'flex';
        setActive(btnLotFindings!, !isOpen);
        refreshLotFindingsButton();
      });
      barEl.appendChild(makeSep());
      barEl.appendChild(btnLotFindings);
    }
  }

  // Help button — opens the end-user guide in a modal (opt-in).
  if (showHelpButton) {
    barEl.appendChild(makeSep());
    barEl.appendChild(makeBtn('help', 'User guide', () => {
      const content = document.createElement('div');
      Object.assign(content.style, { flex: '1', overflow: 'auto', minHeight: '0' });
      content.innerHTML = USER_GUIDE_HTML;
      const handle = openModal({
        title: 'Wafer Map — User Guide',
        onClose: () => {},
      });
      handle.contentWrap.appendChild(content);
    }));
  }

  // ── Bin legend strip ───────────────────────────────────────────────────────

  const legendEl = document.createElement('div');
  Object.assign(legendEl.style, {
    display:       'flex',
    flexWrap:      'wrap',
    gap:           '6px 14px',
    background:    '#fff',
    border:        `1px solid rgba(0,0,0,0.12)`,
    borderRadius:  '6px',
    padding:       '6px 10px',
    marginBottom:  '10px',
    boxShadow:     '0 1px 4px rgba(0,0,0,0.10)',
    fontSize:      '12px',
    lineHeight:    '1',
    boxSizing:     'border-box',
    width:         '100%',
    minWidth:      '0',
  });

  // ── Body row (grid + side drawer) ──────────────────────────────────────────

  const bodyEl = document.createElement('div');
  Object.assign(bodyEl.style, {
    display:   'flex',
    flexDirection: 'row',
    gap:       '12px',
    alignItems: 'flex-start',
  });

  // ── Grid container ─────────────────────────────────────────────────────────

  const TARGET_DIE_PX = 4;   // minimum readable die pixel size at gallery scale
  const MIN_CARD_PX   = 240; // absolute floor
  const MAX_CARD_PX   = 480; // cap to avoid monopolising width on dense grids

  // Compute the minimum card width (px) so that each die is at least TARGET_DIE_PX wide.
  // Uses die.width (mm) and wafer.radius from the first item that has die data.
  function computeMinCardPx(its: (WaferMapDisplayItem | null)[]): number {
    const result = its.find(it => it != null && it.dies?.length > 0);
    if (!result) return MIN_CARD_PX;
    const diePitchMm  = result.dies[0].width;
    const waferDiamMm = result.wafer.radius * 2;
    const minPpm      = TARGET_DIE_PX / diePitchMm;
    const minCanvasPx = waferDiamMm * minPpm;
    // card chrome: cardPadding on each side + bin legend reserve + 2px border
    const chrome = cardPadding * 2 + 110 + 2;
    return Math.min(MAX_CARD_PX, Math.max(MIN_CARD_PX, Math.ceil(minCanvasPx + chrome)));
  }

  let currentMinCardPx = MIN_CARD_PX;
  let currentItemCount = 0;

  function applyGridColumns(its: (WaferMapDisplayItem | null)[]): void {
    if (currentColumns != null) return; // fixed column count overrides auto-sizing
    const newMin = computeMinCardPx(its);
    if (newMin > currentMinCardPx) currentMinCardPx = newMin;
    applyGridTemplate();
  }

  function setColumnsState(cols: number | undefined): void {
    currentColumns = cols;
    applyGridTemplate();
  }

  function applyGridTemplate(): void {
    if (currentColumns != null) {
      gridEl.style.gridTemplateColumns = `repeat(${currentColumns}, 1fr)`;
      return;
    }
    const N = Math.max(1, currentItemCount);
    const gap = 12;
    const containerW = bodyEl.clientWidth || 0;

    // Start with a square-ish grid (sqrt(N) columns), then reduce columns if
    // the resulting card width would fall below the minimum readable size.
    // Reducing columns means more rows — cards get taller and wider.
    const idealCols = Math.max(1, Math.ceil(Math.sqrt(N)));
    let cols = idealCols;
    if (containerW > 0) {
      while (cols > 1) {
        const cardW = (containerW - gap * (cols - 1)) / cols;
        if (cardW >= currentMinCardPx) break;
        cols--;
      }
    }
    gridEl.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
  }

  const gridEl = document.createElement('div');
  Object.assign(gridEl.style, {
    flex:                    '1 1 0',
    minWidth:                '0',
    display:                 'grid',
    gridTemplateColumns:     `repeat(1, 1fr)`,
    gap:                     '12px',
  });

  // Build gallery summary panel.
  // Explicit placement: always visible persistent panel.
  // Auto-mount (lotStatsSummary or per-wafer findings, no placement): toggled via toolbar button.
  // defaultOpen: true starts the auto-mounted panel visible.
  {
    // Set initial tab: 'lot' if lot stats present (preserves existing behaviour), else 'wafers'.
    gallerySummaryTab = currentLotStats ? 'lot' : 'wafers';

    if (summaryPanelOpts?.placement) {
      const placement = summaryPanelOpts.placement;
      gallerySummaryPanelEl = createSummaryPanelEl(placement);
      gallerySummaryPanelEl.style.maxHeight = 'calc(100vh - 80px)';
      gallerySummaryPanelEl.style.position  = 'sticky';
      gallerySummaryPanelEl.style.top       = '8px';
      gallerySummaryPanelEl.style.display   = 'flex';
      gallerySummaryPanelEl.style.flexDirection = 'column';
    } else if (currentLotStats || hasAnyPerWaferFindings()) {
      const openOnMount = !!summaryPanelOpts?.defaultOpen;
      gallerySummaryPanelEl = createSummaryPanelEl('right');
      gallerySummaryPanelEl.style.maxHeight = 'calc(100vh - 80px)';
      gallerySummaryPanelEl.style.position  = 'sticky';
      gallerySummaryPanelEl.style.top       = '8px';
      gallerySummaryPanelEl.style.flexDirection = 'column';
      gallerySummaryPanelEl.style.display   = openOnMount ? 'flex' : 'none';
      renderGallerySummaryPanel();
    }
  }

  refreshLotFindingsButton();
  // Sync toolbar button active state with initial panel visibility
  if (gallerySummaryPanelEl?.style.display !== 'none' && btnLotFindings) {
    setActive(btnLotFindings, true);
  }

  const placement = summaryPanelOpts?.placement ?? 'right';
  if (placement === 'left') {
    if (gallerySummaryPanelEl) bodyEl.appendChild(gallerySummaryPanelEl);
    bodyEl.appendChild(gridEl);
  } else {
    bodyEl.appendChild(gridEl);
    if (gallerySummaryPanelEl) bodyEl.appendChild(gallerySummaryPanelEl);
  }

  container.appendChild(barEl);
  container.appendChild(legendEl);
  container.appendChild(bodyEl);

  // ── Bin legend ─────────────────────────────────────────────────────────────

  function rebuildLegend(): void {
    legendEl.innerHTML = '';
    const mode = sharedOpts.plotMode ?? 'hardBin';

    if (!BIN_LEGEND_MODES.has(mode)) {
      legendEl.style.display = 'none';
      return;
    }

    // Collect unique bins — use hbin or sbin depending on active mode.
    const binSet = new Set<number>();
    for (const item of currentItems) {
      if (!item) continue;  // factory not yet resolved
      for (const die of item.dies) {
        if (die.partial) continue;
        const b = mode === 'softBin' ? die.sbin : die.hbin;
        if (b != null) binSet.add(b);
      }
    }

    const bins = [...binSet].sort((a, b) => a - b);
    if (!bins.length) {
      legendEl.style.display = 'none';
      return;
    }

    legendEl.style.display = 'flex';
    const scheme    = getColorScheme(sharedOpts.colorScheme);
    const activeBin = sharedOpts.highlightBin;
    // Hard and soft bins have independent number spaces — pick the correct defs for the active mode.
    // Collect from items (defs now live on WaferMapResult, not on sharedOpts).
    const itemDefs = mode === 'softBin'
      ? currentItems.flatMap(it => it?.sbinDefs ?? [])
      : currentItems.flatMap(it => it?.hbinDefs ?? []);
    // Deduplicate by bin number, first occurrence wins.
    const seenBins = new Set<number>();
    const activeDefs: BinDef[] = [];
    for (const d of itemDefs) {
      if (!seenBins.has(d.bin)) { seenBins.add(d.bin); activeDefs.push(d); }
    }
    const binDefMap = activeDefs.length > 0 ? new Map(activeDefs.map(d => [d.bin, d])) : null;

    for (const bin of bins) {
      const isActive = activeBin === bin;
      const binDef   = binDefMap?.get(bin);
      const entry = document.createElement('div');
      Object.assign(entry.style, {
        display:     'flex',
        alignItems:  'center',
        gap:         '5px',
        cursor:      'pointer',
        userSelect:  'none',
        padding:     '2px 4px',
        borderRadius: '3px',
      });

      const swatch = document.createElement('span');
      Object.assign(swatch.style, {
        display:      'inline-block',
        width:        '13px',
        height:       '13px',
        flexShrink:   '0',
        background:   (sharedOpts.colorScheme === 'custom' ? binDef?.color : undefined) ?? scheme.forBin(bin),
        border:       isActive ? '2px solid #1a66cc' : '1px solid #ccc',
        borderRadius: '2px',
        boxSizing:    'border-box',
      });

      const lbl = document.createElement('span');
      lbl.textContent = binDef?.name ? `${bin} · ${binDef.name}` : `Bin ${bin}`;
      Object.assign(lbl.style, {
        fontWeight: isActive ? '700' : '400',
        color:      isActive ? CLR.iconActive : '#444',
        whiteSpace: 'nowrap',
      });

      entry.appendChild(swatch);
      entry.appendChild(lbl);

      entry.addEventListener('mouseenter', () => {
        entry.style.background = CLR.bgHover;
      });
      entry.addEventListener('mouseleave', () => {
        entry.style.background = 'transparent';
      });
      entry.addEventListener('click', () => {
        const next = sharedOpts.highlightBin === bin ? undefined : bin;
        updateShared({ highlightBin: next });
      });

      legendEl.appendChild(entry);
    }
  }

  // ── Stacked-mode aggregation helpers ──────────────────────────────────────

  // Build lot-aggregated WaferMapDisplayItems from originalItems for a stacked mode.
  // One card per bin (stackedBins/stackedSoftBins) or per test parameter (stackedValues).
  function buildStackedItems(mode: PlotMode): WaferMapDisplayItem[] {
    const resolvedItems = originalItems.filter((it): it is WaferMapDisplayItem => it !== null);
    if (!resolvedItems.length) return [];
    const allDies   = resolvedItems.map(item => item.dies);
    const baseWafer = resolvedItems[0].wafer;
    const lotSize   = resolvedItems.length;

    // Wafer object for stacked analysis: strip the per-wafer 'wafer' identity field
    // (e.g. 'W01') so the summary panel doesn't claim this is a single wafer's data.
    // Lot-level fields (lot, product, etc.) are preserved for context.
    const stackedWafer = baseWafer.metadata
      ? { ...baseWafer, metadata: (({ wafer: _w, waferId: _id, ...rest }) => rest)(baseWafer.metadata as Record<string, unknown>) as typeof baseWafer.metadata }
      : baseWafer;

    // Patch isLotStack / aggregationMethod / lotSize onto a summary produced from
    // aggregated dies — analyzeWaferMap can't infer these from the die data alone.
    function asLotStackSummary(
      summary: import('../stats/types.js').StatsSummary,
      aggregationMethod: string,
    ): import('../stats/types.js').StatsSummary {
      return {
        ...summary,
        stats: { ...summary.stats, isLotStack: true, aggregationMethod, lotSize },
      };
    }

    if (mode === 'stackedValues') {
      // Collect testDefs from items (now on WaferMapResult, not sharedOpts).
      let defs = resolvedItems.find(it => it.testDefs?.length)?.testDefs;

      // If no testDefs on items, discover unique test numbers from the actual data
      if (!defs || defs.length === 0) {
        const uniqueNums = getUniqueTestNumbers(resolvedItems.flatMap(it => it.dies));

        defs = uniqueNums.map(tn => ({ testNumber: tn, name: `Test ${tn}` }));
      }

      const method = (sharedOpts.aggregationMethod ?? 'mean') as AggregationMethod;
      return defs.map(def => {
        const dies = aggregateValues(allDies, method, def.testNumber ?? def.index) as Die[];
        const cardTestDef = { index: 0, name: def.name, unit: def.unit };
        return {
          wafer: stackedWafer,
          dies,
          testDefs: [cardTestDef],
          label: `${def.name} · ${method}`,
          statsSummary: asLotStackSummary(
            analyzeWaferMap({ wafer: stackedWafer, dies, testDefs: [cardTestDef] }, { testNumbers: [0] }),
            method,
          ),
        };
      });
    }

    if (mode === 'stackedBins') {
      let defs = deduplicateDefs(resolvedItems.flatMap(it => it.hbinDefs ?? []));
      if (!defs || defs.length === 0) {
        const uniqueBins = [...new Set(resolvedItems.flatMap(it =>
          it.dies.map(d => d.hbin).filter((b): b is number => b != null)
        ))].sort((a, b) => a - b);
        defs = uniqueBins.map(b => ({ bin: b, name: `Bin ${b}` }));
      }

      return defs.map(def => {
        const dies = aggregateBinCounts(allDies, def.bin, 'hard') as Die[];
        const itemHbinDefs = [{ bin: def.bin, name: def.name }];
        return {
          wafer: stackedWafer,
          dies,
          hbinDefs: itemHbinDefs,
          label: `${def.bin} · ${def.name}`,
          statsSummary: asLotStackSummary(
            analyzeWaferMap({ wafer: stackedWafer, dies, hbinDefs: itemHbinDefs }),
            'countBin',
          ),
        };
      });
    }

    if (mode === 'stackedSoftBins') {
      let defs = deduplicateDefs(resolvedItems.flatMap(it => it.sbinDefs ?? []));
      if (!defs || defs.length === 0) {
        const uniqueBins = [...new Set(resolvedItems.flatMap(it =>
          it.dies.map(d => d.sbin).filter((b): b is number => b != null)
        ))].sort((a, b) => a - b);
        defs = uniqueBins.map(b => ({ bin: b, name: `Bin ${b}` }));
      }

      return defs.map(def => {
        const dies = aggregateBinCounts(allDies, def.bin, 'soft') as Die[];
        const itemSbinDefs = [{ bin: def.bin, name: def.name }];
        return {
          wafer: stackedWafer,
          dies,
          sbinDefs: itemSbinDefs,
          label: `${def.bin} · ${def.name}`,
          statsSummary: asLotStackSummary(
            analyzeWaferMap({ wafer: stackedWafer, dies, sbinDefs: itemSbinDefs }),
            'countBin',
          ),
        };
      });
    }

    return resolvedItems;
  }

  // Extra shared options required for stacked modes (colour scale / lot size metadata).
  function stackedSharedOpts(mode: PlotMode): Partial<WaferViewOptions> {
    const lotSize = originalItems.length;
    if (mode === 'stackedBins' || mode === 'stackedSoftBins')
      return { valueRange: [0, lotSize] as [number, number], lotSize };
    if (mode === 'stackedValues')
      return { aggregationMethod: (sharedOpts.aggregationMethod ?? 'mean') as AggregationMethod, valueRange: undefined, lotSize: undefined };
    return {};
  }

  // ── Shared option sync ─────────────────────────────────────────────────────

  // Called from toolbar interactions — updates state, handles stacked-mode card rebuilds,
  // propagates to cards, fires callback.
  // fireCallback=true (default) fires onViewOptionsChange — used for toolbar interactions.
  // fireCallback=false is used by the public setOptions API to avoid re-entrant callbacks.
  const BIN_SCHEMES = new Set(['default', 'accessible', 'custom']);

  function updateShared(partial: Partial<WaferViewOptions>, { fireCallback = true } = {}): void {
    const prevMode = sharedOpts.plotMode;
    sharedOpts = { ...sharedOpts, ...partial };
    const newMode    = sharedOpts.plotMode!;
    const nowStacked = STACKED_MODES.has(newMode);
    const wasStacked = prevMode !== undefined && STACKED_MODES.has(prevMode);
    const hasPendingFactories = cardControllers.some(ctrl => ctrl === null);

    // Switching into a bin mode: reset to default if scheme is not bin-compatible.
    if (partial.plotMode !== undefined && partial.plotMode !== prevMode) {
      const isBinMode = newMode === 'hardBin' || newMode === 'softBin';
      if (isBinMode && !BIN_SCHEMES.has(sharedOpts.colorScheme ?? '')) {
        sharedOpts = { ...sharedOpts, colorScheme: 'default' };
      }
    }

    if (partial.plotMode !== undefined) {
      if (nowStacked) {
        // Switching into a stacked mode — aggregate immediately unless some
        // factory-backed cards are still resolving, in which case keep the raw
        // gallery alive and let the final factory resolve promote it.
        const extra = stackedSharedOpts(newMode);
        sharedOpts = { ...sharedOpts, ...extra };
        if (hasPendingFactories) {
          for (const ctrl of cardControllers) if (ctrl) ctrl.setOptions(partial);
        } else {
          buildCards(buildStackedItems(newMode));
        }
      } else if (wasStacked) {
        // Clear stacked-specific options when leaving stacked mode
        const { valueRange, lotSize, aggregationMethod, ...cleanOpts } = sharedOpts;
        sharedOpts = cleanOpts;
        if (hasPendingFactories) {
          for (const ctrl of cardControllers) if (ctrl) ctrl.setOptions(partial);
        } else {
          buildCards(originalItems.filter((it): it is WaferMapDisplayItem => it !== null));
        }
      } else {
        for (const ctrl of cardControllers) if (ctrl) ctrl.setOptions(partial);
      }
    } else if (partial.aggregationMethod !== undefined && newMode === 'stackedValues') {
      // Aggregation method changed while in stackedValues — re-aggregate.
      if (hasPendingFactories) {
        for (const ctrl of cardControllers) if (ctrl) ctrl.setOptions(partial);
      } else {
        buildCards(buildStackedItems('stackedValues'));
      }
    } else {
      for (const ctrl of cardControllers) if (ctrl) ctrl.setOptions(partial);
    }

    rebuildLegend();
    syncAggrMethodBtn();
    syncLegendStyleBtn();
    const modeChanged = partial.plotMode !== undefined && partial.plotMode !== prevMode;
    if (partial.colorScheme !== undefined || modeChanged) renderGallerySummaryPanel();
    if (fireCallback) {
      syncLogScaleBtn();
      const changed = Object.keys(partial) as (keyof WaferViewOptions)[];
      options.onViewOptionsChange?.(sharedOpts, changed, classifyChanged(changed));
    }
  }

  // ── Card building ──────────────────────────────────────────────────────────

  function buildCard(item: WaferMapDisplayItem, cardIndex: number, _totalItems: number): { card: HTMLDivElement; ctrl: WaferMapController; canvasWrapper: HTMLDivElement } {
    const card = document.createElement('div');
    card.className = 'wmap-gallery-card';
    Object.assign(card.style, {
      background:    '#fff',
      border:        `1px solid #e2e5ea`,
      borderRadius:  '10px',
      overflow:      'hidden',
      display:       'flex',
      flexDirection: 'column',
      position:      'relative',
      aspectRatio:   '1',
    });

    const header = document.createElement('div');
    Object.assign(header.style, {
      display:        'flex',
      alignItems:     'center',
      padding:        '8px 10px 6px',
      borderBottom:   '1px solid #e2e5ea',
      flexShrink:     '0',
      gap:            '6px',
    });
    const labelEl = document.createElement('span');
    labelEl.textContent = item.label ?? '';
    Object.assign(labelEl.style, { fontWeight: '700', fontSize: '13px', flex: '1' });
    header.appendChild(labelEl);

    // Expand button — the only affordance that opens the modal.
    const expandBtn = document.createElement('button');
    expandBtn.dataset.wmapExpandBtn = '1';
    expandBtn.title = 'Open full view';
    expandBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>`;
    Object.assign(expandBtn.style, {
      display:         'flex',
      alignItems:      'center',
      justifyContent:  'center',
      border:          '1px solid #d1d5db',
      borderRadius:    '4px',
      background:      '#f9fafb',
      color:           '#6b7280',
      padding:         '2px',
      cursor:          'pointer',
      flexShrink:      '0',
      width:           '22px',
      height:          '22px',
    });
    header.appendChild(expandBtn);
    card.appendChild(header);

    // Container div for renderWaferMap — the function creates the canvas inside it.
    const canvasWrapper = document.createElement('div');
    Object.assign(canvasWrapper.style, {
      position:      'relative',
      flex:          '1',
      minHeight:     '0',
      overflow:      'hidden',
      display:       'flex',
      flexDirection: 'column',
    });
    card.appendChild(canvasWrapper);

    // Append to DOM before renderWaferMap so the canvas has a resolved CSS
    // layout size when the initial render() fires — avoids a zero-size first
    // render that the ResizeObserver would otherwise need to correct.
    gridEl.appendChild(card);

    const ctrl = renderWaferMap(canvasWrapper, item as import('../renderer/buildWaferMap.js').WaferMapResult, {
      viewOptions:    item.viewOptions ? { ...sharedOpts, ...item.viewOptions } : sharedOpts,
      toolbarControls: 'full',
      showTooltip:     true,
      padding:         cardPadding,
      legendPosition:  currentLegendStyle,
      fallbackFormat:  currentFallbackFormat,
      statsSummary:    item.statsSummary,
      onClick:         item.onClick,
      onSelect:        item.onSelect,
    });
    // In-gallery: hide scene controls (gallery bar owns them) and findings button.
    ctrl.setViewControlsVisible(false);
    ctrl.setFindingsVisible(false);

    // Only the expand button opens the modal — canvas clicks are handled
    // internally by renderWaferMap and stop propagation before reaching here.
    expandBtn.addEventListener('click', () => openModalForCard(cardIndex, item));

    return { card, ctrl, canvasWrapper };
  }

  function buildCards(newItems: Array<WaferMapDisplayItem | WaferMapDisplayItemFactory>): void {
    getOpenMenu()?.remove(); setOpenMenu(null);
    clearLotFindingHighlight();
    currentItems = [];
    for (const ctrl of cardControllers) if (ctrl) ctrl.destroy();
    cardControllers = [];
    cardContainers = [];
    gridEl.innerHTML = '';

    currentItemCount = newItems.length;
    // Size columns from pre-built items; factories will update after resolution.
    applyGridColumns(newItems.map(it => (typeof it === 'function' ? null : it)));

    // Separate pre-built items from factories.
    const factories: Array<{ index: number; factory: WaferMapDisplayItemFactory; placeholder: HTMLDivElement }> = [];

    for (let i = 0; i < newItems.length; i++) {
      const entry = newItems[i];
      if (typeof entry === 'function') {
        // Insert a sized placeholder so the grid layout doesn't collapse.
        const placeholder = document.createElement('div');
        placeholder.className = 'wmap-gallery-card';
        Object.assign(placeholder.style, {
          background:    '#fff',
          border:        `1px solid #e2e5ea`,
          borderRadius:  '10px',
          aspectRatio:   '1',
          display:       'flex',
          alignItems:    'center',
          justifyContent:'center',
        });
        const spinner = document.createElement('span');
        spinner.textContent = '…';
        Object.assign(spinner.style, { color: '#bbb', fontSize: '18px' });
        placeholder.appendChild(spinner);
        gridEl.appendChild(placeholder);
        currentItems.push(null as unknown as WaferMapDisplayItem); // slot reserved
        cardControllers.push(null as unknown as WaferMapController);
        cardContainers.push(null as unknown as HTMLDivElement);
        factories.push({ index: i, factory: entry, placeholder });
      } else {
        const { ctrl, canvasWrapper } = buildCard(entry, i, newItems.length);
        currentItems.push(entry);
        cardControllers.push(ctrl);
        cardContainers.push(canvasWrapper);
      }
    }

    // Set 'custom' scheme if items have bin def colours and no explicit scheme was passed.
    const allDefs = currentItems.flatMap(it => it ? [...(it.hbinDefs ?? []), ...(it.sbinDefs ?? [])] : []);
    if (allDefs.some(d => d.color) && !options.viewOptions?.colorScheme) {
      sharedOpts = { ...sharedOpts, colorScheme: 'custom' };
    }

    // All sync items are now in currentItems — legend can be built from them.
    rebuildLegend();

    // Resolve factories one per task to keep the main thread responsive.
    // Capture the generation at the time buildCards was called — if buildCards runs
    // again (mode switch, destroy) the generation increments and stale callbacks bail out.
    const generation = ++buildGeneration;
    let fi = 0;
    function resolveNext(): void {
      if (generation !== buildGeneration) return; // stale — gallery was rebuilt or destroyed
      if (fi >= factories.length) {
        if (STACKED_MODES.has(sharedOpts.plotMode!)) {
          const mode = sharedOpts.plotMode!;
          buildCards(buildStackedItems(mode));
        }
        return;
      }
      const { index, factory, placeholder } = factories[fi++];
      const item = factory();
      currentItems[index] = item;
      originalItems[index] = item;
      applyGridColumns([item]);
      const { card, ctrl, canvasWrapper } = buildCard(item, index, newItems.length);
      cardControllers[index] = ctrl;
      cardContainers[index] = canvasWrapper;
      placeholder.replaceWith(card);
      rebuildLegend();
      // If this item introduced per-wafer findings and no panel exists yet, create it now.
      if (!gallerySummaryPanelEl && !summaryPanelOpts?.placement && item.statsSummary?.findings.length) {
        if (!currentLotStats) gallerySummaryTab = 'wafers';
        gallerySummaryPanelEl = createSummaryPanelEl('right');
        gallerySummaryPanelEl.style.maxHeight = 'calc(100vh - 80px)';
        gallerySummaryPanelEl.style.position  = 'sticky';
        gallerySummaryPanelEl.style.top       = '8px';
        gallerySummaryPanelEl.style.flexDirection = 'column';
        gallerySummaryPanelEl.style.display   = 'none';
        const placement = summaryPanelOpts?.placement ?? 'right';
        if (placement === 'left') {
          bodyEl.insertBefore(gallerySummaryPanelEl, gridEl);
        } else {
          bodyEl.appendChild(gallerySummaryPanelEl);
        }
        // Initial render into the hidden panel so content is ready when opened.
        renderGallerySummaryPanel();
        // Create the toolbar button if not already present.
        if (!btnLotFindings) {
          btnLotFindings = makeBtn('findings', 'Summary panel', () => {
            if (!gallerySummaryPanelEl) return;
            const isOpen = gallerySummaryPanelEl.style.display !== 'none';
            // Re-render on open so the index reflects all items resolved so far.
            if (!isOpen) renderGallerySummaryPanel();
            gallerySummaryPanelEl.style.display = isOpen ? 'none' : 'flex';
            setActive(btnLotFindings!, !isOpen);
            refreshLotFindingsButton();
          });
          barEl.appendChild(makeSep());
          barEl.appendChild(btnLotFindings);
        }
        refreshLotFindingsButton();
      } else if (gallerySummaryPanelEl && gallerySummaryPanelEl.style.display !== 'none') {
        // Panel is open — refresh the index to show newly resolved items.
        renderGallerySummaryPanel();
      }
      refreshLotFindingsButton();
      setTimeout(resolveNext, 0);
    }
    if (factories.length > 0) setTimeout(resolveNext, 0);
  }

  // Pre-populate originalItems with resolved items (factories fill slots as they run).
  originalItems = items.map(it => (typeof it === 'function' ? null : it) as WaferMapDisplayItem);
  // If the initial plotMode is already a stacked mode, aggregate immediately.
  if (STACKED_MODES.has(sharedOpts.plotMode!) && originalItems.length > 0) {
    const extra = stackedSharedOpts(sharedOpts.plotMode!);
    sharedOpts = { ...sharedOpts, ...extra };
    buildCards(buildStackedItems(sharedOpts.plotMode!));
  } else {
    buildCards(items);
  }

  // Recompute column count when the gallery body width changes (window resize,
  // summary panel open/close, etc.). Only active in auto mode (currentColumns == null).
  const gridResizeObserver = new ResizeObserver(() => {
    if (currentColumns == null) applyGridTemplate();
  });
  gridResizeObserver.observe(bodyEl);
  gridResizeObserver.observe(container);

  // Initial gallery summary panel render
  if (gallerySummaryPanelEl) renderGallerySummaryPanel();

  // ── Modal ──────────────────────────────────────────────────────────────────

  function openModalForCard(cardIndex: number, item: WaferMapDisplayItem): void {
    if (modalReparentedContainer) closeModal();

    const cardContainer = cardContainers[cardIndex];
    if (!cardContainer) return;

    modalReparentedParent    = cardContainer.parentElement as HTMLElement;
    modalReparentedContainer = cardContainer;
    modalCardIndex           = cardIndex;

    cardControllers[cardIndex]?.setViewControlsVisible(true);
    cardControllers[cardIndex]?.setFindingsVisible(true);
    cardControllers[cardIndex]?.setExpandVisible(false);
    cardControllers[cardIndex]?.resetZoom();
    applyCardHighlight([cardIndex]);

    const handle = openModal({
      title: item.label ?? '',
      onFullscreenChange: (isFs, box) => {
        cardControllers[modalCardIndex]?.setTooltipParent(isFs ? box : document.body);
      },
      onClose: () => {
        modalHandleGallery = null;
        closeModal();
      },
    });

    modalHandleGallery = handle;
    handle.contentWrap.style.flexDirection = 'column';
    handle.contentWrap.appendChild(cardContainer);
  }

  function closeModal(): void {
    if (!modalReparentedContainer) return;
    // If the modal handle is still live (caller-initiated close, not from onClose),
    // route through handle.close() so listeners and scroll lock are cleaned up.
    if (modalHandleGallery) {
      const h = modalHandleGallery;
      modalHandleGallery = null;
      h.close();
      return;
    }
    if (modalReparentedParent) {
      modalReparentedParent.appendChild(modalReparentedContainer);
      modalReparentedParent = null;
    }
    cardControllers[modalCardIndex]?.setViewControlsVisible(false);
    cardControllers[modalCardIndex]?.setFindingsVisible(false);
    cardControllers[modalCardIndex]?.closeSummaryPanel();
    cardControllers[modalCardIndex]?.setExpandVisible(true);
    cardControllers[modalCardIndex]?.resetZoom();
    modalCardIndex           = -1;
    modalReparentedContainer = null;
  }

  // ── Gallery PNG download ───────────────────────────────────────────────────

  function downloadGalleryPng(): void {
    const canvases = [...gridEl.querySelectorAll<HTMLCanvasElement>('canvas')];
    if (!canvases.length) return;
    const N      = canvases.length;
    const cols   = Math.ceil(Math.sqrt(N));
    const rows   = Math.ceil(N / cols);
    const cellW  = canvases[0].width;
    const cellH  = canvases[0].height;
    const gap    = 8;
    const dpr    = window.devicePixelRatio || 1;
    const headerH = Math.round(26 * dpr);
    const fontSize = Math.round(12 * dpr);
    const off   = document.createElement('canvas');
    off.width   = cols * cellW + (cols - 1) * gap;
    off.height  = rows * (cellH + headerH) + (rows - 1) * gap;
    const ctx   = off.getContext('2d')!;
    ctx.fillStyle = '#f0f2f5';
    ctx.fillRect(0, 0, off.width, off.height);
    canvases.forEach((c, i) => {
      const col   = i % cols;
      const row   = Math.floor(i / cols);
      const x     = col * (cellW + gap);
      const y     = row * (cellH + headerH + gap);
      const label = c.closest('.wmap-gallery-card')?.querySelector<HTMLElement>('span')?.textContent ?? '';
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(x, y, cellW, headerH);
      ctx.fillStyle = '#1a1a2e';
      ctx.font      = `700 ${fontSize}px system-ui, sans-serif`;
      ctx.textAlign    = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, x + Math.round(10 * dpr), y + headerH / 2, cellW - Math.round(20 * dpr));
      ctx.drawImage(c, x, y + headerH);
    });
    off.toBlob(blob => {
      if (!blob) return;
      saveImageBlob(blob, downloadFilename, options.onSaveImage);
    });
  }

  // ── Controller ─────────────────────────────────────────────────────────────

  return {
    setItems(newItems: Array<WaferMapDisplayItem | WaferMapDisplayItemFactory>): void {
      originalItems = newItems.map(it => (typeof it === 'function' ? null : it) as WaferMapDisplayItem);
      const mode = sharedOpts.plotMode!;
      if (STACKED_MODES.has(mode)) {
        // If factories are still pending, keep the raw gallery build alive and let
        // the final factory resolution promote the gallery into stacked mode.
        const hasPendingFactories = newItems.some(it => typeof it === 'function');
        if (hasPendingFactories) {
          buildCards(newItems);
        } else {
          // Refresh lotSize and valueRange in case the wafer count changed.
          const extra = stackedSharedOpts(mode);
          sharedOpts = { ...sharedOpts, ...extra };
          buildCards(buildStackedItems(mode));
        }
      } else {
        buildCards(newItems);
      }
    },

    setOptions(partial: Partial<WaferViewOptions>): void {
      updateShared(partial, { fireCallback: false });
    },

    getOptions(): WaferViewOptions {
      return { ...sharedOpts };
    },

    setFallbackFormat(format: 'si' | 'engineering'): void {
      currentFallbackFormat = format;
      for (const ctrl of cardControllers) if (ctrl) ctrl.setFallbackFormat(format);
    },

    setLotStatsSummary(summary: LotStatsSummary | undefined): void {
      currentLotStats = summary;
      if (gallerySummaryPanelEl) renderGallerySummaryPanel();
      refreshLotFindingsButton();
    },

    setColumns(cols: number | undefined): void {
      setColumnsState(cols);
    },

    destroy(): void {
      buildGeneration++; // cancel any pending factory resolvers
      closeModal();
      for (const ctrl of cardControllers) if (ctrl) ctrl.destroy();
      cardControllers = [];
      getOpenMenu()?.remove();
      gridResizeObserver.disconnect();
      document.removeEventListener('click', closeOpenMenu, true);
      tooltip.remove();
      barEl.remove();
      legendEl.remove();
      bodyEl.remove();
      gallerySummaryPanelEl?.remove();
    },
  };
}
