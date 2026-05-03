# Stats Summary Design

This document proposes a new optional analysis layer for `wafermap` that detects
statistically meaningful spatial and inter-wafer patterns, then exposes them as
structured findings that the built-in UI can highlight.

The goal is to help users move from "spotting patterns by eye" to "reviewing a
ranked summary of unusual effects, then clicking into the map to inspect them."

This is a design proposal, not an implemented API.

---

## Goals

- Add a pure, server-safe analysis layer on top of the existing `wafer + dies` model.
- Detect meaningful regional differences in yield, bin concentration, and test values.
- Support both wafer-level and lot-level analysis.
- Produce structured findings that can be rendered in toolbars, panels, reports, or custom UIs.
- Make each finding actionable via click-to-highlight or click-to-focus behavior.

## Non-goals

- Replace visual inspection with a black-box "AI verdict".
- Provide a full statistical workbench or arbitrary ad hoc hypothesis-testing engine.
- Turn `renderWaferMap()` into the only place the feature can be used.
- Expose raw p-values without context, sample size, or effect size.

---

## Product Shape

The feature should be introduced as a new analysis layer, separate from rendering:

```text
buildWaferMap()         -> wafer + dies + scene
analyzeWaferMap()       -> findings for one wafer
analyzeWaferLot()       -> findings across multiple wafers
renderWaferMap()        -> optional findings UI + highlight behavior
renderWaferGallery()    -> optional lot findings UI + highlight behavior
```

This keeps the stats engine:

- pure and testable
- usable in Node, browsers, workers, and batch flows
- independent from any specific renderer

---

## Proposed API

## `analyzeWaferMap(input, options?)`

Accepts either:

- a `WaferMapResult` from `buildWaferMap()`
- or raw `WaferMapInput`

Returns a `StatsSummary`.

```ts
import { buildWaferMap, analyzeWaferMap } from '@paulrobins/wafermap';

const result = buildWaferMap({ results, waferConfig, dieConfig, testDefs, hbinDefs });
const stats = analyzeWaferMap(result);
```

## `analyzeWaferLot(items, options?)`

Accepts either:

- an array of `WaferMapResult`
- or an array of `WaferMapInput`

Returns a `LotStatsSummary`.

```ts
const lotStats = analyzeWaferLot([wafer1, wafer2, wafer3]);
```

## Proposed return types

```ts
interface StatsSummary {
  level: 'wafer';
  hasNotableFindings: boolean;
  findings: StatsFinding[];
  metadata: {
    totalDies: number;
    analyzedDies: number;
    excludedDies: number;
    testsConsidered: number[];
    hardBinsConsidered: number[];
    softBinsConsidered: number[];
  };
}

interface LotStatsSummary {
  level: 'lot';
  hasNotableFindings: boolean;
  findings: StatsFinding[];
  perWafer: Array<{
    waferIndex: number;
    summary: StatsSummary;
  }>;
  metadata: {
    waferCount: number;
    comparableWaferCount: number;
  };
}
```

## `StatsFinding`

The most important output is a structured finding, not a raw test result:

```ts
interface StatsFinding {
  id: string;
  level: 'wafer' | 'lot' | 'inter-wafer';
  severity: 'info' | 'notable' | 'unusual';
  variable: {
    kind: 'yield' | 'hardbin' | 'softbin' | 'test';
    index?: number;
    bin?: number;
    label: string;
    unit?: string;
  };
  comparison: {
    family: 'ring' | 'ring-band' | 'quadrant' | 'half-wafer' | 'reticle-position' | 'wafer';
    left: string;
    right: string;
  };
  effect: {
    direction: 'higher' | 'lower' | 'different';
    absoluteDelta?: number;
    relativeDelta?: number;
    effectSize?: number;
  };
  stats: {
    method: string;
    pValue?: number;
    adjustedPValue?: number;
    sampleSizeLeft: number;
    sampleSizeRight: number;
  };
  summary: string;
  highlight: HighlightTarget;
}

type HighlightTarget =
  | { kind: 'region'; regionFamily: 'ring' | 'ring-band' | 'quadrant' | 'half-wafer' | 'reticle-position'; keys: string[] }
  | { kind: 'bin'; binIndex: number; bin: number; regionKeys?: string[] }
  | { kind: 'wafer'; waferIndices: number[] }
  | { kind: 'dies'; dieKeys: string[] };
```

The `summary` field should be readable by humans:

- `"Outer ring yield is lower than the wafer core"`
- `"Quadrant SE has elevated hard bin 12 concentration"`
- `"Wafer 7 is an inter-wafer outlier for Idsat mean"`

---

## Analysis Scope

V1 should stay focused.

## Wafer-level findings

- Yield differences by ring
- Yield differences by quadrant
- Hard-bin concentration differences by ring
- Hard-bin concentration differences by quadrant
- Soft-bin concentration differences by ring
- Soft-bin concentration differences by quadrant
- Yield differences by reticle position when `reticleConfig` is available
- Hard-bin concentration differences by reticle position
- Soft-bin concentration differences by reticle position
- Test-value mean shifts by reticle position
- Test-value mean shifts by ring
- Test-value mean shifts by quadrant

## Lot-level findings

- Inter-wafer yield outliers
- Inter-wafer test outliers
- Repeated regional patterns across wafers
- Repeated bin-enrichment patterns across wafers
- Repeated soft-bin enrichment patterns across wafers
- Repeated reticle-position patterns across wafers when `reticleConfig` is available

## Region families for V1

To keep the search space controlled, region definitions should be limited to:

- `rings`: `1..N`
- `ring-band`: `core`, `middle`, `edge`
- `quadrants`: `NE`, `NW`, `SE`, `SW`
- `half-wafer`: `north/south`, `east/west`
- `reticle-position`: per-cell, per-row, or per-column groupings inside a reticle field when `reticleConfig` is present

Arbitrary user-defined ring merges should be deferred until the finding model and
UI interaction patterns are proven out.

For consistency, the ring count used by stats should mirror the ring count used
for rendering. The stats layer should not introduce a separate default ring
partition in V1.

---

## Statistical Rules

The goal is not "run every possible test". The goal is "surface robust,
actionable differences while minimizing noise."

## Continuous test values

For `die.values[index]` comparisons:

- default to Welch's t-test when sample sizes are adequate
- optionally support a robust non-parametric fallback such as Mann-Whitney
- report effect size alongside significance

## Proportion-based metrics

For yield and bin presence:

- use two-proportion z-tests when sample sizes are large enough
- fall back to Fisher's exact test when counts are small
- report absolute and relative delta, not just p-value

Hard-bin and soft-bin analysis should use the same statistical machinery and
finding model in V1. They differ only in which `bins[]` index is being analyzed
and which bin definitions are attached to the output.

Reticle-position analysis should reuse the same finding machinery as ring and
quadrant analysis. The only difference is the grouping key: reticle-local cell,
row, or column instead of wafer-centric regions.

## Inter-wafer outliers

For wafer-to-wafer comparison across a lot:

- compute per-wafer metrics first
- detect outliers using robust z-score / MAD-style thresholds
- optionally supplement with simple ranking language such as `"lowest of 12 wafers"`

## Multiple comparisons

Because the feature may compare many variables and regions:

- adjust p-values within a finding family
- use a correction such as Benjamini-Hochberg by default
- suppress low-value findings even if statistically significant

## Minimum thresholds

Each finding should pass all relevant thresholds:

- minimum die count in each region
- minimum non-missing sample count
- minimum effect size
- adjusted significance threshold

If any threshold fails, no finding should be emitted.

---

## Data Hygiene Rules

To avoid misleading findings:

- exclude `partial` dies by default
- exclude `edgeExcluded` dies by default
- ignore missing values for a given test
- analyze hard bins and soft bins independently
- carry `retestCount` through only as metadata, not as repeated samples
- only emit reticle-position findings when reticle-local coordinates can be assigned reliably

These defaults should be configurable, but conservative behavior should be the default.

---

## Severity Model

Findings should be grouped by user-facing severity, not just test output:

- `info`: a real but lower-priority difference
- `notable`: likely worth review
- `unusual`: strong and important pattern

Severity should be derived from a combination of:

- adjusted p-value
- effect size
- sample size
- domain-specific heuristics such as yield impact or repeated lot occurrence

This makes the toolbar badge and findings panel much more useful than a raw
"significant / not significant" split.

---

## UI Proposal

The built-in toolbar should expose findings without making them mandatory.

## Wafer map toolbar

Add a new findings icon:

- neutral state when no notable findings exist
- highlighted state when notable or unusual findings exist
- click opens a findings panel or popover

Each finding row should support:

- `Highlight`
- `Focus`
- later, possibly `Filter` or `Compare`

## Gallery toolbar

Add the same concept at lot level:

- lot findings panel summarizes cross-wafer patterns
- clicking a finding highlights the relevant wafer card or opens its modal
- repeated regional patterns can highlight the same quadrant/ring across cards

## Click-to-highlight behavior

Findings should connect back to the existing map interactions:

- ring finding -> highlight matching ring dies
- quadrant finding -> highlight matching quadrant dies
- reticle-position finding -> highlight all dies at the matching reticle-local position across the wafer
- bin finding -> set `highlightBin` and optionally constrain to a region
- inter-wafer finding -> emphasize the target wafer card

The finding system should drive existing rendering controls rather than adding a
separate visualization model.

---

## Suggested Scene / UI Integration

The stats engine should remain separate from rendering, but rendering may accept
optional findings state.

Possible additions:

```ts
interface WaferSceneOptions {
  statsSummary?: StatsSummary;
  highlightedFindingId?: string | null;
}

interface MountOptions {
  statsSummary?: StatsSummary;
  showStatsSummary?: boolean;
  eagerStats?: boolean;
}

interface GalleryOptions {
  lotStatsSummary?: LotStatsSummary;
  showStatsSummary?: boolean;
  eagerStats?: boolean;
}
```

The controller layer can then expose methods such as:

```ts
highlightFinding(id: string | null): void
openStatsPanel(): void
closeStatsPanel(): void
```

These should remain optional and UI-facing. The core analysis API must not depend on them.

---

## Implementation Plan

## Phase 1: Pure analysis engine

- Add `packages/stats`
- Define region builders for rings, ring bands, quadrants, and half-wafer
- Define reticle-position region builders when `reticleConfig` is available
- Define finding schema
- Implement wafer-level analysis for yield, hard bins, soft bins, tests, and reticle-position effects
- Implement lot-level inter-wafer aggregation
- Add deterministic tests for emitted findings

## Phase 2: UI wiring

- Add findings icon to `renderWaferMap()`
- Add findings icon to `renderWaferGallery()`
- Add click-to-highlight behavior
- Add icon badge state for notable findings
- Add DOM/integration tests for the panel and highlight wiring

## Phase 3: API and docs polish

- Export the new analysis functions from the public package entry
- Document defaults and thresholds in `API.md`
- Add examples for wafer-level and lot-level usage

---

## Testing Strategy

The analysis layer should be heavily tested with synthetic data:

- clean edge-ring yield drop
- strong single-quadrant bin enrichment
- repeating bad reticle cell across many fields
- no-signal random wafer
- sparse wafer with insufficient support
- lot with one clear outlier wafer
- lot with repeated regional trend across many wafers

UI tests should verify:

- findings icon state
- panel open/close behavior
- clicking a finding triggers highlight state
- gallery-level findings target the correct wafer cards

---

## Open Questions

- Should stats be computed eagerly in `buildWaferMap()` or only on demand?
- How much configurability should be exposed before we have usage feedback?
- Should findings be sortable purely by severity, or by a composite score?

My recommendation:

- ship soft-bin support in V1 alongside hard-bin support to avoid duplicate logic paths
- mirror render ring count in stats by default
- keep stats separate from `buildWaferMap()` in API shape, but allow eager computation in UI flows when it is cheap enough
- use a fixed default region set
- include reticle-position analysis in V1 when `reticleConfig` is available, but constrain comparisons to per-cell vs rest and simple row/column rollups
- keep the output schema rich, but the configuration surface narrow

That gives a useful first feature without locking the library into an overly broad analysis API too early.
