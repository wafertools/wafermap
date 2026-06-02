# Spatial Pattern Detection

The library provides two complementary analysis systems that both surface
results as findings in the summary panel:

**Statistical region analysis** (covered in [§10 of the User Guide](guide.md#10-adding-statistical-findings))
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
wafers from real-world TSMC 300mm fabrication, collected across 46,293 lots
(Wu et al., *IEEE Transactions on Semiconductor Manufacturing*, 2015).

| Pattern | Recall | Precision |
|---|---|---|
| Near-full | 100% | 40% |
| Edge-ring | 74% | 93% |
| Edge-local | 65% | 51% |
| Center | 60% | 85% |
| Random | 59% | 47% |
| Scratch | 26% | 33% |
| Donut | 15% | 48% |

**Overall exact-match accuracy: 64%**

**Detection rate: 86%** — the more operationally useful number. This means
that for 86 out of 100 wafers with a genuine spatial pattern, the library
correctly flags *some* pattern (even if the specific label is occasionally
wrong). Only 14% of patterned wafers are missed entirely (returned as random).

The distinction matters: an engineer reviewing a panel where a center-cluster
wafer is labelled as "donut" still gets a useful signal pointing to a
symmetric, wafer-centre-related process issue. A wafer labelled "random" when
the pattern is borderline scratch gets no spatial hint at all — those are the
true misses.

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

**Calibrated on WM-811K (TSMC 300mm).** The thresholds were derived from one
specific fab and process node. Wafers from significantly different die pitches,
wafer sizes, or process types may show different geometric signatures. The
`patternThresholds` option allows you to override any threshold without forking
the library.

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
import { buildWaferMap, analyzeWaferMap } from '@paulrobins/wafermap';

const result = buildWaferMap({ results, waferConfig, dieConfig });
const summary = analyzeWaferMap(result, { passBins: [1] });

const patternFindings = summary.findings.filter(
  f => f.comparison.family === 'spatial-pattern'
);
// patternFindings[0].comparison.left  → e.g. "Edge-ring"
// patternFindings[0].summary          → human-readable description
// patternFindings[0].highlight.dieKeys → the failing dies
```

To disable it:

```js
const summary = analyzeWaferMap(result, {
  passBins: [1],
  enablePatternClassification: false,
});
```

## Tuning thresholds

The classifier exposes all decision thresholds as `PatternThresholds`. You can
override any subset via `patternThresholds` in `AnalyzeWaferMapOptions`:

```js
const summary = analyzeWaferMap(result, {
  passBins: [1],
  patternThresholds: {
    // Tighten edge-ring detection for a process with high background edge RDD
    edgeRingEdgeRdd: 0.35,
  },
});
```

See `DEFAULT_PATTERN_THRESHOLDS` in the [API reference](api.md) for the full
list of tunable values and their defaults.

## Extending with your own classifier

The geometry features computed for each wafer are exposed in the
`PatternClassification` return value from `classifyPattern`. You can call
this function directly and use the `features` object as input to your own
model:

```js
import { buildWaferMap } from '@paulrobins/wafermap';
import { classifyPattern } from '@paulrobins/wafermap/stats';

const result = buildWaferMap({ results, waferConfig, dieConfig });
const classification = classifyPattern(result.dies, result.wafer, {
  passBins: [1],
});

// classification.features contains:
// globalRdd, edgeRdd, p25DistNorm, centroidDistNorm,
// eccentricity, linearScore, edgeAngularSpread, ...
```

These features are scale-invariant and work at any wafer size or die pitch,
making them suitable as input to a trained classifier if higher accuracy is
needed for your specific process.
