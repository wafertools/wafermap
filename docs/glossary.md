# Glossary

**For:** both audiences — developers without a semiconductor background, and app users who meet an unfamiliar term on screen.

Quick-reference definitions for semiconductor and library terms used in `@wafertools/wafermap`. The *Library mapping* notes on each entry are developer-facing; app users can ignore them.

---

### Wafer

A circular silicon substrate, typically 200 mm or 300 mm in diameter, on which hundreds or thousands of identical chips are fabricated simultaneously. The library models a wafer as a circle with a defined diameter, edge exclusion zone, and orientation mark. *Library mapping: `WaferConfig` (`buildWaferMap` input).*

### Die

A single chip instance on the wafer, identified by its integer grid position (`x`, `y`). Each die is the atomic unit of test data — it carries a bin result, optional parametric test values, and probe metadata. *Library mapping: `DieResult` (input), `Die` (output).*

### Hard bin (hbin)

The physical sort category assigned by the handler after testing — it determines which physical bin tray a part is dropped into. Hard bins are the coarsest classification and are what final yield and disposition decisions are based on. *Library mapping: `DieResult.hbin`.*

### Soft bin (sbin)

The logical classification assigned by the test program, representing the specific failure mode detected (e.g. "leakage too high", "continuity fail"). Many soft bins typically roll up into one hard bin. Soft bins are useful for failure analysis; hard bins drive physical handling. *Library mapping: `DieResult.sbin`.*

### Pass bin / passBins

The bin number(s) considered a passing result for yield calculation. The library defaults to `[1]` (hard bin 1 = pass), but this must match your actual test program — some programs use a different bin for pass, or multiple passing bins. Setting this incorrectly will produce wrong yield numbers. *Library mapping: `WaferMapInput.passBins`.*

### Yield

The fraction of tested dies that pass, expressed as a percentage. By default the library divides passing dies by the dies that count toward yield — edge-excluded and partial dies are left out of both numerator and denominator. *Library mapping: `YieldSummary.yieldPercent`; see also gross die yield.*

### Edge exclusion

A ring of dies around the wafer perimeter that are excluded from yield calculations. Dies near the edge are mechanically stressed during handling and may be partially outside the lithography field, making their results unreliable for lot disposition. The exclusion width is specified in millimetres. *Library mapping: `WaferConfig.edgeExclusion`.*

### Notch / flat

The orientation mark cut into the wafer edge so that handlers, probers, and inspection tools can align the wafer consistently. A notch is a small V-shaped cut; a flat is a longer straight edge (older convention). The library uses this to orient the wafer map correctly on screen. *Library mapping: `WaferConfig.notch`, `WaferNotch`.*

### Prober

The machine that moves the wafer under a probe card and makes electrical contact with each die in sequence to run the test program. The prober's controller outputs step coordinates for each die contact — these are what you supply as `x`/`y` in your die data. *See also: prober step coordinates.*

### Prober step coordinates

The integer grid positions output by the prober controller, one per die contact. These are dimensionless step counts, not millimetres. The library accepts them directly and internally converts to physical geometry for rendering — you do not need to pre-convert to mm. *Library mapping: `DieResult.x`, `DieResult.y`.*

### Test value

A continuous numeric measurement recorded for one die on one parametric test — for example, threshold voltage, leakage current, or ring oscillator frequency. Test values are stored keyed by test number so a die can carry results from many tests simultaneously. *Library mapping: `DieResult.testValues: { [testNumber]: number }`.*

### TestDef

Metadata describing one parametric test: a stable integer ID (`testNumber`), a human-readable name, an SI unit string, and optional test and spec limits. `TestDef` entries drive tooltip labels, the plot-mode dropdown, and limit colouring in the rendered map. *Library mapping: `TestDef`, `WaferMapInput.testDefs`.*

### Test limit

The range a parametric test value must fall in to pass (`limitLow`, `limitHigh` — STDF's LO_LIMIT and HI_LIMIT, labelled Lo limit and Hi limit on charts). A value exactly on a limit passes unless the test says otherwise (`limitLowInclusive`/`limitHighInclusive: false`, which STDF and ATDF files state per test). In `value` plot mode a die outside the test limits keeps its colour on the value gradient and is marked with a triangle: ▽ below `limitLow`, △ above `limitHigh`. Switch to solid pass/fail colours — green pass, blue below, red above — with `passFailDisplay: 'spec'` in `WaferViewOptions`, or "Limit pass/fail" in the toolbar. *Library mapping: `TestDef.limitLow`, `TestDef.limitHigh`, `WaferViewOptions.passFailDisplay`.*

### Spec limit

The product specification for a parametric test (`specLow`, `specHigh` — STDF's LO_SPEC and HI_SPEC, labelled LSL and USL). Test limits are often set inside the spec limits as a guard band. Process capability (Cp/Cpk/Pp/Ppk) is measured against the spec limits when a test has both, and against its test limits otherwise; the chart and report say which. *Library mapping: `TestDef.specLow`, `TestDef.specHigh`, `TestCapability.limitBasis`.*

### Functional test

A test with no measured value — only a recorded pass/fail outcome (a continuity check, boundary scan, or any other go/no-go test). Set `testType: 'F'` on the test's `TestDef` (default `'P'`, parametric) and record the outcome per die in `testPass`, keyed by `testNumber` like `testValues`. Selecting a functional test as the active test always displays as **Test pass/fail** — there is no value to put on a gradient. Functional tests are excluded from every parametric statistic (per-test stats, capability, correlation, distribution charts) and instead get pass-rate analysis: `stats.functionalYield`, a "Functional Tests" summary-panel table, and regional pass-rate findings. *Library mapping: `TestDef.testType`, `DieResult.testPass`, `getTestPassStatus()`.*

### Pass/fail display

The solid, categorical colouring shown in `value` plot mode in place of the continuous gradient — set via `WaferViewOptions.passFailDisplay`. `'spec'` judges dies against the active test's spec limits (green pass / blue fail-low / red fail-high). `'test'` colours dies by the tester's own **recorded** verdict (`DieResult.testPass`) instead — green pass / red fail, undirected — and is what a functional test (no measured value) always renders as, regardless of the requested display. *Library mapping: `WaferViewOptions.passFailDisplay`.*

### Process capability (Cp / Cpk / Pp / Ppk)

A statistical measure of how well a parametric test's values fit within its spec limits — the Insights tab's Distributions sub-tab plots one box per test, normalised so `limitLow = 0` and `limitHigh = 1` where both limits are defined, worst `Ppk` first. `Cp`/`Cpk` ("potential"/short-term capability) use the pooled *within-wafer* standard deviation, treating each wafer as the natural short-term subgroup; `Cp` ignores how centered the distribution is, `Cpk` penalizes an off-center mean. `Pp`/`Ppk` ("performance"/long-term capability) use the plain standard deviation across every die instead. Higher is better; ≥1.33 is a common (but process-specific) threshold for "capable." `Cp`/`Cpk` are omitted when no wafer contributes at least two values (no within-subgroup variance is computable). Tests missing one or both spec limits are not omitted from the chart — they still appear (muted, dashed, no capability indices), normalized onto their own observed range instead, and sorted after spec'd tests by most-variable-first, since a lot with sparse spec coverage would otherwise render an all-but-empty chart. *Library mapping: `StatsSummary.stats.capability` and `LotStatsSummary.stats.capability` (`TestCapability`), from `analyzeWaferMap`/`analyzeWaferLot` with `computePerTestStats`.*

### Reticle

The rectangular exposure field used in photolithography, typically containing a fixed grid of die sites. One reticle field is stepped across the wafer repeatedly to pattern the full surface. The library can overlay the reticle grid and attribute findings to specific reticle positions, which is useful for identifying systematic defects tied to a particular mask location. *Library mapping: `WaferMapInput.reticleConfig`, `ReticleConfig`.*

### Validity limit

The range a real measurement of a test lies in (`validLow`, `validHigh`; tsmap's `lvl`/`uvl`). A tester that runs out of range records its rail, such as a current held at the compliance clamp or an open-circuit value, and that number is not a reading. Validity limits are a third kind beside the test and specification limits: those judge good against bad, these judge a reading against a clamp, and a clamped value is neither. *Library mapping: `TestDef.validLow`, `TestDef.validHigh`.*

### Excluded value

A test value that lies outside the limit set the value filter uses (the validity limits by default). It is treated as missing for that test on that die, in the map, the statistics and every chart, and it is counted wherever a population is shown. Bins and each die's recorded pass/fail are the tester's own and are unchanged. *Library mapping: `WaferMapInput.valueFilter`, `WaferMapResult.valueFilter`, `CapabilityDatum.excluded`.*

### Reticle cell

A die's position *inside* the reticle: which of the field's dies it is, such as column 1, row 3 of a 4 × 3 field. The same cell recurs in every shot across the wafer, so a cell that is bad everywhere points at the mask or lens rather than at the wafer. Shown as `Reticle cell (1, 3)` and available once a reticle is set. *Library mapping: `getReticleCell`, `DIE_REGIONS.reticleCell`.*

### Reticle shot

*Where on the wafer* the reticle was placed for a die: one exposure of the mask, numbered by its column and row among the exposures (the one containing the anchor die is `(0, 0)`). Each shot is a different place on the wafer, so a shot that is bad points at something that varies across the wafer, such as focus, tilt or the edge. Not to be confused with the reticle cell, which is a position inside the mask. Shown as `Reticle shot (-1, 2)`. *Library mapping: `getReticleShot`, `DIE_REGIONS.reticleShot`.*

### Lot

A batch of wafers processed together through the fabrication line, typically 25 wafers. All wafers in a lot share the same process conditions and are usually tested together. The library's lot stack feature lets you combine multiple wafers from a lot into a single aggregated map. *Library mapping: `WaferMapInput.lotStack`, `LotStackConfig`.*

In API names — `analyzeWaferLot`, `LotStatsSummary`, `lotStack`, `level: 'lot'` — "lot" means
*a set of several wafers*, which may span more than one physical lot or record no lot ID at all.
What the user sees is stricter: a panel, report or finding says "lot" only when every wafer
records the same lot ID ("Lot LOT123 · 13 wafers", "lot median"); otherwise it names the wafers
("26 wafers from 2 lots", "median of all wafers").

### Wafer attribute

A fact about a whole wafer that came with the data or was assigned afterwards: its lot, product, test program, temperature, operator, test date, slot, or a label such as a process **split**. A wafer attribute separates *wafers*; it is what **Group by** pools them on. A split (TT, FF, SS…) is one wafer attribute, not a separate mechanism. *Library mapping: `WaferMetadata`, the `attributes` render option, `attributeLabel`.*

### Die region

A category a die falls into from where it sits, calculated rather than recorded: its ring, quadrant, reticle cell or reticle shot. A die belongs to every one of them at once, which is why a region separates the *dies* of a chart (**Compare by**) and is never a **Group by** choice. *Library mapping: `DIE_REGIONS`, `availableRegions`.*

### Verdict

The outcome of a go/no-go: a functional test's pass or fail, or a derived test that gives a yes/no. A verdict has no value to plot, so the plot builder offers it as a category (**Verdicts**, shown as `Scan Chain (pass/fail)`) to colour or compare by. *Library mapping: `getTestPassStatus`, `DieResult.testPass`.*

### Group by

Pools whole *wafers* by a wafer attribute (lot, split, temperature) for every chart on the Insights tab, so each chart draws one group per value. It takes wafer attributes only. To separate the dies within each wafer, use **Compare by**.

### Compare by

What a single plot separates its marks by: its **Colour**, and on a bar or box its **Categories**. It takes a wafer attribute or a die region, a bin, a site or a verdict. Where **Group by** pools wafers for the whole tab, Compare by acts on one plot.

### Lot stack

An aggregated wafer map computed from multiple individual wafers, showing a per-die statistic across the lot (mean, median, bin count, etc.). Lot stacking reveals systematic spatial patterns — for example, a recurring hot spot at the same reticle position across all wafers — that would not be visible on any single wafer. *Library mapping: `LotStackConfig`, `WaferViewOptions.plotMode: 'stackedValues' | 'stackedBins' | 'stackedSoftBins'`.*

### Retest / retest policy

Some probers contact a die more than once, either due to contact failures (a retry) or deliberate multi-touch sequences. The retest policy controls which result the library keeps when a die has multiple records: `'last'` (default, keeps the final probe), `'first'` (keeps the earliest probe), `'best'` (keeps the passing result or the best bin), or `'worst'`. *Library mapping: `WaferMapInput.retestPolicy`, `Die.retestCount`.*

### STDF

Standard Test Data Format — the binary file format output by most ATE systems after a wafer test run. STDF encodes die bin results, parametric test values, and lot/wafer metadata in a compact binary record structure. The library does not parse STDF itself: map the records to `DieResult` rows yourself (die position, bins and test results), or open the file in [tsmap](https://github.com/wafertools/tsmap), which reads STDF and ATDF directly.

### ATE

Automatic Test Equipment — the tester (e.g. Teradyne, Advantest) that executes the test program and records pass/fail and parametric results for each die. The ATE produces the STDF file and drives the prober. It is the upstream source of all data the library visualises.

### Gross die yield

Yield with edge-excluded dies counted in the denominator but never as passes, so edge losses show up in the figure instead of being excluded from it — the usual way to quantify yield lost to edge effects. The library reports it alongside ordinary yield when `edgeDieYieldMode: 'denominator-only'` is set. *Library mapping: `YieldSummary.yieldPercentGross`, `WaferMapInput.edgeDieYieldMode`.*

### Gross die per wafer

The number of complete die sites that fit on a wafer — the ceiling on how many dies a wafer can yield, and the denominator in many cost-per-die estimates. A die straddling the edge is not counted. *Library mapping: `buildWaferMap({ layout: true, waferConfig, dieConfig }).dies.length`.*

---

*See also: [guide.md](guide.md) for worked examples, [api.md](api.md) for full type and option reference.*
