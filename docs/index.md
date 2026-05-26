---
hide:
  - navigation
  - toc
---

# wafermap

<img src="images/image-5.png" alt="wafermap demo" style="max-width:640px; display:block; margin:8px 0;" />

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

- [Quick Start](QUICKSTART.md) — up and running in 5 minutes
- [Architecture](ARCHITECTURE.md) — visual overview of the library layers and entry points
- [SvelteKit integration](SVELTEKIT.md) · [React](REACT.md) · [Vue](VUE.md)
- [Troubleshooting](TROUBLESHOOTING.md) — common mistakes and fixes

## Reference

- [User Guide](GUIDE.md) — walkthroughs, usage patterns, and practical integration advice
- [API Reference](API.md) — full public API and configuration reference
- [Examples](examples/index.md) — live interactive demos
