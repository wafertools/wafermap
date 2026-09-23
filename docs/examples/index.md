# Examples

**For:** developers. Each example demonstrates live what the matching [Developer Guide](../guide.md) section explains — the guide is the narrative, these are the working code.

Live interactive demos. Each opens a standalone page rendered in the browser.

**Run these on your own machine.** Every example on this page ships in the [downloadable examples package](https://wafertools.github.io/wafermap/wafermap-examples.zip) — unzip it, start the bundled server, and edit them locally. The library is included, so it works offline with nothing to install.

Some pages cover several related topics; those links point at the relevant section of the page.

## Start here

- [Showcase — the whole library on one page](showcase.html) — four real lot scenarios with the summary panel, statistical findings and the Insights charts, over data you can swap for your own — start here if you are deciding whether wafermap fits your problem

## Getting started

- [Your first wafer map](first-map.html) — minimal two-call example, no CSV · [Guide: Your first wafer map](../guide.md#your-first-wafer-map)
- [Loading CSV data](csv-data.html) — parse and map real columnar data · [Guide: Loading real data from a CSV](../guide.md#loading-real-data-from-a-csv)
- [Geometry inference](geometry.html#inference) — omit die size and let the library infer it · [Guide: Adding die size and wafer geometry](../guide.md#adding-die-size-and-wafer-geometry)
- [Partial data and centre anchoring](geometry.html#centre-anchoring) — anchoring the wafer centre for partial coverage, and why sparse data doesn't need it · [Guide: Adding die size and wafer geometry](../guide.md#adding-die-size-and-wafer-geometry)
- [Warnings the library surfaces](geometry.html#warnings) — the built-in ⚠ indicator, warning severity, and the `onWarning` opt-out for hosts with their own notification UI · [Guide: Adding die size and wafer geometry](../guide.md#adding-die-size-and-wafer-geometry)
- [Bins and yield](named-bins.html) — named hard bins, pass/fail colours, yield label · [Guide: Working with bins](../guide.md#working-with-bins)
- [Test values](test-values.html) — parametric measurements, spec limits, colorbar · [Guide: Working with test values](../guide.md#working-with-test-values)
- [Bin colours across a full program](bin-colours.html) — a four-wafer lot with 15 hard bins and 32 soft bins — how every bin keeps its colour, two pass grades, and what happens when soft bins outnumber the palette · [Guide: How bin colours are assigned](../guide.md#how-bin-colours-are-assigned)
- [Retests](retests.html) — multi-touch probe sequences and retest policy · [Guide: Retests and enriching dies after build](../guide.md#retests-and-enriching-dies-after-build)

## Display and interaction

- [Display control](display-control.html) — rotation, flip, plot mode, colour scheme · [Guide: Controlling the display](../guide.md#controlling-the-display)
- [Custom colour schemes](display-control.html#custom-schemes) — register your own bin palette with `registerBinColorScheme` and value gradient with `registerValueColorScheme` · [Guide: Custom colour schemes](../guide.md#custom-colour-schemes)
- [Theming](theming.html) — theme the chrome and canvas with `--wmap-*` custom properties (light, dark, Nord, Solarized, brand green) · [Guide: Controlling the display](../guide.md#controlling-the-display)
- [Interaction API](interaction.html) — hover, click, box-select, controller methods · [Guide: Responding to user interaction](../guide.md#responding-to-user-interaction)
- [Metadata / layout mode](metadata-mode.html) — generic categorical colouring from `die.metadata`, coexists with test/bin data · [Guide: Metadata / layout plot mode](../guide.md#metadata-layout-plot-mode)
- [Reticle overlays](reticle.html) — photolithography field grid and reticle-position findings · [Guide: Reticle overlays](../guide.md#reticle-overlays)

## Galleries and analysis

- [Summary panel](statistics.html#summary-panel) — persistent metadata and stats sidebar docked beside the map · [Guide: Summary panel](../guide.md#summary-panel)
- [Statistical findings](statistics.html#findings) — ring, quadrant, cluster, edge-arc analysis on a single wafer · [Guide: Adding statistical findings](../guide.md#adding-statistical-findings)
- [Lot gallery](statistics.html#lot-gallery) — card grid of multiple wafers with shared controls and stacked modes · [Guide: Building a lot gallery](../guide.md#building-a-lot-gallery)
- [Lot-level findings](statistics.html#lot-findings) — cross-wafer trend detection with `analyzeWaferLot` · [Guide: Lot-level statistical findings](../guide.md#lot-level-statistical-findings)
- [Lot-stack spatial analysis](statistics.html#lot-stack) — mean/median/stddev maps aggregated across a lot · [Guide: Recipes](../guide.md#recipes)
- [Multi-site parallel testing](test-sites.html) — site-based analysis across a multi-site prober card
- [Insights chart suite](insights.html) — the built-in charts — yield by wafer, bin pareto, ring/quadrant yield, capability, box plots, histograms and test correlation — with no charting library to add · [Guide: The Insights tab](../guide.md#the-insights-tab)
- [Derived tests and sweeps](derived-tests.html) — tests computed per die from an expression, and an ordered run of tests read as a response curve with its crossing point and separation measured · [API: DerivedTestDef](../api.md#419-derivedtestdef)
- [Parametric sweeps](sweeps.html) — five characterisation sweeps in their own Insights tab — temperature inversion, DIBL on a log scale via derived tests, data retention, output drive, and an RRAM resistance distribution whose thresholds are read from the test names onto a log axis — each read as a pair of curves with the crossing and width measured · [Guide: Derived tests and sweeps](../guide.md#derived-tests-and-sweeps)

## Real data and performance

- [Real wafer data (WM-811K)](real-data.html) — open dataset with 811 000 wafer records · [Guide: Adding statistical findings](../guide.md#adding-statistical-findings)
- [Mixed patterns (MixedWM38)](mixedwm38.html) — classified failure pattern dataset · [Pattern Detection](../pattern-detection.md)
- [Web Worker](worker.html) — off-main-thread build for large datasets · [Guide: Processing large datasets with a Web Worker](../guide.md#processing-large-datasets-with-a-web-worker)
- [wafermap vs Plotly.js](comparison.html) — side-by-side render timings and feature comparison · [Performance](../performance.md)

---

[**Quick Start — live**](quickstart-live.html) — the minimal inline-generated example linked from the Quick Start page
