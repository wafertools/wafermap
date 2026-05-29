# Changelog

All notable changes to `@paulrobins/wafermap` are documented here.

---

## [Unreleased]

### Breaking

- `buildWaferMap([])` and `buildWaferMap({ results: [] })` with no explicit `dies` or `waferConfig` now return an empty die array (`dies.length === 0`). Previously a default normalized grid was generated. Callers that relied on the default grid with empty input must supply explicit `dies` or a `waferConfig` to restore grid generation.
- `renderWaferMap` now takes `(container: HTMLElement, result, options?)` — the container is an ordinary `div`; the library creates and manages the canvas internally. Passing a `<canvas>` element directly is no longer supported.
- `MountOptions` renamed to `RenderOptions` (the options bag for `renderWaferMap`).
- `ViewOptions.testIndex` renamed to `activeTest` — it was always a testNumber, not a positional index; the old name is removed with no alias.
- `plotMode: 'specLimit'` removed — use `colorBySpec: true` as an overlay toggle in value mode instead.
- `onViewOptionsChange` callback now receives `(opts, changed, category)` where `changed` is the array of changed keys and `category` is `'preference' | 'state' | 'mixed'`, enabling callers to decide what to persist without inspecting individual keys.
- Plotly support removed: `plotlyColorscale` field on `ColorScheme`, the standalone `getDieAtPoint` export, and all Plotly-specific internals are gone. Use `hitTarget.getDieAtPoint` from the `toCanvas` return value instead.

### Added
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

### Renamed (deprecated aliases still work)
- `WaferCanvasController` → `WaferMapController` — the return type of `renderWaferMap`. The old name is kept as a deprecated alias and will be removed in a future release.
- `CanvasHitTarget` → `HitTarget` — the hit-testing object returned by `toCanvas`. The old name is kept as a deprecated alias.
- `showText` → `showDieLabels` (on `WaferViewOptions` / `WaferPreferences`) — controls die index label overlay. The old name is kept as a deprecated alias.
- `aggrMethod` → `aggregationMethod` (on `WaferDisplayState` / `ViewOptions`) — aggregation method for `stackedValues` mode. The old name is kept as a deprecated alias.

### Changed
- `WaferViewOptions` split into `WaferPreferences` (stable, persist-worthy settings: orientation, colour scheme, overlays) and `WaferDisplayState` (transient, session-only state: active test, highlight bin, value range). The flat shape is unchanged; callers set any field directly as before.
- `hbinDefs`, `sbinDefs`, and `testDefs` are now top-level fields on `WaferMapResult` — callers no longer need to round-trip these back through `viewOptions`.
- `buildView` signature: bin definitions are now passed as a separate second argument rather than via `ViewOptions`.
- `buildView` and `View` removed from the root `@paulrobins/wafermap` export — they are `@internal` and were never part of the stable API. They remain available from `@paulrobins/wafermap/renderer` for advanced use.
- `hbinDefs` / `sbinDefs` removed from `RenderOptions` — they were silently ignored because the renderer always reads bin definitions from the `WaferMapResult` directly. Pass them to `buildWaferMap` instead.
- Cluster and edge-arc severity now accounts for cluster size: a cluster covering ≥ 10 % of the wafer scores `unusual` and ≥ 3 % scores `notable`, regardless of rate contrast — ensures visually dominant patterns are not buried in the findings list.
- `buildView` tooltip strings are computed lazily at hover time rather than eagerly for every die — approximately 2.4× faster for large wafers.
- Toolbar fades to 35% opacity when the mouse leaves (was fully hidden) and always accepts pointer events — buttons remain clickable without requiring hover.

### Fixed
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
