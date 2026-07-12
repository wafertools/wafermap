// Shared Analysis tab — the full chart suite (yield/bins, distributions,
// correlation), extracted from `renderWaferGallery.ts` so both it and
// `renderWaferMap.ts` (single-wafer) can mount the same tab instead of
// duplicating ~300 lines of panel-wiring per host. Takes over the full
// content area when open — swaps out the grid/canvas rather than sitting
// alongside it, since the chart suite wants the room.
//
// Grouping ("Group by") naturally disappears for a single-wafer host: with
// one item, `buildFacetTable` never finds a splittable field (every value
// is unique-per-item by definition), so the control just doesn't render —
// no special-casing needed here for single- vs multi-wafer hosts.

import type { Die } from '../core/dies.js';
import type { LotStatsSummary } from '../stats/types.js';
import { buildFacetTable, facetValueOf, FACET_NONE_VALUE, type FacetItem } from '../stats/facets.js';
import type { TestDef } from '../renderer/buildWaferMap.js';
import type { WaferMapDisplayItem } from './renderWaferGallery.js';
import { getColorScheme } from '../renderer/colorSchemes.js';
import { type SaveImageHandler } from './toolbar.js';
import { renderCapabilityPanel } from './charts/capability.js';
import { renderBoxplotPanel } from './charts/boxplot.js';
import { renderHistogramPanel } from './charts/histogram.js';
import { renderCorrelationPanel } from './charts/correlation.js';
import { renderScatterPanel } from './charts/scatter.js';
import { renderBarPanel, type ChartPanel } from './charts/barPanel.js';
import { renderBinClusterPanel } from './charts/binCluster.js';
import { makeChartGridWrap, makeLabeledSelect } from './charts/chartShell.js';
import { buildYieldData, buildYieldDataCombined, type YieldSortBy } from '../stats/yield.js';
import { buildBinParetoData, type BinType } from '../stats/binPareto.js';

export interface AnalysisTabDeps {
  /** Current gallery/single-wafer items — read fresh each render (a gallery's list can still be building). `null` entries (not-yet-built cards) are skipped. */
  getItems: () => Array<WaferMapDisplayItem | null>;
  /** Precomputed lot-level yield, when the host has one — reused directly instead of recomputing (see stats/yield.ts). Omit when there is no lot (e.g. a single wafer). */
  getLotStats?: () => LotStatsSummary | undefined;
  /** Read fresh each render so a live colour-scheme change is picked up. */
  getColorSchemeName: () => string;
  passBins: number[];
  onSaveImage?: SaveImageHandler;
  /**
   * Opens one wafer's detail view — omit to disable click-to-open (e.g. a
   * single-wafer host, where the only wafer is already the one on screen).
   * `testNumber`, when given (boxplot leaf-row clicks), asks the host to
   * open the map in test-value mode on that test rather than its default
   * plot mode — so opening from a specific test's boxplot row lands on that
   * same test instead of hard-bin mode.
   */
  openWafer?: (waferIndex: number, label: string, testNumber?: number) => void;
}

export interface AnalysisTabHandle {
  /** Append this wherever the tab's content should live; starts hidden (`display: none`). */
  el: HTMLElement;
  /** (Re)builds the tab's content from the current items — call whenever the tab is opened. */
  render: () => void;
  /** Tears down every live panel's observers and removes `el`. */
  destroy: () => void;
}

type Item = FacetItem & { dies: Die[]; label: string; waferIndex: number };

export function createAnalysisTab(deps: AnalysisTabDeps): AnalysisTabHandle {
  const { getItems, getLotStats, getColorSchemeName, passBins, onSaveImage, openWafer } = deps;

  const analysisEl = document.createElement('div');
  Object.assign(analysisEl.style, {
    display: 'none',
    flexDirection: 'column',
    gap: '10px',
    width: '100%',
    minHeight: '400px',
    flex: '1 1 0',
    overflowY: 'auto',
  } as Partial<CSSStyleDeclaration>);

  let analysisGroupKey: string | undefined;
  let analysisPanelHandles: Array<{ destroy: () => void }> = [];

  function openWaferDetailModal(waferIndex: number, title: string, testNumber?: number): void {
    openWafer?.(waferIndex, title, testNumber);
  }

  function analysisFacetItems(): Item[] {
    // Map before filtering so `waferIndex` stays the same index a host's
    // `lotYieldSeries` was computed against (filtering-then-mapping would
    // shift indices whenever any item is still null/not-yet-built).
    return getItems()
      .map((it, waferIndex): Item | null => it == null ? null : {
        metadata: it.wafer.metadata ?? undefined, dies: it.dies,
        label: it.label ?? String(it.wafer.metadata?.waferId ?? ''), waferIndex,
      })
      .filter((it): it is Item => it != null);
  }

  /** Yield + bin pareto together. Yield always uses the generic bar panel
   *  (`barPanel.ts`), grouped or not — pooled-per-group bars with in-place
   *  drill-down when grouped, matching boxplot's pattern (verified from
   *  tsmap's `main.ts`: yield's `ChartPanel.drill` is the same contract).
   *  Bin pareto is different: grouped mode swaps in an entirely separate
   *  clustered-bar panel (`binCluster.ts`) rather than a variant of the
   *  plain pareto — matching tsmap's actual behavior (`main.ts:871-882`),
   *  not assumed. */
  function renderYieldBinsSection(
    items: Item[],
    groups: { key: string; items: Item[] }[] | undefined,
    groupLabelText: string | undefined,
  ): { card: HTMLElement; destroy: () => void } {
    const wrap = makeChartGridWrap();

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
      barColor: datum => scheme.forValue(Math.max(0, Math.min(100, datum.percent)) / 100),
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
    };
    const yieldPanel = renderBarPanel(yieldPanelConfig, onSaveImage);
    yieldPanel.card.style.minHeight = '360px';
    wrap.appendChild(yieldPanel.card);

    if (groups) {
      const binCluster = renderBinClusterPanel({
        title: 'Hard bin pareto',
        groups,
        colorScheme: getColorSchemeName(),
        onSaveImage,
      });
      binCluster.card.style.minHeight = '360px';
      wrap.appendChild(binCluster.card);
      return { card: wrap, destroy: () => { yieldPanel.destroy(); binCluster.destroy(); } };
    }

    let binType: BinType = 'hbin';
    const binColorFn = scheme.forBin;
    const makeBinData = () => buildBinParetoData(items, binType);
    const binPanelConfig: ChartPanel = {
      title: 'Hard bin pareto',
      data: makeBinData(),
      selfControl: {
        current: binType,
        options: [['hbin', 'Hard bins'], ['sbin', 'Soft bins']],
        onChange: v => { binType = v as BinType; return { data: makeBinData(), title: `${binType === 'hbin' ? 'Hard' : 'Soft'} bin pareto` }; },
      },
      barColor: datum => datum.binCode === undefined ? scheme.forValue(0) : binColorFn(datum.binCode),
    };
    const binPanel = renderBarPanel(binPanelConfig, onSaveImage);
    binPanel.card.style.minHeight = '360px';
    wrap.appendChild(binPanel.card);
    return { card: wrap, destroy: () => { yieldPanel.destroy(); binPanel.destroy(); } };
  }

  /** Capability + boxplot + histogram together, wired so clicking a
   *  capability box drives both the boxplot's and histogram's selected test
   *  in place — mirrors tsmap's `selectTestEverywhere` (`main.ts`). Rendered
   *  exactly once regardless of grouping: each panel owns its own
   *  group-consuming UI (capability: a "Group:" restrict-to-one-group
   *  dropdown; boxplot: pooled-per-group overview rows with in-place
   *  drill-down; histogram: an overlaid multi-series view with a
   *  click-to-emphasize legend) — matching tsmap's actual per-panel design
   *  (verified by reading `src/charts/capability.ts`/`boxplot.ts`/
   *  `histogram.ts`, not assumed). */
  function renderDistributionsSection(
    items: Item[],
    testDefs: TestDef[],
    groups: { key: string; items: Item[] }[] | undefined,
    groupLabelText: string | undefined,
  ): { card: HTMLElement; destroy: () => void } {
    const wrap = makeChartGridWrap();

    const boxplot = renderBoxplotPanel({
      title: 'Test value distribution',
      items, testDefs, groups, groupLabelText, colorScheme: getColorSchemeName(), onSaveImage,
      onOpen: openWafer ? (waferIndex, testNumber) => openWaferDetailModal(waferIndex, `Wafer ${items.find(it => it.waferIndex === waferIndex)?.label ?? waferIndex}`, testNumber) : undefined,
    });
    const histogram = renderHistogramPanel({
      title: 'Value histogram',
      items, testDefs, groups, colorScheme: getColorSchemeName(), onSaveImage,
    });
    const capability = renderCapabilityPanel({
      title: 'Process capability',
      items, testDefs, groups, colorScheme: getColorSchemeName(), onSaveImage,
      onSelectTest: (testNumber) => { boxplot.setTest(testNumber); histogram.setTest(testNumber); },
    });
    // No manual card.style.minHeight here — capability/histogram grow their
    // own card via ensureCardFits (chartShell.ts) once they have real
    // content to draw, measured from their own live chrome overhead rather
    // than a guessed constant. Capability's empty state (no test has both
    // spec limits — common in real-world data, not a bug) never calls that,
    // so it stays sized to its compact message instead of forcing a large
    // dead box next to perfectly functional sibling panels.
    wrap.append(capability.card, boxplot.card, histogram.card);

    return { card: wrap, destroy: () => { capability.destroy(); boxplot.destroy(); histogram.destroy(); } };
  }

  /** Correlation matrix + scatter together, wired so clicking a matrix cell
   *  drives the scatter panel's X/Y in place — mirrors tsmap's
   *  `onSelectPair → scatterResult.setXY` link (`main.ts`). Correlation
   *  restricts to one group at a time via its own "Group:" dropdown
   *  (matching capability's pattern); scatter never restricts — it colours
   *  every group's points together with a click-to-filter legend (matching
   *  tsmap's actual, verified-by-reading-source behavior). */
  function renderCorrelationSection(
    items: Item[],
    testDefs: TestDef[],
    groups: { key: string; items: Item[] }[] | undefined,
  ): { card: HTMLElement; destroy: () => void } {
    const wrap = makeChartGridWrap();

    const scatter = renderScatterPanel({
      title: 'Test scatter',
      items, testDefs, groups, colorScheme: getColorSchemeName(), onSaveImage,
    });
    const correlation = renderCorrelationPanel({
      title: 'Test correlation matrix',
      items, testDefs, groups, colorScheme: getColorSchemeName(), onSaveImage,
      onSelectPair: (x, y) => scatter.setXY(x, y),
    });
    // No manual card.style.minHeight here — scatter grows its own card via
    // ensureCardFits (chartShell.ts); correlation sizes compactly to its
    // matrix and stretches to match scatter's row height via the grid's
    // default align-items: stretch, same as any other CSS Grid row.
    wrap.append(correlation.card, scatter.card);

    return { card: wrap, destroy: () => { correlation.destroy(); scatter.destroy(); } };
  }

  function render(): void {
    for (const h of analysisPanelHandles) h.destroy();
    analysisPanelHandles = [];
    analysisEl.innerHTML = '';

    const allItems = analysisFacetItems();
    const facetTable = buildFacetTable(allItems, { facetableOnly: true }).filter(f => f.splittable);

    const controlsRow = document.createElement('div');
    Object.assign(controlsRow.style, { display: 'flex', gap: '8px', alignItems: 'center' } as Partial<CSSStyleDeclaration>);
    let groupLabelText: string | undefined;
    if (facetTable.length > 0) {
      controlsRow.appendChild(makeLabeledSelect(
        'Group by:',
        [{ value: '', label: 'None' }, ...facetTable.map(f => ({ value: f.key, label: `${f.label} (${f.values.length})` }))],
        analysisGroupKey ?? '',
        v => { analysisGroupKey = v || undefined; render(); },
      ));
      groupLabelText = facetTable.find(f => f.key === analysisGroupKey)?.label;
    } else {
      analysisGroupKey = undefined;
    }
    analysisEl.appendChild(controlsRow);

    const testDefs = getItems().find(it => it?.testDefs?.length)?.testDefs ?? [];
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

    const yieldBins = renderYieldBinsSection(allItems, groups, groupLabelText);
    analysisPanelHandles.push(yieldBins);
    analysisEl.appendChild(yieldBins.card);

    const distributions = renderDistributionsSection(allItems, testDefs, groups, groupLabelText);
    analysisPanelHandles.push(distributions);
    analysisEl.appendChild(distributions.card);

    const correlation = renderCorrelationSection(allItems, testDefs, groups);
    analysisPanelHandles.push(correlation);
    analysisEl.appendChild(correlation.card);
  }

  return {
    el: analysisEl,
    render,
    destroy: () => {
      for (const h of analysisPanelHandles) h.destroy();
      analysisEl.remove();
    },
  };
}
