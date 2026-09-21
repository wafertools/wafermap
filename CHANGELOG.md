# Changelog

All notable changes to `@wafertools/wafermap` are documented here. For a curated,
plain-language summary of what's actually changed for users and adopters, see
[What's New](https://wafertools.github.io/whats-new/) instead — this file is the complete
technical record, including internal changes.

## Versioning policy

This project is pre-1.0 and follows a strict breakage rule:

- **Any release containing a `### Breaking` entry requires a minor bump** (`0.x.0`),
  never a patch. Removing, renaming, or changing the type/semantics of a public
  field, option, return value, or export is breaking.
- **Patch bumps (`0.x.y`) are additive or fixative only** — new optional fields,
  new optional options, bug fixes, performance work, and documentation. They must
  not break code written against the previous patch.

Consumers pinning `~0.x.y` therefore get patch-level fixes without surprise
breakage; breaking changes always move the minor and surface in the changelog
under `### Breaking`.

---

## [0.30.2] — 2026-09-20

### Added

- **A gallery now reports its own progress, so a host's indicator can be honest about a long
  load.** `GalleryOptions` gains two callbacks (API §6.2):
  - `onItemResolved(resolved, total)` — the **advance** signal, fired as each card is built.
    `total` is the count you passed, so it is right from the first call and a progress bar can be
    sized before anything arrives.
  - `onItemsResolved()` — the **settled** signal, fired once the gallery has finished: every
    factory resolved *and* the lot-wide legend, shared colours and Summary panel up to date. On a
    large lot the panel keeps filling in for seconds after the last card, so this is deliberately
    later than "the cards are in" — a host clearing its indicator when the cards land leaves the
    rest of the wait unexplained.
  - Both fire whichever form the items took, so no host branches on the path the gallery chose: a
    fully pre-built mount is one `onItemResolved` call with `resolved === total`, and
    `onItemsResolved` always fires asynchronously, after `renderWaferGallery` has returned. Both
    fire again on a rebuild (`setItems`, or switching into a stacked mode).
- **`CorrelationMatrix.sample`** — present only when the matrix was computed from a sample of the
  dies, with `of` (the dies that carried test values) and `used` (how many were read).
  The Insights correlation panel labels a sampled matrix from it; a host reading the matrix
  directly must do the same.

### Changed

- **Correlation is computed from at most 25,000 dies.** It is the only analysis here that is
  quadratic in tests and linear in dies — a 400,000-die, 50-test lot is 490 million pair updates,
  which in a browser presents as a panel that never renders. Above that budget the dies are
  sampled by an even stride across the whole population, never a prefix (dies arrive grouped by
  wafer, so the first 25,000 of a lot are its first few wafers and would describe those rather
  than the lot). At 25,000 dies the standard error of `r` is under 0.007, so the coefficients are
  unchanged at the precision they are displayed to. **A sampled matrix always says so** — in the
  Insights panel and in `CorrelationMatrix.sample`.
- **The lot and wafer Summary panels are built across tasks instead of in one block, and fill in
  section by section.** Pooling every die of every wafer and deriving the bin, region and
  per-test sections from it is the longest single piece of work this library does: 15.3 s on a
  50-wafer lot of 4,000 dies × 100 tests, which is where a browser starts offering to kill the
  page. It is now around 335 steps of a few hundred ms at most. An ordinary lot still renders in
  one synchronous pass and looks exactly as it did. A panel render in flight is abandoned when
  the lot, filter or highlight changes, and on `destroy()`.
- **The same panel work is also about 2.3× cheaper, and a lot pays for it once.** The per-test
  pass over a lot's pooled dies is memoised on the population it describes, so the lot Summary
  panel, the Insights Overview and the Insights capability chart share one computation instead of
  running three; the sort inside it uses a `Float64Array` (4× on the whole pooled pass); and the
  Test Values rows are built in one pass instead of three.
- **Switching Insights tabs no longer rebuilds the panel you are returning to.** A built section
  is kept per view, so going back to Distributions is instant rather than re-running capability,
  boxplot, histogram and trend (about 5 s at 400,000 dies). Only a pure tab switch reuses it —
  new data, Group by, scope or an axis preference still rebuilds everything.
- **A lot-wide option is pushed to the cards only when its value actually changed.** `binColors`,
  `valueRange` and `metadataValueOrder` are re-derived from the whole population as each wafer
  resolves, and each derivation allocates a fresh object, so every card was being rebuilt and
  redrawn for an identical value. On a progressive load that is quadratic: on 50 wafers × 8,000
  dies × 50 tests in Chrome the bin-colour map alone was 1,275 pushes and 24 s of a 64 s load,
  and is now one push.
- **The gallery's lot Summary panel now settles once, when the last wafer resolves, instead of
  re-rendering after every one.** A progressive load was re-pooling and redrawing the whole
  panel on each newly resolved wafer, which is quadratic in wafer count and was the single
  largest cost on this path: 175 s of a 182 s, 50-card progressive load. The panel still renders
  once at mount and again whenever a user opens it. Combined with the change above, 50 cards of
  8,000 dies now load in **7.7 s of non-blocking work with no task over 440 ms**, down from
  182 s.

### Fixed

- **A large wafer or lot could fail outright with "Maximum call stack size exceeded".**
  `Math.min(...)`/`Math.max(...)` spread a whole die array into a call, which throws once the
  array passes roughly 100,000 entries — reachable on a single 400,000-die wafer in aggregated
  values, inferred wafer geometry, reticle bounds and several chart scales. Every such call now
  uses the `minOf`/`maxOf` helpers, and `scripts/check-spread-limits.mjs` (wired into
  `npm run check`) fails the build if one comes back.
- **A non-finite test value could make a whole test's statistics `NaN`.** `computePerTestStats`
  sorted and summarised whatever `testValues` held, with no `Number.isFinite` screen, so one
  `NaN` or `Infinity` from a parser silently turned that test's mean, median, sigma and Cpk into
  `NaN` rather than being dropped as no data.

## [0.30.1] — 2026-09-16

### Security

- **Fixes a security issue in how names from a data file are displayed.** Earlier versions are
  affected; update to 0.30.1, particularly if your app opens files from sources you don't
  control. Names now always display as plain text, so a name that contains markup shows it
  literally.

### Changed

- **Every saved file is named for the data it came from.** Exports were named for their content
  alone — `dies.csv`, `test-values.csv`, `wafermap.png`, `wafer-gallery.png`, a chart's title — so
  the same export from two wafers of a lot saved as `dies.csv` and `dies (1).csv`, with nothing in
  either name to say which wafer it described. Map, gallery and chart PNGs and every CSV export
  are now named `[lot]_[wafer]_[content]`, for example `LOT123_W05_hard-bin.png`,
  `LOT123_W05_die-list.csv` and `LOT123_25-wafers_yield-by-wafer.png` (see API §5.4.5).
  - A part the data doesn't have is left out, never invented. A wafer with no `label` or
    `waferId` gets no wafer part, not a position that could be read as an ID.
  - A gallery writes its lot and wafer counts (`2-lots`, `25-wafers`), and a lot-stacked map
    writes `stacked-N-wafers`. A card or detached window names files for its own wafer.
  - The name is worked out at save time, so it follows `setResult`, `setItems` and plot-mode
    changes.
  - Names are safe on every common filesystem: path and reserved characters are replaced,
    length is limited, and Windows device names are avoided.
  - **`downloadFilename` is unchanged.** When a host sets it, the map or gallery PNG is still
    named `<downloadFilename>.png`. Only its defaults change: without it, the map PNG was
    `wafermap.png` and the gallery PNG `wafer-gallery.png`, and both now get the generated name.
    Gallery cards, which never read it, also get the generated name, as do all CSVs and charts.
  - `onSaveImage` and `onSaveText` receive the generated name as `suggestedName`. A host that
    matched one of the old default names needs to change.
  - The die-list export's content part is `die-list` (was `dies`).
- **A floating window's minimize button is now Collapse, and is hidden while the window is
  maximized.** In a desktop host such as Tauri, where a detached gallery card falls back to an
  in-page window, a maximized window's header sits directly under the app's own title bar. Its
  `_` minimize looked like the OS button beside it but only shrank the window to a title strip.
  The button is now drawn as chevrons, with the tooltip **Collapse** (**Show contents** while
  collapsed), and a maximized window shows only restore and close, like a modal. This applies to
  the detached-card fallback window and the user guide window. Modals are unchanged, and
  `ICONS.windowMinimize`/`windowRestore` are still exported.
- **The data layer is about 3 KB larger (~52 KB gzip).** Analysis now returns capability, pass
  rates by recorded verdict and region yield (see Added), so it includes the code that computes
  them.

### Deprecated

- **`downloadFilename` (on `RenderOptions` and `GalleryOptions`) becomes a prefix in 0.31.0.** It
  will lead the name of every file a map or gallery saves, CSVs included, with the lot, wafer and
  content appended, for example `LOT123_sort_W05_hard-bin.png`. Parts it already names won't be
  repeated, so a host passing a source-file stem that contains the lot won't see the lot twice.
  It is not being removed. Until 0.31.0 it keeps its current meaning, and passing it logs a
  one-time console notice. If you rely on setting a map's whole file name, say so at
  https://github.com/wafertools/wafermap/issues.
- **Five 0.30.0 deprecations are withdrawn on review**, as each is the only supported path to
  something a host needs: `visibleFindings` (the one rule for collapsing restated findings —
  `summary.findings` is deliberately uncollapsed), `openReportModal` (shows a report when a host
  has installed its own `setReportOpener`), `metadataDisplayValue` (the one rule for a metadata
  value's text in an export), `getReticleCell` (the only source of a die's reticle cell outside
  the tooltip) and `renderFindingsReportHtml` (it takes a summary alone, so it cannot be given
  inconsistent inputs). They log no notice and stay.
- **Every remaining deprecation notice now names what to use instead**, or says plainly that
  there is no data replacement (the histogram, scatter and correlation builders). The review
  behind each verdict is recorded in the repository's `API_REMOVALS.md`.

### Fixed

- **A test could not be chosen from the plot-mode menu on a touchscreen.** With more tests than
  fit inline, "Test Value ▶" opens a submenu, and it opened on hover only. On a phone or tablet a
  tap opened the submenu and the same tap closed it again, so the list flashed and no test could
  be picked. From the keyboard, Enter on the row did nothing. The row now also opens the submenu
  when tapped or activated with Enter or Space. Focus moves into the submenu when it is opened from
  the keyboard, the arrow keys move through its tests, and Escape closes it. Tapping the submenu's
  filter box no longer closes the menu underneath. Applies to both `renderWaferMap` and
  `renderWaferGallery`. Guarded by `tests/modeMenuCascade.test.mjs`.
- **Map lines and markers got thinner as display scaling rose.** Ring, quadrant and reticle
  lines, the wafer outline, the probe path, the +X/+Y indicator, out-of-spec triangles and the
  failing-die hatch were sized in device pixels, so on a 2× display they drew at half their
  intended size and on a 3× display at a third. The ring and quadrant lines' light centre fell
  below one CSS pixel and faded to a faint hairline. They are now sized in CSS pixels, like the
  colorbar's limit markers, so they look the same at every scale and are sharper at higher ones.
  A 1× display draws exactly as before. The die outline stays at its device-pixel width, so
  dense maps on high-DPI screens are not greyed out. Guarded by `tests/strokeScale.test.mjs`.
- **Outlined buttons lost their border in a dark theme.** Summary report, View die list and the
  Test values / Functional CSV buttons drew a fixed dark edge (`rgba(0,0,0,0.30)`) whatever the
  theme, so on a dark panel they had no visible outline while the ring/quadrant toggles beside
  them did. `--wmap-control-border` now falls back to `--wmap-border` — the edge the
  toggles use — so a theme that sets `--wmap-border` gets the same outline on both. With neither
  set the default is unchanged, and a host that sets `--wmap-control-border` is unaffected.
- **Bins and test values given as text built a wrong map without a warning.** A CSV parser gives
  every field as a string. String `x`/`y` already made `buildWaferMap` throw, but a bin of `"1"`
  is not pass bin `1`, so those dies counted as fails and yield read 0 %, and a test value of
  `"0.5"` was not plotted or analysed as a number — with nothing to say so. `buildWaferMap` now
  raises an `input-values-not-numbers` warning (severity `error`) counting text bins, text test
  values and non-boolean verdicts, with an example. The values are not converted: convert them
  and rebuild.
- **Changing the bin palette inside an expanded gallery card did not recolour the map.** A card
  keeps the gallery-wide bin colours so every card agrees, and those took precedence over the
  palette chosen in the card's own menu, so the menu appeared to do nothing — most visibly for soft
  bins. A palette or "Use colours from bin definitions" change made in the card now resolves the
  card's colours from that choice; a change made in the gallery still recolours every card
  together.
- **A card reattached to the gallery kept the view it had while expanded.** Reattaching stored the
  expanded window's options — plot mode, palettes, overlays — as that card's per-card overrides,
  which win every time the card is built. A card switched to soft bins while expanded stayed a
  soft-bin map under a gallery bar and legend strip describing hard bins, and later gallery palette
  changes left it in colours matching no other card. A reattached card now takes the gallery's
  shared options again, like every other card. This also stops reattaching from discarding
  per-card `viewOptions` the host set on the item.
- **A lot report built for wafers without a precomputed summary analysed empty wafers.** The
  report ran its lot analysis on `{ label, wafer, dies, passBins }` pieces, which the analysis
  does not recognise as built maps, so it treated each as a fresh input with no results. The
  report then had no findings, `N/A` per-wafer yields, and a title of "Summary — N wafers"
  instead of "Lot Summary — <lot>". It now analyses the built maps (`renderLotReportHtml`, and
  the gallery's and lot panel's report buttons, which use it).
- **A gallery with a fixed column count left most of the row empty.** Picking 2 columns drew two
  480px cards and left the rest of the row empty, because a fixed column count was still capped
  by die density (since 0.21.1). A fixed column count now divides the full width; Auto keeps the
  cap.
- **`GalleryOptions.columns` was ignored at mount**, so the grid always drew a single column.
  Invalid counts (`0`, negative, `NaN`) now fall back to automatic layout, and fractions round.

### Added

Supported replacements for exports deprecated in 0.30.0 that had no other path. Each deprecated
export's notice names its replacement; the old names are still removed in 0.31.0.

- **Capability, pass rates by recorded verdict, and region yield in the analysis output**
  (API §7.4.1), replacing `buildCapabilityData`, `buildTestPassRateData`/`hasJudgeableTests`
  and `buildRegionYieldData` with the ring/quadrant builders:
  - `stats.capability` — Cp/Cpk/Pp/Ppk per parametric test, computed when per-test statistics
    are (`computePerTestStats`). On a lot summary each wafer is a subgroup, so `stdWithin` is the
    pooled within-wafer stddev and Cp and Pp differ. The chart's normalised five-number fields
    are not included; they are not the test's real minimum and quartiles.
  - `stats.testFlagYield` — per-test pass rate by the tester's recorded verdict — and
    `stats.specVerdictDisagreementDies`, the dies where that verdict and the spec-limit judgement
    disagree. They complement the existing `testSpecYield` and `functionalYield`.
  - `stats.regionYield` — `{ ring, quadrant }` yield with each region's die and pass counts, each
    die judged by its own wafer's pass bins.
  - On `LotStatsSummary.stats`: `capability`, `regionYield`, `testSpecYield`, `functionalYield`,
    `testFlagYield` and `specVerdictDisagreementDies`, all pooled exactly from the wafer summaries
    — counts summed, and capability from each wafer's moments — so a lot analysis given
    `perWaferSummaries` stays cheap. A pooled figure is absent unless every wafer reported it. Lot ring yield is also absent when wafers
    were built with different ring counts.
  - `analyzeWaferLot` now builds a raw `WaferMapInput` once and passes the built map to each
    wafer's analysis.
- **`renderWaferReportHtml(result, summary?)` and `renderLotReportHtml(results)`**, replacing
  `renderSummaryReportHtml` and `renderLotSummaryReportHtml`. They take built maps, so pass bins
  and ring count come from the map rather than defaulting to `[1]` and `4`. They need no DOM.
  The Summary panel's report buttons use them.
- **`binColorsForMaps(results, options?)` and `getBinColors()` on `WaferMapController` and
  `GalleryController`** — the colours the maps draw, for a host's own table, export or chart —
  replacing `resolveBinColors` and `getBinColorScheme`. `binColorsForMaps` judges each map by its
  own pass bins; the gallery's own colouring now goes through the same function.
- **`buildWaferMap({ layout: true, waferConfig, dieConfig })`** — a die layout with no test data:
  every site fully on the wafer (the gross die count), die `(0, 0)` at the centre, counted in the
  configured axis directions. It replaces `createWafer` + `generateDies` + `clipDiesToWafer`, and
  renders like any other result.
- **`stats.spatialPattern` on `analyzeWaferMap`'s result** — the spatial pattern classifier's label,
  confidence and geometry features (failure density overall and at the edge, the failing
  cluster's radial position, eccentricity, linearity, …), replacing a direct `classifyPattern`
  call. It is present for every wafer the classifier can measure, including those labelled
  `'random'` or `'none'`, which raise no finding, so the features can feed a model of your own with
  negative examples as well as patterned ones.
- **`ICONS.collapse` and `ICONS.uncollapse`**, the floating-window header's collapse and
  show-contents icons.
- **`WaferMapController.closeSummaryPanel()` and `GalleryController.setColumns()` are restored.**
  Both were removed in 0.30.0 without a deprecation period. A host needs the first to get the
  map's full width back, for example when loading a new file, and the second to apply its own
  column control or a saved preference without rebuilding the gallery. Closing the panel no
  longer resets the Summary button's notable-findings colour, as the 0.29 version did.

## [0.30.0] — 2026-09-15

### Breaking

- **Bin colour is keyed by bin number again, not by die count.** Since 0.28.0,
  `resolveBinColors` ranked bins by die count and handed out palette colours in that order, so
  a colour meant "the biggest fail bin in this view" rather than any particular bin: two lots
  of one program drew hard bin 7 red in one and brown in the other, and filtering a gallery
  could recolour bins. Industry wafer-map tools key colour on the bin number so engineers can
  learn a program's colours and compare screenshots; wmap now does the same. A pass bin takes
  `pass[(bin − 1) mod n]` and a fail bin `fail[(bin − 2) mod n]`, so bin 1 is the first green and
  bin 2 is red in the default palette. Still pass/fail-aware (a failing bin 1 is never green),
  still honours `BinDef.color`. The slot comes from the number alone, so changing `passBins`
  recolours only bins whose verdict changed.
  - **Soft bins read the palette shifted by half its length**, so hard bin *n* and soft bin *n*
    are different colours by default.
  - **`shared` now reports fixed pairs:** bins whose numbers are a palette-length apart (fail
    bins 2 and 21 in `'default'`, 2 and 16 in `'accessible'`) when both are present, rather than
    "more bins than colours".
  - Same function, same types, different colours for the same input, which is why this is
    breaking. Any host screenshot or test that pinned a rank-derived colour will change.
- **The `passBins` options on `analyzeWaferMap`, `analyzeWaferLot`, `renderWaferMap` and
  `renderWaferGallery` are removed.** Pass bins are set once, on `buildWaferMap`'s input, and
  carried on the result as `WaferMapResult.passBins` (new), which all four read — per wafer in a
  gallery or lot. A second place to set them is how every surface came to judge pass/fail by `[1]`
  (see Fixed), and an analysis override produced a summary whose findings and yield figure used
  different pass bins. A map not built by `buildWaferMap` states them in that same `passBins`
  field. Passing a removed option is a type error; at runtime `analyzeWaferMap` and
  `analyzeWaferLot` ignore it and say so with an `analysis-option-corrected` warning, as they do
  for a stale `ringCount`. To analyse or render with different pass bins, rebuild.
- **Options and methods removed as unused, duplicated or dead.** Found by measuring what tsmap,
  the examples and the library itself actually use; each was either never set by anything, a
  second way to set something that already had one, or accepted and ignored.
  - `RenderOptions`: `minZoom`/`maxZoom` (fixed at 0.4× and 20× of the fitted view),
    `renderTooltip`, `maxSize`, `toolbarControls` (its `'view-only'` value was never used),
    `showPlotModeSelector`, and the top-level `legendPosition` and `fallbackFormat` — set both
    through `viewOptions`.
  - `GalleryOptions`: `cardPadding`, `maxSize` (the density-derived card size cap always
    applies), `showPlotModeSelector`, `legendPosition` and `fallbackFormat` (through `viewOptions`).
  - `WaferMapController`: `setDies` (it replaced dies but not the wafer geometry, so switching
    wafers with it kept the previous wafer's outline — use `setResult`), `setFallbackFormat` (use
    `setOptions({ fallbackFormat })`), `setHelpButtonVisible`, `setTooltipParent`.
    `GalleryController`: `setFallbackFormat`, `setColumns`.
  - `ViewOptions.dieGap` (fixed at 1 mm), `ToCanvasOptions.topClearance` (always passed 0),
    `DieListDisplayOptions.csvFilename`.
  - `AnalyzeWaferMapOptions.includePartial` / `includeEdgeExcluded`: analysing dies that yield
    excludes could only make the findings describe a different population from the yield figure
    beside them. `isYieldEligibleDie`'s own options are unchanged.
  - `fallbackFormat` is now a view preference (`WaferPreferences.fallbackFormat`), reported
    through `onViewOptionsChange` with the others.
  - **Gallery-to-card plumbing is off the public API.** `WaferDisplayState` loses `binColors`,
    `metadataValueOrder` and `lotSize`; `RenderOptions` loses `chromeInset` and `onExpand`;
    `WaferMapController` loses `setSummaryVisible` and `setViewControlsVisible`. The gallery set
    all of them on its own cards, and on a host's map they read as settings a host must supply to
    get a valid map — a lone map resolves its bin colours, metadata order and lot size itself.
    `renderWaferGallery`'s `getOptions()` and `onViewOptionsChange` no longer carry the three
    fields either (`binColors` held `Map`s, which a host persisting its options could not
    serialise). `ViewOptions.binColors`, `.metadataValueOrder` and `.lotSize` for `buildView` are
    unchanged.
- **Ring count is set once, on `buildWaferMap`.** `WaferMapInput.ringCount` (default 4) is
  carried as `WaferMapResult.ringCount`, and the ring overlay, ring findings, Summary panel,
  report and Insights all read it. `AnalyzeWaferMapOptions.ringCount` and the view preference
  `ringCount` are removed: they were two places that had to match, and when they did not, the
  ring boundaries on the map described different rings from the ring findings beside them.
  Validation moved with it — a bad value is corrected and reported in `result.warnings` as
  `analysis-option-corrected`, still with no upper bound. A gallery whose wafers were built with
  different ring counts raises the new `ring-count-mixed` warning; each card and each wafer's
  findings use their own. `ViewOptions.ringCount` (for `buildView`) and `classifyDie`'s option
  are unchanged.
- **`BinColors` has a new required field, `pass: { hard: Set<number>; soft: Set<number> }`** —
  the bins that pass, per type, as `resolveBinColors` judged them. A host that builds a
  `BinColors` by hand must add it; an object without it passed as `ViewOptions.binColors` is
  now ignored and resolved afresh rather than trusted. `binPassSets(dies, passBins)` gives the
  same sets without colours.
- **`WaferMapResult.inference.warnings` is removed.** It has been a deprecated string mirror since
  0.13.5, when `WaferMapResult.warnings` replaced it with the same messages plus a stable `code` and
  a severity. Read `result.warnings`. Internally each geometry advisory now records its code where it
  is detected, rather than having it recovered by matching phrases in the message.
- **`View.colorBySpec` is removed.** Its input option went in 0.21.0; the output stayed, only ever
  equal to `passFailDisplay === 'spec'`. Read `view.passFailDisplay`.
- **`ToCanvasOptions.activeBin`, `.hoverBin` and `.minRightReserve` are removed.** They carry the
  interactive map's own legend highlight, pointer and mode-switch layout state, which a direct
  `toCanvas` caller has none of — the same reason `RenderOptions` already dropped them.
- **`AnalyzeWaferMapOptions` loses its per-analysis switches:** `enableYieldAnalysis`, `enableHardBinAnalysis`, `enableSoftBinAnalysis`, `enableReticlePositionAnalysis`, `enableTestSiteAnalysis`, `enableClusterAnalysis`, `enableAngularAnalysis` and `enablePatternClassification`.
  Each was cheap and on by default; every analysis now runs, and a caller wanting fewer findings
  filters them (`filterFindings`). Passing one from untyped JavaScript is reported as
  `analysis-option-corrected`. The two that cost real time stay: `enableTestValueAnalysis`, and
  `computePerTestStats`, which triples analysis time on a 7,843-die, 50-test wafer (94 ms → 298 ms)
  and so cannot simply always run.
- **`WaferMapController.setExpandVisible`, `setIdentityVisible`, `closeSummaryPanel` and
  `getActiveLegend` are removed.** The first two duplicated the `showExpandButton` and `showIdentity`
  options, and nothing used the other two. The gallery keeps expand-button control internally.

### Fixed

- **A wafer with no die positions covered the Insights view.** In `renderWaferMap`, a
  coordinate-less wafer's "No die position data" summary stayed on top of the chart suite once
  Insights was opened, hiding most of it. A mixed wafer's "+N dies without position data" footer
  did the same. Their z-index beat the Insights layer's. The map view is now hidden outright while
  Insights is open, so nothing inside it can show through, and its controls leave the tab order.

- **Input names removed in earlier releases vanished without a trace.** A plain-JavaScript caller
  still passing `data` instead of `results` got an empty map, and `values` instead of `testValues`
  a map with no test data — no error, no warning, nothing that looked wrong. `buildWaferMap` now
  reports every removed name it finds (`data`, `die`, `stack`, `values`, `TestDef.index`,
  `dieConfig.origin`, `waferConfig.flat`, `reticleConfig.anchor`, `lotStack.aggr`) as a new
  `input-field-removed` warning naming each replacement, in `result.warnings` and on the console.
  It still does not honour them: rename and rebuild.
- **Pass bins given to `buildWaferMap` were used for `result.yield` and nothing else.** The result
  had nowhere to keep them, so every later surface fell back to `[1]` unless the caller repeated
  them: `analyzeWaferMap`'s findings and yield statistics, bin colours and legend order, the
  failing-die hatch, the Summary panel and report, region yield, the Insights yield charts, the
  gallery strip's Yield, and the map's own internal view. A program whose bins 1 and 2 both pass
  therefore showed bin 2 as a failure everywhere except the one yield figure — and the docs
  already claimed `analyzeWaferMap` inferred them from the result. tsmap hit this on every file
  whose pass bins are not just bin 1: it gives each wafer's pass bins to `buildWaferMap` and to
  nothing else. `[1]` is now a default only at `buildWaferMap`'s input; `WaferMapResult.passBins`
  carries the value everywhere after.
  - **A gallery judges each wafer by its own pass bins**, so a lot mixing test programs is
    correct per wafer in cards, strip yield, lot panel, report, region yield and Insights. Hard
    bins that pass on one wafer and fail on another get one colour and one legend row, so the
    gallery raises `pass-bins-mixed` naming them. Yield labels say "per wafer: bin 1 · bins 1, 2"
    when wafers disagree, rather than naming one wafer's set.
  - The report's lot region-yield table and the gallery strip's yield were separate copies of
    the per-die pass rule; both now use the shared ones (`buildRegionYieldData`, `diePassStatus`).
- **A map's bin legend drew its title over the first row when there were many bins.** Rows
  were fitted to the full canvas height and the "Soft Bin"/"Hard Bin" title placed above them
  afterwards, clamped below the toolbar, so a legend tall enough to fill the height had its
  title printed across row one. The title row (and a floating legend's padding and heading) is
  now reserved before rows are fitted; overflow moves into "+ N more" one row sooner.
- **Bin legends list pass bins first, then failing bins by die count**, the order the Summary
  panel, report and Insights pareto already used (`sortBinsForDisplay`). The per-map canvas
  legend and the gallery's legend strip both sorted by bin number, so one lot was listed two
  ways on one screen, and a program with dozens of bins buried its biggest failures.
- **Soft bins were ordered, and the gallery's soft-bin yield was totalled, as if hard pass bin
  numbers applied to them.** The Summary panel, both report bin tables and the gallery strip
  judged a soft bin "pass" by looking it up in `passBins`, which holds hard-bin numbers: soft bin
  1 sorted as a pass and soft bin 100 as a fail whatever their dies did, and the gallery strip's
  Yield read about 0% in soft-bin mode for any program whose passing soft bins are numbered
  differently. They now use the soft bin's own verdict (`BinColors.pass.soft`).
- **A gallery card had no title unless the host passed `label`, and every other surface named
  that wafer differently.** Without `label` the card header was blank, so an engineer could not
  tell which wafer a card showed. The findings list, the lot report, the yield list and the die
  list's Wafer column called it `W3`, a position that reads like a wafer ID and need not match
  the real one; a detached window called it "Wafer map"; and the Insights tab used the wafer ID.
  The wafer ID was on every item. One internal rule, `waferDisplayLabel` (`core/waferLabel.ts`),
  now names a wafer everywhere: the host's `label`, else `wafer.metadata.waferId`, else
  "Wafer 3 (no ID)". Hosts that pass `label` see no change.
- **The gallery's Legend style menu offered per-card legend positions as if they applied to
  a legend nobody could see.** Per-card legends are off by default in `renderWaferGallery`
  (the lot legend strip stands in for them), yet the menu listed the six positions first,
  live, with **Default (right)** ticked, and the **Legend on each map** toggle last. It read
  as though the positions moved the lot strip. The toggle now comes first, and the positions
  follow under **Position on each map**, greyed and unticked, with the reason as a tooltip,
  until per-card legends are on. The single-map menu, which has no toggle, is unchanged.
  The rule is in `makeLegendStyleBtn` (`toolbar.ts`).

### Changed

- **Segments of the gallery legend's population bar are now separated by a 1px gap.**
  Segments are ordered by die count, so any two palette colours can sit side by side, and at
  8px tall the darker ones (black, indigo, dark teal, brown) and the pass greens ran together,
  so the bar read as fewer, wider bins than it held. The gap is transparent, so
  it shows the strip's own background in either theme, and it adds to each segment's 2px
  minimum width rather than eating into it.

### Deprecated

- **`valueToViridis`, `valueToGreyscale` and `getValueColorScheme`**, to be removed in
  0.31.0. Each still works, logs one console notice on first use, and is struck
  through in editors. Use `resolveValueColorFn(name, reversed)` instead:
  `resolveValueColorFn('default')` and `resolveValueColorFn('greyscale')` return exactly the
  colours the first two did. None of the three applies `reverseValueScheme`, so a legend, chart
  or export built on them could show a reading in a different colour from the map.
  `listValueColorSchemes()` gives scheme names and labels.
- **The chart-data builders**, to be removed in 0.31.0: `buildYieldData`,
  `buildYieldDataCombined`, `buildBinParetoData`, `buildBinClusterData`, `buildCapabilityData`,
  `buildTestBoxplotData`, `buildTestTrendData`, `trendCentre`, `buildTestPassRateData`,
  `hasJudgeableTests`, `buildTestHistogramData`, `buildTestHistogramSeries`,
  `buildCorrelationMatrix`, `filterCorrelationMatrix`, `buildScatterData` and
  `buildScatterDataGrouped`. They were made public so a host could draw the Insights charts
  itself, before the Insights tab (`insights: { enabled: true }`) drew them; neither tsmap nor
  any example calls them. Each still works and logs one console notice on first use. There is
  no replacement: if you depend on one, say so at https://github.com/wafertools/wafermap/issues. Their types stay until the
  functions go. `buildFacetTable`, `facetValueOf` and `mergeTestDefs` are not
  deprecated.
- **The low-level drawing pipeline**, to be removed in 0.31.0: `buildView`, `toCanvas`, `createWafer`,
  `generateDies`, `clipDiesToWafer`, `applyOrientation`, `transformDies`, `applyProbeSequence`,
  `generateReticleGrid`, `mapDataToDies`, `isInsideWafer`, `getReticleCell`, `resolveGridPitch`,
  `classifyDie`, `getRingLabel`, `aggregateValues`, `aggregateBinCounts`, `getUniqueBins`,
  `buildHoverText`, `buildMapTitle` and the eight `affine*` helpers. It let a host draw a map without
  `renderWaferMap`; nothing known does — tsmap draws every map through the renderers — and only the
  pipeline example used it, which is removed. The types only the pipeline needs (`ViewOptions`,
  `ToCanvasOptions` and the rest) go with it.
- **Helpers exported by accident**, to be removed in 0.31.0: the region builders (`buildRingRegions`,
  `buildQuadrantRegions`, `buildSectorRegions`, `buildReticlePositionRegions`, `buildTestSiteRegions`,
  `buildRegionYieldData`, `areQuadrantsAdjacent`, `parseRegionKey`, `sectorCompassNames`),
  `classifyPattern`, `visibleFindings`, `computeFunctionalYield`, `resolveMetadataColumns`,
  `discoverDieMetadataKeys`, the report builders (`renderSummaryReportHtml`,
  `renderLotSummaryReportHtml`, `renderFindingsReportHtml`, `openHtmlReport`, `openReportModal`),
  `resolveBinColors`, `getBinColorScheme`, `contrastTextColor`, `getDieTestValue`, `dieHasTestData`,
  `isParametricTest`, `isPositionedDie`, `metadataDisplayValue`, `metadataCategoricalValue`,
  `buildDieListSection`, `DEFAULT_FACET_CURATION` and `STANDARD_WAFER_DIAMETERS_MM`. The library
  applies each itself. Staying, because each carries a rule or a hook a host needs: `getDieKey`,
  `getTestPassStatus`, `diePassStatus`, `isYieldEligibleDie`, `hasPosition`, `filterFindings`,
  `resolveValueColorFn`, `FACET_NONE_VALUE`, `setReportOpener` and `setDetachWindowOpener`. The two
  constants cannot log a notice; the functions do.
- **The 0.31.0 removal is enforced**, not just announced: a test fails once the changelog or
  `package.json` reaches 0.31.0 while any of these exports is still there.

### Docs

- **New example, "Bin colours across a full program"** (`docs/examples/bin-colours.html`).
  A four-wafer gallery over a new generated dataset, `showcase-bin-rich`: 15 hard bins with two
  pass grades and gaps in the numbering, and 32 soft bins numbered under their hard bin. Each
  failure mode has its own spatial pattern. Every other bundled dataset has 2–6 bins, which is
  too few to show how bin colour behaves across a real program. The soft bins deliberately
  outnumber the palette, so the example also shows the `bin-colors-shared` warning. The data
  comes from `scripts/gen-showcase-csvs.mjs` like the other showcase files.

### Internal

- **CI runs once per push to `main`, not twice.** `ci.yml` had its own `push` trigger while
  `deploy.yml`, which also runs on every push, calls it as its gating job, so the same suite
  ran twice in parallel on each commit. `ci.yml` now triggers only on pull requests (and as
  a reusable workflow). `deploy.yml` is therefore the only thing testing pushes to `main`,
  and says so. The README badge now points at `deploy.yml`.
- **The perf suite's ratio tests use the fastest of N runs instead of the median**
  (`fastest()` in `tests/perf.test.mjs`). The two paths in a ratio are timed one after the
  other, so background load inflated them unequally. The value-vs-hardBin check failed an
  `npm publish` at 2.86× on a loaded machine where both paths had slowed about 7×. Absolute
  budget tests keep the median, where a minimum would weaken the guard. The value-mode limit
  stays at 2.5×: measured, the steadier statistic does not buy back enough headroom under
  CPU saturation to tighten it.

## [0.29.0] — 2026-09-12

### Breaking

- **The default value gradient is now Viridis, and every perceptual gradient reads low = dark,
  high = light.** The blue–cyan–yellow–red "thermal" ramp is removed. Like every rainbow ramp its
  lightness is not monotonic — cyan and yellow both sit near peak while blue and red are much
  darker — so two different readings land at the same apparent intensity, and the fast hue turns
  at cyan and yellow draw contour lines that are not in the data. On a smooth parametric map that
  shows up as a bright ring around the wafer centre that no process step put there. Users reported
  exactly this: being unable to judge the difference between two colours that look equally
  "intense". `'jet'` keeps the rainbow family available for anyone who wants it, already labelled
  as such.
- **`viridis`, `cividis`, `plasma`, `inferno` and `greyscale` were registered reversed, and are
  no longer.** Each was `forValue: t => ramp(1 - t)`, putting the *bright* end of the ramp at the
  *low* end of the data, while `default`, `traffic` and `jet` ran the other way. Switching gradient
  therefore inverted the map. On a stacked map the effect was backwards from what the mode is for:
  the healthy bulk of the wafer (fail count 0) rendered as a glowing yellow field and the edge
  ring, scratch or cluster you were looking for became dark specks on it. All five now match their
  matplotlib/seaborn definitions. `tests/colorSchemes.test.mjs` measures L\* across every
  perceptual built-in and fails if a reversal reappears.

  This also corrects the record on the change that made thermal the default in the first place
  (0.14.x, "the reversed-Viridis ramp rendered high values dark purple and low values yellow — not
  intuitive"). The diagnosis was right and the remedy was aimed at the wrong thing: the defect was
  the `1 - t`, not Viridis, and the `1 - t` survived the change that was meant to fix it.
- **The standalone `'viridis'` gradient name is gone** — Viridis *is* `'default'`, labelled
  **Default (Viridis)**. Two menu rows drawing identical maps is the same defect that removed the
  old standalone "Thermal" row. `getValueColorScheme('viridis')` falls back to `'default'`, so a
  persisted `'viridis'` preference still renders Viridis; it no longer appears in
  `listValueColorSchemes()`.
- **`View.reverseValueScheme` is a new required field on `View`.** Code that builds a `View`
  literal must supply it; code that reads one is unaffected.

### Added

- **`reverseValueScheme` (`ViewOptions`, `WaferPreferences`) — flips whichever gradient is
  selected**, offered in the Colour scheme menu as **Reverse gradient**. One flag rather than a
  reversed twin of every ramp: it doubles no menu, and a gradient a host registered itself gets
  the behaviour for free. It is also what makes the direction rule above exception-free —
  greyscale ships low = dark like everything else, and the print habit of "more ink means more" is
  one tick box rather than a documented special case.
- **`resolveValueColorFn(name, reversed)` (`renderer`) — the single read-path for a value
  gradient.** Die fills, the colorbar and the mapless summary's histogram bars each looked the
  gradient up independently; a flag applied at some of them and not others would show one reading
  in two different colours on one screen, with the colorbar — the thing the map is read against —
  the likeliest to be missed. All three now resolve through this. Any host colouring by value
  should too, passing `View.valueColorScheme` and `View.reverseValueScheme` together.
- **`'mako'` value gradient** (seaborn), sampled at nine even stops from
  `sns.color_palette('mako', as_cmap=True)`. The closest thing to Viridis in lightness span, with
  more separation at the top end. Its sibling `crest` was measured alongside it and deliberately
  not added: at L\* ~31 → ~78 against Viridis's ~10 → ~93 it has too little span for a dense die
  grid — on a stacked map a scratch all but disappeared into the surrounding green. Seaborn pitches
  crest at line plots, where mako's dark end gets lost; that is a different job from colouring
  thousands of adjacent dies.

## [0.28.0] — 2026-09-11

### Breaking

- **Bin and value colours are separate preferences; `colorScheme` is removed.**
  `WaferViewOptions.colorScheme` / `ViewOptions.colorScheme` → `binColorScheme` (Hard/Soft Bin maps)
  and `valueColorScheme` (Test Value and the three stacked modes — a stacked-bin map is a value map,
  each position's occurrence rate). The single option was reset to `'default'` on every switch into a
  bin mode (the "not bin-compatible" reset, written out three times), so a value-map choice never
  survived a mode switch and no host could persist one honestly. `View.colorScheme` →
  `View.binColorScheme` + `View.valueColorScheme`. Both are `WaferPreferences`, reported through
  `onViewOptionsChange` with category `'preference'`.
- **`registerColorScheme` / `getColorScheme` / `listColorSchemes` and `ColorScheme` are replaced by
  two registries:** `registerBinColorScheme` / `getBinColorScheme` / `listBinColorSchemes`
  (`BinColorScheme = { label, pass, fail }`) and `registerValueColorScheme` / `getValueColorScheme` /
  `listValueColorSchemes` (`ValueColorScheme = { label, forValue }`). A host-registered bin palette
  now appears in the bin-mode Palette menu — the old menu filtered bin modes by hardcoded name, so it
  never could. `registerBinColorScheme` throws on an empty `pass` or `fail` list.
- **`hardBinColor`, `softBinColor`, `hardBinGreyscale` and `HARD_BIN_GREY` are removed.** They hashed
  the bin number (see Fixed). Use `resolveBinColors`, or `View.binColors` from a rendered map.
- **The `'custom'` pseudo-scheme is gone.** `BinDef.color` is now a layer every bin palette honours,
  on by default; `useDefinedBinColors: false` (Palette menu: *Use colours from bin definitions*) turns
  it off. Definition colours used to apply only while "Custom" was selected, and the gallery switched
  to it only when the host had not passed a scheme — so a host restoring a saved scheme silently
  hid the colours that came with the data.
- **Value gradient names:** `'accessible'` → `'cividis'` (the bin half of the old scheme is now the
  `'accessible'` bin palette, labelled *Colour-blind safe*). `'thermal'` is removed: it had the same
  keypoints as `'default'` — two menu rows drawing identical maps.
- **Bin maps look different.** Both bin palettes were re-selected by measurement and colours are now
  assigned by pass/fail and die count rather than by bin number (see Fixed), so images of bin maps
  will not match earlier ones.
- Insights internals: `InsightsTabDeps.getColorSchemeName` → `getBinColors`;
  `ScatterPanelOptions.colorScheme` → `binColors`; the unused `colorScheme` field is removed from the
  bin-cluster, boxplot, capability, correlation, histogram and region-yield panel options.

### Added

- **`resolveBinColors(dies, options)`** — the one rule for bin colour, used by the map, its legends,
  the summary panels, the mapless footer and the Insights charts. Pass bins (per `passBins`) take the
  palette's pass colours, failing bins its fail colours, each ranked by die count; a soft bin passes
  when every die carrying it passes. Returns `BinColors` (`{ hard, soft, shared }`). Exposed on every
  view as **`View.binColors`**; **`ViewOptions.binColors`** lets a host share one assignment across
  several maps (`renderWaferGallery` does this for every wafer it shows, so a bin is one colour on every card).
- **`diePassStatus(die, passBins)`** (`core`) — the per-die pass rule (hard bin, else soft bin),
  shared by yield, the failing-die hatch and bin colouring.
- **`bin-colors-shared` warning** — raised by the renderers when bins on the bin map on screen share
  a colour (more bins than the palette has colours, or a `BinDef.color` repeating one). A gallery
  states it once for all its wafers rather than per card.
- `tests/binPalettes.test.mjs` re-measures the built-in bin palettes (CIEDE2000, with simulated
  deuteranopia, protanopia and tritanopia) so an edit cannot quietly erode their separation.
- `docs/api.md` now documents `standardDiameters` (§4.1.12) and the metadata helpers
  `metadataDisplayValue` / `metadataCategoricalValue` / `discoverDieMetadataKeys` (§10.1). All
  four were public exports that the reference never mentioned — `STANDARD_WAFER_DIAMETERS_MM`
  since 0.27.0, where it shipped as the documented escape hatch for the new
  `non-standard-diameter` advisory and was therefore undiscoverable outside the source; the
  other three since 0.24.0.
- `scripts/check-api-claims.mjs` now also fails when a public export (per
  `tests/export-surface.test.mjs`'s snapshot, the deliberate record of what is public) is never
  mentioned in `docs/api.md`. The bar is low on purpose — the name appearing anywhere, even in a
  code block, is enough — because this catches exports forgotten entirely, which is the failure
  that actually happened, not how well each one is explained.
- `tests/insightsScopeReconciliation.test.mjs` pins scope-aware test-definition reconciliation in
  **all three** Insights views. The behaviour was already correct; nothing tested it, and the
  whole-load version shipped once before.
- **A boxplot leaf click now does something in a single-wafer render.** `renderWaferMap`'s
  Insights tab passes no `openWafer` — the only wafer there is to open is the one already on
  screen — which left the "Test value distribution" row inert, silently throwing away the other
  half of the click: the selected test. New `InsightsTabDeps.focusTest`, wired by
  `renderWaferMap`, switches the map behind the tab into test-value mode on the clicked test
  and closes Insights. The gallery is unchanged: where `openWafer` exists it wins, since
  opening the wafer already lands it on that test.
  - `BoxplotPanelOptions.openActionLabel` (optional) supplies the wording for both click
    affordances, so the chart says what it will actually do — "click a box to show this test on
    the map" instead of "…to open that wafer". One string, not two, because the hint and the
    tooltip describe one action.
  - `focusTest` is consulted only for a leaf row of the sole item: with more than one wafer on
    screen, "show this test on the map" would show it for a different wafer than the one
    clicked. The trend panel is deliberately not wired to it — it renders an empty state below
    two wafers, so that branch could never fire.
  - Reported against tsmap, where a single-wafer load has exactly this gap; logged there as
    WMAP_ISSUES.md #51.

- `scripts/check-doc-links.mjs` (new, wired into `npm run check`) resolves every internal
  documentation link and fails on a dead one. Zensical has no link validation and no redirect
  map, so a wrong anchor is not an error — the browser lands at the top of the page and the
  reader concludes the docs are wrong about themselves, with nothing in the build saying a word.
  It checks that link targets exist, that every `#anchor` names a heading the Markdown really
  produces (using Python-Markdown's slug algorithm, the one Zensical actually runs — validated
  against a real build at 385/385 anchors), that no two headings in a page slugify to the same
  id, and that every `zensical.toml` nav entry resolves. The hand-written example and demo pages
  are scanned too, which is how `theming.html`'s `../api.html#...` was found: the site serves
  that page at `api/`, so the link had never worked. tsmap carries the same script.

### Changed

- **"Mark failing dies" moved from Colour scheme to Overlays, and both menus gained an action
  to undo themselves.** It was the one entry in Colour scheme that was not a scheme — a marker
  drawn over dies, sitting among mutually exclusive palettes — while its sibling concept, the
  Spec/Test pass-fail display, was already in Overlays. The two are the same judgement about the
  same dies, and splitting them across two menus made neither findable from the other. Overlays
  was already the right home in a second way: it already carries conditionally-disabled rows
  (Reticle grid), so a bin-modes-only entry is not out of place there.
  **Overlays gained "Clear overlays"** — six toggles are tedious to turn off one at a time, and
  the row is greyed when nothing is on, so the menu now answers "is anything active?" without the
  reader auditing every line.
  **Orientation gained "Reset orientation"**, which matters more than convenience: rotation and
  mirroring do not commute (`mirror ∘ rot(θ) = rot(−θ) ∘ mirror`), so a reader who has rotated
  and flipped a few times cannot reliably click their way back. Reset is exactly right, and a
  wafer map read in the wrong orientation is the class of mistake this library exists to prevent.
  Both are greyed at the default state.
  `CheckMenuRow` gained `action: true` for rows that *do* something rather than holding a state.
  The first version of this change shipped them as ordinary rows, which rendered an unchecked ✓
  and announced them to a screen reader as checkboxes that were off. The surface snapshot below
  caught it on its first real use — the diff showed `Clear overlays [unchecked, disabled]`.
- **`scripts/ui-surface.mjs` (new) records the whole interactive surface to a committed text
  file** — `docs/ui-surface.txt`, 117 controls across the single map, the gallery and the Insights
  tab, with every label, accessible name, hint, checked/disabled state and menu ordering.
  `npm run ui:surface` regenerates it; `npm run ui:surface:check` fails on un-recorded drift.
  This library's chrome ships inside other people's applications, and every existing check asks
  whether it is built correctly rather than what it says. Reading the whole surface as one page
  is also what makes duplication and odd ordering visible — those are invisible while each menu
  is only ever seen alone. Not in `npm run check`: it needs a browser and a built `dist/`, like
  `screenshots`.
- **`WMAP_VERSION` and `WMAP_BUILD_TIME` are now public**, from `@wafertools/wafermap/render`.
  They already existed — generated by `sync-version.mjs` on every build — but only reached an
  internal `console.log`. A host embedding this library could tell a user which *application*
  they were running and had no way to say which **engine** was underneath, and "check the browser
  console" is not an answer you can give a fab engineer asking why a map looks wrong. Being
  generated at build time, they describe the bundle actually loaded rather than whatever a nearby
  `package.json` claims — different things whenever a host is linked to a local checkout. tsmap
  shows both in its About dialog from 0.1.34.
- **The docs site gained a light/dark theme, and most of Markdown.** Zensical is bumped
  0.0.51 → 0.0.60 (nine releases; `requirements.txt`, so CI and local builds move together),
  and the config now uses what it offers.
  The find that prompted it: **declaring any `[project.markdown_extensions.*]` section replaces
  Zensical's default set wholesale rather than merging into it.** The config set only `toc` and
  `pymdownx.highlight`, which had been silently switching off `admonition`, `abbr`, `def_list`,
  `attr_list`, `tasklist`, `mark`, `caret` and `tilde` for the life of the site. Nothing
  reported it, because unsupported syntax renders as ordinary paragraph text — it reads as "we
  don't use admonitions here", not as a fault. Verified by deleting the sections, at which point
  `!!! note` and `*[ABBR]:` both started working. The full set is now listed explicitly, with
  that trap written down beside it. (Mermaid was never affected: Zensical renders those fences
  natively.)
  New: a **light/dark/system palette toggle in the header** — the site was light-only, which sat
  oddly beside a library whose entire chrome is themeable and whose own guide had a dark-theme
  bug fixed in 0.26.1. `docs/stylesheets/extra.css` stopped hardcoding three light greys and now
  bridges Material's palette onto wmap's `--wmap-*` custom properties, so **the live wafer-map
  demos follow the theme too** rather than sitting as bright panels on a dark page — the same
  trick tsmap uses for its own 16 themes.
  Also enabled: `toc.follow` and `navigation.top` (a 4,150-line API reference is the case they
  exist for), `navigation.tracking` so a link copied from deep in a page points there,
  `navigation.footer`, `search.highlight`/`search.share`, `content.code.annotate`/`select`,
  `content.tabs.link`, and `content.tooltips` fed by a shared `includes/abbreviations.md` —
  domain terms only (STDF, PTR, Cpk, the bin records), since tooltipping every "API", "UI" and
  "CSV" underlined most sentences and told the reader nothing. The include lives outside `docs/`
  because a snippet inside it is also built as a page of its own.
  Checked rather than assumed: heading ids are byte-identical across the bump, all 670 site
  anchors still resolve, no CLI flag was mangled by the newly-enabled `smartsymbols` (`--tests`
  and friends survive intact), and the dark palette was driven in a real browser.
- **The Quick Start's synthetic-lot generator now has one home.** The same ~20 lines existed
  four times — `docs/quickstart.md`'s copy-paste example, `docs/examples/quickstart-live.html`,
  and a comment-stripped copy inlined in `scripts/capture-definitions.mjs` to shoot
  `quickstart-first-map.png` — all byte-identical, with nothing enforcing it. Editing the doc
  would have left the "open this in your browser" page and the screenshot directly beneath it
  rendering a different wafer from the code the reader had just copied, silently.
  `docs/examples/quickstart-data.js` is now the source: the live page and the capture import it,
  so those cannot drift by construction. The Markdown keeps its inline copy deliberately — the
  snippet promises "copy this into an HTML file, no bundler required", which a local import
  would break — and `scripts/check-quickstart-snippet.mjs` (wired into `npm run check`) holds it
  to the fixture, with `--write` to regenerate it. It also fails if either of the other two
  re-inlines the loop. The refactor is provably inert: `quickstart-first-map.png` re-captures
  byte-for-byte identical.
- **The Quick Start no longer detours into partial-wafer geometry.** The "Partial data needs a
  wafer centre" section — three paragraphs and a second code block, arriving immediately after
  the reader's first successful map — is now a short callout that names the case, names the
  `'partial-coverage'` warning, and links to the guide section that already covers it in full.
  A tutorial's job is the first success; the geometry discussion is a how-to and was already
  written as one. Nothing was deleted, and a "you have now…" line closes the walkthrough.
- **The Developer Guide's sections are no longer numbered.** `## 3. Loading real data from a
  CSV` is now `## Loading real data from a CSV`, and all 42 links that pointed at the numbered
  anchors — plus the `Guide §N` link labels in `docs/examples/manifest.json`, which name the
  section they lead to instead — were moved with it. The numbering was chronological by feature
  addition rather than by reading order, and it was baked into every anchor
  (`#3-loading-real-data-from-a-csv`), so inserting one section silently broke every link below
  it. `check-doc-links.mjs` landed first precisely so this move could be proven complete rather
  than assumed. The API reference keeps its numbering for now — there the numbers are a real
  hierarchical aid, not an accident of ordering.

### Fixed

- **Implausible geometry could hang a render.** `toCanvas` sized its hit-test grid from die size
  alone, so a die size wrong by orders of magnitude — a misread WCR record gave dies ~1e-8 mm
  wide — asked for more cells than an array can hold: every render and resize threw
  `Invalid array length`, and the map never appeared. The grid is now sized by `hitGridDims`
  (internal `hitGrid.ts`), which falls back to the span for non-finite or non-positive sizes and
  caps the grid at max(4096, 4 × dies) cells; a coarser grid only means a hit test looks at a few
  more dies. A non-finite die position no longer indexes cell `NaN`. Found via tsmap
  (WMAP_ISSUES.md #53).
- **"Lot" was used for any set of wafers, including sets spanning several lots.** A gallery or
  `analyzeWaferLot` call covers whatever wafers were passed, but the panel read "Lot Summary —
  26 wafers", yield outliers were "lower than the lot median", the trend chart's reference was
  the "lot mean", reports were titled "Lot Summary" / "Lot Findings Report" and the stacked
  tooltip gave "% of lot" — all over a pooled multi-lot load, or one with no lot ID at all. One
  rule now names the population (`stats/population.ts`): "lot" only when every wafer records the
  same lot ID (`Summary — Lot LOT123 · 13 wafers`, "lot median"), otherwise the wafers
  (`Summary — 26 wafers from 2 lots`, "median of all wafers"). The stacked tooltip reads
  "% of stacked wafers"; two gallery messages became lot-neutral. Public API names
  (`analyzeWaferLot`, `LotStatsSummary`, `lotStack`) keep "lot" in its looser sense — the
  glossary now says so. Also corrected: the API reference and developer guide still described
  the gallery panel's long-gone Lot/Wafers tabs, and called its button "Lot findings" rather than
  **Summary panel**.
- **Different bins were drawn in the same colour.** Soft bins and the Accessible palette hashed the
  bin number into a fixed list, so collisions were certain: among bins 1–16, soft bins 1 and 7 and
  4 and 6 were identical, as were Accessible bins 4 and 5 and 9 and 13, and only 75 distinct colours
  covered hard bins 1–255. The hand-picked hard bins 1–14 came in near-duplicate pairs (1/12 green,
  2/9 red, 5/11 blue…), and bins 4 and 11 were ΔE 1.4 apart for a deuteranope. Colours are now
  rank-assigned from measured palettes: no two bins share a colour until the palette is exhausted,
  and then a warning names them. Default: 3 pass + 19 fail colours, every pair ≥ 16 ΔE00. Colour-blind
  safe: 2 pass + 14 fail colours, every pair ≥ 8.8 ΔE00 under all three simulated deficiencies.
- **Bin colour contradicted `passBins`.** Bin 1 was always green and bin 2 always red, whatever
  `passBins` said — with `passBins: [1, 3]` a passing bin 3 drew orange ("marginal") and a failing
  bin 12 drew green. Pass colours now come from `passBins`, never the number.
- **The soft-bin failing-die hatch marked the wrong dies.** It tested the plotted *soft* bin number
  against the *hard* pass-bin list. It now judges each die by `diePassStatus`, the rule yield uses.
- **`WaferMapController.getActiveLegend()` returned colours the map was not drawing.** It hashed bin
  numbers directly, ignoring the selected palette, so a host legend built from it disagreed with the
  map under any non-default scheme. It now reads the view's resolved colours.
- **`analyzeWaferMap` reported a "correction" for an option that was never set.**
  `{ ...DEFAULT_OPTIONS, ...options }` let an explicit `undefined` overwrite the default, which
  then failed the finite-number test — so the most ordinary thing a host writes (forwarding an
  optional: `{ ringCount: opts.rings }` with `rings` unset) raised an `analysis-option-corrected`
  advisory, and that one is not quiet: it reaches the toolbar's warning indicator and the Summary
  panel's banner. Undefined keys are now dropped before merging, so "not passed" and "passed as
  undefined" mean the same thing. Genuinely bad values are still corrected and still reported.
- **`buildWaferMap({ testDefs: [] })` silently lost every value plot mode** — and every test
  column in the die list. An empty array is load-bearing downstream (`renderWaferGallery`'s
  reconciled "kept nothing", which no fallback may override by discovering bare test numbers back
  from the dies), but from a HOST it just means "I described none", which is the same statement
  as omitting the field. It is now normalised to `undefined` at that one input boundary; the
  gallery's own signal is unaffected.
- **The findings expand chevron stayed painted as hovered** after the first hover:
  `wireControlHover` was called on it twice, and the second call snapshotted the first's hover
  colours as the resting state.
- **Geometry advisories rendered as truncated prose in the collapsed warnings banner.**
  `SHORT_LABEL` still keyed the removed `inferred-pitch` and had no entry for
  `non-standard-diameter` or `diameter-exceeds-die-extent` — the codes that replaced it — so
  every advisory 0.27.0 actually raises fell through to a 57-character truncation of its own
  message. Entries added for all current codes, and a test now checks the table against the
  declared code union so it cannot drift again.
- **The chrome row painted an empty band** above a map rendered with `showToolbar: false` and no
  identity: it is built unconditionally and its own comment claimed it "collapses to nothing when
  it holds neither", but nothing implemented that. It now hides when it holds nothing visible —
  hidden children included, since `setIdentityVisible(false)` hides in place.
- **Gallery metadata-mode colours could disagree with the legend beside them.** Each card
  assigned colours by index into the values on its OWN dies, while the shared legend strip
  ranked the union across every card — so a wafer that never exhibited one category shifted
  every later category up a colour and painted it in the colour the legend gave to another.
  New `ViewOptions.metadataValueOrder` (`{ key, values }`, applied only when `key` matches
  `activeMetadataKey`, mirroring `valueRange`'s `{ test, range }` guard) is forwarded by
  `renderWaferMap` and set automatically by `renderWaferGallery`, so every card colours from one
  lot-wide list. Values a card has but the list doesn't are appended, never dropped.
  - The ordering is now one implementation (`collectMetadataValues`) shared by the maps and the
    legend, and the legend stopped deriving its values with `String(raw)` where the maps use
    `metadataCategoricalValue` — a second divergence in the same place, visible on numeric
    metadata.
  - A standalone `renderWaferMap` is unchanged: with no order supplied it still derives one from
    its own dies, which is correct for one wafer.
- **The histogram resolved an unset "axis includes limits" preference two different ways.**
  Grouped (faceted) treated it as off; ungrouped derived it from the data. The same test with no
  preference therefore included the spec limits in the axis in one view and not the other — the
  range moved under the reader while the toggle stayed put. Both branches now derive it from
  their own population via `shouldIncludeLimitsByDefault`.
- **The histogram's "Clip outliers" toggle did nothing in the grouped view.** It was rendered
  there but `buildTestHistogramSeries` had no way to take a clip range, so the control applied to
  the ungrouped branch only — in exactly the view where one wild reading does the most damage,
  compressing every group's buckets at once. The builder now takes the same optional `clip` its
  ungrouped twin has, with the same contract (narrows where limits widen; no statistic anywhere
  is computed from a clipped population).
- **A grouped histogram could kill the Insights rebuild on a real lot.** The faceted axis range
  used `Math.min(...values)`, which passes every die value as a separate argument; ~250k values
  (25 wafers × 10k dies) throws `RangeError: Maximum call stack size exceeded`. Replaced with
  `testValueExtent`, a loop that also avoids materialising the pooled array. The ungrouped branch
  had the same spread and is fixed too.
- **`summaryPanel: { placement: 'top' | 'bottom' }` clipped its own content silently.** Those
  placements take a fixed 180px band with `overflowY: hidden`, which most wafers' content
  exceeds, so the last visible row was cut mid-line with nothing indicating more existed. All
  placements now scroll, the way `'right'`/`'left'` already did. (Whether this content suits a
  wide-short band at all is a separate open question — see TODO.md.)
- **Closing and reopening Insights no longer discards the shared axis toggles.** `axisPrefs`
  ("axis includes limits" / "clip outliers") lived inside `renderDistributionsSection`, which
  `render()` rebuilds — so a scope change, or simply toggling Insights off and on, silently
  reverted the user's choice to the default. It now sits at tab level beside the selected test
  and group scope, which were already lifted for the same reason. Affects the gallery too.
- **The gallery no longer re-renders every card on every toolbar change.**
  `syncSharedMetadataOrder` pushed `metadataValueOrder: undefined` to each card even outside
  `metadata` mode, and each push costs a full view rebuild. It now returns early when there is
  nothing to change, matching `syncSharedValueRange`.
- **`renderWaferMap`'s Insights view no longer jumps back to the top on reopen.** The tab's
  scroll offset is remembered on close and re-applied over a short window after the rebuild —
  one assignment is not enough, because the cards grow to their measured content over the
  following frames, so the first write is clamped to a container that is still short (212px of
  a requested 300px, measured) and the layout pass can then reset it to 0. A position past the
  target stops the retries: that is the user scrolling, and they own it from then on.
  (Gallery-side, the host page owns the scroller, so there is nothing for the library to
  restore.)
- Corrected `charts/boxplot.ts`'s header comment, which still said click-to-open-wafer was
  unimplemented long after it shipped.

---

## [0.27.0] — 2026-09-09

### Breaking

- **The `inferred-pitch` advisory is removed, and `non-standard-diameter` replaces it.** They cover the two halves of the same risk, and the old one was on the wrong half. A supplied diameter with an inferred pitch raised a warning on *every* build — but that pitch is derived as `diameter ÷ grid span`, which puts the outermost die at ~95% of the radius by construction, so the result is self-consistent and there is nothing to check it against. At full coverage the derived pitch is within ~1%, so the advisory fired mostly on inferences that were fine. Meanwhile the mirror case — a pitch supplied and the **diameter** inferred from the die extent — said nothing at all, despite producing a 210 mm wafer where the truth was 300 mm when the outer third went unprobed, which skews ring membership exactly as a wrong pitch does. Wafer diameters are standardised (SEMI M1: 100/150/200/300 mm and the smaller legacy sizes), so an inferred diameter *is* checkable: landing off that ladder is evidence the probed grid did not reach the wafer edge. Validated across 40 fixtures — 100/200/300 mm wafers, square and rectangular die, 50–94% coverage — the rule produced **no false alarms** (it never flagged an inference that was right) and caught every material error except those landing on another standard size, e.g. a 200 mm wafer at 65% coverage inferring exactly 150 mm; those stay silent, which is no worse than before, when nothing was reported at all. Hosts branching on `w.code === 'inferred-pitch'` will no longer match; the code is gone rather than renamed, because the condition it described is no longer reported.

- **`AnalyzeWaferMapOptions.significanceLevel`, `.minimumEffectSize` and `.minimumRelativeEffect` are removed.** They are internal constants now, as `minimumSampleSize` always was. These decide what *counts* as a finding, so a wrong value did not make the output look different — it made it wrong, and silently: `significanceLevel: -0.2` returned **zero findings across the entire lot**, with no error and nothing in the result to say why, which reads as "nothing wrong with this wafer". None of the three were validated; `minimumEffectSize: -1` and a `significanceLevel` of 1.5 (not a probability) were accepted without complaint. The library already treated this as dangerous for itself — `adaptOptions()` declines to adapt `significanceLevel` internally because it perturbs the multiple-comparison correction unpredictably — while handing the same knob to callers unguarded. The values and the gates they drive stay documented in `docs/api.md` §7.3.2 and the guide, which is what callers actually needed: to understand why a pattern did or did not produce a finding. Passing them from untyped JavaScript no longer takes effect — the value is validated, ignored, and reported (see below). tsmap, the reference integrator, set none of them.
- **`RenderOptions` no longer extends `ToCanvasOptions`, and five of its inherited options are gone:** `topClearance`, `minRightReserve`, `markFailingDies`, `activeBin`, `hoverBin`. All five were **accepted and silently ignored** — `renderWaferMap` overrides them on every draw (`topClearance` is hardcoded to 0, `minRightReserve` is derived from the legend, and the other three are read from `viewOptions` and internal hover state). Verified by instrumenting the draw transform and every text/rect/fill operation, in both value and bin plot modes: setting any of the five changed nothing observable. An option that is typed, documented and ignored is worse than one that does not exist — it costs a caller a debugging session to discover the API lied. The ten that genuinely work (`padding`, `background`, `showColorbar`, `colorbarWidth`, `showAxes`, `showTitle`, `legendPosition`, `legendOffset`, `diePitchMm`, `fallbackFormat`, plus `metadataFields`) are now listed explicitly and stay at the top level, so this breaks only callers of options that never did anything. Listing them also stops future `ToCanvasOptions` additions arriving here by accident; `toCanvas` remains the full low-level surface. They were deliberately *not* moved under a nested `draw` key: grouping would read better but would break every caller of the options that do work, in exchange for tidiness alone.
- **`RenderOptions.showMetadataBadge` → `showIdentity`, and `WaferMapController.setMetadataBadgeVisible` → `setIdentityVisible`.** The bottom-left canvas overlay became a real layout row, so the old names described something that no longer exists. The intermediate `showIdentityHeader`/`setIdentityHeaderVisible` were dropped before release for naming the *container* rather than the content: the chrome row now exists whenever there is a toolbar, so the flag says whether the wafer's identity is shown in it — a content switch, never a layout one. That distinction is what removed the special case where turning the header off would have cost the toolbar its row. Hard renames with no alias: passing an old option is a type error, and at runtime it is ignored.
- **`HoverTextOptions.waferMeta` removed.** The tooltip no longer merges wafer-level metadata over per-die metadata — wafer identity (lot, wafer ID, product, program) is shown once in the identity header, and repeating it on every die tooltip duplicated it. Only `die.metadata` now appears there.
- **Removed the `--wmap-bar-fill-muted` theming token.** It existed solely to grey the fill of below-median wafer-yield bars, an encoding that has been removed (see below). Nothing paints it any more, and a documented theming token a host can set to no visible effect is worse than an absent one. `--wmap-bar-fill` is unchanged.

### Added

- **`diameter-exceeds-die-extent` — the missing half of the geometry check.** `geometry-conflict` asks whether the dies *fit* the supplied wafer. Nothing asked whether they *fill* it, so a diameter that was too large passed in complete silence — and it is not harmless: ring bands are equal-radius, so an over-large wafer crushes dies into the inner rings and empties the outer ones. Measured on a 300 mm / 10 mm map whose dies reach 141 mm: at a supplied 400 mm the outermost ring is already empty, at 600 mm two rings are, and at 3000 mm — a plausible typo for 300 — **all 621 dies land in ring 1** with three of four rings empty and no advisory of any kind. Ring, quadrant and edge findings then describe the assumed wafer rather than the probed area. Now raised as a `warning` (the dies are drawn correctly; it is the analysis that is distorted) below 75% fill. The threshold is calibrated, not guessed: every dataset in this repo's own docs sits at 96–100%, a full wafer with edge exclusion reaches ~94% and a reticle-complete map ~83%, while the first ring empties at ~71%. A genuinely partial map is indistinguishable from an over-large diameter — `partial-coverage` will not separate them either, since it keys on an off-centre centroid and a centred small disc is geometrically identical to a tiny full wafer — so the message names both causes rather than guessing. **Not** raised when `waferConfig.center` was supplied, since anchoring the centre is the documented way to position deliberately partial data and is the very remedy `partial-coverage` recommends; nor below 20 dies, where the extent is not evidence about the wafer and ring analysis (`ringCount` × `minimumSampleSize`) cannot report anything anyway.
- **`standardDiameters` — the standard wafer-size table is overridable.** `STANDARD_WAFER_DIAMETERS_MM` (exported) defaults to `[100, 125, 150, 200, 300]`, and `WaferMapInput.standardDiameters` **replaces** it — spread it to extend (`[...STANDARD_WAFER_DIAMETERS_MM, 76.2]` for a line running 3-inch), or pass `[]` to disable the check for genuinely non-standard substrates. The list size is a real trade-off, measured across 63 fixtures: every entry is a value a wrong inference can hide behind, every omission wrongly accuses someone running that size. `[200, 300]` catches the most (37 of 39 errors) but produces 12 false alarms; the inclusive default trades 6 catches for 9 fewer. The default is deliberately the safer end because it reaches the hosts who never set the option — a 150 mm line would otherwise see a permanent warning on correct data with no visible way to clear it — while a fab that knows it runs only 200/300 can say so and get strictly better detection.
- **A dedicated Insights example, and `InsightsOptions.defaultOpen`.** The Insights tab is the largest feature surface in the library — thirteen panels across three views (yield by wafer, hard-bin pareto, parametric pass rate, ring and quadrant yield and two summary tables; capability, box plots, histogram and wafer-to-wafer trend; correlation matrix and scatter) — and it had **no example page and not one entry in the examples index**. It appeared on 2 of 20 pages, always as a secondary tab on a page about something else. `docs/examples/insights.html` is now that page, listed at the head of "Analysis and layout" and in the docs nav. Its lot is chosen so every panel has something true to show rather than a picture of noise: eight wafers across two process corners (a ~50 mV Vth split) so the trend chart separates and "Group by" has a real axis, an NE→SW gradient that couples Idsat and Vth so the correlation matrix is not a grid of near-zeros, spec limits on all three parametric tests so capability has Cpk to report, and a functional continuity test so the pass-rate panel ranks parametric and functional tests side by side. New `insights.defaultOpen` lands the reader on the charts instead of the map — symmetric with `summaryPanel.defaultOpen`, honoured by both `renderWaferMap` and `renderWaferGallery`, and off by default since a map-first page should stay map-first (it also pulls the lazily-imported chart chunk on load rather than on first click).

- **The examples now show the analysis features, not just the map.** They were written before findings, the summary panel and the Insights tab existed, and never caught up: of 20 live examples, 9 computed stats, 5 docked the summary panel and **2** enabled Insights. Someone evaluating the library saw a coloured circle. The focused pages are deliberately left lean — a page about retests or colour schemes is worse with a panel competing for attention — but the pages that do the convincing are fixed: `comparison.html`, `showcase.html`, and the five where a map is the main subject (`interaction`, `display-control`, `test-values`, `metadata-mode`, `quickstart-live`) now compute stats and dock the panel. Now 15 / 11 / 4.
- **`comparison.html` demonstrates the differentiator instead of tabulating it.** The page exists to argue for wafermap over Plotly, ran to 807 lines, and compared *render timings* — with "findings", "Insights" and "analysis" appearing six times in the whole file, as feature-table text. Speed was never the argument: Plotly draws a scatter perfectly well. A new section below the benchmark renders the same wafer with `analyzeWaferMap`, the summary panel and the Insights tab, and states the measured analysis cost against the build/render timings shown directly above it. It is deliberately **outside** the timed path — folding an analysis pass into the benchmarked side would be measuring two different jobs and calling it a race.
- **`showcase.html` enables the Insights tab**, which it had never shown despite the index describing it as "all features in one page" — the largest feature was the missing one. It is also promoted from an unlisted footer link ("good for a quick overview *once you know the basics*") to a **Start here** section at the top of the examples index and into the docs nav, reframed for someone deciding whether the library fits rather than someone already convinced.
- **The offline examples package ships the geometry sidecars.** `manifest.json` drives both the index and the downloadable archive; the six demo CSVs it lists now carry their `.meta.json` alongside, so the offline copy renders the same real 200–300 mm wafers as the hosted pages rather than falling back to inference.

- **Demo data now carries its own geometry, so no example renders a dimensionless wafer.** Every CSV under `docs/data/` and the four `showcase.html` scenarios ship a `<name>.meta.json` sidecar holding `waferConfig`/`dieConfig` plus the bin names, units and spec limits a flat die CSV has nowhere to put. Before this, a demo loading `dummy-fulldata.csv` got a wafer **29.83 across with 1×1 dies** and `diePitch.units: 'normalized'` at 0.4/0.5 inference confidence — the relative die positions were right, so the map looked fine, but the stated diameter was fiction and every millimetre-denominated feature (edge exclusion, die pitch, physical ring widths) was meaningless. The generators always knew the real numbers — `gen-showcase-csvs.mjs` builds each dataset from an explicit `radiusMm` and pitch and clips in millimetres — they simply never recorded them. All eight now resolve at 1.0/1.0 confidence with real diameters (150–300 mm) and real die sizes (2×1.5 mm to 10×10 mm). `showcase.html` loads the sidecar for its demo scenarios and falls back to inference for a user-uploaded file, where the geometry genuinely is unknown.
- **The showcase demo data had dies overhanging the wafer boundary.** Introduced when the scenarios were given real geometry: the generator clipped die *centres* to the radius, so the far corner of every outermost die crossed it. A probed die is by definition a real prober position and therefore fully on the wafer, so an overhanging one is a contradiction — and `buildWaferMap` reported it correctly as `geometry-conflict` on all four scenarios. It was invisible beforehand only because no geometry was declared and nothing could check it. The clip now allows for the die half-diagonal.
- **The showcase scenarios were 221 dies on a 17×17 grid; they are now ~1,250 on a real 200 mm wafer at 5 mm pitch.** At 221 dies each die was 0.45% of the wafer, so every yield figure moved in half-percent steps — far coarser than any real map, and coarse enough to make the region statistics the page exists to demonstrate look arbitrary. `generate-demos.js` derives the grid from `WAFER_DIAMETER_MM`/`DIE_PITCH_MM` rather than a hardcoded radius, and its header comment (which claimed 150 mm at 10 mm pitch) is now the value actually used and emitted.
- **Spec limits, tester verdicts and a functional test in the CSV demos.** Limits were the gap that mattered: no CSV dataset had any, so no CSV-backed demo could show spec-limit colouring, out-of-spec markers or the pass-rate pareto. Limits are set from the distributions each generator actually produces — near the tails, giving 0.6–17% of dies out of spec depending on the dataset — because a limit nothing violates demonstrates nothing and one everything violates is no better. A first pass invented plausible-looking limits in SI base units against data stored in the column's own unit (µA, MHz, mA) and put **100%** of three datasets out of spec, which is what prompted measuring first. `showcase-wide-die.csv` additionally gains a `CONTINUITY` column (a functional test — `testType: 'F'`, a verdict with no measured value, 97.4% functional yield) and a `VTH_FLAG` column carrying the tester's own recorded verdict, guard-banded tighter than the spec limit so the tester flag and the spec judgement disagree on a few dies — the case `passFailDisplay: 'test'` exists to expose.
- **`quickstart-live.html` now declares its geometry**, with a comment explaining that inference is a fallback rather than the norm: it is the page that teaches the API, and it was demonstrating the dimensionless path. `mixedwm38.html` and `real-data.html` deliberately still infer — they load public research benchmarks (MixedWM38, WM-811K) that carry grid indices and no physical wafer size, so inference is the honest answer and a declared diameter would be a fabrication.

- **Every numeric analysis option is now validated, and corrections are reported.** A value outside the range that can produce a meaningful analysis is clamped to the nearest usable one and surfaced as a new `'analysis-option-corrected'` `WaferWarning` in `summary.stats.warnings[]` — the channel the toolbar indicator and Summary-panel banner already read, so a misconfigured analysis announces itself instead of returning a confident wrong answer. `ringCount` must be a whole number ≥ 1 (`0`, `-3` and `2.7` were all previously accepted, the first two silently removing every ring finding); `sectorCount` must be 4, 8, 16 or 32; non-finite values fall back to the default. The now-internal statistical thresholds are validated on the same path, because a plain-JavaScript caller has no type checking to stop them passing the removed options. **There is deliberately no upper bound on `ringCount`:** a cap looked obviously right — "rings thinner than a die" — and measuring it said otherwise. At `ringCount: 40` on a 561-die wafer the ring findings still carry 16–148 dies each, because the minimum region size already rejects anything too small to test and adjacent regions merge; and a die-count-derived cap rejected `ringCount: 3` on this repo's own 28-die test wafers, which produce correct findings. The gate that matters was already there.
- **`StatsFinding`, `StatsSummary`, `LotStatsSummary`, `View`, `WaferMapResult` are now fully documented** — every field carries a doc comment, where `StatsFinding` previously had 9 of 11 undocumented. It is the type an integrator reads to build their own findings UI, and the one place a wrong reading means misreporting a wafer. `effect.relativeDelta` in particular is now explicit that it is a **ratio, not a percentage** — 1.0 is a doubling — since it is the field behind the gate whose documentation was wrong for three months (below). `stats.adjustedPValue` now says plainly that it, not `pValue`, is what the significance gate uses. `View`'s doc records that `dies` and `hoverPoints` are index-parallel, which is the invariant the highlight-offset fix earlier in this release depended on.
- **Integration guidance for `enableTestValueAnalysis` — the cost, and who decides.** The option's cost was documented per *wafer* (~130ms worst case, "still fast"), which is not the unit anyone decides at: a host runs analysis over a lot, where the same linear scan reaches 1.9s / 6.7s / 9.7s on 5–25 wafer lots at 30–100 tests, and did not finish inside two minutes at 25 × 500. `docs/performance.md` gains a lot-scale table and the single coefficient that spans both (~1–2µs per wafer × die × test, enough to predict "instant or not" before running it), plus the pattern the new `FindingsNotice` enables — run it when the estimate is small, offer it with its price when it is not. `docs/api.md` §7.3.1 is a new section framing the two options actually worth a decision, and states plainly that being off by default is not a recommendation to leave it off: an integrator who never enables it ships a Findings list that silently omits a category. Previously the docs left only two postures, both wrong for someone — leave it off and hide the findings, or turn it on for everybody and make large lots feel like a hang.

- **`FindingsNotice` — a host row at the top of the Summary panel's Findings section**, for stating that a category of finding is *absent* and offering to compute it. New optional `findingsNotice` render option on `renderWaferMap`/`renderWaferGallery`, a `setFindingsNotice(notice)` method on both controllers, and the `FindingsNotice` type exported from `/render`. The row carries a `message`, an optional `detail` (normally the size of the job and its expected cost) and an optional `actionLabel`/`onAction` pair; omit the pair for a message-only notice. It renders **above** the severity filter row, and — the load-bearing case — it makes the Findings section render at all when `findings` is empty, since a lot whose only findings would have come from the skipped analysis is exactly where returning `null` would have hidden the offer to run it. Motivated by a real gap in tsmap: wmap's expensive regional test-value pass (`enableTestValueAnalysis`) is off by default, and the only way to turn it on was a checkbox in a host menu — so a reader looking at a Findings list had no signal that a whole category had been skipped, and no reason to go looking for the control. Advertising a control cannot fix an invisible absence; the notice states the gap where the gap is. wmap deliberately never raises this itself: only the host knows what it chose not to compute and what recomputing would cost. The treatment is quiet by design — `buildWarningsBanner` owns the loud one, and a notice competing with it for alarm would misrepresent "some analysis is optional" as "something is wrong".

### Fixed

- **Withholding was undone by its own success: when every test was withheld, three call sites discovered the withheld numbers straight back from the dies.** `buildDataModeEntries`, the stacked-value builder and the die list each fall back to reading bare test numbers off `die.testValues` when they are given no test definitions — right when nobody described any tests, catastrophic when reconciliation deliberately kept none, because it re-offered exactly the numbers that had been ruled incomparable, labelled "Test 1001", and pooled one lot's nanoamps with another's millivolts under them. The cause was an ambiguous `undefined`: the gallery's reconciled list returned `undefined` for an empty result, conflating "nobody supplied defs" with "reconciled to nothing". Those are now distinct — `undefined` still means the former and still permits discovery, an empty array means the latter and no fallback may override it. `buildWaferMap` passes `testDefs` through without normalising, so a host that supplies none is unaffected; a host that explicitly passes `[]` is now taken at its word.

- **A finding's click wrote the gallery-wide active test with no reconciliation check at all.** Findings come from per-wafer analysis, which correctly reads each wafer's own definitions — so a `leakage` finding raised on one lot's wafers carries test number 1001, and clicking it switched *every* card in the lot to test 1001, including lots that call 1001 `vth_n_mV` in millivolts. Every other surface consulted the reconciled list; this one wrote the value directly and bypassed all of them, so the original bug remained reachable through the Findings panel. A finding now switches the whole gallery only when the population agrees about that test; otherwise it switches only the wafers the finding names — which come from files that do agree — and restores them when the finding is cleared. A withheld test on a finding that names no wafers leaves the plot mode untouched rather than defaulting to the lot-wide switch. The scoping is arguably right regardless of collisions: a finding about three wafers switching all forty-seven was always over-broad.

- **The plot-mode menu now names a test's wafer coverage when it is not lot-wide** (`idsat_p_uA — 13 of 47 wafers`). A gallery's active test is lot-wide but a test is not: across a mixed load a test number can exist in one lot and nowhere else, and picking it rendered every other card empty with no explanation. It is at its most confusing exactly when reconciliation has withheld the numbers the lots *share*, leaving the menu offering the ones unique to a single lot.

- **Withholding a colliding test number was evaluated over the whole load, which punished the wafers that agreed.** Reconciling test definitions across every loaded wafer at once means one disagreeing file can withhold a test from all the others: given six lots where four define test 1001 identically and two differ, 1001 was withheld from everyone — so the four perfectly comparable lots lost their shared tests, and the only tests left standing were those unique to a single lot, which is the one thing that cannot be compared with anything. Loading more data made Insights emptier. The Findings panel, which is per-wafer and correctly uses each wafer's own definitions, meanwhile carried on reporting findings for tests Insights would not chart — two surfaces silently disagreeing about what exists.

  Distributions now reconciles over the population **in scope** rather than the whole load. With a group selected there is no collision to resolve — within one lot a test number does identify one test — so every test returns with its own file's name, unit and limits; "All groups" still withholds, because pooling one lot's `vth_n_mV` with another's `leakage` under one number genuinely is meaningless. When anything is withheld the section now says how many, which numbers, and that choosing a single group brings them back, instead of leaving a short list unexplained. Overview and Correlation still reconcile over the whole population — Correlation has its own per-panel restrict dropdown that would need the shared scope control to benefit.

- **The Insights tab now has ONE group scope, in the tab bar, applying to every view.** "Group by" says what the axis is; a new **Show:** control beside it says how much of that axis you are looking at, and every panel in Overview, Distributions and Correlation receives the population it names — including the reconciled test list, so narrowing to one lot brings back every test the whole-population merge had to withhold. Narrowing collapses grouping entirely: a scoped population arrives at each panel with `groups` undefined, so the compare-the-groups machinery (pooled overview rows, clustered bars, overlaid series) simply does not apply and each panel renders its ordinary ungrouped view. That removes a tier of conditional behaviour rather than adding one. The gestures that already meant "narrow to this group" — clicking a group's box in the boxplot to drill, the histogram's legend, the boxplot's Back button — now move the shared scope instead of a private copy.

  This replaced the per-panel copies, including two that carried the same latent bug: `renderCorrelationPanel` silently restricted itself to `groups[0]` exactly as `renderCapabilityPanel` did, with no "all groups" option to return to and nothing on the card naming the group it had picked — so grouping a six-lot load reduced the correlation matrix to one lot without saying so. Both panels lose their `groups` option outright rather than keeping a typed one that no longer does anything. The withheld-tests note also moved to tab level, since all three views can now be withholding.

- **Grouped, the three Distributions panels showed three different populations at once, and nothing said so.** Capability, the boxplot and the histogram each held a private group state with a different default: capability silently restricted to `groups[0]`, the boxplot opened on a pooled overview of every group, and the histogram overlaid them all. So the moment "Group by" was set, a six-lot load produced a capability chart describing one lot next to a boxplot describing all six — and because the cross-panel link broadcast the selected *test* while nothing broadcast the *group*, clicking a test in capability handed the boxplot the right test against the wrong lot. Capability's default was the worst of it on its own: a chart captioned as the lot while drawing one sixth of it.

  The three now share one group scope (`activeSectionGroup`/`selectGroupEverywhere` in `insightsTab.ts`), exactly as they already shared the selected test and the axis toggles, via a new `makeLinkedGroupSelect` built on the same asymmetry `makeLinkedTestSelect` relies on — `set` adopts a broadcast without firing `onUserChange`, so a scope change cannot bounce back on itself. **The default is now all groups, not the first one.** Each panel still renders the scope the way that suits it, which was never the problem: capability narrows to it, the boxplot drills into it (its click-a-group's-box and Back affordances are unchanged — they now move the shared scope instead of a private copy), and the histogram emphasises it against the others rather than filtering, because an overlaid comparison of every group is that panel's whole job. Wafer-to-wafer trend stays outside the scope, as it already stood outside `groups`: its x axis is the population's own slot order, and restricting it would remove the drift signal the chart exists for.

- **Every cross-wafer surface borrowed ONE wafer's `testDefs` and applied it to the whole population.** `TestDef.testNumber` identifies a test *within a test program*, but seven call sites — the Insights tab, the lot Summary panel, the exported lot report, the data-mode menu, the shared active-test resolution and the stacked-value cards — each took the defs from `items.find(it => it.testDefs?.length)`, one arbitrary wafer's list, and applied its names, units and spec limits to every other wafer's values. Across a load spanning more than one test program that is not a labelling slip: die values are keyed by test number, so a number meaning `vth_n_mV` (260–380 mV) in one lot and `leakage_nA` (0–5 nA) in another had the two pooled into a single distribution, normalised against whichever limits arrived first, and drawn under whichever name arrived first. Observed live: a box plot of nA readings titled `vth_n_mV` with a borrowed `USL 380` line across it, process capability reporting a **Ppk of −1489**, and drilled-in maps showing every die out of spec. Three further failures fell out of the same rule — mislabelled axes and colorbars, and tests present only in the non-first wafers missing from every selector, because the list was one item's array rather than a union.

  Replaced by `mergeTestDefs` (new, exported from `/stats`), which unions every test number across the population and reconciles the defs describing it. **An absent field is "not stated", never a disagreement** — mixing a file that carries limits with one that does not is legitimate and merges silently, the stated value winning. Only two *stated and different* values conflict, in two tiers: distinct names, distinct units or a parametric/functional disagreement mean different measurements sharing a number by accident, so the test is **withheld** from every cross-wafer surface (code `test-def-collision`, severity `error`); the same measurement held to different limits keeps the test and its pooled distributions — the values are comparable — but drops both limits, so capability, spec yield and the limit lines are withheld rather than guessed (code `test-limit-conflict`, severity `warning`). Both reach the toolbar indicator and Summary banner through `collectWarnings`, so hosts get them with no code change. Limits compare on a relative tolerance rather than `===`, so a float32 STDF limit and a float64 CSV one cannot manufacture a false conflict; names compare trimmed and case-insensitively, so `TEST_TXT` drift cannot withhold data. `analyzeWaferMap` is untouched and stays per-wafer against that wafer's own defs, which is why single-wafer views never had this bug.

- **`docs/guide.md` carried the same stale thresholds as `api.md`, and had drifted further.** Its effect-size gate still quoted the pre-`955ebc9` `minimumRelativeEffect` of 0.5 ("50% above or below background") alongside a `minimumEffectSize` of 0.15, and its severity table repeated all four superseded numbers. Its worked example was wrong in the same direction as `api.md`'s: a 2-point elevation on a 2% background was offered as "clearly significant", when at the current 1.0 gate it only just clears. Corrected, with a 4-point example that clears comfortably and the marginal cases stated. `tests/docsThresholds.test.mjs` now checks both documents — fixing one while leaving the other only moves the problem.
- **`docs/api.md` documented statistical thresholds the code stopped using three months ago.** `955ebc9` (v0.12.8, 2026-06-02) retuned every gate and the docs kept the old values — *partially*, so the page mixed old and new with no way to tell which was which: `minimumEffectSize` was documented as 0.15 against an actual 0.20, the severity ladder's four numbers were all one step stale (`unusual` 0.25/2.0× vs an actual 0.30/2.5×, `notable` 0.15/1.0× vs 0.20/1.5×), and the prose described the relative gate as "a 50% elevation" when the default has been 1.0 — a doubling — since the same commit. The worked example taught the rule backwards: it offered "a 2 percentage-point increase on a 3% background is a 67% relative elevation — statistically and practically significant", but 0.67 clears neither gate, so the library emits nothing for that case. It now uses a 4pp example that does pass, and keeps the 2pp case as an explicit counter-example. This matters more than a typo: a reader consults this section to work out why a wafer did or did not produce a finding, and it was giving the wrong answer. New `tests/docsThresholds.test.mjs` reads the numbers out of both `analyzeWaferMap.ts` and the prose and fails when they diverge — confirmed to catch drift in either direction — and checks the worked example's own arithmetic and that it clears the gate it claims to illustrate.
- **The map canvas's type hierarchy was restored after being flattened onto one size.** Making canvas text follow `--wmap-font-size` (previous commit) routed four of the five map-canvas tokens through a bare `fontPx()`, collapsing three deliberate tiers into two: `MAP_SUBTITLE_FONT` 11px→12px, `SCALE_NOTE_FONT` 11px→12px, `COLORBAR_LABEL_FONT` 10px→12px, `AXIS_TICK_FONT` 10px→11px, leaving the map title and its own subtitle separated only by weight. `fontPx` already took a tier delta and the previous change used it for exactly one token. All five now carry the delta that reproduces their original size at the default 12px base — title `fontPx()`, subtitle and scale note `fontPx(-1)`, colorbar and axis ticks `fontPx(-2)` — so the sizes and their relationships are exactly what they were, and a host moving `--wmap-font-size` still moves the whole scale together. `BIN_ROW_H` (20→17), `BIN_LEGEND_W` (124→110) and `BIN_LEGEND_W_COMPACT` (72→64) revert with them: they had been enlarged only to house the bigger text, and the bin legend's reserve comes off the wafer, so this returns 14px of width to the map in bin mode. `fontPx`'s doc comment now records that `-2` is deliberately not a DOM tier — it is the map canvas's plot-coupled floor, text that annotates dense data rather than chrome, which is why it sits below the 11px DOM minimum. `UI_STANDARDS.md`'s canvas-text rule is amended to state the three tiers and to say plainly that collapsing them was tried and what it cost.
- **Colorbar tick labels were truncated at the right edge of the canvas.** The band to the right of the bar was two constants — `labelGap = 20` and `rightReserve = colorbarWidth + 28`, giving 31px of label room — set in April when `COLORBAR_LABEL_FONT` was a hardcoded `10px`, where the widest typical label measured ~20px. Making the font themeable via `fontPx()` (default 12px) in the previous commit widened every label by ~20% without widening the band: measured against the reported data (`correlated.csv`, `test_002`, range 48.3–77.0), the widest label ended **0.3px** short of the canvas edge at 12px and overran it at 13px; negative values, which carry a minus sign, overran by 3.5px at 12px and 0.7px at 11px. That change did grow `BIN_ROW_H` 17→20 to compensate for the taller font — the vertical compensation was made, the horizontal one missed. The band is now measured from the text that will actually be drawn: the tick formatter is derived before the reserves are computed and `measureText` sizes `colorbarLabelGap`, keeping every label `COLORBAR_EDGE_MARGIN` (6px) clear of the edge. The tick set itself cannot be used for this — it depends on the bar height, which depends on this reserve — so the endpoints bound the width instead, plus the negated larger magnitude when the range spans zero, which is the only case an intermediate tick can be wider than both endpoints. `COLORBAR_LABEL_GAP_MIN` floors the result at the old 20px, so layouts whose labels already fitted are unchanged to the pixel. `COLORBAR_TICK_LEN`/`COLORBAR_LABEL_PAD` replace the literals that were repeated across the three `fillText` call sites. **Consequence worth knowing:** with wide labels the value-mode reserve can now exceed `renderWaferMap`'s `colorbarReserve` floor (still `colorbarWidth + 28`), which exists to hold the wafer the same size across value/bin mode switches — so a wafer with very wide value labels will draw slightly smaller in value mode than in bin mode. That is the intended trade: a marginally smaller wafer over clipped numbers.
- **The finding/selection highlight was drawn offset from the dies it belonged to.** `renderWaferMap` cached the auto-fit viewport in `fittedViewport` the first time it was computed and only recomputed it at three explicitly enumerated points: a `ResizeObserver` callback, `resetZoom`, and a plot-mode change. But that cached value is the geometry `currentViewport()` hands to `drawSelectionOverlay`, to click hit-testing and to the hover tooltip, while the map itself is drawn with the viewport `toCanvas` computes for *that* draw — so the two silently diverged whenever anything else moved the fit. The fit origin and scale depend on the colorbar/bin-legend reserve, the legend position, the axis gutter and the legend row count, none of which resize the canvas, so the `ResizeObserver` never fires for them; and because that callback is delivered asynchronously, even a genuine resize left a window in which any render — including the one triggered by clicking a finding — drew the map at the new size against the old cached fit. Reported from a maximised window: clicking a ring finding highlighted an annulus sitting outside the wafer entirely. Measured drift in the regression fixture is 62px for merely hiding the legend and 427px across a maximise. `render()` now re-reads `result.viewport` on every fitted draw, which closes the whole class rather than adding a fourth invalidation point; the plot-mode special case has been removed, since it was one instance of the general bug and would additionally strand `fittedViewport` at `null` while zoomed. **This was a regression, not an original defect:** the condition read `if (!fittedViewport || !viewport)` until 0.9.0 (2026-05-03, `ef34a3c`) — the `!viewport` leg meant "this was a fitted draw", i.e. exactly the invariant restored here. That commit dropped the leg (likely because the no-op `if (!viewport) viewport = null;` beside it made the condition look redundant) and, in the same hunk, added the plot-mode invalidation to patch the one symptom it immediately caused. Plot mode being the commonest way to move the fit is why the remaining routes — legend toggle, legend reposition, and the async-`ResizeObserver` window on a resize — stayed latent for four months. The fix is not a plain revert: the old condition also assigned while zoomed when `fittedViewport` was `null`, writing the zoom into the fit baseline; the `viewport === null` guard closes that too. The assignment is guarded on `viewport === null` so a zoomed draw cannot overwrite the zoom clamp's fit baseline. The same staleness affected which die a click or hover resolved to, not just the highlight.
- **The floating toolbar lay across the docked Summary panel.** It is `position: absolute; right: 4px` inside `mapBox`, and `mapBox` contains the panel as well as the canvas — so the toolbar was pinned to the far edge of the whole row and covered **296px of the panel's 300px width** at the same height, putting the panel's scrollbar and top border under the buttons. The previous mitigation padded the panel's *content* down, which is why the heading cleared the toolbar while the scrollbar did not: a scrollbar is drawn on the element's full height, padding included. The panel is now pushed down by a `marginTop` — moving the whole box, border and scrollbar included — rather than the toolbar being inset by the panel's width. Insetting was tried first and cost map area: it narrows the space the toolbar has to lay out in, and in a 700px drilldown modal that tipped it onto a second row, taking 28px of height off the wafer. `marginTop` leaves the toolbar's width untouched, so it stays a single row at every width tested. `paddingTop` is still correct for a panel docked *above* the map, where the toolbar genuinely overlays it and moving the box down would only open a gap. The toolbar stays a child of `mapBox` rather than moving into `canvasWrap`, because it must paint above `insightsTab.el`, which covers `mapBox`.
- **Cards, the gallery grid and the Summary panel sat flush against the window edge.** A card is a bounded surface: with no gutter you see three of its borders and the screen edge standing in for the fourth, which reads as clipped rather than deliberate — and on the Summary panel, which carries `RADIUS.container` and its own shadow, the rounded corners were visibly flattened against the edge. `UI_STANDARDS.md` already required this gutter, but only for overlay `contentWrap`, so nothing in the main view was covered by it. Three different insets were in use and none of them was the edge gap: the Insights bands at 10px, the gallery bar at 4px, tsmap's own toolbar at 12px. There is now one `EDGE_GUTTER` (12px, `SPACE.xl`) shared by the Insights content, the gallery card grid and the docked Summary panel — on the scale, at the tight end of the 12-24px page-margin range the major design systems use, and matching the host toolbar directly above so cards line up with it. It is applied to the **container**, never as a margin on the cards: `gap` already spaces cards from each other, so a card margin would double up between neighbours while leaving a single gap at the outside. In the gallery the body row's own `gap` was removed for the same reason — the grid carries the gutter on both sides and the summary panel docks against one of them, so the two stacked into a 24px trench between the cards and the panel while every other edge used 12. Letting the grid's padding serve as both the window gutter (free side) and the panel separation (docked side) makes those equal without a rule that has to know which side the panel is on or whether it is open. The gallery's sticky header takes the gutter on its wrapper rather than on the toolbar and legend bars inside it: both are bordered, radiused surfaces in the same card language as the wafer cards, and both stayed flush while the cards moved in — padding the wrapper insets both at once and keeps its background full-bleed, which is what hides content scrolling under a sticky bar. The wafer map canvas is deliberately excluded and stays full-bleed — map area is the priority, and in a narrow drilldown modal the panel's gutter already costs ~12px of wafer diameter.
- **The floating toolbar and the docked Summary panel sat on different right edges.** The toolbar was `right: 4px` while the panel took `EDGE_GUTTER` (12) — two bordered, radiused surfaces stacked at the same edge and 8px apart, which reads as a mistake rather than as two things measured from different frames.

  Both now use a new `MAP_CHROME_INSET` (4px), so they align on one column and the toolbar is symmetric on both axes. The first attempt aligned them the other way, moving the toolbar out to `EDGE_GUTTER`, and that was the wrong direction: `EDGE_GUTTER` is the gap between a bounded surface and the edge of the REGION it lives in, and a map's own chrome is already inside such a region — in a gallery card the card supplies that outer inset, so a second 12px within it stacks two gutters, which `UI_STANDARDS.md`'s own gutter rule forbids. On screen it was a toolbar standing 12px off the side of a card while sitting 4px off its top. The alignment was the right goal; the value was wrong, and the panel was the piece that should have moved.

  `createSummaryPanelEl` therefore takes its inset as an explicit parameter with **no default**: `renderWaferMap` docks the panel inside `mapBox` and passes `MAP_CHROME_INSET`, `renderWaferGallery` docks it at the gallery's own edge and passes `EDGE_GUTTER`. A default here is a guess about context, and guessing wrong produced both this bug and the one after it — a blanket change to the small inset then put a 4px gutter on the gallery's panel, where 12 belonged.

  `maxWidth` is derived from the inset (twice it) rather than the bare `calc(100% - 8px)` it used to be, which silently encoded the old 4px and would have let a wrapped second row overhang the moment that changed. `TOOLBAR_BAND_CSS` is unaffected — still 4 + 30 + 4.

- **The bin legend did not react to the pointer, though its rows are clickable.** Hovering a legend row set `cursor: pointer` and showed a tooltip but changed nothing on the map, so the row looked inert — the same "promises interactivity, does nothing" defect the new hover rule catches in the DOM, except the legend is drawn on the CANVAS, where no `:hover` can reach it and no static check can see it. `ToCanvasOptions` gains `hoverBin`, drawn as a row background fill from a new `hoverRow` colour on `CanvasTheme` (reading the existing `--wmap-bg-hover` token, so it follows the host's theme). Deliberately a different channel from `activeBin`, which marks the SELECTED row with an accent border and bold label: selected and pointed-at must stay tellable apart, and a row that is already active does not take the hover fill on top. `renderWaferMap` tracks the hovered row and redraws only when it CHANGES, never per pointer sample — the whole canvas is repainted, measured at 0.4-3.2ms on a 1050px map, which is affordable once per row crossing and would not be per mousemove. Cleared on pointer-leave, since the move handler stops firing at the canvas boundary.

  Both legend layouts needed it. The grid legend and the floating/compact one are separate draw blocks that both push into `binLegendRows`, so both are hit-testable; fixing only the first left the feature looking completely dead, because the floating variant is what a single map usually renders.

- **`binCluster` and `testPassRate` were the same chart written twice; they now share `groupedBarPlot.ts`.** Identical `CLUSTER_GAP`/`SUBBAR_GAP`/`SUBBAR_HEIGHT` constants, an identical `plotMetrics()`, an identical `subBarAt()` differing only in whether it called the index `bin` or `row`, and an identical draw loop down to the order the hover highlight is painted in. The duplication was legible in the comments themselves — binCluster's read "same fix as charts/testPassRate.ts" and testPassRate's read "see binCluster.ts", each pointing at the other for the reasoning. What the two genuinely differ in is data, not drawing: bin counts normalise to the chart's largest count while pass rates use a fixed 0-100% axis (a 99% and a 98% test must not both draw a full-width bar), a pass rate can be "nothing measured" where a count cannot, and the trailing column is a count in one and a percentage in the other. All three are now inputs. Both callers also built their own 10px legend swatch, a further copy of the colour key the suite had just standardised; both now use the shared chip.

- **A canvas primitive.** Every chart opened its draw with the same eight lines — backing store at `cssW * dpr`, CSS size, `getContext`, `setTransform`, `clearRect`, default font and baseline, `resolveChartCanvasColors` — which is one place per chart to read the DPR from the wrong window (eight of ten did), to forget `setTransform` after a resize, or to clear in device pixels rather than CSS ones. `prepareCanvas(canvas, card, cssW, cssH)` returns a cleared, scaled context and the resolved theme; all eleven chart modules use it, and `setTransform` no longer appears in any of them.

- **Eight of the ten chart panels read `window.devicePixelRatio` — the opener's, not their own.** A chart card can be reparented into a detached popup, and that popup can sit on a display with a different pixel ratio, so the canvas backing store was sized for the wrong screen: a blurry or mis-scaled plot, visible only on a multi-monitor setup. `trend` and `testPassRate` had each independently worked out that they should resolve the card's own view, which is the usual sign the knowledge wants one home — it is now `chartDpr(el)` in `chartShell.ts`, used by all ten. A ninth site turned up in `renderWaferGallery`'s composite image export, which had the same bug for the same reason. `check-overlay-conventions.mjs` gains a rule for it, alongside the existing bare-`document.head.appendChild` one it belongs beside.

- **`chartFillHeight` measured its siblings with `offsetHeight`, so every margin was invisible to it.** The canvas was handed more room than actually remained and overlapped whatever sat above it. This was the THIRD appearance of that omission — `applyCanvasFlow`'s callers and the histogram's own `siblingH` were the first two, both fixed the same day — so it is fixed here, in the helper every chart shares, rather than a third time at a call site.

- **Every chart drew the "colour that stands for a series" differently, and the two clickable legends were the same control built twice.** The histogram tooltip used a 9px rounded square written as an HTML string, the scatter legend a 9px circle written as a style object, and process capability an 11px bordered square dimmed to 0.75 opacity — each defensible alone, and collectively a key that changed appearance as a reader moved between charts. There is now one `chartSwatchCss`: 10px, pill, full strength, with a single `outline` variant because capability needs "no spec limits" to read as absent rather than as another colour.

  The clickable legends went further apart than that. The scatter's category filter and the histogram's group emphasis do the same thing — click a colour to narrow the plot — and differed in every particular: a pill with a border versus no border at all, the shared swatch versus a 10px square, `wireControlHover` versus a `filter: brightness(0.94)` that is invisible on a dark theme, and 0.35 versus 0.45 dimming. Both are now one `makeSeriesLegendItem`.

  **Both had also carried "selected" on the `background`, which cannot work here.** `wireControlHover` owns `background` and `color`: it snapshots a resting pair on first hover and restores it on mouseleave, so hovering a chip *before* clicking wiped the selected look, and hovering a selected one left the look behind after it was switched off — chips displaying a state they were not in, which is exactly how it appeared on screen. Selection now lives on `borderColor` and `fontWeight`, neither of which hover touches, so the two cannot reset each other; weight also means the cue is not colour alone. An earlier attempt used a `box-shadow` ring, which failed differently: box-shadows paint outside the layout box, so `applyCanvasFlow` never counted it and the ring was clipped.

- **The plot overlapped the legend it sits under.** `applyCanvasFlow` was passed `legend.offsetHeight`, which excludes margins, so the canvas began at the legend's content edge and any margin on it became overlap — 8px of the scatter's chips were painted over, and giving the legend the breathing room it needed made it worse. It now takes the ELEMENT and accounts for margins; the histogram's own `siblingH` had the same bug and the same fix.

- **Picking a test in one Distributions chart left the others showing a different one, and the trend chart's own selector could get stuck.** Only the capability chart ever broadcast a selection; choosing a test in the boxplot, histogram or trend told nobody, so four panels on one page silently disagreed about what they were displaying. Worse, `setTest` in boxplot and histogram synced their control (`select.value = …`) while trend's did not **and could not** — it appended its selector without keeping a reference, so being driven from a sibling moved its data and left its control naming the previous test.

  All four are now linked through `makeLinkedTestSelect`, which owns the active test, the guard against an unknown or unchanged one, and the control sync. Its `set()` deliberately does not fire `onUserChange` — that asymmetry is what lets panels drive each other without a broadcast bouncing back, and it previously existed only by accident, because nothing broadcast at all. Capability joins as the fourth: it used to broadcast a selection and never show one, and now marks the active column with an accent rule at the plot base — a different channel from hover's background fill, so "pointed at" and "chosen" stay tellable apart.

- **The axis toggles were the same linked state, written a third time.** `axisIncludesLimits`/`clipOutliers`, a `syncAxisToggles` building the same two toggles, and a byte-identical `setAxisPrefs` existed separately in the boxplot, histogram and trend. Now one `makeLinkedAxisPrefs`. This one was not misbehaving — but only because those three happen to rebuild their toggle row on every redraw, so an externally set value is re-rendered as a side effect. The test selector was built once and never re-synced, and that is the entire difference between the two. Neither arrangement was a decision.

- **Four cross-file clones removed, and a check added that can actually find them.** Two were correctness risks rather than untidiness: `clusterDetection` and `patternClassification` each had their own 8-connected flood fill (now `stats/connectedComponents.ts`), so the same wafer could report a cluster in one place and no pattern in the other; and the Summary panel and the exported report each pooled per-wafer functional yield (now `poolFunctionalYield`), which are the two places a reader would naturally compare. The other two: the Overlays menu rows built identically by the map and the gallery (`overlayMenuRows`/`anyOverlayActive`), and the WAI-ARIA roving-focus keyboard handler written twice (`wireListNavigation`) — thirty duplicated lines guarding one line of genuine divergence, that a searchable list must not steal focus from its own search box.

  `check-clones.mjs` (both repos, wired into `check`) finds these. It compares SHAPE, not names: identifiers and literals are normalised away and equal-length token windows matched across files. That matters because the name-based alternative cannot see them — run an inventory of declared methods over `binCluster.ts` and `testPassRate.ts` as they were, ~200 lines of shared structure, and it reports one row, `onSaveImage`, because every other identifier differed. Validated by firing on that historical clone, on a deliberately renamed copy, and — within a minute of being wired in — on a regression of its own author's making, when a stray `git checkout` silently reverted one of the extractions above.

  Its limit is worth stating: it finds code that was copied and renamed. It does **not** find the same idea written differently, and reports clean on the three chart swatches that were exactly that. Those were only caught by budgeting the visible output, which is the other half of the same job.

- **`UI_STANDARDS.md` is now partly enforced rather than entirely asserted.** The contract kept being written down and then *asserted* to be met — which is how a gutter rule added in this same release was broken within the hour by the element that had held the gutter before it moved. `check-style-scales.mjs` (both repos) gains two rules, inside the existing checker rather than as new scripts, since the repos have enough of those: a **budget on distinct off-scale spacing literals** (a ratchet at today's count — 4 here, 6 in tsmap — to be lowered as they are resolved, never raised), and a **focus-ring rule** requiring `outline: none` to carry a focus-specific reason in an adjacent comment. Both scan through a new quote-aware comment stripper, because a comment in `chartShell.ts` quotes `outline: none` while explaining its removal, and an unguarded scanner reads the explanation as the offence — the same shape as the `check-button-styles.mjs` regex that stopped at a `;` inside a CSS string and pronounced everything clean. Only literals at a style site count against the spacing budget, so naming a value once with its derivation (`EDGE_GUTTER`, `TOOLBAR_BAND_CSS`) is invisible to it while a bare `44px` at four call sites is not — the incentive pointing the way the standard already asks. `UI_STANDARDS.md` now states which rules are enforced and which are only prose, instead of implying full coverage.

  **Every budget is now zero**, not headroom. The spacing and radius rules were introduced as ratchets sitting at whatever count already existed (4 off-scale spacing values here, 6 in tsmap, plus stray radius literals) because snapping them changes appearance. All are now snapped to the scale: `3px`→`4px` (die-list cells), `5px`→`4px` (histogram legend swatch margin), `14px`→`12px` and `20px`→`24px` (guide TOC bar and column gap), `14px`→`12px` (warnings panel), and both `3px` guide radii to `RADIUS.control`. One deliberate exception remains and is documented in the check itself: the `2px` rounding on the histogram's 9x9 legend swatch, which is not a control, a container or a pill, and to which `RADIUS.control` would read as very nearly a circle — the "aligns to something rather than carrying rhythm" case the standard allows.

  Two further rules followed: a **radius budget** (a literal at a style site invents a fourth role beside `RADIUS.control`/`.container`/`.pill`) and a **hover rule** (`cursor: pointer` promises interactivity, so an element that never visibly reacts reads as dead). Values that already *were* a role were converted rather than admitted — `4px` → `RADIUS.control`, `50%` → `RADIUS.pill`, both rendering identically — so only genuinely off-role literals remain in the budget. The hover rule found **18 real sites in wmap and 10 in tsmap**, including the Summary panel's collapsible section headers and the Insights tab buttons, all of which are clickable and inert on hover; those are budgeted rather than fixed, since giving them hover states is a visible change and its own decision. **Every site the hover rule found has since been wired**, so that budget is now zero in both repos rather than left as headroom. In wmap: the Summary panel's collapsible section headers, finding rows, detail button and both chevrons; the severity filter chips (which also gained the `data-on` flag so an active chip keeps its own background instead of being flattened by hover); the Insights tab buttons; the segmented control's selected segment; `makeToggle`'s label; the gallery's metadata title and expand button; the map's clickable footer and expand button; and all four of the overlay's header buttons — two of which (`maximize`, `close`) the check found only after it learned to resolve a shared style object to its consumers.

  A later edit to the hover rule spliced out the focus-ring and radius REPORT blocks entirely — both rules kept computing their results and then silently discarded them, while the summary line still printed their counts, so the checker looked fully armed while two of its five rules were dead. Found by re-running the acceptance test for every rule rather than only the one being edited, which is now the rule: a checker change is not done until all of its rules have each been shown to fail on a planted defect.

  Both new rules passed a planted violation when first written, and were fixed only because the acceptance test exists: the focus rule could not fire at all — its justification window included the offending line, which necessarily contains the word "outline", so every violation excused itself — and before that, a bare mention of `UI_STANDARDS` anywhere nearby was enough to exempt a suppression.

- **Insights spaced every band identically, so nothing said which of them belonged together.** `rootEl` used one `gap: SPACE.lg` between the identity strip, the tab bar and the content — equal spacing that reads as three unrelated bands, with the tabs in particular floating between two identical gaps rather than looking attached to the content they switch. Reported as the controls having lost their relationship to the content, and separately as too much air between the strip and the tabs; both are the same cause. The uniform gap is gone: the strip and the tab bar are now tight to each other (`SPACE.xs`) as one header block, and the break from that block down to the content is several times larger. The contrast is what carries the grouping — no single value can, at any size. Written up in `UI_STANDARDS.md` alongside the gutter rule.

- **The gutter was horizontal only — surfaces still butted against the top of the view, and the Insights rule ran past it.** The gallery's sticky header and the Insights root are each the first thing in their view, so in a host that gives the map area no padding of its own (tsmap's `#map-container`) they sat directly against the host's own toolbar, two bordered surfaces with nothing between them. Both now take `EDGE_GUTTER` on top as well; on the sticky header that padding doubles as the band of its own background that keeps cards from touching the bar once they scroll under it. Separately, the Insights tab rule is that element's own `borderBottom`, so it spanned exactly as wide as the element — the tabs sat inside the gutter while the line ran straight past it to both edges. It takes the gutter as `margin` rather than `padding`, which shortens the rule itself so its ends land on the same column as the card borders above and below. Tab labels then sit at gutter + the buttons' own padding, the same place a card's text sits, so the view reads as two consistent columns: structural edges on the outer, text on the inner.

- **The Insights identity strip was indented relative to every card below it.** The Lot/Product/Program line carried a 10px `BAND_INSET` while the chart cards were flush at 0, so the two never shared a left edge. Both now take `EDGE_GUTTER`, as do the tab buttons — whose horizontal padding is what insets the first tab's label, and so has to match or the tab row lands on its own edge. The bands themselves stay full-bleed so the tab bar's `borderBottom` still spans edge to edge; only their content moves in. That is also why the gutter went on `bodyEl` rather than on the scroller or the Overview grid: `bodyEl` holds whichever sub-tab is active, so one value covers Overview, Distributions and Correlation, while padding an ancestor would have pulled that full-width divider in from both sides.
- **The gap under the toolbar was two and a half times the gap above it.** The clearance was 44px against a toolbar sitting at `top: 4px` and 30px tall — 10px below, 4px above — and the eye reads a control and the space beneath it as one shape, so the toolbar looked mis-set rather than bedded in a band. It is now `38px` = `4 + 30 + 4`, the same inset repeated. The value was also a bare literal at four call sites; it is now one constant, `TOOLBAR_BAND_CSS`, carrying its derivation. It deliberately sits off the `SPACE` scale, which `UI_STANDARDS.md` permits for a value aligned to another element rather than carrying rhythm — here the total is off-scale but every part of it is on-scale.

- **The Insights tab's pickers (test, wafer, "Group by", findings filters) ignored host theming entirely.** They were native `<select>` elements, and WebKitGTK — the Linux Tauri WebView a host like tsmap runs in — paints the closed box with native GTK chrome regardless of `CLR.*`, while the *open* option list is OS-drawn in **every** engine, so no CSS reaches it anywhere. An earlier pass applied `appearance: none` to win back the closed box; that could never touch the popup, which left these as the one part of an embedded map unable to follow its host's theme (tsmap has sixteen). All three builders (`makeTestSelect`, `makeWaferSelect`, `makeLabeledSelect`) now share one themed picker, `makeListSelect` — a trigger button plus a popup `listbox`, generalised from the long-list combobox that already backed `makeTestSelect` past `MENU_SEARCH_THRESHOLD`, so the searchable and short-list paths are one implementation rather than two. `styleNativeSelect` and its hand-drawn arrow SVG are gone. `makeWaferSelect` returns `HTMLElement & { value: string }` rather than `HTMLSelectElement`; every in-tree caller only ever set `.value` or `.style.display`, and none of the three is exported from the package, so no public API changes. **Hosts driving these in automation must click the trigger and the option row instead of setting `select.value` + dispatching `change`** — `data-wmap-select` still marks the same control, now on the trigger button.
- **Option rows suppressed their own focus ring.** The long-list test combo set `outline: 'none'` on each row and repainted the row background on `focus` instead, so keyboard focus and mouse hover were indistinguishable and a host's own `:focus-visible` styling could not reach the rows. Rows now keep the browser ring, and the background changes on hover only. This is the shared contract now written down in `UI_STANDARDS.md` ("Option lists and menus: one visual contract"), which both this library and tsmap follow: `listbox`/`option` roles for value pickers, roving `tabIndex = -1` so the engine draws the ring, and exactly three visual states — selected, hover, focus — with no hand-drawn focus indicator in any widget.

- **Two demos shipped data that did not fit the wafer they declared, and one shipped a wafer that was not round.** Both came from the same arithmetic mistake, made independently in a fixture generator and in a demo: clipping a die grid to a circle by testing each die's **centre** against the wafer radius. The part of a die that leaves the wafer first is its outer **corner** — √2/2 of a die further out at 45°, not half a die — so a centre-based clip lets corner dies protrude. `metadata-mode.html` put 7 of its 76 dies past a 90 mm edge (worst corner 50.9 mm against a 45 mm radius) and `docs/data/dummy-fulldata.csv` put 8 of 665 past 300 mm; wmap raised `geometry-conflict` on both, correctly, against the library's own shipped demos. `scripts/gen-dummy-fulldata.mjs` now clips at `Math.SQRT1_2`, and `metadata-mode.html` tests the die corner directly, in the same terms wmap checks, with the wafer and die size declared **once** and used for both the clip and the render config so the data and its geometry cannot disagree again.
- **`comparison.html` was rendering an elliptical wafer.** It had been given a hardcoded 5 × 5 mm die to silence an `inferred-pitch` advisory, but WM-811K's grid is **58 × 53, not square**, so a square pitch squashed the map to a 1.10 aspect ratio — and supplying a pitch suppressed the very advisory that would have said so. That fixture ships no die size, so any pitch written there is invented; it is back to declaring the diameter alone, where wmap derives the pitch per axis and shrinks it until every probed die fits. The map measures 285.0 × 284.6 mm (aspect 1.002) again. The `inferred-pitch` advisory it raises is honest and, since the severity change in this same release, only a warning — which is what made the hardcoded pitch unnecessary in the first place.
- **The Summary panel's bin breakdown ignored the map's plot mode.** Which bin type it showed was chosen by data presence (`hasHbin ? 'hard' : 'soft'`), so any wafer carrying both hard and soft bins showed a *hard*-bin breakdown no matter what the map displayed — the panel silently describing a different population from the one on screen. It now follows `plotMode` (`hardBin`/`stackedBins` → hard, `softBin`/`stackedSoftBins` → soft), falling back to whichever type has data, with a Hard/Soft selector in the section header to override. `maplessSummary.ts` already derived this correctly from the plot mode; all three call sites now agree.
- **Below-median wafer-yield bars were greyed with nothing on screen saying so.** The muted fill was a colour-only encoding (WCAG 1.4.1) whose only explanation — a median marker — was a 1px 50%-opacity hairline drawn *underneath* the bar fill, invisible on every above-median row. The median split also flags half of every lot by construction, including lots where every wafer is within a point of the others. Bars are now a single colour, the median marker is legible against both the fill and the empty track, the median is named in the section title, and genuine outliers (Tukey: below `Q1 − 1.5 × IQR`, only when there are ≥5 wafers) are labelled "low outlier" in the row text, which survives greyscale.
- **Two different yield percentages sat in the lot panel with no way to tell them apart.** "Mean wafer yield" is an unweighted mean of per-wafer yields; the bin breakdown's pass-bin row is a die-weighted share of the pooled population. They agree only when die counts are even across the lot, and both rendered as a bare percentage. The card now reads "unweighted, per wafer" and bin bars are titled "% of dies (N=…)".
- **The lot panel never stated its population.** It showed a wafer count and a percentage over an unnamed set of dies. It now reports dies analysed and excluded, from `StatsSummary.stats.analyzedDies`/`.excludedDies`.
- **A merged hard/soft bin finding printed the same bin term twice.** "hard bin 3 (Fail (multi)) and soft bin 3 (Fail (multi)) (same dies)" — three nested parentheses restating one fact. When the two bins share a number and a name the term is now factored: "hard bin and soft bin 3 (Fail (multi)) (same dies)". Differing names still print both labels in full.
- **`tests/summaryPanel.test.mjs` passed the precomputed bin counts into `buildBinSection`'s `colorScheme` slot**, so both sides of "precomputed counts produce the same text as the raw-scan fallback" fell through to the raw-die scan and the assertion compared the fallback with itself. The precomputed path it exists to cover was never exercised.
- **The user guide claimed yield, bin breakdown, region yield and per-test statistics had moved out of the panel into the Insights tab.** They had not; all four are rendered by `renderWaferSummaryContent`. Section 6 now documents the panel as it actually is.

- **The single map's Insights view hid a toolbar whose space it was still reserving.** Opening Insights hid the whole toolbar band on the grounds that it held "one duplicate button" — but `insightsTab.el` reserves `TOOLBAR_BAND_CSS` (38px) at its top precisely so a toolbar can sit over it, and that reservation stayed. The band was therefore still costing its full height with nothing drawn in it, so the space the hiding was meant to save was never actually saved. The toolbar now stays visible while Insights is open, at zero additional height, carrying the map-specific groups hidden exactly as before.

  This fixes the real complaint, which was not vertical space but a control that moved: the way out of Insights was the toolbar's icon toggle at the top-right in map view and a "‹ Map" tab at the top-LEFT of the chart suite in Insights, so the one control a user needs when they are lost changed both position and appearance at the moment they needed it. It now holds one corner in both views.

  **The identity header stays visible in Insights too, and that is load-bearing rather than cosmetic.** The header is an in-flow sibling *above* `mapBox` while the toolbar is absolutely positioned *inside* it, so hiding the header let `mapBox` rise by the header's height and carried the toolbar up with it — out of the map and into the reserved band, a whole row, on every single switch. Making the toolbar persist without this fixed the horizontal position and left the vertical jump, which is worse than either alone: the control now stayed on screen while visibly hopping between rows. Keeping the header also settles the other half of the problem, that this wafer's identity moved between a header row and the chart suite's own strip; it is now in one place in both views, and the tab's strip is switched off for this host (`showMetadataStrip: false`) so the two never both render — the arrangement `renderWaferGallery` already used, for the same reason.

  The back tab and the tab row's Help are now passed only as **fallbacks**, when the toolbar cannot carry them (no toolbar, a `view-only` toolbar, or `showHelpButton: false`). Passing them unconditionally alongside a persistent toolbar put a second way back and a second Help in the tab row — the duplication that hiding the toolbar had been introduced to avoid. `renderWaferGallery` still passes both: its own toolbar continues to hide, and that view is being looked at separately.

- **Expand is back in the toolbar, and the metadata header carries identity only.** Expand had been moved onto the identity header on the reasoning that the header now existed and could be made to resemble a gallery card's. That was opportunistic rather than functional, and it cost more than it looked: the header had to mount for a wafer with **no metadata at all** just to give the button somewhere to live, and hiding the header in Insights (metadata is shown there in the tab's own strip) silently took the view-level Expand with it. Expand is a view control — "give this more room" — and now sits with the other view controls, restored to the exact position, separator and `makeBtn` call it had before the move. The header mounts only when there is metadata to show, and has lost the bottom rule that made it read as a card header: a gallery card's rule divides a header from a body inside a bordered tile, and a single map has no tile to divide.

- **Expand now works in the Insights view, on the whole chart suite.** It had been hidden there because the expand modal could not carry that view: it reparented the canvas (or the canvas+summary-panel wrapper) and the toolbar as two separate roots, and `insightsTab.el` is a *third* sibling inside `mapBox` — so moving the canvas out took the map and left the charts behind, while moving the charts instead left the modal blank the moment you switched back to the wafer view inside it. Neither root owned the view.

  `mapBox` does, and it is now the single reparent target. It already contains the canvas, the summary-panel wrapper, the toolbar and the Insights overlay, so whichever view is showing travels into the modal and both keep working there — including toggling between them inside it. It also deletes the special-casing the two-root shape needed: `mapBox` is already `position: relative`, so the toolbar's absolute corner resolves against it exactly as it does in the page, with no `contentWrap` fix-up and no pairing of roots for the reparent helper's stale-reference guard to reason about. The `E` shortcut is live in both views for the same reason. `maxSize` is lifted while expanded and restored on close — the cap now travels with the element being moved, where before it was left behind on `mapBox`.

  **The modal is sized to its content.** The default box is a 700px square, which is the right shape for a circular wafer and the wrong one for the chart suite: the suite lays out ~1330px wide in a normal page, so opening it in that square made Expand produce a view *smaller* than the one it expanded from, with the charts reflowing into a narrower column. Insights now opens at `min(96vw, 1600px)` × `min(92vh, 1000px)`; measured on the docs demo the charts go from 503px to 776px tall.

  That size is a new optional `boxSize` on `OverlayOptions`/`ReparentModalOptions`, and adding it turned up a latent bug: `min(90vw, 700px)` was written as a literal in **three** places — the base box style, the un-maximize restore, and the un-minimize fallback — so any box opened at a non-default size would have snapped back to 700px square the first time it was maximized or minimized and restored. The size is now derived once and used by all three.

- **The gallery's Insights view now has the same chrome as the single map's.** The Insights suite is the same content in both — the same tabs, the same charts, differing only in how many wafers fed it — but the frame around it was arranged differently depending on which view opened it. The gallery hid its whole toolbar on entering Insights, so the toggle did not merely move: it became a different control, an icon button on the bar turning into a "‹ Gallery" text tab at the far left of the chart suite, while the identity strip jumped 58px up at the same moment, leaving nothing on screen still enough to anchor the change. The bar now stays, carrying the toggle and Help, and the back tab and the tab row's Help are gone — with the bar always present here (there is no option to suppress it, and the toggle exists whenever Insights does) a back tab could only ever be a second control doing the bar's job two inches to the left.

  Unlike `renderWaferMap`, hiding this bar did reclaim real space — 58px, measured — because the gallery's bar is in flow, where the single map's Insights view reserves its toolbar band whether or not a toolbar is in it. That cost is accepted deliberately: it is the same 46px the grid view already pays, so neither view is the odd one out, and it buys a control that stays where the user left it.

- **A map's chrome inset is stated by the caller (`RenderOptions.chromeInset`), because it depends on context.** Giving every map `EDGE_GUTTER` put a second full gutter inside gallery cards, which already supply their own — a toolbar standing well off the card's side, and precisely the two-gutter bug `MAP_CHROME_INSET` had been introduced to prevent. That constant was deleted earlier in this release on the grounds that the Summary panel was its only remaining user; that was wrong, because the chrome row inherited the same context problem the moment it started carrying the toolbar. It is restored, and the choice is now explicit: the default `EDGE_GUTTER` is right for a standalone map, where the map area IS the region, and `renderWaferGallery` passes `MAP_CHROME_INSET` for its cards. The detached-window path deliberately keeps the default — there the map is the region again.

  The same value is threaded to the docked Summary panel and to the Insights tab's own content (a new `contentInset` dep, defaulting to `EDGE_GUTTER` for the gallery), so the identity, the toolbar, the tab bar and the panel all sit on one column in whichever context the map is rendered.

- **The chrome row had no top inset**, so in a host that gives the map area no padding of its own (tsmap's `#map-container`) it butted straight against the host's own toolbar — two bordered surfaces touching. It now takes `chromeInset` on the top as well as the sides, matching the top gutter `renderWaferGallery`'s sticky header has always had for the same reason.

- **Geometry and analysis advisories in the Summary panel are collapsed by default.** They explain a geometry decision and its consequences, so the prose is necessarily long — `inferred-pitch` runs to about ten lines in a 300px panel. Rendered in full and undismissable, it pushed the panel's own content (the yield figures, the findings, the report links) below the fold on every open of every wafer in a lot with inferred geometry, which is the common case for the data this library exists to plot. It is also per-result and unchanging: once read it carries no new information, but it cost the same space every time.

  Each advisory is now a one-line summary — severity glyph, short label, chevron — expanding to the full text on click. Short labels are keyed on `code` rather than derived from the message, the same rule hosts are given for branching on these, with an unknown code falling back to the message's first sentence so a new advisory still collapses sensibly. The header is a real `<button>`, so keyboard operation, focus order and the accessible name come from the element rather than from hand-rolled key handling. Measured on `examples/geometry.html`: 110px collapsed to 32px, returning 78px of a 346px panel.

  Deliberately **not** dismissable. The condition is still true, and a dismissed advisory about dies that may be mis-positioned is a wrong map with nothing on screen saying so. Collapsing keeps it permanently visible and permanently one click from its reasoning, which is the part that was missing.

- **`examples/statistics.html` had a Summary panel "Overlay / Docked right" toggle that did nothing.** The library has no overlay mode: `SummaryPanelOptions.placement` takes a side and defaults to `'right'`, so both settings rendered an identically docked panel — the demo's own comment described behaviour that no longer exists. Replaced with the real distinction that option offers, `defaultOpen` (showing on load versus waiting for the toolbar's notebook button), which the single-wafer scope had no control for at all. The deep-link scenes that selected the dead mode now select the open/closed state instead.

- **The boxplot's "Clip outliers" toggle could draw a whisker past the plot edge, over the row label and axis ticks.** `clipOutliers` narrows the AXIS to a robust fence computed over every row's pooled min/q1/median/q3/max (see `resolveAxisRange`'s own doc comment — it never touches the statistics themselves). A row whose own min or max falls outside that narrowed axis previously still mapped to a real x-coordinate via `xFor`, which has no bound of its own — a value below the clipped low end produced an x position to the LEFT of the plot's left edge, and the whisker line, its cap, and the box outline all drew there, overlapping the row's own label text and the axis tick marks.

  All five per-row coordinates (min/Q1/median/Q3/max) are now clamped to the plot rect. Q1/Q3/median are clamped defensively, not just min/max: the fence is built from every row's stats pooled together, so a row that sits far from the rest of the population can have its whole span, not only its extremes, fall outside a fence built from the pooled set.

  A flat whisker cap asserts "this is the exact value", which is false once clamped — so a clamped end draws a small outward chevron instead (open, in the same stroke as the whisker line), reading as "truncated here, continues past this point". This is the same "state it, don't hide it" rule `drawOffAxisLimits` already applies to a spec limit that falls outside the axis, in the same visual family: a mark that points outward rather than a boundary that claims false precision. The un-clamped end keeps its plain flat cap.

- **Audited whether "Clip outliers" does anything in the wafer-to-wafer trend chart** (a question, not a bug report that turned out true). It does: `resolveAxisRange` is called identically to the boxplot and histogram, and its axis range changes correctly the moment there is something in the `mean ± σ` population for `robustFence` to exclude (it needs at least 8 finite values, i.e. at least 4 wafers, and a real spread — most short demo lots simply have nothing extreme enough to trigger it, which is why toggling it can look like nothing happened when nothing SHOULD happen). Confirmed with synthetic data carrying a genuine outlier wafer: the hint text reports the excluded count and the rendered axis visibly rescales. No code change was needed here — this is recorded so the same question doesn't get re-investigated from scratch next time it's raised.

- **The box plot/histogram/trend axis controls were entirely undocumented.** "Axis includes limits", "Clip outliers", and the box plot's own "Log scale" appear on screen but were never mentioned in `docs/user-guide.md` or `docs/api.md` — a reader had no way to know what they did short of reading the source. The Distributions bullet in §8 now explains the shared pair (kept in sync across all three charts, one row of controls not three), that clipping narrows the AXIS only and never drops a value from a reported statistic, and that Log scale is the box plot's own toggle, not shared with the other two.

### Added — checks that hold the layout rules

Six ratchets encoding the invariants the coherence pass settled. Every one
corresponds to a defect that actually shipped or regressed in this release, and
each was **negative-tested**: the rule was confirmed to FAIL when the invariant
is broken, not merely to pass today.

Five are wiring facts, in `check-overlay-conventions.mjs` beside the existing
anchor/`document.head`/stacking-context rules — they assert that a decision is
still made in a named place, because each is a value whose correctness depends
on context the site itself cannot see:

- both renderers' chrome rows paint `CLR.canvasBg` (the map area's background), not the surface they happen to sit on;
- the chrome row's gap below it is `paddingBottom`, never a margin — the row paints a background and a margin falls outside it;
- `renderWaferGallery` states `chromeInset: MAP_CHROME_INSET` for its cards, since a card already supplies the outer inset;
- `renderWaferMap` passes `contentInset: chromeInset` to the Insights tab, so the tab bar and the identity above it share one column.

The sixth is in `check-style-scales.mjs`: every `data-wmap-toolbar` element must
use `RADIUS.control`. A toolbar is a control cluster, not a container, and the
two build sites had drifted to different roles — which pulled their padding and
height apart with it, so the same bar rendered 36px in the gallery and 30px in
every card inside it.

That last rule failed its own negative test on the first attempt, in the way
worth recording: the scope window was too short (`stripComments` blanks comment
lines rather than removing them, so a well-commented style block pushes its own
`borderRadius` out of range), and "no `borderRadius` found in range" was treated
as "nothing to check" — so the rule passed on the exact drift it exists to
catch. Not finding the property is now a failure in its own right. A check that
cannot see its subject must say so rather than pass, which is the same defect
shape as the focus-ring rule whose justification window included the line it was
meant to judge.

### Changed — layout coherence pass

A measured audit across the gallery grid, gallery Insights, single map and
single-map Insights, comparing every band and surface by height, gap, font
tier, background, border, radius and inset. Seven divergences, each fixed at
the one place that decides it rather than at the view where it was noticed.

- **The toolbar was two components.** The gallery's page toolbar rendered 36px tall with `RADIUS.container`; `renderWaferMap`'s and each gallery card's rendered 30px with `RADIUS.control`. The same cluster of icon buttons had two heights and two corner depths depending on which renderer mounted it. All three are now 30px/`RADIUS.control` — a toolbar is a control cluster, not a container, and two of the three already agreed.
- **The chrome row's background came from two different rules** — transparent in the gallery, `canvasBg` in the single map. Identical in this repo's demos because the page is already slate, and divergent on a host whose page is white. Both now paint the map area's background.
- **The gap below the chrome row used two properties and two values** (a 6px `paddingBottom` in one, a 10px `marginBottom` in the other). Now `paddingBottom: SPACE.lg` in both. Padding specifically: the row paints a background, and a margin falls outside it — inside a gallery card a margin showed 10px of the card's white between the slate chrome row and the slate canvas, reintroducing the pale band the background exists to remove.
- **Single-map Insights was misaligned with its own chrome.** The chrome row sat flush at the map region's edge while the Insights tab bar and content were inset by `EDGE_GUTTER`, so identity and tab labels started on different columns — a visible step on every switch. The chrome row now takes the same gutter. The canvas stays full-bleed deliberately: map area is the priority, and a round wafer wastes the inset anyway.
- **The identity's vertical padding was asymmetric** (8px top against 6px bottom), a leftover from when it was a standalone header row rather than half of a row shared with the toolbar. The asymmetry pushed it off the toolbar's midline.
- **Wafer cards were the only bounded surface without elevation.** Toolbar, bin legend, Insights tab band and summary panel all carry `SHADOW.panel`; a grid of flat cards read as a different class of object from the bands directly above them.
- **The summary panel was the smallest text on screen** at `FONT.body` while holding the densest content, and became the sole outlier once the identity strip was raised. Its inherited baseline is now `FONT.sub`; descendants that set their own size are unaffected.

`MAP_CHROME_INSET` is deleted. It existed so a toolbar floating in the map's own corner and a docked summary panel would align on one small column; with the toolbar in a row above the map it aligned with nothing, and its sole remaining user — the panel — now takes `EDGE_GUTTER` like the chrome row it sits under. This is the fourth constant in this release whose justification did not survive the floating toolbar's removal.

Not changed, recorded as a judgement: the grid's legend band is 49px and the Insights tab band 30px, so content starts 18px higher in Insights. They hold genuinely different amounts (the legend carries a swatch row and a share bar), and forcing equal heights would pad one artificially.

- **Insights content sat 8px further from its band than the grid's cards do, and the Insights view had a different background.** The gap below the tab bar was 18px (a 2px tab margin plus a 16px body margin) against the gallery legend's 10px, so switching views reflowed the content by the difference; the 16px existed to make a naked tab row read as belonging to the content below, a job the band's own border now does. The gap is owned in one place and matches the legend's. Separately, the single map's Insights overlay painted `CLR.panelBg`, which resolves **white** against the canvas's light slate — so opening Insights changed the page's whole ground colour. It now uses `CLR.canvasBg`, the value the canvas itself paints, matching `renderWaferGallery` (whose Insights root is transparent over the same background).

- **The gallery's identity strip rendered a tier smaller than everything around it, and could not be raised.** It sat at `FONT.body` while the wafer labels on the cards beneath it were `FONT.sub` — a view's primary identity set smaller than the things it identifies. Raising it appeared to do nothing, because `buildFacetSummaryChips` pinned `fontSize: FONT.body` on its own container, two levels below the caller, silently overriding whatever the mounting surface asked for. That size is now inherited rather than decided there (it has exactly one caller, so it had no business being decided there), and the strip is set to `FONT.sub` where it is mounted — matching `renderWaferMap`'s identity label, so the same fact is the same size in both views.

- **The identity did not yield width to the toolbar, so the toolbar overflowed and lost controls.** The identity header kept a `flexShrink: 0` from when it was a full-width row inside a COLUMN, where that meant "keep your height". As an item in the chrome ROW it meant "never give up width", and with the toolbar also refusing to shrink the two simply overran their row: in a 700px expand modal a 261px identity and a 472px toolbar came to 733px, so the toolbar ran 39px past the modal's edge and was clipped — the User guide button vanished off-screen, and every control beside it sat 39px out of place, which is why the Insights toggle appeared to move between views inside the modal. The identity is now `flex: 1 1 auto` with `minWidth: 0`: it is the half that should give, since it already truncates (ellipsis on the label, inline fields collapsing back to the chevron), whereas a clipped toolbar silently loses controls with nothing to show that it has.

- **Expand was offered inside the expand modal.** Opening the modal hides the button, but `setInsightsOpen` restored it unconditionally, so toggling to Insights inside the modal brought back a control offering to expand a view that was already expanded — and, appearing in only one of the two views, it shifted the toggle beside it on every switch. It now stays hidden while a modal is open, and the modal's close handler restores it in both views rather than only in the map view.

- **`showHelpButton: false` produced a Help button anyway once Insights opened.** The tab row's Help was passed as a fallback "when the toolbar cannot carry it", but the condition was inverted in both renderers — it passed the guide through precisely when Help had been switched OFF. A host that had deliberately disabled Help (tsmap does) got one the moment Insights opened, which is the option silently reversing itself. `renderWaferGallery` now never passes it (its bar is always present and carries Help whenever asked), and `renderWaferMap` passes it only when Help is wanted *and* there is no toolbar to put it in.

- **The chrome row painted the host's surface, not the map's.** Inside a gallery card the row sits directly above the canvas, so inheriting the card's white left a pale band across the top of every card where the canvas below paints a light slate. It now uses a new `CLR.canvasBg`, which reads the same `canvas-bg` → `surface` chain `resolveChartCanvasColors` uses for the canvas fill, so DOM chrome beside the map matches what the canvas actually paints instead of whatever surface it happens to sit on. The row also gained a bottom padding: a right-docked summary panel began flush against the toolbar and read as joined to it, since the clearance that used to separate them was removed with the floating toolbar.

- **The Insights tab row is ruled top and bottom.** In the gallery it replaces a bordered legend strip when Insights opens, so with only a bottom rule the switch traded a defined surface for one that read as unfinished. It is now a bounded band, with padding keeping the labels off the new top rule.

- **The single map got the same chrome row, and the floating toolbar is gone.** The toolbar was `position: absolute` in the map's top-right corner. That cost no layout row, but it meant every full-bleed overlay had to reserve a band so it would not render underneath — and there were **four** such reservations, each a separate copy of the same fact: `insightsTab.el`'s `paddingTop`, the mapless empty state's `paddingTop`, `reserveToolbarClearance` for a top- or right-docked summary panel, and `TOOLBAR_CLEARANCE` passed to `toCanvas` in canvas space rather than CSS. Two constants existed (38px in CSS, 24px on the canvas) purely because the same toolbar was being measured against two frames.

  The toolbar now sits in a row above the map beside the identity, exactly as the gallery's does, and all four reservations are deleted along with both constants and `reserveToolbarClearance` — whose own comment documented the panel-overlap bug in detail, a bug that can no longer occur. The map is not squeezed by this: the identity row already existed above it, so the toolbar joins a row rather than adding one, and the canvas gains back the 24px it was reserving at the top, so the wafer draws slightly larger than before.

  **The hover fade is gone too.** The bar sat at `opacity: 0.35` and faded to full on pointer-enter, with a 600ms linger so a click on a fading bar still registered. All of that existed because the bar was painted *on* the wafer, where a permanently solid strip competes with the data beneath it. In its own row it covers nothing, so ghosting only made the controls hard to read and hid, until the pointer happened to cross the map, that they existed at all. Removed outright rather than pinned at full opacity, so no dormant timer or listener is left behind.

  The toolbar keeps a width bound, now relative to the chrome row rather than the map box: with `flexShrink: 0` it takes its max-content width and would run out of a narrow container, so the cap is what turns overflow into its existing wrap, and the identity beside it is what yields the space. The expand modal reparents the chrome row as a single root instead of pairing the header with the map box, so the identity and the toolbar arrive together and in the right order.

- **The gallery's lot identity moved onto the toolbar's row, filling the space beside it.** It had been the first line inside the legend strip, on its own row below the toolbar — 14px of content in a ~46px bordered strip, while the toolbar above it stood 36px tall with the entire left half of its row empty. Two rows to say what fits in one, and the empty half was the most conspicuous thing in the header. The identity is now plain text in the same row as the toolbar — borderless, matching `renderWaferMap`'s identity header, so both views state the same thing the same way rather than one of them boxing it; the toolbar keeps its border because it is a control surface and the identity is not. It is laid out as: `flex: 1` so it takes whatever the toolbar does not need, `minWidth: 0` so it can shrink below its content rather than pushing the toolbar off the row, and the toolbar `flexShrink: 0` so it always wins the space — every control in it must stay hittable at any width, whereas the identity already degrades gracefully through the strip's own "+N more" collapsing.

  Measured on the docs gallery: the identity content is ~297px and the toolbar ~330px, so they share a 700px viewport with room to spare, and the header shrinks from 143px to 116px in the grid view. **In Insights the whole strip row disappears** — the bin legend has nothing to key against once the cards are gone, and with identity no longer riding in that strip there is nothing else in it — taking the header to 58px. The toolbar also carries `marginLeft: auto`, so a lot with no metadata at all (no pill) still finds it on the trailing edge rather than snapping to the left.

  The row stretches its items rather than centring them: side by side on one row they read as mismatched unless their boxes are the same height, and centred the identity took its content height (27px) against the toolbar's 36px. Stretch derives the pill's height from the toolbar instead of hardcoding it, so they stay matched if the toolbar's padding or icon size changes, or if it wraps to a second line; the pill centres its own text within that taller box.

  The bins row lost the top border it used to draw when identity sat above it inside the same strip; there is no longer anything above it to separate from. Two gallery tests moved with the content, from `[data-wmap-gallery-legend]` to the new `[data-wmap-gallery-meta]` — the faceting behaviour they cover (every distinct value of a varying field, then "+N more") is unchanged, it is only queried where it now lives.

- **The gallery toolbar is pinned to the right edge**, matching `renderWaferMap`'s toolbar, which is absolutely positioned against its own map box. Keeping the bar visible was not on its own enough to stop the toggle moving: the bar is shrink-to-fit, so when the grid-specific controls hide it collapses from ~330px to ~80px, and while it was left-anchored that dragged every button at its right end ~250px leftward. Pinned, it shrinks away from its right edge rather than toward it, and the surviving controls do not move at all — measured at `right: 1332` in the grid, in Insights, and back again. The identity/legend strip keeps the default stretch and still spans the full width; only the toolbar moved. It also lands the bar on the same column as the card grid's right edge and each card's own top-right toolbar, so the whole view shares one right margin at every width tested (a constant 12px `EDGE_GUTTER`, single row, no overflow, down to 420px).

- **The identity header now shows short metadata inline instead of behind the chevron.** Collapsing by default earned its keep when the panel held a lot; it did not when it held one field. On the docs demo the row is ~1350px wide, the label ~100px, and the chevron hid exactly one fact the row had ample room to state (`Product`), costing a click to learn it. Fields whose value the label already states are filtered out — the label is `lot · waferId`, so without that the row would have read "LOT-DEMO · W01  Lot: LOT-DEMO · Wafer Id: W01", restating its own identity and spending the width that decides whether anything fits.

  The rule is fit, with a count ceiling: at most four fields, and only when they do not clip. Fit alone is not sufficient — twenty short fields would "fit" a wide monitor and turn the identity row into a dense strip harder to read than the label it replaced. Inline and expandable are alternatives, never both: while the fields are inline there is no chevron, no `aria-expanded`, and the whole-row click handler stands down, so the panel cannot offer a second copy of what the row is already showing. A `ResizeObserver` re-tests on resize, so narrowing past the fit falls back to the chevron and widening gives the fields back. Measured on the demo: inline down to a 294px row, chevron at 234px.

  Fit is decided by asking the layout, not by predicting it. The first attempt summed the label and field widths plus a gap and compared that against the row — and was wrong at the boundary, reporting a fit at exactly the available width while the label was visibly truncated, because the real spacing is the flex container's `gap` AND the inline element's `marginLeft` and only one was in the sum. It now tests `scrollWidth > clientWidth` on the rendered candidate, which is the browser reporting directly that content did not fit its box: no spacing arithmetic to keep in sync, and correct by construction if the gap, margin or font ever change.

- **Expanded metadata was unreachable in the expand modal.** The metadata panel is mounted inside `canvasWrap`, so it travelled into the modal with the map, while its toggle — the identity header — was deliberately left behind on the page under the backdrop. The control and the panel it opens ended up in different places, so metadata could be expanded in the map and Insights views but not in the expanded one. The header is now reparented too. The reason it had been left behind (that the toolbar's absolute top-right corner would collide with a header sharing its positioning context) belonged to the old two-root shape where the toolbar resolved against `contentWrap`; it now travels inside `mapBox` and resolves against that, so a header above it shares no positioning context with it. The modal's `title` is dropped in favour of the real header — it would otherwise print the same identity string a second time, one line above — and the dialog's accessible name is set from the same label, so nothing is lost there.

  `contentWrap`'s flex direction had to be set explicitly as part of this. It is a flex **row**, which is invisible while it holds one child and wrong the moment it holds two: the header has `flexShrink: 0`, so as a row item it took its natural width and stretched to full height, rendering as a 134px full-height column of identity text down the left of the map instead of a row above it.

- **The gallery toolbar came back full-width after closing Insights.** `barEl` is created `inline-flex` — a shrink-to-fit pill — and the close path restored it as `flex`, stretching it to the full gallery width, so a compact toolbar was replaced by a full-width bordered box that persisted until reload. One word, and only reachable by toggling Insights and coming back, which is why it survived to be caught here rather than on the way in.

- **The boxplot's LSL/USL labels sat on the wrong side of their own lines.** Both were placed inward, so LSL — the *lower* limit — was labelled to its right and USL to its left, putting each label on the side that reads as the opposite bound. They now sit outward, LSL to the left of its line and USL to the right, matching what the names say. The side is chosen by a new `limitLabelSide` in `chartShell.ts` rather than a hardcoded offset, so a label that would run off the plot flips inward instead of being clipped at the edge; it has its own unit tests covering both limits and both edge cases.

### Added

- **The gallery's bin legend now states the population, not just the colours.** It listed a swatch and a label per bin and nothing else — no counts, no shares, no yield — while each card's own canvas legend has printed a count all along (`toCanvas.ts`'s `LegendSwatch`). That gap mattered because the strip is often the only surface there is: the Summary panel is optional (it only auto-mounts when the host passes `lotStatsSummary` or a wafer carries findings) and Insights is opt-in and off by default, so a gallery rendered without either had **nowhere** stating how the population divides. Each row now reads `1 · Pass  3,394  85.6%`, the caption carries `Yield 85.6% · 3,394 / 3,966 dies` in bin modes, and a single stacked share bar sits under the strip. Yield needs no separate computation and cannot drift from the panel: the legend population already *is* the yield-eligible one and `passBins` is the same array the panel gets, so yield is the pass bins' share of the very denominator the swatches divide up. Metadata mode gets counts and shares too, but no yield — a metadata field has no pass/fail notion, and a yield figure beside one would answer a different question from the swatches under it.
- **The legend was also counting dies the map doesn't paint.** Its scan skipped `partial` but not `edgeExcluded`, so a bin appearing only on edge-excluded dies got a swatch — advertising a colour that is not on screen, since those dies are drawn in `EDGE_EXCLUDED_FILL`. It now uses the rule `buildView` already applies to its own per-card legend tallies, which is the rule `analyzeWaferMap` (`isYieldEligibleDie`) and the Summary panel use as well. Counts are recomputed from the visible cards rather than read from `lotStatsSummary`, because the gallery can be showing a filtered subset and a pooled total would describe a population that isn't on screen.

- **The shared demo fixture (`docs/examples/data.js`) now exercises the pass-rate chart.** It previously had no groupable field at all — `makeWaferConfig` varied only `waferId`, which the facet table deliberately excludes — so no generated demo could reach "Group by", and no die carried a tester verdict for a *parametric* test, so the chart's "Tester flag" mode never appeared. Added: a `processSplit` metadata field alternating POR / Hi-dose across wafers (`PROCESS_SPLITS`, `splitForWafer`), spec limits on Idsat and Ioff so the spec pareto ranks three tests rather than one, and recorded `testPass` verdicts for Idsat and Vth alongside the existing functional Continuity test. Vth's tester verdict applies a guard band 8 mV tighter than the exported spec, and the split arm's +50 mV Vth bias is calibrated so it still passes ~98% of the datasheet limits while passing only ~81% of the tester's own criterion — a split that looks acceptable one way and marginal the other, which is precisely what the disagreement note exists to surface. `makeResults({ waferIndex })` applies the matching bias; the demo pages that build lots now pass it, since a wafer labelled with a split its measurements do not reflect would be worse than no split at all. `tests/demoData.test.mjs` pins the properties the features depend on, so a later tweak to a bias or a limit cannot silently flatten the demo.
- **The lot summary report can now express a split experiment.** Its "Splits" section was a roster — one row per wafer against `metadata.split` — which compared nothing and only recognised a metadata key literally named `split`, so any other naming (`processSplit`, `implant`, `anneal`) produced no section at all. It is now a **Split Comparison**: facets are discovered with `buildFacetTable`, the same function the Insights "Group by" control uses, so the report offers the comparisons the app offers. Each splittable facet gets the wafer roster, yield per arm, and per-test pass rates per arm for every judgement the data supports — spec limits, tester flag, functional — with the spec-vs-tester disagreement count stated once per facet. Capped at 3 facets, since a load can carry many incidental ones (operator, tester, test date) and past a few the report becomes a cross-product nobody reads. Until now a split experiment could be read on screen and never exported.
- **Export CSV on the correlation matrix**, emitted long-form (one row per unordered pair: test names, test numbers, r, n) rather than as a square grid that repeats every value twice. `n` is per row because pairwise coverage differs between tests and an `r` without its own `n` is not interpretable. Deliberately the ONLY new per-panel export: boxplot and trend would re-export the per-wafer mean/σ/quartiles the Overview's test-values CSV already carries, and a second button for the same numbers is chrome without information. Requires a host `onSaveText`; no hook, no button.
- **Per-test pass rate chart, split by group**, in Insights → Overview. The suite could already answer "which *bin* is failing" (bin pareto) and "which group yields worse" (yield chart), but not "which *test* is failing, and does it fail more in one split than another" — the question a split experiment is usually run to answer. One cluster per test, worst first, with a sub-bar per group when "Group by" is active. Three modes, not two, because a parametric test carries **two independent** pass/fail notions: `spec` (the value against its limits) and `testFlag` (the tester's own recorded verdict in `die.testPass` — STDF's PTR `TEST_FLG` bits, which exist whether or not `LO_LIMIT`/`HI_LIMIT` do), plus `functional` for pass/fail-only tests. The two parametric modes can legitimately disagree — guard bands, dynamic or per-site limits, a limits/data mismatch — so they are separate views rather than one collapsed "parametric pass rate", and `TestPassRateData.disagreementDies` counts the dies judged differently (`null`, distinct from `0`, when only one source exists). The card reports that count rather than resolving it: only the reader can tell an expected guard band from a real mismatch. Only the modes the data supports are offered — `hasJudgeableTests` takes the dies for `'testFlag'`, since every parametric test *could* carry a verdict and a definition-only check would offer a mode that renders empty. Backed by `buildTestPassRateData`/`hasJudgeableTests` (`@wafertools/wafermap/stats`), which plot **rates on a fixed 0–100% axis, never counts** — splits routinely have different wafer counts, and a count axis would show the larger split failing more while failing at the same rate. A parametric test with *neither* limits nor a recorded verdict is genuinely unjudgeable and is omitted rather than reported as 100%; a group that never ran a test renders "no data" rather than a 0% bar.
- **Wafer-to-wafer trend chart** in Insights → Distributions: one point per wafer at its mean for the selected test, ±1σ whiskers, the die-weighted lot mean as a dashed centre line, and spec limits where the test has them. Clicking a point opens that wafer's map on that test, and the capability panel's test selection now drives it alongside the boxplot and histogram. The suite had no trend view at all — the boxplot comes closest but answers a different question (distribution *within* each wafer, with its rows sorted and drilled), while drift across a lot only reads in the population's own order. It therefore has **no sort control by design**: slot order is the entire signal. Backed by `buildTestTrendData`/`trendCentre` (`@wafertools/wafermap/stats`), which follow the same precomputed-first pattern as `buildTestBoxplotData` and keep items with no data in place rather than closing the gap.
- **Insights Overview now states its population.** A lot's Overview opened straight into the yield chart, naming no wafer count, no die count and no exclusions — the population every chart below it is computed over went unnamed, the same gap the docked lot Summary panel had. It now leads with tiles: wafers, mean wafer yield (labelled *unweighted, per wafer*, matching the panel so the two can't read as contradicting each other) and dies analysed/excluded. A single wafer keeps its existing Yield/Total dies tiles. Suppressed while "Group by" is active, where a whole-population headline would silently disagree with the per-group charts beneath it.
- **A median reference line on the Insights yield chart** (`ChartPanel.reference`), so a bar can be judged without reading every printed percentage. The docked Summary panel's per-wafer yield bars already marked the lot median; the larger, more prominent chart of the same data had no reference at all. Recomputed after a drill so a group's bars are judged against that group's median, and median rather than mean so one catastrophic wafer cannot drag the reference below every other bar.
- **`r` and `n` on the scatter panel.** The correlation matrix quantifies every pair and clicking a cell drives the scatter — at which point the strength and sample size vanished, leaving a plot that invites reading a trend into noise. Both are now printed, recomputed over the points actually visible so filtering the legend to one group reports that group's own coefficient. Both are computed through one shared internal formula, so the matrix cell and the scatter card cannot disagree about the same pair. Deliberately **not** exported: the shared helper takes running sums as six positional numbers, which is an internal calling convention rather than something a consumer would reach for, and every stats library already has Pearson r.
- **Three new sizing tokens: `--wmap-font-size`, `--wmap-density` and `--wmap-font-family`.** Chrome had no host-settable size lever at all — an embedded map pinned wmap's own type scale and spacing regardless of the host's. `--wmap-font-size` (default 12px) drives every tier through derived deltas rather than a token per tier, so a host cannot produce an incoherent scale and there is one thing to document; `--wmap-density` (default 1) scales the spacing steps without touching type, because shrinking type to fit a column is what produced a segmented toggle smaller than the buttons beside it; `--wmap-font-family` (default `inherit`) lets an embedded map take its host's typeface, which it now does automatically. All three reach DOM chrome only — canvas text cannot read a CSS variable — so `fontPx` resolves the size token to a number at draw time and must be kept in step with it.
- **`CorrelationCell.n`** — the dies contributing to each pair, shown per-cell in the matrix tooltip with the median across pairs in the card's hint. An `r` without its `n` is not interpretable, and the card's "strong pair" count thresholds on |r| alone.

### Changed

- **`check:api` now pins the cross-repo claims too — the ones most likely to rot unnoticed.** The docs' answer to "how much of this must I learn?" leans on figures whose numerator lives in *another repo*: "tsmap imports **10** of its ~100 exports", "passes **6**" of `RenderOptions`' fields. Nothing on this side changes when tsmap adds an import, so those could drift with no local edit to notice. All four sites are now derived and checked — `docs/api.md`, `README.md`, and the two org surfaces (`wafertools.github.io/docs/index.md`, `.github/profile/README.md`), which spell the figure in words rather than digits and are pinned the same way, since a word ages exactly as badly as a number. Imports are counted as **runtime only**: an `import type` costs nothing at run time and is not what "uses N exports" means to someone weighing the API's size. The option count is brace-matched from the real `renderWaferMap(…)` call rather than regexed, because the object spans dozens of lines and a flat pattern counts nested keys — the same mistake that made the field counts wrong in the first place. Absent sibling repos are **skipped and announced**, never failed: CI clones one repo at a time, and the skip is printed so a green run cannot silently mean "checked nothing".

- **`check:drift` now covers all four wafertools repos, not just the pair.** `.github` and `wafertools.github.io` had no checks of any kind, which is backwards: they carry no code, so nothing ever validated them, and between them they are the first thing anyone sees — `github.com/wafertools` renders `.github/profile/README.md`, and the org site renders the site repo's `docs/index.md`. Both are now checked for dead relative links (the bug class that actually happens there — a doc renamed, or a section promised and never written) and for mentioning both projects, since with GitHub Pages there is no funnel: a visitor arrives at the org page, either project's site, or any README, so each surface has to route on its own. A missing sibling repo is a **note, not a failure** — CI clones one repo at a time, and a hard failure there would break every build that isn't a local four-repo checkout.

- **`check:styles` gained the font-size floor tsmap's copy already had.** The two repos share this script's mechanism and differ only in the constant, because the rules genuinely differ: `UI_STANDARDS.md` sets 11px here (with an 11px tier for uppercase micro-labels and ornaments), while tsmap sets 12px because smaller text renders poorly on the Windows WebView2 it ships in. The floor is a separate flat check rather than another distinct-value budget, since the question for font-size is not how many sizes exist but whether any is too small.

- **The API-size figures in `api.md` were wrong the day they were written, and are now derived.** The reference tells a reader how little of the API they need — "`RenderOptions` has N top-level fields", "tsmap passes 6 of them" — because at ~34,000 words its size otherwise reads as the size of the thing you must learn. Those numbers are the reassurance, so they have to be right, and they were not: **32 and 24 against a real 29 and 21**. Both were counted with a regex matching any indented `name:` line, which also matches the *parameters of a callback signature* declared inside the interface — a mistake invisible in prose and obvious in code, which is the whole argument for deriving a figure rather than reading it once. `scripts/check-api-claims.mjs` now counts fields at exactly one level of indent, checks every place the number is quoted (`npm run check`), and regenerates them at release (`npm version`, alongside the bundle figures).

- **Bundle figures are generated at release and checked in between; the README badge was wrong.** It advertised `~40 kB` against a real 44 KB, and — worse — the word "core" meant two different things across the docs: the badge meant the DOM-free root entry, `comparison.html` meant the renderer, so the same page set quoted 40 and 104 for it. All four figures (data layer, renderer, Insights chunk, guide chunk) now live in exactly one table, `docs/performance.md` § Download size, with everything else linking there rather than restating. `npm version` runs `check-bundle-size.mjs --write`, which measures the built `dist/` and rewrites that table plus the README badge and prose line, then stages them — so a release cannot ship a stale number, and nobody has to remember to update one. Between releases the same script still runs as a check, so drift is caught at the commit that causes it. Its tolerance was tightened from 10% to max(1 KB, 3%): 10% is provably too loose, since the 40-vs-44 error that started this is 9% and sailed through.

- **The README now names its author and explains the licence in a sentence.** The MIT terms already bind the copyright notice to every copy, including inside closed commercial products, but nothing in the README's visible text said who wrote the library or what MIT means for someone evaluating it — the information existed only in `LICENSE` and `package.json`, which is where a lawyer looks, not a reader.

- **The docs now say how little of this API you need, and point at the finished app first.** The reference is ~33,500 words across 118 headings, and nothing in it distinguished the four functions almost everyone uses from the ninety-odd exports almost nobody does — so its *size* read as the size of the thing you had to learn. Measured rather than asserted: §4–§7 (the four core functions) are 74.7% of the file, so the weight is not advanced material but option depth — `RenderOptions` has 32 top-level fields. **tsmap, a complete cross-platform desktop application built on this library, imports 10 of its ~100 exports and passes 6 of those 32 options.** That figure now appears at the top of `api.md`, in the README, and beside both render functions' signatures, because it is the single most useful calibration available and was documented nowhere. §3's overview table is tiered Everyday / Occasional / Rarely-needed instead of listing ten sections as peers. No reference material was removed.
- **tsmap is now offered as the alternative to integrating at all.** The docs site's landing page, the README, the Quick Start and `llms.txt` all led with "install the library" and mentioned the finished application either in passing or — on the landing page, the Quick Start, the guide and `llms.txt` — not at all. Someone arriving to *look at* wafer data was being routed into writing code. Each of those now opens with the honest question, names what tsmap does (desktop and browser, STDF/ATDF/CSV/JSON/Parquet, parsed locally and never uploaded), and states plainly when to build instead: wafer maps inside your own application, a data source it doesn't read, or behaviour it doesn't offer.
- **`pearsonFromSums`/`pearsonOfPairs` are internal again.** They were exported earlier in this cycle only because a draft changelog entry claimed they were public — reality was changed to match the prose rather than the other way round. `pearsonFromSums` takes running sums as six positional numbers, which is a calling convention between two call sites in one file, not an API; every stats library already has Pearson r. Unreleased, so nothing depended on them. The matrix and the scatter card still share one formula, which was the actual point.


- **The Insights chart suite is no longer in the initial `/render` chunk.** `renderWaferMap` and `renderWaferGallery` imported `createInsightsTab` statically, so chartShell, histogram, correlation, boxplot, scatter, capability, trend, testPassRate and insightsTab — **~25 KB gzipped** — were downloaded by every consumer to render a wafer map, even though `insights` is opt-in and off by default. It is now fetched on first open (`ensureInsightsTab`), exactly the treatment `userGuideHtml` already had, and the initial chunk drops from ~128 KB to **~104 KB gzip (−22%)** — back under the ~106 KB baseline set in August. `tests/bundle-size.test.mjs` gained a static-import guard mirroring the guide's, since a stray `import` would silently undo this; `scripts/check-bundle-size.mjs` now attributes the core, Insights and guide chunks separately instead of counting two lazy chunks as core (run it with `WMAP_CHUNKS=1` for a per-chunk breakdown). **`setInsightsOpen(true)` now returns before the tab's DOM exists** — the toolbar still responds synchronously, and toggling back while the chunk is in flight is honoured, but a caller asserting on the chart DOM immediately after the call must wait for it. See §5.9 in `docs/api.md`.
  Not done, deliberately: `summaryPanel.ts` still statically imports `makeLabeledSelect`/`makeSegmented` from `charts/chartShell.ts`, which keeps a sliver of the chart shell in core. Measured at **1.4 KB gzip** — tree-shaking already discards the rest — so moving two widgets to a neutral module would cost more churn than it returns.

- **The `inferred-pitch` geometry advisory is now `severity: 'warning'`, not `'error'`.** Supplying `waferConfig.diameter` without `dieConfig.width`/`height` is a documented, supported input: the pitch is derived as diameter ÷ grid span, which is exact for a map whose grid reaches the wafer edge and only skewed when edge dies are absent. It reports an assumption made on the caller's behalf, unlike `partial-coverage` and `geometry-conflict`, which mean dies really may be mis-positioned — those stay errors. Flagging it in red left every host that legitimately knows only the diameter (tsmap's wafer-diameter setting, which has no die-pitch field) showing a permanent error banner with nothing available to clear it.

- **Spacing, radius and type moved onto named scales, enforced by a new `check:styles`.** The library had 2, 3, 4, 5, 6, 8, 10 and 12px radii in use with no rule for which belonged where, and paddings clustered at 2/4/6/8/10/12/16/24px with a long tail of one-off 3, 5, 7, 9, 11, 14, 15, 20, 23 and 32px values. The scales are *derived from what the library already did* rather than imposed — the clusters were the system, the tail was drift — and are now `SPACE`, `RADIUS` (three roles: 4px control, 6px card, full pill) and `FONT` (tiers derived from `--wmap-font-size`). `scripts/check-style-scales.mjs` (wired into `npm run check`, and available alone as `check:styles`) budgets the number of *distinct literal values* per property rather than checking any single site, because that is the shape this class of defect actually has: four definitions of one card frame are each defensible read alone and only wrong in comparison. Off-scale values are not all mistakes — an indent aligning to a 7px status dot is optical, not rhythm — so the rule is to snap deliberately per site and leave a comment where a value is optical.
- **The bin-cluster chart painted its hover highlight over the bin name.** The highlight spans the full row width and was drawn inside the per-group loop, after the label, so it covered the name whenever the hovered sub-bar overlapped the vertically centred text. It is now painted first. `charts/testPassRate.ts` inherited the ordering from here and was written correct.
- **`noUnusedLocals` is on, and the 38 unused imports and locals it flagged are gone.** This was not tidying: that noise is precisely what hid two real defects. `drawOffAxisLimits` was imported into the histogram panel and never called, so one of the three distribution charts silently lacked the off-axis limit markers the other two had — a fix reported as complete that had landed in two places out of three. And a complete `yieldSection` builder sat unreferenced in `renderSummaryReport.ts` after a slimmer summary replaced it, so the **wafer report showed only Total dies and Yield** while the lot report showed good/bad die counts and exclusions — the two reports disagreeing about what a summary is. Both are fixed (see Fixed). Also removed: `applyMenuRoles` (superseded by inline role assignment at six call sites — no accessibility gap), `FAMILY_PRIORITY` (superseded by `FAMILY_RES`), and a write-only `rowsPerCol`. `noUnusedParameters` is deliberately left off: deliberately ignored callback arguments are legitimate and would drown the signal again.

- **Uncurated metadata keys are labelled with `prettyKey` instead of their raw identifier.** A host field wmap does not know about — which is most of a real host's metadata — surfaced its camelCase name verbatim (`processSplit`, `frameId`) in the Insights "Group by" dropdown and the report's split comparison. Curated labels still win.
- **`csvField` moved from `canvas-adapter/summaryPanel.ts` to `core/utils.ts`.** It is a pure string function (CSV quoting plus the formula-injection guard) and now has three consumers — the summary panel, the die list and the correlation chart. Reaching it from a chart would have meant importing `summaryPanel` into `charts/`, inverting an existing dependency. Still re-exported from its old path, so no importer breaks.

- **Deleted four unreferenced demo CSVs** — `docs/data/dummy-bins.csv`, `dummy-test.csv`, `sample-long.csv`, `sample-stdf-export.csv`. Nothing in the docs, examples or tests loaded them, and as 15–39-die toy grids that span no wafer they would have raised a `partial-coverage` advisory the moment anyone wired one into a demo.

- **The distribution panels' axis behaviour is now shared, derived, and honest about what it hides.** Three related changes to histogram, boxplot and wafer-to-wafer trend:
  - **"Axis includes limits" defaults from the data** instead of always starting off. Neither fixed answer was right: off hides how close a distribution runs to its limit, which is the main thing a spec'd test is read for; on squashes the data into a sliver whenever the limits are generous — and generous limits are exactly what a capable process looks like, so the *good* case rendered worst. `shouldIncludeLimitsByDefault` includes them when doing so leaves the data at least a third of the axis. The toggle still overrides, and once set it sticks.
  - **A limit outside the plotted range now gets an edge marker** (`USL 13 mV ↑`) rather than a line drawn off-canvas. Previously it rendered as nothing at all, so a test whose limits sit beyond the axis was indistinguishable from a test with no limits.
  - **A "Clip outliers" toggle** bounds the axis to a Tukey fence (`Q1 − 1.5·IQR … Q3 + 1.5·IQR`), so one wild reading cannot flatten every real value into a single pixel. Deliberately **not** mean ± 3σ: σ is computed from the data including the outlier, so the bound is dragged out by the very value it should fence off, and with more than one outlier it stops excluding anything at all. This clips the **axis only** — no statistic anywhere is computed from a clipped population, since an out-of-spec die is a distribution outlier by construction and excluding it would delete real spec failures from yield and misrepresent capability. Each panel states how many values fall outside the view.
  - All three toggles are **shared across the panels**, the same way the selected test already is; they were per-panel, so one preference had to be set three times for one test.

- **Summary-panel sections are collapsible, and three carry a header selector.** Collapsed state is remembered per panel element across re-renders (both render functions begin with `panel.innerHTML = ''`, so DOM-only state was destroyed on every stats update). Selectors: bin breakdown Hard/Soft, region yield Ring/Quadrant, wafer yield Slot/Yield — each deriving its default rather than starting neutral.
- **Findings moved from the bottom of the panel to directly under the headline stats.** They are the only actionable section and the only one with a badge count, and were reachable only after scrolling past two full test tables.
- **Ring Yield and Quadrant Yield merged into one Region Yield section**, ring by default with quadrant behind the selector. The two were the same builder with a different `regionBuilder` and consumed eight rows of a 260px column between them; quadrant yield averages over half the wafer and lands within a point or two of the wafer mean on almost every lot, while a genuine asymmetry is already reported as a finding with a significance test behind it.
- **Bin bars are now in pareto order** — pass bins first (in bin order), then failing bins by descending count — instead of ascending bin number, which buried the dominant failure mode beneath whatever had the lowest code and disagreed with the Insights bin chart (`buildBinParetoData`, count-descending) for the same data.
- **The panel's test table carries Test / Mean / Ppk / Spec yield only.** It emitted 9 columns, 12 with limits, into a 260px column: four were visible and the rest sat behind a horizontal scrollbar nested inside a vertical one. The full descriptive statistics remain in the CSV export, the summary report, and the Insights boxplot/capability panels.
- **Added a Ppk column**, read from the same `buildCapabilityData` the Insights capability panel and the summary report use. Ppk rather than Cpk deliberately: Cp/Cpk use the pooled within-wafer stddev, so on a single-wafer panel there is exactly one subgroup and `cpk === ppk` identically — labelling it "Cpk" would name an index the data does not contain — while across a lot Cpk excludes the wafer-to-wafer shift that Ppk includes. The Cpk/Ppk pair is a drift diagnostic and stays in the summary report, which prints all four indices. Ppk is also added to the test-values CSV.
- **A test's `N` moves into the section title when every test shares it**, instead of repeating an identical value down a column; it stays a column when counts actually differ, which is the case worth seeing. The functional-test table's pass-rate cell no longer repeats the N its own column already shows.
- **The gallery panel's Lot/Findings tabs are gone — it is one panel.** The tab named "Findings" contained no findings: it listed wafers with a count badge, while the *Lot* tab held the actual lot-level findings list. Worse, both tabs carried a per-wafer list with the same row idiom and different click actions — the Lot tab's Wafer Yield rows highlighted a card in the grid, the Findings tab's rows opened a window. The per-wafer index is now a findings-count badge on each Wafer Yield row, which is one list instead of two and includes wafers with no findings — the case the subset list structurally could not show, and precisely the low-yielding-but-unflagged wafer a triage view exists to surface. The tab's "Findings report" button moves beside the other report buttons. The per-wafer index survives only as the panel's whole content when there is no `lotStatsSummary` at all, since there is then no per-wafer yield series to badge.
- **Wafer Yield rows now open the wafer, which their `aria-label` already claimed.** The label said "— view wafer" while the gallery wired the click to a card highlight. The row also names its findings count in that label.
- **The single-wafer panel no longer duplicates the identity header's metadata.** `renderWaferSummaryContent` takes `metadataShownElsewhere`, and `renderWaferMap` passes it whenever `showIdentityHeader` is on (the default) — the header's expandable panel is built from the same `metadataEntries`/`buildCompactMetadataRows` helpers, so the fields were printing twice in a 260px column, authoritative in neither place. The lot panel has always made this call for itself; the wafer panel now matches. With `showIdentityHeader: false` the section returns, since the panel is then the only place the metadata exists.
- **The compact test-values column set leaked out of the docked panel into Insights.** `buildTestSection` was changed unconditionally, so the Insights Overview's test table — a full-width sibling of the chart grid, with all the room it needs — also lost min/Q1/median/Q3/max/σ/LSL/USL. The column set is now an explicit `columns: 'compact' | 'full'` defaulting to **full**; only the 260px docked panel opts into compact. The CSV export was never affected.
- **One report instead of two, and every CSV button says what it exports.** The lot panel offered `Summary report` and `Findings report` side by side, but the summary report already contained a Findings section — the real difference was lot-level versus per-wafer findings, which neither name conveyed, so choosing wrong produced a plausible document missing what you wanted. Worse, the pair was asymmetric: `Summary report` was unconditional, `Findings report` appeared only when some wafer had findings, and on the no-`lotStatsSummary` fallback path it was the ONLY report available. The summary report now carries a **Findings by Wafer** section (stating how many of N wafers had any, so the absent ones read as clean rather than unanalysed), the separate button is gone, and the fallback path offers the same summary report — `renderLotSummaryReportHtml` computes `analyzeWaferLot` itself, so it needs no precomputed lot stats and the work stays lazy, on click. Separately, three buttons all labelled `Export CSV` — two of them on adjacent Insights cards — are now `Test values CSV`, `Functional CSV` and `Correlation CSV`. The die list's own export keeps the plain label: it sits alone in a modal headed "Die list", where nothing else could be meant.
- **The summary report printed every finding, including the ones already merged into another.** The Summary panel and the findings report both drop findings that another finding has claimed as an exact restatement (a soft-bin twin over identical dies; the single pass bin against the yield row), because the claimer's own label already names what it absorbed. The summary report did not — so a wafer with 8 merged twins listed 16 rows, each merged row followed immediately by the bare row it had just absorbed, contradicting the merge the label described. The rule now lives once, as `visibleFindings` (`@wafertools/wafermap/stats`), used by all three surfaces.
- **The die list omitted functional tests entirely.** `resolveTestColumns` filtered to parametric tests, copying the rule that keeps functional results out of parametric *statistics* — where a mean of a pass/fail outcome is meaningless. A raw per-die table is not a statistic: it is where you go to answer "why did this die fail?", and the tester's functional verdict is frequently the answer. The column builder already knew how to render a verdict; it was simply never handed a functional test. Verdicts now read through `getTestPassStatus`, so the legacy 0/1-in-`testValues` form renders as PASS/FAIL instead of a bare `1`.
- **The die list CSV embedded units in every cell**, so a test column read `300 mV` and was text to a spreadsheet — unsummable, unplottable, unfilterable, and with per-value SI scaling capable of putting `300 mV` and `1.2 V` in the same column. The unit moved to the column header (`vth (mV)`) and the CSV emits the bare stored number. The on-screen table keeps its SI-formatted cells.
- **The per-test CSV exports stamped the whole wafer-metadata blob as "identity" columns.** They used `waferKeys: 'auto'`, so a host mapping an STDF header into wafer metadata got its WCR geometry — `Center X`, `Center Y`, `Die Ht`, `Die Wid`, `Pos X`, `Pos Y`, `Wafr Siz`, `Wf Flat`, `Wf Units`, `Job Rev`, `Tester Type` — as constant leading columns on every row: fifteen columns before the first statistic, none of which identified anything. `MetadataKeySelection` gains `'identity'` (the curated `DEFAULT_FACET_CURATION` keys — lot, wafer, product, program, split, operator, date), and the per-test exports use it. The die list keeps `'auto'`, being a raw-dies dump where full context is the point.
- **`CsvExportContext.populationLabel` was documented as emitting a `Population` column and never did** — it only ever reached the on-screen section title. A pooled export therefore showed one large N with nothing saying it spanned several wafers, reading exactly like a single wafer's data. Now emitted, including for a mixed lot with no common metadata, where it is the only honest thing the file can say about its population.
- **`Spec Yield N` duplicated the `N` column** on every row whenever the two agreed, which is the usual case. Kept only when some test's spec population genuinely differs from its value count.
- **The gallery's bin legend never said whether it was showing hard or soft bins.** Hard and soft bins are independent number spaces, so a row of bare "Bin 3" swatches is genuinely ambiguous about which population it describes. A card's own on-canvas legend has always carried a "Hard Bin"/"Soft Bin" title from `buildMapTitle`, but that legend is suppressed below `BIN_LEGEND_MIN_CANVAS_W/H` — at gallery card sizes the shared lot-level strip is frequently the only legend on screen, and it was the one without a label. It now leads with the bin space, tracking the plot mode. Metadata mode gains the same treatment, naming the field it is keyed on (resolved exactly as `buildMapTitle` resolves it for a card title, so the two cannot disagree).
- **The Summary panel used native `title` tooltips instead of the library's own.** Six sites in `summaryPanel.ts` (findings rows, the supporting-findings chevron, the severity chips, and the new per-wafer findings badge) set a `title` attribute — the browser's OS tooltip: slow to appear on a hover delay, in an unthemed system font and colour, and unaware of the app's overlay stacking. Every hover surface built through `createToolbarHelpers` already used the shared instant dark tooltip, and `maplessSummary.ts` had converted away from `title` for exactly these reasons, with a comment recording why — but the helper it wrote stayed local to that file and the panel never got it. `wireHoverTooltip` is now `wireTooltip` in `toolbar.ts`, and the panel, `renderWaferMap`'s header expand button and `renderWaferGallery`'s card expand button all use it. It accepts a fixed string, a getter (for a hint that flips with control state), or nothing at all — in which case it live-reads the element's `aria-label` at hover time, the same thing `makeBtn` does, so a control that relabels itself (expand ⇄ reattach) needs no re-wiring. `asDataPoint` keeps the histogram-bar behaviour (tab stop, `role="img"`, `aria-label`) for elements that are not already controls; it is deliberately not applied to buttons, which would gain a nested focus stop and lose their own accessible name.
- **The pop-out window title bar and disabled menu rows used native `title` too.** The Minimize / Print / Maximize / Close buttons on every `openModal`/`openFloatingWindow` title bar — the Summary report, die list and user-guide windows, and any detached gallery card — plus the hover hint on a greyed-out dropdown row (e.g. "Available on hard/soft bin maps" on a bin-only overlay while in value mode). That last one is the worst case for an OS hover delay: the hint is the entire reason the disabled row stays on screen instead of being omitted. All now use `wireTooltip`.
- **Maximize and Close never told a screen reader their keyboard shortcuts.** They carried `title="Maximize (F)"`/`"Close (Esc)"` alongside a shorter `aria-label` of just "Maximize"/"Close", so the shortcut existed only in the visual hover hint. The shortcut is now in the accessible name, matching `makeBtn`'s convention (its tooltip is the `ariaLabel` verbatim).
- **The shared tooltip could obscure the element it was describing.** `positionTooltip` took the anchor element but used it only to resolve an overlay root — placement came from the cursor point alone, and because the box starts above the cursor (`clientY - 8`) it then extended down across the row, bar or button being pointed at. It now avoids the anchor's own box, flipping below it (or above, when there is no room below). Only for anchors up to 40% of viewport height: the map canvas is itself the anchor for die hover, where overlap is unavoidable and displacing the tooltip clear of the whole canvas would be far worse, so a large anchor keeps the previous cursor-following behaviour exactly.
- **The findings Kind/Region dropdowns appear only from 8 findings up** (or whenever a filter is active), having previously cost two rows of a 260px column above a list of four items.

## [0.26.1] — 2026-08-28

### Fixed

- **The built-in guide window read as broken in a dark host theme — pale, near-illegible text on a plain white page.** `.wmap-guide`'s CSS set `color: var(--wmap-text, #1a1a1a)` but never a matching `background`, so a popup window that copies `--wmap-*` tokens from a dark host (`copyWmapThemeTokens`) got dark-appropriate (pale) text with no dark background to put it on. Added `background: var(--wmap-surface, #fff)` to `.wmap-guide`, so background now follows the same synced tokens the text already did.
- **`edgeExcluded` dies rendered almost invisibly against the default light data colour scheme.** The fill (`#eceef0`) was lighter than the "no data" fill and barely darker than the canvas's own default background (`#f5f5f5`) — an excluded die read as blank/missing rather than "measured but excluded." Now a visibly darker, distinct grey (`#aab0ba`) — deliberately darker than the no-data fill too, since an excluded die had real data and should read as present-but-set-aside, not as more of the same "nothing here."

## [0.26.0] — 2026-08-28

### Breaking

- **The die-list table/CSV's single `Position` column (`"(x, y)"`) is now two separate `X`/`Y` columns.** A bracketed pair reads fine on screen but forces an extra parsing step (or breaks outright) when the CSV is opened in Excel, pandas, or any other tool expecting one number per cell. Any code reading the die-list CSV/table by column name or position needs to read `X`/`Y` instead of `Position`.

### Added

- **`Ring`/`Quadrant` die-list columns**, via new `DieListOptions.getWafer`/`ringCount`. Wired up automatically through `renderWaferMap`/`renderWaferGallery` — a direct `buildDieListSection` call supplies `getWafer` itself. Appear only when `getWafer` resolves at least one die to a `Wafer` (omitted entirely, not shown empty, otherwise), and use the same `classifyDie`/`ringCount` the rest of that wafer/lot's analysis uses, so "Ring 2" here always names the same region a Ring finding does.
- **`Edge excluded` die-list column**, shown only when at least one die in the export has `edgeExcluded: true` (an included die is never stamped `false`, so "no die is excluded" and "the feature was never configured" are indistinguishable from `Die[]` alone — omitting the column in that case is the closest available approximation).
- **`openReportModal`** (`/render`) — opens report HTML (from `renderFindingsReportHtml`/`renderSummaryReportHtml`/`renderLotSummaryReportHtml`) in an in-app modal, with a Print/Save-as-PDF header button and an "Open as full page ↗" fallback to `openHtmlReport`/`setReportOpener`. The Summary panel's "Summary report" button now calls this automatically — **no `setReportOpener` wiring is required just to view a report anymore**, in a plain browser tab or an embedded host (Tauri, Electron, WebView2) alike.
- **`openWaferMapGuide`** (`/render`) — opens the built-in guide window with no live `WaferMapController`/`GalleryController` required, for a host whose help entry point must also work before anything has rendered (an empty-state "Help" menu). `WaferMapController.openUserGuide()`/`GalleryController.openUserGuide()` are now thin wrappers around this same call.
- **`ICONS`** (`/render`) — the toolbar's own icon set, now public so a host rendering its own chrome alongside wmap's can match its iconography instead of copy-pasting SVGs that drift on the next redesign.
- **Combined "Contents" navigation and Print/Save-as-PDF in the guide window.** A sticky bar lists every `<h2 id>` across the host's `extension.html` and wmap's own guide content as one flat, unnumbered list (see `UserGuideExtension`'s doc for why it's deliberately not split by source), flowing top-to-bottom in columns. A Print/Save-as-PDF header button covers the in-page overlay case (`window.open` blocked/unavailable); a real popup needs none, since native Ctrl+P already scopes to just that window.
- **Find-in-page search in the guide window** — but only for the in-page overlay case, next to the Contents toggle. A real popup window gets no search box: it's an actual OS window, so native Ctrl+F/Cmd+F already searches it, and a custom box there would just be redundant chrome. Matches highlight via plain `<mark>` elements (no invented highlight colour), Enter/Shift+Enter step through them, Escape clears.
- **`LotStatsSummary.mixedIdentityFields`** — identity keys (lot, product, testProgram, temperature, etc.) where the pooled wafers passed to `analyzeWaferLot` do *not* all agree, e.g. items pooled from more than one lot/program. `lot` now only includes a key when every wafer with identity data agrees on its value; a disagreeing key is omitted from `lot` and named here instead of silently taking the first wafer's value.
- **`WaferWarning` code `'edge-exclusion-exceeds-radius'`** (severity `'warning'`) — raised when `waferConfig.edgeExclusion` exceeds the resolved wafer radius (most likely with an under-inferred diameter); see the Fixed entry below for the behaviour this replaces.
- The gallery's toolbar and legend are now `position: sticky` in every one of the library's own demo pages, given a proper scrolling ancestor.

### Fixed

- **CSV export was vulnerable to formula injection from untrusted die/wafer metadata.** A cell value beginning with `=`, `+`, `-`, or `@` is read as a formula by Excel/Sheets/LibreOffice on open — a real risk when the source is a host's own MES/LIMS metadata or operator free text, not data this library originated. `csvField` (shared by every CSV export, including the die list) now prefixes such a value with `'` before quoting — but only when it doesn't parse as a plain number, so a genuine negative/signed test value (offsets, leakage, deltas — routine in test data) round-trips unchanged.
- **An edge-exclusion width exceeding the resolved wafer radius silently produced a smaller, wrong excluded band** instead of excluding the whole wafer — squaring the resulting negative "inner radius" flipped its sign back positive, so the comparison it fed just picked the wrong dies. Now clamped to 0 and reported via the new `'edge-exclusion-exceeds-radius'` warning.
- **`analyzeWaferLot`'s lot identity (`LotStatsSummary.lot`) was silently derived from the first wafer only**, not verified shared — pooling wafers from two different lots/products into one call could report the first one's identity as if it applied to the whole batch. See `mixedIdentityFields` above.

## [0.25.0] — 2026-08-25

### Added

- `WaferViewOptions.showLegend` (`renderWaferMap`) — hide the legend/colorbar entirely, for a host that provides its own equivalent control. Default `true`, matching prior behaviour.
- `WaferViewOptions.markFailingDies` / `ToCanvasOptions.markFailingDies` — draws a diagonal hatch on dies whose bin is not a pass bin, giving pass/fail a second channel that isn't hue. Bin modes only; opt in from the Colour scheme menu. Default `false`.
- `GalleryOptions.perCardLegend` — lets a gallery card grow its own legend again (its distinct value: highlighting a bin on one card independently of the rest, e.g. after changing that card's plot mode). Default `false`; the toolbar shows the toggle disabled with a stated reason where it genuinely cannot apply — a data-ranged value-mode gallery, where each card is normalised to its own min/max and no shared bar could describe them.
- `ViewOptions.passBins` (`buildView`) / `ViewRect.binFail` — internal plumbing for the failing-die marker above, relevant only to a caller using the low-level `buildView` directly (bypassing `renderWaferMap`/`renderWaferGallery`). It is **not** a new option for the normal `renderWaferMap`/`renderWaferGallery` path: both already required `passBins` before this release (for the summary panel's yield figure), and that existing value now also flows down into `buildView` automatically for the marker — nothing new to set, no second place to keep in sync. A direct `buildView` caller does need to pass it explicitly, matching whatever they already pass to `buildWaferMap`/`analyzeWaferMap`, or the marker will disagree with the yield figure beside it. Default `[1]`. Any bin can be a pass bin or a fail bin, bin 1 included — this must never be derived from the bin number.

### Fixed

- **The gallery's sticky toolbar/legend could scroll out of view**, in two different ways depending on the host's own scroll setup: a page that scrolls at the document level had a stray `overflow-y: auto` on `html`/`body`, and a page with its own bounded scroll container had `overflow-y: auto` (or `overflow: hidden`) on a box that was never actually height-bound — both silently give `position: sticky` a *non-scrolling* containing block, indistinguishable from "not sticking" at all. Fixed across every one of the library's own gallery demo pages (`docs/examples/real-data.html`, `mixedwm38.html`, `statistics.html`, `theming.html`, `showcase.html`) as worked examples of the fix, and documented as its own `UI_STANDARDS.md` incident so the same mistake is recognisable in host code, not just here.
- **Two sequential z-index regressions in the gallery**: per-card toolbars floating above the gallery's own sticky toolbar when scrolled, then — after a first fix — the sticky legend obscuring its own dropdown menus. Root cause was a bare `zIndex` literal being compared across an accidentally-shared stacking context (`position: relative` without its own `z-index` does not create one, however much it looks like it should). Fixed generically rather than tier-bumped again: the card grid now contains its own stacking context (`isolation: isolate`), and every toolbar/chart dropdown and cascading submenu — map, gallery, and chart cards alike — now renders into one shared, always-elevated layer (`menuLayerFor`) instead of each call site reasoning about z-index relative to whatever chrome happens to be nearby.
- **A value-mode gallery with spec-ranged limits silently lost its colorbar entirely.** The per-card-legend gating checked `colorbarRangeMode === 'data'` (true when each card is scaled to its own range) but a *spec*-ranged value gallery has an identical range on every card and has no such problem — it was being suppressed anyway, gallery-wide, with nothing standing in for it.
- **The gallery's "Wafers" tab name implied it listed every wafer**, but it lists only wafers with their own findings — a 13-wafer lot could show 8 rows, and the two lowest-yielding wafers, having no findings, were among those silently missing. A user scanning for problem wafers read the absence as "these are fine." Renamed to "Findings".
- **The gallery's Lot-tab sidebar duplicated the metadata table already shown in the gallery's own top strip**, verified byte-identical against a live 13-wafer lot — a second copy that cost a third of the sidebar's width for zero new information.
- **Map and legend titles rendered near-black on every dark theme**, reading as a smudge rather than text — `drawTitleFitted`'s default text colour was a hardcoded `#333` rather than the resolved theme colour; the one call site that looked right was the only one passing a colour explicitly.
- **The floating legend covered the entire wafer on small gallery cards** (as small as 86×50px) instead of acting as a legend, and its title floated unprotected on top of the map, half-hidden behind dies, instead of inside the legend's own plate. The legend is now suppressed below a 150×120px canvas floor, and its title moved into the plate's own reserved heading row.
- **The correlation chart's r-value could never actually display**, on any lot: its cell width (`PREF_CELL`, 26px) sat structurally below the minimum width the label needed to render (`R_LABEL_MIN_CELL`, 28px) — dead code that had never once fired. Raised to 44px. Its label contrast also moved from a fixed `|r| > 0.6` heuristic to a real luminance-based contrast function.
- **The capability chart's axis labels assumed every test had spec limits** (hardcoded `USL`/`LSL`), mislabelling any test analysed with no limits defined. Labels now derive from the actual composition of spec'd/unspec'd tests in the current view — `USL`/`LSL` where any are spec'd, `max`/`min` where none are, and a `normalised (per test)` axis title for a mixed view.
- **The gallery picked the smallest workable column width even when a comfortable one would fit** — a 1171px canvas card, for example, rendered at 285px instead of 434px. Column sizing now tries the largest comfortable width that still fits at least one column, falling back to the hard floor only when even that doesn't fit.
- A ResizeObserver feedback loop in the gallery grid and in chart cards, from redundant grid-template/`minHeight` writes on every resize tick even when the value hadn't changed; both now coalesce onto `requestAnimationFrame` and skip the write when nothing changed.
- The detached-card placeholder always read "Opened in its own window", even when the card had actually opened in the in-app wafer viewer instead of a real popup window.

### Changed

- Themed tooltips (`attachChartTip`) replace native `title` attributes on the histogram and scatter charts' legend swatches, matching the rest of the toolbar's tooltip styling instead of falling back to the browser's own delayed, unstyled tooltip.

### Internal

- `UI_STANDARDS.md` gained a new documented incident ("position: sticky or fixed") covering the sticky/z-index bugs above, and the general lesson: a bare z-index literal only means what it looks like if something between it and whatever it's compared against already established a real stacking context.
- New Check 3 in `scripts/check-overlay-conventions.mjs` (wired into `npm run check`): flags a `position: sticky`/`fixed` element with a bare-literal `zIndex` and no nearby comment naming what stacking context contains it — the question has to be asked in writing, not skipped under time pressure.
- **`scripts/check-changelog.mjs` blocked its own release process.** `npm version`'s `preversion` hook (`npm run verify` → `npm run check` → this script) runs *before* npm bumps `package.json` — so on a correctly-prepared release, where the CHANGELOG entry for the upcoming version is deliberately written first, the check saw `package.json` one release behind the heading it was about to release and aborted `npm version` before it did anything. Hit twice in one day. Fixed by trusting `npm_new_version` (set once by the outermost `npm version` and confirmed to survive the `preversion → verify → check` nesting unchanged, unlike `npm_lifecycle_event`, which resets to each nested script's own name) to recognise "the newest heading is the release currently being prepared" as distinct from a genuinely stale or wrong one — which a plain `npm run check`, CI, or a stray manual edit (none of which set that variable) still catch exactly as strictly as before. Verified end to end in an isolated throwaway clone: `npm version minor` ran preversion (full check + all 664 tests), bumped to 0.25.0, passed the post-bump changelog check, and tagged `v0.25.0` correctly.

## [0.24.3] — 2026-08-25

### Fixed

- **The die-list modal's font rendered at browser-default size (larger, unstyled) when opened from a wafer detached into its own popup window**, instead of the intended `11px`. `dieList.ts` injected its `.wmap-dielist-table` stylesheet into the bare global `document` and built every table element the same way — correct for the modal's in-page case (same document as the stylesheet), but wrong once the modal's own anchor-based root resolution correctly placed the box inside a *different* document (the popup's), which never received the `<style>` tag. Fixed by threading an `ownerDocument` through `DieListOptions`/`buildDieListSection` (a new optional field, additive) and `openDieListModal`'s `openModal` call, and switching the module's one-shot `stylesInjected` boolean to a `WeakSet<Document>` keyed per document — a single global flag would have left every *other* document's `<head>` permanently unstyled once the first one injected the rule.
- **The die-list modal's heading and table sat flush against the box edge**, with no gutter on any side. `openOverlay`'s `contentWrap` carries no padding by design (some callers, e.g. the reparented expand modal, want edge-to-edge content) — the other two `buildDieListSection` call sites each sit inside a parent that already pads its own content, but the modal path never did. `openDieListModal` now sets `contentWrap.style.padding` explicitly.
- **The toolbar's "Data warnings" popup could render off-screen or clipped when opened from a wafer detached into its own (typically narrower) popup window.** `buildWarningsMenuEl` took an `ownerWindow` parameter for its own right-edge-avoidance math, but neither call site (`renderWaferMap.ts`, `renderWaferGallery.ts`) actually passed it, so the menu was always positioned against the *host page's* `window.innerWidth` regardless of which window it was actually rendering in. Both call sites now pass the button's own `ownerDocument.defaultView`. `buildWarningsBanner` (the Summary panel's warnings block) gained the same doc-aware fix as a matching drift item, even though it had no visible symptom (the DOM adopts nodes created in the wrong document without erroring, which is why this class of bug is silent rather than a crash).
- **The in-app user guide could open with its live demo widgets non-functional, or its `window.open()` popup could be flagged by the wrong window's popup-blocking heuristics**, when the triggering help button lived on a render inside a detached popup window. `openUserGuideWindow` called the bare global `window.open()`, and its in-page fallback (`openGuideInFloatingWindow`) built the guide's content via the bare global `document`/`window` regardless of the anchor's actual document — both now derive from `anchor.ownerDocument`/its `defaultView`.
- **`docs/guide.md`'s link to API §5.4.4 was dead in the built docs site.** The heading `#### 5.4.4 Die list & CSV export` was hand-linked using GitHub's anchor-slug convention (`#544-die-list--csv-export`, preserving the double hyphen `&` leaves behind), but Zensical collapses repeated separators when generating heading ids (`#544-die-list-csv-export`, single hyphen) — a different convention from GitHub's, not a Zensical bug. `npm run build:site` reports this class of mismatch only as a non-fatal build warning, so it shipped silently. Every other internal anchor link across `docs/*.md` was checked against the actual built ids and found correct — this was an isolated case, not a pattern.

### Added

- `DieListOptions.ownerDocument` (optional) — the document `buildDieListSection` builds its table and injects its stylesheet into. Only relevant for a host mounting the table into a different document than the bare global (e.g. inside a popup window); every existing call is unaffected.
- Two new themeable colour tokens, `CLR.barFill`/`CLR.barFillMuted` (`--wmap-bar-fill`/`--wmap-bar-fill-muted`), replacing two colours the Summary panel's yield/ring/quadrant progress bars had hardcoded directly instead of exposing to host theming. Documented in `docs/api.md` §5.4.1's token reference table alongside the rest.

### Changed

- The Summary panel's own corner radius is now `6px`, matching `UI_STANDARDS.md`'s documented radius for "larger panel-level surfaces" (it was `8px`, an unexplained one-off).

### Internal

- `UI_STANDARDS.md` gained three new conventions, prompted by the bugs above and by two z-stacking bugs fixed the same day in v0.24.1 (die-list modal opening behind a host's own `<dialog>`) — all four shared the same shape: a parameter typed optional enough that omitting it by accident compiles cleanly and ships. Documented: every `openModal`/`openFloatingWindow` call site must pass `anchor`; modal/overlay content must set its own `contentWrap` padding (there is no default); and any content that might render inside a detached popup window must thread an `ownerDocument`/`doc` parameter through element creation and `<style>` injection rather than using the bare global.
- Every element-creation site across `renderWaferMap.ts`, `renderWaferGallery.ts`, `insightsTab.ts`, `metadataBadge.ts`, and all nine `charts/*.ts` panels (barPanel, binCluster, boxplot, capability, correlation, histogram, scatter, regionYieldDiagram, and the shared `chartShell.ts` primitives they're all built from — `cardShell`, `makeSegmented`, `makeBackButton`, `makeToggle`, `makeLabeledSelect`, `makeWaferSelect`, `makeChartGridWrap`, `makeTooltip`, `renderEmptyState`, `saveCanvasPng`) now threads an `ownerDocument` down from the render's own container instead of the bare global `document` — closing the cross-document gap completely, not just at the shared toolbar primitives (`buildCheckMenuEl`, `makeDropdown`, `makeSearchableTestCombo`/`makeTestSelect`, `makeMenuSearchBox`, `summaryPanel.ts`'s internal `el()`/`createSummaryPanelEl`), which were the first pass. Also covers the one non-element-creation instance of the same bug class: `wireMenuKeyboard`'s roving-focus arrow-key handling read the bare global `document.activeElement`, which would have silently broken keyboard navigation in every correctly-doc-aware menu this pass fixed, in the one context (a detached popup) it was fixing them for. All new parameters are optional and default to the bare global, so this is additive, not breaking.
- New `scripts/check-overlay-conventions.mjs`, wired into `npm run check` — fails the build if a new `openModal`/`openFloatingWindow` call site omits `anchor`, or a new `<style>`-injection site hardcodes `document.head.appendChild` instead of a threaded document. Both conventions above are now enforced, not only documented.

## [0.24.2] — 2026-08-24

### Fixed

- **The die-list modal had no reachable vertical scrollbar when the table was wide.** The
  section and its scroll container set `min-height: 0` but not `min-width: 0`. A flex item's
  default `min-width: auto` refuses to shrink below its content's intrinsic minimum, and every
  cell in this table is `white-space: nowrap` — so a wafer carrying many long test-name columns
  (e.g. "Continuity check for TESTMODE pin") stretched the whole section far past its modal.
  The overflow was then clipped by the modal's own `overflow: hidden`, dragging the scroll
  container's vertical scrollbar off the right-hand edge where it could not be seen or used.
  The table looked unscrollable, showing only a stray horizontal scrollbar, with the
  "Export CSV" button and the start of the heading pushed out of view. Both containers now set
  `min-width: 0` alongside `min-height: 0`, so the section stays modal-width and both
  scrollbars work. A narrow table was unaffected, which is why this did not show up in the
  library's own examples.

## [0.24.1] — 2026-08-24

### Fixed

- **The die-list modal (§5.4.4, new in 0.24.0) opened behind a host's own modal/dialog.**
  `openDieListModal` called `openModal()` with no `anchor`, so it built onto bare `doc.body` —
  which sits behind a host's native `<dialog>` (shown via `.showModal()`, promoted to the
  browser's top layer) regardless of z-index. Every other `openModal` call site in this
  codebase already passes one; this is now anchored on the Summary panel element.
- **The "Summary report" / lot report popup could be silently blocked and treated as a popup
  ad.** `openHtmlReport` used `window.open('', '_blank')` followed by `document.write` — the
  blank-window-then-write sequence many browsers and ad-blocking extensions specifically
  fingerprint, since it's how popup ads worked for years. Now builds a `Blob` URL and passes
  it directly to `window.open`, a real URL, which is treated far more leniently and is
  unaffected by CSP contexts that block `document.write` outright. The still-possible blocked
  case (an aggressive blocker, or an environment with no real `window.open` at all, e.g.
  Tauri's WebView) now logs a `console.warn` naming `setReportOpener` as the fix, instead of
  failing completely silently as before.

## [0.24.0] — 2026-08-24

### Breaking

- **`buildDieListSection`/`RenderOptions.dieList` now caps rendered rows at `maxRows` (default
  `50_000`)**, where the table previously rendered every die unconditionally. This table has
  no virtualisation, so an uncapped multi-hundred-thousand-die lot was already a genuinely
  heavy DOM build (~1.3M elements at 266k dies) before this release added metadata columns —
  without the cap, adding columns would have made that worst case materially worse rather than
  strictly better. The **CSV export is never capped**; it always contains every die, and a
  footer states the truncation explicitly whenever it applies (`"Showing the first 50,000 of
  266,412 dies. The CSV export contains all 266,412."`). A host that needs every row on screen
  regardless of scale can set `maxRows` to a larger value or `Infinity`.

### Added

- **Metadata now reaches the die-list table and its CSV export**, and the two per-test CSVs
  (`test-values.csv`, `functional-tests.csv`) gain wafer identity. Previously no export surface
  in the library emitted `die.metadata` at all — only the hover tooltip and the `'metadata'`
  plot mode did — and none of the three CSVs emitted wafer metadata either, despite the HTML
  reports already doing so.
  - **Die metadata** (`DieMetadata`) is on by default in `buildDieListSection`
    (`DieListOptions.metadataColumns`, default `'auto'`) — every key found on any die,
    deterministically ordered (`metadataFields` declaration order first, then natural sort).
    Unlike `metadataFields` gating the `'metadata'` plot mode (a legend has a cardinality
    limit), a table column has none, so auto-discovery here does not conflict with that rule —
    it follows the same intent. Pass an explicit `string[]` to pin the set, or `'none'` to omit.
  - **Wafer metadata** (`WaferMetadata`) is CSV-only by default
    (`DieListOptions.waferMetadataColumns`, default `'csv'`) — constant down every row, so it's
    noise on screen next to the always-visible metadata badge, but it's what makes a detached
    CSV self-describing enough to concatenate several exports and still know which wafer each
    row came from. Set `'both'` to also show it in the table, or `'none'` to omit it entirely.
  - A key present on both a wafer and a die produces exactly **one** column, scope `die`,
    carrying the die's value — the same shadowing rule the hover tooltip already applied.
  - Column labels resolve `metadataFields[].label` → `prettyKey(key)` → the raw key, matching
    every other column's human-readable header. A key colliding with a built-in column name
    (e.g. a metadata key literally called `Site`) is never dropped — it becomes
    `"Site (metadata)"`, with further deterministic fallbacks for the rare case that also
    collides.
  - `RenderOptions.dieList?: DieListDisplayOptions` reaches the built-in die-list view (the
    coordinate-less map replacement, and the "+N dies without position" footer), which
    previously had no host hook at all. The wafer metadata and `metadataFields` it needs are
    always supplied by the library from the current build result, never from this option, so a
    host mistake can't substitute the wrong identity data into an export.
  - `buildTestSection`/`buildFunctionalTestSection`/`buildLotTestSection`/
    `buildLotFunctionalSection` (internal to the Summary/Insights panels) gained a trailing
    `CsvExportContext` — the two lot variants self-derive it from the `perWaferSummaries` they
    already receive, so `renderWaferGallery`'s Insights tab and the lot Summary panel needed no
    call-site changes. A mixed lot (no metadata field common to every wafer) emits no false
    identity column at all, rather than guessing.
- **"View die list" — every die as a table, reachable from the Summary panel**, on both
  `renderWaferMap` (this wafer's own dies) and `renderWaferGallery` (every wafer in the lot,
  pooled, with a leading `Wafer` column). Deliberately **not** a new toolbar button — reached
  as a link inside the already-open Summary panel, the same way "Summary report" opens the
  HTML report without one either, since the toolbar already carries eleven buttons and this
  reuses an existing entry point rather than adding a twelfth. **On by default** whenever a
  Summary panel is reachable at all (`RenderOptions.dieList`/`GalleryOptions.dieList`, set
  `{ enabled: false }` to hide it); opens wmap's own resizable modal, mounting
  `buildDieListSection` with the same metadata columns and CSV export the coordinate-less
  die-list view already has. The lot-pooled CSV's wafer-metadata columns use `commonMetadata`,
  so a mixed lot emits no false shared identity, same as the pooled per-test CSVs above.
- **`prettyKey`-labelled hover tooltip metadata.** `buildHoverText` now resolves a metadata
  key's label the same way the new table/CSV columns do (`metadataFields[].label` →
  `prettyKey(key)`), instead of printing the raw key. Brings the tooltip in line with every
  other metadata surface in the library rather than shipping the inconsistency for even one
  release. `HoverTextOptions` gained `metadataFields?: MetadataFieldDef[]`.
- New `@wafertools/wafermap/core` exports: `metadataDisplayValue(raw)` / `metadataCategoricalValue(raw)` —
  the single stringifier for a metadata value (display/export vs. categorical/colour-swatch
  use), replacing four near-identical inline implementations that had drifted (`buildView.ts`'s
  tooltip and `'metadata'`-mode read path, `summaryPanel.ts`'s `metadataEntries`, `facets.ts`'s
  `facetValueOf`). A `String(v)`-on-an-object bug in two of those four collapsed distinct object
  values into the indistinguishable `"[object Object]"`; all four now emit `JSON.stringify(v)`
  instead, so genuinely different values facet and export as genuinely different values.
- New `@wafertools/wafermap/stats` exports: `resolveMetadataColumns(options)` and
  `discoverDieMetadataKeys(dies, metadataFields?, limit?)` — the column resolver backing the
  above, public because a host building its own table/export over `die.metadata` shouldn't have
  to reimplement discovery, ordering, shadowing, and collision resolution from scratch.

## [0.23.1] — 2026-08-18

### Added

- **The Insights tab's chart cards, section grid, sub-tab bar, Group-by select, and toggle button now carry
  stable `data-wmap-*` hooks**, for tooling (screenshot capture, e2e tests, visual regression, accessibility
  audits) that needs to drive the tab from outside wmap's own code. Previously these nodes were bare —
  distinguishable only by exact heading text or button `textContent`, which breaks silently on any copy
  change. `cardShell()` sets `data-wmap-chart-card`/`data-wmap-chart-title` (the full title, so
  e.g. "Yield by wafer" and a hypothetical "Yield by wafer (grouped)" stay unambiguous); `makeChartGridWrap()`
  sets `data-wmap-chart-grid`; `makeLabeledSelect()` gained an `opts.hook` param (`select.dataset.wmapSelect`)
  since the same factory also builds every per-panel "Group:" restrict dropdown and the histogram wafer
  picker; `insightsTab.ts`'s sub-tab buttons set `data-wmap-insights-tab` to the view key
  (`overview`/`distributions`/`correlation`) and the back button sets `data-wmap-insights-back`; the Insights
  toggle button in both `renderWaferMap` and `renderWaferGallery` sets `data-wmap-insights-btn` — needed
  because its `aria-label` itself toggles between `'Insights'` and `'Back to wafer/gallery view'`, so
  `button[aria-label="Insights"]` only ever matched while closed.

### Fixed

- **Grid pitch inference no longer stretches the die aspect ratio when only one axis has real spread.** The
  circular-wafer constraint used to fill in an unknown aspect ratio whenever nearest-neighbour spacing looked
  square, even when one axis had only a single distinct position observed. A handful of positioned dies
  confined to one row (or column) isn't evidence the wafer is wider than it is tall — it just reflects which
  subset of dies happen to carry positions — so the constraint is now skipped on a degenerate axis (dropping
  confidence to 0.3), leaving the aspect ratio at the safer 1:1 default instead of guessing.

## [0.23.0] — 2026-08-16

### Breaking

- **`Die.x`/`y`/`physX`/`physY` are now optional**, not `number`. Existing code
  that reads `die.x` as a bare number (e.g. arithmetic without a guard) now gets
  a type error under strict TS — the runtime value for already-positioned data
  is unchanged, only the type widened. New `isPositionedDie(die): die is PositionedDie`
  (`@wafertools/wafermap/core`) narrows it back; every spatial function in the
  library (region builders, cluster/pattern detection, `buildView`) now takes
  `PositionedDie[]` rather than `Die[]`, so a caller passing unfiltered `Die[]`
  into one of these will see the type error at the call site rather than a
  runtime surprise. Its sibling `hasPosition(die)` is the looser guard for
  inputs that carry `x`/`y` but no `physX`/`physY` (a raw `DieResult`, before
  layout); use `isPositionedDie` for anything holding built `Die`s.

### Added

- **`renderWaferMap` accepts a `RenderableWaferMap`** — `{ wafer, dies }` plus
  every other `WaferMapResult` field as optional — rather than requiring a full
  `WaferMapResult`. A `WaferMapResult` still satisfies it, so no caller needs to
  change. This makes the gallery's own use honest: it renders each card through
  `renderWaferMap`, but a card is a `WaferMapDisplayItem` carrying no
  `dataCoverage`/`viewport`/`legendBox`/`binLegendRows`/`reticleConfig`, and it
  used to be passed via `item as WaferMapResult`. That cast asserted fields
  which were absent at runtime; reading one unguarded threw, and each such read
  had to be found by hitting it. `collectWarnings` likewise now types
  `result.warnings` as optional, which its body already handled.

- **Support for dies/wafers with no reported X/Y position.** Real-world data
  sometimes has no spatial layout at all (wafer-number-only test logs), or a
  lot/wafer where some dies report a position and others don't — previously
  such a die was silently dropped by every parser upstream of this library, and
  wmap itself had no representation for "no position" beyond crashing or
  drawing garbage.
  - `hasPosition(die)` / `isPositionedDie(die)` (`packages/core/dies.ts`) are
    the predicates every spatial code path filters on — the first narrows
    `x`/`y`, the second narrows `physX`/`physY` with them and so yields a
    `PositionedDie`. `getDieKey` falls back to `` `id:${id}` `` for an
    unpositioned die so two of them never collide.
  - `buildWaferMap` partitions positioned/unpositioned dies before geometry
    inference runs; unpositioned dies are folded back into the returned
    `dies`/`dataCoverage`/`yield` afterward. `dataCoverage` gained
    `unpositionedDies: number` (always present); `totalDies`/`filledDies`/
    `ratio` stay scoped to positioned dies only. Yield is deliberately
    **not** spatial — a coordinate-less die with bin data still counts toward
    it, same as `isYieldEligibleDie` always ignored position.
  - `analyzeWaferMap`/`regions.ts` exclude unpositioned dies from spatial
    region families only (ring/quadrant/sector/reticle-position, cluster and
    pattern detection). Everything value-based (yield, bin counts, per-test
    stats, spec-limit yield) is unaffected — coordinate-less dies still count.
  - A wafer with **zero** positioned dies never renders as a wafer-shaped
    visual — a fabricated mosaic risks being misread as real spatial data.
    `renderWaferMap`/`renderWaferGallery` instead show a compact,
    plot-mode-aware summary in its place: a bin breakdown (reusing the
    existing summary-panel component, so colours match the map's own bin
    legend) for hard/soft-bin modes, or a small histogram for value mode
    (coloured through the same colour-scheme/log-scale/spec-range resolution
    the map's own colorbar uses). A **View die list** toggle reaches the full
    per-die table (`buildDieListSection`, new, exported from `/render`) for
    CSV export and per-die inspection, and **View chart** returns. A mixed
    wafer keeps its normal map for the positioned dies, plus an expandable
    "+N dies without position data" footer giving the same chart/die-list
    toggle for the rest.
  - The toolbar's spatial-only controls (zoom/pan/select/download,
    orientation, overlays, legend position) are hidden on a fully
    coordinate-less card — nothing to act on with no map drawn. Plot mode and
    colour scheme stay, since both drive the summary's own appearance.
  - A gallery card's own "expand" button now preserves that card's live view
    state (plot mode, active test, colour scheme, …) when opening the
    detached window/popup, rather than always reverting to the gallery's
    shared default — a pre-existing gap for any card (not specific to
    coordinate-less data) that became far more visible once a card's
    representation could change shape between modes (bin breakdown vs.
    histogram vs. map).

### Fixed

- **`buildDieListSection`'s table was capped at a fixed 360px**, regardless of
  how much room its container actually had — a short table floated in a
  half-empty card, and a host mounting it inside a scrolling container of its
  own got two nested scrollbars. It now fills its container by default
  (`flex: 1; min-height: 0`); a new optional `maxHeight` re-imposes a cap for a
  host with no definite-height container to fill.

### Known gaps (not fixed this pass, tracked for a follow-up)

- Stacked plot modes (`stackedValues`/`stackedBins`/`stackedSoftBins`) discard
  every individual wafer card from the gallery grid and pool across the lot —
  a coordinate-less wafer's dies are correctly excluded from those pooled
  aggregates (stacking is inherently position-based), but nothing in the UI
  currently indicates a wafer was excluded; it's indistinguishable from that
  wafer not existing in the lot at all.
- `hasPosition`, `PositionedDie`, `dataCoverage.unpositionedDies`, and
  `buildDieListSection`/`DieListOptions` are documented in `docs/api.md`
  (§12.1, §7); a dedicated numbered reference entry for `hasPosition` and
  `buildDieListSection` alongside the library's other numbered API entries
  has not been added yet.

---

## [0.22.0] — 2026-08-04

### Breaking

- **`StatsSummary.stats.warnings` is now `WaferWarning[]`, not `string[]`.** The
  library raised advisories in two incompatible shapes — structured
  `{ code, message }` on `WaferMapResult.warnings`, raw prose strings on the stats
  summary — so a host had two vocabularies to handle and no stable key to branch
  on for half of them. Both are now `WaferWarning`.

  Migration: read `w.message` where you previously read the string, and branch on
  the new stable `w.code` (`'test-count-capped'` is the one raised today) instead
  of matching prose. Code that did `warnings[0].includes('…')` is exactly what
  this replaces — that string was never a contract.

- **`findTestDef`, `resolveTestNumber`, `getUniqueTestNumbers` and
  `generateTextOverlay` are no longer exported from `/renderer` (or the root).**
  They are internal helpers of the view pipeline with no documented contract, and
  nothing outside the library used them. An export nobody can look up is still API
  surface you cannot change later, so they were withdrawn rather than documented.

  Migration: none expected. If you did depend on one, import it from
  `@wafertools/wafermap/renderer/buildView.js` and open an issue saying what for —
  the fix is to give you a supported entry point, not to re-widen the surface.

### Added

- **The library now surfaces its own data warnings.** A ⚠ indicator appears in the
  toolbar only when there is something to say; clicking it lists each advisory with
  its code and explanation. It also feeds the Summary panel's banner and a new
  `onWarning` callback, all from one collected, de-duplicated, severity-ordered set.

  This closes a real gap rather than adding a nicety: **geometry advisories were
  rendered by no UI at all.** `'partial-coverage'` means the inferred diameter and
  centre may be wrong and dies may be drawn in the wrong place, and nothing ever
  told the person looking at the map. Analysis advisories fared little better — they
  appeared only if the host both passed `statsSummary` and the user opened the
  Summary panel. The library has the information to know the display may mislead,
  so showing it is its responsibility, not the caller's.

  Deliberately not a toast: these are persistent conditions about whether the map
  can be trusted, and a message that dismisses itself leaves the map still wrong
  with no way back to the explanation.

- **`WarningsOptions` on `renderWaferMap` and `renderWaferGallery`** —
  `{ display?: boolean; onWarning?: (warnings: WaferWarning[]) => void }`. Hosts
  with their own notification system pass `{ display: false, onWarning }`: the
  library still collects, de-duplicates and severity-orders, and the host owns only
  presentation. `collectWarnings` and `severityOf` are exported from
  `@wafertools/wafermap/render` so such a host can reproduce exactly the set the
  built-in UI would have shown rather than re-deriving it from two sources.

- **`WaferWarning.severity`** — `'error' | 'warning' | 'info'`, defaulting to
  `'warning'`. Geometry advisories are `'error'` (the map may be positionally
  wrong); the test-count cap is `'warning'` (a feature produced nothing, but what
  is drawn is correct). Drives the indicator's colour and ordering — and the
  severity is always in the accessible name too, never colour alone.

- New `--wmap-err-bg` / `--wmap-err-border` / `--wmap-err-text` theme tokens
  (9.55:1 contrast on their background, clearing WCAG AA on all three surfaces
  they appear on).


- **Downloadable examples package.** `site/wafermap-examples.zip`, built as part of
  `npm run build:site` and published alongside the docs. Contains every example, the
  bundled library, the sample datasets, and a `starter/` skeleton to copy as the seed
  of an application. Unzip, run `sh serve.sh` (or `serve.cmd` on Windows), and it works
  with no npm install and no network — the offline path matters for locked-down fab
  networks. The bundled `serve.py` pins the MIME type for `.js` rather than trusting
  the platform: Python's stdlib server reads MIME types from the Windows registry, and
  where that mapping has been altered it serves JavaScript as `text/plain`, which
  browsers refuse to execute as a module — failing every page on Windows while working
  on Linux.
- **`AGENTS.md` — usage rules for AI coding agents.** Most consumers now write wafer
  map code through Claude Code, Codex, Copilot or Cursor, and this library's inputs
  invite confident wrong guesses: `die.hbin ?? 0` reads as ordinary defensive coding
  but turns no-data dies into bin 0 and moves the yield number; `activeTest` reads
  like an index but is a test number. The file's core is a copy-paste block for the
  consumer's own agent config, surfaced at
  [/agents/](https://wafertools.github.io/wafermap/agents/), shipped in the npm
  package (`node_modules/@wafertools/wafermap/AGENTS.md`) and at the root of the
  examples archive. `scripts/check-agents-guide.mjs` verifies it against
  `dist/**/*.d.ts` on every `npm run check` and CI run — every recommended symbol
  must exist, every symbol in the removal table (parsed from the table itself, not a
  duplicate list) must be absent, and structural claims are checked rather than
  trusted. An agent guide that names a removed API is worse than none.
- `llms.txt` now ships in the npm package and the examples archive, with its
  repo-relative links replaced by absolute ones — they resolved to nothing in both
  of those locations.
- `docs/examples/manifest.json` — single source for the examples list, consumed by
  `demo-nav.js`, the `index.md` generator, the archive builder, and a nav consistency
  check wired into `npm run check` and the test suite.

### Changed

- **Findings no longer restate the same fact several times.** One edge failure
  could produce, per region: a hard-bin row, its soft-bin twin with an identical
  delta, a pass-bin row, and a yield row saying the same thing as the pass-bin row
  — up to seven rows for what an engineer would state in one sentence. Two exact
  redundancies now collapse:

  - A soft-bin finding whose hard-bin twin covers **provably the same dies** is
    absorbed, and the surviving row says so (`Hard and soft bin 3 (same dies)`).
    The test is die-set identity computed from the dies, never bin-number
    equality — hard and soft bins are independent number spaces, and merging on
    the number would report one population under the other's name.
  - When exactly one pass bin is configured, that bin's row and the yield row are
    the same statement by definition, so the bin row is absorbed into the yield
    row. With several pass bins no single bin equals yield, and the rule correctly
    does not fire.

  The surviving row names what it absorbed — "Ring 4 (edge) has hard bin 3 and
  soft bin 3 (same dies) occurrence 8.8 percentage points higher…" — rather than
  quietly dropping the other half. "(same dies)" is load-bearing: without it the
  wording could be read as two populations summed.

  This applies at lot level too. `analyzeWaferLot` skips per-wafer findings that
  were absorbed, so a twin does not reappear as its own lot row — which is where
  the duplication was most misleading, since every lot row is annotated "seen on
  N/M wafers" and one fact stated twice reads as two signals corroborating
  each other.

  Nothing is discarded: absorbed findings remain in `summary.findings` and are
  still returned by `filterFindings`. Only the Summary panel and the findings
  report hide them, via the new `StatsFinding.absorbedIds`.

- `StatsFinding.absorbedIds` — IDs of findings another finding restates. Kept
  separate from `relatedIds`, which already meant two different things (a
  run-merge's audit trail of constituents it *replaced*, which no longer exist,
  and a spatial pattern's live supporting detail). Anything in `absorbedIds` is
  guaranteed still present in `findings`.

- **Examples consolidated from 26 pages to 20.** Several demos differed only by which
  option was enabled. `findings`, `summary-panel`, `lot-findings`, `gallery` and
  `lot-stack-analysis` are now one `statistics.html` with a scope selector
  (single wafer / lot gallery / lot stack) whose banner names the exact calls and
  options in force; `color-schemes` folded into `display-control.html`, where the
  existing scheme dropdown already did the same job; `partial-data` folded into
  `geometry.html` as a second section. Every old URL keeps a redirect stub pointing at
  the merged page and the anchor that reproduces what it used to show, and the Guide
  cross-links now target those anchors, so per-topic granularity is unchanged.

- **Package renamed from `@paulrobins/wafermap` to `@wafertools/wafermap`.** The GitHub repo
  moved from `telecasterer/wafermap` to `wafertools/wafermap` along with it — repository,
  homepage, and issue-tracker URLs all point at the new org. `@paulrobins/wafermap` is
  deprecated on npm in favour of this package; no functional changes.

### Fixed

- **The toolbar could overflow across neighbouring content.** It is pinned by its
  right edge with no width bound, so once wider than its container the excess grew
  leftward — out of the card and over whatever sat beside it (the next map in a
  grid, an adjacent gallery card). It had always been wider than a ~400px
  container. It now wraps within the container, breaking between control groups
  rather than mid-group, with `wrap-reverse` so the trailing group keeps the top
  row and Expand keeps its top-right corner.


- **Custom colour schemes did not work on the built documentation site.**
  `scripts/bundle-docs.mjs` built each importmap entry point as an independent esbuild
  bundle, so `wafermap` and `wafermap/render` each inlined a private copy of the
  colour-scheme registry. `registerColorScheme` imported from `wafermap` wrote into a
  registry the renderer never read, and a custom scheme rendered pixel-identical to the
  default palette — silently, with no error. All entry points are now built in one
  invocation with code splitting, so shared module state lives in a common chunk. Only
  ever affected the bundled site build; `npm run dev` serves unbundled modules that
  resolve to one shared file, which is why it went unnoticed.

## [0.21.1] — 2026-07-31

### Added

- **`maxSize` render option** (`RenderOptions.maxSize` for `renderWaferMap`, `GalleryOptions.maxSize` for
  `renderWaferGallery`) — a single number of CSS pixels capping the rendered map (or each gallery card) in
  **both** width and height. Beyond the cap the map is aligned to the top-left of the space it was given
  rather than stretching to fill it, so a map on a large screen no longer expands to whatever size its
  container happens to be. Expanding (⛶ / `E`) still opens at full size; the cap governs the inline view only.

  `maxSize` is independent of the existing `height` option: `height` *establishes* the space a map renders
  into (`renderWaferMap` fills its container, which must therefore resolve a height), while `maxSize`
  *limits* how much of that space is used. They compose — `{ height: 600, maxSize: 400 }` is valid — and
  `maxSize` is not a substitute for giving the container a height.

### Fixed

- **A single-item gallery no longer stretches to the full container width and overflows vertically.** Gallery
  cards are square (`aspect-ratio: 1`) but were laid out in `1fr` grid tracks, so with one card the track took
  the container's entire width and the card's height grew to match it — on a wide screen that pushed the card
  well past the bottom of the viewport. The existing 480px `MAX_CARD_PX` constant did not prevent this: it only
  influenced how many columns to create, and never capped a card's rendered size.
- **The gallery's card-size calculation measured only the first wafer carrying dies, not the densest.** All
  cards are sized alike, so in a lot with mixed die pitches a coarse-pitch wafer arriving first would size the
  grid and silently starve a finer-pitch wafer later in the lot of the resolution needed to read it. The
  measurement now takes the densest wafer, and ignores a missing or zero die pitch rather than dividing by it.

### Changed

- **Gallery cards are now size-capped and pack from the left instead of stretching to fill the grid width.**
  Grid tracks changed from `1fr` to `minmax(0, cap)` with `justify-content: start`, so columns sit adjacent
  (separated only by the 12px gap) rather than spreading across the container with whitespace bands between
  them. Tracks still shrink below the cap on narrow containers, so no readability behaviour is lost.

  With no `maxSize` given, the cap is **derived from die density** rather than fixed: 480px for an ordinary
  wafer, widening as far as needed to keep dies at the existing 4px readability target, up to a 720px ceiling.
  A fixed 480px could not serve both ends of the DPW range — a 3mm-pitch (~7.9k DPW) wafer needs 524px for 4px
  dies and a 2mm-pitch (~17.7k DPW) wafer needs 724px, so at high DPW the old constant quietly abandoned the
  library's own readability target. Past the ceiling dies shrink rather than the card growing without bound.
  An explicit `maxSize` is a hard cap and is never widened for density — the caller owns that trade-off.

  This changes gallery layout for existing consumers (cards that previously filled the width are now capped).
  No public field, option, return value, or export changed type or semantics, so this remains a patch release
  per the versioning policy above; pass an explicit `maxSize` to take direct control of card size.

## [0.21.0] — 2026-07-30

### Breaking

Removal of long-deprecated aliases and the positional test-value path. This is a
minor bump (`0.21.0`) per the versioning policy above. Every removal below had a
documented non-deprecated replacement already in use.

- **`DieResult.values` / `Die.values` (positional test-value array) removed** — use
  `testValues`, keyed by test number. This was not merely clutter: the fallback read was
  spelled `die.testValues?.[tn] ?? die.values?.[tn]` in `analyzeWaferMap` and
  `aggregateValues`, i.e. it indexed a **positional array with a test number**, so for any
  real test number (`1050`) it silently resolved to `undefined` — while
  `renderSummaryReport` did it correctly via `def.index`. Two incompatible semantics for
  one field, in code that computes yield. Deleting it removes the wrong-data path.
- **`TestDef.index` removed and `TestDef.testNumber` is now required.** The
  `def.testNumber ?? def.index` idiom appeared at ~25 call sites across `renderer/`,
  `stats/` and `canvas-adapter/`; all now read `def.testNumber` directly.
- **`getDieTestValue(die, testNumber, fallbackIndex?)` → `getDieTestValue(die, testNumber)`.**
  The third parameter only existed to read the positional array.
- **`mapDataToDies` now writes `testValues` instead of appending to `values`.** Each call
  still attaches one value, keyed by how many are already present, so the first call lands
  at `testValues[0]` — the key `plotMode: 'value'` selects by default when no `testDefs`
  are supplied. Read the result as `die.testValues[0]`, not `die.values[0]`.
- **`ViewOptions.colorBySpec` / `WaferDisplayState.colorBySpec` removed** — use
  `passFailDisplay: 'spec'`. No rendering behaviour changed, and **`View.colorBySpec`
  remains** as a live output field (still `passFailDisplay === 'spec'`), so consumers
  reading it are unaffected.
- **`colorScheme: 'color'` removed** — use `'default'`. `ColorScheme.isAlias`, which
  existed only to hide this entry from `listColorSchemes()`, is gone with it.
- **`buildHoverText` now takes an options object:**
  `buildHoverText(die, plotMode, opts?)` where `opts` is
  `{ testDefs, hbinDefs, sbinDefs, fallbackFormat, aggrMethod, lotSize, waferMeta, activeTest, reticleConfig }`.
  It previously took **12 positional parameters, 11 optional**, including a dead
  `testLimit` at position 9 retained purely so positions 10–12 would not shift.
  `testLimit` is gone, as is the matching no-op `RenderOptions.tooltipTestLimit`.
- **Deprecated type/const aliases removed:** `HARD_BIN_COLORS` and `SOFT_BIN_COLORS`
  (use `BIN_PALETTE`), `CanvasHitTarget` (use `HitTarget`), `MountOptions` (use
  `RenderOptions`), `WaferCanvasController` (use `WaferMapController`), `GalleryItem` /
  `GalleryItemFactory` (use `WaferMapDisplayItem` / `WaferMapDisplayItemFactory`).

### Added

- **`resolveGridPitch` is now public** — exported from the root package and
  `@paulrobins/wafermap/core`, along with its `PitchResult` type. It already existed and
  is what `buildWaferMap` uses internally; it was simply unreachable through the public
  facade, so hosts re-derived pitch themselves and diverged from what the map rendered.
  This is the one deliberate exception to `core/inference/` being internal.

### Fixed

- **`aggregateValues`' documented contract now matches its behaviour.** Its JSDoc
  described `paramIndex` as "which index in `die.values[]`" while the code read
  `die.testValues[paramIndex]` — a test-number key. The two readings disagreed for every
  real test number.

### Documentation

- The root vs `/render` entry-point split is now stated explicitly in `README.md`,
  `docs/api.md` §10, and as a named symptom in `docs/troubleshooting.md`.
  `renderWaferMap`/`renderWaferGallery`/`toCanvas` are exported **only** from
  `@paulrobins/wafermap/render` — the root entry stays DOM-free and tree-shakeable — but
  nothing said so, and the failed root import is the first thing a new user hits.

## [0.20.9] — 2026-07-28

### Fixed

- **Wafer geometry no longer invents "partial" dies that cannot physically exist.** A die carrying test results is a real tested prober position, and a prober only steps to sites lying entirely on the wafer — a prober map never contains edge-straddling dies. The library had this backwards: it derived `partial` by testing die corners against the (usually *inferred*) wafer circle, treating the guessed geometry as truth and the measured data as suspect. An undersized circle therefore manufactured partial dies, greyed them out, and silently dropped them from yield. Measured before the fix: `waferConfig.diameter` supplied without `dieConfig.width`/`height` flagged **124 of 400** real probed sites partial with 84 centres outside the wafer, and even `docs/data/dummy-fulldata.csv` with no config produced 4 phantom partial dies. Three changes:
  - Dies built from `results` are never `partial`. The flag stays meaningful for a synthesized grid clipped to a wafer (`clipDiesToWafer`), where straddling dies legitimately arise.
  - **Inferred** geometry is floored so it always fully contains every die (`inferWaferFromXY` gained `minRadius`; snapping now steps *up* to the next standard size rather than down through real data). The normalized-units path likewise uses the true maximum corner extent instead of a 98th-percentile, since every die is a real probed site and there are no outliers to trim.
  - **Caller-supplied** geometry gets two new advisories on `result.warnings` (structured, with a stable `code`) and the deprecated `result.inference.warnings` (strings, mirrored):
    - **`'geometry-conflict'`** — `waferConfig.diameter` **and** `dieConfig.width`/`height` were both supplied and contradict each other (the dies don't fit). Not silently resized — you asserted both values — but reported precisely, naming how many dies don't fit and the diameter actually required at the pitch in use.
    - **`'inferred-pitch'`** — `waferConfig.diameter` was supplied **without** a die pitch. This is deliberately *not* a fit check: pitch is a free scaling parameter (for any grid and any diameter there is always a pitch small enough to fit), and the inference used in this case derives `pitch = diameter ÷ gridSpan`, which makes the data span the diameter edge-to-edge by construction — a fit check here would fire on perfectly good full-wafer data, reporting a contradiction it had itself created. It instead flags the unverifiable assumption and points at `dieConfig.width`/`height`, which is what actually fixes placement.

  Yield and any `partial`-excluding statistic will shift slightly on datasets that previously produced phantom partial dies — in the correct direction, since those dies are real measured results that were being discarded.

## [0.20.8] — 2026-07-28

### Added

- **Affine display-transform primitives** (`affineIdentity`/`affineRotation`/`affineMirror`/`affineCompose`/`affineInvert`/`affinePoint`/`affineVector`/`affineSwapsAxes`, plus the `Affine` and `CoordFrame` types) — exported from `@paulrobins/wafermap` and `@paulrobins/wafermap/core`. Every rotation and mirror in the library now composes through this one type, and `View` exposes the resulting `gridToScreen` matrix so a custom `toCanvas` pipeline can place its own overlays without re-deriving rotation/flip by hand. See `docs/api.md` §11.21.
- **`View.dataAxisFlip`** — the data-pipeline axis flip alone, with no interactive flip mixed in. `View.axisFlip` (data XOR interactive) was previously read back as if it were data-only when rebuilding a view, which would double-count an active interactive flip.

### Changed

- **Internal geometry rewrite: all display transforms now compose through a single affine matrix.** The library carried five separate implementations of "apply rotation + flip" and four different, partly-inconsistent answers to "which subset of the transforms has already been applied to this geometry?" — the structural cause of the reticle defects fixed in 0.20.6/0.20.7 and of the three further defects fixed below. Transforms are now built once per view as three explicitly-named, frame-tagged matrices (`physicalToScreen` for physical wafer features, `gridToScreen` for die-grid-aligned geometry, `bakedToScreen` for die centres), with the coordinate frame carried in the *type* so composing in the wrong order or transforming a point from the wrong frame is a compile error. `View.axisFlip`/`View.rotation` are retained but documented as a lossy summary — a summed angle plus XOR'd flip flags provably cannot represent `rotate → mirror → rotate`, since rotation and mirroring don't commute. No public behaviour change beyond the fixes below. Side benefit: `transformDies` now makes a single pass instead of allocating up to three full copies of the die array.
- **Library-wide deduplication pass.** An audit prompted by the geometry work above (whose root cause was duplicated logic) found the same pattern in nine more places; each is now a single implementation:
  - `getDieKey` was exported and documented, yet **33 call sites across 10 files** built the `"x,y"` key with their own template literal. Findings carry `dieKeys` in exactly this format and the renderer resolves click-to-highlight by matching them, so one site formatting differently breaks highlighting silently. The canonical implementation moved to `core/dies.ts` (so `stats/` and `canvas-adapter/` can share it without depending on `renderer/`) and is still re-exported from `renderer/` — the public API is unchanged; `getDieKey` is now additionally available from `@paulrobins/wafermap/core`.
  - **Plot-mode availability** (`buildDataModeEntries`, `metadataKeyHasData`, `metadataModeEntry` in `toolbar.ts`) — `renderWaferMap` and `renderWaferGallery` each derived which modes the data supports. Two copies of a *validity* derivation can disagree about which modes are offered, and adding a plot mode meant remembering both. The one real difference (stacked modes require `view.isLotStack` for a single map; the gallery aggregates its own items and always offers them) is now an explicit parameter.
  - `percentile98` (byte-identical in `core/inference/wafer.ts` and `renderer/buildWaferMap.ts`), `quantile` (`stats/math.ts` plus a second copy inside `stats/analyzeWaferMap.ts` that lacked the empty-input guard), `median`/`medianOf`, `mean`, `clamp01`, and `prettyKey`/`titleCaseMetadataKey` (which carried a "keep in sync" comment — a comment is not a mechanism) now live in `core/utils.ts`.
  - `mean([])` deliberately returns **NaN**, not `0`: it feeds Welch comparisons and effect sizes, where "no data" must never masquerade as a real measurement of zero. This preserves the prior behaviour of the stats-local copy it replaced.
- **`'metadata'` plot mode now orders values naturally (alphanumerically) instead of lexicographically.** Values like `D0, D1, D2, … D10, D11` previously sorted as `D0, D1, D10, D11, D2` — semiconductor labels are overwhelmingly `<prefix><number>`, so the legend read as scrambled. Since this ordering also assigns the colour palette, **dies may be coloured differently than in 0.20.6/0.20.7** for metadata fields with numbered values; the mapping remains deterministic and stable across reloads. The comparator (`compareNatural`, `core/utils.ts`) pins locale `'en'` so colour assignment is reproducible across machines, and is now the single implementation behind the metadata legend, the on-canvas legend, the gallery's lot-level legend strip, facet tables, and yield-chart row ordering — five call sites that previously sorted three different ways.

### Fixed

- **The +X/+Y axis indicator pointed the wrong way under any data-pipeline axis flip** (`dieConfig.xAxisDirection`/`yAxisDirection`, or a non-`'center'` `coordinateOrigin`). The arrows were built from a transform that carried the *interactive* flip only and silently dropped the data-axis flip, so they indicated the opposite of the direction the die indices actually run — while the axis **tick labels** on the same map (which do account for it) said the opposite. An engineer reading orientation off the indicator read it backwards. The arrows are now transformed as direction vectors through the die-grid transform.
- **Die rectangles overlapped their neighbours when a non-square die pitch met a baked wafer orientation.** The 90°/270° width/height swap was decided from the interactive rotation alone, but die *centres* already carry `wafer.orientation`; a die rectangle is axis-aligned in the pre-bake grid frame, so the swap must include that baked rotation. With `dieConfig { width: 10, height: 4 }` and `waferConfig.orientation: 90`, neighbouring dies landed 4 mm apart on screen while each was still drawn 9.5 mm wide — **every die overlapping its neighbour by 5.5 mm**. The swap is now derived from the full grid→screen transform. This also sized the finding-highlight selection ring, which inherited the same wrong shape.
- **Axis tick labels could name the wrong die coordinate when a wafer orientation, a data-axis flip and an interactive rotation were combined.** Labels were derived by hand-inverting a summed rotation plus XOR'd flip flags — a representation that cannot express `rotate → mirror → rotate`, because rotation and mirroring don't commute (`mirror ∘ rot(θ) = rot(−θ) ∘ mirror`), making it exact only while `wafer.orientation` is `0`. With `orientation: 90` + `xAxisDirection: 'left'` + interactive `rotation: 90`, the model placed a die 30 mm from where it actually was — i.e. labels mirrored relative to the dies, violating the guarantee that all coordinates shown to the user are true `die.x`/`die.y` grid coordinates. Tick labels (and their spacing) are now derived by inverting the authoritative `gridToScreen` matrix.

## [0.20.7] — 2026-07-28

### Added

- **`Reticle (column, row)` tooltip line** — when a `reticleConfig` is configured, every die's hover tooltip now shows its field-local position directly below `Die (x, y)`, independent of whether the reticle overlay is toggled on. `buildHoverText` gained a new optional trailing `reticleConfig` parameter for custom `toCanvas` pipelines; `renderWaferMap`/`renderWaferGallery` pass it automatically. See `docs/guide.md` §15 and `docs/api.md` §11.16.
- **`getReticleCell(die, config)`** (new export from `@paulrobins/wafermap` / `@paulrobins/wafermap/core`) — the shared, single source of truth for a die's field-local `(column, row)` within its reticle field. See `docs/api.md` §11.21.

### Fixed

- **Reticle-position findings could be mislabeled.** `buildReticlePositionRegions` (the stats engine's reticle-position region builder) independently re-derived a die's field-local column/row with the anchor sign inverted (`die.x + anchorDie.x` instead of `die.x - anchorDie.x`), a bug distinct from — and not caught by — the reticle *geometry* fix in 0.20.6. Because the error was a constant shift applied uniformly, the dies grouped into each finding were still correct (the right field was highlighted on the map); only the printed cell label was wrong, by `2 × anchorDie mod (width, height)` — invisible whenever `anchorDie` was `{0,0}` (the default), which is why it slipped through the 0.20.6 review. `buildReticlePositionRegions` now calls the new shared `getReticleCell` helper instead of reimplementing the phase math, so the geometry and the label can no longer drift apart.
- **The drawn reticle overlay could box the wrong dies together — a correctness bug, not just a display glitch — under any non-default grid/display convention: `dieConfig.xAxisDirection`/`yAxisDirection`, any non-`'center'` `coordinateOrigin` (`'LL'`/`'UL'`/`'LR'`/`'UR'`), `waferConfig.orientation`/`notch`, or the interactive rotate/flip toolbar buttons.** `generateReticleGrid` computes field rectangles in the pre-transform physical frame, but `die.physX/physY` already has `wafer.orientation` and the resolved axis flip baked in by the time the reticle geometry was filtered and drawn — two mismatched frames. Two independent effects, both confirmed empirically before the fix:
  - `buildReticles`' "drop fields with no dies" filter compared un-transformed candidate rectangles against already-transformed die positions, so it could wrongly drop fields that did contain dies (reproduced: 9 of 27 dies left with no covering field under a 90° wafer orientation).
  - The drawn overlay itself never replayed the *data-pipeline* axis flip (`xAxisDirection`/`yAxisDirection`/`coordinateOrigin`) at all — only wafer orientation and the *interactive* flip were accounted for — so under `xAxisDirection: 'left'` (for example) the field boundaries were geometrically regular and looked plausible, but silently grouped a different, shifted set of dies than what `anchorDie` specifies (reproduced: dies `{-2,-1}`/`{0,1}`/`{2,3}` in the default case became `{-3,-2}`/`{-1,0}`/`{1,2}` under the flip — every die shifted one field over).

  Fixed by replaying the exact same bake dies go through (`applyOrientation` then `transformDies`, in that order) on the reticle geometry too: `buildReticles`' filter now bakes each candidate's corners the same way before testing containment (`packages/renderer/buildWaferMap.ts`), and `buildReticleOverlays` now transforms each reticle's corners through two explicit sequential steps — bake (orientation + data-pipeline flip) then interactive (rotation + flip) — via the new shared `rotateAndFlip` primitive (`packages/core/transforms.ts`), rather than collapsing both rotations into one angle (invalid whenever a mirror sits between them, since rotation and mirroring don't commute). Regression-tested against the actual invariant that matters — which dies get grouped into the same drawn field must be identical to the default (untransformed) grouping — across every axis-direction/origin/orientation/interactive-transform combination (`tests/reticle.test.mjs`).

  Reticle-position **findings** and the **tooltip's** `Reticle (column, row)` line were never affected by this — both are computed from `die.x`/`die.y` (raw grid indices), which no display transform ever touches — only the drawn overlay rectangles and the "does this field have any dies" filter were wrong.

  Verified beyond the default case: every `coordinateOrigin` corner, non-90°-multiple rotation angles (`wafer.orientation`/`interactiveTransform.rotation` accept arbitrary degrees), every transform stacked simultaneously (data-pipeline flip + wafer orientation + interactive rotation + interactive flip all nonzero at once), and a non-zero `anchorDie` combined with each of the above (the original bug report's exact scenario).
- **`buildWaferMap({ dies })` (the explicit pre-built-`Die[]` input path) ignored `waferConfig.orientation` entirely** — found while verifying the fix above. Unlike the normal `results`-based path, this path never ran `applyOrientation` on the caller's dies, while the reticle (and quadrant-boundary) overlay always rotated by `wafer.orientation` regardless of input path. Reproduced: 6 of 7 dies left with no covering reticle field at `orientation: 90`. This is a narrower, separate, pre-existing gap — not introduced by the fix above — now closed the same way: `applyOrientation` is applied to explicit dies too, matching the primary path.

## [0.20.6] — 2026-07-28

### Added

- **`'metadata'` plot mode** — colour, legend, and label dies by an arbitrary `die.metadata` key instead of a test result or bin, for wafer data whose grid represents a layout/classification field (e.g. per-die product/project ownership on a multiproject wafer) rather than a measurement. Opt in per key via the new `metadataFields` option on `buildWaferMap` (`MetadataFieldDef`: `key`, optional `label`, optional per-value `{ value, label, color }` overrides) — a key is only selectable once named there, never auto-detected. Distinct values are auto-collected, auto-labelled, and auto-coloured from a dedicated ordered palette (deterministic, alphabetical — independent of die iteration order and of the map's `colorScheme`, which has no meaning for an arbitrary categorical field). Supported end-to-end: toolbar mode-menu entry per configured field (single-map and per-card in the gallery), legend with click-to-highlight (`highlightMetadataValue`, dims non-matching dies exactly like the existing bin highlight), map title, and die-label text. The tooltip already showed `die.metadata` for every plot mode before this change, so no new tooltip code was needed. Deliberately **not** available as a lot-stacked mode — a layout/classification field is a constant of the design, not a per-wafer measurement, so there is no meaningful cross-lot aggregation for it. New demo: `docs/examples/metadata-mode.html`; see `docs/guide.md` §21 and `docs/api.md`.

### Fixed

- Metadata-mode legend swatch colours could disagree with the colour a die was actually filled with, when a metadata value existed only on partial or edge-excluded dies (which never receive a metadata fill themselves) — the colour ranking scan and the legend's population were built from two differently-filtered passes over the dies. Both now read from one colour map built from a single, consistently-filtered scan.
- An unlabeled `metadataFields` entry showed a different name in the toolbar dropdown (Title Case, e.g. "Project") than in the on-canvas map title (raw key, e.g. "project"). Both now agree.
- Reticle field boundaries could drift off die edges for wafer data whose die grid is not centred on the wafer by a whole die pitch (e.g. partial/off-centre coverage) — `generateReticleGrid` placed fields relative to the wafer centre regardless of that fractional remainder. `buildWaferMap` now passes the die grid's actual physical origin through to reticle placement.
- Reticle overlay lines could render invisibly thin/flat against a same-toned die fill or the canvas background — reticle boundaries now use the same dual-stroke (dark halo + light core) technique as ring/quadrant boundaries, instead of a plain single stroke.

## [0.20.5] — 2026-07-25

### Fixed

- `fmt()`/`fmtColorbarAxis()` no longer double-prefix a value when its `unit` is already SI-prefixed (e.g. a test def with `unit: 'MHz'` or `'nA'`) — previously rendered nonsense like "1.50 kMHz" instead of "1.50 GHz". Affects every display path that formats a unit-bearing value: tooltips, the colorbar legend, Insights charts, the summary panel, and printable reports.
- Tooltips, toolbar menus, the expand modal, and the user-guide window's in-page fallback now render correctly when the map is embedded inside a host's own modal built on the native `<dialog>` element (shown via `.showModal()`). Previously these overlays always appended to `document.body`, which sits behind a `<dialog>`'s browser-level "top layer" regardless of `z-index` — no host configuration could work around it. wmap now detects a modally-shown `<dialog>` ancestor and roots its overlays inside it automatically. Unrelated to the existing `zIndex` option, which only applies to ordinary (non-`<dialog>`) host modals.

## [0.20.4] — 2026-07-21

### Fixed

- The Test Value submenu (shown when a wafer has more than 6 tests) and the Insights chart-panel hover tooltips now clamp to the viewport instead of overflowing off the right/bottom edge of the screen.
- The wafer-map and chart-panel "expand into a modal" feature no longer risks a stale-reference error on close (when two reparented elements' original DOM order interfered with restoring the first) or a duplicate, nested modal if the same content is expanded again while already expanded.
- Printing an expanded wafer-map/chart modal, or the in-app user guide window, now prints the actual content instead of a blank or single clipped page.
- Click-outside-to-close menu listeners (map/gallery toolbars) and the user guide's live demo widgets now correctly target the document the container or popup window actually belongs to, rather than the host page's document — previously this could leave dropdown menus unable to close, or leak `ResizeObserver`/`matchMedia` listeners, inside a detached gallery-card popup or the guide's floating-window fallback.
- The **Expand** toolbar button (and its `E` shortcut) is now hidden while the Insights tab is open, instead of remaining visible but producing a blank view when clicked. Each chart panel inside Insights has its own expand button for enlarging just that chart. Developer guide and API reference corrected to match (both previously described the old, pre-fix behaviour).

### Added

- A version + build-time banner is now logged once to the console on first render, and shown in the in-app user guide's header — makes it possible to tell which build is actually loaded during linked local development, where `package.json`'s version alone doesn't change between edits. Dev/debugging aid only, not part of the public API.

## [0.20.3] — 2026-07-19

### Added

- **Functional tests** — a test with no measured value, only a recorded pass/fail outcome (continuity, boundary scan, or any other go/no-go test). Set `testType: 'F'` on a `TestDef` (default `'P'`, parametric) and record the outcome per die in the new `DieResult.testPass: Record<number, boolean>`, keyed by `testNumber` like `testValues`. Functional tests are excluded from every parametric statistic (per-test stats, capability, correlation, distribution charts, value stacks, regional value findings) and instead get pass-rate analysis: `stats.functionalYield`, a "Functional Tests" table in the summary panel, and regional pass-rate findings (`kind: 'functionalTest'`).
- **`passFailDisplay: 'off' | 'spec' | 'test'`** (`WaferViewOptions`, `ToCanvasOptions`) — replaces the boolean `colorBySpec` with a two-way choice: `'spec'` judges dies against the active test's spec limits (unchanged behaviour, still the `colorBySpec: true` equivalent); `'test'` colours dies by the tester's own verdict (`die.testPass`) instead, green pass / red fail, undirected. The library resolves the effective display and degrades an invalid request to `'off'`; a functional active test always renders as `'test'`. Toggled via two entries in the Overlays toolbar menu ("Spec pass/fail", "Test pass/fail"), each shown only when valid for the active test. The map title's secondary line names which is shown — `Spec pass/fail`, `Tester pass/fail`, or `Functional pass/fail`.
- New helper exports from `@paulrobins/wafermap`: `getTestPassStatus(die, testNumber, testDef?)` (the single read-path for verdicts — reads `testPass` first, then falls back to a legacy 0/1 `testValues` encoding for functional tests with no `testPass` entry), `dieHasTestData(die)`, and `isParametricTest(def)`.
- `computeFunctionalYield(dies, testDefs)` (`@paulrobins/wafermap/stats`) — the pure per-test pass-rate computation backing `stats.functionalYield`.

### Changed

- `colorBySpec: boolean` (`WaferViewOptions`, `ToCanvasOptions`) is now a deprecated alias for `passFailDisplay: 'spec'`, ignored whenever `passFailDisplay` is set.

## [0.20.2] — 2026-07-16

Design-review pass over the newer UI surfaces (Insights, Summary panel, findings). Visual and display-language changes only — no public API changes; the chart panels' `colorScheme` option is now deliberately ignored where colour used to carry no information (interfaces unchanged for compatibility).

### Changed

- **Insights chart colours decoupled from the wafer map's value scheme** (new fixed chart palette, `canvas-adapter/charts/palette.ts`). The default thermal ramp rendered a 95% yield ring in saturated red, and data-range normalization could paint a *better* wafer more alarmingly than a worse one; the histogram re-encoded its own x-axis as a rainbow. Now:
  - **Quantity encodings** (yield bars, boxplot boxes, histogram mass) use one neutral blue — geometry carries the value; inherently colour-vision-safe.
  - **Ring/quadrant yield diagrams** use a fixed-domain sequential blue ramp (light ≤50% → deep at 100%), so the same yield is always the same colour across wafers, lots, and renders.
  - **Process capability** boxes use fixed CVD-safe semantic hues against the conventional Ppk thresholds — green ≥ 1.33 (capable), orange ≥ 1.0 (marginal), vermillion < 1.0 (poor) — instead of an arbitrary slice of the map ramp.
  - **Correlation matrix cells** are now sign-aware (blue = positive, vermillion = negative, intensity = |r|) — the old |r| ramp drew r = −0.9 and r = +0.9 identically. An inline −1…+1 colour scale documents the encoding on the card.
  - **Facet-group series** (overlaid histogram, clustered pareto, grouped scatter) use the Okabe-Ito colour-blind-safe categorical palette.
  - **Bin identity keeps following the map's registered colour scheme** (`forBin`) everywhere — a bin is the same colour in Insights as on the map, including the accessible scheme when the user selects it. This is why Insights needs no colour-scheme picker of its own.
- **Findings presentation reworked for signal over noise:**
  - Group headers are sentence-case and neutral with a single severity dot — no more all-caps coloured headings that triple-encoded severity, and no more doubled labels ("Edge arc: Edge arc ~NNW").
  - Rows under a group drop the group's own repeated subject ("Ring 4 (edge) has …" × 6 near-identical sentences becomes six compact per-bin rows); the full original sentence is preserved as hover text.
  - Internal bin terms are mapped to plain language in every user-facing surface — panel rows, narrative, Detail modal, and the printable report — via a shared `plainBinTerms` helper (`renderer/fmt.ts`): "HBin 2" → "hard bin 2". Pareto rows and the scatter legend say "Bin N" (the panel title/toggle already names the bin type).
  - Severity filter checkboxes replaced with lit toggle chips carrying counts ("Unusual 2 · Notable 3") — unchecked-boxes-meaning-show-all read as "nothing selected". The section header now reads "Findings (N)".
- **Chart number formatting unified on the shared SI formatter** (`fmt`/`fmtColorbarAxis`, via new `makeAxisFormat` in `chartShell.ts`): boxplot medians read "1.15 mA" instead of "1.15E-3 A"; histogram/boxplot/scatter axes show ticks on one shared SI scale with the scaled unit stated once ("(µA)") instead of raw exponent ticks ("861E-6") with a bare "(A)" in a corner.
- **Insights navigation:** the tab bar gains a leading **"‹ Map" / "‹ Gallery"** tab that exits Insights — a visible way back, complementing the toolbar's icon-swap toggle whose return path was discoverable only via tooltip.
- **Single-wafer Insights Overview** replaces the one-bar "Yield by wafer" chart (whose sort controls could never reorder anything) with stat tiles (yield with pass-bin label, total dies); the remaining three cards then fill the grid row cleanly.
- **Smaller polish:** capability methodology text moved behind an ⓘ hover with a one-line status kept visible; correlation's "Matrix size" control relabelled "Max tests" with a tooltip; the correlation card sizes to its matrix instead of stretching to the scatter panel's height; scatter y-axis limit labels moved inside the left plot edge (they collided with the card border); the docked Summary panel widened 220 → 260px and the yield tile's pass-bin qualifier renders as its own sub-line instead of wrapping mid-parenthetical; Insights yield rows no longer print the yield twice when host card labels embed it.

### Fixed

- **Docked Summary panel content rendered underneath the floating toolbar** in `renderWaferMap` when the panel sat under the toolbar's corner (`placement: 'right'`, `'top'`, or the auto-mounted panel) — the "Wafer Summary" header was covered. The panel now reserves the same 44px top clearance the Insights overlay already reserves, in both the docked and expanded-modal states.

### Docs

- **User guide §8 (Insights) gains three gallery screenshots** — Overview, Distributions, Correlation — with captions covering the cross-panel interactions and colour semantics; new `insights` capture group in `scripts/capture-definitions.mjs` and two new reusable capture steps (`clickButton`, `clickTab`).
- `scripts/capture-screenshots.mjs` falls back to system Chrome (`channel: 'chrome'`) when Playwright's bundled Chromium is unavailable for the host OS.
- Regenerated screenshots affected by the visual changes (findings panels, summary panel, reports).

## [0.20.0] — 2026-07-14

### Breaking

- **Analysis tab reorganized into the opt-in Insights tab; the Summary panel gains findings filters and a single combined report.** The old Analysis tab showed three unlabeled stacked chart sections and had a fragile coupling where opening it hid the Summary panel's own toolbar button. The Summary panel itself is unchanged in scope — still metadata, yield, bin breakdown, ring/quadrant yield, test values, and findings in one always-available docked panel — but gains capability it didn't have before:
  - **Insights tab** (`RenderOptions.insights`/`GalleryOptions.insights`, replaces `analysisEnabled: boolean`) — a full-takeover chart suite, now organized into three sub-tabs (Overview, Distributions, Correlation). Overview shows the same yield/bin/ring/quadrant/test-value numbers as the Summary panel, as interactive charts instead of compact rows — both read the same underlying computation (`StatsSummary.stats.*`, `buildRegionYieldData` in `stats/regions.ts`), so the two views can never disagree even though they can be on screen at different times for the same data.
  - `insights` takes an options object (`{ enabled?, defaultView? }`) instead of a bare boolean — `analysisEnabled: true` becomes `insights: { enabled: true }`.
  - **Summary panel findings gain severity/kind/region filter controls**, wired to the previously-unused `filterFindings`.
  - **Summary panel and Findings report merged into one "Summary report" button.** `renderSummaryReportHtml`/`renderLotSummaryReportHtml` already embedded a findings section, making the separate "Open Report" (findings-only) button redundant — removed. One "Summary report" button now opens the complete document (stats + findings).
  - The two toolbar buttons ("Summary", "Insights") are always independently reachable — opening one never hides or disables the other's button.
  - No compat shim for the renamed option (project convention — see Versioning policy above). Update `analysisEnabled: true` → `insights: { enabled: true }` at call sites.
  - Known follow-up, not done in this pass: the Distributions sub-tab's three panels (capability/boxplot/histogram) still each own a different grouping interaction (restrict-dropdown / drill-down / overlay-legend) — unifying these under one shared control is a separable improvement, tracked but not part of this split.
  - **Ring/quadrant/per-wafer yield bars now fill to the actual yield percentage (absolute 0–100% scale)**, not rescaled to the local min/max of the rows being shown — a rescaled real 5-percentage-point spread (e.g. 91–96%) previously filled the bar's entire width, reading as a far more dramatic difference than it was. A tight real spread now reads as tight, matching every other yield display in the library.
  - **The Insights Overview tab's ring/quadrant/test-value details rendered as one full-width block** instead of cards in the shared responsive grid the other panels use — on a wide window this stretched far past a readable line length. Now split into per-section cards in the same grid as the yield/bin pareto panels.

### Added

- **`StatsSummary.stats.hardBinCounts`/`.softBinCounts`** — die counts per bin over the yield-eligible population, computed once by `analyzeWaferMap`. Additive field.
- **Always-visible wafer/lot metadata.** Previously, `WaferMetadata` (lot, wafer ID, product, test program, temperature, etc.) was only ever shown in the die hover tooltip or the Insights Overview tab — invisible in every bin/value/stack map view without Insights open, a real mislabeling risk for a tool whose output drives yield/lot decisions.
  - `renderWaferMap` now shows a small metadata badge overlaid bottom-left on the canvas (`RenderOptions.showMetadataBadge`, default `true`) — collapsed to a single identifying line (e.g. `LOT123 · W01`, or `24 wafers · median` for a lot-stack result), expanding in place on click/Enter/Space to the full field set. It's a canvas overlay, not a layout element, so it never shrinks the map; positioned bottom-left (opposite the toolbar's top-right) since the toolbar has no responsive collapse and can span most of a narrow canvas's width. Renders nothing when the wafer has no metadata at all. New `WaferMapController.setMetadataBadgeVisible(visible)`. The collapsed label dedupes `lot`/`waferId` when a host embeds one inside the other (e.g. a multi-lot view where `waferId` is itself prefixed with the lot ID) — shows the combined string once instead of repeating it.
  - `renderWaferGallery`'s existing bin-legend strip now also shows a summary of lot-level metadata across every currently-shown item — no new card, reusing the strip that already costs vertical space today. Built on `buildFacetTable` (`stats/facets.ts`): a field with one common value shows it plainly (`Lot: LOT123`); a field that varies shows every distinct value it takes (`Lot: LOT123, LOT456`), never `analyzeWaferLot`'s first-wafer-wins `lotIdentity` and never silently dropped just because a gallery spans multiple lots. A field with many distinct values truncates to the top few by coverage plus `+N more`, matching the die-hover tooltip's existing `+N more tests` convention. `waferId` stays excluded (unique per wafer by definition, never a useful summary field — same curation `stats/facets.ts` already used for its "Group by" control).
  - Gallery cards themselves suppress the floating per-card badge (`showMetadataBadge: false`) since the card's own header already shows identity. Each card's header is itself expandable — a chevron next to the label reveals that wafer's full metadata as an overlay under the header (not in-flow growth, so it never shrinks the map, same contract as the standalone badge), only rendered when there's a field to show. The same expandable header now also appears on a gallery card detached into a real popup window, the in-page floating-window fallback, and the Insights tab's "open this wafer" modal (previously those kept the standalone corner badge, or nothing at all, instead) — every wafer detail view now reads identically, and the badge is reserved for genuinely standalone `renderWaferMap` usage outside any gallery.
  - The gallery's legend strip now lays out lot metadata and bin swatches as two separate lines (with a divider between them when both are present) instead of one shared wrapped row — a long distinct-value summary no longer visually runs together with the bin swatches.
  - New shared `wireExpandToggle` helper (`toolbar.ts`) factors out the click/Enter/Space-toggles, Escape/outside-click-dismisses interaction pattern used by the standalone badge and every gallery header toggle (grid card, popup, floating window, Insights modal), instead of duplicating it. Registers its outside-click dismiss listener on the trigger's own `ownerDocument`, not the bare global `document` — needed for a detached popup window, which is a genuinely different `Document` than the page that opened it.

### Fixed

- **A detached gallery card's floating-window title bar silently swallowed clicks on the new metadata expand chevron.** The window header's drag-to-reposition `pointerdown` handler only excluded real `<button>` elements from starting a drag; the chevron toggle is a `role="button"` `<div>`/`<span>`, so clicking it also called `setPointerCapture()`/`preventDefault()` and began tracking a drag — silently discarding the click (no error, chevron never flipped) and, since pointer capture keeps delivering move events regardless of where the cursor visually is, visibly dragging the window if the pointer moved anywhere afterward (even outside the page, e.g. into devtools). Fixed by excluding any `[role="button"]` target, not just real `<button>` tags. Only affected the in-page floating-window fallback (used when `window.open` is unavailable, e.g. some embedded WebViews) — real popups and modals were never affected.

- **Process capability chart no longer excludes tests missing a spec limit.** `buildCapabilityData` previously dropped any test without both `limitLow` and `limitHigh` before computing anything — in datasets where most tests lack full limits, this could render an all-but-empty chart. Those tests now still appear (`CapabilityDatum.hasSpec: false`, additive field), normalized onto their own observed range instead of `[lsl, usl]`, with `cp`/`cpk`/`pp`/`ppk` left `null` (no fabricated capability index without a spec) and rendered muted/dashed in the chart panel to signal "no capability judgment available." Sort order is now two-tier: spec'd tests first (worst-Ppk-first, as before), then unspec'd tests (most-variable-first). The panel's exclusion caption also previously misattributed all exclusions to missing spec limits even when the real cause was zero recorded values for that test — fixed to name the actual reason.
- **`buildTestBoxplotData` did not exclude `partial`/`edge-excluded` dies**, unlike every other per-test computation in the library (`analyzeWaferMap`'s `perTestStats`, `buildCapabilityData`, the summary panel's Test Values section) — a die that never counted toward a wafer's yield or any other stat could still skew its boxplot. Now filtered via `isYieldEligibleDie`, matching the rest of the package.
- **Reduced duplicate stats computation across the summary panel, Analysis tab, and standalone HTML reports.** These three surfaces each independently re-walked raw `Die[]` to compute the same yield/bin/test-value numbers `analyzeWaferMap`/`analyzeWaferLot` had already computed once — a correctness risk (the yield panel had a real mismatch bug from this exact pattern, fixed in 0.19.0) as well as wasted work. `buildBinParetoData`, `buildBinClusterData`, `buildTestBoxplotData`, the summary panel's bin/test-value sections, and the summary/lot report generators now all prefer already-computed `StatsSummary`/`LotStatsSummary` fields (`hardBinCounts`/`softBinCounts`, `perTestStats`, `testSpecYield`, `perWaferTestStats`) when supplied, falling back to the original raw-die scan per-item/per-test only when that data isn't available — no behavior change for existing callers, purely additive optional parameters. `buildCorrelationMatrix`/`buildScatterData` (need per-die paired values across two tests) and the histogram builders (need every individual value for bucket assignment) are documented exceptions that must keep reading raw `Die[]` — summary statistics can't reconstruct what they need.

## [0.20.1] — 2026-07-15

### Added

- **`RenderOptions.onSaveText`/`GalleryOptions.onSaveText`** — host hook for the Summary/Insights test-values table's "Export CSV" button, mirroring the existing `onSaveImage`. Previously this button always used a raw `<a download>` click, which is a silent no-op in Tauri/Electron/WebView2 (no dialog, no file, no error) — the same class of bug `onSaveImage` already fixed for PNG saves. New shared `saveTextFile(text, filename, mimeType, onSaveText?)` in `toolbar.ts`, alongside `saveImageBlob`.

### Fixed

- **`renderWaferMap`'s toolbar floated in the wrong place whenever a docked Summary panel or the Insights tab was involved.** The toolbar was a child of the canvas wrapper, which shrinks to share width with a docked `summaryPanel` — but the Insights overlay covers the *entire* render container, not just the (now narrower/offset) canvas wrapper. The toolbar, anchored to the wrong box, would float mid-container instead of at the true corner, often overlapping the Insights tab's own metadata strip. The metadata badge had the identical bug (same architecture, same z-index) and was never hidden while Insights was open. Both are now anchored to the stable outer container; the metadata badge is hidden while Insights is open (its own metadata strip already shows the same info) unless the host explicitly hid it via `setMetadataBadgeVisible(false)`, which now always wins. The Insights tab's content also reserves top clearance so its metadata strip never renders under the toolbar. The "Expand" modal — which previously carried the toolbar along for free as a side effect of it living inside the canvas wrapper — now reparents it explicitly on open and restores it on close.

### Docs

- **New `docs/performance.md`** — measured cost of every optional analysis feature (`computePerTestStats`, `enableTestValueAnalysis`, the Insights tab, lot-level reuse via `perWaferSummaries`) at a few wafer sizes and test counts, with a "what should I enable for my app" recommendation table. Linked from the nav and cross-referenced from `docs/api.md`'s `enableTestValueAnalysis` option.
- **`docs/api.md`**: documented the new `onSaveText` option on both `RenderOptions` and `GalleryOptions` (the latter was also missing its pre-existing `onSaveImage` entry — added alongside it).

## [0.19.0] — 2026-07-12

### Added

- **`WaferMapController.openUserGuide()` / `GalleryController.openUserGuide()`.** Opens the built-in end-user guide directly — the same action the help toolbar button performs, but callable regardless of `showHelpButton`/`setHelpButtonVisible`, so a host that hides wmap's own help button (e.g. folding it into its own combined help menu) can trigger the guide without a DOM query against wmap's internal button markup.
- **The user guide now opens in a real, separate window when available**, draggable outside the host window's own bounds — the same upgrade gallery card detach got in 0.18.0. Falls back to the existing in-page non-modal floating window when `window.open` is blocked (some embedded WebViews — Tauri, Electron, WebView2 — silently return `null`), unchanged from before. The popup's `--wmap-*` theme tokens now also stay synced with later host theme changes (a toggled class/style on the render container or `<html>`, or an OS light/dark flip) — previously a one-time snapshot at open time; this fix also applies to gallery card detach windows.

### Fixed

- **`buildYieldDataCombined` weighted a group's combined yield by raw die count, including `partial`/`edgeExcluded` dies that never counted toward any item's own yield.** A wafer with many excluded dies could skew a "Group by" yield bar even though those dies are invisible everywhere else in the library. Now weighted by yield-eligible die count only (`isYieldEligibleDie`), matching the population the per-item yield rate was actually computed over.
- **Analysis tab: clicking a yield-by-wafer row could open the wrong wafer** when two items shared a label (or both fell back to the same default because neither supplied a label nor a wafer ID) — the click handler resolved the row back to a wafer by re-searching for a matching `label`, and the first match always won. `ChartDatum`/`YieldItem` gain an optional `key` field (additive) carried through unchanged from the input item, used instead of `label` to resolve a clicked row to its item.

## [0.18.1] — 2026-07-11

### Added

- **Analysis tab — an in-toolbar chart suite for wafer/lot data.** Passing `analysisEnabled: true` to `renderWaferMap` or `renderWaferGallery` adds an **Analysis** toolbar button that swaps the map/grid for a suite of canvas chart panels computed from the same data: yield by wafer, hard/soft bin pareto, process capability (Cp/Cpk/Pp/Ppk), boxplot, value histogram, test correlation matrix, and scatter. Panels cross-link (a correlation matrix cell opens that pair in scatter; a boxplot box opens that wafer in value mode) and support an optional "Group by" facet view, with a Simpson's-paradox warning when correlation/scatter data is left ungrouped but spans mixed populations. The chart panels themselves (`analysisTab`/`charts/*`) are internal — not a public subpath — but the pure computations behind every panel are public from `@paulrobins/wafermap/stats` (`capability`, `boxplot`, `histogram`, `correlation`, `scatter`, `yield`, `binPareto`, `facets`), for hosts that want to drive their own chart library from the same numbers. While the Analysis tab is open, map/gallery-view-only toolbar controls (mode, palette, overlays, orientation, Findings, etc.) are hidden as a group — none of them apply to the chart suite — but the toolbar itself (Analysis/Expand/User guide) stays visible and usable the whole time.
- **`userGuideExtension` render option.** Lets a host application insert its own documentation into wmap's built-in user guide window, ahead of wmap's own content, so there's one help button and one combined document instead of two competing ones.

### Fixed

- **Analysis-tab chart panels no longer fight their own containers for size.** A cluster of related layout bugs surfaced while building the chart suite above: cards not growing to fit their content in the grid, the expand-into-modal resize leaving stale sizing behind on close, flickering/unwanted scrollbars on panels that should never need to scroll, an unintended horizontal scrollbar appearing as a side effect of suppressing the vertical one (the CSS overflow spec forces a `visible` axis to compute as `auto` when paired with a non-`visible` one on the other axis), and a size ratchet in the boxplot panel specifically — its height was measured before its canvas had been given a real size, corrupting the calculation on every redraw and compounding on every option toggle into continuous, visible growth. `cardShell()`'s chart-card body now defaults to no scrolling at all — a panel that promises to size itself to fit its content shouldn't be able to scroll in the first place — with scrolling opted back into explicitly only where content can genuinely outgrow its cap (boxplot, the bin-pareto/yield-by-wafer row lists).
- **Boxplot now opens the wafer detail view in the correct plot mode** when a box is clicked, instead of the default mode regardless of which test was being viewed.

### Docs

- **`docs/api.md`, `docs/guide.md`, `docs/user-guide.md`** (including a live embedded demo): full reference and walkthrough for the Analysis tab and `userGuideExtension`.
- **`docs/architecture.md`**: `analysisTab`/`charts/*` added to the package-layer diagram (marked internal), the new `stats` chart-data-builder modules wired in, and a note disambiguating the toolbar's "Analysis tab" from the pre-existing `analyzeWaferMap`/`analyzeWaferLot` analysis layer — the two "Analysis" names are unrelated.
- **`docs/glossary.md`**: added Process capability (Cp/Cpk/Pp/Ppk), used in the capability chart's UI but previously undefined.
- **`README.md`**: updated test-count/bundle-size badges and added the Analysis tab to the feature list.

## [0.18.0] — 2026-07-08

### Breaking

- **Gallery card expand now detaches into a real, separate window, not a modal.** Clicking a gallery card's expand button (or a Wafers-panel findings row) opens a genuine `window.open` window for that card — not an in-page overlay — so it can be moved anywhere on screen, including outside the host browser/app window's own bounds. The gallery grid stays fully interactive the entire time (there was never a backdrop to block it), and any number of cards may be detached at once for side-by-side comparison. The vacated grid card becomes a small placeholder whose own expand button toggles to "reattach"; closing the popup (its own × / OS chrome) does the same, rebuilding a fresh card with the gallery's current shared view options. If the gallery's card set is rebuilt while a card is detached (most notably a stacked-mode switch, which can collapse many per-wafer cards into fewer aggregate ones), the popup is **unlinked** rather than destroyed — it keeps its own live controller/canvas/toolbar fully interactive, its window title and an in-content banner both switch to an "— unlinked from gallery" notice, and it can only be closed manually from then on. This also fixes a latent bug where such a rebuild would destroy a detached card's controller while it was still being displayed. The user guide (`showHelpButton`) is a separate, still-in-page non-modal floating window (unchanged shape, new terminology): `openModal`/`ModalOptions`/`ModalHandle` in the shared toolbar module are renamed `OverlayOptions`/`OverlayHandle`, with `openModal` (still exclusive/blocking — unchanged for `renderWaferMap`'s own single-map expand and the findings-detail panel) and the new `openFloatingWindow` (used only by the user guide) as the two public entry points.
- **Embedded hosts where `window.open` is blocked (Tauri, Electron, WebView2) automatically fall back to the in-page floating window.** A plain `window.open` call silently returns `null` in these environments — same as tsmap's existing `openHtmlReport`/`setReportOpener` gap. Rather than leaving the detach button inert there, `openWindowForCard` now falls back to the same non-modal in-page floating window the user guide uses when no real popup is available and no custom opener is registered — the detach feature keeps working everywhere, it just can't be dragged outside the host window's own bounds in that fallback case. See the new `setDetachWindowOpener` below for hosts that want a real separate OS window instead (e.g. via their own multi-window API).

### Added

- **`setDetachWindowOpener(opener)` — register a custom opener for gallery card detach windows.** Mirrors `setReportOpener` (`@paulrobins/wafermap/stats`). The opener receives the card's label and must return a `Window`-like handle (or `null` to decline, which falls back to the in-page floating window) — for hosts that want gallery card detach to open a real OS window via their own window-management API (e.g. Electron's `BrowserWindow`) rather than the in-page fallback. **Not usable for Tauri as designed** — a Tauri `WebviewWindow` is fully isolated (separate script context, no shared DOM/JS state with the opener) and cannot satisfy this contract's synchronous `Window`-with-live-`.document` shape; see tsmap's `WMAP_ISSUES.md` #27 for the full investigation. Exported from `@paulrobins/wafermap/render`.
- **`showExpandButton` render option — suppress the toolbar expand button and `E` key.** Default `true` (unchanged behaviour). Set `false` when the host already renders the map inside its own expanded/modal context, where wmap's built-in expand-into-modal affordance would be redundant. Does not affect `renderWaferGallery`'s internal per-card expand (which routes through its own detached window via `onExpand`).
- **Non-modal floating windows (gallery card detach fallback, user guide) can now be minimized.** A new minimize button in the header collapses the window to just its title strip — the map/content is hidden, not destroyed, and clicking again restores it to its previous (possibly user-resized) size. Modal windows don't get this button — a modal's backdrop still blocks the rest of the page regardless, so minimizing one would achieve nothing.

### Fixed

- **Die labels stayed capped at a tiny fixed size and didn't scale with zoom.** Font size used to be computed once per die, in millimetres, at build time — clamped to 8–16px and blind to the interactive zoom level, since pan/zoom re-renders without rebuilding the view. All dies now share one uniform label size per render, recomputed at draw time from the current on-screen die box size and the longest label present, so short labels (e.g. single-digit bin numbers) grow legibly when zoomed in without ever overflowing their die box. Applies to gallery card thumbnails too, via the shared rendering pipeline.
- **Box-select drag rectangle was invisible against blue-heavy colour schemes.** Same class of bug as the finding/selection highlight below — a single hardcoded blue (`rgba(30,100,200,0.85)`) drawn over the die grid while dragging, washed out against `viridis`, `jet`, and `plasma`/`inferno`'s dark ends. Now uses the same white-halo + black-core dashed "marching ants" stroke, with a neutral dark fill tint.
- **Finding/selection die highlight was invisible against several colour schemes.** It used a single amber stroke (plus an amber fill tint) inside a white halo — fine on cool-hued schemes, but nearly indistinguishable from die fills on any scheme with its own amber/yellow/orange region (`inferno`, `plasma`, `traffic`, `jet`, `default`/`thermal` at their yellow midpoint, `accessible`'s orange family). Replaced with the classic "marching ants" pattern — a white halo plus a black inner stroke, and a neutral dark fill tint instead of amber. White and black sit at opposite ends of the luminance range, so at least one always contrasts strongly against any die fill regardless of the active colour scheme's hue.
- **Dragging a floating window's header (reposition) or corner grip (resize) selected text in page content behind the window.** Neither pointerdown handler called `preventDefault()` or suppressed selection, so the browser's native mousedown-drag text-selection gesture fired underneath the window on every drag. Both handlers now call `preventDefault()` and set `user-select: none` on `document.body` for the duration of the drag, restoring it on pointerup.
- **Log scale toolbar icon no longer shown in Spec pass/fail (`colorBySpec`) mode.** The button was gated only on `plotMode`, so it stayed visible in value mode even when dies are coloured by pass/fail instead of the continuous gradient — where log scale has no effect. It is now hidden whenever `colorBySpec` is active.
- **Die-hover tooltip no longer renders behind an open floating window (gallery card detach fallback, user guide) after the first hover.** `hideTooltip()` used to unconditionally move the shared tooltip singleton back to `document.body` every time it was hidden. A floating window stays open across many ordinary hover/unhover cycles, so the very first unhover after opening one silently evicted the tooltip from the window's stacking context — it was never reparented back in, so every later hover in that window rendered the tooltip at `<body>`'s z-index, behind the window. `hideTooltip()` now just hides the tooltip in place; only an overlay's own `close()` reparents it back to `<body>`, since that's the only time it's actually leaving.
- **Modal/floating-window corner resize was undraggable in some environments (confirmed on Ubuntu Tauri/WebKitGTK over VNC), even after an earlier attempt to fix it by reserving a dead-zone for the native CSS `resize` grip.** The native browser-drawn resize handle relies on a small, precise hit-region and cursor that isn't reliable across every engine/remoting setup. Replaced entirely with a hand-rolled corner grip using Pointer Events (`pointerdown`/`pointermove`/`pointerup`), the same pattern already used for the header's drag-to-reposition — an ordinary DOM element with ordinary listeners, so it behaves identically everywhere.
- **Minimized floating window was a large empty rectangle instead of a small header-only strip.** The box's `minHeight: 240px` floor prevented `height: auto` from actually collapsing it when minimized. `minHeight` is now overridden to `0` while minimized and restored on un-minimize.
- **Minimized floating window strip stayed as wide as the window had been, instead of shrinking to a compact size.** Only height was collapsed on minimize, not width. The strip now narrows to 220px while minimized (restoring to whatever width — including a user-resized one — it had before), and the title text truncates with an ellipsis and a native hover tooltip instead of forcing the strip wide enough to fit in full.

## [0.17.0] — 2026-07-03

### Added

- **Chrome and canvas theming via `--wmap-*` CSS custom properties.** wmap's entire chrome — toolbar, gallery cards, summary panel, menus, the die tooltip — *and* the wafer **canvas** (background, axis labels/ticks, colorbar and legend text, active-selection accent) now resolve their colours from `--wmap-*` custom properties set on any ancestor of the render container. Previously these were hardcoded light-theme hex values, so a host on a dark background had a permanently light toolbar and a light-grey canvas it could not change. Every token has its **previous light value baked in as the fallback default**, so a host that sets nothing renders exactly as before — this is purely additive. The canvas can't inherit CSS, so its palette is resolved once per draw (a single `getComputedStyle`, ~µs, benchmarked — never per die or per tick) via the new internal `canvasTheme` module, and it is **re-resolved on a theme change or OS light/dark flip** (a `prefers-color-scheme` listener re-renders once), so the wafer repaints to match. The **data palette** (bin/value die colours) is deliberately *not* themed by these tokens — it remains the orthogonal `colorScheme` option, so the map's meaning never shifts with the host's chrome. New tokens include `--wmap-canvas-bg`, `--wmap-surface`, `--wmap-panel-bg`, `--wmap-border`, `--wmap-text`, `--wmap-text-muted`, `--wmap-icon{,-hover,-active}`, `--wmap-bg-{hover,active}`, `--wmap-menu-{hover,active}`, `--wmap-warn-{bg,border,text}`, and `--wmap-info-{bg,text}`; the existing `--wmap-selected` is folded into the same system. Full token table and dark/Nord examples in the API reference (§5.4.1); worked live demo in `examples/theming.html`.
- **New `jet` colour scheme — the classic MATLAB rainbow ramp (dark navy → blue → cyan → yellow → red → dark red).** Available via `colorScheme: 'jet'` and in the toolbar palette dropdown (value modes only). Offered for familiarity for engineers coming from older MATLAB/imaging tooling; it differs from the built-in `thermal`/`default` ramp by its *dark* endpoints. Like all rainbow ramps it is not perceptually uniform — `viridis` or `accessible` remain preferable when read accuracy or colour-vision-deficiency safety matters.

### Changed

- **Gallery "auto" column count now packs more columns when the container is wide, instead of only ever reducing from a square-ish target.** Auto sizing previously started at `ceil(sqrt(N))` columns and only *reduced* that count when cards would fall below the readable floor — so on a wide screen it left cards larger than necessary and columns fewer than the width allowed (a 3-wafer lot showed 2 columns even with room for 3). Auto now adds an upward pass: after enforcing the readability floor (unchanged, still the top priority — no die ever renders below the discernible pixel size), it increases the column count while each card stays *comfortably* sized (a factor above the bare minimum, itself derived from die pitch and wafer diameter, capped at the max card width). The count is still capped at N, so it never creates empty columns. Dense wafers, whose comfortable width is already high, deliberately pack fewer columns than coarse wafers at the same width. Explicit fixed column counts are unaffected; this only changes the "auto" setting.
- **Default continuous value gradient is now blue→cyan→yellow→red (thermal), not Viridis.** The `default` colour scheme — used for `value`, `stackedValues`, and other continuous-value plot modes when no `colorScheme` is set — previously mapped values through a reversed Viridis ramp, where high values rendered dark purple and low values yellow. That ordering is not intuitive for parametric/electrical test maps. Values now map blue (low) → cyan → yellow → red (high), the convention semiconductor engineers expect. This is a visual change only; no API, type, or option changed. The Viridis ramp remains available via `colorScheme: 'viridis'`, and categorical bin colours are unchanged.
- **Out-of-spec dies in value maps are now flagged consistently with a triangle marker in both colorbar ranges, and are no longer solid-filled.** Previously, `colorbarRangeMode: 'spec'` filled out-of-spec dies a solid blue (fail-low) / red (fail-high), while `'data'` kept the gradient fill and added a marker — two different presentations for the same condition, and the solid fills were invisible against any scheme whose gradient is already blue/red at that end. Now, in normal value mode, out-of-spec dies **always keep the value-gradient fill** (like every other die, so the distribution stays readable and the indication never collides with the colour scheme) and are **always flagged with a triangle marker** — ▽ = below the low limit, △ = above the high limit — in **both** spec and data ranges. The marker's **shape carries the meaning** (so it survives greyscale and colour-vision deficiency); it is drawn black or white per die for contrast against that die's own fill, with an opposite-colour halo, so it stays visible under any colour scheme. A matching ▽/△ key is drawn beside the colorbar LSL/USL labels. `colorbarRangeMode` now controls only the colorbar's numeric range, never the form of the out-of-spec indication. **`colorBySpec` (Spec pass/fail mode) is unchanged** — it still fills dies solid green (pass) / blue (fail-low) / red (fail-high), as that mode's fill *is* the indication.
- **Die hover tooltip is now compact and mode-aware — it no longer grows into a full-height block on dies with many parametric tests.** Previously it listed the first 12 test values in definition order (regardless of which test was being viewed) with a trailing "…and N more", and had no height bound. Now: in **value mode** it leads with the **active (plotted) test** — bold, with an "(out of spec)" note when it fails its limits — then summarises the rest as "+N more tests"; in **bin modes** (`hardBin`/`softBin`) it shows the bin verdict then a "N test values recorded" count instead of an arbitrary list (no single test is privileged in bin mode); stacked modes are unchanged. The tooltip element also has a hard height cap so it can never exceed the viewport. `buildHoverText` gains an optional trailing `activeTest?` parameter (non-breaking); `tooltipTestLimit` (RenderOption) and `buildHoverText`'s `testLimit` parameter are now **deprecated no-ops**, retained for back-compat.

### Fixed

- **Expanding a gallery card into the modal no longer leaves a stray orange "selected" outline on the card behind it.** The gallery's finding-drilldown highlight (the `--wmap-selected` outline drawn round cards implicated by the summary-panel finding you are inspecting) was also being applied to a card when it was maximised into the modal. That outline was invisible while the modal was open (the backdrop covers it) and — because the close path never cleared it — was left on the card indefinitely after closing, reading as a selection the user never made and could not remove. The modal no longer applies this highlight; the outline is now used only for its intended purpose. No API change. (The `--wmap-selected` theme token is unchanged; its documented description now reads "finding-drilldown card outline".)

## [0.16.2] — 2026-06-26

### Fixed

- **Out-of-spec dies in `colorbarRangeMode: 'data'` are flagged with a marker instead of a solid blue/red fill, restoring the value distribution.** In value mode with spec limits, 0.16.0/0.16.1 filled every out-of-spec die solid blue (fail-low) / red (fail-high) regardless of range mode. That is correct in `'spec'` mode (the colorbar spans the spec window), but in `'data'` mode — where the colorbar spans the actual data range to show the *distribution* of values — it removed the out-of-spec dies from the gradient entirely and made the die colours disagree with the colorbar. The data-range view now colours out-of-spec dies by the value gradient like every other die and draws a blue/red marker (a coloured outline plus a small central dot) over them, so the distribution stays readable, the bar and die colours agree, and an out-of-spec die is still never shown as plain in-spec. `'spec'` mode (the default) and `colorBySpec` are unchanged — out-of-spec dies remain solid blue/red there. New additive optional field `ViewRect.specMark` carries the flag to the renderer. This corrects the all-solid-blue/red behaviour introduced in 0.16.0.

## [0.16.1] — 2026-06-26

### Added

- **`zIndex` render option on `renderWaferMap` and `renderWaferGallery`.** A first-class, per-render control for the base z-index of wmap's transient overlays (menus, tooltip, expand/help modals), replacing the need to mutate the global `--wmap-z` CSS variable by hand when embedding a map inside a host-owned modal. wmap layers its own overlays from this value upward and restores the previous stacking on `controller.destroy()`. Internally it still writes `--wmap-z` (now defaulting high — see Changed) so overlays that append to `document.body` inherit it; you may set `--wmap-z` via CSS instead if you prefer. Resolves tsmap issues #22/#23 (toolbar menus/tooltips rendering behind a host modal; the recurring z-index failure class).

### Changed

- **Transient overlays now default to a high z-index (`6000`, was `100`).** wmap's toolbar menus, die tooltip, and expand/help modals are positioned `position: fixed` and read their stacking from the `--wmap-z` custom property, which previously defaulted to `100` — *below* almost any host app's own modal layer, so embedding a wmap render inside a host overlay silently rendered wmap's menus and tooltips *behind* it (a "dead toolbar" with nothing in the console). The default is now high so overlays appear on top with no configuration — the behaviour essentially every embedder expects. This is a default change, not an API change: any host that already set `--wmap-z` is unaffected, and the only way to notice a regression is to have *deliberately* placed a host overlay in the `100`–`6000` range to cover wmap's own menus, which is not a sensible configuration. If you did, set `--wmap-z` (or the new `zIndex` option) below your overlay.

### Fixed

- **Frozen die/toolbar tooltip that would not close.** A wafer map's hover tooltip could become stuck visible and stop updating — other maps still worked, and only a full page reload (or Tauri app restart) cleared it. Root cause: each `renderWaferMap` and `renderWaferGallery` created its own `<body>`-appended tooltip element, so many existed at once with no coordination; if a leave-event was ever missed (e.g. `setPointerCapture` in `onPointerDown` suppresses `pointerleave`, and a gesture interrupted by `pointercancel` from OS/WebView focus loss, a context menu, or a touch gesture left no `pointerup`), that instance's tooltip stayed visible forever — the only path that hides it, the same canvas's `pointermove` with no die under the cursor, never ran because the pointer had moved to a different card. **Fix:** there is now exactly **one** shared document-level tooltip element for all maps, galleries, and toolbars. Because every consumer points at the same node, showing a tooltip anywhere inherently hides whatever was shown elsewhere, making a frozen tooltip structurally impossible. Also added a `pointercancel` handler (which still resets pan/box-select gesture state) and a window `blur` net so the tooltip clears immediately on alt-tab/app-switch rather than lingering until the next hover.
- **Tooltips hidden behind the expand modal.** In a map's expand modal, die and toolbar tooltips were invisible (or appeared beneath the modal) unless the modal was maximized — the tooltip's z-index (`--wmap-z + 1`) sits below the modal box (`--wmap-z + 2`), so while parented to `<body>` it rendered behind an open modal, and only the maximize path re-homed it. The modal now re-homes the shared tooltip into its box on open (and back to `<body>` on close) in every state, so tooltips always render above modal content.

## [0.16.0] — 2026-06-24

### Breaking

- **`enableTestValueAnalysis` now defaults to `false`.** The regional parametric significance pass (Welch comparisons of each test's values between every region family and the rest of the wafer, plus spec-limit region findings) was previously **on by default**, making it the dominant cost of `analyzeWaferMap`/`analyzeWaferLot` — it scales with regions × tests × dies. Any caller that did not explicitly disable it paid 11–28× the cost of the rest of analysis (≈285 ms vs 23 ms at 2.8k dies × 50 tests; ≈867 ms vs 31 ms at 200 tests), and a 10-wafer lot ran multiple seconds. It is now opt-in. **Migration:** if you display the regional test-value findings (or the `perWaferTestStats` they implied), pass `enableTestValueAnalysis: true`. If you only need per-test descriptive statistics (mean/stddev/quartiles for box plots), use the new, far cheaper `computePerTestStats: true` instead.

### Added

- **`computePerTestStats` analysis option.** Computes the per-test descriptive statistics (`count`, `min`, `max`, `mean`, `stddev`, `median`, `q1`, `q3`) into `StatsSummary.stats.perTestStats` — and `perWaferTestStats` on the lot summary — **without** the expensive regional Welch pass of `enableTestValueAnalysis`. Use it for box-plot / histogram panels that need distribution shape but not spatial findings. Off by default; implied by `enableTestValueAnalysis`. At 2.8k dies × 200 tests this path is ≈149 ms versus ≈382 ms for the full findings pass.

### Performance

- **`buildTestValueFindings` rewritten to be allocation-light (≈2–2.3× faster, identical output).** The previous implementation allocated two value arrays per (region × test) via `.map().filter()` and rebuilt the "rest of wafer" die set per region — profiled at ~95% of analysis cost, mostly GC. It now assigns each die to its region once and, per test, walks the dies a single time accumulating per-region running sums (n, Σx, Σx²); the "rest of wafer" statistics are derived by subtraction and never materialised. Welch needs only count/mean/variance, so no value arrays are built in the hot path. Per-test values are accumulated shifted by a per-test constant so the running-sum variance stays well-conditioned even for large-magnitude, low-variance tests (e.g. voltages near 1e6 with mV spread). Findings match the previous output to within floating-point tolerance. Full pass at 2.8k dies × 200 tests dropped from ≈867 ms to ≈382 ms; a 10-wafer lot from multiple seconds to ≈2.5 s with findings on, ≈293 ms with the new default.

### Fixed

The following were found in the first full code review of the library and each ships with a regression test that exercises the previously-untested path.

- **`wafer.orientation` was applied twice, rotating dies out of alignment with the wafer boundary.** `buildWaferMap` bakes `wafer.orientation` into `die.physX/physY`, and `buildView` then re-applied it in the render transform — so for any non-zero `wafer.orientation` the dies rotated twice while the boundary/notch rotated once, and they no longer matched. Invisible at the default `orientation: 0`. Die *centre* positions now use the interactive rotation only (orientation is already baked in); die rectangle shapes and all overlays keep the full transform. Interactive rotation/flip from the toolbar was always correct and is unchanged.
- **Out-of-spec die colouring was suppressed in `colorbarRangeMode: 'data'`.** In value mode with spec limits defined, dies outside the limits must always render red (fail-high) / blue (fail-low); under `'data'` range mode they were drawn with the in-spec gradient instead, so an out-of-spec die looked in-spec. Out-of-spec classification now depends only on whether limits are defined — `colorbarRangeMode` affects only the colorbar's numeric range, as documented.
- **Regional yield findings counted dies with no hard bin as fails.** A die eligible only via soft bin or test values has no hard-bin pass/fail verdict, but it was included in the regional yield denominator (and so counted as a fail), deflating that region's yield and producing spurious "lower yield" findings. The denominator is now the hbin-bearing population, matching the overall wafer yield.
- **Regional test-value findings could fire on constant (zero-variance) data.** When every die in both the region and the rest of the wafer read an identical value, the Welch standard error is zero and the comparison is statistically undefined — it was reported as `p = 0` with infinite effect (maximally significant). It is now correctly treated as a non-finding (`p = 1`, no effect), so uniform or coarsely-quantised tests no longer produce spurious "unusual" findings.
- **A `>250` test-count cap warning from `computePerTestStats` could be silently dropped.** `stats.warnings` was assigned before the cheap per-test-stats path ran, so a cap warning it raised never reached `StatsSummary.stats.warnings`. The assignment now happens after that path.
- **Wafer ID now appears in die hover tooltips.** 0.15.0 stripped `waferId` from the merged tooltip metadata on the assumption the map context always conveys it — but in the gallery (many wafers on screen) and stacked maps that left tooltips ambiguous. The tooltip now renders every host-supplied metadata key, including `waferId`; wmap takes no view on which fields belong in a tooltip, so content is controlled entirely by the metadata the host provides on `WaferMetadata`/`DieMetadata`.
- **Stacked-map die tooltips showed the wrong/missing aggregation context.** The tooltip read the aggregation method and lot size from the caller's `viewOptions` rather than from the built view, so a `buildWaferMap({ lotStack })` result (which carries them on the result) produced tooltips with a missing method or no occurrence percentage. It now reads them from the view, which always holds the authoritative values.
- **`stackedBins` / `stackedSoftBins` tooltips mislabelled `percent`-aggregated values.** A `percent` lot-stack value is already a percentage, but the hover treated it as an occurrence count and derived a second percentage from it (e.g. "50 (250%)"). The tooltip now renders a `percent` value as `N%`, a `countBin` value as a count with its share of the lot, and names the aggregation method either way.
- **On-canvas bin/spec legend counts excluded edge-excluded dies.** Edge-excluded dies are drawn as no-data grey but were still tallied into the legend population, so the legend disagreed with both the drawn colours and the summary panel. They are now excluded, matching the rest of the pipeline.
- **Docs site: `wafermap/stats`, `wafermap/renderer`, and `wafermap/worker` were served as unbundled module graphs.** `bundle-docs.mjs` bundled only the `wafermap` and `wafermap/render` importmap entries; the other three resolved to raw `tsc` barrels, so any demo importing them fetched each internal module over a separate request — a serial waterfall (stats alone fans out to ~13 modules) that showed as a blank before the maps appeared, worst on high-latency connections. All five importmap entry points are now bundled to single minified files.

### Changed

- **`minimumRelativeEffect` documentation corrected to its actual default of `1.0`** (the TSDoc and API reference previously said `0.5`), and the test-value auto-skip threshold corrected to **250 tests** (docs previously said 100).
- **Internal de-duplication (no behaviour change):** the normal-CDF / error-function approximation (previously copied in `analyzeWaferMap` and `clusterDetection`) now lives in a shared `stats/math.ts`; the Wang hash used for bin colours (previously copied in `colorMap` and `colorSchemes`) is now a single shared `wangHash`. The lot summary report no longer tags caller-owned `Die` objects with a hidden `_waferIndex` field (stats is side-effect-free) — it uses a parallel per-wafer array instead, which also fixes a latent index-misalignment when an item had dies but no wafer.

## [0.15.0] — 2026-06-23

### Breaking

- **`DieMetadata` no longer carries wafer/lot-level fields.** The named fields `lotId`, `waferId`, `deviceType`, `testProgram`, and `temperature` are removed from `DieMetadata`; only the open `[key: string]: unknown` index signature remains. These facts are properties of the *wafer*, not the die — a die cannot differ from its wafer on lot, product, program, or temperature — so storing them per die was pure redundancy (replicated across every die, up to hundreds of thousands per wafer). Supply them once on `WaferMetadata` (via `buildWaferMap({ waferConfig: { metadata } })`); the tooltip now reads them from there (see below). Use `DieMetadata` only for annotations that genuinely vary die-to-die. **Migration:** move any per-die `metadata.lotId`/`testProgram`/etc. to the wafer's `waferConfig.metadata`; truly per-die keys continue to work unchanged via the index signature.
- **`buildHoverText` gained a trailing `waferMeta?` parameter.** Signature is now `buildHoverText(die, plotMode, testDefs?, hbinDefs?, sbinDefs?, fallbackFormat?, aggrMethod?, lotSize?, testLimit?, waferMeta?)`. Existing positional calls are unaffected (the new parameter is last and optional); pass the wafer's `WaferMetadata` to get wafer-level facts in the tooltip. `renderWaferMap` passes it automatically from the `WaferMapResult.metadata`.

### Added

- **`WaferMetadata` and `DieMetadata` are now re-exported from `@paulrobins/wafermap/renderer`.** They are renderer-input concepts (`WaferConfig.metadata`, `DieResult.metadata`) but were previously reachable only from `/core`. Consumers building renderer input can now import them from the renderer entry point.

### Changed

- **Hover tooltips merge wafer-level metadata under per-die overrides.** The tooltip now shows the wafer's `WaferMetadata` (lot, product, test program, temperature, test date, …) by default; any key also present in a die's `DieMetadata` overrides the wafer value for that die. `waferId` is omitted from the merged metadata lines because the die's wafer identity is already conveyed by the map context (and the gallery strips it). This means a host that knows provenance at the wafer level gets full tooltips by setting `waferConfig.metadata` once — with no per-die duplication and no walk over the die array.

### Fixed

- **Summary panel no longer clips the wafer in short containers.** The persistent summary panel beside a `renderWaferMap` was capped at a *viewport*-relative height (`calc(100vh - 80px)`), so in any container shorter than the viewport the panel demanded more height than the container had, stretched the flex row, and dragged the canvas past the container — clipping the bottom of the wafer. The panel is now bounded by its container (`max-height: 100%`) and the wrap row is pinned to the container height (`height: 100%`, children stretched), so the canvas always tracks the container and the panel scrolls internally instead. The wafer renders complete at any container height. (The gallery's own viewport-relative panel cap is unchanged — it is intentionally viewport-scrolled.)

## [0.14.3] — 2026-06-23

### Added

- **`RenderOptions.height`** — intrinsic map height for `renderWaferMap`. The canvas fills its container, which must therefore have a resolved height; passing `height` (a number of px, or any CSS length like `'70vh'`) makes the library size its own wrapper, so the map renders in a plain document with no container CSS. Width still comes from the container.
- **Unrenderable-container warning.** When a `renderWaferMap` container resolves to zero height (a flex/grid child with no height-resolved ancestor — the commonest embedding mistake, where the map silently collapses to nothing), the library now logs a single actionable `console.warn` naming the fix, instead of failing silently. A plain block `<div>` (which grows to fit the map) and any height-resolved container do not warn.
- **Docs: embedding & sizing.** New troubleshooting entry "Map is blank, invisible, or the wrong height" and a sizing note on `RenderOptions` in the API reference, documenting the fill-parent model and the four valid ways to give the container a height.

### Fixed

- **Docs: "full-screen" → "maximise" for the expand modal.** The expand modal opens as an enlarged overlay with a *maximise* toggle (`F`); it no longer uses the OS Fullscreen API. The API reference, developer guide, quickstart, and embedded end-user guide were updated to match, and the `F` (maximise/restore) shortcut is now documented. Also corrected stale "toolbar appears on hover" wording — the toolbar is always shown.
- **Expand-modal "fullscreen" no longer dead in macOS WKWebView.** The modal's maximize button used the real Fullscreen API (`box.requestFullscreen()`, `document.exitFullscreen()`, the `fullscreenchange` event). macOS Tauri runs on WKWebView, which only exposes the `webkit`-prefixed variants and disables element fullscreen unless the host opts into Apple private API (`macOSPrivateApi: true`, blocks Mac App Store distribution) — so the button silently did nothing and `onFullscreenChange` never fired, breaking tooltip reparenting. The modal now maximizes via a pure CSS toggle (the box grows to `100vw`/`100vh` inside its fixed-inset backdrop), behaving identically on Linux/Windows/macOS Tauri and every browser including Safari, with no native config. The `onFullscreenChange(isMaximized, box)` callback still fires on the synthetic toggle, so consumers are unaffected. `Esc` always closes; the close button stays visible while maximized.
- **Quadrant boundary lines now sit exactly on the wafer centre.** The vertical/horizontal quadrant dividers were drawn at the midpoint between the two die columns/rows straddling the centre. When a column sits on the centre (odd column count), that midpoint lands half a die-pitch off-centre — the vertical line appeared shifted left and the horizontal line down — even though `classifyDie` assigns that centre column to the E/N quadrant. The lines are now drawn at `wafer.center`, matching the classification boundary.

---

## [0.14.2] — 2026-06-21
### Added

- **On-canvas map title for every plot mode.** Each map now draws a title naming what it shows, placed by the colorbar/bin legend (never under the floating toolbar) and captured in PNG exports. The title splits into a primary line above the scale and supporting context below it: `value` → `Vth (mV)`; `stackedValues` → `Vth (mV) · mean` + `stacked (6 wafers)`; `hardBin`/`softBin` → `Hard Bin`/`Soft Bin`; `stackedBins`/`stackedSoftBins` → `Hard Bin 2 · Leakage` + `stacked (6 wafers)`. Titles truncate before overlapping the wafer and adapt to all six legend positions. New `ToCanvasOptions.showTitle` (default `true`) suppresses it; new public helper `buildMapTitle(view, fallbackFormat?, binDefs?)` and `MapTitleParts` type exported from `@paulrobins/wafermap/renderer` for custom pipelines.
- **Spec legend in `colorBySpec` (Spec pass/fail) mode.** Previously this mode coloured dies green/blue/red with no legend at all. It now renders a legend — Pass / Fail high / Fail low swatches with per-category die counts — adaptive to the active test's limits (a one-sided spec omits the absent fail side). The title reads `{test} · #{number}` above and `Spec pass/fail` below.
- **Gallery toolbar gains the value-mode spec controls.** The gallery control bar now offers **Spec pass/fail** (in the Overlays menu) and the **Colorbar range** button, gated identically to the single map: shown when the shared active test is a value map with `limitLow`/`limitHigh` (Colorbar range additionally hides while colouring by spec). Both apply to all cards. New optional `WaferMapResult.lotSize` (wafers aggregated in a lot stack) and `WaferMapDisplayItem.isLotStack`/`aggrMethod`/`lotSize` carry stack context to the title.

### Fixed

- **Log-scale toggle now reports its true state on the colorbar.** When log was requested but the active test's data range includes ≤ 0, the view silently falls back to linear; the colorbar now shows `linear — log n/a` (or `log₁₀` when applied) instead of leaving the user unsure why the scale "hardly changed". The scale note is enlarged and darkened for legibility.
- **Top-positioned bin legend no longer sits under the floating toolbar.** The top legend now starts below the toolbar clearance.

---

## [0.14.2] — 2026-06-20 (not published)

### Changed

- **Modal header now uses SVG icons instead of unicode glyphs.** The shared modal (`openModal`, used by the gallery and user-guide modals) previously rendered fullscreen/close with the glyphs `⛶`/`⤢`/`×`. It now uses the icon set: new `maximize` (enter fullscreen) and `minimize` (exit fullscreen) icons, and the new `x`-style `close` icon. The buttons gain the same bordered-box styling as the gallery-card expand button, so modal and card chrome read as one system.
- **Unified the expand icon.** The gallery card's "open full view" button used its own inline polyline SVG, separate from the toolbar `expand`. It now uses `ICONS.expand`, so there is a single definition of the expand icon. `maximize`/`minimize` (fullscreen) are deliberately distinct from `expand` (open-in-modal) so the two never read as the same affordance.

### Added

- **New icons** in the toolbar icon set: `maximize`, `minimize`, `close`.

---

## [0.14.1] — 2026-06-20

### Performance

- **`userGuideHtml` is now a deferred chunk.** The embedded end-user guide HTML (~26 KB gzipped) was previously statically imported, adding weight to the initial `wafermap/render` parse cost on every page load. It is now dynamically imported on first help-button click. The initial `wafermap/render` bundle drops from ~88 KB to ~62 KB gzipped (~30% smaller). The guide remains fully self-contained — no external network request, no server required; works offline and behind air-gapped tester networks.
- **Docs site now ships bundled JS.** `npm run build:site` runs esbuild after the Zensical build, replacing the unbundled tsc output in `site/dist/` with two minified entry-point bundles. Reduces module request waterfall from 15+ files to 2, cutting gallery page load time from ~3.3 s to ~1.2 s on low-powered clients.

### Tests

- **Bundle size regression tests** (`tests/bundle-size.test.mjs`) — fail if `wafermap` root exceeds 40 KB gzipped, `wafermap/render` initial chunk exceeds 75 KB gzipped, or `userGuideHtml` is statically imported from either render file.

---

## [0.14.0] — 2026-06-18

### Breaking

- **`HighlightRegionTarget.keys` renamed to `.regionKeys`** to match `HighlightBinTarget.regionKeys` — both now use the same field name for the region keys a finding covers. This is a metadata field on `StatsFinding.highlight`; the built-in renderers and reports highlight from `dieKeys`, so most consumers are unaffected.

### Added

- **Adjacent same-signal findings are now merged.** Runs of spatially adjacent regions (rings, quadrants, sectors) that carry the same signal — same variable, same direction — collapse into a single finding (e.g. "Rings 1–3") with statistics recomputed over the union of dies and the affected dies highlighted as one band. The constituent per-region finding ids are retained on the merged finding's `relatedIds` as an audit trail. This sharply reduces clutter where one physical signal previously surfaced as several near-identical findings. New stats exports: `parseRegionKey`, `areQuadrantsAdjacent`, `sectorCompassNames`.

### Fixed

- **Per-finding summaries handle merged region labels.** Summaries previously assumed single-region labels and, with merged findings, produced doubled wording ("quadrant Quadrants NW, SW, SE…"). They now read the merged labels directly (e.g. "Quadrants NW, SW & SE mean Test A is 45.5% lower…").
- **Findings narrative rewritten for scannability.** The prose summary above the findings list was dense and redundant — it emitted one sentence per region family (sector, quadrant, ring all restating one signal), buried the spatial pattern mid-paragraph, led with the healthy interior, used the vague "shifted", and could name the same region in both an "elevated" and a "reduced" clause. It now: leads with the spatial pattern (and names where the failures concentrate) or the strongest finding; consolidates the region families into a single sentence, collapsing a directional signal to "Test A increases from SW toward NE across the wafer"; folds redundant pass/fail-bin metrics into yield; never names a region in both directions; leads yield clauses with the failing side; and is capped at three sentences. The full findings list below the prose is unchanged and remains complete and severity-accurate.
- **Persistent summary panel now renders independently of the toolbar.** `renderWaferMap` with `summaryPanel` + `showToolbar: false` previously failed to mount the panel at all (the auto-mount was gated behind toolbar creation). The panel now mounts whenever a stats summary is provided; only the toggle button lives in the toolbar.

## [0.13.7] — 2026-06-16

### Added

- **`showHelpButton` option** (`RenderOptions` / `GalleryOptions`) — when `true`, adds a help button to the single-map toolbar / gallery bar that opens the built-in end-user guide in a modal. Default `false`. `WaferMapController` gains a matching `setHelpButtonVisible(visible)` method.

### Fixed

- **`mapDataToDies` matched on `physX`/`physY` instead of `x`/`y`.** Data was being correlated to dies using physical mm coordinates instead of die grid coordinates, causing all values to be dropped when `physX`/`physY` were not set (the common case). Corrected to match on `die.x`/`die.y`.

### Performance

- `buildView`: min-dim calculation for die gap capping replaced with an explicit loop — eliminates a closure allocation per call.
- `buildWaferMap` (`applyRetestPolicy`): retest count tracking switched from string-keyed flat Map to nested integer Maps — avoids string concatenation for every die result.

### Docs

- **Descriptive screenshot filenames.** All doc screenshots renamed from `image-N.png` to meaningful slugs (`guide-bins-named.png`, `guide-findings-panel.png`, etc.), eliminating the coupling to section numbers. `guide-test-sites.png` (§15 multi-site testing) added with a capture definition. Presentation-only images removed (`pres-bins.png`, `pres-values.png`, `csv.png`).
- **Descriptive demo filenames.** All example HTML files renamed from `NN-name.html` to `name.html` (`first-map.html`, `gallery.html`, etc.). `demo-nav.js` sequence updated; `test-sites.html` added to the navigation sequence.
- **`troubleshooting.md` and `detection-analysis.md`** added to the docs site nav (both existed on disk but were unreachable, causing 8 build warnings).
- API reference and developer guide updated for `showHelpButton`, `setHelpButtonVisible`, and `userGuideHtml.ts`.

---

## [0.13.6] — 2026-06-11

### Added

- **Spec limit markers on the value colorbar.** When the active test has `limitLow` / `limitHigh` defined, the colorbar now shows LSL/USL labels on the left side of the bar at the exact limit positions.
  - In `colorbarRangeMode: 'spec'` (default): the bar is anchored to the spec window, so the endpoints already are the limits — "LSL" / "USL" labels appear at the bar ends alongside the numeric tick values.
  - In `colorbarRangeMode: 'data'`: the bar spans the data range; LSL/USL are shown as dual-stroke inline marker lines (white halo + dark rule) wherever the limits fall within the bar, readable on any gradient colour.

### Changed

- **`colorbarRangeMode: 'data'` now suppresses out-of-spec die colouring.** When the colorbar is in data-range mode, out-of-spec dies are coloured by the gradient like all other dies rather than blue/red — the bar and the die colours are now always consistent with each other. Spec-fail colouring (blue/red) still applies in `'spec'` mode (the default) and is always used when `colorBySpec: true` regardless of range mode.
- **`colorBySpec: true` forces `colorbarRangeMode` to `'spec'` internally.** Passing `colorBySpec: true` with `colorbarRangeMode: 'data'` previously produced an incoherent state (all dies green). The library now overrides the range mode so pass/fail colouring is always correct.
- **Quadrant overlay lines are now die-aligned.** The NE/NW/SE/SW boundary lines previously passed through `wafer.center` exactly, which could bisect die columns or rows. They now pass through the midpoint of the gap between the innermost die column/row on each side of centre, matching the classification boundary used by `classifyDie`.
- **Ring and quadrant overlay lines use dual-stroke rendering.** Both line types are now drawn with a 3 px dark semi-transparent pass and a 1 px white pass on top, making them legible on any die colour, colour scheme, or die/gap size.

---

## [0.13.5] — 2026-06-10

### Added

- `WaferMapResult.warnings` — a promoted, always-present `WaferWarning[]` of structured geometry-inference advisories (`{ code, message, confidence? }`). The one advisory today is `'partial-coverage'`: data that does not span a full symmetric wafer, where the inferred diameter/centre may be wrong. Read this instead of relying on `console.warn`. The pre-existing `result.inference.warnings` string array is now deprecated (it mirrors the `message` of each structured warning).
- `renderWaferMap` / `renderWaferGallery` `onSaveImage?(blob, suggestedName)` option — host hook for persisting the rendered PNG. When provided, the toolbar's save action calls it instead of triggering a browser `<a download>`, letting embedded hosts (Tauri, Electron, WebView2) route the image through a native save dialog. When omitted, the default download behaviour is unchanged.
- `LotStatsSummary.perWaferTestStats` — per-wafer × per-test five-number summaries (min/Q1/median/Q3/max plus mean/stddev/count/label) for box-plot rendering. Projected from `perWafer[i].summary.stats.perTestStats`; only present when `enableTestValueAnalysis` is true and at least one wafer has test data.

### Accessibility

- Toolbar dropdown, plot-mode, and overlay menus now carry `role="menu"` with `menuitemradio` / `menuitemcheckbox` rows (`aria-checked` reflecting state), trigger buttons advertise `aria-haspopup="menu"` and toggle `aria-expanded`, and menus support full keyboard navigation (ArrowUp/Down, Home/End, Enter/Space, Escape). The expand modal is now a `role="dialog"` with `aria-modal`, a focus trap, and focus restoration to the opener on close. Toolbar buttons retain their `aria-label` and deliberately use no `title` attribute (which would duplicate the custom hover tooltip).

### Performance

- `buildView`: merged two O(D) min/max scans into one pass — eliminates a redundant full-die scan on every value-mode view build.
- `buildView`: replaced per-die object spread in rotation/flip path with a `Float64Array` coord pair table — reduces transient heap allocation from ~1.9 MB to ~314 KB per rotated view build at 20k dies, and eliminates 20k short-lived JS objects per call.
- `buildView`: merged bin-count accumulation into the rectangle generation loop — one fewer O(D) pass per bin-mode render.
- `toCanvas`: replaced O(D) linear scan in `getDieAtPoint` with a uniform-grid spatial index — reduces hover hit-testing from O(D) to near-O(1); 48× faster at 20k dies (0.77 ms vs 37 ms per 1000 probes).

### Changed

- `generateTextOverlay` (renderer-internal export): second parameter is now `txCoords: Float64Array | null` before the options object. Pass `null` when calling outside a rotation/flip context.

---

## [0.13.3] — 2026-06-08

### Breaking

- `buildWaferMap([])` and `buildWaferMap({ results: [] })` with no explicit `dies` or `waferConfig` now return an empty die array (`dies.length === 0`). Previously a default normalized grid was generated. Callers that relied on the default grid with empty input must supply explicit `dies` or a `waferConfig` to restore grid generation.
- `renderWaferMap` now takes `(container: HTMLElement, result, options?)` — the container is an ordinary `div`; the library creates and manages the canvas internally. Passing a `<canvas>` element directly is no longer supported.
- `MountOptions` renamed to `RenderOptions` (the options bag for `renderWaferMap`).
- `ViewOptions.testIndex` renamed to `activeTest` — it was always a testNumber, not a positional index; the old name is removed with no alias.
- `plotMode: 'specLimit'` removed — use `colorBySpec: true` as an overlay toggle in value mode instead.
- `onViewOptionsChange` callback now receives `(opts, changed, category)` where `changed` is the array of changed keys and `category` is `'preference' | 'state' | 'mixed'`, enabling callers to decide what to persist without inspecting individual keys.
- Plotly support removed: `plotlyColorscale` field on `ColorScheme`, the standalone `getDieAtPoint` export, and all Plotly-specific internals are gone. Use `hitTarget.getDieAtPoint` from the `toCanvas` return value instead.

### Added

- `setReportOpener(opener)` in `@paulrobins/wafermap/stats` — registers a custom HTML report handler for embedded hosts (Tauri, Electron, WebView2) where `window.open` is blocked. All `openHtmlReport` calls, including the summary panel buttons, route through the registered opener automatically.
- `downloadFilename` option on `RenderOptions` (`renderWaferMap`) — sets the PNG download filename stem (default `'wafermap'`); `.png` is appended automatically. Previously hardcoded.
- CSS custom property `--wmap-z` (default `100`) controls the z-index stack for all toolbar menus, dropdowns, and the hover tooltip. Set it at `:root` to avoid conflicts with host-application overlays.
- `ViewOptions.valueRange` now accepts a test-keyed form `{ test, range }` in addition to the `[min, max]` tuple. The object form is applied only when `test` matches the active test; on mismatch the range is ignored and the scene auto-scales, so a value range computed for one test can never colour another test's data. The tuple form is unchanged and still applies to whichever test is active.
- `worker.runWithAnalysis(inputs, options, hasMultiWafer)` on `WafermapWorker` — builds and analyses in a single round-trip, keeping the built `WaferMapResult`s inside the worker instead of cloning them out and back in for analysis. Prefer it over `run` + `runAnalysis` when both maps and stats are needed; it removes two structured-clone copies of the large result per wafer.
- `waferConfig.center` — the prober coordinate `{x,y}` that lies at the physical wafer centre. Anchors die placement to the true centre for partial/sparse data (half wafers, quadrants, edge rings, clusters) or off-centre prober origins, where inferring the centre from the data extent would be wrong. Does not affect the public `die.x`/`die.y` labels.
- `result.inference.warnings` (`string[]`) — geometry-trust warnings raised during inference. Populated (and `inference.wafer.method` set to `'inferred-partial'`) when likely-partial data is detected with no `waferConfig.center`/`diameter`, so callers are not silently shown a mis-centred map.
- `GalleryItemFactory` type (`() => GalleryItem`) accepted by `renderWaferGallery` and `setItems` — the gallery inserts placeholder cards immediately and resolves each factory in a deferred browser task, keeping the page responsive while large item sets are built progressively
- Findings narrative: a short auto-generated italic summary paragraph appears above the findings list in the summary panel and HTML report, grouping the most significant spatial patterns into 2–4 readable sentences
- `WaferMapInputBase`, `WaferMapInputSingle`, `WaferMapInputLotStack` — `WaferMapInput` is now a proper discriminated union. Passing both `results` and `lotStack` on the same object is a type error and is rejected at runtime. Previously this was silently accepted and the behaviour was undefined.
- Expand button (⛶ / key `E`) on every single map — opens a full-screen modal with a complete toolbar, summary panel, and zoom/pan controls. The modal reparents the canvas and summary panel; closing it restores them in place.
- Gallery cards auto-size by die pitch so all cards in a grid render at a consistent physical scale.
- `columns` option on `renderWaferGallery` and a Columns toolbar dropdown (Auto / 1–5) — the layout updates live via ResizeObserver.
- `setResult()` controller method on `WaferMapController` — replaces the rendered map data without re-mounting.
- Tooltip now avoids viewport edges — flips left when it would overflow the right edge, clamps vertically.
- `View` type exported from `@paulrobins/wafermap/renderer`.
- `StatsSummary.stats.perTestStats` — each entry now includes `median`, `q1`, and `q3` (linear-interpolation quartiles) alongside the existing `mean`/`stddev`/`min`/`max`. Eliminates the need for callers to sort and compute quartiles themselves for box-plot visualisations.

### Renamed (deprecated aliases still work)
- `WaferCanvasController` → `WaferMapController` — the return type of `renderWaferMap`. The old name is kept as a deprecated alias and will be removed in a future release.
- `CanvasHitTarget` → `HitTarget` — the hit-testing object returned by `toCanvas`. The old name is kept as a deprecated alias.
- `showText` → `showDieLabels` (on `WaferViewOptions` / `WaferPreferences`) — controls die index label overlay. The old name is kept as a deprecated alias.
- `aggrMethod` → `aggregationMethod` (on `WaferDisplayState` / `ViewOptions`) — aggregation method for `stackedValues` mode. The old name is kept as a deprecated alias.

### Changed

- Colour scheme dropdown in bin modes (`hardBin` / `softBin`) now shows only **Default** and **Accessible** — Viridis, Plasma, and Inferno apply gradient semantics to ordered values and produce misleading colours for categorical bin classifications. All schemes remain available in value and stacked modes.
- `softBinColor` now uses a hash-based discrete palette (identical in structure to `hardBinColor`) rather than a Viridis gradient. Soft bins are discrete fail classifications; this change ensures any sbin number range (including high-value bitwise-encoded sbins in the 10000s) maps to visually distinct colours, matching the semantics already used for hard bins. `maxBin` parameter removed.
- `hardBinColor` bins 15+ now use a Wang hash into a 63-entry golden-angle HSL palette. Bins 1–14 retain hand-picked colours for maximum low-range distinctiveness; bin 1 is always green (pass convention).
- Accessible colour scheme palette extended from 14 entries (Okabe-Ito) to a 63-entry colourblind-safe palette covering blue (202–256°), orange/yellow (26–57°), teal (160–192°), and purple/pink (283–324°) hue families at three lightness tiers, ensuring good spread for any bin number range.
- `yieldPercent` and `yieldPercentGross` on `WaferMapResult.yield`, `StatsSummary.stats`, and `LotStatsSummary.lotYieldSeries` are now **0–100** real percentages (previously 0–1 fractions despite the `*Percent` name). All built-in display code updated; callers that multiply by 100 before displaying must remove the multiply. **Breaking for existing callers that read these fields.**
- `WaferViewOptions` split into `WaferPreferences` (stable, persist-worthy settings: orientation, colour scheme, overlays) and `WaferDisplayState` (transient, session-only state: active test, highlight bin, value range). The flat shape is unchanged; callers set any field directly as before.
- `hbinDefs`, `sbinDefs`, and `testDefs` are now top-level fields on `WaferMapResult` — callers no longer need to round-trip these back through `viewOptions`.
- `buildView` signature: bin definitions are now passed as a separate second argument rather than via `ViewOptions`.
- `buildView` and `View` removed from the root `@paulrobins/wafermap` export — they are `@internal` and were never part of the stable API. They remain available from `@paulrobins/wafermap/renderer` for advanced use.
- `hbinDefs` / `sbinDefs` removed from `RenderOptions` — they were silently ignored because the renderer always reads bin definitions from the `WaferMapResult` directly. Pass them to `buildWaferMap` instead.
- Cluster and edge-arc severity now accounts for cluster size: a cluster covering ≥ 10 % of the wafer scores `unusual` and ≥ 3 % scores `notable`, regardless of rate contrast — ensures visually dominant patterns are not buried in the findings list.
- `buildView` tooltip strings are computed lazily at hover time rather than eagerly for every die — approximately 2.4× faster for large wafers.
- Toolbar fades to 35% opacity when the mouse leaves (was fully hidden) and always accepts pointer events — buttons remain clickable without requiring hover.

### Fixed
- Summary panel bin pareto now re-renders when the plot mode changes (e.g. switching between hardBin and softBin) as well as when the colour scheme changes. Previously only a direct colour scheme change triggered a panel update.
- Switching to a bin plot mode (`hardBin` / `softBin`) while a non-bin-compatible colour scheme (Viridis, Greyscale, Plasma, Inferno) is active now resets the scheme to Default. Only Default, Accessible, and Custom are valid in bin mode; leaving an incompatible scheme active produced incorrect bin colours with no way to recover from the toolbar.
- Summary panel bin breakdown bars now use the active colour scheme (`getColorScheme().forBin()`) and update immediately when the user changes scheme. Both the `summaryPanel` option panel and the toolbar-toggled panel are updated.
- Summary panel yield bars (ring yield, quadrant yield, per-wafer yield) now use a blue→orange gradient (low = muted blue, high = warm orange) instead of a red/green hue ramp — readable for all colour vision types.
- Toolbar dropdown and check menus opened from inside an expand modal now appear above the modal content. Previously they were appended to `document.body` and rendered beneath the modal's stacking context.
- Gallery legend regression (bin colours lost after a mode switch).
- Non-square die rotation now correctly accounts for aspect ratio — previously produced skewed geometry.
- Expand modal correctly reparents the summary panel wrapper alongside the canvas.
- `GalleryItemFactory` exported from `@paulrobins/wafermap/render` (was documented but missing from public surface).
- Wafer geometry inference no longer generates no-data (grey) dies at the edge of the wafer circle. Die positions are now built exclusively from input data — `generateDies`/`clipDiesToWafer` is bypassed in the grid path. Partial/full classification still uses the inferred circle, but the circle no longer determines which positions exist.
- Inferred wafer diameter uses p98 of per-die corner distances (from the grid midpoint) rather than the raw max centre distance, eliminating the oversized circle that rectangular-masked datasets (WM-811K, MixedWM38) previously produced.
- For grids with an even column count (e.g. 26-wide, centre at a half-integer), die physX/Y is now centred on the grid midpoint so the rendered wafer circle and die grid are co-centred on screen.
- Viewport bounding box is now derived from `wafer.center ± wafer.radius` rather than die physX/Y extents, so the wafer renders at a consistent visual size regardless of `showPartialDies` and regardless of how many partial dies are present at the arc edge.
- `showPartialDies: false` no longer causes the wafer to appear zoomed in (the previous implementation excluded partial dies from the viewport bounds, shrinking the fitted area and making the circle overflow into the toolbar and legend).
- `DieResult.metadata` is now copied through to output `Die` objects — custom fields (e.g. `siteId`) were previously silently dropped and never appeared in hover tooltips.
- Wafer boundary line weight reduced to 1 px (was 2 px) for a less prominent appearance.

---

## [0.11.3] — 2025-05

### Added
- MixedWM38 demo (§21): 38-class combined defect gallery loaded from the public MixedWM38 dataset
- WM-811K real-data demo (§19): 27 production wafer maps across 9 defect categories with statistical findings
- Sector analysis: angular sector findings (compass-named, 4 / 8 / 16 / 32 sectors) alongside existing quadrant analysis; `sectorCount` and `enableAngularAnalysis` options added to `analyzeWaferMap`
- Toolbar SVG icon pipeline (`scripts/sync-icons.mjs`) — icons embedded directly, no external asset dependency
- `retestPolicy: 'best' | 'worst'` — pass/fail-aware retest selection; `best` picks the passing result when any exist, `worst` picks the failing result

### Changed
- Stacked gallery modes (stackedValues, stackedBins, stackedSoftBins) automatically compute a spatial findings summary per card — no extra code required
- Summary panel narrative labels updated throughout for clarity (mean wafer yield, N= annotations, pass bin identification)

---

## [0.11.1] — 2025-04

### Breaking
- Die input coordinates renamed: `x` and `y` are now the canonical field names throughout the public API (replacing earlier positional / aliased forms)
- `WaferConfig` → `WaferOptions`; `DieConfig` → `DieOptions`; `WaferMapInput.data` → `.results`; `WaferMapInput.die` → `.dieConfig`
- `LotStackConfig.aggr` → `.method`; `'count_bin'` → `'countBin'`
- `PlotMode` values are camelCase: `'stackedValues'` / `'stackedBins'` / `'stackedSoftBins'`

### Added
- Spec limit colorbar range toggle — switches between spec-limit range (blue/red for out-of-spec) and data range
- `colorbarRangeMode` option on scene options
- `retestPolicy: 'best' | 'worst'` groundwork (completed in 0.11.3)

---

## [0.10.8] — 2025-03

### Added
- Aggregation method toolbar dropdown (Σ button) in gallery stacked-values mode — mean, median, std dev, min, max, count switchable interactively
- Log-scale toggle in toolbar for value and stacked-values modes

### Fixed
- Summary panel wrapper removal no longer detaches the map canvas
- Axis labels now correctly display original die XY coordinates regardless of flip / rotate state

---

## [0.10.0] — 2025-02

### Breaking
- `hbin` and `sbin` replace the previous `bins[0]` / `bins[1]` internal properties throughout — affects any code reading raw `Die` objects
- `mountWaferCanvas` deprecated in favour of `renderWaferMap` (re-exported with deprecation notice)

### Added
- Soft-bin analysis in `analyzeWaferMap` — soft-bin-only wafers now produce findings
- Reticle-position analysis: per-reticle-cell yield comparison against the rest of the wafer
- HTML findings report (`renderFindingsReportHtml`, `openHtmlReport`) with print-ready styling
- Lot-level findings (`analyzeWaferLot`) with per-wafer breakdown and inter-wafer trend detection

---

## [0.9.x] — 2025-01

### Added
- Statistical findings engine (`analyzeWaferMap`): ring, quadrant, and cluster / edge-arc spatial analysis with binomial significance testing
- Summary panel (`summaryPanel` option on `renderWaferMap`) with findings list, severity badges, and die-highlight integration
- Gallery summary panel with lot-level drill-down
- Web Worker support (`@paulrobins/wafermap/worker`) — `buildWaferMap` off the main thread

---

*Dates are approximate — the project did not use formal version tags before 0.11.x.*
