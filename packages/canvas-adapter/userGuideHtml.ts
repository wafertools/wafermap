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
<h1 id="wafer-map-user-guide">Wafer Map — User Guide<span class="wmap-guide-version" title="Built 2026-08-18T13:31:30.009Z">v0.23.1</span></h1>
<p class="wmap-guide-online-link">This is a quick reference. <a href="https://wafertools.github.io/wafermap/user-guide/" target="_blank" rel="noopener">View the full illustrated guide online ↗</a></p>
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
<td><img src="data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgd2lkdGg9IjE2IiBoZWlnaHQ9IjE2IiBmaWxsPSJub25lIiBzdHJva2U9IiMzNzQxNTEiIHN0cm9rZS13aWR0aD0iMS44IiBzdHJva2UtbGluZWNhcD0icm91bmQiIHN0cm9rZS1saW5lam9pbj0icm91bmQiPjxwYXRoIGQ9Ik01IDQgTDUgMjAiLz48cGF0aCBkPSJNNSA0IEw4IDQiLz48cGF0aCBkPSJNNSAyMCBMOCAyMCIvPjxwYXRoIGQ9Ik0xOSA0IEwxOSAyMCIvPjxwYXRoIGQ9Ik0xOSA0IEwxNiA0Ii8+PHBhdGggZD0iTTE5IDIwIEwxNiAyMCIvPjxwYXRoIGQ9Ik01IDEyIEwxOSAxMiIgc3Ryb2tlLWRhc2hhcnJheT0iMyAyIi8+PC9zdmc+Cg==" width="20" height="20"></td>
<td>Colorbar range</td>
<td>Test Value mode with spec limits only. Toggles the colorbar between the <strong>spec-limit range</strong> (default — the colours mean the same thing on every wafer, so maps are comparable) and the <strong>data range</strong> (stretches the scale to the values actually present, which shows more contrast but is not comparable between wafers).</td>
</tr>
<tr>
<td><img src="data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgd2lkdGg9IjE2IiBoZWlnaHQ9IjE2IiBmaWxsPSJub25lIiBzdHJva2U9IiMzNzQxNTEiIHN0cm9rZS13aWR0aD0iMS44IiBzdHJva2UtbGluZWNhcD0icm91bmQiIHN0cm9rZS1saW5lam9pbj0icm91bmQiPjxyZWN0IHdpZHRoPSI3IiBoZWlnaHQ9IjciIHg9IjMiIHk9IjMiIHJ4PSIxIi8+PHJlY3Qgd2lkdGg9IjciIGhlaWdodD0iNyIgeD0iMyIgeT0iMTQiIHJ4PSIxIi8+PHBhdGggZD0iTTE0IDRoNyIvPjxwYXRoIGQ9Ik0xNCA5aDciLz48cGF0aCBkPSJNMTQgMTVoNyIvPjxwYXRoIGQ9Ik0xNCAyMGg3Ii8+PC9zdmc+Cg==" width="20" height="20"></td>
<td>Legend style</td>
<td>Bin modes only. Controls where the bin legend is positioned relative to the map: Default (right), Compact, Left, Top, Bottom, or Floating.</td>
</tr>
<tr>
<td><img src="data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgd2lkdGg9IjE2IiBoZWlnaHQ9IjE2IiBmaWxsPSJub25lIiBzdHJva2U9IiMzNzQxNTEiIHN0cm9rZS13aWR0aD0iMS44IiBzdHJva2UtbGluZWNhcD0icm91bmQiIHN0cm9rZS1saW5lam9pbj0icm91bmQiPjxjaXJjbGUgY3g9IjEyIiBjeT0iMTIiIHI9IjEwIi8+PHBvbHlnb24gcG9pbnRzPSIxNi4yNCA3Ljc2IDE0LjEyIDE0LjEyIDcuNzYgMTYuMjQgOS44OCA5Ljg4IDE2LjI0IDcuNzYiIGZpbGw9IiMzNzQxNTEiIHN0cm9rZT0ibm9uZSIvPjwvc3ZnPgo=" width="20" height="20"></td>
<td>Orientation</td>
<td>Menu of display transforms: <strong>Rotate 90° clockwise</strong> (applies cumulatively), <strong>Flip horizontal</strong>, <strong>Flip vertical</strong>. These change only how the wafer is drawn — die coordinates in tooltips and labels are always the original values, whatever the orientation.</td>
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
<td><img src="data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxNiIgaGVpZ2h0PSIxNiIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJub25lIiBzdHJva2U9IiMzNzQxNTEiIHN0cm9rZS13aWR0aD0iMiIgc3Ryb2tlLWxpbmVjYXA9InJvdW5kIiBzdHJva2UtbGluZWpvaW49InJvdW5kIj48cGF0aCBkPSJNMTAuMjkgMy44NiAxLjgyIDE4YTIgMiAwIDAgMCAxLjcxIDNoMTYuOTRhMiAyIDAgMCAwIDEuNzEtM0wxMy43MSAzLjg2YTIgMiAwIDAgMC0zLjQyIDB6Ii8+PHBhdGggZD0iTTEyIDl2NCIvPjxwYXRoIGQ9Ik0xMiAxN2guMDEiLz48L3N2Zz4K" width="20" height="20"></td>
<td>Data warnings</td>
<td>Appears <strong>only when there is something to report</strong> about the data behind the map. Click it for the details. A red ⛔ means the map may be positionally wrong — usually that wafer geometry was guessed rather than supplied, so dies may not sit where they appear to. An amber ⚠ means something expected is missing or was skipped, but what is drawn is correct.</td>
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
<td><img src="data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgd2lkdGg9IjE2IiBoZWlnaHQ9IjE2IiBmaWxsPSJub25lIiBzdHJva2U9IiMzNzQxNTEiIHN0cm9rZS13aWR0aD0iMS44IiBzdHJva2UtbGluZWNhcD0icm91bmQiIHN0cm9rZS1saW5lam9pbj0icm91bmQiPjxwYXRoIGQ9Ik0xMy45OTcgNGEyIDIgMCAwIDEgMS43NiAxLjA1bC40ODYuOUEyIDIgMCAwIDAgMTguMDAzIDdIMjBhMiAyIDAgMCAxIDIgMnY5YTIgMiAwIDAgMS0yIDJINGEyIDIgMCAwIDEtMi0yVjlhMiAyIDAgMCAxIDItMmgxLjk5N2EyIDIgMCAwIDAgMS43NTktMS4wNDhsLjQ4OS0uOTA0QTIgMiAwIDAgMSAxMC4wMDQgNHoiLz48Y2lyY2xlIGN4PSIxMiIgY3k9IjEzIiByPSIzIi8+PGNpcmNsZSBjeD0iNS41IiBjeT0iNC41IiByPSIwLjgiIGZpbGw9IiMzNzQxNTEiIHN0cm9rZT0ibm9uZSIvPjxjaXJjbGUgY3g9IjgiIGN5PSI0LjUiIHI9IjAuOCIgZmlsbD0iIzM3NDE1MSIgc3Ryb2tlPSJub25lIi8+PGNpcmNsZSBjeD0iNS41IiBjeT0iNyIgcj0iMC44IiBmaWxsPSIjMzc0MTUxIiBzdHJva2U9Im5vbmUiLz48Y2lyY2xlIGN4PSI4IiBjeT0iNyIgcj0iMC44IiBmaWxsPSIjMzc0MTUxIiBzdHJva2U9Im5vbmUiLz48L3N2Zz4K" width="20" height="20"></td>
<td>Save image</td>
<td>Downloads the full gallery grid as a single PNG.</td>
</tr>
<tr>
<td><img src="data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgd2lkdGg9IjE2IiBoZWlnaHQ9IjE2IiBmaWxsPSJub25lIiBzdHJva2U9IiMzNzQxNTEiIHN0cm9rZS13aWR0aD0iMS44IiBzdHJva2UtbGluZWNhcD0icm91bmQiIHN0cm9rZS1saW5lam9pbj0icm91bmQiPjxwYXRoIGQ9Ik0xOCA0SDZsNiA4LTYgOGgxMiIvPjwvc3ZnPgo=" width="20" height="20"></td>
<td>Aggregation method</td>
<td>Stacked modes only. Selects how values from multiple wafers are combined per die position: Mean, Median, Std Dev, Min, Max, or Count.</td>
</tr>
<tr>
<td><img src="data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgd2lkdGg9IjE2IiBoZWlnaHQ9IjE2IiBmaWxsPSJub25lIiBzdHJva2U9IiMzNzQxNTEiIHN0cm9rZS13aWR0aD0iMS44IiBzdHJva2UtbGluZWNhcD0icm91bmQiIHN0cm9rZS1saW5lam9pbj0icm91bmQiPjxwYXRoIGQ9Ik01IDIxIEw1IDMiLz48cGF0aCBkPSJNMy41IDUgTDUgMyBMNi41IDUiLz48cGF0aCBkPSJNNSAyMSBMMjEgMjEiLz48cGF0aCBkPSJNMTkgMTkuNSBMMjEgMjEgTDE5IDIyLjUiLz48cGF0aCBkPSJNNiAyMCBDIDYgMTIsIDEwIDcsIDIwIDYiLz48L3N2Zz4K" width="20" height="20"></td>
<td>Log scale</td>
<td>Test Value and Stacked Test Values modes only. Applies a log₁₀ scale to the colour mapping for all cards.</td>
</tr>
<tr>
<td><img src="data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgd2lkdGg9IjE2IiBoZWlnaHQ9IjE2IiBmaWxsPSJub25lIiBzdHJva2U9IiMzNzQxNTEiIHN0cm9rZS13aWR0aD0iMS44IiBzdHJva2UtbGluZWNhcD0icm91bmQiIHN0cm9rZS1saW5lam9pbj0icm91bmQiPjxyZWN0IHdpZHRoPSI3IiBoZWlnaHQ9IjciIHg9IjMiIHk9IjMiIHJ4PSIxIi8+PHJlY3Qgd2lkdGg9IjciIGhlaWdodD0iNyIgeD0iMyIgeT0iMTQiIHJ4PSIxIi8+PHBhdGggZD0iTTE0IDRoNyIvPjxwYXRoIGQ9Ik0xNCA5aDciLz48cGF0aCBkPSJNMTQgMTVoNyIvPjxwYXRoIGQ9Ik0xNCAyMGg3Ii8+PC9zdmc+Cg==" width="20" height="20"></td>
<td>Legend style</td>
<td>Bin modes only. Sets where the bin legend sits relative to each card.</td>
</tr>
<tr>
<td><img src="data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgd2lkdGg9IjE2IiBoZWlnaHQ9IjE2IiBmaWxsPSJub25lIiBzdHJva2U9IiMzNzQxNTEiIHN0cm9rZS13aWR0aD0iMS44IiBzdHJva2UtbGluZWNhcD0icm91bmQiIHN0cm9rZS1saW5lam9pbj0icm91bmQiPjxwYXRoIGQ9Ik01IDQgTDUgMjAiLz48cGF0aCBkPSJNNSA0IEw4IDQiLz48cGF0aCBkPSJNNSAyMCBMOCAyMCIvPjxwYXRoIGQ9Ik0xOSA0IEwxOSAyMCIvPjxwYXRoIGQ9Ik0xOSA0IEwxNiA0Ii8+PHBhdGggZD0iTTE5IDIwIEwxNiAyMCIvPjxwYXRoIGQ9Ik01IDEyIEwxOSAxMiIgc3Ryb2tlLWRhc2hhcnJheT0iMyAyIi8+PC9zdmc+Cg==" width="20" height="20"></td>
<td>Colorbar range</td>
<td>Test Value mode with spec limits only. Toggles all cards between the spec-limit range and the data range. Leave it on spec limits when comparing wafers — the data range rescales per view.</td>
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
<tr>
<td><img src="data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxNiIgaGVpZ2h0PSIxNiIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJub25lIiBzdHJva2U9IiMzNzQxNTEiIHN0cm9rZS13aWR0aD0iMiIgc3Ryb2tlLWxpbmVjYXA9InJvdW5kIiBzdHJva2UtbGluZWpvaW49InJvdW5kIj48cGF0aCBkPSJNMTAuMjkgMy44NiAxLjgyIDE4YTIgMiAwIDAgMCAxLjcxIDNoMTYuOTRhMiAyIDAgMCAwIDEuNzEtM0wxMy43MSAzLjg2YTIgMiAwIDAgMC0zLjQyIDB6Ii8+PHBhdGggZD0iTTEyIDl2NCIvPjxwYXRoIGQ9Ik0xMiAxN2guMDEiLz48L3N2Zz4K" width="20" height="20"></td>
<td>Data warnings</td>
<td>Appears only when something is worth reporting about the lot. Collected across every wafer and de-duplicated, so a problem affecting the whole lot is stated once rather than repeated per card.</td>
</tr>
<tr>
<td><img src="data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxNiIgaGVpZ2h0PSIxNiIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJub25lIiBzdHJva2U9IiMzNzQxNTEiIHN0cm9rZS13aWR0aD0iMiIgc3Ryb2tlLWxpbmVjYXA9InJvdW5kIiBzdHJva2UtbGluZWpvaW49InJvdW5kIj48Y2lyY2xlIGN4PSIxMiIgY3k9IjEyIiByPSIxMCIvPjxwYXRoIGQ9Ik05LjA5IDlhMyAzIDAgMCAxIDUuODMgMWMwIDItMyAzLTMgMyIvPjxwYXRoIGQ9Ik0xMiAxN2guMDEiLz48L3N2Zz4K" width="20" height="20"></td>
<td>User guide</td>
<td>Opens this guide.</td>
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
the findings list — and can be saved as a PDF from your browser&#39;s print
dialog.</p>
<h3 id="why-some-findings-name-two-bins">Why some findings name two bins</h3>
<p>A finding may read <strong>&quot;hard bin 3 and soft bin 3 (same dies)&quot;</strong>. That is one
group of dies counted in two bin spaces, not two separate groups added together.
Hard and soft bins are independent numbering systems, so this wording appears
only when the two happen to cover exactly the same dies — reporting it twice
would look like two independent problems.</p>
<p>For the same reason, when a single pass bin is configured you will see the
<strong>yield</strong> finding for a region but not a separate finding for the pass bin
itself: &quot;pass-bin occurrence is 22 points lower&quot; and &quot;yield is 22 points lower&quot;
are the same sentence.</p>
<p>Nothing is discarded — an application reading the findings programmatically
still receives every one of them.</p>
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
