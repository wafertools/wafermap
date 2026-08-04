# Changelog

All notable changes to `@wafertools/wafermap` are documented here.

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
