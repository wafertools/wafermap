export * from './types.js';
export * from './regions.js';
export * from './analyzeWaferMap.js';
export * from './analyzeWaferLot.js';
export * from './filterFindings.js';
export type { PatternLabel, PatternClassification, PatternFeatures } from './patternClassification.js';
export { setReportOpener } from './renderFindingsReport.js';
export type { SummaryReportParams, LotSummaryReportParams } from './renderSummaryReport.js';
export { buildFacetTable, facetValueOf, FACET_NONE_VALUE } from './facets.js';
export type { FacetField, FacetValue, FacetCuration, FacetItem, BuildFacetTableOptions } from './facets.js';
export type {
  MetadataColumn, MetadataColumnScope, MetadataColumnSet, MetadataKeySelection,
  ResolveMetadataColumnsOptions,
} from './metadataColumns.js';
export { mergeTestDefs } from './mergeTestDefs.js';
export type { MergedTestDefs, TestDefConflict, TestDefConflictKind } from './mergeTestDefs.js';
export type { CapabilityDatum, CapabilityItem } from './capability.js';
export type { CorrelationTestInfo, CorrelationCell, CorrelationMatrix, CorrelationSummary } from './correlation.js';
export type { BoxplotDatum, BoxplotItem } from './boxplot.js';
export type { TrendDatum, TrendItem } from './trend.js';
export type { TestPassKind, TestPassRateData, TestPassRateItem, TestPassRateRow, TestPassRateValue } from './testPassRate.js';
export type { HistogramBucket, HistogramItem, HistogramSeries, HistogramSeriesData } from './histogram.js';
export type { ScatterPoint, ScatterItem } from './scatter.js';
export type { ChartDatum, YieldItem, YieldSortBy } from './yield.js';
export type { BinType, BinItem, BinCluster, BinClusterData } from './binPareto.js';

// Deprecated in 0.30.0, removed in 0.31.0. Each is wrapped in ./deprecated.ts, whose
// declarations carry the `@deprecated` tags; this named re-export shadows any `export *` above.
export {
  buildCapabilityData, buildCorrelationMatrix, filterCorrelationMatrix, buildTestBoxplotData,
  buildTestTrendData, trendCentre, buildTestPassRateData, hasJudgeableTests,
  buildTestHistogramData, buildTestHistogramSeries, buildScatterData, buildScatterDataGrouped,
  buildYieldData, buildYieldDataCombined, buildBinParetoData, buildBinClusterData,
  buildRingRegions, buildQuadrantRegions, buildSectorRegions, buildReticlePositionRegions,
  buildTestSiteRegions, buildRegionYieldData, areQuadrantsAdjacent, parseRegionKey,
  sectorCompassNames, classifyPattern, visibleFindings, computeFunctionalYield,
  resolveMetadataColumns, discoverDieMetadataKeys, renderFindingsReportHtml, openHtmlReport,
  renderSummaryReportHtml, renderLotSummaryReportHtml, DEFAULT_FACET_CURATION,
} from './deprecated.js';
