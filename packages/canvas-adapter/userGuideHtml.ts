// @generated — do not edit directly.
// Source: docs/user-guide.md
// Regenerate with: npm run build:guide
// Auto-regenerated on every: npm run build

export const USER_GUIDE_HTML = `<div class="wmap-guide">
<style>
.wmap-guide{font-family:system-ui,-apple-system,sans-serif;font-size:14px;line-height:1.65;color:#1a1a1a;padding:24px 32px;max-width:720px;margin:0 auto;overflow-y:auto;height:100%;box-sizing:border-box}
.wmap-guide h1{font-size:1.35em;font-weight:700;margin:0 0 18px;padding-bottom:10px;border-bottom:2px solid #e2e5ea;color:#111}
.wmap-guide h2{font-size:1.1em;font-weight:700;margin:28px 0 10px;padding-bottom:6px;border-bottom:1px solid #e9eaec;color:#1a1a1a}
.wmap-guide h3{font-size:1em;font-weight:700;margin:20px 0 6px;color:#222;display:flex;align-items:center;gap:6px}
.wmap-guide h3 img{width:20px;height:20px;display:inline;vertical-align:middle;border:none;border-radius:0;margin:0}
.wmap-guide p{margin:0 0 12px}
.wmap-guide ul,.wmap-guide ol{margin:0 0 12px;padding-left:22px}
.wmap-guide li{margin-bottom:4px}
.wmap-guide table{border-collapse:collapse;width:100%;margin:0 0 16px;font-size:13px}
.wmap-guide th{background:#f4f5f7;text-align:left;padding:7px 10px;font-weight:600;border:1px solid #d8dce2}
.wmap-guide td{padding:6px 10px;border:1px solid #e2e5ea;vertical-align:middle}
.wmap-guide tr:nth-child(even) td{background:#fafbfc}
.wmap-guide strong{font-weight:600}
.wmap-guide code{font-family:monospace;font-size:12px;background:#f0f2f5;padding:1px 4px;border-radius:3px}
.wmap-guide hr{border:none;border-top:1px solid #e9eaec;margin:24px 0}
.wmap-guide img{max-width:100%;height:auto;border:1px solid #e2e5ea;border-radius:6px;margin:8px 0;display:block}
.wmap-guide td img{width:20px;height:20px;display:inline-block;vertical-align:middle;border:none;border-radius:0;margin:0}
.wmap-guide a{color:#0066cc;text-decoration:none}
.wmap-guide a:hover{text-decoration:underline}
</style>
<h1>Wafer Map — User Guide</h1>
<p>This guide describes the display and analysis features of the wafer map viewer.
It is written for semiconductor test engineers, device engineers, and yield engineers
who use a wafer map application — not for developers integrating the library.</p>
<p>Some features depend on what data the application has loaded (bin names, test
definitions, spec limits, reticle geometry). Where this applies it is noted.</p>
<hr>
<h2>1. Reading the map</h2>
<h3>1.1 Die grid and coordinates</h3>
<p>Each square on the wafer represents one die. The position labels you see — in
tooltips, axis ticks, and selection readouts — are <strong>die grid coordinates</strong>: the
X and Y step indices from the prober (integers such as −7, 0, 5). They are not
millimetre values.</p>
<p>These coordinates are always the original prober values. Rotating or flipping the
display does not change the coordinate labels — a die at (3, −2) always reads
(3, −2) regardless of how the wafer is oriented on screen.</p>
<h3>1.2 Wafer orientation</h3>
<p>The notch (shown as a V-notch or flat edge) marks the physical reference edge of
the wafer as configured. Use the <strong>Orientation</strong> toolbar controls to rotate or flip
the display to match your convention; die coordinates are unaffected.</p>
<h3>1.3 Die appearance</h3>
<table>
<thead>
<tr>
<th>Appearance</th>
<th>Meaning</th>
</tr>
</thead>
<tbody><tr>
<td>Solid colour</td>
<td>Active plot value — bin category or test measurement</td>
</tr>
<tr>
<td>Muted grey at perimeter</td>
<td>Partial die — falls outside the wafer circle boundary</td>
</tr>
<tr>
<td>Neutral grey (interior)</td>
<td>No data — die has no bin or test result in the loaded dataset</td>
</tr>
</tbody></table>
<p>No-data grey and partial-die grey are visually distinct. A no-data die is not a
fail; it simply has no result recorded.</p>
<h3>1.4 Legend and colorbar</h3>
<p><strong>Bin modes</strong> show a discrete colour legend: one swatch per bin, with bin number
and name if the application has supplied bin names.</p>
<p><strong>Value mode</strong> shows a continuous colorbar: the colour scale runs from the minimum
to maximum value, with units when available. Clicking a bin swatch in the legend
filters the display to that bin (see <a href="#3-toolbar-controls">Highlight bin</a>).</p>
<hr>
<h2>2. Plot modes</h2>
<p>The active plot mode determines what the colour of each die represents. Use the
<strong>Plot mode</strong> toolbar dropdown to switch. Available modes depend on what data the
application has loaded.</p>
<table>
<thead>
<tr>
<th>Mode</th>
<th>Colour represents</th>
<th>Typical use</th>
</tr>
</thead>
<tbody><tr>
<td><strong>Hard Bin</strong></td>
<td>Physical sort result (hard bin number)</td>
<td>Yield categorisation, pass/fail map</td>
</tr>
<tr>
<td><strong>Soft Bin</strong></td>
<td>Test-program failure category (soft bin number)</td>
<td>Failure mode breakdown</td>
</tr>
<tr>
<td><strong>Test Value</strong></td>
<td>A single numeric measurement</td>
<td>Parametric heatmap — leakage, Idsat, Vth, etc.</td>
</tr>
<tr>
<td><strong>Stacked Hard Bins</strong></td>
<td>Hard bin occurrence counts aggregated across multiple wafers</td>
<td>Lot-level yield patterns</td>
</tr>
<tr>
<td><strong>Stacked Soft Bins</strong></td>
<td>Soft bin occurrence counts aggregated across multiple wafers</td>
<td>Lot-level failure mode patterns</td>
</tr>
<tr>
<td><strong>Stacked Test Values</strong></td>
<td>Aggregated test values across multiple wafers</td>
<td>Lot-level parametric trends</td>
</tr>
</tbody></table>
<p>Stacked modes are only available on lot-stack maps (multiple wafers combined into
one display). The panel identifies how many wafers were stacked and which
aggregation method is active.</p>
<h3>Test Value mode — colorbar range and spec limits</h3>
<p>When spec limits are defined for the active test, two additional display options
become available:</p>
<ul>
<li><strong>Colorbar range — Data / Spec</strong>: switches the colorbar scale between the
actual data extent and the spec limit bounds. Changing this affects only the
colour scale; it does not change which dies are flagged as out of spec.</li>
<li><strong>Colour by spec</strong>: when active, dies within spec are shown in a pass colour
and dies outside spec are highlighted — blue for below the lower limit, red for
above the upper limit. Both flags apply independently; a die can be flagged on
either or both limits.</li>
</ul>
<p><a href="https://telecasterer.github.io/wafermap/images/guide-test-values-colorbar.png">View image: Test value heatmap with colorbar and spec range</a></p>
<p><em>Test value mode: continuous colorbar. The colorbar range button toggles between
data extent and spec limits.</em></p>
<p><a href="https://telecasterer.github.io/wafermap/images/guide-test-values-spec-passfail.png">View image: Spec pass/fail overlay active</a></p>
<p><em>Colour-by-spec active: out-of-spec dies highlighted in the overlay colour.</em></p>
<hr>
<h2>3. Toolbar controls</h2>
<p>The toolbar appears when you hover over the map (or may be always visible,
depending on the application). Controls that are not applicable to the current
mode are hidden automatically.</p>
<p><img src="data:image/png;base64,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" alt="Single-map toolbar"></p>
<h3>Single map</h3>
<table>
<thead>
<tr>
<th></th>
<th>Control</th>
<th>Description</th>
</tr>
</thead>
<tbody><tr>
<td><img src="images/icons/mode.svg" width="20" height="20"></td>
<td>Plot mode</td>
<td>Switches the active plot mode (see <a href="#2-plot-modes">Section 2</a>). When multiple tests are available, a test selector appears alongside it.</td>
</tr>
<tr>
<td><img src="images/icons/aggr.svg" width="20" height="20"></td>
<td>Aggregation method</td>
<td>Stacked modes only. Selects how values from multiple wafers are combined per die position: Mean, Median, Std Dev, Min, Max, or Count.</td>
</tr>
<tr>
<td><img src="images/icons/overlays.svg" width="20" height="20"></td>
<td>Overlays</td>
<td>Check-menu of optional display layers: XY axis indicator, ring boundaries, quadrant lines, die coordinate labels, reticle grid (when geometry is configured), and spec pass/fail highlighting (Test Value mode with limits).</td>
</tr>
<tr>
<td><img src="images/icons/palette.svg" width="20" height="20"></td>
<td>Colour scheme</td>
<td>Switches the colour palette used for value and stacked modes. Available schemes depend on what the application has registered.</td>
</tr>
<tr>
<td><img src="images/icons/logScale.svg" width="20" height="20"></td>
<td>Log scale</td>
<td>Test Value and Stacked Test Values modes only. Applies a log₁₀ scale to the colour mapping. Only active when all displayed values are positive.</td>
</tr>
<tr>
<td><img src="images/icons/legend.svg" width="20" height="20"></td>
<td>Legend style</td>
<td>Bin modes only. Controls where the bin legend is positioned relative to the map: Default (right), Compact, Left, Top, Bottom, or Floating.</td>
</tr>
<tr>
<td><img src="images/icons/rotateCW.svg" width="20" height="20"></td>
<td>Rotate 90°</td>
<td>Rotates the display 90° clockwise. Applies cumulatively. Die coordinates are unaffected.</td>
</tr>
<tr>
<td><img src="images/icons/flipH.svg" width="20" height="20"></td>
<td>Flip horizontal</td>
<td>Mirrors the display left/right. Die coordinates are unaffected.</td>
</tr>
<tr>
<td><img src="images/icons/flipV.svg" width="20" height="20"></td>
<td>Flip vertical</td>
<td>Mirrors the display top/bottom. Die coordinates are unaffected.</td>
</tr>
<tr>
<td><img src="images/icons/expand.svg" width="20" height="20"></td>
<td>Expand</td>
<td>Opens the map full-screen in a modal overlay. Press <strong>Esc</strong> or click outside to close. Useful for detailed inspection without changing the main view.</td>
</tr>
<tr>
<td><img src="images/icons/download.svg" width="20" height="20"></td>
<td>Save image</td>
<td>Downloads the current map view as a PNG. Captures the canvas as displayed, including all active overlays and the legend.</td>
</tr>
<tr>
<td><img src="images/icons/findings.svg" width="20" height="20"></td>
<td>Summary panel</td>
<td>Opens or closes the summary panel (see <a href="#6-summary-panel">Section 6</a>).</td>
</tr>
<tr>
<td><img src="images/icons/help.svg" width="20" height="20"></td>
<td>User guide</td>
<td>Opens this guide.</td>
</tr>
</tbody></table>
<p><strong>Highlight bin</strong> — in bin modes, click any bin swatch in the legend to highlight
that bin and dim all others. Click again to clear. Useful for isolating a specific
failure category across the wafer.</p>
<p><a href="https://telecasterer.github.io/wafermap/images/guide-bins-legend-filter.png">View image: Bin highlight — bin 2 selected, others dimmed</a></p>
<p><em>Highlight bin active: one failure category isolated, others dimmed.</em></p>
<p><a href="https://telecasterer.github.io/wafermap/images/guide-display-legend-style-menu.png">View image: Legend style dropdown open</a></p>
<h3>Gallery</h3>
<p>The gallery control bar applies to all cards simultaneously.</p>
<table>
<thead>
<tr>
<th></th>
<th>Control</th>
<th>Description</th>
</tr>
</thead>
<tbody><tr>
<td><img src="images/icons/mode.svg" width="20" height="20"></td>
<td>Plot mode</td>
<td>Switches the plot mode for all cards.</td>
</tr>
<tr>
<td><img src="images/icons/overlays.svg" width="20" height="20"></td>
<td>Overlays</td>
<td>Toggles display layers for all cards simultaneously.</td>
</tr>
<tr>
<td><img src="images/icons/palette.svg" width="20" height="20"></td>
<td>Colour scheme</td>
<td>Switches the colour palette for all cards.</td>
</tr>
<tr>
<td><img src="images/icons/orient.svg" width="20" height="20"></td>
<td>Orientation</td>
<td>Opens the rotate/flip controls, applied to all cards.</td>
</tr>
<tr>
<td><img src="images/icons/columns.svg" width="20" height="20"></td>
<td>Columns</td>
<td>Sets the number of columns in the card grid.</td>
</tr>
<tr>
<td><img src="images/icons/download.svg" width="20" height="20"></td>
<td>Save image</td>
<td>Downloads the full gallery grid as a single PNG.</td>
</tr>
<tr>
<td><img src="images/icons/findings.svg" width="20" height="20"></td>
<td>Summary panel</td>
<td>Opens or closes the lot-level summary panel.</td>
</tr>
</tbody></table>
<p>Click any gallery card to expand it to a full single-wafer view with the complete
single-map toolbar.</p>
<p><a href="https://telecasterer.github.io/wafermap/images/guide-gallery-per-wafer.png">View image: Multi-wafer gallery</a></p>
<p><a href="https://telecasterer.github.io/wafermap/images/guide-gallery-stacked-bins.png">View image: Gallery with Stacked Hard Bins mode and plot mode dropdown open</a></p>
<p><em>Gallery in Stacked Hard Bins mode. The Plot mode dropdown shows all available modes.</em></p>
<hr>
<h2>4. Interacting with dies</h2>
<h3>4.1 Hover</h3>
<p>Hovering over a die shows a tooltip with:</p>
<ul>
<li>Die grid coordinates (x, y)</li>
<li>Hard bin and/or soft bin (with name, if named)</li>
<li>Test values for all loaded tests</li>
<li>Retest count if the die was probed more than once</li>
</ul>
<h3>4.2 Zoom and pan</h3>
<p>Scroll to zoom in and out. Click and drag on empty space to pan. Tooltips and
die selection remain accurate at all zoom levels.</p>
<h3>4.3 Box select</h3>
<p>Switch to select mode in the toolbar, then click and drag to draw a selection
rectangle. The application may display statistics or details for the selected
dies. This is useful for comparing a sub-region against the full wafer.</p>
<p><a href="https://telecasterer.github.io/wafermap/images/guide-interaction-box-select.png">View image: Box select drag in progress</a></p>
<p><em>Box selection: drag to select a rectangular region of dies.</em></p>
<hr>
<h2>5. Findings panel</h2>
<p>When spatial analysis has been run, the <strong>Findings</strong> panel lists statistically
detected patterns on the wafer. Open it from the toolbar.</p>
<p>Each finding shows:</p>
<ul>
<li><strong>Severity</strong> — Unusual, Notable, or Info (ordered most to least significant)</li>
<li><strong>Description</strong> — plain-language summary of what was detected and where</li>
<li><strong>Click to highlight</strong> — clicking a finding highlights the affected dies on
the map in amber</li>
</ul>
<p><a href="https://telecasterer.github.io/wafermap/images/guide-findings-panel.png">View image: Findings panel open, first finding selected</a></p>
<p><em>Findings panel: click any finding to highlight the affected region on the map.</em></p>
<p><a href="https://telecasterer.github.io/wafermap/images/guide-findings-cluster-highlight.png">View image: Cluster finding highlighted on map</a></p>
<p><em>A failure cluster finding: affected dies highlighted in amber.</em></p>
<h3>Finding types</h3>
<table>
<thead>
<tr>
<th>Type</th>
<th>What it indicates</th>
</tr>
</thead>
<tbody><tr>
<td><strong>Ring</strong></td>
<td>Yield or value difference between radial bands — e.g. centre vs edge gradient</td>
</tr>
<tr>
<td><strong>Quadrant</strong></td>
<td>Yield or value difference between N, S, E, or W quadrants</td>
</tr>
<tr>
<td><strong>Sector</strong></td>
<td>Asymmetry across finer angular slices — rotational bias or directional process variation</td>
</tr>
<tr>
<td><strong>Test-site</strong></td>
<td>Yield or value difference between parallel probe sites on the same wafer</td>
</tr>
<tr>
<td><strong>Reticle position</strong></td>
<td>Yield signature repeating at specific stepper field grid positions</td>
</tr>
<tr>
<td><strong>Cluster</strong></td>
<td>Contiguous group of failing dies denser than the background failure rate</td>
</tr>
<tr>
<td><strong>Edge arc</strong></td>
<td>Localised arc of failures near the wafer perimeter</td>
</tr>
<tr>
<td><strong>Spatial pattern</strong></td>
<td>Classification of an identified cluster shape — e.g. Donut, Scratch, Centre, Edge-localised, Random</td>
</tr>
</tbody></table>
<p>Which finding types are active depends on the application&#39;s analysis
configuration.</p>
<p>When a spatial pattern classification is detected alongside supporting regional
findings (ring, quadrant, sector), the panel groups them together — the pattern
classification is the primary finding and the regional findings provide
supporting detail.</p>
<hr>
<h2>6. Summary panel</h2>
<p>The summary panel shows statistics and metadata for the current wafer or lot.
Open it from the toolbar.</p>
<p><a href="https://telecasterer.github.io/wafermap/images/guide-summary-panel.png">View image: Summary panel open on single wafer</a></p>
<p>For a <strong>single wafer</strong>, the panel shows:</p>
<ul>
<li>Wafer and lot metadata (lot ID, wafer ID, test date — when available)</li>
<li>Total die count, yield %, and counts of pass, fail, and edge-excluded dies</li>
<li>Hard bin and soft bin breakdown with percentages</li>
<li>Per-test descriptive statistics (min, max, mean, std dev, median) when test
data is loaded</li>
<li>Spec yield per test when limits are defined — pass die count and yield %
split by below-limit and above-limit fails</li>
<li>Findings list — same findings shown in the Findings panel; click to highlight</li>
</ul>
<p>A <strong>Summary report</strong> button (when present) opens a printable full-detail report
in a new window.</p>
<p><a href="https://telecasterer.github.io/wafermap/images/report-wafer-summary.png">View image: Wafer summary report</a></p>
<p>For <strong>lot-level views</strong> (gallery), the panel shows:</p>
<ul>
<li>Lot metadata and wafer count</li>
<li>Per-wafer yield trend</li>
<li>Lot-level aggregate bin breakdown</li>
<li>Cross-wafer comparison findings</li>
</ul>
<p><a href="https://telecasterer.github.io/wafermap/images/report-lot-summary.png">View image: Lot summary report</a></p>
<hr>
<h2>7. Lot-stack maps</h2>
<p>A lot-stack map combines multiple individual wafer results into a single
composite view. The display clearly identifies this: the number of wafers
included and the aggregation method in use are shown so you know you are
not viewing a single wafer&#39;s data.</p>
<p>Individual die coordinates are preserved. For each die grid position, results
from all wafers are aggregated into a single value or bin count according to
the selected aggregation method.</p>
<p>Stacked plot modes (Stacked Hard Bins, Stacked Soft Bins, Stacked Test Values)
are only available when a lot-stack map is active.</p>
<p>For lot-level findings across wafers in a gallery, see the lot-level summary
panel (Section 6) and <a href="images/guide-lot-findings-gallery.png">Section — Lot findings</a>:</p>
<p><a href="https://telecasterer.github.io/wafermap/images/guide-lot-findings-gallery.png">View image: Lot findings panel in gallery view</a></p>
<p><em>Gallery with lot-level summary panel open and a cross-wafer finding highlighted.</em></p>
<hr>
<h2>8. Reticle overlay</h2>
<p>When reticle (stepper field) geometry is configured, the <strong>Reticle grid</strong> overlay
draws the stepper field grid on the wafer. This lets you correlate failure
patterns with specific reticle positions — useful for identifying stepper field
signatures, alignment drift, or mask defects.</p>
<p><a href="https://telecasterer.github.io/wafermap/images/guide-reticle-overlay.png">View image: Reticle overlay active</a></p>
<p>Reticle-position findings in the Findings panel highlight the specific field
positions that show elevated failure rates.</p>
</div>`;
