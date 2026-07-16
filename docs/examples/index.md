# Examples

**For:** developers. Each example demonstrates live what the matching [Developer Guide](../guide.md) section explains — the guide is the narrative, these are the working code.

Live interactive demos. Each opens a standalone page rendered in the browser.

## Start here

- [Your first wafer map](first-map.html) — minimal two-call example, no CSV · [Guide §2](../guide.md#2-your-first-wafer-map)
- [Loading CSV data](csv-data.html) — parse and map real columnar data · [Guide §3](../guide.md#3-loading-real-data-from-a-csv)
- [Geometry inference](geometry.html) — omit die size and let the library infer it · [Guide §4](../guide.md#4-adding-die-size-and-wafer-geometry)
- [Partial data](partial-data.html) — anchoring the wafer centre for partial coverage, and why sparse data doesn't need it · [Guide §4](../guide.md#4-adding-die-size-and-wafer-geometry)
- [Bins and yield](named-bins.html) — named hard bins, pass/fail colours, yield label · [Guide §5](../guide.md#5-working-with-bins)
- [Test values](test-values.html) — parametric measurements, spec limits, colorbar · [Guide §6](../guide.md#6-working-with-test-values)
- [Retests](retests.html) — multi-touch probe sequences and retest policy · [Guide §7](../guide.md#7-retests-and-enriching-dies-after-build)

## Interaction and control

- [Display control](display-control.html) — rotation, flip, plot mode, colour scheme · [Guide §8](../guide.md#8-controlling-the-display)
- [Theming](theming.html) — theme the chrome and canvas with `--wmap-*` custom properties (light, dark, Nord, Solarized, brand green) · [Guide §8](../guide.md#8-controlling-the-display)
- [Interaction API](interaction.html) — hover, click, box-select, controller methods · [Guide §9](../guide.md#9-responding-to-user-interaction)
- [Lot gallery](gallery.html) — card grid of multiple wafers with shared controls · [Guide §12](../guide.md#12-building-a-lot-gallery)
- [Web Worker](worker.html) — off-main-thread build for large datasets · [Guide §17](../guide.md#17-processing-large-datasets-with-a-web-worker)
- [Custom colour schemes](color-schemes.html) — register your own bin/value palette · [Guide §18](../guide.md#18-custom-colour-schemes)

## Analysis and layout

- [Statistical findings](findings.html) — ring, quadrant, cluster, edge-arc analysis · [Guide §10](../guide.md#10-adding-statistical-findings)
- [Summary panel](summary-panel.html) — persistent metadata and stats sidebar · [Guide §11](../guide.md#11-summary-panel)
- [Lot-level findings](lot-findings.html) — cross-wafer trend detection · [Guide §13](../guide.md#13-lot-level-statistical-findings)
- [Lot-stack spatial analysis](lot-stack-analysis.html) — mean/median/stddev maps across a lot · [Guide §19](../guide.md#19-recipes)
- [Reticle overlays](reticle.html) — photolithography field grid and reticle-position findings · [Guide §15](../guide.md#15-reticle-overlays)
- [Real wafer data (WM-811K)](real-data.html) — open dataset with 811 000 wafer records · [Guide §10](../guide.md#10-adding-statistical-findings)
- [Mixed patterns (MixedWM38)](mixedwm38.html) — classified failure pattern dataset · [Pattern Detection](../pattern-detection.md)

## Compatibility and advanced

- [Rendering pipeline](pipeline.html) — low-level buildView / toCanvas pipeline · [Guide §20](../guide.md#20-advanced-the-rendering-pipeline)
- [wafermap vs Plotly.js](comparison.html) — side-by-side render timings and feature comparison · [Performance](../performance.md)

---

[**Showcase**](showcase.html) — all features in one page, good for a quick overview once you know the basics.
