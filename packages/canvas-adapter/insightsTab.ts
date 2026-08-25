// Insights — full-takeover chart/stats suite (Overview, Distributions,
// Correlation sub-tabs), extracted from the former analysisTab.ts and
// extended with an Overview sub-tab. Findings are deliberately NOT one of
// these sub-tabs — a finding's entire value is click-to-highlight-on-map,
// which cannot work inside a full takeover of the map; see summaryPanel.ts's
// always-docked Summary panel for that (and for a compact, always-available
// view of the same yield/bin/ring/quadrant/test-value numbers this tab
// charts — both read `buildRegionYieldData`/`StatsSummary.stats.*` directly,
// so the two surfaces can overlap without ever disagreeing).
//
// Grouping ("Group by") naturally disappears for a single-wafer host: with
// one item, `buildFacetTable` never finds a splittable field (every value
// is unique-per-item by definition), so the control just doesn't render —
// no special-casing needed here for single- vs multi-wafer hosts.
//
// Known follow-up (not done in this pass): Distributions' three panels
// (capability/boxplot/histogram) each still own a different grouping
// interaction — capability's own restrict-to-one-group dropdown, boxplot's
// pooled-overview-with-drill, histogram's overlay-with-legend. Unifying
// these under one shared drill control is a distinct, separable
// improvement from the Insights tab's own internal design, not part of
// this file's relationship to the Summary panel.

import type { Die } from '../core/dies.js';
import type { Wafer } from '../core/wafer.js';
import type { LotStatsSummary, StatsSummary } from '../stats/types.js';
import { buildFacetTable, facetValueOf, FACET_NONE_VALUE, type FacetItem } from '../stats/facets.js';
import { isParametricTest, type TestDef } from '../renderer/buildWaferMap.js';
import type { WaferMapDisplayItem } from './renderWaferGallery.js';
import { getColorScheme } from '../renderer/colorSchemes.js';
import { CLR, type SaveImageHandler, type SaveTextHandler } from './toolbar.js';
import { renderCapabilityPanel } from './charts/capability.js';
import { renderBoxplotPanel } from './charts/boxplot.js';
import { renderHistogramPanel } from './charts/histogram.js';
import { renderCorrelationPanel } from './charts/correlation.js';
import { renderScatterPanel } from './charts/scatter.js';
import { renderBarPanel, type ChartPanel } from './charts/barPanel.js';
import { renderBinClusterPanel } from './charts/binCluster.js';
import { QUANTITY } from './charts/palette.js';
import { makeChartGridWrap, makeLabeledSelect } from './charts/chartShell.js';
import { buildYieldData, buildYieldDataCombined, type YieldSortBy } from '../stats/yield.js';
import { buildBinParetoData, type BinType } from '../stats/binPareto.js';
import { buildLotTestSection, buildLotFunctionalSection, buildMetadataStripBox } from './summaryPanel.js';
import { buildRegionYieldData, buildRingRegions, buildQuadrantRegions } from '../stats/regions.js';
import { renderRegionYieldDiagram } from './charts/regionYieldDiagram.js';

export type InsightsView = 'overview' | 'distributions' | 'correlation';

/** Public option shape for `RenderOptions.insights`/`GalleryOptions.insights`. */
export interface InsightsOptions {
  /**
   * Show an "Insights" tab in the toolbar. Selecting it replaces the canvas/
   * grid with wmap's own chart suite across three sub-tabs — Overview
   * (yield, bins, ring/quadrant yield, test values), Distributions
   * (process capability, boxplot, histogram), and Correlation (matrix +
   * scatter). Default false.
   */
  enabled?: boolean;
  /** Which sub-tab is shown first. Default 'overview'. */
  defaultView?: InsightsView;
}

export interface InsightsTabDeps {
  /** Current gallery/single-wafer items — read fresh each render (a gallery's list can still be building). `null` entries (not-yet-built cards) are skipped. */
  getItems: () => Array<WaferMapDisplayItem | null>;
  /** Precomputed lot-level yield, when the host has one — reused directly instead of recomputing (see stats/yield.ts). Omit when there is no lot (e.g. a single wafer). */
  getLotStats?: () => LotStatsSummary | undefined;
  /** Read fresh each render so a live colour-scheme change is picked up. */
  getColorSchemeName: () => string;
  passBins: number[];
  /** Read fresh each render — used by the Overview tab's ring/quadrant regional yield cards. Default 4. */
  getRingCount?: () => number;
  onSaveImage?: SaveImageHandler;
  /** Optional host hook for the Overview tab's test-values "Export CSV" button — see `saveTextFile` (toolbar.ts). */
  onSaveText?: SaveTextHandler;
  /**
   * Opens one wafer's detail view — omit to disable click-to-open (e.g. a
   * single-wafer host, where the only wafer is already the one on screen).
   * `testNumber`, when given (boxplot leaf-row clicks), asks the host to
   * open the map in test-value mode on that test rather than its default
   * plot mode — so opening from a specific test's boxplot row lands on that
   * same test instead of hard-bin mode.
   */
  openWafer?: (waferIndex: number, label: string, testNumber?: number) => void;
  /** Default sub-tab shown on first render. Default 'overview'. */
  defaultView?: InsightsView;
  /**
   * When provided, the tab bar gets a leading "‹ Map"/"‹ Gallery" tab that
   * exits Insights back to the host's normal view — one visible navigation
   * model (a tab row) instead of relying on the host toolbar's icon-swap
   * toggle alone, whose "way back" is discoverable only via tooltip.
   */
  backTab?: { label: string; onBack: () => void };
  /**
   * Show this tab's own identity strip (lot/wafer/product/etc.), mounted
   * above the Overview/Distributions/Correlation tab bar so it stays in the
   * same place across every sub-tab. Default true — needed by
   * `renderWaferMap.ts`, whose single-wafer `metadataBadge` overlay sits
   * under this tab's opaque inset:0 root and is fully covered while Insights
   * is open, so this strip is its only identity display there.
   * `renderWaferGallery.ts` sets this false: its own legend strip (built from
   * the same wafer/lot metadata, via the same `buildMetadataStripRow`) stays
   * mounted above the grid/Insights body in both views, so this strip would
   * just be a second, independent copy of the same content — see
   * renderWaferGallery.ts's `rebuildLegend`/`setInsightsOpen`.
   */
  showMetadataStrip?: boolean;
  /** Document to build this tab's DOM into. Default `document` — pass the
   *  render's own `ownerDocument` when the container might live in a
   *  different document (e.g. a gallery card detached into its own popup
   *  window). */
  ownerDocument?: Document;
}

export interface InsightsTabHandle {
  /** Append this wherever the tab's content should live; starts hidden (`display: none`). */
  el: HTMLElement;
  /** (Re)builds the tab's content from the current items — call whenever the tab is opened. */
  render: () => void;
  /** Tears down every live panel's observers and removes `el`. */
  destroy: () => void;
}

type Item = FacetItem & { dies: Die[]; label: string; waferIndex: number; wafer: Wafer; statsSummary?: StatsSummary };

const VIEWS: Array<{ key: InsightsView; label: string }> = [
  { key: 'overview',      label: 'Overview' },
  { key: 'distributions', label: 'Distributions' },
  { key: 'correlation',   label: 'Correlation' },
];

export function createInsightsTab(deps: InsightsTabDeps): InsightsTabHandle {
  const { getItems, getLotStats, getColorSchemeName, passBins, getRingCount, onSaveImage, onSaveText, openWafer } = deps;
  const showMetadataStrip = deps.showMetadataStrip ?? true;
  const doc = deps.ownerDocument ?? document;

  // Deliberately auto-height, normal block/flex flow — no forced minHeight,
  // no flex-grow, no own overflow-y. `flex:1 1 0; min-height:0` (the usual
  // "scroll me within my parent" pattern) only behaves correctly when the
  // parent already has a *definite* bounding height to distribute; here the
  // parent varies by host (renderWaferGallery.ts mounts this as a plain
  // block child with no bound at all — `flex:1 1 0` is simply ignored by a
  // non-flex parent, so this element would sit at exactly its own
  // min-height floor and silently clip the rest via overflow, which is
  // exactly the "large empty grey band, content cut off" bug this replaced.
  // Any host that DOES want a bounded/scrollable Insights view (e.g.
  // renderWaferMap.ts's position:absolute;inset:0 overlay, which has a real
  // bound from its own container) should apply overflow-y:auto on ITS OWN
  // wrapper instead, not rely on this element doing it internally.
  const rootEl = doc.createElement('div');
  Object.assign(rootEl.style, {
    display: 'none',
    flexDirection: 'column',
    gap: '10px',
    width: '100%',
  } as Partial<CSSStyleDeclaration>);

  // Identity strip (lot/wafer/product/etc.) — mounted above the tab bar so
  // it stays in the same place across every sub-tab, instead of living
  // inside the Overview tab's own content and disappearing on
  // Distributions/Correlation. Rebuilt on every `render()` alongside the
  // active sub-tab's content; only mounted when `showMetadataStrip`.
  const metaStripEl = doc.createElement('div');

  const tabBar = doc.createElement('div');
  Object.assign(tabBar.style, { display: 'flex', gap: '4px', borderBottom: `1px solid ${CLR.menuBorder}`, marginBottom: '2px' } as Partial<CSSStyleDeclaration>);
  tabBar.setAttribute('role', 'tablist');
  // Registered once, not per-`render()` — `tabBar` itself persists across
  // sub-tab switches (only its children are torn down and rebuilt), so this
  // would otherwise accumulate a duplicate listener on every switch. Left/
  // Right roving focus per the APG Tabs pattern; only targets `[role="tab"]`
  // children, so the leading "‹ Map"/"‹ Gallery" back button (a plain
  // button, not part of this tablist) is never included.
  tabBar.addEventListener('keydown', e => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const tabs = Array.from(tabBar.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
    const idx = tabs.indexOf(doc.activeElement as HTMLButtonElement);
    if (idx === -1) return;
    e.preventDefault();
    const next = tabs[(idx + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length];
    next.focus();
    next.click();
  });

  // Same reasoning as rootEl above — auto-height, no flex-grow/min-height:0
  // "fill and scroll" pattern, since there's no guaranteed bounded ancestor
  // to grow into across every host.
  const bodyEl = doc.createElement('div');
  Object.assign(bodyEl.style, { display: 'flex', flexDirection: 'column', gap: '10px' } as Partial<CSSStyleDeclaration>);

  rootEl.appendChild(metaStripEl);
  rootEl.appendChild(tabBar);
  rootEl.appendChild(bodyEl);

  let activeView: InsightsView = deps.defaultView ?? 'overview';
  let analysisGroupKey: string | undefined;
  let panelHandles: Array<{ destroy: () => void }> = [];

  function openWaferDetailModal(waferIndex: number, title: string, testNumber?: number): void {
    openWafer?.(waferIndex, title, testNumber);
  }

  function facetItems(): Item[] {
    // Map before filtering so `waferIndex` stays the same index a host's
    // `lotYieldSeries` was computed against (filtering-then-mapping would
    // shift indices whenever any item is still null/not-yet-built).
    return getItems()
      .map((it, waferIndex): Item | null => it == null ? null : {
        metadata: it.wafer.metadata ?? undefined, dies: it.dies, wafer: it.wafer,
        label: it.label ?? String(it.wafer.metadata?.waferId ?? ''), waferIndex,
        statsSummary: it.statsSummary,
      })
      .filter((it): it is Item => it != null);
  }

  function styleTabButton(btn: HTMLButtonElement, isActive: boolean): void {
    Object.assign(btn.style, {
      background:   'none',
      border:       'none',
      borderBottom: isActive ? `2px solid ${CLR.iconActive}` : '2px solid transparent',
      color:        isActive ? CLR.iconActive : CLR.label,
      fontWeight:   isActive ? '700' : '500',
      fontSize:     '12px',
      padding:      '6px 10px 8px',
      cursor:       'pointer',
      marginBottom: '-1px',
    } as Partial<CSSStyleDeclaration>);
  }

  function makeTabButton(view: InsightsView, label: string): HTMLButtonElement {
    const btn = doc.createElement('button');
    btn.type = 'button';
    btn.textContent = label;
    const isActive = view === activeView;
    styleTabButton(btn, isActive);
    btn.dataset.wmapInsightsTab = view;
    btn.setAttribute('role', 'tab');
    btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
    // Roving tabindex (APG Tabs pattern): only the active tab sits in the
    // page's Tab order; Left/Right (wired on tabBar above) moves among the
    // rest without adding every tab to it.
    btn.tabIndex = isActive ? 0 : -1;
    btn.addEventListener('click', () => { if (activeView !== view) { activeView = view; render(); } });
    return btn;
  }

  /** Leading "‹ Map"/"‹ Gallery" tab — exits Insights via `deps.backTab`. */
  function makeBackTabButton(back: { label: string; onBack: () => void }): HTMLButtonElement {
    const btn = doc.createElement('button');
    btn.type = 'button';
    btn.textContent = `‹ ${back.label}`;
    styleTabButton(btn, false);
    btn.dataset.wmapInsightsBack = '1';
    btn.addEventListener('click', back.onBack);
    return btn;
  }

  /** Yield-by-wafer + bin pareto together. Yield always uses the generic bar
   *  panel (`barPanel.ts`), grouped or not — pooled-per-group bars with
   *  in-place drill-down when grouped. Bin pareto swaps to a clustered panel
   *  (`binCluster.ts`) when grouped rather than a variant of the plain
   *  pareto. Both belong to Overview: they're the chart form of the same
   *  yield/bin numbers the Overview details card shows in kv/progress-bar
   *  form below them. */
  function renderYieldBinsSection(
    items: Item[],
    groups: { key: string; items: Item[] }[] | undefined,
    groupLabelText: string | undefined,
    /** False for a single-wafer host — a one-bar "Yield by wafer" chart with
     *  sort controls that can never reorder anything is noise; the caller
     *  renders stat tiles instead (see renderSingleWaferTiles). */
    includeYieldPanel = true,
  ): { card: HTMLElement; destroy: () => void } {
    const wrap = makeChartGridWrap(doc);

    const scheme = getColorScheme(getColorSchemeName());
    let yieldSortBy: YieldSortBy = 'label';
    const label = groupLabelText ?? 'group';
    // CLAUDE.md: "yield label must name the actual pass bins in use, not
    // assume bin 1" — mirrors renderSummaryReportHtml's summary-metric label.
    const passBinsLabel = passBins.length === 1 ? `bin ${passBins[0]}` : `bins ${passBins.join(', ')}`;

    // Prefer each wafer's already-computed yield (e.g. from the host's
    // `analyzeWaferLot` call) over recomputing from dies — guarantees this
    // panel agrees exactly with whatever else in the host already reports
    // yield for the same wafer, rather than trusting a second,
    // independently-written computation to stay in sync (see
    // stats/yield.ts's doc comment — a real mismatch was found and fixed
    // this way).
    const lotStats = getLotStats?.();
    // Indexed once per render rather than `.find()`-scanned per item — a
    // per-item linear scan over `lotYieldSeries` turns this into an O(wafers²)
    // pass for a large lot (redone on every "Group by"/sort change too).
    const yieldByWaferIndex = new Map(lotStats?.lotYieldSeries.map(y => [y.waferIndex, y.yieldPercent]));
    const withYieldPercent = (item: Item) => ({
      ...item,
      // Host card labels often embed the yield themselves ("W01 · 92.7%") —
      // strip that here, since this panel prints the % in its own value
      // column and the doubled number read as two different stats.
      label: item.label.replace(/\s*·\s*\d+(\.\d+)?%$/, ''),
      yieldPercent: yieldByWaferIndex.get(item.waferIndex),
      key: item.waferIndex,
    });
    const yieldItems = items.map(withYieldPercent);
    const yieldGroups = groups?.map(g => ({ key: g.key, items: g.items.map(withYieldPercent) }));

    const makeYieldData = () => yieldGroups
      ? buildYieldDataCombined(yieldGroups, passBins, yieldSortBy)
      : buildYieldData(yieldItems, passBins, yieldSortBy);

    const yieldPanelConfig: ChartPanel = {
      title: groups ? `Yield by ${label} (pass: ${passBinsLabel})` : `Yield by wafer (pass: ${passBinsLabel})`,
      data: makeYieldData(),
      selfControl: {
        current: yieldSortBy,
        options: [['yield', 'Sort: yield'], ['label', groups ? `Sort: ${label}` : 'Sort: wafer ID']],
        onChange: v => { yieldSortBy = v as YieldSortBy; return { data: makeYieldData() }; },
      },
      // One neutral fill for every yield bar (palette.ts) — bar length and
      // the printed % already carry the value. The map value ramp here made
      // good yields render in alarm colours, and its data-range
      // normalization could paint a *better* wafer redder than a worse one.
      barColor: () => QUANTITY,
      valueLabel: datum => `${datum.percent.toFixed(1)}%`,
      drill: yieldGroups ? {
        onOpenGroup: datum => {
          const detailItems = yieldGroups.find(g => g.key === datum.label)?.items ?? [];
          return { data: buildYieldData(detailItems, passBins, yieldSortBy), title: `Yield by wafer — ${label}: ${datum.label} (pass: ${passBinsLabel})` };
        },
        onBack: () => ({ data: makeYieldData(), title: `Yield by ${label} (pass: ${passBinsLabel})` }),
        groupLabelText: label,
      } : undefined,
      // Sorted rows can't be index-correlated back to `items` by position, so
      // resolve via `datum.key` (set to `waferIndex` above by `withYieldPercent`)
      // — not `label`, which two items can share (e.g. both fall back to the
      // same default when neither supplies a label nor a wafer ID), which
      // would silently open the wrong wafer.
      onOpen: openWafer ? datum => {
        if (typeof datum.key === 'number') openWaferDetailModal(datum.key, `Wafer ${datum.label}`);
      } : undefined,
      ownerDocument: doc,
    };
    let yieldPanel: ReturnType<typeof renderBarPanel> | null = null;
    if (includeYieldPanel) {
      yieldPanel = renderBarPanel(yieldPanelConfig, onSaveImage);
      yieldPanel.card.style.minHeight = '360px';
      wrap.appendChild(yieldPanel.card);
    }

    if (groups) {
      const binCluster = renderBinClusterPanel({
        title: 'Hard bin pareto',
        groups: groups.map(g => ({
          key: g.key,
          items: g.items.map(it => ({
            dies: it.dies,
            hardBinCounts: it.statsSummary?.stats.hardBinCounts,
            softBinCounts: it.statsSummary?.stats.softBinCounts,
          })),
        })),
        colorScheme: getColorSchemeName(),
        onSaveImage,
        ownerDocument: doc,
      });
      binCluster.card.style.minHeight = '360px';
      wrap.appendChild(binCluster.card);
      return { card: wrap, destroy: () => { yieldPanel?.destroy(); binCluster.destroy(); } };
    }

    let binType: BinType = 'hbin';
    const binColorFn = scheme.forBin;
    // Threads each item's already-computed StatsSummary bin counts through
    // (see stats/types.ts's hardBinCounts/softBinCounts doc comment) so
    // buildBinParetoData can skip re-walking `dies` when available.
    const binItems = items.map(it => ({
      dies: it.dies,
      hardBinCounts: it.statsSummary?.stats.hardBinCounts,
      softBinCounts: it.statsSummary?.stats.softBinCounts,
    }));
    const makeBinData = () => buildBinParetoData(binItems, binType);
    const binPanelConfig: ChartPanel = {
      title: 'Hard bin pareto',
      data: makeBinData(),
      selfControl: {
        current: binType,
        options: [['hbin', 'Hard bins'], ['sbin', 'Soft bins']],
        onChange: v => { binType = v as BinType; return { data: makeBinData(), title: `${binType === 'hbin' ? 'Hard' : 'Soft'} bin pareto` }; },
      },
      // Bin identity keeps the map's registered scheme (forBin) so bins match
      // the wafer view — including the accessible scheme when selected.
      // binCode undefined ⇒ bin 0, the codebase-wide no-data grey sentinel.
      barColor: datum => binColorFn(datum.binCode ?? 0),
      ownerDocument: doc,
    };
    const binPanel = renderBarPanel(binPanelConfig, onSaveImage);
    binPanel.card.style.minHeight = '360px';
    wrap.appendChild(binPanel.card);
    return { card: wrap, destroy: () => { yieldPanel?.destroy(); binPanel.destroy(); } };
  }

  /** A plain (non-canvas) content card matching the chart panels' own
   *  visual language (chartShell.ts's cardShell) — same border/background/
   *  radius/padding — but without the save-image/expand chrome, since there's
   *  no canvas here. Sized as a normal grid item so it wraps responsively at
   *  the same width as every other card in this suite, instead of stretching
   *  to the full container width. */
  function plainCard(): HTMLDivElement {
    const card = doc.createElement('div');
    // Same structural role as chartShell.ts's cardShell() in the Overview
    // grid, just without a chart title to attach — mark it so tooling
    // doesn't have to special-case "a card with no data-wmap-chart-title".
    card.dataset.wmapChartCard = '1';
    Object.assign(card.style, {
      display: 'flex', flexDirection: 'column', gap: '10px', minWidth: '0',
      background: CLR.menuBg, border: `1px solid ${CLR.menuBorder}`, borderRadius: '6px',
      padding: '12px',
    } as Partial<CSSStyleDeclaration>);
    return card;
  }

  /** Rebuilds `metaStripEl` from the current items — via `buildMetadataStripBox`,
   *  the same facet-based builder the gallery legend strip uses, so a
   *  varying field (e.g. a lot with mixed `split` values) always shows every
   *  distinct value it takes instead of collapsing to one wafer's value
   *  (`analyzeWaferLot`'s `lot` field is first-wafer-wins and deliberately
   *  NOT used here for that reason). Mounted above the tab bar, outside
   *  `bodyEl`, so it never disappears when switching sub-tabs. */
  function renderMetadataStrip(items: Item[]): void {
    metaStripEl.innerHTML = '';
    if (!showMetadataStrip) return;
    // `facetableOnly: false` keeps `waferId` in the strip — safe here because
    // this tab only ever renders `showMetadataStrip: true` for
    // `renderWaferMap.ts`'s single-wafer host (`renderWaferGallery.ts` passes
    // `false` and shows its own strip instead), so `items` never has more
    // than one entry and there's no risk of a distinct-wafer-ID list
    // cluttering the strip the way it would for a multi-wafer population.
    const box = buildMetadataStripBox(items.map(it => ({ metadata: it.metadata })), undefined, { facetableOnly: false });
    if (box) { box.style.marginBottom = '0'; metaStripEl.appendChild(box); }
  }

  /** Ring/quadrant regional yield, as a wafer-shaped diagram (see
   *  charts/regionYieldDiagram.ts) — each region filled by the registered
   *  colour scheme's value ramp and labelled with its own yield % directly
   *  in the region, plus per-test min/mean/max/spec-yield. The same numbers
   *  the docked Summary panel shows as compact bar-list rows
   *  (`buildRingSection`/`buildQuadrantSection` in summaryPanel.ts) — both
   *  read `buildRegionYieldData` (stats/regions.ts) directly, so this chart
   *  view and the panel's compact rows can never disagree. Ring and
   *  quadrant diagrams get their own card in the shared grid (matching the
   *  yield/bin pareto cards above); Test Values is a table and is returned
   *  separately so the caller can place it full-width instead of squeezed
   *  into a grid cell. */
  function renderOverviewDetailsCards(
    items: Item[],
    testDefs: TestDef[],
    /** UNFILTERED defs — the functional-tests card needs the `testType: 'F'` entries
     *  that `render()` strips from `testDefs` for every parametric panel. */
    allTestDefs: TestDef[],
  ): { elements: HTMLElement[]; testValuesCard: HTMLElement | null; functionalCard: HTMLElement | null; destroy: () => void } {
    if (!items.length) return { elements: [], testValuesCard: null, functionalCard: null, destroy: () => {} };
    const allWafers = items.map(it => it.wafer);
    const diesByWafer = items.map(it => it.dies);
    const allDies = items.flatMap(it => it.dies);
    const summaries = items.map(it => it.statsSummary);
    const perWaferSummaries = summaries.every((s): s is StatsSummary => s !== undefined) ? summaries : undefined;
    const ringCount = getRingCount?.() ?? 4;

    const elements: HTMLElement[] = [];
    const destroyFns: Array<() => void> = [];

    const ringRows = buildRegionYieldData(diesByWafer, allWafers, ringCount, passBins, buildRingRegions);
    if (ringRows.length) {
      const ring = renderRegionYieldDiagram({ title: 'Ring yield', mode: 'ring', rows: ringRows, colorScheme: getColorSchemeName(), onSaveImage, ownerDocument: doc });
      elements.push(ring.card);
      destroyFns.push(ring.destroy);
    }
    const quadrantRows = buildRegionYieldData(diesByWafer, allWafers, ringCount, passBins, buildQuadrantRegions);
    if (quadrantRows.length) {
      const quadrant = renderRegionYieldDiagram({ title: 'Quadrant yield', mode: 'quadrant', rows: quadrantRows, colorScheme: getColorSchemeName(), onSaveImage, ownerDocument: doc });
      elements.push(quadrant.card);
      destroyFns.push(quadrant.destroy);
    }

    // Rendered as a table (one row per test, columns per stat) — reads far
    // better than a stacked kv-block per test, and a table with several
    // stat columns needs real width, so it's promoted to a full-width
    // sibling of the grid (like the metadata card) rather than a squeezed
    // grid item.
    let testValuesCard: HTMLElement | null = null;
    if (testDefs.length) {
      const testValues = buildLotTestSection(allDies, testDefs, undefined, perWaferSummaries, onSaveText);
      if (testValues) { const c = plainCard(); c.appendChild(testValues); testValuesCard = c; }
    }
    // Functional tests get their own pass-rate card — they are excluded from the
    // parametric test-values table above (mean/σ of a pass/fail outcome is
    // meaningless), not silently dropped from Insights.
    let functionalCard: HTMLElement | null = null;
    if (allTestDefs.length) {
      const functional = buildLotFunctionalSection(allDies, allTestDefs, perWaferSummaries, onSaveText);
      if (functional) { const c = plainCard(); c.appendChild(functional); functionalCard = c; }
    }
    return { elements, testValuesCard, functionalCard, destroy: () => { for (const d of destroyFns) d(); } };
  }

  /** Single-wafer replacement for the "Yield by wafer" bar chart — a one-bar
   *  chart with sort controls that can never reorder anything communicates
   *  nothing a stat tile doesn't. Yield comes from the same `buildYieldData`
   *  path the bar chart used, so the number is identical either way. */
  function renderSingleWaferTiles(item: Item): HTMLElement {
    const passBinsLabel = passBins.length === 1 ? `bin ${passBins[0]}` : `bins ${passBins.join(', ')}`;
    const yieldPct = buildYieldData([{ ...item, key: item.waferIndex }], passBins)[0]?.percent;

    const card = plainCard();
    Object.assign(card.style, { flexDirection: 'row', flexWrap: 'wrap', gap: '8px' } as Partial<CSSStyleDeclaration>);

    function tile(value: string, label: string): HTMLDivElement {
      const t = doc.createElement('div');
      Object.assign(t.style, {
        border: `1px solid ${CLR.menuBorder}`, borderRadius: '6px', padding: '8px 16px',
        textAlign: 'center', minWidth: '110px',
      } as Partial<CSSStyleDeclaration>);
      const v = doc.createElement('div');
      v.textContent = value;
      Object.assign(v.style, { fontSize: '20px', fontWeight: '700', color: CLR.value, lineHeight: '1.2' } as Partial<CSSStyleDeclaration>);
      const l = doc.createElement('div');
      l.textContent = label;
      Object.assign(l.style, { fontSize: '10px', color: CLR.label, marginTop: '2px' } as Partial<CSSStyleDeclaration>);
      t.append(v, l);
      return t;
    }

    if (yieldPct !== undefined) card.appendChild(tile(`${yieldPct.toFixed(1)}%`, `Yield · pass: ${passBinsLabel}`));
    card.appendChild(tile(String(item.dies.length), 'Total dies'));
    return card;
  }

  function renderOverviewSection(
    items: Item[],
    testDefs: TestDef[],
    allTestDefs: TestDef[],
    groups: { key: string; items: Item[] }[] | undefined,
    groupLabelText: string | undefined,
  ): { card: HTMLElement; destroy: () => void } {
    const outer = doc.createElement('div');
    Object.assign(outer.style, { display: 'flex', flexDirection: 'column', gap: '10px' } as Partial<CSSStyleDeclaration>);

    const single = items.length === 1 && !groups;
    if (single) outer.appendChild(renderSingleWaferTiles(items[0]));

    const yieldBins = renderYieldBinsSection(items, groups, groupLabelText, !single);
    outer.appendChild(yieldBins.card);

    // Ring/quadrant cards join the same grid `yieldBins.card` already is (see
    // renderYieldBinsSection — it returns a makeChartGridWrap() wrapper), so
    // they wrap responsively at the same width as the yield/bin cards above.
    // They always reflect the whole population, even when "Group by" is
    // active — regional/test stats aren't a per-group chart like yield/bins,
    // and pooling them across groups is still a meaningful, single "how does
    // this wafer/lot look overall" summary.
    const details = renderOverviewDetailsCards(items, testDefs, allTestDefs);
    for (const c of details.elements) yieldBins.card.appendChild(c);
    if (details.testValuesCard) outer.appendChild(details.testValuesCard);
    if (details.functionalCard) outer.appendChild(details.functionalCard);

    return { card: outer, destroy: () => { yieldBins.destroy(); details.destroy(); } };
  }

  /** Capability + boxplot + histogram together, wired so clicking a
   *  capability box drives both the boxplot's and histogram's selected test
   *  in place. Each panel still owns its own group-consuming UI (capability:
   *  a "Group:" restrict-to-one-group dropdown; boxplot: pooled-per-group
   *  overview rows with in-place drill-down; histogram: an overlaid
   *  multi-series view with a click-to-emphasize legend) — unifying these
   *  into one shared control is tracked as a follow-up, not done here (see
   *  this file's header comment). */
  function renderDistributionsSection(
    items: Item[],
    testDefs: TestDef[],
    groups: { key: string; items: Item[] }[] | undefined,
    groupLabelText: string | undefined,
  ): { card: HTMLElement; destroy: () => void } {
    const wrap = makeChartGridWrap(doc);

    // Threads each item's already-computed StatsSummary per-test five-number
    // summaries through (stats/boxplot.ts's `BoxplotItem.testStats`) so
    // buildTestBoxplotData can skip re-scanning `dies` when available — for
    // per-item leaf rows only; a group-overview row pools raw dies across
    // multiple wafers and has no equivalent precomputed source (same
    // limitation as capability's pooled quantiles — see stats/capability.ts).
    const withTestStats = (it: Item) => ({ ...it, testStats: it.statsSummary?.stats.perTestStats });
    const boxplotItems = items.map(withTestStats);
    const boxplotGroups = groups?.map(g => ({ key: g.key, items: g.items.map(withTestStats) }));
    const boxplot = renderBoxplotPanel({
      title: 'Test value distribution',
      items: boxplotItems, testDefs, groups: boxplotGroups, groupLabelText, colorScheme: getColorSchemeName(), onSaveImage,
      onOpen: openWafer ? (waferIndex, testNumber) => openWaferDetailModal(waferIndex, `Wafer ${items.find(it => it.waferIndex === waferIndex)?.label ?? waferIndex}`, testNumber) : undefined,
      ownerDocument: doc,
    });
    const histogram = renderHistogramPanel({
      title: 'Value histogram',
      items, testDefs, groups, colorScheme: getColorSchemeName(), onSaveImage,
      ownerDocument: doc,
    });
    const capability = renderCapabilityPanel({
      title: 'Process capability',
      items, testDefs, groups, colorScheme: getColorSchemeName(), onSaveImage,
      onSelectTest: (testNumber) => { boxplot.setTest(testNumber); histogram.setTest(testNumber); },
      ownerDocument: doc,
    });
    // No manual card.style.minHeight here — capability/histogram grow their
    // own card via ensureCardFits (chartShell.ts) once they have real
    // content to draw, measured from their own live chrome overhead rather
    // than a guessed constant. Capability's empty state (no test data at
    // all) never calls that, so it stays sized to its compact message
    // instead of forcing a large dead box next to functional siblings.
    wrap.append(capability.card, boxplot.card, histogram.card);

    return { card: wrap, destroy: () => { capability.destroy(); boxplot.destroy(); histogram.destroy(); } };
  }

  /** Correlation matrix + scatter together, wired so clicking a matrix cell
   *  drives the scatter panel's X/Y in place. Correlation restricts to one
   *  group at a time via its own "Group:" dropdown (matching capability's
   *  pattern); scatter never restricts — it colours every group's points
   *  together with a click-to-filter legend. */
  function renderCorrelationSection(
    items: Item[],
    testDefs: TestDef[],
    groups: { key: string; items: Item[] }[] | undefined,
  ): { card: HTMLElement; destroy: () => void } {
    const wrap = makeChartGridWrap(doc);

    const scatter = renderScatterPanel({
      title: 'Test scatter',
      items, testDefs, groups, colorScheme: getColorSchemeName(), onSaveImage,
      ownerDocument: doc,
    });
    const correlation = renderCorrelationPanel({
      title: 'Test correlation matrix',
      items, testDefs, groups, colorScheme: getColorSchemeName(), onSaveImage,
      onSelectPair: (x, y) => scatter.setXY(x, y),
      ownerDocument: doc,
    });
    // No manual card.style.minHeight here — scatter grows its own card via
    // ensureCardFits (chartShell.ts); correlation sizes compactly to its
    // matrix and stretches to match scatter's row height via the grid's
    // default align-items: stretch, same as any other CSS Grid row.
    wrap.append(correlation.card, scatter.card);

    return { card: wrap, destroy: () => { correlation.destroy(); scatter.destroy(); } };
  }

  function render(): void {
    for (const h of panelHandles) h.destroy();
    panelHandles = [];
    bodyEl.innerHTML = '';
    tabBar.innerHTML = '';

    if (deps.backTab) tabBar.appendChild(makeBackTabButton(deps.backTab));
    for (const v of VIEWS) tabBar.appendChild(makeTabButton(v.key, v.label));

    const allItems = facetItems();
    renderMetadataStrip(allItems);
    const facetTable = buildFacetTable(allItems, { facetableOnly: true }).filter(f => f.splittable);

    const controlsRow = doc.createElement('div');
    Object.assign(controlsRow.style, { display: 'flex', gap: '8px', alignItems: 'center' } as Partial<CSSStyleDeclaration>);
    let groupLabelText: string | undefined;
    if (facetTable.length > 0) {
      controlsRow.appendChild(makeLabeledSelect(
        'Group by:',
        [{ value: '', label: 'None' }, ...facetTable.map(f => ({ value: f.key, label: `${f.label} (${f.values.length})` }))],
        analysisGroupKey ?? '',
        v => { analysisGroupKey = v || undefined; render(); },
        { hook: 'group-by', ownerDocument: doc },
      ));
      groupLabelText = facetTable.find(f => f.key === analysisGroupKey)?.label;
    } else {
      analysisGroupKey = undefined;
    }
    bodyEl.appendChild(controlsRow);

    // Functional (pass/fail) tests are excluded from every parametric Insights
    // panel — boxplot/histogram/capability/correlation/scatter and the
    // test-values table all present parametric statistics, which are
    // meaningless for a binary outcome. They get their own pass-rate card in
    // the Overview view instead (renderOverviewDetailsCards receives the
    // unfiltered defs) and remain visible on the wafer map itself.
    const allTestDefs = getItems().find(it => it?.testDefs?.length)?.testDefs ?? [];
    const testDefs = allTestDefs.filter(isParametricTest);
    let groups: { key: string; items: Item[] }[] | undefined;
    if (analysisGroupKey) {
      const byKey = new Map<string, Item[]>();
      const order: string[] = [];
      for (const it of allItems) {
        const key = facetValueOf(it.metadata, analysisGroupKey) ?? FACET_NONE_VALUE;
        if (!byKey.has(key)) { byKey.set(key, []); order.push(key); }
        byKey.get(key)!.push(it);
      }
      groups = order.map(key => ({ key, items: byKey.get(key)! }));
    }

    const section =
      activeView === 'overview'      ? renderOverviewSection(allItems, testDefs, allTestDefs, groups, groupLabelText) :
      activeView === 'distributions' ? renderDistributionsSection(allItems, testDefs, groups, groupLabelText) :
      renderCorrelationSection(allItems, testDefs, groups);
    panelHandles.push(section);
    bodyEl.appendChild(section.card);
  }

  return {
    el: rootEl,
    render,
    destroy: () => {
      for (const h of panelHandles) h.destroy();
      rootEl.remove();
    },
  };
}
