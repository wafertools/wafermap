# wafermap

<img src="docs/image-5.png" alt="wafermap demo" style="max-width:640px; display:block; margin:8px 0;" />

Browser-first wafer map visualization for semiconductor test data.

**[Project Portal: Docs & Interactive Demos →](https://telecasterer.github.io/wafermap/)**

## Why wafermap

Wafer map visualisation is a solved problem — until you need it to work correctly.
Real probe data has retest runs, edge-excluded dies, STDF hard and soft bins, physical
coordinate systems that may or may not be documented, and spec limits that determine
whether a lot ships. Most charting libraries know nothing about any of this.

wafermap is built around these realities:

- **Works with whatever geometry you have.** Provide full physical dimensions, or just raw prober step positions — the library resolves die pitch, wafer diameter, and coordinate origin automatically.
- **ATE-native data model.** Hard bins, soft bins, pass bins, retest policy, spec limits, edge exclusion — all first-class inputs. No translation layer, no pre-processing step.
- **A complete application, not a chart primitive.** `renderWaferMap` gives you an interactive map with toolbar, zoom/pan, tooltips, die selection, lot gallery, summary panel, and custom colour schemes — out of the box, in one call.
- **Statistical findings included.** `analyzeWaferMap` runs spatial analysis (ring, quadrant, reticle), spec yield, lot trend series, and surfaces findings with human-readable summaries and interactive highlights — no separate analytics layer needed.
- **Embeds anywhere.** Pure ES modules, no server, no runtime dependencies. Drop into any framework or plain HTML page.

## Quick start

```bash
npm install @paulrobins/wafermap
```

```ts
import { buildWaferMap } from '@paulrobins/wafermap';
import { renderWaferMap } from '@paulrobins/wafermap/canvas-adapter';

const { wafer, dies } = buildWaferMap({
  results: rows.map(r => ({ x: +r.x, y: +r.y, hbin: +r.hbin })),
});

renderWaferMap(document.getElementById('map'), wafer, dies);
```

## Docs

- [Guide](https://telecasterer.github.io/wafermap/guide/)
- [API Reference](docs/API.md)
- [Demo catalog](https://telecasterer.github.io/wafermap/)

The docs site is the canonical home for examples, usage notes, and API details.

## Local preview

```bash
npm install
npm run dev
```

This starts MkDocs and serves the documentation site from `docs/`, including the
example pages under `docs/examples/`.
