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
// Distributions' group scope is shared across capability, boxplot and
// histogram (`activeSectionGroup`/`selectGroupEverywhere`), the same way the
// selected test and the axis toggles already were. Each panel still RENDERS
// the scope in the way that suits it — capability narrows to it, the boxplot
// drills into it, the histogram emphasises it against the others — but the
// three can no longer be describing different populations at once, which they
// were by default, from the first render, whenever "Group by" was set.

import type { Die } from '../core/dies.js';
import type { Wafer } from '../core/wafer.js';
import type { LotStatsSummary, StatsSummary } from '../stats/types.js';
import { buildFacetTable, facetValueOf, FACET_NONE_VALUE, type FacetItem } from '../stats/facets.js';
import { mergeTestDefs } from '../stats/mergeTestDefs.js';
import { isParametricTest, type TestDef } from '../renderer/buildWaferMap.js';
import type { WaferMapDisplayItem } from './renderWaferGallery.js';
import { waferDisplayLabel, waferIdentityLabel } from '../core/waferLabel.js';
import { hasDrilldownTargets, waferPopulation } from './chartPopulation.js';
import { openDrilldownMenu } from './drilldown.js';
import { INPUT_DEFAULT_PASS_BINS, itemPassBins, passBinsLabel as describePassBins } from '../core/passBins.js';
import type { BinColors } from '../renderer/binColors.js';
import { NO_DATA_FILL } from '../renderer/colorMap.js';
import { describeWaferPopulation, populationStat } from '../stats/population.js';
import { LEADING, ALPHA, SPACE, EDGE_GUTTER, FONT, CLR, RADIUS, SHADOW, controlStyle, wireControlHover, wireTooltip, type SaveImageHandler, type SaveTextHandler } from './toolbar.js';
import { ICONS } from './icons.js';
import { renderCapabilityPanel } from './charts/capability.js';
import { renderBoxplotPanel } from './charts/boxplot.js';
import { renderTrendPanel } from './charts/trend.js';
import { renderSweepPanel } from './charts/sweep.js';
import { sweepAppliesTo, type SweepSpec } from '../stats/sweep.js';
import { renderHistogramPanel } from './charts/histogram.js';
import { renderCorrelationPanel } from './charts/correlation.js';
import { renderScatterPanel } from './charts/scatter.js';
import { renderBarPanel, type ChartPanel } from './charts/barPanel.js';
import { renderBinClusterPanel } from './charts/binCluster.js';
import { renderTestPassRatePanel } from './charts/testPassRate.js';
import { QUANTITY } from './charts/palette.js';
import { cardFrameStyle, makeChartGridWrap, makeLabeledSelect, makeLinkedGroupSelect, type AxisPrefs, type WaferContextMenuHandler } from './charts/chartShell.js';
import { buildYieldData, buildYieldDataCombined, type YieldSortBy } from '../stats/yield.js';
import { buildBinParetoData, type BinType } from '../stats/binPareto.js';
import { buildLotTestSection, buildLotFunctionalSection, buildMetadataStripBox } from './summaryPanel.js';
import { buildRegionYieldData, buildRingRegions, buildQuadrantRegions } from '../stats/regions.js';
import { renderRegionYieldDiagram } from './charts/regionYieldDiagram.js';

export type InsightsView = 'overview' | 'distributions' | 'correlation' | 'sweeps';

/** Public option shape for `RenderOptions.insights`/`GalleryOptions.insights`. */
export interface InsightsOptions {
  /**
   * Show an "Insights" tab in the toolbar. Selecting it replaces the canvas/
   * grid with wmap's own chart suite across three sub-tabs — Overview
   * (yield, bins, ring/quadrant yield, test values), Distributions
   * (process capability, boxplot, histogram), and Correlation (matrix +
   * scatter) — plus a fourth, Sweeps, when `sweeps` defines any. Default false.
   */
  enabled?: boolean;
  /** Which sub-tab is shown first. Default 'overview'. `'sweeps'` with no
   *  `sweeps` defined falls back to 'overview' — there is no such tab to open. */
  defaultView?: InsightsView;
  /**
   * Parametric sweeps, one card each in their own Sweeps sub-tab — which appears
   * only when this is non-empty.
   *
   * A sweep reads an ordered run of tests as a response curve rather than as
   * independent tests, and measures the PAIR: where the first two series cross,
   * and how far apart they are at given levels. The case it exists for is the
   * same quantity measured at a series of power levels, recorded as a block of
   * consecutive test numbers, swept up in one block and down in another.
   *
   * ```ts
   * insights: { enabled: true, sweeps: [{
   *   id: 'power', title: 'Power Sweep',
   *   series: [
   *     { label: 'Rising',  tests: [1010, 1011, 1012], xValues: [0, 5, 10] },
   *     { label: 'Falling', tests: [1020, 1021, 1022], xValues: [0, 5, 10] },
   *   ],
   *   separationAt: [1.2, 2.5],
   * }] }
   * ```
   *
   * Deliberately carries no population scope of its own: a sweep definition
   * says which tests form the curve, and is therefore valid for any population
   * and portable between hosts. The dies it aggregates are whatever the
   * Insights view is currently scoped to.
   *
   * The same definitions drive drilldown: a user can select dies on a map and
   * right-click (or use the toolbar's "Chart the selection") to sweep just
   * those dies. A single map offers this even when `enabled` is off.
   *
   * **Provisional.** This arrived as one site's request. The mechanism — an
   * ordered run of tests read as a curve — is a recurring semiconductor shape
   * (shmoo, VDD/temperature sweeps, retention, endurance, IV), which is the case
   * for it being library-level; against it is that only one host has asked. It
   * is shipping so tsmap can put it in front of that user, and the answer
   * decides it: a second sweep-shaped use means it is general and stays, while
   * "also measure X, and split by Y" means it is a bespoke chart and belongs
   * behind a host-contributed-panel extension point instead. `separationAt` is
   * the narrowest part of the surface and the first thing to drop if it is not
   * used. Do not widen this shape before that question is settled.
   *
   * Range strings in `tests` (`"1010..1030"`) are NOT a widening in that sense:
   * they are input syntax for the same list of tests, and add nothing to what a
   * sweep measures. They were added because ranges are the first thing anyone
   * writing a sweep by hand asks for, and they share the derived-test parser so
   * the syntax is one syntax library-wide.
   */
  sweeps?: SweepSpec[];
  /**
   * Offers a "Remove" button on the Sweeps tab's notice about sweeps that name
   * none of the data's tests — typically sweeps a host kept from another test
   * program. Called with those sweeps' ids; the host drops them and re-renders
   * with the remaining `sweeps`. Without it the notice still shows, with no
   * button. The library never edits the host's sweep list itself.
   */
  onRemoveSweeps?: (ids: string[]) => void;
  /**
   * Open the Insights view on mount instead of starting on the map/grid.
   * Default false — the tab is offered, the map is what you see first.
   *
   * Set this for an analysis-first surface, where the charts are the point and
   * the map is the secondary view. Symmetric with `summaryPanel.defaultOpen`.
   * The chart suite is a lazily-imported chunk, so opening it on mount also
   * pulls that chunk on load rather than on first click — worth knowing if the
   * page is otherwise weight-sensitive.
   */
  defaultOpen?: boolean;
}

export interface InsightsTabDeps {
  /** Current gallery/single-wafer items — read fresh each render (a gallery's list can still be building). `null` entries (not-yet-built cards) are skipped. */
  getItems: () => Array<WaferMapDisplayItem | null>;
  /** Precomputed lot-level yield, when the host has one — reused directly instead of recomputing (see stats/yield.ts). Omit when there is no lot (e.g. a single wafer). */
  getLotStats?: () => LotStatsSummary | undefined;
  /**
   * The host map's resolved bin colours (`View.binColors`, or the gallery's
   * gallery-wide assignment) — read fresh each render so a live palette change is
   * picked up, and so a bin is the same colour in a chart as on the map.
   */
  getBinColors: () => BinColors;
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
  /**
   * Shows `testNumber` on the host's own map, in test-value mode, and leaves
   * Insights — the single-wafer counterpart to `openWafer`.
   *
   * A single-wafer host (`renderWaferMap`) rightly passes no `openWafer`: the
   * only wafer there is to open is the one already on screen, and opening it
   * again in a modal would be two maps of one wafer. But a boxplot leaf click
   * carries a second, independent payload — the selected test — and *that*
   * half is as useful with one wafer as with twenty; without this the click was
   * simply inert, and the only route from "this test looks wrong" to seeing it
   * on the map was to leave Insights and find the test again in the toolbar's
   * plot-mode picker.
   *
   * Ignored when `openWafer` is set (a gallery opens the wafer, which already
   * lands on this test), and only consulted for a leaf row of the sole item.
   */
  focusTest?: (testNumber: number) => void;
  /** Default sub-tab shown on first render. Default 'overview'. */
  defaultView?: InsightsView;
  /** Sweep definitions to render in the Distributions view — see `InsightsOptions.sweeps`. */
  sweeps?: SweepSpec[];
  /** See `InsightsOptions.onRemoveSweeps`. */
  onRemoveSweeps?: (ids: string[]) => void;
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
  /**
   * Inset for this tab's own bands and content from the edge of the region it
   * fills. Defaults to `EDGE_GUTTER`, which is right when the tab fills a
   * top-level region (the gallery). `renderWaferMap` passes its own chrome
   * inset instead, so the tab bar lines up with the identity row above it
   * rather than sitting a gutter further in.
   */
  contentInset?: string;
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

type Item = FacetItem & {
  dies: Die[]; label: string; waferIndex: number; wafer: Wafer; statsSummary?: StatsSummary;
  /** This wafer's OWN pass bins — a lot can mix wafers built with different ones. */
  passBins: readonly number[];
  /** This wafer's OWN test defs, carried through so a scoped population can be
   *  reconciled (`mergeTestDefs`) over just the wafers in scope. */
  testDefs?: TestDef[];
  /** The wafer's real identity (`waferIdentityLabel`) — never the positional
   *  "Wafer N (no ID)" that `label` falls back to, which in a chart title would
   *  read as an ID. */
  identity?: string;
};

const VIEWS: Array<{ key: InsightsView; label: string }> = [
  { key: 'overview',      label: 'Overview' },
  { key: 'distributions', label: 'Distributions' },
  { key: 'correlation',   label: 'Correlation' },
];

/**
 * Sweeps get their own sub-tab, shown only when any are defined — neither an
 * option nor a count threshold. A threshold would make a sweep's location
 * depend on how many siblings it has, so a chart would move tabs the day a
 * colleague added another; an option would be a layout flag with one right
 * answer. And they never belonged in Distributions: that view is driven by one
 * selected test (capability → boxplot → histogram → trend), while a sweep
 * ignores the selected test and draws many tests as one curve.
 */
const SWEEPS_VIEW: { key: InsightsView; label: string } = { key: 'sweeps', label: 'Sweeps' };

export function createInsightsTab(deps: InsightsTabDeps): InsightsTabHandle {
  const { getItems, getLotStats, getBinColors, getRingCount, onSaveImage, onSaveText, openWafer, focusTest } = deps;
  const showMetadataStrip = deps.showMetadataStrip ?? true;
  const contentInset = deps.contentInset ?? EDGE_GUTTER;
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
    // NO uniform `gap`. It was `SPACE.lg` for every child, which spaced the
    // identity strip, the tab bar and the content identically and so said
    // nothing about which of them belong together — the view read as three
    // unrelated bands, and the tabs in particular stopped looking attached to
    // the content they switch. The strip and the tabs are one header block and
    // are now tight to each other (`SPACE.xs`); the gap from that block down to
    // the content is four times larger. The CONTRAST is what carries the
    // grouping — equal spacing everywhere cannot express hierarchy at any value.
    width: '100%',
    // No top gutter. It existed because the identity strip was the first thing
    // in this view and butted against whatever the host put above it. Neither
    // half of that still holds: this tab renders no identity strip for either
    // host now (both show it in their own chrome row), and that row provides
    // the separation itself. Left in place it pushed the tab row 12px below the
    // line the gallery's legend strip occupies, so switching to Insights
    // visibly dropped the row rather than swapping one band for another.
    paddingTop: '0',
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
  //
  // It is `EDGE_GUTTER` so the bands share one edge with the CARDS in `bodyEl`
  // below, which take the same value. They were 10 and 0 respectively: the
  // identity strip sat 10px in while every chart card was flush against the
  // window, so the Lot line was visibly indented relative to the cards under
  // it. One constant for both is what stops that recurring.
  const BAND_INSET = EDGE_GUTTER;

  const metaStripEl = doc.createElement('div');
  // No marginBottom here — `renderMetadataStrip` owns it, because it depends on
  // whether the strip actually has content. See there.
  Object.assign(metaStripEl.style, { paddingLeft: BAND_INSET } as Partial<CSSStyleDeclaration>);

  const tabBar = doc.createElement('div');
  // `margin`, not `padding`, on the horizontal axis: the rule is this element's
  // own `borderBottom`, so it spans exactly as wide as the element does. Padding
  // would inset the tabs while the rule still ran the full width — which was the
  // reported defect: content sat inside the gutter and the line ran straight
  // past it to both edges. Margin shortens the rule itself, landing its ends on
  // the same column as the card borders above and below.
  //
  // The tab LABELS then sit at gutter + the buttons' own EDGE_GUTTER padding,
  // which is the same place a card's text sits (gutter + card padding) — so the
  // view reads as two consistent columns: structural edges (card borders, this
  // rule, the panel) on the outer one, text on the inner one.
  Object.assign(tabBar.style, { display: 'flex', gap: SPACE.xs, alignItems: 'center',
    background: CLR.menuBg,
    border: `1px solid ${CLR.menuBorder}`,
    borderRadius: RADIUS.container,
    boxShadow: SHADOW.panel,
    padding: `0 ${SPACE.lg}`,
    // The gap below this band is owned here, and matches the gallery legend
    // strip's own `marginBottom` — the two occupy the same line in their
    // respective views, so the space between band and content must be the same
    // or switching views visibly reflows the content by the difference (it was
    // 18px here against the legend's 10px).
    marginBottom: SPACE.lg, marginLeft: contentInset, marginRight: contentInset } as Partial<CSSStyleDeclaration>);
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
  // The gutter belongs HERE, not on the Overview grid inside it: `bodyEl` holds
  // whichever sub-tab is active, so one padding covers Overview, Distributions
  // and Correlation alike. It also must not go on `rootEl`/the host's scroller,
  // because `tabBar`'s `borderBottom` is a full-width divider — padding an
  // ancestor would pull that rule in from both edges, which looks worse than
  // the flush cards it set out to fix. Bands full-bleed, band CONTENT and cards
  // inset: the standard way to keep a divider edge-to-edge.
  Object.assign(bodyEl.style, { display: 'flex', flexDirection: 'column', gap: SPACE.lg,
    // No top margin: the gap below the tab bar is the tab bar's own
    // `marginBottom`, in one place, matching the gallery legend strip. This
    // used to add 16px on top of that, which is how the Insights content ended
    // up 8px further from its band than the grid's cards are from theirs. The
    // "tab bar belongs to the content below it" grouping that margin was for is
    // now carried by the band being a bounded surface rather than by spacing.
    marginTop: '0',
    paddingLeft: contentInset, paddingRight: contentInset } as Partial<CSSStyleDeclaration>);

  rootEl.appendChild(metaStripEl);
  rootEl.appendChild(tabBar);
  rootEl.appendChild(bodyEl);

  const hasSweeps = (deps.sweeps?.length ?? 0) > 0;
  const views = hasSweeps ? [...VIEWS, SWEEPS_VIEW] : VIEWS;
  let activeView: InsightsView = deps.defaultView === 'sweeps' && !hasSweeps
    ? 'overview'
    : deps.defaultView ?? 'overview';
  let analysisGroupKey: string | undefined;

  // Distributions' shared selected test and group scope live HERE, not inside
  // `renderDistributionsSection`, because changing the scope now rebuilds the
  // section: the reconciled test list is a function of the scope (see
  // `scopedTestDefs` in `render`), so a scope change has to re-derive it, and
  // section-local state would be discarded on every such change.
  let activeSectionTest: number | null = null;
  let activeSectionGroup: string | null = null;
  // The shared axis toggles, here for the same reason: `render()` rebuilds every
  // panel, so section-local state is discarded by a scope change — and, less
  // obviously, by the host merely closing and reopening Insights, which silently
  // reverted the user's "clip outliers"/"axis includes limits" choices.
  //
  // `includeLimits: undefined` is not "off" — it means each panel derives the
  // default from its own data (shouldIncludeLimitsByDefault). It only becomes a
  // boolean once the user actually picks, and then it sticks across tests.
  let axisPrefs: AxisPrefs = { includeLimits: undefined, clipOutliers: false };

  /**
   * Narrow every view to one group, or back to all of them.
   *
   * Re-renders rather than broadcasting: the reconciled test list is a function
   * of the scope (see `scopeItems` in `render`), so narrowing can bring back
   * tests the whole-population merge had to withhold, and no in-place update can
   * express that. The selected test and scope live at tab level precisely so
   * they survive the rebuild.
   */
  const selectGroupEverywhere = (key: string | null): void => {
    if (activeSectionGroup === key) return;
    activeSectionGroup = key;
    render();
  };
  /**
   * The active view's built section, kept per view so returning to a tab the user
   * has already opened is instant.
   *
   * Rebuilding it was costing seconds on a large lot: switching away from
   * Distributions and back re-ran capability, boxplot, histogram and trend from
   * scratch — about 5 s at 400k dies — for a panel that was already built and
   * unchanged.
   *
   * Reuse happens **only on a pure tab switch** (`render({ keepSections: true })`,
   * which only the tab buttons pass). Every other path into `render()` — new data,
   * Group by, scope, axis preferences — invalidates the whole cache. That is exact
   * rather than a guess: there is no signature of "what the section depends on" to
   * get subtly wrong, and no way for a stale panel to survive a change.
   */
  let sectionCache = new Map<InsightsView, { card: HTMLElement; destroy: () => void }>();

  function dropSectionCache(): void {
    for (const cached of sectionCache.values()) cached.destroy();
    sectionCache = new Map();
  }

  function openWaferDetailModal(waferIndex: number, title: string, testNumber?: number): void {
    openWafer?.(waferIndex, title, testNumber);
  }

  /**
   * What a leaf-row click carrying a test resolves to, for the host at hand —
   * one branch, so a panel never has to know which kind of host it is in.
   * `openWafer` wins where it exists (the gallery: open that wafer, already on
   * this test). `focusTest` is the single-wafer fallback, and only when the row
   * IS the sole item — with more than one wafer on screen, "show this test on
   * the map" would silently show it for a different wafer than the one clicked.
   * `null` means no leaf action, which is what the panels key their click
   * affordances off.
   */
  /**
   * Right-click on one wafer's bar, box or point → the drilldown menu for that
   * whole wafer. Resolved by `waferIndex` against the items the chart was
   * built from, never by label (two wafers can share a fallback label).
   * Undefined when nothing could be charted, so the charts neither take over
   * the right-click nor advertise one in their tooltips.
   */
  function waferContextMenu(items: Item[]): WaferContextMenuHandler | undefined {
    if (!items.some(it => hasDrilldownTargets(it.testDefs, deps.sweeps))) return undefined;
    return (waferIndex, testNumber, e) => {
      const it = items.find(i => i.waferIndex === waferIndex);
      if (!it || !hasDrilldownTargets(it.testDefs, deps.sweeps)) return;
      e.preventDefault();
      const source = waferPopulation(it.dies, {
        waferLabel: it.identity, testDefs: it.testDefs,
        activeTest: testNumber ?? activeSectionTest ?? undefined, waferIndex,
      });
      openDrilldownMenu({ x: e.clientX, y: e.clientY }, e.target as HTMLElement, source, { sweeps: deps.sweeps, onSaveImage });
    };
  }

  function testLeafAction(items: Item[]): { open: (waferIndex: number, testNumber: number) => void; label?: string } | null {
    if (openWafer) {
      return { open: (waferIndex, testNumber) => openWaferDetailModal(
        waferIndex, `Wafer ${items.find(it => it.waferIndex === waferIndex)?.label ?? waferIndex}`, testNumber) };
    }
    if (focusTest && items.length === 1) {
      return { open: (_waferIndex, testNumber) => focusTest(testNumber), label: 'show this test on the map' };
    }
    return null;
  }

  function facetItems(): Item[] {
    // Map before filtering so `waferIndex` stays the same index a host's
    // `lotYieldSeries` was computed against (filtering-then-mapping would
    // shift indices whenever any item is still null/not-yet-built).
    return getItems()
      .map((it, waferIndex): Item | null => it == null ? null : {
        metadata: it.wafer.metadata ?? undefined, dies: it.dies, wafer: it.wafer,
        label: waferDisplayLabel(it, waferIndex), identity: waferIdentityLabel(it), waferIndex,
        passBins: itemPassBins(it),
        statsSummary: it.statsSummary, testDefs: it.testDefs,
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
      // Horizontal padding is EDGE_GUTTER, not a free choice: the FIRST tab's
      // left padding is what insets its label, so any other value puts the tab
      // row on a different edge from the strip above and the cards below.
      padding: `${SPACE.sm} ${EDGE_GUTTER} ${SPACE.md}`,
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
    // Hover wired HERE, once per element, not in `styleTabButton` — that runs on
    // every render, which would stack a fresh pair of listeners each time.
    // `data-on` marks the active tab so hover leaves it alone: it already
    // carries the selected colour and underline, and repainting it with the
    // shared hover colour would make active and merely-pointed-at look alike.
    btn.dataset.on = isActive ? 'true' : 'false';
    wireControlHover(btn, 'bare');
    btn.dataset.wmapInsightsTab = view;
    btn.setAttribute('role', 'tab');
    btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
    // Roving tabindex (APG Tabs pattern): only the active tab sits in the
    // page's Tab order; Left/Right (wired on tabBar above) moves among the
    // rest without adding every tab to it.
    btn.tabIndex = isActive ? 0 : -1;
    // `keepSections`: a tab switch changes nothing the sections were built from,
    // so reuse whichever views have already been built (see `sectionCache`).
    btn.addEventListener('click', () => { if (activeView !== view) { activeView = view; render({ keepSections: true }); } });
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

    const binColors = getBinColors();
    let yieldSortBy: YieldSortBy = 'label';
    const label = groupLabelText ?? 'group';
    // CLAUDE.md: "yield label must name the actual pass bins in use, not
    // assume bin 1" — mirrors renderSummaryReportHtml's summary-metric label.
    const passBinsLabel = describePassBins(items.map(it => it.passBins));

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
      ? buildYieldDataCombined(yieldGroups, INPUT_DEFAULT_PASS_BINS, yieldSortBy)
      : buildYieldData(yieldItems, INPUT_DEFAULT_PASS_BINS, yieldSortBy);

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
          return { data: buildYieldData(detailItems, INPUT_DEFAULT_PASS_BINS, yieldSortBy), title: `Yield by wafer — ${label}: ${datum.label} (pass: ${passBinsLabel})` };
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
      onWaferContextMenu: waferContextMenu(items),
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
        onSaveImage,
        ownerDocument: doc,
      });
      binCluster.card.style.minHeight = '360px';
      wrap.appendChild(binCluster.card);
      return { card: wrap, destroy: () => { yieldPanel?.destroy(); binCluster.destroy(); } };
    }

    let binType: BinType = 'hbin';
    // The map's own resolved colours, per bin type — read at draw time so the
    // Hard/Soft toggle below picks the matching number space.
    const binColorFor = (binCode: number | undefined): string => binCode === undefined
      ? NO_DATA_FILL
      : (binType === 'hbin' ? binColors.hard : binColors.soft).get(binCode) ?? NO_DATA_FILL;
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
      // Bin identity keeps the map's colours so a bar matches the dies it
      // counts — including a colour-blind-safe palette or definition colours.
      // binCode undefined ⇒ no bin recorded ⇒ the no-data fill.
      barColor: datum => binColorFor(datum.binCode),
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
    // The margin is what holds the strip tight to the tab bar as one header
    // block — but only when there IS a strip. This element is appended
    // unconditionally and stays empty for the gallery host (which passes
    // `showMetadataStrip: false` and renders its own strip), where a margin on
    // a zero-height div is just unaccounted space above the tabs. Set per
    // render rather than at construction, since `showMetadataStrip` is not the
    // only way this comes back empty — `buildMetadataStripBox` also returns
    // nothing when there is no metadata to show.
    metaStripEl.style.marginBottom = '0';
    if (!showMetadataStrip) return;
    // `facetableOnly: false` keeps `waferId` in the strip — safe here because
    // this tab only ever renders `showMetadataStrip: true` for
    // `renderWaferMap.ts`'s single-wafer host (`renderWaferGallery.ts` passes
    // `false` and shows its own strip instead), so `items` never has more
    // than one entry and there's no risk of a distinct-wafer-ID list
    // cluttering the strip the way it would for a multi-wafer population.
    const box = buildMetadataStripBox(items.map(it => ({ metadata: it.metadata })), undefined, { facetableOnly: false });
    if (box) {
      box.style.marginBottom = '0';
      metaStripEl.appendChild(box);
      metaStripEl.style.marginBottom = SPACE.xs;
    }
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

    // Each wafer judged by its own pass bins — index-aligned with allWafers above.
    const ringRows = buildRegionYieldData(diesByWafer, allWafers, ringCount, wi => items[wi].passBins, buildRingRegions);
    if (ringRows.length) {
      const ring = renderRegionYieldDiagram({ title: 'Ring yield', mode: 'ring', rows: ringRows, onSaveImage, ownerDocument: doc });
      elements.push(ring.card);
      destroyFns.push(ring.destroy);
    }
    const quadrantRows = buildRegionYieldData(diesByWafer, allWafers, ringCount, wi => items[wi].passBins, buildQuadrantRegions);
    if (quadrantRows.length) {
      const quadrant = renderRegionYieldDiagram({ title: 'Quadrant yield', mode: 'quadrant', rows: quadrantRows, onSaveImage, ownerDocument: doc });
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
    const passBinsLabel = describePassBins(items.map(it => it.passBins));
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
      const yieldPct = buildYieldData([{ ...item, key: item.waferIndex }], INPUT_DEFAULT_PASS_BINS)[0]?.percent;
      if (yieldPct !== undefined) card.appendChild(tile(`${yieldPct.toFixed(1)}%`, `Yield · pass: ${passBinsLabel}`));
      card.appendChild(tile(String(item.dies.length), 'Total dies'));
      return dropTrailingDivider(card) as HTMLDivElement;
    }

    card.appendChild(tile(String(items.length), 'Wafers'));

    const perWafer = buildYieldData(items.map(it => ({ ...it, key: it.waferIndex })), INPUT_DEFAULT_PASS_BINS)
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
        [{ key: 'all', items: items.map(it => ({ ...it, key: it.waferIndex })) }], INPUT_DEFAULT_PASS_BINS,
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

  /** Capability + boxplot + histogram + trend together, sharing ONE selected
   *  test, ONE set of axis toggles, and — since the group desync fix — ONE
   *  group scope. Each panel still renders the scope in the way that suits it
   *  (capability narrows, boxplot drills, histogram emphasises), but they can
   *  no longer be describing different populations at the same time. */
  function renderDistributionsSection(
    items: Item[],
    testDefs: TestDef[],
    groups: { key: string; items: Item[] }[] | undefined,
    groupLabelText: string | undefined,
  ): { card: HTMLElement; destroy: () => void } {
    const wrap = makeChartGridWrap(doc);
    const leafAction = testLeafAction(items);

    // The axis toggles are shared across the three distribution panels, the same
    // way the selected test already is (they were per-panel, so setting "axis
    // includes limits" for one test meant setting it three times) — and they
    // live at tab level, so they also survive a rebuild. See `axisPrefs` there.

    // The section's current group scope, `null` for all groups. Held here for
    // the same reason the selected test and the axis toggles are, and it is the
    // fix for a real correctness bug rather than a tidy-up.
    //
    // The three group-aware panels each owned a private group state with a
    // DIFFERENT default: capability silently restricted to `groups[0]`, the
    // boxplot opened on a pooled overview of every group, and the histogram
    // overlaid them all. Grouping a six-lot load therefore produced three cards
    // showing three different populations, side by side, from the first render
    // — and because `selectTestEverywhere` broadcast the test while nothing
    // broadcast the group, clicking a test in capability handed the boxplot the
    // right test against the wrong lot, with nothing on screen saying so.
    //
    // Trend is deliberately excluded, as it already is from `groups` entirely:
    // its x axis is the population's own slot order, and restricting it would
    // remove the drift signal that is the whole point of the chart.
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
      onTestChange: (n) => selectTestEverywhere(n),
      // Every panel gets the section's remembered test, not just capability.
      // `activeSectionTest` lives at tab level so it survives a scope change —
      // which meant that after one, capability marked the remembered test while
      // these three silently reset to `testDefs[0]`: four panels disagreeing
      // about which test they were showing, the very fault the shared selection
      // exists to prevent.
      selectedTestNumber: activeSectionTest ?? undefined,
      items: boxplotItems, testDefs, groups: boxplotGroups, groupLabelText, onSaveImage,
      onGroupChange: (key) => selectGroupEverywhere(key),
      onOpen: leafAction?.open,
      openActionLabel: leafAction?.label,
      onWaferContextMenu: waferContextMenu(items),
      ownerDocument: doc,
    });
    const histogram = renderHistogramPanel({
      title: 'Value histogram',
      axisPrefs, onAxisPrefsChange: axisHandler(() => histogram),
      onTestChange: (n) => selectTestEverywhere(n),
      selectedTestNumber: activeSectionTest ?? undefined,
      items, testDefs, groups,
      onGroupChange: (key) => selectGroupEverywhere(key),
      onSaveImage,
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
      onTestChange: (n) => selectTestEverywhere(n),
      selectedTestNumber: activeSectionTest ?? undefined,
      items: items.map(it => ({
        label: it.label,
        key: it.waferIndex,
        dies: it.dies,
        testStats: it.statsSummary?.stats.perTestStats,
      })),
      testDefs,
      onSaveImage,
      centreLabel: populationStat(describeWaferPopulation(items.map(it => it.wafer.metadata)), 'mean'),
      // Not routed through `testLeafAction`: this panel renders an empty state
      // below two wafers, so the single-wafer `focusTest` branch could never
      // fire here anyway — wiring it would be dead code claiming otherwise.
      onOpen: openWafer
        ? (key, testNumber) => openWaferDetailModal(key, `Wafer ${items.find(it => it.waferIndex === key)?.label ?? key}`, testNumber)
        : undefined,
      onWaferContextMenu: waferContextMenu(items),
      ownerDocument: doc,
    });



    // One test across the section: pick it anywhere and the others follow.
    //
    // Previously only the capability chart broadcast — clicking a column drove
    // the other three — while choosing a test in the boxplot, histogram or
    // trend told nobody, so the four panels silently disagreed about what they
    // were showing. `setTest` never fires the panels' own `onTestChange`
    // (see `makeLinkedTestSelect`), so this cannot bounce back on itself, and
    // each panel's own guard makes a redundant call free.
    const selectTestEverywhere = (testNumber: number): void => {
      activeSectionTest = testNumber;
      boxplot.setTest(testNumber);
      histogram.setTest(testNumber);
      trend.setTest(testNumber);
      // Capability included: it is the fourth chart on this page, and it used
      // to broadcast a selection while never showing one — the only panel here
      // that could not say which test its siblings were displaying.
      capability.setTest(testNumber);
    };

    const capability = renderCapabilityPanel({
      title: 'Process capability',
      items, testDefs, onSaveImage,
      selectedTestNumber: activeSectionTest ?? undefined,
      onSelectTest: (testNumber) => selectTestEverywhere(testNumber),
      ownerDocument: doc,
    });
    // No manual card.style.minHeight here — capability/histogram grow their
    // own card via ensureCardFits (chartShell.ts) once they have real
    // content to draw, measured from their own live chrome overhead rather
    // than a guessed constant. Capability's empty state (no test data at
    // all) never calls that, so it stays sized to its compact message
    // instead of forcing a large dead box next to functional siblings.
    wrap.append(capability.card, boxplot.card, histogram.card, trend.card);

    return {
      card: wrap,
      destroy: () => {
        capability.destroy(); boxplot.destroy(); histogram.destroy(); trend.destroy();
      },
    };
  }

  /**
   * One card per defined sweep. Each aggregates over whatever population the
   * Insights view is scoped to — the spec names only the tests, never the dies,
   * which is what keeps a saved sweep portable between lots and between hosts.
   */
  function renderSweepsSection(items: Item[]): { card: HTMLElement; destroy: () => void } {
    const wrap = makeChartGridWrap(doc);
    // The FULL reconciled set, not the parametric-only list the other sections
    // use: a sweep must be able to see that one of its tests is functional in
    // order to say so, rather than silently plotting a gap.
    const testDefs = mergeTestDefs(items).defs;
    const dies = items.flatMap(it => it.dies);
    const sweeps = deps.sweeps ?? [];
    const unmatched = sweeps.filter(spec => !sweepAppliesTo(spec, testDefs));
    if (unmatched.length > 0) wrap.appendChild(sweepMismatchNotice(unmatched, sweeps.length));
    const panels = sweeps.map(spec => renderSweepPanel({ spec, dies, testDefs, onSaveImage, ownerDocument: doc }));
    for (const p of panels) wrap.appendChild(p.card);
    return { card: wrap, destroy: () => { for (const p of panels) p.destroy(); } };
  }

  /**
   * The notice above the sweep cards when some sweeps name no test of this data.
   * Said here, where the empty cards are, not only in a host's log — and with
   * the way out beside it when the host can act on it.
   */
  function sweepMismatchNotice(unmatched: SweepSpec[], total: number): HTMLElement {
    const box = doc.createElement('div');
    box.setAttribute('role', 'status');
    Object.assign(box.style, {
      gridColumn: '1 / -1', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: SPACE.md,
      padding: `${SPACE.sm} ${SPACE.md}`, background: CLR.warnBg, border: `1px solid ${CLR.warnBorder}`,
      borderRadius: RADIUS.container, color: CLR.warnText, fontSize: FONT.body, lineHeight: LEADING.base,
    } as Partial<CSSStyleDeclaration>);
    const n = unmatched.length;
    const text = doc.createElement('span');
    text.style.flex = '1 1 24ch';
    text.textContent = (n === total
      ? (n === 1 ? 'This sweep names no test in this data' : 'None of these sweeps names a test in this data')
      : `${n} of ${total} sweeps name no test in this data: ${unmatched.map(s => s.title).join(', ')}`)
      + ` — ${n === 1 ? 'it' : 'they'} may belong to another test program.`;
    box.appendChild(text);
    if (deps.onRemoveSweeps) {
      const btn = doc.createElement('button');
      btn.type = 'button';
      Object.assign(btn.style, controlStyle('outlined'));
      btn.textContent = n === 1 ? 'Remove this sweep' : `Remove these ${n} sweeps`;
      wireControlHover(btn);
      const ids = unmatched.map(s => s.id);
      btn.addEventListener('click', () => deps.onRemoveSweeps!(ids));
      box.appendChild(btn);
    }
    return box;
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
      items, testDefs, groups, binColors: getBinColors().hard, onSaveImage,
      ownerDocument: doc,
    });
    const correlation = renderCorrelationPanel({
      title: 'Test correlation matrix',
      items, testDefs, onSaveImage, onSaveText,
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

  function render(opts?: { keepSections?: boolean }): void {
    if (!opts?.keepSections) dropSectionCache();
    // Clearing bodyEl detaches the cached cards without destroying them — the
    // elements, their listeners and their canvas contents all survive, so
    // re-appending shows the panel exactly as the user left it.
    bodyEl.innerHTML = '';
    tabBar.innerHTML = '';

    if (deps.backTab) tabBar.appendChild(makeBackTabButton(deps.backTab));
    for (const v of views) tabBar.appendChild(makeTabButton(v.key, v.label));

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
        v => { analysisGroupKey = v || undefined; activeSectionGroup = null; render(); },
        { hook: 'group-by', ownerDocument: doc },
      ));
      groupLabelText = facetTable.find(f => f.key === analysisGroupKey)?.label;
    } else {
      analysisGroupKey = undefined;
    }

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
    // A scope that no longer exists (the "Group by" field changed under it)
    // cannot narrow anything.
    if (activeSectionGroup !== null && !groups?.some(g => g.key === activeSectionGroup)) {
      activeSectionGroup = null;
    }

    // ONE scope control for the whole tab, beside "Group by" — not one per
    // panel.
    //
    // The panels used to own this individually and disagree about it: capability
    // and the correlation matrix each silently restricted to `groups[0]`, the
    // boxplot pooled every group, the histogram and scatter overlaid them. Three
    // views, five private group states, no default in common. Giving each panel
    // its own copy of a shared control was the first fix, and it was still four
    // copies of one idea. This is the single-dimension version: "Group by" says
    // what the axis is, "Show" says how much of it you are looking at, and every
    // panel in every view just receives the population that names.
    if (groups && groups.length > 0) {
      controlsRow.appendChild(makeLinkedGroupSelect(
        groups.map(g => g.key),
        'Show:',
        activeSectionGroup,
        key => selectGroupEverywhere(key),
        { ownerDocument: doc },
      ).el);
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
      // `marginLeft: auto` only — NO marginRight. This used to carry
      // `BAND_INSET` itself, back when `tabBar` was flush to the container and
      // the button was the only thing holding the right-hand gutter. `tabBar`
      // now takes the gutter as its own margin, so repeating it here put this
      // button 24px from the edge while every card and the tab rule sat at 12.
      Object.assign(help.style, { marginLeft: 'auto' } as Partial<CSSStyleDeclaration>);
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
    // ONE test namespace for the population — see `stats/mergeTestDefs.ts`.
    // This used to be `getItems().find(it => it?.testDefs?.length)?.testDefs`:
    // one arbitrary wafer's list, applied to every wafer's values. Test numbers
    // identify a test within a test program, so a multi-program load pooled
    // unrelated measurements under one number and normalised them against
    // whichever limits happened to arrive first. `mergeTestDefs` unions the
    // numbers (tests present only in the later wafers used to be invisible here)
    // and withholds any number that describes different measurements in
    // different wafers. The gallery reports the collisions through its own
    // warning indicator, so nothing to surface from this side.
    // SCOPE-AWARE RECONCILIATION.
    //
    // Withholding a colliding test number is right, but only over the
    // population actually being compared. Applied to the whole load it punishes
    // agreement: given six lots where four use test 1001 identically and two
    // disagree, reconciling over all six withholds 1001 from everyone — so the
    // four perfectly comparable lots lose their shared tests, and the only tests
    // left are those unique to a single lot, which is the one thing that cannot
    // be compared with anything. That is what shipped first, and it made
    // Insights emptier the more data you loaded.
    //
    // Narrowing the scope to one group removes the collision entirely: within a
    // lot a test number does identify one test, so every test returns with its
    // own file's name, unit and limits. "All groups" still withholds, because
    // pooling one lot's `vth_n_mV` with another's `leakage` under one number
    // genuinely is meaningless.
    //
    // Every view, not just Distributions — the scope is a property of the tab.
    //
    // Narrowing collapses grouping entirely: `scopeGroups` is `undefined` under
    // a scope because there is only one group left, and a panel's
    // compare-the-groups machinery (pooled overview rows, clustered bars,
    // overlaid series, a restrict-to-one dropdown) has nothing to compare. Each
    // panel simply renders its ordinary ungrouped view over that group's wafers,
    // which is what "show me this lot" should mean and removes a whole tier of
    // conditional behaviour rather than adding one.
    const scoped_ = activeSectionGroup !== null
      ? groups?.find(g => g.key === activeSectionGroup)
      : undefined;
    const scopeItems = scoped_?.items ?? allItems;
    const scopeGroups = scoped_ ? undefined : groups;
    const scoped = mergeTestDefs(scopeItems);
    const scopedAllDefs = scoped.defs;
    const scopedTestDefs = scopedAllDefs.filter(isParametricTest);
    // A test the previous scope was showing may not exist in this one.
    if (activeSectionTest !== null && !scopedTestDefs.some(d => d.testNumber === activeSectionTest)) {
      activeSectionTest = null;
    }

    const cached = opts?.keepSections ? sectionCache.get(activeView) : undefined;
    const section = cached ?? (
      activeView === 'overview'      ? renderOverviewSection(scopeItems, scopedTestDefs, scopedAllDefs, scopeGroups, groupLabelText) :
      activeView === 'distributions' ? renderDistributionsSection(scopeItems, scopedTestDefs, scopeGroups, groupLabelText) :
      activeView === 'sweeps'        ? renderSweepsSection(scopeItems) :
      renderCorrelationSection(scopeItems, scopedTestDefs, scopeGroups));
    if (!cached) sectionCache.set(activeView, section);
    // Say why the test list is short, and how to get the rest back — above
    // whichever view is active, because all three reconcile over the scope and
    // any of them can be withholding. Without it the reader sees a handful of
    // tests, no explanation, and a Findings panel beside it happily reporting on
    // tests that are missing here.
    const withheld = scoped.conflicts.filter(c => c.excluded);
    if (withheld.length > 0) {
      const note = doc.createElement('div');
      Object.assign(note.style, {
        color: CLR.label, fontSize: FONT.body, padding: `0 ${contentInset} ${SPACE.sm}`,
      } as Partial<CSSStyleDeclaration>);
      const numbers = withheld.slice(0, 6).map(c => c.testNumber).join(', ');
      const more = withheld.length > 6 ? `, and ${withheld.length - 6} more` : '';
      const them = withheld.length === 1 ? 'it' : 'them';
      note.textContent =
        `${withheld.length} test ${withheld.length === 1 ? 'number is' : 'numbers are'} hidden `
        + `(${numbers}${more}) — the wafers in view describe ${them} differently, so their values `
        + 'cannot be pooled. '
        + (groups && groups.length > 0
            ? `Pick one ${groupLabelText ?? 'group'} under "Show:" to analyse ${them}.`
            : 'Load one test program at a time to analyse them.');
      note.dataset.wmapWithheldTests = String(withheld.length);
      bodyEl.appendChild(note);
    }

    bodyEl.appendChild(section.card);
  }

  return {
    el: rootEl,
    render,
    destroy: () => {
      dropSectionCache();
      rootEl.remove();
    },
  };
}
