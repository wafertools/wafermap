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

- `@wafertools/wafermap` — `buildWaferMap()`, geometry, `registerColorScheme()`. Pure, no DOM, server-safe.
- `@wafertools/wafermap/render` — `renderWaferMap()`, `renderWaferGallery()`, `toCanvas()`. Needs the DOM.
- `@wafertools/wafermap/stats` — `analyzeWaferMap()`, `analyzeWaferLot()`. Pure analysis.
- `@wafertools/wafermap/worker` — `createWafermapWorker()` for off-main-thread builds.

Default path: `buildWaferMap()` once when data loads, then `renderWaferMap()` for a
single wafer or `renderWaferGallery()` for several. Reach for `toCanvas()`/`buildView()`
only when you need the low-level pipeline — they give up the toolbar and every UI
correctness guarantee that comes with it.

### Traps that produce silently wrong maps

- **Never `die.hbin ?? 0` or `die.sbin ?? 0`.** A missing bin is not bin 0 — it is
  no-data, and must render grey. Defaulting to 0 invents a bin and changes the
  yield number. Leave the field absent.
- **`x` and `y` are prober step positions (integers), not millimetres.** Pass them
  through unchanged; `dieConfig.width`/`height` convert to physical units. Do not
  pre-multiply. The geometry inputs are `waferConfig` (type `WaferConfig`) and
  `dieConfig` (type `DieConfig`) — both optional, both inferred when omitted.
- **`passBins` decides both the yield number and the wording of its label.** Set it
  from the actual test program. Do not assume `[1]`.
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
- **Check `result.warnings` and `summary.stats.warnings`.** Both are
  `WaferWarning[]` — `{ code, message, severity }`. Branch on `code`, never on the
  prose. Geometry advisories are severity `'error'`: they mean dies may be drawn in
  the wrong place. The renderers surface these themselves in a toolbar indicator, so
  do NOT hand-roll a second display — pass
  `warnings: { display: false, onWarning }` if the app has its own notification UI.
  (`result.inference.warnings` is a deprecated string mirror; do not use it.)
- **Container needs a real height.** A zero-height parent renders nothing. This is
  the most common "it didn't work" report.

### API facts that are easy to guess wrong

- `PlotMode` values are camelCase: `'hardBin'`, `'softBin'`, `'value'`, `'metadata'`,
  `'stackedValues'`, `'stackedBins'`, `'stackedSoftBins'`. Never snake_case.
- `retestCount` is the total probe count — `2` means probed twice. Do not add 1.
- `retestPolicy: 'best'`/`'worst'` is pass/fail-aware via `passBins`; bin number only
  breaks ties within a category.
- Hard bins (`hbin`) and soft bins (`sbin`) are independent number spaces. Never merge them.
- Build once, render many: `buildWaferMap()` handles data + geometry; re-render UI
  changes through the controller's `setOptions()`, not by rebuilding.
- `result.view` is internal. Use the promoted fields: `result.plotMode`,
  `result.metadata`, `result.isLotStack`, `result.hbinDefs`, `result.sbinDefs`,
  `result.testDefs`.
- Die keys come from `getDieKey(die)`. A hand-rolled `` `${x},${y}` `` breaks
  click-to-highlight silently, because findings carry `dieKeys` in that exact format.
- `stats.warnings` is `WaferWarning[]` (it was `string[]` before 0.22.0). Read
  `w.message` to display, branch on `w.code`. Code that calls a string method on an
  entry — `warnings[0].includes('…')` — is the old shape and will throw.
- **`summary.findings` is the complete list and contains restatements of the same
  fact.** Building a list for a human to read? Exclude what other findings absorb:
  `const absorbed = new Set(summary.findings.flatMap(f => f.absorbedIds ?? []))`.
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
- **In a gallery, pass `perWaferSummaries` to `analyzeWaferLot`** so it reuses the
  per-wafer analysis you already ran instead of redoing it.

### Removed — do not emit these

| Never | Use instead |
| --- | --- |
| `DieResult.values` / `Die.values` | `testValues` (keyed by test number) |
| `TestDef.index` | `TestDef.testNumber` (required) |
| `ViewOptions.colorBySpec` | `passFailDisplay: 'spec'` |
| `ViewOptions.testIndex` | `activeTest` |
| `mountWaferCanvas` | `renderWaferMap` |
| `HARD_BIN_COLORS` / `SOFT_BIN_COLORS` | `BIN_PALETTE` |
| `GalleryItem` | `WaferMapDisplayItem` |
| `MountOptions` | `RenderOptions` |
| `WaferCanvasController` | `WaferMapController` |
| `CanvasHitTarget` | `HitTarget` |
| `buildScene` / `BuildSceneOptions` / `SceneOptions` | `buildView` / `ViewOptions` |
| `WaferFlat`, field `flat` | `WaferNotch`, field `notch` |
| `isInsideWaferWithFlat` | `isInsideWafer` |
| `DieSample` / `WaferMapPoint` | `DieResult` |
| `colorScheme: 'color'` | `colorScheme: 'default'` |
| `plotMode: 'specLimit'` | `passFailDisplay: 'spec'` |
| standalone `getDieAtPoint` | `hitTarget.getDieAtPoint` from `toCanvas()` |
| `RenderOptions.tooltipTestLimit` | (was a no-op; nothing replaces it) |

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
- [Examples](https://wafertools.github.io/wafermap/examples/) — 20 runnable pages, also
  [downloadable](https://wafertools.github.io/wafermap/wafermap-examples.zip) to run offline

When a rule here and the API reference disagree, the API reference wins — tell the
user, so this file gets fixed.
