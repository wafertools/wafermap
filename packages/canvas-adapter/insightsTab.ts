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

import type { Die, PositionedDie } from '../core/dies.js';
import type { Wafer } from '../core/wafer.js';
import type { LotStatsSummary, StatsSummary } from '../stats/types.js';
import { MEAN_WAFER_YIELD_LABEL } from '../stats/presentation.js';
import { buildFacetTable, facetValueOf, FACET_NONE_VALUE, DEFAULT_FACET_CURATION, type FacetCuration, type FacetItem } from '../stats/facets.js';
import { mergeTestDefs } from '../stats/mergeTestDefs.js';
import { isParametricTest, type TestDef } from '../renderer/buildWaferMap.js';
import { dieFailsTest, hasJudgeableTests, testsForPassKind, buildTestPassRateData, type TestPassKind } from '../stats/testPassRate.js';
import { fmt } from '../renderer/fmt.js';
import { testLabel } from '../renderer/testLabel.js';
import type { WaferMapDisplayItem } from './renderWaferGallery.js';
import { waferDisplayLabel, waferIdentityLabel } from '../core/waferLabel.js';
import { waferPopulation } from './chartPopulation.js';
import { openDrilldownMenu } from './drilldown.js';
import { plotStoreFor, type PlotStore } from './plotStore.js';
import type { PlotFilter, PlotSpec } from '../stats/plotSpec.js';
import type { SavedFilter } from '../stats/filterFile.js';
import { createPageFilter, type PageFilterController } from './pageFilter.js';
import { bandButton as makeBandButton } from './filterButton.js';
import { itemPassBins, passBinsLabel as describePassBins } from '../core/passBins.js';
import type { BinColors } from '../renderer/binColors.js';
import { describeWaferPopulation, populationStat } from '../stats/population.js';
import { LEADING, ALPHA, SPACE, EDGE_GUTTER, FONT, CLR, RADIUS, SHADOW, controlStyle, wireControlHover, wireTooltip, type SaveImageHandler, type SaveTextHandler } from './toolbar.js';
import { ICONS } from './icons.js';
import { renderCapabilityPanel } from './charts/capability.js';
import { renderGroupComparisonPanel } from './charts/groupComparison.js';
import { renderCommonalityPanel } from './charts/commonality.js';
import { renderPatCard } from './charts/patCard.js';
import { renderDifferenceMapPanel } from './differenceMapPanel.js';
import type { RenderableWaferMap } from './renderWaferMap.js';
import type { SweepSpec } from '../stats/sweep.js';
import { renderCorrelationPanel } from './charts/correlation.js';
import { cardFrameStyle, makeChartGridWrap, makeLabeledSelect, makeLinkedGroupSelect, makeLinkedTestSelect, makeWaferSelect, makeTestSelect, makeLimitsSelect, makeLinkedAxisPrefs, makeToggle, limitLines, limitExtent, shouldIncludeLimitsByDefault, hasBothLimitKinds, type AxisPrefs, type WaferContextMenuHandler } from './charts/chartShell.js';
import { maxOf, minOf } from '../core/utils.js';
import { buildYieldData, buildYieldDataCombined } from '../stats/yield.js';
import { buildLotTestSectionSteps, buildLotFunctionalSection, buildMetadataStripBox } from './summaryPanel.js';
import { runChunked } from './chunked.js';
import { buildRegionYieldData, buildRingRegions, buildQuadrantRegions, buildReticlePositionRegions, diesInRegion, type RegionYieldDatum } from '../stats/regions.js';
import { renderDataSection, type DataView } from './dataTab.js';
import { sourceFromDies, toPlotItems } from './plotItems.js';
import { isYieldEligibleDie } from '../core/dies.js';
import { renderPlotCard, type CardChoice } from './plotCard.js';
import { orderFieldValues, axisValues, type PlotContext, type PlotItem, type PlotPoint } from '../stats/plotData.js';
import type { CardSpec } from '../stats/cardSpec.js';
import { buildSynthesis, synthesisKey, type SynthesisTarget } from '../stats/synthesis.js';
import { commonPassBins } from '../core/passBins.js';
import { renderRegionYieldDiagram } from './charts/regionYieldDiagram.js';

export type InsightsView = 'overview' | 'distributions' | 'correlation' | 'sweeps' | 'data' | 'plot';

/** Public option shape for `RenderOptions.insights`/`GalleryOptions.insights`. */
export interface InsightsOptions {
  /**
   * Show an "Insights" tab in the toolbar and a Maps | Insights switch. Selecting it replaces the canvas/
   * grid with wmap's own chart suite across three sub-tabs — Overview
   * (yield, bins, ring/quadrant yield), Distributions
   * (process capability, boxplot, histogram), and Correlation (matrix +
   * scatter) — a Data tab (the scope as tables: statistics, dies, wafers, with CSV
   * export) and a Plot tab, where the reader's own plots and sweeps live. Default true with a toolbar
   * (a gallery always has one); `false` opts out.
   */
  enabled?: boolean;
  /** Which sub-tab is shown first. Default 'overview'. `'sweeps'` opens the My plots tab, where sweeps are drawn. */
  defaultView?: InsightsView;
  /**
   * @deprecated Sweeps are plots now: give them in `plots` as sweep plots, or read a sweeps file with
   * `readPlotsFile`. Each entry here is still drawn, as a sweep plot on the Plot tab (and offered on selected dies),
   * under the same `id`; a plot saved under that id takes precedence. The first use logs a notice.
   *
   * A sweep reads an ordered run of tests as a response curve rather than as independent tests, and measures the
   * PAIR: where the first two series cross, and how far apart they are at given levels. It carries no population:
   * the dies it aggregates are whatever the view is scoped to or the reader selected.
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
   * Range strings in `tests` (`"1010..1030"`) share the derived-test parser, so the syntax is one syntax library-wide.
   */
  sweeps?: SweepSpec[];
  /**
   * @deprecated With `sweeps`. Called with the id of a sweep from `sweeps` that the reader deletes on the Plot tab, so the
   * host stops supplying it (otherwise the next render brings it back). Plots deleted from `plots` arrive through
   * `onPlotsChange` like any other.
   */
  onRemoveSweeps?: (ids: string[]) => void;
  /**
   * The reader's saved plots: the recipes behind the **Plot** tab, in the order the reader keeps them. The
   * library never stores anything itself: hand the list in here (from a file, `localStorage`, a server) and keep
   * it current from `onPlotsChange`. A plot carries no population, so the same list works on any lot; one that
   * needs a test the open lot lacks is kept and shown greyed with the reason, never dropped.
   */
  plots?: PlotSpec[];
  /**
   * Called with the whole list after the reader adds, edits, duplicates, deletes or imports a plot (a burst of
   * typing is one call). Keep it, and pass it back as `plots` next time.
   */
  onPlotsChange?: (plots: PlotSpec[]) => void;
  /**
   * Choose a plots file to import, resolving to its text, or `null` when cancelled. Without it the Plot tab uses
   * the browser's own file input; a desktop host passes its native dialog.
   */
  onPickPlotsFile?: () => Promise<string | null>;
  /**
   * The page filter to start with: conditions the wafers and dies of the gallery, the map and every Insights tab must
   * meet (one split, the edge ring, a range of a test), with `off` to keep them unapplied. It is one filter for all of
   * them: a wafer condition removes a wafer's card, a die condition draws the dies it drops dimmed on a map. It is view
   * state, like Group by: the reader edits it from the Filter button, it is shown above the view whenever it exists, and
   * it is never written into a plots file. Keep it from `onFilterChange` to restore it.
   */
  filter?: PlotFilter;
  /** Called with the filter after the reader applies, switches, or removes it (`undefined` once removed). */
  onFilterChange?: (filter: PlotFilter | undefined) => void;
  /**
   * Filters the reader has saved under a name, to start with (`SavedFilter`: `id`, `name`, `conditions`). The Filter
   * window lists them to load into the editor, and Export… / Import… move them as a `wafermap-filters` file
   * (`readFiltersFile` / `writeFiltersFile`). Read leniently, like a plots file: one that cannot be read is left out and
   * logged. Keep them from `onSavedFiltersChange`.
   */
  savedFilters?: SavedFilter[];
  /** Called with the whole list after the reader saves, deletes or imports a filter. */
  onSavedFiltersChange?: (filters: SavedFilter[]) => void;
  /**
   * Choose a filters file to import, resolving to its text, or `null` when cancelled. Without it the browser's own file
   * input is used; a desktop host passes its native dialog, as with `onPickPlotsFile`.
   */
  onPickFiltersFile?: () => Promise<string | null>;
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
  /** The charts' axis settings to start from: the host's `chart*` preferences (see `axisPrefsFromOptions`). */
  initialAxisPrefs?: AxisPrefs;
  /** Called when the reader changes an axis setting, so the renderer can report it as a preference. */
  onAxisPrefsChange?: (prefs: AxisPrefs) => void;
  /** The host's own wafer attributes (`attributes` on the render options): what Group by offers and calls each, the plot fields, the Wafers table's columns and the strip. Over the defaults. */
  attributes?: Record<string, FacetCuration>;
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
  getRingCount: () => number;
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
  /**
   * A die row clicked in a table (the Data tab, or a table opened from a chart): leave Insights and show
   * that die on its map. Omit where there is no map to go back to; the rows are then not clickable.
   */
  locateDie?: (die: Die, waferIndex: number | undefined) => void;
  /** Default sub-tab shown on first render. Default 'overview'. */
  defaultView?: InsightsView;
  /** Sweep definitions to render in the Distributions view — see `InsightsOptions.sweeps`. */
  sweeps?: SweepSpec[];
  /** See `InsightsOptions.onRemoveSweeps`. */
  onRemoveSweeps?: (ids: string[]) => void;
  /**
   * The live list of saved plots, shared with the drilldown menu so a plot edited here is the one a right-click
   * opens. Created from `plots`/`onPlotsChange` when omitted.
   */
  plotStore?: PlotStore;
  plots?: PlotSpec[];
  onPlotsChange?: (plots: PlotSpec[]) => void;
  onPickPlotsFile?: () => Promise<string | null>;
  /**
   * Leaves Insights and shows a "What stands out" item on the map, as its row in the Summary panel does: a finding's dies,
   * or a test's value map with the dies it fails. Omitted ⇒ the Worth a look cards offer no Show on map.
   */
  showOnMap?: (target: SynthesisTarget) => void;
  /** The PAT card's Map the verdicts: back to the maps, coloured by PAT verdict. */
  showPatMap?: () => void;
  /** See `InsightsOptions.filter` and `onFilterChange`. */
  filter?: PlotFilter;
  onFilterChange?: (filter: PlotFilter | undefined) => void;
  /** Whether the tab row carries its own Filter button. A host whose chrome already has one (the gallery, the map) turns it off, so the button keeps one place. Default true. */
  showFilterButton?: boolean;
  /** The page filter the maps and the gallery share; created from `filter` and `onFilterChange` when omitted. */
  pageFilter?: PageFilterController;
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
  /** Adopt axis settings set from outside (the host's `setOptions`), in every chart. */
  setAxisPrefs: (prefs: AxisPrefs) => void;
  /**
   * Opens the Overview at the Worth a look card of the item `key` names (`synthesisKey`), scrolled into view: the Summary
   * panel's Chart link. False when there is no such card (the item has none, or the list is hidden while narrowed).
   */
  showWorthCard: (key: string) => boolean;
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
  /** The wafer's own result as the host handed it in: what a map drawn from this wafer's dies (a difference map) is
   *  rendered on, so it keeps the wafer's geometry and orientation. */
  source?: RenderableWaferMap;
};

/** One wafer (or the lot's single stand-in) as the Insights views see it. */
export type InsightsItem = Item;

const VIEWS: Array<{ key: InsightsView; label: string }> = [
  { key: 'overview',      label: 'Overview' },
  { key: 'distributions', label: 'Distributions' },
  { key: 'correlation',   label: 'Correlation' },
];

/** After the charts: the same scope as tables, with their exports (dataTab.ts). */
const DATA_VIEW: { key: InsightsView; label: string } = { key: 'data', label: 'Data' };

/** Last: the reader's own plots (plotTab.ts). */
const PLOT_VIEW: { key: InsightsView; label: string } = { key: 'plot', label: 'My plots' };

export function createInsightsTab(deps: InsightsTabDeps): InsightsTabHandle {
  const { getItems, getLotStats, getBinColors, getRingCount, onSaveImage, onSaveText, openWafer, focusTest, locateDie } = deps;
  // Every wafer attribute this tab lists, labels or reads is judged by the host's curation over the defaults.
  const curation: Record<string, FacetCuration> = { ...DEFAULT_FACET_CURATION, ...deps.attributes };
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
  // children.
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

  // The page filter, between the tabs and what they show: present on every tab whenever a filter exists, on or off.
  const pageFilter = deps.pageFilter ?? createPageFilter({ doc, initial: deps.filter, onChange: deps.onFilterChange, attributes: deps.attributes, getRingCount: deps.getRingCount });
  const filterBand = pageFilter.createBand(() => facetItems(), { marginLeft: contentInset, marginRight: contentInset, marginBottom: SPACE.lg });
  const filterBandEl = filterBand.el;

  // Columns of cards: Auto fits as many as the width holds; a count (1 to 5) fixes it for every grid in the tab. Carried as two CSS
  // variables on the tab's own element, which every chart grid reads (chartShell.makeChartGridWrap), so a change needs no redraw.
  let columnsPref: number | undefined;
  let columnsSelect: (HTMLElement & { value: string }) | null = null;
  const setColumns = (n: number | undefined): void => {
    columnsPref = n;
    if (n === undefined) { rootEl.style.removeProperty('--wmap-insights-cols'); rootEl.style.removeProperty('--wmap-insights-min'); }
    else { rootEl.style.setProperty('--wmap-insights-cols', String(n)); rootEl.style.setProperty('--wmap-insights-min', '0px'); }
    if (columnsSelect) columnsSelect.value = n === undefined ? 'auto' : String(n);
  };
  // Keys 1 to 5 set the columns and 0 sets Auto, as in a gallery. Heard on the document so it needs no focus inside the tab, only
  // while this tab is on screen, and not in a text box, a menu or a window.
  const onColumnsKey = (e: KeyboardEvent): void => {
    if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey || e.defaultPrevented) return;
    if (!/^[0-5]$/.test(e.key) || !rootEl.isConnected || rootEl.style.display === 'none') return;
    const target = e.target as { closest?: (selector: string) => Element | null } | null;
    if (typeof target?.closest === 'function' && target.closest('input, textarea, select, [contenteditable="true"], [role="menu"], [role="dialog"]')) return;
    e.preventDefault();
    setColumns(e.key === '0' ? undefined : Number(e.key));
  };
  doc.addEventListener('keydown', onColumnsKey);

  rootEl.appendChild(metaStripEl);
  rootEl.appendChild(tabBar);
  rootEl.appendChild(filterBandEl);
  rootEl.appendChild(bodyEl);

  const views = [...VIEWS, DATA_VIEW, PLOT_VIEW];
  const plotStore = deps.plotStore ?? plotStoreFor(deps);
  // Edit as plot (a card's ⋯ menu): the card as the reader's own plot, opened as a draft over the card's population. It
  // joins My plots only when the reader adds it.
  const editAsPlot = (plot: PlotSpec, over: { items: readonly PlotItem[]; ctx: PlotContext }): void => {
    void import('./plotModal.js').then(({ openPlotEditor }) => openPlotEditor({
      doc, anchor: rootEl, store: plotStore, plot, draft: true, items: [...over.items], ctx: over.ctx,
      title: plot.title ? `New plot from “${plot.title}”` : 'New plot',
      chart: { onSaveImage, binColors: getBinColors() },
    }));
  };
  // Sweeps are plots now: the old Sweeps tab opens the Plot tab, where they are.
  let activeView: InsightsView = deps.defaultView === 'sweeps' ? 'plot' : deps.defaultView ?? 'overview';
  let analysisGroupKey: string | undefined;
  /** Whether the filter is narrowing what the tabs show right now: the host's lot stats describe every die, so not then. */
  let filtering = false;
  pageFilter.subscribe(() => render());
  // The Data tab's own choices live here for the same reason as the shared test
  // below: `render()` rebuilds the section, and the choice must outlive that.
  let dataView: DataView = 'statistics';
  let diesLayout: 'wide' | 'long' = 'wide';

  // Distributions' shared selected test and group scope live HERE, not inside
  // `renderDistributionsSection`, because changing the scope now rebuilds the
  // section: the reconciled test list is a function of the scope (see
  // `scopedTestDefs` in `render`), so a scope change has to re-derive it, and
  // section-local state would be discarded on every such change.
  let activeSectionTest: number | null = null;
  /** The group comparison's control group, kept at tab level so a rebuild or a tab switch keeps the choice. */
  let compareControl: string | null = null;
  /** The wafer fields that divide the wafers, as the Group by list offers them: what the commonality card compares. */
  let dividingFields: Array<{ key: string; label: string }> = [];
  let activeSectionGroup: string | null = null;
  // The shared axis toggles, here for the same reason: `render()` rebuilds every
  // panel, so section-local state is discarded by a scope change — and, less
  // obviously, by the host merely closing and reopening Insights, which silently
  // reverted the user's "clip outliers"/"axis includes limits" choices.
  //
  // `includeLimits: undefined` is not "off" — it means each panel derives the
  // default from its own data (shouldIncludeLimitsByDefault). It only becomes a
  // boolean once the user actually picks, and then it sticks across tests.
  let axisPrefs: AxisPrefs = deps.initialAxisPrefs ?? { includeLimits: undefined, clipOutliers: false, limits: 'both' };
  // Every panel that follows `axisPrefs`, by section — the distribution panels
  // and the correlation section's scatter both draw limit lines, and the
  // "Limits:" choice made in either must reach the other. A section registers
  // its panels when it is built, replacing any earlier ones.
  type AxisPrefsPanel = { setAxisPrefs: (p: AxisPrefs) => void };
  const axisPrefsPanels = new Map<string, ReadonlyArray<AxisPrefsPanel>>();
  /** Adopt `prefs` everywhere except `from`, which has already applied the
   *  change and rebuilt — re-entering its own rebuild would discard the
   *  interaction in progress. */
  const broadcastAxisPrefs = (prefs: AxisPrefs, from: AxisPrefsPanel | null, fromHost = false) => {
    axisPrefs = prefs;
    for (const panels of axisPrefsPanels.values()) for (const p of panels) if (p !== from) p.setAxisPrefs(prefs);
    // A reader's change is a preference the host may keep; one the host set is not reported back.
    if (!fromHost) deps.onAxisPrefsChange?.(prefs);
  };

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
   * Always offered: there are always dies to tabulate, even where nothing
   * could be charted.
   */
  function waferContextMenu(items: Item[]): WaferContextMenuHandler | undefined {
    return (waferIndex, testNumber, e) => {
      const it = items.find(i => i.waferIndex === waferIndex);
      if (!it) return;
      e.preventDefault();
      const source = waferPopulation(it.dies, {
        waferLabel: it.identity, testDefs: it.testDefs,
        activeTest: testNumber ?? activeSectionTest ?? undefined, waferIndex, wafer: it.wafer, passBins: it.passBins, ringCount: getRingCount(),
      });
      openDrilldownMenu({ x: e.clientX, y: e.clientY }, e.target as HTMLElement, source, { plots: plotStore, getBinColors, onSaveImage, onSaveText, onLocateDie: locateDie });
    };
  }

  /**
   * Opens the drilldown menu on the dies of `items` that `keep` accepts, wherever the click was: one population for
   * everything a chart mark counts (a bin, a histogram bucket, a ring). Per wafer, so the tables name each die's wafer
   * and a chart opened on it is of exactly those dies. Nothing happens when no die qualifies.
   */
  function openDiesMenu(e: MouseEvent, items: Item[], what: string, keep: (d: Die) => boolean, activeTest?: number): void {
    openDiesMenuAt({ x: e.clientX, y: e.clientY }, e.target as HTMLElement, items, what, keep, activeTest);
  }

  /** `openDiesMenu` for a gesture that reports where it ended rather than handing over its event (a drag). */
  function openDiesMenuAt(at: { x: number; y: number }, anchor: HTMLElement, items: Item[], what: string, keep: (d: Die) => boolean, activeTest?: number): void {
    const source = sourceFromDies(items.map(it => ({ label: it.identity ?? it.label, dies: it.dies, waferIndex: it.waferIndex, wafer: it.wafer, passBins: it.passBins, ringCount: getRingCount() })),
      what, keep, mergeTestDefs(items).defs, activeTest);
    if (!source) return;
    openDrilldownMenu(at, anchor, source, { plots: plotStore, getBinColors, onSaveImage, onSaveText, onLocateDie: locateDie });
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
        statsSummary: it.statsSummary, testDefs: it.testDefs, source: it,
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

  /** Yield-by-wafer + bin pareto together, both drawn as plots (plotCard.ts): yield pooled per wafer or per group, with
   *  in-place drill-down when grouped; the bin pareto one bar per group within each bin when grouped. Both belong
   *  to Overview: they're the chart form of the same yield/bin numbers the Overview details card shows below them. */
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
    const label = groupLabelText ?? 'group';
    // CLAUDE.md: "yield label must name the actual pass bins in use, not
    // assume bin 1" — mirrors renderSummaryReportHtml's summary-metric label.
    const passBinsLabel = describePassBins(items.map(it => it.passBins));
    // The plot cards' population. A host card label can carry the yield itself ("W01 · 92.7%"); the chart prints its own.
    const plotItems = toPlotItems(items.map(it => ({
      label: it.identity ?? it.label.replace(/\s*·\s*\d+(\.\d+)?%$/, ''), dies: it.dies, waferIndex: it.waferIndex, wafer: it.wafer, passBins: it.passBins, ringCount: getRingCount(),
    })));
    const plotDefs = mergeTestDefs(items).defs;
    const groupBy = groups ? analysisGroupKey : undefined;
    const plotCtx = { testDefs: plotDefs, groupBy, curation: deps.attributes };

    // Yield as a plot (plotCard.ts): pooled passing over judged dies per bar, the same rule every yield figure uses, with
    // each value at its bar's end and the median of the bars drawn as a line (three bars or more: a median of two is not
    // a reference). Grouped, a group's bar drills into its wafers in place; a wafer's bar opens that wafer.
    const yieldSpec = (sort: boolean, bars: number): CardSpec => ({
      id: 'card-yield', title: groups ? `Yield by ${label} (pass: ${passBinsLabel})` : `Yield by wafer (pass: ${passBinsLabel})`, chart: 'bar',
      fields: { x: { slot: 'groupBy' }, y: { builtin: 'yield' }, color: { none: true } },
      valueLabels: true, ...(sort ? { sort: 'value' as const } : {}),
      ...(bars >= 3 ? { axes: { y: { references: [{ stat: 'median' as const }] } } } : {}),
    });
    const barCount = groups ? groups.length : items.length;
    let yieldPanel: ReturnType<typeof renderPlotCard> | null = null;
    if (includeYieldPanel) {
      yieldPanel = renderPlotCard({
        doc, editAsPlot, items: plotItems, ctx: plotCtx,
        spec: {
          choices: [{ current: 'natural', options: drilledIn => [['value', 'Sort: yield'], ['natural', groups && !drilledIn ? `Sort: ${label}` : 'Sort: wafer']] }],
          build: ([sort]) => yieldSpec(sort === 'value', barCount),
        },
        drill: groups && groupBy ? points => {
          const value = facetValueOf(plotItems[points[0]?.item]?.metadata, groupBy, deps.attributes);
          if (value === undefined) return null;
          const n = groups.find(g => g.key === value)?.items.length ?? 0;
          return spec => ({
            ...spec, title: `Yield by wafer — ${label}: ${value} (pass: ${passBinsLabel})`,
            fields: { ...spec.fields, x: { builtin: 'wafer' } },
            where: { conditions: [{ field: { meta: groupBy }, values: [value] }] },
            axes: n >= 3 ? { y: { references: [{ stat: 'median' }] } } : undefined,
          });
        } : undefined,
        drillLabel: 'see its wafers',
        chart: {
          onSaveImage,
          onOpenWafer: openWafer ? i => openWaferDetailModal(plotItems[i].waferIndex ?? i, `Wafer ${plotItems[i].label}`) : undefined,
          onWaferMenu: waferContextMenu(items),
        },
      });
      yieldPanel.card.style.minHeight = '360px';
      wrap.appendChild(yieldPanel.card);
    }

    // The pareto is a plot (plotCard.ts): bars by bin, largest first. Alone, each bar in its bin's map colour with the
    // cumulative share; with Group by on, one bar per group within each bin, as counts or as each group's share of its
    // own dies, so splits of different sizes compare. A bar is a bin (in one group): click it for its dies.
    const binChoice: CardChoice = { current: 'hbin', options: [['hbin', 'Hard bins', 'The physical sort result: where the part goes on the handler'], ['sbin', 'Soft bins', 'The test program’s failure category: many soft bins can map to one hard bin']] };
    // Grouped, each group's share by default: groups of different sizes then compare bin for bin; counts are a click away.
    const shareChoice: CardChoice = { current: 'share', options: [['count', 'Counts'], ['share', `Share of ${label}`, `Each ${label}’s dies in a bin as a share of all its dies, so ${label} values of different sizes compare`]] };
    const paretoOf = (bin: string, share: string | undefined): CardSpec => ({
      id: 'card-bin-pareto', title: `${bin === 'sbin' ? 'Soft' : 'Hard'} bin pareto`, chart: 'bar', sort: 'value',
      fields: { x: { builtin: bin === 'sbin' ? 'sbin' : 'hbin' }, color: groups ? { follow: 'groupBy' } : { builtin: bin === 'sbin' ? 'sbin' : 'hbin' } },
      ...(groups ? (share === 'share' ? { barNorm: 'percent' as const } : {}) : { cumulative: true }),
    });
    const binPanel = renderPlotCard({
      doc, editAsPlot, items: plotItems, ctx: plotCtx,
      spec: groups ? { choices: [binChoice, shareChoice], build: ([bin, share]) => paretoOf(bin, share) } : { choices: [binChoice], build: ([bin]) => paretoOf(bin, undefined) },
      chart: {
        onSaveImage, binColors,
        // Named for its bin and group ("in hard bin 3 of POR"), and exactly the dies the bar counts (no partial or
        // edge-excluded ones).
        onSelectPoints: (points, at, anchor, info) => {
          const x = binPanel.current().fields.x;
          const type = x && !Array.isArray(x) && 'builtin' in x && x.builtin === 'sbin' ? 'sbin' : 'hbin';
          const bins = new Set(points.map(p => (type === 'hbin' ? p.die?.hbin : p.die?.sbin)));
          if (bins.size !== 1) return;
          const bin = [...bins][0];
          // The colour is the group only with Group by on; alone, it is the bin itself.
          const group = groups ? info?.group : undefined;
          const among = group !== undefined ? groups?.find(g => g.key === group)?.items ?? [] : items;
          openDiesMenuAt(at, anchor, among, `in ${type === 'hbin' ? 'hard' : 'soft'} bin ${bin}${group !== undefined ? ` of ${group}` : ''}`,
            d => isYieldEligibleDie(d) && (type === 'hbin' ? d.hbin : d.sbin) === bin);
        },
      },
    });
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
  ): { elements: HTMLElement[]; destroy: () => void } {
    if (!items.length) return { elements: [], destroy: () => {} };
    const allWafers = items.map(it => it.wafer);
    const diesByWafer = items.map(it => it.dies);
    const ringCount = getRingCount();

    const elements: HTMLElement[] = [];
    const destroyFns: Array<() => void> = [];

    // Per-test pass rate, split by group when grouping is active. The suite could
    // previously answer "which BIN is failing" (bin pareto) and "which group
    // yields worse" (yield chart), but not "which TEST is failing, and does it
    // fail more in one split than another" — the question a split experiment is
    // usually run to answer. Covers parametric (spec-limit judgement) and
    // functional (recorded verdict) tests behind one selector; see
    // stats/testPassRate.ts for why they share a builder.
    // A plot (plotCard.ts): one horizontal bar per test, worst first, on a fixed 0–100% axis, one per group when grouped.
    // Three judgements, offered as the data supports them: a parametric test's value against its limits, the tester's
    // own recorded flag, and a functional test's verdict (stats/testPassRate.ts says why they are separate). The two
    // parametric ones can disagree, and the card says on how many dies rather than picking one.
    const passRateGroups = groupsForPassRate ?? [{ key: '', items }];
    const allDies = items.flatMap(it => it.dies);
    const kinds = (['spec', 'testFlag', 'functional'] as const).filter(k => hasJudgeableTests(allTestDefs, k, allDies));
    if (kinds.length) {
      const KIND = {
        spec: { label: 'Test limits', hint: 'Judged from each die’s measured value against the test’s limits', title: 'Parametric pass rate · test limits' },
        testFlag: { label: 'Tester flag', hint: 'The pass or fail the tester recorded for each die', title: 'Parametric pass rate · tester flag' },
        functional: { label: 'Functional', hint: 'Tests that only pass or fail and have no measured value', title: 'Functional test pass rate' },
      } as const;
      const grouped = !!groupsForPassRate;
      const plotItems = toPlotItems(items.map(it => ({ label: it.identity ?? it.label, dies: it.dies, waferIndex: it.waferIndex, wafer: it.wafer, passBins: it.passBins, ringCount })));
      const specOf = (kind: TestPassKind): CardSpec => ({
        id: `card-pass-rate-${kind}`, title: KIND[kind].title, chart: 'bar', orientation: 'horizontal', sort: 'ascending',
        fields: {
          x: { builtin: 'test' },
          y: { tests: testsForPassKind(allTestDefs, kind).map(d => d.testNumber), passRate: true, ...(kind === 'testFlag' ? { judge: 'flag' as const } : {}) },
          color: grouped ? { follow: 'groupBy' } : { none: true },
        },
        ...(grouped ? {} : { valueLabels: true }),
        // A fixed axis: a 99% and a 98% test must not both draw a full bar.
        axes: { y: { min: 0, max: 100 } },
      });
      const kindOf = (spec: CardSpec): TestPassKind => spec.id.slice('card-pass-rate-'.length) as TestPassKind;
      const passRate = renderPlotCard({
        doc, editAsPlot, items: plotItems, ctx: { testDefs: allTestDefs, groupBy: grouped ? analysisGroupKey : undefined, curation: deps.attributes },
        spec: kinds.length > 1
          ? { choices: [{ current: kinds[0], options: kinds.map(k => [k, KIND[k].label, KIND[k].hint] as [string, string, string]) }], build: ([k]) => specOf(k as TestPassKind) }
          : specOf(kinds[0]),
        // Surfaced, not resolved: a spec/flag disagreement is expected under guard bands or dynamic limits, but it is
        // also how a limits/data mismatch shows itself, and the reader is the one who can tell those apart.
        notes: spec => {
          const kind = kindOf(spec);
          if (kind === 'functional') return [];
          const n = buildTestPassRateData(passRateGroups.map(g => ({ key: g.key, items: g.items.map(it => ({ dies: it.dies })) })), allTestDefs, kind).disagreementDies;
          return n ? [`${n.toLocaleString('en-GB')} die${n === 1 ? '' : 's'} judged differently by test limits and the tester flag`] : [];
        },
        chart: {
          onSaveImage,
          selectActionLabel: 'chart or tabulate the dies that fail its test',
          // A bar is a test (in one group): the dies that fail it, judged as the card is showing.
          onSelectPoints: (_points, at, anchor, info) => {
            const def = allTestDefs.find(d => d.testNumber === info?.test);
            if (!def) return;
            const kind = kindOf(passRate.current());
            const among = info?.group !== undefined ? passRateGroups.find(g => g.key === info.group)?.items ?? items : items;
            openDiesMenuAt(at, anchor, among, `failing ${testLabel(def, def.testNumber)}${info?.group !== undefined ? ` in ${info.group}` : ''}`,
              d => dieFailsTest(d, def, kind) === true, isParametricTest(def) ? def.testNumber : undefined);
          },
        },
      });
      passRate.card.style.minHeight = '300px';
      elements.push(passRate.card);
      destroyFns.push(passRate.destroy);
    }

    // A region of the yield diagram is a ring or a quadrant: click it for the dies it counts, across the wafers in view.
    const regionClick = (builder: typeof buildRingRegions) => (row: RegionYieldDatum, e: MouseEvent): void => {
      const inRegion = new Set<Die>();
      for (const it of items) for (const d of diesInRegion(it.dies, it.wafer, ringCount, row.key, builder)) inRegion.add(d);
      openDiesMenu(e, items, `in ${row.label}`, d => inRegion.has(d));
    };

    // Each wafer judged by its own pass bins — index-aligned with allWafers above.
    const ringRows = buildRegionYieldData(diesByWafer, allWafers, ringCount, wi => items[wi].passBins, buildRingRegions);
    if (ringRows.length) {
      const ring = renderRegionYieldDiagram({ title: 'Ring yield', mode: 'ring', rows: ringRows, onSelectRegion: regionClick(buildRingRegions), onSaveImage, ownerDocument: doc });
      elements.push(ring.card);
      destroyFns.push(ring.destroy);
    }
    const quadrantRows = buildRegionYieldData(diesByWafer, allWafers, ringCount, wi => items[wi].passBins, buildQuadrantRegions);
    if (quadrantRows.length) {
      const quadrant = renderRegionYieldDiagram({ title: 'Quadrant yield', mode: 'quadrant', rows: quadrantRows, onSelectRegion: regionClick(buildQuadrantRegions), onSaveImage, ownerDocument: doc });
      elements.push(quadrant.card);
      destroyFns.push(quadrant.destroy);
    }

    // Reticle cell yield: the field as a grid, one cell per position in it, pooled over every field on every wafer. Only when
    // the wafers carry a stepper field; a cell that is bad in all of them points at the mask, not at the wafer.
    const reticle = allWafers.find(w => w.reticle !== undefined)?.reticle;
    if (reticle) {
      const cellBuilder = (dies: PositionedDie[], wafer: Wafer) => buildReticlePositionRegions(dies, wafer.reticle);
      const cellRows = buildRegionYieldData(diesByWafer, allWafers, ringCount, wi => items[wi].passBins, cellBuilder);
      if (cellRows.length) {
        const cells = renderRegionYieldDiagram({
          title: 'Reticle cell yield', mode: 'reticleCell', rows: cellRows, grid: { width: Math.max(1, Math.floor(reticle.width)), height: Math.max(1, Math.floor(reticle.height)) },
          onSelectRegion: regionClick(cellBuilder), onSaveImage, ownerDocument: doc,
        });
        elements.push(cells.card);
        destroyFns.push(cells.destroy);
      }
    }

    return { elements, destroy: () => { for (const d of destroyFns) d(); } };
  }

  /**
   * The test-values and functional-tests tables for `items` (the Data tab's
   * Statistics view). They were Overview cards; the computation is unchanged.
   */
  function buildStatisticsCards(
    items: Item[],
    testDefs: TestDef[],
    /** UNFILTERED defs: the functional table needs the `testType: 'F'` entries. */
    allTestDefs: TestDef[],
  ): { cards: HTMLElement[]; destroy: () => void } {
    if (!items.length) return { cards: [], destroy: () => {} };
    const diesByWafer = items.map(it => it.dies);
    const allDies = items.flatMap(it => it.dies);
    const summaries = items.map(it => it.statsSummary);
    const perWaferSummaries = summaries.every((s): s is StatsSummary => s !== undefined) ? summaries : undefined;
    const destroyFns: Array<() => void> = [];

    // Rendered as a table (one row per test, columns per stat) — reads far
    // better than a stacked kv-block per test, and a table with several
    // stat columns needs real width, so it's promoted to a full-width
    // sibling of the grid (like the metadata card) rather than a squeezed
    // grid item.
    const cards: HTMLElement[] = [];
    let testValuesCard: HTMLElement | null = null;
    if (testDefs.length) {
      // Full column set and a Ppk column: this card is a full-width sibling of
      // the grid, not the 260px docked panel, so it carries the descriptive
      // statistics the panel's compact variant leaves to the report/CSV.
      //
      // Built in slices, like the panel's own copy: on a large lot the pooled
      // statistics behind it are seconds of work when Insights opens before the
      // panel has finished them. It then joins the panel's pass (see
      // `pooledTestStatsSteps`) rather than repeating it, and the rest of the
      // Overview is usable meanwhile. Already computed, it is built in the
      // first slice, before this function returns, with no placeholder.
      const card = plainCard();
      let built: HTMLElement | null = null;
      const run = runChunked(buildLotTestSectionSteps(
        allDies, testDefs, undefined, perWaferSummaries, onSaveText,
        diesByWafer.map(d => ({ dies: d })), undefined, 'full',
      ), {
        onDone: section => {
          built = section;
          card.removeAttribute('aria-busy');
          if (section) card.replaceChildren(section);
          else card.remove();
        },
      });
      if (run.done) {
        if (built) testValuesCard = card;
      } else {
        const note = doc.createElement('div');
        note.textContent = 'Computing test statistics…';
        Object.assign(note.style, { color: CLR.label, fontSize: FONT.body } as Partial<CSSStyleDeclaration>);
        card.setAttribute('aria-busy', 'true');
        card.appendChild(note);
        testValuesCard = card;
        destroyFns.push(() => run.cancel());
      }
    }
    // Functional tests get their own pass-rate card — they are excluded from the
    // parametric test-values table above (mean/σ of a pass/fail outcome is
    // meaningless), not silently dropped from Insights.
    let functionalCard: HTMLElement | null = null;
    if (allTestDefs.length) {
      const functional = buildLotFunctionalSection(allDies, allTestDefs, perWaferSummaries, onSaveText);
      if (functional) { const c = plainCard(); c.appendChild(functional); functionalCard = c; }
    }
    if (testValuesCard) cards.push(testValuesCard);
    if (functionalCard) cards.push(functionalCard);
    return { cards, destroy: () => { for (const d of destroyFns) d(); } };
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
      const yieldPct = buildYieldData([{ ...item, key: item.waferIndex }])[0]?.percent;
      if (yieldPct !== undefined) card.appendChild(tile(`${yieldPct.toFixed(1)}%`, `Yield · pass: ${passBinsLabel}`));
      card.appendChild(tile(String(item.dies.length), 'Total dies'));
      return dropTrailingDivider(card) as HTMLDivElement;
    }

    card.appendChild(tile(String(items.length), 'Wafers'));

    const perWafer = buildYieldData(items.map(it => ({ ...it, key: it.waferIndex })))
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
        [{ key: 'all', items: items.map(it => ({ ...it, key: it.waferIndex })) }],
      )[0]?.percent;
      const differs = combined !== undefined && combined.toFixed(1) !== mean.toFixed(1);
      card.appendChild(tile(
        `${mean.toFixed(1)}%`,
        `${MEAN_WAFER_YIELD_LABEL} · pass: ${passBinsLabel}`,
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

    // What stands out, as charts: below the fixed cards, so those stay where a reader expects them on every lot.
    const worth = renderWorthALook(items, allTestDefs);
    if (worth) outer.appendChild(worth.el);

    // Which wafer field divides yield: a lot with fields to compare gets the ranking, and a row groups the tab by it.
    if (items.length >= 4 && dividingFields.length) {
      const commonality = renderCommonalityPanel({
        wafers: items, fields: dividingFields, curation, groupedBy: analysisGroupKey,
        onGroupBy: key => { analysisGroupKey = key; activeSectionGroup = null; render(); },
        ownerDocument: doc,
      });
      outer.appendChild(commonality.card);
    }

    // What part-average testing sets apart: a lot with tests that have both limits gets the per-wafer table.
    const pat = renderPatCard({ items: items.map(it => ({ ...it, ringCount: getRingCount() })), testDefs: allTestDefs, ownerDocument: doc, showMap: deps.showPatMap });
    if (pat) outer.appendChild(pat.card);

    outer.appendChild(dataTabLink());

    return { card: outer, destroy: () => { yieldBins.destroy(); details.destroy(); worth?.destroy(); } };
  }

  /**
   * Worth a look: the items "What stands out" lists beside the map (the results synthesis, one list for both), each
   * drawn as the chart that shows it, with the sentence that says why and Show on map, then the same "also" line. The
   * list describes the whole lot, so while the filter or Show narrows the population it says so instead of
   * drawing charts of a population the list was not made from. Null when there is no analysis to make it from.
   */
  function renderWorthALook(items: Item[], allTestDefs: TestDef[]): { el: HTMLElement; destroy: () => void } | null {
    const summary = getLotStats?.() ?? (items.length === 1 ? items[0].statsSummary : undefined);
    if (!summary) return null;
    const el = doc.createElement('section');
    el.dataset.wmapWorthALook = '1';
    Object.assign(el.style, { display: 'flex', flexDirection: 'column', gap: SPACE.md } as Partial<CSSStyleDeclaration>);
    const heading = doc.createElement('h3');
    heading.textContent = 'Worth a look';
    Object.assign(heading.style, { margin: '0', fontSize: FONT.heading, fontWeight: '600', color: CLR.value } as Partial<CSSStyleDeclaration>);
    el.appendChild(heading);
    const line = (text: string, hook?: string) => {
      const p = doc.createElement('p');
      p.textContent = text;
      if (hook) p.dataset[hook] = '1';
      Object.assign(p.style, { margin: '0', fontSize: FONT.body, color: CLR.label, lineHeight: LEADING.base } as Partial<CSSStyleDeclaration>);
      el.appendChild(p);
    };
    if (filtering || activeSectionGroup !== null) {
      line('Worth a look describes the whole lot, as What stands out beside the map does. Switch the filter off, or Show all groups, to see it here.', 'wmapWorthNarrowed');
      return { el, destroy: () => {} };
    }
    const synthesis = buildSynthesis(summary, { passBins: commonPassBins(items.map(it => it.passBins)), attributes: deps.attributes });
    if (synthesis.items.length === 0) {
      line(synthesis.nothing ?? 'Nothing stands out.', 'wmapWorthNothing');
      return { el, destroy: () => {} };
    }
    const grid = makeChartGridWrap(doc);
    el.appendChild(grid);
    const plotItems = toPlotItems(items.map(it => ({ label: it.identity ?? it.label, dies: it.dies, waferIndex: it.waferIndex, wafer: it.wafer, passBins: it.passBins, ringCount: getRingCount() })));
    const destroys: Array<() => void> = [];
    synthesis.items.forEach((item, i) => {
      // Why the card is here, in one sentence (the chart says the rest): a line of its own across the card, plain, not a
      // warning. The panel's whole sentence, with the bins and tests it names, is on hover.
      const why = doc.createElement('div');
      why.dataset.wmapWorthWhy = '1';
      why.textContent = `Shown because: ${item.reason}`;
      if (item.text !== item.reason) wireTooltip(why, item.text);
      Object.assign(why.style, { flexBasis: '100%', fontSize: FONT.body, color: CLR.text, lineHeight: LEADING.base } as Partial<CSSStyleDeclaration>);
      const extras: HTMLElement[] = [why];
      if (deps.showOnMap) {
        const btn = doc.createElement('button');
        btn.type = 'button';
        btn.textContent = 'Show on map';
        btn.dataset.wmapWorthShowOnMap = '1';
        Object.assign(btn.style, { ...controlStyle('outlined'), fontSize: FONT.body, padding: `0 ${SPACE.md}` } as Partial<CSSStyleDeclaration>);
        wireControlHover(btn);
        wireTooltip(btn, 'Leave Insights and show this on the map, as its row in What stands out does');
        btn.addEventListener('click', () => deps.showOnMap!(item.target));
        extras.push(btn);
      }
      const card = renderPlotCard({
        doc, items: plotItems, ctx: { testDefs: allTestDefs, curation },
        spec: { id: `worth-${i}`, ...item.chart } as CardSpec,
        extras, editAsPlot, chart: { onSaveImage },
      });
      card.card.dataset.wmapWorthKey = synthesisKey(item);
      grid.appendChild(card.card);
      destroys.push(card.destroy);
    });
    if (synthesis.also) {
      const named = synthesis.also.items.map(it => it.brief).join('; ');
      line(`Also: ${named}${synthesis.also.more ? `; and ${synthesis.also.more} more` : ''}. Their rows in What stands out show them on the map.`, 'wmapWorthAlso');
    }
    return { el, destroy: () => destroys.forEach(d => d()) };
  }

  /** The Overview's pointer to the tables that used to sit at its foot. */
  function dataTabLink(): HTMLElement {
    const row = doc.createElement('div');
    Object.assign(row.style, { fontSize: FONT.body, color: CLR.label } as Partial<CSSStyleDeclaration>);
    const btn = doc.createElement('button');
    btn.type = 'button';
    btn.textContent = 'Data tab';
    btn.dataset.wmapOpenDataTab = '1';
    Object.assign(btn.style, {
      border: 'none', background: 'none', padding: '0', cursor: 'pointer', font: 'inherit',
      color: CLR.iconActive, textDecoration: 'underline',
    } as Partial<CSSStyleDeclaration>);
    wireControlHover(btn, 'bare');
    btn.addEventListener('click', () => { activeView = 'data'; render({ keepSections: true }); });
    row.append('Test statistics, every die and every wafer as tables, with CSV export: see the ', btn, '.');
    return row;
  }

  /**
   * The Plot tab's section. Loaded on first use, like the drilldown's editor: the chart, the editor and the
   * file handling are not part of what opening Insights downloads, and most readers never open this tab.
   */
  function renderPlotBlock(
    items: Item[],
    allTestDefs: TestDef[],
    groupBy: string | undefined,
    groupLabel: string | undefined,
  ): { card: HTMLElement; destroy: () => void } {
    const host = doc.createElement('div');
    host.style.width = '100%';
    let inner: { destroy: () => void } | undefined;
    let gone = false;
    void import('./plotTab.js').then(({ createPlotSection }) => {
      if (gone) return;
      const section = createPlotSection({
        doc, store: plotStore, items, testDefs: allTestDefs, ringCount: getRingCount(), attributes: deps.attributes,
        groupBy, groupLabel, onSaveImage, onSaveText, getBinColors, waferMenu: waferContextMenu(items),
        openWafer: openWafer ? (wi, label, test) => openWafer(wi, label, test) : undefined,
        focusTest, locateDie, pickPlotsFile: deps.onPickPlotsFile,
      });
      host.appendChild(section.card);
      inner = section;
    });
    return { card: host, destroy: () => { gone = true; inner?.destroy(); } };
  }

  /** The Data tab's section for the current scope. Its table choice and the Dies layout
   *  are held above (`dataView`, `diesLayout`) so a rebuild keeps them. */
  function renderDataBlock(
    items: Item[],
    testDefs: TestDef[],
    allTestDefs: TestDef[],
    groups: { key: string; items: Item[] }[] | undefined,
    groupLabelText: string | undefined,
  ): { card: HTMLElement; destroy: () => void } {
    const lotStats = filtering ? undefined : getLotStats?.();
    const rebuild = () => {
      // Only this view's cached section is stale; the other tabs are unchanged.
      sectionCache.get('data')?.destroy();
      sectionCache.delete('data');
      render({ keepSections: true });
    };
    return renderDataSection({
      doc, items, testDefs, allTestDefs, groups, groupLabelText,
      ringCount: getRingCount(), attributes: deps.attributes,
      yieldByWaferIndex: new Map(lotStats?.lotYieldSeries.map(y => [y.waferIndex, y.yieldPercent])),
      onSaveText, onLocateDie: locateDie,
      onOpenWafer: openWafer ? (wi, label) => openWafer(wi, label) : undefined,
      // These are this tab's own items, handed back by the section.
      buildStatistics: its => buildStatisticsCards(its as Item[], testDefs, allTestDefs),
      view: dataView,
      onViewChange: v => { dataView = v; rebuild(); },
      diesLayout,
      // Remembered only: the Dies table switches its export layout in place, keeping its sort.
      onDiesLayoutChange: l => { diesLayout = l; },
    });
  }

  /** Capability + boxplot + histogram + trend together, sharing ONE selected
   *  test, ONE set of axis toggles, and — since the group desync fix — ONE
   *  group scope. Each panel still renders the scope in the way that suits it
   *  (capability narrows, boxplot drills, histogram emphasises), but they can
   *  no longer be describing different populations at the same time. */
  /** A heading across a tab's grid of cards, naming the block of cards under it. */
  function rowHeading(text: string, hook: string): HTMLElement {
    const el = doc.createElement('h3');
    el.textContent = text;
    el.dataset.wmapRowHeading = hook;
    Object.assign(el.style, { gridColumn: '1 / -1', margin: `${SPACE.md} 0 0`, color: CLR.value, fontSize: FONT.heading, fontWeight: '600' } as Partial<CSSStyleDeclaration>);
    return el;
  }

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

    // The plot cards of this section (plotCard.ts) share its test and its axis settings the way the panels do: each
    // has the test picker and the axis toggles, and a change in one reaches the rest (selectTestEverywhere,
    // broadcastAxisPrefs). `valueRole` is the axis the test's values run along, which the toggles are about.
    const plotItems = toPlotItems(items.map(it => ({ label: it.identity ?? it.label, dies: it.dies, waferIndex: it.waferIndex, wafer: it.wafer, passBins: it.passBins, ringCount: getRingCount() })));
    const sectionTests = testDefs.filter((d): d is TestDef & { testNumber: number } => d.testNumber !== undefined);
    const grouped = !!groups && !!analysisGroupKey;
    const narrowed = grouped && activeSectionGroup !== null;
    const plotCtx = { testDefs, groupBy: grouped ? analysisGroupKey : undefined, curation: deps.attributes };
    /** The settings of a value axis as a plot states them. */
    const axisSpec = (role: 'x' | 'y', p: AxisPrefs, log: boolean): Pick<CardSpec, 'limits' | 'axes'> => ({
      limits: p.limits ?? 'both',
      axes: { [role]: { ...(p.includeLimits !== undefined ? { includeLimits: p.includeLimits } : {}), ...(p.clipOutliers ? { clip: true } : {}), ...(log ? { scale: 'log' as const } : {}) } },
    });
    function distributionCard(o: {
      valueRole: 'x' | 'y';
      build: (p: AxisPrefs, log: boolean) => CardSpec;
      logToggle?: boolean;
      /** Controls of the card's own, after the shared ones (a wafer picker). */
      extras?: HTMLElement[];
      card?: Partial<Parameters<typeof renderPlotCard>[0]>;
      chart: Parameters<typeof renderPlotCard>[0]['chart'];
    }): { card: HTMLElement; setTest: (n: number) => void; setAxisPrefs: (p: AxisPrefs) => void; refresh: () => void; destroy: () => void } {
      let prefs = axisPrefs;
      let log = false;
      let handle: ReturnType<typeof renderPlotCard> | undefined;
      // The picker has already moved to the test the reader chose: draw it here, then the siblings follow.
      const testSel = makeLinkedTestSelect(sectionTests, activeSectionTest ?? sectionTests[0]?.testNumber ?? null, n => { handle?.refresh(); selectTestEverywhere(n); }, { ownerDocument: doc });
      const axisRow = doc.createElement('span');
      Object.assign(axisRow.style, { display: 'inline-flex', flexWrap: 'wrap', gap: SPACE.sm, alignItems: 'center' } as Partial<CSSStyleDeclaration>);
      const self = { setAxisPrefs: (p: AxisPrefs) => { if (axisCtl.set(p)) { prefs = p; handle?.refresh(); } } };
      const axisCtl = makeLinkedAxisPrefs(axisRow, prefs, p => { prefs = p; handle?.refresh(); broadcastAxisPrefs(p, self); }, doc);
      const extras: HTMLElement[] = [testSel.el, axisRow];
      if (o.logToggle) extras.push(makeToggle('Log scale', log, v => { log = v; handle?.refresh(); }, doc, 'Draw the value axis on a logarithmic scale'));
      extras.push(...(o.extras ?? []));
      handle = renderPlotCard({
        doc, editAsPlot, items: plotItems, ctx: plotCtx, ...o.card,
        spec: { choices: [], build: () => o.build(prefs, log) },
        slots: () => ({ test: testSel.get() ?? undefined }),
        extras,
        // The "Axis includes limits" toggle shows what the axis does now, the automatic choice included.
        onResolved: r => {
          const def = testDefs.find(d => d.testNumber === testSel.get());
          const lines = limitLines(def, prefs.limits);
          const values = axisValues(r, o.valueRole);
          const { lo, hi } = limitExtent(lines);
          const auto = values.length > 0 && lines.length > 0 && shouldIncludeLimitsByDefault(minOf(values), maxOf(values), lo, hi);
          axisCtl.sync(prefs.includeLimits ?? auto, limitLines(def).length > 0, hasBothLimitKinds(def));
        },
        chart: o.chart,
      });
      const h = handle;
      return {
        card: h.card,
        setTest: n => { if (testSel.set(n)) h.refresh(); },
      refresh: () => h.refresh(),
        setAxisPrefs: self.setAxisPrefs,
        destroy: () => h.destroy(),
      };
    }
    const openOnTest = leafAction ? (i: number, testNumber?: number) => leafAction.open(plotItems[i]?.waferIndex ?? i, testNumber ?? activeSectionTest ?? sectionTests[0]?.testNumber ?? 0) : undefined;

    // Test value distribution: a box per wafer, or with Group by on one pooled box per group, whose click narrows the
    // section to that group (its wafers' boxes, and Back).
    const boxplot = distributionCard({
      valueRole: 'y', logToggle: true,
      build: (p, log) => ({
        id: 'card-box', title: 'Test value distribution', chart: 'box', orientation: 'horizontal',
        fields: { x: grouped && !narrowed ? { slot: 'groupBy' } : { builtin: 'wafer' }, y: { slot: 'test' }, color: { none: true } },
        ...(narrowed ? { where: { conditions: [{ field: { meta: analysisGroupKey! }, values: [activeSectionGroup!] }] } } : {}),
        ...axisSpec('y', p, log),
      }),
      card: {
        ...(grouped && !narrowed ? {
          drill: (points: readonly PlotPoint[]) => {
            const v = facetValueOf(plotItems[points[0]?.item]?.metadata, analysisGroupKey!, deps.attributes);
            if (v !== undefined) selectGroupEverywhere(v);
            return null;
          },
          drillLabel: `see its wafers`,
        } : {}),
        // A group in force (picked here or under Show) arrives as its own wafers: Back widens to every group again.
        ...(activeSectionGroup !== null ? { externalBack: { shown: () => activeSectionGroup !== null, onBack: () => selectGroupEverywhere(null) } } : {}),
      },
      chart: { onSaveImage, onOpenWafer: openOnTest, openActionLabel: leafAction?.label, onWaferMenu: waferContextMenu(items) },
    });
    // Value histogram: the whole population, one wafer of it (the picker, ungrouped), or one overlaid series per group.
    // A bar is a range of the test's values: click it for the dies in it.
    let histWafer: number | null = null;
    const histExtras = grouped ? [] : [makeWaferSelect(plotItems.map(it => ({ label: it.label })), null, i => { histWafer = i; histogram.refresh(); }, { ownerDocument: doc })];
    const histogram = distributionCard({
      valueRole: 'x', extras: histExtras,
      // Narrowed to a group (from its legend, the box plot or Show): Back shows every group again, as on the box plot.
      card: activeSectionGroup !== null ? { externalBack: { shown: () => activeSectionGroup !== null, onBack: () => selectGroupEverywhere(null) } } : {},
      build: p => ({
        id: 'card-histogram', title: 'Value histogram', chart: 'histogram',
        fields: { y: { slot: 'test' }, color: grouped ? { follow: 'groupBy' } : { none: true } },
        ...(histWafer !== null ? { where: { conditions: [{ field: { builtin: 'wafer' }, values: [plotItems[histWafer].label] }] } } : {}),
        ...axisSpec('x', p, false),
      }),
      chart: {
        onSaveImage,
        // A group clicked in the legend narrows the whole section to it, as Show does.
        ...(grouped ? { onLegendPick: (key: string | null) => selectGroupEverywhere(key), legendPicked: activeSectionGroup } : {}),
        onSelectPoints: (points, at, anchor, info) => {
          const def = testDefs.find(d => d.testNumber === (activeSectionTest ?? sectionTests[0]?.testNumber));
          const picked = new Set(points.map(pt => pt.die).filter((d): d is Die => !!d));
          const whose = new Set(points.map(pt => plotItems[pt.item]?.waferIndex));
          const range = info?.range;
          const what = def && range
            ? `with ${testLabel(def, def.testNumber)} from ${fmt(range.lo, def.unit, 'engineering')} to ${fmt(range.hi, def.unit, 'engineering')}${info?.group ? ` in ${info.group}` : ''}`
            : 'selected in the histogram';
          openDiesMenuAt(at, anchor, items.filter(it => whose.has(it.waferIndex)), what, d => picked.has(d), def?.testNumber);
        },
      },
    });
    // Wafer-to-wafer trend joins the cross-panel test link below, so picking a
    // test in capability drives boxplot, histogram AND this — all four then answer
    // the same question about the same test, rather than each starting from
    // testDefs[0].
    //
    // Deliberately NOT group-aware like its siblings: this chart's x axis is the
    // population's own slot order, and restricting or splitting by group would
    // break the sequence that is the entire signal. It always shows every wafer.
    // Wafer-to-wafer trend: each wafer's mean of the test, in the population's own order, with ± one standard deviation
    // and the mean of the wafers as the centre line. Deliberately never divided by group: the order is the signal.
    // A point is one wafer: click it to open that wafer.
    const trend = distributionCard({
      valueRole: 'y',
      build: p => ({
        id: 'card-trend', title: 'Wafer-to-wafer trend', chart: 'line', aggregate: 'mean', spread: 'sd',
        fields: { x: { builtin: 'waferOrder' }, y: { slot: 'test' }, color: { none: true } },
        ...axisSpec('y', p, false),
        axes: { ...axisSpec('y', p, false).axes, y: { ...axisSpec('y', p, false).axes!.y, references: [{ stat: 'mean', label: populationStat(describeWaferPopulation(items.map(it => it.wafer.metadata)), 'mean') }] } },
      }),
      card: { ctx: { ...plotCtx, groupBy: undefined }, ...(items.length < 2 ? { unavailable: 'A trend needs at least two wafers' } : {}) },
      chart: {
        onSaveImage,
        onWaferMenu: waferContextMenu(items),
        selectActionLabel: openOnTest ? 'open that wafer' : 'chart or tabulate its dies',
        selectRangeLabel: 'wafers',
        onSelectPoints: (points, at, anchor) => {
          const wafers = new Set(points.map(pt => pt.item));
          if (wafers.size === 1 && openOnTest) { openOnTest([...wafers][0]); return; }
          const picked = new Set(points.map(pt => pt.die).filter((d): d is Die => !!d));
          const whose = new Set(points.map(pt => plotItems[pt.item]?.waferIndex));
          openDiesMenuAt(at, anchor, items.filter(it => whose.has(it.waferIndex)), 'selected in the trend', d => picked.has(d), activeSectionTest ?? undefined);
        },
      },
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
      compare?.setTest(testNumber);
      difference?.setTest(testNumber);
    };

    // With Group by on, the comparison of every test across the groups, wafer by wafer: first, since it says which
    // test to look at in the panels below. Choosing a control rebuilds only this panel.
    const makeCompare = () => renderGroupComparisonPanel({
      groups: groups!, testDefs, groupLabelText, control: compareControl,
      onControlChange: (c) => {
        compareControl = c;
        const next = makeCompare();
        compare!.card.replaceWith(next.card);
        compare = next;
      },
      selectedTestNumber: activeSectionTest ?? undefined,
      onSelectTest: (n) => selectTestEverywhere(n),
      onSaveText,
      ownerDocument: doc,
    });
    let compare = groups && groups.length >= 2 ? makeCompare() : undefined;
    // With Group by on, one group minus another at each die position, as a map.
    const difference = groups && groups.length >= 2
      ? renderDifferenceMapPanel({ groups, testDefs, groupLabelText, selectedTestNumber: activeSectionTest ?? undefined, onSaveImage, ownerDocument: doc })
      : undefined;

    axisPrefsPanels.set('distribution', [boxplot, histogram, trend]);

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
    // With Group by on, the cards that compare the groups come first, together, under their own heading, so they are not
    // lost among the cards about each test.
    if (compare || difference) {
      wrap.append(rowHeading(`Comparing ${groupLabelText ?? 'groups'}`, 'comparing'));
      if (compare) wrap.append(compare.card);
      if (difference) wrap.append(difference.card);
      wrap.append(rowHeading('Test by test', 'tests'));
    }
    wrap.append(capability.card, boxplot.card, histogram.card, trend.card);

    return {
      card: wrap,
      destroy: () => {
        capability.destroy(); boxplot.destroy(); histogram.destroy(); trend.destroy(); compare?.destroy(); difference?.destroy();
      },
    };
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

    // Test scatter as a plot (plotCard.ts): two tests die by die, coloured by hard bin in the map's colours or, with Group
    // by on, by group; a matrix cell sets its pair. Ungrouped, the wafer picker narrows it to one wafer. The plot states
    // r and n, and warns when the points pool several splits or lots.
    const leaf = testLeafAction(items);
    const plotItems = toPlotItems(items.map(it => ({ label: it.identity ?? it.label, dies: it.dies, waferIndex: it.waferIndex, wafer: it.wafer, passBins: it.passBins, ringCount: getRingCount() })));
    const scTests = testDefs.filter((d): d is TestDef & { testNumber: number } => d.testNumber !== undefined && isParametricTest(d));
    let sx = scTests[0]?.testNumber, sy = scTests[1]?.testNumber ?? sx;
    let scWafer: number | null = null;
    let scPrefs: AxisPrefs = axisPrefs;
    const grouped = !!groups && !!analysisGroupKey;
    const labelled = (text: string, el: HTMLElement): HTMLElement => {
      const wrap = doc.createElement('label');
      Object.assign(wrap.style, { display: 'inline-flex', alignItems: 'center', gap: SPACE.xs, fontSize: FONT.body, color: CLR.label } as Partial<CSSStyleDeclaration>);
      const t = doc.createElement('span'); t.textContent = text;
      wrap.append(t, el);
      return wrap;
    };
    const xSel = makeTestSelect(scTests, sx ?? null, n => { sx = n; syncLimits(); scatterCard.refresh(); }, { maxWidth: '180px', emptyText: 'No tests', ownerDocument: doc });
    const ySel = makeTestSelect(scTests, sy ?? null, n => { sy = n; syncLimits(); scatterCard.refresh(); }, { maxWidth: '180px', emptyText: 'No tests', ownerDocument: doc });
    // The "Limits:" choice, offered while either test has both test and spec limits; shared with the section's other cards.
    const limitsSlot = doc.createElement('span');
    const scatter = {
      setXY: (x: number, y: number) => { sx = x; sy = y; xSel.value = String(x); ySel.value = String(y); syncLimits(); scatterCard.refresh(); },
      setAxisPrefs: (p: AxisPrefs) => { scPrefs = p; syncLimits(); scatterCard.refresh(); },
      destroy: () => scatterCard.destroy(),
    };
    function syncLimits(): void {
      const defs = [sx, sy].map(n => testDefs.find(d => d.testNumber === n));
      limitsSlot.replaceChildren(...(defs.some(hasBothLimitKinds) ? [makeLimitsSelect(scPrefs.limits ?? 'both', v => {
        scPrefs = { ...scPrefs, limits: v };
        scatterCard.refresh();
        broadcastAxisPrefs(scPrefs, scatter);
      }, doc)] : []));
    }
    const named = (n: number | undefined) => { const d = testDefs.find(t => t.testNumber === n); return d?.name ? { test: n ?? 0, name: d.name } : { test: n ?? 0 }; };
    const scExtras: HTMLElement[] = [labelled('X:', xSel), labelled('Y:', ySel), limitsSlot];
    if (!grouped && items.length > 1) scExtras.push(makeWaferSelect(plotItems.map(it => ({ label: it.label })), null, i => { scWafer = i; scatterCard.refresh(); }, { ownerDocument: doc }));
    const scatterCard = renderPlotCard({
      doc, editAsPlot, items: plotItems, ctx: { testDefs, groupBy: grouped ? analysisGroupKey : undefined, curation: deps.attributes },
      extras: scExtras,
      spec: { choices: [], build: () => ({
        id: 'card-scatter', title: 'Test scatter', chart: 'scatter', limits: scPrefs.limits ?? 'both',
        fields: { x: named(sx), y: named(sy), color: grouped ? { follow: 'groupBy' } : { builtin: 'hbin' } },
        ...(scWafer !== null ? { where: { conditions: [{ field: { builtin: 'wafer' }, values: [plotItems[scWafer].label] }] } } : {}),
      }) },
      ...(sx === undefined ? { unavailable: 'No parametric test has values to plot' } : {}),
      chart: {
        onSaveImage, binColors: getBinColors(),
        // A point is a die: click opens its wafer on the X test, as the box plot and trend do.
        onOpenWafer: leaf ? (i, tn) => leaf.open(plotItems[i]?.waferIndex ?? i, tn ?? sx ?? 0) : undefined,
        openActionLabel: leaf?.label,
        // The dragged-out dies, per wafer, as a drilldown population: charts and tables of just these.
        onSelectPoints: (pts, at, anchor) => {
          const byWafer = new Map<number, Die[]>();
          for (const p of pts) {
            const waferIndex = plotItems[p.item]?.waferIndex;
            if (waferIndex === undefined || !p.die) continue;
            const list = byWafer.get(waferIndex);
            if (list) list.push(p.die); else byWafer.set(waferIndex, [p.die]);
          }
          const picked = [...byWafer].flatMap(([waferIndex, dies]) => {
            const it = items.find(i => i.waferIndex === waferIndex);
            return it ? [{ label: it.identity ?? it.label, dies, waferIndex, wafer: it.wafer, passBins: it.passBins, ringCount: getRingCount() }] : [];
          });
          if (picked.length === 0) return;
          const population = picked.length === 1
            ? `selected on ${picked[0].label} in the scatter`
            : `selected in the scatter, across ${picked.length} wafers`;
          openDrilldownMenu(at, anchor, { items: picked, population, testDefs, activeTest: sx },
            { plots: plotStore, getBinColors, onSaveImage, onSaveText, onLocateDie: locateDie });
        },
      },
    });
    syncLimits();
    axisPrefsPanels.set('correlation', [scatter]);
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
    wrap.append(correlation.card, scatterCard.card);

    return { card: wrap, destroy: () => { correlation.destroy(); scatter.destroy(); } };
  }

  const bandButton = (text: string, hook: string, hint: string, onClick: () => void): HTMLButtonElement => makeBandButton(doc, text, hook, hint, onClick);
  const openFilterModal = (): void => pageFilter.openEditor(rootEl, facetItems());

  function render(opts?: { keepSections?: boolean }): void {
    if (!opts?.keepSections) dropSectionCache();
    // Clearing bodyEl detaches the cached cards without destroying them — the
    // elements, their listeners and their canvas contents all survive, so
    // re-appending shows the panel exactly as the user left it.
    bodyEl.innerHTML = '';
    tabBar.innerHTML = '';

    for (const v of views) tabBar.appendChild(makeTabButton(v.key, v.label));

    const loadedItems = facetItems();
    const filtered = pageFilter.keep(loadedItems);
    const allItems = filtered.items;
    filtering = filtered.narrowing;
    filterBand.refresh(filtered.result, loadedItems);
    renderMetadataStrip(allItems);
    const facetTable = buildFacetTable(allItems, { facetableOnly: true, curation }).filter(f => f.splittable);
    dividingFields = facetTable.map(f => ({ key: f.key, label: f.label }));

    const controlsRow = doc.createElement('div');
    // Rides on the tab bar's row, right-aligned: it is the only control here and
    // the row is mostly empty, so giving it a band of its own cost a full row of
    // vertical space above every chart for one dropdown.
    Object.assign(controlsRow.style, {
      display: 'flex', gap: SPACE.md, alignItems: 'center',
      marginLeft: SPACE.xxl, paddingBottom: SPACE.xs,
    } as Partial<CSSStyleDeclaration>);
    if (deps.showFilterButton !== false) {
      controlsRow.appendChild(bandButton('Filter…', 'wmapInsightsFilterOpen',
        'Show only the wafers and dies that meet conditions you set, on the maps, the gallery and every Insights tab', () => openFilterModal()));
    }
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
        const key = facetValueOf(it.metadata, analysisGroupKey, curation) ?? FACET_NONE_VALUE;
        if (!byKey.has(key)) { byKey.set(key, []); order.push(key); }
        byKey.get(key)!.push(it);
      }
      // Listed in the order plots use for a field's values, so a group has one colour on every card, plot or not.
      groups = orderFieldValues(order).map(key => ({ key, items: byKey.get(key)! }));
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

    // Columns of cards, beside Group by and Show; the keys 1 to 5 and 0 do the same.
    const columnsLabel = makeLabeledSelect(
      'Columns:',
      [{ value: 'auto', label: 'Auto (0)' }, ...[1, 2, 3, 4, 5].map(n => ({ value: String(n), label: `${n} (${n})` }))],
      columnsPref === undefined ? 'auto' : String(columnsPref),
      v => setColumns(v === 'auto' ? undefined : Number(v)),
      { hook: 'insights-columns', maxWidth: '90px', ownerDocument: doc },
    );
    columnsSelect = columnsLabel.querySelector('button') as (HTMLElement & { value: string }) | null;
    controlsRow.appendChild(columnsLabel);

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

    if (allItems.length === 0) {
      // The filter kept nothing: say so where the charts would be, rather than draw every chart empty.
      const none = doc.createElement('div');
      none.dataset.wmapInsightsFilterEmpty = '1';
      none.textContent = 'The filter keeps no wafer and no die. Edit the filter or switch it off to see the data.';
      Object.assign(none.style, { color: CLR.label, fontSize: FONT.body, padding: SPACE.xl } as Partial<CSSStyleDeclaration>);
      bodyEl.appendChild(none);
      return;
    }
    const cached = opts?.keepSections ? sectionCache.get(activeView) : undefined;
    const section = cached ?? (
      activeView === 'overview'      ? renderOverviewSection(scopeItems, scopedTestDefs, scopedAllDefs, scopeGroups, groupLabelText) :
      activeView === 'distributions' ? renderDistributionsSection(scopeItems, scopedTestDefs, scopeGroups, groupLabelText) :
      activeView === 'data'          ? renderDataBlock(scopeItems, scopedTestDefs, scopedAllDefs, scopeGroups, groupLabelText) :
      activeView === 'plot'          ? renderPlotBlock(scopeItems, scopedAllDefs,
        // The Group by in force: a narrowed scope has collapsed it, so plots follow nothing then.
        scoped_ ? undefined : analysisGroupKey, scoped_ ? undefined : groupLabelText) :
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
      doc.removeEventListener('keydown', onColumnsKey);
      dropSectionCache();
      plotStore.flush();
      rootEl.remove();
    },
    setAxisPrefs: (prefs) => broadcastAxisPrefs(prefs, null, true),
    showWorthCard: (key) => {
      if (activeView !== 'overview') { activeView = 'overview'; render({ keepSections: true }); }
      const card = [...bodyEl.querySelectorAll<HTMLElement>('[data-wmap-worth-key]')].find(c => c.dataset.wmapWorthKey === key);
      if (!card) return false;
      // After the frames in which opening Insights restores its own scroll position, which would otherwise undo this.
      const view = doc.defaultView;
      const reveal = () => card.scrollIntoView({ block: 'center' });
      if (view?.requestAnimationFrame) view.requestAnimationFrame(() => view.requestAnimationFrame(reveal)); else reveal();
      // A short outline says which card the link meant, then goes.
      card.style.outline = `2px solid ${CLR.iconActive}`;
      card.style.outlineOffset = '2px';
      setTimeout(() => { card.style.outline = ''; card.style.outlineOffset = ''; }, 1600);
      return true;
    },
  };
}
