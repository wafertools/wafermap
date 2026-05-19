# Changelog

All notable changes to `@paulrobins/wafermap` are documented here.

---

## [Unreleased]

### Added
- `GalleryItemFactory` type (`() => GalleryItem`) accepted by `renderWaferGallery` and `setItems` — the gallery inserts placeholder cards immediately and resolves each factory in a deferred browser task, keeping the page responsive while large item sets are built progressively
- Findings narrative: a short auto-generated italic summary paragraph appears above the findings list in the summary panel and HTML report, grouping the most significant spatial patterns into 2–4 readable sentences

### Changed
- Cluster and edge-arc severity now accounts for cluster size: a cluster covering ≥ 10 % of the wafer scores `unusual` and ≥ 3 % scores `notable`, regardless of rate contrast — ensures visually dominant patterns (e.g. large donut clusters) are not buried in the findings list

### Fixed
- `GalleryItemFactory` exported from `@paulrobins/wafermap/canvas-adapter` (was documented but missing from public surface)

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
