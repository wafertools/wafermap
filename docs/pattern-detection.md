# Spatial Pattern Detection

**For:** developers enabling pattern classification, and engineers wanting to know what the pattern labels mean and how far to trust them.

The library provides two complementary analysis systems that both surface
results as findings in the summary panel:

**Statistical region analysis** (covered in [Guide: Adding statistical findings](guide.md#adding-statistical-findings))
compares specific zones of the wafer — rings, quadrants, angular sectors,
contiguous clusters, and edge arcs — against the rest of the wafer using
significance tests. It answers: *"is this ring statistically worse than the
rest?"* or *"is there a contiguous cluster of failures here?"* These findings
are driven by p-values and effect sizes, so they have explicit statistical
backing.

**Spatial pattern classification** (this page) looks at the overall shape of
the failing die population and labels it with a named pattern: edge-ring,
center cluster, scratch, and so on. It answers: *"what kind of spatial failure
is this wafer showing overall?"* This is geometry-based, not statistical — it
characterises the whole-wafer failure signature rather than testing individual
zones.

Both systems run together when you call `analyzeWaferMap`. The spatial pattern
finding appears alongside the statistical findings in the same panel — you will
often see a spatial-pattern headline ("Edge-ring") supported by correlated
statistical findings ("Ring 4 (edge) yield is 34 points lower than the rest").
The statistical findings are the evidence; the pattern label is the interpretation.

---

The library automatically analyses each wafer's failing die distribution and
classifies it into one of several common spatial failure patterns. The result
appears as a finding in the summary panel, with the affected dies highlighted
on the wafer map. Engineers can use this as a first-pass triage signal — a
prompt for investigation, not a definitive process diagnosis.

## Patterns detected

| Pattern | What it looks like | Typical process hints |
|---|---|---|
| **Edge-ring** | Failing dies form a ring around the full wafer perimeter | Uniformity issue at wafer edge — plasma, CMP, deposition non-uniformity |
| **Edge-local** | Localised arc of failures at one section of the wafer edge | Edge handling damage, localised contamination, chuck edge effects |
| **Center cluster** | Failures concentrated near the wafer centre | Centre-to-edge gradient — gas flow, temperature, or deposition uniformity |
| **Donut** | Annular band of failures away from both centre and edge | Mid-radius process gradient or reticle field boundary effects |
| **Scratch** | Linear or diagonal streak of failures | Handling damage, wafer transport, or probe card drag |
| **Near-full** | The majority of dies across the whole wafer are failing | Global process failure — recipe error, contamination event |
| **Random** | No dominant spatial structure detected | Random defect distribution, or pattern below detection threshold |

## How it works

The classifier uses pure geometry — no trained model, no external dependencies,
no network calls. For each wafer it:

1. Finds the largest connected cluster of failing dies (the "salient region")
2. Computes geometric features: radial distance distribution, centroid position,
   eccentricity, edge-zone coverage, and linear/diagonal collinearity
3. Applies a rule-based classifier calibrated against real wafer data

Because it works directly from die coordinates and bin data, it functions on
any wafer regardless of diameter, die size, or coordinate system.

## Benchmark results

The classifier was tested against the **WM-811K dataset** — 25,519 labelled
wafers from real-world production, collected across 46,393 lots
(Wu et al., *IEEE Transactions on Semiconductor Manufacturing*, 2015).

| Pattern | Recall | Precision |
|---|---|---|
| Near-full | 100% | 40% |
| Edge-ring | 74% | 93% |
| Edge-local | 65% | 51% |
| Center | 60% | 85% |
| Random | 59% | 47% |
| Scratch | 26% | 33% |
| Donut | 15% | 7% |

**Overall exact-match accuracy: 64%**

**Detection rate: 86.2%** — the more operationally useful number. This means
that for 86 out of 100 wafers with a genuine spatial pattern, the library
correctly flags *some* pattern (even if the specific label is occasionally
wrong). Only 14% of patterned wafers are missed entirely (returned as random).

The distinction matters: an engineer reviewing a panel where a center-cluster
wafer is labelled as "donut" still gets a useful signal pointing to a
symmetric, wafer-centre-related process issue. A wafer labelled "random" when
the pattern is borderline scratch gets no spatial hint at all — those are the
true misses.

**Combined detection rate: 99%** — when the spatial pattern classifier and the
statistical regional analysis (rings, sectors, clusters, edge arcs) are
considered together, 99 out of 100 patterned wafers produce at least one
relevant finding. The 14% of wafers the classifier misses are largely recovered
by the regional analysis firing on the same underlying signal through a
different mechanism. See the [detection analysis notes](detection-analysis.md)
for the full investigation.

## Known limitations

**Center and donut are easily confused.** Both patterns have their failing dies
near the wafer centre with low edge loading. At real wafer noise levels their
geometric signatures overlap heavily — the classifier achieves only 60%/15%
recall respectively and will sometimes call one the other. If center vs donut
discrimination matters for your analysis, treat these two labels together as
"symmetric centre/annular pattern" and use the wafer map visually to distinguish
them.

**Scratch recall is limited (~26%).** Real scratch patterns often fragment into
many disconnected die-sized pieces along the scratch path, particularly at
typical semiconductor die pitches (5–15mm). The geometry features work best
on clean, contiguous scratches — fragmented or faint scratches tend to fall
through to "random".

**Calibrated on WM-811K.** The thresholds were derived from one fab's
production data. Wafers from significantly different die pitches,
wafer sizes, or process types may show different geometric signatures. The
geometry features are radially normalised so they transfer well across different
wafer diameters and die pitches; the classifier thresholds themselves are fixed
at the WM-811K calibration.

**Multi-pattern wafers get one headline label.** The spatial-pattern finding
reports the single geometrically dominant pattern. However, the independent
statistical findings — cluster, edge-arc, ring, and sector analyses — run
separately and will surface both signals. For example, a wafer with both an
edge-ring and a scratch will show one spatial-pattern headline ("Edge-ring" or
"Scratch", whichever dominates) but will also carry a cluster finding for the
scratch and ring findings for the edge loading. The full picture is in the
findings list, not just the headline.

**The label is a prompt, not a diagnosis.** The classifier has no knowledge of
your process, equipment, or lot history. A detected edge-ring finding means
"the failing die distribution is consistent with an edge-ring pattern" — not
that any specific piece of equipment is faulty.

## Using it

Pattern classification runs automatically as part of `analyzeWaferMap` and
appears in the findings panel. No configuration is required.

```js
import { buildWaferMap, analyzeWaferMap } from '@wafertools/wafermap';

const result = buildWaferMap({ results, waferConfig, dieConfig });
const summary = analyzeWaferMap(result);

const patternFindings = summary.findings.filter(
  f => f.comparison.family === 'spatial-pattern'
);
// patternFindings[0].comparison.left  → e.g. "Edge-ring"
// patternFindings[0].summary          → human-readable description
// patternFindings[0].highlight.dieKeys → the failing dies
```

To disable it:

```js
const summary = analyzeWaferMap(result);
const withoutPattern = summary.findings.filter(f => f.comparison.family !== 'spatial-pattern');
```

## Using the geometry features directly

To label a wafer, the classifier first measures the shape of its failing dies — how much of the
wafer and of its edge is failing, where the failing cluster sits radially, how elongated and how
line-like it is. `analyzeWaferMap` returns that measurement for every wafer as
`stats.spatialPattern`, alongside the label and confidence:

```js
import { buildWaferMap } from '@wafertools/wafermap';
import { analyzeWaferMap } from '@wafertools/wafermap/stats';

const result  = buildWaferMap({ results, waferConfig, dieConfig });
const summary = analyzeWaferMap(result);

summary.stats.spatialPattern;
// { pattern: 'edge-ring', confidence: 'high',
//   features: { globalRdd, edgeRdd, centroidDistNorm, minDistNorm, maxDistNorm,
//               p25DistNorm, innerOuterRatio, eccentricity, linearScore, ... } }
```

It is present on **every** wafer the classifier could measure, including those labelled
`'random'` or `'none'`, which raise no finding — so a set of summaries gives you features for
negative examples as well as patterned ones. It is absent only when the map has no bin data, or too
few failing dies to have a shape (fewer than 5, or 0.3% of the wafer).

The features are radially normalised and work at any wafer size or die pitch, which makes them
suitable input for a trained classifier if you need more accuracy for your own process. Published
CNN-based classifiers reach 96–99% exact-match accuracy on WM-811K when trained on labelled
examples; these features are a compact, interpretable alternative to pixel-level wafer images.

> Calling `classifyPattern` directly is deprecated and removed in 0.31.0 — `stats.spatialPattern`
> is the same measurement.
