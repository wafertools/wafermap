# Spatial Detection Analysis

**For:** engineers and developers deciding how much to trust the automatic detections. This is a validation report — benchmark method, detection rates, false-positive characterisation — not a how-to; for usage see [Pattern Detection](pattern-detection.md).

This page documents the investigation into the combined detection capability of
the library's two spatial analysis systems, the false positive characterisation,
and the design decisions that resulted from it.

---

## The two detection systems

**Spatial pattern classifier** (`classifyPattern`, called by `analyzeWaferMap`
when `enablePatternClassification` is true) uses pure geometry — connected
components, radial distance distributions, eccentricity, and linear scores —
to label the whole-wafer failure signature as edge-ring, center, scratch, etc.
It is rule-based with no trained model.

**Statistical regional analysis** (ring, quadrant, sector, cluster, edge-arc
findings) compares specific zones of the wafer against the rest using
significance tests. It runs independently of the classifier and produces its
own findings.

Both systems run together when you call `analyzeWaferMap`. When the classifier
identifies a pattern, correlated regional findings (e.g. the ring finding that
supports an edge-ring classification) are downgraded to `info` severity to
avoid visual redundancy — the classifier finding is the headline, the regional
findings are supporting evidence.

---

## Benchmark dataset

All benchmarks were run against **WM-811K** — 25,519 labelled wafers from TSMC
300mm fabrication (Wu et al., *IEEE Transactions on Semiconductor Manufacturing*,
2015). This is the standard public dataset for wafer map pattern classification.

Scripts are in `scripts/`:

| Script | Purpose |
|---|---|
| `run-benchmark-npz.mjs` | Classifier-only per-class recall/precision |
| `run-benchmark-combined.mjs` | Combined classifier + regional detection rates |
| `run-benchmark-fp.mjs` | FP rate on WM-811K "Random"/"none" wafers |
| `run-benchmark-synthetic-fp.mjs` | FP rate on synthetic i.i.d. random wafers |

Dataset source: `/home/paul/projects/LSWMD.pkl` → converted to
`tests/fixtures/wm811k-benchmark.npz` via `scripts/prepare-benchmark.py`.

---

## Detection rates

### Classifier alone

| Pattern | Recall | Notes |
|---|---|---|
| Near-full | 100% | |
| Edge-ring | 74% | |
| Edge-local | 65% | |
| Center | 60% | |
| Random | 59% | |
| Scratch | 26% | Fragmented patterns miss |
| Donut | 15% | Geometric overlap with center |

**Overall exact-match: 64% · Detection rate (any pattern flagged): 86.2%**

### Combined (classifier + regional analysis)

Of the 2,915 wafers the classifier missed, the regional analysis recovered:

| Measure | Rate |
|---|---|
| Any regional finding fired | 94.7% of misses |
| Semantically matched finding | 93.7% of misses |

**Combined detection rate: 99.3%** (any) / **99.1%** (semantically matched)

The any/match gap is small — regional findings on classifier misses are almost
always semantically correct, not noise.

Per-label rescue breakdown (classifier misses only):

| Label | Misses | Any rescue | Match rescue |
|---|---|---|---|
| center | 690 | 97.8% | 97.8% |
| donut | 238 | 97.5% | 95.0% |
| edge-local | 940 | 94.3% | 94.3% |
| edge-ring | 488 | 94.7% | 93.2% |
| scratch | 559 | 90.3% | 87.3% |

> **Re-run 2026-07-28 (v0.20.9).** Numbers above were re-measured after the fix
> that stopped `buildWaferMap` from mislabelling real probed edge dies as
> `partial` (see CHANGELOG). Regional/statistical findings exclude `partial`
> dies by convention (real fabs don't count boundary-straddling dies in
> yield/regional reporting), so the previous phantom-partial bug was silently
> stripping genuine edge dies out of the ring/edge-arc population it fed to
> **edge-ring** and **edge-local** detection specifically — the two classes
> whose signature *is* the boundary. Edge-ring rescue moved the most (81.1% →
> 94.7% any / 79.5% → 93.2% matched); edge-local also improved (93.1% → 94.3%).
> Center/donut/scratch shifted down by 1–3 points, consistent with a larger,
> correctly-populated edge ring slightly diluting the statistical significance
> of non-edge regional findings — not a regression, a more accurate population.
> The classifier-alone numbers above (`classifyPattern`) are unaffected: that
> path doesn't filter on `partial`.

---

## False positive characterisation

### WM-811K "Random"/"none" wafers (N = 4,459)

| Method | FP rate |
|---|---|
| Classifier only | 41.2% |
| Regional analysis only | 87.4% |
| Combined | 90.7% |

**Important caveat:** WM-811K "Random" is a catch-all label — ambiguous,
multi-modal, or low-confidence wafers all end up there. Some fraction genuinely
do have spatial structure. This FP rate is not a clean baseline.

### Synthetic random wafers (i.i.d. Bernoulli, N = 500/cell)

To get a clean FP baseline, wafers were generated with purely random die
failures at varying failure rates and grid sizes (20×20 to 52×52, matching
WM-811K's range):

| Fail rate | Regional FP rate |
|---|---|
| 2% | 13.7% |
| 5% | 15.1% |
| 10% | 49.5% ← known issue |
| 20% | 2.4% |
| 40% | 2.1% |
| 60% | 2.9% |

> **Re-run 2026-07-28 (v0.20.9).** Same fix as above — the synthetic generator
> masks to a disc, so its own boundary dies were previously being dropped from
> the regional-analysis population as phantom `partial` dies. The 10% spike
> shrank (55.9% → 49.5%) but is not eliminated; it remains the same underlying
> statistical-power issue, just measured over a slightly larger, correct
> population. (Aside, not related to the `partial` fix: `run-benchmark-synthetic-fp.mjs`
> now also sweeps `minimumRegionExcessFails` — all swept values produced
> identical results, which is worth a follow-up look at whether that option is
> actually wired into the regional-analysis path.)

The **10% failure rate spike** is a fundamental statistical power problem: with
1,700+ dies on a large wafer, the two-proportion z-test is powerful enough to
call random regional clustering noise significant. This cannot be fixed with
post-hoc count gates — any gate that reduces the number of candidates fed into
the Bonferroni correction also relaxes the correction, cancelling the benefit.
The correct fix (replacing Bonferroni with Benjamini-Hochberg FDR applied
globally) is a larger refactor; this spike is documented as a known limitation.

---

## Comparison to published methods

| Method | Accuracy on WM-811K | Notes |
|---|---|---|
| Our classifier (exact match) | 64% | Rule-based, no training |
| Our system (any detection) | 86.2% / 99.3% combined | |
| Decision tree + Radon features | >98% | 59 handcrafted features, trained ensemble |
| CNN-based (various) | 96–99.9% | Trained on balanced/oversampled subsets |

**Our system is not directly comparable to CNN figures** — they solve a
different problem: they require labelled training data, operate on pixel images,
and typically evaluate on class-balanced subsets. Our system works from die
coordinates and bin data with no training, produces fully interpretable named
findings, and functions on any wafer regardless of diameter or die pitch.

The most relevant comparison is the Decision Tree + Radon transform approach.
The recall gap (64% vs >98%) is largely in the hard classes (donut 15%, scratch
26%) which benefit from global frequency-domain information (Radon transform)
that local geometry cannot capture.

**Our unique strength:** the combined 99% detection rate is competitive as a
*detection* system, and the integration with statistical regional analysis
(which CNN papers do not provide) means the library surfaces both a pattern
label *and* statistical evidence for the finding — giving process engineers
more actionable information than a bare classification alone.

---

## Design decisions

### Adaptive thresholds

`minimumClusterSize` scales with wafer die count (`max(5, round(N × 0.003))`).
A 5-die cluster is meaningful on a small wafer but noise on a 2,500-die wafer.
This is the only threshold adapted at runtime — other regional analysis
thresholds (`minimumSampleSize`, `significanceLevel`) must not be adapted
because changing the number of tests fed into the Bonferroni correction alters
the correction itself, producing unpredictable FP rate changes.

The classifier's `minimumFailingDies` and `salienceSize` floor also scale by
the same formula, for the same reason.

### Removed from public API

The following were removed from `AnalyzeWaferMapOptions` to prevent users from
inadvertently degrading accuracy:

- `minimumSampleSize` — interacts with Bonferroni; user adjustment produces
  unpredictable FP rate changes
- `minimumClusterSize` — now auto-scaled; no user knob needed
- `patternThresholds` / `PatternThresholds` / `DEFAULT_PATTERN_THRESHOLDS` —
  17 inter-dependent thresholds calibrated on 25k wafers; adjusting one without
  understanding the others silently degrades classification accuracy

### RELATED_FAMILIES mapping

When the classifier identifies a pattern with high/medium confidence, correlated
regional findings are downgraded to `info` to avoid double-counting. The mapping
was updated to include `sector` and `quadrant` for `edge-local` and `scratch` —
both patterns can produce a sector or quadrant finding when the failure is
sufficiently localised.

### Donut improvement — not feasible with current features

`innerOuterRatio` was investigated as a co-discriminator for center vs donut.
In the WM-811K dataset, donuts have *higher* inner/outer failure *rates* than
centers — counter-intuitive, but explained by the donut hole geometry: the
donut ring sits in the outer half of the wafer, but the outer half contains far
more dies than the inner circle, so the outer failure *rate* is diluted. This
feature is not a reliable discriminator. The 15% donut recall ceiling is
intrinsic to the p25DistNorm overlap between the two classes.
