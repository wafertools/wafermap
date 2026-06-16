# Wafer Map — User Guide

This guide describes the display and analysis features of the wafer map viewer.
It is written for semiconductor test engineers, device engineers, and yield engineers
who use a wafer map application — not for developers integrating the library.

Some features depend on what data the application has loaded (bin names, test
definitions, spec limits, reticle geometry). Where this applies it is noted.

---

## 1. Reading the map

### 1.1 Die grid and coordinates

Each square on the wafer represents one die. The position labels you see — in
tooltips, axis ticks, and selection readouts — are **die grid coordinates**: the
X and Y step indices from the prober (integers such as −7, 0, 5). They are not
millimetre values.

These coordinates are always the original prober values. Rotating or flipping the
display does not change the coordinate labels — a die at (3, −2) always reads
(3, −2) regardless of how the wafer is oriented on screen.

### 1.2 Wafer orientation

The notch (shown as a V-notch or flat edge) marks the physical reference edge of
the wafer as configured. Use the **Orientation** toolbar controls to rotate or flip
the display to match your convention; die coordinates are unaffected.

### 1.3 Die appearance

| Appearance | Meaning |
|---|---|
| Solid colour | Active plot value — bin category or test measurement |
| Muted grey at perimeter | Partial die — falls outside the wafer circle boundary |
| Neutral grey (interior) | No data — die has no bin or test result in the loaded dataset |

No-data grey and partial-die grey are visually distinct. A no-data die is not a
fail; it simply has no result recorded.

### 1.4 Legend and colorbar

**Bin modes** show a discrete colour legend: one swatch per bin, with bin number
and name if the application has supplied bin names.

**Value mode** shows a continuous colorbar: the colour scale runs from the minimum
to maximum value, with units when available. Clicking a bin swatch in the legend
filters the display to that bin (see [Highlight bin](#3-toolbar-controls)).

---

## 2. Plot modes

The active plot mode determines what the colour of each die represents. Use the
**Plot mode** toolbar dropdown to switch. Available modes depend on what data the
application has loaded.

| Mode | Colour represents | Typical use |
|---|---|---|
| **Hard Bin** | Physical sort result (hard bin number) | Yield categorisation, pass/fail map |
| **Soft Bin** | Test-program failure category (soft bin number) | Failure mode breakdown |
| **Test Value** | A single numeric measurement | Parametric heatmap — leakage, Idsat, Vth, etc. |
| **Stacked Hard Bins** | Hard bin occurrence counts aggregated across multiple wafers | Lot-level yield patterns |
| **Stacked Soft Bins** | Soft bin occurrence counts aggregated across multiple wafers | Lot-level failure mode patterns |
| **Stacked Test Values** | Aggregated test values across multiple wafers | Lot-level parametric trends |

Stacked modes are only available on lot-stack maps (multiple wafers combined into
one display). The panel identifies how many wafers were stacked and which
aggregation method is active.

### Test Value mode — colorbar range and spec limits

When spec limits are defined for the active test, two additional display options
become available:

- **Colorbar range — Data / Spec**: switches the colorbar scale between the
  actual data extent and the spec limit bounds. Changing this affects only the
  colour scale; it does not change which dies are flagged as out of spec.
- **Colour by spec**: when active, dies within spec are shown in a pass colour
  and dies outside spec are highlighted — blue for below the lower limit, red for
  above the upper limit. Both flags apply independently; a die can be flagged on
  either or both limits.

![Test value heatmap with colorbar and spec range](images/guide-test-values-colorbar.png)

*Test value mode: continuous colorbar. The colorbar range button toggles between
data extent and spec limits.*

![Spec pass/fail overlay active](images/guide-test-values-spec-passfail.png)

*Colour-by-spec active: out-of-spec dies highlighted in the overlay colour.*

---

## 3. Toolbar controls

The toolbar appears when you hover over the map (or may be always visible,
depending on the application). Controls that are not applicable to the current
mode are hidden automatically.

![Single-map toolbar](images/toolbar-single.png)

### Single map

| | Control | Description |
| --- | --- | --- |
| <img src="images/icons/mode.svg" width="20" height="20"> | Plot mode | Switches the active plot mode (see [Section 2](#2-plot-modes)). When multiple tests are available, a test selector appears alongside it. |
| <img src="images/icons/aggr.svg" width="20" height="20"> | Aggregation method | Stacked modes only. Selects how values from multiple wafers are combined per die position: Mean, Median, Std Dev, Min, Max, or Count. |
| <img src="images/icons/overlays.svg" width="20" height="20"> | Overlays | Check-menu of optional display layers: XY axis indicator, ring boundaries, quadrant lines, die coordinate labels, reticle grid (when geometry is configured), and spec pass/fail highlighting (Test Value mode with limits). |
| <img src="images/icons/palette.svg" width="20" height="20"> | Colour scheme | Switches the colour palette used for value and stacked modes. Available schemes depend on what the application has registered. |
| <img src="images/icons/logScale.svg" width="20" height="20"> | Log scale | Test Value and Stacked Test Values modes only. Applies a log₁₀ scale to the colour mapping. Only active when all displayed values are positive. |
| <img src="images/icons/legend.svg" width="20" height="20"> | Legend style | Bin modes only. Controls where the bin legend is positioned relative to the map: Default (right), Compact, Left, Top, Bottom, or Floating. |
| <img src="images/icons/rotateCW.svg" width="20" height="20"> | Rotate 90° | Rotates the display 90° clockwise. Applies cumulatively. Die coordinates are unaffected. |
| <img src="images/icons/flipH.svg" width="20" height="20"> | Flip horizontal | Mirrors the display left/right. Die coordinates are unaffected. |
| <img src="images/icons/flipV.svg" width="20" height="20"> | Flip vertical | Mirrors the display top/bottom. Die coordinates are unaffected. |
| <img src="images/icons/expand.svg" width="20" height="20"> | Expand | Opens the map full-screen in a modal overlay. Press **Esc** or click outside to close. Useful for detailed inspection without changing the main view. |
| <img src="images/icons/download.svg" width="20" height="20"> | Save image | Downloads the current map view as a PNG. Captures the canvas as displayed, including all active overlays and the legend. |
| <img src="images/icons/findings.svg" width="20" height="20"> | Summary panel | Opens or closes the summary panel (see [Section 6](#6-summary-panel)). |
| <img src="images/icons/help.svg" width="20" height="20"> | User guide | Opens this guide. |

**Highlight bin** — in bin modes, click any bin swatch in the legend to highlight
that bin and dim all others. Click again to clear. Useful for isolating a specific
failure category across the wafer.

![Bin highlight — bin 2 selected, others dimmed](images/guide-bins-legend-filter.png)

*Highlight bin active: one failure category isolated, others dimmed.*

![Legend style dropdown open](images/guide-display-legend-style-menu.png)

### Gallery

The gallery control bar applies to all cards simultaneously.

| | Control | Description |
| --- | --- | --- |
| <img src="images/icons/mode.svg" width="20" height="20"> | Plot mode | Switches the plot mode for all cards. |
| <img src="images/icons/overlays.svg" width="20" height="20"> | Overlays | Toggles display layers for all cards simultaneously. |
| <img src="images/icons/palette.svg" width="20" height="20"> | Colour scheme | Switches the colour palette for all cards. |
| <img src="images/icons/orient.svg" width="20" height="20"> | Orientation | Opens the rotate/flip controls, applied to all cards. |
| <img src="images/icons/columns.svg" width="20" height="20"> | Columns | Sets the number of columns in the card grid. |
| <img src="images/icons/download.svg" width="20" height="20"> | Save image | Downloads the full gallery grid as a single PNG. |
| <img src="images/icons/findings.svg" width="20" height="20"> | Summary panel | Opens or closes the lot-level summary panel. |

Click any gallery card to expand it to a full single-wafer view with the complete
single-map toolbar.

![Multi-wafer gallery](images/guide-gallery-per-wafer.png)

![Gallery with Stacked Hard Bins mode and plot mode dropdown open](images/guide-gallery-stacked-bins.png)

*Gallery in Stacked Hard Bins mode. The Plot mode dropdown shows all available modes.*

---

## 4. Interacting with dies

### 4.1 Hover

Hovering over a die shows a tooltip with:

- Die grid coordinates (x, y)
- Hard bin and/or soft bin (with name, if named)
- Test values for all loaded tests
- Retest count if the die was probed more than once

### 4.2 Zoom and pan

Scroll to zoom in and out. Click and drag on empty space to pan. Tooltips and
die selection remain accurate at all zoom levels.

### 4.3 Box select

Switch to select mode in the toolbar, then click and drag to draw a selection
rectangle. The application may display statistics or details for the selected
dies. This is useful for comparing a sub-region against the full wafer.

![Box select drag in progress](images/guide-interaction-box-select.png)

*Box selection: drag to select a rectangular region of dies.*

---

## 5. Findings panel

When spatial analysis has been run, the **Findings** panel lists statistically
detected patterns on the wafer. Open it from the toolbar.

Each finding shows:

- **Severity** — Unusual, Notable, or Info (ordered most to least significant)
- **Description** — plain-language summary of what was detected and where
- **Click to highlight** — clicking a finding highlights the affected dies on
  the map in amber

![Findings panel open, first finding selected](images/guide-findings-panel.png)

*Findings panel: click any finding to highlight the affected region on the map.*

![Cluster finding highlighted on map](images/guide-findings-cluster-highlight.png)

*A failure cluster finding: affected dies highlighted in amber.*

### Finding types

| Type | What it indicates |
|---|---|
| **Ring** | Yield or value difference between radial bands — e.g. centre vs edge gradient |
| **Quadrant** | Yield or value difference between N, S, E, or W quadrants |
| **Sector** | Asymmetry across finer angular slices — rotational bias or directional process variation |
| **Test-site** | Yield or value difference between parallel probe sites on the same wafer |
| **Reticle position** | Yield signature repeating at specific stepper field grid positions |
| **Cluster** | Contiguous group of failing dies denser than the background failure rate |
| **Edge arc** | Localised arc of failures near the wafer perimeter |
| **Spatial pattern** | Classification of an identified cluster shape — e.g. Donut, Scratch, Centre, Edge-localised, Random |

Which finding types are active depends on the application's analysis
configuration.

When a spatial pattern classification is detected alongside supporting regional
findings (ring, quadrant, sector), the panel groups them together — the pattern
classification is the primary finding and the regional findings provide
supporting detail.

---

## 6. Summary panel

The summary panel shows statistics and metadata for the current wafer or lot.
Open it from the toolbar.

![Summary panel open on single wafer](images/guide-summary-panel.png)

For a **single wafer**, the panel shows:

- Wafer and lot metadata (lot ID, wafer ID, test date — when available)
- Total die count, yield %, and counts of pass, fail, and edge-excluded dies
- Hard bin and soft bin breakdown with percentages
- Per-test descriptive statistics (min, max, mean, std dev, median) when test
  data is loaded
- Spec yield per test when limits are defined — pass die count and yield %
  split by below-limit and above-limit fails
- Findings list — same findings shown in the Findings panel; click to highlight

A **Summary report** button (when present) opens a printable full-detail report
in a new window.

![Wafer summary report](images/report-wafer-summary.png)

For **lot-level views** (gallery), the panel shows:

- Lot metadata and wafer count
- Per-wafer yield trend
- Lot-level aggregate bin breakdown
- Cross-wafer comparison findings

![Lot summary report](images/report-lot-summary.png)

---

## 7. Lot-stack maps

A lot-stack map combines multiple individual wafer results into a single
composite view. The display clearly identifies this: the number of wafers
included and the aggregation method in use are shown so you know you are
not viewing a single wafer's data.

Individual die coordinates are preserved. For each die grid position, results
from all wafers are aggregated into a single value or bin count according to
the selected aggregation method.

Stacked plot modes (Stacked Hard Bins, Stacked Soft Bins, Stacked Test Values)
are only available when a lot-stack map is active.

For lot-level findings across wafers in a gallery, see the lot-level summary
panel (Section 6) and [Section — Lot findings](images/guide-lot-findings-gallery.png):

![Lot findings panel in gallery view](images/guide-lot-findings-gallery.png)

*Gallery with lot-level summary panel open and a cross-wafer finding highlighted.*

---

## 8. Reticle overlay

When reticle (stepper field) geometry is configured, the **Reticle grid** overlay
draws the stepper field grid on the wafer. This lets you correlate failure
patterns with specific reticle positions — useful for identifying stepper field
signatures, alignment drift, or mask defects.

![Reticle overlay active](images/guide-reticle-overlay.png)

Reticle-position findings in the Findings panel highlight the specific field
positions that show elevated failure rates.
