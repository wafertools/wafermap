# Spatial Detection Analysis

**For:** engineers and developers deciding how much to trust the automatic detections. This is a validation report — benchmark method, detection rates, false-positive characterisation — not a how-to; for usage see [Pattern Detection](pattern-detection.md).

This page documents the investigation into the combined detection capability of
the library's two spatial analysis systems, the false positive characterisation,
and the design decisions that resulted from it.

---

## The two detection systems

**Spatial pattern classifier** (inside `analyzeWaferMap`, reported as `stats.spatialPattern`) uses pure geometry — connected
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

All benchmarks were run against **WM-811K** — 25,519 labelled wafers from
real-world production (Wu et al., *IEEE Transactions on Semiconductor Manufacturing*,
2015). This is the standard public dataset for wafer map pattern classification.

Scripts are in `scripts/`:

| Script | Purpose |
|---|---|
| `run-benchmark-npz.mjs` | Classifier-only per-class recall/precision |
| `run-benchmark-combined.mjs` | Combined classifier + regional detection rates |
| `run-benchmark-fp.mjs` | FP rate on WM-811K "Random"/"none" wafers |
| `run-benchmark-synthetic-fp.mjs` | FP rate on synthetic i.i.d. random wafers |

Dataset source: the public WM-811K pickle (`LSWMD.pkl`), converted to
`tests/fixtures/wm811k-benchmark.npz` via `scripts/prepare-benchmark.py`.

---

## Detection rates

> **Re-run 2026-09-16 (0.30.1).** Every figure on this page was re-measured against the 0.30.1
> build and reproduced exactly: classifier recall and exact match, the 86.2% detection rate,
> the combined 99.3% / 99.1% rates and per-label rescue, and both false-positive tables.
>
> **Re-run 2026-10-09, classifier.** A scratch is a thin line along its own axis at any angle (with the fragments that
> continue it), a donut a mid-radius band read from the fail rate in five rings, and any other symmetric centre pattern a
> centre cluster. Exact match 64.1% → 71.1%; scratch recall 24% → 41% (precision 36% → 87%), donut 15% → 78% (precision
> 7% → 69%), centre 60% → 85%; detection 86.3% → 88.0%, combined 98.7% → 98.8%. The classifier's false-positive rate on
> WM-811K Random/none falls from 41.2% to 39.6% (combined 89.3% → 89.5%); the synthetic sweep is unchanged.
>
> **Re-run 2026-10-09, regions against each other.** Each regional finding is re-tested against the rest of the wafer
> without the other findings of its variable and family, losses first, so a failing quadrant no longer brings "better"
> findings from the sectors opposite it (none on 200 synthetic wafers, against 78 before). Every figure on this page is
> unchanged by it except the WM-811K combined false-positive rate (89.4% → 89.3%).
>
> **Re-run 2026-10-09.** Clusters and edge arcs are tested by a permutation null of the largest group (see
> [False positives](#synthetic-random-wafers-iid-bernoulli-n-500cell)), and p-values come from an erfc accurate to double
> precision. The classifier figures are unchanged. On synthetic random wafers the regional false-positive rate at a 10%
> fail rate falls from 34.1% to 5.3%; the regional analysis rescues 2,602 of the 2,881 classifier misses (was 2,711), most
> of the difference edge-local and centre wafers that only a cluster finding caught, and combined detection is 98.7%
> (was 99.2%).
>
> **Re-run 2026-10-08.** Benjamini–Hochberg now adjusts every rate comparison on a wafer as one family, rates with
> small expected counts are tested exactly (Fisher), and clusters use the exact binomial tail with their own one-family
> adjustment. The classifier figures are unchanged. The combined rates and the false-positive tables below are this
> release's; on synthetic random wafers the regional false-positive rate falls by a factor of two to five, at a cost of 15
> of the 2,881 classifier misses no longer rescued (combined 99.3% → 99.2%).
>
> **Re-run 2026-09-27.** The classifier alone, which recognises an edge ring from the failing
> dies' positions when no large connected group exists: edge-ring recall 75%
> (precision 92%), scratch 24%, detection 86.4%, exact match 64%; other classes unchanged. The
> combined 99.3% / 99.1% rates, the WM-811K false-positive table and the synthetic sweep were
> re-run with this release's regional analysis: all unchanged except the synthetic 2% cell
> (14.2%). The miss and rescue counts below are this classifier's.

### Classifier alone

| Pattern | Recall | Notes |
|---|---|---|
| Near-full | 100% | |
| Center | 85% | |
| Donut | 78% | Radial profile: a mid-radius band over centre and rim |
| Edge-ring | 75% | |
| Edge-local | 68% | |
| Random | 60% | |
| Scratch | 41% | A thin line at any angle; faint ones miss |

**Overall exact-match: 71% · Detection rate (any pattern flagged): 88.0%**

### Combined (classifier + regional analysis)

Of the 2,528 wafers the classifier missed, the regional analysis recovered:

| Measure | Rate |
|---|---|
| Any regional finding fired | 89.8% of misses |
| Semantically matched finding | 88.4% of misses |

**Combined detection rate: 98.8%** (any) / **98.6%** (semantically matched)

The any/match gap is small — regional findings on classifier misses are almost
always semantically correct, not noise.

Per-label rescue breakdown (classifier misses only):

| Label | Misses | Any rescue | Match rescue |
|---|---|---|---|
| center | 598 | 91.3% | 90.5% |
| donut | 52 | 94.2% | 88.5% |
| edge-local | 1,009 | 89.0% | 89.0% |
| edge-ring | 453 | 91.6% | 90.1% |
| scratch | 416 | 87.0% | 82.5% |

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
> The classifier-alone numbers above are unaffected: that
> path doesn't filter on `partial`.

---

## False positive characterisation

### WM-811K "Random"/"none" wafers (N = 4,459)

| Method | FP rate |
|---|---|
| Classifier only | 39.6% |
| Regional analysis only | 85.4% |
| Combined | 89.5% |

**Important caveat:** WM-811K "Random" is a catch-all label — ambiguous,
multi-modal, or low-confidence wafers all end up there. Some fraction genuinely
do have spatial structure. This FP rate is not a clean baseline.

### Synthetic random wafers (i.i.d. Bernoulli, N = 500/cell)

To get a clean FP baseline, wafers were generated with purely random die
failures at varying failure rates and grid sizes (20×20 to 52×52, matching
WM-811K's range):

| Fail rate | Regional FP rate |
|---|---|
| 2% | 2.7% |
| 5% | 5.5% |
| 10% | 5.3% |
| 20% | 0.9% |
| 40% | 1.2% |
| 60% | 1.6% |

Every rate comparison on a wafer (yield, hard and soft bins, functional tests and limit fail rates, in every region
family) is one family for the Benjamini–Hochberg adjustment, so a wafer of pure noise reports a regional finding about
as often as the 5% significance level allows. Until 2026-10-08 the adjustment was per variable and region family, some
twenty families a wafer, and the rates were 14.2%, 15.1%, 49.5%, 2.4%, 2.1% and 2.9%.

**Clusters and edge arcs** are tested by their size against random placement. A cluster is a connected group of failing
dies, and the group is chosen because it fails, so its own fail rate is no evidence: at a moderate fail rate random
failures always form some clump that a rate test calls significant. (Before 2026-10-09 a cluster was tested by its fail
rate against its neighbourhood, and the 10% cell was 34.1%.) The wafer's fails are now scattered at random
over the same dies up to 99 times, and a group is reported only when the largest group random placement makes is rarely
as large. The shuffles are seeded from the layout and the fail count, and the wafers of a lot share them.

---

## Comparison to published methods

| Method | Accuracy on WM-811K | Notes |
|---|---|---|
| Our classifier (exact match) | 64% | Rule-based, no training |
| Our system (any detection) | 86.4% / 99.3% combined | |
| Decision tree + Radon features | >98% | 59 handcrafted features, trained ensemble |
| CNN-based (various) | 96–99.9% | Trained on balanced/oversampled subsets |

**Our system is not directly comparable to CNN figures** — they solve a
different problem: they require labelled training data, operate on pixel images,
and typically evaluate on class-balanced subsets. Our system works from die
coordinates and bin data with no training, produces fully interpretable named
findings, and functions on any wafer regardless of diameter or die pitch.

The most relevant comparison is the Decision Tree + Radon transform approach.
The recall gap (64% vs >98%) is largely in the hard classes (donut 15%, scratch
24%) which benefit from global frequency-domain information (Radon transform)
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
