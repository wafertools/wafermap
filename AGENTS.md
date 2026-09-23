# wafermap — rules for AI coding agents

Guidance for AI tools (Claude Code, Codex, Copilot, Cursor, …) writing code that
**uses** `@wafertools/wafermap`. Paste the rules below into your project's own
agent config so they are loaded whenever the agent works on wafer map code.

This library renders semiconductor wafer maps. Its output drives yield calls, lot
dispositions and process changes, so a plot that is *plausibly but silently wrong*
is the expensive failure — worse than one that throws. Most rules here exist
because the obvious-looking code produces exactly that.

<!-- RULES:START -->

## wafermap — usage rules

`@wafertools/wafermap` renders wafer maps from semiconductor die test data.
Wrong-but-plausible output drives real yield and lot decisions, so prefer failing
loudly over guessing.

### Entry points

- `@wafertools/wafermap` — `buildWaferMap()`, geometry, `registerBinColorScheme()` / `registerValueColorScheme()`. Pure, no DOM, server-safe.
- `@wafertools/wafermap/render` — `renderWaferMap()`, `renderWaferGallery()`. Needs the DOM.
- `@wafertools/wafermap/stats` — `analyzeWaferMap()`, `analyzeWaferLot()`. Pure analysis.
- `@wafertools/wafermap/worker` — `createWafermapWorker()` for off-main-thread builds.

Default path: `buildWaferMap()` once when data loads, then `renderWaferMap()` for a
single wafer or `renderWaferGallery()` for several.

**The types still export a large deprecated surface that is removed in 0.31.0 — do not
reach into it just because autocomplete offers it.** Four groups, all replaced by the
default path above:

- the low-level drawing pipeline — `buildView()`, `toCanvas()`, `createWafer()`,
  `generateDies()`, and the geometry and transform helpers around them;
- the chart-data builders — `buildYieldData()`, `buildCorrelationMatrix()`,
  `buildTestBoxplotData()` and the rest: these were the internals of the Insights tab,
  which the renderers now mount for you (see below);
- the region builders — `buildRingRegions()`, `buildQuadrantRegions()` and friends:
  region yield comes back from `analyzeWaferMap()`;
- per-die and per-colour helpers — `getDieTestValue()`, `buildHoverText()`,
  `resolveBinColors()`, `getValueColorScheme()`, `valueToViridis()`.

If the only way to do something is through one of these, that is a library gap worth
reporting, not a pattern to build on.

### Traps that produce silently wrong maps

- **Never `die.hbin ?? 0` or `die.sbin ?? 0`.** A missing bin is not bin 0 — it is
  no-data, and must render grey. Defaulting to 0 invents a bin and changes the
  yield number. Leave the field absent.
- **`x` and `y` are prober step positions (integers), not millimetres.** Pass them
  through unchanged; `dieConfig.width`/`height` convert to physical units. Do not
  pre-multiply. The geometry inputs are `waferConfig` (type `WaferConfig`) and
  `dieConfig` (type `DieConfig`) — both optional, both inferred when omitted.
- **Bins and test values must be numbers, and verdicts booleans.** Every parser —
  CSV, JSON, a spreadsheet export — hands you `"1"`, and `"1"` is not pass bin 1: those
  dies count as fails and the yield is wrong, while a test value left as text is not
  plotted or analysed correctly. Convert with `Number()` at parse time. `buildWaferMap`
  samples the input and reports `input-values-not-numbers` (severity `'error'`) rather
  than coercing behind your back, so a build that "works" can still be wrong — read the
  warnings.
- **`passBins` and `ringCount` are set once, on `buildWaferMap`, and travel on the
  result.** Neither is an option on `analyzeWaferMap`, `analyzeWaferLot`,
  `renderWaferMap` or `renderWaferGallery` — passing one there is a type error in
  TypeScript, and in JavaScript it is ignored with an `analysis-option-corrected`
  warning while the real value is read from the map. `passBins` decides both the yield
  number and the wording of its label, so set it from the actual test program: do not
  assume `[1]`, and never re-default to `[1]` downstream — read `result.passBins`.
- **`testValues` is keyed by test number**, e.g. `{ 1050: 0.42 }` — not a positional
  array. `activeTest` likewise takes a *test number* (`1050`), not an index.
- **Functional tests (`testType: 'F'`) have no measured value.** Read their verdicts
  only via `getTestPassStatus(die, testNumber, def)`; never read `die.testPass`
  directly and never interpret a 0/1 in `testValues`. A missing verdict is no-data,
  never a fail.
- **Show users `die.x` / `die.y` only.** Never surface internal display or
  transformed coordinates in tooltips, labels or reports, whatever the rotation or
  flip state.
- **A die with test results is always fully on the wafer.** A prober only steps to
  sites that fit. Never recompute a `partial` flag by testing die corners against
  the wafer circle — that manufactures fake partial dies which are then greyed out
  and dropped from yield. A die outside the wafer means the *geometry* is wrong.
- **Check `result.warnings` and `summary.stats.warnings`.** Both carry
  `WaferWarning` — `{ code, message, severity }`. Branch on `code`, never on the
  prose. **The two differ in shape and the difference throws:**
  `result.warnings` is required and always an array (`[]` when clean), but
  `summary.stats.warnings` is *optional* and is `undefined` when there is nothing
  to report. Write `summary.stats.warnings?.length` — a bare
  `summary.stats.warnings.length` is a TypeError on every clean wafer, which is
  most of them, so it will pass your testing and fail in production.
  Geometry advisories are severity `'error'`: they mean dies may be drawn in
  the wrong place. The renderers surface these themselves in a toolbar indicator, so
  do NOT hand-roll a second display — pass
  `warnings: { display: false, onWarning }` if the app has its own notification UI.
- **Give the container a resolved height.** `renderWaferMap` fills its container.
  A bare block-flow `<div>` is fine — it grows to the canvas. The real failure is a
  flex/grid child whose ancestors never resolve a height: it stays 0-tall and the
  map is invisible. The library detects exactly that case after layout settles and
  `console.warn`s with the fix, so read the console before debugging further. Either
  give the container a real CSS height, or pass `{ height: 600 }` in the render
  options and the library will size it for you.

### API facts that are easy to guess wrong

- `PlotMode` values are camelCase: `'hardBin'`, `'softBin'`, `'value'`, `'metadata'`,
  `'stackedValues'`, `'stackedBins'`, `'stackedSoftBins'`. Never snake_case.
- `retestCount` is the total probe count — `2` means probed twice. Do not add 1.
- `retestPolicy: 'best'`/`'worst'` is pass/fail-aware via `passBins`; bin number only
  breaks ties within a category.
- Hard bins (`hbin`) and soft bins (`sbin`) are independent number spaces. Never merge them.
- **Do not colour bins yourself.** The maps give each bin one colour from its number
  and its pass/fail verdict (pass bins, per `passBins`, take green pass colours), so a
  bin is the same colour in every lot. To choose colours, set `BinDef.color` or register
  a palette with `registerBinColorScheme`. Bin maps and value maps have separate
  schemes: `binColorScheme` and `valueColorScheme`. Need the colours for a surface of
  your own (a table swatch, an export)? Read `controller.getBinColors()` for a live map,
  or `binColorsForMaps(results)` — never a palette lookup of your own.
- Build once, render many: `buildWaferMap()` handles data + geometry; re-render UI
  changes through the controller's `setOptions()`, not by rebuilding. New data for a
  map that is already mounted goes through `setResult()` — do not `destroy()` and
  remount.
- **The analysis surfaces are already built — do not reimplement them.** Pass
  `statsSummary` to `renderWaferMap` and it mounts the Summary panel; pass
  `insights: { enabled: true }` and it mounts the chart suite (yield, bin pareto,
  boxplot, histogram, correlation, scatter, capability). `renderWaferGallery` takes the
  same option across a whole lot. Supply or replace the analysis later with
  `setStatsSummary()`. Hand-building those charts is what the deprecated chart-data
  builders were for, and they go in 0.31.0.
- **Click-to-highlight is wired, not hand-rolled.** `onSelect` reports what the user
  picked; `setSelection(dies)` / `clearSelection()` drive it from your own UI — for
  example from a finding, whose `dieKeys` match `getDieKey(die)` exactly.
- A die layout with no test data — a map of the reticle or the grid alone — is
  `buildWaferMap({ layout: true, waferConfig, dieConfig })`, not a synthesized results
  array.
- `valueColorScheme` and `reverseValueScheme` travel as a pair. Every built-in gradient
  but `'traffic'` and `'jet'` reads low = dark, high = light; if you draw your own
  colorbar or swatch, resolve the colour through `resolveValueColorFn(name, reversed)`
  so it cannot disagree with the dies.
- `result.view` is internal. Use the promoted fields: `result.plotMode`,
  `result.metadata`, `result.isLotStack`, `result.hbinDefs`, `result.sbinDefs`,
  `result.testDefs`.
- Die keys come from `getDieKey(die)`. A hand-rolled `` `${x},${y}` `` breaks
  click-to-highlight silently, because findings carry `dieKeys` in that exact format.
- `stats.warnings` is `WaferWarning[]` (it was `string[]` before 0.22.0). Read
  `w.message` to display, branch on `w.code`. Code that calls a string method on an
  entry — `warnings[0].includes('…')` — is the old shape and will throw.
- **`summary.findings` is the complete list and contains restatements of the same
  fact.** Building a list for a human to read? Pass it through `visibleFindings()`,
  which drops what other findings absorb — do not re-implement that filter.
  Skip that and one edge failure is reported up to three times per region — a hard
  bin row, its soft-bin twin, and the yield row that restates the pass bin. Do NOT
  use `relatedIds` for this; it is a different relationship and some ids it names
  no longer exist in `findings`.

### Scale: do not turn this into a data explorer

The most common performance mistake is treating the library as somewhere to dump
an entire test program and browse it. It is a *renderer* — it analyses everything
it is handed, because it has no way to know which tests anyone will look at.

- **Pass only the tests you will actually chart or analyse in `testDefs`.** A real
  parametric program can carry hundreds of tests while the user ever looks at a
  handful. Cost scales with test count, and test correlation scales
  *quadratically*: on a ~1,000-die wafer, `enableTestValueAnalysis` costs ~25 ms at
  6 tests and ~91 ms at 60, while the correlation matrix goes from 15 pairs to 1,770.
- **Do not "load everything, filter in the UI".** Filtering after the fact means you
  already paid for the parse, the transfer and the analysis.
- **The right shape is pre-scan → select → load.** Scan the source for which test
  numbers exist (and their names/limits if available), let the user choose, then
  parse and build only the chosen tests. A scan that reads test identity without
  reading every value is dramatically cheaper than a full load, and it is what makes
  a large file feel instant.
- **Above 250 discovered tests, `analyzeWaferMap` gives up on test-value analysis
  entirely** — it returns no test findings rather than a trimmed set, and records a
  `WaferWarning` with code `'test-count-capped'` in `stats.warnings`. Silence is not
  success here: an empty findings list is indistinguishable from "nothing to report"
  unless you check. Pass `testNumbers: [...]` to scope the analysis explicitly.
- **Reach for options deliberately.** Plain `analyzeWaferMap()` is cheap;
  `computePerTestStats` is modest; `enableTestValueAnalysis` is the expensive one
  (roughly 10× the base analysis on a large wafer) and exists to find spatial
  patterns automatically — do not enable it by default just because it sounds good.
- **A Web Worker buys responsiveness, not speed.** `createWafermapWorker` copies data
  across `postMessage`, so total time goes *up*. Use it when a build would otherwise
  visibly freeze the page, not for small datasets.
- **Capability, pass rates, region yield and the spatial-pattern label come back from
  the analysis** — `stats.capability` (with `computePerTestStats`), `stats.testSpecYield`,
  `stats.testFlagYield`, `stats.functionalYield`, `stats.regionYield` and
  `stats.spatialPattern`, on wafer and lot summaries alike. Do not compute Cp/Cpk or ring yield yourself: the pooled
  within-wafer stddev and per-wafer pass bins are easy to get subtly wrong.
- **Reports from code: `renderWaferReportHtml(result, summary)` and
  `renderLotReportHtml(results)`** — they take the built maps, so pass bins and ring
  count cannot be wrong. They run in Node.
- **In a gallery, pass `perWaferSummaries` to `analyzeWaferLot`** so it reuses the
  per-wafer analysis you already ran instead of redoing it.

### Removed — do not emit these

| Never | Use instead |
| --- | --- |
| `DieResult.values` / `Die.values` | `testValues` (keyed by test number) |
| `TestDef.index` | `TestDef.testNumber` (required) |
| `ViewOptions.colorBySpec` | `passFailDisplay: 'spec'` |
| `View.colorBySpec` | `view.passFailDisplay` |
| `WaferMapResult.inference.warnings` | `WaferMapResult.warnings` (structured, with a `code`) |
| `ViewOptions.testIndex` | `activeTest` |
| `mountWaferCanvas` | `renderWaferMap` |
| `HARD_BIN_COLORS` / `SOFT_BIN_COLORS` | `BinDef.color`, or `registerBinColorScheme` — there is no exported palette constant |
| `GalleryItem` | `WaferMapDisplayItem` |
| `MountOptions` | `RenderOptions` |
| `WaferCanvasController` | `WaferMapController` |
| `CanvasHitTarget` | `HitTarget` |
| `buildScene` / `BuildSceneOptions` / `SceneOptions` | `renderWaferMap` |
| `WaferFlat`, field `flat` | `WaferNotch`, field `notch` |
| `isInsideWaferWithFlat` | nothing — `buildWaferMap` resolves the geometry |
| `DieSample` / `WaferMapPoint` | `DieResult` |
| `colorScheme` / `WaferViewOptions.colorScheme` | `binColorScheme` (bin maps) and `valueColorScheme` (value and stacked maps) |
| `registerColorScheme` / `getColorScheme` / `listColorSchemes` | `registerBinColorScheme` / `registerValueColorScheme` and their `get` / `list` pairs |
| `hardBinColor` / `softBinColor` / `hardBinGreyscale` | `BinDef.color`, or `registerBinColorScheme` |
| `plotMode: 'specLimit'` | `passFailDisplay: 'spec'` |
| standalone `getDieAtPoint` | `onHover` / `onClick` on `renderWaferMap` |
| `RenderOptions.tooltipTestLimit` | (was a no-op; nothing replaces it) |
| `enableYieldAnalysis` / `enableHardBinAnalysis` / `enableSoftBinAnalysis` / `enableReticlePositionAnalysis` / `enableTestSiteAnalysis` / `enableClusterAnalysis` / `enableAngularAnalysis` / `enablePatternClassification` | nothing — every analysis runs; scope cost with `testNumbers` instead |
| `WaferMapController.setIdentityVisible` | `showIdentity` in `RenderOptions` |

Passing a removed option is a type error, and is ignored at runtime. Do not add
compatibility shims for them.

### Terminology in user-facing text

- Never write "channel" — use "index", "slot" or "test". "Channel" is tester
  hardware jargon that confuses the engineers reading these maps.
- Label what is actually shown. Name the real pass bins rather than assuming bin 1;
  say "Hard Bin Breakdown" not "Bin Breakdown"; identify an aggregated or filtered
  population (`N=50`, "6 wafers · mean") so nobody mistakes a lot stack for one wafer.

<!-- RULES:END -->

## Where to look

- [API reference](https://wafertools.github.io/wafermap/api/) — every type, option and return value
- [Developer guide](https://wafertools.github.io/wafermap/guide/) — worked walkthroughs
- [Troubleshooting](https://wafertools.github.io/wafermap/troubleshooting/)
- [Examples](https://wafertools.github.io/wafermap/examples/) — 22 runnable pages, also
  [downloadable](https://wafertools.github.io/wafermap/wafermap-examples.zip) to run offline

When a rule here and the API reference disagree, the API reference wins — tell the
user, so this file gets fixed.
