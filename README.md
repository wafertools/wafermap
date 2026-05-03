# wafermap

Browser-first wafer map visualization for semiconductor test data.

**[Live demos →](https://telecasterer.github.io/wafermap/)**  
**[Developer Guide →](https://telecasterer.github.io/wafermap/guide/)** — step-by-step from first map to full lot gallery with statistical findings

| Demo | Live | Source |
| --- | --- | --- |
| Single Wafer Map | [open](https://telecasterer.github.io/wafermap/examples/basic-demo/) | [examples/basic-demo/](examples/basic-demo/) |
| Lot Gallery | [open](https://telecasterer.github.io/wafermap/examples/gallery-demo/) | [examples/gallery-demo/](examples/gallery-demo/) |
| CSV Analyzer | [open](https://telecasterer.github.io/wafermap/examples/app-demo/) | [examples/app-demo/](examples/app-demo/) |
| Renderer Comparison | [open](https://telecasterer.github.io/wafermap/examples/plotly-integration-demo/) | [examples/plotly-integration-demo/](examples/plotly-integration-demo/) |
| Bin Occurrence Map | [open](https://telecasterer.github.io/wafermap/examples/bin-gallery-demo/) | [examples/bin-gallery-demo/](examples/bin-gallery-demo/) |
| Geometry Inference | [open](https://telecasterer.github.io/wafermap/examples/inference-demo/) | [examples/inference-demo/](examples/inference-demo/) |
| Bundler Setup | [open](https://telecasterer.github.io/wafermap/examples/vite-demo/) | [examples/vite-demo/](examples/vite-demo/) |
| Manual Pipeline ⚠ | [open](https://telecasterer.github.io/wafermap/examples/pipeline-demo/) | [examples/pipeline-demo/](examples/pipeline-demo/) |

---

## API overview

```text
buildWaferMap()         — data layer: prober results → wafer + dies + scene
    │
    ├── renderWaferMap()       — single interactive canvas map with full toolbar
    ├── renderWaferGallery()   — multi-map gallery with shared controls + click-to-modal
    └── toPlotly()             — Plotly SVG renderer (bring your own Plotly CDN)

analyzeWaferMap()       — per-wafer statistical findings (ring, quadrant, reticle)
analyzeWaferLot()       — lot-level findings (repeated patterns, yield outliers)
```

`x` and `y` are always **die grid positions** (prober step coordinates), not millimetres.

---

## Canvas rendering (no Plotly required)

### Single interactive map

```ts
import { buildWaferMap } from '@paulrobins/wafermap';
import { renderWaferMap } from '@paulrobins/wafermap/canvas-adapter';

const { wafer, dies } = buildWaferMap({
  results:     rows.map(r => ({ x: +r.x, y: +r.y, bins: [+r.hbin], values: [+r.testA] })),
  waferConfig: { diameter: 300, notch: { type: 'bottom' } },
  dieConfig:   { width: 10, height: 10 },
});

const canvas = document.getElementById('map');
const ctrl = renderWaferMap(canvas, wafer, dies, {
  sceneOptions: { plotMode: 'hardbin' },
  onClick:  die  => console.log('clicked', die),
  onSelect: dies => console.log('selected', dies.length, 'dies'),
  onSceneOptionsChange: opts => syncSidebar(opts),
});

// Programmatic control
ctrl.setOptions({ plotMode: 'value', colorScheme: 'viridis' });
ctrl.clearSelection();
ctrl.resetView();
ctrl.destroy();
```

The toolbar provides: camera download · zoom-region · pan · zoom+/− · reset · plot mode · colour scheme · ring/quadrant/label toggles · rotate · flip.

### Multi-map gallery

```ts
import { renderWaferGallery } from '@paulrobins/wafermap/canvas-adapter';

const galleryCtrl = renderWaferGallery(
  document.getElementById('gallery'),
  waferIds.map(id => ({ wafer: wafers[id], dies: dies[id], label: id })),
  {
    sceneOptions: { plotMode: 'hardbin', hbinDefs, sbinDefs, testDefs },
    onSceneOptionsChange: opts => syncSidebar(opts),
  },
);

// One shared control bar drives all cards simultaneously.
galleryCtrl.setOptions({ plotMode: 'value' });
```

Each card has an expand button (↗) in its header that opens a full-screen modal with the complete toolbar. The gallery control bar includes a composite PNG download button.

Stacked modes (`stackedBins`, `stackedSoftBins`, `stackedValues`) are handled automatically — the gallery aggregates the per-wafer data internally when one is selected and restores the original cards when switching back. No extra code is needed.

### Statistical findings

```ts
import { analyzeWaferMap, analyzeWaferLot } from '@paulrobins/wafermap/stats';

const result  = buildWaferMap({ results, waferConfig, dieConfig });
const summary = analyzeWaferMap(result);

// A Findings button appears in the toolbar automatically:
renderWaferMap(canvas, result.wafer, result.dies, { statsSummary: summary });

// For lot-level findings in a gallery:
const lotSummary = analyzeWaferLot(waferResults);
renderWaferGallery(container, items, { lotStatsSummary: lotSummary });
```

---

## Plotly rendering

```ts
import { buildWaferMap, toPlotly } from '@paulrobins/wafermap';

const result = buildWaferMap({
  results:     rows.map(r => ({ x: +r.x, y: +r.y, bins: [+r.hbin], values: [+r.testA] })),
  waferConfig: { diameter: 300, notch: { type: 'bottom' } },
  dieConfig:   { width: 10, height: 10 },
});

const { data, layout } = toPlotly(result.scene);
Plotly.react('chart', data, layout, { responsive: true });
```

Plotly.js must be loaded separately (CDN or bundler). No runtime dependency on Plotly is included in this package.

---

## Architecture

```text
packages/core/           — wafer geometry, die generation, clipping, transforms (no DOM, no Plotly)
packages/renderer/       — buildWaferMap(), buildScene() → renderer-agnostic Scene
packages/stats/          — analyzeWaferMap(), analyzeWaferLot() (no DOM)
packages/plotly-adapter/ — toPlotly(): Scene → Plotly { data, layout }
packages/canvas-adapter/ — renderWaferMap(), renderWaferGallery(), toCanvas()
packages/worker/         — createWafermapWorker(): run buildWaferMap off the main thread
```

### Plot modes

`'value'` · `'hardbin'` · `'softbin'` · `'stackedValues'` · `'stackedBins'` · `'stackedSoftBins'`

### Key features

- True rectangular die rendering with configurable kerf gap
- Wafer clipping with partial die detection and edge exclusion zone
- Wafer orientation flat / V-notch rendered from diameter automatically
- Interactive rotate, flip, zoom, pan, and die selection
- Reticle, probe path, ring, quadrant, and XY indicator overlays
- Multi-channel `values[]` and `bins[]` per die
- Stacked lot modes with automatic internal aggregation (mean / median / stddev / min / max)
- Statistical findings engine — ring, quadrant, reticle, and inter-wafer yield outlier detection
- Adaptive geometry inference — omit die size or diameter and the library estimates them
- Configurable colour schemes; continuous colorbar for value modes; bin legend with click-to-highlight for bin modes
- Web Worker support via `createWafermapWorker` for off-main-thread data processing
- `buildWaferMap` and `analyzeWaferMap`/`analyzeWaferLot` are pure functions — safe to run server-side

Full API reference: [docs/API.md](docs/API.md)  
Developer guide: [telecasterer.github.io/wafermap/guide/](https://telecasterer.github.io/wafermap/guide/)

---

## Running demos locally

```bash
npm install
npm run build
python3 -m http.server 8000
# open http://localhost:8000/examples/basic-demo/
```

For the Vite demo:

```bash
cd examples/vite-demo
npm install
npm run dev
```
