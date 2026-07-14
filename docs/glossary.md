# Glossary

Quick-reference definitions for semiconductor and library terms used in `@paulrobins/wafermap`. Aimed at software engineers without a semiconductor background.

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

The fraction of tested dies that pass, expressed as a percentage. The library computes gross die yield: passing dies divided by total testable dies, where "testable" excludes any dies removed by edge exclusion. *Library mapping: `YieldSummary.yieldPercent`.*

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

Metadata describing one parametric test: a stable integer ID (`testNumber`), a human-readable name, an SI unit string, and optional spec limits. `TestDef` entries drive tooltip labels, the plot-mode dropdown, and spec-limit colouring in the rendered map. *Library mapping: `TestDef`, `WaferMapInput.testDefs`.*

### Spec limit

The acceptable range for a parametric test value (`limitLow`, `limitHigh`). Dies whose test value falls outside the spec limits are coloured blue (below `limitLow`) or red (above `limitHigh`) in `value` plot mode. Enable pass/fail colouring by setting `colorBySpec: true` in `WaferViewOptions`, or toggling "Spec pass/fail" in the Overlays toolbar menu. *Library mapping: `TestDef.limitLow`, `TestDef.limitHigh`, `WaferViewOptions.colorBySpec`.*

### Process capability (Cp / Cpk / Pp / Ppk)

A statistical measure of how well a parametric test's values fit within its spec limits — the Insights tab's Distributions sub-tab plots one box per test with both spec limits defined, normalized so `limitLow = 0` and `limitHigh = 1`, worst `Ppk` first. `Cp`/`Cpk` ("potential"/short-term capability) use the pooled *within-wafer* standard deviation, treating each wafer as the natural short-term subgroup; `Cp` ignores how centered the distribution is, `Cpk` penalizes an off-center mean. `Pp`/`Ppk` ("performance"/long-term capability) use the plain standard deviation across every die instead. Higher is better; ≥1.33 is a common (but process-specific) threshold for "capable." `Cp`/`Cpk` are omitted when no wafer contributes at least two values (no within-subgroup variance is computable). Tests missing one or both spec limits are not omitted from the chart — they still appear (muted, dashed, no capability indices), normalized onto their own observed range instead, and sorted after spec'd tests by most-variable-first, since a lot with sparse spec coverage would otherwise render an all-but-empty chart. *Library mapping: `CapabilityDatum.hasSpec` (`@paulrobins/wafermap/stats`).*

### Reticle

The rectangular exposure field used in photolithography, typically containing a fixed grid of die sites. One reticle field is stepped across the wafer repeatedly to pattern the full surface. The library can overlay the reticle grid and attribute findings to specific reticle positions, which is useful for identifying systematic defects tied to a particular mask location. *Library mapping: `WaferMapInput.reticleConfig`, `ReticleConfig`.*

### Lot

A batch of wafers processed together through the fabrication line, typically 25 wafers. All wafers in a lot share the same process conditions and are usually tested together. The library's lot stack feature lets you combine multiple wafers from a lot into a single aggregated map. *Library mapping: `WaferMapInput.lotStack`, `LotStackConfig`.*

### Lot stack

An aggregated wafer map computed from multiple individual wafers, showing a per-die statistic across the lot (mean, median, bin count, etc.). Lot stacking reveals systematic spatial patterns — for example, a recurring hot spot at the same reticle position across all wafers — that would not be visible on any single wafer. *Library mapping: `LotStackConfig`, `WaferViewOptions.plotMode: 'stackedValues' | 'stackedBins' | 'stackedSoftBins'`.*

### Retest / retest policy

Some probers contact a die more than once, either due to contact failures (a retry) or deliberate multi-touch sequences. The retest policy controls which result the library keeps when a die has multiple records: `'last'` (default, keeps the final probe), `'first'` (keeps the earliest probe), `'best'` (keeps the passing result or the best bin), or `'worst'`. *Library mapping: `WaferMapInput.retestPolicy`, `Die.retestCount`.*

### STDF

Standard Test Data Format — the binary file format output by most ATE systems after a wafer test run. STDF encodes die bin results, parametric test values, and lot/wafer metadata in a compact binary record structure. The library does not parse STDF directly; see `guide.md` for how to extract and map STDF data to `DieResult` records.

### ATE

Automatic Test Equipment — the tester (e.g. Teradyne, Advantest) that executes the test program and records pass/fail and parametric results for each die. The ATE produces the STDF file and drives the prober. It is the upstream source of all data the library visualises.

### Gross die yield

Yield expressed as passing dies divided by the total number of testable dies, where testable excludes edge-excluded dies. "Gross" means no credit is taken for known-bad dies from prior inspections — it is the raw electrical yield from the test floor. The library reports gross die yield; the denominator is clearly documented in the stats output so engineers are not misled by edge-exclusion effects. *Library mapping: `YieldSummary.yieldPercent`, `YieldSummary.edgeExcludedDies`.*

---

*See also: [guide.md](guide.md) for worked examples, [api.md](api.md) for full type and option reference.*
