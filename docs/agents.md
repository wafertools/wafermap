# Using wafermap with an AI coding agent

**For:** developers whose day-to-day coding runs through Claude Code, Codex, Copilot,
Cursor or similar. **See also:** [Developer Guide](guide.md) · [API Reference](api.md)

Wafer maps drive yield calls, lot dispositions and process changes. The dangerous
failure is not code that crashes — it is a map that looks entirely reasonable and is
wrong. Several of this library's inputs invite a confident wrong guess:
`die.hbin ?? 0` reads as ordinary defensive coding but turns no-data dies into bin 0
and moves the yield number; `activeTest` reads like an array index but is a test
number.

The rules below are the ones worth loading before an agent writes wafer map code.

## Give these rules to your agent

Copy this block into your project's agent config — `CLAUDE.md`, `AGENTS.md`,
`.cursorrules`, `.github/copilot-instructions.md`, whichever your tool reads.

````markdown
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
  (`result.inference.warnings` is a deprecated string mirror; do not use it.)
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
````

## Keeping it honest

An agent guide that names a removed API is worse than no guide, because an agent
will follow it confidently. Everything checkable in the block above is asserted
against the built type declarations by `scripts/check-agents-guide.mjs`, which runs
in `npm run check` and in CI: every recommended symbol must still exist, every
symbol listed as removed must still be absent, and structural claims — that
`DieResult` has no `values`, that `TestDef` has no `index` — are verified against
`dist/**/*.d.ts` rather than trusted.

If a rule here and the [API Reference](api.md) ever disagree, the API Reference is
correct and this page has a bug worth reporting.

## Also shipped

- `AGENTS.md` in the [repository](https://github.com/wafertools/wafermap/blob/main/AGENTS.md)
  and in the npm package, so `node_modules/@wafertools/wafermap/AGENTS.md` is readable
  when you point an agent at the installed package.
- `llms.txt` — a short machine-readable map of the docs and entry points, served at
  [wafertools.github.io/wafermap/llms.txt](https://wafertools.github.io/wafermap/llms.txt)
  and shipped inside the npm package.
- `AGENTS.md` at the root of the
  [examples package](wafermap-examples.zip), since opening an agent inside that
  folder to adapt an example is a realistic way to start.
