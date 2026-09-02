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
import { LEADING, ALPHA, SPACE, FONT, CLR, controlStyle, wireControlHover, wireTooltip, type SaveImageHandler, type SaveTextHandler } from './toolbar.js';
import { ICONS } from './icons.js';
import { renderCapabilityPanel } from './charts/capability.js';
import { renderBoxplotPanel } from './charts/boxplot.js';
import { renderTrendPanel } from './charts/trend.js';
import { renderHistogramPanel } from './charts/histogram.js';
import { renderCorrelationPanel } from './charts/correlation.js';
import { renderScatterPanel } from './charts/scatter.js';
import { renderBarPanel, type ChartPanel } from './charts/barPanel.js';
import { renderBinClusterPanel } from './charts/binCluster.js';
import { renderTestPassRatePanel } from './charts/testPassRate.js';
import { QUANTITY } from './charts/palette.js';
import { cardFrameStyle, makeChartGridWrap, makeLabeledSelect, type AxisPrefs } from './charts/chartShell.js';
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
  /** Opens the user guide. Rendered as an icon at the end of the tab row —
   *  while Insights is showing, the map toolbar is hidden (it held only a
   *  back-to-gallery button, which the back tab already provides, and this
   *  help button), so this is where Help lives in this view. */
  onOpenGuide?: () => void;
  /**
   * Show this tab's own identity strip (lot/wafer/product/etc.), mounted
   * above the Overview/Distributions/Correlation tab bar so it stays in the
   * same place across every sub-tab. Default true — needed by
   * `renderWaferMap.ts`, whose single-wafer identity header is explicitly
   * hidden while Insights is open (see `setInsightsOpen`, to avoid showing
   * the same metadata twice), so this strip is its only identity display there.
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
    gap: SPACE.lg,
    width: '100%',
  } as Partial<CSSStyleDeclaration>);

  // Identity strip (lot/wafer/product/etc.) — mounted above the tab bar so
  // it stays in the same place across every sub-tab, instead of living
  // inside the Overview tab's own content and disappearing on
  // Distributions/Correlation. Rebuilt on every `render()` alongside the
  // active sub-tab's content; only mounted when `showMetadataStrip`.
  // Every band in this view (metadata strip, tab bar, controls row) lines up on
  // one left inset. It used to come only from the tab buttons' own padding, so
  // the tabs looked inset and the strip and Group-by row did not — they were
  // flush against the edge with no gutter at all.
  const BAND_INSET = SPACE.lg;

  const metaStripEl = doc.createElement('div');
  Object.assign(metaStripEl.style, { paddingLeft: BAND_INSET } as Partial<CSSStyleDeclaration>);

  const tabBar = doc.createElement('div');
  Object.assign(tabBar.style, { display: 'flex', gap: SPACE.xs, alignItems: 'center', borderBottom: `1px solid ${CLR.menuBorder}`, marginBottom: SPACE.xxs } as Partial<CSSStyleDeclaration>);
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
  Object.assign(bodyEl.style, { display: 'flex', flexDirection: 'column', gap: SPACE.lg } as Partial<CSSStyleDeclaration>);

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
      fontSize:     FONT.body,
      padding: `${SPACE.sm} ${SPACE.lg} ${SPACE.md}`,
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
      // Median of whatever rows are currently drawn — including after a drill
      // into one group, where the overall lot median would be the wrong
      // reference. Median rather than mean: one catastrophic wafer drags a mean
      // below every other bar, which makes the reference itself misleading.
      reference: rows => {
        if (rows.length < 3) return null;
        const sorted = rows.map(d => d.percent).sort((a, b) => a - b);
        const mid = sorted.length % 2
          ? sorted[(sorted.length - 1) / 2]
          : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;
        return { value: mid, label: `median ${mid.toFixed(1)}%` };
      },
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
    // Frame values come from ONE place. This used to restate cardShell's
    // border/background/radius/padding by hand, and the two drifted the moment
    // cardShell gained a header rule — the tables below the charts stopped
    // looking like the cards above them. `cardFrameStyle` is that shared block.
    Object.assign(card.style, {
      ...cardFrameStyle(),
      display: 'flex', flexDirection: 'column', gap: SPACE.lg, minWidth: '0',
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
   *  (`buildRegionYieldPanelSection` in summaryPanel.ts, one section with a
   *  Ring/Quadrant selector) — both
   *  read `buildRegionYieldData` (stats/regions.ts) directly, so this chart
   *  view and the panel's compact rows can never disagree. Ring and
   *  quadrant diagrams get their own card in the shared grid (matching the
   *  yield/bin pareto cards above); Test Values is a table and is returned
   *  separately so the caller can place it full-width instead of squeezed
   *  into a grid cell. */
  function renderOverviewDetailsCards(
    items: Item[],
    testDefs: TestDef[],
    /** UNFILTERED defs — the functional-tests card and the pass-rate chart need the
     *  `testType: 'F'` entries that `render()` strips from `testDefs` for every
     *  parametric panel. */
    allTestDefs: TestDef[],
    /** Active grouping, when any — the pass-rate chart is the one card here that
     *  splits by group (a per-test pass rate per split is exactly what a split
     *  experiment is run to compare). Ring/quadrant and the test tables stay
     *  pooled, as before. */
    groupsForPassRate?: { key: string; items: Item[] }[],
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

    // Per-test pass rate, split by group when grouping is active. The suite could
    // previously answer "which BIN is failing" (bin pareto) and "which group
    // yields worse" (yield chart), but not "which TEST is failing, and does it
    // fail more in one split than another" — the question a split experiment is
    // usually run to answer. Covers parametric (spec-limit judgement) and
    // functional (recorded verdict) tests behind one selector; see
    // stats/testPassRate.ts for why they share a builder.
    const passRateGroups = groupsForPassRate ?? [{ key: '', items }];
    const passRate = renderTestPassRatePanel({
      groups: passRateGroups.map(g => ({
        key: g.key,
        items: g.items.map(it => ({
          dies: it.dies,
          testSpecYield: it.statsSummary?.stats.testSpecYield,
          functionalYield: it.statsSummary?.stats.functionalYield,
        })),
      })),
      testDefs: allTestDefs,
      onSaveImage,
      ownerDocument: doc,
    });
    passRate.card.style.minHeight = '300px';
    elements.push(passRate.card);
    destroyFns.push(passRate.destroy);

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
      // Full column set and a Ppk column: this card is a full-width sibling of
      // the grid, not the 260px docked panel, so it carries the descriptive
      // statistics the panel's compact variant leaves to the report/CSV.
      const testValues = buildLotTestSection(
        allDies, testDefs, undefined, perWaferSummaries, onSaveText,
        diesByWafer.map(d => ({ dies: d })), undefined, 'full',
      );
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

  /**
   * The Overview's headline tiles.
   *
   * For a single wafer these replace the "Yield by wafer" bar chart — a one-bar
   * chart with sort controls that can never reorder anything communicates nothing
   * a stat tile doesn't.
   *
   * For a lot they are additive, and were missing entirely: a lot's Overview
   * opened straight into the yield chart, stating no wafer count, no die count and
   * no exclusions — the population every chart below it is computed over went
   * unnamed. That is the same gap the docked lot Summary panel had, and the same
   * rule in CLAUDE.md applies: an aggregated population must be identified.
   *
   * Yield comes from the same `buildYieldData` path the bar chart uses, so the
   * number is identical either way; the lot figure is labelled as an unweighted
   * mean of per-wafer yields, matching the Summary panel's own wording, because it
   * is NOT the die-weighted lot yield and the two differ on an uneven lot.
   */
  function renderOverviewTiles(items: Item[]): HTMLElement {
    const passBinsLabel = passBins.length === 1 ? `bin ${passBins[0]}` : `bins ${passBins.join(', ')}`;
    const single = items.length === 1;
    const item = items[0];

    const card = plainCard();
    Object.assign(card.style, { flexDirection: 'row', flexWrap: 'wrap', gap: SPACE.md } as Partial<CSSStyleDeclaration>);

    /** The rule belongs BETWEEN items — the last one has nothing to separate it
     *  from, and a trailing divider reads as an unfinished row. */
    const dropTrailingDivider = (row: HTMLElement): HTMLElement => {
      const last = row.lastElementChild as HTMLElement | null;
      if (last) Object.assign(last.style, { borderRight: 'none', paddingRight: '0', marginRight: '0' });
      return row;
    };

    // A stat READOUT, not a card. These were three bordered boxes with 20px
    // figures, taking a full band with most of the row empty, to carry three
    // facts. The numbers still need emphasis — they name the population every
    // chart below is computed over — but the box chrome around each one was
    // paying for itself in vertical space and giving nothing back. Value and
    // label sit on one baseline; a rule between them does the separating a
    // border used to.
    function tile(value: string, label: string, sublabel?: string): HTMLDivElement {
      const t = doc.createElement('div');
      Object.assign(t.style, {
        display: 'flex', alignItems: 'baseline', gap: SPACE.sm,
        paddingRight: SPACE.xxl, marginRight: SPACE.md,
        borderRight: `1px solid ${CLR.menuBorder}`,
      } as Partial<CSSStyleDeclaration>);
      const v = doc.createElement('div');
      v.textContent = value;
      Object.assign(v.style, { fontSize: FONT.heading, fontWeight: '700', color: CLR.value, lineHeight: LEADING.tight } as Partial<CSSStyleDeclaration>);
      const l = doc.createElement('div');
      l.textContent = label;
      Object.assign(l.style, { fontSize: FONT.body, color: CLR.label } as Partial<CSSStyleDeclaration>);
      t.append(v, l);
      if (sublabel) {
        const sub = doc.createElement('div');
        sub.textContent = sublabel;
        Object.assign(sub.style, { fontSize: FONT.meta, color: CLR.label, opacity: ALPHA.muted } as Partial<CSSStyleDeclaration>);
        t.appendChild(sub);
      }
      return t;
    }

    if (single) {
      const yieldPct = buildYieldData([{ ...item, key: item.waferIndex }], passBins)[0]?.percent;
      if (yieldPct !== undefined) card.appendChild(tile(`${yieldPct.toFixed(1)}%`, `Yield · pass: ${passBinsLabel}`));
      card.appendChild(tile(String(item.dies.length), 'Total dies'));
      return dropTrailingDivider(card) as HTMLDivElement;
    }

    card.appendChild(tile(String(items.length), 'Wafers'));

    const perWafer = buildYieldData(items.map(it => ({ ...it, key: it.waferIndex })), passBins)
      .map(d => d.percent)
      .filter(p => Number.isFinite(p));
    if (perWafer.length) {
      const mean = perWafer.reduce((a, b) => a + b, 0) / perWafer.length;
      // Two different yield statistics: this weights every WAFER equally, the
      // die-weighted one weights every DIE equally. They agree only when die
      // counts are even across the lot — and when they diverge, that gap is a
      // finding, not a footnote. `buildYieldDataCombined` computes the weighted
      // figure with the correct `yieldEligibleDieCount` weighting, so partial
      // and edge-excluded dies cannot skew it.
      //
      // Shown only when it actually differs. The old sublabel read "unweighted,
      // per wafer" always — a qualifier with nothing on screen to contrast
      // against, which on an even lot is just noise.
      const combined = buildYieldDataCombined(
        [{ key: 'all', items: items.map(it => ({ ...it, key: it.waferIndex })) }], passBins,
      )[0]?.percent;
      const differs = combined !== undefined && combined.toFixed(1) !== mean.toFixed(1);
      card.appendChild(tile(
        `${mean.toFixed(1)}%`,
        `Mean per-wafer yield · pass: ${passBinsLabel}`,
        differs ? `${combined.toFixed(1)}% by dies` : undefined,
      ));
    }

    // Analysed/excluded from the per-wafer StatsSummary where every wafer has
    // one; otherwise the raw die total, which is all this tab can honestly claim.
    const summaries = items.map(it => it.statsSummary);
    if (summaries.every((s): s is StatsSummary => s !== undefined)) {
      const analysed = summaries.reduce((a, s) => a + s.stats.analyzedDies, 0);
      const excluded = summaries.reduce((a, s) => a + s.stats.excludedDies, 0);
      card.appendChild(tile(analysed.toLocaleString(), 'Dies analysed',
        excluded ? `${excluded.toLocaleString()} excluded` : undefined));
    } else {
      card.appendChild(tile(items.reduce((a, it) => a + it.dies.length, 0).toLocaleString(), 'Total dies'));
    }
    return dropTrailingDivider(card) as HTMLDivElement;
  }

  function renderOverviewSection(
    items: Item[],
    testDefs: TestDef[],
    allTestDefs: TestDef[],
    groups: { key: string; items: Item[] }[] | undefined,
    groupLabelText: string | undefined,
  ): { card: HTMLElement; destroy: () => void } {
    const outer = doc.createElement('div');
    Object.assign(outer.style, { display: 'flex', flexDirection: 'column', gap: SPACE.lg } as Partial<CSSStyleDeclaration>);

    const single = items.length === 1 && !groups;
    // Tiles for both cases now — a lot's Overview previously named no population
    // at all. Still suppressed when grouping is active: the tiles describe the
    // whole population while every chart below is split by group, and a headline
    // that silently disagrees with the charts under it is worse than none.
    if (items.length && !groups) outer.appendChild(renderOverviewTiles(items));

    const yieldBins = renderYieldBinsSection(items, groups, groupLabelText, !single);
    outer.appendChild(yieldBins.card);

    // Ring/quadrant cards join the same grid `yieldBins.card` already is (see
    // renderYieldBinsSection — it returns a makeChartGridWrap() wrapper), so
    // they wrap responsively at the same width as the yield/bin cards above.
    // They always reflect the whole population, even when "Group by" is
    // active — regional/test stats aren't a per-group chart like yield/bins,
    // and pooling them across groups is still a meaningful, single "how does
    // this wafer/lot look overall" summary.
    const details = renderOverviewDetailsCards(items, testDefs, allTestDefs, groups);
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

    // The axis toggles are shared across the three distribution panels, the same
    // way the selected test already is. They were per-panel, so setting "axis
    // includes limits" for one test meant setting it three times.
    //
    // `includeLimits: undefined` is not "off" — it means each panel derives the
    // default from its own data (shouldIncludeLimitsByDefault). It only becomes a
    // boolean once the user actually picks, and then it sticks across tests.
    let axisPrefs: AxisPrefs = { includeLimits: undefined, clipOutliers: false };
    const broadcastAxisPrefs = (prefs: AxisPrefs) => {
      axisPrefs = prefs;
      // Skip the originator: it has already applied the change and rebuilt, and
      // re-entering its own rebuild would discard the interaction in progress.
      for (const p of [boxplot, histogram, trend]) if (p !== originator) p?.setAxisPrefs(prefs);
    };
    let originator: { setAxisPrefs: (p: AxisPrefs) => void } | null = null;
    const axisHandler = (self: () => { setAxisPrefs: (p: AxisPrefs) => void } | null) =>
      (prefs: AxisPrefs) => { originator = self(); broadcastAxisPrefs(prefs); originator = null; };

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
      axisPrefs, onAxisPrefsChange: axisHandler(() => boxplot),
      items: boxplotItems, testDefs, groups: boxplotGroups, groupLabelText, colorScheme: getColorSchemeName(), onSaveImage,
      onOpen: openWafer ? (waferIndex, testNumber) => openWaferDetailModal(waferIndex, `Wafer ${items.find(it => it.waferIndex === waferIndex)?.label ?? waferIndex}`, testNumber) : undefined,
      ownerDocument: doc,
    });
    const histogram = renderHistogramPanel({
      title: 'Value histogram',
      axisPrefs, onAxisPrefsChange: axisHandler(() => histogram),
      items, testDefs, groups, colorScheme: getColorSchemeName(), onSaveImage,
      ownerDocument: doc,
    });
    // Wafer-to-wafer trend joins the cross-panel test link below, so picking a
    // test in capability drives boxplot, histogram AND this — all four then answer
    // the same question about the same test, rather than each starting from
    // testDefs[0].
    //
    // Deliberately NOT group-aware like its siblings: this chart's x axis is the
    // population's own slot order, and restricting or splitting by group would
    // break the sequence that is the entire signal. It always shows every wafer.
    const trend = renderTrendPanel({
      title: 'Wafer-to-wafer trend',
      axisPrefs, onAxisPrefsChange: axisHandler(() => trend),
      items: items.map(it => ({
        label: it.label,
        key: it.waferIndex,
        dies: it.dies,
        testStats: it.statsSummary?.stats.perTestStats,
      })),
      testDefs,
      onSaveImage,
      onOpen: openWafer
        ? (key, testNumber) => openWaferDetailModal(key, `Wafer ${items.find(it => it.waferIndex === key)?.label ?? key}`, testNumber)
        : undefined,
      ownerDocument: doc,
    });

    const capability = renderCapabilityPanel({
      title: 'Process capability',
      items, testDefs, groups, colorScheme: getColorSchemeName(), onSaveImage,
      onSelectTest: (testNumber) => { boxplot.setTest(testNumber); histogram.setTest(testNumber); trend.setTest(testNumber); },
      ownerDocument: doc,
    });
    // No manual card.style.minHeight here — capability/histogram grow their
    // own card via ensureCardFits (chartShell.ts) once they have real
    // content to draw, measured from their own live chrome overhead rather
    // than a guessed constant. Capability's empty state (no test data at
    // all) never calls that, so it stays sized to its compact message
    // instead of forcing a large dead box next to functional siblings.
    wrap.append(capability.card, boxplot.card, histogram.card, trend.card);

    return { card: wrap, destroy: () => { capability.destroy(); boxplot.destroy(); histogram.destroy(); trend.destroy(); } };
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
      items, testDefs, groups, colorScheme: getColorSchemeName(), onSaveImage, onSaveText,
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
    // Rides on the tab bar's row, right-aligned: it is the only control here and
    // the row is mostly empty, so giving it a band of its own cost a full row of
    // vertical space above every chart for one dropdown.
    Object.assign(controlsRow.style, {
      display: 'flex', gap: SPACE.md, alignItems: 'center',
      marginLeft: SPACE.xxl, paddingBottom: SPACE.xs,
    } as Partial<CSSStyleDeclaration>);
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
    let helpBtn: HTMLButtonElement | null = null;
    if (deps.onOpenGuide) {
      const help = doc.createElement('button');
      help.type = 'button';
      help.innerHTML = ICONS.help;
      help.setAttribute('aria-label', 'User guide');
      Object.assign(help.style, {
        ...controlStyle('bare'),
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        width: '24px', height: '24px', flexShrink: '0',
      } as Partial<CSSStyleDeclaration>);
      wireControlHover(help, 'bare');
      wireTooltip(help, 'User guide');
      help.addEventListener('click', () => deps.onOpenGuide!());
      Object.assign(help.style, { marginLeft: 'auto', marginRight: BAND_INSET } as Partial<CSSStyleDeclaration>);
      helpBtn = help;
    }
    tabBar.appendChild(controlsRow);   // same row as the tabs, not a band below
    if (helpBtn) tabBar.appendChild(helpBtn);   // far right — a rare action, not scope

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
