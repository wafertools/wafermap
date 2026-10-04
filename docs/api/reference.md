# API Reference — Package surface, helpers and types

**Part of the [API Reference](../api.md).**

## 9 Package surface

```ts
import { buildWaferMap }                       from '@wafertools/wafermap';
import { renderWaferMap }                      from '@wafertools/wafermap/render';
import { analyzeWaferMap, analyzeWaferLot }    from '@wafertools/wafermap/stats';
import { createWafermapWorker }                from '@wafertools/wafermap/worker';
```

The statistics engine (`analyzeWaferMap`, `analyzeWaferLot`, `filterFindings`) is also available from the **`/stats` subpath** and is re-exported from the root package. It has no DOM dependency, so you can run a complete build-and-analyse pipeline in Node.js:

```ts
// Node.js — no DOM required
import { buildWaferMap }   from '@wafertools/wafermap';
import { analyzeWaferMap } from '@wafertools/wafermap/stats';
```

Only the renderers, from `/render`, need a browser environment.

### Which build is running — `WMAP_VERSION` / `WMAP_BUILD_TIME`

```ts
import { WMAP_VERSION, WMAP_BUILD_TIME } from '@wafertools/wafermap/render';
// '0.28.0'   '2026-09-11T07:58:39.023Z'
```

Both are generated at build time, so they describe **the bundle actually loaded** rather than
whatever a nearby `package.json` claims — different things whenever a host is linked to a local
checkout. Show them wherever your application reports its own version: when a map looks wrong,
the first question is which engine produced it, and "check the browser console" is not a useful
answer for an end user. tsmap lists both in its **Help → About tsmap…** dialog.

> **The renderers are not on the root entry point.** `renderWaferMap` and `renderWaferGallery`
> are exported **only** from `@wafertools/wafermap/render` — so
> `import { renderWaferMap } from '@wafertools/wafermap'` will fail. This is deliberate:
> the root entry stays DOM-free (and therefore usable in Node and tree-shakeable) by
> re-exporting only `core`, `renderer` and `stats`. Import the data layer from the
> root and the renderers from `/render`.

### 9.1 `ICONS`

```ts
import { ICONS } from '@wafertools/wafermap/render';

ICONS: Record<string, string>   // icon key → inline SVG markup (uses currentColor for stroke/fill)
```

The toolbar's own icon set, keyed by name (`'download'`, `'expand'`, `'close'`, `'help'`, …). A host rendering its own chrome (overlay buttons, custom toolbars) alongside wmap's can import `ICONS` to match wmap's iconography exactly, instead of copy-pasting SVG strings that silently drift on the next icon redesign. Each value is ready to assign to `element.innerHTML`.

Key names are stable once published — removing or renaming a key is a breaking change, same as any other public export; new keys may be added in a patch release. There is no separate "curated public subset" — the whole set is public, since it is just data (no behaviour to keep internal).

### 9.2 `openReportModal`

```ts
import { openReportModal } from '@wafertools/wafermap/render';

openReportModal(html: string, opts?: { anchor?: Element; ownerDocument?: Document }): OverlayHandle
```

Opens report HTML (from `renderWaferReportHtml` or `renderLotReportHtml`, §7.6) in an in-app modal. The Summary panel's "Summary report" button opens reports through it, so viewing a report needs no host wiring, in a plain browser tab or an embedded host (Tauri, Electron, WebView2) alike. It is the partner of `setReportOpener` (§7.7): a host whose opener saves or logs a report can still show it here.

The modal's header includes a Print/Save-as-PDF button (`window.print()`, scoped to just the report — see below), and its content area has an "Open as full page ↗" link that opens the report as a real separate page instead — to keep it open outside the modal, or as a fallback if in-app printing misbehaves on a given platform. That link goes through the opener registered with `setReportOpener` (§7.7), if a host has one, and `window.open` otherwise.

The report HTML is a complete standalone document (own `<style>`, own `<!DOCTYPE html>`) rendered via `<iframe srcdoc>` — its stylesheet is isolated from the host page automatically, and the print button targets `iframe.contentWindow.print()`, so only the report prints, not the host app around it. This works identically in a plain browser tab and inside a Tauri/Electron/WebView2 webview — printing is native `window.print()` either way, so this needs no platform-specific host code.

`opts.anchor`, when given, resolves the modal into the correct document/stacking root the same way every other overlay in this library does (e.g. a summary panel rendered inside a gallery card detached into its own window) — pass the triggering element (a button, the panel container) when in doubt.

### 9.3 `openWaferMapGuide`

```ts
import { openWaferMapGuide } from '@wafertools/wafermap/render';
import type { UserGuideExtension } from '@wafertools/wafermap/render';

openWaferMapGuide(extension?: UserGuideExtension, anchor?: Element): void
```

Opens the built-in guide window with **no live `WaferMapController`/`GalleryController` required** — `WaferMapController.openUserGuide()`/`GalleryController.openUserGuide()` (§5.4, §6.2) are thin wrappers around this exact same call, built from the library's own top-level functions rather than anything derived from a specific render. Use this when a host's help entry point must also work before anything has been rendered yet (an empty-state "Help" menu, for example) — prefer the controller method when one already exists; this exists for the gap it can't cover.

`extension`, when given, behaves identically to `userGuideExtension` (§5.11) — host content is prepended before wmap's own guide content, in the same combined window. Pass the *same* extension object to both this call and every `renderWaferMap`/`renderWaferGallery` call so a host's "one Help entry point" always shows identical content regardless of whether a map is currently rendered.

`anchor`, when given, resolves the guide window into the correct document/owner-window the same way `opts.anchor` does above.

Available subpath exports: `@wafertools/wafermap`, `/core`, `/renderer`, `/render`, `/stats`, `/worker`, `/worker-script`

> **The Insights tab's canvas chart panels are not a public subpath.** `insights.enabled` (§5.9, §6.10) is the supported way to get charts — the DOM/canvas rendering code behind it is internal to `/render` and not independently importable, so you cannot assemble your own page from wmap's chart panels the way you can compose `/render`'s other pieces. The figures behind them come back from `analyzeWaferMap` and `analyzeWaferLot` (§7.4), if you want to drive your own chart library from the same computations.

---

## 10 Helper functions

### 10.1 `getDieKey(die)`

```ts
getDieKey(die: { x: number; y: number }): string
```

Returns a stable `"x,y"` string key for a die. Always prefer this over ad-hoc template literals — it guarantees a consistent format across grid offset corrections.

```ts
const map = new Map(result.dies.map(d => [getDieKey(d), d]));
const die = map.get(getDieKey({ x: 3, y: -2 }));
```

---

### 10.2 Pass/fail verdicts — `diePassStatus`, `getTestPassStatus`

```ts
import { diePassStatus, getTestPassStatus } from '@wafertools/wafermap';

diePassStatus(die: { hbin?: number; sbin?: number }, passBins: ReadonlySet<number>): boolean | undefined
getTestPassStatus(die: Die, testNumber: number, testDef?: TestDef): boolean | undefined
```

`diePassStatus` is the per-die pass rule: the die's hard bin (else its soft bin) is in `passBins`. Yield, the failing-die hatch and bin colouring all judge a die through it, so a host that counts passing dies itself gets the same answer as the yield figure. Pass the map's own pass bins, `new Set(result.passBins)`. Returns `undefined` for a die with no bin — no verdict, never a fail.

`getTestPassStatus` is the single read-path for "did this die pass test N" (true = pass). Primary source: `die.testPass[testNumber]`. **Legacy fallback — this is the only place the rule exists:** for a functional test (`testType: 'F'`) with no `testPass` entry but a `testValues` entry of exactly `0` or `1`, the value is read as `1` = pass / `0` = fail. The fallback never applies to parametric tests. Returns `undefined` when no verdict is recorded — treat that as no data, never as a fail.

A test value itself needs no helper: read `die.testValues?.[testNumber]`, which is `undefined` when the die has none. On a die `buildWaferMap` returns, each read of `die.testValues` builds a new frozen object (§11.1), so in a loop over many tests read it once per die: `const tv = die.testValues;`.

`Die` → §11.1 · `TestDef` → §4.1.8

---

### 10.3 `metadataDisplayValue(raw)`

```ts
import { metadataDisplayValue } from '@wafertools/wafermap';

metadataDisplayValue(raw: unknown): string | undefined
```

The one rule for turning a `die.metadata` or `wafer.metadata` value into text, as the maps, tooltips, legends, die list and CSV exports show it — use it in a host's own export or labels so they match wmap's exactly. Strings, numbers and booleans stringify, a `Date` becomes an ISO string, anything else is JSON, and an unserialisable value (a circular structure, a `BigInt`) returns an honest marker rather than throwing. Empty string, `null` and `undefined` all return `undefined`, meaning "no value", which is not the same as `"undefined"`; `0` and `false` are kept.

---

### 10.4 `isYieldEligibleDie(die, options?)`

```ts
import { isYieldEligibleDie } from '@wafertools/wafermap';
// also available from '@wafertools/wafermap/core'

isYieldEligibleDie(die: Die, options?: { includeEdgeExcluded?: boolean }): boolean
```

Whether a die counts toward yield/rollup calculations, per wmap's standard fab-reporting convention: `partial` (boundary-straddling) and `edgeExcluded` dies are skipped, even though they may carry real measured values — many fabs exclude them from yield/bin reporting specifically, not from other per-die analysis (their test values still belong in distributions, correlations, and scatter plots). `includeEdgeExcluded: true` counts edge-excluded dies, which exist wherever the caller set `waferConfig.edgeExclusion`. Partial dies are always excluded; no map `buildWaferMap` builds has any, so they come only from dies a host supplies itself (§11.1).

This is the single source of truth for the rule — `buildWaferMap`'s yield calculation, `analyzeWaferMap`'s eligible-die filter, the Summary panel and the Insights charts all call it, so they never drift apart on which dies count.

`Die` → §11.1

---

### 10.5 `getReticleCell(die, config)`

```ts
import { getReticleCell } from '@wafertools/wafermap';
// also available from '@wafertools/wafermap/core'

getReticleCell(
  die:    { x: number; y: number },
  config: { width: number; height: number; anchorDie?: { x: number; y: number } },
): { column: number; row: number }
```

The field-local `(column, row)` a die occupies within its reticle field, per the `anchorDie` convention of `ReticleConfig` (§4.1.4): `anchorDie` is the field's min-x/min-y (bottom-left) corner, so a die's local position is `die − anchorDie`, wrapped to the field dimensions. Both `column` and `row` are `0`-indexed.

This is the single source of truth for "which reticle cell is this die in" — the reticle-position findings (§7) and the tooltip's `Reticle (column, row)` line both call it, so field geometry, findings labels and tooltip text can never drift apart.

Note this is purely index arithmetic on `die.x`/`die.y`, so it is unaffected by any display convention — `xAxisDirection`, `coordinateOrigin`, wafer orientation, and interactive rotate/flip change only where a die is *drawn*, never which reticle cell it belongs to.

`ReticleConfig` → §4.1.4

---

### 10.6 Colours

#### Bin colours for a host surface — `binColorsForMaps(maps, options?)`

```ts
import { binColorsForMaps } from '@wafertools/wafermap';

binColorsForMaps(
  maps: BinColorSource | BinColorSource[],   // a WaferMapResult is one: { dies, passBins?, hbinDefs?, sbinDefs? }
  options?: { binColorScheme?: string; useDefinedBinColors?: boolean },
): BinColors

// BinColors
{
  hard:   Map<number, string>                  // hard bin → CSS colour
  soft:   Map<number, string>                  // soft bin → CSS colour (independent number space)
  shared: { hard: number[]; soft: number[] }   // bins drawn in a colour another bin also has
  pass:   { hard: Set<number>; soft: Set<number> }  // bins that pass: hard = in passBins; soft = every die passes
}
```

The colours `renderWaferMap` and `renderWaferGallery` draw bins in, for a surface of your own — a table swatch, a PDF, a chart in another library. It takes the maps rather than dies and a pass-bin list, so each map's dies are judged by that map's own `passBins`; bin definitions are merged across the maps, first definition of a bin winning, as the gallery does. For a live map, including the palette the user picked, read `WaferMapController.getBinColors()` (§5.5) or `GalleryController.getBinColors()` (§6.3).

The one rule for bin colour, used by the map, its legends, the summary panels, the Insights charts and this function. A bin's colour depends on its number and its pass/fail verdict — never on how many dies it has — so a bin is the same colour in every lot and every screenshot of a program:

- **Pass/fail follows `passBins`.** Passing bins take the palette's `pass` colours (greens) and failing bins its `fail` colours, so with `passBins: [1, 3]` bin 3 is green and a failing bin 1 is not. A soft bin passes when every die carrying it passes (by the same per-die rule as yield); otherwise, or when no die says, it takes a fail colour.
- **Keyed by bin number.** A pass bin takes `pass[(bin − 1) mod n]` and a fail bin `fail[(bin − 2) mod n]`, so bin 1 takes the first pass colour and bin 2 the first fail colour (red, in `'default'`). The slot comes from the number alone, not the bin's position among the pass or fail bins, so changing `passBins` recolours only the bins whose verdict changed.
- **Soft bins read the palette shifted by half its length**, so hard bin *n* and soft bin *n* are different colours.
- **`BinDef.color` wins** over the palette for that bin, unless `useDefinedBinColors: false`.
- **`shared`** lists bins that cannot be told apart by colour — two bins present whose numbers are a palette-length apart (fail bins 2 and 21 in `'default'`), or a defined colour that repeats one. The renderers raise a `bin-colors-shared` warning (§4.2.2) when the bin map on screen has any.

`renderWaferGallery` resolves once over every wafer it shows, so a bin is the same colour on every card.

#### Colour scheme registries

Bin palettes and value gradients are separate registries, chosen by `binColorScheme` and `valueColorScheme`.

```ts
registerBinColorScheme(name: string, scheme: BinColorScheme): void      // throws on an empty pass or fail list
listBinColorSchemes(): Array<{ name: string; label: string }>

registerValueColorScheme(name: string, scheme: ValueColorScheme): void
listValueColorSchemes(): Array<{ name: string; label: string }>
resolveValueColorFn(name?: string, reversed?: boolean): (t: number) => string
```

**Built-in gradients all read low = dark, high = light** — the direction matplotlib
and seaborn define them with, and the one that puts the rare end of a map at the
bright end: on a stacked map the healthy bulk of the wafer sits back as dark
ground while an edge ring or scratch lights up. `'traffic'` and `'jet'` are the
exceptions, and are not lightness ramps at all.

**Colour by value with `resolveValueColorFn`.** It is the one place `reverseValueScheme` is
applied, so a legend, chart or export built on it shows a reading in the same colour as the
map. Pass the map's `valueColorScheme` and `reverseValueScheme` (`WaferViewOptions`, §5.1)
together — they always travel as a pair. Unknown names fall back to `'default'`.

```ts
// BinColorScheme
{
  label: string              // shown in the toolbar Palette menu in bin modes
  pass:  readonly string[]   // colours for passing bins, from bin 1 — greens by convention
  fail:  readonly string[]   // colours for failing bins, from bin 2 — most distinct first,
                             // and never resembling a pass colour
}

// ValueColorScheme
{
  label:    string                   // shown in the Palette menu in value/stacked modes
  forValue: (t: number) => string    // CSS colour for a normalised value t ∈ [0,1]
}
```

A registered scheme appears in the matching toolbar menu automatically. Register once at startup, before rendering; the registries are global for the life of the page. The two built-in bin palettes were selected by measurement: `'default'` keeps every pair of its 3 pass and 19 fail colours at least 16 ΔE00 apart, and `'accessible'` keeps its 2 pass and 14 fail colours at least 8.8 ΔE00 apart under simulated deuteranopia, protanopia and tritanopia together (`tests/binPalettes.test.mjs` re-measures both).

---

## 11 Important types

### 11.1 `Die`

```ts
{
  id:            string
  x?:            number    // die grid X position — prober step coordinate (equals input x for centred grids)
  y?:            number    // die grid Y position — prober step coordinate (equals input y for centred grids)
  physX?:        number    // physical X in mm (or normalized units)
  physY?:        number    // physical Y in mm (or normalized units)
  width:         number    // die width in mm (or normalized units)
  height:        number    // die height in mm (or normalized units)
  testValues?:   Record<number, number>  // test measurements keyed by test number (read-only, see below)
  testPass?:     Record<number, boolean> // recorded pass/fail verdicts keyed by test number (read-only)
  hbin?:         number    // hard bin (physical sort result; STDF V4 range 0–32767)
  sbin?:         number    // soft bin (test-program failure category; independent 0–32767 space)
  metadata?:     DieMetadata
  insideWafer?:  boolean
  partial?:      boolean   // straddles the wafer boundary — never set by buildWaferMap;
                           // only on dies a host supplies itself (see note below)
  edgeExcluded?: boolean   // centre falls within the edge exclusion zone
  probeIndex?:   number
  retestCount?:  number    // set when this position appeared more than once in input results
}
```

> **Test values on a built die are read-only snapshots.** A map holds its test values and verdicts as one column per test, not as an object per die. On a die `buildWaferMap` returns, `testValues` and `testPass` build a frozen object from those columns each time they are read, and keep nothing on the die: read one die's values freely, and hold on to the object if you read it repeatedly. The objects are the map's data, so they cannot be changed: assigning to `die.testValues` or changing a key throws a `TypeError`. To show different values, pass them to `buildWaferMap`, or copy the die with your own object (`{ ...die, testValues: mine }`). A spread, `structuredClone` or `JSON.stringify` of a die gives plain objects with the same values. Dies you build yourself keep ordinary objects.

> **A die with test results is always fully on the wafer.** A prober can only step to sites that lie entirely on the wafer, so a prober map never contains edge-straddling dies. `buildWaferMap` therefore never sets `partial` on a die built from `results`, and floors the *inferred* wafer diameter so it always contains every die.
>
> It follows that a die falling outside the wafer boundary is proof the **geometry** is wrong, not the die — the measured positions are ground truth and the inferred diameter/pitch is the guess. If you supply `waferConfig.diameter` and it cannot contain the probed dies, wmap does not silently resize it (you asserted it); it adds an entry to `result.warnings` naming the shortfall and the likely cause. The most common cause is supplying `diameter` **without** `dieConfig.width`/`height`: the pitch is then derived as `diameter ÷ gridSpan`, which assumes your data spans the full wafer — wrong whenever edge dies are absent. Supply the die pitch, which is the value that actually matters.
>
> A layout map (`layout: true`, §4.1) holds only sites lying fully on the wafer, so it has no `partial` dies either. The flag is therefore set only on dies a host supplies itself, such as a gallery item's `dies`; such a die is drawn in muted grey and left out of yield.

> **A die can have no reported position at all.** `x`/`y`/`physX`/`physY` are optional for exactly this case — real-world data sometimes has no spatial layout (wafer-number-only logs), or a lot where some wafers have positions and others don't, including a single wafer mixing both. A die is either fully positioned or fully unpositioned, never half (`buildWaferMap` throws if only one of `x`/`y` is supplied). Use `hasPosition(die)` to test for a position before your own spatial code; it narrows `x`/`y` to numbers. `getDieKey(die)` falls back to `` `id:${die.id}` `` for an unpositioned die, so two of them never collide on the same key. Non-spatial consumers (yield, bin counts, per-test stats) are unaffected — they never read position and see coordinate-less dies like any other.
>
> `renderWaferMap`/`renderWaferGallery` render a coordinate-less wafer as a die-list table or a compact bin/value summary **in place of the map**, never as a wafer-shaped mosaic with fabricated positions — see the end-user guide's "Dies with no reported position" section for what a host actually sees, and `dataCoverage.unpositionedDies` (§7) below for how a card's build result reports how many.

### 11.2 `Wafer`

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

### 11.3 `WaferMetadata`

Named fields with an open index signature — any extra key is accepted and displayed alongside the named fields in the summary panel header.

```ts
{
  lot?:         string
  waferId?:     string | number
  product?:     string
  testDate?:    string          // ISO 8601 recommended, e.g. "2026-04-23T08:30:00Z"
  operator?:    string
  testProgram?: string
  temperature?: number          // chuck temperature in °C
  split?:       string          // user-assigned experiment/process-corner tag (e.g. "TT", "FF"),
                                 // distinct from any parser-derived field — a first-class slot so hosts that
                                 // support wafer-split assignment get it picked up by the Insights tab's
                                 // "Group by" (§6.10) and lot summary reports' Splits section (§7.6) automatically
  [key: string]: unknown        // custom fields — shown in summary panel header
}
```

Custom fields are added at the top level, exactly like the named fields:

```ts
waferConfig: {
  metadata: {
    lot: 'LOT123', waferId: 1, testDate: '2026-04-23',
    equipmentId: 'P-01',  // custom — displayed in summary panel header
    recipe: 'NMOS-R2',    // custom
  }
}
```

Since 0.15.0, `WaferMetadata` is also the home for lot/wafer facts shown in **die hover tooltips** — they merge in as the tooltip base, with any per-die [`DieMetadata`](#114-diemetadata) key overriding the wafer value.

### 11.4 `DieMetadata`

An open index signature for annotations that **genuinely vary die-to-die**. Any key is accepted and rendered automatically in die hover tooltips.

```ts
{
  [key: string]: unknown   // per-die fields — shown in hover tooltip automatically
}
```

> **Changed in 0.15.0:** the named wafer-level fields (`lotId`, `waferId`, `deviceType`, `testProgram`, `temperature`) were **removed** from `DieMetadata`. They are properties of the wafer, not the die — set them once on [`WaferMetadata`](#113-wafermetadata) (`waferConfig.metadata`). Storing them per die replicated identical values across every die for no benefit.

The tooltip merges the wafer's `WaferMetadata` (base) with the die's `DieMetadata`; a per-die key overrides the wafer value of the same name. Both render as `Label: value` lines, skipping `null`/`undefined` — the label is `metadataFields[].label` when declared, else a Title-Cased version of the key (`prettyKey`), matching the die-list/CSV column labels (§5.4.4) rather than the raw key. wmap renders whatever keys the host supplies — it has no opinion on which fields belong in a tooltip, so control over tooltip content lives in the host-provided metadata.

**Every metadata key also reaches the die-list table and its CSV export** (§5.4.4) — the tooltip is not a special surface. Die metadata is on by default, one column per key; wafer metadata is CSV-only by default, so a detached export stays self-describing without cluttering the on-screen table.

```ts
// Wafer-level facts — set once:
buildWaferMap({
  results,
  waferConfig: { metadata: { lot: 'LOT-001', product: 'NMOS-A', testProgram: 'NM_v3.2' } },
});

// Per-die annotations — only what varies die-to-die:
{
  x: Number(r.x), y: Number(r.y), hbin: Number(r.hbin),
  metadata: { probeCard: 'PC-42', inkDate: r.inkDate },
}

// In onClick or onHover callback:
onClick: (die) => {
  const probeCard = die.metadata?.probeCard;
}
```

### 11.5 Other exported type names

Every type below is reachable from a function documented above — these are the names
to `import type` when you need to annotate a variable rather than let inference do it.
Their shapes are described at the function that produces or consumes them; this table
exists so the name is discoverable, not to restate the shape.

| Type | Subpath | Role |
| --- | --- | --- |
| `DieEligibilityOptions` | `/core` | `isYieldEligibleDie` options — `includeEdgeExcluded?`. |
| `ViewportTransform` | `/render` | Pan/zoom state — `{ originX, originY, ppm, snapDist }`. Usable as `renderWaferMap`'s initial viewport. |
| `InsightsView` | `/render` | `'overview' \| 'distributions' \| 'correlation' \| 'sweeps' \| 'data' \| 'plot'`. `'sweeps'` opens the Plot tab. |
| `DetachWindowOpener` | `/render` | `(label) => Window \| null` — `setDetachWindowOpener`, for hosts where `window.open` is blocked. |
| `DieListDisplayOptions` | `/render` | `RenderOptions.dieList` / `GalleryOptions.dieList` — §5.4.4. |
| `AnalyzeWaferMapInput` | `/stats` | `WaferMapInput \| WaferMapResult`. |
| `AnalyzeWaferLotInput` | `/stats` | `Array<WaferMapInput \| WaferMapResult>`. |
| `HighlightRegionTarget` | `/stats` | `StatsFinding.highlight` variant `kind: 'region'`. |
| `HighlightBinTarget` | `/stats` | Variant `kind: 'bin'`. |
| `HighlightWaferTarget` | `/stats` | Variant `kind: 'wafer'`. |
| `HighlightDieTarget` | `/stats` | Variant `kind: 'dies'`. |
| `MetadataKeySelection` | `/stats` | `'auto' \| 'none' \| string[]` — `DieListDisplayOptions.metadataColumns`. |
| `RegionYield` | `/stats` | One region's yield on `stats.regionYield` — `{ key, label, yieldPercent, n, passDies }`. `key` is an identity; do not parse it (§7.4.1). |
| `RegionYieldFigures` | `/stats` | `stats.regionYield` — `{ ring?, quadrant }` (§7.4.1). |
| `TestCapability` | `/stats` | One test's Cp/Cpk/Pp/Ppk on `stats.capability` (§7.4.1). |
| `TestVerdictYield` | `/stats` | One test's pass rate by recorded verdict on `stats.testFlagYield` (§7.4.1). |
| `ReportMap` | `/stats` | A built map as `renderWaferReportHtml`/`renderLotReportHtml` read it (§7.6). |
| `BinColorSource` / `MapBinColorOptions` | root, `/renderer` | `binColorsForMaps` input and options (§10.6). |
| `FacetItem` | `/stats` | Input to `buildFacetTable` — `{ metadata?, dieCount? }`. |
| `FacetValue` | `/stats` | One distinct value — `{ value, waferCount, dieCount }`. |
| `FacetCuration` | `/stats` | One curation entry — `label`, `facet?`, `date?`. |
| `BuildFacetTableOptions` | `/stats` | `buildFacetTable` options — `curation?`, `facetableOnly?`. |

---

## 12 Current limitations

- Ring segmentation uses equal-width radial bands.  Configurable breakpoints are planned.
