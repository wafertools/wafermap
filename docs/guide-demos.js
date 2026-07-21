// Inline demo script for the embedded user guide window.
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

    // Every renderWaferMap/renderWaferGallery call below returns a controller
    // with its own ResizeObserver + matchMedia listeners. Collect every handle
    // so the caller (toolbar.ts's guide close paths) can destroy() them all —
    // otherwise they leak for the lifetime of the host page whenever the guide
    // is shown as an in-page overlay rather than a real popup (the popup path
    // masks the leak by tearing down its own window/realm on close).
    var handles = [];

    for (var i = 0; i < demos.length; i++) {
      var el = demos[i];
      var id = el.dataset.wmapDemo;
      try {
        if (id === 'value-heatmap') {
          handles.push(renderWaferMap(el, valueResult, {
            showToolbar: false, showTooltip: true,
            viewOptions: { plotMode: 'value', activeTest: 1 }
          }));

        } else if (id === 'spec-passfail') {
          handles.push(renderWaferMap(el, valueResult, {
            showToolbar: false, showTooltip: true,
            viewOptions: { plotMode: 'value', activeTest: 1, passFailDisplay: 'spec' }
          }));

        } else if (id === 'bin-highlight') {
          // Show bin 2 highlighted (dimmed all others) so the feature is visible without interaction.
          handles.push(renderWaferMap(el, binResult, {
            showToolbar: false, showTooltip: true,
            viewOptions: { plotMode: 'hardBin', highlightBin: 2 }
          }));

        } else if (id === 'bin-map') {
          // basic hardbin map with no toolbar, just the wafer display.
          handles.push(renderWaferMap(el, binResult, {
            showToolbar: false, showTooltip: true,
            viewOptions: { plotMode: 'hardBin', showXYIndicator: true }
          }));

        } else if (id === 'orientation') {
          // Show the wafer rotated 90° so the notch is clearly on the left side,
          // illustrating that the display orientation can be adjusted.

          handles.push(renderWaferMap(el, binResult, {
            showToolbar: false, showTooltip: true,
            viewOptions: { plotMode: 'hardBin', rotation: 90, showXYIndicator: true }
          }));

        } else if (id === 'overlays') {
          // Show ring boundaries, quadrant lines, and XY indicator all active.
          handles.push(renderWaferMap(el, binResult, {
            showToolbar: false, showTooltip: true,
            viewOptions: {
              plotMode: 'hardBin',
              showRingBoundaries: true,
              showQuadrantBoundaries: true,
              showXYIndicator: true,
            }
          }));

        } else if (id === 'gallery') {
          if (!renderWaferGallery) {
            // Expected, not a bug: a guide opened from a single-wafer host
            // (renderWaferMap.ts's openGuideWindow) deliberately omits
            // renderWaferGallery to avoid a circular import between the two
            // render entry points — see its own doc comment. Skip this one
            // demo rather than falling into the catch below and logging a
            // scary "failed" warning for an intentional gap.
            continue;
          }
          var items = [0, 1, 2, 3].map(function (n) {
            var r = buildWaferMap({ results: makeDemoWafer(6 + n), hbinDefs: hbinDefs, passBins: [1] });
            return Object.assign({}, r, { label: 'Wafer ' + (n + 1) });
          });
          handles.push(renderWaferGallery(el, items));

        } else if (id === 'findings') {
          // Build a wafer with a strong edge-ring failure pattern so findings are guaranteed.
          var edgeResults = makeEdgeFailWafer(7);
          var edgeResult = buildWaferMap({ results: edgeResults, hbinDefs: hbinDefs, passBins: [1] });
          var summary = analyzeWaferMap ? analyzeWaferMap(edgeResult) : null;
          handles.push(renderWaferMap(el, edgeResult, {
            showToolbar: true, showTooltip: true,
            viewOptions: { plotMode: 'hardBin' },
            statsSummary: summary || undefined,
            findings: summary ? { defaultOpen: true } : undefined,
          }));

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
          handles.push(renderWaferMap(el, stackResult, {
            showToolbar: false, showTooltip: true,
            viewOptions: { plotMode: 'stackedBins' }
          }));

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
          handles.push(bsCtrl);
          // Highlight a 3×3 block near the centre as an illustrative initial selection.
          var preSel = bsResult.dies.filter(function (d) {
            return d.x >= -1 && d.x <= 1 && d.y >= -1 && d.y <= 1;
          });
          if (bsCtrl && bsCtrl.setSelection) bsCtrl.setSelection(preSel);

        } else if (id === 'summary-panel') {
          // Full summary panel, opened by default, on a wafer with bins + test
          // values so yield, bin breakdown, and per-test stats are all populated.
          var spResult = buildWaferMap({ results: results, hbinDefs: hbinDefs, testDefs: testDefs, passBins: [1], waferConfig: { notch: { type: 'right' } } });
          // computePerTestStats: true adds the cheap per-test value summary to the
          // panel without the heavier regional test-value findings pass.
          var spSummary = analyzeWaferMap ? analyzeWaferMap(spResult, { computePerTestStats: true }) : null;
          handles.push(renderWaferMap(el, spResult, {
            showTooltip: true,
            viewOptions: { plotMode: 'hardBin' },
            statsSummary: spSummary || undefined,
            summaryPanel: { defaultOpen: true },
          }));

        } else if (id === 'analysis') {
          // renderWaferGallery is NOT necessarily available here — a guide
          // window opened from a single-map host (renderWaferMap.ts) passes
          // renderWaferGallery: undefined to avoid a circular import, so this
          // demo (unlike 'gallery' above) must use renderWaferMap, which is
          // always present regardless of which host opened the guide.
          //
          // Two parametric tests (one with spec limits, so capability has
          // something to plot) so distributions/capability/correlation/
          // scatter all have real data to show, alongside yield/bin pareto.
          var analysisTestDefs = [
            { testNumber: 1, name: 'Idsat', unit: 'A', limitLow: 1.5, limitHigh: 8.5 },
            { testNumber: 2, name: 'Vth', unit: 'V' },
          ];
          function makeAnalysisWafer(seed) {
            var r = 7, out = [];
            for (var x = -r; x <= r; x++) {
              for (var y = -r; y <= r; y++) {
                if (Math.sqrt(x * x + y * y) > r + 0.5) continue;
                out.push({
                  x: x, y: y,
                  hbin: (Math.abs(x * 3 + y * 7 + seed) % 10 < 2) ? 2 : 1,
                  testValues: {
                    1: +((x * 0.5 + y * 0.3 + 5 + seed * 0.2).toFixed(3)),
                    2: +((x * -0.2 + y * 0.4 + 2 + seed * 0.1).toFixed(3)),
                  },
                });
              }
            }
            return out;
          }
          var analysisResult = buildWaferMap({ results: makeAnalysisWafer(0), hbinDefs: hbinDefs, testDefs: analysisTestDefs, passBins: [1] });
          handles.push(renderWaferMap(el, analysisResult, {
            insights: { enabled: true },
            viewOptions: { plotMode: 'hardBin' },
          }));
          // Open the Insights tab by default — same click a user would make,
          // just pre-triggered so the feature is visible without interaction.
          var analysisBtn = el.querySelector('button[aria-label="Insights"]');
          if (analysisBtn) analysisBtn.click();

        } else if (id === 'reticle') {
          var reticleResult = buildWaferMap({
            results: results, hbinDefs: hbinDefs, passBins: [1],
            reticleConfig: { width: 3, height: 2, anchorDie: { x: -1, y: 0 } },
          });
          handles.push(renderWaferMap(el, reticleResult, {
            showToolbar: false, showTooltip: true,
            viewOptions: { plotMode: 'hardBin', showReticle: true }
          }));
        }
      } catch (e) {
        console.warn('wmap guide demo failed:', id, e);
      }
    }

    // Exposed so the guide's close paths (toolbar.ts openGuideInFloatingWindow/
    // openGuideInPopup) can tear every demo down — see the `handles` comment
    // above. Guarded by identity (like __wmapDemoApi's restoreApi below) so a
    // stale/delayed close (e.g. the popup-closed poll firing after a rapid
    // reopen already overwrote this) can't destroy a newer instance's demos.
    var destroyer = function () {
      if (window.__wmapDestroyGuideDemos === destroyer) window.__wmapDestroyGuideDemos = null;
      for (var j = 0; j < handles.length; j++) {
        try { handles[j] && handles[j].destroy && handles[j].destroy(); } catch (e) { /* best-effort teardown */ }
      }
      handles = [];
    };
    window.__wmapDestroyGuideDemos = destroyer;
  }

  // Expose for callers — __wmapDemoApi must be set before calling:
  // - Guide window (toolbar.ts openUserGuideWindow): sets __wmapDemoApi then calls __wmapPopulateGuideDemos(guideEl)
  // - Docs site (guide-demos-init.js): sets __wmapDemoApi then calls __wmapPopulateGuideDemos(document)
  window.__wmapPopulateGuideDemos = populateGuideDemos;
})();
