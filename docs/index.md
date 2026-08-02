---
hide:
  - navigation
  - toc
---

# wafermap

<img src="images/hero-test-values.png" alt="wafermap demo" style="max-width:640px; display:block; margin:8px 0;" />

A JavaScript library for rendering interactive wafer maps from semiconductor test data. Hard bins, soft bins, test values, retest runs, edge exclusion, and spec limits are native inputs — no pre-processing required.

```bash
npm install @wafertools/wafermap
```

```ts
import { buildWaferMap } from '@wafertools/wafermap';
import { renderWaferMap } from '@wafertools/wafermap/render';

const result = buildWaferMap({ results });
renderWaferMap(document.getElementById('map'), result);
```

## Which docs are for you?

**Building an application with wafermap?** You're a developer integrating the library into a test-data app. Follow this path:

1. [Quick Start](quickstart.md) — a working map in 5 minutes
2. [Developer Guide](guide.md) — walkthroughs from first map to lot gallery with findings
3. [SvelteKit](sveltekit.md) · [React](react.md) · [Vue 3](vue.md) — wiring it into your framework
4. [API Reference](api.md) — every type, option, and return value

**Using an application built on wafermap?** You're a test, device, or yield engineer reading wafer maps in an app someone built with this library. You need exactly one page:

- [Application User Guide](user-guide.md) — reading the map, plot modes, toolbar, findings, Insights tab
- [Glossary](glossary.md) — if a term on screen is unfamiliar

**Evaluating the library?** Judge it quickly:

- [Showcase](examples/showcase.html) — all features on one page
- [wafermap vs Plotly.js](examples/comparison.html) — side-by-side timings and features
- [Performance](performance.md) — measured cost by wafer size and option
- [Detection Analysis](detection-analysis.md) — benchmark validation of the pattern-detection systems

## Find a task

| I want to… | Read |
| --- | --- |
| Render my first map | [Quick Start](quickstart.md) |
| Load real CSV data | [Guide §3](guide.md#3-loading-real-data-from-a-csv) |
| Show bins, yield, and pass/fail colours | [Guide §5](guide.md#5-working-with-bins) |
| Plot parametric test values with spec limits | [Guide §6](guide.md#6-working-with-test-values) |
| Handle retests | [Guide §7](guide.md#7-retests-and-enriching-dies-after-build) |
| React to hover, click, and die selection | [Guide §9](guide.md#9-responding-to-user-interaction) |
| Add statistical findings / pattern detection | [Guide §10](guide.md#10-adding-statistical-findings) · [Pattern Detection](pattern-detection.md) |
| Show a whole lot as a gallery | [Guide §12](guide.md#12-building-a-lot-gallery) |
| Add the Insights chart suite | [Guide §14](guide.md#14-the-insights-tab) |
| Keep the UI responsive on big lots | [Web Worker (Guide §17)](guide.md#17-processing-large-datasets-with-a-web-worker) · [Performance](performance.md) |
| Use it in React / Vue / SvelteKit | [React](react.md) · [Vue 3](vue.md) · [SvelteKit](sveltekit.md) |
| Fix a blank map or wrong yield | [Troubleshooting](troubleshooting.md) |
| Understand the package layers | [Architecture](architecture.md) |

## What it covers

**Geometry.** Pass full physical dimensions or raw prober step positions — die pitch, wafer diameter, and coordinate origin are inferred when not supplied. Retest policy (`last`, `first`, `best`, `worst`), edge exclusion, and reticle overlays are supported directly.

**Rendering.** `renderWaferMap` produces an interactive canvas map with toolbar, zoom/pan, tooltips, die selection, and summary panel. `renderWaferGallery` renders a full lot as a responsive card grid with shared controls and click-to-expand.

**Analysis.** `analyzeWaferMap` runs spatial analysis across rings, quadrants, sectors, and reticle positions, and detects contiguous failure clusters and edge arcs. `analyzeWaferLot` adds lot-level trend series and cross-wafer patterns. Results wire directly into the summary panel.

**Integration.** Pure ES modules, no server, no runtime dependencies. Works in React, Svelte, Vue, plain HTML, or a Web Worker.

## Community

Questions, ideas, or want to show off a wafer map you built? Use [GitHub Discussions](https://github.com/wafertools/.github/discussions).
