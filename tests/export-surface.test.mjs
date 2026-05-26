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
    'applyOrientation', 'applyProbeSequence',
    'buildHoverText',
    'buildQuadrantRegions', 'buildReticlePositionRegions', 'buildRingRegions',
    'buildSectorRegions', 'buildWaferMap',
    'classifyDie', 'clipDiesToWafer', 'contrastTextColor', 'createWafer',
    'filterFindings', 'findTestDef', 'generateDies', 'generateReticleGrid', 'generateTextOverlay',
    'getColorScheme', 'getDieKey', 'getDieTestValue',
    'getRingLabel', 'getUniqueBins', 'getUniqueTestNumbers',
    'hardBinColor', 'hardBinGreyscale', 'isInsideWafer', 'listColorSchemes',
    'mapDataToDies', 'openHtmlReport', 'registerColorScheme',
    'renderFindingsReportHtml', 'renderLotSummaryReportHtml', 'renderSummaryReportHtml',
    'resolveTestNumber',
    'softBinColor', 'transformDies', 'valueToGreyscale', 'valueToViridis',
  ],
  './core': [
    'aggregateBinCounts', 'aggregateValues',
    'applyOrientation', 'applyProbeSequence',
    'classifyDie', 'clipDiesToWafer', 'createWafer',
    'generateDies', 'generateReticleGrid', 'getRingLabel', 'getUniqueBins',
    'isInsideWafer', 'mapDataToDies', 'transformDies',
  ],
  './renderer': [
    'buildHoverText', 'buildWaferMap',
    'contrastTextColor', 'findTestDef', 'generateTextOverlay',
    'getColorScheme', 'getDieKey', 'getDieTestValue',
    'getUniqueTestNumbers',
    'hardBinColor', 'hardBinGreyscale',
    'listColorSchemes', 'registerColorScheme',
    'resolveTestNumber',
    'softBinColor', 'valueToGreyscale', 'valueToViridis',
  ],
  './stats': [
    'analyzeWaferLot', 'analyzeWaferMap',
    'buildQuadrantRegions', 'buildReticlePositionRegions',
    'buildRingRegions', 'buildSectorRegions',
    'filterFindings', 'openHtmlReport',
    'renderFindingsReportHtml', 'renderLotSummaryReportHtml', 'renderSummaryReportHtml',
  ],
  './render': [
    'renderWaferMap', 'renderWaferGallery', 'toCanvas',
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
