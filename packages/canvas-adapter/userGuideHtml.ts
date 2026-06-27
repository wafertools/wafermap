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
.wmap-guide td img{width:20px;height:20px;max-width:none;display:inline-block;vertical-align:middle;border:none;border-radius:0;margin:0}
.wmap-guide a{color:#0066cc;text-decoration:none}
.wmap-guide a:hover{text-decoration:underline}
.wmap-guide-online-link{font-size:12px;color:#555;margin:-8px 0 18px;padding:8px 12px;background:#f4f5f7;border-radius:4px;border-left:3px solid #c0c4cc}
.wmap-guide-online-link a{color:#0066cc}
.wmap-demo{width:100%;height:220px;margin:12px 0;border:1px solid #e2e5ea;border-radius:6px;overflow:hidden;background:#f8f9fa}
.wmap-demo[data-wmap-demo="gallery"]{height:380px}
.wmap-demo[data-wmap-demo="findings"]{height:280px}
.wmap-demo[data-wmap-demo="summary-panel"]{height:300px}
.wmap-demo[data-wmap-demo="box-select"]{height:280px}
.wmap-guide--max{max-width:1000px}
@media print{
  /* Print only the guide content: hide the dimmed backdrop, the modal frame
     chrome (header/buttons), and let the guide flow at full width with its
     natural height. Without this, the browser prints the centred modal box
     (modal mode) or a single clipped viewport that is often blank (maximised
     mode, where the box is 100vh with overflow:hidden). */
  body{overflow:visible!important;height:auto!important}
  /* Hide the host app behind the modal; print only the backdrop subtree (the guide). */
  body > *{display:none!important}
  body > #wmap-modal-backdrop{position:static!important;background:none!important;backdrop-filter:none!important;display:block!important}
  .wmap-modal-box{position:static!important;width:auto!important;height:auto!important;max-width:none!important;max-height:none!important;box-shadow:none!important;border-radius:0!important;overflow:visible!important;display:block!important}
  .wmap-modal-box > div:first-child{display:none!important}
  /* contentWrap (flex container) and the scroll wrapper inside it both clip/scroll;
     unclip them so the full guide paginates instead of one screenful printing. */
  .wmap-modal-box > div:not(:first-child),.wmap-modal-box > div:not(:first-child) > div{display:block!important;overflow:visible!important;height:auto!important;flex:none!important;min-height:0!important}
  .wmap-guide,.wmap-guide--max{max-width:none!important;height:auto!important;overflow:visible!important;padding:0!important}
  .wmap-guide-online-link{display:none!important}
}
</style>
<h1 id="wafer-map-user-guide">Wafer Map — User Guide</h1>
<p class="wmap-guide-online-link">This is a quick reference. <a href="https://telecasterer.github.io/wafermap/user-guide/" target="_blank" rel="noopener">View the full illustrated guide online ↗</a></p>
<p>This guide describes the display and analysis features of the wafer map viewer.
It is written for users who may be semiconductor test engineers, device engineers, and yield engineers
or anyone else who may use a wafer map application — not for developers integrating the wafermap library.</p>
<p>Some features depend on what data the application has loaded (bin names, test
definitions, spec limits, reticle geometry). Where this applies it is noted.</p>
<p><strong>Getting oriented.</strong> The wafer map is an interactive viewer. A toolbar is always
present at the top-right of the map — use it to change what the colours represent,
toggle overlays, rotate or flip the wafer, zoom, select dies, and open the summary
panel. Hover any die for a tooltip; the panels and tooltips always report the
original die grid coordinates, never the on-screen position after a rotate or flip.</p>
<hr>
<h2 id="1-reading-the-map">1. Reading the map</h2>
<h3 id="11-die-grid-and-coordinates">1.1 Die grid and coordinates</h3>
<p>Each square on the wafer represents one die. The position labels you see — in
tooltips, axis ticks, and selection readouts — are <strong>die grid coordinates</strong>: usually the
X and Y step indices from the prober (integers such as −7, 0, 5). They are not
millimetre values.</p>
<p>These coordinates are always the original grid values. Rotating or flipping the
display does not change the coordinate labels — a die at (3, −2) always reads
(3, −2) regardless of how the wafer is oriented on screen.</p>
<h3 id="12-wafer-orientation">1.2 Wafer orientation</h3>
<p>The notch (shown as a V-notch or flat edge) marks the physical reference edge of
the wafer as configured. Use the <strong>Orientation</strong> toolbar controls to rotate or flip
the display to match your convention; die coordinates are unaffected.</p>
<div data-wmap-demo="bin-map" class="wmap-demo"></div><p><em>An example wafer bin map above and below the same wafer rotated 90°. The notch has moved, but die coordinates — shown in tooltips — remain their original grid/prober values.</em></p>
<div data-wmap-demo="orientation" class="wmap-demo"></div><h3 id="13-die-appearance">1.3 Die appearance</h3>
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
<tr>
<td>Dimmed fill (interior)</td>
<td>Edge-excluded die — falls within the edge exclusion band configured for this wafer</td>
</tr>
</tbody></table>
<p>No-data grey and partial-die grey are visually distinct. A no-data die is not a
fail; it simply has no result recorded. Edge-excluded dies are shown dimmed and are
not counted in yield calculations.</p>
<h3 id="14-legend-and-colorbar">1.4 Legend and colorbar</h3>
<p><strong>Bin modes</strong> show a discrete colour legend: one swatch per bin, with bin number
and name if the application has supplied bin names.</p>
<p><strong>Value mode</strong> shows a continuous colorbar: the colour scale runs from the minimum
to maximum value, with units when available. The colorbar is informational only —
clicking it has no effect. To filter by spec status, use the <strong>Spec pass/fail</strong>
option in the Overlays menu (available when spec limits are defined for the active test).</p>
<p><strong>Spec pass/fail mode</strong> replaces the colorbar with a small <strong>spec legend</strong>: Pass,
Fail high, and Fail low swatches (only the categories that apply to the test&#39;s
limits) with a die count beside each.</p>
<p>Every map also shows a short <strong>title</strong> by the colorbar or legend naming what is
displayed — the test name (and number, in spec mode), the bin type, or the stacked
wafer count.</p>
<p>Clicking a bin swatch in the legend filters the display to that bin
(see <a href="#3-toolbar-controls" onclick="(function(e){e.preventDefault();var g=e.target.closest('.wmap-guide');var el=g&&g.querySelector('[id=\\'3-toolbar-controls\\']');if(el)el.scrollIntoView({behavior:'smooth'});})(event)">Highlight bin</a>).</p>
<hr>
<h2 id="2-plot-modes">2. Plot modes</h2>
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
<h3 id="test-value-mode-colorbar-range-and-spec-limits">Test Value mode — colorbar range and spec limits</h3>
<p>When spec limits are defined for the active test, two additional display options
become available:</p>
<ul>
<li><strong>Colorbar range — Data / Spec</strong>: switches the colorbar scale between the
actual data extent and the spec limit bounds. This affects only the colorbar&#39;s
range, never how out-of-spec dies are shown. In <strong>both</strong> ranges every die is
coloured by the gradient so you can read the value distribution, and out-of-spec
dies are marked with a triangle — pointing <strong>down (▽) for below LSL</strong>, <strong>up (△)
for above USL</strong> — so they stand out without leaving the distribution. The
triangle is drawn black or white per die for contrast against its own colour, so
it stays visible under any colour scheme, and its shape (not colour) carries the
below/above-limit meaning.</li>
<li><strong>Spec pass/fail</strong>: when active, dies within spec are shown in a pass colour
and dies outside spec are highlighted — <strong>blue for below the Lower Spec Limit
(LSL)</strong>, <strong>red for above the Upper Spec Limit (USL)</strong>. Both flags apply
independently; a die can be flagged on either or both limits. A spec legend
replaces the colorbar, listing each applicable category with its die count.</li>
</ul>
<div data-wmap-demo="value-heatmap" class="wmap-demo"></div><div data-wmap-demo="spec-passfail" class="wmap-demo"></div><hr>
<h2 id="3-toolbar-controls">3. Toolbar controls</h2>
<p>The toolbar sits at the top-right of the map and is always visible. Controls that
are not applicable to the current mode are hidden automatically. (Hovering the map
shows die tooltips — a separate thing from the toolbar, which is always present.)</p>
<p><img src="data:image/png;base64,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" alt="Single-map toolbar"></p>
<h3 id="single-map">Single map</h3>
<table>
<thead>
<tr>
<th></th>
<th>Control</th>
<th>Description</th>
</tr>
</thead>
<tbody><tr>
<td><img src="data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgd2lkdGg9IjE2IiBoZWlnaHQ9IjE2IiBmaWxsPSJub25lIiBzdHJva2U9IiMzNzQxNTEiIHN0cm9rZS13aWR0aD0iMS44IiBzdHJva2UtbGluZWNhcD0icm91bmQiIHN0cm9rZS1saW5lam9pbj0icm91bmQiPgogIDxlbGxpcHNlIGN4PSIxMiIgY3k9IjciIHJ4PSI5IiByeT0iNCIgLz4KICAKICA8ZyBzdHJva2U9IiMzNzQxNTEiIHN0cm9rZS13aWR0aD0iMS40IiBvcGFjaXR5PSIwLjg1Ij4KICAgIDxsaW5lIHgxPSI0IiB5MT0iNyIgeDI9IjIwIiB5Mj0iNyIgLz4KICAgIDxsaW5lIHgxPSIxMiIgeTE9IjMuNSIgeDI9IjEyIiB5Mj0iMTAuNSIgLz4KICA8L2c+CiAgCiAgPHBhdGggZD0iTTMgMTIgYzAgMi41IDQgNCA5IDQgczktMS41IDktNCIgLz4KICAKICA8cGF0aCBkPSJNMyAxNyBjMCAyLjUgNCA0IDkgNCBzOS0xLjUgOS00IiAvPgo8L3N2Zz4K" width="20" height="20"></td>
<td>Plot mode</td>
<td>Switches the active plot mode (see <a href="#2-plot-modes" onclick="(function(e){e.preventDefault();var g=e.target.closest('.wmap-guide');var el=g&&g.querySelector('[id=\\'2-plot-modes\\']');if(el)el.scrollIntoView({behavior:'smooth'});})(event)">Section 2</a>). When multiple tests are available, a test selector appears alongside it.</td>
</tr>
<tr>
<td><img src="data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgd2lkdGg9IjE2IiBoZWlnaHQ9IjE2IiBmaWxsPSJub25lIiBzdHJva2U9IiMzNzQxNTEiIHN0cm9rZS13aWR0aD0iMS44IiBzdHJva2UtbGluZWNhcD0icm91bmQiIHN0cm9rZS1saW5lam9pbj0icm91bmQiPjxwYXRoIGQ9Ik0xOCA0SDZsNiA4LTYgOGgxMiIvPjwvc3ZnPgo=" width="20" height="20"></td>
<td>Aggregation method</td>
<td>Stacked modes only. Selects how values from multiple wafers are combined per die position: Mean, Median, Std Dev, Min, Max, or Count.</td>
</tr>
<tr>
<td><img src="data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgd2lkdGg9IjE2IiBoZWlnaHQ9IjE2IiBmaWxsPSJub25lIiBzdHJva2U9IiMzNzQxNTEiIHN0cm9rZS13aWR0aD0iMS44IiBzdHJva2UtbGluZWNhcD0icm91bmQiIHN0cm9rZS1saW5lam9pbj0icm91bmQiPjxwYXRoIGQ9Ik0yIDEyczMuNi03IDEwLTcgMTAgNyAxMCA3LTMuNiA3LTEwIDctMTAtNy0xMC03eiIvPjxjaXJjbGUgY3g9IjEyIiBjeT0iMTIiIHI9IjMiLz48L3N2Zz4K" width="20" height="20"></td>
<td>Overlays</td>
<td>Check-menu of optional display layers: XY axis indicator, ring boundaries, quadrant lines, die coordinate labels, reticle grid (when geometry is configured), and spec pass/fail highlighting (Test Value mode with limits).</td>
</tr>
<tr>
<td><img src="data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgd2lkdGg9IjE2IiBoZWlnaHQ9IjE2IiBmaWxsPSJub25lIiBzdHJva2U9IiMzNzQxNTEiIHN0cm9rZS13aWR0aD0iMS44IiBzdHJva2UtbGluZWNhcD0icm91bmQiIHN0cm9rZS1saW5lam9pbj0icm91bmQiPjxwYXRoIGQ9Im0xNC42MjIgMTcuODk3LTEwLjY4LTIuOTEzIi8+PHBhdGggZD0iTTE4LjM3NiAyLjYyMmExIDEgMCAxIDEgMy4wMDIgMy4wMDJMMTcuMzYgOS42NDNhLjUuNSAwIDAgMCAwIC43MDdsLjk0NC45NDRhMi40MSAyLjQxIDAgMCAxIDAgMy40MDhsLS45NDQuOTQ0YS41LjUgMCAwIDEtLjcwNyAwTDguMzU0IDcuMzQ4YS41LjUgMCAwIDEgMC0uNzA3bC45NDQtLjk0NGEyLjQxIDIuNDEgMCAwIDEgMy40MDggMGwuOTQ0Ljk0NGEuNS41IDAgMCAwIC43MDcgMHoiLz48cGF0aCBkPSJNOSA4Yy0xLjgwNCAyLjcxLTMuOTcgMy40Ni02LjU4MyAzLjk0OGEuNTA3LjUwNyAwIDAgMC0uMzAyLjgxOWw3LjMyIDguODgzYTEgMSAwIDAgMCAxLjE4NS4yMDRDMTIuNzM1IDIwLjQwNSAxNiAxNi43OTIgMTYgMTUiLz48L3N2Zz4K" width="20" height="20"></td>
<td>Colour scheme</td>
<td>Switches the colour palette used for value and stacked modes. Available schemes depend on what the application has registered.</td>
</tr>
<tr>
<td><img src="data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgd2lkdGg9IjE2IiBoZWlnaHQ9IjE2IiBmaWxsPSJub25lIiBzdHJva2U9IiMzNzQxNTEiIHN0cm9rZS13aWR0aD0iMS44IiBzdHJva2UtbGluZWNhcD0icm91bmQiIHN0cm9rZS1saW5lam9pbj0icm91bmQiPjxwYXRoIGQ9Ik01IDIxIEw1IDMiLz48cGF0aCBkPSJNMy41IDUgTDUgMyBMNi41IDUiLz48cGF0aCBkPSJNNSAyMSBMMjEgMjEiLz48cGF0aCBkPSJNMTkgMTkuNSBMMjEgMjEgTDE5IDIyLjUiLz48cGF0aCBkPSJNNiAyMCBDIDYgMTIsIDEwIDcsIDIwIDYiLz48L3N2Zz4K" width="20" height="20"></td>
<td>Log scale</td>
<td>Test Value and Stacked Test Values modes only. Applies a log₁₀ scale to the colour mapping. Only active when all displayed values are positive.</td>
</tr>
<tr>
<td><img src="data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgd2lkdGg9IjE2IiBoZWlnaHQ9IjE2IiBmaWxsPSJub25lIiBzdHJva2U9IiMzNzQxNTEiIHN0cm9rZS13aWR0aD0iMS44IiBzdHJva2UtbGluZWNhcD0icm91bmQiIHN0cm9rZS1saW5lam9pbj0icm91bmQiPjxyZWN0IHdpZHRoPSI3IiBoZWlnaHQ9IjciIHg9IjMiIHk9IjMiIHJ4PSIxIi8+PHJlY3Qgd2lkdGg9IjciIGhlaWdodD0iNyIgeD0iMyIgeT0iMTQiIHJ4PSIxIi8+PHBhdGggZD0iTTE0IDRoNyIvPjxwYXRoIGQ9Ik0xNCA5aDciLz48cGF0aCBkPSJNMTQgMTVoNyIvPjxwYXRoIGQ9Ik0xNCAyMGg3Ii8+PC9zdmc+Cg==" width="20" height="20"></td>
<td>Legend style</td>
<td>Bin modes only. Controls where the bin legend is positioned relative to the map: Default (right), Compact, Left, Top, Bottom, or Floating.</td>
</tr>
<tr>
<td><img src="data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgd2lkdGg9IjE2IiBoZWlnaHQ9IjE2IiBmaWxsPSJub25lIiBzdHJva2U9IiMzNzQxNTEiIHN0cm9rZS13aWR0aD0iMS44IiBzdHJva2UtbGluZWNhcD0icm91bmQiIHN0cm9rZS1saW5lam9pbj0icm91bmQiPjxwYXRoIGQ9Ik0yMSAxMmE5IDkgMCAxIDEtOS05YzIuNTIgMCA0LjkzIDEgNi43NCAyLjc0TDIxIDgiLz48cGF0aCBkPSJNMjEgM3Y1aC01Ii8+PC9zdmc+Cg==" width="20" height="20"></td>
<td>Rotate 90°</td>
<td>Rotates the display 90° clockwise. Applies cumulatively. Die coordinates are unaffected.</td>
</tr>
<tr>
<td><img src="data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgd2lkdGg9IjE2IiBoZWlnaHQ9IjE2IiBmaWxsPSJub25lIiBzdHJva2U9IiMzNzQxNTEiIHN0cm9rZS13aWR0aD0iMS44IiBzdHJva2UtbGluZWNhcD0icm91bmQiIHN0cm9rZS1saW5lam9pbj0icm91bmQiPjxwYXRoIGQ9Im0zIDcgNSA1LTUgNVY3Ii8+PHBhdGggZD0ibTIxIDctNSA1IDUgNVY3Ii8+PHBhdGggZD0iTTEyIDIwdjIiLz48cGF0aCBkPSJNMTIgMTR2MiIvPjxwYXRoIGQ9Ik0xMiA4djIiLz48cGF0aCBkPSJNMTIgMnYyIi8+PC9zdmc+Cg==" width="20" height="20"></td>
<td>Flip horizontal</td>
<td>Mirrors the display left/right. Die coordinates are unaffected.</td>
</tr>
<tr>
<td><img src="data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgd2lkdGg9IjE2IiBoZWlnaHQ9IjE2IiBmaWxsPSJub25lIiBzdHJva2U9IiMzNzQxNTEiIHN0cm9rZS13aWR0aD0iMS44IiBzdHJva2UtbGluZWNhcD0icm91bmQiIHN0cm9rZS1saW5lam9pbj0icm91bmQiPjxwYXRoIGQ9Im0xNyAzLTUgNS01LTVoMTAiLz48cGF0aCBkPSJtMTcgMjEtNS01LTUgNWgxMCIvPjxwYXRoIGQ9Ik00IDEySDIiLz48cGF0aCBkPSJNMTAgMTJIOCIvPjxwYXRoIGQ9Ik0xNiAxMmgtMiIvPjxwYXRoIGQ9Ik0yMiAxMmgtMiIvPjwvc3ZnPgo=" width="20" height="20"></td>
<td>Flip vertical</td>
<td>Mirrors the display top/bottom. Die coordinates are unaffected.</td>
</tr>
<tr>
<td><img src="data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgd2lkdGg9IjE2IiBoZWlnaHQ9IjE2IiBmaWxsPSJub25lIiBzdHJva2U9IiMzNzQxNTEiIHN0cm9rZS13aWR0aD0iMS44IiBzdHJva2UtbGluZWNhcD0icm91bmQiIHN0cm9rZS1saW5lam9pbj0icm91bmQiPjxwYXRoIGQ9Im0xMyAxMy41IDItMi41LTItMi41Ii8+PHBhdGggZD0ibTIxIDIxLTQuMy00LjMiLz48cGF0aCBkPSJNOSA4LjUgNyAxMWwyIDIuNSIvPjxjaXJjbGUgY3g9IjExIiBjeT0iMTEiIHI9IjgiLz48L3N2Zz4K" width="20" height="20"></td>
<td>Zoom mode</td>
<td>Click and drag to draw a zoom region.</td>
</tr>
<tr>
<td><img src="data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgd2lkdGg9IjE2IiBoZWlnaHQ9IjE2IiBmaWxsPSJub25lIiBzdHJva2U9IiMzNzQxNTEiIHN0cm9rZS13aWR0aD0iMS44IiBzdHJva2UtbGluZWNhcD0icm91bmQiIHN0cm9rZS1saW5lam9pbj0icm91bmQiPjxjaXJjbGUgY3g9IjExIiBjeT0iMTEiIHI9IjgiLz48bGluZSB4MT0iMjEiIHgyPSIxNi42NSIgeTE9IjIxIiB5Mj0iMTYuNjUiLz48bGluZSB4MT0iMTEiIHgyPSIxMSIgeTE9IjgiIHkyPSIxNCIvPjxsaW5lIHgxPSI4IiB4Mj0iMTQiIHkxPSIxMSIgeTI9IjExIi8+PC9zdmc+Cg==" width="20" height="20"></td>
<td>Zoom in</td>
<td>Zooms in one step.</td>
</tr>
<tr>
<td><img src="data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgd2lkdGg9IjE2IiBoZWlnaHQ9IjE2IiBmaWxsPSJub25lIiBzdHJva2U9IiMzNzQxNTEiIHN0cm9rZS13aWR0aD0iMS44IiBzdHJva2UtbGluZWNhcD0icm91bmQiIHN0cm9rZS1saW5lam9pbj0icm91bmQiPjxjaXJjbGUgY3g9IjExIiBjeT0iMTEiIHI9IjgiLz48bGluZSB4MT0iMjEiIHgyPSIxNi42NSIgeTE9IjIxIiB5Mj0iMTYuNjUiLz48bGluZSB4MT0iOCIgeDI9IjE0IiB5MT0iMTEiIHkyPSIxMSIvPjwvc3ZnPgo=" width="20" height="20"></td>
<td>Zoom out</td>
<td>Zooms out one step.</td>
</tr>
<tr>
<td><img src="data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgd2lkdGg9IjE2IiBoZWlnaHQ9IjE2IiBmaWxsPSJub25lIiBzdHJva2U9IiMzNzQxNTEiIHN0cm9rZS13aWR0aD0iMS44IiBzdHJva2UtbGluZWNhcD0icm91bmQiIHN0cm9rZS1saW5lam9pbj0icm91bmQiPjxwYXRoIGQ9Ik0xNSAyMXYtOGExIDEgMCAwIDAtMS0xaC00YTEgMSAwIDAgMC0xIDF2OCIvPjxwYXRoIGQ9Ik0zIDEwYTIgMiAwIDAgMSAuNzA5LTEuNTI4bDctNmEyIDIgMCAwIDEgMi41ODIgMGw3IDZBMiAyIDAgMCAxIDIxIDEwdjlhMiAyIDAgMCAxLTIgMkg1YTIgMiAwIDAgMS0yLTJ6Ii8+PC9zdmc+Cg==" width="20" height="20"></td>
<td>Reset zoom</td>
<td>Returns the map to the default fitted view.</td>
</tr>
<tr>
<td><img src="data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgd2lkdGg9IjE2IiBoZWlnaHQ9IjE2IiBmaWxsPSJub25lIiBzdHJva2U9IiMzNzQxNTEiIHN0cm9rZS13aWR0aD0iMS44IiBzdHJva2UtbGluZWNhcD0icm91bmQiIHN0cm9rZS1saW5lam9pbj0icm91bmQiPjxwYXRoIGQ9Ik0xMiAydjIwIi8+PHBhdGggZD0ibTE1IDE5LTMgMy0zLTMiLz48cGF0aCBkPSJtMTkgOSAzIDMtMyAzIi8+PHBhdGggZD0iTTIgMTJoMjAiLz48cGF0aCBkPSJtNSA5LTMgMyAzIDMiLz48cGF0aCBkPSJtOSA1IDMtMyAzIDMiLz48L3N2Zz4K" width="20" height="20"></td>
<td>Pan mode</td>
<td>Click and drag to pan the map.</td>
</tr>
<tr>
<td><img src="data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgd2lkdGg9IjE2IiBoZWlnaHQ9IjE2IiBmaWxsPSJub25lIiBzdHJva2U9IiMzNzQxNTEiIHN0cm9rZS13aWR0aD0iMS44IiBzdHJva2UtbGluZWNhcD0icm91bmQiIHN0cm9rZS1saW5lam9pbj0icm91bmQiPjxwYXRoIGQ9Ik01IDNhMiAyIDAgMCAwLTIgMiIvPjxwYXRoIGQ9Ik0xOSAzYTIgMiAwIDAgMSAyIDIiLz48cGF0aCBkPSJNMjEgMTlhMiAyIDAgMCAxLTIgMiIvPjxwYXRoIGQ9Ik01IDIxYTIgMiAwIDAgMS0yLTIiLz48cGF0aCBkPSJNOSAzaDEiLz48cGF0aCBkPSJNOSAyMWgxIi8+PHBhdGggZD0iTTE0IDNoMSIvPjxwYXRoIGQ9Ik0xNCAyMWgxIi8+PHBhdGggZD0iTTMgOXYxIi8+PHBhdGggZD0iTTIxIDl2MSIvPjxwYXRoIGQ9Ik0zIDE0djEiLz48cGF0aCBkPSJNMjEgMTR2MSIvPjwvc3ZnPgo=" width="20" height="20"></td>
<td>Box select</td>
<td>Click and drag to select a rectangular group of dies (see <a href="#43-box-select" onclick="(function(e){e.preventDefault();var g=e.target.closest('.wmap-guide');var el=g&&g.querySelector('[id=\\'43-box-select\\']');if(el)el.scrollIntoView({behavior:'smooth'});})(event)">Section 4.3</a>).</td>
</tr>
<tr>
<td><img src="data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgd2lkdGg9IjE2IiBoZWlnaHQ9IjE2IiBmaWxsPSJub25lIiBzdHJva2U9IiMzNzQxNTEiIHN0cm9rZS13aWR0aD0iMS44IiBzdHJva2UtbGluZWNhcD0icm91bmQiIHN0cm9rZS1saW5lam9pbj0icm91bmQiPjxwYXRoIGQ9Ik0xNSAzaDZ2NiIvPjxwYXRoIGQ9Ik05IDIxSDN2LTYiLz48cGF0aCBkPSJNMjEgM2wtNyA3Ii8+PHBhdGggZD0iTTMgMjFsNy03Ii8+PC9zdmc+Cg==" width="20" height="20"></td>
<td>Expand</td>
<td>Opens the map in an enlarged modal overlay. A maximise button in the modal grows it to fill the window (or press <strong>F</strong>). Press <strong>Esc</strong> or click outside to close. Useful for detailed inspection without changing the main view.</td>
</tr>
<tr>
<td><img src="data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgd2lkdGg9IjE2IiBoZWlnaHQ9IjE2IiBmaWxsPSJub25lIiBzdHJva2U9IiMzNzQxNTEiIHN0cm9rZS13aWR0aD0iMS44IiBzdHJva2UtbGluZWNhcD0icm91bmQiIHN0cm9rZS1saW5lam9pbj0icm91bmQiPjxwYXRoIGQ9Ik0xMy45OTcgNGEyIDIgMCAwIDEgMS43NiAxLjA1bC40ODYuOUEyIDIgMCAwIDAgMTguMDAzIDdIMjBhMiAyIDAgMCAxIDIgMnY5YTIgMiAwIDAgMS0yIDJINGEyIDIgMCAwIDEtMi0yVjlhMiAyIDAgMCAxIDItMmgxLjk5N2EyIDIgMCAwIDAgMS43NTktMS4wNDhsLjQ4OS0uOTA0QTIgMiAwIDAgMSAxMC4wMDQgNHoiLz48Y2lyY2xlIGN4PSIxMiIgY3k9IjEzIiByPSIzIi8+PC9zdmc+Cg==" width="20" height="20"></td>
<td>Save image</td>
<td>Downloads the current map view as a PNG. Captures the canvas as displayed, including all active overlays and the legend.</td>
</tr>
<tr>
<td><img src="data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxNiIgaGVpZ2h0PSIxNiIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJub25lIiBzdHJva2U9IiMzNzQxNTEiIHN0cm9rZS13aWR0aD0iMiIgc3Ryb2tlLWxpbmVjYXA9InJvdW5kIiBzdHJva2UtbGluZWpvaW49InJvdW5kIj48cGF0aCBkPSJNOCAydjQiLz48cGF0aCBkPSJNMTIgMnY0Ii8+PHBhdGggZD0iTTE2IDJ2NCIvPjxyZWN0IHdpZHRoPSIxNiIgaGVpZ2h0PSIxOCIgeD0iNCIgeT0iNCIgcng9IjIiLz48cGF0aCBkPSJNOCAxMGg2Ii8+PHBhdGggZD0iTTggMTRoOCIvPjxwYXRoIGQ9Ik04IDE4aDUiLz48L3N2Zz4K" width="20" height="20"></td>
<td>Summary panel</td>
<td>Opens or closes the summary panel (see <a href="#6-summary-panel" onclick="(function(e){e.preventDefault();var g=e.target.closest('.wmap-guide');var el=g&&g.querySelector('[id=\\'6-summary-panel\\']');if(el)el.scrollIntoView({behavior:'smooth'});})(event)">Section 6</a>).</td>
</tr>
<tr>
<td><img src="data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxNiIgaGVpZ2h0PSIxNiIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJub25lIiBzdHJva2U9IiMzNzQxNTEiIHN0cm9rZS13aWR0aD0iMiIgc3Ryb2tlLWxpbmVjYXA9InJvdW5kIiBzdHJva2UtbGluZWpvaW49InJvdW5kIj48Y2lyY2xlIGN4PSIxMiIgY3k9IjEyIiByPSIxMCIvPjxwYXRoIGQ9Ik05LjA5IDlhMyAzIDAgMCAxIDUuODMgMWMwIDItMyAzLTMgMyIvPjxwYXRoIGQ9Ik0xMiAxN2guMDEiLz48L3N2Zz4K" width="20" height="20"></td>
<td>User guide</td>
<td>Opens this guide.</td>
</tr>
</tbody></table>
<p><strong>Highlight bin</strong> — in bin modes, click any bin swatch in the legend to highlight
that bin and dim all others. Click again to clear. Useful for isolating a specific
failure category across the wafer.</p>
<div data-wmap-demo="bin-highlight" class="wmap-demo"></div><p><em>Bin 2 (Fail) highlighted — all other bins are dimmed.</em></p>
<h3 id="overlays">Overlays</h3>
<p>Use the <strong>Overlays</strong> menu to toggle optional display layers on and off:</p>
<ul>
<li><strong>XY axis indicator</strong> — shows X and Y axis lines through the wafer centre</li>
<li><strong>Ring boundaries</strong> — concentric ring divisions that match the spatial analysis zones</li>
<li><strong>Quadrant lines</strong> — divides the wafer into N, S, E, W quadrants</li>
<li><strong>Die coordinate labels</strong> — draws the (x, y) grid position inside each die (useful at high zoom)</li>
<li><strong>Reticle grid</strong> — stepper field grid (only shown when reticle geometry is configured)</li>
<li><strong>Colour by spec</strong> — pass/fail colouring for Test Value mode when spec limits are defined</li>
</ul>
<div data-wmap-demo="overlays" class="wmap-demo"></div><p><em>Ring boundaries, quadrant lines, and XY indicator all active.</em></p>
<h3 id="keyboard-shortcuts">Keyboard shortcuts</h3>
<table>
<thead>
<tr>
<th>Key</th>
<th>Action</th>
</tr>
</thead>
<tbody><tr>
<td><strong>E</strong></td>
<td>Open the map in an enlarged modal overlay</td>
</tr>
<tr>
<td><strong>F</strong></td>
<td>Maximise / restore the modal (when expanded)</td>
</tr>
<tr>
<td><strong>Esc</strong></td>
<td>Close the expanded modal, or clear the die selection</td>
</tr>
<tr>
<td><strong>Ctrl / Cmd + click</strong></td>
<td>Add a die to the current selection</td>
</tr>
<tr>
<td><strong>Mouse wheel / scroll</strong></td>
<td>Zoom in and out at the cursor</td>
</tr>
<tr>
<td><strong>Ctrl / Cmd + <code>+</code></strong> / <strong><code>-</code></strong></td>
<td>Zoom in / zoom out</td>
</tr>
<tr>
<td><strong>Ctrl / Cmd + <code>0</code></strong></td>
<td>Reset zoom to the fitted view</td>
</tr>
<tr>
<td><strong>Arrow keys</strong></td>
<td>Pan the map</td>
</tr>
<tr>
<td><strong>Space (hold) + drag</strong></td>
<td>Temporarily pan without leaving the current tool</td>
</tr>
</tbody></table>
<h3 id="gallery">Gallery</h3>
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
<td><img src="data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgd2lkdGg9IjE2IiBoZWlnaHQ9IjE2IiBmaWxsPSJub25lIiBzdHJva2U9IiMzNzQxNTEiIHN0cm9rZS13aWR0aD0iMS44IiBzdHJva2UtbGluZWNhcD0icm91bmQiIHN0cm9rZS1saW5lam9pbj0icm91bmQiPgogIDxlbGxpcHNlIGN4PSIxMiIgY3k9IjciIHJ4PSI5IiByeT0iNCIgLz4KICAKICA8ZyBzdHJva2U9IiMzNzQxNTEiIHN0cm9rZS13aWR0aD0iMS40IiBvcGFjaXR5PSIwLjg1Ij4KICAgIDxsaW5lIHgxPSI0IiB5MT0iNyIgeDI9IjIwIiB5Mj0iNyIgLz4KICAgIDxsaW5lIHgxPSIxMiIgeTE9IjMuNSIgeDI9IjEyIiB5Mj0iMTAuNSIgLz4KICA8L2c+CiAgCiAgPHBhdGggZD0iTTMgMTIgYzAgMi41IDQgNCA5IDQgczktMS41IDktNCIgLz4KICAKICA8cGF0aCBkPSJNMyAxNyBjMCAyLjUgNCA0IDkgNCBzOS0xLjUgOS00IiAvPgo8L3N2Zz4K" width="20" height="20"></td>
<td>Plot mode</td>
<td>Switches the plot mode for all cards.</td>
</tr>
<tr>
<td><img src="data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgd2lkdGg9IjE2IiBoZWlnaHQ9IjE2IiBmaWxsPSJub25lIiBzdHJva2U9IiMzNzQxNTEiIHN0cm9rZS13aWR0aD0iMS44IiBzdHJva2UtbGluZWNhcD0icm91bmQiIHN0cm9rZS1saW5lam9pbj0icm91bmQiPjxwYXRoIGQ9Ik0yIDEyczMuNi03IDEwLTcgMTAgNyAxMCA3LTMuNiA3LTEwIDctMTAtNy0xMC03eiIvPjxjaXJjbGUgY3g9IjEyIiBjeT0iMTIiIHI9IjMiLz48L3N2Zz4K" width="20" height="20"></td>
<td>Overlays</td>
<td>Toggles display layers for all cards simultaneously.</td>
</tr>
<tr>
<td><img src="data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgd2lkdGg9IjE2IiBoZWlnaHQ9IjE2IiBmaWxsPSJub25lIiBzdHJva2U9IiMzNzQxNTEiIHN0cm9rZS13aWR0aD0iMS44IiBzdHJva2UtbGluZWNhcD0icm91bmQiIHN0cm9rZS1saW5lam9pbj0icm91bmQiPjxwYXRoIGQ9Im0xNC42MjIgMTcuODk3LTEwLjY4LTIuOTEzIi8+PHBhdGggZD0iTTE4LjM3NiAyLjYyMmExIDEgMCAxIDEgMy4wMDIgMy4wMDJMMTcuMzYgOS42NDNhLjUuNSAwIDAgMCAwIC43MDdsLjk0NC45NDRhMi40MSAyLjQxIDAgMCAxIDAgMy40MDhsLS45NDQuOTQ0YS41LjUgMCAwIDEtLjcwNyAwTDguMzU0IDcuMzQ4YS41LjUgMCAwIDEgMC0uNzA3bC45NDQtLjk0NGEyLjQxIDIuNDEgMCAwIDEgMy40MDggMGwuOTQ0Ljk0NGEuNS41IDAgMCAwIC43MDcgMHoiLz48cGF0aCBkPSJNOSA4Yy0xLjgwNCAyLjcxLTMuOTcgMy40Ni02LjU4MyAzLjk0OGEuNTA3LjUwNyAwIDAgMC0uMzAyLjgxOWw3LjMyIDguODgzYTEgMSAwIDAgMCAxLjE4NS4yMDRDMTIuNzM1IDIwLjQwNSAxNiAxNi43OTIgMTYgMTUiLz48L3N2Zz4K" width="20" height="20"></td>
<td>Colour scheme</td>
<td>Switches the colour palette for all cards.</td>
</tr>
<tr>
<td><img src="data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgd2lkdGg9IjE2IiBoZWlnaHQ9IjE2IiBmaWxsPSJub25lIiBzdHJva2U9IiMzNzQxNTEiIHN0cm9rZS13aWR0aD0iMS44IiBzdHJva2UtbGluZWNhcD0icm91bmQiIHN0cm9rZS1saW5lam9pbj0icm91bmQiPjxjaXJjbGUgY3g9IjEyIiBjeT0iMTIiIHI9IjEwIi8+PHBvbHlnb24gcG9pbnRzPSIxNi4yNCA3Ljc2IDE0LjEyIDE0LjEyIDcuNzYgMTYuMjQgOS44OCA5Ljg4IDE2LjI0IDcuNzYiIGZpbGw9IiMzNzQxNTEiIHN0cm9rZT0ibm9uZSIvPjwvc3ZnPgo=" width="20" height="20"></td>
<td>Orientation</td>
<td>Opens the rotate/flip controls, applied to all cards.</td>
</tr>
<tr>
<td><img src="data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgd2lkdGg9IjE2IiBoZWlnaHQ9IjE2IiBmaWxsPSJub25lIiBzdHJva2U9IiMzNzQxNTEiIHN0cm9rZS13aWR0aD0iMS44IiBzdHJva2UtbGluZWNhcD0icm91bmQiIHN0cm9rZS1saW5lam9pbj0icm91bmQiPgogIDxyZWN0IHg9IjMiIHk9IjMiIHdpZHRoPSI0IiBoZWlnaHQ9IjE4IiByeD0iMSIvPgogIDxyZWN0IHg9IjEwIiB5PSIzIiB3aWR0aD0iNCIgaGVpZ2h0PSIxOCIgcng9IjEiLz4KICA8cmVjdCB4PSIxNyIgeT0iMyIgd2lkdGg9IjQiIGhlaWdodD0iMTgiIHJ4PSIxIi8+Cjwvc3ZnPgo=" width="20" height="20"></td>
<td>Columns</td>
<td>Sets the number of columns in the card grid.</td>
</tr>
<tr>
<td><img src="data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgd2lkdGg9IjE2IiBoZWlnaHQ9IjE2IiBmaWxsPSJub25lIiBzdHJva2U9IiMzNzQxNTEiIHN0cm9rZS13aWR0aD0iMS44IiBzdHJva2UtbGluZWNhcD0icm91bmQiIHN0cm9rZS1saW5lam9pbj0icm91bmQiPjxwYXRoIGQ9Ik0xMy45OTcgNGEyIDIgMCAwIDEgMS43NiAxLjA1bC40ODYuOUEyIDIgMCAwIDAgMTguMDAzIDdIMjBhMiAyIDAgMCAxIDIgMnY5YTIgMiAwIDAgMS0yIDJINGEyIDIgMCAwIDEtMi0yVjlhMiAyIDAgMCAxIDItMmgxLjk5N2EyIDIgMCAwIDAgMS43NTktMS4wNDhsLjQ4OS0uOTA0QTIgMiAwIDAgMSAxMC4wMDQgNHoiLz48Y2lyY2xlIGN4PSIxMiIgY3k9IjEzIiByPSIzIi8+PC9zdmc+Cg==" width="20" height="20"></td>
<td>Save image</td>
<td>Downloads the full gallery grid as a single PNG.</td>
</tr>
<tr>
<td><img src="data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxNiIgaGVpZ2h0PSIxNiIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJub25lIiBzdHJva2U9IiMzNzQxNTEiIHN0cm9rZS13aWR0aD0iMiIgc3Ryb2tlLWxpbmVjYXA9InJvdW5kIiBzdHJva2UtbGluZWpvaW49InJvdW5kIj48cGF0aCBkPSJNOCAydjQiLz48cGF0aCBkPSJNMTIgMnY0Ii8+PHBhdGggZD0iTTE2IDJ2NCIvPjxyZWN0IHdpZHRoPSIxNiIgaGVpZ2h0PSIxOCIgeD0iNCIgeT0iNCIgcng9IjIiLz48cGF0aCBkPSJNOCAxMGg2Ii8+PHBhdGggZD0iTTggMTRoOCIvPjxwYXRoIGQ9Ik04IDE4aDUiLz48L3N2Zz4K" width="20" height="20"></td>
<td>Summary panel</td>
<td>Opens or closes the lot-level summary panel.</td>
</tr>
</tbody></table>
<p>Click any gallery card to expand it to a full single-wafer view with the complete
single-map toolbar.</p>
<div data-wmap-demo="gallery" class="wmap-demo"></div><hr>
<h2 id="4-interacting-with-dies">4. Interacting with dies</h2>
<h3 id="41-hover">4.1 Hover</h3>
<p>Hovering over a die shows a tooltip with:</p>
<ul>
<li>Die grid coordinates (x, y)</li>
<li>Hard bin and/or soft bin (with name, if named)</li>
<li>Test values for all loaded tests</li>
<li>Retest count if the die was probed more than once</li>
</ul>
<h3 id="42-zoom-and-pan">4.2 Zoom and pan</h3>
<p>Scroll to zoom in and out. Click and drag to pan when in Pan mode. The toolbar
also provides dedicated <strong>Zoom mode</strong> (drag to draw a zoom region), <strong>Zoom in</strong>,
<strong>Zoom out</strong>, and <strong>Reset zoom</strong> buttons. Tooltips and die selection remain
accurate at all zoom levels.</p>
<h3 id="43-box-select">4.3 Box select</h3>
<p>Switch to Box select mode in the toolbar, then click and drag to draw a selection
rectangle. The application may display statistics or details for the selected
dies. This is useful for comparing a sub-region against the full wafer.
Use <strong>Ctrl / Cmd + click</strong> to add individual dies to the current selection.
Press <strong>Esc</strong> to clear.</p>
<div data-wmap-demo="box-select" class="wmap-demo"></div><p><em>A block of dies near the centre is shown pre-selected. Choose Box select in the
toolbar and drag to make your own selection, or Ctrl/Cmd + click individual dies.</em></p>
<hr>
<h2 id="5-findings-panel">5. Findings panel</h2>
<p>When spatial analysis has been run, the <strong>Findings</strong> panel lists statistically
detected patterns on the wafer. Open it from the toolbar.</p>
<p>Each finding shows:</p>
<ul>
<li><strong>Severity</strong> — Unusual, Notable, or Info (ordered most to least significant)</li>
<li><strong>Description</strong> — plain-language summary of what was detected and where</li>
<li><strong>Click to highlight</strong> — clicking a finding highlights the affected dies on
the map in amber</li>
</ul>
<p><strong>Severity</strong> reflects how strong the statistical evidence is. <em>Unusual</em> findings
have both a very low adjusted p-value and a large effect size — they are reliably
important. <em>Notable</em> findings are statistically significant with a meaningful
effect but not as extreme. <em>Info</em> findings pass the significance threshold at
lower strength and are worth reviewing but may reflect smaller or noisier patterns.</p>
<div data-wmap-demo="findings" class="wmap-demo"></div><p><em>Findings panel open showing a detected edge-ring pattern. Click any row to
highlight the affected dies on the map.</em></p>
<h3 id="finding-types">Finding types</h3>
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
<h2 id="6-summary-panel">6. Summary panel</h2>
<p>The summary panel shows statistics and metadata for the current wafer or lot.
Open it from the toolbar.</p>
<div data-wmap-demo="summary-panel" class="wmap-demo"></div><p><em>The summary panel open alongside a single wafer, showing yield, bin breakdown,
and per-test statistics. Click any finding to highlight the affected dies.</em></p>
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
in a new window or tab. The report contains everything shown in the panel —
yield, bin breakdown, ring and quadrant statistics, per-test statistics, and the
full findings list — and can be saved as a PDF from your browser&#39;s print dialog.</p>
<p>For <strong>lot-level views</strong> (gallery), the panel shows:</p>
<ul>
<li>Lot metadata and wafer count</li>
<li>Per-wafer yield trend</li>
<li>Lot-level aggregate bin breakdown</li>
<li>Cross-wafer comparison findings</li>
</ul>
<hr>
<h2 id="7-lot-stack-maps">7. Lot-stack maps</h2>
<p>A lot-stack map combines multiple individual wafer results into a single
composite view. The display clearly identifies this: the number of wafers
included and the aggregation method in use are shown in the panel header
(for example, &quot;3 wafers · mean&quot;) so you know you are not viewing a single
wafer&#39;s data.</p>
<p>Individual die coordinates are preserved. For each die grid position, results
from all wafers are aggregated into a single value or bin count according to
the selected aggregation method.</p>
<h3 id="stacked-plot-modes">Stacked plot modes</h3>
<p>Switching to a stacked mode changes what each die&#39;s colour represents:</p>
<table>
<thead>
<tr>
<th>Mode</th>
<th>What the colour shows</th>
</tr>
</thead>
<tbody><tr>
<td><strong>Stacked Hard Bins</strong></td>
<td>For each die position, the count of wafers on which that bin appeared — one card per bin category</td>
</tr>
<tr>
<td><strong>Stacked Soft Bins</strong></td>
<td>Same as above, for soft bin categories</td>
</tr>
<tr>
<td><strong>Stacked Test Values</strong></td>
<td>For each die position, an aggregate of the test measurement across all wafers</td>
</tr>
</tbody></table>
<h3 id="aggregation-method">Aggregation method</h3>
<p>In <strong>Stacked Test Values</strong> mode, use the <strong>Aggregation method</strong> toolbar button (Σ)
to choose how values from each wafer are combined at each die position:</p>
<table>
<thead>
<tr>
<th>Method</th>
<th>Result</th>
</tr>
</thead>
<tbody><tr>
<td><strong>Mean</strong></td>
<td>Average value across all wafers</td>
</tr>
<tr>
<td><strong>Median</strong></td>
<td>Middle value — less sensitive to outliers than mean</td>
</tr>
<tr>
<td><strong>Std Dev</strong></td>
<td>Standard deviation — shows where values vary most across the lot</td>
</tr>
<tr>
<td><strong>Min</strong></td>
<td>Lowest value seen at that position</td>
</tr>
<tr>
<td><strong>Max</strong></td>
<td>Highest value seen at that position</td>
</tr>
<tr>
<td><strong>Count</strong></td>
<td>Number of wafers with data at that position</td>
</tr>
</tbody></table>
<h3 id="gallery-stacked-modes">Gallery stacked modes</h3>
<p>In a gallery, stacked modes are always available in the control bar. Switching to
a stacked mode shows one card per bin category or per test parameter, aggregated
across all wafers in the gallery.</p>
<div data-wmap-demo="lot-stack" class="wmap-demo"></div><p><em>Stacked Hard Bins mode: each die position is coloured by how many wafers had
bin 1 (Pass) or bin 2 (Fail) at that location.</em></p>
<hr>
<h2 id="8-reticle-overlay">8. Reticle overlay</h2>
<p>When reticle (stepper field) geometry is configured, the <strong>Reticle grid</strong> overlay
draws the stepper field boundaries on the wafer. Each rectangle represents one
exposure field from the lithography stepper — the group of dies exposed in a
single step. This lets you correlate failure patterns with specific reticle
positions — useful for identifying stepper field signatures, alignment drift, or
mask defects.</p>
<div data-wmap-demo="reticle" class="wmap-demo"></div><p>Reticle-position findings in the Findings panel highlight the specific field
positions that show elevated failure rates.</p>
<script>// Inline demo script for the embedded user guide modal.
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
            return Object.assign({}, r, { label: 'Wafer ' + (n + 1) });
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
          // computePerTestStats: true adds the cheap per-test value summary to the
          // panel without the heavier regional test-value findings pass.
          var spSummary = analyzeWaferMap ? analyzeWaferMap(spResult, { computePerTestStats: true }) : null;
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
</script></div>`;
