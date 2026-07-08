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

## [Unreleased]

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
