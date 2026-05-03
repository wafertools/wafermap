# Using wafermap In SvelteKit

This guide is for a developer who wants to try `wafermap` inside a TypeScript + SvelteKit application.

## Install

If the repo is on GitHub but not yet published to npm, install it from GitHub and pin a commit or tag:

```bash
npm install github:YOUR_GITHUB_USER/wafermap#653c83f
npm install plotly.js-dist-min
```

For local testing from a checkout:

```bash
npm install ../path/to/wafermap
npm install plotly.js-dist-min
```

## What The App Owns

Your SvelteKit app should own:

- fetching or loading wafer data
- UI state
- Svelte component lifecycle
- Plotly mounting and cleanup

`wafermap` should own:

- wafer geometry and die generation
- data-to-die mapping
- renderer scene creation
- Plotly-ready scene conversion

## Recommended Flow

1. Load your test data — rows with `x`, `y` (die grid positions), `value`, `bin`
2. Call `buildWaferMap({ data, wafer?, die? })` — handles geometry automatically
3. Optionally post-enrich `result.dies` to attach additional test values or bins
4. Build a scene with `buildScene(result.wafer, dies, [], options)`
5. Convert with `toPlotly(scene)`
6. Render with `Plotly.react(...)` inside a Svelte component

`x` and `y` in your data are **die grid positions** (prober step coordinates — integers
like −7, 0, 5), not millimetre values.  Pass `die: { width, height }` in mm to get
physical coordinates; omit it and the library estimates dimensions from the grid layout.

## Minimal Svelte Component

See [docs/examples/WaferPlot.svelte](examples/WaferPlot.svelte) for a copy-pasteable example.

## Notes For SvelteKit

- Plotly should only run in the browser, not during SSR.
- The simplest approach is to dynamically import Plotly in `onMount`.
- Re-render with `Plotly.react(...)` whenever the component inputs change.
- Destroy the plot in `onDestroy` if needed.

## Suggested First Integration

For a first test in a SvelteKit analysis app:

- keep data loading outside the component
- pass rows into a wafer plot component as props (`WaferMapPoint[]`)
- start with `plotMode: 'hardbin'` or `plotMode: 'value'`
- add stacked modes and post-enrichment only after the basic rendering path works

## Reference Files

- [docs/API.md](API.md)
- [examples/inference-demo/](../examples/inference-demo/) — shows all four levels of input completeness
- [examples/vite-demo/src/main.js](../examples/vite-demo/src/main.js)
- [examples/plotly-integration-demo/main.js](../examples/plotly-integration-demo/main.js)
