# wafermap

<img src="docs/images/image-5.png" alt="wafermap demo" style="max-width:640px; display:block; margin:8px 0;" />

Browser-first wafer map visualization for semiconductor test data.

**[Project Portal: Docs & Interactive Demos →](https://telecasterer.github.io/wafermap/)**

## Overview

wafermap renders interactive wafer maps from semiconductor prober output. Hard bins, soft bins, test values, retest runs, edge exclusion, and spec limits are native inputs.

- Geometry inference — pass full physical dimensions or raw prober step positions; die pitch, wafer diameter, and coordinate origin are resolved automatically
- `renderWaferMap` — interactive canvas map with toolbar, zoom/pan, tooltips, die selection, and summary panel; pass an array of results for a lot-level gallery with shared controls and click-to-expand
- `analyzeWaferMap` / `analyzeWaferLot` — spatial analysis across rings, quadrants, sectors, and reticle positions; failure cluster detection; lot trend series
- Pure ES modules, no server, no runtime dependencies — works in React, Svelte, Vue, plain HTML, or a Web Worker

## Quick start

```bash
npm install @paulrobins/wafermap
```

```ts
import { buildWaferMap } from '@paulrobins/wafermap';
import { renderWaferMap } from '@paulrobins/wafermap/canvas-adapter';

const result = buildWaferMap({
  results: rows.map(r => ({ x: +r.x, y: +r.y, hbin: +r.hbin })),
});

renderWaferMap(document.getElementById('map'), result);
```

## Docs

- [Quick start](https://telecasterer.github.io/wafermap/quickstart/)
- [Guide](https://telecasterer.github.io/wafermap/guide/)
- [API Reference](https://telecasterer.github.io/wafermap/api/)
- [Glossary](https://telecasterer.github.io/wafermap/glossary/)
- [Demo catalog](https://telecasterer.github.io/wafermap/)

## Local preview

```bash
npm install
npm run dev
```

Serves the documentation site locally from `docs/`, including the
example pages under `docs/examples/`.
