/**
 * Capture definitions — add new screenshots here.
 *
 * NOT shared with ../tsmap/scripts/capture-definitions.mjs, and never should be:
 * this file is data, not logic — the list of pages and UI states to shoot for
 * *this* project. The same-named file over there describes tsmap's overlays.
 * Only their harness (capture-screenshots.mjs) has anything in common.
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
 *   ['hoverEl', 'Colour bar range: test limits (click for data range)']   hover any element by aria-label or CSS selector, pin toolbar
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
 *   'Reticle grid'     'XY indicator'    'Limit pass/fail'
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

  // ── guide-drilldown-*.png — §4.4 Charting dies and wafers ─────────────────
  // A box-selected cluster on the first gallery card of the sweeps demo, the
  // right-click menu over it, then the histogram it opens. Drawn by the real
  // UI with the real mouse gestures, so the picture cannot show a menu the
  // library does not build.
  {
    file: 'guide-drilldown-menu',
    group: 'drilldown',
    page: '/examples/sweeps.html',
    wait: 1500,
    viewport: { width: 1280, height: 900 },
    screenshotFn: async (page, outFile) => {
      await page.locator('[data-wmap-view="maps"]').first().click();
      await page.waitForTimeout(800);
      const canvas = page.locator('#gallery canvas').first();
      await canvas.scrollIntoViewIfNeeded();
      const b = await canvas.boundingBox();
      await page.getByRole('button', { name: 'Select (drag to select dies)' }).first().click();
      await page.mouse.move(b.x + b.width * 0.30, b.y + b.height * 0.30);
      await page.mouse.down();
      await page.mouse.move(b.x + b.width * 0.48, b.y + b.height * 0.48, { steps: 8 });
      await page.mouse.up();
      await page.mouse.click(b.x + b.width * 0.40, b.y + b.height * 0.40, { button: 'right' });
      await page.waitForSelector('[data-wmap-drilldown-menu]');
      // Onto the menu's first row, as a user reaching for it would: that also
      // takes the pointer off the map, so no die tooltip sits over the picture.
      await page.locator('[data-wmap-drilldown-menu] [role="menuitem"]').first().hover();
      await page.waitForTimeout(300);
      const menu = await page.locator('[data-wmap-drilldown-menu]').boundingBox();
      const card = await canvas.locator('xpath=ancestor::div[.//button[@data-wmap-expand-btn]][1]').boundingBox();
      const x = Math.min(card.x, menu.x) - 8, y = Math.min(card.y, menu.y) - 8;
      await page.screenshot({ path: outFile, clip: {
        x, y,
        width:  Math.max(card.x + card.width, menu.x + menu.width) - x + 8,
        height: Math.max(card.y + card.height, menu.y + menu.height) - y + 8,
      } });
    },
  },
  {
    file: 'guide-drilldown-chart',
    group: 'drilldown',
    page: '/examples/sweeps.html',
    wait: 1500,
    viewport: { width: 1280, height: 900 },
    screenshotFn: async (page, outFile) => {
      await page.locator('[data-wmap-view="maps"]').first().click();
      await page.waitForTimeout(800);
      const canvas = page.locator('#gallery canvas').first();
      await canvas.scrollIntoViewIfNeeded();
      const b = await canvas.boundingBox();
      await page.getByRole('button', { name: 'Select (drag to select dies)' }).first().click();
      await page.mouse.move(b.x + b.width * 0.30, b.y + b.height * 0.30);
      await page.mouse.down();
      await page.mouse.move(b.x + b.width * 0.48, b.y + b.height * 0.48, { steps: 8 });
      await page.mouse.up();
      await page.mouse.click(b.x + b.width * 0.40, b.y + b.height * 0.40, { button: 'right' });
      await page.locator('[data-wmap-drilldown-menu] [role="menuitem"]', { hasText: 'Value histogram' }).click();
      await page.waitForTimeout(1200);
      await page.locator('.wmap-overlay-box').first().screenshot({ path: outFile });
    },
  },

  // ── quickstart-first-map.png — quickstart example: edge-ring pattern ────────
  {
    file: 'quickstart-first-map',
    group: 'maps',
    page: '/examples/first-map.html',  // reuse the demo page infrastructure
    wait: 800,
    screenshotFn: async (page, outFile) => {
      // Render the Quick Start's own lot on the demo page's already-loaded
      // modules. The data comes from examples/quickstart-data.js — the same
      // fixture the live page imports and the Markdown example is checked
      // against — so this screenshot cannot show a different wafer from the
      // code above it in the docs. It used to hold a fourth copy of the
      // generator inlined right here, which is exactly how that drifts.
      await page.evaluate(async () => {
        const { quickstartResults } = await import('./quickstart-data.js');
        const { buildWaferMap }  = await import('wafermap');
        const { renderWaferMap } = await import('wafermap/render');
        const container = document.getElementById('map');
        container.innerHTML = '';
        const result = buildWaferMap({ results: quickstartResults, passBins: [1] });
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
    page: '/examples/geometry.html#centre-anchoring',
    // The page also carries the four inference-level cards above; .canvas-grid-3
    // is the centre-anchoring row alone.
    selector: '.canvas-grid-3',
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
    setup: [['hoverEl', 'Colour bar range: test limits (click for data range)'],
    ['showCursorOn', 'Colour bar range: test limits (click for data range)']],
  },
  // ── guide-test-values-spec-passfail.png — §6 Test values: spec pass/fail colouring ─
  {
    file: 'guide-test-values-spec-passfail',
    group: 'maps',
    page: '/examples/test-values.html',
    selector: '.demo-content',
    wait: 800,
    setup: [['toggleOverlay', 'Limit pass/fail'], ['showCursorOn', 'Overlays', 90, 140]],
  },

  // ── guide-test-values-functional.png — §6 Functional tests: Continuity forced into Test pass/fail ─
  {
    file: 'guide-test-values-functional',
    group: 'maps',
    page: '/examples/test-values.html',
    selector: '.demo-content',
    wait: 800,
    screenshotFn: async (page, outFile) => {
      // Select the functional Continuity test (1080) via the external selector —
      // the library forces passFailDisplay: 'test' since it has no measured value.
      await page.evaluate(() => {
        const sel = document.getElementById('sel-test');
        sel.value = '1080';
        sel.dispatchEvent(new Event('change'));
      });
      await page.waitForTimeout(500);
      const el = await page.$('.demo-content');
      await el.screenshot({ path: outFile });
    },
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

  // ── guide-validity-limits.png — §7 Validity limits: clamps excluded, scale and statistics from real readings ─
  {
    file: 'guide-validity-limits',
    group: 'maps',
    page: '/examples/validity-limits.html',
    selector: '.demo-content',
    wait: 1000,
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
    page: '/examples/statistics.html#findings',
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
    page: '/examples/statistics.html#summary-panel',
    selector: '#stage',
    wait: 1000,
    setup: [
      ['openPanel', '#wmap-host'],
      ['hoverEl', 'Summary panel'],
      ['showCursorOn', 'Summary panel'],
    ],
  },

  // ── guide-gallery-per-wafer.png — §12 Gallery: card grid per-wafer with hover ─
  {
    file: 'guide-gallery-per-wafer',
    group: 'gallery',
    page: '/examples/statistics.html#lot-gallery',
    selector: '#wmap-host',
    wait: 2000,
    setup: [['hoverFirstCard', '#wmap-host'], ['selectColumns', '3 columns']],
  },

  // ── guide-insights-overview.png — §8 Insights: gallery Overview sub-tab ──
  {
    file: 'guide-insights-overview',
    group: 'insights',
    page: '/examples/statistics.html#lot-gallery',
    selector: '#wmap-host',
    wait: 2000,
    setup: [
      ['clickTab', 'Insights', '#wmap-host'],
      ['wait', 800],
    ],
  },

  // ── guide-insights-distributions.png — §8 Insights: Distributions sub-tab ──
  {
    file: 'guide-insights-distributions',
    group: 'insights',
    page: '/examples/statistics.html#lot-gallery',
    selector: '#wmap-host',
    wait: 2000,
    setup: [
      ['clickTab', 'Insights', '#wmap-host'],
      ['clickTab', 'Distributions', '#wmap-host'],
      ['wait', 800],
    ],
  },

  // ── guide-insights-correlation.png — §8 Insights: Correlation sub-tab ──
  {
    file: 'guide-insights-correlation',
    group: 'insights',
    page: '/examples/statistics.html#lot-gallery',
    selector: '#wmap-host',
    wait: 2000,
    setup: [
      ['clickTab', 'Insights', '#wmap-host'],
      ['clickTab', 'Correlation', '#wmap-host'],
      ['wait', 800],
    ],
  },

  // ── guide-insights-data.png — §8 Insights: Data sub-tab (Statistics | Dies | Wafers) ──
  {
    file: 'guide-insights-data',
    group: 'insights',
    page: '/examples/statistics.html#lot-gallery',
    selector: '#wmap-host',
    wait: 2000,
    setup: [
      ['clickTab', 'Insights', '#wmap-host'],
      ['clickTab', 'Data', '#wmap-host'],
      ['wait', 800],
    ],
  },

  // ── The Plot tab (§8): the cards, the editor window, and the saved plots in the right-click menu. Driven by the
  //    real UI, from "Add examples", so each picture shows what the library builds. ─────────────────────────────
  {
    file: 'guide-plot-tab',
    group: 'plots',
    page: '/examples/statistics.html#lot-gallery',
    wait: 2000,
    viewport: { width: 1280, height: 1000 },
    screenshotFn: async (page, outFile) => {
      await page.locator('[data-wmap-view-switch] [role="tab"]', { hasText: 'Insights' }).click();
      await page.locator('[data-wmap-insights-tab="plot"]').click();
      await page.locator('[data-wmap-plot-examples]').click();
      await page.waitForSelector('[data-wmap-plot-id] canvas');
      await page.waitForTimeout(1200);
      await page.mouse.move(2, 2);
      const host = page.locator('#wmap-host');
      const top = await page.locator('[data-wmap-plot-tab]').boundingBox();
      await host.scrollIntoViewIfNeeded();
      // The toolbar and the first row of cards: enough to show what the tab is.
      const cards = await page.locator('[data-wmap-plot-id]').evaluateAll(els => els.slice(0, 2).map(e => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; }));
      const tb = await page.locator('[data-wmap-plot-new]').evaluate(e => { const r = e.parentElement.getBoundingClientRect(); return { x: r.x, y: r.y, h: r.height }; });
      void top;
      const x = Math.min(tb.x, cards[0].x) - 8;
      const y = tb.y - 8;
      await page.screenshot({ path: outFile, clip: {
        x, y, width: Math.max(...cards.map(c => c.x + c.w)) - x + 8, height: Math.max(...cards.map(c => c.y + c.h)) - y + 8,
      } });
    },
  },
  {
    file: 'guide-plot-editor',
    group: 'plots',
    page: '/examples/statistics.html#lot-gallery',
    wait: 2000,
    viewport: { width: 1280, height: 900 },
    screenshotFn: async (page, outFile) => {
      await page.locator('[data-wmap-view-switch] [role="tab"]', { hasText: 'Insights' }).click();
      await page.locator('[data-wmap-insights-tab="plot"]').click();
      await page.locator('[data-wmap-plot-examples]').click();
      await page.waitForSelector('[data-wmap-plot-id] canvas');
      await page.locator('[data-wmap-plot-edit]').first().click();
      await page.waitForSelector('[data-wmap-plot-window] canvas');
      await page.waitForTimeout(1200);
      await page.mouse.move(2, 2);
      // The window opens with focus on its close button, which shows that button's tooltip: leave it out of the picture.
      await page.evaluate(() => document.activeElement?.blur?.());
      await page.waitForTimeout(300);
      // The box is a fixed height; the picture is the title bar and what is in it.
      const box = await page.locator('.wmap-overlay-box').first().boundingBox();
      const chart = await page.locator('[data-wmap-plot-window] [data-wmap-chart-card]').first().boundingBox();
      await page.screenshot({ path: outFile, clip: { x: box.x, y: box.y, width: box.width, height: chart.y + chart.height - box.y + 24 } });
    },
  },

  // ── The Chart gallery (examples/insights.html): one thumbnail of each chart and table, written to docs/examples/thumbs/ for
  //    the page's tiles. One definition makes them all, so they can be redone in one go. ──────────────────────────────────
  {
    file: 'chart-gallery',
    group: 'chart-gallery',
    page: '/examples/insights.html',
    wait: 3000,
    viewport: { width: 1280, height: 1100 },
    screenshotFn: async (harnessPage, outFile) => {
      const { mkdirSync, writeFileSync } = await import('node:fs');
      const { dirname, join } = await import('node:path');
      const dir = join(dirname(outFile), '..', 'examples', 'thumbs');
      mkdirSync(dir, { recursive: true });
      // A card is cropped to its top left corner, 560 by 420: a wide card (a table, a comparison) would otherwise shrink to
      // unreadable text in a tile, and a tall one is mostly scrolling.
      const MAX_W = 560;
      const MAX_H = 420;
      // At twice the pixel density, and scaled down once at the end (to twice a tile's width), so the text in a thumbnail is
      // crisp where a 1x capture shrunk by the browser is a blur. The harness's own page is 1x, so this opens another.
      const browser = harnessPage.context().browser();
      const context = await browser.newContext({ viewport: { width: 1280, height: 1100 }, deviceScaleFactor: 2 });
      const page = await context.newPage();
      await page.goto(harnessPage.url(), { waitUntil: 'networkidle' });
      await page.waitForSelector('[data-wmap-chart-card]');
      await page.waitForTimeout(3000);
      // Catalogue id → where the chart is and how its card is titled (the first words of its heading).
      const CARDS = [
        ['overview', 'yield-by-wafer', /^Yield by wafer/], ['overview', 'bin-pareto', /^Hard bin pareto/],
        ['overview', 'pass-rate-by-test', /^Parametric pass rate/], ['overview', 'ring-yield', /^Ring yield/],
        ['overview', 'quadrant-yield', /^Quadrant yield/], ['overview', 'reticle-cell-yield', /^Reticle cell yield/],
        ['overview', 'what-divides-yield', /^What divides yield/], ['overview', 'part-average-testing-pat', /^Part average testing/],
        ['distributions', 'test-value-distribution', /^Test value distribution/], ['distributions', 'value-histogram', /^Value histogram/],
        ['distributions', 'wafer-to-wafer-trend', /^Wafer-to-wafer trend/], ['distributions', 'process-capability', /^Process capability/],
        ['correlation', 'test-correlation-matrix', /^Test correlation matrix/], ['correlation', 'test-scatter', /^Test scatter/],
        // The comparison and the difference map only exist once Group by is on.
        ['grouped', 'comparison-by-group', /^Comparison by/], ['grouped', 'difference-map', /^Difference map/],
        ['plot', 'scatter-plot', 'gallery-scatter'], ['plot', 'histogram', 'gallery-histogram'], ['plot', 'box-plot', 'gallery-box'],
        ['plot', 'bar-chart', 'gallery-bar'], ['plot', 'line-chart', 'gallery-line'], ['plot', 'probability-plot', 'gallery-probability'],
        ['plot', 'control-chart', 'gallery-control'], ['plot', 'capability-goal-plot', 'gallery-goal'], ['plot', 'heatmap', 'gallery-heatmap'],
        ['plot', 'pareto', 'gallery-pareto'], ['plot', 'stacked-bars-and-shares', 'gallery-stacked'], ['plot', 'nested-categories', 'gallery-nested'],
        ['plot', 'panels-small-multiples', 'gallery-panels'],
      ];
      const open = async tab => {
        await page.locator(`[data-wmap-insights-tab="${tab}"]`).click();
        await page.waitForTimeout(1800);
      };
      const shoot = async (locator, id) => {
        await locator.scrollIntoViewIfNeeded();
        await page.mouse.move(2, 2);
        await page.waitForTimeout(250);
        const box = await locator.boundingBox();
        const png = await page.screenshot({ clip: { x: box.x, y: box.y, width: Math.min(box.width, MAX_W), height: Math.min(box.height, MAX_H) }, scale: 'device' });
        // A tile shows it about 300 px wide: scaled down once, to twice that, as WebP so thirty-odd thumbnails stay small files.
        const small = await page.evaluate(async ([b64, width]) => {
          const img = new Image();
          img.src = `data:image/png;base64,${b64}`;
          await img.decode();
          const k = Math.min(1, width / img.width);
          const c = document.createElement('canvas');
          c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
          const g = c.getContext('2d');
          g.imageSmoothingQuality = 'high';
          g.drawImage(img, 0, 0, c.width, c.height);
          return c.toDataURL('image/webp', 0.92).split(',')[1];
        }, [png.toString('base64'), 600]);
        writeFileSync(join(dir, `${id}.webp`), Buffer.from(small, 'base64'));
      };
      const card = (m) => (typeof m === 'string'
        ? page.locator(`[data-wmap-plot-id="${m}"]`)
        : page.locator('[data-wmap-chart-card]').filter({ hasText: m }).first());
      await page.locator('[data-wmap-view-switch] [role="tab"]', { hasText: 'Insights' }).click().catch(() => {});
      for (const tab of ['overview', 'distributions', 'correlation', 'plot']) {
        await open(tab);
        for (const [t, id, m] of CARDS) if (t === tab) await shoot(card(m), id);
      }
      // The PAT verdict map, from the PAT showcase lot (docs/data/showcase-pat-screen.*): the demo lot's PAT limits reach its test
      // limits, so it has no outliers to show. The gallery is drawn over the page, in the PAT verdict mode, and the wafer with the
      // most outliers (P3) is the one shot.
      await page.evaluate(async () => {
        const { buildWaferMap } = await import('wafermap');
        const { renderWaferGallery } = await import('wafermap/render');
        const [csv, meta] = await Promise.all([
          fetch('../data/showcase-pat-screen.csv').then(r => r.text()),
          fetch('../data/showcase-pat-screen.meta.json').then(r => r.json()),
        ]);
        const lines = csv.trim().split('\n');
        const head = lines[0].split(',');
        const byWafer = new Map();
        for (const line of lines.slice(1)) {
          const c = Object.fromEntries(line.split(',').map((v, i) => [head[i], v]));
          if (!byWafer.has(c.WAFER_ID)) byWafer.set(c.WAFER_ID, []);
          byWafer.get(c.WAFER_ID).push({ x: +c.X, y: +c.Y, sbin: +c.SBIN, hbin: +c.SBIN, testValues: { 1: +c.VTH_V, 2: +c.IDDQ_UA, 3: +c.IDSAT_MA, 4: +c.TPD_NS } });
        }
        const items = [...byWafer].map(([label, results]) => ({ ...buildWaferMap({ results, ...meta }), label }));
        const host = document.createElement('div');
        host.id = 'pat-shot';
        host.style.cssText = 'position:fixed;inset:0;z-index:99999;background:#fff;overflow:auto';
        document.body.appendChild(host);
        renderWaferGallery(host, items, { viewOptions: { plotMode: 'metadata', activeMetadataKey: 'wmapPat' }, insights: { enabled: false } });
      });
      const patCard = page.locator('#pat-shot .wmap-gallery-card').nth(2);
      await patCard.locator('canvas').first().waitFor();
      await page.waitForTimeout(1800);
      await shoot(patCard, 'pat-verdict-map');
      await page.evaluate(() => document.getElementById('pat-shot')?.remove());
      // Group by Process Split: the comparison and the difference map appear on Distributions.
      await open('distributions');
      await page.locator('[data-wmap-select="group-by"]').click();
      await page.getByRole('option', { name: /Process Split/ }).click();
      await page.waitForTimeout(2500);
      for (const [t, id, m] of CARDS) if (t === 'grouped') await shoot(card(m), id);
      // The tables: the Data tab's three views.
      await open('data');
      for (const [view, id] of [['statistics', 'statistics-table'], ['wafers', 'wafers-table'], ['dies', 'dies-table']]) {
        await page.locator(`[data-wmap-data-view="${view}"]`).click();
        await page.waitForTimeout(1500);
        await shoot(page.locator('[data-wmap-data-tab]'), id);
      }
      await context.close();
    },
  },

  // ── The filter (§3 Filtering wafers and dies): the gallery with a wafer filter on, the maps with a die filter on, and
  //    the Filter window. Driven from the Filtering example, which starts with a wafer filter and three saved filters. ──
  {
    file: 'guide-filter-gallery',
    group: 'filters',
    page: '/examples/filters.html',
    wait: 2500,
    viewport: { width: 1280, height: 760 },
    screenshotFn: async (page, outFile) => {
      await page.waitForSelector('[data-wmap-insights-filter] [data-wmap-filter-strip]');
      await page.locator('[data-wmap-summary-toggle] button, [data-wmap-summary-toggle]').first().click();
      await page.waitForTimeout(1500);
      await page.mouse.move(2, 2);
      await page.evaluate(() => document.activeElement?.blur?.());
      await page.locator('#stage').screenshot({ path: outFile });
    },
  },
  {
    file: 'guide-filter-dies',
    group: 'filters',
    page: '/examples/filters.html',
    wait: 2500,
    viewport: { width: 1280, height: 760 },
    screenshotFn: async (page, outFile) => {
      await page.locator('[data-start="die"]').click();
      await page.waitForSelector('[data-wmap-insights-filter] [data-wmap-filter-strip="on"]');
      await page.waitForTimeout(2500);
      await page.mouse.move(2, 2);
      // The band and the first row of cards: enough to show the faded dies beside what the filter kept.
      const band = await page.locator('[data-wmap-insights-filter]').boundingBox();
      const cards = await page.locator('.wmap-gallery-card').evaluateAll(els => els.slice(0, 3).map(e => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; }));
      const x = Math.min(band.x, ...cards.map(c => c.x)) - 8;
      const y = band.y - 8;
      await page.screenshot({ path: outFile, clip: { x, y, width: Math.max(...cards.map(c => c.x + c.w)) - x + 8, height: Math.max(...cards.map(c => c.y + c.h)) - y + 8 } });
    },
  },
  {
    file: 'guide-filter-editor',
    group: 'filters',
    page: '/examples/filters.html',
    wait: 2500,
    viewport: { width: 1280, height: 900 },
    screenshotFn: async (page, outFile) => {
      await page.locator('[data-wmap-gallery-filter-open]').click();
      await page.waitForSelector('[data-wmap-insights-filter-modal] [data-wmap-filter-add]');
      await page.waitForTimeout(500);
      await page.mouse.move(2, 2);
      await page.evaluate(() => document.activeElement?.blur?.());
      await page.waitForTimeout(300);
      await page.locator('[data-wmap-insights-filter-modal]').screenshot({ path: outFile });
    },
  },
  {
    file: 'guide-filter-saved',
    group: 'filters',
    page: '/examples/filters.html',
    wait: 2500,
    viewport: { width: 1280, height: 900 },
    screenshotFn: async (page, outFile) => {
      await page.locator('[data-wmap-gallery-filter-open]').click();
      await page.waitForSelector('[data-wmap-saved-filters]');
      // Load one of the saved filters into the editor: the conditions change, nothing is applied until Apply.
      await page.locator('[data-wmap-saved-filter="east-fails"] [data-wmap-saved-filter-load]').click();
      await page.waitForTimeout(500);
      await page.locator('[data-wmap-saved-filters]').scrollIntoViewIfNeeded();
      await page.mouse.move(2, 2);
      await page.evaluate(() => document.activeElement?.blur?.());
      await page.waitForTimeout(300);
      await page.locator('[data-wmap-insights-filter-modal]').screenshot({ path: outFile });
    },
  },
  {
    file: 'guide-sweep-editor',
    group: 'plots',
    page: '/examples/statistics.html#lot-gallery',
    wait: 2000,
    viewport: { width: 1280, height: 900 },
    screenshotFn: async (page, outFile) => {
      await page.locator('[data-wmap-view-switch] [role="tab"]', { hasText: 'Insights' }).click();
      await page.locator('[data-wmap-insights-tab="plot"]').click();
      await page.locator('[data-wmap-plot-new-sweep]').click();
      await page.waitForSelector('[data-wmap-plot-window] canvas');
      await page.waitForTimeout(1200);
      await page.mouse.move(2, 2);
      await page.evaluate(() => document.activeElement?.blur?.());
      await page.waitForTimeout(300);
      const box = await page.locator('.wmap-overlay-box').first().boundingBox();
      await page.screenshot({ path: outFile, clip: { x: box.x, y: box.y, width: box.width, height: box.height } });
    },
  },
  {
    file: 'guide-plot-drilldown',
    group: 'plots',
    page: '/examples/statistics.html#lot-gallery',
    wait: 2000,
    viewport: { width: 1280, height: 900 },
    screenshotFn: async (page, outFile) => {
      // Save the examples, then come back to the maps and pick out some dies.
      await page.locator('[data-wmap-view-switch] [role="tab"]', { hasText: 'Insights' }).click();
      await page.locator('[data-wmap-insights-tab="plot"]').click();
      await page.locator('[data-wmap-plot-examples]').click();
      await page.waitForSelector('[data-wmap-plot-id] canvas');
      await page.locator('[data-wmap-view-switch] [role="tab"]', { hasText: 'Maps' }).click();
      await page.waitForTimeout(800);
      const canvas = page.locator('#wmap-host canvas').first();
      await canvas.scrollIntoViewIfNeeded();
      const b = await canvas.boundingBox();
      await page.getByRole('button', { name: 'Select (drag to select dies)' }).first().click();
      await page.mouse.move(b.x + b.width * 0.30, b.y + b.height * 0.30);
      await page.mouse.down();
      await page.mouse.move(b.x + b.width * 0.55, b.y + b.height * 0.55, { steps: 8 });
      await page.mouse.up();
      await page.mouse.click(b.x + b.width * 0.40, b.y + b.height * 0.40, { button: 'right' });
      await page.waitForSelector('[data-wmap-drilldown-menu]');
      await page.locator('[data-wmap-drilldown-menu] [role="menuitem"]').first().hover();
      await page.waitForTimeout(300);
      const menu = await page.locator('[data-wmap-drilldown-menu]').boundingBox();
      // The card the dies were picked on, and the menu over it: not the page around them.
      const card = await canvas.locator('xpath=ancestor::div[.//button[@data-wmap-expand-btn]][1]').boundingBox();
      const x = Math.min(card.x, menu.x) - 8, y = Math.min(card.y, menu.y) - 8;
      await page.screenshot({ path: outFile, clip: {
        x, y, width: Math.max(card.x + card.width, menu.x + menu.width) - x + 8, height: Math.max(card.y + card.height, menu.y + menu.height) - y + 8,
      } });
    },
  },

  // ── guide-theming.png — Developer Guide §Theming: 2-col gallery, Nord theme,
  //    summary panel open. Page starts Nord via ?theme=nord (deterministic).
  //    Panel + columns set via setup steps (matching guide-summary-panel /
  //    guide-gallery-per-wafer). Shows chrome + canvas + panel all following
  //    the --wmap-* tokens. ────────────────────────────────────────────────────
  {
    file: 'guide-theming',
    group: 'gallery',
    page: '/examples/theming.html?theme=nord',
    selector: '#gallery-container',
    wait: 2000,
    setup: [['selectColumns', '2 columns'], ['openPanel'], ['hideCursor']],
  },

  // ── guide-lot-findings-gallery.png — §13 Lot findings: gallery + lot summary panel ─
  {
    file: 'guide-lot-findings-gallery',
    group: 'gallery',
    page: '/examples/statistics.html#lot-findings',
    selector: '.demo-content',
    wait: 2000,
    setup: [
      ['selectColumns', '3 columns'],
      ['openPanel', '#wmap-host'],
      ['wait', 400],
      ['clickFinding', '#wmap-host'],
      ['showCursorOn', '[data-wmap-finding-active]']
    ],
  },

  // ── report-wafer-summary.png — §13 Wafer summary report (popup from panel button) ─
  {
    file: 'report-wafer-summary',
    group: 'maps',
    page: '/examples/statistics.html#summary-panel',
    wait: 1000,
    screenshotFn: async (page, outFile) => {
      // Open the summary panel
      await page.evaluate(() => {
        const btn = [...document.querySelectorAll('button')]
          .find(b => b.ariaLabel === 'Summary panel');
        if (btn && !btn.dataset.active) btn.click();
      });
      await page.waitForTimeout(600);

      // The report opens IN-PAGE, in a modal with an <iframe srcdoc>, since
      // 0.26.0's `openReportModal` replaced the old `window.open` popup. This
      // step waited for a `page` event that no longer fires, so both report
      // captures had been failing silently ever since — nothing fails the build
      // on a capture error, so the images just went stale.
      await page.evaluate(() => {
        const btn = [...document.querySelectorAll('button')]
          .find(b => b.textContent?.trim() === 'Summary report');
        if (btn) btn.click();
      });
      const frame = page.locator('.wmap-modal-box iframe');
      await frame.waitFor({ state: 'visible', timeout: 15000 });
      await page.waitForTimeout(600);
      await page.locator('.wmap-modal-box').screenshot({ path: outFile });
    },
  },

  // ── report-lot-summary.png — §13 Lot summary report (popup from lot panel button) ─
  {
    file: 'report-lot-summary',
    group: 'gallery',
    page: '/examples/statistics.html#lot-findings',
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
      // In-page modal, not a popup — see the note on the wafer-summary capture.
      await page.evaluate(() => {
        // The LOT panel's button, not a card's: the lot summary panel is the one
        // NOT inside a .wmap-gallery-card. Without this scope the first match is
        // a wafer card's own button, and the capture silently shows a Wafer
        // Summary under the lot-report filename.
        const btn = [...document.querySelectorAll('button')]
          .find(b =>
            b.textContent?.trim() === 'Summary report' &&
            !b.closest('.wmap-gallery-card')
          );
        if (btn) btn.click();
      });
      const frame = page.locator('.wmap-modal-box iframe');
      await frame.waitFor({ state: 'visible', timeout: 15000 });
      await page.waitForTimeout(600);
      await page.locator('.wmap-modal-box').screenshot({ path: outFile });
    },
  },

  // ── guide-findings-cluster-highlight.png — §10 Cluster highlight: specific dies lit amber ─
  {
    file: 'guide-findings-cluster-highlight',
    group: 'maps',
    page: '/examples/statistics.html#findings',
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
    page: '/examples/statistics.html#lot-gallery',
    selector: '#wmap-host',
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

  // ── guide-compact-wafer.png / guide-compact-layout.png — compact layout, before and after ─
  {
    file: 'guide-compact-wafer',
    group: 'maps',
    page: '/examples/multi-project-wafer.html',
    selector: '.demo-content',
    wait: 1000,
    setup: [['clickTab', 'Wafer', 'body'], ['wait', 600]],
  },
  {
    file: 'guide-compact-layout',
    group: 'maps',
    page: '/examples/multi-project-wafer.html',
    selector: '.demo-content',
    wait: 1000,
    setup: [],
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

  // ── guide-color-schemes.png — §16 Colour schemes: the registered 'teal-rose'
  //    bin palette shown in the toolbar's own palette menu, which is the point —
  //    registerBinColorScheme puts it there with no further wiring. ───────────
  {
    file: 'guide-color-schemes',
    group: 'maps',
    page: '/examples/display-control.html#custom-schemes',
    selector: '.demo-content',
    wait: 1200,
    setup: [
      ['hover', '#map'],
      ['openDropdown', 'Colour scheme', undefined, '#map'],
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
    page: '/examples/statistics.html#lot-gallery',
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
