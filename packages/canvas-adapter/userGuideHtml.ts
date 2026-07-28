// @generated — do not edit directly.
// Source: docs/user-guide.md
// Regenerate with: npm run build:guide
// Auto-regenerated on every: npm run build

export const USER_GUIDE_HTML = `<div class="wmap-guide">
<style>
.wmap-guide{font-family:system-ui,-apple-system,sans-serif;font-size:14px;line-height:1.65;color:var(--wmap-text,#1a1a1a);padding:24px 32px;max-width:720px;margin:0 auto;overflow-y:auto;height:100%;box-sizing:border-box}
.wmap-guide h1{display:flex;align-items:baseline;justify-content:space-between;gap:12px;font-size:1.35em;font-weight:700;margin:0 0 18px;padding-bottom:10px;border-bottom:2px solid var(--wmap-border,#e2e5ea);color:var(--wmap-text,#111)}
.wmap-guide-version{font-size:11px;font-weight:400;color:var(--wmap-text-muted,#888);white-space:nowrap}
.wmap-guide h2{font-size:1.1em;font-weight:700;margin:28px 0 10px;padding-bottom:6px;border-bottom:1px solid var(--wmap-border,#e9eaec);color:var(--wmap-text,#1a1a1a)}
.wmap-guide h3{font-size:1em;font-weight:700;margin:20px 0 6px;color:var(--wmap-text,#222);display:flex;align-items:center;gap:6px}
.wmap-guide h3 img{width:20px;height:20px;display:inline;vertical-align:middle;border:none;border-radius:0;margin:0}
.wmap-guide p{margin:0 0 12px}
.wmap-guide ul,.wmap-guide ol{margin:0 0 12px;padding-left:22px}
.wmap-guide li{margin-bottom:4px}
.wmap-guide table{border-collapse:collapse;width:100%;margin:0 0 16px;font-size:13px}
.wmap-guide th{background:var(--wmap-panel-bg,#f4f5f7);text-align:left;padding:7px 10px;font-weight:600;border:1px solid var(--wmap-border,#d8dce2)}
.wmap-guide td{padding:6px 10px;border:1px solid var(--wmap-border,#e2e5ea);vertical-align:middle}
.wmap-guide tr:nth-child(even) td{background:var(--wmap-bg-hover,#fafbfc)}
.wmap-guide strong{font-weight:600}
.wmap-guide code{font-family:monospace;font-size:12px;background:var(--wmap-bg-active,#f0f2f5);padding:1px 4px;border-radius:3px}
.wmap-guide hr{border:none;border-top:1px solid var(--wmap-border,#e9eaec);margin:24px 0}
.wmap-guide img{max-width:100%;height:auto;border:1px solid var(--wmap-border,#e2e5ea);border-radius:6px;margin:8px 0;display:block}
.wmap-guide td img{width:20px;height:20px;max-width:none;display:inline-block;vertical-align:middle;border:none;border-radius:0;margin:0}
.wmap-guide a{color:var(--wmap-icon-active,#0066cc);text-decoration:none}
.wmap-guide a:hover{text-decoration:underline}
.wmap-guide-online-link{font-size:12px;color:var(--wmap-text-muted,#555);margin:-8px 0 18px;padding:8px 12px;background:var(--wmap-panel-bg,#f4f5f7);border-radius:4px;border-left:3px solid var(--wmap-border,#c0c4cc)}
.wmap-guide-online-link a{color:var(--wmap-icon-active,#0066cc)}
.wmap-demo{width:100%;height:220px;margin:12px 0;border:1px solid #e2e5ea;border-radius:6px;overflow:hidden;background:#f8f9fa}
.wmap-demo[data-wmap-demo="gallery"]{height:380px}
.wmap-demo[data-wmap-demo="findings"]{height:280px}
.wmap-demo[data-wmap-demo="summary-panel"]{height:300px}
.wmap-demo[data-wmap-demo="box-select"]{height:280px}
.wmap-demo[data-wmap-demo="analysis"]{height:600px}
.wmap-guide--max{max-width:1000px}
@media print{
  /* Print only the guide's own content, never the host page, and never a
     clipped single screenful. The guide window opens one of two ways
     (toolbar.ts's openUserGuideWindow) and this must handle both:
     - a real popup (openGuideInPopup): buildGuideContent's content div
       (class wmap-guide-content) is body's ONLY child directly — body
       itself is height:100vh;overflow:hidden for the screen layout, which
       without an override clips print to a single blank-looking page.
     - the in-page floating-window fallback (openGuideInFloatingWindow,
       used whenever window.open() is blocked — e.g. always in Tauri):
       the same content div sits inside .wmap-window-box, itself a sibling
       of the rest of the host page's own content, which must stay hidden.
     Both need: undo the screen-only height/overflow clipping (100vh/
     overflow:hidden bodies, flex:1/overflow:auto content panes) so the
     guide can paginate over multiple printed pages instead of clipping to
     one, hide anything that isn't the guide itself, and drop the
     print-irrelevant "view online" banner. */
  body{overflow:visible!important;height:auto!important}
  /* Hide everything except the guide's own content div (covers the real-
     popup case, where content is body's only child) and .wmap-window-box
     (covers the floating-window case, where content is nested inside it —
     that subtree gets its own unclip rules below rather than being hidden
     here). */
  body > *:not(.wmap-guide-content):not(.wmap-window-box){display:none!important}
  .wmap-guide-content{flex:none!important;overflow:visible!important;height:auto!important;min-height:0!important}
  body > .wmap-window-box{position:static!important;width:auto!important;height:auto!important;max-width:none!important;max-height:none!important;box-shadow:none!important;border-radius:0!important;overflow:visible!important;display:block!important}
  .wmap-window-box > div:first-child{display:none!important}
  /* contentWrap (flex container) and the scroll wrapper inside it both clip/scroll;
     unclip them so the full guide paginates instead of one screenful printing. */
  .wmap-window-box > div:not(:first-child),.wmap-window-box > div:not(:first-child) > div{display:block!important;overflow:visible!important;height:auto!important;flex:none!important;min-height:0!important}
  .wmap-guide,.wmap-guide--max{max-width:none!important;height:auto!important;overflow:visible!important;padding:0!important}
  .wmap-guide-online-link{display:none!important}
}
</style>
<h1 id="wafer-map-user-guide">Wafer Map — User Guide<span class="wmap-guide-version" title="Built 2026-07-28T16:31:45.099Z">v0.20.9</span></h1>
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
clicking it has no effect. To switch to a pass/fail view, use the <strong>Spec pass/fail</strong>
or <strong>Test pass/fail</strong> option in the Overlays menu (available when spec limits are
defined, or a recorded verdict exists, for the active test).</p>
<p><strong>Spec pass/fail mode</strong> replaces the colorbar with a small <strong>spec legend</strong>: Pass,
Fail high, and Fail low swatches (only the categories that apply to the test&#39;s
limits) with a die count beside each. This judges dies against the test&#39;s spec
limits (<code>limitLow</code> / <code>limitHigh</code>).</p>
<p><strong>Test pass/fail mode</strong> replaces the colorbar with a <strong>Pass / Fail legend</strong> and die
counts, coloured by the tester&#39;s own <strong>recorded</strong> verdict for that test — not a
spec-limit judgement. A test with no measured value (a functional, go/no-go test)
always displays this way; selecting it switches the map into Test pass/fail
automatically, since there is nothing to plot on a gradient.</p>
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
<p>Some tests have no measured value at all — a continuity check or any other
go/no-go test, where the only result is a recorded pass or fail. Selecting one
of these <strong>functional tests</strong> as the active test switches the map into
<strong>Test pass/fail</strong> automatically: a Pass/Fail legend by die count, coloured by
the tester&#39;s own recorded verdict rather than a spec-limit judgement (there is
no gradient to fall back to). <strong>Test pass/fail</strong> is also available as an
Overlays option on an ordinary parametric test when it carries recorded
verdicts, as an alternative to spec-limit judgement.</p>
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
<td>Check-menu of optional display layers: XY axis indicator, ring boundaries, quadrant lines, die coordinate labels, reticle grid (when geometry is configured), Spec pass/fail (Test Value mode with limits), and Test pass/fail (Test Value mode, active test is functional or has recorded verdicts).</td>
</tr>
<tr>
<td><img src="data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgd2lkdGg9IjE2IiBoZWlnaHQ9IjE2IiBmaWxsPSJub25lIiBzdHJva2U9IiMzNzQxNTEiIHN0cm9rZS13aWR0aD0iMS44IiBzdHJva2UtbGluZWNhcD0icm91bmQiIHN0cm9rZS1saW5lam9pbj0icm91bmQiPjxwYXRoIGQ9Im0xNC42MjIgMTcuODk3LTEwLjY4LTIuOTEzIi8+PHBhdGggZD0iTTE4LjM3NiAyLjYyMmExIDEgMCAxIDEgMy4wMDIgMy4wMDJMMTcuMzYgOS42NDNhLjUuNSAwIDAgMCAwIC43MDdsLjk0NC45NDRhMi40MSAyLjQxIDAgMCAxIDAgMy40MDhsLS45NDQuOTQ0YS41LjUgMCAwIDEtLjcwNyAwTDguMzU0IDcuMzQ4YS41LjUgMCAwIDEgMC0uNzA3bC45NDQtLjk0NGEyLjQxIDIuNDEgMCAwIDEgMy40MDggMGwuOTQ0Ljk0NGEuNS41IDAgMCAwIC43MDcgMHoiLz48cGF0aCBkPSJNOSA4Yy0xLjgwNCAyLjcxLTMuOTcgMy40Ni02LjU4MyAzLjk0OGEuNTA3LjUwNyAwIDAgMC0uMzAyLjgxOWw3LjMyIDguODgzYTEgMSAwIDAgMCAxLjE4NS4yMDRDMTIuNzM1IDIwLjQwNSAxNiAxNi43OTIgMTYgMTUiLz48L3N2Zz4K" width="20" height="20"></td>
<td>Colour scheme</td>
<td>Switches the colour palette used for value and stacked modes. Available schemes depend on what the application has registered.</td>
</tr>
<tr>
<td><img src="data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgd2lkdGg9IjE2IiBoZWlnaHQ9IjE2IiBmaWxsPSJub25lIiBzdHJva2U9IiMzNzQxNTEiIHN0cm9rZS13aWR0aD0iMS44IiBzdHJva2UtbGluZWNhcD0icm91bmQiIHN0cm9rZS1saW5lam9pbj0icm91bmQiPjxwYXRoIGQ9Ik01IDIxIEw1IDMiLz48cGF0aCBkPSJNMy41IDUgTDUgMyBMNi41IDUiLz48cGF0aCBkPSJNNSAyMSBMMjEgMjEiLz48cGF0aCBkPSJNMTkgMTkuNSBMMjEgMjEgTDE5IDIyLjUiLz48cGF0aCBkPSJNNiAyMCBDIDYgMTIsIDEwIDcsIDIwIDYiLz48L3N2Zz4K" width="20" height="20"></td>
<td>Log scale</td>
<td>Test Value and Stacked Test Values modes only. Applies a log₁₀ scale to the colour mapping. Only active when all displayed values are positive. Hidden whenever a pass/fail display is active or the active test is functional.</td>
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
<td><img src="data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxNiIgaGVpZ2h0PSIxNiIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJub25lIiBzdHJva2U9IiMzNzQxNTEiIHN0cm9rZS13aWR0aD0iMiIgc3Ryb2tlLWxpbmVjYXA9InJvdW5kIiBzdHJva2UtbGluZWpvaW49InJvdW5kIj48cGF0aCBkPSJNMyAzdjE4aDE4Ii8+PHBhdGggZD0iTTE4IDE3VjkiLz48cGF0aCBkPSJNMTMgMTdWNSIvPjxwYXRoIGQ9Ik04IDE3di0zIi8+PC9zdmc+Cg==" width="20" height="20"></td>
<td>Insights</td>
<td>Swaps the map for this wafer&#39;s own chart suite — yield, bin breakdown, process capability, and more (see <a href="#8-insights-tab" onclick="(function(e){e.preventDefault();var g=e.target.closest('.wmap-guide');var el=g&&g.querySelector('[id=\\'8-insights-tab\\']');if(el)el.scrollIntoView({behavior:'smooth'});})(event)">Section 8</a>). Only shown when the application has enabled it.</td>
</tr>
<tr>
<td><img src="data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgd2lkdGg9IjE2IiBoZWlnaHQ9IjE2IiBmaWxsPSJub25lIiBzdHJva2U9IiMzNzQxNTEiIHN0cm9rZS13aWR0aD0iMS44IiBzdHJva2UtbGluZWNhcD0icm91bmQiIHN0cm9rZS1saW5lam9pbj0icm91bmQiPjxwYXRoIGQ9Ik0xNSAzaDZ2NiIvPjxwYXRoIGQ9Ik05IDIxSDN2LTYiLz48cGF0aCBkPSJNMjEgM2wtNyA3Ii8+PHBhdGggZD0iTTMgMjFsNy03Ii8+PC9zdmc+Cg==" width="20" height="20"></td>
<td>Expand</td>
<td>Opens the map in an enlarged modal overlay. A maximise button in the modal grows it to fill the window (or press <strong>F</strong>). Press <strong>Esc</strong> or click outside to close. Useful for detailed inspection without changing the main view. Hidden while the Insights tab is open — each chart inside Insights has its own expand button instead.</td>
</tr>
<tr>
<td><img src="data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgd2lkdGg9IjE2IiBoZWlnaHQ9IjE2IiBmaWxsPSJub25lIiBzdHJva2U9IiMzNzQxNTEiIHN0cm9rZS13aWR0aD0iMS44IiBzdHJva2UtbGluZWNhcD0icm91bmQiIHN0cm9rZS1saW5lam9pbj0icm91bmQiPjxwYXRoIGQ9Ik0xMy45OTcgNGEyIDIgMCAwIDEgMS43NiAxLjA1bC40ODYuOUEyIDIgMCAwIDAgMTguMDAzIDdIMjBhMiAyIDAgMCAxIDIgMnY5YTIgMiAwIDAgMS0yIDJINGEyIDIgMCAwIDEtMi0yVjlhMiAyIDAgMCAxIDItMmgxLjk5N2EyIDIgMCAwIDAgMS43NTktMS4wNDhsLjQ4OS0uOTA0QTIgMiAwIDAgMSAxMC4wMDQgNHoiLz48Y2lyY2xlIGN4PSIxMiIgY3k9IjEzIiByPSIzIi8+PC9zdmc+Cg==" width="20" height="20"></td>
<td>Save image</td>
<td>Downloads the current map view as a PNG. Captures the canvas as displayed, including all active overlays and the legend.</td>
</tr>
<tr>
<td><img src="data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxNiIgaGVpZ2h0PSIxNiIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJub25lIiBzdHJva2U9IiMzNzQxNTEiIHN0cm9rZS13aWR0aD0iMiIgc3Ryb2tlLWxpbmVjYXA9InJvdW5kIiBzdHJva2UtbGluZWpvaW49InJvdW5kIj48cGF0aCBkPSJNOCAydjQiLz48cGF0aCBkPSJNMTIgMnY0Ii8+PHBhdGggZD0iTTE2IDJ2NCIvPjxyZWN0IHdpZHRoPSIxNiIgaGVpZ2h0PSIxOCIgeD0iNCIgeT0iNCIgcng9IjIiLz48cGF0aCBkPSJNOCAxMGg2Ii8+PHBhdGggZD0iTTggMTRoOCIvPjxwYXRoIGQ9Ik04IDE4aDUiLz48L3N2Zz4K" width="20" height="20"></td>
<td>Findings</td>
<td>Opens or closes the Findings sidebar (see <a href="#6-findings-sidebar" onclick="(function(e){e.preventDefault();var g=e.target.closest('.wmap-guide');var el=g&&g.querySelector('[id=\\'6-findings-sidebar\\']');if(el)el.scrollIntoView({behavior:'smooth'});})(event)">Section 6</a>).</td>
</tr>
<tr>
<td><img src="data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxNiIgaGVpZ2h0PSIxNiIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJub25lIiBzdHJva2U9IiMzNzQxNTEiIHN0cm9rZS13aWR0aD0iMiIgc3Ryb2tlLWxpbmVjYXA9InJvdW5kIiBzdHJva2UtbGluZWpvaW49InJvdW5kIj48Y2lyY2xlIGN4PSIxMiIgY3k9IjEyIiByPSIxMCIvPjxwYXRoIGQ9Ik05LjA5IDlhMyAzIDAgMCAxIDUuODMgMWMwIDItMyAzLTMgMyIvPjxwYXRoIGQ9Ik0xMiAxN2guMDEiLz48L3N2Zz4K" width="20" height="20"></td>
<td>User guide</td>
<td>Opens this guide.</td>
</tr>
</tbody></table>
<p><strong>This guide&#39;s own window</strong> (and a gallery card detached into its own window,
see <a href="#gallery" onclick="(function(e){e.preventDefault();var g=e.target.closest('.wmap-guide');var el=g&&g.querySelector('[id=\\'gallery\\']');if(el)el.scrollIntoView({behavior:'smooth'});})(event)">Section 3 — Gallery</a> below) is a floating window, not a modal —
its header shows minimize, maximize, and close buttons, and it can be dragged
and resized by its corner grip. Minimizing collapses it to a small title strip
without closing it; click it again to restore.</p>
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
<li><strong>Spec pass/fail</strong> — pass/fail colouring for Test Value mode, judged against spec limits, when the active test defines them</li>
<li><strong>Test pass/fail</strong> — pass/fail colouring for Test Value mode, coloured by the tester&#39;s recorded verdict; always on for a functional (no measured value) active test</li>
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
<td>Findings</td>
<td>Opens or closes the lot-level Findings sidebar.</td>
</tr>
<tr>
<td><img src="data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxNiIgaGVpZ2h0PSIxNiIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJub25lIiBzdHJva2U9IiMzNzQxNTEiIHN0cm9rZS13aWR0aD0iMiIgc3Ryb2tlLWxpbmVjYXA9InJvdW5kIiBzdHJva2UtbGluZWpvaW49InJvdW5kIj48cGF0aCBkPSJNMyAzdjE4aDE4Ii8+PHBhdGggZD0iTTE4IDE3VjkiLz48cGF0aCBkPSJNMTMgMTdWNSIvPjxwYXRoIGQ9Ik04IDE3di0zIi8+PC9zdmc+Cg==" width="20" height="20"></td>
<td>Insights</td>
<td>Swaps the grid for a lot-wide chart suite — yield, bin breakdown, process capability, and more (see <a href="#8-insights-tab" onclick="(function(e){e.preventDefault();var g=e.target.closest('.wmap-guide');var el=g&&g.querySelector('[id=\\'8-insights-tab\\']');if(el)el.scrollIntoView({behavior:'smooth'});})(event)">Section 8</a>). Only shown when the application has enabled it.</td>
</tr>
</tbody></table>
<p>Click a card&#39;s expand button to detach it into its own separate window with the
complete single-map toolbar (falls back to a floating window inside the page if
separate windows aren&#39;t available in your environment). The vacated grid card
becomes a placeholder whose own button reattaches it; closing the detached
window does the same.</p>
<div data-wmap-demo="gallery" class="wmap-demo"></div><hr>
<h2 id="4-interacting-with-dies">4. Interacting with dies</h2>
<h3 id="41-hover">4.1 Hover</h3>
<p>Hovering over a die shows a compact tooltip. It always includes the die grid
coordinates (x, y), and a retest count if the die was probed more than once.
The rest depends on the active plot mode:</p>
<ul>
<li><strong>Bin modes</strong> — the die&#39;s bin verdict (number and name, if named), plus a
note of how many test values are recorded for the die</li>
<li><strong>Test Value mode</strong> — the active test&#39;s value in bold, flagged when it is
out of spec, with the remaining tests summarised as &quot;+N more tests&quot;</li>
<li><strong>Stacked modes</strong> — the single aggregated value or count at that position</li>
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
the map with a black-and-white outline, visible against every colour scheme</li>
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
<h2 id="6-findings-sidebar">6. Findings sidebar</h2>
<p>The Findings sidebar shows detected anomalies for the current wafer or lot,
always docked next to the map so a clicked finding can highlight the affected
dies right there. Open it from the toolbar. Severity, kind, and region filter
controls at the top of the sidebar narrow the list down.</p>
<div data-wmap-demo="summary-panel" class="wmap-demo"></div><p><em>The Findings sidebar open alongside a single wafer. Click any finding to
highlight the affected dies; use the filter controls to narrow by severity,
kind, or region.</em></p>
<p>Yield, bin breakdown, ring/quadrant regional yield, and per-test statistics —
previously shown in this same panel — now live in the
<a href="#8-insights-tab" onclick="(function(e){e.preventDefault();var g=e.target.closest('.wmap-guide');var el=g&&g.querySelector('[id=\\'8-insights-tab\\']');if(el)el.scrollIntoView({behavior:'smooth'});})(event)">Insights tab</a>&#39;s Overview sub-tab instead, since that content
doesn&#39;t need the map on screen the way a finding&#39;s highlight does.</p>
<p>A <strong>Summary report</strong> button (when present) opens a printable full-detail
report in a new window or tab, still covering everything findings-adjacent —
yield, bin breakdown, ring and quadrant statistics, per-test statistics, and
the full findings list — and can be saved as a PDF from your browser&#39;s print
dialog.</p>
<p>For <strong>lot-level views</strong> (gallery), the sidebar shows lot-level findings by
default, with a <strong>Wafers</strong> tab listing every wafer that has its own per-wafer
findings — click a row to open that wafer.</p>
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
<h2 id="8-insights-tab">8. Insights tab</h2>
<p>The <strong>Insights</strong> toolbar button (single map or gallery) swaps the wafer view
for a chart suite computed from the same die data — without leaving the
toolbar. Click it again to return to the map. Independent of the Findings
sidebar (Section 6) — the two toggle independently, and opening one never
hides the other&#39;s toolbar button, since Findings has nothing to highlight
against once the map is replaced.</p>
<p>Insights is organized into three sub-tabs:</p>
<ul>
<li><strong>Overview</strong> — a yield bar (labelled with the pass bins actually in use), a
hard/soft bin pareto, and ring/quadrant regional yield and per-test
min/mean/max/spec-yield statistics.</li>
<li><strong>Distributions</strong> — process capability (Cp/Cpk/Pp/Ppk for tests with both a
lower and upper spec limit; tests missing a spec still appear, normalized
onto their own range and sorted by variability), a test-value box plot, and
a value histogram. Clicking a capability box drives the box plot and
histogram onto that same test automatically.</li>
<li><strong>Correlation</strong> — a test-to-test correlation matrix and a die-level scatter
plot. Clicking a matrix cell drives the scatter plot onto that pair.</li>
</ul>
<p>In a gallery with more than one wafer, a <strong>Group by</strong> control appears whenever
wafer metadata (lot, product, test program, temperature, split, or a custom
field) actually varies across the loaded wafers — grouping pools or restricts
each panel differently depending on what makes sense for that chart type.
Histogram, correlation, and scatter also offer a <strong>Wafer</strong> picker to narrow
from &quot;all wafers pooled&quot; down to one wafer at a time. Clicking a yield bar or
box-plot row for one wafer opens that wafer&#39;s own map — a box-plot click opens
directly on the test you were looking at.</p>
<div data-wmap-demo="analysis" class="wmap-demo"></div><p><em>Insights tab open on a single wafer, Overview sub-tab: yield and bin pareto,
ring/quadrant yield, and per-test statistics — all computed from this wafer&#39;s
own dies. The Distributions sub-tab has process capability, a test-value box
plot and histogram; Correlation has a correlation matrix with scatter plot.
In a gallery, Overview also gains a &quot;Group by&quot; control and per-wafer
yield/box-plot rows.</em></p>
<p><em>Gallery Insights, Overview sub-tab: lot-wide yield by wafer (click a bar to
open that wafer&#39;s map), hard/soft bin pareto, ring and quadrant yield, and
pooled per-test statistics. The &quot;‹ Gallery&quot; tab returns to the card grid.</em></p>
<p><em>Distributions sub-tab: process capability (coloured by Ppk — green capable,
orange marginal, red poor; tests without spec limits are muted and dashed), a
per-wafer test-value box plot, and a value histogram. Clicking a capability
box drives the box plot and histogram onto that test.</em></p>
<p><em>Correlation sub-tab: test-to-test Pearson correlation matrix (blue =
positive, orange = negative; intensity = strength) and a die-level scatter
plot coloured by hard bin. Clicking a matrix cell drives the scatter plot
onto that pair.</em></p>
<hr>
<h2 id="9-reticle-overlay">9. Reticle overlay</h2>
<p>When reticle (stepper field) geometry is configured, the <strong>Reticle grid</strong> overlay
draws the stepper field boundaries on the wafer. Each rectangle represents one
exposure field from the lithography stepper — the group of dies exposed in a
single step. This lets you correlate failure patterns with specific reticle
positions — useful for identifying stepper field signatures, alignment drift, or
mask defects.</p>
<div data-wmap-demo="reticle" class="wmap-demo"></div><p>Reticle-position findings in the Findings panel highlight the specific field
positions that show elevated failure rates. Hovering any die also shows its
<strong>Reticle (column, row)</strong> position — its location within its own stepper
field — just below the die&#39;s coordinate in the tooltip.</p>
<script>// Inline demo script for the embedded user guide window.
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
    // openGuideInPopup) can tear every demo down — see the \`handles\` comment
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
</script></div>`;
