# Architecture

**For:** developers choosing an entry point or wanting the system picture. Not needed for basic use — the [Quick Start](quickstart.md) and [Developer Guide](guide.md) stand alone.

This page explains the structure of `wafermap` from the outside in:

1. what a user passes in,
2. which public entry points handle each job,
3. how the internal modules transform data, and
4. how the rendered and analyzed outputs come back to the UI.

The short version is:

- `buildWaferMap()` turns raw wafer test data into a reusable `WaferMapResult`
- `renderWaferMap()` and `renderWaferGallery()` turn that result into interactive UI
- `analyzeWaferMap()` and `analyzeWaferLot()` turn that result into findings and summaries
- `createWafermapWorker()` lets you move the expensive work off the main thread

## 1. Top-level architecture

```mermaid
graph TB
    source["Raw wafer data<br/>CSV, JSON, STDF export, API rows"]
    build["buildWaferMap()"]
    result["WaferMapResult"]

    renderOne["renderWaferMap()"]
    renderMany["renderWaferGallery()"]
    analyze["analyzeWaferMap()"]
    analyzeLot["analyzeWaferLot()"]
    worker["createWafermapWorker()<br/>wafermap.worker"]

    ui1["Interactive wafer map"]
    ui2["Lot gallery"]
    summary["StatsSummary"]
    lotSummary["LotStatsSummary"]

    source --> build
    build --> result
    result --> renderOne
    renderOne --> ui1
    result --> renderMany
    renderMany --> ui2
    result --> analyze
    analyze --> summary
    summary --> renderOne
    result --> analyzeLot
    analyzeLot --> lotSummary
    lotSummary --> renderMany
    source --> worker
```

**What this shows**

`buildWaferMap()` is the central data constructor. Once you have a `WaferMapResult`, you can render it directly, analyze it, or ship it to a Web Worker wrapper. In normal usage you do not recompute geometry for every display action; you build once, then reuse the result across rendering and analysis.

## 2. Package layers

```mermaid
graph LR
    subgraph Core[core]
        core1["wafer"]
        core2["dies"]
        core3["transforms"]
        core4["inference"]
        core5["aggregates"]
        core6["classify"]
    end

    subgraph Renderer[renderer]
        r1["buildWaferMap"]
        r2["buildView"]
        r3["colorMap"]
        r4["colorSchemes"]
    end

    subgraph Canvas[canvas-adapter]
        c1["renderWaferMap"]
        c2["renderWaferGallery"]
        c3["toCanvas"]
        c4["toolbar"]
        c5["summaryPanel"]
        c6["canvasTheme"]
        c7["insightsTab<br/>(internal)"]
        c8["charts/*<br/>(internal, not a public subpath)"]
        c9["metadataBadge<br/>(internal)"]
    end

    subgraph Stats[stats]
        s1["analyzeWaferMap"]
        s2["analyzeWaferLot"]
        s3["regions"]
        s4["clusterDetection"]
        s5["chart data builders<br/>capability, boxplot, histogram,<br/>correlation, scatter, yield, binPareto"]
    end

    subgraph Worker[worker]
        w1["wafermap.worker"]
        w2["createWafermapWorker"]
    end

    core1 --> r1
    core2 --> r1
    core3 --> r1
    core4 --> r1
    core5 --> r1
    core6 --> r1

    r1 --> r2
    r2 --> c3
    c6 --> c3
    c3 --> c1
    c1 --> c4
    c1 --> c5
    c1 --> c7
    c2 --> c7
    c7 --> c8
    s5 --> c8
    c1 --> c9

    r1 --> s1
    r1 --> s2
    r1 --> s5
    s3 --> s1
    s4 --> s1

    r1 --> w1
    s1 --> w1
    w1 --> w2
```

**What this shows**

The codebase is organized as a stack. `core` is the pure foundation, `renderer` builds the data model used by the UI, `canvas-adapter` owns DOM and interaction, `stats` builds findings, and `worker` mirrors the expensive paths behind message passing. If you are deciding what to import, start with the highest layer that matches your task and drop lower only when you need more control.

`insightsTab` and `charts/*` are internal to `canvas-adapter` — reachable only through `insights.enabled` (§5.9/§6.10 in the [API Reference](api.md)), not an independently importable subpath. The chart panels are pure DOM/canvas rendering; the actual per-chart computations (`capability`, `boxplot`, `histogram`, `correlation`, `scatter`, `yield`, `binPareto` under `stats/`) are public and importable from `/stats` on their own, if you want to drive a different chart library from the same numbers.

`metadataBadge` is also internal to `canvas-adapter` — the always-visible wafer/lot metadata overlay `renderWaferMap` mounts bottom-left on the canvas (`RenderOptions.showMetadataBadge`, default `true`). It exists so basic wafer/lot identity (lot, wafer ID, product, test program, temperature) is never hidden behind a toolbar/Insights toggle, without costing map layout space — it's a canvas overlay, not a layout element. `renderWaferGallery` doesn't mount this badge at all (grid cards, detached popups, and the floating-window fallback all pass `showMetadataBadge: false`): it instead (a) folds a lot-wide distinct-values summary, built on `buildFacetTable` (`stats/facets.ts`), into its existing bin-legend strip, and (b) gives every per-wafer view (grid card header, popup window, floating window) its own expandable identity header for that wafer's full metadata, sharing one `buildIdentityHeaderRow` builder and the `wireExpandToggle` interaction helper (`toolbar.ts`) so all three read identically.

## 3. Data construction pipeline

```mermaid
graph TB
    input["WaferMapInput<br/>results, waferConfig, dieConfig, reticleConfig, lotStack"]

    normalize["Normalize inputs<br/>DieResult[] / lot stack / legacy values"]
    inferGeo["Infer geometry<br/>inferWaferFromXY<br/>resolveGridPitch<br/>assignGridIndices"]
    makeDies["Generate dies and wafer<br/>createWafer<br/>generateDies"]
    transform["Apply transforms<br/>applyOrientation<br/>transformDies<br/>clipDiesToWafer"]
    reticle["Build reticle overlay<br/>generateReticleGrid"]
    output["WaferMapResult<br/>wafer, dies, view metadata,<br/>optional bin/test definitions"]

    input --> normalize
    normalize --> inferGeo
    inferGeo --> makeDies
    makeDies --> transform
    transform --> output
    input --> reticle
    reticle --> output
```

**What this shows**

This is the part of the library that turns loose wafer test data into a structured result. You can provide as much or as little geometry as you know: explicit wafer and die sizes, or just raw `x`/`y` step coordinates. The pipeline infers the missing pieces, generates the die model, applies orientation and clipping, and attaches any reticle overlay that should travel with the map.

## 4. Rendering pipeline

```mermaid
graph TB
    result["WaferMapResult"]
    view["buildView()"]
    scene["View"]
    draw["toCanvas()"]
    canvas["HTMLCanvasElement"]

    renderOne["renderWaferMap()"]
    renderMany["renderWaferGallery()"]
    toolbar["Toolbar + hover + selection"]
    card["Gallery card"]

    result --> view
    view --> scene
    scene --> draw
    draw --> canvas
    renderOne --> view
    renderOne --> toolbar
    renderOne --> draw
    result --> renderMany
    renderMany --> card
    card --> renderOne
```

**What this shows**

`buildView()` converts the map result into a drawable view: rectangles, overlays, labels, colors, and hover targets. `toCanvas()` renders that view onto a canvas and returns hit-testing and viewport information. `renderWaferMap()` wraps both steps with the interactive toolbar, selection, tooltips, and optional summary panel. `renderWaferGallery()` repeats the same display model across multiple cards and, via each card's expand button, detaches a card into its own `renderWaferMap()` instance in a separate window — falling back to an in-page floating window when a real separate window isn't available (e.g. inside Tauri/Electron).

## 5. Analysis and worker flow

```mermaid
graph LR
    result["WaferMapResult"]
    waferStats["analyzeWaferMap()"]
    lotStats["analyzeWaferLot()"]
    waferSummary["StatsSummary"]
    lotSummary["LotStatsSummary"]
    findings["Findings panel"]
    lotPanel["Lot summary panel"]

    result --> waferStats
    waferStats --> waferSummary
    waferSummary --> findings
    result --> lotStats
    lotStats --> lotSummary
    lotSummary --> lotPanel

    workerIn["Main thread request"]
    workerScript["wafermap.worker"]
    workerOut["Main thread promise resolution"]
    workerResult["WaferMapResult / StatsSummary / LotStatsSummary"]

    workerIn --> workerScript
    workerScript --> workerOut
    workerOut --> workerResult
```

**What this shows**

The analysis layer consumes the same `WaferMapResult` that the renderer uses. That keeps the UI and the statistics in sync. `analyzeWaferMap()` produces a wafer-level summary, while `analyzeWaferLot()` adds cross-wafer patterns and trend information. If those computations are too heavy for the main thread, the worker entry point packages the same operations behind `postMessage` and `Promise`-based calls.

The worker helper mirrors that shape: you send in a `WaferMapInput` or a batch of `WaferMapResult` objects, and the promise resolves with the computed `WaferMapResult`, `StatsSummary`, or `LotStatsSummary` depending on the request.

> Don't confuse this with the toolbar's **Insights tab** (`insights.enabled`, §2 above) — that's a separate chart-suite view (`insightsTab`/`charts/*`) built on the `stats` package's chart data builders, not on `analyzeWaferMap`/`analyzeWaferLot`. The two "Analysis" names are unrelated: one produces findings/summaries, the other renders charts.

## 6. How to choose an entry point

Use these imports as your default decision tree:

```ts
import { buildWaferMap } from '@wafertools/wafermap';
import { renderWaferMap, renderWaferGallery } from '@wafertools/wafermap/render';
import { analyzeWaferMap, analyzeWaferLot } from '@wafertools/wafermap/stats';
import { createWafermapWorker } from '@wafertools/wafermap/worker';
```

- Use `buildWaferMap()` when you have raw die rows and need a reusable result
- Use `renderWaferMap()` when you want one interactive wafer map
- Use `renderWaferGallery()` when you want a lot-level overview with per-wafer cards
- Use `analyzeWaferMap()` when you need spatial findings for one wafer
- Use `analyzeWaferLot()` when you need cross-wafer lot statistics
- Use `createWafermapWorker()` when the same work should happen off the main thread

If you want the deeper API surface, the [API Reference](api.md) lists every public type and option.
