/**
 * Capture definitions — add new screenshots here.
 *
 * Each entry:
 *   page          — path under /docs/ (served as /path)
 *   file          — output filename in docs/images/ (no extension)
 *   selector      — CSS selector to screenshot (omit for full viewport)
 *   group         — logical group name (for --only filtering)
 *   wait          — extra ms to wait after network idle (for heavy renders)
 *   viewport      — { width, height } override (default 1280×800)
 *   setup         — array of step tuples, run in order before the screenshot
 *                   see the step reference in capture-screenshots.mjs header
 *   screenshotFn  — async (page, outFile) => {} for fully custom capture logic
 *
 * Image names are descriptive slugs — guide-<topic>.png for guide screenshots,
 * hero-<topic>.png for the homepage, report-<topic>.png for report popups.
 * Avoid numeric suffixes; use a second descriptive word instead (e.g. guide-bins-legend-filter).
  * Add new entries to CAPTURES to register additional screenshots.
 *
 * ─── Setup step reference ────────────────────────────────────────────────────
 *
 * setup is an array of steps. Each step is an array: [stepName, ...args].
 * The optional second element on most steps is a containerSel CSS selector
 * (defaults to '#map' when omitted).
 *
 *   ['hover']                               hover canvas centre, pin toolbar
 *   ['hover', '#my-map']
 *
 *   ['hoverEl', 'Colorbar range: spec limits (click for data range)']   hover any element by aria-label or CSS selector, pin toolbar
 *   ['hoverEl', 'Plot mode', '#my-map']    …with explicit container for toolbar pin
 *
 *   ['openPanel']                           open the summary/findings panel
 *   ['openPanel', '#my-map']
 *
 *   ['closePanel']                          close the summary/findings panel if open
 *   ['closePanel', '#my-map']
 *
 *   ['clickFinding']                        click the first finding row
 *   ['clickFinding', '#my-map']
 *
 *   ['clickFindingByText', 'Failure cluster']   click the first finding whose text contains string
 *   ['clickFindingByText', 'Failure cluster', '#my-map']
 *
 *   ['boxSelect']                           activate box-select, drag rect, leave mouse held
 *   ['boxSelect', '#my-map']                (release mouse with ['mouseUp'] to commit selection)
 *
 *   ['mouseUp']                             release the mouse button (after boxSelect)
 *
 *   ['selectDropdown', 'Legend style', 'Bottom']  pick from any single-select dropdown
 *   ['selectMode', 'Soft Bin']              shorthand for selectDropdown on 'Plot mode'
 *   ['selectColumns', '3 columns']          shorthand for selectDropdown on 'Columns'
 *
 *   ['toggleOverlay', 'Ring boundaries']    toggle a check-menu overlay item (menu stays open)
 *   ['toggleOverlay', 'Ring boundaries', 'Overlays']          custom button aria-label
 *   ['toggleOverlay', 'Flip horizontal',   'Orientation']
 *   — always follow with ['closeDropdown'] then ['hover'] when done toggling
 *
 *
 *   ['openDropdown', 'Plot mode']           open a dropdown and leave it open (for UI shots)
 *   ['openDropdown', 'Plot mode', 'Soft Bin']        …with an item highlighted
 *   ['openDropdown', 'Plot mode', 'Soft Bin', '#my-map']
 *
 *   ['closeDropdown']                       dismiss any open dropdown (Escape + edge click)
 *   ['closeDropdown', '#my-map']
 *
 *   ['clickLegendRow', 2, 4]              click row 2 of a 4-row right-side legend (toggles highlightBin)
 *   ['clickLegendRow', 2, 4, '#my-map']
 *
 *   ['showCursorOn', 'Legend style']        inject fake cursor centred on element by aria-label or CSS selector
 *   ['showCursorOn', 'Legend style', -60, 0]   …with optional pixel nudge (offsetX, offsetY)
 *   ['showCursorOn', '.my-btn']            …by CSS selector
 *   ['showCursorOn', '[data-wmap-dropdown-value="teal-rose"]']   …on a dropdown item by its value (toolbar dropdowns only)
 *   ['showCursorOn', '[data-wmap-finding-active]']               …on the currently active finding row in the panel
 *   ['hideCursor']                          remove the fake cursor
 *
 *   ['hoverFirstCard', '#gallery-container']  hover the first gallery card canvas
 *
 *   ['wait', 400]                           extra delay in ms
 *   ['scroll', 0, 0]                        window.scrollTo(x, y)
 *
 * ─── Valid item labels ────────────────────────────────────────────────────────
 *
 * selectMode (Plot mode dropdown):
 *   'Test Value'  'Hard Bin'  'Soft Bin'
 *   'Stacked Test Values'  'Stacked Hard Bins'  'Stacked Soft Bins'
 *
 * toggleOverlay (Overlays dropdown, default btn):
 *   'Ring boundaries'  'Quadrant lines'  'Die labels'
 *   'Reticle grid'     'XY indicator'    'Spec pass/fail'
 *
 * toggleOverlay (Orientation dropdown, btn = 'Orientation'):
 *   'Rotate 90° clockwise'  'Flip horizontal'  'Flip vertical'
 *
 * selectColumns (gallery toolbar Columns dropdown):
 *   'Auto'  '1 column'  '2 columns'  '3 columns'  '4 columns'  '5 columns'
 * ─────────────────────────────────────────────────────────────────────────────
 */

export const CAPTURES = [

  // ── hero-test-values.png — homepage hero: Idsat heatmap with colorbar + toolbar ─
  {
    file: 'hero-test-values',
    group: 'maps',
    page: '/examples/test-values.html',
    selector: '.demo-page',
    wait: 800,
    setup: [['hover'], ['showCursorOn', '#map canvas', -120, -100]],
  },

  // ── guide-intro-interaction.png — guide intro: interaction demo showing map + sidebar ─
  {
    file: 'guide-intro-interaction',
    group: 'maps',
    page: '/examples/interaction.html',
    selector: '.demo-content',
    wait: 800,
    setup: [['hover'], ['showCursorOn', '#map canvas', -120, -100]],
  },

  // ── quickstart-first-map.png — quickstart example: edge-ring pattern ────────
  {
    file: 'quickstart-first-map',
    group: 'maps',
    page: '/examples/first-map.html',  // reuse the demo page infrastructure
    wait: 800,
    screenshotFn: async (page, outFile) => {
      // Inject the quickstart inline data directly, replacing the demo's result
      await page.evaluate(() => {
        return new Promise(resolve => {
          // Wait for the map to already be rendered, then swap the data
          const results = [];
          for (let x = -14; x <= 14; x++) {
            for (let y = -14; y <= 14; y++) {
              const r = Math.sqrt(x * x + y * y);
              if (r > 14.3) continue;
              const h = ((Math.imul(x + 100, 2654435761) ^ Math.imul(y + 100, 2246822519)) >>> 0);
              const edgeFail = r > 11 && (h % 100) < 55;
              results.push({ x, y, hbin: edgeFail ? 2 : 1 });
            }
          }
          window.__quickstartResults = results;
          resolve();
        });
      });
      // Reinitialise by navigating to a data-URL that uses the local importmap
      // Instead: render directly using the page's already-loaded modules
      await page.evaluate(async () => {
        const { buildWaferMap }  = await import('wafermap');
        const { renderWaferMap } = await import('wafermap/render');
        const container = document.getElementById('map');
        container.innerHTML = '';
        const result = buildWaferMap({ results: window.__quickstartResults, passBins: [1] });
        renderWaferMap(container, result);
      });
      await page.waitForTimeout(600);
      const el = await page.$('.canvas-card');
      await el.screenshot({ path: outFile });
    },
  },

  // ── guide-first-map.png — §2 Your first wafer map ───────────────────────────
  {
    file: 'guide-first-map',
    group: 'maps',
    page: '/examples/first-map.html',
    selector: '.demo-content',
    wait: 800,
    setup: [['hover'], ['showCursorOn', '#map canvas', -150, -100]],
  },

  // ── guide-csv-ring-boundaries.png — §3 Loading CSV data: map + ring boundaries ─
  {
    file: 'guide-csv-ring-boundaries',
    group: 'maps',
    page: '/examples/csv-data.html',
    selector: '.demo-content',
    wait: 600,
    setup: [['toggleOverlay', 'Ring boundaries'],
    ['toggleOverlay', 'XY indicator'],
    ['showCursorOn', 'Overlays', 90, 120]],
  },

  // ── guide-geometry-inference.png — §4 Geometry: four maps showing inference levels ─
  {
    file: 'guide-geometry-inference',
    group: 'maps',
    page: '/examples/geometry.html',
    selector: '.demo-content',
    wait: 1200,
    setup: [['showCursorOn', '#map-b', -70, -50], ['hover', '#map-b']],
  },

  // ── guide-geometry-partial-data.png — §4 Partial data: partial-wrong / partial-anchored / sparse-ok ─
  {
    file: 'guide-geometry-partial-data',
    group: 'maps',
    page: '/examples/partial-data.html',
    selector: '.demo-content',
    wait: 1200,
  },

  // ── guide-bins-named.png — §5 Bins: named bin map with legend ───────────────
  {
    file: 'guide-bins-named',
    group: 'maps',
    page: '/examples/named-bins.html',
    selector: '.demo-content',
    wait: 800,
    setup: [['hover'], ['showCursorOn', '#map canvas', -120, -100]],
  },

  // ── guide-bins-legend-filter.png — §5 Legend bin filter: bin 2 highlighted, rest dimmed ─
  {
    file: 'guide-bins-legend-filter',
    group: 'maps',
    page: '/examples/named-bins.html',
    selector: '.demo-content',
    wait: 800,
    setup: [
      ['closePanel'],
      ['clickLegendRow', 2, 4],
      ['showCursorOn', '#map canvas', 500, -9],
    ],
  },

  // ── guide-test-values-colorbar.png — §6 Test values: heatmap + colorbar ────────
  {
    file: 'guide-test-values-colorbar',
    group: 'maps',
    page: '/examples/test-values.html',
    selector: '.demo-content',
    wait: 800,
    setup: [['hoverEl', 'Colorbar range: spec limits (click for data range)'],
    ['showCursorOn', 'Colorbar range: spec limits (click for data range)']],
  },
  // ── guide-test-values-spec-passfail.png — §6 Test values: spec pass/fail colouring ─
  {
    file: 'guide-test-values-spec-passfail',
    group: 'maps',
    page: '/examples/test-values.html',
    selector: '.demo-content',
    wait: 800,
    setup: [['toggleOverlay', 'Spec pass/fail'], ['showCursorOn', 'Overlays', 90, 140]],
  },

  // ── guide-retests.png — §7 Retests: map + retested-die list sidebar ─────────
  {
    file: 'guide-retests',
    group: 'maps',
    page: '/examples/retests.html',
    selector: '.demo-content',
    wait: 800,
    setup: [['hover']],
  },

  // ── guide-display-rotated-rings.png — §8 Display control: rotated + ring boundaries ─
  {
    file: 'guide-display-rotated-rings',
    group: 'maps',
    page: '/examples/display-control.html',
    selector: '.demo-content',
    wait: 800,
    setup: [
      ['toggleOverlay', 'Ring boundaries'],
      ['closeDropdown'],
      ['toggleOverlay', 'Rotate 90° clockwise', 'Orientation'],
      ['closeDropdown'],
      ['toggleOverlay', 'XY indicator'],
      ['closeDropdown'],
      ['showCursorOn', '#ext-rings']
    ],
  },

  // ── guide-display-legend-style-menu.png — §8 Display control: legend style dropdown open ─
  {
    file: 'guide-display-legend-style-menu',
    group: 'maps',
    page: '/examples/named-bins.html',
    selector: '#map',
    wait: 800,
    setup: [
      ['closePanel'],
      ['selectDropdown', 'Legend style', 'Floating'],
      ['wait', 400],
      ['openDropdown', 'Legend style'],
      ['showCursorOn', 'Legend style', 4, 180],
    ],
  },


  // ── guide-interaction-box-select.png — §9 Interaction: box-select drag with dies highlighted ─
  {
    file: 'guide-interaction-box-select',
    group: 'maps',
    page: '/examples/interaction.html',
    selector: '.demo-content',
    wait: 800,
    setup: [
      ['boxSelect'],
      ['mouseUp'],
      ['showCursorOn', '#map', 150, 70],
    ],
  },

  // ── guide-findings-panel.png — §10 Findings: map + panel with first finding selected ─
  {
    file: 'guide-findings-panel',
    group: 'maps',
    page: '/examples/findings.html',
    selector: '.demo-content',
    wait: 1500,
    setup: [
      ['openPanel'],
      ['clickFinding'],
      ['showCursorOn', '[data-wmap-finding-active]']
    ],
  },

  // ── guide-summary-panel.png — §11 Summary panel: single map with panel open ──
  {
    file: 'guide-summary-panel',
    group: 'maps',
    page: '/examples/summary-panel.html',
    selector: '#single-map-wrap',
    wait: 1000,
    setup: [
      ['openPanel', '#single-map'],
      ['hoverEl', 'Summary panel'],
      ['showCursorOn', 'Summary panel'],
    ],
  },

  // ── guide-gallery-per-wafer.png — §12 Gallery: card grid per-wafer with hover ─
  {
    file: 'guide-gallery-per-wafer',
    group: 'gallery',
    page: '/examples/gallery.html',
    selector: '#gallery-container',
    wait: 2000,
    setup: [['hoverFirstCard', '#gallery-container'], ['selectColumns', '3 columns']],
  },

  // ── guide-lot-findings-gallery.png — §13 Lot findings: gallery + lot summary panel ─
  {
    file: 'guide-lot-findings-gallery',
    group: 'gallery',
    page: '/examples/lot-findings.html',
    selector: '.demo-content',
    wait: 2000,
    setup: [
      ['selectColumns', '3 columns'],
      ['openPanel', '#gallery-container'],
      ['wait', 400],
      ['clickFinding', '#gallery-container'],
      ['showCursorOn', '[data-wmap-finding-active]']
    ],
  },

  // ── report-wafer-summary.png — §13 Wafer summary report (popup from panel button) ─
  {
    file: 'report-wafer-summary',
    group: 'maps',
    page: '/examples/summary-panel.html',
    wait: 1000,
    screenshotFn: async (page, outFile) => {
      // Open the summary panel
      await page.evaluate(() => {
        const btn = [...document.querySelectorAll('button')]
          .find(b => b.ariaLabel === 'Summary panel');
        if (btn && !btn.dataset.active) btn.click();
      });
      await page.waitForTimeout(600);

      // Click "Summary report" and capture the popup
      const popupPromise = page.context().waitForEvent('page');
      await page.evaluate(() => {
        const btn = [...document.querySelectorAll('button')]
          .find(b => b.textContent?.trim() === 'Summary report');
        if (btn) btn.click();
      });
      const popup = await popupPromise;
      await popup.waitForLoadState('domcontentloaded');
      await popup.waitForTimeout(400);
      await popup.screenshot({ path: outFile, fullPage: false });
    },
  },

  // ── report-lot-summary.png — §13 Lot summary report (popup from lot panel button) ─
  {
    file: 'report-lot-summary',
    group: 'gallery',
    page: '/examples/lot-findings.html',
    wait: 2000,
    screenshotFn: async (page, outFile) => {
      // Panel opens by default (defaultOpen: true in this demo).
      // Ensure we're at lot-level view — click the gallery-bar Summary panel button
      // which is scoped to [data-wmap-toolbar="gallery"].
      await page.evaluate(() => {
        const galleryBar = document.querySelector('[data-wmap-toolbar="gallery"]');
        const btn = galleryBar && [...galleryBar.querySelectorAll('button')]
          .find(b => b.ariaLabel === 'Summary panel');
        if (btn && !btn.dataset.active) btn.click();
      });
      await page.waitForTimeout(600);

      // Find the visible summary panel (the lot-level one is open by default).
      // It's the panel whose display is not 'none' and which is not inside a card.
      const popupPromise = page.context().waitForEvent('page');
      await page.evaluate(() => {
        // The lot summary panel is not inside a .wmap-gallery-card
        const btn = [...document.querySelectorAll('button')]
          .find(b =>
            b.textContent?.trim() === 'Summary report' &&
            !b.closest('.wmap-gallery-card')
          );
        if (btn) btn.click();
      });
      const popup = await popupPromise;
      await popup.waitForLoadState('domcontentloaded');
      await popup.waitForTimeout(400);
      await popup.screenshot({ path: outFile, fullPage: false });
    },
  },

  // ── guide-findings-cluster-highlight.png — §10 Cluster highlight: specific dies lit amber ─
  {
    file: 'guide-findings-cluster-highlight',
    group: 'maps',
    page: '/examples/findings.html',
    selector: '.demo-content',
    wait: 1500,
    setup: [
      ['openPanel'],
      ['wait', 400],
      ['clickFindingByText', 'Failure cluster'],
      ['showCursorOn', '[data-wmap-finding-active]']
    ],
  },

  // ── guide-gallery-stacked-bins.png — §12 Stacked Hard Bins gallery: one card per bin ─
  {
    file: 'guide-gallery-stacked-bins',
    group: 'gallery',
    page: '/examples/gallery.html',
    selector: '#gallery-container',
    wait: 2000,
    setup: [
      ['selectColumns', '2 columns'],
      ['selectMode', 'Stacked Hard Bins'],
      ['wait', 800],
      ['openDropdown', 'Plot mode'],
      ['showCursorOn', 'Stacked Hard Bins', 10, 10],
    ],
  },

  // ── guide-reticle-overlay.png — §14 Reticle overlays: map + reticle summary panel ─
  {
    file: 'guide-reticle-overlay',
    group: 'maps',
    page: '/examples/reticle.html',
    selector: '.demo-content',
    wait: 1000,
    setup: [['toggleOverlay', 'Reticle grid'], ['toggleOverlay', 'Reticle grid'], 
    ['showCursorOn', 'Overlays', 90, 120]],

  },

  // ── guide-test-sites.png — §15 Multi-site parallel testing: map + site stats ──
  {
    file: 'guide-test-sites',
    group: 'maps',
    page: '/examples/test-sites.html',
    selector: '.demo-content',
    wait: 1000,
    setup: [['hover'], ['showCursorOn', '#map canvas', -120, -100]],
  },

  // ── guide-color-schemes.png — §16 Colour schemes: three wafers side by side ──
  {
    file: 'guide-color-schemes',
    group: 'maps',
    page: '/examples/color-schemes.html',
    selector: '.scheme-grid',
    wait: 1200,
    setup: [
      ['hover', '#map-custom'],
      ['openDropdown', 'Colour scheme', undefined, '#map-custom'],
      ['showCursorOn', '[data-wmap-dropdown-value="teal-rose"]', 10, 10],
    ]
  },

  // // ── CSV showcase ──────────────────────────────────────────────────────────────
  // {
  //   file: 'csv',
  //   group: 'showcase',
  //   page: '/examples/showcase.html',
  //   selector: '#phase-upload',
  //   wait: 600
  // },

  // ── Toolbar strips ────────────────────────────────────────────────────────────

  // toolbar-single: hover to reveal toolbar then screenshot just the toolbar bar
  {
    file: 'toolbar-single',
    group: 'toolbar',
    page: '/examples/first-map.html',
    selector: '[data-wmap-toolbar="single"]',
    wait: 800,
    viewport: { width: 1280, height: 800 },
    setup: [['hover']],
  },

  // toolbar-gallery: screenshot the gallery toolbar bar
  {
    file: 'toolbar-gallery',
    group: 'toolbar',
    page: '/examples/gallery.html',
    wait: 2000,
    viewport: { width: 1450, height: 900 },
    selector: '[data-wmap-toolbar="gallery"]',
  },

  // ── Misc ─────────────────────────────────────────────────────────────────────

  // comparison: run benchmark (bins scenario) and screenshot the result
  {
    file: 'comparison',
    group: 'misc',
    page: '/examples/comparison.html',
    selector: 'body',
    wait: 500,
    viewport: { width: 1280, height: 900 },
    setup: [
      ['wait', 200],
    ],
  },
];
