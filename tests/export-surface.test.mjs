import test from 'node:test';
import assert from 'node:assert/strict';
import * as rootApi         from '../dist/index.js';
import * as coreApi         from '../dist/packages/core/index.js';
import * as rendererApi     from '../dist/packages/renderer/index.js';
import * as statsApi        from '../dist/packages/stats/index.js';
import * as canvasApi       from '../dist/packages/canvas-adapter/index.js';

// Snapshots of the intended public API surface for each subpath.
// Any addition or removal breaks this test — update deliberately when the surface changes.

const SNAPSHOTS = {
  '.' : [
    'aggregateBinCounts', 'aggregateValues', 'analyzeWaferLot', 'analyzeWaferMap',
    'applyOrientation', 'applyProbeSequence', 'areQuadrantsAdjacent',
    'buildBinClusterData', 'buildBinParetoData',
    'buildCapabilityData', 'buildCorrelationMatrix', 'buildFacetTable', 'buildHoverText', 'buildMapTitle',
    'buildQuadrantRegions', 'buildRegionYieldData', 'buildReticlePositionRegions', 'buildRingRegions',
    'buildScatterData', 'buildScatterDataGrouped',
    'buildSectorRegions', 'buildTestBoxplotData', 'buildTestHistogramData', 'buildTestHistogramSeries',
    'buildTestSiteRegions', 'buildView', 'buildWaferMap',
    'buildYieldData', 'buildYieldDataCombined',
    'classifyDie', 'classifyPattern', 'clipDiesToWafer', 'computeFunctionalYield', 'contrastTextColor', 'createWafer',
    'DEFAULT_FACET_CURATION', 'facetValueOf', 'FACET_NONE_VALUE', 'filterCorrelationMatrix',
    'dieHasTestData',
    'filterFindings', 'findTestDef', 'generateDies', 'generateReticleGrid', 'generateTextOverlay',
    'parseRegionKey', 'sectorCompassNames',
    'getColorScheme', 'getDieKey', 'getDieTestValue', 'getTestPassStatus',
    'getReticleCell', 'getRingLabel', 'getUniqueBins', 'getUniqueTestNumbers',
    'hardBinColor', 'hardBinGreyscale', 'isInsideWafer', 'isParametricTest', 'isYieldEligibleDie', 'listColorSchemes',
    'mapDataToDies', 'openHtmlReport', 'registerColorScheme', 'setReportOpener',
    'renderFindingsReportHtml', 'renderLotSummaryReportHtml', 'renderSummaryReportHtml',
    'resolveTestNumber',
    'softBinColor', 'transformDies', 'valueToGreyscale', 'valueToViridis',
  ],
  './core': [
    'aggregateBinCounts', 'aggregateValues',
    'applyOrientation', 'applyProbeSequence',
    'classifyDie', 'clipDiesToWafer', 'createWafer',
    'generateDies', 'generateReticleGrid', 'getReticleCell', 'getRingLabel', 'getUniqueBins',
    'isInsideWafer', 'isYieldEligibleDie', 'mapDataToDies', 'transformDies',
  ],
  './renderer': [
    'buildHoverText', 'buildMapTitle', 'buildView', 'buildWaferMap',
    'contrastTextColor', 'dieHasTestData', 'findTestDef', 'generateTextOverlay',
    'getColorScheme', 'getDieKey', 'getDieTestValue', 'getTestPassStatus',
    'getUniqueTestNumbers',
    'hardBinColor', 'hardBinGreyscale',
    'isParametricTest',
    'listColorSchemes', 'registerColorScheme',
    'resolveTestNumber',
    'softBinColor', 'valueToGreyscale', 'valueToViridis',
  ],
  './stats': [
    'analyzeWaferLot', 'analyzeWaferMap', 'areQuadrantsAdjacent',
    'buildBinClusterData', 'buildBinParetoData',
    'buildCapabilityData', 'buildCorrelationMatrix', 'buildFacetTable',
    'buildQuadrantRegions', 'buildRegionYieldData', 'buildReticlePositionRegions',
    'buildRingRegions', 'buildScatterData', 'buildScatterDataGrouped',
    'buildSectorRegions', 'buildTestBoxplotData', 'buildTestHistogramData',
    'buildTestHistogramSeries', 'buildTestSiteRegions',
    'buildYieldData', 'buildYieldDataCombined',
    'classifyPattern', 'computeFunctionalYield', 'DEFAULT_FACET_CURATION',
    'facetValueOf', 'FACET_NONE_VALUE', 'filterCorrelationMatrix',
    'filterFindings', 'openHtmlReport', 'parseRegionKey', 'sectorCompassNames', 'setReportOpener',
    'renderFindingsReportHtml', 'renderLotSummaryReportHtml', 'renderSummaryReportHtml',
  ],
  './render': [
    'renderWaferMap', 'renderWaferGallery', 'setDetachWindowOpener', 'toCanvas',
  ],
};

const MODULES = {
  '.'          : rootApi,
  './core'     : coreApi,
  './renderer' : rendererApi,
  './stats'    : statsApi,
  './render'   : canvasApi,
};

for (const [subpath, expected] of Object.entries(SNAPSHOTS)) {
  const sorted = [...expected].sort();
  test(`${subpath} export surface is stable`, () => {
    const actual  = Object.keys(MODULES[subpath]).sort();
    const added   = actual.filter((n) => !sorted.includes(n));
    const removed = sorted.filter((n) => !actual.includes(n));
    assert.deepEqual(
      { added, removed },
      { added: [], removed: [] },
      `${subpath} API surface changed.\n  Added:   ${added.join(', ') || 'none'}\n  Removed: ${removed.join(', ') || 'none'}`,
    );
  });
}
