# API Reference

This document describes the public API exposed by `wafermap`.

---

## 1 Coordinate system

**`x` and `y` throughout this API are die grid positions (prober step coordinates) — integers such as −7, 0, 5.  They are NOT millimetre values.**

This matches what wafer test equipment outputs.  The library converts grid positions to physical mm internally using the die size you provide.

```text
prober outputs:  x=-5, y=3   (die grid position)
library computes: x_mm = -5 × 10 = -50 mm   (given die width = 10 mm)
```

Physical mm positions appear only on the `Die` output objects (`die.physX`, `die.physY`) and in the wafer model.  You never need to compute or supply mm values.

---

## 2 Quick Start

```ts
import { buildWaferMap } from '@paulrobins/wafermap';
import { renderWaferMap } from '@paulrobins/wafermap/canvas-adapter';

// x,y are prober step positions (die grid indices), not mm.
const { wafer, dies } = buildWaferMap({
  results:   rows.map(r => ({ x: +r.x, y: +r.y, hbin: +r.hbin, testValues: { 1010: +r.testA } })),
  waferConfig: { diameter: 300, notch: { type: 'bottom' } },
  dieConfig:   { width: 10, height: 10 },
  testDefs: [{ testNumber: 1010, name: 'TestA', unit: 'V' }],
});

renderWaferMap(document.getElementById('map'), wafer, dies);
```

The map renders with a full built-in toolbar — no extra HTML or JavaScript needed.

---

## 3 API overview

```text
buildWaferMap()            — data layer: prober results → wafer + dies (server-safe, no DOM)
    │
    ├── renderWaferMap()       — single interactive canvas map with full toolbar  ← recommended
    ├── renderWaferGallery()   — multi-map gallery with shared controls + click-to-modal  ← recommended
    │
    ├── toPlotly()             — optional Plotly SVG compatibility renderer
    └── toCanvas()             — direct canvas render without toolbar
```

---

## 4 `buildWaferMap(input)`

The primary entry point.  Pass whatever data you have — prober step positions,
optional geometry hints, or a pre-built die array.  The function infers whatever
is missing and returns a fully constructed wafer model.

**Server-safe:** `buildWaferMap` is a pure function with no DOM access or side
effects.  It can run in Node.js, Deno, a Web Worker, or any server-side environment.

```ts
import { buildWaferMap } from '@paulrobins/wafermap';
```

### 4.1 Input

`buildWaferMap` accepts either an array of data points or an object:

```ts
// Array form — minimal
buildWaferMap(results: DieResult[])

// Object form — with optional geometry hints
buildWaferMap({
  results?:      DieResult[],      // per-die measurements from the prober
  waferConfig?:  WaferConfig,     // physical wafer geometry (diameter, notch, orientation…)
  dieConfig?:    DieConfig,       // die size and coordinate conventions
  dies?:         Die[],            // pre-built die array; skips geometry generation
  reticleConfig?: ReticleConfig,   // stepper field grid overlay
  lotStack?:     LotStackConfig,   // collapse multiple wafers into one aggregated map
  passBins?:     number[],         // bins counted as pass for yield (default [1])
  retestPolicy?: 'last' | 'first' | 'best' | 'worst', // how to handle multiple results at the same (x,y); default 'last'
  edgeDieYieldMode?: 'exclude' | 'denominator-only', // default 'exclude'
  testDefs?:     TestDef[],        // named test definitions — one per testValues entry
  hbinDefs?:     BinDef[],         // named hard bin definitions — one per distinct hbin value
  sbinDefs?:     BinDef[],         // named soft bin definitions — one per distinct sbin value
})
```

All fields are optional.  Supply what you know; the library handles the rest.

#### 4.1.1 `DieResult`

A single die record from wafer test equipment.

```ts
{
  x:           number                      // die grid X position (prober step coordinate)
  y:           number                      // die grid Y position (prober step coordinate)
  testValues?: Record<number, number>      // preferred: test measurements keyed by stable test identity
                                           // e.g. { 1050: 1.42e-3, 1060: 0.487, 1070: 8.3e-12 }
                                           // the key is any stable integer per test — for example an STDF TEST_NUM,
                                           // a database test ID, or an application-defined constant
  values?:     number[]                    // @deprecated: use testValues. Positional array — fragile when tests are added or removed
  hbin?:       number                      // hard bin assignment (physical sort result; STDF V4 range 0–32767)
  sbin?:       number                      // soft bin assignment (test-program failure category; independent 0–32767 space)
}
```

Use `testValues` (keyed map) rather than `values` (positional array). A keyed map is stable when tests are added, removed, or reordered between test program revisions; a positional array is not.

A single test result: `testValues: { 1050: 0.95 }`

When a die position appears more than once in the `results` array (a retest), the
`retestPolicy` field on `WaferMapInput` controls which result is kept.  The
`die.retestCount` field always records how many times that position appeared.

#### 4.1.2 `WaferConfig`

```ts
{
  diameter?:      number         // wafer diameter in mm; inferred from grid extent × pitch if omitted
  notch?:         { type: 'top' | 'bottom' | 'left' | 'right' }
                  // physical orientation mark direction; standard dimensions derived from diameter:
                  //   ≤ 100 mm → 32.5 mm orientation flat  (SEMI M1)
                  //   ≤ 150 mm → 57.5 mm orientation flat  (SEMI M1)
                  //   > 150 mm → V-notch ~3.5 mm wide, 1.25 mm deep  (SEMI M1)
  orientation?:   number         // degrees CCW to rotate the die grid on screen; default 0 (see note below)
  edgeExclusion?: number         // exclusion band width in mm measured inward from the wafer edge; dies in this band are dimmed
  metadata?:      WaferMetadata  // arbitrary lot/wafer-level data attached to the scene (lot ID, date, etc.)
}
```

**`orientation` note:** positive values rotate the die grid counter-clockwise (standard mathematical convention).  The notch/flat position is controlled by `notch.type` and is **not** affected by `orientation` — it stays fixed as the physical alignment mark.


#### 4.1.3 `DieConfig`

```ts
{
  width?:              number   // die width in mm (= X step pitch); enables physical mm coordinates
  height?:             number   // die height in mm (= Y step pitch); enables physical mm coordinates
  coordinateOrigin?:   {
    // where the prober places coordinate (0,0) on the wafer grid
    type: 'center'           // default — grid already centred; centroid offset applied automatically
        | 'LL'               // (0,0) at lower-left corner; auto-detected when all input x,y ≥ 0
        | 'UL'               // (0,0) at upper-left corner — positive Y runs downward (flips display Y)
        | 'LR'               // (0,0) at lower-right corner — positive X runs leftward (flips display X)
        | 'UR'               // (0,0) at upper-right corner — both axes flipped
        | 'custom'           // manual offset: centre = (0,0) + offset in grid steps
    offset?: { x: number; y: number }   // grid-step offset to the true centre; only used when type is 'custom'
  }
  yAxisDirection?: 'up' | 'down'     // which direction Y increases on the prober; 'down' for row/matrix probers (default 'up')
  xAxisDirection?: 'right' | 'left'  // which direction X increases; 'left' for backside or mirrored probing (default 'right')
}
```

When `width` and `height` are omitted, the library estimates die dimensions from
the grid layout using nearest-neighbour step analysis first, falling back to the
circular-wafer aspect-ratio constraint.


#### 4.1.4 `ReticleConfig`

```ts
{
  width:      number               // stepper field width in number of dies (e.g. 4 means 4 dies wide)
  height:     number               // stepper field height in number of dies
  anchorDie?: { x: number; y: number }
               // die grid index (x, y) that sits at the reticle field's internal (0,0) corner.
               // Shifts the entire reticle grid so this die aligns to a field boundary.
               // Default {0,0} — die (0,0) is at a corner.
}
```

When provided, reticle overlays are shown by default (`showReticle` defaults to `true`).

#### 4.1.5 `LotStackConfig`

Collapse data from multiple wafers into a single map before rendering.  When `lotStack`
is present the top-level `results` field is ignored.

```ts
{
  results:    DieResult[][]  // input data — one DieResult[] per wafer in the lot
  method:     // aggregation applied per die position across all wafers:
    | 'mean'       // arithmetic mean of values → testValues[0]
    | 'median'     // median of values → testValues[0]
    | 'stddev'     // sample standard deviation of values → testValues[0]
    | 'min'        // minimum value across lot → testValues[0]
    | 'max'        // maximum value across lot → testValues[0]
    | 'count'      // number of wafers that provided a value at this position → testValues[0]
    | 'countBin'   // how many wafers had targetBin at this position → testValues[0]
    | 'mode'       // most frequent bin across wafers → hbin
    | 'percent'    // percentage of wafers that had targetBin → testValues[0] in [0,100]
  targetBin?: number   // bin value to count or measure; required for 'countBin' and 'percent'
}
```

#### 4.1.6 `passBins`

```ts
passBins?: number[]   // default [1]  (industry convention: bin 1 = pass)
```

Bin values that count as pass for yield calculation.  Set to `[]` to suppress yield.

#### 4.1.7 `retestPolicy`

```ts
retestPolicy?: 'last' | 'first' | 'best' | 'worst'   // default 'last'
```

Controls how the library handles multiple results for the same die position (retests).
In wafer test it is common for a die to be tested more than once — for example after
a recontact, a temperature retest, or a continuity retest.

| Policy | Behaviour |
| ------ | --------- |
| `'last'` (default) | Keep the most recent result — the last entry in `results` for that position |
| `'first'` | Keep the earliest result — the first entry in `results` for that position |
| `'best'` | Keep the best result using `passBins` as the primary criterion: a pass result always beats a fail result. When both candidates are in the same pass/fail category, the lower `hbin` number is the tiebreaker. Falls back to `'last'` when any candidate has no `hbin`. |
| `'worst'` | Keep the worst result: a fail result always beats a pass result. When both are in the same category, the higher `hbin` number wins. Falls back to `'last'` when any candidate has no `hbin`. |

Regardless of which policy is active, `die.retestCount` is always set on any die that
appeared more than once in the input.  Use it to identify retested dies in your own
analysis without needing to re-scan the raw results.

```ts
// Last result wins (default — no field needed):
buildWaferMap({ results })

// Explicitly keep first result:
buildWaferMap({ results, retestPolicy: 'first' })

// Check how many retests occurred after the map is built:
result.dies.filter(d => d.retestCount !== undefined)
  .forEach(d => console.log(`Die (${d.x},${d.y}) tested ${d.retestCount} times`));
```

#### 4.1.8 `TestDef`

Named definition for one test parameter. The toolbar mode dropdown always offers one entry per test — using `testNumber` as the label when `testDefs` is absent. When `testDefs` is provided, tooltips show `"Idsat: 1.23 mA"` with the test name and SI-scaled unit; without it they fall back to `"Test 1050: 1.23 mA"`.

```ts
{
  testNumber?: number  // preferred: stable test identity matching the key used in DieResult.testValues
                       // e.g. an STDF TEST_NUM, a database test ID, or an application-defined constant
  index?:      number  // @deprecated: use testNumber. Positional index into the deprecated values[] array.
                       // At least one of testNumber or index must be provided.
  name:        string  // e.g. "Idsat", "Vth", "Continuity"
  unit?:       string  // SI base unit, e.g. "A", "V", "Ω", "F" — the formatter applies SI prefixes
                       // automatically (0.03 Ω → "30 mΩ"), so always pass the base unit, never a
                       // pre-scaled unit like "mA" or "µV"
  logScale?:   boolean // when true, value normalization and the colorbar use log₁₀ scale for this test
                       // silently falls back to linear when any die value is ≤ 0; default false
  limitLow?:   number  // lower specification limit in the same units as the test value
                       // values below this are out-of-spec; drives specLimit plot mode and spec yield stats
  limitHigh?:  number  // upper specification limit in the same units as the test value
                       // values above this are out-of-spec
                       // both limits are optional independently — one-sided limits are valid
}
```

`testNumber` is preferred. When `testNumber` is set it must match the key used in `DieResult.testValues`. Use `index` only when working with the deprecated `values[]` array.

#### 4.1.9 `BinDef`

Named definition for one bin number.  Used for both hard bin (`hbinDefs`) and soft bin (`sbinDefs`) — the shape is identical but the number spaces are independent.

Per STDF V4, hard bins and soft bins each range 0–32767.  Bin 1 in hard bin space and bin 1 in soft bin space are different things and may have different names — always pass them as separate arrays.

```ts
{
  bin:    number   // the numeric bin value this defines
  name:   string   // e.g. "Pass", "Contact Open", "Vth - Hi NMOS"
  color?: string   // optional CSS color override, e.g. "#2ecc71" — overrides the active colour scheme
}
```

**Hard bins** (`hbinDefs`) are the physical sort result — where the part goes on the handler.  **Soft bins** (`sbinDefs`) are the logical test-program classification — the failure category as determined by the test algorithm, used for debug and yield analysis.  Many soft bins typically map to one hard bin.

#### 4.1.10 `edgeDieYieldMode`

```ts
edgeDieYieldMode?: 'exclude' | 'denominator-only'   // default 'exclude'
```

Controls how dies within the edge exclusion zone (`waferConfig.edgeExclusion`) are treated in yield calculation.

| Value | Behaviour |
| ----- | --------- |
| `'exclude'` (default) | Edge dies are excluded from both numerator and denominator. `YieldSummary.yieldPercent` reflects only the interior dies. |
| `'denominator-only'` | Edge dies are counted in the denominator but never in the pass numerator. Produces **gross die yield** — the industry metric for quantifying yield loss due to edge effects. `YieldSummary.yieldPercentGross` is populated with this value; `yieldPercent` is also populated for comparison. |

```ts
const result = buildWaferMap({
  results,
  waferConfig:      { diameter: 300, edgeExclusion: 3 },
  dieConfig:        { width: 8, height: 12 },
  edgeDieYieldMode: 'denominator-only',
});

const { yieldPercent, yieldPercentGross } = result.yield;
// yieldPercent      — interior-only yield (edge dies excluded entirely)
// yieldPercentGross — gross die yield (edge dies counted against you)
```

### 4.2 Return value

```ts
{
  wafer:         Wafer          // resolved wafer model (diameter, radius, center, notch, orientation)
  dies:          Die[]          // all dies inside the wafer boundary, with testValues/hbin/sbin attached
  scene:         Scene          // renderer-agnostic scene — pass directly to toPlotly() if needed
  reticles:      Reticle[]      // generated reticle geometry — pass as sceneOptions.reticles to renderWaferMap
  reticleConfig: ReticleConfig | undefined  // the reticle config that was used; passed through to analyzeWaferMap automatically
  units:   'mm' | 'normalized'   // coordinate space of die.physX/die.physY and wafer dimensions
  inference: {
    wafer:    { confidence: number; method: string }   // how diameter was resolved; confidence 0–1
    diePitch: { confidence: number; units: 'mm' | 'normalized' }  // how die size was resolved
    grid:     { confidence: number }                   // quality of the grid index assignment
  }
  dataCoverage: {
    filledDies:       number   // dies with at least one value or bin attached
    totalDies:        number   // all dies inside the wafer boundary (including partial)
    edgeExcludedDies: number   // dies whose centres fall within the edge exclusion band
    ratio:            number   // filledDies / totalDies ∈ [0, 1]
  }
  yield: YieldSummary   // pass/fail statistics computed against passBins
}
```

#### 4.2.1 `YieldSummary`

```ts
{
  passDies:          number          // dies with a bin in passBins
  failDies:          number          // full dies inside wafer with a bin not in passBins
  edgeExcludedDies:  number          // dies within the edge exclusion zone
  partialDies:       number          // dies straddling the wafer boundary
  totalDies:         number          // passDies + failDies (edge-excluded not included)
  yieldPercent:      number | null   // passDies / totalDies ∈ [0,1]; null when no bin data
  yieldPercentGross: number | null   // passDies / (passDies + failDies + edgeExcludedDies);
                                     // only set when edgeDieYieldMode: 'denominator-only'; otherwise null
}
```

Partial dies are excluded from both numerator and denominator. Edge-excluded dies are excluded by default (`edgeDieYieldMode: 'exclude'`); set `edgeDieYieldMode: 'denominator-only'` to include them in the denominator for gross die yield.

**`units`** tells you the coordinate space of the physical coordinates (`die.physX`, `die.physY`) and wafer dimensions; `die.x`/`die.y` remain die grid positions (prober step coordinates):

- `'mm'` — at least one physical dimension was known (die size or wafer diameter); physical coordinates (die.physX/die.physY and wafer dimensions) are expressed in millimetres.
- `'normalized'` — only grid positions were supplied; physical coordinates are in normalized units (aspect ratio preserved) with `pitchX = 1` normalized unit by convention.

### 4.3 Inference levels

The library adapts to whatever geometry context you provide.  Four distinct levels:

| Provided | Inferred | `units` |
| -------- | -------- | ------- |
| grid positions only | Pitch from nearest-neighbour step analysis; diameter from grid extent | `'normalized'` |
| grid positions + die size | Diameter from grid extent × pitch | `'mm'` |
| grid positions + wafer diameter | Die size from `diameter / grid_extent` | `'mm'` |
| grid positions + die size + diameter | Nothing — fully specified | `'mm'` |

**Diameter snapping:** inferred diameters snap to industry-standard sizes.
100 mm, 150 mm, 200 mm, and 300 mm are preferred (±10% tolerance); other SEMI
standard sizes (25 / 50 / 75 / 450 mm) are tried next (±20%); remaining values
are rounded to the nearest 10 mm.

**Origin auto-detection:** when all input coordinates are ≥ 0, the library
automatically infers lower-left (`'LL'`) origin and centres the grid for display.

### 4.4 Examples

**Minimal — grid positions only (normalized units):**

```ts
const { wafer, dies } = buildWaferMap([
  { x: 0, y:  0, testValues: { 1050: 0.95 } },
  { x: 1, y:  0, testValues: { 1050: 0.87 } },
  { x: 0, y: -1, testValues: { 1050: 0.91 } },
]);
// result.units === 'normalized'
```

**With die size — physical mm coordinates:**

```ts
const { wafer, dies } = buildWaferMap({
  results:   data,
  dieConfig: { width: 10, height: 10 },
});
// result.units === 'mm'
```

**Fully specified with notch:**

```ts
const { wafer, dies } = buildWaferMap({
  results:     data,
  waferConfig: { diameter: 300, notch: { type: 'bottom' }, orientation: 90 },
  dieConfig:   { width: 10, height: 10 },
});
```

**With bin data and edge exclusion:**

```ts
const { wafer, dies, yield: yld } = buildWaferMap({
  results:     csvRows.map(r => ({ x: Number(r.x), y: Number(r.y), hbin: Number(r.hbin) })),
  waferConfig: { diameter: 200, edgeExclusion: 3 },
  dieConfig:   { width: 8, height: 8 },
});
console.log(yld.yieldPercent);
```

**Multiple tests and bins in a single pass:**

```ts
const { wafer, dies } = buildWaferMap({
  results: rows.map(r => ({
    x: +r.x, y: +r.y,
    testValues: { 1010: +r.testA, 1020: +r.testB, 1030: +r.testC },
    hbin: +r.hbin,
    sbin: +r.sbin,
  })),
  testDefs: [
    { testNumber: 1010, name: 'Idsat', unit: 'A' },
    { testNumber: 1020, name: 'Vth',   unit: 'V' },
    { testNumber: 1030, name: 'Ioff',  unit: 'A' },
  ],
  dieConfig: { width: 10, height: 10 },
});
```

**Reticle overlay phased to die (2, 1):**

```ts
const { wafer, dies } = buildWaferMap({
  results:   data,
  dieConfig: { width: 10, height: 10 },
  reticleConfig: { width: 4, height: 2, anchorDie: { x: 2, y: 1 } },
});
```

**Multi-wafer lot stack — count bin 2 failures across six wafers:**

```ts
const { wafer, dies } = buildWaferMap({
  waferConfig: { diameter: 300 },
  dieConfig:   { width: 10, height: 10 },
  lotStack: {
    results:   [wafer1, wafer2, wafer3, wafer4, wafer5, wafer6],
    method:    'countBin',
    targetBin: 2,
  },
});
```

**Row-based prober (y increases downward, origin at upper-left):**

```ts
const { wafer, dies } = buildWaferMap({
  results:   data,
  dieConfig: { width: 10, height: 10, coordinateOrigin: { type: 'UL' } },
});
```

**Retests — keep first result, surface retest count in tooltip:**

```ts
// Raw results may include the same (x, y) more than once.
// 'first' keeps the initial test; 'last' (default) keeps the most recent.
const { wafer, dies } = buildWaferMap({
  results:      rawResults,
  retestPolicy: 'first',
  waferConfig:  { diameter: 300, notch: { type: 'bottom' } },
  dieConfig:    { width: 10, height: 10 },
});

// die.retestCount is set (to the total count) whenever a position was retested.
const retested = dies.filter(d => d.retestCount !== undefined);
console.log(`${retested.length} die positions were retested`);
// e.g. → "47 die positions were retested"
// The built-in tooltip automatically shows "Retests: N" for retested dies.
```

### 4.5 Post-enrichment

When you need to attach additional values after the map is built, use `getDieKey`
for stable lookups:

```ts
import { buildWaferMap, getDieKey } from '@paulrobins/wafermap';

const result = buildWaferMap({ results: primaryData, waferConfig, dieConfig });

const rowMap = new Map(rows.map(r => [getDieKey({ x: +r.x, y: +r.y }), r]));
const enrichedDies = result.dies.map(d => {
  const row = rowMap.get(getDieKey(d));
  if (!row) return d;
  return {
    ...d,
    testValues: { 1010: +row.testA, 1020: +row.testB, 1030: +row.testC },
    hbin:       +row.hbin,
    sbin:       +row.sbin,
  };
});
```

> **`getDieKey`** always use this for stable die lookups rather than ad-hoc template
> literals — it guarantees a consistent `"x,y"` format across grid offset corrections.

---

## 5 `renderWaferMap(canvas, wafer, dies, options?)`

A fully self-contained interactive wafermap. Accepts `wafer` and `dies` directly,
owns scene building internally, and provides a **built-in toolbar** that appears on
hover — wafermap-specific controls always in the same place.

The toolbar gives users direct access to every display option without any app-level
chrome: plot mode, colour scheme, ring and quadrant overlays, die labels, rotate,
flip, zoom, box-select, and PNG download.

```ts
import { renderWaferMap } from '@paulrobins/wafermap/canvas-adapter';
```

### 5.1 `WaferSceneOptions`

Scene display options controllable via the toolbar or programmatically:

```ts
{
  plotMode?:               PlotMode          // default 'hardBin'; 'specLimit' requires testDefs with limitLow/limitHigh
  colorScheme?:            string            // default 'default' (see note on 'color' alias below)
  showText?:               boolean           // die index labels
  showRingBoundaries?:     boolean
  showQuadrantBoundaries?: boolean
  showReticle?:            boolean           // reticle field boundary overlay (requires reticles to be set)
  showXYIndicator?:        boolean           // axis-orientation arrows showing +X/+Y directions
  reticles?:               Reticle[]         // pass result.reticles from buildWaferMap to enable the overlay
  ringCount?:              number            // default 4
  highlightBin?:           number            // dim all other bins
  rotation?:               0 | 90 | 180 | 270
  flipX?:                  boolean
  flipY?:                  boolean
  testDefs?:               TestDef[]         // named test definitions — drives mode dropdown entries
  hbinDefs?:               BinDef[]          // hard bin names/colors (hbin, 0–32767 space)
  sbinDefs?:               BinDef[]          // soft bin names/colors (sbin, 0–32767 space — independent)
  testIndex?:              number            // toolbar cursor: which testDefs entry to show in 'value' mode; default 0
  logScale?:               boolean           // override log₁₀ scale on/off for the active test; takes precedence over TestDef.logScale; silently falls back to linear when vMin ≤ 0
  colorbarRangeMode?:      'spec' | 'data'   // default 'spec' when active testDef has limits: colorbar spans [limitLow, limitHigh]
                                            // set 'data' to span actual data min/max regardless of limits
                                            // out-of-spec die coloring (blue/red) applies in both modes
  valueRange?:             [number, number]  // explicit [min, max] for value colour normalization; overrides colorbarRangeMode when set
  aggrMethod?:             string            // aggregation method label shown in hover tooltips for 'stackedValues' mode (e.g. 'mean', 'median')
  lotSize?:                number            // total wafers in lot — used to compute bin occurrence percentage in 'stackedBins'/'stackedSoftBins' hover tooltips
  legendPosition?:         'default' | 'compact' | 'left' | 'top' | 'bottom' | 'floating'
                                            // bin legend position/style; default 'default' (auto-adapts: compact below 280 px, floating below 180 px)
                                            // only applies in hardBin/softBin modes
}
```

> **`colorScheme` note:** `'color'` is a deprecated alias for `'default'` — it works but does not appear in `listColorSchemes()` output. Use `'default'` in new code.

### 5.2 Hover tooltip content by mode

| Mode | Tooltip content |
| --- | --- |
| `value`, `hardBin`, `softBin` | Die (x, y) · one line per test value (`"Idsat: 1.23 mA"` with testDefs, `"Test 1050: 1.23 mA"` without) · bins with hard/soft labels |
| `stackedValues` | Die (x, y) · test label + method + aggregated value (e.g. `"Idsat (mean): 1.23 mA"` with testDefs, `"Test 1050 (mean): 1.23 mA"` without) |
| `stackedBins` | Die (x, y) · bin number · bin name · count · percentage (e.g. "1 · Pass: 3 (75%)") |
| `stackedSoftBins` | Same as `stackedBins` but uses `sbinDefs` for name lookup |

The `aggrMethod` and `lotSize` fields on `WaferSceneOptions` populate the method label and percentage denominator respectively.

### 5.3 Axis labels

When `showAxes: true`, tick labels show die grid indices (integer i/j values). `renderWaferMap` derives `diePitchMm` automatically from the scene geometry, so axes always show grid indices. Only when calling `toCanvas` directly without supplying `diePitchMm` do axes fall back to mm values.

### 5.4 `MountOptions`

All `ToCanvasOptions` fields are accepted (`padding`, `background`, `showAxes`, etc. — see `toCanvas` options below), plus:

```ts
{
  showAxes?:               boolean            // draw axis tick marks and die grid index labels (default false)
  sceneOptions?:           WaferSceneOptions  // initial display state
  onHover?:                (die: Die | null, event: MouseEvent) => void
  onClick?:                (die: Die, event: MouseEvent) => void
  onSelect?:               (dies: Die[]) => void     // fires after box-select drag or click-select
  onSceneOptionsChange?:   (opts: WaferSceneOptions) => void  // mirrors toolbar changes
  showTooltip?:            boolean   // default true
  showToolbar?:            boolean   // default true
  toolbarControls?:        'full' | 'view-only'   // 'view-only' shows only zoom/reset/select/download
  showPlotModeSelector?:   boolean   // show the mode button in the toolbar (default true); set false when the host app manages mode switching
  legendPosition?:         'default' | 'compact' | 'left' | 'top' | 'bottom' | 'floating'
                                            // initial bin legend position (default 'default'); user can change via toolbar
                                            // 'default' auto-adapts: compact below 280 px canvas width, floating below 180 px
  statsSummary?:           StatsSummary  // precomputed wafer-level stats — adds a summary panel toggle button to the toolbar
  waferResult?:            { yield: YieldSummary; dataCoverage: { filledDies, totalDies, edgeExcludedDies, ratio } }
                                            // supplies yield and coverage data to the summary panel; when omitted those
                                            // sections are hidden. Pass result directly: waferResult: buildWaferMap(...)
  summaryPanel?:           SummaryPanelOptions  // summary panel placement and open/closed initial state
  renderTooltip?:          (die: Die) => string | HTMLElement | null
                                            // custom tooltip renderer — replaces built-in tooltip content
                                            // string → innerHTML; HTMLElement → appended; null → suppress tooltip
  minZoom?:                number    // default 0.5
  maxZoom?:                number    // default 20
  fallbackFormat?:         'si' | 'engineering'  // format for unitless values outside [0.1, 9999] (default 'engineering')
}
```

The box-select toolbar button is always shown. Providing `onSelect` lets your app react to selection changes; without it the selection is purely visual.

When `statsSummary` is provided, a summary panel toggle button (notebook icon) appears in the toolbar. The panel opens hidden by default; clicking the button shows or hides it. Clicking a finding in the panel highlights the affected die zone on the map.

#### 5.4.1 `SummaryPanelOptions`

```ts
{
  placement?:   'right' | 'left' | 'top' | 'bottom'  // panel side; default 'right'
  defaultOpen?: boolean                               // open on mount; default false
}
```

The panel's **Test Values** section shows Min/Mean/Max for each test. Test names come from `testDefs` when provided; without `testDefs` each test is labelled `Test {N}` using its testNumber. The section appears whenever dies have `testValues`, regardless of whether `testDefs` is supplied.

### 5.5 `WaferCanvasController`

```ts
{
  setDies(dies: Die[]): void                        // replace die data, rebuild scene
  setOptions(opts: Partial<WaferSceneOptions>): void // merge options, rebuild scene
  getOptions(): WaferSceneOptions                    // current options snapshot
  setSelection(dies: Die[]): void                    // programmatically highlight dies
  clearSelection(): void
  resetZoom(): void                                  // return to fitted view
  setFallbackFormat(format: 'si' | 'engineering'): void
  setStatsSummary(summary: StatsSummary | undefined): void  // update the summary panel at runtime
  getActiveLegend(): Array<{ bin: number; name: string; color: string }> | null
    // returns bin legend entries in hardBin/softBin modes; null in all other modes
  destroy(): void                                    // remove all listeners and DOM elements
}
```

### 5.6 Toolbar buttons (full mode)

| Button | Action |
| --- | --- |
| Camera | Export current view as PNG |
| Zoom region | Drag to draw a zoom rectangle |
| Pan | Drag to pan the map (default mode) |
| Box select | Draw selection rectangle — fires `onSelect` callback if provided |
| Zoom + | Zoom in centred on canvas |
| Zoom − | Zoom out centred on canvas |
| Reset | Return to fitted view (also: double-click canvas) |
| Mode | Grouped dropdown: **Test Value** section (one entry per test — labelled by `testDef.name` when provided, otherwise `Test {N}` using the testNumber; cascade submenu when > 6 tests) · **Bins** section (Hard Bin, Soft Bin) · **Lot Aggregation** section (Stacked Test Values, Stacked Hard Bins, Stacked Soft Bins). Only modes for which data is actually present are shown. |
| Palette | Dropdown: all registered colour schemes |
| Log scale | Toggle log₁₀ scale for the colorbar and value normalization. Active only in `value` / `stackedValues` modes; dimmed otherwise. Overrides the per-test `TestDef.logScale` default. Silently falls back to linear when vMin ≤ 0. |
| Colorbar range | Toggle colorbar range between **spec** (`[limitLow, limitHigh]`) and **data** (actual min/max). Only shown in `value` mode when the active testDef has at least one limit defined. Active (highlighted) = spec range; inactive = data range. Out-of-spec die coloring (blue/red) applies in both states. |
| Rings | Toggle ring boundary overlay |
| Quadrants | Toggle quadrant boundary overlay |
| Labels | Toggle die index text labels |
| Reticle | Toggle reticle field overlay — only shown when `reticles` are present |
| XY indicator | Toggle axis-orientation arrows showing +X/+Y directions |
| Legend style | Dropdown: bin legend position — **Default (right)**, **Compact (right)**, **Left**, **Top**, **Bottom**, **Floating** (draggable). Disabled when not in a bin mode. |
| Rotate | Rotate 90° clockwise (cycles 0→90→180→270) |
| Flip H | Mirror horizontally |
| Flip V | Mirror vertically |
| Findings | Toggle summary panel — only shown when `statsSummary` is provided |

### 5.7 Interactions

| Gesture | Mode | Action |
| --- | --- | --- |
| Scroll wheel | Zoom mode | Zoom in/out centred on cursor |
| Drag | Pan mode (default) | Pan the map |
| Drag | Zoom mode | Draw zoom rectangle |
| Drag | Select mode | Box-select dies |
| Click on die | Any | `onClick` callback; selects die if `onSelect` provided |
| Ctrl/Cmd+click | Any | Toggle die in/out of selection |
| Ctrl/Cmd+drag | Select mode | Additive box-select |
| Hover over die | Any | Tooltip + `onHover` callback |
| Click bin legend entry | Any | Toggle `highlightBin` — dims all non-matching bins |
| Double-click | Any | Reset to fitted view |
| Esc | Any | Clear selection |

> **Note:** zoom/rotate/flip are visual-only transforms — they never mutate the
> underlying `Die` data.  Selection stability is guaranteed: `die.x` and `die.y`
> remain unchanged regardless of display orientation.

### 5.8 Example usage

```ts
import { buildWaferMap } from '@paulrobins/wafermap';
import { renderWaferMap } from '@paulrobins/wafermap/canvas-adapter';

const { wafer, dies } = buildWaferMap({ results, waferConfig, dieConfig });

const ctrl = renderWaferMap(canvas, wafer, dies, {
  sceneOptions: { plotMode: 'hardBin', colorScheme: 'default' },
  onClick:  (die)  => console.log(die.x, die.y, die.hbin, die.sbin),
  onSelect: (dies) => console.log(`Selected ${dies.length} dies`),
  onSceneOptionsChange: (opts) => syncExternalUI(opts),
});

// Update dies after a data reload — zoom/pan preserved:
ctrl.setDies(newDies);

// Programmatically change display mode:
ctrl.setOptions({ plotMode: 'value', colorScheme: 'plasma' });

// Clean up:
ctrl.destroy();
```

---

## 6 `renderWaferGallery(container, items, options?)`

A multi-map gallery with a shared control bar, per-card view-only toolbars, and
click-to-detail modal. All cards stay in sync — changing mode, colour, rotate, or
flip in the gallery bar applies to every card instantly.

```ts
import { renderWaferGallery } from '@paulrobins/wafermap/canvas-adapter';
```

### 6.1 `GalleryItem`

```ts
{
  wafer:          Wafer
  dies:           Die[]
  label?:         string                               // card header text
  sceneOptions?:  Partial<WaferSceneOptions>           // per-card scene option overrides merged on top of shared options
  hasReticle?:    boolean                              // set true when wafer was built with ReticleConfig — shows reticle toggle in bar
  statsSummary?:  StatsSummary                         // per-wafer stats — shown in the modal's summary panel when the card is expanded
  onClick?:       (die: Die, event: MouseEvent) => void
  onSelect?:      (dies: Die[]) => void
}
```

Pass `result.reticles` via `sceneOptions.reticles` when `hasReticle` is `true` so the overlay has geometry to draw.

### 6.2 `GalleryOptions`

```ts
{
  sceneOptions?:           WaferSceneOptions  // initial shared state
  onSceneOptionsChange?:   (opts: WaferSceneOptions) => void
  legendPosition?:         'default' | 'compact' | 'left' | 'top' | 'bottom' | 'floating'
                                            // initial bin legend position for all cards (default 'default'); user can change via gallery bar
                                            // 'default' auto-adapts: compact below 280 px card width, floating below 180 px
  cardPadding?:            number             // CSS-px padding inside each card canvas (default 6)
  downloadFilename?:       string             // stem for the composite PNG filename (default 'wafer-gallery')
  fallbackFormat?:         'si' | 'engineering'  // format for unitless values outside [0.1, 9999] (default 'engineering')
  showPlotModeSelector?:   boolean           // show the mode dropdown in the gallery bar (default true)
  lotStatsSummary?:        LotStatsSummary   // precomputed lot-level stats — adds a summary panel toggle button to the control bar
}
```

### 6.3 `GalleryController`

```ts
{
  setItems(items: GalleryItem[]): void               // rebuild all cards
  setOptions(opts: Partial<WaferSceneOptions>): void // sync shared options to all cards
  getOptions(): WaferSceneOptions
  setFallbackFormat(format: 'si' | 'engineering'): void
  setLotStatsSummary(summary: LotStatsSummary | undefined): void  // update the lot summary panel at runtime
  destroy(): void
}
```

### 6.4 Gallery control bar

| Button | Action |
| --- | --- |
| Mode | Dropdown: plot mode for all cards |
| Palette | Dropdown: colour scheme for all cards |
| Log scale | Toggle log₁₀ scale for all cards. Active only in `value` / `stackedValues` modes; dimmed otherwise. |
| Rings | Toggle ring boundaries on all cards |
| Quadrants | Toggle quadrant boundaries on all cards |
| Labels | Toggle die labels on all cards |
| Reticle | Toggle reticle overlay on all cards — only shown when at least one item has `hasReticle: true` |
| XY indicator | Toggle axis-orientation arrows on all cards |
| Legend style | Dropdown: bin legend position for all cards — **Default (right)**, **Compact (right)**, **Left**, **Top**, **Bottom**, **Floating**. Disabled when not in a bin mode. |
| Rotate | Rotate all cards 90° clockwise |
| Flip H | Flip all cards horizontally |
| Flip V | Flip all cards vertically |
| Download gallery | Composite PNG of all cards at full HiDPI resolution |
| Findings | Toggle lot summary panel — only shown when `lotStatsSummary` is provided |

Per-card toolbars show only: box-select (when `onSelect` provided), zoom +/−, reset, download.

### 6.5 Lot summary panel

When `lotStatsSummary` is provided, a summary panel toggle button appears in the control bar. The panel is hidden by default; clicking the button shows or hides it alongside the card grid. The panel shows lot-level yield, bin breakdown, ring and quadrant yield aggregated across all wafers, test value statistics (labelled by `testDef.name` or `Test {N}` when `testDefs` is absent), and findings grouped by severity: **Unusual** → **Notable** → **Informational**.

Clicking a finding highlights the affected area:

- **Repeated-pattern findings** (e.g. ring or quadrant patterns seen across multiple wafers) — outlines the affected cards and highlights the matching die zone on each
- **Inter-wafer yield outliers** — outlines the outlier card(s)

Clicking the active finding again clears the highlight. Opening a card modal while a finding is active passes through the card's `statsSummary` so the modal's own per-wafer summary panel is also available.

### 6.6 Click-to-detail modal

Each card header contains an expand button (↗).  Clicking it opens a full-screen
modal with `renderWaferMap` mounted at full resolution and with the complete
toolbar.  Shared scene options are passed through so the modal opens in the same
display state as the gallery.  Close with Esc, the × button, or clicking the
backdrop.

### 6.7 Shared bin legend

For `hardBin` and `softBin` modes a shared legend strip is rendered between the
control bar and the card grid — one coloured swatch + label per unique bin across
all items. The legend is hidden for `value`, `stackedValues`, `stackedBins`, and `stackedSoftBins`
(those modes use a per-card colorbar instead).

When `hbinDefs` or `sbinDefs` are provided via `sceneOptions`, the legend uses the
correct definition array for the active mode — `hbinDefs` for hardBin, `sbinDefs`
for softBin. Because hard and soft bin number spaces are independent (STDF V4: both
0–32767), the two arrays are kept separate and never merged.

Clicking a bin entry calls `setOptions({ highlightBin: bin })`, which dims all
non-matching bins on every card simultaneously. Clicking the active entry clears
the highlight. The active entry is indicated with a bold label and a blue swatch
border. The legend rebuilds automatically whenever the mode, colour scheme, or
highlight changes.

### 6.8 Stacked modes

The toolbar includes three lot-aggregation modes: **Stacked Hard Bins**,
**Stacked Soft Bins**, and **Stacked Test Values**.  The gallery handles
aggregation internally. 

If `hbinDefs`, `sbinDefs`, or `testDefs` are omitted from `sceneOptions`, the gallery 
automatically discovers unique values from the input dies to generate the cards and legend.

- **`stackedBins` / `stackedSoftBins`** — one card per bin; each die shows the
  count of wafers on which that bin appeared at that position.
- **`stackedValues`** — one card per test parameter; each die shows the lot
  aggregate (mean by default) of that parameter.  The aggregation method is
  `sharedOpts.aggrMethod` (default `'mean'`); change it with
  `ctrl.setOptions({ aggrMethod: 'median' })`.

Switching to a stacked mode rebuilds the cards; switching back restores the
original per-wafer cards.  `ctrl.setItems(newItems)` always accepts per-wafer
items — the gallery re-aggregates automatically if a stacked mode is active.

### 6.9 Gallery example

```ts
import { buildWaferMap } from '@paulrobins/wafermap';
import { renderWaferGallery } from '@paulrobins/wafermap/canvas-adapter';

const items = waferIds.map(id => ({
  wafer: sharedWafer,
  dies:  diesByWafer[id],
  label: id,
  onClick:  (die) => showDieDetail(die, id),
  onSelect: (selected) => showSelectionPanel(id, selected),
}));

const ctrl = renderWaferGallery(document.getElementById('gallery'), items, {
  sceneOptions: { plotMode: 'hardBin', hbinDefs, sbinDefs, testDefs },
  onSceneOptionsChange: (opts) => syncSidebarControls(opts),
  downloadFilename: 'lot-overview',
});

// Rebuild after wafer selection changes:
ctrl.setItems(newItems);

// Sync from external control:
ctrl.setOptions({ plotMode: 'value' });

// Clean up:
ctrl.destroy();
```

---

## 7 Statistics / Findings Engine

Detects statistically significant spatial patterns in wafer test data — yield loss, bin accumulation, or test value shifts concentrated in specific rings, quadrants, reticle positions, or individual wafers.

```ts
import { analyzeWaferMap, analyzeWaferLot } from '@paulrobins/wafermap/stats';
```

### 7.1 `analyzeWaferMap(input, options?)`

Analyses a single wafer and returns a `StatsSummary`.  Accepts either a `WaferMapInput` object or the `WaferMapResult` returned by `buildWaferMap`.

```ts
const result = buildWaferMap({ results, waferConfig, dieConfig, passBins: [1] });
const summary = analyzeWaferMap(result, { ringCount: 4 });
```

### 7.2 `analyzeWaferLot(items, options?)`

Analyses an array of wafers and returns a `LotStatsSummary`.  Each element is a `WaferMapInput` or `WaferMapResult`.  In addition to per-wafer findings, the lot summary includes:

- **Repeated-pattern findings** — patterns present on ≥ 2 wafers
- **Inter-wafer yield outliers** — wafers whose yield is a statistical outlier within the lot

```ts
const lotSummary = analyzeWaferLot(waferResults, { ringCount: 4 });
```

### 7.3 `AnalyzeWaferMapOptions`

```ts
{
  ringCount?:                    number   // ring count for spatial analysis; should match renderer ringCount (default 4)
  passBins?:                     number[] // bins counted as pass; defaults to WaferMapInput.passBins, then [1]
  significanceLevel?:            number   // adjusted p-value threshold (default 0.05)
  minimumEffectSize?:            number   // minimum |delta| or Cohen's d to report (default 0.15)
  minimumSampleSize?:            number   // minimum dies per region to test (default 5)
  includePartial?:               boolean  // include partial dies in analysis (default false)
  includeEdgeExcluded?:          boolean  // include edge-excluded dies (default false)
  enableYieldAnalysis?:          boolean  // default true
  enableHardBinAnalysis?:        boolean  // default true
  enableSoftBinAnalysis?:        boolean  // default true
  enableTestValueAnalysis?:      boolean  // default true
  enableReticlePositionAnalysis?: boolean // default true (only runs when reticleConfig is present)
  testNumbers?:                  number[] // restrict test-value analysis to these test numbers (keys from testValues)
                                          // when omitted: all tests analysed, up to 100 — beyond that a console.warn
                                          // fires and test-value analysis is skipped (pass testNumbers to override)
}
```

Both `analyzeWaferMap` and `analyzeWaferLot` accept `AnalyzeWaferMapOptions`.

### 7.3.1 Statistical rules & thresholds

- Default thresholds and behaviour (these are the library defaults):
  - significanceLevel: 0.05 (adjusted p-value after per-family correction)
  - minimumEffectSize: 0.15 (absolute proportion delta for yield/bin, or Cohen-like d for tests)
  - minimumSampleSize: 5 (minimum dies per region to consider a test)
  - passBins: defaults to [1]

- Tests implemented by the engine:
  - Yield / bin proportions: two-proportion z-test (per-region vs. rest of wafer)
  - Test-value comparisons: Welch-style t (z-approx) with pooled SD → effect size estimate

- Multiple comparisons: p-values are adjusted per variable-family using a Benjamini–Hochberg style FDR procedure (grouping key: `variable.kind` + `comparison.family`). Only findings that pass both the adjusted p-value and the minimumEffectSize are emitted.

- Severity mapping (how the `severity` field is derived):
  - `unusual`: adjusted p ≤ 0.01 and large effect (proportion delta ≥ 0.25 or effect size ≥ 0.5)
  - `notable`: adjusted p ≤ 0.05 and moderate effect (proportion delta ≥ 0.15 or effect size ≥ 0.15)
  - `info`: all others

- Behavioural notes:
  - Reticle-position analysis is enabled by default but only runs when a `reticleConfig` is present in the scene.
  - Test-value analysis is auto-skipped if the data contains more than 100 distinct tests unless `testNumbers` is provided. A warning is emitted via `console.warn` and also surfaced in `summary.stats.warnings[]` for programmatic inspection.

### 7.4 `StatsSummary`

```ts
{
  level: 'wafer'
  hasNotableFindings: boolean          // true when any finding is 'notable' or 'unusual'
  findings: StatsFinding[]
  wafer?: Record<string, unknown>      // identity fields from waferConfig.metadata (lot, wafer ID, test date, etc.)
  stats: {
    totalDies:            number
    analyzedDies:         number
    excludedDies:         number
    yieldPercent:         number | null
    testsConsidered:      number[]     // test numbers (keys from testValues) that had enough data
    hardBinsConsidered:   number[]
    softBinsConsidered:   number[]
    warnings?:            string[]     // structured warnings, e.g. test-count cap exceeded
    testSpecYield?: Array<{            // one entry per testDef that has at least one limit; absent when no testDefs with limits
      testNumber:   number
      label:        string            // testDef.name
      passDies:     number            // dies with value within [limitLow, limitHigh]
      failLowDies:  number            // dies with value < limitLow (0 when limitLow absent)
      failHighDies: number            // dies with value > limitHigh (0 when limitHigh absent)
      totalDies:    number            // dies that had a value for this test
      yieldPercent: number | null     // passDies / totalDies; null when totalDies = 0
    }>
  }
}
```

### 7.5 `LotStatsSummary`

```ts
{
  level: 'lot'
  hasNotableFindings: boolean
  findings: StatsFinding[]             // lot-level findings (repeated patterns + inter-wafer outliers)
  lot?: Record<string, unknown>        // shared identity fields from first wafer (lot ID, product, etc. — wafer-specific keys excluded)
  stats: {
    waferCount: number
  }
  lotYieldSeries: Array<{
    waferIndex:   number
    yieldPercent: number | null        // null when a wafer had no bin data
  }>
  perWafer: Array<{
    waferIndex: number
    summary: StatsSummary              // per-wafer findings
  }>
}
```

### 7.6 `renderFindingsReportHtml` / `openHtmlReport`

```ts
import { renderFindingsReportHtml, openHtmlReport } from 'wafermap/stats';

const html = renderFindingsReportHtml(summary, { title?: string }): string
openHtmlReport(html): void
```

Generates a standalone printable HTML **findings-only** report from a `StatsSummary` or `LotStatsSummary`. Includes wafer/lot identity fields, yield and die count stats, and a severity-coded findings table. `openHtmlReport` opens the HTML string in a new browser tab for printing or saving as PDF.

### 7.7 `renderSummaryReportHtml`

```ts
import { renderSummaryReportHtml } from 'wafermap/stats';

const html = renderSummaryReportHtml(params, { title?: string }): string
```

Generates a standalone printable HTML **full summary report** — a snapshot of everything shown in the summary panel: metadata, yield, bin breakdown, ring yield, quadrant yield, test value statistics (min/mean/median/stddev/max per test, labelled by `testDef.name` or `Test {N}` when `testDefs` is absent), and findings. Suitable for printing or saving as PDF via `openHtmlReport(html)`.

```ts
// Params mirror renderWaferSummaryContent (minus DOM callbacks):
{
  wafer:        Wafer;
  dies:         Die[];
  yieldSummary: YieldSummary;
  dataCoverage: { filledDies, totalDies, edgeExcludedDies, ratio };
  hbinDefs?:    BinDef[];
  sbinDefs?:    BinDef[];
  testDefs?:    TestDef[];
  statsSummary?: StatsSummary;
  passBins?:    number[];   // default [1]
  ringCount?:   number;     // default 4
}
```

The summary panel's "Summary report" button calls this automatically when `statsSummary` is provided.

### 7.8 `StatsFinding`

```ts
{
  id:       string          // stable identifier for this finding
  level:    'wafer' | 'lot' | 'inter-wafer'
  severity: 'unusual' | 'notable' | 'info'
  variable: {
    kind:   'yield' | 'hardBin' | 'softBin' | 'test'
    index?: number          // test number — the key from testValues (for 'test' kind)
    bin?:   number          // bin value (for 'hardBin'/'softBin' kind)
    label:  string          // human-readable name
    unit?:  string
  }
  comparison: {
    family: 'ring' | 'quadrant' | 'reticle-position' | 'wafer'
    left:   string          // e.g. "Ring 3 (edge)", "NE", "Reticle cell (1, 0)"
    right:  string          // typically "Rest of wafer" or "Lot median"
  }
  effect: {
    direction:      'higher' | 'lower' | 'different'
    absoluteDelta?: number
    relativeDelta?: number
    effectSize?:    number
  }
  stats: {
    method:            string
    pValue?:           number
    adjustedPValue?:   number
    sampleSizeLeft:    number
    sampleSizeRight:   number
  }
  summary:   string         // one-sentence human-readable description
  highlight: HighlightTarget
}
```

### 7.9 `HighlightTarget`

Describes what to visually emphasise when a finding is selected.

```ts
type HighlightTarget =
  | { kind: 'region';  regionFamily: string; keys: string[]; dieKeys?: string[] }
  | { kind: 'bin';     bin: number; regionKeys?: string[]; dieKeys?: string[] }
  | { kind: 'wafer';   waferIndices: number[] }
  | { kind: 'dies';    dieKeys: string[] }
```

`dieKeys` entries use the `"x,y"` format returned by `getDieKey`.

### 7.10 Integrating with `renderWaferMap` and `renderWaferGallery`

```ts
import { buildWaferMap } from '@paulrobins/wafermap';
import { renderWaferMap, renderWaferGallery } from '@paulrobins/wafermap/canvas-adapter';
import { analyzeWaferMap, analyzeWaferLot } from '@paulrobins/wafermap/stats';

// Single wafer with summary panel toggle:
const result  = buildWaferMap({ results, waferConfig, dieConfig, passBins: [1] });
const summary = analyzeWaferMap(result, { ringCount: 4 });
renderWaferMap(canvas, result.wafer, result.dies, { statsSummary: summary });

// Lot gallery with lot-level summary panel toggle:
const waferResults = waferDataSets.map(d => buildWaferMap(d));
const items = waferResults.map((r, i) => ({
  wafer:         r.wafer,
  dies:          r.dies,
  label:         `Wafer ${i + 1}`,
  hasReticle:    r.reticles.length > 0,
  sceneOptions:  { reticles: r.reticles },
  statsSummary:  analyzeWaferMap(r, { ringCount: 4 }),
}));
const lotSummary = analyzeWaferLot(waferResults, { ringCount: 4 });
renderWaferGallery(container, items, { lotStatsSummary: lotSummary });
```

### 7.11 `filterFindings(source, filter)`

Filters findings from a `StatsSummary` or `LotStatsSummary` by any combination of severity, kind, family, and level. All criteria are ANDed; each accepts a single value or an array.

```ts
import { filterFindings } from '@paulrobins/wafermap/stats';

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

---

## 8 Web Worker

For large datasets, `buildWaferMap` can be moved off the main thread to keep the
UI responsive.  The `wafermap/worker` subpackage provides a thin wrapper around a
pre-built worker script.

**When to use it:** datasets with ~10,000+ rows, or many wafers processed at once.
For small fixed datasets the overhead is not worth it.  `renderWaferMap` and `renderWaferGallery`
are fast rendering operations and always run on the main thread regardless.

### 8.1 Setup

```ts
import { createWafermapWorker } from '@paulrobins/wafermap/worker';

// Bundler (Vite, webpack…) — import the worker script URL
import workerUrl from '@paulrobins/wafermap/worker-script?url';
const worker = createWafermapWorker(new Worker(workerUrl, { type: 'module' }));

// Plain HTML / CDN
const worker = createWafermapWorker(
  new Worker('https://cdn.jsdelivr.net/npm/@paulrobins/wafermap/dist/packages/worker/wafermap.worker.js', { type: 'module' })
);
```

Create the worker once and reuse it for all calls.

### 8.2 `createWafermapWorker(worker)`

Returns a `WafermapWorker`:

```ts
{
  run(input: WaferMapInput): Promise<WaferMapResult>
  terminate(): void
}
```

### 8.3 `worker.run(input)`

Identical input and output to `buildWaferMap` — just async.

```ts
// Replaces:
const { wafer, dies } = buildWaferMap({ results, waferConfig, dieConfig });

// With:
const { wafer, dies } = await worker.run({ results, waferConfig, dieConfig });

// Everything after is unchanged:
renderWaferMap(canvas, wafer, dies);
```

Multiple concurrent calls are safe — each resolves independently.  Run wafers in parallel with `Promise.all`:

```ts
const results = await Promise.all(
  waferIds.map(id => worker.run({ results: dataByWafer[id], dieConfig }))
);
```

### 8.4 `worker.terminate()`

Shuts down the underlying worker.  Any in-flight `run()` calls reject immediately.

---

## 9 Optional compatibility APIs

These APIs give you direct control over the rendering pipeline. Use them when you
need to integrate with your own rendering loop, build a custom gallery, or export
through Plotly. For most application development, prefer `renderWaferMap` and
`renderWaferGallery` above.

### 9.1 `toPlotly(scene, options?)`

Converts a scene into Plotly-compatible `{ data, layout }`.

Plotly.js must be loaded separately, because the core package does not include a
runtime Plotly dependency.

```ts
import { buildWaferMap, toPlotly } from '@paulrobins/wafermap';

const result = buildWaferMap({ results, waferConfig, dieConfig });
const { data, layout } = toPlotly(result.scene);
Plotly.react('chart', data, layout, { responsive: true });
```

```ts
interface ToPlotlyOptions {
  showAxes?:          boolean                    // show X/Y axis tick marks and labels (default false)
  showPhysicalUnits?: boolean                    // append "(mm)" to axis titles (default false)
  showColorbar?:      boolean                    // show the continuous-value colorbar (default true)
  diePitchMm?:        { x: number; y: number }  // show die grid indices on axis ticks
  axisLabels?:        { x?: string; y?: string }
}
```

**Connecting click drill-down:**

```ts
import { getDieAtPoint } from '@paulrobins/wafermap';

document.getElementById('chart').on('plotly_click', (ev) => {
  const die = getDieAtPoint(result.scene, ev);
  if (die) console.log(die.x, die.y, die.values, die.hbin, die.sbin);
});
```

### 9.2 `toCanvas(canvas, scene, options?)`

Renders a scene directly onto an HTML `<canvas>` element using the 2D Canvas API.
No toolbar is provided — this is a one-shot draw call.

```ts
import { toCanvas } from '@paulrobins/wafermap/canvas-adapter';
```

```ts
interface ToCanvasOptions {
  padding?:         number    // CSS-px padding inside canvas edge (default 16)
  showColorbar?:    boolean   // draw colorbar / bin legend (default true)
  colorbarWidth?:   number    // CSS-px width of the colorbar strip (default 16)
  background?:      string    // canvas background colour (default '#f5f5f5')
  showAxes?:        boolean   // draw axis tick marks and labels (default false)
  diePitchMm?:      { x: number; y: number }  // when provided, axis labels show die grid indices; otherwise mm values
  fallbackFormat?:  'si' | 'engineering'  // format for unitless values outside [0.1, 9999] (default 'engineering')
}
```

**Legend behaviour by plot mode:**

| Mode | Right-side legend |
| --- | --- |
| `value`, `stackedValues` | Continuous colorbar (gradient strip with min/max ticks). Axis label is `testDef.name` (e.g. `"Idsat (mA)"`), or `Test {N}` when no `testDefs` are supplied. |
| `stackedBins`, `stackedSoftBins` | Continuous colorbar; axis labelled "Count". |
| `hardBin`, `softBin` | Bin legend: one swatch + label per unique bin; overflows show `"+ N more"` |

Returns `{ hitTarget, viewport, binLegendRows }`:

- `hitTarget.getDieAtPoint(x, y): Die | null` — hit-test a CSS-pixel position
- `viewport` — the auto-fitted viewport transform (useful as initial state for custom zoom/pan)
- `binLegendRows` — `{ bin, y, h }[]` for hit-testing legend row clicks (non-empty for hardBin/softBin)

```ts
const result  = buildWaferMap({ results, waferConfig, dieConfig });
const scene   = buildScene(result.wafer, result.dies, { plotMode: 'hardBin' });
const { hitTarget } = toCanvas(canvas, scene);

canvas.addEventListener('mousemove', e => {
  const r   = canvas.getBoundingClientRect();
  const die = hitTarget.getDieAtPoint(e.clientX - r.left, e.clientY - r.top);
  if (die) showTooltip(die);
});
```

`toCanvas` reads `window.devicePixelRatio` automatically and snaps canvas dimensions to integer CSS pixels to prevent sub-pixel interpolation blur.  Set canvas size in CSS only; do not set `canvas.width`/`canvas.height` directly.

`renderWaferMap` additionally watches for `devicePixelRatio` changes (browser zoom, moving between displays) via a `matchMedia` listener and re-renders automatically.

---

## 10 Package surface

```ts
import { buildWaferMap }                       from '@paulrobins/wafermap';
import { renderWaferMap, renderWaferGallery }  from '@paulrobins/wafermap/canvas-adapter';
import { toPlotly }                            from '@paulrobins/wafermap';
import { analyzeWaferMap, analyzeWaferLot }    from '@paulrobins/wafermap/stats';
import { createWafermapWorker }                from '@paulrobins/wafermap/worker';
```

### 10.1 Helper exports

```ts
import { getDieKey, getDieAtPoint, getDieTestValue } from '@paulrobins/wafermap';
```

`getDieKey(die)` — returns a stable `"x,y"` string for map lookups (see manual pipeline section below for details).

`getDieAtPoint(scene, event)` — hit-tests a Plotly event against the scene (see manual pipeline section below).

`getDieTestValue(die, testNumber, fallbackIndex?)` — reads a test value from a die by test number:

```ts
// Preferred — reads from die.testValues
const idsat = getDieTestValue(die, 1050);

// Deprecated path — reads from die.values by position (fallback)
const v = getDieTestValue(die, 0, 0);
```

Returns `undefined` when no value is present.  Use this in post-build code that reads test values from dies.

Available subpath exports: `@paulrobins/wafermap`, `/core`, `/renderer`, `/plotly-adapter`, `/canvas-adapter`, `/stats`, `/worker`, `/worker-script`

---

## 11 Advanced / Manual Pipeline

For full control over each pipeline stage, use the low-level functions directly.
These are the building blocks that `buildWaferMap` uses internally.

The [Advanced pipeline demo](examples/18-pipeline.html) is the reference for this path. Prefer `buildWaferMap` for all other use cases.

```text
createWafer(spec)
  → generateDies(wafer, dieSpec)
  → clipDiesToWafer(dies, wafer, dieSpec)
  → [attach values / hbin / sbin / metadata to each die, keyed by die.x, die.y]
  → applyProbeSequence(dies, config)              // optional
  → applyOrientation(dies, wafer)
  ↓  (on each redraw)
  → transformDies(dies, interactiveTransform, wafer.center)
  → buildScene(wafer, dies, options)   → Scene
  → toPlotly(scene)  or  toCanvas(canvas, scene)
```

In the manual pipeline, `die.x` and `die.y` are computed by `generateDies` as
integer grid indices centred at the wafer origin.

### 11.1 `createWafer(spec)`

Creates a wafer model.  `diameter` is required.  Accepts a `WaferSpec`:

```ts
{
  diameter:     number                     // required
  center?:      { x: number; y: number }   // mm, default {0, 0}
  notch?:       { type: 'top' | 'bottom' | 'left' | 'right' }
  orientation?: number                     // degrees CCW, default 0
  metadata?:    WaferMetadata
}
```

Returns `Wafer` with `diameter`, `radius`, `center`, `notch` (with computed `length`), `orientation`, `metadata`.

---

### 11.2 `generateDies(wafer, spec)`

Creates a rectangular die grid centred on the wafer.  Accepts a `DieSpec`:

```ts
{
  width:     number   // required
  height:    number   // required
  gridSize?: number
  offset?:   { x: number; y: number }
}
```

Returns `Die[]` with `id`, `x` (grid), `y` (grid), `physX` (mm), `physY` (mm), `width`, `height`.

---

### 11.3 `clipDiesToWafer(dies, wafer, spec?)`

Clips dies to the wafer boundary (circle + optional notch/flat exclusion zone).

- Removes dies entirely outside the wafer.
- Sets `insideWafer: true` on included dies.
- Sets `partial: true` on dies that straddle the boundary (requires `spec` for 4-corner test).

---

### 11.4 `isInsideWafer(x, y, wafer)`

Returns `true` when the point (x, y) falls inside the wafer boundary.

---

### 11.5 `mapDataToDies(dies, data, options)`

Maps row data onto dies, attaching `values` and/or bin fields.

```ts
{
  matchBy:     'xy' | 'ij'
  valueField?: string
  binField?:   string
}
```

---

### 11.6 `applyOrientation(dies, wafer)`

Rotates die coordinates by `wafer.orientation` around `wafer.center`.

---

### 11.7 `transformDies(dies, options, center?)`

Applies interactive display transforms (rotation + flip) around `center`.

```ts
{
  rotation?: number
  flipX?:    boolean
  flipY?:    boolean
}
```

---

### 11.8 `applyProbeSequence(dies, config)`

Assigns `probeIndex` to dies in the requested order.

Supported strategies: `'row'`, `'column'`, `'snake'`, `'custom'`
(for `'custom'` provide `customOrder: string[]` of die IDs).

---

### 11.9 `generateReticleGrid(wafer, spec)`

Generates reticle rectangles covering the wafer area.  Accepts a `ReticleSpec`:

```ts
{
  width:       number
  height:      number
  diePitchX:   number
  diePitchY:   number
  anchorDie?:  { x: number; y: number }
}
```

> Via `buildWaferMap`, pass `reticleConfig: ReticleConfig` instead — pitch is wired through automatically.

---

### 11.10 `classifyDie(die, wafer, options?)`

Returns `{ ring: number; quadrant: 'NE' | 'NW' | 'SW' | 'SE' }`.

`ring` runs 1 (innermost) to `ringCount` (edge, default 4).

---

### 11.11 `getRingLabel(ring, ringCount)`

Returns a human-readable label for a ring index.

---

### 11.12 `getUniqueBins(dies, binSpace?)`

Returns all distinct bin values, sorted ascending.

`binSpace?: 'hard' | 'soft'` — selects which field to read (`'hard'` reads `die.hbin`, `'soft'` reads `die.sbin`; default `'hard'`).

---

### 11.13 `aggregateBinCounts(diesByWafer, targetBin, binSpace?)`

Stacks multiple wafers and counts, per die position, how many wafers had a specific bin value.

Returns one `Die` per unique `(x, y)` with `testValues[0]` = count, and `hbin: targetBin` (for `'hard'`) or `sbin: targetBin` (for `'soft'`).

- Pass `binSpace: 'hard'` (default) for hard bins → use with `plotMode: 'stackedBins'`
- Pass `binSpace: 'soft'` for soft bins → use with `plotMode: 'stackedSoftBins'`

Set `valueRange: [0, diesByWafer.length]` and `lotSize: diesByWafer.length` for correct colorbar and percentage tooltips.

---

### 11.14 `aggregateValues(diesByWafer, method, paramIndex?)`

`method` = `'mean' | 'median' | 'stddev' | 'min' | 'max' | 'count'`

`paramIndex` — the `testValues` key to read from each source die (e.g. a `testNumber` like `1050`). Defaults to `0`.

Returns one `Die` per unique `(x, y)` with the aggregated scalar stored at `testValues[0]`, ready for `buildScene` in `stackedValues` mode.

---

### 11.15 `buildScene(wafer, dies, options?)`

Builds the renderer-agnostic scene.

```ts
interface SceneOptions {
  plotMode?:               'value' | 'hardBin' | 'softBin' | 'stackedValues' | 'stackedBins' | 'stackedSoftBins' | 'specLimit'
  showText?:               boolean
  showReticle?:            boolean
  showProbePath?:          boolean
  showRingBoundaries?:     boolean
  showQuadrantBoundaries?: boolean
  showXYIndicator?:        boolean
  ringCount?:              number    // default 4
  dieGap?:                 number    // visual kerf gap in mm, default 1
  colorScheme?:            string    // default 'default'
  highlightBin?:           number
  valueRange?:             [number, number]
  interactiveTransform?:   { rotation?: number; flipX?: boolean; flipY?: boolean }
  reticles?:               Reticle[]
  testDefs?:               TestDef[]   // named test definitions — drives mode dropdown and tooltip labels
  hbinDefs?:               BinDef[]    // named hard bin definitions (hbin, 0–32767 space)
  sbinDefs?:               BinDef[]    // named soft bin definitions (sbin, 0–32767 space — independent)
  testIndex?:              number      // which values[] slot to display in 'value' mode; default 0
  logScale?:               boolean     // override log₁₀ scale for the active test; takes precedence over TestDef.logScale
  colorbarRangeMode?:      'spec' | 'data'  // default 'spec' when active testDef has limits: colorbar spans [limitLow, limitHigh]
                                            // 'data' spans actual data min/max; out-of-spec coloring applies in both modes
  aggrMethod?:             string      // aggregation method label for 'stackedValues' hover tooltips (e.g. 'mean', 'median')
  lotSize?:                number      // total wafers in lot — for 'stackedBins'/'stackedSoftBins' hover percentage computation
}
```

Returns `Scene` with `rectangles`, `texts`, `hoverPoints`, `overlays`, `plotMode`, `colorScheme`, `metadata`, `dies`, `valueRange`, `testDefs`, `hbinDefs`, `sbinDefs`, `testIndex`, `logScale`, `aggrMethod`, `lotSize`.

---

### 11.16 `getDieKey(die)`

Returns a stable string key `"x,y"` for a die.  Always prefer this over ad-hoc template literals.

```ts
const map = new Map(result.dies.map(d => [getDieKey(d), d]));
const die = map.get(getDieKey({ x: 3, y: -2 }));
```

---

### 11.17 `getDieAtPoint(scene, plotlyEvent)`

Returns the die that a Plotly click or hover event points to, or `null`.

```ts
chart.on('plotly_click', ev => {
  const die = getDieAtPoint(scene, ev);
  if (die) console.log(die.x, die.y, die.values, die.hbin, die.sbin);
});
```

---

### 11.18 Color helpers

| Function | Description |
| -------- | ----------- |
| `hardBinColor(bin)` | Categorical colour for hard bin 0–14 |
| `hardBinGreyscale(bin)` | Greyscale variant |
| `softBinColor(bin, maxBin?)` | Maps bin to Viridis position |
| `valueToViridis(t)` | Maps `t ∈ [0,1]` to Viridis RGB string |
| `valueToGreyscale(t)` | Maps `t ∈ [0,1]` to grey RGB string |
| `contrastTextColor(cssColor)` | Returns `'#000000'` or `'#ffffff'` for WCAG contrast |

---

## 12 Important types

### 12.1 `Die`

```ts
{
  id:            string
  x:             number    // die grid X position — prober step coordinate (equals input x for centred grids)
  y:             number    // die grid Y position — prober step coordinate (equals input y for centred grids)
  physX:         number    // physical X in mm (or normalized units)
  physY:         number    // physical Y in mm (or normalized units)
  width:         number    // die width in mm (or normalized units)
  height:        number    // die height in mm (or normalized units)
  testValues?:   Record<number, number>  // test measurements keyed by test number
  values?:       number[]  // @deprecated: use testValues
  hbin?:         number    // hard bin (physical sort result; STDF V4 range 0–32767)
  sbin?:         number    // soft bin (test-program failure category; independent 0–32767 space)
  metadata?:     DieMetadata
  insideWafer?:  boolean
  partial?:      boolean   // straddles the wafer boundary
  edgeExcluded?: boolean   // centre falls within the edge exclusion zone
  probeIndex?:   number
  retestCount?:  number    // set when this position appeared more than once in input results
}
```

### 12.2 `Wafer`

```ts
{
  diameter:    number
  radius:      number
  center:      { x: number; y: number }
  notch?:      { type: 'top' | 'bottom' | 'left' | 'right'; length: number }
               // length = standard chord/half-width in mm, derived from diameter
  orientation: number
  metadata?:   WaferMetadata
}
```

### 12.3 `WaferMetadata`

Common named fields with an open index signature — any extra fields are accepted:

```ts
{
  lot?:         string
  waferId?:     string | number
  product?:     string
  testDate?:    string          // ISO 8601 recommended, e.g. "2026-04-23T08:30:00Z"
  operator?:    string
  testProgram?: string
  temperature?: number          // chuck temperature in °C
  [key: string]: unknown        // any additional fields accepted
}
// e.g. { lot: 'LOT123', waferId: 1, testDate: '2026-04-23', temperature: 25 }
```

### 12.4 `DieMetadata`

```ts
{
  lotId?:        string
  waferId?:      string
  deviceType?:   string
  testProgram?:  string
  temperature?:  number
  customFields?: Record<string, unknown>
  [key: string]: unknown
}
```

---

## 13 Current limitations

- Ring segmentation uses equal-width radial bands.  Configurable breakpoints are planned.
- Plotly types are not exposed as formal peer-typed interfaces.
