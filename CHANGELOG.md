# Changelog

All notable changes to `@paulrobins/wafermap` are documented here.

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
