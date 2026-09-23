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

const DEPRECATION_ISSUES = "If you depend on it, say so at https://github.com/wafertools/wafermap/issues.";

/** @deprecated Removed in 0.31.0. `analyzeWaferMap` and `analyzeWaferLot` now return Cp/Cpk/Pp/Ppk as `stats.capability` (enable `computePerTestStats`); a lot's uses the pooled within-wafer stddev. */
export const buildCapabilityData = deprecated(buildCapabilityDataImpl, 'buildCapabilityData', `analyzeWaferMap and analyzeWaferLot now return Cp/Cpk/Pp/Ppk as stats.capability (enable computePerTestStats); a lot's uses the pooled within-wafer stddev. ${DEPRECATION_ISSUES}`);
/** @deprecated Removed in 0.31.0. It prepared data for the Insights correlation matrix, which wmap draws itself (`insights: { enabled: true }`); there is no data replacement yet. */
export const buildCorrelationMatrix = deprecated(buildCorrelationMatrixImpl, 'buildCorrelationMatrix', `It prepared data for the Insights correlation matrix, which wmap draws itself (insights: { enabled: true }); there is no data replacement yet. ${DEPRECATION_ISSUES}`);
/** @deprecated Removed in 0.31.0. It prepared data for the Insights correlation matrix, which wmap draws itself (`insights: { enabled: true }`); there is no data replacement. */
export const filterCorrelationMatrix = deprecated(filterCorrelationMatrixImpl, 'filterCorrelationMatrix', `It prepared data for the Insights correlation matrix, which wmap draws itself (insights: { enabled: true }); there is no data replacement. ${DEPRECATION_ISSUES}`);
/** @deprecated Removed in 0.31.0. Five-number summaries are `stats.perTestStats` (enable `computePerTestStats`), and `perWaferTestStats` on `analyzeWaferLot`'s result. */
export const buildTestBoxplotData = deprecated(buildTestBoxplotDataImpl, 'buildTestBoxplotData', `Five-number summaries are stats.perTestStats (enable computePerTestStats), and perWaferTestStats on analyzeWaferLot's result. ${DEPRECATION_ISSUES}`);
/** @deprecated Removed in 0.31.0. Per-wafer means and stddevs in slot order are `perWaferTestStats` on `analyzeWaferLot`'s result (enable `computePerTestStats`). */
export const buildTestTrendData = deprecated(buildTestTrendDataImpl, 'buildTestTrendData', `Per-wafer means and stddevs in slot order are perWaferTestStats on analyzeWaferLot's result (enable computePerTestStats). ${DEPRECATION_ISSUES}`);
/** @deprecated Removed in 0.31.0. Compute the die-weighted mean from `perWaferTestStats` (mean × count) on `analyzeWaferLot`'s result. */
export const trendCentre = deprecated(trendCentreImpl, 'trendCentre', `Compute the die-weighted mean from perWaferTestStats (mean × count) on analyzeWaferLot's result. ${DEPRECATION_ISSUES}`);
/** @deprecated Removed in 0.31.0. `analyzeWaferMap` and `analyzeWaferLot` now return per-test pass rates as `stats.testSpecYield` (spec limits), `stats.testFlagYield` (tester verdicts) and `stats.functionalYield`, with `stats.specVerdictDisagreementDies.` */
export const buildTestPassRateData = deprecated(buildTestPassRateDataImpl, 'buildTestPassRateData', `analyzeWaferMap and analyzeWaferLot now return per-test pass rates as stats.testSpecYield (spec limits), stats.testFlagYield (tester verdicts) and stats.functionalYield, with stats.specVerdictDisagreementDies. ${DEPRECATION_ISSUES}`);
/** @deprecated Removed in 0.31.0. Read which pass rates exist from `stats.testSpecYield`, `stats.testFlagYield` and `stats.functionalYield` on `analyzeWaferMap`'s or `analyzeWaferLot`'s result. */
export const hasJudgeableTests = deprecated(hasJudgeableTestsImpl, 'hasJudgeableTests', `Read which pass rates exist from stats.testSpecYield, stats.testFlagYield and stats.functionalYield on analyzeWaferMap's or analyzeWaferLot's result. ${DEPRECATION_ISSUES}`);
/** @deprecated Removed in 0.31.0. It prepared data for the Insights histogram, which wmap draws itself (`insights: { enabled: true }`); there is no data replacement. */
export const buildTestHistogramData = deprecated(buildTestHistogramDataImpl, 'buildTestHistogramData', `It prepared data for the Insights histogram, which wmap draws itself (insights: { enabled: true }); there is no data replacement. ${DEPRECATION_ISSUES}`);
/** @deprecated Removed in 0.31.0. It prepared data for the Insights histogram, which wmap draws itself (`insights: { enabled: true }`); there is no data replacement. */
export const buildTestHistogramSeries = deprecated(buildTestHistogramSeriesImpl, 'buildTestHistogramSeries', `It prepared data for the Insights histogram, which wmap draws itself (insights: { enabled: true }); there is no data replacement. ${DEPRECATION_ISSUES}`);
/** @deprecated Removed in 0.31.0. It prepared data for the Insights scatter plot, which wmap draws itself (`insights: { enabled: true }`); there is no data replacement. */
export const buildScatterData = deprecated(buildScatterDataImpl, 'buildScatterData', `It prepared data for the Insights scatter plot, which wmap draws itself (insights: { enabled: true }); there is no data replacement. ${DEPRECATION_ISSUES}`);
/** @deprecated Removed in 0.31.0. It prepared data for the Insights scatter plot, which wmap draws itself (`insights: { enabled: true }`); there is no data replacement. */
export const buildScatterDataGrouped = deprecated(buildScatterDataGroupedImpl, 'buildScatterDataGrouped', `It prepared data for the Insights scatter plot, which wmap draws itself (insights: { enabled: true }); there is no data replacement. ${DEPRECATION_ISSUES}`);
/** @deprecated Removed in 0.31.0. Per-wafer yield is `lotYieldSeries` on `analyzeWaferLot`'s result, and `stats.yieldPercent` on each summary. */
export const buildYieldData = deprecated(buildYieldDataImpl, 'buildYieldData', `Per-wafer yield is lotYieldSeries on analyzeWaferLot's result, and stats.yieldPercent on each summary. ${DEPRECATION_ISSUES}`);
/** @deprecated Removed in 0.31.0. Per-wafer yield is `lotYieldSeries` on `analyzeWaferLot`'s result; weight it by each wafer's die count to combine groups. */
export const buildYieldDataCombined = deprecated(buildYieldDataCombinedImpl, 'buildYieldDataCombined', `Per-wafer yield is lotYieldSeries on analyzeWaferLot's result; weight it by each wafer's die count to combine groups. ${DEPRECATION_ISSUES}`);
/** @deprecated Removed in 0.31.0. Bin counts are `stats.hardBinCounts` and `stats.softBinCounts` on `analyzeWaferMap`'s result. */
export const buildBinParetoData = deprecated(buildBinParetoDataImpl, 'buildBinParetoData', `Bin counts are stats.hardBinCounts and stats.softBinCounts on analyzeWaferMap's result. ${DEPRECATION_ISSUES}`);
/** @deprecated Removed in 0.31.0. Bin counts per wafer are `stats.hardBinCounts` and `stats.softBinCounts` on each perWafer summary of `analyzeWaferLot`'s result. */
export const buildBinClusterData = deprecated(buildBinClusterDataImpl, 'buildBinClusterData', `Bin counts per wafer are stats.hardBinCounts and stats.softBinCounts on each perWafer summary of analyzeWaferLot's result. ${DEPRECATION_ISSUES}`);

// ── Deprecated in 0.30.0, removed in 0.31.0 ─────────────────────────────────
// The analysis's own internals and the report builders, exported by accident.
// Library code imports the defining modules, so only a host call raises a notice.
import { deprecatedValue } from '../renderer/deprecate.js';
import { buildRingRegions as buildRingRegionsImpl, buildQuadrantRegions as buildQuadrantRegionsImpl, buildSectorRegions as buildSectorRegionsImpl, buildReticlePositionRegions as buildReticlePositionRegionsImpl, buildTestSiteRegions as buildTestSiteRegionsImpl, buildRegionYieldData as buildRegionYieldDataImpl, areQuadrantsAdjacent as areQuadrantsAdjacentImpl, parseRegionKey as parseRegionKeyImpl, sectorCompassNames as sectorCompassNamesImpl } from './regions.js';
import { classifyPattern as classifyPatternImpl } from './patternClassification.js';
import { computeFunctionalYield as computeFunctionalYieldImpl } from './analyzeWaferMap.js';
import { resolveMetadataColumns as resolveMetadataColumnsImpl, discoverDieMetadataKeys as discoverDieMetadataKeysImpl } from './metadataColumns.js';
import { openHtmlReport as openHtmlReportImpl } from './renderFindingsReport.js';
import { renderSummaryReportHtml as renderSummaryReportHtmlImpl, renderLotSummaryReportHtml as renderLotSummaryReportHtmlImpl } from './renderSummaryReport.js';
import { DEFAULT_FACET_CURATION as DEFAULT_FACET_CURATIONImpl } from './facets.js';

const ADVICE_PATTERN = "analyzeWaferMap returns the classification, with its geometry features, as stats.spatialPattern for every wafer, and a detected pattern as a finding (comparison.family 'spatial-pattern').";
const ADVICE_FUNCTIONAL = "analyzeWaferMap returns the same figures as stats.functionalYield.";
const ADVICE_META_COLS = "The die list resolves its metadata columns itself (the dieList.metadataColumns option).";

/** @deprecated Removed in 0.31.0. Ring yield is `stats.regionYield.ring` on `analyzeWaferMap`'s or `analyzeWaferLot`'s result; ring findings are in findings. */
export const buildRingRegions = deprecated(buildRingRegionsImpl, 'buildRingRegions', `Ring yield is stats.regionYield.ring on analyzeWaferMap's or analyzeWaferLot's result; ring findings are in findings. ${DEPRECATION_ISSUES}`);
/** @deprecated Removed in 0.31.0. Quadrant yield is `stats.regionYield.quadrant` on `analyzeWaferMap`'s or `analyzeWaferLot`'s result; quadrant findings are in findings. */
export const buildQuadrantRegions = deprecated(buildQuadrantRegionsImpl, 'buildQuadrantRegions', `Quadrant yield is stats.regionYield.quadrant on analyzeWaferMap's or analyzeWaferLot's result; quadrant findings are in findings. ${DEPRECATION_ISSUES}`);
/** @deprecated Removed in 0.31.0. Sector findings are in `analyzeWaferMap`'s findings (`comparison.family` 'sector'). */
export const buildSectorRegions = deprecated(buildSectorRegionsImpl, 'buildSectorRegions', `Sector findings are in analyzeWaferMap's findings (comparison.family 'sector'). ${DEPRECATION_ISSUES}`);
/** @deprecated Removed in 0.31.0. Reticle-position findings are in `analyzeWaferMap`'s findings; a die's reticle cell is `getReticleCell(die, reticleConfig)`. */
export const buildReticlePositionRegions = deprecated(buildReticlePositionRegionsImpl, 'buildReticlePositionRegions', `Reticle-position findings are in analyzeWaferMap's findings; a die's reticle cell is getReticleCell(die, reticleConfig). ${DEPRECATION_ISSUES}`);
/** @deprecated Removed in 0.31.0. Test-site findings are in `analyzeWaferMap`'s findings (`comparison.family` 'test-site'). */
export const buildTestSiteRegions = deprecated(buildTestSiteRegionsImpl, 'buildTestSiteRegions', `Test-site findings are in analyzeWaferMap's findings (comparison.family 'test-site'). ${DEPRECATION_ISSUES}`);
/** @deprecated Removed in 0.31.0. `analyzeWaferMap` and `analyzeWaferLot` now return ring and quadrant yield as `stats.regionYield.` */
export const buildRegionYieldData = deprecated(buildRegionYieldDataImpl, 'buildRegionYieldData', `analyzeWaferMap and analyzeWaferLot now return ring and quadrant yield as stats.regionYield. ${DEPRECATION_ISSUES}`);
/** @deprecated Removed in 0.31.0. It is an internal helper of the quadrant findings, which `analyzeWaferMap` already reports. */
export const areQuadrantsAdjacent = deprecated(areQuadrantsAdjacentImpl, 'areQuadrantsAdjacent', `It is an internal helper of the quadrant findings, which analyzeWaferMap already reports. ${DEPRECATION_ISSUES}`);
/** @deprecated Removed in 0.31.0. Findings name their region in prose (`comparison.left`) and region yield in `RegionYield.label`; region keys are identities, not to be parsed. */
export const parseRegionKey = deprecated(parseRegionKeyImpl, 'parseRegionKey', `Findings name their region in prose (comparison.left) and region yield in RegionYield.label; region keys are identities, not to be parsed. ${DEPRECATION_ISSUES}`);
/** @deprecated Removed in 0.31.0. Sector findings name their sector in prose (`comparison.left`). */
export const sectorCompassNames = deprecated(sectorCompassNamesImpl, 'sectorCompassNames', `Sector findings name their sector in prose (comparison.left). ${DEPRECATION_ISSUES}`);
/** @deprecated Removed in 0.31.0. `analyzeWaferMap` returns the classification, with its geometry features, as `stats.spatialPattern` for every wafer, and a detected pattern as a finding (`comparison.family` `'spatial-pattern'`). */
export const classifyPattern = deprecated(classifyPatternImpl, 'classifyPattern', `${ADVICE_PATTERN} ${DEPRECATION_ISSUES}`);
/** @deprecated Removed in 0.31.0. `analyzeWaferMap` returns the same figures as `stats.functionalYield`. */
export const computeFunctionalYield = deprecated(computeFunctionalYieldImpl, 'computeFunctionalYield', `${ADVICE_FUNCTIONAL} ${DEPRECATION_ISSUES}`);
/** @deprecated Removed in 0.31.0. The die list resolves its metadata columns itself (the `dieList.metadataColumns` option). */
export const resolveMetadataColumns = deprecated(resolveMetadataColumnsImpl, 'resolveMetadataColumns', `${ADVICE_META_COLS} ${DEPRECATION_ISSUES}`);
/** @deprecated Removed in 0.31.0. The die list resolves its metadata columns itself (the `dieList.metadataColumns` option). */
export const discoverDieMetadataKeys = deprecated(discoverDieMetadataKeysImpl, 'discoverDieMetadataKeys', `${ADVICE_META_COLS} ${DEPRECATION_ISSUES}`);
/** @deprecated Removed in 0.31.0. Open reports with `openReportModal(html)`, or route them into your host with `setReportOpener`. */
export const openHtmlReport = deprecated(openHtmlReportImpl, 'openHtmlReport', `Open reports with openReportModal(html), or route them into your host with setReportOpener. ${DEPRECATION_ISSUES}`);
/** @deprecated Removed in 0.31.0. Use `renderWaferReportHtml(result, summary)`, which reads pass bins and ring count from the built map. */
export const renderSummaryReportHtml = deprecated(renderSummaryReportHtmlImpl, 'renderSummaryReportHtml', `Use renderWaferReportHtml(result, summary), which reads pass bins and ring count from the built map. ${DEPRECATION_ISSUES}`);
/** @deprecated Removed in 0.31.0. Use `renderLotReportHtml(results)`, which reads each wafer's pass bins and ring count from its built map. */
export const renderLotSummaryReportHtml = deprecated(renderLotSummaryReportHtmlImpl, 'renderLotSummaryReportHtml', `Use renderLotReportHtml(results), which reads each wafer's pass bins and ring count from its built map. ${DEPRECATION_ISSUES}`);
/** @deprecated Removed in 0.31.0. `buildFacetTable` applies it by default. */
export const DEFAULT_FACET_CURATION = deprecatedValue(DEFAULT_FACET_CURATIONImpl, 'DEFAULT_FACET_CURATION');

// ── Deprecated in 0.31.0, removed in 0.32.0 ─────────────────────────────────
// The findings-only report. It was kept in 0.30.1 because "the Summary panel
// uses it", which had not been true since 0.20.0; no host calls it, and the
// wafer and lot reports carry the same findings table (the one both now render,
// `findingsTableHtml` in reportHtml.ts) along with the population and yield the
// findings were drawn from. See API_REMOVALS.md.
import { renderFindingsReportHtml as renderFindingsReportHtmlImpl } from './renderFindingsReport.js';

/** @deprecated Removed in 0.32.0. Use `renderWaferReportHtml(result, summary)` or `renderLotReportHtml(results)`: their Findings section is the same table, alongside the population and yield it was found in. */
export const renderFindingsReportHtml = deprecated(renderFindingsReportHtmlImpl, 'renderFindingsReportHtml', `Use renderWaferReportHtml(result, summary) or renderLotReportHtml(results): their Findings section is the same table, alongside the population and yield it was found in. ${DEPRECATION_ISSUES}`, '0.32.0');
