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
 * Image numbers match guide section numbers (§2 → image-2, §3 → image-3, …).
 * image.png is the homepage hero (no section number).
 * image-1.png is the intro overview screenshot at the top of the guide.
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

  // ── image.png — homepage hero: Idsat heatmap with colorbar + toolbar ─────────
  {
    file: 'image',
    group: 'maps',
    page: '/examples/06-test-values.html',
    selector: '.demo-page',
    wait: 800,
    setup: [['hover'], ['showCursorOn', '#map canvas', -120, -100]],
  },

  // ── image-1.png — guide intro: interaction demo showing map + sidebar ─────────
  {
    file: 'image-1',
    group: 'maps',
    page: '/examples/09-interaction.html',
    selector: '.demo-content',
    wait: 800,
    setup: [['hover'], ['showCursorOn', '#map canvas', -120, -100]],
  },

  // ── image-2.png — §2 Your first wafer map ────────────────────────────────────
  {
    file: 'image-2',
    group: 'maps',
    page: '/examples/01-first-map.html',
    selector: '.demo-content',
    wait: 800,
    setup: [['hover'], ['showCursorOn', '#map canvas', -150, -100]],
  },

  // ── image-3.png — §3 Loading CSV data: map + source-file sidebar ──────────────
  {
    file: 'image-3',
    group: 'maps',
    page: '/examples/03-csv-data.html',
    selector: '.demo-content',
    wait: 600,
    setup: [['toggleOverlay', 'Ring boundaries'],
    ['toggleOverlay', 'XY indicator'],
    ['showCursorOn', 'Overlays', 90, 120]],
  },

  // ── image-4.png — §4 Geometry: four maps showing inference levels ─────────────
  {
    file: 'image-4',
    group: 'maps',
    page: '/examples/04-geometry.html',
    selector: '.demo-content',
    wait: 1200,
    setup: [['showCursorOn', '#map-b', -70, -50], ['hover', '#map-b']],
  },

  // ── image-5.png — §5 Bins: named bin map with legend ─────────────────────────
  {
    file: 'image-5',
    group: 'maps',
    page: '/examples/05-named-bins.html',
    selector: '.demo-content',
    wait: 800,
    setup: [['hover'], ['showCursorOn', '#map canvas', -120, -100]],
  },

  // ── image-5a.png — §9 Legend bin filter: bin 2 highlighted, rest dimmed ─────────
  {
    file: 'image-5a',
    group: 'maps',
    page: '/examples/05-named-bins.html',
    selector: '.demo-content',
    wait: 800,
    setup: [
      ['closePanel'],
      ['clickLegendRow', 2, 4],
      ['showCursorOn', '#map canvas', 500, -9],
    ],
  },

  // ── image-6.png — §6 Test values: heatmap + test-selector sidebar ─────────────
  {
    file: 'image-6',
    group: 'maps',
    page: '/examples/06-test-values.html',
    selector: '.demo-content',
    wait: 800,
    setup: [['hoverEl', 'Colorbar range: spec limits (click for data range)'],
    ['showCursorOn', 'Colorbar range: spec limits (click for data range)']],
  },
  // ── image-6a.png — §6 Test values: heatmap + test-selector sidebar ─────────────
  {
    file: 'image-6a',
    group: 'maps',
    page: '/examples/06-test-values.html',
    selector: '.demo-content',
    wait: 800,
    setup: [['toggleOverlay', 'Spec pass/fail'], ['showCursorOn', 'Overlays', 90, 140]],
  },

  // ── image-7.png — §7 Retests: map + retested-die list sidebar ─────────────────
  {
    file: 'image-7',
    group: 'maps',
    page: '/examples/07-retests.html',
    selector: '.demo-content',
    wait: 800,
    setup: [['hover']],
  },

  // ── image-8.png — §8 Display control: map + external controls sidebar ─────────
  {
    file: 'image-8',
    group: 'maps',
    page: '/examples/08-display-control.html',
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

  // ── image-8a.png — §5 Bins: legend at bottom with Legend style menu open ─────
  {
    file: 'image-8a',
    group: 'maps',
    page: '/examples/05-named-bins.html',
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


  // ── image-9.png — §9 Interaction: box-select drag with dies highlighted ────────
  {
    file: 'image-9',
    group: 'maps',
    page: '/examples/09-interaction.html',
    selector: '.demo-content',
    wait: 800,
    setup: [
      ['boxSelect'],
      ['mouseUp'],
      ['showCursorOn', '#map', 150, 70],
    ],
  },

  // ── image-10.png — §10 Findings: map + panel with first finding selected ────────
  {
    file: 'image-10',
    group: 'maps',
    page: '/examples/10-findings.html',
    selector: '.demo-content',
    wait: 1500,
    setup: [
      ['openPanel'],
      ['clickFinding'],
      ['showCursorOn', '[data-wmap-finding-active]']
    ],
  },

  // ── image-11.png — §11 Summary panel: single map with panel open ──────────────
  {
    file: 'image-11',
    group: 'maps',
    page: '/examples/11-summary-panel.html',
    selector: '#single-map-wrap',
    wait: 1000,
    setup: [
      ['openPanel', '#single-map'],
      ['hoverEl', 'Summary panel'],
      ['showCursorOn', 'Summary panel'],
    ],
  },

  // ── image-12.png — §12 Gallery: card grid with hover on first card ────────────
  {
    file: 'image-12',
    group: 'gallery',
    page: '/examples/12-gallery.html',
    selector: '#gallery-container',
    wait: 2000,
    setup: [['hoverFirstCard', '#gallery-container'], ['selectColumns', '3 columns']],
  },

  // ── image-13.png — §13 Lot findings: gallery (3 cols) + lot summary panel ──────
  {
    file: 'image-13',
    group: 'gallery',
    page: '/examples/13-lot-findings.html',
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

  // ── image-10a.png — §10 Cluster/edge-arc highlight: specific dies lit amber ───
  {
    file: 'image-10a',
    group: 'maps',
    page: '/examples/10-findings.html',
    selector: '.demo-content',
    wait: 1500,
    setup: [
      ['openPanel'],
      ['wait', 400],
      ['clickFindingByText', 'Failure cluster'],
      ['showCursorOn', '[data-wmap-finding-active]']
    ],
  },

  // ── image-12a.png — §12 Stacked Hard Bins gallery: one card per bin ──────────
  {
    file: 'image-12a',
    group: 'gallery',
    page: '/examples/12-gallery.html',
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

  // ── image-14.png — §14 Reticle overlays: map + reticle summary panel ─────────
  {
    file: 'image-14',
    group: 'maps',
    page: '/examples/14-reticle.html',
    selector: '.demo-content',
    wait: 1000,
    setup: [['toggleOverlay', 'Reticle grid'], ['toggleOverlay', 'Reticle grid'], 
    ['showCursorOn', 'Overlays', 90, 120]],

  },

  // ── image-16.png — §16 Colour schemes: three wafers side by side ─────────────
  {
    file: 'image-16',
    group: 'maps',
    page: '/examples/16-color-schemes.html',
    selector: '.scheme-grid',
    wait: 1200,
    setup: [
      ['hover', '#map-custom'],
      ['openDropdown', 'Colour scheme', undefined, '#map-custom'],
      ['showCursorOn', '[data-wmap-dropdown-value="teal-rose"]', 10, 10],
    ]
  },

  // ── CSV showcase ──────────────────────────────────────────────────────────────
  {
    file: 'csv',
    group: 'showcase',
    page: '/examples/00-showcase.html',
    selector: '#phase-upload',
    wait: 600
  },

  // ── Toolbar strips ────────────────────────────────────────────────────────────

  // toolbar-single: hover to reveal toolbar then screenshot just the toolbar bar
  {
    file: 'toolbar-single',
    group: 'toolbar',
    page: '/examples/01-first-map.html',
    selector: '[data-wmap-toolbar="single"]',
    wait: 800,
    viewport: { width: 1280, height: 800 },
    setup: [['hover']],
  },

  // toolbar-gallery: screenshot the gallery toolbar bar
  {
    file: 'toolbar-gallery',
    group: 'toolbar',
    page: '/examples/12-gallery.html',
    wait: 2000,
    viewport: { width: 1450, height: 900 },
    selector: '[data-wmap-toolbar="gallery"]',
  },

  // ── Presentation-specific ────────────────────────────────────────────────────

  // comparison: run benchmark (bins scenario) and screenshot the result
  {
    file: 'comparison',
    group: 'presentation',
    page: '/examples/comparison.html',
    selector: 'body',
    wait: 500,
    viewport: { width: 1280, height: 900 },
    setup: [
      ['wait', 200],
    ],
  },

  // pres-bins: clean hard-bin map (no demo sidebar) for presentation viz-modes slide
  {
    file: 'pres-bins',
    group: 'presentation',
    page: '/examples/05-named-bins.html',
    selector: '#map',
    wait: 800,
    setup: [['closePanel'], ['hover']],
  },

  // pres-values: clean test-value heatmap (no demo sidebar) for presentation viz-modes slide
  {
    file: 'pres-values',
    group: 'presentation',
    page: '/examples/06-test-values.html',
    selector: '#map',
    wait: 800,
    setup: [['hover']],
  },
];
