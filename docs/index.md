---
hide:
  - navigation
  - toc
---

# wafermap

<img src="images/image-5.png" alt="wafermap demo" style="max-width:640px; display:block; margin:8px 0;" />

A browser-targeted wafer map visualization library for semiconductor test data. The library's primary renderer uses the HTML Canvas 2D API for high-performance interactive maps; an optional Plotly export is available for SVG/Plotly workflows. wafermap handles real wafer geometry, die grid inference, reticle overlays, and statistical findings.

```bash
npm install @paulrobins/wafermap
```

```ts
import { buildWaferMap } from '@paulrobins/wafermap';
import { renderWaferMap } from '@paulrobins/wafermap/canvas-adapter';

const { wafer, dies } = buildWaferMap({ results });
renderWaferMap(document.getElementById('map'), wafer, dies);
```

## Why wafermap

Probe data is messy: retest runs, missing geometry, STDF bins, edge exclusion, spec limits. Most charting tools require you to pre-process all of that before you can render anything — and offer nothing after.

wafermap is designed for the full workflow, not just the rendering step.

**Works with your data as-is.**
Provide physical die dimensions and wafer diameter for a fully specified map, or pass raw prober step positions alone — the library resolves pitch, diameter, and coordinate origin automatically. Hard bins, soft bins, pass bins, retest policy (`last`, `first`, `best`, `worst`), spec limits, and edge exclusion are all first-class inputs.

**A complete application in one call.**
`renderWaferMap` delivers an interactive canvas map with toolbar, zoom/pan, die tooltips, selection, lot gallery, and summary panel — with no surrounding infrastructure to build. The toolbar derives its valid states from the data the library built; no flags or mode guards needed from the caller.

**Statistical intelligence built in.**
`analyzeWaferMap` runs spatial analysis across rings, quadrants, and reticle positions; computes spec yield per test; surfaces findings with severity levels and interactive highlights. `analyzeWaferLot` adds lot-level trend series and cross-wafer patterns. Pass the result to `renderWaferMap` and the summary panel populates itself.

**Embeds anywhere.**
Pure ES modules, no server, no build requirement for consumers. Works in React, Svelte, Vue, plain HTML, or a Web Worker for large datasets.

## Documentation

- [User Guide](GUIDE.md) — walkthroughs, usage patterns, and practical integration advice.
- [API Reference](API.md) — the full public API and configuration reference.
- [SvelteKit integration](SVELTEKIT.md)
