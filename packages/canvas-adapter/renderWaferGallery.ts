import type { PlotMode } from '../renderer/buildScene.js';
import { listColorSchemes, getColorScheme } from '../renderer/colorSchemes.js';
import { CLR, ROTATIONS, INLINE_TEST_LIMIT, MODE_LABELS, BIN_LEGEND_MODES, STACKED_MODES, createTooltip, createToolbarHelpers } from './toolbar.js';
import type { Wafer } from '../core/wafer.js';
import type { Die } from '../core/dies.js';
import { aggregateValues, aggregateBinCounts } from '../core/aggregates.js';
import type { AggregationMethod } from '../core/aggregates.js';
import { renderWaferMap } from './renderWaferMap.js';
import type { WaferSceneOptions, WaferCanvasController } from './renderWaferMap.js';
import type { BinDef } from '../renderer/buildWaferMap.js';
import type { LotStatsSummary, StatsFinding } from '../stats/types.js';

// ── Public types ───────────────────────────────────────────────────────────────

export interface GalleryItem {
  wafer:        Wafer;
  dies:         Die[];
  label?:       string;
  /** Set to true when the wafer was built with a ReticleConfig — shows the reticle toggle button. */
  hasReticle?:  boolean;
  /** Per-card scene option overrides merged on top of the shared gallery options. */
  sceneOptions?: Partial<WaferSceneOptions>;
  /** Wafer-level stats summary — shown in the findings panel when this card is opened in the modal. */
  statsSummary?: import('../stats/types.js').StatsSummary;
  onClick?:     (die: Die, event: MouseEvent) => void;
  onSelect?:    (dies: Die[]) => void;
}

export interface GalleryOptions {
  /** Initial shared scene options applied to all cards. */
  sceneOptions?:         WaferSceneOptions;
  /** Called whenever a shared gallery option changes. */
  onSceneOptionsChange?: (opts: WaferSceneOptions) => void;
  /** Legend position for bin modes. Default 'default'. */
  legendPosition?:       'default' | 'compact' | 'bottom' | 'top' | 'left' | 'floating';
  /** Padding inside each card canvas in CSS pixels. Default 6. */
  cardPadding?:          number;
  /** Filename stem for the composite gallery PNG. Default 'wafer-gallery'. */
  downloadFilename?:     string;
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
  /** Precomputed lot-level stats summary — shows a findings panel in the control bar. */
  lotStatsSummary?:        LotStatsSummary;
  /** Show the built-in lot findings panel toggle when stats are provided. Default true. */
  showFindingsPanel?:      boolean;
}

export interface GalleryController {
  /** Replace all items — destroys existing cards and rebuilds the grid. */
  setItems(items: GalleryItem[]): void;
  /** Merge shared scene option overrides across all cards. */
  setOptions(opts: Partial<WaferSceneOptions>): void;
  /** Return the current shared scene options. */
  getOptions(): WaferSceneOptions;
  /** Update the fallback format for unitless values across all cards. */
  setFallbackFormat(format: 'si' | 'engineering'): void;
  /** Replace the lot-level stats summary used by the built-in findings panel. */
  setLotStatsSummary(summary: LotStatsSummary | undefined): void;
  /** Remove all DOM and event listeners. */
  destroy(): void;
}


// ── Main export ───────────────────────────────────────────────────────────────

export function renderWaferGallery(
  container: HTMLElement,
  items: GalleryItem[],
  options: GalleryOptions = {},
): GalleryController {
  const cardPadding          = options.cardPadding          ?? 6;
  const downloadFilename     = options.downloadFilename     ?? 'wafer-gallery';
  const showPlotModeSelector = options.showPlotModeSelector ?? true;
  const showFindingsPanel    = options.showFindingsPanel    ?? true;
  let currentFallbackFormat  = options.fallbackFormat;
  let currentLotStats        = options.lotStatsSummary;
  let currentLegendStyle     = options.legendPosition ?? 'default' as 'default' | 'compact' | 'bottom' | 'top' | 'left' | 'floating';

  let sharedOpts: WaferSceneOptions = {
    plotMode:               'hardbin',
    colorScheme:            'color',
    showText:               false,
    showRingBoundaries:     false,
    showQuadrantBoundaries: false,
    ringCount:              4,
    rotation:               0,
    flipX:                  false,
    flipY:                  false,
    ...options.sceneOptions,
  };

  let cardControllers: WaferCanvasController[] = [];
  let currentItems:  GalleryItem[] = [];
  let originalItems: GalleryItem[] = [];  // per-wafer source items; stacked modes aggregate from this
  let modalController: WaferCanvasController | null = null;
  let savedBodyOverflow = '';

  // Findings state
  let lotFindingsOpen        = false;
  let activeLotFindingId: string | null = null;
  let btnLotFindings: HTMLButtonElement | null = null;
  let lotFindingsPanel: HTMLDivElement  | null = null;
  // Card highlight state: indices of cards to visually emphasise.
  let highlightedCardIndices = new Set<number>();

  // ── Toolbar helpers ────────────────────────────────────────────────────────

  const tooltip = createTooltip();
  const { makeBtn, setActive, makeSep, makeMenuRow, makeMenuSection, makeDropdown, closeOpenMenu, getOpenMenu, setOpenMenu } = createToolbarHelpers(tooltip);
  document.addEventListener('click', closeOpenMenu, true);

  // ── Lot findings helpers ───────────────────────────────────────────────────

  function findingsSeverityColor(severity: StatsFinding['severity']): string {
    return severity === 'unusual' ? '#a84112' : severity === 'notable' ? '#8a6500' : '#506784';
  }

  function applyCardHighlight(indices: number[]): void {
    highlightedCardIndices = new Set(indices);
    const cards = [...gridEl.querySelectorAll<HTMLElement>('.wmap-gallery-card')];
    cards.forEach((card, i) => {
      card.style.outline     = highlightedCardIndices.has(i) ? '3px solid #e07a20' : '';
      card.style.outlineOffset = highlightedCardIndices.has(i) ? '-3px' : '';
    });
  }

  function clearCardHighlight(): void {
    applyCardHighlight([]);
  }

  function clearDieZoneHighlight(): void {
    for (const ctrl of cardControllers) ctrl.clearSelection();
  }

  function applyDieZoneHighlight(dieKeys: string[], cardIndices?: number[]): void {
    const keySet = new Set(dieKeys);
    const targets = cardIndices ?? cardControllers.map((_, i) => i);
    for (const ci of targets) {
      const item = currentItems[ci];
      if (!item) continue;
      const matched = item.dies.filter(d => keySet.has(`${d.i},${d.j}`));
      cardControllers[ci].setSelection(matched);
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
    syncShared({ highlightBin: undefined });
    lotFindingsPanel?.querySelectorAll<HTMLButtonElement>('[data-wmap-lot-finding]').forEach(btn => {
      btn.style.background = '#fff';
      btn.style.fontWeight = '400';
    });
  }

  function applyLotFindingHighlight(finding: StatsFinding, row: HTMLButtonElement): void {
    // Toggle off if already active.
    if (activeLotFindingId === finding.id) {
      clearLotFindingHighlight();
      return;
    }

    // Clear previous highlight styling.
    lotFindingsPanel?.querySelectorAll<HTMLButtonElement>('[data-wmap-lot-finding]').forEach(btn => {
      btn.style.background = '#fff';
      btn.style.fontWeight = '400';
    });
    activeLotFindingId   = finding.id;
    row.style.background = CLR.bgActive;
    row.style.fontWeight = '600';

    // Switch to the mode that makes this finding's data visible.
    // Don't set highlightBin — the die zone selection overlay already shows the affected
    // dies, and highlightBin dims everything else making the map look empty.
    const { kind, index } = finding.variable;
    if (kind === 'test') {
      syncShared({ plotMode: 'value', testIndex: index ?? 0, highlightBin: undefined });
    } else if (kind === 'softbin') {
      syncShared({ plotMode: 'softbin', highlightBin: undefined });
    } else {
      syncShared({ plotMode: 'hardbin', highlightBin: undefined });
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
    btnLotFindings.style.display = currentLotStats ? 'flex' : 'none';
    btnLotFindings.title = currentLotStats?.hasNotableFindings
      ? 'Show lot findings (notable patterns found)'
      : 'Show lot findings';
    if (currentLotStats?.hasNotableFindings && !lotFindingsOpen) {
      btnLotFindings.style.color = '#b7551a';
    } else if (!btnLotFindings.dataset.active) {
      btnLotFindings.style.color = CLR.icon;
    }
  }

  function rebuildLotFindingsPanel(): void {
    if (!lotFindingsPanel) return;
    lotFindingsPanel.innerHTML = '';
    lotFindingsPanel.style.display = currentLotStats && lotFindingsOpen ? 'flex' : 'none';
    if (!currentLotStats) {
      refreshLotFindingsButton();
      return;
    }

    const header = document.createElement('div');
    header.textContent = 'Lot Findings';
    Object.assign(header.style, {
      fontSize: '12px', fontWeight: '700', color: '#1f2f43', marginBottom: '2px',
    });
    lotFindingsPanel.appendChild(header);

    const findings = currentLotStats.findings;
    if (findings.length === 0) {
      const empty = document.createElement('div');
      empty.textContent = 'No significant lot-level findings';
      Object.assign(empty.style, { fontSize: '12px', color: '#66788a' });
      lotFindingsPanel.appendChild(empty);
      refreshLotFindingsButton();
      return;
    }

    const severityOrder: StatsFinding['severity'][] = ['unusual', 'notable', 'info'];
    const severityLabel: Record<StatsFinding['severity'], string> = {
      unusual: 'Unusual', notable: 'Notable', info: 'Informational',
    };
    const grouped = new Map<StatsFinding['severity'], StatsFinding[]>(
      severityOrder.map(s => [s, []])
    );
    for (const finding of findings) grouped.get(finding.severity)!.push(finding);

    let firstGroup = true;
    for (const severity of severityOrder) {
      const group = grouped.get(severity)!;
      if (!group.length) continue;

      if (!firstGroup) {
        const divider = document.createElement('div');
        Object.assign(divider.style, { height: '1px', background: CLR.separator, margin: '4px 0' });
        lotFindingsPanel.appendChild(divider);
      }
      firstGroup = false;

      const groupLabel = document.createElement('div');
      groupLabel.textContent = severityLabel[severity];
      Object.assign(groupLabel.style, {
        fontSize: '10px', fontWeight: '700', letterSpacing: '0.05em',
        textTransform: 'uppercase', color: findingsSeverityColor(severity), padding: '2px 0',
      });
      lotFindingsPanel.appendChild(groupLabel);

      for (const finding of group) {
        const row = document.createElement('button');
        row.type = 'button';
        row.dataset.wmapLotFinding = finding.id;
        const isActive = activeLotFindingId === finding.id;
        row.textContent = finding.summary;
        Object.assign(row.style, {
          border:       `1px solid ${CLR.menuBorder}`,
          borderLeft:   `3px solid ${findingsSeverityColor(finding.severity)}`,
          background:   isActive ? CLR.bgActive : '#fff',
          borderRadius: '6px',
          padding:      '8px 10px',
          textAlign:    'left',
          fontSize:     '12px',
          fontWeight:   isActive ? '600' : '400',
          color:        '#2a3f5f',
          cursor:       'pointer',
          width:        '100%',
        });
        row.addEventListener('click', () => applyLotFindingHighlight(finding, row));
        lotFindingsPanel.appendChild(row);
      }
    }

    refreshLotFindingsButton();
  }

  // ── Gallery control bar ────────────────────────────────────────────────────

  const barEl = document.createElement('div');
  Object.assign(barEl.style, {
    display:       'flex',
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

  type ModeEntry = { plotMode: PlotMode; testIndex?: number; label: string };

  const btnMode = makeBtn('mode', 'Plot mode', () => {
    const openMenu = getOpenMenu();
    if (openMenu) { openMenu.remove(); setOpenMenu(null); return; }

    // Use originalItems (per-wafer source) — currentItems may be aggregated cards
    // in stacked modes, which don't accurately reflect the full data availability.
    const dies      = originalItems.flatMap(it => it.dies);
    const testDefs  = sharedOpts.testDefs;
    const hasValues = dies.some(d => d.values?.length);
    const hasHbin   = dies.some(d => d.hbin != null);
    const hasSbin   = dies.some(d => d.sbin != null);

    const currentMode    = sharedOpts.plotMode ?? 'hardbin';
    const currentTestIdx = sharedOpts.testIndex ?? 0;

    function isCurrentEntry(e: ModeEntry): boolean {
      if (e.plotMode !== currentMode) return false;
      if (e.plotMode === 'value') return currentTestIdx === (e.testIndex ?? 0);
      return true;
    }

    function pickEntry(entry: ModeEntry, menu: HTMLElement): void {
      if (entry.testIndex !== undefined) {
        applyShared({ plotMode: 'value', testIndex: entry.testIndex });
      } else {
        applyShared({ plotMode: entry.plotMode, testIndex: undefined });
      }
      menu.remove();
      setOpenMenu(null);
    }

    const testEntries: ModeEntry[] = hasValues
      ? (testDefs?.length
          ? testDefs.map(t => ({ plotMode: 'value' as PlotMode, testIndex: t.index, label: t.unit ? `${t.name} (${t.unit})` : t.name }))
          : [{ plotMode: 'value' as PlotMode, label: MODE_LABELS.value }])
      : [];
    const binEntries: ModeEntry[] = [
      ...(hasHbin ? [{ plotMode: 'hardbin'  as PlotMode, label: MODE_LABELS.hardbin }] : []),
      ...(hasSbin ? [{ plotMode: 'softbin'  as PlotMode, label: MODE_LABELS.softbin }] : []),
    ];
    const stackedEntries: ModeEntry[] = [
      ...(hasValues ? [{ plotMode: 'stackedValues'   as PlotMode, label: MODE_LABELS.stackedValues }]   : []),
      ...(hasHbin   ? [{ plotMode: 'stackedBins'     as PlotMode, label: MODE_LABELS.stackedBins }]     : []),
      ...(hasSbin   ? [{ plotMode: 'stackedSoftBins' as PlotMode, label: MODE_LABELS.stackedSoftBins }] : []),
    ];

    const menu = document.createElement('div');
    const btnRect = btnMode.getBoundingClientRect();
    Object.assign(menu.style, {
      position:      'fixed',
      top:           `${btnRect.bottom + 4}px`,
      left:          `${btnRect.left}px`,
      background:    CLR.menuBg,
      border:        `1px solid ${CLR.menuBorder}`,
      borderRadius:  '4px',
      boxShadow:     '0 4px 12px rgba(0,0,0,0.15)',
      zIndex:        '9998',
      minWidth:      '180px',
      padding:       '4px 0',
      pointerEvents: 'auto',
    });

    // ── Test Value section ──────────────────────────────────────────────────
    if (testEntries.length) {
      menu.appendChild(makeMenuSection('Test Value'));
      if (testEntries.length <= INLINE_TEST_LIMIT) {
        for (const entry of testEntries) {
          menu.appendChild(makeMenuRow(entry.label, isCurrentEntry(entry), true, e => {
            e.stopPropagation(); pickEntry(entry, menu);
          }));
        }
      } else {
        const cascadeActive = currentMode === 'value';
        const cascadeRow = makeMenuRow(MODE_LABELS.value + ' ▶', cascadeActive, false, () => {});
        cascadeRow.style.display        = 'flex';
        cascadeRow.style.justifyContent = 'space-between';
        cascadeRow.style.alignItems     = 'center';
        let subMenu: HTMLDivElement | null = null;
        const openSub = () => {
          if (subMenu) return;
          const rowRect = cascadeRow.getBoundingClientRect();
          subMenu = document.createElement('div');
          Object.assign(subMenu.style, {
            position: 'fixed', top: `${rowRect.top - 4}px`, left: `${rowRect.right + 2}px`,
            background: CLR.menuBg, border: `1px solid ${CLR.menuBorder}`, borderRadius: '4px',
            boxShadow: '0 4px 12px rgba(0,0,0,0.15)', zIndex: '9999',
            minWidth: '160px', maxHeight: '320px', overflowY: 'auto',
            padding: '4px 0', pointerEvents: 'auto',
          });
          for (const entry of testEntries) {
            subMenu.appendChild(makeMenuRow(entry.label, isCurrentEntry(entry), false, e => {
              e.stopPropagation(); subMenu?.remove(); subMenu = null; pickEntry(entry, menu);
            }));
          }
          document.body.appendChild(subMenu);
          document.addEventListener('click', closeSub, { once: true });
        };
        const closeSub = () => { subMenu?.remove(); subMenu = null; };
        cascadeRow.addEventListener('mouseenter', openSub);
        cascadeRow.addEventListener('mouseleave', e => {
          if (subMenu && subMenu.contains(e.relatedTarget as Node)) return;
          closeSub();
        });
        menu.appendChild(cascadeRow);
      }
    }

    // ── Bins section ────────────────────────────────────────────────────────
    if (binEntries.length) {
      menu.appendChild(makeMenuSection('Bins'));
      for (const entry of binEntries) {
        menu.appendChild(makeMenuRow(entry.label, isCurrentEntry(entry), false, e => {
          e.stopPropagation(); pickEntry(entry, menu);
        }));
      }
    }

    // ── Lot aggregation section ──────────────────────────────────────────────
    if (stackedEntries.length) {
      menu.appendChild(makeMenuSection('Lot Aggregation'));
      for (const entry of stackedEntries) {
        menu.appendChild(makeMenuRow(entry.label, isCurrentEntry(entry), false, e => {
          e.stopPropagation(); pickEntry(entry, menu);
        }));
      }
    }

    document.body.appendChild(menu);
    setOpenMenu(menu);
  });

  const btnPalette = makeDropdown(
    'palette', 'Colour scheme',
    () => listColorSchemes().map(s => ({ value: s.name, label: s.label })),
    () => sharedOpts.colorScheme ?? 'color',
    v => applyShared({ colorScheme: v }),
  );

  const btnRings = makeBtn('rings', 'Toggle ring boundaries', () => {
    applyShared({ showRingBoundaries: !sharedOpts.showRingBoundaries });
    setActive(btnRings, !!sharedOpts.showRingBoundaries);
  });

  const btnQuadrants = makeBtn('quadrants', 'Toggle quadrant boundaries', () => {
    applyShared({ showQuadrantBoundaries: !sharedOpts.showQuadrantBoundaries });
    setActive(btnQuadrants, !!sharedOpts.showQuadrantBoundaries);
  });

  const btnLabels = makeBtn('labels', 'Toggle die labels', () => {
    applyShared({ showText: !sharedOpts.showText });
    setActive(btnLabels, !!sharedOpts.showText);
  });

  const btnReticle = makeBtn('reticle', 'Toggle reticle overlay', () => {
    applyShared({ showReticle: !sharedOpts.showReticle });
    setActive(btnReticle, !!sharedOpts.showReticle);
  });

  const btnXY = makeBtn('xyIndicator', 'Toggle XY axis indicator', () => {
    applyShared({ showXYIndicator: !sharedOpts.showXYIndicator });
    setActive(btnXY, !!sharedOpts.showXYIndicator);
  });

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
      for (const ctrl of cardControllers) ctrl.setOptions({ legendPosition: currentLegendStyle });
    },
  );

  function syncLegendStyleBtn(): void {
    const isBinMode = sharedOpts.plotMode === 'hardbin' || sharedOpts.plotMode === 'softbin';
    btnLegendStyle.style.opacity       = isBinMode ? '' : '0.35';
    btnLegendStyle.style.pointerEvents = isBinMode ? '' : 'none';
  }
  syncLegendStyleBtn();

  const btnRotate = makeBtn('rotateCW', 'Rotate all 90\xB0 clockwise', () => {
    const r = sharedOpts.rotation ?? 0;
    applyShared({ rotation: ROTATIONS[(ROTATIONS.indexOf(r) + 3) % 4] });
  });

  const btnFlipH = makeBtn('flipH', 'Flip all horizontal', () => {
    applyShared({ flipX: !sharedOpts.flipX });
    setActive(btnFlipH, !!sharedOpts.flipX);
  });

  const btnFlipV = makeBtn('flipV', 'Flip all vertical', () => {
    applyShared({ flipY: !sharedOpts.flipY });
    setActive(btnFlipV, !!sharedOpts.flipY);
  });

  const btnDownloadAll = makeBtn('downloadAll', 'Download gallery PNG', downloadGalleryPng);

  if (showPlotModeSelector) barEl.appendChild(btnMode);
  barEl.appendChild(btnPalette);
  barEl.appendChild(makeSep());
  barEl.appendChild(btnRings);
  barEl.appendChild(btnQuadrants);
  barEl.appendChild(btnLabels);
  if (items.some(it => it.hasReticle)) barEl.appendChild(btnReticle);
  barEl.appendChild(btnXY);
  barEl.appendChild(makeSep());
  barEl.appendChild(btnLegendStyle);
  barEl.appendChild(makeSep());
  barEl.appendChild(btnRotate);
  barEl.appendChild(btnFlipH);
  barEl.appendChild(btnFlipV);
  barEl.appendChild(makeSep());
  barEl.appendChild(btnDownloadAll);

  if (showFindingsPanel) {
    btnLotFindings = makeBtn('findings', 'Show lot findings', () => {
      lotFindingsOpen = !lotFindingsOpen;
      setActive(btnLotFindings!, lotFindingsOpen);
      rebuildLotFindingsPanel();
    });
    barEl.appendChild(makeSep());
    barEl.appendChild(btnLotFindings);
  }

  // Sync initial toggle states.
  setActive(btnRings,     !!sharedOpts.showRingBoundaries);
  setActive(btnQuadrants, !!sharedOpts.showQuadrantBoundaries);
  setActive(btnLabels,    !!sharedOpts.showText);
  setActive(btnReticle,   !!sharedOpts.showReticle);
  setActive(btnXY,        !!sharedOpts.showXYIndicator);
  setActive(btnFlipH,     !!sharedOpts.flipX);
  setActive(btnFlipV,     !!sharedOpts.flipY);

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

  const gridEl = document.createElement('div');
  Object.assign(gridEl.style, {
    flex:                    '1 1 0',
    minWidth:                '0',
    display:                 'grid',
    gridTemplateColumns:     'repeat(auto-fill, minmax(240px, 1fr))',
    gap:                     '12px',
  });

  // ── Lot findings side drawer ───────────────────────────────────────────────

  if (showFindingsPanel) {
    lotFindingsPanel = document.createElement('div');
    Object.assign(lotFindingsPanel.style, {
      display:    'none',
      flexDirection: 'column',
      gap:        '6px',
      background: '#fff',
      border:     `1px solid ${CLR.menuBorder}`,
      borderRadius: '8px',
      boxShadow:  '0 4px 12px rgba(0,0,0,0.12)',
      padding:    '10px',
      width:      '240px',
      flexShrink: '0',
      overflowY:  'auto',
      maxHeight:  'calc(100vh - 120px)',
      boxSizing:  'border-box',
      position:   'sticky',
      top:        '8px',
    });
    refreshLotFindingsButton();
  }

  bodyEl.appendChild(gridEl);
  if (lotFindingsPanel) bodyEl.appendChild(lotFindingsPanel);

  container.appendChild(barEl);
  container.appendChild(legendEl);
  container.appendChild(bodyEl);

  // ── Bin legend ─────────────────────────────────────────────────────────────

  function rebuildLegend(): void {
    legendEl.innerHTML = '';
    const mode = sharedOpts.plotMode ?? 'hardbin';

    if (!BIN_LEGEND_MODES.has(mode)) {
      legendEl.style.display = 'none';
      return;
    }

    // Collect unique bins — use hbin or sbin depending on active mode.
    const binSet = new Set<number>();
    for (const item of currentItems) {
      for (const die of item.dies) {
        if (die.partial) continue;
        const b = mode === 'softbin' ? die.sbin : die.hbin;
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
    const activeDefs = mode === 'softbin' ? sharedOpts.sbinDefs : sharedOpts.hbinDefs;
    const binDefMap  = activeDefs ? new Map((activeDefs as BinDef[]).map(d => [d.bin, d])) : null;

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
        background:   binDef?.color ?? scheme.forBin(bin),
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
        applyShared({ highlightBin: next });
      });

      legendEl.appendChild(entry);
    }
  }

  // ── Stacked-mode aggregation helpers ──────────────────────────────────────

  // Build lot-aggregated GalleryItems from originalItems for a stacked mode.
  // One card per bin (stackedBins/stackedSoftBins) or per test parameter (stackedValues).
  function buildStackedItems(mode: PlotMode): GalleryItem[] {
    if (!originalItems.length) return [];
    const allDies   = originalItems.map(item => item.dies);
    const baseWafer = originalItems[0].wafer;

    if (mode === 'stackedValues') {
      const defs   = sharedOpts.testDefs ?? [];
      const method = (sharedOpts.aggrMethod ?? 'mean') as AggregationMethod;
      return defs.map(def => ({
        wafer: baseWafer,
        dies:  aggregateValues(allDies, method, def.index),
        label: def.name,
        sceneOptions: { testDefs: [{ index: 0, name: def.name, unit: def.unit }] },
      }));
    }

    if (mode === 'stackedBins') {
      return (sharedOpts.hbinDefs ?? []).map(def => ({
        wafer: baseWafer,
        dies:  aggregateBinCounts(allDies, def.bin, 'hard'),
        label: `${def.bin} · ${def.name}`,
        sceneOptions: { hbinDefs: [{ bin: def.bin, name: def.name }] },
      }));
    }

    if (mode === 'stackedSoftBins') {
      return (sharedOpts.sbinDefs ?? []).map(def => ({
        wafer: baseWafer,
        dies:  aggregateBinCounts(allDies, def.bin, 'soft'),
        label: `${def.bin} · ${def.name}`,
        sceneOptions: { sbinDefs: [{ bin: def.bin, name: def.name }] },
      }));
    }

    return originalItems;
  }

  // Extra shared options required for stacked modes (colour scale / lot size metadata).
  function stackedSharedOpts(mode: PlotMode): Partial<WaferSceneOptions> {
    const lotSize = originalItems.length;
    if (mode === 'stackedBins' || mode === 'stackedSoftBins')
      return { valueRange: [0, lotSize] as [number, number], lotSize };
    if (mode === 'stackedValues')
      return { aggrMethod: (sharedOpts.aggrMethod ?? 'mean') as AggregationMethod, valueRange: undefined, lotSize: undefined };
    return {};
  }

  // ── Shared option sync ─────────────────────────────────────────────────────

  // Called from toolbar interactions — updates state, handles stacked-mode card rebuilds,
  // propagates to cards, fires callback.
  function applyShared(partial: Partial<WaferSceneOptions>): void {
    const prevMode = sharedOpts.plotMode;
    sharedOpts = { ...sharedOpts, ...partial };
    const newMode    = sharedOpts.plotMode!;
    const nowStacked = STACKED_MODES.has(newMode);
    const wasStacked = prevMode !== undefined && STACKED_MODES.has(prevMode);

    if (partial.plotMode !== undefined) {
      if (nowStacked) {
        // Switching into a stacked mode — aggregate internally and apply extra scene opts.
        const extra = stackedSharedOpts(newMode);
        sharedOpts = { ...sharedOpts, ...extra };
        buildCards(buildStackedItems(newMode));
      } else if (wasStacked) {
        // Clear stacked-specific options when leaving stacked mode
        const { valueRange, lotSize, aggrMethod, ...cleanOpts } = sharedOpts;
        sharedOpts = cleanOpts;
        buildCards(originalItems);
      } else {
        for (const ctrl of cardControllers) ctrl.setOptions(partial);
      }
    } else if (partial.aggrMethod !== undefined && newMode === 'stackedValues') {
      // Aggregation method changed while in stackedValues — re-aggregate.
      buildCards(buildStackedItems('stackedValues'));
    } else {
      for (const ctrl of cardControllers) ctrl.setOptions(partial);
    }

    rebuildLegend();
    syncLegendStyleBtn();
    options.onSceneOptionsChange?.(sharedOpts);
  }

  // Called from the public setOptions API — updates state and cards, does NOT fire callback.
  function syncShared(partial: Partial<WaferSceneOptions>): void {
    const prevMode = sharedOpts.plotMode;
    sharedOpts = { ...sharedOpts, ...partial };
    const newMode    = sharedOpts.plotMode!;
    const nowStacked = STACKED_MODES.has(newMode);
    const wasStacked = prevMode !== undefined && STACKED_MODES.has(prevMode);

    if (partial.plotMode !== undefined) {
      if (nowStacked) {
        // Switching into a stacked mode — aggregate internally and apply extra scene opts.
        const extra = stackedSharedOpts(newMode);
        sharedOpts = { ...sharedOpts, ...extra };
        buildCards(buildStackedItems(newMode));
      } else if (wasStacked) {
        // Clear stacked-specific options when leaving stacked mode
        const { valueRange, lotSize, aggrMethod, ...cleanOpts } = sharedOpts;
        sharedOpts = cleanOpts;
        buildCards(originalItems);
      } else {
        for (const ctrl of cardControllers) ctrl.setOptions(partial);
      }
    } else if (partial.aggrMethod !== undefined && newMode === 'stackedValues') {
      // Aggregation method changed while in stackedValues — re-aggregate.
      buildCards(buildStackedItems('stackedValues'));
    } else {
      for (const ctrl of cardControllers) ctrl.setOptions(partial);
    }

    rebuildLegend();
    syncLegendStyleBtn();
  }

  // ── Card building ──────────────────────────────────────────────────────────

  function buildCards(newItems: GalleryItem[]): void {
    getOpenMenu()?.remove(); setOpenMenu(null);
    clearLotFindingHighlight();
    currentItems = newItems;
    for (const ctrl of cardControllers) ctrl.destroy();
    cardControllers = [];
    gridEl.innerHTML = '';
    rebuildLegend();

    for (const item of newItems) {
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
      const label = document.createElement('span');
      label.textContent = item.label ?? '';
      Object.assign(label.style, { fontWeight: '700', fontSize: '13px', flex: '1' });
      header.appendChild(label);

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

      // Wrap canvas in a positioned container so the toolbar (position:absolute,
      // top:4px) anchors within the canvas area, not the full card including header.
      const canvasWrapper = document.createElement('div');
      Object.assign(canvasWrapper.style, {
        position: 'relative',
        flex:     '1',
        minHeight:'0',
        overflow: 'hidden',
      });

      const canvas = document.createElement('canvas');
      Object.assign(canvas.style, {
        aspectRatio: '1',
        width:       '100%',
        display:     'block',
      });
      canvasWrapper.appendChild(canvas);
      card.appendChild(canvasWrapper);

      // Append to DOM before renderWaferMap so the canvas has a resolved CSS
      // layout size when the initial render() fires — avoids a zero-size first
      // render that the ResizeObserver would otherwise need to correct.
      gridEl.appendChild(card);

      const ctrl = renderWaferMap(canvas, item.wafer, item.dies, {
        sceneOptions:    item.sceneOptions ? { ...sharedOpts, ...item.sceneOptions } : sharedOpts,
        toolbarControls: 'view-only',
        showTooltip:     true,
        padding:         cardPadding,
        legendPosition:     currentLegendStyle,
        fallbackFormat:  currentFallbackFormat,
        onClick:         item.onClick,
        onSelect:        item.onSelect,
      });
      cardControllers.push(ctrl);

      // Only the expand button opens the modal — canvas clicks are handled
      // internally by renderWaferMap and stop propagation before reaching here.
      expandBtn.addEventListener('click', () => openModal(item));
    }
  }

  originalItems = items;
  // If the initial plotMode is already a stacked mode, aggregate immediately.
  if (STACKED_MODES.has(sharedOpts.plotMode!) && originalItems.length > 0) {
    const extra = stackedSharedOpts(sharedOpts.plotMode!);
    sharedOpts = { ...sharedOpts, ...extra };
    buildCards(buildStackedItems(sharedOpts.plotMode!));
  } else {
    buildCards(items);
  }

  // ── Modal ──────────────────────────────────────────────────────────────────

  function openModal(item: GalleryItem): void {
    if (modalController) closeModal();

    savedBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const backdrop = document.createElement('div');
    backdrop.id = 'wmap-modal-backdrop';
    Object.assign(backdrop.style, {
      position:       'fixed',
      inset:          '0',
      background:     'rgba(0,0,0,0.6)',
      display:        'flex',
      alignItems:     'center',
      justifyContent: 'center',
      zIndex:         '9000',
      backdropFilter: 'blur(3px)',
    });

    const box = document.createElement('div');
    Object.assign(box.style, {
      background:    '#fff',
      borderRadius:  '12px',
      overflow:      'hidden',
      display:       'flex',
      flexDirection: 'column',
      width:         'min(90vw, 700px)',
      height:        'min(90vh, 700px)',
      boxShadow:     '0 20px 60px rgba(0,0,0,0.4)',
    });

    const modalHeader = document.createElement('div');
    Object.assign(modalHeader.style, {
      display:       'flex',
      alignItems:    'center',
      padding:       '10px 14px',
      borderBottom:  '1px solid #e2e5ea',
      flexShrink:    '0',
    });
    const modalTitle = document.createElement('span');
    modalTitle.textContent = item.label ?? '';
    Object.assign(modalTitle.style, { fontWeight: '700', fontSize: '14px' });
    const spacer = document.createElement('div');
    spacer.style.flex = '1';
    const closeBtn = document.createElement('button');
    closeBtn.textContent = '\xD7';
    closeBtn.title = 'Close (Esc)';
    Object.assign(closeBtn.style, {
      border:       'none',
      background:   'transparent',
      fontSize:     '20px',
      cursor:       'pointer',
      color:        '#888',
      lineHeight:   '1',
      padding:      '0 2px',
    });
    closeBtn.addEventListener('click', closeModal);
    modalHeader.appendChild(modalTitle);
    modalHeader.appendChild(spacer);
    modalHeader.appendChild(closeBtn);

    const modalCanvasWrap = document.createElement('div');
    Object.assign(modalCanvasWrap.style, {
      flex:     '1',
      minHeight: '0',
      position: 'relative',
    });

    const modalCanvas = document.createElement('canvas');
    Object.assign(modalCanvas.style, {
      width:   '100%',
      height:  '100%',
      display: 'block',
    });

    modalCanvasWrap.appendChild(modalCanvas);
    box.appendChild(modalHeader);
    box.appendChild(modalCanvasWrap);
    backdrop.appendChild(box);
    document.body.appendChild(backdrop);

    modalController = renderWaferMap(modalCanvas, item.wafer, item.dies, {
      sceneOptions:    item.sceneOptions ? { ...sharedOpts, ...item.sceneOptions } : sharedOpts,
      toolbarControls: 'full',
      showTooltip:     true,
      legendPosition:     currentLegendStyle,
      fallbackFormat:  options.fallbackFormat,
      statsSummary:    item.statsSummary,
      onClick:         item.onClick,
      onSelect:        item.onSelect,
    });

    // Close on backdrop click (not box).
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) closeModal();
    });

    document.addEventListener('keydown', onModalKeyDown);
  }

  function onModalKeyDown(e: KeyboardEvent): void {
    if (e.key === 'Escape') closeModal();
  }

  function closeModal(): void {
    if (!modalController) return;
    modalController.destroy();
    modalController = null;
    document.getElementById('wmap-modal-backdrop')?.remove();
    document.body.style.overflow = savedBodyOverflow;
    document.removeEventListener('keydown', onModalKeyDown);
  }

  // ── Gallery PNG download ───────────────────────────────────────────────────

  function downloadGalleryPng(): void {
    const canvases = [...gridEl.querySelectorAll<HTMLCanvasElement>('canvas')];
    if (!canvases.length) return;
    const N     = canvases.length;
    const cols  = Math.ceil(Math.sqrt(N));
    const rows  = Math.ceil(N / cols);
    const cellW = canvases[0].width;
    const cellH = canvases[0].height;
    const gap   = 8;
    const off   = document.createElement('canvas');
    off.width   = cols * cellW + (cols - 1) * gap;
    off.height  = rows * cellH + (rows - 1) * gap;
    const ctx   = off.getContext('2d')!;
    ctx.fillStyle = '#f0f2f5';
    ctx.fillRect(0, 0, off.width, off.height);
    canvases.forEach((c, i) => {
      ctx.drawImage(c, (i % cols) * (cellW + gap), Math.floor(i / cols) * (cellH + gap));
    });
    off.toBlob(blob => {
      if (!blob) return;
      const a = Object.assign(document.createElement('a'), {
        href:     URL.createObjectURL(blob),
        download: `${downloadFilename}.png`,
      });
      a.click();
      URL.revokeObjectURL(a.href);
    });
  }

  // ── Controller ─────────────────────────────────────────────────────────────

  return {
    setItems(newItems: GalleryItem[]): void {
      originalItems = newItems;
      const mode = sharedOpts.plotMode!;
      if (STACKED_MODES.has(mode)) {
        // Refresh lotSize and valueRange in case the wafer count changed.
        const extra = stackedSharedOpts(mode);
        sharedOpts = { ...sharedOpts, ...extra };
        buildCards(buildStackedItems(mode));
      } else {
        buildCards(newItems);
      }
    },

    setOptions(partial: Partial<WaferSceneOptions>): void {
      syncShared(partial);
    },

    getOptions(): WaferSceneOptions {
      return { ...sharedOpts };
    },

    setFallbackFormat(format: 'si' | 'engineering'): void {
      currentFallbackFormat = format;
      for (const ctrl of cardControllers) ctrl.setFallbackFormat(format);
    },

    setLotStatsSummary(summary: LotStatsSummary | undefined): void {
      currentLotStats = summary;
      rebuildLotFindingsPanel();
    },

    destroy(): void {
      closeModal();
      for (const ctrl of cardControllers) ctrl.destroy();
      cardControllers = [];
      getOpenMenu()?.remove();
      document.removeEventListener('click', closeOpenMenu, true);
      tooltip.remove();
      barEl.remove();
      legendEl.remove();
      bodyEl.remove();
    },
  };
}
