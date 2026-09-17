# API removals and deprecations: rationale and record

Why each removed or deprecated public API item is leaving, whether it would help app builders,
what could go wrong if it stayed or came back, and what to use instead. Use this when someone
asks why something went, and before restoring, deprecating or removing anything.

- **Part 1** covers the **0.30.0 removals** (below).
- **Part 2** reviews the **78 exports deprecated in 0.30.0**: which were withdrawn, which were
  replaced in 0.30.1 before their 0.31.0 removal, and which are removed as planned.

# Part 1: removed in 0.30.0

## How to use this

- **Two kinds of removal.** A *deprecated* export still ships and logs a console notice, so
  keeping one costs nothing. A *removed* item is already gone, so bringing it back is an
  addition. Under the versioning policy in `CHANGELOG.md`, additions are allowed in a patch
  release. Nothing here needs a minor bump to restore.
- **No deprecation period.** Apart from `WaferMapResult.inference.warnings`, every item below was
  removed in 0.30.0 without being deprecated first. No written policy promised that at the time,
  but it is the fair answer if a user asks.
- **"Tsmap doesn't use it" is not a reason on its own.** Each entry judges whether *any* app
  builder could need the item. The reasons that count are the design rules in `CLAUDE.md`:
  the library enforces valid states, there is one source for each rule, and every display is
  correctly labelled.
- **Update this file** when an item is restored, redesigned or re-requested.

### Verdicts

| Verdict | Meaning |
|---|---|
| **Restored** | Back in the API. The version is noted. |
| **Redesign if requested** | The need is real, but the old form was unsafe or duplicated a rule. Restore only in a new shape. |
| **Restore on request** | Harmless. Nobody has asked. Adding it back is cheap. |
| **Keep removed: duplicate** | Another way to do the same thing already exists, so nothing is lost. |
| **Keep removed: superseded** | A later change solved the underlying need in a better way. |
| **Keep removed: unsafe** | It could produce a wrong, misleading or unreadable display. Do not restore in this form. |
| **Keep removed: internal** | It was plumbing between the library's own components and was never meant for hosts. |

## Summary

| Item | Verdict |
|---|---|
| `WaferMapController.closeSummaryPanel` | **Restored** (0.30.1) |
| `GalleryController.setColumns` | **Restored** (0.30.1) |
| `RenderOptions.renderTooltip` | Redesign if requested |
| `WaferMapController.getActiveLegend` | Redesign if requested |
| `WaferPreferences.ringCount` (interactive ring count) | Redesign if requested |
| `DieListDisplayOptions.csvFilename` | Keep removed: superseded, as the library names every saved file (0.30.1) |
| `RenderOptions.onExpand` | Redesign if requested |
| `RenderOptions.showPlotModeSelector`, `GalleryOptions.showPlotModeSelector` | Restore on request |
| `WaferMapController.setHelpButtonVisible` | Restore on request |
| `RenderOptions.maxSize` | Restore on request (low value) |
| `RenderOptions.minZoom` / `maxZoom` | Restore on request, with validation |
| `GalleryOptions.cardPadding` | Restore on request, with validation |
| `RenderOptions.legendPosition`, `GalleryOptions.legendPosition` | Keep removed: duplicate |
| `RenderOptions.fallbackFormat`, `GalleryOptions.fallbackFormat` | Keep removed: duplicate |
| `WaferMapController.setFallbackFormat`, `GalleryController.setFallbackFormat` | Keep removed: duplicate |
| `WaferMapController.setExpandVisible`, `setViewControlsVisible` | Keep removed: duplicate |
| `WaferMapController.setIdentityVisible` | Keep removed: duplicate |
| `View.colorBySpec` | Keep removed: duplicate |
| `WaferMapResult.inference.warnings` | Keep removed: duplicate |
| `RenderOptions.toolbarControls` | Keep removed: duplicate |
| `WaferMapController.setDies` | Keep removed: unsafe |
| `WaferMapController.setSummaryVisible` | Keep removed: unsafe |
| `GalleryOptions.maxSize` | Keep removed: unsafe |
| `passBins` on `analyzeWaferMap`, `analyzeWaferLot`, `renderWaferMap`, `renderWaferGallery` | Keep removed: unsafe |
| `AnalyzeWaferMapOptions.ringCount` | Keep removed: unsafe |
| `AnalyzeWaferMapOptions.includePartial` / `includeEdgeExcluded` | Keep removed: unsafe |
| `AnalyzeWaferMapOptions.enable*` (eight switches) | Keep removed: unsafe |
| `WaferDisplayState.binColors` / `metadataValueOrder` / `lotSize` | Keep removed: unsafe |
| `BinColors` without `pass` (shape change) | Keep removed: unsafe |
| `RenderOptions.chromeInset` | Keep removed: internal |
| `WaferMapController.setTooltipParent` | Keep removed: internal |
| `ToCanvasOptions.topClearance` / `minRightReserve` / `activeBin` / `hoverBin` | Keep removed: internal |
| `ViewOptions.dieGap` | Keep removed: internal |

---

## Restored

### `WaferMapController.closeSummaryPanel()`

- **What it did:** closed the Summary panel if it was open.
- **Why removed:** nothing used it.
- **Useful to app builders:** yes. A host needs the map's full width back when it loads a new
  file, opens a dialog of its own, or switches to a narrower layout. Without this method the
  only option is reaching into wmap's DOM.
- **Risk:** none. The old version did have a small bug: it reset the Summary button to its plain
  colour, which cleared the colour that marks notable findings.
- **Restored:** 0.30.1. It now shares one open/close path with the toolbar
  button, so the findings colour survives. There is no matching open method yet. Add one if a
  host asks.

### `GalleryController.setColumns(columns)`

- **What it did:** fixed the column count, or went back to automatic layout when given `undefined`.
- **Why removed:** nothing used it, and `GalleryOptions.columns` already set the count at mount.
- **Useful to app builders:** yes. A host with its own column control or shortcut, or one
  applying a saved preference after mount, needs to change the count without rebuilding the
  gallery.
- **Risk:** none of its own. It restores alongside a fix for two bugs in fixed-column layout:
  - A fixed count was still capped by die density, so 2 columns drew two 480px cards and left
    the rest of the row empty (0.21.1–0.30.0).
  - `GalleryOptions.columns` passed at mount was ignored, so the grid stayed at one column.
- **Restored:** 0.30.1. Invalid counts (0, negative, `NaN`) now fall back to
  automatic layout, and fractional counts are rounded.

---

## Redesign if requested

### `RenderOptions.renderTooltip`

- **What it did:** replaced the built-in die tooltip. A returned string was set as `innerHTML`,
  a returned element was appended, and `null` hid the tooltip.
- **Why removed:** nothing used it.
- **Useful to app builders:** yes. Hosts have real reasons to add their own information to a
  tooltip, such as a die image link, a lookup against another system, or a site-specific field.
- **Risks in the old form:**
  - **Injection.** Setting a string as `innerHTML` means a host that interpolates die metadata
    from a file (STDF and CSV fields are untrusted input) is open to script injection.
  - **Replacement, not addition.** It discarded the library's compact, mode-aware tooltip. That
    includes the active test value, the out-of-spec note, the bin verdict and the
    `Reticle (column, row)` line, all of which a host would have to rebuild correctly.
- **If requested:** let the host *add* lines to the built-in tooltip rather than replace it.
  Render the host's content as text, or as an element the host builds itself.

### `WaferMapController.getActiveLegend()`

- **What it did:** returned the bins, or metadata values, shown in the current mode as
  `{ bin, name, color }`.
- **Why removed:** nothing used it.
- **Useful to app builders:** yes. A host building its own legend, export or report next to the
  map needs exactly this.
- **Risk in the old form:** it kept **its own copies** of the ordering and colour rules. Bins
  were sorted by number instead of through `sortBinsForDisplay` (pass bins first, then fail bins
  by count). Metadata values used a plain `.sort()` and a colour index, not the natural order and
  lot-wide colours the map uses. A host legend built from it could therefore list or colour
  things differently from the map beside it, which the one-rule principle exists to prevent.
- **If requested:** return the legend model the canvas actually draws, from the same code, never
  a second derivation.

### `WaferPreferences.ringCount` (interactive ring count)

- **What it did:** let the ring overlay's ring count change as a view preference after build.
- **Why removed:** the findings kept the ring count they were analysed with. Changing the
  preference made the ring boundaries on the map describe different rings from the ring findings
  next to them, with no indication.
- **Useful to app builders:** yes. Trying 3, 4 and 5 rings interactively is a normal engineering
  task.
- **Risk in the old form:** the overlay and the analysis silently disagreed.
- **If requested:** changing the ring count must re-run the ring analysis, so the map, findings,
  Summary panel and report always agree. The gallery also needs a rule for wafers built with
  different ring counts, which currently raise `ring-count-mixed`.

### `RenderOptions.onExpand`

- **What it did:** replaced what the Expand button and the E key do.
- **Why removed:** it was gallery-to-card plumbing. The gallery still passes it internally to
  route expand into its own detach window.
- **Useful to app builders:** somewhat. A single-map host might want Expand to open its own
  window or route. `setDetachWindowOpener` covers **gallery cards only**, so a host using
  `renderWaferMap` directly has no hook today.
- **Risk:** low. The main trap is a host handler that does nothing, leaving an Expand button
  that appears broken.
- **If requested:** add a single-map equivalent of `setDetachWindowOpener` (where to open)
  rather than a hook that replaces the action (what expand means).

---

## Restore on request

### `RenderOptions.showPlotModeSelector`, `GalleryOptions.showPlotModeSelector`

- **What it did:** hid the plot-mode picker from the toolbar. It worked on both surfaces.
- **Why removed:** nothing used it.
- **Useful to app builders:** yes, for a host that switches modes itself, such as a kiosk
  dashboard or an app with its own mode tabs.
- **Risk:** low. Mode validity is still decided inside the library (`buildDataModeEntries`, and
  `buildView` falls back from an invalid mode), so hiding the picker cannot create an invalid
  state.

### `WaferMapController.setHelpButtonVisible`

- **What it did:** showed or hid the Help button after mount.
- **Why removed:** it duplicated `showHelpButton`.
- **Useful to app builders:** only for toggling help at run time. `openUserGuide()` already
  covers the usual case of folding help into the host's own menu.
- **Risk:** none.

### `RenderOptions.maxSize`

- **What it did:** capped a single map's width and height, aligning the map to the top left.
- **Why removed:** nothing used it.
- **Useful to app builders:** only a little. A host can put `max-width`/`max-height` on the
  container it already owns.
- **Risk:** low. It only affects presentation.
- **Not the same as `GalleryOptions.maxSize`**, which is unsafe (see below).

### `RenderOptions.minZoom` / `maxZoom`

- **What it did:** set the zoom limits relative to the fitted view. It worked. The limits are now
  fixed at 0.4× and 20×.
- **Why removed:** nothing used it.
- **Useful to app builders:** marginal.
- **Risk:** the values were never validated. `minZoom > 1`, `maxZoom < 1`, `0` or `NaN` broke
  zooming or the fitted view.
- **If restored:** validate the values and correct them with a warning.

### `GalleryOptions.cardPadding`

- **What it did:** set the padding inside each card's canvas. It worked, with a default of 6px,
  and fed the card-size calculation.
- **Why removed:** nothing used it.
- **Useful to app builders:** marginal, for denser or airier grids.
- **Risk:** low, but a large value shrinks the wafer inside the card and works against the 4px
  die readability target. The value was never validated.
- **If restored:** validate it and cap it at a sensible limit.

---

## Keep removed: duplicate

### `RenderOptions.legendPosition`, `GalleryOptions.legendPosition`

- **What it did:** set the legend position at the top level, beside `viewOptions.legendPosition`.
- **Why removed:** two places set one value.
- **Nothing lost:** use `viewOptions.legendPosition`.
- **Risk if restored:** it is unclear which setting wins. The top-level copy was also never
  reported through `onViewOptionsChange`, so a host that saves the view options it is sent
  quietly lost the setting.

### `fallbackFormat` (top level on both), `setFallbackFormat` (both controllers)

- **What it did:** set how unitless values outside the normal range are displayed, as SI or
  engineering notation.
- **Why removed:** it was a second way to set a value that is now a view preference.
- **Nothing lost:** use `viewOptions.fallbackFormat` and `setOptions({ fallbackFormat })`. It is
  reported through `onViewOptionsChange` with the other preferences.
- **Risk if restored:** as for `legendPosition`, there would be two sources, and the top-level
  one was invisible to saved preferences.

### `WaferMapController.setExpandVisible`, `setViewControlsVisible`

- **What it did:** showed or hid the Expand button, or the whole group of view controls.
- **Why removed:** they duplicated `showExpandButton` and toolbar options. The gallery still
  drives its own cards with them internally.
- **Nothing lost** for hosts.

### `WaferMapController.setIdentityVisible`

- **What it did:** showed or hid the identity header after mount.
- **Why removed:** it duplicated `showIdentity`.
- **Risk if restored:** the identity header is where a lot-stacked map shows it is stacked, and
  the principles require that. A run-time switch makes it easier to hide by accident.

### `View.colorBySpec`

- **What it did:** reported whether spec colouring was in effect. It always equalled
  `passFailDisplay === 'spec'`.
- **Why removed:** its input option went in 0.21.0, and this read-back copy stayed behind.
- **Nothing lost:** read `view.passFailDisplay`, which also reports the `'test'` display this
  flag could not express.

### `WaferMapResult.inference.warnings`

- **What it did:** listed geometry advisories as plain strings.
- **Why removed:** it had been **deprecated since 0.13.5**. It is the only 0.30.0 removal that
  was deprecated first.
- **Nothing lost:** `result.warnings` carries the same messages with a stable `code` and a
  severity.
- **Risk if restored:** hosts matching on message wording break whenever the wording changes.
  That wording was never a contract.

### `RenderOptions.toolbarControls`

- **What it did:** `'view-only'` showed only zoom, reset, box-select and download.
- **Why removed:** its only non-default value was never used. The documentation said gallery
  cards used it, but the gallery passed `'full'`.
- **Nothing lost:** `showToolbar` covers the no-toolbar case.

---

## Keep removed: superseded

### `DieListDisplayOptions.csvFilename`

- **What it did:** named the die-list CSV export. The default was `dies.csv`.
- **Why removed:** nothing used it.
- **What removing it exposed:** every die-list export was then suggested as `dies.csv`, whichever
  wafer it came from, and every other export (the map, gallery and chart PNGs, and the other
  CSVs) had the same problem.
- **Superseded in 0.30.1:** the library names every saved file itself as
  `[lot]_[wafer]_[content]` (API §5.4.5). A free-text name for one export would bring back the
  collisions, so don't restore it. A host receives the generated name as `suggestedName` in
  `onSaveText` and can save under any name it likes. From 0.31.0, `downloadFilename` becomes a
  prefix applied to every export, CSVs included.

## Keep removed: unsafe

### `WaferMapController.setDies`

- **What it did:** replaced the die data but **kept the previous wafer geometry**.
- **Why removed:** switching wafers with it drew one wafer's dies inside the previous wafer's
  outline, notch, rings and edge exclusion, with no warning.
- **Use instead:** `setResult`, which replaces the geometry and the dies together.

### `WaferMapController.setSummaryVisible`

- **What it did:** hid the Summary toolbar button.
- **Why removed:** nothing used it.
- **Risks:**
  - That button is also the **notable-findings indicator**, so hiding it can hide a finding from
    the engineer.
  - The toolbar's own refresh resets the button's visibility, so the host's hide did not
    reliably stick.
- **Use instead:** leave out `statsSummary` if the map should have no Summary panel.

### `GalleryOptions.maxSize`

- **What it did:** overrode the density-based card size cap with a fixed pixel value.
- **Why removed:** it duplicated the density cap. In practice it also covered up the
  fixed-column layout bug (see `setColumns`).
- **Risk:** a value that is too small overrides the readability calculation, making dies on a
  high-density wafer unreadable at gallery scale. The old documentation said so ("you own the
  readability trade-off"). A caller-set flag that can produce a bad plot breaks the first design
  principle.
- **If a real need appears:** a *minimum* card size is safe in a way a maximum is not.

### `passBins` on `analyzeWaferMap`, `analyzeWaferLot`, `renderWaferMap`, `renderWaferGallery`

- **What it did:** set which bins count as passes, separately at each stage.
- **Why removed:** pass bins are now set once, on `buildWaferMap`, and carried as
  `WaferMapResult.passBins`. Having a second place to set them caused a shipped bug: every
  surface except the headline yield judged pass/fail by `[1]`, so bin 2 showed as a failure next
  to a yield that counted it as a pass.
- **Risk if restored:** findings, colours, legends and yield could each use different pass bins
  on one screen.
- **Use instead:** give pass bins to `buildWaferMap`, and rebuild to change them. At run time,
  `analyzeWaferMap` and `analyzeWaferLot` ignore a stale value and raise
  `analysis-option-corrected`.

### `AnalyzeWaferMapOptions.ringCount`

- **What it did:** set the ring count used for ring findings.
- **Why removed:** ring count is now set once, on `buildWaferMap`, and carried as
  `WaferMapResult.ringCount`.
- **Risk if restored:** ring findings would describe different rings from the boundaries drawn
  on the map.
- **Use instead:** `WaferMapInput.ringCount`. For interactive ring changes, see the redesign note
  on `WaferPreferences.ringCount`.

### `AnalyzeWaferMapOptions.includePartial` / `includeEdgeExcluded`

- **What it did:** included partial or edge-excluded dies in the findings analysis.
- **Why removed:** the findings would describe a different set of dies from the yield figure
  shown next to them.
- **Useful to app builders:** there is one real case: an engineer tuning edge exclusion who wants
  to see what is happening in the excluded band.
- **Risk if restored:** findings and yield would cover different populations on one screen, with
  nothing to say so.
- **Use instead:** change `edgeExclusion` when building, so yield and findings move together.

### `AnalyzeWaferMapOptions.enable*` (eight switches)

`enableYieldAnalysis`, `enableHardBinAnalysis`, `enableSoftBinAnalysis`,
`enableReticlePositionAnalysis`, `enableTestSiteAnalysis`, `enableClusterAnalysis`,
`enableAngularAnalysis`, `enablePatternClassification`.

- **What they did:** turned individual analyses off, or forced them on.
- **Why removed:** each one was cheap and on by default. The two options that really cost time,
  `enableTestValueAnalysis` and `computePerTestStats`, remain.
- **Risks if restored:**
  - With an analysis off, the Summary panel and report can say there are no notable findings
    when the analysis **never ran**. An engineer reads that as a clean wafer.
  - `enableTestSiteAnalysis: true` skipped the library's check for meaningful site duplication,
    so it could report site findings from data that cannot support them.
- **Use instead:** `filterFindings`, to hide classes of finding after analysis. From untyped
  JavaScript, a passed switch raises `analysis-option-corrected`.

### `WaferDisplayState.binColors` / `metadataValueOrder` / `lotSize`

- **What they did:** let the gallery pass its lot-wide bin colours, metadata order and lot size
  into each card. The fields were exposed on the public display state.
- **Why removed:** on a host's own map they looked like settings the host had to supply, but a
  standalone map works all three out itself. `binColors` also held `Map`s, which a host saving
  its options cannot serialise.
- **Risks if restored:**
  - A wrong `binColors` makes the map's colours disagree with its own legend.
  - A wrong `lotSize` makes a lot-stacked map state the wrong number of wafers, which is the
    labelling the principles require to be correct.
- **Still available** as `ViewOptions` fields for `buildView`, which is deprecated for 0.31.0.

### `BinColors` without `pass` (shape change)

- **What changed:** `BinColors` gained a required `pass: { hard, soft }` field. A `BinColors`
  without it, passed as `ViewOptions.binColors`, is now ignored and resolved afresh.
- **Why:** soft bins were judged "pass" by looking them up in `passBins`, which holds hard-bin
  numbers. That misordered soft-bin lists and made the gallery's soft-bin yield read close to 0%.
- **Risk if reverted:** that bug returns.
- **Use instead:** build it with `resolveBinColors`, or use `binPassSets(dies, passBins)` for the
  pass sets alone.

---

## Keep removed: internal

### `RenderOptions.chromeInset`

- **What it did:** set the inset of a map's toolbar and identity row.
- **Why removed:** the gallery uses it to stop a second gutter appearing inside cards. The inset
  depends on context the library already knows. The gallery still passes it internally.

### `WaferMapController.setTooltipParent`

- **What it did:** moved the tooltip element into another container.
- **Why removed:** the expand modal needed it. Hosts never did.
- **Risk if restored:** a host moving the tooltip into a transformed or clipped container gets a
  tooltip in the wrong place or cut off.

### `ToCanvasOptions.topClearance` / `minRightReserve` / `activeBin` / `hoverBin`

- **What they did:** passed the interactive map's layout and legend-highlight state into
  `toCanvas`.
- **Why removed:** a direct `toCanvas` caller has no toolbar, hover state or legend
  interaction. `topClearance` was always 0. `toCanvas` itself is deprecated for 0.31.0.

### `ViewOptions.dieGap`

- **What it did:** set the gap drawn between dies.
- **Why removed:** it was always left at its default. `buildView` is deprecated for 0.31.0.

---

# Part 2: deprecated in 0.30.0, due for removal in 0.31.0

Reviewed 2026-09-16. The 0.30.0 deprecations were chosen mainly by measuring what tsmap and the
examples call. That is evidence that nothing *known* depends on an export, not that no app
builder could. This review weighs each one on its own merits. **Decided and implemented in
0.30.1.** One change from the original recommendations: `renderFindingsReportHtml` was listed for
replacement, but it already takes a summary alone, so it was withdrawn rather than renamed.

**Facts checked for this review:**
- tsmap calls none of the 78, and no example does.
- Nothing public exposes the bin colours a map uses except `resolveBinColors`.
- `StatsSummary`/`LotStatsSummary` carry per-test descriptive statistics, per-wafer yield, bin
  counts and functional yield, but **not** capability (Cp/Cpk), per-test pass rates,
  correlation, or ring/quadrant yield.
- The report HTML builders don't use the DOM, so they work in Node.
- `buildWaferMap` with no `results` returns **no dies**, so it cannot build a die layout on its
  own.
- `summary.findings` is deliberately left uncollapsed, and `filterFindings` does not collapse it.

### Verdicts for Part 2

| Verdict | Meaning |
|---|---|
| **Keep** | Deprecation withdrawn in 0.30.1. It's useful, low-risk and cheap, and it is the library's single copy of a rule a host would otherwise re-implement. |
| **Replace before removal** | The need is real and nothing else met it, but the export was the wrong shape (unsafe defaults, tied to internals). A supported replacement shipped in 0.30.1, the deprecation notice names it, and the old export is removed in 0.31.0 as planned. |
| **Remove as planned** | A duplicate of a supported path, trivial, tied to the withdrawn drawing pipeline, or unsafe to call directly. |

### Summary

| Verdict | Count | Items |
|---|---|---|
| **Keep** (withdrawn 0.30.1) | 5 | `visibleFindings`, `openReportModal`, `metadataDisplayValue`, `getReticleCell`, `renderFindingsReportHtml` |
| **Replace before removal** (replaced 0.30.1) | 12 | `resolveBinColors`; `buildCapabilityData`; `buildTestPassRateData`, `hasJudgeableTests`; `buildRegionYieldData`, `buildRingRegions`, `buildQuadrantRegions`; `renderSummaryReportHtml`, `renderLotSummaryReportHtml`; `createWafer`, `generateDies`, `clipDiesToWafer` |
| **Remove as planned** | 61 | everything else, below |

**Timing.** Every replacement shipped in 0.30.1, so all 73 remaining deprecations are still due
in 0.31.0. `tests/deprecations.test.mjs` enforces that, and lists the five withdrawn names among
the exports that must stay.

---

## Keep: withdraw the deprecation

### `visibleFindings` (stats)

**Status:** deprecation withdrawn in 0.30.1.

- **What it does:** drops findings that another finding has absorbed as an exact restatement,
  such as a soft-bin twin covering the same dies.
- **Why deprecated:** treated as an internal helper.
- **Why keep:** `summary.findings` is deliberately uncollapsed, and `filterFindings` doesn't
  collapse it. A host that lists findings in its own UI, export or ticket therefore needs this
  rule. Its own comment records that the rule once existed in three places and one copy was
  wrong, which printed every merged fact twice. Removing the export pushes hosts back into
  copying it.
- **Risk:** none. It is a pure, one-line filter. **Cost:** negligible.

### `openReportModal` (render)

**Status:** deprecation withdrawn in 0.30.1.

- **What it does:** shows report HTML in wmap's own in-page modal, isolated in an iframe with its
  own print button.
- **Why deprecated:** reports open from the Summary panel's button.
- **Why keep:** it is the natural partner of `setReportOpener`, which stays. Once a host installs
  an opener (to save, log or archive a report), wmap's modal no longer opens, and without this
  export the host has to rebuild the modal to also show the report. Tauri hosts are the likely
  case.
- **Risk:** low. It shows whatever HTML it is given, which is the caller's responsibility.
  **Cost:** small; it already exists and is used internally.

### `metadataDisplayValue` (core)

**Status:** deprecation withdrawn in 0.30.1.

- **What it does:** the one rule for turning a metadata value into display or export text.
  Absent stays absent, `0` and `false` are kept, dates become ISO strings, and objects become
  JSON rather than `[object Object]`.
- **Why deprecated:** treated as an internal helper.
- **Why keep:** a host writing its own export or labels next to wmap's (the file names added in
  0.30.1 use it too) needs its text to match wmap's CSVs exactly. The rule's edge cases are
  exactly the ones hosts get wrong.
- **Risk:** none. **Cost:** negligible.

### `getReticleCell` (core)

**Status:** deprecation withdrawn in 0.30.1.

- **What it does:** the reticle (column, row) of a die for a reticle configuration.
- **Why deprecated:** the tooltip shows the cell.
- **Why keep:** the tooltip is the only surface. The die list and its CSV have no reticle column,
  so a host exporting reticle position (for example to MES or an SPC tool) must re-derive the
  anchor maths. This function is the single source the tooltip and the reticle findings already
  share.
- **Risk:** low; pass the same `reticleConfig` given to `buildWaferMap`. **Cost:** negligible.
- **Alternative:** add a Reticle column to the die list and CSV. Then this could go as planned.

### `renderFindingsReportHtml` (stats)

**Status:** deprecation withdrawn in 0.30.1.

- **What it does:** the findings-only report, as standalone HTML.
- **Why deprecated:** reports open from the Summary panel's button.
- **Why keep:** it takes a `StatsSummary` or `LotStatsSummary` and nothing else, so unlike the
  wafer and lot report builders it has no loose parameters to get wrong. Replacing it would
  only have renamed it. It runs in Node, for the same headless reporting need as below.
- **Risk:** none. **Cost:** none; the Summary panel uses it.

---

## Replace before removal

### `resolveBinColors` (renderer)

**Replaced in 0.30.1 by** `binColorsForMaps(results)` and `getBinColors()` on both controllers.

- **What it does:** resolves the bin colours a map draws.
- **Why deprecated:** "the maps resolve bin colours themselves".
- **The gap:** that is true for wmap's surfaces, but any **host** surface showing bin colours
  has no other source once this goes: its own table swatches, a PDF, a slide, a chart in another
  library. `getActiveLegend` was removed in 0.30.0, and `View.binColors` is internal. A host would
  have to copy the colour rule, the thing CLAUDE.md says must have exactly one copy.
- **Why not keep it as is:** it takes dies plus an optional `passBins` that defaults to `[1]`, the
  downstream-default pattern that caused the 0.30.0 pass-bin bug.
- **Replacement:** a result-based read that cannot get pass bins wrong. For example,
  `resolveBinColors(results: WaferMapResult[], options)` reading each result's own `passBins`,
  and/or `WaferMapController.getBinColors()` / `GalleryController.getBinColors()` returning
  what is actually drawn.

### `buildCapabilityData` (stats)

**Replaced in 0.30.1 by** `stats.capability` on wafer and lot summaries.

- **What it does:** Cp/Cpk (pooled within-wafer sigma) and Pp/Ppk (overall sigma) for every
  parametric test.
- **Why deprecated:** it prepared data for the Insights charts.
- **The gap:** capability indices are among the most commonly exported numbers in wafer sort,
  for Cpk tables, SPC and customer reports. No analysis output carries them, and the maths
  (which sigma, subgrouping, tests with no spec) is easy to get subtly wrong.
- **Replacement:** capability per test in `analyzeWaferLot`'s output, or `analyzeWaferMap`'s
  where meaningful, alongside `perTestStats`. It would be computed by this same code, so the
  Insights chart and the export agree.

### `buildTestPassRateData`, `hasJudgeableTests` (stats)

**Replaced in 0.30.1 by** `stats.testFlagYield` and `stats.specVerdictDisagreementDies`, alongside the existing `testSpecYield` and `functionalYield`, on wafer and lot summaries. The review had assumed spec and functional pass rates were also missing; they were already there.

- **What they do:** per-test pass rates using spec limits, the tester's recorded verdict, or
  functional pass/fail, including a count of dies where spec and tester disagree.
- **The gap:** no analysis output carries per-test pass rates or the disagreement count. Hosts
  exporting "which tests fail most" would re-implement three different pass/fail notions, and
  `getTestPassStatus` exists precisely so there is one.
- **Replacement:** per-test pass rates (by kind, with `disagreementDies`) in the analysis output.
  `hasJudgeableTests` then becomes internal.

### `buildRegionYieldData`, `buildRingRegions`, `buildQuadrantRegions` (stats)

**Replaced in 0.30.1 by** `stats.regionYield` on wafer and lot summaries.

- **What they do:** yield per ring and per quadrant, each wafer judged by its own pass bins.
- **The gap:** edge-versus-centre yield is a standard engineering export. The Summary panel,
  report and Insights all compute it, but no analysis output carries it, so a host has only
  these three raw builders.
- **Why not keep them as is:** they are internal building blocks: dies by wafer, a ring count and
  a region function, which a caller must combine correctly.
- **Replacement:** `regionYield: { ring, quadrant }` on the summaries, built by the same code the
  panel uses, with `ringCount` taken from the result.

### `renderSummaryReportHtml`, `renderLotSummaryReportHtml` (stats)

**Replaced in 0.30.1 by** `renderWaferReportHtml(result, summary?)` and `renderLotReportHtml(results)`. `renderFindingsReportHtml`, first listed here, was kept instead (see Keep). Building these exposed a real bug: the lot report analysed empty wafers when no precomputed summary was given, which the new path fixes.

- **What they do:** produce the wafer, lot and findings reports as standalone HTML.
- **Why deprecated:** reports open from the Summary panel; `setReportOpener` routes them.
- **The gap:** `setReportOpener` only receives a report when a user clicks. Headless and batch
  generation (a nightly lot report, archiving each wafer's report, emailing a disposition
  summary) has no other path. These builders don't use the DOM, so they already run in Node.
- **Why not keep them as is:** their parameters are loose pieces with library-wide pitfalls:
  `passBins = [1]` and `ringCount = 4` defaults, and a yield summary and dies passed separately
  that can come from different builds.
- **Replacement:** report builders that take the built maps, reading pass bins and ring count
  from them.

### `createWafer`, `generateDies`, `clipDiesToWafer` (core)

**Replaced in 0.30.1 by** `buildWaferMap({ layout: true, waferConfig, dieConfig })`.

- **What they do:** build wafer geometry and a full die grid clipped to it, with no test data.
- **Why deprecated:** part of the low-level drawing pipeline.
- **The gap:** a layout without test data is a real need: gross-die-per-wafer calculators,
  reticle and step planning, a "what the wafer should look like" view before test data exists.
  `buildWaferMap` with no `results` returns no dies, so nothing else covers it.
- **Why not keep them as is:** the pieces must be composed correctly by hand (geometry, pitch,
  clipping, `partial` flags), and they come with the transform pipeline that is being withdrawn.
- **Replacement:** let `buildWaferMap` build a layout-only map from `waferConfig` + `dieConfig`,
  with `partial` meaningful as CLAUDE.md already describes for a synthesised grid. Make it an
  explicit request rather than a change to what "no results" means today, so it stays additive.
  `renderWaferMap` can then draw it like any other result.

---

## Remove as planned

### The drawing pipeline: 18 names

`buildView`, `toCanvas`, `buildHoverText`, `buildMapTitle`, `applyOrientation`, `transformDies`,
`isInsideWafer`, `generateReticleGrid`, `applyProbeSequence`, `mapDataToDies`, and the eight
`affine*` helpers (`affineIdentity`, `affineRotation`, `affineMirror`, `affineCompose`,
`affineInvert`, `affinePoint`, `affineVector`, `affineSwapsAxes`).

- **Possible use:** custom renderers (SVG, WebGL, server-side PNG), static thumbnails, host
  panels with the map's own tooltip text.
- **Why remove:**
  - These expose the part of the library with the most recorded wrong-die bugs: coordinate
    frames, the non-commuting rotate/mirror pipeline, `die.x` versus display coordinates. Every
    external caller is a place those bugs can recur, outside the tests
    (`displayTransforms.test.mjs`) that catch them.
  - Keeping them freezes the internal `View` shape and blocks refactoring.
  - `buildHoverText` returns HTML, and file-supplied names are currently not escaped in it (see
    the note at the end).
- **If requested:** add a narrow, supported entry, such as
  `renderWaferMapImage(result, options) → Blob` for static and server-side images, or a
  tooltip-extension hook (see `renderTooltip` in Part 1). Don't re-expose the pipeline.
- `applyProbeSequence` has no replacement, since `buildWaferMap` has no probe-sequence option.
  Nobody has asked for probe-order display; add it as a `buildWaferMap` option if they do.

### Duplicates of a supported path: 11 names

| Name | Use instead |
|---|---|
| `valueToViridis`, `valueToGreyscale`, `getValueColorScheme` | `resolveValueColorFn(name, reversed)`. The old reads ignore `reverseValueScheme`, so a surface built on them can show a reading in a different colour from the map. |
| `isPositionedDie` | `hasPosition` |
| `classifyPattern` | `stats.spatialPattern` on `analyzeWaferMap`'s result — the label, confidence and geometry features for every wafer (0.30.1). The review first missed that the features had no other path: the `spatial-pattern` finding carries only the label, and only for a detected pattern. |
| `computeFunctionalYield` | `stats.functionalYield` |
| `aggregateValues`, `aggregateBinCounts`, `getUniqueBins` | `buildWaferMap`'s `lotStack`. `aggregateValues` also carries the `paramIndex` trap that caused a real wrong-data bug. |
| `DEFAULT_FACET_CURATION` | `buildFacetTable`'s `curation` option, which already layers over the defaults |
| `STANDARD_WAFER_DIAMETERS_MM` | `buildWaferMap`'s `standardDiameters` |

### Trivial one-liners: 3 names

`getDieTestValue` (`die.testValues?.[n]`), `dieHasTestData` (two key checks),
`isParametricTest` (`testType !== 'F'`). Keeping them costs little but adds nothing, and verdicts
already have a real single read-path in `getTestPassStatus`, which stays.

### Chart-drawing preparation: 13 names

`buildYieldData`, `buildYieldDataCombined`, `buildBinParetoData`, `buildBinClusterData`,
`buildTestBoxplotData`, `buildTestTrendData`, `trendCentre`, `buildTestHistogramData`,
`buildTestHistogramSeries`, `buildScatterData`, `buildScatterDataGrouped`,
`buildCorrelationMatrix`, `filterCorrelationMatrix`.

- **Why remove:** they shape data for drawing a particular chart, and the numbers behind them are
  already in the analysis output: per-wafer yield (`lotYieldSeries`), bin counts (`hardBinCounts`
  and soft), five-number summaries and means (`perTestStats`). Keeping them freezes a dozen chart
  data types that change whenever the charts do.
- **Risk if kept:** `buildYieldData` defaults `passBins` to `[1]`.
- **`buildCorrelationMatrix`** is the borderline case:
  correlation tables have some export value and no analysis output carries them. Remove as
  planned, and add correlation to the analysis output if requested, as for capability.

### Internal building blocks: 16 names

`buildSectorRegions`, `buildReticlePositionRegions`, `buildTestSiteRegions`,
`areQuadrantsAdjacent`, `parseRegionKey`, `sectorCompassNames`, `classifyDie`, `getRingLabel`,
`metadataCategoricalValue`, `resolveMetadataColumns`, `discoverDieMetadataKeys`,
`buildDieListSection`, `getBinColorScheme`, `contrastTextColor`, `openHtmlReport`,
`resolveGridPitch`.

- **Region and pattern internals:** findings already carry prose labels (`comparison.left`, "Ring 4
  (edge)"), and `StatsFinding.id` is documented as not to be parsed, so `parseRegionKey` has no
  legitimate use. Per-die ring and quadrant are in the die-list CSV (Ring and Quadrant columns),
  which covers `classifyDie`/`getRingLabel` exports. `classifyDie` also defaults
  `ringCount` to 4, so a caller can silently disagree with the result's ring count.
- **`getBinColorScheme`:** a raw palette lookup that bypasses the bin colour rule. Two bins can
  get colours that differ from the map's. The host need is covered by the `resolveBinColors`
  replacement above.
- **`buildDieListSection`:** the maps show the die list themselves. Low risk, so restore it on
  request if a host wants the table in its own panel.
- **`resolveGridPitch`:** `buildWaferMap` resolves pitch, and each die's `width`/`height` carries
  it. Its only use was a host pre-flight before building, which tsmap no longer does, and the
  inference it exposes is internal and may change.
- **`contrastTextColor`, `openHtmlReport`, `resolveMetadataColumns`,
  `discoverDieMetadataKeys`, `metadataCategoricalValue`:** generic or plumbing. The library
  applies each one itself.

18 + 11 + 3 + 13 + 16 = 61.

---

## Found during this review: unescaped HTML in tooltips (not a deprecation issue)

**Fixed in 0.30.1** (CHANGELOG, Security).

A security issue in how names from input files are displayed was found while reviewing the
tooltip exports. It is unrelated to any deprecation decision and is fixed in 0.30.1. Details
are deliberately not recorded here, since earlier versions remain in use.
