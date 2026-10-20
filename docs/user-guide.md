# Wafer Map — User Guide

This guide describes the display and analysis features of the wafer map viewer.
It is written for users who may be semiconductor test engineers, device engineers, and yield engineers
or anyone else who may use a wafer map application — not for developers integrating the wafermap library.

Some features depend on what data the application has loaded (bin names, test
definitions, test limits, reticle geometry). Where this applies it is noted.

**Getting oriented.** The wafer map is an interactive viewer. A toolbar is always
present above the map, at the right of its title row — use it to change what the colours represent,
toggle overlays, rotate or flip the wafer, zoom, select dies, and open the summary
panel. Hover any die for a tooltip; the panels and tooltips always report the
original die grid coordinates, never the on-screen position after a rotate or flip.

---

## 1. Reading the map

### 1.1 Die grid and coordinates

Each square on the wafer represents one die. The position labels you see — in
tooltips, axis ticks, and selection readouts — are **die grid coordinates**: usually the
X and Y step indices from the prober (integers such as −7, 0, 5). They are not
millimetre values.

These coordinates are always the original grid values. Rotating or flipping the
display does not change the coordinate labels — a die at (3, −2) always reads
(3, −2) regardless of how the wafer is oriented on screen.

### 1.2 Wafer orientation

The notch (shown as a V-notch or flat edge) marks the physical reference edge of
the wafer as configured. Use the **Orientation** toolbar controls to rotate or flip
the display to match your convention; die coordinates are unaffected. The first rotate
or flip also switches on the **XY indicator** (the +X/+Y arrows in the Overlays menu), so
you can see which way the die coordinates now run. It stays on until you switch it off
there; **Reset orientation** leaves it as it is.

<div data-wmap-demo="bin-map" class="wmap-demo"></div>

*An example wafer bin map above and below the same wafer rotated 90°. The notch has moved, but die coordinates — shown in tooltips — remain their original grid/prober values.*

<div data-wmap-demo="orientation" class="wmap-demo"></div>


### 1.3 Die appearance

| Appearance              | Meaning                                                                            |
| ----------------------- | ---------------------------------------------------------------------------------- |
| Solid colour            | Active plot value — bin category or test measurement                               |
| Neutral grey (interior) | No data — die has no bin or test result in the loaded dataset                      |
| Dimmed fill (interior)  | Edge-excluded die — falls within the edge exclusion band configured for this wafer |

A no-data die is not a fail; it simply has no result recorded. Edge-excluded dies are shown dimmed and are
not counted in yield calculations.

### 1.4 Legend and colorbar

**Bin modes** show a discrete colour legend: one swatch per bin, with bin number
and name if the application has supplied bin names. Passing bins are listed first,
then failing bins from the most dies to the fewest — the same order as the Summary
panel and reports.

**Value mode** shows a continuous colorbar: the colour scale runs from the minimum
to maximum value, with units when available. The colorbar is informational only —
clicking it has no effect. To switch to a pass/fail view, use the **Limit pass/fail**
or **Test pass/fail** option in the Overlays menu (available when test limits are
defined, or a recorded verdict exists, for the active test).

**Limit pass/fail mode** replaces the colorbar with a small legend: Pass,
Fail high, and Fail low swatches (only the categories that apply to the test's
limits) with a die count beside each. This judges dies against the test's lower
and upper test limits.

**Test pass/fail mode** replaces the colorbar with a **Pass / Fail legend** and die
counts, coloured by the tester's own **recorded** verdict for that test — not a
limit judgement. A test with no measured value (a functional, go/no-go test)
always displays this way; selecting it switches the map into Test pass/fail
automatically, since there is nothing to plot on a gradient.

Every map also shows a short **title** by the colorbar or legend naming what is
displayed — the test name (and number, in limit pass/fail mode), the bin type, or the stacked
wafer count.

Clicking a bin swatch in the legend filters the display to that bin: every other bin is
greyed out. **Ctrl / Cmd + click** adds or removes further bins, so several can be shown
together. Clicking the only bin shown again clears the filter
(see [Highlight bin](#3-toolbar-controls)).

### 1.5 Wafers and dies with no position data

Not every die necessarily has a reported grid position — some data sources supply bin or test
results with no X/Y coordinates at all, for some or every die on a wafer.

**A fully positionless wafer** never renders as a map or gallery card — showing dies at
fabricated positions would risk being misread as real spatial layout. Instead the card shows a
compact summary matching the active plot mode: a **bin breakdown** (coloured the same as a
positioned card's own bin legend) for hard/soft-bin modes, or a **histogram** for value mode —
coloured through the same colour scheme, log-scale, and spec/data-range settings the map itself
uses, so switching those in the toolbar updates the chart the same way it would a real map. A
**View die list** toggle switches to the full per-die table (position/site, hard bin, soft bin,
every test value) with its own CSV export; **View chart** switches back.

**A mixed wafer** — some dies positioned, some not — renders its normal map for the positioned
dies, plus an expandable **"+N dies without position data"** footer beneath the card. Expanding
it (click the footer or its chevron) shows the same chart/die-list toggle, scoped to just the
unpositioned subset.

The toolbar's spatial-only controls (zoom, pan, box select, save image, orientation, overlays,
legend position) are hidden on a fully positionless card, since there's no map for them to act
on. Plot mode and colour scheme stay available — both still drive what the summary shows.

Findings that depend on physical layout — edge ring, quadrants, sectors, reticle position,
cluster and pattern detection — only ever consider positioned dies, so a positionless wafer
contributes none of these. Everything else — yield, bin counts, per-test statistics, and the
Insights tab's histograms/correlation/scatter — still includes every die, positioned or not.

---

## 2. Plot modes

The active plot mode determines what the colour of each die represents. Use the
**Plot mode** toolbar dropdown to switch. Available modes depend on what data the
application has loaded.

| Mode                    | Colour represents                                            | Typical use                                    |
| ----------------------- | ------------------------------------------------------------ | ---------------------------------------------- |
| **Hard Bin**            | Physical sort result (hard bin number)                       | Yield categorisation, pass/fail map            |
| **Soft Bin**            | Test-program failure category (soft bin number)              | Failure mode breakdown                         |
| **Test Value**          | A single numeric measurement                                 | Parametric heatmap — leakage, Idsat, Vth, etc. |
| **Stacked Hard Bins**   | Hard bin occurrence counts aggregated across multiple wafers | Lot-level yield patterns                       |
| **Stacked Soft Bins**   | Soft bin occurrence counts aggregated across multiple wafers | Lot-level failure mode patterns                |
| **Stacked Test Values** | Aggregated test values across multiple wafers                | Lot-level parametric trends                    |

Stacked modes are only available on lot-stack maps (multiple wafers combined into
one display). The panel identifies how many wafers were stacked and which
aggregation method is active.

### Test Value mode — colorbar range and test limits

When test limits are defined for the active test, two additional display options
become available:

- **Colorbar range — Data / Limits**: switches the colorbar scale between the
  actual data extent and the test limits. This affects only the colorbar's
  range, never how failing dies are shown. In **both** ranges every die is
  coloured by the gradient so you can read the value distribution, and dies
  outside the test limits are marked with a triangle — pointing **down (▽) for below the low limit**, **up (△)
  for above the high limit** — so they stand out without leaving the distribution. The
  triangle is drawn black or white per die for contrast against its own colour, so
  it stays visible under any colour scheme, and its shape (not colour) carries the
  below/above-limit meaning. On dies too small to carry one (under 5 pixels, as on a dense
  wafer zoomed out) the triangles are left off and the colour bar says **▽△ limit marks: zoom
  in**; zoom in and they appear.
- **Limit pass/fail**: when active, dies within the test limits are shown in
  a pass colour and dies outside them are highlighted — **blue for below the
  low limit**, **red for above the high limit**. Both flags apply
  independently; a die can be flagged on either or both limits. A Pass/Fail legend
  replaces the colorbar, listing each applicable category with its die count.

Some tests have no measured value at all — a continuity check or any other
go/no-go test, where the only result is a recorded pass or fail. Selecting one
of these **functional tests** as the active test switches the map into
**Test pass/fail** automatically: a Pass/Fail legend by die count, coloured by
the tester's own recorded verdict rather than a limit judgement (there is
no gradient to fall back to). **Test pass/fail** is also available as an
Overlays option on an ordinary parametric test when it carries recorded
verdicts, as an alternative to limit judgement.

### Values outside a limit set

A tester that runs out of range records its rail instead of a reading: a current held at the compliance clamp, a voltage at the supply, an
open-circuit value. A test can carry **validity limits**, the range a real measurement lies in, and a value outside them is not a reading. It
is **missing** for that test on that die: grey on the map, and left out of the statistics and every chart, so one clamp cannot stretch the colour
scale or move the mean, σ and Cpk. Which limit set a value must lie inside is the host's choice. The usual one is the validity limits, which only
affect tests that have them; a host can instead keep only values inside the specification limits or the test limits, or filter nothing.

Nothing is hidden. Hover a grey die and the tooltip names the excluded value and the limit set. The Summary panel's Test Values table shows the
total beside **N** and an **Excl.** column, and the same count appears in the histogram and box plot captions, the capability tooltip and caption,
the My plots tab's footnote, the report and the CSV exports. The build also lists it among the data warnings. The bin map and each die's pass/fail are
the tester's own and do not change, so yield is the same with the filter on or off.

<div data-wmap-demo="value-heatmap" class="wmap-demo"></div>

<div data-wmap-demo="spec-passfail" class="wmap-demo"></div>

---

### Derived tests (†)

A test name marked **†** in front is a *derived* test: its value was calculated
from other tests on the same die — a difference, a ratio, a margin — rather
than measured by the tester. It behaves like any other test: you can map it,
chart it and find patterns in it.

The dagger appears wherever the test is named — the map title, tooltips, the
plot-mode test list, Insights charts and their test pickers, findings, the
Summary panel, the die list and reports — always in front of the name, so in a
list the derived tests line up in a column down the left edge. The words
**† Derived, not measured** always appear nearby. Hovering over a derived
value, or reading the key line under a table or findings list, shows the
expression it was computed from, e.g. `t[1020] - t[1010]`. The numbers in
square brackets are the test numbers it reads. In a CSV export the expression
appears in a **Derived from** column instead.

## 3. Toolbar controls

The toolbar sits above the map, at the right of its title row (each card in a gallery has its own), and is always visible. Controls that
are not applicable to the current mode are hidden automatically. (Hovering the map
shows die tooltips — a separate thing from the toolbar, which is always present.)

![Single-map toolbar](images/toolbar-single.png)

### Single map

|                                                               | Control            | Description                                                                                                                                                                                                                                                                                            |
| ------------------------------------------------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| <img src="images/icons/mode.svg" width="20" height="20">      | Plot mode          | Switches the active plot mode (see [Plot modes](#2-plot-modes)). When multiple tests are available, a test selector appears alongside it.                                                                                                                                                               |
| <img src="images/icons/overlays.svg" width="20" height="20">  | Overlays           | Check-menu of optional display layers: axis labels, XY axis indicator, ring boundaries, quadrant lines, die coordinate labels, reticle grid (when geometry is configured), Limit pass/fail (Test Value mode with limits), Test pass/fail (Test Value mode, active test is functional or has recorded verdicts), and **Mark failing dies** (bin modes only). **Compact layout** and **Layout diagnostics** sit at the top of the menu (see [Compact layout](#compact-layout)). **Clear overlays** at the foot turns off everything in the menu at once, and is greyed when nothing is on — so the menu also answers "is anything active?" without you auditing every row. |
| <img src="images/icons/palette.svg" width="20" height="20">   | Colour scheme      | Picks the colours for the map on screen. In Hard Bin and Soft Bin modes it lists **bin colours** (Default, Colour-blind safe); in every other mode — including the stacked modes, which show values — it lists **value colours**. The two are separate choices, so changing one never resets the other. Value gradients run dark at the low end and bright at the high end, so on a stacked map the healthy wafer sits back and a defect ring or scratch stands out; **Reverse gradient** flips that when the low end is the one you care about. When bin definitions carry their own colours, **Use colours from bin definitions** turns them on or off. (**Mark failing dies** is in Overlays, beside the pass/fail display it belongs with.) |
| <img src="images/icons/logScale.svg" width="20" height="20">  | Log scale          | Test Value and Stacked Test Values modes only. Applies a log₁₀ scale to the colour mapping. Only active when all displayed values are positive. Hidden whenever a pass/fail display is active or the active test is functional.                                                                       |
| <img src="images/icons/specRange.svg" width="20" height="20"> | Colorbar range     | Test Value mode with test limits only. Toggles the colorbar between the **limit range** (default — the colours mean the same thing on every wafer, so maps are comparable) and the **data range** (stretches the scale to the values actually present, which shows more contrast but is not comparable between wafers). |
| <img src="images/icons/legend.svg" width="20" height="20">    | Legend style       | Bin modes only. Controls where the bin legend is positioned relative to the map: Default (right), Compact, Left, Top, Bottom, or Floating.                                                                                                                                                             |
| <img src="images/icons/orient.svg" width="20" height="20">   | Orientation        | Menu of display transforms: **Rotate 90° clockwise** (applies cumulatively), **Flip horizontal**, **Flip vertical**, and **Reset orientation**. The first rotate or flip also switches on the XY indicator (see Overlays), which stays on until you switch it off. These change only how the wafer is drawn — die coordinates in tooltips and labels are always the original values, whatever the orientation. Reset is worth knowing about: rotation and mirroring do not combine in the order you applied them, so undoing a few clicks by clicking again does not reliably get you back — Reset does, and is greyed when you are already there. |
| <img src="images/icons/zoomMode.svg" width="20" height="20">  | Zoom mode          | Click and drag to draw a zoom region.                                                                                                                                                                                                                                                                  |
| <img src="images/icons/zoomIn.svg" width="20" height="20">    | Zoom in            | Zooms in one step.                                                                                                                                                                                                                                                                                     |
| <img src="images/icons/zoomOut.svg" width="20" height="20">   | Zoom out           | Zooms out one step.                                                                                                                                                                                                                                                                                    |
| <img src="images/icons/reset.svg" width="20" height="20">     | Reset zoom         | Returns the map to the default fitted view.                                                                                                                                                                                                                                                            |
| <img src="images/icons/pan.svg" width="20" height="20">       | Pan mode           | Click and drag to pan the map.                                                                                                                                                                                                                                                                         |
| <img src="images/icons/boxSelect.svg" width="20" height="20"> | Box select         | Click and drag to select a rectangular group of dies (see [Box select](#43-box-select)). This is the mode a map opens in.                                                                                                                                                                             |
| <img src="images/icons/drilldown.svg" width="20" height="20"> | Chart | Opens a menu of charts drawn from the selected dies, or from the whole wafer when nothing is selected (see [Charting dies and wafers](#44-charting-dies-and-wafers)). Only shown when there is something to chart. |
| <img src="images/icons/expand.svg" width="20" height="20">    | Expand             | Opens the map in an enlarged modal overlay. Opening the Summary panel in it widens the modal by the panel's width, so the map keeps its size. A maximise button in the modal grows it to fill the window (or press **F**). Press **Esc** or click outside to close. Useful for detailed inspection without changing the main view. Works in the Insights view too, where it opens the whole chart suite in a wide modal — useful because those charts interact and are best read side by side. Each chart can also be expanded on its own, with the expand button beside its ⋯. |
| <img src="images/icons/download.svg" width="20" height="20">  | Save image         | Downloads the current map view as a PNG. Captures the canvas as displayed, including all active overlays and the legend.                                                                                                                                                                               |
| <img src="images/icons/warning.svg" width="20" height="20">   | Data warnings      | Appears **only when there is something to report** about the data behind the map. Click it for the details. A red ⛔ means the map may be positionally wrong — usually that wafer geometry was guessed rather than supplied, so dies may not sit where they appear to. An amber ⚠ means something expected is missing or was skipped, but what is drawn is correct. |
| <img src="images/icons/help.svg" width="20" height="20">      | User guide         | Opens this guide.                                                                                                                                                                                                                                                                                      |

**This guide's own window** (and a gallery card detached into its own window,
see [Section 3 — Gallery](#gallery) below) is a floating window, not a modal —
its header shows collapse, maximize, and close buttons, and it can be dragged
and resized by its corner grip. Collapse shrinks it to a small title strip
without closing it; click the same button (now **Show contents**) to restore it.
While the window is maximized only restore and close are shown.

**Highlight bin** — in bin modes, click any bin swatch in the legend to highlight
that bin and dim all others. Click again to clear. Useful for isolating a specific
failure category across the wafer.

<div data-wmap-demo="bin-highlight" class="wmap-demo"></div>

*Bin 2 (Fail) highlighted — all other bins are dimmed.*

**Bin colours** — a bin's colour tells you whether it passed before you read the legend:
passing bins are always shades of green and failing bins never are, whichever bin numbers
your test program uses. Each bin number keeps its colour: bin 7 is the same colour in every
lot, every gallery and every screenshot, however many dies it holds, so you can learn your
program's colours. Hard and soft bins are coloured separately, so hard bin 3 and soft bin 3
are different colours. A colour scheme has a limited number of colours, so bins far enough
apart in number repeat one — when two of them are on screen together a **Data warnings**
entry names them, and you can tell them apart with the legend, the tooltip, or by
highlighting one bin at a time.

### Overlays

Use the **Overlays** menu to toggle optional display layers on and off:

- **Axis labels** — the die coordinates along the bottom and left edges. They appear when you zoom; this row shows
  them all the time, or hides them. **Clear overlays** returns to showing them on zoom
- **XY axis indicator** — shows X and Y axis lines through the wafer centre
- **Ring boundaries** — concentric ring divisions that match the spatial analysis zones
- **Quadrant lines** — divides the wafer into N, S, E, W quadrants
- **Die coordinate labels** — draws the (x, y) grid position inside each die (useful at high zoom)
- **Reticle grid** — stepper field grid (only shown when reticle geometry is configured)
- **Limit pass/fail** — pass/fail colouring for Test Value mode, judged against the test limits, when the active test defines them
- **Test pass/fail** — pass/fail colouring for Test Value mode, coloured by the tester's recorded verdict; always on for a functional (no measured value) active test

<div data-wmap-demo="overlays" class="wmap-demo"></div>

*Ring boundaries, quadrant lines, and XY indicator all active.*

### Compact layout

On a multi-project wafer, each reticle holds only a few of your dies, so the map is mostly empty and the dies you care
about are small. When the occupied columns and rows repeat at a regular pitch, the Overlays menu offers
**Compact layout**. Switch it on and the empty rows and columns disappear, so your dies are drawn as one grid at a
much larger size, with each group of dies outlined so you can still see the reticles they came from.

![A multi-project wafer in the wafer view](images/guide-compact-wafer.png)

![The same wafer in the compact layout](images/guide-compact-layout.png)

*The same synthetic wafer in the wafer view and in the compact layout.*

- **Nothing is left out.** Only the arrangement changes. Every die is still drawn and counted, so the legend, yield
  and statistics are the same as in the wafer view. A die that has no bin (for example one that carries metadata only)
  keeps its place, shown in the no-data grey.
- **Coordinates stay original.** Hovering a die and the axis labels give its real die coordinates, not its position
  in the compact grid.
- **Orientation.** The notch marker shows the wafer orientation and follows rotation and flips. The **XY indicator**
  works as it does on the wafer view, drawn in a margin beside the grid.
- **No wafer outline.** The wafer circle, ring boundaries, quadrant lines and reticle grid describe the physical
  wafer, which the compact grid no longer follows, so those rows are greyed out while the layout is on.
- **Galleries.** All cards share one layout, built from every wafer shown, so wafers can be compared cell for cell.
  Each card is as tall as its map needs, so more of them fit on screen; a quarter turn swaps a card's width and height.
- **Axis labels.** With the Axis labels row on, the first column of each group of dies is labelled with its real die
  coordinate, which marks the reticle boundaries; zoom in far enough and every die is labelled.
- **When it is offered.** The layout is offered when the occupied columns and rows repeat. If you supply
  `reticleConfig`, it is offered when they repeat at the reticle width and height or a multiple of it (a product on every second reticle repeats at twice the width). Random missing dies do not repeat, so
  a wafer that merely has holes is not offered it. Developers can switch it on regardless with
  `viewOptions: { compact: true }`.

**Layout diagnostics** (also in the Overlays menu) shows what the detector saw as counts and scores only: it holds no
die positions, bins, test values or wafer names. If a layout is not recognised the way you expect, copy the text or save
it as a file and send it to whoever supports this software.

### Keyboard shortcuts

| Key                      | Action                                                  |
| ------------------------ | ------------------------------------------------------- |
| **E**                    | Open the map in an enlarged modal overlay               |
| **F**                    | Maximise / restore the modal (when expanded)            |
| **Esc**                  | Close the expanded modal, or clear the die selection    |
| **Ctrl / Cmd + click**   | Add a die to the current selection                      |
| **Right-click**, **Menu key** or **Shift + F10** | Chart the selected dies, or the whole wafer (see [Charting dies and wafers](#44-charting-dies-and-wafers)) |
| **Mouse wheel / scroll** | Zoom in and out at the cursor                           |
| **Ctrl / Cmd + `+`** / **`-`** | Zoom in / zoom out                                |
| **Ctrl / Cmd + `0`**     | Reset zoom to the fitted view                           |
| **Arrow keys**           | Pan the map                                             |
| **Space (hold) + drag**  | Temporarily pan without leaving the current tool        |

![Legend style dropdown open](images/guide-display-legend-style-menu.png)

### Gallery

The gallery control bar applies to all cards simultaneously.

|                                                              | Control       | Description                                                                                                                                                                        |
| ------------------------------------------------------------ | ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <img src="images/icons/mode.svg" width="20" height="20">     | Plot mode     | Switches the plot mode for all cards.                                                                                                                                              |
| <img src="images/icons/overlays.svg" width="20" height="20"> | Overlays      | Toggles display layers for all cards simultaneously.                                                                                                                               |
| <img src="images/icons/palette.svg" width="20" height="20">  | Colour scheme | Picks bin colours (bin modes) or value colours (other modes) for all cards, including **Reverse gradient**.                                                                                                         |
| <img src="images/icons/orient.svg" width="20" height="20">   | Orientation   | Opens the rotate/flip controls, applied to all cards.                                                                                                                              |
| <img src="images/icons/columns.svg" width="20" height="20">  | Columns       | Sets the number of columns. **Auto** fits as many cards as stay readable; a number divides the full width between that many columns.                                             |
| <img src="images/icons/boxSelect.svg" width="20" height="20"> | Select on every wafer | A toggle. Off (the default), each card selects on its own. A badge counts the selected die positions; clicking the button while something is selected clears it. On, a box, a click or a clear on any card applies to every card at the same die positions, so a region is read lot-wide; right-click then opens charts and tables of those dies across all the wafers (see [Box select](#43-box-select)). |
| <img src="images/icons/downloadAll.svg" width="20" height="20"> | Save image    | Downloads the full gallery grid as a single PNG.                                                                                                                                   |
| <img src="images/icons/aggr.svg" width="20" height="20"> | Aggregation method | Stacked modes only. Selects how values from multiple wafers are combined per die position: Mean, Median, Std Dev, Min, Max, or Count. |
| <img src="images/icons/logScale.svg" width="20" height="20"> | Log scale     | Test Value and Stacked Test Values modes only. Applies a log₁₀ scale to the colour mapping for all cards. |
| <img src="images/icons/legend.svg" width="20" height="20"> | Legend style  | **Legend on each map** adds a legend to every card as well as the shared one above the grid (off by default). While it is on, bin modes also let you choose where that legend sits on each card. |
| <img src="images/icons/specRange.svg" width="20" height="20"> | Colorbar range | Test Value mode with test limits only. Toggles all cards between the limit range and the data range. Leave it on the test limits when comparing wafers — the data range rescales per view. |
| <img src="images/icons/warning.svg" width="20" height="20"> | Data warnings | Appears only when something is worth reporting about the wafers shown. Collected across every wafer and de-duplicated, so a problem affecting all of them is stated once rather than repeated per card. |
| <img src="images/icons/help.svg" width="20" height="20"> | User guide    | Opens this guide. |

Right-click a card anywhere outside its map to chart that wafer on its own — a
histogram, process capability or a sweep (see
[Charting dies and wafers](#44-charting-dies-and-wafers)).

Click a card's expand button to detach it into its own separate window with the
complete single-map toolbar (falls back to a floating window inside the page if
separate windows aren't available in your environment). The vacated grid card
becomes a placeholder whose own button reattaches it; closing the detached
window does the same.

<div data-wmap-demo="gallery" class="wmap-demo"></div>

---

## 4. Interacting with dies

### 4.1 Hover

Hovering over a die shows a compact tooltip. It always includes the die grid
coordinates (x, y), and a retest count if the die was probed more than once.
The rest depends on the active plot mode:

- **Bin modes** — the die's bin verdict (number and name, if named), plus a
  note of how many test values are recorded for the die
- **Test Value mode** — the active test's value in bold, flagged when it is
  outside the test limits, with the remaining tests summarised as "+N more tests"
- **Stacked modes** — the single aggregated value or count at that position

### 4.2 Zoom and pan

Scroll to zoom in and out. To pan, hold **Space** and drag, use the arrow keys,
or choose Pan mode in the toolbar so that a plain drag pans. The toolbar also
provides dedicated **Zoom mode** (drag to draw a zoom region), **Zoom in**,
**Zoom out**, and **Reset zoom** buttons. Tooltips and die selection remain
accurate at all zoom levels.

### 4.3 Box select

Click and drag on the map to draw a selection rectangle — Box select is the mode
a map opens in. Click a die to select just that die, and click it again to clear
it. The application may display statistics or details for the selected dies.
This is useful for comparing a sub-region against the full wafer.

Selected dies keep their full colour and every other die is faded, with an
outline round the selection, so it is clear which dies are selected whatever
their shape — a block, a ring or scattered dies. A finding highlighted from the
Summary panel is shown the same way.

Use **Ctrl / Cmd + click** to add or remove individual dies. Press **Esc**, or
click outside the wafer, to clear the selection.

**In a gallery**, each card selects on its own unless you turn on **Select on every
wafer** in the toolbar. Then a selection made on one card is made at the same die
positions on every card — draw a box round the edge ring, a scratch zone or a
reticle corner once, and see that region on all the wafers. Right-click (or use
the **Chart** menu) and the charts and tables open on those dies across the whole
lot: **Dies**, **Test statistics** and a **Wafers** table with one row per wafer,
each stating "selected at the same die positions on N wafers".

**Pick whole wafers instead** with **Ctrl / Cmd + click** on a card's header: the card is
outlined and the toolbar counts "N wafers picked ✕" (click it to clear). Right-click
one of the picked cards and the charts and tables open on every die of every picked
wafer, with a **Wafers** table. Dies selected on a map take precedence over a pick.

The button shows how many die positions are selected. **Clear it** by clicking an
empty part of any map, pressing **Esc**, or clicking the button itself (it clears
the selection and stays on); a second click turns the mode off. Turning it off
always clears the selection on every card.

<div data-wmap-demo="box-select" class="wmap-demo"></div>

*A block of dies near the centre is shown pre-selected. Drag on the map to make
your own selection, or Ctrl/Cmd + click individual dies.*

### 4.4 Charting dies and wafers

**Right-click** a population to open a menu of charts and tables drawn from just
those dies. Picking one opens it in a window over the map. This is how you look at a
cluster, a scratch or an edge region on its own, or at one wafer out of a lot.

What you right-click decides the population:

- **Selected dies** — select some dies, then right-click on the map. Right-
  clicking a die that is **not** selected selects that die alone first;
  right-clicking a selected die, or empty space, keeps the selection.
- **Dies selected on several wafers of a gallery** — by clicking a finding, or by selecting on more than one card.
  Right-click a selected die on any of those cards and the menu opens on every selected die, with a first row,
  **Only this wafer**, that narrows it to the dies selected on the card you clicked (and **All selected** to go back).
- **A bin in the legend** — right-click its entry, on a map's legend or the gallery's lot legend. The menu opens on that
  bin's dies (on this wafer, or on every wafer for the lot legend), and nothing is selected: the legend only filters what
  is drawn. With several bins filtered in, right-clicking one of them opens on all of them, with an **Only bin N** row to
  narrow it (and **All filtered bins** to go back). On the lot legend the Menu key or Shift + F10 works on a focused entry.
- **Plots and sweeps you have saved** — they open in their editor over just those dies, so you can change one there; the
  change is saved to the plot.
- **A finding** — right-click it in the Summary panel. If it is not already shown, its dies are selected first, then
  the menu opens on them: on all the wafers of a gallery that the finding selects dies on. A finding that is about
  whole wafers and selects no dies (a wafer's yield) opens the menu on those wafers.
- **A whole wafer** — right-click empty map space with nothing selected, a
  gallery card anywhere outside its map (its header, the space around the map),
  or one wafer's bar, box or point in an Insights chart (*Yield by wafer*,
  *Test value distribution*, *Wafer-to-wafer trend* — their tooltips say
  "right-click to chart this wafer").
- **Dies dragged out of the Correlation scatter** — across any number of wafers.
  The menu then also offers a **Wafers** table, one row per wafer the dies fall on.

On the map you can also press the **Menu** key or **Shift + F10**, or use the
**Chart** toolbar button, which charts the selection when there is one and the
wafer otherwise.

The menu offers:

- **Value histogram** — one test's distribution, opening on the test the map
  is showing. **Edit as plot** in its ⋯ menu closes it and
  opens the same test as a draft plot over the same dies, to change its axes, colour or limits and keep it if you want.
- **Process capability** — every test normalised to its spec limits, or its
  test limits when it has none, with its
  Ppk. Tests beyond the card's width scroll sideways, with the scrollbar under their names or a sideways wheel. Below 30 dies the chart says each Ppk is a rough estimate: a Ppk from a
  handful of dies can be far from the process's real capability.
- **Plots** you have saved, sweeps included (see [Plots](#plots) and [Sweep cards](#sweep-cards)), and **New plot…** and **New sweep…**.
- **Dies** and **Test statistics** — the same tables as Insights' Data tab (see
  [Data tables](#data-tables)), over just these dies: every die as a row, or the
  Test Values and Functional Tests tables. Each has Export CSV and Copy, and a
  saved file carries the population ("selected on W03") in its name and in a
  Wafer column, so it cannot be mistaken for the whole lot.

What every chart opened this way does:

- It states its population — how many dies and which wafer they came from — in
  its title and above the plot, so it cannot be mistaken for a chart of the
  whole lot. Partial and edge-excluded dies are left out, as they are
  everywhere else, and the chart says how many that was.
- It is a **snapshot**: changing the selection afterwards does not change a
  chart that is already open.
- A chart that cannot be drawn from the population stays in the menu, greyed,
  with the reason — for instance when none of the dies has values for its tests,
  or when the map is a lot stack, whose dies are averages across wafers rather
  than measured dies.

A map with only bin data has no charts to draw, but its menu still opens with
**Dies**: the selected dies, or the whole wafer, as a table.

---

## 5. Findings panel

When spatial analysis has been run, the **Findings** panel lists statistically
detected patterns on the wafer. Open it from the toolbar.

Each finding shows:

- **Severity** — Unusual, Notable, or Minor (ordered most to least significant)
- **Description** — plain-language summary of what was detected and where
- **Click to highlight** — clicking a finding fades the rest of the wafer and outlines the
  affected dies. A finding about a bin also filters the legend to that bin, so the legend
  always names what the finding describes; a finding about yield or a test clears the
  filter. Changing the selection or the legend filter yourself releases the finding.

**Severity** reflects how strong the statistical evidence is. *Unusual* findings
have both a very low adjusted p-value and a large effect size — they are reliably
important. *Notable* findings are statistically significant with a meaningful
effect but not as extreme. *Info* findings pass the significance threshold at
lower strength and are worth reviewing but may reflect smaller or noisier patterns.

**Test-value findings** (a region reading high or low on a test) take the longest to compute, so
they are included automatically only when the data is small enough to take about a second. On
more data the panel says they are not included, with the number of tests and dies and roughly
how long they would take, and an **Analyse** button that adds them. For a lot, one click analyses
every wafer. Findings about tests failing their limits are included either way.

<div data-wmap-demo="findings" class="wmap-demo"></div>

*Findings panel open showing a detected edge-ring pattern. Click any row to
highlight the affected dies on the map.*

![Cluster finding highlighted on map](images/guide-findings-cluster-highlight.png)

*A failure cluster finding: the rest of the wafer is faded, so the affected dies stand out, with an outline round them.*

Clusters are looked for in the failing dies together and in each failing hard bin on its own, so a spot of one bin
next to other failures (a spot touching a failing edge, say) is still reported as that bin's cluster.

### Finding types

| Type                 | What it indicates                                                                                   |
| -------------------- | --------------------------------------------------------------------------------------------------- |
| **Ring**             | Yield or value difference between radial bands — e.g. centre vs edge gradient                       |
| **Quadrant**         | Yield or value difference between N, S, E, or W quadrants                                           |
| **Sector**           | Asymmetry across finer angular slices — rotational bias or directional process variation            |
| **Test-site**        | Yield or value difference between parallel probe sites on the same wafer                            |
| **Reticle position** | Yield signature repeating at specific stepper field grid positions                                  |
| **Cluster**          | Contiguous group of failing dies denser than the background failure rate                            |
| **Edge arc**         | Localised arc of failures near the wafer perimeter                                                  |
| **Spatial pattern**  | Classification of an identified cluster shape — e.g. Donut, Scratch, Centre, Edge-localised, Random |

Which finding types are active depends on the application's analysis
configuration.

When a spatial pattern classification is detected alongside supporting regional
findings (ring, quadrant, sector), the panel groups them together — the pattern
classification is the primary finding and the regional findings provide
supporting detail. A cluster of one bin does the same for that bin: the rise in
the bin in the quadrant, sector or ring around it is listed under the cluster,
which says where the failures are. A region row that is more severe than
the cluster is listed on its own.

---

## 6. Summary panel

The Summary panel docks next to the map and gives you the wafer or lot at a
glance, with findings sitting directly under the headline numbers so a clicked
finding can highlight the affected dies right there. The **Summary** button in the row
above the map, just before Map | Insights, opens and closes it, and shows as pressed while
it is open. The **▸** button at the end of the panel's title closes it too, and stays in
view as the panel scrolls.

<div data-wmap-demo="summary-panel" class="wmap-demo"></div>

*The Summary panel open alongside a single wafer. Click any finding to
highlight the affected dies.*

Sections, top to bottom:

- **Summary** — die and wafer counts, yield, and the population the rest of the
  panel is computed over. For several wafers the heading names them: **Lot
  LOT123 · 13 wafers** when every wafer comes from that one lot, otherwise
  **26 wafers from 2 lots** (or just **13 wafers** when the data records no lot).
  The panel only says "lot" when it really is one lot. "Mean per-wafer yield" is an
  *unweighted* mean of each wafer's own yield; it is deliberately not the same
  statistic as the bin breakdown's pass-bin share, which weights every die
  equally. The two agree only when die counts are even across the wafers.
- **What stands out** — the headline (the yield, and for a lot its spread across
  wafers), then the items ranked by how much of the lot each affects: the largest in a tinted
  box with its full sentence, the others as a compact list (impact, name, and its size: a share of
  the dies, a shift in standard deviations, or a Ppk).
  An item is a loss or a signal. A **loss** costs dies: a region's shortfall with the failing bins
  that make it up, a wafer well below the lot, or a test outside its limits (or a functional test
  failing). A **signal** costs no dies of its own but moves the values, which is often all a
  characterisation lot has to show: a test whose mean shifts in a region by at least half a standard
  deviation, a trend across the wafers *in the order given* (said as "input order": the order is only a
  physical one if you know it is), a test whose Ppk against its limits is under 1.0, a test outside
  its limits on dies binned as passing, or, in a lot, a test that differs between the values of a wafer
  field Group by offers (a process split, a lot, a test program). A group is judged with each wafer as
  one value, the way Insights compares groups, adjusted over every field and test compared, and its size
  is the shift in the test's within-wafer standard deviations, the scale a region's shift is measured on.
  A field is one item however many tests it moves ("34 tests differ by Split. Largest: …; next: …"), with the tests
  that moved most as its chips, so a corner lot does not fill the list with one split. Both are ranked on one scale, the share of the dies an item
  affects: a loss by the dies it cost; a shift by its dies, counted in full from two standard deviations
  and by the square of its size below that (a one-sigma shift counts a quarter of its dies); a trend by
  how far it moved; a group's shift by the dies of the wafers that moved, weighted as a shift is; a Ppk under 1.0 by
  the share of dies its spread would put outside its limits.
  Anything affecting less than 1% of the dies is left to the findings list. A line says what was
  compared. Its three dots and word (High, Moderate or Low impact) say how much of the lot an item
  affects: the higher of its share of all the dies (2% moderate, 4% high) and, for a loss, its share of
  the dies that fail (15% moderate, 40% high), so a small area that is most of a good lot's loss still
  reads as high.
  A test is costed by the dies it fails that also fail yield: dies outside its limits but binned
  as passing cost nothing. A test whose failures lie mostly in a region, or whose values shift on a
  region's dies, is said as part of that region's item rather than listed again beside it, and one test
  is one item.
  **Every item is a row, and every row shows its dies on the map** — a wafer icon at its end marks
  it. Click a region or wafer to highlight it, or a test to show the test's values with the dies it
  fails selected; click again to clear. Under the top item's sentence, chips name its parts (its
  failing bins, with their legend colours, the pattern, and tests failing or shifted on the same dies),
  and each chip shows that part alone. With Insights on, each of the top items also has a **Chart**
  link, which opens Insights at its card under **Worth a look** on the Overview.
  A wafer or lot with nothing affecting a yield point's worth of dies says so: "Nothing stands out".
  The reports open with the same section, and **Full report** at the foot of it opens the
  report; in a report opened from the panel, clicking a finding's row shows it on the map.
- **Findings** — detected anomalies, most severe first, each group marked with
  three dots filled by severity (Unusual, Notable, Minor). The header says how
  many are unusual or notable, even when the section is collapsed, and the
  severity chips narrow the list. Click a finding to show it on the map. A spatial
  pattern has a **Show N supporting findings** line under it that lists the
  regional findings it explains.
- **Bin breakdown** — bars as a share of dies, pass bins first and then failing
  bins by descending count, so the dominant failure mode is at the top. It
  follows the map's plot mode: a soft-bin map gets a soft-bin breakdown. When a
  wafer carries both bin types, a **Hard / Soft** selector in the section header
  overrides that.
- **Region yield** — ring yield by default, with a **Ring / Quadrant** selector (and **Reticle cell**, the yield of each
  position within the stepper field, when a reticle is set).
  Each row prints its difference from the wafer's yield in points and is tinted
  when it is 1, 2 or 4 or more points below it (nothing above is tinted).
  Ring is the default because edge roll-off is the pattern that dominates real
  wafer maps; a genuinely asymmetric quadrant is reported as a finding above,
  with a significance test behind it.
- **Wafer yield** (several wafers only) — one bar per wafer with the median
  marked, each row's difference from the median in points, and a tint when it is
  1, 2 or 4 or more points below it. Wafers are in slot order by default, since that is what makes a
  slot-correlated pattern visible; a **Slot / Yield** selector re-sorts. Wafers
  well below or above the rest are labelled "low outlier" or "high outlier"
  (3 or more wafers, and at least 3 points from the median — the same rule as the
  outlier-wafer findings).
- **Test values** — per test: mean, **Ppk**, and limit yield. Ppk (not Cpk)
  because it measures against the *overall* spread, including wafer-to-wafer
  variation, which is what the dies actually ship against. The full descriptive
  statistics — min, quartiles, median, max, σ, both test limits, and all four
  capability indices — are in the CSV export, and the wafer summary report shows
  N, min, quartiles, median, mean, max, σ and limit yield (a lot's report has N, min, mean,
  max, σ and limit yield: quartiles cannot be combined from each wafer's own). Both reports
  also carry the full Cp, Cpk, Pp and Ppk table.
- **Functional tests** — pass/fail counts and pass rate per functional test.

Every section header can be collapsed, and stays collapsed as the panel
re-renders.

A **Summary report** button (when present) opens a printable full-detail
report — yield, bin breakdown, ring and quadrant statistics, the full per-test
table with Cp/Cpk/Pp/Ppk, and the findings list — and can be saved as a PDF
from your browser's print dialog. It opens with **What stands out**: the yield,
up to three items ranked by how much of the lot each affects (losses and signals alike, as
the panel ranks them), and a line saying what was compared. An item is listed only when it
affects at least one per cent of the dies analysed; a lot with none says so. Each item links to its
evidence: a finding to its row in the Findings table below, a test to the Test Values
or Functional Tests section. Severity is drawn as three dots and a word, so it reads in a
black-and-white print; yields carry a bar, and a wafer or region is tinted only when it is
at least a point below the rest.

![Wafer summary report](images/report-wafer-summary.png)

A **Data tables** button beside it opens the same tables as Insights' Data tab ([Data tables](#data-tables)) over this wafer, or over the whole lot in a gallery: Statistics, every die, and, for a lot, one row per wafer — each with Export CSV and Copy. It does not need Insights to be switched on.

### Why some findings name two bins

A finding may read **"hard bin and soft bin 3 (Fail) (same dies)"**. That is one
group of dies counted in two bin spaces, not two separate groups added together.
(When the two bins carry different names, both are spelled out in full.)
Hard and soft bins are independent numbering systems, so this wording appears
only when the two happen to cover exactly the same dies — reporting it twice
would look like two independent problems.

For the same reason, when a single pass bin is configured you will see the
**yield** finding for a region but not a separate finding for the pass bin
itself: "pass-bin occurrence is 22 points lower" and "yield is 22 points lower"
are the same sentence.

Nothing is discarded — an application reading the findings programmatically
still receives every one of them.

For **lot-level views** (gallery), the panel shows lot-level findings, and the
**Wafer Yield** section badges each wafer with its own findings count — click a
row to open that wafer. There is no separate wafers tab: every wafer appears in
that one list, including the ones with no findings, which is what lets you see a
low-yielding wafer that nothing flagged.

![Lot summary report](images/report-lot-summary.png)

---

## 7. Lot-stack maps

A lot-stack map combines multiple individual wafer results into a single
composite view. The display clearly identifies this: the number of wafers
included and the aggregation method in use are shown in the panel header
(for example, "3 wafers · mean") so you know you are not viewing a single
wafer's data.

Individual die coordinates are preserved. For each die grid position, results
from all wafers are aggregated into a single value or bin count according to
the selected aggregation method.

### Stacked plot modes

Switching to a stacked mode changes what each die's colour represents:

| Mode                    | What the colour shows                                                                             |
| ----------------------- | ------------------------------------------------------------------------------------------------- |
| **Stacked Hard Bins**   | For each die position, the count of wafers on which that bin appeared — one card per bin category |
| **Stacked Soft Bins**   | Same as above, for soft bin categories                                                            |
| **Stacked Test Values** | For each die position, an aggregate of the test measurement across all wafers                     |

### Aggregation method

In **Stacked Test Values** mode, use the **Aggregation method** toolbar button (Σ)
to choose how values from each wafer are combined at each die position:

| Method      | Result                                                           |
| ----------- | ---------------------------------------------------------------- |
| **Mean**    | Average value across all wafers                                  |
| **Median**  | Middle value — less sensitive to outliers than mean              |
| **Std Dev** | Standard deviation — shows where values vary most across the lot |
| **Min**     | Lowest value seen at that position                               |
| **Max**     | Highest value seen at that position                              |
| **Count**   | Number of wafers with data at that position                      |

### Gallery stacked modes

In a gallery, stacked modes are always available in the control bar. Switching to
a stacked mode shows one card per bin category or per test parameter, aggregated
across all wafers in the gallery.

<div data-wmap-demo="lot-stack" class="wmap-demo"></div>

*Stacked Hard Bins mode: each die position is coloured by how many wafers had
bin 1 (Pass) or bin 2 (Fail) at that location.*

---

## 8. Insights tab

The **Insights** side of the **Maps | Insights** switch (at the far right of the toolbar row, single map or
gallery) swaps the wafer view for a chart suite computed from the same die data — without leaving the
toolbar. Choose **Maps** to return to the map; the switch stays where it is. Independent of the Findings
sidebar (see [Summary panel](#6-summary-panel)) — the two toggle independently, and opening one never
hides the other's toolbar button, since Findings has nothing to highlight
against once the map is replaced.

Any chart mark that stands for one wafer — a bar in *Yield by wafer*, a box in
*Test value distribution*, a point in *Wafer-to-wafer trend* — can be
right-clicked to chart that wafer on its own (see
[Charting dies and wafers](#44-charting-dies-and-wafers)); its tooltip says so.

Insights is organised into three chart sub-tabs, a **Data** sub-tab holding the
same numbers as tables (see *Data tables* below), and a **My plots** sub-tab for your
own charts and sweeps (see *Plots* and *Sweep cards* below):

- **Overview** — a **test pass rate** chart showing which test fails most (and,
  with "Group by" active, whether it fails more in one split than another). It
  offers up to three ways of judging, whichever the data supports: **Spec
  limits** (the value against its limits), **Tester flag** (the pass/fail the
  tester itself recorded, which a parametric test carries whether or not limits
  were exported), and **Functional** for pass/fail-only tests. The two
  parametric views can disagree — guard bands and dynamic limits routinely cause
  it — so the card reports how many dies the two judged differently rather than
  picking one for you. The tests run down the left, worst first, each with its pass rate at the end; click a test's
  bar for the dies that fail it. The card is the size of the others whatever the number of tests: more than fit
  scroll, with the scrollbar at its right edge or the mouse wheel over the chart, under a pass-rate axis that stays put. With nothing to judge (no limits, no recorded verdicts) the card is left out. Alongside it, headline tiles stating the population (wafers, dies analysed,
  and for a lot the mean wafer yield — an *unweighted* mean of each wafer's own
  yield, not the die-weighted figure), a yield bar labelled with the pass bins
  actually in use, each bar's yield at its end and the median of the bars as a line (with Group by on, one bar per
  group, pooled as passing dies over judged dies; click a group's bar to see its wafers, **Back** to return), a
  hard/soft bin pareto with its cumulative share (with Group by on, a bar per group in each bin, as each group's share
  of its own dies, so groups of different sizes compare, or as counts), and
  ring/quadrant regional yield, and with a reticle set a **Reticle cell yield** grid: the stepper field drawn as its cells (row 0 at
  the bottom), each filled by the yield of that position pooled over every field on every wafer and labelled with it. Hover a cell
  for its dies, click it to chart or tabulate them. A cell that is low in all of them points at the mask rather than the wafer.

  With four or more wafers and wafer fields to compare (lot, split, date, probe card…), **What divides yield** ranks
  every field by how clearly its groups differ in yield and in the rate of each of the five most common fail bins. Each
  wafer is one value, as in the split comparison, so n is wafers; rows are ranked by q (Welch's p adjusted for every
  comparison in the table). A row names the worst and best groups with their mean over their wafers and the spread in
  percentage points; **Group by** groups the whole tab by that field. A low q says the groups differ by more than
  wafer-to-wafer noise, not why. The card also names fields it could not compare (every wafer its own value) and fields
  that group the wafers identically, which no ranking can tell apart (a lot and its test date).
- **Worth a look**, on the Overview below the yield, bin and region cards — the same items as
  **What stands out** beside the map, in the same order and words, each drawn as the chart that shows
  it: a region's loss as yield by that kind of region (each bar with its value, and the median of the bars as
  a line, as on the yield card), a fail bin as the bins' shares by it, a shifted
  test as a box of the test by it, a failing or too-wide test as its histogram (a pass/fail test as its
  pass rate), a trend as a control chart, an outlier wafer as yield by wafer. Each card says why it is
  shown in one sentence (hover it for the whole sentence What stands out gives, with the bins and tests it
  names), and **Show on map** goes back to the map showing it as its row does, with the Summary panel
  open on that row. The rest follow on one "Also" line. It describes the whole lot, so while the Insights
  filter or **Show** narrows the population it says so instead of drawing cards.
- **Distributions** — process capability (Cp/Cpk/Pp/Ppk for tests with both a
  lower and upper limit — spec limits where given, otherwise test limits; tests
  without both still appear, normalized
  onto their own range and sorted by variability), a test-value box plot (one box per wafer down the left, or with
  Group by on one per group: click a group's box to see its wafers, **Back** to return), a value histogram (all wafers,
  one wafer, or one series per group), and a **wafer-to-wafer trend** — one point per wafer at its mean with a ±1
  standard deviation band, the mean of all wafers as a line (labelled the "lot mean" when they all come from one lot),
  and the test's limits; drag across it to pick a run of wafers. The trend is always in slot order, deliberately: drift
  across a cassette only reads in the physical sequence, so there is no sort control to destroy it, and it needs at
  least two wafers. The box plot, histogram and trend are plots: each has the test picker and the axis settings
  (*Axis includes limits*, *Clip outliers*, and which limits to draw), and a change in one reaches the others.
  Clicking a capability box drives them onto that same test.

  With **Group by** on, a **Difference map** at the foot of Distributions draws one group minus another at every die
  position, as a wafer map: pick the two groups and a test (it follows the test the other panels show until you pick
  one) or *Yield*. Each group's value at a position is its mean over the group's wafers there (for yield, the share
  of them passing), as its stacked map would show it, and a position either group lacks is grey. The colours run
  symmetrically from the largest negative difference to the largest positive, with zero in the middle. It is drawn on
  the first wafer of the first group's geometry and orientation, so a die is where it is on every other map; the map
  carries no wafer's identity, since it is none.

  With **Group by** on (a split, a lot), the cards that compare the groups come first, under **Comparing …**: the
  **Comparison by** table and the difference map, then the cards for each test under **Test by test**. The table compares
  every measured test across the groups, ranked so the tests that moved are at the top. Each wafer counts once, as the mean of its dies, because dies
  on one wafer share its processing: counted die by die, a difference no bigger than one wafer's offset would look
  certain. So n is the number of wafers, and with two or three a group, many differences honestly come out
  inconclusive. For each test the table gives each group's mean, **Welch p** (Welch's ANOVA, or Welch's t for two
  groups: do the means differ, without assuming equal spreads), **Rank p** (Kruskal–Wallis, the same question on ranks,
  which one odd wafer cannot drive; approximate with fewer than five wafers a group), **q** (Welch p adjusted for how
  many tests were compared, Benjamini–Hochberg; the table is sorted by it), and the **largest shift** in wafer-to-wafer
  standard deviations and as a share of the limit window. Choose a **Control** (the process of record) and each other
  group's cell adds its difference from the control with a Holm-adjusted p. Click a test to show it in the panels below.
  **Comparison CSV** saves the table. [Comparing groups of wafers](#102-comparing-groups-of-wafers) explains each figure. Narrowing **Show** to one group leaves nothing to compare, so the table is not shown.

  The box plot, histogram, trend and the Correlation tab's scatter draw the
  test's limits as dashed lines. A test can have two kinds: **test limits**
  (labelled *Lo limit* / *Hi limit*, short dashes) — what each die was judged
  pass/fail by — and **spec limits** (labelled *LSL* / *USL*, long dashes) —
  the process specification that capability is measured against. When a test
  has both, a **Limits** choice appears — *Test + spec* (the default), *Test
  limits*, *Spec limits* or *None* — and it applies to all four charts at
  once. A test that lacks the kind you chose shows the kind it has, so it
  never looks as if it had no limits; a limit that falls outside the plotted
  range is marked at the edge of the chart with an arrow.

  The box plot, histogram and trend share one row of axis controls, kept in
  sync across all three so switching between them never re-reads the same
  data on a different scale: **Axis includes limits** widens the axis to cover
  every limit shown even where the data sits well clear of them (on by default only when
  doing so still leaves the data at least a third of the axis — otherwise a
  generous limit window would squash a perfectly capable distribution into a
  sliver), and **Clip outliers** narrows the axis to a robust range (the
  Tukey fence, 1.5× IQR beyond Q1/Q3) so a handful of extreme values don't
  stretch the axis until the rest of the distribution reads as a flat line.
  Clipping affects the AXIS only — every reported statistic (mean, σ, Cpk,
  the box's own five-number summary) is computed from every value; nothing is
  excluded from the numbers, and the panel states how many points sit outside
  the visible range when some do. The box plot additionally has its own
  **Log scale** toggle, independent of the shared pair above (available once
  every plotted value is positive) — the histogram and trend charts do not
  offer one.
- **Correlation** — a test-to-test correlation matrix and a die-level scatter
  plot, both stating the sample size the coefficients are computed over.
  **Max tests** (5 to 100, 20 by default) sets how many tests the matrix shows, and
  **Correlation CSV** saves the matrix as a table.
  Clicking a matrix cell drives the scatter plot onto that pair, where `r` and
  `n` over every point drawn are printed (with Group by on, the colour is the group; filter the legend to look at one).
  When the points pool several splits or lots, the scatter says so: a trend across them may be the groups' offset
  rather than the relationship. Hover a
  point to see which wafer and die it is; **click** it to open that wafer on the
  X test. **Drag** a rectangle over the plot to select the dies inside it — across
  as many wafers as they fall on — and a menu opens with charts and tables of
  just those dies (see [Charting dies and wafers](#44-charting-dies-and-wafers)). The
  selection stays ringed until you change the X or Y test or click empty space.

In a gallery with more than one wafer, a **Group by** control appears whenever
a *wafer attribute* (lot, product, test program, temperature, split, or a custom
field) actually varies across the loaded wafers — grouping pools or restricts
each panel differently depending on what makes sense for that chart type. Group by
separates whole wafers; to separate the dies within each wafer, a plot's own
**Compare by** choices (see [Plots](#plots)) take die regions, bins, sites and
pass/fail tests as well.
**Filter…**, beside Group by, narrows every Insights tab at once to the wafers and dies that meet conditions you set:
one split, the edge ring, bin 1, a range of a test, wafers below a yield. It opens a window with the same conditions a
plot's own filter has, saying as you edit how many wafers and dies they keep; **Apply** filters, **Cancel** leaves
things as they were. While a filter exists a line above every tab states it, with what it keeps
(*2 of 3 wafers · 48 of 72 dies*), **Edit…** and **Remove**; its switch turns it off without losing it, and the line
stays, saying the filter is off, until you remove it. A filter that names a field these wafers do not have filters
nothing, and the line says so. Group by and **Show** then work on what the filter kept. The map views are not filtered.

Histogram, correlation, and scatter also offer a **Wafer** picker to narrow
from "all wafers pooled" down to one wafer at a time. Clicking a yield bar or
box-plot row for one wafer opens that wafer's own map — a box-plot click opens
directly on the test you were looking at.

<div data-wmap-demo="analysis" class="wmap-demo"></div>

*Insights tab open on a single wafer, Overview sub-tab: yield and bin pareto and
ring/quadrant yield — all computed from this wafer's own dies. The Distributions sub-tab has process capability, a test-value box
plot and histogram; Correlation has a correlation matrix with scatter plot.
In a gallery, Overview also gains a "Group by" control and per-wafer
yield/box-plot rows.*

![Gallery Insights — Overview sub-tab](images/guide-insights-overview.png)

*Gallery Insights, Overview sub-tab: lot-wide yield by wafer (click a bar to
open that wafer's map), hard/soft bin pareto, and ring and quadrant yield. The **Maps | Insights** switch at the top left (it does not move between the two views) returns to the card grid.*

![Gallery Insights — Distributions sub-tab](images/guide-insights-distributions.png)

*Distributions sub-tab: process capability (coloured by Ppk — green capable,
orange marginal, red poor; tests without limits are muted and dashed), a
per-wafer test-value box plot, and a value histogram. Clicking a capability
box drives the box plot and histogram onto that test.*

![Gallery Insights — Correlation sub-tab](images/guide-insights-correlation.png)

*Correlation sub-tab: test-to-test Pearson correlation matrix (blue =
positive, orange = negative; intensity = strength) and a die-level scatter
plot coloured by hard bin. Clicking a matrix cell drives the scatter plot
onto that pair.*

### What a click does

Every mark on an Insights chart stands for something, and a click opens it:

| Click | Opens |
| --- | --- |
| A wafer's bar, box or point (Yield by wafer, the box plot, the trend, the scatter, a My plots chart) | that wafer's map, on the test the chart is about (the bins, for Yield by wafer) |
| A **bin** in the bin pareto (with Group by on, one group's bar in it) | the right-click menu on the dies in that bin |
| A **test** in a pass-rate chart | the menu on the dies that fail that test, judged as the card is |
| A bar of the **value histogram** (with Group by on, a column of it) | the menu on the dies whose values fall in that bar, across the groups, or in the one group the legend has emphasised |
| A level of a **sweep** curve | the menu on the dies measured at that level |
| A **drag** across the wafer-to-wafer **trend** | the menu on the dies of the wafers whose points the drag crossed (a click on a point still opens that wafer) |
| A **ring** or **quadrant** of the yield diagrams | the menu on the dies it counts |
| A cell of the correlation matrix | that pair in the scatter |
| A test in the process-capability chart | that test in the other distribution charts |
| A row of the **Wafers** table | that wafer's map |
| A row of the **Dies** table | that die, ringed on its wafer's map |

The menu offers the charts and tables for just those dies (and your own plots), and its heading names
them, for example "412 dies in hard bin 3, across 13 wafers". A mark that has no dies behind it does nothing.
Right-click on any wafer's bar, box or point opens the same menu for the whole wafer.

### Data tables

![Gallery Insights — Data sub-tab](images/guide-insights-data.png)

*Data sub-tab, Statistics view: the Test Values and Functional Tests tables for the lot, each with its own CSV button; **Dies** and **Wafers** are one click away.*

The **Data** sub-tab shows the wafers Insights is scoped to as tables, one at a
time, chosen with the **Statistics | Wafers | Dies** control. It follows the
same "Group by" and "Show" scope as the charts.

- **Statistics** — the **Test Values** table (count, min, quartiles, mean, σ,
  Ppk, limits and the limit yield for each test, with its N stated) and the
  **Functional Tests** pass-rate table. With "Group by" active there is one set
  per group.
- **Dies** — one row per die: wafer, X, Y, ring, quadrant (and reticle cell and shot when a reticle is set), site, bins, a column
  for each test, and the wafer's metadata. Only the rows in view are drawn, so a
  lot of hundreds of thousands of dies scrolls smoothly. Click a column heading
  to sort by it (again to reverse; a die with no value sorts last).
- **Wafers** — one row per wafer: lot, split and any other metadata, the die
  counts, the yield (the same figure as the yield chart), and the mean of each
  test (the first 50).

In the Dies table, **click a row** to show that die on its map: the table steps
aside (or Insights closes) and the die is ringed, on its own card in a gallery. The
ring goes with the next click on the map, or Esc.

**Export CSV** saves the table as shown, in the order shown. Numbers are written
in full, as plain numbers, not as the formatted text on screen (`0.5123457`, not
`512 mV`), with the unit in the column heading. **Copy** puts the table on the
clipboard as tab-separated text, ready to paste into a spreadsheet; it is offered
for tables up to about 200,000 cells. For the Dies table, **Export format** (Wide | Long) chooses
the layout of the file: wide has a column per test, long has a row per die per
test (a die with no result for a test has no row), the shape statistics tools
prefer. The note under the buttons says how many rows the file will have, and
warns when that is more than a spreadsheet can open (1,048,576).

### Plots

The **My plots** sub-tab is where you build your own charts. **+ New plot** starts one,
already filled in with the first two tests of the lot, and opens it beside a large
copy of the chart. **Edit as plot**, in the ⋯ menu of an Insights chart, opens that chart as a plot of your own (see
*A chart's buttons* below). **Add examples** draws plots to start from, or to see what each chart and
setting is for. They are chosen from the lot in view: the *lead* test is the one that varies most from wafer to
wafer (for a single wafer, the one that follows distance from the centre most), its partner the test that tracks it
best, and the split is the lot field that best explains the lead test. The examples are a scatter of the lead
test against its partner with a fitted line, a histogram with its
normal curve, a box of the lead test by wafer, a bar of yield by the split, a line over wafer order with a ±1 SD band, and a probability plot. It adds one of each newer
feature the lot can show: the most telling tests as one set rescaled to z-scores (a box per test, and a heatmap of
tests by wafer), the lead test by split and by wafer nested in split, panels by ring, the lead test by ranges of its
partner and of the distance from the centre, a pareto of the hard bins and each wafer's bin mix, the
lead test by PAT verdict, an individuals control chart (five or more wafers), a capability goal plot and a
pass-rate bar when tests have limits, and a sweep of the first
tests in test order. Edit any of them to see how it is set. Pressing the button again adds only what is missing. Every change you make there is drawn at once; there is no Apply
button, and the plot is kept as you go.

![The My plots tab: example plots, one card each](images/guide-plot-tab.png)

*The My plots tab after **Add examples**: each card is a plot, with Edit, Duplicate and Delete.*

![The plot editor: the chart beside its Setup tab](images/guide-plot-editor.png)

*Edit opens the plot large, beside its settings. Every change is drawn at once.*

In **Setup**, choose the **chart type**, then the field for each role:

| Chart type | What it shows | Fields |
| --- | --- | --- |
| **Scatter** | one point per die (or per wafer) | X and Y, both numbers |
| **Histogram** | how often each value occurs | the values |
| **Box** | quartiles, with whiskers to the minimum and maximum, for each category | categories (wafer by default), values |
| **Bar** | one aggregated value for each category (or a count) | categories, values (optional), how to combine them |
| **Line** | one aggregated value at each X, joined | X, Y, how to combine them |
| **Probability** | the share of values at or below each value, one curve per colour | the values |
| **Control** | one value per wafer in order, against control limits, with the points that break a rule marked | along (X), the values |
| **Heatmap** | one cell per row and column, coloured by the value combined there | columns, rows, values (optional: a count) |
| **Goal** | every test with both limits as a point: how far off centre and how wide | the tests (all by default) |

- **X axis** and **Y axis** (a histogram has one **Values** field; a box or bar has
  **Categories** instead of a numeric X). Any measured test, a die's X or Y position,
  a wafer's yield or die count, or a lot field with numbers in it (slot, temperature).
  The list is grouped Tests · Die · Wafer and filters by name or test number, so with
  a few hundred tests you type `1050` or `vth` rather than scrolling. A field the chart
  type cannot use is not offered; switching type keeps your fields where they still
  apply and brings back the ones that did not when you switch back.
- **Compare by.** Two controls pick what a chart compares: **Colour** and, on a bar or box, **Categories**. Either takes a
  **wafer attribute** (lot, split, temperature: it separates whole wafers) or a **die region or field** (ring, quadrant, reticle
  cell, reticle shot, bin, site: it separates the dies within each wafer). **Group by**, above the charts, is the other way to
  separate wafers: it pools whole wafers by a wafer attribute for every chart on the tab, and a plot's Colour can follow it. A
  die region is never a Group by choice, because a wafer is in one lot but a die is in a ring and a reticle cell at once.
  A **pass/fail test** (a functional test, or a derived one that gives a verdict) is a category too, listed under **Verdicts** as
  `Scan Chain (pass/fail)`: it separates the dies that passed from those that failed, for Colour and Categories and for splitting
  yield. It has no value, so it is never an axis. A die with no recorded outcome is in neither group.
- **Colour**: a category such as wafer, split, hard bin, site, ring or, with a reticle set, reticle cell or reticle shot, or, on a
  scatter, a measured value or wafer figure drawn on a gradient (a colour bar under
  the title states its range). **Follow Group by** (the default) takes the colours from
  the Group by control above, so changing it recolours every plot that follows it;
  **None** draws one colour.
- **Several tests** (box, bar, line and histogram): choose **Several tests…** at the top of the values list, then type
  the tests in the **Tests** box beneath it, as numbers or ranges (`1050, 1060..1080`, a range taking the tests declared
  between its ends). A box or bar puts one box per test along X; with wafer, split or ring as the categories instead,
  the colour tells the tests apart. This is how the Process capability chart's view, every test side by side, is made
  for your own choice of tests, by split or by wafer. Tests in different units cannot share an axis as measured, so the
  plot asks you to rescale them. On a bar or line, **Read as → Pass rates** draws each test's pass rate instead of its
  values: the Overview's pass-rate card is this plot, horizontal and smallest first.
- **Judged by** (a pass rate, one test's or several): *Test limits* judges a parametric test's value against its
  limits, *Tester flag* reads the pass or fail the tester recorded. A functional test is judged by its verdict either
  way.
- **Probability** plots each group's values in order against the share of the group at or below them, at
  (rank − ½) / n, so 50% is the median. On the default **normal-probability** axis a normal distribution is a
  straight line and the tails are spread out: a shifted split is a curve moved sideways, a wider one a flatter curve,
  and outliers or a second population show as a bend or a kink at the ends. Choose **Linear** under Customise ›
  **Share axis** for a plain 0 to 100% axis. Limits are drawn on the values axis. Hover a point for its die, its rank in
  its group and where that rank is plotted; click it to open its wafer; drag a box to take every die inside it to the drilldown menu (a curve of many
  dies draws a sample of its middle, but all of both tails, and a drag still takes every die).
- **Heatmap**: a grid with one row per value of one field and one column per value of another, each cell coloured by
  the value combined over its dies (with no values, a count of them): hard bins by wafer, rings by split, and with
  several tests as the values Test as the rows, so tests by wafer, rescaled to compare. The colour bar above it spans
  the cells; a cell shows its value when it has room, and a click charts or tabulates its dies. It is a bar chart of
  the two fields nested, laid out as a grid, so the same rules apply: pooled yield, pass rates, *Filter*.
- **Control** charts each wafer's value (a test's wafer mean, or as *Combine values by* says; a yield or a pass rate as
  the wafer's own) in wafer order, or along another wafer field with a number per wafer such as slot or date. It is an
  individuals chart: the centre is the mean, the control limits ±3σ with σ taken from the average moving range (÷ 1.128),
  which measures wafer-to-wafer noise so a slow drift does not widen the limits it is judged against. Faint lines mark
  ±1σ and ±2σ. A point that breaks a Western Electric rule is drawn in red with the rule's number: **1** beyond 3σ,
  **2** two of three beyond 2σ on one side, **3** four of five beyond 1σ on one side, **4** eight in a row on one side
  of the centre; the line under the chart names the rules broken. **Limits from the first** sets the centre and σ from
  the first wafers only (a baseline), so later wafers are judged against them; a dotted line marks where it ends. Hover
  a point for its wafer and how many σ it is from the centre; click it to open the wafer.
- **Goal** (capability goal plot) places each test that has both limits by its mean's offset from the centre of its
  limit window (left and right) and its standard deviation (up), both as shares of the window, using spec limits
  where a test has both kinds. Every point on a triangle has the same Ppk: the dashed one is Ppk 1, the solid one
  1.33, so a test outside the solid triangle is short of 1.33, and whether it sits to the side (off centre) or high
  (too wide) says what would fix it. Tests short of 1.33 are named. Colour by a split to see each test move between
  splits; *Tests* narrows it to a set.
- **Fit line** (scatter): one line per colour, *Least squares* (Y on X, the usual regression) or *Orthogonal* (the line
  closest to the points at right angles, for two measurements of the same quantity, such as one test on two testers,
  where least squares would tilt the line towards flat). Each line's equation, R² and number of points are written
  above the chart. **y = x line** draws the line of agreement, when X and Y are in the same unit.
- **Bars as** (histogram): *Counts*, or *Shares*: each colour's bars as a percentage of its own values, so a split of
  three wafers and one of thirty can be compared by shape. **Normal curve** overlays each colour's normal distribution
  at its mean and standard deviation, scaled to its bars (not on a log axis).
- **What-if limits** (histogram or probability plot of one test, not rescaled): a proposed low and high limit in the
  test's own unit, drawn as their own lines (*What-if lo* / *What-if hi*). The line under the plot gives the test's
  pass rate over the dies it judges by its current test limits and with the proposed ones, and how many dies change.
  It is the test's pass rate, not the yield: a die's bin depends on every test.
- **Pass rates**, listed under *Pass rates* in the values list: a test's pass rate, each die 100 when it passes and 0
  when it fails, judged as the Overview's test pass-rate card judges (a parametric test by its test limits, a
  functional one by its recorded outcome). A bar or line of it is the share of judged dies that pass, pooled over the
  dies in each bar; with one mark per wafer it is each wafer's own rate, which a box or scatter can then show. A
  single die's 0 or 100 drawn as a point says nothing, so a box, scatter or histogram of it per die is refused.
- **In ranges**: on the categories of a box or bar, the colour, a heatmap's rows and the panels, a measured test,
  Radial position, Die X or Y and Yield are listed as *"… in ranges"*. The values are cut into 2 to 20 ranges (5 to
  begin with), either holding about the same number of values (*Equal counts*: quartiles, deciles) or spanning the
  same width (*Equal widths*), and each range is a category named by its limits in the field's unit (*7.16 pA to 19.4 pA*), lowest first. Vth by Idsat decile is
  a box with Idsat in ranges on the X axis. The edges are set over every die plotted, so panels and colours share
  them.
- **Filter**: keep only the dies that meet every condition you add. **+ Add a condition** asks for a field; a category
  (bin, ring, site, split, a pass/fail test) then lists its values to tick, and a number (a measured test, Radial
  position, Die X or Y, Yield) a range, either end left open, that starts at the range the data spans. **is not** or
  **outside** keeps everything else instead. A condition on a wafer field (split, lot, yield) keeps whole wafers and
  is judged on the whole wafer, so *Yield at most 70%* means the wafer's own yield; the die conditions then keep dies
  inside those wafers. A die with no value for a condition's field (no bin, no reading) meets no condition. The filter
  applies before everything else, panels included. Its line on the card states each condition, and its switch turns
  the filter off and back on without losing it; the line under the plot says what was kept while it is on. PAT limits
  stay the whole wafer's.
- **Band** (line): round a line of means or medians, *±1 SD* (the standard deviation of the values combined at each
  X), *95% CI* (the mean's confidence interval, with Student's t for the number of dies or wafers there), *Quartiles*
  or *Range*, as a pale band in each line's colour. A pass rate has no spread of values to show, so it takes no band.
- **Radial position**, a die field: a die's distance from the wafer centre as a percentage of the radius, 0 at the
  centre and 100 at the edge. The rings are bands of it (with four rings, ring 4 is 75–100%), so a scatter of a test
  against radial position shows an edge roll-off the ring chart only buckets.
- **Order** and **Show the first** (box and bar, one category field): *Largest first* sorts the categories by value (a
  box by its median), *Smallest first* the other way (the worst pass rate at the top); with colours, a category is
  ordered by all its colours together. *Show the first* keeps that many and counts the rest in a note.
- **Colours** (bar): *Share of colour* keeps the colours side by side, each as its share of its own total, so groups
  of different sizes compare; *Stacked* puts a category's colours one on another, *100%* shows each as its share of
  the category. Shares and stacking add values, so they need a count or a sum; a mean or a yield is refused with the
  reason.
- **Cumulative line** (a bar sorted largest first, of counts or sums): each category's running share of the whole, on
  its own 0–100% axis at the right. A bar of hard bins with it is a bin pareto; with Show the first, the line still
  counts every category.
- **Axis includes limits** and **Clip outliers** (Customise, per value axis): the first widens the axis to every limit
  drawn on it (or, unticked, never), where by default it does so only when the data keeps a third of the axis; the
  second narrows the axis to a robust range (the quartiles ± 1.5 × their spread) so a few extreme values do not flatten
  the rest. Clipping changes only the axis: the footnote counts the values outside, and every statistic still uses them.
- **Orientation** (box, bar): *Horizontal* puts the categories down the left and the values along the bottom, for many
  categories or long names (tests, wafers); the card grows so each category keeps room.
- **Values on the bars** (bar): each bar's value printed at its end. Shown only when every value fits its bar's width,
  so a crowded chart never labels some bars and not others.
- **PAT** (part average testing), a die field: each die's verdict under dynamic PAT, per wafer. For every test with both
  a low and a high limit, the wafer's PAT limits are the median ± 6 robust standard deviations ((Q3 − Q1) / 1.35) of
  its passing dies' values, never wider than the test's own limits (spec limits where it has both). A die is
  **Within PAT limits**, a **PAT outlier** (it passes every limit but is outside PAT limits on at least one test: the
  dies PAT would reject), or **Fails (bin or limits)** (already rejected, so not counted as a PAT outlier). A test with
  fewer than 30 passing values on a wafer, or no spread, does not judge that wafer's dies. Use it as the colour, the
  categories (a bar counts outliers per wafer) or the panels. A plot of one wafer, a panel per wafer included, also
  draws that wafer's PAT limits as dotted lines labelled *PAT lo* / *PAT hi*; a plot of several wafers has several sets
  and draws none. The limits are always the whole wafer's, even in a panel of one ring.
  [Part average testing (PAT)](#1012-part-average-testing-pat) explains how the limits are set and what this does and does not cover.
  The Overview shows the same verdicts as a **Part average testing (PAT)** card: for each wafer, the dies within the PAT
  limits, the outliers and the rate, the dies that fail anyway, and which tests the outliers are outside on. The Dies
  table (Data tab) has a **PAT** column, and **PAT tests** where there are outliers, in the CSV too; a selection that
  is only part of a wafer has neither, since the limits belong to the whole wafer. **Map the verdicts** on the card opens a
  gallery with a map of each wafer, its dies coloured by their PAT verdict (within the limits, outlier, fails anyway), so
  the gallery's legend and value toggles show where the outliers are on each wafer. The maps state no yield: a verdict is
  not a bin.
- **Panels**: one small plot per value of a category field, laid out like the gallery's cards, on shared axes and
  colours with one legend and one statement above them. A wafer field (split, lot) gives each panel its whole wafers; a
  die field (ring, site, bin) the dies with that value from every wafer; **Test**, with several tests as the values,
  one test a panel. So "one scatter per split" or "a histogram per ring" is one plot. Rescaled values are measured over
  the whole population, so a panel is not re-centred on itself and panels compare. Each panel has its own expand button, and
  the plot's Save as PNG saves the whole grid. At most 24 panels; a field on the X axis or the colour cannot also make
  the panels.
- **Wafer-level comparison** (box and bar of one measured test): when the categories or the colour are a wafer field
  such as split or lot, the line under the plot adds the comparison of those groups with each wafer as one value, as
  the Distributions table does: the wafers in each group, Welch p and rank p.
- **Nested categories** (box and bar): **+ Add a level** under Categories divides each category by another field, so
  Test then Ring gives one box per ring within each test, and the colour is still free for split. The first level is
  the outer groups, labelled in a row beneath the axis with a line between groups; the last level's values are at the
  ticks. Move a level out or in with its **↑** and **↓** buttons, or remove it with **×**. Up to three levels.
- **Rescale values** (box, bar, line and histogram of measured tests), each test on its own: **To limits** puts the low
  limit at 0 and the high one at 1 (spec limits where a test has both, its test limits otherwise, as in Process
  capability), so a value near 0 or 1 is near a limit whatever the test measures; **z-score** counts standard deviations
  from the mean of the values in view; **Robust z** does the same from the median, with the spread taken from the median
  absolute deviation, so a few outliers do not set the scale. A test that cannot be rescaled (no limits, or every value
  the same) is left out and named under the plot. The footnote says how the values were rescaled.
- **Combine values by** (bar and line, and any plot with one mark per wafer): mean,
  median, minimum, maximum, sum or count. **Pooled yield** is offered for Yield: it is
  the passing dies over the judged dies of all the wafers in a bar, not an average of
  their percentages (the plain mean of Yield is the mean of per-wafer yields, and is
  labelled so).
- **One mark per**: Automatic uses the finest level the fields allow. **Wafer** makes
  every mark a wafer, combining its dies' values as chosen above, which is how "mean
  Idsat per wafer against slot" is drawn. Yield can be split by a per-die field
  (ring, quadrant, bin, die position) in a **bar** (pooled yield per ring) or a **line**, which take the pass verdict of each die; a box,
  scatter or histogram of yield cannot, and says why.

When fields do not go together, the list says so before you choose: a field that would leave a plot that cannot be
drawn is dimmed in the **X**, **Y** and **Colour** lists with the reason after it, and does nothing when picked. A plot
that cannot be drawn says in words what is wrong and what to use instead.

In **Customise**, the **title** and each **axis title** are written for you until
you type your own (the box shows what it would say, and clearing it brings that
back). If you type a title and later change the fields, the plot says when the title
still names a test it no longer shows, or names only one of the two it does, with a
button to go back to the automatic title; a title that names none of the fields ("Process
check") is yours and is left alone. Each axis can have a **minimum**, a **maximum**, a **log scale** (offered
whatever the values, but it stays linear, and says so, if any value is zero or
negative) and **reverse direction**. A histogram also has a number of **bins**. A category axis has a title only.

A value axis can also carry **reference lines and bands** of your own: a target, a guard band, a customer's limit. Write
them in *Reference lines* in Customise as a value for a line or `lo..hi` for a shaded band, each with an optional name,
separated by commas (`0.45 Target, 0.3..0.5 Window`), in the axis's own unit (rescaled values for a rescaled plot).
`median` or `mean` draws a line at that statistic of what the plot shows along the axis (the bars' heights, the points,
the values in the boxes), worked out over the whole plot so every panel shares it: `median, 0.45 Target`. They are
drawn dash-dot, labelled with their name and value, and widen the axis in the way test limits do.

When a plotted test has limits they are drawn as dashed lines on the axis that measures it (a histogram's values, a scatter's X or
Y, a box, bar or line's values when they are measured values or their mean, median, minimum or maximum): short dashes for the
test's own limits, long for its specification limits, dots for a single wafer's PAT limits, each labelled with its value. The axis widens to include them when that
leaves the data at least a third of it, as in Insights, and a limit off the edge is marked there instead of vanishing. Choose
which are drawn under **Limits** in Customise. Where the wafers in view disagree about a test's limits none are drawn, as in
Insights: the reconciled test list drops conflicting limits.

Under every plot is a line stating what it shows: the wafers and dies, how values
were combined ("median of Vth per wafer"), and how many dies were left out for
having no value ("12 dies without Idsat not plotted"). Like every Insights chart, a plot
reads only the dies a yield judges: partial dies and dies inside the edge exclusion are
left out, and the line counts them ("12 edge-excluded dies left out"). A plot never drops
a die without saying so. A plot coloured by hard or soft bin uses the map's bin colours.

**Hover** a point, bar, box or line to see its values and how many dies or wafers it
stands for. **Click** a point (or a wafer's bar or box) to open that wafer, on the plot's own
test, so its map shows the values the plot is about and not the bins (a plot with no test in it,
like yield against wafer order, opens the default map). Click any other bar, box, histogram bar or
line point to open the right-click menu on the dies it counts, and **drag** a rectangle over a
scatter to select the dies (or wafers) inside it. The selection opens the same
right-click menu as on a map, so a few dies from a plot can be charted and tabulated
in turn.

**Keeping your plots.** A plot is a recipe, not a picture: it says which fields go
where, and nothing about which wafers. It is therefore kept by your application
between sessions and drawn again on the next lot. If you open a lot that lacks a
test a plot needs, the plot stays in the list, dimmed, with the reason ("Needs test
3001 (Leak), which is not in these dies"); it is not removed. **Export plots…**
writes them all to a file, and **Import plots…** adds the plots of such a file to
yours, as copies where a plot with the same identity already exists, never
replacing one. Each card has **Edit**, **Duplicate** and **Delete**; a deleted plot
can be restored with **Undo** for ten seconds. **Delete all plots…** removes every
plot, sweeps included, after asking you to confirm (the question says how many, and
that **Export plots…** first keeps a copy); **Undo** restores the whole list for ten
seconds. It is dimmed while there are no plots.

**Three different ways to divide the data, kept apart.** A plot divides data in
three places, and they do different jobs, so neighbouring plots can ask different
questions:

| What it decides | Where | Kept with the plot? |
| --- | --- | --- |
| The categories on an axis | the plot's own **X** field | yes |
| The colour series within it | the plot's own **Colour** field | yes |
| Which wafers are in view | the **Show** control above | no, it is the scope |

**Plots in the right-click menu.** Every saved plot is also a row in the menu that
opens on a selection or a wafer (**Plots** section), drawn over just those dies and
captioned with them.

![The right-click menu on a selection, with the Plots section](images/guide-plot-drilldown.png) **New plot…** and **New sweep…** in the same menu start a draft on the selection;
a draft is kept only if you press **Add to my plots**.

Every change is kept as you make it. If you make a mistake, **Reset** (under the settings) puts the plot back as it was
when you opened the editor, and **Cancel** does the same and closes it. Closing the window with its own button keeps what
you changed.

### Sweep cards

A **sweep** is a card on the **My plots** sub-tab, beside your other plots. **+ New
sweep** starts one on the first tests of the lot, and **Edit** opens it beside a
live copy of the curve. A sweep is kept, duplicated, deleted, exported and
imported like any plot, and is offered in the right-click menu's **Plots**
section. It exists for a test program that measures the same quantity at a
series of drive levels and records each level as its own test number — often one
block sweeping up and another sweeping down. Read one test at a time that is a
row of unrelated distributions; read as a sweep it is a pair of response curves,
and the card measures the pair.

**Each line is the population median, with a shaded p10–p90 band** — not one
trace per die. A lot is thousands of dies, so per-die traces would be a solid
block of ink. The band is the spread across the dies currently in scope, so a
band that widens at one end of the sweep is telling you the population disagrees
most at that level.

**The dies behind it are whatever Insights is scoped to.** A sweep names tests,
not dies — so the group or wafer selected in the panels above it decides the
population, and the card's die count states what that came to. To sweep a
hand-picked set of dies instead, select them on a map and right-click (see
[Charting dies and wafers](#44-charting-dies-and-wafers)).

Two measurements are drawn on the plot and restated underneath:

- **Crossing** — where the first two curves meet. If they cross more than once
  the card says so rather than reporting the first as though it were the only
  one.
- **Separation** — the horizontal distance between the two curves at the levels
  the application asked about. With one curve rising and one falling the pair
  traces a V, and this is the width of that V. A level that one of the curves
  never reaches reads **not measurable**, naming the curve — never `0`, which
  would read as "they meet here".

Only the **first two** curves are measured. Any further ones are drawn for
context.

![The sweep editor: the curve beside the series, test list and axis settings](images/guide-sweep-editor.png)

**Editing a sweep.** The editor has a title, one block per series, and the axis
and measurement settings. For each series, type its **tests in sweep order**:
test numbers and ranges, such as `1010, 1011, 1020..1030` (a range means the
tests declared between its ends). Then choose where each test's X comes from:
**Test order** (the position in the run, labelled by test), **Values** (one
number per test, in the same order) or **From test name** (a pattern such as
`LRS_STATS_{x}`, for programs that record the swept value only in the test
text). The editor lists the first few test names with what your pattern reads
from each as you type, and **Pattern examples** shows worked ones: `@ {x}`
reads 0.55 from `Fmax @ 0.55 V`, and `-{x}` reads 5 from `1234-5`). Text that is not a test number or a range is flagged under the box,
naming the word, and is not applied, so the curve beside it never shows
something you did not mean. **+ Add series** adds a curve and **Remove** drops
one; the crossing and widths appear once there are two.

**A sweep remembers what its tests were called.** The editor and **+ New sweep** record each test's name
alongside its number. Open the sweep on a lot where a number now carries a different name (a test program that
reuses numbers for other measurements) and that test is not drawn: the card names it, and the crossing and widths
are not measured, rather than presenting another quantity as the original curve. Renaming a test in the selector
has the same effect. A sweep written by hand, or imported from a file without names, is not checked.

**The x axis is the sweep, not the lot** — that is what distinguishes this card
from the wafer-to-wafer trend, which walks one test across wafers. If the
application supplied the real swept quantity, the axis is in those units (dBm,
volts, °C) and the crossing is reported in them. If it did not, the axis is the
position in the sequence, labelled by test, because test numbers are identifiers
— treating them as a scale would invent spacing the data never claimed.

Some sweeps step by multiples — thresholds of 1k, 2k, 5k … 1M — and are drawn
on a **logarithmic** x axis, so each step gets the same room. There the crossing
is found along the log axis, and a width is given as a **ratio** between the two
curves, with the level each reaches: *×2.49 (15.9 kΩ → 39.7 kΩ)*. On a log axis
the same shift is the same multiple anywhere along it, which a difference in Ω
would hide.

The card footer reports anything that limits what you are seeing: tests in the
sweep that have no definition, functional (pass/fail) tests inside a sweep,
which have no value to plot, and series whose tests carry different units.

If the swept values no longer line up with the tests — usually because a test in
the sweep is missing from this data — the footer lists the tests it did find, and
the card is drawn in test order with **the crossing and widths not measured**.
Pairing the remaining values with the remaining tests would put every later point
at the wrong level, which gives a plausible curve and a wrong crossing.

### A chart's buttons

Every chart card has two buttons at the right of its title. **Expand** (the toolbar's expand icon) opens the chart on its own in a large window; a chart already in its window does not show it. The **⋯**
button opens a menu of what else the card offers about itself:

- **Save as PNG** saves the chart (see *Exporting a chart* below). A table has no image to save and offers its CSV
  instead.
- **Edit as plot**, on the Insights charts drawn as plots (yield, bin pareto, pass rate, box plot, histogram, trend,
  scatter, and the value histogram of a selection), opens the chart as a draft plot of your own, drawn over the same
  wafers: the test and Group by it shows now are filled in as its own fields, so it draws the same thing on the next lot
  and follows nothing. It is kept only when you press **Add to my plots**. Greyed, with the reason, when the chart has
  nothing to draw yet (no test chosen).
- **About this chart** (**About this table** on a table) shows one line under the title saying what it shows and how
  to read it; choose it again to hide the line.

Use the arrow keys to move through the menu, **Enter** to choose, **Esc** to close it.

**How to read this.** A chart whose statistics this guide explains ends its note with **How to read this** and the
section's title: PAT, What divides yield, the Comparison by table, process capability, the difference map, and the
probability, control, goal and heatmap plots. A plot also names a section while it uses what that section explains: a fit
line or the y = x line, a band, rescaled values, ranges of a number, panels, what-if limits, or groups compared wafer by
wafer. A plain chart names none, as its **About this chart** says all there is. Each title is a link: it opens this guide at that section, beside the app, so you can read it with the chart in view. If the
guide is already open, it moves to the section and comes to the front rather than opening again. A saved image or a
printed page names the section instead.

### Exporting a chart

**Save as PNG** in a chart's ⋯ menu saves the current view as a PNG at the displayed resolution. To get a clean
full-resolution render, press **Expand** first to open it in the large window, then choose **Save as PNG**.

The saved image is the chart as shown, under a header that says what it is: its **title**,
what its controls are set to (**Test: vth_n_mV · 1001**, **Wafer: W03**, **Sort: yield**), the
lines the chart states about itself (the population and N, how values were combined, what
the box and whiskers mean, how the bars are normalised), and its colour key (the legend, or
the colour bar's name and range). The instructions that only make sense on screen ("click a
point to open this wafer") are left out. A chart on the **My plots** tab carries the line stating
its wafers and dies in the same place. The image takes the card's own background, so a dark
theme saves a dark chart. The file name identifies the lot, wafers and chart (see below).

**Printing.** The dropdowns, toggles and buttons (Expand, the ⋯ menu button and, on the My plots tab, New
plot, Add examples, Import, Export, Delete all, Edit, Duplicate and Delete) are left off the printed page.
In their place each chart prints a small block under its title giving the same settings and
lines as the saved image, so a printed histogram says which test it is of.

### Names of saved files

Every image and CSV you save is named for what it shows: the lot, then the wafer (or how many
wafers), then the content. For example, `LOT123_W05_hard-bin.png`, `LOT123_W05_die-list.csv` or
`LOT123_25-wafers_yield-by-wafer.png`. Saving the same export from different wafers gives
different names, so files don't overwrite each other or need renaming. A part is left out when
the data doesn't have it, for example a wafer with no ID. Your application may choose its own
name for map images instead.

---

## 9. Reticle overlay

When reticle (stepper field) geometry is configured, the **Reticle grid** overlay
draws the stepper field boundaries on the wafer. Each rectangle represents one
exposure field from the lithography stepper — the group of dies exposed in a
single step. This lets you correlate failure patterns with specific reticle
positions — useful for identifying stepper field signatures, alignment drift, or
mask defects.

<div data-wmap-demo="reticle" class="wmap-demo"></div>

Reticle-position findings in the Findings panel highlight the specific field
positions that show elevated failure rates. Hovering any die also shows its
**Reticle (column, row)** position — its location within its own stepper
field — just below the die's coordinate in the tooltip.

## 10. The statistics, explained

This section is for reading the statistics in Insights and the My plots tab for the first time. Each entry says what
question the figure answers, how it is worked out in plain terms, how to read it, and what it cannot tell you. None
of these figures is a verdict: they say how surprising a difference is, and the decision stays with you.

### 10.1 Why wafers are counted, not dies

Dies on one wafer went through the same processing, so they are not independent samples of anything. If a split of
three wafers is compared die by die, thousands of dies make a tiny offset between two wafers look certain. Wherever
the question is "do these groups differ?" (the **Comparison by** table, **What divides yield**, the note under a box
or bar divided by a wafer field), **each wafer is one value**, the mean of its dies, and **n is the number of
wafers**. With two or three wafers in a group many real differences come out inconclusive. That is the true state of
the evidence, not a fault; more wafers are what settle it.

### 10.2 Comparing groups of wafers

- **Welch p** answers: *if the groups had the same true mean, how often would wafer means differ at least this much by
  chance?* It is Welch's t-test for two groups and Welch's ANOVA for more. It does not assume the groups have equal
  spreads, which is safer for splits. A small p (conventionally below 0.05) says the difference is unlikely to be
  chance; it does not say the difference matters.
- **Rank p** asks the same on the ranks of the wafer values (Kruskal–Wallis, with a correction for tied values), so one
  odd wafer cannot drive it. With fewer than five wafers in a group it is approximate, and is marked so.
- **q** corrects p for looking at many tests at once. Check 100 tests at 5% and about five will "differ" by chance
  alone. q is Welch p adjusted by the Benjamini–Hochberg method so that, among the rows with q under 0.05, about 5% are
  expected to be false alarms. The table is sorted by q. Read q, not p, when scanning many tests.
- **Against a control**: choose the process of record and each other group's cell adds its difference from it, with a
  p adjusted by Holm's method for the number of groups compared, so that comparing several groups with one control
  does not multiply the chance of a false alarm.
- **Largest shift** is how far apart the group means are, in wafer-to-wafer standard deviations of the test and, where
  it has both limits, as a share of the limit window. This is the size of the effect. A tiny p with a tiny shift is a
  real but unimportant difference; a large shift with a poor p needs more wafers.
- **Cautions.** A group with fewer than two wafers is left out and named. The tests assume the wafer means are roughly
  symmetric; the rank p is the check. Nothing here says *why* groups differ.

### 10.3 What divides yield

The **What divides yield** card makes the comparison [Comparing groups of wafers](#102-comparing-groups-of-wafers) describes for every wafer field at once, for yield and for each of the five most
common fail bins (a bin's value is its share of a wafer's judged dies). Rows are ranked by q, so the fields at the top
separate the wafers more clearly than wafer-to-wafer noise would. The **Group by** button regroups every chart by that
field. Two limits are stated on the card itself: a field that gives every wafer its own value cannot be tested, and
two fields that change together (a lot and its start date) cannot be told apart by the wafers. A low q points to where
to look; it is not a cause. Tool, chamber and probe-card fields appear only when the host supplies them as wafer
attributes.

### 10.4 The cumulative probability plot

Each group's values are sorted, and the k-th smallest of n is drawn at height (k + ½) / n (Hazen's plotting position),
so the curve is the cumulative share of dies at or below each value. On the default **normal** axis the vertical scale
is stretched by the normal distribution, so values that follow a bell curve fall on a straight line: the middle of the
line is the median, its steepness the spread. Read it by comparison: a curve shifted sideways is a shift in the mean, a
flatter one a wider spread, a bend or a step a second population, and points off the ends of the line outliers or heavy
tails. It needs no choice of bin width, and many groups overlay legibly. Choose **linear** for the plain 0–100% cumulative
share. Large groups are drawn from a sample of 1,500 points with both tails kept in full.

### 10.5 Fit lines, R² and y = x

- **Least squares** is the usual regression of Y on X: the line that minimises the vertical distance to the points.
  Use it when X is the cause or the controlled quantity.
- **Orthogonal** (Deming regression with equal errors) minimises the distance at right angles to the line. Use it when X and Y
  are two measurements of the same quantity (one test on two testers, two insertions), where least squares tilts the
  line towards flat.
- **R²** is the square of the correlation of the points: the share of Y's variation a straight line in X accounts for. It
  says nothing about whether a line is the right shape; look at the points. **y = x** draws the line of perfect
  agreement, offered only when X and Y share a unit.

### 10.6 Bands on a line

A band round a line of means shows the spread of the values combined at each X: **±1 SD** (mean plus and minus one
standard deviation: about two thirds of normally distributed values), **95% CI** (the range that would contain the true
mean 95% of the time, from Student's t, so it narrows with more dies and says nothing about how spread out the dies
are), **Quartiles** (the middle half of the values, Q1 to Q3) or **Range** (smallest to largest). Use SD or quartiles to
see how much the values vary, CI to see how well the mean is pinned down.

### 10.7 Control charts

The **Control** chart is an individuals (I) chart: one value per wafer in order, with the centre at the mean and
control limits at ±3σ. σ is estimated from the average **moving range** (the difference between each value and the one
before) divided by 1.128, so it measures wafer-to-wafer noise and a slow drift does not widen the limits it is
judged against. Control limits describe what the process does, not what the customer wants: they are not specification
limits. Points are flagged by four Western Electric rules, each at the point that completes it: **1** one point beyond 3σ,
**2** two of three beyond 2σ on the same side, **3** four of five beyond 1σ on the same side, **4** eight in a row on one
side of the centre. A flag means the point is unlikely to be chance if the process were stable; with many points a
few false flags are expected. **Limits from the first** sets the centre and σ from a baseline of earlier wafers and
judges the later ones against it. It needs at least three points.

### 10.8 Capability, Ppk and the goal plot

**Ppk** compares a test's spread with its limit window, penalising an off-centre mean: with mean μ, standard deviation
σ and limits LSL and USL, Ppk = min(USL − μ, μ − LSL) / 3σ. A Ppk of 1 means the nearest limit is three σ from the
mean; 1.33 is a common target, though yours may differ. The σ here is the plain standard deviation over every die
(Cp and Cpk, in the tables, use the pooled within-wafer σ). The **goal plot** puts each test at (offset of its mean from
the centre of the window, σ), both as shares of the window, so points on one triangle share one Ppk. A test short of
the target is either to one side (off centre: shift the process) or high (too wide: reduce the variation). Spec limits are
used where a test has both kinds, otherwise the test limits, and the chart says which. Below 30 dies a Ppk is a rough
estimate. Capability indices assume roughly normal values; check the distribution before quoting them.

### 10.9 Rescaling values

Tests in different units can share one axis once rescaled, each on its own: **To limits** (0 at the low limit, 1 at the
high one), **z-score** (standard deviations from the mean of the values in view), or **Robust z** (the same from the
median, with spread taken from the median absolute deviation × 1.4826, so outliers do not set the scale). A z-score is
relative to the population in view, so it changes when you narrow the wafers; rescaling to limits does not.

### 10.10 Ranges, panels and what-if limits

- **In ranges** cuts a measured value into 2–20 ranges. **Equal counts** gives each range about the same number of
  values (quartiles, deciles), so every box has a similar n; **Equal widths** gives each the same span of values. The edges
  are set over every die plotted, so panels and colours share them.
- **Panels** repeat the plot per value of a field on shared axes and colours, so panels can be compared by eye.
- **What-if limits** (histogram and probability plot of one test) draw proposed limits and state the test's pass rate
  now and under them, and how many dies change. It is the pass rate of that test over the dies it judges, not the
  yield, which depends on every test and bin. Treat it as a screening aid for a limit discussion.

### 10.11 Heatmaps and the difference map

A **heatmap** colours each row-and-column cell by the value combined over its dies (a count when there is no value),
on a colour scale that spans the cells. Its colour is the same combination a bar would show, so the same rules apply.
The **difference map** (Distributions, with Group by on) shows, at each die position, one group's mean minus another's:
coloured on the value gradient, symmetric about zero so that the middle is no difference, drawn on the first wafer's geometry. A position is shown only where both groups have a
value. A pattern on it (an edge ring, a centre spot) says where on the wafer the two processes differ, not whether the
difference is significant.

### 10.12 Part average testing (PAT)

**What it is for.** A die can pass every test limit and still sit far from its neighbours' distribution on a test. Such a
die is statistically unusual and, in automotive and other high-reliability work, is the kind of part PAT screens out.

**How the limits are set here.** Per wafer, and for every parametric test with both a low and a high limit:

1. Take the values of the dies that pass their bin and lie inside the test's limits (spec limits where the test has both
   kinds).
2. The **robust mean** is their median; the **robust σ** is (Q3 − Q1) ÷ 1.35, the interquartile range scaled to a
   standard deviation. Both resist outliers, so an outlier cannot widen the limits that are meant to catch it.
3. The **PAT limits** are the median ± 6 robust σ, never wider than the specification limits (the test's limits where it has
   no specification limits): AEC-Q001 requires that PAT limits do not exceed the device specification limits.
4. A wafer needs 30 or more such values on a test, and some spread, before it has PAT limits for it.

**Verdicts.** Each die is **Within PAT limits**, a **PAT outlier** (it passes its bin and every test limit but is outside
the PAT limits of at least one test), or **Fails (bin or limits)** (already rejected, so not an outlier). The Overview
card counts them per wafer and names the tests the outliers are outside on; the Dies table (and its CSV) has a **PAT**
column and, where there are outliers, **PAT tests**; the plot builder takes **PAT** as a colour, category or panel
field and draws a wafer's PAT limits as dotted lines.

**What this is and is not.** The limits follow the robust-statistics method of AEC-Q001 Rev D (section 2.4: the median as
the robust mean, (Q3 − Q1) ÷ 1.35 as the robust sigma; section 3.1.2: dynamic limits of ± 6 robust sigma from the lot's or
wafer's own passing parts), here per wafer. That guideline applies PAT while parts are tested: parts that pass the
static limits are held until the dynamic limits are known, and those outside them are rejected. Here the data is already
collected, so this shows which dies PAT would have flagged; it is not the screening itself, which belongs in the test
programme under a documented procedure. The guideline says no claim of conformance may be made unless all its
requirements are met, so nothing here claims it. The differences:

- **No static limits.** The guideline bases dynamic limits on static ones, set from at least six lots with at least 30
  parts each (at least 5 die in different areas of each wafer, 30 per lot) and reviewed during the first six months
  of production and twice a year after. Here the dies that pass their bin and the test limits stand in for the parts that
  passed the static limits.
- **Only a warning for values that are not roughly normal.** The guideline accepts other methods for data that clearly
  deviates from normal, with statistical justification. Here every test gets the same symmetric limits, so a lopsided test
  has limits that are too tight on one side and too loose on the other. The Overview card lists the tests whose middle
  half of values is lopsided (a quartile skewness of 0.2 or more either way, (Q3 + Q1 − 2 × median) ÷ (Q3 − Q1)) and on how many
  wafers; it does not change their limits, and it sees the body of the distribution, not a few heavy tails or two humps.
- **Every test with both limits is judged.** The guideline considers PAT for tests whose distribution is suitable for
  outlier analysis, and lists tests that shall use PAT limits at test (pin leakage, standby supply current, IDDQ, output
  levels, propagation delays and others, in its Appendix 2). Nothing here checks a test's distribution or matches tests
  to that list.
- **A floor of 30 passing values per wafer.** That floor is ours. The guideline's 1.35 is inexact for under 20 values,
  and sets sample sizes only for static limits.
- **Quartiles** are found by interpolation between the ranked values, which the guideline does not specify.

Neighbourhood screens (good die in a bad neighbourhood) are not part of AEC-Q001 and are not in this card.
Treat the counts as a way to find out where PAT would matter and which tests drive it.

### 10.13 Example plots

**Add examples** chooses its tests from the data in view rather than the order they are listed in. The **lead test**
is the one with the largest share of its variation lying between wafers (for a single wafer, the one most tied to
distance from the centre); its **partner** is the test that follows it most closely over a sample of dies (correlation
above 0.3); the **split** is the lot field whose groups explain most of the lead test's variation between wafers,
when they explain more than 5% of it. It reads at most 4,000 dies and 60 tests, so it is quick on a large lot. These are
starting points for exploration, chosen by simple rules, and are not findings.
