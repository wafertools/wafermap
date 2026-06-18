---
hide:
  - navigation
  - toc
---

# wafermap

<img src="images/hero-test-values.png" alt="wafermap demo" style="max-width:640px; display:block; margin:8px 0;" />

A JavaScript library for rendering interactive wafer maps from semiconductor test data. Hard bins, soft bins, test values, retest runs, edge exclusion, and spec limits are native inputs — no pre-processing required.

```bash
npm install @paulrobins/wafermap
```

```ts
import { buildWaferMap } from '@paulrobins/wafermap';
import { renderWaferMap } from '@paulrobins/wafermap/render';

const result = buildWaferMap({ results });
renderWaferMap(document.getElementById('map'), result);
```

## What it covers

**Geometry.** Pass full physical dimensions or raw prober step positions — die pitch, wafer diameter, and coordinate origin are inferred when not supplied. Retest policy (`last`, `first`, `best`, `worst`), edge exclusion, and reticle overlays are supported directly.

**Rendering.** `renderWaferMap` produces an interactive canvas map with toolbar, zoom/pan, tooltips, die selection, and summary panel. `renderWaferGallery` renders a full lot as a responsive card grid with shared controls and click-to-expand.

**Analysis.** `analyzeWaferMap` runs spatial analysis across rings, quadrants, sectors, and reticle positions, and detects contiguous failure clusters and edge arcs. `analyzeWaferLot` adds lot-level trend series and cross-wafer patterns. Results wire directly into the summary panel.

**Integration.** Pure ES modules, no server, no runtime dependencies. Works in React, Svelte, Vue, plain HTML, or a Web Worker.

## Start here

- [Quick Start](quickstart.md) — up and running in 5 minutes
- [Developer Guide](guide.md) — walkthroughs, usage patterns, and practical integration advice
- [Architecture](architecture.md) — visual overview of the library layers and entry points
- [SvelteKit integration](sveltekit.md) · [React](react.md) · [Vue](vue.md)
- [Troubleshooting](troubleshooting.md) — common mistakes and fixes

## Reference

- [API Reference](api.md) — full public API and configuration reference
- [Application User Guide](user-guide.md) — display and analysis features for end users of an app built with the library
- [Examples](examples/index.md) — live interactive demos
