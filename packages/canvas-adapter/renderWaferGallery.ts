import type { PlotMode } from '../renderer/buildView.js';
import { getUniqueTestNumbers, resolveTestNumber, findTestDef } from '../renderer/buildView.js';
import { getColorScheme } from '../renderer/colorSchemes.js';
import { resolveCanvasTheme } from './canvasTheme.js';
import { ICONS } from './icons.js';
import { CLR, ROTATIONS, MODE_LABELS, BIN_LEGEND_MODES, STACKED_MODES, Z_ABOVE, applyOverlayZ, getTooltip, hideTooltip, createToolbarHelpers, buildModeMenuEl, openDetachWindow, openFloatingWindow, openModal, copyWmapThemeTokens, syncWmapPopupTheme, openUserGuideWindow, makePaletteBtn, makeLogScaleBtn, makeLegendStyleBtn, makeOverlaysBtn, makeOrientationBtn, saveImageBlob, markMenuTrigger, wireMenuA11y, wireExpandToggle, passFailMenuRows, requestedPassFailDisplay, type ModeEntry, type SaveImageHandler, type SaveTextHandler, type CheckMenuRow, type UserGuideExtension, type OverlayHandle } from './toolbar.js';
import type { Die } from '../core/dies.js';
import { aggregateValues, aggregateBinCounts } from '../core/aggregates.js';
import type { AggregationMethod } from '../core/aggregates.js';
import { renderWaferMap } from './renderWaferMap.js';
import type { WaferViewOptions, WaferMapController } from './renderWaferMap.js';
import { classifyChanged } from './renderWaferMap.js';
import type { BinDef } from '../renderer/buildWaferMap.js';
import { buildWaferMap, dieHasTestData, getTestPassStatus, isParametricTest } from '../renderer/buildWaferMap.js';
import type { LotStatsSummary, StatsFinding, StatsSummary } from '../stats/types.js';
import { analyzeWaferMap } from '../stats/analyzeWaferMap.js';
import type { SummaryPanelOptions } from './summaryPanel.js';
import { createSummaryPanelEl, buildMetadataStripRow, buildCompactMetadataRows, metadataEntries, renderLotSummaryContent } from './summaryPanel.js';
import type { FindingsFilter } from '../stats/filterFindings.js';
import { openHtmlReport } from '../stats/renderFindingsReport.js';
import { escHtml, renderSection, renderSeverityBadge, reportStyles } from '../stats/reportHtml.js';
import { createInsightsTab, type InsightsOptions } from './insightsTab.js';

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

  // Lot-stack context carried from buildWaferMap (or set by the gallery on synthetic stacked
  // cards). Drives the map title's "(N wafers · method)" qualifier so a stacked card is
  // self-identifying. Undefined for single-wafer cards.
  isLotStack?: boolean;
  aggrMethod?: string;
  lotSize?:    number;

  // Per-card display overrides.
  label?:        string;
  /** Merged on top of the shared gallery options for this card only. */
  viewOptions?:  Partial<WaferViewOptions>;
  /** Shown in the findings panel when this card is opened in its own window. */
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
   * Host hook for saving the Summary/Insights test-values table's "Export CSV"
   * button. Mirrors `onSaveImage` — when provided, called with
   * `(text, suggestedName, mimeType)` instead of triggering a browser
   * `<a download>` (a silent no-op in Tauri/Electron/WebView2). When omitted,
   * the default browser download behaviour is unchanged.
   */
  onSaveText?:           SaveTextHandler;
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
   * Options for the always-available Summary panel alongside the gallery
   * grid — a "Lot" tab with full lot-level stats (metadata, yield, bin
   * breakdown, ring/quadrant yield, test values, findings) and a combined
   * Report button, plus a "Wafers" tab listing every wafer that has its own
   * per-wafer findings (click a row to open that wafer). Independent of
   * `insights` below: this always shows/hides its own toolbar button
   * regardless of whether Insights is open, since Insights has no per-wafer
   * map for a finding to highlight against.
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
  /**
   * Host-supplied content inserted into the built-in end-user guide window
   * (see `showHelpButton`) — e.g. a host app's own documentation, so the user
   * has one help button instead of two. See `UserGuideExtension`.
   */
  userGuideExtension?:     UserGuideExtension;
  /**
   * Base `z-index` for wmap's transient overlays — toolbar menus, the die
   * tooltip, the expand modal, and the user-guide modal. wmap layers its own
   * overlays from this value upward. Set this when embedding the gallery inside
   * your own modal/overlay so wmap's menus and tooltips appear above it.
   *
   * Omit it and wmap defaults overlays to a high value (above typical app modal
   * layers). Applied for the lifetime of this render and restored on `destroy()`.
   */
  zIndex?:                 number;
  /**
   * Show an "Insights" tab in the control bar (see `InsightsOptions`).
   * Selecting it replaces the gallery grid with wmap's own chart suite
   * across Overview/Distributions/Correlation sub-tabs. The tab computes
   * its own "Group by" facets from each item's `wafer.metadata`
   * (`stats/facets.ts`) and, when `lotStatsSummary` is also provided,
   * reuses its precomputed per-wafer yield directly rather than
   * recomputing it — no other host wiring beyond this option.
   */
  insights?:               InsightsOptions;
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
  /** Replace the lot-level stats summary used by the built-in Summary panel. */
  setLotStatsSummary(summary: LotStatsSummary | undefined): void;
  /**
   * Set the number of columns in the gallery grid. Pass `undefined` to restore
   * the auto-computed layout based on die pitch.
   */
  setColumns(columns: number | undefined): void;
  /**
   * Opens the built-in end-user guide window — the same action the help
   * toolbar button performs, but callable directly. Works regardless of
   * `showHelpButton`'s current value, so a host that hides wmap's own help
   * button (e.g. to fold it into its own combined help menu) can still
   * trigger the guide without a DOM query against wmap's internal button
   * markup.
   */
  openUserGuide(): void;
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
  const userGuideExtension   = options.userGuideExtension;
  const insightsEnabled      = options.insights?.enabled ?? false;
  // Host-supplied overlay stacking (no-op when undefined; safe high default
  // applies). Restored on destroy() via the returned disposer.
  const disposeOverlayZ      = applyOverlayZ(options.zIndex);
  const summaryPanelOpts      = options.summaryPanel;
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

  let cardControllers: (WaferMapController | null)[] = [];
  let cardContainers: HTMLDivElement[] = [];      // canvasWrapper per card
  let cardExpandBtns: HTMLButtonElement[] = [];   // per-card header button — toggles expand/reattach
  let currentItems:  WaferMapDisplayItem[] = [];
  // Per-wafer source items; null = factory not yet resolved. Populated from `items`
  // immediately (not lazily before buildCards) so findings-gated UI decided during
  // this function's own setup — e.g. the Lot Summary button/panel's "any item
  // carries per-wafer findings" check below — sees real data for plain (non-factory)
  // items instead of an empty array that hasn't been filled in yet.
  let originalItems: (WaferMapDisplayItem | null)[] =
    items.map(it => (typeof it === 'function' ? null : it) as WaferMapDisplayItem);
  let buildGeneration = 0;  // incremented on each buildCards call; stale factory callbacks check this
  // Tracked separately from `cardControllers` containing nulls, since a detached
  // card's controller is ALSO null (its live view is in a popup window instead)
  // — conflating the two would make updateShared() think a factory is still
  // resolving whenever any card is merely detached, silently skipping the
  // immediate stacked-mode rebuild it should otherwise take.
  let pendingFactoryCount = 0;

  // A card can be detached into its own real OS window (via window.open, or a
  // host-registered opener — see setDetachWindowOpener) rather than an in-page
  // div, so it can be dragged outside the host browser/Tauri window's own
  // bounds. Several may be open at once, so state is keyed by a generated
  // window id rather than by card index (indices shift whenever buildCards()
  // rebuilds the grid, e.g. on a stacked-mode transition). The popup's
  // controller is a FRESH renderWaferMap() instance (not the grid card's
  // original one) — the grid slot's own controller is destroyed at detach time
  // and only rebuilt on reattach, so exactly one live controller ever exists
  // for a given wafer at a time.
  interface DetachedWindow {
    id: number;
    ctrl: WaferMapController;      // live controller rendered inside the detached document
    close: () => void;            // tears down the window/floating box and calls handlePopupClosed
    closePollId: ReturnType<typeof setInterval> | null; // real popup only — null for the in-page fallback
    setTitle: (text: string) => void; // updates whatever "title" this detach target has (OS title, or an in-page header)
    // null once buildCards() can no longer place this window's card in the
    // rebuilt grid ("unlinked") — this is the single source of truth for that
    // state; there is deliberately no separate boolean flag, since one would
    // only ever duplicate what cardIndex's null-ness already says.
    cardIndex: number | null;
    label: string;
    // Real popup only (separate document, one-time theme-token copy) — tears
    // down the observer/listener that keep it in sync with later host theme
    // changes. Undefined for the in-page floating-window fallback, which
    // shares the host's own document and so inherits --wmap-* changes live.
    stopThemeSync?: () => void;
  }
  const detachedWindows = new Map<number, DetachedWindow>();
  let nextWindowId = 0;


  let btnLotSummary: HTMLButtonElement | null = null;
  let activeLotFindingId: string | null = null;
  // Finding-highlight state: indices of cards implicated by the summary-panel
  // finding the user is currently inspecting (outlined until they clear it).
  let findingHighlightIndices = new Set<number>();

  // Findings sidebar state
  let gallerySummaryPanelEl: HTMLDivElement | null = null;
  // 'lot' = lot-level findings (requires currentLotStats)
  // 'wafers' = per-wafer findings index (requires items with statsSummary)
  let gallerySummaryTab: 'lot' | 'wafers' = 'lot';
  let lotFindingsFilter: FindingsFilter = {};

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

  // Shared document-level singleton tooltip (toolbar.ts) — the same node every
  // card's renderWaferMap uses, so only one tooltip is ever visible at a time.
  const tooltip = getTooltip();
  const tbHelpers = createToolbarHelpers(tooltip);
  const { makeBtn, setActive, makeSep, makeMenuRow, makeMenuSection, makeDropdown, makeCheckMenuBtn, closeOpenMenu, getOpenMenu, setOpenMenu } = tbHelpers;
  document.addEventListener('click', closeOpenMenu, true);
  // Window focus loss (alt-tab / app switch, notably in a Tauri WebView) does
  // not fire mouseleave, which would leave a toolbar tooltip lingering visible.
  const onWindowBlur = () => hideTooltip();
  window.addEventListener('blur', onWindowBlur);

  function applyFindingHighlight(indices: number[]): void {
    findingHighlightIndices = new Set(indices);
    const cards = [...gridEl.querySelectorAll<HTMLElement>('.wmap-gallery-card')];
    let firstHighlighted: HTMLElement | undefined;
    cards.forEach((card, i) => {
      const active = findingHighlightIndices.has(i);
      card.style.outline       = active ? `3px solid ${CLR.findingHighlight}` : '';
      card.style.outlineOffset = active ? '-3px' : '';
      if (active && firstHighlighted === undefined) firstHighlighted = card;
    });
    firstHighlighted?.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' });
  }

  function clearFindingHighlight(): void {
    applyFindingHighlight([]);
  }

  function clearDieZoneHighlight(): void {
    for (const ctrl of cardControllers) if (ctrl) ctrl.clearSelection();
  }

  function applyDieZoneHighlight(dieKeys: string[], cardIndices?: number[]): void {
    const keySet = new Set(dieKeys);
    const targets = cardIndices ?? cardControllers.map((_, i) => i);
    for (const ci of targets) {
      const item = currentItems[ci];
      const ctrl = cardControllers[ci];
      if (!item || !ctrl) continue;
      const matched = item.dies.filter(d => keySet.has(`${d.x},${d.y}`));
      ctrl.setSelection(matched);
    }
  }

  // ── Gallery summary panel ──────────────────────────────────────────────────

  // Severity colour — matches summaryPanel.ts sevColor
  function gallerySevColor(s: 'unusual' | 'notable' | 'info'): string {
    return s === 'unusual' ? '#a84112' : s === 'notable' ? '#8a6500' : CLR.icon;
  }

  // Tab row shown when both lot stats and per-wafer findings are present.
  function buildPanelTabRow(): HTMLDivElement {
    const row = document.createElement('div');
    Object.assign(row.style, {
      display:       'flex',
      gap:           '4px',
      marginBottom:  '10px',
      borderBottom:  `1px solid ${CLR.menuBorder}`,
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
        color:        active ? CLR.iconHover : CLR.icon,
      });
      btn.addEventListener('click', () => {
        gallerySummaryTab = tab;
        clearFindingHighlight();
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
        border:       `1px solid ${CLR.menuBorder}`,
        borderRadius: '4px',
        padding:      '3px 8px',
        marginBottom: '10px',
        fontSize:     '10px',
        color:        CLR.iconHover,
        background:   'none',
        cursor:       'pointer',
        display:      'block',
        width:        '100%',
        textAlign:    'left',
      });
      reportBtn.addEventListener('click', () => {
        const title = `Findings report — ${wafersWithFindings.length} wafer${wafersWithFindings.length > 1 ? 's' : ''}`;
        const generatedAt = new Date().toLocaleString();
        const sections = wafersWithFindings
          .map(({ item, index }) => {
            const summary = perWaferSummary(index)!;
            const label = item.label ?? `W${index + 1}`;
            const rows = summary.findings.map(f =>
              `<li>${renderSeverityBadge(f.severity)} ${escHtml(f.summary)}</li>`,
            ).join('');
            return renderSection(escHtml(label), `<ul style="margin:0;padding-left:18px;list-style:none">${rows}</ul>`);
          }).join('\n');
        const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>${escHtml(title)}</title>
<style>
${reportStyles()}
</style>
</head>
<body>
<main class="report">
  <header class="report-header">
    <h1>${escHtml(title)}</h1>
    <p class="report-subtitle">Generated ${escHtml(generatedAt)}</p>
  </header>
  ${sections}
</main>
</body>
</html>`;
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
          background:     CLR.bgHover,
          cursor:         'pointer',
          fontSize:       '11px',
          textAlign:      'left',
          boxSizing:      'border-box',
        });
        row.addEventListener('mouseover', () => { row.style.background = CLR.bgActive; });
        row.addEventListener('mouseout',  () => { row.style.background = CLR.bgHover; });

        const labelSpan = document.createElement('span');
        labelSpan.textContent = item.label ?? `W${index + 1}`;
        Object.assign(labelSpan.style, {
          color:         CLR.iconHover,
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
        // Open this wafer in its own window — openWindowForCard already calls setSummaryVisible(true)
        row.addEventListener('click', () => openWindowForCard(index, item));
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
      // Lot-level view — full stats (metadata/yield/bin/ring/quadrant/test
      // values) plus findings and a combined Report button. Bin/ring/
      // quadrant/test numbers here and in the Insights tab's Overview
      // sub-tab intentionally read the same shared computation
      // (`buildRegionYieldData`, `StatsSummary.stats.*` — see
      // summaryPanel.ts's header comment), so the two surfaces can overlap
      // without ever disagreeing.
      const lotHbinDefs = deduplicateDefs(originalItems.flatMap(it => it?.hbinDefs ?? []));
      const lotSbinDefs = deduplicateDefs(originalItems.flatMap(it => it?.sbinDefs ?? []));
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
        activeFindingId: activeLotFindingId,
        findingsFilter: lotFindingsFilter,
        onFindingsFilterChange: renderGallerySummaryPanel,
        onSaveText: options.onSaveText,
        onFindingClick: (finding, row) => {
          if (activeLotFindingId === finding.id) {
            clearLotFindingHighlight();
          } else {
            applyLotFindingHighlight(finding, row);
          }
          renderGallerySummaryPanel();
        },
        onWaferClick: (waferIndex) => {
          applyFindingHighlight([waferIndex]);
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
    clearFindingHighlight();
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
    clearFindingHighlight();
    clearDieZoneHighlight();

    const h = finding.highlight;
    if (h.kind === 'wafer') {
      applyFindingHighlight(h.waferIndices);
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

  function refreshLotSummaryButton(): void {
    if (!btnLotSummary) return;
    const hasSummaryPanel = !!gallerySummaryPanelEl;
    btnLotSummary.style.display = ((currentLotStats || hasAnyPerWaferFindings()) && hasSummaryPanel && !insightsOpen) ? 'flex' : 'none';
    const panelOpen = gallerySummaryPanelEl
      ? gallerySummaryPanelEl.style.display !== 'none'
      : false;
    const hasNotable = currentLotStats?.hasNotableFindings
      || originalItems.some(it => it?.statsSummary?.hasNotableFindings);
    if (hasNotable && !panelOpen) {
      btnLotSummary.style.color = '#b7551a';
    } else if (!btnLotSummary.dataset.active) {
      btnLotSummary.style.color = CLR.icon;
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
    background:    CLR.menuBg,
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
    // Value mode is available for any per-test data — numeric values or recorded
    // pass/fail verdicts (functional tests). Stacked values need numeric values.
    const hasTestData = dies.some(dieHasTestData);
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
        // Leaving value mode → clear spec pass/fail (only valid in value mode), matching single-map.
        updateShared({ plotMode: entry.plotMode, activeTest: undefined, colorBySpec: false, passFailDisplay: 'off' });
      }
      menu.remove();
      setOpenMenu(null);
      markMenuTrigger(btnMode, false);
    }

    const testEntries: ModeEntry[] = hasTestData
      ? (testDefs?.length
          ? testDefs.map(t => ({
              plotMode: 'value' as PlotMode,
              activeTest: t.testNumber ?? t.index ?? 0,
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

  const btnPalette = makePaletteBtn(
    tbHelpers,
    () => sharedOpts.plotMode ?? 'hardBin',
    () => sharedOpts.colorScheme ?? 'default',
    itemsHaveCustomColors,
    v => updateShared({ colorScheme: v }),
  );

  const hasReticleInItems = items.some(it => typeof it !== 'function' && ((it as WaferMapDisplayItem).reticles?.length ?? 0) > 0);

  // Resolve the shared active test's def (the one all value cards show) — gates the
  // pass/fail display entries, the "Colorbar range" button, and the log-scale button,
  // mirroring single-map.
  function activeTestDefShared(): { testNumber: number; td: import('../renderer/buildWaferMap.js').TestDef | undefined } {
    const testDefs = originalItems.find(it => it?.testDefs?.length)?.testDefs;
    const { testNumber } = resolveTestNumber(sharedOpts.activeTest ?? 0, testDefs);
    return { testNumber, td: findTestDef(testDefs, testNumber) };
  }
  function activeTestHasLimits(): boolean {
    if ((sharedOpts.plotMode ?? 'hardBin') !== 'value') return false;
    const { td } = activeTestDefShared();
    return td !== undefined && (td.limitLow !== undefined || td.limitHigh !== undefined);
  }
  function activeTestIsFunctional(): boolean {
    if ((sharedOpts.plotMode ?? 'hardBin') !== 'value') return false;
    const { td } = activeTestDefShared();
    return td !== undefined && !isParametricTest(td);
  }
  function activeTestHasRecordedStatus(): boolean {
    if ((sharedOpts.plotMode ?? 'hardBin') !== 'value') return false;
    const { testNumber, td } = activeTestDefShared();
    return originalItems.some(it => it?.dies?.some(d => getTestPassStatus(d, testNumber, td) !== undefined));
  }

  const btnOverlays = makeOverlaysBtn(
    tbHelpers,
    (): CheckMenuRow[] => [
      { label: 'Ring boundaries', active: !!sharedOpts.showRingBoundaries,     onClick: () => updateShared({ showRingBoundaries:   !sharedOpts.showRingBoundaries   }) },
      { label: 'Quadrant lines',  active: !!sharedOpts.showQuadrantBoundaries, onClick: () => updateShared({ showQuadrantBoundaries: !sharedOpts.showQuadrantBoundaries }) },
      { label: 'Die labels',      active: !!sharedOpts.showDieLabels,          onClick: () => updateShared({ showDieLabels:          !sharedOpts.showDieLabels          }) },
      { label: 'Reticle grid',    active: !!sharedOpts.showReticle,            enabled: hasReticleInItems, onClick: () => updateShared({ showReticle: !sharedOpts.showReticle }) },
      { label: 'XY indicator',    active: !!sharedOpts.showXYIndicator,        onClick: () => updateShared({ showXYIndicator:        !sharedOpts.showXYIndicator        }) },
      ...passFailMenuRows(
        {
          functionalActive: activeTestIsFunctional(),
          hasLimits: activeTestHasLimits() && !activeTestIsFunctional(),
          hasRecorded: activeTestHasRecordedStatus() && !activeTestIsFunctional(),
          display: requestedPassFailDisplay(sharedOpts),
        },
        d => updateShared({ passFailDisplay: d, colorBySpec: false }),
      ),
    ],
    () => !!(sharedOpts.showRingBoundaries || sharedOpts.showQuadrantBoundaries ||
             sharedOpts.showDieLabels || sharedOpts.showReticle || sharedOpts.showXYIndicator ||
             requestedPassFailDisplay(sharedOpts) !== 'off'),
  );

  const { btn: btnLegendStyle, sync: syncLegendStyleBtn } = makeLegendStyleBtn(
    tbHelpers,
    () => ({ plotMode: sharedOpts.plotMode, legendPosition: currentLegendStyle }),
    (v) => {
      currentLegendStyle = v;
      for (const ctrl of cardControllers) if (ctrl) ctrl.setOptions({ legendPosition: currentLegendStyle });
    },
  );
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

  const { btn: btnLogScale, sync: syncLogScaleBtn } = makeLogScaleBtn(
    tbHelpers,
    () => ({ ...sharedOpts, functionalActive: activeTestIsFunctional() }),
    patch => updateShared(patch),
  );
  syncLogScaleBtn();

  // Colorbar range (spec limits ↔ data extents) — value mode only, when the active test has limits
  // and we are not colouring by spec pass/fail (where the bar is irrelevant). Mirrors single-map.
  const btnColorbarRange = makeBtn('specRange', 'Colorbar range: spec limits', () => {
    const next = sharedOpts.colorbarRangeMode === 'data' ? 'spec' : 'data';
    updateShared({ colorbarRangeMode: next });
  });
  function syncColorbarRangeBtn(): void {
    // No colorbar exists under a solid pass/fail display or a functional active test.
    const visible = (sharedOpts.plotMode ?? 'hardBin') === 'value' && activeTestHasLimits() &&
      requestedPassFailDisplay(sharedOpts) === 'off' && !activeTestIsFunctional();
    btnColorbarRange.style.display = visible ? '' : 'none';
    const isSpec = (sharedOpts.colorbarRangeMode ?? 'spec') === 'spec';
    setActive(btnColorbarRange, isSpec);
    btnColorbarRange.ariaLabel = isSpec
      ? 'Colorbar range: spec limits (click for data range)'
      : 'Colorbar range: data range (click for spec limits)';
  }
  syncColorbarRangeBtn();

  const btnOrient = makeOrientationBtn(
    tbHelpers,
    () => sharedOpts,
    patch => updateShared(patch),
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

  // Grid-view-specific controls (mode, palette, overlays, columns, download,
  // etc.) — wrapped so they can be hidden as a group while the Insights tab
  // is open, since none of them apply to (or, for download, would silently
  // capture the wrong thing from) the chart suite. Summary/Insights/Help
  // below stay unwrapped directly in barEl since those apply to both views.
  const galleryViewControlsEl = document.createElement('div');
  Object.assign(galleryViewControlsEl.style, { display: 'inline-flex', alignItems: 'center', gap: '0' });
  barEl.appendChild(galleryViewControlsEl);

  if (showPlotModeSelector) galleryViewControlsEl.appendChild(btnMode);
  galleryViewControlsEl.appendChild(btnPalette);
  galleryViewControlsEl.appendChild(btnAggrMethod);
  galleryViewControlsEl.appendChild(btnLogScale);
  galleryViewControlsEl.appendChild(btnColorbarRange);
  galleryViewControlsEl.appendChild(makeSep());
  galleryViewControlsEl.appendChild(btnOverlays);
  galleryViewControlsEl.appendChild(makeSep());
  galleryViewControlsEl.appendChild(btnLegendStyle);
  galleryViewControlsEl.appendChild(makeSep());
  galleryViewControlsEl.appendChild(btnOrient);
  galleryViewControlsEl.appendChild(makeSep());
  galleryViewControlsEl.appendChild(btnColumns);
  galleryViewControlsEl.appendChild(makeSep());
  galleryViewControlsEl.appendChild(btnDownloadAll);

  // Summary button — toggles the gallery Summary panel. Left unwrapped
  // in barEl (not grouped with galleryViewControlsEl), but still hidden
  // while Insights is open (refreshLotSummaryButton checks insightsOpen) —
  // its panel sits behind the Insights grid with no visible effect there,
  // matching every other view-specific control.
  // Shown when lotStatsSummary is provided, or when any item carries per-wafer findings.
  {
    if (currentLotStats || hasAnyPerWaferFindings()) {
      btnLotSummary = makeBtn('findings', 'Summary panel', () => {
        if (!gallerySummaryPanelEl) return;
        const isOpen = gallerySummaryPanelEl.style.display !== 'none';
        if (!isOpen) renderGallerySummaryPanel();
        gallerySummaryPanelEl.style.display = isOpen ? 'none' : 'flex';
        setActive(btnLotSummary!, !isOpen);
        refreshLotSummaryButton();
      });
      barEl.appendChild(makeSep());
      barEl.appendChild(btnLotSummary);
    }
  }

  // Insights tab — toggles between the gallery grid and wmap's own chart
  // suite. Mutually exclusive with the grid view (not just an overlay),
  // since the suite wants the full body's room, not a side panel.
  let btnInsights: HTMLButtonElement | null = null;
  if (insightsEnabled) {
    btnInsights = makeBtn('analysis', 'Insights', () => {
      const isOpen = insightsEl?.style.display !== 'none';
      setInsightsOpen(!isOpen);
    });
    barEl.appendChild(makeSep());
    barEl.appendChild(btnInsights);
  }

  // Help button — opens the end-user guide in a non-modal window (opt-in).
  // The button's click handler and the controller's own `openUserGuide()`
  // (below) both call this same function — a host can trigger the guide
  // programmatically (e.g. from its own combined help menu) whether or not
  // `showHelpButton` ever rendered a wmap toolbar button at all.
  function openGuideWindow(): void {
    import('./userGuideHtml.js').then(m => openUserGuideWindow(
      { buildWaferMap, renderWaferMap, renderWaferGallery, analyzeWaferMap },
      m.USER_GUIDE_HTML,
      userGuideExtension,
    ));
  }
  if (showHelpButton) {
    barEl.appendChild(makeSep());
    barEl.appendChild(makeBtn('help', 'User guide', () => openGuideWindow()));
  }

  // ── Bin legend strip ───────────────────────────────────────────────────────

  // Two independent pieces of content stack as separate lines (metadata, then
  // bin swatches) rather than sharing one wrapped flex row — metadata summaries
  // can themselves be long (several distinct-value lists), and mixing them with
  // bin swatches in one wrap made the whole strip read as a single jumbled line.
  const legendEl = document.createElement('div');
  Object.assign(legendEl.style, {
    display:       'flex',
    flexDirection: 'column',
    gap:           '6px',
    background:    CLR.menuBg,
    border:        `1px solid ${CLR.menuBorder}`,
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

  // ── Insights tab (opt-in) ────────────────────────────────────────────────────
  // Takes over the full body when active — swaps out the grid/summary panel
  // rather than sitting alongside them, since the chart suite wants the room.
  // First slice: a single Process capability panel plus a shared "Group by"
  // control (computed from each item's wafer.metadata — see stats/facets.ts).
  // More panels land incrementally; see tsmap's WMAP_ISSUES.md for the tracked
  // migration this is part of.
  //
  // Built only when `insightsEnabled` — mirrors `renderWaferMap.ts`'s own
  // gating, so a gallery with the feature off (the default) doesn't pay for
  // the chart suite's DOM/closures or keep a hidden host in the container.
  let insightsTab: ReturnType<typeof createInsightsTab> | null = null;
  let insightsEl: HTMLElement | null = null;
  if (insightsEnabled) {
    insightsTab = createInsightsTab({
      getItems: () => originalItems,
      getLotStats: () => currentLotStats,
      getColorSchemeName: () => sharedOpts.colorScheme ?? 'default',
      passBins,
      getRingCount: () => sharedOpts.ringCount ?? 4,
      defaultView: options.insights?.defaultView,
      // Leading "‹ Gallery" tab in the Insights tab bar — a visible way back
      // to the card grid, alongside the toolbar's icon toggle.
      backTab: { label: 'Gallery', onBack: () => setInsightsOpen(false) },
      // The gallery's own legend strip (rebuildLegend/legendEl) already shows
      // this metadata, via the same `buildMetadataStripRow` this tab's own
      // strip would use, and stays mounted above the grid/Insights body in
      // both views — this tab's own strip would just be a second, redundant
      // copy of identical content.
      showMetadataStrip: false,
      onSaveImage: options.onSaveImage,
      onSaveText: options.onSaveText,
      // Opens one wafer's full map in a modal, from a chart panel bar/row
      // click (yield's leaf rows, boxplot's leaf rows). Reuses
      // `buildDetachedController` (the same per-item render used for a card
      // detached into its own window) rather than a third way to turn a
      // `WaferMapDisplayItem` into a live map, and `openModal` (the same
      // primitive `openChartExpandModal` already uses for chart panels) for
      // the shell — no new overlay mechanism, just composing two that
      // already exist.
      // `testNumber` (from a boxplot leaf-row click) opens the map straight
      // into value mode on that same test, instead of always landing on
      // whatever plot mode the gallery currently shares — see
      // `buildDetachedController`'s own doc comment.
      openWafer: (waferIndex, title, testNumber) => {
        const item = originalItems[waferIndex];
        if (!item) return;
        let ctrl: WaferMapController | null = null;
        const handle = openModal({ title, onClose: () => ctrl?.destroy() });
        augmentOverlayTitleWithMetadata(handle, title, item.wafer.metadata ?? undefined);
        ctrl = buildDetachedController(handle.contentWrap, item, testNumber);
      },
    });
    insightsEl = insightsTab.el;
  }

  // Whether the Insights tab is currently showing — read by `rebuildLegend()`
  // so the shared metadata strip (`legendEl`) stays mounted in the same place
  // across both views instead of being a second, independent strip inside
  // Insights; only the bin-legend row (meaningless once the grid of cards is
  // replaced by the chart suite) is dropped when Insights is open.
  let insightsOpen = false;

  function setInsightsOpen(open: boolean): void {
    if (!insightsTab || !insightsEl) return;
    insightsOpen = open;
    insightsEl.style.display = open ? 'flex' : 'none';
    bodyEl.style.display = open ? 'none' : 'flex';
    galleryViewControlsEl.style.display = open ? 'none' : 'inline-flex';
    if (btnInsights) {
      setActive(btnInsights, open);
      // The icon itself signals the toggle: a bar-chart glyph means "open
      // Insights", a wafer glyph (while Insights is showing) means "back to
      // the gallery grid" — clicking Insights again is otherwise not
      // obvious as the way back, since the button's position never moves.
      btnInsights.innerHTML = open ? ICONS.wafer : ICONS.analysis;
      btnInsights.ariaLabel = open ? 'Back to gallery view' : 'Insights';
    }
    refreshLotSummaryButton();
    rebuildLegend();
    if (open) insightsTab.render();
  }

  // ── Grid container ─────────────────────────────────────────────────────────

  const TARGET_DIE_PX = 4;   // minimum readable die pixel size at gallery scale
  const MIN_CARD_PX   = 240; // absolute floor
  const MAX_CARD_PX   = 480; // cap to avoid monopolising width on dense grids
  // A card at the bare MIN floor is legible but cramped. When the container is
  // wide enough, auto packs more columns rather than inflating a few cards past
  // this comfortable width — using the available width instead of wasting it.
  const COMFORTABLE_CARD_FACTOR = 1.25;

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
    const containerW = gridEl.clientWidth || 0;

    // Start from a square-ish grid (sqrt(N) columns), then adjust to the
    // container width. Two guards, in priority order:
    //   1. never let a card fall below the readable floor (currentMinCardPx) —
    //      reduce columns if it would (more rows: cards get taller and wider);
    //   2. otherwise, when the container is wide enough that extra columns would
    //      still be comfortably sized, add columns so the width is used rather
    //      than inflating a few oversized cards. Capped at N (no empty columns).
    const cardWidthAt = (c: number) => (containerW - gap * (c - 1)) / c;
    let cols = Math.max(1, Math.ceil(Math.sqrt(N)));
    if (containerW > 0) {
      // Down pass — enforce the hard readability floor.
      while (cols > 1 && cardWidthAt(cols) < currentMinCardPx) cols--;
      // Up pass — pack more columns while they stay comfortably sized.
      const comfortablePx = Math.min(MAX_CARD_PX, currentMinCardPx * COMFORTABLE_CARD_FACTOR);
      while (cols < N && cardWidthAt(cols + 1) >= comfortablePx) cols++;
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

  refreshLotSummaryButton();
  // Sync toolbar button active state with initial panel visibility
  if (gallerySummaryPanelEl?.style.display !== 'none' && btnLotSummary) {
    setActive(btnLotSummary, true);
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
  if (insightsEl) container.appendChild(insightsEl);

  // ── Bin legend ─────────────────────────────────────────────────────────────

  function rebuildLegend(): void {
    legendEl.innerHTML = '';
    const mode = sharedOpts.plotMode ?? 'hardBin';
    // Bin swatches key off the plot mode shown on the grid of cards — with
    // Insights open the grid is replaced by the chart suite, so the bin
    // legend row has nothing left to key against and is dropped; the
    // metadata row above it stays, so the strip never moves or disappears
    // when switching between gallery and Insights.
    const hasBinLegendMode = !insightsOpen && BIN_LEGEND_MODES.has(mode);

    // Lot-level metadata — recomputed on every call since the item set can
    // change (e.g. gallery filtered to a subset of a mixed lot). Uses
    // `buildFacetTable`, never `analyzeWaferLot`'s first-wafer-wins
    // `lotIdentity`: a field that varies across wafers must show every
    // distinct value it takes, not just the first wafer's, and never be
    // silently dropped just because it isn't common to every visible wafer.
    const resolvedItems = currentItems.filter((it): it is WaferMapDisplayItem => it != null);
    const stackedItem = resolvedItems.find(it => it.isLotStack);
    const metaRow = buildMetadataStripRow(
      resolvedItems.map(it => ({ metadata: it.wafer.metadata ?? undefined })),
      stackedItem
        ? { lotSize: stackedItem.lotSize ?? resolvedItems.length, aggrMethod: stackedItem.aggrMethod }
        : undefined,
    );

    // Collect unique bins — use hbin or sbin depending on active mode.
    const binSet = new Set<number>();
    if (hasBinLegendMode) {
      for (const item of resolvedItems) {
        for (const die of item.dies) {
          if (die.partial) continue;
          const b = mode === 'softBin' ? die.sbin : die.hbin;
          if (b != null) binSet.add(b);
        }
      }
    }
    const bins = hasBinLegendMode ? [...binSet].sort((a, b) => a - b) : [];

    if (!metaRow && !bins.length) {
      legendEl.style.display = 'none';
      return;
    }
    legendEl.style.display = 'flex';

    if (metaRow) legendEl.appendChild(metaRow);

    if (!bins.length) return;

    const binsRow = document.createElement('div');
    Object.assign(binsRow.style, { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px 14px' });
    if (metaRow) Object.assign(binsRow.style, { borderTop: `1px solid ${CLR.separator}`, paddingTop: '6px' });
    legendEl.appendChild(binsRow);

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
        border:       isActive ? `2px solid ${CLR.iconActive}` : `1px solid ${CLR.menuBorder}`,
        borderRadius: '2px',
        boxSizing:    'border-box',
      });

      const lbl = document.createElement('span');
      lbl.textContent = binDef?.name ? `${bin} · ${binDef.name}` : `Bin ${bin}`;
      Object.assign(lbl.style, {
        fontWeight: isActive ? '700' : '400',
        color:      isActive ? CLR.iconActive : CLR.text,
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

      binsRow.appendChild(entry);
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
      // Functional tests are excluded: mean/median/σ of a pass/fail outcome is
      // meaningless. (A dedicated stacked functional representation — per-position
      // fail count across the lot, countBin-style — is a deferred enhancement.)
      const itemDefs = resolvedItems.find(it => it.testDefs?.length)?.testDefs;
      let defs = itemDefs?.filter(isParametricTest);

      // If no testDefs on items at all, discover unique test numbers from the actual
      // data (untyped keys default to parametric). Never falls back when defs exist
      // but are all functional — that would resurrect legacy 0/1-encoded functional
      // values as parametric stacks.
      if (!itemDefs?.length) {
        const uniqueNums = getUniqueTestNumbers(resolvedItems.flatMap(it => it.dies));

        defs = uniqueNums.map(tn => ({ testNumber: tn, name: `Test ${tn}` }));
      }
      if (!defs?.length) return [];

      const method = (sharedOpts.aggregationMethod ?? 'mean') as AggregationMethod;
      return defs.map(def => {
        const dies = aggregateValues(allDies, method, def.testNumber ?? def.index) as Die[];
        const cardTestDef = { testNumber: 0, name: def.name, unit: def.unit };
        return {
          wafer: stackedWafer,
          dies,
          testDefs: [cardTestDef],
          label: `${def.name} · ${method}`,
          isLotStack: true,
          aggrMethod: method,
          lotSize,
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
          isLotStack: true,
          aggrMethod: 'countBin',
          lotSize,
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
          isLotStack: true,
          aggrMethod: 'countBin',
          lotSize,
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
    const hasPendingFactories = pendingFactoryCount > 0;

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
    syncLogScaleBtn();
    syncColorbarRangeBtn();
    if (fireCallback) {
      const changed = Object.keys(partial) as (keyof WaferViewOptions)[];
      options.onViewOptionsChange?.(sharedOpts, changed, classifyChanged(changed));
    }
  }

  // ── Card building ──────────────────────────────────────────────────────────

  /**
   * A wafer's own label already covers identity (typically lot · waferId) —
   * the rest of its metadata (product, testProgram, operator, temperature,
   * etc.) is otherwise only visible via the die hover tooltip. Rather than a
   * floating badge duplicating the label text, the identity label itself
   * becomes the expand affordance: a chevron reveals the full field set as
   * an overlay, only when there's anything to show. Shared by the grid
   * card's own header and the detached-window paths (real popup and in-page
   * floating-window fallback) so all three read identically — `doc` is
   * accepted explicitly since a real popup is a *different* document than
   * the one this function is otherwise called from.
   */
  function buildIdentityHeaderRow(
    doc: Document,
    label: string,
    metadata: import('../core/metadata.js').WaferMetadata | undefined,
  ): { wrap: HTMLDivElement; metaPanel: HTMLDivElement | null } {
    const wrap = doc.createElement('div');
    Object.assign(wrap.style, { display: 'flex', alignItems: 'center', gap: '4px', flex: '1', minWidth: '0' });
    const labelEl = doc.createElement('span');
    labelEl.textContent = label;
    Object.assign(labelEl.style, {
      fontWeight: '700', fontSize: '13px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
    });
    wrap.appendChild(labelEl);

    const entries = metadataEntries(metadata ?? {});
    let metaPanel: HTMLDivElement | null = null;
    if (entries.length > 0) {
      const chevron = doc.createElement('span');
      Object.assign(chevron.style, { fontSize: '12px', lineHeight: '1', color: CLR.label, flexShrink: '0' });
      chevron.textContent = '▾';
      wrap.appendChild(chevron);
      Object.assign(wrap.style, { cursor: 'pointer' });

      metaPanel = doc.createElement('div');
      metaPanel.dataset.wmapCardMetaPanel = '1';
      Object.assign(metaPanel.style, {
        position:     'absolute',
        top:          '0', left: '0', right: '0',
        zIndex:       Z_ABOVE,
        background:   CLR.menuBg,
        borderBottom: `1px solid ${CLR.menuBorder}`,
        boxShadow:    '0 2px 6px rgba(0,0,0,0.15)',
        padding:      '8px 10px',
        fontSize:     '11px',
        display:      'none',
      } as Partial<CSSStyleDeclaration>);
      const rows = buildCompactMetadataRows(metadata ?? {});
      if (rows) metaPanel.appendChild(rows);

      wrap.setAttribute('aria-expanded', 'false');
      wrap.setAttribute('aria-label', `Wafer info for ${label || 'this card'}. Click to expand.`);
      wireExpandToggle(wrap, (open) => {
        chevron.textContent = open ? '▴' : '▾';
        wrap.setAttribute('aria-expanded', String(open));
        if (metaPanel) metaPanel.style.display = open ? 'block' : 'none';
      });
    }
    return { wrap, metaPanel };
  }

  /**
   * For a wafer opened into a wmap-owned overlay (`openModal`/`openFloatingWindow`,
   * both built on `openOverlay` in toolbar.ts) — that overlay chrome already has
   * its own always-visible title element (`data-wmap-window-title`); augment it
   * in place with the same chevron/expand-panel affordance every other wafer
   * view uses, rather than mounting a second competing header via
   * `buildIdentityHeaderRow`. toolbar.ts's overlay stays wafer-metadata-agnostic
   * (it has no idea what `WaferMetadata` is) — this wiring lives here instead.
   * Shared by the gallery's in-page floating-window detach fallback and the
   * Insights tab's "open this wafer" modal — both are `OverlayHandle`s with an
   * identical title/content-wrap shape, so one function covers both call sites.
   * No-ops if the overlay wasn't given a title, or the wafer has no metadata.
   */
  function augmentOverlayTitleWithMetadata(
    handle: OverlayHandle,
    label: string,
    metadata: import('../core/metadata.js').WaferMetadata | undefined,
  ): void {
    const titleEl = handle.box.querySelector<HTMLElement>('[data-wmap-window-title]');
    const entries = metadataEntries(metadata ?? {});
    if (!titleEl || entries.length === 0) return;

    const titleParent = titleEl.parentElement;
    const titleWrap = document.createElement('div');
    Object.assign(titleWrap.style, {
      display: 'flex', alignItems: 'center', gap: '4px', flex: '1', minWidth: '0', cursor: 'pointer',
    });
    titleParent?.insertBefore(titleWrap, titleEl);
    titleWrap.appendChild(titleEl);
    const chevron = document.createElement('span');
    Object.assign(chevron.style, { fontSize: '12px', lineHeight: '1', color: CLR.label, flexShrink: '0' });
    chevron.textContent = '▾';
    titleWrap.appendChild(chevron);

    const metaPanel = document.createElement('div');
    metaPanel.dataset.wmapCardMetaPanel = '1';
    Object.assign(metaPanel.style, {
      position: 'absolute', top: '0', left: '0', right: '0', zIndex: Z_ABOVE,
      background: CLR.menuBg, borderBottom: `1px solid ${CLR.menuBorder}`,
      boxShadow: '0 2px 6px rgba(0,0,0,0.15)', padding: '8px 10px', fontSize: '11px', display: 'none',
    } as Partial<CSSStyleDeclaration>);
    const rows = buildCompactMetadataRows(metadata ?? {});
    if (rows) metaPanel.appendChild(rows);
    handle.contentWrap.style.position = 'relative';
    handle.contentWrap.appendChild(metaPanel);

    titleWrap.setAttribute('aria-expanded', 'false');
    titleWrap.setAttribute('aria-label', `Wafer info for ${label}. Click to expand.`);
    wireExpandToggle(titleWrap, (open) => {
      chevron.textContent = open ? '▴' : '▾';
      titleWrap.setAttribute('aria-expanded', String(open));
      metaPanel.style.display = open ? 'block' : 'none';
    });
  }

  function buildCard(item: WaferMapDisplayItem, cardIndex: number, _totalItems: number): { card: HTMLDivElement; ctrl: WaferMapController; canvasWrapper: HTMLDivElement; expandBtn: HTMLButtonElement } {
    const card = document.createElement('div');
    card.className = 'wmap-gallery-card';
    Object.assign(card.style, {
      background:    CLR.menuBg,
      border:        `1px solid ${CLR.menuBorder}`,
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
      borderBottom:   `1px solid ${CLR.menuBorder}`,
      flexShrink:     '0',
      gap:            '6px',
    });
    const { wrap: identityWrap, metaPanel } = buildIdentityHeaderRow(document, item.label ?? '', item.wafer.metadata ?? undefined);
    header.appendChild(identityWrap);

    // Expand button — toggles between "detach into its own window" and, once
    // detached, "reattach to this grid slot" (see updateExpandBtn).
    const expandBtn = document.createElement('button');
    expandBtn.dataset.wmapExpandBtn = '1';
    expandBtn.title = 'Open full view';
    expandBtn.innerHTML = ICONS.expand; // unified expand icon (was an inline polyline SVG)
    Object.assign(expandBtn.style, {
      display:         'flex',
      alignItems:      'center',
      justifyContent:  'center',
      border:          `1px solid ${CLR.menuBorder}`,
      borderRadius:    '4px',
      background:      CLR.panelBg,
      color:           CLR.label,
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
    // metaPanel overlays the top of the canvas area (not the header, which
    // stays fixed-height) — an absolute overlay rather than in-flow growth,
    // so expanding it never shrinks canvasWrapper (flex:1) and therefore
    // never shrinks the map, matching the standalone badge's own contract.
    if (metaPanel) canvasWrapper.appendChild(metaPanel);

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
      onSaveImage:     options.onSaveImage,
      onSaveText:      options.onSaveText,
      onClick:         item.onClick,
      onSelect:        item.onSelect,
      onExpand:        () => openWindowForCard(cardIndex, item),
      // The card's own header already shows item.label (wafer identity), and
      // the gallery's shared legend strip already shows lot-level metadata —
      // the per-map badge would be pure duplication here (worse: on a small
      // card it visually competes with the toolbar for the same corner-ish
      // space). Only the standalone renderWaferMap use case needs the badge.
      showMetadataBadge: false,
    });
    // In-gallery: hide scene controls (gallery bar owns them) and summary button.
    ctrl.setViewControlsVisible(false);
    ctrl.setSummaryVisible(false);
    expandBtn.onclick = () => openWindowForCard(cardIndex, item);

    return { card, ctrl, canvasWrapper, expandBtn };
  }

  /** Sync a card's header button to reflect whether its canvas is currently
   * detached into its own window — "expand" when attached, "reattach" when a
   * still-linked window exists for it. A card whose window has been unlinked
   * (see unlinkAllDetachedWindows) has no grid slot to sync, so this is only
   * called for indices that are still live in the current cardControllers array. */
  function updateExpandBtn(cardIndex: number): void {
    const btn = cardExpandBtns[cardIndex];
    if (!btn) return;
    const win = [...detachedWindows.values()].find(w => w.cardIndex === cardIndex);
    if (win) {
      btn.innerHTML = ICONS.minimize;
      btn.title = 'Reattach to gallery';
      btn.setAttribute('aria-label', 'Reattach to gallery');
      btn.onclick = () => reattachOrDiscard(win.id);
    } else {
      btn.innerHTML = ICONS.expand;
      btn.title = 'Open full view';
      btn.setAttribute('aria-label', 'Open full view');
      btn.onclick = () => openWindowForCard(cardIndex, currentItems[cardIndex]);
    }
  }

  function buildCards(newItems: Array<WaferMapDisplayItem | WaferMapDisplayItemFactory>): void {
    // Any card currently detached into its own window can't be assumed to exist
    // at the same index (or at all) once the grid is rebuilt — e.g. a stacked-mode
    // transition can collapse many per-wafer cards into fewer aggregate ones, and
    // WaferMapDisplayItem carries no stable id to remap by. Unlink rather than
    // close: the window's own controller/canvas/toolbar keep working exactly as
    // before, it just loses its "reattachable to a grid slot" relationship.
    unlinkAllDetachedWindows();

    getOpenMenu()?.remove(); setOpenMenu(null);
    clearLotFindingHighlight();
    currentItems = [];
    // Detached cards' grid-slot controller is already null (destroyed at detach
    // time — its popup window has its own independent controller instead), so
    // this loop only ever destroys controllers that are actually still live in
    // the grid.
    for (const ctrl of cardControllers) if (ctrl) ctrl.destroy();
    cardControllers = [];
    cardContainers = [];
    cardExpandBtns = [];
    pendingFactoryCount = 0;
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
          background:    CLR.menuBg,
          border:        `1px solid ${CLR.menuBorder}`,
          borderRadius:  '10px',
          aspectRatio:   '1',
          display:       'flex',
          alignItems:    'center',
          justifyContent:'center',
        });
        const spinner = document.createElement('span');
        spinner.textContent = '…';
        Object.assign(spinner.style, { color: CLR.label, fontSize: '18px' });
        placeholder.appendChild(spinner);
        gridEl.appendChild(placeholder);
        currentItems.push(null as unknown as WaferMapDisplayItem); // slot reserved
        cardControllers.push(null as unknown as WaferMapController);
        cardContainers.push(null as unknown as HTMLDivElement);
        cardExpandBtns.push(null as unknown as HTMLButtonElement);
        factories.push({ index: i, factory: entry, placeholder });
        pendingFactoryCount++;
      } else {
        const { ctrl, canvasWrapper, expandBtn } = buildCard(entry, i, newItems.length);
        currentItems.push(entry);
        cardControllers.push(ctrl);
        cardContainers.push(canvasWrapper);
        cardExpandBtns.push(expandBtn);
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
      const { card, ctrl, canvasWrapper, expandBtn } = buildCard(item, index, newItems.length);
      cardControllers[index] = ctrl;
      cardContainers[index] = canvasWrapper;
      cardExpandBtns[index] = expandBtn;
      pendingFactoryCount--;
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
        if (!btnLotSummary) {
          btnLotSummary = makeBtn('findings', 'Summary panel', () => {
            if (!gallerySummaryPanelEl) return;
            const isOpen = gallerySummaryPanelEl.style.display !== 'none';
            // Re-render on open so the index reflects all items resolved so far.
            if (!isOpen) renderGallerySummaryPanel();
            gallerySummaryPanelEl.style.display = isOpen ? 'none' : 'flex';
            setActive(btnLotSummary!, !isOpen);
            refreshLotSummaryButton();
          });
          barEl.appendChild(makeSep());
          barEl.appendChild(btnLotSummary);
        }
        refreshLotSummaryButton();
      } else if (gallerySummaryPanelEl && gallerySummaryPanelEl.style.display !== 'none') {
        // Panel is open — refresh the index to show newly resolved items.
        renderGallerySummaryPanel();
      }
      refreshLotSummaryButton();
      setTimeout(resolveNext, 0);
    }
    if (factories.length > 0) setTimeout(resolveNext, 0);
  }

  // originalItems is already populated (see its declaration) — factories fill their
  // slots in as they resolve via resolveNext.
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
  gridResizeObserver.observe(gridEl);

  // Initial gallery summary panel render
  if (gallerySummaryPanelEl) renderGallerySummaryPanel();

  // ── Detached windows ─────────────────────────────────────────────────────────
  // Non-modal: the gallery grid stays fully interactive while any number of
  // cards are detached into their own floating windows (an engineer comparing
  // several wafers at once). See DetachedWindow above and buildCards()'s
  // unlinkAllDetachedWindows() call for what happens when the grid rebuilds.

  /** Replace a grid card's live canvas with a small "detached" placeholder —
   * the card's own controller was destroyed at detach time (its popup window
   * has the only live view of that wafer while detached), so the grid slot
   * needs *something* occupying its layout space until reattach. */
  function showDetachedPlaceholder(cardIndex: number): void {
    const wrapper = cardContainers[cardIndex];
    if (!wrapper) return;
    wrapper.innerHTML = '';
    Object.assign(wrapper.style, { alignItems: 'center', justifyContent: 'center' });
    const note = document.createElement('span');
    note.textContent = 'Detached — open in its own window';
    Object.assign(note.style, { color: CLR.label, fontSize: '12px', textAlign: 'center', padding: '0 12px' });
    wrapper.appendChild(note);
  }

  function openWindowForCard(cardIndex: number, item: WaferMapDisplayItem): void {
    // Guard re-entrancy — other callers (e.g. the findings-index row) could
    // race a double-open on the same card.
    for (const w of detachedWindows.values()) if (w.cardIndex === cardIndex) return;

    const label = item.label ?? 'Wafer map';
    const id = nextWindowId++;

    const popupWin = openDetachWindow(label);
    // A real popup: full OS-window behaviour, can be dragged outside the host
    // window's own bounds. Falls back below when unavailable (a blocked
    // popup — e.g. Tauri's WebView, where window.open() silently returns null
    // — and no custom setDetachWindowOpener is registered).
    if (popupWin) {
      const doc = popupWin.document;
      // A window.open('', ...) popup already has a valid, empty document (with
      // <html><head></head><body></body></html>) — document.write() is
      // unnecessary here and, in at least some engines, appears to leave the
      // document in a state where later ResizeObserver callbacks silently stop
      // firing. Building directly via DOM APIs avoids that risk entirely.
      doc.title = label;
      Object.assign(doc.documentElement.style, { height: '100%' });
      // A popup starts as a bare, unstyled document — it never gets the host
      // page's own font/CSS reset, so set the library's own font stack
      // explicitly rather than silently falling back to the browser default.
      Object.assign(doc.body.style, {
        margin: '0', height: '100vh', overflow: 'hidden', display: 'flex', flexDirection: 'column',
        fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
      });
      // The popup's documentElement has none of the host page's --wmap-* theme
      // values (it's an unrelated document) — copy them across, and keep them
      // synced with later host theme changes (see syncWmapPopupTheme's own doc
      // comment). Read from the gallery's own render container, not
      // document.documentElement — getComputedStyle resolves the full cascade
      // *down to* that element, so this also picks up a --wmap-* override set
      // on some nearer ancestor of the container rather than on <html> itself
      // (a host that only themes its own widget wrapper, not the whole page).
      // Reading from documentElement would silently miss that and copy the
      // fallback defaults instead.
      copyWmapThemeTokens(container, doc.documentElement);
      const stopThemeSync = syncWmapPopupTheme(container, doc.documentElement, () => ctrl.setOptions({}));

      // In-content banner: the OS window/tab title is the only "title bar" a real
      // popup has, and some hosts (e.g. a decoration-less Tauri window) may not
      // show it at all — this guarantees the unlinked notice (see
      // unlinkAllDetachedWindows) is visible regardless of OS chrome.
      const banner = doc.createElement('div');
      banner.dataset.wmapWindowBanner = '1';
      banner.textContent = label;
      Object.assign(banner.style, {
        display: 'none', padding: '6px 12px', fontSize: '12px', fontWeight: '700',
        background: CLR.warnBg, color: CLR.warnText, borderBottom: `1px solid ${CLR.warnBorder}`, flexShrink: '0',
      });
      doc.body.appendChild(banner);

      const popupBody = doc.createElement('div');
      Object.assign(popupBody.style, { flex: '1', minHeight: '0', display: 'flex', flexDirection: 'column' });
      doc.body.appendChild(popupBody);

      // Persistent identity header — unlike the (conditional, warning-styled)
      // unlink banner above, this is always visible: a real popup otherwise
      // relies solely on the OS window title bar for identity, which some
      // embedded hosts (a decoration-less Tauri window) don't show at all.
      // Same header+chevron pattern as the grid card, in this doc's own
      // document (a popup is a different Document than the page it opened
      // from — every element here must be created via `doc`, not the bare
      // global, or it silently belongs to the wrong document).
      const { wrap: identityWrap, metaPanel } = buildIdentityHeaderRow(doc, label, item.wafer.metadata ?? undefined);
      const headerRow = doc.createElement('div');
      Object.assign(headerRow.style, {
        display: 'flex', alignItems: 'center', padding: '8px 10px 6px',
        borderBottom: `1px solid ${CLR.menuBorder}`, flexShrink: '0', gap: '6px',
      });
      headerRow.appendChild(identityWrap);
      popupBody.appendChild(headerRow);

      const mapContainer = doc.createElement('div');
      Object.assign(mapContainer.style, {
        position: 'relative', flex: '1', minHeight: '0', overflow: 'hidden', display: 'flex', flexDirection: 'column',
      });
      if (metaPanel) mapContainer.appendChild(metaPanel);
      popupBody.appendChild(mapContainer);

      const ctrl = buildDetachedController(mapContainer, item);

      const closePollId = setInterval(() => { if (popupWin.closed) handlePopupClosed(id); }, 400);
      popupWin.addEventListener('pagehide', () => handlePopupClosed(id));

      detachedWindows.set(id, {
        id, ctrl, cardIndex, label, closePollId, stopThemeSync,
        close: () => { if (!popupWin.closed) popupWin.close(); },
        setTitle: (text) => {
          doc.title = text;
          banner.textContent = text;
          banner.style.display = 'block';
        },
      });
    } else {
      // Fallback: window.open() is unavailable (blocked popup, or an embedded
      // host like Tauri where it silently returns null) and no host opener is
      // registered. Rather than silently doing nothing, fall back to the
      // in-page non-modal floating window (openFloatingWindow) — the same
      // primitive the user-guide window uses. It can't be dragged outside the
      // host window's own bounds, but the detach feature stays usable instead
      // of being dead in every embedded host with no window.open() support.
      const handle = openFloatingWindow({
        title: label,
        onClose: () => handlePopupClosed(id),
      });
      handle.contentWrap.style.flexDirection = 'column';
      augmentOverlayTitleWithMetadata(handle, label, item.wafer.metadata ?? undefined);
      const ctrl = buildDetachedController(handle.contentWrap, item);

      detachedWindows.set(id, {
        id, ctrl, cardIndex, label, closePollId: null,
        close: () => handle.close(),
        setTitle: (text) => {
          const titleEl = handle.box.querySelector<HTMLElement>('[data-wmap-window-title]');
          if (titleEl) { titleEl.textContent = text; titleEl.title = text; }
        },
      });
    }

    // Destroy the grid slot's own controller — the detached window is now the
    // only live view of this wafer. cardContainers[cardIndex] is left in
    // place (it's the card's layout box) but its content becomes a placeholder.
    cardControllers[cardIndex]?.destroy();
    cardControllers[cardIndex] = null;
    showDetachedPlaceholder(cardIndex);
    updateExpandBtn(cardIndex);
  }

  /**
   * Build the fresh renderWaferMap instance shared by the real-popup and
   * in-page-fallback detach paths, and the Insights tab's "open this wafer"
   * click. `testNumber`, when given (only from the Insights tab's boxplot
   * leaf-row click), opens straight into value mode on that test — matching
   * what the user was already looking at — instead of the gallery's shared
   * plot mode; omitted (the detach-window paths) leaves plot mode untouched.
   */
  function buildDetachedController(container: HTMLElement, item: WaferMapDisplayItem, testNumber?: number): WaferMapController {
    const baseViewOptions = item.viewOptions ? { ...sharedOpts, ...item.viewOptions } : sharedOpts;
    const viewOptions = testNumber !== undefined
      ? { ...baseViewOptions, plotMode: 'value' as const, activeTest: testNumber }
      : baseViewOptions;
    const ctrl = renderWaferMap(container, item as import('../renderer/buildWaferMap.js').WaferMapResult, {
      viewOptions,
      toolbarControls: 'full',
      showTooltip:     true,
      padding:         cardPadding,
      legendPosition:  currentLegendStyle,
      fallbackFormat:  currentFallbackFormat,
      statsSummary:    item.statsSummary,
      onSaveImage:     options.onSaveImage,
      onSaveText:      options.onSaveText,
      onClick:         item.onClick,
      onSelect:        item.onSelect,
      // This view is already detached into its own window (a real popup or
      // the in-page fallback) — there is nowhere sensible for it to "expand"
      // to, so suppress both the toolbar button and the `E` key entirely
      // rather than relying only on the runtime setExpandVisible(false)
      // below, which hides the button but does not gate the keyboard
      // shortcut (see renderWaferMap.ts's onKeyDown — it checks
      // showExpandButton, not the button's current visibility).
      showExpandButton: false,
      // Both callers (the real-popup path and the in-page floating-window
      // fallback, see openWindowForCard) now build their own persistent
      // expandable identity header before calling this function — the
      // standalone corner badge would just duplicate it.
      showMetadataBadge: false,
    });
    ctrl.setViewControlsVisible(true);
    ctrl.setSummaryVisible(true);
    ctrl.setExpandVisible(false);
    return ctrl;
  }

  /** Cleanup shared by both the popup's own OS-level close and the card's
   * reattach-button click. If still linked to a live grid slot, rebuilds that
   * slot's card fresh, first reading back the detached window's own live view
   * options (rotation, colour scheme, log scale, etc. — anything the user
   * changed from the popup's own full toolbar) so a rebuild doesn't silently
   * discard them; only options genuinely un-settable from that toolbar fall
   * back to the gallery's current shared options. If unlinked, there is no
   * slot to rebuild and the popup's controller is simply released. */
  function handlePopupClosed(id: number): void {
    const win = detachedWindows.get(id);
    if (!win) return; // already handled — poll/pagehide race, or reattach-button already ran this
    detachedWindows.delete(id);
    if (win.closePollId != null) clearInterval(win.closePollId);
    win.stopThemeSync?.();
    const liveOptions = win.ctrl.getOptions();
    win.ctrl.destroy();

    if (win.cardIndex === null) return; // unlinked — no grid slot to rebuild

    const cardIndex = win.cardIndex;
    const item = currentItems[cardIndex];
    if (!item) return; // defensive — shouldn't happen while linked
    const rebuiltItem: WaferMapDisplayItem = { ...item, viewOptions: liveOptions };
    currentItems[cardIndex] = rebuiltItem;
    const { card, ctrl, canvasWrapper, expandBtn } = buildCard(rebuiltItem, cardIndex, currentItems.length);
    cardContainers[cardIndex]?.parentElement?.replaceWith(card);
    cardControllers[cardIndex] = ctrl;
    cardContainers[cardIndex] = canvasWrapper;
    cardExpandBtns[cardIndex] = expandBtn;
  }

  /** Reattach-button click: close the detached window/box (which re-enters
   * this module via `handlePopupClosed` through the poll/pagehide/onClose
   * path — but we drive it here directly for an immediate response instead of
   * waiting on the poll, for the real-popup case). */
  function reattachOrDiscard(id: number): void {
    const win = detachedWindows.get(id);
    if (!win) return;
    win.close();
    handlePopupClosed(id);
  }

  /** Mark every currently open window as no longer tied to a grid slot, ahead of
   * a buildCards() rebuild. The window's own canvas/controller/toolbar keep
   * working exactly as before — only its "reattachable" relationship is lost,
   * since the rebuilt grid may no longer have an equivalent slot for it (e.g. a
   * stacked-mode transition collapsing many per-wafer cards into fewer aggregate
   * ones). The title/banner are updated so the user understands why the
   * reattach affordance is gone; the window can still be closed manually. */
  function unlinkAllDetachedWindows(): void {
    for (const win of detachedWindows.values()) {
      if (win.cardIndex === null) continue; // already unlinked
      win.cardIndex = null;
      win.setTitle(`${win.label} — unlinked from gallery`);
    }
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
    // Composite export follows the on-screen theme (resolve once from the grid).
    const gTheme = resolveCanvasTheme(gridEl);
    ctx.fillStyle = gTheme.background;
    ctx.fillRect(0, 0, off.width, off.height);
    canvases.forEach((c, i) => {
      const col   = i % cols;
      const row   = Math.floor(i / cols);
      const x     = col * (cellW + gap);
      const y     = row * (cellH + headerH + gap);
      const label = c.closest('.wmap-gallery-card')?.querySelector<HTMLElement>('span')?.textContent ?? '';
      ctx.fillStyle = gTheme.surface;
      ctx.fillRect(x, y, cellW, headerH);
      ctx.fillStyle = gTheme.text;
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
      refreshLotSummaryButton();
    },

    setColumns(cols: number | undefined): void {
      setColumnsState(cols);
    },

    openUserGuide: openGuideWindow,

    destroy(): void {
      buildGeneration++; // cancel any pending factory resolvers
      // Close every open popup (linked or already-unlinked) and release its
      // controller — unlike a linked grid card, a detached card's own controller
      // was already destroyed at detach time, so there's no grid-side destroy
      // loop that would otherwise reach it.
      for (const win of [...detachedWindows.values()]) {
        if (win.closePollId != null) clearInterval(win.closePollId);
        win.close();
        win.ctrl.destroy();
      }
      detachedWindows.clear();
      for (const ctrl of cardControllers) if (ctrl) ctrl.destroy();
      cardControllers = [];
      getOpenMenu()?.remove();
      gridResizeObserver.disconnect();
      document.removeEventListener('click', closeOpenMenu, true);
      window.removeEventListener('blur', onWindowBlur);
      disposeOverlayZ();
      // Shared singleton — hide, never destroy (other instances may use it).
      hideTooltip();
      barEl.remove();
      legendEl.remove();
      bodyEl.remove();
      gallerySummaryPanelEl?.remove();
      insightsTab?.destroy();
    },
  };
}
