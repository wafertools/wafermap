// Bootstraps window.__wmapDemoApi for docs/guide-demos.js on the docs site.
// Uses dynamic import() so this can load as a plain defer script — guaranteeing
// it runs before guide-demos.js (also defer), unlike type="module" which is
// scheduled independently and may arrive late.
(function () {
  Promise.all([
    import('../dist/packages/renderer/buildWaferMap.js'),
    import('../dist/packages/canvas-adapter/renderWaferMap.js'),
    import('../dist/packages/canvas-adapter/renderWaferGallery.js'),
    import('../dist/packages/stats/analyzeWaferMap.js'),
  ]).then(function (mods) {
    window.__wmapDemoApi = {
      buildWaferMap:      mods[0].buildWaferMap,
      renderWaferMap:     mods[1].renderWaferMap,
      renderWaferGallery: mods[2].renderWaferGallery,
      analyzeWaferMap:    mods[3].analyzeWaferMap,
    };
    if (typeof window.__wmapPopulateGuideDemos === 'function') {
      window.__wmapPopulateGuideDemos(document);
    }
  });
})();
