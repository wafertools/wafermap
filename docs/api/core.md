# API Reference — `buildWaferMap` — the data layer

**Part of the [API Reference](../api.md).**

## 4 `buildWaferMap(input)`

The primary entry point.  Pass whatever data you have — prober step positions,
optional geometry hints, or a pre-built die array.  The function infers whatever
is missing and returns a fully constructed wafer model.

> **Inference reads geometry from the extent of the data.** When you supply only
> die positions, the wafer diameter and centre are derived from how far the data
> reaches.  This is correct whenever the data reaches the true wafer edge — a
> fully-populated wafer, or a **sparse** one (skip-sampled or randomly sampled
> positions missing across the whole face).  It is **wrong for *partial* data** —
> a contiguous region such as a half wafer, a single quadrant, or an off-centre
> cluster — because the extent stops short of the true edge, so the region is
> mistaken for a smaller full wafer and mis-centred.  For partial data supply
> `waferConfig.diameter` **and** `waferConfig.center` — see
> [§4.3 Inference levels](#43-inference-levels).  When the library detects
> likely-partial coverage with no anchor, it adds a structured warning to
> `result.warnings` (code `'partial-coverage'`).

**Server-safe:** `buildWaferMap` is a pure function with no DOM access or side
effects.  It can run in Node.js, Deno, a Web Worker, or any server-side environment.

```ts
import { buildWaferMap } from '@wafertools/wafermap';
```

### 4.1 Input

`buildWaferMap` accepts either an array of data points or an object. They are equivalent when no extra options are needed — the array form is just shorthand for `{ results: [...] }`:

```ts
// Array form — shorthand, equivalent to passing { results }
buildWaferMap(results: DieResult[])

// Object form — use when you need geometry hints or other options.
// WaferMapInput is a union: pass either results OR lotStack, never both.
buildWaferMap(input: WaferMapInput)
```

`WaferMapInput` is a discriminated union:

```ts
// Shared base (WaferMapInputBase) — all fields are optional:
type WaferMapInputBase = {
  waferConfig?:      WaferConfig,      // physical wafer geometry (diameter, notch, orientation…)
  dieConfig?:        DieConfig,        // die size and coordinate conventions
  dies?:             Die[],            // pre-built die array; skips geometry generation
  reticleConfig?:    ReticleConfig,    // stepper field grid overlay
  passBins?:         number[],         // bins that pass (default [1]) — carried on the result as result.passBins
  valueFilter?:      'validity' | 'spec' | 'test' | 'none', // which limit set a test value must lie inside to be used (default 'validity') — §4.1.14
  ringCount?:        number,           // rings for ring overlays, ring yield and ring findings (default 4) — carried as result.ringCount
  retestPolicy?:     'last' | 'first' | 'best' | 'worst', // how to handle multiple results at the same (x,y); default 'last'
  edgeDieYieldMode?: 'exclude' | 'denominator-only', // default 'exclude'
  testDefs?:         TestDef[],        // named test definitions — one per testValues entry
  hbinDefs?:         BinDef[],         // named hard bin definitions — one per distinct hbin value
  sbinDefs?:         BinDef[],         // named soft bin definitions — one per distinct sbin value
  metadataFields?:   MetadataFieldDef[], // opts a die.metadata key into the 'metadata' plot mode — §4.1.12
  derivedTests?:     DerivedTestDef[],  // tests computed from other tests on the same die — §4.1.9
}

// Single-wafer variant (WaferMapInputSingle):
type WaferMapInputSingle = WaferMapInputBase & {
  results?:  DieResult[] | DieColumns   // per-die measurements from the prober, as rows or as columns (§4.1.1)
  lotStack?: never          // passing both results and lotStack is a type error
}

// Lot-stack variant (WaferMapInputLotStack):
type WaferMapInputLotStack = WaferMapInputBase & {
  lotStack:  LotStackConfig  // collapse multiple wafers into one aggregated map
  results?:  never            // passing both results and lotStack is a type error and runtime error
}

// Layout variant (WaferMapInputLayout) — die sites with no test data:
type WaferMapInputLayout = WaferMapInputBase & {
  layout:    true            // requires waferConfig.diameter and dieConfig.width/height
  results?:  never
  lotStack?: never
}

type WaferMapInput = WaferMapInputSingle | WaferMapInputLotStack | WaferMapInputLayout
```

All fields are optional.  Supply what you know; the library handles the rest. Passing more than one of `results`, `lotStack` and `layout` on the same object is a type error and is rejected at runtime.

**A die layout with no test data** — `buildWaferMap({ layout: true, waferConfig: { diameter }, dieConfig: { width, height } })` — builds every die site lying **fully** on the wafer, notch or flat included: the gross die count, and the sites a prober can step to. For gross-die-per-wafer calculations, reticle and step planning, or showing the expected map before data exists; `renderWaferMap` draws it like any other result (dies render as no-data). Die `(0, 0)` is the site centred on the wafer, and `x`/`y` count sites in the directions `dieConfig.xAxisDirection`/`yAxisDirection` give. `waferConfig.center` is ignored, since the layout defines the centre; `edgeExclusion`, `reticleConfig` and orientation apply as usual. Missing geometry throws.

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
  testPass?:   Record<number, boolean>     // recorded per-test pass/fail verdicts keyed the same way (true = pass)
                                           // parametric tests: value in testValues, optionally the tester's verdict here
                                           // (e.g. STDF PTR TEST_FLG); functional tests (testType 'F'): verdict here ONLY —
                                           // they have no measured value. e.g. { 2001: true, 2002: false }
  hbin?:       number                      // hard bin assignment (physical sort result; STDF V4 range 0–32767)
  sbin?:       number                      // soft bin assignment (test-program failure category; independent 0–32767 space)
  siteNum?:    number                      // STDF site_num — which parallel test site tested this die
                                           // enables test-site analysis in analyzeWaferMap when ≥2 distinct
                                           // values each appear on ≥3 dies (indicating a multi-site probe card)
  partId?:     number | string             // STDF PRR PART_ID — text in STDF; a number is accepted too.
                                           // Data about the part, not an identifier (a die's identity is its
                                           // position). Fab-specific; at many fabs it encodes probe sequence
  supersedes?: 'partId' | 'position'       // the tester marked this record as replacing an earlier one
                                           // (same part ID / same position); it always wins over retestPolicy
}
```

A single test result: `testValues: { 1050: 0.95 }`

When a die position appears more than once in the `results` array (a retest), the
`retestPolicy` field on `WaferMapInput` controls which result is kept.  The
`die.retestCount` field always records how many times that position appeared.

**Results as columns (`DieColumns`).** A host that already holds its results as columns (a parser, Arrow or Parquet) can pass them as `results` instead of an object per die, and the map is built without one: on a large lot this is most of the memory. **You need this only if you already have columns** — if you have rows, pass rows; converting them yourself gains nothing.

```ts
{
  count:       number                          // number of records (retests included: wmap resolves them)
  x?, y?:      ArrayLike<number>               // one entry per record
  hbin?, sbin?, siteNum?: ArrayLike<number>
  partId?:     ArrayLike<number | string | undefined>
  supersedes?: ArrayLike<'partId' | 'position' | undefined>
  metadata?:   ArrayLike<DieMetadata | undefined>
  testValues?: Record<number, { indices: ArrayLike<number>; values: ArrayLike<number> }>
  testPass?:   Record<number, { indices: ArrayLike<number>; values: ArrayLike<boolean | number> }>
}
```

Every per-record column has `count` entries. A missing entry is `NaN`, or STDF V4's missing value in an integer column: −32768 for `x`/`y`, 65535 for `hbin`, `sbin` and `siteNum`. Other values follow the same rules as rows: outside STDF's ranges they are treated as missing and reported in `warnings`.

Test values and verdicts are **sparse**: for each test number, the indices of the records that have one, and their values. A record a test did not run on is not listed at all, so a missing value cannot be mistaken for a reading and nothing can shift out of line. Indices are whole numbers in `[0, count)`, at most once per test, and `indices` and `values` have the same length; `buildWaferMap` throws otherwise, because a misaligned column would draw a plausible, wrong map. Values are kept as supplied (a `Float32Array` stays 32-bit); verdicts are `true`/`1` for pass and `false`/`0` for fail.

```ts
buildWaferMap({
  results: {
    count: 3,
    x: Int16Array.of(0, 1, 2), y: Int16Array.of(0, 0, 0),
    hbin: Uint16Array.of(1, 1, 5),
    testValues: { 1050: { indices: Int32Array.of(0, 2), values: Float32Array.of(0.95, 1.21) } },  // record 1 skipped the test
  },
  testDefs,
});
```

#### 4.1.2 `WaferConfig`

```ts
{
  diameter?:      number         // wafer diameter in mm; inferred from grid extent × pitch if omitted
  center?:        { x: number, y: number }
                  // prober coordinate that lies at the physical wafer centre.
                  // Supply for partial data (a contiguous half/quadrant/slice that
                  // stops short of the wafer edge); anchors placement to the true
                  // centre. Not needed for sparse full-extent data. Does NOT change
                  // die.x/die.y labels.
                  // When omitted, the centre is inferred as the data midpoint (full-wafer assumption).
  notch?:         { type: 'top' | 'bottom' | 'left' | 'right' }
                  // physical orientation mark direction; standard dimensions derived from diameter:
                  //   ≤ 100 mm → 32.5 mm orientation flat  (SEMI M1)
                  //   ≤ 150 mm → 57.5 mm orientation flat  (SEMI M1)
                  //   > 150 mm → V-notch ~3.5 mm wide, 1.25 mm deep  (SEMI M1)
  orientation?:   0 | 90 | 180 | 270  // degrees CW to rotate the die grid on screen; default 0 (see note below)
  edgeExclusion?: number         // exclusion band width in mm measured inward from the wafer edge; dies in this band are dimmed
                                 // how these dies affect yield is controlled by the top-level edgeDieYieldMode option (§4.1.11)
  metadata?:      WaferMetadata  // arbitrary lot/wafer-level data attached to the view (lot ID, date, etc.)
}
```

**`orientation` note:** positive values rotate the die grid clockwise.  The notch/flat position is controlled by `notch.type` and is **not** affected by `orientation` — it stays fixed as the physical alignment mark. Only the four angles STDF can record are used: an equivalent angle (−90 is 270) is read as that angle, and any other is built at 0 and reported as `input-values-outside-stdf` (§4.2.2).


#### 4.1.3 `DieConfig`

```ts
{
  width?:              number   // die width in mm (= X step pitch); enables physical mm coordinates
  height?:             number   // die height in mm (= Y step pitch); enables physical mm coordinates
  coordinateOrigin?:   {
    // where the prober places coordinate (0,0) on the wafer grid
    type: 'center'           // default — grid already centred; centroid offset applied automatically
        | 'LL'               // (0,0) at lower-left corner (standard STDF/KLA output)
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
               // die grid index (x, y), in original die coordinates (die.x/die.y),
               // that sits at the reticle field's min-x/min-y corner (bottom-left,
               // since +Y is up) — i.e. it becomes the leftmost, bottom-most die
               // of the field it belongs to. Shifts the entire reticle grid so
               // this die aligns to a field boundary.
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

A `'stddev'` or `'count'` stack holds spreads and tallies, not measurements of the test, so the tests' limits
(`limitLow`, `limitHigh` and the specification limits) do not apply to it: `result.testDefs` carries them
removed, and there is no limit fail, limit yield, capability or out-of-spec colouring. The other methods are in
the test's units and keep the limits.

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
  testNumber:  number  // required: stable test identity matching the key used in DieResult.testValues
                       // e.g. an STDF TEST_NUM, a database test ID, or an application-defined constant
  name:        string  // e.g. "Idsat", "Vth", "Continuity"
  unit?:       string  // SI base unit, e.g. "A", "V", "Ω", "F" — the formatter applies SI prefixes
                       // automatically (0.03 Ω → "30 mΩ"), so always pass the base unit, never a
                       // pre-scaled unit like "mA" or "µV"
  logScale?:   boolean // when true, value normalization and the colorbar use log₁₀ scale for this test
                       // silently falls back to linear when any die value is ≤ 0; default false
  limitLow?:   number  // lower test limit (STDF LO_LIMIT) in the same units as the test value
                       // values below this fail; drives the ▽/△ markers, limit pass/fail and yield
  limitHigh?:  number  // upper test limit (STDF HI_LIMIT) in the same units as the test value
                       // values above this fail
                       // both limits are optional independently — one-sided limits are valid
  limitLowInclusive?:  boolean // a value equal to limitLow passes; default true (STDF PARM_FLG bit 6)
  limitHighInclusive?: boolean // a value equal to limitHigh passes; default true (STDF PARM_FLG bit 7)
  specLow?:    number  // lower spec limit (STDF LO_SPEC), distinct from the test limit
  specHigh?:   number  // upper spec limit (STDF HI_SPEC). Process capability uses the spec limits
                       // when both are given, otherwise limitLow/limitHigh; nothing else reads them
  validLow?:   number  // lower validity limit: the lowest value that is a real measurement. A value
                       // below it is a tester clamp (a range overflow, an open-circuit rail), not a
                       // reading — see valueFilter, §4.1.14
  validHigh?:  number  // upper validity limit. Separate from the test and spec limits, which judge
                       // good against bad; a clamped value is neither
  testType?:   'P' | 'F'  // 'P' = parametric (continuous measured value, the default),
                       // 'F' = functional (pass/fail outcome ONLY, no measured value —
                       // e.g. an STDF FTR; the verdict lives in DieResult.testPass).
                       // Functional tests stay selectable in value mode but always render
                       // as test pass/fail (solid green/red with a Pass/Fail legend), and
                       // are excluded from all parametric statistics — per-test stats
                       // tables, capability, correlation, distribution charts, value
                       // stacks, and regional value findings (a mean or Cpk of a binary
                       // outcome would be meaningless). They get pass-rate analysis
                       // instead: stats.functionalYield, "Functional Tests" tables, and
                       // regional pass-rate findings (kind 'functionalTest')

  // ── Set by buildWaferMap on a derived test, never by the caller — see §4.1.9
  readonly derived?:     true    // marks this test as derived rather than measured
  readonly expression?:  string  // the expression it was computed from, verbatim
  readonly constants?:   Record<string, number>  // the constants that expression resolved
}
```

`testNumber` must match the key used in `DieResult.testValues` / `DieResult.testPass`.

**`derived` is on `TestDef`, not only on `DerivedTestDef`, deliberately.** `result.testDefs` is one homogeneous `TestDef[]` — a derived test is an ordinary test from the build onwards — so every surface that shows a test name reads its defs from there. Putting the flag only on the input type would mean each of those surfaces needed a cast to ask whether a value was measured or derived, and a display that cannot ask that question cannot mark it: an engineer reading a Cpk table would be left to assume the number came off the tester. `expression` travels for the same reason — it is what a tooltip or panel needs to answer *where did this number come from*, without the host holding its own `derivedTests` input alongside the result and joining the two by test number.

A test with no `testType` is parametric, so untyped callers are unaffected.

**Legacy functional encoding:** callers that predate `DieResult.testPass` encoded a functional outcome as a `testValues` entry of `1` (pass) / `0` (fail). That data keeps working everywhere — rendering, stats, and findings all read verdicts through `getTestPassStatus` (§10), which documents the fallback. New code should write `testPass` and leave functional tests out of `testValues` entirely.

#### 4.1.9 `DerivedTestDef`

A test computed from other tests on the same die, rather than measured. It is a `TestDef` plus an `expression`, so `unit`, `limitLow`/`limitHigh` and `logScale` already mean the right thing — and from the build onwards it is an ordinary test: it appears in `result.testDefs`, in the value plot modes, the colorbar, tooltips, `analyzeWaferMap`, Insights and the report, with no other change required.

```ts
{
  ...TestDef          // testNumber, name, unit, limitLow/limitHigh, logScale, testType
  expression:  string // the computation — see the grammar below
  constants?:  Record<string, number>  // named values usable in `expression`
  derived?:    true   // set by buildWaferMap, never by the caller — marks the def as derived
}
```

The admitted def joins `result.testDefs` carrying `derived: true` **and its `expression` and `constants`** (§4.1.8), so any surface showing the test can both mark it as computed and say what it was computed from.

**How a derived test is shown.** Everywhere the library names a test, a derived one is marked with `†` **in front of** its name — never `ƒ`, which reads as femto beside `fA`/`fF` units — and the glyph never appears without its key, *Derived, not measured*. In front, on every surface: in a list the marks form a column down the left edge, so a derived test is found at a glance, and truncating a long name can never cut the mark off. A list that holds a derived test pads its measured names by the mark's width, so every name starts at the same x; a list without one is unchanged.

| Surface | Marker | Where the key is |
|---|---|---|
| Map title and colorbar | `† Leak Shift (nA)` | Its own line under the colorbar or legend |
| Map tooltip | `† Leak Shift: 2.06 nA` | The next line, with the expression |
| Plot-mode test menu | In a slot in front of each name, reserved only when a derived test is listed | A line at the foot of the test list |
| Insights test pickers (boxplot, histogram, trend, scatter) | In front of the name, measured names padded to align | The Distributions and Correlation tabs' own key lines |
| Process capability panel | In front of each column label | The panel legend; the tooltip adds the expression |
| Correlation matrix | In front of each axis label | The line above the matrix |
| Findings (`variable.label`, `summary`) | In the sentence | Row tooltip; a key line under the list naming each expression |
| `stats.functionalYield[].label` and the Summary panel's tables | In front of the name | A key line under the table naming each expression |
| Die list | In front of the column header | A key line above the table naming each expression |
| HTML reports | In the findings table | A key line under it naming each expression — a printed report has no hover |
| CSV exports | None — plain names | A trailing **Derived from** column holding the expression, added only when a row is derived. Where tests are columns (die list, correlation), the header or a per-side column says what it was derived from |

A host listing tests in its own UI marks them the same way with the exported `DERIVED_MARK` (`'†'`) and `DERIVED_KEY` (`'Derived, not measured'`) — never its own copy of the glyph or the words.

The structured form travels alongside: `TestDef.derived`/`expression` (§4.1.8), `StatsFinding.variable.derived`/`expression`, and `derived`/`expression` on `functionalYield` rows — so a host rendering its own view never has to parse the glyph back out.

```ts
buildWaferMap({
  results, testDefs, waferConfig, dieConfig,
  derivedTests: [
    { testNumber: 900001, name: 'Leakage Shift', unit: 'uA',
      expression: 'abs(t[1020] - t[1010])', limitHigh: 5 },
    { testNumber: 900002, name: 'Sweep All Pass', testType: 'F',
      expression: 'all(testPass[1010..1025])' },
  ],
});
```

**Reading die data.** Three accessors, each with one meaning and one read-path, and five calls for the die's own fields:

| | Reads | Type | Valid on |
|---|---|---|---|
| `t[1020]` | the measured value | number | parametric tests |
| `testPass[1020]` | the tester's recorded verdict (`die.testPass`, via `getTestPassStatus`) | boolean | any test |
| `specPass[1020]` | the spec-limit judgement | boolean | parametric tests declaring a limit |
| `diePass()` | the die's bin verdict under the map's `passBins` | boolean | any die |
| `dieX()`, `dieY()` | the die's position on the grid | number | a positioned die |
| `hbin()`, `sbin()` | the die's hard or soft bin number | number | a die with that bin |
| `site()` | the probe site that tested the die | number | a die with a site |

A die field the die lacks is absent, never zero: bin 0 and site 0 are real, and "no bin" or "no position" gives the expression no value, so the die reads as no-data. They are written with parentheses, like `diePass()`, so a name is never mistaken for a constant. Position, bin and site are what a die was recorded with; a ring, quadrant or reticle cell is calculated from wafer geometry the expression has no view of, so those are not available here.

`testPass` and `specPass` are the same distinction `passFailDisplay: 'test' \| 'spec'` draws, and they are genuinely different questions — a value can be outside its limits while the tester recorded a pass. They are separate accessors rather than one because most CSV-sourced parametric data has measurements and no recorded verdict at all, so a single conflated accessor would silently return "unknown" for every die.

**Ranges and reducers.** A range accessor — `t[1010..1015]` — yields a set, which must be reduced. A range names a block of test numbers; only the numbers actually declared in `testDefs` are read, ascending, so a program numbered in steps of 2 needs no step syntax. A range that runs backwards, or matches no declared test, rejects the expression. The same range text is accepted in a sweep's `tests` (§5.9), parsed by the same code, so it always names the same tests in both places.

| Over values | Over verdicts |
|---|---|
| `mean` `sum` `min` `max` | `all` `any` `none` `countTrue` `countFalse` |
| `countKnown` — the number of elements that have data, over either | |

A set can **only** be produced by a range accessor and **only** consumed by a reducer: there is no vector arithmetic and no elementwise operator, which is what keeps this a scalar grammar.

**Operators and functions.** `+ - * / % ^` (`^` right-associative), comparisons `< <= > >= == !=`, `and` / `or` / `not`, and `if(cond, a, b)`. Functions: `abs sqrt ln log10 exp floor ceil round sign pow min max`. Identifiers resolve only to entries in `constants`.

**No script evaluation.** The expression is tokenised, parsed to a typed tree and walked per die. There is no `eval`, no `new Function`, no third-party expression engine, no member access and no way to name a host object — so a set of derived tests can be shared between teams as plain JSON.

**When they are computed.** On the raw probe records, **before** lot stacking and before retest resolution, so every derived value comes from one real touchdown. Deriving after a stack would subtract one aggregate from another; deriving after retest collapse could mix a value from one touchdown with a verdict from another.

**Value or verdict.** A numeric expression writes to `die.testValues[testNumber]`. A boolean expression is a verdict: declare `testType: 'F'` and it writes to `die.testPass[testNumber]`, never as a 1/0 in `testValues` — which would put it in the correlation matrix and the Cpk table. A declared `testType` that disagrees with what the expression produces is rejected.

**Unknown data.** If any input the expression needs is missing on a die, the derived value is **absent** for that die — it renders as no-data grey and is excluded from the stat populations. Never `0`, never `false`. A non-finite result (`0/0`, `ln(-1)`) is absent for the same reason. Reducers are the one exception: they skip unknown elements and reduce what is known, which is why `countKnown` exists to make the denominator explicit.

**Validation.** Everything statically knowable is checked at build and reported as a `derived-test-invalid` warning on `result.warnings`, naming the test and the character position: parse and type errors, a `testNumber` that is not a whole number from 0 to 4294967295 (what STDF can store) or that collides with measured data (measured values are never overwritten), a `testType` mismatch, `t[n]` on a functional test, `specPass[n]` on a test with no limits, an undeclared test number, an unknown function or name. **A rejected derived test is dropped, never half-applied** — a half-working expression plots wrong numbers rather than no numbers.

**Nesting.** A derived test may read another derived test — `t[900001]` resolves to a derived value just as it would a measured one. Evaluation follows dependency order, not declaration order, so the two can be listed either way round. A cycle, a self-reference, or a dependency on a test that was itself rejected drops the dependent with a warning naming the cause: an expression whose input never materialises would otherwise evaluate to no-data on every die and read as missing data.

A unit mismatch across `+`/`-` (subtracting volts from amps) is reported but still computed, since unit strings are free text and a site may legitimately write both `"uA"` and `"µA"`.

#### 4.1.10 `BinDef`

Named definition for one bin number.  Used for both hard bin (`hbinDefs`) and soft bin (`sbinDefs`) — the shape is identical but the number spaces are independent.

Per STDF V4, hard bins and soft bins each range 0–32767.  Bin 1 in hard bin space and bin 1 in soft bin space are different things and may have different names — always pass them as separate arrays.

```ts
{
  bin:    number   // the numeric bin value this defines
  name:   string   // e.g. "Pass", "Contact Open", "Vth - Hi NMOS"
  color?: string   // optional CSS colour, e.g. "#2ecc71" — wins over the bin colour scheme for this bin (§10.6)
}
```

**Hard bins** (`hbinDefs`) are the physical sort result — where the part goes on the handler.  **Soft bins** (`sbinDefs`) are the logical test-program classification — the failure category as determined by the test algorithm, used for debug and yield analysis.  Many soft bins typically map to one hard bin.

#### 4.1.11 `edgeDieYieldMode`

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

#### 4.1.12 `MetadataFieldDef`

Named definition for one `die.metadata` key, opting it into the **`'metadata'` plot mode** — a generic categorical/layout view, distinct from test results and bins. Use this for any per-die classification that isn't a test outcome: which project a die belongs to on a multiproject wafer, vendor/third-party ownership, reserved/shared/unassigned areas, or any other host-defined grouping already carried in `die.metadata`.

```ts
{
  key:     string    // the die.metadata key this definition applies to
  label?:  string     // display name for the toolbar entry and map title — default: Title Case of key
  values?: Array<{ value: string; label?: string; color?: string }>  // optional per-value overrides
}
```

A key is only offered in the toolbar's "Metadata" mode-menu section when it appears in `metadataFields` **and** at least one die actually has that key set — presence in `metadataFields` is an explicit opt-in, never auto-detected. `values` is optional per field: distinct values with no override are still shown, auto-labeled with the raw (stringified) value and auto-colored from an ordered qualitative palette (assigned in natural alphanumeric order by value — so `D2` precedes `D10` rather than following it — making colors stable across reloads and the legend order predictable — not the pass/fail-flavored palette `hardBinColor` uses, since an arbitrary metadata field has no universal "good/bad" meaning).

```ts
const result = buildWaferMap({
  results: [
    { x: 4, y: -2, hbin: 1, metadata: { project: 'Project A', device: 'Device 12' } },
    { x: 5, y: -2, metadata: { project: 'vendor' } }, // vendor die — no test/bin data at all
  ],
  waferConfig: { diameter: 300 },
  dieConfig:   { width: 10, height: 10 },
  metadataFields: [
    { key: 'project', label: 'Project', values: [
      { value: 'Project A', color: '#4e79a7' },
      { value: 'vendor',    label: 'Third-party vendor', color: '#bab0ac' },
    ] },
  ],
});

renderWaferMap(container, result, { viewOptions: { plotMode: 'metadata', activeMetadataKey: 'project' } });
```

**Key properties of this mode:**

- **Coexists with test/bin data** — a die can carry `hbin`/`testValues` *and* a metadata classification at the same time; `'metadata'` is just another selectable toolbar view of the same underlying die, the same way `hardBin`/`softBin`/`value` already are. `die.metadata` already renders in every tooltip regardless of plot mode, so switching into `'metadata'` mode changes the map's colour/legend without changing what the tooltip shows.
- **No lot-stacking.** `'metadata'` is deliberately excluded from the stacked/lot-aggregation modes (`stackedValues`/`stackedBins`/`stackedSoftBins`) — a die's layout classification is a constant of the design, not a per-wafer measurement, so there is nothing meaningful to aggregate across a lot.
- **Never affects yield.** `die.metadata` was never part of the yield-eligibility pipeline, so a `'metadata'`-classified die's yield/pass-fail status (if it has one) is entirely unaffected by this mode.
- **Click-to-highlight in the legend**, exactly like `hardBin`/`softBin`: clicking a legend swatch dims every die except that value (`highlightMetadataValue`, the string-keyed analogue of `highlightBin`); Ctrl/Cmd+click adds or removes values; clicking the only value shown again clears it.
- Reuses wafer geometry, tooltip, selection, zoom, and PNG export unchanged — none of those are plot-mode-aware. The one thing genuinely new is the colour fill, the legend, and the toolbar entry.

#### 4.1.13 `standardDiameters`

```ts
standardDiameters?: number[]   // default [100, 125, 150, 200, 300]
```

The wafer diameters (mm) treated as standard when sanity-checking an **inferred**
diameter. A diameter you supply is never second-guessed; this is consulted only
when the library had to size the wafer from the die extent, and it is what decides
whether the `non-standard-diameter` advisory (§4.2.2) fires.

It **replaces** the default rather than adding to it, so spread it to extend:

```ts
import { buildWaferMap } from '@wafertools/wafermap';

// a line that also runs 3-inch
buildWaferMap({ results, standardDiameters: [100, 125, 150, 200, 300, 76.2] });

// genuinely non-standard substrate — panels, reclaim, odd R&D shapes
buildWaferMap({ results, standardDiameters: [] });
```

`[]` disables the check entirely, and is the intended opt-out for a substrate that
is not on the ladder — better than suppressing every geometry advisory to silence
one that does not apply to your line.

#### 4.1.14 `valueFilter` and validity limits

```ts
valueFilter?: 'validity' | 'spec' | 'test' | 'none'   // default 'validity'
```

A tester that runs out of range does not stop; it records its rail. A current of `1.0E+38`, a voltage held at the supply, an
open-circuit reading: each is a number in the file and none is a measurement. Left in, it stretches the colour scale, drags the
mean and the standard deviation, and makes a Cpk meaningless. The **validity limits** (`TestDef.validLow`, `validHigh`) state the
range a real measurement lies in, and `valueFilter` chooses which limit set a value must lie inside to be used:

| Mode | A value is kept when it lies inside |
| --- | --- |
| `'validity'` (default) | the validity limits. Only tests that define them are affected, so a build that sets none changes nothing. |
| `'spec'` | the specification limits (`specLow`/`specHigh`). |
| `'test'` | the test limits (`limitLow`/`limitHigh`, with their inclusive flags). |
| `'none'` | anything: nothing is filtered. |

The filter reads the limits from `testDefs`, so a build without `testDefs` filters nothing. An excluded value is **no value for that test on that die**, in the map, the statistics and every chart; a derived test is computed
from the filtered values, so it is never built on a clamp. Bins, `DieResult.testPass` and each die's recorded verdict are the
tester's own and are never changed, so yield and the bin map are the same with the filter on or off.

Nothing is hidden. The result says what was left out:

```ts
const result = buildWaferMap({
  results,
  testDefs: [{ testNumber: 1010, name: 'Idsat', unit: 'A', validLow: 0, validHigh: 0.5 }],
});

result.valueFilter
// { mode: 'validity', tests: [{ testNumber: 1010, excluded: 14, total: 2644 }] }
// undefined when the filter excluded nothing
result.warnings.find(w => w.code === 'values-excluded')   // one line naming the limit set and the count
```

The counts are summed across every wafer of a lot build. The tooltip of a die with an excluded value names the value and the limit
set; the Summary panel's tables carry the total beside N and an **Excl.** column; the histogram, boxplot and capability captions, the Plot
footnote, the summary report and the CSV exports state the count; and `CapabilityDatum.excluded` (`{ count, limitSet }`) carries it (its `n` does not include
excluded values).

### 4.2 Return value

```ts
{
  wafer:         Wafer          // resolved wafer model (diameter, radius, center, notch, orientation)
  dies:          Die[]          // all dies inside the wafer boundary, with testValues/hbin/sbin attached
  plotMode:      PlotMode       // the plot mode chosen by buildWaferMap ('hardBin', 'value', etc.)
  metadata:      WaferMetadata | null  // wafer metadata from waferConfig.metadata
  isLotStack:    boolean        // true when built from lotStack input
  aggrMethod?:   string         // lot-stack aggregation method ('mean', 'median', 'countBin', …); undefined for single wafers
  lotSize?:      number         // number of wafers aggregated when built from lotStack; undefined for single wafers
  hbinDefs?:     BinDef[]       // named hard bin definitions passed to buildWaferMap
  sbinDefs?:     BinDef[]       // named soft bin definitions passed to buildWaferMap
  testDefs?:     TestDef[]      // named test definitions passed to buildWaferMap
  metadataFields?: MetadataFieldDef[]  // named metadata-field definitions passed to buildWaferMap — §4.1.12
  reticles:      Reticle[]      // generated reticle geometry — wired automatically when passed as a WaferMapDisplayItem
  reticleConfig: ReticleConfig | undefined  // the reticle config that was used; passed through to analyzeWaferMap automatically
  units:   'mm' | 'normalized'   // coordinate space of die.physX/die.physY and wafer dimensions
  warnings: WaferWarning[]       // structured geometry-inference advisories — always present (may be empty).
                                  // Surfaced automatically by renderWaferMap/renderWaferGallery in the
                                  // toolbar's warning indicator; read here for programmatic use. §4.2.2
                                  // { code: string; message: string;
                                  //   severity?: 'error' | 'warning' | 'info'; confidence?: number }
                                  // The first three geometry codes below are severity 'error': they mean
                                  // die positions may be wrong, not that a feature is missing.
                                  // Codes:
                                  //   'partial-coverage'  — data does not span a full wafer; inferred
                                  //     diameter/centre may be wrong. Supply waferConfig.center + .diameter.
                                  //   'geometry-conflict' — waferConfig.diameter AND dieConfig.width/
                                  //     height were BOTH supplied, and are too small to contain the
                                  //     probed dies. A die with results is a real prober position and is
                                  //     always fully on the wafer, so the two supplied values contradict
                                  //     each other; check them against the real device.
                                  //   'non-standard-diameter' — pitch supplied without a diameter, and the
                                  //     wafer sized from the die extent landed off the standard ladder
                                  //     (100/150/200/300 mm) — evidence the probed grid did not reach the
                                  //     edge. Supply waferConfig.diameter. NOTE: an inferred PITCH raises
                                  //     nothing: it is derived to fit the diameter, so it is always
                                  //     self-consistent. And 'geometry-conflict' is never raised for an
                                  //     inferred pitch — pitch is a free scaling parameter, so with
                                  //     no supplied pitch there is always one that "fits", and a fit
                                  //     check would otherwise fire on perfectly good full-wafer data.
                                  //   'edge-exclusion-exceeds-radius' — severity 'warning', not 'error':
                                  //     waferConfig.edgeExclusion is larger than the resolved wafer radius
                                  //     (most likely when the diameter was itself inferred from sparse
                                  //     data). The excluded band is clamped to the whole wafer rather than
                                  //     silently producing a smaller, wrong ring.
  inference: {
    wafer:    { confidence: number; method: string }   // how diameter was resolved; confidence 0–1.
                                                        // method is 'inferred-partial' when partial data was detected
    diePitch: { confidence: number; units: 'mm' | 'normalized' }  // how die size was resolved
    grid:     { confidence: number }                   // quality of the grid index assignment
  }
  dataCoverage: {
    filledDies:       number   // dies with at least one value or bin attached
    totalDies:        number   // POSITIONED dies inside the wafer boundary (including partial) — 0 for a
                                // fully coordinate-less wafer; see unpositionedDies below, not this, for
                                // "how many dies does this wafer actually have"
    edgeExcludedDies: number   // dies whose centres fall within the edge exclusion band
    ratio:            number   // filledDies / totalDies ∈ [0, 1] — undefined/misleading when totalDies is 0
    unpositionedDies: number   // dies with no reported x/y at all (see §11.1's coordinate-less note) —
                                // always present, 0 when every die has a position
  }
  passBins: number[]    // the pass bins given to buildWaferMap. renderWaferMap, renderWaferGallery (per wafer)
                         // and analyzeWaferMap read these — never repeat them in a render or analysis call
  ringCount: number     // the ring count given to buildWaferMap (default 4) — read by the renderers, analysis and reports
  valueFilter?: ValueFilterSummary  // what the value filter excluded (§4.1.14): { mode, tests: [{ testNumber, excluded, total }] };
                         // absent when it excluded nothing
  yield: YieldSummary   // pass/fail statistics computed against passBins — NOT scoped to positioned dies,
                         // unlike dataCoverage above; a coordinate-less die with bin data still counts
}
```

#### 4.2.1 `YieldSummary`

```ts
{
  passDies:          number          // dies with a bin in passBins
  failDies:          number          // full dies inside wafer with a bin not in passBins
  edgeExcludedDies:  number          // dies within the edge exclusion zone
  partialDies:       number          // dies straddling the wafer boundary — always 0 for a
                                     // `results`-based map (§11.1)
  totalDies:         number          // passDies + failDies (edge-excluded not included)
  yieldPercent:      number | null   // (passDies / totalDies) × 100 ∈ [0, 100]; null when no bin data
  yieldPercentGross: number | null   // (passDies / (passDies + failDies + edgeExcludedDies)) × 100 ∈ [0, 100];
                                     // only set when edgeDieYieldMode: 'denominator-only'; otherwise null
}
```

Partial dies are excluded from both numerator and denominator. Edge-excluded dies are excluded by default (`edgeDieYieldMode: 'exclude'`); set `edgeDieYieldMode: 'denominator-only'` to include them in the denominator for gross die yield.

**`result.yield.yieldPercent` vs `summary.stats.yieldPercent`** — both are in \[0, 100\] and can differ when you pass custom options to `analyzeWaferMap` (e.g. a different `edgeDieYieldMode` or `passBins`). Use `result.yield` for rendering and quick checks; use `summary.stats.yieldPercent` when you need the yield that is consistent with the findings analysis.

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

> **All four levels assume the data spans a full, roughly symmetric wafer
> centred near the prober origin.** The diameter and centre are derived from the
> *extent of the data you pass*. See "Minimum geometry for partial data" below
> before relying on inference for anything less than a full wafer.

**Diameter snapping:** inferred diameters snap to industry-standard sizes.
100 mm, 150 mm, 200 mm, and 300 mm are preferred (±10% tolerance); other SEMI
standard sizes (25 / 50 / 75 / 450 mm) are tried next (±20%); remaining values
are rounded to the nearest 10 mm.

**Origin:** defaults to `'center'` (centroid offset applied automatically). Set `coordinateOrigin: { type: 'LL' }` explicitly for standard STDF/KLA output where (0,0) is at the lower-left corner.

#### 4.2.2 `WaferWarning`

The library's one warning vocabulary. Raised by geometry inference on
`WaferMapResult.warnings`, and by analysis on `StatsSummary.stats.warnings`.

```ts
{
  code:      string   // stable machine-readable key — BRANCH ON THIS, not on message
  message:   string   // human-readable, suitable for direct display
  severity?: 'error' | 'warning' | 'info'   // default 'warning' when absent
  confidence?: number // inference confidence 0–1, when one applies
}
```

**Codes**

| Code | Severity | Meaning |
| --- | --- | --- |
| `partial-coverage` | `error` | Data does not span a full wafer; inferred diameter/centre may be wrong and dies may be mis-positioned. Supply `waferConfig.center` + `.diameter`. |
| `geometry-conflict` | `error` | `waferConfig.diameter` and `dieConfig.width`/`height` were both supplied and cannot contain the probed dies. |
| `non-standard-diameter` | `warning` | A die pitch was supplied without a `diameter`, so the wafer was sized from the die extent — and the result is off the standard wafer-size ladder (SEMI M1: 100/150/200/300 mm and the smaller legacy sizes). Silicon only comes in those sizes, so e.g. 210 mm is evidence the probed grid did not reach the wafer edge and the wafer is really larger. Dies are then placed against a wafer that is too small, which moves them between rings and changes ring/edge findings. Supply `waferConfig.diameter` — or, if your line genuinely runs a size that is not on the ladder, extend or empty the ladder itself with `standardDiameters` (§4.1.13) rather than muting every geometry advisory. There is **no** matching advisory for an inferred *pitch*: that is derived to fit the supplied diameter, so it is self-consistent by construction and there is nothing to check it against. |
| `diameter-exceeds-die-extent` | `warning` | A **supplied** `waferConfig.diameter` that the probed dies fill less than 75% of the radius. The mirror of `geometry-conflict`, which asks whether the dies *fit*; this asks whether they *fill*. An over-large wafer is not harmless — ring bands are equal-radius, so it crushes dies into the inner rings and empties the outer ones (at a 10× diameter every die lands in ring 1), and ring/quadrant/edge findings then describe the assumed wafer rather than the probed area. A genuinely partial map looks identical, so the message names both causes. Not raised when `waferConfig.center` is supplied (that is the documented way to position partial data deliberately) or below 20 dies (too few for the extent to be evidence, and too few for ring analysis to report anything). |
| `test-count-capped` | `warning` | More tests found than `analyzeWaferMap` will analyse, so **no test findings were computed at all**. Pass `testNumbers` to scope it. |
| `edge-exclusion-exceeds-radius` | `warning` | `waferConfig.edgeExclusion` exceeds the resolved wafer radius (most likely with an under-inferred diameter). The excluded band is clamped to the whole wafer instead of silently producing a smaller, wrong ring. |
| `bin-colors-shared` | `warning` | Raised by the renderers (not `buildWaferMap`) for the bin map on screen: some bins are drawn in a colour another bin also has — more bins than the bin colour scheme has distinct colours, or a `BinDef.color` repeats one. Every die is drawn correctly; colour alone cannot separate those bins. A gallery states it once for all its wafers. |
| `pass-bins-mixed` | `warning` | Raised by `renderWaferGallery`: its wafers were built with different pass bins, and some hard bins pass on one wafer and fail on another. Every wafer's own verdicts and yield are correct; a bin has one colour and one legend row, so the named bins are shown as failing there. |
| `ring-count-mixed` | `warning` | Raised by `renderWaferGallery`: its wafers were built with different `ringCount`s. Each card and each wafer's findings use their own; the lot-level ring figures (Summary panel, report, Insights) use the count the message names. |
| `values-excluded` | `info` | Raised by `buildWaferMap`: the value filter (§4.1.14) took values outside the chosen limit set out of the data. The message names the limit set and how many values were excluded; `result.valueFilter` has the count per test. |
| `input-values-outside-stdf` | `warning` | Raised by `buildWaferMap`: bins, coordinates, test numbers or site numbers outside the STDF V4 ranges (bins 0–32767, coordinates −32767…32767, test numbers 0–4294967295, sites 0–255), test values that are not finite, or a `waferConfig.orientation` other than 0, 90, 180 or 270. Each is **treated as missing**: the bin or site is absent, a die with an illegal coordinate has no position (in either axis), a test with an illegal number is left out of every die and of `testDefs`, a non-finite value is dropped, and the map is built at orientation 0. The input objects are not modified. A `NaN` bin is no bin and is counted here. |
| `retests-by-part-id` | `info` | Raised by `buildWaferMap`: dies with no position that share a part ID were treated as retests of one die, resolved by `retestPolicy`. Blank part IDs never match, and part IDs are not used on a wafer where one value covers more than 20% of the unpositioned records. |
| `input-values-not-numbers` | `error` | Raised by `buildWaferMap`: bins, site numbers or test values were given as text, or pass/fail verdicts as something other than `true`/`false` — what a CSV parser produces unless each field is converted. They are **not** converted: each is **treated as missing**, so a die whose bin was `"1"` has no bin (no verdict, not a pass), and a text reading is absent from the map and every chart. Checked on `results`, every lot-stack wafer and pre-built `dies`; the input objects are not modified. The message counts each kind and shows an example; it is also logged to the console. (String `x`/`y` throw instead.) |
| `derived-test-invalid` | `warning` | Raised by `buildWaferMap`: a `derivedTests` entry (§4.1.9) could not be compiled or applied, and was **dropped** — a rejected derived test is never half-applied, because a half-working expression plots wrong numbers rather than no numbers. The message names the test and the character position within its `expr`. Causes: a parse or type error, a `testNumber` outside 0–4294967295 or colliding with measured data (measured values are never overwritten), a `testType` mismatch, `t[n]` on a functional test, `specPass[n]` on a test with no limits, an undeclared test number, or an unknown function or name. Every other derived test in the same input still applies, so a map missing one derived test is the expected shape of this warning. |
| `input-field-removed` | `error` | Raised by `buildWaferMap`: the input used a name removed in an earlier release — `data`, `die`, `stack`, `values`, `TestDef.index`, `dieConfig.origin`, `waferConfig.flat`, `reticleConfig.anchor` or `lotStack.aggr`. It is **not** honoured, so what it described is missing from the map (for `data` and `values`, the data itself). The message names each one and its replacement; it is also logged to the console, for a caller that does not read `result.warnings`. |

`severity` is about trust in what is on screen, not about how loud the message is:
`'error'` means the map may be **positionally wrong**; `'warning'` means something
expected is missing or degraded but what is drawn is correct. The union of `code`
is deliberately open to `string` so new advisories are not a breaking change —
switch with a `default` branch.

These are surfaced automatically — see [`WarningsOptions`](render-map.md#510-warnings).

#### Minimum geometry for partial data

Inference works backwards from the data's bounding extent. What matters is
whether the data **reaches the true wafer edge**:

- **Sparse data** — positions missing across the whole wafer (systematic
  skip-sampling, e.g. 1-in-4, or random sampling). The extent still reaches the
  edge, so diameter and centre infer correctly. **No geometry hints required.**
- **Partial data** — a contiguous region that stops short of the edge: a half
  wafer, a single quadrant, a slice, or an off-centre cluster. The extent
  understates the wafer, so the region is mistaken for a smaller full wafer and
  re-centred on its own midpoint. Inference is **wrong** here.

An **edge ring / annulus** is a middle case: only outer dies are present, but
they reach the true edge, so the diameter is right — only the empty interior is
"missing", which is harmless.

For partial data, supply both:

| Field | Meaning |
| ----- | ------- |
| `waferConfig.diameter` | the true wafer diameter in mm |
| `waferConfig.center` | the prober coordinate `(x, y)` that lies at the physical wafer centre |

`waferConfig.center` anchors placement to the real centre. It does **not** change
the public `die.x` / `die.y` labels — those remain the original prober
coordinates. (Supplying `dieConfig.width`/`height` for the pitch is recommended
too, so coordinates are in real mm.)

Detection is heuristic: the library flags likely-partial coverage by how far the
data centroid sits from its bounding-box centre. Contiguous partial regions are
caught; an off-centre cluster small enough to look like a tiny full wafer, and an
edge ring (centroid-symmetric), are not flagged — when in doubt, set
`waferConfig.center` explicitly rather than relying on the warning.

```ts
// Right half of a 300 mm wafer; prober (0,0) is the wafer centre.
const result = buildWaferMap({
  results,                                   // prober x ∈ [0..15], y ∈ [-15..15]
  waferConfig: { diameter: 300, center: { x: 0, y: 0 } },
  dieConfig:   { width: 10, height: 10 },
});
```

When the library detects likely-partial data and no `center` was supplied, it
adds a structured warning to `result.warnings` (code `'partial-coverage'`) and sets
`result.inference.wafer.method` to `'inferred-partial'` — check these
programmatically rather than relying on console output.

### 4.4 Examples

**Minimal — grid positions only (normalized units):**

```ts
const result = buildWaferMap([
  { x: 0, y:  0, testValues: { 1050: 0.95 } },
  { x: 1, y:  0, testValues: { 1050: 0.87 } },
  { x: 0, y: -1, testValues: { 1050: 0.91 } },
]);
// result.units === 'normalized'
```

**With die size — physical mm coordinates:**

```ts
const result = buildWaferMap({
  results:   data,
  dieConfig: { width: 10, height: 10 },
});
// result.units === 'mm'
```

**Fully specified with notch:**

```ts
const result = buildWaferMap({
  results:     data,
  waferConfig: { diameter: 300, notch: { type: 'bottom' }, orientation: 90 },
  dieConfig:   { width: 10, height: 10 },
});
```

**With bin data and edge exclusion:**

```ts
const result = buildWaferMap({
  results:     csvRows.map(r => ({ x: Number(r.x), y: Number(r.y), hbin: Number(r.hbin) })),
  waferConfig: { diameter: 200, edgeExclusion: 3 },
  dieConfig:   { width: 8, height: 8 },
});
console.log(result.yield.yieldPercent);
```

**Multiple tests and bins in a single pass:**

```ts
const result = buildWaferMap({
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
const result = buildWaferMap({
  results:   data,
  dieConfig: { width: 10, height: 10 },
  reticleConfig: { width: 4, height: 2, anchorDie: { x: 2, y: 1 } },
});
```

**Multi-wafer lot stack — count bin 2 failures across six wafers:**

```ts
const result = buildWaferMap({
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
const result = buildWaferMap({
  results:   data,
  dieConfig: { width: 10, height: 10, coordinateOrigin: { type: 'UL' } },
});
```

**Retests — keep first result, surface retest count in tooltip:**

```ts
// Raw results may include the same (x, y) more than once.
// 'first' keeps the initial test; 'last' (default) keeps the most recent.
const result = buildWaferMap({
  results:      rawResults,
  retestPolicy: 'first',
  waferConfig:  { diameter: 300, notch: { type: 'bottom' } },
  dieConfig:    { width: 10, height: 10 },
});

// die.retestCount is set (to the total count) whenever a position was retested.
const retested = result.dies.filter(d => d.retestCount !== undefined);
console.log(`${retested.length} die positions were retested`);
// e.g. → "47 die positions were retested"
// The built-in tooltip automatically shows "Retests: N" for retested dies.
```

### 4.5 Post-enrichment

When you need to attach additional values after the map is built, use `getDieKey`
for stable lookups:

```ts
import { buildWaferMap, getDieKey } from '@wafertools/wafermap';

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
