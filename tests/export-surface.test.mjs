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
    'affineCompose', 'affineIdentity', 'affineInvert', 'affineMirror',
    'affinePoint', 'affineRotation', 'affineSwapsAxes', 'affineVector',
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
    'filterFindings', 'generateDies', 'generateReticleGrid',
    'parseRegionKey', 'resolveGridPitch', 'sectorCompassNames',
    'getColorScheme', 'getDieKey', 'getDieTestValue', 'getTestPassStatus',
    'getReticleCell', 'getRingLabel', 'getUniqueBins', 'hasPosition',
    'hardBinColor', 'hardBinGreyscale', 'isInsideWafer', 'isParametricTest', 'isPositionedDie', 'isYieldEligibleDie', 'listColorSchemes',
    'mapDataToDies', 'metadataCategoricalValue', 'metadataDisplayValue',
    'openHtmlReport', 'registerColorScheme', 'resolveMetadataColumns', 'discoverDieMetadataKeys', 'setReportOpener',
    'renderFindingsReportHtml', 'renderLotSummaryReportHtml', 'renderSummaryReportHtml',
    'softBinColor', 'transformDies', 'valueToGreyscale', 'valueToViridis',
  ],
  './core': [
    'affineCompose', 'affineIdentity', 'affineInvert', 'affineMirror',
    'affinePoint', 'affineRotation', 'affineSwapsAxes', 'affineVector',
    'aggregateBinCounts', 'aggregateValues',
    'applyOrientation', 'applyProbeSequence',
    'classifyDie', 'clipDiesToWafer', 'createWafer',
    'generateDies', 'generateReticleGrid', 'getDieKey', 'getReticleCell', 'getRingLabel', 'getUniqueBins',
    'hasPosition', 'isInsideWafer', 'isPositionedDie', 'isYieldEligibleDie', 'mapDataToDies',
    'metadataCategoricalValue', 'metadataDisplayValue', 'resolveGridPitch', 'transformDies',
  ],
  // findTestDef / generateTextOverlay / getUniqueTestNumbers / resolveTestNumber were
  // removed from the public surface in 0.22.0 — internal view-pipeline helpers with no
  // documented contract. In-repo callers import them from './buildView.js' directly.
  './renderer': [
    'buildHoverText', 'buildMapTitle', 'buildView', 'buildWaferMap',
    'contrastTextColor', 'dieHasTestData',
    'getColorScheme', 'getDieKey', 'getDieTestValue', 'getTestPassStatus',
    'hardBinColor', 'hardBinGreyscale',
    'isParametricTest',
    'listColorSchemes', 'registerColorScheme',
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
    'filterFindings', 'openHtmlReport', 'parseRegionKey', 'resolveMetadataColumns', 'discoverDieMetadataKeys', 'sectorCompassNames', 'setReportOpener',
    'renderFindingsReportHtml', 'renderLotSummaryReportHtml', 'renderSummaryReportHtml',
  ],
  './render': [
    'renderWaferMap', 'renderWaferGallery', 'setDetachWindowOpener', 'toCanvas',
    // Warning surfacing. `collectWarnings` is public so a host that turns the
    // built-in UI off (`warnings: { display: false }`) can reproduce exactly the
    // set the library would have shown, rather than re-deriving it from two
    // separate sources and getting the de-duplication subtly different.
    'collectWarnings', 'severityOf',
    // General-purpose die-list table + CSV export (position/site/bins/per-test
    // values) — used internally for coordinate-less wafers, and exposed so a
    // host (tsmap's lot-level "Die list…" toolbar button) can build its own
    // combined view. See WMAP_ISSUES.md #39.
    'buildDieListSection',
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
