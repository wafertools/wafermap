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
  // 0.31.0 removed the 74 exports deprecated in 0.30.0 and 0.30.3 (API_REMOVALS.md, Part 2).
  '.' : [
    // Added in 0.30.1 as replacements for deprecated exports (API_REMOVALS.md, Part 2).
    'binColorsForMaps', 'renderLotReportHtml', 'renderWaferReportHtml',
    // Added in 0.30.3 so a host marks derived tests in its own UI exactly as the
    // library does (tsmap's test selector).
    'DERIVED_KEY', 'DERIVED_MARK',
    'analyzeWaferLot', 'analyzeWaferMap', 'buildFacetTable', 'buildWaferMap',
    'diePassStatus', 'facetValueOf', 'FACET_NONE_VALUE', 'filterFindings',
    'getDieKey', 'getReticleCell', 'getTestPassStatus', 'hasPosition', 'isYieldEligibleDie',
    'listBinColorSchemes', 'listValueColorSchemes', 'mergeTestDefs', 'metadataDisplayValue',
    'registerBinColorScheme', 'registerValueColorScheme', 'resolveValueColorFn',
    'setReportOpener', 'visibleFindings',
  ],
  './core': [
    'diePassStatus', 'getDieKey', 'getReticleCell', 'hasPosition', 'isYieldEligibleDie',
    'metadataDisplayValue',
  ],
  // findTestDef / generateTextOverlay / getUniqueTestNumbers / resolveTestNumber were
  // removed from the public surface in 0.22.0 — internal view-pipeline helpers with no
  // documented contract. In-repo callers import them from './buildView.js' directly.
  './renderer': [
    // Added in 0.30.1 as replacements for deprecated exports (API_REMOVALS.md, Part 2).
    'binColorsForMaps',
    // Added in 0.30.3 — see the root entry above.
    'DERIVED_KEY', 'DERIVED_MARK',
    'buildWaferMap', 'getDieKey', 'getTestPassStatus',
    'listBinColorSchemes', 'listValueColorSchemes', 'registerBinColorScheme', 'registerValueColorScheme',
    'resolveValueColorFn',
  ],
  './stats': [
    // Added in 0.30.1 as replacements for deprecated exports (API_REMOVALS.md, Part 2).
    'renderLotReportHtml', 'renderWaferReportHtml',
    'analyzeWaferLot', 'analyzeWaferMap', 'buildFacetTable', 'facetValueOf', 'FACET_NONE_VALUE',
    'filterFindings', 'mergeTestDefs', 'setReportOpener', 'visibleFindings',
  ],
  './render': [
    'renderWaferMap', 'renderWaferGallery', 'setDetachWindowOpener',
    // Which build is actually running, for a host to show in its own About
    // dialog — the numbers previously only reached a console line, which is not
    // an answer you can give a fab engineer asking why a map looks wrong.
    'WMAP_VERSION', 'WMAP_BUILD_TIME',
    // Warning surfacing. `collectWarnings` is public so a host that turns the
    // built-in UI off (`warnings: { display: false }`) can reproduce exactly the
    // set the library would have shown, rather than re-deriving it from two
    // separate sources and getting the de-duplication subtly different.
    'collectWarnings', 'severityOf',
    // The toolbar's own icon set — exposed so a host rendering its own chrome
    // alongside wmap's can match wmap's iconography instead of copy-pasting
    // SVGs that silently drift on the next redesign.
    'ICONS',
    // In-app modal for report HTML — the Summary panel's "Summary report"
    // button now opens through this by default, no setReportOpener wiring
    // required just to view a report.
    'openReportModal',
    // Opens the same guide window WaferMapController/GalleryController's own
    // openUserGuide() opens, but with no live render required — for a host
    // whose help entry point must also work before anything is loaded.
    'openWaferMapGuide',
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
