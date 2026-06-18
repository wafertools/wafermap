// Inline demo script for the embedded user guide modal.
// Reads the library API from window.__wmapDemoApi at call time (not at script
// execution time) — the API is set by the caller before invoking populateGuideDemos.
// To add a new demo: add a handler below and a <div data-wmap-demo="id"> in user-guide.md.
(function () {
  function makeDemoWafer(radius) {
    radius = radius || 7;
    var out = [];
    for (var x = -radius; x <= radius; x++) {
      for (var y = -radius; y <= radius; y++) {
        if (Math.sqrt(x * x + y * y) > radius + 0.5) continue;
        out.push({
          x: x, y: y,
          hbin: (Math.abs(x * 3 + y * 7) % 10 < 2) ? 2 : 1,
          testValues: { 1: +((x * 0.5 + y * 0.3 + 5).toFixed(3)) },
        });
      }
    }
    return out;
  }

  // Wafer with edge-ring failures — dies near perimeter are bin 2, interior pass.
  function makeEdgeFailWafer(radius) {
    radius = radius || 7;
    var out = [];
    for (var x = -radius; x <= radius; x++) {
      for (var y = -radius; y <= radius; y++) {
        var dist = Math.sqrt(x * x + y * y);
        if (dist > radius + 0.5) continue;
        out.push({ x: x, y: y, hbin: dist > radius - 1.8 ? 2 : 1 });
      }
    }
    return out;
  }

  function populateGuideDemos(root) {
    /** @type {import('../dist/index.js')} */
    var api = window.__wmapDemoApi;
    if (!api) return;
    var buildWaferMap = api.buildWaferMap;
    var renderWaferMap = api.renderWaferMap;
    var renderWaferGallery = api.renderWaferGallery;
    var analyzeWaferMap = api.analyzeWaferMap;

    var demos = root.querySelectorAll('[data-wmap-demo]');
    if (!demos.length) return;

    var results = makeDemoWafer();
    var hbinDefs = [{ bin: 1, name: 'Pass' }, { bin: 2, name: 'Fail' }];
    var testDefs = [{ testNumber: 1, name: 'Test A', unit: 'V', limitLow: 1.5, limitHigh: 8.5 }];

    var binResult = buildWaferMap({ results: results, hbinDefs: hbinDefs, passBins: [1], waferConfig: { notch: { type: 'right' } }, });
    var valueResult = buildWaferMap({ results: results, hbinDefs: hbinDefs, testDefs: testDefs, passBins: [1], waferConfig: { notch: { type: 'right' } }, });

    for (var i = 0; i < demos.length; i++) {
      var el = demos[i];
      var id = el.dataset.wmapDemo;
      try {
        if (id === 'value-heatmap') {
          renderWaferMap(el, valueResult, {
            showToolbar: false, showTooltip: true,
            viewOptions: { plotMode: 'value', activeTest: 1 }
          });

        } else if (id === 'spec-passfail') {
          renderWaferMap(el, valueResult, {
            showToolbar: false, showTooltip: true,
            viewOptions: { plotMode: 'value', activeTest: 1, colorBySpec: true }
          });

        } else if (id === 'bin-highlight') {
          // Show bin 2 highlighted (dimmed all others) so the feature is visible without interaction.
          renderWaferMap(el, binResult, {
            showToolbar: false, showTooltip: true,
            viewOptions: { plotMode: 'hardBin', highlightBin: 2 }
          });

        } else if (id === 'bin-map') {
          // basic hardbin map with no toolbar, just the wafer display.
          renderWaferMap(el, binResult, {
            showToolbar: false, showTooltip: true,
            viewOptions: { plotMode: 'hardBin', showXYIndicator: true }
          });

        } else if (id === 'orientation') {
          // Show the wafer rotated 90° so the notch is clearly on the left side,
          // illustrating that the display orientation can be adjusted.

          renderWaferMap(el, binResult, {
            showToolbar: false, showTooltip: true,
            viewOptions: { plotMode: 'hardBin', rotation: 90, showXYIndicator: true }
          });

        } else if (id === 'overlays') {
          // Show ring boundaries, quadrant lines, and XY indicator all active.
          renderWaferMap(el, binResult, {
            showToolbar: false, showTooltip: true,
            viewOptions: {
              plotMode: 'hardBin',
              showRingBoundaries: true,
              showQuadrantBoundaries: true,
              showXYIndicator: true,
            }
          });

        } else if (id === 'gallery') {
          var items = [0, 1, 2, 3].map(function (n) {
            var r = buildWaferMap({ results: makeDemoWafer(6 + n), hbinDefs: hbinDefs, passBins: [1] });
            return { wafer: r.wafer, dies: r.dies, hbinDefs: hbinDefs, label: 'Wafer ' + (n + 1) };
          });
          renderWaferGallery(el, items);

        } else if (id === 'findings') {
          // Build a wafer with a strong edge-ring failure pattern so findings are guaranteed.
          var edgeResults = makeEdgeFailWafer(7);
          var edgeResult = buildWaferMap({ results: edgeResults, hbinDefs: hbinDefs, passBins: [1] });
          var summary = analyzeWaferMap ? analyzeWaferMap(edgeResult) : null;
          renderWaferMap(el, edgeResult, {
            showToolbar: true, showTooltip: true,
            viewOptions: { plotMode: 'hardBin' },
            statsSummary: summary || undefined,
            summaryPanel: summary ? { defaultOpen: true } : undefined,
          });

        } else if (id === 'lot-stack') {
          // Count how many wafers (out of 3) each die failed (bin 2) — shown as a heatmap.
          function makeLotWafer(seed) {
            var r = 7, out = [];
            for (var x = -r; x <= r; x++) {
              for (var y = -r; y <= r; y++) {
                if (Math.sqrt(x * x + y * y) > r + 0.5) continue;
                out.push({ x: x, y: y, hbin: (Math.abs(x * seed + y * (seed + 4)) % 10 < 2) ? 2 : 1 });
              }
            }
            return out;
          }
          var stackResult = buildWaferMap({
            lotStack: { results: [makeLotWafer(3), makeLotWafer(7), makeLotWafer(11)], method: 'countBin', targetBin: 2 },
            hbinDefs: hbinDefs,
            passBins: [1],
          });
          renderWaferMap(el, stackResult, {
            showToolbar: false, showTooltip: true,
            viewOptions: { plotMode: 'stackedBins' }
          });

        } else if (id === 'box-select') {
          // Box-select is interactive — render WITH the toolbar so the box-select
          // tool is reachable, and pre-select a cluster of dies so the user sees
          // what a selection looks like before dragging their own.
          var bsResult = buildWaferMap({ results: results, hbinDefs: hbinDefs, testDefs: testDefs, passBins: [1], waferConfig: { notch: { type: 'right' } } });
          var bsCtrl = renderWaferMap(el, bsResult, {
            showTooltip: true,
            viewOptions: { plotMode: 'hardBin' },
            onSelect: function () { /* host app would show selection stats here */ },
          });
          // Highlight a 3×3 block near the centre as an illustrative initial selection.
          var preSel = bsResult.dies.filter(function (d) {
            return d.x >= -1 && d.x <= 1 && d.y >= -1 && d.y <= 1;
          });
          if (bsCtrl && bsCtrl.setSelection) bsCtrl.setSelection(preSel);

        } else if (id === 'summary-panel') {
          // Full summary panel, opened by default, on a wafer with bins + test
          // values so yield, bin breakdown, and per-test stats are all populated.
          var spResult = buildWaferMap({ results: results, hbinDefs: hbinDefs, testDefs: testDefs, passBins: [1], waferConfig: { notch: { type: 'right' } } });
          var spSummary = analyzeWaferMap ? analyzeWaferMap(spResult) : null;
          renderWaferMap(el, spResult, {
            showTooltip: true,
            viewOptions: { plotMode: 'hardBin' },
            statsSummary: spSummary || undefined,
            summaryPanel: { defaultOpen: true },
          });

        } else if (id === 'reticle') {
          var reticleResult = buildWaferMap({
            results: results, hbinDefs: hbinDefs, passBins: [1],
            reticleConfig: { width: 3, height: 2, anchorDie: { x: -1, y: 0 } },
          });
          renderWaferMap(el, reticleResult, {
            showToolbar: false, showTooltip: true,
            viewOptions: { plotMode: 'hardBin', showReticle: true }
          });
        }
      } catch (e) {
        console.warn('wmap guide demo failed:', id, e);
      }
    }
  }

  // Expose for callers — __wmapDemoApi must be set before calling:
  // - Modal (renderWaferMap.ts): sets __wmapDemoApi then calls __wmapPopulateGuideDemos(guideEl)
  // - Docs site (guide-demos-init.js): sets __wmapDemoApi then calls __wmapPopulateGuideDemos(document)
  window.__wmapPopulateGuideDemos = populateGuideDemos;
})();
