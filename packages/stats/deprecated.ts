// Exports deprecated in 0.30.0 and removed in 0.31.0 — TODO.md lists the removal.
//
// They live here, re-exported by index.ts, rather than in index.ts itself, so the
// declaration carrying each `@deprecated` tag is its own module: an editor strikes
// the name through wherever a host imports it from, and scripts/check-clones.mjs
// can skip this file. A column of deliberately uniform wrapper lines is repetition
// by design, not a clone to extract. Nothing in the library imports from here.

// ── Deprecated: the chart-data builders ─────────────────────────────────────
// They were public so a host could draw the Insights charts itself; the Insights
// tab now draws them, and the library imports each defining module directly, so
// only a host's call raises the notice (see ../renderer/deprecate.ts). Their types
// stay exported from index.ts until the functions are removed.
import { deprecated } from '../renderer/deprecate.js';
import { buildCapabilityData as buildCapabilityDataImpl } from './capability.js';
import { buildCorrelationMatrix as buildCorrelationMatrixImpl, filterCorrelationMatrix as filterCorrelationMatrixImpl } from './correlation.js';
import { buildTestBoxplotData as buildTestBoxplotDataImpl } from './boxplot.js';
import { buildTestTrendData as buildTestTrendDataImpl, trendCentre as trendCentreImpl } from './trend.js';
import { buildTestPassRateData as buildTestPassRateDataImpl, hasJudgeableTests as hasJudgeableTestsImpl } from './testPassRate.js';
import { buildTestHistogramData as buildTestHistogramDataImpl, buildTestHistogramSeries as buildTestHistogramSeriesImpl } from './histogram.js';
import { buildScatterData as buildScatterDataImpl, buildScatterDataGrouped as buildScatterDataGroupedImpl } from './scatter.js';
import { buildYieldData as buildYieldDataImpl, buildYieldDataCombined as buildYieldDataCombinedImpl } from './yield.js';
import { buildBinParetoData as buildBinParetoDataImpl, buildBinClusterData as buildBinClusterDataImpl } from './binPareto.js';

const CHART_DATA_ADVICE = 'It prepared data for the Insights charts, which wmap now draws itself '
  + '(insights: { enabled: true }). If you depend on it, say so at https://github.com/wafertools/wafermap/issues.';

/** @deprecated Removed in 0.31.0. Prepared data for the Insights charts, which wmap now draws itself (`insights: { enabled: true }`). */
export const buildCapabilityData = deprecated(buildCapabilityDataImpl, 'buildCapabilityData', CHART_DATA_ADVICE);
/** @deprecated Removed in 0.31.0. Prepared data for the Insights charts, which wmap now draws itself (`insights: { enabled: true }`). */
export const buildCorrelationMatrix = deprecated(buildCorrelationMatrixImpl, 'buildCorrelationMatrix', CHART_DATA_ADVICE);
/** @deprecated Removed in 0.31.0. Prepared data for the Insights charts, which wmap now draws itself (`insights: { enabled: true }`). */
export const filterCorrelationMatrix = deprecated(filterCorrelationMatrixImpl, 'filterCorrelationMatrix', CHART_DATA_ADVICE);
/** @deprecated Removed in 0.31.0. Prepared data for the Insights charts, which wmap now draws itself (`insights: { enabled: true }`). */
export const buildTestBoxplotData = deprecated(buildTestBoxplotDataImpl, 'buildTestBoxplotData', CHART_DATA_ADVICE);
/** @deprecated Removed in 0.31.0. Prepared data for the Insights charts, which wmap now draws itself (`insights: { enabled: true }`). */
export const buildTestTrendData = deprecated(buildTestTrendDataImpl, 'buildTestTrendData', CHART_DATA_ADVICE);
/** @deprecated Removed in 0.31.0. Prepared data for the Insights charts, which wmap now draws itself (`insights: { enabled: true }`). */
export const trendCentre = deprecated(trendCentreImpl, 'trendCentre', CHART_DATA_ADVICE);
/** @deprecated Removed in 0.31.0. Prepared data for the Insights charts, which wmap now draws itself (`insights: { enabled: true }`). */
export const buildTestPassRateData = deprecated(buildTestPassRateDataImpl, 'buildTestPassRateData', CHART_DATA_ADVICE);
/** @deprecated Removed in 0.31.0. Prepared data for the Insights charts, which wmap now draws itself (`insights: { enabled: true }`). */
export const hasJudgeableTests = deprecated(hasJudgeableTestsImpl, 'hasJudgeableTests', CHART_DATA_ADVICE);
/** @deprecated Removed in 0.31.0. Prepared data for the Insights charts, which wmap now draws itself (`insights: { enabled: true }`). */
export const buildTestHistogramData = deprecated(buildTestHistogramDataImpl, 'buildTestHistogramData', CHART_DATA_ADVICE);
/** @deprecated Removed in 0.31.0. Prepared data for the Insights charts, which wmap now draws itself (`insights: { enabled: true }`). */
export const buildTestHistogramSeries = deprecated(buildTestHistogramSeriesImpl, 'buildTestHistogramSeries', CHART_DATA_ADVICE);
/** @deprecated Removed in 0.31.0. Prepared data for the Insights charts, which wmap now draws itself (`insights: { enabled: true }`). */
export const buildScatterData = deprecated(buildScatterDataImpl, 'buildScatterData', CHART_DATA_ADVICE);
/** @deprecated Removed in 0.31.0. Prepared data for the Insights charts, which wmap now draws itself (`insights: { enabled: true }`). */
export const buildScatterDataGrouped = deprecated(buildScatterDataGroupedImpl, 'buildScatterDataGrouped', CHART_DATA_ADVICE);
/** @deprecated Removed in 0.31.0. Prepared data for the Insights charts, which wmap now draws itself (`insights: { enabled: true }`). */
export const buildYieldData = deprecated(buildYieldDataImpl, 'buildYieldData', CHART_DATA_ADVICE);
/** @deprecated Removed in 0.31.0. Prepared data for the Insights charts, which wmap now draws itself (`insights: { enabled: true }`). */
export const buildYieldDataCombined = deprecated(buildYieldDataCombinedImpl, 'buildYieldDataCombined', CHART_DATA_ADVICE);
/** @deprecated Removed in 0.31.0. Prepared data for the Insights charts, which wmap now draws itself (`insights: { enabled: true }`). */
export const buildBinParetoData = deprecated(buildBinParetoDataImpl, 'buildBinParetoData', CHART_DATA_ADVICE);
/** @deprecated Removed in 0.31.0. Prepared data for the Insights charts, which wmap now draws itself (`insights: { enabled: true }`). */
export const buildBinClusterData = deprecated(buildBinClusterDataImpl, 'buildBinClusterData', CHART_DATA_ADVICE);

// ── Deprecated in 0.30.0, removed in 0.31.0 ─────────────────────────────────
// The analysis's own internals and the report builders, exported by accident.
// Library code imports the defining modules, so only a host call raises a notice.
import { deprecatedValue } from '../renderer/deprecate.js';
import { buildRingRegions as buildRingRegionsImpl, buildQuadrantRegions as buildQuadrantRegionsImpl, buildSectorRegions as buildSectorRegionsImpl, buildReticlePositionRegions as buildReticlePositionRegionsImpl, buildTestSiteRegions as buildTestSiteRegionsImpl, buildRegionYieldData as buildRegionYieldDataImpl, areQuadrantsAdjacent as areQuadrantsAdjacentImpl, parseRegionKey as parseRegionKeyImpl, sectorCompassNames as sectorCompassNamesImpl } from './regions.js';
import { classifyPattern as classifyPatternImpl } from './patternClassification.js';
import { visibleFindings as visibleFindingsImpl } from './filterFindings.js';
import { computeFunctionalYield as computeFunctionalYieldImpl } from './analyzeWaferMap.js';
import { resolveMetadataColumns as resolveMetadataColumnsImpl, discoverDieMetadataKeys as discoverDieMetadataKeysImpl } from './metadataColumns.js';
import { renderFindingsReportHtml as renderFindingsReportHtmlImpl, openHtmlReport as openHtmlReportImpl } from './renderFindingsReport.js';
import { renderSummaryReportHtml as renderSummaryReportHtmlImpl, renderLotSummaryReportHtml as renderLotSummaryReportHtmlImpl } from './renderSummaryReport.js';
import { DEFAULT_FACET_CURATION as DEFAULT_FACET_CURATIONImpl } from './facets.js';

const DEPRECATION_ISSUES = "If you depend on it, say so at https://github.com/wafertools/wafermap/issues.";
const ADVICE_INTERNAL = "It is an internal helper that was exported by accident; buildWaferMap, analyzeWaferMap and the renderers already apply it.";
const ADVICE_PATTERN = "analyzeWaferMap reports the classified pattern as a finding (comparison.family 'spatial-pattern').";
const ADVICE_FUNCTIONAL = "analyzeWaferMap returns the same figures as stats.functionalYield.";
const ADVICE_META_COLS = "The die list resolves its metadata columns itself (the dieList.metadataColumns option).";
const ADVICE_REPORT = "Reports open from the Summary panel's report button; route them into your host with setReportOpener.";

/** @deprecated Removed in 0.31.0. It is an internal helper that was exported by accident; `buildWaferMap`, `analyzeWaferMap` and the renderers already apply it. */
export const buildRingRegions = deprecated(buildRingRegionsImpl, 'buildRingRegions', `${ADVICE_INTERNAL} ${DEPRECATION_ISSUES}`);
/** @deprecated Removed in 0.31.0. It is an internal helper that was exported by accident; `buildWaferMap`, `analyzeWaferMap` and the renderers already apply it. */
export const buildQuadrantRegions = deprecated(buildQuadrantRegionsImpl, 'buildQuadrantRegions', `${ADVICE_INTERNAL} ${DEPRECATION_ISSUES}`);
/** @deprecated Removed in 0.31.0. It is an internal helper that was exported by accident; `buildWaferMap`, `analyzeWaferMap` and the renderers already apply it. */
export const buildSectorRegions = deprecated(buildSectorRegionsImpl, 'buildSectorRegions', `${ADVICE_INTERNAL} ${DEPRECATION_ISSUES}`);
/** @deprecated Removed in 0.31.0. It is an internal helper that was exported by accident; `buildWaferMap`, `analyzeWaferMap` and the renderers already apply it. */
export const buildReticlePositionRegions = deprecated(buildReticlePositionRegionsImpl, 'buildReticlePositionRegions', `${ADVICE_INTERNAL} ${DEPRECATION_ISSUES}`);
/** @deprecated Removed in 0.31.0. It is an internal helper that was exported by accident; `buildWaferMap`, `analyzeWaferMap` and the renderers already apply it. */
export const buildTestSiteRegions = deprecated(buildTestSiteRegionsImpl, 'buildTestSiteRegions', `${ADVICE_INTERNAL} ${DEPRECATION_ISSUES}`);
/** @deprecated Removed in 0.31.0. It is an internal helper that was exported by accident; `buildWaferMap`, `analyzeWaferMap` and the renderers already apply it. */
export const buildRegionYieldData = deprecated(buildRegionYieldDataImpl, 'buildRegionYieldData', `${ADVICE_INTERNAL} ${DEPRECATION_ISSUES}`);
/** @deprecated Removed in 0.31.0. It is an internal helper that was exported by accident; `buildWaferMap`, `analyzeWaferMap` and the renderers already apply it. */
export const areQuadrantsAdjacent = deprecated(areQuadrantsAdjacentImpl, 'areQuadrantsAdjacent', `${ADVICE_INTERNAL} ${DEPRECATION_ISSUES}`);
/** @deprecated Removed in 0.31.0. It is an internal helper that was exported by accident; `buildWaferMap`, `analyzeWaferMap` and the renderers already apply it. */
export const parseRegionKey = deprecated(parseRegionKeyImpl, 'parseRegionKey', `${ADVICE_INTERNAL} ${DEPRECATION_ISSUES}`);
/** @deprecated Removed in 0.31.0. It is an internal helper that was exported by accident; `buildWaferMap`, `analyzeWaferMap` and the renderers already apply it. */
export const sectorCompassNames = deprecated(sectorCompassNamesImpl, 'sectorCompassNames', `${ADVICE_INTERNAL} ${DEPRECATION_ISSUES}`);
/** @deprecated Removed in 0.31.0. `analyzeWaferMap` reports the classified pattern as a finding (comparison.family 'spatial-pattern'). */
export const classifyPattern = deprecated(classifyPatternImpl, 'classifyPattern', `${ADVICE_PATTERN} ${DEPRECATION_ISSUES}`);
/** @deprecated Removed in 0.31.0. It is an internal helper that was exported by accident; `buildWaferMap`, `analyzeWaferMap` and the renderers already apply it. */
export const visibleFindings = deprecated(visibleFindingsImpl, 'visibleFindings', `${ADVICE_INTERNAL} ${DEPRECATION_ISSUES}`);
/** @deprecated Removed in 0.31.0. `analyzeWaferMap` returns the same figures as `stats.functionalYield`. */
export const computeFunctionalYield = deprecated(computeFunctionalYieldImpl, 'computeFunctionalYield', `${ADVICE_FUNCTIONAL} ${DEPRECATION_ISSUES}`);
/** @deprecated Removed in 0.31.0. The die list resolves its metadata columns itself (the `dieList.metadataColumns` option). */
export const resolveMetadataColumns = deprecated(resolveMetadataColumnsImpl, 'resolveMetadataColumns', `${ADVICE_META_COLS} ${DEPRECATION_ISSUES}`);
/** @deprecated Removed in 0.31.0. The die list resolves its metadata columns itself (the `dieList.metadataColumns` option). */
export const discoverDieMetadataKeys = deprecated(discoverDieMetadataKeysImpl, 'discoverDieMetadataKeys', `${ADVICE_META_COLS} ${DEPRECATION_ISSUES}`);
/** @deprecated Removed in 0.31.0. Reports open from the Summary panel's report button; route them into your host with `setReportOpener`. */
export const renderFindingsReportHtml = deprecated(renderFindingsReportHtmlImpl, 'renderFindingsReportHtml', `${ADVICE_REPORT} ${DEPRECATION_ISSUES}`);
/** @deprecated Removed in 0.31.0. Reports open from the Summary panel's report button; route them into your host with `setReportOpener`. */
export const openHtmlReport = deprecated(openHtmlReportImpl, 'openHtmlReport', `${ADVICE_REPORT} ${DEPRECATION_ISSUES}`);
/** @deprecated Removed in 0.31.0. Reports open from the Summary panel's report button; route them into your host with `setReportOpener`. */
export const renderSummaryReportHtml = deprecated(renderSummaryReportHtmlImpl, 'renderSummaryReportHtml', `${ADVICE_REPORT} ${DEPRECATION_ISSUES}`);
/** @deprecated Removed in 0.31.0. Reports open from the Summary panel's report button; route them into your host with `setReportOpener`. */
export const renderLotSummaryReportHtml = deprecated(renderLotSummaryReportHtmlImpl, 'renderLotSummaryReportHtml', `${ADVICE_REPORT} ${DEPRECATION_ISSUES}`);
/** @deprecated Removed in 0.31.0. `buildFacetTable` applies it by default. */
export const DEFAULT_FACET_CURATION = deprecatedValue(DEFAULT_FACET_CURATIONImpl, 'DEFAULT_FACET_CURATION');
