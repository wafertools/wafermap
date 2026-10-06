# API Reference — Statistics and findings engine

**Part of the [API Reference](../api.md).**

## 7 Statistics / Findings Engine

The stats engine detects statistically significant spatial patterns in wafer test data — yield loss, bin accumulation, or test value shifts concentrated in rings, quadrants, angular sectors, reticle positions, contiguous failure clusters, and edge arcs. It is pure (no DOM) and can run in Node.js.

Use `analyzeWaferMap` for a single wafer. Use `analyzeWaferLot` when you have a full lot and want cross-wafer patterns and outlier detection on top.

```ts
import { analyzeWaferMap, analyzeWaferLot } from '@wafertools/wafermap/stats';
```

### 7.1 `analyzeWaferMap(input, options?)`

```ts
analyzeWaferMap(input: WaferMapResult | WaferMapInput, options?: AnalyzeWaferMapOptions): StatsSummary
```

`WaferMapResult` → §4.2 · `WaferMapInput` → §4.1 · `AnalyzeWaferMapOptions` → §7.3 · `StatsSummary` → §7.4

Analyses a single wafer and returns a `StatsSummary`. Accepts either a `WaferMapInput` object or the `WaferMapResult` returned by `buildWaferMap` — passing the result is preferred because `passBins` and `testDefs` are inferred automatically.

```ts
const result  = buildWaferMap({ results, waferConfig, dieConfig, passBins: [1] });
const summary = analyzeWaferMap(result);

// findings is pre-sorted: 'unusual' first, then 'notable', then 'info'
console.log(summary.findings[0]?.summary);
// e.g. "Ring 4 (edge) yield is 18.3 pp lower than the rest of the wafer"

// Pass to renderWaferMap to add a findings panel to the toolbar:
renderWaferMap(container, result, { statsSummary: summary });
```

**Analysing a lot-stack result** — pass a `WaferMapResult` built with `lotStack` directly. Ring, quadrant, sector, and reticle-position analysis run on the aggregated test values. When the active test has spec limits (`limitLow` / `limitHigh` in `testDefs`), out-of-spec dies are used as the failure proxy for cluster and edge-arc detection. If no spec limits are defined, cluster detection is skipped automatically.

```ts
const result = buildWaferMap({
  lotStack:    { results: waferResults, method: 'mean' },
  waferConfig, dieConfig, testDefs,
});
const summary = analyzeWaferMap(result);
renderWaferMap(container, result, { statsSummary: summary });
// summary.stats.isLotStack === true
// summary.stats.aggregationMethod === 'mean'
```

### 7.2 `analyzeWaferLot(items, options?)`

```ts
analyzeWaferLot(items: Array<WaferMapResult | WaferMapInput>, options?: AnalyzeWaferMapOptions): LotStatsSummary
```

`WaferMapResult` → §4.2 · `WaferMapInput` → §4.1 · `AnalyzeWaferMapOptions` → §7.3 · `LotStatsSummary` → §7.5

Analyses an array of wafers together and returns a `LotStatsSummary`. Use this when you have a full lot and want findings that span wafers — patterns on a single wafer are available in `perWafer[i].summary`, while lot-level findings cover the whole lot.

Each element is a `WaferMapInput` or `WaferMapResult`. In addition to per-wafer analysis, the lot summary adds:

- **Repeated-pattern findings** — ring, quadrant, or sector patterns present on ≥ 2 wafers
- **Inter-wafer yield outliers** — wafers whose yield is a statistical outlier within the lot

```ts
const waferResults = waferDataSets.map(d => buildWaferMap(d));
const lotSummary   = analyzeWaferLot(waferResults);

// Per-wafer findings:
console.log(lotSummary.perWafer[0].summary.findings);

// Lot-level findings (regional patterns tested on all wafers combined, repeated
// clusters/edge arcs/spatial patterns, and yield outliers):
console.log(lotSummary.findings);

// Pass to renderWaferGallery to add a lot summary panel to the gallery bar:
renderWaferGallery(container, items, { lotStatsSummary: lotSummary });
```

### 7.3 `AnalyzeWaferMapOptions`

Both `analyzeWaferMap` and `analyzeWaferLot` accept these options, and most analyses work well with the defaults. Ring count is not one of them: it is set once on `buildWaferMap` (`ringCount`) and read from the result, so ring boundaries on the map and ring findings always agree.

```ts
{
  // ── Cost switches — every other analysis always runs ──────────────────────
  enableTestValueAnalysis?:       boolean  // default FALSE — expensive regional Welch pass on test values
                                           // (scales with regions × tests × dies). Opt in only when you
                                           // display the regional test-value findings. Implies perTestStats.
                                           // See the Performance guide for measured costs: performance.md
  computePerTestStats?:           boolean  // default false — cheap per-test quartile scan into perTestStats
                                           // (mean/stddev/median/q1/q3) WITHOUT the regional Welch pass.
                                           // Use this for box-plot / histogram panels. Implied by
                                           // enableTestValueAnalysis.

  // ── Test-value scope ──────────────────────────────────────────────────────
  testNumbers?:   number[]  // restrict test-value analysis to these test numbers;
                            // when omitted: all tests up to 250 — beyond that analysis is skipped
                            // and a 'test-count-capped' WaferWarning appears in
                            // summary.stats.warnings[] (§4.2.2) and in the map's
                            // warning indicator

  // ── Angular analysis ──────────────────────────────────────────────────────
  sectorCount?:             number  // sectors for angular analysis: 4 | 8 | 16 (default 8)
}
```

> **Removed in 0.27.0 — `significanceLevel`, `minimumEffectSize`, `minimumRelativeEffect`.**
> These set what counts as a finding, so a wrong value did not make the output
> *look* different — it made it wrong, and silently. A negative `significanceLevel`
> returned zero findings across the board, which reads as "nothing wrong with this
> wafer": the worst failure an analysis tool has. They are internal constants now,
> like `minimumSampleSize` always was. Their values, and the gates they drive, are
> documented in §7.3.2 — that is what callers actually needed. Passing them from
> untyped JavaScript no longer takes effect; the value is validated, ignored, and
> reported via a `WaferWarning`.

> **Removed in 0.30.0 — the per-analysis switches** (`enableYieldAnalysis`, `enableHardBinAnalysis`, `enableSoftBinAnalysis`, `enableReticlePositionAnalysis`, `enableTestSiteAnalysis`, `enableClusterAnalysis`, `enableAngularAnalysis`, `enablePatternClassification`). Every analysis now runs: yield, hard and
> soft bins, reticle positions (when `reticleConfig` is set), test sites (when the wafer has meaningful site
> duplication), angular sectors, clusters and pattern classification. Each was cheap and on by default. To show
> fewer findings, filter them with `filterFindings` (§7.11). Passing one from untyped JavaScript is ignored and
> reported as an `analysis-option-corrected` warning.

**Every numeric option here is validated.** A value outside the range that can
produce a meaningful analysis is corrected to the nearest usable one and reported
as an `'analysis-option-corrected'` `WaferWarning` in `summary.stats.warnings[]`
(§4.2.2) — visible in the renderers' warning indicator. `sectorCount` must be 4, 8
or 16. `ringCount` is validated the same way but on `buildWaferMap`, where it is
set, and reported in `result.warnings`; there is deliberately no upper bound on it,
since a fine banding is still gated by the minimum region size.

### 7.3.1 Choosing what to analyse — cost, and who decides

Every analysis runs except two, which cost real time and are yours to decide:

| Option | Cost | Decide it |
|---|---|---|
| `computePerTestStats` | cheap — a quartile scan | Once, for your whole app. On if you show distribution or box-plot charts. |
| `enableTestValueAnalysis` | **~0.3µs per (wafer × die × test)** in Chrome, **~0.65µs** in WebKit | **Per lot, not once.** Milliseconds on one wafer; seconds on a lot. |

`enableTestValueAnalysis` is off by default because it is the only option whose
cost changes kind with lot size — see [Performance](../performance.md#the-number-that-matters-is-the-lot-not-the-wafer)
for measured figures. Being off by default is *not* a recommendation to leave it
off: it produces the regional test-value findings, and an integrator who never
enables it ships a Findings list that silently omits a whole category.

Estimate before you decide:

```ts
const estimateMs = waferCount * diesPerWafer * testCount * 0.7 / 1000;
```

The coefficient is sized for WebKit (Safari, and the desktop webviews on Linux
and macOS), the slower engine here; Chrome runs the analysis in about half that.
Below roughly a second, just run it — the user will not notice it against the
parse and render that just happened, and asking is pure friction. Above that,
run the analysis without it and pass a [`FindingsNotice`](render-map.md#54-renderoptions) so
the Findings panel states what is missing and what computing it would cost. That
way the absence is visible where the findings are, rather than depending on the
user discovering a control elsewhere.

> **Do not** leave `enableTestValueAnalysis` on unconditionally for a lot
> viewer. A 25-wafer lot with a few hundred tests takes tens of seconds, with no
> progress indication, and reads as a hang.

### 7.3.2 Statistical rules & thresholds

A finding is emitted only when it clears two independent gates: it must be statistically significant (p-value ≤ 0.05 after multiple-comparison correction) **and** large enough to matter in practice (either an absolute 20 pp delta, or a doubling of the background failure rate). Severity is then assigned based on how extreme the finding is. You can usually ignore this section — it explains why a particular pattern did or didn't produce a finding.

**Default thresholds:**

| Option | Default | Applies to |
|--------|---------|------------|
| `significanceLevel` | `0.05` | adjusted p-value threshold after per-family BH correction |
| `minimumEffectSize` | `0.20` | absolute proportion delta for yield/bin findings |
| `minimumRelativeEffect` | `1.0` | relative effect `\|delta / background\|` for yield/bin/cluster findings |
| minimum region size | auto | auto-scaled to ~1% of wafer die count (min 5); not user-configurable |

**Effect size gate for proportion findings (yield, hard bin, soft bin, cluster, edge-arc):**

A finding is kept when it passes the significance test AND satisfies at least one of:
- absolute `|delta| ≥ minimumEffectSize` (0.20 by default), **or**
- relative `|delta / background| ≥ minimumRelativeEffect` (1.0 by default)

The relative criterion catches meaningful signals on low-failure-rate wafers where the absolute delta is small but still represents a large deviation from background. For example, with a 3% background failure rate a 4 percentage-point increase is a 133% relative elevation — it clears `minimumRelativeEffect` even though 0.04 is well under the 0.20 absolute gate. Note the converse: a 2 percentage-point increase on the same background is only a 67% elevation, which clears *neither* gate and produces no finding. A zero background — a bin found in the region and nowhere else on the wafer — is the largest relative change there is and always clears the relative gate; the finding's `relativeDelta` is then `undefined`, since the ratio has no finite value, and significance still has to be met.

The gate's relative effect is always measured on the adverse outcome. For a pass rate — yield, a functional test's pass rate — that is the failure rate: a yield of 98% against 94% is failures of 2% against 6%, a tripling, and reaches the same verdict as the bin rate of the same dies. (`relativeDelta` on the finding itself stays the relative change in the pass rate.)

A region compared with the rest of the wafer looks deviant in the opposite direction whenever the rest contains a stronger deviation — an edge rich in a bin makes the inner rings look poor in it. So a finding opposite in direction to a stronger finding for the same variable and region family is re-tested against the rest of the wafer without that region (same test, same Benjamini–Hochberg multiplier, same gates) and dropped unless it still holds. This applies to rate findings and to test-value findings alike.

**Effect size gate for test-value findings:**

Test-value findings use Cohen's d (pooled standard deviation), not a proportion delta. Only `minimumEffectSize` applies (`|effectSize| ≥ 0.20`); `minimumRelativeEffect` is not used for these findings.

**Tests implemented:**

- Yield / bin proportions: two-proportion z-test (per-region vs. rest of wafer)
- Test-value comparisons: Welch-style t (z-approx) with pooled SD → Cohen's d effect size
- Contiguous cluster / edge-arc: one-sided binomial test (cluster failure rate vs. wafer-wide background)

**Multiple comparisons:** p-values are adjusted per variable-family using a Benjamini–Hochberg FDR procedure (grouping key: `variable.kind` + `comparison.family`). Only findings that pass both the adjusted p-value gate and the effect size gate are emitted.

**Severity mapping** (how the `severity` field is derived):

For proportion findings, severity uses whichever criterion — absolute or relative — is satisfied:

| Severity | p-value | Absolute delta | Relative delta |
|----------|---------|----------------|----------------|
| `unusual` | ≤ 0.01 | ≥ 0.30 | ≥ 2.5× background |
| `notable` | ≤ 0.05 | ≥ 0.20 | ≥ 1.5× background |
| `info` | any other passing finding | | |

For test-value findings (Cohen's d): `unusual` when d ≥ 0.5 at p ≤ 0.01; `notable` when d ≥ 0.15 at p ≤ 0.05.

**Cluster and edge-arc severity also considers cluster size** — a large contiguous cluster is visually dominant even when the rate contrast against an elevated background is modest. An additional size criterion applies on top of the rate/relative thresholds above:

| Severity | Cluster fraction of wafer |
|----------|--------------------------|
| `unusual` | ≥ 10 % of all eligible dies |
| `notable` | ≥ 3 % of all eligible dies |

Either the rate criterion or the size criterion can trigger the severity level; both require p ≤ 0.01 (`unusual`) or p ≤ 0.05 (`notable`).

**Behavioural notes:**

- Reticle-position analysis is enabled by default but only runs when a `reticleConfig` is present in the view.
- Test-value analysis is auto-skipped if the data contains more than 250 distinct tests unless `testNumbers` is provided. **The result is no test findings at all, not a trimmed set** — nothing throws, so an empty findings list is indistinguishable from "nothing to report" unless you check. A `WaferWarning` with code `'test-count-capped'` appears in `summary.stats.warnings[]` (§4.2.2), is shown by the renderers' warning indicator, and is also logged via `console.warn`.

### 7.4 `StatsSummary`

```ts
{
  level: 'wafer'
  hasNotableFindings: boolean          // true when any finding is 'notable' or 'unusual'
  findings: StatsFinding[]             // sorted by severity: 'unusual' first, then 'notable', then 'info'
                                       // findings[0] is always the highest-severity finding; no manual sort needed
  wafer?: Record<string, unknown>      // identity fields from waferConfig.metadata (lot, wafer ID, test date, etc.)
  // Note: this `stats` block is analysis metadata; StatsFinding also has its own
  // nested `stats` object (pValue, sampleSizeLeft, etc.) — two distinct sub-objects.
  stats: {
    totalDies:            number        // all dies on the wafer including partial and edge-excluded
    analyzedDies:         number        // dies included in analysis (excludes partial and, by default, edge dies)
    excludedDies:         number        // edge-excluded dies (see edgeDieYieldMode)
    yieldPercent:         number | null // (passDies / analyzedDies) × 100 ∈ [0, 100]
                                        // null when no die in the wafer has an hbin value at all
    testsConsidered:      number[]     // test numbers (keys from testValues) that had enough data
    hardBinsConsidered:   number[]
    softBinsConsidered:   number[]
    hardBinCounts?:  Record<number, number>  // die count per hard bin, over the yield-eligible population
                                              // (excludes partial/edge-excluded dies) — unlike hardBinsConsidered
                                              // above (which bin codes appear at all), these are the actual
                                              // counts a bin-breakdown display should show
    softBinCounts?:  Record<number, number>  // same, for soft bins
    warnings?:            WaferWarning[]  // structured advisories — §4.2.2. Same shape as
                                          // WaferMapResult.warnings, so a host has ONE warning
                                          // vocabulary. Branch on warning.code, e.g.
                                          // 'test-count-capped'. Was string[] before 0.22.0.
    isLotStack?:          boolean      // true when this summary was produced from lot-aggregated (lotStack) data
    aggregationMethod?:   string       // aggregation method used, e.g. 'mean', 'countBin' (present only when isLotStack is true)
    testSpecYield?: Array<{            // one entry per testDef that has at least one limit; absent when no testDefs with limits
      testNumber:   number
      label:        string            // testDef.name
      passDies:     number            // dies with value within [limitLow, limitHigh]
      failLowDies:  number            // dies with value < limitLow (0 when limitLow absent)
      failHighDies: number            // dies with value > limitHigh (0 when limitHigh absent)
      totalDies:    number            // dies that had a value for this test
      yieldPercent: number | null     // (passDies / totalDies) × 100 ∈ [0, 100]; null when totalDies = 0
    }>
    functionalYield?: Array<{         // one entry per functional (testType 'F') test — "functional yield" in fab terms;
                                      // verdicts read via getTestPassStatus (recorded testPass first, then the
                                      // legacy 0/1 testValues fallback); partial/edge-excluded dies excluded
      testNumber:      number
      label:           string         // testDef.name, starting "† " for a derived test
      derived?:        true           // computed from other tests (TestDef.derived) — see §4.1.9
      expression?:     string         // what it was computed from, verbatim
      passDies:        number
      failDies:        number
      totalDies:       number         // dies with a recorded verdict — never counts untested dies as fails
      passRatePercent: number | null  // (passDies / totalDies) × 100 ∈ [0, 100]; null when totalDies = 0
    }>
    perTestStats?: Array<{            // present only when computePerTestStats or enableTestValueAnalysis is set;
                                      // one entry per active test with enough data
      testNumber: number
      label:      string             // testDef.name, or "Test {N}" when no testDef
      count:      number             // number of dies with a value for this test
      min:        number
      max:        number
      mean:       number
      stddev:     number             // sample standard deviation
      median:     number             // 50th percentile (linear interpolation)
      q1:         number             // 25th percentile
      q3:         number             // 75th percentile
    }>
    capability?:     TestCapability[]   // Cp/Cpk/Pp/Ppk per parametric test, worst first; same gate and tests as
                                         // perTestStats. One wafer is one subgroup, so here Cp equals Pp (§7.4.1)
    testFlagYield?:  TestVerdictYield[] // per-test pass rate by the tester's recorded verdict (die.testPass),
                                         // parametric tests with verdicts; worst first (§7.4.1)
    specVerdictDisagreementDies?: number // dies where the spec-limit judgement and the recorded verdict disagree,
                                         // over tests that have both; absent when none has both, 0 = full agreement
    regionYield?:    RegionYieldFigures // yield by ring and by quadrant — the Summary panel's region yield (§7.4.1)
    spatialPattern?: PatternClassification // the pattern classifier's label, confidence and geometry features
                                         // (globalRdd, edgeRdd, centroidDistNorm, eccentricity, linearScore, …)
                                         // for every wafer it could measure — 'random' and 'none' included, which
                                         // raise no finding. Absent with no bin data or too few failing dies
                                         // (fewer than 5, or 0.3% of the wafer). See Pattern Detection
  }
}
```

#### 7.4.1 Capability, verdict pass rates and region yield

These are computed by the same code the Insights charts and Summary panel use, so an export and a chart never disagree.

```ts
// TestCapability
{
  testNumber: number
  label:      string
  unit?:      string
  hasSpec:    boolean        // both limits of one pair defined; when false lsl/usl are absent and every index is null
  lsl?:       number
  usl?:       number
  limitBasis?: 'spec' | 'test' // which pair lsl/usl are: specLow/specHigh when both are given, else limitLow/limitHigh
  mean:       number
  stdOverall: number         // sample stddev (ddof = 1) over every value
  stdWithin:  number         // pooled within-wafer sample stddev; NaN when no wafer contributed ≥ 2 values
  n:          number         // values counted
  cp:  number | null         // use stdWithin; null without a spec or when stdWithin is NaN or 0
  cpk: number | null
  pp:  number | null         // use stdOverall; null without a spec or when stdOverall is 0
  ppk: number | null
}

// TestVerdictYield — same shape as a functionalYield row
{ testNumber: number; label: string; passDies: number; failDies: number; totalDies: number; passRatePercent: number | null }

// RegionYieldFigures
{
  ring?:    RegionYield[]    // absent from a lot whose wafers were built with different ring counts
  quadrant: RegionYield[]
}
// RegionYield
{ key: string; label: string; yieldPercent: number; n: number; passDies: number }   // key is an identity ("ring:2") — do not parse it
```

- **Which pass/fail.** `testSpecYield` judges values against spec limits, `testFlagYield` reads the tester's own verdict, and `functionalYield` covers functional tests. The two parametric notions can legitimately disagree (guard bands, dynamic or per-site limits), which is why `specVerdictDisagreementDies` counts the difference rather than picking one.
- **Populations.** Partial and edge-excluded dies are excluded, as for yield; a die with no verdict is never a fail; region yield counts positioned dies with a bin, each judged by its own wafer's pass bins.
- **Lots.** On `LotStatsSummary.stats` (§7.5), pass rates are each wafer's counts summed per test and are **absent unless every wafer reported them**, since a rate pooled over part of a lot is not the lot's. Capability uses each wafer as a subgroup, so there `stdWithin` is the pooled within-wafer stddev and Cp and Pp differ.

### 7.5 `LotStatsSummary`

```ts
{
  level: 'lot'
  hasNotableFindings: boolean
  findings: StatsFinding[]             // lot-level findings (repeated patterns, inter-wafer outliers, and a yield or test-mean trend across the wafers); sorted unusual → notable → info
  lot?: Record<string, unknown>        // identity fields EVERY wafer with identity data agrees on (lot ID, product, etc. —
                                        // wafer-specific keys excluded). A key where wafers disagree (e.g. items pooled
                                        // from more than one lot/program) is omitted here, not silently taken from the
                                        // first wafer — see mixedIdentityFields below.
  mixedIdentityFields?: string[]       // identity keys where the pooled wafers do NOT all agree. Present only when at
                                        // least one such key exists — check this before treating `lot` as describing
                                        // the whole batch.
  stats: {
    waferCount: number
    capability?:      TestCapability[]     // each wafer a subgroup: stdWithin pooled across wafers; absent unless every wafer has it (§7.4.1)
    testSpecYield?:   StatsSummary['stats']['testSpecYield']    // counts summed per test; absent unless every wafer has it
    functionalYield?: StatsSummary['stats']['functionalYield']  // counts summed per test; absent unless every wafer has it
    testFlagYield?:   TestVerdictYield[]   // counts summed per test; absent unless every wafer has it
    specVerdictDisagreementDies?: number   // summed; absent unless every wafer has it
    regionYield?:     RegionYieldFigures   // ring and quadrant counts summed per region; absent unless every wafer has it
  }
  lotYieldSeries: Array<{
    waferIndex:   number
    yieldPercent: number | null        // (passDies / totalDies) × 100 ∈ [0, 100]; null when a wafer had no bin data
  }>
  perWafer: Array<{
    waferIndex: number
    summary: StatsSummary              // per-wafer findings
  }>
  perWaferTestStats?: Array<{          // present only when computePerTestStats or enableTestValueAnalysis is set
                                       // (prefer computePerTestStats — it skips the regional Welch pass)
    waferIndex: number
    tests: Array<{
      testNumber: number
      label:      string
      count:      number
      min:        number
      max:        number
      mean:       number
      stddev:     number
      median:     number
      q1:         number
      q3:         number
    }>
  }>
}
```

### 7.6 `renderWaferReportHtml` / `renderLotReportHtml`

```ts
import { renderWaferReportHtml, renderLotReportHtml } from '@wafertools/wafermap/stats';

renderWaferReportHtml(result: ReportMap, summary?: StatsSummary, options?: { title?: string }): string
renderLotReportHtml(results: ReportMap[], options?: { title?: string; analyzeOptions?: AnalyzeWaferMapOptions }): string
// ReportMap: a WaferMapResult (wafer, dies, passBins, ringCount, and optionally hbinDefs/sbinDefs/testDefs),
// plus optional label and statsSummary
```

The wafer and lot summary reports, as standalone printable HTML, from built maps — the way to produce a report without the UI: a nightly lot report, an archive of each wafer's report, an email. Neither needs the DOM, so both run in Node. The Summary panel's "Summary report" buttons use them and open the result in `openReportModal` (§9.2).

```ts
const results = files.map(parse).map(buildWaferMap);
fs.writeFileSync('lot-report.html', renderLotReportHtml(results));
```

They read each map's own `passBins` and `ringCount`, so a report cannot judge by bin 1 or draw four rings for a map built with six.

- **Wafer report.** Metadata, yield, bin breakdown, ring and quadrant yield, test value statistics (min/mean/median/stddev/max per test, labelled by `TestDef.name` or `Test {N}`), a **Process Capability** section (Cp/Cpk/Pp/Ppk for every test with both limits of a pair — omitted when none qualify), and the findings table. `renderWaferReportHtml` runs `analyzeWaferMap` when no `summary` is given.
- **Lot report.** The lot equivalent: lot overview, per-wafer yield table, bin breakdown, ring and quadrant yield, test statistics across the lot, Process Capability, a **Splits** section (one row per wafer with a `metadata.split` — omitted when none has one), and the findings table. It merges bin and test definitions across the maps and reuses any `statsSummary` a map carries.
- **Findings.** Both render the same findings table. Findings another finding absorbs as an exact restatement (§7.8, `absorbedIds`) are left out, as in the Summary panel.

**Lot grouping.** `renderLotReportHtml` never pools wafers that should not be averaged together. The maps are partitioned by whichever of `lot`/`product`/`testProgram`/`temperature` actually vary across their `wafer.metadata` (a `split` difference alone never splits the report — comparing splits within one report is what that field is for). One population produces one report titled for its lot; several produce side-by-side sections under a banner explaining the split. The on-screen lot Summary panel can legitimately show different numbers for such a load: it displays the host's own `lotStatsSummary` as one pooled view, while the report applies the split.

`StatsSummary` → §7.4 · `AnalyzeWaferMapOptions` → §7.3

### 7.7 `setReportOpener`

```ts
import { setReportOpener } from '@wafertools/wafermap/stats';

setReportOpener(opener: (html: string) => void): void
```

Reports open in wmap's own modal (`openReportModal`, §9.2) with no wiring, in a plain browser tab or an embedded host (Tauri, Electron, WebView2) alike. The modal's "Open as full page ↗" link opens the report as a separate page, through `window.open` by default. In a host where `window.open` is blocked, register an opener at startup so that link produces a real window or page instead of a console warning:

```ts
setReportOpener(html => {
  // e.g. write to a host-managed window, invoke an IPC call, etc.
  myApp.showReport(html);
});
```

A host whose opener saves or logs a report and still wants to show it can call `openReportModal(html)` itself.

### 7.8 `StatsFinding`

```ts
{
  id:       string          // stable identifier for this finding
  level:    'wafer' | 'lot' | 'inter-wafer'
  severity: 'unusual' | 'notable' | 'info'
            // ranking (highest → lowest): unusual > notable > info
  variable: {
    kind:   'yield' | 'hardBin' | 'softBin' | 'test' | 'functionalTest' | 'spatialPattern'
    index?: number          // test number — the key from testValues (for 'test' kind)
    bin?:   number          // bin value (for 'hardBin'/'softBin' kind)
    label:  string          // human-readable name; starts "† " for a derived test, as does its name in `summary`
    unit?:  string
    derived?:    true       // the finding is about a derived test (TestDef.derived) — the structured form of the †
    expression?: string     // what that test was computed from, verbatim
  }
  comparison: {
    family: 'ring' | 'quadrant' | 'reticle-position' | 'test-site' | 'wafer'
          | 'sector' | 'cluster' | 'edge-arc' | 'spatial-pattern'
    left:   string          // e.g. "Ring 3 (edge)", "NE", "Rings 1–3", "Reticle cell (1, 0)"
                            // adjacent same-signal regions are merged into one finding (e.g. "Rings 1–3")
    right:  string          // typically "Rest of wafer", or for a yield outlier "Lot median"
                            // (every wafer records one lot) / "Median of all wafers" (otherwise)
  }
  effect: {
    direction:      'higher' | 'lower' | 'different'
    absoluteDelta?: number
    relativeDelta?: number
    effectSize?:    number
  }
  stats: {                   // per-finding test statistics (distinct from StatsSummary.stats)
    method:            string
    pValue?:           number
    adjustedPValue?:   number
    sampleSizeLeft:    number   // dies in the region (left side of comparison)
    sampleSizeRight:   number   // dies in the rest of the wafer (right side)
  }
  summary:   string         // one-sentence human-readable description — a plain string, not an object
                            // e.g. "Ring 4 (edge) yield is 18.3 pp lower than the rest of the wafer"
  highlight: HighlightTarget
  relatedIds?: string[]     // ids of findings this one summarises at a finer level:
                            // a spatial-pattern's supporting regional findings, or the per-region
                            // findings collapsed into a merged band ("Rings 1–3"). Audit/drill-down.
                            // NOTE: these do not all resolve to entries in `findings` — a merged
                            // band names the constituents it REPLACED, and those are gone.
  absorbedIds?: string[]    // ids of findings that state exactly the same fact as this one, hidden
                            // from the Summary panel and the findings report in favour of it.
                            // Unlike relatedIds, everything here IS still in `findings`.
                            // Two cases: a soft-bin finding whose hard-bin twin covers provably the
                            // same dies (merged label reads "Hard and soft bin 3 (same dies)"), and
                            // the single pass bin's row against the yield row restating it.
                            // Merging is on die-set identity, never bin number — hard and soft bins
                            // are independent number spaces.
}
```

### 7.9 `HighlightTarget`

Describes what to visually emphasise when a finding is selected.

```ts
type HighlightTarget =
  | { kind: 'region';  regionFamily: 'ring' | 'quadrant' | 'reticle-position' | 'test-site' | 'sector';
                        regionKeys: string[]; dieKeys?: string[] }
  | { kind: 'bin';     bin: number; regionKeys?: string[]; dieKeys?: string[] }
  | { kind: 'wafer';   waferIndices: number[]; dieKeysByWafer?: Record<number, string[]> }  // a lot regional finding names each counted wafer's region dies
  | { kind: 'dies';    dieKeys: string[] }
```

`dieKeys` entries use the `"x,y"` format returned by `getDieKey`.

**Highlight kind by finding family:**

| `comparison.family`  | `highlight.kind` | Notes |
|----------------------|------------------|-------|
| `ring`               | `region`         | `regionFamily: 'ring'` |
| `quadrant`           | `region`         | `regionFamily: 'quadrant'` |
| `reticle-position`   | `region`         | `regionFamily: 'reticle-position'` |
| `sector`             | `region`         | `regionFamily: 'sector'` |
| `cluster`            | `dies`           | exact failing die keys |
| `edge-arc`           | `dies`           | exact failing die keys |
| `wafer`              | `wafer`          | lot-level only |

### 7.10 Integrating with `renderWaferMap`

```ts
import { buildWaferMap } from '@wafertools/wafermap';
import { renderWaferMap } from '@wafertools/wafermap/render';
import { analyzeWaferMap, analyzeWaferLot } from '@wafertools/wafermap/stats';

// Single wafer with summary panel toggle:
const result  = buildWaferMap({ results, waferConfig, dieConfig, passBins: [1] });
const summary = analyzeWaferMap(result);
renderWaferMap(container, result, { statsSummary: summary });

// Lot gallery with lot-level summary panel toggle:
const waferResults = waferDataSets.map(d => buildWaferMap(d));
const items = waferResults.map((r, i) => ({
  ...r,
  label:        `Wafer ${i + 1}`,
  statsSummary: analyzeWaferMap(r),
}));
const lotSummary = analyzeWaferLot(waferResults);
renderWaferGallery(container, items, { lotStatsSummary: lotSummary });
```

### 7.11 `filterFindings(source, filter)`

```ts
filterFindings(source: StatsSummary | LotStatsSummary, filter: FindingsFilter): StatsFinding[]
```

Filters findings from a `StatsSummary` or `LotStatsSummary` by any combination of severity, kind, family, and level. All criteria are ANDed; each accepts a single value or an array.

Operates on the **complete** findings list and deliberately does not apply the display de-duplication: a filter on `kind: 'softBin'` returns every soft-bin finding, including ones a hard-bin twin absorbed for display. If you are building a list for a human to read rather than querying, exclude `absorbedIds` as well — see [§7.8](#78-statsfinding) and the [Developer Guide](../guide/findings.md#de-duplicating-for-display).

`StatsSummary` → §7.4 · `LotStatsSummary` → §7.5 · `StatsFinding` → §7.8

```ts
import { filterFindings } from '@wafertools/wafermap/stats';

// Unusual ring or quadrant findings only:
const critical = filterFindings(summary, {
  severity: 'unusual',
  family: ['ring', 'quadrant'],
});

// All yield findings across the lot:
const yieldFindings = filterFindings(lotSummary, { kind: 'yield' });
```

```ts
interface FindingsFilter {
  severity?: StatsSeverity | StatsSeverity[]
  kind?:     StatsVariableKind | StatsVariableKind[]
  family?:   StatsComparisonFamily | StatsComparisonFamily[]
  level?:    StatsLevel | StatsLevel[]
}
```

#### `visibleFindings(findings)`

```ts
visibleFindings<T extends { id: string; absorbedIds?: string[] }>(findings: T[]): T[]
```

Drops findings that another finding has claimed as an exact restatement of itself — a
soft-bin twin covering the same dies, or the single pass bin's row against the yield row
that says the same thing. The claimer's own label already names what it absorbed ("hard bin
and soft bin 3 (same dies)"), so listing both prints one fact twice, once merged and once
not.

Apply it to anything that *renders* a findings list. `StatsSummary.findings` deliberately
keeps the full uncollapsed set, so a host that wants every row can still have it; this is
the filter the built-in surfaces put in front of it.

```ts
import { visibleFindings } from '@wafertools/wafermap/stats';

for (const f of visibleFindings(summary.findings)) { /* … */ }
```

Composes with `filterFindings` in either order — the two are independent, one dropping
absorbed restatements and the other narrowing by severity/kind/family/level.

### 7.12 Spatial pattern classification — `stats.spatialPattern`

`analyzeWaferMap` classifies the spatial failure pattern of every wafer and returns it as `stats.spatialPattern` (§7.4), with the geometry features it was judged on. A detected pattern is also reported as a finding (`comparison.family === 'spatial-pattern'`). `spatialPattern` is absent when too few dies fail to classify (auto-scaled, minimum 5).

```ts
const summary = analyzeWaferMap(result);
const c = summary.stats.spatialPattern;
if (c) {
  console.log(c.pattern);     // 'edge-ring' | 'center' | 'scratch' | ...
  console.log(c.confidence);  // 'high' | 'medium' | 'low'
  console.log(c.note);        // advisory string when classification may be imprecise
  console.log(c.features);    // raw geometry numbers — usable as input to your own classifier
}
```

**`PatternClassification`**

```ts
interface PatternClassification {
  pattern:    PatternLabel           // detected pattern
  confidence: 'high' | 'medium' | 'low'
  features:   PatternFeatures        // raw geometry numbers
  note?:      string                 // advisory when classification may be imprecise
}

type PatternLabel =
  | 'center' | 'donut' | 'edge-ring' | 'edge-local'
  | 'scratch' | 'near-full' | 'random' | 'none'
```

**`PatternFeatures`**

```ts
interface PatternFeatures {
  globalRdd:         number  // failing / total eligible dies
  edgeRdd:           number  // failing in outermost ring / total outermost-ring dies
  centroidDistNorm:  number  // distance from wafer centre to salient-region centroid, / radius
  minDistNorm:       number  // min radial distance of salient-region dies, / radius
  maxDistNorm:       number  // max radial distance of salient-region dies, / radius
  p25DistNorm:       number  // 25th-percentile radial distance of all failing dies, / radius
  eccentricity:      number  // 0 = circle, 1 = line (from covariance of top-5 components)
  linearScore:       number  // fraction of top-5 component dies on the best row/col/diagonal
  salienceSize:      number  // die count of the largest connected component
  salienceFraction:  number  // salienceSize / total failing dies
  edgeAngularSpread: number  // fraction of 16 circumference sectors covered by edge-zone fails
  innerOuterRatio:   number  // fail rate inner half / fail rate outer half
}
```

See [Pattern Detection](../pattern-detection.md) for benchmark accuracy figures and known limitations.

### 7.13 Metadata facets and test-definition merging

```ts
import { buildFacetTable, facetValueOf, attributeLabel, FACET_NONE_VALUE, mergeTestDefs } from '@wafertools/wafermap/stats';
```

| Function | Returns | Notes |
| --- | --- | --- |
| `buildFacetTable(items, options?)` | `FacetField[]` | The distinct-values table over `wafer.metadata` — the *wafer attributes* a chart can group wafers by ("what can I group by?") One entry per metadata key present on at least one item, curated by default (`lot`, `product`, `testProgram`, `temperature`, `split`, `operator`, `testDate`; `waferId` is curated `facet: false` — present but not offered, since it's unique per item by definition), with `options.curation` layered over the defaults. `options.facetableOnly` (default `true`) restricts to curated-`facet:true`-or-uncurated keys; pass `false` to include `waferId` too. |
| `attributeLabel(key, curation?)` | `string` | A wafer attribute's name: the host's `attributes` entry, else the default, else the key spelled out. The one name Group by, the plot fields, the Wafers table, the header strip and reports give it. |
| `facetValueOf(metadata, key, curation?)` | `string \| undefined` | The faceting value of one metadata key for one item — date-curated fields (`testDate`) truncate to date-only. |
| `mergeTestDefs(items)` | `{ defs, conflicts, warnings }` | The ONE test list for a population of wafers. `TestDef.testNumber` identifies a test *within a test program*, so taking any single wafer's `testDefs` as the namespace for a multi-program load pools unrelated measurements under one number and normalises them against the wrong limits. This unions every test number across `items` and reconciles the defs describing each. **An absent field is "not stated", never a disagreement** — mixing a file that states limits with one that does not merges silently, the stated value winning. Only two *stated and different* values conflict, in two tiers. **Hard** (distinct names, distinct units, or `testType` `'P'` vs `'F'`): different measurements sharing a number, so the test is withheld from `defs` entirely — `warnings` carries code `test-def-collision`, severity `error`. **Soft** (same name and unit, both limits stated but different): the same measurement under different specs, so the test stays and its values still pool, but the merged def drops **both** limits — no Cp/Cpk/Pp/Ppk, no spec yield, no limit lines — with code `test-limit-conflict`, severity `warning`. Limits compare on a relative tolerance, not `===`, so a float32 STDF limit and a float64 CSV one cannot manufacture a conflict; names compare trimmed and case-insensitively. Hand `warnings` straight to `collectWarnings` (§5.10) to surface both through the toolbar indicator and Summary banner. `renderWaferGallery` and the Insights tab call this internally — hosts need it only when building their own cross-wafer surface. |

`FACET_NONE_VALUE` (`'(none)'`) is the residual bucket: `buildFacetTable` emits it as a
`FacetValue.value` for items whose metadata has no value for that field, so the counts
still add up to the full population instead of silently dropping the gap. It always
sorts last regardless of size. **Compare against the constant, not the literal string** —
and treat it as "field missing", not as a real metadata value, when labelling anything a
user reads. A wafer genuinely carrying the string `"(none)"` is indistinguishable from a
missing one, which is the one case where this bucket is ambiguous.

`WaferMetadata` → §11.3

---

### 7.14 `readPlotsFile` / `writePlotsFile`

The saved recipes behind the Insights **Plot** tab, and the file they travel in. Pure and DOM-free, so a host can keep
a user's plots in any store and a Node tool can read the same file.

```ts
readPlotsFile(text: string): { plots: PlotSpec[]; warnings: string[]; error?: string }
writePlotsFile(plots: readonly PlotSpec[]): string        // { "format": "wafermap-plots", "version": 1, "plots": [...] }
```

`readPlotsFile` accepts the wrapped file or a bare array. It keeps every plot it can read and names each setting it
dropped; `error` is set only for text that is not JSON, is not a plots file, or holds no usable plot. Unknown settings
survive a read and a write. The shape of `PlotSpec`, what a plot guarantees, and how the host stores the list are in
[Render → Insights → The Plot tab](render-map.md#the-plot-tab-saved-plots).
