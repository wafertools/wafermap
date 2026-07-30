# wafermap

[![CI](https://github.com/telecasterer/wafermap/actions/workflows/ci.yml/badge.svg)](https://github.com/telecasterer/wafermap/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@paulrobins/wafermap.svg)](https://www.npmjs.com/package/@paulrobins/wafermap)
![runtime deps](https://img.shields.io/badge/runtime%20deps-0-brightgreen)
![bundle](https://img.shields.io/badge/core%20min%2Bgz-~37%20kB-blue)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

<img src="docs/images/hero-test-values.png" alt="wafermap demo" style="max-width:640px; display:block; margin:8px 0;" />

Browser-first wafer map visualization for semiconductor test data.

**Zero runtime dependencies · ~37 kB min+gz (core entry).** Pure ES modules with TypeScript types — works in React, Svelte, Vue, plain HTML, or a Web Worker.

**[Project Portal: Docs & Interactive Demos →](https://telecasterer.github.io/wafermap/)**

## Overview

wafermap renders interactive wafer maps from semiconductor prober output. Hard bins, soft bins, test values, retest runs, edge exclusion, and spec limits are native inputs.

- Geometry inference — pass full physical dimensions or raw prober step positions; die pitch, wafer diameter, and coordinate origin are resolved automatically
- `renderWaferMap` — interactive canvas map with toolbar, zoom/pan, tooltips, die selection, and summary panel
- `renderWaferGallery` — lot-level card grid with shared controls and click-to-expand
- Insights tab (`insights: { enabled: true }`) — an in-toolbar chart suite (yield, bin pareto, capability, boxplot, histogram, correlation, scatter) computed from the same wafer/lot data, for one wafer or the whole gallery
- `analyzeWaferMap` / `analyzeWaferLot` — spatial analysis across rings, quadrants, sectors, and reticle positions; failure cluster detection; lot trend series
- Pure ES modules, no server, no runtime dependencies — works in React, Svelte, Vue, plain HTML, or a Web Worker

## Quick start

```bash
npm install @paulrobins/wafermap
```

```ts
import { buildWaferMap } from '@paulrobins/wafermap';
import { renderWaferMap } from '@paulrobins/wafermap/render';

const result = buildWaferMap({
  results: rows.map(r => ({ x: +r.x, y: +r.y, hbin: +r.hbin })),
});

renderWaferMap(document.getElementById('map'), result);
```

Note the two import paths. The renderers (`renderWaferMap`, `renderWaferGallery`,
`toCanvas`) live **only** at `@paulrobins/wafermap/render`, so importing them from the
root package will fail. That keeps the root entry DOM-free — usable in Node for a
build-and-analyse pipeline, and tree-shakeable when you only need the geometry, data
and stats layers.

## Docs

**Building an app with wafermap** (developers):

- [Quick start](https://telecasterer.github.io/wafermap/quickstart/)
- [Developer Guide](https://telecasterer.github.io/wafermap/guide/)
- [SvelteKit](https://telecasterer.github.io/wafermap/sveltekit/) · [React](https://telecasterer.github.io/wafermap/react/) · [Vue 3](https://telecasterer.github.io/wafermap/vue/) integration guides
- [API Reference](https://telecasterer.github.io/wafermap/api/)
- [Architecture](https://telecasterer.github.io/wafermap/architecture/) · [Performance](https://telecasterer.github.io/wafermap/performance/) · [Troubleshooting](https://telecasterer.github.io/wafermap/troubleshooting/)
- [Live examples](https://telecasterer.github.io/wafermap/examples/)

**Using an app built with wafermap** (test / device / yield engineers):

- [Application User Guide](https://telecasterer.github.io/wafermap/user-guide/) — also embedded in apps via the toolbar help button
- [Glossary](https://telecasterer.github.io/wafermap/glossary/)

## Built with wafermap

- **[tsmap](https://github.com/telecasterer/tsmap)** — cross-platform desktop app for loading STDF, ATDF, CSV, and JSON wafer data

## Local preview

```bash
npm install
npm run dev
```

Serves the documentation site locally from `docs/`, including the
example pages under `docs/examples/`.
