# wafermap

<img src="docs/images/wafermap-readme-header-256.png" width="64" height="64" alt="wafermap icon">

[![CI and deploy](https://github.com/wafertools/wafermap/actions/workflows/deploy.yml/badge.svg)](https://github.com/wafertools/wafermap/actions/workflows/deploy.yml)
[![npm](https://img.shields.io/npm/v/@wafertools/wafermap.svg)](https://www.npmjs.com/package/@wafertools/wafermap)
![runtime deps](https://img.shields.io/badge/runtime%20deps-0-brightgreen)
![bundle](https://img.shields.io/badge/data%20layer%20min%2Bgz-~53%20kB-blue)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

<img src="docs/images/hero-test-values.png" alt="wafermap demo" style="max-width:640px; display:block; margin:8px 0;" />

Browser-first wafer map visualization for semiconductor test data.

**Zero runtime dependencies.** Pure ES modules with TypeScript types — works in React,
Svelte, Vue, plain HTML, or a Web Worker. The DOM-free data-and-stats layer is ~53 kB
min+gz; the interactive renderer is larger, and its chart suite and in-app guide are
loaded on demand rather than shipped up front — [measured sizes](docs/performance.md).

**[Project Portal: Docs & Interactive Demos →](https://wafertools.github.io/wafermap/)**

## Community

Questions, ideas, or want to show off a wafer map you built? Use [GitHub
Discussions](https://github.com/wafertools/.github/discussions).

## Overview

wafermap renders interactive wafer maps from semiconductor prober output. Hard bins, soft bins, test values, retest runs, edge exclusion, and spec limits are native inputs.

- Geometry inference — pass full physical dimensions or raw prober step positions; die pitch, wafer diameter, and coordinate origin are resolved automatically
- `renderWaferMap` — interactive canvas map with toolbar, zoom/pan, tooltips, die selection, and summary panel
- `renderWaferGallery` — lot-level card grid with shared controls and click-to-expand
- Insights tab (`insights: { enabled: true }`) — an in-toolbar chart suite (yield, per-test pass rate, bin pareto, capability, boxplot, histogram, wafer-to-wafer trend, correlation, scatter) computed from the same wafer/lot data, for one wafer or the whole gallery
- `analyzeWaferMap` / `analyzeWaferLot` — spatial analysis across rings, quadrants, sectors, and reticle positions; failure cluster detection; lot trend series
- Pure ES modules, no server, no runtime dependencies — works in React, Svelte, Vue, plain HTML, or a Web Worker

## Before you build: you may not need to

**[tsmap](https://github.com/wafertools/tsmap)** is a finished, free, MIT-licensed
application built on this library. It opens STDF, ATDF, CSV, JSON and Parquet (plus
`.gz` and `.zip`), runs on Linux, macOS and Windows, and also runs
[in the browser](https://wafertools.github.io/tsmap/app/) with no install — files are
parsed locally and never uploaded. Plot modes, findings, the Insights charts, lot
galleries, splits and reports, without writing any code.

Build on wafermap instead when you need wafer maps **inside your own application**, a
data source tsmap doesn't read, or behaviour it doesn't offer. Otherwise try tsmap
first — integrating later is always open to you.

## Quick start

```bash
npm install @wafertools/wafermap
```

```ts
import { buildWaferMap } from '@wafertools/wafermap';
import { renderWaferMap } from '@wafertools/wafermap/render';

const result = buildWaferMap({
  results: rows.map(r => ({ x: +r.x, y: +r.y, hbin: +r.hbin })),
});

renderWaferMap(document.getElementById('map'), result);
```

**That is the whole integration.** No options are passed, and the map still renders
with its full toolbar — plot modes, colour schemes, zoom and pan, die tooltips, PNG
export. Add `analyzeWaferMap` for the findings and summary panel, swap in
`renderWaferGallery` for a lot, and you have covered what most projects need.

The API reference is long because it documents every option, not because you need
them: [tsmap](https://github.com/wafertools/tsmap), a complete cross-platform desktop
application built on this library, imports **15** of its ~100 exports. Read the
[Quick Start](https://wafertools.github.io/wafermap/quickstart/) first and treat the
[API reference](https://wafertools.github.io/wafermap/api/) as something to search,
not to read.

Note the two import paths. The renderers (`renderWaferMap`,
`renderWaferGallery`) live **only** at `@wafertools/wafermap/render`, so importing them from the
root package will fail. That keeps the root entry DOM-free — usable in Node for a
build-and-analyse pipeline, and tree-shakeable when you only need the geometry, data
and stats layers.

## Docs

**Building an app with wafermap** (developers):

- [Quick start](https://wafertools.github.io/wafermap/quickstart/)
- [Developer Guide](https://wafertools.github.io/wafermap/guide/)
- [SvelteKit](https://wafertools.github.io/wafermap/sveltekit/) · [React](https://wafertools.github.io/wafermap/react/) · [Vue 3](https://wafertools.github.io/wafermap/vue/) integration guides
- [API Reference](https://wafertools.github.io/wafermap/api/)
- [Using wafermap with an AI coding agent](https://wafertools.github.io/wafermap/agents/) — rules to paste into Claude Code / Codex / Copilot / Cursor, also shipped as `AGENTS.md` in this package
- [Architecture](https://wafertools.github.io/wafermap/architecture/) · [Performance](https://wafertools.github.io/wafermap/performance/) · [Troubleshooting](https://wafertools.github.io/wafermap/troubleshooting/)
- [Live examples](https://wafertools.github.io/wafermap/examples/) — or [download them](https://wafertools.github.io/wafermap/wafermap-examples.zip) to run and edit locally, offline, with the library bundled in

**Using an app built with wafermap** (test / device / yield engineers):

- [Application User Guide](https://wafertools.github.io/wafermap/user-guide/) — also embedded in apps via the toolbar help button
- [Glossary](https://wafertools.github.io/wafermap/glossary/)

## Built with wafermap

- **[tsmap](https://github.com/wafertools/tsmap)** — desktop and browser app for loading STDF, ATDF, CSV, JSON, and Parquet wafer data

## Local preview

```bash
npm install
npm run dev
```

Serves the documentation site locally from `docs/`, including the
example pages under `docs/examples/`.

## Author and licence

Written by **Paul Robins**, after nearly four decades in semiconductor test — most
of it building test data analysis tools: wafer map and chart viewers, and the
platforms they were built on.

That work leaned on free software throughout — zlib, Tcl/Tk, SQLite, GCC — and it
was a good deal. wafermap is some of it going back the other way, prompted by
finding out that engineers doing this job today still have no decent free option
for wafer map analysis.

[MIT](LICENSE): free to use, modify and redistribute, including in commercial and
closed-source products. The only condition is that the copyright notice travels
with it.
