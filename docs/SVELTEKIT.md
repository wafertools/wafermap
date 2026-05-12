# Using wafermap In SvelteKit

This guide is for a developer who wants to try `wafermap` inside a TypeScript + SvelteKit application.

## Install

Install the package and the canvas renderer:

```bash
npm install @paulrobins/wafermap
```

For local testing from a checkout:

```bash
npm install ../path/to/wafermap
```

## What The App Owns

Your SvelteKit app should own:

- fetching or loading wafer data
- UI state
- Svelte component lifecycle
- mounting and cleanup of the canvas renderer

`wafermap` should own:

- wafer geometry and die generation
- data-to-die mapping
- renderer scene creation
- interactive canvas rendering

## Recommended Flow

1. Load your test data - rows with `x`, `y` (die grid positions), `value`, `bin`
2. Call `buildWaferMap({ results, waferConfig?, dieConfig? })` - handles geometry automatically
3. Render with `renderWaferMap(...)` inside a Svelte component
4. Add `renderWaferGallery(...)` only when you need a multi-wafer overview

`x` and `y` in your data are **die grid positions** (prober step coordinates — integers
like −7, 0, 5), not millimetre values.  Pass `dieConfig: { width, height }` in mm to get
physical coordinates; omit it and the library estimates dimensions from the grid layout.

## Minimal Svelte Component

This is the recommended pattern for SvelteKit: render the canvas map on mount and
destroy it when the component unmounts.

```svelte
<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { buildWaferMap } from '@paulrobins/wafermap';
  import { renderWaferMap } from '@paulrobins/wafermap/canvas-adapter';

  export let rows = [];

  let host: HTMLDivElement | null = null;
  let ctrl: ReturnType<typeof renderWaferMap> | null = null;

  function mountMap() {
    if (!host) return;

    const result = buildWaferMap({
      results: rows,
    });

    ctrl = renderWaferMap(host, result.wafer, result.dies, {
      sceneOptions: { plotMode: 'hardBin' },
    });
  }

  onMount(mountMap);
  onDestroy(() => ctrl?.destroy());
</script>

<div bind:this={host}></div>
```

## Notes For SvelteKit

- `renderWaferMap` should only run in the browser, not during SSR.
- Recreate or update the control when the component inputs change.
- Call `destroy()` in `onDestroy` so the canvas resources are cleaned up.

## Suggested First Integration

For a first test in a SvelteKit analysis app:

- keep data loading outside the component
- pass rows into a wafer map component as props (`DieResult[]`)
- start with `plotMode: 'hardBin'` or `plotMode: 'value'`
- add gallery mode only when you need multiple wafers on one page

## Reference Files

- [docs/API.md](API.md)
- [Your first wafer map](examples/01-first-map.html)
- [CSV loading demo](examples/03-csv-data.html)
- [Lot gallery](examples/12-gallery.html)
- [Web Worker demo](examples/15-worker.html)
- [Advanced pipeline demo](examples/18-pipeline.html)

### Optional compatibility path

If you need Plotly for an existing dashboard or SVG export workflow, see
[Plotly compatibility](examples/17-plotly.html). That surface is supported, but it
is not the preferred integration path for SvelteKit.
